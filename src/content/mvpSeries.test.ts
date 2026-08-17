import { describe, expect, it } from 'vitest'
import { homeRoster, opponents } from './mvpSeries'

describe('MVP series content', () => {
  it.each([
    ['home', homeRoster],
    ['away', opponents],
  ] as const)('%s roster has one fighter of every archetype', (_side, roster) => {
    expect(roster).toHaveLength(3)
    expect(roster.map(({ archetype }) => archetype).sort()).toEqual(['fast', 'heavy', 'technical'])
    expect(new Set(roster.map(({ id }) => id)).size).toBe(3)
  })

  it('keeps the fixed opponent order', () => {
    expect(opponents.map(({ name }) => name)).toEqual(['Drusus', 'Cassius', 'Magnus'])
  })

  it('pins the six content rows exactly', () => {
    expect(homeRoster).toEqual([
      { id: 'brutus', name: 'Brutus', school: 'House of Mars', archetype: 'heavy', maxHp: 324, power: 22, accuracy: 0.86, defenseChance: 0.34, criticalChance: 0.10 },
      { id: 'aquila', name: 'Aquila', school: 'House of Mars', archetype: 'fast', maxHp: 274, power: 20, accuracy: 0.855, defenseChance: 0.315, criticalChance: 0.148 },
      { id: 'nerva', name: 'Nerva', school: 'House of Mars', archetype: 'technical', maxHp: 314, power: 20, accuracy: 0.92, defenseChance: 0.40, criticalChance: 0.16 },
    ])
    expect(opponents).toEqual([
      { id: 'drusus', name: 'Drusus', school: 'House of Saturn', archetype: 'fast', maxHp: 350, power: 21, accuracy: 0.90, defenseChance: 0.36, criticalChance: 0.15 },
      { id: 'cassius', name: 'Cassius', school: 'House of Neptune', archetype: 'technical', maxHp: 312, power: 19, accuracy: 0.90, defenseChance: 0.395, criticalChance: 0.12 },
      { id: 'magnus', name: 'Magnus', school: 'House of Vulcan', archetype: 'heavy', maxHp: 299, power: 18, accuracy: 0.85, defenseChance: 0.335, criticalChance: 0.099 },
    ])
  })

  // The design permits tuning these numbers but fixes the relative intent behind
  // them (design.md:698), so each stat's rank order is pinned as a property
  // rather than left implicit in the rows above. Four of five are exactly the
  // authored order; the fifth is a disclosed, load-bearing deviation and is
  // pinned in its deviated form so it cannot drift further unnoticed.
  const rankBy = (key: 'maxHp' | 'power' | 'accuracy' | 'defenseChance' | 'criticalChance') =>
    [...homeRoster, ...opponents].sort((a, b) => b[key] - a[key]).map(({ id }) => id)

  it('preserves the authored rank order for HP, accuracy, defence and critical chance', () => {
    expect(rankBy('maxHp')).toEqual(['drusus', 'brutus', 'nerva', 'cassius', 'magnus', 'aquila'])
    expect(rankBy('accuracy')).toEqual(['nerva', 'drusus', 'cassius', 'brutus', 'aquila', 'magnus'])
    expect(rankBy('defenseChance')).toEqual(['nerva', 'cassius', 'drusus', 'brutus', 'magnus', 'aquila'])
    expect(rankBy('criticalChance')).toEqual(['nerva', 'drusus', 'aquila', 'cassius', 'brutus', 'magnus'])
  })

  it('records the one deviated rank order: Aquila is no longer lowest on power', () => {
    // Authored: brutus > drusus > nerva > cassius > magnus > aquila.
    // Aquila moves from strictly lowest to tied third with Nerva. Without it
    // `aquila/drusus` measures 1.5% and `aquila/magnus` 10.5% against the
    // cohort's 15..85% band -- see the note in `mvpSeries.ts` for the levers
    // that were measured and rejected first. Pinned so the deviation stays
    // exactly this size and does not quietly grow.
    const byId = Object.fromEntries([...homeRoster, ...opponents].map((f) => [f.id, f]))
    expect(rankBy('power')).toEqual(['brutus', 'aquila', 'nerva', 'drusus', 'cassius', 'magnus'].sort(
      (a, b) => byId[b].power - byId[a].power,
    ))
    expect(byId.aquila.power).toBe(20)
    expect(byId.aquila.power).toBeGreaterThan(byId.cassius.power)
    expect(byId.aquila.power).toBeLessThan(byId.brutus.power) // Brutus keeps top power
  })

  it('keeps the named identities from the design table', () => {
    const all = [...homeRoster, ...opponents]
    const byId = Object.fromEntries(all.map((f) => [f.id, f]))

    // Drusus absorbs a sacrifice; Aquila is the fragile burst fighter.
    expect(Math.max(...all.map((f) => f.maxHp))).toBe(byId.drusus.maxHp)
    expect(Math.min(...all.map((f) => f.maxHp))).toBe(byId.aquila.maxHp)

    // Nerva is the strongest all-rounder: top accuracy, defence and critical.
    expect(Math.max(...all.map((f) => f.accuracy))).toBe(byId.nerva.accuracy)
    expect(Math.max(...all.map((f) => f.defenseChance))).toBe(byId.nerva.defenseChance)
    expect(Math.max(...all.map((f) => f.criticalChance))).toBe(byId.nerva.criticalChance)

    // Magnus is the vulnerable opponent: lowest HP of the three opponents, and
    // the lowest accuracy and critical chance of all six.
    expect(Math.min(...opponents.map((f) => f.maxHp))).toBe(byId.magnus.maxHp)
    expect(Math.min(...all.map((f) => f.accuracy))).toBe(byId.magnus.accuracy)
    expect(Math.min(...all.map((f) => f.criticalChance))).toBe(byId.magnus.criticalChance)
  })
})
