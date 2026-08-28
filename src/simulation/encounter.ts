// Collection-first encounter state, hostility rules, the complete structured
// event union, and generic completion/invariant checks.
//
// This module owns:
// - `CombatantId`/`FactionId`/`ActionInstanceId`, the encounter-local
//   identities. `FighterSide`/`home`/`away` are a series/UI concept and never
//   appear here; the duel becomes a two-combatant adapter over this kernel
//   in a later task.
// - Hostility rules across `free-for-all`, `different-factions`, and
//   symmetric `relation-table` modes, queried through `areHostile` so no
//   mode is ever hard-coded into decision/action logic.
// - `EncounterState`, plain immutable data that must survive
//   `structuredClone` with deep equality: no event-history array, no spatial
//   hash, no `Map`, no Three.js object, no function, no audio object.
// - The complete discriminated `EncounterEvent` union (most variants are not
//   emitted until later tasks add the tick loop and contact resolution).
// - `createEncounter`, generic `finishEncounter`, and
//   `assertEncounterInvariants`. `advanceEncounterTick` is a later task; this
//   file does not stub it.
//
// This module never imports `src/content/**`: a `CombatStyleCatalog` arrives
// by injection through `EncounterConfig`. `src/simulation/architecture.test.ts`
// enforces the simulation boundary (no DOM/Three.js/audio/content/presentation
// imports, no `Math.random`/clock/Web Crypto/runtime trig).

import {
  actionContactTick,
  applyStaggerToAction,
  calculateBlockedStaggerTicks,
  calculateContactDamage,
  calculateContactPoint,
  calculateEvadeDisplacementDistance,
  calculatePushDirection,
  CRITICAL_DAMAGE_MULTIPLIER,
  evadeDirectionVector,
  GUARD_DAMAGE_MULTIPLIER,
  GUARD_PUSH_MULTIPLIER,
  isWithinAttackGeometry,
  isWithinIncomingFacingArc,
  PARRY_ATTACKER_STAGGER_TICKS,
  rankEvadeDirections,
  selectEvadeDirection,
  startAttackAction,
  transitionActionPhase,
  type AttackActionDefinition,
  type AttackActionId,
  type CombatActionId,
  type CombatActionState,
  type CombatStyleCatalog,
  type CombatStyleDefinition,
  type ContactZone,
  type DefenseActionId,
  type ReactionRecord,
} from './combatActions'
import {
  acquireNearestHostile,
  buildCombatDecisionContext,
  chooseCombatDecision,
  decisionIntervalTicks,
  hasFastForcedDisengageEnded,
  isDefenseReactionOpportunity,
  processDefenseBatch,
  resolveForcedParryCounterStart,
  retainTarget,
  scoreCombatCandidates,
  TARGET_ACQUISITION_RADIUS,
  TARGET_RETENTION_RADIUS,
  type IncomingThreat,
} from './combatDecision'
import type { ContactCollector, ContactOutcome } from './contactDiagnostics'
import type { DecisionCollector, DecisionRecord } from './decisionDiagnostics'
import type { DisengageCollector, DisengageSample } from './disengageDiagnostics'
import { DISPOSITION_IDS, dispositionModifiers, isDispositionId, type DispositionId } from './disposition'
import type { FighterDefinition } from './fighters'
import { compareArchetypes, comparisonDamageMultiplier, validateFighterDefinition } from './fighters'
import type { CombatArenaDefinition, LocomotionIntent, MovementRequest, TurnStep, Vec2 } from './movement'
import { distanceBetween, intentDisplacement, normalizeVec2, resolveSimultaneousMovement, TICKS_PER_SECOND, turnFacing } from './movement'
import type { CombatantRandomState } from './random'
import { createCombatantRandomState, derivedUnitValue, drawPair } from './random'
import { buildSpatialHash, queryRadius, type SpatialHash } from './spatialHash'

// ---------------------------------------------------------------------------
// Identity
// ---------------------------------------------------------------------------

export type CombatantId = string
export type FactionId = string
export type ActionInstanceId = string

// Reserves `:` for `ActionInstanceId` (`${actorId}:${serial}`).
const ID_PATTERN = /^[A-Za-z0-9._-]+$/

// ---------------------------------------------------------------------------
// Hostility
// ---------------------------------------------------------------------------

export type HostilityRelation = 'allied' | 'neutral' | 'hostile'

export type HostilityDefinition =
  | { mode: 'free-for-all' }
  | { mode: 'different-factions' }
  | {
      mode: 'relation-table'
      relations: readonly { first: FactionId; second: FactionId; relation: HostilityRelation }[]
    }

function canonicalFactionPairKey(first: FactionId, second: FactionId): string {
  return [first, second].sort().join('|')
}

function findRelationRow(
  relations: readonly { first: FactionId; second: FactionId; relation: HostilityRelation }[],
  factionA: FactionId,
  factionB: FactionId,
): HostilityRelation | undefined {
  const key = canonicalFactionPairKey(factionA, factionB)
  for (const row of relations) {
    if (canonicalFactionPairKey(row.first, row.second) === key) return row.relation
  }
  return undefined
}

/**
 * Resolves the relation between two factions under `hostility`, ignoring
 * combatant liveness (callers combine this with a liveness/distinctness
 * check; see `areHostile`). `relation-table` is symmetric: a missing
 * same-faction entry defaults to `allied`, a missing cross-faction entry
 * defaults to `neutral`.
 */
export function resolveFactionRelation(hostility: HostilityDefinition, factionA: FactionId, factionB: FactionId): HostilityRelation {
  switch (hostility.mode) {
    case 'free-for-all':
      return 'hostile'
    case 'different-factions':
      return factionA === factionB ? 'allied' : 'hostile'
    case 'relation-table': {
      const row = findRelationRow(hostility.relations, factionA, factionB)
      if (row) return row
      return factionA === factionB ? 'allied' : 'neutral'
    }
  }
}

/**
 * True when `firstId` and `secondId` are distinct, both alive, and their
 * factions resolve to `hostile` under `state.hostility`. This is the single
 * entry point hostility-dependent logic must use; no mode is special-cased
 * outside this module.
 */
export function areHostile(state: Pick<EncounterState, 'hostility' | 'combatants'>, firstId: CombatantId, secondId: CombatantId): boolean {
  if (firstId === secondId) return false
  const first = state.combatants[firstId]
  const second = state.combatants[secondId]
  if (!first || !second) return false
  if (first.status !== 'active' || second.status !== 'active') return false
  return resolveFactionRelation(state.hostility, first.factionId, second.factionId) === 'hostile'
}

function hasAnyHostilePair(state: Pick<EncounterState, 'hostility' | 'combatants'>, sortedIds: readonly CombatantId[]): boolean {
  for (let i = 0; i < sortedIds.length; i += 1) {
    for (let j = i + 1; j < sortedIds.length; j += 1) {
      if (areHostile(state, sortedIds[i], sortedIds[j])) return true
    }
  }
  return false
}

function requireNoConflictingRelations(relations: readonly { first: FactionId; second: FactionId; relation: HostilityRelation }[]): void {
  const seen = new Map<string, HostilityRelation>()
  for (const row of relations) {
    const key = canonicalFactionPairKey(row.first, row.second)
    const existing = seen.get(key)
    if (existing !== undefined && existing !== row.relation) {
      throw new Error(`EncounterConfig hostility.relations has conflicting rows for factions '${row.first}'/'${row.second}'`)
    }
    seen.set(key, row.relation)
  }
}

// ---------------------------------------------------------------------------
// Combatant and encounter state
// ---------------------------------------------------------------------------

export interface FighterCombatState {
  id: CombatantId
  factionId: FactionId
  /** Present only when fighting under a non-'standard' disposition; see `EncounterCombatantDefinition.disposition`. */
  disposition?: DispositionId
  definition: FighterDefinition
  targetId?: CombatantId
  position: Vec2
  facing: Vec2
  travelledDistance: number
  hp: number
  status: 'active' | 'defeated'
  locomotionIntent: LocomotionIntent
  velocity: Vec2
  action: CombatActionState
  staggerUntilTick: number
  nextDecisionTick: number
  nextActionSerial: number
  lastContactTick: number
  lastResolutionTick: number
  reactionLedger: readonly ReactionRecord[]
  forcedActionId?: AttackActionId
  /**
   * Set to the tick Fast's forced disengage began (immediately after a
   * `fast-burst-lunge` recovery ends), cleared once
   * `hasFastForcedDisengageEnded` (combatDecision.ts) reports the range or
   * tick-count exit condition. `undefined` whenever the fighter is not
   * currently in this forced state. Technical's forced parry-counter instead
   * uses `forcedActionId` above (a contact-resolution outcome, phase 9):
   * that field is a one-shot flag consumed by `resolveForcedActionStarts`,
   * not a persistent multi-tick state like this one.
   */
  forcedDisengageStartTick?: number
}

export interface EncounterCombatantDefinition {
  id: CombatantId
  factionId: FactionId
  fighter: FighterDefinition
  startPosition: Vec2
  /**
   * Optional HP this combatant enters the encounter with. Omitted (the only
   * value the duel adapter used before the season meta-loop) means `maxHp`,
   * which is why every frozen trace hash survives this field's addition.
   */
  startingHp?: number
  /**
   * Optional disposition (order/temperament) this combatant fights under.
   * Omitted or 'standard' — the only values anything produced before this
   * field existed — leaves combatant state without the key entirely, which is
   * why every frozen trace hash survives this field's addition (same
   * mechanism as `startingHp` above).
   */
  disposition?: DispositionId
}

export interface EncounterConfig {
  seed: number
  combatants: readonly EncounterCombatantDefinition[]
  arena: Readonly<CombatArenaDefinition>
  hostility: Readonly<HostilityDefinition>
  combatStyles: CombatStyleCatalog
}

export type EncounterFinishReason = 'no-hostile-pairs' | 'time-limit'

export interface EncounterResult {
  reason: EncounterFinishReason
  survivorIds: readonly CombatantId[]
  winnerIds: readonly CombatantId[]
  winningFactionIds: readonly FactionId[]
}

export interface EncounterState {
  tick: number
  phase: 'running' | 'finished'
  seed: number
  combatantIds: readonly CombatantId[]
  combatants: Readonly<Record<CombatantId, FighterCombatState>>
  arena: Readonly<CombatArenaDefinition>
  hostility: Readonly<HostilityDefinition>
  combatStyles: CombatStyleCatalog
  randomByCombatant: Readonly<Record<CombatantId, CombatantRandomState>>
  nextEventId: number
  result?: Readonly<EncounterResult>
}

export interface EncounterTransition {
  state: EncounterState
  events: readonly EncounterEvent[]
}

// ---------------------------------------------------------------------------
// Structured encounter events
//
// The complete discriminated union is defined now even though only
// `encounter-started` and `encounter-finished` are emitted by this task;
// Tasks 8-10 emit the rest from the same shapes. Every variant carries
// `{ id, tick, type }`. `advanceEncounterTick` (a later task) returns
// `{ state, events }` batches; `EncounterState` never stores an event log,
// only `nextEventId`.
// ---------------------------------------------------------------------------

export interface EncounterStartedEvent {
  id: number
  tick: number
  type: 'encounter-started'
  combatantIds: readonly CombatantId[]
  factionIds: readonly FactionId[]
  hostilityMode: HostilityDefinition['mode']
}

export interface MovementIntentChangedEvent {
  id: number
  tick: number
  type: 'movement-intent-changed'
  combatantId: CombatantId
  from: LocomotionIntent
  to: LocomotionIntent
}

export interface ActionStartedEvent {
  id: number
  tick: number
  type: 'action-started'
  actorId: CombatantId
  targetId: CombatantId
  actionInstanceId: ActionInstanceId
  actionId: AttackActionId
  expectedContactTick: number
}

export interface ActionInterruptedEvent {
  id: number
  tick: number
  type: 'action-interrupted'
  actorId: CombatantId
  actionInstanceId: ActionInstanceId
  actionId: CombatActionId
  reason: 'stagger' | 'threat-canceled'
}

export interface DefenseStartedEvent {
  id: number
  tick: number
  type: 'defense-started'
  defenderId: CombatantId
  attackerId: CombatantId
  incomingActionId: ActionInstanceId
  defenseActionId: DefenseActionId
  expectedContactTick: number
}

export interface DefenseDeclinedEvent {
  id: number
  tick: number
  type: 'defense-declined'
  defenderId: CombatantId
  attackerId: CombatantId
  incomingActionId: ActionInstanceId
  defenseActionId: DefenseActionId
  expectedContactTick: number
}

export interface DefenseFailedEvent {
  id: number
  tick: number
  type: 'defense-failed'
  defenderId: CombatantId
  attackerId: CombatantId
  incomingActionId: ActionInstanceId
  defenseActionId: DefenseActionId
  reason: 'geometry' | 'facing'
}

export interface AttackMissedEvent {
  id: number
  tick: number
  type: 'attack-missed'
  actorId: CombatantId
  targetId: CombatantId
  actionInstanceId: ActionInstanceId
  actionId: AttackActionId
  reason: 'target-unavailable' | 'geometry' | 'accuracy'
}

export interface AttackEvadedEvent {
  id: number
  tick: number
  type: 'attack-evaded'
  actorId: CombatantId
  targetId: CombatantId
  actionInstanceId: ActionInstanceId
  actionId: AttackActionId
  evadeIntent: LocomotionIntent
}

export interface AttackBlockedEvent {
  id: number
  tick: number
  type: 'attack-blocked'
  actorId: CombatantId
  targetId: CombatantId
  actionInstanceId: ActionInstanceId
  actionId: AttackActionId
  contactZone: 'shield'
  contactPoint: Vec2
}

export interface AttackParriedEvent {
  id: number
  tick: number
  type: 'attack-parried'
  actorId: CombatantId
  defenderId: CombatantId
  actionInstanceId: ActionInstanceId
  actionId: AttackActionId
  contactZone: 'weapon'
  contactPoint: Vec2
}

export interface CriticalHitEvent {
  id: number
  tick: number
  type: 'critical-hit'
  actorId: CombatantId
  targetId: CombatantId
  actionInstanceId: ActionInstanceId
  actionId: AttackActionId
  multiplier: number
}

export interface DamageDealtEvent {
  id: number
  tick: number
  type: 'damage-dealt'
  actorId: CombatantId
  targetId: CombatantId
  actionInstanceId: ActionInstanceId
  actionId: AttackActionId
  amount: number
  remainingHp: number
  contactZone: ContactZone
  contactPoint: Vec2
}

export interface FighterStaggeredEvent {
  id: number
  tick: number
  type: 'fighter-staggered'
  combatantId: CombatantId
  sourceId: CombatantId
  actionInstanceId: ActionInstanceId
  durationTicks: number
  direction: Vec2
}

export interface FighterDefeatedEvent {
  id: number
  tick: number
  type: 'fighter-defeated'
  defeatedId: CombatantId
  sourceId: CombatantId
}

export interface EncounterFinishedEvent {
  id: number
  tick: number
  type: 'encounter-finished'
  reason: EncounterFinishReason
  durationTicks: number
  survivorIds: readonly CombatantId[]
  winnerIds: readonly CombatantId[]
  winningFactionIds: readonly FactionId[]
}

export type EncounterEvent =
  | EncounterStartedEvent
  | MovementIntentChangedEvent
  | ActionStartedEvent
  | ActionInterruptedEvent
  | DefenseStartedEvent
  | DefenseDeclinedEvent
  | DefenseFailedEvent
  | AttackMissedEvent
  | AttackEvadedEvent
  | AttackBlockedEvent
  | AttackParriedEvent
  | CriticalHitEvent
  | DamageDealtEvent
  | FighterStaggeredEvent
  | FighterDefeatedEvent
  | EncounterFinishedEvent

// ---------------------------------------------------------------------------
// Event ID allocation
//
// Monotonic event IDs are centralized through this tiny tick-local cursor so
// every emission site (this task's two, and every later task's many) shares
// one allocation rule. The cursor itself is thrown away at the end of the
// call; it never becomes part of `EncounterState`.
// ---------------------------------------------------------------------------

interface EventIdCursor {
  nextEventId: number
}

function allocateEventId(cursor: EventIdCursor): number {
  const id = cursor.nextEventId
  cursor.nextEventId += 1
  return id
}

// ---------------------------------------------------------------------------
// Creation
// ---------------------------------------------------------------------------

function requireCombatantCount(count: number): void {
  if (count < 2 || count > 100) {
    throw new Error(`EncounterConfig combatants must contain between 2 and 100 entries, got ${count}`)
  }
}

function resolveStartingHp(definition: EncounterCombatantDefinition, fighter: FighterDefinition): number {
  if (definition.startingHp === undefined) return fighter.maxHp
  const value = definition.startingHp
  if (!Number.isInteger(value) || value < 1 || value > fighter.maxHp) {
    throw new Error(`EncounterConfig combatant '${definition.id}' startingHp must be an integer between 1 and ${fighter.maxHp}`)
  }
  return value
}

function requireUniqueIds(combatants: readonly EncounterCombatantDefinition[]): void {
  const seen = new Set<CombatantId>()
  for (const combatant of combatants) {
    if (seen.has(combatant.id)) {
      throw new Error(`EncounterConfig combatants contains duplicate id '${combatant.id}'`)
    }
    seen.add(combatant.id)
  }
}

function requireValidId(id: string, label: string): void {
  if (!ID_PATTERN.test(id)) {
    throw new Error(`EncounterConfig ${label} '${id}' must match [A-Za-z0-9._-]+`)
  }
}

function requireOrderedPairReferences(arena: Readonly<CombatArenaDefinition>, idSet: ReadonlySet<CombatantId>): void {
  if (!arena.orderedPair) return
  for (const id of arena.orderedPair) {
    if (!idSet.has(id)) {
      throw new Error(`EncounterConfig arena.orderedPair references unknown combatant id '${id}'`)
    }
  }
}

/**
 * Faces toward the ordered opponent when `arena.orderedPair` names this
 * combatant; every other combatant (including both members when no ordered
 * pair is configured) faces the positive x-axis. The result is always
 * normalized and finite: `normalizeVec2` falls back to the positive x-axis
 * itself when the opponent's start position coincides with this one.
 */
function findOrderedOpponentId(id: CombatantId, orderedPair: CombatArenaDefinition['orderedPair']): CombatantId | undefined {
  if (!orderedPair) return undefined
  if (orderedPair[0] === id) return orderedPair[1]
  if (orderedPair[1] === id) return orderedPair[0]
  return undefined
}

function computeStartFacing(id: CombatantId, position: Readonly<Vec2>, arena: Readonly<CombatArenaDefinition>, positionsById: ReadonlyMap<CombatantId, Vec2>): Vec2 {
  const opponentId = findOrderedOpponentId(id, arena.orderedPair)
  const opponentPosition = opponentId ? positionsById.get(opponentId) : undefined
  if (!opponentPosition) return { x: 1, z: 0 }
  return normalizeVec2({ x: opponentPosition.x - position.x, z: opponentPosition.z - position.z })
}

function buildFighterCombatState(definition: EncounterCombatantDefinition, arena: Readonly<CombatArenaDefinition>, positionsById: ReadonlyMap<CombatantId, Vec2>): FighterCombatState {
  const fighter = validateFighterDefinition(definition.fighter)
  const position = definition.startPosition
  return {
    id: definition.id,
    factionId: definition.factionId,
    ...(definition.disposition !== undefined && definition.disposition !== 'standard' ? { disposition: definition.disposition } : {}),
    definition: fighter,
    position,
    facing: computeStartFacing(definition.id, position, arena, positionsById),
    travelledDistance: 0,
    hp: resolveStartingHp(definition, fighter),
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
  }
}

/**
 * Creates a new encounter from `config`, returning the initial
 * `EncounterTransition` whose single event is `encounter-started` (event ID
 * `0`, leaving `nextEventId = 1`). Requires `2..100` combatants, unique IDs
 * matching `[A-Za-z0-9._-]+`, valid faction IDs, any `arena.orderedPair`
 * members to be combatants in this encounter, and at least one hostile pair
 * among the initial (all living) combatants. `combatantIds` is sorted
 * lexicographically; `CombatantId` never derives from object/array iteration
 * order.
 */
export function createEncounter(config: EncounterConfig): EncounterTransition {
  requireCombatantCount(config.combatants.length)
  requireUniqueIds(config.combatants)
  for (const combatant of config.combatants) {
    requireValidId(combatant.id, 'combatants id')
    requireValidId(combatant.factionId, 'combatants factionId')
    if (combatant.disposition !== undefined && !isDispositionId(combatant.disposition)) {
      throw new Error(`EncounterConfig combatant '${combatant.id}' disposition must be one of ${DISPOSITION_IDS.join('|')}`)
    }
  }
  if (config.hostility.mode === 'relation-table') {
    requireNoConflictingRelations(config.hostility.relations)
  }

  const idSet = new Set(config.combatants.map((combatant) => combatant.id))
  requireOrderedPairReferences(config.arena, idSet)

  const positionsById = new Map(config.combatants.map((combatant) => [combatant.id, combatant.startPosition] as const))
  const byId = new Map(config.combatants.map((combatant) => [combatant.id, combatant] as const))
  const combatantIds = [...idSet].sort()

  const combatants: Record<CombatantId, FighterCombatState> = {}
  const randomByCombatant: Record<CombatantId, CombatantRandomState> = {}
  for (const id of combatantIds) {
    const definition = byId.get(id)
    if (!definition) throw new Error(`EncounterConfig combatants is missing definition for id '${id}'`)
    combatants[id] = buildFighterCombatState(definition, config.arena, positionsById)
    randomByCombatant[id] = createCombatantRandomState(config.seed, id)
  }

  if (!hasAnyHostilePair({ hostility: config.hostility, combatants }, combatantIds)) {
    throw new Error('EncounterConfig hostility must produce at least one hostile pair among the given combatants')
  }

  const factionIds = [...new Set(combatantIds.map((id) => combatants[id].factionId))].sort()

  const cursor: EventIdCursor = { nextEventId: 0 }
  const startedEvent: EncounterStartedEvent = {
    id: allocateEventId(cursor),
    tick: 0,
    type: 'encounter-started',
    combatantIds,
    factionIds,
    hostilityMode: config.hostility.mode,
  }

  const state: EncounterState = {
    tick: 0,
    phase: 'running',
    seed: config.seed,
    combatantIds,
    combatants,
    arena: config.arena,
    hostility: config.hostility,
    combatStyles: config.combatStyles,
    randomByCombatant,
    nextEventId: cursor.nextEventId,
  }

  assertEncounterInvariants(state)

  return { state, events: [startedEvent] }
}

// ---------------------------------------------------------------------------
// Completion
// ---------------------------------------------------------------------------

/**
 * Applies `result` to `state`, returning the finished state plus exactly one
 * `encounter-finished` event drawn from `state.nextEventId`. Deliberately
 * generic: it never inspects `result.reason` beyond copying it through, so a
 * duel adapter's `time-limit` policy (Task 11) is expressed by constructing
 * a different `EncounterResult` and calling this same function, not by
 * special-casing a reason here. For `no-hostile-pairs`, callers are expected
 * to set `winnerIds` to every living survivor and `winningFactionIds` to the
 * sorted unique set of those survivors' factions before calling this.
 */
export function finishEncounter(state: EncounterState, result: EncounterResult): EncounterTransition {
  const cursor: EventIdCursor = { nextEventId: state.nextEventId }
  const finishedEvent: EncounterFinishedEvent = {
    id: allocateEventId(cursor),
    tick: state.tick,
    type: 'encounter-finished',
    reason: result.reason,
    durationTicks: state.tick,
    survivorIds: result.survivorIds,
    winnerIds: result.winnerIds,
    winningFactionIds: result.winningFactionIds,
  }

  const nextState: EncounterState = {
    ...state,
    phase: 'finished',
    result,
    nextEventId: cursor.nextEventId,
  }

  return { state: nextState, events: [finishedEvent] }
}

// ---------------------------------------------------------------------------
// Tick loop
//
// `advanceEncounterTick` wires the complete tick-order phases 1-12 (design.md's
// "Encounter tick order"): phase transitions (including the stagger phase
// matrix's deferred `contact` clear), cleanup, targeting, weighted
// decisions, action starts, batched defense reactions, simultaneous
// movement, contact resolution, accumulated pushback, local anti-stall
// clock persistence, and no-hostile-pairs completion. The duel time-limit
// policy is a later task's, layered on top of this generic kernel.
//
// Each phase below is one named helper, in tick order, so the loop itself
// reads as a table of contents. Every helper receives only the state slices
// it needs and returns the updated slice(s) plus any events it emits; the
// outer `advanceEncounterTick` threads these through and never mutates
// `previous` or anything reachable from it.
// ---------------------------------------------------------------------------

/** One action about to start, whether from an ordinary phase-4 decision or a forced behavior (Technical's parry-counter) that bypasses it -- shared so phase 5 (`startSelectedActions`) treats both sources identically. */
interface PendingActionStart {
  actorId: CombatantId
  targetId: CombatantId
  actionId: AttackActionId
}

/** Resolves an active action's `impactTicks`/`recoveryTicks`, whether it is an attack or a defense. */
function resolveActionPhaseDefinition(
  combatStyles: CombatStyleCatalog,
  definitionId: CombatActionId,
): Readonly<{ impactTicks: number; recoveryTicks: number }> {
  return combatStyles.attacks[definitionId as AttackActionId] ?? combatStyles.defenses[definitionId as DefenseActionId]
}

/**
 * `status` has no `'staggered'` variant -- a staggered combatant can sit at
 * `action.type === 'neutral'` -- so `staggerUntilTick <= tick` must be
 * checked explicitly here. Without it, both phase 3 reacquisition and phase
 * 4 decisions would treat a staggered combatant as ready once Tasks 9-10
 * start setting `staggerUntilTick > 0`, consuming a decision-stream draw on
 * a tick the design says has none and desynchronizing the stream.
 */
function isDecisionReady(combatant: Readonly<FighterCombatState>, tick: number): boolean {
  return combatant.status === 'active' && combatant.action.type === 'neutral' && combatant.staggerUntilTick <= tick && tick >= combatant.nextDecisionTick
}

/**
 * Same four-condition order as `isDecisionReady`, but names which one
 * actually blocked the combatant instead of collapsing all of them into one
 * label. Only meaningful to call once `isDecisionReady` has already
 * returned `false` (or the combatant is otherwise known to be targetless);
 * a ready, targeted combatant never reaches this function.
 */
function decisionSkipReason(combatant: Readonly<FighterCombatState>, tick: number): Extract<DecisionRecord, { kind: 'skipped' }>['reason'] {
  if (combatant.status !== 'active') return 'inactive'
  if (combatant.action.type !== 'neutral') return 'mid-action'
  if (combatant.staggerUntilTick > tick) return 'staggered'
  if (tick < combatant.nextDecisionTick) return 'not-due'
  return 'no-target'
}

// --- Phase 1: increment tick and transition expired phases -----------------

/**
 * Advances every active action whose `phaseEndsAtTick` equals the new `tick`
 * to its next phase (`windup -> contact -> impact -> recovery -> neutral`).
 * This is a plain phase-machine advance: it says nothing about what a
 * contact tick resolves to (Task 9), only that contact always lasts exactly
 * one tick and the machine keeps moving on schedule regardless -- with one
 * exception, completing the stagger phase-matrix's `contact` row
 * (Task 10, `applyStaggerToAction` in `combatActions.ts`): when a fighter's
 * `contact` phase is about to advance to `impact` but `staggerUntilTick >
 * tick`, stagger owns control instead. This can only be true here because
 * that same fighter was staggered by a *different* intent during the very
 * tick their own `contact` phase resolved (`applyStaggerAndInterrupt` below
 * exempts `contact` from immediate interruption -- see its own doc comment);
 * any other stagger source would already have cancelled a `windup`/`impact`/
 * `recovery` action outright, long before it could ever reach this point
 * still `active`. The action is forced silently to `neutral` -- no
 * `action-interrupted`, since the contact itself already completed on
 * schedule against the frozen snapshot; only the *following* impact/recovery
 * is what stagger pre-empts.
 */
function transitionExpiredPhases(
  combatants: Readonly<Record<CombatantId, FighterCombatState>>,
  combatantIds: readonly CombatantId[],
  tick: number,
  combatStyles: CombatStyleCatalog,
): Record<CombatantId, FighterCombatState> {
  const next: Record<CombatantId, FighterCombatState> = { ...combatants }
  for (const id of combatantIds) {
    const combatant = next[id]
    if (combatant.action.type !== 'active' || combatant.action.phaseEndsAtTick !== tick) continue
    if (combatant.action.phase === 'contact' && combatant.staggerUntilTick > tick) {
      next[id] = { ...combatant, action: { type: 'neutral' } }
      continue
    }
    const needsDefinition = combatant.action.phase === 'contact' || combatant.action.phase === 'impact'
    const definition = needsDefinition ? resolveActionPhaseDefinition(combatStyles, combatant.action.definitionId) : undefined
    next[id] = { ...combatant, action: transitionActionPhase(combatant.action, tick, definition) }
  }
  return next
}

// --- Phase 2: cleanup -------------------------------------------------------
//
// Design's phase 2 bundles four concerns:
// - "Clear expired stagger" needs no code: `staggerUntilTick` is a plain
//   comparison against `tick` (see `isDecisionReady`), nothing to reset, even
//   now that contact resolution (phase 9, this task) produces non-zero
//   values.
// - `pruneReactionLedgerAndCancelThreats` prunes `reactionLedger` entries
//   once their referenced attack has resolved (passed contact) or vanished,
//   and interrupts a still-windup-phase bound defense whose threat vanished
//   before its own contact ("threat-canceled").
// - `completeForcedStateTransitions` implements Fast's forced disengage
//   (below): its trigger -- a `fast-burst-lunge` recovery ending -- is a
//   pure phase-clock event phase 1 already observes, needing nothing from
//   contact resolution.
// - Technical's forced parry-counter *start check* is `resolveForcedActionStarts`,
//   below, called right before phase 4 (after phase 3's target refresh, not
//   from this function): its trigger -- a successful parry setting
//   `forcedActionId` -- is a contact-resolution outcome (phase 9, this
//   task's own new code), but the *start* itself only makes sense once the
//   defender's own action returns to `neutral`, which needs the freshly
//   refreshed target phase 3 just computed.

/**
 * Prunes a `reactionLedger` entry once the referenced attacker action either
 * resolved (passed its one-tick `contact` phase) or vanished outright
 * (attacker gone/defeated, or replaced by a different action instance). A
 * defender's own bound defense (`reactingToActionId` matches) is only
 * force-cancelled -- reset to `neutral` plus `action-interrupted
 * threat-canceled` -- when it is still in its own `windup`, i.e. its threat
 * genuinely vanished *before* contact rather than merely finishing its
 * lifecycle after contact already happened on schedule.
 */
function pruneReactionLedgerAndCancelThreats(
  combatants: Readonly<Record<CombatantId, FighterCombatState>>,
  combatantIds: readonly CombatantId[],
  tick: number,
  cursor: EventIdCursor,
): { combatants: Record<CombatantId, FighterCombatState>; events: EncounterEvent[] } {
  const next: Record<CombatantId, FighterCombatState> = { ...combatants }
  const events: EncounterEvent[] = []

  for (const defenderId of combatantIds) {
    const defender = next[defenderId]
    if (defender.reactionLedger.length === 0) continue

    let updatedDefender = defender
    const keptRecords: ReactionRecord[] = []

    for (const record of defender.reactionLedger) {
      const attackerId = record.incomingActionId.slice(0, record.incomingActionId.indexOf(':'))
      const attacker = next[attackerId]
      const attackerAction = attacker?.action
      const stillPending =
        !!attacker &&
        attacker.status === 'active' &&
        attackerAction?.type === 'active' &&
        attackerAction.instanceId === record.incomingActionId &&
        (attackerAction.phase === 'windup' || attackerAction.phase === 'contact')

      if (stillPending) {
        keptRecords.push(record)
        continue
      }

      const boundAction = updatedDefender.action.type === 'active' && updatedDefender.action.reactingToActionId === record.incomingActionId ? updatedDefender.action : undefined
      if (boundAction && boundAction.phase === 'windup') {
        updatedDefender = { ...updatedDefender, action: { type: 'neutral' } }
        events.push({
          id: allocateEventId(cursor),
          tick,
          type: 'action-interrupted',
          actorId: defenderId,
          actionInstanceId: boundAction.instanceId,
          actionId: boundAction.definitionId,
          reason: 'threat-canceled',
        })
      }
      // Otherwise the referenced attack already resolved on schedule (its
      // contact already happened, whether or not the bound defense answered
      // it -- Task 9's job) or there was nothing bound to cancel. Either way
      // the entry is simply dropped, never re-tested on a later tick.
    }

    if (keptRecords.length !== defender.reactionLedger.length || updatedDefender !== defender) {
      next[defenderId] = { ...updatedDefender, reactionLedger: keptRecords }
    }
  }

  return { combatants: next, events }
}

/** Sets `locomotionIntent` and emits `movement-intent-changed` only when the value actually differs from `combatant`'s current one, matching the same "changed enum value only" rule phase 4 uses. */
function forceLocomotionIntent(
  combatant: Readonly<FighterCombatState>,
  intent: LocomotionIntent,
  tick: number,
  cursor: EventIdCursor,
  events: EncounterEvent[],
): FighterCombatState {
  if (combatant.locomotionIntent === intent) return combatant
  events.push({
    id: allocateEventId(cursor),
    tick,
    type: 'movement-intent-changed',
    combatantId: combatant.id,
    from: combatant.locomotionIntent,
    to: intent,
  })
  return { ...combatant, locomotionIntent: intent }
}

/**
 * Wires Fast's forced disengage (design.md's locomotion section): the
 * instant a `fast-burst-lunge` action's `recovery` phase ends (detected off
 * `previousCombatants`, the tick's pre-phase-1 snapshot, exactly like
 * `transitionExpiredPhases` detects any other phase boundary), the fighter
 * is forced into `disengage` and stamped with `forcedDisengageStartTick`.
 * Every following tick while that field is set, `hasFastForcedDisengageEnded`
 * (Task 7's existing threshold helper, not reimplemented here) is checked
 * against the live distance to target and ticks elapsed; once true the field
 * clears and `nextDecisionTick` is pulled to the current tick so ordinary
 * weighted selection resumes immediately, matching "forced into `disengage`
 * after a burst-lunge recovery until reaching 2.4 units or spending 30
 * ticks" -- i.e. until the fighter has backed the range *out* to 2.4 (or the
 * timeout fires). While forced, phase 4 (`makeCombatDecisions`)
 * skips this combatant entirely -- forced behavior bypasses weighted
 * selection and consumes no decision-stream draw.
 */
function completeForcedStateTransitions(
  previousCombatants: Readonly<Record<CombatantId, FighterCombatState>>,
  combatants: Readonly<Record<CombatantId, FighterCombatState>>,
  combatantIds: readonly CombatantId[],
  tick: number,
  cursor: EventIdCursor,
  disengageCollector?: DisengageCollector,
): { combatants: Record<CombatantId, FighterCombatState>; events: EncounterEvent[] } {
  const next: Record<CombatantId, FighterCombatState> = { ...combatants }
  const events: EncounterEvent[] = []

  for (const id of combatantIds) {
    const previousCombatant = previousCombatants[id]
    const combatant = next[id]
    if (combatant.status !== 'active' || combatant.definition.archetype !== 'fast') continue

    const justEndedBurstLunge =
      previousCombatant.action.type === 'active' &&
      previousCombatant.action.definitionId === 'fast-burst-lunge' &&
      previousCombatant.action.phase === 'recovery' &&
      previousCombatant.action.phaseEndsAtTick === tick

    if (justEndedBurstLunge) {
      const forced = forceLocomotionIntent(combatant, 'disengage', tick, cursor, events)
      next[id] = { ...forced, forcedDisengageStartTick: tick }
      recordDisengage(disengageCollector, { kind: 'stamped', tick, actorId: id, ...phaseTwoSeparation(combatant, combatants) })
      continue
    }

    if (combatant.forcedDisengageStartTick === undefined) continue

    const { targetId, separation } = phaseTwoSeparation(combatant, combatants)
    const ticksSinceForced = tick - combatant.forcedDisengageStartTick

    // The reason is taken from the branch that fired, and the SAME number the
    // predicate judged is what gets recorded. Nothing downstream re-derives
    // either one; see `disengageDiagnostics.ts` for the inference this
    // replaces.
    const exit = hasFastForcedDisengageEnded(separation, ticksSinceForced)
    if (exit) {
      next[id] = { ...combatant, forcedDisengageStartTick: undefined, nextDecisionTick: tick }
      recordDisengage(disengageCollector, { kind: 'cleared', tick, actorId: id, targetId, separation, reason: exit })
    } else {
      next[id] = forceLocomotionIntent(combatant, 'disengage', tick, cursor, events)
      recordDisengage(disengageCollector, { kind: 'held', tick, actorId: id, targetId, separation })
    }
  }

  return { combatants: next, events }
}

/**
 * Who the fighter was measured against in phase 2, and how far away they were,
 * before this tick's movement.
 *
 * `Infinity` with no target, which is the value the exit predicate has always
 * been handed in that case and is preserved here exactly -- extracted from the
 * clear branch rather than rewritten, so both ends of an episode are measured
 * by one expression and cannot drift apart. The id is resolved from the
 * snapshot rather than copied off `self.targetId`, so a target that is not in
 * the snapshot reports `undefined` rather than an id whose separation is
 * `Infinity`.
 */
function phaseTwoSeparation(
  self: FighterCombatState,
  snapshot: Readonly<Record<CombatantId, FighterCombatState>>,
): { targetId: CombatantId | undefined; separation: number } {
  const target = self.targetId ? snapshot[self.targetId] : undefined
  return { targetId: target?.id, separation: target ? distanceBetween(self.position, target.position) : Infinity }
}

/**
 * Write-only, and inert unless a collector was passed -- the shipped runtime
 * and every test that does not ask for diagnostics never reach the body.
 *
 * IT VALIDATES NOTHING, DELIBERATELY. An earlier version raised here on a
 * non-finite separation, copying `recordContact`'s posture on `NaN`, and
 * external review found that this makes the seam non-inert in exactly the case
 * it claims to be inert in: `targetId` is legitimately cleared when a target
 * dies, turns non-hostile, or cannot be reacquired (`retainTarget`,
 * combatDecision.ts), and in a generic multi-combatant encounter the encounter
 * keeps running afterwards. Phase 2 then hands the predicate `Infinity`, which
 * clears the forced state as a range exit -- a transition that completed
 * without a collector and *threw* with one attached. The justification given
 * for the raise ("the arena is under 9 units across") was true of the duel
 * adapter and not of `advanceEncounterTick`, which is the generic kernel.
 *
 * So the kernel records what phase 2 saw and nothing else. Rejecting an
 * unmeasurable episode is `assembleDisengageEpisodes`' job, after the tick,
 * where raising cannot perturb a single thing the seam is supposed to observe.
 */
function recordDisengage(collector: DisengageCollector | undefined, sample: DisengageSample): void {
  collector?.record(sample)
}

/**
 * Technical's forced parry-counter (design.md's "Technical parry" section;
 * carried forward from Task 8 into this task): a successful parry
 * (contact-resolution phase 9, this task) stamps the defender's
 * `forcedActionId = 'technical-parry-counter'`, and this function checks
 * that flag on the very next tick -- *not* once the defender's own action
 * naturally returns to `neutral`. `forcedActionId` is a one-shot flag,
 * always cleared the first time it is inspected here, so a defender whose
 * parry resolved on tick `T` is checked once, on tick `T + 1`, regardless of
 * whether their `technical-parry` action (still progressing through its own
 * ordinary 1-tick contact -> 4-tick impact -> 16-tick recovery, untouched by
 * the parry branch of `resolveOneIntent`) happens to be `impact` at that
 * point. `resolveForcedParryCounterStart` (Task 7's existing helper) decides
 * whether the target is still within `2.3` units:
 * - if it fires, `pendingActionStarts` carries it to phase 5
 *   (`startSelectedActions`), which unconditionally overwrites `action` with
 *   the counter's fresh `windup` -- pre-empting whatever phase the parry's
 *   own action was still in, so counter contact lands on `(T + 1) + 8`,
 *   comfortably inside the attacker's 24-tick stagger window (Task 9 review
 *   finding 4's ruling: waiting out the parry's own impact/recovery first
 *   would land counter contact *after* the stagger expires, making the
 *   24-tick value incoherent -- the literal "next tick" reading is the only
 *   one under which the numbers work);
 * - if it doesn't, only `forcedActionId` is cleared -- `action` is left
 *   completely alone, so "the parry plays out its impact and recovery
 *   normally" (design.md) actually happens: the 4/16-tick values this task
 *   does not touch. `nextDecisionTick` is still pulled to `tick` in this
 *   branch so ordinary weighted selection resumes the instant the parry's
 *   own recovery *does* end naturally (`isDecisionReady` additionally
 *   requires `action.type === 'neutral'`, so this has no effect while the
 *   parry is still mid-impact/recovery).
 *
 * Bypasses phase 4's weighted selection entirely for this tick when it fires
 * -- see `forcedActionActorIds` there.
 */
function resolveForcedActionStarts(
  combatants: Readonly<Record<CombatantId, FighterCombatState>>,
  combatantIds: readonly CombatantId[],
  tick: number,
): { combatants: Record<CombatantId, FighterCombatState>; pendingActionStarts: PendingActionStart[] } {
  const next: Record<CombatantId, FighterCombatState> = { ...combatants }
  const pendingActionStarts: PendingActionStart[] = []

  for (const id of combatantIds) {
    const combatant = next[id]
    if (combatant.status !== 'active' || combatant.forcedActionId === undefined) continue

    const targetId = combatant.targetId
    const target = targetId ? combatants[targetId] : undefined
    const distanceToTarget = target ? distanceBetween(combatant.position, target.position) : Infinity
    const resolvedActionId = resolveForcedParryCounterStart(distanceToTarget)

    if (resolvedActionId !== undefined && targetId !== undefined) {
      pendingActionStarts.push({ actorId: id, targetId, actionId: resolvedActionId })
      next[id] = { ...combatant, forcedActionId: undefined }
    } else {
      // Cleared: "Technical selects advance/hold-range normally" -- pull
      // `nextDecisionTick` to the current tick so ordinary weighted
      // selection resumes immediately once the parry's own action (left
      // untouched here) naturally reaches `neutral`, matching Fast's own
      // forced-disengage exit convention (`completeForcedStateTransitions`
      // above).
      next[id] = { ...combatant, forcedActionId: undefined, nextDecisionTick: tick }
    }
  }

  return { combatants: next, pendingActionStarts }
}

// --- Phase 3: pre-movement spatial hash; target invalidation/reacquisition -

/** Builds the tick's transient spatial hash from sorted *active* combatants only (design.md: defeated combatants leave targeting/collision the tick after defeat). */
function buildActivePreMovementHash(combatants: Readonly<Record<CombatantId, FighterCombatState>>, combatantIds: readonly CombatantId[]): SpatialHash {
  const entries = combatantIds.filter((id) => combatants[id].status === 'active').map((id) => ({ id, position: combatants[id].position }))
  return buildSpatialHash(entries)
}

/**
 * Invalidates every combatant's `targetId` via `retainTarget` (dead,
 * non-hostile, or out-of-retention-radius targets are cleared), then
 * reacquires only for combatants that are both now targetless *and*
 * decision-ready (`isDecisionReady`) -- not for every targetless combatant
 * every tick.
 */
function refreshTargets(
  combatants: Readonly<Record<CombatantId, FighterCombatState>>,
  combatantIds: readonly CombatantId[],
  hostility: HostilityDefinition,
  spatialHash: SpatialHash,
  tick: number,
): Record<CombatantId, FighterCombatState> {
  let next: Record<CombatantId, FighterCombatState> = { ...combatants }

  for (const id of combatantIds) {
    const self = next[id]
    if (self.status !== 'active') continue
    const retained = retainTarget({ self, combatants: next, hostility })
    if (retained !== self.targetId) {
      next = { ...next, [id]: { ...self, targetId: retained } }
    }
  }

  for (const id of combatantIds) {
    const self = next[id]
    if (self.targetId !== undefined || !isDecisionReady(self, tick)) continue
    const acquired = acquireNearestHostile({ spatialIndex: spatialHash, combatants: next, hostility }, id, TARGET_ACQUISITION_RADIUS)
    if (acquired !== undefined) {
      next = { ...next, [id]: { ...self, targetId: acquired } }
    }
  }

  return next
}

// --- Phase 4: weighted decisions --------------------------------------------

/**
 * Draws exactly one decision-stream pair per decision-ready combatant with a
 * valid hostile target, choosing between ordinary weighted locomotion (which
 * updates `locomotionIntent`, emitting `movement-intent-changed` only when
 * the enum value actually changes) and an action start (deferred to phase 5
 * as a `PendingActionStart` so action-instance allocation and the contact
 * rolls stay one single phase-5 concern). `nextDecisionTick` always advances
 * regardless of which kind of decision was made.
 */
function makeCombatDecisions(
  combatants: Readonly<Record<CombatantId, FighterCombatState>>,
  combatantIds: readonly CombatantId[],
  randomByCombatant: Readonly<Record<CombatantId, CombatantRandomState>>,
  tick: number,
  arena: Readonly<CombatArenaDefinition>,
  hostility: HostilityDefinition,
  combatStyles: CombatStyleCatalog,
  spatialHash: SpatialHash,
  cursor: EventIdCursor,
  forcedActionActorIds: ReadonlySet<CombatantId>,
  collector: DecisionCollector | undefined,
): {
  combatants: Record<CombatantId, FighterCombatState>
  randomByCombatant: Record<CombatantId, CombatantRandomState>
  events: EncounterEvent[]
  pendingActionStarts: readonly PendingActionStart[]
} {
  let nextCombatants: Record<CombatantId, FighterCombatState> = { ...combatants }
  let nextRandom: Record<CombatantId, CombatantRandomState> = { ...randomByCombatant }
  const events: EncounterEvent[] = []
  const pendingActionStarts: PendingActionStart[] = []

  for (const id of combatantIds) {
    const self = nextCombatants[id]
    // Forced behavior (Fast's disengage wired in phase 2; Technical's
    // parry-counter start resolved just above this phase) bypasses weighted
    // selection entirely: no decision-stream draw, no candidate scoring.
    if (self.forcedDisengageStartTick !== undefined || forcedActionActorIds.has(id)) {
      collector?.record({
        kind: 'forced',
        tick,
        combatantId: id,
        behaviour: self.forcedDisengageStartTick !== undefined ? 'disengage' : 'parry-counter',
      })
      continue
    }
    if (!isDecisionReady(self, tick) || self.targetId === undefined) {
      collector?.record({ kind: 'skipped', tick, combatantId: id, reason: decisionSkipReason(self, tick) })
      continue
    }

    const nearbyIds = queryRadius(spatialHash, self.position, TARGET_RETENTION_RADIUS)
    const context = buildCombatDecisionContext({
      tick,
      selfId: id,
      targetId: self.targetId,
      combatants: nextCombatants,
      hostility,
      arena,
      nearbyIds,
      combatStyles,
    })
    const style = combatStyles.styles[self.definition.archetype]
    const modifiers = dispositionModifiers(self.disposition ?? 'standard')

    const combatantRandom = nextRandom[id]
    const [rolls, afterDecision] = drawPair(combatantRandom.decision)
    // `scoreCombatCandidates` is pure and duplicates work `chooseCombatDecision`
    // already does internally -- worth paying only when a collector actually
    // wants the breakdown, so it stays out of the hot (uncollected) path.
    const scored = collector === undefined ? undefined : scoreCombatCandidates(context, style, modifiers)
    const decision = chooseCombatDecision(context, style, { selection: rolls.first, interval: rolls.second }, modifiers)
    if (collector !== undefined && scored !== undefined) {
      // `{ ...decision }` copies rather than aliases: `decision` is read
      // again just below to drive this tick's actual locomotion/action
      // branch, and the collector must not be able to change that by
      // mutating the record it was handed.
      collector.record(
        scored.length === 0
          ? { kind: 'fallback', tick, combatantId: id, chosen: { ...decision } }
          : { kind: 'weighted', tick, combatantId: id, candidates: scored, roll: rolls.first, chosen: { ...decision } },
      )
    }
    const nextDecisionTick = tick + decisionIntervalTicks(self.definition.archetype, rolls.second)
    nextRandom = { ...nextRandom, [id]: { ...combatantRandom, decision: afterDecision } }

    if (decision.type === 'locomotion') {
      const changed = decision.locomotionIntent !== self.locomotionIntent
      nextCombatants = { ...nextCombatants, [id]: { ...self, locomotionIntent: decision.locomotionIntent, nextDecisionTick } }
      if (changed) {
        events.push({
          id: allocateEventId(cursor),
          tick,
          type: 'movement-intent-changed',
          combatantId: id,
          from: self.locomotionIntent,
          to: decision.locomotionIntent,
        })
      }
    } else {
      nextCombatants = { ...nextCombatants, [id]: { ...self, nextDecisionTick } }
      pendingActionStarts.push({ actorId: id, targetId: self.targetId, actionId: decision.actionId })
    }
  }

  return { combatants: nextCombatants, randomByCombatant: nextRandom, events, pendingActionStarts }
}

// --- Phase 5: start selected actions ----------------------------------------

/**
 * Starts every phase-4-selected action: allocates the actor-local
 * `${actorId}:${nextActionSerial}` instance ID, draws and stores exactly two
 * contact-stream values (`accuracy`, `critical`) unconditionally -- even
 * though the attack may later miss, be blocked, evaded, or parried -- and
 * emits `action-started`. `pendingActionStarts` is already in sorted-actor
 * order (built by phase 4's `combatantIds` loop).
 */
function startSelectedActions(
  combatants: Readonly<Record<CombatantId, FighterCombatState>>,
  randomByCombatant: Readonly<Record<CombatantId, CombatantRandomState>>,
  pendingActionStarts: readonly PendingActionStart[],
  tick: number,
  combatStyles: CombatStyleCatalog,
  cursor: EventIdCursor,
): { combatants: Record<CombatantId, FighterCombatState>; randomByCombatant: Record<CombatantId, CombatantRandomState>; events: EncounterEvent[] } {
  let nextCombatants: Record<CombatantId, FighterCombatState> = { ...combatants }
  let nextRandom: Record<CombatantId, CombatantRandomState> = { ...randomByCombatant }
  const events: EncounterEvent[] = []

  for (const pending of pendingActionStarts) {
    const actor = nextCombatants[pending.actorId]
    const definition = combatStyles.attacks[pending.actionId]
    const combatantRandom = nextRandom[pending.actorId]
    const [rolls, afterContact] = drawPair(combatantRandom.contact)
    const serial = actor.nextActionSerial

    const action = startAttackAction({
      actorId: pending.actorId,
      serial,
      targetId: pending.targetId,
      definition,
      tick,
      attackRolls: { accuracy: rolls.first, critical: rolls.second },
    })

    nextRandom = { ...nextRandom, [pending.actorId]: { ...combatantRandom, contact: afterContact } }
    nextCombatants = { ...nextCombatants, [pending.actorId]: { ...actor, action, nextActionSerial: serial + 1 } }

    events.push({
      id: allocateEventId(cursor),
      tick,
      type: 'action-started',
      actorId: pending.actorId,
      targetId: pending.targetId,
      actionInstanceId: `${pending.actorId}:${serial}`,
      actionId: pending.actionId,
      expectedContactTick: actionContactTick(action),
    })
  }

  return { combatants: nextCombatants, randomByCombatant: nextRandom, events }
}

// --- Phase 6: batched defense reactions -------------------------------------

/** Groups every currently-windup attack action by its defender (target), keyed off `attackRolls` to tell attacks apart from defenses (which never carry `attackRolls`). */
function collectPendingWindupThreats(
  combatants: Readonly<Record<CombatantId, FighterCombatState>>,
  combatantIds: readonly CombatantId[],
): Map<CombatantId, IncomingThreat[]> {
  const byDefender = new Map<CombatantId, IncomingThreat[]>()
  for (const attackerId of combatantIds) {
    const attacker = combatants[attackerId]
    if (attacker.status !== 'active' || attacker.action.type !== 'active' || attacker.action.phase !== 'windup' || !attacker.action.attackRolls) continue

    const defenderId = attacker.action.targetId
    const defender = combatants[defenderId]
    if (!defender || defender.status !== 'active') continue

    const threat: IncomingThreat = {
      attackerId,
      actionInstanceId: attacker.action.instanceId,
      actionId: attacker.action.definitionId as AttackActionId,
      contactTick: actionContactTick(attacker.action),
    }
    const list = byDefender.get(defenderId)
    if (list) list.push(threat)
    else byDefender.set(defenderId, [threat])
  }
  return byDefender
}

/**
 * Per Task 7's carried-forward review requirement: `processDefenseBatch`
 * itself never verifies its threats are this tick's exact reaction
 * opportunity, so every candidate threat is filtered through
 * `isDefenseReactionOpportunity` (against the *defender's own* style lead)
 * before it ever reaches the batch. Skipping this would let a defender react
 * to the same incoming windup on more than one tick, desynchronizing the
 * defense RNG stream.
 */
function processDefenseReactions(
  combatants: Readonly<Record<CombatantId, FighterCombatState>>,
  combatantIds: readonly CombatantId[],
  randomByCombatant: Readonly<Record<CombatantId, CombatantRandomState>>,
  tick: number,
  combatStyles: CombatStyleCatalog,
  cursor: EventIdCursor,
): { combatants: Record<CombatantId, FighterCombatState>; randomByCombatant: Record<CombatantId, CombatantRandomState>; events: EncounterEvent[] } {
  const threatsByDefender = collectPendingWindupThreats(combatants, combatantIds)
  let nextCombatants: Record<CombatantId, FighterCombatState> = { ...combatants }
  let nextRandom: Record<CombatantId, CombatantRandomState> = { ...randomByCombatant }
  const events: EncounterEvent[] = []

  for (const defenderId of combatantIds) {
    const allThreats = threatsByDefender.get(defenderId)
    if (!allThreats || allThreats.length === 0) continue

    const defender = nextCombatants[defenderId]
    const style = combatStyles.styles[defender.definition.archetype]
    const defenseDefinition = combatStyles.defenses[style.defenseActionId]

    const opportunities = allThreats.filter((threat) => isDefenseReactionOpportunity(defenseDefinition, tick, threat.contactTick))
    if (opportunities.length === 0) continue

    const combatantRandom = nextRandom[defenderId]
    const result = processDefenseBatch({
      tick,
      defender,
      threats: opportunities,
      random: combatantRandom.defense,
      combatants: nextCombatants,
      combatStyles,
    })

    nextCombatants = { ...nextCombatants, [defenderId]: result.defender }
    nextRandom = { ...nextRandom, [defenderId]: { ...combatantRandom, defense: result.random } }
    for (const payload of result.events) {
      events.push({ ...payload, id: allocateEventId(cursor) })
    }
  }

  return { combatants: nextCombatants, randomByCombatant: nextRandom, events }
}

// --- Phase 7: compute simultaneous movement intents -------------------------

interface MovementIntentsResult {
  requests: readonly MovementRequest[]
  updatedFacing: Readonly<Record<CombatantId, Vec2>>
}

/** A combatant without a target retains its last facing; one with a target turns partway toward it using the style's authored turn step (never runtime trigonometry). */
function computeUpdatedFacing(combatant: Readonly<FighterCombatState>, target: Readonly<FighterCombatState> | undefined, turnStep: Readonly<TurnStep>): Vec2 {
  if (!target) return combatant.facing
  const desired = normalizeVec2({ x: target.position.x - combatant.position.x, z: target.position.z - combatant.position.z })
  return turnFacing(combatant.facing, desired, turnStep)
}

/**
 * Movement constraint by action phase (design.md, exact): `windup` allows
 * only the action's authored root travel, evenly distributed across its
 * windup ticks along the (already turned) facing, **capped so the step never
 * closes the live distance to the attack's own target past the nearer of
 * `arena.minimumSeparation` and the action's own `contactRange.min`** ("stops
 * early at minimum separation and never expands the legal contact range" --
 * design.md:392).
 *
 * The `contactRange.min` half of that floor is what makes root travel a
 * MAXIMUM rather than a mandatory step, and it has to be here because the
 * mover and the decision seam must agree about where contact lands. Clamping
 * only at `arena.minimumSeparation` (0.9) let the two actions whose
 * `contactRange.min` exceeds the arena floor walk straight out of their own
 * range during windup and geometry-miss by construction:
 *
 *   - `technical-thrust` (min 1.2, travel 0.20) started anywhere in
 *     [1.2, 1.4) walked to ~1.1 and missed;
 *   - `technical-driving-thrust` (min 1.6, travel 0.50) started anywhere in
 *     [1.6, 2.1) walked below 1.6 and missed.
 *
 * `combatDecision.ts`'s `predictedContactDistance` already predicts
 * `max(contactRange.min, d - rootTravel)`, so before this the scorer believed
 * contact landed in range while the mover put it outside -- a self-inflicted
 * miss the policy could not see. Both sides now compute the same value.
 *
 * The original separation-floor deadlock stays cured: at `d = 0.9` a jab
 * (min 0.9) has floor `max(0.9, 0.9) = 0.9`, so it takes no step and contacts
 * at 0.9, inside its range. The cap is
 * conservative: it treats the full displacement length as reducing distance
 * 1:1 (true when facing points at the target, which it generally does by
 * this point since facing turns toward the target every tick), so it can
 * stop a step slightly earlier than geometrically necessary but never lets
 * one overshoot past the boundary for `resolvePairSeparation`'s symmetric
 * push to paper over -- that push moves the *target* too, which the design
 * does not intend for an attacker's own approach. `contact`/`impact` freeze
 * root motion; `recovery` allows at most 35% of normal style speed along the
 * last ordinary `locomotionIntent`; staggered allows no locomotion (Task 8
 * never produces `staggerUntilTick > tick`, kept for forward compatibility).
 * A defense action's own windup has no authored root travel field for Heavy
 * guard or Technical parry (both hold root); Fast evade is the one
 * exception -- see `fastEvadeWindupDisplacement` below, wired here per
 * Task 9's carried-forward requirement.
 */
function computeDesiredDisplacement(
  combatant: Readonly<FighterCombatState>,
  style: Readonly<CombatStyleDefinition>,
  facing: Readonly<Vec2>,
  tick: number,
  combatStyles: CombatStyleCatalog,
  combatants: Readonly<Record<CombatantId, FighterCombatState>>,
  arena: Readonly<CombatArenaDefinition>,
): Vec2 {
  if (combatant.staggerUntilTick > tick) return { x: 0, z: 0 }

  if (combatant.action.type === 'active') {
    switch (combatant.action.phase) {
      case 'windup': {
        const attackDefinition: AttackActionDefinition | undefined = combatStyles.attacks[combatant.action.definitionId as AttackActionId]
        if (attackDefinition) {
          const perTick = attackDefinition.rootTravel / attackDefinition.windupTicks
          const target = combatants[combatant.action.targetId]
          const approachFloor = Math.max(arena.minimumSeparation, attackDefinition.contactRange.min)
          const step = target ? Math.min(perTick, Math.max(0, distanceBetween(combatant.position, target.position) - approachFloor)) : perTick
          return { x: facing.x * step, z: facing.z * step }
        }
        return fastEvadeWindupDisplacement(combatant.action, facing, combatant.position, arena)
      }
      case 'contact':
      case 'impact':
        return { x: 0, z: 0 }
      case 'recovery': {
        const base = intentDisplacement(combatant.locomotionIntent, style.locomotion, facing, TICKS_PER_SECOND)
        return { x: base.x * 0.35, z: base.z * 0.35 }
      }
    }
  }

  return intentDisplacement(combatant.locomotionIntent, style.locomotion, facing, TICKS_PER_SECOND)
}

/**
 * Fast evade's authored defense dash (design.md's "Fast evade" section;
 * carried forward from Task 8 into this task): a total distance of
 * `0.9 + 0.3 * directionRoll` distributed evenly across the defense's
 * *remaining* windup ticks (`phaseEndsAtTick - phaseStartedTick`, fixed once
 * the defense starts), along the current best-ranked direction from that
 * same stored roll -- read back from `CombatActionState.defenseRoll.direction`,
 * never re-drawn (Task 7 already consumed it from the defense stream).
 * `selectEvadeDirection` (combatActions.ts) re-evaluates the ranked-direction
 * fall-through fresh every tick from the defender's *current* position, so a
 * direction blocked by an arena boundary earlier in the windup is retried
 * (and a direction that becomes blocked, e.g. dashing toward a wall, falls
 * through to the next-ranked one) without needing to persist a choice
 * anywhere. Independent of the style's ordinary locomotion speed profile;
 * the result still flows through this tick's ordinary arena/movement-
 * policy/separation resolution (phase 8) like any other displacement. Heavy
 * guard and Technical parry hold root (return zero); this only ever fires
 * for `fast-evade`. `undefined` from `selectEvadeDirection` (arena boundaries
 * block all three ranked directions from `position`) contributes zero
 * displacement this tick.
 */
function fastEvadeWindupDisplacement(
  action: Extract<CombatActionState, { type: 'active' }>,
  facing: Readonly<Vec2>,
  position: Readonly<Vec2>,
  arena: Readonly<CombatArenaDefinition>,
): Vec2 {
  if (action.definitionId !== 'fast-evade' || !action.defenseRoll) return { x: 0, z: 0 }

  const windupSpan = action.phaseEndsAtTick - action.phaseStartedTick
  if (windupSpan <= 0) return { x: 0, z: 0 }

  const totalDistance = calculateEvadeDisplacementDistance(action.defenseRoll.direction)
  const chosen = selectEvadeDirection(action.defenseRoll.direction, facing, position, totalDistance, arena)
  if (!chosen) return { x: 0, z: 0 }

  const perTick = totalDistance / windupSpan
  const direction = evadeDirectionVector(chosen, facing)
  return { x: direction.x * perTick, z: direction.z * perTick }
}

/** Computes every active combatant's updated facing and desired displacement from the same pre-movement snapshot; nothing here applies arena/policy/separation constraints yet (phase 8). */
function computeMovementIntents(
  combatants: Readonly<Record<CombatantId, FighterCombatState>>,
  combatantIds: readonly CombatantId[],
  combatStyles: CombatStyleCatalog,
  tick: number,
  arena: Readonly<CombatArenaDefinition>,
): MovementIntentsResult {
  const updatedFacing: Record<CombatantId, Vec2> = {}
  for (const id of combatantIds) {
    const combatant = combatants[id]
    if (combatant.status !== 'active') {
      updatedFacing[id] = combatant.facing
      continue
    }
    const style = combatStyles.styles[combatant.definition.archetype]
    const target = combatant.targetId ? combatants[combatant.targetId] : undefined
    updatedFacing[id] = computeUpdatedFacing(combatant, target, { cos: style.locomotion.turnCosPerTick, sin: style.locomotion.turnSinPerTick })
  }

  const requests: MovementRequest[] = []
  for (const id of combatantIds) {
    const combatant = combatants[id]
    if (combatant.status !== 'active') continue
    const style = combatStyles.styles[combatant.definition.archetype]
    const displacement = computeDesiredDisplacement(combatant, style, updatedFacing[id], tick, combatStyles, combatants, arena)
    requests.push({ id, position: combatant.position, desiredDisplacement: displacement })
  }

  return { requests, updatedFacing }
}

// --- Phase 8: arena clamp, movement-policy constraint, spatial separation --

/**
 * Resolves `intents` through `resolveSimultaneousMovement` (arena clamp,
 * `movementPolicy` constraint, three fixed separation passes) and writes the
 * resulting `facing`/`position`. This function is called twice in one tick
 * (phase 8's ordinary locomotion, phase 10's accumulated push) and must NOT
 * touch `velocity`/`travelledDistance` itself -- doing so per call would let
 * a later zero-displacement call (e.g. phase 10 for an unpushed combatant)
 * stomp an earlier call's correct diagnostics back to zero. Those two fields
 * are instead derived once, for the tick as a whole, by
 * `applyTickMotionDiagnostics` after every position-mutating phase has run.
 */
function resolveMovementConstraints(
  combatants: Readonly<Record<CombatantId, FighterCombatState>>,
  combatantIds: readonly CombatantId[],
  intents: MovementIntentsResult,
  arena: Readonly<CombatArenaDefinition>,
): Record<CombatantId, FighterCombatState> {
  const resolution = resolveSimultaneousMovement(intents.requests, arena)
  const next: Record<CombatantId, FighterCombatState> = { ...combatants }

  for (const id of combatantIds) {
    const combatant = combatants[id]
    if (combatant.status !== 'active') continue
    const facing = intents.updatedFacing[id]
    const newPosition = resolution.positions[id]
    next[id] = {
      ...combatant,
      facing,
      position: newPosition,
    }
  }

  return next
}

/**
 * Derives `velocity`/`travelledDistance` exactly once per tick, from the
 * combatant's position at the very start of the tick (`start`, i.e.
 * `previous.combatants`) versus its position after every phase that can move
 * it this tick has already run (phase 8's ordinary locomotion and phase 10's
 * accumulated push, both via `resolveMovementConstraints` above). `velocity
 * = totalDisplacement x TICKS_PER_SECOND` reflects the tick's true net root
 * motion regardless of how many separate movement-resolution calls produced
 * it -- a combatant that only walked, only got pushed, or did both in the
 * same tick all get one correct combined value. `travelledDistance` adds
 * that same total magnitude once, so successive ticks sum real displacement
 * without double-counting a single tick's motion across two calls.
 *
 * Computes for every combatant *active at the start of the tick*
 * (`start[id].status`), not every combatant active at the end: a combatant
 * defeated during phase 9 still moved during phase 8 this same tick and that
 * final motion must be captured once, even though `combatants[id].status` is
 * already `'defeated'` by the time this runs. Since `resolveMovementConstraints`
 * no longer writes these fields itself, this is their only writer -- filtering
 * on end-of-tick status would freeze a freshly-defeated fighter's diagnostics
 * at the previous tick's stale values forever.
 */
function applyTickMotionDiagnostics(
  start: Readonly<Record<CombatantId, FighterCombatState>>,
  combatants: Readonly<Record<CombatantId, FighterCombatState>>,
  combatantIds: readonly CombatantId[],
): Record<CombatantId, FighterCombatState> {
  const next: Record<CombatantId, FighterCombatState> = { ...combatants }

  for (const id of combatantIds) {
    const startCombatant = start[id]
    if (startCombatant.status !== 'active') continue // start-of-tick status, not end-of-tick -- see doc comment above
    const combatant = combatants[id]
    const dx = combatant.position.x - startCombatant.position.x
    const dz = combatant.position.z - startCombatant.position.z
    next[id] = {
      ...combatant,
      velocity: { x: dx * TICKS_PER_SECOND, z: dz * TICKS_PER_SECOND },
      travelledDistance: startCombatant.travelledDistance + Math.sqrt(dx * dx + dz * dz),
    }
  }

  return next
}

// --- Phase 9: resolve contact intents ---------------------------------------
//
// design.md's "Contact resolution" algorithm: snapshot geometry/defenses,
// build one intent per action currently in its one-tick `contact` phase,
// resolve evade/parry/guard against that snapshot, sort by total order, then
// resolve each intent whose actor remains live-active.
// ---------------------------------------------------------------------------

export interface ContactIntent {
  actorId: CombatantId
  targetId: CombatantId
  actionInstanceId: ActionInstanceId
  actionId: AttackActionId
  priority: number
  tieKey: number
}

/**
 * The exact `tieKey` label format -- FROZEN from this task onward. Task 13
 * freezes canonical trace hashes that depend on it; Task 19 reuses one of
 * those literals for a cross-runtime check. Fed through
 * `derivedUnitValue(seed, label)` (random.ts), which derives and draws
 * without consuming any combatant stream, matching "priority and time-limit
 * ties never consume combatant streams."
 */
function contactTieKeyLabel(tick: number, actionInstanceId: ActionInstanceId): string {
  return `contact-tie:${tick}:${actionInstanceId}`
}

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value))
}

function requireAttackRolls(action: CombatActionState): { accuracy: number; critical: number } {
  if (action.type !== 'active' || !action.attackRolls) {
    throw new Error('resolveContactIntents requires an active action with attackRolls')
  }
  return action.attackRolls
}

/** One intent per actor currently in `contact` phase with an attack action (`attackRolls` present tells an attack apart from a defense, matching phase 6's own discriminator). Never retargets: `targetId` is read once from the action's own `targetId`, set at action start and never changed. */
function buildContactIntents(
  snapshot: Readonly<Record<CombatantId, FighterCombatState>>,
  combatantIds: readonly CombatantId[],
  combatStyles: CombatStyleCatalog,
  seed: number,
  tick: number,
): ContactIntent[] {
  const intents: ContactIntent[] = []
  for (const actorId of combatantIds) {
    const actor = snapshot[actorId]
    if (actor.status !== 'active' || actor.action.type !== 'active' || actor.action.phase !== 'contact' || !actor.action.attackRolls) continue
    const actionId = actor.action.definitionId as AttackActionId
    const definition = combatStyles.attacks[actionId]
    intents.push({
      actorId,
      targetId: actor.action.targetId,
      actionInstanceId: actor.action.instanceId,
      actionId,
      priority: definition.contactPriority,
      tieKey: derivedUnitValue(seed, contactTieKeyLabel(tick, actor.action.instanceId)),
    })
  }
  return intents
}

/**
 * Descending priority, then ascending `tieKey`, then ascending
 * `ActionInstanceId` -- a stable total order over explicit keys, never a
 * pairwise random comparator. Exported (Task 9 review: minor test gap) so
 * `encounter.test.ts` can exercise the final `ActionInstanceId` fallback
 * directly with a synthetic colliding `tieKey`, which the continuous
 * `derivedUnitValue` distribution used in real play cannot be coaxed into
 * producing through the public tick API.
 */
export function sortContactIntents(intents: readonly ContactIntent[]): ContactIntent[] {
  return [...intents].sort((a, b) => {
    if (a.priority !== b.priority) return b.priority - a.priority
    if (a.tieKey !== b.tieKey) return a.tieKey - b.tieKey
    return a.actionInstanceId < b.actionInstanceId ? -1 : a.actionInstanceId > b.actionInstanceId ? 1 : 0
  })
}

/**
 * Applies non-lethal stagger to `target`, interrupting its current action
 * first when applicable -- unless `target` was just defeated by this same
 * resolution (`target.status === 'defeated'`), in which case lethal defeat
 * overrides the entire stagger phase-matrix table (design.md): the
 * defeated fighter's current action and any queued forced action are
 * cleared silently, with no `action-interrupted` (defeat is not an
 * "interruption"), while `fighter-staggered` still fires below, matching
 * the canonical critical-defeat event sequence
 * (`critical-hit -> damage-dealt -> fighter-staggered -> fighter-defeated`).
 *
 * For a still-living target, the phase-matrix effect on `action` itself is
 * `applyStaggerToAction` (`combatActions.ts`): `windup`/`impact`/`recovery`
 * are interrupted, resetting to `neutral` and emitting
 * `action-interrupted(reason: 'stagger')`; a one-tick `contact` is exempt
 * this same tick (its own tick-1 phase machine, `transitionExpiredPhases`,
 * defers the actual clearing to the *following* tick). Either way, any
 * queued forced action (`forcedActionId`) is cleared unconditionally --
 * design.md's "neutral / queued forced action" row: stagger owns control
 * over what happens next, regardless of what the fighter's own current
 * action phase happens to be. Shared by both the ordinary/blocked-hit
 * target-stagger case and the parry attacker-stagger case: the attacker's
 * own action is always in `contact` phase during its own resolution, so the
 * `contact` exemption naturally protects it too, with no special-casing
 * needed.
 */
function applyStaggerAndInterrupt(
  target: Readonly<FighterCombatState>,
  tick: number,
  durationTicks: number,
  sourceId: CombatantId,
  actionInstanceId: ActionInstanceId,
  direction: Readonly<Vec2>,
  cursor: EventIdCursor,
): { combatant: FighterCombatState; events: EncounterEvent[] } {
  const events: EncounterEvent[] = []
  let next: FighterCombatState

  if (target.status === 'defeated') {
    next = { ...target, action: { type: 'neutral' }, forcedActionId: undefined }
  } else {
    const effect = applyStaggerToAction(target.action)
    next = { ...target, action: effect.action, forcedActionId: undefined }
    if (effect.interrupted && target.action.type === 'active') {
      events.push({
        id: allocateEventId(cursor),
        tick,
        type: 'action-interrupted',
        actorId: target.id,
        actionInstanceId: target.action.instanceId,
        actionId: target.action.definitionId,
        reason: 'stagger',
      })
    }
  }

  next = { ...next, staggerUntilTick: Math.max(next.staggerUntilTick, tick + durationTicks) }

  events.push({
    id: allocateEventId(cursor),
    tick,
    type: 'fighter-staggered',
    combatantId: next.id,
    sourceId,
    actionInstanceId,
    durationTicks,
    direction: { ...direction },
  })

  return { combatant: next, events }
}

interface ContactIntentResolution {
  combatants: Record<CombatantId, FighterCombatState>
  events: EncounterEvent[]
  pushVector?: Vec2
}

/**
 * The `evadeIntent` label for a successful `attack-evaded` event: the same
 * ranked-direction fall-through `fastEvadeWindupDisplacement` used to
 * actually move the defender (`selectEvadeDirection`, combatActions.ts),
 * re-evaluated once more from the defender's resolved contact-snapshot
 * position/facing rather than read from an unrelated field (Task 9 review
 * finding 2: this previously read `locomotionIntent`, which nothing ever set
 * to the evade's actual dashed direction). Falls back to the roll's primary
 * ranked direction -- for labeling only, never for the success/fail
 * determination, which is decided purely by `geometryOk` above -- in the
 * edge case where the arena boundary blocks all three directions from the
 * defender's own final resting position.
 *
 * Read it precisely: this is "which ranked direction is open from where the
 * defender ended up", not "which direction the dash took". Those can differ,
 * and the review that raised it (issue #7) is right that they can. The dash
 * re-picks its direction every windup tick from that tick's *starting*
 * position, and by the time an attack resolves the defence is already in its
 * one-tick `contact` phase -- which freezes root motion -- so the snapshot
 * this reads is one dash step past the position the final dash actually
 * chose from. One step is enough to change the answer near a boundary;
 * `combatActions.test.ts` pins a case where it does.
 *
 * It is left reporting the later answer deliberately. There is no single
 * dashed direction to report in the first place (the fall-through may have
 * picked a different one on each windup tick), recovering the final tick's
 * choice would mean persisting it on `CombatActionState`, and that would
 * change `JSON.stringify(combatant.action)` -- re-freezing every canonical
 * trace hash in the suite, plus the cross-runtime literal, to correct a field
 * that no production code reads: `evadeIntent` has no consumer outside this
 * event's own type. If a renderer ever does animate from it, the honest fix
 * is not this re-evaluation but the defender's actual travel over the
 * defence's windup, and it should be paid for with that re-freeze.
 */
function resolveEvadeIntentLabel(
  boundDefense: Extract<CombatActionState, { type: 'active' }>,
  targetPosition: Readonly<Vec2>,
  targetFacing: Readonly<Vec2>,
  arena: Readonly<CombatArenaDefinition>,
): LocomotionIntent {
  const directionRoll = boundDefense.defenseRoll?.direction ?? 0
  const totalDistance = calculateEvadeDisplacementDistance(directionRoll)
  return selectEvadeDirection(directionRoll, targetFacing, targetPosition, totalDistance, arena) ?? rankEvadeDirections(directionRoll)[0]
}

/**
 * Resolves one intent per design.md's numbered algorithm (target-unavailable
 * -> bound evade -> geometry -> accuracy -> bound guard/parry facing gate ->
 * critical -> damage/push/stagger/zone/point -> events in canonical order).
 * `snapshot` supplies every geometry/defense-binding/critical-opening read
 * (position, facing, the bound defense's own state, the target's
 * pre-batch action phase and `staggerUntilTick`); `live` supplies the
 * target's current HP/status, mutated progressively by earlier intents this
 * batch. A bound `technical-parry` is only ever treated as a block when the
 * attack itself is tagged `parryable` -- defense-in-depth for "a shield jab
 * is deliberately unparryable," even though scheduling (`combatDecision.ts`'s
 * `canDefenseAnswerTags`) already prevents a mismatched binding from ever
 * existing.
 */
function resolveOneIntent(
  intent: ContactIntent,
  snapshot: Readonly<Record<CombatantId, FighterCombatState>>,
  live: Readonly<Record<CombatantId, FighterCombatState>>,
  combatStyles: CombatStyleCatalog,
  tick: number,
  cursor: EventIdCursor,
  arena: Readonly<CombatArenaDefinition>,
): ContactIntentResolution {
  const actionDef = combatStyles.attacks[intent.actionId]
  const actorSnapshot = snapshot[intent.actorId]
  const events: EncounterEvent[] = []
  let next: Record<CombatantId, FighterCombatState> = { ...live }

  const targetLive = next[intent.targetId]
  if (!targetLive || targetLive.status !== 'active') {
    events.push({
      id: allocateEventId(cursor),
      tick,
      type: 'attack-missed',
      actorId: intent.actorId,
      targetId: intent.targetId,
      actionInstanceId: intent.actionInstanceId,
      actionId: intent.actionId,
      reason: 'target-unavailable',
    })
    return { combatants: next, events }
  }

  const targetSnapshot = snapshot[intent.targetId]
  const boundDefense = targetSnapshot.action.type === 'active' && targetSnapshot.action.reactingToActionId === intent.actionInstanceId ? targetSnapshot.action : undefined

  const geometryOk = isWithinAttackGeometry(actorSnapshot.position, actorSnapshot.facing, targetSnapshot.position, actionDef.contactRange, actionDef.minimumFacingDot)

  if (boundDefense && boundDefense.definitionId === 'fast-evade') {
    if (!geometryOk) {
      events.push({
        id: allocateEventId(cursor),
        tick,
        type: 'attack-evaded',
        actorId: intent.actorId,
        targetId: intent.targetId,
        actionInstanceId: intent.actionInstanceId,
        actionId: intent.actionId,
        evadeIntent: resolveEvadeIntentLabel(boundDefense, targetSnapshot.position, targetSnapshot.facing, arena),
      })
      return { combatants: next, events }
    }
    events.push({
      id: allocateEventId(cursor),
      tick,
      type: 'defense-failed',
      defenderId: intent.targetId,
      attackerId: intent.actorId,
      incomingActionId: intent.actionInstanceId,
      defenseActionId: 'fast-evade',
      reason: 'geometry',
    })
  }

  if (!geometryOk) {
    events.push({
      id: allocateEventId(cursor),
      tick,
      type: 'attack-missed',
      actorId: intent.actorId,
      targetId: intent.targetId,
      actionInstanceId: intent.actionInstanceId,
      actionId: intent.actionId,
      reason: 'geometry',
    })
    return { combatants: next, events }
  }

  const attackRolls = requireAttackRolls(actorSnapshot.action)
  const accuracyProbability = clamp01(actorSnapshot.definition.accuracy + actionDef.accuracyModifier)
  if (!(attackRolls.accuracy < accuracyProbability)) {
    events.push({
      id: allocateEventId(cursor),
      tick,
      type: 'attack-missed',
      actorId: intent.actorId,
      targetId: intent.targetId,
      actionInstanceId: intent.actionInstanceId,
      actionId: intent.actionId,
      reason: 'accuracy',
    })
    return { combatants: next, events }
  }

  let blocked: 'guard' | 'parry' | undefined
  const boundBlockingDefenseId: 'heavy-guard' | 'technical-parry' | undefined =
    boundDefense?.definitionId === 'heavy-guard'
      ? 'heavy-guard'
      : boundDefense?.definitionId === 'technical-parry' && actionDef.tags.includes('parryable')
        ? 'technical-parry'
        : undefined

  if (boundBlockingDefenseId) {
    const defenseDef = combatStyles.defenses[boundBlockingDefenseId]
    const gateOk = isWithinIncomingFacingArc(targetSnapshot.facing, targetSnapshot.position, actorSnapshot.position, defenseDef.minimumIncomingFacingDot ?? -1)
    if (gateOk) {
      blocked = boundBlockingDefenseId === 'heavy-guard' ? 'guard' : 'parry'
    } else {
      events.push({
        id: allocateEventId(cursor),
        tick,
        type: 'defense-failed',
        defenderId: intent.targetId,
        attackerId: intent.actorId,
        incomingActionId: intent.actionInstanceId,
        defenseActionId: boundBlockingDefenseId,
        reason: 'facing',
      })
    }
  }

  if (blocked === 'parry') {
    const contactPoint = calculateContactPoint(actorSnapshot.position, targetSnapshot.position, actorSnapshot.facing, 'weapon')
    events.push({
      id: allocateEventId(cursor),
      tick,
      type: 'attack-parried',
      actorId: intent.actorId,
      defenderId: intent.targetId,
      actionInstanceId: intent.actionInstanceId,
      actionId: intent.actionId,
      contactZone: 'weapon',
      contactPoint,
    })

    const direction = calculatePushDirection(targetSnapshot.position, actorSnapshot.position, targetSnapshot.facing)
    const staggerResult = applyStaggerAndInterrupt(next[intent.actorId], tick, PARRY_ATTACKER_STAGGER_TICKS, intent.targetId, intent.actionInstanceId, direction, cursor)
    next = { ...next, [intent.actorId]: staggerResult.combatant }
    events.push(...staggerResult.events)

    // `resolveForcedActionStarts` (phase 3.5, next tick) is what actually
    // decides the counter's fate -- see its own doc comment for why this
    // branch does *not* also touch `action` here (Task 9 review finding 4).
    next = { ...next, [intent.targetId]: { ...next[intent.targetId], forcedActionId: 'technical-parry-counter' } }

    return { combatants: next, events }
  }

  const targetWasOpen = (targetSnapshot.action.type === 'active' && targetSnapshot.action.phase === 'recovery') || targetSnapshot.staggerUntilTick > tick
  const isCritical = !blocked && targetWasOpen && attackRolls.critical < actorSnapshot.definition.criticalChance

  const comparisonMultiplier = comparisonDamageMultiplier(compareArchetypes(actorSnapshot.definition.archetype, targetSnapshot.definition.archetype))
  const blockMultiplier = blocked === 'guard' ? GUARD_DAMAGE_MULTIPLIER : 1
  const criticalMultiplier = isCritical ? CRITICAL_DAMAGE_MULTIPLIER : 1
  const damage = calculateContactDamage(actorSnapshot.definition.power, actionDef.damageMultiplier, comparisonMultiplier, criticalMultiplier, blockMultiplier)

  const zone: ContactZone = blocked === 'guard' ? 'shield' : 'body'
  const contactPoint = calculateContactPoint(actorSnapshot.position, targetSnapshot.position, actorSnapshot.facing, zone)

  const newHp = Math.max(0, targetLive.hp - damage)
  const defeated = newHp <= 0
  next = { ...next, [intent.targetId]: { ...targetLive, hp: newHp, status: defeated ? 'defeated' : 'active' } }

  if (isCritical) {
    events.push({
      id: allocateEventId(cursor),
      tick,
      type: 'critical-hit',
      actorId: intent.actorId,
      targetId: intent.targetId,
      actionInstanceId: intent.actionInstanceId,
      actionId: intent.actionId,
      multiplier: CRITICAL_DAMAGE_MULTIPLIER,
    })
  } else if (blocked === 'guard') {
    events.push({
      id: allocateEventId(cursor),
      tick,
      type: 'attack-blocked',
      actorId: intent.actorId,
      targetId: intent.targetId,
      actionInstanceId: intent.actionInstanceId,
      actionId: intent.actionId,
      contactZone: 'shield',
      contactPoint,
    })
  }

  events.push({
    id: allocateEventId(cursor),
    tick,
    type: 'damage-dealt',
    actorId: intent.actorId,
    targetId: intent.targetId,
    actionInstanceId: intent.actionInstanceId,
    actionId: intent.actionId,
    amount: damage,
    remainingHp: newHp,
    contactZone: zone,
    contactPoint,
  })

  const appliedStagger = blocked === 'guard' ? calculateBlockedStaggerTicks(actionDef.staggerTicks) : actionDef.staggerTicks
  const direction = calculatePushDirection(actorSnapshot.position, targetSnapshot.position, actorSnapshot.facing)
  const staggerResult = applyStaggerAndInterrupt(next[intent.targetId], tick, appliedStagger, intent.actorId, intent.actionInstanceId, direction, cursor)
  next = { ...next, [intent.targetId]: staggerResult.combatant }
  events.push(...staggerResult.events)

  if (defeated) {
    events.push({
      id: allocateEventId(cursor),
      tick,
      type: 'fighter-defeated',
      defeatedId: intent.targetId,
      sourceId: intent.actorId,
    })
  }

  const pushMagnitude = blocked === 'guard' ? actionDef.pushDistance * GUARD_PUSH_MULTIPLIER : actionDef.pushDistance
  return { combatants: next, events, pushVector: { x: direction.x * pushMagnitude, z: direction.z * pushMagnitude } }
}

export interface ContactResolutionResult {
  combatants: Record<CombatantId, FighterCombatState>
  events: EncounterEvent[]
  pushByTarget: Readonly<Record<CombatantId, Vec2>>
}

/**
 * Phase 9: resolves every attack action currently in its one-tick `contact`
 * phase. `combatants` (the state as it stands right after phase 8) doubles
 * as the frozen geometry/defense-binding snapshot for the whole batch --
 * position, facing, and every relevant action-phase value are never
 * mutated anywhere in this module, only read from this same input, so no
 * earlier intent's resolution can shift a later intent's geometry. A
 * separate `live` record threads HP/status/stagger/action-state mutations
 * forward intent by intent; `resolveOneIntent` reads geometry/defense-
 * binding/critical-opening from the frozen snapshot but status/HP from
 * `live`, so a mid-batch defeat correctly produces `target-unavailable` for
 * a later intent while a mid-batch non-lethal stagger never perturbs a
 * later intent's already-snapshotted geometry or opening-critical
 * eligibility. Skips an intent outright only when its actor is no longer
 * live-active (defeated earlier in this batch).
 */
export function resolveContactIntents(
  combatants: Readonly<Record<CombatantId, FighterCombatState>>,
  combatantIds: readonly CombatantId[],
  combatStyles: CombatStyleCatalog,
  seed: number,
  tick: number,
  cursor: EventIdCursor,
  arena: Readonly<CombatArenaDefinition>,
  contactCollector?: ContactCollector,
): ContactResolutionResult {
  const snapshot = combatants
  let live: Record<CombatantId, FighterCombatState> = { ...combatants }
  const events: EncounterEvent[] = []
  const pushByTarget: Record<CombatantId, Vec2> = {}

  const sortedIntents = sortContactIntents(buildContactIntents(snapshot, combatantIds, combatStyles, seed, tick))

  for (const intent of sortedIntents) {
    const actorLive = live[intent.actorId]
    if (!actorLive || actorLive.status !== 'active') {
      // Recorded, not skipped silently: this intent DID reach contact, and
      // dropping it would quietly shrink the denominator of every rate
      // derived from these records. See `contactDiagnostics.ts`.
      recordContact(contactCollector, intent, snapshot, tick, 'actor-defeated')
      continue
    }

    const result = resolveOneIntent(intent, snapshot, live, combatStyles, tick, cursor, arena)
    live = result.combatants
    events.push(...result.events)
    recordContact(contactCollector, intent, snapshot, tick, classifyContactOutcome(result.events, intent.actionInstanceId))

    if (result.pushVector) {
      const existing = pushByTarget[intent.targetId] ?? { x: 0, z: 0 }
      pushByTarget[intent.targetId] = { x: existing.x + result.pushVector.x, z: existing.z + result.pushVector.z }
    }
  }

  return { combatants: live, events, pushByTarget }
}

/**
 * The terminal outcome of one contact intent, read back off the events phase 9
 * just emitted for it rather than re-derived, so a diagnostic can never
 * disagree with the event log it describes.
 *
 * Precedence matters in exactly one place: a blocked hit emits `attack-blocked`
 * *and* `damage-dealt`, so `blocked` has to be checked before `hit` or the
 * distinction that the guard worked is lost. The remaining outcomes are
 * mutually exclusive per instance.
 *
 * Falls back to `'hit'` only when a `damage-dealt` is present; an intent that
 * somehow emitted none of these is reported as `'target-unavailable'`, the one
 * outcome that legitimately produces no geometry, so an unclassifiable record
 * is still a record rather than a silent drop.
 */
function classifyContactOutcome(events: readonly EncounterEvent[], actionInstanceId: ActionInstanceId): ContactOutcome {
  let sawDamage = false
  for (const event of events) {
    if (!('actionInstanceId' in event) || event.actionInstanceId !== actionInstanceId) continue
    switch (event.type) {
      case 'attack-parried': return 'parried'
      case 'attack-blocked': return 'blocked'
      case 'attack-evaded': return 'evaded'
      case 'attack-missed':
        return event.reason === 'geometry' ? 'missed-geometry' : event.reason === 'accuracy' ? 'missed-accuracy' : 'target-unavailable'
      case 'damage-dealt':
        sawDamage = true
        break
      default:
        break
    }
  }
  return sawDamage ? 'hit' : 'target-unavailable'
}

function recordContact(
  collector: ContactCollector | undefined,
  intent: ContactIntent,
  snapshot: Readonly<Record<CombatantId, FighterCombatState>>,
  tick: number,
  outcome: ContactOutcome,
): void {
  if (!collector) return
  const actor = snapshot[intent.actorId]
  const target = snapshot[intent.targetId]
  // Throws rather than recording `NaN`. A contact intent exists only because
  // both combatants were in the snapshot phase 9 was handed, so a missing one
  // is a kernel invariant violation -- and `NaN` would pass a finiteness check
  // written as two comparisons, silently poisoning a median instead of
  // failing. Raised in external review of the acceptance instrument.
  if (!actor || !target) {
    throw new Error(`contact diagnostics: intent ${intent.actionInstanceId} references a combatant absent from the phase-9 snapshot`)
  }
  collector.record({
    tick,
    actorId: intent.actorId,
    targetId: intent.targetId,
    actionId: intent.actionId,
    actionInstanceId: intent.actionInstanceId,
    separation: distanceBetween(actor.position, target.position),
    outcome,
  })
}

// --- Phase 10: apply accumulated push, then re-run arena/policy/separation -

/**
 * Push moves the target away from the actor along the snapshot line between
 * roots; same-tick push vectors already accumulated per target (phase 9).
 * Applies that accumulated displacement to every active combatant in one
 * collection-wide pass -- zero for anyone untouched this tick -- reusing
 * phase 8's own `resolveMovementConstraints` (arena clamp, movement-policy
 * constraint, three fixed separation passes) so push is constrained
 * identically to ordinary movement, applied once to the whole collection,
 * never per intent.
 */
function applyAccumulatedPush(
  combatants: Readonly<Record<CombatantId, FighterCombatState>>,
  combatantIds: readonly CombatantId[],
  pushByTarget: Readonly<Record<CombatantId, Vec2>>,
  arena: Readonly<CombatArenaDefinition>,
): Record<CombatantId, FighterCombatState> {
  const updatedFacing: Record<CombatantId, Vec2> = {}
  const requests: MovementRequest[] = []

  for (const id of combatantIds) {
    const combatant = combatants[id]
    updatedFacing[id] = combatant.facing
    if (combatant.status !== 'active') continue
    requests.push({ id, position: combatant.position, desiredDisplacement: pushByTarget[id] ?? { x: 0, z: 0 } })
  }

  return resolveMovementConstraints(combatants, combatantIds, { requests, updatedFacing }, arena)
}

// --- Phase 11: persist local anti-stall clocks ------------------------------
//
// design.md's "Anti-stall pressure": two local clocks per combatant, both
// initialized to encounter-start tick 0 (`buildFighterCombatState`).
// HP/status, targets, action/reaction metadata, event IDs, and combatant
// random states are already persisted incrementally by the phases above
// (phase 3's target refresh, phase 9's HP/status/action writes, each phase's
// own event-ID cursor, phases 4-6's random-state threading); this phase is
// only the two clocks contact resolution does not already touch directly.
// ---------------------------------------------------------------------------

/**
 * The two `CombatantId`s a resolved contact-intent event names as its
 * "participants" for anti-stall clock purposes, or `undefined` for an event
 * that either isn't a per-intent resolution outcome at all, or is one but
 * names a target that was never really a participant
 * (`attack-missed(reason: 'target-unavailable')` -- the target had already
 * left before this intent resolved against it).
 */
function resolutionParticipantIds(event: EncounterEvent): readonly [CombatantId, CombatantId] | undefined {
  switch (event.type) {
    case 'damage-dealt':
    case 'attack-evaded':
      return [event.actorId, event.targetId]
    case 'attack-parried':
      return [event.actorId, event.defenderId]
    case 'attack-missed':
      return event.reason === 'target-unavailable' ? undefined : [event.actorId, event.targetId]
    default:
      return undefined
  }
}

/** `lastContactTick` updates for damage or parry only (design.md: "damage, block, or parry" -- a blocked hit is still a `damage-dealt` event, just with a reduced `amount`). */
function resolutionUpdatesContactClock(event: EncounterEvent): boolean {
  return event.type === 'damage-dealt' || event.type === 'attack-parried'
}

/**
 * Persists `lastContactTick`/`lastResolutionTick` from this tick's own
 * phase-9 contact-resolution events (never the whole tick's event batch --
 * `movement-intent-changed`/`action-started`/etc. are not resolutions).
 * `lastResolutionTick` updates for both participants of every resolved
 * intent except `target-unavailable`; `lastContactTick` updates for both
 * participants only on `damage-dealt`/`attack-parried`. Both fields are
 * simple `= tick` assignments (never "keep the max"): a resolution can only
 * ever happen on the current tick, so there is nothing to compare against.
 */
function persistLocalClocks(
  combatants: Readonly<Record<CombatantId, FighterCombatState>>,
  contactEvents: readonly EncounterEvent[],
  tick: number,
): Record<CombatantId, FighterCombatState> {
  let next: Record<CombatantId, FighterCombatState> = { ...combatants }
  for (const event of contactEvents) {
    const participants = resolutionParticipantIds(event)
    if (!participants) continue
    const updatesContact = resolutionUpdatesContactClock(event)
    for (const id of participants) {
      const combatant = next[id]
      if (!combatant) continue
      next = {
        ...next,
        [id]: {
          ...combatant,
          lastResolutionTick: tick,
          lastContactTick: updatesContact ? tick : combatant.lastContactTick,
        },
      }
    }
  }
  return next
}

// --- Phase 12: resolve no-hostile-pairs completion --------------------------
//
// The duel time-limit policy is Task 11's, layered on top of this generic
// kernel as a different `EncounterResult` passed through the same
// `finishEncounter`, not special-cased here.
// ---------------------------------------------------------------------------

/**
 * Finishes `state` with reason `'no-hostile-pairs'` when no living hostile
 * pair remains: every living combatant is both a survivor and a winner
 * (design.md: "all living allied survivors win"), including the degenerate
 * zero-survivor case (mutual defeat on the same tick). Returns `undefined`
 * (no completion) while a hostile pair still exists.
 */
function resolveNoHostilePairsCompletion(state: EncounterState): EncounterTransition | undefined {
  if (hasAnyHostilePair(state, state.combatantIds)) return undefined

  const survivorIds = state.combatantIds.filter((id) => state.combatants[id].status === 'active')
  const winningFactionIds = [...new Set(survivorIds.map((id) => state.combatants[id].factionId))].sort()

  return finishEncounter(state, {
    reason: 'no-hostile-pairs',
    survivorIds,
    winnerIds: survivorIds,
    winningFactionIds,
  })
}

// --- The tick loop itself ---------------------------------------------------

/**
 * Advances `previous` by exactly one tick through the complete phase 1-12
 * order. Outside `running`, this returns `previous` itself (referential
 * identity, empty event batch) -- a finished encounter is inert. Never
 * mutates `previous` or anything reachable from it.
 */
export function advanceEncounterTick(
  previous: EncounterState,
  collector?: DecisionCollector,
  contactCollector?: ContactCollector,
  disengageCollector?: DisengageCollector,
): EncounterTransition {
  if (previous.phase !== 'running') {
    return { state: previous, events: [] }
  }

  const tick = previous.tick + 1
  const cursor: EventIdCursor = { nextEventId: previous.nextEventId }
  const events: EncounterEvent[] = []

  // Phase 1
  let combatants = transitionExpiredPhases(previous.combatants, previous.combatantIds, tick, previous.combatStyles)

  // Phase 2
  const cleanup = pruneReactionLedgerAndCancelThreats(combatants, previous.combatantIds, tick, cursor)
  combatants = cleanup.combatants
  events.push(...cleanup.events)

  const forcedTransitions = completeForcedStateTransitions(previous.combatants, combatants, previous.combatantIds, tick, cursor, disengageCollector)
  combatants = forcedTransitions.combatants
  events.push(...forcedTransitions.events)

  // Phase 3
  const preMovementHash = buildActivePreMovementHash(combatants, previous.combatantIds)
  combatants = refreshTargets(combatants, previous.combatantIds, previous.hostility, preMovementHash, tick)

  // Technical's forced parry-counter start check (carried forward into this
  // task; see `resolveForcedActionStarts`) runs against the freshly
  // refreshed targets, right before phase 4 so it can bypass weighted
  // selection for any actor it fires for.
  const forcedActionStarts = resolveForcedActionStarts(combatants, previous.combatantIds, tick)
  combatants = forcedActionStarts.combatants
  const forcedActionActorIds = new Set(forcedActionStarts.pendingActionStarts.map((start) => start.actorId))

  // Phase 4
  let randomByCombatant = previous.randomByCombatant
  const decisions = makeCombatDecisions(
    combatants,
    previous.combatantIds,
    randomByCombatant,
    tick,
    previous.arena,
    previous.hostility,
    previous.combatStyles,
    preMovementHash,
    cursor,
    forcedActionActorIds,
    collector,
  )
  combatants = decisions.combatants
  randomByCombatant = decisions.randomByCombatant
  events.push(...decisions.events)

  // Phase 5 (forced-counter starts merged with ordinary decisions, sorted by
  // actor so this stays a single canonical-order pass; the two sources are
  // always disjoint sets of actors)
  const pendingActionStarts = [...forcedActionStarts.pendingActionStarts, ...decisions.pendingActionStarts].sort((a, b) =>
    a.actorId < b.actorId ? -1 : a.actorId > b.actorId ? 1 : 0,
  )
  const starts = startSelectedActions(combatants, randomByCombatant, pendingActionStarts, tick, previous.combatStyles, cursor)
  combatants = starts.combatants
  randomByCombatant = starts.randomByCombatant
  events.push(...starts.events)

  // Phase 6
  const defense = processDefenseReactions(combatants, previous.combatantIds, randomByCombatant, tick, previous.combatStyles, cursor)
  combatants = defense.combatants
  randomByCombatant = defense.randomByCombatant
  events.push(...defense.events)

  // Phase 7
  const intents = computeMovementIntents(combatants, previous.combatantIds, previous.combatStyles, tick, previous.arena)

  // Phase 8
  combatants = resolveMovementConstraints(combatants, previous.combatantIds, intents, previous.arena)

  // Phase 9
  const contactResolution = resolveContactIntents(combatants, previous.combatantIds, previous.combatStyles, previous.seed, tick, cursor, previous.arena, contactCollector)
  combatants = contactResolution.combatants
  events.push(...contactResolution.events)

  // Phase 10
  combatants = applyAccumulatedPush(combatants, previous.combatantIds, contactResolution.pushByTarget, previous.arena)

  // Motion diagnostics (`velocity`/`travelledDistance`): derived once here,
  // from the tick's true start-to-end displacement, now that both
  // position-mutating phases (8 and 10) have finished.
  combatants = applyTickMotionDiagnostics(previous.combatants, combatants, previous.combatantIds)

  // Phase 11
  combatants = persistLocalClocks(combatants, contactResolution.events, tick)

  const nextState: EncounterState = {
    ...previous,
    tick,
    combatants,
    randomByCombatant,
    nextEventId: cursor.nextEventId,
  }

  assertEncounterInvariants(nextState)

  // Phase 12: `encounter-finished` is emitted only after every phase above
  // has persisted this tick's contact effects, so its payload (survivor/
  // winner IDs, and whatever a listener reads off `nextState.combatants`)
  // reflects post-contact HP/status.
  const completion = resolveNoHostilePairsCompletion(nextState)
  if (completion) {
    return { state: completion.state, events: [...events, ...completion.events] }
  }

  return { state: nextState, events }
}

/**
 * Repeatedly applies `advanceEncounterTick`, stopping early once the
 * encounter is no longer `running`, and concatenates every batch's events at
 * this one aggregating caller (the kernel itself never accumulates an event
 * log).
 */
export function advanceEncounterTicks(initial: EncounterState, ticks: number, collector?: DecisionCollector): EncounterTransition {
  let state = initial
  const events: EncounterEvent[] = []
  for (let index = 0; index < ticks && state.phase === 'running'; index += 1) {
    const next = advanceEncounterTick(state, collector)
    state = next.state
    events.push(...next.events)
  }
  return { state, events }
}

// ---------------------------------------------------------------------------
// Invariants
// ---------------------------------------------------------------------------

const FACING_LENGTH_EPSILON = 1e-6
const ARENA_BOUNDS_EPSILON = 1e-6

function requireFinite(value: number, field: string): void {
  if (!Number.isFinite(value)) {
    throw new Error(`EncounterState ${field} must be a finite number`)
  }
}

function requireFiniteInteger(value: number, field: string, minimum = 0): void {
  if (!Number.isFinite(value) || !Number.isInteger(value) || value < minimum) {
    throw new Error(`EncounterState ${field} must be a finite integer >= ${minimum}`)
  }
}

function assertSortedUniqueIds(combatantIds: readonly CombatantId[]): void {
  const sortedUnique = [...new Set(combatantIds)].sort()
  const matches = sortedUnique.length === combatantIds.length && sortedUnique.every((id, index) => id === combatantIds[index])
  if (!matches) {
    throw new Error('EncounterState combatantIds must be sorted and unique')
  }
}

function assertRecordKeysMatch(record: Readonly<Record<string, unknown>>, sortedIds: readonly CombatantId[], field: string): void {
  const keys = Object.keys(record).sort()
  const matches = keys.length === sortedIds.length && keys.every((id, index) => id === sortedIds[index])
  if (!matches) {
    throw new Error(`EncounterState ${field} must have exactly one entry per combatantIds entry`)
  }
}

function assertCombatantInvariants(combatant: FighterCombatState, id: CombatantId, arena: Readonly<CombatArenaDefinition>): void {
  const field = (name: string) => `combatants.${id}.${name}`

  requireFinite(combatant.position.x, field('position.x'))
  requireFinite(combatant.position.z, field('position.z'))
  if (Math.abs(combatant.position.z) > arena.lateralLimit + ARENA_BOUNDS_EPSILON) {
    throw new Error(`EncounterState ${field('position')} must be within arena.lateralLimit`)
  }
  const distanceFromOrigin = Math.sqrt(combatant.position.x * combatant.position.x + combatant.position.z * combatant.position.z)
  if (distanceFromOrigin > arena.radius + ARENA_BOUNDS_EPSILON) {
    throw new Error(`EncounterState ${field('position')} must be within arena.radius`)
  }

  requireFinite(combatant.facing.x, field('facing.x'))
  requireFinite(combatant.facing.z, field('facing.z'))
  const facingLength = Math.sqrt(combatant.facing.x * combatant.facing.x + combatant.facing.z * combatant.facing.z)
  if (Math.abs(facingLength - 1) > FACING_LENGTH_EPSILON) {
    throw new Error(`EncounterState ${field('facing')} must be a normalized (unit-length) vector`)
  }

  if (!Number.isFinite(combatant.hp) || combatant.hp < 0 || combatant.hp > combatant.definition.maxHp) {
    throw new Error(`EncounterState ${field('hp')} must be between 0 and definition.maxHp`)
  }
  if (combatant.status === 'active' && combatant.hp <= 0) {
    throw new Error(`EncounterState ${field('status')} must not be 'active' with non-positive hp`)
  }
  if (combatant.status === 'defeated' && combatant.hp > 0) {
    throw new Error(`EncounterState ${field('status')} must not be 'defeated' with positive hp`)
  }

  requireFiniteInteger(combatant.nextActionSerial, field('nextActionSerial'))
  requireFiniteInteger(combatant.nextDecisionTick, field('nextDecisionTick'))
  requireFiniteInteger(combatant.staggerUntilTick, field('staggerUntilTick'))
  requireFiniteInteger(combatant.lastContactTick, field('lastContactTick'))
  requireFiniteInteger(combatant.lastResolutionTick, field('lastResolutionTick'))
  if (combatant.forcedDisengageStartTick !== undefined) {
    requireFiniteInteger(combatant.forcedDisengageStartTick, field('forcedDisengageStartTick'))
  }

  requireFinite(combatant.travelledDistance, field('travelledDistance'))
  if (combatant.travelledDistance < 0) {
    throw new Error(`EncounterState ${field('travelledDistance')} must be non-negative`)
  }

  if (combatant.action.type === 'active' && !combatant.action.instanceId.startsWith(`${id}:`)) {
    throw new Error(`EncounterState ${field('action.instanceId')} must start with '${id}:'`)
  }

  if (!Array.isArray(combatant.reactionLedger)) {
    throw new Error(`EncounterState ${field('reactionLedger')} must be an array`)
  }
  const seenIncomingActionIds = new Set<string>()
  for (const record of combatant.reactionLedger) {
    if (seenIncomingActionIds.has(record.incomingActionId)) {
      throw new Error(`EncounterState ${field('reactionLedger')} must not contain duplicate incomingActionId '${record.incomingActionId}'`)
    }
    seenIncomingActionIds.add(record.incomingActionId)
  }
}

function assertRandomStateInvariants(random: CombatantRandomState, id: CombatantId): void {
  const field = (name: string) => `randomByCombatant.${id}.${name}`
  requireFiniteInteger(random.decision.value, field('decision.value'))
  requireFiniteInteger(random.defense.value, field('defense.value'))
  requireFiniteInteger(random.contact.value, field('contact.value'))
}

/**
 * Throws a developer error naming the offending field when `state` violates
 * a structural invariant: sorted/unique IDs, one `combatants`/
 * `randomByCombatant` entry per `combatantIds` entry, normalized finite
 * facing, in-bounds finite position, HP within `0..definition.maxHp`,
 * active/defeated-vs-HP consistency, non-negative integer local clocks and
 * action serials, a reaction ledger free of duplicate incoming action IDs,
 * and (for `relation-table` hostility) no conflicting relation rows.
 */
export function assertEncounterInvariants(state: EncounterState): void {
  requireFiniteInteger(state.tick, 'tick')
  requireFiniteInteger(state.nextEventId, 'nextEventId')

  assertSortedUniqueIds(state.combatantIds)
  assertRecordKeysMatch(state.combatants, state.combatantIds, 'combatants')
  assertRecordKeysMatch(state.randomByCombatant, state.combatantIds, 'randomByCombatant')

  if (state.hostility.mode === 'relation-table') {
    requireNoConflictingRelations(state.hostility.relations)
  }

  for (const id of state.combatantIds) {
    assertCombatantInvariants(state.combatants[id], id, state.arena)
    assertRandomStateInvariants(state.randomByCombatant[id], id)
  }
}
