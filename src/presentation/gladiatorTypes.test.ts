import { describe, expect, it } from 'vitest'
import { COUNTER_RULE_TEXT, TYPE_DESCRIPTIONS, TYPE_NAMES } from './gladiatorTypes'

describe('gladiator type identity', () => {
  it('names every archetype and leaks no mechanics id', () => {
    expect(TYPE_NAMES).toEqual({ heavy: 'Murmillo', fast: 'Retiarius', technical: 'Hoplomachus' })
    const copy = [...Object.values(TYPE_NAMES), ...Object.values(TYPE_DESCRIPTIONS), COUNTER_RULE_TEXT].join(' ')
    for (const id of ['Heavy', 'Fast', 'Technical']) expect(copy).not.toContain(id)
  })
  it('states the counter rule in type names', () => {
    for (const name of Object.values(TYPE_NAMES)) expect(COUNTER_RULE_TEXT).toContain(name)
  })
})
