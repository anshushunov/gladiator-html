import { advanceBattleTicks, createBattle, fighterBySide, type BattleFinishReason, type BattleState } from './battle'
import type { CombatStyleCatalog } from './combatActions'
import type { DecisionCollector } from './decisionDiagnostics'
import { DISPOSITION_IDS, isDispositionId, type DispositionId } from './disposition'
import { compareArchetypes, type FighterDefinition, type FighterSide, type MatchupComparison } from './fighters'
import { deriveBoutSeed } from './random'

export type BoutIndex = 0 | 1 | 2
export type SeriesPhase = 'planning' | 'fighting' | 'between-bouts' | 'summary'
export type SeriesOrders = readonly [DispositionId, DispositionId, DispositionId]

/** A slot during planning: either a chosen gladiator or still empty. */
export type PlanningSlot = { kind: 'fighter'; fighterId: string } | null
export type PlanningAssignments = [PlanningSlot, PlanningSlot, PlanningSlot]

/** A slot after `confirmLineup`: empty is no longer possible, only forfeited. */
export type SeriesSlot = { kind: 'fighter'; fighterId: string } | { kind: 'forfeit' }

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
  homeOrder: DispositionId
}
export type BoutOutcome =
  | ({ kind: 'fought' } & BoutResult)
  | { kind: 'forfeit'; boutIndex: BoutIndex; opponentId: string }

export type SeriesCommandFailure = 'lineup-locked' | 'lineup-incomplete' | 'slot-empty' | 'no-bout-pending' | 'series-not-finished' | 'order-locked'
export type SeriesCommandResult = { ok: true; state: SeriesState } | { ok: false; state: SeriesState; reason: SeriesCommandFailure }

export interface SeriesState {
  phase: SeriesPhase
  homeRoster: readonly FighterDefinition[]
  opponents: readonly FighterDefinition[]
  seed: number
  combatStyles: CombatStyleCatalog
  homeStartingHpByFighterId: Readonly<Record<string, number>>
  assignments: PlanningAssignments
  slots: readonly SeriesSlot[]
  activeBoutIndex: BoutIndex | null
  activeBattle?: BattleState
  results: readonly BoutOutcome[]
  score: SeriesScore
  orders: SeriesOrders
  opponentDispositions: readonly DispositionId[]
}

export interface SeriesConfig {
  homeRoster: readonly FighterDefinition[]     // fightable gladiators only
  opponents: readonly FighterDefinition[]
  seed: number
  combatStyles: CombatStyleCatalog
  homeStartingHpByFighterId: Readonly<Record<string, number>>
  /** Per-opponent-slot temperament; default all 'standard'. */
  opponentDispositions?: readonly DispositionId[]
}

export function createSeries(config: SeriesConfig): SeriesState {
  // Same discipline as `createEncounter`'s config validation: a caller who
  // supplies a row is supplying one per opponent slot. Without this the
  // simulation degrades a short row silently (`combatant.disposition` is
  // `undefined`, i.e. 'standard'), but the UI has no such default and prints a
  // literal `undefined` in the temperament badge and the HUD's `Foe:` field.
  if (config.opponentDispositions !== undefined) {
    if (config.opponentDispositions.length !== config.opponents.length) {
      throw new Error(`SeriesConfig opponentDispositions must have one entry per opponent (got ${config.opponentDispositions.length}, expected ${config.opponents.length})`)
    }
    for (const [slot, disposition] of config.opponentDispositions.entries()) {
      if (!isDispositionId(disposition)) {
        throw new Error(`SeriesConfig opponentDispositions[${slot}] must be one of ${DISPOSITION_IDS.join('|')}, got ${String(disposition)}`)
      }
    }
  }
  return {
    phase: 'planning',
    homeRoster: config.homeRoster,
    opponents: config.opponents,
    seed: config.seed,
    combatStyles: config.combatStyles,
    homeStartingHpByFighterId: config.homeStartingHpByFighterId,
    assignments: [null, null, null],
    slots: [],
    activeBoutIndex: null,
    results: [],
    score: { home: 0, away: 0 },
    orders: ['standard', 'standard', 'standard'],
    opponentDispositions: config.opponentDispositions ?? config.opponents.map(() => 'standard' as const),
  }
}

/** How many of the three slots must actually be filled before the lineup can
 * be confirmed: `homeRoster` carries only fightable gladiators, so a roster
 * shorter than three bouts requires fewer assignments, not zero-filled ones. */
export function requiredAssignmentCount(state: SeriesState): number {
  return Math.min(3, state.homeRoster.length)
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
  const assignments: PlanningAssignments = [...state.assignments]
  const previousSlot = assignments.findIndex((entry) => entry?.fighterId === homeFighterId)
  if (previousSlot !== -1) assignments[previousSlot as BoutIndex] = null
  assignments[slot] = { kind: 'fighter', fighterId: homeFighterId }
  return { ok: true, state: { ...state, assignments } }
}

export function unassignSlot(state: SeriesState, boutIndex: number): SeriesCommandResult {
  if (state.phase !== 'planning') return { ok: false, state, reason: 'lineup-locked' }
  assertBoutIndex(boutIndex)
  const slot = boutIndex as BoutIndex
  if (state.assignments[slot] === null) return { ok: false, state, reason: 'slot-empty' }
  const assignments: PlanningAssignments = [...state.assignments]
  assignments[slot] = null
  return { ok: true, state: { ...state, assignments } }
}

/** Freezes planning slots into committed slots: assigned gladiators stay, empty slots become forfeits. */
function freezeSlots(assignments: PlanningAssignments): readonly SeriesSlot[] {
  return assignments.map((slot) => slot ?? ({ kind: 'forfeit' } as const))
}

/**
 * Walks forward from `boutIndex` over any forfeited slots, recording an away
 * win for each, and returns the first slot that must actually be fought --
 * or `null` when the series ends inside the walk. Pure: no battle is created
 * here, so an all-forfeit series never constructs an encounter.
 */
function advancePastForfeits(state: SeriesState, from: BoutIndex): { state: SeriesState; next: BoutIndex | null } {
  let results = [...state.results]
  let score = { ...state.score }
  for (let index = from; index <= 2; index += 1) {
    const slot = state.slots[index]
    if (slot.kind === 'fighter') {
      return { state: { ...state, results, score }, next: index as BoutIndex }
    }
    results = [...results, { kind: 'forfeit', boutIndex: index as BoutIndex, opponentId: state.opponents[index].id }]
    score = { ...score, away: score.away + 1 }
  }
  // `activeBattle` is deliberately left as-is, not cleared: on the all-forfeit
  // path it is already `undefined` (no bout was ever started), and on the
  // trailing-forfeit path (a series that ends by walking off the end right
  // after the last fought bout resolves) it is the finished battle for that
  // last fought bout -- exactly what a series that ends by an ordinary third
  // bout leaves behind, so both ways of reaching `summary` behave the same.
  return { state: { ...state, results, score, phase: 'summary', activeBoutIndex: 2 }, next: null }
}

function startBoutBattle(state: SeriesState, boutIndex: BoutIndex): BattleState {
  const slot = state.slots[boutIndex]
  if (slot.kind !== 'fighter') throw new Error(`Slot ${boutIndex} is not fightable`)
  return createBattle({
    home: homeFighter(state, slot.fighterId),
    away: state.opponents[boutIndex],
    seed: deriveBoutSeed(state.seed, boutIndex),
    combatStyles: state.combatStyles,
    startingHp: { home: state.homeStartingHpByFighterId[slot.fighterId] },
    dispositions: { home: state.orders[boutIndex], away: state.opponentDispositions[boutIndex] },
  })
}

/**
 * Sets the order one bout will be fought under. Planning: any slot. Between
 * bouts: only the next pending slot (`activeBoutIndex + 1`) — everything at
 * or before `activeBoutIndex` is already resolved, everything later is not
 * yet the next decision. Started/finished bouts and other phases refuse with
 * 'order-locked'. Invalid ids/indices are programmer errors and throw,
 * matching unknown-fighter handling.
 */
export function setBoutOrder(state: SeriesState, boutIndex: number, order: DispositionId): SeriesCommandResult {
  assertBoutIndex(boutIndex)
  if (!isDispositionId(order)) throw new Error(`Invalid disposition: ${String(order)}`)
  const slot = boutIndex as BoutIndex
  const allowed = state.phase === 'planning'
    || (state.phase === 'between-bouts' && state.activeBoutIndex !== null && slot === state.activeBoutIndex + 1)
  if (!allowed) return { ok: false, state, reason: 'order-locked' }
  const orders = [...state.orders] as [DispositionId, DispositionId, DispositionId]
  orders[slot] = order
  return { ok: true, state: { ...state, orders } }
}

export function confirmLineup(state: SeriesState): SeriesCommandResult {
  if (state.phase !== 'planning') return { ok: false, state, reason: 'lineup-locked' }
  const filled = state.assignments.filter((entry) => entry !== null).length
  if (filled !== requiredAssignmentCount(state)) return { ok: false, state, reason: 'lineup-incomplete' }
  const slots = freezeSlots(state.assignments)
  const frozen: SeriesState = { ...state, slots }
  const { state: walked, next } = advancePastForfeits(frozen, 0)
  if (next === null) return { ok: true, state: walked }
  const battle = startBoutBattle(walked, next)
  return { ok: true, state: { ...walked, phase: 'fighting', activeBoutIndex: next, activeBattle: battle } }
}

export function startNextBout(state: SeriesState): SeriesCommandResult {
  if (state.phase !== 'between-bouts') return { ok: false, state, reason: 'no-bout-pending' }
  if (state.activeBoutIndex === null) throw new Error(`Invalid bout index: ${state.activeBoutIndex}`)
  const from = (state.activeBoutIndex + 1) as BoutIndex
  const { state: walked, next } = advancePastForfeits(state, from)
  if (next === null) return { ok: true, state: walked }
  const battle = startBoutBattle(walked, next)
  return { ok: true, state: { ...walked, phase: 'fighting', activeBoutIndex: next, activeBattle: battle } }
}

export function rematch(state: SeriesState): SeriesCommandResult {
  if (state.phase !== 'summary') return { ok: false, state, reason: 'series-not-finished' }
  return {
    ok: true,
    state: {
      ...state,
      phase: 'planning',
      assignments: [null, null, null],
      slots: [],
      activeBoutIndex: null,
      activeBattle: undefined,
      results: [],
      score: { home: 0, away: 0 },
      orders: ['standard', 'standard', 'standard'],
    },
  }
}

export function advanceSeriesTicks(state: SeriesState, ticks: number, collector?: DecisionCollector): SeriesState {
  if (!Number.isInteger(ticks) || ticks < 0) throw new Error('Tick count must be a non-negative integer')
  if (state.phase !== 'fighting') return state
  if (state.activeBoutIndex === null || !state.activeBattle) return state

  const battle = advanceBattleTicks(state.activeBattle, ticks, collector)
  if (battle.phase !== 'finished') return { ...state, activeBattle: battle }

  const home = fighterBySide(battle, 'home')
  const away = fighterBySide(battle, 'away')
  if (battle.winnerSide === undefined || battle.finishReason === undefined) {
    throw new Error('Finished battle is missing winnerSide/finishReason')
  }
  const boutIndex = state.activeBoutIndex
  const result: BoutOutcome = {
    kind: 'fought',
    boutIndex,
    homeFighterId: home.definition.id,
    opponentId: away.definition.id,
    winnerSide: battle.winnerSide,
    advantage: compareArchetypes(home.definition.archetype, away.definition.archetype),
    endedBy: battle.finishReason,
    durationTicks: battle.encounter.tick,
    remainingHpRatio: {
      home: home.hp / home.definition.maxHp,
      away: away.hp / away.definition.maxHp,
    },
    homeOrder: state.orders[boutIndex],
  }
  const score: SeriesScore = {
    home: state.score.home + (battle.winnerSide === 'home' ? 1 : 0),
    away: state.score.away + (battle.winnerSide === 'away' ? 1 : 0),
  }
  const afterBout: SeriesState = { ...state, activeBattle: battle, results: [...state.results, result], score }
  if (boutIndex === 2) return { ...afterBout, phase: 'summary' }

  // Walk past any forfeited slots immediately after this one, so a series
  // that has nobody to send out next still reaches `summary` without
  // stopping in `between-bouts` waiting for a `startNextBout` that would
  // have nothing to fight.
  const { state: walked, next } = advancePastForfeits(afterBout, (boutIndex + 1) as BoutIndex)
  if (next === null) return walked
  // `activeBoutIndex` becomes "the last slot this walk has already accounted
  // for" -- one behind `next` -- rather than staying at the just-fought bout.
  // `startNextBout` recomputes `activeBoutIndex + 1` and re-walks from there;
  // leaving this at the fought bout's own index would make that second walk
  // re-scan (and re-record) the very forfeits this one just recorded.
  return { ...walked, phase: 'between-bouts', activeBoutIndex: (next - 1) as BoutIndex }
}

function assertBoutIndex(boutIndex: number): void {
  if (!Number.isInteger(boutIndex) || boutIndex < 0 || boutIndex > 2) throw new Error(`Invalid bout index: ${boutIndex}`)
}

function homeFighter(state: SeriesState, homeFighterId: string): FighterDefinition {
  const fighter = state.homeRoster.find(({ id }) => id === homeFighterId)
  if (!fighter) throw new Error(`Unknown home fighter: ${homeFighterId}`)
  return fighter
}
