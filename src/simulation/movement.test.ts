import { describe, expect, it } from 'vitest'
import {
  intentDisplacement,
  normalizeVec2,
  resolveSimultaneousMovement,
  turnFacing,
  type CombatArenaDefinition,
  type LocomotionIntent,
  type LocomotionProfile,
  type MovementRequest,
  type TurnStep,
  type Vec2,
} from './movement'

const TICKS_PER_SECOND = 60

// Fixtures from the design's authored locomotion/turn tables. These belong
// to movement.test.ts only: task 5 owns the real content catalog in
// src/content/combatStyles.ts.
const heavyProfile: LocomotionProfile = {
  forwardUnitsPerSecond: 1.4,
  backwardUnitsPerSecond: 0.9,
  lateralUnitsPerSecond: 0.8,
  burstUnitsPerSecond: 1.8,
  turnCosPerTick: 0.9993908270,
  turnSinPerTick: 0.0348994967,
}

const fastProfile: LocomotionProfile = {
  forwardUnitsPerSecond: 2.4,
  backwardUnitsPerSecond: 2.7,
  lateralUnitsPerSecond: 2.1,
  burstUnitsPerSecond: 4.0,
  turnCosPerTick: 0.9982398279,
  turnSinPerTick: 0.0593063736,
}

const technicalProfile: LocomotionProfile = {
  forwardUnitsPerSecond: 1.7,
  backwardUnitsPerSecond: 2.0,
  lateralUnitsPerSecond: 1.3,
  burstUnitsPerSecond: 2.4,
  turnCosPerTick: 0.9989705698,
  turnSinPerTick: 0.0453629881,
}

const technicalTurn: TurnStep = { cos: 0.9989705698, sin: 0.0453629881 }
const heavyTurn: TurnStep = { cos: heavyProfile.turnCosPerTick, sin: heavyProfile.turnSinPerTick }

const openArena: CombatArenaDefinition = {
  radius: 100,
  lateralLimit: 100,
  minimumSeparation: 0.9,
  movementPolicy: 'free',
}

function distance(a: Readonly<Vec2>, b: Readonly<Vec2>): number {
  const dx = a.x - b.x
  const dz = a.z - b.z
  return Math.sqrt(dx * dx + dz * dz)
}

describe('normalizeVec2', () => {
  it('normalizes a 3-4-5 vector', () => {
    expect(normalizeVec2({ x: 3, z: 4 })).toEqual({ x: 0.6, z: 0.8 })
  })
})

describe('intentDisplacement', () => {
  it('advance uses forward speed along facing (brief fixture)', () => {
    expect(intentDisplacement('advance', heavyProfile, { x: 1, z: 0 }, TICKS_PER_SECOND)).toEqual({
      x: 1.4 / 60,
      z: 0,
    })
  })

  it('retreat uses backward speed opposite facing (brief fixture)', () => {
    expect(intentDisplacement('retreat', fastProfile, { x: 1, z: 0 }, TICKS_PER_SECOND)).toEqual({
      x: -2.7 / 60,
      z: 0,
    })
  })

  const facing: Vec2 = { x: 1, z: 0 }

  const cases: Array<[LocomotionIntent, Vec2]> = [
    ['hold-range', { x: 0, z: 0 }],
    ['advance', { x: heavyProfile.forwardUnitsPerSecond / TICKS_PER_SECOND, z: 0 }],
    ['pressure', { x: heavyProfile.forwardUnitsPerSecond / TICKS_PER_SECOND, z: 0 }],
    ['retreat', { x: -heavyProfile.backwardUnitsPerSecond / TICKS_PER_SECOND, z: 0 }],
    ['backstep', { x: -heavyProfile.backwardUnitsPerSecond / TICKS_PER_SECOND, z: 0 }],
    ['disengage', { x: -heavyProfile.backwardUnitsPerSecond / TICKS_PER_SECOND, z: 0 }],
    ['circle-left', { x: 0, z: heavyProfile.lateralUnitsPerSecond / TICKS_PER_SECOND }],
    ['circle-right', { x: 0, z: -heavyProfile.lateralUnitsPerSecond / TICKS_PER_SECOND }],
    ['burst-in', { x: heavyProfile.burstUnitsPerSecond / TICKS_PER_SECOND, z: 0 }],
  ]

  it.each(cases)('maps intent %s to the correct displacement', (intent, expected) => {
    const result = intentDisplacement(intent, heavyProfile, facing, TICKS_PER_SECOND)
    expect(result.x).toBeCloseTo(expected.x, 12)
    expect(result.z).toBeCloseTo(expected.z, 12)
  })

  it('covers all nine locomotion intents exhaustively', () => {
    expect(cases.map(([intent]) => intent).sort()).toEqual(
      [
        'advance',
        'backstep',
        'burst-in',
        'circle-left',
        'circle-right',
        'disengage',
        'hold-range',
        'pressure',
        'retreat',
      ].sort(),
    )
  })

  it('circle-left and circle-right are perpendicular to facing and opposite each other, for a non-axis-aligned facing', () => {
    const diagonalFacing = normalizeVec2({ x: 1, z: 1 })
    const left = intentDisplacement('circle-left', technicalProfile, diagonalFacing, TICKS_PER_SECOND)
    const right = intentDisplacement('circle-right', technicalProfile, diagonalFacing, TICKS_PER_SECOND)

    const dotLeft = left.x * diagonalFacing.x + left.z * diagonalFacing.z
    const dotRight = right.x * diagonalFacing.x + right.z * diagonalFacing.z
    expect(dotLeft).toBeCloseTo(0, 12)
    expect(dotRight).toBeCloseTo(0, 12)

    expect(left.x).toBeCloseTo(-right.x, 12)
    expect(left.z).toBeCloseTo(-right.z, 12)
  })
})

describe('turnFacing', () => {
  it('rotates toward a 90-degree target by exactly the authored technical step (brief fixture)', () => {
    const turned = turnFacing({ x: 1, z: 0 }, { x: 0, z: 1 }, technicalTurn)
    expect(turned.x).toBeCloseTo(0.9989705698, 9)
    expect(turned.z).toBeCloseTo(0.0453629881, 9)
  })

  it('snaps to desired once within one authored step', () => {
    // technicalTurn.cos corresponds to a ~2.6 degree step; a current facing
    // already inside that arc of desired must snap exactly, not creep.
    const desired = normalizeVec2({ x: 1, z: 0.02 })
    const turned = turnFacing({ x: 1, z: 0 }, desired, technicalTurn)
    expect(turned).toEqual(desired)
  })

  it('turns deterministically left on exact-opposite facing, then converges inside the target arc after repeated ticks', () => {
    let current: Vec2 = { x: 1, z: 0 }
    const desired: Vec2 = { x: -1, z: 0 }

    const first = turnFacing(current, desired, technicalTurn)
    // Deterministic "left" convention: rotates toward +z first, matching the
    // same counter-clockwise branch used whenever cross > 0.
    expect(first.x).toBeCloseTo(technicalTurn.cos, 9)
    expect(first.z).toBeCloseTo(technicalTurn.sin, 9)

    current = first
    const maxTicks = 200
    let converged = false
    for (let tick = 0; tick < maxTicks; tick += 1) {
      const dot = current.x * desired.x + current.z * desired.z
      if (dot >= technicalTurn.cos) {
        converged = true
        break
      }
      current = turnFacing(current, desired, technicalTurn)
    }

    expect(converged).toBe(true)
    const finalTurn = turnFacing(current, desired, technicalTurn)
    expect(finalTurn).toEqual(normalizeVec2(desired))
  })

  it('holds a constant before/after dot across unconverged steps at a 90-degree initial error (no runtime trig, no easing)', () => {
    let current: Vec2 = { x: 1, z: 0 }
    const desired: Vec2 = { x: 0, z: 1 }

    for (let step = 0; step < 5; step += 1) {
      const before = current
      const beforeDot = before.x * desired.x + before.z * desired.z
      if (beforeDot >= heavyTurn.cos) break // final snapping step is allowed to differ
      const after = turnFacing(before, desired, heavyTurn)
      const dot = before.x * after.x + before.z * after.z
      expect(dot).toBeCloseTo(heavyTurn.cos, 9)
      current = after
    }
  })

  it('holds a constant before/after dot across unconverged steps at a 170-degree initial error (no runtime trig, no easing)', () => {
    // Literal 170-degree fixture: cos(170deg) = -0.98480775301, sin(170deg) =
    // 0.17364817766. These are authored test-fixture literals, not a
    // runtime trigonometric call.
    let current: Vec2 = { x: -0.98480775301, z: 0.17364817766 }
    const desired: Vec2 = { x: 1, z: 0 }

    for (let step = 0; step < 5; step += 1) {
      const before = current
      const beforeDot = before.x * desired.x + before.z * desired.z
      if (beforeDot >= heavyTurn.cos) break
      const after = turnFacing(before, desired, heavyTurn)
      const dot = before.x * after.x + before.z * after.z
      expect(dot).toBeCloseTo(heavyTurn.cos, 9)
      current = after
    }
  })

  it('returns a normalized vector even against literal-rounding-drift turn steps', () => {
    const turned = turnFacing({ x: 1, z: 0 }, { x: 0, z: 1 }, technicalTurn)
    const length = Math.sqrt(turned.x * turned.x + turned.z * turned.z)
    expect(length).toBeCloseTo(1, 12)
  })
})

describe('resolveSimultaneousMovement', () => {
  it('performs exactly three separation passes with one candidate-check count per pass', () => {
    const requests: MovementRequest[] = [
      { id: 'a', position: { x: 0, z: 0 }, desiredDisplacement: { x: 0, z: 0 } },
      { id: 'b', position: { x: 1, z: 0 }, desiredDisplacement: { x: 0, z: 0 } },
    ]
    const result = resolveSimultaneousMovement(requests, openArena)
    expect(result.separationPasses).toBe(3)
    expect(result.candidateChecksByPass).toHaveLength(3)
    for (const count of result.candidateChecksByPass) {
      expect(typeof count).toBe('number')
    }
  })

  it('never scans every pair directly: an isolated combatant far from a dense cluster contributes no candidate checks against it', () => {
    const cluster: MovementRequest[] = [
      { id: 'c1', position: { x: 0, z: 0 }, desiredDisplacement: { x: 0, z: 0 } },
      { id: 'c2', position: { x: 0.5, z: 0 }, desiredDisplacement: { x: 0, z: 0 } },
      { id: 'c3', position: { x: 0, z: 0.5 }, desiredDisplacement: { x: 0, z: 0 } },
    ]
    const isolated: MovementRequest = { id: 'far', position: { x: 500, z: 500 }, desiredDisplacement: { x: 0, z: 0 } }
    const bigArena: CombatArenaDefinition = { ...openArena, radius: 2000, lateralLimit: 2000 }

    const withoutIsolated = resolveSimultaneousMovement(cluster, bigArena)
    const withIsolated = resolveSimultaneousMovement([...cluster, isolated], bigArena)

    // Same candidate-check totals per pass: the far combatant never occupies
    // the same/adjacent cell as the cluster, so it adds zero broad-phase work.
    expect(withIsolated.candidateChecksByPass).toEqual(withoutIsolated.candidateChecksByPass)
  })

  it('enforces the minimum separation between two combatants that start too close together', () => {
    const requests: MovementRequest[] = [
      { id: 'a', position: { x: 0, z: 0 }, desiredDisplacement: { x: 0, z: 0 } },
      { id: 'b', position: { x: 0.3, z: 0 }, desiredDisplacement: { x: 0, z: 0 } },
    ]
    const { positions } = resolveSimultaneousMovement(requests, openArena)
    expect(distance(positions.a, positions.b)).toBeGreaterThanOrEqual(openArena.minimumSeparation - 1e-9)
  })

  it('splits separation correction evenly when neither side is boundary-constrained', () => {
    const requests: MovementRequest[] = [
      { id: 'a', position: { x: 0, z: 0 }, desiredDisplacement: { x: 0, z: 0 } },
      { id: 'b', position: { x: 0.3, z: 0 }, desiredDisplacement: { x: 0, z: 0 } },
    ]
    const { positions } = resolveSimultaneousMovement(requests, openArena)
    const midpoint = 0.15
    expect(positions.a.x).toBeCloseTo(midpoint - openArena.minimumSeparation / 2, 6)
    expect(positions.b.x).toBeCloseTo(midpoint + openArena.minimumSeparation / 2, 6)
  })

  it('lets the unconstrained side absorb more correction when the other is pinned at the arena boundary', () => {
    const arena: CombatArenaDefinition = {
      radius: 5,
      lateralLimit: 5,
      minimumSeparation: 0.9,
      movementPolicy: 'free',
    }
    // 'a' sits right at the edge of the arena, 'b' is 0.3 units inside from it
    // (too close). 'a' cannot be pushed further out without leaving the
    // arena, so 'b' must absorb the correction 'a' cannot take.
    const requests: MovementRequest[] = [
      { id: 'a', position: { x: -5, z: 0 }, desiredDisplacement: { x: 0, z: 0 } },
      { id: 'b', position: { x: -4.7, z: 0 }, desiredDisplacement: { x: 0, z: 0 } },
    ]
    const { positions } = resolveSimultaneousMovement(requests, arena)
    expect(positions.a.x).toBeCloseTo(-5, 6)
    expect(distance(positions.a, positions.b)).toBeGreaterThanOrEqual(arena.minimumSeparation - 1e-9)
  })

  it('clamps a combatant to the arena radius', () => {
    const requests: MovementRequest[] = [{ id: 'a', position: { x: 1.9, z: 0 }, desiredDisplacement: { x: 1, z: 0 } }]
    const arena: CombatArenaDefinition = { radius: 2, lateralLimit: 5, minimumSeparation: 0.9, movementPolicy: 'free' }
    const { positions } = resolveSimultaneousMovement(requests, arena)
    expect(distance(positions.a, { x: 0, z: 0 })).toBeLessThanOrEqual(arena.radius + 1e-9)
    expect(positions.a.x).toBeCloseTo(2, 9)
  })

  it('clamps lateral displacement to the arena lateral limit', () => {
    const requests: MovementRequest[] = [{ id: 'a', position: { x: 0, z: 2 }, desiredDisplacement: { x: 0, z: 1 } }]
    const arena: CombatArenaDefinition = { radius: 10, lateralLimit: 2.5, minimumSeparation: 0.9, movementPolicy: 'free' }
    const { positions } = resolveSimultaneousMovement(requests, arena)
    expect(positions.a.z).toBeLessThanOrEqual(arena.lateralLimit + 1e-9)
  })

  it('is independent of request input order', () => {
    const requests: MovementRequest[] = [
      { id: 'a', position: { x: 0, z: 0 }, desiredDisplacement: { x: 0.1, z: 0 } },
      { id: 'b', position: { x: 0.4, z: 0 }, desiredDisplacement: { x: -0.1, z: 0 } },
      { id: 'c', position: { x: -1, z: 1 }, desiredDisplacement: { x: 0.05, z: -0.05 } },
    ]
    const forward = resolveSimultaneousMovement(requests, openArena)
    const reversed = resolveSimultaneousMovement([...requests].reverse(), openArena)
    expect(reversed.positions).toEqual(forward.positions)
  })

  it('applies the ordered-pair projection after every pass so the two descriptor IDs never cross', () => {
    const arena: CombatArenaDefinition = {
      radius: 50,
      lateralLimit: 50,
      minimumSeparation: 0.9,
      movementPolicy: 'ordered-pair',
      orderedPair: ['first', 'second'],
    }
    const requests: MovementRequest[] = [
      { id: 'first', position: { x: -1, z: 0 }, desiredDisplacement: { x: 5, z: 0 } },
      { id: 'second', position: { x: 1, z: 0 }, desiredDisplacement: { x: -5, z: 0 } },
    ]
    const { positions } = resolveSimultaneousMovement(requests, arena)
    expect(positions.first.x).toBeLessThanOrEqual(positions.second.x + 1e-9)
  })

  it('allows the same crossing displacement to cross when the policy is free', () => {
    const arena: CombatArenaDefinition = {
      radius: 50,
      lateralLimit: 50,
      minimumSeparation: 0.1,
      movementPolicy: 'free',
    }
    const requests: MovementRequest[] = [
      { id: 'first', position: { x: -1, z: 0 }, desiredDisplacement: { x: 5, z: 0 } },
      { id: 'second', position: { x: 1, z: 0 }, desiredDisplacement: { x: -5, z: 0 } },
    ]
    const { positions } = resolveSimultaneousMovement(requests, arena)
    expect(positions.first.x).toBeGreaterThan(positions.second.x)
  })

  it('returns actual post-constraint positions so external velocity differs from the naive unconstrained displacement', () => {
    const requests: MovementRequest[] = [{ id: 'a', position: { x: 1.9, z: 0 }, desiredDisplacement: { x: 1, z: 0 } }]
    const arena: CombatArenaDefinition = { radius: 2, lateralLimit: 5, minimumSeparation: 0.9, movementPolicy: 'free' }
    const { positions } = resolveSimultaneousMovement(requests, arena)

    const delta: Vec2 = { x: positions.a.x - requests[0].position.x, z: positions.a.z - requests[0].position.z }
    const actualVelocity: Vec2 = { x: delta.x * TICKS_PER_SECOND, z: delta.z * TICKS_PER_SECOND }
    const naiveVelocity: Vec2 = {
      x: requests[0].desiredDisplacement.x * TICKS_PER_SECOND,
      z: requests[0].desiredDisplacement.z * TICKS_PER_SECOND,
    }

    expect(actualVelocity.x).toBeLessThan(naiveVelocity.x)
  })

  it('accumulates travelled distance across sequential ticks of unconstrained forward motion', () => {
    let position: Vec2 = { x: 0, z: 0 }
    let travelled = 0
    const displacement: Vec2 = { x: heavyProfile.forwardUnitsPerSecond / TICKS_PER_SECOND, z: 0 }

    for (let tick = 0; tick < 5; tick += 1) {
      const { positions } = resolveSimultaneousMovement(
        [{ id: 'solo', position, desiredDisplacement: displacement }],
        openArena,
      )
      travelled += distance(position, positions.solo)
      position = positions.solo
    }

    expect(travelled).toBeCloseTo(5 * (heavyProfile.forwardUnitsPerSecond / TICKS_PER_SECOND), 9)
  })
})
