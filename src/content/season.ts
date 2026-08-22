import type { DispositionId } from '../simulation/disposition'
import type { ChallengeDefinition } from '../simulation/season'
import type { Archetype, FighterDefinition } from '../simulation/fighters'
import { homeRoster, opponents } from './mvpSeries'

export { homeRoster, opponents } from './mvpSeries'

// Bench specialists, appended after the calibrated three so every existing
// fixture that names `brutus`/`aquila`/`nerva` keeps exercising the same
// pairing. They are deliberately weaker on aggregate than the veteran of
// their own style -- a bench as good as the starters turns rotation into
// bookkeeping (design.md, "Roster and challenge content").
//
// ---------------------------------------------------------------------------
// Task 6 calibration. Every number below moved; `seasonBalance.test.ts` holds
// the result. Percentages are win rates over the design's fixed cohort -- 200
// consecutive seeds from 20260815 -- against the three UNSCALED opponents
// (Drusus / Cassius / Magnus), with the veteran of the same style for
// comparison. "mean" is the mean of those three.
//
// The starting point failed three of the five acceptance criteria outright:
//
//   before   Drusus  Cassius  Magnus   mean
//   vitus     57.0     43.5    66.5    55.7   (Brutus 65.0 / 58.0 / 81.5, 68.2)
//   sura       7.5     22.5    22.5    17.5   (Aquila 15.0 / 35.0 / 26.5, 25.5)
//
//   after     Drusus  Cassius  Magnus   mean
//   vitus     67.0     52.5    80.5    66.7
//   sura      19.5     25.0    23.5    22.7
//
// Both bench members started as strictly worse copies of their veteran -- every
// stat lower, and measurably behind on all three matchups. That is precisely
// the "strict downgrade" the design rules out, so BOTH had to be reshaped, not
// merely nudged: each needed one axis on which it beats its veteran.
//
//   Vitus (heavy), Brutus with the trades reversed -- hits harder, is clumsier
//   and softer. The one matchup he wins is the Fast opponent, which is the
//   counter-triangle's own arrow (heavy -> fast) and the challenge-2 featured
//   threat, so "bench the veteran, field the specialist" has a readable reason.
//     - maxHp 296 -> 308, power 21 -> 23 (now the roster's highest, above
//       Brutus's 22). Together these are what lift `vitus/drusus` past
//       `brutus/drusus`: 57.0 -> 67.0 against Brutus's 65.0.
//     - accuracy 0.83 -> 0.84 and defenseChance 0.33 -> 0.30, both still under
//       Brutus (0.86 / 0.34). Lowering defence is what keeps the Cassius
//       matchup down -- measured, that matchup is roughly twice as sensitive to
//       defence and HP as the other two, which is what lets Brutus keep
//       `cassius` (58.0 vs 52.5) and `magnus` (81.5 vs 80.5) and stay ahead on
//       the mean (68.2 vs 66.7).
//     - criticalChance unchanged at 0.09.
//
//   Sura (fast), the opposite shape from Aquila: where Aquila is a fragile
//   burst fighter, Sura is the evasive attrition fighter. She wins the Fast
//   mirror -- the one matchup Aquila is worst at -- and loses everywhere else.
//     - defenseChance 0.305 -> 0.49, the roster's highest by a wide margin
//       (Nerva 0.40). This is the load-bearing change and the only lever that
//       moved `sura/drusus` off the floor without dragging her mean above
//       Aquila's: measured, defence is the one axis that raises the Fast and
//       Technical matchups while LOWERING the Heavy one, so it buys Drusus and
//       pays for it in Magnus, which is exactly the trade the criterion wants.
//     - power 19 -> 17, the roster's lowest, and accuracy 0.845 -> 0.905, second
//       only to Nerva. Lands often, lands lightly. The power cut is what holds
//       the mean at 22.7 against Aquila's 25.5 after the defence buff.
//     - maxHp 262 -> 292. Needed with power 17: at 262 the same evasion build
//       measured 17.0 / 25.0 / 25.5, only 2.0 points clear of the 15% floor and
//       collapsing to 8.0% as soon as challenge 3 scaled Drusus at all.
//     - criticalChance unchanged at 0.14.
//
// Result against the five criteria (all margins in percentage points):
//   1. bench inside 15..85%      worst margin 4.5 (sura/drusus 19.5)
//   2. neither a strict upgrade  vitus wins drusus by 2.0, Brutus wins cassius
//                                by 5.5; sura wins drusus by 4.5, Aquila wins
//                                cassius by 10.0. Means stay below: 66.7 vs
//                                68.2 and 22.7 vs 25.5.
//   4. wounded costs >= 10 pts   worst drop 15.0 (aquila/drusus)
//
// The counter triangle is tight -- see the warning in `mvpSeries.ts`. These
// numbers were reached by measuring a grid of ~500 candidate stat blocks rather
// than by reasoning from the stats, because the axes are not separable: on
// Vitus, dropping maxHp costs the Cassius matchup twice what it costs the other
// two, and on Sura defence moves Drusus and Magnus in OPPOSITE directions.
// Re-run `seasonBalance.test.ts` AND `balance.test.ts` after any change here.
//
// One thing these numbers cannot fix, which is why `SCALING` below also moved:
// the fighter id seeds the RNG streams (`home.${id}` reaches `deriveSeed`), so
// two gladiators with identical stats do not measure identically. Vitus carrying
// Brutus's exact stat row measures 72.5 / 64.5 / 87.5, not 65.0 / 58.0 / 81.5 --
// and 87.5 is already outside the band. The bench cannot be tuned "relative to"
// the veteran on paper; it has to be measured.
// ---------------------------------------------------------------------------
const benchSpecialists = [
  { id: 'vitus', name: 'Vitus', school: 'House of Mars', archetype: 'heavy', maxHp: 308, power: 23, accuracy: 0.84, defenseChance: 0.30, criticalChance: 0.09 },
  { id: 'sura', name: 'Sura', school: 'House of Mars', archetype: 'fast', maxHp: 292, power: 17, accuracy: 0.905, defenseChance: 0.49, criticalChance: 0.14 },
] as const satisfies readonly FighterDefinition[]

export const SEASON_ROSTER = [...homeRoster, ...benchSpecialists] as const satisfies readonly FighterDefinition[]

/**
 * Per-opponent scaling, in `opponents` order: Drusus (fast), Cassius
 * (technical), Magnus (heavy).
 *
 * DRUSUS IS FROZEN AT x1.00 IN ALL THREE CHALLENGES. Escalation is carried by
 * Cassius and Magnus alone. This is an owner decision taken on Task 6's
 * measurements, and it replaces the design's authored table (design.md, "Roster
 * and challenge content": `[1.12, 1.08, 1.04]` and `[1.16, 1.12, 1.20]`), which
 * is not compatible with the design's OWN criterion 3 -- "no `fresh` pairing in
 * challenge 3 falls outside 5..95%".
 *
 * Why Drusus, specifically. He is the strongest opponent, and BOTH Fast
 * gladiators meet him in a mirror they are already losing. `aquila/drusus`
 * measures 15.0% unscaled -- exactly ON the 15% floor of `balance.test.ts`'s own
 * band -- so every point of scaling comes straight out of a pairing that has
 * none to give (`mvpSeries.ts` records 19.5% when Aquila was calibrated; the
 * combat kernel has drifted since). Measured over the fixed 200-seed cohort:
 *
 *   Drusus x     1.00   1.04   1.06   1.08   1.12   1.16
 *   aquila       15.0   12.5   12.5    6.5    5.0    3.5
 *   sura         19.5   11.5    8.5    6.0     --     --
 *
 * Aquila is a frozen definition, so no bench tuning can move this. Scaling
 * Drusus at all therefore forced the whole escalation down -- an earlier
 * revision of this file ran x1.05/x1.06 on him and had to hold Cassius and
 * Magnus to x1.08/x1.10 to stay monotone underneath. Freezing the one opponent
 * that cannot take pressure buys the other two roughly twice the room.
 *
 * Where Cassius and Magnus stop, and why they do not reach the x1.16 the
 * decision aimed at. `sura/*` is the binding pairing for both; the worst
 * challenge-3 pairing at each factor:
 *
 *   x            1.06   1.08   1.10   1.11   1.12   1.13   1.14   1.16   1.18
 *   vs Cassius   17.0   12.5   10.5   10.0    9.5     --    6.5    6.0    5.0
 *   vs Magnus    12.0   10.5    8.5    8.0    7.0    6.5    5.5    5.0    3.5
 *
 * At the aimed-for x1.16 the worst pairing sits at 5.0% against Magnus and 6.0%
 * against Cassius -- i.e. exactly ON the floor, the same zero-margin boundary
 * that disqualified the design's own table. Magnus stops at x1.12, the last
 * factor keeping the worst pairing a clear 2.0 points (4 bouts of 200) above
 * the floor; x1.13 is 6.5% and x1.14 is 5.5%.
 *
 * Every number, and what forces it. Steps are quoted relative to challenge 1,
 * since that is what the featured-threat rule compares:
 *
 *   ch3 Magnus   1.20 -> 1.12  MEASURED CEILING. See the table above.
 *   ch3 Cassius  1.12 -> 1.10  RULE. Must step less than Magnus, the featured
 *                              threat of its challenge (+0.10 < +0.12). Its own
 *                              measured ceiling is higher -- x1.12 still leaves
 *                              the worst pairing at 9.5% -- so Cassius is held
 *                              back by the featured-threat rule, not by balance.
 *   ch2 Cassius  1.08 -> 1.08  UNCHANGED -- the design's authored value, and the
 *                              largest step of challenge 2, which is what makes
 *                              `technical` its featured threat.
 *   ch2 Magnus   1.04 -> 1.06  RAISED. Must step less than Cassius (+0.06 <
 *                              +0.08) and stay under its own ch3 x1.12.
 *   ch2 Drusus   1.12 -> 1.00  FROZEN, see above.
 *   ch3 Drusus   1.16 -> 1.00  FROZEN, see above.
 *
 * Everything the design asks of the vectors' SHAPE still holds:
 *   - monotone per opponent (non-decreasing; strictly increasing for the two
 *     that escalate), integral `maxHp`, and `accuracy`/`defence`/`critical`
 *     untouched -- `season.test.ts` pins all of it, Drusus's freeze included;
 *   - asymmetric rather than a uniform scalar, so which gladiator answers which
 *     slot still changes between challenges;
 *   - the featured threat takes the largest step of its challenge -- Cassius in
 *     challenge 2 (`technical`, since a frozen Drusus can no longer be it) and
 *     Magnus in challenge 3 (`heavy`). That rule is asserted in
 *     `season.test.ts`, not merely stated here.
 *
 * Measured challenge-3 result: the worst pairing is `sura/magnus` at 7.0% and
 * the best is `vitus/drusus` at 67.0%, and every veteran's mean falls
 * (Brutus 68.2 -> 53.8, Aquila 25.5 -> 13.7, Nerva 60.0 -> 49.2).
 */
const SCALING: readonly (readonly [number, number, number])[] = [
  [1.00, 1.00, 1.00],
  [1.00, 1.08, 1.06],
  [1.00, 1.10, 1.12],
]

const FEATURED: readonly (Archetype | null)[] = [null, 'technical', 'heavy']

/**
 * Per-challenge opponent temperaments, in `opponents` order (Drusus, Cassius,
 * Magnus). Challenge 1 is all 'standard': it IS the frozen baseline series,
 * and it teaches orders against neutral opponents (design.md, "Temperaments").
 * Challenges 2–3 are initial authored rows — tuning inputs to
 * dispositionBalance.test.ts, adjustable there alongside the modifier
 * magnitudes; the challenge-1 row is not.
 */
const TEMPERAMENTS: readonly (readonly DispositionId[])[] = [
  ['standard', 'standard', 'standard'],
  ['press', 'guarded', 'standard'],
  ['press', 'guarded', 'press'],
]

function scaleOpponent(definition: FighterDefinition, factor: number): FighterDefinition {
  if (factor === 1) return definition
  return { ...definition, maxHp: Math.round(definition.maxHp * factor), power: definition.power * factor }
}

export const SEASON_CHALLENGES: readonly ChallengeDefinition[] = SCALING.map((factors, index) => ({
  index: index as 0 | 1 | 2,
  opponents: opponents.map((opponent, slot) => scaleOpponent(opponent, factors[slot])),
  featuredThreat: FEATURED[index],
  temperaments: TEMPERAMENTS[index],
}))
