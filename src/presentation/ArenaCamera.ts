// Pure framing state and math for the arena camera: no Three.js import, no
// DOM, no wall-clock reads -- `ArenaView` (Task 17) is the only caller that
// turns this state into an actual `THREE.PerspectiveCamera` transform, and
// it owns the "existing stable elevated perspective" (fixed FOV, fixed
// elevation ratio, no cut/shake). This module only ever answers "where
// should the camera's look target, distance, and yaw be", given the
// horizontal footprint of whatever fighters (today two, a later mass caller
// possibly more) it is asked to frame.
//
// design.md's "Arena, camera, and effects" section fixes the numbers this
// module must hit exactly: an 8% look-target dead zone, a 12% framing (group
// extent) dead zone, a 0.75s look-target damping time constant, a separate
// 1.25s distance damping time constant, a 10% equipment-radius margin, a
// distance clamp of 11..18 world units, and -- since the 2026-08-18
// combat-axis amendment -- a 5 degree yaw dead zone, a 1.5s yaw damping time
// constant, and a +/-30 degree yaw clamp. Everything else here (the look
// dead zone's own reference measure, and the extent->distance mapping) is an
// undocumented implementation choice, called out below where it is made.

export interface HorizontalFramingTarget {
  id: string
  centerX: number
  centerZ: number
  radius: number
}

export interface ArenaCameraState {
  lookTargetX: number
  lookTargetZ: number
  distance: number
  /** Radians. `0` is the arena's authored home shot (camera on +Z looking down -Z); positive swings the camera toward +X. */
  yaw: number
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

/** design.md (2026-08-18 amendment): "only after the axis leaves a 5 degree dead zone." */
const YAW_DEAD_ZONE_RADIANS = (5 * Math.PI) / 180

/** design.md (2026-08-18 amendment): "a 1.5 s damping time constant", deliberately the slowest of the three. */
const YAW_DAMPING_TIME_CONSTANT_SECONDS = 1.5

/** design.md (2026-08-18 amendment): "clamped to +/-30 degrees from the arena's authored home shot." */
const MAX_YAW_RADIANS = (30 * Math.PI) / 180

/**
 * Neither the look nor the distance dead zone has a real on-screen
 * "viewport" to measure against -- this module never touches a canvas or
 * FOV. The look-target dead zone is instead measured as a fraction of the
 * *current* framing distance (a wider shot tolerates more drift before the
 * look target visibly needs to move); the distance dead zone is measured as
 * a fraction of the group extent that last actually moved the distance
 * target (so small extent jitter around a stable spacing never re-triggers a
 * zoom). The yaw dead zone needs no such reference: it is an angle already.
 * All three are re-derived fresh every `update()` call from state already on
 * the instance, never from a value the caller supplies.
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

function clamp(value: number, min: number, max: number): number {
  if (value < min) return min
  if (value > max) return max
  return value
}

function extentToDistance(extent: number, minDistance: number, maxDistance: number): number {
  return clamp(DISTANCE_BASE + extent * DISTANCE_PER_EXTENT_UNIT, minDistance, maxDistance)
}

/**
 * The angle of the group's own spread axis, in radians, as an *axis* rather
 * than a direction: the principal axis of the targets' horizontal positions,
 * from the closed-form 2x2 eigen-solution `0.5 * atan2(2*Sxz, Sxx - Szz)` of
 * their covariance. Three properties matter here and all three come from
 * that form directly:
 *
 *   - it is built from plain sums, so it is exactly order-independent in
 *     `targets` (brief resolution #3) and needs no special case for two;
 *   - `atan2`'s range makes the result land in `(-pi/2, pi/2]`, i.e. an
 *     unsigned axis -- swapping which fighter is "first" cannot flip the
 *     camera to the other side of the fight, which is what design.md's "does
 *     not cross the combat axis" asks for, enforced structurally rather than
 *     by a runtime guard;
 *   - a degenerate group (one target, or several exactly stacked) has zero
 *     covariance, `atan2(0, 0)` is `0`, and the camera stays on its home
 *     shot instead of picking an arbitrary angle out of float noise.
 */
function measureSpreadAxisAngle(targets: readonly HorizontalFramingTarget[]): number {
  if (targets.length <= 1) return 0
  let sumX = 0
  let sumZ = 0
  for (const target of targets) {
    sumX += target.centerX
    sumZ += target.centerZ
  }
  const meanX = sumX / targets.length
  const meanZ = sumZ / targets.length

  let varianceX = 0
  let varianceZ = 0
  let covariance = 0
  for (const target of targets) {
    const dx = target.centerX - meanX
    const dz = target.centerZ - meanZ
    varianceX += dx * dx
    varianceZ += dz * dz
    covariance += dx * dz
  }
  return 0.5 * Math.atan2(2 * covariance, varianceX - varianceZ)
}

/**
 * The yaw that would put `targets`' spread axis straight across the frame:
 * the spread axis negated (a camera yawed by `-theta` has its
 * screen-horizontal axis along `+theta`) and clamped to the authored swing
 * limit. The `angle === 0` branch is not a micro-optimization -- it keeps a
 * degenerate group's yaw at `+0` instead of `-0`, so a stacked pair and a
 * pristine `reset()` produce states that are `Object.is`-identical rather
 * than merely `==`.
 */
function measureDesiredYaw(targets: readonly HorizontalFramingTarget[]): number {
  const angle = measureSpreadAxisAngle(targets)
  if (angle === 0) return 0
  return clamp(-angle, -MAX_YAW_RADIANS, MAX_YAW_RADIANS)
}

/**
 * The group's footprint as the camera actually sees it: every target is
 * projected onto the camera's screen-horizontal (`right`) and view-depth
 * axes for the given `yaw`, each contributing an edge pair
 * `[center - radius * 1.1, center + radius * 1.1]` on both. `extent` is the
 * screen-horizontal width that feeds the distance mapping -- measuring it
 * across the *screen* rather than across world X is the whole point of the
 * yaw: a pair that has rotated toward the view axis no longer reads as a
 * narrow group the camera should zoom into.
 *
 * `midpointX`/`midpointZ` are that same bounding box's center, mapped back
 * into world space, so the group sits centered in frame at any yaw. Built
 * from `Math.min`/`Math.max` reductions only, so it is exactly
 * order-independent and generalizes past two targets without change. An
 * empty array frames as a zero-width group at the origin -- never reached by
 * `ArenaView` (it always frames at least one combatant), kept only so
 * `reset()`/`update()` never throw on it.
 */
function measureGroup(
  targets: readonly HorizontalFramingTarget[],
  yaw: number,
): { midpointX: number; midpointZ: number; extent: number } {
  if (targets.length === 0) return { midpointX: 0, midpointZ: 0, extent: 0 }
  const cos = Math.cos(yaw)
  const sin = Math.sin(yaw)

  let minRight = Infinity
  let maxRight = -Infinity
  let minDepth = Infinity
  let maxDepth = -Infinity
  for (const target of targets) {
    const halfWidth = target.radius * (1 + EQUIPMENT_MARGIN_FRACTION)
    // right = (cos yaw, -sin yaw); depth (toward the camera) = (sin yaw, cos yaw).
    const right = target.centerX * cos - target.centerZ * sin
    const depth = target.centerX * sin + target.centerZ * cos
    minRight = Math.min(minRight, right - halfWidth)
    maxRight = Math.max(maxRight, right + halfWidth)
    minDepth = Math.min(minDepth, depth - halfWidth)
    maxDepth = Math.max(maxDepth, depth + halfWidth)
  }

  const midRight = (minRight + maxRight) / 2
  const midDepth = (minDepth + maxDepth) / 2
  return {
    midpointX: midRight * cos + midDepth * sin,
    midpointZ: -midRight * sin + midDepth * cos,
    extent: maxRight - minRight,
  }
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
 * Framing state: a look-target point, a distance, and a yaw, each with its
 * own sticky dead-zone target and first-order damped approach toward it.
 * "Sticky" is the mechanism behind all three dead zones: the references only
 * ever move when the incoming measurement exceeds the relevant dead zone,
 * and `state` only ever chases whatever the sticky reference currently is --
 * so small in-zone jitter never moves the camera at all, and a real exit
 * smoothly damps in over the named time constant rather than snapping.
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
  private lookTargetReferenceX: number
  private lookTargetReferenceZ: number
  private framedExtentReference: number
  private distanceReference: number
  private yawReference: number

  /** Read-only by convention: only `reset()`/`update()` (below) ever assign it. */
  state: ArenaCameraState

  constructor(options: ArenaCameraOptions) {
    this.minDistance = options.minDistance
    this.maxDistance = options.maxDistance
    const initialDistance = clamp((options.minDistance + options.maxDistance) / 2, options.minDistance, options.maxDistance)
    this.lookTargetReferenceX = 0
    this.lookTargetReferenceZ = 0
    this.framedExtentReference = 0
    this.distanceReference = initialDistance
    this.yawReference = 0
    this.state = { lookTargetX: 0, lookTargetZ: 0, distance: initialDistance, yaw: 0 }
  }

  /**
   * Hard-cuts to the exact framing of `targets`, with all three dead-zone
   * sticky references reset to match -- the "new bout" boundary (brief
   * resolution #4): nothing here is damped, and nothing is left for the next
   * `update()` to chase except genuinely new motion.
   */
  reset(targets: readonly HorizontalFramingTarget[]): ArenaCameraState {
    const yaw = measureDesiredYaw(targets)
    const { midpointX, midpointZ, extent } = measureGroup(targets, yaw)
    this.yawReference = yaw
    this.lookTargetReferenceX = midpointX
    this.lookTargetReferenceZ = midpointZ
    this.framedExtentReference = extent
    this.distanceReference = extentToDistance(extent, this.minDistance, this.maxDistance)
    this.state = { lookTargetX: midpointX, lookTargetZ: midpointZ, distance: this.distanceReference, yaw }
    return this.state
  }

  /**
   * Advances all three axes by `elapsedSeconds` of wall-clock time (never a
   * tick count or a fighter's travelled distance -- this is purely a
   * presentation clock). Passing `elapsedSeconds <= 0` re-evaluates the dead
   * zones (a sticky reference can still move) but leaves `state` exactly
   * where it was -- used by `ArenaView`'s dev-only alpha replay so a
   * presentation-only re-render never advances camera damping (brief
   * resolution #9).
   */
  update(targets: readonly HorizontalFramingTarget[], elapsedSeconds: number): ArenaCameraState {
    // The desired yaw is measured from the group alone, but the footprint is
    // measured through the yaw the camera *currently* holds: extent and look
    // target must describe the shot on screen right now, not the shot the
    // camera is still damping toward.
    const desiredYaw = measureDesiredYaw(targets)
    if (Math.abs(desiredYaw - this.yawReference) > YAW_DEAD_ZONE_RADIANS) {
      this.yawReference = desiredYaw
    }
    const yaw = approach(this.state.yaw, this.yawReference, YAW_DAMPING_TIME_CONSTANT_SECONDS, elapsedSeconds)

    const { midpointX, midpointZ, extent } = measureGroup(targets, yaw)

    const lookDeadZone = LOOK_DEAD_ZONE_FRACTION * Math.max(this.state.distance, MIN_DEAD_ZONE_REFERENCE)
    const lookDriftX = midpointX - this.lookTargetReferenceX
    const lookDriftZ = midpointZ - this.lookTargetReferenceZ
    if (Math.sqrt(lookDriftX * lookDriftX + lookDriftZ * lookDriftZ) > lookDeadZone) {
      this.lookTargetReferenceX = midpointX
      this.lookTargetReferenceZ = midpointZ
    }

    const extentDeadZone = DISTANCE_DEAD_ZONE_FRACTION * Math.max(this.framedExtentReference, MIN_DEAD_ZONE_REFERENCE)
    if (Math.abs(extent - this.framedExtentReference) > extentDeadZone) {
      this.framedExtentReference = extent
      this.distanceReference = extentToDistance(extent, this.minDistance, this.maxDistance)
    }

    const lookTargetX = approach(this.state.lookTargetX, this.lookTargetReferenceX, LOOK_DAMPING_TIME_CONSTANT_SECONDS, elapsedSeconds)
    const lookTargetZ = approach(this.state.lookTargetZ, this.lookTargetReferenceZ, LOOK_DAMPING_TIME_CONSTANT_SECONDS, elapsedSeconds)
    const distance = clamp(
      approach(this.state.distance, this.distanceReference, DISTANCE_DAMPING_TIME_CONSTANT_SECONDS, elapsedSeconds),
      this.minDistance,
      this.maxDistance,
    )

    this.state = { lookTargetX, lookTargetZ, distance, yaw }
    return this.state
  }
}
