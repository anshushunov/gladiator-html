import { describe, expect, it } from 'vitest'
import { COMBAT_STYLES } from '../content/combatStyles'
import { combatant, duelArena, freeArena } from '../testSupport/combatFixtures'
import {
  areHostile,
  assertEncounterInvariants,
  createEncounter,
  finishEncounter,
  type EncounterConfig,
  type EncounterResult,
  type EncounterState,
} from './encounter'

function baseConfig(overrides: Partial<EncounterConfig> = {}): EncounterConfig {
  return {
    seed: 7,
    combatants: [combatant('b', 'red'), combatant('a', 'blue')],
    arena: freeArena,
    hostility: { mode: 'different-factions' },
    combatStyles: COMBAT_STYLES,
    ...overrides,
  }
}

describe('createEncounter', () => {
  it('sorts combatantIds, emits encounter-started at id 0, and seeds decision state (brief fixture)', () => {
    const transition = createEncounter(baseConfig())

    expect(transition.state.combatantIds).toEqual(['a', 'b'])
    expect(transition.events).toEqual([
      { id: 0, tick: 0, type: 'encounter-started', combatantIds: ['a', 'b'], factionIds: ['blue', 'red'], hostilityMode: 'different-factions' },
    ])
    expect(transition.state.nextEventId).toBe(1)
    expect(transition.state.combatants.a.nextDecisionTick).toBe(1)
    expect(transition.state.randomByCombatant.a).toBeDefined()
    expect('events' in transition.state).toBe(false)
    expect(structuredClone(transition.state)).toEqual(transition.state)
  })

  it('gives every combatant nextActionSerial 0 and status active at full HP', () => {
    const transition = createEncounter(baseConfig())
    for (const id of transition.state.combatantIds) {
      const state = transition.state.combatants[id]
      expect(state.nextActionSerial).toBe(0)
      expect(state.status).toBe('active')
      expect(state.hp).toBe(state.definition.maxHp)
    }
  })

  it('faces the positive x-axis when the arena has no orderedPair', () => {
    const transition = createEncounter(baseConfig({ arena: freeArena }))
    expect(transition.state.combatants.a.facing).toEqual({ x: 1, z: 0 })
    expect(transition.state.combatants.b.facing).toEqual({ x: 1, z: 0 })
  })

  it('faces the ordered opponent when arena.orderedPair supplies one', () => {
    const transition = createEncounter(
      baseConfig({
        combatants: [
          combatant('a', 'blue', { startPosition: { x: -2, z: 0 } }),
          combatant('b', 'red', { startPosition: { x: 2, z: 0 } }),
        ],
        arena: duelArena,
      }),
    )
    expect(transition.state.combatants.a.facing).toEqual({ x: 1, z: 0 })
    expect(transition.state.combatants.b.facing).toEqual({ x: -1, z: 0 })
  })

  describe('hostility modes', () => {
    it('free-for-all makes every distinct living pair hostile regardless of shared faction', () => {
      const transition = createEncounter(
        baseConfig({
          combatants: [combatant('a', 'red'), combatant('b', 'red')],
          hostility: { mode: 'free-for-all' },
        }),
      )
      expect(areHostile(transition.state, 'a', 'b')).toBe(true)
    })

    it('different-factions treats equal factions as allied (not hostile)', () => {
      expect(() =>
        createEncounter(
          baseConfig({
            combatants: [combatant('a', 'red'), combatant('b', 'red')],
            hostility: { mode: 'different-factions' },
          }),
        ),
      ).toThrow(/hostile pair/)
    })

    it('different-factions treats unequal factions as hostile', () => {
      const transition = createEncounter(baseConfig())
      expect(areHostile(transition.state, 'a', 'b')).toBe(true)
    })

    it('relation-table defaults missing same-faction rows to allied and missing cross-faction rows to neutral', () => {
      const transition = createEncounter(
        baseConfig({
          combatants: [combatant('a1', 'red'), combatant('a2', 'red'), combatant('b', 'blue'), combatant('c', 'green')],
          hostility: {
            mode: 'relation-table',
            relations: [{ first: 'red', second: 'blue', relation: 'hostile' }],
          },
        }),
      )
      expect(areHostile(transition.state, 'a1', 'a2')).toBe(false) // same faction, missing row -> allied
      expect(areHostile(transition.state, 'a1', 'b')).toBe(true) // explicit hostile row
      expect(areHostile(transition.state, 'a1', 'c')).toBe(false) // cross faction, missing row -> neutral
      expect(areHostile(transition.state, 'b', 'c')).toBe(false) // cross faction, missing row -> neutral
    })

    it('relation-table resolves a row identically regardless of first/second order', () => {
      const forward = createEncounter(
        baseConfig({
          combatants: [combatant('a', 'red'), combatant('b', 'blue')],
          hostility: { mode: 'relation-table', relations: [{ first: 'red', second: 'blue', relation: 'hostile' }] },
        }),
      )
      const reversed = createEncounter(
        baseConfig({
          combatants: [combatant('a', 'red'), combatant('b', 'blue')],
          hostility: { mode: 'relation-table', relations: [{ first: 'blue', second: 'red', relation: 'hostile' }] },
        }),
      )
      expect(areHostile(forward.state, 'a', 'b')).toBe(true)
      expect(areHostile(reversed.state, 'a', 'b')).toBe(true)
    })

    it('rejects conflicting duplicate relation-table rows for the same unordered faction pair', () => {
      expect(() =>
        createEncounter(
          baseConfig({
            hostility: {
              mode: 'relation-table',
              relations: [
                { first: 'red', second: 'blue', relation: 'hostile' },
                { first: 'blue', second: 'red', relation: 'neutral' },
              ],
            },
          }),
        ),
      ).toThrow(/conflicting/)
    })

    it('only hostile relations count as hostile, not allied or neutral', () => {
      const transition = createEncounter(
        baseConfig({
          combatants: [combatant('a', 'red'), combatant('b', 'blue'), combatant('c', 'green')],
          hostility: {
            mode: 'relation-table',
            relations: [
              { first: 'red', second: 'blue', relation: 'allied' },
              { first: 'red', second: 'green', relation: 'hostile' },
            ],
          },
        }),
      )
      expect(areHostile(transition.state, 'a', 'b')).toBe(false)
      expect(areHostile(transition.state, 'a', 'c')).toBe(true)
    })
  })

  describe('validation', () => {
    it('rejects an id containing the reserved ":" character', () => {
      expect(() => createEncounter(baseConfig({ combatants: [combatant('a:1', 'red'), combatant('b', 'blue')] }))).toThrow(/'a:1'/)
    })

    it('rejects an invalid factionId', () => {
      expect(() => createEncounter(baseConfig({ combatants: [combatant('a', 'red:evil'), combatant('b', 'blue')] }))).toThrow(/'red:evil'/)
    })

    it('rejects duplicate combatant ids', () => {
      expect(() => createEncounter(baseConfig({ combatants: [combatant('a', 'red'), combatant('a', 'blue')] }))).toThrow(/duplicate id 'a'/)
    })

    it('rejects a single-combatant encounter (below the 2..100 range)', () => {
      expect(() => createEncounter(baseConfig({ combatants: [combatant('a', 'red')] }))).toThrow(/between 2 and 100/)
    })

    it('rejects a 101-combatant encounter (above the 2..100 range)', () => {
      const combatants = Array.from({ length: 101 }, (_, index) => combatant(`c${index}`, index % 2 === 0 ? 'red' : 'blue'))
      expect(() => createEncounter(baseConfig({ combatants, hostility: { mode: 'different-factions' } }))).toThrow(/between 2 and 100/)
    })

    it('rejects a config with no initial hostile pair', () => {
      expect(() =>
        createEncounter(
          baseConfig({
            combatants: [combatant('a', 'red'), combatant('b', 'red')],
            hostility: { mode: 'different-factions' },
          }),
        ),
      ).toThrow(/hostile pair/)
    })

    it('rejects an arena.orderedPair referencing an id outside the encounter', () => {
      expect(() =>
        createEncounter(
          baseConfig({
            arena: { ...duelArena, orderedPair: ['a', 'ghost'] },
          }),
        ),
      ).toThrow(/'ghost'/)
    })
  })
})

describe('areHostile', () => {
  it('is false for a combatant against itself', () => {
    const transition = createEncounter(baseConfig())
    expect(areHostile(transition.state, 'a', 'a')).toBe(false)
  })

  it('is false once a participant is defeated', () => {
    const transition = createEncounter(baseConfig())
    const defeated: EncounterState = {
      ...transition.state,
      combatants: {
        ...transition.state.combatants,
        b: { ...transition.state.combatants.b, hp: 0, status: 'defeated' },
      },
    }
    expect(areHostile(defeated, 'a', 'b')).toBe(false)
  })
})

describe('finishEncounter', () => {
  it('returns a finished state and exactly one encounter-finished event drawn from nextEventId', () => {
    const created = createEncounter(baseConfig())
    const result: EncounterResult = {
      reason: 'no-hostile-pairs',
      survivorIds: ['a'],
      winnerIds: ['a'],
      winningFactionIds: ['blue'],
    }

    const transition = finishEncounter(created.state, result)

    expect(transition.state.phase).toBe('finished')
    expect(transition.state.result).toEqual(result)
    expect(transition.state.nextEventId).toBe(created.state.nextEventId + 1)
    expect(transition.events).toEqual([
      {
        id: created.state.nextEventId,
        tick: created.state.tick,
        type: 'encounter-finished',
        reason: 'no-hostile-pairs',
        durationTicks: created.state.tick,
        survivorIds: ['a'],
        winnerIds: ['a'],
        winningFactionIds: ['blue'],
      },
    ])
    expect(structuredClone(transition.state)).toEqual(transition.state)
  })

  it('is generic: a no-hostile-pairs result is winnerIds = every living survivor, winningFactionIds = their sorted unique factions', () => {
    const created = createEncounter(
      baseConfig({
        combatants: [combatant('a', 'red'), combatant('b', 'blue'), combatant('c', 'green')],
        hostility: { mode: 'free-for-all' },
      }),
    )
    const stateWithOneDefeated: EncounterState = {
      ...created.state,
      combatants: {
        ...created.state.combatants,
        c: { ...created.state.combatants.c, hp: 0, status: 'defeated' },
      },
    }

    const survivorIds = stateWithOneDefeated.combatantIds.filter((id) => stateWithOneDefeated.combatants[id].status === 'active')
    const winningFactionIds = [...new Set(survivorIds.map((id) => stateWithOneDefeated.combatants[id].factionId))].sort()
    const result: EncounterResult = { reason: 'no-hostile-pairs', survivorIds, winnerIds: survivorIds, winningFactionIds }

    const transition = finishEncounter(stateWithOneDefeated, result)

    expect(transition.events[0]).toMatchObject({
      type: 'encounter-finished',
      reason: 'no-hostile-pairs',
      survivorIds: ['a', 'b'],
      winnerIds: ['a', 'b'],
      winningFactionIds: ['blue', 'red'],
    })
  })

  it('expresses a different EncounterResult (e.g. a time-limit reason) without any special-casing inside finishEncounter', () => {
    const created = createEncounter(baseConfig())
    const result: EncounterResult = {
      reason: 'time-limit',
      survivorIds: ['a', 'b'],
      winnerIds: ['a'],
      winningFactionIds: ['blue'],
    }
    const transition = finishEncounter(created.state, result)
    expect(transition.events[0]).toMatchObject({ type: 'encounter-finished', reason: 'time-limit', winnerIds: ['a'] })
  })
})

describe('assertEncounterInvariants', () => {
  it('does not throw for a freshly created state', () => {
    const transition = createEncounter(baseConfig())
    expect(() => assertEncounterInvariants(transition.state)).not.toThrow()
  })

  it('throws when combatantIds is not sorted', () => {
    const transition = createEncounter(baseConfig())
    const broken: EncounterState = { ...transition.state, combatantIds: ['b', 'a'] }
    expect(() => assertEncounterInvariants(broken)).toThrow(/sorted/)
  })

  it('throws when an active combatant has non-positive hp', () => {
    const transition = createEncounter(baseConfig())
    const broken: EncounterState = {
      ...transition.state,
      combatants: { ...transition.state.combatants, a: { ...transition.state.combatants.a, hp: 0 } },
    }
    expect(() => assertEncounterInvariants(broken)).toThrow(/status/)
  })

  it('throws when facing is not normalized', () => {
    const transition = createEncounter(baseConfig())
    const broken: EncounterState = {
      ...transition.state,
      combatants: { ...transition.state.combatants, a: { ...transition.state.combatants.a, facing: { x: 2, z: 0 } } },
    }
    expect(() => assertEncounterInvariants(broken)).toThrow(/facing/)
  })
})
