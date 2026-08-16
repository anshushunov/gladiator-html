import { describe, expect, it } from 'vitest'
import { buildSpatialHash, collectCanonicalNeighborPairs, queryRadius, spatialCellKey } from './spatialHash'

describe('spatial hash', () => {
  const entries = [
    { id: 'c', position: { x: 5.0, z: 0 } },
    { id: 'a', position: { x: 0, z: 0 } },
    { id: 'b', position: { x: 2.9, z: 0 } },
  ]

  it('queries a radius within adjacent cells', () => {
    const index = buildSpatialHash(entries, 3.2)
    expect(queryRadius(index, { x: 0, z: 0 }, 3.2)).toEqual(['a', 'b'])
  })

  it('collects canonical neighbor pairs with structural candidate counts', () => {
    const index = buildSpatialHash(entries, 3.2)
    expect(collectCanonicalNeighborPairs(index)).toEqual({
      pairKeys: ['a|b', 'b|c'],
      candidateChecks: 3,
    })
  })

  it('is independent of input order', () => {
    const index = buildSpatialHash(entries, 3.2)
    expect(buildSpatialHash([...entries].reverse(), 3.2)).toEqual(index)
  })

  it('uses the default cell size of 3.2 when none is given', () => {
    const index = buildSpatialHash(entries)
    expect(index.cellSize).toBe(3.2)
  })

  it('places negative and positive coordinates near zero into different cells', () => {
    const negativeKey = spatialCellKey({ x: -0.1, z: 0 }, 3.2)
    const positiveKey = spatialCellKey({ x: 0.1, z: 0 }, 3.2)
    expect(negativeKey).not.toBe(positiveKey)
    expect(negativeKey).toBe('-1,0')
    expect(positiveKey).toBe('0,0')
  })

  it('gives distinct cells no colliding keys across a negative/positive grid', () => {
    const points = [
      { x: -3.2, z: -3.2 },
      { x: -3.2, z: 3.2 },
      { x: 3.2, z: -3.2 },
      { x: 3.2, z: 3.2 },
      { x: 0, z: 0 },
      { x: -0.1, z: 0.1 },
    ]
    const keys = points.map((position) => spatialCellKey(position, 3.2))
    expect(new Set(keys).size).toBe(keys.length)
  })

  it('rejects duplicate entry ids', () => {
    const duplicated = [
      { id: 'a', position: { x: 0, z: 0 } },
      { id: 'a', position: { x: 1, z: 1 } },
    ]
    expect(() => buildSpatialHash(duplicated, 3.2)).toThrow(/"a"/)
  })

  it('visits every intersecting cell for a radius larger than one cell, not just the 3x3 neighbourhood', () => {
    const strung = [
      { id: 'p0', position: { x: 0, z: 0 } },
      { id: 'p1', position: { x: 3.3, z: 0 } },
      { id: 'p2', position: { x: 6.6, z: 0 } },
      { id: 'p3', position: { x: 9.9, z: 0 } },
      { id: 'p4', position: { x: 13.2, z: 0 } },
    ]
    const index = buildSpatialHash(strung, 3.2)
    // radius 10 from p0 spans far more than the 3x3 neighbourhood of p0's cell.
    expect(queryRadius(index, { x: 0, z: 0 }, 10)).toEqual(['p0', 'p1', 'p2', 'p3'])
  })

  it('returns each candidate pair at most once regardless of scan direction', () => {
    const index = buildSpatialHash(entries, 3.2)
    const { pairKeys } = collectCanonicalNeighborPairs(index)
    expect(new Set(pairKeys).size).toBe(pairKeys.length)
    for (const key of pairKeys) {
      const [first, second] = key.split('|')
      expect(first < second).toBe(true)
    }
  })

  it('keeps cell keys, pair keys, and query results lexicographically sorted', () => {
    const index = buildSpatialHash(entries, 3.2)
    expect(Object.keys(index.cells)).toEqual([...Object.keys(index.cells)].sort())
    const { pairKeys } = collectCanonicalNeighborPairs(index)
    expect(pairKeys).toEqual([...pairKeys].sort())
    const found = queryRadius(index, { x: 0, z: 0 }, 100)
    expect(found).toEqual([...found].sort())
  })

  it('does not examine or return a pair whose cells are more than one apart, even if closer entries would be within range at a coarser ring', () => {
    // Regression for the defect the plan owner caught: entries two cells
    // apart (here cellX 0 and cellX 2, cellSize 3.2) must contribute neither
    // a candidateCheck nor a pairKey, no matter their raw distance. The
    // broad phase only ever looks at the same or directly adjacent
    // (one-cell-ring) occupied cells.
    const farApart = [
      { id: 'x', position: { x: 0, z: 0 } },
      { id: 'y', position: { x: 6.4, z: 0 } },
    ]
    const index = buildSpatialHash(farApart, 3.2)
    expect(collectCanonicalNeighborPairs(index)).toEqual({ pairKeys: [], candidateChecks: 0 })
  })

  it('never returns a Set from its public API', () => {
    const index = buildSpatialHash(entries, 3.2)
    expect(index.cells).not.toBeInstanceOf(Set)
    expect(queryRadius(index, { x: 0, z: 0 }, 3.2)).not.toBeInstanceOf(Set)
    expect(collectCanonicalNeighborPairs(index).pairKeys).not.toBeInstanceOf(Set)
  })

  // ---------------------------------------------------------------------------
  // Task 12: the broad phase's whole reason to exist is keeping candidate
  // checks well under the full unordered-pair count at mass scale (100
  // combatants -> 4950 pairs). These two module-level fixtures pin that down
  // directly against `collectCanonicalNeighborPairs`, independent of
  // `encounter.ts`/`movement.ts` wiring (see `encounterCapacity.test.ts` for
  // the full-stack version against the actual `createHundredCombatantFfa`
  // grid). No exact candidate-check literal is hard-coded: it is sensitive to
  // grid placement (see the task report), so only the structural acceptance
  // bounds are asserted here.
  //
  // NOTE ON THE TWO "IDENTICAL" DENSE GRIDS NOT MATCHING NUMERICALLY:
  // `tenByTenGrid` below is origin-anchored (first point at `(0, 0)`), while
  // `encounterCapacity.test.ts`'s `gridEntries` (via `makeGridCombatants`) is
  // centered on the origin -- required there, since an origin-anchored
  // spacing-3.25 grid would span `z` up to `29.25`, violating
  // `freeArena.lateralLimit` of `20`. Cell-boundary quantization is sensitive
  // to that translation offset once spacing is smaller than `cellSize`
  // (3.2), so the two spacing-1.5 dense grids report different exact counts
  // (1408 origin-anchored here vs. 1200 centered there) despite being the
  // "same" 10x10/1.5 layout. This is a broad-phase placement artifact, not
  // drift between the two test files -- both satisfy every acceptance bound
  // below regardless (see the task report for the full investigation).
  // ---------------------------------------------------------------------------

  function tenByTenGrid(spacing: number): { id: string; position: { x: number; z: number } }[] {
    const out: { id: string; position: { x: number; z: number } }[] = []
    for (let row = 0; row < 10; row += 1) {
      for (let column = 0; column < 10; column += 1) {
        out.push({ id: `g${row * 10 + column}`, position: { x: column * spacing, z: row * spacing } })
      }
    }
    return out
  }

  const MAX_UNORDERED_PAIRS_AT_100 = (100 * 99) / 2 // 4950

  it('sparse 10x10 grid (spacing 3.25): fewer than 800 candidate checks, never the full 4950, and each real neighbor pair returned at most once', () => {
    const index = buildSpatialHash(tenByTenGrid(3.25))
    const { pairKeys, candidateChecks } = collectCanonicalNeighborPairs(index)

    expect(candidateChecks).toBeLessThan(800)
    expect(candidateChecks).toBeLessThan(MAX_UNORDERED_PAIRS_AT_100)
    expect(new Set(pairKeys).size).toBe(pairKeys.length)
  })

  it('dense 10x10 grid (spacing 1.5): more candidate checks than the sparse grid, still fewer than 4950, and each real neighbor pair returned at most once', () => {
    const sparseCandidateChecks = collectCanonicalNeighborPairs(buildSpatialHash(tenByTenGrid(3.25))).candidateChecks
    const index = buildSpatialHash(tenByTenGrid(1.5))
    const { pairKeys, candidateChecks } = collectCanonicalNeighborPairs(index)

    expect(candidateChecks).toBeGreaterThan(sparseCandidateChecks)
    expect(candidateChecks).toBeLessThan(MAX_UNORDERED_PAIRS_AT_100)
    expect(new Set(pairKeys).size).toBe(pairKeys.length)
  })
})
