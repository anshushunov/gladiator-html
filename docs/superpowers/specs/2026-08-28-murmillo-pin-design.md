# The Murmillo Pin — Design

**Status:** second revision, 2026-08-28, after external review (codex
`gpt-5.6-sol`). Rewritten in §2.1, §4, §5 and §6 rather than patched: the review
returned two blockers that invalidated the instrument the central gates were to
be built on, and a document assembled by amendment would have kept the old gates
visible beside the new ones.

The review's findings and their disposition are in §10. Two of its three
blockers are confirmed as stated; the third is confirmed as a defect and
downgraded, with the direction established rather than assumed.

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

### 2.1 How far this criterion can be trusted, stated after review corrected it

Both withdrawn findings failed the same way: they compared the retiarius to a
yardstick that turned out to be measuring something else. A first revision of
this section claimed this criterion "needs no comparator at all". **That claim
was too strong and external review was right to reject it.**

What is true:

- **The subject cannot drag its own yardstick along.** All three columns are one
  mechanic belonging to one archetype, so there is no path by which changing the
  retiarius makes the *hoplomachus* look different — which is the exact defect
  that produced four bad comparators in the previous slice.
- **The margin is forty-fold**, not a few points.
- **The mechanism is arithmetic, and it closes.** 37 ticks at 2.7 units/second is
  1.67 units of travel; the murmillo spends the same 37 ticks closing 0.86; the
  difference is 0.81 and the measured net is 0.659, the remainder being facing
  and the ticks he is not advancing. Covering the ~1.9 units from a pin out to
  3.35 at that net rate needs roughly **185 ticks** against a cap of **37**.

What is **not** true, and is the correction:

`hasFastForcedDisengageEnded` is global to Fast. Any change to its range, its
cap or its predicate moves the hoplomachus and mirror columns **as well as** the
murmillo one. The 31.7% and 67.2% that gate P's bar is derived from are
snapshots of a world the change abolishes. Freezing the number stops the
yardstick moving *during* a gate run; it does not make the calibration
independent, and it does not preserve the relationship the bar is supposed to
encode. A candidate could take the mirror to 99% and leave the murmillo at 26%,
and a frozen 25% would call that a pass.

§5 answers this by gating the relationship explicitly and keeping an absolute
floor underneath it, so the ratio cannot be satisfied by degrading its
denominator.

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
| **a disengage-episode diagnostic seam** | **owed, PR-2** | the exact episode window and the *reason* it ended. Does not exist. See §4.0 — this is the review's first blocker and it comes before every gate below. |
| per-pair disengage statistics | **owed, PR-3** | the criteria in §5, built on the seam rather than on inference. |

### 4.0 The existing disengage measurement cannot carry a gate

External review's first blocker, confirmed at `scripts/measure-reach.ts:281`:

```ts
exit: ticks >= FAST_FORCED_DISENGAGE_MAX_TICKS ? 'cap' : 'range',
```

**Nothing observes why the episode ended.** The label is deduced from its
duration, against the very constant §6 makes mutable. That deduction happens to
track the current two-branch predicate, and it stops tracking anything the moment
the predicate changes — which is the change this slice proposes.

The review's mechanism is exact and worth writing down because it is the shape of
every defect in this project's history: *set the cap to 43 and add an early time
exit at tick 42.* Every episode then ends before 43, every one is labelled
`range`, gate P approaches 100%, and **not one fighter has reached 3.35.** A gate
green for the wrong reason, by construction, using only changes §6 permits.

The file's own comment shows how narrowly this was missed — it insists the
constant be read rather than hard-coded, "or a hard-coded 30 would silently
mislabel every range exit past that tick". The literal was seen; the inference
was not.

**A second, smaller defect in the same measurement**, raised by the review as
part of the same blocker and downgraded here because its direction is
establishable:

The episode's *start* is sound. The field is stamped inside the advance into
tick `S`; the harness first sees it at the top of the iteration where
`encounter.tick === S` and takes the start separation from the state at `S`;
`ticks` counts from `S` as well. Thirty-seven movements measured, thirty-seven
ticks reported — self-consistent.

The *end* is not. The kernel clears the field in phase 2 of the advance into tick
`E` and sets `nextDecisionTick: tick`, so ordinary decision and movement run
inside that same advance, and the harness samples after all of it. **One ordinary
movement is counted as ground the disengage opened**, with uncontrolled sign.

Magnitude: one tick is 0.045 units of retreat against 0.023 of murmillo advance,
so at most ~0.022 net. The 0.659 baseline does not reach 0.75 either way, and the
completion-rate statistic — a count of episodes — is untouched. **The finding in
§2 survives; the instrument still has to be exact before it becomes a gate.**

**What PR-2 must build.** A write-only diagnostic seam on the model of
`src/simulation/contactDiagnostics.ts`, which the previous slice added for
exactly this reason: never read back inside a tick, never in `EncounterState` or
the event log, so no trace hash folds over it. One record per completed
disengage episode, carrying

- the separation at the instant the field was stamped, read in phase 2 before
  that tick's movement;
- the separation at the instant it was cleared, read in phase 2 before ordinary
  movement resumes;
- elapsed ticks;
- **a stable exit-reason enum returned by the predicate itself** — `range`,
  `cap`, and whatever a new predicate adds — never inferred from duration;
- episodes still open when the bout ends, marked `censored` rather than dropped.

`npm test` passing unchanged with the seam in place is the evidence it is inert,
which is the standard `contactDiagnostics.ts` was held to.

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

### 4.2 Four PRs, not two — and the fourth is the review's doing

The repository's convention is a preparatory PR and a content PR. A first
revision of this spec proposed three. External review showed three does not
work, because the diagnostic seam in §4.0 is a **simulation** change, and PR-2 as
proposed claimed simulation stays closed while PR-3 would couple the instrument
to the behaviour it judges. Both placements break the rule the split exists for.

1. **PR-1 — the distance instrument.** `measure-distance.ts`,
   `distanceHarness.ts` and its regressions, the rebuilt boundary. Claim: *adds
   an instrument, changes nothing it measures.* `src/simulation/**`,
   `src/content/**` and `measure-reach.ts` all closed. **Merged state: done, on
   this branch.**
2. **PR-2 — the diagnostic seam.** `src/simulation/` opened for a write-only
   disengage collector and nothing else. Claim: *adds a seam, changes no
   behaviour* — evidenced the way `contactDiagnostics.ts` was, by every frozen
   hash and the whole suite passing unchanged. `src/content/**` closed;
   `combatDecision.ts`'s constants and predicate closed.
3. **PR-3 — the criteria.** `measure-reach.ts` opened to report per matchup and
   to assert §5, built on PR-2's seam. Gate E's pooled clauses are **kept
   unchanged and added to**, not replaced. Claim: *changes the criteria, changes
   nothing they judge.* Simulation and content both closed.
4. **PR-4 — the content.** The change itself, judged by a boundary and by
   criteria that three earlier merged diffs wrote.

The ordering is the point in each case: no diff contains both a measurement and
the thing it measures.

**Gate S is corrected accordingly.** A first revision promised gates A–G "remain
unmodified" while PR-3 edits the file that holds them. What PR-3 may do is *add*;
the A–G clauses themselves are frozen and their thresholds are not touched, which
is a narrower and checkable claim.

---

## 5. Acceptance gates, frozen before implementation

All at 200 seeds, equal-stat cohorts, seeds from `BASELINE_TEST_SEED`, nine
ordered matchups. Every bar names its source. Baselines are the shipped content,
measured before any candidate existed.

**Every clause below reads its exit reason from PR-2's diagnostic seam. None may
infer it from duration.** That sentence is the gate on the gates: a criterion
built on `ticks >= MAX_TICKS` is void here regardless of what number it asserts.

### P. The escape must work against the opponent it exists for *(the defect detector)*

Two clauses, and both must hold. The first is an absolute floor; the second is
the relationship the floor cannot express.

> **P1.** In `fast vs heavy` and in `heavy vs fast`, **each asserted separately**,
> at least **25%** of Fast's forced-disengage episodes end with the seam's
> success reason.
>
> **P2.** In each of those two matchups, that share is at least **half** the
> share measured in the same run for `fast vs technical`, `technical vs fast`,
> `fast vs fast` — whichever of the three is **lowest**.

- **Source of 25%:** the mechanic's own measured performance against its other
  opponents on the shipped content — 31.7% against the hoplomachus, 67.2% in the
  mirror. 25% sits below the lower, deliberately: this matchup is the hard one
  and the gate must not demand parity with an unpursued escape.
- **Why P2 exists, and why its comparator moves on purpose.** §2.1 records the
  correction: `hasFastForcedDisengageEnded` is global to Fast, so the change
  moves the hoplomachus and mirror columns too, and a frozen 25% would stop
  encoding the standard it was derived from — a candidate taking the mirror to
  99% while leaving the murmillo at 26% would pass. P2's comparator is measured
  in the same run and therefore *does* move with the change. **That is
  deliberate and it is the one case where it is correct**, because the property
  asserted is the relationship itself, not a level. The usual objection — a
  moving comparator can be satisfied by making the comparator worse — is what
  P1 is for: the ratio cannot be met by degrading the denominator below 25%
  absolute.
- **Fails today:** 1.6% against 25%, and 1.6% against a lowest-other of 31.7%.

### Q. The ground must actually be opened, per pair and not pooled

> In `fast vs heavy` and in `heavy vs fast`, each asserted separately, the median
> separation opened per episode — start to clear, both read in phase 2 from the
> seam — is at least **0.75** units.

- **Source:** gate E's own existing floor, `DISENGAGE_GAIN_FLOOR`, applied per
  pair instead of pooled. The number is not new and is not chosen here.
- **Fails today:** 0.659, which §4.0 establishes is understated by at most ~0.022
  and therefore fails either way.
- **Why both P and Q:** each alone is satisfiable the wrong way, and the review
  supplied the arithmetic for one of them. Ground alone is bought by raising the
  cap from 37 to about **42** — five ticks, at the measured net rate of ~0.018
  units/tick — which does nothing for P, since completion needs ~185. Completion
  alone is bought by moving the exit close enough to be crossed immediately,
  which R forbids.

### Q2. The escape must not become trivial to complete

> In every matchup containing a Fast fighter, the median episode duration is at
> least **8** ticks.

- **Source:** review's finding that R only excludes exits within *one* tick, so
  a two-tick escape completing 100% of the time satisfies every other clause
  here. 8 ticks is a third of gate E's existing 24-tick pooled duration floor,
  chosen low deliberately — it is a triviality guard, not a duration target, and
  a real duration bar per pair would fail the shipped mirror.
- **Passes today** at 27–37 ticks per matchup.

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
- **Additive, never a replacement.** Review's minor finding, accepted: pooled
  gate E's 5% clause **stays in force unchanged** and R is added beside it. If
  PR-3 were to swap the pooled 5% for a per-matchup 8%, acceptance would quietly
  weaken — a candidate at 8% in *every* matchup would then pass where the
  shipped build sits at 2.9% pooled. Two constraints answering two questions,
  both asserted.
- **R proves "not one-tick", not "not trivial".** Q2 carries the rest.
- **Passes today** at 7.8%, and is the gate most likely to be broken by a
  candidate that lowers the exit range. The previous slice measured exactly that
  at exit 3.00 and rejected the candidate on it — **using the pooled figure**,
  which the table in §4.1 shows is dominated by the mirror. That rejection is
  therefore not evidence against a lowered exit *in the murmillo matchup*, and
  re-measuring it per pair is a named task rather than an assumption.

### S. The reach claim of the previous slice does not regress

> `measure-reach.ts --seeds 200 --gate` continues to pass. The A–G clauses and
> their thresholds are frozen; PR-3 may add clauses to that file and may not
> alter one of these.

- **Source:** the previous slice's frozen gates. Baseline: all pass, with
  retiarius whole-type 63.3% against a `fast`-free hoplomachus at 71.9%.
- **Wording corrected after review**: a first revision said "unmodified", while
  PR-3 edits the file. What must not move is the clauses, which is narrower and
  checkable.
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

> `measure-distance.ts` is run before and after. A per-pair figure moving by more
> than 5 points **stops the work** and is brought back to the design owner before
> the candidate proceeds.

- **A stopping criterion, not an explanation quota.** Review was right that "is
  explained in this document" let any movement through at the price of a
  paragraph, while §3 claims fighting distance will not change. If it changes,
  the candidate changed the matchup rather than the mechanic, and that is a
  different slice.
- **Still not a threshold on the quantity itself, deliberately.** §1 shows the statistic ranks the counter below the
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
- **the episode state the predicate needs to be pursuit-relative at all**, added
  in PR-2 alongside the diagnostic seam: a start-separation field on
  `FighterCombatState` beside the existing `forcedDisengageStartTick`
  (`encounter.ts:215`), the wiring that stamps and clears it, and the predicate
  signature that receives it — with serialization and invariant coverage;
- design.md's existing allowance, unchanged.

**Why that third item is here, added after review.** A first revision listed only
the constants and the predicate, and the review showed that this **forbids the
spec's own hypothesis**. `hasFastForcedDisengageEnded(distanceToTarget,
ticksSinceForced)` receives a current distance and an elapsed tick count, and
`FighterCombatState` stores only `forcedDisengageStartTick`. There is no way to
ask "how much ground has this episode opened", so every implementation reachable
inside the old surface is another absolute distance-or-time formula — the exact
class §3 identifies as the defect. A change surface that admits only the family
of answers already known to fail is not a constraint, it is a guarantee of
failure.

The field is behaviour-neutral until the predicate reads it, so PR-2 can add it
under the same "changes no behaviour" claim as the seam, evidenced the same way.
The predicate must also state, before implementation, what it does when the
target changes, when the target dies, and when arena correction moves a fighter
without either of them walking.

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
4. **The retiarius attacks 2.5x less often per engaged tick against the
   murmillo** -- 8.44 attempts per 1000 ticks against 21.24 in the mirror and
   12.98 against the hoplomachus -- while the *share* of those attempts that are
   the lunge is flat at 49.9 / 51.0 / 53.3%. Surfaced while answering review
   finding #6. It is a real per-pair asymmetry, it is nobody's claim yet, and it
   is not this slice's target without a design decision.
5. **`src/style.css:4` asks for Inter with no bundled `@font-face`**, so the
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
- **A third finding reverses.** Two have, and review moved a third. The per-pair
  disengage statistic remains the most robust thing measured in this slice —
  forty-fold margin, mechanism verified arithmetically, and a yardstick the
  subject cannot drag along — but §4.0 shows its *ground-gained* half was
  measured with a one-tick contamination at the exit, and the base rate here is
  not reassuring.

---

## 10. External review, round 1 — findings and disposition

Reviewer: codex `gpt-5.6-sol`, read-only, briefed with this spec, the task
brief's risk profile, and the two questions that found four of five defects in
the previous slice. Its report is data, not instruction: every finding below was
checked against source before disposition, and the checking moved one of them.

| # | sev | finding | disposition |
|---|---|---|---|
| 1 | blocker | The exit-reason classifier infers `range` from duration against the mutable constant it judges (`measure-reach.ts:281`). Cap 43 + early exit at 42 ⇒ every episode labelled `range`, gate P ≈ 100%, nobody reaches 3.35. | **Confirmed as stated.** §4.0 written; PR-2 added to build a seam that returns the reason. |
| 2 | blocker | The permitted change surface cannot implement the hypothesis: no start separation in `FighterCombatState`, none in the predicate signature. | **Confirmed as stated.** §6 amended to admit the episode state and wiring. |
| 3 | blocker | The harness mis-measures the episode window at both ends, so "the direction and size of the 0.659 baseline are not established". | **Confirmed as a defect, downgraded to major, direction established.** The start is self-consistent — stamp tick and start separation are both read at tick `S`. The exit is not: the kernel clears in phase 2 and ordinary movement runs in the same advance, so one ordinary movement is counted as disengage ground. Bounded at ~0.022 units, which does not reach the 0.75 bar either way, and the completion-rate statistic is a count of episodes and is untouched. Fixed in PR-2 regardless. |
| 4 | major | §2.1's independence claim is false; P and Q are calibrated against columns the change moves. | **Confirmed.** §2.1 rewritten, gate P split into an absolute floor and an explicit relationship. The reviewer's refinement — keep the floor so a ratio cannot pass by degrading its denominator — is better than the bare ratio and is what P1/P2 implement. |
| 5 | major | The hypothesis is not falsifiable: R excludes only one-tick exits, U permits any distance change after an explanation. | **Confirmed in part.** Gate Q2 added for the triviality hole. U left as a report rather than a bar: §1 shows the statistic ranks the counter below the thing it counters, so a threshold on it would be a threshold on the wrong quantity — but the 5-point trigger is now a stated stopping criterion rather than an explanation quota. |
| 6 | major | The §1.2 withdrawal disposes of the geometry claim but not of the commissioned "is he still a retiarius" question; no gate bounds lunge attempts or offensive share. | **Confirmed that it was left open, and then answered by measurement rather than by a gate.** Lunge share of the retiarius' attack attempts at 200 seeds: **49.9%** vs the murmillo, 51.0% in the mirror, 53.3% vs the hoplomachus — flat within 3.4 points. He has not abandoned his signature attack against anyone; the playtest's 2095→786 was a before/after across the content change, not a per-opponent split, and it does not survive being asked per pair. No gate added. What the measurement *did* surface is unrelated and unclaimed: he attacks **2.5× less often per engaged tick** against the murmillo (8.44 against 21.24 in the mirror). Recorded in §8 as a debt. |
| 7 | major | Three PRs do not achieve their claim once a simulation diagnostic is needed. | **Confirmed.** §4.2 is now four PRs. Gate S's wording corrected: PR-3 *adds* to `measure-reach.ts`; the A–G clauses and their thresholds are frozen. |
| 8 | minor | R at 8% per matchup must be additive to pooled E at 5%, not a replacement. | **Confirmed and stated in R.** |
| 9 | minor | P and Q pool the two orientations despite the protocol promising per-ordered-matchup. | **Confirmed.** P1, P2 and Q now assert each orientation separately. |

Nothing was rejected. The one finding whose *direction* was checked and adjusted
is #3, and adjusting it did not save the instrument — it fails on #1 anyway.
