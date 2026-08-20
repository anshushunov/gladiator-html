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
 * Task 6 lowered these from the design's authored table (design.md, "Roster and
 * challenge content"), which was `[1.12, 1.08, 1.04]` and `[1.16, 1.12, 1.20]`.
 * That table is not compatible with the design's OWN criterion 3 -- "no `fresh`
 * pairing in challenge 3 falls outside 5..95%" -- and no bench tuning can make
 * it so, because the pairing that breaks it is `aquila/drusus`, and both of
 * those are frozen definitions.
 *
 * What was measured, win rate over the fixed 200-seed cohort at a range of
 * Drusus factors:
 *
 *   Drusus x     1.00   1.04   1.06   1.08   1.12   1.16
 *   aquila       15.0   12.5   12.5    6.5    5.0    3.5
 *   sura         19.5   11.5    8.5    6.0     --     --
 *
 * `aquila/drusus` is a Fast mirror against a strictly better stat block and
 * already sits ON the 15% floor of `balance.test.ts`'s own band at challenge 1
 * (the `mvpSeries.ts` comment records 19.5% when it was calibrated; the combat
 * kernel has drifted since). The authored x1.16 puts it at 3.5%, and x1.12 --
 * the lowest value monotonicity would even allow next to challenge 2's x1.12 --
 * puts it at exactly 5.0%, i.e. on the boundary with zero margin. Magnus is the
 * same story one step milder: `aquila/magnus` measures 5.0% at the authored
 * x1.20 and 12.5% at x1.10.
 *
 * So the vectors were re-chosen to be the harshest that keep every challenge-3
 * pairing clear of the floor by a real margin, while preserving everything the
 * design asks of their SHAPE:
 *   - monotone per opponent, integral `maxHp`, `accuracy`/`defence`/`critical`
 *     untouched (`season.test.ts` pins all three);
 *   - asymmetric rather than a uniform scalar, so which gladiator answers which
 *     slot still changes between challenges;
 *   - the featured threat still takes the largest step of its challenge --
 *     Drusus in challenge 2 (fast), Magnus in challenge 3 (heavy).
 *
 * The cost is that Drusus, the strongest opponent, can now only be scaled by a
 * few percent: he is the ceiling on the whole escalation, because both Fast
 * gladiators fight him in a mirror they are losing anyway. Escalation is
 * therefore carried mostly by Cassius and Magnus. Measured challenge-3 result:
 * the worst pairing is `sura/magnus` at 8.5% and the best is `brutus/magnus` at
 * 65.0%, and every veteran's mean falls (Brutus 68.2 -> 52.5, Aquila 25.5 ->
 * 14.3, Nerva 60.0 -> 45.3).
 */
const SCALING: readonly (readonly [number, number, number])[] = [
  [1.00, 1.00, 1.00],
  [1.05, 1.03, 1.02],
  [1.06, 1.08, 1.10],
]

const FEATURED: readonly (Archetype | null)[] = [null, 'fast', 'heavy']

function scaleOpponent(definition: FighterDefinition, factor: number): FighterDefinition {
  if (factor === 1) return definition
  return { ...definition, maxHp: Math.round(definition.maxHp * factor), power: definition.power * factor }
}

export const SEASON_CHALLENGES: readonly ChallengeDefinition[] = SCALING.map((factors, index) => ({
  index: index as 0 | 1 | 2,
  opponents: opponents.map((opponent, slot) => scaleOpponent(opponent, factors[slot])),
  featuredThreat: FEATURED[index],
}))
