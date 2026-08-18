// Task 12 Step 6: an informational benchmark for the 100-combatant free-for-all
// fixture (`createHundredCombatantFfa`, `src/testSupport/combatFixtures.ts`).
// Run with `npm run benchmark:encounter` (wired to `vite-node`, already part
// of the locked Vitest toolchain -- no second TypeScript runtime added).
//
// This script prints exactly one line of metric JSON and exits 0 on success.
// It exits nonzero ONLY on an invariant or structural failure (an uncaught
// throw from `assertEncounterInvariants`, surfaced via `advanceEncounterTick`
// itself, or an explicit structural check below) -- never on a timing
// threshold. `millisecondsPerTick` is reported for visibility only; nothing
// here asserts against it.
//
// This is a plain Node/vite-node script, not `src/simulation/**`: it is free
// to use `performance.now()` for the (purely informational) timing metric,
// unlike simulation code itself (see `src/simulation/architecture.test.ts`).

import { createHundredCombatantFfa, traceHash } from '../src/testSupport/combatFixtures'
import { advanceEncounterTick, assertEncounterInvariants, createEncounter, type EncounterState } from '../src/simulation/encounter'
import { buildSpatialHash, collectCanonicalNeighborPairs } from '../src/simulation/spatialHash'

const TICKS = 600
const MAX_UNORDERED_PAIRS_AT_100 = (100 * 99) / 2 // 4950 -- the structural ceiling the broad phase must never approach

/**
 * A per-tick structural sample of the broad phase's own candidate-check
 * count, taken from the tick's real post-resolution active-combatant
 * positions using the exact same primitives the kernel's movement solver
 * uses internally (`buildSpatialHash` + `collectCanonicalNeighborPairs`).
 * This is informational, not a re-derivation of the kernel's own internal
 * per-pass accounting (`resolveSimultaneousMovement`'s `candidateChecksByPass`
 * stays private to that call) -- it is a structural sanity check that the
 * broad phase keeps behaving as designed across a real run, not merely on
 * the fixture's static starting grid.
 */
function sampleCandidateChecks(state: EncounterState): number {
  const entries = state.combatantIds.filter((id) => state.combatants[id].status === 'active').map((id) => ({ id, position: state.combatants[id].position }))
  const hash = buildSpatialHash(entries)
  const { candidateChecks } = collectCanonicalNeighborPairs(hash)
  if (candidateChecks >= MAX_UNORDERED_PAIRS_AT_100) {
    throw new Error(`benchmark-encounter: structural failure -- candidateChecks ${candidateChecks} reached the full unordered-pair ceiling ${MAX_UNORDERED_PAIRS_AT_100} at tick ${state.tick}`)
  }
  return candidateChecks
}

function run(): void {
  const config = createHundredCombatantFfa()
  let { state, events } = createEncounter(config)
  assertEncounterInvariants(state)

  let emittedEvents = events.length
  let candidateChecks = sampleCandidateChecks(state)
  let peakSerializedStateBytes = JSON.stringify(state).length

  const startTime = performance.now()
  let ticksRun = 0
  for (; ticksRun < TICKS && state.phase === 'running'; ticksRun += 1) {
    const next = advanceEncounterTick(state)
    state = next.state
    emittedEvents += next.events.length
    candidateChecks += sampleCandidateChecks(state)
    peakSerializedStateBytes = Math.max(peakSerializedStateBytes, JSON.stringify(state).length)
  }
  const elapsedMs = performance.now() - startTime
  const millisecondsPerTick = ticksRun > 0 ? elapsedMs / ticksRun : 0

  // `peakSerializedStateBytes` intentionally includes the plain injected
  // `combatStyles` catalog stored in state (a known, constant per-run
  // overhead, not subtracted out to make this number look better).
  const canonicalTraceHash = traceHash(createEncounter(config), TICKS)

  const metrics = {
    ticks: ticksRun,
    combatants: config.combatants.length,
    millisecondsPerTick,
    emittedEvents,
    candidateChecks,
    peakSerializedStateBytes,
    traceHash: canonicalTraceHash,
  }

  console.log(JSON.stringify(metrics))
}

try {
  run()
  process.exit(0)
} catch (error) {
  console.error(error instanceof Error ? error.stack ?? error.message : String(error))
  process.exit(1)
}
