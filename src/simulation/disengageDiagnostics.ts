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
//
// WHERE `record` IS ACTUALLY CALLED FROM, AND WHAT "INERT" MEANS GIVEN THAT.
// `separation` (every kind) and `reason` (`cleared`) are still captured in
// phase 2, before this tick's movement -- unchanged from the window described
// above. `externalSeparationDelta` (every kind, INCLUDING `stamped` -- see the
// P/Q addendum this slice's spec added) is different: it needs THIS tick's own
// push, which is phase 9's `pushByTarget` (`encounter.ts`) and has not been
// computed yet when phase 2 runs. So `record` is called for every kind right
// after phase 9, from a pending list phase 2 built
// (`encounter.ts`'s `PendingDisengageSample`) -- not synchronously inside
// phase 2, and not from inside phase 9 either, unlike `contactDiagnostics.ts`
// (called from inside phase 9's own resolution) and `decisionDiagnostics.ts`
// (called from inside phase 4's). Three rounds of external review pushed on
// the original synchronous-phase-2 claim before this revision moved the call
// site, so the claim stays as narrow as the measurement supports:
//
//   **Inert for a collector that returns AND does not write to state it
//   captured from outside the tick.**
//
// The second clause is not hypothetical and is not hedging. Measured against
// THIS SEAM'S ORIGINAL phase-2 call site, before `externalSeparationDelta`
// existed: a collector that returns normally but mutates
// `previous.encounter.combatants[id].position` from inside `record` moved the
// bout's digest from `7e5009f3` to `c13df37` and its length from 1175 ticks to
// 1687. `transitionExpiredPhases` shallow-copies the combatant map, so those
// position objects stay shared and every later phase reads the mutation --
// and that mechanism does not depend on which phase `record` happens to be
// called from, since `combatants` is reassigned (never mutated in place)
// through every phase regardless. The digests above were not re-measured
// against the post-phase-9 call site introduced by this revision; the
// mechanism they demonstrate is unchanged by moving the call, which is why
// the claim above still holds without re-measuring. Two earlier revisions of
// this comment claimed more than the boxed claim -- first "inert", then
// "inert for a collector that returns" -- and both were false.
//
// What IS guaranteed, and is worth having:
//
//   - the sample handed to `record` is **only primitives** -- a tick, two ids,
//     a number, a string reason. Nothing reachable from the kernel is passed
//     out, so a collector has to go looking for state to break it;
//   - when no collector is attached, nothing is built at all. Every call site
//     -- the stamp branch inside phase 2's `completeForcedStateTransitions`,
//     and the post-phase-9 loop in `advanceEncounterTick` that finishes every
//     pending `held`/`cleared`/`stamped` observation -- is behind an explicit
//     `if (disengageCollector)` (or, at the final `record` call itself,
//     `?.record({...})`, which does not evaluate its argument list on the
//     nullish path), so no `PendingDisengageSample` and no `DisengageSample`
//     is ever allocated.
//
// The same hostile collector perturbs the merged `contactDiagnostics` seam
// identically (digest `7e5009f3` to `1499c999`), so this is a property of the
// kernel's callback pattern rather than something this seam introduced. That
// makes it a debt shared by three modules, not a licence: the fix is to hand
// samples back on `EncounterTransition` for all three, which changes a kernel
// type and belongs in its own diff rather than in one whose claim is that it
// changes nothing. It is recorded as such, and the decision is the design
// owner's.

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
 * One observation of one fighter's forced disengage.
 *
 * `separation` (every kind) is root-to-root, read from the phase-2 state
 * *before* this tick's movement, and on `held`/`cleared` it is literally the
 * number the exit predicate was handed -- not a recomputation of it, so a
 * record can never disagree with the decision it describes. It is `Infinity`,
 * and `targetId` is `undefined`, exactly when phase 2 found no target; the
 * kernel records that rather than raising, and the assembler rejects the
 * episode.
 *
 * `externalSeparationDelta` (every kind, INCLUDING `stamped`) is this
 * sample's OWN tick's push, projected onto the actor->target axis. It is not
 * captured alongside `separation` in phase 2 -- phase 9 is what computes the
 * push, so `record` for every kind is actually called after phase 9 (see the
 * module header). Positive when that tick's push moved the pair apart.
 * `stamped` carries it (not just `0`) because `assembleDisengageEpisodes`
 * opens `DisengageEpisode.externalGround` from it: the stamp tick's own push
 * is inside the window the raw endpoints span (`[startTick, endTick)`), and
 * omitting it would silently drop the episode's first tick from the sum.
 *
 * `targetId` is carried on every sample because `actorId` alone is not enough
 * to make an episode meaningful. Phase 3 can replace a fighter's target while
 * an episode is open, and an assembler that only groups by actor would then
 * subtract a separation measured against one opponent from one measured
 * against another and report the difference as ground opened. External review
 * found that; it is unreachable in a duel and perfectly reachable in the
 * generic kernel.
 *
 * Three kinds rather than two because a `censored` episode still needs an end
 * separation, and the only honest one is the last reading taken while the
 * episode was open -- which is what `held` carries. It costs nothing: phase 2
 * already computes that distance every tick to feed the predicate.
 */
export type DisengageSample =
  | { kind: 'stamped'; tick: number; actorId: CombatantId; targetId: CombatantId | undefined; separation: number; externalSeparationDelta: number }
  | { kind: 'held'; tick: number; actorId: CombatantId; targetId: CombatantId | undefined; separation: number; externalSeparationDelta: number }
  | {
      kind: 'cleared'
      tick: number
      actorId: CombatantId
      targetId: CombatantId | undefined
      separation: number
      externalSeparationDelta: number
      reason: DisengagePredicateExit
    }

/** The kernel's whole view of this module: somewhere to write, nothing to read. */
export interface DisengageCollector {
  record(sample: DisengageSample): void
}

/** One completed forced-disengage episode, stamp to clear. */
export interface DisengageEpisode {
  actorId: CombatantId
  /** The single opponent both endpoints were measured against; an episode that spans two targets is not emitted at all. */
  targetId: CombatantId
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
  /**
   * The sum of `externalSeparationDelta` for every tick in `[startTick,
   * endTick)` -- the stamp's own tick and every `held` tick's, but NOT the
   * clear's. Those are exactly the ticks `endSeparation - startSeparation`
   * (the raw ground) is driven by: `startSeparation` is read at phase 2 of
   * `startTick`, before that tick's own retreat and push; `endSeparation` is
   * read at phase 2 of `endTick`, before *that* tick's own decision, movement
   * and push. `cleared`'s own tick's push therefore happens strictly after
   * `endSeparation` was already read and cannot have contributed to it, so
   * `assembleDisengageEpisodes` excludes it from this sum -- summing it, an
   * earlier revision of this attribution did, overcounts by exactly one
   * boundary tick's push and undercounts by the stamp tick's, both against
   * `DISENGAGE_SUCCESS_GROUND`'s 0.75 floor with authored pushes of
   * 0.18-0.70, an error the same order as the bar it feeds.
   *
   * The remainder (`endSeparation - startSeparation - externalGround`) is the
   * actor's own locomotion; `voluntaryGroundOpened`
   * (`src/testSupport/disengageGates.ts`) is exactly that quantity. Still an
   * approximation in exactly one direction beyond the window above: the arena
   * clamp and collision resolution can shorten a push after it is recorded,
   * so this OVERSTATES the external share rather than flattering the
   * fighter -- and for a `censored` episode specifically, the last `held`
   * sample's own tick's push is included even though the bout ends before any
   * later reading could confirm it actually landed, which overstates in the
   * same direction rather than a new one.
   */
  externalGround: number
}

/**
 * Why an episode cannot be turned into a pair of comparable endpoints. This is
 * a statement about the *measurement*, not about the fight, which is why it is
 * deliberately not part of `DisengageExitReason`: the frozen set says how a
 * disengage ended, and these episodes have no usable answer to that question at
 * all.
 */
export type UnmeasurableCause =
  /** Phase 2 found no target on some tick of the episode -- the target died, turned non-hostile, or could not be reacquired. */
  | 'no-target'
  /** Phase 3 replaced the target while the episode was open, so its two endpoints would be measured against two different fighters. */
  | 'target-changed'

/** An episode that happened but cannot be measured. Reported, never dropped, so a denominator can account for it. */
export interface UnmeasurableDisengageEpisode {
  actorId: CombatantId
  startTick: number
  /** The tick the episode stopped being measurable. */
  tick: number
  cause: UnmeasurableCause
}

/**
 * Everything the assembler saw, split by whether it can carry a number.
 *
 * **Every `stamped` sample lands in exactly one of the two arrays.** That is
 * the property a rate computed from this can rely on, and it is asserted in the
 * tests: a consumer can report `episodes.length / (episodes.length +
 * unmeasurable.length)` and know the denominator is the real episode count.
 */
export interface DisengageAssembly {
  episodes: DisengageEpisode[]
  unmeasurable: UnmeasurableDisengageEpisode[]
}

/**
 * Regroups a bout's flat sample stream into one record per episode, closing
 * anything still open as `censored`.
 *
 * Two kinds of bad input, handled differently, and the difference is the point:
 *
 * - **Unmeasurable but ordinary.** An episode with no target, or one whose
 *   target changed while it was open, is reported in `unmeasurable` rather than
 *   emitted, dropped, or thrown on. Emitting it would subtract separations
 *   taken against two different opponents and call the difference ground
 *   opened; dropping it would bias the denominator the same way dropping
 *   censored episodes does; **throwing would destroy every valid episode in the
 *   same run over one ordinary free-for-all episode**, which is what the
 *   previous revision did and what external review caught. Measurement validity
 *   is orthogonal to why a disengage ended, so it gets its own vocabulary
 *   instead of a fifth exit reason -- the frozen set stays frozen.
 * - **Structurally impossible.** A `held`/`cleared` for an actor with no open
 *   episode, a second `stamped` before the first was cleared, or a finite
 *   target with a non-finite separation, is a kernel invariant violation and
 *   still throws. These are not states the simulation reaches; phase 4 skips
 *   forced actors entirely (`encounter.ts`), so a fighter cannot start the
 *   burst lunge that would re-stamp it mid-episode. If a later PR makes one
 *   reachable, the run should stop rather than quietly emit an episode with the
 *   wrong endpoints.
 *
 * All of it runs AFTER the tick. That is the point: an earlier revision put the
 * finiteness check in the kernel's write path, where raising turned a
 * transition that completed without a collector into an exception with one
 * attached -- a seam that claimed to be inert and was not. Deciding what a
 * record means belongs where it cannot perturb what is being measured.
 *
 * Output order is by `startTick`, then `actorId`, so a measurement built on it
 * is stable across runs regardless of the order the kernel visited combatants
 * in.
 */
export function assembleDisengageEpisodes(samples: readonly DisengageSample[]): DisengageAssembly {
  interface OpenEpisode {
    targetId: CombatantId | undefined
    startTick: number
    startSeparation: number
    lastTick: number
    lastSeparation: number
    /**
     * Running sum of `externalSeparationDelta`: the opening `stamped`
     * sample's own value, plus every `held` sample's since. NOT `cleared`'s --
     * see `DisengageEpisode.externalGround`'s doc for why that tick is
     * excluded from the window.
     */
    externalGround: number
    /** Set once and never overwritten, so the reported tick is where it FIRST became unmeasurable. */
    spoiled?: { tick: number; cause: UnmeasurableCause }
  }

  const open = new Map<CombatantId, OpenEpisode>()
  const episodes: DisengageEpisode[] = []
  const unmeasurable: UnmeasurableDisengageEpisode[] = []

  function spoil(current: OpenEpisode, tick: number, cause: UnmeasurableCause): void {
    if (!current.spoiled) current.spoiled = { tick, cause }
  }

  function close(actorId: CombatantId, current: OpenEpisode, endTick: number, endSeparation: number, reason: DisengageExitReason): void {
    // `spoiled` is the single gate: a stamp with no target spoils on the spot,
    // so `targetId === undefined` here always implies `spoiled` is set, and
    // narrowing on it keeps that invariant visible to the type checker instead
    // of needing a second, unreachable branch.
    if (current.spoiled || current.targetId === undefined) {
      unmeasurable.push({ actorId, startTick: current.startTick, tick: current.spoiled?.tick ?? current.startTick, cause: current.spoiled?.cause ?? 'no-target' })
      return
    }
    episodes.push({
      actorId,
      targetId: current.targetId,
      startTick: current.startTick,
      endTick,
      ticks: endTick - current.startTick,
      startSeparation: current.startSeparation,
      endSeparation,
      reason,
      externalGround: current.externalGround,
    })
  }

  for (const sample of samples) {
    // Before any branching on kind or on target changes. Round 3 of external
    // review found that checking this inside the held/cleared branch left two
    // holes: a `stamped` sample skipped it entirely and could open an episode
    // with a `NaN` start separation that later emitted as measurable, and a
    // sample that both retargeted and went non-finite took the
    // `target-changed` path and was never validated at all.
    if (sample.targetId !== undefined && !Number.isFinite(sample.separation)) {
      // A resolved target and a non-finite distance between two finite
      // positions is not an ordinary state, it is a broken one.
      throw new Error(`disengage diagnostics: ${sample.actorId} reported a non-finite separation to ${sample.targetId} at tick ${sample.tick}`)
    }

    const current = open.get(sample.actorId)

    if (sample.kind === 'stamped') {
      if (current) {
        throw new Error(
          `disengage diagnostics: ${sample.actorId} was stamped at tick ${sample.tick} while an episode from tick ${current.startTick} was still open`,
        )
      }
      const opened: OpenEpisode = {
        targetId: sample.targetId,
        startTick: sample.tick,
        startSeparation: sample.separation,
        lastTick: sample.tick,
        lastSeparation: sample.separation,
        // The stamp tick's own push is inside `[startTick, endTick)`, so it
        // opens the sum rather than starting it at `0`.
        externalGround: sample.externalSeparationDelta,
      }
      if (sample.targetId === undefined) spoil(opened, sample.tick, 'no-target')
      open.set(sample.actorId, opened)
      continue
    }

    if (!current) {
      throw new Error(`disengage diagnostics: ${sample.actorId} reported '${sample.kind}' at tick ${sample.tick} with no open episode`)
    }

    if (sample.targetId === undefined) {
      spoil(current, sample.tick, 'no-target')
    } else if (current.targetId !== undefined && sample.targetId !== current.targetId) {
      spoil(current, sample.tick, 'target-changed')
    }

    if (sample.kind === 'held') {
      current.lastTick = sample.tick
      current.lastSeparation = sample.separation
      current.externalGround += sample.externalSeparationDelta
      continue
    }

    // `sample.externalSeparationDelta` (this `cleared` tick's own push) is
    // deliberately NOT added here: it happens after `sample.separation` --
    // about to become `endSeparation` -- was already read at phase 2, so it
    // is outside `[startTick, endTick)` and cannot have contributed to the
    // raw ground this episode reports.
    open.delete(sample.actorId)
    close(sample.actorId, current, sample.tick, sample.separation, sample.reason)
  }

  for (const [actorId, current] of open) {
    close(actorId, current, current.lastTick, current.lastSeparation, 'censored')
  }

  const byStart = (a: { startTick: number; actorId: CombatantId }, b: { startTick: number; actorId: CombatantId }) =>
    a.startTick - b.startTick || (a.actorId < b.actorId ? -1 : a.actorId > b.actorId ? 1 : 0)

  return { episodes: episodes.sort(byStart), unmeasurable: unmeasurable.sort(byStart) }
}
