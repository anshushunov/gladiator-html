#!/usr/bin/env bash
# scripts/check-allowlist.sh — the paths this slice may not touch.
#
# REBUILT FROM SCRATCH for the shield-shove instrument split (2026-09-04), as
# every slice rebuilds it, because the shape follows the claim. Committed
# BEFORE the work it judges.
#
# ---------------------------------------------------------------------------
# THE CLAIM THIS LIST PROTECTS
# ---------------------------------------------------------------------------
#
# `feature/shield-shove` built two mechanics -- a murmillo shield shove and a
# pursuit-relative forced-disengage exit -- and, alongside them, the
# instruments that measured them. All four candidate builds failed the slow
# suite; the design owner parked both mechanics and ruled the instruments to
# `main`.
#
# This branch is that ruling carried out. It adds measurement and test-support
# code and CHANGES NO FIGHT BEHAVIOUR. Not "changes it only a little", not
# "changes it in ways the bands still tolerate": the bout that runs on this
# branch is the same bout, tick for tick, that runs on `main`.
#
# What that means concretely, and what this file mechanises:
#
#   EVERY FROZEN DETERMINISM DIGEST AND CANONICAL TRACE IS BYTE-IDENTICAL TO
#   `main`'s -- not re-recorded at a new build, IDENTICAL.
#
# The parked branch needed a re-baseline of twelve frozen assertions. This
# branch needs zero. That difference is the whole point, and a diff which
# claimed it while quietly moving a hash would be the first thing to
# disbelieve.
#
# EXEMPTIONS, and no others. Each is a file this branch genuinely edits:
#
#   * `scripts/measure-distance.ts` — ground attribution and the shove
#     counters. String-keyed throughout, so it compiles and runs against a
#     catalogue with no shove in it, reporting zeroes.
#   * `src/simulation/encounter.ts` — the kernel writes
#     `externalSeparationDelta` for the diagnostics seam, and the
#     forced-disengage exit rule becomes a parameter whose shipped default is
#     the shipped constants. Both are additive; neither is on a path a bout
#     takes differently.
#   * `src/simulation/disengageDiagnostics.ts` and its test — the episode's
#     external ground component.
#   * `src/simulation/combatDecision.ts` — `fastForcedDisengageExit` over an
#     explicit rule, with `hasFastForcedDisengageEnded` delegating to it at the
#     shipped thresholds.
#   * `src/simulation/contactDiagnostics.ts` — a DOC correction to
#     `ContactOutcome`, no code.
#   * `src/testSupport/disengageGates.ts` and its test — voluntary ground, and
#     `corroborate` taking the rule it corroborates against.
#   * `src/testSupport/shoveGates.ts` and its test — gate W, pure functions
#     over a summary record, imported by nothing that runs a bout.
#   * `src/simulation/encounter.test.ts` — tests for the two above. See the
#     digest guard below for why exempting a pin-bearing test file is safe here
#     and would not be safe by path alone.
#   * `src/presentation/ArenaCamera.test.ts` — the yaw assertion re-expressed
#     against the camera's own guarantee.
#   * `scripts/measure-reach.ts` — ADDED 2026-09-04, during the review's fix
#     wave, and the only exemption on this list that is not code. COMMENTS
#     ONLY: the diff against BASE is 72 added lines, every one of them a `//`
#     line, and the check below the list would not know that, so it is stated
#     here where a reviewer can verify it with
#     `git diff BASE..HEAD -- scripts/measure-reach.ts`.
#
#     The reason it has to be exempt at all: this branch moved gates P and Q
#     from `groundOpened` to `voluntaryGroundOpened` in
#     `src/testSupport/disengageGates.ts` (already exempt) and left the 0.75
#     bar where it was. `measure-reach.ts` is those gates' SOLE consumer and
#     was not told, so it carried stale recorded figures and printed a raw
#     distribution a dozen lines above a table of voluntary ones. Leaving the
#     only file that runs the changed gates silent about the change is a
#     documentation defect this branch introduced, and fixing it cannot be
#     deferred to a branch that does not also carry the change. It runs no
#     bout in the suite -- `scripts/` is outside tsconfig's `include` and
#     unreachable by Vitest -- so it cannot move a digest even in principle.
#   * this file.
#
# `docs/**` is outside the forbidden set entirely, as always: documentation
# changes no behaviour.
#
# ---------------------------------------------------------------------------
# THE LOAD-BEARING ENTRY: NO DIGEST, NO BAND, NO SEED COUNT, NO SCREENSHOT
# ---------------------------------------------------------------------------
#
# A path list is not enough for this claim. Two of the exempt files are test
# files, and one of them (`encounter.test.ts`) carries three of the repo's
# frozen per-seed trace hashes. "No test file moved" would therefore be a lie
# told by omission, so this gate checks the VALUES, not only the paths:
#
#   1. **No digest may change.** Every eight-character hex token appearing
#      anywhere under `src/` or `tests/` is extracted from BASE and from the
#      working tree and the two multisets are compared. That is 22 distinct
#      values on `main`: the nine `stateHash.test.ts` pairings, the
#      `battle.test.ts` adapter duel, the three `encounter.test.ts` per-seed
#      rows, `CAPACITY_TRACE_HASH`, the three `LINEUP_BOUT_HASHES`, the
#      `random.test.ts` fold, and the camera traces. If a single one of them
#      moves -- in either direction, including being deleted -- this branch has
#      changed the fight and does not ship.
#   2. **No frozen fixture module may change at all.** `src/testSupport/
#      frozenFixtures/**` is byte-compared against BASE. These are the canonical
#      traces; they are covered by (1) for their hashes and by the path list for
#      everything else, and this is the third rope because re-recording a
#      fixture is the exact shortcut that would make a red suite go green
#      without making the claim true.
#   3. **No screenshot may change.** `tests/__screenshots__/**` is byte-compared
#      against BASE. `playwright test -u` must never have been run on this
#      branch. A refreshed still is a rendered bout that differs, which is a
#      bout that differs.
#   4. **No band, no seed count.** Every balance and cohort file --
#      `dispositionBalance.test.ts`, `seasonBalance.test.ts`, `balance.test.ts`,
#      `src/testSupport/balanceCohorts.ts` -- is CLOSED by the path list and
#      exempt from nothing, so its thresholds and seed counts cannot move. This
#      project has been bitten by an underpowered threshold before -- a bar 0.22
#      sigma above its baseline that flipped on a re-run with no code change --
#      and a split that widened a band to accommodate an "inert" change would be
#      the same defect wearing a different hat.
#
# Checks 1-3 run against the working tree, not only against HEAD, so a value
# edited and left unstaged is caught too.
#
# ---------------------------------------------------------------------------
# WHAT A REVIEWER MUST CHECK, BECAUSE THIS GATE CANNOT
# ---------------------------------------------------------------------------
#
#   1. **That the fast suite is GREEN, not merely unchanged.** This gate proves
#      no pinned value moved in the SOURCE. Only a green run proves the kernel
#      still produces those values. The two together are the claim; either alone
#      is half of it. `main` stands at 838 tests over 39 files; this branch must
#      be 838 plus the inert tests it brings, with the same 39-plus files.
#   2. **That nothing shove-shaped came across.** `AttackActionId`, the
#      catalogue entry, the `no-damage` contact branch, the poses, the audio cue
#      and the feed wording all stay on `feature/shield-shove`. The path list
#      closes `src/content/**` and `src/presentation/**` (bar one test file)
#      which forbids most of it structurally, but `encounter.ts` is exempt and a
#      reviewer should read its diff for a `no-damage` branch specifically.
#   3. **That `classifyContactOutcome` did not come across.** The parked branch
#      changed it to read `fighter-staggered` rather than `damage-dealt`, which
#      reclassifies a no-damage contact from `target-unavailable` to `hit`. With
#      no no-damage action in the catalogue it cannot fire -- but "cannot fire
#      today" is a property of the content, not of the code, and this branch
#      does not ship a behaviour change that is merely dormant. The DOC that
#      describes the distinction comes across; the classifier does not.
#   4. **That no fixture was re-recorded anywhere off this list.** Checks 2 and
#      3 name the two directories this repo freezes today. A fourth would need
#      adding here.
set -euo pipefail
BASE="${1:?base sha required}"

FORBIDDEN='^(src/|scripts/|tests/|\.github/workflows/|index\.html$|playwright\.config\.ts$|vite\.config\.ts$|package(-lock)?\.json$)'
EXEMPT='^(scripts/check-allowlist\.sh$|scripts/measure-distance\.ts$|scripts/measure-reach\.ts$|src/simulation/encounter(\.test)?\.ts$|src/simulation/combatDecision\.ts$|src/simulation/contactDiagnostics\.ts$|src/simulation/disengageDiagnostics(\.test)?\.ts$|src/testSupport/disengageGates(\.test)?\.ts$|src/testSupport/shoveGates(\.test)?\.ts$|src/presentation/ArenaCamera\.test\.ts$)'

# Committed + staged + unstaged + untracked, and both sides of every rename.
CHANGED="$( { git diff --name-status -z --find-renames "$BASE" HEAD; git diff --name-status -z --find-renames HEAD; git diff --name-status -z --find-renames --cached; } \
  | tr '\0' '\n' | grep -vE '^[A-Z][0-9]*$' | sort -u )"
UNTRACKED="$(git ls-files --others --exclude-standard)"
VIOLATIONS="$(printf '%s\n%s\n' "$CHANGED" "$UNTRACKED" | grep -v '^$' | grep -E "$FORBIDDEN" | grep -vE "$EXEMPT" || true)"
if [ -n "$VIOLATIONS" ]; then echo "Forbidden for this slice:" >&2; echo "$VIOLATIONS" >&2; exit 1; fi

# (1) No digest may change. Working tree vs BASE, as multisets.
digests_at_base() { git grep -oh -E '[0-9a-f]{8}' "$BASE" -- src tests | grep -xE '[0-9a-f]{8}' | grep -E '[a-f]' | sort | uniq -c; }
digests_in_tree() { git grep -oh -E '[0-9a-f]{8}' -- src tests | grep -xE '[0-9a-f]{8}' | grep -E '[a-f]' | sort | uniq -c; }
if ! DIGEST_DIFF="$(diff <(digests_at_base) <(digests_in_tree))"; then
  echo "A frozen digest moved. This branch claims byte-identical determinism with $BASE:" >&2
  echo "$DIGEST_DIFF" >&2
  exit 1
fi

# (2) and (3) No frozen fixture module and no screenshot may change, at all.
FROZEN="$(git diff --name-only "$BASE" -- src/testSupport/frozenFixtures tests/__screenshots__)"
if [ -n "$FROZEN" ]; then
  echo "A frozen fixture or screenshot was re-recorded; this branch may not re-record any:" >&2
  echo "$FROZEN" >&2
  exit 1
fi

echo "allowlist ok"
