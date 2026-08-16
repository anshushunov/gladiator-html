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

import type { AttackActionId, CombatActionId, CombatActionState, CombatStyleCatalog, ContactZone, DefenseActionId, ReactionRecord } from './combatActions'
import type { FighterDefinition } from './fighters'
import { validateFighterDefinition } from './fighters'
import type { CombatArenaDefinition, LocomotionIntent, Vec2 } from './movement'
import { normalizeVec2 } from './movement'
import type { CombatantRandomState } from './random'
import { createCombatantRandomState } from './random'

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
function resolveFactionRelation(hostility: HostilityDefinition, factionA: FactionId, factionB: FactionId): HostilityRelation {
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
}

export interface EncounterCombatantDefinition {
  id: CombatantId
  factionId: FactionId
  fighter: FighterDefinition
  startPosition: Vec2
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
    definition: fighter,
    position,
    facing: computeStartFacing(definition.id, position, arena, positionsById),
    travelledDistance: 0,
    hp: fighter.maxHp,
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
