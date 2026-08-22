// ===========================================================================
// The FIXED balance cohorts for per-bout orders (bout-orders-design.md,
// "Balance acceptance"). Same discipline as `balance.test.ts` and
// `seasonBalance.test.ts`: the seed range, the cohort definitions, the metric
// formulas and the four numeric criteria below are test data. They may not be
// edited to make a run pass. The only legitimate responses to a red run are
// tuning `disposition.ts`'s two magnitudes inside their authored ranges,
// re-authoring a challenge's temperaments, or reporting that no setting
// satisfies the criteria -- never a widened band.
//
// This is the file that decides whether an order is a real decision rather
// than a cosmetic one, so it measures three cohorts rather than one:
//
//   A. veterans x unscaled opponents x home order in {standard, press, guarded}
//      -- 27 cohorts. Is the risk/reward trade real, and is any order simply
//      the right answer everywhere?
//   B. veterans x cassius carrying a temperament in {press, guarded} x the same
//      three home orders -- 18 cohorts. Does the opponent's temperament change
//      which order is best, i.e. is the choice informed by the briefing?
//   C. all nine pairings with BOTH sides guarded -- 9 cohorts. The degenerate
//      case the mechanic could produce: two fighters who both want distance and
//      both refuse committed attacks, staring at each other until the tick
//      limit.
//
// Every cohort is measured once, in the suite's `beforeAll`, over the same 200
// consecutive seeds from 20260815 that the other two balance suites use, and
// through the same `cohort`/`runBout` method in `src/testSupport`. 10800 bouts
// of full-fidelity simulation, so the timeout is generous on purpose: a slow CI
// machine must not turn a balance statement into a flake. On failure each block
// prints the grid it read, so a tuning pass sees the whole picture without a
// rerun; a passing suite is silent.
//
// STATUS AS COMMITTED (2026-08-22): criterion 2 passes; criteria 1, 3 and 4 are
// RED, and the tuning loop established that no magnitude in the authored ranges
// (COMMITTED_ADJUST 4..8 x LOCOMOTION_ADJUST 3..6, all 20 cells measured) fixes
// them -- two of the three cannot be satisfied by any magnitude, because they
// conflict arithmetically with their own companion clauses. One line each:
// criterion 1's `lowHpShare` counts losses, so it is anti-correlated with the
// win-rate clause three lines above it; criterion 3's cohort never reads the
// `TEMPERAMENTS` rows nominated as its lever; criterion 4's 900-tick median
// window is narrower than the roster's own 1040-tick spread of both-guarded
// medians. The criteria are left exactly as authored -- amending them is a
// design decision, not a tuning one. Full grids, the 20-cell sweep and the
// algebra: `.superpowers/sdd/2026-08-22-bout-orders/task-5-report.md`.
// ===========================================================================

import { beforeAll, describe, expect, it } from 'vitest'
import { homeRoster, opponents } from '../content/mvpSeries'
import { cohort, pct, percentile, reportTable, type BoutOutcome } from '../testSupport/balanceCohorts'
import { DISPOSITION_IDS, type DispositionId } from './disposition'

const SEED_COUNT = 200
/** Generous on purpose: 10800 full-fidelity bouts, and a slow CI machine must not turn a balance statement into a flake. */
const COHORT_TIMEOUT_MS = 1_800_000

/** The `condition.ts` wear boundary, read here as "did the gladiator walk away in one piece". */
const WEAR_THRESHOLD = 0.25

/** The temperaments cohort B puts on Cassius. `standard` is cohort A's baseline and is not repeated here. */
const AWAY_TEMPERAMENTS: readonly DispositionId[] = ['press', 'guarded']

const CASSIUS = opponents.find((opponent) => opponent.id === 'cassius')!

interface OrderMetrics {
  homeWinRate: number
  /** Share of bouts the home fighter ended below the wear threshold -- losses included, since a loser is at zero. */
  lowHpShare: number
  /** Share of bouts won with HP to spare: the "cheap win" the wear system does not charge for. */
  cheapWearShare: number
  timeoutRate: number
  medianTicks: number
}

function measureOrder(outcomes: readonly BoutOutcome[]): OrderMetrics {
  const durations = outcomes.map((outcome) => outcome.durationTicks).sort((a, b) => a - b)
  const share = (predicate: (outcome: BoutOutcome) => boolean) => outcomes.filter(predicate).length / outcomes.length
  return {
    homeWinRate: share((outcome) => outcome.homeWon),
    lowHpShare: share((outcome) => outcome.homeRemainingHpRatio < WEAR_THRESHOLD),
    cheapWearShare: share((outcome) => outcome.homeWon && outcome.homeRemainingHpRatio >= WEAR_THRESHOLD),
    timeoutRate: share((outcome) => outcome.reachedTickLimit),
    medianTicks: percentile(durations, 0.5),
  }
}

// ---------------------------------------------------------------------------
// Cohorts, measured once
// ---------------------------------------------------------------------------

const PAIRINGS = homeRoster.flatMap((home) => opponents.map((away) => ({ home, away, label: `${home.id}/${away.id}` })))

const orderedKey = (label: string, order: DispositionId) => `${label}:${order}`
const temperamentKey = (fighterId: string, order: DispositionId, temperament: DispositionId) => `${fighterId}:${order}:vs-${temperament}`

/** A: pairing x home order. B: veteran x home order x Cassius's temperament. C: pairing, both sides guarded. */
const cohortA = new Map<string, OrderMetrics>()
const cohortB = new Map<string, OrderMetrics>()
const cohortC = new Map<string, OrderMetrics>()

/** Reads a measured cohort, throwing rather than silently returning `undefined` if a block asks for one that was never run. */
function read(measured: Map<string, OrderMetrics>, key: string): OrderMetrics {
  const metrics = measured.get(key)
  if (metrics === undefined) throw new Error(`No cohort measured for ${key}`)
  return metrics
}

const mean = (values: readonly number[]): number => values.reduce((sum, value) => sum + value, 0) / values.length

/** The three orders' metrics for one pairing, in `DISPOSITION_IDS` order. */
const ordersFor = (label: string): OrderMetrics[] => DISPOSITION_IDS.map((order) => read(cohortA, orderedKey(label, order)))

const metricRow = (metrics: OrderMetrics): string[] => [
  pct(metrics.homeWinRate), pct(metrics.lowHpShare), pct(metrics.cheapWearShare), pct(metrics.timeoutRate), String(metrics.medianTicks),
]
const METRIC_HEADINGS = ['win%', 'lowHp%', 'cheap%', 'timeout%', 'median']

const cohortATable = (): string[][] => [
  ['pairing', 'order', ...METRIC_HEADINGS],
  ...PAIRINGS.flatMap(({ label }) => DISPOSITION_IDS.map((order) => [label, order, ...metricRow(read(cohortA, orderedKey(label, order)))])),
]

const cohortBTable = (): string[][] => [
  ['veteran', 'order', 'cassius', ...METRIC_HEADINGS],
  ...homeRoster.flatMap((veteran) => AWAY_TEMPERAMENTS.flatMap((temperament) => DISPOSITION_IDS.map((order) => [
    veteran.id, order, temperament, ...metricRow(read(cohortB, temperamentKey(veteran.id, order, temperament))),
  ]))),
]

const cohortCTable = (): string[][] => [
  ['pairing', ...METRIC_HEADINGS.map((heading) => `guarded ${heading}`), 'std timeout%', 'std median'],
  ...PAIRINGS.map(({ label }) => [
    label,
    ...metricRow(read(cohortC, label)),
    pct(read(cohortA, orderedKey(label, 'standard')).timeoutRate),
    String(read(cohortA, orderedKey(label, 'standard')).medianTicks),
  ]),
]

describe('disposition balance cohorts (three orders x nine pairings x 200 consecutive seeds from 20260815)', () => {
  beforeAll(async () => {
    for (const { home, away, label } of PAIRINGS) {
      for (const order of DISPOSITION_IDS) {
        cohortA.set(orderedKey(label, order), measureOrder(await cohort(home, away, SEED_COUNT, undefined, { home: order })))
      }
      cohortC.set(label, measureOrder(await cohort(home, away, SEED_COUNT, undefined, { home: 'guarded', away: 'guarded' })))
    }
    for (const veteran of homeRoster) {
      for (const temperament of AWAY_TEMPERAMENTS) {
        for (const order of DISPOSITION_IDS) {
          cohortB.set(
            temperamentKey(veteran.id, order, temperament),
            measureOrder(await cohort(veteran, CASSIUS, SEED_COUNT, undefined, { home: order, away: temperament })),
          )
        }
      }
    }
  }, COHORT_TIMEOUT_MS)

  // -------------------------------------------------------------------------
  // 1. Risk/reward is real
  // -------------------------------------------------------------------------

  it('buys press its extra wins with wear and pays guarded for its lost wins in health', () => {
    const failures: string[] = []
    const pressWinGains: number[] = []
    const guardWinLosses: number[] = []
    const pressWearGains: number[] = []
    const guardWearSavings: number[] = []

    for (const { label } of PAIRINGS) {
      const [std, press, guard] = ordersFor(label)
      if (press.homeWinRate < std.homeWinRate - 0.02) {
        failures.push(`${label}: press wins ${pct(press.homeWinRate)}, more than two points below standard's ${pct(std.homeWinRate)}`)
      }
      if (guard.homeWinRate > std.homeWinRate + 0.02) {
        failures.push(`${label}: guarded wins ${pct(guard.homeWinRate)}, more than two points above standard's ${pct(std.homeWinRate)}`)
      }
      pressWinGains.push(press.homeWinRate - std.homeWinRate)
      guardWinLosses.push(std.homeWinRate - guard.homeWinRate)
      pressWearGains.push(press.lowHpShare - std.lowHpShare)
      guardWearSavings.push(std.lowHpShare - guard.lowHpShare)
    }

    const check = (values: readonly number[], description: string) => {
      if (mean(values) < 0.03) failures.push(`${description} averages ${pct(mean(values))} across the nine pairings, below three points`)
    }
    check(pressWinGains, "press's win-rate gain over standard")
    check(guardWinLosses, "guarded's win-rate loss against standard")
    check(pressWearGains, "press's extra share of bouts ending below 25% HP")
    check(guardWearSavings, "guarded's saved share of bouts ending below 25% HP")

    if (failures.length > 0) reportTable('disposition cohort A -- pairing x home order', cohortATable())
    expect(failures).toEqual([])
  })

  // -------------------------------------------------------------------------
  // 2. No dominant order
  // -------------------------------------------------------------------------

  it('leaves no order that both wins the most and costs the least on every pairing', () => {
    const failures: string[] = []

    for (const order of DISPOSITION_IDS) {
      const dominates = PAIRINGS.every(({ label }) => {
        const all = ordersFor(label)
        const mine = read(cohortA, orderedKey(label, order))
        return mine.homeWinRate >= Math.max(...all.map((m) => m.homeWinRate))
          && mine.cheapWearShare >= Math.max(...all.map((m) => m.cheapWearShare))
      })
      if (dominates) failures.push(`${order} maximizes both win rate and cheap-win share on all nine pairings, so the other two orders are never worth picking`)
    }

    if (failures.length > 0) reportTable('disposition cohort A -- pairing x home order', cohortATable())
    expect(failures).toEqual([])
  })

  // -------------------------------------------------------------------------
  // 3. Temperament changes the answer
  // -------------------------------------------------------------------------

  it("reorders at least one veteran's three orders when Cassius switches temperament", () => {
    /** The three orders best-first by win rate; ties keep `DISPOSITION_IDS` order, so the string is a deterministic reading of the cohort. */
    const ranking = (veteranId: string, temperament: DispositionId): string =>
      [...DISPOSITION_IDS]
        .map((order) => ({ order, rate: read(cohortB, temperamentKey(veteranId, order, temperament)).homeWinRate }))
        .sort((a, b) => b.rate - a.rate)
        .map(({ order }) => order)
        .join('>')

    const rankings = homeRoster.map((veteran) => ({
      veteranId: veteran.id,
      versusPress: ranking(veteran.id, 'press'),
      versusGuarded: ranking(veteran.id, 'guarded'),
    }))
    const failures = rankings.some(({ versusPress, versusGuarded }) => versusPress !== versusGuarded)
      ? []
      : [`no veteran reorders: ${rankings.map((r) => `${r.veteranId} ranks ${r.versusPress} against either temperament`).join('; ')}`]

    if (failures.length > 0) reportTable('disposition cohort B -- veteran x order x Cassius temperament', cohortBTable())
    expect(failures).toEqual([])
  })

  // -------------------------------------------------------------------------
  // 4. No stall collapse
  // -------------------------------------------------------------------------

  it('keeps a bout in which both sides are guarded from collapsing into a staring contest', () => {
    const failures: string[] = []

    for (const { label } of PAIRINGS) {
      const guarded = read(cohortC, label)
      const standard = read(cohortA, orderedKey(label, 'standard'))
      const cap = Math.max(0.30, 2 * standard.timeoutRate)
      if (guarded.timeoutRate > cap) {
        failures.push(`${label}: both guarded times out ${pct(guarded.timeoutRate)} of the time, above the ${pct(cap)} cap`)
      }
      if (guarded.medianTicks < 1500 || guarded.medianTicks > 2400) {
        failures.push(`${label}: both guarded runs a median ${guarded.medianTicks} ticks, outside 1500..2400`)
      }
    }

    if (failures.length > 0) reportTable('disposition cohort C -- both sides guarded, against cohort A standard', cohortCTable())
    expect(failures).toEqual([])
  })
})
