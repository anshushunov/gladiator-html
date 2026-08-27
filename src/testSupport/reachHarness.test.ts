import { describe, expect, it } from 'vitest'
import { COMBAT_STYLES } from '../content/combatStyles'
import { BASELINE_TEST_SEED } from '../content/mvpSeries'
import {
  applyOverlay,
  deepMerge,
  GEOMETRY_FAILURE,
  independentComparatorMatchups,
  matchupLabel,
  REACHED,
} from './reachHarness'
import { canonicalHash } from './stateHash'
import { advanceBattleTick, createBattle, MAX_BOUT_TICKS } from '../simulation/battle'
import type { CombatStyleCatalog } from '../simulation/combatActions'
import type { ContactCollector, ContactOutcome, ContactRecord } from '../simulation/contactDiagnostics'
import type { Archetype, FighterDefinition } from '../simulation/fighters'

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
    //
    // The violating `max` is derived from the catalog rather than written as a
    // literal. It was `3.5`, chosen when `startMaxRange` was 2.8; the content
    // slice moved that field to 4.0, and 3.5 quietly stopped violating
    // anything -- the test then asserted that a VALID overlay throws, which is
    // the opposite of its own name.
    const startMax = COMBAT_STYLES.attacks['fast-burst-lunge'].startMaxRange as number
    expect(() => applyOverlay(structuredClone(COMBAT_STYLES) as never, {
      attacks: { 'fast-burst-lunge': { contactRange: { min: 0.9, max: startMax + 0.5 } } },
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

// ---------------------------------------------------------------------------
// Comparator independence
// ---------------------------------------------------------------------------

/** `scripts/measure-reach.ts`'s `STYLES`, in its order. A literal, not an
 * import: the script is outside tsconfig's `include`, and the point of these
 * tests is to pin the grid the comparator is selected out of. */
const STYLES: readonly Archetype[] = ['heavy', 'fast', 'technical']

/** The slice's subject and its yardstick, spelled as the script spells them. */
const SUBJECT: Archetype = 'fast'
const COMPARATOR: Archetype = 'technical'

/** `scripts/measure-reach.ts`'s equal-stat fixture, copied for the same reason
 * it copies it from `balance.test.ts`: fighter tuning must not be able to move
 * a reach measurement. */
function equalStatFighter(id: string, archetype: Archetype): FighterDefinition {
  return { id, name: id, school: 'Style Cohort', archetype, maxHp: 160, power: 20, accuracy: 0.88, defenseChance: 0.35, criticalChance: 0.12 }
}

/**
 * A digest of every contact record a matchup produces over `seeds` bouts --
 * the exact stream every reach statistic in the harness is computed from
 * (separations, outcomes, action ids, instance ids), so two runs with the same
 * digest cannot disagree about any figure derived from them.
 */
function contactDigest(catalog: CombatStyleCatalog, home: Archetype, away: Archetype, seeds: number): string {
  const records: ContactRecord[] = []
  const collector: ContactCollector = { record: (entry) => records.push(entry) }
  for (let index = 0; index < seeds; index += 1) {
    let battle = createBattle({
      home: equalStatFighter('home', home),
      away: equalStatFighter('away', away),
      seed: BASELINE_TEST_SEED + index,
      combatStyles: catalog,
    })
    while (battle.phase === 'running' && battle.encounter.tick < MAX_BOUT_TICKS) {
      battle = advanceBattleTick(battle, undefined, collector)
    }
  }
  return canonicalHash(records)
}

describe('comparator independence', () => {
  it('takes the hoplomachus from the fast-free matchups only', () => {
    expect(independentComparatorMatchups(COMPARATOR, SUBJECT, STYLES))
      .toEqual(['technical vs heavy', 'technical vs technical'])
  })

  it('never names a matchup containing the subject, for any comparator and subject', () => {
    // Stated over the whole grid rather than for the one pair that matters
    // today: the defect this guards against was introduced three times in prose
    // and once in code, each time by someone writing out a label set by hand.
    for (const comparator of STYLES) {
      for (const subject of STYLES) {
        if (comparator === subject) continue
        const labels = independentComparatorMatchups(comparator, subject, STYLES)
        expect(labels.length).toBeGreaterThan(0)
        for (const label of labels) {
          expect(label.split(' vs '), `${comparator} vs-subject ${subject}: ${label}`).not.toContain(subject)
        }
      }
    }
  })

  it('refuses a comparator that is its own subject rather than returning it', () => {
    // The failure this prevents is not a wrong number, it is a gate that reads
    // the subject's figure on both sides and therefore can never fail.
    expect(() => independentComparatorMatchups(COMPARATOR, COMPARATOR, STYLES))
      .toThrow(/cannot be its own yardstick/)
  })

  it('throws rather than selecting nothing when no independent matchup exists', () => {
    // An empty selection produces a `NaN` comparator, and every `<=` against
    // `NaN` is false -- so this would surface as a mysteriously failing gate
    // rather than as the harness defect it is. Named here so it surfaces as
    // itself.
    expect(() => independentComparatorMatchups(COMPARATOR, SUBJECT, [SUBJECT]))
      .toThrow(/no 'fast'-free matchup/)
  })

  it('cannot move with the retiarius: the fast-free matchups are bit-identical under an overlay that moves every fast attack', () => {
    // The structural tests above prove the SELECTION excludes the subject. This
    // proves the selection is worth making -- that a matchup with no `fast`
    // fighter in it really is invariant under a change to `fast`, so a
    // comparator read from one cannot drift toward the thing it is judging.
    //
    // Both halves matter. Without the negative control below, a broken overlay
    // (the `rootTravl` class of defect this file already guards) would make
    // every digest match and this test would pass by measuring nothing.
    const moveTheRetiarius = {
      attacks: {
        'fast-slash': { contactRange: { min: 0.9, max: 1.2 } },
        'fast-burst-lunge': { contactRange: { min: 0.9, max: 1.3 } },
      },
    }
    const baseline = applyOverlay(structuredClone(COMBAT_STYLES) as never, {})
    const moved = applyOverlay(structuredClone(COMBAT_STYLES) as never, moveTheRetiarius)
    expect(moved.attacks['fast-burst-lunge'].contactRange).not.toEqual(baseline.attacks['fast-burst-lunge'].contactRange)

    const SEEDS = 3
    for (const label of independentComparatorMatchups(COMPARATOR, SUBJECT, STYLES)) {
      const [home, away] = label.split(' vs ') as [Archetype, Archetype]
      expect(contactDigest(moved, home, away, SEEDS), label).toBe(contactDigest(baseline, home, away, SEEDS))
    }

    // Negative control: the matchups that DO contain the subject move, which is
    // exactly why the comparator may not be pooled across all nine.
    const coupled = matchupLabel(COMPARATOR, SUBJECT)
    expect(contactDigest(moved, COMPARATOR, SUBJECT, SEEDS), coupled).not.toBe(contactDigest(baseline, COMPARATOR, SUBJECT, SEEDS))
  })
})
