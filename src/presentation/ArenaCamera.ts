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
// 1.25s distance damping time constant, a 10% equipment-radius margin, an
// upper distance clamp of 18 world units (the lower one was 11 until the
// 2026-08-24 readable-gladiator-types slice replaced it with the swept
// `FLAT_DISTANCE` below, so that the clamp could not override the flat
// region), and -- since the 2026-08-18
// combat-axis amendment -- a 5 degree yaw dead zone, and -- since the
// 2026-08-19 legibility slice -- a +/-90 degree yaw clamp (widened from the
// amendment's +/-30, made safe by the continuity fix below) and a 0.5s yaw
// damping time constant (tightened from the amendment's 1.5s: measured
// on-screen framing error across all nine pairings at seed 20260815 was
// 11.2% of ticks beyond 30 degrees at 1.5s, versus 1.5% at 0.5s -- see the
// constant's own doc comment below for the full sweep). Everything else
// here (the look dead zone's own reference measure, and the extent->distance
// mapping) is an undocumented implementation choice, called out below where
// it is made.

import { effectiveLegibilityMode, type LegibilityMode } from './legibilityMode'

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
  /**
   * Review-only (see `legibilityMode.ts`). `camera: false` runs
   * `supersededExtentToDistance` below instead of `extentToDistance`, so a
   * reviewer can watch the identical trace under the mapping this slice
   * replaced. Defaults to the shipped mode, so nothing but the review recorder
   * ever passes it. The mapping is the ONLY thing this flag changes: the
   * framing radii the camera consumes come from `ProceduralFighter`, and those
   * always describe the final props whatever the legibility mode says (see
   * that module's `createProceduralFighter`) -- otherwise "camera only" would
   * be comparing two different cameras rather than two mappings.
   */
  legibility?: LegibilityMode
}

// ---------------------------------------------------------------------------
// Authored tuning constants (design.md's exact values, plus this module's
// own presentation-only choices)
// ---------------------------------------------------------------------------

/** design.md: "leaves an 8% viewport dead zone." */
const LOOK_DEAD_ZONE_FRACTION = 0.08

/**
 * design.md: "leaves a 12% framing dead zone."
 *
 * Load-bearing for the band edge, as of the 2026-08-24 readable-gladiator-types
 * slice, and not only for the extent jitter its own doc comment below
 * describes. `extentToDistance` became piecewise in that slice, which gives it
 * a decision boundary at `BAND_HIGH_EXTENT`, and the classic failure of a
 * decision boundary is chatter: a pair that hovers across it flips the decision
 * every few ticks and the camera dollies in and out at the frequency of the
 * fighters' footwork. This dead zone is the only thing that prevents it -- and
 * it prevents it completely, because it is gated on the *extent* rather than on
 * the distance, so it does not care that the mapping is flat on one side of the
 * junction and sloped on the other. Measured (`ArenaCamera.test.ts`, "framing
 * distance under motion"): a pair oscillating across the edge at 5 Hz with an
 * amplitude just inside `0.12 x BAND_HIGH_EXTENT` holds the distance bit-for-
 * bit constant for 600 ticks; the same drive with this fraction set to zero
 * reverses direction 95 times over those same 600 ticks, tremoring 0.072 world
 * units at 5 Hz. No enter/exit hysteresis was added on top,
 * because measurement said none was needed: swings that DO clear the dead zone
 * are tracked with exactly one camera reversal per swing, each trailing the
 * pair's own turn by 0.8-1.1 s.
 */
const DISTANCE_DEAD_ZONE_FRACTION = 0.12

/** design.md: "a 0.75 s damping time constant" for the look target. */
const LOOK_DAMPING_TIME_CONSTANT_SECONDS = 0.75

/** design.md: "a separate 1.25 s damping time constant" for distance. */
const DISTANCE_DAMPING_TIME_CONSTANT_SECONDS = 1.25

/** design.md: "each fighter's style-authored horizontal equipment radius and a 10% margin." */
const EQUIPMENT_MARGIN_FRACTION = 0.10

/** design.md (2026-08-18 amendment): "only after the axis leaves a 5 degree dead zone." */
const YAW_DEAD_ZONE_RADIANS = (5 * Math.PI) / 180

/**
 * design.md (2026-08-18 amendment) originally set this to 1.5s, deliberately
 * the slowest of the three axes, on the theory that yaw should read as the
 * fight turning rather than as the camera moving. Measurement after that
 * shipped falsified the theory: even with the continuity fix in place, a
 * 1.5s time constant lags a fast-rotating pair badly enough that the camera
 * still spends real time looking down the fighters' own axis -- the original
 * complaint this whole slice exists to fix. On-screen framing error (the
 * angle between the camera's screen-horizontal axis and the pair axis,
 * folded mod 180 degrees), measured across all nine pairings at seed
 * 20260815:
 *
 *   tau 1.5s (shipped)        11.2% of ticks beyond 30 deg, 1.5% beyond 45 deg
 *   tau 0.8s                   3.7% of ticks beyond 30 deg, 0.5% beyond 45 deg
 *   tau 0.5s (this constant)   1.5% of ticks beyond 30 deg, 0.1% beyond 45 deg
 *   tau 0.35s                  0.7% of ticks beyond 30 deg, 0.1% beyond 45 deg
 *
 * A 25-degree lag cap (snap toward the reference once the damped yaw falls
 * more than 25 deg behind it) was also measured: it drives the error to
 * 0.0%, but it does so with worst-case steps of ~12 deg/tick (720 deg/s),
 * which reads as snapping rather than damping. Rejected on that basis. 0.5s
 * is chosen instead: it recovers nearly all of the 1.5s-vs-0.35s error
 * reduction (11.2% -> 1.5%, versus 11.2% -> 0.7% for 0.35s) while keeping
 * the worst single-tick yaw step at 1.85 deg -- an order of magnitude below
 * the lag-cap variant's -- so the camera still reads as damped, not
 * snapped. The 5 degree dead zone (`YAW_DEAD_ZONE_RADIANS`, unchanged) was
 * checked too and is not the lever: tightening it to 2 degrees only moves
 * the 30-degree error from 1.5% to 1.3%.
 */
const YAW_DAMPING_TIME_CONSTANT_SECONDS = 0.5

/**
 * design.md (2026-08-19 legibility slice): "+/-90 degrees from the arena's
 * authored home shot", superseding the 2026-08-18 amendment's +/-30. The bound
 * is not arbitrary: with the unwrap in place the peak measured offset from
 * home across all nine pairings is exactly 90 degrees, because the axis
 * oscillates rather than winding. So the camera tracks the axis essentially
 * always, and where it cannot it holds at the limit instead of flipping to the
 * far side of the arena.
 */
const MAX_YAW_RADIANS = (90 * Math.PI) / 180

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

/** design.md: the tactical band's upper edge, in PAIR SEPARATION -- the longest authored attack reach. */
const BAND_HIGH_SEPARATION = 3.1

/** The widest `horizontalEquipmentRadius` in the roster: the hoplomachus', measured off the built rig. */
const WIDEST_EQUIPMENT_RADIUS = 1.3511

/**
 * The same band edge, expressed in the GROUP EXTENT that `extentToDistance`
 * below actually consumes.
 *
 * Extent adds both fighters' equipment radii with this module's own margin, so
 * the band's edges differ per pairing -- from 2.46-4.66 (murmillo vs murmillo,
 * the narrowest) to 3.87-6.07 (hoplomachus vs hoplomachus, the widest). The
 * flat region has to cover the band for EVERY pairing, so it ends at the widest
 * one's upper edge, which is what this arithmetic spells out (6.07242). Written
 * as the derivation rather than as the number so that it stays correct if the
 * margin changes, and so it is checkable without a spreadsheet.
 */
const BAND_HIGH_EXTENT = BAND_HIGH_SEPARATION + 2 * WIDEST_EQUIPMENT_RADIUS * (1 + EQUIPMENT_MARGIN_FRACTION)

/**
 * The single distance the whole tactical band is framed at.
 *
 * **Swept, not authored.** The mapping this replaces was
 * `clamp(8.5 + 0.8 * extent, 11, 18)`, whose lower clamp already made a flat
 * region below extent 3.125 -- the defect was that `11` is too far out. It put
 * the typical in-band exchange at 93-111 px of body height on a 518 px canvas,
 * and the worst at 68. The old line could not simply "resume" at the band edge
 * either, because it already sits above any flat value low enough to be
 * legible.
 *
 * The candidate set comes from `scripts/measure-framing.ts --sweep`: 7,189
 * `(FLAT_DISTANCE, EASE_WIDTH_EXTENT)` pairs replayed against 46,647 recorded
 * ticks -- all nine pairings at three viewports -- rejecting any candidate that
 * puts anything but a polearm outside the canvas's 5% inset on any tick, or
 * that drops the on-screen body height below 130 px at the 92nd percentile of
 * in-band ticks at 1280x820. Below the surviving frontier the safe area fails;
 * above it the floor does.
 *
 * The value itself is then picked from DIRECT measurement rather than from the
 * sweep, because near the binding safe-area frame the replay is not good
 * enough: it magnifies recorded frames about the canvas centre, and it cannot
 * carry the look-target dead zone (8% of the CURRENT distance, so its own
 * firing schedule depends on the distance mapping), which re-centres the frame
 * by tens of px exactly where the margin is a few px wide. Measured, browser
 * runs only -- every row below is a `--record` pass, and the recording that
 * backs it is kept beside the task report:
 *
 *   flat   floor margin   safe-area margin   run
 *   8.75      +3.02%        0.36 px          full, EASE 7.25 (predicted 5.0 px)
 *   8.79      +2.51%        1.46 px          full
 *   8.80        --          1.74 px          1024x768 only
 *   8.81      +2.25%        5.61 px          full   <- this constant
 *   8.82        --          5.67 px          1024x768 only
 *   8.83      +2.00%        5.74 px          full
 *
 * `8.81` is the knee, and it is a cliff rather than a curve: the binding frame
 * changes identity across it. Below 8.81 the tightest frame is a near-junction
 * one at 1024x768 (pairing 07 tick 1495) whose own margin steps 1.74 -> 6.60 px
 * between 8.80 and 8.81 as a look-target firing flips; at and above 8.81 the
 * tightest frame is a far-region one (pairing 05 tick 183) that grows only
 * ~0.06 px per 0.01 of distance. So below the knee the safe area collapses, and
 * above it further distance buys ~nothing while still costing body height.
 *
 * No ease width rescues the sub-knee frames: at that tick the camera sits at
 * exactly `FLAT_DISTANCE` even though the extent (6.47) is past
 * `BAND_HIGH_EXTENT`, because the sticky *extent* reference the 12% framing
 * dead zone gates on is still inside the flat region -- and that stickiness is
 * ease-independent by construction.
 *
 * See the task report for why the amendment's 3% floor margin and a safe-area
 * margin above this harness's own ~1% accuracy are not jointly reachable: 8.75
 * reaches +3.02% and pays 0.36 px for it.
 */
export const FLAT_DISTANCE = 8.81

/**
 * How much extent past the band it takes to ease all the way out to
 * `maxDistance`. Also swept, and bounded above rather than below: the safe area
 * rejects everything past about 7.25, because a wider ease holds the camera in
 * close while the pair spreads right out, and they then crop horizontally on
 * the narrow 542 px canvas at 1024x768.
 *
 * At `7.00` the far clamp is reached at extent `6.07 + 7.00 = 13.07`, above the
 * widest extent the nine pairings actually produce (11.37) -- so in play the
 * camera tops out near 16.6 and `maxDistance` is a guard rather than a framing
 * the fight sits at.
 */
const EASE_WIDTH_EXTENT = 7.0

// ---------------------------------------------------------------------------
// Pure helpers
// ---------------------------------------------------------------------------

function clamp(value: number, min: number, max: number): number {
  if (value < min) return min
  if (value > max) return max
  return value
}

/**
 * Group extent (world units, margins already included) to a camera distance,
 * in two regions:
 *
 *   - **flat**, at or below `BAND_HIGH_EXTENT`: every frame of the tactical
 *     band, and every closer-than-band frame too, is shot from exactly
 *     `FLAT_DISTANCE`. Below the band there is nothing left to zoom into -- the
 *     two fighters are on top of each other -- and those are the largest
 *     silhouettes on screen, so pulling in further is what would crop them.
 *   - **eased**, above it: a smoothstep out to `maxDistance` over
 *     `EASE_WIDTH_EXTENT` of further spread. Smoothstep rather than a straight
 *     line because its derivative is zero at both ends, so the camera leaves
 *     the flat region and arrives at the clamp without a lurch at either
 *     junction (C1). A line would start moving at full rate the instant the
 *     pair crossed the band edge.
 *
 * The clamp is applied last and is a guard, not part of the shape:
 * `ArenaView`'s `CAMERA_MIN_DISTANCE` is `FLAT_DISTANCE` itself, precisely so
 * that it cannot override the flat region the way the old `11` did.
 *
 * Exported so a measurement harness can invert the one quantity the camera
 * actually exposes -- `state.distance` -- back onto the extent that produced
 * it, and so prove that `measuredExtent` below really is the camera's own
 * measure rather than a lookalike (see `ArenaCamera.test.ts`'s "reports the
 * same group extent the camera's own framing consumed"). Nothing in `src/`
 * calls it from outside this module.
 */
export function extentToDistance(extent: number, minDistance: number, maxDistance: number): number {
  if (extent <= BAND_HIGH_EXTENT) return clamp(FLAT_DISTANCE, minDistance, maxDistance)
  const t = Math.min(1, (extent - BAND_HIGH_EXTENT) / EASE_WIDTH_EXTENT)
  const eased = t * t * (3 - 2 * t)
  return clamp(FLAT_DISTANCE + eased * (maxDistance - FLAT_DISTANCE), minDistance, maxDistance)
}

// ---------------------------------------------------------------------------
// Review-only: the mapping this slice replaced
// ---------------------------------------------------------------------------

/**
 * **Review-only. Not reachable in a production build.**
 *
 * The extent->distance mapping and lower clamp that shipped before the
 * 2026-08-24 readable-gladiator-types slice: `clamp(8.5 + 0.8 * extent, 11,
 * 18)`, restored verbatim from `a073f20` so that the `baseline` and
 * `labels-only` review configurations show a reviewer the framing the failed
 * 2026-08-23 gate actually saw. `SUPERSEDED_MIN_DISTANCE` is the `11` from the
 * same commit, and it is the reason the old mapping is flat below extent
 * 3.125 -- the defect the slice fixed was not the flatness, it was that `11`
 * is too far out (93-111 px of body height in a typical in-band exchange on a
 * 518 px canvas, worst case 68).
 *
 * Reached only via `ArenaCameraOptions.legibility` with `camera: false`, which
 * only `?legibility=` under `import.meta.env.DEV` ever asks for. Nothing in
 * the shipped path calls it, and none of the constants above is touched by it.
 */
export const SUPERSEDED_MIN_DISTANCE = 11
const SUPERSEDED_DISTANCE_INTERCEPT = 8.5
const SUPERSEDED_DISTANCE_SLOPE = 0.8

export function supersededExtentToDistance(extent: number, minDistance: number, maxDistance: number): number {
  return clamp(SUPERSEDED_DISTANCE_INTERCEPT + SUPERSEDED_DISTANCE_SLOPE * extent, minDistance, maxDistance)
}

/** Which extent->distance mapping a given legibility mode runs. */
export type ArenaCameraMappingName = 'shipped' | 'superseded'

/**
 * The `minDistance`/`maxDistance` a review configuration's camera is built
 * with. `maxDistance` is `18` in both -- the slice never moved the far clamp
 * -- and the near clamp follows the mapping, because the two shipped together:
 * `FLAT_DISTANCE` IS `ArenaView`'s `CAMERA_MIN_DISTANCE` precisely so the
 * clamp cannot override the flat region, and `11` was the old one. Exported so
 * `ArenaView` picks them from one place and `legibilityMode.test.ts` can
 * assert what each configuration actually runs.
 */
export function arenaCameraOptionsFor(
  legibility: LegibilityMode,
  shippedMinDistance: number,
  maxDistance: number,
): ArenaCameraOptions {
  const effective = effectiveLegibilityMode(legibility)
  return {
    minDistance: effective.camera ? shippedMinDistance : SUPERSEDED_MIN_DISTANCE,
    maxDistance,
    legibility: effective,
  }
}

/**
 * Below this total horizontal variance (world units squared, i.e. roughly
 * the square of how far apart the targets actually are), the group is
 * treated as having no definite spread axis at all -- see
 * `measureSpreadStats`'s doc comment for why a merely-near-zero covariance
 * is not enough of a guard on its own. `1e-9` sits many orders of magnitude
 * below any real fighter separation (a duel's closest legal contact range is
 * still hundredths of a world unit, variance order `1e-4` or above) and many
 * orders above float noise on coordinates that are themselves order `1..50`
 * (noise-scale perturbations of `1e-9..1e-12` on the coordinates produce
 * variances of order `1e-18..1e-24`).
 */
const AXIS_VARIANCE_EPSILON = 1e-9

/**
 * The group's horizontal spread statistics: the principal axis angle (as an
 * *axis* rather than a direction, see below) and whether that axis is
 * actually well-defined. Three properties of the angle come directly from
 * its closed-form 2x2 eigen-solution `0.5 * atan2(2*Sxz, Sxx - Szz)`:
 *
 *   - it is built from plain sums, so it is exactly order-independent in
 *     `targets` (brief resolution #3) and needs no special case for two;
 *   - `atan2`'s range makes the result land in `(-pi/2, pi/2]`, i.e. an
 *     unsigned axis -- swapping which fighter is "first" cannot flip the
 *     camera to the other side of the fight, which is what design.md's "does
 *     not cross the combat axis" asks for, enforced structurally rather than
 *     by a runtime guard;
 *   - a degenerate group (one target, or several exactly stacked) has zero
 *     covariance, `atan2(0, 0)` is `0`.
 *
 * That last case is *not* the only way to be degenerate, though: a group
 * whose targets are a hair apart (float noise, not a real spread) has
 * `varianceX - varianceZ` and `covariance` both near zero but not exactly
 * zero, and `atan2` of two near-zero numbers is ill-conditioned -- their
 * *ratio*, which is all `atan2` sees, can land anywhere in the full range
 * depending on noise in the last few bits of each coordinate. `hasAxis`
 * catches this: it is `false` whenever total variance
 * (`varianceX + varianceZ`) sits below `AXIS_VARIANCE_EPSILON`, so a caller
 * can tell "no real spread, angle is meaningless noise" apart from "a real,
 * merely axis-aligned spread" (which reports a legitimate `0` or `+/-90`
 * with `hasAxis: true`).
 */
function measureSpreadStats(targets: readonly HorizontalFramingTarget[]): { angle: number; hasAxis: boolean } {
  if (targets.length <= 1) return { angle: 0, hasAxis: false }
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
  const angle = 0.5 * Math.atan2(2 * covariance, varianceX - varianceZ)
  const hasAxis = varianceX + varianceZ > AXIS_VARIANCE_EPSILON
  return { angle, hasAxis }
}

/** The group's principal spread axis angle alone -- see `measureSpreadStats`
 * for the full statistics, including the `hasAxis` degeneracy flag that
 * `measureUnclampedYaw` below actually needs. Exported for tests that need
 * to compare the camera's yaw against the true axis directly. */
export function measureSpreadAxisAngle(targets: readonly HorizontalFramingTarget[]): number {
  return measureSpreadStats(targets).angle
}

/**
 * A spread axis has period `pi`, so `angle`, `angle + pi` and `angle - pi` all
 * name the same axis. This returns whichever representative sits nearest
 * `reference`, which is what makes the desired yaw a continuous function of
 * the fighters' positions: without it, a pair rotating past the frame vertical
 * flips the reported angle by nearly half a turn, and the damping then walks
 * the camera through `yaw = 0` -- pointing it straight along the pair's axis.
 */
function nearestAxisRepresentative(angle: number, reference: number): number {
  let candidate = angle
  while (candidate - reference > Math.PI / 2) candidate -= Math.PI
  while (candidate - reference < -Math.PI / 2) candidate += Math.PI
  return candidate
}

/**
 * The continuous yaw that would put `targets`' spread axis across the frame:
 * the spread axis negated (a camera yawed by `-theta` has its
 * screen-horizontal axis along `+theta`), resolved to the representative
 * nearest `reference`. Unclamped on purpose -- the caller clamps, and keeps
 * this unclamped value as its own reference, so that pinning at the clamp
 * limit never drags the unwrap out of phase with the real axis.
 *
 * `!hasAxis` (`measureSpreadStats`: no target, one target, or targets close
 * enough together that the raw axis angle is float noise rather than a real
 * spread) holds `reference` exactly rather than computing anything from
 * `angle`. This does double duty:
 *
 *   - a pristine `reset()` (which always passes `reference: 0`) yields
 *     exactly `+0`, so a stacked pair and a fresh reset are
 *     `Object.is`-identical rather than merely `==`;
 *   - a group that *was* spread out and rotates through a momentary
 *     near-coincidence keeps whatever yaw the camera already held, instead
 *     of snapping toward `reference`'s own origin story (which, before this
 *     guard existed, meant a mid-bout near-miss could read `angle` as
 *     exactly `0` -- two targets landing on the same float sum -- and yaw the
 *     camera back toward the home shot out of nowhere).
 */
function measureUnclampedYaw(targets: readonly HorizontalFramingTarget[], reference: number): number {
  const { angle, hasAxis } = measureSpreadStats(targets)
  if (!hasAxis) return reference
  return nearestAxisRepresentative(-angle, reference)
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
/**
 * The screen-horizontal (`right`-axis) edges of the group at the given yaw,
 * margins included. Factored out so `measureGroup` below and the exported
 * `measuredExtent` cannot drift apart: they are the same arithmetic on the
 * same inputs, so the extent a measurement harness reads back is bit-for-bit
 * the extent the shipping camera's distance mapping consumed, not a
 * reimplementation of it that happens to agree today.
 */
function measureScreenHorizontalEdges(
  targets: readonly HorizontalFramingTarget[],
  cos: number,
  sin: number,
): { minRight: number; maxRight: number } {
  let minRight = Infinity
  let maxRight = -Infinity
  for (const target of targets) {
    const halfWidth = target.radius * (1 + EQUIPMENT_MARGIN_FRACTION)
    // right = (cos yaw, -sin yaw).
    const right = target.centerX * cos - target.centerZ * sin
    minRight = Math.min(minRight, right - halfWidth)
    maxRight = Math.max(maxRight, right + halfWidth)
  }
  return { minRight, maxRight }
}

/**
 * The group extent `extentToDistance` above is fed every frame: the
 * screen-horizontal width of `targets` at `yaw`, each target's radius already
 * carrying its 10% equipment margin.
 *
 * Exported purely as an instrument. `measureGroup` (the camera's own call
 * site) is private, yaw-dependent, and applies that margin internally, so a
 * harness that recomputed "the extent" from raw positions and radii would be
 * measuring a quantity the shipping camera never sees -- and any camera
 * constant chosen against it would be chosen against the wrong number. This
 * shares `measureScreenHorizontalEdges` with `measureGroup`, so it cannot be
 * that lookalike: pass the camera's own `state.yaw` and the same targets and
 * the result is identical by construction.
 */
export function measuredExtent(targets: readonly HorizontalFramingTarget[], yaw: number): number {
  if (targets.length === 0) return 0
  const { minRight, maxRight } = measureScreenHorizontalEdges(targets, Math.cos(yaw), Math.sin(yaw))
  return maxRight - minRight
}

function measureGroup(
  targets: readonly HorizontalFramingTarget[],
  yaw: number,
): { midpointX: number; midpointZ: number; extent: number } {
  if (targets.length === 0) return { midpointX: 0, midpointZ: 0, extent: 0 }
  const cos = Math.cos(yaw)
  const sin = Math.sin(yaw)

  const { minRight, maxRight } = measureScreenHorizontalEdges(targets, cos, sin)
  let minDepth = Infinity
  let maxDepth = -Infinity
  for (const target of targets) {
    const halfWidth = target.radius * (1 + EQUIPMENT_MARGIN_FRACTION)
    // depth (toward the camera) = (sin yaw, cos yaw).
    const depth = target.centerX * sin + target.centerZ * cos
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
  private unclampedYawReference: number
  /**
   * The extent->distance mapping this instance runs. Bound once, at
   * construction, from `ArenaCameraOptions.legibility` -- `reset()` and
   * `update()` below call it through this field rather than naming
   * `extentToDistance` directly, which is the whole of the camera half of the
   * review toggle. A field rather than a branch at each call site so the two
   * of them cannot end up disagreeing about which mapping is live.
   */
  private readonly mapExtentToDistance: (extent: number, minDistance: number, maxDistance: number) => number

  /**
   * Which mapping `mapExtentToDistance` is bound to. Exposed for
   * `legibilityMode.test.ts`, which asserts the active mapping per review
   * configuration -- a name is checkable without re-deriving the numbers, and
   * the numbers are checked beside it.
   */
  readonly activeMapping: ArenaCameraMappingName

  /** Read-only by convention: only `reset()`/`update()` (below) ever assign it. */
  state: ArenaCameraState

  /**
   * The undamped desired yaw the unwrap last accepted -- the sticky
   * reference the 5-degree dead zone gates against, before the `+/-90`
   * degree clamp and before the damping `approach()`. This is what the
   * continuity guarantee (nearest-representative unwrap) actually governs:
   * `state.yaw` is the damped, clamped *output*, which moves little per
   * tick regardless of how discontinuous the input is once the damping
   * time constant is more than a tick or two, so asserting continuity on
   * it proves nothing about the unwrap. Exposed read-only for tests.
   */
  get unwrappedYaw(): number {
    return this.unclampedYawReference
  }

  constructor(options: ArenaCameraOptions) {
    this.minDistance = options.minDistance
    this.maxDistance = options.maxDistance
    const legibility = effectiveLegibilityMode(options.legibility)
    this.activeMapping = legibility.camera ? 'shipped' : 'superseded'
    this.mapExtentToDistance = legibility.camera ? extentToDistance : supersededExtentToDistance
    const initialDistance = clamp((options.minDistance + options.maxDistance) / 2, options.minDistance, options.maxDistance)
    this.lookTargetReferenceX = 0
    this.lookTargetReferenceZ = 0
    this.framedExtentReference = 0
    this.distanceReference = initialDistance
    this.yawReference = 0
    this.unclampedYawReference = 0
    this.state = { lookTargetX: 0, lookTargetZ: 0, distance: initialDistance, yaw: 0 }
  }

  /**
   * Hard-cuts to the exact framing of `targets`, with all three dead-zone
   * sticky references reset to match -- the "new bout" boundary (brief
   * resolution #4): nothing here is damped, and nothing is left for the next
   * `update()` to chase except genuinely new motion.
   */
  reset(targets: readonly HorizontalFramingTarget[]): ArenaCameraState {
    const unclamped = measureUnclampedYaw(targets, 0)
    const yaw = clamp(unclamped, -MAX_YAW_RADIANS, MAX_YAW_RADIANS)
    const { midpointX, midpointZ, extent } = measureGroup(targets, yaw)
    this.unclampedYawReference = unclamped
    this.yawReference = yaw
    this.lookTargetReferenceX = midpointX
    this.lookTargetReferenceZ = midpointZ
    this.framedExtentReference = extent
    this.distanceReference = this.mapExtentToDistance(extent, this.minDistance, this.maxDistance)
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
    const unclamped = measureUnclampedYaw(targets, this.unclampedYawReference)
    if (Math.abs(unclamped - this.unclampedYawReference) > YAW_DEAD_ZONE_RADIANS) {
      this.unclampedYawReference = unclamped
      this.yawReference = clamp(unclamped, -MAX_YAW_RADIANS, MAX_YAW_RADIANS)
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
      this.distanceReference = this.mapExtentToDistance(extent, this.minDistance, this.maxDistance)
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
