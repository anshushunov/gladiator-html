# Gladiator School Series Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a complete three-gladiator planning, three-bout playback, summary, and seeded-rematch loop on top of the existing Three.js prototype while keeping combat simulation replaceable.

**Architecture:** Pure TypeScript modules under `src/simulation/` own fighter rules, seeded randomness, one-bout state, and the four-phase series state machine. Static roster data lives in `src/content/`; `SeriesView` renders DOM state, `ArenaView` renders the active bout, and `main.ts` only translates browser input and fixed ticks into pure transitions.

**Tech Stack:** TypeScript 5.8, Vitest 3, Three.js 0.179, Vite 7, Playwright 1.54, semantic HTML, and CSS.

## Global Constraints

- Before Task 1, invoke `superpowers:using-git-worktrees` and create an isolated implementation worktree; do not implement in the documentation branch.
- Read `docs/superpowers/specs/2026-08-15-gladiator-school-series-design.md` before Task 1; it is the source of truth.
- Use Node.js 22+ or 20.19+ and the existing npm dependencies. Add no framework or runtime dependency.
- `src/simulation/` must not import Three.js, DOM APIs, `Math.random()`, or `crypto`.
- Simulation time is integer ticks: `TICKS_PER_SECOND = 60`, `MAX_BOUT_TICKS = 2700`.
- Baseline content uses `TARGET_MIN_BOUT_TICKS = 840` and `TARGET_MAX_BOUT_TICKS = 1800`, matching the spec's 14–30 second target.
- Every bout has exactly one winner; do not retain a draw or mutual-defeat branch.
- The URL seed is an unsigned 32-bit decimal. Tests use `20260815`; rematch preserves it.
- Each attack consumes exactly three actor-stream PRNG values: accuracy, block, critical.
- Events have monotonically increasing IDs within a bout and restart for each new battle.
- Use plain functions and focused modules. Keep game rules out of `src/main.ts` and `src/presentation/`.
- Simulation changes run `npm test`; UI changes run `npm run test:e2e`; final handoff runs `npm run check`.
- Do not stage or commit `docs/superpowers/specs/2026-08-15-gladiator-school-series-design.review.md` unless the user separately requests it.

## File Map

| Path | Responsibility |
| --- | --- |
| `src/simulation/fighters.ts` | Fighter definitions, sides, archetypes, comparisons, and damage multipliers |
| `src/simulation/random.ts` | Uint32 seeded PRNG and labelled bout/side seed derivation |
| `src/simulation/battle.ts` | Tick-based parameterized single-bout simulation and structured events |
| `src/simulation/series.ts` | Assignments, four phases, bout results, score, and rematch commands |
| `src/content/mvpSeries.ts` | Six immutable fighter definitions and fixed opponent order |
| `src/presentation/SeriesView.ts` | DOM rendering, local selection state, focus management, and user intents |
| `src/presentation/battleFeed.ts` | Pure structured-event-to-feed-entry formatting |
| `src/presentation/ArenaView.ts` | Two side-keyed meshes, bout lifecycle, state sync, and event reactions |
| `src/main.ts` | URL seed, runtime pause/speed, tick accumulator, view sync, and test hook |
| `index.html` | Stable semantic containers for planning, arena, interstitial, and summary |
| `src/style.css` | Planning, battle, summary, responsive, focus-visible, and state styles |
| `tests/smoke.spec.ts` | Seeded full-flow, keyboard, lifecycle, and rematch browser tests |
| `tests/__screenshots__/planning.png` | Stable hidden-canvas planning baseline |
| `README.md` | New player loop, seed URL, controls, architecture, and next combat spikes |

---

### Task 1: Fighter Domain and MVP Content

**Files:**
- Create: `src/simulation/fighters.ts`
- Create: `src/simulation/fighters.test.ts`
- Create: `src/content/mvpSeries.ts`
- Create: `src/content/mvpSeries.test.ts`

**Interfaces:**
- Consumes: no new project interfaces.
- Produces: `Archetype`, `FighterSide`, `MatchupComparison`, `FighterDefinition`, `compareArchetypes(home, away)`, `comparisonDamageMultiplier(comparison)`, `homeRoster`, and `opponents`.

- [ ] **Step 1: Write the failing archetype tests**

Create `src/simulation/fighters.test.ts` with explicit direction and multiplier assertions:

```ts
import { describe, expect, it } from 'vitest'
import { compareArchetypes, comparisonDamageMultiplier, type Archetype } from './fighters'

describe('archetype comparison', () => {
  it.each([
    ['heavy', 'fast'],
    ['fast', 'technical'],
    ['technical', 'heavy'],
  ] as const)('%s has advantage against %s', (home, away) => {
    expect(compareArchetypes(home, away)).toBe('advantage')
    expect(compareArchetypes(away, home)).toBe('disadvantage')
  })

  it.each(['heavy', 'fast', 'technical'] satisfies Archetype[])('%s is neutral against itself', (archetype) => {
    expect(compareArchetypes(archetype, archetype)).toBe('neutral')
  })

  it('orders damage multipliers from disadvantage to advantage', () => {
    expect([
      comparisonDamageMultiplier('disadvantage'),
      comparisonDamageMultiplier('neutral'),
      comparisonDamageMultiplier('advantage'),
    ]).toEqual([0.8, 1, 1.25])
  })
})
```

- [ ] **Step 2: Run the focused test and confirm the missing module failure**

Run: `npx vitest run src/simulation/fighters.test.ts`

Expected: FAIL because `./fighters` does not exist.

- [ ] **Step 3: Implement the fighter domain**

Create `src/simulation/fighters.ts` with these exact public types and a single explicit counter map:

```ts
export type FighterSide = 'home' | 'away'
export type Archetype = 'heavy' | 'fast' | 'technical'
export type MatchupComparison = 'advantage' | 'neutral' | 'disadvantage'

export interface FighterDefinition {
  id: string
  name: string
  school: string
  archetype: Archetype
  maxHp: number
  damage: number
  attackIntervalTicks: number
  accuracy: number
  blockChance: number
  criticalChance: number
}

const COUNTERS: Record<Archetype, Archetype> = {
  heavy: 'fast',
  fast: 'technical',
  technical: 'heavy',
}

const DAMAGE_MULTIPLIERS: Record<MatchupComparison, number> = {
  advantage: 1.25,
  neutral: 1,
  disadvantage: 0.8,
}

export function compareArchetypes(home: Archetype, away: Archetype): MatchupComparison {
  if (home === away) return 'neutral'
  return COUNTERS[home] === away ? 'advantage' : 'disadvantage'
}

export function comparisonDamageMultiplier(comparison: MatchupComparison): number {
  return DAMAGE_MULTIPLIERS[comparison]
}
```

- [ ] **Step 4: Write the failing roster-content test**

Create `src/content/mvpSeries.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { homeRoster, opponents } from './mvpSeries'

describe('MVP series content', () => {
  it.each([
    ['home', homeRoster],
    ['away', opponents],
  ] as const)('%s roster has one fighter of every archetype', (_side, roster) => {
    expect(roster).toHaveLength(3)
    expect(roster.map(({ archetype }) => archetype).sort()).toEqual(['fast', 'heavy', 'technical'])
    expect(new Set(roster.map(({ id }) => id)).size).toBe(3)
  })

  it('keeps the fixed opponent order', () => {
    expect(opponents.map(({ name }) => name)).toEqual(['Drusus', 'Cassius', 'Magnus'])
  })
})
```

- [ ] **Step 5: Add the six exact content rows**

Create `src/content/mvpSeries.ts`. Use `satisfies readonly FighterDefinition[]` so literals remain readonly and all statistics are type-checked:

```ts
import type { FighterDefinition } from '../simulation/fighters'

export const homeRoster = [
  { id: 'brutus', name: 'Brutus', school: 'House of Mars', archetype: 'heavy', maxHp: 360, damage: 12, attackIntervalTicks: 54, accuracy: 0.86, blockChance: 0.18, criticalChance: 0.10 },
  { id: 'aquila', name: 'Aquila', school: 'House of Mars', archetype: 'fast', maxHp: 240, damage: 8, attackIntervalTicks: 38, accuracy: 0.82, blockChance: 0.08, criticalChance: 0.12 },
  { id: 'nerva', name: 'Nerva', school: 'House of Mars', archetype: 'technical', maxHp: 345, damage: 12, attackIntervalTicks: 44, accuracy: 0.92, blockChance: 0.16, criticalChance: 0.16 },
] as const satisfies readonly FighterDefinition[]

export const opponents = [
  { id: 'drusus', name: 'Drusus', school: 'House of Saturn', archetype: 'fast', maxHp: 390, damage: 13, attackIntervalTicks: 36, accuracy: 0.90, blockChance: 0.12, criticalChance: 0.15 },
  { id: 'cassius', name: 'Cassius', school: 'House of Neptune', archetype: 'technical', maxHp: 330, damage: 11, attackIntervalTicks: 48, accuracy: 0.90, blockChance: 0.15, criticalChance: 0.12 },
  { id: 'magnus', name: 'Magnus', school: 'House of Vulcan', archetype: 'heavy', maxHp: 300, damage: 10, attackIntervalTicks: 62, accuracy: 0.78, blockChance: 0.18, criticalChance: 0.06 },
] as const satisfies readonly FighterDefinition[]

export const BASELINE_TEST_SEED = 20260815
export const TARGET_MIN_BOUT_TICKS = 840
export const TARGET_MAX_BOUT_TICKS = 1800
```

- [ ] **Step 6: Run domain checks and commit**

Run: `npx vitest run src/simulation/fighters.test.ts src/content/mvpSeries.test.ts`

Expected: PASS.

Run: `npm run build`

Expected: PASS; the new modules are additive.

```bash
git add src/simulation/fighters.ts src/simulation/fighters.test.ts src/content/mvpSeries.ts src/content/mvpSeries.test.ts
git commit -m "feat: define fighter archetypes and MVP rosters"
```

---

### Task 2: Seeded Random Streams

**Files:**
- Create: `src/simulation/random.ts`
- Create: `src/simulation/random.test.ts`

**Interfaces:**
- Consumes: `FighterSide` from `src/simulation/fighters.ts`.
- Produces: `RandomState`, `createRandom(seed)`, `nextRandom(state)`, `deriveSeed(seed, label)`, `deriveBoutSeed(seriesSeed, boutIndex)`, `deriveSideSeed(boutSeed, side)`, and `drawAttackRolls(state)`.

- [ ] **Step 1: Write deterministic and stream-isolation tests**

Create `src/simulation/random.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { createRandom, deriveBoutSeed, deriveSideSeed, drawAttackRolls, nextRandom } from './random'

describe('seeded random', () => {
  it('repeats the same sequence for the same seed', () => {
    let first = createRandom(20260815)
    let second = createRandom(20260815)
    const firstValues: number[] = []
    const secondValues: number[] = []
    for (let index = 0; index < 8; index += 1) {
      const [a, nextA] = nextRandom(first)
      const [b, nextB] = nextRandom(second)
      firstValues.push(a)
      secondValues.push(b)
      first = nextA
      second = nextB
    }
    expect(firstValues).toEqual(secondValues)
  })

  it('derives stable distinct bout and side streams', () => {
    const bout0 = deriveBoutSeed(20260815, 0)
    const bout1 = deriveBoutSeed(20260815, 1)
    expect(bout0).toBe(deriveBoutSeed(20260815, 0))
    expect(bout0).not.toBe(bout1)
    expect(deriveSideSeed(bout0, 'home')).not.toBe(deriveSideSeed(bout0, 'away'))
  })

  it('consumes exactly three values for every attack', () => {
    const initial = createRandom(17)
    const drawn = drawAttackRolls(initial)
    let expected = initial
    for (let index = 0; index < 3; index += 1) expected = nextRandom(expected)[1]
    expect(drawn.next).toEqual(expected)
  })
})
```

- [ ] **Step 2: Confirm the missing module failure**

Run: `npx vitest run src/simulation/random.test.ts`

Expected: FAIL because `./random` does not exist.

- [ ] **Step 3: Implement the uint32 generator and labelled derivation**

Use xorshift32 for `nextRandom`; normalize zero to `0x6d2b79f5`. Use FNV-1a over the UTF-16 code units of the label, starting from `seed ^ 0x811c9dc5`, for `deriveSeed`. Keep all arithmetic unsigned with `>>> 0` and `Math.imul`.

```ts
import type { FighterSide } from './fighters'

export interface RandomState { value: number }
export interface AttackRolls { accuracy: number; block: number; critical: number }

const NON_ZERO_SEED = 0x6d2b79f5

export function createRandom(seed: number): RandomState {
  const value = seed >>> 0
  return { value: value === 0 ? NON_ZERO_SEED : value }
}

export function nextRandom(state: RandomState): [number, RandomState] {
  let value = state.value >>> 0
  value ^= value << 13
  value ^= value >>> 17
  value ^= value << 5
  value >>>= 0
  return [value / 0x1_0000_0000, { value }]
}

export function deriveSeed(seed: number, label: string): number {
  let value = (seed ^ 0x811c9dc5) >>> 0
  for (let index = 0; index < label.length; index += 1) {
    value ^= label.charCodeAt(index)
    value = Math.imul(value, 0x01000193) >>> 0
  }
  return createRandom(value).value
}

export const deriveBoutSeed = (seriesSeed: number, boutIndex: number): number => deriveSeed(seriesSeed, `bout:${boutIndex}`)
export const deriveSideSeed = (boutSeed: number, side: FighterSide): number => deriveSeed(boutSeed, `side:${side}`)

export function drawAttackRolls(state: RandomState): { rolls: AttackRolls; next: RandomState } {
  const [accuracy, afterAccuracy] = nextRandom(state)
  const [block, afterBlock] = nextRandom(afterAccuracy)
  const [critical, next] = nextRandom(afterBlock)
  return { rolls: { accuracy, block, critical }, next }
}
```

- [ ] **Step 4: Run tests, build, and commit**

Run: `npx vitest run src/simulation/random.test.ts`

Expected: PASS.

Run: `npm run build`

Expected: PASS.

```bash
git add src/simulation/random.ts src/simulation/random.test.ts
git commit -m "feat: add deterministic combat random streams"
```

---

### Task 3: Parameterized Tick-Based Bout

**Files:**
- Replace: `src/simulation/battle.ts`
- Replace: `src/simulation/battle.test.ts`
- Create: `src/presentation/battleFeed.ts`
- Create: `src/presentation/battleFeed.test.ts`
- Modify: `src/presentation/ArenaView.ts:1-43`
- Modify: `src/main.ts:1-109`

**Interfaces:**
- Consumes: `FighterDefinition`, `FighterSide`, `MatchupComparison`, counter helpers, and random helpers from Tasks 1–2.
- Produces: `BattleConfig`, `BattleState`, `BattleEvent`, `createBattle(config)`, `advanceBattleTick(state)`, `advanceBattleTicks(state, ticks)`, and `calculateDamage(input)`.

- [ ] **Step 1: Replace the old tests with failing tick/event tests**

Create fixtures inside `src/simulation/battle.test.ts` and assert the public contract:

```ts
import { describe, expect, it } from 'vitest'
import { advanceBattleTick, advanceBattleTicks, calculateDamage, createBattle, MAX_BOUT_TICKS, type BattleConfig } from './battle'
import type { FighterDefinition } from './fighters'
import { nextRandom } from './random'

const heavy: FighterDefinition = { id: 'heavy', name: 'Heavy', school: 'Test', archetype: 'heavy', maxHp: 100, damage: 10, attackIntervalTicks: 30, accuracy: 1, blockChance: 0, criticalChance: 0 }
const fast: FighterDefinition = { id: 'fast', name: 'Fast', school: 'Test', archetype: 'fast', maxHp: 100, damage: 10, attackIntervalTicks: 30, accuracy: 1, blockChance: 0, criticalChance: 0 }
const finished = (config: BattleConfig) => advanceBattleTicks(createBattle(config), MAX_BOUT_TICKS)

describe('battle simulation', () => {
  it('uses ticks and structured opening events', () => {
    const state = createBattle({ home: heavy, away: fast, seed: 7 })
    expect(state.tick).toBe(0)
    expect(state.comparison).toBe('advantage')
    expect(state.events[0]).toMatchObject({ id: 0, tick: 0, type: 'bout-started', homeFighterId: 'heavy', awayFighterId: 'fast' })
    expect(state.events).toHaveLength(1)
  })

  it('applies ordered comparison damage and a one-point minimum', () => {
    expect(calculateDamage({ baseDamage: 10, comparison: 'disadvantage', blocked: false, critical: false })).toBe(8)
    expect(calculateDamage({ baseDamage: 10, comparison: 'neutral', blocked: false, critical: false })).toBe(10)
    expect(calculateDamage({ baseDamage: 10, comparison: 'advantage', blocked: false, critical: false })).toBe(13)
    expect(calculateDamage({ baseDamage: 2, comparison: 'disadvantage', blocked: true, critical: false })).toBe(1)
  })

  it('is reproducible and always selects one winner', () => {
    const config = { home: heavy, away: fast, seed: 99 }
    const first = advanceBattleTicks(createBattle(config), MAX_BOUT_TICKS)
    const second = advanceBattleTicks(createBattle(config), MAX_BOUT_TICKS)
    expect(first).toEqual(second)
    expect(first.phase).toBe('finished')
    expect(['home', 'away']).toContain(first.winnerSide)
  })
})
```

Use the already-declared `finished(config)` helper in these concrete cases. The 200-seed matrix intentionally holds non-archetype statistics constant: it proves termination across counter relationships, not content diversity.

```ts
it('finishes every archetype pairing across 200 seeds', () => {
  const archetypes = ['heavy', 'fast', 'technical'] as const
  for (const homeArchetype of archetypes) {
    for (const awayArchetype of archetypes) {
      for (let seed = 1; seed <= 200; seed += 1) {
        const home = { ...heavy, id: `home-${homeArchetype}`, archetype: homeArchetype }
        const away = { ...fast, id: `away-${awayArchetype}`, archetype: awayArchetype }
        const state = advanceBattleTicks(createBattle({ home, away, seed }), MAX_BOUT_TICKS)
        expect(state.phase).toBe('finished')
        expect(['home', 'away']).toContain(state.winnerSide)
        expect(state.tick).toBeLessThanOrEqual(MAX_BOUT_TICKS)
      }
    }
  }
})

it('does not let a defeated fighter answer on the same tick', () => {
  const lethal = { ...heavy, damage: 500, attackIntervalTicks: 1 }
  const state = advanceBattleTicks(createBattle({ home: lethal, away: { ...fast, damage: 500, attackIntervalTicks: 1 }, seed: 3 }), MAX_BOUT_TICKS)
  const defeatIndex = state.events.findIndex(({ type }) => type === 'fighter-defeated')
  const sameTick = state.events[defeatIndex].tick
  expect(state.events.slice(defeatIndex + 1).filter((event) => event.tick === sameTick && event.type === 'attack-started')).toEqual([])
})

it('emits a finish reason and canonical terminal event', () => {
  const state = finished({ home: heavy, away: fast, seed: 11 })
  expect(state.events.at(-1)).toMatchObject({ type: 'bout-finished', winnerSide: state.winnerSide, reason: state.finishReason, durationTicks: state.tick })
})

it('advances the actor stream by exactly three values on attack', () => {
  let state = createBattle({ home: heavy, away: { ...fast, attackIntervalTicks: 60 }, seed: 13 })
  let before = state
  while (!state.events.some(({ type }) => type === 'attack-started')) {
    before = state
    state = advanceBattleTick(state)
  }
  const actor = state.events.find(({ type }) => type === 'attack-started')
  if (!actor || actor.type !== 'attack-started') throw new Error('Expected an attack')
  let expected = before.random[actor.actorSide]
  for (let index = 0; index < 3; index += 1) expected = nextRandom(expected)[1]
  expect(state.random[actor.actorSide]).toEqual(expected)
})

it('schedules the faster fighter to make the first attack after contact', () => {
  let state = createBattle({ home: { ...heavy, attackIntervalTicks: 20 }, away: { ...fast, attackIntervalTicks: 60 }, seed: 17 })
  while (!state.events.some(({ type }) => type === 'attack-started')) state = advanceBattleTick(state)
  expect(state.events.find(({ type }) => type === 'attack-started')).toMatchObject({ actorSide: 'home' })
  expect(state.events.filter(({ type }) => type === 'attack-started')).toHaveLength(1)
})

it('does not shift the away stream when only home attacks', () => {
  let state = createBattle({ home: { ...heavy, attackIntervalTicks: 20 }, away: { ...fast, attackIntervalTicks: 60 }, seed: 23 })
  while (!state.events.some(({ type }) => type === 'attack-started')) {
    const previousAway = state.random.away
    state = advanceBattleTick(state)
    if (state.events.some(({ type }) => type === 'attack-started')) expect(state.random.away).toBe(previousAway)
  }
})

it('consumes the separate tie stream for equal-interval initiative', () => {
  let state = createBattle({ home: { ...heavy, accuracy: 0 }, away: { ...fast, accuracy: 0 }, seed: 29 })
  let before = state
  while (!state.events.some(({ type }) => type === 'attack-started')) {
    before = state
    state = advanceBattleTick(state)
  }
  expect(state.initiativeTieRandom).toEqual(nextRandom(before.initiativeTieRandom)[1])
})

it.each([
  [{ ...heavy, accuracy: 0 }, { ...fast, blockChance: 0 }, ['attack-started', 'attack-missed']],
  [{ ...heavy, accuracy: 1 }, { ...fast, blockChance: 1 }, ['attack-started', 'attack-blocked', 'damage-dealt']],
  [{ ...heavy, accuracy: 1, criticalChance: 1, damage: 500 }, { ...fast, blockChance: 0 }, ['attack-started', 'critical-hit', 'damage-dealt', 'fighter-defeated', 'bout-finished']],
] as const)('emits the canonical first attack sequence', (home, away, expectedTypes) => {
  let state = createBattle({ home, away: { ...away, attackIntervalTicks: 60 }, seed: 19 })
  while (!state.events.some(({ type }) => type === 'attack-started')) state = advanceBattleTick(state)
  const firstAttackTick = state.events.find(({ type }) => type === 'attack-started')?.tick
  expect(state.events.filter(({ tick }) => tick === firstAttackTick).map(({ type }) => type)).toEqual(expectedTypes)
})
```

- [ ] **Step 2: Run the battle test and confirm API failures**

Run: `npx vitest run src/simulation/battle.test.ts`

Expected: FAIL because the old battle module has no parameterized config, tick API, comparison, or structured events.

- [ ] **Step 3: Implement the battle types and pure damage calculation**

Use these discriminants and fields in `src/simulation/battle.ts`:

```ts
export const TICKS_PER_SECOND = 60
export const MAX_BOUT_TICKS = 2700

export type BattleFinishReason = 'defeat' | 'time-limit'
export type BattlePhase = 'running' | 'finished'

export interface BattleConfig { home: FighterDefinition; away: FighterDefinition; seed: number }
export interface FighterCombatState {
  side: FighterSide
  definition: FighterDefinition
  x: number
  hp: number
  nextAttackTick: number | null
  status: 'active' | 'defeated'
}

export interface BattleState {
  tick: number
  phase: BattlePhase
  approachStarted: boolean
  comparison: MatchupComparison
  fighters: Record<FighterSide, FighterCombatState>
  random: Record<FighterSide, RandomState>
  initiativeTieRandom: RandomState
  timeLimitTieWinner: FighterSide
  winnerSide?: FighterSide
  finishReason?: BattleFinishReason
  events: BattleEvent[]
  nextEventId: number
}

type EventBase = { id: number; tick: number }
export type BattleEvent =
  | (EventBase & { type: 'bout-started'; homeFighterId: string; awayFighterId: string })
  | (EventBase & { type: 'approach-started' })
  | (EventBase & { type: 'attack-started'; actorSide: FighterSide; targetSide: FighterSide })
  | (EventBase & { type: 'attack-missed'; actorSide: FighterSide; targetSide: FighterSide })
  | (EventBase & { type: 'attack-blocked'; actorSide: FighterSide; targetSide: FighterSide })
  | (EventBase & { type: 'critical-hit'; actorSide: FighterSide; targetSide: FighterSide; multiplier: number })
  | (EventBase & { type: 'damage-dealt'; actorSide: FighterSide; targetSide: FighterSide; amount: number; remainingHp: number })
  | (EventBase & { type: 'fighter-defeated'; defeatedSide: FighterSide; winnerSide: FighterSide })
  | (EventBase & { type: 'bout-finished'; winnerSide: FighterSide; reason: BattleFinishReason; durationTicks: number })
```

Define `BattleEvent` as a discriminated union matching the nine event payloads in the spec. Keep event sides as `home | away`; only `bout-started` contains content fighter IDs.

Implement `calculateDamage` with this exact operation order:

```ts
export function calculateDamage(input: { baseDamage: number; comparison: MatchupComparison; blocked: boolean; critical: boolean }): number {
  const blockMultiplier = input.blocked ? 0.5 : 1
  const criticalMultiplier = input.critical ? 1.5 : 1
  return Math.max(1, Math.round(input.baseDamage * comparisonDamageMultiplier(input.comparison) * blockMultiplier * criticalMultiplier))
}
```

For away attacks, invert the home comparison before calling `calculateDamage`.

- [ ] **Step 4: Implement one-tick movement, attack ordering, events, and finish rules**

Use `MOVE_PER_TICK = 2.2 / TICKS_PER_SECOND`, `ATTACK_RANGE = 1.45`, and starting positions `-5` and `5`. Create the battle with only `bout-started`; append `approach-started` on the first tick that actually moves both fighters. Before contact, `nextAttackTick` is `null`. On first entering range at tick `T`, assign each fighter `nextAttackTick = T + definition.attackIntervalTicks`, so the faster fighter attacks first.

On an attack, always call `drawAttackRolls`, store its `next` state, and then emit exactly one canonical sequence. A probability check succeeds only when `roll < probability`. Resolve ready attackers in attack-interval order. When equal intervals are ready on the same tick, draw from `initiativeTieRandom`, persist its next state, and choose home for a roll below `0.5`, otherwise away. Skip the second actor if defeated.

At tick 2700, resolve scheduled attacks first. If nobody is defeated, compare `hp / maxHp`, use `timeLimitTieWinner` for an exact tie, and emit `bout-finished` with `reason: 'time-limit'`.

Only allocate a new events array on a tick that emits events. Remove the old eight-event truncation and remove all English messages from simulation.

`advanceBattleTicks(state, ticks)` applies one-tick transitions but returns immediately when `phase === 'finished'`; it must not allocate copies for the remaining requested ticks.

- [ ] **Step 5: Add and test pure feed formatting**

Create `src/presentation/battleFeed.ts` with:

```ts
import { TICKS_PER_SECOND, type BattleEvent } from '../simulation/battle'
import type { FighterSide } from '../simulation/fighters'

export interface BattleFeedEntry { eventId: number; atSeconds: number; message: string }

export function formatBattleFeed(events: readonly BattleEvent[], names: Record<FighterSide, string>): BattleFeedEntry[] {
  const entries: BattleFeedEntry[] = []
  const recent = events.slice(-20)
  for (let index = 0; index < recent.length; index += 1) {
    const event = recent[index]
    if (event.type === 'attack-started') continue
    const next = recent[index + 1]
    let message: string
    if (event.type === 'attack-blocked' && next?.type === 'damage-dealt') {
      message = `${names[event.targetSide]} blocks but takes ${next.amount}.`
      index += 1
    } else if (event.type === 'critical-hit' && next?.type === 'damage-dealt') {
      message = `${names[event.actorSide]} lands a critical hit for ${next.amount}.`
      index += 1
    } else {
      message = formatEventMessage(event, names)
    }
    entries.push({ eventId: event.id, atSeconds: event.tick / TICKS_PER_SECOND, message })
  }
  return entries.slice(-8)
}

function formatEventMessage(event: BattleEvent, names: Record<FighterSide, string>): string {
  switch (event.type) {
    case 'bout-started': return 'The gates open.'
    case 'approach-started': return 'The fighters close the distance.'
    case 'attack-started': return ''
    case 'attack-missed': return `${names[event.actorSide]} misses.`
    case 'attack-blocked': return `${names[event.targetSide]} blocks.`
    case 'critical-hit': return `${names[event.actorSide]} lands a critical hit.`
    case 'damage-dealt': return `${names[event.actorSide]} deals ${event.amount}.`
    case 'fighter-defeated': return `${names[event.defeatedSide]} falls.`
    case 'bout-finished': return event.reason === 'defeat'
      ? `${names[event.winnerSide]} wins by defeat.`
      : `${names[event.winnerSide]} wins on the time limit.`
  }
}
```

Create `src/presentation/battleFeed.test.ts` with concrete union members and these assertions:

```ts
import { describe, expect, it } from 'vitest'
import { formatBattleFeed } from './battleFeed'

describe('battle feed', () => {
  const names = { home: 'Brutus', away: 'Cassius' }

  it('combines a block with its reduced damage', () => {
    const entries = formatBattleFeed([
      { id: 0, tick: 60, type: 'attack-blocked', actorSide: 'home', targetSide: 'away' },
      { id: 1, tick: 60, type: 'damage-dealt', actorSide: 'home', targetSide: 'away', amount: 4, remainingHp: 96 },
    ], names)
    expect(entries).toEqual([{ eventId: 0, atSeconds: 1, message: 'Cassius blocks but takes 4.' }])
  })

  it('combines a critical event with its damage', () => {
    const entries = formatBattleFeed([
      { id: 0, tick: 120, type: 'critical-hit', actorSide: 'home', targetSide: 'away', multiplier: 1.5 },
      { id: 1, tick: 120, type: 'damage-dealt', actorSide: 'home', targetSide: 'away', amount: 18, remainingHp: 82 },
    ], names)
    expect(entries[0].message).toBe('Brutus lands a critical hit for 18.')
  })

  it.each([['defeat', 'wins by defeat'], ['time-limit', 'wins on the time limit']] as const)('formats %s finishes', (reason, copy) => {
    const entries = formatBattleFeed([{ id: 0, tick: 2700, type: 'bout-finished', winnerSide: 'home', reason, durationTicks: 2700 }], names)
    expect(entries[0].message).toContain(copy)
  })
})
```

- [ ] **Step 6: Keep the existing single-bout page compiling during migration**

Update `ArenaView` to key its internal groups by `FighterSide` and read `state.fighters.home` / `state.fighters.away`. Do not change `index.html`, current `data-testid` values, `data-hp="red|blue"`, or `data-health="red|blue"` in this task. In `main.ts`, temporarily map `home` to the existing red DOM selectors and `away` to blue. Define local migration fixtures matching the existing screenshot exactly: Brutus and Cassius both have `maxHp: 100`, `damage: 10`, `attackIntervalTicks: 43`, `accuracy: 1`, `blockChance: 0`, and `criticalChance: 0`; Brutus is `heavy`, Cassius is `technical`. Advance this bout with integer ticks and call `formatBattleFeed(events, { home: 'Brutus', away: 'Cassius' })`. Task 5 deletes these local fixtures and switches to `mvpSeries.ts`.

Keep the temporary browser hook shape `getState/advance/reset` for this task only, but make `advance(seconds)` call `advanceBattleTicks(battle, Math.round(seconds * TICKS_PER_SECOND))`. Task 5 replaces this hook with the final series API.

- [ ] **Step 7: Verify the combat vertical slice and commit**

Run: `npm test`

Expected: PASS, including the 200-seed matrix.

Run: `npm run build`

Expected: PASS with no `FighterId`, `winnerId`, floating simulation time, message event, or draw branch remaining.

Run: `npm run test:e2e`

Expected: PASS against the visually unchanged single-bout page and existing `arena.png` baseline.

```bash
git add src/simulation/battle.ts src/simulation/battle.test.ts src/presentation/battleFeed.ts src/presentation/battleFeed.test.ts src/presentation/ArenaView.ts src/main.ts
git commit -m "feat: parameterize deterministic tick-based bouts"
```

---

### Task 4: Pure Three-Bout Series State Machine

**Files:**
- Create: `src/simulation/series.ts`
- Create: `src/simulation/series.test.ts`
- Create: `src/simulation/architecture.test.ts`
- Modify: `src/content/mvpSeries.ts`

**Interfaces:**
- Consumes: `FighterDefinition`, `MatchupComparison`, `BattleState`, `createBattle`, `advanceBattleTicks`, and `deriveBoutSeed`.
- Produces: `SeriesState`, `BoutResult`, `SeriesCommandResult`, `createSeries`, `getAssignmentComparison`, `assignFighter`, `unassignSlot`, `confirmLineup`, `advanceSeriesTicks`, `startNextBout`, and `rematch`.

- [ ] **Step 1: Write failing assignment and phase tests**

Create `src/simulation/series.test.ts` with a `createMvpSeries()` helper and these exact behaviors:

```ts
import { describe, expect, it } from 'vitest'
import { BASELINE_TEST_SEED, homeRoster, opponents, TARGET_MAX_BOUT_TICKS, TARGET_MIN_BOUT_TICKS } from '../content/mvpSeries'
import { advanceBattleTicks } from './battle'
import { advanceSeriesTicks, assignFighter, confirmLineup, createSeries, rematch, startNextBout, unassignSlot } from './series'

const createMvpSeries = () => createSeries({ homeRoster, opponents, seed: BASELINE_TEST_SEED })

describe('series planning', () => {
  it('moves and displaces unique assignments', () => {
    let state = createMvpSeries()
    state = assignFighter(state, 'brutus', 0).state
    state = assignFighter(state, 'aquila', 0).state
    expect(state.assignments).toEqual(['aquila', null, null])
    state = assignFighter(state, 'aquila', 2).state
    expect(state.assignments).toEqual([null, null, 'aquila'])
  })

  it('rejects incomplete confirmation with the same state object', () => {
    const state = createMvpSeries()
    const result = confirmLineup(state)
    expect(result).toEqual({ ok: false, state, reason: 'lineup-incomplete' })
    expect(result.state).toBe(state)
  })

  it('returns slot-empty only while planning', () => {
    const state = createMvpSeries()
    expect(unassignSlot(state, 0)).toEqual({ ok: false, state, reason: 'slot-empty' })
  })

  it('returns an assigned fighter to the available roster', () => {
    let state = assignFighter(createMvpSeries(), 'brutus', 0).state
    state = unassignSlot(state, 0).state
    expect(state.assignments).toEqual([null, null, null])
    const reassigned = assignFighter(state, 'brutus', 1)
    expect(reassigned.ok).toBe(true)
    expect(reassigned.state.assignments).toEqual([null, 'brutus', null])
  })
})
```

Add these validation cases below the planning tests:

```ts
it('throws for unknown static IDs and invalid bout indices', () => {
  const state = createMvpSeries()
  expect(() => assignFighter(state, 'missing', 0)).toThrow('Unknown home fighter: missing')
  expect(() => assignFighter(state, 'brutus', 3 as never)).toThrow('Invalid bout index: 3')
})

it('returns the exact locked state when editing after confirmation', () => {
  let state = createMvpSeries()
  state = assignFighter(state, 'aquila', 0).state
  state = assignFighter(state, 'nerva', 1).state
  state = assignFighter(state, 'brutus', 2).state
  state = confirmLineup(state).state
  const result = assignFighter(state, 'brutus', 0)
  expect(result).toEqual({ ok: false, state, reason: 'lineup-locked' })
  expect(result.state).toBe(state)
})

it.each([-1, 1.5])('rejects invalid tick counts: %s', (ticks) => {
  expect(() => advanceSeriesTicks(createMvpSeries(), ticks)).toThrow('Tick count must be a non-negative integer')
})
```

- [ ] **Step 2: Write the failing complete-series and rematch tests**

Add this helper and assertions to `series.test.ts`:

```ts
function playSeries(assignments: readonly [string, string, string]) {
  let state = createMvpSeries()
  assignments.forEach((fighterId, boutIndex) => { state = assignFighter(state, fighterId, boutIndex).state })
  state = confirmLineup(state).state
  while (state.phase !== 'summary') {
    state = state.phase === 'fighting'
      ? advanceSeriesTicks(state, 2700)
      : startNextBout(state).state
  }
  return state
}

it('records exactly three results and a matching score', () => {
  const state = playSeries(['aquila', 'nerva', 'brutus'])
  expect(state.results).toHaveLength(3)
  expect(state.score.home + state.score.away).toBe(3)
  expect(state.results.map(({ boutIndex }) => boutIndex)).toEqual([0, 1, 2])
  expect(state.results.map(({ homeFighterId, opponentId }) => [homeFighterId, opponentId])).toEqual([
    ['aquila', 'drusus'],
    ['nerva', 'cassius'],
    ['brutus', 'magnus'],
  ])
  for (const result of state.results) {
    expect(['home', 'away']).toContain(result.winnerSide)
    expect(['advantage', 'neutral', 'disadvantage']).toContain(result.advantage)
    expect(['defeat', 'time-limit']).toContain(result.endedBy)
    expect(result.remainingHpRatio.home).toBeGreaterThanOrEqual(0)
    expect(result.remainingHpRatio.home).toBeLessThanOrEqual(1)
    expect(result.remainingHpRatio.away).toBeGreaterThanOrEqual(0)
    expect(result.remainingHpRatio.away).toBeLessThanOrEqual(1)
  }
})

it('copies the finished battle fields into BoutResult in the same transition', () => {
  let state = createMvpSeries()
  state = assignFighter(state, 'aquila', 0).state
  state = assignFighter(state, 'nerva', 1).state
  state = assignFighter(state, 'brutus', 2).state
  state = confirmLineup(state).state
  if (!state.activeBattle) throw new Error('Expected active battle')
  const battle = advanceBattleTicks(state.activeBattle, 2700)
  const transitioned = advanceSeriesTicks(state, 2700)
  expect(transitioned.phase).toBe('between-bouts')
  expect(transitioned.results[0]).toMatchObject({
    boutIndex: 0,
    homeFighterId: 'aquila',
    opponentId: 'drusus',
    winnerSide: battle.winnerSide,
    endedBy: battle.finishReason,
    durationTicks: battle.tick,
    remainingHpRatio: {
      home: battle.fighters.home.hp / battle.fighters.home.definition.maxHp,
      away: battle.fighters.away.hp / battle.fighters.away.definition.maxHp,
    },
  })
})

it('clears mutable run data but preserves content and seed on rematch', () => {
  const finished = playSeries(['aquila', 'nerva', 'brutus'])
  const restarted = rematch(finished)
  expect(restarted.ok).toBe(true)
  expect(restarted.state).toMatchObject({ phase: 'planning', seed: BASELINE_TEST_SEED, assignments: [null, null, null], results: [], score: { home: 0, away: 0 } })
  expect(restarted.state.homeRoster).toBe(finished.homeRoster)
  expect(restarted.state.opponents).toBe(finished.opponents)
})
```

- [ ] **Step 3: Implement the discriminated series state and command result**

Use these exact exported types in `src/simulation/series.ts`:

```ts
export type BoutIndex = 0 | 1 | 2
export type SeriesPhase = 'planning' | 'fighting' | 'between-bouts' | 'summary'
export type Assignments = [string | null, string | null, string | null]
export interface SeriesScore { home: number; away: number }
export interface BoutResult {
  boutIndex: BoutIndex
  homeFighterId: string
  opponentId: string
  winnerSide: FighterSide
  advantage: MatchupComparison
  endedBy: BattleFinishReason
  durationTicks: number
  remainingHpRatio: { home: number; away: number }
}
export type SeriesCommandFailure = 'lineup-locked' | 'lineup-incomplete' | 'slot-empty' | 'no-bout-pending' | 'series-not-finished'
export type SeriesCommandResult = { ok: true; state: SeriesState } | { ok: false; state: SeriesState; reason: SeriesCommandFailure }

export interface SeriesState {
  phase: SeriesPhase
  homeRoster: readonly FighterDefinition[]
  opponents: readonly FighterDefinition[]
  seed: number
  assignments: Assignments
  activeBoutIndex: BoutIndex | null
  activeBattle?: BattleState
  results: BoutResult[]
  score: SeriesScore
}

export function getAssignmentComparison(state: SeriesState, homeFighterId: string, boutIndex: BoutIndex): MatchupComparison {
  const home = state.homeRoster.find(({ id }) => id === homeFighterId)
  const away = state.opponents[boutIndex]
  if (!home || !away) throw new Error('Unknown fighter or bout index')
  return compareArchetypes(home.archetype, away.archetype)
}
```

`SeriesState` contains `phase`, readonly roster references, `seed`, `assignments`, `activeBoutIndex`, optional `activeBattle`, `results`, and `score`. Implement phase validation before slot validation. Inside `advanceSeriesTicks`, the exact tick that finishes the active battle must also build and append `BoutResult`, update `score`, and enter `between-bouts` for bouts 0–1 or `summary` for bout 2. There is no separate finalization call.

- [ ] **Step 4: Implement baseline lineup tests and tune content only if required**

Add exact fixture assertions:

```ts
it('makes stats matter more than blindly taking all counters', () => {
  const allCounters = playSeries(['brutus', 'aquila', 'nerva'])
  const mixed = playSeries(['aquila', 'nerva', 'brutus'])
  expect(allCounters.score).toEqual({ home: 1, away: 2 })
  expect(mixed.score).toEqual({ home: 2, away: 1 })
  for (const result of [...allCounters.results, ...mixed.results]) {
    expect(result.endedBy).toBe('defeat')
    expect(result.durationTicks).toBeGreaterThanOrEqual(TARGET_MIN_BOUT_TICKS)
    expect(result.durationTicks).toBeLessThanOrEqual(TARGET_MAX_BOUT_TICKS)
  }
})

it('produces at least three distinct scores across all six lineups', () => {
  const lineups = [
    ['brutus', 'aquila', 'nerva'],
    ['brutus', 'nerva', 'aquila'],
    ['aquila', 'brutus', 'nerva'],
    ['aquila', 'nerva', 'brutus'],
    ['nerva', 'brutus', 'aquila'],
    ['nerva', 'aquila', 'brutus'],
  ] as const
  const scores = new Set(lineups.map((lineup) => {
    const { score } = playSeries(lineup)
    return `${score.home}-${score.away}`
  }))
  expect(scores.size).toBeGreaterThanOrEqual(3)
  expect(scores).toEqual(new Set(['0-3', '1-2', '2-1']))
})
```

Run: `npx vitest run src/simulation/series.test.ts`

Expected: PASS. If a score or duration differs, change only numeric values in `src/content/mvpSeries.ts`; preserve names, archetypes, roster order, intent ordering, the three-score distribution, and `TARGET_MIN_BOUT_TICKS..TARGET_MAX_BOUT_TICKS`. Update the design spec's content table, acceptance fixtures, duration corridor, and Definition of Done in the same commit.

- [ ] **Step 5: Add the architecture guard**

Create `src/simulation/architecture.test.ts`. Use Vite's raw recursive glob, strip comments to avoid prose false positives, and fail on forbidden imports or globals without adding `@types/node`:

```ts
/// <reference types="vite/client" />

import { describe, expect, it } from 'vitest'

describe('simulation boundary', () => {
  it('does not import rendering or browser APIs', () => {
    const sources = import.meta.glob('./**/*.ts', { query: '?raw', import: 'default', eager: true }) as Record<string, string>
    const violations = Object.entries(sources)
      .filter(([path]) => !path.endsWith('.test.ts'))
      .flatMap(([path, source]) => {
        const code = source.replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, '')
        return [/from ['"]three['"]/, /\bdocument\b/, /\bwindow\b/, /\bHTMLElement\b/, /\bcrypto\b/, /Math\.random/]
          .filter((pattern) => pattern.test(code))
          .map((pattern) => `${path}: ${pattern}`)
      })
    expect(violations).toEqual([])
  })
})
```

- [ ] **Step 6: Verify the pure series and commit**

Run: `npm test`

Expected: PASS with both baseline lineup scores and the architecture guard.

Run: `npm run build`

Expected: PASS; the browser still shows the temporary single bout from Task 3.

```bash
git add src/simulation/series.ts src/simulation/series.test.ts src/simulation/architecture.test.ts src/content/mvpSeries.ts docs/superpowers/specs/2026-08-15-gladiator-school-series-design.md
git commit -m "feat: add deterministic three-bout series state"
```

---

### Task 5: Manager UI and Series Runtime

**Files:**
- Create: `src/presentation/SeriesView.ts`
- Replace: `index.html`
- Replace: `src/main.ts`
- Modify: `src/style.css:1-212`
- Replace: `tests/smoke.spec.ts`

**Interfaces:**
- Consumes: all public series commands, `SeriesState`, `formatBattleFeed`, `ArenaView.sync`, `homeRoster`, and `opponents`.
- Produces: `SeriesIntent`, `RuntimeViewState`, `SeriesView.render(state, runtime)`, URL seed normalization, pause/speed controls, and the final `window.__GLADIATOR_TEST__` API.

- [ ] **Step 1: Write the failing planning-flow Playwright test**

Replace the first smoke test with a planning assertion that uses stable IDs:

```ts
import { expect, test } from '@playwright/test'

test('plans and locks three matchups', async ({ page }) => {
  await page.goto('/?seed=20260815&snapshot')
  await expect(page.getByRole('heading', { name: 'Plan the series' })).toBeVisible()
  await expect(page.locator('[data-role="home-fighter"]')).toHaveCount(3)
  await expect(page.locator('[data-role="opponent-slot"]')).toHaveCount(3)
  await expect(page.getByTestId('confirm-lineup')).toBeDisabled()

  for (const [fighterId, boutIndex] of [['aquila', 0], ['nerva', 1], ['brutus', 2]] as const) {
    await page.getByTestId(`fighter-${fighterId}`).click()
    await page.getByTestId(`slot-${boutIndex}`).click()
  }

  await expect(page.getByTestId('confirm-lineup')).toBeEnabled()
  await page.getByTestId('confirm-lineup').click()
  await expect(page.getByTestId('series-phase')).toHaveAttribute('data-phase', 'fighting')
})
```

Run: `npx playwright test -g "plans and locks"`

Expected: FAIL because the current page has no planning phase or selectors.

- [ ] **Step 2: Replace the hard-coded page with stable phase containers**

Keep the existing title and theme metadata, but make `index.html` contain these permanent top-level nodes:

```html
<main class="game-shell" data-testid="series-phase" data-phase="planning">
  <header class="masthead">
    <div><p class="eyebrow">House of Mars · Series challenge</p><h1>Blood <span>&amp;</span> Sand</h1></div>
    <div class="controls" data-testid="runtime-controls"></div>
  </header>
  <section id="series-ui" aria-label="Series management"></section>
  <section id="battle-ui" hidden>
    <div class="battle-grid" data-testid="arena-shell">
      <article data-testid="active-home"></article>
      <div class="arena" data-testid="arena"><canvas aria-label="3D gladiator arena"></canvas><h2 class="arena__status" tabindex="-1" aria-live="polite" data-testid="battle-status"></h2></div>
      <article data-testid="active-away"></article>
    </div>
    <section class="battle-feed" aria-label="Battle feed"><div><strong>Battle feed</strong></div><ol aria-live="off" data-testid="battle-feed"></ol></section>
  </section>
</main>
```

Dynamic fighter cards use one addressable `data-testid="fighter-<id>"` plus `data-role="home-fighter"`. Dynamic opponent slots use `data-testid="slot-<index>"` plus `data-role="opponent-slot"`. Never attempt to place two `data-testid` values on one element.

- [ ] **Step 3: Implement `SeriesView` intent and rendering contracts**

Create `src/presentation/SeriesView.ts` with:

```ts
export type SeriesIntent =
  | { type: 'assign'; fighterId: string; boutIndex: BoutIndex }
  | { type: 'unassign'; boutIndex: BoutIndex }
  | { type: 'confirm' }
  | { type: 'start-next' }
  | { type: 'rematch' }
  | { type: 'toggle-pause' }
  | { type: 'set-speed'; speed: 1 | 2 | 4 }

export interface RuntimeViewState { paused: boolean; speed: 1 | 2 | 4 }

// Public contract; implement the method body in SeriesView.ts.
export declare class SeriesView {
  constructor(shell: HTMLElement, onIntent: (intent: SeriesIntent) => void)
  render(state: SeriesState, runtime: RuntimeViewState): void
}
```

Pass `.game-shell` as `shell`. Keep `selectedFighterId` and the previously rendered phase private to `SeriesView`. Render planning cards and slots from state data, not from hard-coded fighter names. On assignment, show the comparison by calling the simulation-owned `getAssignmentComparison(state, fighterId, boutIndex)` selector; do not import `compareArchetypes` into presentation.

Use event delegation on `shell` and `data-action` attributes. Escape clears local selection. Implement the exact focus transitions from the spec with phase headings carrying `tabindex="-1"`. Do not move focus on initial page load; move it only when entering fighting, between-bouts, summary, or returning to planning after rematch.

- [ ] **Step 4: Replace the battle runtime with the series runtime**

In `src/main.ts`, parse the seed with this behavior:

```ts
function resolveSeriesSeed(url: URL): number {
  const raw = url.searchParams.get('seed')
  const parsed = raw !== null && /^\d+$/.test(raw) ? Number(raw) : Number.NaN
  if (Number.isInteger(parsed) && parsed >= 0 && parsed <= 0xffff_ffff) return parsed >>> 0
  const value = crypto.getRandomValues(new Uint32Array(1))[0]
  url.searchParams.set('seed', String(value))
  history.replaceState(null, '', url)
  return value
}
```

Create `SeriesState` from content and route each `SeriesIntent` to its pure command. Store runtime `paused` and `speed` separately. Initialize `paused` from `new URLSearchParams(location.search).has('snapshot')`; snapshot mode suppresses frame-driven ticks but never blocks the explicit test-hook `advanceTicks` command. Preserve the existing elapsed-time clamp: `const elapsed = Math.min((now - previousFrame) / 1000, 0.1)`. The animation frame converts each accumulated `1 / 60` slice into exactly `speed` fixed ticks and only advances while phase is `fighting` and not paused. Stop and clear the accumulator on phase changes.

Render feed entries with `formatBattleFeed(activeBattle.events, { home: activeBattle.fighters.home.definition.name, away: activeBattle.fighters.away.definition.name })`. Render the latest result on `between-bouts` and all three `BoutResult` records on `summary`, including each side's rounded remaining-health percentage. Render the score with the en dash character `–`, exactly as `2–1`, never an ASCII hyphen.

- [ ] **Step 5: Install the final browser test hook**

Replace the temporary hook with the exact spec contract:

```ts
interface GladiatorTestApi {
  getState(): SeriesState
  assign(homeFighterId: string, boutIndex: BoutIndex): TestCommandResult
  unassign(boutIndex: BoutIndex): TestCommandResult
  confirm(): TestCommandResult
  advanceTicks(ticks: number): void
  startNextBout(): TestCommandResult
  rematch(): TestCommandResult
}

type TestCommandResult = { ok: true } | { ok: false; reason: SeriesCommandFailure }
```

Each command wrapper applies `result.state`, renders immediately, and returns only `{ ok: true }` or `{ ok: false, reason }`; it never serializes `SeriesState` through the command result. `advanceTicks` applies `advanceSeriesTicks`, then renders. `getState` is the only hook method that returns `structuredClone(series)`.

- [ ] **Step 6: Add planning, battle, interstitial, and summary styles**

Retain the existing dark Roman palette. Add explicit class groups for `.planning`, `.roster-grid`, `.fighter-option`, `.matchup-list`, `.matchup-slot`, `.comparison-badge`, `.interstitial`, and `.summary`. Use `:focus-visible` with a two-pixel `#f0b071` outline. Hide `#battle-ui` during planning and summary; keep it visible during fighting and between-bouts. Extend the existing `820px` and `560px` media queries instead of adding new breakpoints.

- [ ] **Step 7: Run the planning test, unit suite, and build**

Run: `npx playwright test -g "plans and locks"`

Expected: PASS.

Run: `npm test`

Expected: PASS.

Run: `npm run build`

Expected: PASS with no old battle-level test-hook methods, red/blue fighter IDs, `Draw` copy, or hard-coded single matchup.

- [ ] **Step 8: Commit the playable manager loop**

```bash
git add src/presentation/SeriesView.ts index.html src/main.ts src/style.css tests/smoke.spec.ts
git commit -m "feat: add gladiator series planning loop"
```

---

### Task 6: Arena Lifecycle and Event Reactions

**Files:**
- Modify: `src/presentation/ArenaView.ts:1-108`
- Modify: `src/main.ts`
- Modify: `src/style.css`
- Modify: `tests/smoke.spec.ts`

**Interfaces:**
- Consumes: `BattleState`, per-bout `BattleEvent.id`, `FighterDefinition.archetype`, and series phase/index.
- Produces: `ArenaView.startBout(boutIndex, homeDefinition, awayDefinition)`, `ArenaView.sync(state)`, `ArenaView.clearBout()`, and canvas debug datasets `activeBoutIndex` / `lastEventId` for lifecycle verification.

- [ ] **Step 1: Write the failing second-bout lifecycle test**

Add a Playwright helper that uses the public hook and a test proving cursor reset:

```ts
async function finishActiveBout(page: import('@playwright/test').Page) {
  await page.evaluate(() => window.__GLADIATOR_TEST__.advanceTicks(2700))
}

test('resets arena presentation for the second bout', async ({ page }) => {
  await page.goto('/?seed=20260815&snapshot')
  await page.evaluate(() => {
    window.__GLADIATOR_TEST__.assign('aquila', 0)
    window.__GLADIATOR_TEST__.assign('nerva', 1)
    window.__GLADIATOR_TEST__.assign('brutus', 2)
    window.__GLADIATOR_TEST__.confirm()
  })
  await finishActiveBout(page)
  await page.evaluate(() => window.__GLADIATOR_TEST__.startNextBout())
  await page.evaluate(() => window.__GLADIATOR_TEST__.advanceTicks(600))
  const canvas = page.locator('canvas')
  await expect(canvas).toHaveAttribute('data-active-bout-index', '1')
  await expect.poll(async () => Number(await canvas.getAttribute('data-last-event-id'))).toBeGreaterThan(0)
})
```

Run: `npx playwright test -g "resets arena presentation"`

Expected: FAIL because the canvas has no lifecycle datasets and `ArenaView` has no explicit reset.

- [ ] **Step 2: Implement explicit bout start and clear lifecycle**

In `ArenaView`, replace fighter-ID keys with `Record<FighterSide, THREE.Group>`. Add private fields `activeBoutIndex?: number`, `lastEventId = -1`, and a set of presentation reaction values for each side.

`startBout` must reset rotations, positions, scale, reaction values, event cursor, and datasets; apply an archetype palette selected from an exhaustive `Record<Archetype, { tunic: number; plume: number }>`; and set `canvas.hidden = false`.

`clearBout` performs the same reset, clears both datasets, hides the canvas, and renders nothing until the next `startBout`.

- [ ] **Step 3: Consume every unseen event once**

In `sync`, filter `state.events` by `event.id > lastEventId`, process in ID order, and then set `lastEventId` and `canvas.dataset.lastEventId`. Map events exactly:

- `attack-started`: set actor lunge to `1`.
- `attack-missed`: set actor recovery to `1`.
- `attack-blocked`: set target block reaction to `1`.
- `damage-dealt`: set target hit reaction to `1`.
- `critical-hit`: set actor critical accent to `1`.
- `fighter-defeated`: set target defeated flag.
- opening and finish events do not create additional reactions.

Decay non-defeat reaction values from `1` toward `0` using render-frame elapsed time stored inside `ArenaView`; use them only for small position, rotation, and scale offsets layered on top of simulation `x`. Do not write these values into `BattleState`.

- [ ] **Step 4: Wire lifecycle calls at phase boundaries**

In `main.ts`, remember the last rendered phase and active bout index. Call `arena.startBout` exactly once when entering `fighting` with a new bout index. Call `arena.clearBout` when entering `planning` or `summary`. During `between-bouts`, keep syncing the completed active battle so the final pose remains under the overlay.

- [ ] **Step 5: Verify presentation and commit**

Run: `npx playwright test -g "resets arena presentation"`

Expected: PASS and `data-active-bout-index="1"` with a small second-bout event ID, proving the per-bout cursor reset.

Run: `npm run test:e2e`

Expected: PASS.

Run: `npm run build`

Expected: PASS.

```bash
git add src/presentation/ArenaView.ts src/main.ts src/style.css tests/smoke.spec.ts
git commit -m "feat: add resettable arena event reactions"
```

---

### Task 7: Acceptance Coverage, Visual Baseline, and Handoff Docs

**Files:**
- Modify: `tests/smoke.spec.ts`
- Delete: `tests/__screenshots__/arena.png`
- Create: `tests/__screenshots__/planning.png`
- Modify: `README.md:1-43`

**Interfaces:**
- Consumes: final browser hook, stable selectors, all four series phases, pause/speed runtime state, and hidden planning canvas.
- Produces: complete acceptance coverage, intentional planning baseline, and current project documentation.

- [ ] **Step 1: Add the full seeded series and rematch test**

Add a test that assigns the mixed winning lineup, advances each bout by 2700 ticks, starts bouts 2 and 3 through the hook, and asserts:

```ts
test('plays three bouts, reports a 2–1 win, and rematches the same seed', async ({ page }) => {
  await page.goto('/?seed=20260815&snapshot')
  await page.evaluate(() => {
    window.__GLADIATOR_TEST__.assign('aquila', 0)
    window.__GLADIATOR_TEST__.assign('nerva', 1)
    window.__GLADIATOR_TEST__.assign('brutus', 2)
    window.__GLADIATOR_TEST__.confirm()
  })
  for (let bout = 0; bout < 3; bout += 1) {
    await page.evaluate(() => window.__GLADIATOR_TEST__.advanceTicks(2700))
    if (bout < 2) await page.evaluate(() => window.__GLADIATOR_TEST__.startNextBout())
  }
  await expect(page.getByRole('heading', { name: 'School victory' })).toBeFocused()
  await expect(page.getByTestId('series-score')).toHaveText('2–1')
  await expect(page.getByTestId('bout-result')).toHaveCount(3)
  await expect(page.getByTestId('bout-result').first()).toContainText('%')
  await page.getByTestId('rematch').click()
  await expect(page.getByRole('heading', { name: 'Plan the series' })).toBeFocused()
  await expect(page.getByTestId('confirm-lineup')).toBeDisabled()
  expect(new URL(page.url()).searchParams.get('seed')).toBe('20260815')
})
```

- [ ] **Step 2: Add keyboard, invalid-seed, speed, and interstitial assertions**

Add these focused tests. Define "next available fighter" as the first unassigned card in roster DOM order, making focus deterministic:

```ts
test('supports keyboard planning and deterministic focus', async ({ page }) => {
  await page.goto('/?seed=20260815&snapshot')
  const aquila = page.getByTestId('fighter-aquila')
  await aquila.focus()
  await page.keyboard.press('Enter')
  await expect(aquila).toHaveAttribute('aria-pressed', 'true')
  await page.keyboard.press('Escape')
  await expect(aquila).toHaveAttribute('aria-pressed', 'false')
  await page.keyboard.press('Enter')
  await page.getByTestId('slot-0').focus()
  await page.keyboard.press('Space')
  await expect(page.getByTestId('slot-0')).toContainText('Aquila')
  await expect(page.getByTestId('fighter-brutus')).toBeFocused()
})

test('normalizes an invalid URL seed', async ({ page }) => {
  await page.goto('/?seed=invalid&snapshot')
  const seed = new URL(page.url()).searchParams.get('seed')
  expect(seed).toMatch(/^\d+$/)
  expect(Number(seed)).toBeGreaterThanOrEqual(0)
  expect(Number(seed)).toBeLessThanOrEqual(0xffff_ffff)
  await expect(page.getByTestId('series-phase')).toHaveAttribute('data-phase', 'planning')
})

test('changes speed without advancing while paused', async ({ page }) => {
  await page.goto('/?seed=20260815')
  await page.evaluate(() => {
    window.__GLADIATOR_TEST__.assign('aquila', 0)
    window.__GLADIATOR_TEST__.assign('nerva', 1)
    window.__GLADIATOR_TEST__.assign('brutus', 2)
    window.__GLADIATOR_TEST__.confirm()
  })
  await page.getByTestId('speed-4').click()
  await expect(page.getByTestId('speed-4')).toHaveAttribute('aria-pressed', 'true')
  await expect.poll(() => page.evaluate(() => window.__GLADIATOR_TEST__.getState().activeBattle?.tick ?? 0)).toBeGreaterThan(0)
  await page.getByTestId('toggle-pause').click()
  const before = await page.evaluate(() => window.__GLADIATOR_TEST__.getState().activeBattle?.tick)
  expect(before).toEqual(expect.any(Number))
  await page.waitForTimeout(150)
  const after = await page.evaluate(() => window.__GLADIATOR_TEST__.getState().activeBattle?.tick)
  expect(after).toBe(before)
})

test('shows both interstitials with result and next matchup context', async ({ page }) => {
  await page.goto('/?seed=20260815&snapshot')
  await page.evaluate(() => {
    window.__GLADIATOR_TEST__.assign('aquila', 0)
    window.__GLADIATOR_TEST__.assign('nerva', 1)
    window.__GLADIATOR_TEST__.assign('brutus', 2)
    window.__GLADIATOR_TEST__.confirm()
    window.__GLADIATOR_TEST__.advanceTicks(2700)
  })
  await expect(page.getByTestId('bout-result-summary')).toContainText(/wins.*defeat|wins.*time limit/i)
  await expect(page.getByTestId('next-matchup')).toContainText('Nerva')
  await expect(page.getByTestId('next-matchup')).toContainText('Cassius')
  await expect(page.getByTestId('next-matchup')).toContainText('neutral')
  await page.evaluate(() => {
    window.__GLADIATOR_TEST__.startNextBout()
    window.__GLADIATOR_TEST__.advanceTicks(2700)
  })
  await expect(page.getByTestId('next-matchup')).toContainText('Brutus')
  await expect(page.getByTestId('next-matchup')).toContainText('Magnus')
  await expect(page.getByTestId('next-matchup')).toContainText('neutral')
})
```

Use state reads only to check deterministic ticks; wall-clock waiting is used solely to prove that pause prevents runtime advancement.

- [ ] **Step 3: Replace the visual baseline intentionally**

Update the screenshot test to:

```ts
test('matches the stable planning snapshot', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 820 })
  await page.goto('/?seed=20260815&snapshot')
  await expect(page.getByRole('heading', { name: 'Plan the series' })).toBeVisible()
  await expect(page.locator('canvas')).toBeHidden()
  await expect(page).toHaveScreenshot('planning.png', { fullPage: true })
})
```

Run: `npx playwright test --update-snapshots -g "matches the stable planning snapshot"`

Expected: PASS and create `tests/__screenshots__/planning.png` without accepting unrelated baselines. Resolve both screenshot paths and confirm they are inside `C:\gamedev\gladiator-html\tests\__screenshots__`, then run `git rm -- tests/__screenshots__/arena.png` to stage only the obsolete baseline deletion.

- [ ] **Step 4: Update README for the implemented slice**

Rewrite the introduction and roadmap so README states:

- the player assigns three one-use gladiators against three visible opponents;
- the series uses `heavy → fast → technical → heavy`, where the arrow means advantage;
- all three bouts play and rematch keeps the seed;
- `?seed=<uint32>` reproduces a challenge;
- pause and `×1/×2/×4` controls affect runtime only;
- `src/simulation/series.ts`, `fighters.ts`, and `random.ts` remain renderer-independent;
- next work is one combat spike at a time: procedural movement, skeletal animation, effects/lighting, camera, then performance.

Keep the existing install and command sections unchanged except for updating the Playwright screenshot description from arena to planning.

- [ ] **Step 5: Run the complete verification suite**

Run: `npm run check`

Expected, in order:

- all Vitest tests pass, including 200 seeds × 9 archetype pairings;
- TypeScript and Vite production build pass;
- all Playwright flow, keyboard, lifecycle, rematch, and screenshot tests pass.

Run: `git status --short`

Expected: only intentional source, test, README, and screenshot changes for this task. The spec review file may still appear untracked and must remain unstaged.

- [ ] **Step 6: Commit the acceptance handoff**

```bash
git add README.md tests/smoke.spec.ts tests/__screenshots__/planning.png
git commit -m "test: cover the gladiator school MVP flow"
```

The preceding `git rm` already stages `arena.png`. Do not use a directory-wide `git add`.

---

## Implementation Handoff

Before starting Task 1, create an isolated worktree with `superpowers:using-git-worktrees`. Implement one task at a time using `superpowers:subagent-driven-development` (recommended) or `superpowers:executing-plans`. Each task ends at its commit and review gate; do not combine tasks into one broad commit.

The implementation is complete only after Task 7's fresh `npm run check` succeeds and its output has been reviewed. Use `superpowers:verification-before-completion` before claiming success, then `superpowers:requesting-code-review` and `superpowers:finishing-a-development-branch` for final handoff.
