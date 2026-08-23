// ===========================================================================
// The FIXED balance cohorts for per-bout orders (bout-orders-design.md,
// "Balance acceptance"). Same discipline as `balance.test.ts` and
// `seasonBalance.test.ts`: the seed range, the cohort definitions, the metric
// formulas and the four numeric criteria below are test data. They may not be
// edited to make a run pass. The only legitimate responses to a red run are
// tuning `disposition.ts`'s two magnitudes inside their authored ranges, or
// reporting that no setting satisfies the criteria -- never a widened band.
// (That report was made once already and the criteria were amended by the
// owner as a result; see below. The amended text is now the binding one and is
// under the same rule.)
//
// This is the file that decides whether an order is a real decision rather
// than a cosmetic one, so it measures three cohorts rather than one:
//
//   A. veterans x unscaled opponents x home order in {standard, press, guarded}
//      -- 27 cohorts. Is the risk/reward trade real, and is any order simply
//      the right answer everywhere?
//   B. veterans x cassius carrying a temperament in {press, guarded} x the same
//      three home orders -- 18 cohorts. Does the opponent's temperament move the
//      bout at all, i.e. is the briefing worth reading?
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
// CRITERION 1'S THINNEST CLAUSE. At the shipped magnitudes the
// `bloodyWinShare press-std` mean clears its 0.02 floor by only 0.0072 (0.0272
// measured). It is the first clause that moves if the combat kernel, the action
// tags or the roster change, and a red run there is a real finding about the
// mechanic rather than noise -- read it before reaching for the magnitudes.
//
// The criteria below are the AMENDED ones (design doc, "Balance acceptance",
// amended 2026-08-22 after measurement). The first authoring of criteria 1, 3
// and 4 was measured unsatisfiable at every magnitude in range. Two runs, not
// one, and they are different sizes: the exploratory sweep was the full
// COMMITTED_ADJUST 4..8 x LOCOMOTION_ADJUST 3..6 grid, 20 cells of cohort A
// over 60 seeds -- 60 seeds x 27 cohorts = 1620 bouts per cell, 32 400 in all;
// the 10 800-bout figure above is the SEPARATE 200-seed confirmation run at the
// shipped magnitudes, i.e. one cell measured at this suite's own cohort size.
// The reasons the criteria failed were properties of the metrics rather than of
// the mechanic.
// The three that were replaced are recorded here so a future reader does not
// re-derive them:
//
//  - Criterion 1 used to bound `lowHpShare = share(ratio < 0.25)`. That counts
//    LOSSES, because the loser is at zero HP, so at this cohort's ~0% timeout
//    rate it is exactly `1 - cheapWearShare` and moves AGAINST the win-rate
//    clause sitting above it: asking press to win more and to end below 25% HP
//    more often is asking its bloody-win share to exceed standard's by more
//    than its whole win-rate advantage. It now bounds `bloodyWinShare`
//    directly, which is the quantity the design was reaching for. Criterion 1
//    also used to carry per-pairing `press >= std - 0.02` / `guard <= std + 0.02`
//    clauses; those forbid the counter triangle `balance.test.ts` already
//    asserts (Nerva is Technical, Drusus is Fast: pressing into the fighter who
//    counters you is correctly a bad idea, by 7.0 points) and pull directly
//    against criterion 2.
//
//  - Criterion 3 used to require a RANKING FLIP: that some veteran's three
//    orders reorder by win rate when Cassius switches temperament. Measured, no
//    veteran reorders, and none can -- Cassius's temperament shifts all three of
//    a veteran's win rates in the SAME direction without changing which is best:
//
//        brutus  press > standard > guarded   82.0/56.5/41.0 vs press,  82.5/57.0/48.5 vs guarded
//        aquila  press > standard > guarded   53.0/35.0/15.5 vs press,  64.0/42.5/29.5 vs guarded
//        nerva   guarded > standard > press   74.5/68.5/64.5 vs press,  70.0/55.0/49.0 vs guarded
//
//    Nor was there a lever: the criterion nominated `TEMPERAMENTS` in
//    `content/season.ts`, but cohort B constructs the away disposition directly
//    and never reads `SEASON_CHALLENGES`. The finding is that in this build
//    temperament is a DIFFICULTY dial, not an order-selection dial -- which is
//    what the replacement criterion measures. The order choice is informed by
//    WHO you fight, not by how they fight.
//
//  - Criterion 4 used to band the both-guarded median at 1500..2400. That
//    900-tick window is narrower than the roster's own spread of both-guarded
//    medians (1301 for `nerva/cassius` to 2341 for `aquila/drusus`, 1040 ticks),
//    and `LOCOMOTION_ADJUST` shifts all nine together without compressing them,
//    so no setting could fit. It is now `balance.test.ts`'s own per-pairing band.
//    The anti-stall property the criterion exists for was never in doubt: the
//    worst both-guarded timeout rate is 1.0% against a 30% cap.
//
// Full grids, the 20-cell sweep and the algebra:
// `.superpowers/sdd/2026-08-22-bout-orders/task-5-report.md`.
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
  /** Share of bouts won from under the wear threshold: the win that still costs two rungs of condition. Criterion 1's risk term. */
  bloodyWinShare: number
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
    bloodyWinShare: share((outcome) => outcome.homeWon && outcome.homeRemainingHpRatio < WEAR_THRESHOLD),
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
  pct(metrics.homeWinRate), pct(metrics.bloodyWinShare), pct(metrics.cheapWearShare), pct(metrics.timeoutRate), String(metrics.medianTicks),
]
const METRIC_HEADINGS = ['win%', 'bloody%', 'cheap%', 'timeout%', 'median']

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

  it('buys press its extra wins with wear and lets guarded trade wins for clean ones', () => {
    const failures: string[] = []
    const pressWinGains: number[] = []
    const guardWinLosses: number[] = []
    const pressRiskGains: number[] = []
    const guardRiskSavings: number[] = []

    for (const { label } of PAIRINGS) {
      const [std, press, guard] = ordersFor(label)
      pressWinGains.push(press.homeWinRate - std.homeWinRate)
      guardWinLosses.push(std.homeWinRate - guard.homeWinRate)
      pressRiskGains.push(press.bloodyWinShare - std.bloodyWinShare)
      guardRiskSavings.push(std.bloodyWinShare - guard.bloodyWinShare)
    }

    // Every clause is a mean over the nine pairings, never a per-pairing bound:
    // the counter triangle makes press genuinely wrong against some opponents
    // and guarded genuinely right against others, which is the point of
    // criterion 2 below.
    const check = (values: readonly number[], floor: number, description: string) => {
      if (mean(values) < floor) failures.push(`${description} averages ${pct(mean(values))} across the nine pairings, below ${pct(floor)}`)
    }
    check(pressWinGains, 0.03, "press's win-rate gain over standard")
    check(guardWinLosses, 0.03, "guarded's win-rate loss against standard")
    check(pressRiskGains, 0.02, "press's extra share of bouts won from under 25% HP")
    check(guardRiskSavings, 0.02, "guarded's saved share of bouts won from under 25% HP")

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
  // 3. Temperament changes the difficulty
  // -------------------------------------------------------------------------

  it("moves a veteran's win rate by five points on average when Cassius switches temperament", () => {
    // The amended property: temperament is a DIFFICULTY dial. It is measured as
    // the mean ABSOLUTE swing over all nine veteran x home-order cells, so a
    // temperament that merely renamed itself -- one that shifted nothing, or
    // shifted one cell a long way and eight not at all -- cannot pass. Direction
    // is deliberately not asserted: which of press/guarded is the harder Cassius
    // is the roster's business, not this criterion's. The ranking-flip criterion
    // this replaces, and why it was false, is in the header comment.
    const swings = homeRoster.flatMap((veteran) => DISPOSITION_IDS.map((order) => Math.abs(
      read(cohortB, temperamentKey(veteran.id, order, 'press')).homeWinRate
      - read(cohortB, temperamentKey(veteran.id, order, 'guarded')).homeWinRate,
    )))

    const failures = mean(swings) >= 0.05
      ? []
      : [`Cassius's temperament moves a veteran's win rate by ${pct(mean(swings))} on average across the nine veteran x order cells, below five points`]

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
      // `balance.test.ts`'s own per-pairing band, so a guarded bout is held to
      // exactly the pacing the roster was calibrated against -- no wider, and no
      // narrower than the spread the roster already has at `standard`.
      if (guarded.medianTicks < 1200 || guarded.medianTicks > 2700) {
        failures.push(`${label}: both guarded runs a median ${guarded.medianTicks} ticks, outside 1200..2700`)
      }
    }

    if (failures.length > 0) reportTable('disposition cohort C -- both sides guarded, against cohort A standard', cohortCTable())
    expect(failures).toEqual([])
  })
})
