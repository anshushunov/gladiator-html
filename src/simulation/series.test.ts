import { describe, expect, it } from 'vitest'
import { COMBAT_STYLES } from '../content/combatStyles'
import { BASELINE_TEST_SEED, homeRoster, opponents } from '../content/mvpSeries'
import { advanceBattleTicks, fighterBySide, MAX_BOUT_TICKS } from './battle'
import type { FighterDefinition } from './fighters'
import { formatTraceHash } from './random'
import { advanceSeriesTicks, assignFighter, confirmLineup, createSeries, rematch, requiredAssignmentCount, startNextBout, unassignSlot, type BoutOutcome, type PlanningSlot } from './series'

const createMvpSeries = () => createSeries({
  homeRoster,
  opponents,
  seed: BASELINE_TEST_SEED,
  combatStyles: COMBAT_STYLES,
  homeStartingHpByFighterId: Object.fromEntries(homeRoster.map((fighter) => [fighter.id, fighter.maxHp])),
})

const brutus = homeRoster.find(({ id }) => id === 'brutus')!
const aquila = homeRoster.find(({ id }) => id === 'aquila')!
const nerva = homeRoster.find(({ id }) => id === 'nerva')!

/** Test-only planning-slot literal, for asserting `state.assignments` shape. */
const slot = (fighterId: string): PlanningSlot => ({ kind: 'fighter', fighterId })

/** Narrows a `BoutOutcome` to its fought variant, for tests where every bout
 * in the series is known (by construction: a full lineup) to have actually
 * been fought rather than forfeited. */
function asFought(outcome: BoutOutcome) {
  if (outcome.kind !== 'fought') throw new Error(`Expected a fought bout outcome, got '${outcome.kind}'`)
  return outcome
}

describe('series planning', () => {
  it('moves and displaces unique assignments', () => {
    let state = createMvpSeries()
    state = assignFighter(state, 'brutus', 0).state
    state = assignFighter(state, 'aquila', 0).state
    expect(state.assignments).toEqual([slot('aquila'), null, null])
    state = assignFighter(state, 'aquila', 2).state
    expect(state.assignments).toEqual([null, null, slot('aquila')])
  })

  it('rejects incomplete confirmation with the same state object', () => {
    const state = createMvpSeries()
    const result = confirmLineup(state)
    expect(result).toEqual({ ok: false, state, reason: 'lineup-incomplete' })
    expect(result.state).toBe(state)
  })

  it('returns slot-empty only while planning', () => {
    const state = createMvpSeries()
    expect(unassignSlot(state, 0)).toEqual({ ok: false, state, reason: 'slot-empty' })
  })

  it('returns an assigned fighter to the available roster', () => {
    let state = assignFighter(createMvpSeries(), 'brutus', 0).state
    state = unassignSlot(state, 0).state
    expect(state.assignments).toEqual([null, null, null])
    const reassigned = assignFighter(state, 'brutus', 1)
    expect(reassigned.ok).toBe(true)
    expect(reassigned.state.assignments).toEqual([null, slot('brutus'), null])
  })

  it('rejects startNextBout outside between-bouts with the same state object', () => {
    const state = createMvpSeries()
    const result = startNextBout(state)
    expect(result).toEqual({ ok: false, state, reason: 'no-bout-pending' })
    expect(result.state).toBe(state)
  })

  it('rejects rematch outside summary with the same state object', () => {
    const state = createMvpSeries()
    const result = rematch(state)
    expect(result).toEqual({ ok: false, state, reason: 'series-not-finished' })
    expect(result.state).toBe(state)
  })
})

it('throws for unknown static IDs and invalid bout indices', () => {
  const state = createMvpSeries()
  expect(() => assignFighter(state, 'missing', 0)).toThrow('Unknown home fighter: missing')
  expect(() => assignFighter(state, 'brutus', 3 as never)).toThrow('Invalid bout index: 3')
})

it('returns the exact locked state when editing after confirmation', () => {
  let state = createMvpSeries()
  state = assignFighter(state, 'aquila', 0).state
  state = assignFighter(state, 'nerva', 1).state
  state = assignFighter(state, 'brutus', 2).state
  state = confirmLineup(state).state
  const result = assignFighter(state, 'brutus', 0)
  expect(result).toEqual({ ok: false, state, reason: 'lineup-locked' })
  expect(result.state).toBe(state)
})

it.each([-1, 1.5])('rejects invalid tick counts: %s', (ticks) => {
  expect(() => advanceSeriesTicks(createMvpSeries(), ticks)).toThrow('Tick count must be a non-negative integer')
})

function playSeries(assignments: readonly [string, string, string]) {
  let state = createMvpSeries()
  assignments.forEach((fighterId, boutIndex) => { state = assignFighter(state, fighterId, boutIndex).state })
  state = confirmLineup(state).state
  while (state.phase !== 'summary') {
    state = state.phase === 'fighting'
      ? advanceSeriesTicks(state, MAX_BOUT_TICKS)
      : startNextBout(state).state
  }
  return state
}

it('records exactly three results and a matching score', () => {
  const state = playSeries(['aquila', 'nerva', 'brutus'])
  expect(state.results).toHaveLength(3)
  expect(state.score.home + state.score.away).toBe(3)
  expect(state.results.map(({ boutIndex }) => boutIndex)).toEqual([0, 1, 2])
  expect(state.results.map((result) => { const fought = asFought(result); return [fought.homeFighterId, fought.opponentId] })).toEqual([
    ['aquila', 'drusus'],
    ['nerva', 'cassius'],
    ['brutus', 'magnus'],
  ])
  for (const outcome of state.results) {
    const result = asFought(outcome)
    expect(['home', 'away']).toContain(result.winnerSide)
    expect(['advantage', 'neutral', 'disadvantage']).toContain(result.advantage)
    expect(['defeat', 'time-limit']).toContain(result.endedBy)
    expect(result.remainingHpRatio.home).toBeGreaterThanOrEqual(0)
    expect(result.remainingHpRatio.home).toBeLessThanOrEqual(1)
    expect(result.remainingHpRatio.away).toBeGreaterThanOrEqual(0)
    expect(result.remainingHpRatio.away).toBeLessThanOrEqual(1)
  }
})

it('copies the finished battle fields into BoutResult in the same transition', () => {
  let state = createMvpSeries()
  state = assignFighter(state, 'aquila', 0).state
  state = assignFighter(state, 'nerva', 1).state
  state = assignFighter(state, 'brutus', 2).state
  state = confirmLineup(state).state
  if (!state.activeBattle) throw new Error('Expected active battle')
  const battle = advanceBattleTicks(state.activeBattle, MAX_BOUT_TICKS)
  const transitioned = advanceSeriesTicks(state, MAX_BOUT_TICKS)
  const home = fighterBySide(battle, 'home')
  const away = fighterBySide(battle, 'away')
  expect(transitioned.phase).toBe('between-bouts')
  expect(asFought(transitioned.results[0])).toMatchObject({
    boutIndex: 0,
    homeFighterId: 'aquila',
    opponentId: 'drusus',
    winnerSide: battle.winnerSide,
    endedBy: battle.finishReason,
    durationTicks: battle.encounter.tick,
    remainingHpRatio: {
      home: home.hp / home.definition.maxHp,
      away: away.hp / away.definition.maxHp,
    },
  })
})

it('records a time-limit endedBy when a bout survives to the tick cap', () => {
  const filler: FighterDefinition = { id: 'filler', name: 'Filler', school: 'Test', archetype: 'technical', maxHp: 100, power: 1, accuracy: 0, defenseChance: 0, criticalChance: 0 }
  const home: FighterDefinition = { id: 'home', name: 'Home', school: 'Test', archetype: 'heavy', maxHp: 100, power: 1, accuracy: 1, defenseChance: 0, criticalChance: 0 }
  const away: FighterDefinition = { id: 'away', name: 'Away', school: 'Test', archetype: 'heavy', maxHp: 150, power: 1, accuracy: 1, defenseChance: 0, criticalChance: 0 }
  let state = createSeries({
    homeRoster: [home, filler, { ...filler, id: 'filler-2' }],
    opponents: [away, { ...filler, id: 'filler-3' }, { ...filler, id: 'filler-4' }],
    seed: 41,
    combatStyles: COMBAT_STYLES,
    homeStartingHpByFighterId: { home: home.maxHp, filler: filler.maxHp, 'filler-2': filler.maxHp },
  })
  state = assignFighter(state, 'home', 0).state
  state = assignFighter(state, 'filler', 1).state
  state = assignFighter(state, 'filler-2', 2).state
  state = confirmLineup(state).state
  const transitioned = advanceSeriesTicks(state, MAX_BOUT_TICKS)
  const result = asFought(transitioned.results[0])
  expect(transitioned.phase).toBe('between-bouts')
  expect(result.endedBy).toBe('time-limit')
  expect(result.durationTicks).toBe(MAX_BOUT_TICKS)

  // The winner is whichever side holds the higher remaining-HP RATIO, which is
  // the duel adapter's time-limit policy. Asserted as that relation rather than
  // as a hardcoded side: the two fighters differ only in maxHp (100 vs 150), so
  // which of them ends ahead is a function of the action damage numbers, and
  // pinning a side would make this test fail on ordinary content retuning while
  // testing nothing extra. The ratio rule is the actual contract.
  const { home: homeRatio, away: awayRatio } = result.remainingHpRatio
  expect(homeRatio).not.toBe(awayRatio)
  expect(result.winnerSide).toBe(homeRatio > awayRatio ? 'home' : 'away')
  expect(transitioned.score).toEqual(result.winnerSide === 'home' ? { home: 1, away: 0 } : { home: 0, away: 1 })
})

it('clears mutable run data but preserves content and seed on rematch', () => {
  const finished = playSeries(['aquila', 'nerva', 'brutus'])
  const restarted = rematch(finished)
  expect(restarted.ok).toBe(true)
  expect(restarted.state).toMatchObject({ phase: 'planning', seed: BASELINE_TEST_SEED, assignments: [null, null, null], results: [], score: { home: 0, away: 0 } })
  expect(restarted.state.homeRoster).toBe(finished.homeRoster)
  expect(restarted.state.opponents).toBe(finished.opponents)
})

// ===========================================================================
// The design's golden scenario (readable-deep-combat-design.md,
// "Golden scenario (`20260815`)"), restored in full by Task 13.
//
// HISTORY, so nobody has to dig for it: Task 11's migration left these tests
// asserting an all-counter SWEEP of `{ home: 3, away: 0 }` plus a `'3-0'`
// belonging to that same lineup, which directly contradicted the design's "the
// all-counter lineup `Brutus→Drusus`, `Aquila→Cassius`, `Nerva→Magnus` must not
// sweep `3–0`". It also relaxed the per-result check to
// `['defeat', 'time-limit']`, because roughly half of all bouts were reaching
// the 3600-tick cap against the design's "fewer than `2%`".
//
// Neither was a balance problem. Task 13 traced them to five conformance
// defects in `combatDecision.ts` -- root travel treated as mandatory rather
// than as a maximum, the zero-weight fallback standing still, the anti-stall
// suppression having no exemption, locomotion never filtered by arena path,
// and `technical-parry-counter` leaking into ordinary weighted selection
// against design.md:516. With those fixed and the content calibrated, the
// cohort timeout rate is 0.06% and all 18 bouts across the six lineups end by
// `defeat`, so both relaxations are now gone: `endedBy` is pinned to `defeat`
// and the all-counter lineup is asserted NOT to sweep.
// ===========================================================================

it('makes stats matter more than blindly taking all counters', () => {
  // The product puzzle the design is protecting: the visible counter triangle
  // is useful but must not be a mechanical answer to stronger opponents. So
  // taking every counter must NOT be the best available lineup.
  const allCounters = playSeries(['brutus', 'aquila', 'nerva'])
  const statsLed = playSeries(['aquila', 'brutus', 'nerva'])

  // Never a sweep -- the design's explicit prohibition. Under the Task 13
  // calibration the all-counter lineup does not merely fail to sweep, it LOSES.
  expect(allCounters.score).not.toEqual({ home: 3, away: 0 })
  expect(allCounters.score).toEqual({ home: 1, away: 2 })

  // ...and a different ordering does strictly better, which is the whole point:
  // reading the stat cards beats reading only the archetype triangle.
  expect(statsLed.score).toEqual({ home: 2, away: 1 })
  expect(statsLed.score.home).toBeGreaterThan(allCounters.score.home)

  // Every bout resolves by defeat, not by running out the 3600-tick clock.
  for (const result of [...allCounters.results, ...statsLed.results]) {
    expect(asFought(result).endedBy).toBe('defeat')
  }
})

// FROZEN CANONICAL HASHES (Task 13 Step 6): the design's golden scenario asks
// that "one complete lineup has a checked canonical event-trace hash". This is
// the `Aquila/Nerva/Brutus` lineup, all three bouts, at the fixed seed.
//
// Per-bout hashes are pinned individually rather than folded into one value, so
// a failure names the bout that moved instead of just saying the series changed.
// Each was read from a probe that printed the hash beside its trace, never
// copied from a failing diff. The reviewed run:
// Bout 0 was re-frozen on 2026-08-18 (Fast's forced disengage went live and
// `fast-burst-lunge` was recalibrated with it); bouts 1 and 2 have no Fast
// fighter in them and came through byte-identical.
//   bout 0  aquila vs drusus   away wins by defeat in 1721 ticks -> 3600fb53
//   bout 1  nerva  vs cassius  home wins by defeat in 2183 ticks -> dee79f52
//   bout 2  brutus vs magnus   home wins by defeat in 1202 ticks -> 563432bd
// Score 2-1, every bout decided by defeat rather than the tick cap, and all
// three durations inside the roster cohort's 1200..2700 median band.
it('matches the frozen canonical trace hashes for the Aquila/Nerva/Brutus lineup', () => {
  let state = createMvpSeries()
  for (const [boutIndex, fighterId] of (['aquila', 'nerva', 'brutus'] as const).entries()) {
    state = assignFighter(state, fighterId, boutIndex).state
  }
  state = confirmLineup(state).state

  const boutHashes: string[] = []
  let recorded = 0
  while (state.phase !== 'summary') {
    if (state.phase === 'fighting') {
      state = advanceSeriesTicks(state, MAX_BOUT_TICKS)
      if (state.results.length > recorded) {
        recorded = state.results.length
        if (!state.activeBattle) throw new Error('Finished bout is missing its battle')
        boutHashes.push(formatTraceHash(state.activeBattle.traceHash))
      }
    } else {
      state = startNextBout(state).state
    }
  }

  // Pin the trace's shape alongside its hashes, so a differently-shaped series
  // cannot coincidentally satisfy the literals.
  expect(state.score).toEqual({ home: 2, away: 1 })
  expect(state.results.map((result) => asFought(result).endedBy)).toEqual(['defeat', 'defeat', 'defeat'])
  expect(state.results.map((result) => asFought(result).durationTicks)).toEqual([1721, 2183, 1202])

  for (const hash of boutHashes) expect(hash).toMatch(/^[0-9a-f]{8}$/)
  expect(boutHashes).toEqual(['3600fb53', 'dee79f52', '563432bd'])
})

// AMENDED CRITERION. The design originally required "at least three distinct
// final score/result profiles" across the six lineups. That was relaxed to two
// by written spec amendment during Task 13 -- see "Amendment - Task 13 balance
// calibration" under Fighter content in
// `docs/superpowers/specs/2026-08-16-readable-deep-combat-design.md`.
//
// The short version: the only reachable third-profile flip at this seed is
// Aquila beating Magnus, which needs Magnus at `maxHp <= ~264`, while keeping
// `brutus/magnus` at or under the cohort's 85% ceiling needs ~282. Brutus
// cannot absorb the difference -- he sits one point above Nerva at his own
// standing floor. A three-profile configuration was built and measured; it
// shipped `brutus/magnus` at 86.5%, out of band, and was rejected. The design's
// own framing decided the priority: the balance section opens with
// "Determinism, style balance, roster balance, and pacing are separate checks",
// and the golden-scenario block calls itself "a determinism/product-puzzle
// fixture, not evidence of statistical balance".
//
// The two golden criteria that carry product intent are unrelaxed and live in
// the test above: the all-counter lineup does not sweep (it loses 1-2), and a
// different lineup does strictly better.
it('produces at least two distinct scores across all six lineups (amended from three)', () => {
  const lineups = [
    ['brutus', 'aquila', 'nerva'],
    ['brutus', 'nerva', 'aquila'],
    ['aquila', 'brutus', 'nerva'],
    ['aquila', 'nerva', 'brutus'],
    ['nerva', 'brutus', 'aquila'],
    ['nerva', 'aquila', 'brutus'],
  ] as const
  const byLineup = new Map(lineups.map((lineup) => {
    const { score, results } = playSeries(lineup)
    for (const result of results) expect(asFought(result).endedBy).toBe('defeat')
    return [lineup.join('/'), `${score.home}-${score.away}`]
  }))
  const scores = new Set(byLineup.values())

  expect(scores.size).toBeGreaterThanOrEqual(2)
  expect(scores).toEqual(new Set(['1-2', '2-1']))

  // No lineup may sweep, and the all-counter ordering must not be among the
  // winners. Asserted by name rather than by set membership, because the set
  // alone cannot tell "some lineup sweeps" from "the forbidden one sweeps".
  expect(scores.has('3-0')).toBe(false)
  expect(byLineup.get('brutus/aquila/nerva')).toBe('1-2')
})

describe('short-handed series', () => {
  const twoFighterConfig = () => ({
    homeRoster: [brutus, aquila],
    opponents,
    seed: 20260815,
    combatStyles: COMBAT_STYLES,
    homeStartingHpByFighterId: { brutus: brutus.maxHp, aquila: aquila.maxHp },
  })

  it('requires exactly as many assignments as there are gladiators', () => {
    const state = createSeries(twoFighterConfig())
    expect(requiredAssignmentCount(state)).toBe(2)
    expect(confirmLineup(state).ok).toBe(false)

    const one = assignFighter(state, 'brutus', 0).state
    expect(confirmLineup(one).ok).toBe(false)
    const two = assignFighter(one, 'aquila', 2).state
    expect(confirmLineup(two).ok).toBe(true)
  })

  it('forfeits the uncovered slot and still reaches three outcomes', () => {
    let state = createSeries(twoFighterConfig())
    state = assignFighter(state, 'brutus', 0).state
    state = assignFighter(state, 'aquila', 2).state
    state = confirmLineup(state).state
    state = advanceSeriesTicks(state, 20_000)
    while (state.phase === 'between-bouts') {
      state = advanceSeriesTicks(startNextBout(state).state, 20_000)
    }

    expect(state.phase).toBe('summary')
    expect(state.results).toHaveLength(3)
    const forfeited = state.results.filter((outcome) => outcome.kind === 'forfeit')
    expect(forfeited).toHaveLength(1)
    expect(forfeited[0]).toMatchObject({ boutIndex: 1, opponentId: opponents[1].id })
    expect(state.score.away).toBeGreaterThanOrEqual(1)
  })

  it('completes a series with no fightable gladiators at all', () => {
    let state = createSeries({ ...twoFighterConfig(), homeRoster: [], homeStartingHpByFighterId: {} })
    expect(requiredAssignmentCount(state)).toBe(0)
    state = confirmLineup(state).state
    expect(state.phase).toBe('summary')
    expect(state.results).toHaveLength(3)
    expect(state.score).toEqual({ home: 0, away: 3 })
    expect(state.activeBattle).toBeUndefined()
  })
})

it('starts an assigned gladiator at the HP the season gave them', () => {
  let state = createSeries({
    homeRoster: [brutus, aquila, nerva],
    opponents,
    seed: 20260815,
    combatStyles: COMBAT_STYLES,
    homeStartingHpByFighterId: { brutus: 100, aquila: aquila.maxHp, nerva: nerva.maxHp },
  })
  state = assignFighter(state, 'brutus', 0).state
  state = assignFighter(state, 'aquila', 1).state
  state = assignFighter(state, 'nerva', 2).state
  state = confirmLineup(state).state
  expect(fighterBySide(state.activeBattle!, 'home').hp).toBe(100)
})
