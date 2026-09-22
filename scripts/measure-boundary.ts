// Where the fighters stand RELATIVE TO THE ARENA WALL, every tick, and how
// much of their backing away is issued when there is no room left behind them.
//
// The 2026-09-20 playtest's Finding 1 -- "the retiarius fights with his back to
// the wall" -- was measured once, by hand, and the code was thrown away. It is
// the axis this slice changes, so it needs a standing instrument: `measure-
// distance.ts` samples the separation BETWEEN the fighters and cannot see the
// arena at all, and `contactDiagnostics.ts` samples only contact ticks.
//
// Two columns, because the finding needs both. The first says where he stands.
// The second says whether his own decisions are doing anything: a backing
// intent issued while already at the wall executes into the clamp and buys
// nothing, and the report measured half to two thirds of his backing that way.
//
// Recording only. Nothing here asserts a threshold; the acceptance bands live
// in `src/simulation/*.test.ts`.
//
// Usage:
//   node node_modules/vite-node/vite-node.mjs scripts/measure-boundary.ts
//   node node_modules/vite-node/vite-node.mjs scripts/measure-boundary.ts -- --seeds=20 --json=docs/superpowers/plans/2026-09-20-boundary-before.json

import { writeFileSync } from 'node:fs'
import { BASELINE_TEST_SEED, homeRoster, opponents } from '../src/content/mvpSeries'
import { COMBAT_STYLES } from '../src/content/combatStyles'
import { advanceBattleTick, createBattle, MAX_BOUT_TICKS } from '../src/simulation/battle'
import { arenaBoundaryMargin } from '../src/simulation/combatDecision'
import type { FighterDefinition } from '../src/simulation/fighters'
import type { LocomotionIntent } from '../src/simulation/movement'

/**
 * "At the edge" is within this much of either boundary. 0.35 verbatim from the
 * playtest report, so a post-change run is directly comparable to the table
 * printed there. It is a little over one tick of the fastest backward walk
 * (Fast retreats 2.7 u/s = 0.045 u/tick), i.e. "close enough that backing away
 * is about to stop working".
 */
const EDGE_MARGIN = 0.35

/**
 * "Backing" is a `backstep` or `disengage` intent -- the report's definition
 * verbatim (docs/reviews/2026-09-20-presentation-slice-playtest.md:143), so
 * this column reproduces the table printed there. `retreat` is not counted.
 */
const BACKING_INTENTS: ReadonlySet<LocomotionIntent> = new Set(['backstep', 'disengage'])

interface SideSample {
  fighterId: string
  archetype: string
  edgeTicks: number
  backingTicks: number
  backingAtEdgeTicks: number
  totalTicks: number
}

interface PairingSample {
  label: string
  home: SideSample
  away: SideSample
}

function emptySide(fighter: FighterDefinition): SideSample {
  return { fighterId: fighter.id, archetype: fighter.archetype, edgeTicks: 0, backingTicks: 0, backingAtEdgeTicks: 0, totalTicks: 0 }
}

function samplePairing(home: FighterDefinition, away: FighterDefinition, seedCount: number): PairingSample {
  const sample: PairingSample = {
    label: `${home.id} (${home.archetype}) vs ${away.id} (${away.archetype})`,
    home: emptySide(home),
    away: emptySide(away),
  }

  for (let index = 0; index < seedCount; index += 1) {
    let battle = createBattle({ home, away, seed: BASELINE_TEST_SEED + index, combatStyles: COMBAT_STYLES })
    const sides = [
      { id: battle.descriptor.homeId, into: sample.home },
      { id: battle.descriptor.awayId, into: sample.away },
    ]

    while (battle.phase === 'running' && battle.encounter.tick < MAX_BOUT_TICKS) {
      battle = advanceBattleTick(battle)
      const arena = battle.encounter.arena
      for (const side of sides) {
        const combatant = battle.encounter.combatants[side.id]
        if (combatant.status !== 'active') continue
        const atEdge = arenaBoundaryMargin(arena, combatant.position) < EDGE_MARGIN
        const backing = BACKING_INTENTS.has(combatant.locomotionIntent)
        side.into.totalTicks += 1
        if (atEdge) side.into.edgeTicks += 1
        if (backing) side.into.backingTicks += 1
        if (backing && atEdge) side.into.backingAtEdgeTicks += 1
      }
    }
  }

  return sample
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
const share = (numerator: number, denominator: number) => (denominator === 0 ? 0 : numerator / denominator)

function main(): void {
  const { seeds, json } = parseArgs(process.argv.slice(2))
  const samples: PairingSample[] = []
  for (const home of homeRoster) {
    for (const away of opponents) {
      samples.push(samplePairing(home, away, seeds))
    }
  }

  const rows: string[][] = [['pairing', 'side', 'who', 'at edge', 'backing', 'backing AT edge']]
  for (const pairing of samples) {
    for (const [label, side] of [['home', pairing.home], ['away', pairing.away]] as const) {
      rows.push([
        pairing.label,
        label,
        `${side.fighterId} (${side.archetype})`,
        pct(share(side.edgeTicks, side.totalTicks)),
        pct(share(side.backingTicks, side.totalTicks)),
        pct(share(side.backingAtEdgeTicks, side.backingTicks)),
      ])
    }
  }

  console.log(`\ntime at the arena wall -- ${seeds} seeds per pairing, every tick of every bout, edge margin ${EDGE_MARGIN}\n`)
  console.log(table(rows))

  // The headline the finding is actually about, restated so a reader does not
  // have to pick it out of eighteen rows. Each SIDE is one observation.
  const byArchetype = (archetype: string, pick: (side: SideSample) => number): number[] =>
    samples.flatMap((pairing) => [pairing.home, pairing.away].filter((side) => side.archetype === archetype).map(pick))
  const mean = (values: readonly number[]): number => values.reduce((sum, value) => sum + value, 0) / (values.length || 1)

  for (const archetype of ['fast', 'technical', 'heavy']) {
    const edge = byArchetype(archetype, (side) => share(side.edgeTicks, side.totalTicks))
    const wasted = byArchetype(archetype, (side) => share(side.backingAtEdgeTicks, side.backingTicks))
    console.log(`\n${archetype}: at the edge ${pct(mean(edge))}, backing issued at the edge ${pct(mean(wasted))} (${edge.length} observations)`)
  }
  console.log('')

  if (json) {
    writeFileSync(json, `${JSON.stringify({ seeds, edgeMargin: EDGE_MARGIN, samples }, null, 2)}\n`)
    console.log(`wrote ${json}\n`)
  }
}

main()
