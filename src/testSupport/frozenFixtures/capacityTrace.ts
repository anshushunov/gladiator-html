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
export const CAPACITY_TRACE_HASH = 'dbe77c5e'
