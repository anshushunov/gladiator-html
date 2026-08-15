import { advanceBattleTicks, createBattle, type BattleFinishReason, type BattleState } from './battle'
import { compareArchetypes, type FighterDefinition, type FighterSide, type MatchupComparison } from './fighters'
import { deriveBoutSeed } from './random'

export type BoutIndex = 0 | 1 | 2
export type SeriesPhase = 'planning' | 'fighting' | 'between-bouts' | 'summary'
export type Assignments = [string | null, string | null, string | null]
export interface SeriesScore { home: number; away: number }
export interface BoutResult {
  boutIndex: BoutIndex
  homeFighterId: string
  opponentId: string
  winnerSide: FighterSide
  advantage: MatchupComparison
  endedBy: BattleFinishReason
  durationTicks: number
  remainingHpRatio: { home: number; away: number }
}
export type SeriesCommandFailure = 'lineup-locked' | 'lineup-incomplete' | 'slot-empty' | 'no-bout-pending' | 'series-not-finished'
export type SeriesCommandResult = { ok: true; state: SeriesState } | { ok: false; state: SeriesState; reason: SeriesCommandFailure }

export interface SeriesState {
  phase: SeriesPhase
  homeRoster: readonly FighterDefinition[]
  opponents: readonly FighterDefinition[]
  seed: number
  assignments: Assignments
  activeBoutIndex: BoutIndex | null
  activeBattle?: BattleState
  results: BoutResult[]
  score: SeriesScore
}

export interface SeriesConfig {
  homeRoster: readonly FighterDefinition[]
  opponents: readonly FighterDefinition[]
  seed: number
}

export function createSeries(config: SeriesConfig): SeriesState {
  return {
    phase: 'planning',
    homeRoster: config.homeRoster,
    opponents: config.opponents,
    seed: config.seed,
    assignments: [null, null, null],
    activeBoutIndex: null,
    results: [],
    score: { home: 0, away: 0 },
  }
}

export function getAssignmentComparison(state: SeriesState, homeFighterId: string, boutIndex: BoutIndex): MatchupComparison {
  const home = state.homeRoster.find(({ id }) => id === homeFighterId)
  const away = state.opponents[boutIndex]
  if (!home || !away) throw new Error('Unknown fighter or bout index')
  return compareArchetypes(home.archetype, away.archetype)
}

export function assignFighter(state: SeriesState, homeFighterId: string, boutIndex: number): SeriesCommandResult {
  if (state.phase !== 'planning') return { ok: false, state, reason: 'lineup-locked' }
  if (!state.homeRoster.some(({ id }) => id === homeFighterId)) throw new Error(`Unknown home fighter: ${homeFighterId}`)
  assertBoutIndex(boutIndex)
  const slot = boutIndex as BoutIndex
  const assignments: Assignments = [...state.assignments]
  const previousSlot = assignments.indexOf(homeFighterId)
  if (previousSlot !== -1) assignments[previousSlot as BoutIndex] = null
  assignments[slot] = homeFighterId
  return { ok: true, state: { ...state, assignments } }
}

export function unassignSlot(state: SeriesState, boutIndex: number): SeriesCommandResult {
  if (state.phase !== 'planning') return { ok: false, state, reason: 'lineup-locked' }
  assertBoutIndex(boutIndex)
  const slot = boutIndex as BoutIndex
  if (state.assignments[slot] === null) return { ok: false, state, reason: 'slot-empty' }
  const assignments: Assignments = [...state.assignments]
  assignments[slot] = null
  return { ok: true, state: { ...state, assignments } }
}

export function confirmLineup(state: SeriesState): SeriesCommandResult {
  if (state.phase !== 'planning') return { ok: false, state, reason: 'lineup-locked' }
  const [first, second, third] = state.assignments
  if (first === null || second === null || third === null) return { ok: false, state, reason: 'lineup-incomplete' }
  const homeFighterId = state.assignments[0] as string
  const battle = createBattle({ home: homeFighter(state, homeFighterId), away: state.opponents[0], seed: deriveBoutSeed(state.seed, 0) })
  return { ok: true, state: { ...state, phase: 'fighting', activeBoutIndex: 0, activeBattle: battle } }
}

export function startNextBout(state: SeriesState): SeriesCommandResult {
  if (state.phase !== 'between-bouts') return { ok: false, state, reason: 'no-bout-pending' }
  if (state.activeBoutIndex === null) throw new Error('Invalid bout index: none')
  const boutIndex = (state.activeBoutIndex + 1) as BoutIndex
  const homeFighterId = state.assignments[boutIndex] as string
  const battle = createBattle({ home: homeFighter(state, homeFighterId), away: state.opponents[boutIndex], seed: deriveBoutSeed(state.seed, boutIndex) })
  return { ok: true, state: { ...state, phase: 'fighting', activeBoutIndex: boutIndex, activeBattle: battle } }
}

export function rematch(state: SeriesState): SeriesCommandResult {
  if (state.phase !== 'summary') return { ok: false, state, reason: 'series-not-finished' }
  return {
    ok: true,
    state: {
      ...state,
      phase: 'planning',
      assignments: [null, null, null],
      activeBoutIndex: null,
      activeBattle: undefined,
      results: [],
      score: { home: 0, away: 0 },
    },
  }
}

export function advanceSeriesTicks(state: SeriesState, ticks: number): SeriesState {
  if (!Number.isInteger(ticks) || ticks < 0) throw new Error('Tick count must be a non-negative integer')
  if (state.phase !== 'fighting') return state
  if (state.activeBoutIndex === null || !state.activeBattle) return state

  const battle = advanceBattleTicks(state.activeBattle, ticks)
  if (battle.phase !== 'finished') return { ...state, activeBattle: battle }

  const winnerSide = battle.winnerSide as FighterSide
  const result: BoutResult = {
    boutIndex: state.activeBoutIndex,
    homeFighterId: battle.fighters.home.definition.id,
    opponentId: battle.fighters.away.definition.id,
    winnerSide,
    advantage: battle.comparison,
    endedBy: battle.finishReason as BattleFinishReason,
    durationTicks: battle.tick,
    remainingHpRatio: {
      home: battle.fighters.home.hp / battle.fighters.home.definition.maxHp,
      away: battle.fighters.away.hp / battle.fighters.away.definition.maxHp,
    },
  }
  const score: SeriesScore = {
    home: state.score.home + (winnerSide === 'home' ? 1 : 0),
    away: state.score.away + (winnerSide === 'away' ? 1 : 0),
  }
  const phase: SeriesPhase = state.activeBoutIndex === 2 ? 'summary' : 'between-bouts'
  return { ...state, phase, activeBattle: battle, results: [...state.results, result], score }
}

function assertBoutIndex(boutIndex: number): void {
  if (!Number.isInteger(boutIndex) || boutIndex < 0 || boutIndex > 2) throw new Error(`Invalid bout index: ${boutIndex}`)
}

function homeFighter(state: SeriesState, homeFighterId: string): FighterDefinition {
  const fighter = state.homeRoster.find(({ id }) => id === homeFighterId)
  if (!fighter) throw new Error(`Unknown home fighter: ${homeFighterId}`)
  return fighter
}