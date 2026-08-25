// Where each attack actually lands, and how the signature mechanics that
// depend on distance fare.
//
// This is the retiarius-reach slice's acceptance harness. It exists as
// committed, reviewable code rather than as numbers pasted into a spec because
// the external review's blocking finding was precisely that: a criterion whose
// measurement is not frozen is not a criterion, since two reasonable harnesses
// disagree about what "makes contact" means and land on different medians.
//
// Everything that could be decided two ways is decided once, here, with the
// reason:
//
//  * WHICH BOUTS. The equal-stat style fixture from `balance.test.ts` -- same
//    stats for all three styles, varying only the archetype -- over
//    `--seeds` consecutive seeds from `BASELINE_TEST_SEED`, all nine ordered
//    matchups. Equal-stat rather than the roster, because a roster measurement
//    would let fighter tuning move a reach number.
//
//  * ONE SAMPLE PER ACTION INSTANCE, taken on the tick that instance occupies
//    its `contact` phase, from the pre-resolution root separation. Actions are
//    keyed by `ActionInstanceId`, so a long bout cannot contribute the same
//    swing twice.
//
//  * WHICH INSTANCES COUNT. Only those whose geometry actually reached the
//    target:
//      - EXCLUDED `attack-missed` reason `geometry` -- the weapon did not
//        arrive;
//      - EXCLUDED `attack-missed` reason `target-unavailable` -- there was
//        nothing to arrive at;
//      - EXCLUDED `attack-evaded` -- an evade succeeds exactly by leaving the
//        attack's geometry, so it is a geometry failure under another event
//        name. Including it was the measurement defect the review caught: the
//        defender's authored 0.9-1.2 dash is added to the separation, which
//        inflates the median, and inflates it MOST for the long-reaching
//        attacks whose case this harness is arguing.
//      - INCLUDED `attack-missed` reason `accuracy`, `attack-blocked`,
//        `attack-parried`, `damage-dealt` -- in all four the weapon reached
//        the opponent at that separation. Whether the swing then landed is an
//        accuracy/defence question, not a reach one.
//
//  * PERCENTILES. `balanceCohorts.percentile` is imported rather than
//    reimplemented, so this file cannot drift from the convention the balance
//    suites already use (nearest-rank, `sorted[floor((n-1) * f)]`).
//
//  * WEIGHTING. Every statistic is reported per ordered matchup as well as
//    pooled. A pooled median alone can move because one action got selected
//    more often rather than because it started landing further out, and a
//    pooled median can also pass while half the sample still sits at the old
//    close distance. The per-matchup table and the explicit tail share below
//    are what make those two failures visible.
//
// `--overlay <file.json>` patches the authored catalog before the run: a
// partial `{ attacks?, styles? }` object, deep-merged. That is the prototyping
// seam -- candidate numbers are measured without editing content, so a sweep
// leaves no diff and cannot be confused with a decision.
//
// Usage:
//   npm run measure:reach -- --seeds 200
//   npm run measure:reach -- --seeds 30 --overlay /tmp/candidate.json
//   npm run measure:reach -- --seeds 30 --json /tmp/out.json

import { readFileSync, writeFileSync } from 'node:fs'
import { COMBAT_STYLES } from '../src/content/combatStyles'
import { BASELINE_TEST_SEED } from '../src/content/mvpSeries'
import { advanceBattleTick, createBattle, MAX_BOUT_TICKS } from '../src/simulation/battle'
import { percentile } from '../src/testSupport/balanceCohorts'
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
 * The murmillo's authored `preferredRange.max`. The tail statistic below asks
 * how much of a type's committed offence happens inside the murmillo's own
 * fighting distance -- read from the catalog rather than written as `1.7`, so
 * a slice that moves the murmillo cannot silently move the yardstick too.
 */
const MURMILLO_ENVELOPE = COMBAT_STYLES.styles.heavy.preferredRange.max

interface Args {
  seeds: number
  overlay?: string
  json?: string
}

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

function equalStatFighter(id: string, archetype: Archetype): FighterDefinition {
  // Copied deliberately from `balance.test.ts`'s own fixture, and deliberately
  // NOT read from `mvpSeries.ts`: roster tuning must not be able to move a
  // reach measurement any more than it may move a balance band.
  return { id, name: id, school: 'Style Cohort', archetype, maxHp: 160, power: 20, accuracy: 0.88, defenseChance: 0.35, criticalChance: 0.12 }
}

type Overlay = { attacks?: Record<string, Record<string, unknown>>; styles?: Record<string, Record<string, unknown>> }

function applyOverlay(overlayPath: string | undefined): CombatStyleCatalog {
  const catalog = structuredClone(COMBAT_STYLES) as unknown as CombatStyleCatalog
  if (!overlayPath) return catalog
  const overlay = JSON.parse(readFileSync(overlayPath, 'utf8')) as Overlay
  const attacks = catalog.attacks as unknown as Record<string, Record<string, unknown>>
  const styles = catalog.styles as unknown as Record<string, Record<string, unknown>>
  for (const [id, patch] of Object.entries(overlay.attacks ?? {})) {
    if (!(id in attacks)) throw new Error(`overlay patches unknown attack '${id}'`)
    Object.assign(attacks[id], patch)
  }
  for (const [id, patch] of Object.entries(overlay.styles ?? {})) {
    if (!(id in styles)) throw new Error(`overlay patches unknown style '${id}'`)
    Object.assign(styles[id], patch)
  }
  return catalog
}

interface Sample {
  /** Separation on the tick the instance was chosen. */
  start: number
  /** Separation on the tick the instance occupied `contact`. */
  contact: number
}

interface MatchupResult {
  label: string
  /** Reached-the-target samples, per attack id. */
  samples: Record<string, Sample[]>
  /** Instances excluded because their geometry never reached, per attack id. */
  geometryFailures: Record<string, number>
  /** Ticks each fast forced-disengage lasted before clearing. */
  forcedDisengageTicks: number[]
  /** Forced disengages that cleared on the tick after they were set: the mechanic did not run. */
  forcedDisengageImmediate: number
  successfulParries: number
  parryCounterStarts: number
}

function emptyMatchup(label: string): MatchupResult {
  return { label, samples: {}, geometryFailures: {}, forcedDisengageTicks: [], forcedDisengageImmediate: 0, successfulParries: 0, parryCounterStarts: 0 }
}

function runMatchup(catalog: CombatStyleCatalog, homeStyle: Archetype, awayStyle: Archetype, seeds: number): MatchupResult {
  const result = emptyMatchup(`${homeStyle} vs ${awayStyle}`)

  for (let index = 0; index < seeds; index += 1) {
    let battle = createBattle({
      home: equalStatFighter('home', homeStyle),
      away: equalStatFighter('away', awayStyle),
      seed: BASELINE_TEST_SEED + index,
      combatStyles: catalog,
    })
    const ids = [battle.descriptor.homeId, battle.descriptor.awayId]

    const startSeparation = new Map<string, number>()
    const contactSeparation = new Map<string, number>()
    const actionOf = new Map<string, string>()
    const reachedTarget = new Map<string, boolean>()
    const seenContact = new Set<string>()
    const forcedSince = new Map<string, number>()

    while (battle.phase === 'running' && battle.encounter.tick < MAX_BOUT_TICKS) {
      const previousTick = battle.encounter.tick
      battle = advanceBattleTick(battle)
      const [a, b] = ids.map((id) => battle.encounter.combatants[id])
      const dx = a.position.x - b.position.x
      const dz = a.position.z - b.position.z
      const separation = Math.sqrt(dx * dx + dz * dz)

      for (const event of battle.events) {
        if (event.tick !== previousTick + 1) continue
        switch (event.type) {
          case 'action-started':
            startSeparation.set(event.actionInstanceId, separation)
            actionOf.set(event.actionInstanceId, event.actionId)
            break
          case 'attack-missed':
            // `accuracy` reached the target and missed; the other two never arrived.
            reachedTarget.set(event.actionInstanceId, event.reason === 'accuracy')
            break
          case 'attack-evaded':
            reachedTarget.set(event.actionInstanceId, false)
            break
          case 'attack-blocked':
          case 'attack-parried':
          case 'damage-dealt':
            reachedTarget.set(event.actionInstanceId, true)
            break
          default:
            break
        }
        if (event.type === 'attack-parried') result.successfulParries += 1
        if (event.type === 'action-started' && event.actionId === 'technical-parry-counter') result.parryCounterStarts += 1
      }

      for (const combatant of [a, b]) {
        if (combatant.action.type === 'active' && combatant.action.phase === 'contact' && !seenContact.has(combatant.action.instanceId)) {
          seenContact.add(combatant.action.instanceId)
          contactSeparation.set(combatant.action.instanceId, separation)
        }
        // Fast's forced disengage, watched on the state field the kernel owns.
        const forcedTick = combatant.forcedDisengageStartTick
        if (forcedTick !== undefined && !forcedSince.has(combatant.id)) forcedSince.set(combatant.id, forcedTick)
        if (forcedTick === undefined && forcedSince.has(combatant.id)) {
          const elapsed = battle.encounter.tick - (forcedSince.get(combatant.id) as number)
          result.forcedDisengageTicks.push(elapsed)
          if (elapsed <= 1) result.forcedDisengageImmediate += 1
          forcedSince.delete(combatant.id)
        }
      }
    }

    for (const [instance, contact] of contactSeparation) {
      const actionId = actionOf.get(instance)
      if (actionId === undefined || !(actionId in catalog.attacks)) continue
      if (reachedTarget.get(instance) !== true) {
        result.geometryFailures[actionId] = (result.geometryFailures[actionId] ?? 0) + 1
        continue
      }
      const start = startSeparation.get(instance)
      if (start === undefined) continue
      ;(result.samples[actionId] ??= []).push({ start, contact })
    }
  }

  return result
}

interface Summary {
  n: number
  startMedian: number
  contactP10: number
  contactMedian: number
  contactP90: number
  /** Share of reached contacts landing at or below the murmillo's preferred max. */
  insideMurmilloEnvelope: number
  /** `startMedian - contactMedian`, negative when the attack closes between decision and contact. */
  delta: number
  geometryFailureRate: number
}

function summarise(samples: readonly Sample[], geometryFailures: number): Summary | undefined {
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
    insideMurmilloEnvelope: contacts.filter((d) => d <= MURMILLO_ENVELOPE).length / contacts.length,
    delta: startMedian - contactMedian,
    geometryFailureRate: geometryFailures / (samples.length + geometryFailures),
  }
}

const args = parseArgs(process.argv.slice(2))
const catalog = applyOverlay(args.overlay)

const matchups: MatchupResult[] = []
for (const homeStyle of STYLES) {
  for (const awayStyle of STYLES) matchups.push(runMatchup(catalog, homeStyle, awayStyle, args.seeds))
}

const pooled = emptyMatchup('POOLED')
for (const matchup of matchups) {
  for (const [id, samples] of Object.entries(matchup.samples)) (pooled.samples[id] ??= []).push(...samples)
  for (const [id, count] of Object.entries(matchup.geometryFailures)) pooled.geometryFailures[id] = (pooled.geometryFailures[id] ?? 0) + count
  pooled.forcedDisengageTicks.push(...matchup.forcedDisengageTicks)
  pooled.forcedDisengageImmediate += matchup.forcedDisengageImmediate
  pooled.successfulParries += matchup.successfulParries
  pooled.parryCounterStarts += matchup.parryCounterStarts
}

const fixed = (value: number, places = 2) => value.toFixed(places)
const pct = (value: number) => `${(value * 100).toFixed(1)}%`

console.log(`\nequal-stat cohorts, ${args.seeds} seeds x 9 ordered matchups${args.overlay ? `, overlay ${args.overlay}` : ''}`)
console.log(`murmillo envelope (heavy preferredRange.max) = ${MURMILLO_ENVELOPE}\n`)

console.log('POOLED, per attack')
console.log(`${'action'.padEnd(26)} ${'authored'.padEnd(11)} ${'n'.padStart(6)} ${'start'.padStart(6)} ${'p10'.padStart(6)} ${'med'.padStart(6)} ${'p90'.padStart(6)} ${'delta'.padStart(7)} ${'<=env'.padStart(7)} ${'geomFail'.padStart(9)}`)
for (const id of Object.keys(catalog.attacks)) {
  const summary = summarise(pooled.samples[id] ?? [], pooled.geometryFailures[id] ?? 0)
  const authored = `${catalog.attacks[id as AttackActionId].contactRange.min}-${catalog.attacks[id as AttackActionId].contactRange.max}`
  if (!summary) { console.log(`${id.padEnd(26)} ${authored.padEnd(11)} ${'0'.padStart(6)}`); continue }
  console.log(
    `${id.padEnd(26)} ${authored.padEnd(11)} ${String(summary.n).padStart(6)} ${fixed(summary.startMedian).padStart(6)} ` +
    `${fixed(summary.contactP10).padStart(6)} ${fixed(summary.contactMedian).padStart(6)} ${fixed(summary.contactP90).padStart(6)} ` +
    `${fixed(summary.delta).padStart(7)} ${pct(summary.insideMurmilloEnvelope).padStart(7)} ${pct(summary.geometryFailureRate).padStart(9)}`,
  )
}

console.log('\nCOMMITTED attack contact median, per ordered matchup (the reach ordering is gated here, not only pooled)')
console.log(`${'matchup'.padEnd(26)} ${'action'.padEnd(26)} ${'n'.padStart(5)} ${'med'.padStart(6)} ${'<=env'.padStart(7)}`)
for (const matchup of matchups) {
  const [homeStyle] = matchup.label.split(' vs ') as [Archetype]
  const actionId = COMMITTED_ATTACK[homeStyle]
  const summary = summarise(matchup.samples[actionId] ?? [], matchup.geometryFailures[actionId] ?? 0)
  console.log(
    `${matchup.label.padEnd(26)} ${actionId.padEnd(26)} ${String(summary?.n ?? 0).padStart(5)} ` +
    `${(summary ? fixed(summary.contactMedian) : '--').padStart(6)} ${(summary ? pct(summary.insideMurmilloEnvelope) : '--').padStart(7)}`,
  )
}

console.log('\nORDERING (pooled committed medians)')
const orderingRow = STYLES.map((style) => {
  const summary = summarise(pooled.samples[COMMITTED_ATTACK[style]] ?? [], 0)
  return { style, median: summary?.contactMedian }
})
console.log(orderingRow.map(({ style, median }) => `${style} ${median === undefined ? '--' : fixed(median)}`).join('   '))
const [heavyRow, fastRow, technicalRow] = orderingRow
if (heavyRow.median !== undefined && fastRow.median !== undefined && technicalRow.median !== undefined) {
  console.log(`gaps: fast-heavy ${fixed(fastRow.median - heavyRow.median)}   technical-fast ${fixed(technicalRow.median - fastRow.median)}`)
}

console.log('\nSIGNATURE MECHANICS')
const forced = [...pooled.forcedDisengageTicks].sort((x, y) => x - y)
if (forced.length > 0) {
  console.log(
    `fast forced disengage: n=${forced.length} med=${percentile(forced, 0.5)} p90=${percentile(forced, 0.9)} ticks, ` +
    `cleared within one tick ${pct(pooled.forcedDisengageImmediate / forced.length)}`,
  )
} else {
  console.log('fast forced disengage: never triggered')
}
console.log(
  `technical parry -> counter: ${pooled.parryCounterStarts}/${pooled.successfulParries} = ` +
  `${pooled.successfulParries > 0 ? pct(pooled.parryCounterStarts / pooled.successfulParries) : '--'}`,
)

if (args.json) {
  writeFileSync(args.json, `${JSON.stringify({
    seeds: args.seeds,
    overlay: args.overlay ?? null,
    murmilloEnvelope: MURMILLO_ENVELOPE,
    pooled: Object.fromEntries(Object.keys(catalog.attacks).map((id) => [id, summarise(pooled.samples[id] ?? [], pooled.geometryFailures[id] ?? 0) ?? null])),
    perMatchup: matchups.map((matchup) => ({
      label: matchup.label,
      committed: Object.fromEntries(Object.keys(catalog.attacks).map((id) => [id, summarise(matchup.samples[id] ?? [], matchup.geometryFailures[id] ?? 0) ?? null])),
    })),
    forcedDisengage: { samples: forced.length, immediate: pooled.forcedDisengageImmediate },
    parryCounter: { parries: pooled.successfulParries, counters: pooled.parryCounterStarts },
  }, null, 2)}\n`, 'utf8')
  console.log(`\nwrote ${args.json}`)
}
