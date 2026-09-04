import { describe, expect, it } from 'vitest'
import type { FighterCombatState } from '../simulation/encounter'
import { TICKS_PER_SECOND } from '../simulation/movement'
import { selectClip, type ClipMappingInput } from './clipMapping'
import { STYLE_GAIT_CYCLE_DISTANCE } from './gait'

const D = new Map<string, number>([
  ['Idle', 1.0], ['Walking_A', 1.0], ['Hit_A', 0.6], ['Death_A', 0.8],
  ['1H_Melee_Attack_Chop', 1.0], ['Block', 1.0], ['Dodge_Backward', 0.4],
])

function state(overrides: Partial<FighterCombatState> = {}): FighterCombatState {
  return {
    id: 'home.brutus',
    factionId: 'home',
    definition: { id: 'brutus', name: 'Brutus', school: 'Test', archetype: 'heavy', maxHp: 100, power: 10, accuracy: 0.8, defenseChance: 0.3, criticalChance: 0.1 },
    position: { x: 0, z: 0 },
    facing: { x: 0, z: 1 },
    travelledDistance: 0,
    hp: 100,
    status: 'active',
    locomotionIntent: 'hold-range',
    velocity: { x: 0, z: 0 },
    action: { type: 'neutral' },
    staggerUntilTick: 0,
    nextDecisionTick: 0,
    nextActionSerial: 0,
    lastContactTick: -1,
    lastResolutionTick: -1,
    reactionLedger: [],
    ...overrides,
  } as FighterCombatState
}

function input(overrides: Partial<ClipMappingInput> = {}): ClipMappingInput {
  return { archetype: 'heavy', state: state(), tick: 0, alpha: 0, durations: D, ...overrides }
}

describe('selectClip', () => {
  it('idles by default, looping on the tick clock', () => {
    expect(selectClip(input({ tick: 30, alpha: 0.5 }))).toEqual({ clip: 'Idle', time: (30.5 / TICKS_PER_SECOND) % 1.0, weaponTrailActive: false })
  })

  it('walks on travelled distance when moving, so the same distance gives the same frame', () => {
    const moving = state({ velocity: { x: 0, z: 0.3 }, travelledDistance: STYLE_GAIT_CYCLE_DISTANCE.heavy * 2.25 })
    // computeGaitPhase's modulo arithmetic over a non-exact double (1.4) lands a hair off
    // 0.25 in floating point, so this compares within tolerance rather than by exact bits.
    expect(selectClip(input({ state: moving, tick: 5 }))).toEqual({ clip: 'Walking_A', time: expect.closeTo(0.25), weaponTrailActive: false })
    expect(selectClip(input({ state: moving, tick: 500 })).time).toBeCloseTo(0.25)
  })

  it('lands an attack clip\'s strike frame on the simulation contact tick', () => {
    const attacking = (phase: 'windup' | 'contact' | 'impact' | 'recovery', started: number, ends: number) =>
      state({ action: { type: 'active', instanceId: 'a1', definitionId: 'heavy-cleave', phase, phaseStartedTick: started, phaseEndsAtTick: ends, targetId: 'away.drusus' } })
    // windup 0..20 -> clip 0..0.5 (contactAt for heavy-cleave is 0.5, duration 1.0)
    expect(selectClip(input({ state: attacking('windup', 0, 20), tick: 10 })).time).toBeCloseTo(0.25)
    expect(selectClip(input({ state: attacking('windup', 0, 20), tick: 10 })).weaponTrailActive).toBe(false)
    expect(selectClip(input({ state: attacking('windup', 0, 20), tick: 14 })).weaponTrailActive).toBe(true)
    // contact tick -> exactly contactAt
    expect(selectClip(input({ state: attacking('contact', 20, 21), tick: 20 })).time).toBeCloseTo(0.5)
    expect(selectClip(input({ state: attacking('contact', 20, 21), tick: 20 })).weaponTrailActive).toBe(true)
    // impact holds between contactAt and contactAt + 0.15
    expect(selectClip(input({ state: attacking('impact', 21, 31), tick: 26 })).time).toBeCloseTo(0.575)
    // recovery runs the rest out
    expect(selectClip(input({ state: attacking('recovery', 31, 51), tick: 41 })).time).toBeCloseTo(0.825)
    expect(selectClip(input({ state: attacking('recovery', 31, 51), tick: 41 })).weaponTrailActive).toBe(false)
  })

  it('sweeps the defense clip monotonically across windup, contact, impact, then recovery', () => {
    const blocking = (phase: 'windup' | 'contact' | 'impact' | 'recovery', started: number, ends: number) =>
      state({ action: { type: 'active', instanceId: 'd1', definitionId: 'heavy-guard', phase, phaseStartedTick: started, phaseEndsAtTick: ends, targetId: 'away.drusus' } })
    // windup 0..10, halfway (p = 0.5) -> 0.5 * 0.4 * 1.0
    expect(selectClip(input({ state: blocking('windup', 0, 10), tick: 5 }))).toEqual({ clip: 'Block', time: 0.2, weaponTrailActive: false })
    // contact just starting (p = 0) -> exactly the windup fraction, the guard is fully raised
    expect(selectClip(input({ state: blocking('contact', 20, 21), tick: 20 })).time).toBeCloseTo(0.4)
    // impact just ending (p = 1) -> exactly the impact fraction, about to lower the guard
    expect(selectClip(input({ state: blocking('impact', 21, 25), tick: 25 })).time).toBeCloseTo(0.6)
    // recovery halfway -> between the impact fraction and the clip's end
    expect(selectClip(input({ state: blocking('recovery', 0, 10), tick: 5 })).time).toBeCloseTo(0.8)
  })

  it('prefers the hit clip while staggered, timed from the stagger start', () => {
    const staggered = state({ staggerUntilTick: 40, action: { type: 'active', instanceId: 'a1', definitionId: 'heavy-cleave', phase: 'windup', phaseStartedTick: 0, phaseEndsAtTick: 20, targetId: 'x' } })
    expect(selectClip(input({ state: staggered, tick: 30, staggerStartTick: 24 }))).toEqual({ clip: 'Hit_A', time: 6 / TICKS_PER_SECOND, weaponTrailActive: false })
    expect(selectClip(input({ state: staggered, tick: 39, staggerStartTick: 0 })).time).toBe(0.6) // clamped to the clip end
  })

  it('holds the last death frame once defeated', () => {
    const defeated = state({ status: 'defeated', staggerUntilTick: 999 })
    expect(selectClip(input({ state: defeated, tick: 100, defeatedAtTick: 90 })).clip).toBe('Death_A')
    expect(selectClip(input({ state: defeated, tick: 100, defeatedAtTick: 90 })).time).toBeCloseTo(10 / TICKS_PER_SECOND)
    expect(selectClip(input({ state: defeated, tick: 1000, defeatedAtTick: 90 })).time).toBe(0.8)
  })

  it('falls back to the current tick when a stagger or defeat start was never recorded', () => {
    expect(selectClip(input({ state: state({ staggerUntilTick: 40 }), tick: 30 })).time).toBe(0)
    expect(selectClip(input({ state: state({ status: 'defeated' }), tick: 30 })).time).toBe(0)
  })
})
