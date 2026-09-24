# The retiarius' room — design, 2026-09-20

**Player hypothesis.** A net fighter whose only way to make room is to walk
backwards is not a net fighter, he is prey. Give him a cast that buys measure in
one beat, let his feet read the wall instead of running into it, and the same
simulation starts to look like the fight it is supposed to be. And let two
gladiators of the same type read differently, so a veteran and a novice are not
the same man in different paint.

**Source.** Finding 1 of `docs/reviews/2026-09-20-presentation-slice-playtest.md`
— the retiarius spends 51–58 % of a murmillo bout pressed to the arena
boundary — plus the owner's two additions during design: abilities must be
named in the battle log, and fighter skill must make a visible behavioural
difference.

**Not in this slice.** Findings 2 (effect life measured in simulation time) and
the art notes (the galea's silhouette, chibi proportions). The shield-versus-
evade backlog item. Mass battles. A real net mesh and a bespoke throw animation.
Growing or rounding the arena.

## The finding, restated as a mechanism

The report names three levers — arena radius, a boundary-aware disengage, a
ring instead of an ellipse. Reading the content made a fourth one visible, and
it is the one that already worked once.

`pushDistance`, the field that decides who gives ground, by style:

| style | archetype | largest `pushDistance` |
|---|---|---:|
| heavy | murmillo | 0.70 (`heavy-cleave`) |
| technical | hoplomachus | 1.10 (`technical-driving-thrust`) |
| fast | retiarius | 0.35 (`fast-burst-lunge`, which carries him **in**) |

The retiarius is the only archetype with no way to move his opponent. So the
only distance available to him is distance he walks — and `combatDecision.ts`'s
own comment at `BACKSTEP_MAX_RANGE` already wrote down why that fails:

> a backstep is a walking race the hoplomachus cannot win in a bounded arena
> […] a fighter that keeps walking backwards ends up against the arena
> boundary, where `hasArenaPath` deletes the intent and the murmillo has him.
> […] What actually answers the finding is `technical-thrust`/
> `technical-driving-thrust`'s `pushDistance`: a push makes measure instantly
> and so is not a race at all.

That is the same finding, diagnosed and fixed for the hoplomachus, who now sits
at 23 % at the edge against the retiarius' 51–58 %. The retiarius never got the
equivalent.

A second reading correction, for whoever tunes this later: at the boundary the
retiarius is not necessarily motionless. `fast` authors `circle-left` and
`circle-right` at weight 12 each, the highest in its table, so he does circle —
but circling is lateral motion, which slides him **along** the perimeter while
`|position|` stays at the radius. "At the edge 51–58 %" counts those ticks too.
The second column of the report's table is the sharper one: **50.9–62.7 % of his
backing intents fire when he is already at the wall**, where they buy nothing.

## What ships

Five changes. The first two are the mechanism, the third is the axis the owner
asked for, the fourth makes any of it readable, the fifth is the instrument.

### 1. The net cast

A new attack, `fast-net-cast`, in `src/content/combatStyles.ts`. It is modelled
on `technical-driving-thrust` — the action that solved this finding for the
hoplomachus — not invented from scratch.

| field | value | reasoning |
|---|---|---|
| `contactRange` | 2.4 – 3.6 | thrown from his own measure (`preferredRange` 2.7–3.3) and reaching past it; the longest range in the game |
| `pushDistance` | 0.90 | between the hoplomachus' thrust (0.70) and his driving thrust (1.10) |
| `staggerTicks` | **45** (0.75 s), swept over 30–60 | the payload: the opponent is tangled and cannot act. See the risk section — this is three times any existing value |
| `damageMultiplier` | 0.35 | a net does not kill; it buys a beat |
| `accuracyModifier` | −0.05 | a thrown net is the least precise thing he does |
| `windupTicks` | 14 | a bigger motion than the probe (10), smaller than the lunge (18) |
| `impactTicks` | 2 | matches the probe |
| `recoveryTicks` | 16 | the cost of a miss: longer than the probe's 10, short of the lunge's 20 |
| `rootTravel` | 0 | he throws, he does not step in |
| `contactPriority` | 35 | between the lunge (30) and the probe (40) |
| tags | `attack probe net unparryable` | a thrown net is not parried; `net` is a new tag and needs the validation list extended |

`baseWeights['fast-net-cast'] = 10`, below the probe (12) and the lunge (14),
so the net is a tool and not the retiarius' whole game.

The `net` tag exists so the log, the presentation and any later mechanic can ask
"was this a net?" without matching on the id string.

### 2. Feet that read the wall

`intentDisplacement` is **not** touched. Rotating a displacement away from the
intent that named it would put the simulation and the presentation gait into
quiet disagreement — `clipMapping.ts` picks the walk clip from the intent, and a
fighter labelled `retreat` who is actually arcing sideways would animate wrong.

The decision is made where decisions live. At the decision seam:

- a backing intent (`retreat`, `backstep`, `disengage`) whose projected position
  leaves little margin to the boundary loses weight;
- of the two circling directions, the one that **increases** the boundary margin
  gains weight.

Both use machinery that already exists: `projectedPosition` (which runs the
hypothetical through the real `clampToArena`) and `arenaBoundaryMargin`, today
used only by the `-20` action penalty. Today the two circling directions are
weighted 12 and 12 and the choice is a coin flip; after this, the fighter who
can read the floor stops flipping it.

This is deliberately expressed as weights rather than legality. `hasArenaPath`
already deletes movement that *cannot execute*; this addresses movement that
executes and accomplishes nothing, which is a judgement, not a rule — and a
judgement is exactly what skill should be able to sharpen or dull.

### 3. Skill: one number, at the seam built for it

`FighterDefinition` gains `skill: number` in `[0, 1]`. No plumbing is needed:
`FighterCombatState.definition` is already in the decision context.

The mechanic is a deliberate copy of `src/simulation/disposition.ts` — the one
place a per-fighter id becomes behaviour through a `DecisionModifier`. A new
`src/simulation/skill.ts` turns the number into a modifier:

- **0.5 is exactly today's behaviour.** The modifier returns 0 at the midpoint,
  so a roster left at 0.5 must reproduce the current cohort numbers tick for
  tick.
- **Above 0.5** the fighter reads the wall earlier (the boundary adjustments of
  change 2 scale up) and picks his moment for the net better.
- **Below 0.5** he does neither, which is the novice the owner described:
  he stands at the wall and takes it.

`DecisionModifier` was written as "the future skill/perk seam" and has stayed
unused since; this is that future, and the seam is where every later mechanic
attaches.

**The roster keeps skill 0.5 in this slice.** Authoring a spread is a second,
separate step with its own measurement — see "Order of work". Landing the
mechanism at the neutral point first is what makes "the seam changed nothing"
a checkable claim rather than a hope.

### 4. The log names the move

`battleFeed.ts` currently renders "Brutus deals 12" and "Drusus evades" — it
never says *what was done*, for any action, and the owner noticed. The events
already carry it: `AttackMissedEvent.actionId` (`encounter.ts:417`),
`DamageDealtEvent.actionId` (`:474`).

A display-name table maps every `AttackActionId` to a short phrase, and the feed
uses it: *"Drusus casts the net."*, *"Brutus cleaves for 12."* The table is
exhaustive over the id union, so a new action cannot be added without naming it.

Without this the net is invisible in text at the exact moment the playtest needs
to judge it.

### 5. The instrument

The boundary measurement used in the report was written once and thrown away.
It becomes `scripts/measure-boundary.ts`, beside `measure-distance.ts` and
`measure-pairings.ts`, reporting per pairing and per side, over all nine
pairings × 20 seeds × every tick:

- share of ticks within 0.35 of either boundary (radius or lateral limit);
- share of backing intents issued while already inside that band, under two
  definitions printed side by side: the report's (`backstep` / `disengage`
  only), and the decision's whole backward group (which adds `retreat`).

The first column and the report-definition column use the report's own
definitions, so before and after are directly comparable with its table.

## Replan, 2026-09-23 — the net moves to where he is in trouble

The net as specified in section 1 was built and swept over 48 settings (branch `wip/retiarius-net-v1`). It did not do this slice's job. The murmillo fights at 1.5–2.0, below the net's 2.4 floor, so it was thrown ~1.4 times per murmillo bout and moved the retiarius' time at the wall only 51.5 % → 46–52 %; meanwhile it fired 5–10 times per bout in the mirror and against the hoplomachus and broke balance there. A floor of 1.5 cut wall time to ~41 % but collapsed nerva/drusus to 8–14 %, because an unparryable net at close range is too much for the hoplomachus.

The design error was placing the net at the retiarius' own measure — where he is comfortable — instead of where he is in trouble. Changes, chosen by the owner:

- **Footwork lands first** (section 2), and becomes the baseline the net is measured against.
- **The net is a last resort.** `contactRange` 1.2–3.3, and it is a legal candidate only while the retiarius is near the wall (the footwork's `BACKING_ROOM`) **and** his opponent is inside his preferred range. 3.3 rather than 3.6 because a hit from 3.6 left two retiarii ~4.4 apart, past `burst-in`'s 4.3 start range, and they circled for ~300 ticks.
- **Order of work** becomes: instrument · log · footwork · skill at neutral · last-resort net · net on screen · roster spread.

Owner rulings recorded with it: pure snapshots (state hash, recorded traces, fixture episodes, series scores, action-id pins, the golden season) may be re-baselined when a task changes behaviour on purpose, each with its reason in the commit — the golden season only if challenges 2 and 3 still cannot field a fresh lineup. Design and balance assertions are never re-baselined or widened.

## Outcome, 2026-09-23

The slice stopped short. Only three things shipped: the instrument
(`scripts/measure-boundary.ts`), the log naming attacks
(`src/presentation/actionNames.ts`), and `GUARD_DAMAGE_MULTIPLIER` 0.35 → 0.25
in `src/simulation/combatActions.ts`.

**The wall finding is NOT fixed.** The retiarius against the murmillo still
spends 51.3 / 58.4 % of the bout at the wall (drusus / aquila, 20 seeds).

The rest is parked, not merged: the footwork (with the shield at 0.15 and a
Sura nudge) on `wip/retiarius-footwork-v1` (79a4671), and the net on
`wip/retiarius-net-v1` (7ca6f7f). They stopped because the murmillo's counter
over the retiarius rests on pinning him against the wall, and with the wall
opened several balance criteria sit within a bout or two of their thresholds.

The shield change is an exception to "Not in this slice" above, which excludes
the shield-versus-evade backlog item. It was made by the owner's ruling, and it
is a first step toward that item, not the item itself.

## Presentation

The animation pack in `public/models/fast.glb` has twelve clips and none of them
is a throw: `1H_Melee_Attack_{Chop,Slice_Horizontal,Stab}`,
`2H_Melee_Attack_{Chop,Stab}`, `Block`, `Block_Attack`, `Death_A`,
`Dodge_Backward`, `Hit_A`, `Idle`, `Walking_A`.

So the cast reads through what exists: `2H_Melee_Attack_Chop` as the throwing
motion (`ATTACK_nS` in `fighterModelContract.ts` gains the entry), plus simple
flying geometry for the net itself and a visible tangle on the target while the
stagger runs. A real net mesh and a bespoke animation are their own slice.

## Acceptance

| gate | target |
|---|---|
| retiarius at the edge vs murmillo | 51–58 % → at or near the hoplomachus' 23 % |
| the murmillo does not inherit the problem | his own edge share stays under ~5 % (today 0.6–1.2 %) |
| backing issued at the wall | materially below today's 50.9–62.7 % |
| roster cohort band, nine pairings | every pairing inside 15–85 % |
| skill at 0.5 across the roster | cohort numbers unchanged from `main` |
| equal-stat style cohort | triangle intact |
| the log | every attack in the game renders a named phrase |

Clips for the playtest: a wall sequence before and after, a net cast at speed
×1, and a veteran-versus-novice bout once the spread is authored.

## Risks

**The stagger is an outlier.** 45 ticks is three times the largest stagger in
the game today (`fast-burst-lunge`, 14). A free 0.75-second window against an
opponent who cannot act is easily worth more than the 0.35 damage multiplier
suggests, and "the retiarius now wins for free" would show up in the cohort band
rather than to the eye. The sweep over 30–60 is mandatory, not optional, and
`pushDistance` is the second knob if the first cannot be made to fit.

**The net could displace his attacks.** A weight of 10 against the probe's 12
and the lunge's 14 is a starting guess. If the measured share of his contacts
that are nets is large enough to hollow out his offence, the weight moves before
anything else does.

**The boundary weights could produce a fighter who refuses to back off at all.**
The adjustments are weights, and `scoreCombatCandidates` clamps at
`max(0, …)` — a backing intent can be suppressed but never inverted. The
anti-stall suppression and its exemption are untouched, so the absorbing state
Task 13 dug the kernel out of stays closed.

## Order of work

1. The instrument (`measure-boundary.ts`) and the baseline on `main` — nothing
   below is checkable without it.
2. The log names actions. Independent of everything else and makes every later
   playtest readable.
3. The net cast, plus the `pushDistance` / `staggerTicks` sweep.
4. Boundary-aware footwork weights.
5. `skill` on `FighterDefinition`, `skill.ts`, the whole roster at 0.5 — the
   cohort gate must be unchanged.
6. Author the roster spread, measure it separately, and report what it costs.

Steps 1–5 are this slice. Step 6 lands in the same slice only if step 5's
"unchanged" gate is clean; otherwise it is the next one.
