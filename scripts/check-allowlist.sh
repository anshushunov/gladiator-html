#!/usr/bin/env bash
# scripts/check-allowlist.sh — the paths this slice may not touch.
#
# RE-SCOPED for the murmillo-pin slice's THIRD PR, the criteria (2026-08-29).
# Rebuilt from scratch, as every slice rebuilds it, because the shape follows
# the claim. Committed BEFORE the work it judges, as both previous revisions
# were.
#
# ---------------------------------------------------------------------------
# THE CLAIM THIS LIST PROTECTS (PR-3)
# ---------------------------------------------------------------------------
#
# This PR changes the criteria and changes nothing they judge.
#
# `measure-reach.ts` opens for the first time in this slice, to stop deducing
# the disengage exit reason from the episode's duration and read it from PR-2's
# seam instead, to report per matchup rather than pooled, and to assert the
# spec's gates P, Q, Q2 and R. `measure-distance.ts` gains the `--gate` its own
# header says it is deliberately missing, for gates V and U. Neither the
# simulation nor the content moves, so every number these instruments produce
# describes the same shipped build the previous baselines were taken of.
#
# EXEMPTIONS FOR THIS PR, four, and no others:
#
#   * `scripts/measure-reach.ts` — the criteria themselves. Closed for two PRs
#     precisely so that it could be opened here, in a diff that changes no
#     behaviour, rather than in the one whose numbers it produces.
#   * `scripts/measure-distance.ts` — the same, for gates V and U.
#   * `src/testSupport/disengageGates.ts` and its test — the classification the
#     gates rest on (what counts as a success, per matchup, from seam records),
#     kept in `src/` for the reason PR-1 kept `distanceHarness.ts` there: a
#     script is outside tsconfig's `include` and Vitest cannot reach it, so
#     gate arithmetic living only in `scripts/` is gate arithmetic nobody tests.
#   * this file. A gate that cannot maintain itself cannot be enforced.
#
# ---------------------------------------------------------------------------
# WHAT IS NOT EXEMPT, AND WHY EACH ABSENCE IS DELIBERATE
# ---------------------------------------------------------------------------
#
# `src/simulation/**` IS CLOSED AGAIN, and that is this revision's load-bearing
# entry. PR-2 opened four files there to build the seam; PR-3 consumes the seam
# and must not touch it. If asserting a criterion required editing the thing it
# measures, the criterion would be describing a build made to satisfy it — the
# defect this whole four-PR split exists to prevent. `disengageDiagnostics.ts`
# in particular is frozen: its exit-reason set is frozen by the spec, and a gate
# that could widen the set it reads is not a gate.
#
# `src/content/**` is closed. The content change is PR-4 and is judged BY these
# criteria; a diff containing both would be a criterion and its own subject.
#
# `src/testSupport/distanceHarness.ts` and `reachHarness.ts` are closed. Both
# are instruments whose numbers the gates read. `measure-distance.ts` already
# counts lunge starts per Fast fighter inside the latched engaged window — gate
# V's numerator — and PR-3 asserts that number rather than re-deriving it.
#
# `src/presentation/**`, `src/style.css`, `src/main.ts`, `index.html` and
# `.github/workflows/` are closed for the reasons they always are here.
#
# `docs/**` is open. Recording what was found is not a lever on the finding.
#
# ---------------------------------------------------------------------------
# THE SECOND PASS: INHERITED MEANS INHERITED
# ---------------------------------------------------------------------------
#
# `check:allowlist` diffs against `git merge-base main HEAD`, and this branch
# carries PR-1 and PR-2 as well as PR-3. Against that base an inherited change
# and a fresh one look identical, so the first pass has to exempt everything the
# earlier PRs touched — and would then happily let PR-3 edit any of it.
#
# That was external review's finding on the previous revision, and the answer is
# the second pass at the bottom: measured from PR-3's own boundary — the tip of
# PR-2, `1cd1942` — the earlier PRs' paths must not move at all. It fails loudly
# if its anchor is missing rather than silently checking nothing.
#
# `tests/__screenshots__/linux/**` USED to be exempt here, inherited from
# `test/relinux-baselines` (PR #20), under a note saying the line had to go the
# moment that PR merged because it protected nothing. It merged on 2026-08-29
# as `3d43624`, its two re-captured baselines are in `main`, and they no longer
# appear in this branch's diff at all. So the line is deleted rather than left
# standing, and the screenshots are closed to this slice again — which is what
# they should have been all along, and would have been if the two PRs had not
# been stacked.
#
# ---------------------------------------------------------------------------
# WHAT A REVIEWER MUST CHECK, BECAUSE THIS GATE CANNOT
# ---------------------------------------------------------------------------
#
#   1. The A–G clauses and their thresholds are frozen (spec gate S). PR-3 may
#      ADD clauses to `measure-reach.ts` and may not alter one of these. A path
#      allowlist cannot see the difference; the diff of the gate block can.
#   2. The nine digests in `src/testSupport/stateHash.test.ts` reproduce
#      unchanged. With `src/simulation/**` and `src/content/**` both closed they
#      must, and if they do not, something is being measured that also moved.
#   3. Do the new gates measure what the spec says? The bars come from the spec
#      and the spec says where each came from; whether the shipped content still
#      clears them under the seam's definition of success is a MEASUREMENT this
#      PR must report, not an assumption it may make. Gate P's comparator floors
#      in particular were derived from "reached the exit range", and the seam's
#      success adds a ground condition on top of it.
set -euo pipefail
BASE="${1:?base sha required}"
FORBIDDEN='^(src/|scripts/|tests/|\.github/workflows/|index\.html$|playwright\.config\.ts$|package(-lock)?\.json$)'
# Everything the branch has legitimately touched since `main`: PR-1's, PR-2's
# and PR-3's. The second pass is what distinguishes them.
EXEMPT='^(scripts/measure-(reach|distance)\.ts$|src/testSupport/disengageGates(\.test)?\.ts$|scripts/check-allowlist\.sh$|src/simulation/disengageDiagnostics(\.test)?\.ts$|src/simulation/(encounter|battle)\.ts$|src/simulation/combatDecision(\.test)?\.ts$|src/testSupport/distanceHarness(\.test)?\.ts$)'
# Committed + staged + unstaged + untracked, and both sides of every rename.
changed_since() {
  { git diff --name-status -z --find-renames "$1" HEAD; git diff --name-status -z --find-renames HEAD; git diff --name-status -z --find-renames --cached; } \
    | tr '\0' '\n' | grep -vE '^[A-Z][0-9]*$' | sort -u
}
UNTRACKED="$(git ls-files --others --exclude-standard)"
VIOLATIONS="$(printf '%s\n%s\n' "$(changed_since "$BASE")" "$UNTRACKED" | grep -v '^$' | grep -E "$FORBIDDEN" | grep -vE "$EXEMPT" || true)"
if [ -n "$VIOLATIONS" ]; then echo "Forbidden for this slice:" >&2; echo "$VIOLATIONS" >&2; exit 1; fi

# --- Second pass: what PR-3 itself may move ---------------------------------
PR3_BOUNDARY='1cd1942'
INHERITED='^(src/simulation/|src/testSupport/distanceHarness(\.test)?\.ts$)'
if git rev-parse --verify --quiet "$PR3_BOUNDARY^{commit}" >/dev/null; then
  REOPENED="$(printf '%s\n%s\n' "$(changed_since "$PR3_BOUNDARY")" "$UNTRACKED" | grep -v '^$' | grep -E "$INHERITED" || true)"
  if [ -n "$REOPENED" ]; then
    echo "Inherited from an earlier PR, not editable by this one:" >&2
    echo "$REOPENED" >&2
    exit 1
  fi
else
  # Loud, not skipped. A pass that silently disappears when its anchor does is
  # worse than no pass at all -- it reports green while checking nothing.
  echo "PR-3 boundary commit $PR3_BOUNDARY is not in this history; the inherited-paths pass cannot run" >&2
  exit 1
fi
echo "allowlist ok"
