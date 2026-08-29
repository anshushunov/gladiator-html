import { describe, expect, it } from 'vitest'
import { FAST_FORCED_DISENGAGE_END_RANGE, FAST_FORCED_DISENGAGE_MAX_TICKS } from '../simulation/combatDecision'
import type { DisengageEpisode, DisengageExitReason } from '../simulation/disengageDiagnostics'
import { corroborate, disengageStats, DISENGAGE_SUCCESS_GROUND, groundOpened, isSuccess, SUCCESS_EXIT_REASONS } from './disengageGates'

let nextStart = 0

function episodeAt(startSeparation: number, endSeparation: number, reason: DisengageExitReason, ticks: number): DisengageEpisode {
  nextStart += 1
  return {
    actorId: 'home' as DisengageEpisode['actorId'],
    targetId: 'away' as DisengageEpisode['targetId'],
    startTick: nextStart,
    endTick: nextStart + ticks,
    ticks,
    startSeparation,
    endSeparation,
    reason,
    externalGround: 0,
  }
}

/** One episode, described by the only two things the gates read: how much ground it opened and how it ended. */
const episode = (ground: number, reason: DisengageExitReason, ticks = 12, startSeparation = 1.5) =>
  episodeAt(startSeparation, startSeparation + ground, reason, ticks)

/**
 * A `range` episode has to end at or beyond the exit distance or `corroborate`
 * rejects it, so its END is pinned to the constant and the start is derived
 * backwards. Building it forwards -- start at `EXIT - ground`, end at
 * `start + ground` -- puts the end a float ulp *below* the constant for small
 * grounds, and the first version of this file did exactly that and failed its
 * own epsilon fixtures.
 */
const rangeEpisode = (ground: number, ticks = 12) =>
  episodeAt(FAST_FORCED_DISENGAGE_END_RANGE - ground, FAST_FORCED_DISENGAGE_END_RANGE, 'range', ticks)

describe('what counts as a success', () => {
  it('needs the ground, not just the label', () => {
    expect(isSuccess(rangeEpisode(DISENGAGE_SUCCESS_GROUND))).toBe(true)
    expect(isSuccess(rangeEpisode(DISENGAGE_SUCCESS_GROUND - 0.01))).toBe(false)
  })

  it('needs the label, not just the ground', () => {
    // A capped episode that happened to drift open is not an escape: the
    // fighter never cleared, the clock ran out.
    expect(isSuccess(episode(2.0, 'cap', FAST_FORCED_DISENGAGE_MAX_TICKS))).toBe(false)
    expect(isSuccess(episode(2.0, 'censored'))).toBe(false)
  })

  it('freezes which reasons may denote a success, including the one nothing produces yet', () => {
    expect([...SUCCESS_EXIT_REASONS].sort()).toEqual(['progress', 'range'])
  })

  it('measures ground from the endpoints, signed', () => {
    expect(groundOpened(episode(-0.4, 'cap', FAST_FORCED_DISENGAGE_MAX_TICKS))).toBeCloseTo(-0.4, 10)
  })
})

describe('corroborating a reason against the endpoints it was recorded beside', () => {
  it('accepts a consistent record of each reason', () => {
    expect(corroborate(rangeEpisode(1.0))).toBeUndefined()
    expect(corroborate(episode(0.2, 'cap', FAST_FORCED_DISENGAGE_MAX_TICKS))).toBeUndefined()
    expect(corroborate(episode(DISENGAGE_SUCCESS_GROUND, 'progress'))).toBeUndefined()
    expect(corroborate(episode(0.1, 'censored', 5))).toBeUndefined()
  })

  // The documented exploit, in one assertion: set the cap to 43, add an early
  // time exit at tick 42, and every episode reports `range` while not one
  // fighter reached the exit distance. The label is free; the endpoint is not.
  it('rejects a `range` that never reached the range', () => {
    expect(corroborate(episode(0.9, 'range', 8, 1.2))).toMatch(/reports 'range' but ended at/)
  })

  it('rejects a `cap` that did not run to the cap', () => {
    expect(corroborate(episode(0.2, 'cap', FAST_FORCED_DISENGAGE_MAX_TICKS - 1))).toMatch(/reports 'cap' after/)
  })

  // `progress` has no producer yet, and this is the check waiting for it: the
  // name asserts ground was made, so an episode claiming it without the frozen
  // minimum gain fails the claim its own label makes.
  it('rejects a `progress` that made no progress', () => {
    expect(corroborate(episode(DISENGAGE_SUCCESS_GROUND - 0.01, 'progress'))).toMatch(/reports 'progress' but opened/)
  })
})

describe('disengageStats', () => {
  // Round-3 external review's construction, reproduced whole. Under the
  // PREVIOUS definition -- reason corroborated by ground > 0 -- this passes gate
  // P at 25%, both of Q's medians at 0.80, and Q2. Half the claimed escapes
  // opened a millimetre. Under the ground-binding definition it must not.
  it('rejects the epsilon-success construction that passed every gate', () => {
    const episodes = [
      ...Array.from({ length: 12 }, () => rangeEpisode(0.001, 8)),
      ...Array.from({ length: 13 }, () => rangeEpisode(0.8, 20)),
      ...Array.from({ length: 38 }, () => episode(0.8, 'cap', FAST_FORCED_DISENGAGE_MAX_TICKS)),
      ...Array.from({ length: 37 }, () => episode(0.2, 'cap', FAST_FORCED_DISENGAGE_MAX_TICKS)),
    ]
    const stats = disengageStats(episodes)

    expect(stats.episodes).toBe(100)
    // 13, not 25: the twelve epsilon exits are no longer successes.
    expect(stats.successes).toBe(13)
    expect(stats.successShare).toBeCloseTo(0.13, 10)
    // ...and gate P's bar is 25%, so the construction now fails the gate it
    // used to pass. That is the whole point of this test.
    expect(stats.successShare).toBeLessThan(0.25)
    // Every record in it is internally consistent, so this is not caught by
    // corroboration -- only by what a success is allowed to mean.
    for (const item of episodes) expect(corroborate(item)).toBeUndefined()
  })

  it('counts censored episodes in P’s denominator and nowhere else', () => {
    const episodes = [rangeEpisode(1.0, 10), episode(0.9, 'censored', 30), episode(0.1, 'cap', FAST_FORCED_DISENGAGE_MAX_TICKS)]
    const stats = disengageStats(episodes)

    expect(stats.episodes).toBe(3)
    expect(stats.decided).toBe(2)
    // P: one success in three.
    expect(stats.successShare).toBeCloseTo(1 / 3, 10)
    // Q: the censored episode's 0.9 is excluded entirely. The decided
    // population is [0.1, 1.0], and `percentile` is nearest-rank --
    // `sorted[floor((n-1) * f)]` -- so its median is the LOWER of two, 0.1.
    // Asserted as the shared helper computes it, not as an average would.
    expect(stats.groundMedianDecided).toBeCloseTo(0.1, 10)
    expect(stats.groundMedianSuccesses).toBeCloseTo(1.0, 10)
  })

  // Dropping censored episodes from P would let a candidate run its failures
  // past the end of the bout and report a better share for doing it. This is
  // that candidate, and P must see through it.
  it('does not let a candidate improve P by leaving failures unfinished', () => {
    const honest = disengageStats([rangeEpisode(1.0, 10), ...Array.from({ length: 3 }, () => episode(0.1, 'cap', FAST_FORCED_DISENGAGE_MAX_TICKS))])
    const evasive = disengageStats([rangeEpisode(1.0, 10), ...Array.from({ length: 3 }, () => episode(0.1, 'censored', 30))])

    expect(honest.successShare).toBeCloseTo(0.25, 10)
    expect(evasive.successShare).toBeCloseTo(0.25, 10)
  })

  it('measures R and Q2 over decided episodes and successes respectively', () => {
    const episodes = [
      rangeEpisode(1.0, 1),
      rangeEpisode(1.0, 20),
      rangeEpisode(1.0, 30),
      rangeEpisode(1.0, 40),
      rangeEpisode(1.0, 50),
      episode(0.1, 'cap', FAST_FORCED_DISENGAGE_MAX_TICKS),
      episode(0.1, 'censored', 1),
    ]
    const stats = disengageStats(episodes)

    // R: one of the six DECIDED episodes cleared within a tick. The censored
    // one-tick episode is not counted -- it did not clear at all, so counting
    // it would report a fighter who never escaped as having escaped instantly.
    expect(stats.immediateShare).toBeCloseTo(1 / 6, 10)
    // Q2: over the five successes. Durations [1, 20, 30, 40, 50], nearest-rank
    // median `sorted[floor(4 * 0.5)]` = 30, one of them under four ticks.
    expect(stats.durationMedianSuccesses).toBe(30)
    expect(stats.subFourTickSuccessShare).toBeCloseTo(0.2, 10)
  })

  it('reports NaN rather than a flattering zero for an empty population', () => {
    const stats = disengageStats([])

    expect(stats.episodes).toBe(0)
    expect(stats.successShare).toBeNaN()
    expect(stats.groundMedianSuccesses).toBeNaN()
    expect(stats.immediateShare).toBeNaN()
  })

  it('tallies every reason, so a population that lost a category is visible', () => {
    const stats = disengageStats([rangeEpisode(1.0), episode(0.1, 'cap', FAST_FORCED_DISENGAGE_MAX_TICKS), episode(0.1, 'censored')])

    expect(stats.byReason).toEqual({ range: 1, cap: 1, progress: 0, censored: 1 })
  })
})
