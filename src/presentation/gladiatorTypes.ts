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

/** The one-line disclaimer that follows the counter rule on the planning screen. */
export const COUNTER_RULE_NOTE = "The school's own scheme, not history."

// ---------------------------------------------------------------------------
// The label set, as one switchable object
// ---------------------------------------------------------------------------

/**
 * Every player-facing string the type naming owns, in one bundle.
 * `SeriesView`/`SeasonView` read their labels from here and nowhere else.
 * An empty `descriptions` entry means "render no `title` tooltip at all", and
 * an empty `counterRuleNote` means "append no note line".
 */
export interface TypeVocabulary {
  names: Readonly<Record<Archetype, string>>
  descriptions: Readonly<Record<Archetype, string>>
  counterRuleText: string
  counterRuleNote: string
}

export const SHIPPED_TYPE_VOCABULARY: TypeVocabulary = Object.freeze({
  names: TYPE_NAMES,
  descriptions: TYPE_DESCRIPTIONS,
  counterRuleText: COUNTER_RULE_TEXT,
  counterRuleNote: COUNTER_RULE_NOTE,
})
