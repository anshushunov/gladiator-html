# Gladiator School Series — MVP Design

**Status:** approved after spec and implementation-plan review

**Date:** 2026-08-15

**Review source:** `2026-08-15-gladiator-school-series-design.review.md`

## Terminology

- **Matchup** — one planned pairing of a home fighter and an opponent.
- **Bout** — the simulated fight that resolves one matchup.
- **Series** — the ordered set of all three bouts and their aggregate score.

## Context

The repository already contains a deterministic two-fighter battle prototype, a Three.js arena, a short runtime loop, unit tests, and a Playwright visual smoke test. The prototype proves the development loop but gives the player no meaningful management decision and always starts from a single fixed matchup.

This slice turns that prototype into a complete school-management loop while deliberately keeping combat shallow. The resulting structure must let later combat experiments change simulation rules and presentation without rewriting the series flow.

## Product hypothesis

A player can understand that their school-management decision changed the outcome when they assign a limited roster to known opponents, watch the resulting three-bout series, and retry the same seeded challenge with a different lineup.

This slice primarily tests decision readability and the plan-versus-result feedback loop. It does not claim long-term strategic depth. The default content is nevertheless tuned so that blindly choosing all three archetype counters is not the winning solution; fighter statistics also matter.

The MVP tests one management decision only: distributing three distinct gladiators across three visible matchups. It does not test recruitment, training, economy, equipment, injuries, or campaign progression.

## Goals

1. Deliver a complete loop: plan three matchups, watch all three bouts, see the school result, review the choices, and retry.
2. Make the player's initial assignment consequential by allowing each gladiator to fight exactly once.
3. Make matchup logic legible through an explicit archetype counter triangle and visible fighter statistics.
4. Keep the series and battle simulations deterministic for a given input, seed, and number of ticks.
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

The arrow means **has archetype advantage against**. The exact relationships are:

| Home archetype | Opponent archetype | Comparison |
| --- | --- | --- |
| `heavy` | `fast` | `advantage` |
| `fast` | `technical` | `advantage` |
| `technical` | `heavy` | `advantage` |

Reversing any listed pair produces `disadvantage`; matching archetypes produce `neutral`.

The player selects a home fighter and then an opponent slot. Assigning an already assigned fighter moves that fighter and clears the old slot. Assigning into an occupied slot returns the displaced fighter to the available roster. Each occupied slot shows `advantage`, `neutral`, or `disadvantage`; this is an aid for reading the rule, not a guaranteed outcome because fighter statistics also matter.

Each occupied slot has a visible remove control. Removing an assignment returns its fighter to the roster. `Escape` clears the current uncommitted fighter selection. Drag-and-drop is not required; the complete flow must work with click, Enter, and Space.

The confirmation control remains disabled until all three opponent slots contain three unique home fighters.

### 2. Locked series

Confirming the lineup locks all assignments and immediately starts the first bout. The player cannot change the lineup until the series ends.

All three bouts run in the opponents' displayed order. After the first and second bouts, an interstitial shows:

- the bout winner and whether the bout ended by defeat or time limit;
- the current series score;
- the next matchup and its archetype comparison.

The player explicitly starts the next bout so the result remains readable. The third bout is always played, including after a 2–0 score, because a complete three-matchup record is required to compare one rematch with another.

The existing pause control remains available during an active bout. A speed control supports `×1`, `×2`, and `×4`. Speed changes how many fixed ticks the runtime advances per unit of real time; it never changes tick size. Pause and speed are runtime presentation state and do not alter deterministic simulation state.

### 3. Summary and rematch

After the third bout, the summary shows:

- the final score;
- school victory for 2–1 or 3–0, otherwise school defeat;
- the winner of each matchup;
- whether the home fighter had archetype advantage, neutrality, or disadvantage;
- whether each bout ended by defeat or by the time limit;
- each fighter's remaining-health percentage, so rematches can be compared beyond win/loss.

Every bout has exactly one winner, so the series cannot draw.

Selecting **Rematch** returns to planning with the same home roster, opponent roster, opponent order, and series seed. Assignments and bout results are cleared. This lets the player compare a different lineup with the same per-slot and per-side random streams. Different fighters may still consume those streams at different ticks because their attack intervals differ; the guarantee is reproducibility from the same complete input, not identical event timing across different lineups.

## Accessibility and focus

- Fighter cards and matchup slots are native buttons or expose equivalent button semantics.
- The selected fighter uses `aria-pressed="true"`; assignment changes are described by a non-live instruction element referenced with `aria-describedby`.
- After an assignment, focus moves to the first unassigned home fighter in roster DOM order; after the third assignment, focus moves to the confirm control.
- Removing an assignment moves focus to the returned fighter card.
- Entering `fighting`, `between-bouts`, `summary`, or returning to `planning` moves focus to that phase's heading, which is programmatically focusable with `tabindex="-1"`.
- The battle feed uses `aria-live="off"`. Only the bout status, interstitial result, and final series result use `aria-live="polite"`, preventing attack-by-attack screen-reader chatter.

## Combat scaffold

### Simulation clock

Simulation time is an integer tick count.

- `TICKS_PER_SECOND = 60`.
- `MAX_BOUT_TICKS = 2700`, equivalent to 45 seconds.
- Attack intervals are positive integer tick counts.
- Seconds are derived as `tick / TICKS_PER_SECOND` for display only.

The battle advances by one tick internally. Public test and runtime helpers may call `advanceSeriesTicks(state, ticks)` to apply multiple identical one-tick transitions. Floating-point elapsed seconds never enter simulation state.

### Fighter definition

A fighter definition contains:

- stable ID, display name, and school name;
- archetype: `heavy`, `fast`, or `technical`;
- maximum health;
- base damage;
- attack interval in ticks;
- accuracy;
- block chance;
- critical-hit chance.

Movement speed and attack range remain battle-level integer or rational tuning constants in this slice. Fighter definitions are immutable content; mutable health, position, next-attack tick, and status belong to battle state.

### Default content

Each roster contains exactly one fighter of each archetype.

| Side | Fighter | Archetype | HP | Damage | Attack interval | Accuracy | Block | Critical | Intent |
| --- | --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | --- |
| Home | Brutus | `heavy` | 360 | 12 | 54 | 0.86 | 0.18 | 0.10 | Reliable front-liner |
| Home | Aquila | `fast` | 240 | 8 | 38 | 0.82 | 0.08 | 0.12 | Fast but deliberately fragile |
| Home | Nerva | `technical` | 345 | 12 | 44 | 0.92 | 0.16 | 0.16 | The school's strongest all-round fighter |
| Away | Drusus | `fast` | 390 | 13 | 36 | 0.90 | 0.12 | 0.15 | Elite opponent intended to absorb a sacrifice |
| Away | Cassius | `technical` | 330 | 11 | 48 | 0.90 | 0.15 | 0.12 | Strong technical opponent |
| Away | Magnus | `heavy` | 288 | 10 | 62 | 0.78 | 0.18 | 0.06 | Vulnerable opponent despite heavy armor |

The fixed opponent order is Drusus, Cassius, Magnus. The baseline test seed is `20260815`.

Content tuning must satisfy these acceptance fixtures for seed `20260815`:

- the all-counter lineup `Brutus→Drusus`, `Aquila→Cassius`, `Nerva→Magnus` loses the series 1–2;
- the mixed lineup `Aquila→Drusus`, `Nerva→Cassius`, `Brutus→Magnus` wins the series 2–1;
- the six possible lineups contain at least three distinct final scores;
- ordinary baseline defeats finish between `840` and `1800` ticks, or 14–30 displayed seconds; the 45-second limit is a safety net.

If the initial numbers do not produce these fixtures under the specified rules, implementation may tune only the six content rows while preserving their stated intent, the one-of-each-archetype invariant, and all four acceptance fixtures.

### Archetype advantage

The triangle is implemented by one pure comparison function. Damage uses these initial tuning multipliers:

- advantage: `1.25`;
- neutral: `1.0`;
- disadvantage: `0.8`.

Presentation receives the comparison result from battle or series state and never recomputes it.

### Randomness and seed lifecycle

Randomness uses a small pure seeded PRNG. No simulation module calls `Math.random()`, `crypto`, or another external random source.

The URL accepts a decimal unsigned 32-bit seed as `?seed=<0..4294967295>`. When the parameter is absent or invalid, `main.ts` generates a seed with `crypto.getRandomValues()` and immediately writes the normalized decimal value into the URL with `history.replaceState`. Simulation receives only the resulting integer.

The bout seed is derived from the series seed and fixed opponent index. Each bout then derives separate `home`, `away`, and `initiative-tie` PRNG streams. Every attack consumes exactly three values from its actor's stream in this fixed order: accuracy, block, critical. Values are consumed even when an earlier check makes a later value irrelevant.

Every equal-interval same-tick initiative tie consumes one value from the separate tie stream and chooses home for a roll below `0.5`, otherwise away. An exact time-limit ratio tie uses its own labelled value derived from the bout seed. Neither mechanism consumes a fighter's attack stream. Rematch preserves the series seed.

### Attack resolution

Before contact, neither fighter has a scheduled attack. When the fighters first enter attack range on tick `T`, each receives `nextAttackTick = T + attackIntervalTicks`; therefore the shorter interval produces the first attack. When an attack becomes ready, the simulation performs the three pre-consumed checks in this order:

1. Accuracy decides whether the attack hits.
2. On a hit, the defender's block chance decides whether damage is halved.
3. If the attack is not blocked, the attacker's critical chance decides whether damage is multiplied by `1.5`.
4. Damage is multiplied by archetype advantage and rounded with JavaScript `Math.round`, so an exact `.5` rounds upward. A successful hit deals at least one damage.

Every probability check succeeds exactly when `roll < probability`. `nextRandom` returns values in `(0, 1)`, so probability `0` never succeeds and probability `1` always succeeds.

Block and critical are mutually exclusive in this scaffold. Because rounding can make low-damage blocked hits visually close to ordinary hits, `attack-blocked` must have a distinct presentation reaction; the exact tuning remains an open combat-spike concern.

If both attacks become ready on the same tick, the shorter attack interval acts first. Equal intervals use the separately derived initiative tie-break. Once one fighter is defeated, the other fighter does not execute an attack scheduled for that tick.

On tick `MAX_BOUT_TICKS`, scheduled attacks resolve first. A defeat on that tick ends the bout with reason `defeat`; otherwise the higher remaining-health ratio wins with reason `time-limit`. An exact ratio tie uses the separately derived time-limit tie-break. There is no draw state.

## Structured battle events

Events are data, not presentation messages. IDs are monotonically increasing **within one bout** and restart when a new `BattleState` is created. Every event contains `id`, `tick`, and `type`; side fields use `home` or `away` rather than fighter IDs.

| Event | Emitted when | Required payload | Battle feed | `ArenaView` |
| --- | --- | --- | --- | --- |
| `bout-started` | Battle state is created | `homeFighterId`, `awayFighterId` | Gates/opening line | Reset-ready opening pose |
| `approach-started` | The first simulation tick that moves fighters toward each other | none | Optional single approach line | Read positions from state; no movement calculation |
| `attack-started` | An actor begins a resolved attack | `actorSide`, `targetSide` | No separate line | Start short lunge indication |
| `attack-missed` | Accuracy check fails | `actorSide`, `targetSide` | Miss line | Miss/recovery reaction |
| `attack-blocked` | Hit is blocked and reduced, not cancelled | `actorSide`, `targetSide` | Combine with the following `damage-dealt` amount | Defender block reaction |
| `critical-hit` | Unblocked hit is critical | `actorSide`, `targetSide`, `multiplier` | Critical emphasis | Strong attack accent |
| `damage-dealt` | Every successful hit, including blocked and critical hits | `actorSide`, `targetSide`, `amount`, `remainingHp` | Damage line unless combined with the immediately preceding block/critical line | Health and hit reaction |
| `fighter-defeated` | Damage reduces health to zero | `defeatedSide`, `winnerSide` | Defeat line | Defeated pose/fall |
| `bout-finished` | Defeat or time limit selects a winner | `winnerSide`, `reason`, `durationTicks` | Final result with reason | Stop combat reactions |

`reason` is exactly `'defeat' | 'time-limit'`.

Canonical same-tick sequences are:

- Miss: `attack-started → attack-missed`.
- Blocked hit: `attack-started → attack-blocked → damage-dealt`.
- Critical defeat: `attack-started → critical-hit → damage-dealt → fighter-defeated → bout-finished(reason='defeat')`.
- Time limit: the last ordinary attack sequence, if any, followed by `bout-finished(reason='time-limit')` at tick `2700`.

`critical-hit` and `attack-blocked` never replace `damage-dealt`. Feed rendering may combine adjacent events from one attack into one sentence, but the underlying event sequence remains unchanged.

`BattleState` retains the complete event log for its bout. The event array is reused on ticks that emit nothing and copied only when appending new events. The visible feed renders only the latest eight display entries; simulation does not truncate its event log.

## Bout result

Series stores this data for every completed bout:

```ts
interface BoutResult {
  boutIndex: 0 | 1 | 2
  homeFighterId: string
  opponentId: string
  winnerSide: 'home' | 'away'
  advantage: 'advantage' | 'neutral' | 'disadvantage'
  endedBy: 'defeat' | 'time-limit'
  durationTicks: number
  remainingHpRatio: { home: number; away: number }
}
```

The active battle state also contains its archetype comparison, allowing presentation to display it without importing counter rules.

## Series state machine and public API

The pure series state uses four phases:

- `planning` — assignments may be changed;
- `fighting` — one `BattleState` is active;
- `between-bouts` — the latest result and score are visible;
- `summary` — all three results are final and rematch is available.

The series owns the locked lineup, active bout index, active battle, completed bout results, score, and series seed. It delegates combat ticks to `battle.ts`.

Selection highlight and keyboard focus are presentation state, not simulation state. `SeriesView` emits an assignment only after it has both a selected fighter and a target slot.

Game-changing commands use this result shape:

```ts
type SeriesCommandFailure =
  | 'lineup-locked'
  | 'lineup-incomplete'
  | 'slot-empty'
  | 'no-bout-pending'
  | 'series-not-finished'

type SeriesCommandResult =
  | { ok: true; state: SeriesState }
  | { ok: false; state: SeriesState; reason: SeriesCommandFailure }
```

| Command | Valid phase | Success | Failure |
| --- | --- | --- | --- |
| `assignFighter(state, homeFighterId, boutIndex)` | `planning` | Moves or displaces assignments | `lineup-locked` outside planning |
| `unassignSlot(state, boutIndex)` | `planning` | Returns fighter to roster | `slot-empty`; `lineup-locked` outside planning |
| `confirmLineup(state)` | `planning` | Locks lineup and enters first `fighting` phase | `lineup-incomplete`; `lineup-locked` outside planning |
| `startNextBout(state)` | `between-bouts` | Creates the next battle and enters `fighting` | `no-bout-pending` otherwise |
| `rematch(state)` | `summary` | Clears assignments/results and enters `planning` | `series-not-finished` otherwise |

Unknown static content IDs and bout indices outside `0..2` are developer errors and throw. All command failures return the exact previous state object. Phase validation happens before state-specific validation: for example, `unassignSlot` outside planning returns `lineup-locked`; `slot-empty` is used only for an empty slot during planning.

`advanceSeriesTicks(state, ticks: number): SeriesState` accepts a non-negative integer. It repeatedly applies one fixed simulation tick only while the series is in `fighting`, stopping early when the bout finishes. The same transition that finishes a battle creates its `BoutResult`, updates the score, and enters `between-bouts` for bouts 0–1 or `summary` for bout 2; there is no separate result-finalization command. A negative or non-integer tick count throws. Outside `fighting`, it returns the exact previous state object.

## Module boundaries

### `src/simulation/`

- `random.ts` owns the seeded PRNG, labelled seed derivation, and bout/side seed derivation.
- `fighters.ts` owns fighter types, archetypes, and counter comparison.
- `battle.ts` owns creation and fixed-tick advancement of one parameterized bout.
- `series.ts` owns assignments, phases, score, rematch, and delegation to the active bout.

This directory must not import DOM or Three.js code.

### `src/content/`

- `mvpSeries.ts` exports the three home definitions, three opponent definitions, and fixed opponent order.

Content contains data only and no state transitions or presentation behavior.

### `src/presentation/`

- `ArenaView.ts` renders the active battle state and consumes unseen structured battle events.
- `SeriesView.ts` renders planning, interstitial, and summary UI and emits typed user intents.

### `src/main.ts`

The runtime parses or creates the URL seed, creates the series, accepts user intents, advances the active series at the existing fixed tick rate, and synchronizes `SeriesView` and `ArenaView`. It remains orchestration code rather than a home for game rules.

## Arena lifecycle and minimal presentation

`ArenaView` owns exactly two reusable fighter groups keyed by side: `home` and `away`. Content fighter IDs never key meshes. Starting a bout calls an explicit `startBout(boutIndex, homeDefinition, awayDefinition)` lifecycle method that:

- resets the per-bout event cursor to before event zero;
- cancels all presentation-only reactions and timers;
- restores both groups to their neutral pose;
- applies an archetype-derived palette to each side; fighter labels remain the responsibility of `SeriesView`;
- synchronizes their initial positions and health.

Entering planning or summary calls `clearBout()`, which resets presentation state and hides the canvas. Planning therefore has a stable HTML/CSS screenshot baseline and does not continuously render Three.js. During `between-bouts`, the arena remains visible in the completed bout's final pose under the interstitial.

`ArenaView` reads positions, health, fighter status, and structured events from simulation. It does not calculate approach movement or damage. Presentation-only behavior in this slice is limited to:

- a short lunge indication from `attack-started`;
- miss, block, and damage reactions;
- a defeated pose/fall;
- event-derived feed copy.

The current primitive fighter meshes and arena remain. There is no UI framework or client-side router.

## Browser test hook

The battle-level `window.__GLADIATOR_TEST__` contract is replaced by a series-level contract:

```ts
interface GladiatorTestApi {
  getState(): SeriesState
  assign(homeFighterId: string, boutIndex: 0 | 1 | 2): TestCommandResult
  unassign(boutIndex: 0 | 1 | 2): TestCommandResult
  confirm(): TestCommandResult
  advanceTicks(ticks: number): void
  startNextBout(): TestCommandResult
  rematch(): TestCommandResult
}

type TestCommandResult = { ok: true } | { ok: false; reason: SeriesCommandFailure }
```

Each mutating wrapper updates the runtime's current series state from the public transition result but returns only the slim `TestCommandResult`; `getState()` is the only method that returns a structured clone. Playwright uses an explicit `?seed=20260815` and never waits on wall-clock combat timing.

## Migration and breaking changes

This slice intentionally replaces the prototype entry flow rather than merely adding to it:

- `FighterId = 'red' | 'blue'` is replaced by stable content IDs plus the presentation sides `home | away`.
- `createBattle()` becomes parameterized with two fighter definitions and a bout seed.
- The optional winner and mutual-defeat branch are removed from `battle.ts`; every bout has one winner.
- The `Draw` branch is removed from `main.ts`.
- Hard-coded Brutus/Cassius cards and red/blue health selectors in `index.html` are replaced by planning, active-bout, interstitial, and summary containers.
- The old battle-level `window.__GLADIATOR_TEST__` is replaced by the series-level contract above.
- `src/simulation/battle.test.ts` is rewritten around parameterized definitions and ticks.
- `tests/smoke.spec.ts` starts from planning instead of expecting `READY` on the arena.
- `tests/__screenshots__/arena.png` is removed and replaced by `tests/__screenshots__/planning.png`, generated intentionally with `npm run test:e2e:update`.
- `README.md` is updated after implementation to describe the school-series loop, URL seed, controls, and next combat-spike roadmap.

`AGENTS.md` requires no change: its simulation/presentation boundaries and one-hypothesis-per-PR rule already match this design.

## Future combat spikes

Later work uses one hypothesis per slice and PR:

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
- each attack consumes exactly three values from its actor's stream;
- one side's random consumption cannot shift the other side's stream;
- equal-interval initiative ties consume only the separate tie stream;
- bout and labelled tie-break seed derivation is stable;
- `compareArchetypes('heavy', 'fast')` is exactly `advantage`, plus the other two explicit winning pairs and all reverse/neutral pairs;
- the default content has three fighters per side and exactly one of each archetype;
- the same successful attack deals strictly increasing damage for disadvantage, neutral, and advantage;
- blocked disadvantage damage with a low base still deals the one-damage minimum;
- identical battle inputs, seeds, and tick counts produce identical states and events;
- a defeated fighter does not attack later in the same tick;
- 200 seeds across all nine archetype pairings finish by tick 2700 with exactly one winner;
- assignment movement, displacement, and removal preserve uniqueness;
- incomplete lineups cannot be confirmed and locked lineups cannot be edited;
- exactly three bouts are recorded before summary;
- score and `BoutResult` fields match the three battle outcomes;
- rematch preserves content and seed while clearing assignments and results;
- the two baseline lineups produce their specified 1–2 and 2–1 outcomes at seed `20260815`;
- all six lineups contain at least three distinct final scores and the two baseline runs finish their bouts within `840..1800` ticks.

A small architecture-guard test scans non-test files under `src/simulation/` and fails on imports of `three`, references to `document` or `window`, and DOM element types. This makes the project boundary mechanically verifiable.

### End-to-end tests

Playwright verifies that:

1. `/?seed=20260815&snapshot` loads planning with all six fighters and disabled confirmation.
2. Click and keyboard flows can assign, unassign, clear selection, and create three valid matchups.
3. Assignment badges show the simulation-provided archetype comparison.
4. Confirmation starts the locked series and resets the arena for every bout.
5. The test hook advances ticks without real-time waits.
6. Both interstitials show the previous result, score, and next matchup.
7. All three `BoutResult` entries and the final score appear in summary.
8. Rematch returns to empty planning with unchanged opponents and seed.
9. The hidden-canvas planning screen matches the intentionally updated screenshot baseline.
10. A direct lifecycle test starts two bouts and confirms that second-bout events and reactions are consumed after the per-bout event cursor reset.

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
- all opponents, statistics, and matchup information are visible before confirmation;
- the default all-counter lineup loses 1–2, the specified mixed lineup wins 2–1, and all six lineups contain at least three distinct scores at seed `20260815`;
- results are reproducible for identical assignments, seed, and tick count;
- the summary explains archetype comparison and completion reason for every bout;
- all four series phases follow the specified focus and live-region behavior;
- second and third bouts start with reset meshes, event cursors, and presentation reactions;
- the mutual-defeat and UI `Draw` branches no longer exist;
- changing combat presentation cannot change simulation results;
- replacing internal single-bout rules does not require changing the series state machine;
- README and the intentional Playwright baseline describe the new entry flow;
- all required checks pass.

## Open questions and known tuning risks

There are no blocking design questions for this slice. The following are intentionally deferred tuning risks:

- exactly one of the six current lineups wins; if playtesting shows that the loop is exhausted in one session, making a second lineup viable is the first content-tuning candidate;
- blocked low-damage hits need a visually distinct reaction even when rounded damage is close to an ordinary hit;
- speed-control feel and the 14–30 second target may be tuned without changing simulation tick size;
- richer combat event vocabulary is added only by a later approved combat-spike design.
