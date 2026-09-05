// The gait cycle's own math, in one place. `clipMapping` needs the phase
// (how far into the cycle) to time the walk clip, and the full
// classification is still what `CombatAudio` narrows: it needs only the
// planted foot, to
// decide when a footstep cue fires. Those were two independent copies of the
// same modulo-and-halves arithmetic, kept in agreement only by both reading
// the authored `STYLE_GAIT_CYCLE_DISTANCE` table -- so they agreed on *when*
// a foot plants right up until someone edited one of them.
//
// Presentation-only, like everything else under `src/presentation/`: derived
// from a fighter's own `travelledDistance` (simulation state), never from
// wall-clock time, so equal travelled distance always yields an equal gait
// regardless of frame rate or how many ticks elapsed to get there.

import type { Archetype } from '../simulation/fighters'

/** Travelled distance per full gait cycle (both feet), per archetype. Authored content, shared by the clip mapping's walk time and the footstep audio thresholds. */
export const STYLE_GAIT_CYCLE_DISTANCE: Readonly<Record<Archetype, number>> = {
  heavy: 1.4,
  fast: 0.95,
  technical: 1.15,
}

/** Fraction of each gait half-cycle, on either side of its boundary, treated as a "both feet planted" double-support window. */
export const DOUBLE_SUPPORT_FRACTION = 0.12

export interface GaitClassification {
  /** `'A'`: the authored `locomotion` pose applies as-is. `'B'`: mirrored
   * left/right, alternating which leg reads as forward from the single
   * authored snapshot. Retained for `classifyPlantedFoot`'s own left/right
   * alternation; the shipped walk clip carries both halves itself. */
  half: 'A' | 'B'
  /** `0..1` envelope across the current half-cycle: `0` at each foot-plant
   * boundary, `1` at the half-cycle's midpoint (peak stride extension). */
  envelope: number
  plantedFoot: 'left' | 'right' | 'both'
}

/**
 * `travelledDistance` folded into a `0..1` phase of the archetype's own gait
 * cycle. A non-positive (or missing) cycle distance yields phase `0`, whose
 * classification is the neutral "both feet planted" -- never NaN.
 */
export function computeGaitPhase(travelledDistance: number, archetype: Archetype): number {
  const cycleDistance = STYLE_GAIT_CYCLE_DISTANCE[archetype]
  if (!(cycleDistance > 0)) return 0
  const wrapped = travelledDistance % cycleDistance
  const normalized = wrapped < 0 ? wrapped + cycleDistance : wrapped
  return normalized / cycleDistance
}

export function classifyGaitPhase(phase: number): GaitClassification {
  const p = ((phase % 1) + 1) % 1
  const inFirstHalf = p < 0.5
  const u = inFirstHalf ? p / 0.5 : (p - 0.5) / 0.5
  const envelope = 1 - Math.abs(u * 2 - 1)
  const nearBoundary = u <= DOUBLE_SUPPORT_FRACTION || u >= 1 - DOUBLE_SUPPORT_FRACTION
  const plantedFoot: GaitClassification['plantedFoot'] = nearBoundary ? 'both' : inFirstHalf ? 'right' : 'left'
  return { half: inFirstHalf ? 'A' : 'B', envelope, plantedFoot }
}

/** Which foot (if either) is planted at this travelled distance -- the one slice of the classification `CombatAudio`'s footstep cues need. */
export function classifyPlantedFoot(travelledDistance: number, archetype: Archetype): GaitClassification['plantedFoot'] {
  return classifyGaitPhase(computeGaitPhase(travelledDistance, archetype)).plantedFoot
}
