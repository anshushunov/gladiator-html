// Pure: which clip a fighter plays this frame and at what time. The only
// clock is `tick + alpha`; no wall clock enters here, so a re-render at the
// same tick pair reproduces the same skeleton (smoke.spec.ts relies on it).
//
// Rule-free like the rest of presentation: reads `FighterCombatState`, never
// decides an outcome, never writes anything back.

import type { AttackActionId, CombatActionPhase, DefenseActionId } from '../simulation/combatActions'
import type { FighterCombatState } from '../simulation/encounter'
import type { Archetype } from '../simulation/fighters'
import { TICKS_PER_SECOND } from '../simulation/movement'
import { ATTACK_CLIPS, BASE_CLIPS, DEFENSE_CLIPS } from './fighterModelContract'
import { computeGaitPhase } from './gait'

export interface ClipSelection {
  clip: string
  /** Seconds into the clip. */
  time: number
  weaponTrailActive: boolean
}

export interface ClipMappingInput {
  archetype: Archetype
  state: Readonly<FighterCombatState>
  tick: number
  alpha: number
  /** Tick of the `fighter-staggered` event that opened the current stagger; `ArenaView` records it. */
  staggerStartTick?: number
  /** Tick of the `fighter-defeated` event. */
  defeatedAtTick?: number
  /** Clip durations in seconds, from the loaded model. */
  durations: ReadonlyMap<string, number>
}

/** Held portion of an attack clip after the strike frame, as a fraction of the clip. */
const IMPACT_HOLD_FRACTION = 0.15
/** Fraction of a defense clip spent raising the guard; the rest lowers it. */
const DEFENSE_IMPACT_FRACTION = 0.6
/** Windup progress from which the weapon trail shows (same rule `PoseController` used). */
const WEAPON_TRAIL_WINDUP_THRESHOLD = 0.6
const MOVING_SPEED_EPSILON = 0.01

const clamp01 = (value: number): number => Math.min(1, Math.max(0, value))

function isAttackActionId(id: string): id is AttackActionId {
  return Object.prototype.hasOwnProperty.call(ATTACK_CLIPS, id)
}
function isDefenseActionId(id: string): id is DefenseActionId {
  return Object.prototype.hasOwnProperty.call(DEFENSE_CLIPS, id)
}

function phaseProgress(t: number, startedTick: number, endsAtTick: number): number {
  const span = endsAtTick - startedTick
  return span > 0 ? clamp01((t - startedTick) / span) : 1
}

function attackTime(phase: CombatActionPhase, p: number, contactAt: number, duration: number): number {
  const hold = Math.min(contactAt + IMPACT_HOLD_FRACTION, 0.95)
  switch (phase) {
    case 'windup':
      return p * contactAt * duration
    case 'contact':
    case 'impact':
      return (contactAt + p * (hold - contactAt)) * duration
    case 'recovery':
      return (hold + p * (1 - hold)) * duration
  }
}

export function selectClip(input: ClipMappingInput): ClipSelection {
  const { state, tick, alpha, durations } = input
  const t = tick + alpha
  const durationOf = (clip: string): number => durations.get(clip) ?? 1
  const still = (clip: string, time: number): ClipSelection => ({ clip, time, weaponTrailActive: false })

  if (state.status === 'defeated') {
    const clip = BASE_CLIPS.death
    const since = (t - (input.defeatedAtTick ?? tick)) / TICKS_PER_SECOND
    return still(clip, Math.min(Math.max(0, since), durationOf(clip)))
  }

  if (state.staggerUntilTick > tick) {
    const clip = BASE_CLIPS.hit
    const since = (t - (input.staggerStartTick ?? tick)) / TICKS_PER_SECOND
    return still(clip, Math.min(Math.max(0, since), durationOf(clip)))
  }

  const action = state.action
  if (action.type === 'active') {
    const p = phaseProgress(t, action.phaseStartedTick, action.phaseEndsAtTick)
    if (isAttackActionId(action.definitionId)) {
      const { clip, contactAt } = ATTACK_CLIPS[action.definitionId]
      const trail = action.phase === 'contact' || action.phase === 'impact' || (action.phase === 'windup' && p >= WEAPON_TRAIL_WINDUP_THRESHOLD)
      return { clip, time: attackTime(action.phase, p, contactAt, durationOf(clip)), weaponTrailActive: trail }
    }
    if (isDefenseActionId(action.definitionId)) {
      const clip = DEFENSE_CLIPS[action.definitionId]
      const duration = durationOf(clip)
      const time = action.phase === 'recovery'
        ? (DEFENSE_IMPACT_FRACTION + p * (1 - DEFENSE_IMPACT_FRACTION)) * duration
        : p * DEFENSE_IMPACT_FRACTION * duration
      return still(clip, time)
    }
  }

  if (Math.hypot(state.velocity.x, state.velocity.z) > MOVING_SPEED_EPSILON) {
    const clip = BASE_CLIPS.walk
    return still(clip, computeGaitPhase(state.travelledDistance, input.archetype) * durationOf(clip))
  }

  const idle = BASE_CLIPS.idle
  return still(idle, (t / TICKS_PER_SECOND) % durationOf(idle))
}
