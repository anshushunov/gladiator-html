import { describe, expect, it } from 'vitest'
import { COMBAT_STYLES } from '../content/combatStyles'
import { combatant, freeArena } from '../testSupport/combatFixtures'
import {
  advanceBattleTick,
  advanceBattleTicks,
  createBattle,
  fighterBySide,
  sideForCombatantId,
  MAX_BOUT_TICKS,
  type BattleConfig,
  type BattleState,
  type DuelDescriptor,
} from './battle'
import { createEncounter, type EncounterState } from './encounter'
import { compareArchetypes, comparisonDamageMultiplier, type Archetype, type FighterDefinition } from './fighters'
import { derivedUnitValue, formatTraceHash } from './random'

const heavy: FighterDefinition = { id: 'heavy', name: 'Heavy', school: 'Test', archetype: 'heavy', maxHp: 100, power: 10, accuracy: 1, defenseChance: 0, criticalChance: 0 }
const fast: FighterDefinition = { id: 'fast', name: 'Fast', school: 'Test', archetype: 'fast', maxHp: 100, power: 10, accuracy: 1, defenseChance: 0, criticalChance: 0 }
const brutus: FighterDefinition = { id: 'brutus', name: 'Brutus', school: 'Test', archetype: 'heavy', maxHp: 100, power: 10, accuracy: 0.8, defenseChance: 0.3, criticalChance: 0.1 }
const drusus: FighterDefinition = { id: 'drusus', name: 'Drusus', school: 'Test', archetype: 'fast', maxHp: 100, power: 10, accuracy: 0.8, defenseChance: 0.3, criticalChance: 0.1 }

function baseConfig(overrides: Partial<BattleConfig> = {}): BattleConfig {
  return { home: heavy, away: fast, seed: 7, combatStyles: COMBAT_STYLES, ...overrides }
}

const finished = (config: BattleConfig) => advanceBattleTicks(createBattle(config), MAX_BOUT_TICKS)

/** Same low-level "already mid-action" construction technique as `encounter.test.ts`'s `patchCombatant`, deliberately not shared: each test file authors its own state-shaped fixtures against the exact `EncounterState`/`FighterCombatState` shapes it needs. */
function patchCombatant(state: EncounterState, id: string, overrides: Partial<EncounterState['combatants'][string]>): EncounterState {
  return { ...state, combatants: { ...state.combatants, [id]: { ...state.combatants[id], ...overrides } } }
}

describe('battle duel adapter', () => {
  it('maps duel identity, sorts combatant ids, and assigns sequential encounter-started event ids (brief fixture)', () => {
    const battle = createBattle({ home: brutus, away: drusus, seed: 7, combatStyles: COMBAT_STYLES })
    expect(battle.descriptor).toEqual({ homeId: 'home.brutus', awayId: 'away.drusus' })
    expect(battle.encounter.combatantIds).toEqual(['away.drusus', 'home.brutus'])
    expect(battle.events[0]).toMatchObject({ type: 'encounter-started', id: 0 })
    expect(battle.events.every((event, index) => event.id === index)).toBe(true)
  })

  it('places home/away at the authored duel start positions, radius, lateral limit, and separation', () => {
    const battle = createBattle(baseConfig())
    const home = fighterBySide(battle, 'home')
    const away = fighterBySide(battle, 'away')
    expect(home.position).toEqual({ x: -4.2, z: 0 })
    expect(away.position).toEqual({ x: 4.2, z: 0 })
    expect(battle.encounter.arena).toEqual({
      radius: 6.5,
      lateralLimit: 2.5,
      minimumSeparation: 0.9,
      movementPolicy: 'ordered-pair',
      orderedPair: [battle.descriptor.homeId, battle.descriptor.awayId],
    })
  })

  it('resolves fighterBySide/sideForCombatantId as inverse mappings, and rejects an unknown id', () => {
    const battle = createBattle(baseConfig())
    expect(sideForCombatantId(battle, battle.descriptor.homeId)).toBe('home')
    expect(sideForCombatantId(battle, battle.descriptor.awayId)).toBe('away')
    expect(fighterBySide(battle, sideForCombatantId(battle, battle.descriptor.homeId)).id).toBe(battle.descriptor.homeId)
    expect(() => sideForCombatantId(battle, 'ghost')).toThrow(/Unknown combatant id/)
  })

  it('is reproducible and always selects exactly one winner, never a draw', () => {
    const config = baseConfig({ seed: 99 })
    const first = finished(config)
    const second = finished(config)
    expect(first).toEqual(second)
    expect(first.phase).toBe('finished')
    expect(['home', 'away']).toContain(first.winnerSide)
  })

  // Seed count per pairing: the legacy instantaneous loop's equivalent test
  // ran 1..200 (1800 total runs); the kernel's per-tick cost (spatial hash,
  // movement resolution, contact intents) makes that too slow for the
  // default suite. Measured on this machine with a throwaway perf harness
  // (createBattle + advanceBattleTicks to MAX_BOUT_TICKS, 9 archetype
  // pairings): 8 seeds/pairing (72 runs) ~2.9s, 20/pairing (180 runs) ~8.8s,
  // 40/pairing (360 runs) ~17.6s, 80/pairing (720 runs) ~35.0s, 200/pairing
  // (1800 runs) ~81.8s -- a steady ~45-49ms/run, so cost scales linearly
  // with seed count and 200 is not viable here. 20 seeds/pairing (180 runs)
  // keeps this one test under ~9s, which is the most this file's runtime
  // budget can absorb; the broader 200-seed-per-pairing sweep this replaces
  // still exists, just moved: Task 12's capacity fixtures exercise the same
  // kernel at higher combatant counts, and Task 13's balance cohorts run the
  // full 200-seed-per-pairing sweep as part of tuning.
  it('finishes every archetype pairing across many seeds with exactly one winner', () => {
    const archetypes: readonly Archetype[] = ['heavy', 'fast', 'technical']
    for (const homeArchetype of archetypes) {
      for (const awayArchetype of archetypes) {
        for (let seed = 1; seed <= 20; seed += 1) {
          const home: FighterDefinition = { ...heavy, id: `home-${homeArchetype}`, archetype: homeArchetype }
          const away: FighterDefinition = { ...fast, id: `away-${awayArchetype}`, archetype: awayArchetype }
          const state = finished(baseConfig({ home, away, seed }))
          expect(state.phase).toBe('finished')
          expect(['home', 'away']).toContain(state.winnerSide)
          expect(state.encounter.tick).toBeLessThanOrEqual(MAX_BOUT_TICKS)
        }
      }
    }
  }, 20_000)

  it('emits a finish reason, canonical terminal event, and matching duration', () => {
    const state = finished(baseConfig({ seed: 11 }))
    if (state.winnerSide === undefined) throw new Error('Expected a winner')
    expect(state.events.at(-1)).toMatchObject({
      type: 'encounter-finished',
      winnerIds: [fighterBySide(state, state.winnerSide).id],
      durationTicks: state.encounter.tick,
    })
    expect(['defeat', 'time-limit']).toContain(state.finishReason)
  })

  it('finishes by time limit with the higher remaining-health ratio winning, and maps HP ratios through descriptor IDs', () => {
    const home: FighterDefinition = { ...heavy, id: 'home', maxHp: 100, power: 1, accuracy: 1, defenseChance: 0, criticalChance: 0 }
    const away: FighterDefinition = { ...heavy, id: 'away', maxHp: 150, power: 1, accuracy: 1, defenseChance: 0, criticalChance: 0 }
    const state = finished(baseConfig({ home, away, seed: 41 }))
    expect(state.phase).toBe('finished')
    expect(state.finishReason).toBe('time-limit')
    expect(state.encounter.tick).toBe(MAX_BOUT_TICKS)
    const homeFighter = fighterBySide(state, 'home')
    const awayFighter = fighterBySide(state, 'away')
    const homeRatio = homeFighter.hp / homeFighter.definition.maxHp
    const awayRatio = awayFighter.hp / awayFighter.definition.maxHp
    expect(homeRatio).not.toBe(awayRatio)
    expect(state.winnerSide).toBe(homeRatio > awayRatio ? 'home' : 'away')
    expect(state.events.at(-1)).toMatchObject({ type: 'encounter-finished', reason: 'time-limit', durationTicks: MAX_BOUT_TICKS })
  })

  it('breaks an exact HP-ratio tie at the time limit using a value derived from the seed and sorted candidate IDs', () => {
    // The exact tie is constructed rather than hoped for. This fixture used to
    // rely on `accuracy: 0` keeping both fighters at full HP for the whole
    // bout, but that was only ever true because the fighters were barely
    // attacking: an accuracy of 0 still leaves `heavy-shield-jab`'s `+0.08`
    // accuracyModifier, so once the root-travel legality fix let jabs actually
    // fire, ~8% of them landed and the ratios drifted apart. Driving to tick
    // 3599 and then pinning both fighters to full HP tests the tie-break
    // policy itself, independent of how often anyone connects.
    const home: FighterDefinition = { ...heavy, id: 'home', accuracy: 0 }
    const away: FighterDefinition = { ...heavy, id: 'away', accuracy: 0 }
    const beforeLimit = advanceBattleTicks(createBattle(baseConfig({ home, away, seed: 43 })), MAX_BOUT_TICKS - 1)
    expect(beforeLimit.phase).toBe('running')
    expect(beforeLimit.encounter.tick).toBe(MAX_BOUT_TICKS - 1)

    let tied = beforeLimit.encounter
    for (const id of [beforeLimit.descriptor.homeId, beforeLimit.descriptor.awayId]) {
      tied = patchCombatant(tied, id, { hp: tied.combatants[id].definition.maxHp })
    }
    const state = advanceBattleTick({ ...beforeLimit, encounter: tied })

    expect(state.phase).toBe('finished')
    expect(state.finishReason).toBe('time-limit')
    expect(state.encounter.tick).toBe(MAX_BOUT_TICKS)
    const homeFighter = fighterBySide(state, 'home')
    const awayFighter = fighterBySide(state, 'away')
    expect(homeFighter.hp / homeFighter.definition.maxHp).toBe(awayFighter.hp / awayFighter.definition.maxHp)

    const candidates = [state.descriptor.homeId, state.descriptor.awayId].sort()
    const unit = derivedUnitValue(state.encounter.seed, `time-limit-tie:${MAX_BOUT_TICKS}:${candidates.join(',')}`)
    const expectedWinnerId = unit < 0.5 ? candidates[0] : candidates[1]
    const expectedSide = expectedWinnerId === state.descriptor.homeId ? 'home' : 'away'
    expect(state.winnerSide).toBe(expectedSide)
    expect(state.events.at(-1)).toMatchObject({ type: 'encounter-finished', reason: 'time-limit', winnerIds: [expectedWinnerId] })
  })

  it('accepts a lethal scheduled contact landing exactly on tick 3600 before the duel timeout, without a duplicate finish', () => {
    const descriptor: DuelDescriptor = { homeId: 'home.brutus', awayId: 'away.drusus' }
    const created = createEncounter({
      seed: 1,
      combatants: [
        combatant(descriptor.homeId, 'home', { archetype: 'fast', startPosition: { x: 0, z: 0 } }),
        combatant(descriptor.awayId, 'away', { archetype: 'fast', startPosition: { x: 1, z: 0 } }),
      ],
      arena: freeArena,
      hostility: { mode: 'different-factions' },
      combatStyles: COMBAT_STYLES,
    })
    let encounter = patchCombatant(created.state, descriptor.homeId, {
      targetId: undefined,
      nextDecisionTick: 999_999,
      facing: { x: 1, z: 0 },
      action: {
        type: 'active',
        instanceId: `${descriptor.homeId}:0`,
        definitionId: 'fast-slash',
        phase: 'windup',
        phaseStartedTick: MAX_BOUT_TICKS - 1,
        phaseEndsAtTick: MAX_BOUT_TICKS,
        targetId: descriptor.awayId,
        attackRolls: { accuracy: 0.1, critical: 0.9 },
      },
    })
    encounter = patchCombatant(encounter, descriptor.awayId, {
      targetId: undefined,
      nextDecisionTick: 999_999,
      locomotionIntent: 'hold-range',
      facing: { x: -1, z: 0 },
      action: { type: 'neutral' },
      hp: 1,
    })
    encounter = { ...encounter, tick: MAX_BOUT_TICKS - 1 }

    const before: BattleState = { descriptor, encounter, phase: 'running', events: [], traceHash: 0 }
    const after = advanceBattleTick(before)

    expect(after.phase).toBe('finished')
    expect(after.encounter.tick).toBe(MAX_BOUT_TICKS)
    expect(after.finishReason).toBe('defeat')
    expect(after.winnerSide).toBe('home')
    const finishes = after.events.filter((event) => event.type === 'encounter-finished')
    expect(finishes).toHaveLength(1)
    expect(finishes[0]).toMatchObject({ reason: 'no-hostile-pairs' })
  })

  it('computes matchup damage from actor toward target on both sides, never a stored home-perspective comparison', () => {
    function singleHitDamage(actorArchetype: Archetype, targetArchetype: Archetype): number {
      const descriptor: DuelDescriptor = { homeId: 'home.actor', awayId: 'away.target' }
      const created = createEncounter({
        seed: 5,
        combatants: [
          combatant(descriptor.homeId, 'home', { archetype: actorArchetype, startPosition: { x: 0, z: 0 } }),
          combatant(descriptor.awayId, 'away', { archetype: targetArchetype, startPosition: { x: 1.5, z: 0 } }),
        ],
        arena: freeArena,
        hostility: { mode: 'different-factions' },
        combatStyles: COMBAT_STYLES,
      })
      let encounter = patchCombatant(created.state, descriptor.homeId, {
        targetId: undefined,
        nextDecisionTick: 999_999,
        facing: { x: 1, z: 0 },
        action: {
          type: 'active',
          instanceId: `${descriptor.homeId}:0`,
          definitionId: 'technical-thrust',
          phase: 'windup',
          phaseStartedTick: 9,
          phaseEndsAtTick: 10,
          targetId: descriptor.awayId,
          attackRolls: { accuracy: 0.01, critical: 0.99 },
        },
      })
      encounter = patchCombatant(encounter, descriptor.awayId, {
        targetId: undefined,
        nextDecisionTick: 999_999,
        locomotionIntent: 'hold-range',
        facing: { x: -1, z: 0 },
        action: { type: 'neutral' },
      })
      encounter = { ...encounter, tick: 9 }

      const before: BattleState = { descriptor, encounter, phase: 'running', events: [], traceHash: 0 }
      const after = advanceBattleTick(before)
      const damageEvent = after.events.find((event) => event.type === 'damage-dealt')
      if (!damageEvent || damageEvent.type !== 'damage-dealt') throw new Error('Expected a damage-dealt event')
      return damageEvent.amount
    }

    const power = 20
    const damageMultiplier = COMBAT_STYLES.attacks['technical-thrust'].damageMultiplier
    const expected = (actor: Archetype, target: Archetype) =>
      Math.max(1, Math.round(power * damageMultiplier * comparisonDamageMultiplier(compareArchetypes(actor, target))))

    expect(singleHitDamage('heavy', 'fast')).toBe(expected('heavy', 'fast'))
    expect(singleHitDamage('fast', 'heavy')).toBe(expected('fast', 'heavy'))
    expect(singleHitDamage('heavy', 'fast')).not.toBe(singleHitDamage('fast', 'heavy'))
  })

  it('produces an identical complete duel log and trace hash across two runs of the same seed', () => {
    const config = baseConfig({ home: brutus, away: drusus, seed: 123 })
    const first = finished(config)
    const second = finished(config)
    expect(first.events).toEqual(second.events)
    expect(first.traceHash).toBe(second.traceHash)
    expect(first.events.length).toBeGreaterThan(1)
  })

  it('a changed seed changes the trace hash', () => {
    const hashes = [1, 2, 3].map((seed) => finished(baseConfig({ home: brutus, away: drusus, seed })).traceHash)
    expect(new Set(hashes).size).toBeGreaterThan(1)
  })

  // CANONICAL HASH FREEZE DEFERRED (Task 13 Step 6) -- see the matching note in
  // `encounter.test.ts`. This is the adapter-duel site, the literal Task 19
  // reuses for its Chromium cross-runtime check, which makes it the most
  // load-bearing value in the freeze and the one least worth freezing twice: two
  // further conformance fixes and an open question on the content calibration all
  // move it.
  //
  // The properties the eventual literal depends on are asserted here now, so the
  // adapter cannot regress into a non-decisive or non-deterministic duel while
  // the literal is withheld.
  it('folds a deterministic trace of a complete, decisive adapter duel', () => {
    const config = baseConfig({ home: brutus, away: drusus, seed: 123 })
    const first = finished(config)
    const second = finished(config)

    expect(formatTraceHash(first.traceHash)).toMatch(/^[0-9a-f]{8}$/)
    expect(first.traceHash).toBe(second.traceHash)
    expect(first.finishReason).toBe('defeat')
    expect(first.winnerSide).toBe('home')
    expect(first.encounter.tick).toBeLessThan(MAX_BOUT_TICKS)
    expect(first.events.filter((event) => event.type === 'fighter-defeated')).toHaveLength(1)
    expect(first.events.filter((event) => event.type === 'encounter-finished')).toHaveLength(1)
  })

  it('does not shift the away encounter beyond one tick when only advanceBattleTick is called', () => {
    const battle = createBattle(baseConfig())
    const next = advanceBattleTick(battle)
    expect(next.encounter.tick).toBe(1)
    expect(next.phase).toBe('running')
  })

  it('returns the same reference once finished (inert past completion)', () => {
    const state = finished(baseConfig({ seed: 3 }))
    expect(advanceBattleTick(state)).toBe(state)
  })
})
