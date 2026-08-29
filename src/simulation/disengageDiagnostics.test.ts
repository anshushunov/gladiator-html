import { describe, expect, it } from 'vitest'
import { COMBAT_STYLES } from '../content/combatStyles'
import { BASELINE_TEST_SEED, homeRoster, opponents } from '../content/mvpSeries'
import { combatant, freeArena } from '../testSupport/combatFixtures'
import { canonicalHash } from '../testSupport/stateHash'
import { advanceBattleTick, createBattle, MAX_BOUT_TICKS, type BattleState } from './battle'
import { FAST_FORCED_DISENGAGE_END_RANGE, FAST_FORCED_DISENGAGE_MAX_TICKS } from './combatDecision'
import { assembleDisengageEpisodes, type DisengageAssembly, type DisengageCollector, type DisengageEpisode, type DisengageSample } from './disengageDiagnostics'
import { advanceEncounterTick, createEncounter, type CombatantId } from './encounter'
import { distanceBetween } from './movement'

const home = (id: string) => homeRoster.find((fighter) => fighter.id === id)!
const away = (id: string) => opponents.find((fighter) => fighter.id === id)!

/**
 * `aquila` vs `drusus` is the Fast mirror, and it is chosen deliberately over
 * the more obvious `aquila vs magnus`.
 *
 * Measured across the nine shipped pairings at `BASELINE_TEST_SEED`: `aquila
 * vs magnus` produces **six episodes and all six end on the cap**, so a
 * corroboration test written against it would assert the `range` branch
 * without ever executing it and would pass just as happily if that branch were
 * broken. The mirror produces three `range` and two `cap`, and it has two Fast
 * fighters, so it also exercises the interleaving the assembler has to get
 * right. The all-cap result is itself the slice's subject matter and is
 * recorded in the journal rather than tested here.
 */
function runBout(disengageCollector?: DisengageCollector, seed: number = BASELINE_TEST_SEED): { hash: string; ticks: number } {
  let battle = createBattle({ home: home('aquila'), away: away('drusus'), seed, combatStyles: COMBAT_STYLES })
  let rolling = canonicalHash(battle)
  let ticks = 0
  for (let i = 0; i < MAX_BOUT_TICKS && battle.encounter.phase !== 'finished'; i += 1) {
    battle = advanceBattleTick(battle, undefined, undefined, disengageCollector)
    rolling = canonicalHash({ rolling, state: battle })
    ticks += 1
  }
  return { hash: rolling, ticks }
}

function collectEpisodes(seed?: number): DisengageAssembly {
  const samples: DisengageSample[] = []
  runBout({ record: (sample) => samples.push(sample) }, seed)
  return assembleDisengageEpisodes(samples)
}

const actor = 'home' as CombatantId
const other = 'away' as CombatantId
const foe = 'foe' as CombatantId
const otherFoe = 'other-foe' as CombatantId

describe('assembleDisengageEpisodes', () => {
  it('pairs a stamp with its clear and reports the endpoints, elapsed ticks and reason', () => {
    const { episodes } = assembleDisengageEpisodes([
      { kind: 'stamped', tick: 100, actorId: actor, targetId: foe, separation: 1.8 },
      { kind: 'held', tick: 101, actorId: actor, targetId: foe, separation: 2.1, externalSeparationDelta: 0 },
      { kind: 'held', tick: 102, actorId: actor, targetId: foe, separation: 2.9, externalSeparationDelta: 0 },
      { kind: 'cleared', tick: 103, actorId: actor, targetId: foe, separation: 3.4, externalSeparationDelta: 0, reason: 'range' },
    ])

    expect(episodes).toEqual<DisengageEpisode[]>([
      { actorId: actor, targetId: foe, startTick: 100, endTick: 103, ticks: 3, startSeparation: 1.8, endSeparation: 3.4, reason: 'range', externalGround: 0 },
    ])
  })

  // The design's §4.0: dropping open episodes would bias every completion rate
  // computed from these records toward the ones that finished -- and the ones
  // that do not finish are the pinned ones, which is the population the slice
  // exists to measure.
  it('keeps an episode still open at the end of the bout, as `censored`, with its last observed endpoint', () => {
    const { episodes } = assembleDisengageEpisodes([
      { kind: 'stamped', tick: 40, actorId: actor, targetId: foe, separation: 1.6 },
      { kind: 'held', tick: 41, actorId: actor, targetId: foe, separation: 1.9, externalSeparationDelta: 0 },
      { kind: 'held', tick: 42, actorId: actor, targetId: foe, separation: 2.2, externalSeparationDelta: 0 },
    ])

    expect(episodes).toEqual<DisengageEpisode[]>([
      { actorId: actor, targetId: foe, startTick: 40, endTick: 42, ticks: 2, startSeparation: 1.6, endSeparation: 2.2, reason: 'censored', externalGround: 0 },
    ])
  })

  it('censors an episode stamped on the very last tick as a zero-tick episode rather than dropping it', () => {
    const { episodes } = assembleDisengageEpisodes([{ kind: 'stamped', tick: 900, actorId: actor, targetId: foe, separation: 1.55 }])

    expect(episodes).toEqual<DisengageEpisode[]>([
      { actorId: actor, targetId: foe, startTick: 900, endTick: 900, ticks: 0, startSeparation: 1.55, endSeparation: 1.55, reason: 'censored', externalGround: 0 },
    ])
  })

  it('keeps two fighters’ interleaved episodes apart and orders the output deterministically', () => {
    const { episodes } = assembleDisengageEpisodes([
      { kind: 'stamped', tick: 10, actorId: other, targetId: foe, separation: 2.0 },
      { kind: 'stamped', tick: 11, actorId: actor, targetId: foe, separation: 1.7 },
      { kind: 'held', tick: 11, actorId: other, targetId: foe, separation: 2.4, externalSeparationDelta: 0 },
      { kind: 'cleared', tick: 12, actorId: other, targetId: foe, separation: 3.4, externalSeparationDelta: 0, reason: 'range' },
      { kind: 'cleared', tick: 48, actorId: actor, targetId: foe, separation: 1.2, externalSeparationDelta: 0, reason: 'cap' },
    ])

    expect(episodes.map((episode) => [episode.actorId, episode.startTick, episode.ticks, episode.reason])).toEqual([
      [other, 10, 2, 'range'],
      [actor, 11, 37, 'cap'],
    ])
  })

  // Both are unreachable today (phase 4 skips forced actors, so a fighter
  // cannot start the lunge that would re-stamp it mid-episode). They throw
  // precisely so that a later PR making one reachable stops the run instead of
  // silently emitting an episode with the wrong endpoints.
  it('raises on a clear with no open episode rather than inventing a start', () => {
    expect(() =>
      assembleDisengageEpisodes([{ kind: 'cleared', tick: 5, actorId: actor, targetId: foe, separation: 3.4, externalSeparationDelta: 0, reason: 'range' }]),
    ).toThrow(
      /no open episode/,
    )
  })

  it('raises on a second stamp before the first was cleared', () => {
    expect(() =>
      assembleDisengageEpisodes([
        { kind: 'stamped', tick: 5, actorId: actor, targetId: foe, separation: 1.7 },
        { kind: 'stamped', tick: 6, actorId: actor, targetId: foe, separation: 1.9 },
      ]),
    ).toThrow(/still open/)
  })

  // External review's finding, and the sharpest one: grouping by `actorId`
  // alone lets an episode start against one opponent and end against another,
  // and the difference gets reported as ground opened. Unreachable in a duel;
  // perfectly reachable in the generic kernel, where phase 3 can retarget a
  // fighter mid-episode.
  //
  // Note the shape of the numbers: 1.7 to 3.4 against a *different* fighter
  // would read as a textbook 1.7-unit successful escape.
  it('reports, rather than emits, an episode whose endpoints are against two different opponents', () => {
    const { episodes, unmeasurable } = assembleDisengageEpisodes([
      { kind: 'stamped', tick: 5, actorId: actor, targetId: foe, separation: 1.7 },
      { kind: 'held', tick: 6, actorId: actor, targetId: foe, separation: 2.0, externalSeparationDelta: 0 },
      { kind: 'cleared', tick: 7, actorId: actor, targetId: otherFoe, separation: 3.4, externalSeparationDelta: 0, reason: 'range' },
    ])

    expect(episodes).toEqual([])
    expect(unmeasurable).toEqual([{ actorId: actor, startTick: 5, tick: 7, cause: 'target-changed' }])
  })

  it('reports an episode with no target rather than treating an infinite separation as an escape', () => {
    expect(assembleDisengageEpisodes([{ kind: 'stamped', tick: 5, actorId: actor, targetId: undefined, separation: Infinity }])).toEqual({
      episodes: [],
      unmeasurable: [{ actorId: actor, startTick: 5, tick: 5, cause: 'no-target' }],
    })

    expect(
      assembleDisengageEpisodes([
        { kind: 'stamped', tick: 5, actorId: actor, targetId: foe, separation: 1.7 },
        { kind: 'cleared', tick: 6, actorId: actor, targetId: undefined, separation: Infinity, externalSeparationDelta: 0, reason: 'range' },
      ]),
    ).toEqual({ episodes: [], unmeasurable: [{ actorId: actor, startTick: 5, tick: 6, cause: 'no-target' }] })
  })

  // Round 2 of external review: throwing on an unmeasurable episode destroyed
  // every valid episode in the same run, and unmeasurable episodes are ordinary
  // in a free-for-all. One bad episode must not take the other 2414 with it.
  it('keeps every measurable episode in a stream that also contains an unmeasurable one', () => {
    const { episodes, unmeasurable } = assembleDisengageEpisodes([
      { kind: 'stamped', tick: 10, actorId: other, targetId: foe, separation: 1.7 },
      { kind: 'stamped', tick: 11, actorId: actor, targetId: foe, separation: 1.6 },
      { kind: 'cleared', tick: 13, actorId: other, targetId: undefined, separation: Infinity, externalSeparationDelta: 0, reason: 'range' },
      { kind: 'cleared', tick: 14, actorId: actor, targetId: foe, separation: 3.4, externalSeparationDelta: 0, reason: 'range' },
    ])

    expect(episodes.map((episode) => episode.actorId)).toEqual([actor])
    expect(unmeasurable.map((episode) => episode.actorId)).toEqual([other])
  })

  // The property a rate can be built on, and the reason unmeasurable episodes
  // are reported rather than dropped: the denominator is still the real number
  // of episodes.
  it('puts every stamped episode in exactly one of the two collections', () => {
    const samples: DisengageSample[] = [
      { kind: 'stamped', tick: 1, actorId: actor, targetId: foe, separation: 1.5 },
      { kind: 'cleared', tick: 2, actorId: actor, targetId: foe, separation: 3.4, externalSeparationDelta: 0, reason: 'range' },
      { kind: 'stamped', tick: 3, actorId: other, targetId: undefined, separation: Infinity },
      { kind: 'cleared', tick: 4, actorId: other, targetId: undefined, separation: Infinity, externalSeparationDelta: 0, reason: 'range' },
      { kind: 'stamped', tick: 5, actorId: actor, targetId: foe, separation: 1.5 },
      { kind: 'held', tick: 6, actorId: actor, targetId: foe, separation: 1.9, externalSeparationDelta: 0 },
    ]
    const { episodes, unmeasurable } = assembleDisengageEpisodes(samples)

    expect(episodes.length + unmeasurable.length).toBe(samples.filter((sample) => sample.kind === 'stamped').length)
  })

  // Still fatal, and deliberately: a resolved target with an infinite distance
  // between two finite positions is a broken kernel, not an ordinary state.
  //
  // All three kinds, because round 3 of external review found that a version
  // of this test asserting only the middle case gave its name to a check that
  // did not cover the other two -- a `stamped` sample skipped validation
  // entirely and could open an episode with a `NaN` start separation, and a
  // sample that both retargeted and went non-finite took the `target-changed`
  // branch instead.
  it('raises on a resolved target reporting a non-finite separation, whichever sample carries it', () => {
    expect(() => assembleDisengageEpisodes([{ kind: 'stamped', tick: 5, actorId: actor, targetId: foe, separation: Number.NaN }])).toThrow(
      /non-finite separation/,
    )

    expect(() =>
      assembleDisengageEpisodes([
        { kind: 'stamped', tick: 5, actorId: actor, targetId: foe, separation: 1.7 },
        { kind: 'cleared', tick: 6, actorId: actor, targetId: foe, separation: Number.NaN, externalSeparationDelta: 0, reason: 'range' },
      ]),
    ).toThrow(/non-finite separation/)

    expect(() =>
      assembleDisengageEpisodes([
        { kind: 'stamped', tick: 5, actorId: actor, targetId: foe, separation: 1.7 },
        { kind: 'held', tick: 6, actorId: actor, targetId: otherFoe, separation: Infinity, externalSeparationDelta: 0 },
      ]),
    ).toThrow(/non-finite separation/)
  })

  it('sums the external component of every tick into the episode', () => {
    const assembly = assembleDisengageEpisodes([
      { kind: 'stamped', tick: 10, actorId: 'a', targetId: 'b', separation: 1.0 },
      { kind: 'held', tick: 11, actorId: 'a', targetId: 'b', separation: 1.4, externalSeparationDelta: 0.3 },
      { kind: 'held', tick: 12, actorId: 'a', targetId: 'b', separation: 1.7, externalSeparationDelta: 0 },
      { kind: 'cleared', tick: 13, actorId: 'a', targetId: 'b', separation: 2.1, externalSeparationDelta: 0.2, reason: 'progress' },
    ])

    expect(assembly.episodes).toHaveLength(1)
    expect(assembly.episodes[0].externalGround).toBeCloseTo(0.5, 10)
  })

  it('reports zero external ground when nothing pushed anyone', () => {
    const assembly = assembleDisengageEpisodes([
      { kind: 'stamped', tick: 10, actorId: 'a', targetId: 'b', separation: 1.0 },
      { kind: 'cleared', tick: 11, actorId: 'a', targetId: 'b', separation: 2.0, externalSeparationDelta: 0, reason: 'progress' },
    ])

    expect(assembly.episodes[0].externalGround).toBe(0)
  })
})

describe('the disengage seam against a real bout', () => {
  // The claim this whole PR makes, proved locally as well as by
  // `stateHash.test.ts`'s nine digests: the same bout, rolled tick by tick,
  // hashes identically with and without a collector attached. A seam that
  // moved anything would move this.
  it('is inert: the same bout hashes identically with and without a collector', () => {
    const withoutCollector = runBout()
    const samples: DisengageSample[] = []
    const withCollector = runBout({ record: (sample) => samples.push(sample) })

    expect(withCollector.hash).toBe(withoutCollector.hash)
    expect(withCollector.ticks).toBe(withoutCollector.ticks)
    // ...and the collector was actually fed, or the assertion above is a
    // tautology about two runs that both did nothing.
    expect(samples.length).toBeGreaterThan(0)
  }, 30_000)

  // One of the two bounds on what a collector can do, and NOT the whole story:
  // review round 3 was right that a payload-shape assertion does not establish
  // inertness, because a collector can go looking for state instead of being
  // handed it. Measured, and recorded as a debt rather than tested here as a
  // guarantee: a returning collector that mutates `previous.encounter.
  // combatants[id].position` moves this bout's digest from `7e5009f3` to
  // `c13df37`. What this test does pin is the narrower fact the module header
  // claims -- the kernel passes nothing reachable out, so breaking the tick
  // takes deliberate reaching rather than an accident with a shared reference.
  it('hands the collector nothing it could mutate', () => {
    const samples: DisengageSample[] = []
    runBout({ record: (sample) => samples.push(sample) })

    expect(samples.length).toBeGreaterThan(0)
    for (const sample of samples) {
      for (const value of Object.values(sample)) {
        expect(value === null || typeof value !== 'object').toBe(true)
      }
    }
  }, 30_000)

  it('records episodes whose reason is corroborated by the recorded endpoints', () => {
    const { episodes, unmeasurable } = collectEpisodes()

    // A duel cannot lose or change its target, so nothing here is unmeasurable.
    expect(unmeasurable).toEqual([])

    // Coverage guard, not decoration. The first version of this test ran
    // against a pairing whose episodes all ended on the cap, so the `range`
    // clause below never executed. If a later change empties one of these
    // populations, this fails loudly instead of the loop going half-vacuous.
    expect(new Set(episodes.map((episode) => episode.reason))).toEqual(new Set(['range', 'cap']))

    for (const episode of episodes) {
      expect(Number.isFinite(episode.startSeparation)).toBe(true)
      expect(Number.isFinite(episode.endSeparation)).toBe(true)
      expect(episode.ticks).toBe(episode.endTick - episode.startTick)
      expect(episode.ticks).toBeGreaterThanOrEqual(0)

      // This is the check the design spec requires of every gate built on
      // these records, run here against the seam itself: the label must be
      // true of the endpoints, not merely reported.
      if (episode.reason === 'range') {
        expect(episode.endSeparation).toBeGreaterThanOrEqual(FAST_FORCED_DISENGAGE_END_RANGE)
      }
      if (episode.reason === 'cap') {
        expect(episode.ticks).toBe(FAST_FORCED_DISENGAGE_MAX_TICKS)
        expect(episode.endSeparation).toBeLessThan(FAST_FORCED_DISENGAGE_END_RANGE)
      }
      // `progress` has no producer yet; if one appears without this file
      // learning what corroborates it, that is the failure to notice.
      expect(episode.reason).not.toBe('progress')
    }
  }, 30_000)

  // Censoring is not hypothetical: swept across 60 seeds x 9 pairings (540
  // bouts, 1889 episodes), 17 episodes -- 0.9% -- are still open when the bout
  // ends, and one of them lasted 0 ticks because it was stamped on the final
  // tick. None of them fall at `BASELINE_TEST_SEED`, hence the pinned seed
  // here; it was found by that sweep and a content change may well move it, in
  // which case this test should be re-pinned rather than deleted.
  it('keeps a real bout’s still-open episode instead of dropping it', () => {
    const { episodes } = collectEpisodes(20260836)
    const censored = episodes.filter((episode) => episode.reason === 'censored')

    expect(censored).toHaveLength(1)
    expect(censored[0].ticks).toBe(censored[0].endTick - censored[0].startTick)
    expect(censored[0].endSeparation).toBeLessThan(FAST_FORCED_DISENGAGE_END_RANGE)
    expect(censored[0].ticks).toBeLessThan(FAST_FORCED_DISENGAGE_MAX_TICKS)
  }, 30_000)

  // The window the seam exists to correct, tested by DIFFERENCE rather than by
  // plausibility.
  //
  // A first version of this asserted only that the start separations sat
  // between 0 and 3.35 and near the lunge's contact range. External review
  // pointed out that a post-retreat separation satisfies all three, so the test
  // would have gone on passing with the one-tick window defect restored --
  // which is the entire defect this file exists to fix.
  //
  // This compares the recorded number against the two states it must be
  // distinguished from: the state before the advance (which it must equal
  // exactly, since phases 1-2 move nobody, so that state IS the phase-2 state)
  // and the state after the advance (which is what a harness reading
  // `advanceBattleTick`'s result sees, and which includes this tick's
  // movement, contact and push).
  it('records the phase-2 separation, not the one visible after the advance', () => {
    interface Observation {
      kind: DisengageSample['kind']
      recorded: number
      beforeAdvance: number
      afterAdvance: number
    }

    const separationIn = (state: BattleState, a: CombatantId, b: CombatantId) =>
      distanceBetween(state.encounter.combatants[a].position, state.encounter.combatants[b].position)

    const observations: Observation[] = []
    let battle = createBattle({ home: home('aquila'), away: away('drusus'), seed: BASELINE_TEST_SEED, combatStyles: COMBAT_STYLES })
    for (let i = 0; i < MAX_BOUT_TICKS && battle.encounter.phase !== 'finished'; i += 1) {
      const beforeAdvance = battle
      const captured: DisengageSample[] = []
      battle = advanceBattleTick(battle, undefined, undefined, { record: (sample) => captured.push(sample) })
      for (const sample of captured) {
        observations.push({
          kind: sample.kind,
          recorded: sample.separation,
          beforeAdvance: separationIn(beforeAdvance, sample.actorId, sample.targetId!),
          afterAdvance: separationIn(battle, sample.actorId, sample.targetId!),
        })
      }
    }

    expect(observations.length).toBeGreaterThan(0)
    for (const observation of observations) {
      expect(observation.recorded).toBe(observation.beforeAdvance)
    }

    // ...and the two states are genuinely different, or the assertion above is
    // a statement about a tick in which nothing happened. This is the part
    // that would have failed on the old, undiscriminating version.
    const moved = observations.filter((observation) => observation.afterAdvance !== observation.recorded)
    expect(moved.length).toBeGreaterThan(observations.length / 2)

    // The clear end specifically: phase 4's ordinary decision and phases 7-8's
    // ordinary movement run in the SAME advance that cleared the field, so a
    // harness sampling after it is not reading the exit separation at all.
    const clears = observations.filter((observation) => observation.kind === 'cleared')
    expect(clears.length).toBeGreaterThan(0)
    expect(clears.some((observation) => observation.afterAdvance !== observation.recorded)).toBe(true)
  }, 30_000)
})

// `advanceEncounterTick` is the GENERIC kernel, not the duel adapter, and the
// first version of this seam was reviewed against the duel and justified with
// a fact about the duel's arena. Both of the states below were argued to be
// unreachable; both turn out to be ordinary in a three-fighter free-for-all,
// measured across 40 seeds:
//
//   - a fighter with NO target during an open episode: 12 of 40 seeds;
//   - a fighter RETARGETED during an open episode: 3 of 40 seeds
//     (20260829, 20260835, 20260837), 8 to 21 samples each.
//
// The baseline seed is one of the twelve. So the old kernel, which raised on a
// non-finite separation, would have thrown on the very first FFA anyone
// attached a collector to.
describe('the disengage seam outside the duel', () => {
  const threeWayFfa = (seed: number) => ({
    seed,
    combatants: [
      combatant('a', 'fa', { archetype: 'fast' as const, startPosition: { x: -2, z: 0 } }),
      combatant('b', 'fb', { archetype: 'heavy' as const, startPosition: { x: 2, z: 0 } }),
      combatant('c', 'fc', { archetype: 'technical' as const, startPosition: { x: 0, z: 3 } }),
    ],
    arena: freeArena,
    hostility: { mode: 'free-for-all' as const },
    combatStyles: COMBAT_STYLES,
  })

  function runFfa(seed: number, collector?: DisengageCollector): string {
    const created = createEncounter(threeWayFfa(seed))
    let state = created.state
    let rolling = canonicalHash({ state, events: created.events })
    for (let i = 0; i < MAX_BOUT_TICKS && state.phase === 'running'; i += 1) {
      const transition = advanceEncounterTick(state, undefined, undefined, collector)
      state = transition.state
      rolling = canonicalHash({ rolling, state, events: transition.events })
    }
    return rolling
  }

  it('is inert in a multi-combatant encounter, including on the ticks where a fighter has no target', () => {
    const samples: DisengageSample[] = []

    expect(runFfa(BASELINE_TEST_SEED, { record: (sample) => samples.push(sample) })).toBe(runFfa(BASELINE_TEST_SEED))

    // The case the kernel used to raise on. It has to be present, or this test
    // proves only that two ordinary runs agree.
    expect(samples.some((sample) => sample.targetId === undefined)).toBe(true)
  }, 30_000)

  it('sets a real targetless episode aside without losing the measurable ones around it', () => {
    const samples: DisengageSample[] = []
    runFfa(BASELINE_TEST_SEED, { record: (sample) => samples.push(sample) })
    const { episodes, unmeasurable } = assembleDisengageEpisodes(samples)

    expect(unmeasurable.some((episode) => episode.cause === 'no-target')).toBe(true)
    // The point of round 2's finding: the run still yields its good episodes.
    // The previous revision threw here and returned nothing at all.
    expect(episodes.length).toBeGreaterThan(0)
    expect(episodes.length + unmeasurable.length).toBe(samples.filter((sample) => sample.kind === 'stamped').length)
  }, 30_000)

  it('sets aside a real episode whose target changed while it was open', () => {
    const samples: DisengageSample[] = []
    runFfa(20260837, { record: (sample) => samples.push(sample) })
    const { episodes, unmeasurable } = assembleDisengageEpisodes(samples)

    expect(unmeasurable.some((episode) => episode.cause === 'target-changed')).toBe(true)
    expect(episodes.length + unmeasurable.length).toBe(samples.filter((sample) => sample.kind === 'stamped').length)
    // Not a synthetic stream: this seed retargets the Fast fighter 21 times
    // inside open episodes. Assembling it before the fix produced episodes
    // whose two endpoints were measured against two different opponents.
    for (const episode of episodes) {
      expect(episode.targetId).toBeDefined()
    }
  }, 30_000)
})
