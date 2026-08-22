# Bout Orders & Temperaments — Playtest Script

**Status: not yet run.** This script has not been handed to a reviewer.
Same format as `2026-08-22-school-season-playtest.md`: scripted runs, a
question set grouped by the qualities the slice must deliver, a reviewer log,
and verdict criteria. Fill in "Reviewer log" / "Reviewer answers" / "Verdict"
once a session happens.

The automated evidence — `dispositionBalance.test.ts`'s four balance
criteria over a 200-seed cohort, `tests/orders.spec.ts`'s e2e coverage of the
order UI, and the frozen-hash suites proving `standard` changed nothing —
proves the mechanic *behaves* as specified. It cannot tell us whether picking
an order reads as a real decision, or whether a viewer can actually see one
on screen. That is what this script is for.

## Product hypothesis under test

> A player will treat the pre-bout order as a real decision — not a fourth
> stat to ignore — because it visibly changes how a fighter moves, and because
> the wear it buys or spends shows up later in the season as a consequence of
> that choice.

Three qualities, from the design doc's "Human playtest gate":

1. **Agency** — the player can name a bout where they chose a non-`standard`
   order for a reason (the opponent's score, temperament, or their own
   fighter's condition).
2. **Visibility** — with the on-screen order/temperament text hidden, a
   viewer can still tell `press` from `guarded` from movement alone.
3. **Attribution** — the player can point to a wear outcome and describe it
   as caused by their own order choice, not something that "just happened" —
   the exact gap `2026-08-22-school-season-playtest.md` Q5 found in the
   season slice before orders existed.

## Setup

```bash
npm run dev            # http://127.0.0.1:4173
```

Play at `http://127.0.0.1:4173/?seed=20260815` for Run A — the same seed
every fixture and balance cohort uses, so what you see is directly comparable
to the numbers in the tests and in the appendix below. For Run B, drop the
parameter and let the app roll its own seed.

Everything below is played with **mouse and keyboard only**. Do not open the
dev console: `window.__GLADIATOR_TEST__` can set an order or drive the season
directly, and using it would skip the exact interactions this playtest is
meant to judge. The one exception is the HUD-hidden exercise below, which
asks you to obscure text on screen with your own hand or a sticky note — not
to touch the console.

## Run A — the scripted season with orders (≈12 min)

Seed `20260815`, the same three lineups as the school-season script:

| Series | Slot I | Slot II | Slot III |
|---|---|---|---|
| 1 | Brutus | Aquila | Nerva |
| 2 | Vitus | Sura | Brutus |
| 3 | Aquila | Nerva | Vitus |

This time, set an order for every bout. Use this table as a starting script —
you may deviate, but note where and why if you do:

| Series | Bout | Fighter vs opponent | Opponent temperament (challenge) | Suggested order | Reason to try |
|---|---|---|---|---|---|
| 1 | I | Brutus vs Drusus | Steady (ch. 1) | Press | Heavy beats fast — push the counter-triangle advantage while Brutus is fresh. |
| 1 | II | Aquila vs Cassius | Steady (ch. 1) | Press | Fast beats technical — same idea, still fresh. |
| 1 | III | Nerva vs Magnus | Steady (ch. 1) | Standard | Also favourable, but keep one bout as a baseline before trying the other two orders. |
| 2 | I | Vitus vs Drusus | Aggressive (ch. 2) | Guarded | Opponent is scaled up and pressing; Vitus is the bench specialist here, not a veteran — play it safe. |
| 2 | II | Sura vs Cassius | Cautious (ch. 2) | Press | Favourable matchup against an opponent who is himself playing cautious — push it. |
| 2 | III | Brutus vs Magnus | Steady (ch. 2) | Guarded | Second bout of the series for Brutus — conserve him for series 3. |
| 3 | I | Aquila vs Drusus | Aggressive (ch. 3) | Guarded | Mirror-archetype matchup (fast vs fast) against an aggressive opponent — no counter-triangle help here. |
| 3 | II | Nerva vs Cassius | Cautious (ch. 3) | Standard | Mirror-archetype matchup (technical vs technical), both sides cautious. |
| 3 | III | Vitus vs Magnus | Aggressive (ch. 3) | Press | Final, deciding bout — commit. |

Before confirming each order, write down *why* you picked it (or why you
deviated from the table) — that note is what Q1–Q3 below are asking for, not
a post-hoc rationalisation.

You can change the order for the next pending bout from the interstitial
screen between bouts, not only at planning — try it at least once mid-series.

## Run B — ordered season vs. all-standard season (≈15 min)

No `?seed`. Play a whole season leaving every order at the default
`Standard`. Note the final score and how each veteran ended up (condition
step). Then use **Rematch season** — same seed, same opponents — and play it
again, this time actively choosing `press`/`guarded` where you see a reason
to. Compare the two: same matchups, same opponents, different orders.

The question this run answers: does the ordered replay feel like a different
season, or like the same session with an extra click per bout?

## HUD-hidden identification exercise (≈5 min, do this once, either run)

Pick two bouts you already fought in Run A or B — one where the home fighter
was under `press`, one where they were under `guarded`. Ask a second person
to replay those two bouts (`advanceTicks`/scrub is fine for them to drive, or
just watch you replay them) with the order/temperament status line and the
order-selector labels covered — your hand, a sticky note, or the browser
window resized so the text rows are off-screen, whichever is easiest. Without
being told which is which, can they name which clip is `press` and which is
`guarded` from the fighters' movement alone (tempo of closing/retreating,
willingness to commit to a heavy swing) with no other information?

## What to record

Answer in your own words — one or two sentences each. Bare yes/no answers
make the whole exercise useless.

### Agency (gate criterion 1)

1. Name one bout where you chose a non-`standard` order. What was the reason
   — the opponent's temperament, your fighter's condition, the matchup, or
   something else?
2. Was there a bout where you *wanted* to change the order but the game
   would not let you (a resolved bout, or a bout beyond the next one)? Did
   `order-locked` read as a rule or as a bug?
3. Did the order ever feel like a fourth stat you set once and forgot, rather
   than a decision you kept revisiting?

### Visibility (gate criterion 2)

4. In the HUD-hidden exercise, could you (or your second reviewer) correctly
   tell `press` from `guarded`? What gave it away, if anything?
5. Separately, with the HUD visible during ordinary play: did the chosen
   order visibly change how a fighter moved, or did you only know from the
   text label?

### Attribution (gate criterion 3)

6. Point to one wear outcome (a condition step, a forfeited slot, a
   surprising loss) and say whether it reads as caused by an order you chose,
   or as something that just happened to you.
7. In Run B, did the all-standard season and the ordered season feel like
   different seasons, or the same season played twice?
8. Did opponent temperament (Steady/Aggressive/Cautious) change how hard a
   bout felt? Did it make you reconsider which order to use, or just how
   worried to be?

### The whole loop

9. After Run A or B, did you want to play another ordered season? Why or why
   not?
10. What was the most interesting order decision you made all session?
11. What did you expect the order to do and it did not?

## Known rough edges — do not report these, they are already logged

- Nothing outstanding at time of writing. If you hit a UI bug (a stale
  telegraph line, a badge that does not update, an order that silently fails
  to apply), that is worth reporting — it has not been seen before.

## Reviewer log

| Reviewer | Run (A/B) | Named bout + reason (Q1) | HUD-hidden result (Q4) | Attribution example (Q6) | Wanted another ordered season? | Notes |
|---|---|---|---|---|---|---|
| _(not yet run)_ | | | | | | |

## Reviewer answers

_(not yet run — record verbatim once a session happens, as
`2026-08-22-school-season-playtest.md` does.)_

## Verdict

_(not yet run.)_ The slice passes the human playtest gate when at least one
reviewer, per the spec's "Human playtest gate":

1. names a bout where they chose a non-`standard` order *for a reason*
   (score, temperament, or the fighter's condition) — the agency quality;
2. with the HUD hidden, correctly identifies which fighter is under `press`
   and which under `guarded` in a prepared pair of clips — the visibility
   quality;
3. describes at least one wear outcome as caused by their own order choice —
   the attribution quality that Q5 found missing in the school-season
   playtest.

---

## Appendix — balance evidence behind the amended acceptance criteria

The spec's "Balance acceptance" section amends three of the four original
balance criteria, citing measurement done in
`.superpowers/sdd/2026-08-22-bout-orders/task-5-report.md`. That file lives
under a git-ignored scratch directory and is deleted when this plan
finishes, so it leaves no record in the repository once Task 9 lands. This
appendix reproduces the load-bearing numbers verbatim — copied, not
re-derived or rounded — so the reasoning survives.

All measurements below: 200 consecutive seeds from `20260815`,
`COMMITTED_ADJUST = 6`, `LOCOMOTION_ADJUST = 4` (the shipped constants —
unchanged by this measurement). Cohort A is 3 veterans × 3 unscaled opponents
× home order ∈ {standard, press, guarded} (27 cells); cohort B is 3 veterans
× Cassius with away temperament ∈ {press, guarded} × the same 3 home orders
(18 cells); cohort C is all 9 pairings with both sides `guarded`, compared
against cohort A's `standard` row (9 cells).

### The metric grid, as first measured (report §2)

`lowHp%` here is the *original* metric, `share(homeRemainingHpRatio < 0.25)`
— it counts every loss as a low-HP outcome (the loser is at 0 HP), which is
exactly the property that made criterion 1 unsatisfiable (see below). It was
later replaced by `bloodyWinShare = share(homeWon && ratio < 0.25)`, which
counts only bloody *wins*.

**Cohort A — pairing × home order**

```
       pairing     order   win%  lowHp%  cheap%  timeout%  median
 brutus/drusus  standard  65.0%   65.0%   35.0%      0.0%    1869
 brutus/drusus     press  75.0%   59.0%   41.0%      0.0%    1849
 brutus/drusus   guarded  62.0%   74.5%   25.5%      0.0%    1957
brutus/cassius  standard  58.0%   70.5%   29.5%      0.0%    1571
brutus/cassius     press  82.5%   41.5%   58.5%      0.0%    1766
brutus/cassius   guarded  34.0%   83.0%   17.0%      0.0%    1594
 brutus/magnus  standard  81.5%   51.5%   48.5%      0.0%    1470
 brutus/magnus     press  85.0%   52.5%   47.5%      0.0%    1457
 brutus/magnus   guarded  74.0%   54.5%   45.5%      0.0%    1575
 aquila/drusus  standard  15.0%   93.5%    6.5%      0.0%    1967
 aquila/drusus     press  24.5%   91.5%    8.5%      0.0%    1891
 aquila/drusus   guarded   5.0%   99.0%    1.0%      0.0%    2022
aquila/cassius  standard  35.0%   86.5%   13.5%      0.0%    1526
aquila/cassius     press  49.5%   79.5%   20.5%      0.0%    1489
aquila/cassius   guarded  23.5%   91.5%    8.5%      0.0%    1550
 aquila/magnus  standard  26.5%   87.5%   12.5%      0.0%    1859
 aquila/magnus     press  42.5%   75.5%   24.5%      0.0%    1770
 aquila/magnus   guarded   9.0%   96.5%    3.5%      0.0%    1855
  nerva/drusus  standard  50.0%   80.0%   20.0%      0.0%    1595
  nerva/drusus     press  43.0%   83.0%   17.0%      0.0%    1581
  nerva/drusus   guarded  34.0%   86.5%   13.5%      0.0%    1701
 nerva/cassius  standard  55.0%   69.0%   31.0%      0.0%    1272
 nerva/cassius     press  60.0%   68.5%   31.5%      0.0%    1293
 nerva/cassius   guarded  70.0%   56.5%   43.5%      0.0%    1281
  nerva/magnus  standard  75.0%   46.5%   53.5%      0.0%    1558
  nerva/magnus     press  72.5%   50.0%   50.0%      0.0%    1595
  nerva/magnus   guarded  76.5%   44.5%   55.5%      0.0%    1639
```

**Cohort B — veteran × home order × Cassius's temperament**

```
veteran     order  cassius   win%  lowHp%  cheap%  timeout%  median
 brutus  standard    press  56.5%   70.0%   30.0%      0.0%    1604
 brutus     press    press  82.0%   47.0%   53.0%      0.0%    1739
 brutus   guarded    press  41.0%   82.5%   17.5%      0.0%    1673
 brutus  standard  guarded  57.0%   68.0%   32.0%      0.0%    1651
 brutus     press  guarded  82.5%   37.0%   63.0%      0.0%    1840
 brutus   guarded  guarded  48.5%   79.0%   21.0%      0.0%    1688
 aquila  standard    press  35.0%   86.5%   13.5%      0.0%    1475
 aquila     press    press  53.0%   76.5%   23.5%      0.0%    1448
 aquila   guarded    press  15.5%   96.0%    4.0%      0.0%    1439
 aquila  standard  guarded  42.5%   81.5%   18.5%      0.0%    1640
 aquila     press  guarded  64.0%   67.0%   33.0%      0.0%    1558
 aquila   guarded  guarded  29.5%   87.0%   13.0%      0.0%    1657
  nerva  standard    press  68.5%   58.0%   42.0%      0.0%    1291
  nerva     press    press  64.5%   60.5%   39.5%      0.0%    1295
  nerva   guarded    press  74.5%   51.5%   48.5%      0.0%    1271
  nerva  standard  guarded  55.0%   70.0%   30.0%      0.0%    1280
  nerva     press  guarded  49.0%   70.5%   29.5%      0.0%    1296
  nerva   guarded  guarded  70.0%   55.5%   44.5%      0.0%    1301
```

**Cohort C — both sides guarded, against cohort A's standard**

```
       pairing  guarded win%  guarded lowHp%  guarded cheap%  guarded timeout%  guarded median  std timeout%  std median
 brutus/drusus         89.5%           38.5%           61.5%              0.0%            2089          0.0%        1869
brutus/cassius         48.5%           79.0%           21.0%              0.0%            1688          0.0%        1571
 brutus/magnus         78.0%           51.0%           49.0%              0.0%            1641          0.0%        1470
 aquila/drusus         14.5%           95.0%            5.0%              1.0%            2341          0.0%        1967
aquila/cassius         29.5%           87.0%           13.0%              0.0%            1657          0.0%        1526
 aquila/magnus          9.5%           98.0%            2.0%              0.0%            1999          0.0%        1859
  nerva/drusus         55.0%           71.0%           29.0%              0.0%            1773          0.0%        1595
 nerva/cassius         70.0%           55.5%           44.5%              0.0%            1301          0.0%        1272
  nerva/magnus         83.5%           35.0%           65.0%              0.0%            1576          0.0%        1558
```

### The four original criteria, as scored (report §3)

**Criterion 1 — Risk/reward is real → FAIL (5 violations)**

| clause | required | measured | verdict |
|---|---|---|---|
| every pairing `press.win >= std.win - 0.02` | — | fails on `nerva/drusus` (43.0% vs 50.0%) and `nerva/magnus` (72.5% vs 75.0%) | FAIL |
| every pairing `guard.win <= std.win + 0.02` | — | fails on `nerva/cassius` (70.0% vs 55.0%) | FAIL |
| `mean(press.win - std.win)` | ≥ 0.03 | **+0.082** | pass |
| `mean(std.win - guard.win)` | ≥ 0.03 | **+0.081** | pass |
| `mean(press.lowHp - std.lowHp)` | ≥ 0.03 | **−0.054** | FAIL |
| `mean(std.lowHp - guard.lowHp)` | ≥ 0.03 | **−0.041** | FAIL |

**Criterion 2 — No dominant order → PASS**

No order maximizes `homeWinRate` and `cheapWearShare` simultaneously on all
nine pairings. `press` takes six of nine on win rate but loses all three
Nerva pairings; `guarded` takes `nerva/cassius` and `nerva/magnus`;
`standard` takes `nerva/drusus`. Held in all 20 magnitude cells swept —
this criterion is comfortably satisfied and is the one that says the
mechanic is a real choice.

**Criterion 3 — Temperament changes the answer → FAIL**

All three veterans keep the same ranking against `cassius@press` and
`cassius@guarded`:

- brutus: `press > standard > guarded` (82.0/56.5/41.0 and 82.5/57.0/48.5)
- aquila: `press > standard > guarded` (53.0/35.0/15.5 and 64.0/42.5/29.5)
- nerva: `guarded > standard > press` (74.5/68.5/64.5 and 70.0/55.0/49.0)

**Criterion 4 — No stall collapse → FAIL (1 violation)**

- Timeout caps: all nine pass, and not narrowly — the worst both-guarded
  timeout rate is 1.0% (`aquila/drusus`) against a 30.0% floor cap. Mutually
  guarded bouts do not stall out.
- Median band 1500..2400: eight of nine pass; `nerva/cassius` runs a median
  of **1301** ticks, 199 below the floor.

### The 20-cell magnitude sweep (report §5)

Every cell below is cohort A over 60 consecutive seeds from `20260815` (1620
bouts per cell; direction of every metric matched the 200-seed confirmation
run at the shipped magnitudes). `Δwin` columns are the criterion-1 means that
must reach +0.030; `Δlow` likewise (original `lowHpShare` metric). `viol` is
the number of per-pairing violations (press / guard).

| CA | LA | Δwin press−std | Δwin std−guard | **Δlow press−std** | **Δlow std−guard** | bloody p/s/g | viol | C2 |
|---:|---:|---:|---:|---:|---:|---|---|---|
| 4 | 3 | +0.065 | +0.057 | **−0.050** | **−0.078** | 24.6/23.1/25.2 | 2/1 | ok |
| 4 | 4 | +0.098 | +0.074 | **−0.056** | **−0.074** | 27.4/23.1/23.1 | 2/1 | ok |
| 4 | 5 | +0.074 | +0.087 | **−0.046** | **−0.065** | 25.9/23.1/20.9 | 2/1 | ok |
| 4 | 6 | +0.100 | +0.143 | **−0.044** | **−0.087** | 28.7/23.1/17.6 | 2/0 | ok |
| 5 | 3 | +0.063 | +0.061 | **−0.056** | **−0.057** | 23.9/23.1/22.8 | 2/1 | ok |
| 5 | 4 | +0.093 | +0.083 | **−0.057** | **−0.072** | 26.7/23.1/22.0 | 2/1 | ok |
| 5 | 5 | +0.083 | +0.070 | **−0.048** | **−0.048** | 26.7/23.1/20.9 | 2/1 | ok |
| 5 | 6 | +0.098 | +0.137 | **−0.061** | **−0.087** | 26.9/23.1/18.1 | 2/0 | ok |
| 6 | 3 | +0.057 | +0.059 | **−0.043** | **−0.052** | 24.6/23.1/22.4 | 1/1 | ok |
| **6** | **4** | +0.087 | +0.087 | **−0.063** | **−0.067** | 25.6/23.1/21.1 | 2/1 | ok |
| 6 | 5 | +0.104 | +0.067 | **−0.067** | **−0.067** | 26.9/23.1/23.1 | 2/2 | ok |
| 6 | 6 | +0.137 | +0.115 | **−0.080** | **−0.080** | 28.9/23.1/19.6 | 1/0 | ok |
| 7 | 3 | +0.094 | +0.080 | **−0.065** | **−0.065** | 26.1/23.1/21.7 | 2/1 | ok |
| 7 | 4 | +0.093 | +0.082 | **−0.078** | **−0.074** | 24.6/23.1/22.4 | 2/1 | ok |
| 7 | 5 | +0.115 | +0.091 | **−0.076** | **−0.059** | 27.0/23.1/20.0 | 2/0 | ok |
| 7 | 6 | +0.161 | +0.137 | **−0.106** | **−0.093** | 28.7/23.1/18.7 | 1/0 | ok |
| 8 | 3 | +0.093 | +0.094 | **−0.070** | **−0.074** | 25.4/23.1/21.1 | 2/1 | ok |
| 8 | 4 | +0.119 | +0.111 | **−0.074** | **−0.089** | 27.6/23.1/20.9 | 2/1 | ok |
| 8 | 5 | +0.115 | +0.102 | **−0.082** | **−0.091** | 26.5/23.1/22.0 | 2/0 | ok |
| 8 | 6 | +0.126 | +0.144 | **−0.104** | **−0.107** | 25.4/23.1/19.4 | 2/0 | ok |

The bold `6, 4` row is the shipped magnitude (`COMMITTED_ADJUST = 6`,
`LOCOMOTION_ADJUST = 4`). Every `Δlow` column is negative in every cell — no
in-range magnitude even changes the *sign* of criterion 1's original HP
clause, let alone reaches +0.030. The trend is monotone in the wrong
direction: stronger magnitudes widen the win gap faster than the bloody-win
gap, so they make the clause fail harder. This is the evidence behind the
spec's statement that criteria 1, 3 and 4, as first written, are not
satisfiable by any magnitude in range, for reasons that are properties of the
metrics rather than of the mechanic — and behind the headline finding: no
in-range magnitude ever reordered which order is best against Cassius under
either temperament (criterion 3, cohort B), because temperament shifts a
veteran's win rate against all three orders in the same direction rather than
reordering them. Opponent temperament changes how hard a bout is; it does not
change which order is best — that is decided by the counter triangle, i.e. by
*who* you fight, not by *how they fight*.

The amended criteria that replaced these (final wording in the spec's
"Balance acceptance") pass at the shipped magnitudes with no tuning:
`mean(press.bloodyWinShare - std.bloodyWinShare) = +0.0272` against a
`+0.020` floor, `mean(std.bloodyWinShare - guard.bloodyWinShare) = +0.0406`
against the same floor, `mean(|winRate(cassius@press) -
winRate(cassius@guarded)|) = +0.0828` against a `+0.050` floor (criterion 3,
restated as "temperament changes the difficulty" rather than "changes the
answer"), and the median band widened to `balance.test.ts`'s own per-pairing
`1200..2700`, which the measured `1301..2341` span clears on both ends.
