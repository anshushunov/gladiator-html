// Shared presentation-only condition-ladder formatting, used identically by
// `SeasonView` (the season board) and `SeriesView` (the planning screen) --
// the brief requires both to show "the same telegraph" for a given
// gladiator's condition, so the wording lives here once rather than being
// authored twice and risking drift.
//
// Steps the ladder using only `condition.ts`'s own index primitives
// (`conditionIndex`/`conditionAtIndex`) -- never re-deriving
// `conditionAfterBout`/`conditionAfterRest`'s own win/loss branching. The
// step counts baked into the wording below (one step for an ordinary win,
// two for a loss or a costly win, one step back for a rest) are simulation
// facts, not something this module recomputes from wear ratios.

import { conditionAtIndex, conditionIndex, type FighterCondition } from '../simulation/condition'

export const CONDITION_LABELS: Record<FighterCondition, string> = { fresh: 'Fresh', bruised: 'Bruised', wounded: 'Wounded', broken: 'Broken' }

function steppedCondition(condition: FighterCondition, delta: number): FighterCondition {
  return conditionAtIndex(conditionIndex(condition) + delta)
}

/** "Fight: -> bruised, or wounded on a loss" -- never called for `broken` (not fightable). */
export function fightTelegraph(condition: FighterCondition): string {
  const onWin = CONDITION_LABELS[steppedCondition(condition, 1)].toLowerCase()
  const onLoss = CONDITION_LABELS[steppedCondition(condition, 2)].toLowerCase()
  return `Fight: → ${onWin}, or ${onLoss} on a loss`
}

/** "Rest: wounded -> bruised" -- `null` when resting would not move the
 * ladder (a `fresh` gladiator who sits out stays `fresh`). */
export function restTelegraph(condition: FighterCondition): string | null {
  const after = steppedCondition(condition, -1)
  if (after === condition) return null
  return `Rest: ${CONDITION_LABELS[condition].toLowerCase()} → ${CONDITION_LABELS[after].toLowerCase()}`
}
