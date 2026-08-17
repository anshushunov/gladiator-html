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
//   `aquila/magnus` 10.5% against a 15..85% band; with it, 17.5% and 31.5%.
//   Every other lever was measured and is insufficient: critical chance is
//   nearly inert here (+1.0 point when doubled, since criticals apply only to an
//   unblocked hit on a recovering target), and compressing the HP spread alone
//   reaches 5.5%. Aquila's authored identity is "fragile burst fighter", so
//   lowest HP plus top-tier per-hit power is at least a coherent glass cannon --
//   but it is a real change of standing and is flagged as one.
//
// Two magnitude deviations that preserve every rank:
//
//   - The HP spread is compressed: Aquila sits at 84% of Drusus's HP against the
//     authored 65%, so "fragile" survives as an ordinal but is softer as a
//     magnitude. This is the other half of what makes `aquila/drusus` reachable.
//   - Magnus is buffed toward his neighbours (accuracy 0.78 -> 0.85, critical
//     0.06 -> 0.099, defence 0.32 -> 0.335) while staying last on accuracy and
//     critical and fifth on defence. Needed to hold `brutus/magnus` and
//     `nerva/magnus` under the 85% ceiling; he remains the weakest opponent on
//     every axis the design names for him.
//
// Several values here are knife-edge for the golden scenario at seed 20260815,
// which needs three distinct score profiles across the six lineups: Magnus at
// 258 HP rather than 264 is what keeps `aquila/magnus` a win there, and
// `technical-driving-thrust`'s 24-tick recovery is what keeps `nerva/drusus` a
// loss. Re-run `balance.test.ts` and the golden-scenario tests after any change
// here; do not assume a small nudge is safe.
export const homeRoster = [
  { id: 'brutus', name: 'Brutus', school: 'House of Mars', archetype: 'heavy', maxHp: 289, power: 22, accuracy: 0.86, defenseChance: 0.34, criticalChance: 0.10 },
  { id: 'aquila', name: 'Aquila', school: 'House of Mars', archetype: 'fast', maxHp: 246, power: 20, accuracy: 0.855, defenseChance: 0.315, criticalChance: 0.148 },
  { id: 'nerva', name: 'Nerva', school: 'House of Mars', archetype: 'technical', maxHp: 279, power: 20, accuracy: 0.92, defenseChance: 0.40, criticalChance: 0.16 },
] as const satisfies readonly FighterDefinition[]

export const opponents = [
  { id: 'drusus', name: 'Drusus', school: 'House of Saturn', archetype: 'fast', maxHp: 292, power: 21, accuracy: 0.90, defenseChance: 0.36, criticalChance: 0.15 },
  { id: 'cassius', name: 'Cassius', school: 'House of Neptune', archetype: 'technical', maxHp: 272, power: 19, accuracy: 0.90, defenseChance: 0.38, criticalChance: 0.12 },
  { id: 'magnus', name: 'Magnus', school: 'House of Vulcan', archetype: 'heavy', maxHp: 258, power: 18, accuracy: 0.85, defenseChance: 0.335, criticalChance: 0.099 },
] as const satisfies readonly FighterDefinition[]

export const BASELINE_TEST_SEED = 20260815
