// The golden season's frozen literals, split out of
// `src/simulation/seasonBalance.test.ts` so the CI gate can protect that
// file's acceptance bands and cohort method while these stay re-baselinable.
//
// CLASS: product, all three. They are NOT hashes. Per the spec's
// "Re-baselining: two kinds of artifact", each one carries a claim about the
// game, and each must continue to satisfy design.md's own criteria after a
// content change -- verified against the new run directly, not inferred from
// whether the fixture happens to match. If a criterion cannot be met, the spec
// is amended FIRST, in the form Task 13's calibration amendment used: the
// deviation, the measurement that forced it, what it costs.
//
// A passing series-lineup criterion does NOT authorize updating these. The
// golden season and the golden series are different claims about different
// runs.

/**
 * The bouts themselves, asserted alongside the deltas because the delta
 * sequence ALONE does not discriminate: `conditionAfterBout` charges two rungs
 * both for a loss and for a win that ends under 25% HP, so a series in which a
 * gladiator narrowly wins and one in which he loses can produce byte-identical
 * deltas. Measured -- running this file against the pre-calibration content
 * flipped `vitus vs drusus` from a win to a loss and the delta rows did not
 * move. The season score is the same statement at the season's scale.
 */
// ---------------------------------------------------------------------------
// RE-BASELINED by the retiarius-reach slice. The three criteria this trace
// exists to demonstrate were verified against the NEW run FIRST, directly,
// not inferred from whether these literals match:
//
//   * the season reaches `season-summary`                        YES
//   * challenge 2 is entered with fewer than three fresh (2)     YES
//   * challenge 3 is entered with fewer than three fresh (0)     YES
//   * by challenge 3 exactly one gladiator is unfightable        ['brutus']
//
// Three bouts change hands, and each is the same recalibration seen from a
// different seat: `brutus vs drusus` and `sura vs cassius` swing to the
// school, `nerva vs cassius` away from it.
export const GOLDEN_OUTCOMES: readonly (readonly string[])[] = [
  ['brutus vs drusus: home', 'aquila vs cassius: away', 'nerva vs magnus: home'],
  ['vitus vs drusus: home', 'sura vs cassius: home', 'brutus vs magnus: away'],
  ['aquila vs drusus: away', 'nerva vs cassius: away', 'vitus vs magnus: away'],
]

/** 3-6 before the slice: the school takes one more of the nine. */
export const GOLDEN_SCORE = { home: 4, away: 5 }

/**
 * The measured sequence, in roster order, one row per series. It is asserted
 * whole rather than sampled because the interesting content is the SHAPE, not
 * any single step: three fighters are charged and two rested every series, a
 * loss costs two rungs and a win one, resting while already `fresh` restores
 * nothing, and `broken` absorbs everything above it.
 *
 * RE-BASELINED with the outcomes above, and the SHAPE is what says the
 * re-baseline is sound: three charged and two rested every series, the same
 * one-rung/two-rung arithmetic, and Brutus still reaching `broken` in series 2
 * -- now from `bruised` rather than from `wounded`, because he wins his first
 * bout instead of losing it -- which is what still makes the third challenge
 * a short-handed one.
 */
export const GOLDEN_DELTAS: readonly (readonly string[])[] = [
  ['brutus:fresh>bruised(fought)', 'aquila:fresh>wounded(fought)', 'nerva:fresh>wounded(fought)', 'vitus:fresh>fresh(rested)', 'sura:fresh>fresh(rested)'],
  ['brutus:bruised>broken(fought)', 'aquila:wounded>bruised(rested)', 'nerva:wounded>bruised(rested)', 'vitus:fresh>wounded(fought)', 'sura:fresh>bruised(fought)'],
  ['brutus:broken>wounded(rested)', 'aquila:bruised>broken(fought)', 'nerva:bruised>broken(fought)', 'vitus:wounded>broken(fought)', 'sura:bruised>fresh(rested)'],
]
