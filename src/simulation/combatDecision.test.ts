import { describe, expect, it } from 'vitest'
import { COMBAT_STYLES } from '../content/combatStyles'
import { freeArena } from '../testSupport/combatFixtures'
import type { CombatStyleDefinition } from './combatActions'
import {
  acquireNearestHostile,
  buildCombatDecisionContext,
  chooseCombatDecision,
  computePressureLevel,
  decisionIntervalTicks,
  effectiveDefenseChance,
  FAST_FORCED_DISENGAGE_END_RANGE,
  FAST_FORCED_DISENGAGE_MAX_TICKS,
  hasFastForcedDisengageEnded,
  isDefenseReactionOpportunity,
  processDefenseBatch,
  resolveForcedParryCounterStart,
  retainTarget,
  scoreCombatCandidates,
  TECHNICAL_FORCED_COUNTER_RANGE,
  type CombatDecisionContext,
  type DecisionModifier,
  type IncomingThreat,
} from './combatDecision'
import type { CombatantId, FighterCombatState, HostilityDefinition } from './encounter'
import type { Archetype } from './fighters'
import { createRandom, nextRandom, type RandomState } from './random'
import { buildSpatialHash } from './spatialHash'

// ---------------------------------------------------------------------------
// Fixture helpers
// ---------------------------------------------------------------------------

function fighterState(
  id: string,
  archetype: Archetype,
  overrides: Partial<FighterCombatState> = {},
  definitionOverrides: Partial<FighterCombatState['definition']> = {},
): FighterCombatState {
  return {
    id,
    factionId: 'faction',
    definition: {
      id: `${id}-def`,
      name: id,
      school: 'Fixture School',
      archetype,
      maxHp: 100,
      power: 20,
      accuracy: 0.8,
      defenseChance: 0.3,
      criticalChance: 0.1,
      ...definitionOverrides,
    },
    position: { x: 0, z: 0 },
    facing: { x: 1, z: 0 },
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

function makeContext(overrides: Partial<CombatDecisionContext> & { self: FighterCombatState; target: FighterCombatState }): CombatDecisionContext {
  return {
    tick: 0,
    nearbyCombatantIds: { allied: [], neutral: [], hostile: [] },
    comparison: 'neutral',
    pressureLevel: 0,
    arena: freeArena,
    attacks: COMBAT_STYLES.attacks,
    ...overrides,
  }
}

function combatantsOf(...fighters: FighterCombatState[]): Record<CombatantId, FighterCombatState> {
  const out: Record<CombatantId, FighterCombatState> = {}
  for (const fighter of fighters) out[fighter.id] = fighter
  return out
}

const differentFactions: HostilityDefinition = { mode: 'different-factions' }

// ===========================================================================
// Step 1: target retention / acquisition
// ===========================================================================

describe('retainTarget', () => {
  it('retains a hostile target at 19.9 units (inside the 20-unit retention radius)', () => {
    const self = fighterState('self', 'heavy', { position: { x: 0, z: 0 }, targetId: 'near-hostile' })
    const target = fighterState('near-hostile', 'fast', { factionId: 'other', position: { x: 19.9, z: 0 } })
    expect(retainTarget({ self, combatants: combatantsOf(self, target), hostility: differentFactions })).toBe('near-hostile')
  })

  it('drops a hostile target at 20.01 units (outside the 20-unit retention radius)', () => {
    const self = fighterState('self', 'heavy', { position: { x: 0, z: 0 }, targetId: 'near-hostile' })
    const target = fighterState('near-hostile', 'fast', { factionId: 'other', position: { x: 20.01, z: 0 } })
    expect(retainTarget({ self, combatants: combatantsOf(self, target), hostility: differentFactions })).toBeUndefined()
  })

  it('drops a target that has been defeated', () => {
    const self = fighterState('self', 'heavy', { targetId: 'dead' })
    const target = fighterState('dead', 'fast', { factionId: 'other', status: 'defeated', hp: 0, position: { x: 1, z: 0 } })
    expect(retainTarget({ self, combatants: combatantsOf(self, target), hostility: differentFactions })).toBeUndefined()
  })

  it('drops a target that has become allied (same faction under different-factions)', () => {
    const self = fighterState('self', 'heavy', { targetId: 'ally' })
    const target = fighterState('ally', 'fast', { factionId: 'faction', position: { x: 1, z: 0 } })
    expect(retainTarget({ self, combatants: combatantsOf(self, target), hostility: differentFactions })).toBeUndefined()
  })

  it('drops a target that is merely neutral under a relation-table', () => {
    const relationTable: HostilityDefinition = { mode: 'relation-table', relations: [] }
    const self = fighterState('self', 'heavy', { factionId: 'red', targetId: 'neutral-guy' })
    const target = fighterState('neutral-guy', 'fast', { factionId: 'blue', position: { x: 1, z: 0 } })
    expect(retainTarget({ self, combatants: combatantsOf(self, target), hostility: relationTable })).toBeUndefined()
  })

  it('returns undefined when self has no targetId', () => {
    const self = fighterState('self', 'heavy')
    expect(retainTarget({ self, combatants: combatantsOf(self), hostility: differentFactions })).toBeUndefined()
  })

  it('returns undefined when the stored targetId no longer exists', () => {
    const self = fighterState('self', 'heavy', { targetId: 'ghost' })
    expect(retainTarget({ self, combatants: combatantsOf(self), hostility: differentFactions })).toBeUndefined()
  })

  it('never switches away from a valid retained target for a closer alternative', () => {
    const self = fighterState('self', 'heavy', { position: { x: 0, z: 0 }, targetId: 'far-hostile' })
    const farHostile = fighterState('far-hostile', 'fast', { factionId: 'other', position: { x: 10, z: 0 } })
    const closerHostile = fighterState('closer-hostile', 'fast', { factionId: 'other', position: { x: 1, z: 0 } })
    expect(retainTarget({ self, combatants: combatantsOf(self, farHostile, closerHostile), hostility: differentFactions })).toBe('far-hostile')
  })
})

describe('acquireNearestHostile', () => {
  function buildSpatialFixture() {
    const self = fighterState('self', 'heavy', { factionId: 'red', position: { x: 0, z: 0 } })
    const allyClose = fighterState('ally-close', 'heavy', { factionId: 'red', position: { x: 1, z: 0 } })
    const equalDistanceA = fighterState('a-equal-distance', 'fast', { factionId: 'blue', position: { x: 0, z: 16 } })
    const equalDistanceZ = fighterState('z-far-equal', 'fast', { factionId: 'blue', position: { x: 16, z: 0 } })
    const combatants = combatantsOf(self, allyClose, equalDistanceA, equalDistanceZ)
    const spatialIndex = buildSpatialHash(
      Object.values(combatants).map((fighter) => ({ id: fighter.id, position: fighter.position })),
    )
    return { spatialIndex, combatants, hostility: differentFactions }
  }

  it('acquires the lexicographically smallest of two equal-squared-distance hostiles at exactly the 16-unit radius', () => {
    const spatialFixture = buildSpatialFixture()
    expect(acquireNearestHostile(spatialFixture, 'self', 16)).toBe('a-equal-distance')
  })

  it('finds nothing just inside the boundary (15.9) when the nearest hostile sits at exactly 16', () => {
    const spatialFixture = buildSpatialFixture()
    expect(acquireNearestHostile(spatialFixture, 'self', 15.9)).toBeUndefined()
  })

  it('ignores a defeated hostile even when it is the closest candidate', () => {
    const self = fighterState('self', 'heavy', { factionId: 'red', position: { x: 0, z: 0 } })
    const deadHostile = fighterState('dead-hostile', 'fast', { factionId: 'blue', position: { x: 1, z: 0 }, status: 'defeated', hp: 0 })
    const liveHostile = fighterState('live-hostile', 'fast', { factionId: 'blue', position: { x: 5, z: 0 } })
    const combatants = combatantsOf(self, deadHostile, liveHostile)
    const spatialIndex = buildSpatialHash(Object.values(combatants).map((f) => ({ id: f.id, position: f.position })))
    expect(acquireNearestHostile({ spatialIndex, combatants, hostility: differentFactions }, 'self', 16)).toBe('live-hostile')
  })
})

// ===========================================================================
// Step 2: exact Heavy decision fixture, plus range/boundary/opening/pressure/
// matchup/fallback coverage
// ===========================================================================

describe('scoreCombatCandidates (Heavy brief fixture)', () => {
  it('matches the exact candidate list and weights from the design fixture at distance 2.0, neutral matchup, arena centre, no opening, pressure zero', () => {
    const self = fighterState('self', 'heavy', { position: { x: 0, z: 0 } })
    const target = fighterState('foe', 'heavy', { factionId: 'other', position: { x: 2, z: 0 } })
    const context = buildCombatDecisionContext({
      tick: 0,
      selfId: 'self',
      targetId: 'foe',
      combatants: combatantsOf(self, target),
      hostility: differentFactions,
      arena: freeArena,
      nearbyIds: [],
      combatStyles: COMBAT_STYLES,
    })

    expect(context.comparison).toBe('neutral')
    expect(context.pressureLevel).toBe(0)

    const scored = scoreCombatCandidates(context, COMBAT_STYLES.styles.heavy)

    // NOTE: the brief's authored literal for heavy-cleave's weight is
    // 19.11111111111111. Recomputing `8 + 20 * clamp(1 - abs(1.55 - 1.35) /
    // 0.45, 0, 1)` in both Node and Python double precision arithmetic
    // (division, not multiply-by-reciprocal) instead yields
    // 19.111111111111114 -- one ULP different. This is a floating-point
    // precision defect in the brief's literal, not in this implementation;
    // see the task report. The literal below is the value this
    // straightforwardly-faithful implementation of the stated formula
    // actually produces.
    expect(scored).toEqual([
      { decision: { type: 'locomotion', locomotionIntent: 'advance' }, weight: 24 },
      { decision: { type: 'locomotion', locomotionIntent: 'pressure' }, weight: 24 },
      { decision: { type: 'locomotion', locomotionIntent: 'circle-left' }, weight: 2 },
      { decision: { type: 'locomotion', locomotionIntent: 'circle-right' }, weight: 2 },
      { decision: { type: 'action', actionId: 'heavy-cleave' }, weight: 19.111111111111114 },
    ])

    const total = scored.reduce((sum, candidate) => sum + candidate.weight, 0)
    expect(total).toBeCloseTo(71.11, 1)
  })
})

// ---------------------------------------------------------------------------
// Range reach legality.
//
// `rootTravel` is a MAXIMUM forward displacement that "stops early at minimum
// separation" (design.md, action definitions), not a mandatory step. So an
// action is legal iff the actor is not already inside `contactRange.min` AND
// can close to within `contactRange.max` using at most its authored travel:
//
//     currentDistance >= contactRange.min
//     currentDistance - rootTravel <= contactRange.max
//
// This block previously asserted the opposite for the near side -- that an
// action is illegal whenever `currentDistance - rootTravel < contactRange.min`.
// That reading made root travel mandatory, and because every attack's
// `contactRange.min` (0.9) equals the duel arena's `minimumSeparation` (0.9)
// while every attack has a strictly positive `rootTravel`, it made EVERY
// action illegal for EVERY style at the separation floor. Task 13's cohort
// measurements found fighters deadlocked there: timed-out bouts spent 91.9% of
// their ticks at `d <= 0.9` with no legal attack for either side on 98.1% of
// ticks, and 8 of the 9 roster pairings could not finish inside 3600 ticks.
// The far-side fixtures below are unchanged and still pin design.md's own
// worked example.
// ---------------------------------------------------------------------------

describe('scoreCombatCandidates: range reach legality', () => {
  it('excludes an action whose predicted contact distance overshoots contactRange.max', () => {
    // heavy-shield-jab: rootTravel 0.25, contactRange 0.9-1.4. At distance
    // 2.0, even a full 0.25 of travel only reaches 1.75 > 1.4, illegal. This
    // is design.md's authored example verbatim: "heavy-shield-jab is illegal
    // because its 0.25 root travel cannot reach 1.4".
    const self = fighterState('self', 'heavy')
    const target = fighterState('foe', 'heavy', { position: { x: 2, z: 0 } })
    const context = makeContext({ self, target })
    const scored = scoreCombatCandidates(context, COMBAT_STYLES.styles.heavy)
    expect(scored.some((c) => c.decision.type === 'action' && c.decision.actionId === 'heavy-shield-jab')).toBe(false)
  })

  it('includes an action once its predicted contact distance falls back inside contactRange', () => {
    // At distance 1.5, predicted = 1.5 - 0.25 = 1.25, inside 0.9-1.4.
    const self = fighterState('self', 'heavy')
    const target = fighterState('foe', 'heavy', { position: { x: 1.5, z: 0 } })
    const context = makeContext({ self, target })
    const scored = scoreCombatCandidates(context, COMBAT_STYLES.styles.heavy)
    expect(scored.some((c) => c.decision.type === 'action' && c.decision.actionId === 'heavy-shield-jab')).toBe(true)
  })

  it('keeps an action legal inside contactRange.min + rootTravel, stopping short instead of overshooting', () => {
    // At distance 1.0 the jab does not need its full 0.25 travel: it stops
    // early and contacts at `contactRange.min` (0.9), which is legal.
    const self = fighterState('self', 'heavy')
    const target = fighterState('foe', 'heavy', { position: { x: 1.0, z: 0 } })
    const context = makeContext({ self, target })
    const scored = scoreCombatCandidates(context, COMBAT_STYLES.styles.heavy)
    expect(scored.some((c) => c.decision.type === 'action' && c.decision.actionId === 'heavy-shield-jab')).toBe(true)
  })

  it('keeps an action legal one ULP below the arena minimum separation', () => {
    // The three-pass separation solver parks a pressed-together pair at
    // `0.89999999999999991` -- one ULP below the 0.9 floor that both
    // `arena.minimumSeparation` and every `contactRange.min` sit on. A bare
    // `d >= contactRange.min` rejects that, and the pair deadlocks. Both ends
    // of the reachable contact interval are therefore clamped to the floor.
    const justBelow = 0.9 - Number.EPSILON / 2
    expect(justBelow).toBeLessThan(0.9)
    const self = fighterState('self', 'heavy')
    const target = fighterState('foe', 'heavy', { position: { x: justBelow, z: 0 } })
    const context = makeContext({ self, target })
    const scored = scoreCombatCandidates(context, COMBAT_STYLES.styles.heavy)
    expect(scored.some((c) => c.decision.type === 'action')).toBe(true)
  })

  it('still rejects an action when the arena floor is genuinely looser than contactRange.min', () => {
    // The floor clamp must not become a blanket "always in range" rule: with
    // a 0.3 minimum separation, a heavy at 0.5 units really is inside
    // heavy-shield-jab's 0.9 contact minimum and cannot back up to fix it.
    const self = fighterState('self', 'heavy')
    const target = fighterState('foe', 'heavy', { position: { x: 0.5, z: 0 } })
    const context = makeContext({ self, target, arena: { ...freeArena, minimumSeparation: 0.3 } })
    const scored = scoreCombatCandidates(context, COMBAT_STYLES.styles.heavy)
    expect(scored.some((c) => c.decision.type === 'action')).toBe(false)
  })

  it('keeps the close-quarters styles able to attack at exactly the arena minimum separation', () => {
    // The regression that mattered: at the 0.9 separation floor a style whose
    // reach covers that distance must still have a legal attack, or two
    // fighters that close to contact can never resolve anything again.
    //
    // SCOPE: Heavy and Fast only. Technical is deliberately excluded, and the
    // exclusion is a real behavioural statement rather than a convenience.
    // Technical's ordinary attacks start at 1.2 (`technical-thrust`) and 1.6
    // (`technical-driving-thrust`), so a spear genuinely cannot be used at
    // grappling range. It previously appeared to satisfy this assertion only
    // because `technical-parry-counter` (contact range 0.9-2.3) leaked into
    // ordinary weighted selection, which design.md:516 forbids -- so the thing
    // that made Technical pass here was the defect, not the design.
    //
    // Technical does not deadlock at the floor. Two other rules compose to
    // cover it: `backstep` is gated to targets inside 1.2 units, which is
    // exactly this range, and the anti-stall movement exemption un-suppresses
    // it when Technical has no viable action, so Technical steps back into its
    // own measure and regains `technical-thrust`. The
    // "restores suppressed movement for a wall-pinned technical" and
    // "Technical locomotion range gates" blocks below pin that path.
    for (const archetype of ['heavy', 'fast'] as const) {
      const self = fighterState('self', archetype)
      const target = fighterState('foe', archetype, { position: { x: freeArena.minimumSeparation, z: 0 } })
      const context = makeContext({ self, target })
      const scored = scoreCombatCandidates(context, COMBAT_STYLES.styles[archetype])
      expect(scored.some((c) => c.decision.type === 'action')).toBe(true)
    }

    // Technical has no ordinary attack here, but does have the movement that
    // restores one -- the composition described above, asserted rather than
    // assumed.
    const technical = makeContext({
      self: fighterState('self', 'technical', { lastResolutionTick: 0 }),
      target: fighterState('foe', 'technical', { position: { x: freeArena.minimumSeparation, z: 0 } }),
      tick: 400,
    })
    const scored = scoreCombatCandidates(technical, COMBAT_STYLES.styles.technical)
    expect(scored.some((c) => c.decision.type === 'action')).toBe(false)
    expect(scored.some((c) => c.decision.type === 'locomotion' && c.decision.locomotionIntent === 'backstep')).toBe(true)
  })

  it('scores a stopped-short action at contactRange.min rather than at a distance it never occupies', () => {
    // predicted = max(0.9, 1.0 - 0.25) = 0.9. rangeMid 1.15, halfWidth 0.25,
    // so rangeFit = 20 * clamp(1 - 0.25/0.25, 0, 1) = 0 and the jab keeps its
    // bare baseWeight of 14 -- legal, but correctly unattractive at a range it
    // has to stop short to reach.
    const self = fighterState('self', 'heavy')
    const target = fighterState('foe', 'heavy', { position: { x: 1.0, z: 0 } })
    const context = makeContext({ self, target })
    const scored = scoreCombatCandidates(context, COMBAT_STYLES.styles.heavy)
    const jab = scored.find((c) => c.decision.type === 'action' && c.decision.actionId === 'heavy-shield-jab')
    expect(jab?.weight).toBeCloseTo(14, 9)
  })
})

describe('scoreCombatCandidates: arena boundary penalty (-20)', () => {
  it('applies no penalty when the finishing position is well inside the arena', () => {
    const self = fighterState('self', 'heavy', { position: { x: 0, z: 0 }, facing: { x: 0, z: 1 } })
    const target = fighterState('foe', 'heavy', { position: { x: 0, z: 1.8 } })
    const context = makeContext({ self, target, arena: freeArena })
    const scored = scoreCombatCandidates(context, COMBAT_STYLES.styles.heavy)
    const cleave = scored.find((c) => c.decision.type === 'action' && c.decision.actionId === 'heavy-cleave')
    // baseWeight 8 + rangeFit 20 (predicted 1.35 sits exactly on rangeMid) = 28.
    expect(cleave?.weight).toBe(28)
  })

  it('subtracts exactly 20 when the finishing position lands within 0.4 units of the lateral boundary', () => {
    const self = fighterState('self', 'heavy', { position: { x: 0, z: 19.61 }, facing: { x: 0, z: 1 } })
    const target = fighterState('foe', 'heavy', { position: { x: 0, z: 21.41 } })
    const context = makeContext({ self, target, arena: freeArena })
    const scored = scoreCombatCandidates(context, COMBAT_STYLES.styles.heavy)
    const cleave = scored.find((c) => c.decision.type === 'action' && c.decision.actionId === 'heavy-cleave')
    // Same 28 baseline, minus the 20 boundary penalty (finish z = 19.61 +
    // 0.45 = 20.06, 0.06 inside the lateral limit -> margin -0.06 < 0.4).
    expect(cleave?.weight).toBeCloseTo(8, 9)
  })
})

describe('scoreCombatCandidates: opening bonus', () => {
  it('adds +18 to a committed action against a target in recovery', () => {
    const self = fighterState('self', 'heavy', { position: { x: 0, z: 0 } })
    const target = fighterState('foe', 'heavy', {
      position: { x: 1.8, z: 0 },
      action: { type: 'active', instanceId: 'foe:0', definitionId: 'heavy-cleave', phase: 'recovery', phaseStartedTick: 0, phaseEndsAtTick: 100, targetId: 'self' },
    })
    const context = makeContext({ self, target, tick: 50 })
    const scored = scoreCombatCandidates(context, COMBAT_STYLES.styles.heavy)
    const cleave = scored.find((c) => c.decision.type === 'action' && c.decision.actionId === 'heavy-cleave')
    expect(cleave?.weight).toBe(46) // 28 baseline + 18
  })

  it('adds +6 to a probe action against a staggered target', () => {
    const self = fighterState('self', 'heavy', { position: { x: 0, z: 0 } })
    const target = fighterState('foe', 'heavy', { position: { x: 1.5, z: 0 }, staggerUntilTick: 60 })
    const context = makeContext({ self, target, tick: 50 })
    const scored = scoreCombatCandidates(context, COMBAT_STYLES.styles.heavy)
    const jab = scored.find((c) => c.decision.type === 'action' && c.decision.actionId === 'heavy-shield-jab')
    // baseWeight 14 + rangeFit 12 (predicted 1.25, rangeMid 1.15, halfWidth
    // 0.25 -> 20*(1-0.4)=12) + opening 6 = 32.
    expect(jab?.weight).toBeCloseTo(32, 9)
  })

  it('adds no opening bonus against a target that is merely in windup', () => {
    const self = fighterState('self', 'heavy', { position: { x: 0, z: 0 } })
    const target = fighterState('foe', 'heavy', {
      position: { x: 1.8, z: 0 },
      action: { type: 'active', instanceId: 'foe:0', definitionId: 'heavy-cleave', phase: 'windup', phaseStartedTick: 0, phaseEndsAtTick: 100, targetId: 'self' },
    })
    const context = makeContext({ self, target, tick: 50 })
    const scored = scoreCombatCandidates(context, COMBAT_STYLES.styles.heavy)
    const cleave = scored.find((c) => c.decision.type === 'action' && c.decision.actionId === 'heavy-cleave')
    expect(cleave?.weight).toBe(28)
  })
})

describe('scoreCombatCandidates: pressure adjustment (+-8 x pressureLevel)', () => {
  it('adds +8 x pressureLevel to advance/pressure/burst-in candidates', () => {
    const self = fighterState('self', 'heavy', { position: { x: 0, z: 0 } })
    const target = fighterState('foe', 'heavy', { position: { x: 2, z: 0 } })
    const context = makeContext({ self, target, pressureLevel: 3 })
    const scored = scoreCombatCandidates(context, COMBAT_STYLES.styles.heavy)
    const advance = scored.find((c) => c.decision.type === 'locomotion' && c.decision.locomotionIntent === 'advance')
    // 12 base + 12 (reduces error, too far) + 8*3 = 48.
    expect(advance?.weight).toBe(48)
  })

  it('adds -8 x pressureLevel to retreat/disengage candidates', () => {
    // Fast, distance 1.5 (below preferredRange.min 2.4): retreat reduces
    // error -> +12. baseWeight(retreat)=8. At pressureLevel 1: 8+12-8=12.
    const self = fighterState('self', 'fast', { position: { x: 0, z: 0 } })
    const target = fighterState('foe', 'fast', { position: { x: 1.5, z: 0 } })
    const context = makeContext({ self, target, pressureLevel: 1 })
    const scored = scoreCombatCandidates(context, COMBAT_STYLES.styles.fast)
    const retreat = scored.find((c) => c.decision.type === 'locomotion' && c.decision.locomotionIntent === 'retreat')
    expect(retreat?.weight).toBe(12)
  })
})

describe('scoreCombatCandidates: burst-in legality band (2.8..4.0 units)', () => {
  // `isLocomotionLegal` (private) gates `burst-in` to this band -- see its
  // own comment and `BURST_IN_MIN_RANGE`/`BURST_IN_MAX_RANGE`. It had no
  // boundary test at all (unlike the adjacent gates covered above, e.g.
  // `hasFastForcedDisengageEnded`'s true-at-boundary/false-just-beyond pairs)
  // -- `isLocomotionLegal` is not itself exported, so this drives the gate
  // indirectly through `scoreCombatCandidates`, checking whether `burst-in`
  // is present (legal) or absent (illegal) among Fast's scored candidates at
  // each boundary. Fast's `burstUnitsPerSecond` base weight (14) nets
  // positive at both boundaries once the "reduces distance error" distance
  // adjustment is added (see the two tests below), so presence/absence here
  // tracks legality, not merely a coincidental zero score.
  it('is legal at the lower boundary (2.8) and illegal just inside it (2.79)', () => {
    const self = fighterState('self', 'fast', { position: { x: 0, z: 0 } })

    const atBoundary = makeContext({ self, target: fighterState('foe', 'fast', { position: { x: 2.8, z: 0 } }) })
    const scoredAtBoundary = scoreCombatCandidates(atBoundary, COMBAT_STYLES.styles.fast)
    expect(scoredAtBoundary.some((c) => c.decision.type === 'locomotion' && c.decision.locomotionIntent === 'burst-in')).toBe(true)

    const justInside = makeContext({ self, target: fighterState('foe', 'fast', { position: { x: 2.79, z: 0 } }) })
    const scoredJustInside = scoreCombatCandidates(justInside, COMBAT_STYLES.styles.fast)
    expect(scoredJustInside.some((c) => c.decision.type === 'locomotion' && c.decision.locomotionIntent === 'burst-in')).toBe(false)
  })

  it('is legal at the upper boundary (4.0) and illegal just beyond it (4.01)', () => {
    const self = fighterState('self', 'fast', { position: { x: 0, z: 0 } })

    const atBoundary = makeContext({ self, target: fighterState('foe', 'fast', { position: { x: 4.0, z: 0 } }) })
    const scoredAtBoundary = scoreCombatCandidates(atBoundary, COMBAT_STYLES.styles.fast)
    expect(scoredAtBoundary.some((c) => c.decision.type === 'locomotion' && c.decision.locomotionIntent === 'burst-in')).toBe(true)

    const justBeyond = makeContext({ self, target: fighterState('foe', 'fast', { position: { x: 4.01, z: 0 } }) })
    const scoredJustBeyond = scoreCombatCandidates(justBeyond, COMBAT_STYLES.styles.fast)
    expect(scoredJustBeyond.some((c) => c.decision.type === 'locomotion' && c.decision.locomotionIntent === 'burst-in')).toBe(false)
  })
})

describe('scoreCombatCandidates: matchup comparison (+-5)', () => {
  it('adds +5 for advantage and -5 for disadvantage relative to the neutral baseline', () => {
    const self = fighterState('self', 'heavy', { position: { x: 0, z: 0 } })
    const target = fighterState('foe', 'heavy', { position: { x: 1.8, z: 0 } })

    const neutralWeight = scoreCombatCandidates(makeContext({ self, target, comparison: 'neutral' }), COMBAT_STYLES.styles.heavy).find(
      (c) => c.decision.type === 'action' && c.decision.actionId === 'heavy-cleave',
    )?.weight
    const advantageWeight = scoreCombatCandidates(makeContext({ self, target, comparison: 'advantage' }), COMBAT_STYLES.styles.heavy).find(
      (c) => c.decision.type === 'action' && c.decision.actionId === 'heavy-cleave',
    )?.weight
    const disadvantageWeight = scoreCombatCandidates(makeContext({ self, target, comparison: 'disadvantage' }), COMBAT_STYLES.styles.heavy).find(
      (c) => c.decision.type === 'action' && c.decision.actionId === 'heavy-cleave',
    )?.weight

    expect(neutralWeight).toBe(28)
    expect(advantageWeight).toBe(33)
    expect(disadvantageWeight).toBe(23)
  })
})

describe('scoreCombatCandidates: anti-stall local-resolution suppression', () => {
  it('suppresses retreat/circle-* candidates once the local resolution gap reaches 300 ticks', () => {
    const self = fighterState('self', 'heavy', { position: { x: 0, z: 0 }, lastResolutionTick: 0 })
    const target = fighterState('foe', 'heavy', { position: { x: 2, z: 0 } })

    const fresh = scoreCombatCandidates(makeContext({ self, target, tick: 299 }), COMBAT_STYLES.styles.heavy)
    expect(fresh.some((c) => c.decision.type === 'locomotion' && c.decision.locomotionIntent === 'circle-left')).toBe(true)

    const stale = scoreCombatCandidates(makeContext({ self, target, tick: 300 }), COMBAT_STYLES.styles.heavy)
    expect(stale.some((c) => c.decision.type === 'locomotion' && (c.decision.locomotionIntent === 'circle-left' || c.decision.locomotionIntent === 'circle-right'))).toBe(false)
    // advance/pressure remain available -- suppression never removes every candidate.
    expect(stale.some((c) => c.decision.type === 'locomotion' && c.decision.locomotionIntent === 'advance')).toBe(true)
  })
})

describe('scoreCombatCandidates: the future modifier seam', () => {
  it('defaults to no modifiers, and an explicit modifier adjusts a specific candidate by its returned delta', () => {
    const self = fighterState('self', 'heavy', { position: { x: 0, z: 0 } })
    const target = fighterState('foe', 'heavy', { position: { x: 2, z: 0 } })
    const context = makeContext({ self, target })

    const withoutModifier = scoreCombatCandidates(context, COMBAT_STYLES.styles.heavy)
    const withDefaultArg = scoreCombatCandidates(context, COMBAT_STYLES.styles.heavy, [])
    expect(withDefaultArg).toEqual(withoutModifier)

    const bonusModifier: DecisionModifier = {
      id: 'test-bonus',
      adjustCandidate: (input) => (input.decision.type === 'locomotion' && input.decision.locomotionIntent === 'advance' ? 100 : 0),
    }
    const withModifier = scoreCombatCandidates(context, COMBAT_STYLES.styles.heavy, [bonusModifier])
    const advance = withModifier.find((c) => c.decision.type === 'locomotion' && c.decision.locomotionIntent === 'advance')
    expect(advance?.weight).toBe(124) // 24 baseline + 100
  })
})

describe('chooseCombatDecision: deterministic all-zero fallback', () => {
  it('still returns a legal decision and would consume exactly two rolls when every candidate weight is zero', () => {
    // Custom minimal style: hold-range nets to 0 (outside its own
    // preferredRange), and advance's authored baseWeight is deliberately
    // set so far negative that its +12 "reduces distance error" bonus only
    // brings it to exactly 0 -- every candidate nets non-positive, so
    // scoreCombatCandidates legitimately returns an empty list.
    const allZeroStyle: CombatStyleDefinition = {
      archetype: 'heavy',
      locomotion: COMBAT_STYLES.styles.heavy.locomotion,
      preferredRange: { min: 1, max: 2 },
      attackActionIds: [],
      defenseActionId: 'heavy-guard',
      baseWeights: { 'hold-range': 0, advance: -12 },
    }
    const self = fighterState('self', 'heavy', { position: { x: 0, z: 0 } })
    const target = fighterState('foe', 'heavy', { position: { x: 10, z: 0 } }) // outside [1,2] -> "above"
    const context = makeContext({ self, target })

    expect(scoreCombatCandidates(context, allZeroStyle)).toEqual([])

    const decision = chooseCombatDecision(context, allZeroStyle, { selection: 0.5, interval: 0.5 })
    expect(decision).toEqual({ type: 'locomotion', locomotionIntent: 'advance' })
  })

  it('falls back to hold-range when already inside the preferred band and every weight is zero', () => {
    // Inside the band, hold-range earns its own +12 bonus (see the
    // "reduces distance error" adjustment table), so netting to zero here
    // requires an authored baseWeight of -12, not 0.
    const allZeroStyle: CombatStyleDefinition = {
      archetype: 'heavy',
      locomotion: COMBAT_STYLES.styles.heavy.locomotion,
      preferredRange: { min: 1, max: 20 },
      attackActionIds: [],
      defenseActionId: 'heavy-guard',
      baseWeights: { 'hold-range': -12 },
    }
    const self = fighterState('self', 'heavy', { position: { x: 0, z: 0 } })
    const target = fighterState('foe', 'heavy', { position: { x: 10, z: 0 } }) // inside [1,20]
    const context = makeContext({ self, target })

    expect(scoreCombatCandidates(context, allZeroStyle)).toEqual([])
    expect(chooseCombatDecision(context, allZeroStyle, { selection: 0.1, interval: 0.1 })).toEqual({ type: 'locomotion', locomotionIntent: 'hold-range' })
  })

  // -------------------------------------------------------------------------
  // design.md states the fallback without a "if the style authored it" clause:
  // "If every weight is zero, policy deterministically selects movement toward
  // the preferred range, or `hold-range` when already inside it."
  //
  // Fast is the style that exposes the difference. It authors no `advance` at
  // all and gates `burst-in` to 2.8..4.0 units, so at a duel's 8.4-unit
  // opening separation it has NO style-authored closing candidate. Falling
  // back to `hold-range` there made two Fast fighters stand still for the
  // whole bout: Task 13's cohort measured literally zero events -- no action,
  // no movement resolution, nothing -- across all 200 seeds of the
  // Aquila-vs-Drusus pairing.
  // -------------------------------------------------------------------------

  it('closes toward the preferred band for a style that authors no reachable forward intent', () => {
    // Fast at the duel's opening separation, once the anti-stall rule has
    // suppressed its circles and retreat (tick 400 against a
    // `lastResolutionTick` of 0). What is left cannot close: `hold-range` nets
    // to 0 outside the band, `burst-in` is out of its 2.8..4.0 band, and no
    // attack is in range. The fighter is far ABOVE its 2.4..3.0 preferred band
    // and must close rather than stand still. This is the exact state the
    // measured 200-seed Fast-vs-Fast deadlock settled into.
    const self = fighterState('self', 'fast', { position: { x: -4.2, z: 0 }, lastResolutionTick: 0 })
    const target = fighterState('foe', 'fast', { factionId: 'other', position: { x: 4.2, z: 0 } })
    const context = makeContext({ self, target, tick: 400 })

    expect(scoreCombatCandidates(context, COMBAT_STYLES.styles.fast)).toEqual([])
    expect(chooseCombatDecision(context, COMBAT_STYLES.styles.fast, { selection: 0.5, interval: 0.5 })).toEqual({
      type: 'locomotion',
      locomotionIntent: 'advance',
    })
  })

  it('closes rather than holding for every style at the duel opening separation', () => {
    // The invariant that matters for engagement: whatever the style, and
    // whether or not the anti-stall rule has already stripped its lateral
    // options, a fighter 8.4 units from its target never answers with a
    // standstill.
    for (const archetype of ['heavy', 'fast', 'technical'] as const) {
      for (const tick of [0, 400]) {
        const self = fighterState('self', archetype, { position: { x: -4.2, z: 0 }, lastResolutionTick: 0 })
        const target = fighterState('foe', archetype, { factionId: 'other', position: { x: 4.2, z: 0 } })
        const context = makeContext({ self, target, tick })
        const decision = chooseCombatDecision(context, COMBAT_STYLES.styles[archetype], { selection: 0.5, interval: 0.5 })
        expect(decision).not.toEqual({ type: 'locomotion', locomotionIntent: 'hold-range' })
      }
    }
  })

  it('does not force a suppressed backward intent on a combatant with a stale local resolution clock', () => {
    // The anti-stall rule suppresses ordinary retreat/backstep/circle/disengage
    // after LOCAL_RESOLUTION_STALE_TICKS without a resolution. The fallback
    // must not reintroduce them by the back door: a stale fighter below its
    // band holds instead of backing off. The forward intents are never
    // suppressed, so this never blocks a fighter from closing.
    const backwardOnlyStyle: CombatStyleDefinition = {
      archetype: 'heavy',
      locomotion: COMBAT_STYLES.styles.heavy.locomotion,
      preferredRange: { min: 5, max: 6 },
      attackActionIds: [],
      defenseActionId: 'heavy-guard',
      baseWeights: { 'hold-range': -12 },
    }
    const self = fighterState('self', 'heavy', { position: { x: 0, z: 0 }, lastResolutionTick: 0 })
    const target = fighterState('foe', 'heavy', { position: { x: 1, z: 0 } }) // below [5,6]

    const fresh = makeContext({ self, target, tick: 10 })
    expect(scoreCombatCandidates(fresh, backwardOnlyStyle)).toEqual([])
    expect(chooseCombatDecision(fresh, backwardOnlyStyle, { selection: 0.5, interval: 0.5 })).toEqual({ type: 'locomotion', locomotionIntent: 'retreat' })

    const stale = makeContext({ self, target, tick: 400 })
    expect(chooseCombatDecision(stale, backwardOnlyStyle, { selection: 0.5, interval: 0.5 })).toEqual({ type: 'locomotion', locomotionIntent: 'hold-range' })
  })
})

// ---------------------------------------------------------------------------
// design.md states the anti-stall suppression and its exemption in consecutive
// lines: ordinary retreat/backstep/circle-*/disengage are suppressed after 300
// resolution-less ticks, and "Forced movement needed to make an action legal
// remains available." Only the first was implemented, which made the rule
// self-defeating -- suppression lifts on the next resolution, but a combatant
// whose only route to a resolution is the suppressed movement can never reach
// one.
//
// Task 13 measured the absorbing state: 100% of residual stall ticks had at
// least one fighter inside the arena-boundary dead zone, where the authored
// -20 penalty zeroes every action and the movement out of that zone is exactly
// what suppression removed.
// ---------------------------------------------------------------------------

describe('anti-stall suppression yields to movement that restores action legality', () => {
  // Duel-shaped arena so the lateral limit is reachable, matching the geometry
  // the cohort stalls actually occurred in.
  const duel = { radius: 6.5, lateralLimit: 2.5, minimumSeparation: 0.9, movementPolicy: 'ordered-pair' as const, orderedPair: ['self', 'foe'] as const }
  const STALE_SUPPRESSED = new Set<string>(['retreat', 'backstep', 'circle-left', 'circle-right', 'disengage'])

  /** Heavy pinned against the lateral wall at the separation floor, facing its target along +x. */
  function wallPinned(tick: number) {
    const self = fighterState('self', 'heavy', { position: { x: 0, z: 2.34 }, facing: { x: 1, z: 0 }, lastResolutionTick: 0 })
    const target = fighterState('foe', 'heavy', { factionId: 'other', position: { x: 0.9, z: 2.34 } })
    return makeContext({ self, target, tick, arena: duel })
  }

  it('leaves a wall-pinned heavy with no action at all -- the state that produced the stall', () => {
    // Sanity anchor for the two tests below: at the lateral wall every action
    // takes the -20 boundary penalty and drops out, so movement is the only
    // thing that can restore this fighter's offence.
    const context = wallPinned(10)
    const scored = scoreCombatCandidates(context, COMBAT_STYLES.styles.heavy)
    expect(scored.some((c) => c.decision.type === 'action')).toBe(false)
    expect(arenaMargin(context.self.position)).toBeLessThan(0.4)
  })

  function arenaMargin(position: { x: number; z: number }): number {
    return Math.min(6.5 - Math.sqrt(position.x * position.x + position.z * position.z), 2.5 - Math.abs(position.z))
  }

  it('restores the lateral movement a wall-pinned combatant needs once it is stalled', () => {
    const fresh = wallPinned(10)
    const stalled = wallPinned(400)

    // Before the stall threshold the circles are ordinary candidates anyway.
    expect(scoreCombatCandidates(fresh, COMBAT_STYLES.styles.heavy).some(
      (c) => c.decision.type === 'locomotion' && c.decision.locomotionIntent.startsWith('circle-'),
    )).toBe(true)

    // Past it, suppression would ordinarily remove them -- but they are the
    // movement that restores a legal action, so the exemption keeps them.
    const scored = scoreCombatCandidates(stalled, COMBAT_STYLES.styles.heavy)
    const circles = scored.filter((c) => c.decision.type === 'locomotion' && c.decision.locomotionIntent.startsWith('circle-'))
    expect(circles.length).toBeGreaterThan(0)

    const decision = chooseCombatDecision(stalled, COMBAT_STYLES.styles.heavy, { selection: 0.5, interval: 0.5 })
    expect(decision).not.toEqual({ type: 'locomotion', locomotionIntent: 'hold-range' })
  })

  it('restores suppressed movement for a wall-pinned technical too -- the clause is not heavy-specific', () => {
    // Technical pressed to the separation floor against the lateral wall.
    // Away from a boundary it would still have `technical-parry-counter`
    // (contact range 0.9-2.3) to fall back on, but at the wall the -20
    // boundary penalty zeroes that too, leaving movement as its only route to
    // a resolution.
    const self = fighterState('self', 'technical', { position: { x: 0, z: 2.34 }, facing: { x: 1, z: 0 }, lastResolutionTick: 0 })
    const target = fighterState('foe', 'technical', { factionId: 'other', position: { x: 0.9, z: 2.34 } })
    const stalled = makeContext({ self, target, tick: 400, arena: duel })

    const scored = scoreCombatCandidates(stalled, COMBAT_STYLES.styles.technical)
    expect(scored.some((c) => c.decision.type === 'action')).toBe(false)
    expect(scored.some((c) => c.decision.type === 'locomotion' && STALE_SUPPRESSED.has(c.decision.locomotionIntent))).toBe(true)
    expect(chooseCombatDecision(stalled, COMBAT_STYLES.styles.technical, { selection: 0.5, interval: 0.5 })).not.toEqual({
      type: 'locomotion',
      locomotionIntent: 'hold-range',
    })
  })

  it('does not credit a movement the arena would refuse', () => {
    // Technical pressed to the lateral limit, facing inward, with the wall
    // directly behind it. Unclamped, `backstep` looks like it opens distance
    // and restores `technical-thrust`; in reality the arena clamp pins it and
    // it stands still. Crediting that move would leave the policy believing it
    // had already escaped a stall it is still in, so the lookahead projects
    // through `movement.ts`'s own clamp.
    const self = fighterState('self', 'technical', { position: { x: 0, z: 2.5 }, facing: { x: 0, z: -1 }, lastResolutionTick: 0 })
    const target = fighterState('foe', 'technical', { factionId: 'other', position: { x: 0, z: 1.6 } })
    const stalled = makeContext({ self, target, tick: 400, arena: duel })

    const scored = scoreCombatCandidates(stalled, COMBAT_STYLES.styles.technical)
    expect(scored.some((c) => c.decision.type === 'locomotion' && c.decision.locomotionIntent === 'backstep')).toBe(false)
  })

  it('still suppresses ordinary kiting for a stalled combatant that movement would not help', () => {
    // The exemption must not silently disable anti-stall. A Fast fighter far
    // from its target also has no legal action, but circling or retreating at
    // range makes no action legal either -- only closing does, and closing is
    // never suppressed. So the suppression must still bite here.
    const self = fighterState('self', 'fast', { position: { x: 0, z: 0 }, facing: { x: 1, z: 0 }, lastResolutionTick: 0 })
    const target = fighterState('foe', 'fast', { factionId: 'other', position: { x: 8, z: 0 } })
    const stalled = makeContext({ self, target, tick: 400, arena: freeArena })

    const scored = scoreCombatCandidates(stalled, COMBAT_STYLES.styles.fast)
    expect(scored.some((c) => c.decision.type === 'locomotion' && c.decision.locomotionIntent.startsWith('circle-'))).toBe(false)
    expect(scored.some((c) => c.decision.type === 'locomotion' && c.decision.locomotionIntent === 'retreat')).toBe(false)
    expect(chooseCombatDecision(stalled, COMBAT_STYLES.styles.fast, { selection: 0.5, interval: 0.5 })).toEqual({
      type: 'locomotion',
      locomotionIntent: 'advance',
    })
  })

  it('keeps ordinary suppression intact for a combatant that can still attack', () => {
    // A stalled fighter that HAS a viable action is never allowed to kite
    // instead: gate 1 of the exemption.
    const self = fighterState('self', 'heavy', { position: { x: 0, z: 0 }, facing: { x: 1, z: 0 }, lastResolutionTick: 0 })
    const target = fighterState('foe', 'heavy', { factionId: 'other', position: { x: 1.5, z: 0 } })
    const stalled = makeContext({ self, target, tick: 400, arena: freeArena })

    const scored = scoreCombatCandidates(stalled, COMBAT_STYLES.styles.heavy)
    expect(scored.some((c) => c.decision.type === 'action')).toBe(true)
    expect(scored.some((c) => c.decision.type === 'locomotion' && c.decision.locomotionIntent.startsWith('circle-'))).toBe(false)
    expect(scored.some((c) => c.decision.type === 'locomotion' && c.decision.locomotionIntent === 'retreat')).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// design.md:504 lists "arena path" among the candidate filters. It was never
// implemented for locomotion, so an intent whose displacement cannot execute
// stayed in the pool, won on weight, and resolved to a no-op. Task 13 measured
// the cost: two fighters at the separation floor kept picking advance/pressure
// at weight 24 apiece over the heavy-cleave at weight 7 that would actually
// have resolved the exchange -- one attack started across a 1077-tick stall.
// ---------------------------------------------------------------------------

describe('locomotion candidates are filtered by arena path', () => {
  const duel = { radius: 6.5, lateralLimit: 2.5, minimumSeparation: 0.9, movementPolicy: 'ordered-pair' as const, orderedPair: ['self', 'foe'] as const }

  it('drops forward intents when the target is already at the separation floor', () => {
    const self = fighterState('self', 'heavy', { position: { x: 0, z: 0 }, facing: { x: 1, z: 0 } })
    const target = fighterState('foe', 'heavy', { factionId: 'other', position: { x: 0.9, z: 0 } })
    const context = makeContext({ self, target, arena: duel })

    const scored = scoreCombatCandidates(context, COMBAT_STYLES.styles.heavy)
    const intents = scored.filter((c) => c.decision.type === 'locomotion').map((c) => (c.decision as { locomotionIntent: string }).locomotionIntent)
    expect(intents).not.toContain('advance')
    expect(intents).not.toContain('pressure')
    // ...and the attack that can actually resolve the exchange survives.
    expect(scored.some((c) => c.decision.type === 'action')).toBe(true)
  })

  // A style whose preferred band sits BELOW the separation floor, so `advance`
  // earns its "+12 reduces distance error" bonus at the floor and cannot be
  // confused with the ordinary weight filter: anything missing here was
  // removed by the arena-path filter, not scored away.
  const closerStyle: CombatStyleDefinition = {
    archetype: 'heavy',
    locomotion: COMBAT_STYLES.styles.heavy.locomotion,
    preferredRange: { min: 0.3, max: 0.6 },
    attackActionIds: [],
    defenseActionId: 'heavy-guard',
    baseWeights: { advance: 12, pressure: 12 },
  }

  it('keeps a forward intent that can still produce displacement, and drops the one that cannot', () => {
    // Facing straight at a target already at the floor: nothing to gain, the
    // separation constraint eats the whole step.
    const blocked = makeContext({
      self: fighterState('self', 'heavy', { position: { x: 0, z: 0 }, facing: { x: 1, z: 0 } }),
      target: fighterState('foe', 'heavy', { factionId: 'other', position: { x: 0.9, z: 0 } }),
      arena: duel,
    })
    expect(scoreCombatCandidates(blocked, closerStyle)).toEqual([])

    // Same distance, but facing 90 degrees off: the step is tangential, so it
    // produces real displacement and must stay legal.
    const oblique = makeContext({
      self: fighterState('self', 'heavy', { position: { x: 0, z: 0 }, facing: { x: 0, z: 1 } }),
      target: fighterState('foe', 'heavy', { factionId: 'other', position: { x: 0.9, z: 0 } }),
      arena: duel,
    })
    expect(scoreCombatCandidates(oblique, closerStyle).some(
      (c) => c.decision.type === 'locomotion' && c.decision.locomotionIntent === 'advance',
    )).toBe(true)
  })

  it('drops an intent the arena boundary blocks outright', () => {
    // Facing the lateral limit from hard against it: advancing cannot move.
    const self = fighterState('self', 'heavy', { position: { x: 0, z: 2.5 }, facing: { x: 0, z: 1 } })
    const target = fighterState('foe', 'heavy', { factionId: 'other', position: { x: 0, z: 4 } })
    const context = makeContext({ self, target, arena: duel })

    const intents = scoreCombatCandidates(context, COMBAT_STYLES.styles.heavy)
      .filter((c) => c.decision.type === 'locomotion')
      .map((c) => (c.decision as { locomotionIntent: string }).locomotionIntent)
    expect(intents).not.toContain('advance')
    expect(intents).not.toContain('pressure')
  })

  it('still returns a legal decision when every locomotion path and every action is blocked', () => {
    // The guard case: a style that authors only forward intents, pressed
    // against a target already at the separation floor. Every candidate is
    // path-blocked and there are no actions, so `scoreCombatCandidates` is
    // empty AND the fallback's directional priority is exhausted. It must not
    // answer with a blocked intent; `hold-range` -- zero displacement, always
    // executable -- is the only truthful answer left.
    const forwardOnlyStyle: CombatStyleDefinition = { ...closerStyle }
    const self = fighterState('self', 'heavy', { position: { x: 0, z: 0 }, facing: { x: 1, z: 0 } })
    const target = fighterState('foe', 'heavy', { factionId: 'other', position: { x: 0.9, z: 0 } })
    const context = makeContext({ self, target, arena: duel })

    expect(scoreCombatCandidates(context, forwardOnlyStyle)).toEqual([])
    expect(chooseCombatDecision(context, forwardOnlyStyle, { selection: 0.5, interval: 0.5 })).toEqual({
      type: 'locomotion',
      locomotionIntent: 'hold-range',
    })
  })

  it('prefers a real escape over holding when one exists', () => {
    // Same jam, but the style also authors `retreat`, which is not blocked --
    // the fallback must take it rather than settling for `hold-range`.
    const withRetreat: CombatStyleDefinition = { ...closerStyle, preferredRange: { min: 3, max: 4 }, baseWeights: { advance: 12, retreat: 0 } }
    const self = fighterState('self', 'heavy', { position: { x: 0, z: 0 }, facing: { x: 1, z: 0 } })
    const target = fighterState('foe', 'heavy', { factionId: 'other', position: { x: 0.9, z: 0 } })
    const context = makeContext({ self, target, arena: duel })

    expect(chooseCombatDecision(context, withRetreat, { selection: 0.5, interval: 0.5 })).toEqual({
      type: 'locomotion',
      locomotionIntent: 'retreat',
    })
  })
})

// ---------------------------------------------------------------------------
// design.md's locomotion section, Technical: "Technical holds spear measure,
// selects `backstep` when an opponent enters below 1.2 units, and may circle
// only while remaining able to face the opponent." Neither clause was
// implemented.
//
// The first mattered a great deal. `backstep` sat in Technical's authored
// baseWeights at 12 with no range gate, so Technical could back off from its
// own preferred 2.1-2.8 measure. Since Technical retreats at 2.0 u/s and Heavy
// advances at 1.4, that let Technical kite a Heavy indefinitely -- Task 13
// measured `technical vs heavy` at 88.6% on the equal-stat cohort against a
// required 55-75%.
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// design.md:516 -- "Forced `disengage` and `technical-parry-counter` bypass
// weighted selection." `technical-parry-counter` is tagged
// `attack forced counter weapon` (design.md:390) and is deliberately absent
// from Technical's `baseWeights`, both of which say the same thing: it is
// never weighed.
//
// It was nonetheless in `attackActionIds` with no tag filter, so it entered the
// ordinary pool and earned a large range-fit score from its 0.9-2.3 span --
// the widest in the game. Measured on the equal-stat cohort: 4.66 ordinary
// starts per bout against 0.56 genuinely forced, carrying 72% of Technical's
// total damage, which by itself put `technical vs heavy` at 88.6% against a
// 55-75% band.
// ---------------------------------------------------------------------------

describe('forced-tagged actions bypass weighted selection', () => {
  it('never offers technical-parry-counter as an ordinary candidate at any distance in its contact range', () => {
    // Its authored contact range is 0.9-2.3 with 0.30 root travel, so without
    // the filter it is legal and positively weighted across most of this sweep.
    for (const distance of [0.9, 1.0, 1.3, 1.6, 1.9, 2.2, 2.3, 2.6]) {
      const self = fighterState('self', 'technical', { position: { x: 0, z: 0 }, facing: { x: 1, z: 0 } })
      const target = fighterState('foe', 'heavy', { factionId: 'other', position: { x: distance, z: 0 } })
      const context = makeContext({ self, target })
      const scored = scoreCombatCandidates(context, COMBAT_STYLES.styles.technical)
      expect(scored.some((c) => c.decision.type === 'action' && c.decision.actionId === 'technical-parry-counter')).toBe(false)
    }
  })

  it('excludes it even where its range-fit score would otherwise be near maximal', () => {
    // Predicted contact 1.6 sits exactly on the 0.9-2.3 midpoint, so rangeFit
    // would be the full +20, plus +5 for Technical's advantage over Heavy --
    // comfortably the strongest candidate in the pool if it were admitted.
    const self = fighterState('self', 'technical', { position: { x: 0, z: 0 }, facing: { x: 1, z: 0 } })
    const target = fighterState('foe', 'heavy', { factionId: 'other', position: { x: 1.9, z: 0 } })
    const context = makeContext({ self, target })
    const scored = scoreCombatCandidates(context, COMBAT_STYLES.styles.technical)
    expect(scored.some((c) => c.decision.type === 'action' && c.decision.actionId === 'technical-parry-counter')).toBe(false)
    // Technical's genuinely ordinary attacks are unaffected.
    expect(scored.some((c) => c.decision.type === 'action' && c.decision.actionId === 'technical-thrust')).toBe(true)
  })

  it('leaves every non-forced action selectable', () => {
    // The filter must key on the tag, not on the style or the action id.
    for (const archetype of ['heavy', 'fast', 'technical'] as const) {
      const style = COMBAT_STYLES.styles[archetype]
      for (const actionId of style.attackActionIds) {
        const forced = (COMBAT_STYLES.attacks[actionId].tags as readonly string[]).includes('forced')
        expect(forced).toBe(actionId === 'technical-parry-counter')
      }
    }
  })

  it('still starts the counter when it is genuinely forced after a parry', () => {
    // The forced path does not run through candidate scoring at all: a
    // successful parry sets `forcedActionId` via
    // `resolveForcedParryCounterStart`, and the encounter starts that action
    // directly. Excluding the tag from ordinary selection must not disable it.
    expect(resolveForcedParryCounterStart(TECHNICAL_FORCED_COUNTER_RANGE)).toBe('technical-parry-counter')
    expect(resolveForcedParryCounterStart(TECHNICAL_FORCED_COUNTER_RANGE - 0.5)).toBe('technical-parry-counter')
    // ...and is still cleared beyond its authored start range.
    expect(resolveForcedParryCounterStart(TECHNICAL_FORCED_COUNTER_RANGE + 0.01)).toBeUndefined()
  })
})

describe('Technical locomotion range gates', () => {
  const duel = { radius: 6.5, lateralLimit: 2.5, minimumSeparation: 0.9, movementPolicy: 'ordered-pair' as const, orderedPair: ['self', 'foe'] as const }

  function technicalAt(distance: number, tick = 0) {
    const self = fighterState('self', 'technical', { position: { x: 0, z: 0 }, facing: { x: 1, z: 0 }, lastResolutionTick: tick })
    const target = fighterState('foe', 'technical', { factionId: 'other', position: { x: distance, z: 0 } })
    return makeContext({ self, target, tick, arena: duel })
  }

  const intentsAt = (distance: number) =>
    scoreCombatCandidates(technicalAt(distance), COMBAT_STYLES.styles.technical)
      .filter((c) => c.decision.type === 'locomotion')
      .map((c) => (c.decision as { locomotionIntent: string }).locomotionIntent)

  it('offers backstep only below 1.2 units', () => {
    expect(intentsAt(1.0)).toContain('backstep')
    expect(intentsAt(1.19)).toContain('backstep')
    expect(intentsAt(1.2)).not.toContain('backstep')
    expect(intentsAt(1.5)).not.toContain('backstep')
  })

  it('does not let Technical backstep away from its own preferred measure', () => {
    // The kiting case: at 2.1-2.8 units Technical is exactly where it wants to
    // be and must commit to holding, circling, advancing or attacking -- not
    // walk backwards faster than a Heavy can follow.
    for (const distance of [2.1, 2.4, 2.8]) {
      const intents = intentsAt(distance)
      expect(intents).not.toContain('backstep')
      expect(intents.length).toBeGreaterThan(0) // still has legal locomotion
    }
  })

  it('keeps every other Technical intent available at measure', () => {
    const intents = intentsAt(2.4)
    expect(intents).toContain('hold-range')
    expect(intents).toContain('circle-left')
    expect(intents).toContain('circle-right')
  })

  it('allows circling only while the style can keep facing the opponent', () => {
    // v/d <= sin(maxTurn). Technical circles at 1.3 u/s (0.02167/tick) and
    // turns 2.6 degrees/tick (sin 0.04536), so it needs d > ~0.478. Every
    // arena's minimumSeparation is 0.9, so this never binds on real content --
    // asserted here against a synthetic style that circles far faster than it
    // can look, so the rule is pinned rather than merely present.
    const spinner: CombatStyleDefinition = {
      ...COMBAT_STYLES.styles.technical,
      locomotion: { ...COMBAT_STYLES.styles.technical.locomotion, lateralUnitsPerSecond: 30 },
    }
    const context = technicalAt(1.5)
    const spun = scoreCombatCandidates(context, spinner)
      .filter((c) => c.decision.type === 'locomotion')
      .map((c) => (c.decision as { locomotionIntent: string }).locomotionIntent)
    expect(spun).not.toContain('circle-left')
    expect(spun).not.toContain('circle-right')

    // Authored content is unaffected at the same distance.
    expect(intentsAt(1.5)).toContain('circle-left')
  })

  it('leaves the authored styles able to circle everywhere the arena allows', () => {
    for (const archetype of ['heavy', 'fast', 'technical'] as const) {
      const style = COMBAT_STYLES.styles[archetype]
      const lateralPerTick = style.locomotion.lateralUnitsPerSecond / 60
      // The binding distance is v / sin(maxTurn); assert it stays under the
      // arena's separation floor for every style, i.e. the rule is currently
      // non-binding on real content.
      expect(lateralPerTick / style.locomotion.turnSinPerTick).toBeLessThan(duel.minimumSeparation)
    }
  })
})

describe('chooseCombatDecision: proportional selection among positive weights', () => {
  it('selects the candidate whose cumulative weight band contains the selection roll', () => {
    const self = fighterState('self', 'heavy', { position: { x: 0, z: 0 } })
    const target = fighterState('foe', 'heavy', { position: { x: 2, z: 0 } })
    const context = makeContext({ self, target })
    // scored = advance(24), pressure(24), circle-left(2), circle-right(2), heavy-cleave(~19.11); total ~71.11
    const veryLowRoll = chooseCombatDecision(context, COMBAT_STYLES.styles.heavy, { selection: 0.0001, interval: 0 })
    expect(veryLowRoll).toEqual({ type: 'locomotion', locomotionIntent: 'advance' })

    const veryHighRoll = chooseCombatDecision(context, COMBAT_STYLES.styles.heavy, { selection: 0.9999, interval: 0 })
    expect(veryHighRoll).toEqual({ type: 'action', actionId: 'heavy-cleave' })
  })
})

describe('buildCombatDecisionContext: nearby ally/neutral/hostile classification', () => {
  it('sorts nearby ids into allied/neutral/hostile buckets, excluding self and the dead', () => {
    const self = fighterState('self', 'heavy', { factionId: 'red', position: { x: 0, z: 0 } })
    const ally = fighterState('ally', 'fast', { factionId: 'red', position: { x: 1, z: 0 } })
    const hostileB = fighterState('hostile-b', 'fast', { factionId: 'blue', position: { x: 2, z: 0 } })
    const hostileA = fighterState('hostile-a', 'fast', { factionId: 'blue', position: { x: 3, z: 0 } })
    const dead = fighterState('dead', 'fast', { factionId: 'blue', position: { x: 1, z: 0 }, status: 'defeated', hp: 0 })
    const combatants = combatantsOf(self, ally, hostileB, hostileA, dead)

    const context = buildCombatDecisionContext({
      tick: 0,
      selfId: 'self',
      targetId: 'hostile-a',
      combatants,
      hostility: differentFactions,
      arena: freeArena,
      nearbyIds: ['dead', 'hostile-b', 'ally', 'self', 'hostile-a'],
      combatStyles: COMBAT_STYLES,
    })

    expect(context.nearbyCombatantIds).toEqual({
      allied: ['ally'],
      neutral: [],
      hostile: ['hostile-a', 'hostile-b'],
    })
  })
})

// ===========================================================================
// Step 3/4: pressure levels, interval mapping, anti-stall, forced behavior
// ===========================================================================

describe('computePressureLevel', () => {
  it('is 0 through a 180-tick gap', () => {
    expect(computePressureLevel(180, 0)).toBe(0)
    expect(computePressureLevel(179, 0)).toBe(0)
  })

  it('steps 1..3 in 60-tick increments beyond 180, capped at 3', () => {
    expect(computePressureLevel(181, 0)).toBe(1)
    expect(computePressureLevel(240, 0)).toBe(1)
    expect(computePressureLevel(241, 0)).toBe(2)
    expect(computePressureLevel(300, 0)).toBe(2)
    expect(computePressureLevel(301, 0)).toBe(3)
    expect(computePressureLevel(360, 0)).toBe(3)
    expect(computePressureLevel(1000, 0)).toBe(3)
  })
})

describe('decisionIntervalTicks', () => {
  it('maps roll 0 to each archetype\'s minimum and a roll just under 1 to its maximum', () => {
    expect(decisionIntervalTicks('heavy', 0)).toBe(20)
    expect(decisionIntervalTicks('heavy', 0.999999)).toBe(42)
    expect(decisionIntervalTicks('fast', 0)).toBe(12)
    expect(decisionIntervalTicks('fast', 0.999999)).toBe(30)
    expect(decisionIntervalTicks('technical', 0)).toBe(18)
    expect(decisionIntervalTicks('technical', 0.999999)).toBe(36)
  })

  it('maps a mid-range roll deterministically', () => {
    // Heavy: width 23, floor(0.5*23)=11 -> 20+11=31.
    expect(decisionIntervalTicks('heavy', 0.5)).toBe(31)
  })
})

describe('forced behavior thresholds', () => {
  it('Fast forced disengage ends once the range has been opened back out to its authored exit, and not before', () => {
    expect(hasFastForcedDisengageEnded(FAST_FORCED_DISENGAGE_END_RANGE, 10)).toBe(true)
    expect(hasFastForcedDisengageEnded(FAST_FORCED_DISENGAGE_END_RANGE + 0.01, 10)).toBe(true)
    expect(hasFastForcedDisengageEnded(FAST_FORCED_DISENGAGE_END_RANGE - 0.01, 10)).toBe(false)
    // The range a burst-lunge actually lands at: the forcing has to survive
    // it, or Fast never disengages at all. Read from the catalog rather than
    // written as a literal, so a future reach change cannot make this vacuous.
    //
    // The rewrite is not cosmetic. The literal version asserted
    // `hasFastForcedDisengageEnded(1.45, 1) === false` -- and 1.45 stays below
    // 3.35, so it would have kept passing after this slice moved the lunge to
    // 1.60..2.40 while asserting nothing whatever about the new behaviour. The
    // claim "the forcing survives a lunge" would have been true by accident.
    const lunge = COMBAT_STYLES.attacks['fast-burst-lunge'].contactRange
    expect(hasFastForcedDisengageEnded(lunge.max, 1)).toBe(false)
    expect(hasFastForcedDisengageEnded(lunge.min, 1)).toBe(false)
  })

  it('Fast forced disengage ends at its authored tick cap even when the range never opened', () => {
    // Same rewrite, same reason: a literal 29/30 pair would have gone on
    // passing against a cap this slice moved to 37, while testing a boundary
    // the kernel no longer has.
    const pinned = COMBAT_STYLES.attacks['fast-burst-lunge'].contactRange.min
    expect(hasFastForcedDisengageEnded(pinned, FAST_FORCED_DISENGAGE_MAX_TICKS)).toBe(true)
    expect(hasFastForcedDisengageEnded(pinned, FAST_FORCED_DISENGAGE_MAX_TICKS - 1)).toBe(false)
  })

  it('Technical forced parry counter starts only within 2.3 units, otherwise clears', () => {
    expect(resolveForcedParryCounterStart(TECHNICAL_FORCED_COUNTER_RANGE)).toBe('technical-parry-counter')
    expect(resolveForcedParryCounterStart(2.29)).toBe('technical-parry-counter')
    expect(resolveForcedParryCounterStart(2.31)).toBeUndefined()
  })
})

// ===========================================================================
// Step 5/6: defense batching
// ===========================================================================

describe('isDefenseReactionOpportunity', () => {
  it('pins the technical-parry vs fast-slash boundary at exactly ten ticks (windup start)', () => {
    // fast-slash windupTicks=10, technical-parry minimumReactionLeadTicks=10.
    // At the attack's start tick 0, contact occurs at tick 10: 10-0===10.
    expect(isDefenseReactionOpportunity(COMBAT_STYLES.defenses['technical-parry'], 0, 10)).toBe(true)
  })

  it('is false one tick later, once the lead no longer matches exactly', () => {
    expect(isDefenseReactionOpportunity(COMBAT_STYLES.defenses['technical-parry'], 1, 10)).toBe(false)
  })

  it('matches heavy-guard\'s own 8-tick lead', () => {
    expect(isDefenseReactionOpportunity(COMBAT_STYLES.defenses['heavy-guard'], 5, 13)).toBe(true)
  })
})

describe('effectiveDefenseChance', () => {
  it('applies the comparison modifier and telegraph tiers, clamped to 0..0.95', () => {
    expect(effectiveDefenseChance(0.3, 'advantage', 10)).toBeCloseTo(0.35, 10)
    expect(effectiveDefenseChance(0.3, 'disadvantage', 20)).toBeCloseTo(0.30, 10)
    expect(effectiveDefenseChance(0.9, 'neutral', 30)).toBeCloseTo(0.95, 10)
    expect(effectiveDefenseChance(0.02, 'disadvantage', 10)).toBe(0)
  })
})

describe('processDefenseBatch', () => {
  it('sorts five simultaneous threats, consumes ten defense-stream draws, records five outcomes, and starts at most one defense', () => {
    const defender = fighterState(
      'd',
      'technical',
      { status: 'active', action: { type: 'neutral' }, staggerUntilTick: 0, nextActionSerial: 0, reactionLedger: [] },
      { defenseChance: 0.8 },
    )
    const a1 = fighterState('a1', 'technical')
    const a2 = fighterState('a2', 'technical')
    const a3 = fighterState('a3', 'technical')
    const a4 = fighterState('a4', 'technical')
    const a5 = fighterState('a5', 'technical')

    const threats: IncomingThreat[] = [
      { attackerId: 'a1', actionInstanceId: 'a1:0', actionId: 'heavy-shield-jab', contactTick: 110 }, // unparryable tag -> ineligible
      { attackerId: 'a2', actionInstanceId: 'a2:0', actionId: 'fast-slash', contactTick: 111 }, // telegraph 0, will fail
      { attackerId: 'a3', actionInstanceId: 'a3:0', actionId: 'technical-driving-thrust', contactTick: 112 }, // telegraph 0.10, will succeed
      { attackerId: 'a4', actionInstanceId: 'a4:0', actionId: 'technical-thrust', contactTick: 113 }, // busy after a3 schedules
      { attackerId: 'a5', actionInstanceId: 'a5:0', actionId: 'heavy-cleave', contactTick: 114 }, // busy after a3 schedules
    ]

    const initialRandom = createRandom(1234)
    const result = processDefenseBatch({
      tick: 100,
      defender,
      threats,
      random: initialRandom,
      combatants: combatantsOf(defender, a1, a2, a3, a4, a5),
      combatStyles: COMBAT_STYLES,
    })

    expect(result.defender.reactionLedger).toEqual([
      { incomingActionId: 'a1:0', outcome: 'ineligible' },
      { incomingActionId: 'a2:0', outcome: 'failed' },
      { incomingActionId: 'a3:0', outcome: 'scheduled' },
      { incomingActionId: 'a4:0', outcome: 'ineligible' },
      { incomingActionId: 'a5:0', outcome: 'ineligible' },
    ])

    expect(result.events).toEqual([
      { type: 'defense-declined', tick: 100, defenderId: 'd', attackerId: 'a2', incomingActionId: 'a2:0', defenseActionId: 'technical-parry', expectedContactTick: 111 },
      { type: 'defense-started', tick: 100, defenderId: 'd', attackerId: 'a3', incomingActionId: 'a3:0', defenseActionId: 'technical-parry', expectedContactTick: 112 },
    ])

    expect(result.defender.action).toMatchObject({
      type: 'active',
      instanceId: 'd:0',
      definitionId: 'technical-parry',
      phase: 'windup',
      phaseStartedTick: 100,
      phaseEndsAtTick: 112,
      targetId: 'a3',
      reactingToActionId: 'a3:0',
    })
    expect(result.defender.nextActionSerial).toBe(1)

    // exactly ten draws (2 per opportunity x 5) consumed from the defense stream
    let expectedRandom: RandomState = initialRandom
    for (let index = 0; index < 10; index += 1) expectedRandom = nextRandom(expectedRandom)[1]
    expect(result.random).toEqual(expectedRandom)
  })

  it('marks every opportunity ineligible (but still draws) when the defender is already staggered', () => {
    const defender = fighterState('d', 'technical', { staggerUntilTick: 9999 })
    const attacker = fighterState('atk', 'technical')
    const threats: IncomingThreat[] = [{ attackerId: 'atk', actionInstanceId: 'atk:0', actionId: 'technical-thrust', contactTick: 30 }]
    const initialRandom = createRandom(7)

    const result = processDefenseBatch({
      tick: 10,
      defender,
      threats,
      random: initialRandom,
      combatants: combatantsOf(defender, attacker),
      combatStyles: COMBAT_STYLES,
    })

    expect(result.defender.reactionLedger).toEqual([{ incomingActionId: 'atk:0', outcome: 'ineligible' }])
    expect(result.events).toEqual([])
    expect(result.defender.action).toEqual({ type: 'neutral' })
    const [, afterFirst] = nextRandom(initialRandom)
    const [, afterSecond] = nextRandom(afterFirst)
    expect(result.random).toEqual(afterSecond)
  })

  it('marks every opportunity ineligible when the defender is already busy with an active action', () => {
    const defender = fighterState('d', 'technical', {
      action: { type: 'active', instanceId: 'd:0', definitionId: 'technical-thrust', phase: 'windup', phaseStartedTick: 0, phaseEndsAtTick: 20, targetId: 'someone' },
    })
    const attacker = fighterState('atk', 'technical')
    const threats: IncomingThreat[] = [{ attackerId: 'atk', actionInstanceId: 'atk:0', actionId: 'technical-thrust', contactTick: 30 }]

    const result = processDefenseBatch({
      tick: 10,
      defender,
      threats,
      random: createRandom(7),
      combatants: combatantsOf(defender, attacker),
      combatStyles: COMBAT_STYLES,
    })

    expect(result.defender.reactionLedger).toEqual([{ incomingActionId: 'atk:0', outcome: 'ineligible' }])
    expect(result.events).toEqual([])
  })

  it('sorts by contactTick, then committed/counter before probe, then descending power x damageMultiplier, then ActionInstanceId', () => {
    const defender = fighterState('d', 'technical', { staggerUntilTick: 9999 }) // force ineligible so order is observable independent of RNG
    const attackerX = fighterState('x', 'technical')
    const attackerY = fighterState('y', 'technical')
    const attackerZ = fighterState('z', 'technical')

    const threats: IncomingThreat[] = [
      { attackerId: 'z', actionInstanceId: 'z:0', actionId: 'technical-thrust', contactTick: 200 }, // probe, power 20*1.0=20
      { attackerId: 'y', actionInstanceId: 'y:0', actionId: 'technical-driving-thrust', contactTick: 200 }, // committed, power 20*1.5=30
      { attackerId: 'x', actionInstanceId: 'x:0', actionId: 'technical-driving-thrust', contactTick: 200 }, // committed, power 20*1.5=30 (tie with y -> instanceId breaks it)
    ]

    const result = processDefenseBatch({
      tick: 10,
      defender,
      threats,
      random: createRandom(1),
      combatants: combatantsOf(defender, attackerX, attackerY, attackerZ),
      combatStyles: COMBAT_STYLES,
    })

    expect(result.defender.reactionLedger.map((record) => record.incomingActionId)).toEqual(['x:0', 'y:0', 'z:0'])
  })
})
