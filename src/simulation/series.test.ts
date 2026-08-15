import { describe, expect, it } from 'vitest'
import { BASELINE_TEST_SEED, homeRoster, opponents, TARGET_MAX_BOUT_TICKS, TARGET_MIN_BOUT_TICKS } from '../content/mvpSeries'
import { advanceBattleTicks } from './battle'
import { advanceSeriesTicks, assignFighter, confirmLineup, createSeries, rematch, startNextBout, unassignSlot } from './series'

const createMvpSeries = () => createSeries({ homeRoster, opponents, seed: BASELINE_TEST_SEED })

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
      ? advanceSeriesTicks(state, 2700)
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
  const battle = advanceBattleTicks(state.activeBattle, 2700)
  const transitioned = advanceSeriesTicks(state, 2700)
  expect(transitioned.phase).toBe('between-bouts')
  expect(transitioned.results[0]).toMatchObject({
    boutIndex: 0,
    homeFighterId: 'aquila',
    opponentId: 'drusus',
    winnerSide: battle.winnerSide,
    endedBy: battle.finishReason,
    durationTicks: battle.tick,
    remainingHpRatio: {
      home: battle.fighters.home.hp / battle.fighters.home.definition.maxHp,
      away: battle.fighters.away.hp / battle.fighters.away.definition.maxHp,
    },
  })
})

it('clears mutable run data but preserves content and seed on rematch', () => {
  const finished = playSeries(['aquila', 'nerva', 'brutus'])
  const restarted = rematch(finished)
  expect(restarted.ok).toBe(true)
  expect(restarted.state).toMatchObject({ phase: 'planning', seed: BASELINE_TEST_SEED, assignments: [null, null, null], results: [], score: { home: 0, away: 0 } })
  expect(restarted.state.homeRoster).toBe(finished.homeRoster)
  expect(restarted.state.opponents).toBe(finished.opponents)
})

it('makes stats matter more than blindly taking all counters', () => {
  const allCounters = playSeries(['brutus', 'aquila', 'nerva'])
  const mixed = playSeries(['aquila', 'nerva', 'brutus'])
  expect(allCounters.score).toEqual({ home: 1, away: 2 })
  expect(mixed.score).toEqual({ home: 2, away: 1 })
  for (const result of [...allCounters.results, ...mixed.results]) {
    expect(result.endedBy).toBe('defeat')
    expect(result.durationTicks).toBeGreaterThanOrEqual(TARGET_MIN_BOUT_TICKS)
    expect(result.durationTicks).toBeLessThanOrEqual(TARGET_MAX_BOUT_TICKS)
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
  expect(scores).toEqual(new Set(['0-3', '1-2', '2-1']))
})