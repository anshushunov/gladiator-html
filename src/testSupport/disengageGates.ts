// What the murmillo-pin slice's disengage gates count, kept out of
// `scripts/measure-reach.ts` on purpose.
//
// `scripts/` is outside tsconfig's `include` and Vitest cannot reach it, so
// classification living there is classification nobody tests. This is the same
// reason PR-1 put `distanceHarness.ts` here, and the reason matters more for
// this file than it did for that one: every number below decides whether a
// content change ships.
//
// ---------------------------------------------------------------------------
// WHAT A SUCCESS IS, AND WHY THE GROUND IS THE BINDING HALF
// ---------------------------------------------------------------------------
//
// A success is an episode that **opened at least 0.75 units of separation,
// measured from the seam's own recorded endpoints**, AND whose exit reason is
// in the frozen success set. Both, and the ground condition is the binding one.
//
// The spec's round-3 review broke the previous definition, which asked only
// that the reason be corroborated by ground `> 0`. Its construction: of 100
// episodes, 25 successes made of 12 epsilon-gain exits and 13 opening >= 0.75,
// plus 38 capped failures opening >= 0.75 and 37 opening less. Gate P reads
// 25%, both of Q's medians read 0.80, and Q2 passes -- **every gate green while
// half the claimed escapes opened a millimetre.** Worse, those premature exits
// free Fast to attack sooner, so they *help* gate V instead of colliding with
// it.
//
// Defining success by ground also removes a coupling nobody had spotted: with
// success defined by a label, the mutable predicate chose Q's success-only
// population, so Q had a comparator that moved with the candidate.
//
// ---------------------------------------------------------------------------
// AND A REASON IS NEVER EVIDENCE
// ---------------------------------------------------------------------------
//
// `corroborate` re-checks every reason against the endpoints the same run
// recorded. A record labelled `range` must satisfy the range condition at its
// recorded end separation; a `progress` record must show the frozen minimum
// gain; a `cap` record must actually have run to the cap. A label the endpoints
// contradict fails the run loudly rather than being counted.
//
// This is not defensive coding. `measure-reach.ts:281` used to *deduce* the
// reason from the episode's duration, against the very constant PR-4 makes
// mutable, and the documented exploit is to set the cap to 43 and add an early
// time exit at tick 42: every episode then reports `range` while not one
// fighter reached the exit distance. PR-2's seam removed the deduction;
// this removes the trust.
//
// ---------------------------------------------------------------------------
// CENSORING IS PER GATE, NOT GLOBAL
// ---------------------------------------------------------------------------
//
// Where a censored episode belongs is a decision the spec makes gate by gate,
// because it moves every rate and the existing gate E keeps censored records in
// its denominators:
//
//   - **P** counts `cap` and `censored` in the denominator as non-successes.
//     Dropping censored would let a candidate flatter itself by running its
//     failures past the end of the bout.
//   - **Q** excludes censored: no clear separation was ever recorded, so there
//     is no ground figure to take a median of.
//   - **Q2 and R** exclude censored, for the same reason -- the episode has no
//     end, so it has no duration to compare against a duration bar.
//
// `unmeasurable` episodes -- the ones PR-2's seam sets aside because a fighter
// lost or changed target mid-episode -- are a separate matter and are reported,
// never folded into either side. In a duel there are none, and a run that finds
// one is telling the caller something about the harness rather than the fight.

import type { DisengageEpisode, DisengageExitReason } from '../simulation/disengageDiagnostics'
import { FAST_FORCED_DISENGAGE_END_RANGE, FAST_FORCED_DISENGAGE_MAX_TICKS } from '../simulation/combatDecision'
import { percentile } from './balanceCohorts'

/**
 * Gate E's existing `DISENGAGE_GAIN_FLOOR`, reused rather than re-chosen. Gate
 * Q applies it per pair; this is the same number the pooled clause has always
 * used.
 */
export const DISENGAGE_SUCCESS_GROUND = 0.75

/**
 * The exit reasons that may denote a success. `cap` and `censored` cannot, by
 * the spec, and this set is frozen with the reason enum itself: PR-4 may
 * re-express the exit condition and may not move a reason between the success
 * and failure sets.
 *
 * `progress` is here and currently unreachable, which is the point -- the
 * pursuit-relative exit PR-4 proposes reports it, and the set it lands in was
 * fixed before the candidate existed.
 */
export const SUCCESS_EXIT_REASONS: ReadonlySet<DisengageExitReason> = new Set<DisengageExitReason>(['range', 'progress'])

/** Ground the episode opened between the two phase-2 endpoints. Negative when the fighter finished closer than it started, which happens. */
export function groundOpened(episode: Readonly<DisengageEpisode>): number {
  return episode.endSeparation - episode.startSeparation
}

/**
 * Ground the fighter opened by his own locomotion: the endpoints' difference
 * less the external displacement recorded alongside them. This -- not
 * `groundOpened` -- is what P and Q count, because a murmillo shove moves the
 * retiarius and would otherwise register as an escape he did not make.
 */
export function voluntaryGroundOpened(episode: Readonly<DisengageEpisode>): number {
  return groundOpened(episode) - episode.externalGround
}

/** Both conditions, ground first because it is the binding one. */
export function isSuccess(episode: Readonly<DisengageEpisode>): boolean {
  return voluntaryGroundOpened(episode) >= DISENGAGE_SUCCESS_GROUND && SUCCESS_EXIT_REASONS.has(episode.reason)
}

/**
 * The three thresholds a reason is corroborated against. A PARAMETER since
 * 2026-08-30, because a sweep runs cells whose exit rule is not the shipped
 * one, and corroborating a swept run against the shipped constants is the same
 * class of error this whole file exists to prevent: at a cap of 40 a legitimate
 * `cap` record reads as consistent for the wrong reason, and at a gain of 0.55
 * every legitimate `progress` record reads as a contradiction because
 * 0.55 < 0.75. (The sweep that established this, `scripts/sweep-shove.ts`, is
 * parked on `feature/shield-shove`; the parameter is kept because the next
 * candidate exit rule will need it and because every caller on this branch
 * takes the default, which is byte-identical to the two-constant version.)
 *
 * The corroboration rule is NOT the exit rule, and the difference is
 * deliberate. `minGain` here defaults to `DISENGAGE_SUCCESS_GROUND`, the
 * SUCCESS floor, not to whatever threshold a candidate exits on -- a sweep must
 * pass the exit's own gain so that the check asks "did this episode do what its
 * label claims", never "did this episode clear a bar the gate sets".
 */
export interface CorroborationRule {
  endRange: number
  maxTicks: number
  minGain: number
}

/**
 * The shipped constants, which is what every caller outside the sweep has
 * always been checked against and still is. Naming them as a value changes no
 * number: `corroborate(episode)` with no second argument is byte-identical to
 * the two-constant version it replaces.
 */
export const SHIPPED_CORROBORATION_RULE: Readonly<CorroborationRule> = {
  endRange: FAST_FORCED_DISENGAGE_END_RANGE,
  maxTicks: FAST_FORCED_DISENGAGE_MAX_TICKS,
  minGain: DISENGAGE_SUCCESS_GROUND,
}

/**
 * Checks a self-reported reason against the endpoints recorded beside it, and
 * returns a description of the contradiction, or `undefined` when the record is
 * consistent.
 *
 * `progress` is checked against `rule.minGain` -- by default
 * `DISENGAGE_SUCCESS_GROUND` -- because that is what the name asserts: an exit
 * taken on ground made. A candidate that reports `progress` for an episode
 * which opened less than the threshold it exits on is making the claim the
 * label exists to make, and failing it.
 */
export function corroborate(
  episode: Readonly<DisengageEpisode>,
  rule: Readonly<CorroborationRule> = SHIPPED_CORROBORATION_RULE,
): string | undefined {
  switch (episode.reason) {
    case 'range':
      return episode.endSeparation >= rule.endRange
        ? undefined
        : `episode ${episode.actorId}@${episode.startTick} reports 'range' but ended at ${episode.endSeparation.toFixed(3)}, inside ${rule.endRange}`
    case 'progress':
      return groundOpened(episode) >= rule.minGain
        ? undefined
        : `episode ${episode.actorId}@${episode.startTick} reports 'progress' but opened ${groundOpened(episode).toFixed(3)}, below ${rule.minGain}`
    case 'cap':
      return episode.ticks >= rule.maxTicks
        ? undefined
        : `episode ${episode.actorId}@${episode.startTick} reports 'cap' after ${episode.ticks} ticks, below ${rule.maxTicks}`
    case 'censored':
      // The only reason with nothing to corroborate: it means the bout ended,
      // which the episode itself cannot evidence either way.
      return undefined
  }
}

/** Every statistic the spec's gates P, Q, Q2 and R read, for one population of episodes. */
export interface DisengageStats {
  /** Every episode, censored included. Gate P's denominator. */
  episodes: number
  successes: number
  /** `successes / episodes`, gate P's quantity. `NaN` with no episodes, never a silent 0. */
  successShare: number
  /**
   * Gate Q, over successes only, of `voluntaryGroundOpened` -- not
   * `groundOpened`. Censored cannot be a success, so this is censored-free by
   * construction. Reading the raw ground here, over a population `isSuccess`
   * already selected by the voluntary measure, would report a mixed
   * quantity: a success let in by ground it did not make itself would then
   * also inflate the median with ground it did not make itself. The spec's
   * P/Q addendum ("A P or Q success whose ground is majority external does
   * not count toward P or Q") binds the quantity, not just the membership.
   */
  groundMedianSuccesses: number
  /** Gate Q, over every non-censored episode, of `voluntaryGroundOpened`. Same reasoning as `groundMedianSuccesses`. */
  groundMedianDecided: number
  /** Gate Q2, over successes. */
  durationMedianSuccesses: number
  /** Gate Q2's second clause: the share of successes completing in under four ticks. */
  subFourTickSuccessShare: number
  /** Gate R, over non-censored episodes. */
  immediateShare: number
  byReason: Readonly<Record<DisengageExitReason, number>>
  /** Non-censored episode count, i.e. the denominator Q, Q2 and R actually use. */
  decided: number
}

const share = (part: number, whole: number) => (whole > 0 ? part / whole : Number.NaN)
const medianOf = (values: readonly number[]) => (values.length > 0 ? percentile([...values].sort((a, b) => a - b), 0.5) : Number.NaN)

/**
 * Every gate quantity for one population, with each gate's censoring rule
 * applied where that gate reads it rather than by pre-filtering the input. The
 * caller hands over the episodes; which ones each statistic counts is decided
 * here, once, so two call sites cannot disagree about it.
 */
export function disengageStats(episodes: readonly DisengageEpisode[]): DisengageStats {
  const decided = episodes.filter((episode) => episode.reason !== 'censored')
  const successes = episodes.filter(isSuccess)
  const byReason: Record<DisengageExitReason, number> = { range: 0, cap: 0, progress: 0, censored: 0 }
  for (const episode of episodes) byReason[episode.reason] += 1

  return {
    episodes: episodes.length,
    successes: successes.length,
    successShare: share(successes.length, episodes.length),
    groundMedianSuccesses: medianOf(successes.map(voluntaryGroundOpened)),
    groundMedianDecided: medianOf(decided.map(voluntaryGroundOpened)),
    durationMedianSuccesses: medianOf(successes.map((episode) => episode.ticks)),
    subFourTickSuccessShare: share(successes.filter((episode) => episode.ticks < 4).length, successes.length),
    immediateShare: share(decided.filter((episode) => episode.ticks <= 1).length, decided.length),
    byReason,
    decided: decided.length,
  }
}
