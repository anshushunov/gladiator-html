#!/usr/bin/env bash
# scripts/check-allowlist.sh — the paths this slice may not touch.
#
# RE-SCOPED for the murmillo-pin slice's FOURTH PR, the content (2026-08-29).
# Rebuilt from scratch, as every slice rebuilds it, because the shape follows
# the claim. Committed BEFORE the work it judges, as all three previous
# revisions were.
#
# ---------------------------------------------------------------------------
# THE CLAIM THIS LIST PROTECTS (PR-4)
# ---------------------------------------------------------------------------
#
# This PR changes behaviour, and is judged by a boundary and by criteria that
# three earlier diffs wrote.
#
# It is the first PR in the slice that is ALLOWED to move a frozen artifact, and
# the list changes shape accordingly: instead of proving nothing moved, it has
# to prove that what moved is behaviour and its determinism artifacts, and that
# the yardsticks did not move with it.
#
# ---------------------------------------------------------------------------
# THE LOAD-BEARING ENTRY: THE CRITERIA ARE CLOSED
# ---------------------------------------------------------------------------
#
# `scripts/measure-reach.ts`, `scripts/measure-distance.ts` and
# `src/testSupport/disengageGates.ts` are CLOSED, and so is
# `docs/superpowers/plans/2026-08-29-distance-baseline.json` — the recorded
# shipped run that gate U's stopping criterion compares against, and the one
# file in `docs/` this list protects, because a baseline a candidate may rewrite
# is not a baseline.
#
# This is the entry the whole four-PR split exists to make possible. PR-3 froze
# the criteria on the shipped content while no candidate existed; if PR-4 could
# reach them, every gate would be a gate the candidate helped write. A failing
# gate here is a finding about the candidate, not an invitation to open this
# file.
#
# `src/simulation/disengageDiagnostics.ts` is CLOSED for the same reason one
# level down: its exit-reason set is frozen — exactly `range`, `cap`,
# `progress`, `censored` — and PR-4 may not add a reason, rename one, or move
# one between the success and failure sets. `progress` is already there,
# unreachable, waiting for exactly this PR to return it.
#
# `src/content/**` is CLOSED TOO, which is stricter than the spec requires. The
# spec's §6 makes the two disengage constants and the exit predicate mutable and
# names content as not mutable; the mechanism this PR implements needs neither,
# so the list says so. If the work turns out to need content, the gate fails and
# that is the brief's stop condition rather than a line to edit.
#
# `src/presentation/**`, `src/style.css`, `src/main.ts`, `index.html` and
# `.github/workflows/` are closed for the reasons they always are.
#
# ---------------------------------------------------------------------------
# WHAT IS OPEN, AND WHY EACH IS EXPECTED TO MOVE
# ---------------------------------------------------------------------------
#
#   * `src/simulation/combatDecision.ts` and its test — the two constants and
#     the exit predicate the spec's §6 makes mutable, plus the start-separation
#     argument the pursuit-relative form needs.
#   * `src/simulation/encounter.ts` and its test — the start-separation field on
#     `FighterCombatState` beside `forcedDisengageStartTick`, its stamp and
#     clear, and its invariant coverage. It lands here and not in PR-2 because
#     it is real combatant state, and `stateHash.test.ts` hashes the whole
#     `BattleState` every tick, so no PR containing it could also claim the
#     digests were untouched.
#   * `src/simulation/battle.test.ts`, `series.test.ts`,
#     `encounterDisposition.test.ts`, `src/testSupport/reachHarness.test.ts` —
#     behavioural assertions that move because behaviour moved.
#   * `src/testSupport/stateHash.test.ts` and
#     `src/testSupport/frozenFixtures/**` — the determinism artifacts, under
#     design.md's determinism-artifact rule: re-baselined in the diff that
#     legitimately earns it, each with its reason.
#   * `tests/**` — the e2e specs and both screenshot baseline sets. The previous
#     slice's content PR moved five Linux and one win32 baseline for the same
#     reason, and that is the precedent this follows.
#   * this file.
#
# ---------------------------------------------------------------------------
# WHAT A REVIEWER MUST CHECK, BECAUSE THIS GATE CANNOT
# ---------------------------------------------------------------------------
#
#   1. **Every moved digest has a stated reason.** A path allowlist can only say
#      the file was allowed to move. Whether `4403ef70` became something else
#      because the retiarius now exits his disengage differently, or because
#      something unrelated broke, is a question only the diff and the gate
#      output answer together.
#   2. **Events, RNG consumption and terminal outcomes are unchanged where
#      behaviour was not meant to move** — in particular in the six matchups
#      containing no Fast fighter, which this change cannot reach.
#   3. **The gates were run, not asserted.** `measure-reach --seeds 200 --gate`
#      must show the A–G group passing and the P/Q/Q2/R group passing;
#      `measure-distance --seeds 200 --gate --baseline <the committed file>`
#      must show V and U passing. Before this PR, P and Q failed by design.
set -euo pipefail
BASE="${1:?base sha required}"
FORBIDDEN='^(src/|scripts/|tests/|\.github/workflows/|index\.html$|playwright\.config\.ts$|package(-lock)?\.json$)'
# Everything the branch has legitimately touched since `main`: PR-1's, PR-2's,
# PR-3's and PR-4's. The second pass is what distinguishes them.
EXEMPT='^(src/simulation/(combatDecision|encounter|battle|disengageDiagnostics)(\.test)?\.ts$|src/simulation/(series|encounterDisposition)\.test\.ts$|src/testSupport/(stateHash|reachHarness|distanceHarness|disengageGates)(\.test)?\.ts$|src/testSupport/frozenFixtures/|scripts/(measure-reach|measure-distance|check-allowlist)\.(ts|sh)$|tests/)'
# Committed + staged + unstaged + untracked, and both sides of every rename.
changed_since() {
  { git diff --name-status -z --find-renames "$1" HEAD; git diff --name-status -z --find-renames HEAD; git diff --name-status -z --find-renames --cached; } \
    | tr '\0' '\n' | grep -vE '^[A-Z][0-9]*$' | sort -u
}
UNTRACKED="$(git ls-files --others --exclude-standard)"
VIOLATIONS="$(printf '%s\n%s\n' "$(changed_since "$BASE")" "$UNTRACKED" | grep -v '^$' | grep -E "$FORBIDDEN" | grep -vE "$EXEMPT" || true)"
if [ -n "$VIOLATIONS" ]; then echo "Forbidden for this slice:" >&2; echo "$VIOLATIONS" >&2; exit 1; fi

# --- Second pass: the yardsticks do not move in the diff they judge ----------
#
# Measured from PR-4's own boundary, the tip of PR-3, so it sees only this PR's
# work. Note that it covers `docs/`, which the first pass deliberately does not:
# gate U's baseline is a recorded run, and a recorded run a candidate may
# rewrite measures nothing.
PR4_BOUNDARY='85131b4'
FROZEN='^(scripts/measure-(reach|distance)\.ts$|src/testSupport/disengageGates(\.test)?\.ts$|src/testSupport/distanceHarness(\.test)?\.ts$|src/simulation/disengageDiagnostics(\.test)?\.ts$|docs/superpowers/plans/2026-08-29-distance-baseline\.json$)'
if git rev-parse --verify --quiet "$PR4_BOUNDARY^{commit}" >/dev/null; then
  REOPENED="$(printf '%s\n%s\n' "$(changed_since "$PR4_BOUNDARY")" "$UNTRACKED" | grep -v '^$' | grep -E "$FROZEN" || true)"
  if [ -n "$REOPENED" ]; then
    echo "This PR is judged by these; it may not move them:" >&2
    echo "$REOPENED" >&2
    exit 1
  fi
else
  # Loud, not skipped. A pass that silently disappears when its anchor does is
  # worse than no pass at all -- it reports green while checking nothing.
  echo "PR-4 boundary commit $PR4_BOUNDARY is not in this history; the frozen-yardstick pass cannot run" >&2
  exit 1
fi
echo "allowlist ok"
