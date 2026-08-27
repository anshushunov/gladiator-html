#!/usr/bin/env bash
# scripts/check-allowlist.sh — the paths this slice may not touch.
#
# RE-SCOPED for the retiarius-reach slice. The list is per-slice by
# construction (the readable-types slice's own header said so, and its final
# review recorded that "a slice that legitimately edits `src/simulation/**` --
# including this one -- must widen or remove that step before its first PR").
# What changed is not just the contents but the SHAPE, so the reason is worth
# stating rather than leaving to be inferred from the regex.
#
# The readable-types slice was presentational and changed no behaviour. Its
# list was therefore an ALLOWLIST whose job was to keep the diff out of
# `src/simulation/**`, `src/content/**` and `src/style.css` -- the files that
# could have made the "same behaviour, presented differently" claim untrue.
#
# This slice is the exact inverse: it changes behaviour on purpose, and every
# path that list protected is a path this one must edit. An allowlist rebuilt
# around that would have to admit nearly the whole tree, which is theatre --
# a gate that forbids nothing reads as a gate that passed.
#
# So the shape flips to a DENYLIST, protecting the two risks this slice
# actually carries. An earlier revision named only three files and was found by
# external review to leave both holes below open; it is widened here.
#
# GROUP 1 -- PRESENTATION SOURCE. This slice's premise is that BEHAVIOUR
# separates the trident from the spear even while the silhouette does not (the
# fork resolves at ~2x the shipped framing). Anything that changes what is
# drawn, how it is posed, or how it is framed would answer the same question a
# second way and make the two answers inseparable. That includes the camera,
# whose constants were swept against 46,647 recorded ticks and frozen: giving
# the retiarius real reach widens the separations it sees, and "the existing
# flat band absorbs that with nothing retuned" is a claim worth testing rather
# than quietly fixing. Also `src/style.css`, since growing the 730x518 arena
# canvas is the largest remaining legibility lever and belongs to its own
# slice -- a bout that reads better because the canvas grew would say nothing
# about reach.
#
# Playwright baselines under `tests/__screenshots__/**` are deliberately NOT in
# this group. They are outputs of the change, not levers on it, and this slice
# is expected to regenerate them.
#
# GROUP 2 -- ACCEPTANCE LOGIC. The first revision forbade three presentation
# files and left the balance suites open, so an implementation could have
# weakened the very criteria it was meant to satisfy. design.md is explicit
# that cohort seeds, bands and metric formulas are test data that may not be
# changed during tuning; this is that rule made enforceable. Each file below was
# checked to contain bands and method ONLY, with no frozen literal this slice
# must re-baseline, so forbidding it outright costs nothing.
#
# NOW IN GROUP 2, having been open in phase 1:
# `src/simulation/encounterCapacity.test.ts`, `src/simulation/series.test.ts`,
# `src/simulation/seasonBalance.test.ts`, `src/presentation/ArenaCamera.test.ts`
# and `scripts/measure-reach.ts`. Each used to mix frozen literals that MUST
# move (the `dbe77c5e` fixture hash; the per-bout lineup hashes and the `1-2`
# golden score; `GOLDEN_OUTCOMES`/`GOLDEN_SCORE`/`GOLDEN_DELTAS`; the recorded
# camera traces) with acceptance logic that must not (the capacity suite's
# >=50 action instances, >=50 contact resolutions, >=1000 damage, >=20 damaged
# combatants, its candidate-check bounds; `expectSmoothFraming`'s reversal,
# zoom-rate, clamp and distance bounds). The preparatory PR split every one of
# those literals into `src/testSupport/frozenFixtures/`, so the four test files
# now hold criteria ONLY and can be forbidden without forbidding a file whose
# contents must move.
#
# `src/testSupport/frozenFixtures/**` stays WRITABLE. That is the whole point
# of the split: the values a behaviour change is allowed to move live there,
# each tagged with its class, governed by the re-baseline rule instead of by
# this gate.
#
# The gate's own file and `.github/` stay reachable, for the same reason the
# previous list admitted them: a gate that cannot maintain itself cannot be
# enforced at all. This re-scope lands as its own commit BEFORE the content
# change, so the feature diff is judged by a boundary it did not write.
set -euo pipefail
BASE="${1:?base sha required}"
# TWO PHASES, because a single list cannot be both complete and satisfiable.
# THE TRANSITION IS COMPLETE; this is phase 2, and the note below is history
# rather than a pending step.
#
# Review 2 found the original version internally impossible: it forbade
# `seasonBalance.test.ts`, which held `GOLDEN_OUTCOMES`/`GOLDEN_SCORE`/
# `GOLDEN_DELTAS`, and all of `src/presentation/`, which included
# `ArenaCamera.test.ts`'s recorded tick counts, opening distances and band-edge
# crossings -- every one of which this slice's behaviour change MUST update.
# Forbidding a file whose contents must move is a rule that cannot be obeyed.
#
# So the slice shipped as two PRs:
#
#   PREPARATORY PR (merged) -- the contact-diagnostics seam, the reach harness,
#   the fixture splits, and the phase-1 form of this gate. It forbade the
#   presentation SOURCE and the acceptance logic that carried no movable
#   literal. Five files were deliberately open, because authoring
#   `measure-reach.ts` and splitting the other four's literals into
#   `src/testSupport/frozenFixtures/` was that PR's job.
#
#   CONTENT PR (this one) -- the catalog change, branched from main after the
#   first merged, so its diff no longer contains the harness. Its list adds all
#   five, which by now hold only assertions: their literals live in fixture
#   modules that the re-baseline rule governs instead.
#
# `scripts/measure-reach.ts` joins them for the same reason the others do. It
# is the instrument that produces this slice's acceptance evidence, and review
# 2's finding was precisely that the previous list let an implementation weaken
# the criteria it had to pass -- including the instrument itself.
#
# Screenshot baselines under `tests/__screenshots__/**` are never forbidden in
# either phase: they are outputs of the change, not levers on it.
# `src/presentation/` is matched WHOLESALE rather than by an enumeration of
# filenames. The enumeration was reviewed and found incomplete -- it left
# `battleFeed.ts`, `conditionTelegraph.ts`, `dispositionLabels.ts`,
# `footstepThresholds.ts` and `formatPower.ts` writable -- and any such list
# rots the moment a module is added.
# `src/simulation/series\.test\.ts$` IS DELIBERATELY ABSENT, and saying why is
# the point of this comment rather than an apology for it.
#
# The preparatory PR's split of that file was INCOMPLETE. Its inventory found
# five movable literals and missed three more: the `{home: 0, away: 3}` scores
# in the short-handed block, and the hard-coded lineup naming which ordering
# beats the all-counter one. The content change moves all four. Forbidding the
# file while it still holds values that must move is exactly the contradiction
# review 2 found in the original single-phase list -- a rule that cannot be
# obeyed -- so the honest options were to leave it open for one more PR or to
# pretend the split was finished.
#
# It is left open, and the split is FINISHED in this PR: those literals now
# live in `frozenFixtures/seriesTrace.ts` alongside the other five. From the
# next slice the file holds criteria only and joins the list below, which is
# the same transition `measure-reach.ts` and the other three made here.
#
# What this costs while it is open, stated so a reviewer can check it: this PR
# can edit assertions in `series.test.ts` that it also has to satisfy. Every
# such edit is enumerated in its own commit message, and the one that changes
# a criterion rather than a literal -- dropping the blanket `3-0` prohibition
# -- is written up as an amendment in the slice's spec, with both of
# design.md's golden criteria verified against the new run first.
FORBIDDEN='^(src/style\.css$|index\.html$|src/main\.ts$|src/presentation/|src/simulation/(balance|dispositionBalance|seasonBalance|encounterCapacity)\.test\.ts$|src/testSupport/balanceCohorts\.ts$|tests/legibility\.spec\.ts$|playwright\.config\.ts$|scripts/measure-reach\.ts$|src/testSupport/reachHarness\.ts$)'
# NO EXEMPTIONS in phase 2. The phase-1 list exempted
# `^src/presentation/.*\.test\.ts$` because `ArenaCamera.test.ts` held recorded
# trace numbers this slice must update. Those numbers now live in
# `src/testSupport/frozenFixtures/cameraTraces.ts`, which no pattern here
# matches, so the exemption has nothing left to protect and the whole of
# `src/presentation/` -- source and tests alike -- is closed.
EXEMPT='^$'
# Committed + staged + unstaged + untracked, and both sides of every rename.
CHANGED="$( { git diff --name-status -z --find-renames "$BASE" HEAD; git diff --name-status -z --find-renames HEAD; git diff --name-status -z --find-renames --cached; } \
  | tr '\0' '\n' | grep -vE '^[A-Z][0-9]*$' | sort -u )"
UNTRACKED="$(git ls-files --others --exclude-standard)"
VIOLATIONS="$(printf '%s\n%s\n' "$CHANGED" "$UNTRACKED" | grep -v '^$' | grep -E "$FORBIDDEN" | grep -vE "$EXEMPT" || true)"
if [ -n "$VIOLATIONS" ]; then echo "Forbidden for this slice:" >&2; echo "$VIOLATIONS" >&2; exit 1; fi
echo "allowlist ok"
