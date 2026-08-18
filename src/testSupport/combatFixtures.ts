// Test-only plain fixture builders for encounter tests.
//
// This file may compose simulation contracts with `src/content/**` — that is
// explicitly allowed here and only here; `src/simulation/**` itself never
// imports content (see `src/simulation/architecture.test.ts`). It stays free
// of production state and of any function stored into encounter state: every
// export is plain data or a plain-data builder. Task 12 extends this file
// with the 100-combatant grid fixture.

import { COMBAT_STYLES } from '../content/combatStyles'
import { homeRoster, opponents } from '../content/mvpSeries'
import { advanceEncounterTick, type EncounterCombatantDefinition, type EncounterConfig, type EncounterEvent, type EncounterState, type EncounterTransition, type FighterCombatState } from '../simulation/encounter'
import type { Archetype, FighterDefinition } from '../simulation/fighters'
import type { CombatArenaDefinition, Vec2 } from '../simulation/movement'
import { foldTraceHash, formatTraceHash } from '../simulation/random'

const DEFAULT_FIGHTER: Readonly<Omit<FighterDefinition, 'id' | 'name' | 'archetype'>> = {
  school: 'Fixture School',
  maxHp: 100,
  power: 20,
  accuracy: 0.8,
  defenseChance: 0.3,
  criticalChance: 0.1,
}

export interface CombatantFixtureOverrides {
  fighter?: Partial<FighterDefinition>
  startPosition?: Vec2
  archetype?: Archetype
}

/**
 * Builds a minimal, valid `EncounterCombatantDefinition`: `id` is the
 * encounter-local `CombatantId`, distinct from the synthesized
 * `FighterDefinition.id` it carries, matching the design's split between
 * combatant identity and content/roster identity. Defaults to `{x:0,z:0}`
 * for `startPosition`; callers needing distinct positions (e.g. ordered-pair
 * facing) pass `overrides.startPosition`.
 */
export function combatant(id: string, factionId: string, overrides: CombatantFixtureOverrides = {}): EncounterCombatantDefinition {
  const fighter: FighterDefinition = {
    id: `${id}-fighter`,
    name: id,
    archetype: overrides.archetype ?? 'heavy',
    ...DEFAULT_FIGHTER,
    ...overrides.fighter,
  }

  return {
    id,
    factionId,
    fighter,
    startPosition: overrides.startPosition ?? { x: 0, z: 0 },
  }
}

/** Open arena with `free` movement, large enough to never clip fixture positions. */
export const freeArena: Readonly<CombatArenaDefinition> = {
  radius: 30,
  lateralLimit: 20,
  minimumSeparation: 0.9,
  movementPolicy: 'free',
}

/**
 * Duel-shaped arena with `ordered-pair` movement, matching the design's
 * duel-adapter dimensions. `orderedPair` names `'a'`/`'b'`, the combatant IDs
 * used throughout `encounter.test.ts`'s two-combatant fixtures.
 */
export const duelArena: Readonly<CombatArenaDefinition> = {
  radius: 6.5,
  lateralLimit: 2.5,
  minimumSeparation: 0.9,
  movementPolicy: 'ordered-pair',
  orderedPair: ['a', 'b'],
}

// ---------------------------------------------------------------------------
// Task 12: the deterministic mass-scale grid fixture.
//
// `makeGridCombatants` cycles through the six approved fighter definitions
// (`homeRoster` + `opponents`, `content/mvpSeries.ts`) so a grid of any size
// draws only from reviewed content, never synthesizes new balance data.
// ---------------------------------------------------------------------------

const APPROVED_FIGHTERS: readonly FighterDefinition[] = [...homeRoster, ...opponents]

export interface GridCombatantsOptions {
  columns: number
  rows: number
  spacing: number
}

/**
 * Builds a deterministic `columns x rows` grid of `EncounterCombatantDefinition`s,
 * centered on the origin and spaced `spacing` units apart on both axes.
 * Combatants are laid out row-major (row 0 first, then column ascending
 * within each row) starting from `ffa.000`, zero-padded to three digits so
 * lexicographic id order matches this row-major placement order -- this
 * fixture never needs more than 999 combatants, and `EncounterConfig` itself
 * caps at 100. Each combatant cycles deterministically through
 * `APPROVED_FIGHTERS` (`index % APPROVED_FIGHTERS.length`) and gets its own
 * unique `faction.NNN` id: FFA hostility (the only mode this fixture is used
 * under) makes every distinct pair hostile regardless of faction, but
 * distinct factions keep the fixture honest about not leaning on shared
 * faction identity to do that work.
 */
export function makeGridCombatants(options: Readonly<GridCombatantsOptions>): EncounterCombatantDefinition[] {
  const { columns, rows, spacing } = options
  const xOffset = ((columns - 1) * spacing) / 2
  const zOffset = ((rows - 1) * spacing) / 2

  const combatants: EncounterCombatantDefinition[] = []
  for (let row = 0; row < rows; row += 1) {
    for (let column = 0; column < columns; column += 1) {
      const index = row * columns + column
      const suffix = String(index).padStart(3, '0')
      const id = `ffa.${suffix}`
      const source = APPROVED_FIGHTERS[index % APPROVED_FIGHTERS.length]
      combatants.push({
        id,
        factionId: `faction.${suffix}`,
        fighter: { ...source, id: `${id}-fighter` },
        startPosition: { x: column * spacing - xOffset, z: row * spacing - zOffset },
      })
    }
  }
  return combatants
}

/**
 * The deterministic 100-combatant free-for-all fixture (Task 12 Step 1): a
 * 10x10 grid at spacing `3.25`, wide open `free` arena, and `free-for-all`
 * hostility so every distinct pair is hostile. Exists to prove the kernel's
 * collection-first design actually holds at its documented ceiling (`2..100`
 * combatants, `encounter.ts`'s `requireCombatantCount`) -- it adds no
 * player-facing mass mode.
 */
export function createHundredCombatantFfa(seed = 20260815): EncounterConfig {
  return {
    seed,
    combatants: makeGridCombatants({ columns: 10, rows: 10, spacing: 3.25 }),
    arena: freeArena,
    hostility: { mode: 'free-for-all' },
    combatStyles: COMBAT_STYLES,
  }
}

// ---------------------------------------------------------------------------
// Task 12: shared canonical trace-hash folding, moved here (out of
// `encounter.test.ts`, which introduced it in Task 10 Step 3) so both
// `encounter.test.ts` and `encounterCapacity.test.ts` reuse exactly the same
// folding approach rather than each maintaining its own copy. Test-only
// diagnostic: `EncounterState` itself never stores an event log or a running
// hash. This helper's own output was not yet frozen when this comment was
// written (Task 12, before Task 13's balance pass) -- it now backs several
// frozen literals: `encounter.test.ts`'s `FROZEN_DUEL_TRACES` (Task 13 Step
// 6) and `encounterCapacity.test.ts`'s own `44a08b74`, both asserted via
// this exact function.
// ---------------------------------------------------------------------------

function quantizeMillionths(value: number): number {
  return Math.round(value * 1_000_000)
}

function foldCombatantTrace(hash: number, combatant: Readonly<FighterCombatState>, random: EncounterState['randomByCombatant'][string]): number {
  let next = hash
  next = foldTraceHash(next, combatant.id)
  next = foldTraceHash(next, combatant.factionId)
  next = foldTraceHash(next, combatant.targetId ?? '')
  next = foldTraceHash(next, combatant.status)
  next = foldTraceHash(next, combatant.locomotionIntent)
  next = foldTraceHash(next, String(combatant.hp))
  next = foldTraceHash(next, String(quantizeMillionths(combatant.position.x)))
  next = foldTraceHash(next, String(quantizeMillionths(combatant.position.z)))
  next = foldTraceHash(next, String(quantizeMillionths(combatant.facing.x)))
  next = foldTraceHash(next, String(quantizeMillionths(combatant.facing.z)))
  next = foldTraceHash(next, String(quantizeMillionths(combatant.velocity.x)))
  next = foldTraceHash(next, String(quantizeMillionths(combatant.velocity.z)))
  next = foldTraceHash(next, String(quantizeMillionths(combatant.travelledDistance)))
  next = foldTraceHash(next, String(combatant.staggerUntilTick))
  next = foldTraceHash(next, String(combatant.nextDecisionTick))
  next = foldTraceHash(next, String(combatant.nextActionSerial))
  next = foldTraceHash(next, String(combatant.lastContactTick))
  next = foldTraceHash(next, String(combatant.lastResolutionTick))
  next = foldTraceHash(next, combatant.forcedActionId ?? '')
  next = foldTraceHash(next, combatant.forcedDisengageStartTick === undefined ? '' : String(combatant.forcedDisengageStartTick))
  next = foldTraceHash(next, JSON.stringify(combatant.action))
  next = foldTraceHash(next, JSON.stringify(combatant.reactionLedger))
  next = foldTraceHash(next, String(random.decision.value))
  next = foldTraceHash(next, String(random.defense.value))
  next = foldTraceHash(next, String(random.contact.value))
  return next
}

/** Folds one tick's canonical trace: `state.tick`, every sorted combatant's full state + RNG streams, then every event this tick emitted, in emission order. */
function foldTickTrace(hash: number, state: EncounterState, tickEvents: readonly EncounterEvent[]): number {
  let next = foldTraceHash(hash, String(state.tick))
  for (const id of state.combatantIds) {
    next = foldCombatantTrace(next, state.combatants[id], state.randomByCombatant[id])
  }
  for (const event of tickEvents) {
    next = foldTraceHash(next, JSON.stringify(event))
  }
  return next
}

/** Runs up to `ticks` advances from `initial` (stopping early once finished), folding a running canonical trace hash tick by tick -- including the creation tick's own `encounter-started` event -- and returns the final formatted hash. */
export function traceHash(initial: EncounterTransition, ticks: number): string {
  let hash = foldTickTrace(0, initial.state, initial.events)
  let state = initial.state
  for (let index = 0; index < ticks && state.phase === 'running'; index += 1) {
    const next = advanceEncounterTick(state)
    state = next.state
    hash = foldTickTrace(hash, state, next.events)
  }
  return formatTraceHash(hash)
}
