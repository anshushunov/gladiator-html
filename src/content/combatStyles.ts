// Authored, immutable combat style and action values. Plain data only: no
// functions, no mutable state, `structuredClone`-safe. `src/simulation/**`
// receives this catalog by dependency injection and never imports this file;
// see `src/simulation/architecture.test.ts`'s boundary scan and
// `src/simulation/combatActions.ts` for the contracts and validation this
// data must satisfy.
//
// ---------------------------------------------------------------------------
// THE 2026-09-05 BODY-WIDTH TRANSLATION (+0.30 ON EVERY SEPARATION)
// ---------------------------------------------------------------------------
//
// Every `preferredRange` and `contactRange` in this file moved outward by
// exactly 0.30 units in one edit, together with the duel arena's
// `minimumSeparation` (0.90 -> 1.20, `battle.ts`) and the four separation
// thresholds in `combatDecision.ts` that are measured in the same units
// (`BURST_IN_MIN_RANGE`, `BURST_IN_MAX_RANGE`,
// `FAST_FORCED_DISENGAGE_END_RANGE`, `TECHNICAL_FORCED_COUNTER_RANGE`).
//
// WHAT IT IS. A change of origin, not a balance change. The distance axis is
// root-to-root, and the roots were calibrated when the fighters were capsules.
// Task 7's skinned models are ~2.0 units tall with heads about a third of their
// height, so at the old 0.90 floor two men stand inside each other's guard and
// no windup in the animation pack -- which needs roughly 1.3-1.5 units to read
// as a swing -- can play without the arms passing through the other body. The
// 2026-09-05 playtest reported it as fighters "grinding almost stuck together",
// and the measurement behind that finding is in
// `docs/reviews/2026-09-05-skinned-gladiators-playtest.md`.
//
// WHY A TRANSLATION RATHER THAN RAISING THE FLOOR ALONE. Validation requires
// `contactRange.min >= arena.minimumSeparation` (`combatActions.ts`), so the
// floor cannot move on its own: the four attacks authored at 0.90 would become
// invalid. Clipping their minima up to 1.20 and leaving their maxima put would
// have shrunk `heavy-shield-jab` from a 0.50-wide band to 0.20 and cut every
// close-quarters style's reach unevenly -- a large, unintended nerf aimed
// hardest at the one archetype whose whole game is the pocket. Translating
// instead preserves EVERY width, EVERY gap between two ranges, and every
// ordering the design pins. Locomotion speeds, `rootTravel`, `pushDistance`
// and `evadeDisplacement` are displacements rather than separations and are
// deliberately NOT shifted; the time to cross between any two bands is
// therefore also unchanged.
//
// WHAT IT COST, MEASURED. Nothing that any acceptance band can see: the roster
// and equal-stat cohorts, the disposition cohorts and the golden season all
// pass unchanged. See `docs/superpowers/plans/2026-09-05-fighting-room.md` for
// the before/after tables.
//
// WHAT IS *NOT* PART OF THE TRANSLATION. Exactly one pair of numbers in the
// same commit is a genuine behaviour change rather than a change of origin:
// `technical-thrust`'s and `technical-driving-thrust`'s `pushDistance`, which
// answer the playtest's OTHER finding. Their comments carry that sweep. Every
// other number below moved by 0.30 or did not move at all.

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
      preferredRange: { min: 1.5, max: 2.0 },
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
      preferredRange: { min: 2.7, max: 3.3 },
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
      preferredRange: { min: 2.4, max: 3.1 },
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
      contactRange: { min: 1.2, max: 1.7 },
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
      contactRange: { min: 1.2, max: 2.1 },
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
      // The retiarius' probe, widened with his committed attack. The floor sits
      // ON the arena's `minimumSeparation` deliberately -- 0.90 before the
      // 2026-09-05 translation, 1.20 after it, the same statement in both
      // frames: he must retain one legal attack at EVERY distance two fighters
      // can legally stand at. The hoplomachus can afford a floor above it
      // because he authors `backstep` and the decision seam gates that intent
      // to answer exactly this; the retiarius authors no `backstep`, and the
      // anti-stall exemption only frees movement that *restores a legal
      // action* -- a fighter with no legal action anywhere near him is the
      // absorbing state Task 13 had to dig the kernel out of.
      //
      // This was a larger change than it looked and carries its own risks: the
      // probe is legal from ~2.60 units (was ~2.30 pre-translation), it changes
      // Technical's reaction opportunities and defense-stream consumption, and
      // its priority-40 contact resolves ahead of most others. Measured effects
      // at the time: parries against it rose from 36 to 201, and its own
      // geometry failures FELL from 14.1% to 4.1%.
      contactRange: { min: 1.2, max: 2.35 },
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
      // 1.90 (1.60 before the 2026-09-05 translation) rather than a value
      // interpolated from the equipment: it is `technical-driving-thrust`'s
      // floor, deliberately, and the two moved together so the equality
      // survives. The acceptance gate compares the two types' shares of
      // contacts inside the murmillo's envelope, and that share counts the
      // interval `[contactRange.min, heavy.preferredRange.max]`, whose WIDTH
      // this floor sets. At the equivalent of 1.4 the retiarius showed 35.4%
      // against the hoplomachus' 11.3% purely because it had three times the
      // room; aligned, the same package measures 5.5%.
      // `combatStyles.test.ts` asserts the equality rather than trusting this
      // comment.
      contactRange: { min: 1.9, max: 2.7 },
      startMaxRange: 4.3,
      minimumFacingDot: 0.8192, // ~35°
      windupTicks: 18,
      impactTicks: 3,
      // Recalibrated on 2026-08-18, when `hasFastForcedDisengageEnded`'s
      // inverted range test was fixed (the forced disengage used to end on
      // the tick it started, so Fast never actually paid for -- or benefited
      // from -- backing out after a lunge). With the mechanic live, Fast
      // retreats to the middle of Technical's own thrust envelope, and the
      // equal-stat cohort measured `fast vs
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
      // forward landed on the arena floor whatever its nominal reach: the
      // authored attack was chosen at a median separation of 2.13, closed 1.23
      // units between decision and contact, and made contact at 0.90 -- the
      // closest two fighters could then legally stand -- every time. A candidate
      // with reach 2.70 and this field left at 1.40 reproduced that 0.90 median
      // exactly, which is how the diagnosis was confirmed rather than assumed.
      // This field is a DISPLACEMENT, so the 2026-09-05 translation left it
      // alone; the floor it lands on is now 1.20.
      rootTravel: 0.50,
      pushDistance: 0.35,
      staggerTicks: 14,
      contactPriority: 30,
    },
    'technical-thrust': {
      id: 'technical-thrust',
      tags: ['attack', 'probe', 'weapon', 'parryable'],
      // The hoplomachus' measure floor, and the number the 2026-09-05 playtest's
      // first finding is really about: below it he has no ordinary attack at
      // all, which is what makes `backstep` his authored answer to being closed
      // down. `BACKSTEP_MAX_RANGE` in `combatDecision.ts` used to sit exactly
      // here; it no longer does, and its comment says why.
      contactRange: { min: 1.5, max: 3.1 },
      minimumFacingDot: 0.9397, // ~20°
      windupTicks: 20,
      impactTicks: 3,
      recoveryTicks: 15,
      damageMultiplier: 1.38,
      accuracyModifier: 0.04,
      rootTravel: 0.20,
      // 0.70, from 0.30, and this is the 2026-09-05 slice's ONE real behaviour
      // change; everything else in that commit is the translation.
      //
      // It answers the playtest's first finding -- "the hoplomachus goes into
      // melee, makes no attempt to break the range, and just trades" -- and it
      // is the second lever tried. The first, raising `BACKSTEP_MAX_RANGE` so
      // he could walk backwards out of the murmillo's pocket, measured as a
      // failure and its table is kept in that constant's comment: against a
      // murmillo it moved nothing and made the pinning worse, because backing
      // away is a walking race a fighter committed to a 38-tick thrust cannot
      // win inside a bounded arena.
      //
      // A push is not a race. It makes the measure on the tick the spear
      // lands, which is also what a spear is FOR: the hoplomachus keeps his
      // distance by putting the point in the way, not by outrunning anyone.
      //
      // Swept jointly with `technical-driving-thrust`'s push at 20 seeds x 9
      // roster pairings (`scripts/measure-distance.ts`), everything else fixed.
      // The columns are Technical's share of ticks inside its own 2.4-3.1
      // measure in the two murmillo pairings, the mean over all six
      // observations, and the share of all ticks pinned within 0.15 of the
      // separation floor:
      //
      //   thrust/driving   brutus/cassius   nerva/magnus   mean   pinned
      //     0.30 / 0.50         5.4%            5.5%       22.7%   11.0%
      //     0.50 / 0.80         6.6%            6.7%       28.4%   11.8%
      //     0.70 / 1.10        11.8%           11.8%       30.0%   10.5%   <- shipped
      //     0.90 / 1.40        15.9%           13.3%       29.2%   10.3%
      //
      // 0.70/1.10 is the knee: it roughly doubles the murmillo-pairing figure
      // while the mean has stopped climbing, and it is the first cell where
      // the pinning turns back DOWN rather than up. 0.90/1.40 buys four more
      // points against one murmillo for a push larger than any committed
      // attack in the game, which is a caricature of the weapon rather than a
      // reading of it.
      pushDistance: 0.70,
      staggerTicks: 12,
      contactPriority: 25,
    },
    'technical-driving-thrust': {
      id: 'technical-driving-thrust',
      tags: ['attack', 'committed', 'weapon', 'parryable'],
      contactRange: { min: 1.9, max: 3.4 },
      minimumFacingDot: 0.9511, // ~18°
      windupTicks: 30,
      impactTicks: 4,
      recoveryTicks: 24,
      damageMultiplier: 1.90,
      accuracyModifier: -0.03,
      rootTravel: 0.50,
      // 1.10, from 0.50, swept jointly with `technical-thrust`'s push -- see
      // that action for the table and the reasoning. The largest push in the
      // catalogue, deliberately: it is a two-handed spear drive, and it is the
      // hoplomachus' answer to being closed down.
      pushDistance: 1.10,
      staggerTicks: 20,
      contactPriority: 15,
    },
    'technical-parry-counter': {
      id: 'technical-parry-counter',
      tags: ['attack', 'forced', 'counter', 'weapon'],
      // The one hoplomachus attack that stays legal down to the arena floor,
      // and deliberately so: it is the parry reward, and a reward that
      // evaporates exactly when the murmillo has succeeded in closing would
      // punish the defender for defending. `TECHNICAL_FORCED_COUNTER_RANGE`
      // tracks this `max`.
      contactRange: { min: 1.2, max: 2.6 },
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
