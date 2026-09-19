// What is alive on screen at each key-pose capture tick?
//
// The four key-pose captures in `tests/combat-visuals.spec.ts` carry a comment
// naming every effect inside `advanceToCaptureTick`'s 60-tick window, because
// the feedback slice made the frames contain effects at all and a baseline
// nobody can predict is a baseline nobody can review. The fighting-room slice
// then re-cut the bouts those ticks index into, so both halves of each comment
// -- the pose condition and the effect list -- have to be re-read on the merged
// tree. This prints both: each capture's two fighters with their action phase
// and separation, then every contact, block, parry, evade and miss inside the
// window with its age against the effect's own life.
//
// It exists because this is not a one-off: every slice that touches
// `src/simulation/**` or `src/content/**` re-cuts these bouts and invalidates
// the same eight numbers, and re-deriving them by reading a failing diff is how
// a comment ends up describing a frame nobody checked.
//
// Lifetimes are `FLASH_DURATION_MS` / the damage number's own, in ticks at
// 60 Hz: body spray 25.2, shield and weapon spark 15.6, miss puff 13.2,
// damage number 54.
//
// Run: node node_modules/vite-node/vite-node.mjs scripts/probe-capture-ticks.ts

import { COMBAT_STYLES } from '../src/content/combatStyles'
import { MAX_BOUT_TICKS } from '../src/simulation/battle'
import { SEASON_CHALLENGES, SEASON_ROSTER } from '../src/content/season'
import { advanceSeriesTicks, startNextBout } from '../src/simulation/series'
import { assignFighter, confirmLineup, createSeason, startNextSeries } from '../src/simulation/season'

const SEED = 20260815
const WINDOW = 60

const LIFETIME_TICKS: Record<string, number> = {
  body: 25.2,
  shield: 15.6,
  weapon: 15.6,
  miss: 13.2,
  number: 54,
}

interface Capture {
  name: string
  lineup: readonly [string, string, string]
  bout: 0 | 1
  tick: number
}

const CAPTURES: readonly Capture[] = [
  { name: 'heavy-cleave.png', lineup: ['brutus', 'aquila', 'nerva'], bout: 0, tick: 420 },
  { name: 'fast-burst.png', lineup: ['brutus', 'aquila', 'nerva'], bout: 0, tick: 246 },
  { name: 'technical-parry.png', lineup: ['brutus', 'nerva', 'aquila'], bout: 1, tick: 797 },
  { name: 'combat-outcomes.png', lineup: ['brutus', 'aquila', 'nerva'], bout: 0, tick: 3480 },
]

function openSeries(lineup: readonly [string, string, string]) {
  let season = createSeason({ roster: SEASON_ROSTER, challenges: SEASON_CHALLENGES, combatStyles: COMBAT_STYLES, seed: SEED })
  season = startNextSeries(season).state
  lineup.forEach((fighterId, slot) => { season = assignFighter(season, fighterId, slot).state })
  season = confirmLineup(season).state
  return season.activeSeries!
}

function run(capture: Capture): void {
  let series = openSeries(capture.lineup)
  // Bout 1 captures: play bout 0 out and open bout 1 explicitly, exactly as
  // `startBoutOneWith` does in the browser. `advanceSeriesTicks` does not walk
  // across the boundary on its own -- the series parks in `between-bouts`.
  if (capture.bout === 1) {
    series = advanceSeriesTicks(series, MAX_BOUT_TICKS + 1)
    const opened = startNextBout(series)
    if (!opened.ok) throw new Error(`could not open bout 1: phase ${series.phase}`)
    series = opened.state
  }
  // Bout 1 captures need bout 0 played out first; `advanceSeriesTicks` carries
  // the series across the boundary on its own, so the tick axis below is the
  // ACTIVE BATTLE's tick, exactly as `advanceTicks` in the browser means it.
  const collected: { tick: number; line: string }[] = []
  let boutsSeen = capture.bout
  let seenEvents = 0
  let guard = 0

  while (series.phase !== 'complete' && guard < 60000) {
    guard += 1
    const before = series.activeBattle
    if (before === null || before === undefined) {
      series = advanceSeriesTicks(series, 1)
      continue
    }
    const boutIndex = boutsSeen
    series = advanceSeriesTicks(series, 1)
    const after = series.activeBattle
    if (after === null || after === undefined || after.descriptor !== before.descriptor) {
      console.log(`  [bout ${boutIndex} ended at tick ${before.encounter.tick}]`)
      boutsSeen += 1
      seenEvents = 0
      if (boutsSeen > capture.bout) break
      continue
    }

    const tick = after.encounter.tick
    for (const event of after.events.slice(seenEvents)) {
      const type = (event as { type: string }).type
      const zone = (event as { contactZone?: string }).contactZone
      const reason = (event as { reason?: string }).reason
      const actionId = (event as { actionId?: string }).actionId
      const amount = (event as { amount?: number }).amount
      if (!['damage-dealt', 'attack-blocked', 'attack-parried', 'attack-evaded', 'attack-missed'].includes(type)) continue
      collected.push({
        tick,
        line: `${type}${zone ? ` ${zone}` : ''}${reason ? ` (${reason})` : ''}${actionId ? ` ${actionId}` : ''}${amount === undefined ? '' : ` amount ${amount}`}`,
      })
    }
    seenEvents = after.events.length

    if (tick === capture.tick) {
      const combatants = after.encounter.combatants
      console.log(`\n=== ${capture.name}: bout ${capture.bout}, tick ${capture.tick}`)
      for (const id of Object.keys(combatants)) {
        const c = combatants[id] as { action?: { actionId: string; phase: string; startedTick?: number } }
        console.log(`  ${id}: ${c.action ? `${c.action.actionId} ${c.action.phase}` : 'no action'}`)
      }
      const ids = Object.keys(combatants)
      const a = combatants[ids[0]].position
      const b = combatants[ids[1]].position
      console.log(`  separation ${Math.hypot(a.x - b.x, a.z - b.z).toFixed(2)}`)
      console.log(`  events in (${capture.tick - WINDOW}, ${capture.tick}]:`)
      const inWindow = collected.filter((e) => e.tick > capture.tick - WINDOW && e.tick <= capture.tick)
      if (inWindow.length === 0) console.log('    none')
      for (const event of inWindow) {
        const age = capture.tick - event.tick
        const kind = event.line.startsWith('damage-dealt')
          ? (event.line.includes('shield') ? 'shield' : event.line.includes('weapon') ? 'weapon' : 'body')
          : event.line.startsWith('attack-blocked') ? 'shield'
            : event.line.startsWith('attack-parried') ? 'weapon'
              : 'miss'
        const flashLife = LIFETIME_TICKS[kind]
        const numberLife = event.line.startsWith('damage-dealt') ? ` number ${age <= LIFETIME_TICKS.number ? 'ALIVE' : 'dead'} (${age} vs 54)` : ''
        console.log(`    t=${event.tick} age ${age}  ${event.line}  flash ${kind} ${age <= flashLife ? 'ALIVE' : 'dead'} (${age} vs ${flashLife})${numberLife}`)
      }
      return
    }
  }
  console.log(`\n=== ${capture.name}: tick ${capture.tick} NOT REACHED in bout ${capture.bout}`)
}

for (const capture of CAPTURES) run(capture)
