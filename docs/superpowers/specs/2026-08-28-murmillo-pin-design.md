# The Murmillo Pin — Design

**Status:** fifth revision, 2026-08-28, after **three** rounds of external review
(codex `gpt-5.6-sol` throughout; opencode `deepseek-v4-pro` from round 2).

**Not fit to implement, and the review budget is spent.** Round 3 returned two
blockers, both confirmed and both fixed here — but the fixes have not been
reviewed, and the brief allows three rounds. §10.7 states the decision that is
now the design owner's. Gate V's bar is withdrawn pending re-measurement on a
definition that matches what it claims to assert. Rewritten in §2.1, §4, §5 and §6 rather than patched: the review
invalidated the instrument the central gates were to be built on, and a document
assembled by amendment would have kept the old gates visible beside the new
ones.

The review's findings and their disposition are in §10. **All three blockers are
confirmed.** The third took three passes to get right: downgraded, restored, then
sign-corrected — and the correction runs against this document's own case. §10.1
records that only one of the two commissioned reviewers ever produced a report.

**Entry point:** `docs/reviews/2026-08-27-retiarius-reach-playtest.md`, whose
closing finding was:

> the slice fixed the retiarius' reach and did not fix the murmillo's ability to
> ignore it

**Working history:** `docs/superpowers/plans/2026-08-28-murmillo-journal.md`,
which records every measurement below as it was taken, including the ones that
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
| median ground opened *(not established — see §4.0)* | 0.659 | 0.954 | 0.833 |

He gives ground about 2.4 times a bout, at 1.9× the speed the murmillo closes
at, and it works sixteen times in a thousand.

**The defect is the completion rate, and only the completion rate.** The
ground-opened row is printed because it is what the existing instrument reports,
and §4.0 shows that instrument measures a window shifted by one tick in a
direction that understates the figure — the true median may be anywhere in
[0.659, ~0.77] and may clear the 0.75 bar. Nothing in this spec may rest on that
row until PR-2 re-measures it. The completion rate is a count of episodes and a
one-tick shift cannot move 1.6% to 31.7%.

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
  1.67 units of travel; the murmillo spends the same 37 ticks closing 0.86,
  leaving ~0.81 before facing losses and the ticks he is not advancing — which is
  the order of the measured 0.659–0.77. Covering the ~1.9 units from a pin out to
  3.35 at that net rate needs roughly **185 ticks** against a cap of **37**. The
  arithmetic supports the completion-rate finding; it is deliberately not quoted
  to three figures, because §4.0 shows the measured gain is not established to
  that precision.

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

The window is **shifted by one tick, not mis-counted**. The field is stamped in
phase 2 of the advance into tick `S`, and that same advance moves the fighter
under `disengage` (phase 2 stamps, phase 4 skips forced actors, phases 7–8 move).
The harness first sees the field at the top of the iteration where
`encounter.tick === S`, so its start separation is the state at `S` — *after*
that first forced retreat. At the other end the kernel clears the field in phase
2 of the advance into `E` and sets `nextDecisionTick: tick`, so phase 4 and
phases 7–8 run **ordinary** decision and movement in that same advance, and the
harness samples after all of it.

So the reported `ticks` is right — `E − S` movements measured, `E − S` reported —
but the measured window is `[S, E]` while the real one is `[S−1, E−1]`. The gain
**drops one forced retreat at the front and picks up one ordinary movement at the
back.**

**I have now got this paragraph wrong four times, each time in my own favour, and
the fourth correction removes the claim entirely.**

The attempts: a ~0.022 bound covering only the term that helped; then ~±0.09 with
"may sit on the bar"; then a signed interval of −0.11..0 concluding the
measurement *understates* the gain. Round-2 review killed the third the same way
the first two died — **the bound modelled locomotion only.** The harness samples
after the whole tick, and `encounter.ts:2364-2372` runs phase 9 contact
resolution and phase 10 accumulated push *after* movement. `heavy-cleave` authors
`pushDistance` **0.70** (`combatStyles.ts:113`). A single cleave landing on either
shifted endpoint moves the separation by six times my whole error interval, in
whichever direction the contact went.

So there is no interval and no sign. **The ground-gain baseline is unestablished,
and that is the entire claim.** It is obtained from PR-2's phase-2 seam before
gate Q is frozen or its number interpreted.

The completion-rate finding is untouched and is kept separate for exactly this
reason: the window defect shifts *when* endpoints are read, and cannot change
*how many* episodes ended by reaching a range. 1.6% against 31.7% and 67.2%
stands.

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
- **a closed, frozen exit-reason enum** — exactly `range`, `cap`, `progress`,
  `censored` — returned by the predicate itself and never inferred from
  duration. **PR-4 may not add a reason, rename one, or move one between the
  success and failure sets.** Round-2 review found that the previous wording
  ("whatever a new predicate adds") reopened the hole one level up: a seam that
  faithfully reports a reason the candidate invented is no better than a
  duration inference;
- episodes still open when the bout ends, marked `censored` rather than dropped.

**And the gate checks the reason against the recorded endpoints, rather than
trusting it.** A record labelled `range` must satisfy the range condition at its
recorded end separation; a record labelled `progress` must satisfy the frozen
minimum gain. A label the endpoints contradict fails the run loudly. The reason
exists to say *which* success occurred; it is not evidence that one did.

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
2. **PR-2 — the diagnostic seam, and *no new combatant state*.**
   `src/simulation/` opened for a write-only disengage collector, plus **one
   signature change and nothing else**: `hasFastForcedDisengageEnded` widens its
   return from `boolean` to the frozen exit-reason enum, whose two current
   values preserve the existing truthiness exactly. Claim: *adds a seam, changes
   no behaviour* — evidenced the way `contactDiagnostics.ts` was, by every frozen
   hash and the whole suite passing unchanged.

   **"Closed" in this PR means the constants and the exit-condition *logic*, not
   the signature.** Both reviewers flagged the previous wording as making PR-2
   literally unbuildable: it declared the predicate closed while §4.0 required
   the predicate to return the reason, leaving only two ways out, both bad —
   infer the reason from duration, which is the hole being fixed, or duplicate
   the exit logic in a parallel diagnostic function, which is this project's
   drift-and-divergence defect class rebuilt on purpose. The start-separation
   *parameter* is not added here either; it arrives in PR-4 with the field it
   would read.

   **Round-2 review found the previous version of this PR impossible, twice
   over.** It said the predicate was closed while §4.0 and §6 required PR-2 to
   change it, and it promised every frozen hash held while also adding a field to
   `FighterCombatState` — and `stateHash.test.ts:57-80` rolls a hash of the
   **whole** `BattleState` after every tick of nine pairings, so a new populated
   field moves nine digests by construction. The claim and the content could not
   both be true.

   The split that works: the **collector** can read both endpoints in phase 2
   without the kernel storing anything, so PR-2 needs no new state and keeps its
   hashes. The **start-separation field** the pursuit-relative predicate needs is
   real state, so it moves to PR-4, where behaviour changes anyway and the
   digests are re-baselined in the diff that legitimately earns it.
3. **PR-3 — the criteria.** `measure-reach.ts` opened to report per matchup and
   to assert §5, built on PR-2's seam. Gate E's pooled clauses are **kept
   unchanged and added to**, not replaced. Claim: *changes the criteria, changes
   nothing they judge.* Simulation and content both closed.
4. **PR-4 — the content.** The change itself, plus the start-separation field on
   `FighterCombatState` and the predicate argument that reads it — judged by a
   boundary and by criteria that three earlier merged diffs wrote. Every
   whole-state digest it moves is re-baselined here with its reason, under the
   determinism-artifact rule, and events, RNG consumption and terminal outcomes
   are shown unchanged where behaviour was not meant to move.

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

**Every clause below reads its exit reason from PR-2's diagnostic seam, and the
gate re-checks that reason against the recorded endpoints.** A criterion built on
`ticks >= MAX_TICKS`, or on a reason the endpoints contradict, is void here
whatever number it asserts.

**And a success reason must denote a condition on ground, never on time.**
Round-2 review found that forbidding *duration inference* was necessary and not
sufficient: the reason is self-reported by the mutable predicate, so a candidate
could honestly return `range` from a rule that fires at tick 42. So the success
set is constrained by what it may mean, not only by how it is read — a successful
exit is one where the fighter opened separation, however the exit is re-expressed
— and **every episode P counts as a success must independently show seam-measured
ground opened strictly greater than zero.** A self-reported label that the
recorded endpoints do not corroborate fails the run.

**Definitions, frozen, because round-2 review found every one of them load-bearing
and none of them stated:**

- an **episode** is one stamped-to-cleared forced disengage, including those still
  open when the bout ends;
- a **success** is an episode that **opened at least 0.75 units of separation,
  measured from the seam's recorded endpoints**, and whose exit reason is in the
  frozen success set. Both, and the ground condition is the binding one.

  **Round-3 review broke the previous definition, which required only that the
  reason be corroborated by ground `> 0`.** Its construction: of 100 episodes,
  25 successes made of 12 epsilon-gain exits and 13 opening ≥0.75, plus 38 capped
  failures opening ≥0.75 and 37 opening less. Run against
  `balanceCohorts.percentile`, P reads 25%, Q's success-only median reads 0.80,
  Q's all-episode median reads 0.80, and Q2 passes if the epsilon exits take
  eight ticks. **Every gate green while half the claimed escapes opened a
  millimetre.** Worse, those premature exits free Fast to attack sooner, so they
  *help* gate V rather than colliding with it.

  Fixing it also closes the coupling round-3 review identified as the answer to
  this spec's own second question: with success defined by a label, the mutable
  predicate chose Q's success-only population, making it a comparator that moves
  with the change. Defined by ground, the population is objective and the
  coupling is removed rather than admitted;
- `cap` and `censored` are **non-successes**. Where each belongs is stated per
  gate rather than left to the implementation, because the existing gate E keeps
  censored records in its denominators (`measure-reach.ts:484` reads the full
  list) so consistency is not free and the choice moves every rate:
  - **P** — `cap` and `censored` both count in the denominator as non-successes.
    Dropping censored lets a candidate flatter itself by running failures past
    the end of the bout.
  - **Q** — `censored` **excluded**: no clear separation was ever recorded, so
    there is no ground figure to take a median of. `cap` included.
  - **Q2 and R** — `censored` **excluded** from the duration and instant-clear
    statistics, for the same reason: the episode has no end.

### P. The escape must work against the opponent it exists for *(the defect detector)*

Three clauses. All must hold.

> **P1.** In `fast vs heavy` and in `heavy vs fast`, **each asserted separately**,
> at least **25%** of episodes are successes.
>
> **P2.** In each of those two matchups, that share is at least **half** the
> share measured in the same run for the lowest of `fast vs technical`,
> `technical vs fast`, `fast vs fast`.
>
> **P3.** **Each** of those three comparator matchups is itself at least **80%**
> of its own pre-change measured share — 31.7%, 31.7% and 67.2% respectively, so
> 25.4%, 25.4% and 53.8%.

- **Source of 25%:** the mechanic's own measured performance against its other
  opponents on the shipped content. 25% sits below the lower of the two,
  deliberately: this matchup is the hard one and the gate must not demand parity
  with an unpursued escape.
- **Why P3 exists, and both reviewers found the hole independently.** A previous
  revision claimed P1 was "the floor that stops the denominator being degraded".
  **It is not — P1 floors the murmillo numerator; nothing floored the
  comparator.** P3 is the floor that was claimed and missing, applied to **every**
  comparator component separately rather than to their minimum.
- **P2's honest region of effect, which P3 does not rescue.** One reviewer took
  it further and is right: whenever `min(others) < 50%`, `0.5 · min(others) <
  25% ≤` the murmillo share by P1, so **P2 is satisfied automatically and adds
  nothing.** P3's floors are 25.4 / 25.4 / 53.8%, so two of the three sit well
  below 50% and P2 is decorative across much of the space. It is kept because it
  bites in the region that matters — a candidate that makes the escape easy
  everywhere, where `min(others)` is high and the murmillo must keep pace — and
  it is labelled here rather than left to look stronger than it is.
- **What actually blocks the degrade-the-comparator path** is P3 and gate Q: Q
  measures ground from recorded positions rather than from a share, so a
  candidate cannot buy P by making every matchup worse. Crediting P1 for that
  protection was wrong and the credit is moved.
- **And P's numerator is now a measurement, not a label.** Since a success must
  open ≥0.75 units by the seam's own endpoints, a candidate cannot manufacture
  the rate by naming exits differently — which is what round 3 showed it could
  still do.
- **Fails today:** 1.6% against 25%, and against a lowest-other of 31.7%.

### Q. The ground must actually be opened, per pair and not pooled

> In `fast vs heavy` and in `heavy vs fast`, each asserted separately, the median
> separation opened — start to clear, both read in phase 2 from the seam —
> is at least **0.75** units, asserted **over successful episodes** and
> **over all episodes** separately.

- **Source:** gate E's existing `DISENGAGE_GAIN_FLOOR`, applied per pair. Not new,
  not chosen here.
- **Both populations, because round-2 review showed one is not enough.** A
  candidate can let 25% of episodes succeed quickly and 75% run to the cap; an
  all-episode median is then carried by the failures, and a success-only median
  by a small fast subset. Asserting both makes P, Q and Q2 describe the same
  fight rather than three disjoint slices of it.
- **Baseline NOT established.** 0.659 as measured, and §4.0 now withdraws every
  error bound and sign I attached to it: the harness samples after phases 9–10,
  where a single `heavy-cleave` push of 0.70 dwarfs any locomotion arithmetic.
  Q's baseline is measured on PR-2's seam before Q is frozen. The 0.75 bar itself
  is not in question — only the shipped figure it is compared to.

### Q2. The escape must not become trivial to complete

> In every matchup containing a Fast fighter, the median episode duration is at
> least **8** ticks, asserted over **successful** episodes; and no more than
> **10%** of successes complete in under 4 ticks.

- **Source:** review's finding that R excludes only *one*-tick exits, so a
  two-tick escape completing every time satisfies everything else here. 8 ticks
  is a third of gate E's existing 24-tick pooled floor — a triviality guard, not
  a duration target, since a real per-pair duration bar would fail the shipped
  mirror.
- **Over successes, plus the sub-4-tick share**, because an all-episode median is
  exactly the statistic a capped-failure population carries.
- **Passes today** at 27–37 ticks per matchup.

### R. It must not become an instant escape anywhere *(the counter-lever)*

> In **every** matchup containing a Fast fighter, the share of episodes clearing
> within one tick is at most **10%**.

- **Source:** the worst matchup on the shipped content — the mirror, at 7.8% —
  plus two standard errors. **A previous revision put the bar at 8% and that was
  underpowered**, which round-2 review caught with arithmetic I should have done:
  7.8% is 67 of 859 episodes, so the binomial standard error is
  `sqrt(0.078 × 0.922 / 859) ≈ 0.9` points. A bar 0.2 points above the baseline
  sits at **0.22σ** — a re-run flips it with no candidate change, and a candidate
  passes at 8.5% with nothing altered. For the clause this spec itself calls the
  one most likely to break, that margin was noise dressed as headroom. 10% is
  ~2.4σ.
- **This bar is loose on purpose and is not the whole guard.** It catches a large
  regression, not a small one; pooled gate E's 5% stays in force beside it, and
  Q2 carries triviality.
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

### V. The retiarius must not stop committing *(the decision that put it here)*

> In `fast vs heavy` and in `heavy vs fast`, each asserted separately,
> **`fast-burst-lunge` `action-started` events per 1000 engaged ticks, per Fast
> fighter**, counted only for starts whose tick falls inside the same latched
> engaged window as the denominator, are at least **3.55**.

- **Re-measured, and the bar is 3.55.** The counter now lives in
  `measure-distance.ts`, which already runs the bouts, so both halves come from
  one run; the shipped baseline is **3.76** in both orientations and the bar is
  95% of it. Regressions in `distanceHarness.test.ts` pin the two properties that
  failed before: starts never fall below the contact-derived count (asserted per
  bout, where it is an invariant), and pre-engagement starts are a real
  population that is excluded from both halves.
- **The old 4.0 was wrong twice over, and the second correction runs against the
  shipped content rather than for it.** Round-3 review found the
  numerator and denominator were measuring different things, and it is right.
  `measure-reach.ts:299-305` files a contact record under `reached` only when the
  outcome is in `REACHED`, geometry misses separately, other outcomes elsewhere —
  and an attack interrupted before phase 9 produces **no record at all**. My 4.21
  was `reached + geometryFailures`, which is neither "attempts" nor anything with
  a name. Worse, those contacts are collected over the **whole bout** while the
  denominator counts only **engaged** ticks, so the opening exchange lands in the
  numerator with none of its ticks in the denominator.
- **And the gap is exploitable in exactly the direction V exists to stop.** Eight
  starts at 53% reaching geometry and five starts at 80% both report ~4.2. A
  candidate can cut commitment frequency by 38% and leave V green by making the
  survivors cleaner. That is the gate defeating its own purpose.
- **Measured on the corrected definition, 200 seeds, per Fast fighter:**

  | | starts inside the window | old contact-derived | rate per 1000 |
  |---|---:|---:|---:|
  | `fast vs heavy` | 508 | 569 | **3.76** |
  | `heavy vs fast` | 492 | 552 | **3.76** |
  | mirror | 1085 | 1079 | 5.45 |
  | `fast vs technical` | 617 | 607 | 7.04 |
  | `technical vs fast` | 568 | 542 | 6.60 |

  Against the murmillo the corrected count is **lower** than the old derivation
  by 11%, because ~61 lunges per 200 bouts start during the approach and the old
  figure counted them while counting none of their ticks. Against every other
  opponent the corrected count is slightly higher, since starts that never reach
  phase 9 now register. **So the reduction against the murmillo is 31% versus the
  mirror and 45% versus the hoplomachus** — larger than the 22% reported after the
  double-count fix, and this is the first correction in this slice to move against
  my own convenience rather than for it.
- **Non-regression, not a target.** It does not ask the candidate to *improve*
  commitment frequency, only to not buy the escape with it.
- **Why it exists, decided by the design owner, 2026-08-28.** Round-2 review
  showed the commissioned question — "is that a retiarius or a spammer?" — was
  about frequency, and that a previous revision closed it with the wrong
  statistic: the lunge *share* of his attack attempts is flat at 49.9 / 51.0 /
  53.3%, and a share is a ratio that hides its denominator.
- **The size of the effect, corrected — and the first number given was inflated
  about twofold.** `fast vs fast` contains **two** retiarii, and
  `measure-reach.ts:301` aggregates contact records by `actionId` without regard
  to actor, so the mirror's raw rate counts both of them. Per Fast fighter:

  | | lunge attempts / 1000 engaged ticks | all attacks / 1000 |
  |---|---:|---:|
  | vs murmillo (`fast vs heavy` / `heavy vs fast`) | **4.21 / 4.22** | 8.44 / 8.34 |
  | mirror, per fighter | 5.42 | 10.62 |
  | vs hoplomachus | 6.92 / 6.30 | 12.98 / 12.61 |

  So the reduction against the murmillo is about **22% against the mirror** and
  **36% against the hoplomachus** — not the 61% a first pass reported by
  comparing one retiarius against two. The finding is smaller than claimed and
  still real, and V's bar does not depend on it: 4.0 is a floor under the
  matchup's **own** measured 4.21, so the comparison that was wrong is not the
  comparison the gate makes.
- **Why it belongs in *this* slice rather than the next one.** The mechanism this
  slice proposes makes the number worse by construction: a longer or more
  successful forced disengage is more time spent retreating and less spent
  attacking. Without V, every other gate here can go green while the retiarius
  commits even less often than he does today — the precise shape of "green for
  the wrong reason" this document exists to prevent.
- **Both halves come from one run**, which the 4.21 did not: that figure joined
  attempt counts from `measure-reach.ts` to engaged ticks from
  `measure-distance.ts` by hand, across two JSON files, which is how the
  window mismatch survived being noticed.
- **Thin by design:** this is the gate most likely to fail a candidate that fixes
  the escape by keeping Fast out of the fight, which is exactly the candidate that
  should fail.
- **Named risk:** V and P pull directly against each other. If no candidate
  satisfies both, that is a design finding to report under §9, not a bar to
  lower.

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

> `measure-distance.ts` is run before and after at 200 seeds. **U is governed by
> exactly two fields, in the engaged window, in each of the five ordered matchups
> containing a Fast fighter: `pinnedShare` and `insideEnvelopeShare`.** An
> absolute change of more than **5 percentage points** in either field, in any of
> those five matchups, **stops the work** and is brought back to the design owner
> before the candidate proceeds.
>
> `median`, `p10`, `p90`, `lungeBandShare`, `beyondShare`, the `all`-tick window
> and the win rates are **reported and excluded** from U — they are context, and
> leaving the binding field unnamed let a reader pick whichever one suited, which
> is round-2 review's minor finding.

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
  **in PR-4, not PR-2**: a start-separation field on `FighterCombatState` beside
  the existing `forcedDisengageStartTick` (`encounter.ts:215`), the wiring that
  stamps and clears it, and the predicate signature that receives it — with
  serialization and invariant coverage. It lands in PR-4 because it is real
  combatant state and `stateHash.test.ts` hashes the whole `BattleState` every
  tick, so no PR containing it can also claim the digests are untouched;
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
4. ~~**The retiarius attacks 2.5x less often per engaged tick against the
   murmillo.**~~ **Promoted to gate V and corrected on the way.** The 2.5x
   compared one retiarius against the mirror's two; per fighter it is 8.44
   against 10.62, a 21% reduction. See §5 gate V and §11.
5. **`encounter.test.ts`'s "informational pacing probe" has no explicit timeout
   and will flake.** It runs 20 full bouts, takes ~900 ms unloaded, and carries
   Vitest's default 5000 ms budget — an 18% margin against a 5.5x slowdown. It
   timed out at 5184 ms during this slice's full run (with a 200-seed measurement
   competing for the machine) and passes in isolation. `stateHash.test.ts` solves
   the same problem with an explicit `30_000`. This matters beyond tidiness: the
   brief's own §4.4 records that a red gate hides the gates behind it, and
   `npm run check` stops at the first failure, so a flaky unit test costs the e2e
   report. `src/simulation/**` is closed to this slice, so it is recorded rather
   than fixed.
6. **`src/style.css:4` asks for Inter with no bundled `@font-face`**, so the
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
| 3 | blocker | The harness mis-measures the episode window at both ends, so "the direction and size of the 0.659 baseline are not established". | **Confirmed, and the reviewer was more right than either of my first two dispositions allowed.** I downgraded it to major on a ~0.022 bound (only the term that helped), then restored it at ~±0.09. Both were wrong about the *sign*. Worked out signed, `measured − true = (ordinary movement at the exit) − (first forced retreat)`, which runs from ~−0.11 to 0 — so the measurement **understates** the gain and the true median lies in [0.659, ~0.77], bracketing the bar. **Measured correctly, gate Q may already pass on shipped content.** §2's ground-opened row is marked not-established and the headline now rests on the completion rate alone. Recorded at length because I got this wrong twice, both times in the direction of my own claim. |
| 4 | major | §2.1's independence claim is false; P and Q are calibrated against columns the change moves. | **Confirmed.** §2.1 rewritten, gate P split into an absolute floor and an explicit relationship. The reviewer's refinement — keep the floor so a ratio cannot pass by degrading its denominator — is better than the bare ratio and is what P1/P2 implement. |
| 5 | major | The hypothesis is not falsifiable: R excludes only one-tick exits, U permits any distance change after an explanation. | **Confirmed in part.** Gate Q2 added for the triviality hole. U left as a report rather than a bar: §1 shows the statistic ranks the counter below the thing it counters, so a threshold on it would be a threshold on the wrong quantity — but the 5-point trigger is now a stated stopping criterion rather than an explanation quota. |
| 6 | major | The §1.2 withdrawal disposes of the geometry claim but not of the commissioned "is he still a retiarius" question; no gate bounds lunge attempts or offensive share. | **Confirmed that it was left open, and then answered by measurement rather than by a gate.** Lunge share of the retiarius' attack attempts at 200 seeds: **49.9%** vs the murmillo, 51.0% in the mirror, 53.3% vs the hoplomachus — flat within 3.4 points. He has not abandoned his signature attack against anyone; the playtest's 2095→786 was a before/after across the content change, not a per-opponent split, and it does not survive being asked per pair. No gate added. What the measurement *did* surface is unrelated and unclaimed: he attacks **2.5× less often per engaged tick** against the murmillo (8.44 against 21.24 in the mirror). Recorded in §8 as a debt. |
| 7 | major | Three PRs do not achieve their claim once a simulation diagnostic is needed. | **Confirmed.** §4.2 is now four PRs. Gate S's wording corrected: PR-3 *adds* to `measure-reach.ts`; the A–G clauses and their thresholds are frozen. |
| 8 | minor | R at 8% per matchup must be additive to pooled E at 5%, not a replacement. | **Confirmed and stated in R.** |
| 9 | minor | P and Q pool the two orientations despite the protocol promising per-ordered-matchup. | **Confirmed.** P1, P2 and Q now assert each orientation separately. |

Nothing was rejected, and the one finding I tried to downgrade was restored twice
over — the second time with its sign corrected against me. The pattern is worth
naming rather than buried: four times in this slice a number has been quoted at a
precision it did not have, and every time the imprecision ran in the direction of
the claim being made. Two of the four were caught by external review, one by
re-reading my own arithmetic, and one by a reviewer that never managed to emit a
valid report.

## 10.5 External review, round 2 — findings and disposition

Same reviewer, against the revision above. Two blockers, five majors, one minor.
Every one checked against source; **none rejected**, and two required verifying a
claim about a test I had not opened.

| # | sev | finding | disposition |
|---|---|---|---|
| 11 | blocker | The seam closes the *duration* inference and not the *semantic* one: the reason comes from the mutable predicate, the spec permitted "whatever a new predicate adds", and P counted an undefined "success reason". Cap 43, exit at 42, return `range`. | **Confirmed by reading my own text.** The hole was reopened one level up. §4.0 now freezes a closed enum — `range`, `cap`, `progress`, `censored` — forbids PR-4 adding or relabelling, and requires the gate to re-check each reason against the recorded endpoints rather than trust it. |
| 12 | blocker | PR-2 cannot satisfy its own boundary: §4.2 called the predicate closed while §4.0/§6 required changing it, and it promised frozen hashes while adding a `FighterCombatState` field. | **Confirmed, including the part I would not have found.** `stateHash.test.ts:57-80` rolls a hash of the **whole** `BattleState` after every tick of nine pairings, so a new populated field moves nine digests by construction. §4.2 restructured: the collector reads both endpoints in phase 2 and needs no new state, so PR-2 keeps its hashes; the start-separation field moves to PR-4, where behaviour changes anyway and the digests are earned. |
| 13 | major | P2's comparator moves with the change and **P1 floors the numerator, not the denominator**, contrary to what §2.1 claimed. Zero out one comparator matchup and P2 is vacuous. | **Confirmed; a plain logic error in my own gate.** Gate P3 added: every comparator matchup must independently hold ≥80% of its pre-change share. The floor I claimed to have is now the floor I have. |
| 14 | major | P, Q, Q2 and R need not describe the same episodes, and censor handling was unspecified. 25% succeeding at tick 2 with 75% capped passes all of them. | **Confirmed.** §5 now defines episode, success, and denominator; `cap` and `censored` count as non-successes; Q asserts over successes *and* all episodes; Q2 asserts over successes and adds a sub-4-tick ceiling. |
| 15 | major | The signed error bound still models locomotion only; phases 9–10 apply contact push up to 0.70 units after movement, which can dominate and reverse it. | **Confirmed, and it ends four rounds of me being wrong about one paragraph.** `encounter.ts:2364-2372` runs contact then accumulated push after phases 7–8; `heavy-cleave.pushDistance` is 0.70, six times my whole interval. Every bound and sign is deleted. The claim is now exactly "the ground-gain baseline is unestablished". |
| 16 | major | The flat lunge *share* answers a mix question, not the commissioned frequency question: 4.21 lunge attempts per 1000 engaged ticks against 10.83 in the mirror is a ~61% collapse the share hides. | **Confirmed, and it is the sharpest finding in either round.** I computed that rate myself, filed it in §8 as an unrelated debt, and then used the share to close the question. It does not close it. **Escalated to the design owner rather than answered here** — see §11. |
| 17 | minor | Gate U names "a per-pair figure" while the instrument reports several. | **Confirmed.** U now names `pinnedShare` and `insideEnvelopeShare`, engaged window, five Fast matchups, and lists what is excluded. |

## 10.7 External review, round 3 — the last round the process allows

| # | sev | finding | disposition |
|---|---|---|---|
| 20 | blocker | Gate V's numerator and denominator measure different populations. `measure-reach.ts:299-305` files contacts by outcome and records nothing for an attack interrupted before phase 9, so "attempts" was `reached + geometryFailures`; and contacts are collected over the whole bout while engaged ticks start at engagement. Eight starts at 53% geometry success and five at 80% both report ~4.2, so commitment can fall 38% with V green. | **Confirmed.** V now counts `action-started` events per Fast actor inside the latched engaged window, both halves from one run. **Its bar is withdrawn** — 4.21 was not a measurement of what V asserts — and is re-frozen in PR-3 at 95% of a re-measured baseline. |
| 21 | blocker | P accepted any positive ground as success while Q constrained only medians, and the "frozen minimum gain" had no number. A 100-episode construction — 12 epsilon successes, 13 real ones, 38 capped-but-good, 37 capped-and-bad — passes P at 25%, both Q medians at 0.80 and Q2, with half the successes opening nothing. Those premature exits also *help* V. | **Confirmed, and reproduced against `balanceCohorts.percentile` rather than taken on trust.** A success is now defined by ground — ≥0.75 units from the seam's endpoints — with the label secondary. This also removes the coupling review named as the answer to question 2: with success defined by a label, the mutable predicate was choosing Q's success-only population. |

**Round 3 also confirmed two things that needed confirming.** The four-PR
ordering is buildable, with a concrete construction: a caller-owned collector
holding pending episodes outside `EncounterState`, the predicate returning
`ExitReason | undefined` to preserve truthiness, and `stateHash.test.ts:57-80`
never passing the collector — so the nine digests hold and only boolean-specific
unit assertions need updating. And §1.2's geometry withdrawal is correct and
should not be reinstated.

**The process budget is now spent.** The brief allows three review rounds; three
have run, and round 3 returned two blockers. They are fixed above, but *the
fixes are unreviewed* — the fourth round the brief does not provide for is the
one that would check them. That is the brief's stop condition, and it goes to the
design owner rather than being decided here.

## 11. Signature-attack frequency: decided, in scope

**Resolved by the design owner, 2026-08-28: in scope.** Gate V above is the
result. What follows is the evidence and the reasoning that produced the
question, kept because the answer is only legible with it.

Measured, 200 seeds, equal-stat cohorts, engaged window:

| | vs murmillo | mirror | vs hoplomachus |
|---|---:|---:|---:|
| lunge starts per 1000 engaged ticks, **per Fast fighter** | **3.76** | 5.45 | 7.04 |
| lunge share of all attack attempts | 49.9% | 51.0% | 53.3% |

Against the murmillo the retiarius commits about **31% less often per unit of
fight time** than in his mirror and 45% less than against the hoplomachus, while
the *proportion* of his offence that is the lunge is flat. §1.2's withdrawal
disposed of the geometry claim; it did not touch this, and the flat share is the
wrong statistic for the question the playtest actually asked ("is that a
retiarius or a spammer?").

**The mirror column is per fighter and a first pass reported it raw.** The mirror
has two retiarii and the harness aggregates by action rather than by actor, so
the uncorrected figure was 10.83 and the reduction looked like 61%. It is 22%.
Recorded because that inflated number is what the scoping decision was taken
against, and the decision was re-confirmed on the corrected one.

It matters to this slice specifically because **a longer or more persistent
forced disengage reduces attack incidence further.** Every gate in §5 can pass
while the signature attack gets rarer, which is the exact shape of "green for the
wrong reason" this document exists to prevent.

**The decision was "in scope", and its cost is accepted with it:** the candidate
space narrows, possibly to nothing once §9's balance risk is applied on top. If
V and P cannot both be satisfied, the slice stops and reports the failing
distributions, per design.md's own rule and §9.

## 10.6 The second reviewer, eventually — and it found two things the first did not

`opencode` was attempted five times. `deepseek-v4-flash` failed three times (once
on arguments, twice with zero-byte results after reading the source files);
`deepseek-v4-pro` failed once with 16 KB of unterminated reasoning, then
succeeded on the round-2 brief. So round 1 had one reviewer and round 2 had two.

**Consensus on four findings**, reached independently: the PR-2 predicate
contradiction (both blocker), P1 flooring the numerator instead of the
denominator, the exit reason being self-reported by the mutable predicate, and
#6's disposition overstating what the flat lunge share proved. Four findings
found twice is the strongest signal either round produced, and all four are
accepted above.

**Two findings only the second reviewer had:**

| # | sev | finding | disposition |
|---|---|---|---|
| 18 | minor→**accepted as material** | Gate R's 8% bar sits inside its own noise. 7.8% is 67 of 859 episodes, so the binomial standard error is ~0.9 points and a bar 0.2 points above baseline is **0.22σ** — flaky by construction, on the clause the spec itself calls most likely to break. | **Confirmed by arithmetic I should have done.** R widened to 10%, ~2.4σ, with the calculation written into the gate and the looseness stated as deliberate. |
| 19 | minor | Censored episodes' membership in the denominators of P, Q2 and R is unspecified, and gate E already includes them (`measure-reach.ts:484`), so consistency is not free. | **Confirmed.** §5's definitions now state it per gate: censored count as non-successes in P's denominator, and are excluded from Q, Q2 and R because the episode has no recorded end. |

**And it sharpened the P2 finding past where the first reviewer left it.** Both
saw that P1 floors the wrong term. The second went on to show that P3 does not
rescue P2 either: whenever `min(others) < 50%`, the ratio is satisfied
automatically by P1, so **P2 is decorative across most of the space** — including
at two of P3's own three floors. It also identified what does the protecting
instead: P3 plus gate Q, which measures ground from recorded positions rather
than from a share. Both corrections are in gate P above, and the credit P1 was
given for a protection it never provided has been moved.
