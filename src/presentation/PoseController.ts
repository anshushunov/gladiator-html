// Layered pose sampling: turns immutable simulation state (Task 15's rig +
// pose data) into a per-tick `HumanoidPose` sample, following design.md's
// "Pose controller" section exactly in this fixed order:
//
//   1. style guard pose;
//   2. locomotion cycle and facing;
//   3. action key-pose curve;
//   4. recognition-flinch / block / evade / parry / stagger / defeat
//      reaction overlay;
//   5. foot grounding and capped weapon-arm IK.
//
// Every layer contributes a *sparse* joint-transform record; layers are
// merged strictly left-to-right with a later layer's joint entry replacing
// an earlier one outright (never re-blended against it) -- this is what
// lets `PoseController.test.ts` pin *order* rather than only a final
// outcome (brief resolution #1).
//
// This module is rule-free: it never reads/writes anything under
// `src/simulation/**` or `src/content/**`, never decides a hit/phase/event
// outcome, and never mutates the `FighterCombatState` it samples. The one
// exception is `ProceduralFighter`'s own `THREE.Object3D` graph, which the
// weapon-arm IK step (5b) uses purely as a *scratch* forward-kinematics
// buffer -- its `root` transform is saved and restored around that single
// computation, so this never leaks into (or depends on) whatever a renderer
// has set on the live rig between frames.
//
// Vitest runs headlessly: constructing `Object3D` graphs and calling
// `updateMatrixWorld`/`getWorldPosition`/`getWorldQuaternion` all work
// without a `WebGLRenderer`, matching `ProceduralFighter.ts`'s own note.

import * as THREE from 'three'
import type { AttackActionId, CombatActionPhase, CombatActionState, DefenseActionId } from '../simulation/combatActions'
import type { FighterCombatState } from '../simulation/encounter'
import type { Vec2 } from '../simulation/movement'
import {
  COMBAT_POSES,
  type AttackPoseSet,
  type HumanoidPoseData,
  type JointTransform,
  type PoseEasing,
  type StyleCorePoses,
} from './poses/combatPoses'
import { SEMANTIC_JOINT_NAMES, type JointName, type ProceduralFighter } from './ProceduralFighter'
import { classifyGaitPhase, computeGaitPhase } from './poses/gait'

// ---------------------------------------------------------------------------
// Public contract (brief Step 2)
// ---------------------------------------------------------------------------

/**
 * Presentation-only reaction inputs the caller (Task 17's `ArenaView`, or a
 * unit test) supplies alongside a fighter's own simulation-truth state --
 * neither is derivable from `FighterCombatState` alone:
 *
 * - `defenseDeclinedTick`: the tick this fighter's `defense-declined` event
 *   fired. A failed defense roll leaves the fighter in ordinary `neutral`
 *   action state (design.md: ineligible/failed reactions are "ledger-only"),
 *   so there is no lingering `CombatActionState` to sample a recognition
 *   flinch from -- the caller must hand the triggering tick across once, and
 *   this controller remembers it internally for a short authored window
 *   (brief resolution #4/#8).
 * - `contactTarget`: a world-space (root-plane) point the weapon-arm IK
 *   layer may cosmetically reach the weapon tip toward -- e.g. the opponent's
 *   own interpolated root position, or the simulation's semantic contact
 *   point for the action in flight. `ArenaView` owns computing this (it has
 *   both fighters); this controller only ever consumes it, within a capped
 *   cosmetic reach (brief resolution #6).
 */
export interface PresentationReaction {
  defenseDeclinedTick?: number
  contactTarget?: Readonly<Vec2>
}

export interface PoseSampleInput {
  previous: Readonly<FighterCombatState>
  current: Readonly<FighterCombatState>
  previousTick: number
  currentTick: number
  alpha: number
  reducedMotion: boolean
  reaction?: Readonly<PresentationReaction>
}

export interface PoseSample {
  pose: Readonly<Record<JointName, JointTransform>>
  phaseProgress: number
  plantedFoot: 'left' | 'right' | 'both'
  weaponTrailActive: boolean
}

// ---------------------------------------------------------------------------
// Authored tuning constants (presentation-only; none of these are simulation
// values, none feed back into `src/simulation/**`).
// ---------------------------------------------------------------------------

/** Fraction of an attack's windup over which `opening` blends into the
 * distinctive `anticipation` pose, front-loading it near the *start* of
 * windup rather than only reaching it by the middle (design.md's "front-
 * loaded in the first tick of windup"; brief resolution #2). */
const WINDUP_ANTICIPATION_LEAD_IN = 0.3

/** Reduced-motion's fixed impact-hold blend weight from `contact`/guard
 * toward the full `impact`/reaction-hold pose (brief resolution #7: dampen
 * overshoot, never remove anticipation/contact). `1` (full impact) outside
 * reduced motion. */
const REDUCED_MOTION_IMPACT_WEIGHT = 0.6

/** Fraction of an `overshoot`-eased curve's excursion beyond its own
 * `0..1` envelope kept under reduced motion (stagger, technical-parry).
 * Endpoints are always preserved exactly; only the bounce is damped. */
const REDUCED_MOTION_OVERSHOOT_DAMPING = 0.45

/** How long (in ticks) a `defense-declined` recognition flinch stays visible
 * once triggered -- a "small early" startle, not a held reaction. */
const RECOGNITION_FLINCH_WINDOW_TICKS = 14

/** Interpolated speed (units/second) at which the gait blend reaches full
 * weight; below it the fighter eases toward its guard/idle stance even if
 * `travelledDistance` (and therefore gait phase) is momentarily frozen
 * mid-cycle. */
const GAIT_FULL_SPEED_REFERENCE = 0.5

/**
 * Point within the recovery phase where the curve stops easing toward the
 * authored `recovery` pose and starts easing toward the authored `return`
 * pose (the style's own guard stance). Before this existed, `return` was
 * authored for all seven attacks and never sampled: recovery held its
 * half-lowered pose to the last frame of the phase and the fighter snapped
 * back to guard on the frame the action went neutral. Recovery is one of the
 * three beats the human-review gate scores, so it ends on a settle, not a
 * cut.
 */
const RECOVERY_RETURN_BLEND_START = 0.65

/** Fraction of windup, counted backward from contact, during which a weapon
 * trail is active (design.md: "the final part of windup through contact"). */
const WEAPON_TRAIL_WINDUP_THRESHOLD = 0.6

/** Cosmetic weapon-arm IK reach cap, expressed as a ratio of the *authored*
 * pose's own shoulder-to-weapon-tip distance (brief resolution #6: outside
 * the cap the authored contact pose wins; this never stretches bone
 * lengths, it only permits rotating slightly further than the authored pose
 * already reaches). */
const WEAPON_IK_REACH_CAP_RATIO = 1.2

const VECTOR_EPSILON = 1e-9

const IDENTITY_TRANSFORM: JointTransform = { rotation: [0, 0, 0] }

// ---------------------------------------------------------------------------
// Small pure math helpers (presentation-only; runtime trigonometry is fine
// here -- the ban in design.md's "Random streams" section is scoped to
// `src/simulation/**`, not presentation).
// ---------------------------------------------------------------------------

function clamp01(value: number): number {
  if (value < 0) return 0
  if (value > 1) return 1
  return value
}

function clampRatio(value: number): number {
  if (value < -1) return -1
  if (value > 1) return 1
  return value
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t
}

function lerpVec2(a: Readonly<Vec2>, b: Readonly<Vec2>, t: number): Vec2 {
  return { x: lerp(a.x, b.x, t), z: lerp(a.z, b.z, t) }
}

function vecLength(v: Readonly<Vec2>): number {
  return Math.sqrt(v.x * v.x + v.z * v.z)
}

function normalizeVec2Local(v: Readonly<Vec2>): Vec2 {
  const length = vecLength(v)
  if (length <= VECTOR_EPSILON) return { x: 0, z: 1 }
  return { x: v.x / length, z: v.z / length }
}

/** Matches `movement.ts`'s own private `rightPerpendicular` convention
 * exactly (duplicated here since that module exports neither perpendicular
 * helper, the same situation `combatActions.ts`'s `evadeDirectionVector`
 * documents). */
function rightPerpendicular(facing: Readonly<Vec2>): Vec2 {
  return { x: facing.z, z: -facing.x }
}

function lerpTriple(a: readonly [number, number, number], b: readonly [number, number, number], t: number): [number, number, number] {
  return [lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)]
}

function lerpTransform(a: JointTransform | undefined, b: JointTransform | undefined, t: number): JointTransform {
  const from = a ?? IDENTITY_TRANSFORM
  const to = b ?? IDENTITY_TRANSFORM
  const rotation = lerpTriple(from.rotation, to.rotation, t)
  if (from.position || to.position) {
    const position = lerpTriple(from.position ?? [0, 0, 0], to.position ?? [0, 0, 0], t)
    return { rotation, position }
  }
  return { rotation }
}

type SparsePose = Partial<Record<JointName, JointTransform>>

function blendPoseJoints(a: Readonly<SparsePose>, b: Readonly<SparsePose>, t: number): SparsePose {
  const keys = new Set<JointName>([...Object.keys(a), ...Object.keys(b)] as JointName[])
  const result: SparsePose = {}
  for (const key of keys) result[key] = lerpTransform(a[key], b[key], t)
  return result
}

function mergeInto(target: SparsePose, source: Readonly<SparsePose>): void {
  for (const key of Object.keys(source) as JointName[]) target[key] = source[key]
}

function buildFullPose(working: Readonly<SparsePose>): Record<JointName, JointTransform> {
  const result = {} as Record<JointName, JointTransform>
  for (const name of SEMANTIC_JOINT_NAMES) result[name] = working[name] ?? IDENTITY_TRANSFORM
  return result
}

/** Shared by the reaction overlay (shows the stagger pose) and grounding
 * (must not touch a staggered fighter's legs) so the condition can't drift
 * between the two call sites. */
function isStaggered(current: Readonly<FighterCombatState>, currentTick: number): boolean {
  return current.status === 'active' && currentTick < current.staggerUntilTick
}

// ---------------------------------------------------------------------------
// Easing
// ---------------------------------------------------------------------------

const OVERSHOOT_BACK_FACTOR = 1.70158

function backEase(t: number): number {
  const p = t - 1
  return p * p * ((OVERSHOOT_BACK_FACTOR + 1) * p + OVERSHOOT_BACK_FACTOR) + 1
}

/** Resolves a named `PoseEasing` curve at clamped `t`. Under reduced motion,
 * `overshoot` keeps its exact endpoints (0 at t=0, 1 at t=1 -- so contact/
 * result poses are never altered) but damps how far the curve swings beyond
 * that `0..1` envelope (brief resolution #7). */
function resolveEasing(name: PoseEasing, t: number, reducedMotion: boolean): number {
  const c = clamp01(t)
  switch (name) {
    case 'linear':
      return c
    case 'ease-in':
      return c * c
    case 'ease-out':
      return 1 - (1 - c) * (1 - c)
    case 'overshoot': {
      const full = backEase(c)
      if (!reducedMotion) return full
      return c + (full - c) * REDUCED_MOTION_OVERSHOOT_DAMPING
    }
  }
}

// ---------------------------------------------------------------------------
// Layer 3: action key-pose curve (this fighter's own attack)
// ---------------------------------------------------------------------------

function sampleActionCurveLayer(poseSet: AttackPoseSet, phase: CombatActionPhase, phaseProgress: number, reducedMotion: boolean): SparsePose {
  switch (phase) {
    case 'windup': {
      const raw = WINDUP_ANTICIPATION_LEAD_IN > 0 ? clamp01(phaseProgress / WINDUP_ANTICIPATION_LEAD_IN) : 1
      const eased = resolveEasing(poseSet.anticipation.easing, raw, reducedMotion)
      return blendPoseJoints(poseSet.opening.joints, poseSet.anticipation.joints, eased)
    }
    case 'contact': {
      const eased = resolveEasing(poseSet.contact.easing, phaseProgress, reducedMotion)
      return blendPoseJoints(poseSet.anticipation.joints, poseSet.contact.joints, eased)
    }
    case 'impact': {
      // Impact hold (brief resolution #3): the exact authored/dampened
      // impact pose, independent of `phaseProgress`/alpha, for the whole
      // phase -- this is what makes it alpha- and tick-invariant.
      const weight = reducedMotion ? REDUCED_MOTION_IMPACT_WEIGHT : 1
      return blendPoseJoints(poseSet.contact.joints, poseSet.impact.joints, weight)
    }
    case 'recovery': {
      const impactJoints = blendPoseJoints(poseSet.contact.joints, poseSet.impact.joints, reducedMotion ? REDUCED_MOTION_IMPACT_WEIGHT : 1)
      if (phaseProgress <= RECOVERY_RETURN_BLEND_START) {
        const raw = RECOVERY_RETURN_BLEND_START > 0 ? clamp01(phaseProgress / RECOVERY_RETURN_BLEND_START) : 1
        const eased = resolveEasing(poseSet.recovery.easing, raw, reducedMotion)
        return blendPoseJoints(impactJoints, poseSet.recovery.joints, eased)
      }
      const raw = clamp01((phaseProgress - RECOVERY_RETURN_BLEND_START) / (1 - RECOVERY_RETURN_BLEND_START))
      const eased = resolveEasing(poseSet.return.easing, raw, reducedMotion)
      return blendPoseJoints(poseSet.recovery.joints, poseSet.return.joints, eased)
    }
  }
}

// ---------------------------------------------------------------------------
// Layer 4: recognition-flinch / block / evade / parry / stagger / defeat
// ---------------------------------------------------------------------------

function isAttackActionId(id: string): id is AttackActionId {
  return id in COMBAT_POSES.attacks
}

function isDefenseActionId(id: string): id is DefenseActionId {
  return id in COMBAT_POSES.defenses
}

function sampleDefenseCurve(guard: HumanoidPoseData, defensePose: HumanoidPoseData, phase: CombatActionPhase, phaseProgress: number, reducedMotion: boolean): SparsePose {
  switch (phase) {
    case 'windup':
    case 'contact': {
      const eased = resolveEasing(defensePose.easing, phaseProgress, reducedMotion)
      return blendPoseJoints(guard.joints, defensePose.joints, eased)
    }
    case 'impact': {
      // Impact hold applies to "both participants' contact/reaction body
      // poses" (design.md), so a defender's own impact freezes too.
      const weight = reducedMotion ? REDUCED_MOTION_IMPACT_WEIGHT : 1
      return blendPoseJoints(guard.joints, defensePose.joints, weight)
    }
    case 'recovery': {
      const heldJoints = blendPoseJoints(guard.joints, defensePose.joints, reducedMotion ? REDUCED_MOTION_IMPACT_WEIGHT : 1)
      const eased = resolveEasing(defensePose.easing, phaseProgress, reducedMotion)
      return blendPoseJoints(heldJoints, guard.joints, eased)
    }
  }
}

/**
 * Applies, in this exact sub-order (each replacing the last where they
 * overlap a joint): recognition-flinch, this fighter's own scheduled
 * block/evade/parry, non-lethal stagger, then defeat. `defense-declined`
 * (brief resolution #4) only ever reaches the first of these -- a failed
 * roll leaves `current.action` at `neutral`, so the second branch below
 * never fires for it, which is exactly what keeps a declined defense from
 * ever reading as a raised block/evade/parry.
 */
function sampleReactionOverlay(
  stylePoses: StyleCorePoses,
  current: Readonly<FighterCombatState>,
  currentTick: number,
  phaseProgress: number,
  reducedMotion: boolean,
  recognitionFlinchActive: boolean,
): SparsePose {
  const overlay: SparsePose = {}

  if (recognitionFlinchActive) {
    // Applied as an outright pop, not an eased blend, unlike every other
    // branch below: a recognition flinch is a startle reflex, and its own
    // pose data already carries an 'ease-out' curve describing its *return*
    // toward guard, not a wind-up into itself (Task 16 review Minor #1).
    mergeInto(overlay, stylePoses.recognitionFlinch.joints)
  }

  const action = current.action
  if (action.type === 'active' && isDefenseActionId(action.definitionId)) {
    const defensePose = COMBAT_POSES.defenses[action.definitionId]
    mergeInto(overlay, sampleDefenseCurve(stylePoses.guard, defensePose, action.phase, phaseProgress, reducedMotion))
  }

  if (isStaggered(current, currentTick)) {
    mergeInto(overlay, stylePoses.stagger.joints)
  }

  if (current.status === 'defeated') {
    mergeInto(overlay, stylePoses.defeat.joints)
  }

  return overlay
}

// ---------------------------------------------------------------------------
// Layer 2: locomotion cycle (gait) and facing
//
// "Facing" itself never appears as a joint transform this layer produces:
// `PoseSample.pose` carries only *local* joint transforms, and world yaw
// belongs to the fighter's root, which this controller never touches (the
// weapon-arm IK step below explicitly proves `pose.root` stays identity).
// Design.md's own contract already assigns interpolated root/facing to the
// caller ("`ArenaView`... interpolate[s] root position and normalized facing
// from previous/current by alpha"), so this layer's "facing" half of its
// name is satisfied by *not* duplicating that world transform here, not by
// adding a second copy of it as a joint delta.
// ---------------------------------------------------------------------------

function mirrorJointName(name: JointName): JointName {
  if (name.endsWith('.L')) return (name.slice(0, -2) + '.R') as JointName
  if (name.endsWith('.R')) return (name.slice(0, -2) + '.L') as JointName
  return name
}

/** Legs directly under a foot side, used by both the gait mirror lookup and
 * grounding's per-side reset. */
const LEG_JOINTS_BY_SIDE: Readonly<Record<'L' | 'R', readonly JointName[]>> = {
  L: ['upperLeg.L', 'lowerLeg.L', 'foot.L'],
  R: ['upperLeg.R', 'lowerLeg.R', 'foot.R'],
}

const LEG_JOINT_NAME_SET = new Set<JointName>([...LEG_JOINTS_BY_SIDE.L, ...LEG_JOINTS_BY_SIDE.R])

/**
 * `locomotion.joints` is built via `mergeJoints(guard.joints, {...overrides})`
 * (combatPoses.ts), so it carries *every* guard joint key -- not only the leg
 * (and arm-swing) keys its own overrides name -- including asymmetric guard
 * values a mirror substitution must never cross between hands, e.g. the
 * weapon-hand `forearm.R` bend versus the shield-hand `forearm.L` bend.
 *
 * Only the leg joints in `LEG_JOINTS_BY_SIDE` alternate which side reads as
 * forward across the gait's two halves (mirrored on half B). Every other
 * joint `locomotion.joints` defines -- arm swing, and any joint inherited
 * unchanged from guard -- always blends toward its own *unmirrored* authored
 * value in both halves, so it never depends on which half of the cycle is
 * active (Task 16 review Finding 1: the previous version mirrored every
 * joint present in `locomotion.joints`, which silently swapped the weapon
 * and shield arms' forearm bend -- and, for Technical, the entire upper body
 * -- once per stride).
 */
function applyGaitLayer(working: SparsePose, stylePoses: StyleCorePoses, gaitPhase: number, speedWeight: number): void {
  if (speedWeight <= 0) return
  const locomotion = stylePoses.locomotion
  const { half, envelope } = classifyGaitPhase(gaitPhase)
  const weight = envelope * speedWeight
  if (weight <= 0) return

  for (const jointName of Object.keys(locomotion.joints) as JointName[]) {
    const mirrorEligible = half === 'B' && LEG_JOINT_NAME_SET.has(jointName)
    const sourceName = mirrorEligible ? mirrorJointName(jointName) : jointName
    const target = locomotion.joints[sourceName] ?? locomotion.joints[jointName]
    if (!target) continue
    working[jointName] = lerpTransform(working[jointName], target, weight)
  }
}

// ---------------------------------------------------------------------------
// Layer 5a: foot grounding
// ---------------------------------------------------------------------------

/**
 * Snaps the currently-planted foot's leg joints back to the exact style
 * guard values, overriding any residual gait blend so a grounded foot never
 * visibly slides. Gated to ordinary locomotion states only (neutral action,
 * not staggered, not defeated) so it never stomps an authored defense/
 * stagger/defeat leg pose that Layer 4 already set for the same joints --
 * grounding is a locomotion concern, not a reaction-pose concern.
 */
function applyGroundingLayer(working: SparsePose, stylePoses: StyleCorePoses, current: Readonly<FighterCombatState>, currentTick: number, gaitPhase: number): void {
  const isOrdinary = current.action.type === 'neutral' && !isStaggered(current, currentTick) && current.status === 'active'
  if (!isOrdinary) return

  const { plantedFoot } = classifyGaitPhase(gaitPhase)
  const sides: readonly ('L' | 'R')[] = plantedFoot === 'both' ? ['L', 'R'] : plantedFoot === 'left' ? ['L'] : ['R']
  for (const side of sides) {
    for (const jointName of LEG_JOINTS_BY_SIDE[side]) {
      working[jointName] = stylePoses.guard.joints[jointName] ?? working[jointName] ?? IDENTITY_TRANSFORM
    }
  }
}

// ---------------------------------------------------------------------------
// Layer 5b: capped two-bone weapon-arm IK
// ---------------------------------------------------------------------------

function worldToActorLocal(worldPoint: Readonly<Vec2>, actorPosition: Readonly<Vec2>, actorFacing: Readonly<Vec2>): { x: number; z: number } {
  const dx = worldPoint.x - actorPosition.x
  const dz = worldPoint.z - actorPosition.z
  const right = rightPerpendicular(actorFacing)
  return {
    x: dx * right.x + dz * right.z,
    z: dx * actorFacing.x + dz * actorFacing.z,
  }
}

function applyPoseToRig(fighter: ProceduralFighter, pose: Readonly<Record<JointName, JointTransform>>): void {
  for (const name of SEMANTIC_JOINT_NAMES) {
    const joint = fighter.joints.get(name)
    if (!joint) continue
    const transform = pose[name]
    joint.rotation.set(transform.rotation[0], transform.rotation[1], transform.rotation[2])
    if (transform.position) joint.position.set(transform.position[0], transform.position[1], transform.position[2])
  }
}

/**
 * Solves the weapon arm (`upperArm.R`/`forearm.R` only) toward
 * `contactTarget` via a standard closed-form two-bone (law-of-cosines) IK
 * solve, run entirely in the actor's own root-local space so it never
 * depends on -- or mutates -- whatever world transform a renderer has left
 * on `fighter.root` between frames (the root transform is saved and
 * restored around this computation). Bone lengths are read from the rig's
 * own rest-pose local offsets (invariant under rotation) and never altered;
 * only `upperArm.R`/`forearm.R` rotations are returned. Returns `{}`
 * (authored pose wins) whenever the target sits outside the cosmetic reach
 * cap -- a fixed ratio of the *authored* (pre-IK) shoulder-to-tip reach --
 * which by construction (we solve for a distance we choose, clamped to the
 * cap, rather than iterating toward the raw target) guarantees the tip
 * never ends up farther from the shoulder than that cap.
 */
function solveWeaponArmIk(
  fighter: ProceduralFighter,
  preIkPose: Readonly<Record<JointName, JointTransform>>,
  actorPosition: Readonly<Vec2>,
  actorFacing: Readonly<Vec2>,
  contactTarget: Readonly<Vec2>,
): SparsePose {
  const root = fighter.root
  const savedPosition = root.position.clone()
  const savedQuaternion = root.quaternion.clone()

  try {
    root.position.set(0, 0, 0)
    root.quaternion.identity()
    applyPoseToRig(fighter, preIkPose)
    root.updateMatrixWorld(true)

    const upperArmJoint = fighter.joints.get('upperArm.R')
    const forearmJoint = fighter.joints.get('forearm.R')
    const handJoint = fighter.joints.get('hand.R')
    const weaponTipAnchor = fighter.anchors.get('weaponTip')
    if (!upperArmJoint || !forearmJoint || !handJoint || !weaponTipAnchor) return {}

    const shoulderWorld = new THREE.Vector3()
    upperArmJoint.getWorldPosition(shoulderWorld)
    const elbowWorldPreIk = new THREE.Vector3()
    forearmJoint.getWorldPosition(elbowWorldPreIk)
    const tipWorldPreIk = new THREE.Vector3()
    weaponTipAnchor.getWorldPosition(tipWorldPreIk)

    const l1 = shoulderWorld.distanceTo(elbowWorldPreIk)
    const l2 = elbowWorldPreIk.distanceTo(tipWorldPreIk)
    if (l1 <= VECTOR_EPSILON || l2 <= VECTOR_EPSILON) return {}

    const authoredReach = shoulderWorld.distanceTo(tipWorldPreIk)
    const cap = authoredReach * WEAPON_IK_REACH_CAP_RATIO

    const local = worldToActorLocal(contactTarget, actorPosition, actorFacing)
    const targetPoint = new THREE.Vector3(local.x, shoulderWorld.y, local.z)
    const desiredReach = shoulderWorld.distanceTo(targetPoint)
    if (desiredReach > cap || desiredReach <= VECTOR_EPSILON) return {}

    const maxReach = l1 + l2
    const minReach = Math.abs(l1 - l2)
    const effectiveReach = Math.min(Math.max(desiredReach, minReach + VECTOR_EPSILON), maxReach - VECTOR_EPSILON)

    const targetDir = targetPoint.clone().sub(shoulderWorld).normalize()
    const elbowHintDir = elbowWorldPreIk.clone().sub(shoulderWorld).normalize()

    let bendNormal = new THREE.Vector3().crossVectors(targetDir, elbowHintDir)
    if (bendNormal.lengthSq() < 1e-10) bendNormal = new THREE.Vector3(0, 1, 0).cross(targetDir)
    if (bendNormal.lengthSq() < 1e-10) bendNormal = new THREE.Vector3(1, 0, 0)
    bendNormal.normalize()

    const cosShoulder = clampRatio((l1 * l1 + effectiveReach * effectiveReach - l2 * l2) / (2 * l1 * effectiveReach))
    const angleShoulder = Math.acos(cosShoulder)
    const cosElbow = clampRatio((l1 * l1 + l2 * l2 - effectiveReach * effectiveReach) / (2 * l1 * l2))
    const angleElbow = Math.acos(cosElbow)

    const upperArmDir = targetDir.clone().applyAxisAngle(bendNormal, angleShoulder).normalize()
    const forearmDir = upperArmDir.clone().applyAxisAngle(bendNormal, -(Math.PI - angleElbow)).normalize()

    const shoulderParentWorldQuat = new THREE.Quaternion()
    upperArmJoint.parent!.getWorldQuaternion(shoulderParentWorldQuat)
    const upperArmRestDir = forearmJoint.position.clone().normalize()
    const upperArmDirLocal = upperArmDir.clone().applyQuaternion(shoulderParentWorldQuat.clone().invert())
    const upperArmLocalQuat = new THREE.Quaternion().setFromUnitVectors(upperArmRestDir, upperArmDirLocal)

    const newUpperArmWorldQuat = shoulderParentWorldQuat.clone().multiply(upperArmLocalQuat)
    const forearmDirLocal = forearmDir.clone().applyQuaternion(newUpperArmWorldQuat.clone().invert())
    const forearmRestDir = handJoint.position.clone().normalize()
    const forearmLocalQuat = new THREE.Quaternion().setFromUnitVectors(forearmRestDir, forearmDirLocal)

    const upperArmEuler = new THREE.Euler().setFromQuaternion(upperArmLocalQuat, 'XYZ')
    const forearmEuler = new THREE.Euler().setFromQuaternion(forearmLocalQuat, 'XYZ')

    return {
      'upperArm.R': { rotation: [upperArmEuler.x, upperArmEuler.y, upperArmEuler.z] },
      'forearm.R': { rotation: [forearmEuler.x, forearmEuler.y, forearmEuler.z] },
    }
  } finally {
    root.position.copy(savedPosition)
    root.quaternion.copy(savedQuaternion)
  }
}

// ---------------------------------------------------------------------------
// Weapon trail / phase progress
// ---------------------------------------------------------------------------

function computePhaseProgress(action: CombatActionState, currentTick: number, alpha: number): number {
  if (action.type !== 'active') return 0
  const duration = action.phaseEndsAtTick - action.phaseStartedTick
  if (duration <= 0) return 0
  const raw = (currentTick - 1 + alpha - action.phaseStartedTick) / duration
  return clamp01(raw)
}

function computeWeaponTrailActive(current: Readonly<FighterCombatState>, phaseProgress: number): boolean {
  const action = current.action
  if (action.type !== 'active' || !isAttackActionId(action.definitionId)) return false
  if (action.phase === 'contact') return true
  if (action.phase === 'windup') return phaseProgress >= WEAPON_TRAIL_WINDUP_THRESHOLD
  return false
}

// ---------------------------------------------------------------------------
// Controller
// ---------------------------------------------------------------------------

/**
 * Samples one fighter's pose per render frame. Instances are scoped to a
 * single fighter's lifetime (the caller owns one per rig, matching
 * `ArenaView`'s `Map<CombatantId, ProceduralFighter>`). Gait and the impact
 * hold are pure functions of `PoseSampleInput` alone (no running per-frame
 * accumulator), which is what guarantees equal travelled distance always
 * yields equal legs regardless of how many ticks/frames elapsed to get
 * there (brief resolution #5) and that the impact hold is exactly alpha-
 * and tick-invariant (brief resolution #3) -- the only real cross-call
 * state this class keeps is the recognition-flinch window (brief
 * resolution #4).
 *
 * There is deliberately no in-place `reset()`: a new bout does not reuse a
 * controller. `ArenaView` disposes every rig (`disposeRig`) and builds fresh
 * ones, each with its own controller, so "reset" is construction. A reset
 * method with no production caller would be a second, untested-in-anger path
 * for clearing the same window.
 */
export class PoseController {
  private recognitionFlinchExpiresAtTick: number | null = null

  apply(input: PoseSampleInput, fighter: ProceduralFighter): PoseSample {
    const { previous, current, currentTick, alpha, reducedMotion, reaction } = input
    const archetype = current.definition.archetype
    const stylePoses = COMBAT_POSES.styles[archetype]

    if (reaction?.defenseDeclinedTick !== undefined) {
      this.recognitionFlinchExpiresAtTick = reaction.defenseDeclinedTick + RECOGNITION_FLINCH_WINDOW_TICKS
    }
    const recognitionFlinchActive = this.recognitionFlinchExpiresAtTick !== null && currentTick < this.recognitionFlinchExpiresAtTick

    const phaseProgress = computePhaseProgress(current.action, currentTick, alpha)

    const working: SparsePose = {}

    // Layer 1: style guard.
    mergeInto(working, stylePoses.guard.joints)

    // Layer 2: locomotion cycle (gait), derived from travelled distance.
    const travelledDistance = lerp(previous.travelledDistance, current.travelledDistance, alpha)
    const gaitPhase = computeGaitPhase(travelledDistance, archetype)
    const velocity = lerpVec2(previous.velocity, current.velocity, alpha)
    const speedWeight = clamp01(vecLength(velocity) / GAIT_FULL_SPEED_REFERENCE)
    applyGaitLayer(working, stylePoses, gaitPhase, speedWeight)

    // Layer 3: action key-pose curve (this fighter's own attack only).
    if (current.action.type === 'active' && isAttackActionId(current.action.definitionId)) {
      const poseSet = COMBAT_POSES.attacks[current.action.definitionId]
      mergeInto(working, sampleActionCurveLayer(poseSet, current.action.phase, phaseProgress, reducedMotion))
    }

    // Layer 4: recognition-flinch / block / evade / parry / stagger / defeat.
    mergeInto(working, sampleReactionOverlay(stylePoses, current, currentTick, phaseProgress, reducedMotion, recognitionFlinchActive))

    // Layer 5a: foot grounding.
    applyGroundingLayer(working, stylePoses, current, currentTick, gaitPhase)

    // Layer 5b: capped weapon-arm IK.
    if (reaction?.contactTarget) {
      const preIkFull = buildFullPose(working)
      const actorPosition = lerpVec2(previous.position, current.position, alpha)
      const actorFacing = normalizeVec2Local(lerpVec2(previous.facing, current.facing, alpha))
      const ikOverride = solveWeaponArmIk(fighter, preIkFull, actorPosition, actorFacing, reaction.contactTarget)
      mergeInto(working, ikOverride)
    }

    const pose = buildFullPose(working)
    const plantedFoot = classifyGaitPhase(gaitPhase).plantedFoot
    const weaponTrailActive = computeWeaponTrailActive(current, phaseProgress)

    return { pose, phaseProgress, plantedFoot, weaponTrailActive }
  }
}
