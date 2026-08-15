export type FighterSide = 'home' | 'away'
export type Archetype = 'heavy' | 'fast' | 'technical'
export type MatchupComparison = 'advantage' | 'neutral' | 'disadvantage'

export interface FighterDefinition {
  id: string
  name: string
  school: string
  archetype: Archetype
  maxHp: number
  damage: number
  attackIntervalTicks: number
  accuracy: number
  blockChance: number
  criticalChance: number
}

const COUNTERS: Record<Archetype, Archetype> = {
  heavy: 'fast',
  fast: 'technical',
  technical: 'heavy',
}

const DAMAGE_MULTIPLIERS: Record<MatchupComparison, number> = {
  advantage: 1.25,
  neutral: 1,
  disadvantage: 0.8,
}

export function compareArchetypes(home: Archetype, away: Archetype): MatchupComparison {
  if (home === away) return 'neutral'
  return COUNTERS[home] === away ? 'advantage' : 'disadvantage'
}

export function comparisonDamageMultiplier(comparison: MatchupComparison): number {
  return DAMAGE_MULTIPLIERS[comparison]
}