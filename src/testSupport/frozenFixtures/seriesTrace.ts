// Content-dependent literals split out of `src/simulation/series.test.ts`.
// Each carries a claim about the game (a "product" value): it must continue
// to satisfy design.md's own criteria after a content change, verified against
// the new run directly. Trace hashes and durations are deliberately NOT pinned
// here any more -- determinism is asserted by running twice, not by a literal.
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
export const STATS_LED_LINEUP = ['brutus', 'nerva', 'aquila'] as const satisfies readonly [string, string, string]
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
 * CLASS: determinism. The short-handed series' final scores, in the order
 * `series.test.ts` asserts them.
 *
 * NOT in the preparatory PR's inventory, and that omission is why its split
 * was incomplete. Each forfeit contributes exactly one away point, so these
 * scores are fully determined once the fought bouts' winners are known; they
 * are pinned (rather than left as a `>= 1` lower bound) so a fought bout's
 * winner cannot flip silently. The STRUCTURE around them -- how many
 * forfeits, at which bout indices, against which opponents -- is the criterion
 * and stays in the test file.
 *
 * `leadingSlot` was added on 2026-08-27, when finishing the split: the content
 * PR moved three of these four and left the fourth inline, which is the same
 * incompleteness one layer down. It is the same class as the other three --
 * `brutus vs cassius` and `aquila vs magnus` are both real fought bouts, so
 * this score moves whenever their winners do.
 *
 * The 'no fightable gladiators at all' case is deliberately NOT here. Its
 * `{home: 0, away: 3}` is structural rather than measured: with an empty
 * roster every bout forfeits and each forfeit is one away point, so no
 * behaviour change can move it and freezing it in a re-baselinable module
 * would misfile a criterion as a snapshot.
 */
export const SHORT_HANDED_SCORES = {
  uncoveredSlot: { home: 2, away: 1 },
  leadingSlot: { home: 1, away: 2 },
  trailingSlot: { home: 1, away: 2 },
  twoConsecutiveSlots: { home: 1, away: 2 },
} as const
