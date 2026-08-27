// Frozen literals split out of `src/simulation/series.test.ts`, so the CI gate
// can protect that file's acceptance logic while these stay re-baselinable.
//
// There are FIVE content-dependent values here, not the two the split was
// first scoped around, and they are NOT all the same kind of thing. The
// spec's "Re-baselining: two kinds of artifact" governs which rule each one
// obeys, so each block below states its class:
//
//   determinism -- may be re-frozen when behaviour changes on purpose, with a
//   stated reason. It asserts only that the run is the same run.
//
//   product -- carries a claim about the game. It must continue to satisfy
//   design.md's own criteria. If it cannot, the spec is amended FIRST, in the
//   form Task 13's calibration amendment used: the deviation, the measurement
//   that forced it, what it costs.
//
// -----------------------------------------------------------------------
// A CONFLICT THIS FILE EXISTS TO SURFACE, recorded here for the task that
// reconciles the moved artifacts.
//
// `series.test.ts` asserts `scores.has('3-0') === false` for every one of the
// six lineups. design.md's golden criteria are weaker: the all-counter lineup
// must not sweep, and "at least one different lineup wins 2-1 OR 3-0". The
// test is therefore STRICTER THAN THE SPEC.
//
// If a 3-0 appears after the content change, that is not automatically a
// failure -- but it is also not to be resolved by editing whichever of the two
// is more convenient. Decide it explicitly and write the decision into the
// spec.
// -----------------------------------------------------------------------

/**
 * CLASS: determinism. The `Aquila/Nerva/Brutus` lineup, all three bouts, at
 * the fixed seed. Pinned per bout rather than folded into one value so a
 * failure names the bout that moved.
 *
 *   bout 0  aquila vs drusus   away wins by defeat -> 3600fb53
 *   bout 1  nerva  vs cassius  home wins by defeat -> dee79f52
 *   bout 2  brutus vs magnus   home wins by defeat -> 563432bd
 *
 * Bout 0 was re-frozen on 2026-08-18 (Fast's forced disengage went live and
 * `fast-burst-lunge` was recalibrated with it); bouts 1 and 2 contain no Fast
 * fighter and came through byte-identical.
 */
export const LINEUP_BOUT_HASHES: readonly string[] = ['3600fb53', 'dee79f52', '563432bd']

/**
 * CLASS: determinism. The same three bouts' durations, pinned alongside the
 * hashes so a differently-shaped series cannot coincidentally satisfy them.
 * All three sit inside the roster cohort's 1200..2700 median band, which is
 * an acceptance claim and stays asserted in the test file.
 */
export const LINEUP_BOUT_DURATIONS: readonly number[] = [1721, 2183, 1202]

/**
 * CLASS: determinism. The same lineup's final score, pinned beside the hashes
 * for the same reason the durations are: to stop a differently-shaped series
 * from coincidentally satisfying the literals.
 *
 * NOT in the plan's inventory of five, and moved anyway. Leaving it in
 * `series.test.ts` would have recreated exactly the problem the split exists
 * to remove: the CI gate forbids that file from the content PR onward, and a
 * value that must move cannot live behind a rule that forbids moving it.
 * Note that this lineup (`aquila/nerva/brutus`) is NOT the `statsLed` one
 * (`aquila/brutus/nerva`) below, even though both currently read 2-1.
 */
export const LINEUP_TRACE_SCORE = { home: 2, away: 1 } as const

/**
 * CLASS: product. `Aquila/Nerva/Brutus`'s score. It is the "a different
 * ordering does strictly better" half of design.md's golden criteria; the
 * test also asserts `statsLed.score.home > allCounters.score.home`, which is
 * the criterion itself and is not re-baselinable.
 */
export const STATS_LED_SCORE = { home: 2, away: 1 } as const

/**
 * CLASS: product. The all-counter lineup `Brutus/Aquila/Nerva`. design.md
 * forbids it sweeping 3-0; under the Task 13 calibration it does not merely
 * fail to sweep, it LOSES. Asserted by name rather than by set membership,
 * because the set alone cannot tell "some lineup sweeps" from "the forbidden
 * one sweeps".
 */
export const ALL_COUNTERS_SCORE = '1-2'

/**
 * CLASS: product. The distinct scores across all six lineups. design.md's
 * criterion, amended during Task 13, is "at least two distinct profiles"; the
 * `>= 2` assertion is the criterion and lives in the test file. THIS set is
 * the stronger, re-baselinable statement of which two they are.
 *
 * The `3-0` prohibition asserted next to it in the test file is the conflict
 * described in this file's header. It is not part of this literal.
 */
export const LINEUP_SCORE_SET: readonly string[] = ['1-2', '2-1']
