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

  // Drusus is deliberately identical in all three challenges: he is the
  // strongest opponent and both Fast gladiators meet him in a mirror that
  // `aquila/drusus` already loses at exactly the 15% floor, so any scaling at
  // all pushes a frozen pairing under criterion 3's 5% band. Escalation is
  // carried by Cassius and Magnus. See the SCALING comment in season.ts.
  it('freezes Drusus across all three challenges', () => {
    for (const challenge of SEASON_CHALLENGES) expect(challenge.opponents[0]).toEqual(mvpOpponents[0])
  })

  it('escalates Cassius and Magnus monotonically across the three challenges, integrally', () => {
    for (const opponentIndex of [1, 2]) {
      const hp = SEASON_CHALLENGES.map((c) => c.opponents[opponentIndex].maxHp)
      const power = SEASON_CHALLENGES.map((c) => c.opponents[opponentIndex].power)
      expect(hp[0]).toBeLessThan(hp[1])
      expect(hp[1]).toBeLessThan(hp[2])
      expect(power[0]).toBeLessThan(power[1])
      expect(power[1]).toBeLessThan(power[2])
    }
    // Integrality is required of every opponent, frozen or not.
    for (const challenge of SEASON_CHALLENGES) {
      for (const opponent of challenge.opponents) expect(Number.isInteger(opponent.maxHp)).toBe(true)
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
    // `technical`, not `fast`: with Drusus frozen at x1.00 the largest step of
    // challenge 2 is Cassius's, and the featured threat follows the escalation.
    expect(SEASON_CHALLENGES.map((c) => c.featuredThreat)).toEqual([null, 'technical', 'heavy'])
  })

  // The rule the scaling vectors are chosen against, and the reason three of
  // the six numbers are what they are (see the SCALING comment in season.ts):
  // a challenge's featured threat is the opponent it escalates HARDEST, not
  // merely a label on the card. Measured off `power`, which carries the factor
  // exactly -- `maxHp` is rounded to an integer and so is only approximate.
  it('escalates the featured threat harder than either other opponent', () => {
    const baseline = SEASON_CHALLENGES[0].opponents
    const featuredChallenges = SEASON_CHALLENGES.filter((challenge) => challenge.featuredThreat !== null)
    expect(featuredChallenges).toHaveLength(2)

    for (const challenge of featuredChallenges) {
      const steps = challenge.opponents.map((opponent, index) => ({
        archetype: opponent.archetype,
        step: opponent.power / baseline[index].power,
      }))
      const featured = steps.filter((entry) => entry.archetype === challenge.featuredThreat)
      expect(featured).toHaveLength(1)
      for (const other of steps) {
        if (other === featured[0]) continue
        expect(featured[0].step).toBeGreaterThan(other.step)
      }
    }
  })
})
