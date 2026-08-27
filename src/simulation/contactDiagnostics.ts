// Opt-in diagnostics for phase 9, mirroring `decisionDiagnostics.ts` for
// phase 4 in both shape and rules: the collector is write-only from the
// kernel's perspective, is never read back inside a tick, and never enters
// `EncounterState` or the event log -- which is why no trace hash folds over
// it.
//
// WHY THIS EXISTS. The separation at which an attack makes contact cannot be
// observed from outside a tick. Phase 9 resolves contact against the frozen
// post-phase-8 snapshot, and phase 10 then applies that same attack's authored
// pushback plus a fresh separation/arena correction, so the separation visible
// after `advanceEncounterTick` is the post-push one -- inflated by the hit
// being measured, and inflated by different amounts depending on how the
// contact resolved (a hit pushes fully, a blocked hit at 0.30 of that, a parry
// or a miss not at all).
//
// That defect was live in the retiarius-reach slice's first measurements and
// was caught in external review by a single number: `heavy-cleave` reported a
// contact p90 of 2.03 against a hard authored contact maximum of 1.8. Every
// median, tail share and ordering margin measured that way was outcome-biased.
// This module is the fix, and it is committed rather than kept in a script
// because the numbers it produces are acceptance evidence.
//
// One record is emitted for EVERY contact intent phase 9 considers, including
// the ones it skips because their actor was defeated earlier in the same batch
// (`outcome: 'actor-defeated'`). A silently dropped intent would bias the
// denominator of every rate computed from these records, which is the second
// half of the same defect.

import type { CombatantId, ActionInstanceId } from './encounter'
import type { AttackActionId } from './combatActions'

/**
 * How one contact intent ended. Derived from the events phase 9 emitted for
 * that intent rather than re-deriving the outcome, so this cannot disagree
 * with the event log.
 *
 * `blocked` and `parried` take precedence over `hit`: a blocked attack emits
 * `attack-blocked` *and* `damage-dealt`, and reporting it as a plain hit would
 * lose the distinction that the defence worked.
 */
export type ContactOutcome =
  | 'hit'
  | 'blocked'
  | 'parried'
  | 'evaded'
  | 'missed-geometry'
  | 'missed-accuracy'
  | 'target-unavailable'
  | 'actor-defeated'

export interface ContactRecord {
  tick: number
  actorId: CombatantId
  targetId: CombatantId
  actionId: AttackActionId
  actionInstanceId: ActionInstanceId
  /**
   * Root-to-root separation between actor and target on the frozen phase-9
   * snapshot -- after this tick's movement (phase 8), before this tick's
   * pushback (phase 10). This is the same geometry `isWithinAttackGeometry`
   * judged the contact by, which is what makes it the honest answer to "how
   * far apart were they when the weapon landed".
   */
  separation: number
  outcome: ContactOutcome
}

export interface ContactCollector {
  record(entry: ContactRecord): void
}
