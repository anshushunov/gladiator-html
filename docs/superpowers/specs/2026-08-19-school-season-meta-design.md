# School Season Meta-Loop — MVP Design

**Status:** approved for implementation; revised after peer review (codex `gpt-5.6-sol`, 2026-08-19)

**Date:** 2026-08-19

## Terminology

- **Season** — the whole session: three series played in a fixed order against three pre-authored challenges, ending in a season summary.
- **Series** — the existing three-bout unit (`src/simulation/series.ts`): one lineup, three bouts, one series summary.
- **Challenge** — the opponent trio a series is played against, plus that series' per-opponent scaling vector.
- **Roster** — the five home gladiators owned by the school for the whole season.
- **Condition** — a gladiator's accumulated wear on a four-step ladder; it decides the HP that gladiator starts a bout with and whether they can fight at all.
- **Rest** — a series in which a gladiator fought no bout.
- **Forfeit** — a bout slot with no gladiator, only possible when fewer than three are fightable: scored as a loss, no battle simulated.

## Context

Three slices are merged: the school series MVP (#2), readable deep combat (#3), and combat legibility (#11). The combat kernel is deterministic, frozen behind a trace hash, and legible enough to be watched. The game around it is not: a session is one lineup decision — three gladiators onto three visible opponents — followed by three bouts and a summary.

That single decision is close to solved. The MVP design review recorded it as blocker `B1`: six permutations, one of which dominates, evaluated once per session. Nothing carries between bouts, so choosing the best matchup for bout 1 costs nothing anywhere else.

This slice adds the first meta-layer: consequences that outlive a bout, and a roster larger than the number of slots, so the lineup decision is repeated under a constraint that tightens.

## Product hypothesis

A player will keep making the lineup decision when a gladiator's condition carries across series and the roster is larger than the three slots, because the best available matchup now costs a resource that a later challenge will need.

The slice tests two qualities:

1. **Cost:** committing a gladiator is always paid for — there is no free bout.
2. **Tension:** by the third challenge the roster cannot field the lineup the player would have chosen fresh.

This is a decision-depth hypothesis, not a content-breadth hypothesis.

## Goals

- A season of three series (nine bouts) played from a single seed.
- A five-gladiator roster whose members carry condition across series.
- Condition visibly changes the bout: a worn gladiator enters with a partly filled HP bar, before the first exchange.
- Every consequence is telegraphed before the lineup is confirmed, not revealed after.
- Rest is the only recovery, and it costs the bouts the rested gladiator did not fight.
- A season always reaches nine results, including forfeits.
- Determinism preserved: the same seed and lineups reproduce the season, and the frozen combat traces stay byte-identical.

## Non-goals

- Perks, skills, or `combatSkill` progression, **including pre-bout orders** (see "Rejected for this slice").
- Economy, hiring, equipment, permanent death.
- Player choice between challenges: the three are fixed and visible from the start.
- Persistence across page reloads.
- Mass combat, imported models, performance budgets.
- Visual wound representation on the rig.
- Body-part injuries, healing buildings, supplies, morale, personality traits, relationships, or random post-fight traits. A three-series session cannot amortize that bookkeeping; one carried resource with one recovery route is the whole point.

## Player-facing acceptance

1. From the season board the player can read, before committing anything, all three challenges with their opponents' actual scaled stats, and every gladiator's condition.
2. Each planning card states what fighting will cost and what resting would restore, **before** the lineup is confirmed.
3. A gladiator who fought starts their next bout with a visibly shorter HP bar, and the board said so beforehand.
4. A gladiator rested for one series improves by exactly one step, shown on the board before the next lineup.
5. A `broken` gladiator cannot be assigned; the planning screen shows why.
6. If fewer than three are fightable, the player assigns exactly the ones who are and chooses which slots stay uncovered; those are forfeited and the season still completes nine results.
7. The season summary shows nine results, the score, and per-series breakdown; `Rematch season` restarts the same seed with a fully fresh roster.

## Season structure

| Constant | Value |
|---|---|
| `SEASON_SERIES_COUNT` | 3 |
| `BOUTS_PER_SERIES` | 3 (unchanged) |
| `ROSTER_SIZE` | 5 |

Phase order: `season-board` → (`planning` → `fighting` → `between-bouts` → `series-summary`) × 3 → `season-summary`. The inner cycle is the existing `SeriesState` machine.

Condition is applied once per series, at the transition from `series-summary` back to `season-board`: everyone who fought applies `conditionAfterBout`, everyone who rested applies `conditionAfterRest`, forfeited slots wear nobody. The season score is the sum of the three series scores, out of nine.

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

`startingHpFor` returns at least 1 for any fightable condition, so rounding can never produce a gladiator defeated on tick 0.

**Wear after a bout.** Input is the home fighter's `remainingHpRatio` and whether they won. `BattleFinishReason` is `'defeat' | 'time-limit'`, so a loss can carry a high ratio; the rule resolves that explicitly:

```
steps = (lost || ratio < 0.25) ? 2 : 1
```

**Fighting always costs at least one step.** An earlier draft gave a clean win (ratio ≥ 0.60) zero wear; peer review correctly identified that as fatal to the hypothesis — it makes the dominant matchup literally free, which is the exact defect this slice exists to remove. A dominant win is now rewarded by *winning*, not by costing nothing.

**Recovery.** A gladiator who fought no bout in a series improves exactly one step (`broken` → `wounded` → `bruised` → `fresh`).

**The real recovery economy** — the naive count of "two resters × three series = six recovery steps" is wrong twice over, and the corrected figure is what makes the design work:

- resting during series 1 restores nothing: everyone is `fresh` and the transition clamps;
- resting during series 3 restores nothing that any decision can use: the season is over.

Only the two resters of series 2 produce a step that reaches a later lineup. So the season spends **at least six wear steps** (three fighters × two series) against **at most two useful recovery steps** before the third challenge. The roster is guaranteed to be worn when the hardest challenge arrives, which is exactly the intended shape.

The thresholds and the ladder live in `src/simulation/condition.ts` and nowhere else.

## Determinism and seeds

Seed resolution is unchanged from today's behaviour and is explicitly *not* being redefined: `main.ts:449-457` accepts a valid `?seed=<uint32>`, and otherwise generates a random uint32 via `crypto.getRandomValues`, writes it into the URL with `history.replaceState`, and uses that. The season seed is resolved by exactly that function, renamed to reflect its new scope. `BASELINE_TEST_SEED` remains what it is today: a fixture constant used by tests, not a product default.

```
seriesSeed = seriesIndex === 0
  ? seasonSeed                                     // series 0 IS today's series
  : deriveSeed(seasonSeed, `series:${seriesIndex}`)
boutSeed   = deriveBoutSeed(seriesSeed, boutIndex) // unchanged
```

Series 0 passes the season seed through unchanged, and this is load-bearing. `tests/combat-visuals.spec.ts` freezes key poses at literal tick counts (253, 817, 958, 2106) read from a real run of `deriveBoutSeed(20260815, 0)`, and both platforms' screenshot baselines were captured at exactly those moments. Deriving series 0's seed would move every one of them. Read as a rule rather than an exception: the season opens with the series the game plays today.

Those fixtures name their gladiators explicitly — `startBoutZeroWith` hardcodes `['brutus', 'aquila', 'nerva']` (`combat-visuals.spec.ts:14-23`) — so appending two gladiators cannot change which pairing they exercise. Roster order therefore matters for the UI, not for the fixtures.

Condition is a pure function of prior results, so a season is reproducible from `(seed, the three lineups)`. No new random stream.

## Roster and challenge content

New file `src/content/season.ts`. The six existing definitions in `mvpSeries.ts` are re-exported unchanged — not edited, not re-tuned — because `mvpSeries.test.ts` pins five stat rank-orders and `balance.test.ts` holds their matchups inside a 15–85% band over 200 consecutive seeds from `20260815`.

**Roster (5):** the three existing home gladiators, at their current indices, plus two appended — one `heavy`, one `fast`. The spread is 2 heavy / 2 fast / 1 technical; the single technical makes committing Nerva a real decision, since nobody covers that role while she recovers.

The two new gladiators are **specialists, not equivalents**: weaker on aggregate than the veteran of their own style, but each the better answer to one specific opponent style. This is deliberate and load-bearing. The Darkest Dungeon critique of roster depth is the failure mode to avoid — when the bench is as good as the starters, rotation stops being a decision and becomes routine logistics ([The Gemsbok's mechanical critique](https://thegemsbok.com/art-reviews-and-articles/darkest-dungeon-red-hook-critique-mechanics-design/)). Benching a veteran must mean fielding someone worse at most things.

**Challenges (3):** the same three opponents in the same slot order, scaled per challenge by a **per-opponent vector** applied to `maxHp` and `power` only, with `maxHp` rounded to an integer:

| Challenge | Drusus (fast) | Cassius (technical) | Magnus (heavy) | Featured threat |
|---|---|---|---|---|
| 1 | ×1.00 | ×1.00 | ×1.00 | none — the baseline series |
| 2 | ×1.12 | ×1.08 | ×1.04 | fast |
| 3 | ×1.16 | ×1.12 | ×1.20 | heavy |

A uniform scalar was the earlier draft and it was structurally inert: since the player maps gladiators to slots freely, scaling everyone equally leaves the same matchup template optimal in all three series. Asymmetric vectors change *which* answer each challenge demands, while staying monotone per opponent. Accuracy, defense, and critical chance are untouched — the content comments warn those rows are where the counter-triangle's calibration is tight.

Scaling rather than authoring six new opponents is a deliberate scope limit: this hypothesis needs a difficulty gradient, not new opponent identities.

## Balance acceptance

Existing `balance.test.ts` assertions stay exactly as they are. New assertions live in their own file so a failure names the new content, and use the same cohort method: **200 consecutive seeds beginning at `20260815`**, the existing helper, no wall-clock.

1. **New gladiators are legitimate:** each new gladiator's win rate against each of the three unscaled opponents sits inside the same 15–85% band.
2. **Neither same-style gladiator is a strict upgrade:** for each style with a duplicate, the veteran and the specialist each win at least one of the three opponent win-rate comparisons. A bench member who loses all three is a strict downgrade and rotation to them is never a real choice.
3. **Escalation is monotone and survivable:** for each of the three veterans, win rate against challenge 3 is lower than against challenge 1; no `fresh` pairing in challenge 3 falls outside 5–95%; and the best available three-slot lineup against challenge 3 stays winnable on the majority of the cohort.
4. **Condition bites:** a `wounded` gladiator's win rate against a fixed opponent is at least **10 percentage points** below the same gladiator `fresh` on the same cohort.
5. **Golden season:** one fixed seed and three named lineups produce an asserted sequence of condition deltas, and at least one of series 2 or 3 begins in a state where the best fresh-roster lineup is unavailable — the tension quality, asserted rather than hoped for.

## Module boundaries

New:

- `src/simulation/condition.ts` — `FighterCondition`, `startingHpFor`, `conditionAfterBout`, `conditionAfterRest`. Pure.
- `src/simulation/season.ts` — `SeasonState` and its commands; owns roster condition, challenge selection, and the forfeit walk. Delegates in-series commands to `series.ts`.
- `src/content/season.ts` — roster of five, three challenges, scaling vectors.
- `src/presentation/SeasonView.ts` — season board and season summary. Renders; decides nothing.

Changed: `encounter.ts`, `battle.ts`, `series.ts`, `random.ts`, `SeriesView.ts`, `main.ts`, **`src/style.css`** (season board layout, five roster cards, condition badges, disabled reasons, delta rows — at working and narrow widths), and **`scripts/record-review-clips.ts`**, which drives the dev API and breaks when the app no longer opens on planning.

Unchanged and out of bounds: combat rules, action definitions, decision policy, poses, camera, audio, and the six existing fighter definitions.

`architecture.test.ts` forbids `simulation/` from importing `content/` or `presentation/` (it scans for `from '…/content/'` and `from '…/presentation/'`, plus `crypto`, `Math.random`, DOM globals). Season content therefore reaches the simulation as plain data through a config object, exactly as `SeriesConfig` already does — never by import.

## Data model

```ts
interface ChallengeDefinition {
  index: 0 | 1 | 2
  opponents: readonly FighterDefinition[]   // already scaled: plain data, no multipliers at runtime
  featuredThreat: Archetype | null
}

interface RosterEntry {
  fighter: FighterDefinition
  condition: FighterCondition
  boutsFought: number
}

interface ConditionDelta {
  fighterId: string
  before: FighterCondition
  after: FighterCondition
  cause: 'fought' | 'rested'
}

interface SeriesRecord {
  seriesIndex: 0 | 1 | 2
  challengeIndex: 0 | 1 | 2
  outcomes: readonly BoutOutcome[]
  score: SeriesScore
  deltas: readonly ConditionDelta[]
}

interface SeasonConfig {
  seed: number
  roster: readonly FighterDefinition[]
  challenges: readonly ChallengeDefinition[]
  combatStyles: CombatStyleCatalog
}

interface SeasonState {
  phase: 'season-board' | 'series' | 'season-summary'
  seed: number
  seriesIndex: 0 | 1 | 2
  roster: readonly RosterEntry[]
  challenges: readonly ChallengeDefinition[]
  combatStyles: CombatStyleCatalog
  activeSeries: SeriesState | null
  records: readonly SeriesRecord[]
  score: SeriesScore
  lastDeltas: readonly ConditionDelta[]      // what the board shows between series
}
```

`SeasonState` carries the full definitions and the catalog, mirroring how `SeriesState` already holds `homeRoster`/`opponents`/`combatStyles` (`series.ts:24-42`). This is what lets `SeasonView` render names, styles, scaled stats, and deltas without computing a single rule.

**Slots and outcomes.** Planning and committed states are separate types, so "unassigned" and "forfeited" are never the same value:

```ts
type PlanningSlot = { kind: 'fighter'; fighterId: string } | null
type SeriesSlot   = { kind: 'fighter'; fighterId: string } | { kind: 'forfeit' }

type BoutOutcome =
  | ({ kind: 'fought' } & BoutResult)
  | { kind: 'forfeit'; boutIndex: BoutIndex; opponentId: string }
```

`SeriesState.results` changes from `BoutResult[]` to `BoutOutcome[]`. This is the one breaking type change; it propagates to `SeriesView` and `main.ts` mechanically and must be budgeted, not discovered.

**Forfeit rule, stated unambiguously.** `confirmLineup` requires exactly `min(3, fightableCount)` slots filled: the player cannot forfeit voluntarily, but when short-handed they *do* choose which slots stay uncovered — that is a real decision and the only honest reading of "the player assigns everyone available". Uncovered slots become `{ kind: 'forfeit' }` at confirmation.

A pure `advancePastForfeits` handles the walk: it appends an away-win outcome for each forfeited slot, advances to the next fought slot or to `summary`, and updates the score — correctly for a forfeit in slot 0, 1 or 2, for consecutive forfeits, and for an all-forfeit series (no `activeBattle` ever created).

## Starting HP plumbing

Exact API, so two implementations cannot diverge:

- `EncounterCombatantDefinition.startingHp?: number` — `buildFighterCombatState` uses `definition.startingHp ?? fighter.maxHp` (today's `encounter.ts:544`).
- Validation in `createEncounter`: integer, `1 ≤ startingHp ≤ maxHp`.
- `BattleConfig.startingHp?: Partial<Record<FighterSide, number>>`.
- `SeriesConfig.homeStartingHpByFighterId: Readonly<Record<string, number>>`.

With every field omitted, the constructed `EncounterState` must be structurally identical to today's — which the existing frozen-hash tests prove without being edited.

## UI

**Season board** (new; before each series and after each series summary):

- three challenge cards in play order with their opponents' **actual scaled stats** and featured threat, current one highlighted;
- five roster cards: name, style, condition, the HP this gladiator would start with now, and the telegraph — what fighting costs (`fight → bruised at best, wounded on a loss or a maul`) and what resting restores (`rest → bruised`);
- season score and which series is next; between series, the `ConditionDelta` rows for the series just played;
- `Start series N`.

Telegraphing the cost before commitment is the point: with outcome-dependent wear and no forecast, the player cannot distinguish a managed risk from a post-hoc punishment. This follows Into the Breach's rule that the threat is fully visible before the decision ([Subset Games](https://subsetgames.com/itb.html)).

**Planning screen** keeps its shape and gains the condition badge, starting HP, and the same telegraph per card. `broken` cards are disabled and labelled. When fewer than three are fightable, the screen states that the remaining slots will be forfeited and lets the player choose which.

**Series summary** gains forfeited-bout rows and `Continue`; the final series leads to the season summary.

**Season summary:** nine results grouped by series, final score, per-gladiator bouts fought and final condition, `Rematch season`.

## Dev API and test migration

The app no longer opens on planning, so every fixture that assumes it must be migrated. Test API:

- `getSeasonState()`, `getActiveSeriesState(): SeriesState | null`, `startNextSeries()`, `continueSeason()`, `rematchSeason()`;
- existing `assign`/`unassign`/`confirm`/`advanceTicks`/`startNextBout` keep their meaning inside the active series;
- `getState()` and `rematch()` are removed rather than left meaning something subtly different; every caller is in this repository.

Migrated callers: `tests/combat-visuals.spec.ts`, `tests/smoke.spec.ts`, `tests/decision-panel.spec.ts`, `scripts/record-review-clips.ts` — each now starts series 0 explicitly before doing what it did before.

Screenshot discipline: run e2e **without** `--update-snapshots` first. The frozen key-pose baselines (`heavy-cleave`, `fast-burst`, `technical-parry`, `combat-outcomes`, `combat-safe-frame`) must still match exactly — that is the proof the kernel did not move. Only `planning.png` (now five cards) and the new season-board baseline are regenerated intentionally, on win32 and linux separately.

## Error handling and invariants

Invariants asserted in tests and enforced in `season.ts`:

- a gladiator fights at most one bout per series;
- a `broken` gladiator is never assigned and `startingHpFor` is never called for one;
- starting HP is an integer in `1..maxHp`;
- a completed season contains exactly nine outcomes, fought plus forfeited;
- season score equals the sum of the three series scores;
- `Rematch season` restores every entry to `fresh` and clears all records.

Failure contract, matching what the code does today rather than what an earlier draft claimed: an **unknown** fighter id stays a thrown programmer error (`series.ts:65-68`, pinned by `series.test.ts`). A **known but unavailable** gladiator is a recoverable command failure, added at the season layer as `fighter-unavailable` and checked before delegating to `assignFighter`.

## Automated verification

- `condition.test.ts` — the transition table including the 0.25 boundary and the loss override, clamping at both ends, rest recovery from `broken`, and that fighting is never free.
- `season.test.ts` — determinism from one seed; condition application after a series; the corrected recovery economy; forfeit in slots 0/1/2, consecutive forfeits, and an all-forfeit series; nine-outcome completeness; rematch reset; one-bout-per-series.
- `encounter.test.ts` / `battle.test.ts` — `startingHp` validation and effect; existing frozen-hash tests pass untouched.
- `content/season.test.ts` — scaling vectors monotone per opponent, scaled `maxHp` integral, existing six definitions re-exported unchanged.
- balance assertions as specified, in their own file.
- e2e: a full season through `advanceTicks`; a `broken` gladiator unassignable; a short-handed series where the player picks the covered slots; season board baseline on both platforms.

`npm run check` remains the handoff gate.

## Rejected for this slice

**Soft `broken` (fielding a broken gladiator anyway).** Battle Brothers makes injuries a soft constraint — you *can* field a wounded man, it just costs ([dev blog #79](https://battlebrothersgame.com/dev-blog-79-progress-update-injury-mechanics/)) — and that was the initial instinct here. It does not transfer: their cost is paid over a long campaign with treatment, temporary debuffs and further losses, whereas in a three-series season a `broken` gladiator in series 3 has no future left to pay with. Any nonzero chance of winning would strictly beat a guaranteed forfeit, so "soft" would decay into an automatic click rather than a risk. The gradation we keep is the XCOM 2 shape: lightly worn fighters deploy at a cost, heavily worn ones must sit out.

**Pre-bout orders** ("conserve strength" / "go for the kill" via `combatDecision.ts`'s modifier seam). Good risk/reward, wrong slice — it tests a second hypothesis at the same time as the first. It is also not the local change it appears to be: the seam exists in the decision functions (`DecisionModifier`, `combatDecision.ts:674`, default `[]`), but `encounter.ts` never passes modifiers, and `DecisionModifier` holds a function, so it cannot live in a structurally-clonable `EncounterState`. A future slice would carry a serializable `orderId` in combatant state and map it to modifiers module-locally, with the neutral path preserving today's hashes.

## Risks

1. **Balance is the long pole.** Two new gladiators plus three scaled challenges must satisfy five acceptance criteria. Mitigation: scale only `maxHp`/`power`, freeze the existing six definitions, reuse the existing cohort helper.
2. **The `BoutOutcome` union and the removal of `getState()` touch every e2e fixture and the review-clip script.** Mechanical, easy to underestimate.
3. **Wear may now be too harsh.** Guaranteeing at least one step per bout is what makes commitment cost something, but with six wear steps against two useful recovery steps a season could reach series 3 unable to field three gladiators more often than intended. The golden-season test measures it; the tuning levers are the HP ratios and the 0.25 threshold, not the season length.

## Future work

Perks over the `combatDecision.ts` seam (with pre-bout orders as its first application), the mass-combat layer over `encounter.ts`, imported models, performance budgets. Challenge choice, economy, and permanent death are the natural next meta-layer if this hypothesis holds.
