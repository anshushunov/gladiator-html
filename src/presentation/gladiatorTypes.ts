// The only place an internal archetype id becomes player-facing identity.
// `fast` is the retiarius because `fast` holds the LONGEST preferred range
// of the three (2.4-3.0) and retreats most -- reach-and-give-ground, not
// in-and-out brawling. See the design spec's "The three types".
import type { Archetype } from '../simulation/fighters'

export const TYPE_NAMES: Record<Archetype, string> = {
  heavy: 'Murmillo',
  fast: 'Retiarius',
  technical: 'Hoplomachus',
}

export const TYPE_DESCRIPTIONS: Record<Archetype, string> = {
  heavy: 'closes behind the great shield and strikes short',
  fast: 'fights at reach with net and trident, giving ground',
  technical: 'holds the spear at long range and thrusts from outside',
}

/** The school's own scheme, not a historical taxonomy. */
export const COUNTER_RULE_TEXT = 'Murmillo beats Retiarius beats Hoplomachus beats Murmillo'
