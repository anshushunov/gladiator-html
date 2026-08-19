// A standing fighter's breathing and weight shift. Presentation only: this
// never touches the root, only pose joints, and it owns a joint set disjoint
// from the ones the grounding layer pins.
//
// Phase comes from interpolated simulation time, never wall-clock. Pose
// baselines and key-pose fixtures are captured at fixed ticks, so a
// wall-clock idle would make every one of them flaky.

import type { SparsePose } from '../PoseController'

/** Seconds for one full breathing cycle. Slow enough to read as breathing rather than fidgeting. */
const IDLE_CYCLE_SECONDS = 3.4

/** Peak joint rotation in radians at full amplitude -- small on purpose: this must never compete with a guard stance. */
const IDLE_ROTATION_RADIANS = 0.035

/**
 * A stable per-combatant phase offset in `0..1`, so two fighters standing at
 * the same moment are never in unison (which reads as a bug, not as life).
 * A plain string hash, not `Math.random`: this must be identical on every run
 * and in every runtime, exactly like the rest of presentation sampling.
 */
function idPhaseOffset(combatantId: string): number {
  let hash = 2166136261
  for (let index = 0; index < combatantId.length; index += 1) {
    hash ^= combatantId.charCodeAt(index)
    hash = Math.imul(hash, 16777619)
  }
  return ((hash >>> 0) % 1000) / 1000
}

export function computeIdlePhase(simulationTime: number, combatantId: string): number {
  const raw = simulationTime / IDLE_CYCLE_SECONDS + idPhaseOffset(combatantId)
  return raw - Math.floor(raw)
}

export function idleAmplitude(speedWeight: number, suppressed: boolean, reducedMotion: boolean): number {
  if (suppressed || reducedMotion) return 0
  const clamped = speedWeight < 0 ? 0 : speedWeight > 1 ? 1 : speedWeight
  return 1 - clamped
}

export function sampleIdleLayer(phase: number, amplitude: number): SparsePose {
  if (amplitude <= 0) return {}
  const swing = Math.sin(phase * Math.PI * 2) * IDLE_ROTATION_RADIANS * amplitude
  const breath = Math.sin(phase * Math.PI * 2 + Math.PI / 3) * IDLE_ROTATION_RADIANS * 0.6 * amplitude
  return {
    pelvis: { rotation: [0, 0, swing * 0.5] },
    chest: { rotation: [breath, 0, -swing * 0.4] },
    'shoulder.L': { rotation: [breath * 0.8, 0, 0] },
    'shoulder.R': { rotation: [breath * 0.8, 0, 0] },
  }
}
