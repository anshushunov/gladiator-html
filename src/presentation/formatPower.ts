// Shared presentation-only formatting for a fighter's `power` stat.
// `content/season.ts`'s `scaleOpponent` deliberately leaves a challenge
// opponent's `power` a raw float (e.g. `19.080000000000002`) -- the
// balance-tuning code that consumes it is frozen and needs the unrounded
// value, so the source is never touched here, only the display.
//
// `toFixed(1)`, not `Math.round`: a whole-number round collapses close
// values into indistinguishable numbers -- e.g. Cassius's power across the
// season's three challenges (19 -> 20.52 -> 20.9) would show as 19 / 21 / 21,
// hiding the very escalation the season board exists to telegraph. Kept in
// one place, used identically by `SeasonView`'s challenge cards and
// `SeriesView`'s matchup slots, so the two screens cannot show different
// numbers for the same opponent.
export function formatPower(power: number): string {
  return power.toFixed(1)
}
