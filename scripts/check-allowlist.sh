#!/usr/bin/env bash
# scripts/check-allowlist.sh — the paths this slice may not touch.
#
# RE-SCOPED for the murmillo-pin slice's PREPARATORY PR (2026-08-28). Rebuilt
# from scratch, as every slice rebuilds it, because the shape follows the claim.
#
# ---------------------------------------------------------------------------
# THE CLAIM THIS LIST PROTECTS
# ---------------------------------------------------------------------------
#
# This PR adds an instrument and changes nothing the instrument measures.
#
# `scripts/measure-distance.ts` and `src/testSupport/distanceHarness.ts` measure
# where a bout is actually fought -- the separation on every tick, per ordered
# matchup. That is the question the retiarius-reach playtest asked and the one
# `measure-reach.ts` structurally cannot answer, since every gate it owns is
# conditional on a contact having happened. Against the murmillo those two
# questions gave opposite answers: every reach gate went green while the pair
# never separated, because blows that used to land at 0.90 became geometry
# misses rather than the fight moving out.
#
# A new instrument is only worth trusting if the thing it measures did not move
# in the same diff. So `src/simulation/**` and `src/content/**` are closed
# outright: a baseline is a baseline only if it was taken of the shipped build.
#
# EXEMPTIONS, four, and no others:
#
#   * `src/testSupport/distanceHarness.ts` and its test -- the instrument's
#     silently-wrong parts, kept in `src/` precisely so `npm run build`
#     typechecks them and Vitest can reach them; `scripts/` is outside
#     tsconfig's `include` and neither applies there.
#   * `scripts/measure-distance.ts` -- the instrument itself, authored here.
#   * this file. A gate that cannot maintain itself cannot be enforced, as every
#     revision of it has said.
#
# `scripts/measure-reach.ts` IS CLOSED, and that is the load-bearing entry.
# It is the instrument producing this slice's *existing* baselines while this
# slice runs, and the previous slice established the rule the hard way: an
# instrument may not be adjusted in the diff whose numbers it produces. Two
# things that would be improvements are therefore deliberately NOT done here and
# are recorded as debts instead -- unifying the `equalStatFighter` fixture that
# both scripts now carry a copy of, and reporting gate E's disengage statistics
# per matchup rather than pooled. Both are named in
# `docs/superpowers/plans/2026-08-28-murmillo-journal.md`.
#
# `src/presentation/**`, `src/style.css`, `src/main.ts` and `index.html` are
# closed for the reason they always are here: this slice's question is about
# behaviour, and answering it a second way by redrawing would make the two
# answers inseparable.
#
# `.github/workflows/` is closed. Same rule as the instrument.
#
# `docs/**` is open. Recording what was found is not a lever on the finding.
#
# ---------------------------------------------------------------------------
# ONE EXEMPTION IS INHERITED, NOT CHOSEN
# ---------------------------------------------------------------------------
#
# `tests/__screenshots__/linux/**` is exempt only because this branch is stacked
# on `test/relinux-baselines` (PR #20), which re-captures two stale baselines on
# the runner image that compares them. `check:allowlist` diffs against
# `git merge-base main HEAD`, so until that PR merges those two PNGs appear in
# this slice's diff as inherited commits and a closed list would fail on work
# this slice did not do.
#
# THIS EXEMPTION MUST BE DELETED WHEN PR #20 MERGES. It is the one line here
# that protects nothing, and leaving it after the stack flattens would silently
# reopen the screenshot baselines for the content PR that follows.
#
# ---------------------------------------------------------------------------
# WHAT A REVIEWER MUST CHECK, BECAUSE THIS GATE CANNOT
# ---------------------------------------------------------------------------
#
# This list proves the diff is a new instrument plus prose. It CANNOT prove the
# instrument measures the right thing, and a green gate here must not be read as
# saying so. Three questions stay human:
#
#   1. Is the engaged window the right window? It opens at the first local
#      resolution, reusing `balanceCohorts.runBout`'s own predicate, so the
#      opening ~8.4-unit walk is excluded. Including it would make the metric
#      partly a measurement of approach speed, unevenly per matchup. Both
#      windows are printed; only one can be gated against.
#   2. Are the band edges the right edges? They are read from the patched
#      catalog -- the retiarius' committed floor and ceiling, and the murmillo's
#      `preferredRange.max` -- never from literals. Whether those are the
#      distances that matter is a design question this file cannot settle.
#   3. Does a share of time inside the murmillo's envelope mean what it looks
#      like it means? It does not, and the instrument says so in its own output:
#      the hoplomachus spends MORE of his bout in there than the retiarius does
#      and WINS that matchup. Any criterion built on that share alone would rank
#      the counter above the pin.
set -euo pipefail
BASE="${1:?base sha required}"
FORBIDDEN='^(src/|scripts/|tests/|\.github/workflows/|index\.html$|playwright\.config\.ts$|package(-lock)?\.json$)'
EXEMPT='^(src/testSupport/distanceHarness(\.test)?\.ts$|scripts/measure-distance\.ts$|scripts/check-allowlist\.sh$|tests/__screenshots__/linux/)'
# Committed + staged + unstaged + untracked, and both sides of every rename.
CHANGED="$( { git diff --name-status -z --find-renames "$BASE" HEAD; git diff --name-status -z --find-renames HEAD; git diff --name-status -z --find-renames --cached; } \
  | tr '\0' '\n' | grep -vE '^[A-Z][0-9]*$' | sort -u )"
UNTRACKED="$(git ls-files --others --exclude-standard)"
VIOLATIONS="$(printf '%s\n%s\n' "$CHANGED" "$UNTRACKED" | grep -v '^$' | grep -E "$FORBIDDEN" | grep -vE "$EXEMPT" || true)"
if [ -n "$VIOLATIONS" ]; then echo "Forbidden for this slice:" >&2; echo "$VIOLATIONS" >&2; exit 1; fi
echo "allowlist ok"
