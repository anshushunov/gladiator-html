// The per-tick behaviour invariant's canonical serializer + rolling hash.
//
// This is the harness Task 1 of the "readable gladiator types" slice builds
// so every later task (all presentation-only) has something to check "zero
// simulated behaviour changed" against. Deliberately outside
// `src/simulation/**` (this file and its test both live in
// `src/testSupport/`) so `scripts/check-allowlist.sh`'s allowlist regex
// needs no `*.test.ts` escape hatch for the frozen simulation suite.
//
// RED (see `stateHash.test.ts`): the "obvious" version --
//   JSON.stringify(value, Object.keys(value).sort())
// -- was tried first and failed red. `Object.keys(value).sort()` passed as
// `JSON.stringify`'s second argument is an ARRAY REPLACER, which JSON treats
// as a recursive property allowlist, not a per-object key sort: any nested
// key not named in that one top-level array serialises as `{}`, so nested
// HP/position/RNG changes never moved the digest at all -- both `a` and `b`
// below hashed to `{"combatants":{}}`. `canonicalJson`'s explicit recursion
// is the fix, and this file's own self-test is what proves it actually
// works rather than merely compiling.

/** Order-independent canonical JSON: sorts keys at EVERY depth. An array
 *  replacer would instead act as a recursive property allowlist and silently
 *  hash almost nothing. */
export function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'null'
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`
  const entries = Object.entries(value as Record<string, unknown>).sort(([a], [b]) => (a < b ? -1 : 1))
  return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonicalJson(v)}`).join(',')}}`
}

export function canonicalHash(value: unknown): string {
  const json = canonicalJson(value)
  let hash = 2166136261
  for (let i = 0; i < json.length; i += 1) {
    hash ^= json.charCodeAt(i)
    hash = Math.imul(hash, 16777619)
  }
  return (hash >>> 0).toString(16)
}
