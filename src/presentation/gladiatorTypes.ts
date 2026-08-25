// The only place an internal archetype id becomes player-facing identity.
// `fast` is the retiarius because `fast` holds the LONGEST preferred range
// of the three (2.4-3.0) and retreats most -- reach-and-give-ground, not
// in-and-out brawling. See the design spec's "The three types".
import type { Archetype } from '../simulation/fighters'
import { effectiveLegibilityMode, type LegibilityMode } from './legibilityMode'

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
 * Every player-facing string this slice's naming change owns, in one bundle.
 *
 * `SeriesView`/`SeasonView` are handed one of these at construction and read
 * nothing else -- they never import `TYPE_NAMES` and friends directly. That is
 * deliberate and is what makes the review toggle real rather than decorative:
 * the label set is a constructor argument, so `labels: false` cannot be
 * satisfied by a view that quietly kept a module-level constant. See
 * `legibilityMode.test.ts`'s "the views read their labels from the vocabulary".
 *
 * An empty `descriptions` entry means "render no `title` tooltip at all", and
 * an empty `counterRuleNote` means "append no note line" -- neither existed
 * before this slice, and a review configuration that restores the superseded
 * labels has to restore their absence too, not show an empty tooltip.
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

/**
 * **Review-only. Not reachable in a production build.**
 *
 * The label map this slice replaced, kept verbatim (`SeriesView.ts` and
 * `SeasonView.ts` at `a073f20`, plus the planning screen's arrow-form counter
 * rule) so that the `baseline` and `camera-only` review configurations show a
 * reviewer what the failed 2026-08-23 gate actually saw, rather than an
 * approximation of it. Deleted from the views when it was superseded and
 * reintroduced here on purpose, in one clearly-marked place, reachable only
 * through `typeVocabularyFor({ labels: false, ... })` -- which only
 * `?legibility=` under `import.meta.env.DEV` ever asks for, and whose
 * superseded branch `vite build` folds away outright (see that function).
 *
 * These three strings are exactly the mechanics ids that
 * `tests/legibility.spec.ts`'s "no phase names a mechanics id" test forbids on
 * screen. That test is one of the slice's real guarantees and is NOT weakened:
 * it drives the app with no `?legibility=` parameter, so it sees
 * `SHIPPED_TYPE_VOCABULARY`, and `gladiatorTypes.test.ts` still asserts the
 * shipped copy is free of all three. What this constant adds is a
 * review-configuration-only path that a player has no way to reach.
 */
export const SUPERSEDED_TYPE_VOCABULARY: TypeVocabulary = Object.freeze({
  names: Object.freeze({ heavy: 'Heavy', fast: 'Fast', technical: 'Technical' }),
  // No per-type description existed before the slice: the labels were bare.
  descriptions: Object.freeze({ heavy: '', fast: '', technical: '' }),
  counterRuleText: 'Heavy → Fast → Technical → Heavy',
  // Nor did the "school's own scheme" note.
  counterRuleNote: '',
})

export function typeVocabularyFor(mode: LegibilityMode): TypeVocabulary {
  // `import.meta.env.DEV` NAMED HERE, not merely relied on inside
  // `effectiveLegibilityMode`. Both forms make the superseded branch
  // unreachable in production, but only this one makes it *absent*: the
  // function-call form returns a value the bundler cannot fold, so the ternary
  // below survived minification and `Heavy`/`Fast`/`Technical` shipped as inert
  // strings in the player's download (measured on the emitted bundle, not
  // assumed). `vite build` replaces this identifier with the literal `false`,
  // so the whole conditional collapses to its shipped side and
  // `SUPERSEDED_TYPE_VOCABULARY` is tree-shaken out. Same technique
  // `main.ts` uses for `window.__GLADIATOR_TEST__`.
  if (!import.meta.env.DEV) return SHIPPED_TYPE_VOCABULARY
  return effectiveLegibilityMode(mode).labels ? SHIPPED_TYPE_VOCABULARY : SUPERSEDED_TYPE_VOCABULARY
}
