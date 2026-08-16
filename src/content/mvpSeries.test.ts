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
      { id: 'brutus', name: 'Brutus', school: 'House of Mars', archetype: 'heavy', maxHp: 170, power: 22, accuracy: 0.86, defenseChance: 0.34, criticalChance: 0.10 },
      { id: 'aquila', name: 'Aquila', school: 'House of Mars', archetype: 'fast', maxHp: 120, power: 16, accuracy: 0.84, defenseChance: 0.31, criticalChance: 0.14 },
      { id: 'nerva', name: 'Nerva', school: 'House of Mars', archetype: 'technical', maxHp: 165, power: 20, accuracy: 0.92, defenseChance: 0.40, criticalChance: 0.16 },
    ])
    expect(opponents).toEqual([
      { id: 'drusus', name: 'Drusus', school: 'House of Saturn', archetype: 'fast', maxHp: 185, power: 21, accuracy: 0.90, defenseChance: 0.36, criticalChance: 0.15 },
      { id: 'cassius', name: 'Cassius', school: 'House of Neptune', archetype: 'technical', maxHp: 160, power: 19, accuracy: 0.90, defenseChance: 0.38, criticalChance: 0.12 },
      { id: 'magnus', name: 'Magnus', school: 'House of Vulcan', archetype: 'heavy', maxHp: 145, power: 18, accuracy: 0.78, defenseChance: 0.32, criticalChance: 0.06 },
    ])
  })
})
