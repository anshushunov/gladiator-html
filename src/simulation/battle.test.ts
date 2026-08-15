import { describe, expect, it } from 'vitest'
import { advanceBattleTick, advanceBattleTicks, calculateDamage, createBattle, MAX_BOUT_TICKS, type BattleConfig } from './battle'
import type { FighterDefinition } from './fighters'
import { nextRandom } from './random'

const heavy: FighterDefinition = { id: 'heavy', name: 'Heavy', school: 'Test', archetype: 'heavy', maxHp: 100, damage: 10, attackIntervalTicks: 30, accuracy: 1, blockChance: 0, criticalChance: 0 }
const fast: FighterDefinition = { id: 'fast', name: 'Fast', school: 'Test', archetype: 'fast', maxHp: 100, damage: 10, attackIntervalTicks: 30, accuracy: 1, blockChance: 0, criticalChance: 0 }
const finished = (config: BattleConfig) => advanceBattleTicks(createBattle(config), MAX_BOUT_TICKS)

describe('battle simulation', () => {
  it('uses ticks and structured opening events', () => {
    const state = createBattle({ home: heavy, away: fast, seed: 7 })
    expect(state.tick).toBe(0)
    expect(state.comparison).toBe('advantage')
    expect(state.events[0]).toMatchObject({ id: 0, tick: 0, type: 'bout-started', homeFighterId: 'heavy', awayFighterId: 'fast' })
    expect(state.events).toHaveLength(1)
  })

  it('applies ordered comparison damage and a one-point minimum', () => {
    expect(calculateDamage({ baseDamage: 10, comparison: 'disadvantage', blocked: false, critical: false })).toBe(8)
    expect(calculateDamage({ baseDamage: 10, comparison: 'neutral', blocked: false, critical: false })).toBe(10)
    expect(calculateDamage({ baseDamage: 10, comparison: 'advantage', blocked: false, critical: false })).toBe(13)
    expect(calculateDamage({ baseDamage: 2, comparison: 'disadvantage', blocked: true, critical: false })).toBe(1)
  })

  it('is reproducible and always selects one winner', () => {
    const config = { home: heavy, away: fast, seed: 99 }
    const first = advanceBattleTicks(createBattle(config), MAX_BOUT_TICKS)
    const second = advanceBattleTicks(createBattle(config), MAX_BOUT_TICKS)
    expect(first).toEqual(second)
    expect(first.phase).toBe('finished')
    expect(['home', 'away']).toContain(first.winnerSide)
  })

  it('finishes every archetype pairing across 200 seeds', () => {
    const archetypes = ['heavy', 'fast', 'technical'] as const
    for (const homeArchetype of archetypes) {
      for (const awayArchetype of archetypes) {
        for (let seed = 1; seed <= 200; seed += 1) {
          const home = { ...heavy, id: `home-${homeArchetype}`, archetype: homeArchetype }
          const away = { ...fast, id: `away-${awayArchetype}`, archetype: awayArchetype }
          const state = advanceBattleTicks(createBattle({ home, away, seed }), MAX_BOUT_TICKS)
          expect(state.phase).toBe('finished')
          expect(['home', 'away']).toContain(state.winnerSide)
          expect(state.tick).toBeLessThanOrEqual(MAX_BOUT_TICKS)
        }
      }
    }
  })

  it('does not let a defeated fighter answer on the same tick', () => {
    const lethal = { ...heavy, damage: 500, attackIntervalTicks: 1 }
    const state = advanceBattleTicks(createBattle({ home: lethal, away: { ...fast, damage: 500, attackIntervalTicks: 1 }, seed: 3 }), MAX_BOUT_TICKS)
    const defeatIndex = state.events.findIndex(({ type }) => type === 'fighter-defeated')
    const sameTick = state.events[defeatIndex].tick
    expect(state.events.slice(defeatIndex + 1).filter((event) => event.tick === sameTick && event.type === 'attack-started')).toEqual([])
  })

  it('emits a finish reason and canonical terminal event', () => {
    const state = finished({ home: heavy, away: fast, seed: 11 })
    expect(state.events.at(-1)).toMatchObject({ type: 'bout-finished', winnerSide: state.winnerSide, reason: state.finishReason, durationTicks: state.tick })
  })

  it('advances the actor stream by exactly three values on attack', () => {
    let state = createBattle({ home: heavy, away: { ...fast, attackIntervalTicks: 60 }, seed: 13 })
    let before = state
    while (!state.events.some(({ type }) => type === 'attack-started')) {
      before = state
      state = advanceBattleTick(state)
    }
    const actor = state.events.find(({ type }) => type === 'attack-started')
    if (!actor || actor.type !== 'attack-started') throw new Error('Expected an attack')
    let expected = before.random[actor.actorSide]
    for (let index = 0; index < 3; index += 1) expected = nextRandom(expected)[1]
    expect(state.random[actor.actorSide]).toEqual(expected)
  })

  it('schedules the faster fighter to make the first attack after contact', () => {
    let state = createBattle({ home: { ...heavy, attackIntervalTicks: 20 }, away: { ...fast, attackIntervalTicks: 60 }, seed: 17 })
    while (!state.events.some(({ type }) => type === 'attack-started')) state = advanceBattleTick(state)
    expect(state.events.find(({ type }) => type === 'attack-started')).toMatchObject({ actorSide: 'home' })
    expect(state.events.filter(({ type }) => type === 'attack-started')).toHaveLength(1)
  })

  it('does not shift the away stream when only home attacks', () => {
    let state = createBattle({ home: { ...heavy, attackIntervalTicks: 20 }, away: { ...fast, attackIntervalTicks: 60 }, seed: 23 })
    while (!state.events.some(({ type }) => type === 'attack-started')) {
      const previousAway = state.random.away
      state = advanceBattleTick(state)
      if (state.events.some(({ type }) => type === 'attack-started')) expect(state.random.away).toBe(previousAway)
    }
  })

  it('consumes the separate tie stream for equal-interval initiative', () => {
    let state = createBattle({ home: { ...heavy, accuracy: 0 }, away: { ...fast, accuracy: 0 }, seed: 29 })
    let before = state
    while (!state.events.some(({ type }) => type === 'attack-started')) {
      before = state
      state = advanceBattleTick(state)
    }
    expect(state.initiativeTieRandom).toEqual(nextRandom(before.initiativeTieRandom)[1])
  })

  it.each([
    [{ ...heavy, accuracy: 0 }, { ...fast, blockChance: 0 }, ['attack-started', 'attack-missed']],
    [{ ...heavy, accuracy: 1 }, { ...fast, blockChance: 1 }, ['attack-started', 'attack-blocked', 'damage-dealt']],
    [{ ...heavy, accuracy: 1, criticalChance: 1, damage: 500 }, { ...fast, blockChance: 0 }, ['attack-started', 'critical-hit', 'damage-dealt', 'fighter-defeated', 'bout-finished']],
  ] as const)('emits the canonical first attack sequence', (home, away, expectedTypes) => {
    let state = createBattle({ home, away: { ...away, attackIntervalTicks: 60 }, seed: 19 })
    while (!state.events.some(({ type }) => type === 'attack-started')) state = advanceBattleTick(state)
    const firstAttackTick = state.events.find(({ type }) => type === 'attack-started')?.tick
    expect(state.events.filter(({ tick }) => tick === firstAttackTick).map(({ type }) => type)).toEqual(expectedTypes)
  })

  it('emits approach-started exactly once before the first attack', () => {
    const state = finished({ home: heavy, away: fast, seed: 7 })
    const approaches = state.events.filter(({ type }) => type === 'approach-started')
    const firstAttack = state.events.find(({ type }) => type === 'attack-started')
    expect(approaches).toHaveLength(1)
    expect(state.approachStarted).toBe(true)
    expect(approaches[0].tick).toBeGreaterThan(0)
    expect(approaches[0].tick).toBeLessThan(firstAttack?.tick ?? Number.POSITIVE_INFINITY)
  })

  it('orders equal-interval initiative by the derived tie roll', () => {
    let state = createBattle({ home: { ...heavy, accuracy: 0 }, away: { ...fast, accuracy: 0 }, seed: 47 })
    let before = state
    let tieTick: number | undefined
    while (tieTick === undefined) {
      before = state
      state = advanceBattleTick(state)
      if (state.events.filter(({ type, tick }) => type === 'attack-started' && tick === state.tick).length === 2) tieTick = state.tick
    }
    const [roll] = nextRandom(before.initiativeTieRandom)
    const actors = state.events.flatMap((event) =>
      event.type === 'attack-started' && event.tick === tieTick ? [event.actorSide] : [],
    )
    expect(actors).toEqual(roll < 0.5 ? ['home', 'away'] : ['away', 'home'])
  })

  it('finishes by time limit with the higher remaining-health ratio winning', () => {
    const home = { ...heavy, id: 'home', maxHp: 100, damage: 1, attackIntervalTicks: 100, accuracy: 1, blockChance: 0, criticalChance: 0 }
    const away = { ...heavy, id: 'away', maxHp: 150, damage: 1, attackIntervalTicks: 100, accuracy: 1, blockChance: 0, criticalChance: 0 }
    const state = finished({ home, away, seed: 41 })
    expect(state.phase).toBe('finished')
    expect(state.finishReason).toBe('time-limit')
    expect(state.tick).toBe(MAX_BOUT_TICKS)
    const homeRatio = state.fighters.home.hp / state.fighters.home.definition.maxHp
    const awayRatio = state.fighters.away.hp / state.fighters.away.definition.maxHp
    expect(homeRatio).not.toBe(awayRatio)
    expect(state.winnerSide).toBe(homeRatio > awayRatio ? 'home' : 'away')
    expect(state.events.at(-1)).toMatchObject({ type: 'bout-finished', winnerSide: state.winnerSide, reason: 'time-limit', durationTicks: MAX_BOUT_TICKS })
  })

  it('uses the derived tie winner for an exact ratio tie', () => {
    const state = finished({ home: { ...heavy, id: 'home', accuracy: 0 }, away: { ...heavy, id: 'away', accuracy: 0 }, seed: 43 })
    expect(state.phase).toBe('finished')
    expect(state.finishReason).toBe('time-limit')
    expect(state.tick).toBe(MAX_BOUT_TICKS)
    expect(state.fighters.home.hp / state.fighters.home.definition.maxHp)
      .toBe(state.fighters.away.hp / state.fighters.away.definition.maxHp)
    expect(state.winnerSide).toBe(state.timeLimitTieWinner)
    expect(state.events.at(-1)).toMatchObject({ type: 'bout-finished', winnerSide: state.timeLimitTieWinner, reason: 'time-limit', durationTicks: MAX_BOUT_TICKS })
  })
})
