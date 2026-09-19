# Fighting room — design, 2026-09-05

**Player hypothesis.** Two gladiators who are visibly grinding chest-to-chest do
not read as a fight, and a spear fighter who never once tries to make room does
not read as a spear fighter. Give the bout enough space for a windup, and give
the hoplomachus a way to take his measure back, and the same simulation becomes
legible without becoming a different game.

**Source.** The two findings the owner weighted most in
`docs/reviews/2026-09-05-skinned-gladiators-playtest.md`. The other three
findings in that document — hit/miss feedback, the murmillo's kit, and the spear
thrust clip — are presentation and asset work and are deliberately **not** in
this slice.

**Measurements.** `docs/superpowers/plans/2026-09-05-fighting-room.md`, with the
raw per-pairing tables in `2026-09-05-distance-before.json` and
`2026-09-05-distance-after.json` beside it.

## The two findings, restated as numbers

The playtest is qualitative. `scripts/measure-distance.ts` is the instrument
that makes it checkable: it samples root-to-root separation on **every tick of
every bout**, all nine pairings, 20 seeds each. That is the axis both findings
are actually about, and no existing diagnostic could see it —
`contactDiagnostics.ts` samples only the ticks an attack landed, so a pair that
stands nose-to-nose for six seconds and trades twice contributes two samples.

Measured on the pre-slice build:

| | measured |
|---|---:|
| arena separation floor | 0.90 |
| hoplomachus ticks inside his own measure, mean over six observations | 15.9 % |
| the same, against a murmillo | 4.3 % |
| ticks pinned within 0.15 of the separation floor | 8.9 % |
| longest continuous clinch under 1.2 units | 6.6 s |

## What ships

Three changes, in decreasing order of how much of the effect they carry.

### 1. The body-width translation

Every **separation** in the game moves outward by exactly 0.30: the duel
arena's `minimumSeparation` (0.90 → 1.20), every `contactRange`, every
`preferredRange`, and the four thresholds in `combatDecision.ts` measured in the
same units. **Displacements do not move** — locomotion speeds, `rootTravel`,
`pushDistance`, `evadeDisplacement` — so the time to cross between any two
bands is unchanged.

This is a change of origin rather than a balance change. The distance axis is
root-to-root and was calibrated when the fighters were capsules; the skinned
models are 2.0 units tall with heads about a third of their height, so 0.90
units of root separation is two men standing inside each other's guard, and the
animation pack needs roughly 1.3–1.5 units for a windup to read as a swing.

Raising the floor alone is not available: `contactRange.min >=
arena.minimumSeparation` is a validation rule, so the four attacks authored at
0.90 would become invalid. Clipping their minima up instead would have cut
`heavy-shield-jab` from a 0.50-wide band to 0.20 — a large unintended nerf aimed
at the one archetype whose whole game is the pocket. Translating preserves every
width, every gap, and every ordering the design pins.

### 2. The arena grows with it

`DUEL_RADIUS` 6.5 → 7.5, `DUEL_LATERAL_LIMIT` 2.5 → 3.3, start positions ±4.2 →
±4.7. The drawn sand disc follows, 7.7 → 8.7.

**This was not foreseen and is the slice's main lesson.** Moving the fighting
distances out while leaving the box the same size does not translate the fight,
it compresses it: the retiarius wants 2.7–3.3 units of measure in a lane 5.0
units wide, so the one archetype whose whole game is space lost a third of what
it had while needing more. A pure translation with the arena left alone measured
`brutus/drusus` at 94.5 % and `aquila/magnus` at 5.5 % against a 15–85 % band —
both outliers the same matchup read from opposite ends, heavy beating fast.

The equal-stat style cohort passed at every arena size tried, which is what says
the problem was room rather than the styles: at identical stats the counter
triangle was intact throughout, and only the roster's own numbers, tuned in the
old frame, were being squeezed.

### 3. The spear pushes

`technical-thrust.pushDistance` 0.30 → 0.70 and
`technical-driving-thrust.pushDistance` 0.50 → 1.10. This is the slice's one
deliberate behaviour change, and it answers the hoplomachus finding.

The obvious lever was tried first and **measured as a failure**, which is worth
recording because it is the reading the code invites. Technical's authored
`baseWeights` contain exactly one backward intent, `backstep`, gated to the
distances where it has no attack; so between that floor and its own measure —
precisely the murmillo's pocket — it has no legal way to open ground and stands
and trades because standing and trading is all the rules allow. Raising that
gate does not help. Against a murmillo the hoplomachus' time in measure is flat
across the whole sweep while the pinning gets monotonically worse, because
backing away is a walking race a fighter committed to a 38-tick thrust cannot
win inside a bounded arena, and one that keeps walking backwards ends up against
the boundary where the intent is deleted outright.

A push is not a race. It makes the measure on the tick the spear lands, which is
also what a spear is for: the hoplomachus keeps his distance by putting the
point in the way, not by outrunning anyone.

### 4. Aquila's power, 20 → 20.8

A consequence, not a goal. The three changes above leave all nine roster
pairings inside their band but cost the golden scenario a criterion the bands
cannot see: design.md asks that some ordering do **strictly better** than the
all-counter lineup, and afterwards the best of the six managed 2-1 — the
all-counter lineup's own score. Not a sweep, which the design forbids, but not a
witness either. Aquila is the only row with headroom against the four pinned
rank orders, and `power` is the rank the design already records as deviated.

## Acceptance

Everything below is a gate this slice had to clear, not a description of it.

- **Both findings move, measured on the same instrument.** The hoplomachus' time
  in his own measure roughly doubles overall and against a murmillo
  specifically; the separation floor rises by a third; continuous clinches under
  1.2 units go from dozens per twenty bouts to none.
- **The counter triangle survives.** The equal-stat style cohort's 55–75 % bands
  and 45–55 % mirrors pass unchanged, at 500 seeds per ordered matchup.
- **Every roster pairing stays inside 15–85 %**, at 200 seeds, with the pacing,
  timeout and resolution-gap bands unmoved.
- **The golden scenario keeps every criterion it had**, including the one the
  translation broke: the all-counter lineup does not sweep, and a different
  ordering does strictly better.
- **The translation's own invariants are asserted rather than described.**
  `combatStyles.test.ts` now pins that every floor-hugging attack sits exactly on
  the arena floor, and that the two committed floors stay aligned — the two
  relationships the whole "it is only a change of origin" argument rests on.

## One gate this slice does NOT clear, reported rather than papered over

**The camera's safe area at 1024×768.** `tests/legibility.spec.ts`'s "nothing but
a long or thrown handheld prop leaves the 5% canvas inset" fails on five of the
nine pairings at that one viewport: brutus/drusus, aquila/drusus,
aquila/cassius, aquila/magnus and nerva/drusus, at 22, 62, 18, 42 and a similar
count of ticks each, out of bouts 1500–3500 ticks long. The other two viewports,
1280×820 and 820×640, are clean, and so is the rest of that file.

The cause is the arena. A 7.5-radius floor lets the pair spread wider than a
6.5-radius one did, and 1024×768 is the narrow-canvas case the camera's own
notes already name as the binding one.

**It is not a body-size problem.** The 130 px body-height floor still passes on
every pairing with 12–28 % of margin, worst case 145.6 px at the 92nd percentile
of in-band ticks.

**It is not fixable by nudging one constant, and it was tried.** Pulling the
camera back to `FLAT_DISTANCE` 9.2 leaves the same five failing, so the breach
is not in the flat region. The remaining candidates are `EASE_WIDTH_EXTENT` and
the look-target dead zone, and `ArenaCamera.ts` is explicit that
`FLAT_DISTANCE`/`EASE_WIDTH_EXTENT` are a SWEPT pair chosen against thousands of
recorded ticks at three viewports: "moving either is a finding to report and a
slice to schedule, not a number to nudge." The sweep harness that chose them,
`scripts/measure-framing.ts`, is no longer in the tree and would have to be
rebuilt.

So this is that report. It is a real regression, it is confined to one viewport,
and it wants its own slice with a rebuilt framing sweep rather than a guess
appended to this one.

## What this slice deliberately does not do

- No new mechanic. Every number changed here already existed in the catalogue or
  in `combatDecision.ts`.
- No forced disengage for the technical style. It was considered as the answer
  to the hoplomachus finding and rejected in favour of the push: the push is one
  authored field, the forced disengage is a kernel change to a seam currently
  hard-wired to one archetype and one action.
- Nothing from findings 3–5 of the playtest.
