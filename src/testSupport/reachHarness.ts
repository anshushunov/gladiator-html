// The parts of the reach harness that can be silently wrong, lifted out of
// `scripts/measure-reach.ts` so they are typechecked by `npm run build` and
// reachable by Vitest. `scripts/` is outside tsconfig's `include`, so nothing
// that lives there is either.
//
// Two pieces qualify, and both have a history:
//
//  * THE OUTCOME PARTITION. Which contact outcomes mean "the weapon reached"
//    decides the numerator of every reach statistic AND the denominator of the
//    geometry-failure rate. An outcome in neither set is dropped from both; an
//    outcome in both is counted twice. External review found `evaded` on the
//    wrong side of this line, which inflated every reach figure in the spec's
//    first draft.
//
//  * THE OVERLAY MERGE. `Object.assign` was the original implementation and was
//    wrong: patching `{contactRange: {max}}` replaced the whole `contactRange`,
//    silently dropping `min`. The strict unknown-key check is the same class of
//    defect caught a second time -- `validateCombatStyleCatalog` ignores fields
//    it does not know, so a typo like `rootTravl` merges in as a new key,
//    validates cleanly, and produces a candidate that measures exactly like the
//    unpatched catalog. A sweep would then report the baseline as a candidate
//    result, which is the failure mode this slice is least able to notice.

import { validateCombatStyleCatalog, type CombatStyleCatalog } from '../simulation/combatActions'
import type { ContactOutcome } from '../simulation/contactDiagnostics'

/** Outcomes in which the weapon reached the target at the recorded separation. */
export const REACHED: ReadonlySet<ContactOutcome> = new Set<ContactOutcome>(['hit', 'blocked', 'parried', 'missed-accuracy'])

/** Outcomes in which it did not, and which the geometry-failure rate is computed over. */
export const GEOMETRY_FAILURE: ReadonlySet<ContactOutcome> = new Set<ContactOutcome>(['missed-geometry', 'evaded'])

/**
 * The duel arena, so an overlay that violates a catalog invariant fails here
 * rather than producing plausible-looking numbers.
 */
const DUEL_ARENA = { radius: 6.5, lateralLimit: 2.5, minimumSeparation: 0.9, movementPolicy: 'ordered-pair' } as const

type Json = Record<string, unknown>

function isPlainObject(value: unknown): value is Json {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

/** Recursive merge over plain objects, replacing leaves. */
export function deepMerge(base: Record<string, unknown>, patch: Record<string, unknown>): void {
  for (const [key, value] of Object.entries(patch)) {
    const existing = base[key]
    if (isPlainObject(value) && isPlainObject(existing)) {
      deepMerge(existing, value)
    } else {
      base[key] = value
    }
  }
}

/** Every key a patch names must already exist on the target, at every depth. */
function requireKnownKeys(patch: Json, target: Json, path: string): void {
  for (const [key, value] of Object.entries(patch)) {
    if (!(key in target)) throw new Error(`overlay sets unknown field '${path}.${key}'`)
    const existing = target[key]
    if (isPlainObject(value) && isPlainObject(existing)) {
      requireKnownKeys(value, existing, `${path}.${key}`)
    }
  }
}

/**
 * Deep-merges a partial `{ attacks?, styles? }` into `catalog` IN PLACE and
 * validates the result. Callers pass a clone; the return value is the same
 * object, typed as a catalog again.
 */
export function applyOverlay(
  catalog: CombatStyleCatalog,
  overlay: { attacks?: Record<string, unknown>; styles?: Record<string, unknown> },
): CombatStyleCatalog {
  const attacks = catalog.attacks as unknown as Json
  const styles = catalog.styles as unknown as Json
  for (const key of Object.keys(overlay)) {
    if (key !== 'attacks' && key !== 'styles') throw new Error(`overlay has unknown top-level key '${key}'; expected 'attacks' or 'styles'`)
  }
  for (const [id, patch] of Object.entries(overlay.attacks ?? {})) {
    if (!(id in attacks)) throw new Error(`overlay patches unknown attack '${id}'`)
    requireKnownKeys(patch as Json, attacks[id] as Json, `attacks.${id}`)
    deepMerge(attacks[id] as Json, patch as Json)
  }
  for (const [id, patch] of Object.entries(overlay.styles ?? {})) {
    if (!(id in styles)) throw new Error(`overlay patches unknown style '${id}'`)
    requireKnownKeys(patch as Json, styles[id] as Json, `styles.${id}`)
    deepMerge(styles[id] as Json, patch as Json)
  }
  validateCombatStyleCatalog(catalog, DUEL_ARENA)
  return catalog
}
