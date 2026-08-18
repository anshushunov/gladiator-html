// Extracted from `main.ts` (final-review fix): the per-tick footstep-plant
// detection main.ts's `stepBattleTick` drives, pulled into its own
// presentation-only pure module so it is unit-testable without importing
// `main.ts` itself (which has top-level DOM side effects and cannot be
// imported in isolation).
//
// This module is rule-free like every other file under `src/presentation/`:
// it only ever reads `EncounterState`/`FighterCombatState` and derives a
// presentation-only cue-threshold batch from it, never mutating simulation
// state and never feeding anything back into `src/simulation/**`.

import { classifyPlantedFoot, type FootstepThreshold } from './CombatAudio'
import type { CombatantId, EncounterState } from '../simulation/encounter'

/**
 * One combatant's last-known planted-foot classification, tracked across
 * calls so a threshold only fires on an actual *change* (design.md: "fire
 * when the planted foot changes") -- see `main.ts`'s `lastPlantedFoot` for
 * the caller-owned map this mutates in place.
 */
export type PlantedFootByCombatant = Map<CombatantId, 'left' | 'right' | 'both'>

export interface CollectFootstepThresholdsResult {
  thresholds: FootstepThreshold[]
  nextFootstepId: number
}

/**
 * Detects every combatant whose planted foot changed since the last call,
 * minting a fresh `FootstepThreshold` for each -- 'both' is the double-
 * support window between strides and never itself fires a cue.
 *
 * Gated to `status === 'active' && tick >= staggerUntilTick` (final-review
 * fix #5's minimum variant): a staggered or defeated fighter's
 * `travelledDistance` still advances from phase-10 pushback even though
 * `PoseController.applyGroundingLayer` (`PoseController.ts`) explicitly
 * excludes exactly these two states from foot grounding -- without this
 * gate, a knockback could flip the classified planted foot and fire an
 * audible footstep for a fighter who is visibly not planting a foot at all
 * (a single `heavy-cleave` pushback is exactly half of Heavy's own gait
 * cycle distance, so this was not a rare edge case). A gated combatant is
 * treated as `'both'` (never classified left/right, never fires), matching
 * `classifyPlantedFoot`'s own "no plant" value and keeping the very first
 * tick after a stagger/defeat clears from silently firing a spurious
 * transition once grounding resumes.
 */
export function collectFootstepThresholds(
  encounter: Readonly<EncounterState>,
  lastPlantedFoot: PlantedFootByCombatant,
  nextFootstepId: number,
): CollectFootstepThresholdsResult {
  const thresholds: FootstepThreshold[] = []
  let id = nextFootstepId

  for (const combatantId of encounter.combatantIds) {
    const combatant = encounter.combatants[combatantId]
    const archetype = combatant.definition.archetype
    const grounded = combatant.status === 'active' && encounter.tick >= combatant.staggerUntilTick
    const plant = grounded ? classifyPlantedFoot(combatant.travelledDistance, archetype) : 'both'
    const previousPlant = lastPlantedFoot.get(combatantId) ?? 'both'
    if (plant !== previousPlant && plant !== 'both') {
      thresholds.push({ id, combatantId, archetype, foot: plant })
      id += 1
    }
    lastPlantedFoot.set(combatantId, plant)
  }

  return { thresholds, nextFootstepId: id }
}
