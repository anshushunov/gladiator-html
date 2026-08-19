import { describe, expect, it } from 'vitest'
import { ArenaCamera, type HorizontalFramingTarget } from './ArenaCamera'
import { COMBAT_STYLES } from '../content/combatStyles'
import { BASELINE_TEST_SEED, homeRoster, opponents } from '../content/mvpSeries'
import { advanceBattleTick, createBattle, fighterBySide, type BattleState } from '../simulation/battle'

const DEGREE = Math.PI / 180

/** A symmetric pair, `separation` apart, whose axis sits `axisDegrees` off world X -- the exact input the camera's yaw exists to answer. */
function pairOnAxis(axisDegrees: number, separation = 3, radius = 0.5): HorizontalFramingTarget[] {
  const half = separation / 2
  const dx = Math.cos(axisDegrees * DEGREE) * half
  const dz = Math.sin(axisDegrees * DEGREE) * half
  return [
    { id: 'a', centerX: -dx, centerZ: -dz, radius },
    { id: 'b', centerX: dx, centerZ: dz, radius },
  ]
}

/** How far apart the two targets read *across the frame* at `yaw` -- their separation projected onto the camera's screen-horizontal axis. */
function onScreenSeparation(targets: readonly HorizontalFramingTarget[], yaw: number): number {
  const cos = Math.cos(yaw)
  const sin = Math.sin(yaw)
  const projected = targets.map((target) => target.centerX * cos - target.centerZ * sin)
  return Math.max(...projected) - Math.min(...projected)
}

describe('ArenaCamera', () => {
  it('leaves the look target exactly where reset put it for the brief-literal dead-zone example, and stays inside the distance clamp', () => {
    const camera = new ArenaCamera({ minDistance: 11, maxDistance: 18 })
    const reset = camera.reset([
      { id: 'home', centerX: -1, centerZ: 0, radius: 0.8 },
      { id: 'away', centerX: 1, centerZ: 0, radius: 0.8 },
    ])
    expect(reset.lookTargetX).toBe(0)

    const inside = camera.update(
      [
        { id: 'home', centerX: -1.02, centerZ: 0, radius: 0.8 },
        { id: 'away', centerX: 1.02, centerZ: 0, radius: 0.8 },
      ],
      1 / 60,
    )
    // The midpoint never moved at all here (the shift is symmetric), so this
    // is the dead zone holding *and* the damping having nothing to chase.
    expect(inside.lookTargetX).toBe(0)
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
          { id: 'a', centerX: -1, centerZ: 0, radius: 0.5 },
          { id: 'b', centerX: 1, centerZ: 0, radius: 0.5 },
        ])
        distance = reset.distance
        const result = camera.update(
          [
            { id: 'a', centerX: -1 + mid, centerZ: 0, radius: 0.5 },
            { id: 'b', centerX: 1 + mid, centerZ: 0, radius: 0.5 },
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
        { id: 'a', centerX: -1, centerZ: 0, radius: 0.5 },
        { id: 'b', centerX: 1, centerZ: 0, radius: 0.5 },
      ])

      const inside = camera.update(
        [
          { id: 'a', centerX: -1 + (boundary - 0.001), centerZ: 0, radius: 0.5 },
          { id: 'b', centerX: 1 + (boundary - 0.001), centerZ: 0, radius: 0.5 },
        ],
        10,
      )
      expect(inside.lookTargetX).toBe(reset.lookTargetX)

      camera.reset([
        { id: 'a', centerX: -1, centerZ: 0, radius: 0.5 },
        { id: 'b', centerX: 1, centerZ: 0, radius: 0.5 },
      ])
      const outside = camera.update(
        [
          { id: 'a', centerX: -1 + (boundary + 0.001), centerZ: 0, radius: 0.5 },
          { id: 'b', centerX: 1 + (boundary + 0.001), centerZ: 0, radius: 0.5 },
        ],
        10,
      )
      expect(outside.lookTargetX).not.toBe(reset.lookTargetX)
    })

    it('the boundary shift is exactly 8% of the current framing distance', () => {
      const { boundary, distance } = findMidpointShiftBoundary()
      expect(boundary / distance).toBeCloseTo(0.08, 2)
    })

    it('measures the dead zone on the full 2D drift, not on X alone', () => {
      const camera = new ArenaCamera({ minDistance: 11, maxDistance: 18 })
      const reset = camera.reset([
        { id: 'a', centerX: -1, centerZ: 0, radius: 0.5 },
        { id: 'b', centerX: 1, centerZ: 0, radius: 0.5 },
      ])
      const deadZone = 0.08 * reset.distance

      // A pure-Z slide of the whole pair: X never changes, so an X-only dead
      // zone would never fire. Slide past the boundary and the look target
      // must follow in Z.
      const slide = deadZone * 2
      const moved = camera.update(
        [
          { id: 'a', centerX: -1, centerZ: slide, radius: 0.5 },
          { id: 'b', centerX: 1, centerZ: slide, radius: 0.5 },
        ],
        10,
      )
      expect(moved.lookTargetZ).toBeGreaterThan(reset.lookTargetZ)
      expect(moved.lookTargetZ).toBeCloseTo(slide, 3)
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
          { id: 'a', centerX: -spacing, centerZ: 0, radius: baseRadius },
          { id: 'b', centerX: spacing, centerZ: 0, radius: baseRadius },
        ]).distance
        const after = camera.update(
          [
            { id: 'a', centerX: -spacing, centerZ: 0, radius: mid },
            { id: 'b', centerX: spacing, centerZ: 0, radius: mid },
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
        { id: 'a', centerX: -2, centerZ: 0, radius: 1 },
        { id: 'b', centerX: 2, centerZ: 0, radius: 1 },
      ]).distance
      const boundary = findRadiusBoundary(1, 2)

      const inside = camera.update(
        [
          { id: 'a', centerX: -2, centerZ: 0, radius: boundary - 0.01 },
          { id: 'b', centerX: 2, centerZ: 0, radius: boundary - 0.01 },
        ],
        10,
      ).distance
      expect(inside).toBe(before)

      camera.reset([
        { id: 'a', centerX: -2, centerZ: 0, radius: 1 },
        { id: 'b', centerX: 2, centerZ: 0, radius: 1 },
      ])
      const outside = camera.update(
        [
          { id: 'a', centerX: -2, centerZ: 0, radius: boundary + 0.01 },
          { id: 'b', centerX: 2, centerZ: 0, radius: boundary + 0.01 },
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

    it('measures extent across the frame, so a pair rotating toward the view axis does not read as a narrow group', () => {
      // Same separation, only the axis differs. Without the yaw (and with
      // extent measured along world X) the rotated pair would look 13%
      // narrower and pull the camera in on top of the fighters.
      const flat = new ArenaCamera({ minDistance: 11, maxDistance: 18 })
      const rotated = new ArenaCamera({ minDistance: 11, maxDistance: 18 })
      const spread = 8 // wide enough that the mapping sits off both clamps

      const flatState = flat.reset(pairOnAxis(0, spread))
      const rotatedState = rotated.reset(pairOnAxis(30, spread))

      expect(flatState.distance).toBeGreaterThan(11)
      expect(flatState.distance).toBeLessThan(18)
      expect(rotatedState.distance).toBeCloseTo(flatState.distance, 10)
    })
  })

  describe('combat-axis yaw (design.md 2026-08-18 amendment)', () => {
    it('turns the pair across the frame instead of leaving it foreshortened', () => {
      const camera = new ArenaCamera({ minDistance: 11, maxDistance: 18 })
      const targets = pairOnAxis(20)

      const framed = camera.reset(targets)

      expect(framed.yaw).toBeCloseTo(-20 * DEGREE, 10)
      expect(onScreenSeparation(targets, framed.yaw)).toBeCloseTo(3, 10)
      // What the un-yawed home shot would have shown instead.
      expect(onScreenSeparation(targets, 0)).toBeLessThan(2.9)
    })

    it('stays continuous when the pair axis crosses the frame vertical', () => {
      // The raw principal axis is reported in (-90, +90] degrees, so 91 degrees
      // comes back as -89. Without an unwrap the desired yaw jumps ~180 degrees
      // here and the damping then walks the camera through yaw=0 -- straight
      // down the pair's own axis, the exact shot this whole slice removes.
      const camera = new ArenaCamera({ minDistance: 11, maxDistance: 18 })
      camera.reset(pairOnAxis(89))

      const before = camera.update(pairOnAxis(89), 1e6).yaw
      const across = camera.update(pairOnAxis(91), 1e6).yaw

      expect(Math.abs(across - before)).toBeLessThan(15 * DEGREE)
    })

    it('follows an axis pointing at the camera instead of giving up at 30 degrees', () => {
      const camera = new ArenaCamera({ minDistance: 11, maxDistance: 18 })
      // 80 degrees off X: nearly nose-on to the home shot, the case the old
      // +/-30 clamp could not frame at all.
      const framed = camera.reset(pairOnAxis(80))
      expect(framed.yaw).toBeCloseTo(-80 * DEGREE, 10)

      const settled = camera.update(pairOnAxis(80), 1e6)
      expect(settled.yaw).toBeCloseTo(-80 * DEGREE, 10)

      // The property the old test was really protecting: the shot is squared
      // to the pair, not looking down its axis.
      expect(onScreenSeparation(pairOnAxis(80), settled.yaw)).toBeGreaterThan(
        onScreenSeparation(pairOnAxis(80), 0),
      )
    })

    it('still refuses to swing past 90 degrees from the home shot', () => {
      const camera = new ArenaCamera({ minDistance: 11, maxDistance: 18 })
      camera.reset(pairOnAxis(0))
      for (let step = 0; step < 40; step += 1) {
        camera.update(pairOnAxis(89), 1e6)
      }
      expect(Math.abs(camera.update(pairOnAxis(89), 1e6).yaw)).toBeLessThanOrEqual(90 * DEGREE + 1e-9)
    })

    it('reads the spread as an unsigned axis: mirroring the pair through its own center cannot flip the camera to the other side', () => {
      const forward = new ArenaCamera({ minDistance: 11, maxDistance: 18 })
      const mirrored = new ArenaCamera({ minDistance: 11, maxDistance: 18 })

      const targets = pairOnAxis(25)
      const swapped: HorizontalFramingTarget[] = [
        { ...targets[0], centerX: targets[1].centerX, centerZ: targets[1].centerZ },
        { ...targets[1], centerX: targets[0].centerX, centerZ: targets[0].centerZ },
      ]

      expect(forward.reset(targets).yaw).toBeCloseTo(mirrored.reset(swapped).yaw, 12)
    })

    it('holds still inside a 5 degree dead zone and moves outside it', () => {
      const inside = new ArenaCamera({ minDistance: 11, maxDistance: 18 })
      inside.reset(pairOnAxis(0))
      expect(inside.update(pairOnAxis(4), 10).yaw).toBe(0)

      const outside = new ArenaCamera({ minDistance: 11, maxDistance: 18 })
      outside.reset(pairOnAxis(0))
      expect(outside.update(pairOnAxis(6), 10).yaw).toBeLessThan(0)
    })

    it('moves ~63% of the way after exactly one 1.5s time constant -- the slowest of the three axes', () => {
      const camera = new ArenaCamera({ minDistance: 11, maxDistance: 18 })
      camera.reset(pairOnAxis(0))

      const oneConstant = camera.update(pairOnAxis(30), 1.5).yaw
      expect(oneConstant).toBeCloseTo(-30 * DEGREE * (1 - Math.exp(-1)), 10)

      // Same elapsed time on the look target's own 0.75s clock is already
      // twice as many time constants along: the axes really do damp on
      // separate clocks, and yaw is the laziest of them.
      const look = new ArenaCamera({ minDistance: 11, maxDistance: 18 })
      look.reset([
        { id: 'a', centerX: 0, centerZ: 0, radius: 0.5 },
        { id: 'b', centerX: 0, centerZ: 0, radius: 0.5 },
      ])
      const lookProgress =
        look.update(
          [
            { id: 'a', centerX: 10, centerZ: 0, radius: 0.5 },
            { id: 'b', centerX: 10, centerZ: 0, radius: 0.5 },
          ],
          1.5,
        ).lookTargetX / 10
      expect(lookProgress).toBeGreaterThan(1 - Math.exp(-1))
    })

    it('holds the home shot for a degenerate group instead of reading an angle out of float noise', () => {
      const camera = new ArenaCamera({ minDistance: 11, maxDistance: 18 })
      expect(
        camera.reset([
          { id: 'a', centerX: 2, centerZ: -1, radius: 0.5 },
          { id: 'b', centerX: 2, centerZ: -1, radius: 0.5 },
        ]).yaw,
      ).toBe(0)
      expect(camera.reset([{ id: 'only', centerX: 3, centerZ: 2, radius: 0.5 }]).yaw).toBe(0)
    })

    it('hard-cuts yaw on reset, with no residual swing left to damp', () => {
      const camera = new ArenaCamera({ minDistance: 11, maxDistance: 18 })
      camera.reset(pairOnAxis(0))
      camera.update(pairOnAxis(25), 0.2)
      expect(camera.state.yaw).not.toBe(0)

      const reset = camera.reset(pairOnAxis(10))
      expect(reset.yaw).toBeCloseTo(-10 * DEGREE, 10)
      expect(camera.update(pairOnAxis(10), 0)).toEqual(reset)
    })

    it('does not flip the reference on noise around a degenerate spread', () => {
      // Two targets a hair apart: covariance is near zero and its sign is
      // numerically fragile. The camera must not treat that as a real axis
      // rotation and swing.
      const camera = new ArenaCamera({ minDistance: 11, maxDistance: 18 })
      camera.reset(pairOnAxis(0))
      const yaws: number[] = []
      for (const epsilon of [1e-9, -1e-9, 1e-12, -1e-12, 0]) {
        yaws.push(
          camera.update(
            [
              { id: 'a', centerX: -1, centerZ: epsilon, radius: 0.5 },
              { id: 'b', centerX: 1, centerZ: -epsilon, radius: 0.5 },
            ],
            0.5,
          ).yaw,
        )
      }
      for (const yaw of yaws) expect(Math.abs(yaw)).toBeLessThan(5 * DEGREE)
    })
  })

  describe('damping time constants', () => {
    it('moves the look target ~63% of the way after exactly one 0.75s time constant', () => {
      const camera = new ArenaCamera({ minDistance: 11, maxDistance: 18 })
      camera.reset([
        { id: 'a', centerX: -5, centerZ: 0, radius: 0.5 },
        { id: 'b', centerX: -5, centerZ: 0, radius: 0.5 },
      ])
      const result = camera.update(
        [
          { id: 'a', centerX: 5, centerZ: 0, radius: 0.5 },
          { id: 'b', centerX: 5, centerZ: 0, radius: 0.5 },
        ],
        0.75,
      )
      const expected = -5 + 10 * (1 - Math.exp(-1))
      expect(result.lookTargetX).toBeCloseTo(expected, 5)
    })

    it('moves distance ~63% of the way after exactly one 1.25s time constant, using its own separate clock', () => {
      const camera = new ArenaCamera({ minDistance: 11, maxDistance: 18 })
      const start = camera.reset([
        { id: 'a', centerX: 0, centerZ: 0, radius: 0.1 },
        { id: 'b', centerX: 0, centerZ: 0, radius: 0.1 },
      ]).distance // extent ~0.22, unclamped-low target well below 11 -> clamps to 11
      expect(start).toBe(11)

      const settled = camera.update(
        [
          { id: 'a', centerX: -20, centerZ: 0, radius: 6 },
          { id: 'b', centerX: 20, centerZ: 0, radius: 6 },
        ],
        1e6,
      ).distance
      expect(settled).toBe(18) // huge extent clamps the target to the max

      camera.reset([
        { id: 'a', centerX: 0, centerZ: 0, radius: 0.1 },
        { id: 'b', centerX: 0, centerZ: 0, radius: 0.1 },
      ])
      const oneConstant = camera.update(
        [
          { id: 'a', centerX: -20, centerZ: 0, radius: 6 },
          { id: 'b', centerX: 20, centerZ: 0, radius: 6 },
        ],
        1.25,
      ).distance
      const expected = 11 + (18 - 11) * (1 - Math.exp(-1))
      expect(oneConstant).toBeCloseTo(expected, 5)

      // The look target, handed the same elapsed time and the same relative
      // move, is further along than distance is -- the two axes really are
      // on separate clocks rather than one shared one.
      const look = new ArenaCamera({ minDistance: 11, maxDistance: 18 })
      look.reset([
        { id: 'a', centerX: 0, centerZ: 0, radius: 0.5 },
        { id: 'b', centerX: 0, centerZ: 0, radius: 0.5 },
      ])
      const lookProgress =
        look.update(
          [
            { id: 'a', centerX: 10, centerZ: 0, radius: 0.5 },
            { id: 'b', centerX: 10, centerZ: 0, radius: 0.5 },
          ],
          1.25,
        ).lookTargetX / 10
      const distanceProgress = (oneConstant - 11) / (18 - 11)
      expect(lookProgress).toBeGreaterThan(distanceProgress)
    })
  })

  it('clamps distance to 11..18 for both a tiny and a huge group extent', () => {
    const camera = new ArenaCamera({ minDistance: 11, maxDistance: 18 })
    const tiny = camera.reset([
      { id: 'a', centerX: 0, centerZ: 0, radius: 0 },
      { id: 'b', centerX: 0, centerZ: 0, radius: 0 },
    ])
    expect(tiny.distance).toBe(11)

    const huge = camera.reset([
      { id: 'a', centerX: -50, centerZ: 0, radius: 20 },
      { id: 'b', centerX: 50, centerZ: 0, radius: 20 },
    ])
    expect(huge.distance).toBe(18)
  })

  it('is independent of the target array order, for both reset and update', () => {
    const forward = new ArenaCamera({ minDistance: 11, maxDistance: 18 })
    const reversed = new ArenaCamera({ minDistance: 11, maxDistance: 18 })

    const a = { id: 'home', centerX: -1.4, centerZ: 0.9, radius: 0.6 }
    const b = { id: 'away', centerX: 2.3, centerZ: -1.2, radius: 0.9 }

    const forwardReset = forward.reset([a, b])
    const reversedReset = reversed.reset([b, a])
    expect(forwardReset).toEqual(reversedReset)

    const aMoved = { ...a, centerX: -3.1, centerZ: 1.6 }
    const bMoved = { ...b, centerX: 4.4, centerZ: -0.4, radius: 1.1 }
    const forwardUpdate = forward.update([aMoved, bMoved], 0.2)
    const reversedUpdate = reversed.update([bMoved, aMoved], 0.2)
    expect(forwardUpdate).toEqual(reversedUpdate)
  })

  it('reset carries no damping momentum from a prior bout', () => {
    const camera = new ArenaCamera({ minDistance: 11, maxDistance: 18 })
    camera.reset([
      { id: 'a', centerX: -1, centerZ: 0, radius: 0.5 },
      { id: 'b', centerX: 1, centerZ: 0, radius: 0.5 },
    ])
    // Kick it mid-flight toward a distant target without letting it settle.
    camera.update(
      [
        { id: 'a', centerX: 9, centerZ: 0, radius: 0.5 },
        { id: 'b', centerX: 11, centerZ: 0, radius: 0.5 },
      ],
      0.1,
    )
    expect(camera.state.lookTargetX).not.toBe(0)

    const reset = camera.reset([
      { id: 'a', centerX: -3, centerZ: 0, radius: 0.5 },
      { id: 'b', centerX: -1, centerZ: 0, radius: 0.5 },
    ])
    expect(reset.lookTargetX).toBe(-2)

    // No leftover velocity to "catch up" with: even a same-target update
    // right after reset leaves state exactly where reset put it.
    const settled = camera.update(
      [
        { id: 'a', centerX: -3, centerZ: 0, radius: 0.5 },
        { id: 'b', centerX: -1, centerZ: 0, radius: 0.5 },
      ],
      0,
    )
    expect(settled).toEqual(reset)
  })

  it('has no motion lookahead: the look target approaches monotonically, never overshooting', () => {
    const camera = new ArenaCamera({ minDistance: 11, maxDistance: 18 })
    camera.reset([
      { id: 'a', centerX: 0, centerZ: 0, radius: 0.5 },
      { id: 'b', centerX: 0, centerZ: 0, radius: 0.5 },
    ])
    const targets = [
      { id: 'a', centerX: 10, centerZ: 0, radius: 0.5 },
      { id: 'b', centerX: 10, centerZ: 0, radius: 0.5 },
    ]
    const first = camera.update(targets, 0.05).lookTargetX
    const second = camera.update(targets, 0.05).lookTargetX

    expect(first).toBeGreaterThan(0)
    expect(first).toBeLessThan(10)
    expect(second).toBeGreaterThan(first)
    expect(second).toBeLessThan(10)
  })

  it('exposes exactly the four framing values and nothing else -- no vertical term anywhere', () => {
    const camera = new ArenaCamera({ minDistance: 11, maxDistance: 18 })
    const state = camera.reset([
      { id: 'a', centerX: -1, centerZ: 0, radius: 0.5 },
      { id: 'b', centerX: 1, centerZ: 0, radius: 0.5 },
    ])
    expect(Object.keys(state).sort()).toEqual(['distance', 'lookTargetX', 'lookTargetZ', 'yaw'])
  })
})

describe('yaw continuity over real bouts', () => {
  it('never changes the desired yaw by more than 15 degrees in a tick, in any pairing', () => {
    for (const home of homeRoster) {
      for (const away of opponents) {
        const camera = new ArenaCamera({ minDistance: 11, maxDistance: 18 })
        let battle: BattleState = createBattle({ home, away, seed: BASELINE_TEST_SEED, combatStyles: COMBAT_STYLES })
        const framing = (state: BattleState) => {
          const h = fighterBySide(state, 'home')
          const a = fighterBySide(state, 'away')
          return [
            { id: 'home', centerX: h.position.x, centerZ: h.position.z, radius: 0.6 },
            { id: 'away', centerX: a.position.x, centerZ: a.position.z, radius: 0.6 },
          ]
        }
        let previous = camera.reset(framing(battle)).yaw
        let ticks = 0
        while (battle.phase === 'running' && ticks < 3600) {
          battle = advanceBattleTick(battle)
          const yaw = camera.update(framing(battle), 1 / 60).yaw
          expect(Math.abs(yaw - previous)).toBeLessThan(15 * DEGREE)
          previous = yaw
          ticks += 1
        }
      }
    }
  })
})
