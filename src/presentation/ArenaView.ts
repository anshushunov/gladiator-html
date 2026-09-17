// The renderer: owns the Three.js scene, floor, lighting, resize handling,
// and disposal (carried over from the previous side-keyed renderer), plus
// everything Tasks 15-17 add on top of it -- a `Map<CombatantId,
// SkinnedFighter>` keyed rig lifecycle, render-frame interpolation, a
// `FighterAnimator` per fighter, `ArenaCamera` delegation, and event-batch
// driven contact flashes/weapon trails.
//
// This module is rule-free: it only ever reads `BattleState`/`EncounterEvent`
// data, interpolates it, and feeds it to `clipMapping`/`FighterAnimator`/
// `ArenaCamera` -- it never decides a hit/phase/event outcome and never
// mutates anything under `src/simulation/**`.

import * as THREE from 'three'
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js'
import { ArenaCamera, FLAT_DISTANCE, measuredExtent, type ArenaCameraState, type HorizontalFramingTarget } from './ArenaCamera'
import { createSkinnedFighter, type FighterModelSet, type SkinnedFighter } from './SkinnedFighter'
import { FighterAnimator } from './FighterAnimator'
import { selectClip, type ClipSelection } from './clipMapping'
import { FIGHTER_BONE_NAMES, type FighterBoneName } from './fighterModelContract'
import { classifyDamage, DamageNumberPool, type DamageNumberKind } from './DamageNumbers'
import type { BattleState } from '../simulation/battle'
import type { ContactZone } from '../simulation/combatActions'
import type { CombatantId, EncounterEvent, FighterCombatState } from '../simulation/encounter'
import type { Archetype } from '../simulation/fighters'
import { normalizeVec2, TICKS_PER_SECOND, type Vec2 } from '../simulation/movement'

/**
 * The runtime's per-render-frame payload (owned here, the consumer, per the
 * brief's interface note; `main.ts` only ever constructs one of these). See
 * that module's own comment for `previous`/`current`'s aliasing contract --
 * neither is ever cloned, and this module must never mutate either. In a dev
 * or test build `sync()` enforces that: it `deepFreeze`s
 * `previous`/`current`/`events` before this module ever reads them, so "must
 * never mutate" is a thrown `TypeError` away from being caught, not just a
 * convention. A production build does not freeze -- see `sync()`'s own comment
 * for why the freeze must not reach a player's runtime.
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
   * Each rig's actual rendered world-facing yaw, read off the wrapper
   * `Group`'s quaternion (applied to the canonical forward vector, then
   * `atan2`'d) rather than through `jointRotations` below. The two are
   * different objects on purpose: `fighter.root` is the wrapper this module
   * places and turns from interpolated simulation state, while
   * `jointRotations[id].root` is the model's *own* `root` bone nested
   * underneath it, which the clip owns and which therefore cannot answer
   * "did the animation layer clobber facing this frame?". This field is what
   * a fixture compares against `atan2(facing.x, facing.z)` from the
   * interpolated simulation state to prove it did not. Deliberately NOT
   * `fighter.root.rotation.y` -- see `buildArenaDebugSnapshot`'s own comment
   * for why that Euler read is unstable across a quaternion round-trip, even
   * though the rendered rotation itself is unaffected.
   */
  rootYaw: Readonly<Record<CombatantId, number>>
  jointTransformsFinite: boolean
  jointRotations: Readonly<Record<CombatantId, Readonly<Record<FighterBoneName, readonly [number, number, number]>>>>
  /**
   * Which clip each rig is actually playing, and how far into it in seconds:
   * verbatim the `ClipSelection` `applyFrame` handed that rig's
   * `FighterAnimator`, recorded on the rig by the same statement that applies
   * it (final-review fix I1).
   *
   * The point is that nothing else in the suite could see the animation layer
   * at all. `jointRotations` above has no consumer outside this file, and
   * `jointTransformsFinite` is satisfied by a rig that never moves -- so a
   * `FighterAnimator.apply` that returned early, or a `selectClip` hard-wired
   * to `Idle`, would have kept every fast test green while the bout played as
   * a row of statues. `tests/combat-visuals.spec.ts` asserts this field at the
   * frozen key-pose ticks: the clip name `ATTACK_CLIPS`/`DEFENSE_CLIPS`/
   * `BASE_CLIPS` maps that tick's action to, and the clip time against the
   * shipped `.glb`'s own duration.
   *
   * A rig that has not been rendered yet (constructed by `reconcileRigs`, no
   * `applyFrame` since) is absent from this record rather than present with a
   * placeholder clip: "no frame has been drawn" and "the rig is idling" are
   * different states and a fixture must be able to tell them apart.
   */
  activeClip: Readonly<Record<CombatantId, { clip: string; time: number }>>
  activeEffectIds: readonly string[]
  /**
   * The live damage numbers in spawn order (feedback spec §6.6). Separate
   * from `activeEffectIds` on purpose: that field means "transient 3D
   * effects, empty under reduced motion", and a number is neither -- it is
   * DOM, and it is the reduced-motion hit channel.
   */
  activeDamageNumbers: readonly { id: string; amount: number; kind: DamageNumberKind }[]
  trailPointCounts: Readonly<Record<CombatantId, number>>
  camera: ArenaCameraState
  eventCursor: number
  /**
   * The group extent the camera's own framing consumed for this frame:
   * `ArenaCamera`'s exported `measuredExtent` over the same targets
   * `applyFrame` built, at the camera's current `state.yaw`. Not a
   * re-derivation from positions and radii -- that quantity (no yaw, no 10%
   * equipment margin) is not what `extentToDistance` is fed, and a camera
   * constant chosen against it would be chosen against a number the shipping
   * camera never sees.
   */
  groupExtent: number
  /**
   * Each rig's on-screen head-to-foot height in CSS pixels: the projected
   * vertical span of the *body* silhouette only (`BODY_SILHOUETTE_SLOTS` --
   * the man and everything he wears, helmet and crest included), never of
   * what he holds.
   *
   * Deliberately a different number from `fullBoundsPx` below. The slice's
   * scale floor is a floor on how big the *fighter* reads, and a hoplomachus
   * holding a 1.30-unit spear upright, or a murmillo behind a 1.10-unit
   * scutum, would satisfy a floor measured over everything on screen without
   * the man himself being any easier to see.
   *
   * **BIND POSE, not the drawn pose** (final-review fix I4). Every `*Px` field
   * here is measured by `accumulateProjectedBounds`, which projects each
   * mesh's own `geometry.boundingBox` through its `matrixWorld`. For a
   * `SkinnedMesh` those two do not compose into the drawn silhouette:
   *
   * - `geometry.boundingBox` is the BIND-POSE box. Skinning happens in the
   *   vertex shader from the skeleton's bone matrices, and no `Object3D`
   *   transform above the mesh reflects it, so a crouch, a lunge or a
   *   knocked-down death pose moves nothing here.
   * - `matrixWorld` is NOT the transform the drawn mesh is under either. The
   *   shipped `.glb`s put the six body meshes under a `Rig` node carrying the
   *   armature scale the build script applied (0.8641 heavy, 0.9148 fast,
   *   0.9145 technical), and the bind-pose vertex data is already in final
   *   world units (spanning exactly 2.0 in y, feet at y=0 -- asserted by
   *   `fighterModelContract.test.ts`). At draw time that double count cancels:
   *   `SkinnedMesh` defaults to `AttachedBindMode`, which re-derives
   *   `bindMatrixInverse` from `matrixWorld` every `updateMatrixWorld`, so the
   *   shader's `matrixWorld * bindMatrixInverse` is the identity and the man
   *   is drawn 2.0 units tall. A measurement that multiplies the box by
   *   `matrixWorld` and stops there does NOT cancel it, so the box this field
   *   projects is the standing body scaled by that `Rig` factor -- about 1.73
   *   world units for the murmillo and 1.83 for the other two.
   *
   * Rigidly bone-parented props -- the spear, trident, net, both shields, the
   * helmet -- are ordinary `Mesh`es under a `Bone`, so those do track the
   * drawn pose exactly.
   *
   * Left as is deliberately (see spec §7), because for the 130 px floor this
   * is conservative twice over: a pose-independent height cannot be inflated
   * by a frame that happens to stretch the silhouette, and the `Rig` factor
   * makes the measured body shorter than the drawn one, so clearing the bar
   * here means clearing it on screen with room to spare. What it is not is
   * the procedural rig's guarantee, whose limbs were separate `Mesh`es and
   * whose boxes were therefore posed every frame: "the drawn body never
   * leaves the inset" is no longer what the safe-area rule asserts.
   */
  bodyHeightPx: Readonly<Record<CombatantId, number>>
  /**
   * Each rig's full on-screen axis-aligned bounds in CSS pixels: every
   * slotted mesh, props included (spear, trident, net, both shields, crest,
   * greaves, rim outlines). This is what the safe-area rule is checked
   * against -- no part of either fighter may leave the canvas inset, however
   * long the thing he is carrying.
   *
   * Origin is the canvas's top-left corner, `y` growing downward, matching
   * DOM/screenshot pixel conventions rather than NDC.
   *
   * Mixed pose semantics, by construction (see `bodyHeightPx` above): the
   * skinned body parts contribute their BIND-POSE box carried by the rig
   * root, while every bone-parented prop contributes its actually-drawn
   * position. The safe-area rule is therefore stated over "the standing body
   * plus the live props", not over the drawn silhouette.
   */
  fullBoundsPx: Readonly<Record<CombatantId, ScreenBoundsPx>>
  /**
   * `fullBoundsPx` minus the `'weapon'` slot -- the same bounds a safe-area
   * rule would check if long handheld polearms (the hoplomachus' spear shaft,
   * the retiarius' trident) were permitted to leave frame while everything
   * else stayed inside.
   *
   * Measurement only: **nothing under `src/` consumes this**, no rule is
   * stated over it, and adding it changed no behaviour. It exists because the
   * shipped framing's binding safe-area constraint turned out to be a spear
   * tip rather than a fighter, and the human deciding how to answer that needs
   * the priced alternative rather than a description of it (Task 5 review,
   * fix round 1, analysis 1).
   *
   * Same mixed pose semantics as `fullBoundsPx` above -- bind-pose body,
   * live props.
   */
  boundsPxWithoutWeapon: Readonly<Record<CombatantId, ScreenBoundsPx>>
  /**
   * `fullBoundsPx` minus every slot the safe-area rule exempts as of the
   * 2026-09-05 amendment: `'weapon'` AND `'net'` (`SAFE_AREA_EXEMPT_SLOTS`) --
   * "long or thrown handheld props", the spear shaft, the trident and the
   * retiarius' net.
   *
   * Deliberately a SECOND field rather than a widening of
   * `boundsPxWithoutWeapon` above. That one is documented as "body + helmet +
   * shield" and `tests/combat-visuals.spec.ts` reads it as exactly that (the
   * hoplomachus' spear-overhang assertion, and a between-body-and-full
   * invariant on every rig); widening it in place would have moved a number
   * that test asserts on without the test being about this rule at all. The
   * retiarius is the only fighter for whom the two differ -- he is the only one
   * carrying a `'net'` -- so for everybody else this is
   * `boundsPxWithoutWeapon`'s twin.
   *
   * `tests/legibility.spec.ts` is the only consumer; nothing under `src/`
   * reads it, and adding it changed no behaviour.
   *
   * With the exempt props dropped this is almost entirely the bind-pose body
   * box (plus helmet and shield), so the 5 % safe-area inset the harness
   * asserts on it is a rule about the *standing* fighter -- see
   * `bodyHeightPx` above and spec §7.
   */
  boundsPxWithoutExemptProps: Readonly<Record<CombatantId, ScreenBoundsPx>>
  /**
   * Each rig's root (ground) point projected to canvas pixels -- the same
   * point `rootPositions` reports in world space, deliberately, so that
   * "screen separation / world separation" pairs two measurements of the
   * identical pair of points and reads as a pixels-per-world-unit scale.
   * A silhouette-box centre would fold each fighter's own vertical extent
   * into that ratio.
   */
  centerPx: Readonly<Record<CombatantId, ScreenPointPx>>
  /**
   * The drawing surface every `*Px` field above is measured in: the canvas's
   * own CSS size, which is markedly smaller than the viewport (the arena is
   * one cell of a page that also carries HP cards and a battle feed). The
   * safe area is an inset of *this*, never of the viewport.
   */
  canvasPx: { width: number; height: number }
}

/** Canvas-pixel bounds, top-left origin, `y` downward. */
export interface ScreenBoundsPx {
  minX: number
  maxX: number
  minY: number
  maxY: number
}

/** A canvas-pixel point, top-left origin, `y` downward. */
export interface ScreenPointPx {
  x: number
  y: number
}

/**
 * Which mesh slots (`userData.slot`, written into each `.glb` by the build
 * script as `extras.slot` -- see `fighterModelContract.MESH_SLOTS`) count
 * toward `ArenaDebugSnapshot.bodyHeightPx`: the man and what he wears.
 *
 * The three *held* slots (`HELD_EQUIPMENT_SLOTS` below) are absent on
 * purpose, and so is anything a later kit adds: an unrecognised slot counts
 * toward `fullBoundsPx` only. The safe direction for an unknown prop is that
 * it cannot inflate a body-size floor -- but silently *under*-reporting a
 * newly worn slot would understate the very number the scale floor is
 * asserted on, so `fighterModelContract.test.ts` asserts that this set and
 * `HELD_EQUIPMENT_SLOTS` together partition `MESH_SLOTS` exactly.
 *
 * Exported for that test only; nothing else outside this module reads it.
 */
export const BODY_SILHOUETTE_SLOTS: ReadonlySet<string> = new Set(['body', 'helmet'])

/**
 * The complement of `BODY_SILHOUETTE_SLOTS` over the slots the models really
 * emit: what a fighter *holds* rather than wears. These are what
 * `fullBoundsPx` adds on top of the body silhouette, and the reason
 * `bodyHeightPx` exists as a separate number at all.
 */
export const HELD_EQUIPMENT_SLOTS: ReadonlySet<string> = new Set(['weapon', 'shield', 'net'])

/** The held slot `boundsPxWithoutWeapon` drops: the gladius, spear and trident are all built under it. */
const LONG_HANDHELD_WEAPON_SLOT = 'weapon'

/**
 * The slots `boundsPxWithoutExemptProps` drops -- the safe-area rule's
 * exemption list as amended on 2026-09-05: a fighter may let a long or thrown
 * handheld prop leave frame, and the retiarius' net is one (it is held at
 * arm's length and thrown, exactly like the trident it is paired with), while
 * the murmillo's gladius is not exempt on its own account -- it is under
 * `'weapon'` but he is not a polearm carrier, and the harness applies this
 * list only to those.
 */
const SAFE_AREA_EXEMPT_SLOTS: ReadonlySet<string> = new Set([LONG_HANDHELD_WEAPON_SLOT, 'net'])

/**
 * The lower clamp is `FLAT_DISTANCE` itself, not a separate number.
 *
 * It was `11` until the readable-gladiator-types slice, and that was the whole
 * defect: `extentToDistance` maps the entire tactical band to `FLAT_DISTANCE`,
 * and any lower clamp above it would silently override the flat region and put
 * the close-quarters exchange straight back where it was. Tying the two
 * together means the clamp can never do that -- it can only ever bind above the
 * flat region, which is the eased side, where it is a genuine guard.
 */
const CAMERA_MIN_DISTANCE = FLAT_DISTANCE
const CAMERA_MAX_DISTANCE = 18

/**
 * Preserves the previous renderer's "stable elevated perspective" as a fixed
 * *angle* rather than a fixed height: the old camera sat at `(0, 8.8, 13)`
 * looking at the origin, an elevation/distance ratio of `8.8/13`. Framing
 * distance now varies (`CAMERA_MIN_DISTANCE..CAMERA_MAX_DISTANCE`, i.e.
 * 8.81..18 since the readable-gladiator-types slice, 11..18 before it);
 * re-deriving height from that same ratio
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
 * Anything checking rig geometry against the camera's pitch derives the angle
 * from this constant rather than keeping a second copy of it, so moving the
 * camera's pitch re-checks the rig.
 */
export const CAMERA_ELEVATION_RATIO = 8.8 / 13
/**
 * Exported for the same reason as `CAMERA_ELEVATION_RATIO` above: together the
 * two of them are the entire mapping from world size to on-screen pixels, and
 * a measurement harness that reports absolute pixel figures has to be able to
 * check its own output against them rather than against a second copy of the
 * numbers. Pixels per world unit at the look point is
 * `(canvasHeight/2)/tan(fov/2) / (distance * sqrt(1 + ratio^2))`, which
 * `scripts/measure-framing.ts` predicts per tick and compares against the
 * separation it actually measured.
 */
export const CAMERA_FOV_DEGREES = 38
const CAMERA_NEAR = 0.1
const CAMERA_FAR = 100

/** Clamp applied to real wall-clock elapsed time between `sync()` calls, so a backgrounded tab or a long test-driven `advanceTicks` burst can never hand the camera one huge damping step. */
const MAX_FRAME_DELTA_SECONDS = 0.1

/** Substep rate for `settleCameraSeconds` (dev-only): the simulation's own tick rate, so a settle of `n` seconds damps exactly like `n` seconds of `×1` playback rather than as one oversized step. */
const SETTLE_STEPS_PER_SECOND = 60

const TRAIL_MAX_POINTS = 6
const TRAIL_COLOR = 0xf4ead7

/** Presentation milliseconds per simulation tick. */
const MS_PER_TICK = 1000 / TICKS_PER_SECOND

/**
 * A pooled contact effect's kind: the three contact zones, each with its own
 * visual (blood spray, shield ring, weapon spark), plus `miss` -- the sand
 * puff on the ground where a swing that hit nothing ended
 * (`2026-09-17-feedback-design` spec §4.3, §5). One pool, four kinds.
 */
type FlashKind = ContactZone | 'miss'
const FLASH_KINDS: readonly FlashKind[] = ['body', 'shield', 'weapon', 'miss']
const FLASH_SLOTS_PER_KIND = 2

/**
 * Contact-effect lifetime per kind, in *presentation* milliseconds -- the
 * encounter's own tick rate scaled to ms, never the wall clock (see
 * `applyFrame`), so at x2/x4 an effect lives the same number of ticks instead
 * of the same number of seconds, which is what "expire before the next
 * exchange" (design.md) actually measures. The ring and the spark keep their
 * 260 ms; the spray holds 420 ms (25.2 ticks) -- deliberately longer than the
 * fastest attack's 22-tick repeat, so one attacker landing twice overlaps his
 * own sprays by ~3 ticks, which the second slot absorbs (feedback spec §4.2).
 * The puff lives 220 ms (13 ticks); a miss cannot repeat faster than the
 * fastest attack either, so two slots cover it too (§5.3).
 */
const FLASH_DURATION_MS: Readonly<Record<FlashKind, number>> = { body: 420, shield: 260, weapon: 260, miss: 220 }
/** Peak opacity of the ring and the spark, which fade linearly from the first frame. */
const FLASH_PEAK_OPACITY = 0.85

/** design.md: "plus an authored height" -- presentation-only per-zone contact height, distinct from (and never derived from) any rig anchor's own rest-pose height. */
const CONTACT_ZONE_HEIGHT: Readonly<Record<ContactZone, number>> = { body: 1.05, shield: 1.22, weapon: 1.30 }
/** The puff sits on the floor, just above it so it never z-fights the arena plane (feedback spec §5.2). */
const MISS_PUFF_HEIGHT = 0.03
/** Height each effect kind spawns at: the three contact zones' authored heights, and the floor for the puff. */
const FLASH_HEIGHT: Readonly<Record<FlashKind, number>> = { ...CONTACT_ZONE_HEIGHT, miss: MISS_PUFF_HEIGHT }
/** Dark arterial red for the spray, HUD gold for the ring, white for the spark, dry sand (lighter than the floor's 0x8a6845) for the puff: the four kinds differ in shape *and* colour. */
const FLASH_COLOR: Readonly<Record<FlashKind, number>> = { body: 0x8e1b21, shield: 0xe8c876, weapon: 0xe7ecf5, miss: 0xd9c29a }

// Sand puff (feedback spec §5). `attack-missed`/`attack-evaded` carry no
// contact point, so the puff is placed from state: along the attacker's line
// to his target, at the horizontal distance his weapon reaches on the strike
// frame -- never further than the target himself, and never so close it sits
// under the attacker's own feet.
/** Peak opacity of the puff, which fades linearly from the first frame. */
const MISS_PUFF_PEAK_OPACITY = 0.7
/** How much the puff grows over its life: uniform scale 1 -> 2.4 (0.16 -> 0.38 outer radius, about 12 -> 29 px). */
const MISS_PUFF_GROWTH = 1.4
/** Subtracted from the root-to-root distance so the puff lands in front of the target rather than under him. */
const MISS_REACH_TARGET_MARGIN = 0.25
/** Floor on the puff's distance from the attacker: closer than this and it reads as his own footfall. */
const MISS_REACH_MIN = 0.6
/**
 * The horizontal distance from the root at which each archetype's
 * `weaponTip` sits on the strike frame of its attack clips, in world units
 * (feedback spec §5.2): an authored presentation table, the same discipline
 * as `CONTACT_ZONE_HEIGHT`, and the ceiling on how far from the attacker a
 * puff can be placed.
 *
 * Measured 2026-09-17 on the shipped `.glb`s, in the browser, at the seed
 * 20260815 bouts: a throwaway Playwright spec stepped bout 0 of the
 * `brutus`, `nerva` and `aquila` lineups and bout 1 of the `brutus/aquila/
 * nerva` lineup one tick at a time, and on every tick that opened an
 * attack's `contact` phase (the strike frame: `clipMapping.attackTime` puts
 * the clip at exactly `contactAt` there) rendered at alpha 0 and read
 * `hypot(weaponTip.world - root.world)` off the rig through a temporary
 * debug-snapshot field, keeping only ticks whose rendered clip was the
 * attack's own (an attacker staggered on his own contact tick plays `Hit_A`
 * instead). Every attack measured the same figure on every sample:
 *
 *   heavy-shield-jab 1.466 (n=10), heavy-cleave 0.625 (n=7);
 *   fast-slash 1.251 (n=22), fast-burst-lunge 2.135 (n=26);
 *   technical-thrust 2.500 (n=20), technical-driving-thrust 2.065 (n=11),
 *   technical-parry-counter 2.541 (n=3).
 *
 * Per-archetype median across the archetype's attacks, rounded to 0.05:
 * heavy 1.046 -> 1.05, fast 1.693 -> 1.70, technical 2.500 -> 2.50. The
 * spec's starting values were { heavy: 1.15, fast: 1.85, technical: 1.75 };
 * fast and technical were outside its 0.10 tolerance, so the measured
 * figures are what ships. The heavy figure is low because the cleave's
 * strike frame is an overhead chop with the tip high rather than far.
 */
const MISS_REACH: Readonly<Record<Archetype, number>> = { heavy: 1.05, fast: 1.7, technical: 2.5 }

// Blood spray (feedback spec §4). Seven droplets authored in local space
// along +Z, the spray axis; `spawn` orients that axis along the blow.
const SPRAY_DROPLETS: readonly { x: number; y: number; z: number; radius: number }[] = [
  { x: 0, y: 0, z: 0.06, radius: 0.07 },
  { x: 0.05, y: 0.03, z: 0.18, radius: 0.055 },
  { x: -0.06, y: -0.02, z: 0.22, radius: 0.05 },
  { x: 0.02, y: 0.07, z: 0.31, radius: 0.045 },
  { x: -0.03, y: -0.06, z: 0.36, radius: 0.045 },
  { x: 0.08, y: 0.01, z: 0.44, radius: 0.04 },
  { x: -0.05, y: 0.05, z: 0.52, radius: 0.038 },
]
const SPRAY_PEAK_OPACITY = 0.92
/** Fraction of the spray's life it holds at peak opacity before fading -- the hold is what makes it read as a thing that happened rather than a flicker. */
const SPRAY_HOLD_FRACTION = 0.45
/** Scale along the spray axis at age 0; it shoots out to 1.0 in the first ~120 ms. */
const SPRAY_INITIAL_LENGTH_SCALE = 0.45
/** World units the spray drops by the end of its life (gravity). */
const SPRAY_DROP_UNITS = 0.22
/** Base scale of a spray whose batch carried a `critical-hit` for the same action instance. */
const SPRAY_CRITICAL_SCALE = 1.4
/** Spray direction when attacker and victim coincide: world +Z. */
const SPRAY_FALLBACK_DIRECTION: Readonly<Vec2> = { x: 0, z: 1 }

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
 * Everything a projection to canvas pixels needs: the live perspective camera
 * and the canvas's own CSS size. Shared by the per-frame damage-number
 * placement and the dev-only pixel measurements below.
 */
interface ProjectionContext {
  camera: THREE.PerspectiveCamera
  widthPx: number
  heightPx: number
}

/** Scratch vectors, module-level so a per-frame placement or a per-tick measurement run allocates nothing. */
const PROJECTED_POINT = new THREE.Vector3()
const NUMBER_ANCHOR = new THREE.Vector3()

/**
 * A world point in canvas pixels, top-left origin, `y` downward. A pure
 * function of the camera and the canvas size, so it is also the overlay's
 * coordinate system: `.arena__numbers` is `inset: 0` over a canvas that
 * fills the same box.
 *
 * Points behind the camera would project through the perspective divide with
 * a negative `w` and come back mirrored. Nothing projected here can be behind
 * it -- the camera always sits `CAMERA_MIN_DISTANCE..CAMERA_MAX_DISTANCE`
 * (8.81..18) units back from the look target it is
 * pointed at, and everything projected is a fighter, or a contact point on
 * one, inside a `7.7`-radius arena floor -- so this deliberately carries no
 * guard that would silently substitute a fake number for a real geometry bug.
 */
function projectToCanvasPx(point: THREE.Vector3, projection: ProjectionContext): ScreenPointPx {
  PROJECTED_POINT.copy(point).project(projection.camera)
  return {
    x: (PROJECTED_POINT.x * 0.5 + 0.5) * projection.widthPx,
    y: (0.5 - PROJECTED_POINT.y * 0.5) * projection.heightPx,
  }
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
 * reachable from it. Used by `sync()` (below), **in dev and test builds
 * only**, to freeze exactly `BattleRenderFrame`'s `previous`/`current`/
 * `events` before this module ever reads them -- proving this renderer, which
 * reads simulation state deeply every frame (pose sampling, contact
 * targeting, camera framing), never accidentally writes back into it.
 * Deliberately never applied to `this.rigs`, the scene or the camera -- those
 * are legitimately mutated every frame, and freezing them would break the
 * render loop.
 *
 * "Everything reachable" is meant literally, and it is why the call sites are
 * gated: a `BattleState` reaches simulation-owned module singletons by
 * reference rather than by copy (see `sync()`).
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

/**
 * The seven droplets of `SPRAY_DROPLETS`, each a low-poly sphere translated
 * into place and merged into ONE geometry shared by the spray slots (0.55
 * units along +Z, 0.16 across -- about 41 px long at the shipped 75 px/unit).
 * `mergeGeometries` is the real jsm helper, not a hand-rolled copy:
 * `stateHash.test.ts` mocks only the bare `three` module, so this import
 * stays real there.
 */
function buildBloodSprayGeometry(): THREE.BufferGeometry {
  const droplets = SPRAY_DROPLETS.map(({ x, y, z, radius }) => new THREE.SphereGeometry(radius, 5, 4).translate(x, y, z))
  const merged = mergeGeometries(droplets)
  for (const droplet of droplets) droplet.dispose()
  if (!merged) throw new Error('blood spray droplets did not merge into one geometry')
  return merged
}

function buildContactFlashGeometry(kind: FlashKind): THREE.BufferGeometry {
  switch (kind) {
    case 'body':
      return buildBloodSprayGeometry()
    case 'shield':
      return new THREE.RingGeometry(0.09, 0.19, 16)
    case 'weapon':
      return new THREE.OctahedronGeometry(0.13, 0)
    case 'miss':
      return new THREE.RingGeometry(0.06, 0.16, 12)
  }
}

// ---------------------------------------------------------------------------
// Contact effects: a small bounded pool (two meshes per kind, round-robin),
// never a standalone particle system. `body`/`shield`/`weapon` are
// distinguished by mesh geometry (and color), never by color alone
// (design.md). Each kind has its own life and its own per-frame look
// (`animateFlash`); the spray additionally has a direction and a base scale.
// ---------------------------------------------------------------------------

interface FlashSlot {
  mesh: THREE.Mesh
  material: THREE.MeshBasicMaterial
  spawnedAtPresentationMs: number
  id: string
  /** Uniform base scale set at spawn (1, or `SPRAY_CRITICAL_SCALE` for a critical spray); the spray's axis scale multiplies it. */
  scaleBase: number
}

interface FlashSpawnOptions {
  /** Horizontal direction the spray points along (from the attacker through the victim). Only the `body` kind reads it. */
  direction?: Readonly<Vec2>
  /** Base scale of the mesh; defaults to 1. */
  scaleBase?: number
}

/**
 * The per-frame look of one live effect at `t` = age / life, 0..1, by kind
 * (feedback spec §4.2 for the spray). The ring and the spark fade linearly
 * from their peak, exactly as before; the spray shoots out along its axis
 * in the first ~120 ms and holds its length, drops 0.22 units under
 * gravity by the end, and holds full opacity for the first 45 % of its life
 * before fading. The puff grows outward on the floor with the same ease-out
 * the spray shoots with, fading from the first frame (§5.3).
 */
function animateFlash(kind: FlashKind, slot: FlashSlot, t: number): void {
  switch (kind) {
    case 'body': {
      const shoot = 1 - (1 - t) * (1 - t)
      const lengthScale = SPRAY_INITIAL_LENGTH_SCALE + (1 - SPRAY_INITIAL_LENGTH_SCALE) * shoot
      slot.mesh.scale.set(slot.scaleBase, slot.scaleBase, slot.scaleBase * lengthScale)
      slot.mesh.position.y = CONTACT_ZONE_HEIGHT.body - SPRAY_DROP_UNITS * t * t
      slot.material.opacity = t < SPRAY_HOLD_FRACTION ? SPRAY_PEAK_OPACITY : (SPRAY_PEAK_OPACITY * (1 - t)) / (1 - SPRAY_HOLD_FRACTION)
      break
    }
    case 'shield':
    case 'weapon':
      slot.material.opacity = FLASH_PEAK_OPACITY * (1 - t)
      break
    case 'miss': {
      const spread = 1 + MISS_PUFF_GROWTH * (1 - (1 - t) * (1 - t))
      slot.mesh.scale.set(spread, spread, spread)
      slot.material.opacity = MISS_PUFF_PEAK_OPACITY * (1 - t)
      break
    }
  }
}

class ContactFlashEffects {
  private readonly geometries: THREE.BufferGeometry[] = []
  private readonly slotsByKind: Record<FlashKind, FlashSlot[]>
  private readonly roundRobin: Record<FlashKind, number> = { body: 0, shield: 0, weapon: 0, miss: 0 }
  private nextSerial = 0

  constructor(scene: THREE.Scene) {
    this.slotsByKind = { body: [], shield: [], weapon: [], miss: [] }
    for (const kind of FLASH_KINDS) {
      const geometry = buildContactFlashGeometry(kind)
      this.geometries.push(geometry)
      for (let i = 0; i < FLASH_SLOTS_PER_KIND; i += 1) {
        const material = new THREE.MeshBasicMaterial({
          color: FLASH_COLOR[kind],
          transparent: true,
          opacity: 0,
          side: THREE.DoubleSide,
          depthWrite: false,
        })
        const mesh = new THREE.Mesh(geometry, material)
        mesh.visible = false
        mesh.frustumCulled = false
        // The puff lies flat on the floor; `spawn` never rotates it (only the spray is turned, by `lookAt`).
        if (kind === 'miss') mesh.rotation.x = -Math.PI / 2
        scene.add(mesh)
        this.slotsByKind[kind].push({ mesh, material, spawnedAtPresentationMs: 0, id: '', scaleBase: 1 })
      }
    }
  }

  /**
   * Takes the kind's next round-robin slot and shows it at age 0. The spray's
   * +Z axis is pointed along `options.direction` -- away from the attacker,
   * through the victim, the way the blow travelled -- with `lookAt` from the
   * contact point; the ring and the spark are never rotated.
   */
  spawn(kind: FlashKind, point: Readonly<Vec2>, presentationMs: number, options: FlashSpawnOptions = {}): void {
    const slots = this.slotsByKind[kind]
    const index = this.roundRobin[kind] % slots.length
    this.roundRobin[kind] += 1
    const slot = slots[index]
    const height = FLASH_HEIGHT[kind]
    slot.mesh.position.set(point.x, height, point.z)
    if (kind === 'body') {
      const direction = options.direction ?? SPRAY_FALLBACK_DIRECTION
      slot.mesh.lookAt(point.x + direction.x, height, point.z + direction.z)
    }
    slot.scaleBase = options.scaleBase ?? 1
    slot.mesh.visible = true
    slot.spawnedAtPresentationMs = presentationMs
    slot.id = `${kind}-${this.nextSerial}`
    this.nextSerial += 1
    animateFlash(kind, slot, 0)
  }

  /** Animates each active effect by its own kind's life and, once past it, hides it -- "expire before the next exchange" (design.md). */
  update(presentationMs: number): void {
    for (const kind of FLASH_KINDS) {
      const life = FLASH_DURATION_MS[kind]
      for (const slot of this.slotsByKind[kind]) {
        if (!slot.mesh.visible) continue
        const age = presentationMs - slot.spawnedAtPresentationMs
        if (age >= life) {
          slot.mesh.visible = false
          continue
        }
        animateFlash(kind, slot, clamp01(age / life))
      }
    }
  }

  /** Hides every effect immediately -- used by bout start/rematch (brief resolution #11), never by ordinary fade-out. */
  clear(): void {
    for (const kind of FLASH_KINDS) {
      for (const slot of this.slotsByKind[kind]) slot.mesh.visible = false
    }
  }

  activeEffectIds(): string[] {
    const ids: string[] = []
    for (const kind of FLASH_KINDS) {
      for (const slot of this.slotsByKind[kind]) if (slot.mesh.visible) ids.push(slot.id)
    }
    return ids
  }

  dispose(scene: THREE.Scene): void {
    for (const kind of FLASH_KINDS) {
      for (const slot of this.slotsByKind[kind]) {
        scene.remove(slot.mesh)
        slot.material.dispose()
      }
    }
    for (const geometry of this.geometries) geometry.dispose()
  }
}

/**
 * The direction a blow travelled -- from the attacker through the victim --
 * read off the frame's own state for the event's two combatants (feedback
 * spec §4.1: presentation re-derives no rule; this is a subtraction of two
 * simulation positions and nothing more). World +Z when the two coincide.
 */
function blowDirection(current: BattleState, actorId: CombatantId, targetId: CombatantId): Vec2 {
  const actor = current.encounter.combatants[actorId] as FighterCombatState | undefined
  const target = current.encounter.combatants[targetId] as FighterCombatState | undefined
  if (!actor || !target) return { ...SPRAY_FALLBACK_DIRECTION }
  const dx = target.position.x - actor.position.x
  const dz = target.position.z - actor.position.z
  const length = Math.hypot(dx, dz)
  if (length <= 1e-9) return { ...SPRAY_FALLBACK_DIRECTION }
  return { x: dx / length, z: dz / length }
}

/**
 * Where a swing that hit nothing ended (feedback spec §5.2): along the
 * attacker's line to his target, `clamp(distance - 0.25, 0.6, MISS_REACH[archetype])`
 * out from his root -- the weapon's own reach on the strike frame, capped so
 * the puff never lands under the target, floored so it never lands under the
 * attacker. Read from the frame's state, which is the tick the batch was
 * flushed on rather than the event's own tick (the accepted approximation of
 * §5.2: a miss carries no contact point, and presentation keeps no position
 * history). World +Z from the attacker when the two coincide; the floor
 * distance ahead of him when the target is missing; the origin when the
 * attacker himself is (the event always names a live combatant, so neither
 * fallback is reachable from the kernel).
 */
function missPoint(current: BattleState, actorId: CombatantId, targetId: CombatantId): Vec2 {
  const actor = current.encounter.combatants[actorId] as FighterCombatState | undefined
  const target = current.encounter.combatants[targetId] as FighterCombatState | undefined
  if (!actor) return { x: 0, z: 0 }
  const towardTarget = blowDirection(current, actorId, targetId)
  const distance = target ? Math.hypot(target.position.x - actor.position.x, target.position.z - actor.position.z) : 0
  const reach = Math.min(Math.max(distance - MISS_REACH_TARGET_MARGIN, MISS_REACH_MIN), MISS_REACH[actor.definition.archetype])
  return { x: actor.position.x + towardTarget.x * reach, z: actor.position.z + towardTarget.z * reach }
}

// ---------------------------------------------------------------------------
// Per-fighter rig bookkeeping
// ---------------------------------------------------------------------------

interface FighterRig {
  fighter: SkinnedFighter
  animator: FighterAnimator
  /** Tick of the `fighter-staggered` event that opened the current stagger; cleared with the rig on every new bout. */
  staggerStartTick?: number
  /** Tick of the `fighter-defeated` event. */
  defeatedAtTick?: number
  /**
   * The last `ClipSelection` actually handed to `animator.apply` for this rig
   * (final-review fix I1) -- the debug snapshot's `activeClip` is read from
   * here. `undefined` until the rig's first rendered frame.
   */
  lastSelection?: ClipSelection
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
   * `undefined` only when construction itself failed -- either no WebGL
   * context could be created at all (final-review fix #2) or the fighter
   * models did not load (this slice). Every other field below is still built
   * normally in that case (they need no live GL context to construct), so
   * `contextLost` is the single source of truth for whether rendering is
   * possible; `this.renderer` and `this.contextLost` are always set together,
   * so every read site below that is already guarded by `!this.contextLost`
   * (or returns early on it) can safely non-null-assert. Not `readonly`: the
   * models-failed branch in the constructor clears it after the renderer was
   * already built.
   */
  private renderer: THREE.WebGLRenderer | undefined
  private readonly scene = new THREE.Scene()
  private readonly perspectiveCamera = new THREE.PerspectiveCamera(CAMERA_FOV_DEGREES, 1, CAMERA_NEAR, CAMERA_FAR)
  private readonly arenaCamera: ArenaCamera
  private readonly flashes: ContactFlashEffects
  /**
   * The damage-number pool (feedback spec §6). Entries-only until the
   * constructor binds it to the overlay, which it does only when the canvas
   * has a parent -- `stateHash.test.ts` constructs this view in plain Node
   * with neither a `parentElement` nor a `document`, and on that path no
   * `document.*` call may be made.
   */
  private readonly numbers = new DamageNumberPool()
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

  constructor(private readonly canvas: HTMLCanvasElement, private readonly models: FighterModelSet | null) {
    this.arenaCamera = new ArenaCamera({ minDistance: CAMERA_MIN_DISTANCE, maxDistance: CAMERA_MAX_DISTANCE })
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
    if (!this.models && !this.contextLost) {
      // Models failed to load: same readable fallback as "no WebGL", the season keeps running.
      this.renderer?.dispose()
      this.renderer = undefined
      this.contextLost = true
    }
    this.scene.background = new THREE.Color(0x16131a)
    this.scene.fog = new THREE.Fog(0x16131a, 14, 24)

    this.flashes = new ContactFlashEffects(this.scene)
    // The overlay goes directly after the canvas -- before the status heading
    // `index.html` places after it, so a rising digit paints beneath the
    // heading's text -- and only when the canvas has a parent (see `numbers`).
    if (canvas.parentElement) this.numbers.attach(canvas.parentElement, canvas)
    this.buildArena()
    this.applyCameraTransform(this.arenaCamera.state)

    this.observer = new ResizeObserver(() => this.resize())
    this.observer.observe(canvas.parentElement ?? canvas)
    this.resize()

    this.canvas.addEventListener('webglcontextlost', this.handleContextLost, false)

    if (this.contextLost) {
      // The same state `handleContextLost` produces: a dead arena keeps no overlay.
      this.numbers.dispose()
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
        // A direct render outside `applyFrame`: the numbers follow the camera
        // that was just drawn, at the frame's own tick (no time has passed).
        this.placeDamageNumbers(this.lastFrame.current.encounter.tick * MS_PER_TICK, this.isReducedMotion())
      }
      this.getDebugSnapshot = (): ArenaDebugSnapshot =>
        buildArenaDebugSnapshot(this.rigs, this.flashes, this.numbers, this.arenaCamera.state, this.eventCursor, {
          camera: this.perspectiveCamera,
          // The canvas's CSS size, not the drawing-buffer size: `resize()`
          // hands the renderer exactly these numbers with `updateStyle:
          // false`, and a device-pixel-ratio-scaled buffer would make every
          // measured pixel figure depend on the reviewer's monitor.
          widthPx: this.canvas.clientWidth,
          heightPx: this.canvas.clientHeight,
        })
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
    this.numbers.clear()

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
    this.numbers.clear()
    for (const rig of this.rigs.values()) this.disposeRig(rig)
    this.rigs.clear()
  }

  dispose(): void {
    this.observer.disconnect()
    this.canvas.removeEventListener('webglcontextlost', this.handleContextLost)
    for (const rig of this.rigs.values()) this.disposeRig(rig)
    this.rigs.clear()
    this.flashes.dispose(this.scene)
    this.numbers.dispose()
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
   *
   * `cameraDeltaSeconds` (dev-only, set by `main.ts`'s
   * `stepBattleAndCamera`) replaces that wall clock outright with an exact
   * figure, and overrides `advanceCameraTime`. It is what makes a per-tick
   * measurement trace mean anything: the camera's damping is wall-clock, so
   * a harness that ran N ticks and then rendered would attribute one
   * render's worth of real elapsed time to N ticks of motion. With a fixed
   * `1/60` it damps exactly as `x1` playback does, one tick at a time.
   */
  sync(frame: BattleRenderFrame, options?: { advanceCameraTime?: boolean; cameraDeltaSeconds?: number }): void {
    // Freeze before `applyFrame` -- including before its own `contextLost`
    // early return -- so the invariant holds even on a session where no
    // WebGL context exists to render into at all, not only on the normal
    // path `stateHash.test.ts`'s freeze proof actually exercises.
    //
    // DEV AND TEST BUILDS ONLY, as the design spec specifies. `vite build`
    // replaces `import.meta.env.DEV` with `false`, so this block is
    // dead-code-eliminated from a player's bundle. Two independent reasons,
    // and the first is the load-bearing one:
    //
    //  - REACH. `deepFreeze` recurses everything reachable, and a
    //    `BattleState` reaches simulation-owned module singletons BY
    //    REFERENCE, not by copy: `encounter.combatStyles` *is* the
    //    `COMBAT_STYLES` catalog object (`simulation/encounter.ts`), and every
    //    combatant's `definition` *is* the module-level `FighterDefinition`
    //    from `content/mvpSeries.ts`/`content/season.ts` -- `createBattle`
    //    clones neither. Ungated, this presentation-only module would impose
    //    permanent runtime immutability, in the shipped client, on exactly the
    //    content modules this slice's own allowlist forbids it to edit.
    //    Nothing mutates them today, so nothing observable changes -- but a
    //    later slice that does (progression, injuries, equipment: all named as
    //    future work in the design spec's non-goals) would throw a `TypeError`
    //    inside the live render loop, and `main.ts` latches an unrecoverable
    //    render error into `presentationDisabled`: a silently blank arena.
    //  - COST. It is an O(events) walk on every production frame, for a check
    //    that can only ever tell a developer something.
    //
    // The proof this gate could hollow out is `stateHash.test.ts`'s freeze
    // test; it runs under Vitest, where `import.meta.env.DEV` is `true`, and
    // asserts that outright before touching `sync()` so it cannot quietly
    // start testing nothing.
    if (import.meta.env.DEV) {
      deepFreeze(frame.previous)
      deepFreeze(frame.current)
      deepFreeze(frame.events)
    }
    this.applyFrame(frame, {
      advanceCameraTime: options?.advanceCameraTime ?? true,
      cameraDeltaSeconds: options?.cameraDeltaSeconds,
    })
  }

  private applyFrame(frame: BattleRenderFrame, options: { advanceCameraTime: boolean; cameraDeltaSeconds?: number }): void {
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
    this.processNewEvents(events, current, reducedMotion, presentationMs)

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

      const selection = selectClip({
        archetype: currState.definition.archetype,
        state: currState,
        tick: current.encounter.tick,
        alpha,
        staggerStartTick: rig.staggerStartTick,
        defeatedAtTick: rig.defeatedAtTick,
        durations: rig.animator.durations,
      })
      rig.animator.apply(selection)
      // Recorded only once `apply` has returned, so the snapshot can never
      // report a clip the animator rejected (it throws on an unknown name).
      rig.lastSelection = selection
      rig.fighter.root.updateMatrixWorld(true)

      this.updateWeaponTrail(rig, selection.weaponTrailActive && !reducedMotion)

      framingTargets.push({ id, centerX: position.x, centerZ: position.z, radius: rig.fighter.horizontalEquipmentRadius })
    }

    const elapsedSeconds = this.consumeCameraDelta(nowMs, options.advanceCameraTime, options.cameraDeltaSeconds)
    const cameraState = this.arenaCamera.update(framingTargets, elapsedSeconds)
    this.applyCameraTransform(cameraState)

    this.flashes.update(presentationMs)
    // Non-null: this method returns early on `this.contextLost` above, and
    // `this.renderer`/`this.contextLost` are always set together (see the
    // field's own doc comment).
    this.renderer!.render(this.scene, this.perspectiveCamera)
    // After the render, so the camera's matrices are the ones just drawn.
    this.placeDamageNumbers(presentationMs, reducedMotion)

    if (this.activeBoutIndex !== undefined) this.canvas.dataset.activeBoutIndex = String(this.activeBoutIndex)
    this.canvas.dataset.lastEventId = String(this.eventCursor)
    this.canvas.dataset.renderedCombatants = String(this.rigs.size)
  }

  /**
   * Ages the damage numbers on the encounter clock and places each live one
   * over its contact point through the camera just rendered (feedback spec
   * §6.3): `(worldX, DAMAGE_NUMBER_HEIGHT, worldZ)` projected to canvas
   * pixels, which are the overlay's own pixels. Runs after every direct
   * `renderer.render` -- `applyFrame` and the dev-only `settleCameraSeconds`.
   */
  private placeDamageNumbers(presentationMs: number, reducedMotion: boolean): void {
    const projection: ProjectionContext = {
      camera: this.perspectiveCamera,
      widthPx: this.canvas.clientWidth,
      heightPx: this.canvas.clientHeight,
    }
    this.numbers.update(presentationMs, reducedMotion, {
      project: (x, y, z) => projectToCanvasPx(NUMBER_ANCHOR.set(x, y, z), projection),
    })
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
   *
   * `criticalInstanceIds` is its sibling for `critical-hit`, which the
   * kernel likewise emits immediately before its `damage-dealt` on the same
   * tick: the paired spray gets the larger base scale. `current` is the
   * frame's state, read only for the two combatants' positions so the spray
   * can point the way the blow travelled (feedback spec §4.1).
   *
   * Every `damage-dealt` also spawns a damage number -- blocked chip damage
   * included, in its own `shield` style -- and does so under reduced motion
   * too, because the number is the reduced-motion hit channel (§6.4). Its
   * kind is read off the same two batch-local sets; nothing is re-derived.
   */
  private processNewEvents(events: readonly EncounterEvent[], current: BattleState, reducedMotion: boolean, presentationMs: number): void {
    const blockedInstanceIds = new Set<string>()
    const criticalInstanceIds = new Set<string>()

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
        case 'attack-missed':
        case 'attack-evaded':
          // Steel through air, from the attacker's side, whatever the reason:
          // a sand puff where the swing ended (feedback spec §5).
          if (!reducedMotion) this.flashes.spawn('miss', missPoint(current, event.actorId, event.targetId), presentationMs)
          break
        case 'critical-hit':
          criticalInstanceIds.add(event.actionInstanceId)
          break
        case 'damage-dealt': {
          const blocked = blockedInstanceIds.has(event.actionInstanceId)
          const critical = criticalInstanceIds.has(event.actionInstanceId)
          if (!reducedMotion && !blocked) {
            this.flashes.spawn(event.contactZone, event.contactPoint, presentationMs, {
              direction: blowDirection(current, event.actorId, event.targetId),
              scaleBase: critical ? SPRAY_CRITICAL_SCALE : 1,
            })
          }
          this.numbers.spawn(event, classifyDamage(event, blocked, critical), presentationMs)
          break
        }
        case 'fighter-staggered': {
          const rig = this.rigs.get(event.combatantId)
          if (rig) rig.staggerStartTick = event.tick
          break
        }
        case 'fighter-defeated': {
          const rig = this.rigs.get(event.defeatedId)
          if (rig) rig.defeatedAtTick = event.tick
          break
        }
        default:
          break
      }
    }
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

  private consumeCameraDelta(nowMs: number, advance: boolean, fixedSeconds?: number): number {
    // An explicit delta is a deliberate figure, not a wall-clock reading, so
    // it is neither clamped by `MAX_FRAME_DELTA_SECONDS` (which exists to
    // absorb backgrounded-tab spikes) nor gated by `advance`. The wall clock
    // is still re-baselined to now, so whichever real frame runs next
    // measures from here rather than charging the camera for however long the
    // fixed-step run took.
    if (fixedSeconds !== undefined) {
      this.lastCameraTimeMs = nowMs
      return fixedSeconds
    }
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

    // Both callers (`startBout`, `applyFrame`) already return early on
    // `contextLost`, and a null `models` set forces `contextLost` in the
    // constructor -- so this can only be reached with models present. Kept as
    // an explicit guard rather than a non-null assertion because
    // `createSkinnedFighter` is the one call here that would fail loudly.
    if (!this.models) return
    for (const id of ids) {
      if (this.rigs.has(id)) continue
      const archetype = combatants[id].definition.archetype
      const fighter = createSkinnedFighter(this.models, archetype)
      this.scene.add(fighter.root)
      const trail = createTrail()
      this.scene.add(trail.line)
      this.rigs.set(id, {
        fighter,
        animator: new FighterAnimator(fighter.root, fighter.clips),
        trailGeometry: trail.geometry,
        trailMaterial: trail.material,
        trailLine: trail.line,
        trailPoints: [],
      })
    }
  }

  private disposeRig(rig: FighterRig): void {
    this.scene.remove(rig.fighter.root)
    rig.animator.dispose()
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
    // Removed, not hidden: a dead arena must not keep floating numbers.
    this.numbers.dispose()
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

/** Scratch vector, module-level so a per-tick measurement run allocates nothing. `projectToCanvasPx` and `ProjectionContext` live with the shared helpers above. */
const MEASURED_CORNER = new THREE.Vector3()

interface MutableBoundsPx {
  minX: number
  maxX: number
  minY: number
  maxY: number
}

function emptyBounds(): MutableBoundsPx {
  return { minX: Infinity, maxX: -Infinity, minY: Infinity, maxY: -Infinity }
}

/**
 * Expands `bounds` over every mesh under `root` whose slot `includesSlot`
 * accepts, by projecting the eight corners of that mesh's own *geometry*
 * bounding box through its world matrix.
 *
 * The geometry box rather than a world-space `Box3`: a world AABB of a
 * rotated mesh (every limb, and the whole weapon assembly, is rotated) is
 * strictly larger than the mesh, and the safe-area question is whether the
 * drawn thing leaves the frame, not whether a box around it would. The eight
 * projected corners still bound the drawn mesh, because a perspective
 * projection maps the convex hull of the box into the convex hull of the
 * projected corners for any box entirely in front of the camera.
 *
 * For a `SkinnedMesh` this measures the BIND POSE, scaled by the `Rig` node
 * the loaded scene puts the body meshes under, rather than the drawn pose --
 * see `ArenaDebugSnapshot.bodyHeightPx` for the full account and for why it
 * is left that way. Rigid bone-parented props (weapons, shields, net, helmet)
 * are plain `Mesh`es under a `Bone` and do track the drawn pose exactly.
 */
function accumulateProjectedBounds(
  root: THREE.Object3D,
  projection: ProjectionContext,
  includesSlot: (slot: string) => boolean,
  bounds: MutableBoundsPx,
): void {
  root.traverse((object) => {
    const mesh = object as THREE.Mesh
    if (!mesh.isMesh) return
    const slot = mesh.userData.slot
    if (typeof slot !== 'string' || !includesSlot(slot)) return
    const geometry = mesh.geometry
    if (!geometry.boundingBox) geometry.computeBoundingBox()
    const box = geometry.boundingBox
    if (!box) return
    for (const x of [box.min.x, box.max.x]) {
      for (const y of [box.min.y, box.max.y]) {
        for (const z of [box.min.z, box.max.z]) {
          MEASURED_CORNER.set(x, y, z).applyMatrix4(mesh.matrixWorld)
          const point = projectToCanvasPx(MEASURED_CORNER, projection)
          bounds.minX = Math.min(bounds.minX, point.x)
          bounds.maxX = Math.max(bounds.maxX, point.x)
          bounds.minY = Math.min(bounds.minY, point.y)
          bounds.maxY = Math.max(bounds.maxY, point.y)
        }
      }
    }
  })
}

function buildArenaDebugSnapshot(
  rigs: ReadonlyMap<CombatantId, FighterRig>,
  flashes: ContactFlashEffects,
  numbers: DamageNumberPool,
  cameraState: ArenaCameraState,
  eventCursor: number,
  projection: ProjectionContext,
): ArenaDebugSnapshot {
  const rootPositions: Record<CombatantId, Vec2> = {}
  const rootYaw: Record<CombatantId, number> = {}
  const jointRotations: Record<CombatantId, Record<FighterBoneName, readonly [number, number, number]>> = {}
  const activeClip: Record<CombatantId, { clip: string; time: number }> = {}
  const trailPointCounts: Record<CombatantId, number> = {}
  const bodyHeightPx: Record<CombatantId, number> = {}
  const fullBoundsPx: Record<CombatantId, ScreenBoundsPx> = {}
  const boundsPxWithoutWeapon: Record<CombatantId, ScreenBoundsPx> = {}
  const boundsPxWithoutExemptProps: Record<CombatantId, ScreenBoundsPx> = {}
  const centerPx: Record<CombatantId, ScreenPointPx> = {}
  const framingTargets: HorizontalFramingTarget[] = []
  let jointTransformsFinite = true

  // What `WebGLRenderer.render` does before it projects anything. Repeated
  // here so a snapshot read outside a render (or after a camera transform
  // that has not been rendered yet) still measures the camera's current
  // transform rather than the previous frame's.
  projection.camera.updateMatrixWorld()
  projection.camera.matrixWorldInverse.copy(projection.camera.matrixWorld).invert()

  for (const [id, rig] of rigs) {
    rootPositions[id] = { x: rig.fighter.root.position.x, z: rig.fighter.root.position.z }
    // Deliberately NOT `rig.fighter.root.rotation.y` -- three.js's Euler is
    // one of two equally valid decompositions of the same rotation for a
    // pure-yaw quaternion (`(0, yaw, 0)` or the "flipped" `(pi, pi-yaw,
    // pi)`), and which one `.rotation` reads back as is not stable across a
    // quaternion round-trip. Any code path that writes the wrapper's
    // quaternion and restores it (the procedural rig's weapon-arm IK step
    // used to do exactly that every tick a fighter had a live contact
    // target) restores the quaternion's *value* exactly, but three.js does
    // not guarantee `.rotation` re-derives the same Euler triple it started
    // from, only an equivalent one -- so `.rotation.y` can read the other,
    // "flipped" decomposition, whose `y` differs from the original yaw by up
    // to pi. This was caught by `tests/combat-visuals.spec.ts`'s root-yaw
    // regression failing at tick 329 of the frozen seed-20260815 duel with
    // rendered/expected yaw summing to ~-pi, the textbook signature of
    // exactly this ambiguity. Deriving yaw from the quaternion applied to
    // the canonical forward vector instead is decomposition-independent --
    // both Euler solutions yield the identical quaternion (that is what
    // makes them equivalent), so this reads the same yaw regardless of
    // which one `.rotation` happens to cache.
    const worldForward = new THREE.Vector3(0, 0, 1).applyQuaternion(rig.fighter.root.quaternion)
    rootYaw[id] = Math.atan2(worldForward.x, worldForward.z)
    const rotationsForRig = {} as Record<FighterBoneName, readonly [number, number, number]>
    for (const name of FIGHTER_BONE_NAMES) {
      const joint = rig.fighter.bones.get(name)
      if (!joint) {
        rotationsForRig[name] = [0, 0, 0]
        continue
      }
      const values = [joint.position.x, joint.position.y, joint.position.z, joint.rotation.x, joint.rotation.y, joint.rotation.z]
      if (values.some((value) => !Number.isFinite(value))) jointTransformsFinite = false
      rotationsForRig[name] = [joint.rotation.x, joint.rotation.y, joint.rotation.z]
    }
    jointRotations[id] = rotationsForRig
    if (rig.lastSelection) activeClip[id] = { clip: rig.lastSelection.clip, time: rig.lastSelection.time }
    trailPointCounts[id] = rig.trailLine.visible ? rig.trailPoints.length : 0

    // `applyFrame` already does this every rendered frame; repeated for the
    // same reason the camera's matrices are refreshed above -- a snapshot
    // must measure the rig as it currently stands, not as it stood at
    // whatever the last render happened to be.
    rig.fighter.root.updateMatrixWorld(true)

    const body = emptyBounds()
    accumulateProjectedBounds(rig.fighter.root, projection, (slot) => BODY_SILHOUETTE_SLOTS.has(slot), body)
    bodyHeightPx[id] = Number.isFinite(body.maxY - body.minY) ? body.maxY - body.minY : 0

    const full = emptyBounds()
    accumulateProjectedBounds(rig.fighter.root, projection, () => true, full)
    fullBoundsPx[id] = { minX: full.minX, maxX: full.maxX, minY: full.minY, maxY: full.maxY }

    const withoutWeapon = emptyBounds()
    accumulateProjectedBounds(rig.fighter.root, projection, (slot) => slot !== LONG_HANDHELD_WEAPON_SLOT, withoutWeapon)
    boundsPxWithoutWeapon[id] = { minX: withoutWeapon.minX, maxX: withoutWeapon.maxX, minY: withoutWeapon.minY, maxY: withoutWeapon.maxY }

    const withoutExempt = emptyBounds()
    accumulateProjectedBounds(rig.fighter.root, projection, (slot) => !SAFE_AREA_EXEMPT_SLOTS.has(slot), withoutExempt)
    boundsPxWithoutExemptProps[id] = { minX: withoutExempt.minX, maxX: withoutExempt.maxX, minY: withoutExempt.minY, maxY: withoutExempt.maxY }

    MEASURED_CORNER.setFromMatrixPosition(rig.fighter.root.matrixWorld)
    centerPx[id] = projectToCanvasPx(MEASURED_CORNER, projection)

    framingTargets.push({
      id,
      centerX: rig.fighter.root.position.x,
      centerZ: rig.fighter.root.position.z,
      radius: rig.fighter.horizontalEquipmentRadius,
    })
  }

  return {
    rootPositions,
    rootYaw,
    jointTransformsFinite,
    jointRotations,
    activeClip,
    activeEffectIds: flashes.activeEffectIds(),
    activeDamageNumbers: numbers.snapshot(),
    trailPointCounts,
    camera: cameraState,
    eventCursor,
    // The same targets `applyFrame` builds (rig root position plus that rig's
    // own `horizontalEquipmentRadius`) through the camera's own exported
    // measure at the yaw the camera currently holds -- i.e. the exact number
    // its distance mapping consumed for the frame just rendered.
    groupExtent: measuredExtent(framingTargets, cameraState.yaw),
    bodyHeightPx,
    fullBoundsPx,
    boundsPxWithoutWeapon,
    boundsPxWithoutExemptProps,
    centerPx,
    canvasPx: { width: projection.widthPx, height: projection.heightPx },
  }
}
