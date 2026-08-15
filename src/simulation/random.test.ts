import { describe, expect, it } from 'vitest'
import { createRandom, deriveBoutSeed, deriveSideSeed, drawAttackRolls, nextRandom } from './random'

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

  it('derives stable distinct bout and side streams', () => {
    const bout0 = deriveBoutSeed(20260815, 0)
    const bout1 = deriveBoutSeed(20260815, 1)
    expect(bout0).toBe(deriveBoutSeed(20260815, 0))
    expect(bout0).not.toBe(bout1)
    expect(deriveSideSeed(bout0, 'home')).not.toBe(deriveSideSeed(bout0, 'away'))
  })

  it('consumes exactly three values for every attack', () => {
    const initial = createRandom(17)
    const drawn = drawAttackRolls(initial)
    let expected = initial
    for (let index = 0; index < 3; index += 1) expected = nextRandom(expected)[1]
    expect(drawn.next).toEqual(expected)
  })

  it('normalizes the zero seed to the non-zero fallback value', () => {
    expect(createRandom(0).value).toBe(0x6d2b79f5)
  })

  it('draws attack rolls in accuracy, block, critical order from three sequential values', () => {
    const initial = createRandom(23)
    const drawn = drawAttackRolls(initial)
    const [accuracy, afterAccuracy] = nextRandom(initial)
    const [block, afterBlock] = nextRandom(afterAccuracy)
    const [critical, afterCritical] = nextRandom(afterBlock)
    expect(drawn.rolls.accuracy).toBe(accuracy)
    expect(drawn.rolls.block).toBe(block)
    expect(drawn.rolls.critical).toBe(critical)
    expect(drawn.next).toEqual(afterCritical)
  })
})
