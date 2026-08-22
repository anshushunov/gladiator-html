import type { CombatStyleCatalog } from './combatActions'
import { conditionAfterBout, conditionAfterRest, isFightable, startingHpFor, type FighterCondition } from './condition'
import type { Archetype, FighterDefinition } from './fighters'
import { deriveSeriesSeed } from './random'
import {
  assignFighter as assignSeriesFighter,
  confirmLineup as confirmSeriesLineup,
  createSeries,
  advanceSeriesTicks,
  startNextBout as startNextSeriesBout,
  unassignSlot as unassignSeriesSlot,
  type BoutOutcome,
  type SeriesCommandFailure,
  type SeriesCommandResult,
  type SeriesConfig,
  type SeriesScore,
  type SeriesState,
} from './series'

export interface ChallengeDefinition {
  index: 0 | 1 | 2
  opponents: readonly FighterDefinition[]
  featuredThreat: Archetype | null
}

export interface RosterEntry {
  fighter: FighterDefinition
  condition: FighterCondition
  boutsFought: number
}

export interface ConditionDelta {
  fighterId: string
  before: FighterCondition
  after: FighterCondition
  cause: 'fought' | 'rested'
}

export interface SeriesRecord {
  seriesIndex: 0 | 1 | 2
  challengeIndex: 0 | 1 | 2
  outcomes: readonly BoutOutcome[]
  score: SeriesScore
  deltas: readonly ConditionDelta[]
}

export interface SeasonConfig {
  seed: number
  roster: readonly FighterDefinition[]
  challenges: readonly ChallengeDefinition[]
  combatStyles: CombatStyleCatalog
}

export interface SeasonState {
  phase: 'season-board' | 'series' | 'season-summary'
  seed: number
  seriesIndex: 0 | 1 | 2
  roster: readonly RosterEntry[]
  challenges: readonly ChallengeDefinition[]
  combatStyles: CombatStyleCatalog
  activeSeries: SeriesState | null
  records: readonly SeriesRecord[]
  score: SeriesScore
  lastDeltas: readonly ConditionDelta[]
}

// Includes `SeriesCommandFailure` so a delegated command's own failure (e.g.
// confirming an incomplete lineup) can be forwarded verbatim rather than
// papered over -- `'series-not-finished'` is deliberately shared with
// `continueSeason`'s own precondition, since both mean the same thing.
//
// `'no-active-series'` and `'no-series-pending'` are opposite preconditions
// and are deliberately distinct values: the first means "there is no series
// to act on right now" (every command that delegates into `activeSeries`),
// the second means "there is no NEXT series to open" (`startNextSeries`,
// which is only legal from `season-board`). An earlier revision reused
// `'no-series-pending'` for both from `main.ts`, which made a caller unable
// to tell the two apart.
export type SeasonCommandFailure = SeriesCommandFailure | 'no-active-series' | 'no-series-pending' | 'fighter-unavailable' | 'season-not-finished'
// `reason` is declared (as `undefined`) on the success branch too, not left
// absent: that is what lets a caller read `.reason` straight off an `{ ok:
// false }` result without an `if (!result.ok)` narrowing step first.
export type SeasonCommandResult =
  | { ok: true; state: SeasonState; reason?: undefined }
  | { ok: false; state: SeasonState; reason: SeasonCommandFailure }

/** Fightable roster entries: what `startNextSeries` and the planning screen may field. */
export function fightableEntries(state: SeasonState): readonly RosterEntry[] {
  return state.roster.filter((entry) => isFightable(entry.condition))
}

/** Starting HP for every fightable roster member, keyed by fighter id. */
export function startingHpByFighterId(state: SeasonState): Readonly<Record<string, number>> {
  return Object.fromEntries(
    fightableEntries(state).map((entry) => [entry.fighter.id, startingHpFor(entry.condition, entry.fighter.maxHp)]),
  )
}

export function createSeason(config: SeasonConfig): SeasonState {
  return {
    phase: 'season-board',
    seed: config.seed,
    seriesIndex: 0,
    roster: config.roster.map((fighter) => ({ fighter, condition: 'fresh' as const, boutsFought: 0 })),
    challenges: config.challenges,
    combatStyles: config.combatStyles,
    activeSeries: null,
    records: [],
    score: { home: 0, away: 0 },
    lastDeltas: [],
  }
}

export function startNextSeries(state: SeasonState): SeasonCommandResult {
  if (state.phase !== 'season-board') return { ok: false, state, reason: 'no-series-pending' }
  const fightable = fightableEntries(state)
  const challenge = state.challenges[state.seriesIndex]
  const seriesConfig: SeriesConfig = {
    homeRoster: fightable.map((entry) => entry.fighter),
    opponents: challenge.opponents,
    seed: deriveSeriesSeed(state.seed, state.seriesIndex),
    combatStyles: state.combatStyles,
    homeStartingHpByFighterId: startingHpByFighterId(state),
  }
  const activeSeries = createSeries(seriesConfig)
  return { ok: true, state: { ...state, phase: 'series', activeSeries } }
}

/** Runs a series-layer command against the active series and writes the
 * returned `SeriesState` back into `activeSeries`, forwarding `ok`/`reason`
 * verbatim.
 *
 * "There is an active series" is an ordinary precondition, checked here and
 * reported as `'no-active-series'` -- not a thrown programmer error.
 * `activeSeries === null` is a perfectly normal state: it is every moment the
 * season spends on `season-board` or `season-summary`, the whole span between
 * one series closing (`continueSeason`) and the next one opening
 * (`startNextSeries`). Throwing there forced `main.ts` to wrap all five
 * delegating commands in a guard of its own and to borrow
 * `'no-series-pending'` -- `startNextSeries`'s opposite precondition -- to
 * name the refusal. */
function delegateToSeries(state: SeasonState, apply: (series: SeriesState) => SeriesCommandResult): SeasonCommandResult {
  const activeSeries = state.activeSeries
  if (!activeSeries) return { ok: false, state, reason: 'no-active-series' }
  const result = apply(activeSeries)
  if (!result.ok) return { ok: false, state: { ...state, activeSeries: result.state }, reason: result.reason }
  return { ok: true, state: { ...state, activeSeries: result.state } }
}

export function assignFighter(state: SeasonState, fighterId: string, boutIndex: number): SeasonCommandResult {
  const entry = state.roster.find((candidate) => candidate.fighter.id === fighterId)
  if (entry && !isFightable(entry.condition)) return { ok: false, state, reason: 'fighter-unavailable' }
  return delegateToSeries(state, (series) => assignSeriesFighter(series, fighterId, boutIndex))
}

export function unassignSlot(state: SeasonState, boutIndex: number): SeasonCommandResult {
  return delegateToSeries(state, (series) => unassignSeriesSlot(series, boutIndex))
}

export function confirmLineup(state: SeasonState): SeasonCommandResult {
  return delegateToSeries(state, confirmSeriesLineup)
}

/** Advances the active series' clock. Reports the same `'no-active-series'`
 * refusal as every other command that needs one, rather than silently
 * returning the state unchanged -- a caller could not otherwise distinguish
 * "ticked, nothing moved" (an ordinary bout-less phase, which `series.ts`'s
 * own `advanceSeriesTicks` treats as a no-op and this still forwards as
 * `ok: true`) from "there was nothing to tick at all". */
export function advanceSeasonTicks(state: SeasonState, ticks: number): SeasonCommandResult {
  return delegateToSeries(state, (series) => ({ ok: true, state: advanceSeriesTicks(series, ticks) }))
}

export function startNextBout(state: SeasonState): SeasonCommandResult {
  return delegateToSeries(state, startNextSeriesBout)
}

export function continueSeason(state: SeasonState): SeasonCommandResult {
  const activeSeries = state.activeSeries
  // Split rather than folded into one condition, so this command names the
  // same precondition by the same value as its five neighbours do.
  if (!activeSeries) return { ok: false, state, reason: 'no-active-series' }
  if (activeSeries.phase !== 'summary') return { ok: false, state, reason: 'series-not-finished' }

  const fought = new Map<string, BoutOutcome & { kind: 'fought' }>()
  for (const outcome of activeSeries.results) {
    if (outcome.kind === 'fought') fought.set(outcome.homeFighterId, outcome)
  }

  const deltas: ConditionDelta[] = []
  const roster: RosterEntry[] = state.roster.map((entry) => {
    const outcome = fought.get(entry.fighter.id)
    if (outcome) {
      const after = conditionAfterBout(entry.condition, { remainingHpRatio: outcome.remainingHpRatio.home, won: outcome.winnerSide === 'home' })
      deltas.push({ fighterId: entry.fighter.id, before: entry.condition, after, cause: 'fought' })
      return { ...entry, condition: after, boutsFought: entry.boutsFought + 1 }
    }
    const after = conditionAfterRest(entry.condition)
    deltas.push({ fighterId: entry.fighter.id, before: entry.condition, after, cause: 'rested' })
    return { ...entry, condition: after }
  })

  const record: SeriesRecord = {
    seriesIndex: state.seriesIndex,
    challengeIndex: state.challenges[state.seriesIndex].index,
    outcomes: activeSeries.results,
    score: activeSeries.score,
    deltas,
  }
  const score: SeriesScore = {
    home: state.score.home + activeSeries.score.home,
    away: state.score.away + activeSeries.score.away,
  }
  const records = [...state.records, record]

  const isLastSeries = state.seriesIndex === 2
  const next: SeasonState = {
    ...state,
    roster,
    records,
    score,
    lastDeltas: deltas,
    activeSeries: null,
    phase: isLastSeries ? 'season-summary' : 'season-board',
    seriesIndex: isLastSeries ? state.seriesIndex : ((state.seriesIndex + 1) as 0 | 1 | 2),
  }
  return { ok: true, state: next }
}

export function rematchSeason(state: SeasonState): SeasonCommandResult {
  if (state.phase !== 'season-summary') return { ok: false, state, reason: 'season-not-finished' }
  return {
    ok: true,
    state: createSeason({ seed: state.seed, roster: state.roster.map((entry) => entry.fighter), challenges: state.challenges, combatStyles: state.combatStyles }),
  }
}
