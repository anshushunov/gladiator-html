import { describe, expect, it } from 'vitest'
import { COMBAT_STYLES } from '../content/combatStyles'
import { combatant, duelArena, freeArena } from '../testSupport/combatFixtures'
import {
  advanceEncounterTick,
  advanceEncounterTicks,
  areHostile,
  assertEncounterInvariants,
  createEncounter,
  finishEncounter,
  type EncounterConfig,
  type EncounterEvent,
  type FighterCombatState,
  type EncounterResult,
  type EncounterState,
} from './encounter'
import type { Vec2 } from './movement'

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

/**
 * A local (not shared via `combatFixtures.ts`, deliberately -- see the Task 8
 * report) two-combatant duel fixture matching the design's duel-adapter
 * shape: `home.brutus` (heavy) vs. `away.drusus` (fast), an ordered-pair
 * arena sized like `duelArena` but with `orderedPair` naming these two ids.
 */
function duelEncounterConfig(overrides: Partial<EncounterConfig> & { seed: number }): EncounterConfig {
  return {
    combatants: [
      combatant('home.brutus', 'home', { archetype: 'heavy', startPosition: { x: -2.2, z: 0 } }),
      combatant('away.drusus', 'away', { archetype: 'fast', startPosition: { x: 2.2, z: 0 } }),
    ],
    arena: { ...duelArena, orderedPair: ['home.brutus', 'away.drusus'] },
    hostility: { mode: 'different-factions' },
    combatStyles: COMBAT_STYLES,
    ...overrides,
  }
}

function distanceBetween(a: Readonly<Vec2>, b: Readonly<Vec2>): number {
  const dx = a.x - b.x
  const dz = a.z - b.z
  return Math.sqrt(dx * dx + dz * dz)
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

// ===========================================================================
// Task 8: advanceEncounterTick -- phases 1-8 (decisions, actions, defense
// batching, simultaneous movement). Contact resolution (phases 9-12) is out
// of scope; actions reach `contact` but are never resolved here.
// ===========================================================================

describe('advanceEncounterTick: movement/action trace (brief Step 1 fixture)', () => {
  it('produces distance movement, action starts, and movement-intent-changed events over 180 ticks', () => {
    let transition = createEncounter(duelEncounterConfig({ seed: 11 }))
    const batches: EncounterEvent[] = [...transition.events]
    const distances: number[] = []
    for (let count = 0; count < 180; count += 1) {
      transition = advanceEncounterTick(transition.state)
      batches.push(...transition.events)
      distances.push(
        distanceBetween(transition.state.combatants['home.brutus'].position, transition.state.combatants['away.drusus'].position),
      )
    }

    expect(transition.state.tick).toBe(180)
    expect(transition.state.combatants['home.brutus'].travelledDistance).toBeGreaterThan(0)
    expect(Math.max(...distances) - Math.min(...distances)).toBeGreaterThan(0.25)
    expect(batches.some(({ type }) => type === 'movement-intent-changed')).toBe(true)
    expect(batches.some(({ type }) => type === 'action-started')).toBe(true)

    expect(() => assertEncounterInvariants(transition.state)).not.toThrow()
    expect(structuredClone(transition.state)).toEqual(transition.state)
  })
})

describe('advanceEncounterTick: actor-local action instance IDs', () => {
  it('pins a:0, a:1, and b:0 (in a:0 before a:1 order) for a fast-vs-fast duel', () => {
    const created = createEncounter({
      seed: 4,
      combatants: [
        combatant('a', 'home', { archetype: 'fast', startPosition: { x: -1.5, z: 0 } }),
        combatant('b', 'away', { archetype: 'fast', startPosition: { x: 1.5, z: 0 } }),
      ],
      arena: duelArena,
      hostility: { mode: 'different-factions' },
      combatStyles: COMBAT_STYLES,
    })

    const { events } = advanceEncounterTicks(created.state, 300)
    const instanceIds = events
      .filter((event): event is Extract<EncounterEvent, { type: 'action-started' }> => event.type === 'action-started')
      .map((event) => event.actionInstanceId)

    expect(instanceIds).toEqual(expect.arrayContaining(['a:0', 'a:1', 'b:0']))
    expect(instanceIds.indexOf('a:0')).toBeLessThan(instanceIds.indexOf('a:1'))
  })
})

describe('advanceEncounterTick: finished encounters are inert', () => {
  it('returns the exact same state object (referential identity) and an empty event batch', () => {
    const created = createEncounter(duelEncounterConfig({ seed: 1 }))
    const finished = finishEncounter(created.state, {
      reason: 'no-hostile-pairs',
      survivorIds: ['home.brutus'],
      winnerIds: ['home.brutus'],
      winningFactionIds: ['home'],
    })

    const transition = advanceEncounterTick(finished.state)

    expect(transition.state).toBe(finished.state)
    expect(transition.events).toEqual([])
  })
})

describe('advanceEncounterTicks', () => {
  it('is a no-op returning the exact same object when the initial state is already finished', () => {
    const created = createEncounter(duelEncounterConfig({ seed: 1 }))
    const finished = finishEncounter(created.state, {
      reason: 'time-limit',
      survivorIds: created.state.combatantIds,
      winnerIds: [created.state.combatantIds[0]],
      winningFactionIds: [created.state.combatants[created.state.combatantIds[0]].factionId],
    }).state

    const { state, events } = advanceEncounterTicks(finished, 50)

    expect(state).toBe(finished)
    expect(events).toEqual([])
  })

  it('concatenates event batches across running ticks, matching repeated single-tick calls', () => {
    const created = createEncounter(duelEncounterConfig({ seed: 1 }))

    const viaHelper = advanceEncounterTicks(created.state, 50)

    let manualState = created.state
    const manualEvents: EncounterEvent[] = []
    for (let index = 0; index < 50; index += 1) {
      const next = advanceEncounterTick(manualState)
      manualState = next.state
      manualEvents.push(...next.events)
    }

    expect(viaHelper.state).toEqual(manualState)
    expect(viaHelper.events).toEqual(manualEvents)
  })
})

// ---------------------------------------------------------------------------
// Whitebox movement-constraint fixtures: these construct an intermediate
// `EncounterState` directly (bypassing the normal decision flow) so a single
// `advanceEncounterTick` call exercises one specific action phase/status in
// isolation. `other` is always placed far enough away and given a
// far-future `nextDecisionTick` so it never interferes.
// ---------------------------------------------------------------------------

function patchCombatant(state: EncounterState, id: string, overrides: Partial<FighterCombatState>): EncounterState {
  return { ...state, combatants: { ...state.combatants, [id]: { ...state.combatants[id], ...overrides } } }
}

function movementConstraintFixture(): EncounterState {
  const created = createEncounter({
    seed: 1,
    combatants: [combatant('self', 'home', { archetype: 'heavy', startPosition: { x: 0, z: 0 } }), combatant('other', 'away', { archetype: 'heavy', startPosition: { x: 15, z: 0 } })],
    arena: freeArena,
    hostility: { mode: 'different-factions' },
    combatStyles: COMBAT_STYLES,
  })
  return patchCombatant(created.state, 'other', { nextDecisionTick: 999_999 })
}

describe('advanceEncounterTick: movement constraints by action phase (design.md, exact)', () => {
  it('windup: distributes the authored root travel evenly along facing across the windup ticks', () => {
    const base = patchCombatant(movementConstraintFixture(), 'self', {
      position: { x: 0, z: 0 },
      facing: { x: 1, z: 0 },
      targetId: 'other',
      nextDecisionTick: 999_999,
      action: {
        type: 'active',
        instanceId: 'self:0',
        definitionId: 'heavy-cleave',
        phase: 'windup',
        phaseStartedTick: 0,
        phaseEndsAtTick: 40,
        targetId: 'other',
        attackRolls: { accuracy: 0.5, critical: 0.5 },
      },
    })
    const withTick: EncounterState = { ...base, tick: 5 }

    const { state } = advanceEncounterTick(withTick)

    const definition = COMBAT_STYLES.attacks['heavy-cleave']
    const expectedStep = definition.rootTravel / definition.windupTicks
    expect(state.combatants.self.position.x).toBeCloseTo(expectedStep, 9)
    expect(state.combatants.self.position.z).toBeCloseTo(0, 9)
    expect(state.combatants.self.action).toMatchObject({ phase: 'windup' })
  })

  it('windup: stops the root-travel step early at arena.minimumSeparation instead of pushing the target back', () => {
    // heavy-cleave's per-tick step is 0.45/34 ~= 0.01324, which would carry
    // `self` from x=0 to x=0.01324 -- past the target's x=0.905 minus
    // freeArena's minimumSeparation (0.9), i.e. past 0.005 of headroom.
    // The capped step must land self at exactly minimumSeparation from the
    // (unmoved) target, not let the symmetric separation solver shove the
    // target backwards to fix an overshoot.
    const base = patchCombatant(movementConstraintFixture(), 'other', { position: { x: 0.905, z: 0 }, nextDecisionTick: 999_999 })
    const withSelf = patchCombatant(base, 'self', {
      position: { x: 0, z: 0 },
      facing: { x: 1, z: 0 },
      targetId: 'other',
      nextDecisionTick: 999_999,
      action: {
        type: 'active',
        instanceId: 'self:0',
        definitionId: 'heavy-cleave',
        phase: 'windup',
        phaseStartedTick: 0,
        phaseEndsAtTick: 40,
        targetId: 'other',
        attackRolls: { accuracy: 0.5, critical: 0.5 },
      },
    })
    const withTick: EncounterState = { ...withSelf, tick: 5 }
    const otherBefore = withTick.combatants.other.position

    const { state } = advanceEncounterTick(withTick)

    expect(distanceBetween(state.combatants.self.position, state.combatants.other.position)).toBeCloseTo(freeArena.minimumSeparation, 9)
    expect(state.combatants.other.position).toEqual(otherBefore) // the target never moves to accommodate the attacker's approach.
  })

  it('contact: freezes root motion during the one-tick contact phase, even when entered this same tick', () => {
    const base = patchCombatant(movementConstraintFixture(), 'self', {
      position: { x: 0, z: 0 },
      facing: { x: 1, z: 0 },
      targetId: undefined,
      nextDecisionTick: 999_999,
      action: {
        type: 'active',
        instanceId: 'self:0',
        definitionId: 'heavy-cleave',
        phase: 'windup',
        phaseStartedTick: 0,
        phaseEndsAtTick: 6,
        targetId: 'other',
        attackRolls: { accuracy: 0.5, critical: 0.5 },
      },
    })
    const withTick: EncounterState = { ...base, tick: 5 }

    const { state } = advanceEncounterTick(withTick)

    expect(state.combatants.self.action).toMatchObject({ phase: 'contact' })
    expect(state.combatants.self.position).toEqual({ x: 0, z: 0 })
  })

  it('impact: freezes root motion (pushback is Task 9)', () => {
    const base = patchCombatant(movementConstraintFixture(), 'self', {
      position: { x: 0, z: 0 },
      facing: { x: 1, z: 0 },
      targetId: undefined,
      nextDecisionTick: 999_999,
      action: {
        type: 'active',
        instanceId: 'self:0',
        definitionId: 'heavy-cleave',
        phase: 'contact',
        phaseStartedTick: 5,
        phaseEndsAtTick: 6,
        targetId: 'other',
        attackRolls: { accuracy: 0.5, critical: 0.5 },
      },
    })
    const withTick: EncounterState = { ...base, tick: 5 }

    const { state } = advanceEncounterTick(withTick)

    expect(state.combatants.self.action).toMatchObject({ phase: 'impact' })
    expect(state.combatants.self.position).toEqual({ x: 0, z: 0 })
  })

  it('recovery: allows at most 35% of normal style speed along the last ordinary locomotion intent', () => {
    const base = patchCombatant(movementConstraintFixture(), 'self', {
      position: { x: 0, z: 0 },
      facing: { x: 1, z: 0 },
      targetId: undefined,
      nextDecisionTick: 999_999,
      locomotionIntent: 'advance',
      action: {
        type: 'active',
        instanceId: 'self:0',
        definitionId: 'heavy-cleave',
        phase: 'recovery',
        phaseStartedTick: 0,
        phaseEndsAtTick: 999,
        targetId: 'other',
        attackRolls: { accuracy: 0.5, critical: 0.5 },
      },
    })
    const withTick: EncounterState = { ...base, tick: 5 }

    const { state } = advanceEncounterTick(withTick)

    const heavy = COMBAT_STYLES.styles.heavy.locomotion
    const expectedX = (heavy.forwardUnitsPerSecond / 60) * 0.35
    expect(state.combatants.self.position.x).toBeCloseTo(expectedX, 9)
    expect(state.combatants.self.position.z).toBeCloseTo(0, 9)
  })

  it('staggered: applies no locomotion regardless of the retained locomotionIntent', () => {
    const base = patchCombatant(movementConstraintFixture(), 'self', {
      position: { x: 0, z: 0 },
      facing: { x: 1, z: 0 },
      targetId: undefined,
      nextDecisionTick: 999_999,
      locomotionIntent: 'advance',
      staggerUntilTick: 999,
      action: { type: 'neutral' },
    })
    const withTick: EncounterState = { ...base, tick: 5 }

    const { state } = advanceEncounterTick(withTick)

    expect(state.combatants.self.position).toEqual({ x: 0, z: 0 })
    expect(state.combatants.self.locomotionIntent).toBe('advance') // retained, not forced to hold-range
  })

  it('defeated: applies no locomotion and excludes the fighter from movement resolution entirely', () => {
    const base = patchCombatant(movementConstraintFixture(), 'self', {
      position: { x: 0, z: 0 },
      facing: { x: 1, z: 0 },
      targetId: undefined,
      nextDecisionTick: 999_999,
      locomotionIntent: 'advance',
      status: 'defeated',
      hp: 0,
      action: { type: 'neutral' },
    })
    const withTick: EncounterState = { ...base, tick: 5 }

    const { state } = advanceEncounterTick(withTick)

    expect(state.combatants.self.position).toEqual({ x: 0, z: 0 })
    expect(state.combatants.self.velocity).toEqual({ x: 0, z: 0 })
    expect(state.combatants.self.locomotionIntent).toBe('advance') // retained, not forced to hold-range
  })
})

describe('advanceEncounterTick: isDecisionReady is stagger-aware', () => {
  it('does not reacquire a target for a staggered, targetless, otherwise decision-ready combatant', () => {
    const base = movementConstraintFixture() // 'other' sits 15 units away, inside both retention (20) and acquisition (16) radii.
    const state = patchCombatant(base, 'self', { nextDecisionTick: 1, staggerUntilTick: 999, targetId: undefined })
    const withTick: EncounterState = { ...state, tick: 0 } // advances to tick 1, matching nextDecisionTick

    const { state: next } = advanceEncounterTick(withTick)

    expect(next.combatants.self.targetId).toBeUndefined()
  })

  it('does not make a decision (or consume its decision stream) for a staggered combatant that already has a valid target', () => {
    const base = movementConstraintFixture()
    const state = patchCombatant(base, 'self', {
      nextDecisionTick: 1,
      staggerUntilTick: 999,
      targetId: 'other',
      locomotionIntent: 'hold-range',
    })
    const withTick: EncounterState = { ...state, tick: 0 }
    const decisionStreamBefore = withTick.randomByCombatant.self.decision

    const { state: next, events } = advanceEncounterTick(withTick)

    // Heavy at distance 15 (well outside its 1.2-1.7 preferred range) would
    // ordinarily select advance/pressure with a strongly positive weight --
    // if a real decision had run, locomotionIntent would very likely have
    // changed away from 'hold-range'. Staggered, it must not run at all.
    expect(next.combatants.self.locomotionIntent).toBe('hold-range')
    expect(next.randomByCombatant.self.decision).toEqual(decisionStreamBefore)
    expect(events.some((event) => event.type === 'movement-intent-changed' || event.type === 'action-started')).toBe(false)
  })
})

describe("advanceEncounterTick: Fast's forced disengage (design.md; Task 7's hasFastForcedDisengageEnded)", () => {
  function fastDisengageFixture(otherPosition: Vec2 = { x: 10, z: 0 }): EncounterState {
    const created = createEncounter({
      seed: 1,
      combatants: [
        combatant('self', 'home', { archetype: 'fast', startPosition: { x: 0, z: 0 } }),
        combatant('other', 'away', { archetype: 'fast', startPosition: otherPosition }),
      ],
      arena: freeArena,
      hostility: { mode: 'different-factions' },
      combatStyles: COMBAT_STYLES,
    })
    return patchCombatant(created.state, 'other', { nextDecisionTick: 999_999 })
  }

  it('forces disengage the instant a fast-burst-lunge recovery ends, stamping forcedDisengageStartTick and emitting movement-intent-changed', () => {
    const base = fastDisengageFixture()
    const state = patchCombatant(base, 'self', {
      targetId: 'other',
      nextDecisionTick: 999_999,
      locomotionIntent: 'advance',
      action: {
        type: 'active',
        instanceId: 'self:0',
        definitionId: 'fast-burst-lunge',
        phase: 'recovery',
        phaseStartedTick: 0,
        phaseEndsAtTick: 6,
        targetId: 'other',
        attackRolls: { accuracy: 0.5, critical: 0.5 },
      },
    })
    const withTick: EncounterState = { ...state, tick: 5 } // recovery ends exactly at the new tick (6)

    const { state: next, events } = advanceEncounterTick(withTick)

    expect(next.combatants.self.action).toEqual({ type: 'neutral' })
    expect(next.combatants.self.locomotionIntent).toBe('disengage')
    expect(next.combatants.self.forcedDisengageStartTick).toBe(6)
    expect(events).toContainEqual({
      id: expect.any(Number),
      tick: 6,
      type: 'movement-intent-changed',
      combatantId: 'self',
      from: 'advance',
      to: 'disengage',
    })
  })

  it('ends the forced disengage once distance to target falls to at most 2.4 units, and immediately re-enters ordinary weighted choice', () => {
    const base = fastDisengageFixture({ x: 2.3, z: 0 }) // within FAST_FORCED_DISENGAGE_END_RANGE (2.4)
    const state = patchCombatant(base, 'self', {
      targetId: 'other',
      nextDecisionTick: 999_999,
      locomotionIntent: 'disengage',
      forcedDisengageStartTick: 0,
      action: { type: 'neutral' },
    })
    const withTick: EncounterState = { ...state, tick: 4 } // ticksSinceForced becomes 5, well under the 30-tick timeout
    const decisionStreamBefore = withTick.randomByCombatant.self.decision

    const { state: next } = advanceEncounterTick(withTick)

    expect(next.combatants.self.forcedDisengageStartTick).toBeUndefined()
    // Clearing the forced state makes the combatant decision-ready again on
    // this same tick (design: "re-enters ordinary weighted choice"), so a
    // real decision runs immediately -- the decision stream is consumed,
    // and nextDecisionTick reflects that fresh ordinary decision rather than
    // the sentinel this fixture set for the (bypassed) forced period.
    expect(next.randomByCombatant.self.decision).not.toEqual(decisionStreamBefore)
    expect(next.combatants.self.nextDecisionTick).toBeGreaterThan(5)
  })

  it('ends the forced disengage after 30 ticks regardless of distance', () => {
    const base = fastDisengageFixture({ x: 10, z: 0 }) // far outside the 2.4-unit range
    const state = patchCombatant(base, 'self', {
      targetId: 'other',
      nextDecisionTick: 999_999,
      locomotionIntent: 'disengage',
      forcedDisengageStartTick: 0,
      action: { type: 'neutral' },
    })
    const withTick: EncounterState = { ...state, tick: 29 } // ticksSinceForced becomes 30 this tick
    const decisionStreamBefore = withTick.randomByCombatant.self.decision

    const { state: next } = advanceEncounterTick(withTick)

    expect(next.combatants.self.forcedDisengageStartTick).toBeUndefined()
    expect(next.randomByCombatant.self.decision).not.toEqual(decisionStreamBefore)
  })

  it('keeps forcing disengage -- no ordinary decision, no decision-stream draw -- while neither exit condition is met', () => {
    const base = fastDisengageFixture({ x: 10, z: 0 })
    const state = patchCombatant(base, 'self', {
      targetId: 'other',
      nextDecisionTick: 1, // would otherwise already be decision-ready
      locomotionIntent: 'disengage',
      forcedDisengageStartTick: 0,
      action: { type: 'neutral' },
    })
    const withTick: EncounterState = { ...state, tick: 4 } // ticksSinceForced 5, distance 10 -- neither exit condition holds
    const decisionStreamBefore = withTick.randomByCombatant.self.decision

    const { state: next, events } = advanceEncounterTick(withTick)

    expect(next.combatants.self.forcedDisengageStartTick).toBe(0)
    expect(next.combatants.self.locomotionIntent).toBe('disengage')
    expect(next.randomByCombatant.self.decision).toEqual(decisionStreamBefore)
    expect(events.some((event) => event.type === 'movement-intent-changed' || event.type === 'action-started')).toBe(false)
  })
})

describe('advanceEncounterTick: movement-intent-changed is emitted only on an actual enum change', () => {
  it("fires exactly when a combatant's locomotionIntent value changed since the previous tick, and never otherwise, across many decisions", () => {
    let state = createEncounter(duelEncounterConfig({ seed: 11 })).state
    let previousIntents: Record<string, string> = Object.fromEntries(state.combatantIds.map((id) => [id, state.combatants[id].locomotionIntent]))
    let observedAnyChange = false

    for (let index = 0; index < 300; index += 1) {
      const { state: next, events } = advanceEncounterTick(state)
      const changedIds = new Set(
        events.filter((event): event is Extract<EncounterEvent, { type: 'movement-intent-changed' }> => event.type === 'movement-intent-changed').map((event) => event.combatantId),
      )

      for (const id of next.combatantIds) {
        const actuallyChanged = next.combatants[id].locomotionIntent !== previousIntents[id]
        expect(changedIds.has(id)).toBe(actuallyChanged)
        if (actuallyChanged) observedAnyChange = true
      }

      previousIntents = Object.fromEntries(next.combatantIds.map((id) => [id, next.combatants[id].locomotionIntent]))
      state = next
    }

    // Guards against a vacuously true property check: a real change must
    // occur somewhere in this 300-tick run for the assertions above (which
    // otherwise trivially hold on every "nothing happened" tick) to be
    // meaningful.
    expect(observedAnyChange).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// Carried forward from Task 7's review: `processDefenseBatch` does not
// itself verify its threats are this tick's exact reaction opportunity, so
// phase 6 MUST pre-filter with `isDefenseReactionOpportunity` per defender.
// This pins that an incoming windup produces a reaction opportunity on
// exactly one tick, never on every tick of the windup.
// ---------------------------------------------------------------------------

function reactionOpportunityFixture(): EncounterState {
  const created = createEncounter({
    seed: 1,
    combatants: [combatant('atk', 'home', { archetype: 'heavy', startPosition: { x: 0, z: 0 } }), combatant('def', 'away', { archetype: 'technical', startPosition: { x: 2, z: 0 } })],
    arena: freeArena,
    hostility: { mode: 'different-factions' },
    combatStyles: COMBAT_STYLES,
  })
  let state = created.state
  state = patchCombatant(state, 'atk', {
    nextDecisionTick: 999_999,
    action: {
      type: 'active',
      instanceId: 'atk:0',
      definitionId: 'technical-driving-thrust',
      phase: 'windup',
      phaseStartedTick: 0,
      phaseEndsAtTick: 30,
      targetId: 'def',
      attackRolls: { accuracy: 0.5, critical: 0.5 },
    },
  })
  state = patchCombatant(state, 'def', { nextDecisionTick: 999_999 })
  return { ...state, tick: 14 }
}

describe('advanceEncounterTick: exactly one reaction opportunity per defender/attack pair', () => {
  it('fires the defense batch on the single tick where contactTick - tick equals the reaction lead, not on any other tick of the windup', () => {
    let state = reactionOpportunityFixture()
    const reactionEventTicks: number[] = []
    const ledgerSizes: number[] = []

    for (let index = 0; index < 10; index += 1) {
      const next = advanceEncounterTick(state)
      state = next.state
      if (next.events.some((event) => event.type === 'defense-started' || event.type === 'defense-declined')) {
        reactionEventTicks.push(state.tick)
      }
      ledgerSizes.push(state.combatants.def.reactionLedger.length)
    }

    // technical-driving-thrust started at tick 0 with a 30-tick windup
    // (contactTick 30); technical-parry's lead is 10, so the single
    // opportunity is at tick 20 (30 - 20 === 10). Ticks 15-24 are covered.
    expect(reactionEventTicks).toEqual([20])
    expect(ledgerSizes).toEqual([0, 0, 0, 0, 0, 1, 1, 1, 1, 1])
  })
})

describe('advanceEncounterTick: defense cancellation and reaction-ledger pruning (Step 4)', () => {
  it('cancels a still-windup bound defense and prunes its ledger entry once the referenced threat vanishes before contact', () => {
    const created = createEncounter({
      seed: 1,
      combatants: [combatant('atk', 'home', { archetype: 'heavy', startPosition: { x: 0, z: 0 } }), combatant('def', 'away', { archetype: 'technical', startPosition: { x: 2, z: 0 } })],
      arena: freeArena,
      hostility: { mode: 'different-factions' },
      combatStyles: COMBAT_STYLES,
    })
    let state = patchCombatant(created.state, 'atk', { nextDecisionTick: 999_999, action: { type: 'neutral' } })
    state = patchCombatant(state, 'def', {
      nextDecisionTick: 999_999,
      reactionLedger: [{ incomingActionId: 'atk:0', outcome: 'scheduled' }],
      action: {
        type: 'active',
        instanceId: 'def:0',
        definitionId: 'technical-parry',
        phase: 'windup',
        phaseStartedTick: 0,
        phaseEndsAtTick: 30,
        targetId: 'atk',
        reactingToActionId: 'atk:0',
      },
    })
    state = { ...state, tick: 5 }

    const { state: next, events } = advanceEncounterTick(state)

    expect(next.combatants.def.reactionLedger).toEqual([])
    expect(next.combatants.def.action).toEqual({ type: 'neutral' })
    expect(events).toContainEqual({
      id: expect.any(Number),
      tick: 6,
      type: 'action-interrupted',
      actorId: 'def',
      actionInstanceId: 'def:0',
      actionId: 'technical-parry',
      reason: 'threat-canceled',
    })
  })

  it('tracks live threats, not elapsed ticks: the ledger stays populated while the threat remains live, then drops the instant it resolves', () => {
    let state = reactionOpportunityFixture()
    for (let index = 0; index < 6; index += 1) {
      state = advanceEncounterTick(state).state // ticks 15..20; the reaction opportunity lands on tick 20.
    }
    expect(state.combatants.def.reactionLedger).toHaveLength(1) // still live -- the windup's own contact (tick 30) is far away.

    // Directly resolve the referenced attack (what Task 9's contact
    // resolution will eventually do): the action instance is gone.
    const resolved = patchCombatant(state, 'atk', { action: { type: 'neutral' } })
    const { state: afterResolution } = advanceEncounterTick(resolved)

    expect(afterResolution.combatants.def.reactionLedger).toHaveLength(0)
  })
})
