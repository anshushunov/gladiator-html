# Journal — the murmillo-pin slice

Append as the work happens, not afterwards. Every entry: date, phase, what was
done, what was measured (with numbers), what was rejected and why, where I was
wrong and how I found out. Last line of every entry: where I stopped and what
the next session does.

---

## 2026-08-28 — session 1, §2 tail: the two stale Linux baselines

**Phase:** section 2 of the brief (the debt to clear before phase A).

### What was done

Read the brief, checked `git status` / `git log`. No journal existed, so this is
the first session. Branch `test/relinux-baselines`, four commits ahead of `main`:
`c0fd0b9` (brief), `861e49e` (allowlist re-scope), `2637ca6` (the bot's
re-capture), `c7eb0a0` (brief rewrite). Working tree clean.

The open question was: **look at the two regenerated PNGs and decide whether the
change is the one we expected.** Extracted four images — the pre- and post-image
of `2637ca6` for `planning.png` and `season-board.png` — and read them.

### First reading, and why it was wrong

Comparing `2637ca6^` against `2637ca6` the numbers are **identical** in both
screens: HP 420 / 404 / 418 / 372 / 396, Power 21.2 / 20.0 / 20.0 / 23.6 / 19.0,
every Defense/Accuracy/Critical the same. What moves is text metrics — the
sans-serif face is wider and heavier in the new capture, so `Defense 34%` wraps
onto a third line in the roster cards, the `Standard/Press/Guarded` buttons grow,
and the whole page shifts up ~2px. The Georgia headings (`Blood & Sand`,
`Season board`) are pixel-identical.

That is literally §8.6 of the brief — *layout, fonts or colours instead of stat
cards* — and I was one step from stopping and calling it in. **That would have
been the wrong call, and the reason is instructive:** `2637ca6^` is not the right
comparison point. It is `18fa19f`, the bad capture, made inside
`mcr.microsoft.com/playwright:v1.62.1-noble`. Comparing a good capture against a
bad one shows you the badness, not the change.

### Second reading, against the right predecessor

The baseline lineage for `tests/__screenshots__/linux/planning.png`:

| commit | captured by | image family |
|---|---|---|
| … `f74a6af`, `2fed08c`, `36c7768` | `update-baselines.yml`, `ubuntu-latest` | runner |
| `18fa19f` | Playwright `v1.62.1-noble` container, by hand | **container (the debt)** |
| `2637ca6` | `update-baselines.yml`, run `33124288353`, `ubuntu-latest` | runner |

Both `ci.yml` and `update-baselines.yml` are `runs-on: ubuntu-latest` with no
`container:` key — the re-capture and the comparison now happen on the same
image, which is the whole point of the workflow.

So the meaningful diff is `18fa19f^` (= `d0e321e`, last runner capture) against
`2637ca6`. Read that way:

- **fonts, layout, wrapping, button widths, vertical rhythm: identical.** Same
  three-line wrap of `Defense 34%`, `Confirm lineup` at the same y.
- **only the stats moved**, and they moved exactly as the brief predicted:

| card | before | after |
|---|---|---|
| Brutus | HP 324 · Power 22.0 | HP 420 · Power 21.2 |
| Aquila | HP 274 · Power 20.0 | HP 404 · Power 20.0 |
| Nerva | HP 314 · Power 20.0 | HP 418 · Power 20.0 |
| Vitus | HP 308 · Power 23.0 | HP 372 · Power 23.6 |
| Sura | HP 292 · Power 17.0 | HP 396 · Power 19.0 |
| Drusus (lineup) | HP 350 | HP 470 |
| Cassius (lineup) | HP 312 | HP 415 |
| Magnus (lineup) | HP 299 | HP 406 |

`season-board.png` is the same recalibration shown a second time: the challenge
cards (Drusus 350→470, Cassius 312→415/337→448/343→457, Magnus 299→406/317→430/
335→455) and the roster row (`Starting HP 324`→`420` and the rest). Fonts and
layout again identical to the runner predecessor.

File sizes corroborate the families: `planning.png` runner 215 761 → **container
192 574** → runner 216 493; `season-board.png` runner 251 262 → **container
256 126** → runner 251 447. The container capture is the outlier in both.

### Verdict on §2

**This is the expected change and nothing else.** The re-capture undoes the
container artefact and leaves the recalibrated `maxHp` that the content slice
genuinely produced. The brief's worry that *"nobody predicted the season board"*
is answered: the season board displays the same recalibrated stats as planning,
so it had to move for the same reason. §8.6 does not fire and I am not stopping
on it.

### Where I was wrong, and how I found out

I nearly reported a font-metric finding to the user, on a true observation read
against the wrong reference. The brief's own §4.1 (*distrust the harness first,
then the gate, then the numbers*) is what saved it — the "harness" here is the
choice of `git show 2637ca6^`, and it was the thing that was lying. Checking the
commit lineage before believing the pixels cost one `git log` on the file.

### Latent finding, recorded not acted on

`src/style.css:4` asks for `Inter, ui-sans-serif, system-ui, …` and the repo
bundles no `@font-face`, so the Linux screenshots render in whatever sans-serif
the host image happens to ship. That is exactly why the container capture
diverged so visibly, and it will bite again the next time a runner image changes
under us. Fixing it (bundle the face, or pin a font package) is a separate slice
per §8.4 — noted here, not touched.

### Where I stopped / next session

PR [#20](https://github.com/anshushunov/gladiator-html/pull/20) opened from
`test/relinux-baselines`, body carrying the two-step comparison above (the naive
one-step diff looks like a font change, so the PR has to say why it is not).
Waiting on CI; **not to be merged** — §8.1.

---

## 2026-08-28 — session 1, phases A and B

**Phase:** A (read) and B (the lever map).

Branch `fix/murmillo-pin`, cut from `test/relinux-baselines` rather than from
`main` on purpose: `main`'s Linux e2e is red on the two stale baselines, and the
brief's own §4.4 says a red gate hides the gates behind it. Working on top of the
fix means this slice's own e2e run reports on this slice. If PR #20 merges first
the history flattens; if it does not, the slice PR is stacked on it and says so.

### A. Read

`docs/reviews/2026-08-27-retiarius-reach-playtest.md`,
`docs/superpowers/specs/2026-08-25-retiarius-reach-design.md` (all four
amendments and the closing note), `scripts/measure-reach.ts`,
`src/testSupport/reachHarness.ts`, `scripts/check-allowlist.sh`. Then, for the
lever map, `src/content/combatStyles.ts`, `src/simulation/combatDecision.ts`,
`src/simulation/movement.ts`, `src/simulation/disposition.ts`, and the tuning
allowance and balance bands in `2026-08-16-readable-deep-combat-design.md`
(that file is what everything else calls "design.md"; there is no `design.md`).

**Finding, before any lever:** *the metric this slice is required to use does not
exist.* The brief's §4 says the slice's metric must measure time-at-distance per
tick, split per pair. `scripts/measure-reach.ts` measures nothing of the kind —
every one of gates A–G is conditional on a contact having happened, which is the
exact shape of question the playtest says is the wrong one. And the playtest's
own per-tick table was not produced by any committed instrument: nothing in
`scripts/`, and nothing in the git history of `scripts/`, computes it. It was a
throwaway. So the numbers this whole slice is premised on — 45.8% → 37.7%
pooled, −0.5 points in `aquila/magnus` — are currently unreproducible.

That is the first task, not a side task, and by the repository's own convention
it belongs in the preparatory PR: the instrument must exist and be frozen before
the content it judges moves.

### B. The lever map

Read one at a time, as the brief asks. `file:line` throughout.

#### The pin is not kinematic — measure that claim before believing any lever

`combatStyles.ts:41` gives the retiarius `backwardUnitsPerSecond: 2.7`;
`combatStyles.ts:16` gives the murmillo `forwardUnitsPerSecond: 1.4`. The
retiarius backs away at **1.9×** the speed the murmillo closes at. He is not held
in place by anything physical: if he chose to leave, he would leave, and the
murmillo could not follow. `movement.ts:167,171` confirms the mapping is plain
speed along facing with no cost or acceleration on either side.

**So the pin is produced by decision-making, not by geometry.** Every lever below
is read in that light, and it is also the single most falsifiable claim in this
entry: if a candidate that only raises the retiarius' willingness to leave fails
to move time-at-distance, this reading is wrong.

#### What makes the murmillo's entry cheap

- `combatStyles.ts:23` — heavy `preferredRange: {min: 1.2, max: 1.7}`. The
  murmillo is *scored* to stand at 1.2–1.7, which is entirely below the
  retiarius' committed floor of 1.60. `combatDecision.ts:707-718` pays him +12
  for closing toward it and −12 for holding outside it. Moves: the whole pin.
  Breaks: the murmillo's type — this is his identity, and the brief forbids
  "the murmillo shouldn't come inside" as an answer.
- `combatStyles.ts:26-35` — heavy `baseWeights`: `advance` 12 **and**
  `pressure` 12, `retreat` **0**. `movement.ts:167` maps both to the same
  forward displacement, so the murmillo carries 24 points of "close" and has no
  authored way to give ground at all.
- `combatStyles.ts:105,90` — `heavy-cleave` 0.9–1.8 and `heavy-shield-jab`
  0.9–1.4: both legal across the entire band in which the retiarius' committed
  attack is not.

#### Existing mechanics as levers

- **`combatDecision.ts:969,1001,1013`** — `FAST_FORCED_DISENGAGE_END_RANGE` 3.35,
  `FAST_FORCED_DISENGAGE_MAX_TICKS` 37, `hasFastForcedDisengageEnded`. This is
  the retiarius' give-ground, and it is **triggered only by a burst-lunge
  recovery**. The lunge is illegal below 1.60 (`combatDecision.ts:640-655`
  against `combatStyles.ts:158`). **So the mechanic that would open the range
  cannot fire in exactly the situation that needs it opened.** That is the node
  the brief describes, located: murmillo closes inside 1.60 → lunge illegal →
  no lunge recovery → no forced disengage → nothing opens the range → murmillo
  stays. The two halves of the playtest's finding are the same line of code.
- **`combatDecision.ts:374-386` and `:144,290`** — the anti-stall suppression and
  its exemption. After 300 ticks without a local resolution, `retreat`,
  `backstep`, `circle-*` and `disengage` are suppressed; the exemption frees them
  only when `viableActionCandidates(...).length === 0`. Pinned at 1.5 the
  retiarius still has `fast-slash` (legal from 0.9), so he is never "out of
  actions" and the exemption never applies. **The probe that keeps him legal is
  what forbids him to leave.** This is the second half of the same node.
- **`combatDecision.ts:773`** — `rangeFit = 20·(1 − |predicted − mid| / halfWidth)`.
  `fast-slash` is 0.9–2.05 (`combatStyles.ts:135`), so its midpoint is **1.475** —
  *inside* the murmillo's 1.7 envelope. The retiarius' probe scores highest
  exactly where he is pinned. He is not merely tolerating the range; the scoring
  pays him to stay in it.
- **`combatDecision.ts:313`** — `BACKSTEP_MAX_RANGE = 1.2`, and `backstep` is
  authored only in Technical's weights (`combatStyles.ts:77`). The hoplomachus
  has an authored answer to someone inside his floor. The retiarius has none —
  the spec at `combatStyles.ts:122-127` says so in as many words, and uses it to
  justify keeping `fast-slash.min` at 0.9. Giving Fast a `backstep` gated at
  **1.60** rather than 1.2 is the direct mirror. Breaks: `baseWeights` are
  outside design.md's tuning allowance (needs an amendment), and the comment at
  `combatDecision.ts:308-312` records why the gate exists at all — Technical at
  2.0 backward against Heavy at 1.4 forward could kite indefinitely. Fast at
  **2.7** backward would kite far worse. Any candidate here needs a kiting
  detector, and there is no such instrument.
- **`combatDecision.ts:762-763`** — pressure level: `advance`/`pressure`/
  `burst-in` gain `+8·level`, `retreat`/`disengage` lose `+8·level`. In a pinned
  fight the probe keeps landing, so `lastContactTick` stays fresh and the level
  is probably 0 — worth measuring rather than assuming, because if it is *not* 0
  the retiarius is being actively penalised for leaving.
- `combatDecision.ts:296-297` — `BURST_IN_MIN_RANGE` 2.8 / `MAX` 4.0. Irrelevant
  while pinned; relevant to how he gets back in afterwards.
- `combatStyles.ts:145,136` — `fast-slash` `contactPriority` 40 (resolves ahead
  of nearly everything) and `minimumFacingDot` 0.4226 (~65°, the widest Fast
  authors), so the probe is both cheap and easy to land while circling.
- `combatDecision.ts:776-779` — the opening bonus, +18 committed / +6 probe.
  `heavy-cleave`'s 56-tick recovery (`combatStyles.ts:109`) is a long opening the
  retiarius cannot punish with his committed attack, because at that distance it
  is illegal. He collects +6 instead of +18.
- `disposition.ts:19-23` — `press`/`guarded` already move approach and keeper
  intents by ±4 and committed actions by ±6. A player-facing lever that exists.

#### What ties hands

- **design.md:698** — tuning is limited to fighter numbers, action
  `damageMultiplier`/`recoveryTicks`, turn sine/cosine pairs and Fast's
  `evadeDisplacement`. `contactRange`, `rootTravel`, `baseWeights`,
  `preferredRange` and every decision constant need a **written spec amendment
  before the edit**. The previous slice set that precedent and followed it.
- **design.md:698** — the authored orderings that survive tuning: probes stay
  quicker and lower-payoff than committed actions, Fast stays quickest, Heavy's
  cleave stays the slowest commitment, Technical keeps the longest practical
  reach.
- **design.md's balance bands** — equal-stat matchups 55–75% for the advantaged
  style, mirrors 45–55%, roster pairings 15–85%. `heavy > fast` is the tight one:
  the previous slice measured it at ~92% mid-flight and spent its whole balance
  budget there.
- **`measure-reach.ts:526`** — the gate asserts
  `fast-burst-lunge.contactRange.min === technical-driving-thrust.contactRange.min`.
  So "just lower the lunge's floor below 1.60" is not a free move: it either
  fails the gate or drags the hoplomachus' floor with it, and re-deriving the
  comparison to suit the change is precisely what §4.3 forbids.
- **Gate D is thin** — 63.3% against a `fast`-free comparator of 71.9%, and the
  spec records that balance tuning moves selection frequencies and can fail it
  after the fact.
- `scripts/check-allowlist.sh` has to be rebuilt for this slice; it is currently
  scoped to the baseline re-capture.

### Where I stopped / next session

Lever map done. Kicked off `measure-reach --seeds 50 --json` on the unchanged
build to get the per-matchup lunge counts, which is the datum that decides the
brief's mandatory zero option ("change the question, not the content"): if
`fast-burst-lunge` has collapsed specifically in `fast vs heavy` rather than
everywhere, the node is real; if it collapsed uniformly, the finding is about the
lunge and not about the murmillo at all.

### The 50-seed run, and what it does to the zero option

`measure-reach --seeds 50` on the unchanged build, equal-stat cohorts. The
committed attack, per ordered matchup:

| matchup | reached n | med | ≤1.7 | geom fail | implied attempts |
|---|---:|---:|---:|---:|---:|
| `fast vs heavy` | 77 | 1.76 | 37.7% | **48.0%** | ~148 |
| `fast vs fast` | 158 | 1.96 | 20.3% | 41.9% | ~272 |
| `fast vs technical` | 106 | 1.92 | 22.6% | 27.9% | ~147 |

**This does not say what the playtest says, and the difference matters.** The
playtest's headline was that the lunge became rare. In this fixture, against the
murmillo, the retiarius attempts the lunge about as often as he does against the
hoplomachus — ~148 attempts against ~147. What collapses is not selection but
**arrival**: **48.0%** of his commitments against the murmillo fail on geometry,
the worst rate of any matchup, against 27.9% versus the hoplomachus. He does
commit. He swings and the murmillo is already inside the swing.

Two cautions before this is used for anything. First, the playtest measured the
*roster* over 40 seeds and counted connections; this is the *equal-stat cohort*
over 50 and counts contact intents. They are different fixtures and the numbers
are not each other's. Second, `n` is not a rate — a matchup whose bouts end
sooner produces fewer of everything, and nothing here measures bout length. Both
cautions point the same way: **the counts cannot settle it and the per-tick
instrument can.**

The gates, meanwhile, read the matchup as healthy: `fast vs heavy` puts 37.7% of
committed contacts inside 1.7 against the hoplomachus' 55.1% in his own matchup
(gate C passes wide), and the geometry-failure rate of 48.0% sits just under the
comparator's 46.6%… which it does *not*, at 50 seeds — see below.

**Caught while writing this: gate G is marginal at 50 seeds and I nearly reported
it as passing.** The printed comparator is 46.6% (`fast`-free) and the retiarius'
pooled committed geometry failure is 38.8%, so gate G passes *pooled*. But the
per-matchup 48.0% in `fast vs heavy` is above the comparator, and gate G is a
pooled test. It is not a failure — the gate is pooled by design and pooled is
what the spec froze — but "the retiarius whiffs more than the hoplomachus does,
specifically against the murmillo" is invisible to it, and that is the same
per-pair-versus-pooled blindness the brief's §4 names. Recorded as a candidate
finding for phase D, not as a gate failure.

### Where I stopped / next session

**Stopped mid-phase-B on the user's word (internet going down).** Nothing is
half-written: the lever map is complete, the 50-seed baseline is measured and
recorded above, and both are committed.

State: branch `fix/murmillo-pin` off `test/relinux-baselines`. PR #20 is open and
its CI was still running when the session ended — **check it first next session**
(`gh pr checks 20`), and do not merge it. No source file has been touched by this
slice; the diff so far is this journal only.

Next session, in order:

1. `gh pr checks 20`. If red, read the failure before anything else — §4.4.
2. Verify one fact the lever map leaves open, because it decides whether the
   forced disengage is a live lever or a dead one: **does
   `forcedDisengageStartTick` get stamped after a lunge that failed on geometry,
   or only after one that made contact?** `src/simulation/encounter.ts:917,952`
   is the place. If it fires on any lunge recovery, the retiarius already gets
   ~148 give-grounds per 50 seeds against the murmillo and the pin is about the
   murmillo re-closing faster than the retiarius re-establishes, not about the
   retiarius being unable to leave. If it fires only on contact, then 48% of his
   escapes are cancelled by the same geometry miss that cost him the blow, and
   the node is much tighter than the lever map currently states.
3. Phase C — three candidates plus the mandatory zero option, each with what
   would refute it.

**The zero option now has a specific shape and should be argued at its
strongest:** the fight against the murmillo may be *correct*, and the thing
actually broken may be that the retiarius' committed attack whiffs half the time
against him — a legibility failure ("he keeps missing") rather than a spacing
failure ("he fights too close"). Those want different fixes, and the current
instrument can distinguish neither.

---

## 2026-08-28 — session 2, the lever map corrected

**Phase:** end of B, into C.

### I had the node wrong, and the code says so in six lines

The previous entry claimed the forced disengage "cannot fire in exactly the
situation that needs it fired", because it is triggered by a lunge and the lunge
is illegal below 1.60. **That is wrong.** `encounter.ts:944-953`:

```ts
const justEndedBurstLunge =
  previousCombatant.action.type === 'active' &&
  previousCombatant.action.definitionId === 'fast-burst-lunge' &&
  previousCombatant.action.phase === 'recovery' &&
  previousCombatant.action.phaseEndsAtTick === tick
```

The trigger is a **phase boundary**, not a contact. It reads
`previousCombatant.action`, never an event, never an outcome. A lunge that failed
on geometry still goes windup → impact → recovery, so it still stamps
`forcedDisengageStartTick`. The retiarius' give-ground fires on his whiffs too.

I inferred the coupling from the decision seam without checking the one place
that implements it. The brief's §4.1 ordering — distrust the harness, then the
gate, then the numbers — has a fourth item it does not name: distrust the reading
of the code before distrusting anything measured.

### What the disengage data actually says, and it is worse

Per ordered matchup, 50 seeds, from the same run's JSON:

| matchup | episodes | reached 3.35 | hit the 37-tick cap | median gain |
|---|---:|---:|---:|---:|
| `fast vs heavy` | 120 | **2 (1.7%)** | 116 | **0.66** |
| `heavy vs fast` | 124 | **0 (0.0%)** | 121 | **0.66** |
| `fast vs fast` | 220 | 138 (62.7%) | 77 | 0.81 |
| `fast vs technical` | 83 | 22 (26.5%) | 59 | 0.98 |
| `technical vs fast` | 81 | 28 (34.6%) | 51 | 0.90 |

**The retiarius is not unable to leave. He leaves about 2.4 times a bout, at 1.9×
the murmillo's speed, and gets nowhere.** Two of 244 episodes against a murmillo
reach the exit range. The rest run the clock out.

The arithmetic closes: 37 ticks of retreat at 2.7 u/s is 1.67 units of travel;
the murmillo spends the same 37 ticks advancing at 1.4 u/s, which is 0.86; the
difference is 0.81 and the measured net is 0.66, the gap being facing and the
ticks he is not advancing. To cover the 1.9 units from a pin at ~1.45 out to the
3.35 exit at that net rate would take about 185 ticks. **The exit condition is
not marginally unreachable against a murmillo. It is unreachable by a factor of
five.**

So the node is not "he cannot escape". It is: **an escape with a time limit,
against a pursuit with none.** Nothing in the content or the kernel ever makes
the murmillo's advance cost anything — `combatStyles.ts:26-35` gives him
`advance` 12 *and* `pressure` 12 and `retreat` 0, and `movement.ts:167` maps both
to the same forward step.

### And gate E is green for the wrong reason

Gate E's third clause is the one the previous slice added *specifically* to catch
an escape that runs but does not open ground: median separation gained ≥ 0.75.
Pooled at 50 seeds it measures **0.76** and passes.

It passes because `fast vs fast` — 220 of the 628 episodes, median 0.81, 63% of
them clearing the range — carries the pooled median over the line. Against the
murmillo the same statistic is **0.66**, and against him it is the only matchup
where the clause's purpose is live at all.

Stated carefully, because the direction matters and this project's history is
findings that flatter the finder: **I am not claiming gate E fails.** The 0.75
floor was measured pooled on the authored content, so comparing a per-pair figure
to it is not a like-for-like test — that is the same defect class as gate D's
comparator, pointed the other way, and I am not going to commit it while writing
about it. The claim is narrower and I think stronger: *the clause written to
detect a pinned escape is pooled, and pooling hides the pin in the one matchup
that has one.* That is a criterion defect independent of which candidate wins,
and it is the second thing this slice owes an instrument.

### Confirmed at 200 seeds, and gate E is worse than I said

`measure-reach --seeds 200 --gate`: **all reach gates pass.** The run reproduces
the spec's closing-note figures exactly — retiarius whole-type 63.3%, hoplomachus
71.9% `fast`-free and 65.0% pooled — which is the determinism check passing as a
side effect.

The disengage table holds at 200 seeds:

| matchup | episodes | reached 3.35 | median gain |
|---|---:|---:|---:|
| `fast vs heavy` | 475 | 9 (1.9%) | 0.65 |
| `heavy vs fast` | 473 | 6 (1.3%) | 0.67 |
| `fast vs fast` | 859 | 577 (67.2%) | 0.83 |
| `fast vs technical` | 315 | 100 (31.7%) | 0.97 |
| `technical vs fast` | 293 | 93 (31.7%) | 0.94 |

Grouped, against the two clauses gate E actually asserts:

| group | n | median gain (bar ≥0.75) | reached range | immediate (bar ≤5%) |
|---|---:|---:|---:|---:|
| **pooled — what gate E reads** | 2415 | **0.775** ✔ | 32.5% | **2.9%** ✔ |
| vs the murmillo only | 948 | **0.659** ✘ | **1.6%** | 0.3% |
| vs the hoplomachus only | 608 | 0.954 | 31.7% | 0.0% |
| the mirror only | 859 | 0.833 | 67.2% | **7.8%** ✘ |

**Gate E passes by 0.025 units, and the two matchups cover each other's
failures in opposite directions.** The ground-gained clause would fail against
the murmillo (0.659) and is carried over the bar by the mirror. The
immediate-clear clause would fail on the mirror (7.8%) and is carried under the
bar by everything else. The pooled number, 0.775 and 2.9%, describes no matchup
that exists.

That is not the same finding as "the give-ground collapses against the murmillo".
It is a bigger one: **the clause added specifically to catch an escape that runs
without opening ground is pooled, and pooling is what lets a real pin and a real
instant-escape sit inside a green gate simultaneously.**

Two honesty notes, because this project's history is findings that flatter the
finder.

*It does not flatter anything I want to build.* This is a defect in the shipped
criteria that exists whatever candidate wins, and it makes the slice's job
bigger, not smaller.

*I am still not claiming gate E fails.* Its bars were measured pooled on the
authored content, so holding a per-pair figure against a pooled-derived bar is
the same like-for-like error as gate D's comparator, and I am not going to commit
it in the paragraph where I describe it. The defensible claim is the weaker,
sufficient one: the statistic is pooled, its components disagree by 0.30 units
and 7.5 points, and no per-pair criterion exists to notice.

### The trap this slice is most likely to fall into, named in advance

`FAST_FORCED_DISENGAGE_MAX_TICKS` is 37 and 65% of episodes hit it. Raising it is
the obvious move and it is a **gate-greening move, not a fight-changing one**:
against the murmillo the retiarius nets ~0.018 units per tick, so reaching the
3.35 exit from a pin at ~1.45 needs roughly **185 ticks**. More ticks cannot get
him out; they only extend the mirror's already-successful escapes and lift the
pooled median. The spec's own tuning table (`combatDecision.ts:978-989`) is a
sweep of exactly this constant against exactly the pooled statistic.

Any candidate whose effect on gate E is larger than its effect on per-pair
time-at-distance vs the murmillo is this trap wearing a different number.

---

## Phase C — the candidates

Four, as the brief requires: three from different angles, plus the zero option
taken seriously. Each with what it pays, what authored ordering it crosses, and
what would refute it.

### C0. Change the question, not the content — and it is not really an option

Argued at its strongest: **the slice's deliverable is the measurement.** Two
criterion defects are already on the table before any candidate exists — the
per-tick, per-pair metric the brief demands has no instrument at all, and gate E
is pooled in a way that lets two matchups hide each other. Build the instrument,
re-express the give-ground criterion per pair, re-measure, and the murmillo
matchup may turn out to be *correct*: the triangle says the murmillo beats the
retiarius, `aquila/magnus` is in band at 15.0%, and "43% of the bout inside 1.7"
may be what being counter-picked is supposed to look like.

- **Pays with:** a slice spent on instruments, and the playtest's finding stays
  open another cycle.
- **Crosses:** nothing.
- **Refuted by:** per-pair time-at-distance coming back sharply asymmetric —
  ~43% inside 1.7 against the murmillo against ~20% against the hoplomachus.
  Then the asymmetry is real, measurement alone will not discharge it, and
  content has to move.

**Verdict: C0 is not a fourth alternative, it is the first half of the other
three.** None of C1–C3 can be judged without the instrument, and the honest thing
is to say that rather than to list C0 politely and move past it. What is genuinely
open is whether the second half is needed at all — and that is a question the
first half answers, which is a good reason to build it first and cheap.

### C1. Contentual — the exit range was derived, never checked for reachability

`FAST_FORCED_DISENGAGE_END_RANGE = 3.35` came from arithmetic, and the spec says
so: "the authored 2.4 sits 0.95 above the authored lunge's contact max of 1.45,
and the same gap above 2.40 is 3.35". Nobody asked whether a fighter being chased
can reach it. One constant serves two situations — pursued and not pursued — and
it is calibrated on the second. Candidate: lower it toward ~2.6 and re-derive the
tick cap around the result.

- **Pays with:** the previous slice measured 3.00 and rejected it, because
  "cleared within one tick" jumped to 6.7% and broke gate E's first clause.
  **But that objection is now suspect in a specific, checkable way:** the
  immediate-clear figure is a pooled number and the mirror already contributes
  7.8% of it at 3.35. The measurement that rejected this candidate may have been
  a pooling artefact. Re-measuring it per pair is a §4.2 direction-check that
  could reverse a rejected candidate, which is exactly the shape of thing this
  project keeps getting wrong in the other direction.
- **Crosses:** no authored ordering; needs a written amendment (decision
  constants are outside design.md's tuning allowance).
- **Refuted by:** per-pair time-at-distance against the murmillo not moving,
  because he re-closes in the ticks the shorter exit saves.

### C2. Kinematic — the escape is speed-capped, the pursuit is not

The forced disengage moves at `backwardUnitsPerSecond` 2.7 (`movement.ts:171`)
while the murmillo advances at 1.4, and 37 ticks of that difference is 0.81 units
before facing losses. Candidate: give the *forced* disengage Fast's authored
`burstUnitsPerSecond` of 4.0, which turns 1.67 units of travel into 2.47 and a
net of ~0.66 into ~1.6 — enough that the escape actually completes.

The other half of this angle — making pursuit *cost* something — is out of scope:
there is no stamina or commitment resource to hang a cost on, and inventing one
is a different slice.

- **Pays with:** a kernel change on the forced path, and it buffs Fast in the two
  matchups where the escape already works. `heavy > fast` must stay inside
  55–75%.
- **Crosses:** nothing in the authored ordering ("Fast remains quickest" is
  already true), but it is a new distinction between forced and ordinary
  backward movement that the design does not currently draw.
- **Refuted by:** `heavy > fast` falling below 55%, or bout duration and timeout
  rate rising — i.e. kiting. **Neither has a per-pair instrument.** Third
  instrument finding.

### C3. Decisional — "inside my own floor" is not a state the retiarius can see

Technical has this recognition and Fast does not: `BACKSTEP_MAX_RANGE = 1.2`
(`combatDecision.ts:313`) gates an authored `backstep` for exactly the case
"someone is inside my committed floor", and `combatStyles.ts:122-127` uses the
retiarius' *lack* of a backstep to justify keeping `fast-slash.min` at 0.9. Two
sub-forms: (a) give Fast a `backstep` gated at its own committed floor of 1.60
rather than 1.2; (b) widen the anti-stall exemption from "no viable action" to
"no viable **committed** action", which addresses the measured coupling directly —
the probe that keeps him legal is what forbids him to leave.

- **Pays with:** a `baseWeights` or decision-constant amendment; (b) adds a
  decision rule, and `deterministicFallbackDecision`'s own comment
  (`combatDecision.ts:882-890`) records what undisclosed decision rules cost this
  codebase.
- **Crosses:** the kiting guard. Fast at 2.7 backward against Heavy at 1.4
  forward is a worse version of the exact configuration `BACKSTEP_MAX_RANGE` was
  introduced to stop for Technical at 2.0.
- **Refuted by:** *its own arithmetic, and this is the strongest prediction in
  phase C.* A forced disengage — uninterruptible, 37 consecutive ticks at full
  backward speed — nets 0.66 units against the murmillo. A voluntary backstep
  chosen among four candidates every 12–30 ticks must net **less**. So C3 is
  predicted inert for the same reason raising the tick cap is inert, and the
  prediction ought to be cheap to test, since `baseWeights` live under `styles`
  in the catalog and `--overlay` patches `styles`.

  **It is not testable, and I found that out by trying it.** The overlay refuses:

  ```
  Error: overlay sets unknown field 'styles.fast.baseWeights.backstep'
      at requireKnownKeys (src/testSupport/reachHarness.ts:132)
  ```

  `requireKnownKeys` (`reachHarness.ts:130-138`) demands that every key a patch
  names already exist on the target, at every depth. That check is *correct* for
  the defect it was written against — a typo like `rootTravl` would otherwise
  merge in as a new key, validate cleanly, and measure exactly like the unpatched
  catalog. But the same rule means the overlay can only **retune values that
  already exist**, never add an authored field. So the entire class of candidate
  "give this style an intent it does not currently author" cannot be measured
  without editing content — which is precisely what `--overlay` exists to avoid.
  C3(b) is a kernel predicate and is not overlay-able either.

  **So C3 has no instrument at all**, and neither sub-form can be falsified
  before it is built. Instrument finding number four.

### Phase D, so far: the answer to "is there an instrument that would see this
### candidate fail?" is no, four times

The brief says a missing instrument is itself a finding, to be recorded rather
than worked around. Recorded:

1. **No per-tick, per-pair time-at-distance** — the slice's mandated primary
   metric. Nothing in `scripts/` computes it; the playtest's table came from a
   throwaway, so its numbers are unreproducible.
2. **Gate E is pooled** and its components cover each other's failures in
   opposite directions (0.659 vs 0.833 on ground gained; 7.8% vs 0.3% on
   immediate clears). No per-pair give-ground criterion exists.
3. **No kiting detector.** C2 and C3 both risk letting Fast retreat indefinitely,
   which is the exact failure `BACKSTEP_MAX_RANGE` was introduced to stop for
   Technical. Bout duration and timeout rate exist in `balance.test.ts` at cohort
   level, not per pair, and not in this slice's harness.
4. **`--overlay` cannot add authored fields**, so any candidate that gives a
   style a new intent must be measured by editing content — the thing the overlay
   was built to make unnecessary.

Findings 1 and 2 have to be fixed for this slice to have an acceptance criterion
at all. 3 and 4 are needed only if C2 or C3 survives.

### Where I stopped / next session

Phase C drafted above. PR #20's CI was still pending at the end of this session —
**check it first** (`gh pr checks 20`), do not merge.

Next, in order:

1. **Build the per-pair time-at-distance instrument.** Instrument findings 1 and
   2. This is not phase-H work smuggled forward: the previous slice's spec opens
   with a section called "The instrument comes first" and froze its gates against
   numbers from the rebuilt harness, so instrument-before-spec is this
   repository's established order. A spec that froze gates without it would be
   freezing bars whose baselines nobody had measured.
2. Then the spec (phase E), with the per-pair re-expression of gate E as a named
   deliverable rather than a side effect, and with C1's rejected-candidate
   direction-check called out explicitly.
3. Then phase F review, and only then any content.

**Nothing outside `docs/` has been touched by this slice.**

---

## 2026-08-28 — session 3, the instrument, and what it says

**Phase:** D, and it produced a result that changes the question.

### Built

- `src/testSupport/distanceHarness.ts` — band edges from the patched catalog,
  the engaged-window predicate, the accumulator. In `src/` because `scripts/` is
  outside tsconfig's `include`, so nothing there is typechecked or Vitest-
  reachable, and these are the parts that can be silently wrong.
- `src/testSupport/distanceHarness.test.ts` — 10 regressions. The edge cases are
  asserted individually (1.5999999 / 1.6 / 2.4 / 2.4000001), the overlay is
  asserted to move the bands, and the engaged window is asserted to latch on the
  *same tick* `balanceCohorts.runBout` records as `firstResolutionTick`.
- `scripts/measure-distance.ts` — the instrument. No `--gate`: the bars belong
  in the spec, frozen before implementation, and shipping a gate in the change
  that first measures the numbers is choosing bars after seeing results.
- `scripts/check-allowlist.sh` — rebuilt for this slice and **committed before
  the instrument**, so the diff is judged by a boundary it did not write. Both
  directions verified: `src/simulation/__probe.ts` and a whitespace change to
  `scripts/measure-reach.ts` are both rejected; the tree is clean.

`measure-reach.ts` is closed to this slice, which costs two improvements that
are recorded as debts rather than taken: unifying the `equalStatFighter` fixture
both scripts now copy, and reporting gate E's disengage figures per matchup.

### The result, 200 seeds, engaged window

| matchup | median | pinned <1.60 | ≤1.70 | home wins |
|---|---:|---:|---:|---:|
| `fast vs heavy` | 1.63 | 47.8% | **54.3%** | 36.0% |
| `fast vs fast` | 2.26 | 22.2% | **26.3%** | 49.5% |
| `fast vs technical` | 2.11 | 23.2% | **28.5%** | 72.0% |
| `technical vs heavy` | 1.44 | 69.6% | **81.1%** | 55.0% |
| `heavy vs technical` | 1.44 | 70.0% | 81.2% | 46.5% |
| `heavy vs fast` | 1.62 | 48.1% | 54.8% | 64.5% |
| `heavy vs heavy` | 1.32 | 79.9% | 90.5% | 50.0% |
| `technical vs fast` | 2.13 | 22.1% | 27.4% | 31.5% |
| `technical vs technical` | 1.72 | 34.7% | 46.7% | 51.0% |

**The playtest's finding reproduces.** The retiarius fights the murmillo at a
median of 1.63 and spends 54.3% of the engaged bout inside 1.70; against the
hoplomachus it is 2.11 and 28.5%, against his mirror 2.26 and 26.3%. Roughly
double, per pair, and now reproducible from committed code rather than from a
document.

**And the comparator says the opposite of what the slice assumed.** Gate C's
shape applied to time — the retiarius against the murmillo, held against the
hoplomachus against the murmillo — gives 54.3% against **81.1%**. The
hoplomachus is inside the murmillo's envelope half again as much as the
retiarius is, sits below his own committed floor 69.6% of the time against the
retiarius' 47.8%, and **wins that matchup at 55.0%**.

The counter triangle is `heavy → fast → technical → heavy`
(`fighters.ts:17-21`), so technical beating heavy is the design working, and the
measured win rates confirm the whole triangle sits in design.md's 55–75% band:
`heavy vs fast` 64.5%, `fast vs technical` 72.0%, `technical vs heavy` 55.0%.
Mirrors are 50.0 / 49.5 / 51.0, inside 45–55.

**So "share of the bout inside the murmillo's envelope" cannot be this slice's
acceptance criterion.** On that statistic the type that *beats* the murmillo
scores worst. It measures how hard the murmillo drags people in, which is his
type working, not a defect in theirs. I have put that sentence into the
instrument's own output next to the numbers, because I nearly built a gate on
them before checking which way the triangle points.

### What this does to the question

The brief's §8.3 asks to be told directly if the node turns out not to be in the
murmillo. It is not, or not in the form the brief states it. The evidence:

1. The murmillo drags **every** opponent inside — the hoplomachus hardest of all.
2. The hoplomachus, in that same position, **wins**.
3. The balance surface is in band everywhere.

So "the murmillo walks inside the retiarius' reach and stays there" is true and
is *also* true of the reference type, which is why it cannot by itself be the
defect.

**What survives as a genuine per-pair anomaly, and has no counterpart in the
comparator, is not the distance. It is that both of the retiarius' signature
mechanics have a near-zero success rate against this one opponent:**

| mechanic | vs murmillo | vs hoplomachus | mirror |
|---|---:|---:|---:|
| committed attack: geometry failures | **48.0%** | 27.9% | 41.9% |
| forced disengage: episodes reaching the exit | **1.6%** | 31.7% | 67.2% |
| forced disengage: median ground opened | **0.659** | 0.954 | 0.833 |

He commits about as often against the murmillo as against the hoplomachus
(~148 attempts against ~147 at 50 seeds) and half of it hits air. He gives
ground about 2.4 times a bout and it works twice in a hundred. Neither of those
is "he fights too close" — and neither is visible in any gate the project owns,
because the reach gates are contact-conditional and gate E is pooled.

That is a sharper statement of the problem than the brief's, it is measured, and
it points at different fixes. **It is also a design question rather than an
engineering one from here**, which is why it goes to the user rather than into a
spec: whether "the retiarius' signature attack and signature escape both fail
against his counter" is the counter working or the matchup broken is exactly the
call §8.3 and §8.5 reserve.

### Where I stopped / next session

Instrument committed and green. Full unit suite running. PR #20 still pending in
CI — **check it, do not merge**.

Blocked on the design call above before writing the spec, because the spec's
hypothesis depends on it: if the answer is "the counter is working", the slice
becomes the instrument plus a per-pair re-expression of gate E and stops there;
if the answer is "the matchup is broken", the candidates are C1–C3 with the
target restated as the two success rates rather than as time-at-distance.

---

## 2026-08-28 — session 3 continued: the decision, and half my finding withdrawn

**Design owner's call, 2026-08-28:** *fix the mechanics, not the distance.* Time
spent inside the murmillo's envelope becomes an observation the slice reports;
it is not a criterion. The slice targets the mechanics that fail.

I then went to collect the 200-seed per-pair numbers to write the spec against,
and **one of the two mechanics I had just reported is not a finding at all.**

### Withdrawn: the lunge's geometry failures are not murmillo-specific

I reported 48.0% against the murmillo versus 27.9% against the hoplomachus and
41.9% in the mirror. Those were 50-seed numbers. At 200:

| the retiarius' committed attack | geometry failures |
|---|---:|
| `fast vs heavy` | **47.3%** |
| `fast vs fast` | **47.0%** |
| `fast vs technical` | 29.0% |

The mirror is the same as the murmillo, so the murmillo is not what causes it.
The pattern is "against anyone who moves": the hoplomachus holds his measure
(`hold-range` 12, `backstep` 12, `advance` 6) and is the only opponent the lunge
reliably reaches.

And the comparator finishes it off. In that same `fast vs heavy` matchup the
hoplomachus' own committed attack, measured against the same murmillo, fails on
geometry **54.7%** of the time — worse than the retiarius' 47.3%. Gate G's
`fast`-free comparator is 45.4% pooled. So the retiarius whiffs less than the
type he is being asked to resemble, in the exact matchup where I claimed he
whiffs pathologically.

**That is the fifth time in this slice's history a finding has flattered the
finder and a direction check has reversed it**, and the third time today. The
brief's §4.2 exists for precisely this and it keeps earning its place. The cause
was mine and it is dull: I quoted a 50-seed draft as though it were a result,
in a document that has a rule against exactly that.

### What survives, and it survives every check I can put to it

**The forced disengage, and only the forced disengage.**

| the retiarius' own escape | vs murmillo | vs hoplomachus | mirror |
|---|---:|---:|---:|
| episodes | 948 | 608 | 859 |
| reaching the 3.35 exit | **1.6%** | 31.7% | 67.2% |
| median ground opened | **0.659** | 0.954 | 0.833 |

Why this one holds where the other did not:

- **It needs no comparator.** All three columns are the same mechanic belonging
  to the same archetype, measured across his three opponents. Nothing in it can
  be coupled to the thing it judges, which is the defect class every other
  criterion in this slice's history has fallen into.
- **The margin is not marginal.** Forty-fold, not a few points.
- **The mechanism is arithmetic and checks out.** 37 ticks of retreat at 2.7 u/s
  is 1.67 units of travel; the murmillo closes 0.86 of it; the measured net is
  0.659. The exit sits ~1.9 units away, so at that net rate it needs about 185
  ticks against a cap of 37.
- **The constant was derived, not measured.** `combatDecision.ts:969` records
  its own provenance: "the authored 2.4 sits 0.95 above the authored lunge's
  contact max of 1.45, and the same gap above 2.40 is 3.35." An arithmetic
  identity. Nobody asked whether a fighter being chased can cover it.

So the slice has one target, not two, and the design owner's decision applies to
it unchanged.

### Where I stopped / next session

Correction recorded. Next: the spec (phase E), targeting the forced disengage
alone, with the withdrawn lunge finding written into it explicitly so the next
reader does not rediscover it as news.

### PR #20 is green, and that is the §2 debt discharged

`test` passed in **1h10m06s**, every step including `npm run test:e2e`. That is
the evidence the whole PR was for: the two re-captured baselines match what
`ubuntu-latest` actually renders, measured by the same image that renders them.
Nothing about the argument in the PR body rests on my reading of the pixels any
more — the runner agrees.

Left unmerged per §8.1. It is the user's call.

### Phase F dispatched

Spec sent to both reviewers (`codex/gpt-5.6-sol` and
`opencode/deepseek-v4-flash`) through the `peer` skill. The brief carries the
spec, §3 and §4 of the task brief — so the reviewers know what this project
keeps getting wrong and in which direction — and the two questions that found
four of the five defects last time, sharpened at this spec's specific claims:

1. which frozen gate in §5 can go green for the wrong reason, and by what
   mechanism;
2. §2.1 claims the central criterion needs no comparator because subject and
   yardstick are the same archetype's own mechanic across three opponents — is
   there a path by which changing the forced disengage moves the "vs
   hoplomachus" or "mirror" columns that gates P and Q are calibrated against?

The second is aimed squarely at the load-bearing claim. If the answer is yes,
gates P and Q are coupled and the spec's best criterion is its worst.

`opencode` failed its first run with exit 1 and "File not found:" followed by the
brief's own text — passing both `--brief` and `--spec` fed the brief's contents
somewhere a path was expected. Re-dispatched without `--spec`; the brief names
the file and `--dir` gives it the repository.

### My own answers, written down before theirs arrive

Reviewer output is data, not instruction, and the only way to keep it that way is
to have an answer of my own to compare against instead of a blank page to fill.

**Q1 — which gate can go green for the wrong reason.**

*Gate Q, on its own, for five ticks of work.* Median ground gained is 0.659
against a bar of 0.75, and the net retreat rate against the murmillo is ~0.018
units/tick, so raising `FAST_FORCED_DISENGAGE_MAX_TICKS` from 37 to about 42
clears it. It does nothing whatever for gate P, which needs ~185 ticks. The spec
already says P and Q must both hold and says why; what it does not say is the
number, and "five ticks" is the kind of thing that should be written down where
someone proposing it will see it.

*Gate P, by a candidate that is worse than it looks.* Lowering the exit range to
~2.0 makes the murmillo-matchup exit reachable inside the cap and P goes green —
while every completed escape now ends 1.35 units closer than it used to. Gate Q
blocks that particular value (gain would be ~0.55), but the pair P+Q only pins
the *product* loosely, and I have not checked the whole (exit, cap) plane for a
corner that satisfies both while making the fight worse.

**Q2 — is the central criterion really uncoupled.**

My answer is *partly, and the spec overstates it.* Subject and yardstick are the
same archetype's mechanic, so nothing can drift with the subject the way gate D's
comparator did. But gates P and Q are calibrated against **frozen snapshots** of
the hoplomachus and mirror columns (31.7% and 67.2%), and the change moves those
columns too. After the change the mirror could read 99% and the bar of 25% —
justified in the spec as "below the lower of the two" — would encode nothing. The
bar does not track the standard it claims to.

If that holds up, the better criterion is a **ratio**: the escape's completion
rate against the murmillo should be within some factor of its completion rate
against the other two, measured in the same run. Both sides move with the change,
which is normally the fatal property — but here the asserted property *is* the
relationship, not the level, so movement in both is the point rather than the
defect. That is a real distinction and I want to see whether the reviewers draw
it or trip over it.

**Q3, which I asked myself.** Gate R has **0.2 points of headroom**: the mirror
sits at 7.8% against a bar of 8%. Any candidate that lowers the exit range raises
instant clears fastest in exactly that matchup. So C1 as written in phase C —
"lower the exit toward 2.6" — is close to dead on arrival, and the spec does not
say so.

That pushes toward the candidate the hypothesis actually implies and the spec
only gestures at: **stop making the exit an absolute separation.** End the
disengage when the fighter has *opened* a fixed amount of ground from where the
retreat began. It is pursuit-invariant by construction — longer against a chaser,
short against someone standing still — and instant clears become structurally
impossible, since the ground opened at tick zero is zero by definition. Gate R
would go to 0% everywhere rather than needing headroom.

Held for phase G rather than written into the spec now, because pre-empting the
review with a preferred answer is how a reviewer ends up grading my homework
instead of the spec.

**And an instrument note for phase G:** `FAST_FORCED_DISENGAGE_END_RANGE` and
`FAST_FORCED_DISENGAGE_MAX_TICKS` are module constants, not catalog, so
`--overlay` cannot sweep them — instrument debt 4 again, from a second direction.
The previous slice's tick-cap sweep (`combatDecision.ts:978-989`) was evidently
done by editing the constant and re-running, which is the method available and
should be planned for explicitly rather than discovered.

### codex came back, and it is the strongest review this slice has had

Three blockers. Each checked against source before being accepted, per §4.2 —
and the checking moved two of them.

**CONFIRMED, blocker — the exit-reason classifier is an inference from the
constant it judges.** `measure-reach.ts:281`:

```ts
exit: ticks >= FAST_FORCED_DISENGAGE_MAX_TICKS ? 'cap' : 'range',
```

Nothing observes *why* `hasFastForcedDisengageEnded` returned true; the label is
deduced from duration against a mutable constant. Gate P — "the share of
episodes ending by reaching the exit range" — would be built entirely on that
deduction, and §6 of the spec explicitly permits replacing the predicate. codex's
mechanism is exact: set the cap to 43 and add an early time exit at 42, and every
episode is labelled `range`, P approaches 100%, and nobody has reached 3.35.

The file's own comment shows how near-miss this was — it says the constant must
be read rather than hard-coded "or a hard-coded 30 would silently mislabel every
range exit past that tick". They saw the literal and not the inference.

**CONFIRMED, blocker — the permitted change surface cannot implement the
hypothesis.** `encounter.ts:215` carries `forcedDisengageStartTick?: number` and
nothing else; `hasFastForcedDisengageEnded(distanceToTarget, ticksSinceForced)`
receives only those two. There is no way to express "how much ground has this
episode opened". §6 lists only the constants and the predicate as mutable, so the
spec forbids the pursuit-relative answer its own §3 argues for — which is the
same candidate I pre-registered above two hours before codex named it.

**DOWNGRADED to major — the disengage window is mis-measured, but the direction
is establishable and I established it.** codex says the harness omits the first
forced movement and includes one post-exit ordinary movement, so "the direction
and size of the 0.659 baseline are not established".

Half right. Traced through `measure-reach.ts:229-290`: the field is stamped
inside the advance into tick `S`, the harness first sees it at the top of the
iteration where `battle.encounter.tick === S`, and takes `started.separation`
from the state at `S` — after that tick's forced movement. `ticks` counts from
`S` too, so the window is **self-consistent at the start**: 37 movements counted,
37 ticks reported. The start is not the defect.

The exit is. The kernel clears the field in phase 2 of the advance into tick `E`
and sets `nextDecisionTick: tick`, so ordinary decision and movement run in that
same advance — and the harness samples after all of it. One ordinary movement is
counted as disengage ground, of uncontrolled sign.

Magnitude: one tick is 0.045 units of retreat against 0.023 of murmillo advance,
so ~0.022 net at most. The measured 0.659 could be off by roughly that. **It does
not reach the 0.75 bar either way, and it does not touch the headline statistic
at all** — completion rate is a count of episodes, not a separation. So the
finding stands and the instrument still needs to be exact before it is a gate.

**CONFIRMED, major — my §1.2 withdrawal does not dispose of the commissioned
question**, and codex is right that I let it slide. The playtest asked whether
the retiarius still uses his signature attack; I disproved a *different* claim
(that the murmillo uniquely causes geometry failures) and moved on.

So I measured it. Lunge share of the retiarius' total attack attempts, 200 seeds:

| opponent | lunge attempts | probe attempts | **lunge share** | attacks per 1000 engaged ticks |
|---|---:|---:|---:|---:|
| murmillo | 569 | 572 | **49.9%** | 8.44 |
| mirror | 1079 | 1037 | **51.0%** | 21.24 |
| hoplomachus | 607 | 531 | **53.3%** | 12.98 |

**He has not abandoned his signature attack against the murmillo.** Half his
offence is the lunge against every opponent, within 3.4 points. The playtest's
2095→786 was a before/after across the content change, not a per-opponent split,
and it does not survive being asked per pair.

What *is* different, and what nobody has looked at: he attacks **2.5× less often
per engaged tick** against the murmillo than in the mirror. That is a real
per-pair asymmetry and it is unmeasured. Recorded; not this slice's target
without a decision.

**CONFIRMED, major — three PRs must become four.** Fixing the exit-reason
instrumentation needs a behaviour-neutral kernel diagnostic, which cannot go in
PR-2 (that PR claims simulation stays closed) or PR-3 (that couples the
instrument to the behaviour it judges). The precedent is exact: the previous
slice added `src/simulation/contactDiagnostics.ts` as a write-only seam for
precisely this reason, and this slice needs its sibling for disengage episodes.

**CONFIRMED, major — §2.1's independence claim, which is what I pre-registered
above.** codex adds a refinement better than my own: if the criterion becomes a
ratio, keep an absolute floor as well, so the ratio cannot be satisfied by
degrading its denominator. My version had that hole.

Also accepted: R only excludes one-tick exits so a two-tick trivial escape passes
(major); keep pooled E *and* add per-matchup R rather than replacing (minor);
assert P and Q per ordered matchup rather than pooling the two orientations
(minor).


---

## 2026-08-28 — session 3, review rounds 1 and 2

Full findings and disposition live in the spec's §10 and §10.5; this entry
records only what the journal is for — what I got wrong and how I found out.

**Round 1:** three blockers, all confirmed. The gates rested on an inference
(`measure-reach.ts:281` deduces the exit reason from duration against the very
constant it judges), and §6's change surface forbade §3's own hypothesis (no
start separation anywhere in `FighterCombatState` or the predicate signature).

**Round 2:** two blockers, five majors, none rejected. The seam I wrote to fix
round 1's first blocker **reopened the same hole one level up** — it took the
reason from the mutable predicate and let PR-4 invent new ones. And PR-2 as I
scoped it was impossible: `stateHash.test.ts:57-80` hashes the whole
`BattleState` every tick across nine pairings, so the field I wanted to add would
move nine frozen digests while the PR claimed nothing moved. I had not opened
that test.

### The paragraph I got wrong four times

The disengage window's measurement error, in order: ~0.022 (only the term that
helped); ~±0.09 "may sit on the bar"; a signed −0.11..0 concluding the
measurement *understates* the gain; and finally — round 2 — **no interval at
all**, because every version modelled locomotion and the harness samples after
phases 9–10, where `heavy-cleave` pushes **0.70 units**, six times my whole
bound.

Four attempts, four wrong, every one in the direction of my own claim. The brief
says this project's instruments fail flatteringly; it turns out so do mine, and
the only thing that caught it each time was someone else reading the code.

### The finding I had in my hand and used the wrong statistic to dismiss

Round 2's sharpest: I closed the commissioned "is he still a retiarius" question
with the lunge **share** (49.9 / 51.0 / 53.3%, flat). The question was about
**frequency**, and the rate was in my own table — **4.21** lunge attempts per
1000 engaged ticks against the murmillo versus **10.83** in the mirror, a 61%
collapse. I computed it, filed it in §8 as an unrelated debt, and then answered
a different question with a different number.

It matters here specifically: a longer forced disengage reduces attack incidence
further, so every gate in §5 could pass while the signature attack gets rarer.

### Where I stopped / next session

Spec is at revision 3 and is **not fit to implement**. §11 holds the one open
question, and it is the design owner's: is signature-attack frequency in this
slice or explicitly out of it? §5 is incomplete until that is answered and PR-4
must not start.

Round 3 of a maximum three is not yet dispatched, deliberately — sending a spec
whose §5 is known-incomplete would spend the last round on a document I already
know is unfinished.

Also standing: PR #20 green through e2e, unmerged per §8.1. `opencode` failed
four times across two models and never produced a report, so this spec has had
one external reviewer rather than two — recorded in the spec's §10.1 because it
makes the gate weaker than the previous slice's.


---

## 2026-08-28 — session 3, round 3: the budget is spent

**Phase:** F, third and final round.

codex returned **two blockers**, both confirmed, both about gates I had just
written in response to round 2. The spec is at revision 5; the fixes are in;
the fixes are unreviewed.

### Gate V measured something other than what it said

`measure-reach.ts:299-305` files a contact under `reached` only when the outcome
is in `REACHED`, geometry misses in their own bucket, and an attack interrupted
before phase 9 leaves **no record at all**. My "attempts" was
`reached + geometryFailures`. That is not attempts, and it is not anything with a
name. On top of it, the contacts span the whole bout while the denominator counts
only engaged ticks — I joined two JSON files by hand and the window mismatch rode
straight through.

The exploit runs the way V exists to stop: eight starts at 53% geometry success
and five starts at 80% both report ~4.2. Commitment can fall **38%** with V green.
V's bar is withdrawn and re-measured in PR-3 on `action-started` counts.

### Gate P could still be fed epsilon

I required a success's ground to be `> 0` and never gave the "frozen minimum
gain" a number. codex's 100-episode construction — 12 epsilon successes, 13 real,
38 capped-but-good, 37 capped-and-bad — passes P at 25%, both Q medians at 0.80,
and Q2. **I reproduced it against `balanceCohorts.percentile` rather than taking
it on trust, and it passes exactly as described.** Half the claimed escapes open a
millimetre, and those premature exits *help* gate V instead of colliding with it.

Success is now a ground condition — ≥0.75 units from the seam's endpoints — with
the exit label secondary. That incidentally answers the brief's second question
better than my own P2 discussion did: with success defined by a label, the mutable
predicate was choosing Q's success-only population, so Q had a coupled comparator
I had not spotted.

### And a number I gave the design owner was inflated twofold

`fast vs fast` has **two** retiarii and `measure-reach.ts:301` aggregates by
`actionId` without regard to actor. So the mirror's 10.83 lunges per 1000 ticks
counts both of them. Per fighter it is 5.42, and the reduction against the
murmillo is **22%**, not the 61% I reported — the same error made the "2.5× fewer
attacks" debt a 21% one. Gate V's bar does not depend on the comparison that was
wrong, but the scoping decision was taken against it, so it was reported rather
than quietly amended.

Fifth time in this slice a number has been quoted at a precision or a
normalisation it did not have. Fifth time it favoured the claim.

### Where I stopped / next session

**This is the brief's §8.2.** Three review rounds have run — the maximum — and the
third returned confirmed blockers. They are fixed, and the fix is unreviewed,
which is exactly the state §8.2 reserves for the design owner. Nothing further
should be built on this spec until that is decided.

opencode's round-3 report had not returned when this was written.

Standing: PR #20 green through e2e, unmerged. `fix/murmillo-pin` holds the
distance instrument (809/809 tests, `tsc` clean), the boundary committed ahead of
the work it judges, and the spec at revision 5 with seven gates, one of whose
bars is deliberately withdrawn. No content has been touched.


---

## 2026-08-28 — session 3, discharging round 3's gate-V blocker by measuring it

The §8.2 decision is still the design owner's. This is the one round-3 fix that
could be settled with a measurement instead of a promise, and `measure-distance.ts`
is open to this slice, so it was.

### What was built

`measure-distance.ts` now counts `fast-burst-lunge` `action-started` events inside
the same latched engaged window that gates the denominator, per Fast fighter, and
both halves come from one run. Two regressions in `distanceHarness.test.ts`.

**The first regression failed, and the failure was mine.** I asserted that starts
*strictly* exceed the contact-derived count, and on seed 20260815 both are 4 —
every lunge in that bout survived to phase 9. Starts exceeding survivors is a
tendency, not a law, and asserting it as a law would have shipped a flaky test
wearing a regression's clothes. It now asserts the actual invariant per bout
(starts ≥ contacts, since a contact cannot exist without a start) and the actual
defect in aggregate (pre-engagement starts are a real, excluded population).

### The measurement, and it moves against me for once

Per Fast fighter, 200 seeds:

| | starts in window | old contact-derived | rate /1000 |
|---|---:|---:|---:|
| `fast vs heavy` | 508 | 569 | **3.76** |
| `heavy vs fast` | 492 | 552 | **3.76** |
| mirror | 1085 | 1079 | 5.45 |
| `fast vs technical` | 617 | 607 | 7.04 |
| `technical vs fast` | 568 | 542 | 6.60 |

Against the murmillo the corrected count is **11% lower** than the old
derivation: ~61 lunges per 200 bouts start during the approach, and the old
figure counted them while counting none of their ticks. Everywhere else it is
slightly higher, because starts that never reach phase 9 now register.

**So the frequency reduction against the murmillo is 31% against the mirror and
45% against the hoplomachus** — bigger than the 22% I reported after the
double-count fix, not smaller.

That is worth naming explicitly. Five corrections in this slice ran toward the
claim I was making. This is the sixth and it runs the other way: the effect is
larger than my last number said. The pattern was never "my numbers are
pessimistic"; it was "my numbers are unchecked", and an unchecked number lands
wherever the arithmetic happens to put it.

Gate V's bar is frozen at **3.55**, 95% of the measured 3.76.

### Where I stopped / next session

Unchanged: **§8.2 is the design owner's call** — a fourth review round, accept
revision 5 and start PR-2, or park. Round 3's other blocker (gate P's epsilon
successes) is fixed in the spec and, unlike this one, cannot be discharged by
measurement — it needs the PR-2 seam to exist.

### The full suite went red once, and it was not my change

811 tests, 810 passed, one failed: `encounter.test.ts`'s "informational pacing
probe", **timed out at 5184 ms against Vitest's default 5000 ms**. Not an
assertion — a timeout, in a file this slice does not touch.

Checked rather than assumed: run alone the same test takes **905 ms**. It needs
a 5.5× slowdown to trip, and it got one, because I had a 200-seed
`measure-distance` run competing for the machine. Re-ran the whole suite with
nothing else going: **811/811 across 39 files.**

Recorded as debt 5 rather than waved off. A test that sits at 18% of its timeout
budget will flake on a loaded CI runner, `stateHash.test.ts` solves the identical
problem with an explicit `30_000`, and the brief's §4.4 is precisely about what a
red gate costs: `npm run check` stops at the first failure, so this one would
have eaten the e2e report. `src/simulation/**` is closed to this slice, so it is
written down, not fixed.


---

## 2026-08-29 — session 4, phase 0: the premise, looked at rather than computed

**Phase:** 0. The whole slice rests on one inference — that "the retiarius fights
too close to the murmillo" is not a defect, because the hoplomachus spends
**81.1%** of the same matchup inside 1.70 against the retiarius' **54.3%** and
*wins* it 55.0%. Every number saying so comes from the same family of
instruments. Nothing said whether it reads that way on screen.

### What was recorded

`npm run review:clips`, clip 1 (`brutus` murmillo vs `drusus` retiarius) and
clip 2 (`brutus` murmillo vs `cassius` hoplomachus), `--config=everything`, at
the shipped seed 20260815 and again at `--seed=99`. Two seeds rather than one
deliberately: a single bout per matchup is exactly the sample size §5.3 of the
brief says may not be quoted, and this decision could cancel the slice.

Four bouts, 1827 / 2159 / 1985 / 1393 ticks. Frames pulled at a fixed 3–4 s
stride with Playwright's own bundled ffmpeg (`ms-playwright/ffmpeg-1011`); the
machine has no other ffmpeg and its build has `fps` disabled, so frames were
seeked one at a time rather than filtered.

### What is visible

Same crop, same camera, same scale in both matchups, so "a body width" means
the same thing in each.

| | frames sampled | frames with visible daylight between the two |
|---|---:|---:|
| murmillo vs **retiarius**, seed 20260815 | 10 | 4 (t=2, 8, 17, 29 s) |
| murmillo vs **retiarius**, seed 99 | 6 | 2–3 (t=7, 11, and 15 marginal) |
| murmillo vs **hoplomachus**, seed 20260815 | 9 | 1 (t=2 s, the approach) |
| murmillo vs **hoplomachus**, seed 99 | 6 | 0 clear; 2 at roughly half a body |

The hoplomachus locks up against the murmillo at the first exchange and
essentially never comes off him again: shields overlapping, spear and gladius
crossed, both bodies inside one shield width for the whole bout. The retiarius
does the opposite at intervals — he closes, and then there are frames where he
is a clear body-width off, trident out, with floor visible between them.

**Answer to the brief's one question: no.** The retiarius does not look more
pinned than the hoplomachus. If anything the reading runs the other way, and it
runs the same way on both seeds. The premise holds and the slice targets
mechanics, as decided.

### What this is not

It is not the human gate. `design.md` requires two people who did not write the
combat, and `record-review-clips.ts` says in its own header that visual
acceptance cannot be delegated to a text-only model. This was a falsification
attempt — the one reading that would have cancelled the slice — and it failed to
falsify. The gate is still unpassed and PR-2 still does not merge itself.

It is also stills, not motion. That cuts *against* the retiarius reading rather
than for it: what stills lose is his lunge-and-retreat rhythm, which is the part
that reads as *not* pinned. And a caveat that no frame count can settle — the
trident is long, so a body-width of daylight is still inside his threat range.
"Not pinned" here means the bodies separate, not that the murmillo is safe.

### Where I stopped / next session

Phase 0 done and clean; going into phase 1, PR-2's disengage seam. PR #20 is
**still open, not merged**, so the inherited `tests/__screenshots__/linux/**`
exemption in `check-allowlist.sh` stays — it is not yet the moment it is marked
for deletion at.


---

## 2026-08-29 — session 4, phase 1: PR-2, the disengage seam

**Phase:** 1. The boundary went in first, as it must; then the seam; then the
evidence. Nothing was declared done before the command that says so ran.

### The boundary, and the entry that carries it

`check-allowlist.sh` rebuilt for PR-2's claim — *adds a seam, changes nothing
the seam observes* — and committed at `003b962`, **before** the work it judges.
Four exemptions: the seam and its test, the two kernel files the collector has
to be threaded through, the one signature change and its test, and the file
itself.

The load-bearing entry is what stays **closed**. `encounter.test.ts`,
`battle.test.ts` and `stateHash.test.ts` all already assert the forced
disengage; if threading a write-only collector had required editing any of them,
the seam would not be inert. So the gate is set to fail rather than to let me
quietly re-take a baseline. `measure-reach.ts` stays closed for the third PR
running.

Both sides checked, three rejections and one acceptance:
`src/simulation/encounter.test.ts` rejected, `scripts/measure-reach.ts`
rejected, an untracked `src/presentation/` file rejected, and the seam's own new
path accepted.

PR #20 is **still open** (`gh pr view 20` gives `state: OPEN`,
`mergedAt: null`), so the inherited `tests/__screenshots__/linux/**` exemption
stays. It is now annotated with the date it was last re-checked, so the next
session does not have to re-derive whether the deletion is due.

### What was built

`src/simulation/disengageDiagnostics.ts`, on `contactDiagnostics.ts`'s model:
never read back inside a tick, never in `EncounterState`, never in the event
log. The kernel writes flat phase-2 samples — `stamped`, `held`, `cleared` — and
a pure `assembleDisengageEpisodes` regroups them into one record per episode.

The split is deliberate. A stateful collector would have to assemble episodes
inside the kernel's write path, where it is hard to test and easy to get quietly
wrong; a flat stream plus a pure regrouping puts every interesting rule — the
pairing, the censoring, the two impossible states — in a function that can be
called with six hand-written samples.

`held` exists for one reason: a censored episode still needs an end separation,
and the only honest one is the last reading taken while it was open. It costs
nothing, because phase 2 already computes that distance every tick to feed the
predicate.

`hasFastForcedDisengageEnded` widens from `boolean` to
`DisengagePredicateExit | undefined`. That is the only signature changed. The
reason set is frozen in the diagnostics module rather than beside the predicate
that reports it, and `censored` is excluded from what a predicate may return
**by type** — round-2 review's finding was that a seam faithfully reporting
whatever reason a future predicate invents reopens the hole one level up, and a
type is a stronger answer than a comment.

**No new field on `FighterCombatState`.** Both endpoints are read in phase 2
from state the kernel already has, so nothing is stored and the nine digests do
not move. That was the whole point of the round-2 re-split.

### The evidence, all of it commands rather than reasoning

- `tsc --noEmit` — clean.
- Full suite — **823 passed, 40 files.** It was 811 across 39 before; the
  difference is exactly the 10 tests in the new file and 2 added to
  `combatDecision.test.ts`. The arithmetic is stated because "the suite is
  green" without a number is how a silently-skipped file hides.
- The nine `stateHash.test.ts` digests — **unchanged**, `brutus/drusus:b0fa2d92`
  through `nerva/magnus:a32fab50`.
- `measure-reach --seeds 200 --gate` — not merely "matches the journal", which
  only records a handful of the figures it prints. The same command was run
  against the pre-seam tree (`git checkout 003b962 -- src/simulation scripts`)
  and the two outputs **diff to nothing: byte-identical.** That is a stronger
  check than the acceptance list asked for and it was cheap, so there was no
  reason to run the weaker one.
- `check:allowlist` green against `git merge-base main HEAD`.

The seam's own test file adds a local version of the inertness proof: the same
bout rolled tick by tick, hashed with and without a collector attached, plus an
assertion that the collector was actually fed — or the first assertion is a
tautology about two runs that both did nothing.

### Where I was wrong, and how I found out

**The corroboration test was half-vacuous and looked complete.** It ran against
`aquila vs magnus` — the Fast home fighter against the murmillo, the obvious
choice — and asserted that every `range` episode's end separation clears 3.35
and every `cap` episode ran the full 37 ticks. It passed. Then I printed the
population instead of trusting it: **six episodes, all six `cap`.** The `range`
clause never executed once. It would have passed just as happily with that
branch broken.

That is the sixth instrument failure in this slice and the second in this
session, and it has the same shape as gate V's: an assertion that reads as a
statement about a population, run against a population that does not contain the
case. Fixed by moving to the Fast mirror (`aquila vs drusus`: 3 `range`, 2
`cap`, and two forced actors, so the interleaving is exercised too) and by
asserting the coverage itself — the set of observed reasons must equal
`{range, cap}`, so the loop fails loudly instead of going vacuous if a
population empties.

Worth writing down separately: **`aquila vs magnus` producing six episodes and
zero range exits is the slice's subject matter, found by accident while
debugging a test.** The retiarius, against the murmillo, does not once open the
range back out in that bout. The 200-seed figure already said 1.6%; this is what
1.6% looks like from inside a single fight.

**Censoring is real and I nearly wrote it as a defensive branch.** Swept 60
seeds by 9 pairings — 540 bouts, 1889 episodes — and **17 episodes (0.9%) are
still open when the bout ends**, one of them zero ticks long because it was
stamped on the final tick. Both hand-written unit tests correspond to states the
simulation actually reaches, and one real bout (seed 20260836) is pinned as a
regression. Had I not swept, "keep censored episodes" would have been an
untested branch justified by a paragraph.

### One design choice that is not forced, and is written here because a gate reads it

When a fighter reaches the exit distance on the *same* tick the cap fires, the
predicate reports `range`. The answer is unchanged either way — the boolean
version returned `true` — so this only moves the label. It is the right way
round: that fighter did open the ground, and reporting the episode as a pin
would understate the escape in the gate this seam feeds. Pinned by its own test
so a later PR has to argue with it rather than flip it silently.

### Numbers this session produced, at 200 seeds

From the unchanged reach gate, for the record and for PR-3 to build on:
`fast forced disengage: n=2415, ticks med=37, separation gained med=0.78,
p10=-0.05, cleared within one tick 2.9%, exits range=785 cap=1570 censored=60`.
The 785 range exits are the journal's 9 + 6 + 577 + 100 + 93 from the
per-matchup table, which is the determinism check passing as a side effect.

### Where I stopped / next session

PR-2 is built, green and committed on `fix/murmillo-pin` (`003b962` boundary,
`8609a38` seam). It is **not** opened as a GitHub PR and not merged — the
brief's stop condition 1.

Out for review with `codex`; the result is not in this entry. If it returns a
confirmed blocker after three rounds, that is stop condition 5 and the design
owner's call.

Standing, unchanged: PR #20 open and unmerged; the human "does it read as a
retiarius" gate still unpassed and still needing two people who did not write
the combat; debt 5 (`encounter.test.ts`'s untimed pacing probe) still unpaid,
since `src/simulation/**` was open to this PR only for the seam. The new file's
three bout-driving tests carry an explicit `30_000` for exactly that reason,
rather than sitting at 20% of the default budget the way debt 5 does.


---

## 2026-08-29 — session 4, phase 1 continued: three rounds of review on PR-2

**Phase:** 1, review. Three rounds with `codex`, the maximum the process allows.
Six findings across them, **all six confirmed against the source** — none
rejected as wrong, one rejected as a blocker *for this PR* with the reasoning
written down and the substance accepted.

The pattern is worth naming before the details: **each round found a defect in
code I had not opened, or in a claim I had not tested.** That is now three
slices running.

### Round 1 — blocker, major, two minors

**The blocker was mine for reasoning from the wrong file.** `recordDisengage`
raised on a non-finite separation, copying `recordContact`'s posture on `NaN`,
and I justified it with "`TARGET_RETENTION_RADIUS` is 20 units against an arena
a little under 9 across". That sentence is true of the duel adapter.
`advanceEncounterTick` is the **generic kernel**. `retainTarget`
(`combatDecision.ts:98`) drops a target the instant it is defeated, and in a
multi-combatant encounter the bout carries on.

Measured instead of argued, 40 seeds of a three-fighter free-for-all:

| state | seeds affected |
|---|---:|
| a fighter with **no target** during an open episode | **12 of 40** |
| a fighter **retargeted** during an open episode | 3 of 40 (8–21 samples each) |

`BASELINE_TEST_SEED` is one of the twelve. The old kernel would have thrown on
the first free-for-all anybody attached a collector to. A transition that
completed without a collector threw with one — the seam was not inert, in
exactly the case it claimed to be.

The major was the other half: samples carried only `actorId`, so an episode
could start against one opponent and end against another and the difference be
reported as ground opened. Seeds 20260829, 20260835 and 20260837 do exactly
that.

The two minors were both real. The start-separation test asserted only that the
numbers sat between 0 and 3.35 and near the lunge's range — **all of which a
post-retreat separation also satisfies**, so it would have gone on passing with
the one-tick window defect restored, which is the entire defect the file exists
to fix. And the "inherited, not reopened" paragraph in `check-allowlist.sh` was
a paragraph: measured from `merge-base main HEAD`, an inherited change and a
fresh one are indistinguishable, so the list happily allowed PR-2 to edit the
distance instrument.

### Round 2 — my own fix was the major

Moving validation out of the kernel was right. Making it **throw** was not: one
ordinary free-for-all episode destroyed every valid episode in the same run. On
a 200-seed gate that is 2414 good episodes lost to one.

The fix that survived: measurement validity is orthogonal to why a disengage
ended, so it gets its own vocabulary rather than a fifth exit reason.
`assembleDisengageEpisodes` returns `{ episodes, unmeasurable }`, and **every
stamped episode lands in exactly one of the two** — asserted directly, because
that is the property a rate's denominator rests on. The frozen set stays frozen.

The minor: the seam was not *allocation*-inert. State and events were, but
`recordDisengage(collector, sample)` builds its argument before the function can
discard it. Now `collector?.record({...})` — optional chaining does not evaluate
its argument list on the nullish path — and the stamp branch, which computed no
distance at all before this seam, sits behind an explicit `if`.

### Round 3 — the blocker I had argued away, and the measurement that settled it

Round 2's blocker said the kernel invokes caller-owned code synchronously in
phase 2. I accepted the throwing half, showed the mutation half was false *for
this seam* — every sample field is a primitive, and there is now a test saying
so — and narrowed the claim to "inert for a collector that returns".

**Round 3 said that was still too strong, and it was right.** A collector can
stop being handed state and go looking for it. So I measured it rather than
conceding or arguing:

| run | digest | ticks |
|---|---|---:|
| no collector | `7e5009f3` | 1175 |
| benign collector | `7e5009f3` | 1175 |
| **returning collector that mutates `previous...position`** | **`c13df37`** | **1687** |

`transitionExpiredPhases` shallow-copies the combatant map, so those position
objects stay shared and every later phase reads the mutation. 164 mutations, a
different bout, and `record` returned normally every time.

Two revisions of that comment claimed more than the code delivered — first
"inert", then "inert for a collector that returns". Both false. The header now
says what the measurement supports: **inert for a collector that returns and
does not write to state it captured.**

**Then the second measurement, which is the one that decides the disposition.**
The identical hostile collector, pointed at the *merged* `contactDiagnostics`
seam: `7e5009f3` → `1499c999`. So this is a property of the callback pattern
§4.0 told PR-2 to model itself on, shared by all three collectors, and not
something this seam introduced.

The reviewer's own sentence is the right one to keep, and I am not going to
soften it: *existing collectors having the same weakness is precedent for debt,
not protection for this claim.* Both things are true at once — the claim was too
strong, and the fix is a kernel-type change across three modules that cannot
honestly live in a diff whose claim is that it changes nothing.

Round 3's minor was also correct and is fixed: the non-finite check sat inside
the held/cleared branch, so a `stamped` sample skipped it entirely and could
open an episode with a `NaN` start separation, and a sample that both retargeted
and went non-finite took the `target-changed` path and was never validated. The
check moved above all branching, and the test now covers all three kinds instead
of naming three and asserting one.

### Acceptance, re-run after every round

- `tsc --noEmit` clean.
- Full suite **832 passed, 40 files** — 811 before this session; the difference
  is 19 tests in the new file and 2 in `combatDecision.test.ts`.
- The nine `stateHash.test.ts` digests unchanged, `brutus/drusus:b0fa2d92`
  through `nerva/magnus:a32fab50`.
- `measure-reach --seeds 200 --gate` **byte-identical** to the same command run
  on the pre-seam tree, after every round.
- Both `check:allowlist` passes green, four negative controls.

### Where I stopped / next session

**This is the brief's stop condition 5.** Three rounds have run — the maximum —
and the third returned a blocker that is confirmed by measurement. It is fixed
in the only way PR-2 can fix it, by narrowing the claim to what is true, and the
real fix is recorded as debt 7 in the spec with its acceptance criterion
attached so it is not re-litigated.

**The decision is the design owner's**, and it is a real fork, not a formality:

1. accept PR-2 as it stands, with the narrowed claim and debt 7 open;
2. widen this slice to re-shape all three collectors onto
   `EncounterTransition` first, which changes a kernel type and re-baselines
   nothing but touches two merged modules;
3. open debt 7 as its own slice before PR-3 builds on the seam.

Nothing further should be built on the seam until that is chosen.

Standing: PR #20 open and unmerged, so the inherited
`tests/__screenshots__/linux/**` exemption stays. PR-2 is committed on
`fix/murmillo-pin` and is **not** opened as a GitHub PR and not merged. The
human "does it read as a retiarius" gate is still unpassed and still needs two
people who did not write the combat.


---

## 2026-08-29 — session 4, the fork decided: PR-2 stands, debt 7 deferred

The design owner handed the §7.5 decision back. Three options were on the table:
accept PR-2 with the narrowed claim, widen the slice to re-shape all three
collectors first, or open debt 7 as its own slice before PR-3.

**Decision: accept PR-2 as it stands.** Not because the reviewer was wrong — the
blocker is confirmed by measurement and the claim it broke was mine — but
because the fix has nowhere to live inside this slice, and that turned out to be
a checkable fact rather than an opinion.

### What I checked before choosing

The proposed fix is to hand samples back on the transition instead of through a
callback. From the duel adapter there are exactly two places to put them:

1. **On `BattleState`.** `stateHash.test.ts:57-80` hashes the *whole*
   `BattleState` after every tick across nine pairings. Samples living there
   move nine frozen digests **by construction** — which is precisely the trap
   that forced §4.2's PR-2/PR-4 re-split, arriving again by a different route.
2. **On a widened `advanceBattleTick` return.** Traced the callers:
   `src/presentation/ArenaCamera.test.ts`, `src/testSupport/balanceCohorts.ts`,
   `scripts/measure-reach.ts`, `scripts/measure-distance.ts`,
   `src/testSupport/reachHarness.test.ts`, `scripts/benchmark-duel-log.ts`.
   Three of those are closed to this slice, and `measure-reach.ts` is closed for
   the load-bearing reason — it is the instrument producing these baselines, and
   an instrument may not be adjusted in the diff whose numbers it produces.

So options 2 and 3 do not merely cost more. **They require breaking the rule the
slice exists to respect**, in order to fix a defect about measurement honesty.
That is not a trade I am willing to make quietly, and it is the whole argument.

### And the exposure is latent, not live

Also checked rather than assumed. Every collector in the repository is the same
shape — `{ record: (entry) => array.push(entry) }` — across twenty construction
sites in scripts and tests. **None captures encounter state.** The shipped
runtime attaches no collector at all: nothing in `main.ts` or `src/presentation/`
passes one.

The defect needs a collector that goes looking for the kernel's own state. None
exists, so what is deferred is a latent hazard, not a live one.

### What the decision costs, stated rather than buried

A third module now carries the weakness, and PR-2's header says so out loud
instead of claiming inertness it does not have. Debt 7 records the fix, the
reason it is deferred, and its acceptance criterion — a regression whose
returning collector mutates the pre-tick state and shows the transition
unchanged, which **fails today in all three modules**.

One constraint falls out of it and is written into the debt, because PR-3 is
where the temptation actually arrives: **PR-3's collector must close over
nothing but its own accumulator.** Its per-matchup report wants to know who the
fighters are, and reaching into `BattleState` from inside `record` is exactly
what turns this debt from latent into live.

### Not done, deliberately

No GitHub PR opened. The branch stacks on PR #20, which is still unmerged, and
the human "does it read as a retiarius" gate is unpassed, so a PR would sit
unmergeable while implying it was ready. Creating one is permitted by §7.1;
nothing about it is useful yet.

### Where I stopped / next session

PR-2 is complete, reviewed three times, green, and committed on
`fix/murmillo-pin`: `003b962` boundary, `8609a38` seam, `53fab2b`, `ca16246` and
`4efff33` the three review rounds. Acceptance re-run after each: `tsc` clean,
**832/832 across 40 files**, nine digests unchanged, `measure-reach --seeds 200
--gate` byte-identical to the pre-seam tree, both allowlist passes green.

Next is **PR-3, the criteria** — `measure-reach.ts` opens, gate E's pooled
clauses are kept and added to, and §5's gates are asserted on this seam's
records rather than on a duration inference. Two things it inherits from today:
the constraint above, and the fact that `unmeasurable` episodes now exist and
have to appear in its denominators rather than being quietly skipped.

Standing: PR #20 open and unmerged, so the inherited
`tests/__screenshots__/linux/**` exemption stays. Debts 5 and 7 unpaid. The
human review gate still needs two people who did not write the combat.
