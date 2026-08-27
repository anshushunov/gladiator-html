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
// THE CONFLICT THIS FILE EXISTED TO SURFACE HAS BEEN MET. RESOLVED.
//
// `series.test.ts` asserted `scores.has('3-0') === false` for every one of the
// six lineups, while design.md's golden criteria are weaker: the ALL-COUNTER
// lineup must not sweep, and "at least one different lineup wins 2-1 OR 3-0".
// The test was stricter than the spec.
//
// A 3-0 has appeared. Both of design.md's criteria were checked directly
// against the new run before either side was edited: the all-counter lineup
// scores 2-1 (no sweep), and `brutus/nerva/aquila` sweeps 3-0 (a different
// lineup does strictly better). The blanket prohibition is dropped; the
// by-name one -- which is what design.md actually states -- stays.
//
// Written up in full, with the six-lineup table and what the change costs, in
// `docs/superpowers/specs/2026-08-25-retiarius-reach-design.md`, under
// "Amendment -- the golden series' 3-0 prohibition, decided rather than
// relaxed".
// -----------------------------------------------------------------------

/**
 * CLASS: determinism. The `Aquila/Nerva/Brutus` lineup, all three bouts, at
 * the fixed seed. Pinned per bout rather than folded into one value so a
 * failure names the bout that moved.
 *
 *   bout 0  aquila vs drusus   away wins by defeat -> 9b27f0d9
 *   bout 1  nerva  vs cassius  home wins by defeat -> 9b59d2f7
 *   bout 2  brutus vs magnus   away wins by defeat -> 1e2f91ff
 *
 * ALL THREE re-frozen by the retiarius-reach slice. Unlike the 2026-08-18
 * re-freeze, which only moved the bout containing a Fast fighter, this slice
 * also recalibrated Heavy and Technical damage and every roster stat, so no
 * bout comes through byte-identical. Bout 2 changes hands: Brutus no longer
 * beats Magnus, which is the murmillo-mirror consequence of the same
 * recalibration the equal-stat cohort measures.
 */
export const LINEUP_BOUT_HASHES: readonly string[] = ['9b27f0d9', '9b59d2f7', '1e2f91ff']

/**
 * CLASS: determinism. The same three bouts' durations, pinned alongside the
 * hashes so a differently-shaped series cannot coincidentally satisfy them.
 * All three sit inside the roster cohort's 1200..2700 median band, which is
 * an acceptance claim and stays asserted in the test file.
 */
export const LINEUP_BOUT_DURATIONS: readonly number[] = [1705, 1402, 1934]

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
export const LINEUP_TRACE_SCORE = { home: 1, away: 2 } as const

/**
 * CLASS: product. The lineup that beats the all-counter ordering, and its
 * score -- the "a different ordering does strictly better" half of design.md's
 * golden criteria. The test also asserts
 * `statsLed.score.home > allCounters.score.home`, which is the criterion
 * itself and is NOT re-baselinable; this pair only names the witness.
 *
 * The witness moved with the content, from `aquila/brutus/nerva` (2-1) to
 * `brutus/nerva/aquila` (3-0), and the new one illustrates the design's point
 * more sharply than the old one: it throws the retiarius at the MURMILLO --
 * the matchup the archetype triangle says he loses -- and mirrors technical
 * against technical, which is exactly "reading the stat cards beats reading
 * only the archetype triangle".
 */
export const STATS_LED_LINEUP: readonly string[] = ['brutus', 'nerva', 'aquila']
export const STATS_LED_SCORE = { home: 3, away: 0 } as const

/**
 * CLASS: product. The all-counter lineup `Brutus/Aquila/Nerva`. design.md
 * forbids it SWEEPING 3-0 and nothing more; under the Task 13 calibration it
 * did not merely fail to sweep, it lost, and this literal read `1-2`. It now
 * wins 2-1, which the design permits: what it may not be is the BEST lineup,
 * and `brutus/nerva/aquila`'s 3-0 is strictly better.
 *
 * Asserted by name rather than by set membership, because the set alone cannot
 * tell "some lineup sweeps" from "the forbidden one sweeps" -- now a live
 * distinction rather than a hypothetical one.
 */
export const ALL_COUNTERS_SCORE = '2-1'

/**
 * CLASS: product. The distinct scores across all six lineups. design.md's
 * criterion, amended during Task 13 from "at least three distinct profiles"
 * down to two because a third was unreachable, is the `>= 2` assertion in the
 * test file. THIS set is the stronger, re-baselinable statement of which
 * profiles they are.
 *
 * There are now FOUR. The amended floor stays where it is -- moving it is not
 * this slice's to do -- but the criterion Task 13 had to relax is satisfied
 * again, and that is worth recording rather than leaving to be noticed.
 */
export const LINEUP_SCORE_SET: readonly string[] = ['0-3', '1-2', '2-1', '3-0']

/**
 * CLASS: determinism. The three short-handed series' final scores, in the
 * order `series.test.ts` asserts them: one uncovered slot, one trailing slot,
 * and two consecutive slots with a single gladiator available.
 *
 * NOT in the preparatory PR's inventory, and that omission is why its split
 * was incomplete. Each forfeit contributes exactly one away point, so these
 * scores are fully determined once the fought bouts' winners are known; they
 * are pinned (rather than left as a `>= 1` lower bound) so a fought bout's
 * winner cannot flip silently. The STRUCTURE around them -- how many
 * forfeits, at which bout indices, against which opponents -- is the criterion
 * and stays in the test file, unchanged by this slice.
 */
export const SHORT_HANDED_SCORES = {
  uncoveredSlot: { home: 2, away: 1 },
  trailingSlot: { home: 1, away: 2 },
  twoConsecutiveSlots: { home: 1, away: 2 },
} as const
