import { describe, expect, it } from 'vitest'
import type { CombatArenaDefinition } from '../simulation/movement'
import {
  validateCombatStyleCatalog,
  type AttackActionDefinition,
  type AttackActionId,
  type CombatStyleCatalog,
  type DefenseActionDefinition,
} from '../simulation/combatActions'
import { COMBAT_STYLES } from './combatStyles'

// Task 11 authors the real duel arena inside `src/simulation/battle.ts`. This
// is a local fixture using the design's duel values, per task-5-brief.md
// resolution #1 — content never exports a duel arena of its own.
const DUEL_ARENA: CombatArenaDefinition = {
  radius: 6.5,
  lateralLimit: 2.5,
  minimumSeparation: 0.9,
  movementPolicy: 'ordered-pair',
}

// Test-only helper (not production API), per resolution #2: returns a
// deep-copied catalog with one attack's field(s) overridden.
function replaceAction(
  catalog: CombatStyleCatalog,
  id: AttackActionId,
  overrides: Partial<AttackActionDefinition>,
): CombatStyleCatalog {
  const next = structuredClone(catalog) as CombatStyleCatalog
  const attacks = next.attacks as Record<AttackActionId, AttackActionDefinition>
  attacks[id] = { ...attacks[id], ...overrides }
  return next
}

describe('COMBAT_STYLES brief fixture', () => {
  it('validates and returns the same catalog instance', () => {
    expect(validateCombatStyleCatalog(COMBAT_STYLES, DUEL_ARENA)).toBe(COMBAT_STYLES)
  })

  it('lists heavy attack action ids in table order', () => {
    expect(COMBAT_STYLES.styles.heavy.attackActionIds).toEqual(['heavy-shield-jab', 'heavy-cleave'])
  })

  it('gives fast a burst speed of 4', () => {
    expect(COMBAT_STYLES.styles.fast.locomotion.burstUnitsPerSecond).toBe(4)
  })

  it('gives technical a 2.1..2.8 preferred range', () => {
    expect(COMBAT_STYLES.styles.technical.preferredRange).toEqual({ min: 2.1, max: 2.8 })
  })

  it('rejects an out-of-range minimumFacingDot naming the offending field', () => {
    expect(() =>
      validateCombatStyleCatalog(replaceAction(COMBAT_STYLES, 'heavy-cleave', { minimumFacingDot: 2 }), DUEL_ARENA),
    ).toThrow('minimumFacingDot')
  })
})

describe('authored attack rows', () => {
  // Field order matches task-5-brief.md Step 3:
  // range, startMax, dot, windup, impact, recovery, damage, accuracy, rootTravel, push, stagger, priority
  it.each([
    [
      'heavy-shield-jab',
      {
        tags: ['attack', 'probe', 'shield', 'unparryable'],
        contactRange: { min: 0.9, max: 1.4 },
        startMaxRange: undefined,
        minimumFacingDot: 0.5736,
        windupTicks: 14,
        impactTicks: 3,
        recoveryTicks: 20,
        damageMultiplier: 0.80,
        accuracyModifier: 0.08,
        rootTravel: 0.25,
        pushDistance: 0.40,
        staggerTicks: 12,
        contactPriority: 30,
      },
    ],
    [
      'heavy-cleave',
      {
        tags: ['attack', 'committed', 'weapon', 'parryable'],
        contactRange: { min: 0.9, max: 1.8 },
        startMaxRange: undefined,
        minimumFacingDot: 0.6428,
        windupTicks: 34,
        impactTicks: 6,
        recoveryTicks: 56,
        damageMultiplier: 2.70,
        accuracyModifier: -0.06,
        rootTravel: 0.45,
        pushDistance: 0.70,
        staggerTicks: 24,
        contactPriority: 10,
      },
    ],
    [
      'fast-slash',
      {
        tags: ['attack', 'probe', 'weapon', 'parryable'],
        contactRange: { min: 0.9, max: 2.05 },
        startMaxRange: undefined,
        minimumFacingDot: 0.4226,
        windupTicks: 10,
        impactTicks: 2,
        recoveryTicks: 10,
        damageMultiplier: 1.65,
        accuracyModifier: 0.06,
        rootTravel: 0.25,
        pushDistance: 0.18,
        staggerTicks: 8,
        contactPriority: 40,
      },
    ],
    [
      'fast-burst-lunge',
      {
        tags: ['attack', 'committed', 'burst', 'weapon', 'parryable'],
        contactRange: { min: 1.6, max: 2.4 },
        startMaxRange: 4.0,
        minimumFacingDot: 0.8192,
        windupTicks: 18,
        impactTicks: 3,
        recoveryTicks: 20,
        damageMultiplier: 2.60,
        accuracyModifier: 0,
        rootTravel: 0.50,
        pushDistance: 0.35,
        staggerTicks: 14,
        contactPriority: 30,
      },
    ],
    [
      'technical-thrust',
      {
        tags: ['attack', 'probe', 'weapon', 'parryable'],
        contactRange: { min: 1.2, max: 2.8 },
        startMaxRange: undefined,
        minimumFacingDot: 0.9397,
        windupTicks: 20,
        impactTicks: 3,
        recoveryTicks: 15,
        damageMultiplier: 1.38,
        accuracyModifier: 0.04,
        rootTravel: 0.20,
        pushDistance: 0.30,
        staggerTicks: 12,
        contactPriority: 25,
      },
    ],
    [
      'technical-driving-thrust',
      {
        tags: ['attack', 'committed', 'weapon', 'parryable'],
        contactRange: { min: 1.6, max: 3.1 },
        startMaxRange: undefined,
        minimumFacingDot: 0.9511,
        windupTicks: 30,
        impactTicks: 4,
        recoveryTicks: 24,
        damageMultiplier: 1.90,
        accuracyModifier: -0.03,
        rootTravel: 0.50,
        pushDistance: 0.50,
        staggerTicks: 20,
        contactPriority: 15,
      },
    ],
    [
      'technical-parry-counter',
      {
        tags: ['attack', 'forced', 'counter', 'weapon'],
        contactRange: { min: 0.9, max: 2.3 },
        startMaxRange: undefined,
        minimumFacingDot: 0.8660,
        windupTicks: 8,
        impactTicks: 4,
        recoveryTicks: 20,
        damageMultiplier: 1.1,
        accuracyModifier: 0.12,
        rootTravel: 0.30,
        pushDistance: 0.40,
        staggerTicks: 18,
        contactPriority: 50,
      },
    ],
  ] as const)('%s matches its authored row', (id, expected) => {
    const actual = COMBAT_STYLES.attacks[id] as AttackActionDefinition
    expect(actual.id).toBe(id)
    expect(actual.tags).toEqual(expected.tags)
    expect(actual.contactRange).toEqual(expected.contactRange)
    expect(actual.startMaxRange).toBe(expected.startMaxRange)
    expect(actual.minimumFacingDot).toBe(expected.minimumFacingDot)
    expect(actual.windupTicks).toBe(expected.windupTicks)
    expect(actual.impactTicks).toBe(expected.impactTicks)
    expect(actual.recoveryTicks).toBe(expected.recoveryTicks)
    expect(actual.damageMultiplier).toBe(expected.damageMultiplier)
    expect(actual.accuracyModifier).toBe(expected.accuracyModifier)
    expect(actual.rootTravel).toBe(expected.rootTravel)
    expect(actual.pushDistance).toBe(expected.pushDistance)
    expect(actual.staggerTicks).toBe(expected.staggerTicks)
    expect(actual.contactPriority).toBe(expected.contactPriority)
  })
})

describe('authored defense rows', () => {
  it.each([
    [
      'heavy-guard',
      {
        minimumReactionLeadTicks: 8,
        impactTicks: 4,
        recoveryTicks: 6,
        minimumIncomingFacingDot: 0.3420,
        evadeDisplacement: undefined,
      },
    ],
    [
      'fast-evade',
      {
        minimumReactionLeadTicks: 7,
        impactTicks: 3,
        recoveryTicks: 8,
        minimumIncomingFacingDot: undefined,
        evadeDisplacement: { min: 0.9, max: 1.2 },
      },
    ],
    [
      'technical-parry',
      {
        minimumReactionLeadTicks: 10,
        impactTicks: 4,
        recoveryTicks: 10,
        minimumIncomingFacingDot: -0.1736,
        evadeDisplacement: undefined,
      },
    ],
  ] as const)('%s matches its authored row', (id, expected) => {
    const actual = COMBAT_STYLES.defenses[id] as DefenseActionDefinition
    expect(actual.id).toBe(id)
    expect(actual.tags).toEqual(['defense'])
    expect(actual.minimumReactionLeadTicks).toBe(expected.minimumReactionLeadTicks)
    expect(actual.impactTicks).toBe(expected.impactTicks)
    expect(actual.recoveryTicks).toBe(expected.recoveryTicks)
    expect(actual.minimumIncomingFacingDot).toBe(expected.minimumIncomingFacingDot)
    expect(actual.evadeDisplacement).toEqual(expected.evadeDisplacement)
  })
})

describe('authored style movement and turn pairs', () => {
  it.each([
    [
      'heavy',
      {
        forwardUnitsPerSecond: 1.4,
        backwardUnitsPerSecond: 0.9,
        lateralUnitsPerSecond: 0.8,
        burstUnitsPerSecond: 1.8,
        turnCosPerTick: 0.9993908270,
        turnSinPerTick: 0.0348994967,
      },
    ],
    [
      'fast',
      {
        forwardUnitsPerSecond: 2.4,
        backwardUnitsPerSecond: 2.7,
        lateralUnitsPerSecond: 2.1,
        burstUnitsPerSecond: 4,
        turnCosPerTick: 0.9982398279,
        turnSinPerTick: 0.0593063736,
      },
    ],
    [
      'technical',
      {
        forwardUnitsPerSecond: 1.7,
        backwardUnitsPerSecond: 2.0,
        lateralUnitsPerSecond: 1.3,
        burstUnitsPerSecond: 2.4,
        turnCosPerTick: 0.9989705698,
        turnSinPerTick: 0.0453629881,
      },
    ],
  ] as const)('%s locomotion matches its authored row', (archetype, expected) => {
    expect(COMBAT_STYLES.styles[archetype].locomotion).toEqual(expected)
  })

  it.each([
    ['heavy', { min: 1.2, max: 1.7 }],
    ['fast', { min: 2.4, max: 3.0 }],
    ['technical', { min: 2.1, max: 2.8 }],
  ] as const)('%s preferred range matches its authored row', (archetype, expected) => {
    expect(COMBAT_STYLES.styles[archetype].preferredRange).toEqual(expected)
  })
})

describe('authored base weights', () => {
  it('heavy base weights match the authored table', () => {
    expect(COMBAT_STYLES.styles.heavy.baseWeights).toEqual({
      advance: 12,
      'hold-range': 8,
      pressure: 12,
      'circle-left': 2,
      'circle-right': 2,
      retreat: 0,
      'heavy-shield-jab': 14,
      'heavy-cleave': 8,
    })
  })

  it('fast base weights match the authored table', () => {
    expect(COMBAT_STYLES.styles.fast.baseWeights).toEqual({
      'circle-left': 12,
      'circle-right': 12,
      'hold-range': 5,
      retreat: 8,
      'burst-in': 14,
      'fast-slash': 12,
      'fast-burst-lunge': 14,
    })
  })

  it('technical base weights match the authored table', () => {
    expect(COMBAT_STYLES.styles.technical.baseWeights).toEqual({
      'hold-range': 12,
      backstep: 12,
      'circle-left': 6,
      'circle-right': 6,
      advance: 6,
      'technical-thrust': 14,
      'technical-driving-thrust': 8,
    })
  })

  it('preserves a present zero weight as distinct from an absent key (Heavy retreat)', () => {
    expect('retreat' in COMBAT_STYLES.styles.heavy.baseWeights).toBe(true)
    expect(COMBAT_STYLES.styles.heavy.baseWeights.retreat).toBe(0)
    expect('backstep' in COMBAT_STYLES.styles.heavy.baseWeights).toBe(false)
  })
})

describe('validateCombatStyleCatalog: identity and structural rules', () => {
  it('rejects an attacks record missing a required action id', () => {
    const next = structuredClone(COMBAT_STYLES) as CombatStyleCatalog
    delete (next.attacks as any)['heavy-cleave']
    expect(() => validateCombatStyleCatalog(next, DUEL_ARENA)).toThrow('attacks')
  })

  it('rejects an attacks record with an unknown extra key', () => {
    const next = structuredClone(COMBAT_STYLES) as CombatStyleCatalog
    ;(next.attacks as any)['bogus-attack'] = { ...next.attacks['heavy-cleave'], id: 'bogus-attack' }
    expect(() => validateCombatStyleCatalog(next, DUEL_ARENA)).toThrow('attacks')
  })

  it('rejects a defenses record missing a required defense id', () => {
    const next = structuredClone(COMBAT_STYLES) as CombatStyleCatalog
    delete (next.defenses as any)['fast-evade']
    expect(() => validateCombatStyleCatalog(next, DUEL_ARENA)).toThrow('defenses')
  })

  it('rejects a styles record missing a required archetype', () => {
    const next = structuredClone(COMBAT_STYLES) as CombatStyleCatalog
    delete (next.styles as any).fast
    expect(() => validateCombatStyleCatalog(next, DUEL_ARENA)).toThrow('styles')
  })
})

describe('validateCombatStyleCatalog: finite numeric and integer fields', () => {
  it('rejects a non-finite damageMultiplier', () => {
    const next = replaceAction(COMBAT_STYLES, 'fast-slash', { damageMultiplier: Number.NaN })
    expect(() => validateCombatStyleCatalog(next, DUEL_ARENA)).toThrow('damageMultiplier')
  })

  it('rejects a negative pushDistance', () => {
    const next = replaceAction(COMBAT_STYLES, 'fast-slash', { pushDistance: -0.1 })
    expect(() => validateCombatStyleCatalog(next, DUEL_ARENA)).toThrow('pushDistance')
  })

  it('rejects a non-finite accuracyModifier', () => {
    const next = replaceAction(COMBAT_STYLES, 'fast-slash', { accuracyModifier: Number.POSITIVE_INFINITY })
    expect(() => validateCombatStyleCatalog(next, DUEL_ARENA)).toThrow('accuracyModifier')
  })

  it('rejects a fractional windupTicks', () => {
    const next = replaceAction(COMBAT_STYLES, 'fast-slash', { windupTicks: 10.5 })
    expect(() => validateCombatStyleCatalog(next, DUEL_ARENA)).toThrow('windupTicks')
  })

  it('rejects a zero staggerTicks', () => {
    const next = replaceAction(COMBAT_STYLES, 'fast-slash', { staggerTicks: 0 })
    expect(() => validateCombatStyleCatalog(next, DUEL_ARENA)).toThrow('staggerTicks')
  })

  it('rejects a non-finite contactPriority', () => {
    const next = replaceAction(COMBAT_STYLES, 'fast-slash', { contactPriority: Number.NaN })
    expect(() => validateCombatStyleCatalog(next, DUEL_ARENA)).toThrow('contactPriority')
  })

  // `contactPriority` is a sort key, not a tick count or a distance, and
  // design.md constrains it to "finite" only. A fractional value slipped
  // between two authored tiers, and a negative one meant to sort last, both
  // order correctly -- so validation must not reject them, however unlike the
  // authored table they look.
  it.each([40.5, -1, 0])('accepts the finite non-positive-integer contactPriority %p that design.md permits', (contactPriority) => {
    const next = replaceAction(COMBAT_STYLES, 'fast-slash', { contactPriority })
    expect(validateCombatStyleCatalog(next, DUEL_ARENA)).toBe(next)
  })
})

describe('validateCombatStyleCatalog: range and reach rules', () => {
  it('rejects contactRange.min greater than contactRange.max', () => {
    const next = replaceAction(COMBAT_STYLES, 'fast-slash', { contactRange: { min: 2, max: 1 } })
    expect(() => validateCombatStyleCatalog(next, DUEL_ARENA)).toThrow('contactRange')
  })

  it('rejects a burst startMaxRange below contactRange.max', () => {
    const next = replaceAction(COMBAT_STYLES, 'fast-burst-lunge', { startMaxRange: 1.0 })
    expect(() => validateCombatStyleCatalog(next, DUEL_ARENA)).toThrow('startMaxRange')
  })

  it('rejects an arena whose minimumSeparation exceeds an attack contactRange.min', () => {
    const strictArena: CombatArenaDefinition = { ...DUEL_ARENA, minimumSeparation: 1.0 }
    expect(() => validateCombatStyleCatalog(COMBAT_STYLES, strictArena)).toThrow('contactRange.min')
  })
})

describe('validateCombatStyleCatalog: dot bounds', () => {
  it('rejects an attack minimumFacingDot above 1', () => {
    const next = replaceAction(COMBAT_STYLES, 'fast-slash', { minimumFacingDot: 1.5 })
    expect(() => validateCombatStyleCatalog(next, DUEL_ARENA)).toThrow('minimumFacingDot')
  })

  it('rejects an attack minimumFacingDot below -1', () => {
    const next = replaceAction(COMBAT_STYLES, 'fast-slash', { minimumFacingDot: -1.5 })
    expect(() => validateCombatStyleCatalog(next, DUEL_ARENA)).toThrow('minimumFacingDot')
  })

  it('rejects a defense minimumIncomingFacingDot outside -1..1', () => {
    const next = structuredClone(COMBAT_STYLES) as CombatStyleCatalog
    ;(next.defenses['heavy-guard'] as any).minimumIncomingFacingDot = 1.5
    expect(() => validateCombatStyleCatalog(next, DUEL_ARENA)).toThrow('minimumIncomingFacingDot')
  })
})

describe('validateCombatStyleCatalog: turn-pair unit length', () => {
  it('rejects a turn cos/sin pair that is not unit length', () => {
    const next = structuredClone(COMBAT_STYLES) as CombatStyleCatalog
    ;(next.styles.heavy.locomotion as any).turnSinPerTick = 0.5
    expect(() => validateCombatStyleCatalog(next, DUEL_ARENA)).toThrow('turnCosPerTick')
  })

  it('rejects a turnCosPerTick outside 0..1', () => {
    const next = structuredClone(COMBAT_STYLES) as CombatStyleCatalog
    ;(next.styles.heavy.locomotion as any).turnCosPerTick = 1.5
    expect(() => validateCombatStyleCatalog(next, DUEL_ARENA)).toThrow('turnCosPerTick')
  })
})

describe('validateCombatStyleCatalog: Technical reaction-lead compatibility', () => {
  it('accepts the authored catalog where fast-slash sits exactly on the 10-tick boundary', () => {
    expect(COMBAT_STYLES.attacks['fast-slash'].windupTicks).toBe(10)
    expect(COMBAT_STYLES.defenses['technical-parry'].minimumReactionLeadTicks).toBe(10)
    expect(() => validateCombatStyleCatalog(COMBAT_STYLES, DUEL_ARENA)).not.toThrow()
  })

  it('rejects a parryable attack whose windupTicks falls below the Technical parry reaction lead', () => {
    const next = replaceAction(COMBAT_STYLES, 'fast-slash', { windupTicks: 9 })
    expect(() => validateCombatStyleCatalog(next, DUEL_ARENA)).toThrow('windupTicks')
  })

  it('ignores the reaction-lead rule for an unparryable attack', () => {
    // heavy-shield-jab is tagged unparryable; a short windup must still pass.
    const next = replaceAction(COMBAT_STYLES, 'heavy-shield-jab', { windupTicks: 1 })
    expect(() => validateCombatStyleCatalog(next, DUEL_ARENA)).not.toThrow()
  })
})

describe('validateCombatStyleCatalog: evadeDisplacement rules', () => {
  it('requires fast-evade to define evadeDisplacement', () => {
    const next = structuredClone(COMBAT_STYLES) as CombatStyleCatalog
    delete (next.defenses['fast-evade'] as any).evadeDisplacement
    expect(() => validateCombatStyleCatalog(next, DUEL_ARENA)).toThrow('evadeDisplacement')
  })

  it('rejects heavy-guard defining evadeDisplacement', () => {
    const next = structuredClone(COMBAT_STYLES) as CombatStyleCatalog
    ;(next.defenses['heavy-guard'] as any).evadeDisplacement = { min: 0.5, max: 1 }
    expect(() => validateCombatStyleCatalog(next, DUEL_ARENA)).toThrow('evadeDisplacement')
  })

  it('rejects technical-parry defining evadeDisplacement', () => {
    const next = structuredClone(COMBAT_STYLES) as CombatStyleCatalog
    ;(next.defenses['technical-parry'] as any).evadeDisplacement = { min: 0.5, max: 1 }
    expect(() => validateCombatStyleCatalog(next, DUEL_ARENA)).toThrow('evadeDisplacement')
  })

  it('rejects an evadeDisplacement with min greater than max', () => {
    const next = structuredClone(COMBAT_STYLES) as CombatStyleCatalog
    ;(next.defenses['fast-evade'] as any).evadeDisplacement = { min: 1.5, max: 1.0 }
    expect(() => validateCombatStyleCatalog(next, DUEL_ARENA)).toThrow('evadeDisplacement')
  })

  it('rejects a negative evadeDisplacement bound', () => {
    const next = structuredClone(COMBAT_STYLES) as CombatStyleCatalog
    ;(next.defenses['fast-evade'] as any).evadeDisplacement = { min: -0.1, max: 1.0 }
    expect(() => validateCombatStyleCatalog(next, DUEL_ARENA)).toThrow('evadeDisplacement')
  })
})

describe('validateCombatStyleCatalog: baseWeights key rules', () => {
  it('rejects a baseWeights key that is not a locomotion intent or attack id', () => {
    const next = structuredClone(COMBAT_STYLES) as CombatStyleCatalog
    ;(next.styles.heavy.baseWeights as any)['not-a-real-key'] = 5
    expect(() => validateCombatStyleCatalog(next, DUEL_ARENA)).toThrow('baseWeights')
  })

  it('rejects a baseWeights key that is an attack ID not listed by that style', () => {
    const next = structuredClone(COMBAT_STYLES) as CombatStyleCatalog
    ;(next.styles.heavy.baseWeights as any)['fast-slash'] = 5
    expect(() => validateCombatStyleCatalog(next, DUEL_ARENA)).toThrow('baseWeights')
  })

  it('rejects a negative baseWeights value', () => {
    const next = structuredClone(COMBAT_STYLES) as CombatStyleCatalog
    ;(next.styles.heavy.baseWeights as any).advance = -1
    expect(() => validateCombatStyleCatalog(next, DUEL_ARENA)).toThrow('baseWeights')
  })
})

describe('validateCombatStyleCatalog: style structural rules', () => {
  it('rejects duplicate attackActionIds within a style', () => {
    const next = structuredClone(COMBAT_STYLES) as CombatStyleCatalog
    ;(next.styles.heavy as any).attackActionIds = ['heavy-shield-jab', 'heavy-shield-jab']
    expect(() => validateCombatStyleCatalog(next, DUEL_ARENA)).toThrow('attackActionIds')
  })

  it('rejects an attackActionIds entry not present in the catalog attacks', () => {
    const next = structuredClone(COMBAT_STYLES) as CombatStyleCatalog
    ;(next.styles.heavy as any).attackActionIds = ['heavy-shield-jab', 'not-a-real-attack']
    expect(() => validateCombatStyleCatalog(next, DUEL_ARENA)).toThrow('attackActionIds')
  })

  it('rejects a defenseActionId not present in the catalog defenses', () => {
    const next = structuredClone(COMBAT_STYLES) as CombatStyleCatalog
    ;(next.styles.heavy as any).defenseActionId = 'not-a-real-defense'
    expect(() => validateCombatStyleCatalog(next, DUEL_ARENA)).toThrow('defenseActionId')
  })

  it('rejects an archetype field mismatched with its catalog key', () => {
    const next = structuredClone(COMBAT_STYLES) as CombatStyleCatalog
    ;(next.styles.heavy as any).archetype = 'fast'
    expect(() => validateCombatStyleCatalog(next, DUEL_ARENA)).toThrow('archetype')
  })
})

// ---------------------------------------------------------------------------
// The design permits tuning `damageMultiplier`, `recoveryTicks` and the turn
// sine/cosine pairs, but fixes the QUALITATIVE orderings those numbers have to
// keep: "probes remain quicker/lower-payoff than committed actions, Fast
// remains quickest, Heavy's cleave remains the slowest commitment, and
// Technical retains the longest practical reach", plus the turn ordering
// `Heavy < Technical < Fast`.
//
// Task 13's calibration moved several of these numbers close to each other --
// `technical-driving-thrust` sits at 1.82 against `heavy-cleave`'s 1.98 -- so
// the orderings are pinned as properties here rather than left to be re-derived
// by whoever tunes next.
// ---------------------------------------------------------------------------

describe('authored qualitative orderings survive tuning', () => {
  const attacks = COMBAT_STYLES.attacks
  const cycle = (id: keyof typeof attacks) => attacks[id].windupTicks + attacks[id].impactTicks + attacks[id].recoveryTicks

  // design.md:698 fixes "probes remain quicker/lower-payoff than committed
  // actions", and design.md:15-16 defines a probe as "quick, low-commitment"
  // against a committed action as "slower, higher-payoff". Those are statements
  // about the two CLASSES, not only about each style's own pair: the constraint
  // exists so a viewer can tell a probe from a commitment by how it lands, and a
  // probe that out-damages some other style's commitment undercuts that. The
  // authored table satisfied it as a class (max probe 1.00 < min committed
  // 1.25), and the calibration keeps it that way -- `technical-thrust` at 1.34
  // stays under `fast-burst-lunge`'s 1.40, the smallest committed payoff.
  it('keeps every probe quicker and lower-payoff than every committed action', () => {
    const probes = Object.values(attacks).filter((a) => (a.tags as readonly string[]).includes('probe'))
    const committed = Object.values(attacks).filter((a) => (a.tags as readonly string[]).includes('committed'))
    expect(probes.length).toBeGreaterThan(0)
    expect(committed.length).toBeGreaterThan(0)

    const slowestProbe = Math.max(...probes.map((a) => cycle(a.id)))
    const quickestCommitment = Math.min(...committed.map((a) => cycle(a.id)))
    expect(slowestProbe).toBeLessThan(quickestCommitment)

    const biggestProbe = Math.max(...probes.map((a) => a.damageMultiplier))
    const smallestCommitment = Math.min(...committed.map((a) => a.damageMultiplier))
    expect(biggestProbe).toBeLessThan(smallestCommitment)
  })

  it('keeps each style probe quicker and lower-payoff than its committed action', () => {
    const pairs = [
      ['heavy-shield-jab', 'heavy-cleave'],
      ['fast-slash', 'fast-burst-lunge'],
      ['technical-thrust', 'technical-driving-thrust'],
    ] as const
    for (const [probe, committed] of pairs) {
      expect(attacks[probe].tags).toContain('probe')
      expect(attacks[committed].tags).toContain('committed')
      expect(cycle(probe)).toBeLessThan(cycle(committed))
      expect(attacks[probe].damageMultiplier).toBeLessThan(attacks[committed].damageMultiplier)
    }
  })

  it('keeps Fast quickest and Heavy cleave the slowest commitment', () => {
    expect(cycle('fast-slash')).toBeLessThan(cycle('heavy-shield-jab'))
    expect(cycle('fast-slash')).toBeLessThan(cycle('technical-thrust'))
    expect(cycle('fast-burst-lunge')).toBeLessThan(cycle('technical-driving-thrust'))
    expect(cycle('fast-burst-lunge')).toBeLessThan(cycle('heavy-cleave'))

    const commitments = ['heavy-cleave', 'fast-burst-lunge', 'technical-driving-thrust'] as const
    expect(Math.max(...commitments.map(cycle))).toBe(cycle('heavy-cleave'))
    // ...and it stays the single highest-payoff action in the game, which is
    // what keeps Heavy's slow swing readable as the biggest hit.
    expect(Math.max(...Object.values(attacks).map((a) => a.damageMultiplier))).toBe(attacks['heavy-cleave'].damageMultiplier)
  })

  it('keeps Technical the longest practical reach', () => {
    const reach = (id: keyof typeof attacks) => attacks[id].contactRange.max
    const technicalReach = Math.max(reach('technical-thrust'), reach('technical-driving-thrust'))
    for (const id of ['heavy-shield-jab', 'heavy-cleave', 'fast-slash', 'fast-burst-lunge'] as const) {
      expect(reach(id)).toBeLessThan(technicalReach)
    }
  })

  it('keeps the Heavy < Technical < Fast turn ordering', () => {
    // Larger `turnSinPerTick` is a larger maximum rotation per tick.
    const turn = (a: 'heavy' | 'fast' | 'technical') => COMBAT_STYLES.styles[a].locomotion.turnSinPerTick
    expect(turn('heavy')).toBeLessThan(turn('technical'))
    expect(turn('technical')).toBeLessThan(turn('fast'))
  })

  it('keeps Fast evade displacement inside its authored 0.9..1.2 envelope', () => {
    const evade = COMBAT_STYLES.defenses['fast-evade'].evadeDisplacement
    expect(evade).toEqual({ min: 0.9, max: 1.2 })
  })
})
