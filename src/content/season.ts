import type { ChallengeDefinition } from '../simulation/season'
import type { Archetype, FighterDefinition } from '../simulation/fighters'
import { homeRoster, opponents } from './mvpSeries'

export { homeRoster, opponents } from './mvpSeries'

// Bench specialists, appended after the calibrated three so every existing
// fixture that names `brutus`/`aquila`/`nerva` keeps exercising the same
// pairing. They are deliberately weaker on aggregate than the veteran of
// their own style -- a bench as good as the starters turns rotation into
// bookkeeping (design.md, "Roster and challenge content"). Task 6 calibrates
// these numbers; the values here are the starting point it measures.
const benchSpecialists = [
  { id: 'vitus', name: 'Vitus', school: 'House of Mars', archetype: 'heavy', maxHp: 296, power: 21, accuracy: 0.83, defenseChance: 0.33, criticalChance: 0.09 },
  { id: 'sura', name: 'Sura', school: 'House of Mars', archetype: 'fast', maxHp: 262, power: 19, accuracy: 0.845, defenseChance: 0.305, criticalChance: 0.14 },
] as const satisfies readonly FighterDefinition[]

export const SEASON_ROSTER = [...homeRoster, ...benchSpecialists] as const satisfies readonly FighterDefinition[]

/** Per-opponent scaling, in `opponents` order: Drusus (fast), Cassius (technical), Magnus (heavy). */
const SCALING: readonly (readonly [number, number, number])[] = [
  [1.00, 1.00, 1.00],
  [1.12, 1.08, 1.04],
  [1.16, 1.12, 1.20],
]

const FEATURED: readonly (Archetype | null)[] = [null, 'fast', 'heavy']

function scaleOpponent(definition: FighterDefinition, factor: number): FighterDefinition {
  if (factor === 1) return definition
  return { ...definition, maxHp: Math.round(definition.maxHp * factor), power: definition.power * factor }
}

export const SEASON_CHALLENGES: readonly ChallengeDefinition[] = SCALING.map((factors, index) => ({
  index: index as 0 | 1 | 2,
  opponents: opponents.map((opponent, slot) => scaleOpponent(opponent, factors[slot])),
  featuredThreat: FEATURED[index],
}))
