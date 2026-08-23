import { describe, expect, it, vi } from 'vitest'
import { COMBAT_STYLES } from '../content/combatStyles'
import { BASELINE_TEST_SEED, homeRoster, opponents } from '../content/mvpSeries'
import { advanceBattleTicks, createBattle, MAX_BOUT_TICKS } from '../simulation/battle'
import { canonicalHash, canonicalJson } from './stateHash'

// This repo has no `jsdom`/`happy-dom` dependency and no `vitest` `environment`
// configured for one (`vite.config.ts`'s `test` block has no `environment` key
// -- Vitest's plain-Node default), and Node has neither `ResizeObserver` nor a
// real WebGL-capable `HTMLCanvasElement`. Rather than pull in a DOM package for
// one freeze proof below, this mocks exactly the two surfaces `ArenaView`'s
// constructor touches that Node does not provide: `THREE.WebGLRenderer`
// (replaced with a no-op stand-in so construction succeeds instead of falling
// into the real `contextLost` failure path -- which would also be viable, but
// deliberately isn't used here, since a `contextLost` renderer returns out of
// `applyFrame` before doing any of the pose/contact/camera reads this test
// exists to prove are safe against a frozen frame) and the global
// `ResizeObserver` constructor. Everything else `three` exports stays real.
vi.mock('three', async (importOriginal) => {
  const actual = await importOriginal<typeof import('three')>()
  class FakeWebGLRenderer {
    shadowMap = { enabled: false }
    domElement = {}
    setPixelRatio(): void {}
    setSize(): void {}
    render(): void {}
    dispose(): void {}
  }
  return { ...actual, WebGLRenderer: FakeWebGLRenderer }
})

// The self-test comes FIRST (see the brief): it is what proves the digest is
// actually hashing nested state, not silently hashing almost nothing. See
// `stateHash.ts`'s own comment for the "obvious" wrong version this caught.
describe('canonicalHash', () => {
  it('reacts to a nested change', () => {
    const a = { combatants: { home: { hp: 100, pos: { x: 1, z: 2 } } } }
    const b = { combatants: { home: { hp: 99, pos: { x: 1, z: 2 } } } }
    expect(canonicalHash(a)).not.toBe(canonicalHash(b))
  })
  it('ignores key order', () => {
    expect(canonicalHash({ a: 1, b: 2 })).toBe(canonicalHash({ b: 2, a: 1 }))
  })
})

// The behaviour invariant proper: hashes the WHOLE `BattleState` after every
// tick (tick, phase, per-combatant RNG, result, winner, finish reason all
// belong in it), not just the terminal combatants, for every one of the 3x3
// home/opponent pairings. Every task after this one in the slice is
// presentation-only; this is what makes "nothing behavioural moved" checkable
// against -- a later task's `npm test` reproducing these nine digests
// unchanged is the proof.
// Nine full duels (up to `MAX_BOUT_TICKS` = 3600 ticks each), hashing whole
// state after every single tick rather than every batch -- measured at
// 4.5-5.3s on this machine, comfortably past Vitest's 5000ms default test
// timeout on a slower run. An explicit timeout, not a sign this hangs.
it('pins a rolling per-tick hash of all nine pairings', () => {
  const rows = homeRoster.slice(0, 3).flatMap((home) =>
    opponents.map((away) => {
      let battle = createBattle({ home, away, seed: BASELINE_TEST_SEED, combatStyles: COMBAT_STYLES })
      let rolling = canonicalHash(battle)
      for (let i = 0; i < MAX_BOUT_TICKS && battle.encounter.phase !== 'finished'; i += 1) {
        battle = advanceBattleTicks(battle, 1)
        rolling = canonicalHash({ rolling, state: battle })
      }
      return `${home.id}/${away.id}:${rolling}`
    }),
  )
  expect(rows).toMatchInlineSnapshot(`
    [
      "brutus/drusus:469f52a6",
      "brutus/cassius:3f6f97b3",
      "brutus/magnus:3ea9fe0e",
      "aquila/drusus:5fcdc19c",
      "aquila/cassius:fc570d45",
      "aquila/magnus:ba1081e",
      "nerva/drusus:d2f624af",
      "nerva/cassius:fbc8d35c",
      "nerva/magnus:3e0c6a9f",
    ]
  `)
}, 30_000)

// Step 5's proof: `ArenaView.sync()` freezes `BattleRenderFrame`'s battle
// states and events before ever reading them (pose sampling, contact
// targeting, camera framing all read `previous`/`current` deeply, every
// frame), so this renderer can never accidentally write back into
// simulation state. Canonical JSON of `frame.current` before `sync()`, after
// `sync()`, and after a dev-only replay of the same frame at a different
// alpha (`renderActiveBattleAtAlpha`, `main.ts`'s "dev replay") must all be
// byte-identical -- and a direct write attempt after `sync()` must throw,
// which is what proves the freeze actually took (not just that this
// particular render pass happened not to touch anything).
describe('ArenaView never mutates a frozen render frame', () => {
  it('leaves the battle states byte-identical across sync and a dev replay', async () => {
    class FakeResizeObserver {
      observe(): void {}
      unobserve(): void {}
      disconnect(): void {}
    }
    const previousResizeObserver = (globalThis as { ResizeObserver?: unknown }).ResizeObserver
    ;(globalThis as { ResizeObserver?: unknown }).ResizeObserver = FakeResizeObserver

    try {
      const { ArenaView } = await import('../presentation/ArenaView')

      const fakeCanvas = {
        addEventListener: () => {},
        removeEventListener: () => {},
        dataset: {},
      } as unknown as HTMLCanvasElement

      const view = new ArenaView(fakeCanvas)

      const previous = createBattle({ home: homeRoster[0], away: opponents[0], seed: BASELINE_TEST_SEED, combatStyles: COMBAT_STYLES })
      const current = advanceBattleTicks(previous, 5)
      const frame = { previous, current, alpha: 0.5, events: current.events.slice(previous.events.length) }

      const before = canonicalJson(frame.current)

      view.sync(frame)
      expect(canonicalJson(frame.current)).toBe(before)

      // Non-optional: proves the dev replay path was actually exercised,
      // not silently skipped by `?.` on an undefined dev-only surface.
      expect(view.renderActiveBattleAtAlpha).toBeTypeOf('function')
      view.renderActiveBattleAtAlpha!(0.9)
      expect(canonicalJson(frame.current)).toBe(before)

      expect(() => {
        ;(frame.current.encounter as { tick: number }).tick = -1
      }).toThrow(TypeError)
    } finally {
      ;(globalThis as { ResizeObserver?: unknown }).ResizeObserver = previousResizeObserver
    }
  })
})
