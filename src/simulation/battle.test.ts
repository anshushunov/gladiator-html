import { describe, expect, it } from 'vitest'
import { createBattle, stepBattle } from './battle'

function advance(seconds: number, step = 1 / 60) {
  let state = createBattle()
  for (let elapsed = 0; elapsed < seconds && state.phase === 'running'; elapsed += step) {
    state = stepBattle(state, step)
  }
  return state
}

describe('battle simulation', () => {
  it('starts with two healthy fighters outside attack range', () => {
    const state = createBattle()
    expect(state.fighters.map(({ hp }) => hp)).toEqual([100, 100])
    expect(state.fighters[1].x - state.fighters[0].x).toBeGreaterThan(1.45)
  })

  it('moves fighters together before dealing damage', () => {
    const state = advance(1)
    expect(state.fighters[0].x).toBeGreaterThan(-5)
    expect(state.fighters.map(({ hp }) => hp)).toEqual([100, 100])
  })

  it('finishes deterministically', () => {
    const first = advance(20)
    const second = advance(20)
    expect(first.phase).toBe('finished')
    expect(first).toEqual(second)
  })
})
