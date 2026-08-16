// Test-only plain fixture builders for encounter tests.
//
// This file may compose simulation contracts with `src/content/**` — that is
// explicitly allowed here and only here; `src/simulation/**` itself never
// imports content (see `src/simulation/architecture.test.ts`). It stays free
// of production state and of any function stored into encounter state: every
// export is plain data or a plain-data builder. Task 12 extends this file
// with the 100-combatant grid fixture.

import type { EncounterCombatantDefinition } from '../simulation/encounter'
import type { Archetype, FighterDefinition } from '../simulation/fighters'
import type { CombatArenaDefinition, Vec2 } from '../simulation/movement'

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
