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
//    The hoplomachus' geometry-failure rate is taken from its matchups that
//    contain no `fast` at all, because its `vs fast` component moves when the
//    retiarius moves -- the coupling defect that invalidated an earlier version
//    of the ordering criterion.
//
// `--overlay <file.json>` deep-merges a partial `{ attacks?, styles? }` into
// the catalog before the run and validates the result, so candidate numbers are
// measured without editing content and an invalid candidate fails loudly.
//
// Usage:
//   npm run measure:reach -- --seeds 200
//   npm run measure:reach -- --seeds 200 --gate
//   npm run measure:reach -- --seeds 50 --overlay /tmp/candidate.json --json /tmp/out.json

import { readFileSync, writeFileSync } from 'node:fs'
import { COMBAT_STYLES } from '../src/content/combatStyles'
import { BASELINE_TEST_SEED } from '../src/content/mvpSeries'
import { advanceBattleTick, createBattle, MAX_BOUT_TICKS } from '../src/simulation/battle'
import { FAST_FORCED_DISENGAGE_MAX_TICKS } from '../src/simulation/combatDecision'
import { percentile } from '../src/testSupport/balanceCohorts'
// `REACHED`, `GEOMETRY_FAILURE` and the overlay merge live in `src/` rather
// than here: `scripts/` is outside tsconfig's `include`, so nothing in this
// file is typechecked by `npm run build` or reachable by Vitest, and those two
// pieces are the ones that can be silently wrong. See `reachHarness.ts`.
import { applyOverlay, GEOMETRY_FAILURE, REACHED } from '../src/testSupport/reachHarness'
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

/** One episode of Fast's forced disengage: how long it ran and how much ground it actually opened. */
interface DisengageEpisode { ticks: number; gained: number; exit: 'range' | 'cap' | 'censored' }

interface MatchupResult {
  label: string
  home: Archetype
  away: Archetype
  reached: Record<string, Sample[]>
  geometryFailures: Record<string, number>
  otherOutcomes: Record<string, number>
  disengages: DisengageEpisode[]
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
  return { label, home, away, reached: {}, geometryFailures: {}, otherOutcomes: {}, disengages: [], parries: {}, countersByIncoming: {} }
}

function runMatchup(catalog: CombatStyleCatalog, home: Archetype, away: Archetype, seeds: number): MatchupResult {
  const result = emptyMatchup(`${home} vs ${away}`, home, away)

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
    const startSeparation = new Map<string, number>()
    const forcedSince = new Map<string, { tick: number; separation: number }>()
    /** The last parry each defender landed, so a forced counter can be attributed to the incoming action that earned it. */
    const lastParry = new Map<string, { actionId: string; tick: number }>()
    let openingSeparation = separationOf(battle)

    while (battle.phase === 'running' && battle.encounter.tick < MAX_BOUT_TICKS) {
      const previousTick = battle.encounter.tick
      // The separation at the START of this tick. An action begins in phase 5,
      // before movement (phase 7-8), so this is what it was launched at -- and
      // it is also the correct end-points for the disengage window, which is
      // why both are taken here rather than after the tick.
      const tickOpening = openingSeparation

      for (const id of ids) {
        const combatant = battle.encounter.combatants[id]
        const forcedTick = combatant.forcedDisengageStartTick
        // Stamped: record the separation the retreat STARTS from, measured at
        // the opening of the tick the kernel set the field on. Taking it after
        // the tick shifted the window by one tick's movement at both ends.
        if (forcedTick !== undefined && !forcedSince.has(id)) forcedSince.set(id, { tick: forcedTick, separation: tickOpening })
      }

      battle = advanceBattleTick(battle, undefined, collector)
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

      for (const id of ids) {
        if (battle.encounter.combatants[id].forcedDisengageStartTick === undefined && forcedSince.has(id)) {
          const started = forcedSince.get(id) as { tick: number; separation: number }
          const ticks = battle.encounter.tick - started.tick
          result.disengages.push({
            ticks,
            gained: openingSeparation - started.separation,
            // Read from the exported constant, never a literal: Task 5 of the
            // plan tunes it, and a hard-coded 30 would silently mislabel every
            // range exit past that tick.
            exit: ticks >= FAST_FORCED_DISENGAGE_MAX_TICKS ? 'cap' : 'range',
          })
          forcedSince.delete(id)
        }
      }
    }
    // Episodes still running when the bout ended are censored, not dropped.
    for (const [, started] of forcedSince) {
      result.disengages.push({ ticks: battle.encounter.tick - started.tick, gained: separationOf(battle) - started.separation, exit: 'censored' })
    }

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
 * Gate D's statistic: over ALL of a style's reached contacts, probe and
 * committed together, the share landing inside the murmillo's envelope.
 */
function wholeTypeEnvelopeShare(archetype: Archetype): number {
  let inside = 0
  let total = 0
  for (const id of STYLE_ATTACKS[archetype]) {
    for (const sample of pooledSamples[id] ?? []) {
      total += 1
      if (sample.contact <= ENVELOPE) inside += 1
    }
  }
  return total > 0 ? inside / total : Number.NaN
}

/** The hoplomachus' geometry-failure rate over its matchups containing no `fast` -- an independent comparator. */
function hoplomachusIndependentGeometryFailure(): number {
  let reached = 0
  let failed = 0
  for (const label of ['technical vs heavy', 'technical vs technical']) {
    const m = byLabel.get(label) as MatchupResult
    reached += (m.reached['technical-driving-thrust'] ?? []).length
    failed += m.geometryFailures['technical-driving-thrust'] ?? 0
  }
  return reached + failed > 0 ? failed / (reached + failed) : Number.NaN
}

const disengageTicks = pooledDisengages.map((d) => d.ticks).sort((a, b) => a - b)
const disengageGained = pooledDisengages.map((d) => d.gained).sort((a, b) => a - b)
const immediateShare = pooledDisengages.length > 0 ? pooledDisengages.filter((d) => d.ticks <= 1).length / pooledDisengages.length : Number.NaN
console.log('\nSIGNATURE MECHANICS')
if (pooledDisengages.length > 0) {
  const byExit = (exit: string) => pooledDisengages.filter((d) => d.exit === exit).length
  console.log(
    `fast forced disengage: n=${pooledDisengages.length} ticks med=${percentile(disengageTicks, 0.5)} ` +
    `separation gained med=${fixed(percentile(disengageGained, 0.5))} p10=${fixed(percentile(disengageGained, 0.1))} ` +
    `| cleared within one tick ${pct(immediateShare)} | exits range=${byExit('range')} cap=${byExit('cap')} censored=${byExit('censored')}`,
  )
} else {
  console.log('fast forced disengage: never triggered')
}
const totalParries = Object.values(pooledParries).reduce((t, n) => t + n, 0)
const totalCounters = Object.values(pooledCountersByIncoming).reduce((t, n) => t + n, 0)
console.log(`technical parry -> counter: ${totalCounters}/${totalParries} = ${totalParries > 0 ? pct(totalCounters / totalParries) : '--'}`)
console.log('  by incoming action (gate F is asserted per row, not on the total):')
for (const [incoming, parried] of Object.entries(pooledParries)) {
  const converted = pooledCountersByIncoming[incoming] ?? 0
  console.log(`    ${incoming.padEnd(26)} ${String(converted).padStart(5)}/${String(parried).padEnd(5)} ${pct(parried > 0 ? converted / parried : Number.NaN)}`)
}
console.log(`hoplomachus geometry failure, fast-free matchups only: ${pct(hoplomachusIndependentGeometryFailure())}`)

// ---------------------------------------------------------------------------
// Gate
// ---------------------------------------------------------------------------

if (args.gate) {
  const failures: string[] = []
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
  const retiariusVsMurmillo = committedOf('fast vs heavy')
  const hoplomachusVsMurmillo = committedOf('technical vs heavy')
  check((retiariusVsMurmillo?.insideEnvelope ?? 1) <= (hoplomachusVsMurmillo?.insideEnvelope ?? 0),
    `C: retiarius vs murmillo ${pct(retiariusVsMurmillo?.insideEnvelope ?? Number.NaN)} inside the envelope, above the hoplomachus' ${pct(hoplomachusVsMurmillo?.insideEnvelope ?? Number.NaN)}`)

  // GATE D -- the WHOLE type, probe included. Gating only the committed attack
  // would let the cheap probe carry the visual impression, and measurement
  // confirms it can: `fast-slash` is selected more often than the lunge and
  // lands far closer.
  const fastWhole = wholeTypeEnvelopeShare('fast')
  const technicalWhole = wholeTypeEnvelopeShare('technical')
  check(fastWhole <= technicalWhole,
    `D: retiarius total offence ${pct(fastWhole)} inside the envelope, above the hoplomachus' ${pct(technicalWhole)}`)

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
  const comparator = hoplomachusIndependentGeometryFailure()
  check(fastGeometry <= comparator, `G: retiarius committed geometry failures ${pct(fastGeometry)} above the hoplomachus' fast-free ${pct(comparator)}`)

  console.log('\nGATE')
  if (failures.length === 0) {
    console.log('all reach gates pass')
  } else {
    for (const failure of failures) console.error(`FAIL ${failure}`)
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
    hoplomachusIndependentGeometryFailure: hoplomachusIndependentGeometryFailure(),
  }, null, 2)}\n`, 'utf8')
  console.log(`\nwrote ${args.json}`)
}
