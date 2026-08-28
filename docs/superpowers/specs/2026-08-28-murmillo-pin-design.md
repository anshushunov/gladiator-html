# The Murmillo Pin — Design

**Status:** first revision, 2026-08-28. Not yet reviewed.

**Entry point:** `docs/reviews/2026-08-27-retiarius-reach-playtest.md`, whose
closing finding was:

> the slice fixed the retiarius' reach and did not fix the murmillo's ability to
> ignore it

**Working history:** `docs/superpowers/plans/2026-08-28-murmillo-journal.md`,
which records every measurement below as it was taken, including the two that
reversed under checking.

---

## 1. The finding does not survive measurement, and what replaces it

The playtest's framing is that the retiarius fights the murmillo too close. That
reproduces. It is also not a defect, and establishing that took the slice's first
two days.

### 1.1 The distance finding is real and is not a defect

Built for this: `scripts/measure-distance.ts` and
`src/testSupport/distanceHarness.ts`. Separation on every tick, per ordered
matchup, over the same equal-stat cohort and seed range `measure-reach.ts` uses,
counted after the opening approach. 200 seeds.

| matchup | median | below 1.60 | ≤1.70 | home wins |
|---|---:|---:|---:|---:|
| `fast vs heavy` | 1.63 | 47.8% | **54.3%** | 36.0% |
| `fast vs fast` | 2.26 | 22.2% | 26.3% | 49.5% |
| `fast vs technical` | 2.11 | 23.2% | 28.5% | 72.0% |
| `technical vs heavy` | 1.44 | 69.6% | **81.1%** | 55.0% |

The retiarius does fight the murmillo at roughly twice the closeness he fights
anyone else. **And the hoplomachus fights the same murmillo half again closer
still — 81.1% against 54.3% — and wins at 55.0%,** because the counter triangle
(`fighters.ts:17-21`) is `heavy → fast → technical → heavy`.

So a share of time inside the murmillo's envelope ranks the counter *below* the
thing it counters. It measures how hard the murmillo drags people in, which is
his archetype working. Every win rate is inside design.md's bands — 64.5%, 72.0%
and 55.0% for the advantaged styles, 50.0 / 49.5 / 51.0 for the mirrors — and
`balance.test.ts` passes at 500 seeds per ordered matchup.

**Decided by the design owner, 2026-08-28: the slice targets the mechanics that
fail, not the fighting distance.** Time-at-distance is reported and is not a
criterion.

### 1.2 The lunge's geometry failures are withdrawn, and the withdrawal is
### written here so nobody rediscovers it as news

A draft of this document claimed the retiarius' committed attack whiffs
pathologically against the murmillo — 48.0% against 27.9%. That was a 50-seed
number quoted as a result. At 200 seeds:

| the retiarius' committed attack, geometry failures | |
|---|---:|
| `fast vs heavy` | 47.3% |
| `fast vs fast` | 47.0% |
| `fast vs technical` | 29.0% |
| **the hoplomachus' committed attack in `technical vs heavy`** | **54.7%** |

The mirror matches the murmillo, so the murmillo does not cause it; the pattern
is "against anyone who moves", and the hoplomachus — who holds his measure — is
simply the one opponent the lunge reliably reaches. And against the same
murmillo the hoplomachus' own committed attack fails *more*. The retiarius
whiffs less than the type he is asked to resemble, in the matchup where he was
alleged to whiff pathologically.

Not a defect. Recorded because it was believed for an afternoon.

---

## 2. The defect

**The retiarius' forced disengage runs constantly against the murmillo and
almost never completes.**

200 seeds, equal-stat cohorts, from `measure-reach.ts`'s existing per-matchup
disengage records:

| the retiarius' escape | vs murmillo | vs hoplomachus | mirror |
|---|---:|---:|---:|
| episodes | 948 | 608 | 859 |
| **reaching the 3.35 exit range** | **1.6%** | 31.7% | 67.2% |
| ending on the 37-tick cap | 95.7% | 65.8% | 30.6% |
| **median ground opened** | **0.659** | 0.954 | 0.833 |

He gives ground about 2.4 times a bout, at 1.9× the speed the murmillo closes
at, and it works sixteen times in a thousand.

### 2.1 Why this criterion is trustworthy where the previous two were not

Both withdrawn findings failed the same way: they compared the retiarius to a
yardstick that turned out to be measuring something else. This one cannot.

- **It needs no comparator at all.** All three columns are one mechanic,
  belonging to one archetype, measured across his three opponents. There is
  nothing for the subject to be coupled to, which is the defect class that
  produced four bad comparators in the previous slice and two more here.
- **The margin is forty-fold**, not a few points.
- **The mechanism is arithmetic, and it closes.** 37 ticks at 2.7 units/second is
  1.67 units of travel; the murmillo spends the same 37 ticks closing 0.86; the
  difference is 0.81 and the measured net is 0.659, the remainder being facing
  and the ticks he is not advancing. Covering the ~1.9 units from a pin out to
  3.35 at that net rate needs roughly **185 ticks** against a cap of **37**.

### 2.2 Why the constant is wrong, in its own words

`combatDecision.ts:969` records how 3.35 was chosen:

> the authored 2.4 sits 0.95 above the authored lunge's contact max of 1.45, and
> the same gap above 2.40 is 3.35

That is an arithmetic identity preserved across a content change. It is a
reasonable way to keep a relationship intact and it never asked the operative
question: *can a fighter who is being chased actually reach it?* Against the two
opponents who do not chase, it can — 67.2% and 31.7%. Against the one archetype
whose decision weights make him close continuously (`advance` 12 **and**
`pressure` 12, `retreat` **0**, `combatStyles.ts:26-35`), it cannot.

**One constant is serving two situations and was calibrated on the easy one.**

---

## 3. Hypothesis

> Fast's forced disengage fails against the murmillo because its exit condition
> is a fixed distance, and a fixed distance is a promise about the world that a
> pursuing opponent can simply refuse. Making the exit reachable against pursuit
> — without making it trivially reachable against an opponent who is not pursuing
> — restores the mechanic in the matchup it exists for, and does so without
> touching fighting distance, the balance bands, or the murmillo.

The slice does **not** claim this will move time-at-distance. On the evidence in
§1 it probably should not move it much, and a candidate that moves it a lot
should be suspected of having changed the matchup rather than the mechanic.

---

## 4. What is measured, and with what

| instrument | status in this slice | what it answers |
|---|---|---|
| `scripts/measure-reach.ts` | **frozen, closed** | gates A–G, unchanged. The reach claim of the previous slice must not regress. |
| `scripts/measure-distance.ts` | new, authored in PR-1 | where the fight happens, per pair. Reported, not gated. |
| per-pair disengage statistics | **owed, PR-2** | the criteria below. The data already exists in `measure-reach.ts`'s per-matchup records and its `--json`; only the printing and the gate are missing. |

### 4.1 The instrument gap this slice must close, and the ordering that makes it honest

Gate E is pooled, and pooling is why nobody saw this. Its three clauses read
2.9%, 37 ticks and 0.775 units against bars of 5%, 24 and 0.75 — all green. Per
pair the components disagree with each other and with the pooled figure:

| | pooled (what gate E reads) | vs murmillo | mirror |
|---|---:|---:|---:|
| median ground opened, bar ≥0.75 | **0.775** ✔ | **0.659** | 0.833 |
| cleared within one tick, bar ≤5% | **2.9%** ✔ | 0.3% | **7.8%** |

Each clause is carried over its bar by the matchup the *other* clause fails on.
The pooled number describes no matchup that exists.

This is not asserted as a gate failure: the bars were measured pooled on the
authored content, so holding a per-pair figure against them would be the same
like-for-like error being described. It is asserted as a criterion defect —
**the clause written specifically to catch an escape that runs without opening
ground is blind to one.**

**The ordering matters and is deliberate.** Re-expressing gate E means editing
`measure-reach.ts`, which is the instrument producing this slice's baselines,
and the previous slice's rule is that an instrument may not be adjusted in the
diff whose numbers it produces. The baselines above were measured on the
unmodified file and committed to the journal *before* it is opened, so the bars
in §5 cannot be retro-fitted to a result. `scripts/check-allowlist.sh` closes
`measure-reach.ts` in PR-1 for exactly this reason, and the negative control is
verified: a whitespace change to it is rejected.

### 4.2 Three PRs, not two

The repository's convention is a preparatory PR and a content PR. This slice
needs three, and the reason is the convention's own:

1. **PR-1 — the distance instrument.** `measure-distance.ts`,
   `distanceHarness.ts` and its regressions, the rebuilt boundary. Claim:
   *adds an instrument, changes nothing it measures.* `src/simulation/**`,
   `src/content/**` and `measure-reach.ts` all closed.
2. **PR-2 — the criteria.** Gate E re-expressed per pair in `measure-reach.ts`,
   plus the frozen gates in §5. Claim: *changes the criteria, changes nothing
   they judge.* `src/content/**` and `src/simulation/**` stay closed.
3. **PR-3 — the content.** The change itself, judged by a boundary and by
   criteria that two earlier merged diffs wrote.

Two PRs would put the gate and the change it judges in one diff, which is the
thing the two-PR convention exists to prevent. Three is the same rule applied
once more.

---

## 5. Acceptance gates, frozen before implementation

All at 200 seeds, equal-stat cohorts, seeds from `BASELINE_TEST_SEED`, nine
ordered matchups. Every bar names its source. Baselines are the shipped content,
measured before any candidate existed.

### P. The escape must work against the opponent it exists for *(the defect detector)*

> In `fast vs heavy` and `heavy vs fast` together, the share of Fast's forced
> disengage episodes ending by reaching the exit range is at least **25%**.

- **Source:** the same mechanic's own performance against its other opponents.
  It measures 31.7% against the hoplomachus and 67.2% in the mirror; 25% is
  below the lower of the two, deliberately, because this matchup is the hard one
  and the gate must not require parity with an unpursued escape.
- **Independent?** Yes, and this is the point: subject and yardstick are the same
  archetype's same mechanic. Nothing here can move with the thing it judges.
- **Fails today:** 1.6%.
- **What counts as failure:** anything below 25%, including a candidate that
  raises the pooled figure while leaving this matchup where it is.

### Q. The ground must actually be opened, per pair and not pooled

> In those same two matchups, the median separation gained per episode is at
> least **0.75** units.

- **Source:** gate E's own existing floor, `DISENGAGE_GAIN_FLOOR`, applied per
  pair instead of pooled. The number is not new and is not chosen here.
- **Fails today:** 0.659.
- **Why both P and Q:** either alone is satisfiable the wrong way. Ground alone
  can be bought with a longer cap while the exit stays unreachable — the
  measured 185-tick figure says how much longer. Completion alone can be bought
  by moving the exit close enough to be crossed on the tick the forcing starts,
  which is what gate E's first clause already forbids and what §5's gate R keeps
  forbidding per pair.

### R. It must not become an instant escape anywhere *(the counter-lever)*

> In **every** matchup containing a Fast fighter, the share of episodes clearing
> within one tick is at most **8%**.

- **Source:** the worst matchup on the shipped content — the mirror, at 7.8% —
  rounded up to the 1% grid. This is a bar the current content only just meets,
  and it is set there on purpose: gate E's pooled 5% is met at 2.9% only because
  four matchups average away a mirror that is already over it.
- **Note against myself:** this bar is *looser* than gate E's pooled 5%. It has
  to be, because 5% pooled is not 5% per pair and the shipped content does not
  meet 5% per pair today. Tightening it to 5% would fail the authored build,
  which is a gate charging this slice for behaviour it did not create.
- **Passes today** at 7.8%, and is the gate most likely to be broken by a
  candidate that lowers the exit range. The previous slice measured exactly that
  at exit 3.00 and rejected the candidate on it — **using the pooled figure**,
  which the table in §4.1 shows is dominated by the mirror. That rejection is
  therefore not evidence against a lowered exit *in the murmillo matchup*, and
  re-measuring it per pair is a named task rather than an assumption.

### S. The reach claim of the previous slice does not regress

> `measure-reach.ts --seeds 200 --gate` continues to pass, unmodified in its
> A–G clauses.

- **Source:** the previous slice's frozen gates. Baseline: all pass, with
  retiarius whole-type 63.3% against a `fast`-free hoplomachus at 71.9%.
- Gate D is thin and moves with selection frequency, so it is re-run after every
  accepted tuning package rather than once.

### T. The balance surface is unchanged

> Every band in `balance.test.ts`, `seasonBalance.test.ts`,
> `dispositionBalance.test.ts` and `encounterCapacity.test.ts` holds.

- **Baseline:** 809 tests pass on this branch, 39 files.
- The advantaged-style band is 55–75% and `technical vs heavy` sits at the
  floor. A longer or more successful Fast retreat is a nerf to `heavy vs fast`
  (64.5% today), which has 9.5 points of room below the ceiling and 9.5 above
  the floor. **This is the gate most likely to stop the slice**, and per
  design.md the answer is to present the failing distributions rather than to
  widen a band.

### U. Time-at-distance is reported, not gated

> `measure-distance.ts` is run before and after, and every per-pair figure that
> moves by more than 5 points is explained in this document.

- **Not a bar, deliberately.** §1 shows the statistic ranks the counter below the
  thing it counters, so a threshold on it would be a threshold on the wrong
  quantity. It is here because a large movement would mean the candidate changed
  the matchup rather than the mechanic, and that is worth knowing.

---

## 6. What may be tuned

design.md's standing allowance covers fighter numbers, action
`damageMultiplier`/`recoveryTicks`, turn sine/cosine pairs and Fast's
`evadeDisplacement`. Everything this slice needs is **outside** it, so this
section is the written amendment design.md requires.

**Mutable here, and nothing else:**

- `FAST_FORCED_DISENGAGE_END_RANGE` and `FAST_FORCED_DISENGAGE_MAX_TICKS`
  (`combatDecision.ts:969,1001`);
- the forced-disengage exit predicate `hasFastForcedDisengageEnded`
  (`combatDecision.ts:1013`) — including replacing the fixed-distance test with
  one that a pursuing opponent cannot deny, which is the hypothesis;
- design.md's existing allowance, unchanged.

**Explicitly not mutable, and each for a stated reason:**

- `preferredRange` of any style — the murmillo's is his archetype, and §1 shows
  the distance is not the defect;
- `baseWeights` — the murmillo's chase is his archetype too;
- any `contactRange`, including the lunge's 1.60 floor — §1.2 withdrew the
  finding that would have justified moving it, and `measure-reach.ts:526` gates
  its equality with the hoplomachus' floor;
- locomotion speeds — a faster Fast retreat would fix this matchup by making
  Fast faster, which is a different change wearing this one's clothes;
- anything in `src/presentation/**` — non-goal.

## 7. Non-goals

Moving fighting distance; re-opening the counter triangle; changing the murmillo
in any way; a kiting fix; the four instrument debts in §8 beyond the two this
slice must close.

## 8. Debts this slice does not pay

1. **`equalStatFighter` is duplicated** across `measure-reach.ts` and
   `measure-distance.ts`, and the two instruments are comparable only while the
   copies agree. Unifying it means editing `measure-reach.ts` while it produces
   this slice's baselines. Owed to whoever next opens it.
2. **No kiting detector.** Bout duration and timeout rate exist in
   `balance.test.ts` at cohort level, not per pair. Gate T is the closest thing
   and it is indirect.
3. **`--overlay` cannot add an authored field.** `requireKnownKeys` demands every
   patched key already exist, which is right for catching a `rootTravl` typo and
   wrong for measuring "give this style an intent it does not have". Any such
   candidate must be measured by editing content.
4. **`src/style.css:4` asks for Inter with no bundled `@font-face`**, so the
   Linux screenshots render in whatever sans the runner image ships. Found while
   clearing the baseline debt; unrelated to combat; a slice of its own.

## 9. Risks

- **Gate T stops the slice.** A more successful Fast escape is a direct nerf to
  the murmillo in a band that is 55–75% and currently reads 64.5%. This is the
  most likely place the work stops and reports.
- **Gate R and gate P pull against each other.** Lowering the exit range raises
  completion and raises instant clears; raising the tick cap raises ground
  gained and, on the measured evidence, cannot raise completion in this matchup
  at all. A candidate that satisfies both probably has to change the *shape* of
  the exit condition rather than its value, which is why §6 makes the predicate
  mutable and not just the constants.
- **A third finding reverses.** Two have. The per-pair disengage statistic is the
  most robust thing measured in this slice — no comparator, forty-fold margin,
  mechanism verified arithmetically — but the base rate here is not reassuring,
  and phase F's two questions should be aimed at it specifically.
