import { describe, expect, it } from 'vitest'
import {
  actionContactTick,
  calculateContactDamage,
  calculateContactPoint,
  startAttackAction,
  startDefenseAction,
  transitionActionPhase,
  type AttackActionDefinition,
} from './combatActions'
import type { Vec2 } from './movement'

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
