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

// 6/4 until 2026-09-05, when the fighting-room slice moved them to 7/5.
//
// The clause that went red was criterion 1's guarded risk term: guarded's saved
// share of bouts won from under 25% HP fell to 1.6% against a 2.0% floor, while
// the other three clauses stayed comfortable. That is the mechanic getting
// quieter rather than the metric misbehaving -- with every separation 0.30
// further out and the arena a size larger, backing off buys guarded less than
// it used to, because there is more room to back off INTO and the opponent
// spends longer closing it again.
//
// Measured at 200 seeds x nine pairings x three orders, on this build. Floors
// are 3.0% / 3.0% / 2.0% / 2.0%:
//
//   committed / locomotion   pressWin   guardLoss   pressRisk   guardSave
//        6 / 4 (was)           8.6%       6.3%        4.7%        1.6%   FAIL
//        7 / 5 (this)          8.9%       8.6%        3.9%        2.6%
//
// 7/5 is one step in each, the smallest move that clears the floor, and it sits
// inside the COMMITTED 4..8 x LOCOMOTION 3..6 grid the original calibration
// swept. Note what it costs on the other side: `pressRisk` falls 4.7% -> 3.9%,
// and the file header already names that clause as criterion 1's thinnest. It
// still clears its floor by 1.9 points, but a further step in this direction is
// not free, and the next red run there is a finding rather than a knob.
const COMMITTED_ADJUST = 7
const LOCOMOTION_ADJUST = 5

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
