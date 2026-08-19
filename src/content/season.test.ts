import { describe, expect, it } from 'vitest'
import { homeRoster as mvpHomeRoster, opponents as mvpOpponents } from './mvpSeries'
import { SEASON_CHALLENGES, SEASON_ROSTER } from './season'

describe('season content', () => {
  it('keeps the calibrated six exactly as they are', () => {
    expect(SEASON_ROSTER.slice(0, 3)).toEqual(mvpHomeRoster)
    expect(SEASON_CHALLENGES[0].opponents).toEqual(mvpOpponents)
  })

  it('fields five gladiators, two heavy, two fast, one technical', () => {
    expect(SEASON_ROSTER).toHaveLength(5)
    const byArchetype = SEASON_ROSTER.reduce<Record<string, number>>((acc, f) => ({ ...acc, [f.archetype]: (acc[f.archetype] ?? 0) + 1 }), {})
    expect(byArchetype).toEqual({ heavy: 2, fast: 2, technical: 1 })
    expect(new Set(SEASON_ROSTER.map((f) => f.id)).size).toBe(5)
  })

  it('scales every opponent monotonically across the three challenges, integrally', () => {
    for (const opponentIndex of [0, 1, 2]) {
      const hp = SEASON_CHALLENGES.map((c) => c.opponents[opponentIndex].maxHp)
      const power = SEASON_CHALLENGES.map((c) => c.opponents[opponentIndex].power)
      expect(hp[0]).toBeLessThan(hp[1])
      expect(hp[1]).toBeLessThan(hp[2])
      expect(power[0]).toBeLessThan(power[1])
      expect(power[1]).toBeLessThan(power[2])
      for (const value of hp) expect(Number.isInteger(value)).toBe(true)
    }
  })

  it('leaves the calibrated stat rows untouched by scaling', () => {
    for (const challenge of SEASON_CHALLENGES) {
      challenge.opponents.forEach((opponent, index) => {
        expect(opponent.accuracy).toBe(mvpOpponents[index].accuracy)
        expect(opponent.defenseChance).toBe(mvpOpponents[index].defenseChance)
        expect(opponent.criticalChance).toBe(mvpOpponents[index].criticalChance)
        expect(opponent.id).toBe(mvpOpponents[index].id)
      })
    }
  })

  it('names one featured threat per escalated challenge', () => {
    expect(SEASON_CHALLENGES.map((c) => c.featuredThreat)).toEqual([null, 'fast', 'heavy'])
  })
})
