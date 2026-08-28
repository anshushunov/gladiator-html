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
