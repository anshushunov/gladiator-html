# Readable Gladiator Types — Design

**Status:** revised 2026-08-23 after external review (codex `gpt-5.6-sol`);
awaiting spec review.

**Date:** 2026-08-23

**Revision note.** The first draft was reviewed externally and three of its
load-bearing claims did not survive: the camera premise was wrong about its own
formula, the no-simulation-change invariant named the wrong directory, and the
silhouette work was described as parameter re-authoring when the rig cannot
express it. The third gladiator type was also changed. Each is corrected below
and marked **[revised]** so the change is auditable.

## Terminology

- **Type** — the historical gladiator category a fighter belongs to:
  *murmillo*, *hoplomachus*, *retiarius*. Player-facing identity.
- **Archetype** — the existing internal mechanics id: `heavy`, `fast`,
  `technical`. Never shown to the player after this slice.
- **Tactical band** — the range of pair separations a duel actually spends its
  time in, from the closest legal contact (`0.9`) to the longest authored
  attack reach (`3.1`), plus both fighters' equipment radii. Expressed in
  *group extent*, the quantity `extentToDistance` consumes.
- **Framing distance** — `ArenaCamera`'s camera-to-look-target distance,
  currently `clamp(8.5 + 0.8 × extent, 11, 18)`.

## Context

Three reviews have named combat legibility as the defect.

1. **2026-08-19, developer verification** (`docs/reviews/2026-08-16-readable-deep-combat-human-review.md`,
   §3): at the shipped framing, fighters occupy **50–90 px of a 1280×820
   frame**, and at that size the visor, breastplate and forward foot "are
   **not** identifiable — only a coarse silhouette lean and which side the
   weapon/shield arm is on register at a glance". Recorded then as "a real,
   open finding, not a formality".
2. **2026-08-22, bout-orders playtest**: the orders gate failed on visibility —
   «стили не сильно различимы, возможно виновата очень условная графика».
3. **2026-08-23, informal legibility pass**: «стало лучше, но не могу сказать,
   что весь бой читается», with a precise list — historical type names, and
   behaviour matching what the name promises.

**The decisive fact is that the described behaviour is already implemented:**

| archetype | forward | backward | burst | `preferredRange` | retreat weight |
|---|---|---|---|---|---|
| `heavy` | 1.4 | 0.9 | 1.8 | 1.2–1.7 | **0** |
| `fast` | 2.4 | 2.7 | **4.0** | **2.4–3.0** | 8 |
| `technical` | 1.7 | 2.0 | 2.4 | 2.1–2.8 (attacks reach 3.1) | `hold-range` 12 + `backstep` 12 |

`heavy` cannot meaningfully retreat; `fast` breaks off at more than twice
`heavy`'s burst speed **and holds the longest preferred range of the three**;
`technical` fights at long range with the longest reach. These differences are
large and still did not read.

**Therefore the bottleneck is perception, not simulation** — which also
explains the bout-orders failure retroactively: orders *modulate* these
differences, and a modulation of an imperceptible difference is imperceptible.

## Product hypothesis

A viewer will read a bout — identify each fighter's type, tell probing from
committed exchanges, and explain who won and why — when each type is named for
something they already have expectations about, is drawn so its equipment is
identifiable at the size it is actually rendered, and is framed closely enough
that the spacing differences between types occupy real screen distance.

## The invariant: no behaviour change **[revised]**

The first draft said "no file under `src/simulation/` changes". That is the
wrong boundary: every speed, range, weight and action definition lives in
**`src/content/combatStyles.ts`**, which is not in that directory. The
invariant is restated as an explicit allowlist.

**No file in this set may change:**

- `src/simulation/**`
- `src/content/combatStyles.ts`, `src/content/mvpSeries.ts`,
  `src/content/season.ts`
- any construction of `BattleConfig` / `EncounterConfig` inputs

Archetype ids (`heavy`, `fast`, `technical`) and action ids (`heavy-cleave`
and siblings) stay as the internal mechanics vocabulary; the historical names
are presentation.

**Why the ids stay:** `battle.ts`'s trace hash folds `JSON.stringify(event)`
for every event, and events carry action ids, so renaming them would change
`dc635911`.

**Why the invariant matters methodologically:** the reviewer's described
behaviour is already implemented, so changing behaviour and perception together
would destroy attribution. This slice asks one question — *if the same
behaviour is presented differently, does it become readable?* A pass means
perception was the bottleneck; a failure moves the fault to the combat rules,
which becomes the next slice with clean evidence.

**Proving it, not asserting it [revised].** The external review correctly noted
that a single event-fold hash is not a general proof of behavioural
equivalence, and that `ArenaView` receives live references to
`FighterCombatState` which TypeScript does not freeze at runtime. Therefore:

- the existing event trace hash is kept **and** joined by a canonical
  **full-state** hash over all nine pairings at the fixed seed;
- a test serialises the complete battle state before and after
  `ArenaView.sync`/render and asserts byte equality;
- snapshots handed to presentation are deep-frozen in dev and test builds;
- CI asserts the allowlist above — a diff touching those paths fails the slice.

Screenshot baselines are **not** covered by the invariant: silhouettes and
framing both change, so nearly every baseline is regenerated deliberately on
both platforms. Frozen are the hashes and tick numbers, not the pixels.

## The three types **[revised: retiarius replaces dimachaerus]**

One type per archetype. The counter triangle, balance cohorts and challenge
scaling are untouched because the mechanics behind them are untouched.

The right-hand column is **a gameplay interpretation suggested by the
equipment, not an attested ancient technique.** Equipment is the historical
claim; behaviour is our reading of it.

| Type | Archetype | Equipment (historical claim) | Interpretation the name suggests | Already true in the content |
|---|---|---|---|---|
| **Murmillo** | `heavy` | Large **curved** rectangular scutum; gladius; broad-brimmed helmet with face guard; *manica* on the right arm; one short *ocrea* on the left leg | Closes in, works behind the shield, strikes short | Range 1.2–1.7, retreat weight 0, slowest at 1.4 |
| **Hoplomachus** | `technical` | Thrusting spear; small round *parma*; high padded greaves on both legs; broad-brimmed helmet; secondary short blade | Holds long range, thrusts from outside | Range 2.1–2.8, attacks reach 3.1, `hold-range` + `backstep` 12 each |
| **Retiarius** | `fast` | Net; trident; **no shield, no helmet**; *manica* on the left arm with a *galerus* shoulder guard | Fights at reach, gives ground, closes only to strike | Range 2.4–3.0 (longest), backward 2.7, burst 4.0 |

**Why retiarius rather than dimachaerus.** Dimachaerus is thinly attested — the
name and epigraphy support two blades, but blade form, armour, typical opponent
and the modern "light acrobat" reading are reconstruction. It also promises a
style the mechanics do not show: the engine has one active weapon stream, so a
second blade would be inert scenery. Retiarius is far better documented, its
lack of shield and helmet is the attestation rather than an inference, and it
fits the archetype's actual numbers better — `fast` holds the *longest*
preferred range and retreats most, which is reach-and-give-ground, not
in-and-out brawling.

**Constraint this creates:** trident and spear are both long polearms, so
hoplomachus and retiarius must be separated by other means — the net, the
absent helmet and shield, and the galerus asymmetry. This is called out again
under silhouette below because it is the main new legibility risk.

**Honesty about the triangle.** Historical pairings were asymmetric and
curated (murmillo vs thraex or hoplomachus; retiarius vs secutor). A universal
rock-paper-scissors with mirrors is a game model, not a taxonomy. It is
presented to the player as the school's own scheme, with one onboarding line
saying real editors matched types in asymmetric pairs.

## Silhouette legibility at the rendered size **[revised]**

The first draft claimed "equipment silhouette parameters are re-authored rather
than a new system being introduced". **That is false.** The builder always
creates one `BoxGeometry` weapon and a cylindrical shield from
`shieldRadius`/`shieldThickness`; `StyleSpec` has no notion of shield shape,
shield absence, or an off-hand weapon. The rig must be extended.

**Presentation-only rig work:**

- `StyleSpec.equipment` gains shield **kind** (rectangular scutum / round parma
  / none), width, height and curvature, plus an optional off-hand prop (the
  net).
- Each weapon mesh is oriented along the actual `hand → weaponTip` segment
  rather than assumed to run along local Y — today the spear's mesh extends
  along Y while its tip anchor is displaced mostly along Z, so "length is right,
  only width is wrong" is not established by the code.
- `horizontalEquipmentRadius` is computed from the real rest/guard AABB of
  every prop, since it feeds the camera (see below).

**Cue hierarchy [revised].** Silhouette stays primary, but it is not the only
channel, and *absence* of a shield is a weak positive cue at 50–90 px — it
requires the viewer to already know what the other types look like. Each type
therefore carries:

1. a **large positive prop** — scutum slab, spear line, **net** (the retiarius'
   positive cue; "no shield" is not one);
2. a **value block** — large light/dark masses that survive downscaling;
3. a **type palette** kept distinct from the existing home/away colour cue;
4. a **motion signature** — the gait and idle already differ per archetype and
   are the one cue that survives at any size.

Body proportions stay as they are; the complaint was identity, not anatomy.

## Camera **[revised — the first draft's premise was wrong]**

The first draft asserted that the camera "normalizes the very quantity that
distinguishes the types" and proposed introducing a dead band. Reading the code
refutes both halves:

`extentToDistance` is `clamp(8.5 + 0.8 × extent, 11, 18)`. The lower clamp
binds for every extent below **3.125**, so across the close half of the
tactical band the framing distance **is already constant**, and across the far
half it varies by roughly a tenth. There is no large normalisation to remove,
and a dead band largely already exists.

**The real lever is that 11 is too far**, which is why fighters measure 50–90
px. The redesign is therefore:

- **Lower the minimum framing distance** so the fight is rendered larger. This
  is the change that addresses the measured defect.
- **Keep a flat region across the tactical band** — now stated as an explicit
  new piecewise function with named constants rather than "resume the existing
  mapping", because the old line at the band's upper edge already sits above
  any usable flat value and cannot be joined to it continuously.
- The junction is **C1**, via a short smoothstep, not merely continuous.
- **Hysteresis at the band edge** — either separate enter/exit thresholds, or a
  demonstration that the existing 12% framing dead zone
  (`DISTANCE_DEAD_ZONE_FRACTION`) plus the 1.25 s damping already suppress
  oscillation. Chattering across the edge is the known failure mode of this
  technique.

The spec fixes the *shape*; the constants — band edges, flat distance, slope
beyond it, new clamp — are measured during implementation from the per-tick
extent samples the 2026-08-19 verification already showed how to collect, and
written into the plan with at least three worked examples: inside the band, at
the junction, and at the far clamp.

The look dead zone, yaw dead zone and damping constants are unchanged.

## Player-facing acceptance

1. No screen shows `Heavy`, `Fast` or `Technical`; every fighter is named by
   type. Verified against an enumerated list of every UI surface.
2. Each type is identifiable from its silhouette alone at the shipped framing.
   Measured, not asserted: see the confusion-matrix test below.
3. A fighter closing to strike and a fighter giving ground are visibly
   different movements on screen. Measured as screen-space separation change
   and as the camera-vs-world attenuation ratio.
4. The counter triangle is stated in type names, with the one-line note that it
   is the school's scheme rather than history.
5. Nothing about how any fighter behaves has changed.

## Automated verification **[revised]**

- **Camera, statically:** flat across the band, monotonic beyond it, C1 at the
  junction, clamp respected at the far end.
- **Camera, dynamically:** a slow sweep out and back, and a sinusoidal
  oscillation around the band edge, with bounded overshoot, bounded zoom rate
  and a bounded number of direction changes. Static unit tests cannot catch a
  visible lurch; one such trace is also watched in real time.
- **Fighter scale and framing safety:** the **minimum acceptable on-screen
  fighter height is fixed before implementation**, not read off the result — a
  floor derived from the implementation cannot fail. Both fighters' full AABBs
  (crest, spear, trident, net, shields included) are projected to pixels and
  checked against a safe area on every tick of all nine pairing traces, at
  viewport widths **820, 1024 and 1280**. Permitted arena-edge visibility and
  maximum decoration cropping are stated numbers.
- **Silhouette:** reviewers are shown randomised, unlabelled **monochrome**
  stills across all types, both sides and several yaw angles; the pass
  threshold is a confusion-matrix bar set in advance. Also checked in
  greyscale/value and colour-blind variants.
- **Naming:** an assertion over the enumerated UI surfaces.
- **The invariant:** the allowlist check, the event hash, the full-state hash
  across all nine pairings, and the before/after render equality test.
- **Baselines:** regenerated deliberately on both platforms, each reviewed by
  eye.

## Human review gate **[revised staging]**

The gate in `docs/reviews/2026-08-16-readable-deep-combat-human-review.md` is
re-run with **two reviewers, at least one without prior rules knowledge**, at
the unchanged thresholds: exchange accuracy ≥ 75%, all three types identified
after one clip each, plausible winner explanation for all three clips.

**Attribution.** The first draft proposed clips from two commits. That does not
work: `horizontalEquipmentRadius` is derived from equipment and feeds the
camera, so a "camera-only" commit runs a *different* camera than the final
build. Instead, one frozen trace is recorded five ways behind **runtime
toggles**: baseline; labels only; camera only **with the final equipment
radii**; silhouettes only; everything.

For the silhouette question the HUD and type labels are hidden and sides are
randomised — otherwise "identified after one clip" is satisfied by reading
text. The HUD returns for the winner-explanation question. The rubric for
"plausible explanation" is written before viewing, and answers are coded by
someone other than the implementer.

## Non-goals

- Any behaviour change: weights, speeds, ranges, actions, archetype ids, action
  ids, counter triangle, balance cohorts, challenge scaling.
- A fourth type.
- Bout orders and temperaments — that slice is complete; its gate stays failed
  until this one lands, and is then re-tested, not re-designed.
- Progression, economy, hiring.
- Body-proportion or animation authoring beyond silhouette identity — except
  the one constraint below.
- Sound.

## Constraints carried from the review

- **A disengaging fighter never turns their back.** Giving ground is done
  facing the opponent; a turn-and-run animation would contradict the one clear
  behavioural norm the sources do support.
- **Equipment claims carry a confidence level.** The plan includes a short
  equipment bible: shape, curvature, helmet, arm and leg protection, secondary
  weapon, and how well attested each element is. Contested details (for
  instance a specific hoplomachus crest figure) are not asserted; the
  unmistakable elements — broad brim, high greaves, curved scutum — are.

## Risks and open questions

- **Trident versus spear.** Two long polearms on different types is the main
  new legibility risk this revision introduces. If the confusion-matrix test
  fails specifically between hoplomachus and retiarius, the net and the missing
  helmet are the levers, and the fallback is to re-open the type choice rather
  than to weaken the test.
- **Lowering the minimum framing distance trades arena coverage.** If the band
  edge reads badly in motion, the fallback is a narrower flat region, not a
  return to the old mapping.
- **The rig may not carry identity at this scale at all.** If the gate fails
  with the camera verified good, the honest conclusion is that the procedural
  rig is the limit, and the next slice is about the rig rather than its
  parameters.
- **Open:** whether internal archetype ids should eventually follow the type
  names. Not here — it breaks `dc635911` for no player-facing gain.
