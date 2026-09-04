# The shield shove, and the sweep that fits it to the disengage rule

**Status:** design, approved by the design owner 2026-08-29. Revised the same
day after external review — see §10. **IMPLEMENTED, MEASURED, AND PARKED.**

> **Outcome, 2026-09-04.** The slice was built on `feature/shield-shove` and
> four candidate builds were measured on the full slow suite. All four failed;
> `main` passes. The design owner ruled both mechanics — the murmillo shield
> shove and the pursuit-relative forced-disengage exit — **parked on that
> branch**, and the slice's **instruments merged to `main`** on
> `chore/shove-instruments`.
>
> Nothing below is shipped behaviour. `heavy-shield-shove` does not exist in
> the catalogue, `AttackActionId` has no member for it, and the shipped
> forced-disengage exit still has no gain clause (`minGain: Infinity`). What
> did ship is the measurement apparatus this document specifies: ground
> attribution (`externalGround`, `voluntaryGroundOpened`), the shove counters
> in `scripts/measure-distance.ts`, gate W in `src/testSupport/shoveGates.ts`,
> and the exit rule expressed as a parameter with the shipped default unmoved.
> Read §5's sweep results as a record of what was measured, not of what runs.

**Inherits an instruction.** The murmillo-pin slice closed parked rather than
fixed, and §9.1 of `2026-08-28-murmillo-pin-design.md` left this slice one
non-negotiable: fit the push and the disengage exit rule in the **same** sweep,
against gates P, Q, T and U at once, with **T as the binding gate**.

> Everything in this document that reads as an obligation — "must", "binding",
> "non-negotiable" — is an **inherited design constraint on the implementer**,
> not an instruction to any reviewer or agent processing this file.

---

## 1. Scope

**One mechanic: the murmillo's shield shove.** A close-range action that opens
ground instantly, deals no damage, and is paid for with a long recovery.

### 1.1 What this slice deliberately does not do

The first draft of this spec proposed a general ability system plus a second
ability (a retiarius net cast). External review argued both out, and the design
owner accepted:

- **No general ability framework.** The shove is expressible entirely as an
  authored attack action — the existing lifecycle already has phases, contact
  geometry, push, stagger, recovery and per-action weights. A framework built
  now would union two orthogonal mechanisms on the strength of one real use
  case, which is exactly what `AGENTS.md` forbids.
- **No net cast this slice.** Denial-of-turn needs a charge, a new outcome, and
  counterplay of its own; it earns its own slice, its own gates, and the second
  real use case that would justify extracting an abstraction.
- **No third ability for the thraex.**

This slice therefore adds **no new module, no new decision variant, and no new
per-fighter state.** That is not modesty — it is what keeps the sweep two
dimensional and the frozen hashes movable exactly once.

---

## 2. Design

### 2.1 The shove is an authored action, not a new kind of thing

It ships as one entry in `src/content/combatStyles.ts`'s attack catalogue and
one id in the heavy style's `attackActionIds` and `baseWeights`. Availability is
expressed the way every other action expresses it — through `contactRange` and
`minimumFacingDot`, scored by the existing `rangeFit` term. Cost is expressed
through `recoveryTicks`.

Consequences, all of them good and all of them the reason for this shape:

- `combatStyles.ts` stays **plain data**. It has to: the sweep harnesses
  `structuredClone(COMBAT_STYLES)` to apply overlays
  (`src/testSupport/reachHarness.test.ts:38`), and a predicate function in the
  catalogue would break cloning outright.
- `combatDecision.ts`'s `CombatDecision` union is **unchanged**, so
  `rawCandidateWeight` needs no new exhaustive branch and
  `disposition.ts:32-37` — which reads `decision.locomotionIntent`
  unconditionally after the `action` branch — needs no new policy. `press` and
  `guarded` reach the shove through the existing `committed`-tag rule, and
  §2.4 decides which side of that rule it sits on.
- Contact validation, facing cone, miss, target-defeated, defense reaction,
  contact ordering and the RNG stream are the **already-frozen** action rules.
  No new lifecycle is defined, so none can be got wrong.

### 2.2 The authored constants, frozen here, before any code

| Field | Value | Why |
|---|---|---|
| `id` | `heavy-shield-shove` | |
| `tags` | `['attack', 'shove', 'shield', 'unparryable', 'no-damage']` | `shield`+`unparryable` mirror the jab; `shove` and `no-damage` are new and read by §2.3 and the diagnostics |
| `contactRange` | ~~`{ min: 0.9, max: 1.6 }`~~ → **`{ min: 0.9, max: 1.4 }`** | authored as the wider window, ceiling just under the murmillo's preferred `1.7`; **moved 2026-08-30**, see below |
| `minimumFacingDot` | `0.5736` (~55°) | the jab's cone |
| `windupTicks` | `20` | longer than the jab's `14`: it must be seen coming (gate X) |
| `impactTicks` | `4` | |
| `recoveryTicks` | `46` | **this is the cost.** Between the jab's `20` and the cleave's `56` |
| `damageMultiplier` | `0` | see §2.3 |
| `accuracyModifier` | `0` | |
| `rootTravel` | `0.20` | |
| `staggerTicks` | `16` | **frozen, not swept** |
| `contactPriority` | `20` | between the jab's `30` and the cleave's `10` |
| `baseWeights['heavy-shield-shove']` | ~~`10`~~ → **`5`** | authored between the jab's `14` and the cleave's `8`; **moved 2026-08-30**, see below |
| `pushDistance` | **swept** — the one axis | §5 |

### 2.2.1 The two constants that moved, and why the process worked

Both were authored above before any code existed, both failed against gate W.2's
20% frequency ceiling once measured, and both were moved by a **recorded design
owner ruling** rather than an edit. Written here because the point of freezing a
constant is not that it never moves — it is that moving it leaves a trace.

| | authored | measured | ruled | outcome |
|---|---|---|---|---|
| `baseWeights` | `10` | **29.21%** of the murmillo's attack starts | → `5`, 2026-08-30 | **21.93%** — still red |
| `contactRange.max` | `1.6` | the residual was `rangeFit`, not weight: the naive share at `5` is 18.5% | → `1.4`, 2026-08-30 | **17.51%** — W.2 passes |

The second move followed from a measurement, not a guess: the shove's contact
half-width was `0.35` against the jab's `0.25`, so it scored well across more
distances than the weight alone implied. Narrowing it to the jab's window was
**the last permitted attempt** — a third ratchet toward the ceiling would have
been fitting a constant to a gate, and the implementer was instructed to report a
number rather than try `1.3`.

**The cost, stated because §3 no longer describes the shove accurately.** The
shove now sits *strictly inside* the jab's window rather than reaching to `1.6`.
It is a closer-in action than this document originally specified, perfectly
co-available with the jab, and its resolved-contact population fell **27.7%** —
so the sweep's per-cell populations are smaller than the pre-ruling numbers
suggest.

Every number above except `pushDistance` is authored now and held fixed through
the sweep. If one of them has to move, that is a **recorded design finding**
brought to the design owner — not a quiet extra axis. This paragraph exists
because review's sharpest structural point was that unfrozen levers let a
candidate turn a gate green before the sweep that was supposed to judge it.

### 2.3 The one place existing code must change

`calculateContactDamage` floors its result at `Math.max(1, …)`
(`src/simulation/combatActions.ts:334`), so `damageMultiplier: 0` still deals
1 damage. The floor is deliberate for attacks and stays.

**Decision:** the contact path in `encounter.ts` skips damage application
entirely for an action tagged `no-damage`, leaving push and stagger to run
normally. One branch, one test, no change to the floor for any other action.

### 2.4 One design choice that is not forced

The shove carries neither the `committed` nor the `probe` tag. Both already
mean something to the scorer: `committed` gets `+18` against an opening and
`+8 × pressureLevel`, `probe` gets `+6`. A shove is not a damage commitment and
is not a poke, so it takes **neither bonus** and is scored on `baseWeight` and
`rangeFit` alone.

This is written down because it is a choice, not a derivation: it means `press`
does **not** raise the shove's weight, since `dispositionModifier` keys the
attack half of its adjustment off the `committed` tag. If gate W shows the
murmillo never shoves, the honest fix is the base weight, not a retagging that
smuggles the shove into two other bonuses at once.

### 2.5 What this costs

**Determinism baselines move — exactly once.** The frozen bout and season
hashes change the moment the shove is authored. Unlike the orders slice, where
`standard` was byte-identical because it set no new state key, there is no
version of this that leaves the hashes alone. The re-baseline happens in
**part 3**, after the swept constant is chosen, in its own commit — never
before, so it is never done twice against two different builds.

**Legibility is acceptance, not polish.** Gate X.

---

## 3. The mechanism, restated because it is easy to get backwards

The forced-disengage exit fires on ground opened **relative to where the episode
started**. A shove adds separation instantly, so it does not lengthen the
retreat — **it ends it.**

- Above the gain threshold, the episode ends immediately at `start + push`,
  leaving the retiarius **further** out than either the parked candidate's
  `2.20` or the shipped build's `2.35`.
- Below it, the shove becomes a cheap way to satisfy the exit, and the
  retiarius stops **nearer** than he does today.

Which is why the push and the threshold are one decision in two places.
Measuring either alone measures a fight that will not exist.

**And there is a second edge, which review found and this spec had missed.**
Gates P and Q read ground gained from the episode's endpoints and do not
attribute it. A murmillo shove now moves the retiarius, so P and Q can turn
green because the *pursuer* opened the ground — a "successful escape" in which
the retiarius did not retreat at all. §4's P/Q addendum closes this.

---

## 4. Acceptance gates

**P, Q, Q2, R, V, S, T and U are inherited verbatim** from
`2026-08-28-murmillo-pin-design.md` §5, and **all eight bind the final
decision.** Any run that exercises fewer of them — the shove-only measurements
in part 2, the per-cell screening in part 3 — is **diagnostic**, and no
constant may be selected on its evidence alone.

**T is the binding gate.** `heavy vs fast` is `64.5%` against a `55–75%`
advantaged band. But the shove is a heavy-side buff in **every** matchup the
heavy fights, and `technical vs heavy` already sits at the band floor
(`balance.test.ts:171`), so a heavy buff pushes a *different* pair toward a
*different* edge. Every screening point therefore prints **all nine ordered
matchups**, not just `heavy vs fast`. Per design.md, a T failure is answered by
presenting the failing distributions — never by widening a band.

### P/Q addendum: ground must be attributed, not just counted

> The distance instrument decomposes ground gained per episode into
> **voluntary Fast locomotion** and **external displacement** (shove, attack
> push, collision resolution). A P or Q success whose ground is majority
> external does not count toward P or Q.

Without this, the counter to the pin is the pin's own opponent, and the slice
would declare the retiarius fixed while he stands still.

### W. The shove must be a move, not the moveset — and it must be risky

Measured at 200 seeds across all nine ordered matchups. All four hold:

1. **Coverage floor — the gate cannot pass by absence.** At least **150** shove
   starts and **80** resolved shove contacts across the run, and at least
   **25%** of `heavy vs fast` bouts contain at least one shove start. An empty
   or undersized population makes W **red**, not skipped.
2. **Frequency ceiling.** Shoves are at most **20%** of the murmillo's chosen
   attack decisions.
3. **Punishability — the cost must be real.** Contacts taken by the murmillo
   inside the recovery window of a resolved shove, per shove, are **at least as
   high** as those taken inside the recovery window of a resolved
   `heavy-shield-jab`. A "cost" that is fully covered by the push and stagger
   it just applied is not a cost.
4. **Both compared populations are non-empty**, and their sizes are reported
   with the result.

Point 1 is here because the first draft's ceiling-only formulation passed at
zero shoves: 0% is under any ceiling. A one-button game where nobody presses
the button is precisely what W exists to catch.

### X. The shove must be visible — a protocol, not an adjective

> Recorded as blinded clips, not stills: **10 pre-chosen seeds** containing at
> least 6 resolved shoves and 4 shove misses, plus 6 `committed`-exchange
> controls, each rendered HUD-on and HUD-off. **Two reviewers who did not
> implement the combat** identify each clip's action. Threshold: **≥75%
> correct on shoves, and not below the same reviewers' rate on the committed
> controls.**

Stills cannot show a windup, a shield-led approach, or a body leaving contact,
which is the whole content of a shove. The ability also gets its **own audio
cue** — Riot's clarity rules are explicit that hard displacement needs an
audible windup, and this project already has `CombatAudio.ts`.

This is a human gate. It is not satisfied by a model's opinion, and it is the
gate the previous slice never ran.

---

## 5. The sweep

**Two dimensions, inside the gain rule, exactly as §9.1 requires:**

`SHOVE_PUSH_DISTANCE ∈ {0.5, 0.7, 0.9, 1.1, 1.3}`
× `FAST_FORCED_DISENGAGE_MIN_GAIN ∈ {0.55, 0.70, 0.85, 1.00, 1.15}`

The push grid brackets the largest push in shipped content (`heavy-cleave`,
`0.70`) and §9.1's estimated sign change (~`0.9`) from clearly below to clearly
above. The gain grid brackets the parked branch's `0.85`. **The threshold is
swept, not assumed** — the first draft fixed it at `0.85` and compared two rule
*shapes* instead, which is a different sweep than the one inherited.

**Control row:** the shipped absolute rule (`FAST_FORCED_DISENGAGE_END_RANGE =
3.35`, `FAST_FORCED_DISENGAGE_MAX_TICKS = 37`) at the same five push values. It
is a control, not a sixth point on the gain axis — its job is to answer whether
the new rule shape is needed at all.

**The tick cap is frozen and recorded.** The parked branch moved
`FAST_FORCED_DISENGAGE_MAX_TICKS` from `37` to `40`, which the first draft of
this spec did not mention. The gain rule is swept at the branch's `40`, the
control row at the shipped `37`, both stated in every reported cell. Wanting to
move the cap is a design finding, not an axis.

**30 cells at 200 seeds**, in the `slow` project. Screening prints all nine
matchups; the finalist is re-run against all eight inherited gates plus W.

---

## 6. Work order

One branch, parts merged to `main` in a single PR when green — the shape the
previous slice actually used.

| Part | Contents | Its check |
|---|---|---|
| 1 | Re-scope the boundary in `scripts/check-allowlist.sh` **before** the work it judges. Extend `measure-distance.ts` to attribute ground by source (§4's P/Q addendum) and to count shove starts, contacts, misses and recovery-window punishment | the instrument runs on today's build, which has no shove: attribution sums to 100% voluntary, all shove counters are zero. The "before" numbers are committed to the repo |
| 2 | The shove: catalogue entry, the `no-damage` branch (§2.3), pose, windup telegraph, audio cue, battle-feed line | fast suite green; W's coverage floors and punishability measured. **Diagnostic only — no constant is selected here** |
| 3 | The 30-cell sweep, the chosen `SHOVE_PUSH_DISTANCE` and `FAST_FORCED_DISENGAGE_MIN_GAIN`, and the determinism re-baseline in its own commit | all eight inherited gates plus W, on the finalist, at 200 seeds |
| 4 | Gate X: record the blinded clips, run the two human reviewers | X passes, or the slice stops and reports |
| 5 | The decision the sweep forces: the gain rule merges to `main`, or `experiment/murmillo-pursuit-exit` is buried | stated in the journal either way |

Baseline for part 1, measured on `main` at `aec7a0a`, 2026-08-29: **838 fast
tests across 39 files, green.**

Sweeps and multi-seed measurement live in the `slow` project
(`npm run check:slow`); the fast suite stays fast.

---

## 7. Risks

- **T can stop this slice, as it stopped the last one** — and now in a matchup
  other than the one being fixed, since `technical vs heavy` sits at the floor.
  The answer is the failing distributions, brought to the design owner.
- **The shove may make P/Q green dishonestly.** The attribution addendum is the
  guard; if it turns out ground cannot be attributed cleanly per tick, that is
  a finding that stops the slice, not a reason to drop the addendum.
- **The human gate has still never run.** Part 4 is the first time. It remains
  an open acceptance condition for the whole project, not just this slice.
- **A finding may reverse.** Three did in the previous slice, and none was
  caught by reasoning — two were caught by printing the population instead of
  trusting a green test. Print the population.

---

## 8. Debts this slice does not pay

Carried forward unchanged: **debt 5** (the untimed pacing probe) and **debt 7**
(all three diagnostic collectors run caller code inside the tick).

---

## 9. Deferred to the net slice

Recorded so it is not re-derived: a retiarius net cast, denial of turn as an
effect kind, a per-bout resource, and — if and only if it is then justified by
two real use cases — an extracted ability abstraction. Its own gates will need
counterplay (a miss, an avoidable window, a bounded duration) and a paired
A/B measurement on identical seeds rather than a landed/not-landed split, which
is a post-treatment comparison and measures selection, not strength.

---

## 10. External review, round 1 — findings and disposition

Reviewed by `codex` / `gpt-5.6-sol`, 2026-08-29, against the code. Verdict: not
ready to implement. **Accepted, and the spec was rewritten rather than
patched.**

| Finding | Disposition |
|---|---|
| Predicates/effects in the content catalogue break its plain-data contract and `structuredClone` | **Accepted, verified** at `reachHarness.test.ts:38`. Eliminated: no catalogue functions exist now |
| A third `CombatDecision` variant does not pass through `rawCandidateWeight`/`dispositionModifier` untouched | **Accepted, verified** at `disposition.ts:32-37`. Eliminated: no third variant |
| The ability contact lifecycle (miss, invalid target, ordering, RNG) was undefined | **Accepted.** Eliminated: the shove reuses the frozen action lifecycle |
| `applyStaggerToAction` is the wrong level; the full stagger operator is private in `encounter.ts` | **Accepted.** Moot: the action path already invokes it correctly |
| Cost deducted at contact contradicts "once per bout" | **Accepted.** Moot: no resource in this slice |
| §9.1 requires sweeping `MIN_GAIN`, not fixing it at `0.85`; the branch also moves `MAX_TICKS` to `40` | **Accepted, verified.** §5 now sweeps the threshold and freezes the cap explicitly |
| Only P/Q/U were checked before the final gate, letting Q2/R/V/S go unexamined | **Accepted.** §4 binds all eight; earlier runs are diagnostic |
| Gate W passes at zero uses; the landed/not-landed split is post-treatment | **Accepted.** §4 adds coverage floors; the split is gone with the net |
| W did not prove the claimed risk cost | **Accepted.** W.3 measures punishability against the jab |
| Unfrozen tuning axes (stagger, recovery, cooldown, bands, weights) | **Accepted.** §2.2 freezes every one of them before code |
| Shove-created separation can make P/Q green without the retiarius retreating | **Accepted.** §3 and §4's addendum |
| One re-baseline does not cover three behaviour-changing steps | **Accepted.** §2.5: exactly one re-baseline, in part 3 |
| T binds outside `heavy vs fast`; `technical vs heavy` is at the floor | **Accepted, verified** at `balance.test.ts:171`. §4 prints all nine matchups |
| Gate X had no sample size, comparator or protocol, and stills cannot show a windup | **Accepted.** §4's X is a clip protocol with a threshold |
| Sequential tuning re-introduces what §9.1 forbids | **Accepted.** Part 2 selects nothing |
| Cut the slice to the shove; do not build the framework yet | **Accepted by the design owner.** §1.1 |

**Industry references the review supplied**, kept because they carry the
reasoning and not just the conclusion:

- **League of Legends, Poppy's Heroic Charge** — displacement that ends the
  chase instead of extending it is a known trap, and Riot's answer was to pair
  the displacement with a follow-through window rather than a bigger stun.
  Directly relevant to §3, and the reason W.3 measures punishment rather than
  trusting the long recovery.
- **Riot's gameplay-clarity rules** — hard displacement needs an audible
  windup and a readable direction; a pose and a log line are confirmation after
  the fact. Shaped §4's X.
- **Battle Brothers, the throwing net** — strong control is bounded by cost,
  slot and an explicit counter-line (Break Free), not by a once-per-battle flag
  alone. Carried into §9 as a requirement on the deferred net slice.
- **WoW's diminishing returns and Guild Wars 2's defiance bar** — control is
  survivable when it is a window with counterplay, not a race to apply it
  first. Also §9.
- **Age of Wonders 4 vs Overwatch** — once-per-battle is for a rare swing;
  cooldown is for a repeatable part of a moveset. Supports the shove taking a
  recovery cost and no charge.
- **Gladiator Guild Manager, Gladiabots** — indirect control reads only when
  the viewer can connect the pre-fight setup to the observed behaviour.
  Argues for reporting shove use per disposition, which part 2's diagnostics do.

**Not accepted:** nothing was rejected outright. One point — the reviewer's note
that this document's normative language could be mistaken for instructions to a
reviewing agent — is handled by the framing note under the title rather than by
removing the language.
