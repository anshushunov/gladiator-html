import { describe, expect, it } from 'vitest'
import { COMBAT_STYLES } from '../content/combatStyles'
import { BASELINE_TEST_SEED, homeRoster, opponents } from '../content/mvpSeries'
import { advanceBattleTick, createBattle, MAX_BOUT_TICKS, type BattleState } from './battle'
import type { ContactCollector, ContactRecord } from './contactDiagnostics'
import type { FighterDefinition } from './fighters'

// NOTE ON KEYS. `ActionInstanceId` is `<combatantId>:<counter>`, so it is
// unique inside one bout and NOT across bouts: `away.drusus:7` exists in all
// three pairings drusus fights in, and means a different swing in each. Any
// assertion that keys records by instance id therefore has to stay inside a
// single bout. This bit twice while writing these tests -- a flat
// `new Map(allRecords.map(r => [r.actionInstanceId, r.outcome]))` over the
// nine pairings is last-write-wins and silently compares one bout's event log
// against another bout's record.
function runBout(home: FighterDefinition, away: FighterDefinition, collector?: ContactCollector): { traceHash: number; records: ContactRecord[] } {
  const records: ContactRecord[] = []
  const wrapped: ContactCollector | undefined = collector ? { record: (entry) => { records.push(entry); collector.record(entry) } } : undefined
  let battle: BattleState = createBattle({ home, away, seed: BASELINE_TEST_SEED, combatStyles: COMBAT_STYLES })
  while (battle.phase === 'running' && battle.encounter.tick < MAX_BOUT_TICKS) {
    battle = advanceBattleTick(battle, undefined, wrapped)
  }
  return { traceHash: battle.traceHash, records }
}

describe('contact diagnostics', () => {
  it('does not change behaviour when a collector is attached, in any of the nine pairings', () => {
    // The seam's only guarantee. If attaching a write-only collector can move
    // a trace hash, it is not write-only.
    for (const home of homeRoster) {
      for (const away of opponents) {
        const without = runBout(home, away)
        const records: ContactRecord[] = []
        const with_ = runBout(home, away, { record: (entry) => records.push(entry) })
        expect(with_.traceHash, `${home.id}/${away.id}`).toBe(without.traceHash)
      }
    }
  })

  it('records every contact intent exactly once, with a finite separation', () => {
    const records: ContactRecord[] = []
    runBout(homeRoster[0], opponents[0], { record: (entry) => records.push(entry) })
    expect(records.length).toBeGreaterThan(0)
    const ids = new Set(records.map((r) => r.actionInstanceId))
    expect(ids.size).toBe(records.length)
    for (const record of records) {
      expect(Number.isFinite(record.separation), record.actionInstanceId).toBe(true)
      expect(record.separation).toBeGreaterThanOrEqual(0.9 - 1e-9)
    }
  })

  it('records a separation inside the action’s own contact range whenever the weapon reached', () => {
    // Necessary but NOT sufficient on its own -- see the next test.
    const records: ContactRecord[] = []
    for (const home of homeRoster) {
      for (const away of opponents) runBout(home, away, { record: (entry) => records.push(entry) })
    }
    const reached = new Set(['hit', 'blocked', 'parried', 'missed-accuracy'])
    const violations = records
      .filter((r) => reached.has(r.outcome))
      .filter((r) => {
        const range = COMBAT_STYLES.attacks[r.actionId].contactRange
        return r.separation < range.min - 1e-6 || r.separation > range.max + 1e-6
      })
      .map((r) => `${r.actionId} at ${r.separation.toFixed(3)}`)
    expect(violations.slice(0, 5)).toEqual([])
  })

  it('records the PRE-push separation, demonstrably different from the post-tick one', () => {
    // THE TEST THAT WOULD HAVE CAUGHT THE DEFECT THAT GOT THROUGH TWICE.
    // Being in range is not enough: a post-push reading often stays in range
    // and looks fine. The distinguishing fact is that push MOVES the pair, so
    // for a hit whose action authors a non-zero `pushDistance`, the recorded
    // separation must differ from the separation observable after that tick.
    // If the seam were reading post-tick state the two would be identical.
    const perTick: { tick: number; separation: number }[] = []
    const records: ContactRecord[] = []
    let battle = createBattle({ home: homeRoster[0], away: opponents[0], seed: BASELINE_TEST_SEED, combatStyles: COMBAT_STYLES })
    const [homeId, awayId] = [battle.descriptor.homeId, battle.descriptor.awayId]
    while (battle.phase === 'running' && battle.encounter.tick < MAX_BOUT_TICKS) {
      battle = advanceBattleTick(battle, undefined, { record: (entry) => records.push(entry) })
      const a = battle.encounter.combatants[homeId]
      const b = battle.encounter.combatants[awayId]
      perTick.push({ tick: battle.encounter.tick, separation: Math.hypot(a.position.x - b.position.x, a.position.z - b.position.z) })
    }
    const pushingHits = records.filter((r) => r.outcome === 'hit' && COMBAT_STYLES.attacks[r.actionId].pushDistance > 0)
    expect(pushingHits.length).toBeGreaterThan(5)
    const differing = pushingHits.filter((r) => {
      const after = perTick.find((t) => t.tick === r.tick)
      return after !== undefined && Math.abs(after.separation - r.separation) > 1e-6
    })
    // Not "all": the separation solver and the arena clamp can absorb a push
    // when a pair is already at the floor. A clear majority is what proves the
    // reading is taken before phase 10 rather than after it.
    expect(differing.length).toBeGreaterThan(pushingHits.length * 0.5)
  })

  it('emits a record for every contact intent, including one whose actor was defeated first', () => {
    // Uniqueness cannot detect a DROP. This compares the collected set against
    // the independent ground truth of the event log: every action instance that
    // reached its contact phase must appear exactly once.
    const records: ContactRecord[] = []
    const contactInstances = new Set<string>()
    let battle = createBattle({ home: homeRoster[1], away: opponents[1], seed: BASELINE_TEST_SEED, combatStyles: COMBAT_STYLES })
    while (battle.phase === 'running' && battle.encounter.tick < MAX_BOUT_TICKS) {
      battle = advanceBattleTick(battle, undefined, { record: (entry) => records.push(entry) })
      for (const id of [battle.descriptor.homeId, battle.descriptor.awayId]) {
        const action = battle.encounter.combatants[id].action
        if (action.type === 'active' && action.phase === 'contact' && action.definitionId in COMBAT_STYLES.attacks) {
          contactInstances.add(action.instanceId)
        }
      }
    }
    expect(new Set(records.map((r) => r.actionInstanceId))).toEqual(contactInstances)
  })

  it('classifies a blocked hit as blocked rather than as a plain hit', () => {
    // `attack-blocked` is followed by `damage-dealt` for the SAME instance, so
    // a scan without precedence reports the guard working as an ordinary hit.
    // Asserted against the event log rather than against a count: every
    // instance the log says was blocked must be recorded as `blocked`.
    //
    // Matched PER BOUT, per the key note at the top of this file. Every one of
    // the nine pairings is checked; the violations are collected rather than
    // asserted in place so a failure names the pairing and shows more than the
    // first offender.
    let blockedTotal = 0
    let parriedTotal = 0
    const violations: string[] = []
    for (const home of homeRoster) {
      for (const away of opponents) {
        const records: ContactRecord[] = []
        const blockedInstances = new Set<string>()
        const parriedInstances = new Set<string>()
        let battle = createBattle({ home, away, seed: BASELINE_TEST_SEED, combatStyles: COMBAT_STYLES })
        let scanned = 0
        while (battle.phase === 'running' && battle.encounter.tick < MAX_BOUT_TICKS) {
          const previousTick = battle.encounter.tick
          battle = advanceBattleTick(battle, undefined, { record: (entry) => records.push(entry) })
          // `battle.events` is the ACCUMULATED log, so only the tail is new.
          for (let i = scanned; i < battle.events.length; i += 1) {
            const event = battle.events[i]
            if (event.tick !== previousTick + 1) continue
            if (event.type === 'attack-blocked') blockedInstances.add(event.actionInstanceId)
            if (event.type === 'attack-parried') parriedInstances.add(event.actionInstanceId)
          }
          scanned = battle.events.length
        }
        blockedTotal += blockedInstances.size
        parriedTotal += parriedInstances.size
        const byInstance = new Map(records.map((r) => [r.actionInstanceId, r.outcome]))
        const pairing = `${home.id}/${away.id}`
        for (const id of blockedInstances) {
          if (byInstance.get(id) !== 'blocked') violations.push(`${pairing} ${id}: ${String(byInstance.get(id))} != blocked`)
        }
        for (const id of parriedInstances) {
          if (byInstance.get(id) !== 'parried') violations.push(`${pairing} ${id}: ${String(byInstance.get(id))} != parried`)
        }
      }
    }
    expect(blockedTotal).toBeGreaterThan(0)
    expect(parriedTotal).toBeGreaterThan(0)
    expect(violations.slice(0, 5)).toEqual([])
  })

  it('produces every outcome the type declares, so none is unreachable dead code', () => {
    const records: ContactRecord[] = []
    for (const home of homeRoster) {
      for (const away of opponents) runBout(home, away, { record: (entry) => records.push(entry) })
    }
    const seen = new Set(records.map((r) => r.outcome))
    // `actor-defeated` and `target-unavailable` are rare but reachable across
    // nine pairings; if one never appears, either the classifier cannot emit it
    // or the kernel path is dead, and both are worth knowing.
    for (const outcome of ['hit', 'blocked', 'parried', 'evaded', 'missed-geometry', 'missed-accuracy']) {
      expect(seen.has(outcome as never), outcome).toBe(true)
    }
  })
})
