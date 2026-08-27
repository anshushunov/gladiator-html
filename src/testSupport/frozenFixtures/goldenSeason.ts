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
export const GOLDEN_OUTCOMES: readonly (readonly string[])[] = [
  ['brutus vs drusus: away', 'aquila vs cassius: away', 'nerva vs magnus: home'],
  ['vitus vs drusus: home', 'sura vs cassius: away', 'brutus vs magnus: away'],
  // `nerva vs cassius: home`, not the `away` this row froze while challenge 3's
  // temperaments went unmeasured: challenge 3's Cassius now presses
  // (`content/season.ts`'s `TEMPERAMENTS` row 2), and pressing is the one
  // temperament change that HELPS the Technical gladiator facing him -- 39.5%
  // to 50.5% over the fixed cohort. Nerva's own order is the default
  // `standard`, so the opponent's temperament is the only changed input.
  ['aquila vs drusus: away', 'nerva vs cassius: home', 'vitus vs magnus: away'],
]

export const GOLDEN_SCORE = { home: 3, away: 6 }

/**
 * The measured sequence, in roster order, one row per series. It is asserted
 * whole rather than sampled because the interesting content is the SHAPE, not
 * any single step: three fighters are charged and two rested every series, a
 * loss costs two rungs and a win one, resting while already `fresh` restores
 * nothing, and `broken` absorbs everything above it. Series 2 charges Brutus
 * from `wounded` straight to `broken`, which is what makes the third challenge
 * a short-handed one.
 */
export const GOLDEN_DELTAS: readonly (readonly string[])[] = [
  ['brutus:fresh>wounded(fought)', 'aquila:fresh>wounded(fought)', 'nerva:fresh>bruised(fought)', 'vitus:fresh>fresh(rested)', 'sura:fresh>fresh(rested)'],
  ['brutus:wounded>broken(fought)', 'aquila:wounded>bruised(rested)', 'nerva:bruised>fresh(rested)', 'vitus:fresh>wounded(fought)', 'sura:fresh>wounded(fought)'],
  // `nerva:fresh>bruised`, one rung rather than two: the same flip the outcome
  // row above records -- he now WINS that bout, and wins it with HP to spare,
  // which `conditionAfterBout` charges a single step for.
  ['brutus:broken>wounded(rested)', 'aquila:bruised>broken(fought)', 'nerva:fresh>bruised(fought)', 'vitus:wounded>broken(fought)', 'sura:wounded>bruised(rested)'],
]
