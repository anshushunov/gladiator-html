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
      { id: 'brutus', name: 'Brutus', school: 'House of Mars', archetype: 'heavy', maxHp: 285, power: 22, accuracy: 0.86, defenseChance: 0.34, criticalChance: 0.10 },
      { id: 'aquila', name: 'Aquila', school: 'House of Mars', archetype: 'fast', maxHp: 246, power: 22, accuracy: 0.90, defenseChance: 0.35, criticalChance: 0.24 },
      { id: 'nerva', name: 'Nerva', school: 'House of Mars', archetype: 'technical', maxHp: 283, power: 20, accuracy: 0.92, defenseChance: 0.40, criticalChance: 0.16 },
    ])
    expect(opponents).toEqual([
      { id: 'drusus', name: 'Drusus', school: 'House of Saturn', archetype: 'fast', maxHp: 292, power: 21, accuracy: 0.90, defenseChance: 0.36, criticalChance: 0.15 },
      { id: 'cassius', name: 'Cassius', school: 'House of Neptune', archetype: 'technical', maxHp: 277, power: 19, accuracy: 0.90, defenseChance: 0.38, criticalChance: 0.12 },
      { id: 'magnus', name: 'Magnus', school: 'House of Vulcan', archetype: 'heavy', maxHp: 251, power: 19, accuracy: 0.84, defenseChance: 0.36, criticalChance: 0.10 },
    ])
  })

  // The design permits tuning these numbers but not the relative intent behind
  // them, so the orderings that carry that intent are pinned as properties
  // rather than left implicit in the rows above.
  it('preserves the authored relative content intent', () => {
    const all = [...homeRoster, ...opponents]
    const byId = Object.fromEntries(all.map((f) => [f.id, f]))

    // HP ordering identical to the design's authored table.
    expect([...all].sort((a, b) => b.maxHp - a.maxHp).map(({ id }) => id))
      .toEqual(['drusus', 'brutus', 'nerva', 'cassius', 'magnus', 'aquila'])

    // Drusus absorbs a sacrifice; Aquila is the fragile burst fighter.
    expect(Math.max(...all.map((f) => f.maxHp))).toBe(byId.drusus.maxHp)
    expect(Math.min(...all.map((f) => f.maxHp))).toBe(byId.aquila.maxHp)
    expect(Math.max(...all.map((f) => f.criticalChance))).toBe(byId.aquila.criticalChance)

    // Nerva is the strongest all-rounder: top accuracy and top defence.
    expect(Math.max(...all.map((f) => f.accuracy))).toBe(byId.nerva.accuracy)
    expect(Math.max(...all.map((f) => f.defenseChance))).toBe(byId.nerva.defenseChance)

    // Magnus is the vulnerable opponent: lowest HP of the three, and the
    // lowest accuracy of all six.
    expect(Math.min(...opponents.map((f) => f.maxHp))).toBe(byId.magnus.maxHp)
    expect(Math.min(...all.map((f) => f.accuracy))).toBe(byId.magnus.accuracy)
  })
})
