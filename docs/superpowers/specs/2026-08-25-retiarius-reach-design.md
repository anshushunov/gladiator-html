# Retiarius Reach — Design

**Status:** awaiting external review. One question is deliberately left open
for the reviewer to close (see "The open question").

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
nine per-tick state digests, `encounterCapacity`'s fixture hash, the key-pose
ticks 253/817/958/2106, the balance cohorts and the golden season — is expected
to move. The obligation that replaces the freeze is that **every moved artifact
is explained**, not merely regenerated. A digest that changed for a reason we
cannot state is indistinguishable from a digest that changed because something
broke.

## The defect, measured

The playtest named the contradiction from the authored content. Before writing
any acceptance criterion this spec measured what the content actually produces,
because "the retiarius' attack reach is 1.45" and "the retiarius fights close"
are different claims and only the second is the defect.

**Method.** Equal-stat cohorts — the fixture from `balance.test.ts`, identical
stats for all three styles, varying only the archetype — over 25–30 consecutive
seeds from `20260815`, all nine ordered matchups. For every attack instance the
root-to-root separation is recorded on the tick that instance is in its
`contact` phase, and instances that resolved as `attack-missed` with reason
`geometry` are excluded, so the figure is *where the attack actually landed*
rather than where it was aimed. Separation at the `action-started` tick is
recorded the same way.

| action | authored contact range | separation at start (med) | separation at contact (med) | Δ |
|---|---|---:|---:|---:|
| `heavy-shield-jab` | 0.9–1.4 | 1.26 | 1.36 | **+0.10** |
| `heavy-cleave` | 0.9–1.8 | 1.45 | 1.60 | **+0.15** |
| `fast-slash` | 0.9–1.35 | 1.28 | 1.23 | −0.05 |
| **`fast-burst-lunge`** | 0.9–1.45 | **2.05** | **1.25** | **−0.80** |
| `technical-thrust` | 1.2–2.8 | 1.67 | 1.80 | **+0.13** |
| `technical-driving-thrust` | 1.6–3.1 | 2.01 | 2.19 | **+0.18** |

Three facts fall out, and the third is the one that matters.

1. **The hoplomachus really does fight at range.** Its committed attack lands
   at a median of 2.19 and a p90 of 2.96. The playtest's "internally coherent"
   reading survives measurement.
2. **The retiarius lands the closest committed attack in the game** — 1.25,
   nearer than the murmillo's cleave at 1.60 and nearer even than the
   murmillo's *shield jab* at 1.36. The man with the trident fights inside the
   man with the short sword.
3. **Every attack in the game ends up further away than where it was chosen,
   except the retiarius' signature attack, which ends up 0.80 closer.** That is
   «нужно подойти вплотную чтобы ударить» in measured form.

### The cause is `rootTravel`, not `contactRange`

This was tested rather than assumed. A prototype catalog with the retiarius'
committed reach raised to 2.70 but its `rootTravel` left at the authored 1.40
measures a contact median of **1.25** — bit for bit the behaviour we are trying
to remove. Raising reach alone changes nothing, because
`predictedContactDistance` is `max(contactRange.min, d − rootTravel)`: a lunge
that carries the body 1.40 units forward is *scored* as a close-quarters attack
whatever its nominal reach, and then executes as one.

The same prototype with `rootTravel` reduced moves the contact median to 1.87
(travel 0.80) or 2.18 (travel 0.50). **Root travel is the lever; contact range
is the permission.** Both have to move, and a plan that moves only the reach
would ship a diff that reads correct and measures unchanged.

## Deriving the numbers

The playtest suggested "roughly 2.0–2.6". That was an estimate from the
trident's drawn length against the current preferred range, not a measurement,
and it is not used here. The numbers below are derived from the two types whose
reach and equipment already agree, and the derivation lands **above** the
estimate — which is the reason for deriving it.

### Reach is an abstraction, and it is a consistent one

`contactRange` is root-to-root (design.md: "Distances are center-to-center at
contact"), so it is not literal weapon geometry, and it cannot be made literal:
the hoplomachus strikes at 3.1 while its whole rig — body plus levelled spear —
measures 1.3511 of horizontal radius. Asking the trident to "physically reach"
its contact range would fail the hoplomachus first. Any criterion built on
weapon-tip geometry would therefore have been a criterion that the coherent
type already violates.

What the two coherent types *do* share is a ratio. Using the measured rig radii
(`horizontalEquipmentRadius`, computed off the built rig and asserted in
`legibilityMode.test.ts`):

| type | rig radius | committed reach | ratio | probe reach | ratio |
|---|---:|---:|---:|---:|---:|
| murmillo | 0.7102 | 1.80 | 2.53 | 1.40 | 1.97 |
| hoplomachus | 1.3511 | 3.10 | 2.29 | 2.80 | 2.07 |
| **retiarius** | **1.1465** | **1.45** | **1.26** | **1.35** | **1.18** |

The retiarius is the outlier by roughly a factor of two on both rows.

### The proposed values

Linear interpolation of the authored reaches against the measured rig radius,
through the murmillo and hoplomachus:

- committed: `1.80 + (3.10 − 1.80) × (1.1465 − 0.7102) / (1.3511 − 0.7102)` = **2.685** → authored **2.70**
- probe: `1.40 + (2.80 − 1.40) × (1.1465 − 0.7102) / (1.3511 − 0.7102)` = **2.353** → authored **2.35**

Rounding is to the catalog's existing 0.05 granularity.

**Cross-check on a different basis.** Interpolating against raw drawn weapon
length instead (gladius 0.55, trident 1.15, spear 1.30) gives 2.84 committed
and 2.52 probe — the same conclusion, ~0.15 higher. The rig-radius basis is
preferred because it is what is actually on screen: it accounts for where the
weapon is gripped and for the trident being held angled down-and-forward
(`weaponForwardBias` 0.70) against the spear's near-level 0.95, so the
trident's horizontal reach is genuinely shorter than its length ratio implies.
The cross-check is recorded so the choice of basis is auditable rather than
convenient.

**Sanity check in the other direction.** At 2.70 the retiarius' ratio becomes
2.36, sitting between the murmillo's 2.53 and the hoplomachus' 2.29 — i.e. the
proposal restores the relation rather than inventing a new one, and the
hoplomachus keeps the longest reach in the game by 0.40.

### The rest of the package

The reach numbers alone do not produce the behaviour (see "The cause is
`rootTravel`"). The coherent package is:

| field | now | proposed | why |
|---|---:|---:|---|
| `fast-slash.contactRange` | 0.9–1.35 | **0.9–2.35** | the trident poke, from the stance |
| `fast-burst-lunge.contactRange` | 0.9–1.45 | **(min: see below) – 2.70** | the committed thrust |
| `fast-burst-lunge.rootTravel` | 1.40 | **~0.80** | the actual lever; see below |
| `fast-burst-lunge.startMaxRange` | 2.8 | **~4.0** | the lunge closes from *outside* the stance, not from inside it to contact |
| `BURST_IN_MIN/MAX_RANGE` | 2.8 / 4.0 | reviewed | the locomotion setup for a lunge that now begins further out |

`fast-slash.contactRange.min` stays at **0.9**, deliberately against the
interpolation (which gives 1.10). The retiarius must retain one legal attack at
every distance. The hoplomachus can afford a 1.2 floor because it authors
`backstep` and the decision seam gates that intent below 1.2 specifically to
answer it; the retiarius authors no `backstep` at all, and the anti-stall
exemption only frees suppressed movement that *restores a legal action* — a
fighter with no legal action anywhere near it is exactly the absorbing state
Task 13 had to dig the kernel out of. The cost is small and correct: inside the
lunge's floor the retiarius has only the 0.68× probe, which is the counter
triangle working as intended (murmillo beats retiarius).

`fast-burst-lunge.contactRange.min` is **left open for the plan**, with its
selection criterion frozen here — see "One number the plan chooses".

Fast's `preferredRange`, `locomotion`, `baseWeights`, and every `damageMultiplier`
and tick count are **not** proposed values in this spec. They are the balance
task's material (see "The counter triangle is its own task"), constrained by
the acceptance criteria below and by design.md's existing tuning allowance.

## The open question

**Left open on purpose, for the external reviewer to close.** Both branches are
recorded with their measurements so the decision is made on evidence rather
than taste, and the acceptance criteria below are written so that each branch
knows which of them applies.

Every fighter carries two distance numbers: `preferredRange`, where it wants to
stand, and `contactRange`, where its blow counts. The two coherent types agree
with themselves — measured, the murmillo's committed contact median (1.60) sits
inside its own 1.2–1.7, and the hoplomachus' (2.19) inside its own 2.1–2.8. The
retiarius' 1.25 sits nowhere near its 2.4–3.0.

Raising reach far enough to make 2.4–3.0 reachable is **measured impossible**
inside this slice's own constraints: a prototype at reach 3.00 puts the
retiarius' contact median at 2.23 — still below 2.4, and already level with the
hoplomachus' 2.21, i.e. it buys nothing and costs the polearm distinction the
slice exists to create. So the two remaining branches are:

### Variant A — move the stance to the reach

`fast.preferredRange` 2.4–3.0 → **~2.0–2.6**. One rule then covers all three
types: *the median separation at which a type's committed attack lands falls
inside that type's own `preferredRange`*. Two of the three already satisfy it,
so it is not invented for this slice.

**Measured:** with the band at 2.0–2.6 the retiarius' contact median is 2.11 —
inside. ✔

**Costs, both real.**

1. The readable-types spec chose the retiarius over the dimachaerus partly
   because "`fast` holds the *longest* preferred range of the three (2.4-3.0)
   and retreats most". Variant A retires that argument for the second time in
   two slices. A replacement exists and is measured — the retiarius still has
   the fastest retreat (2.7 u/s against the hoplomachus' 2.0), the fastest
   burst (4.0), and a forced disengage no other type has — but the spec text
   and `gladiatorTypes.ts`'s header comment both have to be rewritten to say
   so, honestly, as a correction.
2. **A measured conflict with the ordering criterion.** In the same prototype
   the hoplomachus measured 2.12 and the retiarius 2.11 — a gap of 0.01 against
   the 0.20 that criterion 1 below requires. Variant A pulls the retiarius
   *toward* the hoplomachus, and pulling the two long types onto nearly the
   same stance is the opposite of what the slice is for. Adopting Variant A
   therefore also requires showing the two criteria can hold together, most
   likely by raising `rootTravel` back toward 0.80; if they cannot, that is a
   design finding under the rule below.

### Variant B — keep the stance, gate on the ordering

`fast.preferredRange` stays 2.4–3.0. The retiarius remains the type that stands
furthest out; what changes is that it now strikes *from* that stance instead of
diving out of it, and the top of its band becomes the launch point for a lunge
that begins outside the band (`startMaxRange` ~4.0) rather than a dead zone it
has to abandon.

**Cost:** the "median contact inside own band" rule does not apply to the
retiarius, so it is gated on criterion 1 alone and its stance/reach relation is
reported rather than asserted. One type keeps a rule of its own.

**Measured:** reachable at `rootTravel` 0.80 — contact median 1.87–1.99,
against the murmillo's 1.60 and the hoplomachus' 2.19–2.25. ✔

## Acceptance criteria, frozen before implementation

Each criterion below states its **threshold**, where the threshold **came
from**, and the check that it **measures the thing we want and is reachable**.
That third part exists because of a specific past failure: the readable-types
slice froze "130 px of body height", and three quarters of what that number
measured was the fighters' *pose* rather than the *framing* the criterion was
about. It turned out unreachable not because the work was poor but because the
metric was not about the thing. So no threshold here is frozen without first
being run against existing data.

### 1. The reach ordering (gating, both variants)

> The median root-to-root separation at which each type's **committed** attack
> makes contact is strictly ordered `murmillo < retiarius < hoplomachus`, with a
> margin of at least **0.20** on each side.

- **Threshold source.** Not chosen. The two unchanged types measure 1.60 and
  2.19, a gap of 0.59; requiring the retiarius to sit strictly between them
  with equal room on both sides trisects that gap, giving 0.20. Nothing about
  this number is read off a prototype of the change it judges.
- **Does it measure the right thing?** Yes, and this was checked before
  freezing. It fails today — 1.60 / **1.25** / 2.19, with the retiarius on the
  wrong side of both — which is exactly the defect. It cannot be satisfied by
  editing the catalog, because contact separation is an emergent outcome of
  reach, root travel, locomotion and the opponent's own movement. And it is not
  guaranteed by any clamp: the medians sit inside their ranges, not on a bound.
- **Is it reachable?** Measured yes, and it bites. At `rootTravel` 0.80 the
  retiarius measures 1.87–1.99 (margins 0.27–0.39 and 0.21–0.38 ✔). At
  `rootTravel` 0.50 it measures 2.18, whose upper margin is 0.02 ✘. The
  criterion therefore constrains root travel toward 0.80 rather than rubber-
  stamping whatever the implementation produces.

**Rejected wordings, and why** — this repo has caught three "assertions that
cannot fail" in the last slice alone, and the same three shapes were available
here:

- *"the retiarius' attack reach ≥ its `preferredRange.min`"* — satisfied by the
  very edit it judges. It restates the diff.
- *"the p10 of the retiarius' committed contact separation is at least 1.60"* —
  looks empirical and is not. p10 for both the hoplomachus and the retiarius
  sits exactly on `contactRange.min`, so the statistic is pinned by the number
  this slice sets. It would be the threshold guaranteed by its own clamp,
  again.
- *the 0.20 margin taken from a prototype run* — a criterion derived from the
  result it evaluates. Taken from the two unchanged types instead.

### 2. The stance relation (gating, **Variant A only**)

> Each type's committed-attack contact median falls inside that type's own
> `preferredRange`.

- **Threshold source.** The behaviour of the two types the playtest calls
  coherent. Verified against existing data before adoption: murmillo 1.60 in
  1.2–1.7 ✔, hoplomachus 2.19 in 2.1–2.8 ✔, retiarius 1.25 against 2.4–3.0 ✘.
- **Reachable?** Measured yes at a band of 2.0–2.6 (contact median 2.11), and
  measured *impossible* at the current 2.4–3.0 for any reach that keeps the
  hoplomachus longest — which is what makes this criterion Variant A's and not
  the slice's.

Under **Variant B** this is not a criterion. It is reported for all three types
in the slice's review note, so the asymmetry is visible rather than quietly
dropped.

### 3. Δ (start → contact) — reported, deliberately **not** gated

The single number that names the defect most clearly (−0.80 against +0.10 to
+0.18 for everything else) is not a gate, and the reason is worth recording so
the omission does not read as an oversight.

- It has **no reference class**. `fast-burst-lunge` is the only attack in the
  game tagged `burst`; a burst is *supposed* to close, so the five non-burst
  attacks cannot supply an honest threshold for it. Any bar would be invented.
- It is **invariant to the thing we actually want**. A fighter that dives from
  5.0 to 4.2 scores the same −0.80 as one that dives from 2.05 to 1.25. On its
  own it does not distinguish "fights at reach" from "fights close after a long
  approach", which is precisely the confusion this slice exists to end.

So it is measured and published every run (baseline −0.79; prototypes −0.22 to
−0.48), and criterion 1 does the gating.

### 4. The existing balance bands (gating, unchanged, not to be widened)

Every band in `balance.test.ts` and `seasonBalance.test.ts` holds at its
current value: advantaged style 55–75%, mirrors 45–55%, per-pairing home win
rate 15–85%, combined median 1500–2400, p10 ≥ 900, p95 < 3200, timeout < 2%,
resolution-gap p95 ≤ 300, approach p95 ≤ 600, zero unresolved bouts.

design.md is explicit and this spec does not soften it: *"The cohort seed ranges
and metric formulas are test data and cannot be changed during tuning. If
allowed numeric tuning cannot satisfy the bands, implementation stops and
presents the failing distributions rather than weakening a criterion
silently."*

**This is measured to be real work, not a formality.** Every prototype breaks
it, and the breakage is large:

| prototype | `heavy > fast` (band 55–75%) | `fast > heavy` |
|---|---:|---:|
| baseline | 68.0% | 48.0% |
| lunge min 0.9 | 36.0% | 48.0% |
| lunge min 1.2 | 92.0% | 8.0% |
| lunge min 1.4 | 92.0–96.0% | 8.0–12.0% |

(25 seeds per matchup, so these are ±10pp indicative rather than cohort-grade;
the real cohorts are 500.)

The triangle is recoverable — the band is bracketed by two measured endpoints
rather than merely hoped for — but it is recoverable through a number this spec
deliberately does not fix.

### 5. The camera absorbs the new spacing (gating)

`src/presentation/ArenaCamera.ts` is forbidden to this slice (see the allowlist
below). Giving the retiarius real reach widens the pair separations the camera
sees; the existing flat band must cover them with no constant retuned, and the
framing and safe-area tests must pass unchanged. If the camera genuinely needs
to move, that is a finding to report and a slice to schedule, not a constant to
nudge inside this one.

Arithmetic supporting the expectation, so the criterion is not a coin flip: the
flat region runs to a group extent of 6.07242, and the widest pairing this
slice can produce is retiarius-vs-retiarius at 2.70 + 2 × 1.1465 × 1.1 = 5.22.
The band edge stays untouched too — `BAND_HIGH_SEPARATION` is the longest
authored attack reach, 3.1, and the hoplomachus keeps it.

## One number the plan chooses

`fast-burst-lunge.contactRange.min` is not fixed here. Its **selection
criterion is** fixed here, which is what the pre-commit discipline actually
requires:

> The lowest value in `[0.9, 1.4]`, on the catalog's 0.05 granularity, that
> satisfies criteria 1 and 4 simultaneously. Lowest, because a higher floor is
> a larger disarmament of the retiarius at close quarters, and nothing about
> the equipment argues for one.

Both endpoints are already measured (0.9 → `heavy > fast` 36%; 1.2 → 92%), so
the interval is bracketed and the search is bounded. If no value in it
satisfies both criteria, that is a design finding: implementation stops and
reports the distributions.

## What re-baselines, and the rule for it

Expected to move, all of them:

- `dc635911` — the canonical duel trace hash (`battle.test.ts`,
  `tests/combat-visuals.spec.ts`, `tests/orders.spec.ts`);
- the nine per-tick full-state digests;
- `encounterCapacity`'s fixture hash;
- the key-pose ticks 253/817/958/2106;
- the roster and equal-stat cohort numbers;
- the golden season;
- Playwright screenshot baselines on both platforms.

**The rule that replaces the freeze:** each of these is re-baselined with a
stated reason, and the plan carries a task whose output is that statement. A
hash literal updated with the commit message "re-baseline" is not acceptable
here; the previous slice's whole value came from those literals being
load-bearing, and the way to keep them load-bearing through a slice that must
move them is to explain each move. In particular the key-pose ticks are a
*behavioural* claim — if they move by hundreds of ticks the bout restructured,
and that wants a sentence.

## The counter triangle is its own task

Changing one type's effective reach changes every matchup that type appears in,
which is five of the nine roster pairings (Aquila against all three opponents,
Drusus against all three of the home roster, minus the pairing they share) and
five of the nine style matchups.
The measurements above show the triangle swinging from 36% to 96% on a single
0.5-unit change in one floor. Re-tuning it is therefore a task with its own
brief, its own measured before/after, and its own budget — not a line at the
end of the content task.

Its material is design.md's existing allowance ("implementation may tune ...
action `damageMultiplier` / `recoveryTicks`") plus `fast`'s `baseWeights` and
locomotion, and its constraint is criterion 4 at unchanged bands. Its stopping
rule is design.md's: stop and present the distributions.

## The allowlist, re-scoped

The CI gate `scripts/check-allowlist.sh` listed the paths the *readable-types*
slice was allowed to touch, and `src/simulation/**` was not among them, so this
slice's first PR would have failed on its first step. It has been re-scoped,
and its **shape** flipped along with its contents.

An allowlist made sense for a slice whose claim was "no behaviour changed": it
kept the diff out of the files that could make that claim untrue. This slice
must edit every one of those files. An allowlist rebuilt around it would have
to admit nearly the whole tree, and a gate that forbids nothing reads as a gate
that passed.

So it is a **denylist** now, protecting the inverse risk — not "did behaviour
change" (it must) but "was the change actually behavioural, or was it quietly
helped along by presentation". Three paths carry that risk and all three are
forbidden:

- `src/style.css` — growing the 730×518 arena canvas is the next slice's
  largest legibility lever; a bout that reads better because the canvas grew
  tells us nothing about reach.
- `src/presentation/ProceduralFighter.ts` — trident and spear do not separate
  at the shipped framing, and this slice's premise is that *behaviour*
  separates them anyway. Redrawing the props would answer the same question a
  second way and make the two answers inseparable.
- `src/presentation/ArenaCamera.ts` — criterion 5.

Verified in both directions: the gate passes on this branch, and a one-line
edit to `src/style.css` fails it.

## Player-facing acceptance

1. A viewer watching a retiarius bout sees him strike from where he stands,
   not step inside a murmillo's sword to land his trident.
2. The retiarius and the hoplomachus are told apart by how they fight, at a
   framing where their two polearms still do not separate by silhouette.
3. The counter triangle still reads: the murmillo is still the answer to the
   retiarius, and it is still an advantage rather than a guarantee.
4. Nothing about the murmillo or the hoplomachus changed on purpose; where
   their numbers moved, it is because their opponent did.

## Non-goals

- Re-opening the type choice. The playtest closed it; this spec inherits it.
- Any presentation change: silhouettes, props, camera, canvas, palette, poses.
- Changing the murmillo's or the hoplomachus' authored numbers *except* as the
  balance task requires to hold criterion 4, and then only with the deviation
  recorded the way Task 13's amendment recorded its own.
- A fourth type, a second weapon stream, or net mechanics. The net is a
  silhouette prop and stays one.
- Widening any balance band.

## Risks

- **The two long types converge.** Both variants move the retiarius toward the
  hoplomachus on the one axis that already separated them. Criterion 1's 0.20
  margins are what keep this honest, and under Variant A they are measured to
  be in tension with criterion 2.
- **The balance task is the expensive half.** The reach change is a handful of
  numbers; restoring a 55–75% band across five affected matchups is where the
  slice can fail, and the measured swing (36% → 96%) says the surface is steep.
- **A close-quarters absorbing state.** Raising the lunge's floor is the exact
  shape of the defect Task 13 dug out of the kernel — a fighter with no legal
  action and no movement that restores one. Holding `fast-slash.contactRange.min`
  at 0.9 is the mitigation; criterion 4's timeout and resolution-gap bands are
  the detection.
- **The prototypes are 25-seed.** Every number in this spec that comes from a
  prototype is indicative, not cohort-grade. Nothing is frozen on one:
  thresholds come from the two unchanged types, and the prototypes are used
  only to check reachability.
