// Action/style contracts, phase machinery, and catalog validation.
//
// This module owns:
// - The action ID unions and the `AttackActionDefinition` / `DefenseActionDefinition`
//   / `CombatStyleDefinition` / `CombatStyleCatalog` content shapes.
// - `CombatActionState` and `ReactionRecord`, the per-combatant action bookkeeping.
// - Phase-transition machinery (`startAttackAction`, `transitionActionPhase`,
//   `actionContactTick`) using exclusive `phaseEndsAtTick`; contact always
//   lasts exactly one tick.
// - Contact math shared by future contact resolution: semantic zone contact
//   points and the final damage-rounding formula.
// - `validateCombatStyleCatalog`, the one entry point that proves an authored
//   `CombatStyleCatalog` is internally consistent and compatible with a given
//   arena, in the same throwing style as `fighters.ts`'s `validateFighterDefinition`.
//
// This module never imports `src/content`: it receives all authored data
// (a `CombatStyleCatalog`) by parameter. `src/content/combatStyles.ts` is the
// only place that constructs one.

import type { Archetype } from './fighters'
import type { CombatArenaDefinition, LocomotionIntent, LocomotionProfile, Vec2 } from './movement'

export type AttackActionId =
  | 'heavy-shield-jab'
  | 'heavy-cleave'
  | 'fast-slash'
  | 'fast-burst-lunge'
  | 'technical-thrust'
  | 'technical-driving-thrust'
  | 'technical-parry-counter'

export type DefenseActionId = 'heavy-guard' | 'fast-evade' | 'technical-parry'

export type CombatActionId = AttackActionId | DefenseActionId

export type CombatActionPhase = 'windup' | 'contact' | 'impact' | 'recovery'

export interface AttackActionDefinition {
  id: AttackActionId
  tags: readonly string[]
  contactRange: Readonly<{ min: number; max: number }>
  startMaxRange?: number
  minimumFacingDot: number
  windupTicks: number
  impactTicks: number
  recoveryTicks: number
  damageMultiplier: number
  accuracyModifier: number
  rootTravel: number
  pushDistance: number
  staggerTicks: number
  contactPriority: number
}

export interface DefenseActionDefinition {
  id: DefenseActionId
  tags: readonly ['defense']
  minimumReactionLeadTicks: number
  impactTicks: number
  recoveryTicks: number
  minimumIncomingFacingDot?: number
  evadeDisplacement?: Readonly<{ min: number; max: number }>
}

export interface CombatStyleDefinition {
  archetype: Archetype
  locomotion: Readonly<LocomotionProfile>
  preferredRange: Readonly<{ min: number; max: number }>
  attackActionIds: readonly AttackActionId[]
  defenseActionId: DefenseActionId
  baseWeights: Readonly<Partial<Record<LocomotionIntent | AttackActionId, number>>>
}

export interface CombatStyleCatalog {
  styles: Readonly<Record<Archetype, CombatStyleDefinition>>
  attacks: Readonly<Record<AttackActionId, AttackActionDefinition>>
  defenses: Readonly<Record<DefenseActionId, DefenseActionDefinition>>
}

export type CombatActionState =
  | { type: 'neutral' }
  | {
      type: 'active'
      instanceId: string
      definitionId: CombatActionId
      phase: CombatActionPhase
      phaseStartedTick: number
      phaseEndsAtTick: number
      targetId: string
      reactingToActionId?: string
      attackRolls?: { accuracy: number; critical: number }
      // Only ever set by `startDefenseAction`, mirroring `attackRolls` for
      // attacks: the reaction's consumed `direction` stream value, preserved
      // so a later contact-resolution task can derive Fast evade's ranked
      // direction/displacement without re-drawing (and thereby desyncing)
      // the defense stream.
      defenseRoll?: { direction: number }
    }

export interface ReactionRecord {
  incomingActionId: string
  outcome: 'scheduled' | 'failed' | 'ineligible'
}

// ---------------------------------------------------------------------------
// Action lookup
// ---------------------------------------------------------------------------

export function getAttackActionDefinition(catalog: CombatStyleCatalog, id: AttackActionId): AttackActionDefinition {
  return catalog.attacks[id]
}

export function getDefenseActionDefinition(catalog: CombatStyleCatalog, id: DefenseActionId): DefenseActionDefinition {
  return catalog.defenses[id]
}

// ---------------------------------------------------------------------------
// Phase machinery
// ---------------------------------------------------------------------------

export interface StartAttackActionParams {
  actorId: string
  serial: number
  targetId: string
  definition: AttackActionDefinition
  tick: number
  attackRolls: { accuracy: number; critical: number }
}

/**
 * Starts an attack in its `windup` phase. `phaseEndsAtTick` is exclusive: a
 * windup started on `tick` with `windupTicks = W` occupies ticks
 * `tick..tick+W-1`, so contact begins on `tick + W`.
 */
export function startAttackAction(params: StartAttackActionParams): CombatActionState {
  return {
    type: 'active',
    instanceId: `${params.actorId}:${params.serial}`,
    definitionId: params.definition.id,
    phase: 'windup',
    phaseStartedTick: params.tick,
    phaseEndsAtTick: params.tick + params.definition.windupTicks,
    targetId: params.targetId,
    attackRolls: params.attackRolls,
  }
}

export interface StartDefenseActionParams {
  defenderId: string
  serial: number
  attackerId: string
  defenseActionId: DefenseActionId
  reactingToActionId: string
  tick: number
  contactTick: number
  directionRoll: number
}

/**
 * Starts a defense in its `windup` phase with a *dynamic* windup: unlike
 * `startAttackAction` (whose `windupTicks` is a fixed catalog value), a
 * scheduled reaction's windup ends exactly on `contactTick` so its contact
 * aligns with the incoming attack it answers (`processDefenseBatch` in
 * `combatDecision.ts` only ever calls this once the reaction lead has
 * already confirmed `contactTick` is reachable). `targetId` holds the
 * attacker being reacted to; `reactingToActionId` binds the defense to that
 * specific incoming action so a later cancellation can find it.
 */
export function startDefenseAction(params: StartDefenseActionParams): CombatActionState {
  return {
    type: 'active',
    instanceId: `${params.defenderId}:${params.serial}`,
    definitionId: params.defenseActionId,
    phase: 'windup',
    phaseStartedTick: params.tick,
    phaseEndsAtTick: params.contactTick,
    targetId: params.attackerId,
    reactingToActionId: params.reactingToActionId,
    defenseRoll: { direction: params.directionRoll },
  }
}

/**
 * Advances an active action to its next phase as of `tick`, which must equal
 * the action's current `phaseEndsAtTick`. `windup -> contact` always takes
 * exactly one tick and needs no definition. `contact -> impact` and
 * `impact -> recovery` need `definition.impactTicks`/`recoveryTicks`
 * (present on both attack and defense definitions). `recovery` returns the
 * action to `neutral`.
 */
export function transitionActionPhase(
  action: CombatActionState,
  tick: number,
  definition?: Readonly<{ impactTicks: number; recoveryTicks: number }>,
): CombatActionState {
  if (action.type !== 'active') {
    throw new Error('transitionActionPhase requires an active action')
  }

  switch (action.phase) {
    case 'windup':
      return { ...action, phase: 'contact', phaseStartedTick: tick, phaseEndsAtTick: tick + 1 }
    case 'contact': {
      const impactTicks = requirePhaseDefinition(definition).impactTicks
      return { ...action, phase: 'impact', phaseStartedTick: tick, phaseEndsAtTick: tick + impactTicks }
    }
    case 'impact': {
      const recoveryTicks = requirePhaseDefinition(definition).recoveryTicks
      return { ...action, phase: 'recovery', phaseStartedTick: tick, phaseEndsAtTick: tick + recoveryTicks }
    }
    case 'recovery':
      return { type: 'neutral' }
  }
}

function requirePhaseDefinition(
  definition: Readonly<{ impactTicks: number; recoveryTicks: number }> | undefined,
): Readonly<{ impactTicks: number; recoveryTicks: number }> {
  if (!definition) {
    throw new Error('transitionActionPhase requires a definition to leave contact or impact')
  }
  return definition
}

export interface StaggerActionEffect {
  action: CombatActionState
  interrupted: boolean
}

/**
 * Non-lethal stagger's exact effect on `action`, from design.md's stagger
 * phase-matrix table (the "Attack outcome"/"Defense outcome" columns are
 * identical in every row, so one function covers both, keyed only on
 * `action.phase`):
 *
 * - `neutral` (`action.type !== 'active'`): nothing to interrupt --
 *   `interrupted: false`, `action` unchanged. Clearing a queued forced
 *   action (the table's other "neutral" trigger) is a `FighterCombatState`-
 *   level concern (`forcedActionId`) this action-only function cannot see;
 *   the caller clears it separately, every time stagger applies, regardless
 *   of phase.
 * - one-tick `contact`: exempt *this* tick -- the contact already resolved
 *   against the frozen snapshot, unaffected by a stagger landing during the
 *   very same batch -- so `interrupted: false`, `action` unchanged. The
 *   design's "then clear the action" is deferred by exactly one tick: the
 *   caller's phase-1 phase machine (`transitionExpiredPhases` in
 *   `encounter.ts`) is what silently forces this action to `neutral` on the
 *   *following* tick, once `staggerUntilTick` proves the fighter is still
 *   stagger-owned, instead of letting it advance to `impact` on schedule.
 * - `windup`, `impact`, `recovery`: cancelled immediately -- `action:
 *   { type: 'neutral' }`, `interrupted: true`, telling the caller to emit
 *   `action-interrupted` with reason `'stagger'`.
 */
export function applyStaggerToAction(action: CombatActionState): StaggerActionEffect {
  if (action.type !== 'active' || action.phase === 'contact') {
    return { action, interrupted: false }
  }
  return { action: { type: 'neutral' }, interrupted: true }
}

/**
 * The tick contact occurs on for an action currently in `windup` (its
 * `phaseEndsAtTick`, since contact begins the instant windup ends) or already
 * in `contact` (its `phaseStartedTick`, the current tick).
 */
export function actionContactTick(action: CombatActionState): number {
  if (action.type !== 'active') {
    throw new Error('actionContactTick requires an active action')
  }
  if (action.phase === 'windup') return action.phaseEndsAtTick
  if (action.phase === 'contact') return action.phaseStartedTick
  throw new Error(`actionContactTick requires an action in windup or contact, got ${action.phase}`)
}

// ---------------------------------------------------------------------------
// Contact math
// ---------------------------------------------------------------------------

export type ContactZone = 'weapon' | 'shield' | 'body'

const CONTACT_ZONE_RATIOS: Readonly<Record<ContactZone, number>> = {
  weapon: 0.60,
  shield: 0.65,
  body: 0.72,
}

const CONTACT_EPSILON = 1e-9

/**
 * The semantic root-plane contact point: from snapshotted roots,
 * `towardTarget = normalize(target.position - actor.position)`, `distance`
 * is their separation, and the point is
 * `actor.position + towardTarget * distance * zoneRatio`. Coincident roots
 * (distance ~0) fall back to `actorFacing` instead of an arbitrary direction;
 * the result then degenerates to `actor.position` since `distance` is ~0.
 */
export function calculateContactPoint(
  actorPosition: Readonly<Vec2>,
  targetPosition: Readonly<Vec2>,
  actorFacing: Readonly<Vec2>,
  zone: ContactZone,
): Vec2 {
  const dx = targetPosition.x - actorPosition.x
  const dz = targetPosition.z - actorPosition.z
  const distance = Math.sqrt(dx * dx + dz * dz)
  const towardTarget = distance > CONTACT_EPSILON ? { x: dx / distance, z: dz / distance } : actorFacing
  const ratio = CONTACT_ZONE_RATIOS[zone]

  return {
    x: actorPosition.x + towardTarget.x * distance * ratio,
    z: actorPosition.z + towardTarget.z * distance * ratio,
  }
}

/**
 * The common final damage-rounding formula:
 * `max(1, round(power * damageMultiplier * comparisonMultiplier * criticalMultiplier * blockMultiplier))`.
 * Block and critical are mutually exclusive; callers pass `1` for whichever
 * does not apply.
 */
export function calculateContactDamage(
  power: number,
  damageMultiplier: number,
  comparisonMultiplier: number,
  criticalMultiplier: number,
  blockMultiplier: number,
): number {
  return Math.max(
    1,
    Math.round(power * damageMultiplier * comparisonMultiplier * criticalMultiplier * blockMultiplier),
  )
}

// ---------------------------------------------------------------------------
// Contact resolution constants and pure geometry/multiplier helpers
//
// These back Task 9's contact resolution (`encounter.ts`'s stateful phase
// 9/10 wiring, which owns `FighterCombatState`/`EncounterEvent` and so
// cannot live in this file without a circular type dependency). Everything
// here is pure Vec2/number math with no encounter-state coupling, matching
// this file's existing `calculateContactPoint`/`calculateContactDamage`.
// ---------------------------------------------------------------------------

/** Heavy guard's damage/push/stagger attenuation (design.md's "Heavy guard" section). */
export const GUARD_DAMAGE_MULTIPLIER = 0.35
export const GUARD_PUSH_MULTIPLIER = 0.30
export const GUARD_STAGGER_MULTIPLIER = 0.40

/** Critical multiplies damage by this factor; block and critical are mutually exclusive. */
export const CRITICAL_DAMAGE_MULTIPLIER = 1.5

/** Fixed stagger a successful parry applies to the attacker (design.md's "Technical parry" section). */
export const PARRY_ATTACKER_STAGGER_TICKS = 24

/** `Math.max(1, Math.round(baseStaggerTicks * GUARD_STAGGER_MULTIPLIER))`, the explicit integer rounding design.md specifies for a blocked hit's stagger duration. */
export function calculateBlockedStaggerTicks(baseStaggerTicks: number): number {
  return Math.max(1, Math.round(baseStaggerTicks * GUARD_STAGGER_MULTIPLIER))
}

/**
 * `true` when `targetPosition` is within `[contactRange.min, contactRange.max]`
 * of `actorPosition` *and* within `actorFacing`'s minimum-dot sector toward
 * it. Coincident roots (distance ~0) are treated as directly in front,
 * matching `calculateContactPoint`'s own degenerate-distance convention.
 * Shared by ordinary attack geometry misses and a bound Fast evade's
 * success check (both ask the identical geometric question against the
 * contact snapshot).
 */
export function isWithinAttackGeometry(
  actorPosition: Readonly<Vec2>,
  actorFacing: Readonly<Vec2>,
  targetPosition: Readonly<Vec2>,
  contactRange: Readonly<{ min: number; max: number }>,
  minimumFacingDot: number,
): boolean {
  const dx = targetPosition.x - actorPosition.x
  const dz = targetPosition.z - actorPosition.z
  const distance = Math.sqrt(dx * dx + dz * dz)
  if (distance < contactRange.min || distance > contactRange.max) return false
  if (distance <= CONTACT_EPSILON) return true
  const dot = (actorFacing.x * dx + actorFacing.z * dz) / distance
  return dot >= minimumFacingDot
}

/**
 * `true` when the attacker at `attackerPosition` falls within the
 * defender's incoming-facing arc: `dot(defenderFacing,
 * normalize(attackerPosition - defenderPosition)) >= minimumIncomingFacingDot`.
 * Backs Heavy guard's and Technical parry's defender-facing gate; Fast evade
 * has no facing gate and never calls this. Coincident roots default to
 * "within arc" (no meaningful direction to fail against).
 */
export function isWithinIncomingFacingArc(
  defenderFacing: Readonly<Vec2>,
  defenderPosition: Readonly<Vec2>,
  attackerPosition: Readonly<Vec2>,
  minimumIncomingFacingDot: number,
): boolean {
  const dx = attackerPosition.x - defenderPosition.x
  const dz = attackerPosition.z - defenderPosition.z
  const distance = Math.sqrt(dx * dx + dz * dz)
  if (distance <= CONTACT_EPSILON) return true
  const dot = (defenderFacing.x * dx + defenderFacing.z * dz) / distance
  return dot >= minimumIncomingFacingDot
}

/**
 * The unit direction a hit pushes its target: away from the actor along the
 * snapshot line between roots, falling back to `actorFacing` for coincident
 * roots -- the same convention `calculateContactPoint` uses. Also doubles as
 * the `direction` payload for `fighter-staggered` (a stagger's direction is
 * always "away from whoever caused it").
 */
export function calculatePushDirection(actorPosition: Readonly<Vec2>, targetPosition: Readonly<Vec2>, actorFacing: Readonly<Vec2>): Vec2 {
  const dx = targetPosition.x - actorPosition.x
  const dz = targetPosition.z - actorPosition.z
  const distance = Math.sqrt(dx * dx + dz * dz)
  if (distance <= CONTACT_EPSILON) return { ...actorFacing }
  return { x: dx / distance, z: dz / distance }
}

/** Fast evade's authored defense-dash total distance: `0.9 + 0.3 * directionRoll`, read back from `CombatActionState.defenseRoll.direction` and never re-drawn. */
export function calculateEvadeDisplacementDistance(directionRoll: number): number {
  return 0.9 + 0.3 * directionRoll
}

export type EvadeDirection = 'circle-left' | 'circle-right' | 'backstep'

/**
 * Ranks Fast evade's three candidate directions from the same `directionRoll`
 * that also picks the dash distance, splitting `[0,1)` into equal thirds.
 * `selectEvadeDirection` below walks this order to implement design.md's
 * "blocked directions fall through in that deterministic order."
 */
export function rankEvadeDirections(directionRoll: number): readonly EvadeDirection[] {
  if (directionRoll < 1 / 3) return ['circle-left', 'circle-right', 'backstep']
  if (directionRoll < 2 / 3) return ['circle-right', 'circle-left', 'backstep']
  return ['backstep', 'circle-left', 'circle-right']
}

/**
 * The unit displacement direction for one of Fast evade's three ranked
 * intents, relative to `facing`: `circle-left`/`circle-right` are the left/
 * right perpendiculars (matching `movement.ts`'s private
 * `leftPerpendicular`/`rightPerpendicular` convention exactly, duplicated
 * here since `movement.ts` exports neither), `backstep` is the negated
 * facing. `+0` normalizes any `-0` result, matching `movement.ts`'s own
 * `scaleVec2` idiom.
 */
export function evadeDirectionVector(intent: EvadeDirection, facing: Readonly<Vec2>): Vec2 {
  switch (intent) {
    case 'circle-left':
      return { x: -facing.z + 0, z: facing.x + 0 }
    case 'circle-right':
      return { x: facing.z + 0, z: -facing.x + 0 }
    case 'backstep':
      return { x: -facing.x + 0, z: -facing.z + 0 }
  }
}

/**
 * `true` when `position` already satisfies the arena's walkable bounds (the
 * lateral band `z ∈ [-lateralLimit, lateralLimit]` and the `radius` disk
 * around the origin) with no correction needed -- i.e. `movement.ts`'s
 * private `clampToArena` would return it unchanged. Duplicated here (like
 * `evadeDirectionVector`'s perpendiculars, above) since `movement.ts` exports
 * neither `clampToArena` nor an arena-membership check and this file cannot
 * reach a private function across the module boundary.
 */
function isInsideArenaBounds(position: Readonly<Vec2>, arena: Readonly<CombatArenaDefinition>): boolean {
  if (position.z < -arena.lateralLimit || position.z > arena.lateralLimit) return false
  return Math.sqrt(position.x * position.x + position.z * position.z) <= arena.radius
}

/**
 * Picks the first of Fast evade's three ranked directions (design.md's Fast
 * evade section: "blocked directions fall through in that deterministic
 * order") whose full authored dash distance, projected from `position` in
 * that direction, would still land inside the arena's walkable bounds.
 * `undefined` when the arena boundary blocks all three -- design.md's "If
 * arena boundaries prevent all ranked displacements from leaving the contact
 * geometry, the evade is visibly attempted, `defense-failed` emits with
 * reason `geometry`" then falls out naturally: zero displacement leaves the
 * defender's position (and therefore contact geometry) unchanged, so the
 * ordinary geometry check in `encounter.ts`'s contact resolution reports the
 * same outcome it would for any other still-in-range defender.
 *
 * A pure function of its inputs, so every call site -- the live windup
 * displacement computed fresh each tick from the defender's *current*
 * position, and the `attack-evaded`/`defense-failed` event's `evadeIntent`
 * label recomputed once more from the resolved contact snapshot -- agrees by
 * construction without needing to persist which direction "won" anywhere in
 * `CombatActionState`.
 */
export function selectEvadeDirection(
  directionRoll: number,
  facing: Readonly<Vec2>,
  position: Readonly<Vec2>,
  totalDistance: number,
  arena: Readonly<CombatArenaDefinition>,
): EvadeDirection | undefined {
  for (const candidate of rankEvadeDirections(directionRoll)) {
    const direction = evadeDirectionVector(candidate, facing)
    const endpoint = { x: position.x + direction.x * totalDistance, z: position.z + direction.z * totalDistance }
    if (isInsideArenaBounds(endpoint, arena)) return candidate
  }
  return undefined
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

// Runtime-enumerable mirrors of the `LocomotionIntent`/`AttackActionId`/
// `DefenseActionId`/`Archetype` unions. TypeScript unions have no runtime
// representation, so validation needs an explicit set; the `Record<X, true>`
// shape is a compile-time proof that this list stays exhaustive over its
// source union — an editor to either without updating the other fails to
// compile.
const LOCOMOTION_INTENT_SET: Readonly<Record<LocomotionIntent, true>> = {
  'hold-range': true,
  advance: true,
  retreat: true,
  'circle-left': true,
  'circle-right': true,
  'burst-in': true,
  backstep: true,
  disengage: true,
  pressure: true,
}

const ATTACK_ACTION_ID_SET: Readonly<Record<AttackActionId, true>> = {
  'heavy-shield-jab': true,
  'heavy-cleave': true,
  'fast-slash': true,
  'fast-burst-lunge': true,
  'technical-thrust': true,
  'technical-driving-thrust': true,
  'technical-parry-counter': true,
}

const DEFENSE_ACTION_ID_SET: Readonly<Record<DefenseActionId, true>> = {
  'heavy-guard': true,
  'fast-evade': true,
  'technical-parry': true,
}

const ARCHETYPE_SET: Readonly<Record<Archetype, true>> = {
  heavy: true,
  fast: true,
  technical: true,
}

const ATTACK_ACTION_IDS = Object.keys(ATTACK_ACTION_ID_SET) as AttackActionId[]
const DEFENSE_ACTION_IDS = Object.keys(DEFENSE_ACTION_ID_SET) as DefenseActionId[]
const ARCHETYPES = Object.keys(ARCHETYPE_SET) as Archetype[]

const TURN_UNIT_LENGTH_EPSILON = 1e-6

/**
 * Validates that `catalog` is internally consistent and compatible with
 * `arena`, returning the exact same `catalog` instance (`toBe`, not
 * `toEqual`) when valid. Throws an `Error` whose message names the offending
 * field when invalid, matching `validateFighterDefinition`'s style.
 */
export function validateCombatStyleCatalog(
  catalog: CombatStyleCatalog,
  arena: Readonly<CombatArenaDefinition>,
): CombatStyleCatalog {
  requireExactKeys(catalog.attacks, ATTACK_ACTION_ID_SET, 'attacks')
  requireExactKeys(catalog.defenses, DEFENSE_ACTION_ID_SET, 'defenses')
  requireExactKeys(catalog.styles, ARCHETYPE_SET, 'styles')

  for (const id of DEFENSE_ACTION_IDS) {
    validateDefenseActionDefinition(catalog.defenses[id], id)
  }
  for (const id of ATTACK_ACTION_IDS) {
    validateAttackActionDefinition(catalog.attacks[id], id, arena, catalog)
  }
  for (const archetype of ARCHETYPES) {
    validateCombatStyleDefinition(catalog.styles[archetype], archetype, catalog)
  }

  return catalog
}

function requireExactKeys<K extends string>(
  record: Readonly<Record<string, unknown>>,
  expected: Readonly<Record<K, true>>,
  label: string,
): void {
  const expectedKeys = Object.keys(expected)
  const actualKeys = Object.keys(record)
  if (actualKeys.length !== expectedKeys.length) {
    throw new Error(`CombatStyleCatalog ${label} must have exactly the keys ${expectedKeys.join(', ')}`)
  }
  for (const key of expectedKeys) {
    if (!(key in record)) {
      throw new Error(`CombatStyleCatalog ${label} is missing required key '${key}'`)
    }
  }
}

function validateAttackActionDefinition(
  definition: AttackActionDefinition,
  id: AttackActionId,
  arena: Readonly<CombatArenaDefinition>,
  catalog: CombatStyleCatalog,
): void {
  const field = (name: string) => `attacks.${id}.${name}`

  if (definition.id !== id) {
    throw new Error(`CombatStyleCatalog ${field('id')} must equal its catalog key`)
  }
  if (!Array.isArray(definition.tags) || definition.tags.length === 0) {
    throw new Error(`CombatStyleCatalog ${field('tags')} must be a non-empty array`)
  }

  requireOrderedRange(definition.contactRange, field('contactRange'))
  if (definition.contactRange.min < arena.minimumSeparation) {
    throw new Error(`CombatStyleCatalog ${field('contactRange.min')} must be >= arena.minimumSeparation`)
  }

  if (definition.tags.includes('burst') && definition.startMaxRange === undefined) {
    throw new Error(`CombatStyleCatalog ${field('startMaxRange')} must be defined for a burst attack`)
  }
  if (definition.startMaxRange !== undefined) {
    requireFiniteNonNegative(definition.startMaxRange, field('startMaxRange'))
    if (definition.startMaxRange < definition.contactRange.max) {
      throw new Error(`CombatStyleCatalog ${field('startMaxRange')} must be >= contactRange.max`)
    }
  }

  requireDotRange(definition.minimumFacingDot, field('minimumFacingDot'))

  requirePositiveInteger(definition.windupTicks, field('windupTicks'))
  requirePositiveInteger(definition.impactTicks, field('impactTicks'))
  requirePositiveInteger(definition.recoveryTicks, field('recoveryTicks'))
  requirePositiveInteger(definition.staggerTicks, field('staggerTicks'))
  requirePositiveInteger(definition.contactPriority, field('contactPriority'))

  requireFiniteNonNegative(definition.damageMultiplier, field('damageMultiplier'))
  requireFiniteNonNegative(definition.rootTravel, field('rootTravel'))
  requireFiniteNonNegative(definition.pushDistance, field('pushDistance'))
  requireFinite(definition.accuracyModifier, field('accuracyModifier'))

  if (definition.tags.includes('parryable')) {
    const parryLead = catalog.defenses['technical-parry'].minimumReactionLeadTicks
    if (definition.windupTicks < parryLead) {
      throw new Error(
        `CombatStyleCatalog ${field('windupTicks')} must be >= technical-parry minimumReactionLeadTicks for a parryable attack`,
      )
    }
  }
}

function validateDefenseActionDefinition(definition: DefenseActionDefinition, id: DefenseActionId): void {
  const field = (name: string) => `defenses.${id}.${name}`

  if (definition.id !== id) {
    throw new Error(`CombatStyleCatalog ${field('id')} must equal its catalog key`)
  }
  if (definition.tags.length !== 1 || definition.tags[0] !== 'defense') {
    throw new Error(`CombatStyleCatalog ${field('tags')} must be exactly ['defense']`)
  }

  requirePositiveInteger(definition.minimumReactionLeadTicks, field('minimumReactionLeadTicks'))
  requirePositiveInteger(definition.impactTicks, field('impactTicks'))
  requirePositiveInteger(definition.recoveryTicks, field('recoveryTicks'))

  if (definition.minimumIncomingFacingDot !== undefined) {
    requireDotRange(definition.minimumIncomingFacingDot, field('minimumIncomingFacingDot'))
  }

  if (id === 'fast-evade') {
    if (!definition.evadeDisplacement) {
      throw new Error(`CombatStyleCatalog ${field('evadeDisplacement')} must be defined for fast-evade`)
    }
    requireOrderedRange(definition.evadeDisplacement, field('evadeDisplacement'))
  } else if (definition.evadeDisplacement !== undefined) {
    throw new Error(`CombatStyleCatalog ${field('evadeDisplacement')} must be undefined for ${id}`)
  }
}

function validateCombatStyleDefinition(
  style: CombatStyleDefinition,
  archetype: Archetype,
  catalog: CombatStyleCatalog,
): void {
  const field = (name: string) => `styles.${archetype}.${name}`

  if (style.archetype !== archetype) {
    throw new Error(`CombatStyleCatalog ${field('archetype')} must equal its catalog key`)
  }

  validateLocomotionProfile(style.locomotion, archetype)
  requireOrderedRange(style.preferredRange, field('preferredRange'))

  if (new Set(style.attackActionIds).size !== style.attackActionIds.length) {
    throw new Error(`CombatStyleCatalog ${field('attackActionIds')} must not contain duplicates`)
  }
  for (const attackId of style.attackActionIds) {
    if (!(attackId in catalog.attacks)) {
      throw new Error(`CombatStyleCatalog ${field('attackActionIds')} references unknown attack '${attackId}'`)
    }
  }
  if (!(style.defenseActionId in catalog.defenses)) {
    throw new Error(`CombatStyleCatalog ${field('defenseActionId')} references unknown defense '${style.defenseActionId}'`)
  }

  const attackIdSet = new Set<string>(style.attackActionIds)
  for (const [key, weight] of Object.entries(style.baseWeights)) {
    const isLocomotionIntent = key in LOCOMOTION_INTENT_SET
    const isStyleAttack = attackIdSet.has(key)
    if (!isLocomotionIntent && !isStyleAttack) {
      throw new Error(
        `CombatStyleCatalog ${field('baseWeights')} key '${key}' must be a locomotion intent or an attack ID listed by this style`,
      )
    }
    if (weight !== undefined) {
      requireFiniteNonNegative(weight, `${field('baseWeights')}.${key}`)
    }
  }
}

function validateLocomotionProfile(profile: Readonly<LocomotionProfile>, archetype: Archetype): void {
  const field = (name: string) => `styles.${archetype}.locomotion.${name}`

  requireFiniteNonNegative(profile.forwardUnitsPerSecond, field('forwardUnitsPerSecond'))
  requireFiniteNonNegative(profile.backwardUnitsPerSecond, field('backwardUnitsPerSecond'))
  requireFiniteNonNegative(profile.lateralUnitsPerSecond, field('lateralUnitsPerSecond'))
  requireFiniteNonNegative(profile.burstUnitsPerSecond, field('burstUnitsPerSecond'))

  requireFinite(profile.turnCosPerTick, field('turnCosPerTick'))
  requireFinite(profile.turnSinPerTick, field('turnSinPerTick'))
  if (profile.turnCosPerTick < 0 || profile.turnCosPerTick > 1) {
    throw new Error(`CombatStyleCatalog ${field('turnCosPerTick')} must be between 0 and 1`)
  }
  if (profile.turnSinPerTick < 0 || profile.turnSinPerTick > 1) {
    throw new Error(`CombatStyleCatalog ${field('turnSinPerTick')} must be between 0 and 1`)
  }

  const unitLengthError = Math.abs(
    profile.turnCosPerTick * profile.turnCosPerTick + profile.turnSinPerTick * profile.turnSinPerTick - 1,
  )
  if (unitLengthError > TURN_UNIT_LENGTH_EPSILON) {
    throw new Error(
      `CombatStyleCatalog ${field('turnCosPerTick')}/${field('turnSinPerTick')} must satisfy cos^2+sin^2 ~= 1`,
    )
  }
}

function requireFinite(value: number, field: string): void {
  if (!Number.isFinite(value)) {
    throw new Error(`CombatStyleCatalog ${field} must be a finite number`)
  }
}

function requireFiniteNonNegative(value: number, field: string): void {
  if (!Number.isFinite(value) || value < 0) {
    throw new Error(`CombatStyleCatalog ${field} must be a non-negative finite number`)
  }
}

function requirePositiveInteger(value: number, field: string): void {
  if (!Number.isFinite(value) || !Number.isInteger(value) || value <= 0) {
    throw new Error(`CombatStyleCatalog ${field} must be a positive integer`)
  }
}

function requireDotRange(value: number, field: string): void {
  requireFinite(value, field)
  if (value < -1 || value > 1) {
    throw new Error(`CombatStyleCatalog ${field} must be between -1 and 1`)
  }
}

function requireOrderedRange(range: Readonly<{ min: number; max: number }>, field: string): void {
  requireFiniteNonNegative(range.min, `${field}.min`)
  requireFiniteNonNegative(range.max, `${field}.max`)
  if (range.min > range.max) {
    throw new Error(`CombatStyleCatalog ${field}.min must be <= ${field}.max`)
  }
}
