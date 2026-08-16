import { describe, expect, it } from 'vitest'
import { COMBAT_STYLES } from '../content/combatStyles'
import { BASELINE_TEST_SEED, homeRoster, opponents } from '../content/mvpSeries'
import { advanceBattleTicks, fighterBySide, MAX_BOUT_TICKS } from './battle'
import type { FighterDefinition } from './fighters'
import { advanceSeriesTicks, assignFighter, confirmLineup, createSeries, rematch, startNextBout, unassignSlot } from './series'

const createMvpSeries = () => createSeries({ homeRoster, opponents, seed: BASELINE_TEST_SEED, combatStyles: COMBAT_STYLES })

describe('series planning', () => {
  it('moves and displaces unique assignments', () => {
    let state = createMvpSeries()
    state = assignFighter(state, 'brutus', 0).state
    state = assignFighter(state, 'aquila', 0).state
    expect(state.assignments).toEqual(['aquila', null, null])
    state = assignFighter(state, 'aquila', 2).state
    expect(state.assignments).toEqual([null, null, 'aquila'])
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
    expect(reassigned.state.assignments).toEqual([null, 'brutus', null])
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
  expect(state.results.map(({ homeFighterId, opponentId }) => [homeFighterId, opponentId])).toEqual([
    ['aquila', 'drusus'],
    ['nerva', 'cassius'],
    ['brutus', 'magnus'],
  ])
  for (const result of state.results) {
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
  expect(transitioned.results[0]).toMatchObject({
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
  })
  state = assignFighter(state, 'home', 0).state
  state = assignFighter(state, 'filler', 1).state
  state = assignFighter(state, 'filler-2', 2).state
  state = confirmLineup(state).state
  const transitioned = advanceSeriesTicks(state, MAX_BOUT_TICKS)
  expect(transitioned.phase).toBe('between-bouts')
  expect(transitioned.results[0].endedBy).toBe('time-limit')
  expect(transitioned.results[0].winnerSide).toBe('away')
  expect(transitioned.results[0].durationTicks).toBe(MAX_BOUT_TICKS)
  expect(transitioned.score).toEqual({ home: 0, away: 1 })
})

it('clears mutable run data but preserves content and seed on rematch', () => {
  const finished = playSeries(['aquila', 'nerva', 'brutus'])
  const restarted = rematch(finished)
  expect(restarted.ok).toBe(true)
  expect(restarted.state).toMatchObject({ phase: 'planning', seed: BASELINE_TEST_SEED, assignments: [null, null, null], results: [], score: { home: 0, away: 0 } })
  expect(restarted.state.homeRoster).toBe(finished.homeRoster)
  expect(restarted.state.opponents).toBe(finished.opponents)
})

// GATE for Task 13 (Balance cohorts, tuning, freeze canonical hashes).
//
// HISTORY: Task 11's migration left this test asserting an all-counter sweep
// of `{ home: 3, away: 0 }` and a `'3-0'` member of the six-lineup set, which
// directly CONTRADICTED the design's golden-scenario acceptance
// (readable-deep-combat-design.md, "Golden scenario (`20260815`)"): "the
// all-counter lineup `Brutus→Drusus`, `Aquila→Cassius`, `Nerva→Magnus` must
// not sweep `3–0`". It also relaxed the per-result check to
// `['defeat', 'time-limit']` because roughly half of all bouts were reaching
// the 3600-tick cap, against the design's "fewer than `2%`".
//
// Task 13's cohort measurements traced both symptoms to two defects in
// `combatDecision.ts` rather than to content balance: `rootTravel` was treated
// as mandatory rather than as a maximum that stops early at minimum
// separation (making every action illegal at the 0.9 separation floor), and
// the zero-weight fallback stood still instead of closing toward the preferred
// range. With those fixed, the all-counter lineup no longer sweeps and every
// bout below ends by `defeat` -- see task-13-report.md.
//
// STILL OPEN for Task 13 proper: the literals below are post-fix but
// PRE-TUNING, so they are not yet a passing balance target. The fixed
// statistical cohorts still have to be built and the permitted content knobs
// tuned; the score literals here will move again when they are, and the
// `['defeat', 'time-limit']` relaxation and this test's name are restored at
// that point, once the timeout band is actually measured rather than assumed.
it('produces a deterministic, non-uniform score across lineups for the same seed', () => {
  const allCounters = playSeries(['brutus', 'aquila', 'nerva'])
  const mixed = playSeries(['aquila', 'nerva', 'brutus'])
  expect(allCounters.score).toEqual({ home: 2, away: 1 })
  expect(mixed.score).toEqual({ home: 2, away: 1 })
  for (const result of [...allCounters.results, ...mixed.results]) {
    expect(['defeat', 'time-limit']).toContain(result.endedBy)
  }
})

it('produces at least three distinct scores across all six lineups', () => {
  const lineups = [
    ['brutus', 'aquila', 'nerva'],
    ['brutus', 'nerva', 'aquila'],
    ['aquila', 'brutus', 'nerva'],
    ['aquila', 'nerva', 'brutus'],
    ['nerva', 'brutus', 'aquila'],
    ['nerva', 'aquila', 'brutus'],
  ] as const
  const scores = new Set(lineups.map((lineup) => {
    const { score } = playSeries(lineup)
    return `${score.home}-${score.away}`
  }))
  expect(scores.size).toBeGreaterThanOrEqual(3)
  // Post-defect-fix, pre-tuning literals (see the GATE note above). The `'3-0'`
  // here is `brutus/nerva/aquila`, NOT the all-counter lineup, which is
  // exactly the shape the design's golden scenario asks for: the all-counter
  // ordering must not sweep, and "at least one different lineup wins 2-1 or
  // 3-0". Task 13's content tuning will move these again.
  expect(scores).toEqual(new Set(['2-1', '3-0', '1-2']))
})
