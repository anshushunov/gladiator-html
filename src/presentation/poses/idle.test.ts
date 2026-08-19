import { describe, expect, it } from 'vitest'
import { computeIdlePhase, idleAmplitude, sampleIdleLayer } from './idle'

describe('idle phase', () => {
  it('advances smoothly with interpolated simulation time, not in 60 Hz steps', () => {
    const a = computeIdlePhase(10.0, 'brutus')
    const b = computeIdlePhase(10.0 + 1 / 240, 'brutus')
    expect(b).not.toBe(a)
  })

  it('puts two fighters out of phase so they never sway in unison', () => {
    expect(computeIdlePhase(10.0, 'brutus')).not.toBeCloseTo(computeIdlePhase(10.0, 'drusus'), 3)
  })

  it('stays inside 0..1', () => {
    for (const time of [0, 0.5, 7.25, 123.75]) {
      const phase = computeIdlePhase(time, 'nerva')
      expect(phase).toBeGreaterThanOrEqual(0)
      expect(phase).toBeLessThan(1)
    }
  })
})

describe('idle amplitude', () => {
  it('is zero at full speed and full when standing', () => {
    expect(idleAmplitude(1, false, false)).toBe(0)
    expect(idleAmplitude(0, false, false)).toBe(1)
  })

  it('is exactly zero when suppressed or under reduced motion', () => {
    // Exactly zero, not merely small: the acceptance criterion is that the
    // pose is *identical* between ticks under reduced motion.
    expect(idleAmplitude(0, true, false)).toBe(0)
    expect(idleAmplitude(0, false, true)).toBe(0)
  })
})

describe('idle sampling', () => {
  it('writes nothing at zero amplitude', () => {
    expect(Object.keys(sampleIdleLayer(0.4, 0))).toHaveLength(0)
  })

  it('never writes leg or foot joints, which grounding owns', () => {
    const pose = sampleIdleLayer(0.4, 1)
    for (const name of Object.keys(pose)) {
      expect(name).not.toMatch(/^(upperLeg|lowerLeg|foot)\./)
    }
  })
})
