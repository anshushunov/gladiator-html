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
