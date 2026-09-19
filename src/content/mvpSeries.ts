import type { FighterDefinition } from '../simulation/fighters'

// Task 13 calibration.
//
// The design permits tuning these six numeric rows but fixes their "relative
// content intent" (design.md:698). Four of the five stat rank-orders are exactly
// the design's, and `mvpSeries.test.ts` pins them as properties so a future edit
// cannot quietly invert one:
//   maxHp     drusus > brutus > nerva > cassius > magnus > aquila   PRESERVED
//   accuracy  nerva > drusus = cassius > brutus > aquila > magnus   PRESERVED
//   defence   nerva > cassius > drusus > brutus > magnus > aquila   PRESERVED
//   critical  nerva > drusus > aquila > cassius > brutus > magnus   PRESERVED
//   power     brutus > drusus > nerva > cassius > magnus > aquila   ** BROKEN **
//
// ONE ordinal deviation, load-bearing rather than incidental:
//
//   Aquila `power` 16 -> 20, moving her from strictly lowest of the six to tied
//   third with Nerva. Without it `aquila/drusus` measures 1.5% and
//   `aquila/magnus` 10.5% against a 15..85% band; with it, 19.5% and 33.0%.
//   Every other lever was measured and is insufficient: critical chance is
//   nearly inert here (+1.0 point when doubled, since criticals apply only to an
//   unblocked hit on a recovering target), and compressing the HP spread alone
//   reaches 5.5%. Aquila's authored identity is "fragile burst fighter", so
//   lowest HP plus top-tier per-hit power is at least a coherent glass cannon --
//   but it is a real change of standing and is flagged as one.
//
// Magnitude changes that preserve every rank. The first two are the ones the
// owner ruled on; the third is ordinary tuning under the design's blanket
// "Implementation may tune these fighter numbers" clause, listed in full so an
// audit against the approved set finds no unexplained value:
//
//   - The HP spread is compressed: Aquila sits at 78% of Drusus's HP (274 vs
//     350) against the authored 65% (120 vs 185), so "fragile" survives as an
//     ordinal but is softer as a magnitude. The per-row scale factors are
//     deliberately NOT uniform -- they span 1.892 (Drusus) to 2.283 (Aquila) --
//     because the compression IS the deviation: a uniform scale would have kept
//     the authored 65% and left `aquila/drusus` unreachable. HP is also what
//     puts the cohort's median bout inside 1500..2400 ticks.
//   - Magnus is buffed toward his neighbours (accuracy 0.78 -> 0.85, critical
//     0.06 -> 0.099, defence 0.32 -> 0.335) while staying last on accuracy and
//     critical and fifth on defence. Needed to hold `brutus/magnus` and
//     `nerva/magnus` under the 85% ceiling; he remains the weakest opponent on
//     every axis the design names for him.
//   - Small in-rank steps taken while the rows around them moved, crossing no
//     neighbour: Aquila accuracy 0.84 -> 0.855, defence 0.31 -> 0.315, critical
//     0.14 -> 0.148; Cassius defence 0.38 -> 0.395.
//
// The Heavy/Fast/Technical triangle is tight: on the equal-stat style cohort,
// strengthening any one style lifts its own advantaged matchup and lowers the
// one where it is the disadvantaged side, so `heavy vs fast` and
// `technical vs heavy` trade against each other directly and both sit within a
// few points of the 55% floor. Re-run `balance.test.ts` after ANY change to
// these rows or to the action multipliers -- a nudge that looks local is not.
//
// The golden scenario's three-distinct-profiles criterion was amended to two
// during Task 13; see the amendment in the design doc for the measured conflict
// with the roster win-rate bands. (The retiarius-reach slice produces four
// distinct profiles again, so that amended floor is now exceeded rather than
// merely met.)
//
// EVERY `maxHp` ROSE IN THE RETIARIUS-REACH SLICE, and the scale is worth
// stating precisely because an earlier summary of that package rounded it down
// to "roughly +20%", which external review correctly called out as making the
// change sound smaller than it is:
//
//   brutus  324 -> 420  +29.6%      drusus  350 -> 470  +34.3%
//   aquila  274 -> 404  +47.4%      cassius 312 -> 415  +33.0%
//   nerva   314 -> 418  +33.1%      magnus  299 -> 406  +35.8%
//
// The bulk of it (~+30% across the board) restores bout length: the slice's
// damage recalibration cut the combined roster median to 1446 against a
// 1500..2400 pacing band. Aquila is the outlier at +47.4% and is NOT part of
// that uniform scaling -- she was raised a second time, alone, because
// `aquila/magnus` is the roster pairing pinned hardest against the 15% floor
// by the same fast-vs-heavy wall the whole balance task ran into.
//
// ---------------------------------------------------------------------------
// 2026-09-05: AQUILA'S `power` 20 -> 20.8, AND WHY IT IS AGAIN AQUILA ALONE
// ---------------------------------------------------------------------------
//
// The body-width translation (see `src/content/combatStyles.ts`'s header) and
// the duel arena that had to grow with it (`battle.ts`) left every one of the
// nine roster pairings inside its 15..85% band, but cost the golden scenario a
// criterion the win-rate bands cannot see: design.md asks that a different
// ordering do STRICTLY BETTER than the all-counter lineup, and after the move
// the best any of the six lineups managed was 2-1 -- the all-counter lineup's
// own score. Not a sweep, which the design forbids, but not a witness either.
//
// Aquila is the only row with anywhere to go. Four of the five stat rank
// orders are pinned as properties by `mvpSeries.test.ts`, and against those
// she is already hard against a neighbour on three of them: lowest `maxHp`
// (one point below Magnus), lowest `defenseChance`, `accuracy` 0.001 under
// Brutus, `criticalChance` 0.0015 under Drusus. `power` is the fifth, and it
// is the rank the design already records as deviated.
//
// Weakening Magnus was measured and is the wrong direction: he is the away
// fighter in all three of his pairings, so weakening him raises `aquila/magnus`
// (wanted) but also `nerva/magnus`, which sits at 84.5% against an 85% ceiling.
// Aquila appears only as home, so moving her touches exactly the three pairings
// that have headroom.
//
//   aquila.power   brutus/nerva/aquila   aquila/drusus   aquila/cassius   aquila/magnus
//        20              2-1                 27.0%           54.5%            19.0%
//        20.4            2-1                 27.5%           58.5%            19.5%
//        20.8            3-0                 28.0%           58.5%            19.5%   <- shipped
//        21.05           3-0                 31.5%           58.5%            19.5%
//
// 20.8 is the smallest cell that restores the witness. 21.05 would also do it
// and is rejected: it takes her past Drusus's 21, so only ONE fighter would
// out-power her, and `mvpSeries.test.ts` pins that count at two as the exact
// statement of how far the deviation goes. What 20.8 does cost is the Aquila =
// Nerva tie at 20, which that test also recorded; the tie was an artefact of
// the previous calibration rather than an authored intent, and the test now
// records the ordering that replaced it.
export const homeRoster = [
  { id: 'brutus', name: 'Brutus', school: 'House of Mars', archetype: 'heavy', maxHp: 420, power: 21.2, accuracy: 0.86, defenseChance: 0.34, criticalChance: 0.10 },
  // `power` 20 -> 20.8 on 2026-09-05, the second time this row has been the
  // lever and for the same reason as the first. See the "ONE ordinal deviation"
  // note above and the 2026-09-05 block below it.
  { id: 'aquila', name: 'Aquila', school: 'House of Mars', archetype: 'fast', maxHp: 404, power: 20.8, accuracy: 0.859, defenseChance: 0.334, criticalChance: 0.157 },
  { id: 'nerva', name: 'Nerva', school: 'House of Mars', archetype: 'technical', maxHp: 418, power: 20, accuracy: 0.902, defenseChance: 0.398, criticalChance: 0.1595 },
] as const satisfies readonly FighterDefinition[]

export const opponents = [
  { id: 'drusus', name: 'Drusus', school: 'House of Saturn', archetype: 'fast', maxHp: 470, power: 21, accuracy: 0.90, defenseChance: 0.372, criticalChance: 0.1585 },
  { id: 'cassius', name: 'Cassius', school: 'House of Neptune', archetype: 'technical', maxHp: 415, power: 19, accuracy: 0.90, defenseChance: 0.395, criticalChance: 0.12 },
  { id: 'magnus', name: 'Magnus', school: 'House of Vulcan', archetype: 'heavy', maxHp: 406, power: 17.5, accuracy: 0.85, defenseChance: 0.335, criticalChance: 0.099 },
] as const satisfies readonly FighterDefinition[]

export const BASELINE_TEST_SEED = 20260815
