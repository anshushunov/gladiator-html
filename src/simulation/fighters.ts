export type FighterSide = 'home' | 'away'
export type Archetype = 'heavy' | 'fast' | 'technical'
export type MatchupComparison = 'advantage' | 'neutral' | 'disadvantage'

export interface FighterDefinition {
  id: string
  name: string
  school: string
  archetype: Archetype
  maxHp: number
  power: number
  accuracy: number
  defenseChance: number
  criticalChance: number
}

const COUNTERS: Record<Archetype, Archetype> = {
  heavy: 'fast',
  fast: 'technical',
  technical: 'heavy',
}

const DAMAGE_MULTIPLIERS: Record<MatchupComparison, number> = {
  advantage: 1.10,
  neutral: 1,
  disadvantage: 0.90,
}

export function compareArchetypes(home: Archetype, away: Archetype): MatchupComparison {
  if (home === away) return 'neutral'
  return COUNTERS[home] === away ? 'advantage' : 'disadvantage'
}

export function comparisonDamageMultiplier(comparison: MatchupComparison): number {
  return DAMAGE_MULTIPLIERS[comparison]
}

export function validateFighterDefinition(definition: FighterDefinition): FighterDefinition {
  requireNonEmptyString(definition.id, 'id')
  requireNonEmptyString(definition.name, 'name')
  requireNonEmptyString(definition.school, 'school')
  requirePositiveIntegerFinite(definition.maxHp, 'maxHp')
  requirePositiveFinite(definition.power, 'power')
  requireProbability(definition.accuracy, 'accuracy')
  requireProbability(definition.defenseChance, 'defenseChance')
  requireProbability(definition.criticalChance, 'criticalChance')
  return definition
}

function requireNonEmptyString(value: string, field: string): void {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new Error(`FighterDefinition ${field} must be a non-empty string`)
  }
}

function requirePositiveIntegerFinite(value: number, field: string): void {
  if (!Number.isFinite(value) || !Number.isInteger(value) || value <= 0) {
    throw new Error(`FighterDefinition ${field} must be a positive integer`)
  }
}

function requirePositiveFinite(value: number, field: string): void {
  if (!Number.isFinite(value) || value <= 0) {
    throw new Error(`FighterDefinition ${field} must be a positive finite number`)
  }
}

function requireProbability(value: number, field: string): void {
  if (!Number.isFinite(value) || value < 0 || value > 1) {
    throw new Error(`FighterDefinition ${field} must be a number between 0 and 1`)
  }
}
