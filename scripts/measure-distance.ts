// Where the fight takes place -- the separation on every tick, per ordered
// matchup. The murmillo-pin slice's primary instrument.
//
// ---------------------------------------------------------------------------
// WHY THIS EXISTS AS A SECOND INSTRUMENT
// ---------------------------------------------------------------------------
//
// `measure-reach.ts` asks, of every gate it owns, one shape of question: when a
// blow landed, how far apart were the fighters? The retiarius-reach playtest
// (`docs/reviews/2026-08-27-retiarius-reach-playtest.md`) found that this
// question and the question a viewer asks can answer in opposite directions.
// Against the murmillo every reach gate went green while the pair did not
// separate at all: the blows that used to land at 0.90 became geometry misses,
// which improves a contact-conditional statistic without moving a single fighter.
//
// The playtest measured the other thing by hand and then threw the code away, so
// its central numbers -- 45.8% -> 37.7% of ticks inside 1.7 pooled, and -0.5
// points in the murmillo matchup against -14.5 in the retiarius mirror -- have
// not been reproducible by anything in this repository since the day they were
// written. That is the gap this file closes.
//
// ---------------------------------------------------------------------------
// WHAT IT MEASURES, AND THE THREE PROTOCOL DECISIONS THAT SHAPE THE ANSWER
// ---------------------------------------------------------------------------
//
//  * PER TICK, NOT PER CONTACT. One sample per tick of every bout, taken at the
//    OPENING of the tick -- before that tick's movement -- which is the same
//    convention `measure-reach.ts` uses for its `start` separation. Two
//    instruments that disagree about what "the separation at tick t" means
//    cannot be read against each other, and being read against each other is the
//    entire point of having both.
//
//  * PER ORDERED MATCHUP, ALWAYS. The pooled figure is reported and is not the
//    headline. The playtest's finding was invisible in the pooled number: the
//    fight moved out by 8.1 points on average and by 0.5 points against the
//    murmillo, and the average is the one that looked like success. Every share
//    below is printed per matchup first.
//
//  * AFTER THE OPENING APPROACH. A duel starts at ~8.4 units and the fighters
//    walk in. Counting that walk makes the metric partly a measurement of
//    approach speed -- and unevenly, since pairings close at different rates,
//    which is precisely the per-pair distortion this instrument exists to
//    remove. The window therefore opens at the first local resolution, using
//    `hasEngaged` in `src/testSupport/distanceHarness.ts`, which is
//    character-for-character the predicate `balanceCohorts.runBout` already uses
//    to read design.md's "at most 300 ticks after initial approach". Both
//    windows are reported; the engaged one is the one to freeze gates against.
//
// The band edges -- the retiarius' committed floor, his committed ceiling, and
// the murmillo's `preferredRange.max` -- are all read from the PATCHED catalog
// by `distanceBands`, never from literals and never from the unpatched global.
// `measure-reach.ts` carries the scar that explains why: reading a yardstick
// from the global meant an overlay that moved the murmillo was judged against
// the murmillo it had replaced.
//
// ---------------------------------------------------------------------------
// THERE IS NO `--gate` HERE YET, DELIBERATELY
// ---------------------------------------------------------------------------
//
// The slice's gates are frozen in its spec, before implementation, against
// baselines this instrument has not produced yet. Shipping a `--gate` in the
// same change that first measures the numbers would be choosing the bars after
// seeing the results, which is the one thing the brief's risk profile forbids
// outright. The gate arrives in the spec's own change, with each threshold
// naming its source.
//
// Usage:
//   node node_modules/vite-node/vite-node.mjs scripts/measure-distance.ts -- --seeds 200
//   node node_modules/vite-node/vite-node.mjs scripts/measure-distance.ts -- --seeds 50 --overlay /tmp/candidate.json --json /tmp/out.json

import { readFileSync, writeFileSync } from 'node:fs'
import { COMBAT_STYLES } from '../src/content/combatStyles'
import { BASELINE_TEST_SEED } from '../src/content/mvpSeries'
import { advanceBattleTick, createBattle, MAX_BOUT_TICKS } from '../src/simulation/battle'
import { percentile } from '../src/testSupport/balanceCohorts'
import {
  accumulate,
  distanceBands,
  emptyAccumulator,
  hasEngaged,
  summarise,
  type DistanceAccumulator,
  type DistanceSummary,
} from '../src/testSupport/distanceHarness'
import { applyOverlay, independentComparatorMatchups, matchupLabel } from '../src/testSupport/reachHarness'
import type { CombatStyleCatalog } from '../src/simulation/combatActions'
import type { Archetype, FighterDefinition } from '../src/simulation/fighters'

const STYLES: readonly Archetype[] = ['heavy', 'fast', 'technical']

interface Args { seeds: number; overlay?: string; json?: string }

function parseArgs(argv: readonly string[]): Args {
  const args: Args = { seeds: 200 }
  for (let i = 0; i < argv.length; i += 1) {
    const flag = argv[i]
    const value = argv[i + 1]
    if (flag === '--seeds') { args.seeds = Number(value); i += 1 }
    else if (flag === '--overlay') { args.overlay = value; i += 1 }
    else if (flag === '--json') { args.json = value; i += 1 }
    else if (flag.startsWith('--')) throw new Error(`unknown flag ${flag}`)
  }
  if (!Number.isInteger(args.seeds) || args.seeds < 1) throw new Error(`--seeds must be a positive integer, got ${String(args.seeds)}`)
  return args
}

/**
 * The equal-stat cohort, so fighter tuning cannot move a distance measurement
 * any more than it may move a reach one.
 *
 * A DEBT, stated where it will be read: `scripts/measure-reach.ts:146-151` holds
 * an identical private copy of this function, and the two instruments' numbers
 * are comparable only while the copies agree. Unifying them means editing
 * `measure-reach.ts` in the change that is currently producing this slice's
 * baselines from it, which is the move the previous slice's spec forbids
 * outright ("an instrument may not be adjusted in the diff whose numbers it
 * produces"). So the duplication is left standing and owed to whoever next opens
 * that file with a reason to.
 */
function equalStatFighter(id: string, archetype: Archetype): FighterDefinition {
  return { id, name: id, school: 'Style Cohort', archetype, maxHp: 160, power: 20, accuracy: 0.88, defenseChance: 0.35, criticalChance: 0.12 }
}

function catalogFor(overlayPath: string | undefined): CombatStyleCatalog {
  const catalog = structuredClone(COMBAT_STYLES) as unknown as CombatStyleCatalog
  const overlay = overlayPath
    ? (JSON.parse(readFileSync(overlayPath, 'utf8')) as { attacks?: Record<string, unknown>; styles?: Record<string, unknown> })
    : {}
  return applyOverlay(catalog, overlay)
}

interface MatchupResult {
  label: string
  home: Archetype
  away: Archetype
  /** Every tick of every bout, including the opening walk. */
  all: DistanceAccumulator
  /** Only ticks after the bout's first local resolution. The window to freeze against. */
  engaged: DistanceAccumulator
  /**
   * Home wins, reported beside the distance shares and not separately.
   *
   * Added after the first run of this instrument, because its first result
   * invited exactly one misreading and printing the two numbers apart would
   * have let it stand: the hoplomachus spends MORE of his bout inside the
   * murmillo's envelope than the retiarius does, and the counter triangle
   * (`fighters.ts:17-21`) says the hoplomachus BEATS the murmillo. A share of
   * time at close quarters is therefore not evidence of being pinned; the type
   * that wins this matchup is the one that closes hardest. Anyone reading a
   * distance share as a proxy for an outcome should have the outcome on the
   * same line.
   */
  homeWins: number
  bouts: number
  /**
   * `fast-burst-lunge` `action-started` events inside the engaged window,
   * summed over every Fast fighter in the matchup.
   *
   * Reported per fighter, never raw: the mirror has TWO retiarii and the kernel
   * emits one event per actor, so a raw count makes the mirror look twice as
   * committed as it is. That exact error turned a real 22% frequency gap into a
   * reported 61% before it was caught, so the division happens here rather than
   * in whoever reads the number.
   */
  lungeStarts: number
  fastFighters: number
}

const args = parseArgs(process.argv.slice(2))
const catalog = catalogFor(args.overlay)
const BANDS = distanceBands(catalog)

function runMatchup(home: Archetype, away: Archetype, seeds: number): MatchupResult {
  const result: MatchupResult = { label: matchupLabel(home, away), home, away, all: emptyAccumulator(), engaged: emptyAccumulator(), homeWins: 0, bouts: 0,
    lungeStarts: 0, fastFighters: [home, away].filter((a) => a === 'fast').length }

  for (let index = 0; index < seeds; index += 1) {
    let battle = createBattle({
      home: equalStatFighter('home', home),
      away: equalStatFighter('away', away),
      seed: BASELINE_TEST_SEED + index,
      combatStyles: catalog,
    })
    const ids = [battle.descriptor.homeId, battle.descriptor.awayId]
    const separationOf = (state: typeof battle): number => {
      const [a, b] = ids.map((id) => state.encounter.combatants[id])
      const dx = a.position.x - b.position.x
      const dz = a.position.z - b.position.z
      return Math.sqrt(dx * dx + dz * dz)
    }

    result.all.bouts += 1
    result.engaged.bouts += 1
    let everEngaged = false

    while (battle.phase === 'running' && battle.encounter.tick < MAX_BOUT_TICKS) {
      // The opening of this tick, before phase 7-8 movement -- the same instant
      // `measure-reach.ts` reads its `start` separation from.
      const separation = separationOf(battle)
      accumulate(result.all, separation, BANDS)
      // `hasEngaged` is monotone: `lastResolutionTick` never returns to 0, so
      // this latches on and the engaged window is a suffix of the bout.
      const engaged = hasEngaged(battle.encounter.combatants, ids)
      if (engaged) {
        everEngaged = true
        accumulate(result.engaged, separation, BANDS)
      }

      const previousTick = battle.encounter.tick
      battle = advanceBattleTick(battle)

      // Commitment frequency, counted here rather than inferred from contacts.
      //
      // The numerator is `action-started`, not a contact record, and that is the
      // whole point: `measure-reach.ts` files a contact under `reached` only when
      // the outcome is in `REACHED`, geometry misses in their own bucket, and an
      // action interrupted before phase 9 leaves no record at all. Deriving
      // "attempts" from those buckets counts how many commitments *survived*, not
      // how many were made -- so a candidate that commits less often but more
      // cleanly reads as unchanged. External review caught that on a first draft
      // of this metric and it is the reason this loop counts starts.
      //
      // Gated on `engaged`, the same flag that decided whether this tick entered
      // the denominator, so numerator and denominator describe one tick
      // population. The earlier figure joined contact counts spanning the WHOLE
      // bout to a denominator of engaged ticks only, across two JSON files by
      // hand, and the mismatch survived precisely because nothing computed both
      // halves in one place.
      if (engaged) {
        for (const event of battle.events) {
          if (event.tick !== previousTick + 1) continue
          if (event.type !== 'action-started') continue
          if (event.actionId !== 'fast-burst-lunge') continue
          result.lungeStarts += 1
        }
      }
    }

    if (!everEngaged) {
      result.all.unengagedBouts += 1
      result.engaged.unengagedBouts += 1
    }
    result.bouts += 1
    if (battle.winnerSide === 'home') result.homeWins += 1
  }

  return result
}

const matchups: MatchupResult[] = []
for (const home of STYLES) for (const away of STYLES) matchups.push(runMatchup(home, away, args.seeds))

const byLabel = new Map(matchups.map((m) => [m.label, m]))

const fixed = (v: number, p = 2) => v.toFixed(p)
const pct = (v: number) => `${(v * 100).toFixed(1)}%`

function pool(results: readonly MatchupResult[], window: 'all' | 'engaged'): DistanceAccumulator {
  const out = emptyAccumulator()
  for (const m of results) {
    const a = m[window]
    // A loop, not `push(...a.separations)`: a matchup holds hundreds of
    // thousands of samples and spreading that into an argument list overflows
    // the call stack. Found by reading, not by the crash.
    for (const s of a.separations) out.separations.push(s)
    out.pinned += a.pinned
    out.lungeBand += a.lungeBand
    out.beyond += a.beyond
    out.insideEnvelope += a.insideEnvelope
    out.bouts += a.bouts
    out.unengagedBouts += a.unengagedBouts
  }
  return out
}

console.log(`\nequal-stat cohorts, ${args.seeds} seeds x 9 ordered matchups${args.overlay ? `, overlay ${args.overlay}` : ''}`)
console.log(`bands from the patched catalog: pinned < ${BANDS.pinFloor} <= lunge band <= ${BANDS.lungeCeiling} < beyond`)
console.log(`murmillo envelope (heavy preferredRange.max), reported as an overlapping share: <= ${BANDS.murmilloEnvelope}\n`)

const header = `${'matchup'.padEnd(24)} ${'ticks'.padStart(8)} ${'med'.padStart(6)} ${'p10'.padStart(6)} ${'p90'.padStart(6)} ${'pinned'.padStart(7)} ${'lunge'.padStart(7)} ${'beyond'.padStart(7)} ${'<=env'.padStart(7)} ${'homeWin'.padStart(8)}`

function printRow(label: string, summary: DistanceSummary | undefined, homeWinRate?: number): void {
  if (!summary) { console.log(`${label.padEnd(24)} ${'0'.padStart(8)}`); return }
  console.log(
    `${label.padEnd(24)} ${String(summary.ticks).padStart(8)} ${fixed(summary.median).padStart(6)} ${fixed(summary.p10).padStart(6)} ` +
    `${fixed(summary.p90).padStart(6)} ${pct(summary.pinnedShare).padStart(7)} ${pct(summary.lungeBandShare).padStart(7)} ` +
    `${pct(summary.beyondShare).padStart(7)} ${pct(summary.insideEnvelopeShare).padStart(7)} ` +
    `${(homeWinRate === undefined ? '--' : pct(homeWinRate)).padStart(8)}`,
  )
}

for (const window of ['engaged', 'all'] as const) {
  console.log(window === 'engaged'
    ? 'AFTER THE OPENING APPROACH (the window to freeze gates against)'
    : '\nEVERY TICK, opening walk included (reported so the choice of window is visible, not gated)')
  console.log(header)
  for (const m of matchups) printRow(m.label, summarise(m[window], percentile), m.bouts > 0 ? m.homeWins / m.bouts : undefined)
  const fastMatchups = matchups.filter((m) => m.home === 'fast' || m.away === 'fast')
  printRow('-- pooled, all nine', summarise(pool(matchups, window), percentile))
  printRow('-- pooled, fast bouts', summarise(pool(fastMatchups, window), percentile))
}

// ---------------------------------------------------------------------------
// The comparison the slice is actually about
// ---------------------------------------------------------------------------
//
// Gate C's shape, applied to time instead of contacts: the retiarius against the
// murmillo, held against the hoplomachus against the murmillo. The comparator
// matchup is taken from `independentComparatorMatchups` and asserted to be a
// member of it rather than written as a literal -- prose stated that rule and
// four separate comparators broke it over the previous slice, three caught in
// review of the spec and one only after it shipped.
const SUBJECT: Archetype = 'fast'
const COMPARATOR: Archetype = 'technical'
const COMPARATOR_MATCHUPS = independentComparatorMatchups(COMPARATOR, SUBJECT, STYLES)
const comparatorLabel = matchupLabel(COMPARATOR, 'heavy')
if (!COMPARATOR_MATCHUPS.includes(comparatorLabel)) {
  throw new Error(`comparator matchup '${comparatorLabel}' is not in the ${SUBJECT}-free set (${COMPARATOR_MATCHUPS.join(', ')})`)
}

const subjectLabel = matchupLabel(SUBJECT, 'heavy')
const subject = summarise((byLabel.get(subjectLabel) as MatchupResult).engaged, percentile)
const comparator = summarise((byLabel.get(comparatorLabel) as MatchupResult).engaged, percentile)

const subjectResult = byLabel.get(subjectLabel) as MatchupResult
const comparatorResult = byLabel.get(comparatorLabel) as MatchupResult
const winRate = (m: MatchupResult) => (m.bouts > 0 ? pct(m.homeWins / m.bouts) : '--')
const line = (label: string, s: DistanceSummary | undefined, m: MatchupResult) =>
  `  ${label.padEnd(22)} pinned ${pct(s?.pinnedShare ?? Number.NaN).padStart(6)}   inside the murmillo ${pct(s?.insideEnvelopeShare ?? Number.NaN).padStart(6)}` +
  `   median ${fixed(s?.median ?? Number.NaN)}   home wins ${winRate(m).padStart(6)}`

console.log('\nTHE PIN, HELD AGAINST THE INDEPENDENT COMPARATOR (engaged window)')
console.log(line(subjectLabel, subject, subjectResult))
console.log(line(comparatorLabel, comparator, comparatorResult))
console.log(`  comparator is ${SUBJECT}-free by construction: ${COMPARATOR_MATCHUPS.join(', ')}`)
console.log('  READ THE WIN RATE BEFORE THE SHARES. The counter triangle in `fighters.ts:17-21` is')
console.log('  heavy -> fast -> technical -> heavy, so TECHNICAL BEATS HEAVY. A larger in-envelope')
console.log('  share for the comparator is the winner of that matchup closing, not the loser being')
console.log('  pinned -- which means this comparison cannot, on its own, tell a pin from a counter.')

// The comparison the playtest actually made, and the one this instrument was
// built for: the same subject against every opponent. It needs no comparator at
// all, because both sides of it are the subject -- so nothing in it can move
// with the thing it judges, which is the defect class this slice's whole gate
// history is made of.
console.log('\nCOMMITMENT FREQUENCY (lunge starts per 1000 engaged ticks, PER FAST FIGHTER)')
console.log('  both halves from this one run; the numerator is action-started, not surviving contacts')
for (const m of matchups) {
  if (m.fastFighters === 0) continue
  const ticks = m.engaged.separations.length
  const rate = ticks > 0 ? (m.lungeStarts / m.fastFighters / ticks) * 1000 : Number.NaN
  console.log(`  ${m.label.padEnd(22)} starts ${String(m.lungeStarts).padStart(5)} / ${m.fastFighters}   engaged ticks ${String(ticks).padStart(7)}   ${fixed(rate).padStart(6)} per 1000`)
}

console.log('\nTHE SAME SUBJECT AGAINST EVERY OPPONENT (what the playtest claimed, and the criterion that needs no yardstick)')
for (const away of STYLES) {
  const m = byLabel.get(matchupLabel(SUBJECT, away)) as MatchupResult
  console.log(line(m.label, summarise(m.engaged, percentile), m))
}

if (args.json) {
  writeFileSync(args.json, `${JSON.stringify({
    seeds: args.seeds,
    overlay: args.overlay ?? null,
    bands: BANDS,
    perMatchup: matchups.map((m) => ({
      label: m.label,
      engaged: summarise(m.engaged, percentile) ?? null,
      all: summarise(m.all, percentile) ?? null,
      bouts: m.bouts,
      homeWins: m.homeWins,
      lungeStarts: m.lungeStarts,
      fastFighters: m.fastFighters,
      lungeStartsPer1000EngagedTicksPerFighter:
        m.fastFighters > 0 && m.engaged.separations.length > 0
          ? (m.lungeStarts / m.fastFighters / m.engaged.separations.length) * 1000
          : null,
    })),
    comparison: { subject: subjectLabel, comparator: comparatorLabel, comparatorMatchups: COMPARATOR_MATCHUPS },
  }, null, 2)}\n`, 'utf8')
  console.log(`\nwrote ${args.json}`)
}
