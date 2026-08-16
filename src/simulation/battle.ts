// The duel adapter: a thin two-ID wrapper around the encounter kernel.
//
// This module owns:
// - Mapping a `home`/`away` duel onto the kernel's collection-first
//   `EncounterState` via a fixed `DuelDescriptor` (`home.${fighterId}` /
//   `away.${fighterId}` `CombatantId`s), the duel arena's fixed dimensions,
//   and the `ordered-pair` movement policy.
// - The duel-only time-limit policy (`design.md`'s "For the current duel
//   adapter, on tick 3600..."): the kernel itself only ever completes on
//   `no-hostile-pairs`, so this adapter layers its own tick-3600 HP-ratio
//   comparison on top of the same generic `finishEncounter`, never mutating
//   kernel phase/result directly.
// - Accumulating the complete duel event log and a folded trace hash across
//   ticks; the kernel itself never owns an unbounded log (`EncounterState`
//   stores only `nextEventId`).
//
// It never reimplements combat rules: damage, contact, movement, decisions,
// and completion all stay in `encounter.ts` and the modules it composes.
// `FighterSide`/`home`/`away` identity lives only here, in `series.ts`, and
// in presentation -- the kernel never sees it (see `encounter.ts`'s own
// header comment and `architecture.test.ts`'s kernel-identity boundary
// check).

import {
  advanceEncounterTick as advanceEncounterTickOnce,
  createEncounter,
  finishEncounter,
  type CombatantId,
  type EncounterEvent,
  type EncounterResult,
  type EncounterState,
  type FighterCombatState,
} from './encounter'
import type { CombatStyleCatalog } from './combatActions'
import type { FighterDefinition, FighterSide } from './fighters'
import type { CombatArenaDefinition, Vec2 } from './movement'
import { derivedUnitValue, foldTraceHash } from './random'

export const TICKS_PER_SECOND = 60
export const MAX_BOUT_TICKS = 3600

const DUEL_RADIUS = 6.5
const DUEL_LATERAL_LIMIT = 2.5
const DUEL_MINIMUM_SEPARATION = 0.9
const HOME_START_POSITION: Readonly<Vec2> = { x: -4.2, z: 0 }
const AWAY_START_POSITION: Readonly<Vec2> = { x: 4.2, z: 0 }

export type BattleFinishReason = 'defeat' | 'time-limit'
export type BattlePhase = 'running' | 'finished'

export interface BattleConfig {
  home: FighterDefinition
  away: FighterDefinition
  seed: number
  combatStyles: CombatStyleCatalog
}

export interface DuelDescriptor {
  homeId: CombatantId
  awayId: CombatantId
}

export interface BattleState {
  descriptor: DuelDescriptor
  encounter: EncounterState
  phase: BattlePhase
  events: readonly EncounterEvent[]
  traceHash: number
  winnerSide?: FighterSide
  finishReason?: BattleFinishReason
}

function duelArena(descriptor: DuelDescriptor): Readonly<CombatArenaDefinition> {
  return {
    radius: DUEL_RADIUS,
    lateralLimit: DUEL_LATERAL_LIMIT,
    minimumSeparation: DUEL_MINIMUM_SEPARATION,
    movementPolicy: 'ordered-pair',
    orderedPair: [descriptor.homeId, descriptor.awayId],
  }
}

/** Folds one tick's canonical trace: the tick number, then every event it emitted, in emission order. Production-side counterpart to `encounter.test.ts`'s test-only fold (Task 10) -- deliberately lighter: it folds emitted events rather than re-deriving full quantized combatant/RNG state, which stays a test-only diagnostic never owned by the kernel. */
function foldBattleTick(hash: number, tick: number, tickEvents: readonly EncounterEvent[]): number {
  let next = foldTraceHash(hash, String(tick))
  for (const event of tickEvents) {
    next = foldTraceHash(next, JSON.stringify(event))
  }
  return next
}

function sideForId(descriptor: DuelDescriptor, id: CombatantId): FighterSide | undefined {
  if (id === descriptor.homeId) return 'home'
  if (id === descriptor.awayId) return 'away'
  return undefined
}

function mapWinnerSide(descriptor: DuelDescriptor, result: EncounterResult | undefined): FighterSide | undefined {
  const winnerId = result?.winnerIds[0]
  return winnerId === undefined ? undefined : sideForId(descriptor, winnerId)
}

/**
 * The duel-only time-limit policy (design.md): compares remaining HP ratios
 * between the two still-active fighters, breaking an exact tie with a value
 * derived from the encounter seed and the sorted candidate IDs -- never a
 * combatant stream draw, matching "priority and time-limit ties never
 * consume combatant streams." Both fighters remain `survivorIds` (neither
 * was defeated); only the selected one becomes `winnerIds`.
 */
function deriveTimeLimitResult(descriptor: DuelDescriptor, encounter: EncounterState): EncounterResult {
  const home = encounter.combatants[descriptor.homeId]
  const away = encounter.combatants[descriptor.awayId]
  const homeRatio = home.hp / home.definition.maxHp
  const awayRatio = away.hp / away.definition.maxHp
  const candidates = [descriptor.homeId, descriptor.awayId].sort()

  let winnerId: CombatantId
  if (homeRatio === awayRatio) {
    const unit = derivedUnitValue(encounter.seed, `time-limit-tie:${encounter.tick}:${candidates.join(',')}`)
    winnerId = unit < 0.5 ? candidates[0] : candidates[1]
  } else {
    winnerId = homeRatio > awayRatio ? descriptor.homeId : descriptor.awayId
  }

  return {
    reason: 'time-limit',
    survivorIds: candidates,
    winnerIds: [winnerId],
    winningFactionIds: [encounter.combatants[winnerId].factionId],
  }
}

export function createBattle(config: BattleConfig): BattleState {
  const descriptor: DuelDescriptor = {
    homeId: `home.${config.home.id}`,
    awayId: `away.${config.away.id}`,
  }

  const transition = createEncounter({
    seed: config.seed,
    combatants: [
      { id: descriptor.homeId, factionId: 'home', fighter: config.home, startPosition: HOME_START_POSITION },
      { id: descriptor.awayId, factionId: 'away', fighter: config.away, startPosition: AWAY_START_POSITION },
    ],
    arena: duelArena(descriptor),
    hostility: { mode: 'different-factions' },
    combatStyles: config.combatStyles,
  })

  return {
    descriptor,
    encounter: transition.state,
    phase: 'running',
    events: transition.events,
    traceHash: foldBattleTick(0, transition.state.tick, transition.events),
  }
}

/**
 * At tick 3600, the kernel transition is accepted first, so a scheduled
 * contact already resolving on this exact tick still lands normally. If that
 * transition already finished the encounter (`no-hostile-pairs`), its result
 * is mapped as-is and the duel time limit never fires -- `finishEncounter` is
 * never called twice. Otherwise the duel time-limit policy above applies,
 * appending its own `encounter-finished` event to this tick's batch.
 */
export function advanceBattleTick(previous: BattleState): BattleState {
  if (previous.phase === 'finished') return previous

  const { descriptor } = previous
  const { state: afterTick, events: tickEvents } = advanceEncounterTickOnce(previous.encounter)

  let encounter = afterTick
  let events = tickEvents
  let phase: BattlePhase = 'running'
  let winnerSide: FighterSide | undefined
  let finishReason: BattleFinishReason | undefined

  if (afterTick.phase === 'finished') {
    phase = 'finished'
    finishReason = 'defeat'
    winnerSide = mapWinnerSide(descriptor, afterTick.result)
  } else if (afterTick.tick === MAX_BOUT_TICKS) {
    const result = deriveTimeLimitResult(descriptor, afterTick)
    const finished = finishEncounter(afterTick, result)
    encounter = finished.state
    events = [...tickEvents, ...finished.events]
    phase = 'finished'
    finishReason = 'time-limit'
    winnerSide = mapWinnerSide(descriptor, encounter.result)
  }

  return {
    descriptor,
    encounter,
    phase,
    events: [...previous.events, ...events],
    traceHash: foldBattleTick(previous.traceHash, encounter.tick, events),
    winnerSide,
    finishReason,
  }
}

export function advanceBattleTicks(initial: BattleState, ticks: number): BattleState {
  let state = initial
  for (let index = 0; index < ticks && state.phase === 'running'; index += 1) {
    state = advanceBattleTick(state)
  }
  return state
}

export function fighterBySide(state: BattleState, side: FighterSide): FighterCombatState {
  const id = side === 'home' ? state.descriptor.homeId : state.descriptor.awayId
  return state.encounter.combatants[id]
}

export function sideForCombatantId(state: BattleState, id: CombatantId): FighterSide {
  const side = sideForId(state.descriptor, id)
  if (side === undefined) throw new Error(`Unknown combatant id for this duel: ${id}`)
  return side
}
