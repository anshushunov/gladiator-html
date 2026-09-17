import { describe, expect, it } from 'vitest'
import {
  classifyDamage,
  DAMAGE_NUMBER_LIFE_MS,
  DAMAGE_NUMBER_POOL_SIZE,
  DAMAGE_NUMBER_RISE_PX,
  DamageNumberPool,
  layoutDamageNumber,
} from './DamageNumbers'
import type { DamageDealtEvent } from '../simulation/encounter'
import type { ContactZone } from '../simulation/combatActions'

function damageEvent(id: number, contactZone: ContactZone, amount = 31): DamageDealtEvent {
  return {
    id,
    tick: 231,
    type: 'damage-dealt',
    actorId: 'away.drusus',
    targetId: 'home.brutus',
    actionInstanceId: `away.drusus:${id}`,
    actionId: 'fast-slash',
    amount,
    remainingHp: 389,
    contactZone,
    contactPoint: { x: -1.2, z: 0.3 },
  }
}

// Feedback spec §6.2 / §8.1: the layout curve is a pure function of age, and
// reduced motion only removes the rise -- never the number or its fade.
describe('layoutDamageNumber', () => {
  it('starts at rest and fully opaque', () => {
    expect(layoutDamageNumber(0, false)).toEqual({ risePx: 0, opacity: 1 })
  })

  it('holds full opacity through t = 0.55', () => {
    expect(layoutDamageNumber(495, false)?.opacity).toBe(1)
  })

  it('is gone at the end of its life', () => {
    expect(layoutDamageNumber(DAMAGE_NUMBER_LIFE_MS, false)).toBeNull()
    expect(layoutDamageNumber(DAMAGE_NUMBER_LIFE_MS + 1, false)).toBeNull()
  })

  it('fades linearly from the hold to zero', () => {
    // Halfway between the hold's end (t = 0.55) and the end of life.
    const midFade = layoutDamageNumber(DAMAGE_NUMBER_LIFE_MS * 0.775, false)
    expect(midFade?.opacity).toBeCloseTo(0.5, 6)
  })

  it('rises monotonically toward the full rise', () => {
    let previous = -1
    for (let ageMs = 0; ageMs < DAMAGE_NUMBER_LIFE_MS; ageMs += 15) {
      const layout = layoutDamageNumber(ageMs, false)
      expect(layout).not.toBeNull()
      expect(layout!.risePx).toBeGreaterThanOrEqual(previous)
      expect(layout!.risePx).toBeLessThanOrEqual(DAMAGE_NUMBER_RISE_PX)
      previous = layout!.risePx
    }
    expect(previous).toBeGreaterThan(DAMAGE_NUMBER_RISE_PX * 0.99)
  })

  it('under reduced motion never rises and fades identically', () => {
    for (let ageMs = 0; ageMs <= DAMAGE_NUMBER_LIFE_MS; ageMs += 15) {
      const moving = layoutDamageNumber(ageMs, false)
      const still = layoutDamageNumber(ageMs, true)
      if (moving === null) {
        expect(still).toBeNull()
        continue
      }
      expect(still).toEqual({ risePx: 0, opacity: moving.opacity })
    }
  })
})

// The three inputs the kernel can produce (`encounter.ts` emits `critical-hit`
// OR `attack-blocked` before a `damage-dealt`, never both).
describe('classifyDamage', () => {
  it('a body hit paired with critical-hit is critical', () => {
    expect(classifyDamage(damageEvent(1, 'body'), false, true)).toBe('critical')
  })

  it('shield chip damage is shield', () => {
    expect(classifyDamage(damageEvent(2, 'shield', 11), true, false)).toBe('shield')
  })

  it('an unpaired body hit is body', () => {
    expect(classifyDamage(damageEvent(3, 'body'), false, false)).toBe('body')
  })
})

// The entries-only pool: what `ArenaView` drives when it has no DOM to bind
// (`stateHash.test.ts` constructs it in plain Node), and the bookkeeping the
// debug snapshot reads in the browser.
describe('DamageNumberPool without a DOM', () => {
  it('spawns entries in order with the event amount verbatim and alternating lateral', () => {
    const pool = new DamageNumberPool()
    pool.spawn(damageEvent(1, 'body', 31), 'body', 1000)
    pool.spawn(damageEvent(2, 'shield', 11), 'shield', 1000)
    expect(pool.snapshot()).toEqual([
      { id: expect.any(String), amount: 31, kind: 'body' },
      { id: expect.any(String), amount: 11, kind: 'shield' },
    ])
    const [first, second] = pool.entries()
    expect(first.lateral).not.toBe(second.lateral)
    expect(first.worldX).toBe(-1.2)
    expect(first.worldZ).toBe(0.3)
    expect(first.spawnedAtPresentationMs).toBe(1000)
  })

  it('never holds more than six -- a seventh recycles the oldest', () => {
    const pool = new DamageNumberPool()
    for (let i = 1; i <= DAMAGE_NUMBER_POOL_SIZE + 1; i += 1) pool.spawn(damageEvent(i, 'body', i), 'body', 1000 + i)
    expect(pool.snapshot().map((entry) => entry.amount)).toEqual([2, 3, 4, 5, 6, 7])
  })

  it('expires an entry on the encounter clock, at its life', () => {
    const pool = new DamageNumberPool()
    pool.spawn(damageEvent(1, 'body'), 'body', 1000)
    pool.update(1000 + DAMAGE_NUMBER_LIFE_MS - 1, false)
    expect(pool.snapshot()).toHaveLength(1)
    pool.update(1000 + DAMAGE_NUMBER_LIFE_MS, false)
    expect(pool.snapshot()).toEqual([])
  })

  it('clears every entry at once', () => {
    const pool = new DamageNumberPool()
    pool.spawn(damageEvent(1, 'body'), 'body', 0)
    pool.spawn(damageEvent(2, 'body'), 'body', 0)
    pool.clear()
    expect(pool.snapshot()).toEqual([])
  })

  it('touches no document on the headless path', () => {
    expect(typeof document).toBe('undefined')
    const pool = new DamageNumberPool()
    pool.spawn(damageEvent(1, 'body'), 'body', 0)
    pool.update(10, false, { project: () => ({ x: 0, y: 0 }) })
    pool.dispose()
    expect(pool.snapshot()).toEqual([])
  })
})
