// Where each attack actually lands, and how the distance-dependent signature
// mechanics fare. The retiarius-reach slice's acceptance instrument.
//
// It is committed, reviewable code rather than numbers pasted into a spec
// because a criterion whose measurement is not frozen is not a criterion: two
// reasonable harnesses disagree about what "makes contact" means and land on
// different medians. With `--gate` it asserts the slice's frozen thresholds
// and exits non-zero, so it is an acceptance gate rather than a report.
//
// ---------------------------------------------------------------------------
// WHERE THE SEPARATION COMES FROM -- the whole reason the kernel gained
// `contactDiagnostics.ts`.
//
// Separation is read from phase 9's frozen snapshot through a `ContactCollector`,
// NOT from the state after `advanceBattleTick`. The first version of this
// harness sampled after the tick and was wrong: phase 9 resolves contact, then
// phase 10 applies that same attack's authored pushback plus a fresh
// separation/arena correction, so a post-tick reading is inflated by the hit
// being measured -- and inflated by DIFFERENT amounts per outcome, since a hit
// pushes fully, a blocked hit at 0.30 of that, and a parry or a miss not at
// all. External review caught it with one number: `heavy-cleave` reported a
// contact p90 of 2.03 against a hard authored maximum of 1.8.
//
// The start separation has the same hazard and the same fix: an action starts
// in phase 5, BEFORE this tick's movement, so it is read from the state at the
// beginning of that tick rather than the end.
// ---------------------------------------------------------------------------
//
// The remaining protocol decisions, each made once here:
//
//  * WHICH BOUTS. The equal-stat style fixture from `balance.test.ts` -- same
//    stats for all three styles, varying only the archetype -- over `--seeds`
//    consecutive seeds from `BASELINE_TEST_SEED`, all nine ordered matchups.
//    Equal-stat rather than the roster, so fighter tuning cannot move a reach
//    number.
//
//  * ONE SAMPLE PER ACTION INSTANCE. The kernel emits one record for every
//    contact intent phase 9 considers, including intents it skips because
//    their actor was defeated earlier in the same batch. The harness asserts
//    that instance ids are unique, so nothing is double-counted or dropped.
//
//  * WHICH INSTANCES COUNT AS REACHED. `hit`, `blocked`, `parried`,
//    `missed-accuracy` -- in all four the weapon arrived at that separation,
//    and whether the swing landed is an accuracy or defence question rather
//    than a reach one. `missed-geometry`, `evaded`, `target-unavailable` and
//    `actor-defeated` do not count as reached; the first two are reported as
//    the geometry-failure rate.
//
//  * PERCENTILES from `balanceCohorts.percentile`, imported rather than
//    reimplemented.
//
//  * WEIGHTING. Every statistic is reported per ordered matchup as well as
//    pooled, because a pooled figure can move because an action was selected
//    more often rather than because it began landing further out, and can pass
//    while half the sample sits at the old close distance.
//
//  * COMPARATORS ARE CHOSEN TO BE INDEPENDENT of the change being judged.
//    Every hoplomachus yardstick is taken from its matchups that contain no
//    `fast` at all, because its `vs fast` component moves when the retiarius
//    moves -- the coupling defect that invalidated an earlier version of the
//    ordering criterion, and then shipped anyway inside gate D.
//
//    The selection is NOT written out here. It comes from
//    `independentComparatorMatchups` in `src/testSupport/reachHarness.ts`,
//    which is typechecked and has a regression against exactly this defect.
//    Prose stated the rule and four separate comparators broke it; the fifth
//    time it is code, and there is one call site shape for all three gates that
//    need it rather than a literal pair of labels repeated per gate.
//
// `--overlay <file.json>` deep-merges a partial `{ attacks?, styles? }` into
// the catalog before the run and validates the result, so candidate numbers are
// measured without editing content and an invalid candidate fails loudly.
//
// ---------------------------------------------------------------------------
// GATES P AND Q CHANGED THE QUANTITY THEY MEASURE (2026-08-29). THE BAR DID NOT.
// ---------------------------------------------------------------------------
//
// This file is the only consumer of `src/testSupport/disengageGates.ts`, and
// that file moved underneath it. `isSuccess` (`disengageGates.ts:108`) and both
// of `disengageStats`'s ground medians (`:233-234`) now read
// `voluntaryGroundOpened` -- the raw endpoint difference LESS the episode's
// recorded `externalGround` -- where they used to read `groundOpened`. So gate
// P's success predicate and both of gate Q's medians are now about ground the
// fighter opened with his own legs, not ground that opened for any reason.
// A shove, or any authored pushback, moves the retiarius and used to register
// as an escape he did not make.
//
// **The bar was ruled not-retuned.** `DISENGAGE_SUCCESS_GROUND` stays at
// `0.75` by the design owner's decision of 2026-08-29: nobody recalibrates a
// threshold mid-slice against the very measurement it exists to judge. So the
// numerator got strictly smaller and the bar it is compared against did not
// move, which makes P and Q materially STRICTER than the runs that produced
// this file's recorded figures. That is intended, and it is why the next two
// paragraphs exist.
//
// **Every P/Q figure recorded before that date is stale.** They were measured
// on raw ground and are not comparable to a run of this file. Concretely, the
// three comparator shares written into `P3_FLOORS`' docblock below -- 26.0%,
// 29.7% and 42.5% at 200 seeds -- re-measure on the voluntary quantity as
// **24.1%, 25.6% and 41.6%**. The frozen floors (0.208, 0.237, 0.340) still
// pass, so P3 is unaffected; it is the recorded shares behind them that no
// longer describe what the gate reads. Do not re-derive anything from the old
// numbers.
//
// **`:485` IS STILL RAW, ON PURPOSE.** `disengageGained`, and the `separation
// gained med=/p10=` distribution printed under SIGNATURE MECHANICS from it,
// are built from `groundOpened` and stay that way: they feed the eye and gate
// E's pooled clause, and gate E is one of A-G, frozen by the spec's gate S.
// The per-matchup table below it and gates P/Q report the voluntary quantity.
// These are two different measurements printed a dozen lines apart, and a
// reader who takes the printed median as the number Q gates on will be wrong
// by the whole external share.
//
// THE VERDICT, MEASURED. `node node_modules/vite-node/vite-node.mjs
// scripts/measure-reach.ts -- --gate` at the default 200 seeds, on this
// branch's content (which contains no shove -- the mechanic is parked), exits
// 1 and reports:
//
//     A-G, the previous slice's frozen gates (spec gate S): all pass
//     P, Q, Q2, R, this slice's gates: 6 FAILED
//     FAIL P1: fast vs heavy success share 1.3% below 25%
//     FAIL P1: heavy vs fast success share 1.1% below 25%
//     FAIL P2: fast vs heavy success share 1.3% below half the lowest comparator 24.1%
//     FAIL P2: heavy vs fast success share 1.1% below half the lowest comparator 24.1%
//     FAIL Q: fast vs heavy median ground over all decided episodes 0.66 below 0.75
//     FAIL Q: heavy vs fast median ground over all decided episodes 0.64 below 0.75
//
// So it is not only Q that is red: P1 and P2 are red too, and every red clause
// is on one of the two murmillo matchups. Q's success-only clause passes in
// both (1.13 and 1.00); it is the all-decided-episodes clause that fails.
// Nothing inherited moved -- A-G are green, so this is not a regression in the
// previous slice's behaviour.
//
// WHAT THIS RUN DOES NOT ESTABLISH, stated because the obvious reading is the
// unsafe one. These reds are the murmillo pin the slice exists to measure --
// 449 of 474 and 457 of 475 episodes exit on `cap`, i.e. the retiarius is
// still inside the exit distance when the tick cap fires. But this run alone
// cannot separate "shipped content pins the retiarius" from "the voluntary
// switch tightened P past what shipped content ever cleared", because the
// pre-switch figures for the two MURMILLO matchups were never recorded on
// this instrument (only the three comparator ones were). Doing that split
// needs a raw-ground comparison run, which this branch did not make. Whoever
// takes the candidate exit rule off `experiment/murmillo-pursuit-exit` should
// make it before reading these two reds as a baseline.
//
// Usage:
//   npm run measure:reach -- --seeds 200
//   npm run measure:reach -- --seeds 200 --gate
//   npm run measure:reach -- --seeds 50 --overlay /tmp/candidate.json --json /tmp/out.json

import { readFileSync, writeFileSync } from 'node:fs'
import { COMBAT_STYLES } from '../src/content/combatStyles'
import { BASELINE_TEST_SEED } from '../src/content/mvpSeries'
import { advanceBattleTick, createBattle, MAX_BOUT_TICKS } from '../src/simulation/battle'
import { FAST_FORCED_DISENGAGE_END_RANGE, FAST_FORCED_DISENGAGE_MAX_TICKS } from '../src/simulation/combatDecision'
import { assembleDisengageEpisodes } from '../src/simulation/disengageDiagnostics'
import type { DisengageCollector, DisengageEpisode, DisengageSample } from '../src/simulation/disengageDiagnostics'
import { corroborate, disengageStats, groundOpened, DISENGAGE_SUCCESS_GROUND } from '../src/testSupport/disengageGates'
import { percentile } from '../src/testSupport/balanceCohorts'
// `REACHED`, `GEOMETRY_FAILURE` and the overlay merge live in `src/` rather
// than here: `scripts/` is outside tsconfig's `include`, so nothing in this
// file is typechecked by `npm run build` or reachable by Vitest, and those two
// pieces are the ones that can be silently wrong. See `reachHarness.ts`.
import { applyOverlay, GEOMETRY_FAILURE, independentComparatorMatchups, matchupLabel, REACHED } from '../src/testSupport/reachHarness'
import type { ContactCollector, ContactOutcome, ContactRecord } from '../src/simulation/contactDiagnostics'
import type { AttackActionId, CombatStyleCatalog } from '../src/simulation/combatActions'
import type { Archetype, FighterDefinition } from '../src/simulation/fighters'

const STYLES: readonly Archetype[] = ['heavy', 'fast', 'technical']

/** The committed attack each style is judged by. Probes are reported too, but the reach claim is about the committed action. */
const COMMITTED_ATTACK: Readonly<Record<Archetype, AttackActionId>> = {
  heavy: 'heavy-cleave',
  fast: 'fast-burst-lunge',
  technical: 'technical-driving-thrust',
}

/**
 * Every attack a style can produce, for gate D's whole-type share. Includes
 * `technical-parry-counter`, which is forced rather than chosen but is still
 * the hoplomachus landing a blow at some distance, so excluding it would
 * flatter the comparator.
 */
const STYLE_ATTACKS: Readonly<Record<Archetype, readonly AttackActionId[]>> = {
  heavy: ['heavy-shield-jab', 'heavy-cleave'],
  fast: ['fast-slash', 'fast-burst-lunge'],
  technical: ['technical-thrust', 'technical-driving-thrust', 'technical-parry-counter'],
}

/**
 * The floor on how much ground Fast's forced disengage must actually open,
 * in units, at the median.
 *
 * Measured off the AUTHORED content, which is the behaviour being preserved,
 * and gated separately from duration because duration alone is satisfiable by
 * making the range exit unreachable: every episode then pins to the 30-tick cap
 * and the median passes without Fast having retreated at all. That failure mode
 * was raised in external review and this is the answer to it.
 *
 * Set from the baseline run at 200 seeds; see the spec's criterion 3.
 */
const DISENGAGE_GAIN_FLOOR = 0.75

interface Args { seeds: number; overlay?: string; json?: string; gate: boolean }

function parseArgs(argv: readonly string[]): Args {
  const args: Args = { seeds: 200, gate: false }
  for (let i = 0; i < argv.length; i += 1) {
    const flag = argv[i]
    const value = argv[i + 1]
    if (flag === '--seeds') { args.seeds = Number(value); i += 1 }
    else if (flag === '--overlay') { args.overlay = value; i += 1 }
    else if (flag === '--json') { args.json = value; i += 1 }
    else if (flag === '--gate') { args.gate = true }
    else if (flag.startsWith('--')) throw new Error(`unknown flag ${flag}`)
  }
  if (!Number.isInteger(args.seeds) || args.seeds < 1) throw new Error(`--seeds must be a positive integer, got ${String(args.seeds)}`)
  return args
}

function equalStatFighter(id: string, archetype: Archetype): FighterDefinition {
  // Copied deliberately from `balance.test.ts`'s fixture, and deliberately NOT
  // read from `mvpSeries.ts`: roster tuning must not be able to move a reach
  // measurement any more than it may move a balance band.
  return { id, name: id, school: 'Style Cohort', archetype, maxHp: 160, power: 20, accuracy: 0.88, defenseChance: 0.35, criticalChance: 0.12 }
}

// ---------------------------------------------------------------------------
// Overlay
// ---------------------------------------------------------------------------

/**
 * The merge, the strict unknown-key check and the catalog validation all live
 * in `src/testSupport/reachHarness.ts`, where Vitest can reach them; this is
 * only the file read. `applyOverlay` validates even with no overlay, so an
 * unpatched run is checked against the same invariants a candidate is.
 */
function catalogFor(overlayPath: string | undefined): CombatStyleCatalog {
  const catalog = structuredClone(COMBAT_STYLES) as unknown as CombatStyleCatalog
  const overlay = overlayPath
    ? (JSON.parse(readFileSync(overlayPath, 'utf8')) as { attacks?: Record<string, unknown>; styles?: Record<string, unknown> })
    : {}
  return applyOverlay(catalog, overlay)
}

// ---------------------------------------------------------------------------
// Measurement
// ---------------------------------------------------------------------------

interface Sample { start: number; contact: number; outcome: ContactOutcome }

interface MatchupResult {
  label: string
  home: Archetype
  away: Archetype
  reached: Record<string, Sample[]>
  geometryFailures: Record<string, number>
  otherOutcomes: Record<string, number>
  disengages: DisengageEpisode[]
  /**
   * Episodes PR-2's seam set aside because the fighter lost or changed target
   * mid-episode. Carried rather than discarded so the printed run says so: in
   * a duel this must be empty, and a run where it is not is telling us about
   * the harness, not about the fight.
   */
  unmeasurableDisengages: number
  /** Successful parries, keyed by the incoming action that was parried. */
  parries: Record<string, number>
  /**
   * Counters, keyed by the SAME incoming action. Gate F is per incoming
   * action, so a bare total would not do: an unchanged conversion after
   * `heavy-cleave` can hide a collapse after the newly ranged Fast attacks,
   * which are the only ones this slice moves.
   */
  countersByIncoming: Record<string, number>
}

function emptyMatchup(label: string, home: Archetype, away: Archetype): MatchupResult {
  return { label, home, away, reached: {}, geometryFailures: {}, otherOutcomes: {}, disengages: [], unmeasurableDisengages: 0, parries: {}, countersByIncoming: {} }
}

function runMatchup(catalog: CombatStyleCatalog, home: Archetype, away: Archetype, seeds: number): MatchupResult {
  const result = emptyMatchup(matchupLabel(home, away), home, away)

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

    const records: ContactRecord[] = []
    const collector: ContactCollector = { record: (entry) => records.push(entry) }
    // Closes over its own accumulator and nothing else. The seam's `record`
    // runs synchronously inside phase 2, so a collector that reached into
    // `battle` from in here could perturb the very tick it is observing --
    // measured, and recorded as debt 7 in the spec. This is the constraint that
    // debt places on the first PR to write a new collector, which is this one.
    const disengageSamples: DisengageSample[] = []
    const disengageCollector: DisengageCollector = { record: (sample) => disengageSamples.push(sample) }
    const startSeparation = new Map<string, number>()
    /** The last parry each defender landed, so a forced counter can be attributed to the incoming action that earned it. */
    const lastParry = new Map<string, { actionId: string; tick: number }>()
    let openingSeparation = separationOf(battle)

    while (battle.phase === 'running' && battle.encounter.tick < MAX_BOUT_TICKS) {
      const previousTick = battle.encounter.tick
      // The separation at the START of this tick. An action begins in phase 5,
      // before movement (phase 7-8), so this is what it was launched at.
      const tickOpening = openingSeparation

      battle = advanceBattleTick(battle, undefined, collector, disengageCollector)
      openingSeparation = separationOf(battle)

      for (const event of battle.events) {
        if (event.tick !== previousTick + 1) continue
        if (event.type === 'attack-parried') {
          result.parries[event.actionId] = (result.parries[event.actionId] ?? 0) + 1
          lastParry.set(event.defenderId, { actionId: event.actionId, tick: event.tick })
        }
        if (event.type === 'action-started') {
          startSeparation.set(event.actionInstanceId, tickOpening)
          if (event.actionId === 'technical-parry-counter') {
            // design.md: the forced counter begins on the NEXT tick after a
            // successful parry. Two ticks of slack, and no attribution at all
            // if none is found, so a mis-attributed counter cannot inflate a
            // conversion rate.
            const parry = lastParry.get(event.actorId)
            if (parry && event.tick - parry.tick <= 2) {
              result.countersByIncoming[parry.actionId] = (result.countersByIncoming[parry.actionId] ?? 0) + 1
              lastParry.delete(event.actorId)
            }
          }
        }
      }

    }

    // THE DURATION INFERENCE IS GONE. This block used to read
    //
    //     exit: ticks >= FAST_FORCED_DISENGAGE_MAX_TICKS ? 'cap' : 'range'
    //
    // deducing the reason from the episode's length against the very constant
    // PR-4 makes mutable, and tracking the endpoints by watching
    // `forcedDisengageStartTick` from outside the tick -- which put the start
    // separation after the first forced retreat and the end separation after
    // phase 4's ordinary decision, phases 7-8's movement, phase 9's contact and
    // phase 10's push. `heavy-cleave` pushes 0.70 units, so that window error
    // was never bounded.
    //
    // Both come from PR-2's seam now: the reason from the branch that fired,
    // the endpoints read in phase 2 at both ends. Censoring is the seam's too,
    // so an episode still open when the bout ends is still kept.
    const assembly = assembleDisengageEpisodes(disengageSamples)
    result.disengages.push(...assembly.episodes)
    result.unmeasurableDisengages += assembly.unmeasurable.length

    const seenInstances = new Set<string>()
    for (const record of records) {
      if (seenInstances.has(record.actionInstanceId)) {
        throw new Error(`duplicate contact record for ${record.actionInstanceId} -- the harness would be double-counting`)
      }
      seenInstances.add(record.actionInstanceId)
      const start = startSeparation.get(record.actionInstanceId)
      if (REACHED.has(record.outcome)) {
        if (start === undefined) throw new Error(`reached contact ${record.actionInstanceId} has no recorded start separation`)
        ;(result.reached[record.actionId] ??= []).push({ start, contact: record.separation, outcome: record.outcome })
      } else if (GEOMETRY_FAILURE.has(record.outcome)) {
        result.geometryFailures[record.actionId] = (result.geometryFailures[record.actionId] ?? 0) + 1
      } else {
        result.otherOutcomes[record.actionId] = (result.otherOutcomes[record.actionId] ?? 0) + 1
      }
    }
  }

  return result
}

// ---------------------------------------------------------------------------
// Summary
// ---------------------------------------------------------------------------

interface Summary {
  n: number
  startMedian: number
  contactP10: number
  contactMedian: number
  contactP90: number
  insideEnvelope: number
  closes: number
  geometryFailureRate: number
}

function summarise(samples: readonly Sample[], geometryFailures: number, envelope: number): Summary | undefined {
  if (samples.length === 0) return undefined
  const contacts = samples.map((s) => s.contact).sort((x, y) => x - y)
  const starts = samples.map((s) => s.start).sort((x, y) => x - y)
  const startMedian = percentile(starts, 0.5)
  const contactMedian = percentile(contacts, 0.5)
  return {
    n: samples.length,
    startMedian,
    contactP10: percentile(contacts, 0.1),
    contactMedian,
    contactP90: percentile(contacts, 0.9),
    insideEnvelope: contacts.filter((d) => d <= envelope).length / contacts.length,
    closes: startMedian - contactMedian,
    geometryFailureRate: geometryFailures / (samples.length + geometryFailures),
  }
}

const args = parseArgs(process.argv.slice(2))
const catalog = catalogFor(args.overlay)

/**
 * The murmillo's `preferredRange.max`, read from the PATCHED catalog. Reading
 * it from the unpatched global was a defect in an earlier version: an overlay
 * that moved the murmillo would have been judged against the old yardstick.
 */
const ENVELOPE = catalog.styles.heavy.preferredRange.max

const matchups: MatchupResult[] = []
for (const home of STYLES) for (const away of STYLES) matchups.push(runMatchup(catalog, home, away, args.seeds))

const byLabel = new Map(matchups.map((m) => [m.label, m]))
const pooledSamples: Record<string, Sample[]> = {}
const pooledGeometryFailures: Record<string, number> = {}
const pooledDisengages: DisengageEpisode[] = []
const pooledParries: Record<string, number> = {}
const pooledCountersByIncoming: Record<string, number> = {}
for (const m of matchups) {
  for (const [id, samples] of Object.entries(m.reached)) (pooledSamples[id] ??= []).push(...samples)
  for (const [id, n] of Object.entries(m.geometryFailures)) pooledGeometryFailures[id] = (pooledGeometryFailures[id] ?? 0) + n
  pooledDisengages.push(...m.disengages)
  for (const [id, n] of Object.entries(m.parries)) pooledParries[id] = (pooledParries[id] ?? 0) + n
  for (const [id, n] of Object.entries(m.countersByIncoming)) pooledCountersByIncoming[id] = (pooledCountersByIncoming[id] ?? 0) + n
}

const fixed = (v: number, p = 2) => v.toFixed(p)
const pct = (v: number) => `${(v * 100).toFixed(1)}%`
const committedOf = (label: string) => {
  const m = byLabel.get(label) as MatchupResult
  const id = COMMITTED_ATTACK[m.home]
  return summarise(m.reached[id] ?? [], m.geometryFailures[id] ?? 0, ENVELOPE)
}

console.log(`\nequal-stat cohorts, ${args.seeds} seeds x 9 ordered matchups${args.overlay ? `, overlay ${args.overlay}` : ''}`)
console.log(`murmillo envelope (heavy preferredRange.max, from the patched catalog) = ${ENVELOPE}\n`)

console.log('POOLED, per attack')
console.log(`${'action'.padEnd(26)} ${'authored'.padEnd(11)} ${'n'.padStart(6)} ${'start'.padStart(6)} ${'p10'.padStart(6)} ${'med'.padStart(6)} ${'p90'.padStart(6)} ${'closes'.padStart(7)} ${'<=env'.padStart(7)} ${'geomFail'.padStart(9)}`)
for (const id of Object.keys(catalog.attacks) as AttackActionId[]) {
  const s = summarise(pooledSamples[id] ?? [], pooledGeometryFailures[id] ?? 0, ENVELOPE)
  const authored = `${catalog.attacks[id].contactRange.min}-${catalog.attacks[id].contactRange.max}`
  if (!s) { console.log(`${id.padEnd(26)} ${authored.padEnd(11)} ${'0'.padStart(6)}`); continue }
  console.log(
    `${id.padEnd(26)} ${authored.padEnd(11)} ${String(s.n).padStart(6)} ${fixed(s.startMedian).padStart(6)} ${fixed(s.contactP10).padStart(6)} ` +
    `${fixed(s.contactMedian).padStart(6)} ${fixed(s.contactP90).padStart(6)} ${fixed(s.closes).padStart(7)} ${pct(s.insideEnvelope).padStart(7)} ${pct(s.geometryFailureRate).padStart(9)}`,
  )
}

console.log('\nCOMMITTED attack, per ordered matchup')
console.log(`${'matchup'.padEnd(26)} ${'n'.padStart(6)} ${'med'.padStart(6)} ${'<=env'.padStart(7)} ${'geomFail'.padStart(9)}`)
for (const m of matchups) {
  const s = committedOf(m.label)
  console.log(`${m.label.padEnd(26)} ${String(s?.n ?? 0).padStart(6)} ${(s ? fixed(s.contactMedian) : '--').padStart(6)} ${(s ? pct(s.insideEnvelope) : '--').padStart(7)} ${(s ? pct(s.geometryFailureRate) : '--').padStart(9)}`)
}

const headToHead = {
  retiarius: committedOf('fast vs technical'),
  hoplomachus: committedOf('technical vs fast'),
}
console.log('\nHEAD TO HEAD (the ordering gate)')
console.log(`retiarius ${fixed(headToHead.retiarius?.contactMedian ?? Number.NaN)}   hoplomachus ${fixed(headToHead.hoplomachus?.contactMedian ?? Number.NaN)}   margin ${fixed((headToHead.hoplomachus?.contactMedian ?? 0) - (headToHead.retiarius?.contactMedian ?? 0))}`)

/**
 * The archetype this slice changes, and the one every criterion measures it
 * against. Named once so the comparator selection below reads as the rule it
 * implements rather than as two string literals that happen to be right.
 */
const SUBJECT: Archetype = 'fast'
const COMPARATOR: Archetype = 'technical'

/** Every ordered matchup that was run. The SUBJECT is pooled over all of them -- it is what is being judged, so nothing about it is held out. */
const ALL_MATCHUPS: readonly string[] = matchups.map((m) => m.label)

/**
 * The COMPARATOR's matchups containing no SUBJECT at all. Selected by
 * `reachHarness.ts` rather than written here; see that module for why the rule
 * had to become code.
 *
 * Gates D and G average over the whole set. Gate C reads ONE member of it --
 * `technical vs heavy` -- because gate C is a like-for-like comparison against
 * the same opponent the subject is measured against (`fast vs heavy`), so
 * broadening its comparator would change what it compares, not just how much
 * of it. What matters is that gate C's single label is a MEMBER of this set
 * rather than an independently written literal, which the gate asserts.
 */
const COMPARATOR_MATCHUPS = independentComparatorMatchups(COMPARATOR, SUBJECT, STYLES)

function matchupsFor(labels: readonly string[]): MatchupResult[] {
  return labels.map((label) => {
    const m = byLabel.get(label)
    // A label the run never produced would select an empty sample, and an empty
    // sample is `NaN` -- which reads as a comparator rather than as a bug.
    if (m === undefined) throw new Error(`no matchup '${label}' was run; comparator selection is out of step with the matchup grid`)
    return m
  })
}

/**
 * Gate D's statistic: over ALL of a style's reached contacts, probe and
 * committed together, the share landing inside the murmillo's envelope,
 * restricted to `labels`.
 *
 * `labels` is a parameter, and that is the fix for the defect external review
 * found after this slice shipped. This function used to read `pooledSamples`,
 * i.e. all nine matchups, for BOTH sides of gate D -- so the hoplomachus'
 * yardstick included `technical vs fast` and moved with the very thing it was
 * judging, breaking the rule gates C and G obey.
 */
function wholeTypeEnvelopeShare(archetype: Archetype, labels: readonly string[]): number {
  let inside = 0
  let total = 0
  for (const m of matchupsFor(labels)) {
    for (const id of STYLE_ATTACKS[archetype]) {
      for (const sample of m.reached[id] ?? []) {
        total += 1
        if (sample.contact <= ENVELOPE) inside += 1
      }
    }
  }
  return total > 0 ? inside / total : Number.NaN
}

/** A style's committed-attack geometry-failure rate, restricted to `labels`. */
function committedGeometryFailure(archetype: Archetype, labels: readonly string[]): number {
  const id = COMMITTED_ATTACK[archetype]
  let reached = 0
  let failed = 0
  for (const m of matchupsFor(labels)) {
    reached += (m.reached[id] ?? []).length
    failed += m.geometryFailures[id] ?? 0
  }
  return reached + failed > 0 ? failed / (reached + failed) : Number.NaN
}

const disengageTicks = pooledDisengages.map((d) => d.ticks).sort((a, b) => a - b)
const disengageGained = pooledDisengages.map((d) => groundOpened(d)).sort((a, b) => a - b)
// Gate E's pooled clause, UNCHANGED. It counts censored episodes in its
// denominator (it always has, at `measure-reach.ts:484`), and the per-matchup
// clauses added below deliberately do not. Keeping E exactly as it was is the
// spec's gate S: PR-3 may add clauses and may not alter one of A-G.
const immediateShare = pooledDisengages.length > 0 ? pooledDisengages.filter((d) => d.ticks <= 1).length / pooledDisengages.length : Number.NaN
console.log('\nSIGNATURE MECHANICS')
if (pooledDisengages.length > 0) {
  const byExit = (exit: string) => pooledDisengages.filter((d) => d.reason === exit).length
  console.log(
    `fast forced disengage: n=${pooledDisengages.length} ticks med=${percentile(disengageTicks, 0.5)} ` +
    `separation gained med=${fixed(percentile(disengageGained, 0.5))} p10=${fixed(percentile(disengageGained, 0.1))} ` +
    `| cleared within one tick ${pct(immediateShare)} | exits range=${byExit('range')} cap=${byExit('cap')} censored=${byExit('censored')}`,
  )
} else {
  console.log('fast forced disengage: never triggered')
}

// --- Per matchup, which is what gates P, Q, Q2 and R read --------------------
//
// Gate E is pooled, and §4.1 of the spec is about what pooling hid: its three
// clauses read 2.9%, 37 ticks and 0.775 against bars of 5%, 24 and 0.75, all
// green, while per pair the components disagree with each other and with the
// pooled figure. Each clause is carried over its bar by the matchup the OTHER
// clause fails on, and the pooled number describes no matchup that exists.
const FAST_MATCHUPS = matchups.filter((m) => m.home === SUBJECT || m.away === SUBJECT).map((m) => m.label)
const statsByMatchup = new Map(matchups.map((m) => [m.label, disengageStats(m.disengages)]))
const statsFor = (label: string) => statsByMatchup.get(label)

console.log('\nFORCED DISENGAGE, PER MATCHUP (gates P, Q, Q2 and R read these; gate E above stays pooled)')
console.log('matchup                   episodes  success  success%   ground(succ)  ground(dec)  dur(succ)  <4t  <=1t   range  cap  cens')
for (const label of FAST_MATCHUPS) {
  const s = statsFor(label)
  if (!s) continue
  console.log(
    `${label.padEnd(24)} ${String(s.episodes).padStart(8)} ${String(s.successes).padStart(8)} ${pct(s.successShare).padStart(9)} ` +
    `${fixed(s.groundMedianSuccesses).padStart(13)} ${fixed(s.groundMedianDecided).padStart(12)} ${String(s.durationMedianSuccesses).padStart(10)} ` +
    `${pct(s.subFourTickSuccessShare).padStart(6)} ${pct(s.immediateShare).padStart(6)} ` +
    `${String(s.byReason.range).padStart(6)} ${String(s.byReason.cap).padStart(4)} ${String(s.byReason.censored).padStart(5)}`,
  )
}
const totalUnmeasurable = matchups.reduce((total, m) => total + m.unmeasurableDisengages, 0)
console.log(
  `episodes the seam could not measure (target lost or changed mid-episode): ${totalUnmeasurable}` +
  `${totalUnmeasurable === 0 ? ' -- expected in a duel, where neither can happen' : ' -- INVESTIGATE, a duel should produce none'}`,
)
const totalParries = Object.values(pooledParries).reduce((t, n) => t + n, 0)
const totalCounters = Object.values(pooledCountersByIncoming).reduce((t, n) => t + n, 0)
console.log(`technical parry -> counter: ${totalCounters}/${totalParries} = ${totalParries > 0 ? pct(totalCounters / totalParries) : '--'}`)
console.log('  by incoming action (gate F is asserted per row, not on the total):')
for (const [incoming, parried] of Object.entries(pooledParries)) {
  const converted = pooledCountersByIncoming[incoming] ?? 0
  console.log(`    ${incoming.padEnd(26)} ${String(converted).padStart(5)}/${String(parried).padEnd(5)} ${pct(parried > 0 ? converted / parried : Number.NaN)}`)
}
console.log('\nCOMPARATORS (gates D and G average this set, gate C reads one member of it; printed so the gate inputs are visible)')
console.log(`  comparator matchups: ${COMPARATOR_MATCHUPS.join(', ')}`)
console.log(`  hoplomachus geometry failure, committed attack: ${pct(committedGeometryFailure(COMPARATOR, COMPARATOR_MATCHUPS))} (pooled, for contrast: ${pct(committedGeometryFailure(COMPARATOR, ALL_MATCHUPS))})`)
console.log(
  `  hoplomachus whole-type inside envelope: ${pct(wholeTypeEnvelopeShare(COMPARATOR, COMPARATOR_MATCHUPS))} ` +
  `(pooled, the coupled figure gate D used to read: ${pct(wholeTypeEnvelopeShare(COMPARATOR, ALL_MATCHUPS))})`,
)
console.log(`  retiarius whole-type inside envelope, all nine matchups: ${pct(wholeTypeEnvelopeShare(SUBJECT, ALL_MATCHUPS))}`)

// ---------------------------------------------------------------------------
// Gate
// ---------------------------------------------------------------------------

if (args.gate) {
  // TWO GROUPS, REPORTED SEPARATELY, and the separation is load-bearing.
  //
  // A-G are the previous slice's frozen gates and describe behaviour this slice
  // does not change, so they must pass on every run -- that is the spec's gate
  // S. P, Q, Q2 and R are THIS slice's, and P and Q are defect detectors: they
  // are supposed to FAIL on the shipped content and to pass only once the
  // content change lands. Reporting one verdict over both would make "the gate
  // is red" mean either "nothing is wrong yet" or "the previous slice
  // regressed", which are opposite things.
  //
  // The spec's gate S is worded "`--gate` continues to pass", written before
  // this slice's own clauses joined the same flag. What it means, and what its
  // own bullet says, is that the A-G clauses and their thresholds are frozen.
  // That is what this reports.
  const inherited: string[] = []
  const slice: string[] = []
  let failures = inherited
  const check = (ok: boolean, description: string) => { if (!ok) failures.push(description) }

  const lunge = catalog.attacks['fast-burst-lunge']
  const drivingThrust = catalog.attacks['technical-driving-thrust']
  // Asserted, not left to prose: the "<= envelope" share counts the interval
  // [contactRange.min, envelope], whose WIDTH is set by the floor. Comparing
  // two types across unequal floors is invalid.
  check(lunge.contactRange.min === drivingThrust.contactRange.min,
    `floor alignment: lunge min ${lunge.contactRange.min} != driving thrust min ${drivingThrust.contactRange.min}, so the envelope shares are not comparable`)

  // GATE A -- the defect detector. The man with the trident must not fight
  // closer than the man with the short sword. Both figures come from this same
  // run; the murmillo's is near-invariant because its behaviour is not what
  // changed (1.08 authored, 1.09 at the proposal).
  const fastPooled = summarise(pooledSamples['fast-burst-lunge'] ?? [], pooledGeometryFailures['fast-burst-lunge'] ?? 0, ENVELOPE)
  const heavyPooled = summarise(pooledSamples['heavy-cleave'] ?? [], pooledGeometryFailures['heavy-cleave'] ?? 0, ENVELOPE)
  check((fastPooled?.contactMedian ?? 0) >= (heavyPooled?.contactMedian ?? Infinity),
    `A: retiarius committed median ${fixed(fastPooled?.contactMedian ?? Number.NaN)} below the murmillo's ${fixed(heavyPooled?.contactMedian ?? Number.NaN)}`)

  // GATE B -- the guardrail. Passes on the authored content too (+1.32); it
  // exists so the fix cannot overshoot and take the longest reach away from
  // the hoplomachus, which is what happened to two rejected candidates.
  const margin = (headToHead.hoplomachus?.contactMedian ?? Number.NaN) - (headToHead.retiarius?.contactMedian ?? Number.NaN)
  check(margin >= 0.20, `B: head-to-head ordering margin ${fixed(margin)} below 0.20`)

  // GATE C -- distribution, against an INDEPENDENT comparator. `technical vs
  // heavy` contains no `fast`, so it is bit-identical across every candidate;
  // the hoplomachus' pooled figure would move with the retiarius and could be
  // raised by worsening Technical, which is the coupling defect this whole
  // criterion set had to be rebuilt to avoid.
  const gateCComparatorLabel = matchupLabel(COMPARATOR, 'heavy')
  // Not decoration: gate C's comparator was a bare string literal, which is how
  // gate D's comparator drifted out of the rule without anyone noticing. This
  // ties it to the same selection the other two gates use.
  check(COMPARATOR_MATCHUPS.includes(gateCComparatorLabel),
    `C: comparator matchup '${gateCComparatorLabel}' is not in the ${SUBJECT}-free set (${COMPARATOR_MATCHUPS.join(', ')})`)
  const retiariusVsMurmillo = committedOf(matchupLabel(SUBJECT, 'heavy'))
  const hoplomachusVsMurmillo = committedOf(gateCComparatorLabel)
  check((retiariusVsMurmillo?.insideEnvelope ?? 1) <= (hoplomachusVsMurmillo?.insideEnvelope ?? 0),
    `C: retiarius vs murmillo ${pct(retiariusVsMurmillo?.insideEnvelope ?? Number.NaN)} inside the envelope, above the hoplomachus' ${pct(hoplomachusVsMurmillo?.insideEnvelope ?? Number.NaN)}`)

  // GATE D -- the WHOLE type, probe included. Gating only the committed attack
  // would let the cheap probe carry the visual impression, and measurement
  // confirms it can: `fast-slash` is selected more often than the lunge and
  // lands far closer.
  //
  // A COMPARISON, not a bar (decided by the design owner, 2026-08-27): the
  // `63.0%` the spec quotes is a measurement of the authored content offered as
  // the comparison's source, exactly as gate C's `65.0%` is, and was never a
  // threshold. Nothing here encodes it, and nothing should.
  //
  // The comparator side is `COMPARATOR_MATCHUPS`, not the pooled sample. It was
  // pooled until external review of the shipped implementation caught it -- the
  // fourth comparator in this slice to be coupled to the thing it judged, and
  // the first to survive into the merged content. Fixing it makes gate D pass
  // by MORE, not less (the hoplomachus' `vs fast` component drags his own
  // pooled average down, so pooled was the stricter reading), which is why no
  // shipped content depends on this repair -- but a gate that would move with
  // the subject is not a gate whatever direction it happens to point today.
  const fastWhole = wholeTypeEnvelopeShare(SUBJECT, ALL_MATCHUPS)
  const technicalWhole = wholeTypeEnvelopeShare(COMPARATOR, COMPARATOR_MATCHUPS)
  check(fastWhole <= technicalWhole,
    `D: retiarius total offence ${pct(fastWhole)} inside the envelope, above the hoplomachus' fast-free ${pct(technicalWhole)}`)

  // GATE E -- give-ground survives, gated on ground rather than on time.
  check(immediateShare <= 0.05, `E: forced disengages clearing within one tick ${pct(immediateShare)} above 5%`)
  check(percentile(disengageTicks, 0.5) >= 24, `E: forced disengage median ${percentile(disengageTicks, 0.5)} ticks below 24`)
  // Duration alone is satisfiable by making the range exit unreachable, which
  // pins every episode to the 30-tick cap without proving Fast opened any
  // ground. So the ground itself is gated, at the authored baseline's own
  // measured median.
  check(percentile(disengageGained, 0.5) >= DISENGAGE_GAIN_FLOOR, `E: forced disengage median separation gained ${fixed(percentile(disengageGained, 0.5))} below ${DISENGAGE_GAIN_FLOOR}`)

  // GATE F -- per incoming action rather than pooled, because a pooled figure
  // lets unchanged heavy/technical parries hide a regression specifically
  // against the newly ranged Fast attacks. Those two are the whole mechanism at
  // risk: Technical's forced counter begins only while the attacker is still
  // within 2.3 units, and this slice moves the retiarius outward.
  //
  // ASSERTED ONLY FOR THE TWO FAST ROWS, deliberately. The authored content
  // already converts `technical-driving-thrust` at 77.8% -- Technical parrying
  // Technical, then finding the attacker beyond 2.3 -- and a gate that fails on
  // unchanged behaviour is not a gate, it is a pre-existing property being
  // charged to whoever runs it next. That figure is worth someone's attention
  // and is printed above; it is not this slice's to fix.
  for (const incoming of ['fast-slash', 'fast-burst-lunge']) {
    const parried = pooledParries[incoming] ?? 0
    const converted = pooledCountersByIncoming[incoming] ?? 0
    check(parried === 0 || converted / parried >= 0.90,
      `F: parry-to-counter conversion after ${incoming} is ${pct(converted / parried)} (${converted}/${parried}), below 90%`)
  }

  // GATE G -- against the same independent comparator as gate C, for the same
  // reason: the hoplomachus' pooled failure rate moves when the retiarius does.
  const fastGeometry = fastPooled?.geometryFailureRate ?? 1
  const comparator = committedGeometryFailure(COMPARATOR, COMPARATOR_MATCHUPS)
  check(fastGeometry <= comparator, `G: retiarius committed geometry failures ${pct(fastGeometry)} above the hoplomachus' fast-free ${pct(comparator)}`)

  // -------------------------------------------------------------------------
  // The murmillo-pin slice's gates, ADDED beside A-G and replacing none of
  // them (spec gate S). Every clause reads PR-2's seam, and every reason is
  // re-checked against the endpoints recorded beside it before any of it is
  // counted -- a reason says WHICH exit fired, never that one deserved to.
  // -------------------------------------------------------------------------

  failures = slice

  // The corroboration pass comes first and is not a gate clause: if a record
  // contradicts itself, every number computed from it is void and reporting a
  // pass or a failure would both be wrong.
  const contradictions = pooledDisengages.map((episode) => corroborate(episode)).filter((message): message is string => message !== undefined)
  check(contradictions.length === 0,
    `seam: ${contradictions.length} disengage records contradict their own endpoints, e.g. ${contradictions[0]}`)
  check(totalUnmeasurable === 0,
    `seam: ${totalUnmeasurable} disengage episodes could not be measured, which cannot happen in a duel`)

  const MURMILLO_MATCHUPS = [matchupLabel(SUBJECT, 'heavy'), matchupLabel('heavy', SUBJECT)]
  const P_COMPARATOR_MATCHUPS = [matchupLabel(SUBJECT, COMPARATOR), matchupLabel(COMPARATOR, SUBJECT), matchupLabel(SUBJECT, SUBJECT)]
  /**
   * Spec §5 P3: **80% of each comparator's own pre-change measured share.** The
   * rule is frozen; these are its inputs, and they had to be re-measured.
   *
   * The spec's literals were 25.4%, 25.4% and 53.8% -- 80% of 31.7%, 31.7% and
   * 67.2%. Those three shares were taken with the duration-inference instrument
   * and, crucially, they counted every episode that **reached the exit range**,
   * because they were written before round-3 review made a success require
   * 0.75 units of ground as well. Two review rounds changed two things and
   * nobody re-derived one against the other.
   *
   * Measured here on PR-2's seam under the definition the gate actually uses,
   * 200 seeds: **26.0%, 29.7% and 42.5%**. The mirror is where they diverge
   * most, and the reason is the finding: **222 of its 588 range exits, 37.8%,
   * opened less than 0.75 units.** Round 3's epsilon-success construction was
   * not a hypothetical -- it is 38% of the shipped mirror.
   *
   * So the old floors would have failed the AUTHORED build (42.5% against
   * 53.8%), and a gate that fails on unchanged behaviour is not a gate, it is a
   * pre-existing property charged to whoever runs it next -- this file's own
   * gate F says so in as many words.
   *
   * Floors are 80% of the measured share, truncated to three decimals so a
   * re-run's last digit cannot flip a gate.
   */
  const P3_FLOORS: Readonly<Record<string, number>> = {
    [matchupLabel(SUBJECT, COMPARATOR)]: 0.208,
    [matchupLabel(COMPARATOR, SUBJECT)]: 0.237,
    [matchupLabel(SUBJECT, SUBJECT)]: 0.340,
  }

  // GATE P -- the escape must work against the opponent it exists for.
  // P1 and P2 are asserted per orientation, never pooled: §4.1 is the record of
  // what pooling hid the first time.
  for (const label of MURMILLO_MATCHUPS) {
    const s = statsFor(label)
    check((s?.successShare ?? 0) >= 0.25, `P1: ${label} success share ${pct(s?.successShare ?? Number.NaN)} below 25%`)
  }
  const comparatorShares = P_COMPARATOR_MATCHUPS.map((label) => statsFor(label)?.successShare ?? Number.NaN)
  const lowestComparator = Math.min(...comparatorShares)
  for (const label of MURMILLO_MATCHUPS) {
    const s = statsFor(label)
    // P2 is decorative wherever `min(others) < 50%` -- then `0.5 * min < 25%`
    // and P1 already binds. It is kept because it bites in the region that
    // matters, a candidate that makes the escape easy everywhere, and it is
    // labelled here rather than left to look stronger than it is.
    check((s?.successShare ?? 0) >= 0.5 * lowestComparator,
      `P2: ${label} success share ${pct(s?.successShare ?? Number.NaN)} below half the lowest comparator ${pct(lowestComparator)}`)
  }
  // P3 is the floor under the COMPARATOR that a previous revision claimed P1
  // provided and did not: P1 floors the murmillo numerator, and nothing floored
  // the denominator P2 divides by. Applied to each comparator separately rather
  // than to their minimum, because both reviewers found that hole independently.
  for (const [label, floor] of Object.entries(P3_FLOORS)) {
    const s = statsFor(label)
    check((s?.successShare ?? 0) >= floor, `P3: comparator ${label} success share ${pct(s?.successShare ?? Number.NaN)} below its floor ${pct(floor)}`)
  }

  // GATE Q -- the ground must actually be opened, per pair, over BOTH
  // populations. One is not enough: a candidate can let 25% succeed quickly and
  // 75% run to the cap, and then an all-episode median is carried by the
  // failures while a success-only median is carried by a small fast subset.
  for (const label of MURMILLO_MATCHUPS) {
    const s = statsFor(label)
    check((s?.groundMedianSuccesses ?? 0) >= DISENGAGE_SUCCESS_GROUND,
      `Q: ${label} median ground over successes ${fixed(s?.groundMedianSuccesses ?? Number.NaN)} below ${DISENGAGE_SUCCESS_GROUND}`)
    check((s?.groundMedianDecided ?? 0) >= DISENGAGE_SUCCESS_GROUND,
      `Q: ${label} median ground over all decided episodes ${fixed(s?.groundMedianDecided ?? Number.NaN)} below ${DISENGAGE_SUCCESS_GROUND}`)
  }

  // GATE Q2 -- the escape must not become trivial to complete. R excludes only
  // ONE-tick exits, so a two-tick escape completing every time satisfies
  // everything else here. 8 ticks is a third of gate E's pooled 24-tick floor:
  // a triviality guard, not a duration target, since a real per-pair duration
  // bar would fail the shipped mirror.
  for (const label of FAST_MATCHUPS) {
    const s = statsFor(label)
    if (!s || s.successes === 0) continue
    check(s.durationMedianSuccesses >= 8, `Q2: ${label} median successful episode ${s.durationMedianSuccesses} ticks below 8`)
    check(s.subFourTickSuccessShare <= 0.10, `Q2: ${label} successes completing in under 4 ticks ${pct(s.subFourTickSuccessShare)} above 10%`)
  }

  // GATE R -- the counter-lever, per matchup and additive to gate E's pooled 5%
  // above, which stays in force unchanged. Two constraints answering two
  // questions: swapping the pooled clause for this one would let a candidate at
  // 8% in EVERY matchup pass where the shipped build sits at 2.9% pooled.
  //
  // The bar is 10%, not 8%. 7.8% of 859 mirror episodes has a binomial standard
  // error of ~0.9 points, so a bar 0.2 points above the baseline sits at 0.22
  // sigma -- noise dressed as headroom, on the clause the spec itself calls the
  // one most likely to break. 10% is ~2.4 sigma.
  for (const label of FAST_MATCHUPS) {
    const s = statsFor(label)
    if (!s || s.decided === 0) continue
    check(s.immediateShare <= 0.10, `R: ${label} episodes clearing within one tick ${pct(s.immediateShare)} above 10%`)
  }

  console.log('\nGATE')
  console.log(`  A-G, the previous slice's frozen gates (spec gate S): ${inherited.length === 0 ? 'all pass' : `${inherited.length} FAILED`}`)
  for (const failure of inherited) console.error(`FAIL ${failure}`)
  console.log(`  P, Q, Q2, R, this slice's gates: ${slice.length === 0 ? 'all pass' : `${slice.length} FAILED`}`)
  for (const failure of slice) console.error(`FAIL ${failure}`)

  if (inherited.length === 0 && slice.length === 0) {
    console.log('all reach gates pass')
  } else {
    // Exit 1 either way -- a candidate is not acceptable until both groups are
    // green -- but the two lines above say which kind of red this is. Before
    // the content change, P and Q failing IS the expected reading.
    process.exit(1)
  }
}

if (args.json) {
  writeFileSync(args.json, `${JSON.stringify({
    seeds: args.seeds,
    overlay: args.overlay ?? null,
    envelope: ENVELOPE,
    pooled: Object.fromEntries((Object.keys(catalog.attacks) as AttackActionId[]).map((id) => [id, summarise(pooledSamples[id] ?? [], pooledGeometryFailures[id] ?? 0, ENVELOPE) ?? null])),
    perMatchup: matchups.map((m) => ({
      label: m.label,
      attacks: Object.fromEntries((Object.keys(catalog.attacks) as AttackActionId[]).map((id) => [id, summarise(m.reached[id] ?? [], m.geometryFailures[id] ?? 0, ENVELOPE) ?? null])),
      disengages: m.disengages,
      parries: m.parries,
      countersByIncoming: m.countersByIncoming,
    })),
    headToHeadMargin: (headToHead.hoplomachus?.contactMedian ?? Number.NaN) - (headToHead.retiarius?.contactMedian ?? Number.NaN),
    comparatorMatchups: COMPARATOR_MATCHUPS,
    hoplomachusIndependentGeometryFailure: committedGeometryFailure(COMPARATOR, COMPARATOR_MATCHUPS),
    // Both sides of gate D, plus the coupled figure it used to read, so a
    // recorded run says which comparator produced it rather than leaving a
    // reader to infer it from the harness version.
    wholeTypeEnvelopeShare: {
      subject: wholeTypeEnvelopeShare(SUBJECT, ALL_MATCHUPS),
      comparatorIndependent: wholeTypeEnvelopeShare(COMPARATOR, COMPARATOR_MATCHUPS),
      comparatorPooled: wholeTypeEnvelopeShare(COMPARATOR, ALL_MATCHUPS),
    },
  }, null, 2)}\n`, 'utf8')
  console.log(`\nwrote ${args.json}`)
}
