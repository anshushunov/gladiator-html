#!/usr/bin/env bash
# scripts/check-allowlist.sh — every path this slice is allowed to touch.
set -euo pipefail
BASE="${1:?base sha required}"
ALLOWED='^(src/presentation/|src/main\.ts$|src/testSupport/stateHash|scripts/(check-allowlist\.sh|measure-framing\.ts|record-blinded-stills\.ts|record-review-clips\.ts)$|tests/|docs/|README\.md$|package\.json$)'
# Committed + staged + unstaged + untracked, and both sides of every rename.
CHANGED="$( { git diff --name-status -z --find-renames "$BASE" HEAD; git diff --name-status -z --find-renames HEAD; git diff --name-status -z --find-renames --cached; } \
  | tr '\0' '\n' | grep -vE '^[A-Z][0-9]*$' | sort -u )"
UNTRACKED="$(git ls-files --others --exclude-standard)"
VIOLATIONS="$(printf '%s\n%s\n' "$CHANGED" "$UNTRACKED" | grep -v '^$' | grep -vE "$ALLOWED" || true)"
if [ -n "$VIOLATIONS" ]; then echo "Not on the slice allowlist:" >&2; echo "$VIOLATIONS" >&2; exit 1; fi
echo "allowlist ok"
