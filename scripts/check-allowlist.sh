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
# NOT YET IN GROUP 2, and named here rather than left implicit:
# `src/simulation/encounterCapacity.test.ts` and `src/simulation/series.test.ts`
# each mix frozen literals that MUST move (the `dbe77c5e` fixture hash; the
# per-bout lineup hashes and the `1-2` golden score) with acceptance logic that
# must not (the capacity suite's >=50 action instances, >=50 contact
# resolutions, >=1000 damage, >=20 damaged combatants, and its candidate-check
# bounds). The plan's first task splits those literals into their own fixture
# modules, after which both files join the list below. Until then they are open.
#
# The gate's own file and `.github/` stay reachable, for the same reason the
# previous list admitted them: a gate that cannot maintain itself cannot be
# enforced at all. This re-scope lands as its own commit BEFORE the content
# change, so the feature diff is judged by a boundary it did not write.
set -euo pipefail
BASE="${1:?base sha required}"
# TWO PHASES, because a single list cannot be both complete and satisfiable.
#
# Review 2 found the previous version internally impossible: it forbade
# `seasonBalance.test.ts`, which holds `GOLDEN_OUTCOMES`/`GOLDEN_SCORE`/
# `GOLDEN_DELTAS`, and all of `src/presentation/`, which includes
# `ArenaCamera.test.ts`'s recorded tick counts, opening distances and band-edge
# crossings -- every one of which this slice's behaviour change MUST update.
# Forbidding a file whose contents must move is a rule that cannot be obeyed.
#
# So the slice ships as two PRs and this list belongs to the first:
#
#   PREPARATORY PR (this one) -- the contact-diagnostics seam, the reach
#   harness, the fixture splits, and this gate. It forbids the presentation
#   SOURCE and the acceptance logic that carries no movable literal. The four
#   mixed files are deliberately open, because splitting their literals into
#   their own fixture modules is this PR's job.
#
#   CONTENT PR -- the catalog change. Branched from main after the first
#   merges, so its diff no longer contains the harness, and its list adds:
#   `scripts/measure-reach.ts`, `src/simulation/seasonBalance.test.ts`,
#   `src/simulation/encounterCapacity.test.ts`, `src/simulation/series.test.ts`
#   and `src/presentation/ArenaCamera.test.ts` -- by then all five hold only
#   assertions, their literals having moved to fixture modules that the
#   re-baseline rule governs instead.
#
# `scripts/measure-reach.ts` is absent here for the same reason: it is being
# authored in this PR. It is the instrument that produces the acceptance
# evidence, so from the content PR onward it is protected like any other
# criterion.
#
# Screenshot baselines under `tests/__screenshots__/**` are never forbidden in
# either phase: they are outputs of the change, not levers on it.
# `src/presentation/` is matched WHOLESALE rather than by an enumeration of
# filenames. The enumeration was reviewed and found incomplete -- it left
# `battleFeed.ts`, `conditionTelegraph.ts`, `dispositionLabels.ts`,
# `footstepThresholds.ts` and `formatPower.ts` writable -- and any such list
# rots the moment a module is added. The four test files that still hold
# movable literals are exempted below instead, which is a rule that stays true
# as the directory grows.
FORBIDDEN='^(src/style\.css$|index\.html$|src/main\.ts$|src/presentation/|src/simulation/(balance|dispositionBalance)\.test\.ts$|src/testSupport/balanceCohorts\.ts$|tests/legibility\.spec\.ts$|playwright\.config\.ts$)'
# Phase-1 exemptions: presentation TEST files stay open because
# `ArenaCamera.test.ts` holds recorded trace numbers this slice must update,
# and splitting them out is this PR's job. Phase 2 drops this exemption.
EXEMPT='^src/presentation/.*\.test\.ts$'
# Committed + staged + unstaged + untracked, and both sides of every rename.
CHANGED="$( { git diff --name-status -z --find-renames "$BASE" HEAD; git diff --name-status -z --find-renames HEAD; git diff --name-status -z --find-renames --cached; } \
  | tr '\0' '\n' | grep -vE '^[A-Z][0-9]*$' | sort -u )"
UNTRACKED="$(git ls-files --others --exclude-standard)"
VIOLATIONS="$(printf '%s\n%s\n' "$CHANGED" "$UNTRACKED" | grep -v '^$' | grep -E "$FORBIDDEN" | grep -vE "$EXEMPT" || true)"
if [ -n "$VIOLATIONS" ]; then echo "Forbidden for this slice:" >&2; echo "$VIOLATIONS" >&2; exit 1; fi
echo "allowlist ok"
