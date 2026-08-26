# Retiarius Reach Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give the retiarius attack ranges that match his trident, so that the fighter carrying a polearm stops landing every committed blow at the arena's minimum separation.

**Architecture:** Two pull requests. The first is preparatory and changes no game behaviour: it finishes the contact-diagnostics seam and the reach harness that measure the change, and splits frozen literals out of the four test files that mix them with acceptance logic, so the CI gate can protect the criteria without forbidding files whose contents must move. The second changes the authored catalog and re-baselines every determinism artifact, then restores the counter triangle and re-runs the reach gates jointly.

**Tech Stack:** TypeScript, Vitest, Playwright, three.js. `vite-node` for scripts. No new dependencies.

**Spec:** `docs/superpowers/specs/2026-08-25-retiarius-reach-design.md`. Read it before Task 1; this plan does not restate its reasoning, only its requirements.

## Global Constraints

- **The acceptance gates are frozen.** No task may change a threshold in `scripts/measure-reach.ts`'s gate block, a band in `balance.test.ts`, `seasonBalance.test.ts`, `dispositionBalance.test.ts`, or the cohort method in `balanceCohorts.ts`. design.md: *"If allowed numeric tuning cannot satisfy the bands, implementation stops and presents the failing distributions rather than weakening a criterion silently."*
- **Mutable content, exhaustively:** `fast-slash.contactRange`, `fast-burst-lunge.contactRange`, `fast-burst-lunge.rootTravel`, `fast-burst-lunge.startMaxRange`, `FAST_FORCED_DISENGAGE_END_RANGE`, `FAST_FORCED_DISENGAGE_MAX_TICKS`, `BURST_IN_MIN_RANGE`, `BURST_IN_MAX_RANGE`, any action's `damageMultiplier` and `recoveryTicks`, the roster fighter stats in `mvpSeries.ts`, and the frozen literals per the re-baseline rule. **Anything else — `baseWeights`, locomotion speeds, `preferredRange`, turn pairs, decision intervals — requires an amendment written into the spec before the edit.**
- **Two kinds of artifact, two rules.** *Determinism artifacts* (`dc635911`, the nine per-tick digests, `dbe77c5e`, `series.test.ts`'s per-bout hashes, key-pose ticks, Playwright baselines) may be re-frozen, each with a stated reason in the commit message. *Product assertions* (`GOLDEN_OUTCOMES`, `GOLDEN_SCORE`, `GOLDEN_DELTAS`, the `1-2` lineup result, the camera's bounds) must continue to satisfy the design's criteria; if one cannot, amend the spec first.
- **Target package** (Task 7), subject to Task 6's outcome: `fast-slash.contactRange` `{min: 0.9, max: 2.05}`; `fast-burst-lunge.contactRange` `{min: 1.60, max: 2.40}`; `fast-burst-lunge.rootTravel` `0.50`; `fast-burst-lunge.startMaxRange` `4.0`; `FAST_FORCED_DISENGAGE_END_RANGE` `3.35`.
- **`fast-burst-lunge.contactRange.min` must equal `technical-driving-thrust.contactRange.min`.** The gate asserts it. The in-envelope share counts `[contactRange.min, 1.7]`, whose width is set by the floor, so unequal floors make the two types' shares incomparable.
- Never edit a frozen hash literal to make a test pass in PR 1. PR 1 changes no behaviour; if a hash moves there, the change is wrong.
- Commit messages: Conventional Commits. No LLM attribution.

## Current state of the branch

`feature/retiarius-reach` already contains, from the spec phase:

- `src/simulation/contactDiagnostics.ts` — `ContactOutcome`, `ContactRecord`, `ContactCollector`.
- `src/simulation/encounter.ts` — `resolveContactIntents` takes an optional `contactCollector`, plus `classifyContactOutcome` and `recordContact`; `advanceEncounterTick` takes it as a third parameter.
- `src/simulation/battle.ts` — `advanceBattleTick` takes it as a third parameter.
- `scripts/measure-reach.ts` and the `measure:reach` npm script.
- `scripts/check-allowlist.sh` re-scoped to the phase-1 denylist.

**None of it has a test.** Tasks 1 and 2 fix that. A diagnostic that lies is worse than no diagnostic, and this one is the slice's only source of evidence.

## File structure

| File | Responsibility |
|---|---|
| `src/simulation/contactDiagnostics.ts` | The phase-9 collector contract. Types only. |
| `src/simulation/contactDiagnostics.test.ts` | **New.** Proves the seam is inert, complete, and correct about separation. |
| `src/simulation/encounter.ts` | Emits one record per contact intent from the frozen snapshot. |
| `scripts/measure-reach.ts` | The acceptance instrument and gate. |
| `src/testSupport/reachHarness.ts` | **New.** The classification and overlay logic lifted out of the script so it can be unit-tested. |
| `src/testSupport/reachHarness.test.ts` | **New.** Tests for that logic. |
| `src/testSupport/frozenFixtures/*.ts` | **New.** Frozen literals split out of four test files. |
| `src/content/combatStyles.ts` | The authored catalog. Changed only in Task 7. |
| `src/simulation/combatDecision.ts` | `FAST_FORCED_DISENGAGE_*`, `BURST_IN_*`. Changed in Task 5 only. |

---

# PR 1 — Preparatory (no behaviour change)

### Task 1: Test the contact-diagnostics seam

**Files:**
- Test: `src/simulation/contactDiagnostics.test.ts` (create)
- Read: `src/simulation/encounter.ts` (`resolveContactIntents`, `classifyContactOutcome`, `recordContact`), `src/simulation/decisionDiagnostics.test.ts` (the style to follow)

**Interfaces:**
- Consumes: `ContactCollector`, `ContactRecord`, `ContactOutcome` from `./contactDiagnostics`; `advanceBattleTick(previous, decisionCollector?, contactCollector?)` from `./battle`.
- Produces: nothing. This task only adds tests.

- [ ] **Step 1: Write the failing tests**

Create `src/simulation/contactDiagnostics.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { COMBAT_STYLES } from '../content/combatStyles'
import { BASELINE_TEST_SEED, homeRoster, opponents } from '../content/mvpSeries'
import { advanceBattleTick, createBattle, MAX_BOUT_TICKS, type BattleState } from './battle'
import type { ContactCollector, ContactRecord } from './contactDiagnostics'
import type { FighterDefinition } from './fighters'

function runBout(home: FighterDefinition, away: FighterDefinition, collector?: ContactCollector): { traceHash: number; records: ContactRecord[] } {
  let battle: BattleState = createBattle({ home, away, seed: BASELINE_TEST_SEED, combatStyles: COMBAT_STYLES })
  while (battle.phase === 'running' && battle.encounter.tick < MAX_BOUT_TICKS) {
    battle = advanceBattleTick(battle, undefined, collector)
  }
  return { traceHash: battle.traceHash, records: [] }
}

describe('contact diagnostics', () => {
  it('does not change behaviour when a collector is attached, in any of the nine pairings', () => {
    // The seam's only guarantee. If attaching a write-only collector can move
    // a trace hash, it is not write-only.
    for (const home of homeRoster) {
      for (const away of opponents) {
        const without = runBout(home, away)
        const records: ContactRecord[] = []
        const with_ = runBout(home, away, { record: (entry) => records.push(entry) })
        expect(with_.traceHash, `${home.id}/${away.id}`).toBe(without.traceHash)
      }
    }
  })

  it('records every contact intent exactly once, with a finite separation', () => {
    const records: ContactRecord[] = []
    runBout(homeRoster[0], opponents[0], { record: (entry) => records.push(entry) })
    expect(records.length).toBeGreaterThan(0)
    const ids = new Set(records.map((r) => r.actionInstanceId))
    expect(ids.size).toBe(records.length)
    for (const record of records) {
      expect(Number.isFinite(record.separation), record.actionInstanceId).toBe(true)
      expect(record.separation).toBeGreaterThanOrEqual(0.9 - 1e-9)
    }
  })

  it('records a separation inside the action’s own contact range whenever the weapon reached', () => {
    // THE TEST THAT WOULD HAVE CAUGHT THE ORIGINAL DEFECT. The harness used to
    // sample after `advanceBattleTick`, i.e. after phase 10's pushback, and
    // reported `heavy-cleave` contacts at 2.03 against an authored maximum of
    // 1.8. A record taken from the phase-9 snapshot cannot do that: geometry
    // was judged against exactly these positions.
    const records: ContactRecord[] = []
    for (const home of homeRoster) {
      for (const away of opponents) runBout(home, away, { record: (entry) => records.push(entry) })
    }
    const reached = new Set(['hit', 'blocked', 'parried', 'missed-accuracy'])
    const violations = records
      .filter((r) => reached.has(r.outcome))
      .filter((r) => {
        const range = COMBAT_STYLES.attacks[r.actionId].contactRange
        return r.separation < range.min - 1e-6 || r.separation > range.max + 1e-6
      })
    expect(violations.slice(0, 5)).toEqual([])
  })

  it('classifies a blocked hit as blocked rather than as a plain hit', () => {
    // `attack-blocked` is followed by `damage-dealt` for the same instance, so
    // a naive scan would report the guard working as an ordinary hit.
    const records: ContactRecord[] = []
    for (const home of homeRoster) {
      for (const away of opponents) runBout(home, away, { record: (entry) => records.push(entry) })
    }
    expect(records.some((r) => r.outcome === 'blocked')).toBe(true)
    expect(records.some((r) => r.outcome === 'hit')).toBe(true)
    expect(records.some((r) => r.outcome === 'missed-geometry')).toBe(true)
  })
})
```

- [ ] **Step 2: Run the tests to see which fail**

Run: `npx vitest run src/simulation/contactDiagnostics.test.ts`

Expected: the first test fails on the `runBout` helper returning no records for the with-collector case (it returns `records: []` — a deliberate stub). Fix the helper to return the collected array, then re-run.

- [ ] **Step 3: Fix the helper**

```ts
function runBout(home: FighterDefinition, away: FighterDefinition, collector?: ContactCollector): { traceHash: number; records: ContactRecord[] } {
  const records: ContactRecord[] = []
  const wrapped: ContactCollector | undefined = collector ? { record: (entry) => { records.push(entry); collector.record(entry) } } : undefined
  let battle: BattleState = createBattle({ home, away, seed: BASELINE_TEST_SEED, combatStyles: COMBAT_STYLES })
  while (battle.phase === 'running' && battle.encounter.tick < MAX_BOUT_TICKS) {
    battle = advanceBattleTick(battle, undefined, wrapped)
  }
  return { traceHash: battle.traceHash, records }
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run src/simulation/contactDiagnostics.test.ts`
Expected: 4 passed.

If the third test fails, **do not widen the tolerance.** A reached contact outside its authored range means the record is not taken from the phase-9 snapshot, which is the whole point of the seam. Re-read `resolveContactIntents`.

- [ ] **Step 5: Run the full suite**

Run: `npm test`
Expected: all pass, `dc635911` and `dbe77c5e` unchanged.

- [ ] **Step 6: Commit**

```bash
git add src/simulation/contactDiagnostics.test.ts
git commit -m "test(simulation): pin the contact-diagnostics seam as inert and snapshot-accurate"
```

---

### Task 2: Extract and test the harness's classification and overlay logic

`scripts/` is outside `tsconfig.json`'s `include`, so nothing in `measure-reach.ts` is typechecked by `npm run build` and none of it is reachable by Vitest. The two pieces that can silently be wrong — which outcomes count as *reached*, and how an overlay merges — move into `src/testSupport/` where both apply.

**Files:**
- Create: `src/testSupport/reachHarness.ts`
- Create: `src/testSupport/reachHarness.test.ts`
- Modify: `scripts/measure-reach.ts` (import instead of defining)

**Interfaces:**
- Produces:
  - `export const REACHED: ReadonlySet<ContactOutcome>`
  - `export const GEOMETRY_FAILURE: ReadonlySet<ContactOutcome>`
  - `export function deepMerge(base: Record<string, unknown>, patch: Record<string, unknown>): void`
  - `export function applyOverlay(catalog: CombatStyleCatalog, overlay: { attacks?: Record<string, unknown>; styles?: Record<string, unknown> }): CombatStyleCatalog`

- [ ] **Step 1: Write the failing test**

Create `src/testSupport/reachHarness.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { COMBAT_STYLES } from '../content/combatStyles'
import { applyOverlay, deepMerge, GEOMETRY_FAILURE, REACHED } from './reachHarness'
import type { ContactOutcome } from '../simulation/contactDiagnostics'

describe('reach harness', () => {
  it('partitions every contact outcome exactly once', () => {
    // An outcome in neither set is silently dropped from both the sample and
    // the geometry-failure denominator; an outcome in both is double-counted.
    const all: ContactOutcome[] = ['hit', 'blocked', 'parried', 'evaded', 'missed-geometry', 'missed-accuracy', 'target-unavailable', 'actor-defeated']
    for (const outcome of all) {
      expect(REACHED.has(outcome) && GEOMETRY_FAILURE.has(outcome), outcome).toBe(false)
    }
    expect([...REACHED]).toEqual(['hit', 'blocked', 'parried', 'missed-accuracy'])
    expect([...GEOMETRY_FAILURE]).toEqual(['missed-geometry', 'evaded'])
  })

  it('deep-merges a nested patch instead of replacing the object', () => {
    // `Object.assign` was the original bug: patching only `max` dropped `min`.
    const base = { contactRange: { min: 0.9, max: 1.45 }, rootTravel: 1.4 }
    deepMerge(base as unknown as Record<string, unknown>, { contactRange: { max: 2.4 } })
    expect(base).toEqual({ contactRange: { min: 0.9, max: 2.4 }, rootTravel: 1.4 })
  })

  it('produces the same catalog as a direct edit would', () => {
    const overlaid = applyOverlay(structuredClone(COMBAT_STYLES) as never, {
      attacks: { 'fast-burst-lunge': { contactRange: { min: 1.6, max: 2.4 }, rootTravel: 0.5, startMaxRange: 4.0 } },
    })
    const direct = structuredClone(COMBAT_STYLES) as never as { attacks: Record<string, Record<string, unknown>> }
    direct.attacks['fast-burst-lunge'].contactRange = { min: 1.6, max: 2.4 }
    direct.attacks['fast-burst-lunge'].rootTravel = 0.5
    direct.attacks['fast-burst-lunge'].startMaxRange = 4.0
    expect(overlaid).toEqual(direct)
  })

  it('rejects an overlay naming an unknown action', () => {
    expect(() => applyOverlay(structuredClone(COMBAT_STYLES) as never, { attacks: { 'fast-trident-poke': {} } }))
      .toThrow(/unknown attack/)
  })

  it('rejects an overlay that makes the catalog invalid', () => {
    // `startMaxRange` must be >= `contactRange.max`; a candidate that violates
    // an authored invariant must fail loudly rather than produce numbers.
    expect(() => applyOverlay(structuredClone(COMBAT_STYLES) as never, {
      attacks: { 'fast-burst-lunge': { contactRange: { min: 0.9, max: 3.5 } } },
    })).toThrow(/startMaxRange/)
  })
})
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run src/testSupport/reachHarness.test.ts`
Expected: FAIL — `Cannot find module './reachHarness'`.

- [ ] **Step 3: Create the module**

Create `src/testSupport/reachHarness.ts` by moving `REACHED`, `GEOMETRY_FAILURE`, `deepMerge` and the overlay application out of `scripts/measure-reach.ts` verbatim, with the arena literal the script already uses:

```ts
// The two pieces of the reach harness that can be silently wrong, lifted out
// of `scripts/measure-reach.ts` so they are typechecked and unit-tested.
// `scripts/` is outside tsconfig's `include` and unreachable by Vitest.

import { validateCombatStyleCatalog, type CombatStyleCatalog } from '../simulation/combatActions'
import type { ContactOutcome } from '../simulation/contactDiagnostics'

/** Outcomes in which the weapon reached the target at the recorded separation. */
export const REACHED: ReadonlySet<ContactOutcome> = new Set<ContactOutcome>(['hit', 'blocked', 'parried', 'missed-accuracy'])

/** Outcomes in which it did not, and which the geometry-failure rate is computed over. */
export const GEOMETRY_FAILURE: ReadonlySet<ContactOutcome> = new Set<ContactOutcome>(['missed-geometry', 'evaded'])

/** The duel arena, so an overlay that violates a catalog invariant fails here rather than producing plausible numbers. */
const DUEL_ARENA = { radius: 6.5, lateralLimit: 2.5, minimumSeparation: 0.9, movementPolicy: 'ordered-pair' } as const

export function deepMerge(base: Record<string, unknown>, patch: Record<string, unknown>): void {
  for (const [key, value] of Object.entries(patch)) {
    const existing = base[key]
    if (value !== null && typeof value === 'object' && !Array.isArray(value) &&
        existing !== null && typeof existing === 'object' && !Array.isArray(existing)) {
      deepMerge(existing as Record<string, unknown>, value as Record<string, unknown>)
    } else {
      base[key] = value
    }
  }
}

export function applyOverlay(
  catalog: CombatStyleCatalog,
  overlay: { attacks?: Record<string, unknown>; styles?: Record<string, unknown> },
): CombatStyleCatalog {
  const attacks = catalog.attacks as unknown as Record<string, Record<string, unknown>>
  const styles = catalog.styles as unknown as Record<string, Record<string, unknown>>
  for (const [id, patch] of Object.entries(overlay.attacks ?? {})) {
    if (!(id in attacks)) throw new Error(`overlay patches unknown attack '${id}'`)
    deepMerge(attacks[id], patch as Record<string, unknown>)
  }
  for (const [id, patch] of Object.entries(overlay.styles ?? {})) {
    if (!(id in styles)) throw new Error(`overlay patches unknown style '${id}'`)
    deepMerge(styles[id], patch as Record<string, unknown>)
  }
  validateCombatStyleCatalog(catalog, DUEL_ARENA)
  return catalog
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run src/testSupport/reachHarness.test.ts`
Expected: 5 passed.

- [ ] **Step 5: Make the script import instead of defining**

In `scripts/measure-reach.ts`, delete the local `REACHED`, `GEOMETRY_FAILURE`, `deepMerge` and the body of `catalogFor`'s merge/validate, and import:

```ts
import { applyOverlay, GEOMETRY_FAILURE, REACHED } from '../src/testSupport/reachHarness'
```

`catalogFor` becomes:

```ts
function catalogFor(overlayPath: string | undefined): CombatStyleCatalog {
  const catalog = structuredClone(COMBAT_STYLES) as unknown as CombatStyleCatalog
  if (!overlayPath) return catalog
  return applyOverlay(catalog, JSON.parse(readFileSync(overlayPath, 'utf8')) as { attacks?: Record<string, unknown>; styles?: Record<string, unknown> })
}
```

- [ ] **Step 6: Verify the script still runs and reproduces the baseline**

Run: `npm run measure:reach -- --seeds 25`
Expected: it completes and `fast-burst-lunge` shows a contact median of `0.90`. If it differs, the extraction changed behaviour.

- [ ] **Step 7: Commit**

```bash
git add src/testSupport/reachHarness.ts src/testSupport/reachHarness.test.ts scripts/measure-reach.ts
git commit -m "test(testSupport): unit-test the reach harness's outcome partition and overlay merge"
```

---

### Task 3: Split frozen literals out of the four mixed test files

Each of these files holds literals that must move when behaviour changes, mixed with assertions that must not. The CI gate cannot protect one without forbidding the other, which is what made the previous denylist internally impossible.

**Files:**
- Create: `src/testSupport/frozenFixtures/capacityTrace.ts`, `seriesTrace.ts`, `goldenSeason.ts`, `cameraTraces.ts`
- Modify: `src/simulation/encounterCapacity.test.ts`, `src/simulation/series.test.ts`, `src/simulation/seasonBalance.test.ts`, `src/presentation/ArenaCamera.test.ts`

**Interfaces:**
- Produces:
  - `capacityTrace.ts`: `export const CAPACITY_TRACE_HASH = 'dbe77c5e'`
  - `seriesTrace.ts`: `export const LINEUP_BOUT_HASHES: readonly string[]`, `export const LINEUP_SCORE = '1-2'`
  - `goldenSeason.ts`: `export const GOLDEN_OUTCOMES`, `export const GOLDEN_SCORE`, `export const GOLDEN_DELTAS` (types unchanged from their current declarations)
  - `cameraTraces.ts`: `export const RECORDED_TRACES: readonly { label: string; lineup: readonly string[]; ticks: number; openingDistance: number; crossings: number }[]`

- [ ] **Step 1: Move the capacity hash**

Create `src/testSupport/frozenFixtures/capacityTrace.ts`:

```ts
// Frozen determinism artifact, split out of `encounterCapacity.test.ts` so the
// CI gate can protect that file's behavioural assertions -- >=50 action
// instances, >=50 contact resolutions, >=1000 damage, >=20 damaged
// combatants, the candidate-check bounds -- while this literal stays
// re-baselinable. See the spec's "Re-baselining: two kinds of artifact".
export const CAPACITY_TRACE_HASH = 'dbe77c5e'
```

In `src/simulation/encounterCapacity.test.ts`, replace `expect(hash).toBe('dbe77c5e')` with `expect(hash).toBe(CAPACITY_TRACE_HASH)` and add the import.

- [ ] **Step 2: Run the capacity suite**

Run: `npx vitest run src/simulation/encounterCapacity.test.ts`
Expected: 10 passed.

- [ ] **Step 3: Move the series literals**

Create `src/testSupport/frozenFixtures/seriesTrace.ts` holding the per-bout hash array and the `'1-2'` score currently inline in `src/simulation/series.test.ts`. Copy the values verbatim from the current file — do not re-derive them.

Note in the file header that `LINEUP_SCORE` is a **product assertion**, not a determinism artifact: design.md requires the all-counter lineup not to sweep, so this value may only change with a spec amendment, while `LINEUP_BOUT_HASHES` may be re-frozen with a reason.

- [ ] **Step 4: Move the golden season literals**

Create `src/testSupport/frozenFixtures/goldenSeason.ts` holding `GOLDEN_OUTCOMES`, `GOLDEN_SCORE` and `GOLDEN_DELTAS` verbatim from `src/simulation/seasonBalance.test.ts:359-395`, with the same header note: these are product assertions.

- [ ] **Step 5: Move the camera trace literals**

Create `src/testSupport/frozenFixtures/cameraTraces.ts` holding the recorded-trace table currently at `src/presentation/ArenaCamera.test.ts:1210` onward (label, lineup, ticks, openingDistance, crossings for each of the nine pairings). Note in the header that `ticks` and `openingDistance` are behavioural: if they move, the bout restructured, and that wants a sentence in the commit.

- [ ] **Step 6: Run the full suite**

Run: `npm test`
Expected: all 778 pass. This is a pure move; a single failure means a literal was transcribed wrong.

- [ ] **Step 7: Commit**

```bash
git add src/testSupport/frozenFixtures src/simulation/encounterCapacity.test.ts src/simulation/series.test.ts src/simulation/seasonBalance.test.ts src/presentation/ArenaCamera.test.ts
git commit -m "refactor(testSupport): split frozen literals out of the four mixed test files"
```

- [ ] **Step 8: Verify the whole PR changes no behaviour**

Run: `npm run check`
Expected: unit tests, build and e2e all pass with **no baseline regenerated**. If a screenshot differs, something in PR 1 changed rendering, which it must not.

- [ ] **Step 9: Open PR 1**

Title: `Retiarius reach, part 1: the measurement seam`. Body states: no behaviour change, proved by `dc635911`, `dbe77c5e` and the unchanged screenshot baselines; and that the CI gate is deliberately in its phase-1 form.

---

# PR 2 — Content

Branch from `main` **after PR 1 merges**, so the diff no longer contains the harness.

### Task 4: Tighten the CI gate to phase 2

**Files:**
- Modify: `scripts/check-allowlist.sh`

- [ ] **Step 1: Add the five now-protected paths**

Extend `FORBIDDEN` with `scripts/measure-reach\.ts$`, `src/testSupport/reachHarness\.ts$`, `src/simulation/(seasonBalance|encounterCapacity|series)\.test\.ts$` and `src/presentation/ArenaCamera\.test\.ts$`. Update the header comment: the two-phase note now describes a completed transition rather than a pending one.

`src/testSupport/frozenFixtures/**` stays **writable** — that is the point of the split.

- [ ] **Step 2: Verify both directions**

```bash
BASE="$(git merge-base main HEAD)"
bash scripts/check-allowlist.sh "$BASE"                       # expect: allowlist ok
printf '\n// probe\n' >> scripts/measure-reach.ts
bash scripts/check-allowlist.sh "$BASE"; echo "exit=$?"       # expect: Forbidden, exit=1
git checkout -- scripts/measure-reach.ts
printf '\nexport const PROBE = 1\n' >> src/testSupport/frozenFixtures/capacityTrace.ts
bash scripts/check-allowlist.sh "$BASE"                       # expect: allowlist ok
git checkout -- src/testSupport/frozenFixtures/capacityTrace.ts
```

- [ ] **Step 3: Commit**

```bash
git add scripts/check-allowlist.sh
git commit -m "ci: protect the reach harness and the split acceptance files"
```

---

### Task 5: Close gate E — the forced disengage must open real ground

The proposed package fails one content gate: the median separation Fast actually gains during a forced disengage is **0.70** against a floor of **0.75** derived from the authored 0.77. Exits shift from 3032 range / 3111 cap to 1328 / 2702 — the mechanic is pinning to its timeout instead of completing.

**Files:**
- Modify: `src/simulation/combatDecision.ts` (`FAST_FORCED_DISENGAGE_END_RANGE`, `FAST_FORCED_DISENGAGE_MAX_TICKS`)
- Read: `scripts/measure-reach.ts` (`DISENGAGE_GAIN_FLOOR`)

**Interfaces:**
- Consumes: `npm run measure:reach -- --seeds 200 --overlay <file> --gate`
- Produces: final values for both constants, carried into Task 6.

- [ ] **Step 1: Write the candidate overlay**

Create a scratch file outside the repo, e.g. `/tmp/reach/package.json`:

```json
{"attacks":{"fast-slash":{"contactRange":{"min":0.9,"max":2.05}},
 "fast-burst-lunge":{"contactRange":{"min":1.6,"max":2.4},"startMaxRange":4.0,"rootTravel":0.5}}}
```

- [ ] **Step 2: Confirm the failure before fixing it**

Set `FAST_FORCED_DISENGAGE_END_RANGE = 3.35`, leave `FAST_FORCED_DISENGAGE_MAX_TICKS` at 30, then run:

`npm run measure:reach -- --seeds 200 --overlay /tmp/reach/package.json --gate`

Expected: `FAIL forced disengage median separation gained 0.70 below 0.75`, exit 1, and every other gate passing. Do not proceed until you have reproduced this exact failure — a fix for a defect you have not observed is a guess.

- [ ] **Step 3: Sweep the two levers**

The mechanic ends at whichever comes first: the fighter reaching `FAST_FORCED_DISENGAGE_END_RANGE`, or `FAST_FORCED_DISENGAGE_MAX_TICKS` elapsing. Gaining more ground means either more time or a nearer exit. Measure, at 200 seeds, in this order:

1. `MAX_TICKS` 36, `END_RANGE` 3.35
2. `MAX_TICKS` 42, `END_RANGE` 3.35
3. `MAX_TICKS` 30, `END_RANGE` 3.00
4. `MAX_TICKS` 36, `END_RANGE` 3.00

Record for each: median gain, median duration, immediate share, exit split, and — because these interact — the head-to-head margin and the two in-envelope shares. Take the **smallest** change from the authored 30/2.4 that clears every gate; a longer forced retreat is a real nerf in `fast vs heavy`, which Task 7 must then absorb.

- [ ] **Step 4: If nothing clears it, stop**

If no combination in Step 3 satisfies gate E jointly with gates A–D, F and G, **do not lower `DISENGAGE_GAIN_FLOOR`.** Write the measured table into the spec under "Where it stands", state which gates conflict, and report. That is the outcome the spec's stopping rule anticipates.

- [ ] **Step 5: Commit the constants**

```bash
git add src/simulation/combatDecision.ts
git commit -m "feat(simulation): retune Fast's forced disengage for the trident's reach"
```

The message must state the measured before/after for all three of gate E's clauses and name the swept alternatives.

---

### Task 6: Apply the catalog change

**Files:**
- Modify: `src/content/combatStyles.ts`
- Test: `src/content/combatStyles.test.ts` (pins the authored values — update the pinned numbers)

- [ ] **Step 1: Update the pinned values test first**

`src/content/combatStyles.test.ts` pins the catalog action by action (`contactRange` at lines 103 and 121 for the two Fast attacks, compared at line 193). Change those two expectations, plus `rootTravel` and `startMaxRange` in the same blocks:

```ts
      // fast-slash
      contactRange: { min: 0.9, max: 2.05 },
      // fast-burst-lunge
      contactRange: { min: 1.6, max: 2.4 },
      startMaxRange: 4.0,
      rootTravel: 0.50,
```

Run: `npx vitest run src/content/combatStyles.test.ts`
Expected: FAIL, reporting the old catalog values `{min: 0.9, max: 1.35}` and `{min: 0.9, max: 1.45}`.

- [ ] **Step 2: Apply the catalog change**

In `src/content/combatStyles.ts`, set exactly the same four values:

```ts
    'fast-slash': {
      contactRange: { min: 0.9, max: 2.05 },
      // ...unchanged fields...
    },
    'fast-burst-lunge': {
      // 1.60 rather than a value interpolated from the equipment: it is
      // `technical-driving-thrust`'s floor, deliberately. The acceptance gate
      // compares the two types' shares of contacts inside the murmillo's
      // envelope, and that share counts the interval [contactRange.min, 1.7],
      // whose WIDTH this floor sets. At 1.4 the retiarius showed 35.4% against
      // the hoplomachus' 11.3% purely because it had three times the room;
      // aligned, the same package measures 5.5%.
      contactRange: { min: 1.6, max: 2.4 },
      startMaxRange: 4.0,
      // 1.40 was the actual cause of the defect, not the contact range: the
      // kernel clamps root travel at max(minimumSeparation, contactRange.min)
      // (encounter.ts:1409), so a lunge carrying 1.40 forward landed on the
      // 0.9 floor whatever its nominal reach. A candidate with reach 2.70 and
      // this field unchanged reproduced the authored 0.90 contact median
      // exactly.
      rootTravel: 0.50,
      // ...unchanged fields...
    },
```

- [ ] **Step 3: Run the catalog test**

Run: `npx vitest run src/content/combatStyles.test.ts`
Expected: PASS.

- [ ] **Step 4: Run the reach gate**

Run: `npm run measure:reach -- --seeds 200 --gate`
Expected: `all reach gates pass`. No `--overlay` — the catalog now holds the values.

- [ ] **Step 5: Commit**

```bash
git add src/content/combatStyles.ts src/content/combatStyles.test.ts
git commit -m "feat(content): give the retiarius the reach his trident implies"
```

---

### Task 7: Restore the counter triangle

`heavy > fast` measures near 92% against a 55–75% band. This is the expensive half of the slice and has its own stopping rule.

**Files:**
- Modify: `src/content/combatStyles.ts` (`damageMultiplier`, `recoveryTicks` only), `src/content/mvpSeries.ts` (fighter stats only)
- Read: `src/simulation/balance.test.ts` — do not edit

- [ ] **Step 1: Measure the damage before tuning**

Run: `npx vitest run src/simulation/balance.test.ts`
Expected: FAIL, printing the compact table. Record every out-of-band figure — both cohorts, roster and equal-stat — before changing anything.

- [ ] **Step 2: Tune within the allowance, one lever at a time**

design.md permits action `damageMultiplier` and `recoveryTicks`, and the roster fighter stats. It does **not** permit `baseWeights`, locomotion speeds or `preferredRange`; those need a spec amendment first.

The retiarius now trades a shorter, safer engagement for a weaker one: it lands further out, which costs it the close-quarters exchanges the old lunge won. Start from `fast-burst-lunge.damageMultiplier` and `recoveryTicks`, which is where Task 13's own calibration started for the same reason (see its note in `combatStyles.ts`).

After each accepted change, re-run **both** `balance.test.ts` and `npm run measure:reach -- --seeds 200 --gate`. Tuning damage and recovery moves selection frequencies, which moves the reach distributions — gate D passes by only 0.8 points, so it can fail after a tuning package that looked harmless.

- [ ] **Step 3: If the bands cannot be met, stop**

Present the failing distributions. Do not widen a band, change a seed range, or edit `balanceCohorts.ts`.

- [ ] **Step 4: Run both suites clean**

Run: `npx vitest run src/simulation/balance.test.ts src/simulation/seasonBalance.test.ts src/simulation/dispositionBalance.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/content/combatStyles.ts src/content/mvpSeries.ts
git commit -m "balance(content): restore the counter triangle at the retiarius' new reach"
```

The message must list every changed number with its before/after and the measurement that forced it, in the form of Task 13's calibration amendment.

---

### Task 8: Re-baseline the determinism artifacts

**Files:**
- Modify: `src/testSupport/frozenFixtures/capacityTrace.ts`, `seriesTrace.ts`, `cameraTraces.ts`; `src/simulation/battle.test.ts` (`dc635911`); `src/testSupport/stateHash.test.ts` (the nine digests); `tests/combat-visuals.spec.ts`, `tests/orders.spec.ts` (the Chromium-side hash and key-pose ticks)

- [ ] **Step 1: Collect the new values**

Run: `npm test` and record every failing literal and its actual value. Do not edit yet.

- [ ] **Step 2: Sanity-check the key-pose ticks before accepting them**

The key-pose ticks 253/817/958/2106 are a behavioural claim. If any moves by more than ~200 ticks, the bout restructured; find out why and write the reason down before re-freezing. A pose tick that moved because the retiarius now spends longer at range is expected; one that moved because a bout got 40% shorter needs explaining.

- [ ] **Step 3: Update the literals**

One commit per artifact family, each message stating why that artifact moved.

- [ ] **Step 4: Verify**

Run: `npm test`
Expected: PASS.

---

### Task 9: Check the product assertions

**Files:**
- Read/modify: `src/testSupport/frozenFixtures/goldenSeason.ts`, `seriesTrace.ts` (`LINEUP_SCORE`)

- [ ] **Step 1: Run the golden scenario**

Run: `npx vitest run src/simulation/seasonBalance.test.ts src/simulation/series.test.ts`

- [ ] **Step 2: Check the two criteria that carry intent**

design.md requires: the all-counter lineup `Brutus→Drusus`, `Aquila→Cassius`, `Nerva→Magnus` does **not** sweep 3–0, and at least one different lineup wins 2–1 or 3–0. If the outcomes moved but both still hold, update `GOLDEN_OUTCOMES`/`GOLDEN_SCORE`/`GOLDEN_DELTAS` and say so.

- [ ] **Step 3: If either criterion breaks, amend the spec first**

Do not update the fixture to whatever the run produced. Write the amendment — the deviation, the measurement that forced it, what it costs — into the spec, then update.

- [ ] **Step 4: Commit**

```bash
git add src/testSupport/frozenFixtures
git commit -m "test(testSupport): re-baseline the golden season at the retiarius' new reach"
```

---

### Task 10: Camera, capacity fixtures and the visual baselines

**Files:**
- Modify: `src/testSupport/frozenFixtures/cameraTraces.ts`, `tests/__screenshots__/**`

- [ ] **Step 1: Prove the camera absorbs the change without being retuned**

`src/presentation/ArenaCamera.ts` is forbidden by the CI gate. Run:

`npx vitest run src/presentation/ArenaCamera.test.ts` and `npx playwright test tests/legibility.spec.ts`

Expected: PASS with only `cameraTraces.ts`'s recorded numbers updated. If a *constant* needs to move for these to pass, that is a finding to report — a slice to schedule, not a number to nudge.

- [ ] **Step 2: Exercise the contact-priority and multi-attacker fixtures**

`fast-slash` now reaches from ~2.30 units with contact priority 40, which resolves ahead of most other attacks. Run:

`npx vitest run src/simulation/encounterCapacity.test.ts src/simulation/encounter.test.ts`

Expected: PASS, **including** the capacity suite's non-hash gates (≥50 action instances, ≥50 contact resolutions, ≥1000 damage, ≥20 damaged combatants) and the five-attacker/single-defender defense-batch fixture.

- [ ] **Step 3: Regenerate the screenshots deliberately**

```bash
npx playwright test                      # first WITHOUT --update-snapshots
npx playwright test --update-snapshots   # only after reviewing what mismatched
```

Look at every regenerated PNG before committing it. Then refresh the Linux set in the container, per `AGENTS.md`.

- [ ] **Step 4: Full check**

Run: `npm run check` and `npm run measure:reach -- --seeds 200 --gate`
Expected: both pass.

- [ ] **Step 5: Commit and open PR 2**

The PR body states the player hypothesis, the before/after for every gate, and attaches a screenshot — per `AGENTS.md`'s working agreement.

---

## Self-review notes

- **Spec coverage.** Gates A–D and F–G are asserted by `measure:reach --gate` (Tasks 5, 6, 7). Gate E is Task 5. Gate H is Task 7. Gate I is Task 10. The two-phase CI gate is Tasks 3 and 4. The re-baseline rule's two classes are Tasks 8 (determinism) and 9 (product). The `fast-slash` second-order risks are Task 10 Step 2.
- **Not covered by any task, deliberately:** the human review gate. This slice's playtest is a separate session; the spec's player-facing acceptance is what it tests.
- **Known thin margin:** gate D passes by 0.8 points, which is why Task 7 Step 2 requires re-running the reach gate after *every* accepted tuning package rather than once at the end.
