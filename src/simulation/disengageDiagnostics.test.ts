import { describe, expect, it } from 'vitest'
import { COMBAT_STYLES } from '../content/combatStyles'
import { BASELINE_TEST_SEED, homeRoster, opponents } from '../content/mvpSeries'
import { canonicalHash } from '../testSupport/stateHash'
import { advanceBattleTick, createBattle, MAX_BOUT_TICKS } from './battle'
import { FAST_FORCED_DISENGAGE_END_RANGE, FAST_FORCED_DISENGAGE_MAX_TICKS } from './combatDecision'
import { assembleDisengageEpisodes, type DisengageCollector, type DisengageEpisode, type DisengageSample } from './disengageDiagnostics'
import type { CombatantId } from './encounter'

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

describe('assembleDisengageEpisodes', () => {
  it('pairs a stamp with its clear and reports the endpoints, elapsed ticks and reason', () => {
    const episodes = assembleDisengageEpisodes([
      { kind: 'stamped', tick: 100, actorId: actor, separation: 1.8 },
      { kind: 'held', tick: 101, actorId: actor, separation: 2.1 },
      { kind: 'held', tick: 102, actorId: actor, separation: 2.9 },
      { kind: 'cleared', tick: 103, actorId: actor, separation: 3.4, reason: 'range' },
    ])

    expect(episodes).toEqual<DisengageEpisode[]>([
      { actorId: actor, startTick: 100, endTick: 103, ticks: 3, startSeparation: 1.8, endSeparation: 3.4, reason: 'range' },
    ])
  })

  // The design's §4.0: dropping open episodes would bias every completion rate
  // computed from these records toward the ones that finished -- and the ones
  // that do not finish are the pinned ones, which is the population the slice
  // exists to measure.
  it('keeps an episode still open at the end of the bout, as `censored`, with its last observed endpoint', () => {
    const episodes = assembleDisengageEpisodes([
      { kind: 'stamped', tick: 40, actorId: actor, separation: 1.6 },
      { kind: 'held', tick: 41, actorId: actor, separation: 1.9 },
      { kind: 'held', tick: 42, actorId: actor, separation: 2.2 },
    ])

    expect(episodes).toEqual<DisengageEpisode[]>([
      { actorId: actor, startTick: 40, endTick: 42, ticks: 2, startSeparation: 1.6, endSeparation: 2.2, reason: 'censored' },
    ])
  })

  it('censors an episode stamped on the very last tick as a zero-tick episode rather than dropping it', () => {
    const episodes = assembleDisengageEpisodes([{ kind: 'stamped', tick: 900, actorId: actor, separation: 1.55 }])

    expect(episodes).toEqual<DisengageEpisode[]>([
      { actorId: actor, startTick: 900, endTick: 900, ticks: 0, startSeparation: 1.55, endSeparation: 1.55, reason: 'censored' },
    ])
  })

  it('keeps two fighters’ interleaved episodes apart and orders the output deterministically', () => {
    const episodes = assembleDisengageEpisodes([
      { kind: 'stamped', tick: 10, actorId: other, separation: 2.0 },
      { kind: 'stamped', tick: 11, actorId: actor, separation: 1.7 },
      { kind: 'held', tick: 11, actorId: other, separation: 2.4 },
      { kind: 'cleared', tick: 12, actorId: other, separation: 3.4, reason: 'range' },
      { kind: 'cleared', tick: 48, actorId: actor, separation: 1.2, reason: 'cap' },
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
    expect(() => assembleDisengageEpisodes([{ kind: 'cleared', tick: 5, actorId: actor, separation: 3.4, reason: 'range' }])).toThrow(
      /no open episode/,
    )
  })

  it('raises on a second stamp before the first was cleared', () => {
    expect(() =>
      assembleDisengageEpisodes([
        { kind: 'stamped', tick: 5, actorId: actor, separation: 1.7 },
        { kind: 'stamped', tick: 6, actorId: actor, separation: 1.9 },
      ]),
    ).toThrow(/still open/)
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

  // The window the seam exists to correct. An episode is stamped the instant a
  // burst lunge's recovery ends, and phase 2 runs before that tick's movement,
  // so the start separation must still be the range the lunge left the fighter
  // at -- never the range after a first forced retreat, which is what a
  // harness reading state after `advanceBattleTick` sees.
  it('reads the start separation before the first forced retreat, not after it', () => {
    const starts = collectEpisodes().map((episode) => episode.startSeparation)

    // Read from the catalog, never a literal: a future reach change must make
    // this assertion move rather than quietly go vacuous.
    const lunge = COMBAT_STYLES.attacks['fast-burst-lunge'].contactRange
    expect(Math.max(...starts)).toBeLessThan(FAST_FORCED_DISENGAGE_END_RANGE)
    expect(Math.min(...starts)).toBeGreaterThan(0)
    // A lunge that connected leaves the pair inside its contact range plus one
    // tick of pushback; the loose bound is deliberate, since a lunge that
    // missed on geometry can end further out. What is being pinned is that
    // these are lunge-range numbers and not post-retreat ones.
    expect(Math.min(...starts)).toBeLessThan(lunge.max + 1)
  }, 30_000)
})
