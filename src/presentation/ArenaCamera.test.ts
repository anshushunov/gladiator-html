import { describe, expect, it } from 'vitest'
import { ArenaCamera, extentToDistance, measuredExtent, measureSpreadAxisAngle, type HorizontalFramingTarget } from './ArenaCamera'
import { COMBAT_STYLES } from '../content/combatStyles'
import { BASELINE_TEST_SEED, homeRoster, opponents } from '../content/mvpSeries'
import { advanceBattleTick, createBattle, fighterBySide, type BattleState } from '../simulation/battle'

const DEGREE = Math.PI / 180

// ---------------------------------------------------------------------------
// The swept framing constants (Task 6), written out as literals rather than
// imported.
//
// Importing them would turn every assertion below into a restatement of the
// implementation -- `f(x) === CONST` cannot fail however `f` is rewritten. As
// literals they pin the shape *and* the numbers, and the numbers are not
// arbitrary: they were chosen by `scripts/measure-framing.ts --sweep` against
// 46,647 recorded ticks, and changing either one silently is exactly the
// regression these tests exist to catch.
// ---------------------------------------------------------------------------

/** `ArenaView.CAMERA_MIN_DISTANCE` is now this, so the clamp cannot override the flat region. */
const FLAT_DISTANCE = 8.83
const MIN_DISTANCE = FLAT_DISTANCE
const MAX_DISTANCE = 18

/**
 * The tactical band in group-extent terms. `BAND_LOW` is the narrowest pairing
 * (murmillo vs murmillo): `0.9 + 2 x 0.7102 x 1.1`. `BAND_HIGH` is the widest
 * (hoplomachus vs hoplomachus): `3.1 + 2 x 1.3511 x 1.1`, which is where the
 * flat region has to end for the band to be flat for every pairing.
 */
const BAND_LOW = 2.46244
const BAND_HIGH = 6.07242

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

  // The framing measurement harness (`scripts/measure-framing.ts`) reads
  // `measuredExtent` because `measureGroup` -- the camera's own call site --
  // is private, applies a 10% equipment margin per target, and measures
  // across the *camera's* screen-horizontal axis rather than world X. A
  // harness that recomputed any of that by hand would be measuring a
  // quantity `extentToDistance` never sees, and Task 6's camera constants
  // would then be chosen against the wrong number. These three tests pin the
  // three ways that could go wrong.
  describe('measuredExtent', () => {
    it('reproduces the extent the camera itself framed by', () => {
      // An off-axis pair (so the yaw is neither zero nor a symmetric special
      // case) held WIDE, at extent 10.54. `state.distance` is only an
      // invertible read on the extent inside the eased region: across the band
      // the mapping is deliberately flat, so every extent there frames at
      // `FLAT_DISTANCE` and reading the extent back off the distance is
      // impossible in principle. (Before Task 6 a separation of 4 was wide
      // enough for this; it is now inside the flat region.)
      const targets = pairOnAxis(23, 9, 0.7)
      const camera = new ArenaCamera({ minDistance: MIN_DISTANCE, maxDistance: MAX_DISTANCE })
      const reset = camera.reset(targets)

      expect(measuredExtent(targets, reset.yaw)).toBeGreaterThan(BAND_HIGH)
      expect(reset.distance).toBeGreaterThan(MIN_DISTANCE)
      expect(reset.distance).toBeLessThan(MAX_DISTANCE)
      expect(extentToDistance(measuredExtent(targets, reset.yaw), MIN_DISTANCE, MAX_DISTANCE)).toBe(reset.distance)
    })

    it("includes each target's 10% equipment margin", () => {
      const targets: HorizontalFramingTarget[] = [
        { id: 'a', centerX: -1, centerZ: 0, radius: 0.5 },
        { id: 'b', centerX: 1, centerZ: 0, radius: 0.5 },
      ]
      expect(measuredExtent(targets, 0)).toBeCloseTo(2 + 2 * 0.5 * 1.1, 12)
    })

    it('measures across the frame, so a pair turned onto the view axis reads as margins alone', () => {
      const targets = pairOnAxis(0, 4, 0.7)
      // Yaw 90 degrees puts the pair's own axis along the camera's view
      // depth: nothing of the separation is left across the frame.
      expect(measuredExtent(targets, 90 * DEGREE)).toBeCloseTo(2 * 0.7 * 1.1, 12)
    })
  })

  // Task 6. The defect these replace: `clamp(8.5 + 0.8 x extent, 11, 18)` put a
  // close-quarters exchange at 11 world units, which measured 50-90 px of body
  // on a 518 px canvas. The band is now framed at one flat distance, chosen by
  // sweeping 7,189 candidates against 46,647 recorded ticks.
  describe('piecewise framing distance', () => {
    it('is flat across the tactical band', () => {
      for (const extent of [BAND_LOW, (BAND_LOW + BAND_HIGH) / 2, BAND_HIGH]) {
        expect(extentToDistance(extent, MIN_DISTANCE, MAX_DISTANCE)).toBeCloseTo(FLAT_DISTANCE, 6)
      }
    })

    it('is flat below the band too, so approaching fighters do not pull the camera in further', () => {
      // The flat region is `extent <= BAND_HIGH`, not `BAND_LOW <= extent <=
      // BAND_HIGH`: below the band the two are nearly on top of each other and
      // there is nothing left to zoom into. It also matters for the safe area,
      // since those are the largest silhouettes on screen.
      for (const extent of [0, 0.5, BAND_LOW / 2]) {
        expect(extentToDistance(extent, MIN_DISTANCE, MAX_DISTANCE)).toBeCloseTo(FLAT_DISTANCE, 6)
      }
    })

    it('widens monotonically beyond the band and respects the far clamp', () => {
      let previous = FLAT_DISTANCE
      for (let extent = BAND_HIGH; extent <= BAND_HIGH + 12; extent += 0.25) {
        const d = extentToDistance(extent, MIN_DISTANCE, MAX_DISTANCE)
        expect(d).toBeGreaterThanOrEqual(previous - 1e-9)
        previous = d
      }
      expect(extentToDistance(1e6, MIN_DISTANCE, MAX_DISTANCE)).toBe(MAX_DISTANCE)
    })

    it('joins the regions with a continuous first derivative', () => {
      const h = 1e-6
      const slope = (x: number): number =>
        (extentToDistance(x + h, MIN_DISTANCE, MAX_DISTANCE) - extentToDistance(x - h, MIN_DISTANCE, MAX_DISTANCE)) / (2 * h)

      // Inside the band the mapping is flat, so the left-hand slope is exactly zero.
      expect(slope(BAND_HIGH - 10 * h)).toBeCloseTo(0, 3)
      // Outside it the right-hand slope agrees.
      expect(slope(BAND_HIGH + 10 * h)).toBeCloseTo(0, 3)

      // ...and it does so as a limit, not by luck. A smoothstep's slope grows
      // LINEARLY in the distance from the junction, so halving the offset
      // halves the slope. A junction that merely met (C0 -- a straight line
      // resuming at the band edge, which is what the old mapping would have
      // done) would hold a constant non-zero slope all the way in, and that
      // constant is the lurch this shape exists to avoid. This is the
      // assertion that tells the two apart; a fixed-offset slope check cannot,
      // because how small it reads is set by EASE_WIDTH_EXTENT rather than by
      // continuity.
      const near = slope(BAND_HIGH + 1e-3)
      const nearer = slope(BAND_HIGH + 5e-4)
      expect(near).toBeGreaterThan(0)
      expect(nearer / near).toBeCloseTo(0.5, 2)
    })

    it('reaches the far clamp inside the eased region rather than at it', () => {
      // EASE_WIDTH_EXTENT is 7.0, so the clamp is reached at BAND_HIGH + 7.0 =
      // 13.07 -- above the widest extent the nine pairings produce (11.37). The
      // camera therefore tops out near 16.6 in play, and the `18` clamp is a
      // guard rather than a framing the fight ever sits at.
      expect(extentToDistance(11.37, MIN_DISTANCE, MAX_DISTANCE)).toBeLessThan(MAX_DISTANCE)
      expect(extentToDistance(11.37, MIN_DISTANCE, MAX_DISTANCE)).toBeGreaterThan(15)
      expect(extentToDistance(BAND_HIGH + 7.0, MIN_DISTANCE, MAX_DISTANCE)).toBeCloseTo(MAX_DISTANCE, 9)
    })
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
     *
     * The geometry it is called with has to sit in the EASED region, wide
     * enough that the mapping is strictly increasing there. Across the band the
     * mapping is flat by design, so a dead-zone crossing produces no distance
     * change at all and this search would measure nothing. (`DEAD_ZONE_SPACING`
     * and `DEAD_ZONE_BASE_RADIUS` below give extent 8.76, and the crossing lands
     * at 9.81 -- both inside the eased region, and both strictly inside the
     * clamp.)
     */
    function findRadiusBoundary(baseRadius: number, spacing: number): number {
      let low = baseRadius
      let high = baseRadius * 6 + 5
      for (let i = 0; i < 50; i += 1) {
        const mid = (low + high) / 2
        const camera = new ArenaCamera({ minDistance: MIN_DISTANCE, maxDistance: MAX_DISTANCE })
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

    /** Half the separation, and each target's starting radius: extent `2*3.5 + 2*0.8*1.1 = 8.76`, in the eased region. */
    const DEAD_ZONE_SPACING = 3.5
    const DEAD_ZONE_BASE_RADIUS = 0.8

    const deadZonePair = (radius: number): HorizontalFramingTarget[] => [
      { id: 'a', centerX: -DEAD_ZONE_SPACING, centerZ: 0, radius },
      { id: 'b', centerX: DEAD_ZONE_SPACING, centerZ: 0, radius },
    ]

    it('does not re-zoom for a radius growth inside the boundary, and does for one just outside it', () => {
      const camera = new ArenaCamera({ minDistance: MIN_DISTANCE, maxDistance: MAX_DISTANCE })
      const before = camera.reset(deadZonePair(DEAD_ZONE_BASE_RADIUS)).distance
      const boundary = findRadiusBoundary(DEAD_ZONE_BASE_RADIUS, DEAD_ZONE_SPACING)

      // Both readings have to sit strictly inside the clamp, or the clamp
      // rather than the dead zone is what "did not re-zoom" would be showing.
      expect(before).toBeGreaterThan(MIN_DISTANCE)
      expect(before).toBeLessThan(MAX_DISTANCE)

      const inside = camera.update(deadZonePair(boundary - 0.01), 10).distance
      expect(inside).toBe(before)

      camera.reset(deadZonePair(DEAD_ZONE_BASE_RADIUS))
      const outside = camera.update(deadZonePair(boundary + 0.01), 10).distance
      expect(outside).not.toBe(before)
      expect(outside).toBeLessThan(MAX_DISTANCE)
    })

    it('the boundary radius implies exactly a 10% equipment margin under the documented 12% dead zone', () => {
      // extentBefore = 2*spacing + 2*baseRadius*(1+m)
      // extentBoundary = 2*spacing + 2*boundary*(1+m)
      // extentBoundary - extentBefore = 0.12 * extentBefore  (the dead-zone
      // crossing condition), with margin fraction m the only unknown left.
      const spacing = DEAD_ZONE_SPACING
      const baseRadius = DEAD_ZONE_BASE_RADIUS
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

    it('moves ~63% of the way after exactly one 0.5s time constant -- now the fastest of the three axes (tightened from the 2026-08-18 amendment\'s 1.5s; see the constant\'s doc comment for the measurement)', () => {
      const camera = new ArenaCamera({ minDistance: 11, maxDistance: 18 })
      camera.reset(pairOnAxis(0))

      const oneConstant = camera.update(pairOnAxis(30), 0.5).yaw
      expect(oneConstant).toBeCloseTo(-30 * DEGREE * (1 - Math.exp(-1)), 10)

      // Same elapsed time on the look target's own 0.75s clock is not yet a
      // full time constant along: yaw is now the quickest of the three axes,
      // the reverse of the amendment's original "deliberately the slowest"
      // intent -- a fast-rotating pair needs the camera to keep up with it.
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
          0.5,
        ).lookTargetX / 10
      expect(lookProgress).toBeLessThan(1 - Math.exp(-1))
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

    it('does not flip the reference on noise around a genuinely degenerate spread', () => {
      // Regression note: the original version of this test placed targets at
      // X = -1/+1 (2 units apart, variance order 1) and perturbed only Z by
      // the epsilon. That pair has a firmly established, non-degenerate
      // horizontal axis (varianceX - varianceZ stays close to its unperturbed
      // value of 4), so the epsilon barely nudges the *reported* angle away
      // from 0 -- it never exercised the zero-covariance path the test was
      // named for at all.
      //
      // This version first establishes a real non-zero yaw (30 degrees, so a
      // reference-snapping bug can be told apart from a merely-idle one),
      // then feeds targets that are genuinely coincident (variance exactly
      // zero) plus tiny *opposing* perturbations on *both* coordinates --
      // which makes `varianceX - varianceZ` and `covariance` both float-noise
      // scale, so their ratio (all `atan2` sees) is not merely small, it is
      // arbitrary. Both the camera's actual yaw and the undamped reference
      // must hold at the established 30 degrees throughout.
      const camera = new ArenaCamera({ minDistance: 11, maxDistance: 18 })
      camera.reset(pairOnAxis(30))
      const established = camera.state.yaw
      expect(Math.abs(established)).toBeGreaterThan(20 * DEGREE)

      for (const epsilon of [1e-9, -1e-9, 1e-12, -1e-12, 0]) {
        const state = camera.update(
          [
            { id: 'a', centerX: 5 + epsilon, centerZ: -3 + epsilon, radius: 0.5 },
            { id: 'b', centerX: 5 - epsilon, centerZ: -3 - epsilon, radius: 0.5 },
          ],
          0.5,
        )
        expect(state.yaw).toBe(established)
        expect(camera.unwrappedYaw).toBe(established)
      }
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

/** Folds the difference between two axis angles (period `pi`, i.e. `angle`
 * and `angle +/- pi` name the same axis) into `[0, pi/2]` radians -- the true
 * "how far off is this axis from that one" measure, independent of which
 * `pi`-periodic representative either angle happens to be reported as. */
function axisAngleDelta(a: number, b: number): number {
  let diff = (a - b) % Math.PI
  if (diff < 0) diff += Math.PI
  if (diff > Math.PI / 2) diff = Math.PI - diff
  return diff
}

describe('yaw continuity over real bouts', () => {
  it('never changes the *undamped desired* yaw by more than 15 degrees in a tick, in any pairing', () => {
    // Regression note: this used to assert on `camera.update(...).yaw`, the
    // damped, dead-zoned, clamped *output*. At any damping time constant of
    // more than a tick or two that output barely moves per tick no matter
    // how discontinuous its input is, so the 15-degree bound passed almost
    // automatically and proved nothing about the unwrap. `unwrappedYaw`
    // (`ArenaCamera`'s own doc comment) is the undamped, unclamped reference
    // the continuity fix actually governs.
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
        camera.reset(framing(battle))
        let previous = camera.unwrappedYaw
        let ticks = 0
        while (battle.phase === 'running' && ticks < 3600) {
          battle = advanceBattleTick(battle)
          camera.update(framing(battle), 1 / 60)
          const yaw = camera.unwrappedYaw
          expect(Math.abs(yaw - previous)).toBeLessThan(15 * DEGREE)
          previous = yaw
          ticks += 1
        }
      }
    }
  })

  it('keeps the on-screen framing error (camera screen-axis vs. pair axis) bounded across all nine pairings', () => {
    // This is the criterion that actually tracks the original complaint --
    // "the camera cannot show the fighters facing each other" -- not desired-
    // yaw continuity by itself. Per tick: the angle between the camera's
    // screen-horizontal axis at its *actual* (damped, dead-zoned, clamped)
    // yaw and the pair's own spread axis, folded mod 180 degrees into 0..90.
    //
    // Measured at seed 20260815 across all nine pairings, share of ticks with
    // error > 30 degrees:
    //   tau 1.5s (shipped before this fix)   11.2%  (up to 18.9% fast-vs-technical)
    //   tau 0.5s (current YAW_DAMPING_TIME_CONSTANT_SECONDS)   1.5%
    // The 4% bound below sits between those two: comfortably above 1.5% to
    // absorb measurement noise, but well below what a regression toward the
    // old 1.5s damping (11.2%) would produce, so it fails if that regresses.
    const FRAMING_ERROR_BOUND_FRACTION = 0.04
    let overThreshold = 0
    let total = 0

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
        camera.reset(framing(battle))
        let ticks = 0
        while (battle.phase === 'running' && ticks < 3600) {
          battle = advanceBattleTick(battle)
          const targets = framing(battle)
          const { yaw } = camera.update(targets, 1 / 60)
          const axis = measureSpreadAxisAngle(targets)
          // A camera yawed by `-axis` has its screen-horizontal axis along
          // `+axis` (ArenaCamera.ts's own `measureUnclampedYaw` doc comment),
          // so the ideal yaw is `-axis` and the error is the axis delta
          // between `axis` and `-yaw`.
          const error = axisAngleDelta(axis, -yaw)
          if (error > 30 * DEGREE) overThreshold += 1
          total += 1
          ticks += 1
        }
      }
    }

    expect(total).toBeGreaterThan(0)
    expect(overThreshold / total).toBeLessThanOrEqual(FRAMING_ERROR_BOUND_FRACTION)
  })
})
