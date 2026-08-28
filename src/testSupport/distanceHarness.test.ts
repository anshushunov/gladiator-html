import { describe, expect, it } from 'vitest'
import { COMBAT_STYLES } from '../content/combatStyles'
import { BASELINE_TEST_SEED } from '../content/mvpSeries'
import {
  accumulate,
  classifySeparation,
  distanceBands,
  emptyAccumulator,
  hasEngaged,
  isInsideMurmilloEnvelope,
  summarise,
} from './distanceHarness'
import { applyOverlay } from './reachHarness'
import { percentile } from './balanceCohorts'
import { advanceBattleTick, createBattle, MAX_BOUT_TICKS } from '../simulation/battle'
import type { CombatStyleCatalog } from '../simulation/combatActions'
import type { FighterDefinition } from '../simulation/fighters'

const catalog = () => structuredClone(COMBAT_STYLES) as unknown as CombatStyleCatalog

const fighter = (id: string, archetype: FighterDefinition['archetype']): FighterDefinition => ({
  id, name: id, school: 'Style Cohort', archetype, maxHp: 160, power: 20, accuracy: 0.88, defenseChance: 0.35, criticalChance: 0.12,
})

describe('distance harness bands', () => {
  it('reads every edge from the catalog rather than from a literal', () => {
    // The defect this guards is the one `measure-reach.ts` already carries a
    // scar for: a yardstick read from the unpatched global judges a candidate
    // that moved the murmillo against the murmillo it replaced.
    const bands = distanceBands(catalog())
    expect(bands.pinFloor).toBe(COMBAT_STYLES.attacks['fast-burst-lunge'].contactRange.min)
    expect(bands.lungeCeiling).toBe(COMBAT_STYLES.attacks['fast-burst-lunge'].contactRange.max)
    expect(bands.murmilloEnvelope).toBe(COMBAT_STYLES.styles.heavy.preferredRange.max)
  })

  it('follows an overlay that moves the murmillo, not the shipped content', () => {
    const patched = applyOverlay(catalog(), { styles: { heavy: { preferredRange: { max: 2.6 } } } })
    const bands = distanceBands(patched)
    expect(bands.murmilloEnvelope).toBe(2.6)
    expect(COMBAT_STYLES.styles.heavy.preferredRange.max).toBe(1.7) // the global is untouched
  })

  it('follows an overlay that moves the retiarius floor, which is the whole pin statistic', () => {
    const patched = applyOverlay(catalog(), { attacks: { 'fast-burst-lunge': { contactRange: { min: 1.2 } } } })
    expect(distanceBands(patched).pinFloor).toBe(1.2)
    // and the ceiling survives the partial patch -- `deepMerge`, not `Object.assign`
    expect(distanceBands(patched).lungeCeiling).toBe(COMBAT_STYLES.attacks['fast-burst-lunge'].contactRange.max)
  })
})

describe('distance harness classification', () => {
  const bands = { pinFloor: 1.6, lungeCeiling: 2.4, murmilloEnvelope: 1.7 } as const

  it('partitions the line exactly once at every edge', () => {
    // Half-open upward. A tick classified `lunge-band` must be one on which the
    // lunge would have been legal on range, and `legalActionCandidates` reads
    // `contactRange` inclusively at both ends -- so both edges belong to the
    // band, not to its neighbours. An off-by-one here moves the headline share
    // silently, which is why each edge is asserted rather than sampled.
    expect(classifySeparation(1.5999999, bands)).toBe('pinned')
    expect(classifySeparation(1.6, bands)).toBe('lunge-band')
    expect(classifySeparation(2.4, bands)).toBe('lunge-band')
    expect(classifySeparation(2.4000001, bands)).toBe('beyond')
    expect(classifySeparation(0, bands)).toBe('pinned')
    expect(classifySeparation(99, bands)).toBe('beyond')
  })

  it('treats the murmillo envelope as an overlapping share, not a fourth band', () => {
    // 1.65 is simultaneously "the retiarius may legally lunge" and "the murmillo
    // is at home". Folding the two edges into one partition would hide exactly
    // that sliver, and the matchup is fought in it.
    expect(classifySeparation(1.65, bands)).toBe('lunge-band')
    expect(isInsideMurmilloEnvelope(1.65, bands)).toBe(true)
    expect(isInsideMurmilloEnvelope(1.7, bands)).toBe(true) // inclusive, matching `preferredRangeState`
    expect(isInsideMurmilloEnvelope(1.7000001, bands)).toBe(false)
  })

  it('keeps the three band shares summing to one while the envelope share overlaps them', () => {
    const acc = emptyAccumulator()
    for (const separation of [0.9, 1.5, 1.65, 2.0, 2.4, 3.0, 5.0]) accumulate(acc, separation, bands)
    const summary = summarise(acc, percentile)
    if (!summary) throw new Error('expected a summary')
    expect(summary.pinnedShare + summary.lungeBandShare + summary.beyondShare).toBeCloseTo(1, 12)
    // 0.9, 1.5 and 1.65 are inside the envelope; only the first two are pinned.
    expect(summary.pinnedShare).toBeCloseTo(2 / 7, 12)
    expect(summary.insideEnvelopeShare).toBeCloseTo(3 / 7, 12)
  })

  it('reports nothing rather than NaN for a matchup that produced no ticks', () => {
    expect(summarise(emptyAccumulator(), percentile)).toBeUndefined()
  })
})

describe('distance harness engagement window', () => {
  it('agrees with balanceCohorts about when a bout stops approaching', () => {
    // `runBout` finds `firstResolutionTick` with `max(lastResolutionTick) > 0`.
    // A second definition of when a fight begins would give two incomparable
    // pictures of one bout, and this slice exists because two instruments
    // already disagreed about where one was fought. So the tick this harness
    // latches on is asserted to be the same tick `runBout` would record.
    let battle = createBattle({ home: fighter('home', 'fast'), away: fighter('away', 'heavy'), seed: BASELINE_TEST_SEED, combatStyles: catalog() })
    const ids = [battle.descriptor.homeId, battle.descriptor.awayId]

    let harnessLatchedAt = -1
    let runBoutFirstResolution = -1
    while (battle.phase === 'running' && battle.encounter.tick < MAX_BOUT_TICKS) {
      battle = advanceBattleTick(battle)
      const lastResolution = Math.max(...ids.map((id) => battle.encounter.combatants[id].lastResolutionTick))
      if (lastResolution > 0 && runBoutFirstResolution < 0) runBoutFirstResolution = battle.encounter.tick
      if (hasEngaged(battle.encounter.combatants, ids) && harnessLatchedAt < 0) harnessLatchedAt = battle.encounter.tick
    }

    expect(runBoutFirstResolution).toBeGreaterThan(0)
    expect(harnessLatchedAt).toBe(runBoutFirstResolution)
  })

  it('latches rather than flickering, so the engaged window is a suffix of the bout', () => {
    // `lastResolutionTick` never returns to 0, so a window that opened can never
    // close. If it could, the shares would depend on where the samples happened
    // to fall rather than on the fight.
    let battle = createBattle({ home: fighter('home', 'fast'), away: fighter('away', 'heavy'), seed: BASELINE_TEST_SEED, combatStyles: catalog() })
    const ids = [battle.descriptor.homeId, battle.descriptor.awayId]
    let seenEngaged = false
    while (battle.phase === 'running' && battle.encounter.tick < MAX_BOUT_TICKS) {
      battle = advanceBattleTick(battle)
      const engaged = hasEngaged(battle.encounter.combatants, ids)
      if (engaged) seenEngaged = true
      expect(engaged || !seenEngaged).toBe(true)
    }
    expect(seenEngaged).toBe(true)
  })

  it('reports a bout that never engaged rather than counting it as engaged at zero ticks', () => {
    const acc = emptyAccumulator()
    acc.bouts = 1
    acc.unengagedBouts = 1
    expect(summarise(acc, percentile)).toBeUndefined()
  })
})
