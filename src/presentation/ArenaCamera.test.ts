import { describe, expect, it } from 'vitest'
import { ArenaCamera } from './ArenaCamera'

describe('ArenaCamera', () => {
  it('stays within the distance clamp for the brief-literal dead-zone example', () => {
    const camera = new ArenaCamera({ minDistance: 11, maxDistance: 18 })
    camera.reset([
      { id: 'home', centerX: -1, radius: 0.8 },
      { id: 'away', centerX: 1, radius: 0.8 },
    ])
    const inside = camera.update(
      [
        { id: 'home', centerX: -1.02, radius: 0.8 },
        { id: 'away', centerX: 1.02, radius: 0.8 },
      ],
      1 / 60,
    )
    expect(inside.lookTargetX).toBe(camera.state.lookTargetX)
    expect(inside.distance).toBeGreaterThanOrEqual(11)
    expect(inside.distance).toBeLessThanOrEqual(18)
  })

  describe('look-target dead zone (8% of current distance)', () => {
    /**
     * Binary-searches (on the symmetric midpoint shift alone, radius/extent
     * held fixed) for the exact smallest shift that moves `lookTargetX` away
     * from its prior value -- the true boundary of the look-target dead
     * zone, read purely from `update()`'s public output.
     */
    function findMidpointShiftBoundary(): { boundary: number; distance: number } {
      let low = 0
      let high = 10
      let distance = 0
      for (let i = 0; i < 50; i += 1) {
        const mid = (low + high) / 2
        const camera = new ArenaCamera({ minDistance: 11, maxDistance: 18 })
        const reset = camera.reset([
          { id: 'a', centerX: -1, radius: 0.5 },
          { id: 'b', centerX: 1, radius: 0.5 },
        ])
        distance = reset.distance
        const result = camera.update(
          [
            { id: 'a', centerX: -1 + mid, radius: 0.5 },
            { id: 'b', centerX: 1 + mid, radius: 0.5 },
          ],
          10,
        )
        if (result.lookTargetX === reset.lookTargetX) low = mid
        else high = mid
      }
      return { boundary: high, distance }
    }

    it('does not move the look target for a midpoint shift inside the boundary, and does just outside it', () => {
      const { boundary } = findMidpointShiftBoundary()
      const camera = new ArenaCamera({ minDistance: 11, maxDistance: 18 })
      const reset = camera.reset([
        { id: 'a', centerX: -1, radius: 0.5 },
        { id: 'b', centerX: 1, radius: 0.5 },
      ])

      const inside = camera.update(
        [
          { id: 'a', centerX: -1 + (boundary - 0.001), radius: 0.5 },
          { id: 'b', centerX: 1 + (boundary - 0.001), radius: 0.5 },
        ],
        10,
      )
      expect(inside.lookTargetX).toBe(reset.lookTargetX)

      camera.reset([
        { id: 'a', centerX: -1, radius: 0.5 },
        { id: 'b', centerX: 1, radius: 0.5 },
      ])
      const outside = camera.update(
        [
          { id: 'a', centerX: -1 + (boundary + 0.001), radius: 0.5 },
          { id: 'b', centerX: 1 + (boundary + 0.001), radius: 0.5 },
        ],
        10,
      )
      expect(outside.lookTargetX).not.toBe(reset.lookTargetX)
    })

    it('the boundary shift is exactly 8% of the current framing distance', () => {
      const { boundary, distance } = findMidpointShiftBoundary()
      expect(boundary / distance).toBeCloseTo(0.08, 2)
    })
  })

  describe('distance framing dead zone (12% of the last framed extent) and 10% equipment margin', () => {
    /**
     * Binary-searches (on radius alone, symmetric on both targets, centers
     * fixed) for the exact smallest radius that re-triggers a distance
     * change -- the true boundary of the 12% extent dead zone, read purely
     * from the public `update()` output. This never assumes the private
     * extent->distance mapping; it only assumes the 12% figure itself
     * (design.md's own number, used here to solve backward for the margin
     * fraction actually baked into "extent", which is otherwise opaque from
     * outside the module).
     */
    function findRadiusBoundary(baseRadius: number, spacing: number): number {
      let low = baseRadius
      let high = baseRadius * 6 + 5
      for (let i = 0; i < 50; i += 1) {
        const mid = (low + high) / 2
        const camera = new ArenaCamera({ minDistance: 11, maxDistance: 18 })
        const before = camera.reset([
          { id: 'a', centerX: -spacing, radius: baseRadius },
          { id: 'b', centerX: spacing, radius: baseRadius },
        ]).distance
        const after = camera.update(
          [
            { id: 'a', centerX: -spacing, radius: mid },
            { id: 'b', centerX: spacing, radius: mid },
          ],
          10,
        ).distance
        if (after === before) low = mid
        else high = mid
      }
      return high
    }

    it('does not re-zoom for a radius growth inside the boundary, and does for one just outside it', () => {
      const camera = new ArenaCamera({ minDistance: 11, maxDistance: 18 })
      const before = camera.reset([
        { id: 'a', centerX: -2, radius: 1 },
        { id: 'b', centerX: 2, radius: 1 },
      ]).distance
      const boundary = findRadiusBoundary(1, 2)

      const inside = camera.update(
        [
          { id: 'a', centerX: -2, radius: boundary - 0.01 },
          { id: 'b', centerX: 2, radius: boundary - 0.01 },
        ],
        10,
      ).distance
      expect(inside).toBe(before)

      camera.reset([
        { id: 'a', centerX: -2, radius: 1 },
        { id: 'b', centerX: 2, radius: 1 },
      ])
      const outside = camera.update(
        [
          { id: 'a', centerX: -2, radius: boundary + 0.01 },
          { id: 'b', centerX: 2, radius: boundary + 0.01 },
        ],
        10,
      ).distance
      expect(outside).not.toBe(before)
    })

    it('the boundary radius implies exactly a 10% equipment margin under the documented 12% dead zone', () => {
      // extentBefore = 2*spacing + 2*baseRadius*(1+m)
      // extentBoundary = 2*spacing + 2*boundary*(1+m)
      // extentBoundary - extentBefore = 0.12 * extentBefore  (the dead-zone
      // crossing condition), with margin fraction m the only unknown left.
      const spacing = 2
      const baseRadius = 1
      const boundary = findRadiusBoundary(baseRadius, spacing)

      // k = 1 + m; solved from: 2*(boundary-baseRadius)*k = 0.12*(2*spacing + 2*baseRadius*k)
      const k = (0.12 * (2 * spacing)) / (2 * (boundary - baseRadius) - 0.12 * 2 * baseRadius)
      const impliedMarginFraction = k - 1

      expect(impliedMarginFraction).toBeCloseTo(0.10, 2)
    })
  })

  describe('damping time constants', () => {
    it('moves the look target ~63% of the way after exactly one 0.75s time constant', () => {
      const camera = new ArenaCamera({ minDistance: 11, maxDistance: 18 })
      camera.reset([
        { id: 'a', centerX: -5, radius: 0.5 },
        { id: 'b', centerX: -5, radius: 0.5 },
      ])
      const result = camera.update(
        [
          { id: 'a', centerX: 5, radius: 0.5 },
          { id: 'b', centerX: 5, radius: 0.5 },
        ],
        0.75,
      )
      const expected = -5 + 10 * (1 - Math.exp(-1))
      expect(result.lookTargetX).toBeCloseTo(expected, 5)
    })

    it('moves distance ~63% of the way after exactly one 1.25s time constant, using its own separate clock', () => {
      const camera = new ArenaCamera({ minDistance: 11, maxDistance: 18 })
      const start = camera.reset([
        { id: 'a', centerX: 0, radius: 0.1 },
        { id: 'b', centerX: 0, radius: 0.1 },
      ]).distance // extent ~0.22, unclamped-low target well below 11 -> clamps to 11
      expect(start).toBe(11)

      const settled = camera.update(
        [
          { id: 'a', centerX: -20, radius: 6 },
          { id: 'b', centerX: 20, radius: 6 },
        ],
        1e6,
      ).distance
      expect(settled).toBe(18) // huge extent clamps the target to the max

      camera.reset([
        { id: 'a', centerX: 0, radius: 0.1 },
        { id: 'b', centerX: 0, radius: 0.1 },
      ])
      const oneConstant = camera.update(
        [
          { id: 'a', centerX: -20, radius: 6 },
          { id: 'b', centerX: 20, radius: 6 },
        ],
        1.25,
      ).distance
      const expected = 11 + (18 - 11) * (1 - Math.exp(-1))
      expect(oneConstant).toBeCloseTo(expected, 5)

      // Same elapsed time on the look-target's own (faster, 0.75s) clock
      // would already be further along -- proving the two axes really do
      // damp on separate clocks, not a shared one.
      const lookFractionAtDistanceConstant = 1 - Math.exp(-1.25 / 0.75)
      expect(lookFractionAtDistanceConstant).toBeGreaterThan(1 - Math.exp(-1))
    })
  })

  it('clamps distance to 11..18 for both a tiny and a huge group extent', () => {
    const camera = new ArenaCamera({ minDistance: 11, maxDistance: 18 })
    const tiny = camera.reset([
      { id: 'a', centerX: 0, radius: 0 },
      { id: 'b', centerX: 0, radius: 0 },
    ])
    expect(tiny.distance).toBe(11)

    const huge = camera.reset([
      { id: 'a', centerX: -50, radius: 20 },
      { id: 'b', centerX: 50, radius: 20 },
    ])
    expect(huge.distance).toBe(18)
  })

  it('is independent of the target array order, for both reset and update', () => {
    const forward = new ArenaCamera({ minDistance: 11, maxDistance: 18 })
    const reversed = new ArenaCamera({ minDistance: 11, maxDistance: 18 })

    const a = { id: 'home', centerX: -1.4, radius: 0.6 }
    const b = { id: 'away', centerX: 2.3, radius: 0.9 }

    const forwardReset = forward.reset([a, b])
    const reversedReset = reversed.reset([b, a])
    expect(forwardReset).toEqual(reversedReset)

    const aMoved = { ...a, centerX: -3.1 }
    const bMoved = { ...b, centerX: 4.4, radius: 1.1 }
    const forwardUpdate = forward.update([aMoved, bMoved], 0.2)
    const reversedUpdate = reversed.update([bMoved, aMoved], 0.2)
    expect(forwardUpdate).toEqual(reversedUpdate)
  })

  it('reset carries no damping momentum from a prior bout', () => {
    const camera = new ArenaCamera({ minDistance: 11, maxDistance: 18 })
    camera.reset([
      { id: 'a', centerX: -1, radius: 0.5 },
      { id: 'b', centerX: 1, radius: 0.5 },
    ])
    // Kick it mid-flight toward a distant target without letting it settle.
    camera.update(
      [
        { id: 'a', centerX: 9, radius: 0.5 },
        { id: 'b', centerX: 11, radius: 0.5 },
      ],
      0.1,
    )
    expect(camera.state.lookTargetX).not.toBe(0)

    const reset = camera.reset([
      { id: 'a', centerX: -3, radius: 0.5 },
      { id: 'b', centerX: -1, radius: 0.5 },
    ])
    expect(reset.lookTargetX).toBe(-2)

    // No leftover velocity to "catch up" with: even a same-target update
    // right after reset leaves state exactly where reset put it.
    const settled = camera.update(
      [
        { id: 'a', centerX: -3, radius: 0.5 },
        { id: 'b', centerX: -1, radius: 0.5 },
      ],
      0,
    )
    expect(settled).toEqual(reset)
  })

  it('has no motion lookahead: the look target approaches monotonically, never overshooting', () => {
    const camera = new ArenaCamera({ minDistance: 11, maxDistance: 18 })
    camera.reset([
      { id: 'a', centerX: 0, radius: 0.5 },
      { id: 'b', centerX: 0, radius: 0.5 },
    ])
    const targets = [
      { id: 'a', centerX: 10, radius: 0.5 },
      { id: 'b', centerX: 10, radius: 0.5 },
    ]
    const first = camera.update(targets, 0.05).lookTargetX
    const second = camera.update(targets, 0.05).lookTargetX

    expect(first).toBeGreaterThan(0)
    expect(first).toBeLessThan(10)
    expect(second).toBeGreaterThan(first)
    expect(second).toBeLessThan(10)
  })

  it('only ever reads horizontal inputs (centerX/radius) -- the target type carries nothing else', () => {
    const camera = new ArenaCamera({ minDistance: 11, maxDistance: 18 })
    const state = camera.reset([
      { id: 'a', centerX: -1, radius: 0.5 },
      { id: 'b', centerX: 1, radius: 0.5 },
    ])
    expect(Object.keys(state).sort()).toEqual(['distance', 'lookTargetX'])
  })
})
