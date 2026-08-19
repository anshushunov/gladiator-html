# School Season Meta-Loop — MVP Design

**Status:** approved for implementation

**Date:** 2026-08-19

## Terminology

- **Season** — the whole session: three series played in a fixed order against three pre-authored challenges, ending in a season summary.
- **Series** — the existing three-bout unit (`src/simulation/series.ts`): one lineup, three bouts, one series summary.
- **Challenge** — the opponent trio a series is played against, plus that series' escalation multiplier.
- **Roster** — the five home gladiators owned by the school for the whole season.
- **Condition** — a gladiator's accumulated wear on a four-step ladder; it decides the HP that gladiator starts a bout with and whether they can fight at all.
- **Rest** — a series in which a gladiator fought no bout.
- **Forfeit** — a bout slot with no fightable gladiator: it is scored as a loss and no battle is simulated.

## Context

Three slices are merged: the school series MVP (#2), readable deep combat (#3), and combat legibility (#11). The combat kernel is deterministic, frozen behind a trace hash, and legible enough to be watched. The game around it is not: a session is one lineup decision — three gladiators onto three visible opponents — followed by three bouts and a summary. The `Rematch` button replays the same challenge with the same seed.

That single decision is close to solved. The MVP design review recorded it as blocker `B1`: six permutations, one of which dominates, evaluated once per session. Nothing carries between bouts, so choosing the best matchup for bout 1 costs nothing anywhere else.

This slice adds the first meta-layer: consequences that outlive a bout, and a roster larger than the number of slots, so the lineup decision is repeated under a changing constraint.

## Product hypothesis

A player will keep making the lineup decision when a gladiator's condition carries across series and the roster is larger than the three slots, because the best available matchup now costs a resource that a later challenge will need.

The slice tests two qualities:

1. **Cost:** committing a gladiator to a favourable matchup is visibly paid for later.
2. **Tension:** at least one series in a normal season forces a lineup the player would not have chosen with a fresh roster.

This is a decision-depth hypothesis, not a content-breadth hypothesis. No economy, no hiring, no perks.

## Goals

- A season of three series (nine bouts) played from a single seed.
- A five-gladiator roster whose members carry condition across series.
- Condition visibly changes the bout: a worn gladiator enters the arena with a partly filled HP bar, before the first exchange.
- Rest is the only way to recover, and it costs the bouts the rested gladiator did not fight.
- A season always reaches nine results, including forfeits.
- Full determinism preserved: the same seed and the same lineups reproduce the same season, and the existing frozen combat traces stay byte-identical.

## Non-goals

- Perks, skills, or `combatSkill` progression (roadmap item 2, a separate slice).
- Economy, hiring, equipment, or permanent death.
- Player choice between challenges: the three challenges are fixed and visible from the start.
- Persistence across page reloads. A season lives in memory; `?seed=` reproduces it.
- Mass combat, imported models, performance budgets.
- Visual wound representation on the rig. Condition is communicated through UI and the starting HP bar only.

## Player-facing acceptance

1. From the season board the player can read, before committing anything, all three challenges, their opponents' styles, and every gladiator's condition.
2. A gladiator who fought a hard bout starts their next bout with a visibly shorter HP bar, and the season board said so beforehand.
3. A gladiator rested for one series improves by exactly one condition step, and the board shows the improvement before the next lineup.
4. A `broken` gladiator cannot be assigned; the planning screen shows why.
5. If fewer than three gladiators are fightable, the remaining slots are forfeited, scored as losses, and the season still completes nine results.
6. The season summary shows nine results, the score, and per-series breakdown, and `Rematch season` restarts the same seed with a fully fresh roster.

## Season structure

Fixed shape, no branching:

| Constant | Value |
|---|---|
| `SEASON_SERIES_COUNT` | 3 |
| `BOUTS_PER_SERIES` | 3 (unchanged) |
| `ROSTER_SIZE` | 5 |
| Challenge escalation | ×1.00, ×1.08, ×1.16 |

Phase order: `season-board` → (`planning` → `fighting` → `between-bouts` → `series-summary`) × 3 → `season-summary`. The inner cycle is the existing `SeriesState` machine, unchanged in shape.

Condition is applied once per series, at the transition from `series-summary` back to `season-board`:

1. every gladiator who fought applies `conditionAfterBout` using their bout result;
2. every gladiator who rested applies `conditionAfterRest`;
3. forfeited slots wear nobody.

The season score is the sum of the three series scores, out of nine.

## Condition ladder

```ts
type FighterCondition = 'fresh' | 'bruised' | 'wounded' | 'broken'
```

Ladder index: `fresh` 0, `bruised` 1, `wounded` 2, `broken` 3. Every transition clamps to `0..3`.

**Starting HP.**

| Condition | Starting HP |
|---|---|
| `fresh` | `maxHp` |
| `bruised` | `round(maxHp × 0.75)` |
| `wounded` | `round(maxHp × 0.50)` |
| `broken` | cannot fight |

`startingHpFor` returns at least 1 for any fightable condition, so a rounding edge can never produce a gladiator who is defeated on tick 0.

**Wear after a bout.** Input is the home fighter's `remainingHpRatio` and whether they won. `BattleFinishReason` is `'defeat' | 'time-limit'`, so a loss can carry a high HP ratio; the rule resolves that explicitly rather than leaving it to the ratio:

```
steps = lost            ? 2
      : ratio >= 0.60   ? 0
      : ratio >= 0.25   ? 1
      : 2
```

A loss always costs two steps, whatever the ratio. A win costs by margin. `fresh` + one bad bout = `wounded`; two bad bouts = `broken`.

**Recovery.** A gladiator who fought no bout in a series improves exactly one step (`broken` → `wounded` → `bruised` → `fresh`). With five gladiators and three slots, exactly two rest per series, so a season affords six rest-steps total against nine bouts of wear.

The ratio thresholds and the ladder live in `src/simulation/condition.ts` and nowhere else.

## Determinism and seeds

The season seed comes from `?seed=<uint32>`, defaulting to `BASELINE_TEST_SEED`, exactly as the series seed does today.

```
seriesSeed = seriesIndex === 0
  ? seasonSeed                                     // series 0 IS today's series
  : deriveSeed(seasonSeed, `series:${seriesIndex}`)
boutSeed   = deriveBoutSeed(seriesSeed, boutIndex) // unchanged
```

`deriveSeriesSeed` is a new export in `random.ts` alongside `deriveBoutSeed`, built on the same `deriveSeed` primitive.

Series 0 deliberately passes the season seed through unchanged, and this is load-bearing rather than cosmetic. `tests/combat-visuals.spec.ts` freezes key poses at literal tick counts (253, 817, 958, 2106) read from a real run of `deriveBoutSeed(20260815, 0)`, and the screenshot baselines for both platforms were captured from exactly those moments. Deriving series 0's seed would move every one of them, forcing a regeneration of the whole visual fixture set for no gameplay benefit. Reading the identity as a rule rather than an exception: the season opens with the series the game plays today, and only the two new series need new seeds.

For the same reason the roster keeps the three existing gladiators in their current order at indices 0–2, with the two new ones appended. `combat-visuals.spec.ts` picks its pairings positionally from `getState().homeRoster`, so appending preserves every existing fixture pairing.

Condition is a pure function of prior results, so a season is reproducible from `(seed, the three lineups)` with no extra randomness. No new random stream is introduced.

## Roster and challenge content

New file `src/content/season.ts`. The six existing definitions in `mvpSeries.ts` are re-exported unchanged — not edited, not re-tuned, not moved — because `mvpSeries.test.ts` pins five stat rank-orders and `balance.test.ts` holds their matchups inside a 15–85% band.

**Roster (5):** the three existing home gladiators, in their current order and at their current indices, plus two new ones appended — one `heavy` and one `fast`. The order is fixed by the visual fixtures, as explained under "Determinism and seeds". The resulting spread is 2 heavy / 2 fast / 1 technical: the two duplicated styles make rotation possible, and the single technical makes committing Nerva a real decision, since nobody covers that role while she recovers.

**Challenges (3):** the same three opponents (`Drusus`, `Cassius`, `Magnus`) in the same slot order, scaled per series by the escalation multiplier applied to `maxHp` and `power` only. `maxHp` is rounded to an integer to satisfy `validateFighterDefinition`. Accuracy, defense, and critical chance are untouched, so the counter-triangle's calibration — which the content comments warn is tight in exactly those rows — is not disturbed.

Scaling instead of six new authored opponents is a deliberate scope limit: authoring six fighters to the same calibration discipline would cost more than the rest of the slice combined, and the escalation this hypothesis needs is a difficulty gradient, not new opponent identities.

## Balance acceptance

Existing `balance.test.ts` assertions stay exactly as they are; they cover unscaled fighters and must not be relaxed. New assertions, in a separate file so a failure names the new content:

1. **New gladiators are legitimate:** each new home gladiator's win rate against each of the three unscaled opponents sits inside the same 15–85% band used today.
2. **New gladiators do not dominate:** no new gladiator is better than the existing same-style gladiator on all five stat rows at once.
3. **Escalation is monotone and survivable:** for each of the three existing home gladiators, win rate against challenge 3 is lower than against challenge 1, and the roster's median win rate against challenge 3 is at least 25% — a season that cannot be won is not a decision.
4. **Condition matters:** a `wounded` gladiator's win rate against a fixed opponent is measurably lower than the same gladiator `fresh` in the same seeded sample.

Measurements use the existing seeded-sample method in `balance.test.ts`, not wall-clock or ad-hoc sampling.

## Module boundaries

New:

- `src/simulation/condition.ts` — `FighterCondition`, `startingHpFor`, `conditionAfterBout`, `conditionAfterRest`. Pure, no imports beyond types.
- `src/simulation/season.ts` — `SeasonState` and its commands; owns the roster, the condition ladder application, challenge selection, and the forfeit rule. Delegates every in-series command to `series.ts`.
- `src/content/season.ts` — roster of five, three challenges, escalation multipliers.
- `src/presentation/SeasonView.ts` — season board and season summary. Reads state, decides nothing.

Changed:

- `src/simulation/encounter.ts` — the combatant config gains optional `startingHp`; line 544's `hp: fighter.maxHp` becomes `hp: config.startingHp ?? fighter.maxHp`, validated as `0 < startingHp <= maxHp` and an integer. Omitted, behaviour is identical, which is what keeps every frozen trace and the cross-runtime hash `dc635911` valid without editing a single existing test.
- `src/simulation/battle.ts` — `BattleConfig` passes optional per-side starting HP through to the encounter.
- `src/simulation/series.ts` — slots and results become explicit unions (below); `SeriesConfig` accepts starting HP per home gladiator.
- `src/simulation/random.ts` — `deriveSeriesSeed`.
- `src/presentation/SeriesView.ts` — condition badge and starting HP on the planning cards; `broken` cards disabled with a reason; forfeited bouts rendered in the series summary.
- `src/main.ts` — holds `SeasonState`, routes between season board and series screens, extends the dev-only test API with `getSeasonState()` and `startNextSeries()`.

Unchanged and explicitly out of bounds for this slice: combat rules, action definitions, decision policy, poses, camera, audio, and the six existing fighter definitions.

The project rule holds: the condition ladder is a game rule and lives entirely in `simulation/`; `SeasonView` only reads and renders. `architecture.test.ts` already enforces that `simulation/` imports no DOM or Three.js, and the new modules fall under it.

## Data model

```ts
interface RosterEntry {
  fighterId: string
  condition: FighterCondition
  boutsFought: number          // season total, for the summary
}

type SeriesSlot =
  | { kind: 'fighter'; fighterId: string }
  | { kind: 'forfeit' }

type BoutOutcome =
  | ({ kind: 'fought' } & BoutResult)
  | { kind: 'forfeit'; boutIndex: BoutIndex; opponentId: string }

interface SeasonState {
  phase: 'season-board' | 'series' | 'season-summary'
  seed: number
  seriesIndex: 0 | 1 | 2
  roster: readonly RosterEntry[]
  activeSeries: SeriesState | null
  seriesRecords: readonly SeriesRecord[]
  score: SeriesScore            // season totals, out of nine
}
```

`SeriesState.results` changes from `BoutResult[]` to `BoutOutcome[]`. This is the one breaking type change in the slice; it propagates to `SeriesView` and `main.ts` mechanically, and the implementation plan must budget for it rather than discover it.

**Forfeit is never a player choice.** At `confirmLineup` the player must assign `min(3, fightableCount)` gladiators. Slots left over — only possible when fewer than three are fightable — become `{ kind: 'forfeit' }` automatically. A player with three or more fightable gladiators cannot forfeit anything.

## UI

**Season board** (new screen, shown before each series and after each series summary):

- three challenge cards in play order, each with its opponents, their styles, and a difficulty marker for the escalation step; the current one highlighted;
- five roster cards with name, style, condition, and the HP the gladiator would start with right now;
- season score so far and which series is next;
- `Start series N`, disabled with a stated reason only if the roster somehow cannot proceed.

Between series, the board shows the condition delta for each gladiator — what wear the last series applied and what the rest restored — before the player commits the next lineup.

**Planning screen** keeps its current shape and gains a condition badge plus starting HP on each card. `broken` cards are disabled and labelled.

**Series summary** gains forfeited-bout rows and a `Continue` action back to the season board; the final series leads to the season summary instead.

**Season summary:** nine results grouped by series, final score, per-gladiator bouts fought and final condition, and `Rematch season` — same seed, roster fully reset to `fresh`.

The counter-triangle rule stays on screen throughout, as today.

## Error handling and invariants

Invariants, asserted in tests and enforced in `season.ts`:

- a gladiator fights at most one bout per series (already true of `assignments`, now also asserted across the season state);
- a `broken` gladiator is never assigned, and `startingHpFor` is never called for one;
- starting HP is an integer in `1..maxHp`;
- a completed season contains exactly nine outcomes, fought plus forfeited;
- the season score equals the sum of the three series scores;
- `Rematch season` restores every roster entry to `fresh` and clears all records.

Failure modes: assigning an unknown or `broken` gladiator, confirming an incomplete lineup while three are fightable, or starting a series out of phase all return the existing `SeriesCommandResult`-style failure rather than throwing — throwing is reserved for programmer errors, as it is today.

## Automated verification

- `condition.test.ts` — the full transition table including both boundaries (0.60 and 0.25), the loss override, clamping at both ends, and rest recovery from `broken`.
- `season.test.ts` — determinism from one seed, condition application after a series, rest accounting, the forfeit path, nine-outcome completeness, rematch reset, and the one-bout-per-series invariant.
- `encounter.test.ts` / `battle.test.ts` — `startingHp` validation and effect; the existing frozen-hash tests must pass untouched, which is the proof that the default path did not move.
- `content/season.test.ts` — escalation multipliers monotone, scaled `maxHp` integral, existing six definitions re-exported byte-identical.
- balance assertions as specified above, in their own file.
- e2e: a full season driven through `advanceTicks`, a `broken` gladiator visibly unassignable, a forfeited series completing, and a screenshot baseline for the season board on both `win32` and `linux`.

`npm run check` remains the handoff gate.

## Risks

1. **Balance work is the long pole.** Two new gladiators plus three scaled challenges must satisfy the acceptance above, and the content comments warn that a local-looking nudge is not local. Mitigation: scaling only `maxHp`/`power`, never the calibrated accuracy/defense/critical rows, and keeping the existing six definitions frozen.
2. **The `BoutOutcome` union touches presentation.** Mechanical, but it is the change most likely to be underestimated.
3. **Rest economy may be too generous or too harsh.** Six rest-steps against nine bouts is a first estimate; if a normal season never forces an unwanted lineup, acceptance quality 2 fails and the ladder ratios — not the season length — are the tuning lever.

## Future work

Unchanged from the README roadmap and explicitly after this slice: perks over the `combatDecision.ts` seam, the mass-combat layer over `encounter.ts`, imported models, and performance budgets. Challenge choice, economy, and permanent death are the natural next meta-layer if this hypothesis holds.
