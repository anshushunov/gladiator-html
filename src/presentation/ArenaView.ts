// The renderer: owns the Three.js scene, floor, lighting, resize handling,
// and disposal (carried over from the previous side-keyed renderer), plus
// everything Tasks 15-17 add on top of it -- a `Map<CombatantId,
// ProceduralFighter>` keyed rig lifecycle, render-frame interpolation, a
// `PoseController` per fighter, `ArenaCamera` delegation, and event-batch
// driven contact flashes/weapon trails.
//
// This module is rule-free: it only ever reads `BattleState`/`EncounterEvent`
// data, interpolates it, and feeds it to `PoseController`/`ArenaCamera` --
// it never decides a hit/phase/event outcome and never mutates anything
// under `src/simulation/**`.

import * as THREE from 'three'
import { ArenaCamera, type ArenaCameraState, type HorizontalFramingTarget } from './ArenaCamera'
import { createProceduralFighter, SEMANTIC_JOINT_NAMES, type JointName, type ProceduralFighter } from './ProceduralFighter'
import { PoseController } from './PoseController'
import type { JointTransform } from './poses/combatPoses'
import type { BattleState } from '../simulation/battle'
import type { ContactZone } from '../simulation/combatActions'
import type { CombatantId, EncounterEvent, FighterCombatState } from '../simulation/encounter'
import { normalizeVec2, type Vec2 } from '../simulation/movement'

/**
 * The runtime's per-render-frame payload (owned here, the consumer, per the
 * brief's interface note; `main.ts` only ever constructs one of these). See
 * that module's own comment for `previous`/`current`'s aliasing contract --
 * neither is ever cloned, and this module must never mutate either.
 */
export interface BattleRenderFrame {
  previous: BattleState
  current: BattleState
  alpha: number
  events: readonly EncounterEvent[]
}

/**
 * Dev-only introspection (brief resolution #9): rendered root positions,
 * whether every rendered joint transform is finite, the actual per-joint
 * rotation values (Task 19 addition -- read-only, mirrors data `ArenaView`
 * already computes for the finiteness check above; lets an acceptance
 * fixture distinguish "the pose changed" from "nothing crashed"), which
 * contact-flash effect IDs are currently live, each rig's live weapon-trail
 * point count (Task 19 addition -- `0`/trail hidden precisely tracks
 * `updateWeaponTrail`'s own clear path, so a reset fixture can prove trails
 * are actually cleared rather than merely unobserved), the camera's own
 * state, and the event cursor. Production builds never construct one of
 * these -- see `ArenaView`'s constructor.
 */
export interface ArenaDebugSnapshot {
  rootPositions: Readonly<Record<CombatantId, Vec2>>
  jointTransformsFinite: boolean
  jointRotations: Readonly<Record<CombatantId, Readonly<Record<JointName, readonly [number, number, number]>>>>
  activeEffectIds: readonly string[]
  trailPointCounts: Readonly<Record<CombatantId, number>>
  camera: ArenaCameraState
  eventCursor: number
}

const CAMERA_MIN_DISTANCE = 11
const CAMERA_MAX_DISTANCE = 18

/**
 * Preserves the previous renderer's "stable elevated perspective" as a fixed
 * *angle* rather than a fixed height: the old camera sat at `(0, 8.8, 13)`
 * looking at the origin, an elevation/distance ratio of `8.8/13`. Framing
 * distance now varies (11..18); re-deriving height from that same ratio
 * every frame keeps the pitch constant as the shot zooms, which is what
 * "no vertical zoom response" (design.md) actually asks for -- height is
 * never an independent free variable.
 */
const CAMERA_ELEVATION_RATIO = 8.8 / 13
const CAMERA_FOV_DEGREES = 38
const CAMERA_NEAR = 0.1
const CAMERA_FAR = 100

/** Clamp applied to real wall-clock elapsed time between `sync()` calls, so a backgrounded tab or a long test-driven `advanceTicks` burst can never hand the camera one huge damping step. */
const MAX_FRAME_DELTA_SECONDS = 0.1

const TRAIL_MAX_POINTS = 6
const TRAIL_COLOR = 0xf4ead7

const FLASH_DURATION_MS = 260
const FLASH_SLOTS_PER_ZONE = 2
const FLASH_PEAK_OPACITY = 0.85
const CONTACT_ZONES: readonly ContactZone[] = ['body', 'shield', 'weapon']

/** design.md: "plus an authored height" -- presentation-only per-zone contact height, distinct from (and never derived from) any rig anchor's own rest-pose height. */
const CONTACT_ZONE_HEIGHT: Readonly<Record<ContactZone, number>> = { body: 1.05, shield: 1.22, weapon: 1.30 }
const CONTACT_ZONE_COLOR: Readonly<Record<ContactZone, number>> = { body: 0xe0836b, shield: 0xe8c876, weapon: 0xe7ecf5 }

// ---------------------------------------------------------------------------
// Small pure helpers
// ---------------------------------------------------------------------------

function clamp01(value: number): number {
  if (value < 0) return 0
  if (value > 1) return 1
  return value
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t
}

function lerpVec2(a: Readonly<Vec2>, b: Readonly<Vec2>, t: number): Vec2 {
  return { x: lerp(a.x, b.x, t), z: lerp(a.z, b.z, t) }
}

/** Applies a fully-built `HumanoidPose` (every semantic joint present, per `PoseController.apply`'s contract) onto a rig's live `Object3D` graph. `PoseController` itself never mutates the persistent rig -- it only borrows `fighter.root` as a scratch FK buffer for the IK sub-step and restores it -- so the caller (this module) owns actually applying the sampled pose every frame. */
function applyPoseToJoints(fighter: ProceduralFighter, pose: Readonly<Record<JointName, JointTransform>>): void {
  for (const name of SEMANTIC_JOINT_NAMES) {
    const joint = fighter.joints.get(name)
    if (!joint) continue
    const transform = pose[name]
    joint.rotation.set(transform.rotation[0], transform.rotation[1], transform.rotation[2])
    if (transform.position) joint.position.set(transform.position[0], transform.position[1], transform.position[2])
  }
}

function buildContactFlashGeometry(zone: ContactZone): THREE.BufferGeometry {
  switch (zone) {
    case 'body':
      return new THREE.SphereGeometry(0.14, 8, 6)
    case 'shield':
      return new THREE.RingGeometry(0.09, 0.19, 16)
    case 'weapon':
      return new THREE.OctahedronGeometry(0.13, 0)
  }
}

// ---------------------------------------------------------------------------
// Contact flashes: a small bounded pool (two meshes per zone, round-robin),
// never a standalone particle system. `body`/`shield`/`weapon` are
// distinguished by mesh geometry (and color), never by color alone
// (design.md).
// ---------------------------------------------------------------------------

interface FlashSlot {
  mesh: THREE.Mesh
  material: THREE.MeshBasicMaterial
  spawnedAtMs: number
  id: string
}

class ContactFlashEffects {
  private readonly geometries: THREE.BufferGeometry[] = []
  private readonly slotsByZone: Record<ContactZone, FlashSlot[]>
  private readonly roundRobin: Record<ContactZone, number> = { body: 0, shield: 0, weapon: 0 }
  private nextSerial = 0

  constructor(scene: THREE.Scene) {
    this.slotsByZone = { body: [], shield: [], weapon: [] }
    for (const zone of CONTACT_ZONES) {
      const geometry = buildContactFlashGeometry(zone)
      this.geometries.push(geometry)
      for (let i = 0; i < FLASH_SLOTS_PER_ZONE; i += 1) {
        const material = new THREE.MeshBasicMaterial({
          color: CONTACT_ZONE_COLOR[zone],
          transparent: true,
          opacity: 0,
          side: THREE.DoubleSide,
          depthWrite: false,
        })
        const mesh = new THREE.Mesh(geometry, material)
        mesh.visible = false
        mesh.frustumCulled = false
        scene.add(mesh)
        this.slotsByZone[zone].push({ mesh, material, spawnedAtMs: 0, id: '' })
      }
    }
  }

  spawn(zone: ContactZone, point: Readonly<Vec2>, nowMs: number): void {
    const slots = this.slotsByZone[zone]
    const index = this.roundRobin[zone] % slots.length
    this.roundRobin[zone] += 1
    const slot = slots[index]
    slot.mesh.position.set(point.x, CONTACT_ZONE_HEIGHT[zone], point.z)
    slot.mesh.visible = true
    slot.material.opacity = FLASH_PEAK_OPACITY
    slot.spawnedAtMs = nowMs
    slot.id = `${zone}-${this.nextSerial}`
    this.nextSerial += 1
  }

  /** Fades and, once past `FLASH_DURATION_MS`, hides each active flash -- "expire before the next exchange" (design.md). */
  update(nowMs: number): void {
    for (const zone of CONTACT_ZONES) {
      for (const slot of this.slotsByZone[zone]) {
        if (!slot.mesh.visible) continue
        const age = nowMs - slot.spawnedAtMs
        if (age >= FLASH_DURATION_MS) {
          slot.mesh.visible = false
          continue
        }
        slot.material.opacity = FLASH_PEAK_OPACITY * (1 - age / FLASH_DURATION_MS)
      }
    }
  }

  /** Hides every flash immediately -- used by bout start/rematch (brief resolution #11), never by ordinary fade-out. */
  clear(): void {
    for (const zone of CONTACT_ZONES) {
      for (const slot of this.slotsByZone[zone]) slot.mesh.visible = false
    }
  }

  activeEffectIds(): string[] {
    const ids: string[] = []
    for (const zone of CONTACT_ZONES) {
      for (const slot of this.slotsByZone[zone]) if (slot.mesh.visible) ids.push(slot.id)
    }
    return ids
  }

  dispose(scene: THREE.Scene): void {
    for (const zone of CONTACT_ZONES) {
      for (const slot of this.slotsByZone[zone]) {
        scene.remove(slot.mesh)
        slot.material.dispose()
      }
    }
    for (const geometry of this.geometries) geometry.dispose()
  }
}

// ---------------------------------------------------------------------------
// Per-fighter rig bookkeeping
// ---------------------------------------------------------------------------

interface FighterRig {
  fighter: ProceduralFighter
  poseController: PoseController
  /** Set once by `processNewEvents` on a `defense-declined` event, consumed (and cleared) by the very next pose sample -- `PoseController` only needs the triggering tick handed across once (its own doc comment). */
  pendingDefenseDeclinedTick?: number
  trailGeometry: THREE.BufferGeometry
  trailMaterial: THREE.LineBasicMaterial
  trailLine: THREE.Line
  trailPoints: THREE.Vector3[]
}

function createTrail(): { geometry: THREE.BufferGeometry; material: THREE.LineBasicMaterial; line: THREE.Line } {
  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(TRAIL_MAX_POINTS * 3), 3))
  geometry.setDrawRange(0, 0)
  const material = new THREE.LineBasicMaterial({ color: TRAIL_COLOR, transparent: true, opacity: 0.55, depthWrite: false })
  const line = new THREE.Line(geometry, material)
  line.visible = false
  line.frustumCulled = false
  return { geometry, material, line }
}

// ---------------------------------------------------------------------------
// ArenaView
// ---------------------------------------------------------------------------

export class ArenaView {
  private readonly renderer: THREE.WebGLRenderer
  private readonly scene = new THREE.Scene()
  private readonly perspectiveCamera = new THREE.PerspectiveCamera(CAMERA_FOV_DEGREES, 1, CAMERA_NEAR, CAMERA_FAR)
  private readonly arenaCamera = new ArenaCamera({ minDistance: CAMERA_MIN_DISTANCE, maxDistance: CAMERA_MAX_DISTANCE })
  private readonly flashes: ContactFlashEffects
  private readonly rigs = new Map<CombatantId, FighterRig>()
  private readonly observer: ResizeObserver

  private activeBoutIndex: number | undefined
  private eventCursor = -1
  private lastCameraTimeMs: number | null = null
  private lastFrame: BattleRenderFrame | undefined
  private contextLost = false
  private fallbackElement: HTMLElement | null = null

  /**
   * Dev-only test surfaces (brief resolution #9), assigned only under
   * `import.meta.env.DEV` in the constructor below. `declare`d rather than
   * given a normal field initializer so TypeScript never emits a bare
   * `renderActiveBattleAtAlpha;` field-definition statement for it -- with
   * `useDefineForClassFields`, an ordinary optional field still compiles to
   * an explicit `undefined` initializer that survives into every build,
   * dev or production, as a harmless but literal always-present property.
   * Combined with `buildArenaDebugSnapshot` living outside the class as a
   * free function (below, not a private method) rather than inside it,
   * this is what lets `vite build`'s dead-code elimination drop the entire
   * dev-only surface -- implementation included, not just the assignment --
   * from a production bundle. Verified by building and grepping the emitted
   * bundle for these names (see the task report).
   */
  declare renderActiveBattleAtAlpha?: (alpha: number) => void
  /** Dev-only test surface (brief resolution #9); see `renderActiveBattleAtAlpha`. */
  declare getDebugSnapshot?: () => ArenaDebugSnapshot

  constructor(private readonly canvas: HTMLCanvasElement) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true })
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
    this.renderer.shadowMap.enabled = true
    this.scene.background = new THREE.Color(0x16131a)
    this.scene.fog = new THREE.Fog(0x16131a, 14, 24)

    this.flashes = new ContactFlashEffects(this.scene)
    this.buildArena()
    this.applyCameraTransform(this.arenaCamera.state)

    this.observer = new ResizeObserver(() => this.resize())
    this.observer.observe(canvas.parentElement ?? canvas)
    this.resize()

    this.canvas.addEventListener('webglcontextlost', this.handleContextLost, false)

    if (import.meta.env.DEV) {
      this.renderActiveBattleAtAlpha = (alpha: number): void => {
        if (!this.lastFrame) return
        this.applyFrame({ ...this.lastFrame, alpha: clamp01(alpha) }, { advanceCameraTime: false })
      }
      this.getDebugSnapshot = (): ArenaDebugSnapshot => buildArenaDebugSnapshot(this.rigs, this.flashes, this.arenaCamera.state, this.eventCursor)
    }
  }

  // -- Lifecycle --------------------------------------------------------

  startBout(boutIndex: number, state: BattleState): void {
    this.activeBoutIndex = boutIndex
    this.eventCursor = -1
    this.lastCameraTimeMs = null
    this.lastFrame = undefined

    // Once the WebGL context is lost, `renderer`/`scene` are disposed for
    // good (brief resolution #10 -- no recovery attempted) and the fallback
    // text owns the arena area for the rest of the session. Building fresh
    // rigs against a disposed scene, or un-hiding the canvas, would silently
    // contradict that fallback on the very next bout.
    if (this.contextLost) return

    this.flashes.clear()

    for (const rig of this.rigs.values()) this.disposeRig(rig)
    this.rigs.clear()
    this.reconcileRigs(state.encounter.combatantIds, state.encounter.combatants)

    for (const id of state.encounter.combatantIds) {
      const rig = this.rigs.get(id)
      const combatant = state.encounter.combatants[id]
      if (!rig) continue
      rig.fighter.root.position.set(combatant.position.x, 0, combatant.position.z)
      rig.fighter.root.rotation.set(0, Math.atan2(combatant.facing.x, combatant.facing.z), 0)
    }

    const targets = this.framingTargets(state.encounter.combatantIds, state.encounter.combatants)
    this.arenaCamera.reset(targets)
    this.applyCameraTransform(this.arenaCamera.state)

    this.canvas.hidden = false
    this.canvas.dataset.activeBoutIndex = String(boutIndex)
    this.canvas.dataset.lastEventId = String(this.eventCursor)
    this.canvas.dataset.renderedCombatants = String(this.rigs.size)
  }

  clearBout(): void {
    this.activeBoutIndex = undefined
    this.eventCursor = -1
    this.lastCameraTimeMs = null
    this.lastFrame = undefined

    delete this.canvas.dataset.activeBoutIndex
    delete this.canvas.dataset.lastEventId
    delete this.canvas.dataset.renderedCombatants
    this.canvas.hidden = true

    if (this.contextLost) return // see `startBout`'s matching guard

    this.flashes.clear()
    for (const rig of this.rigs.values()) this.disposeRig(rig)
    this.rigs.clear()
  }

  dispose(): void {
    this.observer.disconnect()
    this.canvas.removeEventListener('webglcontextlost', this.handleContextLost)
    for (const rig of this.rigs.values()) this.disposeRig(rig)
    this.rigs.clear()
    this.flashes.dispose(this.scene)
    if (!this.contextLost) this.renderer.dispose()
    if (this.fallbackElement) {
      this.fallbackElement.remove()
      this.fallbackElement = null
    }
  }

  // -- Per-frame sync -----------------------------------------------------

  sync(frame: BattleRenderFrame): void {
    this.applyFrame(frame, { advanceCameraTime: true })
  }

  private applyFrame(frame: BattleRenderFrame, options: { advanceCameraTime: boolean }): void {
    if (this.contextLost) return
    this.lastFrame = frame

    const { previous, current, events } = frame
    const alpha = clamp01(frame.alpha)
    const nowMs = performance.now()

    this.reconcileRigs(current.encounter.combatantIds, current.encounter.combatants)

    const reducedMotion = this.isReducedMotion()
    this.processNewEvents(events, reducedMotion, nowMs)

    const framingTargets: HorizontalFramingTarget[] = []

    for (const id of current.encounter.combatantIds) {
      const rig = this.rigs.get(id)
      if (!rig) continue
      const currState = current.encounter.combatants[id]
      const prevState = previous.encounter.combatants[id] ?? currState

      const position = lerpVec2(prevState.position, currState.position, alpha)
      const facing = normalizeVec2(lerpVec2(prevState.facing, currState.facing, alpha))

      rig.fighter.root.position.set(position.x, 0, position.z)
      rig.fighter.root.rotation.set(0, Math.atan2(facing.x, facing.z), 0)

      const contactTarget = this.computeContactTarget(currState, previous, current, alpha)

      const sample = rig.poseController.apply(
        {
          previous: prevState,
          current: currState,
          previousTick: previous.encounter.tick,
          currentTick: current.encounter.tick,
          alpha,
          reducedMotion,
          reaction: { defenseDeclinedTick: rig.pendingDefenseDeclinedTick, contactTarget },
        },
        rig.fighter,
      )
      rig.pendingDefenseDeclinedTick = undefined

      applyPoseToJoints(rig.fighter, sample.pose)
      rig.fighter.root.updateMatrixWorld(true)

      this.updateWeaponTrail(rig, sample.weaponTrailActive && !reducedMotion)

      framingTargets.push({ id, centerX: position.x, radius: rig.fighter.horizontalEquipmentRadius })
    }

    const elapsedSeconds = this.consumeCameraDelta(nowMs, options.advanceCameraTime)
    const cameraState = this.arenaCamera.update(framingTargets, elapsedSeconds)
    this.applyCameraTransform(cameraState)

    this.flashes.update(nowMs)
    this.renderer.render(this.scene, this.perspectiveCamera)

    if (this.activeBoutIndex !== undefined) this.canvas.dataset.activeBoutIndex = String(this.activeBoutIndex)
    this.canvas.dataset.lastEventId = String(this.eventCursor)
    this.canvas.dataset.renderedCombatants = String(this.rigs.size)
  }

  /**
   * Processes every event with `id` past the cursor exactly once, advancing
   * the cursor unconditionally so a later re-render of the same tick (this
   * dev-only `renderActiveBattleAtAlpha`, or a duplicate `sync()` call with
   * the same batch) never replays a contact flash or recognition-flinch
   * trigger twice (brief resolution #5).
   *
   * A guard-blocked hit always emits *both* `attack-blocked` and
   * `damage-dealt` for the same `actionInstanceId` (`encounter.ts`'s
   * contact resolution pushes them back-to-back, same tick, same
   * `contactZone: 'shield'`, same `contactPoint`) -- spawning a flash for
   * each would burn both of `shield`'s pool slots on two overlapping
   * flashes at the identical place and moment, for the exact exchange human
   * reviewers are asked to read as "a block". `blockedInstanceIds` (scoped
   * to this one call/batch, since a resolution's paired events can never be
   * split across two different batches -- they're emitted atomically on the
   * same tick) lets the `damage-dealt` branch skip its flash whenever this
   * same batch already spawned one for the paired `attack-blocked`.
   */
  private processNewEvents(events: readonly EncounterEvent[], reducedMotion: boolean, nowMs: number): void {
    const blockedInstanceIds = new Set<string>()

    for (const event of events) {
      if (event.id <= this.eventCursor) continue
      this.eventCursor = event.id

      switch (event.type) {
        case 'attack-blocked':
          blockedInstanceIds.add(event.actionInstanceId)
          if (!reducedMotion) this.flashes.spawn('shield', event.contactPoint, nowMs)
          break
        case 'attack-parried':
          if (!reducedMotion) this.flashes.spawn('weapon', event.contactPoint, nowMs)
          break
        case 'damage-dealt':
          if (!reducedMotion && !blockedInstanceIds.has(event.actionInstanceId)) {
            this.flashes.spawn(event.contactZone, event.contactPoint, nowMs)
          }
          break
        case 'defense-declined': {
          const rig = this.rigs.get(event.defenderId)
          if (rig) rig.pendingDefenseDeclinedTick = event.tick
          break
        }
        default:
          break
      }
    }
  }

  /**
   * Weapon-arm IK target for one fighter, gated to exactly the contact/
   * impact window and cleared otherwise (Task 16 review, carried forward as
   * a hard requirement): outside `contact`/`impact` this returns
   * `undefined`, so `PoseController` never engages IK off a stale point
   * through windup/recovery.
   *
   * Derived solely from this fighter's own single `action.targetId` --
   * every `FighterCombatState` carries exactly one `action`, so a fighter
   * can never have more than one candidate contact target at once, by
   * construction. This is deliberate: it is what a defender's `action`
   * (block/evade/parry) also has -- `targetId` there names the attacker it
   * is reacting to -- so the same rule uniformly aims *either* an attacker's
   * weapon at their target *or* a defender's weapon arm back at the
   * attacker they are parrying/blocking, with no branching on attack vs.
   * defense. The "multiple simultaneous contact events" ambiguity the
   * brief's carried-forward note describes would only arise if this instead
   * scanned the tick's *event batch* for every attacker currently
   * contacting one defender (only possible outside a two-fighter duel,
   * where several attackers can target the same defender in one tick) --
   * that path is not used here, so it is never reachable. If a future mass
   * caller ever needs it, the documented tie-break would be: take the
   * contact-producing event (`attack-blocked`/`attack-parried`/
   * `damage-dealt`) with the lowest `id` in the current batch (the first
   * one phase 9's contact resolution actually resolved) and derive the
   * target from its actor.
   */
  private computeContactTarget(currState: Readonly<FighterCombatState>, previous: BattleState, current: BattleState, alpha: number): Vec2 | undefined {
    const action = currState.action
    if (action.type !== 'active') return undefined
    if (action.phase !== 'contact' && action.phase !== 'impact') return undefined
    const targetId = action.targetId
    const prevTarget = previous.encounter.combatants[targetId]
    const currTarget = current.encounter.combatants[targetId]
    if (!prevTarget || !currTarget) return undefined
    return lerpVec2(prevTarget.position, currTarget.position, alpha)
  }

  private updateWeaponTrail(rig: FighterRig, active: boolean): void {
    if (!active) {
      rig.trailPoints.length = 0
      rig.trailLine.visible = false
      return
    }
    const anchor = rig.fighter.anchors.get('weaponTip')
    if (!anchor) {
      rig.trailLine.visible = false
      return
    }
    const world = new THREE.Vector3()
    anchor.getWorldPosition(world)
    rig.trailPoints.push(world)
    if (rig.trailPoints.length > TRAIL_MAX_POINTS) rig.trailPoints.shift()
    if (rig.trailPoints.length < 2) {
      rig.trailLine.visible = false
      return
    }

    const positionAttribute = rig.trailGeometry.getAttribute('position') as THREE.BufferAttribute
    for (let i = 0; i < rig.trailPoints.length; i += 1) {
      const point = rig.trailPoints[i]
      positionAttribute.setXYZ(i, point.x, point.y, point.z)
    }
    positionAttribute.needsUpdate = true
    rig.trailGeometry.setDrawRange(0, rig.trailPoints.length)
    rig.trailLine.visible = true
  }

  // -- Camera ---------------------------------------------------------------

  private framingTargets(ids: readonly CombatantId[], combatants: Readonly<Record<CombatantId, FighterCombatState>>): HorizontalFramingTarget[] {
    const targets: HorizontalFramingTarget[] = []
    for (const id of ids) {
      const rig = this.rigs.get(id)
      if (!rig) continue
      targets.push({ id, centerX: combatants[id].position.x, radius: rig.fighter.horizontalEquipmentRadius })
    }
    return targets
  }

  private consumeCameraDelta(nowMs: number, advance: boolean): number {
    if (!advance) return 0
    if (this.lastCameraTimeMs === null) {
      this.lastCameraTimeMs = nowMs
      return 0
    }
    const elapsed = Math.min(Math.max((nowMs - this.lastCameraTimeMs) / 1000, 0), MAX_FRAME_DELTA_SECONDS)
    this.lastCameraTimeMs = nowMs
    return elapsed
  }

  private applyCameraTransform(state: ArenaCameraState): void {
    const height = state.distance * CAMERA_ELEVATION_RATIO
    this.perspectiveCamera.position.set(state.lookTargetX, height, state.distance)
    this.perspectiveCamera.lookAt(state.lookTargetX, 0, 0)
  }

  // -- Rig lifecycle ----------------------------------------------------

  private reconcileRigs(ids: readonly CombatantId[], combatants: Readonly<Record<CombatantId, FighterCombatState>>): void {
    const idSet = new Set(ids)
    for (const [id, rig] of this.rigs) {
      if (idSet.has(id)) continue
      this.disposeRig(rig)
      this.rigs.delete(id)
    }

    for (const id of ids) {
      if (this.rigs.has(id)) continue
      const archetype = combatants[id].definition.archetype
      const fighter = createProceduralFighter({ archetype })
      this.scene.add(fighter.root)
      const trail = createTrail()
      this.scene.add(trail.line)
      this.rigs.set(id, {
        fighter,
        poseController: new PoseController(),
        trailGeometry: trail.geometry,
        trailMaterial: trail.material,
        trailLine: trail.line,
        trailPoints: [],
      })
    }
  }

  private disposeRig(rig: FighterRig): void {
    this.scene.remove(rig.fighter.root)
    rig.fighter.dispose()
    this.scene.remove(rig.trailLine)
    rig.trailGeometry.dispose()
    rig.trailMaterial.dispose()
  }

  // -- Reduced motion ---------------------------------------------------

  private isReducedMotion(): boolean {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return false
    return window.matchMedia('(prefers-reduced-motion: reduce)').matches
  }

  // -- WebGL context loss (brief resolution #10) -------------------------

  private readonly handleContextLost = (event: Event): void => {
    event.preventDefault()
    this.contextLost = true

    for (const rig of this.rigs.values()) this.disposeRig(rig)
    this.rigs.clear()
    this.flashes.dispose(this.scene)
    this.renderer.dispose()

    this.canvas.hidden = true
    this.showFallback()
  }

  private showFallback(): void {
    if (this.fallbackElement) return
    const parent = this.canvas.parentElement
    if (!parent) return
    const fallback = document.createElement('p')
    fallback.className = 'arena__webgl-fallback'
    fallback.setAttribute('role', 'status')
    fallback.textContent = 'The arena display is unavailable in this browser session. The match continues below.'
    parent.appendChild(fallback)
    this.fallbackElement = fallback
  }

  // -- Arena set dressing (unchanged in spirit from the previous renderer) --

  private buildArena(): void {
    const floor = new THREE.Mesh(
      new THREE.CircleGeometry(7.7, 64),
      new THREE.MeshStandardMaterial({ color: 0x8a6845, roughness: 1 }),
    )
    floor.rotation.x = -Math.PI / 2
    floor.receiveShadow = true
    this.scene.add(floor)

    const ring = new THREE.Mesh(
      new THREE.TorusGeometry(7.7, 0.13, 8, 96),
      new THREE.MeshStandardMaterial({ color: 0xa77a45, metalness: 0.45, roughness: 0.55 }),
    )
    ring.rotation.x = Math.PI / 2
    ring.position.y = 0.04
    this.scene.add(ring)

    const key = new THREE.DirectionalLight(0xffd8a8, 3.2)
    key.position.set(-4, 10, 6)
    key.castShadow = true
    this.scene.add(key, new THREE.HemisphereLight(0xc9d6ef, 0x3d251a, 1.6))
  }

  private resize(): void {
    const width = this.canvas.clientWidth
    const height = this.canvas.clientHeight
    if (!width || !height) return
    this.perspectiveCamera.aspect = width / height
    this.perspectiveCamera.updateProjectionMatrix()
    this.renderer.setSize(width, height, false)
  }
}

// ---------------------------------------------------------------------------
// Dev-only debug snapshot (brief resolution #9)
//
// Deliberately a free function, not an `ArenaView` method: `ArenaView` only
// ever calls it from inside the constructor's `if (import.meta.env.DEV)`
// branch. Keeping it out of the class means that once that branch is
// dead-code-eliminated in a production build, this function has no
// remaining call site anywhere in the module and gets tree-shaken away
// entirely -- a private class method with the same one dead caller would
// still ship as an always-present (if unreachable) member, since bundlers
// generally do not prune unused members out of an otherwise-live class.
// ---------------------------------------------------------------------------

function buildArenaDebugSnapshot(
  rigs: ReadonlyMap<CombatantId, FighterRig>,
  flashes: ContactFlashEffects,
  cameraState: ArenaCameraState,
  eventCursor: number,
): ArenaDebugSnapshot {
  const rootPositions: Record<CombatantId, Vec2> = {}
  const jointRotations: Record<CombatantId, Record<JointName, readonly [number, number, number]>> = {}
  const trailPointCounts: Record<CombatantId, number> = {}
  let jointTransformsFinite = true

  for (const [id, rig] of rigs) {
    rootPositions[id] = { x: rig.fighter.root.position.x, z: rig.fighter.root.position.z }
    const rotationsForRig = {} as Record<JointName, readonly [number, number, number]>
    for (const name of SEMANTIC_JOINT_NAMES) {
      const joint = rig.fighter.joints.get(name)
      if (!joint) {
        rotationsForRig[name] = [0, 0, 0]
        continue
      }
      const values = [joint.position.x, joint.position.y, joint.position.z, joint.rotation.x, joint.rotation.y, joint.rotation.z]
      if (values.some((value) => !Number.isFinite(value))) jointTransformsFinite = false
      rotationsForRig[name] = [joint.rotation.x, joint.rotation.y, joint.rotation.z]
    }
    jointRotations[id] = rotationsForRig
    trailPointCounts[id] = rig.trailLine.visible ? rig.trailPoints.length : 0
  }

  return {
    rootPositions,
    jointTransformsFinite,
    jointRotations,
    activeEffectIds: flashes.activeEffectIds(),
    trailPointCounts,
    camera: cameraState,
    eventCursor,
  }
}
