// The decision brain: target retention/acquisition, decision context
// construction, legal candidate filtering, scoring, seeded selection,
// forced-behavior thresholds, and batched defense reactions.
//
// This module deliberately keeps five pipeline stages separate so a future
// combat-skill/perk system can slot in without touching action resolution:
//
//   1. context construction  -- buildCombatDecisionContext
//   2. legal candidates      -- ordinaryLocomotionCandidates / legalActionCandidates (private)
//   3. scoring                -- rawCandidateWeight / applyModifiers (private), scoreCombatCandidates (public)
//   4. seeded selection       -- selectProportionally / deterministicFallbackDecision (private), chooseCombatDecision (public)
//   5. action execution       -- out of scope for this task; Task 8 starts the chosen action.
//
// `DecisionModifier` is the only skill/perk seam this slice adds: it is
// applied inside scoring only (stage 3), defaults to `[]`, and this module
// adds no `combatSkill` field, perk registry, or presentation behavior.
//
// This module never imports `src/content/**`; all authored data arrives by
// parameter as a `CombatStyleCatalog` (see `src/simulation/architecture.test.ts`).

import type {
  ActionInstanceId,
  CombatantId,
  DefenseDeclinedEvent,
  DefenseStartedEvent,
  FighterCombatState,
  HostilityDefinition,
} from './encounter'
import { areHostile } from './encounter'
import {
  startDefenseAction,
  type AttackActionDefinition,
  type AttackActionId,
  type CombatStyleCatalog,
  type CombatStyleDefinition,
  type DefenseActionDefinition,
  type ReactionRecord,
} from './combatActions'
import type { CombatArenaDefinition, LocomotionIntent, Vec2 } from './movement'
import type { Archetype, MatchupComparison } from './fighters'
import { compareArchetypes } from './fighters'
import { nextRandom, type RandomState } from './random'
import { queryRadius, type SpatialHash } from './spatialHash'

// ---------------------------------------------------------------------------
// Small shared numeric helpers
// ---------------------------------------------------------------------------

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

function distanceBetween(a: Readonly<Vec2>, b: Readonly<Vec2>): number {
  const dx = b.x - a.x
  const dz = b.z - a.z
  return Math.sqrt(dx * dx + dz * dz)
}

function squaredDistanceBetween(a: Readonly<Vec2>, b: Readonly<Vec2>): number {
  const dx = b.x - a.x
  const dz = b.z - a.z
  return dx * dx + dz * dz
}

// ---------------------------------------------------------------------------
// Stage 1a: target retention / acquisition
//
// These two functions are standalone and pure: they consult a caller-
// supplied combatants snapshot (and, for acquisition, a caller-supplied
// transient spatial index) and never mutate anything. Task 8's tick loop
// calls them before `buildCombatDecisionContext`, which itself receives an
// already-resolved `targetId` rather than performing retention/acquisition
// internally.
// ---------------------------------------------------------------------------

/** A combatant retains its target while alive, hostile, and within this many units (inclusive). */
export const TARGET_RETENTION_RADIUS = 20

/** Reacquisition queries up to this many units (inclusive). */
export const TARGET_ACQUISITION_RADIUS = 16

export interface TargetRetentionInput {
  self: Readonly<FighterCombatState>
  combatants: Readonly<Record<CombatantId, FighterCombatState>>
  hostility: HostilityDefinition
}

/**
 * Returns `self.targetId` unchanged if it still names a living, hostile
 * combatant within `TARGET_RETENTION_RADIUS` units, otherwise `undefined`.
 * Never considers any other candidate: retaining a valid target is never
 * displaced by a "more attractive" one (current policy, see design.md's
 * targeting section).
 */
export function retainTarget(input: Readonly<TargetRetentionInput>): CombatantId | undefined {
  const targetId = input.self.targetId
  if (!targetId) return undefined
  const target = input.combatants[targetId]
  if (!target || target.status !== 'active') return undefined
  if (!areHostile({ hostility: input.hostility, combatants: input.combatants }, input.self.id, targetId)) return undefined
  const distanceSq = squaredDistanceBetween(input.self.position, target.position)
  if (distanceSq > TARGET_RETENTION_RADIUS * TARGET_RETENTION_RADIUS) return undefined
  return targetId
}

export interface HostileAcquisitionSource {
  spatialIndex: SpatialHash
  combatants: Readonly<Record<CombatantId, FighterCombatState>>
  hostility: HostilityDefinition
}

/**
 * Queries `source.spatialIndex` up to `radius` units (inclusive) around
 * `selfId` and returns the hostile, living candidate with the smallest
 * squared distance, breaking ties by lexicographically smallest
 * `CombatantId`. Returns `undefined` when no such candidate exists.
 * `queryRadius` already returns ids sorted ascending by id, so a strict `<`
 * comparison while scanning in that order automatically keeps the first
 * (lowest-id) candidate on an exact distance tie.
 */
export function acquireNearestHostile(source: Readonly<HostileAcquisitionSource>, selfId: CombatantId, radius: number): CombatantId | undefined {
  const self = source.combatants[selfId]
  if (!self) return undefined

  const candidateIds = queryRadius(source.spatialIndex, self.position, radius)

  let bestId: CombatantId | undefined
  let bestDistanceSq = Infinity
  for (const candidateId of candidateIds) {
    if (candidateId === selfId) continue
    const candidate = source.combatants[candidateId]
    if (!candidate || candidate.status !== 'active') continue
    if (!areHostile({ hostility: source.hostility, combatants: source.combatants }, selfId, candidateId)) continue

    const distanceSq = squaredDistanceBetween(self.position, candidate.position)
    if (distanceSq < bestDistanceSq) {
      bestDistanceSq = distanceSq
      bestId = candidateId
    }
  }
  return bestId
}

// ---------------------------------------------------------------------------
// Anti-stall clocks
// ---------------------------------------------------------------------------

/** Local resolution gap at/beyond which retreat/backstep/circling/disengage are suppressed. */
export const LOCAL_RESOLUTION_STALE_TICKS = 300

/**
 * `contactGap = tick - lastContactTick`; `0` through a 180-tick gap, then
 * steps `1..3` in 60-tick increments, capped at `3`.
 */
export function computePressureLevel(tick: number, lastContactTick: number): number {
  const contactGap = tick - lastContactTick
  if (contactGap <= 180) return 0
  return Math.min(3, 1 + Math.floor((contactGap - 181) / 60))
}

function isLocalResolutionStale(tick: number, lastResolutionTick: number): boolean {
  return tick - lastResolutionTick >= LOCAL_RESOLUTION_STALE_TICKS
}

// ---------------------------------------------------------------------------
// Stage 1b: decision context construction
// ---------------------------------------------------------------------------

export interface CombatDecisionContext {
  tick: number
  self: Readonly<FighterCombatState>
  target: Readonly<FighterCombatState>
  nearbyCombatantIds: Readonly<{
    allied: readonly CombatantId[]
    neutral: readonly CombatantId[]
    hostile: readonly CombatantId[]
  }>
  comparison: MatchupComparison
  pressureLevel: number
  arena: Readonly<CombatArenaDefinition>
  // NOTE ON A BRIEF/DESIGN GAP: `CombatStyleDefinition` (design.md's own
  // sketch, mirrored by the task brief's Step 3 signatures) carries only
  // `attackActionIds: readonly AttackActionId[]`, never the actual
  // `AttackActionDefinition`s (contactRange/rootTravel/tags/...) that
  // legality and scoring both need. Neither `scoreCombatCandidates` nor
  // `buildCombatDecisionContext`'s brief-sketched input list includes a
  // catalog parameter to supply them. This field is the minimal resolution:
  // `buildCombatDecisionContext` takes one extra required `combatStyles`
  // input (see below) purely to resolve and embed this map, so
  // `scoreCombatCandidates`/`chooseCombatDecision` keep exactly the
  // signatures the brief specifies.
  attacks: Readonly<Record<AttackActionId, AttackActionDefinition>>
}

export interface BuildCombatDecisionContextInput {
  tick: number
  selfId: CombatantId
  targetId: CombatantId
  combatants: Readonly<Record<CombatantId, FighterCombatState>>
  hostility: HostilityDefinition
  arena: Readonly<CombatArenaDefinition>
  nearbyIds: readonly CombatantId[]
  combatStyles: CombatStyleCatalog
}

/**
 * Classifies each id in `nearbyIds` (excluding `selfId` and any non-active
 * combatant) as allied/neutral/hostile relative to `selfId`, sorted
 * lexicographically within each bucket.
 *
 * KNOWN APPROXIMATION: `encounter.ts`'s full three-way relation resolver
 * (`resolveFactionRelation`) is private and this task's file list does not
 * include `encounter.ts`, so this reconstructs the classification from the
 * single exported `areHostile` boolean plus same-faction comparison:
 * hostile (via `areHostile`) takes priority, then same-faction -> allied,
 * else -> neutral. This exactly matches `free-for-all` and
 * `different-factions` in every case, and matches `relation-table`'s
 * *default* rows exactly. It under-classifies only one relation-table edge
 * case this slice never authors: an explicit cross-faction row set to
 * `allied` reads back as `neutral` here (since only the hostile/not-hostile
 * boundary is externally visible). This bucketing is informational only --
 * design.md is explicit that "current 1x1 style weights ignore" it.
 */
function classifyNearbyCombatants(
  selfId: CombatantId,
  nearbyIds: readonly CombatantId[],
  combatants: Readonly<Record<CombatantId, FighterCombatState>>,
  hostility: HostilityDefinition,
): CombatDecisionContext['nearbyCombatantIds'] {
  const self = combatants[selfId]
  const allied: CombatantId[] = []
  const neutral: CombatantId[] = []
  const hostile: CombatantId[] = []

  for (const id of nearbyIds) {
    if (id === selfId) continue
    const other = combatants[id]
    if (!other || other.status !== 'active') continue
    if (areHostile({ hostility, combatants }, selfId, id)) hostile.push(id)
    else if (self && other.factionId === self.factionId) allied.push(id)
    else neutral.push(id)
  }

  return { allied: [...new Set(allied)].sort(), neutral: [...new Set(neutral)].sort(), hostile: [...new Set(hostile)].sort() }
}

/**
 * Builds a read-only `CombatDecisionContext` for `selfId` acting against the
 * already-resolved `targetId` (retention/acquisition happens earlier, via
 * `retainTarget`/`acquireNearestHostile`). `comparison` is always computed
 * from `self`'s archetype toward `target`'s, never stored globally.
 */
export function buildCombatDecisionContext(input: Readonly<BuildCombatDecisionContextInput>): CombatDecisionContext {
  const self = input.combatants[input.selfId]
  const target = input.combatants[input.targetId]
  if (!self) throw new Error(`buildCombatDecisionContext: unknown selfId '${input.selfId}'`)
  if (!target) throw new Error(`buildCombatDecisionContext: unknown targetId '${input.targetId}'`)

  return {
    tick: input.tick,
    self,
    target,
    nearbyCombatantIds: classifyNearbyCombatants(input.selfId, input.nearbyIds, input.combatants, input.hostility),
    comparison: compareArchetypes(self.definition.archetype, target.definition.archetype),
    pressureLevel: computePressureLevel(input.tick, self.lastContactTick),
    arena: input.arena,
    attacks: input.combatStyles.attacks,
  }
}

// ---------------------------------------------------------------------------
// Stage 2: legal candidates
// ---------------------------------------------------------------------------

export type CombatDecision = { type: 'locomotion'; locomotionIntent: LocomotionIntent } | { type: 'action'; actionId: AttackActionId }

const LOCOMOTION_INTENT_SET: ReadonlySet<string> = new Set<LocomotionIntent>([
  'hold-range',
  'advance',
  'retreat',
  'circle-left',
  'circle-right',
  'burst-in',
  'backstep',
  'disengage',
  'pressure',
])

function isLocomotionIntent(key: string): key is LocomotionIntent {
  return LOCOMOTION_INTENT_SET.has(key)
}

const STALE_SUPPRESSED_INTENTS: ReadonlySet<LocomotionIntent> = new Set<LocomotionIntent>(['retreat', 'backstep', 'circle-left', 'circle-right', 'disengage'])

// Fast may select pure `burst-in` only to close from this band (design.md's
// locomotion section); this is a fixed authored constant, not derived from
// any catalog speed field even though it happens to coincide numerically
// with Fast's `burstUnitsPerSecond`.
const BURST_IN_MIN_RANGE = 2.8
const BURST_IN_MAX_RANGE = 4.0

/**
 * Ordinary locomotion candidates are exactly the locomotion keys present in
 * `style.baseWeights`, in the order those keys were authored (that object's
 * own key order -- fixed, versioned content, never runtime-varying object
 * construction order). This is the ordering rule the Step 2 fixture's
 * expected candidate order (`advance, pressure, circle-left, circle-right`)
 * confirms: Heavy's authored order is
 * `advance, hold-range, pressure, circle-left, circle-right, retreat`, and
 * dropping the two that score non-positive leaves exactly that sequence.
 * Anti-stall-suppressed intents and `burst-in` outside its authored range
 * band are excluded here (legality), not merely penalized (scoring).
 */
function ordinaryLocomotionCandidates(context: CombatDecisionContext, style: CombatStyleDefinition): CombatDecision[] {
  const currentDistance = distanceBetween(context.self.position, context.target.position)
  const stale = isLocalResolutionStale(context.tick, context.self.lastResolutionTick)
  const out: CombatDecision[] = []

  for (const key of Object.keys(style.baseWeights)) {
    if (!isLocomotionIntent(key)) continue
    if (stale && STALE_SUPPRESSED_INTENTS.has(key)) continue
    if (key === 'burst-in' && (currentDistance < BURST_IN_MIN_RANGE || currentDistance > BURST_IN_MAX_RANGE)) continue
    out.push({ type: 'locomotion', locomotionIntent: key })
  }
  return out
}

/**
 * Legal action candidates are `style.attackActionIds`, in their authored
 * array order, filtered to those reachable through the action's authored
 * root travel: `predictedContactDistance = currentDistance - rootTravel`
 * must fall within `contactRange`, and a burst attack additionally requires
 * `currentDistance <= startMaxRange`.
 */
function legalActionCandidates(context: CombatDecisionContext, style: CombatStyleDefinition): CombatDecision[] {
  const currentDistance = distanceBetween(context.self.position, context.target.position)
  const out: CombatDecision[] = []

  for (const actionId of style.attackActionIds) {
    const action = context.attacks[actionId]
    if (action.startMaxRange !== undefined && currentDistance > action.startMaxRange) continue
    const predicted = currentDistance - action.rootTravel
    if (predicted < action.contactRange.min || predicted > action.contactRange.max) continue
    out.push({ type: 'action', actionId })
  }
  return out
}

function buildLegalCandidates(context: CombatDecisionContext, style: CombatStyleDefinition): CombatDecision[] {
  return [...ordinaryLocomotionCandidates(context, style), ...legalActionCandidates(context, style)]
}

// ---------------------------------------------------------------------------
// Stage 3: scoring
// ---------------------------------------------------------------------------

export interface ScoredCombatDecision {
  decision: CombatDecision
  weight: number
}

export interface DecisionModifier {
  readonly id: string
  adjustCandidate(input: Readonly<{ context: CombatDecisionContext; decision: CombatDecision; weight: number }>): number
}

type MovementDirectionGroup = 'forward' | 'backward' | 'lateral'

const LOCOMOTION_DIRECTION_GROUP: Readonly<Partial<Record<LocomotionIntent, MovementDirectionGroup>>> = {
  advance: 'forward',
  pressure: 'forward',
  'burst-in': 'forward',
  retreat: 'backward',
  backstep: 'backward',
  disengage: 'backward',
  'circle-left': 'lateral',
  'circle-right': 'lateral',
}

type PreferredRangeState = 'below' | 'within' | 'above'

function preferredRangeState(currentDistance: number, range: Readonly<{ min: number; max: number }>): PreferredRangeState {
  if (currentDistance < range.min) return 'below'
  if (currentDistance > range.max) return 'above'
  return 'within'
}

/**
 * `+12` for locomotion that reduces distance error toward the preferred
 * band, `+12` for `hold-range` already inside that band, `-12` for
 * `hold-range` outside the band or locomotion that increases the error
 * without a style-authored tactical reason (lateral circling is such a
 * reason -> `0`, neither bonus nor penalty).
 */
function locomotionDistanceAdjustment(intent: LocomotionIntent, currentDistance: number, range: Readonly<{ min: number; max: number }>): number {
  const state = preferredRangeState(currentDistance, range)

  if (intent === 'hold-range') return state === 'within' ? 12 : -12

  const group = LOCOMOTION_DIRECTION_GROUP[intent]
  if (group === undefined || group === 'lateral') return 0
  if (state === 'within') return -12 // moving away from an already-good position always increases error

  const reducesError = (state === 'above' && group === 'forward') || (state === 'below' && group === 'backward')
  return reducesError ? 12 : -12
}

function targetHasOpening(target: Readonly<FighterCombatState>, tick: number): boolean {
  const inRecovery = target.action.type === 'active' && target.action.phase === 'recovery'
  const staggered = target.staggerUntilTick > tick
  return inRecovery || staggered
}

/**
 * `-20` when the action's predicted finishing position (root travel along
 * current facing) lands within 0.4 units of either arena boundary
 * (lateral band or outer radius, matching `movement.ts`'s two-stage clamp).
 */
function isNearArenaBoundary(context: CombatDecisionContext, action: AttackActionDefinition): boolean {
  const finishX = context.self.position.x + context.self.facing.x * action.rootTravel
  const finishZ = context.self.position.z + context.self.facing.z * action.rootTravel
  const radialMargin = context.arena.radius - Math.sqrt(finishX * finishX + finishZ * finishZ)
  const lateralMargin = context.arena.lateralLimit - Math.abs(finishZ)
  return Math.min(radialMargin, lateralMargin) < 0.4
}

function comparisonScoreAdjustment(comparison: MatchupComparison): number {
  if (comparison === 'advantage') return 5
  if (comparison === 'disadvantage') return -5
  return 0
}

/** Raw (pre-modifier) weight for one legal candidate: baseWeight + every applicable built-in adjustment, summed exactly once. */
function rawCandidateWeight(context: CombatDecisionContext, style: CombatStyleDefinition, decision: CombatDecision): number {
  const currentDistance = distanceBetween(context.self.position, context.target.position)

  if (decision.type === 'locomotion') {
    const intent = decision.locomotionIntent
    let weight = style.baseWeights[intent] ?? 0
    weight += locomotionDistanceAdjustment(intent, currentDistance, style.preferredRange)
    if (intent === 'advance' || intent === 'pressure' || intent === 'burst-in') weight += 8 * context.pressureLevel
    if (intent === 'retreat' || intent === 'disengage') weight -= 8 * context.pressureLevel
    return weight
  }

  const action = context.attacks[decision.actionId]
  let weight = style.baseWeights[decision.actionId] ?? 0

  const predicted = currentDistance - action.rootTravel
  const rangeMid = (action.contactRange.min + action.contactRange.max) / 2
  const rangeHalfWidth = (action.contactRange.max - action.contactRange.min) / 2
  const rangeFit = rangeHalfWidth > 0 ? 20 * clamp(1 - Math.abs(predicted - rangeMid) / rangeHalfWidth, 0, 1) : predicted === rangeMid ? 20 : 0
  weight += rangeFit

  if (targetHasOpening(context.target, context.tick)) {
    if (action.tags.includes('committed') || action.tags.includes('counter')) weight += 18
    else if (action.tags.includes('probe')) weight += 6
  }

  if (isNearArenaBoundary(context, action)) weight -= 20

  if (action.tags.includes('committed')) weight += 8 * context.pressureLevel

  weight += comparisonScoreAdjustment(context.comparison)

  return weight
}

function applyModifiers(rawWeight: number, context: CombatDecisionContext, decision: CombatDecision, modifiers: readonly DecisionModifier[]): number {
  let weight = rawWeight
  for (const modifier of modifiers) {
    weight += modifier.adjustCandidate({ context, decision, weight })
  }
  return weight
}

/**
 * `weight(candidate) = max(0, baseWeight + sum(applicableAdjustments))`,
 * with any `modifiers` applied last (the future skill/perk seam; defaults
 * to `[]`, does not affect any candidate here). Only candidates whose final
 * weight is strictly positive are returned, in legal-candidate order
 * (locomotion, in `style.baseWeights` authored order, then actions, in
 * `style.attackActionIds` authored order).
 */
export function scoreCombatCandidates(
  context: CombatDecisionContext,
  style: CombatStyleDefinition,
  modifiers: readonly DecisionModifier[] = [],
): readonly ScoredCombatDecision[] {
  const candidates = buildLegalCandidates(context, style)
  const scored: ScoredCombatDecision[] = []

  for (const decision of candidates) {
    const raw = rawCandidateWeight(context, style, decision)
    const weight = Math.max(0, applyModifiers(raw, context, decision, modifiers))
    if (weight > 0) scored.push({ decision, weight })
  }

  return scored
}

// ---------------------------------------------------------------------------
// Stage 4: seeded selection
// ---------------------------------------------------------------------------

const FORWARD_FALLBACK_PRIORITY: readonly LocomotionIntent[] = ['advance', 'pressure', 'burst-in']
const BACKWARD_FALLBACK_PRIORITY: readonly LocomotionIntent[] = ['retreat', 'backstep', 'disengage']

/**
 * When every candidate's weight is non-positive, policy deterministically
 * selects movement toward the preferred range (the first legal candidate,
 * in a fixed forward/backward priority order, that would reduce distance
 * error), or `hold-range` when already inside that band or when no
 * directional candidate is legal for this style. Never illegal, never
 * throws.
 */
function deterministicFallbackDecision(context: CombatDecisionContext, style: CombatStyleDefinition): CombatDecision {
  const currentDistance = distanceBetween(context.self.position, context.target.position)
  const state = preferredRangeState(currentDistance, style.preferredRange)
  const legalLocomotion = new Set(
    ordinaryLocomotionCandidates(context, style)
      .filter((candidate): candidate is Extract<CombatDecision, { type: 'locomotion' }> => candidate.type === 'locomotion')
      .map((candidate) => candidate.locomotionIntent),
  )

  if (state !== 'within') {
    const priority = state === 'above' ? FORWARD_FALLBACK_PRIORITY : BACKWARD_FALLBACK_PRIORITY
    for (const intent of priority) {
      if (legalLocomotion.has(intent)) return { type: 'locomotion', locomotionIntent: intent }
    }
  }

  return { type: 'locomotion', locomotionIntent: 'hold-range' }
}

function selectProportionally(scored: readonly ScoredCombatDecision[], selectionRoll: number): CombatDecision {
  const total = scored.reduce((sum, candidate) => sum + candidate.weight, 0)
  let threshold = selectionRoll * total
  for (const candidate of scored) {
    threshold -= candidate.weight
    if (threshold < 0) return candidate.decision
  }
  return scored[scored.length - 1].decision
}

/**
 * Consumes `rolls.selection` to choose among `scoreCombatCandidates`'
 * positive-weight output proportionally, or applies the deterministic
 * fallback when that list is empty. `rolls.interval` is accepted (not used
 * by this function) purely so the caller can draw both decision-stream
 * values as a single pair (`drawPair`) and pass `rolls.interval` on
 * separately to `decisionIntervalTicks`, keeping the "exactly two
 * decision-stream values per ordinary decision" contract without this
 * function needing to also compute `nextDecisionTick`.
 */
export function chooseCombatDecision(
  context: CombatDecisionContext,
  style: CombatStyleDefinition,
  rolls: { selection: number; interval: number },
  modifiers: readonly DecisionModifier[] = [],
): CombatDecision {
  void rolls.interval
  const scored = scoreCombatCandidates(context, style, modifiers)
  if (scored.length === 0) return deterministicFallbackDecision(context, style)
  return selectProportionally(scored, rolls.selection)
}

const DECISION_INTERVAL_RANGES: Readonly<Record<Archetype, { min: number; max: number }>> = {
  heavy: { min: 20, max: 42 },
  fast: { min: 12, max: 30 },
  technical: { min: 18, max: 36 },
}

/**
 * Maps `intervalRoll` (`[0, 1)`) onto the archetype's inclusive tick range
 * via `min + floor(roll * width)`, `width = max - min + 1`. This reaches
 * both endpoints: `roll = 0` gives `min` exactly, and `roll` approaching `1`
 * gives `floor` values up to `width - 1`, i.e. `max`. The extra `Math.min`
 * clamp is a defensive guard against a `roll` of exactly `1`, which
 * `nextRandom` never actually produces.
 */
export function decisionIntervalTicks(archetype: Archetype, intervalRoll: number): number {
  const { min, max } = DECISION_INTERVAL_RANGES[archetype]
  const width = max - min + 1
  const offset = Math.min(width - 1, Math.floor(intervalRoll * width))
  return min + offset
}

// ---------------------------------------------------------------------------
// Forced behavior (bypasses weighted selection entirely)
//
// These are pure threshold predicates over caller-supplied numbers rather
// than over `FighterCombatState` directly: this task's file list does not
// include `encounter.ts`, so no new persistent "forced disengage start
// tick" field can be added to `FighterCombatState` here. Task 8 owns
// tracking whatever tick/state it needs and calls these with the derived
// distance/tick-elapsed values.
// ---------------------------------------------------------------------------

/** Fast's forced disengage (after a burst-lunge recovery) ends at this range... */
export const FAST_FORCED_DISENGAGE_END_RANGE = 2.4
/** ...or after this many ticks, whichever comes first. */
export const FAST_FORCED_DISENGAGE_MAX_TICKS = 30

export function hasFastForcedDisengageEnded(distanceToTarget: number, ticksSinceForced: number): boolean {
  return distanceToTarget <= FAST_FORCED_DISENGAGE_END_RANGE || ticksSinceForced >= FAST_FORCED_DISENGAGE_MAX_TICKS
}

/** Technical's forced parry-counter begins on the next tick only within this range. */
export const TECHNICAL_FORCED_COUNTER_RANGE = 2.3

/**
 * Returns `'technical-parry-counter'` when the target remains within
 * `TECHNICAL_FORCED_COUNTER_RANGE` units, otherwise `undefined` -- clearing
 * the forced action so Technical returns to ordinary weighted selection.
 */
export function resolveForcedParryCounterStart(distanceToTarget: number): AttackActionId | undefined {
  return distanceToTarget <= TECHNICAL_FORCED_COUNTER_RANGE ? 'technical-parry-counter' : undefined
}

// ---------------------------------------------------------------------------
// Defense reactions
// ---------------------------------------------------------------------------

/**
 * `true` exactly when `currentTick` is this defense's one reaction
 * opportunity for an attack whose contact lands on `contactTick`.
 */
export function isDefenseReactionOpportunity(defense: Readonly<DefenseActionDefinition>, currentTick: number, contactTick: number): boolean {
  return contactTick - currentTick === defense.minimumReactionLeadTicks
}

function telegraphBonus(windupTicks: number): number {
  if (windupTicks <= 14) return 0
  if (windupTicks <= 24) return 0.05
  return 0.1
}

/**
 * `clamp(defenseChance + comparisonModifier + telegraphBonus(windupTicks), 0, 0.95)`.
 * `comparison` is the defender's own matchup toward the attacker
 * (`+0.05`/`0`/`-0.05`); telegraph is `0` for windup `<=14`, `+0.05` for
 * `15..24`, `+0.10` for `>=25`.
 */
export function effectiveDefenseChance(defenseChance: number, comparison: MatchupComparison, windupTicks: number): number {
  const comparisonModifier = comparison === 'advantage' ? 0.05 : comparison === 'disadvantage' ? -0.05 : 0
  return clamp(defenseChance + comparisonModifier + telegraphBonus(windupTicks), 0, 0.95)
}

function canDefenseAnswerTags(defenseActionId: string, tags: readonly string[]): boolean {
  if (defenseActionId === 'technical-parry') return tags.includes('parryable')
  return true
}

export interface IncomingThreat {
  attackerId: CombatantId
  actionInstanceId: ActionInstanceId
  actionId: AttackActionId
  contactTick: number
}

/**
 * Payload shape for the two event variants `processDefenseBatch` can emit --
 * `EncounterEvent` minus `id`, since this pure function allocates no event
 * IDs and mutates no encounter state; Task 8 allocates the id and applies
 * the returned `defender`/`random`.
 */
export type EncounterEventPayload = Omit<DefenseStartedEvent, 'id'> | Omit<DefenseDeclinedEvent, 'id'>

export interface DefenseBatchResult {
  defender: FighterCombatState
  random: RandomState
  events: readonly EncounterEventPayload[]
}

export interface ProcessDefenseBatchInput {
  tick: number
  defender: FighterCombatState
  threats: readonly IncomingThreat[]
  random: RandomState
  combatants: Readonly<Record<CombatantId, FighterCombatState>>
  combatStyles: CombatStyleCatalog
}

interface ThreatSortKey {
  threat: IncomingThreat
  contactTick: number
  priorityRank: 0 | 1 // 0 = committed/counter, 1 = probe (or otherwise untagged)
  powerScore: number
}

function buildThreatSortKey(threat: IncomingThreat, input: Readonly<ProcessDefenseBatchInput>): ThreatSortKey {
  const attacker = input.combatants[threat.attackerId]
  const action = input.combatStyles.attacks[threat.actionId]
  const isPriority = action.tags.includes('committed') || action.tags.includes('counter')
  return {
    threat,
    contactTick: threat.contactTick,
    priorityRank: isPriority ? 0 : 1,
    powerScore: attacker.definition.power * action.damageMultiplier,
  }
}

function compareThreatSortKeys(a: ThreatSortKey, b: ThreatSortKey): number {
  if (a.contactTick !== b.contactTick) return a.contactTick - b.contactTick
  if (a.priorityRank !== b.priorityRank) return a.priorityRank - b.priorityRank
  if (a.powerScore !== b.powerScore) return b.powerScore - a.powerScore // descending
  const aId = a.threat.actionInstanceId
  const bId = b.threat.actionInstanceId
  return aId < bId ? -1 : aId > bId ? 1 : 0
}

/**
 * Gathers one defender's reaction opportunities for the tick (already
 * pre-filtered by the caller to those whose `contactTick - tick` matches
 * this defender's style lead, via `isDefenseReactionOpportunity`), sorts
 * them by earlier `contactTick`, then committed/counter before probe, then
 * descending `attacker.power x action.damageMultiplier`, then
 * `ActionInstanceId`. Consumes exactly two defense-stream values
 * (`success`, `direction`) for *every* opportunity in that order --
 * including ineligible ones -- and records a `ReactionRecord` for each.
 *
 * Eligibility (`defender.status === 'active'`, `action.type === 'neutral'`,
 * not staggered, and the style's tag restriction) is evaluated against the
 * *current* defender snapshot, which is only ever updated by this same loop
 * scheduling a defense: once one opportunity schedules the defender's
 * single action slot, every later opportunity in this batch is naturally
 * ineligible (busy) regardless of its own roll, without needing a separate
 * flag. An eligible opportunity whose roll fails emits `defense-declined`;
 * ineligible opportunities are ledger-only. Does not mutate encounter state
 * or allocate event ids.
 */
export function processDefenseBatch(input: Readonly<ProcessDefenseBatchInput>): DefenseBatchResult {
  const sorted = [...input.threats].map((threat) => buildThreatSortKey(threat, input)).sort(compareThreatSortKeys)

  let defender = input.defender
  let random = input.random
  const events: EncounterEventPayload[] = []
  const newRecords: ReactionRecord[] = []

  const style = input.combatStyles.styles[defender.definition.archetype]
  const defenseActionId = style.defenseActionId

  for (const { threat } of sorted) {
    const [successRoll, afterSuccess] = nextRandom(random)
    const [directionRoll, afterDirection] = nextRandom(afterSuccess)
    random = afterDirection

    const attacker = input.combatants[threat.attackerId]
    const action = input.combatStyles.attacks[threat.actionId]

    const stillOpen = defender.status === 'active' && defender.action.type === 'neutral' && defender.staggerUntilTick <= input.tick
    const tagOk = canDefenseAnswerTags(defenseActionId, action.tags)
    const eligible = stillOpen && tagOk

    if (!eligible) {
      newRecords.push({ incomingActionId: threat.actionInstanceId, outcome: 'ineligible' })
      continue
    }

    const comparison = compareArchetypes(defender.definition.archetype, attacker.definition.archetype)
    const chance = effectiveDefenseChance(defender.definition.defenseChance, comparison, action.windupTicks)

    if (successRoll < chance) {
      const serial = defender.nextActionSerial
      defender = {
        ...defender,
        nextActionSerial: serial + 1,
        action: startDefenseAction({
          defenderId: defender.id,
          serial,
          attackerId: threat.attackerId,
          defenseActionId,
          reactingToActionId: threat.actionInstanceId,
          tick: input.tick,
          contactTick: threat.contactTick,
          directionRoll,
        }),
      }
      newRecords.push({ incomingActionId: threat.actionInstanceId, outcome: 'scheduled' })
      events.push({
        type: 'defense-started',
        tick: input.tick,
        defenderId: defender.id,
        attackerId: threat.attackerId,
        incomingActionId: threat.actionInstanceId,
        defenseActionId,
        expectedContactTick: threat.contactTick,
      })
    } else {
      newRecords.push({ incomingActionId: threat.actionInstanceId, outcome: 'failed' })
      events.push({
        type: 'defense-declined',
        tick: input.tick,
        defenderId: defender.id,
        attackerId: threat.attackerId,
        incomingActionId: threat.actionInstanceId,
        defenseActionId,
        expectedContactTick: threat.contactTick,
      })
    }
  }

  return {
    defender: { ...defender, reactionLedger: [...defender.reactionLedger, ...newRecords] },
    random,
    events,
  }
}
