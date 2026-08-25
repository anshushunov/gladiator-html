#!/usr/bin/env bash
# scripts/check-allowlist.sh — the paths this slice may not touch.
#
# RE-SCOPED for the retiarius-reach slice. The list is per-slice by
# construction (the readable-types slice's own header said so, and its final
# review recorded that "a slice that legitimately edits `src/simulation/**` --
# including this one -- must widen or remove that step before its first PR").
# What changed is not just the contents but the SHAPE, so the reason is worth
# stating rather than leaving to be inferred from the regex.
#
# The readable-types slice was presentational and changed no behaviour. Its
# list was therefore an ALLOWLIST whose job was to keep the diff out of
# `src/simulation/**`, `src/content/**` and `src/style.css` -- the files that
# could have made the "same behaviour, presented differently" claim untrue.
#
# This slice is the exact inverse: it changes behaviour on purpose, and every
# path that list protected is a path this one must edit. An allowlist rebuilt
# around that would have to admit nearly the whole tree, which is theatre --
# a gate that forbids nothing reads as a gate that passed.
#
# So the shape flips to a DENYLIST, and it protects the opposite thing. This
# slice's attribution risk is not "did behaviour change" (it must) but "was the
# change actually behavioural, or was it quietly helped along by presentation".
# Three paths carry that risk, and all three are forbidden:
#
#   src/style.css
#     The arena canvas is 730x518 inside a 1280x820 page. The readable-types
#     final review named growing it "the largest remaining lever on legibility
#     per unit of risk". It is a real lever and it belongs to its own slice; a
#     bout that reads better because the canvas grew would tell us nothing
#     about whether the retiarius' reach reads.
#
#   src/presentation/ProceduralFighter.ts
#     Equipment and silhouette authoring. Trident and spear do not separate at
#     the shipped framing (the fork resolves at ~2x), and this slice's premise
#     is that BEHAVIOUR separates the pair even while the silhouette does not.
#     Redrawing the props would answer the same question a different way and
#     make the two answers inseparable.
#
#   src/presentation/ArenaCamera.ts
#     Its constants were swept against 46,647 recorded ticks and frozen. Giving
#     the retiarius real reach widens the pair separations the camera sees, and
#     the claim that the existing flat band absorbs that without retuning is
#     worth testing rather than assuming. Forbidding the file turns that claim
#     into an assertion the suite has to make -- if the camera genuinely needs
#     to move, that is a finding to report, not a constant to nudge.
#
# Everything else is open, including `src/simulation/**`, `src/content/**`,
# `src/testSupport/**` and the frozen hash literals, all of which this slice
# is expected to move. `.github/` and `playwright.config.ts` stay reachable for
# the same reason the previous list admitted them: the gate has to be able to
# maintain itself.
set -euo pipefail
BASE="${1:?base sha required}"
FORBIDDEN='^(src/style\.css$|src/presentation/ProceduralFighter\.ts$|src/presentation/ArenaCamera\.ts$)'
# Committed + staged + unstaged + untracked, and both sides of every rename.
CHANGED="$( { git diff --name-status -z --find-renames "$BASE" HEAD; git diff --name-status -z --find-renames HEAD; git diff --name-status -z --find-renames --cached; } \
  | tr '\0' '\n' | grep -vE '^[A-Z][0-9]*$' | sort -u )"
UNTRACKED="$(git ls-files --others --exclude-standard)"
VIOLATIONS="$(printf '%s\n%s\n' "$CHANGED" "$UNTRACKED" | grep -v '^$' | grep -E "$FORBIDDEN" || true)"
if [ -n "$VIOLATIONS" ]; then echo "Forbidden for this slice:" >&2; echo "$VIOLATIONS" >&2; exit 1; fi
echo "allowlist ok"
