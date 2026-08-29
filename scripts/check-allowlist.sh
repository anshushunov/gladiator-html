#!/usr/bin/env bash
# scripts/check-allowlist.sh — the paths this slice may not touch.
#
# RE-SCOPED for the fast/slow test split (2026-08-29). Rebuilt from scratch, as
# every slice rebuilds it, because the shape follows the claim. Committed BEFORE
# the work it judges.
#
# ---------------------------------------------------------------------------
# THE CLAIM THIS LIST PROTECTS
# ---------------------------------------------------------------------------
#
# This slice changes WHEN tests run. It changes nothing that any test asserts.
#
# The measurement that prompted it, taken on the merge commit of the
# murmillo-pin slice:
#
#   src/simulation/dispositionBalance.test.ts    550 s
#   src/simulation/seasonBalance.test.ts         540 s
#   src/simulation/balance.test.ts               192 s
#   the other 38 unit-test files, together        48 s
#   tests/legibility.spec.ts                     12.1 min
#   the other 5 e2e spec files, together          ~1.1 min
#
# Four files are ~95% of a CI run that takes over an hour. They are Monte-Carlo
# balance cohorts and a nine-bout browser measurement, and none of them is
# wrong — they are simply not what a push needs to wait for.
#
# EXEMPTIONS, and no others:
#
#   * `.github/workflows/ci.yml` — the job split itself.
#   * `package.json` — the scripts the jobs call. `package-lock.json` stays
#     closed: this slice adds no dependency, and a lock file moving in a diff
#     that claims not to would be the first thing to disbelieve.
#   * `vite.config.ts` and `playwright.config.ts` — where the two sets are
#     declared. Both files carry long measured comments about worker counts,
#     snapshot tolerances and a REJECTED project split; those are not this
#     slice's to revise, and a reviewer should check that none of them moved.
#   * `src/testSupport/slowSuites.ts` and its test — the single list both
#     runners read, plus the guard described below.
#   * this file.
#
# ---------------------------------------------------------------------------
# THE LOAD-BEARING ENTRY: NO TEST FILE MAY CHANGE
# ---------------------------------------------------------------------------
#
# Every `*.test.ts` and every `*.spec.ts` is CLOSED, with the single exception
# of the new guard's own file. If splitting the suite required editing what a
# test asserts, weakening a band, or lowering a seed count, the claim above
# would be false — and lowering seed counts is precisely the tempting version of
# this work that is NOT being done. The bands stay at 200 and 500 seeds and keep
# their statistical power; they simply stop running on every push.
#
# This project has been bitten by an underpowered threshold before — a bar
# 0.22 sigma above its baseline that flipped on a re-run with no code change —
# so trading the cohorts' resolution for wall-clock is the one shortcut this
# list exists to forbid.
#
# `src/simulation/**`, `src/content/**` and `src/presentation/**` are closed for
# the obvious reason: a change to when tests run cannot need them.
#
# ---------------------------------------------------------------------------
# WHAT A REVIEWER MUST CHECK, BECAUSE THIS GATE CANNOT
# ---------------------------------------------------------------------------
#
#   1. **Nothing fell out of both sets.** A harness that silently does not run
#      is the exact defect `playwright.config.ts` records rejecting a project
#      split over. The guard test asserts that fast plus slow equals every file
#      on disk and that the two do not overlap — so a file added later cannot
#      quietly belong to neither. Check that the guard reads the filesystem
#      rather than a second hard-coded list.
#   2. **The slow set still runs somewhere, on a schedule someone reads.** A
#      split that moves the cohorts to a job nobody looks at has deleted them
#      with extra steps.
#   3. **No test's assertions moved.** The allowlist proves no test FILE moved,
#      which is the same thing here only because the guard's own file is new.
set -euo pipefail
BASE="${1:?base sha required}"
FORBIDDEN='^(src/|scripts/|tests/|\.github/workflows/|index\.html$|playwright\.config\.ts$|vite\.config\.ts$|package(-lock)?\.json$)'
EXEMPT='^(\.github/workflows/ci\.yml$|package\.json$|vite\.config\.ts$|playwright\.config\.ts$|src/testSupport/slowSuites(\.test)?\.ts$|scripts/check-allowlist\.sh$)'
# Committed + staged + unstaged + untracked, and both sides of every rename.
CHANGED="$( { git diff --name-status -z --find-renames "$BASE" HEAD; git diff --name-status -z --find-renames HEAD; git diff --name-status -z --find-renames --cached; } \
  | tr '\0' '\n' | grep -vE '^[A-Z][0-9]*$' | sort -u )"
UNTRACKED="$(git ls-files --others --exclude-standard)"
VIOLATIONS="$(printf '%s\n%s\n' "$CHANGED" "$UNTRACKED" | grep -v '^$' | grep -E "$FORBIDDEN" | grep -vE "$EXEMPT" || true)"
if [ -n "$VIOLATIONS" ]; then echo "Forbidden for this slice:" >&2; echo "$VIOLATIONS" >&2; exit 1; fi
echo "allowlist ok"
