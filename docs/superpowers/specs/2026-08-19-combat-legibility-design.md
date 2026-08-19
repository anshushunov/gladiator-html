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
covers the fixes. It is a presentation-and-tooling slice: combat *behaviour* is
frozen, and the frozen trace hashes are the guard that proves it.

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
the viewer"* because of a second, independent cause: the rig is near-symmetric
front to back. A box torso, capsule limbs, a dome helmet and a Z-centred foot
box look much the same from behind as from the front, so a back view is hard to
tell from a face-on view. Both causes must be fixed; either one alone leaves
the report standing.

### The desired yaw is discontinuous

`measureSpreadAxisAngle` returns `0.5 * atan2(2·cov, varX − varZ)`, which lands
in `(−90°, +90°]`. A spread axis has period `180°`, so `θ`, `θ + 180°` and
`θ − 180°` all name the same axis — and as the pair rotates past the frame
vertical, the value falls off one end of that interval and reappears at the
other. The desired yaw jumps by nearly half a turn.

Measured: **2 to 4 jumps of 179° per bout** in three of the nine pairings, and
the pair spends up to **36% of ticks within 10° of that boundary**. Today's
`±30°` clamp hides the jump by squashing both ends into one narrow band.
Widening the clamp without fixing the discontinuity would put the defect on
screen: `yawReference` compares a plain difference, so a near-180° change blows
straight through the `5°` dead zone, and the `1.5 s` damping then walks the
camera through `yaw = 0` — which points it directly along the pair's axis, the
exact framing this slice exists to remove.

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
context, filters legal candidates, weights them, and rolls — then discards all
of it, emitting only the winner.

## Goals

- The fighters' mutual orientation is readable at every moment of every bout.
- A standing fighter reads as alive rather than frozen.
- Every decision the kernel makes can be inspected, each in a form honest about
  how that decision was actually reached.
- Combat behaviour is unchanged, proven by unchanged frozen hashes.

## Non-goals

- Imported models or skeletal animation. The procedural rig is what carries
  readability, and replacing it is a later, separate decision.
- An acceleration or inertia model in the simulation. Removing start-stop from
  the *data* means changing `movement.ts`, which breaks the frozen hashes and
  the balance calibration. This slice changes how standing *reads*, not how it
  simulates. Recorded here as an accepted compromise, not an oversight.
- New combat mechanics, perks, or a mass-combat mode.
- Running the human review gate. That still needs two outside reviewers.

## The frozen boundary, stated precisely

"Do not touch the simulation" is the intent; taken literally as "do not edit
any file under `src/simulation/**`" it would force this slice into a worse
design (see "Decision trace", below). The boundary this slice actually holds:

- **Combat behaviour is frozen.** No change to state, event content or
  ordering, the number or order of random draws, or any tick phase's effect.
- **A behaviourally neutral diagnostic seam is allowed** — a channel that
  reports what a phase already computed, without altering it, and that is inert
  unless a caller opts in.
- **Proof is three hashes, not one.** The duel hash `dc635911`
  (`battle.test.ts`), the 100-combatant fixture hash
  (`encounterCapacity.test.ts`), and the Chromium-side duel hash
  (`tests/combat-visuals.spec.ts`) must all be unchanged — *and* unchanged with
  the diagnostic channel switched on, which is a separate assertion from
  unchanged with it off.

An unchanged hash alone does not prove a file was not edited; it proves
behaviour did not change, which is the property that matters here.

## Design

### 1. Camera yaw: continuity first, then a wider clamp

Two changes, in this order. The order is not stylistic — widening the clamp
without fixing continuity ships a regression.

1. **Continuity.** Before clamping, resolve the axis to whichever
   representative (modulo `180°`) is nearest the yaw the camera already holds.
   Measured effect: the largest tick-to-tick change in the desired yaw drops
   from `179°` to between `0.6°` and `10.2°` across all nine pairings.
2. **Clamp to `±90°`.** With continuity in place, the peak offset from the home
   shot never exceeds `90°` in any pairing (`16°`–`90°` measured), because the
   axis oscillates rather than winding. The clamp still bounds how far the
   camera may leave home, and it now degrades by holding at the limit instead
   of flipping to the far side of the arena.

Because the unwrapped angle is re-clamped every tick it cannot accumulate: the
camera never winds around the arena, which the naive "just follow the axis"
variant would do — measured at up to `981°` of accumulated travel in a
34-second fast-vs-fast bout.

Two hazards to handle explicitly rather than discover later:

- **Degenerate covariance.** At exactly coincident or exactly symmetric
  positions the covariance is zero and the branch is numerically unstable. A
  group whose targets are merely a hair apart (float noise, not a real
  spread) is the harder case: both `atan2` inputs are near zero but not
  exactly zero, so their ratio is ill-conditioned and can land anywhere in
  range depending on noise in the last few bits of each coordinate. The
  unwrap must not turn that noise into a reference flip, so degeneracy is
  detected on total variance against an epsilon, not on the angle being
  exactly `0`, and the camera holds its previous unclamped yaw reference
  rather than computing anything from a meaningless angle.
- **Reference tracking.** `yawReference` currently compares a plain difference.
  It must compare against the *unwrapped* desired yaw, or the dead zone will
  keep seeing phantom near-180° changes.

**This replaces an existing guarantee, and that is in scope.**
`ArenaCamera.test.ts` currently asserts `yaw === −30°` for an axis at 80°,
under the name *"clamps to 30 degrees, so an axis pointing at the camera never
swings the shot around the fight"*. That test encodes the old policy and will
fail. It is rewritten, not deleted: the property worth keeping — the camera
never crosses to the other side of the fight — is now guaranteed structurally
by the unsigned axis plus nearest-representative unwrap, and gets its own test.

The `5°` dead zone is unchanged. Fixed FOV, fixed elevation, existing
look-target and distance behaviour are unchanged.

A later amendment measured on-screen framing error directly and found the
opposite of the intuition recorded here: the `1.5 s` damping constant was
the lever, not the dead zone. Tightening the dead zone to `2°` moved the
30°-error figure only from 1.5% to 1.3%, while tightening damping to `0.5 s`
moved it from 11.2% to 1.5%. The damping constant is **not** unchanged — see
the amendment in `2026-08-16-readable-deep-combat-design.md` for the measured
tuning sweep and the rejected lag-cap alternative.

### 2. Rig directionality

Three changes in `ProceduralFighter`, all on joints that already exist. The
skeleton, the joint list, and the anchor/worn-decoration split are untouched.

- **Visor.** A dark slot across the front hemisphere of the head, giving the
  head an unambiguous front.
- **Chest-versus-back contrast.** A light breastplate on the front of the
  chest, a dark back. This is the one that keeps working when the head is too
  small to read and when the camera is high. It must not compete with the
  existing house colours: fighters are already told apart by red versus blue,
  so front-versus-back is carried by *value* (light against dark) within each
  fighter's own colour, never by a third hue.
- **Feet — modify, do not add.** `buildLeg` already creates `foot.L`/`foot.R`
  and already hangs a box of `body.footLength` on each. The defect is that this
  box is centred on Z, so it reads the same forwards and backwards. The fix is
  to bias the existing box forward (or give it a toe cap), *not* to add a
  second mesh — a second overlapping mesh would double the volume and make the
  floor contact harder to guarantee.

All three must be legible at the arena's shipped framing distance, not only in
a close-up. Colour alone is not enough for the visor and the foot: they carry
silhouette too.

### 3. Idle pose layer

A layer adding weight shift, breathing, and a small shuffle when a fighter is
standing. The naive form of this fights three existing systems, so its scope is
bounded up front.

**When it applies.** Only when the fighter is in a neutral, un-staggered,
living state. Speed alone is the wrong gate: a fighter is also motionless
during a stationary windup, contact, impact, stagger, and defeat, and breathing
through those would corrupt held action poses — including the fixture that
asserts an impact pose is identical across ticks. Action, defense, stagger and
defeat overlays fully suppress the layer.

**How it blends.** Amplitude rises as `1 − speedWeight`, but that alone does
not prevent a fight with the gait layer at intermediate speeds, where both are
non-zero and may write the same joints. The layer therefore either owns a
disjoint joint set or crossfades against gait explicitly; partial-speed
behaviour is tested, not assumed.

**Grounding wins.** The grounding layer runs after and pins a planted foot back
to its guard value. A shuffle written into a planted leg is silently erased.
The layer's leg contribution must be defined in terms of the *unplanted* leg,
or the shuffle must be dropped and the layer restricted to torso and arms.

**Phase source.** Interpolated simulation time —
`previousTick`, `currentTick` and the existing render `alpha` — not the integer
tick. An integer-tick phase would step at 60 Hz instead of moving smoothly, and
wall-clock time would make every fixed-tick pose baseline flaky. Phase is
offset per combatant id so two standing fighters never sway in unison.

**Reduced motion.** Exactly zero, not "near zero". The acceptance criterion is
that the pose is *identical* between ticks under
`prefers-reduced-motion: reduce`, and "near zero" would fail it.

The layer writes pose joints only; it never touches the root, so the existing
rule that presentation may render the root only at
`lerp(previousTick, currentTick, alpha)` is unaffected.

### 4. Decision trace (`?debugDecisions=1`)

**The external-recompute approach was considered and rejected.** It looked
attractive — `combatDecision.ts` is built from pure functions, and each
combatant carries its own RNG state, with the decision stream separate from the
contact stream — but it does not survive contact with the tick order. Phase 4
does not receive the state a caller can snapshot before the tick; it receives
the state left by phase 1 (expired-phase transitions), phase 2 (cleanup and
forced behaviours) and phase 3 (pre-movement spatial hash and target refresh).
A target that entered recovery in phase 1 changes the candidate weights in
phase 4. Reproducing that outside the kernel means reproducing a third of the
tick in the presentation layer — a second copy of the game rules that would
drift from the first. Rejected on that basis.

**Instead: a behaviourally neutral diagnostic seam.** Phase 4 returns the
explanation it already computed, through an optional collector supplied by the
caller. Absent a collector nothing is allocated and nothing changes; the
explanation never enters `EncounterState` or the event log, so no hash folds
over it. The three-hash proof above covers this, including the assertion that
hashes are identical with the collector attached.

**Not every decision is a weighted roll, and the panel must not pretend
otherwise.** Four distinct paths reach an action, and each gets its own record
shape:

| Path | What is shown |
|---|---|
| Weighted phase-4 decision | candidates with weights, the roll, the winner |
| Deterministic fallback | that the candidate set was empty or degenerate, and what was chosen instead |
| Forced behaviour (Fast disengage, Technical parry-counter) | which behaviour fired and its trigger — no roll happens |
| Defense reaction | the reaction roll and its outcome, from the defense batch, not from phase 4 |

**Exclusion reasons must match the real gates.** The gates on an attack
candidate are: the forced-action tag, `startMaxRange` against current distance,
`contactRange.min` against the farthest reachable contact, and
`contactRange.max` against distance minus `rootTravel`. There is no
facing-sector gate and no cooldown at candidate-selection time — an earlier
draft of this document invented both. Locomotion candidates have their own
gates: burst and backstep range, circle-facing capability, the arena path
filter, and anti-stall suppression. Each reason is emitted where its gate is
applied; nothing is inferred after the fact.

The panel follows existing debug conventions: query-parameter gated,
`import.meta.env.DEV` only, statically absent from production, exactly like
`?audioDebug=1` and `window.__GLADIATOR_TEST__`. Its history clears on each new
bout and on rematch.

## Module boundaries

| Change | File | Kind |
|---|---|---|
| Yaw unwrap, widened clamp, reference tracking | `src/presentation/ArenaCamera.ts` | new pure helper plus constant |
| Visor, chest/back contrast, forward-biased foot | `src/presentation/ProceduralFighter.ts` | geometry on existing joints |
| Idle layer | `src/presentation/PoseController.ts`, `src/presentation/poses/` | new pose layer |
| Decision panel | `src/main.ts` plus a new dev-only presentation module | reads the diagnostic collector |
| Diagnostic collector | `src/simulation/encounter.ts` | opt-in, inert when absent, behaviour frozen |
| Nothing | `src/content/**`, rest of `src/simulation/**` | unchanged |

## Acceptance

- **Yaw continuity.** Across all nine pairings at the baseline seed, the
  desired yaw never changes by more than `15°` between consecutive ticks
  (measured worst case after the fix: `10.2°`). Additionally, synthetic
  sequences crossing the boundary — `89° → 90° → 91°`, the reverse, and jitter
  around zero covariance — produce no reference flip.
- **On-screen framing error.** Per tick, the angle between the camera's
  screen-horizontal axis and the pair axis, normalised modulo `180°`, is
  reported over whole bouts, with dead-zone and damping lag distinguished from
  discontinuity. This — not "the clamp never clipped" — is the criterion that
  tracks the original complaint. Clipping is kept as secondary diagnostics.
- **Directionality.** Dedicated front-view and back-view fixtures of the same
  fighter at the shipped framing distance are visibly distinguishable, on both
  OS baseline sets.
- **Idle.** Standing in a neutral state, the pose differs between consecutive
  ticks; under reduced motion it is identical; two fighters standing
  simultaneously are out of phase; at full speed the idle contribution is zero;
  during action, stagger and defeat overlays it is fully suppressed; a planted
  foot is unmoved.
- **Decision trace.** Every decision a bout makes is recorded under one of the
  four record shapes, with exclusion reasons drawn from the real gates.
- **Behaviour frozen.** All three hashes unchanged, both with the diagnostic
  collector attached and without it.
- **Production cleanliness.** A production preview with `?debugDecisions=1`
  renders no panel and exposes no hooks.

## Checks

`npm test` for the new unit tests: yaw continuity across the wrap boundary and
over recorded bouts, the rewritten camera-side test, foot geometry (single
assembly, correct parent, positive forward-Z extent, lowest point on the floor
plane, disposal), the idle layer's suppression and blending properties, and
decision-trace coverage.

`npm run test:e2e` with regenerated screenshot baselines for both `win32` and
`linux` — the Linux set through the container recipe in `AGENTS.md`, since CI
compares against it. Every regenerated PNG is reviewed by eye before commit.
New fixtures: the front/back pair, and a `?debugDecisions=1` dev case plus a
production-preview case asserting its absence.

**Static screenshots cannot catch this slice's defects.** A camera flip, a
stepped idle, and damping lag are all motion artefacts. Before handoff,
re-record at least the representative `×1` clips with `npm run review:clips`
and watch the vertical-axis crossings, the start/stop rhythm and the idle. This
is ordinary developer verification, not the two-reviewer human gate, which
remains out of scope.

## Work order

1. Camera yaw — unwrap and reference tracking first, clamp widening second,
   rewriting the old 30° test as part of the same step.
2. Rig directionality.
3. Idle layer.
4. Diagnostic collector, then the panel on top of it.

Baselines are regenerated once, after step 3, so the same PNGs are not
rewritten three times. Clips are re-recorded and watched after step 4.
