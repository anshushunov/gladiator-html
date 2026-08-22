# School Season Meta-Loop Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn the one-shot three-bout series into a three-series season where a five-gladiator roster carries condition between series, so the lineup decision is made three times under a tightening constraint.

**Architecture:** A new `season.ts` owns the roster and the condition ladder and delegates every in-series command to the existing `series.ts`. Condition reaches combat as an optional `startingHp` on the encounter's combatant definition — omitted everywhere else, so the frozen kernel behaves identically. Presentation gains a season board that renders state only; every rule stays in `simulation/`.

**Tech Stack:** TypeScript, Vite, Three.js (presentation only), Vitest (unit), Playwright (e2e).

**Spec:** [`docs/superpowers/specs/2026-08-19-school-season-meta-design.md`](../specs/2026-08-19-school-season-meta-design.md)

## Global Constraints

- `src/simulation/**` must not import DOM, Three.js, `src/content/**`, or `src/presentation/**`, and must not call `Math.random`, `crypto`, or wall-clock time. `architecture.test.ts` scans every non-test simulation module for these patterns.
- The frozen combat trace hash is `dc635911`. No task may edit a frozen hash literal, a key-pose tick literal, or an existing fighter definition in `src/content/mvpSeries.ts`.
- Key-pose ticks frozen in `tests/combat-visuals.spec.ts`: 253, 817, 958, 2106. Their screenshot baselines (`heavy-cleave`, `fast-burst`, `technical-parry`, `combat-outcomes`, `combat-safe-frame`) must keep matching without regeneration.
- Only two baselines are regenerated in this whole plan, and only in Task 9: `planning.png` and the new `season-board.png`, on `win32` and `linux` separately.
- Balance cohorts use 200 consecutive seeds beginning at `20260815`, via the existing helper in `balance.test.ts`.
- Ladder: `fresh` 0, `bruised` 1, `wounded` 2, `broken` 3. Starting HP ratios: 1.00 / 0.75 / 0.50 / unfightable. Wear: `steps = (lost || ratio < 0.25) ? 2 : 1`. Rest: one step up.
- Season constants: 3 series, 3 bouts per series, roster of 5.
- Commit messages follow Conventional Commits. Stage files by name; never `git add tests/__screenshots__` wholesale and never stage the pre-existing untracked `*.review.md` files.
- Checks: `npm test` for simulation changes, `npm run test:e2e` for UI, `npm run check` before handoff.

---

## File Structure

**Created:**

| File | Responsibility |
|---|---|
| `src/simulation/condition.ts` | The ladder: type, index/clamp, starting HP, wear, rest. Pure, no imports but types. |
| `src/simulation/condition.test.ts` | Transition table, boundaries, clamping. |
| `src/simulation/season.ts` | `SeasonState`, season commands, condition application, forfeit walk. |
| `src/simulation/season.test.ts` | Season determinism, wear economy, forfeits, invariants. |
| `src/simulation/seasonBalance.test.ts` | The five balance acceptance criteria for new content. |
| `src/content/season.ts` | Roster of five, three challenges as pre-scaled plain data. |
| `src/content/season.test.ts` | Scaling monotonicity, integral HP, unchanged re-exports. |
| `src/presentation/SeasonView.ts` | Season board + season summary rendering. |
| `tests/season.spec.ts` | e2e: full season, broken gladiator, short-handed series, board baseline. |

**Modified:**

| File | Change |
|---|---|
| `src/simulation/encounter.ts` | Optional `startingHp` on `EncounterCombatantDefinition` + validation. |
| `src/simulation/battle.ts` | `BattleConfig.startingHp?: Partial<Record<FighterSide, number>>`. |
| `src/simulation/series.ts` | `PlanningSlot`/`SeriesSlot`/`BoutOutcome`, per-fighter starting HP, `advancePastForfeits`. |
| `src/simulation/random.ts` | `deriveSeriesSeed`. |
| `src/main.ts` | Holds `SeasonState`, routes screens, new dev API. |
| `src/presentation/SeriesView.ts` | Condition badge, starting HP, cost telegraph, forfeit rows. |
| `src/style.css` | Season board layout, roster cards, badges, delta rows. |
| `scripts/record-review-clips.ts` | Start series 0 explicitly. |
| `tests/combat-visuals.spec.ts`, `tests/smoke.spec.ts`, `tests/decision-panel.spec.ts` | Start series 0 explicitly. |
| `README.md`, `AGENTS.md` | Document the season loop and the new checks. |

---

### Task 1: Condition ladder

**Files:**
- Create: `src/simulation/condition.ts`
- Test: `src/simulation/condition.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `FighterCondition`, `CONDITION_LADDER`, `conditionIndex(c): number`, `conditionAtIndex(i): FighterCondition`, `isFightable(c): boolean`, `startingHpFor(c, maxHp): number`, `conditionAfterBout(c, wear): FighterCondition`, `conditionAfterRest(c): FighterCondition`, `interface BoutWear { remainingHpRatio: number; won: boolean }`.

- [ ] **Step 1: Write the failing test**

```ts
// src/simulation/condition.test.ts
import { describe, expect, it } from 'vitest'
import {
  conditionAfterBout,
  conditionAfterRest,
  conditionAtIndex,
  conditionIndex,
  isFightable,
  startingHpFor,
  type FighterCondition,
} from './condition'

describe('condition ladder', () => {
  it('orders the four steps and clamps at both ends', () => {
    expect(conditionIndex('fresh')).toBe(0)
    expect(conditionIndex('broken')).toBe(3)
    expect(conditionAtIndex(-2)).toBe('fresh')
    expect(conditionAtIndex(9)).toBe('broken')
  })

  it('starts a bout at the ratio of max HP, never below 1', () => {
    expect(startingHpFor('fresh', 324)).toBe(324)
    expect(startingHpFor('bruised', 324)).toBe(243)
    expect(startingHpFor('wounded', 324)).toBe(162)
    expect(startingHpFor('wounded', 1)).toBe(1)
  })

  it('refuses to start a bout for a broken gladiator', () => {
    expect(isFightable('broken')).toBe(false)
    expect(() => startingHpFor('broken', 324)).toThrow(/broken/)
  })

  // The whole point of the slice: no bout is free. A dominant win still costs
  // one step, so the best matchup is paid for by the series that follows.
  it('charges every bout at least one step', () => {
    expect(conditionAfterBout('fresh', { remainingHpRatio: 1, won: true })).toBe('bruised')
    expect(conditionAfterBout('fresh', { remainingHpRatio: 0.6, won: true })).toBe('bruised')
  })

  it('charges two steps for a loss at any ratio, or a win under 25%', () => {
    expect(conditionAfterBout('fresh', { remainingHpRatio: 0.9, won: false })).toBe('wounded')
    expect(conditionAfterBout('fresh', { remainingHpRatio: 0.24, won: true })).toBe('wounded')
    // 0.25 is the boundary and belongs to the cheaper band.
    expect(conditionAfterBout('fresh', { remainingHpRatio: 0.25, won: true })).toBe('bruised')
  })

  it('clamps wear at broken and recovers one step per rest', () => {
    expect(conditionAfterBout('wounded', { remainingHpRatio: 0, won: false })).toBe('broken')
    expect(conditionAfterBout('broken', { remainingHpRatio: 0, won: false })).toBe('broken')
    expect(conditionAfterRest('broken')).toBe('wounded')
    expect(conditionAfterRest('fresh')).toBe('fresh')
  })

  it('rejects a non-finite ratio rather than silently clamping it', () => {
    expect(() => conditionAfterBout('fresh', { remainingHpRatio: Number.NaN, won: true })).toThrow()
  })
})
```

- [ ] **Step 2: Run the test and watch it fail**

Run: `npx vitest run src/simulation/condition.test.ts`
Expected: FAIL — `Failed to resolve import "./condition"`.

- [ ] **Step 3: Write the implementation**

```ts
// src/simulation/condition.ts

/** A gladiator's accumulated wear. Decides starting HP and whether they can fight at all. */
export type FighterCondition = 'fresh' | 'bruised' | 'wounded' | 'broken'

export const CONDITION_LADDER = ['fresh', 'bruised', 'wounded', 'broken'] as const satisfies readonly FighterCondition[]

/** Fraction of `maxHp` a gladiator in this condition starts a bout with. `broken` never starts one. */
const STARTING_HP_RATIO: Record<FighterCondition, number> = {
  fresh: 1,
  bruised: 0.75,
  wounded: 0.5,
  broken: 0,
}

export interface BoutWear {
  remainingHpRatio: number
  won: boolean
}

export function conditionIndex(condition: FighterCondition): number {
  return CONDITION_LADDER.indexOf(condition)
}

export function conditionAtIndex(index: number): FighterCondition {
  if (!Number.isFinite(index)) throw new Error('Condition index must be finite')
  const clamped = Math.min(CONDITION_LADDER.length - 1, Math.max(0, Math.round(index)))
  return CONDITION_LADDER[clamped]
}

export function isFightable(condition: FighterCondition): boolean {
  return condition !== 'broken'
}

export function startingHpFor(condition: FighterCondition, maxHp: number): number {
  if (!isFightable(condition)) throw new Error('A broken gladiator cannot start a bout')
  if (!Number.isInteger(maxHp) || maxHp <= 0) throw new Error('maxHp must be a positive integer')
  return Math.max(1, Math.round(maxHp * STARTING_HP_RATIO[condition]))
}

/**
 * Wear is charged per bout, never zero: a free dominant matchup is exactly the
 * defect this meta-loop exists to remove (design.md, "Condition ladder").
 * A loss costs two steps at any ratio, because `time-limit` losses can end
 * with high HP and would otherwise be cheaper than a hard-won victory.
 */
export function conditionAfterBout(condition: FighterCondition, wear: Readonly<BoutWear>): FighterCondition {
  if (!Number.isFinite(wear.remainingHpRatio)) throw new Error('remainingHpRatio must be finite')
  const steps = !wear.won || wear.remainingHpRatio < 0.25 ? 2 : 1
  return conditionAtIndex(conditionIndex(condition) + steps)
}

export function conditionAfterRest(condition: FighterCondition): FighterCondition {
  return conditionAtIndex(conditionIndex(condition) - 1)
}
```

- [ ] **Step 4: Run the test and watch it pass**

Run: `npx vitest run src/simulation/condition.test.ts`
Expected: PASS, 7 tests.

- [ ] **Step 5: Confirm the architecture guard still holds**

Run: `npx vitest run src/simulation/architecture.test.ts`
Expected: PASS — the new module imports nothing forbidden.

- [ ] **Step 6: Commit**

```bash
git add src/simulation/condition.ts src/simulation/condition.test.ts
git commit -m "feat(season): add the gladiator condition ladder"
```

---

### Task 2: Optional starting HP in the kernel

**Files:**
- Modify: `src/simulation/encounter.ts` (interface `EncounterCombatantDefinition` near line 210; `buildFighterCombatState` line 534-545)
- Modify: `src/simulation/battle.ts` (`BattleConfig` line 53-58; `createBattle` line 136-160)
- Test: `src/simulation/encounter.test.ts`, `src/simulation/battle.test.ts` (append)

**Interfaces:**
- Consumes: nothing from Task 1.
- Produces: `EncounterCombatantDefinition.startingHp?: number`; `BattleConfig.startingHp?: Partial<Record<FighterSide, number>>`.

- [ ] **Step 1: Write the failing tests**

```ts
// append to src/simulation/encounter.test.ts
describe('optional starting HP', () => {
  it('starts a combatant below max when asked, and at max when not', () => {
    const withWear = createEncounter(hundredHpDuelConfig({ startingHp: 40 }))
    expect(withWear.state.combatants['home.brutus'].hp).toBe(40)

    const untouched = createEncounter(hundredHpDuelConfig({}))
    expect(untouched.state.combatants['home.brutus'].hp).toBe(untouched.state.combatants['home.brutus'].definition.maxHp)
  })

  it('rejects a starting HP that is not an integer inside 1..maxHp', () => {
    expect(() => createEncounter(hundredHpDuelConfig({ startingHp: 0 }))).toThrow(/startingHp/)
    expect(() => createEncounter(hundredHpDuelConfig({ startingHp: 12.5 }))).toThrow(/startingHp/)
    expect(() => createEncounter(hundredHpDuelConfig({ startingHp: 100_000 }))).toThrow(/startingHp/)
  })
})
```

`hundredHpDuelConfig` is a local helper written in this step: build it from the existing fixture the file already uses for two-combatant encounters, spreading `{ ...combatant, ...overrides }` onto the home combatant only. Read the top of `encounter.test.ts` and reuse whatever duel fixture is already there rather than inventing a second one.

```ts
// append to src/simulation/battle.test.ts
it('passes per-side starting HP through to the encounter, and changes nothing when omitted', () => {
  const worn = createBattle({ home: brutus, away: drusus, seed: 123, combatStyles: COMBAT_STYLES, startingHp: { home: 100 } })
  expect(fighterBySide(worn, 'home').hp).toBe(100)
  expect(fighterBySide(worn, 'away').hp).toBe(drusus.maxHp)

  const plain = createBattle({ home: brutus, away: drusus, seed: 123, combatStyles: COMBAT_STYLES })
  expect(fighterBySide(plain, 'home').hp).toBe(brutus.maxHp)
  expect(plain.traceHash).toBe(createBattle({ home: brutus, away: drusus, seed: 123, combatStyles: COMBAT_STYLES }).traceHash)
})
```

- [ ] **Step 2: Run the tests and watch them fail**

Run: `npx vitest run src/simulation/encounter.test.ts src/simulation/battle.test.ts`
Expected: FAIL — `startingHp` is not a known property; the HP assertions read `maxHp`.

- [ ] **Step 3: Implement in `encounter.ts`**

Add the field to the definition interface:

```ts
export interface EncounterCombatantDefinition {
  // ...existing fields unchanged...
  /**
   * Optional HP this combatant enters the encounter with. Omitted (the only
   * value the duel adapter used before the season meta-loop) means `maxHp`,
   * which is why every frozen trace hash survives this field's addition.
   */
  startingHp?: number
}
```

In `buildFighterCombatState` (line 534), replace `hp: fighter.maxHp` with:

```ts
    hp: resolveStartingHp(definition, fighter),
```

and add, next to `requireUniqueIds`:

```ts
function resolveStartingHp(definition: EncounterCombatantDefinition, fighter: FighterDefinition): number {
  if (definition.startingHp === undefined) return fighter.maxHp
  const value = definition.startingHp
  if (!Number.isInteger(value) || value < 1 || value > fighter.maxHp) {
    throw new Error(`EncounterConfig combatant '${definition.id}' startingHp must be an integer between 1 and ${fighter.maxHp}`)
  }
  return value
}
```

- [ ] **Step 4: Implement in `battle.ts`**

```ts
export interface BattleConfig {
  home: FighterDefinition
  away: FighterDefinition
  seed: number
  combatStyles: CombatStyleCatalog
  /** Per-side HP the fighters enter with. Omitted sides start at their own `maxHp`. */
  startingHp?: Partial<Record<FighterSide, number>>
}
```

In `createBattle`, extend the two combatant literals:

```ts
      { id: descriptor.homeId, factionId: 'home', fighter: config.home, startPosition: HOME_START_POSITION, startingHp: config.startingHp?.home },
      { id: descriptor.awayId, factionId: 'away', fighter: config.away, startPosition: AWAY_START_POSITION, startingHp: config.startingHp?.away },
```

- [ ] **Step 5: Run the full unit suite**

Run: `npm test`
Expected: PASS, including the untouched frozen-hash assertions in `battle.test.ts` and the cross-runtime literal. If a frozen hash moved, the default path was changed — fix the cause, never the literal.

- [ ] **Step 6: Commit**

```bash
git add src/simulation/encounter.ts src/simulation/encounter.test.ts src/simulation/battle.ts src/simulation/battle.test.ts
git commit -m "feat(sim): let a combatant enter an encounter below full health"
```

---

### Task 3: Series slots, outcomes, and the forfeit walk

**Files:**
- Modify: `src/simulation/series.ts` (whole file)
- Test: `src/simulation/series.test.ts` (append)

**Interfaces:**
- Consumes: `BattleConfig.startingHp` from Task 2.
- Produces: `PlanningSlot`, `PlanningAssignments`, `SeriesSlot`, `BoutOutcome`, `SeriesConfig.homeStartingHpByFighterId`, `SeriesState.results: readonly BoutOutcome[]`, `SeriesState.slots: readonly SeriesSlot[]`, and the exported `requiredAssignmentCount(state): number`.

The season layer passes **only fightable gladiators** in `homeRoster`, so `series.ts` needs no notion of `broken`: it requires `min(3, homeRoster.length)` filled slots and forfeits the rest.

- [ ] **Step 1: Write the failing tests**

```ts
// append to src/simulation/series.test.ts
describe('short-handed series', () => {
  const twoFighterConfig = () => ({
    homeRoster: [brutus, aquila],
    opponents,
    seed: 20260815,
    combatStyles: COMBAT_STYLES,
    homeStartingHpByFighterId: { brutus: brutus.maxHp, aquila: aquila.maxHp },
  })

  it('requires exactly as many assignments as there are gladiators', () => {
    const state = createSeries(twoFighterConfig())
    expect(requiredAssignmentCount(state)).toBe(2)
    expect(confirmLineup(state).ok).toBe(false)

    const one = assignFighter(state, 'brutus', 0).state
    expect(confirmLineup(one).ok).toBe(false)
    const two = assignFighter(one, 'aquila', 2).state
    expect(confirmLineup(two).ok).toBe(true)
  })

  it('forfeits the uncovered slot and still reaches three outcomes', () => {
    let state = createSeries(twoFighterConfig())
    state = assignFighter(state, 'brutus', 0).state
    state = assignFighter(state, 'aquila', 2).state
    state = confirmLineup(state).state
    state = advanceSeriesTicks(state, 20_000)
    while (state.phase === 'between-bouts') {
      state = advanceSeriesTicks(startNextBout(state).state, 20_000)
    }

    expect(state.phase).toBe('summary')
    expect(state.results).toHaveLength(3)
    const forfeited = state.results.filter((outcome) => outcome.kind === 'forfeit')
    expect(forfeited).toHaveLength(1)
    expect(forfeited[0]).toMatchObject({ boutIndex: 1, opponentId: opponents[1].id })
    expect(state.score.away).toBeGreaterThanOrEqual(1)
  })

  it('completes a series with no fightable gladiators at all', () => {
    let state = createSeries({ ...twoFighterConfig(), homeRoster: [], homeStartingHpByFighterId: {} })
    expect(requiredAssignmentCount(state)).toBe(0)
    state = confirmLineup(state).state
    expect(state.phase).toBe('summary')
    expect(state.results).toHaveLength(3)
    expect(state.score).toEqual({ home: 0, away: 3 })
    expect(state.activeBattle).toBeUndefined()
  })
})

it('starts an assigned gladiator at the HP the season gave them', () => {
  let state = createSeries({
    homeRoster: [brutus, aquila, nerva],
    opponents,
    seed: 20260815,
    combatStyles: COMBAT_STYLES,
    homeStartingHpByFighterId: { brutus: 100, aquila: aquila.maxHp, nerva: nerva.maxHp },
  })
  state = assignFighter(state, 'brutus', 0).state
  state = assignFighter(state, 'aquila', 1).state
  state = assignFighter(state, 'nerva', 2).state
  state = confirmLineup(state).state
  expect(fighterBySide(state.activeBattle!, 'home').hp).toBe(100)
})
```

- [ ] **Step 2: Run the tests and watch them fail**

Run: `npx vitest run src/simulation/series.test.ts`
Expected: FAIL — `requiredAssignmentCount` is not exported; `homeStartingHpByFighterId` is not a known property.

- [ ] **Step 3: Rewrite the types in `series.ts`**

```ts
/** A slot during planning: either a chosen gladiator or still empty. */
export type PlanningSlot = { kind: 'fighter'; fighterId: string } | null
export type PlanningAssignments = [PlanningSlot, PlanningSlot, PlanningSlot]

/** A slot after `confirmLineup`: empty is no longer possible, only forfeited. */
export type SeriesSlot = { kind: 'fighter'; fighterId: string } | { kind: 'forfeit' }

export type BoutOutcome =
  | ({ kind: 'fought' } & BoutResult)
  | { kind: 'forfeit'; boutIndex: BoutIndex; opponentId: string }

export interface SeriesConfig {
  homeRoster: readonly FighterDefinition[]     // fightable gladiators only
  opponents: readonly FighterDefinition[]
  seed: number
  combatStyles: CombatStyleCatalog
  homeStartingHpByFighterId: Readonly<Record<string, number>>
}
```

`SeriesState` swaps `assignments: Assignments` for `assignments: PlanningAssignments`, adds `slots: readonly SeriesSlot[]` (empty until confirmation) and `homeStartingHpByFighterId`, and changes `results` to `readonly BoutOutcome[]`. Keep `SeriesCommandFailure` as it is; unknown ids keep throwing (`series.ts:65-68`).

- [ ] **Step 4: Implement the forfeit walk**

```ts
export function requiredAssignmentCount(state: SeriesState): number {
  return Math.min(3, state.homeRoster.length)
}

/** Freezes planning slots into committed slots: assigned gladiators stay, empty slots become forfeits. */
function freezeSlots(assignments: PlanningAssignments): readonly SeriesSlot[] {
  return assignments.map((slot) => slot ?? ({ kind: 'forfeit' } as const))
}

/**
 * Walks forward from `boutIndex` over any forfeited slots, recording an away
 * win for each, and returns the first slot that must actually be fought --
 * or `null` when the series ends inside the walk. Pure: no battle is created
 * here, so an all-forfeit series never constructs an encounter.
 */
function advancePastForfeits(state: SeriesState, from: BoutIndex): { state: SeriesState; next: BoutIndex | null } {
  let results = [...state.results]
  let score = { ...state.score }
  for (let index = from; index <= 2; index += 1) {
    const slot = state.slots[index]
    if (slot.kind === 'fighter') {
      return { state: { ...state, results, score }, next: index as BoutIndex }
    }
    results = [...results, { kind: 'forfeit', boutIndex: index as BoutIndex, opponentId: state.opponents[index].id }]
    score = { ...score, away: score.away + 1 }
  }
  return { state: { ...state, results, score, phase: 'summary', activeBoutIndex: 2, activeBattle: undefined }, next: null }
}
```

`confirmLineup` now: rejects with `lineup-incomplete` unless exactly `requiredAssignmentCount(state)` slots are filled, calls `freezeSlots`, then `advancePastForfeits(state, 0)` and creates a battle only if `next !== null`. `startNextBout` does the same from `activeBoutIndex + 1`. `advanceSeriesTicks` wraps its finished-bout result as `{ kind: 'fought', ... }` and, when the bout was not the last, runs the same walk instead of assuming the next slot is fought. Battle creation passes `startingHp: { home: state.homeStartingHpByFighterId[fighterId] }`.

- [ ] **Step 5: Run the tests and watch them pass**

Run: `npx vitest run src/simulation/series.test.ts`
Expected: PASS. Existing series tests must pass too; where they read `state.results[i].winnerSide`, narrow on `kind === 'fought'` first.

- [ ] **Step 6: Run the whole unit suite**

Run: `npm test`
Expected: PASS. Frozen hashes untouched.

- [ ] **Step 7: Commit**

```bash
git add src/simulation/series.ts src/simulation/series.test.ts
git commit -m "feat(series): support short-handed lineups and forfeited bouts"
```

---

### Task 4: Series seeds and season content

**Files:**
- Modify: `src/simulation/random.ts` (after `deriveBoutSeed`, line 33)
- Create: `src/content/season.ts`, `src/content/season.test.ts`
- Test: `src/simulation/random.test.ts` (append)

**Interfaces:**
- Consumes: `FighterDefinition` from `fighters.ts`.
- Produces: `deriveSeriesSeed(seasonSeed, seriesIndex): number`; from content — `SEASON_ROSTER: readonly FighterDefinition[]` (5), `SEASON_CHALLENGES: readonly ChallengeDefinition[]` (3), re-exported `homeRoster`/`opponents`.

`ChallengeDefinition` is declared in `season.ts` (Task 5) and imported by the content module — content may import simulation, not the reverse.

- [ ] **Step 1: Write the failing tests**

```ts
// append to src/simulation/random.test.ts
it('passes series 0 through unchanged and derives the rest', () => {
  expect(deriveSeriesSeed(20260815, 0)).toBe(20260815)
  expect(deriveSeriesSeed(20260815, 1)).not.toBe(20260815)
  expect(deriveSeriesSeed(20260815, 1)).toBe(deriveSeriesSeed(20260815, 1))
  expect(deriveSeriesSeed(20260815, 1)).not.toBe(deriveSeriesSeed(20260815, 2))
})
```

```ts
// src/content/season.test.ts
import { describe, expect, it } from 'vitest'
import { homeRoster as mvpHomeRoster, opponents as mvpOpponents } from './mvpSeries'
import { SEASON_CHALLENGES, SEASON_ROSTER } from './season'

describe('season content', () => {
  it('keeps the calibrated six exactly as they are', () => {
    expect(SEASON_ROSTER.slice(0, 3)).toEqual(mvpHomeRoster)
    expect(SEASON_CHALLENGES[0].opponents).toEqual(mvpOpponents)
  })

  it('fields five gladiators, two heavy, two fast, one technical', () => {
    expect(SEASON_ROSTER).toHaveLength(5)
    const byArchetype = SEASON_ROSTER.reduce<Record<string, number>>((acc, f) => ({ ...acc, [f.archetype]: (acc[f.archetype] ?? 0) + 1 }), {})
    expect(byArchetype).toEqual({ heavy: 2, fast: 2, technical: 1 })
    expect(new Set(SEASON_ROSTER.map((f) => f.id)).size).toBe(5)
  })

  it('scales every opponent monotonically across the three challenges, integrally', () => {
    for (const opponentIndex of [0, 1, 2]) {
      const hp = SEASON_CHALLENGES.map((c) => c.opponents[opponentIndex].maxHp)
      const power = SEASON_CHALLENGES.map((c) => c.opponents[opponentIndex].power)
      expect(hp[0]).toBeLessThan(hp[1])
      expect(hp[1]).toBeLessThan(hp[2])
      expect(power[0]).toBeLessThan(power[1])
      expect(power[1]).toBeLessThan(power[2])
      for (const value of hp) expect(Number.isInteger(value)).toBe(true)
    }
  })

  it('leaves the calibrated stat rows untouched by scaling', () => {
    for (const challenge of SEASON_CHALLENGES) {
      challenge.opponents.forEach((opponent, index) => {
        expect(opponent.accuracy).toBe(mvpOpponents[index].accuracy)
        expect(opponent.defenseChance).toBe(mvpOpponents[index].defenseChance)
        expect(opponent.criticalChance).toBe(mvpOpponents[index].criticalChance)
        expect(opponent.id).toBe(mvpOpponents[index].id)
      })
    }
  })

  it('names one featured threat per escalated challenge', () => {
    expect(SEASON_CHALLENGES.map((c) => c.featuredThreat)).toEqual([null, 'fast', 'heavy'])
  })
})
```

- [ ] **Step 2: Run and watch them fail**

Run: `npx vitest run src/simulation/random.test.ts src/content/season.test.ts`
Expected: FAIL — `deriveSeriesSeed` and `./season` do not exist.

- [ ] **Step 3: Add `deriveSeriesSeed`**

```ts
/**
 * Series 0 deliberately reuses the season seed: `combat-visuals.spec.ts`
 * freezes key poses at ticks derived from `deriveBoutSeed(20260815, 0)`, and
 * the season simply opens with the series the game already plays.
 */
export const deriveSeriesSeed = (seasonSeed: number, seriesIndex: number): number =>
  seriesIndex === 0 ? seasonSeed >>> 0 : deriveSeed(seasonSeed, `series:${seriesIndex}`)
```

- [ ] **Step 4: Write the content module**

```ts
// src/content/season.ts
import type { ChallengeDefinition } from '../simulation/season'
import type { Archetype, FighterDefinition } from '../simulation/fighters'
import { homeRoster, opponents } from './mvpSeries'

export { homeRoster, opponents } from './mvpSeries'

// Bench specialists, appended after the calibrated three so every existing
// fixture that names `brutus`/`aquila`/`nerva` keeps exercising the same
// pairing. They are deliberately weaker on aggregate than the veteran of
// their own style -- a bench as good as the starters turns rotation into
// bookkeeping (design.md, "Roster and challenge content"). Task 6 calibrates
// these numbers; the values here are the starting point it measures.
const benchSpecialists = [
  { id: 'vitus', name: 'Vitus', school: 'House of Mars', archetype: 'heavy', maxHp: 296, power: 21, accuracy: 0.83, defenseChance: 0.33, criticalChance: 0.09 },
  { id: 'sura', name: 'Sura', school: 'House of Mars', archetype: 'fast', maxHp: 262, power: 19, accuracy: 0.845, defenseChance: 0.305, criticalChance: 0.14 },
] as const satisfies readonly FighterDefinition[]

export const SEASON_ROSTER = [...homeRoster, ...benchSpecialists] as const satisfies readonly FighterDefinition[]

/** Per-opponent scaling, in `opponents` order: Drusus (fast), Cassius (technical), Magnus (heavy). */
const SCALING: readonly (readonly [number, number, number])[] = [
  [1.00, 1.00, 1.00],
  [1.12, 1.08, 1.04],
  [1.16, 1.12, 1.20],
]

const FEATURED: readonly (Archetype | null)[] = [null, 'fast', 'heavy']

function scaleOpponent(definition: FighterDefinition, factor: number): FighterDefinition {
  if (factor === 1) return definition
  return { ...definition, maxHp: Math.round(definition.maxHp * factor), power: definition.power * factor }
}

export const SEASON_CHALLENGES: readonly ChallengeDefinition[] = SCALING.map((factors, index) => ({
  index: index as 0 | 1 | 2,
  opponents: opponents.map((opponent, slot) => scaleOpponent(opponent, factors[slot])),
  featuredThreat: FEATURED[index],
}))
```

- [ ] **Step 5: Run and watch them pass**

Run: `npx vitest run src/simulation/random.test.ts src/content/season.test.ts`
Expected: PASS. `ChallengeDefinition` must already exist — if Task 5 has not landed yet, declare the interface in `src/simulation/season.ts` as its first content, then continue.

- [ ] **Step 6: Commit**

```bash
git add src/simulation/random.ts src/simulation/random.test.ts src/content/season.ts src/content/season.test.ts
git commit -m "feat(content): add the season roster and three escalating challenges"
```

---

### Task 5: The season state machine

**Files:**
- Create: `src/simulation/season.ts`, `src/simulation/season.test.ts`

**Interfaces:**
- Consumes: Task 1's ladder, Task 3's series API, Task 4's `deriveSeriesSeed`.
- Produces: `ChallengeDefinition`, `RosterEntry`, `ConditionDelta`, `SeriesRecord`, `SeasonConfig`, `SeasonState`, `SeasonCommandFailure`, `SeasonCommandResult`, and the commands `createSeason`, `startNextSeries`, `assignFighter`, `unassignSlot`, `confirmLineup`, `advanceSeasonTicks`, `startNextBout`, `continueSeason`, `rematchSeason`, plus the read helpers `fightableEntries(state)` and `startingHpByFighterId(state)`.

Command names are re-exported under season-specific names in Task 7's dev API (`assignFighter` → `assign`, etc.) to avoid two same-named exports in `main.ts`.

- [ ] **Step 1: Write the failing tests**

```ts
// src/simulation/season.test.ts
import { describe, expect, it } from 'vitest'
import { COMBAT_STYLES } from '../content/combatStyles'
import { SEASON_CHALLENGES, SEASON_ROSTER } from '../content/season'
import {
  advanceSeasonTicks, confirmLineup, continueSeason, createSeason, rematchSeason,
  startNextBout, startNextSeries, assignFighter, type SeasonState,
} from './season'

const config = () => ({ seed: 20260815, roster: SEASON_ROSTER, challenges: SEASON_CHALLENGES, combatStyles: COMBAT_STYLES })

/** Plays one whole series with the three named gladiators in slot order. */
function playSeries(start: SeasonState, lineup: readonly [string, string, string]): SeasonState {
  let state = startNextSeries(start).state
  lineup.forEach((fighterId, index) => { state = assignFighter(state, fighterId, index).state })
  state = confirmLineup(state).state
  state = advanceSeasonTicks(state, 20_000)
  while (state.activeSeries?.phase === 'between-bouts') {
    state = advanceSeasonTicks(startNextBout(state).state, 20_000)
  }
  return state
}

describe('season', () => {
  it('opens on the board with a fresh roster and three challenges', () => {
    const state = createSeason(config())
    expect(state.phase).toBe('season-board')
    expect(state.roster).toHaveLength(5)
    expect(state.roster.every((entry) => entry.condition === 'fresh')).toBe(true)
    expect(state.seriesIndex).toBe(0)
  })

  it('charges everyone who fought and restores everyone who rested', () => {
    let state = playSeries(createSeason(config()), ['brutus', 'aquila', 'nerva'])
    state = continueSeason(state).state

    const byId = Object.fromEntries(state.roster.map((entry) => [entry.fighter.id, entry]))
    for (const id of ['brutus', 'aquila', 'nerva']) {
      expect(byId[id].condition).not.toBe('fresh')
      expect(byId[id].boutsFought).toBe(1)
    }
    // Resting while already fresh restores nothing -- the clamp is why the
    // real recovery economy is two useful steps, not six (design.md).
    expect(byId.vitus.condition).toBe('fresh')
    expect(state.lastDeltas.filter((d) => d.cause === 'rested')).toHaveLength(2)
    expect(state.phase).toBe('season-board')
    expect(state.seriesIndex).toBe(1)
  })

  it('reproduces the same season from the same seed and lineups', () => {
    const play = () => {
      let state = playSeries(createSeason(config()), ['brutus', 'aquila', 'nerva'])
      state = continueSeason(state).state
      state = playSeries(state, ['vitus', 'sura', 'brutus'])
      return continueSeason(state).state
    }
    expect(JSON.stringify(play().records)).toBe(JSON.stringify(play().records))
  })

  it('refuses to field a broken gladiator', () => {
    const broken = { ...createSeason(config()) }
    const state: SeasonState = {
      ...broken,
      roster: broken.roster.map((entry) => (entry.fighter.id === 'brutus' ? { ...entry, condition: 'broken' as const } : entry)),
    }
    const started = startNextSeries(state).state
    const rejected = assignFighter(started, 'brutus', 0)
    expect(rejected.ok).toBe(false)
    expect(rejected.reason).toBe('fighter-unavailable')
  })

  it('ends after three series with nine outcomes and a matching score', () => {
    let state = createSeason(config())
    for (const lineup of [['brutus', 'aquila', 'nerva'], ['vitus', 'sura', 'brutus'], ['aquila', 'nerva', 'vitus']] as const) {
      state = continueSeason(playSeries(state, lineup)).state
    }
    expect(state.phase).toBe('season-summary')
    expect(state.records).toHaveLength(3)
    expect(state.records.flatMap((record) => record.outcomes)).toHaveLength(9)
    expect(state.score.home + state.score.away).toBe(9)
    expect(state.score.home).toBe(state.records.reduce((sum, record) => sum + record.score.home, 0))
  })

  it('resets the whole roster on a season rematch', () => {
    let state = createSeason(config())
    for (const lineup of [['brutus', 'aquila', 'nerva'], ['vitus', 'sura', 'brutus'], ['aquila', 'nerva', 'vitus']] as const) {
      state = continueSeason(playSeries(state, lineup)).state
    }
    const restarted = rematchSeason(state).state
    expect(restarted.phase).toBe('season-board')
    expect(restarted.seriesIndex).toBe(0)
    expect(restarted.records).toEqual([])
    expect(restarted.roster.every((entry) => entry.condition === 'fresh' && entry.boutsFought === 0)).toBe(true)
    expect(restarted.seed).toBe(state.seed)
  })
})
```

- [ ] **Step 2: Run and watch them fail**

Run: `npx vitest run src/simulation/season.test.ts`
Expected: FAIL — `./season` has no exports yet.

- [ ] **Step 3: Write `season.ts`**

Declare the data model exactly as the spec's "Data model" section states, then the commands:

- `createSeason(config)` — every entry `fresh`, `boutsFought: 0`, `phase: 'season-board'`, `records: []`, `lastDeltas: []`, `score: { home: 0, away: 0 }`.
- `startNextSeries(state)` — fails `no-series-pending` unless `phase === 'season-board'`; builds a `SeriesConfig` from **fightable entries only**, their `startingHpFor(condition, maxHp)` map, `challenges[seriesIndex].opponents`, and `deriveSeriesSeed(state.seed, state.seriesIndex)`; sets `phase: 'series'`.
- `assignFighter(state, fighterId, boutIndex)` — returns `fighter-unavailable` when the id is in the roster but not fightable, then delegates; unknown ids still throw from `series.ts`.
- `unassignSlot`, `confirmLineup`, `advanceSeasonTicks`, `startNextBout` — thin delegations that write the returned `SeriesState` back into `activeSeries`.
- `continueSeason(state)` — fails `series-not-finished` unless the active series reached `summary`. Computes one `ConditionDelta` per roster entry: `cause: 'fought'` with `conditionAfterBout` for anyone in a `fought` outcome, `cause: 'rested'` with `conditionAfterRest` otherwise; appends a `SeriesRecord`; adds the series score to the season score; then either advances `seriesIndex` and returns to `season-board`, or sets `phase: 'season-summary'` after the third.
- `rematchSeason(state)` — fails `season-not-finished` unless `phase === 'season-summary'`; returns `createSeason` output for the same config.

Wear input comes from the outcome: `{ remainingHpRatio: outcome.remainingHpRatio.home, won: outcome.winnerSide === 'home' }`.

- [ ] **Step 4: Run and watch them pass**

Run: `npx vitest run src/simulation/season.test.ts`
Expected: PASS, 6 tests.

- [ ] **Step 5: Run the whole suite plus the architecture guard**

Run: `npm test`
Expected: PASS. If `architecture.test.ts` fails, `season.ts` imported `content/` — take the data through `SeasonConfig` instead.

- [ ] **Step 6: Commit**

```bash
git add src/simulation/season.ts src/simulation/season.test.ts
git commit -m "feat(season): add the three-series season state machine"
```

---

### Task 6: Balance acceptance for the new content

**Files:**
- Create: `src/simulation/seasonBalance.test.ts`
- Modify: `src/content/season.ts` (numbers only, if the criteria fail)

**Interfaces:**
- Consumes: Tasks 1, 4, 5.
- Produces: no new exports. Reuse the cohort helper already in `balance.test.ts`; if it is file-local, export it from there without changing its behaviour.

Do not weaken any existing assertion in `balance.test.ts`. Tune only `benchSpecialists` and, if genuinely necessary, the `SCALING` vectors — never the six calibrated definitions.

- [ ] **Step 1: Write the failing tests**

Five `it` blocks, all over **200 consecutive seeds from 20260815**:

1. each bench specialist's win rate against each of the three unscaled opponents is inside `15..85%`;
2. for each duplicated style, veteran and specialist each win at least one of the three opponent win-rate comparisons (neither is a strict upgrade);
3. for each veteran, win rate against challenge 3 is strictly below challenge 1; no `fresh` pairing in challenge 3 falls outside `5..95%`;
4. a `wounded` gladiator (start at `startingHpFor('wounded', maxHp)`) wins at least 10 percentage points less often than the same gladiator `fresh` against the same opponent;
5. golden season — one fixed seed and three named lineups produce an asserted `ConditionDelta` sequence, and before series 2 or 3 at least one gladiator is unfightable or below `fresh`, so the best fresh-roster lineup is provably unavailable.

- [ ] **Step 2: Run and read the numbers**

Run: `npx vitest run src/simulation/seasonBalance.test.ts`
Expected: FAIL somewhere. Record the actual percentages before touching anything — they are the input to tuning.

- [ ] **Step 3: Tune the bench specialists**

Adjust `benchSpecialists` numbers only, re-running after each change. Keep each specialist below its veteran on aggregate while winning at least one comparison. Document every value you moved and why in a comment block above `benchSpecialists`, in the style `mvpSeries.ts` already uses.

- [ ] **Step 4: Run the full suite**

Run: `npm test`
Expected: PASS, including untouched `balance.test.ts` and `mvpSeries.test.ts`.

- [ ] **Step 5: Commit**

```bash
git add src/simulation/seasonBalance.test.ts src/content/season.ts
git commit -m "test(balance): hold the season roster and escalation to measured bands"
```

---

### Task 7: Runtime wiring and test-API migration

**Files:**
- Modify: `src/main.ts`, `scripts/record-review-clips.ts`, `tests/combat-visuals.spec.ts`, `tests/smoke.spec.ts`, `tests/decision-panel.spec.ts`

**Interfaces:**
- Consumes: Task 5's season commands.
- Produces: dev API `getSeasonState()`, `getActiveSeriesState(): SeriesState | null`, `startNextSeries()`, `continueSeason()`, `rematchSeason()`; `assign`/`unassign`/`confirm`/`advanceTicks`/`startNextBout` keep their meaning inside the active series. `getState()` and `rematch()` are **removed**.

- [ ] **Step 1: Rewrite the runtime state holder**

`main.ts` holds `let season: SeasonState = createSeason({ seed: resolveSeasonSeed(url), roster: SEASON_ROSTER, challenges: SEASON_CHALLENGES, combatStyles: COMBAT_STYLES })`. Rename `resolveSeriesSeed` to `resolveSeasonSeed` and leave its body exactly as it is — a valid `?seed` wins, otherwise a random uint32 is generated and written into the URL (`main.ts:449-457`). Do not make `BASELINE_TEST_SEED` a product default.

- [ ] **Step 2: Route the screens**

The render step picks by `season.phase`: `season-board` and `season-summary` go to `SeasonView` (Task 8), `series` keeps today's `SeriesView` path reading `season.activeSeries`. The tick accumulator only advances while `season.activeSeries?.phase === 'fighting'`.

- [ ] **Step 3: Replace the dev API surface**

Keep the whole surface inside the existing `import.meta.env.DEV` guard. Every command wraps the season equivalent and writes the result back, exactly as `applyCommand` does today.

- [ ] **Step 4: Migrate every caller**

In `tests/combat-visuals.spec.ts`, `startBoutZeroWith` gains one line before its `assign` calls:

```ts
      window.__GLADIATOR_TEST__.startNextSeries()
```

Leave the hardcoded `['brutus', 'aquila', 'nerva']` list alone — it is what keeps the frozen key poses on their original pairing. Apply the same one-line addition in `tests/smoke.spec.ts`, `tests/decision-panel.spec.ts`, and `scripts/record-review-clips.ts`, and replace every `getState()` with `getActiveSeriesState()` and every `rematch()` with `rematchSeason()` where the intent was restarting.

- [ ] **Step 5: Run e2e WITHOUT updating snapshots**

Run: `npm run test:e2e`
Expected: the five key-pose baselines still match exactly — this is the proof the kernel did not move. `planning.png` fails; that is expected and is fixed in Task 9. If any key-pose baseline fails, stop and find the cause; do not regenerate it.

- [ ] **Step 6: Commit**

```bash
git add src/main.ts scripts/record-review-clips.ts tests/combat-visuals.spec.ts tests/smoke.spec.ts tests/decision-panel.spec.ts
git commit -m "feat(runtime): run the season loop and migrate the dev test API"
```

---

### Task 8: Season board and cost telegraph

**Files:**
- Create: `src/presentation/SeasonView.ts`
- Modify: `src/presentation/SeriesView.ts`, `src/style.css`

**Interfaces:**
- Consumes: `SeasonState`, `RosterEntry`, `ConditionDelta`, `ChallengeDefinition`, and `startingHpFor` for display only.
- Produces: `class SeasonView { constructor(host: HTMLElement); render(state: SeasonState): void; }` plus the DOM hooks `data-testid="season-board"`, `season-roster-card`, `season-challenge-card`, `condition-badge`, `condition-delta`, `start-series`, `season-summary`, `rematch-season`.

No rule may be computed here. Conditions, starting HP and deltas all arrive on the state; `SeasonView` formats them.

- [ ] **Step 1: Render the board**

Three challenge cards in play order with each opponent's **actual scaled** `maxHp`/`power` and the featured threat, current one highlighted; five roster cards with name, style, condition badge, starting HP now, and the telegraph line — `Fight: → bruised, or wounded on a loss` / `Rest: wounded → bruised`; season score; `Start series N`.

- [ ] **Step 2: Render deltas between series**

When `state.lastDeltas` is non-empty, each affected roster card shows `before → after` with its cause, so the player sees the price of the series just played before committing the next lineup.

- [ ] **Step 3: Render the season summary**

Nine outcomes grouped by series (forfeits rendered as forfeits, not as bouts), final score, per-gladiator `boutsFought` and final condition, `Rematch season`.

- [ ] **Step 4: Extend the planning screen**

`SeriesView` planning cards gain the condition badge, starting HP, and the same telegraph. Cards for gladiators the season did not pass through are simply absent — the season only hands over fightable ones — so add an explicit disabled row listing broken gladiators with the reason, driven by data the season passes to the view. When fewer than three are fightable, the screen states that uncovered slots will be forfeited.

- [ ] **Step 5: Style it**

`src/style.css` gains the board grid, roster/challenge cards, badges, delta rows and disabled styling. Verify at the e2e viewport (1280×820) and at a narrow width that the board does not clip and the arena is never occluded.

- [ ] **Step 6: Check it by hand**

Run: `npm run dev`, then walk one full season. Confirm each card's telegraph matches what actually happens after the series.

- [ ] **Step 7: Commit**

```bash
git add src/presentation/SeasonView.ts src/presentation/SeriesView.ts src/style.css
git commit -m "feat(presentation): add the season board and telegraph the cost of a bout"
```

---

### Task 9: End-to-end acceptance and documentation

**Files:**
- Create: `tests/season.spec.ts`
- Modify: `README.md`, `AGENTS.md`, `tests/__screenshots__/{win32,linux}/planning.png`, `tests/__screenshots__/{win32,linux}/season-board.png`

**Interfaces:**
- Consumes: everything above.
- Produces: no code exports.

- [ ] **Step 1: Write the e2e spec**

Four tests, all at `/?seed=20260815&snapshot`:

1. a full season — drive three series through `startNextSeries`/`assign`/`confirm`/`advanceTicks`/`startNextBout`/`continueSeason`, asserting nine outcomes and a season summary;
2. a gladiator driven to `broken` cannot be assigned, and the planning screen says why;
3. a short-handed series — force conditions through repeated hard bouts, confirm with fewer than three, and assert the forfeited slot appears in the summary and the season still completes;
4. the season-board screenshot baseline.

- [ ] **Step 2: Run e2e without updating snapshots**

Run: `npm run test:e2e`
Expected: the five key-pose baselines pass untouched; `planning.png` and `season-board.png` fail as missing/changed.

- [ ] **Step 3: Regenerate exactly the two intended baselines**

```bash
npx playwright test tests/smoke.spec.ts tests/season.spec.ts --update-snapshots
```

Then open both regenerated PNGs and look at them: five readable roster cards, condition badges present, no clipped text, arena unobstructed. Reject any incidental change to interstitial or summary screens.

- [ ] **Step 4: Refresh the Linux baselines CI compares against**

```bash
git archive HEAD | tar -x -C /tmp/shots
docker run --rm -v /tmp/shots:/work -w /work mcr.microsoft.com/playwright:v1.62.1-noble \
  bash -lc "npm ci && npm run build && npx playwright test --update-snapshots"
cp /tmp/shots/tests/__screenshots__/linux/planning.png /tmp/shots/tests/__screenshots__/linux/season-board.png tests/__screenshots__/linux/
```

Copy only those two files. Any other Linux baseline that changed is a regression to investigate, not to accept.

- [ ] **Step 5: Update the docs**

`README.md`: replace the single-series description with the season loop — three series, five gladiators, the condition ladder and its exact ratios, rest recovery, forfeits, and that `?seed` reproduces a whole season. Update the dev-API list. `AGENTS.md`: note that `simulation/season.ts` owns condition and that `presentation/` must not compute it.

- [ ] **Step 6: Run the full official check**

Run: `npm run check`
Expected: PASS end to end.

- [ ] **Step 7: Commit**

```bash
git add tests/season.spec.ts tests/__screenshots__/win32/planning.png tests/__screenshots__/win32/season-board.png tests/__screenshots__/linux/planning.png tests/__screenshots__/linux/season-board.png README.md AGENTS.md
git commit -m "test(e2e): verify the season loop end to end"
```

---

## Self-Review

**Spec coverage.** Condition ladder → Task 1. Starting HP plumbing → Task 2. Forfeit rule, slot/outcome unions → Task 3. Determinism and seeds, roster and challenge content → Task 4. Season structure, data model, error handling, invariants → Task 5. Balance acceptance (all five criteria) → Task 6. Dev API and test migration → Task 7. UI and telegraphing → Task 8. Automated verification and docs → Task 9. Non-goals need no task; "Rejected for this slice" is deliberately unimplemented.

**Type consistency.** `BoutOutcome`, `PlanningSlot`, `SeriesSlot`, `ConditionDelta`, `SeriesRecord`, `SeasonConfig`, `SeasonState`, `ChallengeDefinition`, `RosterEntry` are each declared once (Tasks 3 and 5) and referenced with the same names afterwards. `startingHpFor(condition, maxHp)`, `conditionAfterBout(condition, wear)`, `conditionAfterRest(condition)` and `deriveSeriesSeed(seasonSeed, seriesIndex)` keep their Task 1/4 signatures throughout.

**Known ordering constraint.** Task 4's content imports `ChallengeDefinition` from Task 5's module. Either land Task 5 first, or declare that one interface at the top of `season.ts` while doing Task 4 — Step 5 of Task 4 says so explicitly.

**Risk carried into execution.** Task 6 is the only task whose numbers are not knowable in advance; if the five criteria cannot all be met by tuning the two bench specialists, the escalation vectors are the second lever, and the ladder ratios the third. Never the calibrated six.
