#!/usr/bin/env bash
# scripts/check-allowlist.sh — the paths this slice may not touch.
#
# RE-SCOPED for the measurement-repair slice (2026-08-27). The list is
# per-slice by construction and is rebuilt from scratch each time rather than
# amended, because the shape follows the slice's claim and the claim changes.
# The two lists this one replaces are worth a sentence each, since the shape
# has now flipped twice:
#
#   readable-gladiator-types — presentational, changed no behaviour. An
#   ALLOWLIST, keeping the diff OUT of `src/simulation/**`, `src/content/**`
#   and `src/style.css`.
#
#   retiarius-reach — changed behaviour on purpose, so every path that list
#   protected was a path it had to edit. A DENYLIST over presentation source
#   and acceptance logic, in two phases, because a single list could not be
#   both complete and satisfiable while the fixture split was in flight.
#
# ---------------------------------------------------------------------------
# WHAT THIS SLICE CLAIMS, and therefore what this list protects
# ---------------------------------------------------------------------------
#
# This slice repairs three MEASURING DEVICES and changes nothing they measure:
#
#   1. `ArenaCamera.test.ts`'s desired-yaw continuity bound, which was named
#      for axis motion and measured axis motion PLUS released dead-zone
#      hysteresis, and failed on one tick in 14 848 of the shipped content.
#   2. `measure-reach.ts`'s gate D comparator, which summed the hoplomachus
#      across all nine matchups including `technical vs fast`, so the yardstick
#      moved with the thing it judged.
#   3. `series.test.ts`'s fixture split, finished in the preparatory PR.
#
# So the claim is "the instruments changed, the game did not", and it is the
# exact inverse of the slice before it. That makes this a DENYLIST again, but
# over a different set: everything that could make the claim untrue.
#
# The strongest form of the claim is the one worth gating on, and it is
# checkable: IF NO BEHAVIOUR CHANGED, NO FROZEN VALUE MAY MOVE. A repaired
# instrument that also happens to produce nicer numbers is the failure mode
# this slice is least able to notice about itself — the slice's own risk note
# records five defects in a row where the instrument was wrong in the flattering
# direction — so `src/testSupport/frozenFixtures/**` is CLOSED here, having been
# deliberately open in the slice before. A fixture that needs re-baselining is
# not a re-baseline this time; it is evidence the repair moved the game.
#
# GROUP 1 -- THE GAME. `src/simulation/**` and `src/content/**`, wholesale.
# Matched wholesale rather than enumerated: the enumeration in the previous list
# was reviewed and found incomplete twice, and any such list rots the moment a
# module is added. Wholesale also subsumes, without special-casing them:
#
#   * the balance suites (`balance`, `dispositionBalance`, `seasonBalance`,
#     `encounterCapacity`) — criteria this slice must satisfy and has no
#     licence to weaken. `src/testSupport/balanceCohorts.ts`, which carries
#     their metric formulas, is named separately below because it lives
#     elsewhere;
#   * `src/simulation/series.test.ts`, WHICH IS NOW CLOSED. The retiarius-reach
#     list left it open and said why: the preparatory PR's split of that file
#     was incomplete, and forbidding a file that still holds values which must
#     move is a rule that cannot be obeyed. That debt is discharged. The
#     preparatory PR of THIS slice moved the last measured literal (the
#     leading-slot forfeit score) into `frozenFixtures/seriesTrace.ts` and
#     deleted the stale copy of the trace hashes, durations and score that had
#     been left behind in a comment describing a run that no longer existed.
#     The file now holds criteria only, which is the condition the previous list
#     named for closing it.
#
# GROUP 2 -- PRESENTATION SOURCE, `src/presentation/**` wholesale, `src/style.css`,
# `index.html`, `src/main.ts`. Nothing here is repaired by this slice, and
# anything drawn differently would move the screenshot baselines and the
# legibility checks — which is precisely the signal group 3 exists to read.
# `ArenaCamera.ts` is the load-bearing member: the spec's camera amendment
# forbids nudging its constants in place of fixing the metric, and "slew-clamp
# the desired yaw" is a real, tempting, WRONG fix that would slow a legitimate
# 12.758-degree turn to hide 4.319 degrees of bookkeeping. The exemption below
# opens exactly one file in this tree, its test.
#
# GROUP 3 -- FROZEN OUTPUTS. `src/testSupport/frozenFixtures/**` and
# `tests/__screenshots__/**`. Screenshot baselines were never forbidden by
# either previous list, on the correct grounds that they are outputs of the
# change rather than levers on it. This slice has no change for them to be an
# output of, so the reasoning inverts: a moved baseline here is not a
# regeneration, it is a behaviour change nobody declared.
#
# GROUP 4 -- ACCEPTANCE METHOD that lives outside `src/simulation/`:
# `src/testSupport/balanceCohorts.ts` (cohort seeds, bands, metric formulas),
# `tests/legibility.spec.ts` and `playwright.config.ts` (viewports and the safe
# -area/scale-floor criteria the camera work is judged against).
#
# WHAT IS DELIBERATELY OPEN, since a denylist is only honest if it says what it
# lets through: `scripts/measure-reach.ts`, `src/testSupport/reachHarness.ts`
# and its test, and `src/presentation/ArenaCamera.test.ts`. These are the three
# instruments being repaired; closing them would forbid the slice's own work.
# `docs/**` is open, and `scripts/check-allowlist.sh` and `.github/` stay
# reachable for the same reason every previous revision admitted them: a gate
# that cannot maintain itself cannot be enforced at all.
#
# ---------------------------------------------------------------------------
# TWO PRs, and why this list needs no phases to survive it
# ---------------------------------------------------------------------------
#
# The retiarius-reach list needed two phases because one list could not be both
# complete and satisfiable while a fixture split was in flight. This one does
# not, because the work is split across PRs instead of the list across phases:
#
#   PREPARATORY PR -- finishes the `series.test.ts` split and nothing else. It
#   is judged by the PREVIOUS list, still in the tree at that point, which left
#   `series.test.ts` open for exactly this and keeps
#   `frozenFixtures/**` writable for exactly this. It touches no path this list
#   closes for any other reason.
#
#   REPAIR PR (this one) -- branched from main after that merged, so its diff no
#   longer contains the split. It ships THIS list as its first commit, before
#   the three repairs, so the diff is judged by a boundary it did not write.
#
# That ordering is the whole reason `series.test.ts` can be closed here without
# reintroducing the contradiction: by the time this list is live, the file that
# had to move has already moved, in a PR this list never judged.
set -euo pipefail
BASE="${1:?base sha required}"
FORBIDDEN='^(src/simulation/|src/content/|src/presentation/|src/style\.css$|index\.html$|src/main\.ts$|src/testSupport/frozenFixtures/|tests/__screenshots__/|src/testSupport/balanceCohorts\.ts$|tests/legibility\.spec\.ts$|playwright\.config\.ts$)'
# ONE EXEMPTION, and it is the slice's subject rather than an escape hatch.
# `src/presentation/` is matched wholesale in FORBIDDEN (an enumeration of
# filenames was reviewed and found incomplete in the previous list, and rots
# whenever a module is added), so the camera METRIC being repaired has to be
# named back out. Only the test: `ArenaCamera.ts` itself stays closed, which is
# the point of the camera amendment this repair answers.
EXEMPT='^src/presentation/ArenaCamera\.test\.ts$'
# Committed + staged + unstaged + untracked, and both sides of every rename.
CHANGED="$( { git diff --name-status -z --find-renames "$BASE" HEAD; git diff --name-status -z --find-renames HEAD; git diff --name-status -z --find-renames --cached; } \
  | tr '\0' '\n' | grep -vE '^[A-Z][0-9]*$' | sort -u )"
UNTRACKED="$(git ls-files --others --exclude-standard)"
VIOLATIONS="$(printf '%s\n%s\n' "$CHANGED" "$UNTRACKED" | grep -v '^$' | grep -E "$FORBIDDEN" | grep -vE "$EXEMPT" || true)"
if [ -n "$VIOLATIONS" ]; then echo "Forbidden for this slice:" >&2; echo "$VIOLATIONS" >&2; exit 1; fi
echo "allowlist ok"
