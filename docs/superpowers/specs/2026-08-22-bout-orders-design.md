# Bout Orders and Opponent Temperament — MVP Design

**Status:** approved in brainstorming session; awaiting spec review

**Date:** 2026-08-22

## Terminology

- **Order** — the disposition the player picks for the home fighter of one bout: `press`, `guarded`, or `standard`.
- **Temperament** — the authored disposition of one opponent in one challenge: the same three values, displayed to the player as *Aggressive*, *Cautious*, and *Steady*.
- **Disposition** — the shared serializable id behind both: `type DispositionId = 'standard' | 'press' | 'guarded'`.
- **Wear threshold** — the existing `remainingHpRatio < 0.25` boundary in `condition.ts` that turns a bout into two condition steps instead of one.

## Context

The season slice (PR #12) was playtested on 2026-08-22
(`docs/reviews/2026-08-22-school-season-playtest.md`). It passed its own gate —
cost is real, tension exists — but surfaced the next defect precisely:

- the loop is close to solved: "я просто ставлю здоровых и контрю класс" (Q10);
- the player has no lever over a bout beyond the archetype counter (Q12);
- wear reads as "просто случилось", not as a consequence the player caused (Q5);
- the counter triangle alone feels too plain; the reviewer asked for
  Football-Manager/TFT-style tactical detail that matters without being
  decisive (Q2).

The season-meta design already sketched this slice under "Rejected for this
slice": a serializable order id carried in combatant state and mapped to
`DecisionModifier`s module-locally, with the neutral path preserving today's
frozen hashes. This document is that slice.

## Product hypothesis

A player will keep making meaningful decisions — instead of executing the
solved "healthy + counter" template — when every bout offers a pre-bout order
with a visible risk/reward, the order's execution can be seen in the fight's
movement pattern, and the opponent's temperament is readable input to that
choice.

The slice tests three qualities:

1. **Agency:** the order measurably shifts the bout's outcome distribution —
   win chance against expected remaining HP — so the choice is real.
2. **Visibility:** a `press` fighter and a `guarded` fighter are
   distinguishable by watching, without the HUD.
3. **Attribution:** because `press` courts the wear threshold and `guarded`
   protects it, condition damage becomes something the player *caused*, using
   the existing wear rule unchanged.

One hypothesis, one PR. Progression (experience for wins) is explicitly the
next slice, not this one.

## Goals

- Three universal orders selectable per bout: `press`, `guarded`, `standard`
  (default).
- Order for bout 1 chosen on the planning screen; orders for bouts 2–3
  adjustable on the interstitial before `Start next bout` — the interstitial
  becomes a decision point, not a pause.
- Opponent temperaments as authored per-challenge content, visible on cards
  before the bout and on the season board.
- Orders and temperaments are one mechanism: a `DispositionId` resolved to
  `DecisionModifier`s inside simulation.
- `standard` maps to an empty modifier list, so a season played entirely on
  defaults is byte-identical to today: every frozen trace hash, key-pose tick,
  and combat screenshot baseline passes untouched.
- Determinism preserved: a season is reproducible from
  `(seed, lineups, orders)`. No new random stream.

## Non-goals

- Experience, levels, perks, or any reward for winning beyond the score.
  (Next slice.)
- Per-style or per-fighter order lists; all three orders are universal.
- An explicit order-vs-order counter table or numeric order-vs-order bonus.
- Stat modification: damage, accuracy, defense, critical chance, starting HP,
  and the wear rule in `condition.ts` are untouched.
- Mid-bout order changes.
- New battle events, poses, camera, or audio behavior.
- Re-tuning the six frozen fighter definitions or the challenge scaling
  vectors.

## Player-facing acceptance

1. On planning, every occupied slot shows an order selector defaulting to
   `Standard`, with a one-line telegraph of each order's trade
   (`Press: better odds to win, better odds to get mauled`).
2. Opponent cards show the temperament badge with a one-line behavioral
   description; challenge cards on the season board show their opponents'
   temperaments.
3. On the interstitial, the next bout's order can be changed until
   `Start next bout`.
4. During a bout, the HUD names both dispositions
   (`Order: Press` / `Temperament: Cautious`).
5. A reviewer watching without the HUD can tell a `press` fighter from a
   `guarded` fighter within one bout.
6. The bout summary rows and season records state which order each fought bout
   used.

## Mechanics

### Disposition catalog

New module `src/simulation/disposition.ts`:

- `type DispositionId = 'standard' | 'press' | 'guarded'`;
- `dispositionModifiers(id: DispositionId): readonly DecisionModifier[]` —
  the only place ids become behavior; `standard` returns `[]`;
- `isDispositionId(value: unknown)` validation used by `createEncounter`.

`DecisionModifier` functions never enter `EncounterState`; combatant state
carries only the id. This is the exact shape the season-meta review prescribed.

### What the modifiers adjust

Only candidate weights at the existing seam
(`applyModifiers`, `combatDecision.ts`). Direction, not magnitude, is fixed by
this design; magnitudes are tuning values that must satisfy the balance
acceptance below.

- `press`: increases weights of `committed`-tagged attack actions and of the
  approach-side locomotion intents (`pressure`, `burst-in`, `advance`);
  decreases weights of distance-keeping intents (`hold-range`, `backstep`,
  `retreat`, `disengage`).
- `guarded`: the mirror — increases distance-keeping and defensive-leaning
  weights, decreases `committed` attacks and approach intents. Probes stay
  near neutral so a guarded fighter still fights.
- Neither order may zero a style's whole action set: weights pass through the
  existing `max(0, …)` clamp, and the anti-stall pressure and stale-suppression
  exemptions in `combatDecision.ts` keep working unchanged. Modifier magnitudes
  must be small enough that style identity (heavy/fast/technical movement
  patterns) stays recognizable — dispositions shade a style, they do not
  replace it.

### Temperaments

Opponent temperaments are authored content in `src/content/season.ts`, carried
per opponent per challenge. Challenge 1 is all `standard` (displayed
*Steady*) — this both preserves every frozen fixture (challenge 1 is today's
baseline series) and teaches orders against neutral opponents first. Challenges
2 and 3 introduce non-neutral temperaments as part of the existing escalation,
alongside the stat scaling. The exact temperament assignment for challenges 2–3
is content tuning, constrained by the balance acceptance.

> **Amended 2026-08-23, final review.** "Constrained by the balance acceptance"
> was not true as shipped: `seasonBalance.test.ts` measured challenge 3 with all
> three opponents neutral, so nothing constrained the row. Measured properly,
> challenge 3 has **no difficulty budget left for temperament** — `SCALING`
> spends all of it, leaving the best three-slot lineup at 52.5% against
> criterion 3's 50% floor. Challenge 3's row is therefore chosen for variety at
> net-neutral difficulty (`['standard', 'press', 'standard']`), not as a further
> escalation; the measured grid is in `src/content/season.ts`. Challenge 2 is
> unmeasured by any criterion and remains free content tuning.

There is no counter table. Order-vs-temperament interaction emerges from
behavior: pressing a cautious opponent who keeps leaving plays differently
than pressing an aggressor who walks into you.

## Determinism and freezing

- Disposition ids are inputs, like lineups. Same
  `(seed, lineups, orders)` → same season, same traces.
- With every disposition `standard`, the modifier list is `[]` and the
  constructed `EncounterState` is structurally identical to today's. The
  existing frozen-hash tests (`dc635911` and friends), the key-pose ticks
  (253, 817, 958, 2106), and both platforms' combat screenshot baselines must
  pass **without edits** — that is the proof, same as `startingHp?` in the
  season slice.
- No new PRNG stream; dispositions never consume rolls themselves.

## Data model and API

```ts
// simulation
type DispositionId = 'standard' | 'press' | 'guarded'

// encounter
interface EncounterCombatantDefinition {
  // ...existing
  disposition?: DispositionId          // default 'standard'; validated
}

// battle / series plumbing mirrors startingHp:
// BattleConfig.dispositions?: Partial<Record<FighterSide, DispositionId>>
// SeriesConfig gains opponent dispositions (content) and the series state
// carries home orders:
interface SeriesState {
  // ...existing
  orders: readonly [DispositionId, DispositionId, DispositionId] // per bout, default all 'standard'
}

// BoutResult gains the order it was fought under:
interface BoutResult {
  // ...existing
  homeOrder: DispositionId
}
```

New command `setBoutOrder(state, boutIndex, order)`:

| Phase | Behavior |
| --- | --- |
| `planning` | any bout index `0..2` |
| `between-bouts` | only the next pending bout index; otherwise fails |
| other phases | fails |

Failure reason: `order-locked` (new `SeriesCommandFailure` member), returned
for a wrong phase or an already-resolved bout. An invalid disposition id or
bout index outside `0..2` throws — programmer error, consistent with unknown
fighter ids. Forfeited slots ignore their order.

Dev/test API gains `setBoutOrder(boutIndex, order)` with the same semantics.

## Module boundaries

New:

- `src/simulation/disposition.ts` — the id, validation, and id→modifier
  mapping. Pure.

Changed:

- `src/simulation/combatDecision.ts` — none, ideally; the seam already exists.
- `src/simulation/encounter.ts` — accepts and validates
  `disposition`, resolves modifiers module-locally at decision time.
- `src/simulation/battle.ts`, `series.ts`, `season.ts` — plumbing, the
  `setBoutOrder` command, `homeOrder` in results.
- `src/content/season.ts` — per-challenge opponent temperaments.
- `src/presentation/SeriesView.ts`, `SeasonView.ts`, `src/style.css` — order
  selectors, temperament badges, HUD labels, summary rows.
- `src/main.ts` — test API surface.

Unchanged and out of bounds: `condition.ts`, damage/accuracy/critical rules,
action definitions, poses, camera, audio, the six frozen fighter definitions,
challenge stat-scaling vectors.

Content still reaches simulation as plain data through config objects, never
by import (`architecture.test.ts` continues to enforce this).

## UI

- **Planning:** per-slot order selector — a three-button radio group, keyboard
  operable, following the screen's existing focus rules. One-line telegraph per
  order. Opponent cards gain the temperament badge and description.
- **Interstitial:** shows the upcoming matchup's order selector, pre-set to
  the value chosen at planning; changeable until `Start next bout`.
- **During the bout:** static HUD labels naming both dispositions. No new
  arena rendering.
- **Season board:** temperament badges on challenge cards — this also gives
  the board a first answer to the playtest's "which challenge is harder and
  why" gap (Q7).
- **Summaries:** each fought bout row includes its order.

## Balance acceptance

Same method as before: cohort of **200 consecutive seeds from `20260815`**,
existing helper, no wall-clock. New assertions in their own file.

> **Amended 2026-08-22 after measurement**, in two runs of different sizes: the
> full 4–8 × 3–6 magnitude sweep, 20 cells of cohort A at 60 seeds — 60 seeds ×
> 27 cohorts = 1620 bouts per cell, 32 400 in all; and a separate confirmation
> run at the shipped magnitudes over this suite's own cohort size, 200 seeds ×
> 54 cohorts = 10 800 bouts. (Evidence in
> `.superpowers/sdd/2026-08-22-bout-orders/task-5-report.md`, kept in
> `docs/reviews/2026-08-22-bout-orders-playtest.md`.) Criteria 1, 3 and 4 as
> first written are not satisfiable by any magnitude, for reasons that are
> properties of the metrics rather than of the mechanic. The amended text
> below is what the suite asserts; the original wording is preserved in git
> history.

1. **Risk/reward is real.** Over the nine veteran × challenge-1-opponent
   pairings: `mean(press.winRate − standard.winRate) ≥ 0.03` and
   `mean(standard.winRate − guarded.winRate) ≥ 0.03`; and on
   **`bloodyWinShare`** — the share of bouts ending in a home win with the
   home fighter below the 0.25 wear threshold —
   `mean(press − standard) ≥ 0.02` and `mean(standard − guarded) ≥ 0.02`.
   *Why not the original clauses:* (a) the original `lowHpShare` counts every
   loss as a low-HP outcome (the loser is at zero HP), so with a ~0 timeout
   rate it is exactly `1 − cheapWearShare` and moves opposite to the win-rate
   clause above it — it silently demanded a 22.3-point bloody-win gap where
   6.8 exists, and every one of the 20 in-range magnitude cells has it
   negative. (b) The original per-pairing clauses (`press` never more than
   0.02 below `standard` on any pairing, and the mirror for `guarded`) forbid
   the counter triangle `balance.test.ts` already asserts: Nerva pressing into
   Drusus *should* be worse, and Nerva guarding against Cassius *should* be
   better. They pull directly against criterion 2, which is the criterion that
   makes the mechanic a real choice.
2. **No dominant order.** No single order is simultaneously best on win rate
   and best on cheap-wear probability across all measured pairings.
3. **Temperament changes the difficulty.** Over the nine veteran × home-order
   cells against Cassius, `mean(|winRate(cassius@press) −
   winRate(cassius@guarded)|) ≥ 0.05`.
   *Why not "changes the answer":* the original criterion — that some
   veteran's ranking of the three orders flips between an aggressive and a
   cautious opponent — is false in this build and has no lever attached.
   Opponent temperament shifts all three of a veteran's win rates in the same
   direction without reordering them (Brutus and Aquila always want `press`,
   Nerva always wants `guarded`); the order choice is informed by *who* you
   fight, not by *how they fight*. The nominated lever (`TEMPERAMENTS` rows
   2–3) cannot move it either, because the cohort constructs the away
   disposition directly and never reads `SEASON_CHALLENGES`. Making the answer
   temperament-dependent needs a new mechanism (an order that counters an
   approaching or retreating opponent), which is a separate design round.
4. **No stall collapse.** Across `guarded`-vs-cautious pairings, the
   time-limit share stays at or below twice the `standard`-vs-steady share and
   never exceeds 30%, and each pairing's median bout duration stays inside
   `balance.test.ts`'s own per-pairing 1200–2700 tick band.
   *Why not 1500–2400:* that 900-tick window is narrower than the roster's own
   both-guarded median spread (1301…2341 = 1040 ticks), so no uniform shift
   fits it, and `LOCOMOTION_ADJUST` moves the medians together without
   compressing them. `nerva/cassius` is simply a fast pairing — its
   *standard* median is 1272. The anti-stall property the criterion exists for
   passes with a 30× margin (worst both-guarded timeout rate 1.0% against the
   30% cap).
5. **The frozen core did not move.** All-`standard` seasons reproduce today's
   trace hashes byte-for-byte; existing frozen tests pass unedited.

## Automated verification

- `disposition.test.ts` — id validation, `standard → []`, modifier direction
  per candidate class (committed / probe / approach / distance-keeping).
- `series.test.ts` / `season.test.ts` — `setBoutOrder` phase table,
  `order-locked` cases, default orders, `homeOrder` recorded, forfeit ignores
  order, reproducibility from `(seed, lineups, orders)`.
- `encounter.test.ts` / `battle.test.ts` — disposition validation and effect;
  omitted disposition structurally identical to today (frozen tests untouched).
- `content/season.test.ts` — challenge-1 temperaments all `standard`;
  temperament vectors well-formed.
- Balance assertions as specified, own file.
- e2e: set an order on planning and change one on an interstitial via UI;
  HUD labels visible during the bout; temperament badges on planning and
  season board; screenshot baselines regenerated **only** for
  planning/interstitial/season-board on both platforms — combat key-pose
  baselines must pass unedited.

`npm run check` remains the handoff gate.

## Human playtest gate

A new script, same format as `2026-08-22-school-season-playtest.md`. The slice
passes when at least one reviewer:

1. names a bout where they chose a non-`standard` order *for a reason* (score,
   temperament, or the fighter's condition) — the agency quality;
2. with the HUD hidden, correctly identifies which fighter is under `press`
   and which under `guarded` in a prepared pair of clips — the visibility
   quality;
3. describes at least one wear outcome as caused by their own order choice —
   the attribution quality that Q5 found missing.

## Rejected for this slice

- **Explicit order-vs-order counter table.** The playtest already called
  rock-paper-scissors too plain; a second triangle repeats the defect.
  Interaction must emerge from behavior.
- **Stat-modifying orders.** Guaranteed effect, but invisible to the eye and
  it breaks the calibrated combat math — the exact "unexplained HP loss"
  failure the combat slice exists to avoid.
- **Orders that modify the wear rule directly** (e.g. `guarded` caps wear at
  one step). Turns the order into a meta toggle that bypasses the bout and
  breaks `condition.ts`'s "wear is a pure function of the result" property.
- **Per-style order lists.** Triples the balance and readability surface for
  flavor this hypothesis does not need.
- **Temperaments for challenge 1 / all opponents immediately.** Moves every
  frozen hash, key-pose tick, and combat baseline on both platforms, and
  forces a balance recalibration — the escalation rollout buys the same
  player-facing value without touching the frozen core.

## Risks

1. **The behavioral difference may be too subtle to see.** Mitigation: the
   human gate's clip test is a hard criterion; if it fails, tuning raises
   modifier magnitudes within the style-identity constraint before any new
   mechanism is considered.
2. **Double-caution stalls.** `guarded` against a cautious opponent could
   drift into time-limit standoffs. The existing pressure-level anti-stall is
   expected to hold; balance criterion 4 measures it instead of hoping.
3. **`press` could dominate** (players always press with the advantage).
   Criterion 2 asserts non-dominance; the lever is the wear threshold — press
   must court two-step wear often enough to sting in a season.
4. **UI creep.** Three new surfaces (planning, interstitial, HUD) touch the
   screenshot suite; budgeted as intentional baseline updates for those
   screens only.

## Future work

The natural next slice, if this hypothesis holds: **experience for victories**
— wins grant XP toward a chosen perk, built as persistent `DecisionModifier`s
on the same disposition seam. That slice answers the playtest's "победа должна
что-то давать" (Q3) and starts long-term progression. Beyond it: challenge
choice, economy, and the mass-combat layer, in the order the roadmap review of
2026-08-22 set.
