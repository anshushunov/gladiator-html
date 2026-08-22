// src/simulation/condition.test.ts
import { describe, expect, it } from 'vitest'
import {
  conditionAfterBout,
  conditionAfterRest,
  conditionAtIndex,
  conditionIndex,
  isFightable,
  startingHpFor,
} from './condition'

describe('condition ladder', () => {
  it('orders the four steps and clamps at both ends', () => {
    expect(conditionIndex('fresh')).toBe(0)
    expect(conditionIndex('broken')).toBe(3)
    expect(conditionAtIndex(-2)).toBe('fresh')
    expect(conditionAtIndex(9)).toBe('broken')
  })

  it('starts a bout at the ratio of max HP, never below 1', () => {
    expect(startingHpFor('fresh', 324)).toBe(324)
    expect(startingHpFor('bruised', 324)).toBe(243)
    expect(startingHpFor('wounded', 324)).toBe(162)
    expect(startingHpFor('wounded', 1)).toBe(1)
  })

  it('refuses to start a bout for a broken gladiator', () => {
    expect(isFightable('broken')).toBe(false)
    expect(() => startingHpFor('broken', 324)).toThrow(/broken/)
  })

  // The whole point of the slice: no bout is free. A dominant win still costs
  // one step, so the best matchup is paid for by the series that follows.
  it('charges every bout at least one step', () => {
    expect(conditionAfterBout('fresh', { remainingHpRatio: 1, won: true })).toBe('bruised')
    expect(conditionAfterBout('fresh', { remainingHpRatio: 0.6, won: true })).toBe('bruised')
  })

  it('charges two steps for a loss at any ratio, or a win under 25%', () => {
    expect(conditionAfterBout('fresh', { remainingHpRatio: 0.9, won: false })).toBe('wounded')
    expect(conditionAfterBout('fresh', { remainingHpRatio: 0.24, won: true })).toBe('wounded')
    // 0.25 is the boundary and belongs to the cheaper band.
    expect(conditionAfterBout('fresh', { remainingHpRatio: 0.25, won: true })).toBe('bruised')
  })

  it('clamps wear at broken and recovers one step per rest', () => {
    expect(conditionAfterBout('wounded', { remainingHpRatio: 0, won: false })).toBe('broken')
    expect(conditionAfterBout('broken', { remainingHpRatio: 0, won: false })).toBe('broken')
    expect(conditionAfterRest('broken')).toBe('wounded')
    expect(conditionAfterRest('fresh')).toBe('fresh')
  })

  it('rejects a non-finite ratio rather than silently clamping it', () => {
    expect(() => conditionAfterBout('fresh', { remainingHpRatio: Number.NaN, won: true })).toThrow()
  })
})
