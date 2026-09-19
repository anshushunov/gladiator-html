// Time-at-distance: where the two fighters actually STAND during a bout, per
// tick, as opposed to where the catalogue says their attacks contact.
//
// The 2026-09-05 playtest produced two findings that the contact-band
// diagnostics could not see at all:
//
//   1. "the hoplomachus goes into melee and never tries to break the range" --
//      a statement about time spent at a distance, not about which attack
//      contacted;
//   2. "the fighters clinch and just grind almost stuck together" -- likewise.
//
// `contactDiagnostics.ts` records the separation at CONTACT ticks, which is a
// biased sample by construction: it only sees the moments an attack landed. A
// pair that stands nose-to-nose for six seconds and trades twice contributes
// two samples. This script samples every tick of every bout instead, which is
// the only way either finding above can be stated as a number.
//
// Recording only. Nothing here asserts a threshold; the acceptance bands for
// the slice live in `src/simulation/*.test.ts`, and this is the instrument the
// design doc quotes.
//
// Usage:
//   node node_modules/vite-node/vite-node.mjs scripts/measure-distance.ts
//   node node_modules/vite-node/vite-node.mjs scripts/measure-distance.ts -- --seeds=20 --json=docs/superpowers/plans/<name>.json

import { writeFileSync } from 'node:fs'
import { COMBAT_STYLES } from '../src/content/combatStyles'
import { BASELINE_TEST_SEED, homeRoster, opponents } from '../src/content/mvpSeries'
import { advanceBattleTick, createBattle, MAX_BOUT_TICKS, TICKS_PER_SECOND } from '../src/simulation/battle'
import type { FighterDefinition } from '../src/simulation/fighters'

/**
 * The absolute separation bands the playtest table was reported in, kept
 * verbatim so a post-change run is comparable to the pre-change one printed in
 * `docs/reviews/2026-09-05-skinned-gladiators-playtest.md`.
 *
 * They are ABSOLUTE on purpose. A band set rebased on the arena's separation
 * floor would move with the very constant this slice changes, and the two
 * tables would then be measuring different things while looking alike.
 */
const BANDS: readonly { label: string; max: number }[] = [
  { label: '<1.0', max: 1.0 },
  { label: '1.0-1.6', max: 1.6 },
  { label: '1.6-2.1', max: 2.1 },
  { label: '2.1-2.8', max: 2.8 },
  { label: '>2.8', max: Infinity },
]

/** A clinch is a run of at least this many consecutive ticks (1 s) below `CLINCH_DISTANCE`. */
const CLINCH_MIN_TICKS = TICKS_PER_SECOND
const CLINCH_DISTANCE = 1.2

/**
 * "Pinned at the floor" is the arena-relative companion to the absolute clinch
 * count: a run of at least a second within this much of `minimumSeparation`.
 *
 * The absolute `<1.2` clinch counter becomes vacuous the moment the floor is
 * raised to 1.2 -- it would read zero for a pair welded together at the new
 * floor, which is the opposite of the truth. This one keeps reporting the same
 * phenomenon whatever the floor is, and the two together are what make a
 * before/after pair of tables honest.
 */
const PINNED_MARGIN = 0.15

interface PairingSample {
  label: string
  homeArchetype: string
  awayArchetype: string
  /** Every tick's root separation across every seed, unsorted. */
  distances: number[]
  /** Per fighter: ticks spent inside that fighter's own authored `preferredRange`. */
  homeInPreferredTicks: number
  awayInPreferredTicks: number
  /** Per fighter: ticks spent closer than that fighter's own `preferredRange.min` -- closed down, inside its measure. */
  homeBelowPreferredTicks: number
  awayBelowPreferredTicks: number
  clinchRuns: number
  longestClinchTicks: number
  pinnedRuns: number
  longestPinnedTicks: number
  totalTicks: number
  bouts: number
  minimumSeparation: number
}

function percentile(sorted: readonly number[], fraction: number): number {
  return sorted[Math.floor((sorted.length - 1) * fraction)]
}

function inRange(distance: number, range: Readonly<{ min: number; max: number }>): boolean {
  return distance >= range.min && distance <= range.max
}

/**
 * Runs `seedCount` consecutive-seed bouts of one pairing and records the root
 * separation on every tick of every one of them.
 *
 * Run-length bookkeeping resets between bouts (`runs` is closed out at the end
 * of each), so a clinch can never be counted across a bout boundary -- two
 * different fights that each ended and began at close quarters are not one
 * six-second clinch.
 */
function samplePairing(home: FighterDefinition, away: FighterDefinition, seedCount: number): PairingSample {
  const homeStyle = COMBAT_STYLES.styles[home.archetype]
  const awayStyle = COMBAT_STYLES.styles[away.archetype]

  const sample: PairingSample = {
    label: `${home.id} (${home.archetype}) vs ${away.id} (${away.archetype})`,
    homeArchetype: home.archetype,
    awayArchetype: away.archetype,
    distances: [],
    homeInPreferredTicks: 0,
    awayInPreferredTicks: 0,
    homeBelowPreferredTicks: 0,
    awayBelowPreferredTicks: 0,
    clinchRuns: 0,
    longestClinchTicks: 0,
    pinnedRuns: 0,
    longestPinnedTicks: 0,
    totalTicks: 0,
    bouts: seedCount,
    minimumSeparation: 0,
  }

  for (let index = 0; index < seedCount; index += 1) {
    let battle = createBattle({ home, away, seed: BASELINE_TEST_SEED + index, combatStyles: COMBAT_STYLES })
    const homeId = battle.descriptor.homeId
    const awayId = battle.descriptor.awayId
    const floor = battle.encounter.arena.minimumSeparation
    sample.minimumSeparation = floor
    const pinnedDistance = floor + PINNED_MARGIN

    let clinchRun = 0
    let pinnedRun = 0

    const closeRun = () => {
      if (clinchRun >= CLINCH_MIN_TICKS) {
        sample.clinchRuns += 1
        sample.longestClinchTicks = Math.max(sample.longestClinchTicks, clinchRun)
      }
      if (pinnedRun >= CLINCH_MIN_TICKS) {
        sample.pinnedRuns += 1
        sample.longestPinnedTicks = Math.max(sample.longestPinnedTicks, pinnedRun)
      }
      clinchRun = 0
      pinnedRun = 0
    }

    while (battle.phase === 'running' && battle.encounter.tick < MAX_BOUT_TICKS) {
      battle = advanceBattleTick(battle)
      const a = battle.encounter.combatants[homeId].position
      const b = battle.encounter.combatants[awayId].position
      const dx = a.x - b.x
      const dz = a.z - b.z
      const distance = Math.sqrt(dx * dx + dz * dz)

      sample.distances.push(distance)
      sample.totalTicks += 1
      if (inRange(distance, homeStyle.preferredRange)) sample.homeInPreferredTicks += 1
      if (inRange(distance, awayStyle.preferredRange)) sample.awayInPreferredTicks += 1
      if (distance < homeStyle.preferredRange.min) sample.homeBelowPreferredTicks += 1
      if (distance < awayStyle.preferredRange.min) sample.awayBelowPreferredTicks += 1

      if (distance < CLINCH_DISTANCE) clinchRun += 1
      else if (clinchRun >= CLINCH_MIN_TICKS) {
        sample.clinchRuns += 1
        sample.longestClinchTicks = Math.max(sample.longestClinchTicks, clinchRun)
        clinchRun = 0
      } else clinchRun = 0

      if (distance < pinnedDistance) pinnedRun += 1
      else if (pinnedRun >= CLINCH_MIN_TICKS) {
        sample.pinnedRuns += 1
        sample.longestPinnedTicks = Math.max(sample.longestPinnedTicks, pinnedRun)
        pinnedRun = 0
      } else pinnedRun = 0
    }

    closeRun()
  }

  return sample
}

interface PairingReport {
  label: string
  homeArchetype: string
  awayArchetype: string
  median: number
  bandShares: number[]
  homeInPreferredShare: number
  awayInPreferredShare: number
  homeBelowPreferredShare: number
  awayBelowPreferredShare: number
  clinchRuns: number
  longestClinchSeconds: number
  pinnedRuns: number
  longestPinnedSeconds: number
  pinnedShare: number
  totalTicks: number
  minimumSeparation: number
}

function report(sample: PairingSample): PairingReport {
  const sorted = [...sample.distances].sort((a, b) => a - b)
  const counts = BANDS.map(() => 0)
  for (const distance of sample.distances) {
    const index = BANDS.findIndex((band) => distance < band.max)
    counts[index === -1 ? BANDS.length - 1 : index] += 1
  }
  const pinnedDistance = sample.minimumSeparation + PINNED_MARGIN
  return {
    label: sample.label,
    homeArchetype: sample.homeArchetype,
    awayArchetype: sample.awayArchetype,
    median: percentile(sorted, 0.5),
    bandShares: counts.map((count) => count / sample.totalTicks),
    homeInPreferredShare: sample.homeInPreferredTicks / sample.totalTicks,
    awayInPreferredShare: sample.awayInPreferredTicks / sample.totalTicks,
    homeBelowPreferredShare: sample.homeBelowPreferredTicks / sample.totalTicks,
    awayBelowPreferredShare: sample.awayBelowPreferredTicks / sample.totalTicks,
    clinchRuns: sample.clinchRuns,
    longestClinchSeconds: sample.longestClinchTicks / TICKS_PER_SECOND,
    pinnedRuns: sample.pinnedRuns,
    longestPinnedSeconds: sample.longestPinnedTicks / TICKS_PER_SECOND,
    pinnedShare: sample.distances.filter((d) => d < pinnedDistance).length / sample.totalTicks,
    totalTicks: sample.totalTicks,
    minimumSeparation: sample.minimumSeparation,
  }
}

function parseArgs(argv: readonly string[]): { seeds: number; json?: string } {
  let seeds = 20
  let json: string | undefined
  for (const arg of argv) {
    const seedMatch = /^--seeds=(\d+)$/.exec(arg)
    if (seedMatch) seeds = Number(seedMatch[1])
    const jsonMatch = /^--json=(.+)$/.exec(arg)
    if (jsonMatch) json = jsonMatch[1]
  }
  return { seeds, json }
}

function table(rows: readonly (readonly string[])[]): string {
  const widths = rows[0].map((_, column) => Math.max(...rows.map((row) => row[column].length)))
  return rows.map((row) => row.map((cell, column) => (column === 0 ? cell.padEnd(widths[column]) : cell.padStart(widths[column]))).join('  ')).join('\n')
}

const pct = (value: number) => `${(value * 100).toFixed(1)}%`

function main(): void {
  const { seeds, json } = parseArgs(process.argv.slice(2))
  const reports: PairingReport[] = []

  for (const home of homeRoster) {
    for (const away of opponents) {
      reports.push(report(samplePairing(home, away, seeds)))
    }
  }

  const floor = reports[0].minimumSeparation
  console.log(`\ntime at distance -- ${seeds} seeds per pairing, every tick of every bout, arena minimumSeparation ${floor}\n`)
  console.log(table([
    ['pairing', 'median', ...BANDS.map((band) => band.label), 'homePref', 'awayPref', 'clinch', 'longest', 'pinned', 'pinLongest', 'pin%'],
    ...reports.map((row) => [
      row.label,
      row.median.toFixed(2),
      ...row.bandShares.map(pct),
      pct(row.homeInPreferredShare),
      pct(row.awayInPreferredShare),
      String(row.clinchRuns),
      `${row.longestClinchSeconds.toFixed(1)}s`,
      String(row.pinnedRuns),
      `${row.longestPinnedSeconds.toFixed(1)}s`,
      pct(row.pinnedShare),
    ]),
  ]))

  // The two headline numbers the playtest findings are about, restated so a
  // reader does not have to pick them out of nine rows.
  // The three headline numbers the playtest findings are about, restated so a
  // reader does not have to pick them out of nine rows.
  //
  // Each SIDE of a pairing is one observation of "did this fighter get to stand
  // where its style wants to", so a mirror contributes two -- which is right,
  // both hoplomachi are being asked the question.
  const observations = (archetype: string, pick: (row: PairingReport, side: 'home' | 'away') => number): number[] =>
    reports.flatMap((row) => [
      ...(row.homeArchetype === archetype ? [pick(row, 'home')] : []),
      ...(row.awayArchetype === archetype ? [pick(row, 'away')] : []),
    ])
  const mean = (values: readonly number[]): number => values.reduce((sum, value) => sum + value, 0) / (values.length || 1)

  const technicalMeasure = COMBAT_STYLES.styles.technical.preferredRange
  const inMeasure = observations('technical', (row, side) => (side === 'home' ? row.homeInPreferredShare : row.awayInPreferredShare))
  const belowMeasure = observations('technical', (row, side) => (side === 'home' ? row.homeBelowPreferredShare : row.awayBelowPreferredShare))
  // The finding names the murmillo specifically: it is the pairing where the
  // hoplomachus was reported to just trade.
  const closedByHeavy = reports.flatMap((row) => [
    ...(row.homeArchetype === 'technical' && row.awayArchetype === 'heavy' ? [row.homeBelowPreferredShare] : []),
    ...(row.awayArchetype === 'technical' && row.homeArchetype === 'heavy' ? [row.awayBelowPreferredShare] : []),
  ])
  const totalPinnedTicks = reports.reduce((sum, row) => sum + row.pinnedShare * row.totalTicks, 0)
  const totalTicks = reports.reduce((sum, row) => sum + row.totalTicks, 0)

  console.log(`\ntechnical inside its own ${technicalMeasure.min}-${technicalMeasure.max} measure, mean over ${inMeasure.length} observations: ${pct(mean(inMeasure))}`)
  console.log(`technical closed down below that measure, same observations: ${pct(mean(belowMeasure))}`)
  console.log(`technical closed down below it BY A MURMILLO, ${closedByHeavy.length} observations: ${pct(mean(closedByHeavy))}`)
  console.log(`ticks pinned within ${PINNED_MARGIN} of the separation floor, all pairings: ${pct(totalPinnedTicks / totalTicks)}\n`)

  if (json) {
    writeFileSync(json, `${JSON.stringify({ seeds, minimumSeparation: floor, bands: BANDS.map((b) => b.label), pinnedMargin: PINNED_MARGIN, reports }, null, 2)}\n`)
    console.log(`wrote ${json}\n`)
  }
}

main()
