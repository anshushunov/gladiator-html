// Two roster pairings, 200 seeds each, win rate only.
//
// `balance.test.ts`'s roster cohort is nine pairings and takes ~95 s. When a
// tuning question is about two of them, this runs those two in ~20 s so the
// sweep can have more cells instead of fewer. It asserts nothing; the bands
// live in the test, and a candidate that looks good here still has to clear
// the full suite.
//
// Usage:
//   node node_modules/vite-node/vite-node.mjs scripts/measure-pairings.ts
//   node node_modules/vite-node/vite-node.mjs scripts/measure-pairings.ts -- --seeds=200 --all

import { COMBAT_STYLES } from '../src/content/combatStyles'
import { BASELINE_TEST_SEED, homeRoster, opponents } from '../src/content/mvpSeries'
import { advanceBattleTick, createBattle, MAX_BOUT_TICKS } from '../src/simulation/battle'
import type { FighterDefinition } from '../src/simulation/fighters'

/** The two pairings the 2026-09-05 translation pushed outside the 15..85% band, plus the one that landed on its ceiling. */
const WATCHED: readonly (readonly [string, string])[] = [
  ['brutus', 'drusus'],
  ['aquila', 'magnus'],
  ['nerva', 'magnus'],
]

function winRate(home: FighterDefinition, away: FighterDefinition, seeds: number): { rate: number; medianTicks: number; timeouts: number } {
  let wins = 0
  let timeouts = 0
  const durations: number[] = []
  for (let index = 0; index < seeds; index += 1) {
    let battle = createBattle({ home, away, seed: BASELINE_TEST_SEED + index, combatStyles: COMBAT_STYLES })
    while (battle.phase === 'running' && battle.encounter.tick < MAX_BOUT_TICKS) battle = advanceBattleTick(battle)
    if (battle.winnerSide === 'home') wins += 1
    if (battle.finishReason === 'time-limit') timeouts += 1
    durations.push(battle.encounter.tick)
  }
  durations.sort((a, b) => a - b)
  return { rate: wins / seeds, medianTicks: durations[Math.floor((durations.length - 1) * 0.5)], timeouts }
}

const args = process.argv.slice(2)
const seeds = Number(/^--seeds=(\d+)$/.exec(args.find((a) => a.startsWith('--seeds=')) ?? '')?.[1] ?? 200)
const all = args.includes('--all')

const pairs: (readonly [string, string])[] = all
  ? homeRoster.flatMap((home) => opponents.map((away) => [home.id, away.id] as const))
  : [...WATCHED]

console.log(`\n${seeds} seeds per pairing, band 15..85%\n`)
for (const [homeId, awayId] of pairs) {
  const home = homeRoster.find((f) => f.id === homeId)
  const away = opponents.find((f) => f.id === awayId)
  if (!home || !away) throw new Error(`unknown pairing ${homeId}/${awayId}`)
  const { rate, medianTicks, timeouts } = winRate(home, away, seeds)
  const flag = rate < 0.15 || rate > 0.85 ? '  <-- OUTSIDE BAND' : ''
  console.log(`${`${homeId}/${awayId}`.padEnd(16)} ${(rate * 100).toFixed(1).padStart(5)}%   median ${String(medianTicks).padStart(4)}   timeouts ${timeouts}${flag}`)
}
console.log('')
