// Transient broad-phase spatial index for combat entities.
//
// This module is deliberately stateless and disposable: a SpatialHash is
// rebuilt from a fresh entry list every tick and every separation pass. It
// never becomes part of encounter state and is never included in a
// structuredClone payload — it is pure derived data used only to narrow down
// candidate pairs before doing exact (squared-distance) checks.
//
// TODO(task-4): `Vec2` belongs conceptually to movement. It is declared here
// only because movement.ts does not exist yet. Task 4 will move the
// canonical `Vec2` into movement.ts and update this file to import it from
// there instead of declaring its own copy.
export interface Vec2 { x: number; z: number }

export interface SpatialEntry { id: string; position: Readonly<Vec2> }

export interface SpatialHash {
  readonly cellSize: number
  readonly cells: Readonly<Record<string, readonly SpatialEntry[]>>
}

export const DEFAULT_CELL_SIZE = 3.2

/**
 * Deterministic cell key for a position. Cells are half-open squares of
 * `cellSize` starting at the origin: `[n * cellSize, (n + 1) * cellSize)`.
 * `Math.floor` extends this cleanly to negative coordinates (e.g. -0.1 with
 * cellSize 3.2 floors to -1, distinct from 0.1's cell 0), and the comma
 * separator between axes cannot collide with the sign or digits of either
 * coordinate, so no two distinct cells ever share a key.
 */
export function spatialCellKey(position: Readonly<Vec2>, cellSize: number): string {
  const cellX = Math.floor(position.x / cellSize)
  const cellZ = Math.floor(position.z / cellSize)
  return `${cellX},${cellZ}`
}

/**
 * Buckets entries into a uniform grid, keyed by `spatialCellKey`. The result
 * is fully independent of the input order: entries within a cell are sorted
 * by id, and cells are inserted in lexicographically sorted key order.
 */
export function buildSpatialHash(entries: readonly SpatialEntry[], cellSize: number = DEFAULT_CELL_SIZE): SpatialHash {
  const seenIds = new Set<string>()
  const buckets = new Map<string, SpatialEntry[]>()

  for (const entry of entries) {
    if (seenIds.has(entry.id)) {
      throw new Error(`buildSpatialHash: duplicate entry id "${entry.id}"`)
    }
    seenIds.add(entry.id)

    const key = spatialCellKey(entry.position, cellSize)
    const bucket = buckets.get(key)
    if (bucket) bucket.push(entry)
    else buckets.set(key, [entry])
  }

  const cells: Record<string, readonly SpatialEntry[]> = {}
  for (const key of [...buckets.keys()].sort()) {
    const bucket = buckets.get(key)!
    bucket.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
    cells[key] = bucket
  }

  return { cellSize, cells }
}

/**
 * Returns the sorted ids of every entry within `radius` of `center`
 * (inclusive), using squared-distance comparisons so no square root is ever
 * taken. Because `radius` may exceed a single cell, the visited cell range
 * is computed from the query's actual bounding box rather than being capped
 * at the 3x3 neighbourhood: every cell that could possibly intersect the
 * query circle is visited.
 */
export function queryRadius(index: SpatialHash, center: Readonly<Vec2>, radius: number): readonly string[] {
  const { cellSize, cells } = index
  const minCellX = Math.floor((center.x - radius) / cellSize)
  const maxCellX = Math.floor((center.x + radius) / cellSize)
  const minCellZ = Math.floor((center.z - radius) / cellSize)
  const maxCellZ = Math.floor((center.z + radius) / cellSize)
  const radiusSq = radius * radius

  const found: string[] = []
  for (let cellX = minCellX; cellX <= maxCellX; cellX += 1) {
    for (let cellZ = minCellZ; cellZ <= maxCellZ; cellZ += 1) {
      const bucket = cells[`${cellX},${cellZ}`]
      if (!bucket) continue
      for (const entry of bucket) {
        const dx = entry.position.x - center.x
        const dz = entry.position.z - center.z
        if (dx * dx + dz * dz <= radiusSq) found.push(entry.id)
      }
    }
  }

  return found.sort()
}

// Number of grid cells to scan outward from an entry's own cell (in each
// axis) when collecting canonical neighbor pairs. The actual distance
// threshold that defines a "neighboring" pair is 2 * cellSize rather than a
// single cell size: this gives downstream consumers (target acquisition,
// collision broad phase, the separation solver) a look-ahead margin so a
// pair that is about to become relevant between rebuilds is still
// discovered a tick or two early, instead of only once entities are already
// touching.
//
// A 2-cell ring is the minimal ring that is *guaranteed* to contain every
// entry within that 2 * cellSize threshold: grid quantization bounds the
// cell-index gap between two positions by ceil(distance / cellSize), so any
// pair within 2 * cellSize can differ by at most 2 cells on each axis.
// Scanning fewer cells could silently miss a real neighbor; scanning more
// would only add wasted lookups.
const NEIGHBOR_CELL_RING = 2

/**
 * Collects the canonical (lower-id, higher-id) neighbor pairs across the
 * whole index, plus a structural count of how many unordered candidate
 * pairs were distance-tested along the way.
 *
 * Counting rule: entries are visited in sorted-id order. For each entry,
 * every entry found in its own cell or any cell within `NEIGHBOR_CELL_RING`
 * cells (a 5x5 block) is a *candidate* — but it is only examined
 * (`candidateChecks` incremented, one squared-distance test performed) when
 * the candidate's id is strictly greater than the current entry's id. That
 * ordering rule is what keeps every unordered pair counted exactly once: the
 * pair is only ever visited from the lower-id side, never from both sides,
 * and never against itself. A pair becomes part of `pairKeys` (in
 * `"lowerId|higherId"` form) only when its actual squared distance is
 * strictly less than `(2 * cellSize)^2` — so `candidateChecks` is always
 * greater than or equal to `pairKeys.length`, since every returned pair was
 * necessarily examined, but not every examined pair was close enough to
 * return.
 */
export function collectCanonicalNeighborPairs(index: SpatialHash): {
  pairKeys: readonly string[]
  candidateChecks: number
} {
  const { cellSize, cells } = index
  const neighborRange = 2 * cellSize
  const neighborRangeSq = neighborRange * neighborRange

  const allEntries: SpatialEntry[] = []
  for (const key of Object.keys(cells)) allEntries.push(...cells[key])
  allEntries.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))

  let candidateChecks = 0
  const pairKeys: string[] = []

  for (const entry of allEntries) {
    const cellX = Math.floor(entry.position.x / cellSize)
    const cellZ = Math.floor(entry.position.z / cellSize)

    for (let dx = -NEIGHBOR_CELL_RING; dx <= NEIGHBOR_CELL_RING; dx += 1) {
      for (let dz = -NEIGHBOR_CELL_RING; dz <= NEIGHBOR_CELL_RING; dz += 1) {
        const bucket = cells[`${cellX + dx},${cellZ + dz}`]
        if (!bucket) continue

        for (const candidate of bucket) {
          if (!(candidate.id > entry.id)) continue

          candidateChecks += 1
          const ddx = candidate.position.x - entry.position.x
          const ddz = candidate.position.z - entry.position.z
          if (ddx * ddx + ddz * ddz < neighborRangeSq) {
            pairKeys.push(`${entry.id}|${candidate.id}`)
          }
        }
      }
    }
  }

  pairKeys.sort()
  return { pairKeys, candidateChecks }
}
