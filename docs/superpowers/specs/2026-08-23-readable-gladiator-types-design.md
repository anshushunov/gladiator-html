# Readable Gladiator Types — Design

**Status:** approved in brainstorming session 2026-08-23; awaiting spec review.

**Date:** 2026-08-23

## Terminology

- **Type** — the historical gladiator category a fighter belongs to:
  *murmillo*, *hoplomachus*, *dimachaerus*. Player-facing identity.
- **Archetype** — the existing internal mechanics id: `heavy`, `fast`,
  `technical`. Never shown to the player after this slice.
- **Tactical band** — the range of pair separations a duel actually spends its
  time in, from the closest legal contact (`0.9`) to the longest authored
  attack reach (`3.1`), plus both fighters' equipment radii.
- **Framing distance** — `ArenaCamera`'s camera-to-look-target distance,
  currently derived from the pair's on-screen extent and clamped to `11..18`.

## Context

Three separate reviews have now named combat legibility as the defect, and the
third one made the diagnosis unavoidable.

1. **2026-08-19, developer verification** (`docs/reviews/2026-08-16-readable-deep-combat-human-review.md`,
   §3): at the camera distances the arena actually uses, fighters occupy
   **50–90 px of a 1280×820 frame**. At that size the visor, breastplate and
   forward foot "are **not** identifiable — only a coarse silhouette lean and
   which side the weapon/shield arm is on register at a glance". Recorded then
   as "a real, open finding, not a formality".
2. **2026-08-22, bout-orders playtest** (`docs/reviews/2026-08-22-bout-orders-playtest.md`):
   the orders gate failed on visibility — «стили не сильно различимы, возможно
   виновата очень условная графика».
3. **2026-08-23, informal legibility pass** (same file as 1): «стало лучше, но
   не могу сказать, что весь бой читается», plus a precise list — the types
   should be historical, and the behaviour should match what the name promises:
   the heavy one slower and closing to strike from close range, the long-weapon
   one holding distance, the fast one closing quickly, striking and breaking
   off.

**The decisive fact is that the third reviewer described behaviour that is
already implemented, and implemented strongly:**

| archetype | forward | backward | burst | `preferredRange` | retreat weight |
|---|---|---|---|---|---|
| `heavy` | 1.4 | 0.9 | 1.8 | 1.2–1.7 | **0** |
| `fast` | 2.4 | 2.7 | **4.0** | 2.4–3.0 | 8 |
| `technical` | 1.7 | 2.0 | 2.4 | 2.1–2.8 (attacks reach 3.1) | `hold-range` 12 + `backstep` 12 |

`heavy` cannot meaningfully retreat at all; `fast` breaks off at more than
twice `heavy`'s burst speed; `technical` holds the longest range with the
longest reach. These are the three descriptions the reviewer gave, already in
the content — and they still did not read.

**Therefore the bottleneck is perception, not simulation.** This also explains
the bout-orders failure retroactively: orders *modulate* these differences, and
we asked a human to perceive a modulation of differences that are themselves
imperceptible. Any further mechanical depth layered on this base inherits the
same defect.

Two mechanisms are implicated, and both are perceptual:

- **The camera normalizes the very quantity that distinguishes the types.**
  `ArenaCamera` maps the pair's extent onto framing distance across the whole
  range. A fighter holding 3.0 units and one closing to 1.5 are therefore
  framed to occupy a similar share of the screen. The system that keeps the
  fight in frame is erasing spacing.
- **The silhouettes carry no identity at the size they are drawn.** The
  equipment parameters exist per archetype (`heavy` shield radius `0.55` /
  weapon `0.55`; `fast` `0.28` / `0.50`; `technical` `0.40` / weapon `1.30` at
  `0.045` wide), but at a fighter height of 50–90 px a weapon `0.045` units
  wide is roughly two pixels. The reach that exists mechanically is drawn too
  thin to see.

## Product hypothesis

A viewer will read a bout — identify each fighter's type, tell probing from
committed exchanges, and explain who won and why — when each type is named for
something they already have expectations about, is drawn so that its equipment
is identifiable at the size it is actually rendered, and when the camera stops
compensating for the spacing that distinguishes the types.

## The invariant: the simulation does not change

**No file under `src/simulation/` changes. No weight, speed, range, action
definition, archetype id or action id is touched.** `heavy`, `fast`,
`technical`, `heavy-cleave` and their siblings remain the internal mechanics
vocabulary; the historical names are content and presentation.

This is load-bearing for two reasons.

**Technically:** `battle.ts`'s trace hash folds `JSON.stringify(event)` for
every emitted event, and events carry action ids. Renaming `heavy-cleave` to
`murmillo-cleave` would change `dc635911`. Keeping the ids keeps every frozen
fixture — the trace hash, `encounterCapacity`'s hash, and the key-pose ticks
253/817/958/2106 — passing **without any edit**, which is what proves this
slice is purely perceptual.

**Methodologically:** the reviewer's described behaviour is already
implemented. Changing behaviour and perception in the same slice would destroy
our ability to attribute the result. This slice asks exactly one question: *if
the same behaviour is presented differently, does it become readable?* A pass
means perception was the bottleneck. A failure means the fault is in the combat
rules themselves — and that becomes the next slice, entered with clean
evidence instead of a third round of guessing.

Screenshot baselines are **not** part of this invariant: silhouettes and
framing both change, so nearly every baseline is regenerated deliberately, on
both platforms. What is frozen is the trace hash and the tick numbers, not the
pixels.

## The three types

One type per archetype, one to one. The counter triangle, the balance cohorts
and the challenge scaling are untouched because the mechanics behind them are
untouched.

| Type | Archetype | Equipment | What the name promises | Already true in the content |
|---|---|---|---|---|
| **Murmillo** | `heavy` | Large rectangular *scutum*, short *gladius*, crested helmet | Closes in, works behind the shield, strikes short | Range 1.2–1.7, retreat weight 0, slowest at 1.4 |
| **Hoplomachus** | `technical` | Thrusting spear, small round shield, greaves | Holds long range, thrusts from outside | Range 2.1–2.8, attacks reach 3.1, `hold-range` + `backstep` 12 each |
| **Dimachaerus** | `fast` | Two blades, no shield, light armour | Darts in, strikes, breaks off | Burst 4.0, backward 2.7, range 2.4–3.0 |

Retiarius is deliberately excluded: net-and-trident is a long-range identity,
and that slot is taken by the hoplomachus. Adding a fourth type would mean new
behaviour, new balance and a rebuilt counter triangle — out of scope.

### Where the names appear

Everywhere `heavy` / `fast` / `technical` is currently shown: roster and
opponent cards, the planning matchup rows, the season board's challenge cards,
the battle HUD, bout summaries and season records, and the counter-triangle
line on the planning screen (`HEAVY → FAST → TECHNICAL → HEAVY` becomes the
type names). The mapping lives in one presentation module, in the same shape as
`dispositionLabels.ts`.

## Silhouette legibility at the rendered size

The target is the one channel measured to still work at 50–90 px: **coarse
outline**. Each type must be identifiable from its silhouette alone.

- **Murmillo** — the scutum reads as a solid rectangular slab in profile.
  Rectangular, not the current disc: shape is the cheapest silhouette
  difference available. Crested helmet raises and breaks the head outline.
- **Hoplomachus** — the spear must read as a long line projecting well beyond
  the body. Its length (`1.30`) is already right; its width (`0.045`) is not,
  because it lands at roughly two pixels. Weapon width and outline treatment
  are re-authored until the spear is unmistakable at the shipped framing.
- **Dimachaerus** — two short blades and the **absence of a shield**. Absence
  is a strong silhouette cue and costs nothing to draw.

The existing outline system (`OUTLINE_COLOR`, `RIM_SCALE`) is the mechanism;
equipment silhouette parameters are re-authored rather than a new system being
introduced. Body proportions stay as they are — the reviewer's complaint was
about identity, not anatomy.

## Camera: a dead band across the tactical range

`extentToDistance` becomes piecewise:

- **Inside the tactical band**, framing distance is **constant**. The camera
  stops reacting to the pair closing or separating, so closing and breaking off
  become visible screen movement for the first time.
- **Beyond the band**, the existing mapping resumes and widens toward the
  current maximum, so a fighter disengaging across the arena is still framed.
- The junction is continuous — no visible step as the pair crosses the band
  edge.

The band is defined in the units `extentToDistance` already consumes — group
extent, not raw separation — and its edges are **measured from real bouts**
rather than assumed: the separations above plus the largest equipment radius
give a starting estimate, and the implementation confirms them against the
per-tick extent samples the 2026-08-19 verification already showed how to
collect.

Because the flat distance no longer has to accommodate the arena's maximum
separation, it is chosen **closer than the current minimum of 11**, which makes
fighters larger exactly where the fight happens. The rule fixes it without
guesswork: **the flat distance is the smallest that still frames the whole
tactical band with the existing 10% equipment margin.** The on-screen fighter
height that falls out of that distance is then measured once and asserted as a
floor, so the number in the test is derived rather than invented — and directly
comparable with the 50–90 px measured on 2026-08-19.

The look dead zone, the yaw dead zone, the 1.25 s distance damping and the 10%
equipment margin are unchanged.

## Player-facing acceptance

1. No screen shows `Heavy`, `Fast` or `Technical` to the player; every fighter
   is named by type.
2. Each type is identifiable from its silhouette alone at the shipped framing,
   without zooming or cropping.
3. During a bout, a fighter closing to strike and a fighter breaking off are
   visibly different movements on screen — the camera does not absorb them.
4. The counter triangle is stated in type names on the planning screen.
5. Nothing about how any fighter behaves has changed.

## Automated verification

- **Camera:** unit tests for the piecewise mapping — constant distance across
  the tactical band, monotonic widening beyond it, continuity at the junction,
  and the existing clamp still respected at the far end.
- **Fighter scale:** an asserted minimum on-screen fighter height inside the
  tactical band, measured the way the 2026-08-19 verification measured it
  (instrumented capture at numerically identified ticks), so the two numbers
  are comparable. The asserted floor is whatever the derived flat distance
  yields, recorded from that measurement — not a target picked in advance.
- **Naming:** an assertion that no player-facing surface renders the archetype
  ids.
- **The invariant:** `npm test` passes with **no edit to any simulation test** —
  `battle.test.ts`'s `dc635911`, the capacity hash, the balance cohorts and the
  golden season all unchanged. This is the proof that the slice is perceptual.
- **Baselines:** regenerated deliberately on both platforms, each reviewed by
  eye before commit.

## Human review gate

The existing gate in `docs/reviews/2026-08-16-readable-deep-combat-human-review.md`
is re-run — **two reviewers, at least one without prior rules knowledge**, so
that it closes formally this time rather than as a single informal pass. The
thresholds are unchanged: exchange-labelling accuracy ≥ 75% per reviewer, all
three types identified after one clip each, and a plausible winner explanation
for all three representative clips.

**Attribution staging.** `npm run review:clips` is run twice: once at the
commit where the camera change is complete and the silhouettes are not, and
again at the end. If the gate fails, the two clip sets say whether framing or
silhouette was insufficient. This exists because the slice deliberately
combines two changes; without staged material a failure would be
uninterpretable.

## Non-goals

- Any simulation change: weights, speeds, ranges, actions, archetype ids,
  action ids, the counter triangle, balance cohorts, challenge scaling.
- A fourth gladiator type; retiarius, thraex, secutor and the rest.
- Bout orders and temperaments — that slice is complete and its own gate stays
  failed until this one lands; it is re-tested afterwards, not re-designed.
- Progression, economy, hiring.
- Body-proportion or animation authoring beyond what silhouette identity needs.
- Sound.

## Risks and open questions

- **The flat framing distance is a trade-off against arena coverage.** If the
  band-edge behaviour turns out to be visually jarring in motion — a risk
  static tests cannot catch — the fallback is a narrower flat region rather
  than a return to full extent mapping.
- **Two changes, one slice.** Accepted deliberately by the project owner; the
  staged clip recording above is the mitigation.
- **The silhouette fix may not be sufficient at any framing.** If the gate
  fails with the camera change verified good, the honest conclusion is that
  the procedural rig cannot carry identity at this scale, and the next slice is
  about the rig rather than about parameters.
- **Open:** whether the internal archetype ids should eventually follow the
  type names. Not in this slice — it would break `dc635911` for no player-facing
  gain — but the permanent split between mechanics vocabulary and fiction
  vocabulary is a maintenance cost worth revisiting if the ids ever churn for
  another reason.
