import { describe, expect, it } from 'vitest'
import { COMBAT_STYLES } from '../../content/combatStyles'
import type { Archetype } from '../../simulation/fighters'
import { SEMANTIC_JOINT_NAMES, type JointName } from '../ProceduralFighter'
import { ATTACK_POSE_PHASES, COMBAT_POSES, STYLE_CORE_POSE_KEYS, STYLE_GAIT_CYCLE_DISTANCE, type HumanoidPoseData } from './combatPoses'

const EASINGS = new Set(['linear', 'ease-in', 'ease-out', 'overshoot'])
const JOINT_NAME_SET = new Set<JointName>(SEMANTIC_JOINT_NAMES)

function expectValidPose(pose: HumanoidPoseData, label: string): void {
  expect(EASINGS.has(pose.easing), `${label} has an unknown easing '${pose.easing}'`).toBe(true)
  for (const [jointName, transform] of Object.entries(pose.joints)) {
    expect(JOINT_NAME_SET.has(jointName as JointName), `${label} references unknown joint '${jointName}'`).toBe(true)
    expect(transform!.rotation.length).toBe(3)
    for (const value of transform!.rotation) expect(Number.isFinite(value)).toBe(true)
    if (transform!.position) {
      expect(transform!.position.length).toBe(3)
      for (const value of transform!.position) expect(Number.isFinite(value)).toBe(true)
    }
  }
}

describe('COMBAT_POSES content completeness', () => {
  // Every assertion below derives its expected key set from COMBAT_STYLES
  // (the authored simulation catalog) rather than hardcoding IDs, so a
  // future catalog change that adds/removes an archetype, attack, or defense
  // cannot silently leave a pose missing (brief resolution #5).
  const requiredArchetypes = Object.keys(COMBAT_STYLES.styles) as Archetype[]
  const requiredAttackIds = Object.keys(COMBAT_STYLES.attacks) as (keyof typeof COMBAT_STYLES.attacks)[]
  const requiredDefenseIds = Object.keys(COMBAT_STYLES.defenses) as (keyof typeof COMBAT_STYLES.defenses)[]

  it('covers every archetype in COMBAT_STYLES with a full core pose set', () => {
    expect(Object.keys(COMBAT_POSES.styles).sort()).toEqual(requiredArchetypes.sort())
    for (const archetype of requiredArchetypes) {
      const core = COMBAT_POSES.styles[archetype]
      expect(Object.keys(core).sort()).toEqual([...STYLE_CORE_POSE_KEYS].sort())
      for (const key of STYLE_CORE_POSE_KEYS) {
        expectValidPose(core[key], `${archetype}.${key}`)
      }
    }
  })

  it('covers every attack action in COMBAT_STYLES with all six phase keys', () => {
    expect(Object.keys(COMBAT_POSES.attacks).sort()).toEqual([...requiredAttackIds].sort())
    for (const attackId of requiredAttackIds) {
      const set = COMBAT_POSES.attacks[attackId]
      expect(Object.keys(set).sort()).toEqual([...ATTACK_POSE_PHASES].sort())
      for (const phase of ATTACK_POSE_PHASES) {
        expectValidPose(set[phase], `${attackId}.${phase}`)
      }
    }
  })

  it('covers every defense action in COMBAT_STYLES with a reaction pose', () => {
    expect(Object.keys(COMBAT_POSES.defenses).sort()).toEqual([...requiredDefenseIds].sort())
    for (const defenseId of requiredDefenseIds) {
      expectValidPose(COMBAT_POSES.defenses[defenseId], defenseId)
    }
  })

  it('gives every attack a distinctive anticipation pose, front-loaded rather than a mid-windup blend', () => {
    for (const attackId of requiredAttackIds) {
      const set = COMBAT_POSES.attacks[attackId]
      // "Distinctive" and "present at the first tick of windup" (design.md's
      // Pose controller section) means the authored anticipation key itself
      // must already differ from the resting/opening pose -- not a value the
      // controller interpolates *toward* over the course of the windup.
      expect(set.anticipation.joints, `${attackId} anticipation must differ from opening`).not.toEqual(set.opening.joints)
      expect(set.anticipation.joints, `${attackId} anticipation must differ from neutral contact`).not.toEqual(set.contact.joints)
    }
  })

  it('gives every defense action a reaction pose distinct from its style guard', () => {
    for (const archetype of requiredArchetypes) {
      const style = COMBAT_STYLES.styles[archetype]
      const guard = COMBAT_POSES.styles[archetype].guard
      const reaction = COMBAT_POSES.defenses[style.defenseActionId]
      expect(reaction.joints).not.toEqual(guard.joints)
    }
  })

  it('gives every style a defeat pose that is not a single whole-body rotation', () => {
    // A "rotate the whole group onto its side" implementation would leave
    // every individual joint's *local* rotation at (or near) its resting
    // value -- only a group-level transform would move. Require at least
    // two distinct joints to carry a non-trivial local rotation delta from
    // guard, proving the pose is an authored multi-joint collapse.
    for (const archetype of requiredArchetypes) {
      const guardJoints = COMBAT_POSES.styles[archetype].guard.joints
      const defeatJoints = COMBAT_POSES.styles[archetype].defeat.joints
      let changedJointCount = 0
      for (const [jointName, transform] of Object.entries(defeatJoints)) {
        const guardTransform = guardJoints[jointName as JointName]
        const guardRotation = guardTransform?.rotation ?? [0, 0, 0]
        const delta = transform!.rotation.some((value, index) => Math.abs(value - guardRotation[index]) > 0.15)
        if (delta) changedJointCount += 1
      }
      expect(changedJointCount, `${archetype} defeat pose should move more than one joint meaningfully`).toBeGreaterThanOrEqual(2)
    }
  })

  it('gives recognition-flinch a pose distinct from ordinary guard for every style (defense-declined)', () => {
    for (const archetype of requiredArchetypes) {
      const guard = COMBAT_POSES.styles[archetype].guard
      const flinch = COMBAT_POSES.styles[archetype].recognitionFlinch
      expect(flinch.joints).not.toEqual(guard.joints)
    }
  })

  it('gives every archetype a positive finite gait-cycle distance (Task 16 mirrors/offsets the locomotion snapshot across it)', () => {
    expect(Object.keys(STYLE_GAIT_CYCLE_DISTANCE).sort()).toEqual(requiredArchetypes.sort())
    for (const archetype of requiredArchetypes) {
      expect(Number.isFinite(STYLE_GAIT_CYCLE_DISTANCE[archetype])).toBe(true)
      expect(STYLE_GAIT_CYCLE_DISTANCE[archetype]).toBeGreaterThan(0)
    }
  })
})
