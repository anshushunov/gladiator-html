# Bout Orders and Opponent Temperament Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Per-bout player orders (`press`/`guarded`/`standard`) and authored opponent temperaments, implemented as `DecisionModifier`s over the existing seam in `combatDecision.ts`, with the all-`standard` path byte-identical to today's frozen simulation.

**Architecture:** A serializable `DispositionId` travels as data (`EncounterCombatantDefinition.disposition?` → `BattleConfig.dispositions?` → `SeriesState.orders`/`opponentDispositions` → season command `setBoutOrder`), and is mapped to `DecisionModifier` functions module-locally in a new `src/simulation/disposition.ts` — functions never enter `EncounterState`. `standard` maps to an empty modifier list and the state field is omitted entirely, mirroring how `startingHp?` preserved every frozen trace hash. Presentation only formats ids already present in `SeriesState`/`SeasonState`.

**Tech Stack:** TypeScript, Vite, Vitest, Playwright, Three.js (untouched).

**Spec:** `docs/superpowers/specs/2026-08-22-bout-orders-design.md` — read it first; it fixes scope, non-goals, and acceptance.

## Global Constraints

- `src/simulation/` must not import DOM, Three.js, or `src/content/**` (enforced by `architecture.test.ts`). Season/series content reaches simulation as plain config data.
- **Frozen core proof:** existing frozen-hash tests (`battle.test.ts` literal `dc635911`, `tests/combat-visuals.spec.ts` key poses at ticks 253/817/958/2106, combat screenshot baselines on win32 and linux) must pass **without any edit**. If one fails, the change is wrong — fix the code, never the literal.
- With `disposition` omitted or `'standard'`, constructed states must be structurally identical to today's: the state key is **not set at all** (never set to `undefined` — `structuredClone`/`JSON.stringify` would see it).
- No `Math.random`, `Date.now`, `crypto` in simulation. No new PRNG stream: dispositions are inputs like lineups.
- `condition.ts`, damage/accuracy/critical rules, action definitions, poses, camera, audio, the six frozen fighter definitions, and challenge stat-scaling vectors are out of bounds.
- Checks: simulation change → `npm test`; UI change → `npm run test:e2e`; handoff → `npm run check`. Screenshot baselines are per-OS; regenerate linux ones in the Playwright docker image (command in `AGENTS.md`).
- Commit style: conventional (`feat:`/`test:`/`docs:`), no LLM attribution (no `Co-Authored-By`, no 🤖).
- UI copy is English (`Press` / `Guarded` / `Standard`; temperaments display as `Aggressive` / `Cautious` / `Steady`).

---

### Task 1: `disposition.ts` — id, validation, modifier catalog

**Files:**
- Create: `src/simulation/disposition.ts`
- Test: `src/simulation/disposition.test.ts`

**Interfaces:**
- Consumes: `DecisionModifier`, `CombatDecisionContext`, `CombatDecision` from `./combatDecision`; `LocomotionIntent` from `./movement`.
- Produces (later tasks rely on these exact names):
  - `type DispositionId = 'standard' | 'press' | 'guarded'`
  - `const DISPOSITION_IDS: readonly DispositionId[]`
  - `function isDispositionId(value: unknown): value is DispositionId`
  - `function dispositionModifiers(id: DispositionId): readonly DecisionModifier[]` — identity-stable frozen singletons; `'standard'` returns the same frozen empty array every call.

- [ ] **Step 1: Write the failing test**

```ts
// src/simulation/disposition.test.ts
import { describe, expect, it } from 'vitest'
import { COMBAT_STYLES } from '../content/combatStyles'
import type { CombatDecision, CombatDecisionContext } from './combatDecision'
import { DISPOSITION_IDS, dispositionModifiers, isDispositionId, type DispositionId } from './disposition'

// Only `context.attacks` is read by the modifiers; a minimal cast keeps the
// test independent of the full decision-context construction.
const context = { attacks: COMBAT_STYLES.attacks } as unknown as CombatDecisionContext

const adjust = (id: DispositionId, decision: CombatDecision): number =>
  dispositionModifiers(id).reduce((sum, m) => sum + m.adjustCandidate({ context, decision, weight: 10 }), 0)

const action = (actionId: string): CombatDecision => ({ type: 'action', actionId } as CombatDecision)
const move = (locomotionIntent: string): CombatDecision => ({ type: 'locomotion', locomotionIntent } as CombatDecision)

describe('disposition ids', () => {
  it('validates the three ids and rejects everything else', () => {
    expect(DISPOSITION_IDS).toEqual(['standard', 'press', 'guarded'])
    for (const id of DISPOSITION_IDS) expect(isDispositionId(id)).toBe(true)
    expect(isDispositionId('aggressive')).toBe(false)
    expect(isDispositionId(undefined)).toBe(false)
    expect(isDispositionId(1)).toBe(false)
  })

  it('standard maps to the same frozen empty array on every call', () => {
    const first = dispositionModifiers('standard')
    expect(first).toHaveLength(0)
    expect(Object.isFrozen(first)).toBe(true)
    expect(dispositionModifiers('standard')).toBe(first)
    expect(dispositionModifiers('press')).toBe(dispositionModifiers('press'))
  })
})

describe('press', () => {
  it('raises committed attacks, leaves probes alone', () => {
    expect(adjust('press', action('heavy-cleave'))).toBe(6)       // tags include 'committed'
    expect(adjust('press', action('fast-burst-lunge'))).toBe(6)
    expect(adjust('press', action('heavy-shield-jab'))).toBe(0)   // probe
    expect(adjust('press', action('technical-thrust'))).toBe(0)   // probe
  })
  it('raises approach intents and lowers distance-keepers', () => {
    for (const intent of ['pressure', 'burst-in', 'advance']) expect(adjust('press', move(intent))).toBe(4)
    for (const intent of ['hold-range', 'backstep', 'retreat']) expect(adjust('press', move(intent))).toBe(-4)
    expect(adjust('press', move('circle-left'))).toBe(0)
  })
})

describe('guarded', () => {
  it('mirrors press', () => {
    expect(adjust('guarded', action('heavy-cleave'))).toBe(-6)
    expect(adjust('guarded', action('heavy-shield-jab'))).toBe(0)
    for (const intent of ['pressure', 'burst-in', 'advance']) expect(adjust('guarded', move(intent))).toBe(-4)
    for (const intent of ['hold-range', 'backstep', 'retreat']) expect(adjust('guarded', move(intent))).toBe(4)
    expect(adjust('guarded', move('circle-right'))).toBe(0)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/simulation/disposition.test.ts`
Expected: FAIL — module `./disposition` does not exist.

- [ ] **Step 3: Write the implementation**

```ts
// src/simulation/disposition.ts
// The one place DispositionId becomes behavior. Order/temperament ids live in
// combatant state as plain strings; the DecisionModifier functions they map to
// live only here — EncounterState stays structurally clonable.
//
// Magnitudes are tuning values: dispositionBalance.test.ts holds the result
// (risk/reward real, no dominant order, no stall collapse). Adjust
// COMMITTED_ADJUST / LOCOMOTION_ADJUST there before inventing new mechanisms.
import type { DecisionModifier } from './combatDecision'
import type { LocomotionIntent } from './movement'

export type DispositionId = 'standard' | 'press' | 'guarded'
export const DISPOSITION_IDS: readonly DispositionId[] = Object.freeze(['standard', 'press', 'guarded'])

export function isDispositionId(value: unknown): value is DispositionId {
  return typeof value === 'string' && (DISPOSITION_IDS as readonly string[]).includes(value)
}

const APPROACH_INTENTS: ReadonlySet<LocomotionIntent> = new Set(['pressure', 'burst-in', 'advance'])
const KEEPER_INTENTS: ReadonlySet<LocomotionIntent> = new Set(['hold-range', 'backstep', 'retreat'])

const COMMITTED_ADJUST = 6
const LOCOMOTION_ADJUST = 4

// `sign` +1 = press, -1 = guarded. Weights pass through combatDecision.ts's
// own `max(0, …)` clamp, so a negative adjustment can suppress but never
// invert a candidate; probes are untouched so a guarded fighter still fights.
function dispositionModifier(id: string, sign: 1 | -1): DecisionModifier {
  return {
    id,
    adjustCandidate({ context, decision }) {
      if (decision.type === 'action') {
        return context.attacks[decision.actionId].tags.includes('committed') ? sign * COMMITTED_ADJUST : 0
      }
      if (APPROACH_INTENTS.has(decision.locomotionIntent)) return sign * LOCOMOTION_ADJUST
      if (KEEPER_INTENTS.has(decision.locomotionIntent)) return -sign * LOCOMOTION_ADJUST
      return 0
    },
  }
}

const NO_MODIFIERS: readonly DecisionModifier[] = Object.freeze([])
const PRESS_MODIFIERS: readonly DecisionModifier[] = Object.freeze([dispositionModifier('disposition:press', 1)])
const GUARDED_MODIFIERS: readonly DecisionModifier[] = Object.freeze([dispositionModifier('disposition:guarded', -1)])

export function dispositionModifiers(id: DispositionId): readonly DecisionModifier[] {
  if (id === 'press') return PRESS_MODIFIERS
  if (id === 'guarded') return GUARDED_MODIFIERS
  return NO_MODIFIERS
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/simulation/disposition.test.ts`
Expected: PASS. If the tag assertions fail, check the actual `tags` arrays in `src/content/combatStyles.ts` (`heavy-cleave`, `fast-burst-lunge`, `technical-driving-thrust` are the committed attacks; `heavy-shield-jab`, `fast-slash`, `technical-thrust` are probes) and fix the TEST's action ids, not the modifier.

- [ ] **Step 5: Commit**

```bash
git add src/simulation/disposition.ts src/simulation/disposition.test.ts
git commit -m "feat: disposition catalog mapping order/temperament ids to decision modifiers"
```

---

### Task 2: Encounter carries and applies dispositions

**Files:**
- Modify: `src/simulation/encounter.ts` (interface ~line 214, `buildFighterCombatState` ~line 549, `createEncounter` validation loop ~line 586, decision loop ~lines 1134–1142)
- Test: `src/simulation/encounterDisposition.test.ts` (new file — `encounter.test.ts` is huge and stays untouched)

**Interfaces:**
- Consumes: `dispositionModifiers`, `isDispositionId`, `DispositionId` from `./disposition` (Task 1).
- Produces: `EncounterCombatantDefinition.disposition?: DispositionId`; `FighterCombatState.disposition?: DispositionId` (present ONLY when not `'standard'`).

- [ ] **Step 1: Write the failing test**

```ts
// src/simulation/encounterDisposition.test.ts
import { describe, expect, it } from 'vitest'
import { COMBAT_STYLES } from '../content/combatStyles'
import { homeRoster, opponents } from '../content/mvpSeries'
import { createEncounter, advanceEncounterTick, type EncounterConfig, type EncounterState } from './encounter'
import type { DispositionId } from './disposition'

const brutus = homeRoster.find(({ id }) => id === 'brutus')!
const drusus = opponents.find(({ id }) => id === 'drusus')!

function duelConfig(homeDisposition?: DispositionId): EncounterConfig {
  return {
    seed: 20260815,
    combatants: [
      { id: 'home.brutus', factionId: 'home', fighter: brutus, startPosition: { x: -4.2, z: 0 }, ...(homeDisposition !== undefined ? { disposition: homeDisposition } : {}) },
      { id: 'away.drusus', factionId: 'away', fighter: drusus, startPosition: { x: 4.2, z: 0 } },
    ],
    arena: { radius: 6.5, lateralLimit: 2.5, minimumSeparation: 0.9, movementPolicy: 'ordered-pair', orderedPair: ['home.brutus', 'away.drusus'] },
    hostility: { mode: 'different-factions' },
    combatStyles: COMBAT_STYLES,
  }
}

function runTicks(config: EncounterConfig, ticks: number): { state: EncounterState; eventLog: string } {
  let { state } = createEncounter(config)
  const log: string[] = []
  for (let i = 0; i < ticks && state.phase !== 'finished'; i += 1) {
    const step = advanceEncounterTick(state)
    state = step.state
    for (const event of step.events) log.push(JSON.stringify(event))
  }
  return { state, eventLog: log.join('\n') }
}

describe('encounter dispositions', () => {
  it('rejects an invalid disposition id', () => {
    const config = duelConfig()
    const bad = { ...config, combatants: [{ ...config.combatants[0], disposition: 'aggressive' as DispositionId }, config.combatants[1]] }
    expect(() => createEncounter(bad)).toThrow(/disposition/)
  })

  it("explicit 'standard' is structurally identical to omitted — the key is never set", () => {
    const omitted = createEncounter(duelConfig()).state
    const explicit = createEncounter(duelConfig('standard')).state
    expect('disposition' in explicit.combatants['home.brutus']).toBe(false)
    expect(explicit).toEqual(omitted)
    expect(Object.keys(explicit.combatants['home.brutus']).sort()).toEqual(Object.keys(omitted.combatants['home.brutus']).sort())
  })

  it('a non-standard disposition is carried in combatant state', () => {
    const state = createEncounter(duelConfig('press')).state
    expect(state.combatants['home.brutus'].disposition).toBe('press')
  })

  it('press changes the deterministic run relative to standard', () => {
    const standard = runTicks(duelConfig(), 1800)
    const press = runTicks(duelConfig('press'), 1800)
    expect(press.eventLog).not.toBe(standard.eventLog)
  })

  it('same disposition, same seed reproduces the identical run', () => {
    expect(runTicks(duelConfig('guarded'), 1800).eventLog).toBe(runTicks(duelConfig('guarded'), 1800).eventLog)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/simulation/encounterDisposition.test.ts`
Expected: FAIL — `disposition` is not a known property / not carried / invalid id not rejected.

- [ ] **Step 3: Implement in `encounter.ts`**

Four edits:

1. Import (top of file, with the other simulation imports):

```ts
import { dispositionModifiers, isDispositionId, type DispositionId } from './disposition'
```

2. `EncounterCombatantDefinition` (after `startingHp?`):

```ts
  /**
   * Optional disposition (order/temperament) this combatant fights under.
   * Omitted or 'standard' — the only values anything produced before this
   * field existed — leaves combatant state without the key entirely, which is
   * why every frozen trace hash survives this field's addition (same
   * mechanism as `startingHp` above).
   */
  disposition?: DispositionId
```

3. `FighterCombatState` gains the mirror optional field (after `factionId`):

```ts
  /** Present only when fighting under a non-'standard' disposition; see `EncounterCombatantDefinition.disposition`. */
  disposition?: DispositionId
```

`buildFighterCombatState` sets it conditionally — insert right after `factionId: definition.factionId,`:

```ts
    ...(definition.disposition !== undefined && definition.disposition !== 'standard' ? { disposition: definition.disposition } : {}),
```

4. Validation in `createEncounter`'s per-combatant loop (next to `requireValidId` calls):

```ts
    if (combatant.disposition !== undefined && !isDispositionId(combatant.disposition)) {
      throw new Error(`EncounterConfig combatant '${combatant.id}' disposition must be one of standard|press|guarded`)
    }
```

5. Decision loop (~line 1134): resolve modifiers once and pass them to BOTH calls, so the dev decision panel's diagnostic breakdown matches what was actually chosen:

```ts
    const style = combatStyles.styles[self.definition.archetype]
    const modifiers = dispositionModifiers(self.disposition ?? 'standard')

    const combatantRandom = nextRandom[id]
    const [rolls, afterDecision] = drawPair(combatantRandom.decision)
    const scored = collector === undefined ? undefined : scoreCombatCandidates(context, style, modifiers)
    const decision = chooseCombatDecision(context, style, { selection: rolls.first, interval: rolls.second }, modifiers)
```

- [ ] **Step 4: Run tests**

Run: `npx vitest run src/simulation/encounterDisposition.test.ts` → PASS.
Run: `npm test` → ALL PASS, **especially** `battle.test.ts`'s frozen hash and `encounter.test.ts` — with no edits to either. A frozen-hash failure here means the standard path is not byte-identical (most likely the state key leaked in); fix the code.

- [ ] **Step 5: Commit**

```bash
git add src/simulation/encounter.ts src/simulation/encounterDisposition.test.ts
git commit -m "feat: encounter combatants carry a disposition applied at the decision seam"
```

---

### Task 3: Battle and series plumbing — orders, temperaments, `setBoutOrder`

**Files:**
- Modify: `src/simulation/battle.ts` (`BattleConfig`, `createBattle`)
- Modify: `src/simulation/series.ts` (state, config, command, result)
- Test: `src/simulation/seriesOrders.test.ts` (new file)

**Interfaces:**
- Consumes: `DispositionId`, `isDispositionId` from `./disposition`.
- Produces:
  - `BattleConfig.dispositions?: Partial<Record<FighterSide, DispositionId>>`
  - `type SeriesOrders = readonly [DispositionId, DispositionId, DispositionId]`
  - `SeriesState.orders: SeriesOrders`; `SeriesState.opponentDispositions: readonly DispositionId[]`
  - `SeriesConfig.opponentDispositions?: readonly DispositionId[]` (default: all `'standard'`)
  - `SeriesCommandFailure` gains `'order-locked'`
  - `setBoutOrder(state: SeriesState, boutIndex: number, order: DispositionId): SeriesCommandResult`
  - `BoutResult.homeOrder: DispositionId`

- [ ] **Step 1: Write the failing test**

```ts
// src/simulation/seriesOrders.test.ts
import { describe, expect, it } from 'vitest'
import { COMBAT_STYLES } from '../content/combatStyles'
import { BASELINE_TEST_SEED, homeRoster, opponents } from '../content/mvpSeries'
import { advanceBattleTicks, createBattle, MAX_BOUT_TICKS } from './battle'
import type { DispositionId } from './disposition'
import {
  advanceSeriesTicks, assignFighter, confirmLineup, createSeries, rematch, setBoutOrder, startNextBout,
  type SeriesState,
} from './series'

const brutus = homeRoster.find(({ id }) => id === 'brutus')!
const drusus = opponents.find(({ id }) => id === 'drusus')!

const createMvpSeries = (opponentDispositions?: readonly DispositionId[]) => createSeries({
  homeRoster,
  opponents,
  seed: BASELINE_TEST_SEED,
  combatStyles: COMBAT_STYLES,
  homeStartingHpByFighterId: Object.fromEntries(homeRoster.map((fighter) => [fighter.id, fighter.maxHp])),
  ...(opponentDispositions !== undefined ? { opponentDispositions } : {}),
})

function confirmed(state: SeriesState): SeriesState {
  let next = state
  next = assignFighter(next, 'brutus', 0).state
  next = assignFighter(next, 'aquila', 1).state
  next = assignFighter(next, 'nerva', 2).state
  return confirmLineup(next).state
}

describe('battle dispositions', () => {
  const config = { home: brutus, away: drusus, seed: BASELINE_TEST_SEED, combatStyles: COMBAT_STYLES }
  it('omitted and explicit standard produce the identical trace', () => {
    const omitted = advanceBattleTicks(createBattle(config), MAX_BOUT_TICKS)
    const explicit = advanceBattleTicks(createBattle({ ...config, dispositions: { home: 'standard', away: 'standard' } }), MAX_BOUT_TICKS)
    expect(explicit.traceHash).toBe(omitted.traceHash)
  })
  it('a press order changes the trace', () => {
    const standard = advanceBattleTicks(createBattle(config), MAX_BOUT_TICKS)
    const press = advanceBattleTicks(createBattle({ ...config, dispositions: { home: 'press' } }), MAX_BOUT_TICKS)
    expect(press.traceHash).not.toBe(standard.traceHash)
  })
})

describe('setBoutOrder', () => {
  it('defaults every bout to standard and every opponent to standard', () => {
    const state = createMvpSeries()
    expect(state.orders).toEqual(['standard', 'standard', 'standard'])
    expect(state.opponentDispositions).toEqual(['standard', 'standard', 'standard'])
  })
  it('accepts any slot during planning', () => {
    let state = createMvpSeries()
    state = setBoutOrder(state, 0, 'press').state
    state = setBoutOrder(state, 2, 'guarded').state
    expect(state.orders).toEqual(['press', 'standard', 'guarded'])
  })
  it('throws for an invalid disposition or bout index', () => {
    const state = createMvpSeries()
    expect(() => setBoutOrder(state, 0, 'aggressive' as DispositionId)).toThrow()
    expect(() => setBoutOrder(state, 3, 'press')).toThrow()
  })
  it('locks started and resolved bouts, allows only the next pending one between bouts', () => {
    let state = confirmed(createMvpSeries())
    expect(setBoutOrder(state, 0, 'press')).toMatchObject({ ok: false, reason: 'order-locked' })
    state = advanceSeriesTicks(state, MAX_BOUT_TICKS)          // bout 0 resolves -> between-bouts
    expect(state.phase).toBe('between-bouts')
    expect(setBoutOrder(state, 0, 'press')).toMatchObject({ ok: false, reason: 'order-locked' })
    expect(setBoutOrder(state, 2, 'press')).toMatchObject({ ok: false, reason: 'order-locked' })
    const changed = setBoutOrder(state, 1, 'guarded')
    expect(changed.ok).toBe(true)
    expect(changed.state.orders[1]).toBe('guarded')
  })
  it('records homeOrder on the fought result and applies the order to the bout', () => {
    const standardRun = advanceSeriesTicks(confirmed(createMvpSeries()), MAX_BOUT_TICKS)
    let pressState = createMvpSeries()
    pressState = setBoutOrder(pressState, 0, 'press').state
    const pressRun = advanceSeriesTicks(confirmed(pressState), MAX_BOUT_TICKS)
    const standardResult = standardRun.results[0]
    const pressResult = pressRun.results[0]
    if (standardResult.kind !== 'fought' || pressResult.kind !== 'fought') throw new Error('expected fought bouts')
    expect(standardResult.homeOrder).toBe('standard')
    expect(pressResult.homeOrder).toBe('press')
    expect(pressRun.activeBattle!.traceHash).not.toBe(standardRun.activeBattle!.traceHash)
  })
  it('opponent dispositions flow into the bout', () => {
    const steady = advanceSeriesTicks(confirmed(createMvpSeries()), MAX_BOUT_TICKS)
    const aggressive = advanceSeriesTicks(confirmed(createMvpSeries(['press', 'standard', 'standard'])), MAX_BOUT_TICKS)
    expect(aggressive.activeBattle!.traceHash).not.toBe(steady.activeBattle!.traceHash)
  })
  it('rematch resets orders to standard', () => {
    let state = createMvpSeries()
    state = setBoutOrder(state, 0, 'press').state
    state = confirmed(state)
    while (state.phase !== 'summary') {
      state = advanceSeriesTicks(state, MAX_BOUT_TICKS)
      if (state.phase === 'between-bouts') state = startNextBout(state).state
    }
    const rematched = rematch(state).state
    expect(rematched.orders).toEqual(['standard', 'standard', 'standard'])
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/simulation/seriesOrders.test.ts`
Expected: FAIL — no `dispositions` on `BattleConfig`, no `orders`/`setBoutOrder` on series.

- [ ] **Step 3: Implement**

`battle.ts`:

```ts
import type { DispositionId } from './disposition'
// BattleConfig gains:
  /** Per-side disposition (home order / away temperament). Omitted sides fight 'standard'. */
  dispositions?: Partial<Record<FighterSide, DispositionId>>
// createBattle combatant definitions gain:
      { id: descriptor.homeId, factionId: 'home', fighter: config.home, startPosition: HOME_START_POSITION, startingHp: config.startingHp?.home, disposition: config.dispositions?.home },
      { id: descriptor.awayId, factionId: 'away', fighter: config.away, startPosition: AWAY_START_POSITION, startingHp: config.startingHp?.away, disposition: config.dispositions?.away },
```

`series.ts`:

```ts
import { isDispositionId, type DispositionId } from './disposition'

export type SeriesOrders = readonly [DispositionId, DispositionId, DispositionId]
export type SeriesCommandFailure = 'lineup-locked' | 'lineup-incomplete' | 'slot-empty' | 'no-bout-pending' | 'series-not-finished' | 'order-locked'

// SeriesState gains:
  orders: SeriesOrders
  opponentDispositions: readonly DispositionId[]
// SeriesConfig gains:
  opponentDispositions?: readonly DispositionId[]   // per opponent slot; default all 'standard'
// createSeries gains:
    orders: ['standard', 'standard', 'standard'],
    opponentDispositions: config.opponentDispositions ?? config.opponents.map(() => 'standard' as const),
// BoutResult gains:
  homeOrder: DispositionId

/**
 * Sets the order one bout will be fought under. Planning: any slot. Between
 * bouts: only the next pending slot (`activeBoutIndex + 1`) — everything at
 * or before `activeBoutIndex` is already resolved, everything later is not
 * yet the next decision. Started/finished bouts and other phases refuse with
 * 'order-locked'. Invalid ids/indices are programmer errors and throw,
 * matching unknown-fighter handling.
 */
export function setBoutOrder(state: SeriesState, boutIndex: number, order: DispositionId): SeriesCommandResult {
  assertBoutIndex(boutIndex)
  if (!isDispositionId(order)) throw new Error(`Invalid disposition: ${String(order)}`)
  const slot = boutIndex as BoutIndex
  const allowed = state.phase === 'planning'
    || (state.phase === 'between-bouts' && state.activeBoutIndex !== null && slot === state.activeBoutIndex + 1)
  if (!allowed) return { ok: false, state, reason: 'order-locked' }
  const orders = [...state.orders] as [DispositionId, DispositionId, DispositionId]
  orders[slot] = order
  return { ok: true, state: { ...state, orders } }
}

// startBoutBattle gains:
    dispositions: { home: state.orders[boutIndex], away: state.opponentDispositions[boutIndex] },
// advanceSeriesTicks's BoutOutcome construction gains (next to endedBy):
    homeOrder: state.orders[boutIndex],
// rematch's returned state gains:
      orders: ['standard', 'standard', 'standard'],
```

- [ ] **Step 4: Run tests**

Run: `npx vitest run src/simulation/seriesOrders.test.ts` → PASS.
Run: `npm test` → ALL PASS with no edits to `series.test.ts`/`battle.test.ts`/`season.test.ts`/`seasonBalance.test.ts`. Exception: if a test asserts a full `BoutResult` object with `toEqual`, add `homeOrder: 'standard'` to its EXPECTED object (an additive field on a default path, not a behavior change) and say so in the commit message.

- [ ] **Step 5: Commit**

```bash
git add src/simulation/battle.ts src/simulation/series.ts src/simulation/seriesOrders.test.ts
git commit -m "feat: per-bout orders and opponent dispositions through battle and series"
```

---

### Task 4: Season command and challenge temperaments (content)

**Files:**
- Modify: `src/simulation/season.ts` (`ChallengeDefinition`, `startNextSeries`, new `setBoutOrder`)
- Modify: `src/content/season.ts` (temperament vectors)
- Test: `src/simulation/season.test.ts` (add cases), `src/content/season.test.ts` (add cases)

**Interfaces:**
- Consumes: `setBoutOrder as setSeriesBoutOrder`, `DispositionId` (Tasks 1/3).
- Produces:
  - `ChallengeDefinition.temperaments: readonly DispositionId[]` (parallel to `opponents`)
  - season-level `setBoutOrder(state: SeasonState, boutIndex: number, order: DispositionId): SeasonCommandResult`
  - content: `SEASON_CHALLENGES[n].temperaments` — challenge 1 all `'standard'`; initial authored rows below.

- [ ] **Step 1: Write the failing tests**

Add to `src/content/season.test.ts`:

```ts
it('challenge 1 temperaments are all standard — the frozen baseline series', () => {
  expect(SEASON_CHALLENGES[0].temperaments).toEqual(['standard', 'standard', 'standard'])
})
it('every challenge has one temperament per opponent', () => {
  for (const challenge of SEASON_CHALLENGES) {
    expect(challenge.temperaments).toHaveLength(challenge.opponents.length)
  }
})
```

Add to `src/simulation/season.test.ts` (reuse that file's existing season-construction helper and imports; `setBoutOrder` imported from `./season`):

```ts
it('startNextSeries hands the challenge temperaments to the series', () => {
  const state = expectOkStart()   // this file's existing pattern: createSeason(...) + startNextSeries(...)
  expect(state.activeSeries!.opponentDispositions).toEqual(state.challenges[0].temperaments)
})
it('setBoutOrder delegates to the active series and fails with no-active-series on the board', () => {
  const board = createSeasonFixture()          // the file's existing createSeason(...) helper
  expect(setBoutOrder(board, 0, 'press')).toMatchObject({ ok: false, reason: 'no-active-series' })
  const started = expectOkStart()
  const result = setBoutOrder(started, 1, 'guarded')
  expect(result.ok).toBe(true)
  expect(result.state.activeSeries!.orders[1]).toBe('guarded')
})
```

(Match the surrounding file's actual helper names when adding — the two names above describe intent; `season.test.ts` already constructs seasons in nearly every test.)

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run src/simulation/season.test.ts src/content/season.test.ts`
Expected: FAIL — `temperaments` missing, `setBoutOrder` not exported.

- [ ] **Step 3: Implement**

`season.ts`:

```ts
import { setBoutOrder as setSeriesBoutOrder } from './series'
import type { DispositionId } from './disposition'
// ChallengeDefinition gains:
  temperaments: readonly DispositionId[]
// startNextSeries's seriesConfig gains:
    opponentDispositions: challenge.temperaments,
// New command, next to unassignSlot:
export function setBoutOrder(state: SeasonState, boutIndex: number, order: DispositionId): SeasonCommandResult {
  return delegateToSeries(state, (series) => setSeriesBoutOrder(series, boutIndex, order))
}
```

`content/season.ts` — after `FEATURED`:

```ts
import type { DispositionId } from '../simulation/disposition'

/**
 * Per-challenge opponent temperaments, in `opponents` order (Drusus, Cassius,
 * Magnus). Challenge 1 is all 'standard': it IS the frozen baseline series,
 * and it teaches orders against neutral opponents (design.md, "Temperaments").
 * Challenges 2–3 are initial authored rows — tuning inputs to
 * dispositionBalance.test.ts, adjustable there alongside the modifier
 * magnitudes; the challenge-1 row is not.
 */
const TEMPERAMENTS: readonly (readonly DispositionId[])[] = [
  ['standard', 'standard', 'standard'],
  ['press', 'guarded', 'standard'],
  ['press', 'guarded', 'press'],
]

// SEASON_CHALLENGES map gains:
  temperaments: TEMPERAMENTS[index],
```

- [ ] **Step 4: Run tests**

Run: `npm test` → ALL PASS. `seasonBalance.test.ts`'s golden season and cohorts run against challenge-1 (all-standard) and unscaled opponents, so nothing moves; if a challenge-2/3 assertion there consumed a full `ChallengeDefinition` object shape, extend its expected object with the temperament row.

> **Amended 2026-08-23, final review.** The sentence above is wrong on both
> counts, and the error survived into the shipped suite. `seasonBalance.test.ts`
> also measures a `fresh × challenge 3` cohort and a challenge-3 best-lineup
> series metric, and its golden season plays all three challenges — so the
> challenge-3 temperament row moves every one of them. Because the suite's
> `runBout`/`cohort` calls omitted the `dispositions` argument, it went on
> measuring a counterfactual challenge 3 with all three opponents neutral, and
> nothing constrained the authored row at all. With the argument passed, the
> authored `['press', 'guarded', 'press']` fails criterion 3 twice over (best
> lineup 39.0% against a >50% floor; `sura/magnus` 3.0% against a 5% floor).
> Challenge 3's escalation is already fully spent by the stat scaling, so its
> temperament row was not chosen to add further escalation; it is not
> difficulty-neutral with the all-neutral reference either, though — the
> shipped row's best lineup measures 61.0%, above the 52.5% all-neutral
> figure. It is now `['standard', 'press', 'standard']`. The grid it was
> chosen from is in `src/content/season.ts`'s `TEMPERAMENTS` comment.

- [ ] **Step 5: Commit**

```bash
git add src/simulation/season.ts src/content/season.ts src/simulation/season.test.ts src/content/season.test.ts
git commit -m "feat: season setBoutOrder command and authored challenge temperaments"
```

---

### Task 5: Disposition balance suite (and tuning loop)

**Files:**
- Modify: `src/testSupport/balanceCohorts.ts` (optional `dispositions` param, `homeRemainingHpRatio` metric)
- Create: `src/simulation/dispositionBalance.test.ts`
- Possibly modify (tuning only): `src/simulation/disposition.ts` constants, `src/content/season.ts` `TEMPERAMENTS` rows 2–3

**Interfaces:**
- Consumes: `cohort`/`runBout`/`measure`/`reportTable`/`pct` from `../testSupport/balanceCohorts`; veterans `brutus`/`aquila`/`nerva` and `opponents` from `../content/mvpSeries`.
- Produces: `runBout(home, away, seed, startingHp?, dispositions?)` and `cohort(home, away, seedCount, startingHp?, dispositions?)`; `BoutOutcome.homeRemainingHpRatio: number` (testSupport's own `BoutOutcome`, not the series one).

- [ ] **Step 1: Extend `balanceCohorts.ts`**

`runBout` and `cohort` gain a trailing optional `dispositions?: BattleConfig['dispositions']` forwarded into `createBattle({ ..., dispositions })`; omitting it is byte-identical to today (Task 3 proved it). `BoutOutcome` gains:

```ts
  /** Home fighter's remaining HP as a share of maxHp when the bout ended — the wear-threshold input (condition.ts's 0.25 boundary). */
  homeRemainingHpRatio: number
```

computed at the end of `runBout`:

```ts
  const home = battle.encounter.combatants[battle.descriptor.homeId]
  // ...in the returned object:
  homeRemainingHpRatio: home.hp / home.definition.maxHp,
```

Run `npm test` — existing balance suites must pass unchanged (additive field, unused by them).

- [ ] **Step 2: Write `dispositionBalance.test.ts`**

Structure (200-seed cohorts from `cohortSeed`, `COHORT_TIMEOUT_MS`-style timeout, `yieldToEventLoop` via `cohort()`):

```ts
// Cohorts (all with fresh HP):
//   A. veterans (brutus, aquila, nerva) × unscaled opponents × home order in {standard, press, guarded}  -> 27 cohorts
//   B. veterans × cassius with away temperament in {press, guarded} × home order in {standard, press, guarded} -> 18 cohorts
//   C. all 9 veteran/opponent pairings with home 'guarded' AND away 'guarded'  -> 9 cohorts
// Derived metrics per cohort: homeWinRate, lowHpShare = share(homeRemainingHpRatio < 0.25),
//   cheapWearShare = share(homeWon && homeRemainingHpRatio >= 0.25), timeoutRate, medianTicks.
```

Assertions (exact numbers — these ARE the acceptance).

> **Amended 2026-08-22 after measurement.** The first version of criteria 1, 3
> and 4 was measured unsatisfiable at every magnitude in range; the reasons are
> properties of the metrics, not of the mechanic. Evidence, in two runs of
> different sizes: the full 4–8 × 3–6 magnitude sweep, 20 cells of cohort A at
> 60 seeds (60 × 27 = 1620 bouts per cell, 32 400 in all); and a separate
> 200-seed confirmation run at the shipped magnitudes, 200 × 54 = 10 800 bouts.
> `.superpowers/sdd/2026-08-22-bout-orders/task-5-report.md`.
> The spec's "Balance acceptance" section carries the same amendment with the
> full rationale. Below is the binding text.

1. **Risk/reward is real** (cohort A, over the 9 veteran×opponent pairings; `std`/`press`/`guard` are that pairing's three cohorts):
   - `mean(press.homeWinRate - std.homeWinRate) >= 0.03` and `mean(std.homeWinRate - guard.homeWinRate) >= 0.03`
   - on `bloodyWinShare = share(homeWon && homeRemainingHpRatio < 0.25)`: `mean(press.bloodyWinShare - std.bloodyWinShare) >= 0.02` and `mean(std.bloodyWinShare - guard.bloodyWinShare) >= 0.02`
   - the per-pairing clauses and the `lowHpShare` clauses are REMOVED: `lowHpShare` counts losses (the loser is at zero HP), so at a ~0 timeout rate it is exactly `1 - cheapWearShare` and moves against the win-rate clause above it; the per-pairing clauses forbid the counter triangle `balance.test.ts` already asserts, and pull against criterion 2.
   - measured at the shipped magnitudes: `+0.087` / `+0.087` on win rate, `press 26.2% / standard 23.4% / guarded 19.4%` on `bloodyWinShare`.
2. **No dominant order** (cohort A, unchanged): for each order, it is NOT true that on all 9 pairings that order simultaneously maximizes `homeWinRate` and maximizes `cheapWearShare` among the three orders.
3. **Temperament changes the difficulty** (cohort B): over the 9 veteran×home-order cells, `mean(|homeWinRate(cassius@press) - homeWinRate(cassius@guarded)|) >= 0.05` (measured ≈ 0.083). The original "changes the answer" (ranking flip) criterion is REMOVED — it is false in this build and has no lever: temperament shifts all three win rates in the same direction without reordering them, and cohort B never reads `TEMPERAMENTS`. Record it as a design finding in the suite's header comment (with the measured rankings) rather than as a skipped test.
4. **No stall collapse** (cohorts C vs A-standard): for each of the 9 pairings, `guardedPair.timeoutRate <= Math.max(0.30, 2 * standardPair.timeoutRate)` and `1200 <= guardedPair.medianTicks && guardedPair.medianTicks <= 2700` — `balance.test.ts`'s own per-pairing band. The 1500–2400 window was narrower than the roster's own both-guarded median spread (1301…2341), so no uniform shift could fit it.

On failure, call `reportTable` with the full grid (order × pairing × metrics) so the tuning loop sees the whole picture, matching the existing suites' failure-path convention.

- [ ] **Step 3: Run and tune**

Run: `npx vitest run src/simulation/dispositionBalance.test.ts` (long — several minutes).

Tuning levers, in order, if criteria fail:
1. `COMMITTED_ADJUST` (range 4–8) and `LOCOMOTION_ADJUST` (range 3–6) in `disposition.ts` — effect too weak → raise; stalls or dominance → lower `LOCOMOTION_ADJUST` first (it is what drags `guarded` toward timeouts).
2. `TEMPERAMENTS` rows 2–3 in `content/season.ts` (criterion 3 only).
3. Do NOT touch fighter definitions, scaling vectors, `condition.ts`, or the criteria themselves. If no magnitude in range satisfies all four, stop and report — that is a design finding, not a tuning miss.

After any constant change: re-run this suite AND `npm test` in full (Task 1's unit test pins the exact magnitudes — update its two expected numbers to the final constants in the same commit).

- [ ] **Step 4: Full check**

Run: `npm test`
Expected: ALL PASS, frozen hashes untouched.

- [ ] **Step 5: Commit**

```bash
git add src/testSupport/balanceCohorts.ts src/simulation/dispositionBalance.test.ts src/simulation/disposition.ts src/simulation/disposition.test.ts src/content/season.ts
git commit -m "test: disposition balance suite — risk/reward, non-dominance, temperament, stall caps"
```

---

### Task 6: SeriesView UI — order selector, temperament badges, HUD, summary

**Files:**
- Modify: `src/presentation/SeriesView.ts`
- Modify: `src/main.ts` (intent case + dev API)
- Modify: `src/style.css` (`.order-selector`, `.temperament-badge` rules)

**Interfaces:**
- Consumes: `SeriesState.orders`/`opponentDispositions`, `BoutResult.homeOrder` (Task 3); season `setBoutOrder` (Task 4); `DispositionId` type.
- Produces:
  - `SeriesIntent` gains `{ type: 'set-order'; boutIndex: BoutIndex; order: DispositionId }`
  - DOM contract for e2e (Task 8): buttons `[data-testid="order-<boutIndex>-<order>"]` with `aria-pressed`; badges `[data-testid="temperament-<boutIndex>"][data-temperament=...]`; battle status text contains `Order: <label> · Foe: <label>`.
  - Dev API `setBoutOrder(boutIndex, order)`.

- [ ] **Step 1: Implement `SeriesView.ts`**

Labels and copy (top of file, next to `ARCHETYPE_LABELS`):

```ts
const ORDER_LABELS: Record<DispositionId, string> = { standard: 'Standard', press: 'Press', guarded: 'Guarded' }
const TEMPERAMENT_LABELS: Record<DispositionId, string> = { standard: 'Steady', press: 'Aggressive', guarded: 'Cautious' }
const ORDER_TELEGRAPHS: Record<DispositionId, string> = {
  standard: 'Standard: fights as trained.',
  press: 'Press: better odds to win, better odds to get mauled.',
  guarded: 'Guarded: keeps HP and wear down, worse odds to win.',
}
const TEMPERAMENT_DESCRIPTIONS: Record<DispositionId, string> = {
  standard: 'fights as trained',
  press: 'pushes in and commits',
  guarded: 'keeps distance and waits',
}
```

New builder:

```ts
  /** Three-way order radio group for one bout slot. Not nested inside the
   * slot's pick button (nested buttons are invalid HTML); appended to the
   * slot item / interstitial as a sibling. */
  private buildOrderSelector(state: SeriesState, boutIndex: BoutIndex): HTMLElement {
    const wrap = el('div', { class: 'order-selector', role: 'radiogroup', 'aria-label': `Bout ${BOUT_NUMERALS[boutIndex]} order` })
    for (const order of ['standard', 'press', 'guarded'] as const) {
      wrap.append(el('button', {
        class: 'button order-selector__button',
        type: 'button',
        'data-action': 'set-order',
        'data-slot-index': String(boutIndex),
        'data-order': order,
        'data-testid': `order-${boutIndex}-${order}`,
        'aria-pressed': String(state.orders[boutIndex] === order),
      }, ORDER_LABELS[order]))
    }
    wrap.append(el('span', { class: 'order-selector__telegraph' }, ORDER_TELEGRAPHS[state.orders[boutIndex]]))
    return wrap
  }

  private buildTemperamentBadge(state: SeriesState, boutIndex: BoutIndex): HTMLElement {
    const temperament = state.opponentDispositions[boutIndex]
    const badge = el('span', {
      class: 'temperament-badge',
      'data-testid': `temperament-${boutIndex}`,
      'data-temperament': temperament,
    }, `${TEMPERAMENT_LABELS[temperament]} ${RC.emDash} ${TEMPERAMENT_DESCRIPTIONS[temperament]}`)
    return badge
  }
```

Wire-up:
- `buildMatchupSlot`: append `this.buildTemperamentBadge(state, boutIndex)` inside `opponentBlock` (after the archetype `em`), and append `this.buildOrderSelector(state, boutIndex)` to `item` (after `pick`/`remove`).
- `buildInterstitial`: after `nextLine`, when `nextOpponent && nextHomeId`, append `this.buildTemperamentBadge(state, nextBoutIndex)` and `this.buildOrderSelector(state, nextBoutIndex)` before the `start` button.
- `updateStatus`: extend the status line —

```ts
    const order = state.orders[state.activeBoutIndex]
    const temperament = state.opponentDispositions[state.activeBoutIndex]
    status.textContent = `Bout ${BOUT_NUMERALS[state.activeBoutIndex]} ${RC.middleDot} ${fighterBySide(battle, 'home').definition.name} vs ${fighterBySide(battle, 'away').definition.name} ${RC.middleDot} Order: ${ORDER_LABELS[order]} ${RC.middleDot} Foe: ${TEMPERAMENT_LABELS[temperament]}`
```

- `buildSummaryBout` (fought branch): append ` Order: ${ORDER_LABELS[result.homeOrder]}.` to the row text.
- `handleClick`: new case —

```ts
      case 'set-order': {
        const boutIndex = this.parseSlot(target)
        const order = target.dataset.order
        if (boutIndex === null || order === undefined || !['standard', 'press', 'guarded'].includes(order)) return
        this.onIntent({ type: 'set-order', boutIndex, order: order as DispositionId })
        this.shell.querySelector<HTMLElement>(`[data-testid="order-${boutIndex}-${order}"]`)?.focus()
        return
      }
```

- `SeriesIntent` union gains the `set-order` member; import `DispositionId` (type-only) from `../simulation/disposition`.

- [ ] **Step 2: Implement `main.ts`**

- Import `setBoutOrder` from `./simulation/season` and `type DispositionId` / `type BoutIndex` as needed.
- `applyIntent` gains:

```ts
    case 'set-order': season = setBoutOrder(season, intent.boutIndex, intent.order).state; break
```

- `GladiatorTestApi` gains `setBoutOrder(boutIndex: BoutIndex, order: DispositionId): TestCommandResult`; the dev block gains:

```ts
    setBoutOrder: (boutIndex, order) => applySeasonCommand(setBoutOrder(season, boutIndex, order)),
```

- [ ] **Step 3: `style.css`**

Follow the existing button/badge patterns (`.speed-control`, `.condition-badge`): `.order-selector` a small flex row with gap; `.order-selector__button[aria-pressed="true"]` visibly active (same treatment as speed buttons); `.order-selector__telegraph` small muted text on its own line; `.temperament-badge` styled like `.condition-badge` with `data-temperament` color variants (steady neutral, press warm, guarded cool). Check both the normal and narrow widths the season slice already styles for.

- [ ] **Step 4: Manual smoke + unit suite**

Run: `npm run dev`, open `http://127.0.0.1:4173/?seed=20260815`, start series 1: selectors on planning (all `Standard` pressed), badges `Steady — fights as trained`, set bout I to `Press`, confirm, status line shows `Order: Press · Foe: Steady`, interstitial shows the next bout's selector and changing it works, summary rows name orders.
Run: `npm test` → PASS (no simulation change in this task).

- [ ] **Step 5: Commit**

```bash
git add src/presentation/SeriesView.ts src/main.ts src/style.css
git commit -m "feat: order selectors, temperament badges and HUD order labels in the series UI"
```

---

### Task 7: SeasonView — temperaments on challenge cards and season records

**Files:**
- Modify: `src/presentation/SeasonView.ts`

**Interfaces:**
- Consumes: `ChallengeDefinition.temperaments` (Task 4), `BoutOutcome`'s `homeOrder` on fought outcomes (Task 3).

- [ ] **Step 1: Implement**

- Copy the two label maps from Task 6 (`TEMPERAMENT_LABELS`, `ORDER_LABELS`) into this file — or better, extract both maps plus the telegraph/description strings into a new shared `src/presentation/dispositionLabels.ts` (mirroring how `conditionTelegraph.ts` is shared) and import from both views; the shared module is the right call since Task 6 already created the strings. If extracting, update Task 6's file too.
- `buildChallengeCard`: for each opponent `li`, append a badge —

```ts
      item.append(el('span', {
        class: 'temperament-badge',
        'data-testid': 'challenge-temperament',
        'data-temperament': challenge.temperaments[challenge.opponents.indexOf(opponent)],
      }, TEMPERAMENT_LABELS[challenge.temperaments[challenge.opponents.indexOf(opponent)]]))
```

(use the loop index instead of `indexOf` — iterate `challenge.opponents.entries()`.)
- `buildOutcomeRow` (fought branch): append ` Order: ${ORDER_LABELS[outcome.homeOrder]}.` to the row text.

- [ ] **Step 2: Manual smoke**

`npm run dev` → season board shows `Steady` on all challenge-1 opponents and `Aggressive`/`Cautious` on challenges 2–3 per the authored rows; play a series through to the summary and check the order shows on season-summary rows.

- [ ] **Step 3: Commit**

```bash
git add src/presentation/SeasonView.ts src/presentation/SeriesView.ts src/presentation/dispositionLabels.ts
git commit -m "feat: temperament badges on the season board and orders in season records"
```

---

### Task 8: e2e coverage and screenshot baselines

**Files:**
- Create: `tests/orders.spec.ts`
- Update baselines (intentional only): `tests/__screenshots__/win32/…` and `tests/__screenshots__/linux/…` for planning / interstitial / season-board screens

**Interfaces:**
- Consumes: DOM contract from Task 6 (`order-<n>-<id>` testids, `temperament-<n>`, status text), dev API `setBoutOrder` and the existing `startNextSeries`/`assign`/`confirm`/`advanceTicks` helpers, `?seed=20260815&snapshot`.

- [ ] **Step 1: Write the spec**

`tests/orders.spec.ts`, following the structure of the existing specs (`tests/smoke.spec.ts` for the drive pattern; every fixture starts the season explicitly):

1. **Planning selector**: load `/?seed=20260815&snapshot`, click `[data-testid="start-series"]`, assign brutus/aquila/nerva via the test API, click `[data-testid="order-0-press"]`; assert it has `aria-pressed="true"` and `order-0-standard` has `aria-pressed="false"`; assert `[data-testid="temperament-0"]` has `data-temperament="standard"` and text containing `Steady`.
2. **HUD label**: confirm the lineup, `advanceTicks(1)`; assert `[data-testid="battle-status"]` text contains `Order: Press` and `Foe: Steady`.
3. **Interstitial change**: `advanceTicks(3600)` to finish bout 0; on the interstitial click `[data-testid="order-1-guarded"]`; assert pressed; click `[data-testid="start-next-bout"]`, `advanceTicks(1)`; assert status contains `Order: Guarded`.
4. **Locked orders**: from the same interstitial state, assert via API that `setBoutOrder(0, 'press')` returns `{ ok: false, reason: 'order-locked' }` and `setBoutOrder(2, 'press')` likewise.
5. **Season board badges**: back on the board (or a fresh load), assert the challenge cards render `[data-testid="challenge-temperament"]` badges and that challenge 2's card contains at least one `data-temperament="press"` badge.
6. **Determinism guard**: with all orders left standard, play bout 0 to completion via the API and assert `getActiveBattleTraceHash()` equals the same literal `battle.test.ts` freezes (import/copy the constant the existing cross-runtime spec uses in `tests/combat-visuals.spec.ts`).

- [ ] **Step 2: Run e2e WITHOUT updating snapshots**

Run: `npm run build && npm run test:e2e`
Expected: `orders.spec.ts` PASSES; the frozen combat key-pose and combat-outcome screenshot tests PASS UNTOUCHED; only planning / interstitial / season-board screenshot comparisons FAIL (the new selectors/badges changed those screens — intended).

- [ ] **Step 3: Regenerate only the intended baselines**

Win32 (this machine): `npx playwright test --update-snapshots -g "planning"` etc. — run `-u` only for the specs whose diffs are the three intended screens, then **look at every regenerated PNG** (selectors visible, no accidental combat-screen change). Linux: the docker recipe from `AGENTS.md` (`mcr.microsoft.com/playwright:v1.62.1-noble`), copy only the intended PNGs into `tests/__screenshots__/linux/`.

- [ ] **Step 4: Full gate**

Run: `npm run check`
Expected: PASS end to end on both suites.

- [ ] **Step 5: Commit**

```bash
git add tests/orders.spec.ts tests/__screenshots__
git commit -m "test(e2e): order selection flow, temperament badges and refreshed screen baselines"
```

---

### Task 9: Docs — README and the human playtest script

**Files:**
- Modify: `README.md`
- Create: `docs/reviews/2026-08-22-bout-orders-playtest.md`

- [ ] **Step 1: README**

- New section «Приказы и темпераменты» after «Три боевых стиля»: the three orders and their trade, when they are chosen (planning + interstitial), opponent temperaments as part of challenge escalation (challenge 1 all steady), and the invariant: приказ меняет только веса решений (`disposition.ts` поверх шва `combatDecision.ts`), `standard` byte-идентичен прежнему поведению, поэтому frozen-хэши не менялись. Detеrminism line: сезон воспроизводится из `(seed, составы, приказы)`.
- «Дальнейший roadmap»: reorder per the 2026-08-22 review — 1) прогрессия (опыт за победы, перки поверх того же шва), 2) выбор испытания/кампания, 3) масс-бой, 4) импортированные модели, 5) performance-бюджеты.
- Dev API list: add `setBoutOrder(boutIndex, order)`.

- [ ] **Step 2: Playtest script**

Same format as `docs/reviews/2026-08-22-school-season-playtest.md` (status header, scripted runs, questions, reviewer log, verdict criteria). The three gate criteria verbatim from the spec's "Human playtest gate": (1) a named bout with a non-`standard` order chosen for a reason; (2) HUD-hidden clip identification of press vs guarded; (3) at least one wear outcome described as caused by the reviewer's own order choice. Scripted runs: A — seed `20260815`, fixed lineups from the season playtest, but bout orders varied per a small table; B — free play with Rematch season comparing an all-standard season against an ordered one.

- [ ] **Step 3: Commit**

```bash
git add README.md docs/reviews/2026-08-22-bout-orders-playtest.md
git commit -m "docs: orders/temperaments in README, roadmap reorder, bout-orders playtest script"
```

---

## Self-review notes (already applied)

- Spec coverage: catalog (T1), encounter (T2), battle/series/`setBoutOrder`/`homeOrder` (T3), season command + content temperaments (T4), balance criteria 1–4 (T5; criterion 5 is the untouched frozen suites, asserted in every task's "no edits" gate), UI planning/interstitial/HUD/summary (T6), season board/records (T7), e2e + baselines (T8), README/playtest gate (T9).
- Frozen-core proof appears as an explicit expectation in Tasks 2, 3, 5, 8 — never "should be fine".
- Type consistency: `DispositionId`, `dispositionModifiers`, `setBoutOrder`, `orders`, `opponentDispositions`, `temperaments`, `homeOrder` are spelled identically across tasks.
- Known soft spots called out where they live: possible `toEqual`-shaped test updates for the additive `homeOrder`/`temperaments` fields (T3/T4 step 4), tag-name verification against `combatStyles.ts` (T1 step 4), balance tuning bounded to two constants and two content rows (T5 step 3).
