// Pure framing state and math for the arena camera: no Three.js import, no
// DOM, no wall-clock reads -- `ArenaView` (Task 17) is the only caller that
// turns this state into an actual `THREE.PerspectiveCamera` transform, and
// it owns the "existing stable elevated perspective" (fixed FOV, fixed
// elevation ratio, no orbit/cut/shake). This module only ever answers "where
// should the camera's horizontal look target and distance be", given the
// horizontal footprint of whatever fighters (today two, a later mass caller
// possibly more) it is asked to frame.
//
// design.md's "Arena, camera, and effects" section fixes five numbers this
// module must hit exactly: an 8% look-target dead zone, a 12% framing (group
// extent) dead zone, a 0.75s look-target damping time constant, a separate
// 1.25s distance damping time constant, a 10% equipment-radius margin, and a
// distance clamp of 11..18 world units. Everything else here (the dead
// zone's own reference measure, and the extent->distance mapping) is an
// undocumented implementation choice, called out below where it is made.

export interface HorizontalFramingTarget {
  id: string
  centerX: number
  radius: number
}

export interface ArenaCameraState {
  lookTargetX: number
  distance: number
}

export interface ArenaCameraOptions {
  minDistance: number
  maxDistance: number
}

// ---------------------------------------------------------------------------
// Authored tuning constants (design.md's exact values, plus this module's
// own presentation-only choices)
// ---------------------------------------------------------------------------

/** design.md: "leaves an 8% viewport dead zone." */
const LOOK_DEAD_ZONE_FRACTION = 0.08

/** design.md: "leaves a 12% framing dead zone." */
const DISTANCE_DEAD_ZONE_FRACTION = 0.12

/** design.md: "a 0.75 s damping time constant" for the look target. */
const LOOK_DAMPING_TIME_CONSTANT_SECONDS = 0.75

/** design.md: "a separate 1.25 s damping time constant" for distance. */
const DISTANCE_DAMPING_TIME_CONSTANT_SECONDS = 1.25

/** design.md: "each fighter's style-authored horizontal equipment radius and a 10% margin." */
const EQUIPMENT_MARGIN_FRACTION = 0.10

/**
 * Neither dead zone has a real on-screen "viewport" to measure against --
 * this module never touches a canvas or FOV. The look-target dead zone is
 * instead measured as a fraction of the *current* framing distance (a wider
 * shot tolerates more horizontal drift before the look target visibly needs
 * to move); the distance dead zone is measured as a fraction of the group
 * extent that last actually moved the distance target (so small extent
 * jitter around a stable spacing never re-triggers a zoom). Both are
 * re-derived fresh every `update()` call from state already on the
 * instance, never from a value the caller supplies.
 */
const MIN_DEAD_ZONE_REFERENCE = 1e-6

/**
 * Maps a desired group extent (world units, already including each target's
 * margin) onto a pre-clamp camera distance. There is no simulation constant
 * to derive this from -- it is authored purely so that a close-quarters
 * exchange (extent roughly 2-4 units) sits near the `11` clamp and the
 * duel arena's near-maximum separation (extent roughly 11-13 units) sits
 * near the `18` clamp; the clamp itself is what design.md actually pins, and
 * this mapping only ever feeds that clamp.
 */
const DISTANCE_BASE = 8.5
const DISTANCE_PER_EXTENT_UNIT = 0.8

// ---------------------------------------------------------------------------
// Pure helpers
// ---------------------------------------------------------------------------

function clampDistance(value: number, minDistance: number, maxDistance: number): number {
  if (value < minDistance) return minDistance
  if (value > maxDistance) return maxDistance
  return value
}

function extentToDistance(extent: number, minDistance: number, maxDistance: number): number {
  return clampDistance(DISTANCE_BASE + extent * DISTANCE_PER_EXTENT_UNIT, minDistance, maxDistance)
}

/**
 * The group's horizontal bounding footprint: each target contributes an
 * edge pair `[centerX - radius * 1.1, centerX + radius * 1.1]`, and the
 * group midpoint/extent are the min/max across every target's edges. Built
 * from `Math.min`/`Math.max` reductions only, so it is exactly
 * order-independent in `targets` (brief resolution #3) and generalizes past
 * two targets without change (the "future mass callers" seam the interface
 * comment calls out). An empty array frames as a zero-width group centered
 * on `0` -- never reached by `ArenaView` (it always frames at least one
 * combatant), kept only so `reset()`/`update()` never throw on it.
 */
function measureGroup(targets: readonly HorizontalFramingTarget[]): { midpointX: number; extent: number } {
  if (targets.length === 0) return { midpointX: 0, extent: 0 }
  let minEdge = Infinity
  let maxEdge = -Infinity
  for (const target of targets) {
    const halfWidth = target.radius * (1 + EQUIPMENT_MARGIN_FRACTION)
    minEdge = Math.min(minEdge, target.centerX - halfWidth)
    maxEdge = Math.max(maxEdge, target.centerX + halfWidth)
  }
  return { midpointX: (minEdge + maxEdge) / 2, extent: maxEdge - minEdge }
}

/** First-order (exponential) lag toward `reference` over `dt` seconds at time constant `tau`. Carries no derivative/velocity state of its own -- see `ArenaCamera`'s class doc for why that is exactly what brief resolution #4 ("reset inherits no velocity") needs. */
function approach(current: number, reference: number, tau: number, dt: number): number {
  if (dt <= 0) return current
  const follow = 1 - Math.exp(-dt / tau)
  return current + (reference - current) * follow
}

// ---------------------------------------------------------------------------
// Camera
// ---------------------------------------------------------------------------

/**
 * Horizontal-only framing state: a look-target X and a distance, each with
 * its own sticky dead-zone target and first-order damped approach toward it.
 * "Sticky" is the mechanism behind both dead zones: `lookTargetReference`/
 * `framedExtentReference` only ever move when the incoming measurement
 * exceeds the relevant dead zone, and `state` only ever chases whatever the
 * sticky reference currently is -- so small in-zone jitter never moves the
 * camera at all, and a real exit smoothly damps in over the named time
 * constant rather than snapping.
 *
 * There is deliberately no persisted velocity/rate field anywhere in this
 * class: `approach()` is a pure position-only exponential lag, not a
 * critically-damped spring. That is what makes brief resolution #4 trivial
 * to satisfy -- `reset()` below sets `state` *and* every sticky reference to
 * the freshly measured group directly (a hard cut, not an animated one), so
 * there is no momentum of any kind left over from the previous bout to
 * "inherit" in the first place.
 */
export class ArenaCamera {
  private readonly minDistance: number
  private readonly maxDistance: number
  private lookTargetReference: number
  private framedExtentReference: number
  private distanceReference: number

  /** Read-only by convention: only `reset()`/`update()` (below) ever assign it. */
  state: ArenaCameraState

  constructor(options: ArenaCameraOptions) {
    this.minDistance = options.minDistance
    this.maxDistance = options.maxDistance
    const initialDistance = clampDistance((options.minDistance + options.maxDistance) / 2, options.minDistance, options.maxDistance)
    this.lookTargetReference = 0
    this.framedExtentReference = 0
    this.distanceReference = initialDistance
    this.state = { lookTargetX: 0, distance: initialDistance }
  }

  /**
   * Hard-cuts to the exact framing of `targets`, with both dead-zone sticky
   * references reset to match -- the "new bout" boundary (brief resolution
   * #4): nothing here is damped, and nothing is left for the next `update()`
   * to chase except genuinely new motion.
   */
  reset(targets: readonly HorizontalFramingTarget[]): ArenaCameraState {
    const { midpointX, extent } = measureGroup(targets)
    this.lookTargetReference = midpointX
    this.framedExtentReference = extent
    this.distanceReference = extentToDistance(extent, this.minDistance, this.maxDistance)
    this.state = { lookTargetX: midpointX, distance: this.distanceReference }
    return this.state
  }

  /**
   * Advances both axes by `elapsedSeconds` of wall-clock time (never a tick
   * count or a fighter's travelled distance -- this is purely a presentation
   * clock). Passing `elapsedSeconds <= 0` re-evaluates the dead zones (a
   * sticky reference can still move) but leaves `state` exactly where it was
   * -- used by `ArenaView`'s dev-only alpha replay so a presentation-only
   * re-render never advances camera damping (brief resolution #9).
   */
  update(targets: readonly HorizontalFramingTarget[], elapsedSeconds: number): ArenaCameraState {
    const { midpointX, extent } = measureGroup(targets)

    const lookDeadZone = LOOK_DEAD_ZONE_FRACTION * Math.max(this.state.distance, MIN_DEAD_ZONE_REFERENCE)
    if (Math.abs(midpointX - this.lookTargetReference) > lookDeadZone) {
      this.lookTargetReference = midpointX
    }

    const extentDeadZone = DISTANCE_DEAD_ZONE_FRACTION * Math.max(this.framedExtentReference, MIN_DEAD_ZONE_REFERENCE)
    if (Math.abs(extent - this.framedExtentReference) > extentDeadZone) {
      this.framedExtentReference = extent
      this.distanceReference = extentToDistance(extent, this.minDistance, this.maxDistance)
    }

    const lookTargetX = approach(this.state.lookTargetX, this.lookTargetReference, LOOK_DAMPING_TIME_CONSTANT_SECONDS, elapsedSeconds)
    const distance = clampDistance(
      approach(this.state.distance, this.distanceReference, DISTANCE_DAMPING_TIME_CONSTANT_SECONDS, elapsedSeconds),
      this.minDistance,
      this.maxDistance,
    )

    this.state = { lookTargetX, distance }
    return this.state
  }
}
