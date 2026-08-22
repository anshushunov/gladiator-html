# School Season Meta-Loop — Playtest Script

**Status: prepared, not yet run.** Every answer section below is empty. This
document is the script for a human playtest of the season slice (PR #12), not
its result.

The automated evidence — 671 unit tests, 47 e2e on two platforms, five balance
criteria over 200-seed cohorts and a golden season pinned bout-by-bout — proves
the season *behaves* as specified. It cannot tell us whether the decision it
adds is interesting. That is what this script is for.

## Product hypothesis under test

> A player will keep making the lineup decision when a gladiator's condition
> carries across series and the roster is larger than the three slots, because
> the best available matchup now costs a resource that a later challenge will
> need.

Two qualities, from the design doc:

1. **Cost** — committing a gladiator is always paid for; there is no free bout.
2. **Tension** — by the third challenge the roster cannot field the lineup the
   player would have chosen fresh.

## Setup

```bash
npm run dev            # http://127.0.0.1:4173
```

Play at `http://127.0.0.1:4173/?seed=20260815` for the scripted runs below —
that seed is the one every fixture and balance cohort uses, so what you see is
directly comparable to the numbers in the tests. For the free-play run, drop the
parameter entirely and let the app roll its own seed.

Everything below is played with **mouse and keyboard only**. Do not open the dev
console: `window.__GLADIATOR_TEST__` can drive the season directly, and using it
would skip the exact interactions this playtest is meant to judge.

## Run A — the scripted season (≈10 min)

Seed `20260815`, three lineups, in this order:

| Series | Slot I | Slot II | Slot III |
|---|---|---|---|
| 1 | Brutus | Aquila | Nerva |
| 2 | Vitus | Sura | Brutus |
| 3 | Aquila | Nerva | Vitus |

This is the season the balance suite pins. Expected outcome: **2–7**, with
Brutus reaching `broken` after series 2. If your run diverges from that, stop
and say so — it means determinism broke, which is a bug, not a playtest note.

Before confirming each lineup, write down which gladiator you *wanted* to field
and could not. That note is the tension measurement; everything else is
commentary.

## Run B — the forfeit path (≈7 min)

Seed `20260815`. Field **Brutus, Aquila, Nerva** in series 1 and again in
series 2 — the greedy read, since those three are the strongest on paper.

By series 3 all three are `broken`, only Vitus and Sura are fit, and the
planning screen will state that one slot will be forfeited. Assign both, confirm,
and watch a series that includes a bout nobody fights.

The question this run answers: does losing a slot read as *the consequence of a
choice you made two series ago*, or as the game breaking?

## Run C — free play (≈10 min)

No `?seed`. Play a whole season however you like, then use **Rematch season** and
play the same seed again with a different plan. The second run is where the
hypothesis actually lives: if the replay feels like the same session repeated,
the slice has failed regardless of how the first one felt.

## What to record

Answer in your own words — one or two sentences each. Bare yes/no answers make
the whole exercise useless.

### Cost

1. When you committed your best gladiator to a favourable matchup, did the price
   feel real, or negligible?
2. The card tells you what fighting will cost *before* you confirm. Did the
   result match what the card promised? Note any case where it did not.
3. A dominant win still costs one condition step. Did that read as fair, or as
   the game taking something it should not?

### Tension

4. Was there a series where you fielded a lineup you did not want? Which one, and
   what did you want instead?
5. By challenge 3, did the roster feel worn in a way you had caused — or in a way
   that just happened to you?
6. Did you ever deliberately bench a strong gladiator to save them for later? If
   not, was that because it never seemed worth it, or because it never occurred
   to you?

### Readability

7. Could you tell, from the board alone, which challenge was harder and why?
8. Did the condition ladder (`fresh` → `bruised` → `wounded` → `broken`) read
   clearly, or did you have to infer what a step meant?
9. Did a worn gladiator's shorter HP bar register during the bout, or only on
   the card beforehand?

### The whole loop

10. After the season summary, did you want to play another season? Why or why not?
11. What was the most interesting decision you made all session?
12. What did you expect to be able to do and could not?

## Known rough edges — do not report these, they are already logged

- Nothing outstanding. The four edges found while preparing this script — a
  duplicated `broken, or broken` telegraph, an empty `Fresh → Fresh` delta row,
  a stale instruction line after assigning a gladiator, and broken gladiators
  vanishing from the planning grid instead of showing as disabled cards — were
  fixed before this script was handed over. If you see any of them, that is a
  regression worth reporting.

## Reviewer log

*(Empty until a human plays. One row per run.)*

| Reviewer | Run (A/B/C) | Final score | Wanted-but-couldn't-field moments | Deliberate benching? | Wanted another season? | Notes |
|---|---|---|---|---|---|---|
| | | | | | | |
| | | | | | | |

## Verdict

*(To be filled in after the runs. The slice passes if at least one reviewer
reports a lineup they did not want to field and can name what they wanted
instead — that is quality 2 — and if nobody reports the cost of a bout as
negligible — that is quality 1.)*
