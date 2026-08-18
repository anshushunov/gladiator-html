import { describe, expect, it } from 'vitest'
import { COMBAT_STYLES } from '../content/combatStyles'
import { combatant, freeArena } from '../testSupport/combatFixtures'
import { createEncounter, type EncounterState } from '../simulation/encounter'
import { collectFootstepThresholds, type PlantedFootByCombatant } from './footstepThresholds'

const HEAVY_GAIT_CYCLE = 1.4 // STYLE_GAIT_CYCLE_DISTANCE.heavy, poses/combatPoses.ts

function baseEncounter(): EncounterState {
  return createEncounter({
    seed: 1,
    combatants: [combatant('a', 'red', { archetype: 'heavy' }), combatant('b', 'blue', { archetype: 'heavy' })],
    arena: freeArena,
    hostility: { mode: 'different-factions' },
    combatStyles: COMBAT_STYLES,
  }).state
}

function withCombatant(state: EncounterState, id: string, overrides: Partial<EncounterState['combatants'][string]>): EncounterState {
  return { ...state, combatants: { ...state.combatants, [id]: { ...state.combatants[id], ...overrides } } }
}

describe('collectFootstepThresholds', () => {
  it('fires a threshold when an active, non-staggered combatant crosses into a new planted foot', () => {
    const state = withCombatant(baseEncounter(), 'a', { travelledDistance: 0.3 * HEAVY_GAIT_CYCLE }) // 'right'
    const lastPlantedFoot: PlantedFootByCombatant = new Map()

    const result = collectFootstepThresholds(state, lastPlantedFoot, 0)

    expect(result.thresholds).toEqual([{ id: 0, combatantId: 'a', archetype: 'heavy', foot: 'right' }])
    expect(result.nextFootstepId).toBe(1)
    expect(lastPlantedFoot.get('a')).toBe('right')
  })

  it('never fires for a staggered combatant even if its travelled distance crosses a plant boundary', () => {
    const state = withCombatant(baseEncounter(), 'a', { travelledDistance: 0.3 * HEAVY_GAIT_CYCLE, staggerUntilTick: 100 })
    const lastPlantedFoot: PlantedFootByCombatant = new Map()

    const result = collectFootstepThresholds(state, lastPlantedFoot, 0)

    expect(result.thresholds).toEqual([])
    expect(result.nextFootstepId).toBe(0)
    // Treated as 'both' (no plant), not silently skipped -- so the tick
    // after grounding resumes correctly reads this as a real transition.
    expect(lastPlantedFoot.get('a')).toBe('both')
  })

  it('never fires for a defeated combatant even if its travelled distance crosses a plant boundary', () => {
    const state = withCombatant(baseEncounter(), 'a', { travelledDistance: 0.3 * HEAVY_GAIT_CYCLE, status: 'defeated', hp: 0 })
    const lastPlantedFoot: PlantedFootByCombatant = new Map()

    const result = collectFootstepThresholds(state, lastPlantedFoot, 0)

    expect(result.thresholds).toEqual([])
    expect(lastPlantedFoot.get('a')).toBe('both')
  })

  it('fires again once grounding resumes after a stagger clears (the exact heavy-cleave pushback scenario)', () => {
    // Simulates a `heavy-cleave` knockback (pushDistance 0.70, exactly half
    // of Heavy's 1.4 gait cycle) landing while staggered -- no cue for that
    // tick -- then the stagger clearing with the foot classification still
    // sitting on the far side of the boundary the pushback crossed.
    const staggered = withCombatant(baseEncounter(), 'a', { travelledDistance: 0.3 * HEAVY_GAIT_CYCLE, staggerUntilTick: 100 })
    const lastPlantedFoot: PlantedFootByCombatant = new Map()
    collectFootstepThresholds(staggered, lastPlantedFoot, 0) // no-op while staggered; leaves 'both'

    const recovered = withCombatant(staggered, 'a', {
      travelledDistance: 0.3 * HEAVY_GAIT_CYCLE + 0.70, // pushed across the boundary while staggered
      staggerUntilTick: 0,
      status: 'active',
    })
    const result = collectFootstepThresholds(recovered, lastPlantedFoot, 0)

    expect(result.thresholds).toHaveLength(1)
    expect(result.thresholds[0].combatantId).toBe('a')
  })

  it('gates each combatant independently -- one staggered does not silence the other', () => {
    let state = withCombatant(baseEncounter(), 'a', { travelledDistance: 0.3 * HEAVY_GAIT_CYCLE, staggerUntilTick: 100 })
    state = withCombatant(state, 'b', { travelledDistance: 0.3 * HEAVY_GAIT_CYCLE })
    const lastPlantedFoot: PlantedFootByCombatant = new Map()

    const result = collectFootstepThresholds(state, lastPlantedFoot, 0)

    expect(result.thresholds).toEqual([{ id: 0, combatantId: 'b', archetype: 'heavy', foot: 'right' }])
  })

  it('assigns strictly increasing ids across multiple thresholds in one call, continuing from the given starting id', () => {
    let state = withCombatant(baseEncounter(), 'a', { travelledDistance: 0.3 * HEAVY_GAIT_CYCLE })
    state = withCombatant(state, 'b', { travelledDistance: 0.3 * HEAVY_GAIT_CYCLE })
    const lastPlantedFoot: PlantedFootByCombatant = new Map()

    const result = collectFootstepThresholds(state, lastPlantedFoot, 5)

    expect(result.thresholds.map((t) => t.id)).toEqual([5, 6])
    expect(result.nextFootstepId).toBe(7)
  })

  it('does not re-fire while the planted foot stays the same across calls', () => {
    const state = withCombatant(baseEncounter(), 'a', { travelledDistance: 0.3 * HEAVY_GAIT_CYCLE })
    const lastPlantedFoot: PlantedFootByCombatant = new Map()

    collectFootstepThresholds(state, lastPlantedFoot, 0)
    const second = collectFootstepThresholds(state, lastPlantedFoot, 0)

    expect(second.thresholds).toEqual([])
  })
})
