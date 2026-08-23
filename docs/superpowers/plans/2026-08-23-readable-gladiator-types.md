# Readable Gladiator Types Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make a bout readable — name each fighter by historical type, draw each type so its equipment is identifiable at the size it is actually rendered, and frame the fight closely enough that spacing differences occupy real screen distance — without changing one bit of simulated behaviour.

**Architecture:** Three presentation-only changes over an unchanged simulation. `gladiatorTypes.ts` maps internal archetype ids (`heavy`/`fast`/`technical`) to player-facing identity, as `dispositionLabels.ts` does for dispositions. `ProceduralFighter`'s `StyleSpec` grows weapon/shield/helmet *kinds* and an off-hand prop so the three silhouettes can exist at all. Only then is framing measured and `ArenaCamera.extentToDistance` re-derived — because the rig's equipment radius is the camera's own input, so measuring before the props are final measures the wrong camera.

**Tech Stack:** TypeScript, Vite, Vitest, Playwright, Three.js.

**Spec:** `docs/superpowers/specs/2026-08-23-readable-gladiator-types-design.md` — read it first.

**Revision note.** This plan was reviewed externally before execution and rewritten: the task order was wrong (measurement ran before the props it measures), the invariant hash silently hashed nothing, and the scale criterion was geometrically impossible as written. Each fix is marked **[rev]**.

## Global Constraints

- **Behaviour-change allowlist.** No change to `src/simulation/**`, `src/content/combatStyles.ts`, `src/content/mvpSeries.ts`, `src/content/season.ts`, or any `BattleConfig`/`EncounterConfig` construction. Task 1 enforces it.
- Archetype ids (`heavy`, `fast`, `technical`) and action ids (`heavy-cleave` …) never change: the trace hash folds `JSON.stringify(event)` and events carry action ids.
- **Frozen:** `dc635911`, `encounterCapacity`'s hash, key-pose ticks 253/817/958/2106, balance cohorts, golden season — all pass **with no edit to any existing simulation test**.
- **Changed deliberately:** every combat/planning/season screenshot baseline, win32 and linux. Look at each regenerated PNG.
- UI copy is English. Type names: `Murmillo` (`heavy`), `Hoplomachus` (`technical`), `Retiarius` (`fast`). The words `Heavy`/`Fast`/`Technical` must not appear on any player-facing surface.
- **Pre-committed scale floor [rev]:** minimum on-screen **body** height (head-to-foot silhouette, excluding long handheld props) ≥ **130 px**, asserted **only at 1280×820** and **only on ticks whose recorded `groupExtent` lies inside the final tactical band**. Chosen before implementation on purpose. Current measured range is 50–90 px. The opening frame (separation 8.4, outside the band) and the narrower viewports are governed by the safe-area rule instead, never by the floor — at 1024 the canvas is roughly 544 px wide and 130 px is provably unreachable there.
- **Safe area:** each fighter's full AABB — every prop included — stays inside a 5% inset of the **canvas** (not the viewport) on both axes, on every tick of all nine pairings, at 1280×820, 1024×768 and 820×640. Permitted arena-decoration cropping: the arena ring may leave frame; no part of either fighter's full AABB may.
- **If the floor and the safe area cannot hold together, stop and report it as a design finding with the numbers. Do not lower the floor.**
- A disengaging fighter never turns their back.
- Checks: unit change → `npm test`; visual change → `npm run test:e2e`; handoff → `npm run check` plus `npm run check:allowlist`. Linux baselines via the docker recipe in `AGENTS.md`.
- Conventional commits, no LLM attribution (no `Co-Authored-By`, no 🤖).

## File structure

| File | Responsibility |
|---|---|
| `src/presentation/gladiatorTypes.ts` *(new)* | Archetype id → player-facing type identity. Mirrors `dispositionLabels.ts`. |
| `src/presentation/legibilityMode.ts` *(new)* | Dev-only five-configuration switch threaded into views, rig and camera. |
| `src/presentation/SeriesView.ts`, `SeasonView.ts` | Consume `gladiatorTypes.ts`; name the type on every surface including active battle cards and summaries. |
| `src/presentation/ProceduralFighter.ts` | `StyleSpec.equipment` grows weapon/shield/helmet kinds, greaves, shoulder guard, off-hand prop; weapons oriented `hand → tip`; radius from real prop AABBs. |
| `src/presentation/ArenaCamera.ts` | `extentToDistance` exported and piecewise; measured extent exposed. |
| `src/presentation/ArenaView.ts` | Camera constants; debug snapshot gains `bodyHeightPx`, `fullBoundsPx`, projected centres, `groupExtent`. |
| `src/main.ts` | Dev API: atomic step, legibility mode, screen metrics. |
| `src/testSupport/stateHash.test.ts` *(new)* | The behaviour invariant. Deliberately outside `src/simulation/`. |
| `scripts/check-allowlist.sh` *(new)* | Positive-allowlist diff gate. |
| `scripts/measure-framing.ts` *(new)* | Per-tick extent, body height, full bounds, screen separation across nine pairings. |
| `scripts/record-blinded-stills.ts` *(new)* | Randomised unlabelled monochrome/greyscale/colour-vision stills plus a separate answer key. |
| `tests/legibility.spec.ts` *(new)* | Scale floor, safe area, naming coverage, screen-separation attenuation. |

---

### Task 1: Behaviour invariant harness **[rev]**

Every later task is a visual change; this is what makes "nothing behavioural moved" checkable.

**Files:**
- Create: `src/testSupport/stateHash.ts`, `src/testSupport/stateHash.test.ts`
- Create: `scripts/check-allowlist.sh`
- Modify: `package.json`, `src/presentation/ArenaView.ts`

**Interfaces:**
- Produces: `canonicalHash(value: unknown): string`; `npm run check:allowlist`.

- [ ] **Step 1: Write the canonical serializer and its negative self-test**

The obvious version is wrong: `JSON.stringify(value, Object.keys(value).sort())` passes an **array replacer**, which JSON treats as a recursive property allowlist — nested fields not named in that top-level list serialise as `{}`, so HP, position and RNG changes would not move the digest at all.

```ts
// src/testSupport/stateHash.ts
/** Order-independent canonical JSON: sorts keys at EVERY depth. An array
 *  replacer would instead act as a recursive property allowlist and silently
 *  hash almost nothing. */
export function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'null'
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`
  const entries = Object.entries(value as Record<string, unknown>).sort(([a], [b]) => (a < b ? -1 : 1))
  return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonicalJson(v)}`).join(',')}}`
}

export function canonicalHash(value: unknown): string {
  const json = canonicalJson(value)
  let hash = 2166136261
  for (let i = 0; i < json.length; i += 1) {
    hash ^= json.charCodeAt(i)
    hash = Math.imul(hash, 16777619)
  }
  return (hash >>> 0).toString(16)
}
```

```ts
// src/testSupport/stateHash.test.ts -- the self-test comes FIRST
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
```

- [ ] **Step 2: Write the rolling per-tick invariant**

Hash the **whole `BattleState` after every tick**, not just the terminal combatants: `tick`, `phase`, per-combatant RNG, `result`, winner and finish reason all belong in it.

```ts
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
  expect(rows).toMatchInlineSnapshot()
})
```

- [ ] **Step 3: Record the baseline**

Run: `npx vitest run src/testSupport/stateHash.test.ts -u`
Expected: nine filled rows. Read them, then re-run **without** `-u` and confirm green. These digests are what every later task must reproduce unchanged.

- [ ] **Step 4: Write the allowlist gate as a positive allowlist**

A denylist of four prefixes misses renames, submodules, staged/untracked work and semantic cases like a `BattleConfig` built in `src/testSupport/balanceCohorts.ts`. Invert it:

```bash
#!/usr/bin/env bash
# scripts/check-allowlist.sh — every path this slice is allowed to touch.
set -euo pipefail
BASE="${1:?base sha required}"
ALLOWED='^(src/presentation/|src/main\.ts$|src/testSupport/stateHash|scripts/(check-allowlist\.sh|measure-framing\.ts|record-blinded-stills\.ts|record-review-clips\.ts)$|tests/|docs/|README\.md$|package\.json$)'
# Committed + staged + unstaged + untracked, and both sides of every rename.
CHANGED="$( { git diff --name-status -z --find-renames "$BASE" HEAD; git diff --name-status -z --find-renames HEAD; git diff --name-status -z --find-renames --cached; } \
  | tr '\0' '\n' | grep -vE '^[A-Z][0-9]*$' | sort -u )"
UNTRACKED="$(git ls-files --others --exclude-standard)"
VIOLATIONS="$(printf '%s\n%s\n' "$CHANGED" "$UNTRACKED" | grep -v '^$' | grep -vE "$ALLOWED" || true)"
if [ -n "$VIOLATIONS" ]; then echo "Not on the slice allowlist:" >&2; echo "$VIOLATIONS" >&2; exit 1; fi
echo "allowlist ok"
```

The invariant test lives in `src/testSupport/` precisely so this gate needs no `*.test.ts` escape hatch — existing frozen simulation tests stay forbidden, including disabling them.

- [ ] **Step 5: Freeze exactly the render frame, and prove it**

Freeze only `BattleRenderFrame`'s battle states and events (`ArenaView.ts:29-34`) via a `WeakSet`-guarded `deepFreeze` before `applyFrame`. Do **not** freeze `this.rigs`, the scene or the camera — those are legitimately mutated every frame and freezing them breaks the render loop. Add the test the spec asks for: canonical JSON of the current battle before `sync`, after `sync`, and after a dev replay must be byte-identical.

- [ ] **Step 6: Commit**

```bash
npm test && bash scripts/check-allowlist.sh $(git merge-base main HEAD)
git add src/testSupport scripts/check-allowlist.sh src/presentation/ArenaView.ts package.json
git commit -m "test: per-tick behaviour invariant and slice allowlist gate"
```

---

### Task 2: Gladiator type identity on every surface **[rev]**

**Files:**
- Create: `src/presentation/gladiatorTypes.ts`, `gladiatorTypes.test.ts`
- Modify: `src/presentation/SeriesView.ts` (`ARCHETYPE_LABELS` :27; uses :382, :431, :479; counter rule :332; **active battle cards ~:673-689; summary rows ~:616-651**)
- Modify: `src/presentation/SeasonView.ts` (`ARCHETYPE_LABELS` :18; uses :123, :134, :150)

**Interfaces:**
- Produces: `TYPE_NAMES`, `TYPE_DESCRIPTIONS`, `COUNTER_RULE_TEXT` — all `Record<Archetype, string>` except the last.

Note the scope correction: the active battle card renders only school, name and HP today, and summary rows carry no type at all. Naming "every fighter by type" therefore requires **adding** the type there, not just swapping a label. Anything `TYPE_DESCRIPTIONS` is not consumed by must be deleted rather than shipped dead.

- [ ] **Step 1: Write the failing test**

```ts
// src/presentation/gladiatorTypes.test.ts
import { describe, expect, it } from 'vitest'
import { COUNTER_RULE_TEXT, TYPE_DESCRIPTIONS, TYPE_NAMES } from './gladiatorTypes'

describe('gladiator type identity', () => {
  it('names every archetype and leaks no mechanics id', () => {
    expect(TYPE_NAMES).toEqual({ heavy: 'Murmillo', fast: 'Retiarius', technical: 'Hoplomachus' })
    const copy = [...Object.values(TYPE_NAMES), ...Object.values(TYPE_DESCRIPTIONS), COUNTER_RULE_TEXT].join(' ')
    for (const id of ['Heavy', 'Fast', 'Technical']) expect(copy).not.toContain(id)
  })
  it('states the counter rule in type names', () => {
    for (const name of Object.values(TYPE_NAMES)) expect(COUNTER_RULE_TEXT).toContain(name)
  })
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run src/presentation/gladiatorTypes.test.ts` → FAIL, module missing.

- [ ] **Step 3: Implement**

```ts
// src/presentation/gladiatorTypes.ts
// The only place an internal archetype id becomes player-facing identity.
// `fast` is the retiarius because `fast` holds the LONGEST preferred range
// of the three (2.4-3.0) and retreats most -- reach-and-give-ground, not
// in-and-out brawling. See the design spec's "The three types".
import type { Archetype } from '../simulation/fighters'

export const TYPE_NAMES: Record<Archetype, string> = {
  heavy: 'Murmillo',
  fast: 'Retiarius',
  technical: 'Hoplomachus',
}

export const TYPE_DESCRIPTIONS: Record<Archetype, string> = {
  heavy: 'closes behind the great shield and strikes short',
  fast: 'fights at reach with net and trident, giving ground',
  technical: 'holds the spear at long range and thrusts from outside',
}

/** The school's own scheme, not a historical taxonomy. */
export const COUNTER_RULE_TEXT = 'Murmillo beats Retiarius beats Hoplomachus beats Murmillo'
```

- [ ] **Step 4: Wire every surface**

Replace both `ARCHETYPE_LABELS`; add `TYPE_NAMES[...]` to the active battle cards and to summary rows; replace the counter rule; add the one-line school-scheme note. Use `TYPE_DESCRIPTIONS` on the roster/opponent cards or delete it.

- [ ] **Step 5: Run and commit**

Run: `npm test` → PASS, no simulation test edited.

```bash
git add src/presentation/gladiatorTypes.ts src/presentation/gladiatorTypes.test.ts src/presentation/SeriesView.ts src/presentation/SeasonView.ts
git commit -m "feat: name fighters by historical gladiator type on every surface"
```

---

### Task 3: Rig capability for the three kits **[rev — expanded]**

The rig cannot express any of the three silhouettes. `buildEquipment` (~:499-527) builds one `BoxGeometry` weapon plus a cone tip only for `technical`, one cylindrical shield, and a shared dome+crest helmet (~:578-595). `EquipmentProportions` (:188-205) has no notion of weapon kind, shield kind or absence, helmet kind, greaves, shoulder guard or a second prop. Task 4 authors values only; **everything it needs must exist after this task.**

**Files:**
- Modify: `src/presentation/ProceduralFighter.ts` (`EquipmentProportions` :188-205, `buildEquipment` ~:499-595, `computeHorizontalEquipmentRadius` :599-611)
- Modify: `src/presentation/ProceduralFighter.test.ts` (including the existing all-archetypes shield expectation at :163-194, which now must become per-kind)

**Interfaces:**
- Produces: `EquipmentProportions` gains `weaponKind: 'gladius' | 'spear' | 'trident'`, `shieldKind: 'scutum' | 'parma' | 'none'`, `shieldWidth`, `shieldHeight`, `shieldCurvature`, `helmetKind: 'brimmed-crested' | 'brimmed' | 'none'`, `greaves: 'none' | 'one-low' | 'two-high'`, `shoulderGuard: boolean`, `offhandProp?: 'net'`. `horizontalEquipmentRadius` derived from real prop AABBs.

- [ ] **Step 1: Write the failing tests**

```ts
// added to src/presentation/ProceduralFighter.test.ts
// Helpers this file does not have yet — add them beside the tests.
import * as THREE from 'three'
import { createProceduralFighter, type ProceduralFighter } from './ProceduralFighter'

const propSlots = (f: ProceduralFighter): string[] => {
  const slots: string[] = []
  f.root.traverse((o) => { if (o.userData.slot) slots.push(String(o.userData.slot)) })
  return slots
}
const findBySlot = (f: ProceduralFighter, slot: string): THREE.Object3D | undefined => {
  let found: THREE.Object3D | undefined
  f.root.traverse((o) => { if (!found && o.userData.slot === slot) found = o })
  return found
}

describe('equipment kinds', () => {
  it('builds no shield mesh for a shieldless kit', () => {
    const f = createProceduralFighter({ archetype: 'fast' })
    expect(propSlots(f)).not.toContain('shield')
    f.dispose()
  })

  it('builds a scutum taller than it is wide', () => {
    const f = createProceduralFighter({ archetype: 'heavy' })
    const size = new THREE.Box3().setFromObject(findBySlot(f, 'shield')!).getSize(new THREE.Vector3())
    expect(size.y / size.x).toBeGreaterThan(1.3)
    f.dispose()
  })

  it('points the weapon mesh along the hand-to-tip segment', () => {
    // Direction, not containment: a large axis-aligned Box3 contains the tip
    // even when the mesh runs along the wrong axis.
    const f = createProceduralFighter({ archetype: 'technical' })
    const hand = new THREE.Vector3(); f.anchors.get('weaponHand')!.getWorldPosition(hand)
    const tip = new THREE.Vector3(); f.anchors.get('weaponTip')!.getWorldPosition(tip)
    const mesh = findBySlot(f, 'weapon') as THREE.Mesh
    const meshAxis = new THREE.Vector3(0, 1, 0).applyQuaternion(mesh.getWorldQuaternion(new THREE.Quaternion()))
    expect(meshAxis.dot(tip.clone().sub(hand).normalize())).toBeGreaterThan(0.95)
    f.dispose()
  })

  it('derives the equipment radius from real prop bounds, not a shield constant', () => {
    const f = createProceduralFighter({ archetype: 'fast' })
    let expected = 0
    f.root.updateMatrixWorld(true)
    f.root.traverse((o) => {
      if (!o.userData.slot) return
      const box = new THREE.Box3().setFromObject(o)
      for (const [x, z] of [[box.min.x, box.min.z], [box.max.x, box.max.z]]) expected = Math.max(expected, Math.hypot(x, z))
    })
    expect(f.horizontalEquipmentRadius).toBeCloseTo(expected, 2)
    f.dispose()
  })
})
```

- [ ] **Step 2: Run to verify they fail**

Run: `npx vitest run src/presentation/ProceduralFighter.test.ts`
Expected: the shield-absence, scutum-shape, weapon-axis and radius tests all fail. The existing shield expectation at :163-194 will also fail once `fast` loses its shield — rewrite it to assert per kind, do not delete it.

- [ ] **Step 3: Implement the capability**

Extend `EquipmentProportions`; branch geometry per kind (gladius box / spear shaft+cone / trident shaft + three prongs; scutum curved slab / parma cylinder / none; helmet brimmed±crest / none; greaves; shoulder guard; net as a flattened off-hand prop). Build each weapon along its own local axis and rotate it onto the normalised `hand → tip` vector. Rewrite `computeHorizontalEquipmentRadius` to take the max horizontal reach over the real `Box3` of every `userData.slot` prop.

- [ ] **Step 4: Run tests**

Run: `npx vitest run src/presentation/` → PASS. `npm test` → PASS. `bash scripts/check-allowlist.sh <base>` → ok.

- [ ] **Step 5: Commit**

```bash
git add src/presentation/ProceduralFighter.ts src/presentation/ProceduralFighter.test.ts
git commit -m "feat: weapon, shield, helmet and off-hand prop kinds in the rig"
```

---

### Task 4: The three silhouettes and the equipment bible **[rev]**

**Files:**
- Modify: `src/presentation/ProceduralFighter.ts` (`STYLE_SPECS` :207-316 — values only)
- Create: `docs/reference/gladiator-equipment.md`
- Modify: `src/presentation/ProceduralFighter.test.ts`

- [ ] **Step 1: Write the equipment bible first**

One row per visual element: element, shape as drawn, which `STYLE_SPECS` field carries it, **confidence** (attested / reconstructed / contested), and source. Contested details are listed as explicitly *not* asserted. This is the artifact the spec promises; authoring against it prevents inventing detail.

| Type | Attested | Reconstructed | Not asserted |
|---|---|---|---|
| Murmillo | curved rectangular scutum; gladius; brimmed helmet with face guard; right-arm manica; one low ocrea on the left leg | closes and works inside | exact crest figure |
| Hoplomachus | thrusting spear; small round parma; two high padded greaves; brimmed helmet | holds long range | secondary short blade (**not drawn** — the engine has one weapon stream) |
| Retiarius | net; trident; no shield; no helmet; left-arm manica with galerus | gives ground at reach | blade form of the pugio |

- [ ] **Step 2: Write the failing test**

```ts
describe('type silhouettes', () => {
  it('separates the three by horizontal equipment reach', () => {
    const reach = (a: Archetype): number => {
      const f = createProceduralFighter({ archetype: a }); const v = f.horizontalEquipmentRadius; f.dispose(); return v
    }
    const [murmillo, retiarius, hoplomachus] = [reach('heavy'), reach('fast'), reach('technical')]
    expect(Math.abs(hoplomachus - murmillo)).toBeGreaterThan(0.3)
    expect(Math.abs(retiarius - murmillo)).toBeGreaterThan(0.3)
  })
  it('gives the retiarius a net and no helmet', () => {
    const f = createProceduralFighter({ archetype: 'fast' })
    expect(propSlots(f)).toContain('net')
    expect(propSlots(f)).not.toContain('helmet')
    f.dispose()
  })
})
```

- [ ] **Step 3: Run to verify it fails, then author**

Run: `npx vitest run src/presentation/ProceduralFighter.test.ts` → FAIL (no net exists yet). Then edit `STYLE_SPECS` values only. The spear must be visibly thicker than today's `weaponWidth: 0.045`, which lands at roughly two pixels at the shipped framing. Body proportions stay untouched.

- [ ] **Step 4: Look at it**

`npm run dev`, view all three at the shipped framing. Report what you can and cannot tell apart — first moment the slice's premise is observable, and the trident-versus-spear risk is the one to watch.

- [ ] **Step 5: Commit**

```bash
git add src/presentation/ProceduralFighter.ts src/presentation/ProceduralFighter.test.ts docs/reference/gladiator-equipment.md
git commit -m "feat: murmillo, hoplomachus and retiarius silhouettes"
```

---

### Task 5: Framing measurement harness **[rev — now runs on the final rig]**

Camera constants cannot be written from a desk, and they must be measured against the **final** props: `horizontalEquipmentRadius` is the camera's own input (`ArenaView.ts:693-703`).

**Files:**
- Modify: `src/presentation/ArenaCamera.ts` (export a pure `measuredExtent` helper alongside `extentToDistance`)
- Modify: `src/presentation/ArenaView.ts` (`ArenaDebugSnapshot` :49)
- Modify: `src/main.ts` (dev API)
- Create: `scripts/measure-framing.ts`

**Interfaces:**
- Produces: snapshot fields `groupExtent: number`, and per combatant `bodyHeightPx`, `fullBoundsPx: { minX, maxX, minY, maxY }`, `centerPx: { x, y }`, plus `canvasPx: { width, height }`; dev API `stepBattleAndCamera(ticks: number, dtSeconds: number): void`.

Two traps this task exists to avoid. `measureGroup` is private and yaw-dependent and adds a 10% margin per radius — the script must read the camera's *own* measure, not recompute it. And `advanceTicks` runs every tick then renders once, while camera damping is wall-clock; `stepBattleAndCamera` performs one simulation tick, one camera update with a fixed `dt`, and one render, so "per tick as the player sees it" is defined.

- [ ] **Step 1: Add the snapshot fields and the atomic step**

`bodyHeightPx` projects the body+helmet silhouette only; `fullBoundsPx` projects every prop. They are different numbers on purpose: a long vertical spear must not be able to satisfy a *body* size floor.

- [ ] **Step 2: Write the script**

Drive the nine pairings at seed `20260815` under `?snapshot`, wait for the canvas resize, then `stepBattleAndCamera(1, 1/60)` per tick and read exactly one snapshot after each. Record per tick: `groupExtent`, both `bodyHeightPx`, both `fullBoundsPx`, world separation and screen-space centre separation. Run at all three viewport sizes. Print per pairing and overall: extent min/median/p95/max, body height min/median/max, safe-area violations, and `Δscreen/Δworld`.

- [ ] **Step 3: Run it and paste the numbers into Task 6**

Run: `npx vite-node scripts/measure-framing.ts`
The band edges and the flat-distance search space are these numbers. Do not proceed on estimates.

- [ ] **Step 4: Commit**

```bash
git add scripts/measure-framing.ts src/presentation/ArenaView.ts src/presentation/ArenaCamera.ts src/main.ts
git commit -m "test: measure extent, body height, bounds and screen separation on the final rig"
```

---

### Task 6: Piecewise camera framing, chosen by sweep **[rev]**

**Files:**
- Modify: `src/presentation/ArenaCamera.ts` (:134-149 — and **export** `extentToDistance`, which is module-private today, so the test can address it)
- Modify: `src/presentation/ArenaView.ts` (`CAMERA_MIN_DISTANCE` :75)
- Modify: `src/presentation/ArenaCamera.test.ts` (imports only `ArenaCamera` and `measureSpreadAxisAngle` today)

**Context.** Today: `clamp(8.5 + 0.8 × extent, 11, 18)`; the lower clamp binds below extent 3.125, so a flat region already exists. The defect is that **11 is too far** — hence 50–90 px. The old line cannot "resume" at the band edge because it already sits above any flat value low enough to clear the floor.

- [ ] **Step 1: Sweep for the constants before writing them**

Extend `scripts/measure-framing.ts` with a search: for each candidate `(FLAT_DISTANCE, EASE_WIDTH_EXTENT)` on a grid, replay the recorded traces, and reject any candidate that breaks the safe area at any viewport or misses the 130 px body floor at 1280×820 inside the band. Among survivors pick the one with the least total camera motion. **Write the chosen numbers and three worked examples — inside the band, at the junction, at the far clamp — into this task before handing it to an implementer.** If no candidate survives, stop and report: that is the design finding, not a reason to lower the floor.

- [ ] **Step 2: Write the failing test**

```ts
// src/presentation/ArenaCamera.test.ts — substitute the swept constants
describe('piecewise framing distance', () => {
  it('is flat across the tactical band', () => {
    for (const extent of [BAND_LOW, (BAND_LOW + BAND_HIGH) / 2, BAND_HIGH]) {
      expect(extentToDistance(extent, MIN_DISTANCE, MAX_DISTANCE)).toBeCloseTo(FLAT_DISTANCE, 6)
    }
  })
  it('widens monotonically beyond the band and respects the far clamp', () => {
    let previous = FLAT_DISTANCE
    for (let extent = BAND_HIGH; extent <= BAND_HIGH + 12; extent += 0.25) {
      const d = extentToDistance(extent, MIN_DISTANCE, MAX_DISTANCE)
      expect(d).toBeGreaterThanOrEqual(previous - 1e-9)
      previous = d
    }
    expect(extentToDistance(1e6, MIN_DISTANCE, MAX_DISTANCE)).toBe(MAX_DISTANCE)
  })
  it('joins the regions with a continuous first derivative', () => {
    const h = 1e-4
    const slope = (x: number): number =>
      (extentToDistance(x + h, MIN_DISTANCE, MAX_DISTANCE) - extentToDistance(x - h, MIN_DISTANCE, MAX_DISTANCE)) / (2 * h)
    expect(slope(BAND_HIGH - 10 * h)).toBeCloseTo(0, 3)
    expect(slope(BAND_HIGH + 10 * h)).toBeCloseTo(0, 3)
  })
})
```

- [ ] **Step 3: Run to verify it fails**

Run: `npx vitest run src/presentation/ArenaCamera.test.ts` → FAIL (and note it will not even compile until `extentToDistance` is exported).

- [ ] **Step 4: Implement**

```ts
export function extentToDistance(extent: number, minDistance: number, maxDistance: number): number {
  if (extent <= BAND_HIGH_EXTENT) return clamp(FLAT_DISTANCE, minDistance, maxDistance)
  const t = Math.min(1, (extent - BAND_HIGH_EXTENT) / EASE_WIDTH_EXTENT)
  const eased = t * t * (3 - 2 * t) // smoothstep: C1 at the junction, so no lurch
  return clamp(FLAT_DISTANCE + eased * (maxDistance - FLAT_DISTANCE), minDistance, maxDistance)
}
```

Set `CAMERA_MIN_DISTANCE` to `FLAT_DISTANCE` so the clamp cannot override the flat region.

- [ ] **Step 5: Run and commit**

Run: `npm test`, `npm run check:allowlist`.

```bash
git add src/presentation/ArenaCamera.ts src/presentation/ArenaCamera.test.ts src/presentation/ArenaView.ts
git commit -m "feat: flat framing distance across the tactical band"
```

---

### Task 7: Camera motion bounds **[rev]**

**Files:** modify `src/presentation/ArenaCamera.ts`, `ArenaCamera.test.ts`.

The constructor starts at the middle of the clamp (:376-386), so a test that begins sampling immediately measures the opening settle, not band-edge behaviour.

- [ ] **Step 1: Write the failing test**

```ts
describe('framing distance under motion', () => {
  const settle = (camera: ArenaCamera, extent: number): void => {
    camera.reset(targetsWithExtent(extent))
    for (let i = 0; i < 300; i += 1) camera.update(targetsWithExtent(extent), 1 / 60)
  }

  it('does not chatter when the pair oscillates across the band edge', () => {
    const camera = new ArenaCamera({ minDistance: MIN_DISTANCE, maxDistance: MAX_DISTANCE })
    settle(camera, BAND_HIGH)
    const distances: number[] = []
    // Amplitude must exceed the 12% framing dead zone, or the test proves
    // only that the dead zone swallowed the wobble.
    for (let step = 0; step < 600; step += 1) {
      camera.update(targetsWithExtent(BAND_HIGH + OSCILLATION_AMPLITUDE * Math.sin(step / 30)), 1 / 60)
      distances.push(camera.state.distance)
    }
    const reversals = distances.slice(2).filter((d, i) => {
      const a = Math.sign(distances[i + 1] - distances[i]); const b = Math.sign(d - distances[i + 1])
      return a !== 0 && b !== 0 && a !== b
    }).length
    expect(reversals).toBeLessThanOrEqual(4)
    expect(Math.max(...distances) - Math.min(...distances)).toBeLessThan(0.35)
  })

  it('sweeps out and back without overshoot or excessive zoom rate', () => {
    const camera = new ArenaCamera({ minDistance: MIN_DISTANCE, maxDistance: MAX_DISTANCE })
    settle(camera, BAND_HIGH)
    const seen: number[] = []
    for (let e = BAND_HIGH; e <= BAND_HIGH + 6; e += 0.05) { camera.update(targetsWithExtent(e), 1 / 60); seen.push(camera.state.distance) }
    for (let e = BAND_HIGH + 6; e >= BAND_HIGH; e -= 0.05) { camera.update(targetsWithExtent(e), 1 / 60); seen.push(camera.state.distance) }
    expect(Math.max(...seen)).toBeLessThanOrEqual(MAX_DISTANCE + 1e-6)
    expect(seen[seen.length - 1]).toBeCloseTo(FLAT_DISTANCE, 1)
    const maxRate = Math.max(...seen.slice(1).map((d, i) => Math.abs(d - seen[i]) * 60))
    expect(maxRate).toBeLessThan(MAX_ZOOM_UNITS_PER_SECOND)
  })
})
```

- [ ] **Step 2: Run it, and record which outcome you got**

Both outcomes are informative: the oscillation test may pass unchanged because the existing 12% dead zone plus 1.25 s damping already suppress chatter. **Only add explicit enter/exit thresholds if it fails.** If it passes, comment `DISTANCE_DEAD_ZONE_FRACTION` to record that it is load-bearing for the band edge.

- [ ] **Step 3: Replay a real trace**

Run the same assertions over one recorded per-tick extent trace from Task 5, not only synthetic sine input.

- [ ] **Step 4: Watch it**

`npm run dev`, play a bout that crosses the edge repeatedly. Static tests cannot see a lurch. Report what you saw.

- [ ] **Step 5: Commit**

```bash
git add src/presentation/ArenaCamera.ts src/presentation/ArenaCamera.test.ts
git commit -m "test: bound camera motion across the band edge"
```

---

### Task 8: Legibility acceptance in e2e **[rev]**

**Files:** create `tests/legibility.spec.ts`; modify `src/main.ts` if a hook is missing.

Three corrections over the naive version. The app boots on the season board and `advanceTicks` returns early with no active series (`src/main.ts:282-285`), so a test that only calls `advanceTicks` iterates an **empty** metrics object and passes vacuously. Metrics are canvas pixels, so they must be compared against canvas dimensions, not viewport width. And the floor applies only at 1280×820 inside the band.

- [ ] **Step 1: Write the fixture helper**

`startBout(page, { homeId, boutIndex })`: load `?seed=20260815&snapshot`, `startNextSeries`, assign the lineup, `confirm`, reach the requested slot. Assert `Object.keys(metrics).length === 2` before any geometry loop — that assertion is what makes the rest non-vacuous.

- [ ] **Step 2: Write the spec**

```ts
const MIN_BODY_HEIGHT_PX = 130 // pre-committed; never lowered to make a run green
const SAFE_INSET = 0.05

test('body height clears the floor inside the band at 1280x820', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 820 })
  await startBout(page, { homeId: 'brutus', boutIndex: 0 })
  const metrics = await collectPerTick(page, 3600)
  const inBand = metrics.filter((m) => m.groupExtent <= BAND_HIGH)
  expect(inBand.length).toBeGreaterThan(0)
  for (const m of inBand) for (const f of Object.values(m.fighters)) {
    expect(f.bodyHeightPx).toBeGreaterThanOrEqual(MIN_BODY_HEIGHT_PX)
  }
})

for (const viewport of [{ width: 1280, height: 820 }, { width: 1024, height: 768 }, { width: 820, height: 640 }]) {
  test(`full bounds stay inside the safe area at ${viewport.width}`, async ({ page }) => {
    await page.setViewportSize(viewport)
    await startBout(page, { homeId: 'brutus', boutIndex: 0 })
    const metrics = await collectPerTick(page, 3600)
    for (const m of metrics) for (const f of Object.values(m.fighters)) {
      expect(f.fullBoundsPx.minX).toBeGreaterThanOrEqual(m.canvasPx.width * SAFE_INSET)
      expect(f.fullBoundsPx.maxX).toBeLessThanOrEqual(m.canvasPx.width * (1 - SAFE_INSET))
      expect(f.fullBoundsPx.minY).toBeGreaterThanOrEqual(m.canvasPx.height * SAFE_INSET)
      expect(f.fullBoundsPx.maxY).toBeLessThanOrEqual(m.canvasPx.height * (1 - SAFE_INSET))
    }
  })
}

test('screen separation tracks world separation inside the band', async ({ page }) => {
  // The slice's actual hypothesis: spacing differences must occupy real
  // screen distance. Attenuation is measured against a fixed-camera
  // projection of the same trace.
  const samples = await collectPerTick(page, 3600)
  const ratio = attenuationRatio(samples.filter((m) => m.groupExtent <= BAND_HIGH))
  expect(ratio).toBeGreaterThan(MIN_ATTENUATION_RATIO)
})

test('every phase names types and no phase names a mechanics id', async ({ page }) => {
  for (const phase of ['season-board', 'planning', 'fighting', 'between-bouts', 'series-summary', 'season-summary'] as const) {
    await reachPhase(page, phase)
    const text = await page.locator('body').innerText()
    expect(text).toMatch(/Murmillo|Hoplomachus|Retiarius/)
    for (const id of ['Heavy', 'Fast', 'Technical']) expect(text).not.toContain(id)
  }
})
```

`MIN_ATTENUATION_RATIO` is set from Task 5's measurement **before** implementation, like the floor.

- [ ] **Step 3: Run across all nine pairings**

Run: `npm run build && npx playwright test tests/legibility.spec.ts`
Parameterise the geometry tests over all nine pairings. If the floor fails while the safe area holds, report the achievable number and stop.

- [ ] **Step 4: Commit**

```bash
git add tests/legibility.spec.ts src/main.ts
git commit -m "test: scale floor, safe area, separation attenuation and naming coverage"
```

---

### Task 9: Five-configuration review material **[rev]**

**Files:**
- Create: `src/presentation/legibilityMode.ts`, `scripts/record-blinded-stills.ts`
- Modify: `src/main.ts`, `SeriesView.ts`, `SeasonView.ts`, `ArenaView.ts`, `ArenaCamera.ts`, `ProceduralFighter.ts`, `scripts/record-review-clips.ts`
- Modify: `docs/reviews/2026-08-16-readable-deep-combat-human-review.md`

Labels live in the views, the mapping in `ArenaCamera`, the specs in `ProceduralFighter` — `main.ts` only constructs them, so a toggle implemented there alone cannot reach any of the three. And `silhouettes: false` must **not** revert the equipment radius, or the "camera only, final radii" configuration silently becomes the old camera.

- [ ] **Step 1: Thread the mode**

`LegibilityMode = { labels: boolean; camera: boolean; silhouettes: boolean }`, dev-only, passed at construction of views, rig and camera. Keep the superseded label map, mapping and `STYLE_SPECS` beside the new ones, marked review-only. **The framing radius always comes from the final props**, regardless of the `silhouettes` flag; store it separately from the displayed geometry.

- [ ] **Step 2: Test all five configurations**

Assert, per configuration, the displayed label set, the active mapping and the framing radius — the last is what proves the camera-only configuration is honest.

- [ ] **Step 3: Record the clips and the blinded stills**

Extend the clip recorder with a configuration name writing into `docs/reviews/clips/<config>/`. Then `scripts/record-blinded-stills.ts`: **8 stills per type per side at 4 yaw angles**, deterministic seed, HUD and labels hidden, sides randomised, rendered in monochrome, greyscale/value and the three colour-vision variants, with the answer key written to a **separate** file. Pass bar, set now: **≥ 80% correct overall and ≥ 70% per type**.

- [ ] **Step 4: Update the gate document**

Describe the five configurations and which question each answers; hide HUD and labels for the silhouette question and restore them for the winner explanation; write the "plausible explanation" rubric before anyone watches; require two reviewers, at least one without prior rules knowledge; record the confusion-matrix procedure and the bars above.

- [ ] **Step 5: Commit**

```bash
git add src/presentation/legibilityMode.ts scripts/record-blinded-stills.ts scripts/record-review-clips.ts src/presentation src/main.ts docs/reviews/2026-08-16-readable-deep-combat-human-review.md
git commit -m "test: five-configuration toggles and blinded silhouette material"
```

---

### Task 10: Baselines, full gate, documentation

- [ ] **Step 1: Run e2e without updating snapshots**

Run: `npm run build && npm run test:e2e`
Expected: functional specs pass; nearly every screenshot fails, **including the combat pose captures** — correct here, unlike previous slices, because silhouettes and framing both changed by design. What must not fail: `dc635911`, Task 1's per-tick digests, and the key-pose *tick numbers*.

- [ ] **Step 2: Regenerate and inspect**

win32, then linux in the docker image. **Read every regenerated PNG** and say, for each: which type is which, whether the scutum reads as a rectangle, whether trident and spear are distinguishable, whether the net is visible.

- [ ] **Step 3: Full gate**

Run: `npm run check` and `bash scripts/check-allowlist.sh $(git merge-base main HEAD)`.

- [ ] **Step 4: README**

Replace the archetype vocabulary with the three types, keep the mechanics description, note that the triangle is the school's scheme, and that internal ids stay `heavy`/`fast`/`technical` and why.

- [ ] **Step 5: Commit**

```bash
git add tests/__screenshots__ README.md
git commit -m "test(e2e): refresh baselines for the gladiator-type silhouettes and framing"
```

---

## Self-review notes (already applied)

- **Order [rev]:** rig capability and silhouettes (T3-T4) now precede measurement and camera (T5-T7). The camera's input is the rig's equipment radius; measuring first measured a camera that would not ship.
- **Invariant [rev]:** the array-replacer bug is called out explicitly with a negative self-test, the hash is per-tick over the whole `BattleState` across nine pairings, and the gate is a positive allowlist covering renames, index, worktree and untracked files. The invariant test lives outside `src/simulation/` so no test-file escape hatch is needed.
- **Scale floor [rev]:** applies to **body** height, only at 1280×820, only inside the band, and is chosen by a sweep that must pass the safe area at all three viewports before any constant is written. At 1024 the canvas is roughly 544 px wide and 130 px is unreachable — that is why the floor is not asserted there.
- **Missing acceptance added [rev]:** screen-separation attenuation, the slice's actual hypothesis, now has a criterion.
- **Toggles [rev]:** threaded through every module that owns one of the three changes, with the framing radius pinned to the final props so the camera-only configuration is not a lie.
- **Known soft spots:** band constants unknown until T5 measures them (T6 says so); trident-versus-spear confusion is T4's risk and T9's confusion matrix is what catches it; the floor may prove unreachable even at 1280×820, and the plan says report rather than lower.
