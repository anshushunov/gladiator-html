# Readable Deep Combat — Human Review Evidence (Task 19, Step 5)

**Status: NOT YET RUN.** This document is an empty template, prepared ahead of
review per Task 19 Step 4. No cell below has been filled in, and no pass/fail
claim is made anywhere in this file. Every row is blank until a real,
non-implementer human reviewer watches the material and records their own
observations.

This gate cannot be delegated to a text-only model or claimed from automated
or model review (design.md, "Human review gate": "Visual/audio acceptance
cannot be delegated to a text-only model"). The automated/numeric evidence
this document depends on (deterministic key-pose fixtures, the cross-runtime
trace hash, and the intentional screenshot baselines) lives in
`tests/combat-visuals.spec.ts` and `tests/smoke.spec.ts`, and is already
passing as of this commit -- but passing those does not satisfy this gate.
Only a completed version of this document, filled in by actual reviewers, can
close Step 5.

What *is* prepared: `npm run review:clips` and `npm run review:stills` record
the whole material set from a fixed seed (see below), so the two reviewers
watch identical bouts and judge identical stills, and neither has to assemble
anything by hand. As of the 2026-08-23 readable-gladiator-types slice that
material comes in **five configurations** behind dev-only runtime toggles, so
that a pass or a failure can be attributed to one of the slice's three changes
rather than to all of them at once — see "The five configurations" below.

## Producing the material

```bash
npm run review:clips                            # -> docs/reviews/clips/everything/
npm run review:clips -- --config=baseline       # ...and the other four
npm run review:stills                           # -> docs/reviews/clips/blinded-stills/
```

Records everything below into `docs/reviews/clips/<configuration>/` (gitignored
-- it is review material, not an artifact) from a fixed seed, and writes a
`README.md` there listing every clip with its pairing, its pre-roll offset, and
the event trace behind it:

- the nine `×1` pairing bouts, one video each;
- three of them repeated with the HP cards and battle feed hidden (one per home
  style) -- the clips this gate is actually scored on;
- one full three-bout series at `×2`;
- the complete event trace for each clip as JSON, so the label comparison in
  the next section is done against the real trace rather than from memory.

Two things the script deliberately does not produce, because it cannot:

- **Sound.** Chromium records video silently. Review audio live against a
  running `npm run dev`: `?audioDebug=1` fires each cue in isolation with no
  bout running, and the **Sound off/on** control covers cues during a full
  bout.
- **A verdict.** It records; the reviewers judge. Nothing in this repository
  can fill in a cell below.

Reproducing an exact moment by hand uses the same two parameters the e2e suite
uses: `?seed=<n>` fixes the series (the same seed always produces the same
three bouts), and `?snapshot` starts the runtime **paused** so nothing advances
until `__GLADIATOR_TEST__.advanceTicks(n)` is called. See
`docs/reviews/clips/<configuration>/README.md` for the console recipe.

## The five configurations, and the question each one answers

*(Added by the 2026-08-23 readable-gladiator-types slice. This section is the
reason the gate can be re-run at all: without it a second failure would say
nothing about which change failed.)*

That slice changed three things at once — the names on screen, the camera's
extent→distance mapping, and the fighters' equipment — and all three aim at the
same question. A single pass or a single failure would therefore be
unattributable. So **one frozen trace is recorded five ways**, behind
dev-only runtime toggles (`src/presentation/legibilityMode.ts`, reachable only
via `?legibility=<name>` under `import.meta.env.DEV`; a production build
resolves the shipped configuration whatever the URL says):

| `--config=` | labels | camera | silhouettes | the question it answers |
|---|---|---|---|---|
| `baseline` | — | — | — | what the failed 2026-08-23 pass actually saw |
| `labels-only` | ✔ | — | — | how much of any gain is just having a name to check against |
| `camera-only` | — | ✔ | — | how much is just seeing the fighters bigger |
| `silhouettes-only` | — | — | ✔ | how much is the kits, with no name and no extra pixels |
| `everything` | ✔ | ✔ | ✔ | what ships |

Nothing about the recording changes between them: same seed, same lineups, same
bouts, same event traces — none of the five touches simulation, and the
allowlist gate (`npm run check:allowlist`) proves it.

**The one subtlety that makes `camera-only` honest.** A fighter's
`horizontalEquipmentRadius` is derived from his equipment and is the *camera's*
own framing input. If turning the silhouettes off also reverted that radius,
then `camera-only` would be running the shipped mapping over the old radii —
a camera that has never shipped — and the comparison would be worthless. So the
framing radius **always** comes from the final props in all five
configurations; only the drawn geometry follows the flag. Asserted per
configuration in `src/presentation/legibilityMode.test.ts`.

The first draft of the design spec proposed recording from two *commits*
instead. That is the same trap, and it is why this is a runtime toggle.

### What to record, and in what order

The full five-configuration set is thirteen clips five times over and runs
about an hour of real time. Unless there is a reason to want all of it, record
the three HUD-hidden pairings per configuration — those are the clips this gate
is scored on:

```bash
for c in baseline labels-only camera-only silhouettes-only everything; do
  for n in 1 4 7; do npm run review:clips -- --config=$c --only=$n; done
done
```

Show the configurations to a reviewer in a **randomised order**, not in the
table's order, and do not tell them which is which.

## What reviewers need to watch

Per design.md's "Human review gate" section:

1. One full bout for each of the **nine ordered home-style/opponent-style
   combinations** at `×1`. The roster only ever exposes three home fighters
   (Brutus/heavy, Aquila/fast, Nerva/technical) against three opponents
   (Drusus/fast, Cassius/technical, Magnus/heavy) three at a time (one
   series = one permutation across the three bout slots), so covering all
   nine ordered pairs requires either three full series playthroughs with
   different home-fighter-to-slot assignments, or driving individual bouts
   directly through `window.__GLADIATOR_TEST__.assign(fighterId, boutIndex)`
   / `.confirm()` in a `?seed=20260815&snapshot` session for ad-hoc review of
   a single pairing. `npm run review:clips` does the three-rotation version
   for you; the clip numbers below are the ones it writes. The nine pairs:

   | # | Home (style) | Opponent (style) |
   |---|---|---|
   | 1 | Brutus (heavy) | Drusus (fast) |
   | 2 | Brutus (heavy) | Cassius (technical) |
   | 3 | Brutus (heavy) | Magnus (heavy) |
   | 4 | Aquila (fast) | Drusus (fast) |
   | 5 | Aquila (fast) | Cassius (technical) |
   | 6 | Aquila (fast) | Magnus (heavy) |
   | 7 | Nerva (technical) | Drusus (fast) |
   | 8 | Nerva (technical) | Cassius (technical) |
   | 9 | Nerva (technical) | Magnus (heavy) |

2. One full three-bout series at `×2`.
3. The key-pose screenshot storyboard. Baselines are per-OS since `c7851c5`:
   `tests/__screenshots__/win32/` on Windows, `tests/__screenshots__/linux/`
   for the set CI compares against. Either set shows the same poses --
   `heavy-cleave.png`, `fast-burst.png`, `technical-parry.png`,
   `combat-outcomes.png`, `combat-safe-frame.png` -- and differs only in font
   rasterization and antialiasing.
4. A short recording with HP cards and the battle feed hidden.
5. Each audio cue in isolation (`?audioDebug=1`, the nine cue buttons) and
   cues during a complete bout.

At least **two** reviewers who did not implement the combat watch three
representative `×1` clips with HP cards/feed hidden; at least **one**
reviewer begins without being taught the style rules. Neither may be the person
who implemented the slice, and the person who scores the blinded stills below
must not be that person either.

## The two questions are run separately, with the HUD in different states

*(2026-08-23 readable-gladiator-types slice. Running them together is how the
2026-08-23 informal pass ended up unable to separate "I recognised the type"
from "I read the type off the card".)*

1. **The silhouette question — HUD and type labels HIDDEN.** Answered from the
   blinded stills below, not from the clips. Nothing in the material names a
   type; the sides are randomised; the answer key is in a different directory.
   Scored as a confusion matrix against a pre-committed bar.
2. **The winner-explanation question — HUD and type labels RESTORED.** Answered
   from the ordinary `×1` clips with the HP cards and feed visible. Explaining
   *why* someone won legitimately needs to know who is who and how much health
   they had; hiding the HUD for this question would test memory, not
   legibility.

Do question 1 first, and completely, before showing anyone a labelled clip.

## Blinded silhouette stills (the confusion matrix)

```bash
npm run review:stills            # add --config=<name> for the other four
```

Writes to `docs/reviews/clips/blinded-stills/<config>/`:

- **48 stills**: 8 per type per side (Murmillo / Retiarius / Hoplomachus ×
  home / away), two at each of four yaw angles, each cropped from a real bout
  at the shipped framing distance with the HUD and every DOM label hidden;
- each in **five renderings** — `monochrome/` (the scored set: hue removed,
  exposure lifted and contrast pushed, so only shape and value survive),
  `greyscale/`, and the three colour-vision simulations `protanopia/`,
  `deuteranopia/`, `tritanopia/`;
- a `README.md` with the reviewer instructions and the pass bar, and a blank
  `scoring-sheet.csv`.

**The answer key is not in that directory.** It is written to
`docs/reviews/clips/blinded-stills-answer-key/<config>/`, a sibling of
`blinded-stills/`, not a child. Give a reviewer the stills directory and there
is nothing in it — no file, no filename, no ordering — that tells them what
they are looking at: every image is `still-NN.png` and `NN` runs in a seeded
shuffle of the whole set, which randomises the two sides along with the three
types. Whoever hands the material out keeps the key and scores the sheet
afterwards; per the design spec, that person is not the implementer.

Every still is a **single** fighter: the recorder only keeps frames where the
fixed 280×320 crop window contains no part of the opponent, and the window is
the same size for every still so its dimensions cannot leak the kit's extent.

### Pass bar — pre-committed, and not adjustable afterwards

```text
type accuracy = correct type identifications / stills judged
pass = >= 80% correct overall AND >= 70% correct for each of the three types
```

Both numbers were fixed before any still was looked at, and are written into
the stills' own `README.md` at recording time so they travel with the material.
If a result misses either bar that is a finding about the fighters, not about
the bar. The design spec already names the next step for the known worst case
(Retiarius' trident versus Hoplomachus' spear): reach for the net and the
missing helmet, or re-open the type choice — explicitly **not** weaken the
test.

### Confusion-matrix procedure

1. Each reviewer fills in `scoring-sheet.csv` in file order, one of `Murmillo`,
   `Retiarius`, `Hoplomachus` per still. No blanks — guessing is data.
2. No going back to change an earlier answer after seeing a later still.
3. The scorer joins the sheet to `answer-key.csv` on the `still` column and
   tabulates a 3×3 matrix: rows = the true type, columns = the answer.
4. Overall accuracy is the trace divided by 48. Per-type accuracy is each row's
   diagonal divided by that row's total (16).
5. Record both the matrix and the two accuracies in the table below, per
   reviewer, per configuration.
6. The off-diagonal cells are the actionable part: which pair is confused, and
   in which direction.

### Known limitation of this material, recorded before anyone judges it

**Every still is a profile, and that is a property of the game, not of the
recorder.** The arena camera yaws to keep the fighters' own axis across the
frame, and a gladiator always faces his opponent (a disengaging fighter never
turns his back — the design spec's own constraint). Facing your opponent while
your opponent is across the frame means being seen from the side, always.
Measured over 918 clean candidate frames across all nine pairings at seed
20260815: every home fighter's presented facing fell between 60° and 120°, and
every away fighter's between 240° and 300°, with nothing outside those two
bands at all.

So the "four yaw angles" are four quartiles of each fighter's own deviation
from pure profile — a spread of tens of degrees, not a front/side/back sweep,
because a front or back view is unreachable in play. That is the right material
(it is what a player will actually see) but it narrows what the confusion
matrix can claim: it measures whether the three types are separable **in
profile at the shipped framing**, and nothing wider. The per-still deviation in
degrees is in the answer key if a later analysis wants to check whether
accuracy varies with it.

## Rubric for "a plausible winner explanation" — written before viewing

*(2026-08-23 readable-gladiator-types slice, per the design spec: "the rubric
for 'plausible explanation' is written before viewing, and answers are coded by
someone other than the implementer". Nothing below may be edited after the
first clip is watched.)*

After each of the three representative clips the reviewer answers, in their own
words and in one or two sentences: **"Why did that one win?"** The scorer codes
the answer **plausible** if it satisfies *both*:

- **(a) It names a cause the trace supports.** At least one of: a damage or HP
  advantage that the feed/HP cards actually showed; a reach or spacing
  advantage the fighters actually had; a repeated exchange that actually went
  one way; a stagger, a missed attack, or a declined defence that actually
  happened; a bout that actually ran to the time limit rather than to a defeat.
- **(b) It does not assert anything the trace contradicts.** Naming the wrong
  winner, an attack type nobody used, an outcome that did not occur, or a rule
  the game does not have all make it implausible regardless of (a).

Coded **implausible** if it satisfies neither, or if it is a non-answer
("dunno", "the red one just seemed better" with nothing behind it). Coded
**implausible** but recorded separately if it is *correct by the counter
triangle alone* ("Murmillo beats Retiarius") with no on-screen event cited:
that is reading the rules card, not the fight.

The scorer checks (a) and (b) against `traces/<clip>.json`, which is the
complete event log of exactly that bout. The reviewer writes their answer down
**before** the trace is opened.

## Exchange-labelling method

For every exchange in a reviewed clip, the reviewer records whether it was a
`probe` or `committed` action. For every **committed** exchange, they briefly
label:

- anticipation (what they expected to happen, before it resolves),
- defense/result (what actually happened -- a block, evade, parry, hit, or
  miss),
- recovery (what the fighters did immediately after),

and only then compare those labels against the real event trace --
`docs/reviews/clips/traces/<clip>.json`, the complete event log of exactly the
bout in that clip, written alongside it by `npm run review:clips`. Write the
labels down before opening the trace. `probe`
exchanges are reviewed separately for visible resolution/recovery and do
**not** count toward the committed-exchange anticipation metric -- the design
explicitly does not promise human-readable probe anticipation.

### Exact pass calculation

```text
exchange accuracy = fully correct exchange labels / reviewed committed exchanges
pass = each reviewer >= 75%, all three styles identified after one clip each,
       and a plausible winner explanation for all three representative clips
```

## Reviewer log

*(Every cell below is intentionally empty. Add one row per reviewer per
clip/bout reviewed. "Correct" counts are out of the exchange count in the
same row.)*

| Reviewer alias | Prior rules knowledge (yes/no) | Clip / style pairing | Exchange tag (probe / committed) | Exchange count | Anticipation correct | Defense/result correct | Recovery correct | `defense-declined` recognized (yes/no) | Style identified (yes/no) | Winner explanation plausible (yes/no) | Foot sliding noted (yes/no) | Weapon contact read clearly (yes/no) | Spacing rhythm read clearly (yes/no) | Camera framing stable (yes/no) | Repeated motion noticed (yes/no) | Reduced-motion mode checked (yes/no) | Sound weight appropriate (yes/no) | Failure notes |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| | | | | | | | | | | | | | | | | | | |
| | | | | | | | | | | | | | | | | | | |
| | | | | | | | | | | | | | | | | | | |
| | | | | | | | | | | | | | | | | | | |
| | | | | | | | | | | | | | | | | | | |
| | | | | | | | | | | | | | | | | | | |

## Per-reviewer exchange accuracy

*(Computed from the log above once filled in: `fully correct committed-
exchange labels / reviewed committed exchanges`, per reviewer, across all of
that reviewer's clips.)*

| Reviewer alias | Reviewed committed exchanges | Fully correct labels | Exchange accuracy | >= 75%? |
|---|---|---|---|---|
| | | | | |
| | | | | |

## Blinded silhouette confusion matrix

*(Every cell intentionally empty. One block per reviewer per configuration.
"True" is the row, "answered" is the column; 16 stills per row.)*

| Reviewer alias | Configuration | True type | Answered Murmillo | Answered Retiarius | Answered Hoplomachus | Row accuracy | >= 70%? |
|---|---|---|---|---|---|---|---|
| | | Murmillo | | | | | |
| | | Retiarius | | | | | |
| | | Hoplomachus | | | | | |
| | | Murmillo | | | | | |
| | | Retiarius | | | | | |
| | | Hoplomachus | | | | | |

| Reviewer alias | Configuration | Stills judged | Correct | Overall accuracy | >= 80%? |
|---|---|---|---|---|---|
| | | | | | |
| | | | | | |

### Attribution across the five configurations

*(Filled in once the matrices above exist. This is the table the whole
five-configuration exercise is for: it is what says which of the three changes
moved the number.)*

| Configuration | Overall accuracy | Delta vs `baseline` |
|---|---|---|
| `baseline` | | — |
| `labels-only` | | |
| `camera-only` | | |
| `silhouettes-only` | | |
| `everything` | | |

### Colour-vision and greyscale variants (not scored, recorded separately)

| Reviewer alias | Variant | Any type harder to pick out than in monochrome? | Notes |
|---|---|---|---|
| | `greyscale` | | |
| | `protanopia` | | |
| | `deuteranopia` | | |
| | `tritanopia` | | |

## Style identification (one clip each, all three styles)

| Reviewer alias | Heavy identified correctly | Fast identified correctly | Technical identified correctly |
|---|---|---|---|
| | | | |
| | | | |

## Winner explanation (three representative clips)

| Reviewer alias | Clip 1 plausible? | Clip 2 plausible? | Clip 3 plausible? |
|---|---|---|---|
| | | | |

## Other checks (not scored against the 75% threshold, recorded separately)

- `defense-declined` recognition flinch noticed and correctly attributed: _(not yet reviewed)_
- Foot sliding: _(not yet reviewed)_
- Weapon contact readability: _(not yet reviewed)_
- Spacing rhythm readability: _(not yet reviewed)_
- Camera framing stability: _(not yet reviewed)_
- Repeated-motion fatigue: _(not yet reviewed)_
- Reduced-motion mode (trail/flash removed, anticipation/contact/result preserved): _(not yet reviewed)_
- Sound weight/appropriateness: _(not yet reviewed)_

## 2026-08-23 informal single-reviewer pass — NOT PASSED

**This is not a completed gate run.** One reviewer (Andrey, the project owner)
watched the three HUD-hidden clips recorded by `npm run review:clips` at the
2026-08-23 build. The formal gate needs two reviewers, at least one without
prior rules knowledge, and a counted exchange-labelling accuracy; neither
happened, so every cell above stays empty and the gate stays open.

It is recorded because the outcome was negative, and a negative result from a
reviewer who *knows the rules* is strong evidence: **«стало лучше, но не могу
сказать, что весь бой читается»**. If the fight does not read for the person
who designed its rules, it does not read.

What the reviewer named, verbatim, in their own words:

1. **Naming.** «Хочется, чтобы типы были историческими — мурмилло,
   даймахерис и т.п.» The abstract `heavy` / `fast` / `technical` labels carry
   no expectation to check the movement against.
2. **Behaviour does not match the expectation the archetype sets.** «Тяжёлый
   должен медленнее передвигаться, пытаться сблизиться и ударить с близкого
   расстояния. С длинным оружием должен стараться держать дистанцию, быстрый —
   подойти, быстро ударить и рвать дистанцию. Стало лучше, но по-прежнему
   такого не вижу.» Note the axis this introduces, which the current three
   styles do not have: **weapon reach as a driver of spacing behaviour**.
3. **Silhouettes.** «Грешу ещё на слишком схематичных бойцов.» This is the
   third independent time the abstraction has been named as a suspect — after
   the 2026-08-19 developer verification (§3 below: fighters occupy 50–90 px,
   only coarse silhouette lean registers) and the 2026-08-22 bout-orders
   playtest («возможно, виновата очень условная графика»).

**Read:** the failure is not only rendering. Points 1 and 2 say the archetypes
do not *behave* the way their name promises, which no amount of visual polish
fixes — and point 2 names a missing simulation dimension (reach) rather than a
missing animation. See `docs/research/2026-08-23-order-legibility-references.md`
for the industry material gathered alongside this pass.

## Overall gate result

**Not yet run** as a formal two-reviewer pass; one informal single-reviewer
pass on 2026-08-23 returned a negative result (above). Per the pass
calculations above, this gate passes only when

- every reviewer's exchange accuracy is `>= 75%`,
- the blinded silhouette confusion matrix is `>= 80%` overall **and** `>= 70%`
  for each of the three types, in the `everything` configuration,
- all three types were identified after one clip each, and
- a plausible winner explanation (by the rubric above, coded by someone other
  than the implementer) was given for all three representative clips.

None of that has been evaluated yet --
this section will be filled in with the actual computed result, and the
anonymized counts/failure notes above, once real reviewers complete the
process described in design.md's "Human review gate" section.

If any threshold fails on a real review pass, the correct next step is to
return to the narrow responsible task, fix it, rerun the automated checks,
regenerate only the affected artifacts, and repeat this review -- not to
adjust the threshold or this document's methodology.

## 2026-08-19 legibility slice -- developer verification

**This is ordinary developer verification, not the two-reviewer human review
gate above.** No cell of the gate table was touched; the gate remains **not
yet run**. This section exists because the slice's three defects (camera
flip risk, stepped idle, damping lag) are motion artefacts that static
screenshot baselines structurally cannot catch, so `npm run review:clips`
was run and a set of numerically-targeted frame captures and per-tick
instrumented sweeps were used to check them by hand ahead of the real gate.

**Material produced (not committed -- gitignored under `docs/reviews/clips/`):**
`npm run review:clips` (9 pairing clips + 3 HUD-hidden + 1 x2 series, all with
traces), plus `docs/reviews/clips/motion-check/` -- 30+ PNG frames captured at
numerically-identified ticks via `window.__GLADIATOR_TEST__`, and per-tick
`{axisDeg, yawDeg}` sweep data (`*-samples.json`) for three full bouts at
seed `20260815`.

1. **Camera / mutual orientation.** Sampled the pair-axis angle
   (`atan2(dz,dx)` folded to (-90,90]) and camera yaw every tick, whole bout,
   for `nerva vs cassius` (technical vs technical) and `aquila vs magnus`
   (fast vs heavy): 74.3%/47.7% and 56.3%/34.6% of ticks beyond 30/60 deg
   respectively -- same order of magnitude as the brief's reference numbers
   (69.4%/52.5%, 58.6%/36.1%; a single bout vs. an aggregate, so not expected
   to match exactly). At mid-range angles (`tech-vs-tech-tick1092-mid-axis35deg.png`,
   `fast-vs-heavy-tick932-mid-axis41deg.png`) both fighters read as clearly
   separate, oriented toward each other, weapons presented at one another.
   At the axis peak (~90 deg, `tech-vs-tech-tick538-peak-axis90deg.png`,
   `fast-vs-heavy-tick1272-peak-axis90deg.png`) the two silhouettes crowd
   close together or partly overlap, but cross-checking against the battle
   feed confirms this coincides with genuine melee-range exchanges, not a
   framing failure -- the same pair at the same axis angle but wider spacing
   (`heavy-vs-heavy-tick769-peak-axis36deg.png`) stays clearly separated. No
   frame showed a fighter facing the viewer instead of the opponent.
2. **No camera flip.** Same whole-bout sweeps: largest per-tick camera yaw
   change observed was **0.585 deg** (`fast vs heavy`, tick 1799), 0.486 deg
   (`technical vs technical`, tick 429), 0.167 deg (`heavy vs heavy`, tick
   456) -- three orders of magnitude below anything that would read as a
   snap to the far side of the arena. Three-frame sequences straddling the
   axis peak (`tech-vs-tech-tick508-pre-peak-axis72deg.png` /
   `-tick538-peak-axis90deg.png` / `-tick568-post-peak-axis90deg.png`, and
   the equivalent `fast-vs-heavy` tick1242/1272/1302 set) are visually
   indistinguishable in framing from one another -- a smooth pan through the
   zone, not a jump.
3. **Rig directionality at the shipped framing distance -- open question,
   answered plainly: not legible.** At the camera distances the arena
   actually uses (`heavy-vs-heavy-neutral-idle-a-tick60-full-hires.png` and
   every other full-viewport, non-cropped capture in this set), fighters
   occupy roughly 50-90px of a 1280x820 frame. At that size the visor,
   breastplate and forward foot called out in Task 2 are **not** identifiable
   -- only a coarse silhouette lean and which side the weapon/shield arm is
   on register at a glance. Those specific cues only become visible after
   artificially cropping and 3x-supersampling a frame
   (`tech-vs-tech-mid-tick1092-closeup.png`,
   `fast-vs-heavy-mid-tick932-closeup.png`) -- confirming the geometry and
   materials exist and are correctly authored, not that a player watching the
   shipped view can read them. This matches the baseline-diff evidence cited
   in the brief (<0.15% of pixels moved) and should be treated as a real,
   open finding against Task 2's legibility goal, not a formality to check
   off.
4. **Idle and start-stop.** In `brutus vs magnus` (heavy vs heavy), the
   longest mutual-neutral (non-attacking) window ran ticks 1-136. Two frames
   six ticks apart inside it (`heavy-vs-heavy-neutral-idle-a-tick60-closeup.png`
   / `-idle-b-tick66-closeup.png`) show a visibly different shield/torso
   lean -- continuous sway, not a frozen pose. (An earlier pair of captures
   at ticks 181/187 turned out to fall inside post-attack recovery, not
   idle, and showed a larger, misleading arm-drop change; the neutral-window
   pair above is the correct idle-vs-idle comparison and is what the
   headline numbers above use.) No stepping/quantization was visible at
   this resolution, consistent with `sampleIdleLayer` driving a continuous
   sine of `(currentTick + alpha) / TICKS_PER_SECOND` rather than a
   tick-quantized lookup.
5. **Reduced motion.** With `reducedMotion: 'reduce'` emulated, the same
   neutral-window pair (`reduced-motion-neutral-idle-a-tick60.png` /
   `-idle-b-tick66.png`) is **pixel-identical** -- confirmed both visually
   and by source (`idleAmplitude` returns `0` whenever `reducedMotion` is
   true). Across the same bout's `heavy-cleave` exchange, windup
   (`reduced-motion-windup-tick150.png`, weapon raised overhead -- clear
   anticipation), contact (`reduced-motion-contact-tick171.png`, HP drop and
   weapons meeting, "Magnus deals 36" in the feed) and recovery
   (`reduced-motion-recovery-tick190.png`) all stayed readable.
6. **Decision panel against a real bout.** Ran `aquila vs drusus` (fast vs
   fast) to tick 1600 with `?seed=20260815&debugDecisions=1` and read the
   rendered `[data-testid="decision-panel-row"]` rows against the real event
   trace. Exact match: the panel's weighted record at `t1503`
   (`"t1503 away.drusus: roll 0.526 -> fast-burst-lunge [circle-left 21%,
   circle-right 21%, retreat 7%, fast-burst-lunge 52%]"`) lines up with the
   real `action-started` event at tick 1503 for `away.drusus` /
   `fast-burst-lunge`; the listed candidates (circle-left/circle-right/
   retreat/fast-burst-lunge) are exactly the locomotion/attack options a
   fast archetype has live at range. After that lunge resolves
   (`damage-dealt` at 1521, `fighter-staggered` at 1521), the panel logs
   `forced disengage (no roll)` starting at `t1545`, matching the real
   `movement-intent-changed` event (`burst-in` -> `disengage`) at the same
   tick to the tick -- i.e. immediately after `fast-burst-lunge`'s
   18-windup/3-impact/20-recovery finishes. The trace explains what
   happened; nothing in the panel was unaccounted for.

**Net assessment:** points 1, 2, 4, 5 and 6 check out against the numbers
above -- no camera flip observed anywhere in three full-bout sweeps, idle
reads as alive and is fully suppressed under reduced motion, and the
decision panel's records are traceable one-for-one against real encounter
events. Point 3 is the one open item this task was designed to surface: rig
directionality cues exist and are correctly built, but are not legible at
the arena's actual shipped framing distance -- that belongs back with
whichever task owns Task 2's cue sizing/placement, not fixed here.
