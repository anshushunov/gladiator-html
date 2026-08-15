# Readable Deep Combat — MVP Design

**Status:** approved in collaborative design review

**Date:** 2026-08-16

## Terminology

- **Style** — one of the existing combat archetypes (`heavy`, `fast`, `technical`) expressed through equipment, preferred distance, movement, attacks, and defense.
- **Action** — one atomic attack, defense, or forced counter with an explicit simulation timeline.
- **Phase** — `windup`, one-tick `contact`, `impact`, or `recovery` inside an action.
- **Exchange** — positioning followed by at least one committed action and its resolution, ending when both fighters can make a new decision.
- **Opening** — a target in `recovery` or `stagger`, where an unblocked hit may become critical.
- **Intent** — semantic locomotion chosen by simulation, such as `pressure`, `burst-in`, or `disengage`.
- **Rig** — the shared procedural humanoid joint hierarchy rendered by Three.js.
- **Pose controller** — presentation code that turns simulation state into joint transforms without deciding game rules.

## Context

MR #2 established a complete deterministic school-management loop: assign three distinct gladiators to three visible opponents, watch all three bouts, review the result, and rematch the same seeded challenge. Combat currently proves the runtime and event pipeline but remains visually and mechanically shallow. Fighters approach on one axis, stop at a fixed range, and exchange instantaneous attacks while primitive whole-body reactions decay in presentation.

The MVP's long-term purpose is to explore combat deeply. The next slice therefore changes both simulation and presentation. It must make an autonomous duel readable and worth watching before imported character assets, skeletal animation clips, particles, or dynamic cameras are introduced.

## Product hypothesis

A player will find an autonomous duel interesting when each gladiator has a recognizable fighting identity, intent is visible before the result, distance changes during the bout, and decisive hits can be explained from observed actions without relying on the battle feed.

The slice tests three qualities:

1. **Readability:** the viewer can distinguish preparation, contact, block, evade, parry, recovery, stagger, and defeat.
2. **Character:** `heavy`, `fast`, and `technical` are recognizable from silhouette, equipment, stance, rhythm, and movement.
3. **Causality:** the result appears to follow positioning, timing, defense, fighter attributes, and seeded variation rather than unexplained HP loss.

This is a combat-depth hypothesis, not a final-art hypothesis.

## Industry principles adopted

- Observed combat may need slower, more appreciable animation than input-driven combat. Riot slowed TFT animations and reduced visual clutter to improve spectating clarity: <https://teamfighttactics.leagueoflegends.com/en-ph/news/dev/tf-t-minus-eighteen-weeks-the-story-of-tft-part-1/>.
- Strong keys, anticipation, impact, recovery, holds, and hitstop matter more than uniformly smooth in-betweens. The implementation follows the rough → integrate → finish loop described for Skullgirls: <https://media.gdcvault.com/gdcchina14/presentations/833784_MarielCartwright_PowerfulAndEffective_EN.pdf>.
- Stance and weapon position should communicate intent. This is the useful part of For Honor's Art of Battle for an observed duel: <https://www.ubisoft.com/en-us/game/for-honor/news-updates/3i9GE9e7XGWHqKQH2wUtZc/for-honor-the-art-of-battle>.
- Weapon and armor should imply strategy. Roman gladiator types used distinct armaments and fighting styles, providing a grounded visual basis without requiring strict historical simulation: <https://www.metmuseum.org/pt/essays/gladiators-types-and-training>.
- Camera stability improves legibility; weight can be recovered through timing, reactions, and audio instead of shake: <https://blog.playstation.com/2022/10/04/game-developers-explain-what-makes-god-of-war-2018s-combat-tick/>.
- Audio cues may build toward contact and distinguish attack or material types: <https://blog.playstation.com/2021/12/06/horizon-forbidden-west-outsmart-your-enemies/>.

## Goals

1. Replace stationary attack trading with deterministic two-dimensional spacing, entry, exit, and lateral movement.
2. Give each style a distinct offensive, defensive, locomotion, equipment, and silhouette identity.
3. Make attack timing part of simulation through explicit action phases.
4. Keep the simulation independent of DOM, Three.js, Web Audio, frame rate, and wall-clock time.
5. Render a shared articulated procedural humanoid rig whose semantic pose contract can later drive imported skeletal models.
6. Add restrained contact feedback and event-driven procedural combat audio.
7. Preserve the series-management flow, URL seed, rematch behavior, and deterministic test surface.
8. Establish a narrow decision-policy seam for future combat skill and perks without implementing progression now.

## Non-goals

- Direct player control during a bout.
- Imported GLTF characters, authored animation clips, motion capture, retargeting, motion matching, or production character art.
- Combo trees, feints, stamina, activated abilities, nets, projectiles, equipment management, injuries, or progression.
- A generic perk engine or a `combatSkill` attribute in current content.
- Blood, gore, dismemberment, ragdolls, or complex physics.
- Dynamic orbiting cameras, cinematic cuts, camera shake, particles, or post-processing as standalone systems.
- Reworking planning, interstitial, summary, rematch, or series ordering beyond the combat data they display.
- Final mobile/performance budgets. Existing checks must remain healthy, but profiling is a later spike.

## Player-facing acceptance

At `×1`, a reviewer watching with HP cards and battle feed hidden must be able to:

- identify all three styles from equipment, silhouette, stance, and movement;
- tell who is pressuring, preserving distance, entering, or disengaging;
- distinguish a hit, block, evade, parry, stagger, and defeat;
- identify the anticipation and recovery of a committed attack;
- explain most decisive contacts using the visible state immediately before them.

`×2` remains readable enough to follow the winner of each exchange. `×4` is an accelerated review mode and is not required to preserve every pose or audio cue.

An ordinary bout lasts `1500–2400` simulation ticks (25–40 seconds) and contains approximately 6–10 completed exchanges. The hard limit is `3600` ticks (60 seconds). A full three-bout series at `×1` should take roughly two minutes of combat.

## Style identities

The historical labels are visual inspiration, not new public archetype IDs.

| Archetype | Visual discipline | Equipment | Preferred play |
| --- | --- | --- | --- |
| `heavy` | Murmillo-inspired | large scutum-like shield, gladius, heavy crested helmet | take center, advance behind guard, absorb fast attacks, commit to a slow cleave |
| `fast` | Thraex-inspired | small round shield, curved sica-like sword, light torso armor | circle, burst inside, attack from an angle, disengage before retaliation |
| `technical` | Hoplomachus-inspired | spear, medium round shield, tall controlled silhouette | hold measure, backstep, thrust at range, parry a readable commitment and counter |

The existing counter triangle remains:

`heavy → fast → technical → heavy`

The arrow means **has an advantage against**. Advantage stays soft: it influences damage and decision scoring, while geometry and style behavior provide the visible explanation.

## Simulation clock and combat space

- `TICKS_PER_SECOND = 60`.
- `MAX_BOUT_TICKS = 3600`.
- State contains integer ticks only. Seconds are derived for display.
- Fighters move on an `x/z` plane represented by a plain immutable `Vec2` type.
- Start positions are `home = (-4.2, 0)` and `away = (4.2, 0)`.
- The walkable floor has radius `6.5`, with lateral movement additionally clamped to `z = -2.5..2.5` for the fixed gameplay camera.
- Fighter centers remain at least `0.9` units apart.
- Fighters always face their opponent. Presentation derives body yaw from simulation facing.
- Home and away do not swap their projected left/right sides in this slice. Crossing movement is clamped before the minimum-separation solve.
- Movement is simultaneous: both desired displacements are computed from the state at the beginning of the movement step, combined, then clamped and separated symmetrically.

Simulation owns root position. Presentation may adjust limbs and weapon contact but may not cosmetically translate a fighter root away from the simulated position.

## Locomotion

```ts
type LocomotionIntent =
  | 'hold-range'
  | 'advance'
  | 'retreat'
  | 'circle-left'
  | 'circle-right'
  | 'burst-in'
  | 'backstep'
  | 'disengage'
  | 'pressure'
  | 'stagger'
  | 'defeated'
```

| Style | Forward | Backward | Lateral | Burst | Neutral preferred distance |
| --- | ---: | ---: | ---: | ---: | ---: |
| Heavy | 1.4 u/s | 0.9 u/s | 0.8 u/s | 1.8 u/s | 1.2–1.7 |
| Fast | 2.4 u/s | 2.7 u/s | 2.1 u/s | 4.0 u/s | 2.4–3.0 before entry |
| Technical | 1.7 u/s | 2.0 u/s | 1.3 u/s | 2.4 u/s | 2.1–2.8 |

Style movement behavior:

- Heavy prefers `pressure` or `advance`, yields little ground during ordinary movement, and never selects routine `disengage`.
- Fast prefers shallow arcs outside contact range, uses `burst-in` only with an attack plan, and is forced into `disengage` after a burst-lunge recovery until reaching 2.4 units or spending 30 ticks.
- Technical holds spear measure, selects `backstep` when an opponent enters below 1.2 units, and may circle only while remaining able to face the opponent.

Movement during action phases is constrained:

- `windup`: only the action definition's authored root travel is allowed;
- `contact`: no new locomotion decision;
- `impact`: root motion freezes except for resolved pushback;
- `recovery`: at most 35% of normal style speed;
- `stagger`: only deterministic pushback/recovery motion;
- `defeated`: no locomotion.

## Action state

```ts
interface Vec2 {
  x: number
  z: number
}

interface CombatArenaDefinition {
  radius: number
  lateralLimit: number
  minimumSeparation: number
  startPositions: Readonly<Record<FighterSide, Vec2>>
}

type AttackActionId =
  | 'heavy-shield-jab'
  | 'heavy-cleave'
  | 'fast-slash'
  | 'fast-burst-lunge'
  | 'technical-thrust'
  | 'technical-driving-thrust'
  | 'technical-parry-counter'

type DefenseActionId =
  | 'heavy-guard'
  | 'fast-evade'
  | 'technical-parry'

type CombatActionId = AttackActionId | DefenseActionId

type CombatActionPhase = 'windup' | 'contact' | 'impact' | 'recovery'

type CombatActionState =
  | { type: 'neutral' }
  | {
      type: 'active'
      instanceId: number
      definitionId: CombatActionId
      phase: CombatActionPhase
      phaseStartedTick: number
      phaseEndsAtTick: number
      targetSide: FighterSide
      attackRolls?: { accuracy: number; critical: number }
    }

interface FighterCombatState {
  side: FighterSide
  definition: FighterDefinition
  position: Vec2
  facing: number
  hp: number
  status: 'active' | 'defeated'
  locomotionIntent: LocomotionIntent
  velocity: Vec2
  action: CombatActionState
  staggerUntilTick: number
  nextDecisionTick: number
  lastReactedToActionInstanceId?: number
  forcedActionId?: CombatActionId
}
```

`phaseEndsAtTick` is exclusive. If an action begins windup on tick `D` with `windupTicks = W`, windup occupies ticks `D..D+W-1`; contact occurs on tick `D+W`; contact always lasts exactly one tick. Impact begins on the following tick, then recovery. A fighter returns to neutral at the first tick after recovery ends.

An attack or counter action must contain `attackRolls`; a defense action must not. A defender records `lastReactedToActionInstanceId` after its one allowed reaction roll, including a failed roll, so it cannot retry the same windup on later ticks.

When a fighter enters stagger, an unstarted action is cleared. An action already in its one-tick contact phase is not canceled by non-lethal stagger from another same-tick contact. Defeat always cancels remaining contact intents.

## Action definitions

Every action definition is immutable content and has semantic tags. Distances are center-to-center at contact unless a separate start distance is stated.

```ts
interface AttackActionDefinition {
  id: AttackActionId
  tags: readonly string[]
  contactRange: { min: number; max: number }
  startMaxRange?: number
  halfAngleDegrees: number
  windupTicks: number
  impactTicks: number
  recoveryTicks: number
  damageMultiplier: number
  accuracyModifier: number
  rootTravel: number
  pushDistance: number
  staggerTicks: number
  contactPriority: number
}

interface DefenseActionDefinition {
  id: DefenseActionId
  tags: readonly ['defense']
  minimumReactionLeadTicks: number
  impactTicks: number
  recoveryTicks: number
}
```

| ID | Tags | Contact range | Half-angle | Windup | Impact | Recovery | Damage | Accuracy | Root travel | Push | Stagger | Priority |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| `heavy-shield-jab` | `attack probe shield unparryable` | 0.9–1.4 | 55° | 14 | 3 | 20 | `power × 0.65` | `+0.08` | 0.25 | 0.40 | 12 | 30 |
| `heavy-cleave` | `attack committed weapon parryable` | 0.9–1.8 | 50° | 34 | 6 | 34 | `power × 1.75` | `-0.06` | 0.45 | 0.70 | 24 | 10 |
| `fast-slash` | `attack probe weapon parryable` | 0.9–1.35 | 65° | 10 | 2 | 15 | `power × 0.75` | `+0.06` | 0.25 | 0.18 | 8 | 40 |
| `fast-burst-lunge` | `attack committed burst weapon parryable` | start ≤2.8, contact 0.9–1.45 | 35° | 18 | 3 | 24 | `power × 1.25` | `+0.00` | ≤1.40 | 0.35 | 14 | 30 |
| `technical-thrust` | `attack probe weapon parryable` | 1.2–2.8 | 20° | 20 | 3 | 22 | `power × 1.00` | `+0.04` | 0.20 | 0.30 | 12 | 25 |
| `technical-driving-thrust` | `attack committed weapon parryable` | 1.6–3.1 | 18° | 30 | 4 | 30 | `power × 1.50` | `-0.03` | 0.50 | 0.50 | 20 | 15 |
| `technical-parry-counter` | `attack forced counter weapon` | 0.9–2.3 | 30° | 8 | 4 | 20 | `power × 1.10` | `+0.12` | 0.30 | 0.40 | 18 | 50 |

`half-angle` is measured from actor facing on the arena plane. `root travel` follows facing and is the maximum forward displacement authored across windup. It stops early at minimum separation and never expands the legal contact range.

All numeric definition fields must be finite. Tick counts are positive integers; distances and multipliers are non-negative. Unknown action IDs and invalid content are developer errors.

## Defense reactions

Defense is a style-specific action scheduled in response to an incoming windup. A defender is eligible only when active, in `neutral` or ordinary locomotion, and not staggered. Minimum remaining windup is 8 ticks for Heavy, 7 for Fast, and 10 for Technical.

An eligible reaction consumes exactly two values from the defender's defense stream: success and direction. Both are consumed for every style even when direction is irrelevant.

```ts
effectiveDefenseChance = clamp(
  fighter.defenseChance + comparisonDefenseModifier,
  0,
  0.95,
)
```

The comparison modifier is `+0.05` for advantage, `0` for neutral, and `-0.05` for disadvantage. A failed roll schedules no defense. A successful roll schedules the style defense so its active/contact tick aligns with the incoming attack contact.

Defense action timing uses the remaining incoming windup as its own dynamic windup, followed by one aligned contact tick:

| Defense ID | Contact/impact behavior | Impact | Recovery |
| --- | --- | ---: | ---: |
| `heavy-guard` | hold root and shield contact | 4 | 12 |
| `fast-evade` | finish ranked lateral/back displacement | 3 | 14 |
| `technical-parry` | weapon contact and counter opening | 4 | 16 |

These IDs use the same `CombatActionState`, but contain no `attackRolls`.

### Heavy guard

- May answer any current attack.
- Multiplies damage by `0.35`, push by `0.30`, and stagger duration by `0.40`, each rounded as specified below.
- Holds root position during contact and impact.
- Emits `attack-blocked` followed by `damage-dealt` when the attack hits.

### Fast evade

- Uses the direction roll to rank `circle-left`, `circle-right`, and `backstep`; blocked directions fall through in that deterministic order.
- Attempts 0.9–1.2 units of movement during the incoming windup.
- It succeeds only when final geometry places the fighter outside the attack's range or facing sector. The event is `attack-evaded`.
- If arena boundaries prevent all ranked displacements from leaving the contact geometry, the evade is visibly attempted but the normal attack resolution continues.

### Technical parry

- Answers only actions tagged `parryable`.
- Its active tick must match attack contact exactly.
- A successful parry cancels damage, applies 24 ticks of stagger to the attacker, and sets `technical-parry-counter` as the defender's forced next action.
- The forced counter begins on the next tick if the target remains within 2.3 units. Otherwise it is cleared and Technical selects `advance` or `hold-range` normally.
- A shield jab is deliberately unparryable but may miss or be avoided by range.

Future skill may improve reaction choice and error, but current defense chance is a fighter stat. Presentation never performs a defense roll.

## Decision policy

Action selection is a pure simulation function:

```ts
interface CombatDecisionContext {
  tick: number
  self: Readonly<FighterCombatState>
  opponent: Readonly<FighterCombatState>
  comparison: MatchupComparison
  pressureLevel: number
  arena: Readonly<CombatArenaDefinition>
}

interface CombatDecision {
  locomotionIntent: LocomotionIntent
  actionId?: CombatActionId
}

interface CombatStyleDefinition {
  archetype: Archetype
  locomotion: Readonly<LocomotionProfile>
  preferredRange: { min: number; max: number }
  attackActionIds: readonly AttackActionId[]
  defenseActionId: DefenseActionId
  baseWeights: Readonly<Record<string, number>>
}

interface LocomotionProfile {
  forwardUnitsPerSecond: number
  backwardUnitsPerSecond: number
  lateralUnitsPerSecond: number
  burstUnitsPerSecond: number
}

type CombatStyleCatalog = Readonly<Record<Archetype, CombatStyleDefinition>>

function chooseCombatDecision(
  context: CombatDecisionContext,
  style: CombatStyleDefinition,
  rolls: { selection: number; direction: number },
): CombatDecision
```

Each decision consumes exactly two values from the fighter's decision stream, even if only one action is legal. A candidate is a locomotion intent with an optional action. Candidates are filtered for state, range reachable through allowed root travel, arena path, forced behavior, and style.

Initial base weights are:

| Style | Locomotion weights | Action weights |
| --- | --- | --- |
| Heavy | `advance 12`, `hold-range 8`, `pressure 12`, each circle `2`, `retreat 0` | `heavy-shield-jab 14`, `heavy-cleave 8` |
| Fast | each circle `12`, `hold-range 5`, `retreat 8`, `burst-in 14` | `fast-slash 12`, `fast-burst-lunge 14` |
| Technical | `hold-range 12`, `backstep 12`, each circle `6`, `advance 6` | `technical-thrust 14`, `technical-driving-thrust 8` |

Forced `disengage` and `technical-parry-counter` bypass weighted selection. Legal candidates then receive:

- a continuous range-fit adjustment from `0..20`, highest at the middle of the legal contact band;
- `+12` for locomotion that reduces distance error to the neutral preferred band and `-12` when it increases that error without a tactical reason;
- an opening bonus of `+18` for committed/counter actions or `+6` for probes against a target in recovery/stagger;
- `-20` when an action would finish within 0.4 units of the arena boundary;
- `+8 × pressureLevel` for advance, pressure, burst, or committed candidates and the inverse adjustment for retreat/disengage;
- `+5`, `0`, or `-5` comparison score for advantage, neutral, or disadvantage.

Final weights are clamped at zero. The selection roll chooses proportionally among positive weights. No random number is drawn per candidate. If every weight is zero, policy deterministically selects movement toward the preferred range, or `hold-range` when already inside it. It must never return an illegal action and must not throw for ordinary spatial circumstances.

Decision intervals are drawn from the direction roll within these inclusive ranges:

- Heavy: 20–42 ticks;
- Fast: 12–30 ticks;
- Technical: 18–36 ticks.

`nextDecisionTick` is set to the current tick plus this interval. If a longer action finishes after that tick, the fighter makes its next decision immediately upon returning to neutral.

### Anti-stall pressure

`lastContactTick` belongs to battle state and updates on damage, block, or parry, but not on a miss or evade. Pressure is zero for 180 ticks after physical contact, then increases once per 60 ticks. At 300 ticks without contact, ordinary `retreat`, `circle-*`, and `disengage` candidates are suppressed until a contact occurs. Forced movement needed to make an action legal remains available.

### Future combat skill and perks

This slice does not add skill, progression, or a modifier registry. It preserves a seam by keeping context construction, legal-action filtering, scoring, random selection, and action execution separate. Action tags are stable data.

A later `combatSkill` can reduce deterministic decision error or improve reaction selection without changing action resolution. Perks may later adjust selected scores or tagged action parameters, for example `Patient` modifying `committed`, `Counterfighter` modifying `counter`, or `Fleet-footed` modifying defensive movement. These changes must stay in simulation/content and must not enter pose or renderer code.

## Random streams

No simulation module calls `Math.random()`, Web Crypto, time, or an external random source.

Each bout derives labelled streams from the bout seed:

- `home-decision`, `away-decision`;
- `home-defense`, `away-defense`;
- `home-contact`, `away-contact`;
- `contact-priority-tie`;
- `time-limit-tie`.

Starting an attack consumes and stores exactly two contact rolls: accuracy and critical. They are consumed even if the target later leaves range, blocks, evades, or parries. Decision and defense consumption are defined above. Priority and time-limit ties never consume fighter streams.

The guarantee remains: identical full inputs, seed, and tick count produce identical state and event trace. Different lineups may consume their independent streams at different ticks.

## Contact resolution

On a contact tick:

1. Snapshot both fighters' contact geometry and already scheduled defenses.
2. Build contact intents for actions in `contact`.
3. Resolve evade/parry/guard eligibility against the snapshot.
4. Sort remaining intents by descending action priority; an exact priority tie consumes one labelled tie value.
5. For each intent whose actor remains active:
   1. check range and facing sector;
   2. check stored accuracy roll against clamped `accuracy + action accuracy modifier`;
   3. apply effective parry, evade, or block;
   4. determine opening critical;
   5. calculate damage, push, and stagger;
   6. apply events in canonical order.
6. Non-lethal stagger from the first intent does not cancel a second action already in contact. Defeat cancels all later intents from that fighter.

An out-of-range or out-of-sector action emits `attack-missed` with reason `geometry`. A failed accuracy roll emits reason `accuracy`. A successful evade emits `attack-evaded`, not an additional miss event.

Critical is possible only for an unblocked hit when the target was in recovery or stagger in the contact snapshot and `criticalRoll < criticalChance`. Critical multiplies damage by `1.5`. Block and critical are mutually exclusive.

```ts
damage = Math.max(1, Math.round(
  power
  * action.damageMultiplier
  * comparisonDamageMultiplier
  * criticalMultiplier
  * blockMultiplier
))
```

Comparison damage multipliers are `1.10`, `1.00`, and `0.90`. The stored matchup comparison is from the home fighter's perspective and is inverted for away damage/defense. Accuracy is clamped to `0..1` before comparing `roll < probability`.

Push moves the target away from the actor along the snapshot line between their roots; exact coincident roots fall back to actor facing. Same-tick push vectors accumulate, then arena, side-order, and separation constraints are applied once. Damage and push never move HP or position outside legal bounds. Stagger ticks after block use `Math.max(1, Math.round(baseStagger * 0.40))`; other stagger uses the action value. `staggerUntilTick = max(previous, contactTick + appliedStaggerTicks)` and the fighter becomes free when `tick >= staggerUntilTick`.

On tick 3600, scheduled contacts resolve first. A defeat wins normally; otherwise the higher remaining-HP ratio wins by `time-limit`. An exact ratio tie uses the labelled time-limit value. There is no draw.

## Battle tick order

One immutable battle tick performs:

1. Increment tick and transition expired phases.
2. Clear expired stagger and complete forced state transitions.
3. Make decisions for neutral fighters whose decision tick is due.
4. Start selected/forced actions, store their attack rolls, and emit `action-started`.
5. Detect each newly started incoming windup and give the still-eligible opponent its single defense-reaction roll in the same tick.
6. Compute simultaneous movement intents from the same pre-movement state.
7. Apply arena clamp, side-order constraint, and symmetric separation.
8. Resolve all contact intents as defined above.
9. Apply pushback and resulting arena/separation correction.
10. Persist pressure, HP/status, action metadata, event IDs, and random states.
11. Resolve defeat or time limit.

Outside `running`, advancing a battle returns the exact previous object. Multi-tick helpers repeatedly apply this one-tick transition.

## Structured battle events

Event IDs are monotonic within one bout and restart for a new `BattleState`. Movement events are emitted only when intent changes; phase progress lives in state rather than emitting every tick.

| Event | Required payload | Feed use | Presentation/audio use |
| --- | --- | --- | --- |
| `bout-started` | fighter IDs and styles | opening line | reset rig/effects/audio cursors |
| `movement-intent-changed` | side, from, to | none | locomotion transition/footsteps |
| `action-started` | actor, target, action ID, expected contact tick | optional committed-action line | anticipation and whoosh scheduling |
| `defense-started` | defender, attacker, defense ID, expected contact tick | none | guard/evade/parry preparation |
| `attack-missed` | actor, target, action ID, reason | miss line | miss/recovery cue |
| `attack-evaded` | actor, target, action ID, evade intent | evade line | fast exit cue |
| `attack-blocked` | actor, target, action ID, contact zone, contact point | combine with damage | shield pose/metal cue |
| `attack-parried` | actor, defender, action ID, contact zone, contact point | parry/counter line | weapon spark/parry cue |
| `critical-hit` | actor, target, action ID, multiplier | emphasize | stronger impact cue |
| `damage-dealt` | actor, target, action ID, amount, remaining HP, contact zone, contact point | damage line unless combined | hit pose/flash/audio |
| `fighter-staggered` | side, source side, duration ticks, direction | none unless severe | reaction and push cue |
| `fighter-defeated` | defeated side, winner side | defeat line | defeat pose/cue |
| `bout-finished` | winner side, reason, duration ticks | final line | stop ordinary cues |

`contact zone` is one of `body`, `shield`, or `weapon`; `contact point` is the root-plane `Vec2`. Presentation selects a style/action-specific height and exact weapon/limb target from the semantic zone.

Canonical contact sequences:

- Miss: `attack-missed`.
- Evade: `attack-evaded`.
- Blocked hit: `attack-blocked → damage-dealt → fighter-staggered`.
- Parry: `attack-parried → fighter-staggered(attacker)`; the counter later emits its own normal action events.
- Critical defeat: `critical-hit → damage-dealt → fighter-staggered → fighter-defeated → bout-finished`.

The battle log remains complete. The visible feed still renders the latest eight formatted entries.

## Fighter content

`attackIntervalTicks` is removed. Fighter definitions become:

```ts
interface FighterDefinition {
  id: string
  name: string
  school: string
  archetype: Archetype
  maxHp: number
  power: number
  accuracy: number
  defenseChance: number
  criticalChance: number
}
```

Initial content values:

| Side | Fighter | Style | HP | Power | Accuracy | Defense | Critical | Intent |
| --- | --- | --- | ---: | ---: | ---: | ---: | ---: | ---: |
| Home | Brutus | Heavy | 170 | 22 | 0.86 | 0.34 | 0.10 | reliable shield pressure |
| Home | Aquila | Fast | 120 | 16 | 0.84 | 0.31 | 0.14 | fragile burst fighter |
| Home | Nerva | Technical | 165 | 20 | 0.92 | 0.40 | 0.16 | strongest all-rounder |
| Away | Drusus | Fast | 185 | 21 | 0.90 | 0.36 | 0.15 | elite opponent intended to absorb a sacrifice |
| Away | Cassius | Technical | 160 | 19 | 0.90 | 0.38 | 0.12 | strong measured opponent |
| Away | Magnus | Heavy | 145 | 18 | 0.78 | 0.32 | 0.06 | vulnerable heavy opponent |

Implementation may tune only these numeric rows to satisfy all balance acceptance tests. It must preserve names, styles, opponent order, relative content intent, and the action/style definitions above unless the written spec is amended.

Planning cards replace attack interval with Power and Defense while retaining HP, Accuracy, Critical, and the always-visible counter rule.

## Balance acceptance

For series seed `20260815` after content tuning:

- `Brutus→Drusus`, `Aquila→Cassius`, `Nerva→Magnus` loses 1–2; all counters are not the automatic best answer.
- `Aquila→Drusus`, `Nerva→Cassius`, `Brutus→Magnus` wins 2–1.
- The six possible lineups contain at least three distinct final score/result profiles.
- Every ordinary baseline bout ends in 1500–2400 ticks and none reaches the limit.
- Targeted deterministic unit fixtures demonstrate each signature attack and each defense result.
- A baseline style trace contains meaningful position change between exchanges; no bout becomes stationary cooldown trading.
- No trace spends more than 300 consecutive ticks without contact after the initial approach.

If exact content numbers cannot satisfy all fixtures, the implementation report must stop and present evidence rather than weakening an acceptance criterion silently.

## Module boundaries

### `src/simulation/`

- `fighters.ts` — fighter definitions, archetypes, comparison, and validation.
- `movement.ts` — plain `Vec2` helpers, arena clamp, facing, intent displacement, and symmetric separation.
- `combatActions.ts` — action/phase types, immutable definitions' simulation contracts, phase transitions, and contact math.
- `combatDecision.ts` — legal candidate construction, scoring, seeded choice, defense reaction choice, and future policy seam.
- `battle.ts` — bout creation, labelled streams, tick orchestration, events, defeat, and time limit.
- `series.ts` — unchanged responsibilities: assignments, bout order, score, results, and delegation.

No file in this directory imports DOM, Three.js, Web Audio, presentation, or content modules.

### `src/content/`

- `combatStyles.ts` — style locomotion, action definitions, visual discipline IDs, and decision weights as data.
- `mvpSeries.ts` — the six fighter rows and opponent order.

Content contains no mutable state or presentation objects.

`main.ts` imports the style catalog and fighter rosters, then passes both into `createSeries`. `SeriesConfig` adds `combatStyles: CombatStyleCatalog`; series state keeps this plain readonly data and passes it into every `createBattle` call. This dependency injection lets simulation consume style data without importing `src/content/` and keeps `structuredClone` test state free of functions or engine objects.

### `src/presentation/`

- `ProceduralFighter.ts` — shared joint hierarchy, primitive body builders, equipment anchors, and disposal.
- `PoseController.ts` — style key poses, phase sampling, locomotion cycles, reaction layers, grounding, and limited two-bone weapon-arm IK.
- `ArenaView.ts` — scene ownership, fighter instances, camera framing, state/event synchronization, contact effects, and resets.
- `CombatAudio.ts` — AudioContext lifecycle, cue synthesis, voice limiting, speed policy, mute, and event cursor.
- `battleFeed.ts` — formatting the expanded event vocabulary.
- `SeriesView.ts` — existing phase UI plus new stat labels and sound control intent.

### `src/main.ts`

The runtime remains the only wall-clock loop. It advances integer simulation ticks, owns pause/speed/sound runtime state, renders series state, and forwards active battle state to arena/audio presentation.

## Procedural humanoid rig

The shared semantic hierarchy is:

```text
root
└── pelvis
    ├── torso
    │   └── chest
    │       ├── neck → head → headTop
    │       ├── shoulder.L → upperArm.L → forearm.L → hand.L
    │       └── shoulder.R → upperArm.R → forearm.R → hand.R
    ├── upperLeg.L → lowerLeg.L → foot.L
    └── upperLeg.R → lowerLeg.R → foot.R
```

Equipment/contact anchors are `weaponHand`, `offHand`, `weaponTip`, `shieldCenter`, and `hitCenter`. Every style must provide them. Equipment builder functions create a large shield/gladius/helmet, small shield/sica, or spear/round shield and attach only to anchors. Equipment has no simulation collision.

Style proportions alter bone offsets and primitive scale while preserving semantic joint names. The silhouettes must remain distinguishable when rendered as a single solid color from the main camera.

## Pose controller

The controller samples a `HumanoidPose` from simulation state in this fixed order:

1. style guard pose;
2. locomotion cycle and facing;
3. action key-pose curve;
4. block/evade/parry/stagger/defeat reaction overlay;
5. foot grounding and limited arm IK.

Each action uses sparse keys for guard/opening, anticipation, contact, overshoot or impact, recovery, and return. Phase progress is `(tick - phaseStartedTick) / (phaseEndsAtTick - phaseStartedTick)`, clamped to `0..1`. Keys use named easing curves rather than uniform interpolation.

Presentation may rotate torso/limbs, solve a two-bone weapon arm, and align `weaponTip` to the semantic contact target within a capped cosmetic reach. It may not change simulation root, facing, action phase, hit result, damage, or event order. If a target is outside the cosmetic IK cap, the authored contact pose wins; presentation does not stretch limbs indefinitely.

Feet use a deterministic gait phase derived from travelled simulation distance, not wall-clock time. Footstep presentation cues fire when the planted foot changes. At `×4`, footsteps are suppressed.

Defeat uses a style-specific controlled pose. Rotating the whole group onto its side is not sufficient.

## Arena, camera, and effects

- Keep the current stable elevated perspective and arena plane.
- Camera look target eases toward the fighters' midpoint.
- Camera distance changes only enough to keep both roots, weapons, and a 10% margin in frame.
- Camera does not orbit, cross the combat axis, cut, or shake.
- Lighting, material value, and an inexpensive geometry/rim outline keep silhouettes separate from the floor without a post-processing pipeline.
- Weapon trails appear only during the final part of windup through contact.
- `body`, `shield`, and `weapon` contacts use distinct effect shape/position, not color alone.
- Contact flashes expire before the next exchange and never obscure either torso.
- Arena reset clears pose, trails, flashes, audio voices, event cursors, and camera interpolation at each new bout and on rematch.

## Combat audio

`CombatAudio` is presentation-only and uses a replaceable backend so unit tests do not require browser audio.

Initial synthesized cues:

- `footstep-light`, `footstep-heavy`;
- `weapon-whoosh-light`, `weapon-whoosh-heavy`;
- `body-hit`, `shield-block`, `weapon-parry`;
- `stagger`, `defeat`.

The implementation may use short oscillator/noise/filter/gain graphs or generated buffers. Cue selection is semantic. Minor pitch/duration variation is derived from bout index and event ID and never consumes simulation randomness.

Rules:

- Create/resume AudioContext only after a user gesture.
- Sound defaults on when audio can start, with a visible runtime `Sound on/off` control.
- Persistence across page loads is out of scope.
- Pause stops scheduling, quickly fades active ordinary voices, and resumes from new events only.
- `×1` and `×2` allow all cues with a maximum of eight simultaneous voices.
- `×4` allows only body hit, block, parry, stagger, and defeat.
- The same event/pose threshold cannot play twice after re-render.
- Missing or rejected Web Audio disables audio silently while combat continues.
- Bout change and rematch stop all voices and reset cursors.

Audio quality requires human listening; automated tests verify mapping and lifecycle only.

## Series integration

The series state machine and public commands remain unchanged. `SeriesConfig` and `SeriesState` gain the readonly plain-data `combatStyles` catalog described above. `BoutResult` keeps current winner, reason, duration, comparison, IDs, and HP ratios. Results derive duration from the new 3600-tick battle. Planning, interstitial, summary, rematch, pause, and speed retain their existing semantics.

The test API continues to expose series state, assignment commands, `advanceTicks`, next bout, and rematch. State cloning must support the new plain data structures. No Three.js or Audio objects enter test state.

The feed formats new actions and defenses but remains non-live for screen readers. Only phase status, interstitial, and final result use polite live regions.

## Error handling and invariants

- Unknown fighter/style/action IDs, invalid arena configuration, non-finite numeric data, negative distances, and non-positive phase ticks throw developer errors at creation/validation boundaries.
- Ordinary target movement out of range produces a miss, never an exception.
- An empty attack candidate list yields locomotion/hold behavior.
- All positions, velocities, facing values, joint transforms, and phase progress must remain finite.
- In test/dev, battle invariant checks cover arena bounds, separation, phase endpoints, HP range, event IDs, random states, and active/defeated consistency.
- A presentation or audio failure cannot mutate or stop simulation. WebGL context loss replaces the canvas with a text fallback while the runtime and series controls continue.
- Disposing or replacing a bout releases geometries, materials, resize observers, AudioNodes, and event cursors.

## Automated verification

### Simulation/unit

- `movement.test.ts`: vector math, bounds, side order, symmetric separation, facing, and all intents.
- `combatActions.test.ts`: exact phase ticks, action legality, range/sector, damage rounding, block, evade, parry/counter, opening critical, priority, and simultaneous contacts.
- `combatDecision.test.ts`: legal candidates, style behavior, fixed roll consumption, deterministic choice, pressure, forced disengage, and future-seam purity.
- `battle.test.ts`: event ordering, complete traces, defeat/time limit, labelled ties, no draws, and immutability.
- `series.test.ts`: unchanged phase flow and rematch with new battle state.
- `mvpSeries.test.ts`: balance, duration, lineup, style, and content invariants.
- `architecture.test.ts`: simulation imports no DOM/Three/Web Audio/presentation/content and contains no `Math.random()`.

### Presentation/unit

- Pose sampling always returns finite transforms and progress in range.
- Every style supplies every joint/equipment anchor.
- Contact IK stays within its cosmetic cap.
- Feed maps every event and retains exactly the latest eight display entries.
- Audio maps semantic events, suppresses duplicates, enforces voice/speed rules, and degrades without AudioContext.
- A test-only audio debug surface can trigger every cue individually without starting a bout; it is unavailable in the production UI.

### Playwright

- Existing planning, assignment, three-bout, focus, seed, pause/speed, interstitial, summary, and rematch tests remain.
- A complete active bout demonstrates position changes after initial approach.
- Second and third bouts reset rig, effects, audio cursor, and camera state.
- Deterministic presentation fixtures freeze Heavy guard/cleave, Fast burst/disengage, Technical measure/parry/counter, plus hit, block, stagger, and defeat.
- Screenshot baselines cover those key poses and one complete two-fighter safe frame at 1280×820.
- The visual fixture mechanism is test-only and cannot alter production simulation results.
- A WebGL context-loss fixture verifies the text fallback and series progression.

## Human review gate

Before handoff, a human reviews:

1. one full bout for each of the nine ordered home-style/opponent-style combinations at `×1`;
2. one full three-bout series at `×2`;
3. the key-pose screenshot storyboard;
4. a short recording with HP cards and feed hidden;
5. each audio cue in isolation and cues during a complete bout.

The reviewer explicitly checks silhouette separation, intent, foot sliding, weapon contact, spacing rhythm, camera framing, repeated motion, sound weight, and whether the winner can be explained. Visual/audio acceptance cannot be delegated to a text-only model.

## Migration

- Replace scalar fighter `x` with `Vec2 position` and add facing, velocity, locomotion, action, stagger, and decision state.
- Replace `attackIntervalTicks` with `power` plus style action timelines.
- Replace the instantaneous attack loop with decision, movement, phase, defense, and contact modules.
- Expand structured events and feed formatting.
- Replace `ArenaView` reaction-decay transforms with procedural fighters and `PoseController`.
- Add `CombatAudio` and sound runtime intent/control.
- Update cards for the new stats.
- Retune the six fighter rows while preserving approved fixture intent.
- Update README architecture, controls, deterministic guarantees, and checks.
- Update/add visual baselines only for intentional combat and stat-card changes.

## Definition of Done

- All goals and player-facing acceptance criteria are met.
- The baseline series fixtures and full deterministic traces pass.
- Ordinary baseline bouts finish in 25–40 seconds with no stationary cooldown trading.
- All three styles show distinct movement, attacks, defenses, silhouettes, and equipment.
- Simulation remains pure TypeScript and presentation remains rule-free.
- Audio is optional, event-driven, controllable, and failure-safe.
- `npm test`, `npm run build`, `npm run test:e2e`, and `npm run check` pass.
- Intentional screenshot baselines and the human-review artifacts are attached to the implementation PR.
- The PR states the player hypothesis and contains only this combat-depth hypothesis.
