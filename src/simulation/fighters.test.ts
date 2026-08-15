import { describe, expect, it } from 'vitest'
import { compareArchetypes, comparisonDamageMultiplier, type Archetype } from './fighters'

describe('archetype comparison', () => {
  it.each([
    ['heavy', 'fast'],
    ['fast', 'technical'],
    ['technical', 'heavy'],
  ] as const)('%s has advantage against %s', (home, away) => {
    expect(compareArchetypes(home, away)).toBe('advantage')
    expect(compareArchetypes(away, home)).toBe('disadvantage')
  })

  it.each(['heavy', 'fast', 'technical'] satisfies Archetype[])('%s is neutral against itself', (archetype) => {
    expect(compareArchetypes(archetype, archetype)).toBe('neutral')
  })

  it('orders damage multipliers from disadvantage to advantage', () => {
    expect([
      comparisonDamageMultiplier('disadvantage'),
      comparisonDamageMultiplier('neutral'),
      comparisonDamageMultiplier('advantage'),
    ]).toEqual([0.8, 1, 1.25])
  })
})