import { describe, expect, it } from 'vitest'
import { classifyPlantedFoot, computeGaitPhase, STYLE_GAIT_CYCLE_DISTANCE } from './gait'

describe('gait', () => {
  it('wraps travelled distance into a 0..1 phase per archetype cycle', () => {
    expect(computeGaitPhase(0, 'heavy')).toBe(0)
    expect(computeGaitPhase(STYLE_GAIT_CYCLE_DISTANCE.heavy / 2, 'heavy')).toBeCloseTo(0.5)
    expect(computeGaitPhase(STYLE_GAIT_CYCLE_DISTANCE.fast * 1.25, 'fast')).toBeCloseTo(0.25)
  })

  it('alternates planted foot across a cycle with a double-support window at each plant', () => {
    const cycle = STYLE_GAIT_CYCLE_DISTANCE.technical
    expect(classifyPlantedFoot(0, 'technical')).toBe('both')
    expect(classifyPlantedFoot(cycle * 0.25, 'technical')).toBe('right')
    expect(classifyPlantedFoot(cycle * 0.5, 'technical')).toBe('both')
    expect(classifyPlantedFoot(cycle * 0.75, 'technical')).toBe('left')
  })
})
