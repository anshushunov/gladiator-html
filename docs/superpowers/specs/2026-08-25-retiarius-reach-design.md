# Retiarius Reach — Design

**Status:** revised 2026-08-25 after external review (codex `gpt-5.6-sol`).
The reviewer returned one blocker and seven majors and judged the first draft
not fit to plan from. Six findings were confirmed against the source and are
corrected below, marked **[revised]**; one was measured and did not hold, and
is recorded as such rather than quietly dropped. The open question the first
draft left for the reviewer is now **closed** — Variant A is withdrawn.

**Two things the reader should know before reading further.**

1. The acceptance harness now exists as committed code
   (`scripts/measure-reach.ts`), and re-measuring under its frozen protocol
   moved several of the first draft's numbers — in the direction that had
   flattered it.
2. **Measured against its own frozen gates, the package this spec proposes
   fails two of them.** Fast's forced disengage stops working, and the reach
   ordering's margin is not met — the latter because criteria 1 and 2 are
   anchored to the same reference type from opposite directions and are
   measured to conflict. Both are reported with their numbers under "Where the
   proposal stands against its own gates" rather than closed by moving a bar.
   This spec is fit to *plan a sweep* from; it is not yet fit to implement a
   catalog change from.

**Date:** 2026-08-25

**Entry point:** `docs/reviews/2026-08-25-gladiator-types-playtest.md`. That
review recorded the finding, the measured range table, why the readable-types
spec's justification for choosing the retiarius rested on half the data, and
the decision taken: *bring the rules up to the equipment; the type choice
stands, the numbers move.* This spec does not re-litigate any of that.

## What this slice is, methodologically

The previous slice (PR #15) was presentational and changed **no** behaviour.
That was its point: the same behaviour, presented differently, either becomes
readable or does not, and a pass attributes the bottleneck to perception.

This slice is the exact inverse. It changes behaviour on purpose. Everything
the readable-types slice froze — the canonical duel trace hash `dc635911`, the
nine per-tick state digests, `encounterCapacity`'s fixture hash `dbe77c5e`, the
key-pose ticks 253/817/958/2106, the balance cohorts and the golden season — is
expected to move. The obligation that replaces the freeze is that **every moved
artifact is explained**, not merely regenerated. A digest that changed for a
reason we cannot state is indistinguishable from a digest that changed because
something broke.

## The acceptance harness **[revised — this is the review's blocking finding]**

The first draft described its measurement in prose and reported numbers from a
throwaway script. The reviewer's blocking objection was that a criterion whose
measurement is not frozen is not a criterion: two reasonable harnesses disagree
about what "makes contact" means and land on different medians, so the same
implementation can pass or fail depending on who measures it.

**The harness is therefore committed code, `scripts/measure-reach.ts`
(`npm run measure:reach`), and it precedes any tuning.** Every choice the prose
left open is decided in it, in one place, with its reason. In summary:

- **Which bouts.** The equal-stat style fixture from `balance.test.ts` — same
  stats for all three styles, varying only the archetype — over `--seeds`
  consecutive seeds from `20260815`, all nine ordered matchups. Equal-stat
  rather than the roster, so that fighter tuning cannot move a reach number.
- **One sample per action instance**, keyed by `ActionInstanceId`, taken on the
  tick that instance occupies its `contact` phase.
- **Which instances count.** Only those whose geometry reached the target.
  Excluded: `attack-missed` reason `geometry`, reason `target-unavailable`, and
  **`attack-evaded`**. Included: `attack-missed` reason `accuracy`,
  `attack-blocked`, `attack-parried`, `damage-dealt` — in all four the weapon
  arrived at that separation, and whether the swing then landed is an accuracy
  or defence question rather than a reach one.
- **Percentiles** come from `balanceCohorts.percentile`, imported rather than
  reimplemented, so this file cannot drift from the convention the balance
  suites already use.
- **Weighting.** Every statistic is reported per ordered matchup *and* pooled,
  because a pooled median can move because an action was selected more often
  rather than because it began landing further out — and can pass while half
  the sample still sits at the old close distance.
- **`--overlay <file.json>`** patches the catalog before a run. That is the
  prototyping seam: candidate numbers are measured without editing content, so
  a sweep leaves no diff and cannot be mistaken for a decision.

**The evade exclusion changed the first draft's numbers, in the direction that
flattered it.** An evade succeeds exactly by leaving the attack's geometry, so
it is a geometry failure under a different event name — and it adds the
defender's authored 0.9–1.2 dash to the recorded separation. Including it
inflated every median, and inflated the long-reaching attacks most, which is
precisely the case the first draft was arguing. The hoplomachus' committed
contact median moves from 2.19 to **2.13** under the corrected rule. Every
number below is the corrected measurement.

## The defect, measured

Pooled, **100 seeds** × 9 ordered matchups. `close` is `median(start) −
median(contact)`: positive means the attack ends up nearer than where it was
chosen. `≤1.7` is the share of contacts landing inside the murmillo's own
`preferredRange.max`.

| action | authored | n | start | contact p10 | **contact med** | p90 | close | ≤1.7 | geom fail |
|---|---|---:|---:|---:|---:|---:|---:|---:|---:|
| `heavy-shield-jab` | 0.9–1.4 | 2161 | 1.28 | 1.07 | **1.37** | 1.66 | −0.08 | 93.3% | 10.6% |
| `heavy-cleave` | 0.9–1.8 | 1687 | 1.45 | 0.90 | **1.60** | 2.03 | −0.15 | 70.1% | 14.6% |
| `fast-slash` | 0.9–1.35 | 527 | 1.28 | 1.08 | **1.22** | 1.42 | +0.05 | 99.8% | 14.9% |
| **`fast-burst-lunge`** | 0.9–1.45 | 3369 | 2.05 | 0.90 | **1.25** | 1.48 | **+0.80** | **98.1%** | 10.7% |
| `technical-thrust` | 1.2–2.8 | 2596 | 1.73 | 1.38 | **1.76** | 2.54 | −0.04 | 43.3% | 23.6% |
| `technical-driving-thrust` | 1.6–3.1 | 598 | 2.41 | 1.60 | **2.24** | 2.94 | +0.17 | **11.9%** | 46.7% |
| `technical-parry-counter` | 0.9–2.3 | 548 | 1.16 | 1.30 | **1.30** | 1.94 | −0.14 | 81.8% | 0.0% |

Committed-attack medians, the ordering the slice is about:

**murmillo 1.60 · retiarius 1.25 · hoplomachus 2.24**

Three facts, and the third is the one to gate on.

1. **The hoplomachus really does fight at range.** Its committed attack lands at
   2.24 and only 11.9% of the time inside the murmillo's envelope. The
   playtest's "internally coherent" reading survives measurement.
2. **The retiarius lands the closest committed attack in the game** — 1.25,
   nearer than the murmillo's cleave at 1.60 and nearer even than the murmillo's
   *shield jab* at 1.37. The man with the trident fights inside the man with the
   short sword.
3. **98.1% of the retiarius' committed offence happens inside the murmillo's
   own fighting distance**, against the hoplomachus' 11.9%. That is
   «даже с трезубцем нужно подойти вплотную чтобы ударить» as a distribution
   rather than an average, and it is the statistic the gates below are built on.

### What causes it **[revised — the single-lever claim was overstated]**

The first draft asserted the cause was `rootTravel: 1.40` rather than
`contactRange.max`. The reviewer was right that this is stronger than the
evidence: the prototype cited proves only that raising reach *alone* is
insufficient, and the code makes the outcome jointly causal — legality reads
`startMaxRange`, both `contactRange` bounds and `rootTravel`
(`combatDecision.ts:649`); scoring reads the range bounds and the predicted
distance (`combatDecision.ts:770`); and execution walks `rootTravel /
windupTicks` per tick but stops at `max(minimumSeparation, contactRange.min)`
(`encounter.ts:1409`), while the opponent moves simultaneously.

So the claim is replaced by a measured sensitivity table. Committed medians,
same protocol, one overlay per row:

| lunge `min–max`, `rootTravel` | seeds | murmillo | **retiarius** | hoplomachus | gaps | ≤1.7 pooled | ≤1.7 vs murmillo | geom fail |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
| **0.9–1.45, 1.40** (authored) | 100 | 1.60 | **1.25** | 2.24 | −0.35 / +0.99 | 98.1% | 99.7% | 10.7% |
| 0.9–2.70, **1.40** | 25 | — | **1.25** | — | — | — | — | — |
| 1.4–2.70, 0.80 | 100 | 1.60 | **1.97** | 2.25 | +0.37 / +0.29 | 17.1% | 35.4% | 31.0% |
| 1.4–2.70, 0.70 | 50 | 1.60 | **2.05** | 2.21 | +0.45 / +0.16 | 13.6% | 35.6% | 30.0% |
| 1.4–2.70, 0.65 | 50 | 1.60 | **2.07** | 2.23 | +0.47 / +0.16 | 12.1% | 33.0% | 24.5% |
| 1.4–2.70, 0.50 | 25 | 1.46 | **2.15** | 2.21 | +0.69 / +0.05 | 8.1% | 19.0% | 19.6% |
| 1.5–2.85, 0.70 | 50 | 1.60 | **2.09** | 2.26 | +0.49 / +0.18 | 12.2% | 28.6% | 30.5% |
| **1.6–2.70, 0.80** | 50 | 1.60 | **2.07** | 2.19 | +0.47 / +0.13 | **10.7%** | **5.5%** | 41.3% |
| 1.6–2.70, 0.95 | 50 | 1.60 | **2.01** | 2.13 | +0.41 / +0.12 | 13.0% | **0.0%** | 47.9% |
| 1.9–2.70, 1.40 | 25 | 1.60 | **2.25** | 2.10 | +0.66 / **−0.15** | 0.0% | 0.0% | 51.4% |
| 2.1–2.70, 1.40 | 25 | 1.52 | **2.45** | 2.18 | +0.93 / **−0.27** | 0.0% | 0.0% | 50.8% |

Read together:

- **Reach alone does nothing.** Row 2 — reach raised to 2.70, root travel left
  authored — reproduces the authored contact median of 1.25 exactly.
- **`contactRange.min` is a contact-distance lever, not only a balance knob.**
  At the same root travel of 0.50 it moves the median from 1.91 (min 0.9) to
  2.15 (min 1.4). The first draft filed it as balance material; it is both, and
  the plan must treat it as both.
- **The reviewer's proposed third branch overshoots, measured.** Keeping
  `rootTravel` at its authored 1.40 and letting the existing clamp stop the
  approach at a raised `contactRange.min` — rows 5 and 6 — is a real mechanism
  and needs no new field, since `encounter.ts:1409` already stops root travel at
  `contactRange.min`. But it puts the retiarius *past* the hoplomachus (2.25 and
  2.45 against 2.10 and 2.18), which is the one outcome the slice forbids, and
  it drives the lunge's geometry-failure rate to ~51%. Recorded as tested and
  rejected rather than as an untried alternative.
- **The lunge's floor must be aligned with the hoplomachus', for measurement
  reasons before balance ones.** At a floor of 1.4 the retiarius shows 33–36% of
  its committed contacts inside the murmillo's envelope even at medians above
  2.05, while the hoplomachus shows 11.3% — but the two are not measuring the
  same thing. A contact "inside 1.7" can only occupy `[contactRange.min, 1.7]`,
  which is 0.30 wide for a floor of 1.4 and 0.10 wide for the hoplomachus' 1.6.
  Three times the room produces roughly three times the share, and the statistic
  is then partly reporting the floor this slice sets rather than the behaviour it
  is meant to judge — the same defect shape as the rejected p10 wording, one
  level less obvious. Setting the floor to **1.6**, matching the hoplomachus,
  makes the comparison like-for-like, and the number collapses from 35.4% to
  **5.5%**. That the collapse is this large is itself the evidence that the 35%
  was an artifact.
- **`1.6–2.70` at `rootTravel` 0.80 is therefore the proposed package** — the
  only swept row that satisfies the distribution gate on a like-for-like
  comparison. It does **not** satisfy the ordering gate's upper margin (+0.13
  against 0.20), and that conflict is reported rather than resolved by moving a
  bar; see criterion 1.

## The numbers: candidates, not a derivation **[revised]**

The first draft presented 2.70 and 2.35 as *derived*, by interpolating the
authored contact ranges against each rig's `horizontalEquipmentRadius`. The
reviewer checked the source and the derivation does not hold.
`computeHorizontalEquipmentRadius` (`ProceduralFighter.ts:1276`) traverses every
mesh carrying a `userData.slot` and returns the largest horizontal corner
radius over **all** of them — body, shield, net, helmet, greaves, weapon. It is
a camera framing input, not forward weapon reach. The murmillo's 0.7102 is
plausibly its scutum while the other two values are plausibly their polearms,
so the independent variable does not mean the same thing across the three
observations, and a line through two such points is a fit rather than a law.
The raw-weapon-length cross-check is a second two-point interpolation over
presentation authoring and supplies no independent confirmation.

**So the status of these numbers is downgraded, honestly:**

> 2.70 committed and 2.35 probe are **candidate hypotheses**. They were
> suggested by the equipment and are **selected** against the frozen behavioural
> targets below, on the catalog's 0.05 grid. If a neighbouring value measures
> better against those targets, it wins; the equipment argument gets no vote
> beyond having proposed the starting point.

The playtest's own "roughly 2.0–2.6" estimate is likewise not used as a target.
It is recorded because it is the reason this slice exists.

What the equipment *does* still establish, and this survives the reviewer's
objection because it needs no common independent variable: reach in this game
is an abstraction, not geometry. The hoplomachus strikes at 3.1 while its entire
rig measures 1.3511 of horizontal radius. Any criterion built on weapon-tip
geometry would fail the coherent type first, which is why none of the gates
below is.

### The proposed package

| field | now | proposed | why |
|---|---:|---:|---|
| `fast-slash.contactRange` | 0.9–1.35 | **0.9–2.05** | the trident poke, available from the stance; held 0.35 below the committed reach, the gap the hoplomachus' own pair uses |
| `fast-burst-lunge.contactRange` | 0.9–1.45 | **1.60–2.40** | the committed thrust; the floor matches the hoplomachus' so the distribution gate compares like with like, and 2.40 is the swept value at which the clean ordering margin reaches 0.20 |
| `fast-burst-lunge.rootTravel` | 1.40 | **0.80** | the measured row that satisfies the distribution gate |
| `fast-burst-lunge.startMaxRange` | 2.8 | **4.0** | the lunge closes from *outside* the stance rather than from inside it to contact |
| `FAST_FORCED_DISENGAGE_END_RANGE` | 2.4 | **raised** | see criterion 3; the exact value is selected against it |
| `BURST_IN_MIN/MAX_RANGE` | 2.8 / 4.0 | reviewed | the locomotion setup for a lunge that now begins further out |

`fast-slash.contactRange.min` stays at **0.9**, deliberately. The retiarius must
retain one legal attack at every distance. The hoplomachus can afford a 1.2
floor because it authors `backstep` and the decision seam gates that intent
below 1.2 specifically to answer it; the retiarius authors no `backstep` at all,
and the anti-stall exemption only frees suppressed movement that *restores a
legal action* — a fighter with no legal action anywhere near it is exactly the
absorbing state Task 13 had to dig the kernel out of. The cost is small and
correct: inside the lunge's floor the retiarius has only the 0.68× probe, which
is the counter triangle working as intended.

Fast's `baseWeights`, locomotion speeds and `preferredRange` are **not** offered
as tuning material — see "What may be tuned".

## The open question, closed: Variant A is withdrawn **[revised]**

The first draft left one question for the reviewer: whether the retiarius'
`preferredRange` (2.4–3.0) should move down to meet its new reach (Variant A),
or stay as the game's longest stand-off (Variant B). Variant A is withdrawn,
for two reasons, the first of which is disqualifying.

1. **Its criterion restates the diff.** Variant A's only additional gate was
   "the committed contact median falls inside the type's own `preferredRange`",
   and `preferredRange` is a mutable authored field. The gate is satisfiable by
   moving the band onto the measured median — and the first draft's proposed
   band, `~2.0–2.6`, was in fact chosen *after* observing a median of 2.11.
   That is exactly the failure shape the spec claimed to have excluded, written
   into the spec that claimed it.
2. **It was already measured to conflict with the ordering gate.** In the same
   prototype the retiarius measured 2.11 against the hoplomachus' 2.12 — a gap
   of 0.01 against the 0.20 the ordering requires. Variant A pulls the two long
   types onto the same stance, which is the opposite of the slice's purpose.

So `fast.preferredRange` stays **2.4–3.0**, and the retiarius keeps its claim to
the game's longest stand-off — which also means the readable-types spec's
justification for choosing the retiarius over the dimachaerus is left standing
rather than retired a second time.

**Variant B's wording is narrowed, as the reviewer asked.** "Strikes from where
he stands" is not established and this spec does not claim it: at the proposed
package the retiarius' committed median is 1.98 while its stance is 2.4–3.0, so
it still closes. The claim the slice makes, and gates, is the narrower and
measurable one:

> **The retiarius strikes from outside the murmillo's fighting envelope, and no
> longer has to enter it to land his trident.**

## Acceptance criteria, frozen before implementation

Each criterion states its **threshold**, where the threshold **came from**, and
the check that it **measures the intended thing and is reachable**. That third
part exists because of a specific past failure: the readable-types slice froze
"130 px of body height", and three quarters of what that number measured was
the fighters' *pose* rather than the *framing* the criterion was about. It
turned out unreachable not because the work was poor but because the metric was
not about the thing.

All of criteria 1–3 are produced by `npm run measure:reach --seeds 200`, whose
protocol is frozen in code.

### 1. The reach ordering — pooled **and** per matchup (gating)

> The median separation at which each type's committed attack reaches the
> target is strictly ordered `murmillo < retiarius < hoplomachus`, with a margin
> of at least **0.20** on each side, **and** the retiarius' median exceeds the
> murmillo's in every one of the three ordered matchups it appears in as the
> actor.

- **Threshold source, stated honestly [revised].** The first draft claimed 0.20
  was derived by "trisecting" the 0.59 gap between the two coherent types. The
  reviewer was right that this is numerology dressed as derivation — one point
  between two others creates two gaps, not three, and the third segment was
  never given a meaning. **0.20 is an authored design choice**, and its
  reasoning is stated rather than disguised: two margins of 0.20 leave a 0.19
  window for the retiarius inside the 0.59 gap, so the requirement is "all three
  intervals comparable" rather than "the retiarius merely not last". It is
  authored content in the same sense the 55–75% band is, and like that band it
  may not be widened to make a run pass.
- **The endpoints are not fixed, and the criterion accounts for it [revised].**
  The reviewer correctly noted that the murmillo's and hoplomachus' medians move
  when the retiarius' movement changes — measured, the murmillo ranges 1.46–1.60
  and the hoplomachus 2.10–2.21 across the candidate rows. The criterion is
  therefore stated as an *ordering with margins*, evaluated on the same run,
  never against literals carried over from a baseline.
- **Does it measure the right thing?** It fails today — 1.60 / **1.25** / 2.13,
  with the retiarius on the wrong side of both. It cannot be satisfied by
  editing the catalog, because contact separation is emergent from reach, root
  travel, locomotion and the opponent's movement. And it is not pinned by any
  clamp: the medians sit inside their ranges rather than on a bound. The
  per-matchup clause is what stops a pooled median from passing on
  action-frequency shifts.
- **Is it reachable? Measured: NOT at the proposed package, and this is the
  slice's principal open finding.** See "The measured conflict" immediately
  below. The gate does bite — it rejects both raised-`min` rows outright, at
  negative upper gaps — but it also rejects every row that satisfies criterion
  2, which is a different and more serious problem than a criterion merely being
  demanding.

#### The measured conflict between criteria 1 and 2 **[open, reported not resolved]**

Across the whole swept grid the two gates move in opposite directions, because
**both are anchored to the hoplomachus, from opposite sides**: criterion 2 asks
the retiarius to resemble it in distribution, criterion 1 asks it to stay 0.20
short of it in median. Every package that lands the distribution under the bar
pushes the median inside the margin.

| package | criterion 1 upper gap (≥0.20) | criterion 2 pooled (≤15%) |
|---|---:|---:|
| 1.4–2.70, 0.80 | **+0.29** ✔ | 17.1% ✘ |
| 1.4–2.70, 0.70 | +0.16 ✘ | 13.6% ✔ |
| 1.4–2.70, 0.65 | +0.16 ✘ | 12.1% ✔ |
| 1.5–2.85, 0.70 | +0.18 ✘ | 12.2% ✔ |
| **1.6–2.70, 0.80** | +0.13 ✘ | **10.7%** ✔ |
| 1.6–2.70, 0.95 | +0.12 ✘ | 13.0% ✔ |

No swept row satisfies both. The admissible window — a retiarius median between
roughly 2.00 and 2.05 — is **narrower than the measurement's own run-to-run
variation**: the hoplomachus' median, which the margin is measured against, was
itself observed at 2.10, 2.13, 2.19, 2.21, 2.23, 2.25 and 2.26 across these
runs, a spread of 0.16 at 25–50 seeds.

#### Swept at 200 seeds: the noise reading is refuted, and a third metric defect surfaced

The conflict above was first observed at 25–50 seeds, where one available
reading was that the admissible window is real and the measurement merely too
coarse. That reading was tested — `rootTravel` 0.80, 0.85, 0.90 and 0.95 at a
1.6 floor, 200 seeds each — and **it does not hold**. The variation collapsed
and the window did not open:

| `rootTravel` | murmillo | retiarius | hoplomachus | upper gap | ≤1.7 pooled | worst matchup |
|---:|---:|---:|---:|---:|---:|---:|
| 0.80 | 1.60 | 2.07 | 2.19 | +0.12 | 11.1% | 19.8% |
| 0.85 | 1.60 | 2.04 | 2.19 | +0.14 | 11.5% | 20.9% |
| 0.90 | 1.60 | 2.03 | 2.16 | +0.14 | 13.1% | 24.7% |
| 0.95 | 1.60 | 2.00 | 2.15 | +0.16 | 14.6% | **27.3%** |

The murmillo measures exactly 1.60 in all five runs and the hoplomachus spans
2.15–2.22, so the spread is roughly half what it was at 50 seeds and the gap
still tops out at 0.16 — while the run that comes closest is the one whose
worst-matchup distribution has already failed.

**Why the margin will not open, and the defect it exposes.** Broken out by
matchup, the hoplomachus' committed median is **2.10 in `technical vs heavy`
and 2.10 in `technical vs technical`, identical to the last digit in every
run** — those matchups contain no `fast` and are bit-identical, which doubles
as a determinism check. The only part that moves is `technical vs fast`, from
2.62 to 2.45. So the hoplomachus' *pooled* median falls because the retiarius'
behaviour changed, which means:

> **Criterion 1 as written compares two numbers that are not independent.** The
> retiarius' pooled median and the hoplomachus' pooled median are each partly a
> measurement of the same `fast`-vs-`technical` encounters, so the margin
> between them is structurally compressed by the very change being judged.

That is the third measurement defect this spec has had to correct in its own
criteria, after the evade inclusion and the floor-width contamination, and it
is the same family: a statistic that silently depends on the thing it is
supposed to judge.

**The clean comparison, and what it shows.** Comparing the two long types
against a *common third opponent* — the murmillo, whose own behaviour is
unchanged — removes the coupling entirely:

| against the murmillo | committed median | ≤1.7 |
|---|---:|---:|
| retiarius (all four `rootTravel` values) | **1.95** | 7.3–9.7% |
| hoplomachus (all five runs) | **2.10** | 15.9% |

The retiarius' figure is 1.95 in every candidate run — the margin is not noisy,
it is *stably* 0.15, and no amount of root travel moves it. **At a reach of 2.70
the 0.20 margin is unreachable**, and that is now measured rather than inferred.

But the same table shows headroom on the other axis: against the murmillo the
retiarius is at 7.3–9.7% where the hoplomachus is at 15.9%, i.e. roughly twice
the margin criterion 2 requires. That pointed at a lever the sweep had not
touched — **lowering the reach rather than the root travel** — trading
distribution headroom for ordering margin, in the direction that has room. It
was measured, at 200 seeds, holding `rootTravel` at 0.80 and the floor at 1.6:

| lunge reach | retiarius vs murmillo | ≤1.7 vs murmillo | pooled gap | worst matchup |
|---:|---:|---:|---:|---:|
| 2.70 | 1.95 | 8.4% | +0.12 | 19.8% |
| 2.55 | 1.95 | 9.4% | +0.14 | 20.1% |
| **2.40** | **1.90** | **6.8%** | +0.15 | 22.4% |

Reach is a weak lever on the clean comparison — a 0.30 cut moves the median by
0.05 — but 0.05 is what the margin needed. **Against the murmillo, at a reach of
2.40, the retiarius measures 1.90 and the hoplomachus 2.10: the margin is
exactly 0.20.** The distribution stays far inside its bar (6.8% against the
hoplomachus' 15.9%), and the worst matchup is 22.4% against 25%.

### How the conflict closes **[needs sign-off — this is the one judgement call left]**

The conflict resolves **only if criterion 1 is restated on the clean
comparison** — each type's committed median measured against a common third
opponent — instead of on pooled medians. On the pooled figures no package
reaches 0.20, including this one (+0.15).

The argument for restating it is that the pooled comparison is **demonstrably
invalid**, not merely inconvenient: the two quantities it compares share the
`fast`-vs-`technical` matchup, so changing the retiarius moves the
hoplomachus' number too. The evidence is that `technical vs heavy` and
`technical vs technical` measure 2.10 in every run to the last digit while
`technical vs fast` moves 2.62 → 2.43. This is the same class of defect as the
evade inclusion and the floor-width contamination, both of which were corrected
without controversy.

The argument against is timing, and it should be stated rather than glossed:
**the comparison was changed after the original one failed.** That is the shape
of a criterion bent to fit its result, and the fact that the reasoning is sound
does not by itself distinguish the two — a sound-sounding reason is exactly what
motivated reasoning produces. What does distinguish them, and is offered as the
test rather than as reassurance:

- the 0.20 bar itself is **unchanged**, and the package is selected against it;
- the coupling is a property of the measurement that would have been true had it
  been noticed first, and it is verifiable independently of any candidate (the
  bit-identical non-`fast` matchups);
- the restatement makes the criterion **stricter** in the matchup that matters —
  against the murmillo the retiarius must beat 2.10, where the pooled version
  let a soft `fast vs fast` median of 2.12–2.19 carry it.

**This spec does not adopt the restatement on its own authority.** It is the
one decision left open, and the plan may not proceed past it unresolved.

The remaining alternative reading is unchanged: **that 0.20 is simply the wrong
number.** It is authored — by me, without a basis, as conceded above. A margin
whose job is to make an ordering meaningful ought to be derived from that
quantity's measured variability rather than chosen; on that basis it would be
roughly 0.10, which every swept row clears. That reading is *not* adopted, for
the reason design.md gives: lowering a threshold because the work did not reach
it is the failure this project has a documented history of.

**Rejected wordings, and why** — this repo caught three "assertions that cannot
fail" in the last slice alone, and all three shapes were available here:

- *"the retiarius' attack reach ≥ its `preferredRange.min`"* — satisfied by the
  very edit it judges. It restates the diff.
- *"the p10 of the retiarius' committed contact separation is at least 1.60"* —
  looks empirical and is not: p10 sits on `contactRange.min` for both long
  types, so the statistic is pinned by the number this slice sets.
- *Variant A's "median inside its own `preferredRange`"* — satisfiable by moving
  `preferredRange`. Caught by the external reviewer, in this spec's own first
  draft. See above.

### 2. The distribution, not the average (gating)

> The share of the retiarius' committed contacts landing at or below the
> murmillo's `preferredRange.max` is at most **15%** pooled, **and** at most
> **25%** in every ordered matchup — measured with the retiarius' committed
> `contactRange.min` equal to the hoplomachus', so the two shares describe
> windows of the same width.

- **Threshold source.** The hoplomachus, unchanged and measured at 100 seeds:
  11.9% pooled, worst matchup 24.6% (its own mirror). Each bar is that value
  rounded up to the next 5% step, so the retiarius is required to reach the
  coherent type's *kind* of behaviour without being required to beat it. The
  yardstick itself is read from `COMBAT_STYLES.styles.heavy.preferredRange.max`
  at runtime rather than written as `1.7`, so a future slice that moves the
  murmillo cannot silently move the bar.
- **The floor-alignment clause is load-bearing, not a technicality.** Without
  it the statistic is partly reporting `contactRange.min` — a number this slice
  sets — because the interval it counts is `[min, 1.7]` and its width therefore
  varies with the floor. Measured: at a floor of 1.4 the vs-murmillo share is
  35.4%; at 1.6, holding everything else, it is 5.5%. Any comparison across
  unequal floors is invalid, and the criterion says so rather than leaving a
  future implementer to discover it.
- **Why it exists.** The reviewer's objection to a median-only gate: a pooled
  median can pass while nearly half the lunges still land inside the sword. This
  is the gate that a bimodal "half of them still dive" result fails.
- **Does it measure the right thing?** It is the reviewer's complaint stated
  numerically, and it fails today at **98.1%** pooled and **99.7%** against the
  murmillo — the single widest gap between the retiarius and the hoplomachus in
  any statistic this harness produces.
- **Reachable?** Measured **yes**, at the proposed package: 10.7% pooled and
  5.5% against the murmillo, both inside the hoplomachus' own figures. This is
  the gate the slice currently passes, and it passes it well.

### 3. The signature mechanics survive (gating) **[new — the reviewer found this]**

Landing further out changes the fixed distance thresholds that Fast's and
Technical's signature behaviours are wired to. Measured, the damage is real:

| package | forced disengage, median ticks | cleared within one tick | parry → counter |
|---|---:|---:|---:|
| authored | 30 | 4.4% | 96.1% |
| **1.6–2.70, `rootTravel` 0.80** (proposed) | 10 | **25.3%** | 95.4% |
| 1.4–2.70, `rootTravel` 0.80 | 14 | 22.1% | 94.8% |
| 1.4–2.70, `rootTravel` 0.65 | 10 | 30.9% | 93.2% |
| 1.4–2.70, `rootTravel` 0.50 | 7 | **39.3%** | 95.6% |
| 1.9–2.70, `rootTravel` 1.40 | 12 | 22.8% | 95.5% |

`hasFastForcedDisengageEnded` ends the forced disengage once the fighter has
opened to `FAST_FORCED_DISENGAGE_END_RANGE` = 2.4. A lunge that now *contacts*
near 2.0–2.4 is already at or past that exit, so the mechanic ends on the tick
after it starts. **This is a regression of the exact defect fixed on
2026-08-18** — the inverted range test that made Fast's "disengage before
retaliation" never run — reintroduced from the other direction, by moving the
distances rather than the comparison.

> **Gate:** the share of forced disengages clearing within one tick stays at or
> below the authored **5%** (measured 4.4%), and the median duration stays at or
> above **24** ticks (measured 30, against the 30-tick cap).
>
> **Threshold source:** the authored behaviour, which is the thing being
> preserved. The 5% is the measured 4.4% rounded up to the nearest whole
> percent; the 24 is 80% of the authored cap, allowing the mechanic to shorten
> without allowing it to stop existing.
>
> **Reachable?** **Not at the proposed package as it stands — 25.3% against a
> 5% bar, and a median of 10 ticks against a floor of 24.** The mechanic is
> being switched off, not merely shortened. `FAST_FORCED_DISENGAGE_END_RANGE`
> must move with the reach, and its value is selected against this gate; a
> plausible starting point is the lunge's `contactRange.max` plus the authored
> gap the current 2.4 keeps above 1.45, but that is a hypothesis and this spec
> does not assert it. This is the second criterion the current proposal *fails*,
> stated as such, which is the point of freezing it before implementation.

**One reviewer finding measured false, recorded rather than dropped.** The
review predicted that Technical's forced parry-counter would degrade, since it
begins only while the attacker remains within 2.3 and the retiarius would now be
striking from further out. Measured, the conversion rate moves from 96.1% to
93.2–95.8% across every candidate — one to three points. The reason is visible
in the same run: the retiarius' contacts cluster at 1.97–2.45, still mostly
inside 2.3, and Technical parries `fast-slash` at least as often. The mechanism
is nonetheless gated, at **≥90% conversion**, because it was cheap to add and
the prediction was reasonable.

### 4. Geometry failures stay in family (gating) **[new]**

> The retiarius' committed attack's geometry-failure rate stays at or below the
> hoplomachus' own, measured on the same run.

- **Why.** Reaching further means missing more: the target has more time and
  space to leave the envelope during a windup. Measured, the lunge's failure
  rate goes 10.7% → **41.3%** at the proposed package, and → ~51% at the
  rejected raised-min rows.
- **Threshold source.** The hoplomachus, unchanged: 46.7% today. That is a
  startling number in its own right — half of the hoplomachus' committed
  thrusts never arrive — but it is the existing, shipped, reviewed behaviour of
  the type this slice is asking the retiarius to resemble, so it is the honest
  comparator. Using an absolute bar instead would be inventing one.
- **Reachable?** Measured 41.3% against 46.7% — inside, but by less than the
  run-to-run spread of the hoplomachus' own figure (42.6–51.9% observed). Treat
  this gate as passing provisionally and re-measure it at 200 seeds; it exists
  primarily to reject the raised-min branch, which it does decisively.

### 5. The existing balance surface (gating, unchanged, not to be widened) **[revised]**

The first draft summarised this surface and the reviewer found the summary
incomplete. It is not re-summarised here. **Every assertion in the following
files holds at its current value, and none of their bands, seeds, cohort sizes
or metric formulas may change:**

- `src/simulation/balance.test.ts` — roster and equal-stat cohorts, including
  the per-pairing medians, the reverse-home comparative triangle assertion and
  the movement-between-committed-exchanges test;
- `src/simulation/seasonBalance.test.ts` — every season gate;
- `src/simulation/dispositionBalance.test.ts`;
- `src/testSupport/balanceCohorts.ts` — the cohort method itself;
- `src/simulation/encounterCapacity.test.ts` — **including its non-hash,
  content-sensitive gates**, which the first draft omitted: ≥50 action
  instances, ≥50 contact resolutions, ≥1000 total damage, ≥20 damaged
  combatants, and the spatial-index candidate-check bounds. Only the hash
  literal `dbe77c5e` re-baselines; the rest must pass unchanged.

design.md is explicit and this spec does not soften it: *"The cohort seed ranges
and metric formulas are test data and cannot be changed during tuning. If
allowed numeric tuning cannot satisfy the bands, implementation stops and
presents the failing distributions rather than weakening a criterion
silently."*

**This is measured to be real work.** Win rates for the candidate packages,
25 seeds per matchup so ±10pp indicative:

| lunge `min` | `heavy > fast` (band 55–75%) | `fast > heavy` |
|---|---:|---:|
| authored | 68.0% | 48.0% |
| 0.9 | 36.0% | 48.0% |
| 1.2 | 92.0% | 8.0% |
| 1.4 | 92.0–96.0% | 8.0–12.0% |

The triangle is recoverable — the band is bracketed by two measured endpoints
rather than hoped for — but the proposed package sits at the wrong end of it,
and closing that is the balance task's whole job.

### 6. The camera absorbs the new spacing (gating) **[revised]**

`src/presentation/ArenaCamera.ts` is forbidden to this slice. The existing
framing and safe-area suites must pass with no constant retuned.

The first draft supported this with arithmetic that the reviewer correctly
called wrong: it computed 5.22 as "the widest pairing this slice can produce",
when that is the widest *tactical-band* extent and bouts in fact open at 8.4
units of separation with locomotion bands reaching 4.0. **The arithmetic is
withdrawn.** Camera acceptance is established from the existing real-trace
extent, safe-area, clamp and reversal checks — `ArenaCamera.test.ts` and
`tests/legibility.spec.ts` — replayed against traces recorded from the changed
build, and from nothing else. What remains true without arithmetic is that
`BAND_HIGH_SEPARATION` is the longest authored attack reach, 3.1, and the
hoplomachus keeps it, so the band edge itself does not move.

## What may be tuned **[revised]**

The first draft offered "Fast's `baseWeights` and locomotion" as the balance
task's material. The reviewer checked design.md's tuning allowance and it does
not extend that far: it permits fighter stats, action `damageMultiplier` and
`recoveryTicks`, the turn pairs, and Fast's evade displacement. Style
`baseWeights` and locomotion speeds are authored style identity, not tuning
material.

**Mutable in this slice, by field:**

- the two fast attack `contactRange`s, `fast-burst-lunge.rootTravel` and
  `startMaxRange` — the change itself;
- `FAST_FORCED_DISENGAGE_END_RANGE` — required by criterion 3;
- `BURST_IN_MIN_RANGE` / `BURST_IN_MAX_RANGE` — the locomotion band that exists
  to set up this specific attack;
- `damageMultiplier` and `recoveryTicks` on any action, and the roster fighter
  stats — design.md's existing allowance;
- frozen golden literals, per the re-baseline rule below.

**Anything else — `baseWeights`, locomotion speeds, `preferredRange`, turn
pairs, evade displacement, decision intervals — requires an explicit amendment
in this spec, written before the edit, in the form Task 13's calibration
amendment used: the deviation, the measurement that forced it, and what it
costs.**

## What re-baselines, and the rule for it

Expected to move: `dc635911` (`battle.test.ts`, `tests/combat-visuals.spec.ts`,
`tests/orders.spec.ts`); the nine per-tick full-state digests;
`encounterCapacity`'s `dbe77c5e`; `series.test.ts`'s per-bout lineup hashes and
the `1-2` golden score; the key-pose ticks 253/817/958/2106; the cohort numbers;
the golden season; Playwright baselines on both platforms.

**The rule that replaces the freeze:** each is re-baselined with a stated
reason, and the plan carries a task whose output is that statement. A hash
literal updated with the commit message "re-baseline" is not acceptable here —
the previous slice's whole value came from those literals being load-bearing,
and the way to keep them load-bearing through a slice that must move them is to
explain each move. The key-pose ticks in particular are a *behavioural* claim:
if they move by hundreds of ticks the bout restructured, and that wants a
sentence.

## The counter triangle is its own task

Changing one type's effective reach changes every matchup that type appears in:
five of the nine roster pairings (Aquila against all three opponents, Drusus
against all three of the home roster, minus the pairing they share) and five of
the nine style matchups. The measurements show the triangle swinging from 36% to
96% on a single 0.5-unit change in one floor. Re-tuning it is a task with its own
brief, its own measured before/after, and its own budget — not a line at the end
of the content task. Its material is the list under "What may be tuned"; its
stopping rule is design.md's.

## The CI gate **[revised — the first version had a hole]**

The gate `scripts/check-allowlist.sh` listed the paths the *readable-types*
slice was allowed to touch, and `src/simulation/**` was not among them, so this
slice's first PR would have failed on its first step.

The first revision flipped it to a three-path denylist. The reviewer found the
hole: it forbade three presentation files but left `ArenaView.ts`,
`PoseController.ts`, `poses/**`, `legibilityMode.ts` and `src/main.ts` open —
all of which can change perceived reach — and, worse, it permitted edits to
`balance.test.ts`, `seasonBalance.test.ts` and `balanceCohorts.ts`, so an
implementation could weaken the very criteria it was meant to satisfy.

**The denylist is therefore widened to two groups:**

1. **Presentation source** — `src/presentation/**`, `src/style.css`,
   `index.html`, `src/main.ts`. This slice's premise is that *behaviour*
   separates the two polearms even while the silhouette does not; anything that
   changes what is drawn or how it is framed would answer the same question a
   second way and make the two answers inseparable. Playwright baselines under
   `tests/__screenshots__/**` are explicitly still writable — those are outputs,
   not levers.
2. **Acceptance logic** — `src/simulation/balance.test.ts`,
   `src/simulation/seasonBalance.test.ts`,
   `src/simulation/dispositionBalance.test.ts`, `src/testSupport/balanceCohorts.ts`.
   Verified to contain bands and method only, with no frozen literal that this
   slice must re-baseline, so forbidding them outright costs nothing.

`src/simulation/encounterCapacity.test.ts` and `src/simulation/series.test.ts`
**cannot** be handled this way: each mixes frozen literals that must move with
acceptance logic that must not. The plan's first task therefore **splits the
literals into their own fixture modules**, after which those files join group 2.
Until that split lands, both are open, and that window is named here rather than
left implicit.

The gate's own file and `.github/` stay reachable, for the same reason the
previous list admitted them: a gate that cannot maintain itself cannot be
enforced at all. The re-scope lands as its own commit **before** the content
change, so the feature diff is judged by a boundary it did not write.

## Player-facing acceptance

1. A viewer watching a retiarius bout sees him strike from outside a murmillo's
   sword, not step inside it to land his trident.
2. The retiarius and the hoplomachus are told apart by how they fight, at a
   framing where their two polearms still do not separate by silhouette.
3. The retiarius still breaks off after committing — the give-ground half of the
   type is not traded away for the reach half.
4. The counter triangle still reads: the murmillo is still the answer to the
   retiarius, and still an advantage rather than a guarantee.

## Non-goals

- Re-opening the type choice. The playtest closed it; this spec inherits it.
- Any presentation change: silhouettes, props, camera, canvas, palette, poses.
- Moving `fast.preferredRange`. Withdrawn with Variant A.
- Changing the murmillo's or the hoplomachus' numbers except as the balance task
  requires, and then only with the deviation recorded.
- A fourth type, a second weapon stream, or net mechanics.
- Widening any balance band.

## Where the proposal stands against its own gates

Stated plainly, because two of five fail and a spec that buries that is worse
than one that has not measured at all.

All figures at 200 seeds, package `fast-slash` 0.9–2.05, `fast-burst-lunge`
1.60–2.40, `rootTravel` 0.80, `startMaxRange` 4.0.

| gate | measured | verdict |
|---|---|---|
| 1. reach ordering, margins ≥0.20 — **clean comparison** | vs murmillo: retiarius 1.90, hoplomachus 2.10 → **+0.20** | ✔ **only if the restatement above is accepted**; exactly at the bar |
| 1. same, on pooled medians | +0.42 / **+0.15** | ✘ fails — and is the comparison shown to be invalid |
| 2. distribution ≤15% pooled, ≤25% per matchup | 12.5% pooled, worst 22.4%, vs murmillo 6.8% | ✔ passes |
| 3. forced disengage ≤5% immediate, median ≥24 | **23.5%**, median **11** | ✘ **fails** — fix identified, unmeasured |
| 3b. parry → counter ≥90% | 96.6% | ✔ passes |
| 4. geometry failures ≤ hoplomachus' | 43.9% vs 46.7% | ✔ thin |
| 5. balance bands unchanged | `heavy > fast` ~92% vs band 55–75% | ✘ **the balance task's entire job** |
| 6. camera unretuned | unmeasured | — pending |

## Risks

- **Criterion 3 currently fails, and fails hard.** The proposed package does not
  shorten Fast's forced disengage, it switches it off: median 10 ticks against
  an authored 30, one in four ending immediately. The fix — moving
  `FAST_FORCED_DISENGAGE_END_RANGE` — is identified but unmeasured, and it
  interacts with the balance task, since a longer forced disengage is a real
  nerf in the matchup that is already at 92%.
- **Criteria 1 and 2 are measured to conflict.** Reported above, unresolved by
  design. Whichever way it closes, it closes explicitly.
- **The balance task is the expensive half.** The reach change is a handful of
  numbers; restoring a 55–75% band across five affected matchups is where the
  slice can fail, and the measured swing (36% → 96%) says the surface is steep.
- **The two long types converge.** Both remaining levers move the retiarius
  toward the hoplomachus on the axis that separated them. Criterion 1's upper
  margin is what keeps this honest, and it is the gate that currently fails.
- **Seed counts.** The baseline is measured at 100 seeds per matchup, the
  candidate sweep at 25–50; the gates run at 200. Every candidate figure here
  is indicative, and the run-to-run spread is large enough to matter for
  criterion 1 specifically — that is part of the finding, not a caveat around
  it. Nothing is frozen on a prototype: thresholds come from the unchanged types
  or are authored openly, and the prototypes only check reachability.
- **A close-quarters absorbing state.** Raising the lunge's floor is the shape of
  the defect Task 13 dug out of the kernel. Holding `fast-slash.contactRange.min`
  at 0.9 is the mitigation; the timeout and resolution-gap bands are the
  detection.
