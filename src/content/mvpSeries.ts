import type { FighterDefinition } from '../simulation/fighters'

export const homeRoster = [
  { id: 'brutus', name: 'Brutus', school: 'House of Mars', archetype: 'heavy', maxHp: 170, power: 22, accuracy: 0.86, defenseChance: 0.34, criticalChance: 0.10 },
  { id: 'aquila', name: 'Aquila', school: 'House of Mars', archetype: 'fast', maxHp: 120, power: 16, accuracy: 0.84, defenseChance: 0.31, criticalChance: 0.14 },
  { id: 'nerva', name: 'Nerva', school: 'House of Mars', archetype: 'technical', maxHp: 165, power: 20, accuracy: 0.92, defenseChance: 0.40, criticalChance: 0.16 },
] as const satisfies readonly FighterDefinition[]

export const opponents = [
  { id: 'drusus', name: 'Drusus', school: 'House of Saturn', archetype: 'fast', maxHp: 185, power: 21, accuracy: 0.90, defenseChance: 0.36, criticalChance: 0.15 },
  { id: 'cassius', name: 'Cassius', school: 'House of Neptune', archetype: 'technical', maxHp: 160, power: 19, accuracy: 0.90, defenseChance: 0.38, criticalChance: 0.12 },
  { id: 'magnus', name: 'Magnus', school: 'House of Vulcan', archetype: 'heavy', maxHp: 145, power: 18, accuracy: 0.78, defenseChance: 0.32, criticalChance: 0.06 },
] as const satisfies readonly FighterDefinition[]

export const BASELINE_TEST_SEED = 20260815
