import { describe, expect, it } from 'vitest'
import { COMBAT_STYLES } from '../content/combatStyles'
import { BASELINE_TEST_SEED, homeRoster, opponents } from '../content/mvpSeries'
import { combatant, duelArena, freeArena, traceHash } from '../testSupport/combatFixtures'
import type { AttackActionId, CombatActionState } from './combatActions'
import {
  advanceEncounterTick,
  advanceEncounterTicks,
  areHostile,
  assertEncounterInvariants,
  createEncounter,
  finishEncounter,
  sortContactIntents,
  type ContactIntent,
  type EncounterConfig,
  type EncounterEvent,
  type FighterCombatState,
  type EncounterResult,
  type EncounterState,
} from './encounter'
import type { Archetype } from './fighters'
import type { Vec2 } from './movement'
import { derivedUnitValue } from './random'

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
  it('pins a:0 and b:0 (both present) for a fast-vs-fast duel, each id actor-prefixed with strictly increasing per-actor serials', () => {
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

    // 300 ticks, not the full 3600-tick brief window: Task 9's contact
    // resolution now genuinely staggers/interrupts, so a fast-vs-fast duel's
    // cadence of *further* actions is no longer a fixed count within a short
    // window (see the Task 9 report's TDD-evidence section for the traced
    // example this regression check replaces). What stays invariant
    // regardless of contact-resolution outcomes is the actor-local ID
    // scheme itself: both starting actions land on tick 1's earliest
    // opportunity, and the per-actor serial only ever increases.
    const { events } = advanceEncounterTicks(created.state, 300)
    const instanceIds = events
      .filter((event): event is Extract<EncounterEvent, { type: 'action-started' }> => event.type === 'action-started')
      .map((event) => event.actionInstanceId)

    expect(instanceIds).toEqual(expect.arrayContaining(['a:0', 'b:0']))

    const lastSerialByActor = new Map<string, number>()
    for (const instanceId of instanceIds) {
      const [actorId, serialText] = instanceId.split(':')
      const serial = Number(serialText)
      const previous = lastSerialByActor.get(actorId)
      expect(previous === undefined || serial > previous).toBe(true)
      lastSerialByActor.set(actorId, serial)
    }
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

// ===========================================================================
// Task 9: phases 9-10 -- contact resolution (snapshot, ordering, evade/
// guard/parry effectiveness, damage/push/stagger/critical) and accumulated
// push. All fixtures below directly construct an intermediate `EncounterState`
// (Task 8's own whitebox pattern) so a single `advanceEncounterTick` call
// exercises exactly the phase-9/10 behavior under test: the actor's action
// is built already in `windup` with `phaseEndsAtTick` equal to the tick
// being advanced *to*, so phase 1 transitions it into `contact` before
// phase 9 resolves it in that same call. Both combatants' own
// `FighterCombatState.targetId` (decision target, distinct from the bound
// action's own `targetId`) is left `undefined` so phase 7 never rotates
// their facing mid-fixture -- geometry stays exactly what each test sets.
// ===========================================================================

function types(events: readonly EncounterEvent[]): string[] {
  return events.map((event) => event.type)
}

const CONTACT_TICK = 50

interface ContactFixtureOptions {
  actorArchetype: Archetype
  targetArchetype: Archetype
  actionId: AttackActionId
  actorPosition: Vec2
  targetPosition: Vec2
  actorFacing: Vec2
  targetFacing?: Vec2
  accuracyRoll: number
  criticalRoll: number
  actorOverrides?: Partial<FighterCombatState>
  targetOverrides?: Partial<FighterCombatState>
}

/** Builds a two-combatant state whose `actor:0` action is in `windup`, ending exactly at `CONTACT_TICK` -- so advancing one tick from `CONTACT_TICK - 1` transitions it to `contact` and resolves it. */
function contactFixture(options: ContactFixtureOptions): EncounterState {
  const created = createEncounter({
    seed: 1,
    combatants: [
      combatant('actor', 'home', { archetype: options.actorArchetype, startPosition: options.actorPosition }),
      combatant('target', 'away', { archetype: options.targetArchetype, startPosition: options.targetPosition }),
    ],
    arena: freeArena,
    hostility: { mode: 'different-factions' },
    combatStyles: COMBAT_STYLES,
  })

  let state = patchCombatant(created.state, 'actor', {
    targetId: undefined,
    nextDecisionTick: 999_999,
    facing: options.actorFacing,
    action: {
      type: 'active',
      instanceId: 'actor:0',
      definitionId: options.actionId,
      phase: 'windup',
      phaseStartedTick: CONTACT_TICK - 1,
      phaseEndsAtTick: CONTACT_TICK,
      targetId: 'target',
      attackRolls: { accuracy: options.accuracyRoll, critical: options.criticalRoll },
    },
    ...options.actorOverrides,
  })
  state = patchCombatant(state, 'target', {
    targetId: undefined,
    nextDecisionTick: 999_999,
    locomotionIntent: 'hold-range',
    facing: options.targetFacing ?? { x: -1, z: 0 },
    action: { type: 'neutral' },
    ...options.targetOverrides,
  })

  return { ...state, tick: CONTACT_TICK - 1 }
}

/** A bound defense already sitting in its own one-tick `contact` phase, aligned with `actor:0`'s contact. */
function boundDefense(definitionId: 'heavy-guard' | 'fast-evade' | 'technical-parry', overrides: Partial<Extract<CombatActionState, { type: 'active' }>> = {}): CombatActionState {
  return {
    type: 'active',
    instanceId: 'target:0',
    definitionId,
    phase: 'contact',
    phaseStartedTick: CONTACT_TICK,
    phaseEndsAtTick: CONTACT_TICK + 1,
    targetId: 'actor',
    reactingToActionId: 'actor:0',
    ...overrides,
  }
}

describe('advanceEncounterTick: contact resolution (Task 9) -- canonical outcome sequences', () => {
  it('miss: attack-missed(geometry) when the target is out of range', () => {
    const state = contactFixture({
      actorArchetype: 'fast',
      targetArchetype: 'fast',
      actionId: 'fast-slash',
      actorPosition: { x: 0, z: 0 },
      targetPosition: { x: 5, z: 0 },
      actorFacing: { x: 1, z: 0 },
      accuracyRoll: 0.1,
      criticalRoll: 0.9,
    })

    const { events } = advanceEncounterTick(state)
    const missBatch = events.filter((event) => event.type === 'attack-missed')

    expect(types(missBatch)).toEqual(['attack-missed'])
    expect(missBatch[0]).toMatchObject({ reason: 'geometry', actorId: 'actor', targetId: 'target' })
  })

  it('miss: attack-missed(geometry) when in range but outside the facing sector', () => {
    const state = contactFixture({
      actorArchetype: 'fast',
      targetArchetype: 'fast',
      actionId: 'fast-slash', // minimumFacingDot 0.4226, contactRange 0.9-1.35
      actorPosition: { x: 0, z: 0 },
      targetPosition: { x: 0, z: 1.0 }, // in range, but directly to the side
      actorFacing: { x: 1, z: 0 }, // dot(facing, towardTarget) = 0 < 0.4226
      accuracyRoll: 0.1,
      criticalRoll: 0.9,
    })

    const { events } = advanceEncounterTick(state)
    const missBatch = events.filter((event) => event.type === 'attack-missed')

    expect(types(missBatch)).toEqual(['attack-missed'])
    expect(missBatch[0]).toMatchObject({ reason: 'geometry' })
  })

  it('miss: attack-missed(accuracy) when geometry passes but the stored roll fails the clamped probability', () => {
    // fast-slash accuracy = clamp(0.8 + 0.06) = 0.86; roll 0.9 fails (0.9 < 0.86 is false).
    const state = contactFixture({
      actorArchetype: 'fast',
      targetArchetype: 'fast',
      actionId: 'fast-slash',
      actorPosition: { x: 0, z: 0 },
      targetPosition: { x: 1.0, z: 0 },
      actorFacing: { x: 1, z: 0 },
      accuracyRoll: 0.9,
      criticalRoll: 0.9,
    })

    const { events } = advanceEncounterTick(state)
    const missBatch = events.filter((event) => event.type === 'attack-missed')

    expect(types(missBatch)).toEqual(['attack-missed'])
    expect(missBatch[0]).toMatchObject({ reason: 'accuracy' })
  })

  it('miss: attack-missed(target-unavailable) when the target is already defeated', () => {
    const state = contactFixture({
      actorArchetype: 'fast',
      targetArchetype: 'fast',
      actionId: 'fast-slash',
      actorPosition: { x: 0, z: 0 },
      targetPosition: { x: 1.0, z: 0 },
      actorFacing: { x: 1, z: 0 },
      accuracyRoll: 0.1,
      criticalRoll: 0.9,
      targetOverrides: { status: 'defeated', hp: 0 },
    })

    const { events } = advanceEncounterTick(state)
    const missBatch = events.filter((event) => event.type === 'attack-missed')

    expect(types(missBatch)).toEqual(['attack-missed'])
    expect(missBatch[0]).toMatchObject({ reason: 'target-unavailable' })
  })

  it('evade: a bound Fast evade whose final geometry lands outside the attack range emits attack-evaded only', () => {
    const state = contactFixture({
      actorArchetype: 'fast',
      targetArchetype: 'fast',
      actionId: 'fast-slash',
      actorPosition: { x: 0, z: 0 },
      targetPosition: { x: 5, z: 0 }, // outside contactRange 0.9-1.35: the dash succeeded
      actorFacing: { x: 1, z: 0 },
      accuracyRoll: 0.1,
      criticalRoll: 0.9,
      // `locomotionIntent` is deliberately set to a direction that does NOT
      // match rankEvadeDirections(0.1)'s primary ('circle-left') -- Task 9
      // review finding 2: `evadeIntent` previously read
      // `targetLive.locomotionIntent` directly, which nothing ever set to
      // the evade's actual dashed direction, so a fixture that happened to
      // set `locomotionIntent` to the "right" answer masked the bug. This
      // only passes if `evadeIntent` genuinely derives from `defenseRoll`
      // via `selectEvadeDirection`, not from `locomotionIntent`.
      targetOverrides: { locomotionIntent: 'advance', action: boundDefense('fast-evade', { defenseRoll: { direction: 0.1 } }) },
    })

    const { events } = advanceEncounterTick(state)
    const evadeBatch = events.filter((event) => event.type === 'attack-evaded' || event.type === 'defense-failed')

    expect(types(evadeBatch)).toEqual(['attack-evaded'])
    // roll 0.1 ranks 'circle-left' first; freeArena is large enough that it's
    // never blocked from (5,0), so selectEvadeDirection resolves to it too.
    expect(evadeBatch[0]).toMatchObject({ evadeIntent: 'circle-left', actorId: 'actor', targetId: 'target' })
  })

  it('failed evade into hit: defense-failed(geometry) -> damage-dealt -> fighter-staggered', () => {
    const state = contactFixture({
      actorArchetype: 'fast',
      targetArchetype: 'fast',
      actionId: 'fast-slash',
      actorPosition: { x: 0, z: 0 },
      targetPosition: { x: 1.0, z: 0 }, // still inside contactRange: the dash failed
      actorFacing: { x: 1, z: 0 },
      accuracyRoll: 0.1, // passes: clamp(0.8+0.06)=0.86
      criticalRoll: 0.9,
      targetOverrides: { action: boundDefense('fast-evade', { defenseRoll: { direction: 0.1 } }) },
    })

    const { events } = advanceEncounterTick(state)
    const batch = events.filter((event) => ['defense-failed', 'attack-missed', 'damage-dealt', 'fighter-staggered'].includes(event.type))

    expect(types(batch)).toEqual(['defense-failed', 'damage-dealt', 'fighter-staggered'])
    expect(batch[0]).toMatchObject({ reason: 'geometry', defenderId: 'target', attackerId: 'actor' })
  })

  it('failed evade into ordinary miss: defense-failed(geometry) -> attack-missed(accuracy)', () => {
    const state = contactFixture({
      actorArchetype: 'fast',
      targetArchetype: 'fast',
      actionId: 'fast-slash',
      actorPosition: { x: 0, z: 0 },
      targetPosition: { x: 1.0, z: 0 },
      actorFacing: { x: 1, z: 0 },
      accuracyRoll: 0.9, // fails
      criticalRoll: 0.9,
      targetOverrides: { action: boundDefense('fast-evade', { defenseRoll: { direction: 0.1 } }) },
    })

    const { events } = advanceEncounterTick(state)
    const batch = events.filter((event) => ['defense-failed', 'attack-missed', 'damage-dealt', 'fighter-staggered'].includes(event.type))

    expect(types(batch)).toEqual(['defense-failed', 'attack-missed'])
    expect(batch[1]).toMatchObject({ reason: 'accuracy' })
  })

  it('blocked hit: attack-blocked -> damage-dealt -> fighter-staggered, with guard damage/push/stagger multipliers exactly', () => {
    const state = contactFixture({
      actorArchetype: 'heavy',
      targetArchetype: 'heavy',
      actionId: 'heavy-cleave', // power20 * 1.75 * 1.00(neutral) = 35; push 0.70; staggerTicks 24
      actorPosition: { x: -1, z: 0 },
      targetPosition: { x: 0, z: 0 },
      actorFacing: { x: 1, z: 0 },
      accuracyRoll: 0.1, // clamp(0.8-0.06)=0.74; passes
      criticalRoll: 0.01,
      targetOverrides: { facing: { x: -1, z: 0 }, action: boundDefense('heavy-guard') }, // faces the actor: incoming-facing gate (>=0.3420) passes
    })

    const { state: next, events } = advanceEncounterTick(state)
    const batch = events.filter((event) => ['attack-blocked', 'damage-dealt', 'fighter-staggered', 'critical-hit'].includes(event.type))
    const blockBatch = batch

    expect(types(blockBatch)).toEqual(['attack-blocked', 'damage-dealt', 'fighter-staggered'])
    expect(blockBatch[0]).toMatchObject({ contactZone: 'shield' })
    expect(blockBatch[1]).toMatchObject({ amount: 12, remainingHp: 88, contactZone: 'shield' }) // round(35*0.35)=12.25->12
    expect(blockBatch[2]).toMatchObject({ durationTicks: 10 }) // max(1,round(24*0.40))=10
    expect((blockBatch[2] as Extract<EncounterEvent, { type: 'fighter-staggered' }>).direction.x).toBeCloseTo(1, 9)

    expect(next.combatants.target.hp).toBe(88)
    // push 0.70 * 0.30 = 0.21 away from the actor (toward +x); no separation correction needed at this distance.
    expect(next.combatants.target.position.x).toBeCloseTo(0.21, 6)
  })

  it('blocked hit and critical are mutually exclusive: a passing guard suppresses critical-hit even against an open target', () => {
    const state = contactFixture({
      actorArchetype: 'heavy',
      targetArchetype: 'heavy',
      actionId: 'heavy-cleave',
      actorPosition: { x: -1, z: 0 },
      targetPosition: { x: 0, z: 0 },
      actorFacing: { x: 1, z: 0 },
      accuracyRoll: 0.1,
      criticalRoll: 0.01, // would win a critical roll (< 0.1 criticalChance) if unblocked
      targetOverrides: {
        facing: { x: -1, z: 0 },
        staggerUntilTick: CONTACT_TICK + 5, // "open" in the snapshot
        action: boundDefense('heavy-guard'),
      },
    })

    const { events } = advanceEncounterTick(state)

    expect(events.some((event) => event.type === 'critical-hit')).toBe(false)
    expect(events.some((event) => event.type === 'attack-blocked')).toBe(true)
  })

  it('guard facing-gate failure: defense-failed(facing) -> ordinary (unblocked) damage-dealt -> fighter-staggered', () => {
    const state = contactFixture({
      actorArchetype: 'heavy',
      targetArchetype: 'heavy',
      actionId: 'heavy-cleave',
      actorPosition: { x: -1, z: 0 },
      targetPosition: { x: 0, z: 0 },
      actorFacing: { x: 1, z: 0 },
      accuracyRoll: 0.1,
      criticalRoll: 0.9,
      // Defender faces away from the actor: dot(defenderFacing, towardActor) = dot((0,1),(-1,0)) = 0 < 0.3420.
      targetOverrides: { facing: { x: 0, z: 1 }, action: boundDefense('heavy-guard') },
    })

    const { state: next, events } = advanceEncounterTick(state)
    const batch = events.filter((event) => ['defense-failed', 'attack-blocked', 'damage-dealt', 'fighter-staggered'].includes(event.type))

    expect(types(batch)).toEqual(['defense-failed', 'damage-dealt', 'fighter-staggered'])
    expect(batch[0]).toMatchObject({ reason: 'facing' })
    expect(batch[1]).toMatchObject({ amount: 35, remainingHp: 65 }) // unblocked: round(20*1.75*1.00)=35
    expect(next.combatants.target.hp).toBe(65)
  })

  it('parry: attack-parried -> fighter-staggered(attacker, 24 ticks), no damage-dealt, and queues the defender\'s forced counter', () => {
    const state = contactFixture({
      actorArchetype: 'technical',
      targetArchetype: 'technical',
      actionId: 'technical-thrust', // parryable, contactRange 1.2-2.8, minimumFacingDot 0.9397 (~20°)
      actorPosition: { x: -2, z: 0 },
      targetPosition: { x: 0, z: 0 },
      actorFacing: { x: 1, z: 0 },
      accuracyRoll: 0.1,
      criticalRoll: 0.9,
      targetOverrides: { facing: { x: -1, z: 0 }, action: boundDefense('technical-parry') }, // wide gate (>= -0.1736): passes
    })

    const { state: next, events } = advanceEncounterTick(state)
    const parryBatch = events.filter((event) => ['attack-parried', 'damage-dealt', 'fighter-staggered'].includes(event.type))

    expect(types(parryBatch)).toEqual(['attack-parried', 'fighter-staggered'])
    expect(parryBatch[0]).toMatchObject({ actorId: 'actor', defenderId: 'target', contactZone: 'weapon' })
    expect(parryBatch[1]).toMatchObject({ combatantId: 'actor', sourceId: 'target', durationTicks: 24 })

    expect(next.combatants.actor.hp).toBe(100) // parry cancels damage entirely
    expect(next.combatants.actor.staggerUntilTick).toBe(CONTACT_TICK + 24)
    expect(next.combatants.target.forcedActionId).toBe('technical-parry-counter')
  })

  it('opening-only critical: critical-hit -> damage-dealt -> fighter-staggered against a target in recovery in the snapshot', () => {
    const state = contactFixture({
      actorArchetype: 'fast',
      targetArchetype: 'fast',
      actionId: 'fast-slash',
      actorPosition: { x: 0, z: 0 },
      targetPosition: { x: 1.0, z: 0 },
      actorFacing: { x: 1, z: 0 },
      accuracyRoll: 0.1,
      criticalRoll: 0.05, // < criticalChance 0.1
      targetOverrides: {
        action: {
          type: 'active',
          instanceId: 'target:0',
          definitionId: 'fast-slash',
          phase: 'recovery',
          phaseStartedTick: CONTACT_TICK - 1,
          phaseEndsAtTick: CONTACT_TICK + 100,
          targetId: 'actor',
        },
      },
    })

    const { events } = advanceEncounterTick(state)
    const batch = events.filter((event) => ['critical-hit', 'damage-dealt', 'fighter-staggered'].includes(event.type))
    const criticalBatch = batch

    expect(types(criticalBatch)).toEqual(['critical-hit', 'damage-dealt', 'fighter-staggered'])
    expect(criticalBatch[0]).toMatchObject({ multiplier: 1.5 })
    expect(criticalBatch[1]).toMatchObject({ amount: 24 }) // round(20*0.80*1.00*1.5)=24 (fast-slash multiplier tuned 0.75->0.80 in Task 13)
  })

  it('no critical when the target was not open in the snapshot, even with a winning critical roll', () => {
    const state = contactFixture({
      actorArchetype: 'fast',
      targetArchetype: 'fast',
      actionId: 'fast-slash',
      actorPosition: { x: 0, z: 0 },
      targetPosition: { x: 1.0, z: 0 },
      actorFacing: { x: 1, z: 0 },
      accuracyRoll: 0.1,
      criticalRoll: 0.01, // would win if the target were open
      // target.action: neutral, staggerUntilTick 0 -- not open.
    })

    const { events } = advanceEncounterTick(state)

    expect(events.some((event) => event.type === 'critical-hit')).toBe(false)
    expect(events.some((event) => event.type === 'damage-dealt')).toBe(true)
  })

  it('no critical when the target was open but the critical roll fails', () => {
    const state = contactFixture({
      actorArchetype: 'fast',
      targetArchetype: 'fast',
      actionId: 'fast-slash',
      actorPosition: { x: 0, z: 0 },
      targetPosition: { x: 1.0, z: 0 },
      actorFacing: { x: 1, z: 0 },
      accuracyRoll: 0.1,
      criticalRoll: 0.5, // >= criticalChance 0.1
      targetOverrides: { staggerUntilTick: CONTACT_TICK + 5 },
    })

    const { events } = advanceEncounterTick(state)

    expect(events.some((event) => event.type === 'critical-hit')).toBe(false)
    expect(events.some((event) => event.type === 'damage-dealt')).toBe(true)
  })

  it('critical defeat: critical-hit -> damage-dealt -> fighter-staggered -> fighter-defeated -> encounter-finished (Task 10: completion only after contact effects persist)', () => {
    const state = contactFixture({
      actorArchetype: 'fast',
      targetArchetype: 'fast',
      actionId: 'fast-slash',
      actorPosition: { x: 0, z: 0 },
      targetPosition: { x: 1.0, z: 0 },
      actorFacing: { x: 1, z: 0 },
      accuracyRoll: 0.1,
      criticalRoll: 0.05,
      targetOverrides: { hp: 1, staggerUntilTick: CONTACT_TICK + 5 },
    })

    const { state: next, events } = advanceEncounterTick(state)
    const criticalDefeatBatch = events.filter((event) => ['critical-hit', 'damage-dealt', 'fighter-staggered', 'fighter-defeated', 'encounter-finished'].includes(event.type))

    expect(types(criticalDefeatBatch)).toEqual(['critical-hit', 'damage-dealt', 'fighter-staggered', 'fighter-defeated', 'encounter-finished'])
    expect(criticalDefeatBatch[3]).toMatchObject({ defeatedId: 'target', sourceId: 'actor' })
    // The finished event's payload reflects post-contact HP/status: 'target' is
    // already 0 hp / defeated by the time completion resolves, and only
    // 'actor' -- the sole remaining living combatant -- survives and wins.
    expect(criticalDefeatBatch[4]).toMatchObject({
      type: 'encounter-finished',
      reason: 'no-hostile-pairs',
      durationTicks: CONTACT_TICK,
      survivorIds: ['actor'],
      winnerIds: ['actor'],
      winningFactionIds: ['home'],
    })
    expect(next.combatants.target.status).toBe('defeated')
    expect(next.combatants.target.hp).toBe(0)
    expect(next.phase).toBe('finished')
    expect(next.result).toMatchObject({ reason: 'no-hostile-pairs', survivorIds: ['actor'] })
  })

  it('action-interrupted: an ordinary hit cancels the target\'s own unrelated windup, in damage-dealt -> action-interrupted -> fighter-staggered order', () => {
    const state = contactFixture({
      actorArchetype: 'fast',
      targetArchetype: 'fast',
      actionId: 'fast-slash',
      actorPosition: { x: 0, z: 0 },
      targetPosition: { x: 1.0, z: 0 },
      actorFacing: { x: 1, z: 0 },
      accuracyRoll: 0.1,
      criticalRoll: 0.9,
      targetOverrides: {
        action: {
          type: 'active',
          instanceId: 'target:0',
          definitionId: 'fast-slash',
          phase: 'windup',
          phaseStartedTick: CONTACT_TICK - 1,
          phaseEndsAtTick: CONTACT_TICK + 50,
          targetId: 'actor',
          attackRolls: { accuracy: 0.5, critical: 0.5 },
        },
      },
    })

    const { state: next, events } = advanceEncounterTick(state)
    const batch = events.filter((event) => ['damage-dealt', 'action-interrupted', 'fighter-staggered'].includes(event.type))

    expect(types(batch)).toEqual(['damage-dealt', 'action-interrupted', 'fighter-staggered'])
    expect(batch[1]).toMatchObject({ actorId: 'target', actionInstanceId: 'target:0', reason: 'stagger' })
    expect(next.combatants.target.action).toEqual({ type: 'neutral' })
  })
})

describe('advanceEncounterTick: contact resolution -- snapshot discipline and total ordering', () => {
  it('non-lethal stagger from an earlier (higher-priority) intent does not cancel a target\'s own already-in-contact action this same tick', () => {
    // A (fast-slash, priority 40) hits B non-lethally; B's own contact-phase
    // action (heavy-cleave, priority 10, bound at C) must still resolve
    // fully afterward -- proving "contact" phase is exempt from
    // interruption, unlike windup/impact/recovery.
    const created = createEncounter({
      seed: 1,
      combatants: [
        combatant('a', 'home', { archetype: 'fast', startPosition: { x: -1, z: 0 } }),
        combatant('b', 'fast-side', { archetype: 'fast', startPosition: { x: 0, z: 0 } }),
        combatant('c', 'away', { archetype: 'heavy', startPosition: { x: 1.2, z: 0 }, fighter: { maxHp: 500 } }),
      ],
      arena: freeArena,
      hostility: { mode: 'free-for-all' },
      combatStyles: COMBAT_STYLES,
    })

    let state = patchCombatant(created.state, 'a', {
      targetId: undefined,
      nextDecisionTick: 999_999,
      facing: { x: 1, z: 0 },
      action: {
        type: 'active',
        instanceId: 'a:0',
        definitionId: 'fast-slash',
        phase: 'windup',
        phaseStartedTick: CONTACT_TICK - 1,
        phaseEndsAtTick: CONTACT_TICK,
        targetId: 'b',
        attackRolls: { accuracy: 0.1, critical: 0.9 },
      },
    })
    state = patchCombatant(state, 'b', {
      targetId: undefined,
      nextDecisionTick: 999_999,
      facing: { x: 1, z: 0 },
      action: {
        type: 'active',
        instanceId: 'b:0',
        definitionId: 'heavy-cleave',
        phase: 'windup',
        phaseStartedTick: CONTACT_TICK - 1,
        phaseEndsAtTick: CONTACT_TICK,
        targetId: 'c',
        attackRolls: { accuracy: 0.1, critical: 0.9 },
      },
    })
    state = patchCombatant(state, 'c', { targetId: undefined, nextDecisionTick: 999_999, locomotionIntent: 'hold-range', facing: { x: -1, z: 0 } })
    state = { ...state, tick: CONTACT_TICK - 1 }

    const { state: next, events } = advanceEncounterTick(state)

    // A's hit against B resolves first (priority 40 > 10) and staggers B non-lethally.
    const bStagger = events.find((event) => event.type === 'fighter-staggered' && event.combatantId === 'b')
    expect(bStagger).toBeDefined()

    // B's own attack against C still resolves as an ordinary hit: not skipped, not "action-interrupted".
    const cDamage = events.find((event) => event.type === 'damage-dealt' && event.actorId === 'b' && event.targetId === 'c')
    expect(cDamage).toBeDefined()
    expect(events.some((event) => event.type === 'action-interrupted' && event.actorId === 'b')).toBe(false)

    // B's own action was in `contact` throughout this tick's resolution and is untouched by contact resolution itself
    // (phase 1 will advance it to `impact` on the *next* tick, per the ordinary phase machine).
    expect(next.combatants.b.action).toMatchObject({ phase: 'contact', instanceId: 'b:0' })
  })

  it('total order by priority: a mid-batch defeat produces target-unavailable for a later (lower-priority) intent against the same victim', () => {
    // Two attackers target the same victim this tick. The higher-priority
    // attack (fast-slash, 40) defeats the victim outright; the
    // lower-priority attack (heavy-cleave, 10) against the same
    // now-defeated victim must resolve as target-unavailable, never a
    // second damage-dealt/defeat.
    const created = createEncounter({
      seed: 1,
      combatants: [
        combatant('a1', 'home', { archetype: 'fast', startPosition: { x: -1, z: 0 } }),
        combatant('a2', 'home', { archetype: 'heavy', startPosition: { x: 0, z: -1 } }),
        combatant('v', 'away', { archetype: 'fast', startPosition: { x: 0, z: 0 }, fighter: { maxHp: 1 } }),
      ],
      arena: freeArena,
      hostility: { mode: 'free-for-all' },
      combatStyles: COMBAT_STYLES,
    })

    let state = patchCombatant(created.state, 'a1', {
      targetId: undefined,
      nextDecisionTick: 999_999,
      facing: { x: 1, z: 0 },
      action: {
        type: 'active',
        instanceId: 'a1:0',
        definitionId: 'fast-slash', // priority 40
        phase: 'windup',
        phaseStartedTick: CONTACT_TICK - 1,
        phaseEndsAtTick: CONTACT_TICK,
        targetId: 'v',
        attackRolls: { accuracy: 0.1, critical: 0.9 },
      },
    })
    state = patchCombatant(state, 'a2', {
      targetId: undefined,
      nextDecisionTick: 999_999,
      facing: { x: 0, z: 1 },
      action: {
        type: 'active',
        instanceId: 'a2:0',
        definitionId: 'heavy-cleave', // priority 10
        phase: 'windup',
        phaseStartedTick: CONTACT_TICK - 1,
        phaseEndsAtTick: CONTACT_TICK,
        targetId: 'v',
        attackRolls: { accuracy: 0.1, critical: 0.9 },
      },
    })
    state = patchCombatant(state, 'v', { targetId: undefined, nextDecisionTick: 999_999, locomotionIntent: 'hold-range' })
    state = { ...state, tick: CONTACT_TICK - 1 }

    const { state: next, events } = advanceEncounterTick(state)

    const relevant = events.filter((event) => event.type === 'damage-dealt' || event.type === 'fighter-defeated' || event.type === 'attack-missed')
    expect(relevant.map((event) => event.type)).toEqual(['damage-dealt', 'fighter-defeated', 'attack-missed'])
    expect(relevant[2]).toMatchObject({ actorId: 'a2', reason: 'target-unavailable' })
    expect(next.combatants.v.status).toBe('defeated')
  })

  it('priority/time-limit ties never consume combatant streams: two equal-priority intents sort by derivedUnitValue(seed, tick, actionInstanceId), then break ties by ActionInstanceId', () => {
    // Two independent fast-slash intents (equal priority 40) against two
    // separate, unreachable-by-each-other targets, so their outcomes don't
    // causally interact -- only the *order* of their events proves the sort.
    const created = createEncounter({
      seed: 9,
      combatants: [
        combatant('a1', 'home', { archetype: 'fast', startPosition: { x: -1, z: 0 } }),
        combatant('a2', 'home', { archetype: 'fast', startPosition: { x: -1, z: 10 } }),
        combatant('t1', 'away', { archetype: 'fast', startPosition: { x: 0, z: 0 } }),
        combatant('t2', 'away', { archetype: 'fast', startPosition: { x: 0, z: 10 } }),
      ],
      arena: freeArena,
      hostility: { mode: 'free-for-all' },
      combatStyles: COMBAT_STYLES,
    })

    function attackAction(instanceId: string, targetId: string): CombatActionState {
      return {
        type: 'active',
        instanceId,
        definitionId: 'fast-slash',
        phase: 'windup',
        phaseStartedTick: CONTACT_TICK - 1,
        phaseEndsAtTick: CONTACT_TICK,
        targetId,
        attackRolls: { accuracy: 0.1, critical: 0.9 },
      }
    }

    let state = patchCombatant(created.state, 'a1', {
      targetId: undefined,
      nextDecisionTick: 999_999,
      facing: { x: 1, z: 0 },
      action: attackAction('a1:0', 't1'),
    })
    state = patchCombatant(state, 'a2', {
      targetId: undefined,
      nextDecisionTick: 999_999,
      facing: { x: 1, z: 0 },
      action: attackAction('a2:0', 't2'),
    })
    state = patchCombatant(state, 't1', { targetId: undefined, nextDecisionTick: 999_999, locomotionIntent: 'hold-range' })
    state = patchCombatant(state, 't2', { targetId: undefined, nextDecisionTick: 999_999, locomotionIntent: 'hold-range' })
    state = { ...state, tick: CONTACT_TICK - 1 }

    const tieKeyA1 = derivedUnitValue(9, `contact-tie:${CONTACT_TICK}:a1:0`)
    const tieKeyA2 = derivedUnitValue(9, `contact-tie:${CONTACT_TICK}:a2:0`)
    expect(tieKeyA1).not.toBe(tieKeyA2) // both must actually tie-break through tieKey, not coincide

    const { events } = advanceEncounterTick(state)
    const damageEvents = events.filter((event): event is Extract<EncounterEvent, { type: 'damage-dealt' }> => event.type === 'damage-dealt')
    expect(damageEvents).toHaveLength(2)

    const expectedFirstActor = tieKeyA1 < tieKeyA2 ? 'a1' : 'a2'
    expect(damageEvents[0].actorId).toBe(expectedFirstActor)
  })

  it('a three-way priority tie (design.md: "even when three or more intents share priority") sorts all three purely by tieKey', () => {
    const created = createEncounter({
      seed: 9,
      combatants: [
        combatant('a1', 'home', { archetype: 'fast', startPosition: { x: -1, z: 0 } }),
        combatant('a2', 'home', { archetype: 'fast', startPosition: { x: -1, z: 10 } }),
        combatant('a3', 'home', { archetype: 'fast', startPosition: { x: -1, z: 20 } }),
        combatant('t1', 'away', { archetype: 'fast', startPosition: { x: 0, z: 0 } }),
        combatant('t2', 'away', { archetype: 'fast', startPosition: { x: 0, z: 10 } }),
        combatant('t3', 'away', { archetype: 'fast', startPosition: { x: 0, z: 20 } }),
      ],
      arena: freeArena,
      hostility: { mode: 'free-for-all' },
      combatStyles: COMBAT_STYLES,
    })

    function attackAction(instanceId: string, targetId: string): CombatActionState {
      return {
        type: 'active',
        instanceId,
        definitionId: 'fast-slash', // priority 40 for all three: a genuine three-way tie
        phase: 'windup',
        phaseStartedTick: CONTACT_TICK - 1,
        phaseEndsAtTick: CONTACT_TICK,
        targetId,
        attackRolls: { accuracy: 0.1, critical: 0.9 },
      }
    }

    let state = created.state
    for (const [actorId, targetId] of [
      ['a1', 't1'],
      ['a2', 't2'],
      ['a3', 't3'],
    ] as const) {
      state = patchCombatant(state, actorId, { targetId: undefined, nextDecisionTick: 999_999, facing: { x: 1, z: 0 }, action: attackAction(`${actorId}:0`, targetId) })
      state = patchCombatant(state, targetId, { targetId: undefined, nextDecisionTick: 999_999, locomotionIntent: 'hold-range' })
    }
    state = { ...state, tick: CONTACT_TICK - 1 }

    const tieKeys: Record<string, number> = {
      a1: derivedUnitValue(9, `contact-tie:${CONTACT_TICK}:a1:0`),
      a2: derivedUnitValue(9, `contact-tie:${CONTACT_TICK}:a2:0`),
      a3: derivedUnitValue(9, `contact-tie:${CONTACT_TICK}:a3:0`),
    }
    const distinctTieKeys = new Set(Object.values(tieKeys))
    expect(distinctTieKeys.size).toBe(3) // all three must genuinely tie-break through tieKey, not coincide

    const { events } = advanceEncounterTick(state)
    const damageEvents = events.filter((event): event is Extract<EncounterEvent, { type: 'damage-dealt' }> => event.type === 'damage-dealt')
    expect(damageEvents).toHaveLength(3)

    const expectedOrder = (['a1', 'a2', 'a3'] as const).slice().sort((a, b) => tieKeys[a] - tieKeys[b])
    expect(damageEvents.map((event) => event.actorId)).toEqual(expectedOrder)
  })
})

describe('sortContactIntents', () => {
  function intent(actionInstanceId: string, priority: number, tieKey: number): ContactIntent {
    return { actorId: actionInstanceId.split(':')[0], targetId: 'x', actionInstanceId, actionId: 'fast-slash', priority, tieKey }
  }

  it('colliding tieKey falls back to ascending ActionInstanceId as the final tiebreak (Task 9 review: minor test gap)', () => {
    // `derivedUnitValue`'s continuous float distribution cannot realistically
    // be coaxed into colliding through the public tick API, so this exercises
    // the fallback branch directly with a synthetic collision.
    const intents = [intent('b:3', 40, 0.5), intent('a:9', 40, 0.5), intent('a:2', 40, 0.5)]

    const sorted = sortContactIntents(intents)

    expect(sorted.map((i) => i.actionInstanceId)).toEqual(['a:2', 'a:9', 'b:3'])
  })

  it('sorts strictly by descending priority first, regardless of tieKey or ActionInstanceId', () => {
    const intents = [intent('low:0', 10, 0.1), intent('high:0', 40, 0.9)]

    const sorted = sortContactIntents(intents)

    expect(sorted.map((i) => i.actionInstanceId)).toEqual(['high:0', 'low:0'])
  })
})

describe('advanceEncounterTick: shield jab is unparryable (defense-in-depth at resolution, not only at scheduling)', () => {
  it('ignores a (mis-)bound technical-parry against an unparryable heavy-shield-jab and resolves an ordinary unblocked hit', () => {
    const state = contactFixture({
      actorArchetype: 'heavy',
      targetArchetype: 'technical',
      actionId: 'heavy-shield-jab', // tags: unparryable
      actorPosition: { x: -1, z: 0 },
      targetPosition: { x: 0, z: 0 },
      actorFacing: { x: 1, z: 0 },
      accuracyRoll: 0.1, // clamp(0.8+0.08)=0.88
      criticalRoll: 0.9,
      targetOverrides: { facing: { x: -1, z: 0 }, action: boundDefense('technical-parry') }, // gate would pass if it were parryable
    })

    const { events } = advanceEncounterTick(state)
    const batch = events.filter((event) => ['attack-parried', 'attack-blocked', 'damage-dealt', 'fighter-staggered'].includes(event.type))

    expect(types(batch)).toEqual(['damage-dealt', 'fighter-staggered'])
  })

  it('a shield jab can still miss by range like any other attack', () => {
    const state = contactFixture({
      actorArchetype: 'heavy',
      targetArchetype: 'technical',
      actionId: 'heavy-shield-jab',
      actorPosition: { x: -5, z: 0 },
      targetPosition: { x: 0, z: 0 },
      actorFacing: { x: 1, z: 0 },
      accuracyRoll: 0.1,
      criticalRoll: 0.9,
    })

    const { events } = advanceEncounterTick(state)
    expect(types(events.filter((event) => event.type === 'attack-missed'))).toEqual(['attack-missed'])
  })
})

describe('advanceEncounterTick: accumulated push (phase 10)', () => {
  it('sums push vectors from two hits landing on the same target this tick, applied once through the ordinary movement pipeline', () => {
    const created = createEncounter({
      seed: 1,
      combatants: [
        combatant('a1', 'home', { archetype: 'fast', startPosition: { x: -1.0, z: 0 } }),
        combatant('a2', 'home', { archetype: 'fast', startPosition: { x: 0, z: -1.0 } }),
        combatant('v', 'away', { archetype: 'fast', startPosition: { x: 0, z: 0 }, fighter: { maxHp: 500 } }),
      ],
      arena: freeArena,
      hostility: { mode: 'free-for-all' },
      combatStyles: COMBAT_STYLES,
    })

    function slash(targetId: string, instanceId: string): CombatActionState {
      return {
        type: 'active',
        instanceId,
        definitionId: 'fast-slash',
        phase: 'windup',
        phaseStartedTick: CONTACT_TICK - 1,
        phaseEndsAtTick: CONTACT_TICK,
        targetId,
        attackRolls: { accuracy: 0.1, critical: 0.9 },
      }
    }

    let state = patchCombatant(created.state, 'a1', { targetId: undefined, nextDecisionTick: 999_999, facing: { x: 1, z: 0 }, action: slash('v', 'a1:0') })
    state = patchCombatant(state, 'a2', { targetId: undefined, nextDecisionTick: 999_999, facing: { x: 0, z: 1 }, action: slash('v', 'a2:0') })
    state = patchCombatant(state, 'v', { targetId: undefined, nextDecisionTick: 999_999, locomotionIntent: 'hold-range' })
    state = { ...state, tick: CONTACT_TICK - 1 }

    const { state: next, events } = advanceEncounterTick(state)

    expect(events.filter((event) => event.type === 'damage-dealt')).toHaveLength(2)
    // fast-slash pushDistance 0.18; a1 pushes v toward +x, a2 pushes v toward +z. No separation correction expected at this distance.
    expect(next.combatants.v.position.x).toBeCloseTo(0.18, 6)
    expect(next.combatants.v.position.z).toBeCloseTo(0.18, 6)
  })
})

describe('advanceEncounterTick: motion diagnostics -- velocity/travelledDistance reflect the tick total (Task 9 review finding 1)', () => {
  it('a combatant that only walks (never pushed) ends the tick with a non-zero velocity matching its actual displacement x TICKS_PER_SECOND', () => {
    // Regression guard: phase 10 (`applyAccumulatedPush`) used to call the
    // same position-mutating helper phase 8 does, which unconditionally
    // overwrote `velocity` -- including with `{0,0}` for the overwhelming
    // majority of combatants who receive zero push on a given tick, silently
    // discarding phase 8's correct locomotion velocity.
    const created = createEncounter({
      seed: 1,
      combatants: [
        combatant('self', 'home', { archetype: 'fast', startPosition: { x: 0, z: 0 } }),
        combatant('other', 'away', { archetype: 'fast', startPosition: { x: 20, z: 0 } }),
      ],
      arena: freeArena,
      hostility: { mode: 'different-factions' },
      combatStyles: COMBAT_STYLES,
    })
    let state = patchCombatant(created.state, 'self', {
      targetId: undefined,
      nextDecisionTick: 999_999,
      facing: { x: 1, z: 0 },
      locomotionIntent: 'advance',
      action: { type: 'neutral' },
    })
    state = patchCombatant(state, 'other', { targetId: undefined, nextDecisionTick: 999_999 })
    state = { ...state, tick: 5 }

    const { state: next } = advanceEncounterTick(state)

    const dx = next.combatants.self.position.x - 0
    const dz = next.combatants.self.position.z - 0
    expect(dx).toBeGreaterThan(0) // sanity: locomotion actually moved it this tick
    // fast's forwardUnitsPerSecond is 2.4: displacement x TICKS_PER_SECOND(60) collapses back to exactly the style speed.
    expect(next.combatants.self.velocity.x).toBeCloseTo(2.4, 9)
    expect(next.combatants.self.velocity.z).toBeCloseTo(0, 9)
    expect(next.combatants.self.velocity).toEqual({ x: dx * 60, z: dz * 60 })
  })

  it('a combatant both walking and pushed in the same tick reports the combined displacement, not just the push', () => {
    const created = createEncounter({
      seed: 1,
      combatants: [
        combatant('attacker', 'home', { archetype: 'fast', startPosition: { x: -1, z: 0 } }),
        combatant('v', 'away', { archetype: 'fast', startPosition: { x: 0, z: 0 } }),
      ],
      arena: freeArena,
      hostility: { mode: 'free-for-all' },
      combatStyles: COMBAT_STYLES,
    })

    let state = patchCombatant(created.state, 'attacker', {
      targetId: undefined,
      nextDecisionTick: 999_999,
      facing: { x: 1, z: 0 },
      action: {
        type: 'active',
        instanceId: 'attacker:0',
        definitionId: 'fast-slash',
        phase: 'windup',
        phaseStartedTick: CONTACT_TICK - 1,
        phaseEndsAtTick: CONTACT_TICK,
        targetId: 'v',
        attackRolls: { accuracy: 0.1, critical: 0.9 },
      },
    })
    // 'v' has no target of its own (facing never turns) and retreats along
    // the same axis the push lands on (+x, away from 'attacker') so the
    // combination is an exact colinear sum, not entangled with push
    // direction being recomputed from v's already-shifted post-locomotion
    // position (which a perpendicular locomotion axis would introduce as a
    // small off-axis coupling term).
    state = patchCombatant(state, 'v', { targetId: undefined, nextDecisionTick: 999_999, facing: { x: 1, z: 0 }, locomotionIntent: 'retreat' })
    state = { ...state, tick: CONTACT_TICK - 1 }

    const { state: next, events } = advanceEncounterTick(state)

    expect(events.some((event) => event.type === 'damage-dealt')).toBe(true)
    const dx = next.combatants.v.position.x - 0
    const dz = next.combatants.v.position.z - 0
    // retreat (fast backwardUnitsPerSecond 2.7, facing +x) alone gives velocity.x == -2.7;
    // push (fast-slash pushDistance 0.18, toward +x) alone gives velocity.x == 10.8.
    // The old bug would report exactly 10.8 (phase 10's own delta only, discarding phase 8's -2.7);
    // the fix reports the true combined net: -2.7 + 10.8 == 8.1.
    expect(next.combatants.v.velocity.x).toBeCloseTo(8.1, 9)
    expect(next.combatants.v.velocity.z).toBeCloseTo(0, 9)
    expect(next.combatants.v.velocity).toEqual({ x: dx * 60, z: dz * 60 })
  })

  it('a combatant that moves in phase 8 and is defeated in phase 9 still has that final movement captured, not frozen at stale values (Task 9 review round 3 regression)', () => {
    // `applyTickMotionDiagnostics` used to filter on *end-of-tick* status,
    // which is already 'defeated' for a fighter phase 9 just killed --
    // permanently skipping it forever after, since `resolveMovementConstraints`
    // no longer writes these fields itself. The fix filters on start-of-tick
    // status instead: this fighter was active for phase 8's movement and that
    // motion must be captured once, even though it dies later this same tick.
    const state = contactFixture({
      actorArchetype: 'fast',
      targetArchetype: 'fast',
      actionId: 'fast-slash', // round(20*0.75*1.00)=15, enough to defeat a 1-hp target
      actorPosition: { x: 0, z: 0 },
      targetPosition: { x: 1.0, z: 0 },
      actorFacing: { x: 1, z: 0 },
      accuracyRoll: 0.1,
      criticalRoll: 0.9, // no crit: an ordinary hit is enough to prove the regression
      targetOverrides: { hp: 1, facing: { x: 0, z: 1 }, locomotionIntent: 'advance' },
    })
    const startTravelledDistance = state.combatants.target.travelledDistance

    const { state: next, events } = advanceEncounterTick(state)

    expect(events.some((event) => event.type === 'fighter-defeated')).toBe(true)
    expect(next.combatants.target.status).toBe('defeated')
    // fast's forwardUnitsPerSecond is 2.4: this tick's own phase-8 'advance' displacement, not zero/stale.
    expect(next.combatants.target.velocity.z).toBeCloseTo(2.4, 9)
    expect(next.combatants.target.velocity.x).toBeCloseTo(0, 9)
    expect(next.combatants.target.travelledDistance).toBeGreaterThan(startTravelledDistance)
  })
})

describe('advanceEncounterTick: Fast evade windup dash (carried forward from Task 8)', () => {
  it('applies 0.9 + 0.3 * directionRoll distributed across the remaining windup ticks, reading the stored roll back without re-drawing', () => {
    const created = createEncounter({
      seed: 1,
      combatants: [
        combatant('self', 'away', { archetype: 'fast', startPosition: { x: 0, z: 0 } }),
        combatant('other', 'home', { archetype: 'fast', startPosition: { x: 20, z: 0 } }),
      ],
      arena: freeArena,
      hostility: { mode: 'different-factions' },
      combatStyles: COMBAT_STYLES,
    })

    // directionRoll 0.1 -> primary ranked direction 'circle-left' (bottom third).
    const directionRoll = 0.1
    let state = patchCombatant(created.state, 'self', {
      targetId: undefined,
      nextDecisionTick: 999_999,
      facing: { x: 1, z: 0 },
      action: {
        type: 'active',
        instanceId: 'self:0',
        definitionId: 'fast-evade',
        phase: 'windup',
        phaseStartedTick: 0,
        phaseEndsAtTick: 7, // fast's 7-tick reaction lead: 7 remaining windup ticks
        targetId: 'other',
        reactingToActionId: 'other:0',
        defenseRoll: { direction: directionRoll },
      },
    })
    state = patchCombatant(state, 'other', { targetId: undefined, nextDecisionTick: 999_999 })
    state = { ...state, tick: 1 } // still well inside windup (ends at 7): not a contact-resolution tick

    const { state: next } = advanceEncounterTick(state)

    const totalDistance = 0.9 + 0.3 * directionRoll
    const expectedStep = totalDistance / 7 // windupSpan = phaseEndsAtTick(7) - phaseStartedTick(0)
    expect(next.combatants.self.position.x).toBeCloseTo(0, 9)
    expect(next.combatants.self.position.z).toBeCloseTo(expectedStep, 9) // circle-left of facing (1,0) is +z
  })

  it('falls through to the second-ranked direction when the primary ranked direction is blocked by an arena boundary (Task 9 review finding 3)', () => {
    // Narrow lateral band (5), generous radius (30): from z=4.9, the primary
    // ranked direction ('circle-left', +z, roll 0.1) would land at z=5.83 --
    // past lateralLimit -- so `selectEvadeDirection` must fall through to
    // 'circle-right' (-z), which lands at z=3.97, well inside.
    const narrowArena = { radius: 30, lateralLimit: 5, minimumSeparation: 0.9, movementPolicy: 'free' as const }
    const created = createEncounter({
      seed: 1,
      combatants: [
        combatant('self', 'away', { archetype: 'fast', startPosition: { x: 0, z: 4.9 } }),
        combatant('other', 'home', { archetype: 'fast', startPosition: { x: 20, z: 4.9 } }),
      ],
      arena: narrowArena,
      hostility: { mode: 'different-factions' },
      combatStyles: COMBAT_STYLES,
    })

    const directionRoll = 0.1 // primary ranked direction is circle-left (+z), blocked from z=4.9
    let state = patchCombatant(created.state, 'self', {
      targetId: undefined,
      nextDecisionTick: 999_999,
      facing: { x: 1, z: 0 },
      action: {
        type: 'active',
        instanceId: 'self:0',
        definitionId: 'fast-evade',
        phase: 'windup',
        phaseStartedTick: 0,
        phaseEndsAtTick: 7,
        targetId: 'other',
        reactingToActionId: 'other:0',
        defenseRoll: { direction: directionRoll },
      },
    })
    state = patchCombatant(state, 'other', { targetId: undefined, nextDecisionTick: 999_999, locomotionIntent: 'hold-range' })
    state = { ...state, tick: 1 }

    const { state: next } = advanceEncounterTick(state)

    const totalDistance = 0.9 + 0.3 * directionRoll
    const expectedStep = totalDistance / 7
    expect(next.combatants.self.position.x).toBeCloseTo(0, 9)
    expect(next.combatants.self.position.z).toBeCloseTo(4.9 - expectedStep, 9) // circle-right (2nd ranked): -z, not +z
  })

  it('contributes zero displacement this tick when the arena boundary blocks all three ranked directions (Task 9 review finding 3)', () => {
    // Tiny radius (0.5), generous lateral band: every one of the three
    // ranked directions' full authored dash distance (0.93 for roll 0.1)
    // from self's position (-0.5, 0) lands outside the radius disk. `other`
    // sits diametrically opposite (distance 1.0, still > minimumSeparation
    // 0.9) so the separation solver never perturbs self's own zero-movement
    // result.
    const tinyArena = { radius: 0.5, lateralLimit: 5, minimumSeparation: 0.9, movementPolicy: 'free' as const }
    const created = createEncounter({
      seed: 1,
      combatants: [
        combatant('self', 'away', { archetype: 'fast', startPosition: { x: -0.5, z: 0 } }),
        combatant('other', 'home', { archetype: 'fast', startPosition: { x: 0.5, z: 0 } }),
      ],
      arena: tinyArena,
      hostility: { mode: 'different-factions' },
      combatStyles: COMBAT_STYLES,
    })

    const directionRoll = 0.1
    let state = patchCombatant(created.state, 'self', {
      targetId: undefined,
      nextDecisionTick: 999_999,
      facing: { x: 1, z: 0 },
      action: {
        type: 'active',
        instanceId: 'self:0',
        definitionId: 'fast-evade',
        phase: 'windup',
        phaseStartedTick: 0,
        phaseEndsAtTick: 7,
        targetId: 'other',
        reactingToActionId: 'other:0',
        defenseRoll: { direction: directionRoll },
      },
    })
    state = patchCombatant(state, 'other', { targetId: undefined, nextDecisionTick: 999_999, locomotionIntent: 'hold-range' })
    state = { ...state, tick: 1 }

    const { state: next } = advanceEncounterTick(state)

    expect(next.combatants.self.position).toEqual({ x: -0.5, z: 0 }) // the evade is "visibly attempted" but produces no net escape
  })

  it('a started bound evade that never leaves contact geometry resolves as an ordinary geometry-eligible defense-failed, not a crash or a free evade', () => {
    // Regression guard for reading defenseRoll back correctly even when the
    // dash's direction doesn't matter to the outcome (still inside range).
    const state = contactFixture({
      actorArchetype: 'fast',
      targetArchetype: 'fast',
      actionId: 'fast-slash',
      actorPosition: { x: 0, z: 0 },
      targetPosition: { x: 1.0, z: 0 },
      actorFacing: { x: 1, z: 0 },
      accuracyRoll: 0.1,
      criticalRoll: 0.9,
      targetOverrides: { action: boundDefense('fast-evade', { defenseRoll: { direction: 0.99 } }) },
    })

    const { events } = advanceEncounterTick(state)
    expect(events[0]).toMatchObject({ type: 'defense-failed', reason: 'geometry' })
  })
})

describe("advanceEncounterTick: Technical's forced parry-counter start (carried forward from Task 8)", () => {
  function forcedCounterFixture(otherPosition: Vec2): EncounterState {
    const created = createEncounter({
      seed: 1,
      combatants: [
        combatant('self', 'home', { archetype: 'technical', startPosition: { x: 0, z: 0 } }),
        combatant('other', 'away', { archetype: 'technical', startPosition: otherPosition }),
      ],
      arena: freeArena,
      hostility: { mode: 'different-factions' },
      combatStyles: COMBAT_STYLES,
    })
    let state = patchCombatant(created.state, 'self', {
      targetId: 'other', // the forced-start check reads this, unlike ordinary contact fixtures
      nextDecisionTick: 999_999,
      forcedActionId: 'technical-parry-counter',
      action: { type: 'neutral' },
    })
    state = patchCombatant(state, 'other', { targetId: undefined, nextDecisionTick: 999_999 })
    return { ...state, tick: 9 }
  }

  it('starts the forced counter (bypassing weighted selection) when the target remains within 2.3 units', () => {
    const state = forcedCounterFixture({ x: 2.0, z: 0 })
    const decisionStreamBefore = state.randomByCombatant.self.decision

    const { state: next, events } = advanceEncounterTick(state)

    expect(next.combatants.self.forcedActionId).toBeUndefined()
    expect(next.combatants.self.action).toMatchObject({ type: 'active', definitionId: 'technical-parry-counter', phase: 'windup', targetId: 'other' })
    expect(next.randomByCombatant.self.decision).toEqual(decisionStreamBefore) // no decision-stream draw: bypassed weighted selection
    expect(events).toContainEqual(expect.objectContaining({ type: 'action-started', actorId: 'self', actionId: 'technical-parry-counter' }))
  })

  it('clears the forced counter and falls back to ordinary weighted selection when the target is out of range', () => {
    const state = forcedCounterFixture({ x: 10, z: 0 }) // outside 2.3 units
    const decisionStreamBefore = state.randomByCombatant.self.decision

    const { state: next } = advanceEncounterTick(state)

    expect(next.combatants.self.forcedActionId).toBeUndefined()
    expect(next.combatants.self.action.type === 'neutral' || next.combatants.self.action.type === 'active').toBe(true)
    expect(next.randomByCombatant.self.decision).not.toEqual(decisionStreamBefore) // an ordinary decision ran instead
  })

  it('allowed counter miss: a started counter can still miss by geometry once ordinary movement drifts the target out of contactRange', () => {
    // The start check does not guarantee contact -- this directly exercises
    // the generic geometry-miss path with technical-parry-counter's own
    // contactRange (0.9-2.3), simulating movement drift during its windup.
    const state = contactFixture({
      actorArchetype: 'technical',
      targetArchetype: 'technical',
      actionId: 'technical-parry-counter',
      actorPosition: { x: 0, z: 0 },
      targetPosition: { x: 3.0, z: 0 }, // outside 0.9-2.3
      actorFacing: { x: 1, z: 0 },
      accuracyRoll: 0.1,
      criticalRoll: 0.9,
    })

    const { events } = advanceEncounterTick(state)
    expect(types(events.filter((event) => event.type === 'attack-missed'))).toEqual(['attack-missed'])
    expect(events.find((event) => event.type === 'attack-missed')).toMatchObject({ reason: 'geometry' })
  })
})

describe("advanceEncounterTick: forced parry-counter timing is pinned to the parry's own contact tick (Task 9 review finding 4)", () => {
  it("starts the counter's windup on (parry contact tick + 1), pre-empting the parry's own impact/recovery, landing its own contact well inside the attacker's 24-tick stagger", () => {
    const state = contactFixture({
      actorArchetype: 'technical',
      targetArchetype: 'technical',
      actionId: 'technical-thrust', // parryable, contactRange 1.2-2.8
      actorPosition: { x: -2, z: 0 },
      targetPosition: { x: 0, z: 0 }, // distance 2: within technical-thrust's range AND within the counter's 2.3-unit gate
      actorFacing: { x: 1, z: 0 },
      accuracyRoll: 0.1,
      criticalRoll: 0.9,
      targetOverrides: { targetId: 'actor', facing: { x: -1, z: 0 }, action: boundDefense('technical-parry') },
    })

    const { state: afterParry } = advanceEncounterTick(state) // tick CONTACT_TICK: parry resolves
    expect(afterParry.combatants.target.forcedActionId).toBe('technical-parry-counter')
    expect(afterParry.combatants.actor.staggerUntilTick).toBe(CONTACT_TICK + 24)
    // The parry's own action is untouched here -- still `contact` this same tick (phase 1 hasn't run again yet).
    expect(afterParry.combatants.target.action).toMatchObject({ definitionId: 'technical-parry', phase: 'contact' })

    const { state: afterCounterStart } = advanceEncounterTick(afterParry) // tick CONTACT_TICK + 1
    expect(afterCounterStart.combatants.target.forcedActionId).toBeUndefined()
    // Pre-empts whatever phase the parry's own action naturally reached this tick (would otherwise be `impact`):
    // the counter starts its own fresh windup immediately, not after 4 ticks of impact + 16 of recovery.
    expect(afterCounterStart.combatants.target.action).toMatchObject({
      type: 'active',
      definitionId: 'technical-parry-counter',
      phase: 'windup',
      phaseStartedTick: CONTACT_TICK + 1,
      phaseEndsAtTick: CONTACT_TICK + 1 + 8, // CONTACT_TICK + 9
    })
    expect(CONTACT_TICK + 9).toBeLessThan(CONTACT_TICK + 24) // comfortably inside the attacker's stagger window

    const { state: atCounterContact } = advanceEncounterTicks(afterCounterStart, 8) // advance to CONTACT_TICK + 9
    expect(atCounterContact.tick).toBe(CONTACT_TICK + 9)
    expect(atCounterContact.combatants.target.action).toMatchObject({ definitionId: 'technical-parry-counter', phase: 'contact' })
  })

  it("plays out the parry's own impact and recovery normally when the counter is cleared by distance, instead of being pre-empted", () => {
    const state = contactFixture({
      actorArchetype: 'technical',
      targetArchetype: 'technical',
      actionId: 'technical-thrust',
      actorPosition: { x: -2.5, z: 0 },
      targetPosition: { x: 0, z: 0 }, // distance 2.5: within technical-thrust's range (1.2-2.8) but past the counter's 2.3-unit gate
      actorFacing: { x: 1, z: 0 },
      accuracyRoll: 0.1,
      criticalRoll: 0.9,
      targetOverrides: { targetId: 'actor', facing: { x: -1, z: 0 }, action: boundDefense('technical-parry') },
    })

    const { state: afterParry, events } = advanceEncounterTick(state) // tick CONTACT_TICK: parry resolves
    expect(events.some((event) => event.type === 'attack-parried')).toBe(true)
    expect(afterParry.combatants.target.forcedActionId).toBe('technical-parry-counter')

    const { state: afterGateCheck } = advanceEncounterTick(afterParry) // tick CONTACT_TICK + 1: gate fails (2.5 > 2.3)
    expect(afterGateCheck.combatants.target.forcedActionId).toBeUndefined()
    // Left completely alone by the gate-fail branch: phase 1 already advanced it to `impact` on its own, ordinary schedule.
    expect(afterGateCheck.combatants.target.action).toMatchObject({
      definitionId: 'technical-parry',
      phase: 'impact',
      phaseStartedTick: CONTACT_TICK + 1,
      phaseEndsAtTick: CONTACT_TICK + 1 + 4, // technical-parry's authored impactTicks
    })

    const { state: atRecovery } = advanceEncounterTicks(afterGateCheck, 4) // advance to CONTACT_TICK + 5: impact ends
    expect(atRecovery.combatants.target.action).toMatchObject({
      definitionId: 'technical-parry',
      phase: 'recovery',
      phaseEndsAtTick: CONTACT_TICK + 5 + 16, // technical-parry's authored recoveryTicks
    })
  })
})

describe('advanceEncounterTick: defeated combatants leave targeting/collision the tick AFTER defeat, not immediately', () => {
  it('a seeker can still acquire a target that is defeated later the same tick, then loses it on the very next tick', () => {
    const created = createEncounter({
      seed: 1,
      combatants: [
        combatant('a', 'home', { archetype: 'fast', startPosition: { x: -1, z: 0 } }),
        combatant('v', 'away', { archetype: 'fast', startPosition: { x: 0, z: 0 }, fighter: { maxHp: 1 } }),
        combatant('s', 'third', { archetype: 'fast', startPosition: { x: 0, z: 3 } }), // within 16-unit acquisition radius of v
      ],
      arena: freeArena,
      hostility: { mode: 'free-for-all' },
      combatStyles: COMBAT_STYLES,
    })

    let state = patchCombatant(created.state, 'a', {
      targetId: undefined,
      nextDecisionTick: 999_999,
      facing: { x: 1, z: 0 },
      action: {
        type: 'active',
        instanceId: 'a:0',
        definitionId: 'fast-slash',
        phase: 'windup',
        phaseStartedTick: CONTACT_TICK - 1,
        phaseEndsAtTick: CONTACT_TICK,
        targetId: 'v',
        attackRolls: { accuracy: 0.1, critical: 0.9 },
      },
    })
    state = patchCombatant(state, 'v', { targetId: undefined, nextDecisionTick: 999_999, locomotionIntent: 'hold-range' })
    // 's' is targetless and decision-ready exactly on CONTACT_TICK: phase 3 of that same tick must still see 'v' as
    // active (defeat happens later, in phase 9), so acquisition succeeds this tick.
    state = patchCombatant(state, 's', { targetId: undefined, nextDecisionTick: CONTACT_TICK })
    state = { ...state, tick: CONTACT_TICK - 1 }

    const { state: afterDefeatTick } = advanceEncounterTick(state)

    expect(afterDefeatTick.combatants.v.status).toBe('defeated')
    expect(afterDefeatTick.combatants.s.targetId).toBe('v') // acquired before phase 9 defeated v this same tick

    const { state: nextTick } = advanceEncounterTick(afterDefeatTick)

    expect(nextTick.combatants.s.targetId).toBeUndefined() // retainTarget clears it: v is no longer active
  })
})

// ===========================================================================
// Task 10: phase 11-12 (local anti-stall clocks, no-hostile-pairs
// completion), the exhaustive stagger phase-matrix, and the two informational
// diagnostics (canonical trace hash, pacing probe). All whitebox fixtures
// below reuse Task 9's `contactFixture`/`boundDefense`/`CONTACT_TICK`/`types`
// helpers so a single `advanceEncounterTick` call exercises exactly the
// phase-11/12 or stagger-matrix behavior under test.
// ===========================================================================

describe('advanceEncounterTick: local anti-stall clocks (Task 10 Step 2) -- lastContactTick / lastResolutionTick', () => {
  it('both clocks initialize to encounter-start tick 0', () => {
    const created = createEncounter(baseConfig())
    for (const id of created.state.combatantIds) {
      expect(created.state.combatants[id].lastContactTick).toBe(0)
      expect(created.state.combatants[id].lastResolutionTick).toBe(0)
    }
  })

  it('an ordinary (unblocked) hit updates both clocks for actor and target', () => {
    const state = contactFixture({
      actorArchetype: 'fast',
      targetArchetype: 'fast',
      actionId: 'fast-slash',
      actorPosition: { x: 0, z: 0 },
      targetPosition: { x: 1.0, z: 0 },
      actorFacing: { x: 1, z: 0 },
      accuracyRoll: 0.1,
      criticalRoll: 0.9,
    })

    const { state: next } = advanceEncounterTick(state)

    expect(next.combatants.actor.lastContactTick).toBe(CONTACT_TICK)
    expect(next.combatants.actor.lastResolutionTick).toBe(CONTACT_TICK)
    expect(next.combatants.target.lastContactTick).toBe(CONTACT_TICK)
    expect(next.combatants.target.lastResolutionTick).toBe(CONTACT_TICK)
  })

  it('a blocked hit still updates lastContactTick -- a block is still a damage-dealt contact, just reduced', () => {
    const state = contactFixture({
      actorArchetype: 'heavy',
      targetArchetype: 'heavy',
      actionId: 'heavy-cleave',
      actorPosition: { x: -1, z: 0 },
      targetPosition: { x: 0, z: 0 },
      actorFacing: { x: 1, z: 0 },
      accuracyRoll: 0.1,
      criticalRoll: 0.9,
      targetOverrides: { facing: { x: -1, z: 0 }, action: boundDefense('heavy-guard') },
    })

    const { state: next } = advanceEncounterTick(state)

    expect(next.combatants.actor.lastContactTick).toBe(CONTACT_TICK)
    expect(next.combatants.target.lastContactTick).toBe(CONTACT_TICK)
  })

  it('a parry updates lastContactTick for both the attacker and the parrying defender', () => {
    const state = contactFixture({
      actorArchetype: 'technical',
      targetArchetype: 'technical',
      actionId: 'technical-thrust',
      actorPosition: { x: -2, z: 0 },
      targetPosition: { x: 0, z: 0 },
      actorFacing: { x: 1, z: 0 },
      accuracyRoll: 0.1,
      criticalRoll: 0.9,
      targetOverrides: { facing: { x: -1, z: 0 }, action: boundDefense('technical-parry') },
    })

    const { state: next } = advanceEncounterTick(state)

    expect(next.combatants.actor.lastContactTick).toBe(CONTACT_TICK)
    expect(next.combatants.target.lastContactTick).toBe(CONTACT_TICK)
    expect(next.combatants.actor.lastResolutionTick).toBe(CONTACT_TICK)
    expect(next.combatants.target.lastResolutionTick).toBe(CONTACT_TICK)
  })

  it('a successful evade updates lastResolutionTick for both but leaves lastContactTick untouched', () => {
    const state = contactFixture({
      actorArchetype: 'fast',
      targetArchetype: 'fast',
      actionId: 'fast-slash',
      actorPosition: { x: 0, z: 0 },
      targetPosition: { x: 5, z: 0 },
      actorFacing: { x: 1, z: 0 },
      accuracyRoll: 0.1,
      criticalRoll: 0.9,
      targetOverrides: { locomotionIntent: 'advance', action: boundDefense('fast-evade', { defenseRoll: { direction: 0.1 } }) },
    })

    const { state: next } = advanceEncounterTick(state)

    expect(next.combatants.actor.lastResolutionTick).toBe(CONTACT_TICK)
    expect(next.combatants.target.lastResolutionTick).toBe(CONTACT_TICK)
    expect(next.combatants.actor.lastContactTick).toBe(0)
    expect(next.combatants.target.lastContactTick).toBe(0)
  })

  it('a geometry miss updates lastResolutionTick for both but never lastContactTick', () => {
    const state = contactFixture({
      actorArchetype: 'fast',
      targetArchetype: 'fast',
      actionId: 'fast-slash',
      actorPosition: { x: 0, z: 0 },
      targetPosition: { x: 5, z: 0 },
      actorFacing: { x: 1, z: 0 },
      accuracyRoll: 0.1,
      criticalRoll: 0.9,
    })

    const { state: next } = advanceEncounterTick(state)

    expect(next.combatants.actor.lastResolutionTick).toBe(CONTACT_TICK)
    expect(next.combatants.target.lastResolutionTick).toBe(CONTACT_TICK)
    expect(next.combatants.actor.lastContactTick).toBe(0)
    expect(next.combatants.target.lastContactTick).toBe(0)
  })

  it('an accuracy miss updates lastResolutionTick for both but never lastContactTick', () => {
    const state = contactFixture({
      actorArchetype: 'fast',
      targetArchetype: 'fast',
      actionId: 'fast-slash',
      actorPosition: { x: 0, z: 0 },
      targetPosition: { x: 1.0, z: 0 },
      actorFacing: { x: 1, z: 0 },
      accuracyRoll: 0.9, // fails: clamp(0.8+0.06)=0.86
      criticalRoll: 0.9,
    })

    const { state: next } = advanceEncounterTick(state)

    expect(next.combatants.actor.lastResolutionTick).toBe(CONTACT_TICK)
    expect(next.combatants.target.lastResolutionTick).toBe(CONTACT_TICK)
    expect(next.combatants.actor.lastContactTick).toBe(0)
    expect(next.combatants.target.lastContactTick).toBe(0)
  })

  it('target-unavailable updates neither clock -- the target had already vanished, this was never a real resolution', () => {
    const state = contactFixture({
      actorArchetype: 'fast',
      targetArchetype: 'fast',
      actionId: 'fast-slash',
      actorPosition: { x: 0, z: 0 },
      targetPosition: { x: 1.0, z: 0 },
      actorFacing: { x: 1, z: 0 },
      accuracyRoll: 0.1,
      criticalRoll: 0.9,
      targetOverrides: { status: 'defeated', hp: 0 },
    })

    const { state: next } = advanceEncounterTick(state)

    expect(next.combatants.actor.lastResolutionTick).toBe(0)
    expect(next.combatants.actor.lastContactTick).toBe(0)
  })
})

describe('advanceEncounterTick: phase 12 completion (no-hostile-pairs) -- Task 10', () => {
  it('finishes the encounter the instant no living hostile pair remains, only after this tick\'s contact effects have persisted', () => {
    const state = contactFixture({
      actorArchetype: 'fast',
      targetArchetype: 'fast',
      actionId: 'fast-slash',
      actorPosition: { x: 0, z: 0 },
      targetPosition: { x: 1.0, z: 0 },
      actorFacing: { x: 1, z: 0 },
      accuracyRoll: 0.1,
      criticalRoll: 0.9, // ordinary (non-crit) hit: round(20*0.75*1.00)=15, lethal against hp 1
      targetOverrides: { hp: 1 },
    })

    const { state: next, events } = advanceEncounterTick(state)

    expect(next.phase).toBe('finished')
    expect(next.combatants.target.hp).toBe(0) // completion resolves AFTER contact effects persist
    expect(next.combatants.target.status).toBe('defeated')
    expect(next.result).toMatchObject({ reason: 'no-hostile-pairs', survivorIds: ['actor'], winnerIds: ['actor'], winningFactionIds: ['home'] })

    const finishedEvent = events.find((event) => event.type === 'encounter-finished')
    expect(finishedEvent).toBeDefined()
    expect(events[events.length - 1]).toBe(finishedEvent) // last event emitted this tick
  })

  it('does not finish while a living hostile pair remains', () => {
    const state = contactFixture({
      actorArchetype: 'fast',
      targetArchetype: 'fast',
      actionId: 'fast-slash',
      actorPosition: { x: 0, z: 0 },
      targetPosition: { x: 1.0, z: 0 },
      actorFacing: { x: 1, z: 0 },
      accuracyRoll: 0.1,
      criticalRoll: 0.9,
    })

    const { state: next, events } = advanceEncounterTick(state)

    expect(next.phase).toBe('running')
    expect(next.result).toBeUndefined()
    expect(events.some((event) => event.type === 'encounter-finished')).toBe(false)
  })

  it('a subsequent tick on an already-finished encounter is inert -- no double completion', () => {
    const state = contactFixture({
      actorArchetype: 'fast',
      targetArchetype: 'fast',
      actionId: 'fast-slash',
      actorPosition: { x: 0, z: 0 },
      targetPosition: { x: 1.0, z: 0 },
      actorFacing: { x: 1, z: 0 },
      accuracyRoll: 0.1,
      criticalRoll: 0.9,
      targetOverrides: { hp: 1 },
    })

    const { state: finished } = advanceEncounterTick(state)
    const { state: still, events } = advanceEncounterTick(finished)

    expect(still).toBe(finished)
    expect(events).toEqual([])
  })

  it('produces an empty winner/survivor result for the degenerate zero-survivor (mutual-defeat) case', () => {
    // `resolveNoHostilePairsCompletion`'s own doc comment names this case
    // explicitly (encounter.ts): every combatant already defeated is safe by
    // construction (`hasAnyHostilePair` requires both sides `status ===
    // 'active'`, so zero active combatants trivially has no hostile pair),
    // but nothing exercised it. Directly constructs the degenerate state
    // (both combatants pre-defeated) rather than choreographing a same-tick
    // mutual kill: with exactly two combatants, ordinary contact resolution
    // cannot actually produce a same-tick double-KO in the first place (the
    // total-order intent loop skips a defeated actor's own later intent, so
    // whichever side's attack resolves first is the only one that lands) --
    // this test targets the completion branch itself, not that choreography.
    const created = createEncounter(baseConfig())
    let state = patchCombatant(created.state, 'a', { status: 'defeated', hp: 0 })
    state = patchCombatant(state, 'b', { status: 'defeated', hp: 0 })
    state = { ...state, tick: 0 }

    const { state: next, events } = advanceEncounterTick(state)

    expect(next.phase).toBe('finished')
    expect(next.result).toMatchObject({ reason: 'no-hostile-pairs', survivorIds: [], winnerIds: [], winningFactionIds: [] })
    const finishedEvent = events.find((event) => event.type === 'encounter-finished')
    expect(finishedEvent).toMatchObject({ survivorIds: [], winnerIds: [], winningFactionIds: [] })
  })
})

describe('advanceEncounterTick: stagger phase matrix (Task 10 Step 1) -- every attack/defense phase x non-lethal stagger', () => {
  /** A hit from 'actor' against 'target' that always lands (geometry/accuracy pass, non-critical, non-lethal by default), so every scenario below differs only in what `target`'s own action/overrides were beforehand. */
  function staggeringHitFixture(targetAction: CombatActionState, targetOverrides: Partial<FighterCombatState> = {}): EncounterState {
    return contactFixture({
      actorArchetype: 'fast',
      targetArchetype: 'fast',
      actionId: 'fast-slash',
      actorPosition: { x: 0, z: 0 },
      targetPosition: { x: 1.0, z: 0 },
      actorFacing: { x: 1, z: 0 },
      accuracyRoll: 0.1,
      criticalRoll: 0.9,
      targetOverrides: { action: targetAction, ...targetOverrides },
    })
  }

  it('neutral: nothing to interrupt -- no action-interrupted, action stays neutral, fighter-staggered still fires', () => {
    const state = staggeringHitFixture({ type: 'neutral' })

    const { state: next, events } = advanceEncounterTick(state)

    expect(events.some((event) => event.type === 'action-interrupted')).toBe(false)
    expect(events.some((event) => event.type === 'fighter-staggered')).toBe(true)
    expect(next.combatants.target.action).toEqual({ type: 'neutral' })
  })

  // windup/impact/recovery are exercised for BOTH an attack-shaped action
  // (fast-slash, carries attackRolls) and a defense-shaped action
  // (technical-parry, never carries attackRolls) -- design.md's table gives
  // "Attack outcome"/"Defense outcome" as two columns, identical in every
  // row, and `applyStaggerToAction` (combatActions.ts) is provably keyed
  // only on `action.phase`, but the brief asks for every attack *and*
  // defense phase x stagger cell to actually be covered by a test, not
  // inferred from the implementation being phase-only.
  describe.each([
    { shape: 'attack', definitionId: 'fast-slash' as const, attackRolls: { accuracy: 0.5, critical: 0.5 } },
    { shape: 'defense', definitionId: 'technical-parry' as const, attackRolls: undefined },
  ])('$shape-shaped action ($definitionId)', ({ definitionId, attackRolls }) => {
    it('windup: cancelled before contact, emitting action-interrupted(stagger); stored attack rolls (if any) are simply discarded with it', () => {
      const state = staggeringHitFixture({
        type: 'active',
        instanceId: 'target:0',
        definitionId,
        phase: 'windup',
        phaseStartedTick: CONTACT_TICK - 1,
        phaseEndsAtTick: CONTACT_TICK + 50,
        targetId: 'actor',
        ...(attackRolls ? { attackRolls } : {}),
      })

      const { state: next, events } = advanceEncounterTick(state)

      expect(events.find((event) => event.type === 'action-interrupted')).toMatchObject({
        actorId: 'target',
        actionInstanceId: 'target:0',
        actionId: definitionId,
        reason: 'stagger',
      })
      expect(next.combatants.target.action).toEqual({ type: 'neutral' })
    })

    it('impact: the remaining impact/recovery is cleared, emitting action-interrupted(stagger)', () => {
      const state = staggeringHitFixture({
        type: 'active',
        instanceId: 'target:0',
        definitionId,
        phase: 'impact',
        phaseStartedTick: CONTACT_TICK - 1,
        phaseEndsAtTick: CONTACT_TICK + 50,
        targetId: 'actor',
        ...(attackRolls ? { attackRolls } : {}),
      })

      const { state: next, events } = advanceEncounterTick(state)

      expect(events.find((event) => event.type === 'action-interrupted')).toMatchObject({
        actorId: 'target',
        actionInstanceId: 'target:0',
        actionId: definitionId,
        reason: 'stagger',
      })
      expect(next.combatants.target.action).toEqual({ type: 'neutral' })
    })

    it('recovery: the remaining recovery is cleared, emitting action-interrupted(stagger)', () => {
      const state = staggeringHitFixture({
        type: 'active',
        instanceId: 'target:0',
        definitionId,
        phase: 'recovery',
        phaseStartedTick: CONTACT_TICK - 1,
        phaseEndsAtTick: CONTACT_TICK + 50,
        targetId: 'actor',
        ...(attackRolls ? { attackRolls } : {}),
      })

      const { state: next, events } = advanceEncounterTick(state)

      expect(events.find((event) => event.type === 'action-interrupted')).toMatchObject({
        actorId: 'target',
        actionInstanceId: 'target:0',
        actionId: definitionId,
        reason: 'stagger',
      })
      expect(next.combatants.target.action).toEqual({ type: 'neutral' })
    })
  })

  it('contact: the already-snapshotted contact survives this tick untouched (no action-interrupted), then clears silently on the following tick instead of advancing to impact', () => {
    const state = staggeringHitFixture({
      type: 'active',
      instanceId: 'target:0',
      definitionId: 'heavy-guard', // an inert, unbound action -- no reactingToActionId, so it never blocks actor's hit
      phase: 'contact',
      phaseStartedTick: CONTACT_TICK,
      phaseEndsAtTick: CONTACT_TICK + 1,
      targetId: 'actor',
    })

    const { state: sameTick, events } = advanceEncounterTick(state)

    expect(events.some((event) => event.type === 'action-interrupted')).toBe(false)
    expect(events.some((event) => event.type === 'fighter-staggered')).toBe(true)
    expect(sameTick.combatants.target.action).toMatchObject({ phase: 'contact', instanceId: 'target:0' })

    const { state: nextTick } = advanceEncounterTick(sameTick)

    // Stagger owns control: not advanced to `impact` on its ordinary schedule.
    expect(nextTick.combatants.target.action).toEqual({ type: 'neutral' })
  })

  it('lethal defeat overrides the whole table: no action-interrupted even mid-windup, action and forcedActionId silently cleared, fighter-staggered still fires', () => {
    const state = staggeringHitFixture(
      {
        type: 'active',
        instanceId: 'target:0',
        definitionId: 'fast-slash',
        phase: 'windup',
        phaseStartedTick: CONTACT_TICK - 1,
        phaseEndsAtTick: CONTACT_TICK + 50,
        targetId: 'actor',
        attackRolls: { accuracy: 0.5, critical: 0.5 },
      },
      { hp: 1, forcedActionId: 'technical-parry-counter' },
    )

    const { state: next, events } = advanceEncounterTick(state)

    expect(events.some((event) => event.type === 'action-interrupted')).toBe(false)
    expect(events.some((event) => event.type === 'fighter-staggered')).toBe(true)
    expect(events.some((event) => event.type === 'fighter-defeated')).toBe(true)
    expect(next.combatants.target.action).toEqual({ type: 'neutral' })
    expect(next.combatants.target.forcedActionId).toBeUndefined()
    expect(next.combatants.target.status).toBe('defeated')
  })

  it('lethal defeat cancels the defeated fighter\'s own later intent this same tick, silently -- not the "surviving combatant" clause, see the next test for that', () => {
    // Reuses Task 9's snapshot-discipline scenario (a hits b lethally; b's own
    // contact-phase attack against c must still resolve) but with b's hp
    // dropped to 1 so a's hit is now lethal. This proves design.md's "cancels
    // only later contact intents whose actor is that fighter" half of the
    // lethal-defeat clause: b (the defeated fighter) never gets to resolve
    // its own already-scheduled attack against c. It does NOT prove the
    // other half ("does not cancel another surviving combatant's already
    // scheduled contact") -- c here is b's own *target*, not an independent
    // third party with its own unrelated intent, so this fixture cannot tell
    // "cancelled because b died" apart from "cancelled because b's own
    // intent specifically was skipped." The next test isolates that other
    // clause with a genuinely unrelated surviving pair.
    const created = createEncounter({
      seed: 1,
      combatants: [
        combatant('a', 'home', { archetype: 'fast', startPosition: { x: -1, z: 0 } }),
        combatant('b', 'fast-side', { archetype: 'fast', startPosition: { x: 0, z: 0 }, fighter: { maxHp: 1 } }),
        combatant('c', 'away', { archetype: 'heavy', startPosition: { x: 1.2, z: 0 }, fighter: { maxHp: 500 } }),
      ],
      arena: freeArena,
      hostility: { mode: 'free-for-all' },
      combatStyles: COMBAT_STYLES,
    })

    let state = patchCombatant(created.state, 'a', {
      targetId: undefined,
      nextDecisionTick: 999_999,
      facing: { x: 1, z: 0 },
      action: {
        type: 'active',
        instanceId: 'a:0',
        definitionId: 'fast-slash', // priority 40, lethal against b's 1 hp
        phase: 'windup',
        phaseStartedTick: CONTACT_TICK - 1,
        phaseEndsAtTick: CONTACT_TICK,
        targetId: 'b',
        attackRolls: { accuracy: 0.1, critical: 0.9 },
      },
    })
    state = patchCombatant(state, 'b', {
      targetId: undefined,
      nextDecisionTick: 999_999,
      facing: { x: 1, z: 0 },
      action: {
        type: 'active',
        instanceId: 'b:0',
        definitionId: 'heavy-cleave', // priority 10, resolves after a's lethal hit
        phase: 'windup',
        phaseStartedTick: CONTACT_TICK - 1,
        phaseEndsAtTick: CONTACT_TICK,
        targetId: 'c',
        attackRolls: { accuracy: 0.1, critical: 0.9 },
      },
    })
    state = patchCombatant(state, 'c', { targetId: undefined, nextDecisionTick: 999_999, locomotionIntent: 'hold-range', facing: { x: -1, z: 0 } })
    state = { ...state, tick: CONTACT_TICK - 1 }

    const { state: next, events } = advanceEncounterTick(state)

    expect(next.combatants.b.status).toBe('defeated')
    // b's own attack against c is cancelled outright (b is the defeated
    // fighter): no damage-dealt/attack-missed for it at all, not even a
    // silent skip artifact -- c never took a hit.
    expect(events.some((event) => (event.type === 'damage-dealt' || event.type === 'attack-missed') && event.actorId === 'b')).toBe(false)
    expect(next.combatants.c.hp).toBe(500)
  })

  it('lethal defeat elsewhere in the batch does not cancel a different, unrelated surviving pair\'s already-scheduled contact this same tick', () => {
    // Four combatants: 'killer' lethally defeats 'victim' (fast-slash,
    // priority 40, resolves FIRST in the sorted order), while a wholly
    // unrelated pair -- 'p1' attacking 'p2', sharing no target/attacker with
    // either killer or victim -- has its own already-scheduled contact-phase
    // attack resolving SECOND in the very same batch (heavy-cleave, priority
    // 10). This isolates design.md's other lethal-defeat clause ("does not
    // cancel another surviving combatant's already scheduled contact") from
    // the previous test's "defeated fighter's own intent is cancelled"
    // clause: p1 and p2 are neither the killer, the victim, nor either
    // one's own target, so nothing about their own contact should be
    // affected by an unrelated defeat resolving earlier in the same batch.
    const created = createEncounter({
      seed: 1,
      combatants: [
        combatant('killer', 'faction-a', { archetype: 'fast', startPosition: { x: -1, z: 0 } }),
        combatant('victim', 'faction-b', { archetype: 'fast', startPosition: { x: 0, z: 0 }, fighter: { maxHp: 1 } }),
        combatant('p1', 'faction-c', { archetype: 'heavy', startPosition: { x: 0, z: 10 } }),
        combatant('p2', 'faction-d', { archetype: 'heavy', startPosition: { x: 1.0, z: 10 } }),
      ],
      arena: freeArena,
      hostility: { mode: 'free-for-all' },
      combatStyles: COMBAT_STYLES,
    })

    let state = patchCombatant(created.state, 'killer', {
      targetId: undefined,
      nextDecisionTick: 999_999,
      facing: { x: 1, z: 0 },
      action: {
        type: 'active',
        instanceId: 'killer:0',
        definitionId: 'fast-slash', // priority 40: resolves before p1's intent
        phase: 'windup',
        phaseStartedTick: CONTACT_TICK - 1,
        phaseEndsAtTick: CONTACT_TICK,
        targetId: 'victim',
        attackRolls: { accuracy: 0.1, critical: 0.9 },
      },
    })
    state = patchCombatant(state, 'victim', { targetId: undefined, nextDecisionTick: 999_999, locomotionIntent: 'hold-range', facing: { x: -1, z: 0 } })
    state = patchCombatant(state, 'p1', {
      targetId: undefined,
      nextDecisionTick: 999_999,
      facing: { x: 1, z: 0 },
      action: {
        type: 'active',
        instanceId: 'p1:0',
        definitionId: 'heavy-cleave', // priority 10: resolves after killer's lethal hit, sharing nothing with killer/victim
        phase: 'windup',
        phaseStartedTick: CONTACT_TICK - 1,
        phaseEndsAtTick: CONTACT_TICK,
        targetId: 'p2',
        attackRolls: { accuracy: 0.1, critical: 0.9 },
      },
    })
    state = patchCombatant(state, 'p2', { targetId: undefined, nextDecisionTick: 999_999, locomotionIntent: 'hold-range', facing: { x: -1, z: 0 } })
    state = { ...state, tick: CONTACT_TICK - 1 }

    const { state: next, events } = advanceEncounterTick(state)

    expect(next.combatants.victim.status).toBe('defeated')
    // p1's attack against p2 resolves as an ordinary unblocked hit, wholly
    // unaffected by victim's defeat elsewhere in the same batch.
    expect(events.some((event) => event.type === 'damage-dealt' && event.actorId === 'p1' && event.targetId === 'p2')).toBe(true)
    expect(next.combatants.p2.hp).toBeLessThan(next.combatants.p2.definition.maxHp)
  })

  it('clears a just-queued forced action (technical-parry-counter) when a second, lower-priority intent staggers the same defender later in the same contact-resolution batch', () => {
    // 'p' parries a1's higher-priority attack (queuing forcedActionId), then
    // a2's lower-priority, unrelated attack lands an ordinary hit on 'p'
    // within the very same phase-9 batch -- proving the "neutral / queued
    // forced action" row applies even when the forced action was only just
    // queued moments earlier in the same tick, not merely across ticks.
    const created = createEncounter({
      seed: 1,
      combatants: [
        combatant('p', 'home', { archetype: 'technical', startPosition: { x: 0, z: 0 } }),
        combatant('a1', 'away', { archetype: 'fast', startPosition: { x: -1, z: 0 } }),
        combatant('a2', 'away', { archetype: 'technical', startPosition: { x: 0, z: 1.5 } }),
      ],
      arena: freeArena,
      hostility: { mode: 'different-factions' },
      combatStyles: COMBAT_STYLES,
    })

    let state = patchCombatant(created.state, 'p', {
      targetId: undefined,
      nextDecisionTick: 999_999,
      facing: { x: -1, z: 0 }, // toward a1: passes technical-parry's wide incoming-facing gate
      action: {
        type: 'active',
        instanceId: 'p:0',
        definitionId: 'technical-parry',
        phase: 'contact',
        phaseStartedTick: CONTACT_TICK,
        phaseEndsAtTick: CONTACT_TICK + 1,
        targetId: 'a1',
        reactingToActionId: 'a1:0',
      },
    })
    state = patchCombatant(state, 'a1', {
      targetId: undefined,
      nextDecisionTick: 999_999,
      facing: { x: 1, z: 0 },
      action: {
        type: 'active',
        instanceId: 'a1:0',
        definitionId: 'fast-slash', // priority 40: resolves before a2's technical-thrust (25)
        phase: 'windup',
        phaseStartedTick: CONTACT_TICK - 1,
        phaseEndsAtTick: CONTACT_TICK,
        targetId: 'p',
        attackRolls: { accuracy: 0.1, critical: 0.9 },
      },
    })
    state = patchCombatant(state, 'a2', {
      targetId: undefined,
      nextDecisionTick: 999_999,
      facing: { x: 0, z: -1 },
      action: {
        type: 'active',
        instanceId: 'a2:0',
        definitionId: 'technical-thrust', // priority 25, unbound: an ordinary unblocked hit on p
        phase: 'windup',
        phaseStartedTick: CONTACT_TICK - 1,
        phaseEndsAtTick: CONTACT_TICK,
        targetId: 'p',
        attackRolls: { accuracy: 0.1, critical: 0.9 },
      },
    })
    state = { ...state, tick: CONTACT_TICK - 1 }

    const { state: next, events } = advanceEncounterTick(state)

    expect(events.some((event) => event.type === 'attack-parried')).toBe(true) // a1's attack, resolved first (priority 40 > 25)
    expect(events.some((event) => event.type === 'damage-dealt' && event.actorId === 'a2')).toBe(true) // a2's ordinary hit, staggering p
    expect(next.combatants.p.forcedActionId).toBeUndefined() // stagger owns control: the just-queued counter never gets to start
  })
})

describe("advanceEncounterTick: Fast's forced disengage measures its 30-tick timeout from the original stamp even while staggered (carried forward from Task 8, now reachable)", () => {
  it('keeps counting toward the timeout from forcedDisengageStartTick while stagger blocks its own movement, rather than resetting once stagger clears -- a deliberate choice, not an accident', () => {
    // Design rationale (see this task's report): the anti-stall local clocks
    // are explicitly absolute-tick, unaffected by unrelated events elsewhere
    // ("an unrelated clash elsewhere cannot reset its anti-stall behavior");
    // this forced-disengage timeout is the same kind of absolute countdown,
    // so an unrelated stagger blocking its movement for part of the window
    // does not grant it extra time once the stagger clears.
    const created = createEncounter({
      seed: 1,
      combatants: [
        combatant('self', 'home', { archetype: 'fast', startPosition: { x: 0, z: 0 } }),
        combatant('other', 'away', { archetype: 'fast', startPosition: { x: 10, z: 0 } }), // far outside the 2.4-unit end range throughout
      ],
      arena: freeArena,
      hostility: { mode: 'different-factions' },
      combatStyles: COMBAT_STYLES,
    })

    let state = patchCombatant(created.state, 'other', { nextDecisionTick: 999_999 })
    state = patchCombatant(state, 'self', {
      targetId: 'other',
      nextDecisionTick: 999_999,
      locomotionIntent: 'disengage',
      forcedDisengageStartTick: 0,
      staggerUntilTick: 25, // blocks 'self' own movement through tick 24; unrelated to the disengage's own 30-tick clock
      action: { type: 'neutral' },
    })
    state = { ...state, tick: 0 }

    const { state: afterStaggerWindow } = advanceEncounterTicks(state, 25) // ticks 1..25: staggered through 24, free again at 25
    expect(afterStaggerWindow.tick).toBe(25)
    expect(afterStaggerWindow.combatants.self.forcedDisengageStartTick).toBe(0) // unaffected by the stagger's own clearing rules

    const { state: beforeTimeout } = advanceEncounterTicks(afterStaggerWindow, 4) // ticks 26..29
    expect(beforeTimeout.tick).toBe(29)
    expect(beforeTimeout.combatants.self.forcedDisengageStartTick).toBe(0) // ticksSinceForced 29: neither exit condition met yet

    const { state: atTimeout } = advanceEncounterTick(beforeTimeout) // tick 30: ticksSinceForced === 30
    expect(atTimeout.tick).toBe(30)
    // Times out from the ORIGINAL stamp (tick 0), not from tick 25 when
    // stagger cleared -- even though 'self' barely moved during ticks 1-24.
    expect(atTimeout.combatants.self.forcedDisengageStartTick).toBeUndefined()
  })
})

// ===========================================================================
// Task 10 Step 3: canonical trace hashing -- a TEST-ONLY diagnostic helper,
// not production state (`EncounterState` never stores an event log or a
// running hash). `traceHash` (moved to `testSupport/combatFixtures.ts` in
// Task 12 so `encounterCapacity.test.ts` reuses the exact same folding
// approach) folds every tick's sorted combatant state, integer fields, HP,
// action/phase IDs, RNG states, and event payloads through
// `foldTraceHash`/`formatTraceHash` (random.ts, built in Task 2 for exactly
// this purpose); positions/facing are quantized to integer millionths so the
// diagnostic (never combat itself, which stays full precision throughout
// `encounter.ts`) is robust to last-bit float noise. No frozen literal is
// asserted here -- Task 13 tunes balance first, then records canonical
// hashes after reviewing traces.
// ===========================================================================

describe('canonical trace hash (Task 10 Step 3, test-only diagnostic helper)', () => {
  const seeds = [3, 11, 42]

  it.each(seeds)('seed %i: two identical runs produce identical per-tick canonical trace hashes', (seed) => {
    const config = duelEncounterConfig({ seed })
    const first = traceHash(createEncounter(config), 150)
    const second = traceHash(createEncounter(config), 150)

    expect(first).toBe(second)
    expect(first).toMatch(/^[0-9a-f]{8}$/)
  })

  it('a changed seed changes at least one of the three hashes', () => {
    const hashes = seeds.map((seed) => traceHash(createEncounter(duelEncounterConfig({ seed })), 150))
    expect(new Set(hashes).size).toBeGreaterThan(1)
  })

  // CANONICAL HASH FREEZE DEFERRED (Task 13 Step 6). Literals were frozen here
  // once and then withdrawn: code review found two further conformance defects
  // (the mover clamping windup travel at the arena floor instead of the
  // action's own `contactRange.min`, and an undisclosed boundary clause in the
  // zero-weight fallback), and a question about how far the content calibration
  // may move the design's authored relative standings is with the plan owner.
  //
  // All three change traces, so freezing now would mean paying the review cost
  // twice. Step 6 is explicitly conditional on the cohorts being final; until
  // they are, these assertions pin the PROPERTIES a frozen hash depends on --
  // determinism, format, and seed sensitivity -- plus the observable shape of
  // each trace, so a regression still fails here rather than waiting for the
  // freeze.
  it.each(seeds)('seed %i: folds a deterministic, well-formed trace of a real exchange', (seed) => {
    const config = duelEncounterConfig({ seed })
    const hash = traceHash(createEncounter(config), 150)
    expect(hash).toMatch(/^[0-9a-f]{8}$/)
    expect(traceHash(createEncounter(config), 150)).toBe(hash)

    // The trace the hash will fold: both fighters must actually close from
    // their +/-2.2 start and trade real contacts inside the window, so a hash
    // can never be frozen from an inert or non-engaging run.
    let state = createEncounter(config).state
    const events: EncounterEvent[] = []
    for (let tick = 0; tick < 150 && state.phase === 'running'; tick += 1) {
      const next = advanceEncounterTick(state)
      state = next.state
      events.push(...next.events)
    }
    const home = state.combatants['home.brutus']
    const away = state.combatants['away.drusus']
    expect(distanceBetween(home.position, away.position)).toBeLessThan(2.0) // closed from 4.4 apart
    expect(events.filter((event) => event.type === 'action-started').length).toBeGreaterThan(0)
    expect(events.filter((event) => event.type === 'damage-dealt').length).toBeGreaterThan(0)
    expect(Math.min(home.hp, away.hp)).toBeLessThan(home.definition.maxHp)
  })
})

// ===========================================================================
// Task 10 Step 4: informational early pacing probe -- Brutus vs. Drusus, 20
// consecutive seeds. This is a decision gate for Tasks 12-13, not a balance
// assertion: only invariants (enforced for free by `assertEncounterInvariants`
// inside every `advanceEncounterTick` call) and completion are asserted here.
// The measured median duration and geometry-miss fraction are printed for
// review and reported verbatim in this task's report.
// ===========================================================================

describe('Task 10 Step 4: informational pacing probe -- Brutus vs. Drusus, 20 seeds', () => {
  const PROBE_SEED_COUNT = 20
  const MAX_PROBE_TICKS = 3600 // matches design.md's duel MAX_BOUT_TICKS; the actual time-limit policy is Task 11's, not exercised here

  function brutusVsDrususConfig(seed: number): EncounterConfig {
    return {
      seed,
      combatants: [
        { id: 'brutus', factionId: 'home', fighter: homeRoster[0], startPosition: { x: -2.2, z: 0 } },
        { id: 'drusus', factionId: 'away', fighter: opponents[0], startPosition: { x: 2.2, z: 0 } },
      ],
      arena: { ...duelArena, orderedPair: ['brutus', 'drusus'] },
      hostility: { mode: 'different-factions' },
      combatStyles: COMBAT_STYLES,
    }
  }

  it('measures median duration and the geometry-miss share across 20 consecutive seeds, asserting only invariants and completion', () => {
    const durations: number[] = []
    let totalResolutions = 0
    let geometryMisses = 0
    let finishedCount = 0
    let stillRunningCount = 0
    const invariantViolations: string[] = []

    for (let index = 0; index < PROBE_SEED_COUNT; index += 1) {
      const seed = BASELINE_TEST_SEED + index
      const created = createEncounter(brutusVsDrususConfig(seed))
      let state: EncounterState = created.state
      const allEvents: EncounterEvent[] = [...created.events]
      let crashed = false

      // Invariants are asserted for free on every tick: `advanceEncounterTick`
      // calls `assertEncounterInvariants` internally and throws on violation.
      // This per-tick try/catch exists ONLY because this probe discovered a
      // genuine, pre-existing invariant violation in the arena-boundary
      // clamp (`movement.ts`, confirmed present already on Task 9's HEAD,
      // not introduced by this task, and out of this task's four-file
      // scope) that reproduces for some baseline seeds after ~1100+ ticks of
      // real duel play. Silently swallowing it would defeat the point of
      // this diagnostic; instead each occurrence is recorded and still
      // surfaced below (also written up in this task's report) while
      // letting the probe finish measuring every other seed.
      for (let tick = 0; tick < MAX_PROBE_TICKS; tick += 1) {
        let next: EncounterState
        let tickEvents: readonly EncounterEvent[]
        try {
          const transition = advanceEncounterTick(state)
          next = transition.state
          tickEvents = transition.events
        } catch (err) {
          invariantViolations.push(`seed=${seed} tick=${state.tick + 1}: ${err instanceof Error ? err.message : String(err)}`)
          crashed = true
          break
        }
        state = next
        allEvents.push(...tickEvents)
        if (state.phase !== 'running') break
      }

      if (state.phase === 'finished') {
        finishedCount += 1
        durations.push(state.tick)
        expect(state.result?.reason).toBe('no-hostile-pairs') // completion assertion: the only reason this kernel can produce
      } else if (!crashed) {
        stillRunningCount += 1 // reached the probe budget still undecided -- not a crash, just no time-limit policy at this layer
      }

      for (const event of allEvents) {
        if (event.type === 'damage-dealt' || event.type === 'attack-parried' || event.type === 'attack-evaded') {
          totalResolutions += 1
        } else if (event.type === 'attack-missed') {
          totalResolutions += 1
          if (event.reason === 'geometry') geometryMisses += 1
        }
      }
    }

    // Completion assertion (not a balance band): at least some of the 20
    // seeds must reach a decisive no-hostile-pairs result within the probe
    // budget -- otherwise the kernel isn't actually converging to combat.
    expect(finishedCount).toBeGreaterThan(0)

    if (invariantViolations.length > 0) {
      // eslint-disable-next-line no-console
      console.log(`[Task 10 pacing probe] ${invariantViolations.length}/${PROBE_SEED_COUNT} seeds hit an invariant violation:\n  ${invariantViolations.join('\n  ')}`)
    }

    // Invariant assertion (the whole reason this probe's per-tick try/catch
    // exists): this is the only test in the suite that runs 1000+ ticks of
    // real duel play, exactly the regime a movement/separation/arena-bounds
    // regression would hide from every shorter-lived test. The try/catch
    // above exists to keep collecting every other seed's numbers and to
    // report every violation with its seed/tick (more useful than dying on
    // the first one), never to let a violation pass silently -- the probe
    // must go red the instant any seed hits one.
    expect(invariantViolations).toEqual([])

    const sortedDurations = [...durations].sort((a, b) => a - b)
    const mid = Math.floor(sortedDurations.length / 2)
    const medianDuration =
      sortedDurations.length === 0
        ? Number.NaN
        : sortedDurations.length % 2 === 1
          ? sortedDurations[mid]
          : (sortedDurations[mid - 1] + sortedDurations[mid]) / 2
    const geometryMissFraction = totalResolutions > 0 ? geometryMisses / totalResolutions : 0

    // Required deliverable (brief Step 4 / resolution #6): print the
    // measured numbers so they can be reviewed as a decision gate for
    // Tasks 12-13, without tuning anything to make them look better.
    // eslint-disable-next-line no-console
    console.log(
      `[Task 10 pacing probe] Brutus vs. Drusus, ${PROBE_SEED_COUNT} seeds: ` +
        `finished ${finishedCount}/${PROBE_SEED_COUNT}, still running ${stillRunningCount}/${PROBE_SEED_COUNT}, ` +
        `invariant-violated ${invariantViolations.length}/${PROBE_SEED_COUNT} (pre-existing, out-of-scope -- see task report), ` +
        `within ${MAX_PROBE_TICKS} ticks; ` +
        `median duration ${medianDuration} ticks; ` +
        `geometry-miss fraction ${(geometryMissFraction * 100).toFixed(1)}% (${geometryMisses}/${totalResolutions} attack resolutions).`,
    )
  })
})
