import type { Archetype, FighterDefinition } from './fighters'

export interface ChallengeDefinition {
  index: 0 | 1 | 2
  opponents: readonly FighterDefinition[]
  featuredThreat: Archetype | null
}
