// Opt-in diagnostics for Fast's forced disengage, mirroring
// `contactDiagnostics.ts` for phase 9 and `decisionDiagnostics.ts` for phase 4
// in both shape and rules: the collector is write-only from the kernel's
// perspective, is never read back inside a tick, and never enters
// `EncounterState` or the event log -- which is why no trace hash folds over
// it.
//
// WHY THIS EXISTS. `scripts/measure-reach.ts:281` labels every disengage
// episode by dividing on its duration:
//
//     exit: ticks >= FAST_FORCED_DISENGAGE_MAX_TICKS ? 'cap' : 'range'
//
// Nothing observes why the episode actually ended. The label is deduced from
// the episode's length, against the very constant the content PR makes mutable.
// That deduction happens to track today's two-branch predicate and stops
// tracking anything the moment the predicate changes -- which is the change
// this slice proposes. External review's construction is exact: set the cap to
// 43 and add an early time exit at tick 42, and every episode is then labelled
// `range` while not one fighter has reached the exit distance.
//
// The second half of the same defect is the window. The field is stamped in
// phase 2 of the advance into tick S, and that same advance moves the fighter
// under `disengage` (phase 2 stamps, phase 4 skips forced actors, phases 7-8
// move). A harness reading state after `advanceBattleTick` therefore sees the
// start separation *after* that first forced retreat, and at the other end
// sees the clear separation after phase 4's ordinary decision, phases 7-8's
// ordinary movement, phase 9's contact and phase 10's push have all run in the
// same advance -- and `heavy-cleave` authors a `pushDistance` of 0.70, six
// times the whole error interval the design spec first claimed. Both endpoints
// here are read in PHASE 2, before any of that.
//
// THE EXIT REASON IS CLOSED AND IS NOT THE CONTENT PR'S TO EXTEND.
// `DisengageExitReason` below is the whole set, frozen here rather than
// wherever the predicate happens to live, because round-2 review found that a
// seam faithfully reporting whatever reason a future predicate invents reopens
// the hole one level up. A later PR may re-express the exit condition; it may
// not add a reason, rename one, or move one between the success and failure
// sets. `progress` is present and currently unreachable for exactly that
// purpose: it is the name the pursuit-relative exit will report, reserved now
// so that PR does not have to widen this type.
//
// AND A REASON IS NOT EVIDENCE. It says *which* exit fired, not that one
// deserved to. Every gate built on these records re-checks the reason against
// the recorded endpoints -- a `range` record must satisfy the range condition
// at its recorded end separation -- and a label the endpoints contradict fails
// the run.

import type { CombatantId } from './encounter'

/**
 * The complete, frozen set of ways a forced disengage episode can end.
 *
 * - `range` -- the fighter opened separation back out to the authored exit
 *   distance.
 * - `cap` -- the tick cap fired first; the fighter is still inside the exit
 *   distance. This is the pinned case the slice exists to measure.
 * - `progress` -- reserved for the pursuit-relative exit the content PR
 *   proposes. **Currently unreachable**; no code path returns it yet, and the
 *   only correct way to make it reachable is to return it from
 *   `hasFastForcedDisengageEnded`.
 * - `censored` -- the bout ended with the episode still open. Never returned
 *   by the predicate (see `DisengagePredicateExit`); assigned by
 *   `assembleDisengageEpisodes` and kept rather than dropped, because dropping
 *   open episodes would bias every completion rate computed from these records
 *   toward the episodes that finished.
 */
export type DisengageExitReason = 'range' | 'cap' | 'progress' | 'censored'

/**
 * What the predicate itself may return. `censored` is excluded *by type*: it
 * describes the bout running out, which the predicate cannot observe, and a
 * predicate that could report it would be able to launder an unfinished
 * episode into a finished one.
 */
export type DisengagePredicateExit = Exclude<DisengageExitReason, 'censored'>

/**
 * One phase-2 observation of one fighter's forced disengage.
 *
 * `separation` is root-to-root, read from the phase-2 state *before* this
 * tick's movement, and on `held`/`cleared` it is literally the number the exit
 * predicate was handed -- not a recomputation of it, so a record can never
 * disagree with the decision it describes. It is always finite: the kernel
 * raises rather than record a non-finite separation (see `recordDisengage` in
 * `encounter.ts`).
 *
 * Three kinds rather than two because a `censored` episode still needs an end
 * separation, and the only honest one is the last reading taken while the
 * episode was open -- which is what `held` carries. It costs nothing: phase 2
 * already computes that distance every tick to feed the predicate.
 */
export type DisengageSample =
  | { kind: 'stamped'; tick: number; actorId: CombatantId; separation: number }
  | { kind: 'held'; tick: number; actorId: CombatantId; separation: number }
  | { kind: 'cleared'; tick: number; actorId: CombatantId; separation: number; reason: DisengagePredicateExit }

/** The kernel's whole view of this module: somewhere to write, nothing to read. */
export interface DisengageCollector {
  record(sample: DisengageSample): void
}

/** One completed forced-disengage episode, stamp to clear. */
export interface DisengageEpisode {
  actorId: CombatantId
  /** The tick the `forcedDisengageStartTick` field was stamped. */
  startTick: number
  /**
   * The tick the field was cleared -- or, for a `censored` episode, the last
   * tick it was observed still open. The true end of a censored episode is
   * unknown by definition; this is the tick its `endSeparation` was read at,
   * so the two always agree.
   */
  endTick: number
  /** `endTick - startTick`, i.e. the number of forced movements observed. Never inferred from, and never used to infer, `reason`. */
  ticks: number
  /** Separation at the stamp, phase 2, before that tick's forced retreat. */
  startSeparation: number
  /** Separation at the clear, phase 2, before that tick's ordinary decision and movement. */
  endSeparation: number
  reason: DisengageExitReason
}

/**
 * Regroups a bout's flat sample stream into one record per episode, closing
 * anything still open as `censored`.
 *
 * Pure and total over well-formed input, and loud over ill-formed input: a
 * `held`/`cleared` for an actor with no open episode, or a second `stamped`
 * before the first was cleared, is a kernel invariant violation rather than
 * something to paper over. Both are unreachable today -- phase 4 skips forced
 * actors entirely (`encounter.ts`), so a fighter cannot start the burst lunge
 * that would re-stamp it while its own disengage is running -- and that is
 * precisely why they throw: if a later PR makes one reachable, the run should
 * stop rather than quietly emit an episode with the wrong endpoints.
 *
 * Output order is by `startTick`, then `actorId`, so a measurement built on it
 * is stable across runs regardless of the order the kernel visited combatants
 * in.
 */
export function assembleDisengageEpisodes(samples: readonly DisengageSample[]): DisengageEpisode[] {
  interface OpenEpisode {
    startTick: number
    startSeparation: number
    lastTick: number
    lastSeparation: number
  }

  const open = new Map<CombatantId, OpenEpisode>()
  const episodes: DisengageEpisode[] = []

  for (const sample of samples) {
    const current = open.get(sample.actorId)

    if (sample.kind === 'stamped') {
      if (current) {
        throw new Error(
          `disengage diagnostics: ${sample.actorId} was stamped at tick ${sample.tick} while an episode from tick ${current.startTick} was still open`,
        )
      }
      open.set(sample.actorId, {
        startTick: sample.tick,
        startSeparation: sample.separation,
        lastTick: sample.tick,
        lastSeparation: sample.separation,
      })
      continue
    }

    if (!current) {
      throw new Error(`disengage diagnostics: ${sample.actorId} reported '${sample.kind}' at tick ${sample.tick} with no open episode`)
    }

    if (sample.kind === 'held') {
      current.lastTick = sample.tick
      current.lastSeparation = sample.separation
      continue
    }

    open.delete(sample.actorId)
    episodes.push({
      actorId: sample.actorId,
      startTick: current.startTick,
      endTick: sample.tick,
      ticks: sample.tick - current.startTick,
      startSeparation: current.startSeparation,
      endSeparation: sample.separation,
      reason: sample.reason,
    })
  }

  for (const [actorId, current] of open) {
    episodes.push({
      actorId,
      startTick: current.startTick,
      endTick: current.lastTick,
      ticks: current.lastTick - current.startTick,
      startSeparation: current.startSeparation,
      endSeparation: current.lastSeparation,
      reason: 'censored',
    })
  }

  return episodes.sort((a, b) => a.startTick - b.startTick || (a.actorId < b.actorId ? -1 : a.actorId > b.actorId ? 1 : 0))
}
