// The shared cohort-measurement method for the balance suites.
//
// This is a verbatim lift of the helpers that used to live inside
// `src/simulation/balance.test.ts`; the assertions, bands and cohort sizes
// stayed there. Nothing about how a bout is run or measured changed in the
// move -- `runBout` gained one OPTIONAL `startingHp` argument, and omitting it
// reaches `createBattle` as `undefined`, which is exactly what not passing the
// key at all did before.
//
// Why it lives here rather than being exported from `balance.test.ts`: Vitest
// registers a `describe` against whichever file is *being collected*, so a
// second test file that imported `balance.test.ts` for its helper would also
// register -- and re-run -- both 200/500-seed cohorts inside itself. That is
// 290s of duplicated simulation on every `npm test`, i.e. the same defect
// commit 5a0a52a removed when it anchored Vitest's file collection. Sharing
// through `src/testSupport/` keeps one implementation of the method with no
// duplicated execution.
//
// Like `combatFixtures.ts`, this file may compose simulation contracts with
// `src/content/**`: that is allowed in `src/testSupport/**` and nowhere inside
// `src/simulation/**` (see `src/simulation/architecture.test.ts`).

import { COMBAT_STYLES } from '../content/combatStyles'
import { BASELINE_TEST_SEED } from '../content/mvpSeries'
import { advanceBattleTick, createBattle, MAX_BOUT_TICKS, type BattleConfig } from '../simulation/battle'
import type { FighterDefinition } from '../simulation/fighters'

/**
 * Nearest-rank percentile over an already-sorted ascending sample, matching the
 * brief's authored formula exactly. `fraction` 0.5 is the median.
 */
export function percentile(sorted: readonly number[], fraction: number): number {
  return sorted[Math.floor((sorted.length - 1) * fraction)]
}

export interface PairingMetrics {
  homeWinRate: number
  medianTicks: number
  p10Ticks: number
  p95Ticks: number
  timeoutRate: number
  resolutionGapP95Ticks: number
  /** p95 of the opening approach: ticks from the start of the bout to its first local resolution. See `runBout`. */
  approachP95Ticks: number
  /** Bouts that never resolved anything at all, so they had no "after initial approach" window to measure. */
  unresolvedBouts: number
}

export interface BoutOutcome {
  homeWon: boolean
  durationTicks: number
  reachedTickLimit: boolean
  /** Longest run of ticks with no local resolution, measured after the first one (see `runBout`). */
  maxResolutionGapTicks: number
  /** Tick of the bout's first local resolution, or the whole bout's duration if it never had one (see `runBout`). */
  firstResolutionTick: number
  /** False when the bout ended without a single resolution -- there was no window to measure, and `firstResolutionTick` above is a floor, not a measurement. */
  resolved: boolean
}

/**
 * Runs one complete bout and measures it.
 *
 * The resolution gap is read from the combatants' own `lastResolutionTick`
 * clocks -- simulation state, never wall time -- which the kernel updates for
 * both living participants on every hit, block, parry, evade, geometry miss and
 * accuracy miss. Measurement starts at the FIRST resolution, which is how the
 * design's "at most 300 ticks after initial approach" is read: the opening walk
 * from the duel's 8.4-unit start separation is not a stall.
 *
 * A bout in which nothing ever resolves has no "after initial approach" window
 * at all; it is reported as a gap equal to the whole bout so it can never look
 * better than a bout that merely stalled for a while.
 *
 * The approach the gap metric excludes is measured in its own right and
 * returned as `firstResolutionTick`. design.md bounds the gap "after initial
 * approach" and says nothing about the approach itself, which leaves the one
 * window the pacing check refuses to look at unbounded: a bout that circled
 * for two thousand ticks before its first exchange and then traded cleanly
 * scores exactly as well as one that engaged immediately. `resolved` marks
 * the degenerate case where there was no approach to measure either.
 *
 * `startingHp` is optional and defaults to "both sides at their own `maxHp`",
 * which is what `createBattle` already does for an absent key. It exists so the
 * season cohorts can measure a `wounded` gladiator on the same method rather
 * than a parallel one.
 */
export function runBout(
  home: FighterDefinition,
  away: FighterDefinition,
  seed: number,
  startingHp?: BattleConfig['startingHp'],
): BoutOutcome {
  let battle = createBattle({ home, away, seed, combatStyles: COMBAT_STYLES, startingHp })
  const ids = [battle.descriptor.homeId, battle.descriptor.awayId]
  let firstResolutionTick = -1
  let maxGap = 0

  while (battle.phase === 'running' && battle.encounter.tick < MAX_BOUT_TICKS) {
    battle = advanceBattleTick(battle)
    const lastResolution = Math.max(...ids.map((id) => battle.encounter.combatants[id].lastResolutionTick))
    if (lastResolution > 0 && firstResolutionTick < 0) firstResolutionTick = lastResolution
    if (firstResolutionTick >= 0) maxGap = Math.max(maxGap, battle.encounter.tick - lastResolution)
  }

  return {
    homeWon: battle.winnerSide === 'home',
    durationTicks: battle.encounter.tick,
    reachedTickLimit: battle.finishReason === 'time-limit',
    maxResolutionGapTicks: firstResolutionTick < 0 ? battle.encounter.tick : maxGap,
    firstResolutionTick: firstResolutionTick < 0 ? battle.encounter.tick : firstResolutionTick,
    resolved: firstResolutionTick >= 0,
  }
}

export function measure(outcomes: readonly BoutOutcome[]): PairingMetrics {
  const durations = outcomes.map((o) => o.durationTicks).sort((a, b) => a - b)
  const gaps = outcomes.map((o) => o.maxResolutionGapTicks).sort((a, b) => a - b)
  const approaches = outcomes.map((o) => o.firstResolutionTick).sort((a, b) => a - b)
  return {
    homeWinRate: outcomes.filter((o) => o.homeWon).length / outcomes.length,
    medianTicks: percentile(durations, 0.5),
    p10Ticks: percentile(durations, 0.1),
    p95Ticks: percentile(durations, 0.95),
    timeoutRate: outcomes.filter((o) => o.reachedTickLimit).length / outcomes.length,
    resolutionGapP95Ticks: percentile(gaps, 0.95),
    approachP95Ticks: percentile(approaches, 0.95),
    unresolvedBouts: outcomes.filter((o) => !o.resolved).length,
  }
}

/** `seedIndex` 0..n-1 maps to 200 (or 500) CONSECUTIVE seeds beginning at the design's fixed 20260815. */
export const cohortSeed = (seedIndex: number): number => BASELINE_TEST_SEED + seedIndex

/**
 * How many bouts to simulate between yields to the event loop.
 *
 * These cohorts are thousands of bouts of synchronous simulation. Run as one
 * uninterrupted block they starve the Vitest worker's RPC heartbeat, which
 * reports `Timeout calling "onTaskUpdate"` as an unhandled error and makes
 * `npm test` exit non-zero even though every assertion passed -- a suite that
 * is green but failing is worse than one that is simply red. Yielding
 * periodically keeps the worker responsive and progress reporting alive. It
 * does not touch determinism: the bouts themselves are pure and are still run
 * in a fixed order over a fixed seed range.
 */
export const BOUTS_PER_YIELD = 25

export const yieldToEventLoop = () => new Promise<void>((resolve) => { setTimeout(resolve, 0) })

export async function cohort(
  home: FighterDefinition,
  away: FighterDefinition,
  seedCount: number,
  startingHp?: BattleConfig['startingHp'],
): Promise<BoutOutcome[]> {
  const outcomes: BoutOutcome[] = []
  for (let index = 0; index < seedCount; index += 1) {
    outcomes.push(runBout(home, away, cohortSeed(index), startingHp))
    if ((index + 1) % BOUTS_PER_YIELD === 0) await yieldToEventLoop()
  }
  return outcomes
}

/** Prints one compact table. Called only from a failure path, so a passing suite is silent. */
export function reportTable(title: string, rows: readonly (readonly string[])[]): void {
  const widths = rows[0].map((_, column) => Math.max(...rows.map((row) => row[column].length)))
  const lines = rows.map((row) => row.map((cell, column) => cell.padStart(widths[column])).join('  '))
  // eslint-disable-next-line no-console
  console.log(`\n[balance] ${title}\n${lines.join('\n')}\n`)
}

export const pct = (value: number) => `${(value * 100).toFixed(1)}%`
