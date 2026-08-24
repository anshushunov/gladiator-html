#!/usr/bin/env bash
# scripts/check-allowlist.sh — every path this slice is allowed to touch.
set -euo pipefail
BASE="${1:?base sha required}"
# `playwright.config.ts` was added in Task 8's fix round 1, on the coordinator's
# explicit instruction to fix the handoff gate here rather than defer it: the
# legibility acceptance file saturates every core for 11-13 minutes, so at
# default workers the other spec files blow their 30 s timeouts and
# `npm run check` fails ~7 tests with nothing regressed. The fix is `workers: 1`
# in that file (see its own comment for the measurements and for why a
# `dependencies:` project split was rejected). It is admitted here deliberately
# and narrowly: it is test-runner configuration, it cannot change what the game
# does, and this list exists to keep the slice out of `src/simulation/**`,
# `src/content/**` and `src/style.css`.
ALLOWED='^(src/presentation/|src/main\.ts$|src/testSupport/stateHash|scripts/(check-allowlist\.sh|measure-framing\.ts|record-blinded-stills\.ts|record-review-clips\.ts)$|tests/|docs/|README\.md$|package\.json$|playwright\.config\.ts$)'
# Committed + staged + unstaged + untracked, and both sides of every rename.
CHANGED="$( { git diff --name-status -z --find-renames "$BASE" HEAD; git diff --name-status -z --find-renames HEAD; git diff --name-status -z --find-renames --cached; } \
  | tr '\0' '\n' | grep -vE '^[A-Z][0-9]*$' | sort -u )"
UNTRACKED="$(git ls-files --others --exclude-standard)"
VIOLATIONS="$(printf '%s\n%s\n' "$CHANGED" "$UNTRACKED" | grep -v '^$' | grep -vE "$ALLOWED" || true)"
if [ -n "$VIOLATIONS" ]; then echo "Not on the slice allowlist:" >&2; echo "$VIOLATIONS" >&2; exit 1; fi
echo "allowlist ok"
