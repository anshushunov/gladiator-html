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

What *is* prepared: `npm run review:clips` records the whole material set from
a fixed seed in one command (see below), so the two reviewers watch identical
bouts and neither has to assemble anything by hand.

## Producing the material

```bash
npm run review:clips
```

Records everything below into `docs/reviews/clips/` (gitignored -- it is review
material, not an artifact) from a fixed seed, and writes a `README.md` there
listing every clip with its pairing, its pre-roll offset, and the event trace
behind it:

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
`docs/reviews/clips/README.md` for the console recipe.

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
reviewer begins without being taught the style rules.

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
pass on 2026-08-23 returned a negative result (above). Per the pass calculation
above, this gate passes only when
every reviewer's exchange accuracy is `>= 75%`, all three styles were
identified after one clip each, and a plausible winner explanation was given
for all three representative clips. None of that has been evaluated yet --
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
