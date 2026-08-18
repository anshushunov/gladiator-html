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

## Overall gate result

**Not yet run.** Per the pass calculation above, this gate passes only when
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
