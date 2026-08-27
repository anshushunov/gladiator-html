# Retiarius Reach — Design

**Status:** third revision, 2026-08-26, after two external reviews (codex
`gpt-5.6-sol`). Rewritten rather than patched: the second review returned a
blocker that invalidated every number in the previous two drafts, so a document
assembled by amendment would have carried contradictions. All measurements
below are from the corrected instrument.

**Entry point:** `docs/reviews/2026-08-25-gladiator-types-playtest.md`. That
review recorded the finding, the range table and the decision taken: *bring the
rules up to the equipment; the type choice stands, the numbers move.* This spec
does not re-litigate any of that.

## What this slice is, methodologically

The previous slice (PR #15) was presentational and changed **no** behaviour.
That was its point: the same behaviour, presented differently, either becomes
readable or does not, and a pass attributes the bottleneck to perception.

This slice is the inverse. It changes behaviour on purpose. Everything the
readable-types slice froze — `dc635911`, the nine per-tick state digests,
`encounterCapacity`'s `dbe77c5e`, the key-pose ticks 253/817/958/2106, the
balance cohorts and the golden season — is expected to move. The obligation
that replaces the freeze is that **every moved artifact is explained**, not
merely regenerated.

## The instrument comes first

Both external reviews put their heaviest finding on measurement rather than on
design, and both were right. The history is kept because it is the useful part:

- **Review 1** found the acceptance method was prose, not code, and that
  `attack-evaded` was being counted as a contact even though an evade succeeds
  precisely by leaving the attack's geometry.
- **Review 2** found the committed harness still measured the wrong thing:
  it read separation *after* `advanceBattleTick`, and phase 9 resolves contact
  while phase 10 then applies that same attack's pushback plus a fresh
  separation correction. Every reading was inflated by the hit being measured,
  and inflated by different amounts per outcome — a hit pushes fully, a blocked
  hit at 0.30 of that, a parry or a miss not at all. The tell was one number in
  the spec's own table: `heavy-cleave` reported a contact p90 of **2.03**
  against a hard authored maximum of **1.8**.

So the kernel gained a diagnostic seam and the harness was rebuilt on it.

**`src/simulation/contactDiagnostics.ts`** defines `ContactCollector`, modelled
exactly on the existing `decisionDiagnostics.ts`: write-only from the kernel's
perspective, never read back inside a tick, never in `EncounterState` or the
event log, so no trace hash folds over it. `resolveContactIntents` emits one
record per contact intent, carrying the separation from **phase 9's frozen
snapshot** — the same geometry `isWithinAttackGeometry` judged the contact by —
and a terminal outcome derived from the events that intent just emitted, so a
diagnostic can never disagree with the event log. Intents skipped because their
actor was defeated earlier in the same batch are recorded as `actor-defeated`
rather than dropped; dropping them biased every denominator, which was the
second half of the same finding.

`npm test` passes unchanged with the seam in place — 778 tests including
`dc635911` and `dbe77c5e` — which is the evidence that it is inert.

**`scripts/measure-reach.ts`** is the acceptance instrument. With `--gate` it
asserts the thresholds below and exits non-zero. Its frozen protocol:

- equal-stat cohorts (the `balance.test.ts` fixture), `--seeds` consecutive
  seeds from `20260815`, all nine ordered matchups, reported per matchup as
  well as pooled;
- one sample per `ActionInstanceId`, asserted unique;
- separation from the phase-9 snapshot; **start** separation from the opening
  of the tick the action began on, since actions start in phase 5 before that
  tick's movement;
- *reached the target* means outcome `hit`, `blocked`, `parried` or
  `missed-accuracy` — in all four the weapon arrived at that separation, and
  whether the swing landed is an accuracy or defence question. `missed-geometry`
  and `evaded` are the geometry-failure rate; `target-unavailable` and
  `actor-defeated` are counted and excluded from both;
- percentiles imported from `balanceCohorts.percentile`;
- `--overlay` deep-merges a candidate catalog and **validates** it, so a
  candidate is measured without a diff and an invalid one fails loudly;
- every yardstick is read from the *patched* catalog, never the global one.

## The defect, measured correctly

200 seeds × 9 ordered matchups. `closes` is `median(start) − median(contact)`.
`≤env` is the share of contacts landing inside the murmillo's own
`preferredRange.max` of 1.7.

| action | authored | n | start | p10 | **med** | p90 | closes | ≤env | geom fail |
|---|---|---:|---:|---:|---:|---:|---:|---:|---:|
| `heavy-shield-jab` | 0.9–1.4 | 4327 | 1.30 | 0.90 | **1.06** | 1.29 | +0.24 | 100.0% | 11.0% |
| `heavy-cleave` | 0.9–1.8 | 3333 | 1.48 | 0.90 | **1.08** | 1.51 | +0.40 | 96.9% | 14.9% |
| `fast-slash` | 0.9–1.35 | 1088 | 1.30 | 0.90 | **1.05** | 1.24 | +0.25 | 100.0% | 14.1% |
| **`fast-burst-lunge`** | 0.9–1.45 | 6774 | 2.13 | 0.90 | **0.90** | 1.20 | **+1.23** | **100.0%** | 10.5% |
| `technical-thrust` | 1.2–2.8 | 5308 | 1.74 | 1.22 | **1.53** | 2.27 | +0.21 | 64.1% | 22.7% |
| `technical-driving-thrust` | 1.6–3.1 | 1152 | 2.43 | 1.60 | **1.93** | 2.59 | +0.49 | **35.2%** | 46.2% |
| `technical-parry-counter` | 0.9–2.3 | 1056 | 1.20 | 0.90 | **0.90** | 1.58 | +0.30 | 93.8% | 0.0% |

Every value now sits inside its own authored range; the impossible p90 is gone.

**The defect is worse than the earlier drafts claimed.** The retiarius' signature
attack contacts at a median of **0.90** — the arena's `minimumSeparation`, the
closest two fighters can legally stand. Its p90 is 1.20. **100%** of its
committed contacts land inside the murmillo's fighting distance, against the
hoplomachus' 35.2%. The mechanism is visible in the same row: the lunge is
chosen at a median separation of 2.13 and carries `rootTravel` 1.40, which the
kernel clamps at `max(minimumSeparation, contactRange.min)` = 0.9
(`encounter.ts:1409`). It closes 1.23 units between decision and contact and
lands on the floor, every time.

Head to head, the hoplomachus already outreaches the retiarius by **1.32**
(2.25 against 0.92). That matters for how the criteria are shaped: see gate B.

## The numbers proposed

The equipment argument suggested a starting point; the values were selected
against the gates. The earlier drafts' "derivation" from
`horizontalEquipmentRadius` is withdrawn — review 1 was right that it is the
maximum radial corner over *all* equipment slots (`ProceduralFighter.ts:1276`),
not forward weapon reach, so the murmillo's 0.7102 is plausibly its scutum while
the other two are polearms and the fit had no common variable.

What survives without needing one: **reach in this game is an abstraction, not
geometry.** The hoplomachus strikes at 3.1 while its whole rig measures 1.3511
of horizontal radius. Any criterion built on weapon-tip geometry would fail the
coherent type first, which is why none below is.

| field | now | proposed |
|---|---:|---:|
| `fast-slash.contactRange` | 0.9–1.35 | **0.9–2.05** |
| `fast-burst-lunge.contactRange` | 0.9–1.45 | **1.60–2.40** |
| `fast-burst-lunge.rootTravel` | 1.40 | **0.50** |
| `fast-burst-lunge.startMaxRange` | 2.8 | **4.0** |
| `FAST_FORCED_DISENGAGE_END_RANGE` | 2.4 | **3.35** |

`fast-slash.contactRange.min` stays at 0.9 deliberately: the retiarius must
retain one legal attack at every distance. The hoplomachus can afford a 1.2
floor because it authors `backstep` and the decision seam gates that intent
below 1.2 to answer exactly this; the retiarius authors no `backstep`, and the
anti-stall exemption only frees movement that *restores a legal action* — a
fighter with no legal action anywhere near it is the absorbing state Task 13 had
to dig the kernel out of.

`fast-burst-lunge.contactRange.min` is **1.60 because the hoplomachus'
committed floor is 1.60**, and gate C compares the two types' shares of contacts
inside a fixed envelope. That share counts the interval `[contactRange.min, 1.7]`,
whose *width* is set by the floor, so comparing across unequal floors is
invalid. The harness asserts the equality rather than trusting prose.

`FAST_FORCED_DISENGAGE_END_RANGE` 3.35 is derived: the authored 2.4 sits 0.95
above the authored lunge's contact max of 1.45, and the same gap above 2.40 is
3.35.

## Acceptance gates, frozen before implementation

Every threshold names its source and is checked for two failure modes this
project has a documented history of: a criterion satisfied by construction, and
a criterion whose comparator moves with the thing it judges. All are asserted by
`npm run measure:reach -- --seeds 200 --gate`.

**Comparators are chosen to be independent of the change.** The hoplomachus'
pooled figures move when the retiarius moves — its `technical vs fast` component
is part of them — so where the hoplomachus is the yardstick, it is taken from
matchups containing no `fast` at all. Those are bit-identical across every run
measured, which doubles as a determinism check.

### A. The trident must not fight closer than the sword *(the defect detector)*

> The retiarius' committed contact median, pooled, is at least the murmillo's.

- **Source:** the playtest's finding stated as arithmetic. Nothing is chosen.
- **Independent?** The murmillo's figure is 1.08 authored and 1.09 at the
  proposal — it barely moves, because the murmillo's behaviour is not what
  changed.
- **Fails today:** 0.90 against 1.08. **At the proposal:** 1.89 against 1.09 ✔

### B. The spear keeps the longer reach *(a guardrail, not a detector)*

> Head to head, the hoplomachus' committed median exceeds the retiarius' by at
> least 0.20.

- **Source:** authored, and stated as authored — earlier drafts claimed a
  derivation by "trisecting" a gap, which review 1 correctly called numerology.
- **This gate passes today (+1.32) and is expected to.** It is not the defect
  detector; it exists so the fix cannot overshoot and take the longest reach
  away from the hoplomachus, which is what happened to two rejected candidates.
  A gate that already passes is only worth having when something can break it,
  and something can.
- **At the proposal:** 1.90 against 2.36, margin **+0.45** ✔
- **Why head to head** rather than pooled or against a common third: pooled
  compares two numbers that are not independent, and against the murmillo the
  *murmillo* sets the range for both. Head to head is the only matchup in which
  the question is contested. Both of its numbers move when either type moves;
  that is intentional, because it measures matchup fighting distance, which is
  what a viewer sees.

### C. The retiarius stops fighting inside the sword *(distribution, not average)*

> In its matchup against the murmillo, the share of the retiarius' committed
> contacts landing at or below the murmillo's `preferredRange.max` is no higher
> than the hoplomachus' share in *its* matchup against the murmillo.

- **Source:** the hoplomachus at **65.0%**, measured in `technical vs heavy`,
  which contains no `fast` and is bit-identical across every run.
- **Why a distribution and not a median:** a median can pass while half the
  sample still lands on the floor.
- **Fails today:** 100.0%. **At the proposal:** 40.8% ✔

### D. The *whole type* stops fighting inside the sword

> Across all of the retiarius' reached contacts — probe and committed together —
> the share inside the murmillo's envelope is no higher than the hoplomachus'
> same figure.

- **Why this exists:** review 2 predicted that gating only the committed attack
  would let the cheap probe carry the visual impression, and **measurement
  confirms it**. At the proposal `fast-slash` is selected more often than the
  lunge (4602 reached contacts against 3037) and lands at a median of 1.30 with
  **85.9%** inside the envelope. Committed-only gates would all pass while most
  of what a viewer sees is still a close-quarters fight.
- **Source:** the hoplomachus' own total, 63.0%.
- **Fails today:** 100.0%. **At the proposal:** 62.2% ✔ — by 0.8 points, which
  is thin and is named as a risk.

### E. Give-ground survives *(and is gated on ground, not on time)*

> Of Fast's forced disengages: at most **5%** clear within one tick, the median
> duration is at least **24** ticks, **and** the median separation actually
> gained is at least **0.75** units.

- **Source:** the authored behaviour, measured — 4.3%, 29 ticks, 0.77 units.
  The 5% is 4.3% rounded up; 24 is 80% of the 30-tick cap; 0.75 is 0.77 on the
  0.05 grid.
- **The third clause is review 2's finding and it earns its place.** Duration
  alone is satisfiable by making the range exit unreachable: every episode then
  pins to the cap and the median passes without Fast having retreated at all.
- **Fails at the proposal:** 3.8% ✔, median 30 ✔, **median gain 0.70 ✘**
  against 0.75. Exits shift from 3032 range / 3111 cap to 1328 / 2702 — exactly
  the pinning the clause was written to catch. This is the one gate the proposal
  fails; see "Where it stands".

### F. The parry counter still converts

> Technical's parry-to-counter conversion is at least **90%**.

- **Source:** the authored 96.5%, with room. Review 1 predicted this would
  degrade; measured, it does not (95.7% at the proposal). Gated anyway, and
  reported per incoming action so a regression specifically against the newly
  ranged Fast attacks cannot hide inside an unchanged pooled figure.

### G. Reaching further does not mean whiffing more than the spear does

> The retiarius' committed geometry-failure rate is no higher than the
> hoplomachus' own, measured over its `fast`-free matchups.

- **Source:** 47.6%, independent by construction. That half the hoplomachus'
  committed thrusts never arrive is startling, but it is the shipped, reviewed
  behaviour of the type the retiarius is being asked to resemble.
- **At the proposal:** 41.8% ✔

### H. The existing balance surface, unchanged and not to be widened

Every assertion in `balance.test.ts`, `seasonBalance.test.ts`,
`dispositionBalance.test.ts`, `balanceCohorts.ts` and
`encounterCapacity.test.ts` holds at its current value — **including the
capacity suite's non-hash, content-sensitive gates** (≥50 action instances, ≥50
contact resolutions, ≥1000 damage, ≥20 damaged combatants, the candidate-check
bounds), which an earlier draft omitted. Only the hash literals re-baseline.

design.md is explicit and this spec does not soften it: *"If allowed numeric
tuning cannot satisfy the bands, implementation stops and presents the failing
distributions rather than weakening a criterion silently."*

**Measured to be real work:** `heavy > fast` sits near 92% against a 55–75%
band at the proposal's floor. The triangle is recoverable — 0.9 measured 36%
and 1.2 measured 92%, so the interval is bracketed — but closing it is the
balance task's whole job, and every accepted tuning package must re-run the
reach gates afterwards, since damage and recovery tuning changes selection
frequencies and therefore moves the reach distributions again.

### I. The camera absorbs the new spacing

`ArenaCamera.ts` is forbidden to this slice. Acceptance is the existing
real-trace extent, safe-area, clamp and reversal checks in
`ArenaCamera.test.ts` and `tests/legibility.spec.ts`, replayed against traces
recorded from the changed build — and from nothing else. An earlier draft
supported this with arithmetic that review 2 correctly called wrong; the
arithmetic is withdrawn.

## Where it stands

All figures at 200 seeds. Package: `fast-slash` 0.9–2.05, `fast-burst-lunge`
1.60–2.40, `rootTravel` 0.50, `startMaxRange` 4.0,
`FAST_FORCED_DISENGAGE_END_RANGE` 3.35.

| gate | bar | authored | proposal | |
|---|---|---:|---:|---|
| A. not closer than the sword | ≥ murmillo's | 0.90 vs 1.08 ✘ | **1.89** vs 1.09 | ✔ |
| B. spear keeps the reach | ≥0.20 | +1.32 | **+0.45** | ✔ |
| C. vs murmillo, in-envelope | ≤65.0% | 100.0% ✘ | **40.8%** | ✔ |
| D. whole type, in-envelope | ≤ hoplomachus' | 100.0% ✘ | **62.2%** vs 63.0% | ✔ thin |
| E. disengage: immediate | ≤5% | 4.3% | **3.8%** | ✔ |
| E. disengage: duration | ≥24 | 29 | **30** | ✔ |
| E. disengage: ground gained | ≥0.75 | 0.77 | **0.70** | ✘ |
| F. parry conversion | ≥90% | 96.5% | **95.7%** | ✔ |
| G. geometry failures | ≤47.6% | 10.5% | **41.8%** | ✔ |
| H. balance bands | unchanged | — | `heavy > fast` ~92% | ✘ balance task |
| I. camera | suites pass | — | unmeasured | — |

**Headline:** the retiarius' committed attack moves from the arena's minimum
separation, 0.90, to **1.89**, and the share of its *entire* offence landing
inside the murmillo's fighting distance falls from **100% to 62.2%** — level
with the hoplomachus' 63.0%.

**The one content gate that fails** is E's ground-gained clause, at 0.70 against
0.75. The retiarius now begins its disengage from further out and more often
runs into the 30-tick cap before reaching 3.35. The levers are
`FAST_FORCED_DISENGAGE_MAX_TICKS` (30) and the exit range itself, and they pull
against gate H, since a longer forced retreat is a further nerf in the matchup
already at 92%. Closing it is the plan's first tuning task, and if it cannot be
closed jointly with H, that is a design finding to report rather than a bar to
lower.

## The CI gate

`scripts/check-allowlist.sh` listed the paths the *readable-types* slice could
touch, and `src/simulation/**` was not among them, so this slice's first PR
would have failed on its first step. It is re-scoped, and its **shape** flipped.

An allowlist suited a slice claiming "no behaviour changed": it kept the diff
out of the files that could make that claim untrue. This slice must edit every
one of them, and an allowlist rebuilt around it would admit nearly the whole
tree — a gate that forbids nothing reads as a gate that passed. So it is a
denylist, protecting the inverse risk: not *did behaviour change* (it must) but
*was the change behavioural, or quietly helped along by presentation* — and,
after review 2, *can the implementation edit the criteria it has to pass*.

**Forbidden:**

- **all presentation source** — `src/presentation/**`, `src/style.css`,
  `src/main.ts`, `index.html`. The premise is that *behaviour* separates the two
  polearms even while the silhouette does not; redrawing, reposing or reframing
  would answer the same question a second way and make the answers inseparable.
  Screenshot baselines under `tests/__screenshots__/**` stay writable — they are
  outputs, not levers.
- **acceptance logic** — the four balance/cohort files above, plus
  `scripts/measure-reach.ts`, `tests/legibility.spec.ts` and
  `playwright.config.ts`. Review 2 found the previous version let an
  implementation weaken the very criteria it had to satisfy, including the
  instrument itself.

**A single list cannot be both complete and satisfiable**, which review 2
demonstrated against the previous version: it forbade `seasonBalance.test.ts`,
which holds `GOLDEN_OUTCOMES`/`GOLDEN_SCORE`/`GOLDEN_DELTAS`, and all of
`src/presentation/`, which includes `ArenaCamera.test.ts`'s recorded tick
counts, opening distances and band-edge crossings — every one of which this
slice's behaviour change *must* update. Forbidding a file whose contents must
move is a rule that cannot be obeyed.

**So the slice ships as two PRs.**

- **Preparatory PR** — the contact-diagnostics seam, the reach harness, the
  fixture splits, and this gate. It forbids presentation *source* and the
  acceptance logic carrying no movable literal. Four files are deliberately
  open, because splitting their literals into their own fixture modules is this
  PR's job: `encounterCapacity.test.ts`, `series.test.ts`,
  `seasonBalance.test.ts`, `ArenaCamera.test.ts`. `measure-reach.ts` is open
  for the same reason — it is being authored here.
- **Content PR** — the catalog change, branched from main after the first
  merges, so its diff no longer contains the harness. Its list adds all five,
  which by then hold only assertions.

Both directions are verified: presentation source, the balance suites,
`playwright.config.ts` and `style.css` are rejected; the four pending-split
files and the screenshot baselines pass.

The gate's own file and `.github/` stay reachable — a gate that cannot maintain
itself cannot be enforced.

## Re-baselining: two kinds of artifact, two rules

Review 2's finding: the earlier draft treated the golden season's outcomes and
the series' `1–2` result like hashes, when they carry product meaning.

- **Determinism artifacts** — `dc635911`, the nine per-tick digests,
  `dbe77c5e`, `series.test.ts`'s per-bout hashes, the key-pose ticks, the
  Playwright baselines. These may be re-frozen, each with a stated reason. The
  key-pose ticks are a *behavioural* claim: if they move by hundreds of ticks
  the bout restructured, and that wants a sentence.
- **Product assertions** — the golden season's outcomes and deltas, the `1–2`
  lineup result, the camera's bounds, duration and event semantics. These must
  continue to satisfy the design's own criteria. If one cannot, it is amended
  in this spec first, in the form Task 13's calibration amendment used: the
  deviation, the measurement that forced it, what it costs.

Screenshots: run e2e without `--update` first, update only intentional
mismatches, inspect every regenerated PNG, and refresh Linux in the clean
container per `AGENTS.md`.

## What may be tuned

design.md's allowance covers fighter stats, action `damageMultiplier` and
`recoveryTicks`, the turn pairs, and Fast's evade displacement. An earlier draft
also offered `baseWeights` and locomotion speeds; review 2 was right that this
exceeds it.

**Mutable here:** the two fast attack `contactRange`s,
`fast-burst-lunge.rootTravel` and `startMaxRange`,
`FAST_FORCED_DISENGAGE_END_RANGE`, `FAST_FORCED_DISENGAGE_MAX_TICKS`,
`BURST_IN_MIN/MAX_RANGE`, plus design.md's existing allowance, plus the frozen
literals per the rule above.

**Anything else** — `baseWeights`, locomotion speeds, `preferredRange`, turn
pairs, decision intervals — requires an explicit amendment written *before* the
edit.

## Non-goals

Re-opening the type choice; any presentation change; moving
`fast.preferredRange`; a fourth type or net mechanics; widening any band.

## Risks

- **Gate E fails and its levers pull against gate H.** The plan's first tuning
  task, and the most likely place the slice stops and reports.
- **Gate D passes by 0.8 points.** The probe carries most of the retiarius'
  offence now (4602 contacts against the lunge's 3037) and still lands 85.9%
  inside the envelope. Balance tuning moves selection frequencies, so this gate
  can fail *after* a tuning package that looked harmless — which is why gate H's
  rule requires re-running the reach gates after every accepted package.
- **`fast-slash` at 0.9–2.05 is a large change discussed less than the lunge.**
  It is now legal from ~2.30 units, changes Technical's reaction opportunities
  and defense-stream consumption, and its priority-40 contact resolves ahead of
  most others. Measured effects so far: parries against it rise from 36 to 201,
  and its own geometry failures *fall* from 14.1% to 4.1%. The five-attacker
  capacity fixture and simultaneous-contact priority need exercising after the
  change.
- **The two long types converge.** Head to head the margin is +0.45, down from
  an authored +1.32.
- **The balance task is the expensive half.**

---

## Amendment — the golden series' `3–0` prohibition, decided rather than relaxed

**Written 2026-08-27, during the reconciliation task, before either side of the
conflict was edited.**

`src/testSupport/frozenFixtures/seriesTrace.ts` was created in the preparatory
PR with a conflict recorded in its header: `series.test.ts` asserted
`scores.has('3-0') === false` across all six lineups, while design.md's golden
criteria are weaker — the *all-counter* lineup must not sweep, and "at least
one different lineup wins 2–1 **or 3–0**". The test was stricter than the spec,
and the plan required that if a `3–0` ever appeared it be met deliberately.

It has appeared. Measured on the changed build, at the same fixed seed:

| lineup | score | |
|---|---|---|
| `brutus/aquila/nerva` (all counters) | **2–1** | does not sweep |
| `brutus/nerva/aquila` | **3–0** | |
| `aquila/brutus/nerva` | 1–2 | |
| `aquila/nerva/brutus` | 1–2 | |
| `nerva/brutus/aquila` | 1–2 | |
| `nerva/aquila/brutus` | 0–3 | |

**Both of design.md's golden criteria hold, and were checked directly against
this run rather than inferred from a fixture matching:**

1. the all-counter lineup does not sweep — it scores 2–1;
2. a different lineup does strictly better — `brutus/nerva/aquila` sweeps 3–0.

**The decision: the blanket prohibition is dropped; the by-name one stays.**
`series.test.ts` continues to assert that `brutus/aquila/nerva` specifically
does not sweep, which is what design.md actually forbids and what the test's
own comment says the by-name assertion exists for ("the set alone cannot tell
'some lineup sweeps' from 'the forbidden one sweeps'"). What is removed is the
extra clause forbidding *any* lineup from sweeping, which design.md never
stated.

**What this costs, stated plainly.** The product puzzle is unchanged in
substance but changes witness. The design's claim is "taking every counter must
NOT be the best available lineup, and reading the stat cards beats reading only
the archetype triangle". The lineup that now beats the all-counter ordering is
`brutus/nerva/aquila`, which throws the retiarius at the *murmillo* — the
matchup the triangle says he loses — and mirrors technical against technical.
That is a stronger illustration of the design's own point than the previous
witness was, not a weaker one. The all-counter lineup no longer *loses* (it
went 1–2, it now goes 2–1); design.md never required it to lose, only that it
not be the best.

**And one criterion is un-relaxed by this run.** Task 13 amended "at least
three distinct final score/result profiles" down to two, because a third was
unreachable. The changed content produces **four** — `3–0`, `2–1`, `1–2`,
`0–3`. The amended floor stays where it is (it is not this slice's to move),
but the original criterion is satisfied again and that is worth recording.

## Amendment — a camera finding this slice does not fix

`ArenaCamera.ts` is forbidden to this slice, and one of its acceptance criteria
now fails on the changed content. Reported rather than nudged, per the plan's
rule that a constant needing to move here "is a finding to report — a slice to
schedule, not a number to nudge".

**`ArenaCamera.test.ts`'s undamped-desired-yaw continuity bound**: the camera's
`unwrappedYaw` must not change by more than 15° in a tick. Measured over all
nine roster pairings on the changed build:

| pairing | ticks | over 15° | max |
|---|---:|---:|---:|
| `brutus/drusus` | 1911 | **1** | **17.08°** |
| every other pairing | 12 937 | 0 | ≤ 9.64° |
| **total** | **14 848** | **1** (0.0067%) | |

The single exceedance is at tick 1468 of `brutus/drusus`.

**A first draft of this amendment got the mechanism wrong, and external review
caught it.** It claimed the pair axis itself rotates "far more than 15°" under
`heavy-cleave`'s 0.70-unit push. Measured tick by tick, it does not:

| tick | pair axis | axis moved | `unwrappedYaw` moved | separation |
|---|---:|---:|---:|---:|
| 1465–1467 | −38.178° | 0.000° | 0.000° | 0.900 |
| **1468** | **−50.936°** | **12.758°** | **17.077°** | **1.011** |
| 1469–1470 | −50.936° | 0.000° | 0.000° | 1.011 |

The axis turns **12.758°** — comfortably *inside* the 15° bound. The extra
**4.319°** is not motion at all: it is dead-zone lag being released. The
camera holds a sticky reference and ignores axis changes below a 5° threshold,
so through ticks 1465–1467 the reference sat 4.319° behind an axis that was
not moving, and the one tick where the axis finally moves past the threshold
pays back the whole backlog in a single step.

**So the failing assertion is not measuring what its name says.** It is named
for desired-yaw *continuity* and it bounds axis motion **plus released
hysteresis**. A camera with a perfectly continuous unwrap and a dead zone will
trip it whenever a stalled pair suddenly turns — which is exactly the
configuration a push at the arena floor produces.

**Not fixed here, and the fix is a different one than the first draft claimed.**
It is not a slew clamp on the desired yaw: clamping would slow a legitimate
12.758° turn to hide 4.319° of bookkeeping. The bound should compare
`unwrappedYaw` against the nearest representative of the *actual* spread axis
modulo π, allowing for the dead zone, so that released lag is not counted as
motion — with the synthetic 180°-crossing test kept as the real unwrap
regression guard. Both `ArenaCamera.ts` and `ArenaCamera.test.ts` are forbidden
to this slice, so neither is done here.

Nothing in this slice changed `heavy-cleave.pushDistance`, the arena's 0.90
minimum separation, the dead zone, or the camera. What changed is which
configurations the bouts visit. The damped *output* the player actually sees is
unaffected: every other camera criterion passes, including the framing-error
bound, the reversal ceiling, the zoom-rate limit, the clamp inertness, and all
of `tests/legibility.spec.ts` (safe area, scale floor and screen separation at
all three viewports).

## Amendment — gate D's comparator is not independent, and the spec says two things

**Written 2026-08-27, after external review of the implementation. The
instrument is NOT changed here: `scripts/measure-reach.ts` is forbidden to this
slice from the content PR onward, and quietly re-deriving a gate I have to pass
is the exact move that protection exists to prevent.**

This spec states a rule and then breaks it in one gate.

The rule, from "Acceptance gates, frozen before implementation":

> **Comparators are chosen to be independent of the change.** The hoplomachus'
> pooled figures move when the retiarius moves — its `technical vs fast`
> component is part of them — so where the hoplomachus is the yardstick, it is
> taken from matchups containing no `fast` at all.

Gates C and G obey it: both read the hoplomachus from `technical vs heavy` /
`technical vs technical` only. **Gate D does not.**
`wholeTypeEnvelopeShare('technical')` sums the pooled sample across all nine
ordered matchups, including `technical vs fast` — so the yardstick moves with
the thing it is judging. That is the *fourth* instance of this defect class in
this slice's history, and the first one nobody caught until after
implementation.

**Measured on the shipped content, 200 seeds:**

| figure | value | gate D reads |
|---|---:|---|
| retiarius, whole type, in-envelope | **63.263%** | |
| hoplomachus, whole type, **pooled** (what the instrument uses) | 65.032% | **passes** |
| hoplomachus, whole type, **`fast`-free only** (what the rule requires) | **71.857%** | **passes, by 8.6 points** |
| the `63.0%` in this spec's own tables | — | **fails, by 0.263 points** |

**The defect did not flatter the change.** Repairing the comparator the way the
rule requires makes gate D pass by *more*, not less: the hoplomachus' fast-free
whole-type share is 71.857%, well above the retiarius' 63.263%. The pooled
figure is the *stricter* of the two, because the hoplomachus' `vs fast`
component drags his own average down.

**But this spec is internally inconsistent about what gate D even is**, and
that is worth more than the number. The criterion text says a *comparison* —
"no higher than the hoplomachus' same figure" — with 63.0% given as its source,
exactly the shape gate C uses. The "Where it stands" table then writes it as a
*bar*: "≤63.0%". Read as a comparison it passes either way. Read as a frozen
bar it fails by 0.263 points. Unlike gate E's floor, which the harness encodes
as a named constant (`DISENGAGE_GAIN_FLOOR`), gate D's 63.0% is nowhere in the
instrument — it is a measurement of the *authored* content recorded in prose,
which is precisely how a snapshot gets mistaken for a criterion.

**DECIDED, 2026-08-27, by the design owner: gate D is a COMPARISON, not a bar.**
The `63.0%` was a measurement of the authored content, offered as the source of
the comparison in the same way gate C offers `65.0%`, and was never a threshold.
The "Where it stands" row above is corrected to say so; the shipped content
passes at 63.263% against a hoplomachus who measures 65.032% pooled and 71.857%
`fast`-free.

**One thing is still owed, and it is not this slice's to do.** The comparator
must be fixed to take the hoplomachus from `fast`-free matchups, as gates C and
G already do, and a regression added so it cannot move with the retiarius. Prose
has now failed to enforce that rule four times in this slice alone; the fifth
time it should be code. `scripts/measure-reach.ts` is forbidden here, so the
repair belongs to whoever next opens it — and it makes gate D pass by a wider
margin, so nothing about the shipped content depends on it.

## Closing note — the three debts above are paid, 2026-08-27/28

**Written by the measurement-repair slice, which exists to discharge them.** It
changes three instruments and nothing they measure; its own CI gate closes
`src/testSupport/frozenFixtures/**` and `tests/__screenshots__/**` for exactly
that reason, so "no frozen value moved" is checked rather than asserted.

**The camera metric.** Fixed in `ArenaCamera.test.ts` alone, as the amendment
above requires — `ArenaCamera.ts` is untouched, and no constant was nudged. The
bound is split into the two properties it was conflating, each measured against
the actual spread axis unwrapped into its own chain: the axis never turns more
than 15° in a tick (worst over all nine pairings, **12.758°**, confirming this
document's measurement exactly), and the sticky reference never lags that axis
by more than the 5° dead zone (worst **4.99894°** — it saturates, as a dead zone
should). Together they bound the reference's step by 20°. The lag half is
compared *unfolded*, which makes it strictly stronger than what it replaces: it
fails at `lag = π` if the unwrap is broken, which asserting on the reference's
own per-tick delta never could. Verified by three mutations of `ArenaCamera.ts`,
each reverted.

**Gate D's comparator.** Fixed, and the fix lives in
`src/testSupport/reachHarness.ts` as `independentComparatorMatchups` rather than
in the script, so it is typechecked and has a regression: structurally, that no
selection ever names a matchup containing the subject; behaviourally, that the
`fast`-free matchups are bit-identical under an overlay moving every `fast`
attack, with a negative control on `technical vs fast`. Gates C and G are
bit-identical, and gate C's comparator label is now asserted to be a *member* of
the same set instead of a bare literal. Re-measured at 200 seeds on the shipped
content: retiarius **63.3%**, hoplomachus **71.9%** `fast`-free and **65.0%**
pooled — reproducing this document's figures, including that the repair widens
the margin rather than narrowing it.

**The `series.test.ts` split.** Finished, and it was one repair short of
finished: the leading-slot forfeit score was still inline (same class as the
three that were extracted — two real fought bouts decide it), and the comment
above the canonical-hash test still carried a *pre-slice* copy of the three
hashes, three durations and the score, so the file documented a run that no
longer existed while its assertions passed against one that did. The copy is
deleted rather than corrected. The file now holds criteria only, which is the
condition the previous gate named for closing it, and the new gate closes it.

**The one thing that did not survive first contact.** This document said the
`series.test.ts` split was complete. It was not, and the discovery is the same
shape as everything else here: the instrument, not the logic, and in the
direction that made the work look done.
