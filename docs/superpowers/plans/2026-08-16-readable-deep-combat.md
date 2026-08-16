# Readable Deep Combat Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the shallow stop-and-trade duel with deterministic, readable, movement-rich combat while preserving the existing three-bout series and laying a structurally verified foundation for future free-for-all encounters of up to 100 full-fidelity combatants.

**Architecture:** Build a collection-first pure-TypeScript encounter kernel whose state is keyed by stable combatant IDs and whose tick returns bounded event batches. Keep `battle.ts` as the two-combatant adapter used by the existing series. Presentation consumes state and events through procedural rigs, data-driven poses, stable camera framing, and optional synthesized audio; it never decides combat outcomes. Implement simulation first, lock determinism/capacity/balance, then replace presentation in independent reviewable slices.

**Tech Stack:** TypeScript 5.8, Vitest 3, Three.js 0.179, Vite 7, Playwright 1.54, Web Audio API, npm.

## Global Constraints

- The normative behavior is [the approved combat design](../specs/2026-08-16-readable-deep-combat-design.md). This plan fixes implementation order and interfaces; where a numeric rule is omitted from a code excerpt, the design's authored value remains mandatory.
- `src/simulation/**` stays deterministic and imports no DOM, Three.js, Web Audio, presentation, or content module.
- Simulation uses no `Math.random`, clock, Web Crypto, runtime trigonometry, `Math.pow`, or `Math.hypot`. `Math.sqrt`, integer arithmetic, `Math.imul`, and authored dot thresholds are allowed.
- All rule iteration uses sorted `CombatantId`; object/record insertion order never decides behavior.
- Hostility supports `free-for-all`, `different-factions`, and symmetric `relation-table` data with allied/neutral/hostile relations; no mode is hard-coded into action logic.
- Encounter state contains no event-history array, spatial hash, `Map`, Three.js object, function, or audio object. It must remain `structuredClone`-safe plain data.
- The playable mode remains the current 1v1 school series. The 100-combatant FFA is headless acceptance coverage, not a new player-facing mode.
- Keep exact fixed-step semantics at 60 ticks/second. Render interpolation and presentation-only impact holds never feed back into simulation.
- One player hypothesis per PR: “Readable movement, anticipation, defense, and recovery make automated gladiator combat understandable and worth watching.”
- Use `npm test` after simulation work, the narrowest relevant Playwright command after rendering work, and a fresh `npm run check` before handoff.
- Do not stage the existing untracked review files. Every commit command below names only task-owned paths.
- If allowed fighter/action tuning cannot satisfy the fixed balance bands, stop with the measured distributions. Do not weaken tests or change cohort seeds.

## File Structure

### Existing files to modify

- `src/simulation/fighters.ts` — fighter schema, archetype matchup, validation.
- `src/simulation/random.ts` — labelled streams and deterministic derived values.
- `src/simulation/battle.ts` — duel descriptor/adapter and complete small-duel log.
- `src/simulation/series.ts` — existing three-bout flow and duel mapping.
- `src/content/mvpSeries.ts` — six final fighter rows.
- `src/presentation/ArenaView.ts` — scene owner and encounter-state/event synchronization.
- `src/presentation/battleFeed.ts` — expanded ID-based event formatting.
- `src/presentation/SeriesView.ts` — stat labels and sound intent/control.
- `src/main.ts` — fixed-tick interpolation snapshots and presentation/audio lifecycle.
- `src/style.css`, `tests/smoke.spec.ts`, `README.md`, `package.json`.

### New simulation/content files

- `src/simulation/spatialHash.ts` / `.test.ts` — transient uniform grid, queries, canonical pair counters.
- `src/simulation/movement.ts` / `.test.ts` — `Vec2`, intent displacement, facing, bounds, policies, three-pass separation.
- `src/simulation/combatActions.ts` / `.test.ts` — action state, phase transitions, contact math, stagger matrix.
- `src/simulation/combatDecision.ts` / `.test.ts` — targeting, context, weighted decisions, batched defenses, policy seam.
- `src/simulation/encounter.ts` / `.test.ts` — IDs, hostility, state creation, 12-phase tick, events, completion, hashes.
- `src/simulation/encounterCapacity.test.ts` — 100-actor and structural mass-foundation fixtures.
- `src/simulation/balance.test.ts` — fixed roster and equal-stat statistical cohorts.
- `src/testSupport/combatFixtures.ts` — test-only plain fixture builders used by simulation tests and benchmark; it may compose simulation contracts with content while production simulation may not.
- `src/content/combatStyles.ts` / `.test.ts` — immutable locomotion/action/decision catalog.
- `scripts/benchmark-encounter.ts` — informational fixed 100-combatant benchmark.

### New presentation files

- `src/presentation/ProceduralFighter.ts` / `.test.ts` — shared semantic humanoid hierarchy and equipment.
- `src/presentation/poses/combatPoses.ts` / `.test.ts` — immutable style/action/reaction poses.
- `src/presentation/PoseController.ts` / `.test.ts` — layered pose sampling, gait, grounding, capped arm IK.
- `src/presentation/ArenaCamera.ts` / `.test.ts` — horizontal target-array framing, dead zones, damping, reset.
- `src/presentation/CombatAudio.ts` / `.test.ts` — replaceable audio backend, cue mapping, voice/speed/lifecycle rules.
- `tests/combat-visuals.spec.ts` and intentional screenshot baselines — deterministic key-pose and lifecycle coverage.
- `docs/reviews/2026-08-16-readable-deep-combat-human-review.md` — filled human-review evidence template.

---

### Task 1: Migrate Fighter Data Without Breaking the Series Shell

**Files:**
- Modify: `src/simulation/fighters.ts`
- Modify: `src/simulation/fighters.test.ts`
- Modify: `src/simulation/battle.ts`
- Modify: `src/simulation/battle.test.ts`
- Modify: `src/simulation/series.test.ts`
- Modify: `src/content/mvpSeries.ts`
- Modify: `src/content/mvpSeries.test.ts`
- Modify: `src/presentation/SeriesView.ts`
- Modify: `src/style.css`

**Interfaces:**
- Produces final `FighterDefinition` field names and strict validation.
- Temporarily leaves the old instantaneous loop in `battle.ts` behind a clearly named private legacy cadence map; Task 11 deletes that loop rather than extending it.

- [ ] **Step 1: Write failing fighter-schema tests**

```ts
const valid: FighterDefinition = {
  id: 'brutus', name: 'Brutus', school: 'House of Mars', archetype: 'heavy',
  maxHp: 170, power: 22, accuracy: 0.86, defenseChance: 0.34, criticalChance: 0.10,
}

expect(validateFighterDefinition(valid)).toBe(valid)
expect(() => validateFighterDefinition({ ...valid, power: Number.NaN })).toThrow('power')
expect(() => validateFighterDefinition({ ...valid, accuracy: 1.01 })).toThrow('accuracy')
expect(() => validateFighterDefinition({ ...valid, maxHp: 0 })).toThrow('maxHp')
```

Run: `npx vitest run src/simulation/fighters.test.ts`

Expected: FAIL because `power`, `defenseChance`, and validation do not exist.

- [ ] **Step 2: Replace the fighter schema and matchup multipliers**

```ts
export interface FighterDefinition {
  id: string
  name: string
  school: string
  archetype: Archetype
  maxHp: number
  power: number
  accuracy: number
  defenseChance: number
  criticalChance: number
}

const DAMAGE_MULTIPLIERS: Record<MatchupComparison, number> = {
  advantage: 1.10,
  neutral: 1,
  disadvantage: 0.90,
}

export function validateFighterDefinition(definition: FighterDefinition): FighterDefinition
```

Require non-empty IDs/names/schools, positive finite integer `maxHp`, positive finite `power`, and probabilities in `0..1`. Keep `FighterSide` exported only because the series/UI adapter still uses it.

- [ ] **Step 3: Make the old battle loop compile through one private bridge**

In `battle.ts`, rename reads to `power` and `defenseChance`. Replace per-fighter cadence with one private exhaustive archetype map:

```ts
const LEGACY_ATTACK_INTERVAL_TICKS: Record<Archetype, number> = {
  heavy: 54,
  fast: 38,
  technical: 44,
}
```

Use it only in the old loop and mark the constant with a comment that Task 11 removes it. Do not expose it or add it to content/state.

- [ ] **Step 4: Update fixtures without asserting obsolete combat balance**

Change all fighter literals to `power`/`defenseChance`; remove assertions tied to instantaneous attack cadence and the old `840..1800` window. Retain tests for planning commands, three results, score consistency, rematch, deterministic winner, terminal reason, and event order until their encounter-backed replacements land.

- [ ] **Step 5: Put the approved initial fighter rows into content**

Use exactly: Brutus `170/22/.86/.34/.10`, Aquila `120/16/.84/.31/.14`, Nerva `165/20/.92/.40/.16`, Drusus `185/21/.90/.36/.15`, Cassius `160/19/.90/.38/.12`, Magnus `145/18/.78/.32/.06`. Delete `TARGET_MIN_BOUT_TICKS` and `TARGET_MAX_BOUT_TICKS`; statistical acceptance belongs to Task 13.

- [ ] **Step 6: Migrate planning-card labels with the schema**

In `SeriesView.ts`, replace every `damage`/`attackIntervalTicks` read with `power`/`defenseChance`. Planning and opponent cards show `Power` and `Defense` while retaining HP, Accuracy, Critical, and the counter rule. Remove obsolete DMG/interval markup and CSS now so no presentation consumer retains the deleted schema.

- [ ] **Step 7: Verify and commit**

Run: `npm test`

Expected: PASS with the existing series still playable through the temporary adapter.

Run: `npm run build`

Expected: PASS, proving all non-test consumers compile against the new fighter schema.

```bash
git add src/simulation/fighters.ts src/simulation/fighters.test.ts src/simulation/battle.ts src/simulation/battle.test.ts src/simulation/series.test.ts src/content/mvpSeries.ts src/content/mvpSeries.test.ts src/presentation/SeriesView.ts src/style.css
git commit -m "refactor: migrate fighter combat attributes"
```

---

### Task 2: Lock Labelled Random Streams and Canonical Trace Hashing

**Files:**
- Modify: `src/simulation/random.ts`
- Modify: `src/simulation/random.test.ts`

**Interfaces:**
- Produces actor-local stream creation, fixed two-roll helpers, derived tie values, and diagnostic FNV-1a folding.
- Preserves `deriveBoutSeed` for series integration; deletes `deriveSideSeed` after Task 11 removes its final caller.

- [ ] **Step 1: Write failing stream-independence tests**

```ts
const streams = createCombatantRandomState(20260815, 'home.brutus')
expect(streams).toEqual(createCombatantRandomState(20260815, 'home.brutus'))
expect(streams.decision).not.toEqual(streams.defense)
expect(streams.defense).not.toEqual(streams.contact)

const [decisionRolls, nextDecision] = drawPair(streams.decision)
expect(decisionRolls).toHaveProperty('first')
expect(nextDecision).toEqual(nextRandom(nextRandom(streams.decision)[1])[1])
expect(derivedUnitValue(7, 'tick:19:actor:3')).toBe(0.5615094522945583)
expect(formatTraceHash(foldTraceHash(0x811c9dc5, 'combat'))).toBe('1ce36e21')
```

`derivedUnitValue(seed, label)` is exactly `nextRandom(createRandom(deriveSeed(seed, label)))[0]`: one derivation and one draw. `foldTraceHash` applies FNV-1a to each UTF-16 code unit with `Math.imul` and unsigned 32-bit normalization; `formatTraceHash` returns eight lowercase hexadecimal digits.

Run: `npx vitest run src/simulation/random.test.ts`

Expected: FAIL on missing APIs.

- [ ] **Step 2: Implement labelled streams and direct derived values**

```ts
export interface CombatantRandomState {
  decision: RandomState
  defense: RandomState
  contact: RandomState
}

export function createCombatantRandomState(seed: number, combatantId: string): CombatantRandomState {
  return {
    decision: createRandom(deriveSeed(seed, `${combatantId}:decision`)),
    defense: createRandom(deriveSeed(seed, `${combatantId}:defense`)),
    contact: createRandom(deriveSeed(seed, `${combatantId}:contact`)),
  }
}

export function drawPair(state: RandomState): readonly [
  { first: number; second: number },
  RandomState,
]

export function derivedUnitValue(seed: number, label: string): number
export function foldTraceHash(hash: number, canonicalPart: string): number
export function formatTraceHash(hash: number): string
```

`derivedUnitValue` derives and draws without mutating a stream. Contact priority and time-limit ties will use it; never use a random comparator.

- [ ] **Step 3: Verify and commit**

Run: `npx vitest run src/simulation/random.test.ts`

Expected: PASS.

```bash
git add src/simulation/random.ts src/simulation/random.test.ts
git commit -m "feat: add combatant-local deterministic streams"
```

---

### Task 3: Add the Transient Spatial Hash

**Files:**
- Create: `src/simulation/spatialHash.ts`
- Create: `src/simulation/spatialHash.test.ts`

**Interfaces:**
- Consumes sorted plain `{ id, position }` entries.
- Produces deterministic radius queries and canonical neighboring pairs with structural candidate counts.
- The index is transient and never becomes encounter state.

- [ ] **Step 1: Write failing order/query/pair tests**

```ts
const entries = [
  { id: 'c', position: { x: 5.0, z: 0 } },
  { id: 'a', position: { x: 0, z: 0 } },
  { id: 'b', position: { x: 2.9, z: 0 } },
]
const index = buildSpatialHash(entries, 3.2)
expect(queryRadius(index, { x: 0, z: 0 }, 3.2)).toEqual(['a', 'b'])
expect(collectCanonicalNeighborPairs(index)).toEqual({
  pairKeys: ['a|b', 'b|c'],
  candidateChecks: 3,
})
expect(buildSpatialHash([...entries].reverse(), 3.2)).toEqual(index)
```

> **Amendment (2026-08-16, approved by the plan owner during execution):** `c` was authored at `x = 6.4`, which is unreachable under the design's normative broad phase. The design fixes candidate pairs as those "returned from the same or adjacent occupied cells" (design § Spatial index, targeting, and separation). At `x = 6.4` the entry falls in cell `2` while `a`/`b` share cell `0`, so `b|c` (3.5 units apart, further than one cell) can only be produced by widening the scan to a two-cell ring — which raises the sparse 10×10 separation pass to 918 candidate checks and breaks the design's binding `< 800` mass-foundation bound (design § Mass-foundation acceptance). Moving `c` to `x = 5.0` places it in cell `1`, adjacent to cell `0`, and reproduces every asserted value above — `['a', 'b']`, `['a|b', 'b|c']`, and `3` — under the normative one-cell-ring rule, which then costs only 342 checks on the sparse fixture. The rule, not the asserted counts, is normative; only the authored coordinate changed.

Add negative-coordinate cell-key tests, duplicate-ID rejection, radius crossing more than adjacent cells, and pair uniqueness.

Run: `npx vitest run src/simulation/spatialHash.test.ts`

Expected: FAIL because the module does not exist.

- [ ] **Step 2: Implement the uniform grid**

```ts
export interface SpatialEntry { id: string; position: Readonly<Vec2> }
export interface SpatialHash {
  readonly cellSize: number
  readonly cells: Readonly<Record<string, readonly SpatialEntry[]>>
}

export function spatialCellKey(position: Readonly<Vec2>, cellSize: number): string
export function buildSpatialHash(entries: readonly SpatialEntry[], cellSize?: number): SpatialHash
export function queryRadius(index: SpatialHash, center: Readonly<Vec2>, radius: number): readonly string[]
export function collectCanonicalNeighborPairs(index: SpatialHash): {
  pairKeys: readonly string[]
  candidateChecks: number
}
```

Use `Math.floor`, default cell size `3.2`, lexicographically sorted IDs/cell keys/pair keys, squared-distance filtering for radius queries, and a `Set` only as transient local implementation state. `collectCanonicalNeighborPairs` examines only the same and directly adjacent occupied cells — a one-cell ring — and returns the examined pairs whose squared distance is within `cellSize`. `candidateChecks` counts each examined unordered pair exactly once.

- [ ] **Step 3: Verify and commit**

Run: `npx vitest run src/simulation/spatialHash.test.ts`

Expected: PASS.

```bash
git add src/simulation/spatialHash.ts src/simulation/spatialHash.test.ts
git commit -m "feat: add deterministic combat spatial hash"
```

---

### Task 4: Implement Simultaneous Movement and Three-Pass Separation

**Files:**
- Create: `src/simulation/movement.ts`
- Create: `src/simulation/movement.test.ts`
- Modify: `src/simulation/architecture.test.ts`

**Interfaces:**
- Owns `Vec2`, `CombatArenaDefinition`, `LocomotionIntent`, movement profiles, facing, arena clamps, ordered-pair policy, and fixed-pass separation.
- Returns actual positions/velocities/travel rather than mutating combatants.

- [ ] **Step 1: Write failing vector, intent, and policy tests**

```ts
expect(normalizeVec2({ x: 3, z: 4 })).toEqual({ x: 0.6, z: 0.8 })
expect(intentDisplacement('advance', heavyProfile, { x: 1, z: 0 }, 60)).toEqual({ x: 1.4 / 60, z: 0 })
expect(intentDisplacement('retreat', fastProfile, { x: 1, z: 0 }, 60)).toEqual({ x: -2.7 / 60, z: 0 })
const turned = turnFacing({ x: 1, z: 0 }, { x: 0, z: 1 }, technicalTurn)
expect(turned.x).toBeCloseTo(0.9989705698, 9)
expect(turned.z).toBeCloseTo(0.0453629881, 9)
```

Add tests for all nine intents, circle perpendiculars, radius/lateral clamps, ordered-pair non-crossing, input-order independence, minimum `0.9` separation, exactly three passes, actual post-constraint velocity, and travelled-distance accumulation. For exact-opposite facing, assert deterministic left turn on the first tick and convergence inside the target arc after repeated ticks. For 90° and 170° errors, assert each unconverged step has the same authored before/after dot, proving constant angular speed without runtime trigonometry.

Run: `npx vitest run src/simulation/movement.test.ts`

Expected: FAIL because the module does not exist.

- [ ] **Step 2: Implement plain movement contracts**

```ts
export interface Vec2 { x: number; z: number }
export type LocomotionIntent =
  | 'hold-range' | 'advance' | 'retreat' | 'circle-left' | 'circle-right'
  | 'burst-in' | 'backstep' | 'disengage' | 'pressure'

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

export interface TurnStep {
  cos: number
  sin: number
}

export function turnFacing(current: Readonly<Vec2>, desired: Readonly<Vec2>, step: Readonly<TurnStep>): Vec2

export function resolveSimultaneousMovement(
  requests: readonly MovementRequest[],
  arena: Readonly<CombatArenaDefinition>,
): { positions: Readonly<Record<string, Vec2>>; separationPasses: 3; candidateChecksByPass: readonly number[] }
```

Intent-to-profile mapping is explicit: `advance` and `pressure` use forward speed; `retreat`, `backstep`, and `disengage` use backward speed; `circle-left/right` use lateral speed; `burst-in` uses burst speed; `hold-range` is zero. Action root travel and Fast's defense dash are separate authored motion and do not use this mapping.

`turnFacing` compares dot with the authored cosine, snaps when already inside one step, otherwise rotates with the authored sine/cosine matrix in the sign of cross product. Exact opposite (`cross === 0 && dot < 0`) turns left. Normalize the output to contain literal-rounding drift; never call runtime trig.

Compute all desired displacement from one snapshot, clamp, then rebuild the spatial hash and solve canonical pairs once in each of exactly three passes. Split correction evenly unless one side is boundary-constrained; apply ordered-pair projection after every pass. Never scan every combatant pair directly.

- [ ] **Step 3: Extend architecture bans**

Have `architecture.test.ts` scan `src/simulation/*.ts` excluding tests and reject DOM/Three/audio/content/presentation imports plus forbidden random/time/trigonometric calls. Include `Math.pow` and `Math.hypot` in the banned list.

- [ ] **Step 4: Verify and commit**

Run: `npx vitest run src/simulation/movement.test.ts src/simulation/spatialHash.test.ts src/simulation/architecture.test.ts`

Expected: PASS.

```bash
git add src/simulation/movement.ts src/simulation/movement.test.ts src/simulation/architecture.test.ts
git commit -m "feat: add deterministic arena movement"
```

---

### Task 5: Author the Immutable Combat Style and Action Catalog

**Files:**
- Create: `src/content/combatStyles.ts`
- Create: `src/content/combatStyles.test.ts`
- Create: `src/simulation/combatActions.ts`
- Create: `src/simulation/combatActions.test.ts`

**Interfaces:**
- Simulation exports action/style data types and validation; content supplies plain immutable values.
- Simulation modules receive `CombatStyleCatalog` by dependency injection and never import `src/content`.

- [ ] **Step 1: Write failing catalog-validation tests**

```ts
expect(validateCombatStyleCatalog(COMBAT_STYLES, DUEL_ARENA)).toBe(COMBAT_STYLES)
expect(COMBAT_STYLES.styles.heavy.attackActionIds).toEqual(['heavy-shield-jab', 'heavy-cleave'])
expect(COMBAT_STYLES.styles.fast.locomotion.burstUnitsPerSecond).toBe(4)
expect(COMBAT_STYLES.styles.technical.preferredRange).toEqual({ min: 2.1, max: 2.8 })
expect(() => validateCombatStyleCatalog(
  replaceAction(COMBAT_STYLES, 'heavy-cleave', { minimumFacingDot: 2 }),
  DUEL_ARENA,
)).toThrow('minimumFacingDot')
```

Cover every exact action row, every defense row, style movement speeds/turn pairs, base weights, duplicate/unknown IDs, finite numeric fields, positive integer phase ticks, range ordering, burst reach, dot bounds, turn-pair unit length, arena minimum separation, and Technical reaction-lead compatibility with every `parryable` attack. Validate that only Fast evade defines `evadeDisplacement`, its min/max are ordered and non-negative, and every `baseWeights` key is a valid locomotion or style attack ID.

Run: `npx vitest run src/content/combatStyles.test.ts`

Expected: FAIL because catalog/contracts do not exist.

- [ ] **Step 2: Define action and style contracts in simulation**

```ts
export type AttackActionId =
  | 'heavy-shield-jab' | 'heavy-cleave' | 'fast-slash' | 'fast-burst-lunge'
  | 'technical-thrust' | 'technical-driving-thrust' | 'technical-parry-counter'
export type DefenseActionId = 'heavy-guard' | 'fast-evade' | 'technical-parry'
export type CombatActionId = AttackActionId | DefenseActionId
export type CombatActionPhase = 'windup' | 'contact' | 'impact' | 'recovery'

export interface AttackActionDefinition {
  id: AttackActionId
  tags: readonly string[]
  contactRange: Readonly<{ min: number; max: number }>
  startMaxRange?: number
  minimumFacingDot: number
  windupTicks: number
  impactTicks: number
  recoveryTicks: number
  damageMultiplier: number
  accuracyModifier: number
  rootTravel: number
  pushDistance: number
  staggerTicks: number
  contactPriority: number
}

export interface DefenseActionDefinition {
  id: DefenseActionId
  tags: readonly ['defense']
  minimumReactionLeadTicks: number
  impactTicks: number
  recoveryTicks: number
  minimumIncomingFacingDot?: number
  evadeDisplacement?: Readonly<{ min: number; max: number }>
}

export interface LocomotionProfile {
  forwardUnitsPerSecond: number
  backwardUnitsPerSecond: number
  lateralUnitsPerSecond: number
  burstUnitsPerSecond: number
  turnCosPerTick: number
  turnSinPerTick: number
}

export interface CombatStyleDefinition {
  archetype: Archetype
  locomotion: Readonly<LocomotionProfile>
  preferredRange: Readonly<{ min: number; max: number }>
  attackActionIds: readonly AttackActionId[]
  defenseActionId: DefenseActionId
  baseWeights: Readonly<Partial<Record<LocomotionIntent | AttackActionId, number>>>
}

export interface CombatStyleCatalog {
  styles: Readonly<Record<Archetype, CombatStyleDefinition>>
  attacks: Readonly<Record<AttackActionId, AttackActionDefinition>>
  defenses: Readonly<Record<DefenseActionId, DefenseActionDefinition>>
}
```

Also export `CombatActionState`, `ReactionRecord`, phase transition helpers, action lookup, `actionContactTick`, and validation. Use exclusive `phaseEndsAtTick`; contact lasts exactly one tick.

- [ ] **Step 3: Author all exact data values**

Create `COMBAT_STYLES` with these exact attack rows, in field order `range, startMax, dot, windup, impact, recovery, damage, accuracy, rootTravel, push, stagger, priority`:

```text
heavy-shield-jab:          0.9..1.4,  —,   .5736, 14, 3, 20, .65, +.08, .25, .40, 12, 30; attack probe shield unparryable
heavy-cleave:              0.9..1.8,  —,   .6428, 34, 6, 34, 1.75, -.06, .45, .70, 24, 10; attack committed weapon parryable
fast-slash:                0.9..1.35, —,   .4226, 10, 2, 15, .75, +.06, .25, .18, 8, 40; attack probe weapon parryable
fast-burst-lunge:          0.9..1.45, 2.8, .8192, 18, 3, 24, 1.25, 0, 1.40, .35, 14, 30; attack committed burst weapon parryable
technical-thrust:          1.2..2.8,  —,   .9397, 20, 3, 22, 1.0, +.04, .20, .30, 12, 25; attack probe weapon parryable
technical-driving-thrust:  1.6..3.1,  —,   .9511, 30, 4, 30, 1.5, -.03, .50, .50, 20, 15; attack committed weapon parryable
technical-parry-counter:   0.9..2.3,  —,   .8660, 8, 4, 20, 1.1, +.12, .30, .40, 18, 50; attack forced counter weapon
```

Defense rows are Heavy guard lead/impact/recovery/dot `8/4/12/.3420`, Fast evade `7/3/14/no dot/evade 0.9..1.2`, Technical parry `10/4/16/-.1736`. Fast evade uses its own authored defense displacement distributed across the seven remaining windup ticks; it is deliberately independent of ordinary locomotion speed and remains constrained by arena/policy/separation.

Movement rows, in field order forward/back/lateral/burst/turn-cos/turn-sin, are Heavy `1.4/.9/.8/1.8/0.9993908270/0.0348994967`, Fast `2.4/2.7/2.1/4/0.9982398279/0.0593063736`, Technical `1.7/2/1.3/2.4/0.9989705698/0.0453629881`. These represent `2.0°`, `3.4°`, and `2.6°` per tick for documentation only; runtime uses the literals. Preferred ranges are Heavy `1.2..1.7`, Fast `2.4..3.0`, Technical `2.1..2.8`.

Base weights are Heavy: advance 12, hold 8, pressure 12, circles 2 each, retreat 0, jab 14, cleave 8; Fast: circles 12 each, hold 5, retreat 8, burst-in 14, slash 12, lunge 14; Technical: hold 12, backstep 12, circles 6 each, advance 6, thrust 14, driving thrust 8. Never convert degree annotations with runtime trigonometry.

Ordinary locomotion candidates are exactly the locomotion keys present in that style's `baseWeights`. An absent key means the style does not choose it ordinarily; a present zero weight means adjustments may make it selectable. Forced disengage/counter bypass this set. Validation rejects unknown keys and attack IDs not listed by the style.

- [ ] **Step 4: Test exact phase endpoints and base contact math**

```ts
const action = startAttackAction({ actorId: 'a', serial: 0, targetId: 'b', definition: COMBAT_STYLES.attacks['fast-slash'], tick: 20, attackRolls: { accuracy: 0.1, critical: 0.2 } })
expect(action).toMatchObject({ instanceId: 'a:0', phase: 'windup', phaseStartedTick: 20, phaseEndsAtTick: 30 })
expect(transitionActionPhase(action, 30)).toMatchObject({ phase: 'contact', phaseStartedTick: 30, phaseEndsAtTick: 31 })
```

Add semantic contact-point tests for weapon `0.60`, shield `0.65`, body `0.72`, and final damage rounding with matchup `1.10/1/.90`, critical `1.5`, guard damage `0.35`.

- [ ] **Step 5: Verify and commit**

Run: `npx vitest run src/content/combatStyles.test.ts src/simulation/combatActions.test.ts`

Expected: PASS.

```bash
git add src/content/combatStyles.ts src/content/combatStyles.test.ts src/simulation/combatActions.ts src/simulation/combatActions.test.ts
git commit -m "feat: define readable combat actions and styles"
```

---

### Task 6: Create the Collection-First Encounter State and Hostility Rules

**Files:**
- Create: `src/simulation/encounter.ts`
- Create: `src/simulation/encounter.test.ts`
- Create: `src/testSupport/combatFixtures.ts`

**Interfaces:**
- Produces sorted 2..100 combatant state, hostility queries, event batches, generic finish, and invariant checks.
- Initial tick support may keep fighters neutral; movement/actions integrate in Tasks 8–9.

- [ ] **Step 1: Write failing creation and hostility tests**

```ts
const transition = createEncounter({
  seed: 7,
  combatants: [combatant('b', 'red'), combatant('a', 'blue')],
  arena: freeArena,
  hostility: { mode: 'different-factions' },
  combatStyles: COMBAT_STYLES,
})
expect(transition.state.combatantIds).toEqual(['a', 'b'])
expect(transition.events).toEqual([{ id: 0, tick: 0, type: 'encounter-started', combatantIds: ['a', 'b'], factionIds: ['blue', 'red'], hostilityMode: 'different-factions' }])
expect(transition.state.nextEventId).toBe(1)
expect(transition.state.combatants.a.nextDecisionTick).toBe(1)
expect(transition.state.randomByCombatant.a).toBeDefined()
expect('events' in transition.state).toBe(false)
expect(structuredClone(transition.state)).toEqual(transition.state)
```

Test FFA regardless of factions, same/different factions, symmetric relation tables with default allied/neutral behavior, conflicting rows, invalid IDs containing `:`, duplicate IDs, invalid sizes 1/101, no initial hostile pair, bad ordered-pair references, and `structuredClone` equality.

Run: `npx vitest run src/simulation/encounter.test.ts`

Expected: FAIL because encounter state does not exist.

- [ ] **Step 2: Define stable encounter types**

```ts
export type CombatantId = string
export type FactionId = string
export type ActionInstanceId = string

export interface FighterCombatState {
  id: CombatantId
  factionId: FactionId
  definition: FighterDefinition
  targetId?: CombatantId
  position: Vec2
  facing: Vec2
  travelledDistance: number
  hp: number
  status: 'active' | 'defeated'
  locomotionIntent: LocomotionIntent
  velocity: Vec2
  action: CombatActionState
  staggerUntilTick: number
  nextDecisionTick: number
  nextActionSerial: number
  lastContactTick: number
  lastResolutionTick: number
  reactionLedger: readonly ReactionRecord[]
  forcedActionId?: AttackActionId
}

export interface EncounterTransition {
  state: EncounterState
  events: readonly EncounterEvent[]
}

export function createEncounter(config: EncounterConfig): EncounterTransition
export function areHostile(state: Pick<EncounterState, 'hostility' | 'combatants'>, firstId: CombatantId, secondId: CombatantId): boolean
export function finishEncounter(state: EncounterState, result: EncounterResult): EncounterTransition
export function assertEncounterInvariants(state: EncounterState): void
```

Use start facing toward the ordered opponent when supplied and the positive x-axis otherwise. Validate normalized finite facing, bounds, HP, sorted/unique IDs, random records, action serials, reaction ledger, and active/defeated consistency.

- [ ] **Step 3: Define the complete discriminated event union now**

Add the full discriminated union with these payloads:

```text
encounter-started: combatantIds, factionIds, hostilityMode
movement-intent-changed: combatantId, from, to
action-started: actorId, targetId, actionInstanceId, actionId, expectedContactTick
action-interrupted: actorId, actionInstanceId, actionId, reason(stagger|threat-canceled)
defense-started: defenderId, attackerId, incomingActionId, defenseActionId, expectedContactTick
defense-declined: defenderId, attackerId, incomingActionId, defenseActionId, expectedContactTick
defense-failed: defenderId, attackerId, incomingActionId, defenseActionId, reason(geometry|facing)
attack-missed: actorId, targetId, actionInstanceId, actionId, reason(target-unavailable|geometry|accuracy)
attack-evaded: actorId, targetId, actionInstanceId, actionId, evadeIntent
attack-blocked: actorId, targetId, actionInstanceId, actionId, contactZone(shield), contactPoint
attack-parried: actorId, defenderId, actionInstanceId, actionId, contactZone(weapon), contactPoint
critical-hit: actorId, targetId, actionInstanceId, actionId, multiplier
damage-dealt: actorId, targetId, actionInstanceId, actionId, amount, remainingHp, contactZone, contactPoint
fighter-staggered: combatantId, sourceId, actionInstanceId, durationTicks, direction
fighter-defeated: defeatedId, sourceId
encounter-finished: reason, durationTicks, survivorIds, winnerIds, winningFactionIds
```

Every variant also has `{ id, tick, type }`. Centralize monotonic emission in a tick-local emitter that returns the next ID; never add an event-log field to `EncounterState`.

- [ ] **Step 4: Implement generic no-hostile-pairs completion**

`finishEncounter` returns an exact finished state plus one `encounter-finished` event. `winnerIds` are all living survivors for `no-hostile-pairs`; `winningFactionIds` are sorted unique survivor factions. Advancing a finished encounter in later tasks must return the exact same state object and `[]` events.

- [ ] **Step 5: Verify and commit**

Run: `npx vitest run src/simulation/encounter.test.ts src/simulation/architecture.test.ts`

Expected: PASS.

```bash
git add src/simulation/encounter.ts src/simulation/encounter.test.ts src/testSupport/combatFixtures.ts
git commit -m "feat: add collection-first combat encounters"
```

---

### Task 7: Implement Targeting, Weighted Decisions, and Batched Reactions

**Files:**
- Create: `src/simulation/combatDecision.ts`
- Create: `src/simulation/combatDecision.test.ts`
- Modify: `src/simulation/combatActions.ts`
- Modify: `src/simulation/combatActions.test.ts`

**Interfaces:**
- Separates context construction, legal candidates, scoring, selection, action execution, and the future skill/perk modifier seam.
- Defense batching returns updated defender/random state and emitted start/failure metadata without mutating encounter state.

- [ ] **Step 1: Write failing target retention/acquisition tests**

```ts
expect(retainTarget(contextFor('self', 'near-hostile', 19.9))).toBe('near-hostile')
expect(retainTarget(contextFor('self', 'near-hostile', 20.01))).toBeUndefined()
expect(acquireNearestHostile(spatialFixture, 'self', 16)).toBe('a-equal-distance')
expect(acquireNearestHostile(spatialFixture, 'self', 15.9)).toBeUndefined()
```

Verify dead/allied/neutral invalidation, squared distance, lexicographic tie break, sorted nearby ally/neutral/hostile arrays, and no switching away from a valid retained target.

- [ ] **Step 2: Write the exact Heavy decision fixture**

At distance `2.0`, neutral matchup, center arena, no opening, pressure zero, assert legal candidates and pre-selection weights exactly:

```ts
expect(scoreCombatCandidates(context, COMBAT_STYLES.styles.heavy)).toEqual([
  { decision: { type: 'locomotion', locomotionIntent: 'advance' }, weight: 24 },
  { decision: { type: 'locomotion', locomotionIntent: 'pressure' }, weight: 24 },
  { decision: { type: 'locomotion', locomotionIntent: 'circle-left' }, weight: 2 },
  { decision: { type: 'locomotion', locomotionIntent: 'circle-right' }, weight: 2 },
  { decision: { type: 'action', actionId: 'heavy-cleave' }, weight: 19.11111111111111 },
])
```

Assert total approximately `71.11`; shield jab and zero-weight hold are absent. Add range reach, boundary `-20`, opening `+18/+6`, pressure `±8 × level`, matchup `+5/0/-5`, and all-zero deterministic fallback tests.

- [ ] **Step 3: Implement the pure decision APIs**

```ts
export type CombatDecision =
  | { type: 'locomotion'; locomotionIntent: LocomotionIntent }
  | { type: 'action'; actionId: AttackActionId }

export interface DecisionModifier {
  readonly id: string
  adjustCandidate(input: Readonly<{ context: CombatDecisionContext; decision: CombatDecision; weight: number }>): number
}

export function buildCombatDecisionContext(input: Readonly<{
  tick: number
  selfId: CombatantId
  targetId: CombatantId
  combatants: Readonly<Record<CombatantId, FighterCombatState>>
  hostility: HostilityDefinition
  arena: CombatArenaDefinition
  nearbyIds: readonly CombatantId[]
}>): CombatDecisionContext
export function scoreCombatCandidates(context: CombatDecisionContext, style: CombatStyleDefinition, modifiers?: readonly DecisionModifier[]): readonly ScoredCombatDecision[]
export function chooseCombatDecision(context: CombatDecisionContext, style: CombatStyleDefinition, rolls: { selection: number; interval: number }, modifiers?: readonly DecisionModifier[]): CombatDecision
export function decisionIntervalTicks(archetype: Archetype, intervalRoll: number): number
```

Default `modifiers = []`. This is the only skill/perk seam in the slice; do not add a `combatSkill` field, perk registry, or presentation behavior yet. A later `combatSkill` may reduce deterministic decision error or improve reaction selection through this simulation-owned policy boundary. Each ordinary decision consumes exactly two decision-stream values even with one candidate.

- [ ] **Step 4: Implement anti-stall and forced behavior**

Test and implement pressure levels `0` through tick 180, then `1..3` in 60-tick steps capped at 3; suppress retreat/backstep/circles/disengage at a local 300-tick resolution gap. Fast forced disengage ends at 2.4 units or 30 ticks. Technical forced parry counter starts next tick only within 2.3 units, else clears to advance/hold.

- [ ] **Step 5: Write failing five-threat defense tests**

Create five simultaneous incoming windups for one defender. Assert sorted threat order, ten defense draws consumed, five ledger entries, at most one `defense-started`, and outcomes for busy/staggered/unparryable opportunities. Fix Technical's `fast-slash` boundary at exactly ten ticks.

- [ ] **Step 6: Implement reaction batches**

```ts
export interface DefenseBatchResult {
  defender: FighterCombatState
  random: RandomState
  events: readonly EncounterEventPayload[]
}

export function processDefenseBatch(input: Readonly<{
  tick: number
  defender: FighterCombatState
  threats: readonly IncomingThreat[]
  random: RandomState
  combatants: Readonly<Record<CombatantId, FighterCombatState>>
  combatStyles: CombatStyleCatalog
}>): DefenseBatchResult
```

Sort by contact tick, committed/counter before probe, descending `attacker.power × damageMultiplier`, then action instance ID. Consume `success` and `direction` for every opportunity, record all outcomes, schedule the first eligible successful defense only, and bind it with `reactingToActionId`. Use defense chance plus comparison `+.05/0/-.05` plus telegraph `0/.05/.10`, clamped `0..0.95`. An eligible failed roll emits `defense-declined` at the reaction opportunity so presentation can show a small recognition flinch; ineligible opportunities remain ledger-only because their busy/staggered/action state is already visible.

- [ ] **Step 7: Verify and commit**

Run: `npx vitest run src/simulation/combatDecision.test.ts src/simulation/combatActions.test.ts`

Expected: PASS.

```bash
git add src/simulation/combatDecision.ts src/simulation/combatDecision.test.ts src/simulation/combatActions.ts src/simulation/combatActions.test.ts
git commit -m "feat: add style decisions and defense reactions"
```

---

### Task 8: Integrate Encounter Decisions, Actions, and Movement

**Files:**
- Modify: `src/simulation/encounter.ts`
- Modify: `src/simulation/encounter.test.ts`
- Modify: `src/simulation/movement.ts`
- Modify: `src/simulation/movement.test.ts`

**Interfaces:**
- Produces `advanceEncounterTick` through tick-order phase 8: transition, cleanup, targeting, decisions, action starts, defense batches, simultaneous movement, constraints.
- Contact actions enter `contact` but Task 9 supplies their final resolution.

- [ ] **Step 1: Write a failing movement/action trace test**

```ts
let transition = createEncounter(duelEncounterConfig({ seed: 11 }))
const batches: EncounterEvent[] = [...transition.events]
const distances: number[] = []
for (let count = 0; count < 180; count += 1) {
  transition = advanceEncounterTick(transition.state)
  batches.push(...transition.events)
  distances.push(distanceBetween(
    transition.state.combatants['home.brutus'].position,
    transition.state.combatants['away.drusus'].position,
  ))
}
expect(transition.state.tick).toBe(180)
expect(transition.state.combatants['home.brutus'].travelledDistance).toBeGreaterThan(0)
expect(Math.max(...distances) - Math.min(...distances)).toBeGreaterThan(0.25)
expect(batches.some(({ type }) => type === 'movement-intent-changed')).toBe(true)
expect(batches.some(({ type }) => type === 'action-started')).toBe(true)
```

Add fixed decision/contact stream consumption, actor-local IDs (`a:0`, `a:1`, `b:0`), root travel caps, recovery at 35% normal speed, no locomotion during contact/impact/stagger/defeat, and unchanged exact object/empty batch after finish.

- [ ] **Step 2: Implement the first eight tick phases in exact order**

```ts
export function advanceEncounterTick(previous: EncounterState): EncounterTransition

export function advanceEncounterTicks(initial: EncounterState, ticks: number): EncounterTransition {
  let state = initial
  const events: EncounterEvent[] = []
  for (let index = 0; index < ticks && state.phase === 'running'; index += 1) {
    const next = advanceEncounterTick(state)
    state = next.state
    events.push(...next.events)
  }
  return { state, events }
}
```

Internally name the phase helpers in tick order. Build transient hashes from sorted active pre-movement fighters. Reacquire only targetless decision-ready fighters. Allocate action IDs and consume two contact rolls at attack start even if the later attack cannot connect.

- [ ] **Step 3: Persist actual motion diagnostics**

After constraints, set `velocity = actual displacement × 60` and add displacement length to `travelledDistance`. Emit movement changes only when the enum value changes. Keep previous intent while staggered/defeated; status/action controls the pose.

- [ ] **Step 4: Add defense cancellation/ledger pruning**

When an incoming threat ends before contact, return its bound defense to neutral and emit `action-interrupted` with `threat-canceled`. Prune ledger entries only after the referenced attack resolves/cancels. Add tests that ledger size tracks live threats instead of elapsed ticks.

- [ ] **Step 5: Verify and commit**

Run: `npx vitest run src/simulation/encounter.test.ts src/simulation/combatDecision.test.ts src/simulation/movement.test.ts`

Expected: PASS.

```bash
git add src/simulation/encounter.ts src/simulation/encounter.test.ts src/simulation/movement.ts src/simulation/movement.test.ts
git commit -m "feat: integrate encounter movement and action phases"
```

---

### Task 9: Resolve Contact Snapshots, Defense, Damage, and Push

**Files:**
- Modify: `src/simulation/combatActions.ts`
- Modify: `src/simulation/combatActions.test.ts`
- Modify: `src/simulation/encounter.ts`
- Modify: `src/simulation/encounter.test.ts`

**Interfaces:**
- Completes tick-order contact resolution and accumulated push with immutable snapshots and total ordering.
- Events are the sole presentation/audio description of resolved outcomes.

- [ ] **Step 1: Write failing canonical outcome-sequence tests**

For deterministic fixtures, assert exact same-tick event type sequences:

```ts
expect(types(missBatch)).toEqual(['attack-missed'])
expect(types(evadeBatch)).toEqual(['attack-evaded'])
expect(types(blockBatch)).toEqual(['attack-blocked', 'damage-dealt', 'fighter-staggered'])
expect(types(parryBatch)).toEqual(['attack-parried', 'fighter-staggered'])
expect(types(criticalDefeatBatch)).toEqual([
  'critical-hit', 'damage-dealt', 'fighter-staggered', 'fighter-defeated',
])
```

Cover failed evade into hit/miss, facing failure, accuracy miss, geometry miss, `target-unavailable`, opening-only critical, guard multipliers, parry forced counter, allowed counter miss, and shield jab unparryability.

- [ ] **Step 2: Implement immutable contact snapshots and total ordering**

```ts
interface ContactIntent {
  actorId: CombatantId
  targetId: CombatantId
  actionInstanceId: ActionInstanceId
  actionId: AttackActionId
  priority: number
  tieKey: number
}

export function resolveContactIntents(input: ContactResolutionInput): ContactResolutionResult
```

Snapshot all geometry/defenses before resolution. Sort descending priority, then derived `tieKey(seed, tick, actionInstanceId)`, then instance ID. Never retarget. Skip later intents only when their actor was defeated earlier in the batch; non-lethal same-tick stagger does not cancel an already snapshotted contact.

- [ ] **Step 3: Implement damage, defense, push, and stagger rules**

Clamp accuracy after action modifier. Critical only against recovery/stagger and only when unblocked. Apply guard damage `.35`, push `.30`, stagger `.40` with `max(1, round(...))`. Parry applies 24 attacker stagger and queues the counter. Fast evade applies its authored `0.9 + 0.3 × directionRoll` defense displacement across the remaining windup, independent of normal locomotion speed, while respecting arena/policy/separation. Accumulate push vectors by target and constrain the whole collection once after all intents using arena/policy/three passes.

- [ ] **Step 4: Verify and commit the contact slice**

Run: `npx vitest run src/simulation/combatActions.test.ts src/simulation/encounter.test.ts`

Expected: PASS for contact ordering, outcome events, damage, defense, push, and target-unavailable without yet freezing trace literals.

```bash
git add src/simulation/combatActions.ts src/simulation/combatActions.test.ts src/simulation/encounter.ts src/simulation/encounter.test.ts
git commit -m "feat: resolve ordered combat contacts"
```

---

### Task 10: Complete Stagger, Local Clocks, Encounter Completion, and Trace Diagnostics

**Files:**
- Modify: `src/simulation/combatActions.ts`
- Modify: `src/simulation/combatActions.test.ts`
- Modify: `src/simulation/encounter.ts`
- Modify: `src/simulation/encounter.test.ts`

**Interfaces:**
- Completes tick-order persistence/completion, the full phase × stagger matrix, bounded local anti-stall clocks, and canonical trace calculation.
- Hashes remain diagnostic equality checks until post-tuning Task 13 freezes literals.

- [ ] **Step 1: Implement the full stagger phase matrix**

Parameterize every attack/defense state (`neutral`, windup, contact, impact, recovery) × non-lethal stagger. Assert action interruption only where specified, contact snapshot survival on the current tick, forced-action clearing, and lethal defeat override. Store `staggerUntilTick = max(previous, contactTick + duration)` and free when `tick >= staggerUntilTick`.

- [ ] **Step 2: Update local anti-stall clocks and completion**

Update `lastContactTick` for damage/block/parry only. Update `lastResolutionTick` for both living participants on hit/block/parry/evade/geometry/accuracy. After persistence, finish when no living hostile pair remains; all living allied survivors win. Add an exact critical-defeat sequence ending in `encounter-finished` and verify the event appears only after contact effects persist.

- [ ] **Step 3: Add canonical trace hashing without freezing content-dependent literals**

Expose a test helper that folds every tick's sorted state, integer fields, HP, action/phase IDs, RNG states, event payloads, and positions/facing quantized to millionths. For at least three two-combatant seeds, assert two identical runs produce identical hashes and a changed seed changes at least one hash. Do not freeze content-dependent literals before Task 13 tuning.

- [ ] **Step 4: Run an informational early pacing probe**

Run 20 consecutive seeds for Brutus versus Drusus and print median duration plus the fraction of attack resolutions ending as `attack-missed(reason: geometry)`. Assert only invariants and completion, not balance bands. Review the report now: a dominant geometry-miss share indicates facing/evade geometry must be corrected before capacity and balance work.

- [ ] **Step 5: Verify and commit**

Run: `npx vitest run src/simulation/combatActions.test.ts src/simulation/encounter.test.ts`

Expected: PASS with complete deterministic encounter traces and reviewed pacing diagnostics.

```bash
git add src/simulation/combatActions.ts src/simulation/combatActions.test.ts src/simulation/encounter.ts src/simulation/encounter.test.ts
git commit -m "feat: complete deterministic encounter resolution"
```

---

### Task 11: Replace the Legacy Duel Loop and Preserve Series Semantics

**Files:**
- Rewrite: `src/simulation/battle.ts`
- Rewrite: `src/simulation/battle.test.ts`
- Modify: `src/simulation/random.ts`
- Modify: `src/simulation/random.test.ts`
- Modify: `src/simulation/series.ts`
- Modify: `src/simulation/series.test.ts`
- Modify: `src/presentation/ArenaView.ts`
- Modify: `src/presentation/SeriesView.ts`
- Modify: `src/presentation/battleFeed.ts`
- Modify: `src/presentation/battleFeed.test.ts`
- Modify: `src/main.ts`
- Modify: `tests/smoke.spec.ts`

**Interfaces:**
- `battle.ts` becomes a two-ID adapter around `EncounterState` and accumulates the complete small duel log.
- The public series commands/phases stay unchanged; `FighterSide` exists only in adapter/series/UI mappings.

- [ ] **Step 1: Write failing duel-descriptor and mapping tests**

```ts
const battle = createBattle({ home: brutus, away: drusus, seed: 7, combatStyles: COMBAT_STYLES })
expect(battle.descriptor).toEqual({ homeId: 'home.brutus', awayId: 'away.drusus' })
expect(battle.encounter.combatantIds).toEqual(['away.drusus', 'home.brutus'])
expect(battle.events[0]).toMatchObject({ type: 'encounter-started', id: 0 })
expect(battle.events.every((event, index) => event.id === index)).toBe(true)
```

Add defeat/no-draw/time-limit tests, HP-ratio mapping, exact-ratio derived ID tie, scheduled tick-3600 contact before timeout, winner-side mapping, finish reason, duration, matchup from actor/target, and complete log equality across two runs.

Run: `npx vitest run src/simulation/battle.test.ts`

Expected: FAIL against the legacy side-keyed state.

- [ ] **Step 2: Define the adapter state**

```ts
export const TICKS_PER_SECOND = 60
export const MAX_BOUT_TICKS = 3600

export interface DuelDescriptor {
  homeId: CombatantId
  awayId: CombatantId
}

export interface BattleState {
  descriptor: DuelDescriptor
  encounter: EncounterState
  phase: 'running' | 'finished'
  events: readonly EncounterEvent[]
  traceHash: number
  winnerSide?: FighterSide
  finishReason?: 'defeat' | 'time-limit'
}

export function createBattle(config: BattleConfig): BattleState
export function advanceBattleTick(previous: BattleState): BattleState
export function advanceBattleTicks(initial: BattleState, ticks: number): BattleState
export function fighterBySide(state: BattleState, side: FighterSide): FighterCombatState
export function sideForCombatantId(state: BattleState, id: CombatantId): FighterSide
```

Use duel arena radius `6.5`, lateral limit `2.5`, separation `0.9`, ordered pair `[homeId, awayId]`, starts `(-4.2, 0)/(4.2, 0)`, factions `home/away`, and `different-factions` hostility.

`traceHash` remains an unsigned number in state. Every assertion or external selector uses the canonical eight-character hex representation `formatTraceHash(state.traceHash)`; never compare the numeric state field directly to a string literal.

- [ ] **Step 3: Implement timeout after contact resolution**

At tick 3600, first accept the kernel transition. If no-hostile-pairs already ended it, map that result and do not invoke `finishEncounter` again. Otherwise compare remaining HP ratios, derive an exact-tie unit value from seed plus sorted candidate IDs, call `finishEncounter` with both active fighters in `survivorIds` and the selected one in `winnerIds`, append its event, and map to one side. Never mutate kernel phase/result directly. The Step 1 fixture must make a lethal scheduled contact land exactly on tick 3600 and assert one `encounter-finished(reason: no-hostile-pairs)`, no timeout event, and no duplicate finish call.

- [ ] **Step 4: Delete every legacy combat artifact**

Remove `LEGACY_ATTACK_INTERVAL_TICKS`, `approachStarted`, scalar `x`, side-keyed random streams, instantaneous `calculateDamage` loop, `approach-started`, initiative stream, and `deriveSideSeed`. Extend architecture tests so kernel files (`spatialHash`, `movement`, `combatActions`, `combatDecision`, `encounter`) contain no `FighterSide`, `'home'`, or `'away'` identity.

- [ ] **Step 5: Inject styles through the series**

```ts
export interface SeriesConfig {
  homeRoster: readonly FighterDefinition[]
  opponents: readonly FighterDefinition[]
  seed: number
  combatStyles: CombatStyleCatalog
}
```

Store the readonly catalog in `SeriesState`, pass it to every `createBattle`, and keep assignment/confirm/next/rematch behavior unchanged. Derive `BoutResult` through descriptor IDs, including side HP ratios. Update `main.ts` to construct the series with `COMBAT_STYLES`.

- [ ] **Step 6: Migrate every existing battle consumer in the same atomic slice**

Use `fighterBySide`/`sideForCombatantId` in `SeriesView`, the current primitive `ArenaView`, and `main.ts`. `ArenaView` remains a temporary side-oriented renderer until Task 17, but reads `position.x`, descriptor IDs, and ID-based events; remove `approach-started`. Fully migrate `battleFeed.ts` and its tests to the new event vocabulary now, retaining the latest eight display rows. Update all `tests/smoke.spec.ts` bout helpers from 2700 to 3600 ticks. No compatibility alias for `battle.fighters`, `actorSide`, or old events is allowed.

- [ ] **Step 7: Verify series and presentation compatibility, then commit**

Run: `npx vitest run src/simulation/battle.test.ts src/simulation/series.test.ts src/simulation/random.test.ts src/presentation/battleFeed.test.ts`

Expected: PASS with three encounter-backed bouts and unchanged public commands.

Run: `npm run build`

Expected: PASS.

Run: `npm run test:e2e`

Expected: existing planning, three-bout, pause/speed, summary, and rematch flows PASS with the 3600-tick adapter. There is no intentionally red migration window.

```bash
git add src/simulation/battle.ts src/simulation/battle.test.ts src/simulation/random.ts src/simulation/random.test.ts src/simulation/series.ts src/simulation/series.test.ts src/presentation/ArenaView.ts src/presentation/SeriesView.ts src/presentation/battleFeed.ts src/presentation/battleFeed.test.ts src/main.ts tests/smoke.spec.ts
git commit -m "feat: back series duels with encounter combat"
```

---

### Task 12: Prove the 100-Combatant Mass Foundation Structurally

**Files:**
- Create: `src/simulation/encounterCapacity.test.ts`
- Modify: `src/testSupport/combatFixtures.ts`
- Modify: `src/simulation/encounter.ts`
- Modify: `src/simulation/encounter.test.ts`
- Modify: `src/simulation/spatialHash.ts`
- Modify: `src/simulation/spatialHash.test.ts`
- Create: `scripts/benchmark-encounter.ts`
- Modify: `package.json`

**Interfaces:**
- Adds no player-facing mass mode.
- Exposes test/benchmark diagnostics for canonical hash, spatial candidate counts, emitted event count, and serialized state size.

- [ ] **Step 1: Build the deterministic 100-FFA fixture**

```ts
export function createHundredCombatantFfa(seed = 20260815): EncounterConfig {
  return {
    seed,
    combatants: makeGridCombatants({ columns: 10, rows: 10, spacing: 3.25 }),
    arena: { radius: 30, lateralLimit: 20, minimumSeparation: 0.9, movementPolicy: 'free' },
    hostility: { mode: 'free-for-all' },
    combatStyles: COMBAT_STYLES,
  }
}
```

Cycle styles and approved fighter definitions deterministically; IDs are `ffa.000` through `ffa.099`, each with a unique faction ID. Keep the helper plain and independent of production state.

- [ ] **Step 2: Write the full capacity acceptance test**

Advance 600 ticks and on every transition assert finite state, normalized facing, arena bounds, legal targets, unique action/event IDs, valid ledgers, and invariant success. Compare two full trace hashes for equality but do not freeze the content-dependent literal until Task 13. Shuffle input definitions with a fixed permutation and expect identical sorted state/events/hash.

- [ ] **Step 3: Test distant-actor stream isolation**

Run a small encounter with and without a distant non-interacting combatant. Exclude only the necessarily different `encounter-started` payload; before acquisition range, assert identical original combatant random states, actions, targets, positions, HP, and actor/target events.

- [ ] **Step 4: Test sparse structural counters**

For the sparse 10×10 grid at spacing `3.25`, assert fewer than 800 candidate checks per separation pass, never 4950, each real canonical neighbor at most once per pass, and exactly three passes. Add a second 10×10 layout at spacing `1.5`; assert it produces more candidates than the sparse layout but still fewer than 4950, includes every real neighboring pair exactly once per pass, and remains invariant-safe after all three passes. Do not assert elapsed milliseconds.

- [ ] **Step 5: Add multi-threat, unavailable-target, and bounded-state fixtures**

The five-attacker fixture must consume ten defender values, schedule at most one defense, and deterministically prune all five records. Defeat a target during another windup and assert `target-unavailable` without retarget. Serialize state at ticks 60 and 600 under a no-damage fixture and assert schema/event-history size does not grow merely because events were emitted.

- [ ] **Step 6: Add the informational benchmark command**

```json
{
  "scripts": {
    "benchmark:encounter": "vite-node scripts/benchmark-encounter.ts"
  }
}
```

Use the `vite-node` executable already supplied by the locked Vitest toolchain; add no second TypeScript runtime. The script prints JSON with `ticks`, `combatants`, `millisecondsPerTick`, `emittedEvents`, `candidateChecks`, `peakSerializedStateBytes`, and `traceHash`. `peakSerializedStateBytes` intentionally includes the plain injected combat catalog stored in state; record that known constant overhead rather than hiding it. The command exits nonzero only on invariant/structural failure, never on a timing threshold.

- [ ] **Step 7: Verify and commit**

Run: `npx vitest run src/simulation/encounterCapacity.test.ts src/simulation/spatialHash.test.ts`

Expected: PASS including equal repeated 100-actor hashes and both sparse/dense structural fixtures.

Run: `npm run benchmark:encounter`

Expected: prints the metric JSON and exits 0.

```bash
git add src/simulation/encounterCapacity.test.ts src/testSupport/combatFixtures.ts src/simulation/encounter.ts src/simulation/encounter.test.ts src/simulation/spatialHash.ts src/simulation/spatialHash.test.ts scripts/benchmark-encounter.ts package.json
git commit -m "test: prove hundred-fighter encounter foundation"
```

---

### Task 13: Add Fixed Balance Cohorts, Tune, and Freeze Canonical Hashes

**Files:**
- Create: `src/simulation/balance.test.ts`
- Modify: `src/content/mvpSeries.ts`
- Modify: `src/content/mvpSeries.test.ts`
- Modify: `src/content/combatStyles.ts`
- Modify: `src/content/combatStyles.test.ts`
- Modify: `src/simulation/encounter.test.ts`
- Modify: `src/simulation/encounterCapacity.test.ts`
- Modify: `src/simulation/battle.test.ts`
- Modify: `src/simulation/series.test.ts`

**Interfaces:**
- Produces deterministic metric calculations and fixed acceptance bands.
- Permitted tuning: fighter numeric rows, action `damageMultiplier`/`recoveryTicks`, style turn sine/cosine pairs, and Fast `evadeDisplacement`. Names/styles/order/relative intent, cohort seeds, `Heavy < Technical < Fast` turn ordering, Fast's `0.9..1.2` authored evade envelope, and qualitative action ordering remain fixed unless a reviewed trace demonstrates the evade envelope itself is structurally unusable and the spec is amended again.

- [ ] **Step 1: Implement deterministic metric helpers inside the test**

```ts
function percentile(sorted: readonly number[], fraction: number): number {
  return sorted[Math.floor((sorted.length - 1) * fraction)]
}

interface PairingMetrics {
  homeWinRate: number
  medianTicks: number
  p10Ticks: number
  p95Ticks: number
  timeoutRate: number
  maxResolutionGapTicks: number
}
```

Define max no-resolution gap after initial approach from trace events/state clocks, not wall time. Keep seed ranges literal in the test: 200 consecutive seeds beginning `20260815` for each roster pairing; 500 for each ordered equal-stat style matchup.

- [ ] **Step 2: Write failing roster cohort assertions**

For all nine roster pairings assert win rate `15..85%`; combined median `1500..2400`; each median `1200..2700`; p10 `>=900`; p95 `<3200`; timeout `<2%`; cohort p95 longest resolution gap `<=300`.

- [ ] **Step 3: Write failing equal-stat style assertions**

Use identical stats and only vary styles. Assert advantaged style wins `55..75%`; mirrored same-style outcomes after swapped starts stay `45..55%`. Add trace sampling that every style changes lateral position or distance between committed exchanges.

- [ ] **Step 4: Restore golden series acceptance**

For seed `20260815`, assert the all-counter lineup `Brutus/Aquila/Nerva` is not `3–0`, at least one other lineup wins `2–1` or `3–0`, and the six permutations yield at least three score/result profiles.

- [ ] **Step 5: Tune with measured reports**

During tuning, print a compact table only on assertion failure. Change one coherent numeric group at a time, rerun the narrow cohort, and preserve probe/commit speed/payoff order, Fast quickest cadence, Heavy cleave slowest commitment, Technical longest practical reach, and Heavy/Technical/Fast turn ordering. Use turn pairs or Fast defense displacement when geometry-miss rates create a style-specific spatial failure; do not try to hide a geometry defect by inflating HP/damage.

- [ ] **Step 6: Freeze and review all post-tuning canonical hashes**

Only after every cohort passes, inspect representative traces and record final literals in four existing places: at least three duel seeds in `encounter.test.ts`, the 100-FFA hash in `encounterCapacity.test.ts`, one adapter duel in `battle.test.ts`, and the full `Aquila/Nerva/Brutus` lineup in `series.test.ts`. Assertions use `formatTraceHash` and eight-character lowercase hex. Re-run the trace viewer/report before accepting each new literal; never copy values blindly from a failing assertion. Task 19 later reuses the final adapter-duel literal for the Chromium cross-runner check, so no later content tuning is allowed without repeating this step.

- [ ] **Step 7: Verify and commit**

Run: `npx vitest run src/simulation/balance.test.ts src/content/mvpSeries.test.ts src/simulation/encounter.test.ts src/simulation/encounterCapacity.test.ts src/simulation/battle.test.ts src/simulation/series.test.ts`

Expected: PASS across fixed cohorts and golden lineups.

Run: `npm test`

Expected: PASS.

```bash
git add src/simulation/balance.test.ts src/content/mvpSeries.ts src/content/mvpSeries.test.ts src/content/combatStyles.ts src/content/combatStyles.test.ts src/simulation/encounter.test.ts src/simulation/encounterCapacity.test.ts src/simulation/battle.test.ts src/simulation/series.test.ts
git commit -m "balance: tune readable combat cohorts"
```

---

### Task 14: Migrate Runtime Event Batches and Render Snapshots

**Files:**
- Modify: `src/main.ts`
- Modify: `tests/smoke.spec.ts`

**Interfaces:**
- Runtime owns `{ previousBattle, currentBattle, alpha }` render snapshots plus new event batches; simulation remains integer-only.

- [ ] **Step 1: Write a failing render-snapshot lifecycle test**

```ts
await startSeededFirstBout(page)
await page.evaluate(() => window.__GLADIATOR_TEST__.advanceTicks(10))
expect(await page.evaluate(() => window.__GLADIATOR_TEST__.getRenderDebugState())).toMatchObject({
  previousTick: 9,
  currentTick: 10,
  paused: true,
})
```

Also assert next-bout/rematch initializes both ticks to zero and no event batch leaks from the prior bout.

- [ ] **Step 2: Track tick snapshots and event batches in the runtime**

```ts
interface BattleRenderFrame {
  previous: BattleState
  current: BattleState
  alpha: number
  events: readonly EncounterEvent[]
}
```

Before each fixed tick assign current to previous, advance one tick, and retain only that transition's new event slice for presentation consumers. Set `alpha = accumulator / tickDuration`; initialize both snapshots from tick 0 at bout start and reset both on next bout/rematch. The battle adapter may still own the complete feed log.

`previous` and `current` are immutable state references. Never `structuredClone` them: unchanged nested catalog/event structures must retain structural sharing, and presentation never mutates either snapshot.

- [ ] **Step 3: Add narrow deterministic test selectors**

Keep all existing methods and add:

```ts
getActiveBattleTraceHash(): string | null
getActiveCombatantPositions(): Readonly<Record<CombatantId, Vec2>>
getRenderDebugState(): Readonly<{
  previousTick: number | null
  currentTick: number | null
  alpha: number
  paused: boolean
}>
```

Return `formatTraceHash(adapter.traceHash)`, not the numeric field. Position/debug selectors return small copied plain records so Playwright movement/interpolation tests do not clone the entire `SeriesState` and combat catalog. Do not expose spatial hashes, rigs, or audio objects.

- [ ] **Step 4: Verify and commit**

Run: `npm run test:e2e`

Expected: existing product flow PASS before the visual rewrite.

Run: `npm run build`

Expected: PASS.

```bash
git add src/main.ts tests/smoke.spec.ts
git commit -m "feat: expose immutable combat render frames"
```

---

### Task 15: Build the Shared Procedural Fighter Rig and Pose Data

**Files:**
- Create: `src/presentation/ProceduralFighter.ts`
- Create: `src/presentation/ProceduralFighter.test.ts`
- Create: `src/presentation/poses/combatPoses.ts`
- Create: `src/presentation/poses/combatPoses.test.ts`

**Interfaces:**
- Produces one semantic hierarchy for every style and immutable pose dictionaries keyed by semantic joint/action names.
- Equipment/contact anchors are presentation-only and never enter encounter state.

- [ ] **Step 1: Write failing semantic-rig tests**

```ts
const fighter = createProceduralFighter({ archetype: 'technical' })
expect([...fighter.joints.keys()].sort()).toEqual([...SEMANTIC_JOINT_NAMES].sort())
expect([...fighter.anchors.keys()].sort()).toEqual([
  'hitCenter', 'offHand', 'shieldCenter', 'weaponHand', 'weaponTip',
])
expect(fighter.root.parent).toBeNull()
fighter.dispose()
expect(fighter.isDisposed()).toBe(true)
```

Assert the exact hierarchy `root → pelvis → torso → chest`, neck/head/headTop, both three-segment arms, both three-segment legs, unique semantic names, finite transforms, and style-specific equipment attached only to anchors.

Run: `npx vitest run src/presentation/ProceduralFighter.test.ts`

Expected: FAIL because the module does not exist.

- [ ] **Step 2: Implement the reusable rig**

```ts
export type JointName =
  | 'root' | 'pelvis' | 'torso' | 'chest' | 'neck' | 'head' | 'headTop'
  | 'shoulder.L' | 'upperArm.L' | 'forearm.L' | 'hand.L'
  | 'shoulder.R' | 'upperArm.R' | 'forearm.R' | 'hand.R'
  | 'upperLeg.L' | 'lowerLeg.L' | 'foot.L'
  | 'upperLeg.R' | 'lowerLeg.R' | 'foot.R'

export interface ProceduralFighter {
  root: THREE.Group
  joints: ReadonlyMap<JointName, THREE.Object3D>
  anchors: ReadonlyMap<EquipmentAnchorName, THREE.Object3D>
  horizontalEquipmentRadius: number
  dispose(): void
  isDisposed(): boolean
}
```

Use primitive geometry/materials, semantic `userData` slots, shared builder functions, and style proportions without changing joint names. Heavy receives large shield/gladius/helmet, Fast small shield/sica, Technical spear/round shield. Add a cheap duplicate rim/geometry outline or material-value separation without post-processing.

- [ ] **Step 3: Define immutable pose data contracts**

```ts
export interface JointTransform {
  rotation: readonly [x: number, y: number, z: number]
  position?: readonly [x: number, y: number, z: number]
}
export interface HumanoidPoseData {
  joints: Readonly<Partial<Record<JointName, JointTransform>>>
  easing: 'linear' | 'ease-in' | 'ease-out' | 'overshoot'
}
```

Export exhaustive guard, locomotion, action phase, recognition-flinch (`defense-declined`), block/evade/parry/stagger, and controlled defeat data keyed by style/action. Every attack supplies opening/anticipation/contact/impact/recovery/return keys; the distinctive anticipation is present at windup start.

- [ ] **Step 4: Test content completeness and silhouette metrics**

Assert every style supplies all anchors, guard/locomotion/recognition/reaction/defeat keys and every catalog action supplies all required phase keys. Assert Heavy/Fast/Technical have distinct body/equipment extent tuples so single-color silhouettes cannot be identical.

- [ ] **Step 5: Verify and commit**

Run: `npx vitest run src/presentation/ProceduralFighter.test.ts src/presentation/poses/combatPoses.test.ts`

Expected: PASS.

```bash
git add src/presentation/ProceduralFighter.ts src/presentation/ProceduralFighter.test.ts src/presentation/poses/combatPoses.ts src/presentation/poses/combatPoses.test.ts
git commit -m "feat: add procedural gladiator rigs and poses"
```

---

### Task 16: Implement Layered Pose Sampling, Gait, Impact Hold, and IK

**Files:**
- Create: `src/presentation/PoseController.ts`
- Create: `src/presentation/PoseController.test.ts`
- Modify: `src/presentation/poses/combatPoses.ts`
- Modify: `src/presentation/poses/combatPoses.test.ts`

**Interfaces:**
- Consumes interpolated plain fighter state plus contact/reaction presentation inputs.
- Produces finite joint transforms and footstep threshold crossings; never mutates simulation.

- [ ] **Step 1: Write failing layer-order/progress tests**

```ts
const sample = samplePose({
  previous: previousFighter,
  current: currentFighter,
  alpha: 0.5,
  style: COMBAT_POSES.heavy,
  reducedMotion: false,
})
expect(sample.phaseProgress).toBeCloseTo(
  (currentFighterTick - 1 + 0.5 - action.phaseStartedTick) /
  (action.phaseEndsAtTick - action.phaseStartedTick),
)
expect(allTransformsFinite(sample.pose)).toBe(true)
```

Cover clamp `0..1`, new-bout tick-0 snapshots, fixed layer order, impact hold unchanged across alpha, stagger/defeat override, and reduced-motion overshoot reduction without removing anticipation/contact.

- [ ] **Step 2: Implement the controller contract**

```ts
export interface PoseSampleInput {
  previous: Readonly<FighterCombatState>
  current: Readonly<FighterCombatState>
  previousTick: number
  currentTick: number
  alpha: number
  reducedMotion: boolean
  reaction?: Readonly<PresentationReaction>
}

export interface PoseSample {
  pose: Readonly<Record<JointName, JointTransform>>
  phaseProgress: number
  plantedFoot: 'left' | 'right' | 'both'
  weaponTrailActive: boolean
}

export class PoseController {
  apply(input: PoseSampleInput, fighter: ProceduralFighter): PoseSample
  reset(): void
}
```

Apply layers exactly: style guard; locomotion/facing; action curve; recognition flinch/defense/evade/parry/stagger/defeat; grounding and capped weapon-arm IK. `defense-declined` produces only a small early torso/head recognition motion and never raises the full defense pose. Named easing functions operate on pose data only.

- [ ] **Step 3: Drive gait from travelled simulation distance**

Derive gait phase from `travelledDistance`, direction from interpolated `velocity`, and planted-foot transitions deterministically. Test equal travelled distance at different wall times yields equal legs; suppress only emitted footstep cues at ×4 in audio, not gait itself.

- [ ] **Step 4: Add limited two-bone IK tests and implementation**

Solve only the weapon arm toward the semantic contact anchor. Clamp cosmetic reach and verify the weapon tip never exceeds the authored cap; outside the cap, retain the authored contact pose. Do not stretch bone lengths or move the root.

- [ ] **Step 5: Verify and commit**

Run: `npx vitest run src/presentation/PoseController.test.ts src/presentation/poses/combatPoses.test.ts`

Expected: PASS.

```bash
git add src/presentation/PoseController.ts src/presentation/PoseController.test.ts src/presentation/poses/combatPoses.ts src/presentation/poses/combatPoses.test.ts
git commit -m "feat: animate deterministic combat poses"
```

---

### Task 17: Replace Arena Rendering and Add Stable Group Framing

**Files:**
- Create: `src/presentation/ArenaCamera.ts`
- Create: `src/presentation/ArenaCamera.test.ts`
- Rewrite: `src/presentation/ArenaView.ts`
- Modify: `src/main.ts`
- Modify: `src/style.css`
- Modify: `tests/smoke.spec.ts`

**Interfaces:**
- `ArenaView` stores `Map<CombatantId, ProceduralFighter>`, consumes `BattleRenderFrame`, and delegates pose/camera behavior.
- `ArenaCamera` accepts an array of horizontal bounds; current caller supplies two, future mass callers may supply more.

- [ ] **Step 1: Write failing camera dead-zone tests**

```ts
const camera = new ArenaCamera({ minDistance: 11, maxDistance: 18 })
camera.reset([{ centerX: -1, radius: 0.8 }, { centerX: 1, radius: 0.8 }])
const inside = camera.update([{ centerX: -1.02, radius: 0.8 }, { centerX: 1.02, radius: 0.8 }], 1 / 60)
expect(inside.lookTargetX).toBe(camera.state.lookTargetX)
expect(inside.distance).toBeGreaterThanOrEqual(11)
expect(inside.distance).toBeLessThanOrEqual(18)
```

Test 8% midpoint and 12% extent dead zones, 10% margin, equipment radii, separate 0.75s/1.25s damping, horizontal-only inputs, distance clamps, target-array order independence, and reset with no inherited velocity.

- [ ] **Step 2: Implement camera state independent of Three.js**

```ts
export interface HorizontalFramingTarget { id: string; centerX: number; radius: number }
export interface ArenaCameraState { lookTargetX: number; distance: number }

export class ArenaCamera {
  readonly state: ArenaCameraState
  reset(targets: readonly HorizontalFramingTarget[]): ArenaCameraState
  update(targets: readonly HorizontalFramingTarget[], elapsedSeconds: number): ArenaCameraState
}
```

`ArenaView` applies the resulting x target/distance to the existing stable elevated perspective. No orbit, crossing, cuts, lookahead, shake, or vertical zoom response.

- [ ] **Step 3: Write a failing active-bout movement Playwright test**

```ts
test('renders movement-rich encounter combat', async ({ page }) => {
  await startSeededFirstBout(page)
  const before = await page.evaluate(() => window.__GLADIATOR_TEST__.getActiveCombatantPositions())
  await page.evaluate(() => window.__GLADIATOR_TEST__.advanceTicks(600))
  const after = await page.evaluate(() => window.__GLADIATOR_TEST__.getActiveCombatantPositions())
  expect(after).not.toEqual(before)
  await expect(page.locator('canvas')).toHaveAttribute('data-rendered-combatants', '2')
})
```

Run: `npx playwright test -g "movement-rich encounter"`

Expected: FAIL against the side-keyed primitive renderer.

- [ ] **Step 4: Rewrite ArenaView around IDs, snapshots, and event batches**

```ts
sync(frame: BattleRenderFrame): void
startBout(boutIndex: number, state: BattleState): void
clearBout(): void
```

Create/dispose rigs to match active encounter IDs; interpolate root position and normalized facing from previous/current by alpha; drive `PoseController`; process each new event once by ID. Map body/shield/weapon contact points to distinct effect geometry/position, add short non-obscuring flashes, and show weapon trails only in late windup/contact. Disable trails/flashes and reduce overshoot under `prefers-reduced-motion`.

Under `import.meta.env.DEV` only, expose an arena debug snapshot containing rendered root positions, finite joint transforms, active effect IDs, camera state, and event cursor, plus a `renderActiveBattleAtAlpha(alpha)` test method that re-renders the current immutable previous/current pair at a supplied `0..1` alpha. It changes presentation only and must not advance or mutate simulation; production builds omit both methods.

- [ ] **Step 5: Implement complete lifecycle reset and WebGL fallback**

Bout start/rematch clears pose, trails, flashes, event cursor, camera interpolation, and old rigs. On `webglcontextlost`, prevent default, dispose renderer-owned resources, replace the canvas area with readable fallback text, and let series/runtime continue. Test the fallback through a dispatched context-loss event and explicit tick advancement.

- [ ] **Step 6: Wire interpolated frames in main**

Pass `{ previous, current, alpha, events }` on every animation frame, including paused frames with stable alpha. At ×2/×4 the simulation advances more fixed ticks, but interpolation remains between the last two actual states. Never recreate presentation state inside `renderDom`.

- [ ] **Step 7: Verify and commit**

Run: `npx vitest run src/presentation/ArenaCamera.test.ts src/presentation/PoseController.test.ts`

Expected: PASS.

Run: `npx playwright test -g "movement-rich encounter|context loss|resets arena"`

Expected: PASS.

```bash
git add src/presentation/ArenaCamera.ts src/presentation/ArenaCamera.test.ts src/presentation/ArenaView.ts src/main.ts src/style.css tests/smoke.spec.ts
git commit -m "feat: render readable procedural combat"
```

---

### Task 18: Add Optional Event-Driven Combat Audio

**Files:**
- Create: `src/presentation/CombatAudio.ts`
- Create: `src/presentation/CombatAudio.test.ts`
- Modify: `src/presentation/SeriesView.ts`
- Modify: `src/main.ts`
- Modify: `src/style.css`
- Modify: `tests/smoke.spec.ts`

**Interfaces:**
- Uses a replaceable backend so unit tests require no browser `AudioContext`.
- Audio consumes semantic events/pose footstep transitions and never consumes simulation RNG or changes simulation flow.

- [ ] **Step 1: Write failing mapping, deduplication, and speed tests**

```ts
const backend = new FakeAudioBackend()
const audio = new CombatAudio(backend)
audio.enableAfterGesture()
audio.consume({ events: [blockEvent], boutIndex: 0, speed: 1, paused: false })
audio.consume({ events: [blockEvent], boutIndex: 0, speed: 1, paused: false })
expect(backend.played.map(({ cue }) => cue)).toEqual(['shield-block'])

audio.consume({ events: [whooshEvent, hitEvent], boutIndex: 0, speed: 4, paused: false })
expect(backend.played.map(({ cue }) => cue)).not.toContain('weapon-whoosh-light')
expect(backend.played.map(({ cue }) => cue)).toContain('body-hit')
```

Cover all nine cue IDs, semantic body/shield/weapon mapping, light/heavy whoosh/footstep selection, event/threshold dedupe, eight-voice cap at ×1/×2, ×4 whitelist, pause fade/no replay, bout/rematch reset, mute, rejected enable, and missing backend. Add a handler-order fixture proving `backend.enable()` is invoked synchronously before the lineup-confirm command returns, even though its promise settles later.

- [ ] **Step 2: Implement backend and controller contracts**

```ts
export type CombatCue =
  | 'footstep-light' | 'footstep-heavy'
  | 'weapon-whoosh-light' | 'weapon-whoosh-heavy'
  | 'body-hit' | 'shield-block' | 'weapon-parry' | 'stagger' | 'defeat'

export interface AudioBackend {
  enable(): Promise<boolean>
  play(cue: CombatCue, variation: Readonly<{ pitch: number; durationScale: number }>): void
  fadeOrdinaryVoices(): void
  stopAll(): void
  activeVoiceCount(): number
}

export class CombatAudio {
  enableAfterGesture(): Promise<void>
  setSoundEnabled(enabled: boolean): Promise<void>
  consume(input: CombatAudioFrame): void
  resetBout(): void
  dispose(): void
}
```

The browser backend synthesizes short oscillator/noise/filter/gain graphs or buffers. Derive small pitch/duration variation directly from bout index and event ID. Catch all backend failures and silently disable audio.

- [ ] **Step 3: Add the user-gesture and sound-control lifecycle**

Extend `SeriesIntent` with `{ type: 'toggle-sound' }`. In the lineup-confirm click handler, call `void combatAudio.enableAfterGesture()` synchronously as the first statement and without `await`; `AudioContext.resume()` must therefore begin inside the browser gesture. Handle settlement with `.then/.catch`, and run the synchronous series-confirm command immediately regardless of audio success. Sound defaults on after the first successful eligible gesture; the visible control reads `Sound on/off`. Pause fades ordinary voices and stops scheduling; resume starts only from new events.

- [ ] **Step 4: Add dev/test-only audio debug support**

Under `import.meta.env.DEV` only, `?audioDebug=1` exposes controls/test API that trigger each cue without a bout. Production build ignores the query and renders no debug UI. Add Playwright assertions for all cues through a fake/instrumented backend and an assertion that the production preview has no debug control.

- [ ] **Step 5: Verify and commit**

Run: `npx vitest run src/presentation/CombatAudio.test.ts`

Expected: PASS without real audio hardware.

Run: `npx playwright test -g "sound|audio debug"`

Expected: PASS.

Run: `npm run build`

Expected: PASS and no production audio-debug UI path.

```bash
git add src/presentation/CombatAudio.ts src/presentation/CombatAudio.test.ts src/presentation/SeriesView.ts src/main.ts src/style.css tests/smoke.spec.ts
git commit -m "feat: add optional semantic combat audio"
```

---

### Task 19: Complete Determinism, Visual Acceptance, Human Review, and Handoff

**Files:**
- Create: `tests/combat-visuals.spec.ts`
- Modify: `tests/smoke.spec.ts`
- Create/Modify: `tests/__screenshots__/*.png` only through intentional Playwright update commands
- Create: `docs/reviews/2026-08-16-readable-deep-combat-human-review.md`
- Modify: `README.md`

**Interfaces:**
- Produces browser/runtime equivalence evidence, deterministic key-pose fixtures, intentional baselines, and a filled human-review record.
- Test-only pose fixtures may select a frozen trace/tick but cannot alter production simulation decisions or results.

- [ ] **Step 1: Separate cross-runtime determinism from interpolation coverage**

```ts
test('matches the post-tuning Node trace hash in Chromium', async ({ page }) => {
  await startSeededFirstBout(page)
  await page.evaluate(() => window.__GLADIATOR_TEST__.advanceTicks(1200))
  expect(await page.evaluate(() => window.__GLADIATOR_TEST__.getActiveBattleTraceHash()))
    .toBe(CANONICAL_CHROMIUM_DUEL_HASH)
})

test('interpolates presentation without advancing simulation', async ({ page }) => {
  await startSeededFirstBout(page)
  await page.evaluate(() => window.__GLADIATOR_TEST__.advanceTicks(240))
  const tick = await page.evaluate(() => window.__GLADIATOR_TEST__.getRenderDebugState().currentTick)
  const atQuarter = await page.evaluate(() => window.__GLADIATOR_TEST__.renderActiveBattleAtAlpha(0.25))
  const atThreeQuarters = await page.evaluate(() => window.__GLADIATOR_TEST__.renderActiveBattleAtAlpha(0.75))
  expect(atThreeQuarters).not.toEqual(atQuarter)
  expect(await page.evaluate(() => window.__GLADIATOR_TEST__.getRenderDebugState().currentTick)).toBe(tick)
})
```

The hash is the final post-tuning eight-character literal from Task 13 and is asserted through `formatTraceHash` in Vitest. Do not add a fake refresh-rate global: synchronous `advanceTicks` is intentionally independent of `requestAnimationFrame`, while the second test directly verifies the only render-rate-sensitive property, alpha interpolation, without changing simulation state.

- [ ] **Step 2: Add deterministic key-pose and reset fixtures**

Freeze reviewed traces/ticks for Heavy guard/cleave, Fast burst/disengage, Technical measure/parry/counter, recognition flinch after `defense-declined`, hit, block, stagger, and defeat. Through the dev-only arena snapshot, numerically assert expected finite joint transforms and effect/cursor state; these are the blocking pose checks. Assert second/third bout and rematch reset rig IDs, pose, trails, flashes, camera state, audio cursor, and event cursor. Assert reduced motion removes trail/flash while preserving anticipation/contact/result.

- [ ] **Step 3: Capture intentional visual baselines**

For every screenshot test, call `page.setViewportSize({ width: 1280, height: 820 })`, open `/?snapshot&seed=20260815`, advance explicitly to the frozen tick, assert `getRenderDebugState().paused === true`, render the selected fixed alpha, and only then capture each key pose and one complete safe two-fighter frame. Update only named tests:

```bash
npx playwright test tests/combat-visuals.spec.ts --update-snapshots
```

Review every diff for readable silhouette, spacing, visible anticipation/contact/recovery, grounded feet, non-obscuring effects, stable camera, and correct stat labels. Numerical joint/effect assertions from Step 2 are authoritative; WebGL screenshots are review artifacts evaluated with the repository's pinned Chromium and existing `maxDiffPixelRatio`, not a substitute for transform checks. Do not accept unrelated planning/interstitial/summary changes.

- [ ] **Step 4: Add the human-review evidence document before review**

Create a table with reviewer aliases, prior rules knowledge, clip/style, exchange tag (`probe` or `committed`), exchange count, correctly labelled anticipation/defense-or-result/recovery count, recognition of `defense-declined`, style identification, winner explanation, foot sliding, contact, rhythm, camera, repetition, reduced motion, sound weight, and failure notes. Include the exact pass calculation:

```text
exchange accuracy = fully correct exchange labels / reviewed committed exchanges
pass = each reviewer >= 75%, all three styles identified after one clip each,
       and a plausible winner explanation for all three representative clips
```

Do not pre-fill results or claim this gate from automated/model review.

- [ ] **Step 5: Run the required human gate**

Have at least two non-implementers review nine ordered-style ×1 bouts, one full ×2 series, storyboard, feed-hidden recording, isolated cues, and a complete audible bout. At least one reviewer starts without style rules. Score the 75% anticipation metric on committed exchanges; record probes separately for visible resolution/recovery because the design does not promise human-readable probe anticipation. Record anonymized counts and short failure notes. If any threshold fails, return to the narrow responsible task, fix, rerun automated checks, regenerate only affected artifacts, and repeat review.

- [ ] **Step 6: Update README with the final architecture and controls**

Document movement-rich style identities, fixed-tick determinism, seed reproduction, sound/pause/×1/×2/×4 behavior, encounter-vs-duel adapter boundary, current 1v1 UI, test commands, informational benchmark, audio debug dev query, and human-review requirement. State explicitly that the 100-FFA fixture is a deterministic/structural regression surface for the kernel, not a prototype of readable mass-battle behavior: engagement slots, dogpile prevention, and group tactics remain future work. State that future skill/perks modify decision scoring/tagged parameters in simulation, not rendering.

- [ ] **Step 7: Run fresh final verification**

Run: `npm test`

Expected: all simulation, capacity, balance, architecture, pose, camera, feed, and audio tests PASS.

Run: `npm run build`

Expected: production TypeScript/Vite build PASS.

Run: `npm run test:e2e`

Expected: all existing product-flow, lifecycle, cross-runtime hash, alpha-interpolation, reduced-motion, audio-debug-dev, context-loss, key-pose, and screenshot tests PASS.

Run: `npm run check`

Expected: repeats the complete official sequence successfully from a clean process.

Run: `git status --short`

Expected: only intentional Task 19 docs/tests/baselines remain; existing review files remain unstaged.

- [ ] **Step 8: Commit acceptance artifacts**

Stage exact screenshot filenames reported by `git status`, never the whole directory blindly:

```bash
git add tests/combat-visuals.spec.ts tests/smoke.spec.ts README.md docs/reviews/2026-08-16-readable-deep-combat-human-review.md
git add tests/__screenshots__/heavy-cleave.png tests/__screenshots__/fast-burst.png tests/__screenshots__/technical-parry.png tests/__screenshots__/combat-outcomes.png tests/__screenshots__/combat-safe-frame.png
git commit -m "test: verify readable deep combat acceptance"
```

If Playwright emits platform-suffixed baseline names, replace the five names above with the exact reviewed paths before staging.

---

## Final Review Checklist

- [ ] Search for forbidden leftovers: `rg -n "attackIntervalTicks|approach-started|deriveSideSeed|LEGACY_ATTACK|Math\\.(random|sin|cos|tan|atan|asin|acos|pow|hypot)" src/simulation` returns no production simulation hits.
- [ ] Search kernel identity: `rg -n "FighterSide|'home'|'away'" src/simulation/{spatialHash,movement,combatActions,combatDecision,encounter}.ts` returns no hits.
- [ ] `EncounterState` has no event log, spatial hash, `Map`, functions, render, or audio objects.
- [ ] All event IDs and action instance IDs are unique and deterministic; ledgers stay bounded by live threats.
- [ ] Shuffled 100-actor input, distant actor, five-threat defense, sparse/dense pair counters, and 600-tick FFA all pass.
- [ ] Fixed roster/equal-stat balance cohorts pass unchanged seed ranges and bands.
- [ ] Series planning, three bouts, interstitials, summary, rematch, seed, pause, and speed behavior remain intact.
- [ ] All styles visibly move between exchanges and have distinct approach/exit rhythm, defenses, silhouettes, and equipment.
- [ ] Camera is stable; reduced motion and audio failure never affect simulation.
- [ ] Human-review counts meet the written threshold and the PR includes screenshots/recording plus failure notes.
- [ ] The PR description states the single player hypothesis from Global Constraints.

## Implementation Handoff

Before Task 1, use `superpowers:using-git-worktrees` to create an isolated implementation worktree. Execute one task and one commit at a time with `superpowers:subagent-driven-development` (recommended for this long plan) or `superpowers:executing-plans`; run the stated review gate before moving on.

Tasks 1–13 establish and tune the deterministic playable combat; freeze and review the simulation/event contract after Task 13. Task 14 is the first presentation/runtime slice on that frozen contract, and Tasks 15–18 then build rigs, poses, arena, and audio in order. Task 19 cannot be declared complete until the external human-review gate is actually performed.

After the fresh Task 19 verification, use `superpowers:verification-before-completion`, then `superpowers:requesting-code-review`, and finally `superpowers:finishing-a-development-branch` for integration.
