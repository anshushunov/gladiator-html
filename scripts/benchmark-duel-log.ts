// An informational benchmark for the duel adapter's whole-bout event log
// (`BattleState.events`, `src/simulation/battle.ts`) -- the shape the balance
// cohorts in `balance.test.ts` exercise ~6300 times per `npm test`, and the
// one issue #7 suspected of dominating `npm run check` by copying the whole
// accumulated log on every tick.
//
// Run with `npm run benchmark:duel-log`. It prints one line of metric JSON and
// exits 0; it exits nonzero only on a structural failure (a bout that never
// finishes, or an append strategy that produces a log differing from the
// reference concatenation). Nothing here asserts against a timing threshold.
//
// It works in two passes so the log can be timed apart from the simulation
// that feeds it -- otherwise a ~0.1% effect is invisible under the kernel's
// own noise:
//
//   1. Run a real cohort, recording every tick's real event batch and timing
//      the simulation itself. This is the scale the numbers below are read
//      against.
//   2. Replay those recorded batches through each append strategy, timing
//      each. Same input, same output, only the accumulation differs.
//
// A plain vite-node script, not `src/simulation/**`: free to use
// `performance.now()`, unlike simulation code itself (see
// `src/simulation/architecture.test.ts`).

import { COMBAT_STYLES } from '../src/content/combatStyles'
import { BASELINE_TEST_SEED, homeRoster, opponents } from '../src/content/mvpSeries'
import { advanceBattleTick, createBattle, MAX_BOUT_TICKS, type BattleState } from '../src/simulation/battle'
import type { EncounterEvent } from '../src/simulation/encounter'

const BOUTS_PER_PAIRING = 25

/** One recorded bout: the per-tick event batches it emitted, in tick order (including the creation tick's own batch first). */
type RecordedBout = readonly (readonly EncounterEvent[])[]

/**
 * How a state's `events` is built from its predecessor's. All three produce
 * the same log; they differ only in how much they copy to get there.
 */
type AppendStrategy = (previous: readonly EncounterEvent[], batch: readonly EncounterEvent[]) => readonly EncounterEvent[]

const strategies: Readonly<Record<string, AppendStrategy>> = {
  /** The floor: no accumulation at all. Not a candidate -- `BattleState.events` is the whole-bout log by contract -- just the cost of everything except the copy. */
  noLog: (_previous, batch) => batch,
  /** What `appendEvents` replaced: a fresh array every tick, including the nine ticks in ten that append nothing. */
  copyEveryTick: (previous, batch) => [...previous, ...batch],
  /** `appendEvents` as shipped: an empty batch keeps the previous array by reference (safe -- nothing mutates it). */
  copyOnEmit: (previous, batch) => (batch.length === 0 ? previous : [...previous, ...batch]),
}

function recordBout(home: (typeof homeRoster)[number], away: (typeof opponents)[number], seed: number): { batches: RecordedBout; ticks: number; traceHash: number } {
  let battle: BattleState = createBattle({ home, away, seed, combatStyles: COMBAT_STYLES })
  const batches: (readonly EncounterEvent[])[] = [battle.events]
  let seen = battle.events.length
  while (battle.phase === 'running' && battle.encounter.tick < MAX_BOUT_TICKS) {
    battle = advanceBattleTick(battle)
    // The tick's own batch, read the way `main.ts` reads it.
    batches.push(battle.events.slice(seen))
    seen = battle.events.length
  }
  if (battle.phase !== 'finished') {
    throw new Error(`benchmark-duel-log: structural failure -- bout ${home.id} vs ${away.id} at seed ${seed} never finished`)
  }
  return { batches, ticks: battle.encounter.tick, traceHash: battle.traceHash }
}

function recordCohort(): { bouts: RecordedBout[]; ticks: number; events: number; simulationMs: number; traceHash: number } {
  const bouts: RecordedBout[] = []
  let ticks = 0
  let events = 0
  let traceHash = 0
  const startTime = performance.now()
  for (const home of homeRoster) {
    for (const away of opponents) {
      for (let index = 0; index < BOUTS_PER_PAIRING; index += 1) {
        const bout = recordBout(home, away, BASELINE_TEST_SEED + index)
        bouts.push(bout.batches)
        ticks += bout.ticks
        events += bout.batches.reduce((total, batch) => total + batch.length, 0)
        traceHash = bout.traceHash
      }
    }
  }
  return { bouts, ticks, events, simulationMs: performance.now() - startTime, traceHash }
}

/**
 * Replays every recorded bout through one strategy, holding on to each
 * intermediate log exactly as a `BattleState` chain does. `checkedTotal` is
 * read back at the end so no strategy can be optimized away, and is the same
 * number for all three.
 */
function replay(bouts: readonly RecordedBout[], append: AppendStrategy): { elapsedMs: number; checkedTotal: number } {
  const startTime = performance.now()
  let checkedTotal = 0
  for (const batches of bouts) {
    let log: readonly EncounterEvent[] = []
    for (const batch of batches) log = append(log, batch)
    checkedTotal += log.length
  }
  return { elapsedMs: performance.now() - startTime, checkedTotal }
}

/** Every strategy must produce the identical log for a real bout, so a timing win can never come from dropping or reordering events. */
function verifyStrategies(bout: RecordedBout): number {
  const reference = bout.flat()
  for (const [name, append] of Object.entries(strategies)) {
    if (name === 'noLog') continue
    let log: readonly EncounterEvent[] = []
    for (const batch of bout) log = append(log, batch)
    if (log.length !== reference.length || log.some((event, index) => event !== reference[index])) {
      throw new Error(`benchmark-duel-log: structural failure -- strategy '${name}' produced a log differing from the reference concatenation`)
    }
  }
  return reference.length
}

function run(): void {
  const cohort = recordCohort()
  const verifiedEvents = verifyStrategies(cohort.bouts[0])

  const timings: Record<string, number> = {}
  for (const [name, append] of Object.entries(strategies)) {
    replay(cohort.bouts, append) // warm-up: a cold JIT is not what this measures
    timings[name] = replay(cohort.bouts, append).elapsedMs
  }

  console.log(JSON.stringify({
    bouts: cohort.bouts.length,
    ticks: cohort.ticks,
    events: cohort.events,
    simulationMs: cohort.simulationMs,
    logMs: timings,
    verifiedEvents,
    lastTraceHash: cohort.traceHash,
  }))
}

try {
  run()
  process.exit(0)
} catch (error) {
  console.error(error instanceof Error ? error.stack ?? error.message : String(error))
  process.exit(1)
}
