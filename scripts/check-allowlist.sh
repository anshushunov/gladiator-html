#!/usr/bin/env bash
# scripts/check-allowlist.sh — the paths this slice may not touch.
#
# RE-SCOPED for the murmillo-pin slice's SECOND PR, the diagnostic seam
# (2026-08-29). Rebuilt from scratch, as every slice rebuilds it, because the
# shape follows the claim. Committed BEFORE the work it judges, as the previous
# revision was.
#
# ---------------------------------------------------------------------------
# WHAT THIS FILE NOW JUDGES
# ---------------------------------------------------------------------------
#
# `check:allowlist` diffs against `git merge-base main HEAD`, and this branch
# carries the slice's PR-1 (the distance instrument) as well as PR-2. So this
# list judges both, and PR-1's three exemptions stay — not because they are
# reopened, but because deleting them would fail the gate on work that is
# already reviewed and already in the branch. They are marked as such below.
#
# ---------------------------------------------------------------------------
# THE CLAIM THIS LIST PROTECTS (PR-2)
# ---------------------------------------------------------------------------
#
# This PR adds a diagnostic seam and changes nothing that the seam observes.
#
# `src/simulation/disengageDiagnostics.ts` is a write-only collector on the
# model of `contactDiagnostics.ts`: never read back inside a tick, never in
# `EncounterState`, never in the event log, so no trace hash folds over it. It
# records one episode per forced disengage — the separation at the tick the
# field was stamped and at the tick it was cleared, both read in phase 2 before
# that tick's movement, plus the elapsed ticks and a closed exit reason.
#
# It exists because `measure-reach.ts:281` deduces the exit reason from the
# episode's duration, against the very constant PR-4 makes mutable. That
# deduction tracks today's two-branch predicate and stops tracking anything the
# moment the predicate changes — which is the change this slice proposes.
#
# EXEMPTIONS FOR THIS PR, four, and no others:
#
#   * `src/simulation/disengageDiagnostics.ts` and its test — the seam itself.
#   * `src/simulation/encounter.ts` and `src/simulation/battle.ts` — the
#     threading. The collector has to reach phase 2, and phase 2 lives in the
#     kernel; there is no way to add this seam without opening these two files.
#   * `src/simulation/combatDecision.ts` and its test — the ONE signature
#     change: `hasFastForcedDisengageEnded` widens its return from `boolean` to
#     the frozen exit-reason enum, preserving the existing truthiness exactly
#     (`undefined` where it returned `false`, a non-empty reason string where it
#     returned `true`). The test is exempt only because seven `.toBe(true)` /
#     `.toBe(false)` assertions cannot survive a widened return; the boundary
#     cases they pin are kept and each one gains its reason.
#   * this file. A gate that cannot maintain itself cannot be enforced, as every
#     revision of it has said.
#
# ---------------------------------------------------------------------------
# WHAT IS NOT EXEMPT, AND WHY EACH ABSENCE IS DELIBERATE
# ---------------------------------------------------------------------------
#
# `src/simulation/encounter.test.ts` and `src/simulation/battle.test.ts` ARE
# CLOSED, and that is the load-bearing entry of this revision. Both already
# assert Fast's forced disengage. If threading a write-only collector through
# the kernel required editing either of them, the seam would not be inert and
# the PR's claim would be false — so the gate is set to fail rather than to let
# me quietly re-baseline. `src/testSupport/stateHash.test.ts` is closed for the
# same reason and is the sharper instrument: it rolls a hash of the WHOLE
# `BattleState` after every tick of nine pairings, so any behavioural drift moves
# a digest. A red gate here is the finding, not an obstacle.
#
# `scripts/measure-reach.ts` STAYS CLOSED, for the third PR running. It is the
# instrument producing this slice's existing baselines, and an instrument may not
# be adjusted in the diff whose numbers it produces. It is also the file that
# most wants to be touched right now — it holds the duration inference this seam
# exists to replace — and consuming the seam is PR-3's job, in a diff that
# changes no behaviour. `src/testSupport/reachHarness.ts` is closed with it.
#
# `src/content/**` is closed. The seam must be measured against the shipped
# content or its first numbers describe a build nobody shipped. The content
# change is PR-4.
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
# EXEMPTIONS INHERITED, NOT CHOSEN
# ---------------------------------------------------------------------------
#
# `src/testSupport/distanceHarness.ts`, its test, and
# `scripts/measure-distance.ts` are PR-1's. That PR's claim was judged by the
# previous revision of this file and its work is in the branch; these three lines
# keep the gate from failing on a diff it has already passed. They are NOT an
# invitation to keep editing the distance instrument in this PR, and nothing in
# PR-2 touches it.
#
# `tests/__screenshots__/linux/**` is exempt only because this branch is stacked
# on `test/relinux-baselines` (PR #20), which re-captures two stale baselines on
# the runner image that compares them. Until that PR merges, those two PNGs
# appear in this slice's diff as inherited commits and a closed list would fail
# on work this slice did not do.
#
# THIS EXEMPTION MUST BE DELETED WHEN PR #20 MERGES. Checked again on
# 2026-08-29: `gh pr view 20` reports `state: OPEN`, `mergedAt: null`, so the
# line stays for now. It is the one line here that protects nothing, and leaving
# it after the stack flattens would silently reopen the screenshot baselines for
# the content PR that follows.
#
# ---------------------------------------------------------------------------
# WHAT A REVIEWER MUST CHECK, BECAUSE THIS GATE CANNOT
# ---------------------------------------------------------------------------
#
# This list proves the diff is a seam plus prose. It CANNOT prove the seam is
# inert, and it cannot prove the seam measures the right thing. A green gate
# here must not be read as saying either. What stands in for it:
#
#   1. The nine digests in `src/testSupport/stateHash.test.ts` reproduce
#      unchanged. That, and not this file, is the proof that opening
#      `encounter.ts` did not move behaviour — a path allowlist cannot tell a
#      collector call from a logic edit.
#   2. `measure-reach --seeds 200 --gate` reproduces the journal's numbers
#      bit-for-bit. The whole suite passing is necessary and not sufficient;
#      the gate numbers are the ones the later PRs are judged against.
#   3. Does the seam read the endpoints at the right instants? Both are read in
#      phase 2 — the stamp before that tick's movement, the clear before the
#      ordinary decision and movement that run in the same advance. That is the
#      one-tick window shift described in the design's §4.0, and whether the
#      corrected window is the right window is a design question this file
#      cannot settle.
set -euo pipefail
BASE="${1:?base sha required}"
FORBIDDEN='^(src/|scripts/|tests/|\.github/workflows/|index\.html$|playwright\.config\.ts$|package(-lock)?\.json$)'
EXEMPT='^(src/simulation/disengageDiagnostics(\.test)?\.ts$|src/simulation/(encounter|battle)\.ts$|src/simulation/combatDecision(\.test)?\.ts$|src/testSupport/distanceHarness(\.test)?\.ts$|scripts/measure-distance\.ts$|scripts/check-allowlist\.sh$|tests/__screenshots__/linux/)'
# Committed + staged + unstaged + untracked, and both sides of every rename.
CHANGED="$( { git diff --name-status -z --find-renames "$BASE" HEAD; git diff --name-status -z --find-renames HEAD; git diff --name-status -z --find-renames --cached; } \
  | tr '\0' '\n' | grep -vE '^[A-Z][0-9]*$' | sort -u )"
UNTRACKED="$(git ls-files --others --exclude-standard)"
VIOLATIONS="$(printf '%s\n%s\n' "$CHANGED" "$UNTRACKED" | grep -v '^$' | grep -E "$FORBIDDEN" | grep -vE "$EXEMPT" || true)"
if [ -n "$VIOLATIONS" ]; then echo "Forbidden for this slice:" >&2; echo "$VIOLATIONS" >&2; exit 1; fi
echo "allowlist ok"
