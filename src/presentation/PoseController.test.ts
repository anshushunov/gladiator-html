import * as THREE from 'three'
import { describe, expect, it } from 'vitest'
import { createProceduralFighter, SEMANTIC_JOINT_NAMES, type JointName } from './ProceduralFighter'
import { PoseController, type PoseSampleInput } from './PoseController'
import { COMBAT_POSES, STYLE_GAIT_CYCLE_DISTANCE } from './poses/combatPoses'
import type { CombatActionId, CombatActionPhase, CombatActionState } from '../simulation/combatActions'
import type { FighterCombatState } from '../simulation/encounter'
import type { Archetype, FighterDefinition } from '../simulation/fighters'
import type { Vec2 } from '../simulation/movement'

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function makeDefinition(archetype: Archetype): FighterDefinition {
  return {
    id: 'test-fighter',
    name: 'Test Fighter',
    school: 'Test School',
    archetype,
    maxHp: 100,
    power: 10,
    accuracy: 0.8,
    defenseChance: 0.3,
    criticalChance: 0.1,
  }
}

function baseFighterState(archetype: Archetype, overrides: Partial<FighterCombatState> = {}): FighterCombatState {
  return {
    id: 'a',
    factionId: 'home',
    definition: makeDefinition(archetype),
    position: { x: 0, z: 0 },
    facing: { x: 0, z: 1 },
    travelledDistance: 0,
    hp: 100,
    status: 'active',
    locomotionIntent: 'hold-range',
    velocity: { x: 0, z: 0 },
    action: { type: 'neutral' },
    staggerUntilTick: 0,
    nextDecisionTick: 1,
    nextActionSerial: 0,
    lastContactTick: 0,
    lastResolutionTick: 0,
    reactionLedger: [],
    ...overrides,
  }
}

function windupAction(definitionId: CombatActionId, phaseStartedTick: number, phaseEndsAtTick: number): CombatActionState {
  return {
    type: 'active',
    instanceId: 'a:0',
    definitionId,
    phase: 'windup',
    phaseStartedTick,
    phaseEndsAtTick,
    targetId: 'b',
    attackRolls: { accuracy: 0.5, critical: 0.5 },
  }
}

function contactAction(definitionId: CombatActionId, tick: number): CombatActionState {
  return {
    type: 'active',
    instanceId: 'a:0',
    definitionId,
    phase: 'contact',
    phaseStartedTick: tick,
    phaseEndsAtTick: tick + 1,
    targetId: 'b',
    attackRolls: { accuracy: 0.5, critical: 0.5 },
  }
}

function impactAction(definitionId: CombatActionId, phaseStartedTick: number, impactTicks: number): CombatActionState {
  return {
    type: 'active',
    instanceId: 'a:0',
    definitionId,
    phase: 'impact',
    phaseStartedTick,
    phaseEndsAtTick: phaseStartedTick + impactTicks,
    targetId: 'b',
    attackRolls: { accuracy: 0.5, critical: 0.5 },
  }
}

function recoveryAction(definitionId: CombatActionId, phaseStartedTick: number, recoveryTicks: number): CombatActionState {
  return {
    type: 'active',
    instanceId: 'a:0',
    definitionId,
    phase: 'recovery',
    phaseStartedTick,
    phaseEndsAtTick: phaseStartedTick + recoveryTicks,
    targetId: 'b',
    attackRolls: { accuracy: 0.5, critical: 0.5 },
  }
}

function defenseAction(definitionId: CombatActionId, phase: CombatActionPhase, phaseStartedTick: number, phaseEndsAtTick: number): CombatActionState {
  return {
    type: 'active',
    instanceId: 'b:0',
    definitionId,
    phase,
    phaseStartedTick,
    phaseEndsAtTick,
    targetId: 'a',
    reactingToActionId: 'a:0',
    defenseRoll: { direction: 0.5 },
  }
}

function makeInput(overrides: Partial<PoseSampleInput> & { current: FighterCombatState }): PoseSampleInput {
  const previous = overrides.previous ?? overrides.current
  return {
    previous,
    current: overrides.current,
    previousTick: overrides.previousTick ?? 0,
    currentTick: overrides.currentTick ?? 0,
    alpha: overrides.alpha ?? 0,
    reducedMotion: overrides.reducedMotion ?? false,
    reaction: overrides.reaction,
  }
}

function allTransformsFinite(pose: Readonly<Record<JointName, { rotation: readonly number[]; position?: readonly number[] }>>): boolean {
  for (const name of SEMANTIC_JOINT_NAMES) {
    const transform = pose[name]
    if (!transform) return false
    for (const value of transform.rotation) if (!Number.isFinite(value)) return false
    if (transform.position) for (const value of transform.position) if (!Number.isFinite(value)) return false
  }
  return true
}

// ---------------------------------------------------------------------------
// Step 1: layer order / progress
// ---------------------------------------------------------------------------

describe('PoseController phase progress', () => {
  it('computes render phase progress using visual time (currentTick - 1 + alpha)', () => {
    const controller = new PoseController()
    const fighter = createProceduralFighter({ archetype: 'heavy' })
    const current = baseFighterState('heavy', { action: windupAction('heavy-shield-jab', 10, 24) })
    const input = makeInput({ current, previousTick: 14, currentTick: 15, alpha: 0.5 })

    const sample = controller.apply(input, fighter)

    const expected = (15 - 1 + 0.5 - 10) / (24 - 10)
    expect(sample.phaseProgress).toBeCloseTo(expected)
    expect(allTransformsFinite(sample.pose)).toBe(true)
    fighter.dispose()
  })

  it('clamps phase progress to 0..1 for stale/edge tick-alpha combinations', () => {
    const controller = new PoseController()
    const fighter = createProceduralFighter({ archetype: 'heavy' })

    const beforeStart = baseFighterState('heavy', { action: windupAction('heavy-shield-jab', 50, 64) })
    const before = controller.apply(makeInput({ current: beforeStart, previousTick: 9, currentTick: 10, alpha: 0 }), fighter)
    expect(before.phaseProgress).toBe(0)

    const afterEnd = baseFighterState('heavy', { action: windupAction('heavy-shield-jab', 10, 24) })
    const after = controller.apply(makeInput({ current: afterEnd, previousTick: 99, currentTick: 100, alpha: 0.99 }), fighter)
    expect(after.phaseProgress).toBe(1)

    fighter.dispose()
  })

  it('initializes a new bout at tick 0 with previous === current and finite progress/pose', () => {
    const controller = new PoseController()
    const fighter = createProceduralFighter({ archetype: 'fast' })
    const tickZero = baseFighterState('fast')
    const input = makeInput({ current: tickZero, previous: tickZero, previousTick: 0, currentTick: 0, alpha: 0 })

    const sample = controller.apply(input, fighter)

    expect(sample.phaseProgress).toBe(0)
    expect(allTransformsFinite(sample.pose)).toBe(true)
    fighter.dispose()
  })
})

// ---------------------------------------------------------------------------
// Layer order (proven as an order, not only an outcome)
// ---------------------------------------------------------------------------

describe('PoseController fixed layer order', () => {
  it('applies recognition-flinch, then defense, then stagger, then defeat, each overriding the last', () => {
    const controller = new PoseController()
    const fighter = createProceduralFighter({ archetype: 'heavy' })
    const guardChest = COMBAT_POSES.styles.heavy.guard.joints.chest!.rotation
    const flinchChest = COMBAT_POSES.styles.heavy.recognitionFlinch.joints.chest!.rotation
    const defenseChest = COMBAT_POSES.defenses['heavy-guard'].joints.chest!.rotation
    const staggerChest = COMBAT_POSES.styles.heavy.stagger.joints.chest!.rotation
    const defeatChest = COMBAT_POSES.styles.heavy.defeat.joints.chest!.rotation

    // (a) baseline neutral: guard only. `reducedMotion: true` isolates this
    // from the idle layer's own breathing sway (Task 3) -- exactly zero
    // under reduced motion -- since this case is about layer *order*, not
    // idle.
    const neutral = baseFighterState('heavy')
    const baseline = controller.apply(makeInput({ current: neutral, currentTick: 0, reducedMotion: true }), fighter)
    expect(baseline.pose.chest.rotation).toEqual(guardChest)

    // (b) recognition-flinch overlay active.
    const declined = controller.apply(
      makeInput({ current: neutral, currentTick: 5, reaction: { defenseDeclinedTick: 5 } }),
      fighter,
    )
    expect(declined.pose.chest.rotation).toEqual(flinchChest)
    expect(declined.pose.chest.rotation).not.toEqual(defenseChest)

    // (c) an active heavy-guard defense in its held impact phase overrides the flinch.
    const defending = baseFighterState('heavy', { action: impactAction('heavy-guard', 3, 4) })
    const blocking = controller.apply(
      makeInput({ current: defending, currentTick: 5, reaction: { defenseDeclinedTick: 5 } }),
      fighter,
    )
    expect(blocking.pose.chest.rotation).toEqual(defenseChest)
    expect(blocking.pose.chest.rotation).not.toEqual(flinchChest)

    // (d) stagger overrides the still-active defense.
    const staggered = baseFighterState('heavy', { action: impactAction('heavy-guard', 3, 4), staggerUntilTick: 40 })
    const stagger = controller.apply(
      makeInput({ current: staggered, currentTick: 5, reaction: { defenseDeclinedTick: 5 } }),
      fighter,
    )
    expect(stagger.pose.chest.rotation).toEqual(staggerChest)
    expect(stagger.pose.chest.rotation).not.toEqual(defenseChest)

    // (e) defeat overrides everything, including stagger.
    const defeated = baseFighterState('heavy', {
      action: impactAction('heavy-guard', 3, 4),
      staggerUntilTick: 40,
      status: 'defeated',
    })
    const defeat = controller.apply(
      makeInput({ current: defeated, currentTick: 5, reaction: { defenseDeclinedTick: 5 } }),
      fighter,
    )
    expect(defeat.pose.chest.rotation).toEqual(defeatChest)
    expect(defeat.pose.chest.rotation).not.toEqual(staggerChest)

    fighter.dispose()
  })

  const DEFENSE_ID_BY_ARCHETYPE: Readonly<Record<Archetype, keyof typeof COMBAT_POSES.defenses>> = {
    heavy: 'heavy-guard',
    fast: 'fast-evade',
    technical: 'technical-parry',
  }

  it.each(['heavy', 'fast', 'technical'] as const)('never raises the full defense pose for a declined defense (recognition-flinch only) for %s', (archetype) => {
    const controller = new PoseController()
    const fighter = createProceduralFighter({ archetype })
    const neutral = baseFighterState(archetype)

    const sample = controller.apply(
      makeInput({ current: neutral, currentTick: 5, reaction: { defenseDeclinedTick: 5 } }),
      fighter,
    )

    // Only assert on the joints the style's own defense pose actually
    // *distinguishes* from guard -- joints the defense pose leaves equal to
    // guard would trivially "match" here too, since recognition-flinch only
    // touches head/chest and otherwise also falls back to guard.
    const defensePose = COMBAT_POSES.defenses[DEFENSE_ID_BY_ARCHETYPE[archetype]]
    const guard = COMBAT_POSES.styles[archetype].guard
    for (const [joint, transform] of Object.entries(defensePose.joints)) {
      const guardValue = guard.joints[joint as JointName]?.rotation
      if (guardValue && transform!.rotation.every((v, i) => v === guardValue[i])) continue
      expect(sample.pose[joint as JointName].rotation, `${joint} should not show the raised defense pose`).not.toEqual(transform!.rotation)
    }
    fighter.dispose()
  })

  it('carries no recognition-flinch state into a freshly constructed controller -- the only reset a new bout performs', () => {
    // `ArenaView` rebuilds every rig (and therefore every controller) at each
    // new bout instead of resetting one in place, so this is exactly what a
    // bout boundary does: the flinch window must not survive it.
    const fighter = createProceduralFighter({ archetype: 'heavy' })
    const neutral = baseFighterState('heavy')
    const guardChest = COMBAT_POSES.styles.heavy.guard.joints.chest!.rotation

    const flinched = new PoseController()
    const duringFlinch = flinched.apply(makeInput({ current: neutral, currentTick: 5, reaction: { defenseDeclinedTick: 5 } }), fighter)
    expect(duringFlinch.pose.chest.rotation).not.toEqual(guardChest) // the flinch really is visible on this controller

    // `reducedMotion: true` isolates this from idle sway (Task 3) for the
    // same reason as the baseline case above: this asserts the flinch window
    // itself resets, not anything about idle.
    const after = new PoseController().apply(makeInput({ current: neutral, currentTick: 6, reducedMotion: true }), fighter)
    expect(after.pose.chest.rotation).toEqual(guardChest)
    fighter.dispose()
  })
})

// ---------------------------------------------------------------------------
// Impact hold (presentation-only hitstop)
// ---------------------------------------------------------------------------

describe('PoseController impact hold', () => {
  it('holds the action pose unchanged across alpha during the impact phase', () => {
    const controller = new PoseController()
    const fighter = createProceduralFighter({ archetype: 'heavy' })
    const current = baseFighterState('heavy', { action: impactAction('heavy-cleave', 40, 6) })

    const samples = [0, 0.1, 0.5, 0.9, 0.999].map((alpha) =>
      controller.apply(makeInput({ current, currentTick: 41, alpha }), fighter),
    )

    for (const sample of samples.slice(1)) {
      expect(sample.pose).toEqual(samples[0].pose)
    }
    fighter.dispose()
  })

  it('holds the action pose unchanged across every tick inside the impact window', () => {
    const controller = new PoseController()
    const fighter = createProceduralFighter({ archetype: 'heavy' })
    const current = baseFighterState('heavy', { action: impactAction('heavy-cleave', 40, 6) })

    const samples = [40, 42, 45].map((tick) => controller.apply(makeInput({ current, currentTick: tick, alpha: 0.4 }), fighter))

    for (const sample of samples.slice(1)) {
      expect(sample.pose).toEqual(samples[0].pose)
    }
    fighter.dispose()
  })

  it('gives a rapid probe only its already-authored short impact, never an extra freeze', () => {
    // fast-slash has impactTicks = 2. The impact phase's own window (2 ticks)
    // is entirely what the "hold" is -- there is no separate/longer freeze on
    // top of it.
    const controller = new PoseController()
    const fighter = createProceduralFighter({ archetype: 'fast' })
    const current = baseFighterState('fast', { action: impactAction('fast-slash', 10, 2) })
    const held = controller.apply(makeInput({ current, currentTick: 10, alpha: 0 }), fighter)

    const recovering = baseFighterState('fast', { action: recoveryAction('fast-slash', 12, 15) })
    const afterHold = controller.apply(makeInput({ current: recovering, currentTick: 20, alpha: 0 }), fighter)

    expect(afterHold.pose).not.toEqual(held.pose)
    fighter.dispose()
  })

  it('settles the last part of recovery onto the authored return pose instead of snapping to guard at neutral', () => {
    // `heavy-cleave`, recovery spanning ticks 40..60. The authored `return`
    // pose IS the style guard, so "settled" means the final recovery frame
    // already reads as the guard the neutral frame will show.
    const controller = new PoseController()
    const fighter = createProceduralFighter({ archetype: 'heavy' })
    const guardArm = COMBAT_POSES.styles.heavy.guard.joints['upperArm.R']!.rotation

    const recovering = baseFighterState('heavy', { action: recoveryAction('heavy-cleave', 40, 20) })
    // `computePhaseProgress` reads `currentTick - 1 + alpha`, so these are
    // progress ~0.3 (mid follow-through) and ~1.0 (the phase's last frame).
    const early = controller.apply(makeInput({ current: recovering, currentTick: 47, alpha: 0 }), fighter)
    const late = controller.apply(makeInput({ current: recovering, currentTick: 60, alpha: 0.99 }), fighter)
    const neutral = controller.apply(makeInput({ current: baseFighterState('heavy'), currentTick: 61, alpha: 0 }), fighter)

    const gap = (sample: { pose: Record<string, { rotation: readonly number[] }> }) =>
      Math.abs(sample.pose['upperArm.R'].rotation[0] - guardArm[0])

    expect(gap(early)).toBeGreaterThan(0.05) // mid-recovery still visibly holds the follow-through
    expect(gap(late)).toBeLessThan(gap(early)) // and it is on its way home by the end
    expect(gap(late)).toBeLessThan(0.02)
    expect(gap(neutral)).toBeCloseTo(0, 10)
    fighter.dispose()
  })
})

// ---------------------------------------------------------------------------
// Reduced motion: dampens overshoot, preserves anticipation/contact
// ---------------------------------------------------------------------------

describe('PoseController reduced motion', () => {
  it('preserves anticipation and contact poses under reduced motion', () => {
    const controller = new PoseController()
    const fighter = createProceduralFighter({ archetype: 'heavy' })

    const windup = baseFighterState('heavy', { action: windupAction('heavy-cleave', 0, 34) })
    // phaseProgress = 0.3 reaches the front-loaded anticipation lead-in fully.
    const normalAnticipation = controller.apply(makeInput({ current: windup, currentTick: 11, alpha: 0.2 }), fighter)
    const reducedAnticipation = controller.apply(
      makeInput({ current: windup, currentTick: 11, alpha: 0.2, reducedMotion: true }),
      fighter,
    )
    expect(reducedAnticipation.pose).toEqual(normalAnticipation.pose)

    const contact = baseFighterState('heavy', { action: contactAction('heavy-cleave', 34) })
    const normalContact = controller.apply(makeInput({ current: contact, currentTick: 35, alpha: 1 }), fighter)
    const reducedContact = controller.apply(makeInput({ current: contact, currentTick: 35, alpha: 1, reducedMotion: true }), fighter)
    expect(reducedContact.pose).toEqual(normalContact.pose)

    fighter.dispose()
  })

  it('reduces impact overshoot magnitude without losing the result', () => {
    const controller = new PoseController()
    const fighter = createProceduralFighter({ archetype: 'heavy' })
    const impact = baseFighterState('heavy', { action: impactAction('heavy-cleave', 40, 6) })

    const normal = controller.apply(makeInput({ current: impact, currentTick: 41, alpha: 0.2 }), fighter)
    const reduced = controller.apply(makeInput({ current: impact, currentTick: 41, alpha: 0.2, reducedMotion: true }), fighter)

    const normalArm = normal.pose['upperArm.R'].rotation[0]
    const reducedArm = reduced.pose['upperArm.R'].rotation[0]
    const contactArm = COMBAT_POSES.attacks['heavy-cleave'].contact.joints['upperArm.R']!.rotation[0]

    expect(reducedArm).not.toBeCloseTo(normalArm, 4)
    // Reduced motion's impact value sits strictly between the contact
    // baseline and the full (non-reduced) impact overshoot.
    const fullDelta = Math.abs(normalArm - contactArm)
    const reducedDelta = Math.abs(reducedArm - contactArm)
    expect(reducedDelta).toBeLessThan(fullDelta)
    expect(reducedDelta).toBeGreaterThan(0)

    fighter.dispose()
  })
})

// ---------------------------------------------------------------------------
// Gait: derived from travelled distance, not wall-clock time
// ---------------------------------------------------------------------------

describe('PoseController gait', () => {
  it('yields identical legs for equal interpolated travelled distance regardless of wall-clock tick/alpha shape', () => {
    const controller = new PoseController()
    const fighter = createProceduralFighter({ archetype: 'heavy' })

    const velocity: Vec2 = { x: 0, z: 1.4 }
    // Scenario A: a single tick step interpolated halfway.
    const prevA = baseFighterState('heavy', { travelledDistance: 0.4, velocity })
    const currA = baseFighterState('heavy', { travelledDistance: 0.6, velocity })
    const sampleA = controller.apply(makeInput({ previous: prevA, current: currA, previousTick: 9, currentTick: 10, alpha: 0.5 }), fighter)

    // Scenario B: many ticks elapsed (different "wall time"/tick count) but
    // interpolates to the exact same travelled distance and velocity.
    const controllerB = new PoseController()
    const prevB = baseFighterState('heavy', { travelledDistance: 0.5, velocity })
    const currB = baseFighterState('heavy', { travelledDistance: 0.5, velocity })
    const sampleB = controllerB.apply(makeInput({ previous: prevB, current: currB, previousTick: 499, currentTick: 500, alpha: 0.5 }), fighter)

    expect(sampleA.pose['upperLeg.L']).toEqual(sampleB.pose['upperLeg.L'])
    expect(sampleA.pose['upperLeg.R']).toEqual(sampleB.pose['upperLeg.R'])
    expect(sampleA.plantedFoot).toBe(sampleB.plantedFoot)

    fighter.dispose()
  })

  it('reports deterministic planted-foot transitions across a full gait cycle', () => {
    const controller = new PoseController()
    const fighter = createProceduralFighter({ archetype: 'fast' })
    const velocity: Vec2 = { x: 0, z: 2 }
    const seen = new Set<string>()

    for (let step = 0; step <= 20; step += 1) {
      const distance = (step / 20) * 0.95 // fast's full authored cycle distance
      const state = baseFighterState('fast', { travelledDistance: distance, velocity })
      const sample = controller.apply(makeInput({ current: state, previous: state, currentTick: step, alpha: 0 }), fighter)
      seen.add(sample.plantedFoot)
    }

    expect(seen.has('left')).toBe(true)
    expect(seen.has('right')).toBe(true)
    expect(seen.has('both')).toBe(true)
    fighter.dispose()
  })

  it.each(['heavy', 'fast', 'technical'] as const)(
    'keeps arm/forearm joints identical between gait halves at matching stride envelope, while legs differ (%s)',
    (archetype) => {
      // Task 16 review Finding 1: the gait mirror must be scoped to leg
      // joints only. Guard poses deliberately give the weapon and shield
      // arms different values (most starkly for Technical, whose own
      // `locomotion` pose never overrides upperArm/forearm at all -- they
      // reach `applyGaitLayer` purely via `mergeJoints(guard.joints, ...)`),
      // so a half-B mirror that swapped every joint present in
      // `locomotion.joints` would periodically swap those asymmetric arm
      // values between hands. Sampling two travelled distances that land on
      // each half's peak stride envelope (so weights match exactly) proves
      // arms/forearms never depend on which half is active, while legs still
      // genuinely alternate.
      const controller = new PoseController()
      const fighter = createProceduralFighter({ archetype })
      const velocity: Vec2 = { x: 0, z: 2 }
      const cycle = STYLE_GAIT_CYCLE_DISTANCE[archetype]

      const halfAState = baseFighterState(archetype, { travelledDistance: cycle * 0.25, velocity })
      const sampleA = controller.apply(makeInput({ current: halfAState, previous: halfAState, currentTick: 1, alpha: 0 }), fighter)

      const halfBState = baseFighterState(archetype, { travelledDistance: cycle * 0.75, velocity })
      const sampleB = controller.apply(makeInput({ current: halfBState, previous: halfBState, currentTick: 2, alpha: 0 }), fighter)

      for (const joint of ['upperArm.L', 'upperArm.R', 'forearm.L', 'forearm.R'] as const) {
        expect(sampleB.pose[joint], `${joint} should not change between gait halves`).toEqual(sampleA.pose[joint])
      }

      // Sanity: legs genuinely do alternate between halves (the mirror still
      // works where it should).
      expect(sampleB.pose['upperLeg.L']).not.toEqual(sampleA.pose['upperLeg.L'])
      expect(sampleB.pose['upperLeg.R']).not.toEqual(sampleA.pose['upperLeg.R'])

      fighter.dispose()
    },
  )

  it('produces finite leg transforms while idle (zero velocity, zero travelled distance)', () => {
    const controller = new PoseController()
    const fighter = createProceduralFighter({ archetype: 'technical' })
    const idle = baseFighterState('technical')
    const sample = controller.apply(makeInput({ current: idle }), fighter)
    expect(allTransformsFinite(sample.pose)).toBe(true)
    fighter.dispose()
  })
})

// ---------------------------------------------------------------------------
// Capped weapon-arm IK
// ---------------------------------------------------------------------------

describe('PoseController weapon-arm IK', () => {
  function shoulderToWeaponTipDistance(fighter: ReturnType<typeof createProceduralFighter>, pose: Readonly<Record<JointName, { rotation: readonly [number, number, number]; position?: readonly [number, number, number] }>>): number {
    fighter.root.position.set(0, 0, 0)
    fighter.root.quaternion.identity()
    for (const name of SEMANTIC_JOINT_NAMES) {
      // `'root'` deliberately has no `fighter.joints` entry (see
      // `ProceduralFighter.ts`'s `SEMANTIC_JOINT_NAMES` comment) -- this
      // mirrors the same `if (!joint) continue` guard every production
      // pose-application loop uses.
      const joint = fighter.joints.get(name)
      if (!joint) continue
      const transform = pose[name]
      joint.rotation.set(transform.rotation[0], transform.rotation[1], transform.rotation[2])
      if (transform.position) joint.position.set(transform.position[0], transform.position[1], transform.position[2])
    }
    fighter.root.updateMatrixWorld(true)
    const shoulder = new THREE.Vector3()
    fighter.joints.get('upperArm.R')!.getWorldPosition(shoulder)
    const tip = new THREE.Vector3()
    fighter.anchors.get('weaponTip')!.getWorldPosition(tip)
    return shoulder.distanceTo(tip)
  }

  it('leaves the authored pose unchanged when the target is outside the cosmetic cap', () => {
    const controller = new PoseController()
    const fighter = createProceduralFighter({ archetype: 'technical' })
    const current = baseFighterState('technical', { action: contactAction('technical-thrust', 20), position: { x: 0, z: 0 }, facing: { x: 0, z: 1 } })

    const withoutIk = controller.apply(makeInput({ current, currentTick: 21, alpha: 0 }), fighter)
    const farTarget: Vec2 = { x: 20, z: 20 }
    const withIk = controller.apply(makeInput({ current, currentTick: 21, alpha: 0, reaction: { contactTarget: farTarget } }), fighter)

    expect(withIk.pose['upperArm.R']).toEqual(withoutIk.pose['upperArm.R'])
    expect(withIk.pose['forearm.R']).toEqual(withoutIk.pose['forearm.R'])
    fighter.dispose()
  })

  it('never lets the weapon tip exceed the authored cosmetic reach cap, and reaches closer when within it', () => {
    const controller = new PoseController()
    const fighter = createProceduralFighter({ archetype: 'technical' })
    const current = baseFighterState('technical', { action: contactAction('technical-thrust', 20), position: { x: 0, z: 0 }, facing: { x: 0, z: 1 } })

    const withoutIk = controller.apply(makeInput({ current, currentTick: 21, alpha: 0 }), fighter)
    const authoredReach = shoulderToWeaponTipDistance(fighter, withoutIk.pose)

    const nearTarget: Vec2 = { x: 0.15, z: 1.3 }
    const withIk = controller.apply(makeInput({ current, currentTick: 21, alpha: 0, reaction: { contactTarget: nearTarget } }), fighter)
    const ikReach = shoulderToWeaponTipDistance(fighter, withIk.pose)

    // The solve actually engaged: a within-cap target must move the arm.
    // Without this, a permanently-disabled IK solve (always returning `{}`)
    // would pass the cap assertion below vacuously, since `authoredReach` is
    // always `<= cap` by construction (Task 16 review Finding 2).
    expect(withIk.pose['upperArm.R']).not.toEqual(withoutIk.pose['upperArm.R'])

    // Never stretched beyond the authored cosmetic cap (a fixed ratio above
    // the authored pose's own reach).
    expect(ikReach).toBeLessThanOrEqual(authoredReach * 1.2 + 1e-6)

    const farTarget: Vec2 = { x: 20, z: 20 }
    const withFarIk = controller.apply(makeInput({ current, currentTick: 21, alpha: 0, reaction: { contactTarget: farTarget } }), fighter)
    const farReach = shoulderToWeaponTipDistance(fighter, withFarIk.pose)
    expect(farReach).toBeLessThanOrEqual(authoredReach * 1.2 + 1e-6)

    fighter.dispose()
  })

  // The solver is *gated*, not merely clamped: outside the cosmetic reach cap
  // it returns `{}` and the authored pose wins untouched. That cap is derived
  // from the rig's own authored shoulder-to-`weaponTip` reach, so anything
  // that moves the weapon tip -- `weaponLength`, `weaponForwardBias`, the
  // authored thrust pose, an arm bone length -- moves the boundary and
  // re-animates every strike that crosses it, in both directions: strikes
  // that used to keep their authored arm now bend toward the target, and
  // `|elbow -> tip|` changes the elbow angle of the ones that already bent.
  // Task 3 moved it once (the tip anchor now sits at the weapon's real point
  // rather than at 0.707 of its length) and nothing failed, which is why this
  // test exists: the bracket below is deliberately tight, and a change that
  // shifts the boundary is meant to fail here and be re-ratified on purpose.
  //
  // Frozen for the shipped `technical` (Hoplomachus) rig mid-thrust, as the
  // straight-ahead contact-target distance at which the gate flips. Measured
  // black-box by bisecting on "did the arm move?", so this pins observable
  // behaviour and mirrors no internal constant.
  const IK_ENGAGES_AT_DISTANCE = 1.55
  const IK_SKIPS_AT_DISTANCE = 1.59

  it('gates the weapon-arm IK at a frozen reach boundary rather than easing across it', () => {
    const controller = new PoseController()
    const fighter = createProceduralFighter({ archetype: 'technical' })
    const current = baseFighterState('technical', { action: contactAction('technical-thrust', 20), position: { x: 0, z: 0 }, facing: { x: 0, z: 1 } })

    const withoutIk = controller.apply(makeInput({ current, currentTick: 21, alpha: 0 }), fighter)
    const authoredArm = JSON.stringify([withoutIk.pose['upperArm.R'], withoutIk.pose['forearm.R']])

    // Engaged == the solve returned something: the weapon arm no longer holds
    // exactly the authored rotations. A skipped solve returns `{}`, so the
    // authored pose survives byte-identical.
    const ikEngagesAt = (distance: number): boolean => {
      const sample = controller.apply(
        makeInput({ current, currentTick: 21, alpha: 0, reaction: { contactTarget: { x: 0, z: distance } } }),
        fighter,
      )
      return JSON.stringify([sample.pose['upperArm.R'], sample.pose['forearm.R']]) !== authoredArm
    }

    // The two frozen distances straddle the gate.
    expect(ikEngagesAt(IK_ENGAGES_AT_DISTANCE), `IK should still engage at ${IK_ENGAGES_AT_DISTANCE}`).toBe(true)
    expect(ikEngagesAt(IK_SKIPS_AT_DISTANCE), `IK should already be skipped at ${IK_SKIPS_AT_DISTANCE}`).toBe(false)

    // And the real boundary is between them, not merely somewhere outside the
    // pair -- bisected so that a boundary that drifts anywhere out of this
    // 0.04-unit window fails with the number it drifted to.
    let engaged = 0.5
    let skipped = 6
    expect(ikEngagesAt(engaged)).toBe(true)
    expect(ikEngagesAt(skipped)).toBe(false)
    for (let i = 0; i < 40; i += 1) {
      const middle = (engaged + skipped) / 2
      if (ikEngagesAt(middle)) engaged = middle
      else skipped = middle
    }
    const boundary = (engaged + skipped) / 2
    expect(boundary, 'weapon-arm IK reach boundary moved').toBeGreaterThan(IK_ENGAGES_AT_DISTANCE)
    expect(boundary, 'weapon-arm IK reach boundary moved').toBeLessThan(IK_SKIPS_AT_DISTANCE)

    fighter.dispose()
  })

  it('never moves the root and never touches bone lengths (only upperArm.R/forearm.R rotate)', () => {
    const controller = new PoseController()
    const fighter = createProceduralFighter({ archetype: 'technical' })
    const current = baseFighterState('technical', { action: contactAction('technical-thrust', 20), position: { x: 1, z: 2 }, facing: { x: 0, z: 1 } })

    const nearTarget: Vec2 = { x: 0.1, z: 1.2 }
    const sample = controller.apply(makeInput({ current, currentTick: 21, alpha: 0, reaction: { contactTarget: nearTarget } }), fighter)

    expect(sample.pose.root).toEqual({ rotation: [0, 0, 0] })
    fighter.dispose()
  })
})

// ---------------------------------------------------------------------------
// Idle layer: keeps a standing fighter alive between ticks
// ---------------------------------------------------------------------------

describe('PoseController idle layer', () => {
  function neutralStandingInput(overrides: { tick: number; reducedMotion?: boolean; archetype?: Archetype }): PoseSampleInput {
    const state = baseFighterState(overrides.archetype ?? 'heavy')
    return makeInput({ current: state, previous: state, currentTick: overrides.tick, alpha: 0, reducedMotion: overrides.reducedMotion ?? false })
  }

  function impactHoldInput(overrides: { tick: number }): PoseSampleInput {
    const state = baseFighterState('heavy', { action: impactAction('heavy-cleave', 40, 6) })
    return makeInput({ current: state, previous: state, currentTick: overrides.tick, alpha: 0 })
  }

  it('keeps a standing fighter alive between ticks', () => {
    const controller = new PoseController()
    const fighter = createProceduralFighter({ archetype: 'heavy' })
    const standing = neutralStandingInput({ tick: 100 })
    const later = neutralStandingInput({ tick: 130 })

    const first = controller.apply(standing, fighter)
    const second = controller.apply(later, fighter)

    expect(second.pose).not.toEqual(first.pose)
    fighter.dispose()
  })

  it('is perfectly still under reduced motion', () => {
    const controller = new PoseController()
    const fighter = createProceduralFighter({ archetype: 'heavy' })
    const first = controller.apply(neutralStandingInput({ tick: 100, reducedMotion: true }), fighter)
    const second = controller.apply(neutralStandingInput({ tick: 130, reducedMotion: true }), fighter)

    expect(second.pose).toEqual(first.pose)
    fighter.dispose()
  })

  it('does not breathe through a held impact pose', () => {
    const controller = new PoseController()
    const fighter = createProceduralFighter({ archetype: 'heavy' })
    const first = controller.apply(impactHoldInput({ tick: 100 }), fighter)
    const second = controller.apply(impactHoldInput({ tick: 130 }), fighter)

    expect(second.pose).toEqual(first.pose)
    fighter.dispose()
  })

  it('leaves a planted foot exactly where grounding puts it', () => {
    // Note: this is a regression guard only, not idle coverage. `sampleIdleLayer`
    // never writes leg/foot joints at all (see `idle.test.ts`'s own "never
    // writes leg or foot joints" test), so this compares joints the idle
    // layer never touches -- it would pass identically whether idle merged
    // additively, replaced outright, or did nothing.
    const controller = new PoseController()
    const fighter = createProceduralFighter({ archetype: 'heavy' })
    const standing = neutralStandingInput({ tick: 100 })
    const later = neutralStandingInput({ tick: 130 })

    const first = controller.apply(standing, fighter)
    const second = controller.apply(later, fighter)

    for (const name of ['foot.L', 'foot.R', 'upperLeg.L', 'upperLeg.R'] as const) {
      expect(second.pose[name]).toEqual(first.pose[name])
    }
    fighter.dispose()
  })

  it('preserves the authored guard chest twist while idle sways it (Fast)', () => {
    // Regression coverage for the bug the additive-merge fix addresses:
    // Fast's guard chest carries an authored 0.1 rad twist (FAST_GUARD in
    // combatPoses.ts) that is part of what makes the fighter's shoulder line
    // read as oriented. `sampleIdleLayer` never writes a chest Y rotation
    // (its own delta is `[breath, 0, -swing * 0.4]`), so with a correct
    // additive merge the authored 0.1 must survive exactly regardless of
    // idle phase. Against the old `mergeInto` (outright replace), idle would
    // instead overwrite the whole chest transform with its own, snapping Y
    // to 0 the instant any idle amplitude was non-zero.
    const controller = new PoseController()
    const fighter = createProceduralFighter({ archetype: 'fast' })
    const standing = neutralStandingInput({ tick: 100, archetype: 'fast' })

    const sample = controller.apply(standing, fighter)

    expect(sample.pose.chest.rotation[1]).toBeCloseTo(0.1, 10)
    // The Y assertion alone would pass identically if the idle layer were
    // deleted outright, since `sampleIdleLayer` never writes Y. Prove idle
    // actually ran by checking its Z contribution (`-swing * 0.4`): FAST_GUARD
    // authors chest Z as exactly `0`, so any non-zero Z here can only be the
    // idle sway, not the guard pose.
    expect(Math.abs(sample.pose.chest.rotation[2])).toBeGreaterThan(1e-4)
    fighter.dispose()
  })

  it('does not step the chest pose when a fighter stops from full gait speed to standing in one tick (Fast)', () => {
    // With no acceleration model, velocity (and therefore idle amplitude,
    // which is `1 - speedWeight`) can go from full speed to a standstill in
    // a single tick -- exactly the start/stop boundary the branch's own
    // second goal (movement reading less jerky) cares about. Before the
    // additive-merge fix, that boundary was also the moment idle's
    // `mergeInto` started outright replacing the chest transform, so a
    // standing Fast fighter's chest could pop by up to the guard/idle
    // difference (~0.13 rad, roughly 7 degrees) on the very tick it planted.
    // With the additive merge the only possible step is idle's own small
    // sway amplitude, independent of the guard pose it now merges on top of.
    const controller = new PoseController()
    const fighter = createProceduralFighter({ archetype: 'fast' })
    const moving = makeInput({ current: baseFighterState('fast', { velocity: { x: 0.5, z: 0 } }), currentTick: 100, alpha: 0 })
    const standing = makeInput({ current: baseFighterState('fast', { velocity: { x: 0, z: 0 } }), currentTick: 100, alpha: 0 })

    const movingChest = controller.apply(moving, fighter).pose.chest.rotation
    const standingChest = controller.apply(standing, fighter).pose.chest.rotation

    const step = Math.hypot(standingChest[0] - movingChest[0], standingChest[1] - movingChest[1], standingChest[2] - movingChest[2])
    expect(step).toBeLessThan(0.05)
    fighter.dispose()
  })
})

// ---------------------------------------------------------------------------
// General finiteness sweep
// ---------------------------------------------------------------------------

describe('PoseController general finiteness', () => {
  const archetypes: Archetype[] = ['heavy', 'fast', 'technical']

  it.each(archetypes)('produces finite transforms across neutral, windup, contact, impact, recovery, stagger, and defeat for %s', (archetype) => {
    const controller = new PoseController()
    const fighter = createProceduralFighter({ archetype })
    const attackId: CombatActionId = { heavy: 'heavy-cleave', fast: 'fast-slash', technical: 'technical-thrust' }[archetype] as CombatActionId

    const states: FighterCombatState[] = [
      baseFighterState(archetype),
      baseFighterState(archetype, { action: windupAction(attackId, 0, 20), travelledDistance: 0.3, velocity: { x: 0.5, z: 0.5 } }),
      baseFighterState(archetype, { action: contactAction(attackId, 20) }),
      baseFighterState(archetype, { action: impactAction(attackId, 21, 4) }),
      baseFighterState(archetype, { action: recoveryAction(attackId, 25, 20) }),
      baseFighterState(archetype, { staggerUntilTick: 999 }),
      baseFighterState(archetype, { status: 'defeated' }),
      baseFighterState(archetype, { action: defenseAction('heavy-guard', 'windup', 0, 8) }),
    ]

    for (const [index, state] of states.entries()) {
      const sample = controller.apply(makeInput({ current: state, currentTick: 25 + index, alpha: 0.37 }), fighter)
      expect(allTransformsFinite(sample.pose), `state #${index} produced a non-finite transform`).toBe(true)
      expect(Number.isFinite(sample.phaseProgress)).toBe(true)
    }

    fighter.dispose()
  })
})
