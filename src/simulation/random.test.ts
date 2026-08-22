import { describe, expect, it } from 'vitest'
import {
  createRandom,
  deriveBoutSeed,
  deriveSeriesSeed,
  nextRandom,
  createCombatantRandomState,
  drawPair,
  derivedUnitValue,
  foldTraceHash,
  formatTraceHash,
} from './random'

describe('seeded random', () => {
  it('repeats the same sequence for the same seed', () => {
    let first = createRandom(20260815)
    let second = createRandom(20260815)
    const firstValues: number[] = []
    const secondValues: number[] = []
    for (let index = 0; index < 8; index += 1) {
      const [a, nextA] = nextRandom(first)
      const [b, nextB] = nextRandom(second)
      firstValues.push(a)
      secondValues.push(b)
      first = nextA
      second = nextB
    }
    expect(firstValues).toEqual(secondValues)
  })

  it('derives stable distinct bout streams', () => {
    const bout0 = deriveBoutSeed(20260815, 0)
    const bout1 = deriveBoutSeed(20260815, 1)
    expect(bout0).toBe(deriveBoutSeed(20260815, 0))
    expect(bout0).not.toBe(bout1)
  })

  it('normalizes the zero seed to the non-zero fallback value', () => {
    expect(createRandom(0).value).toBe(0x6d2b79f5)
  })

  it('creates independent combatant-local random streams', () => {
    const streams = createCombatantRandomState(20260815, 'home.brutus')
    expect(streams).toEqual(createCombatantRandomState(20260815, 'home.brutus'))
    expect(streams.decision).not.toEqual(streams.defense)
    expect(streams.defense).not.toEqual(streams.contact)
  })

  it('draws a pair of consecutive values from a stream', () => {
    const streams = createCombatantRandomState(20260815, 'home.brutus')
    const [decisionRolls, nextDecision] = drawPair(streams.decision)
    expect(decisionRolls).toHaveProperty('first')
    expect(decisionRolls).toHaveProperty('second')
    expect(nextDecision).toEqual(nextRandom(nextRandom(streams.decision)[1])[1])
  })

  it('derives a unit value without mutating a stream', () => {
    expect(derivedUnitValue(7, 'tick:19:actor:3')).toBe(0.5615094522945583)
  })

  it('folds and formats trace hashes correctly', () => {
    expect(formatTraceHash(foldTraceHash(0x811c9dc5, 'combat'))).toBe('1ce36e21')
  })

  it('passes series 0 through unchanged and derives the rest', () => {
    expect(deriveSeriesSeed(20260815, 0)).toBe(20260815)
    expect(deriveSeriesSeed(20260815, 1)).not.toBe(20260815)
    expect(deriveSeriesSeed(20260815, 1)).toBe(deriveSeriesSeed(20260815, 1))
    expect(deriveSeriesSeed(20260815, 1)).not.toBe(deriveSeriesSeed(20260815, 2))
  })
})
