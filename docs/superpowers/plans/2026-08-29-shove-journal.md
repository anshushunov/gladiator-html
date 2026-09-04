# Journal — the shield-shove slice

Same rules as the murmillo-pin journal: date, phase, what was done, what was
measured with numbers, what was rejected and why, where I was wrong and how I
found out. Last line: where I stopped and what the next session does.

**One departure, stated first because it weakens the document.** The murmillo
journal's own instruction is *append as the work happens, not afterwards*. This
one was written at the close, on 2026-09-04, from the SDD ledger
(`.superpowers/sdd/2026-08-29-shield-shove/progress.md`), the four analysis
reports beside it, and the two branches' commit lists. Every number below traces
to one of those; nothing is recalled. But a journal reconstructed from a ledger
records what the ledger noticed, and the reversals that were never written down
are invisible to it. The count in §6 is therefore a floor, not a total.

---

## 2026-09-04 — the outcome, first

The slice built the murmillo's **shield shove** and adopted the murmillo-pin
slice's parked **pursuit-relative forced-disengage exit** so the two could be
fitted in one sweep, as §9.1 of the previous spec required. Thirty cells at 200
seeds were measured, a finalist was chosen, and then **three candidate builds
were run against the full slow suite. All three failed gate T. `main` passes it.**

The design owner's ruling, 2026-09-04: **instruments to `main`, both mechanics
parked.**

Which branch holds what:

| branch | tip | holds |
|---|---|---|
| `main` | `aec7a0a` | unchanged by this slice until the split lands |
| `chore/shove-instruments` | `d1bac0c`, 18 commits off `main` | the instruments, and **only** the instruments — all 22 frozen digests byte-identical to `main`'s |
| `feature/shield-shove` | `a6b2f69`, 29 commits off `main` | the shove, the chosen constants, the sweep script, and the one determinism re-baseline. Parked |
| `experiment/murmillo-pursuit-exit` | `f3d9ad5` | the previous slice's candidate exit rule. Closes **rejected as measured** — see §7 |

`heavy-shield-shove` does not exist in the catalogue on `main`, `AttackActionId`
has no member for it, and the shipped forced-disengage exit still has no gain
clause (`minGain: Infinity`). The spec's outcome banner says the same, in the
spec, so a future reader hits it before §5's sweep tables.

---

## 1. What was actually delivered

The mechanics did not ship. The measurement apparatus did, and it is what the
slice is for keeping. Named, in the order it was built:

**Ground attribution.** `DisengageSample` carries
`externalSeparationDelta` — the component of that tick's external push along the
actor→target axis — and `DisengageEpisode` carries `externalGround`, their sum.
`voluntaryGroundOpened(episode) = groundOpened(episode) − externalGround`
(`src/testSupport/disengageGates.ts:103-105`). The attribution window is
`[startTick, endTick)`, which is the interval the raw endpoints span; getting
that interval wrong is entry 2 of §3. `isSuccess` and both of `disengageStats`'s
medians read the voluntary quantity as of `04a53d8`.

**Gate W as code.** `src/testSupport/shoveGates.ts` — four pure predicates over
a run summary: the coverage floors (≥150 shove starts, ≥80 resolved contacts,
≥25% of `heavy vs fast` bouts containing a shove), the 20% frequency ceiling,
punishability against the jab, and non-empty compared populations. All nine
`ShoveRunSummary` fields are now assemblable from one artefact
(`measure-distance.ts --json`); four of them had no producer anywhere when the
interface was written, and the fix wave produced them.

**The `ContactCollector`-based counters.** Resolved shove and jab contacts are
counted from `ContactRecord`s, not from a `damage-dealt || attack-blocked`
event disjunction. That is entry 5 of §3 and it also removed a live double
count (entry 14).

**The parameterised exit rule, with the shipped default unmoved.**
`fastForcedDisengageExit` takes an explicit rule instead of reading module
constants; `EncounterState.forcedDisengageRule` is optional and never present on
the shipped path. The reviewer verified the claim independently: reverting the
four sources to `f63e136` and re-running `encounter.test.ts` produced
byte-identical received digests (`7f766dcd`, `813158a6`). The shipped exit rule
is provably unmoved, by code and by measurement.

**The batch-seed retarget test.** The single-seed corroboration on `20260837`
flapped green→red→green→red four times across this slice's builds. It is now a
200-seed batch, with N argued from a measured 82-seed longest dry stretch and a
binomial, and with *"already green at N=20, rejected"* stated in the file so the
size cannot be read as fitted.

**The camera yaw test, re-expressed as the camera's own guarantee.** The old
test asserted a 15°/tick pair-axis bound, which is a property of the *fight*, not
of the camera. It now asserts what `ArenaCamera` itself guarantees and reports
the pair-axis figure as a statistic. On `chore/shove-instruments` it prints:

```
[camera yaw] pair-axis max step 12.758 deg (brutus/drusus tick 1467),
camera yaw max step 2.257 of 5.901 deg guaranteed,
max reference lag 4.99894 of 5 deg, over 14848 ticks
```

which reproduces the pre-slice figures exactly.

**The sweep script and its distinctness guard** — `scripts/sweep-shove.ts`,
parked with the shove because it overlays `pushDistance` onto an action that
does not exist on `main`, and `applyOverlay` rejects an unknown key. Its
distinctness guard compares the **measured** half of two adjacent cells
(`perMatchup`, `gateW`, `gatesPQ`, `winRates`, `yaw`, `contradictions`,
`unmeasurableDisengages`), with inputs and `elapsedMs` excluded. That exclusion
is entry 11 of §3. The evidence it reads is committed:
`2026-08-29-shove-sweep-distinctness-{push,gain}-axis.json`.

`chore/shove-instruments`: fast suite **861 passed across 40 files** against
`main`'s **838 across 39** — +23, verified per file with `--reporter=json`, no
file losing a test — then **862** after the fix wave's one added test. `tsc`
clean, `check:allowlist` ok, e2e 59 passed with no screenshot refreshed, and
`git diff --stat aec7a0a..HEAD -- tests/ src/testSupport/frozenFixtures
src/content src/simulation/battle.ts` **empty**. The parked branch's single
re-baseline commit moved twelve frozen assertions across five files; this branch
moves none.

---

## 2. The findings that reversed under measurement

Each is: what was claimed, what measurement said, and what caught it. In the
order they happened.

### 2.1 The boundary closed every test file, in a TDD slice

Task 1 rebuilt `check-allowlist.sh` from the plan's exemption list. The list
names source files — `combatStyles.ts`, `combatActions.ts`, `encounter.ts`, the
three diagnostics/instrument files, the three presentation records,
`shoveGates.ts`, `sweep-shove.ts`, `combatDecision.ts` — and **no `*.test.ts`
file at all**. Task 2 is a TDD task: its first act is to write a failing test,
and the boundary rejected it.

Caught by Task 2 tripping over it immediately. Fixed in `a43cf28` by exempting
this slice's named test files while keeping `balance`, `seasonBalance`,
`dispositionBalance` and `encounterCapacity` closed. This one is mine, not the
implementer's — see §5 — and it is *not* counted in §6, because a boundary that
fails loudly on the next task is not an error in my favour.

### 2.2 The attribution window was off by one tick at both ends

The first implementation of `externalGround` summed pushes over `S+1 … E` while
the raw ground it is subtracted from spans `S … E−1`. The missed push at the
stamp tick **understates external ground**, which means it **overstates
voluntary ground** — it flatters the fighter, against a 0.75 bar, with
individual pushes of 0.18–0.70.

Caught by the Task 3 reviewer. Fixed to `[S, E)` and verified by hand, with
per-actor ordering proven. The kernel half of the fix — `encounter.ts` deferring
the `stamped` observation past phase 9 so it carries its own tick's push instead
of a literal `0` — went uncovered for another two weeks; reverting it left the
suite green. The fix wave closed that with a test that **fails red** when the
kernel half is reverted (`expected [] to have a length of 1 but got +0`,
`disengageDiagnostics.test.ts:415`), on a fixture at `BASELINE_TEST_SEED + 2`
where one `fast-slash` lands on the stamped tick and none on the 37 held ticks
after it, so the held-only sum is `0` and the true `externalGround` is `0.18`.

### 2.3 Ordinary attack pushes already supplied 6–16% of the ground P and Q counted

Task 4's own step-5 gate blocked on this before any shove existed.
`voluntaryGroundShare` at 200 seeds, in the five matchups with episodes (four
have none): **0.840 / 0.845 / 0.939 / 0.857 / 0.846**. So between 6% and 16% of
the ground gates P and Q were counting as *escape* was supplied by the opponent's
ordinary attack pushes, on shipped content, with no shove in the game.

Caught by the instrument the addendum required, firing on the build it was
written to establish a "before" for. The design owner's ruling: proceed, do
**not** retune `DISENGAGE_SUCCESS_GROUND`. These are the honest before-numbers;
every comparison this slice makes is against them, and the previous slice's P and
Q figures — measured on raw ground — are declared stale.

### 2.4 Gate W passed at zero shoves

The spec's first draft stated W as a frequency **ceiling** only: shoves are at
most 20% of the murmillo's attack decisions. A build in which the murmillo never
shoves scores 0%, which is under any ceiling. A one-button game where nobody
presses the button passes.

Caught by external review of the spec, before any code. W gained coverage
**floors** — ≥150 starts, ≥80 resolved contacts, ≥25% of `heavy vs fast` bouts
containing one — and an empty or undersized population makes W red rather than
skipped. Task 9 then hand-verified that the "no shoves at all" test fails against
a ceiling-only implementation, so the floor is not itself vacuous.

### 2.5 The shove counter saw 46 of 1177 resolved shoves, and failed silently

`measure-distance.ts:387` counted a resolved shove from
`damage-dealt || attack-blocked`. An **unblocked** shove deals no damage, so it
emits no `damage-dealt` — the counter saw only blocked shoves. Measured: **46 of
1177** resolved shoves, a 96% undercount.

The silence is the part worth keeping. ~230 blocked shoves at 200 seeds clears
W.1's ≥80 floor on its own, so **gate W would have gone green on a 4%
guard-attenuated sample** and reported nothing unusual. The `ContactCollector`
rewrite took the count from 82 to 1468 in the same fixture; the old count
equalled blocked-only exactly, which confirmed the diagnosis rather than merely
being consistent with it.

Caught by the Tasks 5–8 reviewer, as blocker C2.

### 2.6 The shove was 29% of the murmillo's attacks

`baseWeights['heavy-shield-shove'] = 10` was authored in spec §2.2 before any
code. Measured, it put the shove at **29.21%** of the murmillo's attack starts
against W.2's 20% ceiling (an independent re-measurement read 29.07%,
3066/10548 over 200 seeds × 9 matchups). The share is essentially
`baseWeight / Σ baseWeights`, so `pushDistance` — the sweep's only axis — could
not move it.

Ruled to `5`: **21.93%**, still red. The residual was located rather than
guessed — the naive share at `5` is `5/27 = 18.5%`, so 3.4 points were `rangeFit`,
because the shove's contact half-width was 0.35 against the jab's 0.25 and it
therefore scored well across more distances than the weight implied. Ruled to
the jab's window, `contactRange {0.9, 1.4}`: **17.51%**. W.2 passes.

That was the **last permitted attempt**; a third ratchet toward the ceiling
would have been fitting a constant to a gate, and the implementer was instructed
to report a number rather than try `1.3`. The cost is recorded in the spec and
in both catalogue comments: the shove now sits strictly inside the jab's window
instead of reaching to 1.6, and its resolved-contact population fell **27.7%**,
so every per-cell population in the sweep is smaller than the pre-ruling numbers
imply.

Caught by measurement against a gate that was frozen before the constants were
written. Not counted in §6: both moves went through a recorded ruling and left a
trace, which is what freezing a constant is for.

### 2.7 "The shove caused the yaw violation" — withdrawn

Round 1 of the Tasks 5–8 review reported a real 15°/tick pair-axis violation and
attributed it to `pushDistance 0.90` (16.22° across the 0.5–1.3 grid, with the
step non-monotone: 10.27 / 13.14 / 16.22 / 17.58 / 16.54). Round 2 corrected the
magnitude — the shipped build reads 17.75° against the 15 bound, **1 tick in
15514**, flipping with any trajectory change. I still carried the attribution.

The control cells settled it. Run at 200 seeds from `.worktrees/shove-none`, with
the shove removed from the murmillo's moveset entirely:

```
shipped rule, no shove   yaw max 16.400
gain 0.85,   no shove    yaw max 16.400
```

**16.400° at `fast vs heavy`, seed 20260967, tick 936 — byte-identical in both
no-shove controls.** The violation is present on shipped `main` with no shove and
no rule change. The slice only surfaced it by measuring 1.45M ticks where
`ArenaCamera.test.ts` measures 15k. Push magnitude worsens the maximum (17.15 at
0.7, 25.3 at 1.3) but did not create it.

Caught by a control cell. My earlier claim was wrong and is corrected here rather
than quietly dropped.

### 2.8 The series criterion I told the implementer to re-pick, and he refused

Weight 5 broke `mvpSeries`'s product criterion `statsLed > allCounters`, which
weight 10 had not, and no measured weight satisfied both. My ruling: treat the
witness seed as fragile and re-pick it — **but only after showing the criterion
holds across ≥10 seeds**, and if it fails on most, stop and report.

It failed on most. Across 20 seeds the criterion holds **4/20 on the shipped
build and 6/20 with the shove removed**. It already failed on 70% of seeds
before this slice touched anything. The witness was **not** re-picked and the
boundary opened for it went unused and was later closed again, with the closed
exemption recording its own retraction.

Caught by the implementer, executing the falsifying half of my ruling instead of
the convenient half. Had the ruling been executed as its first clause reads, a
seed would have been re-picked to make a criterion green that fails on two seeds
in three.

### 2.9 The timeout pin that would have relaxed nothing

The shove drove the `mvpSeries` bout-timeout rate from **0.00% to 1.67% (6/360)**
— under design.md's explicit 2%, over the test's zero pin. I ruled: relax to
design.md's 2%, recorded as coming *from* design.md rather than fitted to the
result.

The arithmetic kills it. `series.test.ts`'s pin governs **six bouts at one
seed**, and `floor(6 × 0.02) = 0` — a rate assertion at that scale *is* the zero
pin, rewritten in percent. It would have changed the wording and nothing else,
and a later reader would have believed a pin had been relaxed when it had not.
Widening the population does not rescue it either: **two of the six timeouts
across 360 bouts land on that one seed** (2/18 = 11.1% there against 1.67% over
20 seeds), so any small-*n* rate assertion anchored there is a coin toss, and
choosing the *n* at which it goes green is fitting a sample size to a result.

The test now asserts that every bout reaches one of the two legal terminal
states, and points at `balance.test.ts:91`, where design.md's 2% is actually
enforced on a cohort. Caught by the implementer, who deviated from the letter of
my ruling and was right to.

### 2.10 Gate Q's success clause is a tautology, and its decided clause is a readback

A read-only investigation of the 30-cell sweep JSON, dispatched because Q was
the only red gate in the finalist.

**The success clause cannot fail.** `groundMedianSuccesses` is the median of
`voluntaryGroundOpened` over a population `isSuccess` selected *by*
`voluntaryGroundOpened ≥ 0.75`. Every element is ≥ 0.75 by construction, so the
median is ≥ 0.75 unconditionally; on an empty set the median is `NaN` and
`(NaN ?? 0) < 0.75` is false, so it does not fire then either. Across **120 Q
assertions in the sweep the success-clause message appears 0 times**; all **57**
Q failures are the decided clause. Observed range over the 55 matchup-cells with
at least one success: **0.777 … 1.344**, minimum 0.027 above a bar it is
algebraically forbidden to cross. It has been vacuous since the commit that
created it, briefly non-vacuous at `2a622e1`, and vacuous again since `04a53d8`.

**The decided clause largely reads back the cell's own exit-gain parameter.**
Grouping the 50 gain-rule matchup-cells by the gain they were run at:

| exit gain | n | median-decided range | mean | mean − gain |
|---:|---:|---|---:|---:|
| 0.55 | 10 | 0.558 … 0.561 | 0.5596 | **+0.0096** |
| 0.70 | 10 | 0.705 … 0.707 | 0.7062 | **+0.0062** |
| 0.85 | 10 | 0.726 … 0.758 | 0.7399 | −0.1101 |
| 1.00 | 10 | 0.690 … 0.761 | 0.7289 | −0.2711 |
| 1.15 | 10 | 0.679 … 0.742 | 0.7213 | −0.4287 |
| shipped rule | 10 | 0.647 … 0.676 | — | — |

At low gain a `progress` exit fires the instant the fighter has made `gain`
ground, so the distribution piles up immediately above the gain and the median
sits there, to within 0.010 and 0.006, with a spread of 0.003 and 0.002 across
five push values. As the gain rises the cap takes over (cap/decided 0.23 → 0.78
→ 0.98) and the median settles into the capped population's own ground. Across
all 60 matchup-cells `groundMedianDecided` spans **0.558 … 0.761** against a bar
of **0.750** — the entire achievable range tops out 0.011 above the bar. **The
push parameter, the actual subject of this slice, moves the median by less than
the rounding in the report.**

And the bar was calibrated on a different quantity than it now reads: 0.75 came
from a baseline measured with `groundOpened`; pooled voluntary ground is
0.78–0.87 of pooled raw ground, so scaling the old 0.72 gives ≈0.60, and the
sweep's shipped-rule cells read 0.647–0.676. Q was already red on shipped
content when it was frozen. It has never been green.

Caught by the analysis, from data already in the repository. Two defects, counted
as two in §6.

### 2.11 The sweep's gate T measured only the equal-stat triangle

The sweep's T read `balance.test.ts:132,169,178` — the equal-stat
counter-triangle bands and the mirrors. It never read `balance.test.ts:111`, the
**roster** cohort's 15..85% band, nor the disposition bands, nor the season
same-style-upgrade bands.

The equal-stat cohort **passes** on the finalist build, which is why the sweep
read T as green. The roster cohort does not: `nerva/magnus` 81.0% → **86.5%**,
out of band. Four of the five slow-suite failures are in constraints the sweep
never evaluated.

**So the finalist was chosen against a gate T that could not see the failing
constraint.** Caught by running the shipped gate T — the slow suite — on the
chosen build, after choosing it.

### 2.12 The distinctness guard failed its own negative test

Task 10's fix round added a guard that two adjacent sweep cells produce
distinguishable results, so a repeat of the previous slice's dead sweep cannot
recur. Its first version compared the **whole cell**, and the whole cell includes
`push` — an *input*. A fabricated broken run, in which two cells measured
identically, passed the guard because their inputs differed.

Fixed: the compared identity is the **measured** half only — `perMatchup`,
`gateW`, `gatesPQ`, `winRates`, `yaw`, `contradictions`,
`unmeasurableDisengages` — with inputs and `elapsedMs` excluded. The reviewer
then reproduced the negative test independently: a fabricated collision exits 1
and names the colliding pair, and both committed runs are 5/5 and 6/6 distinct.

Caught by the guard's own negative test, which is the only reason it was found
before it was trusted.

### 2.13 The exit rule's "escape" ends inside the murmillo's reach

This is the finding that decided the slice.

Gate P says the rule works: on the rule-only build, `aquila/magnus`
gate-P success share goes **2.7% → 31.4%**, and `progress` exits go **0 → 373**
while cap exits fall **925 → 600**. Read from the kernel's own seam,
retiarius-side episodes, 200 seeds:

| quantity | `aquila/magnus` base | rule only |
|---|---:|---:|
| episodes | 962 | 1001 |
| exit `range` | 30 (3.1%) | 17 (1.7%) |
| exit `progress` | 0 | **373 (37.3%)** |
| exit `cap` | **925 (96.2%)** | 600 (60.0%) |
| gate-success share | 2.7% | **31.4%** |
| median ticks (decided) | **37** | **40** |
| median start separation | 1.717 | 1.717 |
| **median end separation** | **2.278** | **2.168** |

Against a murmillo the absolute 3.35 exit essentially never fired — 96.2% of
base episodes ended on the cap, with 0.575 units of median ground opened against
the 1.63 the exit needs from a start of 1.717. The gain branch turns those into
"escapes" that retire the episode at `start + 0.85 ≈ 2.57` — **inside** the
murmillo's threat envelope, where the `range` exit it replaces is at 3.35,
outside it. And the 60% that still cap are pinned **three ticks longer**, because
the cap moved 37 → 40 in the same commit.

So the median end separation **falls** while gate P's success share rises
thirteen-fold. `aquila/magnus` goes 15.0% → **13.0%** and `sura/magnus` 15.0% →
**12.0%**: the exit rule alone is a retiarius nerf in exactly the matchup it was
written for. Against another retiarius the same rule is a +8.5-point buff,
because there the absolute exit already worked (65.9% `range` exits, median end
separation 3.366) and the gain branch merely hands the fighter his decisions back
sooner, at a still-safe distance. Same rule, opposite sign, because the pursuer
is different.

**Gate P's "escape" is an exit inside reach. P and the roster disagree because
they measure different things, and the roster is the one that is a fight.**

Caught by the roster cohort, and then confirmed from the seam rather than
inferred from `gapP95` — my first reading, 309 → 283, was right in direction and
understated the mechanism.

### 2.14 The cap-37 probe made it worse

Since the gain branch and the cap move 37 → 40 shipped in one commit and no run
separated them, and since 60% of `fast vs heavy` episodes still exit on the cap
three ticks later than on base, `(gain 0.85, cap 37)` looked like an unmeasured
cell pointing the right way. I said so, and probed it.

Slow suite, no shove: **3 failed / 9 passed**. `aquila/magnus` reads **11.5%** —
**worse** than cap 40's 13.0% and worse than `main`'s 15.0%. Also `aquila/magnus`
challenge-3 wins 4.0% outside 5..95, and press's bloody-win share 1.2% < 2.0%.

**The cap was not the cause.** The gain exit's *shape* — ending the retreat at
`start + 0.85`, inside the murmillo's reach — is what hurts the retiarius.
Caught by running the cell instead of arguing from the exit mix.

### 2.15 `main` sits on the 15.0% floor for two pairings

Four of the rule-only build's five failures are pairings or clauses that were
already sitting on, or within half a point of, their limit on base:
`brutus/drusus` 84.5% against an 85% ceiling, the disposition press bloody-share
mean 2.1% against a 2.0% floor, and — the two that matter — `aquila/magnus` and
`sura/magnus` at **exactly 15.0%**, the floor itself.

This is not a robust baseline being broken. It is a baseline with no margin in
the `fast vs heavy` direction, and *any* change that costs the retiarius two
points there fails gate T. Recorded in §7 as a pre-existing fragility. Not
counted in §6 — it is a fact about `main`, not a claim of mine that flattered
itself.

### 2.16 The double count belonged to this branch's own lineage, not to `main`

The `ContactCollector` rewrite removed a real double count: a **blocked** contact
emits `attack-blocked` *and* `damage-dealt`, so the old event disjunction pushed
the same tick onto `contactsAgainst` twice. Measured at 5 seeds over the nine
matchups with no shove in the catalogue,
`recoveryWindowContactsPerJab` 0.0357 → **0.0222**, every other field identical.

I wrote it up as "a double count that has been in the punishment ledger since the
ledger existed", which on `main` reads as a defect `main` carried. It did not.
`git show aec7a0a:scripts/measure-distance.ts` has zero hits for
`ContactCollector|jabContacts|contactsAgainst|recoveryWindow` — **there is no
event-derived ledger on `main` at all.** The ledger is new work this branch
introduced at `44f20ff`; the double count lived only between that commit and its
fix at `36d8781`, in the parked branch's lineage, and never reached `main`.

The direction of the error is the point: it dressed a defect this work introduced
as a pre-existing one it was generously fixing. Caught by the final reviewer of
`chore/shove-instruments`, as M1.

### 2.17 An `rm -rf` followed a junction and emptied `node_modules`

Cleaning up the rule-only worktree, a recursive delete followed the
`node_modules` junction and emptied the main tree's `node_modules`. Task 11 found
it empty at task start and ran `npm ci` — 64 packages added, `package-lock.json`
unmodified. The rule-only worktree's removal thereafter had the junction
`rmdir`'d first, and the logs were preserved under
`.superpowers/sdd/2026-08-29-shield-shove/evidence/` before the worktree went.

The split was then done **in the main tree** via
`git switch -c chore/shove-instruments aec7a0a`, not in a worktree, which avoids
the hazard entirely: no junction created, no worktree added, none removed.

Not counted in §6 — it is an operational accident, not a claim in my favour. It
is here because it cost a full reinstall and because the mitigation is a
one-line change of method.

---

## 3. The numbers

### 3.1 The sweep's best cell — cell 7, `push 0.7 / gain 0.85`, cap 40, 200 seeds

Gates: **W, P, Q2, R, V, T all pass. Q red in one orientation.**

| | `fast vs heavy` | `heavy vs fast` |
|---|---:|---:|
| home win rate | 40.5% | **57.0%** |
| episodes | 530 | 512 |
| successes | 232 | 234 |
| P1 success share | **43.8%** | **45.7%** |
| Q, median voluntary ground, successes | 0.8644 | 0.8654 |
| **Q, median voluntary ground, all decided** | **0.7462** ✘ | **0.7577** ✔ |
| exits range / cap / progress / censored | 7 / 252 / 261 / 10 | 7 / 248 / 248 / 9 |
| shove starts / resolved contacts | 305 / 175 | 342 / 190 |
| murmillo attack starts | 1649 | 1622 |
| voluntary share of ground | 0.8405 | 0.8503 |
| yaw max | **17.152°** | 16.015° |

Cell-level gate W: 1744 shove starts, 1119 resolved contacts, 152 of 200 bouts
containing a shove, 9650 murmillo attack decisions,
`recoveryWindowContactsPerShove` 0.2869 against
`recoveryWindowContactsPerJab` 0.0138. `technical vs heavy` 63.5%,
`unmeasurableDisengages` 0, no contradictions.

Q's single miss is **0.0038** (0.7462 against 0.75). The runner-up, `0.5 / 0.85`,
carries the same gates and misses Q in **both** orientations (0.7478 / 0.7489) at
the same yaw. That 0.0038 is what §2.10 is about.

### 3.2 The two control cells — 200 seeds, shove removed from the murmillo's moveset

Run from `.worktrees/shove-none`. P1 and Q are `fast vs heavy` / `heavy vs fast`.

| build | P1 success share | Q median, decided | yaw max |
|---|---|---|---:|
| shipped rule, no shove | 1.3% / 1.1% | 0.66 / 0.64 | **16.400** |
| gain 0.85, no shove | **35.9% / 42.9%** | 0.68 / 0.72 | **16.400** |
| gain 0.85, shove 0.7 | 43.8% / 45.7% | 0.746 / 0.758 | 17.152 |

Three things this settles. **The escape defect is fixed by the gain rule, not by
the shove** — 1.1% → 42.9% with no shove at all; the shove adds a few points on
top. **Q is red on today's shipped build (0.64)** and every change moves it up
toward a floor it never reaches: not a bar this slice failed, a bar nothing has
met. **The yaw violation is not caused by the shove** — §2.7.

### 3.3 The three-way roster table — `balance.test.ts` roster cohort, 200 seeds from 20260815

Home win rate, band 15..85%. Bold = out of band.

| pairing | styles | base (`main`) | rule only | rule + shove |
|---|---|---:|---:|---:|
| brutus/drusus | heavy vs fast | 84.5% | **85.5%** | 70.5% |
| brutus/cassius | heavy vs technical | 51.0% | 51.0% | 35.5% |
| brutus/magnus | heavy mirror | 80.0% | 80.0% | 75.0% |
| aquila/drusus | fast mirror | 20.0% | 28.5% | 28.5% |
| aquila/cassius | fast vs technical | 66.5% | 67.5% | 67.5% |
| aquila/magnus | fast vs heavy | 15.0% (on the floor) | **13.0%** | 34.0% |
| nerva/drusus | technical vs fast | 19.5% | 18.5% | 18.5% |
| nerva/cassius | technical mirror | 56.0% | 56.0% | 56.0% |
| nerva/magnus | technical vs heavy | 81.0% | 81.0% | **86.5%** |
| sura/magnus (season) | fast vs heavy | 15.0% (on the floor) | **12.0%** | 24.0% |
| COMBINED | | 52.6% | 53.4% | 52.4% |

Two properties of this table are worth more than any single cell.

**The two changes are exactly orthogonal.** The exit rule moves only pairings
containing a `fast` fighter; the shove moves only pairings containing a `heavy`.
Every other cell is byte-identical across all three builds, without a single
exception across fifteen roster+season pairings, nine disposition cohort-A rows ×
three orders, and nine cohort-C rows. `nerva/cassius` — the one pairing with
neither — reads 56.0% / 1639 / 1308 / 1990 / 0.0% / 133 / 261 / 0 on all three.
That is the control saying neither measurement leaked, and it means the two
constants' effects on gate T are separable without a further sweep.

**Base sat exactly on the 15.0% floor for `aquila/magnus` and `sura/magnus`** —
§2.15.

### 3.4 The three candidate builds on the full slow suite — all fail gate T

| build | slow suite |
|---|---|
| `main` (`aec7a0a`) | **12 passed / 0 failed** |
| HEAD, rule + shove (`a6b2f69`) | 5 failed / 12 |
| rule only, cap 40 | 5 failed / 12 |
| rule only, cap 37 | 3 failed / 12 |

(The ledger listed a fourth row, "main + shove", with the same 5/12 — it was
this same HEAD build written down twice, a controller's bookkeeping error caught
while sourcing this table. No shove-without-the-rule build was ever run on the
slow suite.)

The slow project has **three** files, not four — `encounterCapacity.test.ts` is
in the fast project, and run explicitly it gives **three builds, three distinct
digests** (`a7cc237a` base, `99dfa611` rule+shove, `c1415e2a` rule-only), because
the 100-combatant FFA fixture contains both murmillos and retiarii. That is a
frozen-fixture move, not a band violation, and it is outside gate T.

The two candidate builds' failures are differently *shaped*, not differently
sized. Their band violations span four different pairings in both directions, so
neither "ship both" nor "ship the rule alone" is the smaller change. What fails
on **both**, and is therefore attributable to the exit rule alone: the `fast:`
half of the same-style-upgrade criterion (`sura` beats `aquila` against none of
the three opponents — which on base held on a single opponent by 1.5 points and a
tie), and the golden season's `vitus` delta rows.

---

## 4. Where I was wrong

The controller's errors, kept separate from the implementers'.

**The plan's Task 1 exemption list.** I wrote a boundary that named source files
and no test files, for a slice whose second task is test-driven. §2.1. It cost a
fix round and it is the kind of error a five-minute read of the next task would
have caught.

**The Task 3 ruling that moved Q's medians without touching the bar or the
consumer.** I ruled that gate Q's medians should read `voluntaryGroundOpened`.
That was right — a P/Q success whose ground is majority external is the pursuer
opening the ground, not the retiarius escaping. But I moved the numerator's
quantity and left the **bar** at 0.75, calibrated on the strictly larger raw
quantity, and left the gates' only consumer — `scripts/measure-reach.ts` —
saying nothing about it. Both consequences arrived later: §2.10's Finding 4, and
the final review's I1, which had to be fixed after the split. Three comparator
shares in `P3_FLOORS`' own docblock were stale by then (26.0 / 29.7 / 42.5% →
24.1 / 25.6 / 41.6%; the frozen floors still pass).

**Framing the sweep as good when P was red in 21 of 30 cells.** I put it to the
Q analysis that "gates P, Q2, R, V and W pass in most of them". Q2, R, V and W do
— 0 failures in 30 cells each. **P does not: it is red in 21 of 30** — all five
gain 0.55 cells, all five gain 0.70, all five gain 1.15, all five shipped-rule
cells, and cell 23. The cells where P is green are exactly gain ∈ {0.85, 1.00},
the middle of the swept range. Gate T is red in 9. The correction is in the
analysis's §9, written by the agent I had briefed with the wrong summary.

**"The shove causes the yaw violation."** §2.7. Stated as a finding, withdrawn by
a control cell.

**Choosing a finalist against a T that could not see the roster cohort.** §2.11.
This is the worst of the five, because it is the one the whole sweep rests on: I
signed off a two-dimensional grid, read T as green in the cell I picked, and the
gate that actually stops the slice was never in the sweep. Any future sweep
claiming "T passes" must say which clauses of T it ran.

---

## 5. The count

**Fourteen times this slice an instrument or a claim was wrong in my favour.**
The previous slice's count was nine.

From §2, counted: the attribution window (2.2); ordinary pushes inside the
escape statistic (2.3); gate W green at zero shoves (2.4); the shove counter's
46-of-1177 silent undercount (2.5); the yaw attribution (2.7); the series-witness
ruling (2.8); the timeout-pin ruling (2.9); gate Q's tautological success clause
and its parameter-readback decided clause (2.10, two); the sweep's blind gate T
(2.11); the distinctness guard that passed a fabricated broken run (2.12); gate
P's "escape" inside the murmillo's reach (2.13); the cap-37 inference (2.14); the
double count charged to `main` (2.16).

From §2, recorded but **not** counted, with the reason: the boundary that closed
every test file (2.1 — it fails loudly on the next task, so it is a
self-inflicted blocker, not a flattering one); the two authored constants that
moved (2.6 — both went through a recorded ruling and left a trace, which is what
freezing a constant is for); `main` on the 15.0% floor (2.15 — a fact about the
baseline, not a claim of mine); the `rm -rf` (2.17 — an accident, not a claim).

**What caught the majority: running something.** Eight of the fourteen were
caught by a measurement whose result contradicted the claim — a control cell
(2.7), a probe run (2.14), a negative test (2.12), the shipped gate T (2.11), the
roster cohort and the seam (2.13), a read-only analysis of data already in the
repository (2.10, ×2), and the instrument's own step-5 gate firing on the build
it was establishing a baseline for (2.3). Four were caught by a reviewer reading
the code (2.2, 2.4, 2.5, 2.16). **Two were caught by an implementer who declined
a ruling I had given** (2.8, 2.9) — and both times the deviation was the stricter
reading, which is the single most useful thing that happened in this slice's
process.

Not one was caught by reasoning. That is three slices running.

---

## 6. Where I stopped / next session

**The shove is parked on `feature/shield-shove`** at `a6b2f69`, with its two
authored-constant findings (§2.6) recorded in the spec at §2.2.1 and beside the
values in `src/content/combatStyles.ts`, and with the gate-T distributions in
`task-11-report.md` §5 and `rule-only-gate-t.md`. It is not merged, not tuned
further, not reverted. Its determinism re-baseline stays on that branch, where it
belongs.

**`experiment/murmillo-pursuit-exit` closes as rejected as measured.** Not buried
unmeasured: its rule was measured in two shapes — cap 40 and cap 37 — and both
make the retiarius lose *more* on the roster cohort (§2.13, §2.14). That is a
stronger closure than the previous slice was able to give it, and it reverses
that slice's closing expectation that this rule would ship.

**Recommendation: keep the branch, do not delete it.** The rule is a correct
answer to the wrong question, and the next attempt at an exit rule will otherwise
re-derive it. Delete it only after that attempt has read it. Its value is
precisely the pair (the rule, the measurement that rejects it); the rule alone
would be re-invented and the measurement alone would be unreadable.

Open, in the order a next session should take them:

1. **Gate P's definition of "escape" needs to be an exit *outside reach*.** As it
   stands, P counts an episode that ends at `start + 0.85 ≈ 2.57`, inside the
   murmillo's envelope, as a success. That is the defect §2.13 measured, and no
   candidate can be judged against P until it is fixed.
2. **Gate Q is broken and needs redefinition.** Its success clause is a theorem
   and should be deleted or replaced; its decided clause reads back the swept
   parameter and is compared against a bar calibrated on a different quantity.
   §2.10 lists three readings that would be independent — the most promising is
   the round-3 epsilon-success detector restored: median voluntary ground over
   the *claimed escapes* (`reason ∈ {range, progress}`), with the ground test
   removed from the population selector and kept in the bar.
3. **The raw-vs-voluntary separation for gate P was not run.** These two reds —
   P1 1.3% / 1.1%, Q 0.66 / 0.64, six reds all on the two murmillo matchups —
   cannot presently be split into "shipped content pins the retiarius" and "the
   voluntary switch tightened P past what shipped content ever cleared". The
   pre-switch figures for the two *murmillo* matchups were never recorded on this
   instrument; only the three comparator ones were. The probe was attempted and
   dropped rather than worked around, because it meant editing the gate. It is
   recorded as a task in `measure-reach.ts`'s own header for whoever takes the
   exit rule off the experiment branch.
4. **The human gate X never ran.** Ten blinded clips, two reviewers who did not
   implement the combat, ≥75% correct on shoves and not below their rate on the
   committed controls. That is now **two** slices in which the one gate that
   cannot be satisfied by a model's opinion has gone unrun, and it is the gate
   that would decide whether a parked mechanic reads on screen at all.
5. **Debts 5 and 7 remain unpaid.** Debt 5, `encounter.test.ts`'s untimed pacing
   probe. Debt 7, all three diagnostic collectors running caller code inside the
   tick.
6. **`main` sits on the 15.0% floor for `aquila/magnus` and `sura/magnus`.** This
   is a pre-existing fragility, not this slice's doing, and it is the reason the
   rule-only build failed: any change costing the retiarius two points in the
   `fast vs heavy` direction fails gate T. The band is being satisfied with
   equality, not with room. Whoever next touches that matchup should know it
   before they start, and should expect to bring a measurement to the design
   owner rather than a candidate.

`chore/shove-instruments` at `d1bac0c` is merge-ready: fast 862 across 40 files,
`tsc` clean, allowlist ok, e2e 59 passed, all 22 frozen digests byte-identical to
`main`'s, and the frozen-path diff empty.
