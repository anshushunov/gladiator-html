// Opt-in diagnostics for phase 4. Nothing here may influence a decision: the
// collector is write-only from the kernel's perspective, is never read back
// inside a tick, and never enters `EncounterState` or the event log -- which
// is why no trace hash folds over it.
//
// Four distinct paths reach an action, and each gets its own record shape.
// Flattening them into one would misrepresent forced behaviours and defensive
// reactions as weighted rolls, which they are not.

import type { CombatantId } from './encounter'
import type { CombatDecision, ScoredCombatDecision } from './combatDecision'

// Aliased, not redeclared: `CombatDecision`/`ScoredCombatDecision` are
// `combatDecision.ts`'s own real types for what phase 4 chooses and scores.
// A structurally-identical-but-separate copy here would compile today and
// silently stop matching the moment either gained a variant, quietly
// widening (or narrowing) what this module claims to report.
export type DecisionOutcome = CombatDecision
export type ScoredCandidateRecord = ScoredCombatDecision

export type DecisionRecord =
  /** An ordinary phase-4 weighted selection. */
  | {
      kind: 'weighted'
      tick: number
      combatantId: CombatantId
      candidates: readonly ScoredCandidateRecord[]
      roll: number
      chosen: DecisionOutcome
    }
  /** The candidate set was empty, so the deterministic fallback ran. No roll decided anything. */
  | { kind: 'fallback'; tick: number; combatantId: CombatantId; chosen: DecisionOutcome }
  /** Fast's disengage or Technical's parry-counter: phase 4 is bypassed entirely, and no decision-stream draw happens. */
  | { kind: 'forced'; tick: number; combatantId: CombatantId; behaviour: 'disengage' | 'parry-counter' }
  /**
   * `isDecisionReady` fails for four distinct reasons (not this combatant's
   * status/action/stagger/schedule), and a fifth site-local check
   * (`targetId === undefined`) reports separately as `'no-target'`. A
   * feature whose entire purpose is explaining why a fighter did nothing
   * must not collapse those into one label.
   */
  | { kind: 'skipped'; tick: number; combatantId: CombatantId; reason: 'inactive' | 'mid-action' | 'staggered' | 'not-due' | 'no-target' }

export interface DecisionCollector {
  record(entry: DecisionRecord): void
}
