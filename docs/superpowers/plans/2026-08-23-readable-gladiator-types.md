# Readable Gladiator Types Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make a bout readable — name each fighter by historical type, draw each type so its equipment is identifiable at the size it is actually rendered, and frame the fight closely enough that spacing differences occupy real screen distance — without changing one bit of simulated behaviour.

**Architecture:** Three presentation-only changes over an unchanged simulation. `gladiatorTypes.ts` maps the internal archetype ids (`heavy`/`fast`/`technical`) to player-facing type identity, exactly as `dispositionLabels.ts` maps disposition ids to copy. `ProceduralFighter`'s `StyleSpec` grows shield *kind* (scutum / parma / none) and an optional off-hand prop so the three silhouettes can exist at all; the weapon mesh is oriented along the real `hand → weaponTip` segment. `ArenaCamera`'s `extentToDistance` becomes an explicit piecewise function with a lower flat distance, a C1 junction and hysteresis. An invariant harness added first proves the simulation did not move.

**Tech Stack:** TypeScript, Vite, Vitest, Playwright, Three.js.

**Spec:** `docs/superpowers/specs/2026-08-23-readable-gladiator-types-design.md` — read it first; it fixes scope, the revision history and the acceptance criteria. Read also its "Constraints carried from the review".

## Global Constraints

- **Behaviour-change allowlist.** These files must NOT change: `src/simulation/**`, `src/content/combatStyles.ts`, `src/content/mvpSeries.ts`, `src/content/season.ts`, and any construction of `BattleConfig`/`EncounterConfig` inputs. A diff touching them fails the slice. Task 2 enforces this in CI.
- Archetype ids (`heavy`, `fast`, `technical`) and action ids (`heavy-cleave` and siblings) are internal and never change: `battle.ts` folds `JSON.stringify(event)` into the trace hash and events carry action ids, so renaming breaks `dc635911`.
- **Frozen:** `battle.test.ts`'s `dc635911`, `encounterCapacity`'s hash, the key-pose ticks 253/817/958/2106, the balance cohorts and the golden season must pass **with no edit to any simulation test**.
- **Not frozen, changed deliberately:** every combat/planning/season screenshot baseline, on win32 and linux both. Look at each regenerated PNG before committing it.
- UI copy is English. Player-facing type names: `Murmillo`, `Hoplomachus`, `Retiarius`. The words `Heavy`, `Fast`, `Technical` must not appear on any player-facing surface.
- **Pre-committed scale floor:** minimum on-screen fighter height ≥ **130 px** at 1280×820 anywhere inside the tactical band. Chosen before implementation on purpose — a floor read off the result cannot fail. Current measured range is 50–90 px. If no framing satisfies 130 px while keeping both fighters inside the safe area, **stop and report it as a design finding**; do not lower the floor.
- A disengaging fighter never turns their back — giving ground is done facing the opponent.
- Equipment claims carry a confidence level; contested details are not asserted (see spec, "Constraints carried from the review").
- Checks: presentation unit change → `npm test`; visual change → `npm run test:e2e`; handoff → `npm run check`. Linux baselines are regenerated in the Playwright docker image (recipe in `AGENTS.md`).
- Commit style: conventional (`feat:`/`fix:`/`test:`/`docs:`), no LLM attribution (no `Co-Authored-By`, no 🤖).

## File structure

| File | Responsibility |
|---|---|
| `src/presentation/gladiatorTypes.ts` *(new)* | The only place archetype ids become player-facing type identity: names, one-line descriptions, the counter-rule string. Mirrors `dispositionLabels.ts`. |
| `src/presentation/SeriesView.ts` | Consumes `gladiatorTypes.ts` instead of its local `ARCHETYPE_LABELS`. |
| `src/presentation/SeasonView.ts` | Same. |
| `src/presentation/ProceduralFighter.ts` | `StyleSpec.equipment` grows shield kind/dimensions and an optional off-hand prop; weapon meshes oriented along `hand → weaponTip`; `computeHorizontalEquipmentRadius` derived from real prop AABBs. |
| `src/presentation/ArenaCamera.ts` | `extentToDistance` becomes the piecewise function with hysteresis. |
| `src/presentation/ArenaView.ts` | New camera clamp constants; debug snapshot gains projected screen metrics. |
| `src/main.ts` | Dev-only test API gains the legibility toggles and the screen-metrics reader. |
| `scripts/measure-framing.ts` *(new)* | Records per-tick extent and projected fighter height across the nine pairings; produces the numbers Tasks 4–5 need. |
| `tests/legibility.spec.ts` *(new)* | Scale floor, safe area at three viewport widths, naming surfaces. |
| `docs/reviews/2026-08-16-readable-deep-combat-human-review.md` | Gate re-run instructions updated for the five toggles. |

---

### Task 1: Invariant harness

Do this first: every later task is a visual change, and this is what proves none of them moved the simulation.

**Files:**
- Create: `scripts/check-allowlist.sh`
- Create: `src/simulation/stateHash.test.ts`
- Modify: `package.json` (add the allowlist check to `check`)
- Modify: `src/presentation/ArenaView.ts` (deep-freeze snapshots in dev/test)

**Interfaces:**
- Produces: `npm run check:allowlist`; a canonical full-state hash fixture other tasks re-run unchanged.

- [ ] **Step 1: Write the failing test**

```ts
// src/simulation/stateHash.test.ts
import { describe, expect, it } from 'vitest'
import { COMBAT_STYLES } from '../content/combatStyles'
import { BASELINE_TEST_SEED, homeRoster, opponents } from '../content/mvpSeries'
import { advanceBattleTicks, createBattle, MAX_BOUT_TICKS } from './battle'

// A canonical hash over the FULL end state of every pairing, not just the
// folded event log. The event hash proves the emitted trace is identical;
// this proves nothing observable in state drifted either -- the two together
// are what the slice's "no behaviour change" claim rests on.
function stateHash(value: unknown): string {
  const json = JSON.stringify(value, Object.keys(value as object).sort())
  let hash = 2166136261
  for (let i = 0; i < json.length; i += 1) {
    hash ^= json.charCodeAt(i)
    hash = Math.imul(hash, 16777619)
  }
  return (hash >>> 0).toString(16)
}

describe('canonical full-state hashes', () => {
  it('pins the end state of all nine pairings', () => {
    const hashes = homeRoster.slice(0, 3).flatMap((home) =>
      opponents.map((away) => {
        const battle = advanceBattleTicks(
          createBattle({ home, away, seed: BASELINE_TEST_SEED, combatStyles: COMBAT_STYLES }),
          MAX_BOUT_TICKS,
        )
        return `${home.id}/${away.id}:${stateHash(battle.encounter.combatants)}`
      }),
    )
    expect(hashes).toMatchInlineSnapshot()
  })
})
```

- [ ] **Step 2: Run it to record the baseline**

Run: `npx vitest run src/simulation/stateHash.test.ts -u`
Expected: the inline snapshot is filled with nine `id/id:hash` strings. Read them; they are the values every later task must reproduce. Commit them.

- [ ] **Step 3: Write the allowlist check**

```bash
# scripts/check-allowlist.sh
#!/usr/bin/env bash
# Fails if this slice touched a file that owns simulated behaviour.
set -euo pipefail
BASE="${1:-main}"
FORBIDDEN='^(src/simulation/|src/content/combatStyles\.ts|src/content/mvpSeries\.ts|src/content/season\.ts)'
CHANGED="$(git diff --name-only "$BASE"...HEAD | grep -E "$FORBIDDEN" | grep -v '\.test\.ts$' || true)"
if [ -n "$CHANGED" ]; then
  echo "Behaviour-change allowlist violated:" >&2
  echo "$CHANGED" >&2
  exit 1
fi
echo "allowlist ok"
```

Note the `grep -v '\.test\.ts$'`: this task itself adds `src/simulation/stateHash.test.ts`, and later tasks must be able to extend simulation *tests* while never touching simulation *code*.

- [ ] **Step 4: Deep-freeze presentation snapshots**

In `ArenaView`, where the battle state is handed to the renderer, add a dev/test-only recursive `Object.freeze` of the snapshot. Guard it with `import.meta.env.DEV` so production pays nothing. A mutation from presentation then throws in tests instead of silently corrupting state.

- [ ] **Step 5: Wire it up and commit**

```bash
npm run check:allowlist
npm test
git add scripts/check-allowlist.sh src/simulation/stateHash.test.ts src/presentation/ArenaView.ts package.json
git commit -m "test: pin full-state hashes and enforce the behaviour-change allowlist"
```

---

### Task 2: Gladiator type identity module and naming surfaces

**Files:**
- Create: `src/presentation/gladiatorTypes.ts`
- Modify: `src/presentation/SeriesView.ts` (`ARCHETYPE_LABELS` at line 27; uses at 382, 431, 479; counter rule at 332)
- Modify: `src/presentation/SeasonView.ts` (`ARCHETYPE_LABELS` at line 18; uses at 123, 134, 150)
- Create: `src/presentation/gladiatorTypes.test.ts`

**Interfaces:**
- Consumes: `Archetype` from `../simulation/fighters` (type-only).
- Produces: `TYPE_NAMES`, `TYPE_DESCRIPTIONS`, `COUNTER_RULE_TEXT`.

- [ ] **Step 1: Write the failing test**

```ts
// src/presentation/gladiatorTypes.test.ts
import { describe, expect, it } from 'vitest'
import { COUNTER_RULE_TEXT, TYPE_DESCRIPTIONS, TYPE_NAMES } from './gladiatorTypes'

describe('gladiator type identity', () => {
  it('names every archetype and never leaks a mechanics id', () => {
    expect(TYPE_NAMES).toEqual({ heavy: 'Murmillo', fast: 'Retiarius', technical: 'Hoplomachus' })
    const copy = [...Object.values(TYPE_NAMES), ...Object.values(TYPE_DESCRIPTIONS), COUNTER_RULE_TEXT].join(' ')
    for (const id of ['Heavy', 'Fast', 'Technical']) expect(copy).not.toContain(id)
  })

  it('states the counter rule in type names', () => {
    expect(COUNTER_RULE_TEXT).toContain('Murmillo')
    expect(COUNTER_RULE_TEXT).toContain('Retiarius')
    expect(COUNTER_RULE_TEXT).toContain('Hoplomachus')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/presentation/gladiatorTypes.test.ts`
Expected: FAIL — module `./gladiatorTypes` does not exist.

- [ ] **Step 3: Write the implementation**

```ts
// src/presentation/gladiatorTypes.ts
// The only place an internal archetype id becomes player-facing identity.
// Mirrors `dispositionLabels.ts`: mechanics ids stay in `src/simulation`,
// fiction lives here, and neither side learns the other's vocabulary.
//
// The mapping is by equipment, not by flavour -- see the design spec's
// "The three types". `fast` is the retiarius because `fast` holds the
// LONGEST preferred range of the three (2.4-3.0) and retreats most: that is
// reach-and-give-ground, not in-and-out brawling.
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

/** The school's own scheme, not a historical taxonomy -- real editors matched types in asymmetric pairs. */
export const COUNTER_RULE_TEXT = 'Murmillo beats Retiarius beats Hoplomachus beats Murmillo'
```

- [ ] **Step 4: Replace both views' local labels**

Delete `ARCHETYPE_LABELS` from `SeriesView.ts:27` and `SeasonView.ts:18`; import `TYPE_NAMES` and use it at every site listed under **Files**. Replace the counter rule at `SeriesView.ts:332` with `COUNTER_RULE_TEXT`. Add the one-line school-scheme note beside it.

- [ ] **Step 5: Run tests and commit**

Run: `npx vitest run src/presentation/` then `npm test` → PASS, no simulation test edited.

```bash
git add src/presentation/gladiatorTypes.ts src/presentation/gladiatorTypes.test.ts src/presentation/SeriesView.ts src/presentation/SeasonView.ts
git commit -m "feat: name fighters by historical gladiator type"
```

---

### Task 3: Framing measurement harness

The camera constants cannot be written from a desk — they depend on the real extent distribution and on projected pixel sizes. This task produces those numbers.

**Files:**
- Create: `scripts/measure-framing.ts`
- Modify: `src/presentation/ArenaView.ts` (`ArenaDebugSnapshot` at line 49)
- Modify: `src/main.ts` (dev-only test API, interface at line 48)

**Interfaces:**
- Produces: `ArenaDebugSnapshot.screenMetrics: Readonly<Record<CombatantId, { heightPx: number; minXPx: number; maxXPx: number; minYPx: number; maxYPx: number }>>` and `ArenaDebugSnapshot.groupExtent: number`; dev API `getArenaDebugSnapshot()` already exposes the snapshot.

- [ ] **Step 1: Extend the debug snapshot**

Add both fields. `screenMetrics` is computed by projecting each rig's real world-space AABB — every prop included, crest, spear, trident, net, shields — through the active camera to normalised device coordinates and then to pixels using the live canvas size. `groupExtent` is the same value `extentToDistance` consumes, recorded so the band edges are measured rather than assumed.

- [ ] **Step 2: Write the measurement script**

`scripts/measure-framing.ts` drives the nine pairings at seed `20260815` the way `scripts/record-review-clips.ts` already does, and for every tick records `groupExtent` and each fighter's `heightPx`. It prints, per pairing and overall: extent min/median/p95/max, height min/median/max, and the count of ticks whose projected AABB leaves a 5% safe-area inset. Run at 1280×820, 1024×768 and 820×640.

- [ ] **Step 3: Run it and record the numbers**

Run: `npx vite-node scripts/measure-framing.ts`
Write the output into the plan's Task 4 as the measured band edges, and into the commit message. **These numbers are the input to every camera decision that follows** — do not proceed on estimates.

- [ ] **Step 4: Commit**

```bash
git add scripts/measure-framing.ts src/presentation/ArenaView.ts src/main.ts
git commit -m "test: measure group extent and projected fighter height across the nine pairings"
```

---

### Task 4: Piecewise camera framing

**Files:**
- Modify: `src/presentation/ArenaCamera.ts` (`DISTANCE_BASE` 134, `DISTANCE_PER_EXTENT_UNIT` 135, `extentToDistance` 147)
- Modify: `src/presentation/ArenaView.ts` (`CAMERA_MIN_DISTANCE` 75, `CAMERA_MAX_DISTANCE` 76)
- Modify: `src/presentation/ArenaCamera.test.ts`

**Interfaces:**
- Consumes: the measured band edges from Task 3.
- Produces: `extentToDistance(extent, minDistance, maxDistance)` with unchanged signature and new behaviour.

**Context the implementer needs.** Today: `clamp(8.5 + 0.8 × extent, 11, 18)`. The lower clamp binds for every `extent < 3.125`, so a flat region already exists across the close half of the band — the defect is not that the camera zooms too much, it is that **11 is too far**, which is why fighters measure 50–90 px. The old line therefore cannot simply "resume" at the band's upper edge: at that extent it already sits above any flat value low enough to satisfy the 130 px floor.

- [ ] **Step 1: Write the failing test**

```ts
// added to src/presentation/ArenaCamera.test.ts
// BAND_LOW/BAND_HIGH/FLAT_DISTANCE come from Task 3's measurement; substitute
// the recorded values. The assertions are about shape, not about the numbers.
describe('piecewise framing distance', () => {
  it('is flat across the tactical band', () => {
    const samples = [BAND_LOW, (BAND_LOW + BAND_HIGH) / 2, BAND_HIGH]
    for (const extent of samples) {
      expect(extentToDistance(extent, MIN_DISTANCE, MAX_DISTANCE)).toBeCloseTo(FLAT_DISTANCE, 6)
    }
  })

  it('widens monotonically beyond the band and respects the far clamp', () => {
    let previous = FLAT_DISTANCE
    for (let extent = BAND_HIGH; extent <= BAND_HIGH + 12; extent += 0.25) {
      const distance = extentToDistance(extent, MIN_DISTANCE, MAX_DISTANCE)
      expect(distance).toBeGreaterThanOrEqual(previous - 1e-9)
      expect(distance).toBeLessThanOrEqual(MAX_DISTANCE)
      previous = distance
    }
    expect(extentToDistance(1e6, MIN_DISTANCE, MAX_DISTANCE)).toBe(MAX_DISTANCE)
  })

  it('joins the two regions with a continuous first derivative', () => {
    // C1, not merely C0: a slope step reads as a visible lurch the moment the
    // pair crosses the edge, which is exactly the failure this design risks.
    const h = 1e-4
    const slopeAt = (x: number): number =>
      (extentToDistance(x + h, MIN_DISTANCE, MAX_DISTANCE) - extentToDistance(x - h, MIN_DISTANCE, MAX_DISTANCE)) / (2 * h)
    expect(extentToDistance(BAND_HIGH, MIN_DISTANCE, MAX_DISTANCE)).toBeCloseTo(FLAT_DISTANCE, 6)
    expect(slopeAt(BAND_HIGH - 10 * h)).toBeCloseTo(0, 3)
    expect(slopeAt(BAND_HIGH + 10 * h)).toBeCloseTo(0, 3)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/presentation/ArenaCamera.test.ts`
Expected: FAIL — the current linear-plus-clamp mapping is neither flat across the band nor C1 at the junction.

- [ ] **Step 3: Implement the piecewise mapping**

```ts
/**
 * Framing distance as a function of group extent.
 *
 * Flat across the tactical band so that closing and giving ground are real
 * screen movement rather than a zoom the camera cancels out, then eased up
 * to the far clamp for the excursions where framing matters more than scale.
 * The easing is smoothstep rather than linear so the junction is C1: a slope
 * step here reads as a lurch every time the pair crosses the band edge.
 *
 * `FLAT_DISTANCE` is below the old `minDistance` of 11 on purpose -- that
 * clamp is why fighters measured 50-90 px (see the 2026-08-19 verification).
 */
function extentToDistance(extent: number, minDistance: number, maxDistance: number): number {
  if (extent <= BAND_HIGH_EXTENT) return clamp(FLAT_DISTANCE, minDistance, maxDistance)
  const t = Math.min(1, (extent - BAND_HIGH_EXTENT) / EASE_WIDTH_EXTENT)
  const eased = t * t * (3 - 2 * t)
  return clamp(FLAT_DISTANCE + eased * (maxDistance - FLAT_DISTANCE), minDistance, maxDistance)
}
```

Set `CAMERA_MIN_DISTANCE` to `FLAT_DISTANCE` in `ArenaView.ts` so the clamp can no longer override the flat region.

- [ ] **Step 4: Run tests**

Run: `npx vitest run src/presentation/` → PASS. Then `npm test` → PASS with no simulation test edited, and `npm run check:allowlist` → ok.

- [ ] **Step 5: Commit**

```bash
git add src/presentation/ArenaCamera.ts src/presentation/ArenaCamera.test.ts src/presentation/ArenaView.ts
git commit -m "feat: flat framing distance across the tactical band"
```

---

### Task 5: Camera motion — hysteresis and dynamic bounds

Static shape tests cannot catch a lurch. This task is about what the camera does over time.

**Files:**
- Modify: `src/presentation/ArenaCamera.ts`
- Modify: `src/presentation/ArenaCamera.test.ts`

**Interfaces:**
- Consumes: Task 4's piecewise mapping; the existing `DISTANCE_DEAD_ZONE_FRACTION = 0.12` and 1.25 s damping.

- [ ] **Step 1: Write the failing test**

```ts
// added to src/presentation/ArenaCamera.test.ts
describe('framing distance under motion', () => {
  it('does not chatter when the pair oscillates across the band edge', () => {
    // The known failure mode of a dead band: separation wobbles around the
    // edge and the camera breathes in and out once per wobble.
    const camera = new ArenaCamera({ minDistance: MIN_DISTANCE, maxDistance: MAX_DISTANCE })
    const distances: number[] = []
    for (let step = 0; step < 240; step += 1) {
      const extent = BAND_HIGH + 0.15 * Math.sin(step / 6)
      camera.update(targetsWithExtent(extent), 1 / 60)
      distances.push(camera.state.distance)
    }
    const directionChanges = distances.slice(2).filter((d, i) =>
      Math.sign(d - distances[i + 1]) !== 0 && Math.sign(d - distances[i + 1]) !== Math.sign(distances[i + 1] - distances[i]),
    ).length
    expect(directionChanges).toBeLessThanOrEqual(2)
    expect(Math.max(...distances) - Math.min(...distances)).toBeLessThan(0.35)
  })

  it('follows a slow sweep out and back without overshoot', () => {
    const camera = new ArenaCamera({ minDistance: MIN_DISTANCE, maxDistance: MAX_DISTANCE })
    const out: number[] = []
    for (let extent = BAND_HIGH; extent <= BAND_HIGH + 6; extent += 0.05) {
      camera.update(targetsWithExtent(extent), 1 / 60)
      out.push(camera.state.distance)
    }
    for (const [i, distance] of out.entries()) if (i > 0) expect(distance).toBeGreaterThanOrEqual(out[i - 1] - 1e-6)
    expect(Math.max(...out)).toBeLessThanOrEqual(MAX_DISTANCE + 1e-6)
  })
})
```

`targetsWithExtent` is a local helper building two camera targets separated so their measured extent equals the argument; write it beside the tests.

- [ ] **Step 2: Run test to verify it fails or passes**

Run: `npx vitest run src/presentation/ArenaCamera.test.ts`
Expected: the oscillation test either fails, or passes because the existing 12% framing dead zone plus the 1.25 s damping already suppress chatter. **Both outcomes are informative — record which one you got.** Only add explicit enter/exit thresholds if it fails; do not add hysteresis the code does not need.

- [ ] **Step 3: Implement only what the test demanded**

If the oscillation test failed: give the band edge separate enter and exit extents (exit wider than enter) and re-run. If it passed: add a comment at `DISTANCE_DEAD_ZONE_FRACTION` recording that it is what holds the band edge steady, so nobody tunes it away later.

- [ ] **Step 4: Watch one real trace**

Run `npm run dev`, play a bout that crosses the band edge repeatedly, and watch the camera. Static tests cannot see a lurch; you can. Report what you saw in your own words.

- [ ] **Step 5: Commit**

```bash
git add src/presentation/ArenaCamera.ts src/presentation/ArenaCamera.test.ts
git commit -m "test: bound camera motion across the band edge"
```

---

### Task 6: Rig support for shield kinds and off-hand props

The rig cannot currently express any of the three silhouettes: `buildEquipment` always creates one `BoxGeometry` weapon and one cylindrical shield, and `StyleSpec` has no notion of shield shape, shield absence or a second prop.

**Files:**
- Modify: `src/presentation/ProceduralFighter.ts` (`EquipmentProportions` 188–199, `buildEquipment` ~505, `computeHorizontalEquipmentRadius` 599)
- Modify: `src/presentation/ProceduralFighter.test.ts`

**Interfaces:**
- Produces: `EquipmentProportions` gains `shieldKind: 'scutum' | 'parma' | 'none'`, `shieldWidth`, `shieldHeight`, `shieldCurvature`, and `offhandProp?: 'net'`. `horizontalEquipmentRadius` is computed from real prop AABBs.

- [ ] **Step 1: Write the failing test**

```ts
// added to src/presentation/ProceduralFighter.test.ts
function propSlots(fighter: ProceduralFighter): string[] {
  const slots: string[] = []
  fighter.root.traverse((object) => { if (object.userData.slot) slots.push(String(object.userData.slot)) })
  return slots
}

describe('equipment kinds', () => {
  it('builds no shield mesh at all for a shieldless type', () => {
    const fighter = createProceduralFighter({ archetype: 'fast' })
    expect(propSlots(fighter)).not.toContain('shield')
    fighter.dispose()
  })

  it('builds a rectangular scutum for the heavy type, not a disc', () => {
    const fighter = createProceduralFighter({ archetype: 'heavy' })
    const shield = findBySlot(fighter, 'shield')!
    const box = new THREE.Box3().setFromObject(shield)
    const size = box.getSize(new THREE.Vector3())
    // A scutum is markedly taller than it is wide; a cylinder shield is not.
    expect(size.y / size.x).toBeGreaterThan(1.3)
    fighter.dispose()
  })

  it('orients the weapon mesh along the hand-to-tip segment', () => {
    // The spear's tip anchor is displaced mostly along +Z while the mesh runs
    // along local Y today: the drawn weapon does not point where the rig says
    // it points.
    const fighter = createProceduralFighter({ archetype: 'technical' })
    const tip = new THREE.Vector3()
    fighter.anchors.get('weaponTip')!.getWorldPosition(tip)
    const box = new THREE.Box3().setFromObject(findBySlot(fighter, 'weapon')!)
    expect(box.containsPoint(tip)).toBe(true)
    fighter.dispose()
  })

  it('derives the equipment radius from real prop extents', () => {
    const fighter = createProceduralFighter({ archetype: 'fast' })
    // Shieldless: the radius must come from the trident and net, and must not
    // read a shield radius that no longer exists.
    expect(fighter.horizontalEquipmentRadius).toBeGreaterThan(0.5)
    fighter.dispose()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/presentation/ProceduralFighter.test.ts`
Expected: FAIL on all four — the shield is always built, always a cylinder, the weapon runs along Y, and the radius reads `equipment.shieldRadius`.

- [ ] **Step 3: Implement**

Extend `EquipmentProportions` with the fields above. In `buildEquipment`: skip shield construction entirely when `shieldKind === 'none'`; build a `BoxGeometry` slab for `'scutum'` (with a shallow curve, e.g. two angled slabs or a low-segment cylinder wedge) and keep the cylinder for `'parma'`; build the optional off-hand prop. Orient the weapon by constructing the mesh along its own local axis and then rotating it onto the normalised `hand → tip` vector, rather than assuming local Y. Rewrite `computeHorizontalEquipmentRadius` to take the max horizontal reach over the real `Box3` of every `userData.slot` prop plus the rig root.

- [ ] **Step 4: Run tests**

Run: `npx vitest run src/presentation/ProceduralFighter.test.ts` → PASS. Then `npm test` → PASS.

- [ ] **Step 5: Commit**

```bash
git add src/presentation/ProceduralFighter.ts src/presentation/ProceduralFighter.test.ts
git commit -m "feat: shield kinds, off-hand props and tip-aligned weapons in the rig"
```

---

### Task 7: The three silhouettes

**Files:**
- Modify: `src/presentation/ProceduralFighter.ts` (`STYLE_SPECS`, `heavy` 208–243, `fast` 244–279, `technical` 280–315)
- Modify: `src/presentation/ProceduralFighter.test.ts`

**Interfaces:**
- Consumes: Task 6's `shieldKind` / `offhandProp` / AABB radius.

**Authoring targets** (equipment is the historical claim; see the spec's confidence note):

- **Murmillo** (`heavy`) — curved rectangular scutum, clearly taller than wide; short gladius; helmet with a broad brim and a raised crest; keep `hasHelmet: true`.
- **Hoplomachus** (`technical`) — spear, kept long; small round parma; high greaves on both legs; broad-brimmed helmet. The spear must be **visibly thicker** than today's `weaponWidth: 0.045`, which lands at roughly two pixels at the shipped framing.
- **Retiarius** (`fast`) — `shieldKind: 'none'`, `hasHelmet: false`, trident (long, three-pronged head), `offhandProp: 'net'`, and a raised shoulder guard on the left. **The net is the positive cue**; "no shield" is a weak one, since it asks the viewer to already know the other two.

- [ ] **Step 1: Write the failing test**

```ts
// added to src/presentation/ProceduralFighter.test.ts
describe('type silhouettes', () => {
  it('gives each type a distinct horizontal equipment reach', () => {
    const reach = (archetype: Archetype): number => {
      const fighter = createProceduralFighter({ archetype })
      const value = fighter.horizontalEquipmentRadius
      fighter.dispose()
      return value
    }
    // Separated enough that the coarse outline differs, which is the only
    // channel that survives at the shipped framing.
    const [murmillo, retiarius, hoplomachus] = [reach('heavy'), reach('fast'), reach('technical')]
    expect(Math.abs(hoplomachus - murmillo)).toBeGreaterThan(0.3)
    expect(Math.abs(retiarius - murmillo)).toBeGreaterThan(0.3)
  })

  it('gives the retiarius a net and no helmet', () => {
    const fighter = createProceduralFighter({ archetype: 'fast' })
    const slots = propSlots(fighter)
    expect(slots).toContain('net')
    expect(slots).not.toContain('helmet')
    fighter.dispose()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/presentation/ProceduralFighter.test.ts`
Expected: FAIL — no net exists, and `fast` still carries a helmet flag and a shield.

- [ ] **Step 3: Author the three specs**

Edit `STYLE_SPECS` only. Do not touch body proportions: the complaint was identity, not anatomy.

- [ ] **Step 4: Run tests and look at the result**

Run: `npx vitest run src/presentation/` → PASS. Then `npm run dev` and look at all three types at the shipped framing. Report what you can and cannot tell apart — this is the first moment the slice's premise is observable.

- [ ] **Step 5: Commit**

```bash
git add src/presentation/ProceduralFighter.ts src/presentation/ProceduralFighter.test.ts
git commit -m "feat: murmillo, hoplomachus and retiarius silhouettes"
```

---

### Task 8: Scale floor, safe area and naming coverage

**Files:**
- Create: `tests/legibility.spec.ts`
- Modify: `src/main.ts` (dev API, if a viewport-resize hook is missing)

**Interfaces:**
- Consumes: `getArenaDebugSnapshot().screenMetrics` from Task 3.

- [ ] **Step 1: Write the spec**

```ts
// tests/legibility.spec.ts
import { expect, test } from '@playwright/test'

const MIN_FIGHTER_HEIGHT_PX = 130 // pre-committed in the plan, not read off the result
const SAFE_AREA_INSET = 0.05

for (const viewport of [{ width: 1280, height: 820 }, { width: 1024, height: 768 }, { width: 820, height: 640 }]) {
  test(`fighters clear the scale floor and stay inside the safe area at ${viewport.width}`, async ({ page }) => {
    await page.setViewportSize(viewport)
    // drive to an active bout at seed 20260815 via the existing test API,
    // following tests/smoke.spec.ts's pattern
    for (const ticks of [1, 300, 900, 1500, 2100]) {
      await page.evaluate((n) => window.__GLADIATOR_TEST__.advanceTicks(n), ticks)
      const metrics = await page.evaluate(() => window.__GLADIATOR_TEST__.getArenaDebugSnapshot!()!.screenMetrics)
      for (const [id, m] of Object.entries(metrics)) {
        expect(m.heightPx, `${id} height at ${ticks}`).toBeGreaterThanOrEqual(MIN_FIGHTER_HEIGHT_PX)
        expect(m.minXPx, `${id} left edge at ${ticks}`).toBeGreaterThanOrEqual(viewport.width * SAFE_AREA_INSET)
        expect(m.maxXPx, `${id} right edge at ${ticks}`).toBeLessThanOrEqual(viewport.width * (1 - SAFE_AREA_INSET))
      }
    }
  })
}

test('no player-facing surface names a mechanics archetype', async ({ page }) => {
  for (const testid of ['season-board', 'planning', 'battle-status', 'series-summary']) {
    const text = (await page.getByTestId(testid).textContent()) ?? ''
    for (const id of ['Heavy', 'Fast', 'Technical']) expect(text).not.toContain(id)
  }
})
```

Enumerate the real testids for the four surfaces from `SeriesView`/`SeasonView` before writing the loop — the list above is the intent, not the final names.

- [ ] **Step 2: Run it**

Run: `npm run build && npx playwright test tests/legibility.spec.ts`
Expected: the naming test passes; the scale test either passes or fails on the floor. **If it fails at any viewport, do not lower `MIN_FIGHTER_HEIGHT_PX`** — either the flat distance from Task 4 can come closer while keeping the safe area, or it cannot, and that is a design finding to report with the numbers.

- [ ] **Step 3: Commit**

```bash
git add tests/legibility.spec.ts src/main.ts
git commit -m "test: scale floor, safe area and archetype-naming coverage"
```

---

### Task 9: Review toggles and gate material

**Files:**
- Modify: `src/main.ts` (dev API)
- Modify: `scripts/record-review-clips.ts`
- Modify: `docs/reviews/2026-08-16-readable-deep-combat-human-review.md`

**Interfaces:**
- Produces: dev API `setLegibilityToggles({ labels, camera, silhouettes }: { labels: boolean; camera: boolean; silhouettes: boolean }): void`.

**Why toggles rather than commits.** `horizontalEquipmentRadius` is derived from equipment and feeds the camera, so a "camera-only" commit built on the old props runs a *different* camera than the final build. The five configurations must therefore come from one build: baseline; labels only; camera only **with the final equipment radii**; silhouettes only; everything.

- [ ] **Step 1: Add the toggles**

Dev-only (`import.meta.env.DEV`), matching how `renderActiveBattleAtAlpha` and `settleCameraSeconds` are already gated. `labels: false` renders the old `Heavy`/`Fast`/`Technical` strings; `camera: false` restores the pre-Task-4 mapping; `silhouettes: false` restores the pre-Task-7 `STYLE_SPECS`. Keep the superseded values in the module beside the new ones, marked as review-only.

- [ ] **Step 2: Record the five clip sets**

Extend `record-review-clips.ts` to accept a configuration name and write into `docs/reviews/clips/<config>/`. Record all five over the same frozen trace at seed `20260815`.

- [ ] **Step 3: Update the gate document**

In the human-review doc: describe the five configurations and which question each answers; state that for the silhouette question the HUD and type labels are hidden and sides randomised, and that the HUD returns for the winner-explanation question; write the rubric for "plausible explanation" **before** anyone watches; require two reviewers with at least one lacking prior rules knowledge; and add the confusion-matrix procedure — randomised unlabelled monochrome stills across all types, both sides and several yaw angles, with the pass bar written down in advance.

- [ ] **Step 4: Commit**

```bash
git add src/main.ts scripts/record-review-clips.ts docs/reviews/2026-08-16-readable-deep-combat-human-review.md
git commit -m "test: five-configuration review toggles and gate material"
```

---

### Task 10: Baselines, full gate and documentation

**Files:**
- Update: `tests/__screenshots__/win32/**`, `tests/__screenshots__/linux/**`
- Modify: `README.md`

- [ ] **Step 1: Run the suite without updating snapshots**

Run: `npm run build && npm run test:e2e`
Expected: functional specs pass; nearly every screenshot comparison fails, including the combat pose captures — unlike previous slices, that is correct here, because silhouettes and framing both changed by design. What must **not** fail is any simulation assertion: `dc635911`, the full-state hashes from Task 1, the key-pose *tick numbers* in `combat-visuals.spec.ts`.

- [ ] **Step 2: Regenerate and inspect**

Regenerate on win32, then in the docker image for linux (`AGENTS.md`). **Read every regenerated PNG.** For each, say what you see: which type is which, whether the scutum reads as a rectangle, whether the trident and the spear are distinguishable, whether the net is visible. This is the last checkpoint before a human reviewer sees it.

- [ ] **Step 3: Full gate**

Run: `npm run check` and `npm run check:allowlist`
Expected: both green.

- [ ] **Step 4: README**

Replace the archetype vocabulary in the combat-styles section with the three types, keeping the mechanics description intact; add one line that the counter triangle is the school's scheme rather than a historical taxonomy; note that the internal ids stay `heavy`/`fast`/`technical` and why.

- [ ] **Step 5: Commit**

```bash
git add tests/__screenshots__ README.md
git commit -m "test(e2e): refresh baselines for the gladiator-type silhouettes and framing"
```

---

## Self-review notes (already applied)

- **Spec coverage:** invariant harness (T1), naming (T2), measurement (T3), camera shape (T4), camera motion (T5), rig capability (T6), silhouettes (T7), scale floor / safe area / naming coverage (T8), five-toggle staging and gate material (T9), baselines and docs (T10).
- **The pre-committed floor is in the Global Constraints, not derived in a task** — the external review's point that a floor read off the implementation cannot fail.
- **Task 1 runs first on purpose:** every later task is a visual change, and the allowlist plus full-state hashes are what make "no behaviour changed" checkable rather than asserted.
- **Task 5 admits both outcomes.** The oscillation test may pass unchanged because of the existing 12% dead zone; the plan says to record which happened rather than to add hysteresis reflexively.
- **Known soft spots, called out where they live:** the band constants are unknown until T3 measures them (T4 says so explicitly); the trident-versus-spear confusion risk is T7's authoring risk and T9's confusion-matrix test is what would catch it; T8's floor may prove unreachable, and the plan says to report rather than lower it.
