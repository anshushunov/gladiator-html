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
import { normalizeVec2, TICKS_PER_SECOND, type Vec2 } from '../simulation/movement'

/**
 * The runtime's per-render-frame payload (owned here, the consumer, per the
 * brief's interface note; `main.ts` only ever constructs one of these). See
 * that module's own comment for `previous`/`current`'s aliasing contract --
 * neither is ever cloned, and this module must never mutate either. `sync()`
 * enforces that: it `deepFreeze`s `previous`/`current`/`events` before this
 * module ever reads them, so "must never mutate" is a thrown `TypeError`
 * away from being caught, not just a convention.
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
  /**
   * Each rig's actual rendered world-facing yaw, read off the root
   * `Group`'s quaternion (applied to the canonical forward vector, then
   * `atan2`'d) rather than through `jointRotations` below -- `'root'` is
   * deliberately absent from `fighter.joints` (see
   * `ProceduralFighter.SEMANTIC_JOINT_NAMES`'s comment), so
   * `jointRotations[id].root` always reads the harmless `[0, 0, 0]` fallback
   * and cannot answer "did the pose layer clobber facing this frame?". This
   * field is what a fixture compares against `atan2(facing.x, facing.z)`
   * from the interpolated simulation state to prove it did not. Deliberately
   * NOT `fighter.root.rotation.y` -- see `buildArenaDebugSnapshot`'s own
   * comment for why that Euler read is unstable across the weapon-arm IK
   * step's quaternion round-trip, even though the rendered rotation itself
   * is unaffected.
   */
  rootYaw: Readonly<Record<CombatantId, number>>
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
/**
 * Exported because it is the whole of the arena camera's pitch, and rig
 * geometry has to be checked against it: `lookAt(x, 0, z)` with this height
 * ratio is a fixed `atan(8.8/13)` depression, so a point's height *on screen*
 * is `y·cos(depression) + depth·sin(depression)`. Anything mounted out to the
 * side of a fighter therefore gains screen height on the facing where that
 * side is the far one -- which is how the retiarius' shoulder guard came to
 * silhouette above his bare head twice over (Task 4 review rounds 1 and 2).
 * `ProceduralFighter.test.ts` derives the angle from this constant rather than
 * keeping a second copy of it, so moving the camera's pitch re-checks the rig.
 */
export const CAMERA_ELEVATION_RATIO = 8.8 / 13
const CAMERA_FOV_DEGREES = 38
const CAMERA_NEAR = 0.1
const CAMERA_FAR = 100

/** Clamp applied to real wall-clock elapsed time between `sync()` calls, so a backgrounded tab or a long test-driven `advanceTicks` burst can never hand the camera one huge damping step. */
const MAX_FRAME_DELTA_SECONDS = 0.1

/** Substep rate for `settleCameraSeconds` (dev-only): the simulation's own tick rate, so a settle of `n` seconds damps exactly like `n` seconds of `×1` playback rather than as one oversized step. */
const SETTLE_STEPS_PER_SECOND = 60

const TRAIL_MAX_POINTS = 6
const TRAIL_COLOR = 0xf4ead7

/** Contact-flash lifetime, in *presentation* milliseconds -- the encounter's own tick rate scaled to ms, never the wall clock (see `applyFrame`). At x1 this is the same 260 ms it always was; at x2/x4 a flash now lives the same number of ticks instead of the same number of seconds, which is what "expire before the next exchange" (design.md) actually measures. */
const FLASH_DURATION_MS = 260

/** Presentation milliseconds per simulation tick. */
const MS_PER_TICK = 1000 / TICKS_PER_SECOND
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

/**
 * Every object `deepFreeze` has already visited, module-level so it stays
 * effective across the whole session rather than being rebuilt per call:
 * `BattleState.descriptor` and (whenever a tick emits nothing)
 * `BattleState.events` are the SAME object shared across every tick of one
 * bout (`battle.ts`'s own doc comments), so a fresh `WeakSet` per `sync()`
 * call would re-walk already-frozen shared structure every single frame for
 * no reason. Guards against cycles the same way a fresh one would.
 */
const deepFreezeSeen = new WeakSet<object>()

/**
 * Recursively `Object.freeze`s `value` and every nested object/array
 * reachable from it. Used by `sync()` (below) to freeze exactly
 * `BattleRenderFrame`'s `previous`/`current`/`events` before this module
 * ever reads them -- proving this renderer, which reads simulation state
 * deeply every frame (pose sampling, contact targeting, camera framing),
 * never accidentally writes back into it. Deliberately never applied to
 * `this.rigs`, the scene or the camera -- those are legitimately mutated
 * every frame, and freezing them would break the render loop.
 */
function deepFreeze<T>(value: T): T {
  if (value === null || typeof value !== 'object') return value
  const target = value as object
  if (deepFreezeSeen.has(target)) return value
  deepFreezeSeen.add(target)
  Object.freeze(target)
  for (const key of Object.keys(target)) {
    deepFreeze((target as Record<string, unknown>)[key])
  }
  return value
}

/** Applies a fully-built `HumanoidPose` (every semantic joint present, per `PoseController.apply`'s contract) onto a rig's live `Object3D` graph. `PoseController` itself never mutates the persistent rig -- it only borrows `fighter.root` as a scratch FK buffer for the IK sub-step and restores it -- so the caller (this module) owns actually applying the sampled pose every frame. */
function applyPoseToJoints(fighter: ProceduralFighter, pose: Readonly<Record<JointName, JointTransform>>): void {
  for (const name of SEMANTIC_JOINT_NAMES) {
    // `fighter.joints` deliberately excludes `'root'` (see
    // `SEMANTIC_JOINT_NAMES`'s comment in `ProceduralFighter.ts`), so this
    // lookup returning `undefined` for it is what keeps `sample.pose.root`
    // (always the identity transform -- no authored pose ever sets it) from
    // ever overwriting the world facing `applyFrame` set on `fighter.root`
    // moments earlier from interpolated simulation state. Previously `root`
    // *was* a joint here, and this loop zeroed that facing every frame.
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
  spawnedAtPresentationMs: number
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
        this.slotsByZone[zone].push({ mesh, material, spawnedAtPresentationMs: 0, id: '' })
      }
    }
  }

  spawn(zone: ContactZone, point: Readonly<Vec2>, presentationMs: number): void {
    const slots = this.slotsByZone[zone]
    const index = this.roundRobin[zone] % slots.length
    this.roundRobin[zone] += 1
    const slot = slots[index]
    slot.mesh.position.set(point.x, CONTACT_ZONE_HEIGHT[zone], point.z)
    slot.mesh.visible = true
    slot.material.opacity = FLASH_PEAK_OPACITY
    slot.spawnedAtPresentationMs = presentationMs
    slot.id = `${zone}-${this.nextSerial}`
    this.nextSerial += 1
  }

  /** Fades and, once past `FLASH_DURATION_MS`, hides each active flash -- "expire before the next exchange" (design.md). */
  update(presentationMs: number): void {
    for (const zone of CONTACT_ZONES) {
      for (const slot of this.slotsByZone[zone]) {
        if (!slot.mesh.visible) continue
        const age = presentationMs - slot.spawnedAtPresentationMs
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
  /**
   * `undefined` only when construction itself failed (final-review fix #2:
   * no WebGL context could be created at all) -- every other field below is
   * still built normally in that case (they need no live GL context to
   * construct), so `contextLost` is the single source of truth for whether
   * rendering is possible; `this.renderer` and `this.contextLost` are always
   * set together, so every read site below that is already guarded by
   * `!this.contextLost` (or returns early on it) can safely non-null-assert.
   */
  private readonly renderer: THREE.WebGLRenderer | undefined
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
  /**
   * Dev-only test surface (see `renderActiveBattleAtAlpha`): damps the camera
   * toward the frame it is currently showing, by `seconds` of *simulated*
   * presentation time, in fixed 1/60 s steps.
   *
   * `?snapshot` mode holds the runtime paused, and a paused frame deliberately
   * advances no camera time at all (that is what makes a capture depend on
   * tick count rather than on how long test setup happened to take). The
   * consequence is that a fixture which steps 253 ticks and captures still
   * sees the camera exactly where the bout's opening `reset()` put it -- a
   * wide arena shot, with the fighters small and off-centre wherever they
   * have since walked to. This lets a capture ask for the framing a player
   * would actually be looking at by then, without reintroducing a wall clock.
   */
  declare settleCameraSeconds?: (seconds: number) => void
  /** Dev-only test surface (brief resolution #9); see `renderActiveBattleAtAlpha`. */
  declare getDebugSnapshot?: () => ArenaDebugSnapshot

  constructor(private readonly canvas: HTMLCanvasElement) {
    try {
      this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true })
      this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
      this.renderer.shadowMap.enabled = true
    } catch {
      // Final-review fix #2: no WebGL context could be created at all (e.g. a
      // browser/session with WebGL disabled entirely) -- `new
      // THREE.WebGLRenderer(...)` throws in that case, and this constructor
      // runs unguarded at `main.ts` module top level, so letting it propagate
      // took the whole app down before `renderDom()`/the first
      // `requestAnimationFrame` ever ran (no series controls, nothing).
      // Enter exactly the state `handleContextLost` already produces for a
      // context lost *after* construction -- `contextLost = true`, canvas
      // hidden, fallback text shown -- rather than adding a second failure
      // mode every other method would need to learn about.
      this.renderer = undefined
      this.contextLost = true
    }
    this.scene.background = new THREE.Color(0x16131a)
    this.scene.fog = new THREE.Fog(0x16131a, 14, 24)

    this.flashes = new ContactFlashEffects(this.scene)
    this.buildArena()
    this.applyCameraTransform(this.arenaCamera.state)

    this.observer = new ResizeObserver(() => this.resize())
    this.observer.observe(canvas.parentElement ?? canvas)
    this.resize()

    this.canvas.addEventListener('webglcontextlost', this.handleContextLost, false)

    if (this.contextLost) {
      this.canvas.hidden = true
      this.showFallback()
    }

    if (import.meta.env.DEV) {
      this.renderActiveBattleAtAlpha = (alpha: number): void => {
        if (!this.lastFrame) return
        this.applyFrame({ ...this.lastFrame, alpha: clamp01(alpha) }, { advanceCameraTime: false })
      }
      this.settleCameraSeconds = (seconds: number): void => {
        if (!this.lastFrame || this.contextLost) return
        const { encounter } = this.lastFrame.current
        const targets = this.framingTargets(encounter.combatantIds, encounter.combatants)
        const steps = Math.max(0, Math.round(seconds * SETTLE_STEPS_PER_SECOND))
        for (let step = 0; step < steps; step += 1) {
          this.applyCameraTransform(this.arenaCamera.update(targets, 1 / SETTLE_STEPS_PER_SECOND))
        }
        this.renderer!.render(this.scene, this.perspectiveCamera)
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
    if (!this.contextLost) this.renderer?.dispose()
    if (this.fallbackElement) {
      this.fallbackElement.remove()
      this.fallbackElement = null
    }
  }

  // -- Per-frame sync -----------------------------------------------------

  /**
   * `advanceCameraTime` (default `true`) lets the caller freeze the camera's
   * own wall-clock damping for this call -- final-review follow-up fix:
   * `main.ts`'s `frame()` calls `syncArena()` (and therefore this method) on
   * every real `requestAnimationFrame` tick regardless of `runtime.paused`
   * (pause only gates simulation tick-stepping), so without this, the
   * camera kept damping toward its target purely from real elapsed
   * wall-clock time while paused -- with nothing else in the frame actually
   * changing. That made every paused capture (screenshots, the dev-only
   * `renderActiveBattleAtAlpha`, which already independently passed
   * `advanceCameraTime: false` for its own single call -- the flag existing
   * there at all was the hint this path had the same gap) depend on how
   * much real time happened to elapse during test setup, not on simulated
   * tick count -- confirmed empirically: two captures of the identical
   * frozen tick, one immediate and one after a 1.5s real delay, previously
   * produced different `camera.lookTargetX`/`camera.distance` values purely
   * from that elapsed wall-clock time. `main.ts` passes
   * `advanceCameraTime: !runtime.paused`, so an *unpaused* real frame still
   * damps the camera normally every tick, exactly as before.
   */
  sync(frame: BattleRenderFrame, options?: { advanceCameraTime?: boolean }): void {
    // Freeze before `applyFrame` -- including before its own `contextLost`
    // early return -- so the invariant holds even on a session where no
    // WebGL context exists to render into at all, not only on the normal
    // path `stateHash.test.ts`'s freeze proof actually exercises.
    deepFreeze(frame.previous)
    deepFreeze(frame.current)
    deepFreeze(frame.events)
    this.applyFrame(frame, { advanceCameraTime: options?.advanceCameraTime ?? true })
  }

  private applyFrame(frame: BattleRenderFrame, options: { advanceCameraTime: boolean }): void {
    if (this.contextLost) return
    this.lastFrame = frame

    const { previous, current, events } = frame
    const alpha = clamp01(frame.alpha)
    const nowMs = performance.now()
    // Contact flashes age on the encounter's own tick, not on the wall clock:
    // a flash spawned by a tick-255 contact is exactly as far through its life
    // at tick 260 no matter how long the machine took to render those five
    // ticks. On a loaded CI runner the wall-clock version routinely expired
    // between an `advanceTicks` burst and the snapshot read that was supposed
    // to observe it. Deliberately read off the whole tick rather than the
    // interpolated one, so re-rendering the same tick pair at a different
    // alpha cannot age a flash either.
    const presentationMs = current.encounter.tick * MS_PER_TICK

    this.reconcileRigs(current.encounter.combatantIds, current.encounter.combatants)

    const reducedMotion = this.isReducedMotion()
    this.processNewEvents(events, reducedMotion, presentationMs)

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

      framingTargets.push({ id, centerX: position.x, centerZ: position.z, radius: rig.fighter.horizontalEquipmentRadius })
    }

    const elapsedSeconds = this.consumeCameraDelta(nowMs, options.advanceCameraTime)
    const cameraState = this.arenaCamera.update(framingTargets, elapsedSeconds)
    this.applyCameraTransform(cameraState)

    this.flashes.update(presentationMs)
    // Non-null: this method returns early on `this.contextLost` above, and
    // `this.renderer`/`this.contextLost` are always set together (see the
    // field's own doc comment).
    this.renderer!.render(this.scene, this.perspectiveCamera)

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
  private processNewEvents(events: readonly EncounterEvent[], reducedMotion: boolean, presentationMs: number): void {
    const blockedInstanceIds = new Set<string>()

    for (const event of events) {
      if (event.id <= this.eventCursor) continue
      this.eventCursor = event.id

      switch (event.type) {
        case 'attack-blocked':
          blockedInstanceIds.add(event.actionInstanceId)
          if (!reducedMotion) this.flashes.spawn('shield', event.contactPoint, presentationMs)
          break
        case 'attack-parried':
          if (!reducedMotion) this.flashes.spawn('weapon', event.contactPoint, presentationMs)
          break
        case 'damage-dealt':
          if (!reducedMotion && !blockedInstanceIds.has(event.actionInstanceId)) {
            this.flashes.spawn(event.contactZone, event.contactPoint, presentationMs)
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
      targets.push({
        id,
        centerX: combatants[id].position.x,
        centerZ: combatants[id].position.z,
        radius: rig.fighter.horizontalEquipmentRadius,
      })
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

  /**
   * `state.distance` stays the *horizontal* distance from the look target,
   * with the elevation added on top of it (so the true 3D distance is
   * `hypot(distance, height)`) -- the same relation the fixed-position
   * camera had before framing became dynamic. `state.yaw` swings that
   * horizontal offset around the look target, keeping the combat axis across
   * the frame (design.md's 2026-08-18 amendment); `yaw === 0` reproduces the
   * arena's authored home shot exactly.
   */
  private applyCameraTransform(state: ArenaCameraState): void {
    const height = state.distance * CAMERA_ELEVATION_RATIO
    this.perspectiveCamera.position.set(
      state.lookTargetX + Math.sin(state.yaw) * state.distance,
      height,
      state.lookTargetZ + Math.cos(state.yaw) * state.distance,
    )
    this.perspectiveCamera.lookAt(state.lookTargetX, 0, state.lookTargetZ)
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
    this.renderer?.dispose()

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
    if (this.contextLost) return
    const width = this.canvas.clientWidth
    const height = this.canvas.clientHeight
    if (!width || !height) return
    this.perspectiveCamera.aspect = width / height
    this.perspectiveCamera.updateProjectionMatrix()
    // Non-null: guarded by the `contextLost` return above -- see
    // `this.renderer`'s own doc comment for the paired-invariant this relies on.
    this.renderer!.setSize(width, height, false)
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
  const rootYaw: Record<CombatantId, number> = {}
  const jointRotations: Record<CombatantId, Record<JointName, readonly [number, number, number]>> = {}
  const trailPointCounts: Record<CombatantId, number> = {}
  let jointTransformsFinite = true

  for (const [id, rig] of rigs) {
    rootPositions[id] = { x: rig.fighter.root.position.x, z: rig.fighter.root.position.z }
    // Deliberately NOT `rig.fighter.root.rotation.y` -- three.js's Euler is
    // one of two equally valid decompositions of the same rotation for a
    // pure-yaw quaternion (`(0, yaw, 0)` or the "flipped" `(pi, pi-yaw,
    // pi)`), and which one `.rotation` reads back as is not stable across a
    // quaternion round-trip. `PoseController`'s weapon-arm IK step
    // (`solveWeaponArmIk`) does exactly such a round-trip every tick this
    // fighter has a live `contactTarget` (`root.quaternion.identity()` for
    // its own FK scratch pass, then `root.quaternion.copy(savedQuaternion)`
    // to restore) -- `Quaternion.copy` restores the quaternion's *value*
    // exactly (confirmed: the restored quaternion is bit-identical to the
    // saved one, and the rendered mesh orientation is therefore correct),
    // but three.js does not guarantee `.rotation` re-derives the same Euler
    // triple it started from, only an equivalent one. Reading `.rotation.y`
    // straight after that round-trip can read the other, "flipped"
    // decomposition, whose `y` differs from the original yaw by up to pi --
    // this was caught by this file's own regression test failing at tick
    // 329 of the frozen seed-20260815 duel with rendered/expected yaw
    // summing to ~-pi, the textbook signature of exactly this ambiguity.
    // Deriving yaw from the quaternion applied to the canonical forward
    // vector instead is decomposition-independent -- both Euler solutions
    // yield the identical quaternion (that is what makes them equivalent),
    // so this reads the same yaw regardless of which one `.rotation`
    // happens to cache.
    const worldForward = new THREE.Vector3(0, 0, 1).applyQuaternion(rig.fighter.root.quaternion)
    rootYaw[id] = Math.atan2(worldForward.x, worldForward.z)
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
    rootYaw,
    jointTransformsFinite,
    jointRotations,
    activeEffectIds: flashes.activeEffectIds(),
    trailPointCounts,
    camera: cameraState,
    eventCursor,
  }
}
