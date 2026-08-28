import { describe, expect, it } from 'vitest'
import { COMBAT_STYLES } from '../content/combatStyles'
import { BASELINE_TEST_SEED, homeRoster, opponents } from '../content/mvpSeries'
import { combatant, freeArena } from '../testSupport/combatFixtures'
import { canonicalHash } from '../testSupport/stateHash'
import { advanceBattleTick, createBattle, MAX_BOUT_TICKS, type BattleState } from './battle'
import { FAST_FORCED_DISENGAGE_END_RANGE, FAST_FORCED_DISENGAGE_MAX_TICKS } from './combatDecision'
import { assembleDisengageEpisodes, type DisengageCollector, type DisengageEpisode, type DisengageSample } from './disengageDiagnostics'
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

function collectEpisodes(seed?: number): DisengageEpisode[] {
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
    const episodes = assembleDisengageEpisodes([
      { kind: 'stamped', tick: 100, actorId: actor, targetId: foe, separation: 1.8 },
      { kind: 'held', tick: 101, actorId: actor, targetId: foe, separation: 2.1 },
      { kind: 'held', tick: 102, actorId: actor, targetId: foe, separation: 2.9 },
      { kind: 'cleared', tick: 103, actorId: actor, targetId: foe, separation: 3.4, reason: 'range' },
    ])

    expect(episodes).toEqual<DisengageEpisode[]>([
      { actorId: actor, targetId: foe, startTick: 100, endTick: 103, ticks: 3, startSeparation: 1.8, endSeparation: 3.4, reason: 'range' },
    ])
  })

  // The design's §4.0: dropping open episodes would bias every completion rate
  // computed from these records toward the ones that finished -- and the ones
  // that do not finish are the pinned ones, which is the population the slice
  // exists to measure.
  it('keeps an episode still open at the end of the bout, as `censored`, with its last observed endpoint', () => {
    const episodes = assembleDisengageEpisodes([
      { kind: 'stamped', tick: 40, actorId: actor, targetId: foe, separation: 1.6 },
      { kind: 'held', tick: 41, actorId: actor, targetId: foe, separation: 1.9 },
      { kind: 'held', tick: 42, actorId: actor, targetId: foe, separation: 2.2 },
    ])

    expect(episodes).toEqual<DisengageEpisode[]>([
      { actorId: actor, targetId: foe, startTick: 40, endTick: 42, ticks: 2, startSeparation: 1.6, endSeparation: 2.2, reason: 'censored' },
    ])
  })

  it('censors an episode stamped on the very last tick as a zero-tick episode rather than dropping it', () => {
    const episodes = assembleDisengageEpisodes([{ kind: 'stamped', tick: 900, actorId: actor, targetId: foe, separation: 1.55 }])

    expect(episodes).toEqual<DisengageEpisode[]>([
      { actorId: actor, targetId: foe, startTick: 900, endTick: 900, ticks: 0, startSeparation: 1.55, endSeparation: 1.55, reason: 'censored' },
    ])
  })

  it('keeps two fighters’ interleaved episodes apart and orders the output deterministically', () => {
    const episodes = assembleDisengageEpisodes([
      { kind: 'stamped', tick: 10, actorId: other, targetId: foe, separation: 2.0 },
      { kind: 'stamped', tick: 11, actorId: actor, targetId: foe, separation: 1.7 },
      { kind: 'held', tick: 11, actorId: other, targetId: foe, separation: 2.4 },
      { kind: 'cleared', tick: 12, actorId: other, targetId: foe, separation: 3.4, reason: 'range' },
      { kind: 'cleared', tick: 48, actorId: actor, targetId: foe, separation: 1.2, reason: 'cap' },
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
    expect(() => assembleDisengageEpisodes([{ kind: 'cleared', tick: 5, actorId: actor, targetId: foe, separation: 3.4, reason: 'range' }])).toThrow(
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
  // would read as a textbook 1.7-unit successful escape. Emitting it would be
  // worse than raising.
  it('raises rather than subtract separations taken against two different opponents', () => {
    expect(() =>
      assembleDisengageEpisodes([
        { kind: 'stamped', tick: 5, actorId: actor, targetId: foe, separation: 1.7 },
        { kind: 'held', tick: 6, actorId: actor, targetId: foe, separation: 2.0 },
        { kind: 'cleared', tick: 7, actorId: actor, targetId: otherFoe, separation: 3.4, reason: 'range' },
      ]),
    ).toThrow(/switched target/)
  })

  // The other half of the same review finding. The kernel deliberately does
  // NOT raise on this -- doing so made an attached collector able to turn a
  // legitimate targetless transition into an exception, which is the opposite
  // of inert -- so the rejection has to live here, after the tick.
  it('raises on an episode with no target rather than treating an infinite separation as an escape', () => {
    expect(() => assembleDisengageEpisodes([{ kind: 'stamped', tick: 5, actorId: actor, targetId: undefined, separation: Infinity }])).toThrow(
      /cannot be measured/,
    )
    expect(() =>
      assembleDisengageEpisodes([
        { kind: 'stamped', tick: 5, actorId: actor, targetId: foe, separation: 1.7 },
        { kind: 'cleared', tick: 6, actorId: actor, targetId: undefined, separation: Infinity, reason: 'range' },
      ]),
    ).toThrow(/cannot be measured/)
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

  it('records episodes whose reason is corroborated by the recorded endpoints', () => {
    const episodes = collectEpisodes()

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
    const episodes = collectEpisodes(20260836)
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

  it('rejects, after the tick, the episode the kernel recorded with no target', () => {
    const samples: DisengageSample[] = []
    runFfa(BASELINE_TEST_SEED, { record: (sample) => samples.push(sample) })

    expect(() => assembleDisengageEpisodes(samples)).toThrow(/cannot be measured/)
  }, 30_000)

  it('rejects a real episode whose target changed while it was open', () => {
    const samples: DisengageSample[] = []
    runFfa(20260837, { record: (sample) => samples.push(sample) })

    // Not a synthetic stream: this seed retargets the Fast fighter 21 times
    // inside open episodes. Assembling it before the fix produced episodes
    // whose two endpoints were measured against two different opponents.
    expect(() => assembleDisengageEpisodes(samples)).toThrow(/switched target/)
  }, 30_000)
})
