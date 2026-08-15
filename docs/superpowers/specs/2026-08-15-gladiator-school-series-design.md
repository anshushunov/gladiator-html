# Gladiator School Series — MVP Design

**Status:** approved in design discussion  
**Date:** 2026-08-15

## Context

The repository already contains a deterministic two-fighter battle prototype, a Three.js arena, a short runtime loop, unit tests, and a Playwright visual smoke test. The prototype proves the development loop but gives the player no meaningful management decision and always starts from a single fixed matchup.

This slice turns that prototype into a complete school-management loop while deliberately keeping combat shallow. The resulting structure must let later combat experiments change simulation rules and presentation without rewriting the series flow.

## Product hypothesis

A player can feel like the owner of a gladiator school when they win a short series by assigning a limited roster to known opponents before any fights begin.

The MVP tests one management decision only: distributing three distinct gladiators across three visible matchups. It does not test recruitment, training, economy, equipment, injuries, or campaign progression.

## Goals

1. Deliver a complete loop: plan three matchups, watch all three bouts, see the school result, review the choices, and retry.
2. Make the player's initial assignment consequential by allowing each gladiator to fight exactly once.
3. Make matchup logic legible through an explicit archetype counter triangle.
4. Keep the series and battle simulations deterministic for a given input and seed.
5. Establish a narrow contract between combat simulation and Three.js presentation for later visual and mechanical experiments.

## Non-goals

- Recruitment, dismissal, training, currency, equipment, injuries, persistent progression, saving, or a campaign.
- Final combat balance or a production-ready combat ruleset.
- Skeletal animation, imported character assets, physics, abilities, combos, audio, particles, dynamic cameras, or post-processing.
- Performance benchmarking or determining the final visual limits of the browser and Three.js. Those are separate combat spikes after this slice.

## Player flow

### 1. Planning

The planning screen shows all three home gladiators and all three opponents. Opponents appear in the fixed order in which their bouts will run. Every card shows the fighter's name, school, archetype, and compact combat statistics.

The counter rule is always visible:

`heavy → fast → technical → heavy`

The player selects a home fighter and then an opponent slot. Assigning an already assigned fighter moves that fighter and clears the old slot. Assigning into an occupied slot returns the displaced fighter to the available roster. Drag-and-drop is not required; the complete flow must work with click or keyboard activation.

The confirmation control remains disabled until all three opponent slots contain three unique home fighters.

### 2. Locked series

Confirming the lineup locks all assignments and immediately starts the first bout. The player cannot change the lineup until the series ends.

All three bouts run in the opponents' displayed order. After the first and second bouts, an interstitial shows the bout winner and current series score. The player explicitly starts the next bout so the result remains readable. The third bout is always played, including after a 2–0 score.

The existing pause control remains available during an active bout. Pausing is runtime presentation state and does not alter deterministic simulation state.

### 3. Summary and rematch

After the third bout, the summary shows:

- the final score;
- school victory for 2–1 or 3–0, otherwise school defeat;
- the winner of each matchup;
- whether the home fighter had archetype advantage, neutrality, or disadvantage.

Every bout has exactly one winner, so the series cannot draw.

Selecting **Rematch** returns to planning with the same home roster, opponent roster, opponent order, and series seed. Assignments and bout results are cleared. This lets the player compare a different lineup under identical random conditions.

## Combat scaffold

### Fighter definition

A fighter definition contains:

- stable ID, display name, and school name;
- archetype: `heavy`, `fast`, or `technical`;
- maximum health;
- base damage;
- attack interval;
- accuracy;
- block chance;
- critical-hit chance.

Movement speed and attack range remain battle-level tuning constants in this slice. Fighter definitions are immutable content; mutable health, position, cooldown, and status belong to battle state.

### Archetype advantage

The triangle is implemented by one pure comparison function. Damage uses these initial tuning multipliers:

- advantage: `1.25`;
- neutral: `1.0`;
- disadvantage: `0.8`.

These values are centralized simulation constants, not final balance commitments. Presentation receives the comparison result and never recomputes it.

### Attack resolution

When an attack becomes ready, the simulation performs seeded checks in this order:

1. Accuracy decides whether the attack hits.
2. On a hit, the defender's block chance decides whether damage is halved.
3. If the attack is not blocked, the attacker's critical chance decides whether damage is multiplied by `1.5`.
4. Damage is multiplied by archetype advantage and rounded to the nearest integer, with a minimum of one damage for a successful hit.

If both attacks become ready at the same simulation time, the shorter attack interval acts first. Equal intervals use a seeded tie-break. Once one fighter is defeated, the other fighter does not execute an attack scheduled for that same instant.

A bout has a 45-second simulation limit. At the limit, the higher remaining-health ratio wins. An exact ratio tie uses a seeded tie-break. There is no draw state.

### Randomness and reproducibility

Randomness uses a small pure seeded PRNG whose internal state is stored in `BattleState`. No simulation module calls `Math.random()`.

The series has one seed. Each bout seed is derived from the series seed and the opponent's fixed bout index, not from lineup assignment order or prior combat consumption. A rematch therefore gives each opponent slot the same random sequence as before.

### Structured events

Battle events are data, not presentation messages. Each event has a monotonically increasing ID, simulation timestamp, type, and the relevant actor, target, and numeric amount when applicable.

The initial event vocabulary is:

- `bout-started`;
- `approach-started`;
- `attack-started`;
- `attack-missed`;
- `attack-blocked`;
- `damage-dealt`;
- `critical-hit`;
- `fighter-defeated`;
- `bout-finished`.

The battle feed derives human-readable text from these events. `ArenaView` may use the same events for short visual reactions. Simulation never stores English UI copy or animation timing.

## Series state machine

The pure series state uses four phases:

- `planning` — assignments may be changed;
- `fighting` — one `BattleState` is active;
- `between-bouts` — the latest result and score are visible;
- `summary` — all three results are final and rematch is available.

The series owns the locked lineup, active bout index, active battle, completed bout results, score, and series seed. It delegates combat stepping to `battle.ts`.

User commands return a typed result containing the next state and either success or a reason code. Invalid user actions, such as confirming an incomplete lineup or trying to edit a locked lineup, preserve the previous state. Unknown IDs in static content and impossible internal states are developer errors covered by tests rather than recoverable UI states.

## Module boundaries

### `src/simulation/`

- `random.ts` owns the seeded PRNG and bout-seed derivation.
- `fighters.ts` owns fighter types, archetypes, and the counter comparison.
- `battle.ts` owns creation and fixed-step advancement of one parameterized bout.
- `series.ts` owns assignments, phases, score, rematch, and delegation to the active bout.

This directory must not import DOM or Three.js code.

### `src/content/`

- `mvpSeries.ts` exports the three home definitions, three opponent definitions, their fixed order, and the default series seed.

Content contains data only and no state transitions or presentation behavior.

### `src/presentation/`

- `ArenaView.ts` renders the active battle state and consumes unseen structured battle events.
- `SeriesView.ts` renders planning, interstitial, and summary UI and emits typed user intents.

`ArenaView` tracks the last presented event ID locally. Visual state such as attack-lunge progress, hit flashes, and camera motion is presentation-only and cannot feed back into combat results.

### `src/main.ts`

The runtime creates the series, accepts user intents, advances the active series at the existing fixed timestep, and synchronizes `SeriesView` and `ArenaView`. It must remain orchestration code rather than a home for game rules.

## Minimal presentation scope

The existing arena and primitive fighter meshes remain. The current slice adds only:

- approach movement;
- a short attack indication;
- a visible damage reaction;
- defeated-fighter fall;
- health updates and an event-derived battle feed.

Planning and summary use semantic HTML and CSS. The application remains a single page with no UI framework or client-side router. Controls must remain keyboard-operable, and the existing responsive layouts must continue to work at their current breakpoints.

## Future combat spikes

Later work should use one hypothesis per slice and PR:

1. Procedural motion readability with primitive models.
2. Skeletal animation and imported models.
3. Particles, lighting, shadows, and post-processing.
4. Dynamic camera behavior without losing combat readability.
5. Performance budgets for weak desktop and mobile hardware.

Each spike may extend battle events only when the visual experiment requires new simulation data. A visual-only experiment changes presentation without changing `series.ts`.

## Testing strategy

### Unit tests

Tests under `src/simulation/` verify:

- identical PRNG seeds produce identical sequences;
- bout-seed derivation is stable per fixed opponent index;
- the counter triangle gives every archetype exactly one advantage and one disadvantage;
- identical battle inputs and seeds produce identical states and events;
- a battle always finishes within the 45-second limit and has one winner;
- assignment movement and displacement preserve uniqueness;
- an incomplete lineup cannot be confirmed;
- a confirmed lineup cannot be edited;
- exactly three bouts are recorded before summary;
- the score matches the three bout winners;
- rematch preserves content and seed while clearing assignments and results.

### End-to-end tests

Playwright verifies that:

1. Planning loads with all six fighters and disabled confirmation.
2. Click or keyboard activation can create all three assignments.
3. Confirmation starts the locked series.
4. A test hook advances simulation without real-time waits.
5. All three bout results and the final score appear.
6. Rematch returns to empty planning with unchanged opponents.
7. The intentional planning-screen appearance matches the updated screenshot baseline.

Real-time timing is not used as a test assertion. The test hook manipulates simulation through public state transitions rather than directly editing internal state.

### Required checks

- Simulation changes: `npm test`
- UI and rendering changes: `npm run test:e2e`
- Intentional visual baseline change: `npm run test:e2e:update`
- Before handoff: `npm run check`

## Definition of Done

The slice is complete when:

- a player can complete planning, three bouts, summary, and rematch without reloading;
- each home gladiator is used exactly once per series;
- all opponents and matchup information are visible before confirmation;
- results are reproducible for identical assignments and seed;
- the summary explains archetype advantage for every pair;
- changing combat presentation cannot change simulation results;
- replacing internal single-bout rules does not require changing the series state machine;
- all required checks pass.

