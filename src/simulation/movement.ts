// Plain geometry and constraint solving for combat movement.
//
// This module owns:
// - `Vec2`, the canonical 2D ground-plane vector used across simulation.
// - Locomotion profiles/intents and the exhaustive intent -> displacement
//   mapping.
// - Facing rotation with authored sine/cosine turn steps (no runtime trig,
//   ever: rotation is plain 2D matrix multiplication over content literals).
// - Arena clamp, the `ordered-pair` movement policy, and the fixed
//   three-pass separation solver that keeps combatants apart without ever
//   scanning every pair directly.
//
// It owns no combatant/fighter state and never mutates its inputs. Task 8's
// encounter tick derives velocity and travelled distance from the delta
// between the positions it passed in and the positions this module returns.

import { buildSpatialHash, collectCanonicalNeighborPairs, DEFAULT_CELL_SIZE } from './spatialHash'

export interface Vec2 {
  x: number
  z: number
}

export type LocomotionIntent =
  | 'hold-range'
  | 'advance'
  | 'retreat'
  | 'circle-left'
  | 'circle-right'
  | 'burst-in'
  | 'backstep'
  | 'disengage'
  | 'pressure'

export interface LocomotionProfile {
  forwardUnitsPerSecond: number
  backwardUnitsPerSecond: number
  lateralUnitsPerSecond: number
  burstUnitsPerSecond: number
  turnCosPerTick: number
  turnSinPerTick: number
}

export interface TurnStep {
  cos: number
  sin: number
}

export interface CombatArenaDefinition {
  radius: number
  lateralLimit: number
  minimumSeparation: number
  movementPolicy: 'ordered-pair' | 'free'
  orderedPair?: readonly [firstId: string, secondId: string]
}

export interface MovementRequest {
  id: string
  position: Readonly<Vec2>
  desiredDisplacement: Readonly<Vec2>
}

export interface MovementResolution {
  positions: Readonly<Record<string, Vec2>>
  separationPasses: 3
  candidateChecksByPass: readonly number[]
}

const SEPARATION_PASSES = 3 as const

// Below this length a vector is treated as the zero vector: normalizing it
// would divide by ~0 and amplify floating-point noise. Every place that can
// hit this (normalizeVec2, exact-coincident separation) uses the same
// deterministic fallback direction below instead of an arbitrary NaN.
const EPSILON = 1e-9
const FALLBACK_DIRECTION: Readonly<Vec2> = { x: 1, z: 0 }

// `+ 0` normalizes a `-0` result (e.g. `0 * -negativeScalar`) back to `0`.
// `-0 === 0` numerically, but `Object.is`/`toEqual` treat them as distinct,
// and IEEE-754 addition of `-0 + 0` is defined to produce `+0`.
function scaleVec2(vector: Readonly<Vec2>, scalar: number): Vec2 {
  return { x: vector.x * scalar + 0, z: vector.z * scalar + 0 }
}

function addVec2(a: Readonly<Vec2>, b: Readonly<Vec2>): Vec2 {
  return { x: a.x + b.x, z: a.z + b.z }
}

function subtractVec2(a: Readonly<Vec2>, b: Readonly<Vec2>): Vec2 {
  return { x: a.x - b.x, z: a.z - b.z }
}

function dotVec2(a: Readonly<Vec2>, b: Readonly<Vec2>): number {
  return a.x * b.x + a.z * b.z
}

/** Normalizes `vector` to unit length, using `Math.sqrt` (allowed) but never
 * runtime trigonometry. A near-zero-length input falls back to a fixed
 * deterministic direction rather than producing NaN. */
export function normalizeVec2(vector: Readonly<Vec2>): Vec2 {
  const length = Math.sqrt(vector.x * vector.x + vector.z * vector.z)
  if (length <= EPSILON) return { ...FALLBACK_DIRECTION }
  return { x: vector.x / length, z: vector.z / length }
}

// Left perpendicular of `facing`, using the same counter-clockwise
// convention as `turnFacing`'s positive-cross branch: rotating (x, z) by
// exactly +90 degrees (cos 0, sin 1) through the same rotation matrix used
// there yields (-z, x).
function leftPerpendicular(facing: Readonly<Vec2>): Vec2 {
  return { x: -facing.z, z: facing.x }
}

function rightPerpendicular(facing: Readonly<Vec2>): Vec2 {
  return { x: facing.z, z: -facing.x }
}

/**
 * Maps a locomotion intent to a per-tick displacement, given the style's
 * authored speed profile, current facing (assumed normalized), and the
 * simulation tick rate. This mapping is explicit and exhaustive over all
 * nine `LocomotionIntent` values:
 *
 * - `advance`/`pressure` use forward speed along facing;
 * - `retreat`/`backstep`/`disengage` use backward speed opposite facing;
 * - `circle-left`/`circle-right` use lateral speed perpendicular to facing;
 * - `burst-in` uses burst speed along facing;
 * - `hold-range` is zero.
 *
 * Action root travel and Fast's authored defense dash are separate motion
 * and never flow through this mapping.
 */
export function intentDisplacement(
  intent: LocomotionIntent,
  profile: Readonly<LocomotionProfile>,
  facing: Readonly<Vec2>,
  ticksPerSecond: number,
): Vec2 {
  switch (intent) {
    case 'hold-range':
      return { x: 0, z: 0 }
    case 'advance':
    case 'pressure':
      return scaleVec2(facing, profile.forwardUnitsPerSecond / ticksPerSecond)
    case 'retreat':
    case 'backstep':
    case 'disengage':
      return scaleVec2(facing, -profile.backwardUnitsPerSecond / ticksPerSecond)
    case 'circle-left':
      return scaleVec2(leftPerpendicular(facing), profile.lateralUnitsPerSecond / ticksPerSecond)
    case 'circle-right':
      return scaleVec2(rightPerpendicular(facing), profile.lateralUnitsPerSecond / ticksPerSecond)
    case 'burst-in':
      return scaleVec2(facing, profile.burstUnitsPerSecond / ticksPerSecond)
  }
}

/**
 * Turns `current` partway toward `desired` using an authored per-tick
 * rotation step. Never calls runtime trigonometry: `step.cos`/`step.sin` are
 * content literals and rotation is plain 2D matrix multiplication.
 *
 * - If `current` is already within one step of `desired` (`dot >= step.cos`),
 *   the result snaps exactly to (normalized) `desired`.
 * - Otherwise `current` rotates by exactly `step` in the direction given by
 *   the sign of `cross = current.x * desired.z - current.z * desired.x`: a
 *   positive cross rotates counter-clockwise using
 *   `(x*cos - z*sin, x*sin + z*cos)`; a negative cross rotates clockwise
 *   using the transposed matrix `(x*cos + z*sin, -x*sin + z*cos)`.
 * - The exact-opposite case (`cross === 0 && dot < 0`) has no shorter side to
 *   prefer, so it deterministically takes the counter-clockwise ("left")
 *   branch, removing the 180-degree deadlock. CHOSEN CONVENTION: the design
 *   only requires *some* deterministic side here, not counter-clockwise
 *   specifically — this file picks counter-clockwise (matching the same
 *   branch used whenever `cross > 0`) and applies it consistently, including
 *   to `leftPerpendicular`/`circle-left` below. It is not a value the design
 *   doc fixes; a reviewer preferring the opposite fixed direction only needs
 *   to flip `turnsLeft`'s `cross === 0` branch and the perpendicular helpers.
 *
 * The rotated result is renormalized to absorb literal floating-point
 * rounding drift carried by the authored sine/cosine pair.
 */
export function turnFacing(current: Readonly<Vec2>, desired: Readonly<Vec2>, step: Readonly<TurnStep>): Vec2 {
  const dot = dotVec2(current, desired)
  if (dot >= step.cos) return normalizeVec2(desired)

  const cross = current.x * desired.z - current.z * desired.x
  const turnsLeft = cross > 0 || (cross === 0 && dot < 0)
  const sign = turnsLeft ? 1 : -1

  const rotated: Vec2 = {
    x: current.x * step.cos - sign * current.z * step.sin,
    z: sign * current.x * step.sin + current.z * step.cos,
  }

  return normalizeVec2(rotated)
}

/**
 * Clamps `position` into the arena's walkable region: first the lateral band
 * `z ∈ [-lateralLimit, lateralLimit]`, then (if still outside) scaled back
 * onto the circle of `radius` centered at the origin. Because the radius
 * scale factor is always `<= 1`, scaling after the lateral clamp can only
 * shrink `|z|` further, so the result always satisfies both constraints
 * simultaneously — this is a safe sequential projection, not necessarily the
 * mathematically nearest point in the lateral-band-intersect-disk region,
 * which is not needed here.
 */
function clampToArena(position: Readonly<Vec2>, arena: Readonly<CombatArenaDefinition>): Vec2 {
  let x = position.x
  let z = Math.min(arena.lateralLimit, Math.max(-arena.lateralLimit, position.z))

  const distanceFromOrigin = Math.sqrt(x * x + z * z)
  if (distanceFromOrigin > arena.radius && distanceFromOrigin > EPSILON) {
    const scale = arena.radius / distanceFromOrigin
    x *= scale
    z *= scale
  }

  return { x, z }
}

function clampAll(positions: Record<string, Vec2>, arena: Readonly<CombatArenaDefinition>): void {
  for (const id of Object.keys(positions)) {
    positions[id] = clampToArena(positions[id], arena)
  }
}

/**
 * `ordered-pair` prevents its two configured descriptor IDs from swapping
 * projected sides along the arena's x axis (the duel adapter's distance
 * axis; lateral movement lives on z). If separation/clamping has pushed
 * `firstId` past `secondId`'s x coordinate, both are projected onto their
 * shared midpoint x so they touch rather than cross. `free` never calls this.
 *
 * CHOSEN CONVENTION: `CombatArenaDefinition` carries no explicit axis field,
 * so "x" here is this file's own choice, not a value fixed by the design
 * doc — it matches the current duel adapter's convention that `home` starts
 * at negative x and `away` at positive x. A future arena shape that needs a
 * different non-crossing axis is expected to pass its own projection axis
 * rather than assuming x.
 */
function applyOrderedPairPolicy(positions: Record<string, Vec2>, arena: Readonly<CombatArenaDefinition>): void {
  if (arena.movementPolicy !== 'ordered-pair' || !arena.orderedPair) return

  const [firstId, secondId] = arena.orderedPair
  const first = positions[firstId]
  const second = positions[secondId]
  if (!first || !second) return

  if (first.x > second.x) {
    const midX = (first.x + second.x) / 2
    positions[firstId] = { ...first, x: midX }
    positions[secondId] = { ...second, x: midX }
  }
}

/**
 * Resolves one canonical pair's minimum-separation overlap in place. The
 * correction splits evenly between both sides unless the arena clamp
 * prevents one side from moving its full share (it is "boundary-constrained"
 * — pinned at the radius or lateral limit); in that case the shortfall is
 * added to the other, unconstrained side so the pair still reaches
 * `minimumSeparation` whenever the arena has room for it.
 */
function resolvePairSeparation(
  positions: Record<string, Vec2>,
  lowerId: string,
  higherId: string,
  arena: Readonly<CombatArenaDefinition>,
): void {
  const a = positions[lowerId]
  const b = positions[higherId]

  const delta = subtractVec2(b, a)
  const currentDistance = Math.sqrt(delta.x * delta.x + delta.z * delta.z)
  const overlap = arena.minimumSeparation - currentDistance
  if (overlap <= 0) return

  const unit = currentDistance > EPSILON ? scaleVec2(delta, 1 / currentDistance) : { ...FALLBACK_DIRECTION }
  const half = overlap / 2

  let clampedA = clampToArena(subtractVec2(a, scaleVec2(unit, half)), arena)
  let clampedB = clampToArena(addVec2(b, scaleVec2(unit, half)), arena)

  const movedA = dotVec2(subtractVec2(a, clampedA), unit)
  const movedB = dotVec2(subtractVec2(clampedB, b), unit)
  const shortfallA = half - movedA
  const shortfallB = half - movedB

  if (shortfallA > EPSILON && shortfallB <= EPSILON) {
    clampedB = clampToArena(addVec2(clampedB, scaleVec2(unit, shortfallA)), arena)
  } else if (shortfallB > EPSILON && shortfallA <= EPSILON) {
    clampedA = clampToArena(subtractVec2(clampedA, scaleVec2(unit, shortfallB)), arena)
  }

  positions[lowerId] = clampedA
  positions[higherId] = clampedB
}

/**
 * Resolves simultaneous movement for a snapshot of requests: every desired
 * displacement is applied from the same pre-movement positions (nobody moves
 * "first"), then the arena clamp and `movementPolicy` constraint apply once,
 * then the separation solver runs exactly three fixed passes. Each pass
 * rebuilds the transient spatial hash from the positions the prior pass
 * produced and solves only the canonical pairs it returns — the whole
 * collection's pairs are never scanned directly, which is what keeps this
 * affordable up to 100 combatants. `movementPolicy: 'ordered-pair'` also
 * reapplies its non-crossing projection after every pass, not only at the
 * end, since a separation correction can reintroduce a crossing.
 */
export function resolveSimultaneousMovement(
  requests: readonly MovementRequest[],
  arena: Readonly<CombatArenaDefinition>,
): MovementResolution {
  const positions: Record<string, Vec2> = {}
  for (const request of requests) {
    positions[request.id] = addVec2(request.position, request.desiredDisplacement)
  }

  clampAll(positions, arena)
  applyOrderedPairPolicy(positions, arena)

  const candidateChecksByPass: number[] = []

  for (let pass = 0; pass < SEPARATION_PASSES; pass += 1) {
    const entries = Object.keys(positions)
      .sort()
      .map((id) => ({ id, position: positions[id] }))
    const hash = buildSpatialHash(entries, DEFAULT_CELL_SIZE)
    const { pairKeys, candidateChecks } = collectCanonicalNeighborPairs(hash)
    candidateChecksByPass.push(candidateChecks)

    for (const pairKey of pairKeys) {
      const [lowerId, higherId] = pairKey.split('|')
      resolvePairSeparation(positions, lowerId, higherId, arena)
    }

    clampAll(positions, arena)
    applyOrderedPairPolicy(positions, arena)
  }

  return { positions, separationPasses: SEPARATION_PASSES, candidateChecksByPass }
}
