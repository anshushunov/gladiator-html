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
      damageMultiplier: 0.65,
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
      recoveryTicks: 34,
      damageMultiplier: 1.75,
      accuracyModifier: -0.06,
      rootTravel: 0.45,
      pushDistance: 0.70,
      staggerTicks: 24,
      contactPriority: 10,
    },
    'fast-slash': {
      id: 'fast-slash',
      tags: ['attack', 'probe', 'weapon', 'parryable'],
      contactRange: { min: 0.9, max: 1.35 },
      minimumFacingDot: 0.4226, // ~65°
      windupTicks: 10,
      impactTicks: 2,
      recoveryTicks: 15,
      damageMultiplier: 0.75,
      accuracyModifier: 0.06,
      rootTravel: 0.25,
      pushDistance: 0.18,
      staggerTicks: 8,
      contactPriority: 40,
    },
    'fast-burst-lunge': {
      id: 'fast-burst-lunge',
      tags: ['attack', 'committed', 'burst', 'weapon', 'parryable'],
      contactRange: { min: 0.9, max: 1.45 },
      startMaxRange: 2.8,
      minimumFacingDot: 0.8192, // ~35°
      windupTicks: 18,
      impactTicks: 3,
      recoveryTicks: 24,
      damageMultiplier: 1.25,
      accuracyModifier: 0,
      rootTravel: 1.40,
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
      recoveryTicks: 22,
      damageMultiplier: 1.0,
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
      recoveryTicks: 30,
      damageMultiplier: 1.5,
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
      recoveryTicks: 12,
      minimumIncomingFacingDot: 0.3420, // ~front ±70°
    },
    'fast-evade': {
      id: 'fast-evade',
      tags: ['defense'],
      minimumReactionLeadTicks: 7,
      impactTicks: 3,
      recoveryTicks: 14,
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
      recoveryTicks: 16,
      minimumIncomingFacingDot: -0.1736, // ~front ±100°
    },
  },
} as const satisfies CombatStyleCatalog
