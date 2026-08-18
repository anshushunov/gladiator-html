import { describe, expect, it } from 'vitest'
import { compareArchetypes, comparisonDamageMultiplier, validateFighterDefinition, type Archetype, type FighterDefinition } from './fighters'

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
    ]).toEqual([0.90, 1, 1.10])
  })
})

describe('fighter definition validation', () => {
  const valid: FighterDefinition = {
    id: 'brutus', name: 'Brutus', school: 'House of Mars', archetype: 'heavy',
    maxHp: 170, power: 22, accuracy: 0.86, defenseChance: 0.34, criticalChance: 0.10,
  }

  it('returns the same definition instance when valid', () => {
    expect(validateFighterDefinition(valid)).toBe(valid)
  })

  it('rejects a non-finite power', () => {
    expect(() => validateFighterDefinition({ ...valid, power: Number.NaN })).toThrow('power')
  })

  it('rejects an accuracy above 1', () => {
    expect(() => validateFighterDefinition({ ...valid, accuracy: 1.01 })).toThrow('accuracy')
  })

  it('rejects a non-positive maxHp', () => {
    expect(() => validateFighterDefinition({ ...valid, maxHp: 0 })).toThrow('maxHp')
  })

  it('rejects a defenseChance outside 0..1', () => {
    expect(() => validateFighterDefinition({ ...valid, defenseChance: -0.01 })).toThrow('defenseChance')
  })

  it('rejects a criticalChance outside 0..1', () => {
    expect(() => validateFighterDefinition({ ...valid, criticalChance: 1.5 })).toThrow('criticalChance')
  })

  it('rejects a fractional maxHp', () => {
    expect(() => validateFighterDefinition({ ...valid, maxHp: 170.5 })).toThrow('maxHp')
  })

  it('rejects an empty id, name, or school', () => {
    expect(() => validateFighterDefinition({ ...valid, id: '' })).toThrow('id')
    expect(() => validateFighterDefinition({ ...valid, name: '' })).toThrow('name')
    expect(() => validateFighterDefinition({ ...valid, school: '' })).toThrow('school')
  })
})
