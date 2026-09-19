// Root separation at the ticks an attack CONTACTS, per action.
//
// This is the measurement the spear's reach gate is targeted against. The
// Blender build script's `REACH_WINDOWS` are not a property of the clips: they
// mirror the simulation's contact distribution, and its own comment says that
// when `contactRange` or `DUEL_MINIMUM_SEPARATION` moves, these medians move
// with it and the windows must be re-measured in the same change -- otherwise
// the authored tips drift short again while the gate keeps passing.
//
// The 2026-09-17 kit spec's §3 table was produced this way before the
// fighting-room slice translated every separation outward by 0.30. This script
// is that table, re-runnable, so the number quoted beside `REACH_WINDOWS` is
// always a measurement of the axis that ships.
//
// Separation is read on the state BEFORE the resolving tick, which is where the
// attacker stood when the blow was thrown -- the tick that emits the event has
// already moved both fighters.
//
// Recording only; nothing here asserts a threshold.
//
// Usage:
//   node node_modules/vite-node/vite-node.mjs scripts/measure-contact-separation.ts
//   node node_modules/vite-node/vite-node.mjs scripts/measure-contact-separation.ts -- --seeds=20

import { COMBAT_STYLES } from '../src/content/combatStyles'
import { BASELINE_TEST_SEED, homeRoster, opponents } from '../src/content/mvpSeries'
import { advanceBattleTick, createBattle, MAX_BOUT_TICKS } from '../src/simulation/battle'

/**
 * The five outcomes that mean "the blow reached its decision point": a landed
 * hit, a shield block, a weapon parry, an evade, and an accuracy miss. The
 * other two `attack-missed` reasons are excluded on purpose -- `geometry` and
 * `target-unavailable` mean the attack never contacted anything, so their
 * separations describe a whiff, not a reach.
 */
const CONTACT_TYPES = new Set(['damage-dealt', 'attack-blocked', 'attack-parried', 'attack-evaded'])

function isContact(event: { type: string; reason?: string }): boolean {
  if (CONTACT_TYPES.has(event.type)) return true
  return event.type === 'attack-missed' && event.reason === 'accuracy'
}

function percentile(sorted: readonly number[], fraction: number): number {
  if (sorted.length === 0) return Number.NaN
  const index = Math.min(sorted.length - 1, Math.max(0, Math.round(fraction * (sorted.length - 1))))
  return sorted[index]
}

function parseSeeds(argv: readonly string[]): number {
  for (const arg of argv) {
    const match = /^--seeds=(\d+)$/.exec(arg)
    if (match) return Number(match[1])
  }
  return 20
}

function main(): void {
  const seeds = parseSeeds(process.argv.slice(2))
  const byAction = new Map<string, number[]>()
  let minimumSeparation = 0

  for (const home of homeRoster) {
    for (const away of opponents) {
      for (let index = 0; index < seeds; index += 1) {
        let battle = createBattle({ home, away, seed: BASELINE_TEST_SEED + index, combatStyles: COMBAT_STYLES })
        const homeId = battle.descriptor.homeId
        const awayId = battle.descriptor.awayId
        minimumSeparation = battle.encounter.arena.minimumSeparation

        while (battle.phase === 'running' && battle.encounter.tick < MAX_BOUT_TICKS) {
          const before = battle.encounter.combatants
          const dx = before[homeId].position.x - before[awayId].position.x
          const dz = before[homeId].position.z - before[awayId].position.z
          const separation = Math.sqrt(dx * dx + dz * dz)
          const seen = battle.events.length

          battle = advanceBattleTick(battle)

          for (const event of battle.events.slice(seen)) {
            if (!isContact(event as { type: string; reason?: string })) continue
            const actionId = (event as { actionId?: string }).actionId
            if (actionId === undefined) continue
            const samples = byAction.get(actionId)
            if (samples === undefined) byAction.set(actionId, [separation])
            else samples.push(separation)
          }
        }
      }
    }
  }

  console.log(
    `\nroot separation at contact -- ${homeRoster.length * opponents.length} pairings x ${seeds} seeds, ` +
      `arena minimumSeparation ${minimumSeparation.toFixed(2)}\n`,
  )
  const header = ['action', 'n', 'p10', 'p25', 'median', 'p75', 'p90', 'contactRange']
  console.log(header.join('\t'))
  for (const [actionId, samples] of [...byAction.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
    const sorted = [...samples].sort((a, b) => a - b)
    const range = COMBAT_STYLES.attacks[actionId as keyof typeof COMBAT_STYLES.attacks]?.contactRange
    console.log(
      [
        actionId,
        sorted.length,
        percentile(sorted, 0.1).toFixed(2),
        percentile(sorted, 0.25).toFixed(2),
        percentile(sorted, 0.5).toFixed(2),
        percentile(sorted, 0.75).toFixed(2),
        percentile(sorted, 0.9).toFixed(2),
        range === undefined ? '-' : `${range.min}-${range.max}`,
      ].join('\t'),
    )
  }
  console.log('')
}

main()
