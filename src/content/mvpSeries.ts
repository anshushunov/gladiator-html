import type { FighterDefinition } from '../simulation/fighters'

export const homeRoster = [
  { id: 'brutus', name: 'Brutus', school: 'House of Mars', archetype: 'heavy', maxHp: 360, damage: 12, attackIntervalTicks: 54, accuracy: 0.86, blockChance: 0.18, criticalChance: 0.10 },
  { id: 'aquila', name: 'Aquila', school: 'House of Mars', archetype: 'fast', maxHp: 240, damage: 8, attackIntervalTicks: 38, accuracy: 0.82, blockChance: 0.08, criticalChance: 0.12 },
  { id: 'nerva', name: 'Nerva', school: 'House of Mars', archetype: 'technical', maxHp: 345, damage: 12, attackIntervalTicks: 44, accuracy: 0.92, blockChance: 0.16, criticalChance: 0.16 },
] as const satisfies readonly FighterDefinition[]

export const opponents = [
  { id: 'drusus', name: 'Drusus', school: 'House of Saturn', archetype: 'fast', maxHp: 390, damage: 13, attackIntervalTicks: 36, accuracy: 0.90, blockChance: 0.12, criticalChance: 0.15 },
  { id: 'cassius', name: 'Cassius', school: 'House of Neptune', archetype: 'technical', maxHp: 330, damage: 11, attackIntervalTicks: 48, accuracy: 0.90, blockChance: 0.15, criticalChance: 0.12 },
  { id: 'magnus', name: 'Magnus', school: 'House of Vulcan', archetype: 'heavy', maxHp: 288, damage: 10, attackIntervalTicks: 62, accuracy: 0.78, blockChance: 0.18, criticalChance: 0.06 },
] as const satisfies readonly FighterDefinition[]

export const BASELINE_TEST_SEED = 20260815
export const TARGET_MIN_BOUT_TICKS = 840
export const TARGET_MAX_BOUT_TICKS = 1800
