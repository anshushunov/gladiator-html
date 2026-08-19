import { describe, expect, it } from 'vitest'
import { COMBAT_STYLES } from '../content/combatStyles'
import { SEASON_CHALLENGES, SEASON_ROSTER } from '../content/season'
import {
  advanceSeasonTicks, confirmLineup, continueSeason, createSeason, rematchSeason,
  startNextBout, startNextSeries, assignFighter, type SeasonState,
} from './season'

const config = () => ({ seed: 20260815, roster: SEASON_ROSTER, challenges: SEASON_CHALLENGES, combatStyles: COMBAT_STYLES })

/** Plays one whole series with the three named gladiators in slot order. */
function playSeries(start: SeasonState, lineup: readonly [string, string, string]): SeasonState {
  let state = startNextSeries(start).state
  lineup.forEach((fighterId, index) => { state = assignFighter(state, fighterId, index).state })
  state = confirmLineup(state).state
  state = advanceSeasonTicks(state, 20_000)
  while (state.activeSeries?.phase === 'between-bouts') {
    state = advanceSeasonTicks(startNextBout(state).state, 20_000)
  }
  return state
}

describe('season', () => {
  it('opens on the board with a fresh roster and three challenges', () => {
    const state = createSeason(config())
    expect(state.phase).toBe('season-board')
    expect(state.roster).toHaveLength(5)
    expect(state.roster.every((entry) => entry.condition === 'fresh')).toBe(true)
    expect(state.seriesIndex).toBe(0)
  })

  it('charges everyone who fought and restores everyone who rested', () => {
    let state = playSeries(createSeason(config()), ['brutus', 'aquila', 'nerva'])
    state = continueSeason(state).state

    const byId = Object.fromEntries(state.roster.map((entry) => [entry.fighter.id, entry]))
    for (const id of ['brutus', 'aquila', 'nerva']) {
      expect(byId[id].condition).not.toBe('fresh')
      expect(byId[id].boutsFought).toBe(1)
    }
    // Resting while already fresh restores nothing -- the clamp is why the
    // real recovery economy is two useful steps, not six (design.md).
    expect(byId.vitus.condition).toBe('fresh')
    expect(state.lastDeltas.filter((d) => d.cause === 'rested')).toHaveLength(2)
    expect(state.phase).toBe('season-board')
    expect(state.seriesIndex).toBe(1)
  })

  it('reproduces the same season from the same seed and lineups', () => {
    const play = () => {
      let state = playSeries(createSeason(config()), ['brutus', 'aquila', 'nerva'])
      state = continueSeason(state).state
      state = playSeries(state, ['vitus', 'sura', 'brutus'])
      return continueSeason(state).state
    }
    expect(JSON.stringify(play().records)).toBe(JSON.stringify(play().records))
  })

  it('refuses to field a broken gladiator', () => {
    const broken = { ...createSeason(config()) }
    const state: SeasonState = {
      ...broken,
      roster: broken.roster.map((entry) => (entry.fighter.id === 'brutus' ? { ...entry, condition: 'broken' as const } : entry)),
    }
    const started = startNextSeries(state).state
    const rejected = assignFighter(started, 'brutus', 0)
    expect(rejected.ok).toBe(false)
    expect(rejected.reason).toBe('fighter-unavailable')
  })

  it('ends after three series with nine outcomes and a matching score', () => {
    let state = createSeason(config())
    for (const lineup of [['brutus', 'aquila', 'nerva'], ['vitus', 'sura', 'brutus'], ['aquila', 'nerva', 'vitus']] as const) {
      state = continueSeason(playSeries(state, lineup)).state
    }
    expect(state.phase).toBe('season-summary')
    expect(state.records).toHaveLength(3)
    expect(state.records.flatMap((record) => record.outcomes)).toHaveLength(9)
    expect(state.score.home + state.score.away).toBe(9)
    expect(state.score.home).toBe(state.records.reduce((sum, record) => sum + record.score.home, 0))
  })

  it('resets the whole roster on a season rematch', () => {
    let state = createSeason(config())
    for (const lineup of [['brutus', 'aquila', 'nerva'], ['vitus', 'sura', 'brutus'], ['aquila', 'nerva', 'vitus']] as const) {
      state = continueSeason(playSeries(state, lineup)).state
    }
    const restarted = rematchSeason(state).state
    expect(restarted.phase).toBe('season-board')
    expect(restarted.seriesIndex).toBe(0)
    expect(restarted.records).toEqual([])
    expect(restarted.roster.every((entry) => entry.condition === 'fresh' && entry.boutsFought === 0)).toBe(true)
    expect(restarted.seed).toBe(state.seed)
  })
})
