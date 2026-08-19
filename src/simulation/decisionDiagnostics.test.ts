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

  it('records skipped decisions with the specific reason that blocked them', () => {
    const records: DecisionRecord[] = []
    runBout({ record: (entry) => records.push(entry) })

    const skipped = records.filter((entry) => entry.kind === 'skipped')
    expect(skipped.length).toBeGreaterThan(0)
    const reasons = new Set(skipped.map((entry) => (entry.kind === 'skipped' ? entry.reason : undefined)))
    // A two-combatant duel never skips for 'inactive' (the encounter finishes
    // the same tick a fighter dies, so a dead combatant is never decided-for
    // again) or 'no-target' (each fighter acquires the other before its
    // first decision-ready tick, at these starting positions). Those two
    // reasons exist for the wider kernel -- a mass encounter can strand a
    // combatant with no hostile in range -- not for this duel adapter.
    expect(reasons).toEqual(new Set(['not-due', 'mid-action', 'staggered']))
  })

  it('records the deterministic fallback when no weighted candidate scores positive', () => {
    const records: DecisionRecord[] = []
    // aquila (fast) vs drusus (fast): unlike the home[0]/away[0] pairing
    // `runBout` exercises above, this mirror matchup runs its authored
    // candidate set dry at BASELINE_TEST_SEED, reaching the fallback path a
    // typical duel does not.
    let battle: BattleState = createBattle({
      home: homeRoster.find((f) => f.archetype === 'fast')!,
      away: opponents.find((f) => f.archetype === 'fast')!,
      seed: BASELINE_TEST_SEED,
      combatStyles: COMBAT_STYLES,
    })
    const collector = { record: (entry: DecisionRecord) => records.push(entry) }
    for (let tick = 0; battle.phase === 'running' && tick < 3600; tick += 1) {
      battle = advanceBattleTick(battle, collector)
    }

    const fallback = records.filter((entry) => entry.kind === 'fallback')
    expect(fallback.length).toBeGreaterThan(0)
    for (const entry of fallback) {
      if (entry.kind !== 'fallback') continue
      expect(['locomotion', 'action']).toContain(entry.chosen.type)
    }
  })

  it('does not let a collector mutating its record change the decision the kernel actually takes', () => {
    const without = runBout()
    // Reassigning `entry.chosen` to a brand-new object (`entry.chosen = {...}`)
    // only rebinds the record's own property -- it proves nothing about
    // aliasing, because it would leave an old `chosen: decision` alias
    // untouched too (the kernel's `decision` binding still points at the
    // original object either way). To actually distinguish "the collector
    // was handed the kernel's live object" from "the collector was handed a
    // copy," the mutation has to go *through* the reference: flip a field on
    // the object in place. Against the old aliasing code that changes what
    // `decision.locomotionIntent` reads as, and the kernel commits the
    // flipped intent -- shifting the trace hash. Against the fix
    // (`chosen: { ...decision }`), the collector's copy is a different
    // object, so this mutation lands on nothing the kernel ever reads.
    const withMutatingCollector = runBout({
      record: (entry) => {
        if ((entry.kind === 'weighted' || entry.kind === 'fallback') && entry.chosen.type === 'locomotion') {
          entry.chosen.locomotionIntent = entry.chosen.locomotionIntent === 'advance' ? 'retreat' : 'advance'
        }
      },
    })

    expect(withMutatingCollector.traceHash).toBe(without.traceHash)
    expect(withMutatingCollector.ticks).toBe(without.ticks)
  })
})
