// Authored, immutable combat style and action values. Plain data only: no
// functions, no mutable state, `structuredClone`-safe. `src/simulation/**`
// receives this catalog by dependency injection and never imports this file;
// see `src/simulation/architecture.test.ts`'s boundary scan and
// `src/simulation/combatActions.ts` for the contracts and validation this
// data must satisfy.

import type { CombatStyleCatalog } from '../simulation/combatActions'

export const COMBAT_STYLES = {
  styles: {
    heavy: {
      archetype: 'heavy',
      locomotion: {
        forwardUnitsPerSecond: 1.4,
        backwardUnitsPerSecond: 0.9,
        lateralUnitsPerSecond: 0.8,
        burstUnitsPerSecond: 1.8,
        // 2.0°/tick, documentation only — never converted at runtime.
        turnCosPerTick: 0.9993908270,
        turnSinPerTick: 0.0348994967,
      },
      preferredRange: { min: 1.2, max: 1.7 },
      attackActionIds: ['heavy-shield-jab', 'heavy-cleave'],
      defenseActionId: 'heavy-guard',
      baseWeights: {
        advance: 12,
        'hold-range': 8,
        pressure: 12,
        'circle-left': 2,
        'circle-right': 2,
        retreat: 0,
        'heavy-shield-jab': 14,
        'heavy-cleave': 8,
      },
    },
    fast: {
      archetype: 'fast',
      locomotion: {
        forwardUnitsPerSecond: 2.4,
        backwardUnitsPerSecond: 2.7,
        lateralUnitsPerSecond: 2.1,
        burstUnitsPerSecond: 4,
        // 3.4°/tick, documentation only — never converted at runtime.
        turnCosPerTick: 0.9982398279,
        turnSinPerTick: 0.0593063736,
      },
      preferredRange: { min: 2.4, max: 3.0 },
      attackActionIds: ['fast-slash', 'fast-burst-lunge'],
      defenseActionId: 'fast-evade',
      baseWeights: {
        'circle-left': 12,
        'circle-right': 12,
        'hold-range': 5,
        retreat: 8,
        'burst-in': 14,
        'fast-slash': 12,
        'fast-burst-lunge': 14,
      },
    },
    technical: {
      archetype: 'technical',
      locomotion: {
        forwardUnitsPerSecond: 1.7,
        backwardUnitsPerSecond: 2.0,
        lateralUnitsPerSecond: 1.3,
        burstUnitsPerSecond: 2.4,
        // 2.6°/tick, documentation only — never converted at runtime.
        turnCosPerTick: 0.9989705698,
        turnSinPerTick: 0.0453629881,
      },
      preferredRange: { min: 2.1, max: 2.8 },
      attackActionIds: ['technical-thrust', 'technical-driving-thrust', 'technical-parry-counter'],
      defenseActionId: 'technical-parry',
      baseWeights: {
        'hold-range': 12,
        backstep: 12,
        'circle-left': 6,
        'circle-right': 6,
        advance: 6,
        'technical-thrust': 14,
        'technical-driving-thrust': 8,
      },
    },
  },
  attacks: {
    'heavy-shield-jab': {
      id: 'heavy-shield-jab',
      tags: ['attack', 'probe', 'shield', 'unparryable'],
      contactRange: { min: 0.9, max: 1.4 },
      minimumFacingDot: 0.5736, // ~55°
      windupTicks: 14,
      impactTicks: 3,
      recoveryTicks: 20,
      damageMultiplier: 0.80,
      accuracyModifier: 0.08,
      rootTravel: 0.25,
      pushDistance: 0.40,
      staggerTicks: 12,
      contactPriority: 30,
    },
    'heavy-cleave': {
      id: 'heavy-cleave',
      tags: ['attack', 'committed', 'weapon', 'parryable'],
      contactRange: { min: 0.9, max: 1.8 },
      minimumFacingDot: 0.6428, // ~50°
      windupTicks: 34,
      impactTicks: 6,
      recoveryTicks: 56,
      damageMultiplier: 2.70,
      accuracyModifier: -0.06,
      rootTravel: 0.45,
      pushDistance: 0.70,
      staggerTicks: 24,
      contactPriority: 10,
    },
    'fast-slash': {
      id: 'fast-slash',
      tags: ['attack', 'probe', 'weapon', 'parryable'],
      // The retiarius' probe, widened with his committed attack. The floor
      // stays at 0.9 deliberately: he must retain one legal attack at EVERY
      // distance. The hoplomachus can afford a 1.2 floor because he authors
      // `backstep` and the decision seam gates that intent below 1.2 to answer
      // exactly this; the retiarius authors no `backstep`, and the anti-stall
      // exemption only frees movement that *restores a legal action* -- a
      // fighter with no legal action anywhere near him is the absorbing state
      // Task 13 had to dig the kernel out of.
      //
      // This is a larger change than it looks and carries its own risks: the
      // probe is now legal from ~2.30 units, it changes Technical's reaction
      // opportunities and defense-stream consumption, and its priority-40
      // contact resolves ahead of most others. Measured effects: parries
      // against it rise from 36 to 201, and its own geometry failures FALL
      // from 14.1% to 4.1%.
      contactRange: { min: 0.9, max: 2.05 },
      minimumFacingDot: 0.4226, // ~65°
      windupTicks: 10,
      impactTicks: 2,
      recoveryTicks: 10,
      damageMultiplier: 1.65,
      accuracyModifier: 0.06,
      rootTravel: 0.25,
      pushDistance: 0.18,
      staggerTicks: 8,
      contactPriority: 40,
    },
    'fast-burst-lunge': {
      id: 'fast-burst-lunge',
      tags: ['attack', 'committed', 'burst', 'weapon', 'parryable'],
      // 1.60 rather than a value interpolated from the equipment: it is
      // `technical-driving-thrust`'s floor, deliberately. The acceptance gate
      // compares the two types' shares of contacts inside the murmillo's
      // envelope, and that share counts the interval [contactRange.min, 1.7],
      // whose WIDTH this floor sets. At 1.4 the retiarius showed 35.4% against
      // the hoplomachus' 11.3% purely because it had three times the room;
      // aligned, the same package measures 5.5%. `measure-reach.ts`'s gate
      // asserts the equality rather than trusting this comment.
      contactRange: { min: 1.6, max: 2.4 },
      startMaxRange: 4.0,
      minimumFacingDot: 0.8192, // ~35°
      windupTicks: 18,
      impactTicks: 3,
      // Recalibrated on 2026-08-18, when `hasFastForcedDisengageEnded`'s
      // inverted range test was fixed (the forced disengage used to end on
      // the tick it started, so Fast never actually paid for -- or benefited
      // from -- backing out after a lunge). With the mechanic live, Fast
      // retreats to 2.4 units, which is the middle of Technical's own thrust
      // envelope (1.2..3.1), and the equal-stat cohort measured `fast vs
      // technical` at 40.4% against the design's 55..75% band. Shortening
      // the recovery (less time parked next to the target before the retreat
      // begins) and paying the lunge slightly better restores the triangle:
      // measured 57.2% `fast vs technical`, 58.6% `heavy vs fast`, 58.0%
      // `technical vs heavy`, mirrors 49.8/52.0/50.4. Both fields are inside
      // design.md's "implementation may tune ... action damageMultiplier /
      // recoveryTicks" allowance, and the qualitative orderings it pins are
      // unchanged (the probe stays quicker and cheaper, Heavy's cleave stays
      // the slowest commitment, Technical keeps the longest reach).
      recoveryTicks: 20,
      damageMultiplier: 2.60,
      accuracyModifier: 0,
      // 1.40 was the ACTUAL cause of the defect, not the contact range. The
      // kernel clamps root travel at max(minimumSeparation, contactRange.min)
      // (`encounter.ts`, the phase-8 lunge clamp), so a lunge carrying 1.40
      // forward landed on the 0.9 arena floor whatever its nominal reach: the
      // authored attack was chosen at a median separation of 2.13, closed 1.23
      // units between decision and contact, and made contact at 0.90 -- the
      // closest two fighters can legally stand -- every time. A candidate with
      // reach 2.70 and this field left at 1.40 reproduced that 0.90 median
      // exactly, which is how the diagnosis was confirmed rather than assumed.
      rootTravel: 0.50,
      pushDistance: 0.35,
      staggerTicks: 14,
      contactPriority: 30,
    },
    'technical-thrust': {
      id: 'technical-thrust',
      tags: ['attack', 'probe', 'weapon', 'parryable'],
      contactRange: { min: 1.2, max: 2.8 },
      minimumFacingDot: 0.9397, // ~20°
      windupTicks: 20,
      impactTicks: 3,
      recoveryTicks: 15,
      damageMultiplier: 1.38,
      accuracyModifier: 0.04,
      rootTravel: 0.20,
      pushDistance: 0.30,
      staggerTicks: 12,
      contactPriority: 25,
    },
    'technical-driving-thrust': {
      id: 'technical-driving-thrust',
      tags: ['attack', 'committed', 'weapon', 'parryable'],
      contactRange: { min: 1.6, max: 3.1 },
      minimumFacingDot: 0.9511, // ~18°
      windupTicks: 30,
      impactTicks: 4,
      recoveryTicks: 24,
      damageMultiplier: 1.90,
      accuracyModifier: -0.03,
      rootTravel: 0.50,
      pushDistance: 0.50,
      staggerTicks: 20,
      contactPriority: 15,
    },
    'technical-parry-counter': {
      id: 'technical-parry-counter',
      tags: ['attack', 'forced', 'counter', 'weapon'],
      contactRange: { min: 0.9, max: 2.3 },
      minimumFacingDot: 0.8660, // ~30°
      windupTicks: 8,
      impactTicks: 4,
      recoveryTicks: 20,
      damageMultiplier: 1.1,
      accuracyModifier: 0.12,
      rootTravel: 0.30,
      pushDistance: 0.40,
      staggerTicks: 18,
      contactPriority: 50,
    },
  },
  defenses: {
    'heavy-guard': {
      id: 'heavy-guard',
      tags: ['defense'],
      minimumReactionLeadTicks: 8,
      impactTicks: 4,
      recoveryTicks: 6,
      minimumIncomingFacingDot: 0.3420, // ~front ±70°
    },
    'fast-evade': {
      id: 'fast-evade',
      tags: ['defense'],
      minimumReactionLeadTicks: 7,
      impactTicks: 3,
      recoveryTicks: 8,
      // Authored defense dash, distributed across the seven remaining
      // windup ticks. Deliberately independent of Fast's ordinary
      // locomotion speed; still constrained by arena/policy/separation.
      evadeDisplacement: { min: 0.9, max: 1.2 },
    },
    'technical-parry': {
      id: 'technical-parry',
      tags: ['defense'],
      minimumReactionLeadTicks: 10,
      impactTicks: 4,
      recoveryTicks: 10,
      minimumIncomingFacingDot: -0.1736, // ~front ±100°
    },
  },
} as const satisfies CombatStyleCatalog
