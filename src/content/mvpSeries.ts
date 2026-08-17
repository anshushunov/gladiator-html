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
// Two magnitude deviations that preserve every rank:
//
//   - The HP spread is compressed: Aquila sits at ~78% of Drusus's HP against the
//     authored 65%, so "fragile" survives as an ordinal but is softer as a
//     magnitude. This is the other half of what makes `aquila/drusus` reachable.
//   - Magnus is buffed toward his neighbours (accuracy 0.78 -> 0.85, critical
//     0.06 -> 0.099, defence 0.32 -> 0.335) while staying last on accuracy and
//     critical and fifth on defence. Needed to hold `brutus/magnus` and
//     `nerva/magnus` under the 85% ceiling; he remains the weakest opponent on
//     every axis the design names for him.
//
// HP is scaled uniformly from the authored table, which preserves every rank
// AND the ratios between rows; the scale exists only to put the cohort's median
// bout inside 1500..2400 ticks.
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
// with the roster win-rate bands.
export const homeRoster = [
  { id: 'brutus', name: 'Brutus', school: 'House of Mars', archetype: 'heavy', maxHp: 324, power: 22, accuracy: 0.86, defenseChance: 0.34, criticalChance: 0.10 },
  { id: 'aquila', name: 'Aquila', school: 'House of Mars', archetype: 'fast', maxHp: 274, power: 20, accuracy: 0.855, defenseChance: 0.315, criticalChance: 0.148 },
  { id: 'nerva', name: 'Nerva', school: 'House of Mars', archetype: 'technical', maxHp: 314, power: 20, accuracy: 0.92, defenseChance: 0.40, criticalChance: 0.16 },
] as const satisfies readonly FighterDefinition[]

export const opponents = [
  { id: 'drusus', name: 'Drusus', school: 'House of Saturn', archetype: 'fast', maxHp: 350, power: 21, accuracy: 0.90, defenseChance: 0.36, criticalChance: 0.15 },
  { id: 'cassius', name: 'Cassius', school: 'House of Neptune', archetype: 'technical', maxHp: 312, power: 19, accuracy: 0.90, defenseChance: 0.395, criticalChance: 0.12 },
  { id: 'magnus', name: 'Magnus', school: 'House of Vulcan', archetype: 'heavy', maxHp: 299, power: 18, accuracy: 0.85, defenseChance: 0.335, criticalChance: 0.099 },
] as const satisfies readonly FighterDefinition[]

export const BASELINE_TEST_SEED = 20260815
