// Where the fight actually takes place, as opposed to where blows land.
//
// The reach gates in `scripts/measure-reach.ts` all answer one shape of
// question: "when a blow landed, how far apart were the fighters?" The
// retiarius-reach playtest found that this is not the question a viewer asks --
// they do not see a conditional distribution over contacts, they see two figures
// and the ground between them -- and that the two answers can point in opposite
// directions. Against the murmillo every reach gate went green while the pair
// never separated at all, because the blows that used to land at 0.90 became
// geometry misses rather than the fight moving out.
//
// So this module is the other measurement: the separation on EVERY tick,
// reported per ordered matchup. It is deliberately a sibling of
// `reachHarness.ts` rather than part of it -- that module is about contacts and
// this one is about time -- and it follows the same rule for what lives here
// rather than in `scripts/`: `scripts/` is outside tsconfig's `include`, so
// nothing there is typechecked by `npm run build` or reachable by Vitest. The
// three pieces below can each be silently wrong in a way that moves the headline
// number without failing anything, so all three live here with regressions.
//
//  * THE BAND EDGES. Every edge is derived from the catalog being measured, and
//    from the PATCHED catalog when there is an overlay. `measure-reach.ts`
//    records why (its `ENVELOPE` comment): reading a yardstick from the
//    unpatched global means a candidate that moves the murmillo is judged
//    against the murmillo it replaced. A literal `1.7` in this file would be the
//    same defect with no overlay required.
//
//  * THE ENGAGED WINDOW. A duel opens at ~8.4 units and the fighters walk in.
//    Those ticks are not "where the fight takes place", and how many of them
//    there are depends on how fast each pairing closes -- so counting them makes
//    the metric partly a measurement of approach speed, and does it unevenly per
//    matchup, which is exactly the per-pair distortion this instrument exists to
//    remove. The window therefore starts at the first local resolution. That
//    definition is NOT invented here: it is the one `balanceCohorts.runBout`
//    already uses to read design.md's "at most 300 ticks after initial
//    approach", down to the `max(lastResolutionTick) > 0` predicate. A second
//    definition of when a fight starts would be a second answer to the same
//    question.
//
//  * THE CLASSIFICATION. `pinned`, `lunge-band` and `beyond` partition the line;
//    an off-by-one at an edge moves the headline share silently, and the edges
//    are exactly the numbers under discussion (1.60 and 2.40). The boundaries
//    are half-open in a stated direction and the regression asserts each edge
//    value individually.

import type { CombatStyleCatalog } from '../simulation/combatActions'
import type { CombatantId, FighterCombatState } from '../simulation/encounter'

/**
 * The distances this slice argues about, all read from the catalog under
 * measurement.
 *
 * `pinFloor` is the retiarius' committed `contactRange.min`: below it his
 * signature attack is not merely unlikely, it is **illegal** (`combatDecision.ts`
 * rejects it in `legalActionCandidates`). That makes "share of ticks below
 * `pinFloor`" the one statistic that states this slice's problem without
 * interpretation -- it is the share of the fight in which the retiarius cannot
 * commit at all.
 *
 * `murmilloEnvelope` is the murmillo's `preferredRange.max`: the distance he is
 * scored to fight at. It is the edge the playtest's own table used, kept so that
 * this instrument's numbers can be compared with that document's.
 *
 * The two are deliberately different numbers (1.60 and 1.70 on the shipped
 * content) and are deliberately not reconciled. They answer different questions
 * and a candidate can move one without moving the other.
 */
export interface DistanceBands {
  /** `fast-burst-lunge.contactRange.min` -- below this the retiarius' committed attack is illegal. */
  pinFloor: number
  /** `fast-burst-lunge.contactRange.max` -- the far edge of the trident's own band. */
  lungeCeiling: number
  /** `heavy.preferredRange.max` -- the murmillo's fighting distance. */
  murmilloEnvelope: number
}

export function distanceBands(catalog: CombatStyleCatalog): DistanceBands {
  const lunge = catalog.attacks['fast-burst-lunge']
  return {
    pinFloor: lunge.contactRange.min,
    lungeCeiling: lunge.contactRange.max,
    murmilloEnvelope: catalog.styles.heavy.preferredRange.max,
  }
}

/**
 * Where one tick sits, as a partition of the line: every separation falls in
 * exactly one of these and the three shares sum to 1.
 *
 * Half-open upward, so a separation exactly at `pinFloor` is `lunge-band` and
 * one exactly at `lungeCeiling` is `lunge-band` too. That matches how the kernel
 * reads the same numbers -- `contactRange` is inclusive at both ends in
 * `legalActionCandidates` -- so a tick classified `lunge-band` here is a tick on
 * which the lunge would have been legal on range, which is the property that
 * makes the share mean anything.
 */
export type DistanceBand = 'pinned' | 'lunge-band' | 'beyond'

export function classifySeparation(separation: number, bands: Readonly<DistanceBands>): DistanceBand {
  if (separation < bands.pinFloor) return 'pinned'
  if (separation <= bands.lungeCeiling) return 'lunge-band'
  return 'beyond'
}

/**
 * Inside the murmillo's fighting distance. Reported as its own share rather than
 * as a band because it OVERLAPS `pinned` -- on the shipped content 1.60 and 1.70
 * differ, so the ticks between them are both "the retiarius can legally lunge"
 * and "the murmillo is at home". Folding the two edges into one partition would
 * hide exactly that sliver, and it is the sliver the whole matchup is fought in.
 *
 * Inclusive at the edge, matching `preferredRangeState` in `combatDecision.ts`,
 * which treats `distance > range.max` as above the band and therefore a
 * separation exactly at `max` as inside it.
 */
export function isInsideMurmilloEnvelope(separation: number, bands: Readonly<DistanceBands>): boolean {
  return separation <= bands.murmilloEnvelope
}

/**
 * Has this bout's opening approach finished?
 *
 * Read off the combatants' own `lastResolutionTick` clocks, which the kernel
 * updates for both living participants on every hit, block, parry, evade,
 * geometry miss and accuracy miss. The predicate is `max(...) > 0`, character
 * for character what `balanceCohorts.runBout` uses to find
 * `firstResolutionTick`, and for the same stated reason: "the opening walk from
 * the duel's 8.4-unit start separation is not a stall" -- and, here, not part of
 * where the fight takes place either.
 *
 * Sharing the definition is the point. Two instruments that disagree about when
 * a fight begins produce two incomparable pictures of the same bout, and this
 * slice exists because two instruments already disagreed about where one was
 * fought.
 */
export function hasEngaged(
  combatants: Readonly<Record<CombatantId, FighterCombatState>>,
  ids: readonly CombatantId[],
): boolean {
  for (const id of ids) {
    if (combatants[id].lastResolutionTick > 0) return true
  }
  return false
}

/**
 * One matchup's time-at-distance, accumulated a tick at a time.
 *
 * `separations` holds every sample rather than a histogram, and the percentiles
 * are taken with `balanceCohorts.percentile` over the sorted array. A histogram
 * would be cheaper and would require this file to carry its own percentile
 * implementation, which is the thing `measure-reach.ts` explicitly refuses to do
 * ("percentiles from `balanceCohorts.percentile`, imported rather than
 * reimplemented"). At 200 seeds a matchup holds on the order of 400 000 numbers,
 * which is nothing, and the arithmetic is then the same arithmetic every other
 * measurement in this repository uses.
 */
export interface DistanceAccumulator {
  separations: number[]
  pinned: number
  lungeBand: number
  beyond: number
  insideEnvelope: number
  /** Bouts contributing to this accumulator, and those that never engaged at all. */
  bouts: number
  unengagedBouts: number
}

export function emptyAccumulator(): DistanceAccumulator {
  return { separations: [], pinned: 0, lungeBand: 0, beyond: 0, insideEnvelope: 0, bouts: 0, unengagedBouts: 0 }
}

export function accumulate(into: DistanceAccumulator, separation: number, bands: Readonly<DistanceBands>): void {
  into.separations.push(separation)
  const band = classifySeparation(separation, bands)
  if (band === 'pinned') into.pinned += 1
  else if (band === 'lunge-band') into.lungeBand += 1
  else into.beyond += 1
  if (isInsideMurmilloEnvelope(separation, bands)) into.insideEnvelope += 1
}

export interface DistanceSummary {
  ticks: number
  bouts: number
  unengagedBouts: number
  median: number
  p10: number
  p90: number
  /** Share of ticks below the retiarius' committed floor -- his signature attack is illegal. */
  pinnedShare: number
  lungeBandShare: number
  beyondShare: number
  /** Share of ticks inside the murmillo's fighting distance. Overlaps `pinnedShare`. */
  insideEnvelopeShare: number
}

/**
 * `percentileOf` is injected rather than imported so this module stays free of
 * `balanceCohorts`' own imports of content and battle code; the one caller
 * passes `balanceCohorts.percentile` itself, so there is still exactly one
 * percentile implementation in the repository.
 */
export function summarise(
  accumulator: Readonly<DistanceAccumulator>,
  percentileOf: (sorted: readonly number[], fraction: number) => number,
): DistanceSummary | undefined {
  const ticks = accumulator.separations.length
  if (ticks === 0) return undefined
  const sorted = [...accumulator.separations].sort((a, b) => a - b)
  return {
    ticks,
    bouts: accumulator.bouts,
    unengagedBouts: accumulator.unengagedBouts,
    median: percentileOf(sorted, 0.5),
    p10: percentileOf(sorted, 0.1),
    p90: percentileOf(sorted, 0.9),
    pinnedShare: accumulator.pinned / ticks,
    lungeBandShare: accumulator.lungeBand / ticks,
    beyondShare: accumulator.beyond / ticks,
    insideEnvelopeShare: accumulator.insideEnvelope / ticks,
  }
}
