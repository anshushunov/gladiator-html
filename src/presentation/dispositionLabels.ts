// Shared presentation-only order/temperament copy, used identically by
// `SeriesView` (order selector, temperament badge, battle status, summary
// rows) and `SeasonView` (Task 7's own order/temperament surfaces) -- the
// wording lives here once rather than being authored twice and risking
// drift, mirroring how `conditionTelegraph.ts` is shared between the two
// views for the condition ladder.

import type { DispositionId } from '../simulation/disposition'

export const ORDER_LABELS: Record<DispositionId, string> = { standard: 'Standard', press: 'Press', guarded: 'Guarded' }
export const TEMPERAMENT_LABELS: Record<DispositionId, string> = { standard: 'Steady', press: 'Aggressive', guarded: 'Cautious' }
export const ORDER_TELEGRAPHS: Record<DispositionId, string> = {
  standard: 'Standard: fights as trained.',
  press: 'Press: better odds to win, better odds to get mauled.',
  guarded: 'Guarded: keeps HP and wear down, worse odds to win.',
}
export const TEMPERAMENT_DESCRIPTIONS: Record<DispositionId, string> = {
  standard: 'fights as trained',
  press: 'pushes in and commits',
  guarded: 'keeps distance and waits',
}
