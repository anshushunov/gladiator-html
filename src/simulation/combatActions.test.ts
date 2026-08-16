import { describe, expect, it } from 'vitest'
import {
  actionContactTick,
  applyStaggerToAction,
  calculateBlockedStaggerTicks,
  calculateContactDamage,
  calculateContactPoint,
  calculateEvadeDisplacementDistance,
  calculatePushDirection,
  evadeDirectionVector,
  GUARD_DAMAGE_MULTIPLIER,
  GUARD_PUSH_MULTIPLIER,
  GUARD_STAGGER_MULTIPLIER,
  isWithinAttackGeometry,
  isWithinIncomingFacingArc,
  PARRY_ATTACKER_STAGGER_TICKS,
  rankEvadeDirections,
  selectEvadeDirection,
  startAttackAction,
  startDefenseAction,
  transitionActionPhase,
  type AttackActionDefinition,
  type CombatActionPhase,
  type CombatActionState,
} from './combatActions'
import type { CombatArenaDefinition, Vec2 } from './movement'

// Local fixture mirroring the authored `fast-slash` row (src/content/combatStyles.ts
// owns the real content catalog; this file stays independent of it, matching
// movement.test.ts's convention).
const fastSlash: AttackActionDefinition = {
  id: 'fast-slash',
  tags: ['attack', 'probe', 'weapon', 'parryable'],
  contactRange: { min: 0.9, max: 1.35 },
  minimumFacingDot: 0.4226,
  windupTicks: 10,
  impactTicks: 2,
  recoveryTicks: 15,
  damageMultiplier: 0.75,
  accuracyModifier: 0.06,
  rootTravel: 0.25,
  pushDistance: 0.18,
  staggerTicks: 8,
  contactPriority: 40,
}

describe('startAttackAction', () => {
  it('starts in windup with an exclusive phaseEndsAtTick derived from windupTicks', () => {
    const action = startAttackAction({
      actorId: 'a',
      serial: 0,
      targetId: 'b',
      definition: fastSlash,
      tick: 20,
      attackRolls: { accuracy: 0.1, critical: 0.2 },
    })

    expect(action).toMatchObject({ instanceId: 'a:0', phase: 'windup', phaseStartedTick: 20, phaseEndsAtTick: 30 })
  })

  it('derives instanceId from actorId and serial, and stores target/attackRolls', () => {
    const action = startAttackAction({
      actorId: 'brutus',
      serial: 3,
      targetId: 'drusus',
      definition: fastSlash,
      tick: 0,
      attackRolls: { accuracy: 0.5, critical: 0.9 },
    })

    expect(action).toMatchObject({
      type: 'active',
      instanceId: 'brutus:3',
      definitionId: 'fast-slash',
      targetId: 'drusus',
      attackRolls: { accuracy: 0.5, critical: 0.9 },
    })
  })
})

describe('startDefenseAction', () => {
  it('starts in windup with a dynamic phaseEndsAtTick equal to the incoming contactTick', () => {
    const defense = startDefenseAction({
      defenderId: 'b',
      serial: 0,
      attackerId: 'a',
      defenseActionId: 'technical-parry',
      reactingToActionId: 'a:0',
      tick: 20,
      contactTick: 30,
      directionRoll: 0.42,
    })

    expect(defense).toEqual({
      type: 'active',
      instanceId: 'b:0',
      definitionId: 'technical-parry',
      phase: 'windup',
      phaseStartedTick: 20,
      phaseEndsAtTick: 30,
      targetId: 'a',
      reactingToActionId: 'a:0',
      defenseRoll: { direction: 0.42 },
    })
  })

  it('derives instanceId from defenderId and serial, independent of the attacker', () => {
    const defense = startDefenseAction({
      defenderId: 'drusus',
      serial: 5,
      attackerId: 'brutus',
      defenseActionId: 'heavy-guard',
      reactingToActionId: 'brutus:2',
      tick: 0,
      contactTick: 8,
      directionRoll: 0.9,
    })

    expect(defense).toMatchObject({ instanceId: 'drusus:5', definitionId: 'heavy-guard', targetId: 'brutus' })
  })

  it('never stores attackRolls on a defense action', () => {
    const defense = startDefenseAction({
      defenderId: 'b',
      serial: 0,
      attackerId: 'a',
      defenseActionId: 'fast-evade',
      reactingToActionId: 'a:0',
      tick: 0,
      contactTick: 7,
      directionRoll: 0.1,
    })

    expect(defense).not.toHaveProperty('attackRolls')
  })
})

describe('transitionActionPhase', () => {
  const windup = startAttackAction({
    actorId: 'a',
    serial: 0,
    targetId: 'b',
    definition: fastSlash,
    tick: 20,
    attackRolls: { accuracy: 0.1, critical: 0.2 },
  })

  it('advances windup to a one-tick contact with no definition required', () => {
    expect(transitionActionPhase(windup, 30)).toMatchObject({
      phase: 'contact',
      phaseStartedTick: 30,
      phaseEndsAtTick: 31,
    })
  })

  it('advances contact to impact using definition.impactTicks', () => {
    const contact = transitionActionPhase(windup, 30)
    expect(transitionActionPhase(contact, 31, fastSlash)).toMatchObject({
      phase: 'impact',
      phaseStartedTick: 31,
      phaseEndsAtTick: 33, // + impactTicks (2)
    })
  })

  it('advances impact to recovery using definition.recoveryTicks', () => {
    const contact = transitionActionPhase(windup, 30)
    const impact = transitionActionPhase(contact, 31, fastSlash)
    expect(transitionActionPhase(impact, 33, fastSlash)).toMatchObject({
      phase: 'recovery',
      phaseStartedTick: 33,
      phaseEndsAtTick: 48, // + recoveryTicks (15)
    })
  })

  it('returns to neutral after recovery ends', () => {
    const contact = transitionActionPhase(windup, 30)
    const impact = transitionActionPhase(contact, 31, fastSlash)
    const recovery = transitionActionPhase(impact, 33, fastSlash)
    expect(transitionActionPhase(recovery, 48)).toEqual({ type: 'neutral' })
  })

  it('throws leaving contact or impact without a definition', () => {
    const contact = transitionActionPhase(windup, 30)
    expect(() => transitionActionPhase(contact, 31)).toThrow()
  })

  it('throws for an already-neutral action', () => {
    expect(() => transitionActionPhase({ type: 'neutral' }, 30)).toThrow()
  })
})

describe('actionContactTick', () => {
  it('returns phaseEndsAtTick while in windup (contact begins the instant windup ends)', () => {
    const windup = startAttackAction({
      actorId: 'a',
      serial: 0,
      targetId: 'b',
      definition: fastSlash,
      tick: 20,
      attackRolls: { accuracy: 0.1, critical: 0.2 },
    })
    expect(actionContactTick(windup)).toBe(30)
  })

  it('returns phaseStartedTick while already in contact', () => {
    const windup = startAttackAction({
      actorId: 'a',
      serial: 0,
      targetId: 'b',
      definition: fastSlash,
      tick: 20,
      attackRolls: { accuracy: 0.1, critical: 0.2 },
    })
    const contact = transitionActionPhase(windup, 30)
    expect(actionContactTick(contact)).toBe(30)
  })

  it('throws for a neutral action', () => {
    expect(() => actionContactTick({ type: 'neutral' })).toThrow()
  })

  it('throws for an action in impact or recovery', () => {
    const windup = startAttackAction({
      actorId: 'a',
      serial: 0,
      targetId: 'b',
      definition: fastSlash,
      tick: 20,
      attackRolls: { accuracy: 0.1, critical: 0.2 },
    })
    const contact = transitionActionPhase(windup, 30)
    const impact = transitionActionPhase(contact, 31, fastSlash)
    expect(() => actionContactTick(impact)).toThrow()
  })
})

describe('calculateContactPoint', () => {
  const actorPosition: Vec2 = { x: 0, z: 0 }
  const targetPosition: Vec2 = { x: 2, z: 0 }
  const actorFacing: Vec2 = { x: 1, z: 0 }

  it('places a weapon contact point at 0.60 of the separation', () => {
    expect(calculateContactPoint(actorPosition, targetPosition, actorFacing, 'weapon')).toEqual({ x: 1.2, z: 0 })
  })

  it('places a shield contact point at 0.65 of the separation', () => {
    expect(calculateContactPoint(actorPosition, targetPosition, actorFacing, 'shield')).toEqual({ x: 1.3, z: 0 })
  })

  it('places a body contact point at 0.72 of the separation', () => {
    expect(calculateContactPoint(actorPosition, targetPosition, actorFacing, 'body')).toEqual({ x: 1.44, z: 0 })
  })

  it('scales along an arbitrary (non-axis-aligned) separation vector', () => {
    const target: Vec2 = { x: 3, z: 4 } // distance 5
    const point = calculateContactPoint(actorPosition, target, actorFacing, 'weapon')
    expect(point.x).toBeCloseTo(1.8, 9) // 3/5 * 5 * 0.60
    expect(point.z).toBeCloseTo(2.4, 9) // 4/5 * 5 * 0.60
  })

  it('falls back to actor facing when actor and target roots are coincident', () => {
    const point = calculateContactPoint(actorPosition, actorPosition, { x: 0, z: 1 }, 'body')
    // distance is 0, so the point degenerates to the actor's own position
    // regardless of the fallback direction.
    expect(point).toEqual({ x: 0, z: 0 })
  })
})

describe('calculateContactDamage', () => {
  it('applies the full formula: power * damageMultiplier * comparison * critical * block, rounded', () => {
    // power 22 * damageMultiplier 0.75 * comparison 1.10 (advantage) * critical 1 * block 1
    // = 18.15 -> rounds to 18
    expect(calculateContactDamage(22, 0.75, 1.10, 1, 1)).toBe(18)
  })

  it('applies neutral comparison (1.00)', () => {
    expect(calculateContactDamage(22, 0.75, 1.00, 1, 1)).toBe(17) // 16.5 -> rounds to 17 (round-half-up)
  })

  it('applies disadvantage comparison (0.90)', () => {
    expect(calculateContactDamage(22, 0.75, 0.90, 1, 1)).toBe(15) // 14.85 -> rounds to 15
  })

  it('applies the critical multiplier (1.5)', () => {
    expect(calculateContactDamage(22, 0.75, 1.00, 1.5, 1)).toBe(25) // 24.75 -> 25
  })

  it('applies the guard block multiplier (0.35)', () => {
    expect(calculateContactDamage(22, 0.75, 1.00, 1, 0.35)).toBe(6) // 5.775 -> 6
  })

  it('never rounds below 1 even for a tiny result', () => {
    expect(calculateContactDamage(1, 0.01, 0.90, 1, 0.35)).toBe(1)
  })
})

// ---------------------------------------------------------------------------
// Task 9: pure contact-resolution helpers (guard/parry multipliers, geometry
// gates, push direction, Fast evade dash math). The stateful orchestration
// (`resolveContactIntents`-equivalent phase 9/10 wiring) lives in
// `encounter.ts`/`encounter.test.ts` since it needs `FighterCombatState`/
// `EncounterEvent`, which this file cannot import without a circular
// dependency (encounter.ts already imports this file).
// ---------------------------------------------------------------------------

describe('guard/parry multiplier constants', () => {
  it('matches design.md exactly: damage 0.35, push 0.30, stagger 0.40, parry-attacker stagger 24', () => {
    expect(GUARD_DAMAGE_MULTIPLIER).toBe(0.35)
    expect(GUARD_PUSH_MULTIPLIER).toBe(0.30)
    expect(GUARD_STAGGER_MULTIPLIER).toBe(0.40)
    expect(PARRY_ATTACKER_STAGGER_TICKS).toBe(24)
  })
})

describe('calculateBlockedStaggerTicks', () => {
  it('applies max(1, round(base * 0.40))', () => {
    expect(calculateBlockedStaggerTicks(24)).toBe(10) // 9.6 -> 10
    expect(calculateBlockedStaggerTicks(8)).toBe(3) // 3.2 -> 3
  })

  it('never rounds below 1', () => {
    expect(calculateBlockedStaggerTicks(1)).toBe(1) // 0.4 -> floors to 0, clamped to 1
  })
})

describe('isWithinAttackGeometry', () => {
  const actorPosition: Vec2 = { x: 0, z: 0 }
  const actorFacing: Vec2 = { x: 1, z: 0 }
  const contactRange = { min: 0.9, max: 1.35 }
  const minimumFacingDot = 0.4226

  it('is true when the target is within range and inside the facing sector', () => {
    expect(isWithinAttackGeometry(actorPosition, actorFacing, { x: 1.2, z: 0 }, contactRange, minimumFacingDot)).toBe(true)
  })

  it('is false when the target is closer than contactRange.min', () => {
    expect(isWithinAttackGeometry(actorPosition, actorFacing, { x: 0.5, z: 0 }, contactRange, minimumFacingDot)).toBe(false)
  })

  it('is false when the target is farther than contactRange.max', () => {
    expect(isWithinAttackGeometry(actorPosition, actorFacing, { x: 2, z: 0 }, contactRange, minimumFacingDot)).toBe(false)
  })

  it('is false when the target is in range but outside the facing sector', () => {
    // distance 1.2, but directly to the side: dot(facing, towardTarget) = 0 < 0.4226.
    expect(isWithinAttackGeometry(actorPosition, actorFacing, { x: 0, z: 1.2 }, contactRange, minimumFacingDot)).toBe(false)
  })

  it('treats coincident roots as directly in front (degenerate distance 0, likely fails range anyway)', () => {
    expect(isWithinAttackGeometry(actorPosition, actorFacing, actorPosition, { min: 0, max: 1 }, minimumFacingDot)).toBe(true)
  })
})

describe('isWithinIncomingFacingArc', () => {
  const defenderPosition: Vec2 = { x: 0, z: 0 }
  const defenderFacing: Vec2 = { x: 1, z: 0 }

  it('is true when the attacker sits inside the incoming-facing arc (heavy-guard front ~70°)', () => {
    expect(isWithinIncomingFacingArc(defenderFacing, defenderPosition, { x: 1, z: 0 }, 0.3420)).toBe(true)
  })

  it('is false when the attacker sits outside the incoming-facing arc', () => {
    expect(isWithinIncomingFacingArc(defenderFacing, defenderPosition, { x: 0, z: 1 }, 0.3420)).toBe(false)
  })

  it('is true for technical-parry-style wide gates just past the side (~96°)', () => {
    // dx=-0.1, dz=1 -> dot ~= -0.0995, inside the -0.1736 (~front ±100°) gate.
    expect(isWithinIncomingFacingArc(defenderFacing, defenderPosition, { x: -0.1, z: 1 }, -0.1736)).toBe(true)
  })

  it('is false just outside a wide gate, from nearly directly behind', () => {
    // dx=-1, dz=0.05 -> dot ~= -0.99875, outside the -0.1736 gate.
    expect(isWithinIncomingFacingArc(defenderFacing, defenderPosition, { x: -1, z: 0.05 }, -0.1736)).toBe(false)
  })

  it('falls back to true for coincident roots', () => {
    expect(isWithinIncomingFacingArc(defenderFacing, defenderPosition, defenderPosition, 0.99)).toBe(true)
  })
})

describe('calculatePushDirection', () => {
  it('points from the actor toward the target', () => {
    expect(calculatePushDirection({ x: 0, z: 0 }, { x: 2, z: 0 }, { x: 1, z: 0 })).toEqual({ x: 1, z: 0 })
  })

  it('normalizes an arbitrary separation vector', () => {
    const direction = calculatePushDirection({ x: 0, z: 0 }, { x: 3, z: 4 }, { x: 1, z: 0 })
    expect(direction.x).toBeCloseTo(0.6, 9)
    expect(direction.z).toBeCloseTo(0.8, 9)
  })

  it('falls back to actor facing for coincident roots', () => {
    expect(calculatePushDirection({ x: 5, z: 5 }, { x: 5, z: 5 }, { x: 0, z: 1 })).toEqual({ x: 0, z: 1 })
  })
})

describe('calculateEvadeDisplacementDistance', () => {
  it('is 0.9 + 0.3 * directionRoll', () => {
    expect(calculateEvadeDisplacementDistance(0)).toBeCloseTo(0.9, 9)
    expect(calculateEvadeDisplacementDistance(1)).toBeCloseTo(1.2, 9)
    expect(calculateEvadeDisplacementDistance(0.5)).toBeCloseTo(1.05, 9)
  })
})

describe('rankEvadeDirections', () => {
  it('ranks circle-left first for the bottom third of the roll', () => {
    expect(rankEvadeDirections(0)).toEqual(['circle-left', 'circle-right', 'backstep'])
  })

  it('ranks circle-right first for the middle third of the roll', () => {
    expect(rankEvadeDirections(0.5)).toEqual(['circle-right', 'circle-left', 'backstep'])
  })

  it('ranks backstep first for the top third of the roll', () => {
    expect(rankEvadeDirections(0.9)).toEqual(['backstep', 'circle-left', 'circle-right'])
  })
})

describe('evadeDirectionVector', () => {
  const facing: Vec2 = { x: 1, z: 0 }

  it('circle-left is the left perpendicular of facing', () => {
    expect(evadeDirectionVector('circle-left', facing)).toEqual({ x: 0, z: 1 })
  })

  it('circle-right is the right perpendicular of facing', () => {
    expect(evadeDirectionVector('circle-right', facing)).toEqual({ x: 0, z: -1 })
  })

  it('backstep is the negated facing', () => {
    expect(evadeDirectionVector('backstep', facing)).toEqual({ x: -1, z: 0 })
  })
})

// ---------------------------------------------------------------------------
// Task 10 Step 1: the stagger phase-matrix's pure per-action-phase effect
// (design.md's table). The `FighterCombatState`-level parts -- clearing
// `forcedActionId`, lethal-defeat's silent override, emitting
// `fighter-staggered`, bumping `staggerUntilTick`, and deferring the
// one-tick `contact` case's clear to the *following* tick's phase machine --
// live in `encounter.ts`/`encounter.test.ts`, which alone hold
// `FighterCombatState`.
// ---------------------------------------------------------------------------

describe('applyStaggerToAction', () => {
  const activeAction = (phase: CombatActionPhase): CombatActionState => ({
    type: 'active',
    instanceId: 'a:0',
    definitionId: 'fast-slash',
    phase,
    phaseStartedTick: 10,
    phaseEndsAtTick: 20,
    targetId: 'b',
    attackRolls: { accuracy: 0.5, critical: 0.5 },
  })

  it('neutral: nothing to interrupt, action unchanged', () => {
    const result = applyStaggerToAction({ type: 'neutral' })
    expect(result).toEqual({ action: { type: 'neutral' }, interrupted: false })
  })

  it('windup: cancelled immediately, interrupted: true', () => {
    const result = applyStaggerToAction(activeAction('windup'))
    expect(result).toEqual({ action: { type: 'neutral' }, interrupted: true })
  })

  it('contact: exempt this tick -- action returned unchanged (by reference), interrupted: false', () => {
    const action = activeAction('contact')
    const result = applyStaggerToAction(action)
    expect(result.interrupted).toBe(false)
    expect(result.action).toBe(action) // unchanged, not even a shallow clone
  })

  it('impact: cancelled immediately, interrupted: true', () => {
    const result = applyStaggerToAction(activeAction('impact'))
    expect(result).toEqual({ action: { type: 'neutral' }, interrupted: true })
  })

  it('recovery: cancelled immediately, interrupted: true', () => {
    const result = applyStaggerToAction(activeAction('recovery'))
    expect(result).toEqual({ action: { type: 'neutral' }, interrupted: true })
  })
})

describe('selectEvadeDirection', () => {
  const facing: Vec2 = { x: 1, z: 0 }
  const generousArena: CombatArenaDefinition = { radius: 30, lateralLimit: 20, minimumSeparation: 0.9, movementPolicy: 'free' }

  it('picks the primary ranked direction when it is not blocked by the arena', () => {
    expect(selectEvadeDirection(0.1, facing, { x: 0, z: 0 }, 0.93, generousArena)).toBe('circle-left')
  })

  it('falls through to the second-ranked direction when the primary is blocked (design.md: "blocked directions fall through in that deterministic order")', () => {
    const narrowArena: CombatArenaDefinition = { radius: 30, lateralLimit: 5, minimumSeparation: 0.9, movementPolicy: 'free' }
    // roll 0.1 ranks circle-left (+z) first; from z=4.9, +0.93 exceeds lateralLimit 5, so it falls through to circle-right (-z).
    expect(selectEvadeDirection(0.1, facing, { x: 0, z: 4.9 }, 0.93, narrowArena)).toBe('circle-right')
  })

  it('returns undefined when the arena blocks all three ranked directions', () => {
    const tinyArena: CombatArenaDefinition = { radius: 0.5, lateralLimit: 5, minimumSeparation: 0.9, movementPolicy: 'free' }
    expect(selectEvadeDirection(0.1, facing, { x: -0.5, z: 0 }, 0.93, tinyArena)).toBeUndefined()
  })

  it('is a pure function of its inputs: identical arguments always resolve to the same direction', () => {
    const first = selectEvadeDirection(0.42, { x: 0, z: 1 }, { x: 2, z: -3 }, 1.05, generousArena)
    const second = selectEvadeDirection(0.42, { x: 0, z: 1 }, { x: 2, z: -3 }, 1.05, generousArena)
    expect(first).toBe(second)
  })
})
