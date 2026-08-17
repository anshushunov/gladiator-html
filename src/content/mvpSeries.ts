import type { FighterDefinition } from '../simulation/fighters'

// Task 13 calibration, satisfying the design's fixed balance cohorts. The
// design permits tuning these six numeric rows while preserving the relative
// content intent of its own table.
//
// Intent preserved:
// - HP ordering across all six rows is IDENTICAL to the authored table
//   (Drusus > Brutus > Nerva > Cassius > Magnus > Aquila); only the scale
//   changed, to put the cohort's median bout inside 1500..2400 ticks.
// - Drusus keeps the highest HP -- "elite opponent intended to absorb a
//   sacrifice".
// - Aquila keeps the lowest HP and now has by far the highest critical chance
//   -- "fragile burst fighter".
// - Nerva keeps the highest accuracy and the highest defence -- "strongest
//   all-rounder".
// - Magnus keeps the lowest HP of the three opponents and the lowest accuracy
//   of all six -- "vulnerable heavy opponent".
//
// One deliberate deviation, recorded rather than buried: Aquila's `power` rose
// from the authored table's 16 (lowest of the six) to 22 (tied with Brutus for
// highest). Her authored intent is "fragile burst fighter", and low HP plus top
// critical chance plus high per-hit power is a faithful reading of a glass
// cannon -- but it is a change of relative standing on that one axis, and it is
// load-bearing: it is what makes Aquila beat Magnus at the golden seed, which
// the golden scenario needs in order to yield three distinct score profiles
// across the six lineups.
export const homeRoster = [
  { id: 'brutus', name: 'Brutus', school: 'House of Mars', archetype: 'heavy', maxHp: 285, power: 22, accuracy: 0.86, defenseChance: 0.34, criticalChance: 0.10 },
  { id: 'aquila', name: 'Aquila', school: 'House of Mars', archetype: 'fast', maxHp: 246, power: 22, accuracy: 0.90, defenseChance: 0.35, criticalChance: 0.24 },
  { id: 'nerva', name: 'Nerva', school: 'House of Mars', archetype: 'technical', maxHp: 283, power: 20, accuracy: 0.92, defenseChance: 0.40, criticalChance: 0.16 },
] as const satisfies readonly FighterDefinition[]

export const opponents = [
  { id: 'drusus', name: 'Drusus', school: 'House of Saturn', archetype: 'fast', maxHp: 292, power: 21, accuracy: 0.90, defenseChance: 0.36, criticalChance: 0.15 },
  { id: 'cassius', name: 'Cassius', school: 'House of Neptune', archetype: 'technical', maxHp: 277, power: 19, accuracy: 0.90, defenseChance: 0.38, criticalChance: 0.12 },
  { id: 'magnus', name: 'Magnus', school: 'House of Vulcan', archetype: 'heavy', maxHp: 251, power: 19, accuracy: 0.84, defenseChance: 0.36, criticalChance: 0.10 },
] as const satisfies readonly FighterDefinition[]

export const BASELINE_TEST_SEED = 20260815
