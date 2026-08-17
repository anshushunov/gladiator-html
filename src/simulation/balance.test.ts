// ===========================================================================
// The design's FIXED statistical balance cohorts (readable-deep-combat-design.md,
// "Balance acceptance"). These are acceptance bands, not regression snapshots:
// the seed ranges and the metric formulas are test data that may not be changed
// to make a run pass. If tuning cannot satisfy a band, the correct outcome is a
// red test and a reported distribution -- never a widened band.
//
// Two cohorts, measured independently:
//
//  - ROSTER cohorts: all nine home-vs-opponent pairings over 200 consecutive
//    seeds beginning at 20260815. These exercise the actual shipped content, so
//    they answer "is this roster balanced and does it pace well".
//  - EQUAL-STAT STYLE cohorts: 500 seeds per ordered style matchup with
//    identical fighter stats, varying only the archetype. These isolate the
//    styles themselves from the roster's numbers, so they answer "is the
//    counter triangle real and soft".
//
// Runtime: roughly 1800 + 4500 bouts of full-fidelity simulation. Each cohort
// gets a generous explicit timeout because the default 5s is nowhere near
// enough, and a slow CI machine must not turn a balance statement into a
// flake. On assertion failure each block prints one compact table so the
// measured distribution is visible without a rerun; a passing suite stays
// silent.
// ===========================================================================

import { describe, expect, it } from 'vitest'
import { COMBAT_STYLES } from '../content/combatStyles'
import { BASELINE_TEST_SEED, homeRoster, opponents } from '../content/mvpSeries'
import { advanceBattleTick, createBattle, MAX_BOUT_TICKS } from './battle'
import type { Archetype, FighterDefinition } from './fighters'

const ROSTER_SEED_COUNT = 200
const STYLE_SEED_COUNT = 500
const COHORT_TIMEOUT_MS = 600_000

// ---------------------------------------------------------------------------
// Metrics
// ---------------------------------------------------------------------------

/**
 * Nearest-rank percentile over an already-sorted ascending sample, matching the
 * brief's authored formula exactly. `fraction` 0.5 is the median.
 */
function percentile(sorted: readonly number[], fraction: number): number {
  return sorted[Math.floor((sorted.length - 1) * fraction)]
}

interface PairingMetrics {
  homeWinRate: number
  medianTicks: number
  p10Ticks: number
  p95Ticks: number
  timeoutRate: number
  resolutionGapP95Ticks: number
}

interface BoutOutcome {
  homeWon: boolean
  durationTicks: number
  reachedTickLimit: boolean
  /** Longest run of ticks with no local resolution, measured after the first one (see `runBout`). */
  maxResolutionGapTicks: number
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
 */
function runBout(home: FighterDefinition, away: FighterDefinition, seed: number): BoutOutcome {
  let battle = createBattle({ home, away, seed, combatStyles: COMBAT_STYLES })
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
  }
}

function measure(outcomes: readonly BoutOutcome[]): PairingMetrics {
  const durations = outcomes.map((o) => o.durationTicks).sort((a, b) => a - b)
  const gaps = outcomes.map((o) => o.maxResolutionGapTicks).sort((a, b) => a - b)
  return {
    homeWinRate: outcomes.filter((o) => o.homeWon).length / outcomes.length,
    medianTicks: percentile(durations, 0.5),
    p10Ticks: percentile(durations, 0.1),
    p95Ticks: percentile(durations, 0.95),
    timeoutRate: outcomes.filter((o) => o.reachedTickLimit).length / outcomes.length,
    resolutionGapP95Ticks: percentile(gaps, 0.95),
  }
}

/** `seedIndex` 0..n-1 maps to 200 (or 500) CONSECUTIVE seeds beginning at the design's fixed 20260815. */
const cohortSeed = (seedIndex: number): number => BASELINE_TEST_SEED + seedIndex

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
const BOUTS_PER_YIELD = 25

const yieldToEventLoop = () => new Promise<void>((resolve) => { setTimeout(resolve, 0) })

async function cohort(home: FighterDefinition, away: FighterDefinition, seedCount: number): Promise<BoutOutcome[]> {
  const outcomes: BoutOutcome[] = []
  for (let index = 0; index < seedCount; index += 1) {
    outcomes.push(runBout(home, away, cohortSeed(index)))
    if ((index + 1) % BOUTS_PER_YIELD === 0) await yieldToEventLoop()
  }
  return outcomes
}

/** Prints one compact table. Called only from a failure path, so a passing suite is silent. */
function reportTable(title: string, rows: readonly (readonly string[])[]): void {
  const widths = rows[0].map((_, column) => Math.max(...rows.map((row) => row[column].length)))
  const lines = rows.map((row) => row.map((cell, column) => cell.padStart(widths[column])).join('  '))
  // eslint-disable-next-line no-console
  console.log(`\n[balance] ${title}\n${lines.join('\n')}\n`)
}

const pct = (value: number) => `${(value * 100).toFixed(1)}%`

// ---------------------------------------------------------------------------
// Roster cohorts
// ---------------------------------------------------------------------------

describe('fixed roster balance cohorts (nine pairings x 200 consecutive seeds from 20260815)', () => {
  it('meets every roster band', async () => {
    const perPairing: { label: string; metrics: PairingMetrics }[] = []
    const allOutcomes: BoutOutcome[] = []

    for (const home of homeRoster) {
      for (const away of opponents) {
        const outcomes = await cohort(home, away, ROSTER_SEED_COUNT)
        allOutcomes.push(...outcomes)
        perPairing.push({ label: `${home.id}/${away.id}`, metrics: measure(outcomes) })
      }
    }

    const combined = measure(allOutcomes)
    const failures: string[] = []
    const check = (ok: boolean, description: string) => { if (!ok) failures.push(description) }

    for (const { label, metrics } of perPairing) {
      check(metrics.homeWinRate >= 0.15 && metrics.homeWinRate <= 0.85, `${label} home win rate ${pct(metrics.homeWinRate)} outside 15..85%`)
      check(metrics.medianTicks >= 1200 && metrics.medianTicks <= 2700, `${label} median ${metrics.medianTicks} outside 1200..2700`)
    }
    check(combined.medianTicks >= 1500 && combined.medianTicks <= 2400, `combined median ${combined.medianTicks} outside 1500..2400`)
    check(combined.p10Ticks >= 900, `duration p10 ${combined.p10Ticks} below 900`)
    check(combined.p95Ticks < 3200, `duration p95 ${combined.p95Ticks} not below 3200`)
    check(combined.timeoutRate < 0.02, `timeout rate ${pct(combined.timeoutRate)} not below 2%`)
    check(combined.resolutionGapP95Ticks <= 300, `resolution-gap p95 ${combined.resolutionGapP95Ticks} above 300`)

    if (failures.length > 0) {
      reportTable('roster cohorts', [
        ['pairing', 'win%', 'median', 'p10', 'p95', 'timeout%', 'gapP95'],
        ...perPairing.map(({ label, metrics }) => [
          label, pct(metrics.homeWinRate), String(metrics.medianTicks), String(metrics.p10Ticks),
          String(metrics.p95Ticks), pct(metrics.timeoutRate), String(metrics.resolutionGapP95Ticks),
        ]),
        ['COMBINED', pct(combined.homeWinRate), String(combined.medianTicks), String(combined.p10Ticks),
          String(combined.p95Ticks), pct(combined.timeoutRate), String(combined.resolutionGapP95Ticks)],
      ])
    }

    expect(failures).toEqual([])
  }, COHORT_TIMEOUT_MS)
})

// ---------------------------------------------------------------------------
// Equal-stat style cohorts
// ---------------------------------------------------------------------------

const STYLES: readonly Archetype[] = ['heavy', 'fast', 'technical']

/**
 * Identical stats for every style, so the only difference between two
 * combatants in this cohort is the archetype. These numbers are cohort fixture
 * data and are deliberately NOT read from `mvpSeries.ts` -- roster tuning must
 * not be able to move a style band.
 */
function equalStatFighter(id: string, archetype: Archetype): FighterDefinition {
  return { id, name: id, school: 'Style Cohort', archetype, maxHp: 160, power: 20, accuracy: 0.88, defenseChance: 0.35, criticalChance: 0.12 }
}

/** design.md's counter triangle: `heavy -> fast -> technical -> heavy`, where the arrow means "has an advantage against". */
const ADVANTAGED: ReadonlySet<string> = new Set(['heavy>fast', 'fast>technical', 'technical>heavy'])

describe('fixed equal-stat style cohorts (500 seeds per ordered matchup)', () => {
  it('keeps the counter triangle real, soft, and side-neutral', async () => {
    const measured = new Map<string, number>()
    const rows: string[][] = [['matchup', 'homeWin%', 'timeout%', 'median']]

    for (const homeStyle of STYLES) {
      for (const awayStyle of STYLES) {
        const outcomes = await cohort(equalStatFighter('home', homeStyle), equalStatFighter('away', awayStyle), STYLE_SEED_COUNT)
        const metrics = measure(outcomes)
        measured.set(`${homeStyle}>${awayStyle}`, metrics.homeWinRate)
        rows.push([`${homeStyle} vs ${awayStyle}`, pct(metrics.homeWinRate), pct(metrics.timeoutRate), String(metrics.medianTicks)])
      }
    }

    const failures: string[] = []
    const rate = (key: string) => measured.get(key) as number

    // The advantaged style wins 55..75%: a real edge that is never a
    // guaranteed answer.
    for (const key of ADVANTAGED) {
      const value = rate(key)
      if (value < 0.55 || value > 0.75) failures.push(`${key.replace('>', ' vs ')} advantaged win rate ${pct(value)} outside 55..75%`)
    }

    // Same-style mirrors stay 45..55% -- i.e. the home/away start positions
    // themselves confer no meaningful advantage.
    for (const style of STYLES) {
      const value = rate(`${style}>${style}`)
      if (value < 0.45 || value > 0.55) failures.push(`${style} mirror win rate ${pct(value)} outside 45..55%`)
    }

    // The three disadvantaged-as-home matchups are simulated anyway, so assert
    // them rather than only printing them: the counter triangle has to hold
    // from BOTH sides. Being on the disadvantaged end must cost more than the
    // home start position is worth, which is what distinguishes a real triangle
    // from a home-side artifact.
    //
    // The assertion is deliberately the COMPARATIVE one only. An earlier version
    // also required the disadvantaged side to stay under 45%, which was my own
    // invention rather than anything the design states -- and it is simply not
    // implied: the design bands the advantaged direction at 55..75%, which
    // permits a disadvantaged side anywhere below its counterpart, not
    // specifically below the mirror floor. It failed at `fast vs heavy` 46.4%
    // against `heavy vs fast` 59.0%, which is a perfectly healthy triangle.
    for (const key of ADVANTAGED) {
      const [advantaged, disadvantaged] = key.split('>')
      const mirrored = rate(`${disadvantaged}>${advantaged}`)
      if (mirrored >= rate(key)) {
        failures.push(`${disadvantaged} vs ${advantaged} wins ${pct(mirrored)} as home, not less than ${advantaged} vs ${disadvantaged}'s ${pct(rate(key))}`)
      }
    }

    if (failures.length > 0) reportTable('equal-stat style cohorts', rows)
    expect(failures).toEqual([])
  }, COHORT_TIMEOUT_MS)

  it('shows every style moving between committed exchanges rather than trading on the spot', async () => {
    // design.md: "sampled traces for every style contain lateral or
    // distance-changing movement between committed exchanges; no style
    // devolves into stationary cooldown trading." Sampled rather than
    // exhaustive, by the design's own wording.
    //
    // Three measurement choices worth stating:
    //
    // 1. The design names the two things that must change -- LATERAL POSITION or
    //    DISTANCE to the opponent -- so those are what is asserted, at a
    //    threshold large enough to mean something. An earlier version of this
    //    test only required `travelledDistance` to advance by 0.05 between
    //    exchanges, which is close to vacuous over windows of hundreds of ticks
    //    and is satisfiable by the committed action's own authored root travel
    //    alone (0.45-1.40 units), i.e. by a fighter that lunges and does nothing
    //    else. `travelledDistance` is still recorded, but as corroboration in
    //    the failure message rather than as the test.
    // 2. Repositioning alone is not sufficient either, in the other direction: a
    //    fighter can circle a wide arc and come back, ending an exchange where it
    //    started while having been anything but stationary -- one measured Heavy
    //    covered 3.25 units over 273 ticks and finished 0.03 units from where it
    //    began. So the requirement is a disjunction: EITHER the exchange happens
    //    somewhere meaningfully new, OR the fighter covered real ground getting
    //    there. Only a combatant that fails both is trading on the spot.
    // 3. A bout with fewer than two committed exchanges has no "between" to
    //    inspect, so it is not evidence either way. Rather than count that as a
    //    failure, seeds are scanned until enough usable samples are collected
    //    per style -- Technical's authored committed action (`base weight 8`,
    //    contact range 1.6-3.1) is genuinely infrequent, so a fixed five-seed
    //    window mostly yields one-exchange bouts for it.
    const SAMPLES_PER_STYLE = 4
    const MAX_SEEDS_SCANNED = 40
    /** Minimum change in lateral offset or distance-to-target between two committed exchanges. Comfortably above float noise and above the smallest authored committed root travel (0.35). */
    const MIN_REPOSITION = 0.40
    /**
     * ...or, failing that, minimum ground covered per elapsed tick. At 0.005 the
     * bar is 0.5 units per 100 ticks: far below what any style's locomotion
     * produces (Heavy's slowest is 0.8 u/s, i.e. 1.33 units per 100 ticks) but
     * well above what an action's own authored root travel can supply on its own
     * over a full attack cycle, which is what makes it a test of locomotion
     * rather than of lunging.
     */
    const MIN_TRAVEL_PER_TICK = 0.005
    const failures: string[] = []

    for (const style of STYLES) {
      const opposing: Archetype = style === 'heavy' ? 'technical' : style === 'fast' ? 'heavy' : 'fast'
      let usableSamples = 0

      for (let seedIndex = 0; seedIndex < MAX_SEEDS_SCANNED && usableSamples < SAMPLES_PER_STYLE; seedIndex += 1) {
        let battle = createBattle({
          home: equalStatFighter('home', style),
          away: equalStatFighter('away', opposing),
          seed: cohortSeed(seedIndex),
          combatStyles: COMBAT_STYLES,
        })
        const selfId = battle.descriptor.homeId
        const foeId = battle.descriptor.awayId

        const atCommitted: { tick: number; travelled: number; lateral: number; distance: number }[] = []
        const seenInstances = new Set<string>()
        while (battle.phase === 'running' && battle.encounter.tick < MAX_BOUT_TICKS) {
          const previousTick = battle.encounter.tick
          battle = advanceBattleTick(battle)
          for (const event of battle.events) {
            if (event.tick !== previousTick + 1) continue
            if (event.type !== 'action-started' || event.actorId !== selfId) continue
            if (!(COMBAT_STYLES.attacks[event.actionId].tags as readonly string[]).includes('committed')) continue
            if (seenInstances.has(event.actionInstanceId)) continue
            seenInstances.add(event.actionInstanceId)
            const self = battle.encounter.combatants[selfId]
            const foe = battle.encounter.combatants[foeId]
            const dx = self.position.x - foe.position.x
            const dz = self.position.z - foe.position.z
            atCommitted.push({ tick: event.tick, travelled: self.travelledDistance, lateral: self.position.z, distance: Math.sqrt(dx * dx + dz * dz) })
          }
        }

        await yieldToEventLoop()
        if (atCommitted.length < 2) continue // not evidence either way; keep scanning
        usableSamples += 1

        // Asserted per TRACE, not per gap. design.md asks that sampled traces
        // "contain lateral or distance-changing movement between committed
        // exchanges" -- an existential over the trace. Requiring it of every
        // consecutive pair is stricter than the design and produces false
        // failures on short gaps, because those are dominated by the action
        // phases themselves: `contact` and `impact` freeze root motion outright
        // and `recovery` is capped at 35% of style speed, all by design. A
        // fighter that is mid-cleave for most of a 47-tick window is obeying the
        // rules, not devolving into cooldown trading.
        const first = atCommitted[0]
        const last = atCommitted[atCommitted.length - 1]
        const biggestReposition = atCommitted.slice(1).reduce((best, current, offset) => {
          const previous = atCommitted[offset]
          return Math.max(best, Math.abs(current.lateral - previous.lateral), Math.abs(current.distance - previous.distance))
        }, 0)
        const totalTravelled = last.travelled - first.travelled
        const totalTicks = last.tick - first.tick

        if (biggestReposition > MIN_REPOSITION) continue
        if (totalTravelled > MIN_TRAVEL_PER_TICK * totalTicks) continue
        failures.push(
          `${style} seed ${cohortSeed(seedIndex)}: stationary cooldown trading across ${atCommitted.length} committed ` +
          `exchanges over ${totalTicks} ticks -- largest reposition between any two was ${biggestReposition.toFixed(2)} ` +
          `(needed > ${MIN_REPOSITION}) and total ground covered was ${totalTravelled.toFixed(2)} units ` +
          `(needed > ${(MIN_TRAVEL_PER_TICK * totalTicks).toFixed(2)})`,
        )
      }

      if (usableSamples < SAMPLES_PER_STYLE) {
        failures.push(`${style}: only ${usableSamples} of ${SAMPLES_PER_STYLE} sampled bouts contained two or more committed exchanges within ${MAX_SEEDS_SCANNED} seeds`)
      }
    }

    expect(failures).toEqual([])
  }, COHORT_TIMEOUT_MS)
})
