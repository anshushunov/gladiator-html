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
| D. whole type, in-envelope | ≤63.0% | 100.0% ✘ | **62.2%** | ✔ thin |
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
