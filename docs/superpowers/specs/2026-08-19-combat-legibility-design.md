# Combat Legibility — Design

## Context

The readable-deep-combat slice shipped a deterministic encounter kernel, a
procedural rig, a pose controller, a framing camera, and optional audio. Its
human review gate was never run by two outside reviewers, but the project owner
watched the shipped build and reported three defects:

1. both fighters read as facing the viewer rather than each other;
2. movement looks jerky;
3. the log never says *why* a fighter chose an action.

All three were reproduced by measurement before any design work. This document
covers the fixes. It is a presentation-and-tooling slice: the simulation is not
touched, and the frozen `traceHash` is the guard that proves it.

## Measured diagnosis

Every number below comes from the shipped `main` at `155c31b`, seed
`20260815`, over whole bouts of all nine ordered style pairings.

### The simulation's facing is correct; the camera cannot show it

Each fighter's facing was compared against the direction to its opponent every
tick. Maximum deviation across a full heavy-vs-fast bout is **25.6°**, and the
typical value is under **1°**. The simulation turns fighters toward each other
correctly and keeps them there. `ArenaView` also applies that facing correctly
(`root.rotation.y = atan2(facing.x, facing.z)`), and the rig's forward axis is
genuinely local `+Z`: limbs are offset along local X, and `hitCenter` and
`shieldCenter` are offset along `+Z`.

What fails is framing. The camera holds a yaw so the pair's spread axis stays
across the frame, but that yaw is clamped to `±30°` from the arena's home shot
(`MAX_YAW_RADIANS`, `ArenaCamera.ts`). The pair's own axis is not bounded that
way — it rotates freely through the full quarter-turn:

| Pairing (home vs opponent) | Axis beyond the 30° clamp | Beyond 60° |
|---|---|---|
| heavy vs heavy | 0.0% | 0.0% |
| heavy vs technical | 33.3% | 20.2% |
| fast vs fast | 37.5% | 5.5% |
| technical vs fast | 44.1% | 22.6% |
| fast vs technical | 50.1% | 15.0% |
| heavy vs fast | 53.8% | 32.7% |
| fast vs heavy | 58.6% | 36.1% |
| technical vs heavy | 58.7% | 6.2% |
| technical vs technical | 69.4% | 52.5% |

In eight of nine pairings the camera spends between a third and two thirds of
the bout unable to square the pair to the frame, so the view looks *along* the
fighters' own axis: one fighter's back to us, the other's front. The single
clean pairing is heavy vs heavy, where two slow fighters barely circle at all
(16° maximum).

That alone would read as an odd camera. It reads as *"both fighters are facing
the viewer"* because of a second, independent cause: the rig is symmetric front
to back. A box torso, capsule limbs, and a dome helmet look the same from
behind as from the front, so a back view is indistinguishable from a face-on
view. Both causes must be fixed; either one alone leaves the report standing.

### Movement is binary, not jerky-by-reversal

The first suspicion — that fighters thrash between opposing locomotion intents
— is only partly right. Intent switches are rare for heavy and technical
(0.3–0.4/s, at most 3 outright reversals per bout). Fast is genuinely busy:
1.4–1.5 switches/s, 0.3–0.4 reversals/s, and 30–52 heading breaks over 60° per
bout.

The dominant cause is different and affects every style. Counting only steps
large enough to see (over 0.015 units/tick), heavy and technical fighters are
**in motion for just 25–33% of ticks**. The rest of the time they stand. There
is no acceleration model, so velocity changes on the tick after an intent
changes, and the pose layer makes standing worse: the gait blend is weighted by
speed (`speedWeight = clamp01(|velocity| / 0.5)`, `PoseController.ts`), so at
zero velocity the gait contribution vanishes and the fighter collapses into a
static guard stance. There is no idle layer at all. The result is start-stop
motion punctuated by freezes.

### Decisions are not traceable

`EncounterEvent` reports outcomes only: `action-started`,
`action-interrupted`, `defense-started`, `defense-declined`, `defense-failed`,
`attack-missed`, `attack-evaded`, `attack-blocked`, `attack-parried`, and
`movement-intent-changed`. None carries a reason. `combatDecision.ts` builds a
context, filters legal actions, weights the candidates, and rolls — then
discards all of it, emitting only the winner.

## Goals

- The fighters' mutual orientation is readable at every moment of every bout.
- A standing fighter reads as alive rather than frozen.
- Any decision the kernel makes can be inspected: candidates, weights, roll,
  winner, and why the losers were excluded.
- The simulation is unchanged, proven by an unchanged `traceHash`.

## Non-goals

- Imported models or skeletal animation. The procedural rig is what carries
  readability, and replacing it is a later, separate decision.
- An acceleration or inertia model in the simulation. Removing start-stop from
  the *data* means changing `movement.ts`, which breaks the frozen hashes and
  the balance calibration. This slice changes how standing *reads*, not how it
  simulates. Recorded here as an accepted compromise, not an oversight.
- New combat mechanics, perks, or a mass-combat mode.
- Running the human review gate. That still needs two outside reviewers.

## Design

### 1. Camera yaw clamp: 30° → 90°

`MAX_YAW_RADIANS` becomes `90°`. The bound is exact rather than a guess: the
pair-axis offset is an *unsigned* angle between a line and an axis, so it lies
in `0°..90°` by construction. A `±90°` clamp therefore covers every reachable
configuration with nothing left over, and the "beyond the clamp" column above
goes to zero for all nine pairings.

The `5°` dead zone and the `1.5 s` damping time constant stay as they are —
they are what makes the move read as the fight turning rather than the camera
moving. Nothing else about the camera changes: fixed FOV, fixed elevation, the
existing look-target and distance behaviour.

Known risk, to be measured rather than pre-solved: at large angles, slow
damping means the camera visibly lags a quickly rotating pair. If that shows
up, the fix is a **larger dead zone**, not faster damping — a camera that lags
is easier to watch than one that snaps.

### 2. Rig directionality

Three additions to `ProceduralFighter`, all meshes hung on joints that already
exist. The skeleton, the joint list, and the anchor/worn-decoration split are
untouched, so pose fixtures keep working.

- **Visor.** A dark slot across the front hemisphere of the head, giving the
  head an unambiguous front.
- **Chest-versus-back contrast.** A light breastplate on the front of the
  chest, a dark back. This is the one that keeps working when the head is too
  small to read and when the camera is high. It must not compete with the
  existing house colours: the fighters are already told apart by red versus
  blue, so front-versus-back is carried by *value* (light against dark) within
  each fighter's own colour, never by a third hue.
- **Feet.** Meshes on the existing `foot.L` / `foot.R` joints, toes forward.
  Feet read as direction from any angle, including from above, and the legs are
  currently bare capsules that end at the ankle. The grounding layer already
  pins a planted foot to its guard value; the new mesh must sit on the floor
  plane in that pinned pose, so no foot sinks through the sand or floats.

Every addition must be visible at the arena's shipped framing distance, not
only in a close-up. Colour alone is not enough for the visor and the feet:
they carry silhouette as well.

### 3. Idle pose layer

A layer between the style guard stance and the gait cycle: weight shift,
breathing, and a small shuffle. Its amplitude is `1 − speedWeight`, so it
appears exactly when the fighter stops and disappears as it moves — it can
never fight the gait blend for control.

Two hard constraints:

- **Phase comes from the simulation tick, never wall-clock time.** Pose
  baselines and the key-pose fixtures are captured at fixed ticks; a wall-clock
  idle would make every one of them flaky.
- **Phase is offset per combatant id**, so two fighters never sway in unison
  (which reads as a bug, not as life).

Under `prefers-reduced-motion: reduce` the layer is damped to near zero,
consistent with how trails and contact flashes are already handled.

The layer only writes pose joints. It does not touch the root — the existing
rule that presentation may render the root only at
`lerp(previousTick, currentTick, alpha)` is unaffected.

### 4. Decision trace panel (`?debugDecisions=1`)

The panel recomputes decisions from outside the kernel instead of instrumenting
it. This is possible because `combatDecision.ts` is already built from pure
functions — context construction, legal-action filtering, weighting, weighted
selection — and each combatant carries its own RNG state. Given the encounter
snapshot from before a tick, the panel can call the same exported functions and
obtain the same candidates, the same weights, and the same roll.

The consequence that matters: **no simulation file changes.** No new event type,
no new state field, no change to event ordering, no change to how many rolls
are drawn. `traceHash` cannot move, because nothing it folds over exists any
differently.

The approach is self-checking. A test replays a bout, recomputes each decision
externally, and asserts the recomputed winner matches the winner the kernel
actually chose. If the panel ever drifts from the kernel, that test fails —
a debugging tool that silently lies is worse than no tool.

Per decision the panel shows: tick, combatant, every candidate with its weight
as a percentage, the roll that was drawn, the winner, and the exclusion reason
for each rejected candidate (out of range, outside the facing sector, on
cooldown).

The panel follows the conventions the existing debug surfaces already use: it
lives behind a query parameter, is gated on `import.meta.env.DEV`, and is
statically absent from a production build, exactly like `?audioDebug=1` and
`window.__GLADIATOR_TEST__`.

## Module boundaries

| Change | File | Kind |
|---|---|---|
| Yaw clamp | `src/presentation/ArenaCamera.ts` | one constant |
| Visor, chest/back contrast, feet | `src/presentation/ProceduralFighter.ts` | meshes on existing joints |
| Idle layer | `src/presentation/PoseController.ts`, `src/presentation/poses/` | new pose layer |
| Decision panel | `src/main.ts` plus a new presentation/dev module | dev-only, reads exported pure functions |
| Nothing | `src/simulation/**`, `src/content/**` | unchanged, enforced by `traceHash` |

## Acceptance

- **Orientation.** Across all nine ordered pairings at the baseline seed, the
  share of ticks where the *desired* yaw is cut by the clamp is `0%`. This is
  the precise criterion, and it is the one to test. It is deliberately not
  "the axis is across the frame on every tick": the dead zone and the `1.5 s`
  damping mean the camera trails a rotating pair by design, and demanding an
  exact instantaneous framing would be demanding that the damping be removed.
- **Directionality.** At the shipped framing distance, front and back views of
  a fighter are distinguishable in a still frame — checked on the regenerated
  screenshot baselines.
- **Idle.** With velocity at zero, the sampled pose differs between consecutive
  ticks; under reduced motion it does not; two fighters standing at the same
  time are out of phase; at full speed the idle contribution is zero.
- **Trace fidelity.** For a full bout, every externally recomputed decision
  matches the kernel's actual choice.
- **Simulation untouched.** `traceHash` equals `dc635911`, the value frozen in
  `battle.test.ts` and cross-checked from Chromium in
  `tests/combat-visuals.spec.ts`. This is the slice's boundary condition: if it
  moves, the work went out of scope.

## Checks

`npm test` for the new unit tests (camera clamp across 0–90° axis offsets, the
idle layer's four properties, decision-recompute fidelity), then
`npm run test:e2e` with regenerated screenshot baselines for both `win32` and
`linux` — the Linux set through the container recipe in `AGENTS.md`, since CI
compares against it. Every regenerated PNG is reviewed by eye before commit.

## Work order

1. Camera yaw clamp — loudest defect, smallest change.
2. Rig directionality — the other half of the same defect.
3. Idle layer.
4. Decision trace panel.

Baselines are regenerated once, after step 3, so the same PNGs are not
rewritten three times.
