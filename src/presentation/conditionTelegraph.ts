// Shared presentation-only condition-ladder formatting, used identically by
// `SeasonView` (the season board) and `SeriesView` (the planning screen) --
// the brief requires both to show "the same telegraph" for a given
// gladiator's condition, so the wording lives here once rather than being
// authored twice and risking drift.
//
// Both ends of the fight telegraph are read off `condition.ts`'s own
// `conditionAfterBout`/`conditionAfterRest` -- never re-derived here. An
// earlier revision stepped the ladder with literal deltas (1 for a win, 2
// for a loss), which silently disagreed with the real rule: `condition.ts`
// also charges two steps for a *win* that ends under 25% remaining HP, not
// just for a loss. Calling the simulation functions directly means this
// module cannot drift from that rule again.

import { conditionAfterBout, conditionAfterRest, type FighterCondition } from '../simulation/condition'

export const CONDITION_LABELS: Record<FighterCondition, string> = { fresh: 'Fresh', bruised: 'Bruised', wounded: 'Wounded', broken: 'Broken' }

/** "Fight: → bruised, or wounded on a loss or a win under 25% HP" -- never
 * called for `broken` (not fightable). The first outcome is a clean win at
 * full remaining HP (one ladder step); the second is either a loss or a win
 * that ends under 25% HP (both cost two steps, per `conditionAfterBout`).
 *
 * The two ends collapse into one sentence when they name the same rung: a
 * `wounded` gladiator is one step from `broken` on a clean win and two on a
 * loss, and the ladder clamps, so both branches read `broken`. Spelling that
 * out as "→ broken, or broken on a loss" reads as a rendering bug rather than
 * as the warning it is. */
export function fightTelegraph(condition: FighterCondition): string {
  const onCleanWin = CONDITION_LABELS[conditionAfterBout(condition, { won: true, remainingHpRatio: 1 })].toLowerCase()
  const onLossOrLowHpWin = CONDITION_LABELS[conditionAfterBout(condition, { won: false, remainingHpRatio: 0 })].toLowerCase()
  if (onCleanWin === onLossOrLowHpWin) return `Fight: → ${onCleanWin}, whatever the outcome`
  return `Fight: → ${onCleanWin}, or ${onLossOrLowHpWin} on a loss or a win under 25% HP`
}

/** "Rest: wounded -> bruised". Benching is half of the decision this screen
 * exists to support, so it is always stated -- including the no-op case,
 * where saying "stays fresh" out loud is what tells the player that resting
 * this gladiator buys nothing. */
export function restTelegraph(condition: FighterCondition): string {
  const after = conditionAfterRest(condition)
  if (after === condition) return `Rest: stays ${CONDITION_LABELS[condition].toLowerCase()}`
  return `Rest: ${CONDITION_LABELS[condition].toLowerCase()} → ${CONDITION_LABELS[after].toLowerCase()}`
}
