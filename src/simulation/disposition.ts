// src/simulation/disposition.ts
// The one place DispositionId becomes behavior. Order/temperament ids live in
// combatant state as plain strings; the DecisionModifier functions they map to
// live only here — EncounterState stays structurally clonable.
//
// Magnitudes are tuning values: dispositionBalance.test.ts holds the result
// (risk/reward real, no dominant order, no stall collapse). Adjust
// COMMITTED_ADJUST / LOCOMOTION_ADJUST there before inventing new mechanisms.
import type { DecisionModifier } from './combatDecision'
import type { LocomotionIntent } from './movement'

export type DispositionId = 'standard' | 'press' | 'guarded'
export const DISPOSITION_IDS: readonly DispositionId[] = Object.freeze(['standard', 'press', 'guarded'])

export function isDispositionId(value: unknown): value is DispositionId {
  return typeof value === 'string' && (DISPOSITION_IDS as readonly string[]).includes(value)
}

const APPROACH_INTENTS: ReadonlySet<LocomotionIntent> = new Set(['pressure', 'burst-in', 'advance'])
const KEEPER_INTENTS: ReadonlySet<LocomotionIntent> = new Set(['hold-range', 'backstep', 'retreat'])

const COMMITTED_ADJUST = 6
const LOCOMOTION_ADJUST = 4

// `sign` +1 = press, -1 = guarded. Weights pass through combatDecision.ts's
// own `max(0, …)` clamp, so a negative adjustment can suppress but never
// invert a candidate; probes are untouched so a guarded fighter still fights.
function dispositionModifier(id: string, sign: 1 | -1): DecisionModifier {
  return {
    id,
    adjustCandidate({ context, decision }) {
      if (decision.type === 'action') {
        return context.attacks[decision.actionId].tags.includes('committed') ? sign * COMMITTED_ADJUST : 0
      }
      if (APPROACH_INTENTS.has(decision.locomotionIntent)) return sign * LOCOMOTION_ADJUST
      if (KEEPER_INTENTS.has(decision.locomotionIntent)) return -sign * LOCOMOTION_ADJUST
      return 0
    },
  }
}

const NO_MODIFIERS: readonly DecisionModifier[] = Object.freeze([])
const PRESS_MODIFIERS: readonly DecisionModifier[] = Object.freeze([dispositionModifier('disposition:press', 1)])
const GUARDED_MODIFIERS: readonly DecisionModifier[] = Object.freeze([dispositionModifier('disposition:guarded', -1)])

export function dispositionModifiers(id: DispositionId): readonly DecisionModifier[] {
  if (id === 'press') return PRESS_MODIFIERS
  if (id === 'guarded') return GUARDED_MODIFIERS
  return NO_MODIFIERS
}
