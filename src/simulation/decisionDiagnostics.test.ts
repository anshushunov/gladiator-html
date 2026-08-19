import { describe, expect, it } from 'vitest'
import { COMBAT_STYLES } from '../content/combatStyles'
import { BASELINE_TEST_SEED, homeRoster, opponents } from '../content/mvpSeries'
import { advanceBattleTick, createBattle, type BattleState } from './battle'
import type { DecisionCollector, DecisionRecord } from './decisionDiagnostics'

// The collector is passed per call, never stored on `BattleState`: anything
// living in that object risks being folded into the trace hash.
function runBout(collector?: DecisionCollector): { traceHash: number; ticks: number } {
  let battle: BattleState = createBattle({
    home: homeRoster[0],
    away: opponents[0],
    seed: BASELINE_TEST_SEED,
    combatStyles: COMBAT_STYLES,
  })
  let ticks = 0
  while (battle.phase === 'running' && ticks < 3600) {
    battle = advanceBattleTick(battle, collector)
    ticks += 1
  }
  return { traceHash: battle.traceHash, ticks }
}

describe('decision diagnostics', () => {
  it('does not change behaviour when a collector is attached', () => {
    const without = runBout()
    const records: DecisionRecord[] = []
    const withCollector = runBout({ record: (entry) => records.push(entry) })

    expect(withCollector.traceHash).toBe(without.traceHash)
    expect(withCollector.ticks).toBe(without.ticks)
    expect(records.length).toBeGreaterThan(0)
  })

  it('records every weighted decision with its candidates, roll and winner', () => {
    const records: DecisionRecord[] = []
    runBout({ record: (entry) => records.push(entry) })

    const weighted = records.filter((entry) => entry.kind === 'weighted')
    expect(weighted.length).toBeGreaterThan(0)
    for (const entry of weighted) {
      if (entry.kind !== 'weighted') continue
      expect(entry.candidates.length).toBeGreaterThan(0)
      expect(entry.roll).toBeGreaterThanOrEqual(0)
      expect(entry.roll).toBeLessThan(1)
      expect(entry.candidates.some((candidate) => candidate.weight > 0)).toBe(true)
    }
  })

  it('records forced behaviours separately, with no roll', () => {
    const records: DecisionRecord[] = []
    // fast vs heavy exercises Fast's forced disengage heavily.
    let battle: BattleState = createBattle({
      home: homeRoster.find((f) => f.archetype === 'fast')!,
      away: opponents.find((f) => f.archetype === 'heavy')!,
      seed: BASELINE_TEST_SEED,
      combatStyles: COMBAT_STYLES,
    })
    const collector = { record: (entry: DecisionRecord) => records.push(entry) }
    for (let tick = 0; battle.phase === 'running' && tick < 3600; tick += 1) {
      battle = advanceBattleTick(battle, collector)
    }

    expect(records.some((entry) => entry.kind === 'forced')).toBe(true)
  })
})
