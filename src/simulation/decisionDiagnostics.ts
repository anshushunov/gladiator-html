// Opt-in diagnostics for phase 4. Nothing here may influence a decision: the
// collector is write-only from the kernel's perspective, is never read back
// inside a tick, and never enters `EncounterState` or the event log -- which
// is why no trace hash folds over it.
//
// Four distinct paths reach an action, and each gets its own record shape.
// Flattening them into one would misrepresent forced behaviours and defensive
// reactions as weighted rolls, which they are not.

import type { CombatantId } from './encounter'
import type { AttackActionId } from './combatActions'
import type { LocomotionIntent } from './movement'

export type DecisionOutcome =
  | { type: 'locomotion'; locomotionIntent: LocomotionIntent }
  | { type: 'action'; actionId: AttackActionId }

export interface ScoredCandidateRecord {
  decision: DecisionOutcome
  weight: number
}

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
  /** Decision-ready checks failed: not yet due, staggered, mid-action, or no valid target. */
  | { kind: 'skipped'; tick: number; combatantId: CombatantId; reason: 'not-due' | 'no-target' }

export interface DecisionCollector {
  record(entry: DecisionRecord): void
}
