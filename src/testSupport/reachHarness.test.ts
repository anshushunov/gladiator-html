import { describe, expect, it } from 'vitest'
import { COMBAT_STYLES } from '../content/combatStyles'
import { applyOverlay, deepMerge, GEOMETRY_FAILURE, REACHED } from './reachHarness'
import type { ContactOutcome } from '../simulation/contactDiagnostics'

describe('reach harness', () => {
  it('partitions every contact outcome exactly once', () => {
    // An outcome in neither set is silently dropped from both the sample and
    // the geometry-failure denominator; an outcome in both is double-counted.
    const all: ContactOutcome[] = ['hit', 'blocked', 'parried', 'evaded', 'missed-geometry', 'missed-accuracy', 'target-unavailable', 'actor-defeated']
    for (const outcome of all) {
      expect(REACHED.has(outcome) && GEOMETRY_FAILURE.has(outcome), outcome).toBe(false)
    }
    expect([...REACHED]).toEqual(['hit', 'blocked', 'parried', 'missed-accuracy'])
    expect([...GEOMETRY_FAILURE]).toEqual(['missed-geometry', 'evaded'])
  })

  it('deep-merges a nested patch instead of replacing the object', () => {
    // `Object.assign` was the original bug: patching only `max` dropped `min`.
    const base = { contactRange: { min: 0.9, max: 1.45 }, rootTravel: 1.4 }
    deepMerge(base as unknown as Record<string, unknown>, { contactRange: { max: 2.4 } })
    expect(base).toEqual({ contactRange: { min: 0.9, max: 2.4 }, rootTravel: 1.4 })
  })

  it('produces the same catalog as a direct edit would', () => {
    const overlaid = applyOverlay(structuredClone(COMBAT_STYLES) as never, {
      attacks: { 'fast-burst-lunge': { contactRange: { min: 1.6, max: 2.4 }, rootTravel: 0.5, startMaxRange: 4.0 } },
    })
    const direct = structuredClone(COMBAT_STYLES) as never as { attacks: Record<string, Record<string, unknown>> }
    direct.attacks['fast-burst-lunge'].contactRange = { min: 1.6, max: 2.4 }
    direct.attacks['fast-burst-lunge'].rootTravel = 0.5
    direct.attacks['fast-burst-lunge'].startMaxRange = 4.0
    expect(overlaid).toEqual(direct)
  })

  it('rejects an overlay naming an unknown action', () => {
    expect(() => applyOverlay(structuredClone(COMBAT_STYLES) as never, { attacks: { 'fast-trident-poke': {} } }))
      .toThrow(/unknown attack/)
  })

  it('rejects an overlay that makes the catalog invalid', () => {
    // `startMaxRange` must be >= `contactRange.max`; a candidate that violates
    // an authored invariant must fail loudly rather than produce numbers.
    expect(() => applyOverlay(structuredClone(COMBAT_STYLES) as never, {
      attacks: { 'fast-burst-lunge': { contactRange: { min: 0.9, max: 3.5 } } },
    })).toThrow(/startMaxRange/)
  })

  it('rejects a misspelled field rather than merging it in as a new key', () => {
    // Kept from the script rather than dropped in the extraction, and tested
    // here because it is the one overlay defect that produces NO error and NO
    // visible difference: `validateCombatStyleCatalog` ignores fields it does
    // not know, so `rootTravl` would validate cleanly and the candidate would
    // measure exactly like the unpatched catalog -- a sweep reporting the
    // baseline as a candidate result.
    expect(() => applyOverlay(structuredClone(COMBAT_STYLES) as never, {
      attacks: { 'fast-burst-lunge': { rootTravl: 0.5 } },
    })).toThrow(/unknown field 'attacks\.fast-burst-lunge\.rootTravl'/)
    expect(() => applyOverlay(structuredClone(COMBAT_STYLES) as never, {
      attacks: { 'fast-burst-lunge': { contactRange: { mn: 1.6 } } },
    })).toThrow(/unknown field 'attacks\.fast-burst-lunge\.contactRange\.mn'/)
  })

  it('rejects an unknown top-level overlay key', () => {
    expect(() => applyOverlay(structuredClone(COMBAT_STYLES) as never, { defenses: {} } as never))
      .toThrow(/unknown top-level key 'defenses'/)
  })
})
