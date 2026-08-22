import { describe, expect, it } from 'vitest'
import { COMBAT_STYLES } from '../content/combatStyles'
import { BASELINE_TEST_SEED, homeRoster, opponents } from '../content/mvpSeries'
import { advanceBattleTicks, createBattle, MAX_BOUT_TICKS } from './battle'
import type { DispositionId } from './disposition'
import {
  advanceSeriesTicks, assignFighter, confirmLineup, createSeries, rematch, setBoutOrder, startNextBout,
  type SeriesState,
} from './series'

const brutus = homeRoster.find(({ id }) => id === 'brutus')!
const drusus = opponents.find(({ id }) => id === 'drusus')!

const createMvpSeries = (opponentDispositions?: readonly DispositionId[]) => createSeries({
  homeRoster,
  opponents,
  seed: BASELINE_TEST_SEED,
  combatStyles: COMBAT_STYLES,
  homeStartingHpByFighterId: Object.fromEntries(homeRoster.map((fighter) => [fighter.id, fighter.maxHp])),
  ...(opponentDispositions !== undefined ? { opponentDispositions } : {}),
})

function confirmed(state: SeriesState): SeriesState {
  let next = state
  next = assignFighter(next, 'brutus', 0).state
  next = assignFighter(next, 'aquila', 1).state
  next = assignFighter(next, 'nerva', 2).state
  return confirmLineup(next).state
}

describe('battle dispositions', () => {
  const config = { home: brutus, away: drusus, seed: BASELINE_TEST_SEED, combatStyles: COMBAT_STYLES }
  it('omitted and explicit standard produce the identical trace', () => {
    const omitted = advanceBattleTicks(createBattle(config), MAX_BOUT_TICKS)
    const explicit = advanceBattleTicks(createBattle({ ...config, dispositions: { home: 'standard', away: 'standard' } }), MAX_BOUT_TICKS)
    expect(explicit.traceHash).toBe(omitted.traceHash)
  })
  // Seed 42, not BASELINE_TEST_SEED: with brutus/drusus at battle.ts's fixed
  // duel start positions, BASELINE_TEST_SEED's (20260815) decision-stream
  // rolls happen to land at the extremes (near 0 or near 1) at every single
  // tick where press's weight bump would matter, so 'press' and 'standard'
  // produce a byte-identical 3600-tick trace under that seed even though
  // scored candidate lists and weights genuinely differ throughout. This is
  // the exact same coincidence `encounterDisposition.test.ts` documents at
  // the encounter layer (verified directly: 7 of 8 seeds tried -- 1, 2, 3,
  // 42, 12345, 999999, 555 -- diverge as expected through this battle.ts
  // wrapper too; only 20260815 does not). 42 is swapped in so this test
  // exercises what it asserts.
  it('a press order changes the trace', () => {
    const pressConfig = { ...config, seed: 42 }
    const standard = advanceBattleTicks(createBattle(pressConfig), MAX_BOUT_TICKS)
    const press = advanceBattleTicks(createBattle({ ...pressConfig, dispositions: { home: 'press' } }), MAX_BOUT_TICKS)
    expect(press.traceHash).not.toBe(standard.traceHash)
  })
})

describe('setBoutOrder', () => {
  it('defaults every bout to standard and every opponent to standard', () => {
    const state = createMvpSeries()
    expect(state.orders).toEqual(['standard', 'standard', 'standard'])
    expect(state.opponentDispositions).toEqual(['standard', 'standard', 'standard'])
  })
  it('accepts any slot during planning', () => {
    let state = createMvpSeries()
    state = setBoutOrder(state, 0, 'press').state
    state = setBoutOrder(state, 2, 'guarded').state
    expect(state.orders).toEqual(['press', 'standard', 'guarded'])
  })
  it('throws for an invalid disposition or bout index', () => {
    const state = createMvpSeries()
    expect(() => setBoutOrder(state, 0, 'aggressive' as DispositionId)).toThrow()
    expect(() => setBoutOrder(state, 3, 'press')).toThrow()
  })
  it('locks started and resolved bouts, allows only the next pending one between bouts', () => {
    let state = confirmed(createMvpSeries())
    expect(setBoutOrder(state, 0, 'press')).toMatchObject({ ok: false, reason: 'order-locked' })
    state = advanceSeriesTicks(state, MAX_BOUT_TICKS)          // bout 0 resolves -> between-bouts
    expect(state.phase).toBe('between-bouts')
    expect(setBoutOrder(state, 0, 'press')).toMatchObject({ ok: false, reason: 'order-locked' })
    expect(setBoutOrder(state, 2, 'press')).toMatchObject({ ok: false, reason: 'order-locked' })
    const changed = setBoutOrder(state, 1, 'guarded')
    expect(changed.ok).toBe(true)
    expect(changed.state.orders[1]).toBe('guarded')
  })
  it('records homeOrder on the fought result and applies the order to the bout', () => {
    const standardRun = advanceSeriesTicks(confirmed(createMvpSeries()), MAX_BOUT_TICKS)
    let pressState = createMvpSeries()
    pressState = setBoutOrder(pressState, 0, 'press').state
    const pressRun = advanceSeriesTicks(confirmed(pressState), MAX_BOUT_TICKS)
    const standardResult = standardRun.results[0]
    const pressResult = pressRun.results[0]
    if (standardResult.kind !== 'fought' || pressResult.kind !== 'fought') throw new Error('expected fought bouts')
    expect(standardResult.homeOrder).toBe('standard')
    expect(pressResult.homeOrder).toBe('press')
    expect(pressRun.activeBattle!.traceHash).not.toBe(standardRun.activeBattle!.traceHash)
  })
  it('opponent dispositions flow into the bout', () => {
    const steady = advanceSeriesTicks(confirmed(createMvpSeries()), MAX_BOUT_TICKS)
    const aggressive = advanceSeriesTicks(confirmed(createMvpSeries(['press', 'standard', 'standard'])), MAX_BOUT_TICKS)
    expect(aggressive.activeBattle!.traceHash).not.toBe(steady.activeBattle!.traceHash)
  })
  it('rematch resets orders to standard', () => {
    let state = createMvpSeries()
    state = setBoutOrder(state, 0, 'press').state
    state = confirmed(state)
    while (state.phase !== 'summary') {
      state = advanceSeriesTicks(state, MAX_BOUT_TICKS)
      if (state.phase === 'between-bouts') state = startNextBout(state).state
    }
    const rematched = rematch(state).state
    expect(rematched.orders).toEqual(['standard', 'standard', 'standard'])
  })
})
