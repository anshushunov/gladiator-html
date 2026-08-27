// Frozen determinism artifact, split out of `encounterCapacity.test.ts` so the
// CI gate can protect that file's behavioural assertions -- >=50 action
// instances, >=50 contact resolutions, >=1000 damage, >=20 damaged
// combatants, the candidate-check bounds -- while this literal stays
// re-baselinable. See the spec's "Re-baselining: two kinds of artifact".
//
// CLASS: determinism. It may be re-frozen when behaviour changes on purpose,
// with a stated reason in the commit message. It carries no product claim:
// what the capacity suite asserts about the run's SHAPE stays in the test
// file and is not re-baselinable.
// RE-FROZEN by the retiarius-reach slice. The mass-scale trace folds all 100
// combatants' per-tick state across the fixed 600-tick window, and that
// window contains Fast combatants whose committed attack, contact range,
// forced-disengage constants and damage all moved. Read from a probe run.
export const CAPACITY_TRACE_HASH = 'a7cc237a'
