// Immutable, data-only combat pose catalog sampled by the future
// `PoseController` (Task 16). No functions, mutable state, or Three.js
// objects live inside the exported dictionaries -- every leaf is a plain
// number, matching `structuredClone`-safe simulation content
// (`src/content/combatStyles.ts`). Helper functions below only ever run at
// module load to *construct* those plain objects; nothing they return is
// itself a function.
//
// Coverage is exhaustive over `COMBAT_STYLES` (`src/content/combatStyles.ts`,
// the authored simulation catalog): every archetype gets a full core pose
// set, every attack action gets all six phase keys, and every defense action
// gets a reaction pose. `combatPoses.test.ts` derives its required key lists
// from that catalog rather than hardcoding IDs, so a future catalog change
// cannot silently leave a pose missing.
//
// Anatomy convention (this file's own choice, not fixed by design.md):
// `ProceduralFighter.ts` always anchors the weapon to `hand.R` and the
// shield/off-hand to `hand.L`, so every style's poses drive the weapon arm
// through `upperArm.R`/`forearm.R` and the shield arm through
// `upperArm.L`/`forearm.L` uniformly.

import type { AttackActionId, DefenseActionId } from '../../simulation/combatActions'
import type { Archetype } from '../../simulation/fighters'
import type { JointName } from '../ProceduralFighter'

// ---------------------------------------------------------------------------
// Pose data contracts (brief Step 3)
// ---------------------------------------------------------------------------

export type PoseEasing = 'linear' | 'ease-in' | 'ease-out' | 'overshoot'

export interface JointTransform {
  rotation: readonly [x: number, y: number, z: number]
  position?: readonly [x: number, y: number, z: number]
}

export interface HumanoidPoseData {
  joints: Readonly<Partial<Record<JointName, JointTransform>>>
  easing: PoseEasing
}

/**
 * The six sparse phase keys every attack action supplies (brief resolution
 * #5), matching design.md's Pose controller vocabulary "guard/opening,
 * anticipation, contact, overshoot or impact, recovery, and return":
 * `opening` is the pre-windup resting pose (equal to the style guard),
 * `anticipation` is the distinctive windup pull-back -- sampled by the
 * controller from the *first* tick of windup rather than only near its
 * middle -- `contact` is the committed extension at the one-tick contact
 * window, `impact` is the held extended pose (its `overshoot` easing is
 * exactly the "overshoot or impact" pairing in the design text), `recovery`
 * eases back, and `return` matches the style guard again.
 */
export const ATTACK_POSE_PHASES = ['opening', 'anticipation', 'contact', 'impact', 'recovery', 'return'] as const
export type AttackPosePhase = (typeof ATTACK_POSE_PHASES)[number]
export type AttackPoseSet = Readonly<Record<AttackPosePhase, HumanoidPoseData>>

/**
 * The style-level poses every archetype supplies once: its ready `guard`,
 * one `locomotion` stride key (the future gait cycle mirrors/offsets this
 * from travelled distance, per design.md's "Feet use a deterministic gait
 * phase" -- Task 15 authors the single canonical key, Task 16 owns the
 * cycling), the small `recognitionFlinch` for `defense-declined` ("a small
 * early recognition flinch without revealing numeric chance"), a non-lethal
 * `stagger` reaction, and a style-specific controlled `defeat` pose.
 */
export const STYLE_CORE_POSE_KEYS = ['guard', 'locomotion', 'recognitionFlinch', 'stagger', 'defeat'] as const
export type StyleCorePoseKey = (typeof STYLE_CORE_POSE_KEYS)[number]
export type StyleCorePoses = Readonly<Record<StyleCorePoseKey, HumanoidPoseData>>

export interface CombatPoseCatalog {
  styles: Readonly<Record<Archetype, StyleCorePoses>>
  attacks: Readonly<Record<AttackActionId, AttackPoseSet>>
  defenses: Readonly<Record<DefenseActionId, HumanoidPoseData>>
}

// ---------------------------------------------------------------------------
// Authoring helpers (run once at module load; every value they return is
// plain frozen-shape data, never a function).
// ---------------------------------------------------------------------------

function jt(rotation: readonly [number, number, number], position?: readonly [number, number, number]): JointTransform {
  return position ? { rotation, position } : { rotation }
}

function pose(joints: Partial<Record<JointName, JointTransform>>, easing: PoseEasing): HumanoidPoseData {
  return { joints, easing }
}

function mergeJoints(
  base: Readonly<Partial<Record<JointName, JointTransform>>>,
  overrides: Partial<Record<JointName, JointTransform>>,
): Partial<Record<JointName, JointTransform>> {
  return { ...base, ...overrides }
}

// ---------------------------------------------------------------------------
// Style guard poses -- the resting stance each style's other poses are built
// from. Numbers are authored radians on each joint's local rotation axis;
// there is no runtime trigonometry anywhere in this presentation-only file
// (that ban applies to `src/simulation/**`, not here), these are just
// literal stance angles.
// ---------------------------------------------------------------------------

const HEAVY_GUARD = pose(
  {
    chest: jt([0.05, 0, 0]),
    'upperArm.L': jt([-1.3, 0.3, 0.2]),
    'forearm.L': jt([-0.4, 0, 0]),
    'upperArm.R': jt([-0.5, -0.2, 0]),
    'forearm.R': jt([-0.9, 0, 0]),
    'upperLeg.L': jt([0.15, 0, 0.12]),
    'upperLeg.R': jt([-0.15, 0, -0.12]),
  },
  'linear',
)

const FAST_GUARD = pose(
  {
    chest: jt([0.08, 0.1, 0]),
    'upperArm.L': jt([-0.6, 0.1, 0.3]),
    'forearm.L': jt([-0.3, 0, 0]),
    'upperArm.R': jt([-0.9, -0.3, 0]),
    'forearm.R': jt([-0.6, 0, 0]),
    'upperLeg.L': jt([0.28, 0, 0.05]),
    'upperLeg.R': jt([-0.12, 0, -0.28]),
  },
  'linear',
)

const TECHNICAL_GUARD = pose(
  {
    chest: jt([0.02, 0, 0]),
    'upperArm.L': jt([-0.9, 0.2, 0.1]),
    'forearm.L': jt([-0.2, 0, 0]),
    'upperArm.R': jt([-0.7, -0.1, 0]),
    'forearm.R': jt([-0.3, 0, 0]),
    'upperLeg.L': jt([0.1, 0, 0.05]),
    'upperLeg.R': jt([-0.2, 0, -0.05]),
  },
  'linear',
)

// ---------------------------------------------------------------------------
// Style core poses
// ---------------------------------------------------------------------------

function buildRecognitionFlinch(guard: HumanoidPoseData): HumanoidPoseData {
  // A small early startle, not a defense pose: a quick head/chest jolt away
  // from the threat, everything else holds the guard stance.
  return pose(
    mergeJoints(guard.joints, {
      head: jt([0.14, 0.08, 0]),
      chest: jt([-0.06, 0.04, 0]),
    }),
    'ease-out',
  )
}

const HEAVY_LOCOMOTION = pose(
  mergeJoints(HEAVY_GUARD.joints, {
    'upperLeg.L': jt([0.4, 0, 0.12]),
    'upperLeg.R': jt([-0.35, 0, -0.12]),
    'lowerLeg.L': jt([0.2, 0, 0]),
    'lowerLeg.R': jt([-0.15, 0, 0]),
    'upperArm.L': jt([-1.1, 0.3, 0.2]),
    'upperArm.R': jt([-0.35, -0.2, 0]),
  }),
  'linear',
)

const FAST_LOCOMOTION = pose(
  mergeJoints(FAST_GUARD.joints, {
    'upperLeg.L': jt([0.6, 0, 0.05]),
    'upperLeg.R': jt([-0.55, 0, -0.05]),
    'lowerLeg.L': jt([0.3, 0, 0]),
    'lowerLeg.R': jt([-0.25, 0, 0]),
    'upperArm.L': jt([-0.45, 0.1, 0.3]),
    'upperArm.R': jt([-0.7, -0.3, 0]),
  }),
  'linear',
)

const TECHNICAL_LOCOMOTION = pose(
  mergeJoints(TECHNICAL_GUARD.joints, {
    'upperLeg.L': jt([0.35, 0, 0.05]),
    'upperLeg.R': jt([-0.4, 0, -0.05]),
    'lowerLeg.L': jt([0.15, 0, 0]),
    'lowerLeg.R': jt([-0.18, 0, 0]),
  }),
  'linear',
)

const HEAVY_STAGGER = pose(
  {
    chest: jt([-0.5, 0.15, 0]),
    head: jt([0.3, 0.1, 0]),
    'upperArm.L': jt([-0.9, 0.4, 0.3]),
    'upperArm.R': jt([-0.2, -0.1, 0]),
    'upperLeg.L': jt([-0.1, 0, 0.15]),
    'upperLeg.R': jt([0.25, 0, -0.15]),
  },
  'overshoot',
)

const FAST_STAGGER = pose(
  {
    chest: jt([-0.7, 0.25, 0.15]),
    head: jt([0.4, 0.2, 0]),
    'upperArm.L': jt([-0.3, 0.2, 0.4]),
    'upperArm.R': jt([-1.0, -0.4, 0]),
    'upperLeg.L': jt([-0.3, 0, 0.3]),
    'upperLeg.R': jt([0.45, 0, -0.2]),
  },
  'overshoot',
)

const TECHNICAL_STAGGER = pose(
  {
    chest: jt([-0.55, 0.1, 0.05]),
    head: jt([0.32, 0.05, 0]),
    'upperArm.L': jt([-0.5, 0.3, 0.2]),
    'upperArm.R': jt([-0.4, -0.2, 0]),
    'upperLeg.L': jt([-0.15, 0, 0.1]),
    'upperLeg.R': jt([0.3, 0, -0.15]),
  },
  'overshoot',
)

// Style-specific controlled collapses -- every one moves several joints
// (torso fold, both arms, both legs kneeling) rather than a single
// whole-group tilt, per design.md: "Rotating the whole group onto its side
// is not sufficient."
const HEAVY_DEFEAT = pose(
  {
    chest: jt([1.1, 0.3, 0.2]),
    neck: jt([0.4, 0, 0]),
    head: jt([0.5, 0.1, 0]),
    'upperArm.L': jt([-0.3, 0.6, 1.0], [0, -0.1, 0.15]),
    'upperArm.R': jt([0.6, -0.2, 0.1]),
    'forearm.R': jt([0.4, 0, 0]),
    'upperLeg.L': jt([0.9, 0, 0.3]),
    'lowerLeg.L': jt([1.2, 0, 0]),
    'upperLeg.R': jt([-1.0, 0, -0.25]),
  },
  'ease-in',
)

const FAST_DEFEAT = pose(
  {
    chest: jt([1.3, -0.4, 0.35]),
    neck: jt([0.5, 0, 0]),
    head: jt([0.6, -0.1, 0]),
    'upperArm.L': jt([0.7, 0.2, 0.6]),
    'upperArm.R': jt([0.8, -0.3, -0.2]),
    'upperLeg.L': jt([-0.6, 0, 0.4]),
    'upperLeg.R': jt([1.1, 0, -0.2]),
    'lowerLeg.R': jt([0.9, 0, 0]),
  },
  'ease-in',
)

const TECHNICAL_DEFEAT = pose(
  {
    chest: jt([0.75, 0.15, 0.1]),
    neck: jt([0.35, 0, 0]),
    head: jt([0.45, 0.05, 0]),
    'upperArm.L': jt([-0.4, 0.4, 0.3]),
    'upperArm.R': jt([0.2, -0.1, 0.05], [0, -0.05, 0.1]),
    'forearm.R': jt([0.15, 0, 0]),
    'upperLeg.L': jt([0.5, 0, 0.2]),
    'lowerLeg.L': jt([0.8, 0, 0]),
    'upperLeg.R': jt([-0.3, 0, -0.15]),
  },
  'ease-in',
)

const STYLE_CORE_POSES: Readonly<Record<Archetype, StyleCorePoses>> = {
  heavy: {
    guard: HEAVY_GUARD,
    locomotion: HEAVY_LOCOMOTION,
    recognitionFlinch: buildRecognitionFlinch(HEAVY_GUARD),
    stagger: HEAVY_STAGGER,
    defeat: HEAVY_DEFEAT,
  },
  fast: {
    guard: FAST_GUARD,
    locomotion: FAST_LOCOMOTION,
    recognitionFlinch: buildRecognitionFlinch(FAST_GUARD),
    stagger: FAST_STAGGER,
    defeat: FAST_DEFEAT,
  },
  technical: {
    guard: TECHNICAL_GUARD,
    locomotion: TECHNICAL_LOCOMOTION,
    recognitionFlinch: buildRecognitionFlinch(TECHNICAL_GUARD),
    stagger: TECHNICAL_STAGGER,
    defeat: TECHNICAL_DEFEAT,
  },
}

// ---------------------------------------------------------------------------
// Attack pose sets
//
// Every attack is expressed as a delta from its style's guard: `weaponBack`/
// `weaponForward` drive the weapon arm's shoulder rotation (x axis, radians),
// `forearmSnap` adds a forearm extension at contact, `torsoTwist`/
// `torsoDrive` rotate the chest away then into the target, and `overshoot`
// is the extra swing impact holds beyond contact. Magnitudes are authored
// larger for `committed`/`counter` actions than `probe` actions (matching
// each action's own `contactPriority`/`damageMultiplier` weight in
// `combatStyles.ts`), which is what makes anticipation visually "committed"
// rather than uniform across an archetype's whole kit.
// ---------------------------------------------------------------------------

interface AttackPoseParams {
  weaponBack: number
  weaponForward: number
  forearmSnap: number
  torsoTwist: number
  torsoDrive: number
  overshoot: number
}

function buildAttackPoseSet(guard: HumanoidPoseData, params: AttackPoseParams): AttackPoseSet {
  const opening = guard
  const anticipation = pose(
    mergeJoints(guard.joints, {
      'upperArm.R': jt([params.weaponBack, -0.15, 0]),
      chest: jt([-0.05, params.torsoTwist, 0]),
    }),
    'ease-in',
  )
  const contact = pose(
    mergeJoints(guard.joints, {
      'upperArm.R': jt([params.weaponForward, -0.15, 0]),
      'forearm.R': jt([params.forearmSnap, 0, 0]),
      chest: jt([0.1, params.torsoDrive, 0]),
    }),
    'ease-out',
  )
  const impact = pose(
    mergeJoints(guard.joints, {
      'upperArm.R': jt([params.weaponForward + params.overshoot, -0.15, 0]),
      'forearm.R': jt([params.forearmSnap + params.overshoot * 0.5, 0, 0]),
      chest: jt([0.12, params.torsoDrive, 0]),
    }),
    'overshoot',
  )
  const recovery = pose(
    mergeJoints(guard.joints, {
      'upperArm.R': jt([params.weaponForward * 0.35, -0.15, 0]),
      chest: jt([0.04, params.torsoDrive * 0.3, 0]),
    }),
    'ease-out',
  )
  const returnPose = pose(mergeJoints(guard.joints, {}), 'linear')

  return { opening, anticipation, contact, impact, recovery, return: returnPose }
}

const ATTACK_POSES: Readonly<Record<AttackActionId, AttackPoseSet>> = {
  // Heavy: probe jab is a short shield punch; the cleave is the slow,
  // maximally committed overhead/side swing.
  'heavy-shield-jab': buildAttackPoseSet(HEAVY_GUARD, {
    weaponBack: -0.7,
    weaponForward: 0.3,
    forearmSnap: 0.35,
    torsoTwist: -0.15,
    torsoDrive: 0.2,
    overshoot: 0.15,
  }),
  'heavy-cleave': buildAttackPoseSet(HEAVY_GUARD, {
    weaponBack: -2.1,
    weaponForward: 1.3,
    forearmSnap: 1.1,
    torsoTwist: -0.6,
    torsoDrive: 0.75,
    overshoot: 0.4,
  }),

  // Fast: the slash is a quick low-commitment cut; the burst lunge is the
  // committed, longest-reaching entry.
  'fast-slash': buildAttackPoseSet(FAST_GUARD, {
    weaponBack: -1.5,
    weaponForward: 0.9,
    forearmSnap: 0.7,
    torsoTwist: -0.3,
    torsoDrive: 0.35,
    overshoot: 0.2,
  }),
  'fast-burst-lunge': buildAttackPoseSet(FAST_GUARD, {
    weaponBack: -1.9,
    weaponForward: 1.5,
    forearmSnap: 1.2,
    torsoTwist: -0.4,
    torsoDrive: 0.55,
    overshoot: 0.35,
  }),

  // Technical: the thrust is a controlled probe at range; the driving
  // thrust is the slower committed lunge with a deeper torso drive.
  'technical-thrust': buildAttackPoseSet(TECHNICAL_GUARD, {
    weaponBack: -1.1,
    weaponForward: 1.2,
    forearmSnap: 0.9,
    torsoTwist: -0.2,
    torsoDrive: 0.3,
    overshoot: 0.18,
  }),
  'technical-driving-thrust': buildAttackPoseSet(TECHNICAL_GUARD, {
    weaponBack: -1.4,
    weaponForward: 1.6,
    forearmSnap: 1.3,
    torsoTwist: -0.35,
    torsoDrive: 0.5,
    overshoot: 0.3,
  }),
  // The forced parry counter: an explosive, very short windup thrust thrown
  // from the parry's own recovered stance.
  'technical-parry-counter': buildAttackPoseSet(TECHNICAL_GUARD, {
    weaponBack: -1.6,
    weaponForward: 1.7,
    forearmSnap: 1.35,
    torsoTwist: -0.45,
    torsoDrive: 0.6,
    overshoot: 0.4,
  }),
}

// ---------------------------------------------------------------------------
// Defense reaction poses
// ---------------------------------------------------------------------------

const DEFENSE_POSES: Readonly<Record<DefenseActionId, HumanoidPoseData>> = {
  'heavy-guard': pose(
    mergeJoints(HEAVY_GUARD.joints, {
      'upperArm.L': jt([-1.6, 0.35, 0.25]),
      'forearm.L': jt([-0.6, 0, 0]),
      chest: jt([0.15, 0, 0]),
      'upperLeg.L': jt([0.2, 0, 0.18]),
      'upperLeg.R': jt([-0.2, 0, -0.18]),
    }),
    'ease-out',
  ),
  'fast-evade': pose(
    mergeJoints(FAST_GUARD.joints, {
      chest: jt([0.1, 0.3, 0.4]),
      pelvis: jt([0, 0.25, 0.3]),
      'upperLeg.L': jt([0.15, 0, 0.5]),
      'upperLeg.R': jt([-0.35, 0, -0.4]),
      'upperArm.L': jt([-0.3, 0.2, 0.5]),
      'upperArm.R': jt([-0.6, -0.2, 0.2]),
    }),
    'ease-out',
  ),
  'technical-parry': pose(
    mergeJoints(TECHNICAL_GUARD.joints, {
      'upperArm.R': jt([-0.9, -0.9, 0.3]),
      'forearm.R': jt([-0.5, 0, 0.2]),
      chest: jt([0.05, -0.35, 0]),
    }),
    'overshoot',
  ),
}

// ---------------------------------------------------------------------------
// Gait cycle data (Task 16)
// ---------------------------------------------------------------------------

/**
 * Authored travelled-distance (arena units) for one complete left/right gait
 * cycle, per archetype. `PoseController` derives a deterministic `0..1` gait
 * phase from a fighter's own `travelledDistance` (never wall-clock time) by
 * taking `travelledDistance % STYLE_GAIT_CYCLE_DISTANCE[archetype]`, then
 * mirrors/offsets the style's single authored `locomotion` snapshot across
 * that phase to alternate which leg reads as forward -- this is the "future
 * gait cycle" this file's own `STYLE_CORE_POSE_KEYS` doc comment already
 * promises. A plain positive number per archetype, not a pose: it stays here
 * because it is authored per-style content, not sampling logic.
 *
 * Heavy strides less often (a longer cycle distance) to read as ponderous;
 * Fast paces quickest (the shortest cycle distance); Technical sits between
 * the two, matching each style's authored locomotion speed profile in
 * `combatStyles.ts`.
 */
export const STYLE_GAIT_CYCLE_DISTANCE: Readonly<Record<Archetype, number>> = {
  heavy: 1.4,
  fast: 0.95,
  technical: 1.15,
}

// ---------------------------------------------------------------------------
// Public catalog
// ---------------------------------------------------------------------------

export const COMBAT_POSES: CombatPoseCatalog = {
  styles: STYLE_CORE_POSES,
  attacks: ATTACK_POSES,
  defenses: DEFENSE_POSES,
}
