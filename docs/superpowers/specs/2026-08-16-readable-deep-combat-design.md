# Readable Deep Combat — MVP Design

**Status:** approved for implementation; amended after implementation-plan review

**Date:** 2026-08-16

## Terminology

- **Style** — one of the existing combat archetypes (`heavy`, `fast`, `technical`) expressed through equipment, preferred distance, movement, attacks, and defense.
- **Action** — one atomic attack, defense, or forced counter with an explicit simulation timeline.
- **Phase** — `windup`, one-tick `contact`, `impact`, or `recovery` inside an action.
- **Exchange** — positioning followed by at least one committed action and its resolution, ending when both fighters can make a new decision.
- **Opening** — a target in `recovery` or `stagger`, where an unblocked hit may become critical.
- **Intent** — semantic locomotion chosen by simulation, such as `pressure`, `burst-in`, or `disengage`.
- **Probe** — a quick, low-commitment attack used to test range or create pressure; it is not required to expose a long readable anticipation.
- **Committed action** — a slower, higher-payoff attack whose anticipation and recovery create an observable punish window.
- **Pressure level** — a capped anti-stall input derived from time since physical weapon/body contact; it biases policy without replacing style identity.
- **Combatant** — one simulated fighter identified by a stable encounter-local `CombatantId`, independent of UI side or array position.
- **Faction** — a stable `FactionId` used by hostility rules; FFA may ignore faction membership and make every distinct combatant hostile.
- **Encounter** — the collection-first deterministic combat kernel for `2..100` combatants. The current bout is a two-combatant adapter over it.
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
- Fixed-step simulation should keep its remainder and interpolate only presentation between the previous and current snapshots: <https://gafferongames.com/post/fix_your_timestep/>.
- Group framing benefits from horizontal-only framing, damping, and explicit distance limits: <https://docs.unity3d.com/Packages/com.unity.cinemachine@3.1/manual/CinemachineGroupFraming.html>.
- A small set of authored poses can support procedural animation when poses are data and grounding/IK are later layers: <https://www.wolfire.com/blog/2014/05/GDC-2014-Procedural-Animation-Video/>.

## Goals

1. Replace stationary attack trading with deterministic two-dimensional spacing, entry, exit, and lateral movement.
2. Give each style a distinct offensive, defensive, locomotion, equipment, and silhouette identity.
3. Make attack timing part of simulation through explicit action phases.
4. Keep the simulation independent of DOM, Three.js, Web Audio, frame rate, and wall-clock time.
5. Render a shared articulated procedural humanoid rig whose semantic pose contract can later drive imported skeletal models.
6. Add restrained contact feedback and event-driven procedural combat audio.
7. Preserve the series-management flow, URL seed, rematch behavior, and deterministic test surface.
8. Establish a narrow decision-policy seam for future combat skill and perks without implementing progression now.
9. Keep the combat kernel collection-first and deterministically valid for a future free-for-all of up to 100 full-fidelity simulated combatants.

## Non-goals

- Direct player control during a bout.
- Imported GLTF characters, authored animation clips, motion capture, retargeting, motion matching, or production character art.
- Combo trees, feints, stamina, activated abilities, nets, projectiles, equipment management, injuries, or progression.
- A generic perk engine or a `combatSkill` attribute in current content.
- Blood, gore, dismemberment, ragdolls, or complex physics.
- Dynamic orbiting cameras, cinematic cuts, camera shake, particles, or post-processing as standalone systems.
- Reworking planning, interstitial, summary, rematch, or series ordering beyond the combat data they display.
- Final mobile/performance budgets. Existing checks must remain healthy, but profiling is a later spike.
- A playable mass-combat mode, mass-arena UI/camera, formation AI, dogpile control, simulation LOD, rendering LOD, culling, or a mass-audio mixer. This slice provides the kernel contract and headless capacity fixtures only.

The PR still tests one player hypothesis—the readable, characterful observed duel. Hundred-combatant support is an implementation constraint and regression surface for that combat kernel, not a second player-facing mass-combat hypothesis.

## Player-facing acceptance

At `×1`, a reviewer watching with HP cards and battle feed hidden must be able to:

- identify all three styles from equipment, silhouette, stance, and movement;
- tell who is pressuring, preserving distance, entering, or disengaging;
- distinguish a hit, block, evade, parry, stagger, and defeat;
- identify the anticipation and recovery of a committed attack;
- explain most decisive contacts using the visible state immediately before them.

`×2` remains readable enough to follow the winner of each exchange. `×4` is an accelerated review mode and is not required to preserve every pose or audio cue.

Across the fixed balance cohort, the median ordinary bout lasts `1500–2400` simulation ticks (25–40 seconds) and contains approximately 6–10 completed exchanges. An exchange may contain probes and defensive reactions, but it is counted only when at least one committed action resolves and both fighters later regain decision control. Individual non-outlier bouts may be shorter or longer within the hard bounds defined under Balance acceptance. The hard limit is `3600` ticks (60 seconds). A full three-bout series at `×1` should take roughly 1.5–2 minutes of combat.

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

Lateral motion now has a rule-level consequence: a fighter who moves outside Heavy's guard or Technical's parry arc can deny that defense until the defender turns back toward the attack. Heavy turns slowly enough that Fast can create this angle near contact range; Fast turns quickly enough to keep its own weapon sector on target. This is the MVP's only flank reward—there is no hidden backstab damage bonus.

## Simulation clock and combat space

- `TICKS_PER_SECOND = 60`.
- `MAX_BOUT_TICKS = 3600`.
- State contains integer ticks only. Seconds are derived for display.
- Fighters move on an `x/z` plane represented by a plain immutable `Vec2` type.
- The current duel adapter supplies start positions `home = (-4.2, 0)` and `away = (4.2, 0)` under their stable combatant IDs.
- The current duel's walkable floor has radius `6.5`, with lateral movement additionally clamped to `z = -2.5..2.5` for the fixed gameplay camera. Encounter arena dimensions are data; the 100-combatant capacity fixture uses a larger headless arena.
- Fighter centers remain at least `0.9` units apart.
- Facing is a normalized `Vec2`, not an angle. Each tick it turns partway toward the current target using the style's authored turn responsiveness; it does not snap. Presentation derives body yaw from the interpolated simulation vector.
- `movementPolicy: 'ordered-pair' | 'free'` belongs to arena configuration. The current duel uses `ordered-pair`, which prevents its two descriptor IDs from swapping projected sides; future FFA uses `free`.
- Movement is simultaneous: every desired displacement is computed from the same pre-movement snapshot, then arena constraints and deterministic multi-combatant separation are applied.
- Simulation geometry uses vector arithmetic and authored dot-product thresholds. `src/simulation/**` may use `Math.sqrt` for normalization but not runtime trigonometric or inverse-trigonometric functions.

Simulation owns root position. Presentation may render the root and facing at `lerp(previousTickState, currentTickState, alpha)`, where `alpha = accumulator / tickDuration`; it may not derive root motion from any other source. This interpolation never feeds back into simulation or changes contact geometry.

## Collection-first encounter foundation

The playable slice still creates exactly two combatants, but combat rules operate on a general encounter collection:

```ts
type CombatantId = string
type FactionId = string
type ActionInstanceId = string

interface EncounterState {
  tick: number
  phase: 'running' | 'finished'
  seed: number
  combatantIds: readonly CombatantId[]
  combatants: Readonly<Record<CombatantId, FighterCombatState>>
  arena: Readonly<CombatArenaDefinition>
  hostility: Readonly<HostilityDefinition>
  combatStyles: CombatStyleCatalog
  randomByCombatant: Readonly<Record<CombatantId, CombatantRandomState>>
  nextEventId: number
  result?: Readonly<EncounterResult>
}

interface EncounterCombatantDefinition {
  id: CombatantId
  factionId: FactionId
  fighter: FighterDefinition
  startPosition: Vec2
}

interface CombatantRandomState {
  decision: RandomState
  defense: RandomState
  contact: RandomState
}

type HostilityDefinition =
  | { mode: 'free-for-all' }
  | { mode: 'different-factions' }
  | {
      mode: 'relation-table'
      relations: readonly {
        first: FactionId
        second: FactionId
        relation: 'allied' | 'neutral' | 'hostile'
      }[]
    }

interface EncounterResult {
  reason: 'no-hostile-pairs' | 'time-limit'
  survivorIds: readonly CombatantId[]
  winnerIds: readonly CombatantId[]
  winningFactionIds: readonly FactionId[]
}

interface EncounterTransition {
  state: EncounterState
  events: readonly EncounterEvent[]
}
```

`createEncounter` returns an `EncounterTransition` whose event batch begins with `encounter-started`. Creation requires `2..100` combatants, at least one hostile pair, unique combatant IDs matching `[A-Za-z0-9._-]+`, valid faction IDs, and `combatantIds` sorted lexicographically. The ID grammar reserves `:` for action-instance IDs. `CombatantId` identifies this encounter instance; `FighterDefinition.id` remains its content/roster identity and is not used for ordering or RNG. Record/object iteration order is never used to decide simulation behavior. `free-for-all` makes every pair of distinct living combatants hostile regardless of faction. `different-factions` treats equal factions as allied and all other pairs as hostile. `relation-table` is symmetric; missing same-faction entries default to `allied`, missing cross-faction entries default to `neutral`, and conflicting duplicate rows are developer errors.

`FighterSide = 'home' | 'away'` is not a combat-kernel identity. The current series owns a plain `DuelDescriptor { homeId, awayId }`, creates encounter IDs `home.${fighter.id}` and `away.${fighter.id}`, configures two hostile factions plus `ordered-pair`, and maps the general encounter result back to `winnerSide`, school score, cards, and the existing series commands. Matchup comparison is always calculated from the current actor toward its current target, never stored globally from the home perspective.

The encounter ends when its configured rule fires. This slice implements `no-hostile-pairs`: combat ends when no pair of living combatants is hostile. In FFA that means one survivor; with factions or relation tables it may mean one faction or an allied survivor group. In that result all survivors are winners. The duel adapter additionally applies the existing time limit, puts both still-active fighters in `survivorIds` but only the HP/tie-rule winner in `winnerIds`, and calls a kernel `finishEncounter(state, result)` helper so phase/result/event-ID handling stays generic. It then maps the result to a single duel winner. A playable mass-mode result screen and scoring policy remain out of scope.

All combatants use identical action, movement, defense, and damage rules. Camera visibility, render distance, frame rate, and future graphical LOD may not change target selection or simulation fidelity.

### Spatial index, targeting, and separation

Each tick builds a transient uniform spatial hash from the sorted active pre-movement combatants. Defeated combatants remain in state for result/presentation but leave targeting and collision queries beginning on the tick after defeat, so fallen bodies cannot permanently jam a future crowd. The hash is derived state, is never stored in `EncounterState`, and never enters `structuredClone`. Cell size is `3.2` arena units, just above the longest current contact range; larger-radius queries visit all intersecting cells.

The index serves target acquisition, collision broad phase, and read-only local decision context. A combatant retains `targetId` while the target is alive, hostile, and within `20` units. A missing/invalid target is reacquired on that combatant's decision tick by querying up to `16` units and choosing minimum squared distance, then lexicographically smallest `CombatantId`. This covers the complete current arena while allowing a future larger battlefield to contain temporarily unengaged fighters. The current policy does not switch away from a valid target for a more attractive one; future threat/group policy replaces this isolated selector without changing actions.

`CombatDecisionContext` may expose sorted nearby ally/neutral/hostile IDs and local counts, but current 1×1 style weights ignore them. Formation behavior, assist logic, engagement slots, crowd pressure, and dogpile prevention remain future mass-combat policy.

Separation uses candidate pairs returned from the same or adjacent occupied cells. Each unordered pair has canonical key `${minId}|${maxId}`, is processed at most once per pass, and pair keys are sorted before solving. The solver performs exactly three passes; it never iterates until convergence. Each pass rebuilds the transient hash from the positions produced by the prior pass, then applies pair corrections in canonical order. `ordered-pair` additionally applies its two-ID ordering clamp after each pass; `free` does not.

Sparse layouts therefore avoid the full `n × n` scan. A genuinely dense pile can still contain `O(n²)` real neighboring pairs, but unrelated distant combatants are never tested against each other.

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
```

| Style | Forward | Backward | Lateral | Burst | Neutral preferred distance |
| --- | ---: | ---: | ---: | ---: | ---: |
| Heavy | 1.4 u/s | 0.9 u/s | 0.8 u/s | 1.8 u/s | 1.2–1.7 |
| Fast | 2.4 u/s | 2.7 u/s | 2.1 u/s | 4.0 u/s | 2.4–3.0 before entry |
| Technical | 1.7 u/s | 2.0 u/s | 1.3 u/s | 2.4 u/s | 2.1–2.8 |

Turn responsiveness is a maximum fixed rotation per tick. Runtime stores authored sine/cosine literals and never calls trigonometric functions:

| Style | Maximum turn | `cosMaxTurn` | `sinMaxTurn` |
| --- | ---: | ---: | ---: |
| Heavy | `2.0°/tick` | `0.9993908270` | `0.0348994967` |
| Fast | `3.4°/tick` | `0.9982398279` | `0.0593063736` |
| Technical | `2.6°/tick` | `0.9989705698` | `0.0453629881` |

For a valid target, let `desiredFacing = normalize(target.position - self.position)`, `cross = facing.x × desiredFacing.z - facing.z × desiredFacing.x`, and `dot = facing.x × desiredFacing.x + facing.z × desiredFacing.z`. If `dot >= cosMaxTurn`, facing snaps to `desiredFacing`; otherwise it rotates by the authored `(cosMaxTurn, sinMaxTurn)` matrix in the sign of `cross` and normalizes. When `cross === 0 && dot < 0`, it deterministically turns left, removing the exact-180° deadlock. A combatant without a target retains its last facing. Validation requires finite literals, `cosMaxTurn`/`sinMaxTurn` in `0..1`, and `cos² + sin²` within epsilon of `1`.

Style movement behavior:

- Heavy prefers `pressure` or `advance`, yields little ground during ordinary movement, and never selects routine `disengage`.
- Fast prefers shallow arcs outside contact range, may select pure `burst-in` only from 2.8–4.0 units to create a lunge setup, and re-enters ordinary weighted choice once inside the lunge's start range. It is forced into `disengage` after a burst-lunge recovery until reaching 2.4 units or spending 30 ticks.
- Technical holds spear measure, selects `backstep` when an opponent enters below 1.2 units, and may circle only while remaining able to face the opponent.

Movement during action phases is constrained:

- `windup`: only the action definition's authored root travel is allowed;
- `contact`: no new locomotion decision;
- `impact`: root motion freezes except for resolved pushback;
- `recovery`: at most 35% of normal style speed;
- while staggered: only deterministic pushback/recovery motion; `locomotionIntent` retains the last ordinary intent but is ignored;
- while defeated: no locomotion; status, rather than a duplicate intent value, drives the presentation state.

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
  movementPolicy: 'ordered-pair' | 'free'
  orderedPair?: readonly [firstId: CombatantId, secondId: CombatantId]
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
      instanceId: ActionInstanceId
      definitionId: CombatActionId
      phase: CombatActionPhase
      phaseStartedTick: number
      phaseEndsAtTick: number
      targetId: CombatantId
      reactingToActionId?: ActionInstanceId
      attackRolls?: { accuracy: number; critical: number }
    }

interface ReactionRecord {
  incomingActionId: ActionInstanceId
  outcome: 'scheduled' | 'failed' | 'ineligible'
}

interface FighterCombatState {
  id: CombatantId
  factionId: FactionId
  definition: FighterDefinition
  targetId?: CombatantId
  position: Vec2
  facing: Vec2
  travelledDistance: number
  hp: number
  status: 'active' | 'defeated'
  locomotionIntent: LocomotionIntent
  velocity: Vec2
  action: CombatActionState
  staggerUntilTick: number
  nextDecisionTick: number
  nextActionSerial: number
  lastContactTick: number
  lastResolutionTick: number
  reactionLedger: readonly ReactionRecord[]
  forcedActionId?: AttackActionId
}
```

`phaseEndsAtTick` is exclusive. If an action begins windup on tick `D` with `windupTicks = W`, windup occupies ticks `D..D+W-1`; contact occurs on tick `D+W`; contact always lasts exactly one tick. Impact begins on the following tick, then recovery. A fighter returns to neutral at the first tick after recovery ends.

An attack or counter action must contain `attackRolls`; a defense action must not. `ActionInstanceId` is `${actorId}:${localActionSerial}`; only that actor increments `nextActionSerial`. A defender records each attack's single reaction opportunity in `reactionLedger`, including an ineligible or failed reaction, so it cannot retry the same windup later. Records are removed once the referenced incoming action resolves or is canceled, keeping the ledger bounded by currently relevant threats. A defense whose `reactingToActionId` is canceled before contact returns to neutral immediately and emits `action-interrupted` with reason `threat-canceled`; it does not remain as a free-standing guard/parry.

`velocity` is the actual post-constraint root displacement for the tick multiplied by `TICKS_PER_SECOND`, in units/second. Simulation writes it after movement/separation and presentation reads it for lean and gait direction; decision scoring does not use it in this slice. `travelledDistance` accumulates the absolute post-constraint root displacement in arena units and drives deterministic gait phase. Every combatant starts with `nextDecisionTick = 1` and `nextActionSerial = 0`; `encounter-started` receives event ID `0`, leaving `nextEventId = 1`. Iteration follows sorted `combatantIds`.

Incoming non-lethal stagger has this explicit phase behavior; an interrupted active action emits `action-interrupted` with reason `stagger`:

| Current state | Attack outcome | Defense outcome |
| --- | --- | --- |
| `neutral` / queued forced action | clear any queued forced action; stagger owns control | same |
| `windup` | cancel the action before contact; stored attack rolls remain consumed | cancel the defense; it cannot protect the later contact |
| one-tick `contact` | keep the already-snapshotted contact for this tick, then clear the action | keep the already-snapshotted defense for this tick, then clear the action |
| `impact` | clear the remaining impact/recovery and show stagger | same |
| `recovery` | clear the remaining recovery and show stagger | same |

Lethal defeat always overrides this table: it silently clears the defeated fighter's current/forced action, emits the canonical defeat events, and cancels only later contact intents whose actor is that fighter. It does not cancel another surviving combatant's already scheduled contact.

## Action definitions

Every action definition is immutable content and has semantic tags. Distances are center-to-center at contact unless a separate start distance is stated.

```ts
interface AttackActionDefinition {
  id: AttackActionId
  tags: readonly string[]
  contactRange: { min: number; max: number }
  startMaxRange?: number
  minimumFacingDot: number
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
  minimumIncomingFacingDot?: number
  evadeDisplacement?: { min: number; max: number }
}
```

| ID | Tags | Contact range | Facing dot | Windup | Impact | Recovery | Damage | Accuracy | Root travel | Push | Stagger | Priority |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| `heavy-shield-jab` | `attack probe shield unparryable` | 0.9–1.4 | `0.5736` (~55°) | 14 | 3 | 20 | `power × 0.65` | `+0.08` | 0.25 | 0.40 | 12 | 30 |
| `heavy-cleave` | `attack committed weapon parryable` | 0.9–1.8 | `0.6428` (~50°) | 34 | 6 | 34 | `power × 1.75` | `-0.06` | 0.45 | 0.70 | 24 | 10 |
| `fast-slash` | `attack probe weapon parryable` | 0.9–1.35 | `0.4226` (~65°) | 10 | 2 | 15 | `power × 0.75` | `+0.06` | 0.25 | 0.18 | 8 | 40 |
| `fast-burst-lunge` | `attack committed burst weapon parryable` | start ≤2.8, contact 0.9–1.45 | `0.8192` (~35°) | 18 | 3 | 24 | `power × 1.25` | `+0.00` | ≤1.40 | 0.35 | 14 | 30 |
| `technical-thrust` | `attack probe weapon parryable` | 1.2–2.8 | `0.9397` (~20°) | 20 | 3 | 22 | `power × 1.00` | `+0.04` | 0.20 | 0.30 | 12 | 25 |
| `technical-driving-thrust` | `attack committed weapon parryable` | 1.6–3.1 | `0.9511` (~18°) | 30 | 4 | 30 | `power × 1.50` | `-0.03` | 0.50 | 0.50 | 20 | 15 |
| `technical-parry-counter` | `attack forced counter weapon` | 0.9–2.3 | `0.8660` (~30°) | 8 | 4 | 20 | `power × 1.10` | `+0.12` | 0.30 | 0.40 | 18 | 50 |

Facing eligibility is `dot(actor.facing, normalize(target.position - actor.position)) >= minimumFacingDot`. Values are authored numeric literals; degree annotations are documentation only and are never converted with trigonometry at runtime. `root travel` follows facing and is the maximum forward displacement authored across windup. It stops early at minimum separation and never expands the legal contact range.

All numeric definition fields must be finite. Tick counts are positive integers; distances and multipliers are non-negative. Validation also requires `contactRange.min >= arena.minimumSeparation`, `contactRange.min <= contactRange.max`, burst `startMaxRange >= contactRange.max`, `minimumFacingDot`/defense-facing dots in `-1..1`, `evadeDisplacement.min <= evadeDisplacement.max`, Fast evade to define that range while other defenses do not, and every parryable attack windup to be at least Technical's authored parry reaction lead. Unknown action IDs and inconsistent content are developer errors.

## Defense reactions

Defense is a style-specific action scheduled once during an incoming windup. Each style has a reaction lead: 8 ticks for Heavy, 7 for Fast, and 10 for Technical. For an attack whose contact is `contactTick`, its one reaction opportunity is the tick satisfying `contactTick - currentTick === minimumReactionLeadTicks`. This makes `technical-parry` eligible against a newly started `fast-slash`: `10 - 0 === 10` at the attack start tick.

All reaction opportunities for one defender in the same tick are gathered before scheduling defense and sorted by: earlier `contactTick`, `committed`/`counter` before `probe`, higher `attacker.power × action.damageMultiplier`, then `ActionInstanceId`. Each opportunity consumes exactly two values from that defender's defense stream, `success` and `direction`, even when the defender is already busy, staggered, or unable to answer the action tag, and receives a `ReactionRecord`. The first sorted opportunity that is eligible and rolls successfully schedules the defender's only action slot; later opportunities become `ineligible` but still consume their pair. A defense can start only when the defender is active, in `neutral` or ordinary locomotion, not staggered, and the style-specific tag restrictions below pass. An attack canceled before its reaction opportunity consumes no defense values.

```ts
effectiveDefenseChance = clamp(
  fighter.defenseChance
    + comparisonDefenseModifier
    + telegraphBonus(attack.windupTicks),
  0,
  0.95,
)
```

The comparison modifier is `+0.05` for advantage, `0` for neutral, and `-0.05` for disadvantage. `telegraphBonus` is `0.00` for windup `<=14`, `+0.05` for `15..24`, and `+0.10` for `>=25` ticks. A failed roll schedules no defense, records `failed`, and emits `defense-declined` so presentation can show a small early recognition flinch without revealing numeric chance. Ineligible opportunities remain ledger-only because their busy/staggered/action state is already visible. A successful roll schedules the style defense with a dynamic windup beginning at the reaction opportunity so its contact tick aligns with the incoming attack contact. This ties a longer visible commitment to a modestly stronger reaction without making it automatically safe.

Defense action timing uses the remaining incoming windup as its own dynamic windup, followed by one aligned contact tick:

| Defense ID | Contact/impact behavior | Incoming-facing dot | Impact | Recovery |
| --- | --- | ---: | ---: | ---: |
| `heavy-guard` | hold root and shield contact | `>=0.3420` (~front ±70°) | 4 | 12 |
| `fast-evade` | finish ranked lateral/back displacement | none | 3 | 14 |
| `technical-parry` | weapon contact and counter opening | `>=-0.1736` (~front ±100°) | 4 | 16 |

These IDs use the same `CombatActionState`, contain no `attackRolls`, and store the chosen incoming action in `reactingToActionId`. Guard/parry effectiveness applies only to that bound action. Evade displacement may incidentally move the defender outside other attacks' geometry; those attacks resolve as ordinary geometry misses rather than extra `attack-evaded` events.

Incoming-facing effectiveness uses `dot(defender.facing, normalize(attacker.position - defender.position))` from the contact snapshot. A successful reaction roll may therefore start a guard/parry that later fails with reason `facing` if the attacker out-circles the defender before contact; conversely, a defender that visibly turns back inside the arc in time is protected. Fast evade deliberately has no facing gate. No flank accuracy or critical bonus is added in this slice: getting outside a guard/parry arc is already the visible geometric reward.

### Heavy guard

- May answer any current attack tag that arrives inside the authored front arc.
- Multiplies damage by `0.35`, push by `0.30`, and stagger duration by `0.40`. Damage uses the common final rounding formula, push remains a float, and stagger uses the explicit integer rounding below.
- Holds root position during contact and impact.
- Emits `attack-blocked` followed by `damage-dealt` when the attack hits.

### Fast evade

- Uses the direction roll to rank `circle-left`, `circle-right`, and `backstep`; blocked directions fall through in that deterministic order.
- Attempts an authored defense dash of 0.9–1.2 units during the incoming windup, independent of the ordinary locomotion speed profile. The same `direction` roll chooses `0.9 + 0.3 × direction` distance and ranks directions, so defense still consumes exactly two values. The displacement is distributed across the remaining windup and remains subject to arena, movement-policy, and separation constraints.
- It succeeds only when final geometry places the fighter outside the attack's range or facing sector. The event is `attack-evaded`.
- If arena boundaries prevent all ranked displacements from leaving the contact geometry, the evade is visibly attempted, `defense-failed` emits with reason `geometry`, and normal attack resolution continues.

### Technical parry

- Answers only actions tagged `parryable`.
- Its active tick must match attack contact exactly.
- A successful parry cancels damage, applies 24 ticks of stagger to the attacker, and sets `technical-parry-counter` as the defender's forced next action.
- The forced counter begins on the next tick if the target remains within 2.3 units. Otherwise it is cleared and Technical selects `advance` or `hold-range` normally. The start check does not guarantee contact: ordinary movement during its eight-tick windup may still produce a geometry miss, and the counter never stretches or teleports to prevent that miss.
- A shield jab is deliberately unparryable but may miss or be avoided by range.

Future skill may improve reaction choice and error, but current defense chance is a fighter stat. Presentation never performs a defense roll.

## Decision policy

Action selection is a pure simulation function:

```ts
interface CombatDecisionContext {
  tick: number
  self: Readonly<FighterCombatState>
  target: Readonly<FighterCombatState>
  nearbyCombatantIds: Readonly<{
    allied: readonly CombatantId[]
    neutral: readonly CombatantId[]
    hostile: readonly CombatantId[]
  }>
  comparison: MatchupComparison
  pressureLevel: number
  arena: Readonly<CombatArenaDefinition>
}

type CombatDecision =
  | { type: 'locomotion'; locomotionIntent: LocomotionIntent }
  | { type: 'action'; actionId: AttackActionId }

interface CombatStyleDefinition {
  archetype: Archetype
  locomotion: Readonly<LocomotionProfile>
  preferredRange: { min: number; max: number }
  attackActionIds: readonly AttackActionId[]
  defenseActionId: DefenseActionId
  baseWeights: Readonly<Partial<Record<LocomotionIntent | AttackActionId, number>>>
}

interface LocomotionProfile {
  forwardUnitsPerSecond: number
  backwardUnitsPerSecond: number
  lateralUnitsPerSecond: number
  burstUnitsPerSecond: number
  turnCosPerTick: number
  turnSinPerTick: number
}

interface CombatStyleCatalog {
  styles: Readonly<Record<Archetype, CombatStyleDefinition>>
  attacks: Readonly<Record<AttackActionId, AttackActionDefinition>>
  defenses: Readonly<Record<DefenseActionId, DefenseActionDefinition>>
}

function chooseCombatDecision(
  context: CombatDecisionContext,
  style: CombatStyleDefinition,
  rolls: { selection: number; interval: number },
): CombatDecision
```

Each decision consumes exactly two values from the fighter's decision stream, even if only one candidate is legal. A candidate is either one pure locomotion intent or one action; actions and movement are not multiplied into a Cartesian product. Every legal listed locomotion exists alongside every legal action, so the presence of an action never silently removes the corresponding pure-movement choice. Candidates are filtered for state, range reachable through authored action root travel, arena path, forced behavior, and style.

Ordinary locomotion candidates are exactly the locomotion keys present in the style's `baseWeights`. An absent key means the style does not select that intent ordinarily; a present zero weight means contextual adjustments may make it positive. Forced behavior bypasses this set. Catalog validation rejects unknown keys and attack IDs not listed by that style.

Initial base weights are:

| Style | Locomotion weights | Action weights |
| --- | --- | --- |
| Heavy | `advance 12`, `hold-range 8`, `pressure 12`, each circle `2`, `retreat 0` | `heavy-shield-jab 14`, `heavy-cleave 8` |
| Fast | each circle `12`, `hold-range 5`, `retreat 8`, `burst-in 14` | `fast-slash 12`, `fast-burst-lunge 14` |
| Technical | `hold-range 12`, `backstep 12`, each circle `6`, `advance 6` | `technical-thrust 14`, `technical-driving-thrust 8` |

Forced `disengage` and `technical-parry-counter` bypass weighted selection. For an ordinary candidate, `baseWeight` is read from the matching locomotion or action table above, then these adjustments are summed exactly once:

- an action-only continuous range-fit adjustment `20 × clamp(1 - abs(predictedContactDistance - rangeMid) / rangeHalfWidth, 0, 1)`;
- `+12` for locomotion that reduces distance error to the neutral preferred band, `+12` for `hold-range` already inside that band, and `-12` for `hold-range` outside the band or locomotion that increases the error without a style-authored tactical reason (lateral circling is such a reason);
- an opening bonus of `+18` for committed/counter actions or `+6` for probes against a target in recovery/stagger;
- `-20` when an action would finish within 0.4 units of the arena boundary;
- `+8 × pressureLevel` for advance, pressure, burst, or committed candidates and the inverse adjustment for retreat/disengage;
- an action-only `+5`, `0`, or `-5` comparison score for advantage, neutral, or disadvantage.

The final formula is therefore `weight(candidate) = max(0, baseWeight(candidate) + sum(applicableAdjustments))`. The selection roll chooses proportionally among positive weights. No random number is drawn per candidate. If every weight is zero, policy deterministically selects movement toward the preferred range, or `hold-range` when already inside it. It must never return an illegal action and must not throw for ordinary spatial circumstances.

Example: Heavy is 2.0 units from a neutral opponent near arena center, neither fighter has an opening, and pressure is zero. `heavy-shield-jab` is illegal because its 0.25 root travel cannot reach 1.4. `hold-range` receives `8 - 12 = 0` and drops out. Positive weights are `advance = 12 + 12 = 24`, `pressure = 12 + 12 = 24`, each circle `= 2`, and `heavy-cleave = 8 + 20 × (1 - |1.55 - 1.35| / 0.45) ≈ 19.11`. Total weight is `71.11`, so the approximate shares are `33.75%`, `33.75%`, `2.81%`, `2.81%`, and `26.88%`. This example is a required unit fixture, including the candidate list and pre-selection weights.

Decision intervals are drawn from the `interval` roll within these inclusive ranges:

- Heavy: 20–42 ticks;
- Fast: 12–30 ticks;
- Technical: 18–36 ticks.

`nextDecisionTick` is set to the current tick plus this interval. If a longer action finishes after that tick, the fighter makes its next decision immediately upon returning to neutral.

### Anti-stall pressure

Each combatant stores two local clocks so an unrelated clash elsewhere in a future mass encounter cannot reset its anti-stall behavior:

- both clocks initialize to encounter-start tick `0`;
- `lastContactTick` updates for both actor and target on damage, block, or parry, but not on a miss or evade. Let `contactGap = tick - self.lastContactTick`; `pressureLevel = contactGap <= 180 ? 0 : min(3, 1 + floor((contactGap - 181) / 60))`. It can never exceed 3;
- `lastResolutionTick` updates for both living participants whenever an attack resolves as hit, block, parry, evade, geometry miss, or accuracy miss. At 300 ticks without any local resolution, ordinary `retreat`, `backstep`, `circle-*`, and `disengage` candidates are suppressed until that combatant participates in the next resolution.

Forced movement needed to make an action legal remains available. The separate clocks let an active sequence of evasions count as combat activity while still allowing physical-contact pressure to build.

### Future combat skill and perks

This slice does not add skill, progression, or a modifier registry. It preserves a seam by keeping context construction, legal-action filtering, scoring, random selection, and action execution separate. Action tags are stable data.

A later `combatSkill` can reduce deterministic decision error or improve reaction selection without changing action resolution. Perks may later adjust selected scores or tagged action parameters, for example `Patient` modifying `committed`, `Counterfighter` modifying `counter`, or `Fleet-footed` modifying defensive movement. These changes must stay in simulation/content and must not enter pose or renderer code.

## Random streams

No simulation module calls `Math.random()`, Web Crypto, time, or an external random source.

Each encounter derives three labelled streams per combatant from encounter seed plus stable combatant ID:

- `${combatantId}:decision`;
- `${combatantId}:defense`;
- `${combatantId}:contact`.

The random-state record is keyed by `CombatantId`, while all iteration uses sorted `combatantIds`. An exact contact-priority tie is not drawn from one global sequential stream: every tied intent receives a `tieKey` derived directly from encounter seed, tick, and its `ActionInstanceId`, then sorts by `tieKey` and finally ID. This creates a deterministic total order even when three or more intents share priority; a pairwise random comparator is forbidden. The duel time-limit tie is similarly derived from the sorted remaining candidate IDs. Thus an unrelated earlier tie cannot shift a later one.

Starting an attack consumes and stores exactly two values from its actor's contact stream: accuracy and critical. They are consumed even if the target later leaves range, is defeated before contact, blocks, evades, or parries. Decision and defense consumption are defined above. Priority and time-limit ties never consume combatant streams.

Within a decision pair, `selection` chooses among weighted candidates and `interval` schedules `nextDecisionTick`. Within a defense pair, `success` tests the defense chance and `direction` ranks Fast evade directions; the names are not reused for another semantic purpose.

The supported determinism contract covers current Node/Vitest and Chromium/Playwright builds: identical full inputs, seed, and tick count produce identical state, event trace, and canonical trace hash. Adding a distant non-interacting combatant does not shift existing combatants' streams or tie values. The test-only hash folds every tick's sorted combatant state, integer fields, HP, action/phase IDs, RNG states, event payloads, and positions/facing quantized to integer millionths through FNV-1a with `Math.imul`; quantization affects diagnostics only, never combat. `encounter.test.ts` fixes hashes for at least three two-combatant seeds, the capacity fixture fixes one 100-combatant hash, and Playwright compares one duel hash through the test API. Simulation uses vector/dot geometry with authored thresholds and contains no `Math.sin`, `Math.cos`, `Math.tan`, `Math.atan*`, `Math.asin`, `Math.acos`, `Math.pow`, or `Math.hypot`; exact bitwise identity on unsupported JS engines is not claimed by this MVP.

## Contact resolution

On a contact tick:

1. Snapshot all combatants' contact geometry and already scheduled defenses.
2. Build contact intents for actions in `contact`.
3. Resolve evade/parry/guard effectiveness, including guard/parry facing arcs, against the contact snapshot.
4. Sort remaining intents by descending action priority, then their per-intent `tieKey` defined under Random streams, then `ActionInstanceId` as a total-order fallback.
5. For each intent whose actor remains active:
   1. if its authored target is no longer active, emit `attack-missed` with reason `target-unavailable`, keep the attack's normal recovery, and finish this intent;
   2. if an active scheduled evade bound to this action produced final geometry outside the attack range/sector, emit `attack-evaded` and finish this intent;
   3. otherwise check range and facing sector, emitting geometry miss when invalid;
   4. check stored accuracy roll against clamped `accuracy + action accuracy modifier`;
   5. apply an active scheduled parry or guard bound to this action when its defender-facing gate passes; otherwise emit `defense-failed` with reason `facing` and continue ordinary resolution;
   6. determine opening critical;
   7. calculate damage, push, stagger, semantic contact zone, and root-plane contact point;
   8. apply events in canonical order.
6. Non-lethal stagger from the first intent does not cancel a second action already in contact. Defeat cancels all later intents from that fighter.

An attack never retargets after it starts. An unavailable target, out-of-range/out-of-sector action without an effective evade, or failed accuracy roll emits `attack-missed` with reason `target-unavailable`, `geometry`, or `accuracy` respectively. A successful bound evade emits `attack-evaded`, not an additional miss event. A started bound evade that remains inside contact geometry emits `defense-failed` before continuing through ordinary geometry/accuracy/hit resolution.

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

Comparison damage multipliers are `1.10`, `1.00`, and `0.90`. Comparison is calculated from actor archetype toward target archetype for every decision/contact; there is no encounter-global comparison. Accuracy is clamped to `0..1` before comparing `roll < probability`.

Push moves the target away from the actor along the snapshot line between their roots; exact coincident roots fall back to actor facing. Same-tick push vectors accumulate per target, then arena, movement-policy, and three-pass spatial separation constraints are applied once to the collection. Damage and push never move HP or position outside legal bounds. Stagger ticks after block use `Math.max(1, Math.round(baseStagger * 0.40))`; other stagger uses the action value. `staggerUntilTick = max(previous, contactTick + appliedStaggerTicks)` and the fighter becomes free when `tick >= staggerUntilTick`.

Contact zone is derived from the resolved outcome: `shield` for guard, `weapon` for parry, and `body` for an unblocked hit. Using snapshotted roots, let `towardTarget = normalize(target.position - actor.position)` and `distance` be their separation. The semantic root-plane contact point is `actor.position + towardTarget × distance × zoneRatio`, where `zoneRatio` is `0.60` for `weapon`, `0.65` for `shield`, and `0.72` for `body`. This point is event data owned by simulation; presentation only adds an authored height and maps it to a rig anchor.

For the current duel adapter, on tick 3600 scheduled contacts resolve first. If `no-hostile-pairs` has not already produced a winner, the higher remaining-HP ratio wins by `time-limit`; an exact ratio tie uses the derived ID-keyed value. There is no duel draw. Future mass modes must provide a separate time-limit scoring policy before becoming playable.

## Encounter tick order

One immutable encounter tick performs, iterating combatants by sorted ID unless a later canonical ordering is stated:

1. Increment tick and transition expired phases.
2. Clear expired stagger, prune completed reaction-ledger entries, cancel defenses bound to ended threats, and complete forced state transitions.
3. Build the pre-movement spatial hash; invalidate dead/non-hostile/out-of-retention targets and reacquire for decision-ready targetless combatants.
4. Make decisions for neutral combatants whose decision tick is due and that have a valid hostile target.
5. Start selected/forced actions, allocate actor-local action IDs, store attack rolls, and emit `action-started`.
6. Gather every incoming windup whose `contactTick - currentTick` equals the defender's reaction lead; process each defender's sorted threat batch, consume all required pairs, record outcomes, and schedule at most one legal successful defense.
7. Compute all simultaneous movement intents from the same pre-movement state.
8. Apply arena clamp, movement-policy constraint, and three fixed spatial-separation passes.
9. Resolve all contact intents as defined above.
10. Apply accumulated pushback and repeat arena/movement-policy/spatial separation correction.
11. Persist local pressure clocks, HP/status, targets, action/reaction metadata, event IDs, and combatant random states.
12. Resolve `no-hostile-pairs` or the duel time limit.

Outside `running`, advancing an encounter returns the exact previous object with an empty event batch. Multi-tick helpers repeatedly apply this one-tick transition and concatenate emitted batches only at the caller that explicitly requests aggregation.

## Structured encounter events

Event IDs are monotonic within one encounter and restart for a new `EncounterState`. The kernel stores only `nextEventId`; `advanceEncounterTick` returns `{ state, events }`, and the deterministic trace hash folds each batch before it can be discarded. Movement events are emitted only when intent changes; phase progress lives in state rather than emitting every tick.

| Event | Required payload | Feed use | Presentation/audio use |
| --- | --- | --- | --- |
| `encounter-started` | sorted combatant IDs, faction IDs, hostility mode | opening line in duel | reset rig/effects/audio cursors |
| `movement-intent-changed` | combatant ID, from, to | none | locomotion transition/footsteps |
| `action-started` | actor ID, target ID, action instance/definition IDs, expected contact tick | optional committed-action line | anticipation and whoosh scheduling |
| `action-interrupted` | actor ID, action IDs, reason (`stagger` or `threat-canceled`) | optional interruption line | replace/cancel action pose |
| `defense-started` | defender ID, attacker ID, incoming action ID, defense ID, expected contact tick | none | guard/evade/parry preparation |
| `defense-declined` | defender ID, attacker ID, incoming action ID, defense ID, expected contact tick | optional recognition line | small recognition flinch; no block/parry pose |
| `defense-failed` | defender ID, attacker ID, incoming action ID, defense ID, reason (`geometry` or `facing`) | optional failed-defense line | failed defense accent before hit |
| `attack-missed` | actor ID, target ID, action IDs, reason | miss line | miss/recovery cue |
| `attack-evaded` | actor ID, target ID, action IDs, evade intent | evade line | fast exit cue |
| `attack-blocked` | actor ID, target ID, action IDs, contact zone, contact point | combine with damage | shield pose/metal cue |
| `attack-parried` | actor ID, defender ID, action IDs, contact zone, contact point | parry/counter line | weapon spark/parry cue |
| `critical-hit` | actor ID, target ID, action IDs, multiplier | emphasize | stronger impact cue |
| `damage-dealt` | actor ID, target ID, action IDs, amount, remaining HP, contact zone, contact point | damage line unless combined | hit pose/flash/audio |
| `fighter-staggered` | combatant ID, source ID, action ID, duration ticks, direction | none unless severe | reaction and push cue |
| `fighter-defeated` | defeated ID, source ID | defeat line | defeat pose/cue |
| `encounter-finished` | reason, duration ticks, sorted survivor IDs, winner IDs, winning faction IDs | final duel line through adapter | stop ordinary cues |

`contact zone` is one of `body`, `shield`, or `weapon`; `contact point` is the root-plane `Vec2`. Presentation selects a style/action-specific height and exact weapon/limb target from the semantic zone.

Canonical contact sequences:

- Miss: `attack-missed`.
- Evade: `attack-evaded`.
- Failed evade into hit: `defense-failed → damage-dealt → fighter-staggered`.
- Failed evade into ordinary miss: `defense-failed → attack-missed`.
- Ordinary hit: `damage-dealt → [action-interrupted] → fighter-staggered`; the optional interruption appears only when stagger cancels the target's windup, impact, or recovery.
- Blocked hit: `attack-blocked → damage-dealt → fighter-staggered`.
- Parry: `attack-parried → fighter-staggered(attacker)`; the counter later emits its own normal action events.
- Critical defeat: `critical-hit → damage-dealt → fighter-staggered → fighter-defeated → [encounter-finished]`; the final event appears only if no hostile pair remains.

The current `DuelBattleAdapter` may accumulate the complete duel log to preserve feed/tests; the encounter kernel never owns an unbounded log. The visible feed still renders the latest eight formatted duel entries. A future mass renderer consumes event batches and chooses its own bounded presentation window.

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

Implementation may tune these fighter numbers plus action `damageMultiplier`/`recoveryTicks`, style turn sine/cosine pairs, and Fast's authored `evadeDisplacement` to satisfy balance acceptance. It must preserve names, styles, opponent order, relative content intent, the qualitative turn ordering `Heavy < Technical < Fast`, the 0.9–1.2 Fast evade range unless a reviewed trace proves it structurally unusable, and the qualitative action ordering: probes remain quicker/lower-payoff than committed actions, Fast remains quickest, Heavy's cleave remains the slowest commitment, and Technical retains the longest practical reach. Any tuning outside those fields requires a written spec amendment.

Planning cards replace attack interval with Power and Defense while retaining HP, Accuracy, Critical, and the always-visible counter rule.

### Amendment — Task 13 balance calibration (approved during Task 13 execution on `feature/readable-deep-combat`)

**The table above remains the authored initial content and is the historical record of intent.
`src/content/mvpSeries.ts` and `src/content/combatStyles.ts` are now the source of truth for current
values.** Read the table for *why* a fighter is shaped the way it is; read the content files for what
the numbers are. `src/content/mvpSeries.test.ts` pins the rank orders below as properties.

Task 13 could not satisfy the fixed statistical cohorts while holding every relative standing in the
table. The plan owner approved the following deviations, each recorded with the measurement that
forced it.

What is **unchanged**: four of the five stat rank-orders (`maxHp`, `accuracy`, `defenseChance`,
`criticalChance`) are exactly as authored, as are names, styles, opponent order, the
`Heavy < Technical < Fast` turn ordering, Fast's `0.9–1.2` evade envelope, and the qualitative action
ordering.

What is **changed but not itemised below**: several values moved in magnitude without disturbing any
rank, under the blanket "Implementation may tune these fighter numbers" clause above. Listed here in
full so an audit of the freeze against the approved set finds no unexplained number — Aquila
`accuracy` 0.84 → 0.855, `defenseChance` 0.31 → 0.315, `criticalChance` 0.14 → 0.148; Cassius
`defenseChance` 0.38 → 0.395. Each is a small step taken to stay inside its own rank while the rows
around it moved; none crosses a neighbour.

**1. Aquila `power` 16 → 20** — from strictly lowest of the six to tied third with Nerva. This is the
only rank-order change. Without it `aquila/drusus` measures 1.5% and `aquila/magnus` 10.5% against
the cohort's `15..85%` band; with it, the shipped calibration measures 19.5% and 33.0%. Every
alternative was measured and is
insufficient: critical chance is nearly inert (+1.0 point when *doubled*, since criticals apply only
to an unblocked hit on a target already in recovery or stagger), and compressing the HP spread alone
reaches 5.5%. Aquila keeps strictly the lowest HP and the highest critical chance, so "fragile burst
fighter" survives — and low HP with high per-hit power arguably reads as a truer glass cannon than
the authored 16, which made her simply worse at everything.

**2. HP-spread compression** — rank order preserved; magnitudes compressed. Aquila now sits at
**78%** of Drusus's HP (274 against 350) versus the authored 65% (120 against 185), so "fragile"
survives as an ordinal but is softer as a magnitude. The scale factors are deliberately **not**
uniform — they span 1.892 (Drusus) to 2.283 (Aquila) — because the compression *is* the deviation;
a uniform scale would have preserved the authored 65% and left `aquila/drusus` unreachable. This is
the other half of what makes that pairing clear its band.

**3. Magnus buffed toward his neighbours** — accuracy `0.78 → 0.85`, critical `0.06 → 0.099`, defence
`0.32 → 0.335`; rank order preserved, and he remains last on accuracy and critical and fifth on
defence. Needed to hold `brutus/magnus` and `nerva/magnus` under the `85%` ceiling. He is still the
weakest opponent on every axis the table names for him.

**4. Golden scenario: "at least three distinct final score/result profiles" relaxed to two.**

The only reachable third-profile flip at seed `20260815` is Aquila beating Magnus, which requires
Magnus at `maxHp <= ~264`. Keeping `brutus/magnus` at or under `85%` requires him at `~282`. Brutus
cannot absorb the difference: he sits one point above Nerva at his own standing floor. The four
alternative flips that would also produce a third profile (Aquila beating Drusus or Cassius, Nerva
losing to Cassius or Magnus) are 83–162 HP away against 15–26 HP for the Magnus flip, and Cassius and
Nerva are each within a point or two of their standing ceilings. A configuration achieving three
profiles was built and measured; it shipped `brutus/magnus` at 86.5% and `nerva/magnus` at exactly
85.0%, and was rejected for that reason.

The two golden criteria that carry product intent both still hold, and are asserted as strictly as
before: the all-counter lineup does **not** sweep (it loses `1–2`), and a different lineup wins. What
is lost is puzzle *variety* across the six orderings.

The basis for prioritising the cohorts over this criterion is the design's own framing, two
paragraphs below: "Determinism, style balance, roster balance, and pacing are **separate checks**",
and the golden-scenario block closes by describing itself as "a determinism/product-puzzle fixture,
**not evidence of statistical balance**". The statistical cohorts are the balance acceptance; this
criterion is a property of one seed.

Separately, and not a content matter: Task 13 found and fixed six conformance defects in
`src/simulation/combatDecision.ts`, `encounter.ts` and `combatActions.ts`, three of which were
silently propping up balance numbers. See `.superpowers/sdd/2026-08-16-readable-deep-combat/task-13-report.md`.

## Balance acceptance

Determinism, style balance, roster balance, and pacing are separate checks.

**Golden scenario (`20260815`):**

- the all-counter lineup `Brutus→Drusus`, `Aquila→Cassius`, `Nerva→Magnus` must not sweep `3–0`; the UI counter rule is useful but not a guaranteed answer to stronger individual opponents;
- at least one different lineup wins `2–1` or `3–0`;
- ~~the six possible lineups contain at least three distinct final score/result profiles~~ — **AMENDED to at least two** during Task 13; see "Amendment — Task 13 balance calibration" under Fighter content for the measured conflict with the roster win-rate bands;
- one complete lineup has a checked canonical event-trace hash. This is a determinism/product-puzzle fixture, not evidence of statistical balance.

**Fixed statistical cohorts:**

- `balance.test.ts` runs all nine roster pairings over 200 consecutive seeds beginning at `20260815` and reports home win rate, median/p10/p95 duration, timeout rate, and the maximum no-resolution gap per bout;
- no roster pairing has a home win rate below `15%` or above `85%`;
- the combined median is `1500–2400` ticks, every pairing's median is `1200–2700`, duration p10 is at least `900`, duration p95 is below `3200`, and fewer than `2%` of bouts reach `3600`;
- the cohort p95 of each bout's longest gap since `lastResolutionTick` is at most `300` ticks after initial approach;
- separate equal-stat style fixtures run 500 seeds per ordered style matchup: the advantaged style wins `55–75%`, and same-style mirrored fixtures remain within `45–55%` after swapping home/away starts;
- targeted deterministic unit fixtures demonstrate each signature attack, each defense result, Technical's exact-boundary parry of `fast-slash`, every stagger/action phase cell, and the failed-evade path;
- sampled traces for every style contain lateral or distance-changing movement between committed exchanges; no style devolves into stationary cooldown trading.

The cohort seed ranges and metric formulas are test data and cannot be changed during tuning. If allowed numeric tuning cannot satisfy the bands, implementation stops and presents the failing distributions rather than weakening a criterion silently.

## Mass-foundation acceptance

The slice does not expose a mass-combat mode, but the generic kernel must pass these headless fixtures:

- create a valid `free-for-all` encounter with 100 unique combatants in a headless arena of radius `30`, lateral limit `20`, and `free` movement; advance 600 ticks without non-finite state, invalid targets, duplicate action/event IDs, or invariant failures;
- two identical 100-combatant runs produce the same per-tick/event trace hash;
- shuffling the input definitions before encounter creation produces the same sorted IDs, state, events, and hash;
- adding one distant, non-interacting combatant does not change the original participants' post-start streams or actor/target events before it enters acquisition range (the encounter-start payload itself necessarily lists the added ID);
- a sparse 10×10 layout's spatial broad phase reports its deterministic canonical pair set and performs fewer than 800 candidate checks per separation pass, never the full 4950 unordered pairs;
- every real neighboring pair appears at most once per pass and separation always performs exactly three passes;
- a five-attacker/single-defender fixture consumes one defense pair per simultaneous reaction opportunity, schedules at most one defense, and records/prunes every ledger entry deterministically;
- a target defeated during another actor's windup yields `target-unavailable` without retargeting the in-flight action;
- encounter state contains no event-history array and its serialized schema does not grow with elapsed ticks solely because events occurred.

`npm run benchmark:encounter` reports milliseconds/tick, emitted events, spatial candidate checks, and peak serialized-state bytes for the fixed 100-combatant fixture. It is informational and has no CI wall-clock threshold in this slice; deterministic structural counters are the blocking acceptance criteria.

## Module boundaries

### `src/simulation/`

- `fighters.ts` — fighter definitions, archetypes, comparison, and validation.
- `spatialHash.ts` — transient uniform-grid construction, radius queries, canonical neighboring pairs, and optional test counters.
- `movement.ts` — plain `Vec2` helpers, arena clamp, facing, intent displacement, movement policies, and fixed-pass multi-combatant separation.
- `combatActions.ts` — action/phase types, immutable definitions' simulation contracts, phase transitions, and contact math.
- `combatDecision.ts` — target acquisition, local context, legal candidate construction, scoring, seeded choice, batched defense reactions, and future policy seam.
- `encounter.ts` — collection state, hostility, per-combatant labelled streams, tick/event orchestration, contact ordering, and `no-hostile-pairs` completion.
- `battle.ts` — current two-ID duel adapter, home/away result mapping, complete small duel log, and time-limit policy.
- `series.ts` — unchanged responsibilities: assignments, bout order, score, results, and delegation.

No file in this directory imports DOM, Three.js, Web Audio, presentation, or content modules.

### `src/content/`

- `combatStyles.ts` — style locomotion, action definitions, visual discipline IDs, and decision weights as data.
- `mvpSeries.ts` — the six fighter rows and opponent order.

Content contains no mutable state or presentation objects.

`main.ts` imports the style catalog and fighter rosters, then passes both into `createSeries`. `SeriesConfig` adds `combatStyles: CombatStyleCatalog`; series state keeps this plain readonly data and passes it into every duel-adapter/encounter creation. The catalog includes the style, attack, and defense tables needed for cross-validation and action lookup. This dependency injection lets simulation consume style data without importing `src/content/` and keeps `structuredClone` test state free of functions or engine objects. Its serialized size is a known constant overhead included in encounter benchmark state-byte reporting, not state growth caused by elapsed events.

### `src/presentation/`

- `ProceduralFighter.ts` — shared joint hierarchy, primitive body builders, equipment anchors, and disposal.
- `poses/combatPoses.ts` — immutable joint-key data for style guards, action phases, locomotion, reactions, and defeat.
- `PoseController.ts` — pose-data sampling, locomotion cycles, reaction layers, grounding, and limited two-bone weapon-arm IK.
- `ArenaCamera.ts` — target-array horizontal group framing, dead zones, damping, distance clamps, interpolation state, and reset; current calls pass two targets.
- `ArenaView.ts` — scene ownership, `Map<CombatantId, ProceduralFighter>`, state/event-batch synchronization, contact effects, and delegation to the camera/pose modules.
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

Each action uses sparse immutable data keys for guard/opening, anticipation, contact, overshoot or impact, recovery, and return. The distinctive anticipation key is front-loaded in the first tick of windup rather than appearing only near its middle. Because roots render between previous and current snapshots, render phase progress uses the same visual time: `(currentTick - 1 + alpha - phaseStartedTick) / (phaseEndsAtTick - phaseStartedTick)`, clamped to `0..1`; a new bout initializes both render snapshots from its tick-0 state. Simulation phase boundaries remain integer-only. Keys use named easing curves rather than uniform interpolation.

Presentation may rotate torso/limbs, solve a two-bone weapon arm, and align `weaponTip` to the semantic contact target within a capped cosmetic reach. It may not change simulation root, facing, action phase, hit result, damage, or event order. If a target is outside the cosmetic IK cap, the authored contact pose wins; presentation does not stretch limbs indefinitely.

During an action's `impact` phase, the controller holds both participants' contact/reaction body poses without phase interpolation for exactly `impactTicks`; this is the slice's presentation-only hitstop. Simulation ticks, camera damping, effects, and audio continue. No global clock is paused, and rapid probe hits receive only their already-authored two- or three-tick impact rather than an additional freeze.

Feet use a deterministic gait phase derived from travelled simulation distance, not wall-clock time. Footstep presentation cues fire when the planted foot changes. At `×4`, footsteps are suppressed.

Defeat uses a style-specific controlled pose. Rotating the whole group onto its side is not sufficient.

### Amendment — idle pose layer inserted (approved by the plan owner on 2026-08-19, combat-legibility slice)

The fixed order above has no layer covering standing still: a fighter that is neither moving nor
mid-action is left with nothing contributing motion, so a standstill reads as frozen. That is part of
the "movement looks jerky" defect reported after the readable-deep-combat slice shipped -- there is no
acceleration model, so a fighter is stationary (below the smallest visible step) for roughly 67-75% of
ticks for Heavy and Technical, and the pose layer made it worse: the gait blend is weighted by speed, so
at zero velocity it vanishes entirely and the fighter collapses into a static guard stance.

**Amended rule** (adds a layer to the fixed order above; does not change layers 1 through 5 themselves):

- A new layer, **1b**, is inserted between the style guard pose (1) and the locomotion cycle (2): idle
  sway (breathing/weight shift). It applies only when the fighter is in a neutral, un-staggered, living
  state, and is fully suppressed during any action, defense, stagger, or defeat overlay (3/4/5's held
  poses) -- those hold poses this layer would otherwise corrupt, including the fixture asserting an
  impact pose is identical across ticks. Amplitude scales as `1 - speedWeight` (the same interpolated
  speed weight the gait layer already computes); phase comes from interpolated simulation time, offset
  per combatant id so two standing fighters are never in unison; it is exactly zero, not merely small,
  under `prefers-reduced-motion: reduce`.
- The layer merges **additively** onto whatever the guard layer (1) already wrote for the same joint,
  not as a replacement. A style's authored guard pose carries real content on the joints idle sways
  (e.g. Fast's `chest` guard value carries a `0.1` rad torso twist, part of what makes the guard read as
  oriented rather than square-on) -- an outright-replacing idle layer would erase that the instant any
  idle amplitude went non-zero, undercutting this slice's own first goal (mutual orientation stays
  readable) to serve its second (standing reads as alive).

Not changed: layers 2 through 5, and the closed-form "later layer replaces outright" merge semantics for
every layer other than 1b.

## Arena, camera, and effects

- Keep the current stable elevated perspective and arena plane.
- `ArenaCamera` frames only the horizontal target-group extent; vertical pose motion never changes zoom.
- The camera look target follows the fighters' midpoint only after it leaves an 8% viewport dead zone, with a `0.75 s` damping time constant.
- Camera distance changes only after the horizontal group extent leaves a 12% framing dead zone, uses a separate `1.25 s` damping time constant, and is clamped to `11..18` world units from the look target.
- Framing includes each fighter's style-authored horizontal equipment radius and a 10% margin. It uses no motion lookahead.
- ~~Camera does not orbit, cross the combat axis, cut, or shake.~~ — **AMENDED on 2026-08-18**: the camera now holds a bounded, damped yaw that keeps the combat axis across frame. It still never crosses the combat axis, cuts, or shakes. See "Amendment — combat-axis yaw" below.
- Lighting, material value, and an inexpensive geometry/rim outline keep silhouettes separate from the floor without a post-processing pipeline.
- Weapon trails appear only during the final part of windup through contact.
- `body`, `shield`, and `weapon` contacts use distinct effect shape/position, not color alone.
- Contact flashes expire before the next exchange and never obscure either torso.
- Arena reset clears pose, trails, flashes, audio voices, event cursors, and camera interpolation at each new bout and on rematch.
- With `prefers-reduced-motion: reduce`, weapon trails and transient contact flashes are disabled and nonessential pose overshoot is reduced; simulation, key anticipations, contact holds, and results do not change.

### Amendment — combat-axis yaw (approved by the plan owner on 2026-08-18, resolving issue #4)

The original rule pinned the camera's *orientation* as well as its position: it framed world-X extent
only and always looked down `-Z`. Nothing then kept the pair's own axis perpendicular to that view.
Measured on the shipped build at seed `20260815`: the fighters start on a clean profile at
`(-4.2, 0)`/`(4.2, 0)`, but by mid-bout the pair axis had rotated about `19°` off world X (positions
`x 1.6/3.3` at `z 1.1/1.7`). Two consequences, both visible in the arena:

1. At close-quarters range (~`1.8` units) with a `38°` FOV the two silhouettes overlap, and slightly
   turned-away profiles read as "both fighters are facing the viewer".
2. The zoom worked against the reader: with extent measured along world X, a pair rotating toward the
   view axis measures *narrower* and pulls the camera in, exactly when it should not.

The `z = -2.5..2.5` lateral clamp and the ordered-pair rule prevent the fighters from swapping sides,
but neither keeps the axis square to the camera; that is a camera responsibility, so the camera takes
it.

**Amended rules** (these supersede the corresponding bullets above):

- The camera holds a **yaw** around its look target so the group's spread axis stays across the frame.
  Desired yaw is the group's own principal (unsigned) spread axis, negated; it is clamped to
  **`±30°`** from the arena's authored home shot, moves only after the desired yaw leaves a **`5°`**
  dead zone, and damps with a **`1.5 s`** time constant — deliberately the slowest of the three axes,
  so yaw reads as the fight turning rather than as the camera moving.
- Group extent (the input to the distance mapping) is measured across the camera's **screen-horizontal
  axis at the current yaw**, not along world X.
- The look target is the group's 2D centre (X and Z), not an X-only midpoint on the `z = 0` line. Its
  8% dead zone is measured on the full 2D drift.
- The camera still **does not cut or shake, and still cannot cross the combat axis**: the spread axis
  is read as an unsigned axis (`0.5 · atan2(2·Sxz, Sxx − Szz)`, range `(-90°, 90°]`), so no ordering
  of the targets and no clamped yaw can put the camera on the far side of the fight. A degenerate
  group (a single target, or several exactly stacked) yaws to `0`, not to an angle read out of float
  noise.

Not changed: fixed FOV, the fixed elevation/distance ratio, the `11..18` distance clamp, the 12%
framing dead zone, the 10% equipment margin, the absence of motion lookahead, and the hard cut of all
camera state at each new bout and on rematch.

Consequence for acceptance: the frozen pose baselines were recaptured under the amended framing.
Because `?snapshot` holds the runtime paused and a paused frame advances no camera time at all
(that is what makes a capture depend on tick count rather than on how long test setup took), each
capture now first asks a dev-only hook to damp the camera by four seconds of *simulated*
presentation time onto the frame it is showing. Without it every baseline would show the bout's
opening wide shot no matter which tick it froze.

### Amendment — yaw clamp widened, damping retuned (approved by the plan owner on 2026-08-19, combat-legibility slice)

Measurement after the 2026-08-18 amendment shipped found it only partly fixed what it set out to fix.
The unwrap-then-clamp mechanism above was implemented correctly, but the two numbers chosen with it were
not right: the `±30°` clamp gave up on eight of nine style pairings for a large share of the bout (the
pair's own axis exceeds 30° off world X between 33% and 69% of a bout in eight of nine pairings,
measured at seed `20260815`), and even after widening the clamp, the `1.5 s` damping time constant lags
a fast-rotating pair badly enough that on-screen framing error (the angle between the camera's
screen-horizontal axis and the pair's own axis, folded mod 180°) still exceeds 30° on up to 18.9% of
ticks in the worst pairing, 11.2% averaged across all nine. Both are the same original complaint this
whole slice exists to fix: the camera still spends real time looking down the fighters' own axis.

**Amended rules** (these supersede the two numeric values in the corresponding bullet above; the
unwrap-then-clamp mechanism itself, and every other bullet in this amendment's parent section, are
unchanged):

- The yaw clamp widens to **`±90°`** from the arena's authored home shot (from `±30°`). With the unwrap
  in place the peak measured offset from home across all nine pairings is exactly `90°`, because the
  axis oscillates rather than winding, so the camera tracks the axis at essentially every heading and
  degrades by holding at the limit instead of flipping to the far side of the arena.
- The damping time constant tightens to **`0.5 s`** (from `1.5 s`). On-screen framing error was measured
  directly (not inferred from clamp saturation alone) across all nine pairings at seed `20260815`:

  | tuning | error > 30° | error > 45° | worst yaw step |
  |---|---|---|---|
  | tau 1.5s (2026-08-18 amendment) | 11.2% | 1.5% | 0.86°/tick |
  | tau 0.8s | 3.7% | 0.5% | 1.22°/tick |
  | tau 0.5s (this amendment) | 1.5% | 0.1% | 1.85°/tick |
  | tau 0.35s | 0.7% | 0.1% | 2.49°/tick |
  | tau 1.5s + 25° lag cap | 0.0% | 0.0% | 11.98°/tick |

  A lag cap (snapping the damped yaw back within a fixed distance of the reference) was measured and
  rejected: it drives the error to `0.0%`, but at the cost of ~`12°`/tick steps (`720°/s`), which reads
  as snapping rather than damping. `0.5 s` was chosen instead as the point that recovers nearly all of
  the achievable error reduction while keeping the worst single-tick step an order of magnitude below
  the lag-cap variant. Yaw is now the **fastest** of the three damped axes (look `0.75 s`, distance
  `1.25 s`, yaw `0.5 s`) — the reverse of the 2026-08-18 amendment's "deliberately the slowest" framing:
  a fast-rotating pair needs the camera to keep up with it, not lag behind it reading as calm.
- The `5°` yaw dead zone was checked as a possible lever and is not one: tightening it to `2°` only moves
  the 30°-error figure from 1.5% to 1.3%.

Not changed: the unwrap-then-clamp mechanism, the unsigned-axis degenerate-spread handling, fixed FOV,
the fixed elevation/distance ratio, the `11..18` distance clamp, the 12% framing dead zone, the 10%
equipment margin, the absence of motion lookahead, and the hard cut of all camera state at each new bout
and on rematch.

## Combat audio

`CombatAudio` is presentation-only and uses a replaceable backend so unit tests do not require browser audio.

Initial synthesized cues:

- `footstep-light`, `footstep-heavy`;
- `weapon-whoosh-light`, `weapon-whoosh-heavy`;
- `body-hit`, `shield-block`, `weapon-parry`;
- `stagger`, `defeat`.

The implementation may use short oscillator/noise/filter/gain graphs or generated buffers. Cue selection is semantic. Minor pitch/duration variation is derived from bout index and event ID and never consumes simulation randomness.

Rules:

- Create/resume AudioContext only after the lineup-confirmation click or an explicit `Sound on` click. Playwright uses lineup confirmation as the enabling gesture.
- Sound defaults on after that first eligible gesture succeeds, with a visible runtime `Sound on/off` control.
- Persistence across page loads is out of scope.
- Pause stops scheduling, quickly fades active ordinary voices, and resumes from new events only.
- `×1` and `×2` allow all cues with a maximum of eight simultaneous voices.
- `×4` allows only body hit, block, parry, stagger, and defeat.
- The same event/pose threshold cannot play twice after re-render.
- Missing or rejected Web Audio disables audio silently while combat continues.
- Bout change and rematch stop all voices and reset cursors.

Probe whooshes begin on the first tick of windup. At `×2`, probes are not required to be predictable from anticipation alone, but their contact/miss, held impact pose, and recovery must remain classifiable after resolution; a probe is not artificially prevented from dealing a lethal final hit.

Audio quality requires human listening; automated tests verify mapping and lifecycle only.

## Series integration

The series state machine and public commands remain unchanged. `SeriesConfig` and `SeriesState` gain the readonly plain-data `combatStyles` catalog described above. Each active bout owns `DuelDescriptor { homeId, awayId }` plus its encounter-backed `BattleState`; `FighterSide` remains a series/UI concept only. `BoutResult` keeps current winner side, reason, duration, comparison, fighter IDs, and HP ratios by mapping the two descriptor IDs out of the general encounter result. Results derive duration from the new 3600-tick battle. Planning, interstitial, summary, rematch, pause, and speed retain their existing semantics.

The test API continues to expose series state, assignment commands, `advanceTicks`, next bout, and rematch. State cloning must support the new plain records, sorted ID arrays, hostility data, and duel descriptor. No transient spatial hash, `Map`, Three.js, or Audio object enters test state.

The feed formats new actions and defenses but remains non-live for screen readers. Only phase status, interstitial, and final result use polite live regions.

## Error handling and invariants

- Unknown fighter/style/action/combatant/faction IDs, duplicate combatants, invalid/conflicting hostility rows, no initial hostile pair, encounter sizes outside `2..100`, invalid arena configuration, non-finite numeric data, negative distances, and non-positive phase ticks throw developer errors at creation/validation boundaries.
- Ordinary target movement out of range produces a miss, never an exception.
- An empty attack candidate list yields locomotion/hold behavior.
- All positions, velocities, facing values, travelled distances, joint transforms, and phase progress must remain finite; simulation facing remains normalized within a small epsilon.
- In test/dev, encounter invariant checks cover sorted/unique IDs, valid hostile live targets, arena bounds, separation, phase endpoints, HP range, globally unique event IDs, actor-local action serials, per-combatant random states, bounded/live reaction ledgers, active/defeated consistency, one reaction opportunity per defender/attack pair, canonical spatial pairs, and absence of action/contact after defeat.
- A presentation or audio failure cannot mutate or stop simulation. WebGL context loss replaces the canvas with a text fallback while the runtime and series controls continue.
- Disposing or replacing a bout releases geometries, materials, resize observers, AudioNodes, and event cursors.

## Automated verification

### Simulation/unit

- `spatialHash.test.ts`: stable cell keys, radius queries, canonical unique pairs, sparse candidate counters, and independence from input order.
- `movement.test.ts`: vector math, bounds, both movement policies, fixed three-pass separation, constant-step bounded facing including exact-opposite recovery, travelled distance, velocity, and all intents.
- `combatActions.test.ts`: exact phase ticks, action legality, attack/defense facing arcs, semantic contact points, damage rounding, block, authored evade displacement/failure, parry/counter including allowed counter miss, opening critical, priority, simultaneous contacts, and every attack/defense phase × stagger cell.
- `combatDecision.test.ts`: nearest-hostile acquisition, retention/invalidation, local context ordering, exact candidate construction/formula/example, style behavior, fixed roll consumption, batched multi-threat defense, deterministic choice, capped local pressure, resolution-based suppression, forced disengage, and future-seam purity.
- `encounter.test.ts`: hostility modes, sorted collection creation, actor-local action IDs, per-combatant streams, event batches, contact ordering, target-unavailable, `no-hostile-pairs`, complete traces, at least three canonical hashes, and immutability.
- `encounterCapacity.test.ts`: all Mass-foundation acceptance fixtures, including 100-combatant FFA and structural spatial counters.
- `battle.test.ts`: duel-adapter mapping, complete small duel log, defeat/time limit, no draw, and unchanged series-facing result semantics.
- `series.test.ts`: unchanged phase flow and rematch with new battle state.
- `mvpSeries.test.ts`: golden scenario, lineup, style, and content invariants.
- `balance.test.ts`: fixed roster/equal-stat cohorts, win-rate bands, duration percentiles, timeouts, resolution gaps, and movement metrics.
- `architecture.test.ts`: simulation imports no DOM/Three/Web Audio/presentation/content, kernel files contain no `FighterSide`/`home`/`away` combat identity, and simulation contains no `Math.random()` or forbidden runtime trigonometry/transcendentals listed under Random streams.

### Presentation/unit

- Pose sampling always returns finite transforms and progress in range.
- Every style supplies every joint/equipment anchor and every required data-driven guard/action/reaction/defeat pose; fighter instances are keyed by `CombatantId` rather than side.
- Contact IK stays within its cosmetic cap.
- Feed maps every event and retains exactly the latest eight display entries.
- Audio maps semantic events, suppresses duplicates, enforces voice/speed rules, and degrades without AudioContext.
- In Vite dev/test only, `?audioDebug=1` exposes a test API that can trigger every cue without starting a bout. Production builds ignore the parameter and render no debug UI.

### Playwright

- Existing planning, assignment, three-bout, focus, seed, pause/speed, interstitial, summary, and rematch tests remain.
- A complete active bout demonstrates position changes after initial approach.
- Second and third bouts reset rig, effects, audio cursor, and camera state.
- Deterministic presentation fixtures freeze Heavy guard/cleave, Fast burst/disengage, Technical measure/parry/counter, plus hit, block, stagger, and defeat.
- Screenshot baselines cover those key poses and one complete two-fighter safe frame at 1280×820.
- At 60, 120, and 144 Hz emulation, interpolated roots remain smooth while simulation hashes stay identical; a Chromium fixture compares a canonical hash also asserted in Vitest.
- The visual fixture mechanism is test-only and cannot alter production simulation results.
- A WebGL context-loss fixture verifies the text fallback and series progression.

## Human review gate

Before handoff, humans review:

1. one full bout for each of the nine ordered home-style/opponent-style combinations at `×1`;
2. one full three-bout series at `×2`;
3. the key-pose screenshot storyboard;
4. a short recording with HP cards and feed hidden;
5. each audio cue in isolation and cues during a complete bout.

At least two reviewers who did not implement the combat watch three representative `×1` clips with HP cards/feed hidden; at least one reviewer begins without being taught the style rules. For every exchange they record whether it was a `probe` or `committed` action, and for every committed exchange they briefly label anticipation, defense/result, and recovery before comparing those labels with the event trace. Acceptance requires at least `75%` fully correct committed-exchange labels from each reviewer, correct identification of all three styles after one clip each, and a causally plausible explanation of the winner in all three clips. Probe exchanges are reviewed separately for visible resolution/recovery and do not lower the committed-exchange anticipation metric that they were explicitly not designed to satisfy. Reviewers also explicitly check recognition flinches for `defense-declined`, foot sliding, weapon contact, spacing rhythm, camera framing, repeated motion, reduced-motion mode, and sound weight. The PR records anonymized counts and short failure notes, not only a subjective pass. Visual/audio acceptance cannot be delegated to a text-only model.

## Migration

- In `fighters.ts`, rename `damage` to `power`, rename `blockChance` to `defenseChance`, remove `attackIntervalTicks`, and extend validation for the new fighter/action consistency rules.
- Move `FighterSide` out of combat identity and introduce stable `CombatantId`, `FactionId`, `ActionInstanceId`, hostility data, sorted encounter collections, actor-local serials, target IDs, and reaction ledgers.
- Replace scalar fighter `x` with `Vec2 position`; add normalized vector facing, velocity, travelled distance, locomotion, action, stagger, local resolution/contact clocks, target, and decision state.
- Replace the instantaneous attack loop with spatial hash, encounter, decision, movement, phase, defense, and contact modules; keep `battle.ts` as the two-combatant series adapter.
- In the encounter/duel path, change `MAX_BOUT_TICKS` from `2700` to `3600`, remove `approach-started`, replace side-based events with ID-based batches, add trace hashing, and implement the new tick order.
- In `mvpSeries.ts` and its consumers, replace `TARGET_MIN_BOUT_TICKS = 840` / `TARGET_MAX_BOUT_TICKS = 1800` with cohort metrics rather than exported single-bout limits.
- Update `battleFeed.ts` for ID-based names and `ArenaView.ts` for `Map<CombatantId, ProceduralFighter>`, removal of `approach-started`, and consumption of every new event batch.
- Replace `ArenaView` reaction-decay transforms with procedural fighters and `PoseController`.
- Add data-driven combat poses, target-array `ArenaCamera`, render interpolation, event-batch `CombatAudio`, and sound runtime intent/control.
- Update cards for the new stats.
- Retune the six fighter rows while preserving approved fixture intent.
- Extend `architecture.test.ts` with content-import, duel-identity, and runtime-transcendental bans; add spatial/encounter/capacity tests and the fixed balance cohort; update existing fighter fixtures for renamed fields.
- Update `tests/smoke.spec.ts` helpers that assume a 2700-tick bout limit; add render-rate/hash, reset, reduced-motion, and dev audio-debug coverage.
- Add the informational `benchmark:encounter` script without making elapsed wall time a CI gate.
- Update README architecture, controls, deterministic guarantees, and checks.
- Update/add visual baselines only for intentional combat and stat-card changes.

## Definition of Done

- All goals and player-facing acceptance criteria are met.
- The baseline series fixtures and full deterministic traces pass.
- Cohort pacing and anti-stall bands pass with no stationary cooldown trading.
- The 100-combatant headless FFA, shuffled-input, distant-combatant, multi-threat, spatial-counter, and bounded-event-state fixtures pass.
- All three styles show distinct movement, attacks, defenses, silhouettes, and equipment.
- Simulation remains pure TypeScript and presentation remains rule-free.
- Audio is optional, event-driven, controllable, and failure-safe.
- `npm test`, `npm run build`, `npm run test:e2e`, and `npm run check` pass.
- Intentional screenshot baselines and the human-review artifacts are attached to the implementation PR.
- The PR states the player hypothesis and contains only this combat-depth hypothesis.
