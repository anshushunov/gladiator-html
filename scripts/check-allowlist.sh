#!/usr/bin/env bash
# scripts/check-allowlist.sh — the paths this slice may not touch.
#
# RE-SCOPED for the Linux-baseline re-capture (2026-08-28). Rebuilt from
# scratch, as every slice rebuilds it, because the shape follows the claim.
#
# ---------------------------------------------------------------------------
# WHY THIS SLICE EXISTS, since it is a debt rather than a plan
# ---------------------------------------------------------------------------
#
# Two Linux screenshot baselines are stale on `main`: `planning.png` and the
# season board, 5% of pixels against a `maxDiffPixelRatio` of 0.002. They are
# stale for a reason worth writing down rather than fixing quietly.
#
# `update-baselines.yml` exists precisely because baselines captured in
# `mcr.microsoft.com/playwright:v1.62.1-noble` render text differently from the
# `ubuntu-latest` runner that compares them -- its own header says so. The
# retiarius-reach content PR nevertheless refreshed them the other way:
# commit `18fa19f`, "refresh the Linux visual baselines in the clean
# container".
#
# Nobody caught it because THE E2E STEP NEVER RAN. `npm run check` is
# `test && build && test:e2e`, the camera metric was failing `npm test`, and CI
# stopped there. PR #17 went through four CI runs, all red at the same unit
# test, and was merged anyway; the last green run on `main` is `8d57619`, the
# merge before it. The measurement-repair slice turned `npm test` green, CI
# reached e2e for the first time in a week, and these two surfaced immediately.
#
# So the honest framing: this is not a new failure, it is the first look at an
# old one. Recorded here because the same shape -- a gate that cannot report
# because an earlier gate is already red -- will happen again, and a list that
# said only "PNGs may move" would lose the reason.
#
# ---------------------------------------------------------------------------
# WHAT THIS LIST PROTECTS
# ---------------------------------------------------------------------------
#
# The claim is the narrowest this repository has made: the Linux baselines are
# re-captured on the runner image that compares them, and NOTHING ELSE CHANGES
# AT ALL. A re-baseline is only trustworthy if the thing being baselined did
# not move in the same diff -- otherwise "the screenshots now match" says
# nothing about whether they match the right picture.
#
# So the denylist is everything under `src/`, `scripts/`, `tests/` and
# `.github/workflows/`, with two exemptions and no others:
#
#   * `tests/__screenshots__/linux/**` -- the artefact being re-captured, and
#     ONLY the Linux set. `win32` stays closed, mirroring the rule
#     `update-baselines.yml` enforces on itself: "a run here must never touch
#     the win32 baselines a developer captured on their own machine". A slice
#     that moved both could not tell a genuine content change from a
#     runner-image difference, which is the exact confusion that produced this
#     debt.
#   * `scripts/check-allowlist.sh` -- a gate that cannot maintain itself cannot
#     be enforced at all, as every revision of this file has said.
#
# `docs/**` is open. Recording what was found is not a lever on the finding.
#
# `.github/workflows/` is CLOSED here, unlike in every previous revision. The
# workflow that captures these baselines is the instrument of this slice, and
# the slice before this one established the rule the hard way: an instrument
# may not be adjusted in the diff whose numbers it produces. If
# `update-baselines.yml` turns out to need a change, that is a finding and a
# separate PR.
#
# THE PNGs MUST COME FROM `update-baselines.yml`, not from a local run and not
# from a container. This script cannot enforce that -- it sees which paths
# moved, not where the bytes came from -- so it is stated here and belongs in
# the PR description as evidence: the workflow run id that produced them.
# Guessing at a matching local image is the ten-minute round trip that workflow
# was written to abolish.
#
# ---------------------------------------------------------------------------
# WHAT A REVIEWER MUST CHECK, BECAUSE THIS GATE CANNOT
# ---------------------------------------------------------------------------
#
# This list proves the diff is PNGs and prose. It CANNOT prove the new PNGs are
# right, and a green gate here must not be read as saying so. Two questions
# stay human:
#
#   1. Does the diff look like the content change it should? Every `maxHp` rose
#      in the retiarius-reach slice, so the planning screen's stat cards are
#      expected to move. A diff that moved layout, fonts or colours instead is
#      a different finding and a different slice.
#   2. Is the season board the same story? It was not predicted, only observed.
set -euo pipefail
BASE="${1:?base sha required}"
FORBIDDEN='^(src/|scripts/|tests/|\.github/workflows/|index\.html$|playwright\.config\.ts$|package(-lock)?\.json$)'
EXEMPT='^(tests/__screenshots__/linux/|scripts/check-allowlist\.sh$)'
# Committed + staged + unstaged + untracked, and both sides of every rename.
CHANGED="$( { git diff --name-status -z --find-renames "$BASE" HEAD; git diff --name-status -z --find-renames HEAD; git diff --name-status -z --find-renames --cached; } \
  | tr '\0' '\n' | grep -vE '^[A-Z][0-9]*$' | sort -u )"
UNTRACKED="$(git ls-files --others --exclude-standard)"
VIOLATIONS="$(printf '%s\n%s\n' "$CHANGED" "$UNTRACKED" | grep -v '^$' | grep -E "$FORBIDDEN" | grep -vE "$EXEMPT" || true)"
if [ -n "$VIOLATIONS" ]; then echo "Forbidden for this slice:" >&2; echo "$VIOLATIONS" >&2; exit 1; fi
echo "allowlist ok"
