# Combat Legibility Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the fighters' mutual orientation readable at every moment, stop standing fighters from freezing, and make every combat decision inspectable — without changing combat behaviour.

**Architecture:** Four presentation changes plus one behaviourally neutral diagnostic seam. The camera's desired yaw becomes a continuous function before its clamp widens; the rig gains front/back silhouette cues on joints that already exist; the pose controller gains a bounded idle layer; and phase 4 of the encounter tick reports the candidate scoring it already computes through an opt-in collector that is inert when absent.

**Tech Stack:** TypeScript, Three.js, Vite, Vitest (unit), Playwright (e2e + screenshot baselines).

## Global Constraints

- **Combat behaviour is frozen.** No change to state, event content or ordering, the number or order of random draws, or any tick phase's effect.
- **Three hashes prove it, all unchanged:** the duel hash `dc635911` (`src/simulation/battle.test.ts`), the 100-combatant fixture hash (`src/simulation/encounterCapacity.test.ts`), and the Chromium-side duel hash (`tests/combat-visuals.spec.ts`). The duel hash must also be unchanged *with the diagnostic collector attached* — a separate assertion.
- `src/simulation/**` must not import DOM or Three.js, and must not use `Math.random`, `Date.now`, or trigonometric/transcendental functions. `src/simulation/architecture.test.ts` enforces this statically.
- `src/presentation/**` contains no game rules. It may use trigonometry freely.
- Presentation may render the root only at `lerp(previousTickState, currentTickState, alpha)`. It may never move the root by any other means.
- Screenshot baselines are per-OS: `tests/__screenshots__/win32/` and `tests/__screenshots__/linux/`. CI compares the Linux set. An ordinary test run never writes a baseline (`updateSnapshots: 'none'`).
- Debug surfaces are gated on `import.meta.env.DEV` and must be statically absent from a production build, following `?audioDebug=1` and `window.__GLADIATOR_TEST__`.
- Simulation runs at `TICKS_PER_SECOND = 60`.

---

## File Structure

| File | Responsibility | Task |
|---|---|---|
| `src/presentation/ArenaCamera.ts` | Add axis-unwrap helper, track an unclamped yaw reference, widen the clamp | 1 |
| `src/presentation/ArenaCamera.test.ts` | Rewrite the 30° test; add continuity tests | 1 |
| `src/presentation/ProceduralFighter.ts` | Visor, chest/back value contrast, forward-biased foot | 2 |
| `src/presentation/ProceduralFighter.test.ts` | Foot geometry and directionality assertions | 2 |
| `src/presentation/poses/idle.ts` (new) | Pure idle-pose sampling: phase, amplitude, joint overrides | 3 |
| `src/presentation/poses/idle.test.ts` (new) | Idle layer properties in isolation | 3 |
| `src/presentation/PoseController.ts` | Wire the idle layer between guard and gait, with suppression rules | 3 |
| `src/simulation/encounter.ts` | Opt-in decision diagnostics collector in phase 4 | 5 |
| `src/simulation/decisionDiagnostics.ts` (new) | Collector types; no logic that can alter a decision | 5 |
| `src/presentation/DecisionPanel.ts` (new) | Dev-only DOM panel rendering collected records | 6 |
| `src/main.ts` | Attach the collector and panel under `?debugDecisions=1` in dev only | 6 |

---

### Task 1: Camera yaw continuity, then a wider clamp

The desired yaw is discontinuous: `measureSpreadAxisAngle` returns a value in `(−90°, +90°]`, and an axis has period `180°`, so crossing the frame vertical flips it by nearly half a turn. Widening the clamp without fixing this first would put a 180° camera swing on screen. Fix continuity, then widen.

**Files:**
- Modify: `src/presentation/ArenaCamera.ts:67` (the clamp constant), `:160-164` (`measureDesiredYaw`), `:240-266` (state fields and constructor), `:274-284` (`reset`), `:295-332` (`update`)
- Test: `src/presentation/ArenaCamera.test.ts:251-259` (rewrite), plus new tests

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces: `MAX_YAW_RADIANS` is now `(90 * Math.PI) / 180`. `ArenaCamera` gains a private `unclampedYawReference: number`. The exported surface (`ArenaCamera`, `ArenaCameraState`, `ArenaCameraOptions`, `HorizontalFramingTarget`) is unchanged — no other task depends on anything new here.

- [ ] **Step 1: Write the failing continuity test**

Add to `src/presentation/ArenaCamera.test.ts`, inside the `describe('combat-axis yaw ...')` block:

```typescript
it('stays continuous when the pair axis crosses the frame vertical', () => {
  // The raw principal axis is reported in (-90, +90] degrees, so 91 degrees
  // comes back as -89. Without an unwrap the desired yaw jumps ~180 degrees
  // here and the damping then walks the camera through yaw=0 -- straight
  // down the pair's own axis, the exact shot this whole slice removes.
  const camera = new ArenaCamera({ minDistance: 11, maxDistance: 18 })
  camera.reset(pairOnAxis(89))

  const before = camera.update(pairOnAxis(89), 1e6).yaw
  const across = camera.update(pairOnAxis(91), 1e6).yaw

  expect(Math.abs(across - before)).toBeLessThan(15 * DEGREE)
})
```

- [ ] **Step 2: Run it and confirm it fails**

Run: `npx vitest run src/presentation/ArenaCamera.test.ts -t "crosses the frame vertical"`
Expected: FAIL — the difference is close to `180 * DEGREE` (with the current 30° clamp it manifests as a jump from `-30°` to `+30°`, i.e. `60 * DEGREE`; either way it exceeds the bound).

- [ ] **Step 3: Add the unwrap helper**

In `src/presentation/ArenaCamera.ts`, after `measureSpreadAxisAngle` (around line 149):

```typescript
/**
 * A spread axis has period `pi`, so `angle`, `angle + pi` and `angle - pi` all
 * name the same axis. This returns whichever representative sits nearest
 * `reference`, which is what makes the desired yaw a continuous function of
 * the fighters' positions: without it, a pair rotating past the frame vertical
 * flips the reported angle by nearly half a turn, and the damping then walks
 * the camera through `yaw = 0` -- pointing it straight along the pair's axis.
 */
function nearestAxisRepresentative(angle: number, reference: number): number {
  let candidate = angle
  while (candidate - reference > Math.PI / 2) candidate -= Math.PI
  while (candidate - reference < -Math.PI / 2) candidate += Math.PI
  return candidate
}
```

- [ ] **Step 4: Split `measureDesiredYaw` into raw and clamped halves**

Replace `measureDesiredYaw` (lines 151-164) with:

```typescript
/**
 * The continuous yaw that would put `targets`' spread axis across the frame:
 * the spread axis negated (a camera yawed by `-theta` has its
 * screen-horizontal axis along `+theta`), resolved to the representative
 * nearest `reference`. Unclamped on purpose -- the caller clamps, and keeps
 * this unclamped value as its own reference, so that pinning at the clamp
 * limit never drags the unwrap out of phase with the real axis.
 *
 * The `angle === 0` branch is not a micro-optimization -- it keeps a
 * degenerate group's yaw at `+0` instead of `-0`, so a stacked pair and a
 * pristine `reset()` produce states that are `Object.is`-identical rather
 * than merely `==`.
 */
function measureUnclampedYaw(targets: readonly HorizontalFramingTarget[], reference: number): number {
  const angle = measureSpreadAxisAngle(targets)
  if (angle === 0 && reference === 0) return 0
  return nearestAxisRepresentative(-angle, reference)
}
```

- [ ] **Step 5: Widen the clamp constant**

Replace line 66-67:

```typescript
/**
 * design.md (2026-08-19 legibility slice): "+/-90 degrees from the arena's
 * authored home shot", superseding the 2026-08-18 amendment's +/-30. The bound
 * is not arbitrary: with the unwrap in place the peak measured offset from
 * home across all nine pairings is exactly 90 degrees, because the axis
 * oscillates rather than winding. So the camera tracks the axis essentially
 * always, and where it cannot it holds at the limit instead of flipping to the
 * far side of the arena.
 */
const MAX_YAW_RADIANS = (90 * Math.PI) / 180
```

- [ ] **Step 6: Track the unclamped reference in the class**

Add the field next to `yawReference` (around line 250) and initialise it in the constructor (after line 264):

```typescript
  private unclampedYawReference: number
```

```typescript
    this.unclampedYawReference = 0
```

- [ ] **Step 7: Use it in `reset`**

Replace the first three lines of `reset` (lines 275-277) with:

```typescript
    const unclamped = measureUnclampedYaw(targets, 0)
    const yaw = clamp(unclamped, -MAX_YAW_RADIANS, MAX_YAW_RADIANS)
    const { midpointX, midpointZ, extent } = measureGroup(targets, yaw)
    this.unclampedYawReference = unclamped
    this.yawReference = yaw
```

`reset` unwraps against `0`, not against the previous reference: a hard cut at a new bout has no history to stay continuous with, and anchoring to home keeps the opening shot deterministic.

- [ ] **Step 8: Use it in `update`**

Replace lines 300-304 with:

```typescript
    const unclamped = measureUnclampedYaw(targets, this.unclampedYawReference)
    if (Math.abs(unclamped - this.unclampedYawReference) > YAW_DEAD_ZONE_RADIANS) {
      this.unclampedYawReference = unclamped
      this.yawReference = clamp(unclamped, -MAX_YAW_RADIANS, MAX_YAW_RADIANS)
    }
    const yaw = approach(this.state.yaw, this.yawReference, YAW_DAMPING_TIME_CONSTANT_SECONDS, elapsedSeconds)
```

The dead zone is now measured against the unclamped reference. Measuring it against the clamped one would let a pinned camera see phantom motion every tick while the axis moved outside the limit.

- [ ] **Step 9: Run the continuity test**

Run: `npx vitest run src/presentation/ArenaCamera.test.ts -t "crosses the frame vertical"`
Expected: PASS

- [ ] **Step 10: Rewrite the obsolete 30° test**

The test at lines 251-259 asserts the old policy and now fails. Replace it entirely with:

```typescript
    it('follows an axis pointing at the camera instead of giving up at 30 degrees', () => {
      const camera = new ArenaCamera({ minDistance: 11, maxDistance: 18 })
      // 80 degrees off X: nearly nose-on to the home shot, the case the old
      // +/-30 clamp could not frame at all.
      const framed = camera.reset(pairOnAxis(80))
      expect(framed.yaw).toBeCloseTo(-80 * DEGREE, 10)

      const settled = camera.update(pairOnAxis(80), 1e6)
      expect(settled.yaw).toBeCloseTo(-80 * DEGREE, 10)

      // The property the old test was really protecting: the shot is squared
      // to the pair, not looking down its axis.
      expect(onScreenSeparation(pairOnAxis(80), settled.yaw)).toBeGreaterThan(
        onScreenSeparation(pairOnAxis(80), 0),
      )
    })

    it('still refuses to swing past 90 degrees from the home shot', () => {
      const camera = new ArenaCamera({ minDistance: 11, maxDistance: 18 })
      camera.reset(pairOnAxis(0))
      for (let step = 0; step < 40; step += 1) {
        camera.update(pairOnAxis(89), 1e6)
      }
      expect(Math.abs(camera.update(pairOnAxis(89), 1e6).yaw)).toBeLessThanOrEqual(90 * DEGREE + 1e-9)
    })
```

- [ ] **Step 11: Add the degenerate-covariance test**

```typescript
    it('does not flip the reference on noise around a degenerate spread', () => {
      // Two targets a hair apart: covariance is near zero and its sign is
      // numerically fragile. The camera must not treat that as a real axis
      // rotation and swing.
      const camera = new ArenaCamera({ minDistance: 11, maxDistance: 18 })
      camera.reset(pairOnAxis(0))
      const yaws: number[] = []
      for (const epsilon of [1e-9, -1e-9, 1e-12, -1e-12, 0]) {
        yaws.push(
          camera.update(
            [
              { id: 'a', centerX: -1, centerZ: epsilon, radius: 0.5 },
              { id: 'b', centerX: 1, centerZ: -epsilon, radius: 0.5 },
            ],
            0.5,
          ).yaw,
        )
      }
      for (const yaw of yaws) expect(Math.abs(yaw)).toBeLessThan(5 * DEGREE)
    })
```

- [ ] **Step 12: Add the whole-bout continuity test**

Add a new `describe` block at the end of `src/presentation/ArenaCamera.test.ts`. Add these imports at the top of the file:

```typescript
import { COMBAT_STYLES } from '../content/combatStyles'
import { BASELINE_TEST_SEED, homeRoster, opponents } from '../content/mvpSeries'
import { advanceBattleTick, createBattle, fighterBySide, type BattleState } from '../simulation/battle'
```

```typescript
describe('yaw continuity over real bouts', () => {
  it('never changes the desired yaw by more than 15 degrees in a tick, in any pairing', () => {
    for (const home of homeRoster) {
      for (const away of opponents) {
        const camera = new ArenaCamera({ minDistance: 11, maxDistance: 18 })
        let battle: BattleState = createBattle({ home, away, seed: BASELINE_TEST_SEED, combatStyles: COMBAT_STYLES })
        const framing = (state: BattleState) => {
          const h = fighterBySide(state, 'home')
          const a = fighterBySide(state, 'away')
          return [
            { id: 'home', centerX: h.position.x, centerZ: h.position.z, radius: 0.6 },
            { id: 'away', centerX: a.position.x, centerZ: a.position.z, radius: 0.6 },
          ]
        }
        let previous = camera.reset(framing(battle)).yaw
        let ticks = 0
        while (battle.phase === 'running' && ticks < 3600) {
          battle = advanceBattleTick(battle)
          const yaw = camera.update(framing(battle), 1 / 60).yaw
          expect(Math.abs(yaw - previous)).toBeLessThan(15 * DEGREE)
          previous = yaw
          ticks += 1
        }
      }
    }
  })
})
```

- [ ] **Step 13: Run the full camera suite**

Run: `npx vitest run src/presentation/ArenaCamera.test.ts`
Expected: PASS, all tests

- [ ] **Step 14: Run the whole unit suite to confirm nothing else depended on the old clamp**

Run: `npm test`
Expected: PASS. In particular the three frozen hashes are untouched — this task changes no simulation file.

- [ ] **Step 15: Commit**

```bash
git add src/presentation/ArenaCamera.ts src/presentation/ArenaCamera.test.ts
git commit -m "fix(camera): make the desired yaw continuous, then widen the clamp to 90 degrees

The pair axis is reported in (-90, +90], and an axis has period 180, so
crossing the frame vertical flipped the desired yaw by nearly half a turn --
measured at 179 degrees, 2 to 4 times per bout in three pairings. The old
+/-30 clamp hid it. Resolving the axis to the representative nearest the
held yaw removes the flip (worst tick-to-tick change drops to 10.2 degrees),
which is what makes the wider clamp safe rather than a regression."
```

---

### Task 2: Rig directionality

A back view of the rig is nearly indistinguishable from a front view: box torso, capsule limbs, dome helmet, and a foot box centred on Z. This is the second, independent cause of "both fighters face the camera" — fixing the camera alone leaves it standing.

**Files:**
- Modify: `src/presentation/ProceduralFighter.ts` (`buildLeg` around `:426-441`, torso/head construction, `addBoxSegment` around `:322-338`)
- Test: `src/presentation/ProceduralFighter.test.ts`

**Interfaces:**
- Consumes: nothing from Task 1.
- Produces: `addBoxSegment` gains a trailing optional parameter `forwardOffset = 0` (metres along local `+Z`). Existing call sites are unaffected because the default reproduces today's geometry exactly. No exported type changes.

- [ ] **Step 1: Write the failing foot-directionality test**

Add to `src/presentation/ProceduralFighter.test.ts`:

```typescript
it('gives each foot a forward bias, so a back view is not a mirror of a front view', () => {
  const fighter = createProceduralFighter('heavy')
  const foot = fighter.joints.get('foot.L')
  expect(foot).toBeDefined()

  const boxes = foot!.children.filter(
    (child): child is THREE.Mesh => child instanceof THREE.Mesh && child.userData.slot === 'limb',
  )
  // Exactly one foot volume: the fix biases the existing box, it does not add
  // a second overlapping one.
  expect(boxes).toHaveLength(1)

  const box = new THREE.Box3().setFromObject(boxes[0])
  // More of the foot lies forward of the ankle than behind it.
  expect(box.max.z).toBeGreaterThan(Math.abs(box.min.z))

  disposeRig(fighter)
})
```

Adjust the construction call (`createProceduralFighter`) and disposal helper to match whatever the existing tests in this file already use — read the top of `ProceduralFighter.test.ts` and copy its setup verbatim rather than inventing a second one.

- [ ] **Step 2: Run it and confirm it fails**

Run: `npx vitest run src/presentation/ProceduralFighter.test.ts -t "forward bias"`
Expected: FAIL — the box is centred on Z, so `box.max.z` equals `|box.min.z|`.

- [ ] **Step 3: Add the forward-offset parameter to `addBoxSegment`**

Replace `addBoxSegment` (lines 321-338):

```typescript
/**
 * Adds a box mesh spanning from `joint` upward by `height`, plus a cheap
 * rim-outline duplicate. `forwardOffset` shifts the box along local `+Z`
 * (the rig's forward axis); it defaults to `0`, which is the Z-centred
 * placement every caller but the foot wants.
 */
function addBoxSegment(
  owned: Owned,
  joint: THREE.Object3D,
  width: number,
  height: number,
  depth: number,
  material: THREE.Material,
  slot: string,
  forwardOffset = 0,
): THREE.Mesh {
  const geometry = trackedGeometry(owned, new THREE.BoxGeometry(width, height, depth))
  const mesh = new THREE.Mesh(geometry, material)
  mesh.position.set(0, height / 2, forwardOffset)
  mesh.userData.slot = slot
  joint.add(mesh)
  addRimOutline(owned, joint, mesh)
  return mesh
}
```

`addRimOutline` copies `sourceMesh.position`, so the outline follows the offset with no further change.

- [ ] **Step 4: Bias the foot forward**

In `buildLeg`, replace line 440:

```typescript
  // The foot's own length, shifted so roughly three quarters of it sits ahead
  // of the ankle. A Z-centred foot reads identically from front and back,
  // which is half of why a back view is mistaken for a face-on view.
  addBoxSegment(owned, foot, body.limbRadius * 1.6, body.limbRadius * 0.7, body.footLength, material, 'limb', body.footLength * 0.25)
```

- [ ] **Step 5: Run the foot test**

Run: `npx vitest run src/presentation/ProceduralFighter.test.ts -t "forward bias"`
Expected: PASS

- [ ] **Step 6: Write the failing floor-contact test**

The foot must still rest on the floor plane after being moved.

```typescript
it('keeps both feet on the floor plane in the rest pose', () => {
  const fighter = createProceduralFighter('heavy')
  for (const name of ['foot.L', 'foot.R'] as const) {
    const foot = fighter.joints.get(name)!
    const box = new THREE.Box3().setFromObject(foot)
    expect(box.min.y).toBeGreaterThan(-0.02)
    expect(box.min.y).toBeLessThan(0.02)
  }
  disposeRig(fighter)
})
```

- [ ] **Step 7: Run it**

Run: `npx vitest run src/presentation/ProceduralFighter.test.ts -t "floor plane"`
Expected: PASS if the rest pose already grounds the feet. If it FAILS, the pre-existing rest pose — not this change — is off the floor; record the measured value in the test as the accepted tolerance and note it in the commit message rather than silently widening the bound.

- [ ] **Step 8: Write the failing visor test**

```typescript
it('gives the head a front: a visor slot on the forward hemisphere', () => {
  const fighter = createProceduralFighter('fast')
  const head = fighter.joints.get('head')!
  const visor = head.children.find((child) => child.userData.slot === 'visor')
  expect(visor).toBeDefined()
  // Sits forward of the head's own centre.
  expect(visor!.position.z).toBeGreaterThan(0)
  disposeRig(fighter)
})
```

- [ ] **Step 9: Run it and confirm it fails**

Run: `npx vitest run src/presentation/ProceduralFighter.test.ts -t "visor slot"`
Expected: FAIL — no child carries `slot === 'visor'`.

- [ ] **Step 10: Build the visor**

In the head construction (where `addSphere` builds the head, near the helmet dome at line 518), add after the head sphere exists — using the same `bronze`/dark material pattern already in `buildEquipment`:

```typescript
  // A dark slot across the front of the head. Deliberately geometry, not just
  // colour: it has to read as a front at the arena's framing distance, where
  // the whole head is a few pixels wide.
  const visorGeometry = trackedGeometry(owned, new THREE.BoxGeometry(spec.body.headRadius * 1.5, spec.body.headRadius * 0.42, spec.body.headRadius * 0.5))
  const visor = new THREE.Mesh(visorGeometry, trackedMaterial(owned, new THREE.MeshStandardMaterial({ color: 0x11151c, roughness: 0.6 })))
  visor.position.set(0, spec.body.headRadius * 0.1, spec.body.headRadius * 0.78)
  visor.userData.slot = 'visor'
  head.add(visor)
```

Place this in the same function that builds the head mesh, using that function's own `owned` and `spec` bindings. If the head is built in `buildEquipment`, use the `joints` lookup for `'head'` there; if it is built in the body assembly, add it there. Read the surrounding function before inserting and match its existing bindings — do not add new parameters.

- [ ] **Step 11: Run the visor test**

Run: `npx vitest run src/presentation/ProceduralFighter.test.ts -t "visor slot"`
Expected: PASS

- [ ] **Step 12: Write the failing chest/back contrast test**

```typescript
it('separates chest from back by value, without introducing a third hue', () => {
  const fighter = createProceduralFighter('technical')
  const chest = fighter.joints.get('chest')!
  const plate = chest.children.find((child) => child.userData.slot === 'breastplate')
  expect(plate).toBeDefined()
  expect((plate as THREE.Mesh).position.z).toBeGreaterThan(0)
  disposeRig(fighter)
})
```

- [ ] **Step 13: Run it and confirm it fails**

Run: `npx vitest run src/presentation/ProceduralFighter.test.ts -t "chest from back"`
Expected: FAIL — no `breastplate` slot exists.

- [ ] **Step 14: Build the breastplate**

Next to the existing chest construction, using the fighter's own skin/house colour lightened rather than a new hue:

```typescript
  // Front-versus-back carried by value inside the fighter's own house colour.
  // A third hue would compete with the red/blue that already separates the two
  // fighters from each other.
  const plateGeometry = trackedGeometry(owned, new THREE.BoxGeometry(spec.body.torsoWidth * 0.72, spec.body.chestHeight * 0.62, spec.body.torsoDepth * 0.22))
  const plate = new THREE.Mesh(plateGeometry, trackedMaterial(owned, new THREE.MeshStandardMaterial({ color: lightenedHouseColor, metalness: 0.35, roughness: 0.45 })))
  plate.position.set(0, spec.body.chestHeight * 0.5, spec.body.torsoDepth * 0.5)
  plate.userData.slot = 'breastplate'
  chest.add(plate)
```

Derive `lightenedHouseColor` from the same colour the torso material already uses in this function — read how the torso material is constructed and lighten that value (for example via `new THREE.Color(base).lerp(new THREE.Color(0xffffff), 0.35)`). Do not hard-code a literal, or the two houses will stop being distinguishable.

- [ ] **Step 15: Run the contrast test, then the full file**

Run: `npx vitest run src/presentation/ProceduralFighter.test.ts`
Expected: PASS, all tests including the pre-existing anchor/worn-decoration split assertions.

- [ ] **Step 16: Run the full unit suite**

Run: `npm test`
Expected: PASS. Pose fixtures are unaffected: no joint was added, moved, or renamed.

- [ ] **Step 17: Commit**

```bash
git add src/presentation/ProceduralFighter.ts src/presentation/ProceduralFighter.test.ts
git commit -m "feat(rig): give the fighter a readable front

A box torso, capsule limbs, a dome helmet and a Z-centred foot look the same
from behind as from the front, which is the second half of why both fighters
read as facing the viewer. Adds a visor slot, a value-contrasted breastplate
inside each house's own colour, and biases the existing foot box forward
rather than adding a second overlapping mesh."
```

---

### Task 3: Idle pose layer

A standing fighter collapses to a static guard stance because the gait blend is weighted by speed and there is no idle layer. The naive fix fights three existing systems — grounding, action overlays, and the fixed-tick pose fixtures — so its scope is bounded up front.

**Files:**
- Create: `src/presentation/poses/idle.ts`, `src/presentation/poses/idle.test.ts`
- Modify: `src/presentation/PoseController.ts:649-671` (layer wiring)

**Interfaces:**
- Consumes: nothing from Tasks 1-2.
- Produces:
  - `export function computeIdlePhase(simulationTime: number, combatantId: string): number` — returns `0..1`.
  - `export function idleAmplitude(speedWeight: number, suppressed: boolean, reducedMotion: boolean): number` — returns `0..1`, exactly `0` when `suppressed` or `reducedMotion`.
  - `export function sampleIdleLayer(phase: number, amplitude: number): SparsePose` — torso and arm joints only.
  - `SparsePose` is the existing type in `PoseController.ts`; import it from there, or move it to a shared module if that creates a cycle.

- [ ] **Step 1: Write the failing idle-phase tests**

Create `src/presentation/poses/idle.test.ts`:

```typescript
import { describe, expect, it } from 'vitest'
import { computeIdlePhase, idleAmplitude, sampleIdleLayer } from './idle'

describe('idle phase', () => {
  it('advances smoothly with interpolated simulation time, not in 60 Hz steps', () => {
    const a = computeIdlePhase(10.0, 'brutus')
    const b = computeIdlePhase(10.0 + 1 / 240, 'brutus')
    expect(b).not.toBe(a)
  })

  it('puts two fighters out of phase so they never sway in unison', () => {
    expect(computeIdlePhase(10.0, 'brutus')).not.toBeCloseTo(computeIdlePhase(10.0, 'drusus'), 3)
  })

  it('stays inside 0..1', () => {
    for (const time of [0, 0.5, 7.25, 123.75]) {
      const phase = computeIdlePhase(time, 'nerva')
      expect(phase).toBeGreaterThanOrEqual(0)
      expect(phase).toBeLessThan(1)
    }
  })
})

describe('idle amplitude', () => {
  it('is zero at full speed and full when standing', () => {
    expect(idleAmplitude(1, false, false)).toBe(0)
    expect(idleAmplitude(0, false, false)).toBe(1)
  })

  it('is exactly zero when suppressed or under reduced motion', () => {
    // Exactly zero, not merely small: the acceptance criterion is that the
    // pose is *identical* between ticks under reduced motion.
    expect(idleAmplitude(0, true, false)).toBe(0)
    expect(idleAmplitude(0, false, true)).toBe(0)
  })
})

describe('idle sampling', () => {
  it('writes nothing at zero amplitude', () => {
    expect(Object.keys(sampleIdleLayer(0.4, 0))).toHaveLength(0)
  })

  it('never writes leg or foot joints, which grounding owns', () => {
    const pose = sampleIdleLayer(0.4, 1)
    for (const name of Object.keys(pose)) {
      expect(name).not.toMatch(/^(upperLeg|lowerLeg|foot)\./)
    }
  })
})
```

- [ ] **Step 2: Run and confirm it fails**

Run: `npx vitest run src/presentation/poses/idle.test.ts`
Expected: FAIL — `./idle` does not exist.

- [ ] **Step 3: Implement the idle module**

Create `src/presentation/poses/idle.ts`:

```typescript
// A standing fighter's breathing and weight shift. Presentation only: this
// never touches the root, only pose joints, and it owns a joint set disjoint
// from the ones the grounding layer pins.
//
// Phase comes from interpolated simulation time, never wall-clock. Pose
// baselines and key-pose fixtures are captured at fixed ticks, so a
// wall-clock idle would make every one of them flaky.

import type { SparsePose } from '../PoseController'

/** Seconds for one full breathing cycle. Slow enough to read as breathing rather than fidgeting. */
const IDLE_CYCLE_SECONDS = 3.4

/** Peak joint rotation in radians at full amplitude -- small on purpose: this must never compete with a guard stance. */
const IDLE_ROTATION_RADIANS = 0.035

/**
 * A stable per-combatant phase offset in `0..1`, so two fighters standing at
 * the same moment are never in unison (which reads as a bug, not as life).
 * A plain string hash, not `Math.random`: this must be identical on every run
 * and in every runtime, exactly like the rest of presentation sampling.
 */
function idPhaseOffset(combatantId: string): number {
  let hash = 2166136261
  for (let index = 0; index < combatantId.length; index += 1) {
    hash ^= combatantId.charCodeAt(index)
    hash = Math.imul(hash, 16777619)
  }
  return ((hash >>> 0) % 1000) / 1000
}

export function computeIdlePhase(simulationTime: number, combatantId: string): number {
  const raw = simulationTime / IDLE_CYCLE_SECONDS + idPhaseOffset(combatantId)
  return raw - Math.floor(raw)
}

export function idleAmplitude(speedWeight: number, suppressed: boolean, reducedMotion: boolean): number {
  if (suppressed || reducedMotion) return 0
  const clamped = speedWeight < 0 ? 0 : speedWeight > 1 ? 1 : speedWeight
  return 1 - clamped
}

export function sampleIdleLayer(phase: number, amplitude: number): SparsePose {
  if (amplitude <= 0) return {}
  const swing = Math.sin(phase * Math.PI * 2) * IDLE_ROTATION_RADIANS * amplitude
  const breath = Math.sin(phase * Math.PI * 2 + Math.PI / 3) * IDLE_ROTATION_RADIANS * 0.6 * amplitude
  return {
    pelvis: { rotation: [0, 0, swing * 0.5] },
    chest: { rotation: [breath, 0, -swing * 0.4] },
    'shoulder.L': { rotation: [breath * 0.8, 0, 0] },
    'shoulder.R': { rotation: [breath * 0.8, 0, 0] },
  }
}
```

Before writing this, read the `SparsePose` and `JointTransform` shapes in `PoseController.ts` / `poses/combatPoses.ts` and match them exactly — in particular whether `rotation` is a 3-tuple and whether `position` may be omitted. Adjust the returned literals to the real shape rather than assuming this one.

- [ ] **Step 4: Run the idle tests**

Run: `npx vitest run src/presentation/poses/idle.test.ts`
Expected: PASS

- [ ] **Step 5: Write the failing controller-integration tests**

Add to `src/presentation/PoseController.test.ts`, copying the existing test setup helpers in that file for building a `PoseSampleInput`:

```typescript
it('keeps a standing fighter alive between ticks', () => {
  const controller = new PoseController()
  const standing = neutralStandingInput({ tick: 100 })
  const later = neutralStandingInput({ tick: 130 })

  const first = controller.apply(standing, fighter)
  const second = controller.apply(later, fighter)

  expect(second.pose).not.toEqual(first.pose)
})

it('is perfectly still under reduced motion', () => {
  const controller = new PoseController()
  const first = controller.apply(neutralStandingInput({ tick: 100, reducedMotion: true }), fighter)
  const second = controller.apply(neutralStandingInput({ tick: 130, reducedMotion: true }), fighter)

  expect(second.pose).toEqual(first.pose)
})

it('does not breathe through a held impact pose', () => {
  const controller = new PoseController()
  const first = controller.apply(impactHoldInput({ tick: 100 }), fighter)
  const second = controller.apply(impactHoldInput({ tick: 130 }), fighter)

  expect(second.pose).toEqual(first.pose)
})
```

`neutralStandingInput` and `impactHoldInput` are local helpers you write in this file: the first builds a `PoseSampleInput` with `action.type === 'neutral'`, zero velocity, `staggerUntilTick` in the past and `status === 'active'`; the second builds one with an attack action in its `impact` phase. Model both on the input-building helper the file already uses.

- [ ] **Step 6: Run and confirm the first two fail**

Run: `npx vitest run src/presentation/PoseController.test.ts -t "standing fighter alive"`
Expected: FAIL — the pose is identical, because there is no idle layer yet.

- [ ] **Step 7: Wire the layer into `PoseController.apply`**

In `src/presentation/PoseController.ts`, add the import:

```typescript
import { computeIdlePhase, idleAmplitude, sampleIdleLayer } from './poses/idle'
```

Insert between Layer 1 and Layer 2 (after line 652, `mergeInto(working, stylePoses.guard.joints)`):

```typescript
    // Layer 1b: idle. Suppressed whenever a later layer owns the body --
    // an action, a defensive reaction, stagger or defeat -- because those
    // hold poses that a breathing overlay would corrupt, including the
    // impact hold the fixtures assert is identical across ticks.
    const idleSuppressed =
      current.action.type !== 'neutral' ||
      current.status !== 'active' ||
      current.staggerUntilTick > currentTick ||
      recognitionFlinchActive ||
      reaction?.contactTarget !== undefined
    const simulationTime = (currentTick + alpha) / TICKS_PER_SECOND
    mergeInto(
      working,
      sampleIdleLayer(
        computeIdlePhase(simulationTime, current.definition.id),
        idleAmplitude(clamp01(vecLength(lerpVec2(previous.velocity, current.velocity, alpha)) / GAIT_FULL_SPEED_REFERENCE), idleSuppressed, reducedMotion),
      ),
    )
```

Import `TICKS_PER_SECOND` from `../simulation/movement` if `PoseController.ts` does not already have it. Note the velocity/`speedWeight` expression duplicates what Layer 2 computes on line 658 — hoist that computation above Layer 1b and reuse the single `speedWeight` binding in both places rather than computing it twice.

- [ ] **Step 8: Run the controller tests**

Run: `npx vitest run src/presentation/PoseController.test.ts`
Expected: PASS, all tests including the pre-existing impact-hold and grounding assertions.

- [ ] **Step 9: Verify the layer never survives grounding on a planted foot**

Add:

```typescript
it('leaves a planted foot exactly where grounding puts it', () => {
  const controller = new PoseController()
  const standing = neutralStandingInput({ tick: 100 })
  const later = neutralStandingInput({ tick: 130 })

  const first = controller.apply(standing, fighter)
  const second = controller.apply(later, fighter)

  for (const name of ['foot.L', 'foot.R', 'upperLeg.L', 'upperLeg.R'] as const) {
    expect(second.pose[name]).toEqual(first.pose[name])
  }
})
```

Run: `npx vitest run src/presentation/PoseController.test.ts -t "planted foot"`
Expected: PASS — `sampleIdleLayer` writes no leg joints at all, so grounding has nothing to undo.

- [ ] **Step 10: Run the full unit suite**

Run: `npm test`
Expected: PASS, including all fixed-tick pose fixtures.

- [ ] **Step 11: Commit**

```bash
git add src/presentation/poses/idle.ts src/presentation/poses/idle.test.ts src/presentation/PoseController.ts src/presentation/PoseController.test.ts
git commit -m "feat(pose): keep a standing fighter alive

The gait blend is weighted by speed, so a stationary fighter collapsed into a
static guard stance -- and heavy and technical fighters stand for two thirds
of a bout. Adds a bounded idle layer: torso and arms only so grounding still
owns the legs, suppressed under any action, stagger or defeat overlay so held
poses stay held, phased from interpolated simulation time so fixed-tick
fixtures stay deterministic, and exactly zero under reduced motion."
```

---

### Task 4: Regenerate screenshot baselines

Tasks 1-3 all change what the arena looks like. Regenerate once, here, rather than three times.

**Files:**
- Modify: `tests/__screenshots__/win32/*.png`, `tests/__screenshots__/linux/*.png`

**Interfaces:**
- Consumes: the visual output of Tasks 1-3.
- Produces: baselines every later task's e2e run compares against.

- [ ] **Step 1: Confirm the suite fails on the old baselines**

Run: `npm run test:e2e`
Expected: FAIL on the five combat screenshots (`heavy-cleave`, `fast-burst`, `technical-parry`, `combat-outcomes`, `combat-safe-frame`). Planning and interstitial shots should still pass — if they changed, something in this slice reached further than intended; stop and investigate before regenerating.

- [ ] **Step 2: Regenerate the Windows set**

Run: `npx playwright test tests/combat-visuals.spec.ts --update-snapshots`

- [ ] **Step 3: Review every regenerated PNG by eye**

Open each changed file under `tests/__screenshots__/win32/`. Confirm, per `AGENTS.md`: readable silhouette, visible spacing between fighters, visible anticipation/contact/recovery, stable camera framing, correct stat labels. Specifically for this slice: the two fighters are square to the frame and clearly oriented toward each other, and front/back are distinguishable. Do not accept incidental changes to planning, interstitial, or summary screens.

- [ ] **Step 4: Regenerate the Linux set CI compares against**

```bash
git archive HEAD | tar -x -C /tmp/shots
docker run --rm -v /tmp/shots:/work -w /work mcr.microsoft.com/playwright:v1.62.1-noble \
  bash -lc "npm ci && npm run build && npx playwright test --update-snapshots"
cp /tmp/shots/tests/__screenshots__/linux/*.png tests/__screenshots__/linux/
```

- [ ] **Step 5: Review the Linux PNGs the same way**

They differ from the Windows set only in font rasterisation and antialiasing. Any structural difference means the two runs disagree about the scene — investigate rather than accept.

- [ ] **Step 6: Run the full e2e suite green**

Run: `npm run test:e2e`
Expected: PASS

- [ ] **Step 7: Commit**

```bash
git add tests/__screenshots__
git commit -m "test: accept the legibility slice's intended visual change

Regenerated for the widened camera yaw, the rig's new front cues, and the
idle layer. Every PNG reviewed by eye; planning and summary screens
unchanged."
```

---

### Task 5: Decision diagnostics seam

An external recompute is impossible: phase 4 runs on state left by phases 1-3, which no public snapshot exposes. Reproducing that outside the kernel would duplicate a third of the tick. Instead, phase 4 reports what it already computed, through a collector that is inert when absent.

**Files:**
- Create: `src/simulation/decisionDiagnostics.ts`
- Modify: `src/simulation/encounter.ts` (`makeCombatDecisions` at `:1049-1118`, `advanceEncounterTick` at `:2142`)
- Test: `src/simulation/decisionDiagnostics.test.ts` (new)

**Interfaces:**
- Consumes: nothing from Tasks 1-4.
- Produces:
  - `export type DecisionRecord` — a discriminated union on `kind`: `'weighted' | 'fallback' | 'forced' | 'skipped'`.
  - `export interface DecisionCollector { record(entry: DecisionRecord): void }`
  - `advanceEncounterTick(previous: EncounterState, collector?: DecisionCollector): EncounterTransition`
  - Task 6 consumes `DecisionRecord` and `DecisionCollector`.

- [ ] **Step 1: Write the failing behaviour-frozen test**

Create `src/simulation/decisionDiagnostics.test.ts`:

```typescript
import { describe, expect, it } from 'vitest'
import { COMBAT_STYLES } from '../content/combatStyles'
import { BASELINE_TEST_SEED, homeRoster, opponents } from '../content/mvpSeries'
import { advanceBattleTick, createBattle, type BattleState } from './battle'
import type { DecisionCollector, DecisionRecord } from './decisionDiagnostics'

// The collector is passed per call, never stored on `BattleState`: anything
// living in that object risks being folded into the trace hash.
function runBout(collector?: DecisionCollector): { traceHash: number; ticks: number } {
  let battle: BattleState = createBattle({
    home: homeRoster[0],
    away: opponents[0],
    seed: BASELINE_TEST_SEED,
    combatStyles: COMBAT_STYLES,
  })
  let ticks = 0
  while (battle.phase === 'running' && ticks < 3600) {
    battle = advanceBattleTick(battle, collector)
    ticks += 1
  }
  return { traceHash: battle.traceHash, ticks }
}

describe('decision diagnostics', () => {
  it('does not change behaviour when a collector is attached', () => {
    const without = runBout()
    const records: DecisionRecord[] = []
    const withCollector = runBout({ record: (entry) => records.push(entry) })

    expect(withCollector.traceHash).toBe(without.traceHash)
    expect(withCollector.ticks).toBe(without.ticks)
    expect(records.length).toBeGreaterThan(0)
  })

  it('records every weighted decision with its candidates, roll and winner', () => {
    const records: DecisionRecord[] = []
    runBout({ record: (entry) => records.push(entry) })

    const weighted = records.filter((entry) => entry.kind === 'weighted')
    expect(weighted.length).toBeGreaterThan(0)
    for (const entry of weighted) {
      if (entry.kind !== 'weighted') continue
      expect(entry.candidates.length).toBeGreaterThan(0)
      expect(entry.roll).toBeGreaterThanOrEqual(0)
      expect(entry.roll).toBeLessThan(1)
      expect(entry.candidates.some((candidate) => candidate.weight > 0)).toBe(true)
    }
  })

  it('records forced behaviours separately, with no roll', () => {
    const records: DecisionRecord[] = []
    // fast vs heavy exercises Fast's forced disengage heavily.
    let battle: BattleState = createBattle({
      home: homeRoster.find((f) => f.archetype === 'fast')!,
      away: opponents.find((f) => f.archetype === 'heavy')!,
      seed: BASELINE_TEST_SEED,
      combatStyles: COMBAT_STYLES,
    })
    const collector = { record: (entry: DecisionRecord) => records.push(entry) }
    for (let tick = 0; battle.phase === 'running' && tick < 3600; tick += 1) {
      battle = advanceBattleTick(battle, collector)
    }

    expect(records.some((entry) => entry.kind === 'forced')).toBe(true)
  })
})
```

- [ ] **Step 2: Run and confirm it fails**

Run: `npx vitest run src/simulation/decisionDiagnostics.test.ts`
Expected: FAIL — the module does not exist.

- [ ] **Step 3: Define the record types**

Create `src/simulation/decisionDiagnostics.ts`:

```typescript
// Opt-in diagnostics for phase 4. Nothing here may influence a decision: the
// collector is write-only from the kernel's perspective, is never read back
// inside a tick, and never enters `EncounterState` or the event log -- which
// is why no trace hash folds over it.
//
// Four distinct paths reach an action, and each gets its own record shape.
// Flattening them into one would misrepresent forced behaviours and defensive
// reactions as weighted rolls, which they are not.

import type { CombatantId } from './encounter'
import type { AttackActionId } from './combatActions'
import type { LocomotionIntent } from './movement'

export type DecisionOutcome =
  | { type: 'locomotion'; locomotionIntent: LocomotionIntent }
  | { type: 'action'; actionId: AttackActionId }

export interface ScoredCandidateRecord {
  decision: DecisionOutcome
  weight: number
}

export type DecisionRecord =
  /** An ordinary phase-4 weighted selection. */
  | {
      kind: 'weighted'
      tick: number
      combatantId: CombatantId
      candidates: readonly ScoredCandidateRecord[]
      roll: number
      chosen: DecisionOutcome
    }
  /** The candidate set was empty, so the deterministic fallback ran. No roll decided anything. */
  | { kind: 'fallback'; tick: number; combatantId: CombatantId; chosen: DecisionOutcome }
  /** Fast's disengage or Technical's parry-counter: phase 4 is bypassed entirely, and no decision-stream draw happens. */
  | { kind: 'forced'; tick: number; combatantId: CombatantId; behaviour: 'disengage' | 'parry-counter' }
  /** Decision-ready checks failed: not yet due, staggered, mid-action, or no valid target. */
  | { kind: 'skipped'; tick: number; combatantId: CombatantId; reason: 'not-due' | 'no-target' }

export interface DecisionCollector {
  record(entry: DecisionRecord): void
}
```

- [ ] **Step 4: Thread the collector through phase 4**

In `src/simulation/encounter.ts`, add `collector: DecisionCollector | undefined` as the final parameter of `makeCombatDecisions`, then record at each of the four sites in its loop. The forced-behaviour `continue` at line 1076:

```typescript
    if (self.forcedDisengageStartTick !== undefined || forcedActionActorIds.has(id)) {
      collector?.record({
        kind: 'forced',
        tick,
        combatantId: id,
        behaviour: self.forcedDisengageStartTick !== undefined ? 'disengage' : 'parry-counter',
      })
      continue
    }
```

The readiness `continue` at line 1077:

```typescript
    if (!isDecisionReady(self, tick) || self.targetId === undefined) {
      collector?.record({
        kind: 'skipped',
        tick,
        combatantId: id,
        reason: self.targetId === undefined ? 'no-target' : 'not-due',
      })
      continue
    }
```

And after the decision is made (replacing line 1094):

```typescript
    const scored = scoreCombatCandidates(context, style)
    const decision = chooseCombatDecision(context, style, { selection: rolls.first, interval: rolls.second })
    collector?.record(
      scored.length === 0
        ? { kind: 'fallback', tick, combatantId: id, chosen: decision }
        : { kind: 'weighted', tick, combatantId: id, candidates: scored, roll: rolls.first, chosen: decision },
    )
```

**Critical:** `scoreCombatCandidates` is pure and draws no randomness, so calling it here changes nothing about the roll sequence — but confirm that by reading it before you rely on it. If it ever consumed a draw, this whole approach would be invalid and the task must stop. Import it alongside the existing `chooseCombatDecision` import.

- [ ] **Step 5: Thread the collector from the entry points**

Add the optional parameter to `advanceEncounterTick`:

```typescript
export function advanceEncounterTick(previous: EncounterState, collector?: DecisionCollector): EncounterTransition {
```

Pass it into the `makeCombatDecisions` call inside, and add matching optional trailing parameters to `advanceEncounterTicks` and to `advanceBattleTick` in `src/simulation/battle.ts`:

```typescript
export function advanceBattleTick(previous: BattleState, collector?: DecisionCollector): BattleState {
```

**The collector is never stored on `BattleState` or `EncounterState`.** It is passed per call, every call. Anything living in those objects risks being folded into the trace hash, which would defeat the entire point of this design. `createBattle` is unchanged.

- [ ] **Step 6: Run the diagnostics tests**

Run: `npx vitest run src/simulation/decisionDiagnostics.test.ts`
Expected: PASS

- [ ] **Step 7: Verify all three frozen hashes**

Run: `npm test`
Expected: PASS. Confirm specifically that `battle.test.ts`'s `dc635911` and `encounterCapacity.test.ts`'s fixture hash are unchanged. If either moved, revert and re-examine Step 4 — behaviour was altered.

- [ ] **Step 8: Verify the architecture guard still holds**

Run: `npx vitest run src/simulation/architecture.test.ts`
Expected: PASS — `decisionDiagnostics.ts` imports no DOM, no Three.js, and uses no forbidden functions.

- [ ] **Step 9: Commit**

```bash
git add src/simulation/decisionDiagnostics.ts src/simulation/decisionDiagnostics.test.ts src/simulation/encounter.ts src/simulation/battle.ts
git commit -m "feat(sim): report phase-4 decisions through an opt-in collector

Recomputing decisions outside the kernel is impossible -- phase 4 runs on
state left by phases 1 through 3, so an external recompute would duplicate a
third of the tick and drift. Instead phase 4 reports what it already
computed, through a collector that allocates nothing when absent. Four record
shapes, because forced behaviours and skipped decisions are not weighted
rolls. All three frozen hashes verified unchanged, with the collector
attached and without."
```

---

### Task 6: Decision panel

**Files:**
- Create: `src/presentation/DecisionPanel.ts`
- Modify: `src/main.ts`
- Test: `tests/decision-panel.spec.ts` (new), `tests/smoke.spec.ts` (production check)

**Interfaces:**
- Consumes: `DecisionRecord`, `DecisionCollector` from Task 5.
- Produces: nothing later tasks depend on.

- [ ] **Step 1: Write the failing dev e2e test**

Create `tests/decision-panel.spec.ts`, modelling page setup on the existing `tests/smoke.spec.ts`:

```typescript
import { expect, test } from '@playwright/test'

test('shows the decision panel only when asked for', async ({ page }) => {
  await page.goto('/?seed=20260815')
  await expect(page.getByTestId('decision-panel')).toHaveCount(0)

  await page.goto('/?seed=20260815&debugDecisions=1')
  await expect(page.getByTestId('decision-panel')).toBeVisible()
})

test('records decisions once a bout is running, and clears them on rematch', async ({ page }) => {
  await page.goto('/?seed=20260815&debugDecisions=1')
  // Drive the bout through the existing dev test API rather than the UI.
  await page.evaluate(() => {
    const api = (window as never as { __GLADIATOR_TEST__: Record<string, (...args: unknown[]) => unknown> }).__GLADIATOR_TEST__
    api.assign('brutus', 0)
    api.assign('aquila', 1)
    api.assign('nerva', 2)
    api.confirm()
    api.advanceTicks(240)
  })
  const rows = page.getByTestId('decision-panel-row')
  await expect(rows.first()).toBeVisible()
})
```

Read `tests/smoke.spec.ts` first and reuse its exact roster ids and its exact `__GLADIATOR_TEST__` call sequence — the ids above are from the human-review document and must be verified against the real roster before use.

- [ ] **Step 2: Run and confirm it fails**

Run: `npx playwright test tests/decision-panel.spec.ts`
Expected: FAIL — no element with `data-testid="decision-panel"`.

- [ ] **Step 3: Implement the panel**

Create `src/presentation/DecisionPanel.ts`. It owns a bounded ring of recent records and renders them into a DOM node; it holds no game rules.

```typescript
// Dev-only decision inspector. Renders what the kernel's phase-4 collector
// reported. Contains no combat rules and never feeds anything back into the
// simulation.

import type { DecisionRecord } from '../simulation/decisionDiagnostics'

/** Bounded so a long bout cannot grow the DOM without limit. */
const MAX_ROWS = 200

function describeOutcome(outcome: { type: 'locomotion'; locomotionIntent: string } | { type: 'action'; actionId: string }): string {
  return outcome.type === 'locomotion' ? outcome.locomotionIntent : outcome.actionId
}

function describeRecord(entry: DecisionRecord): string {
  switch (entry.kind) {
    case 'weighted': {
      const total = entry.candidates.reduce((sum, candidate) => sum + candidate.weight, 0)
      const parts = entry.candidates
        .map((candidate) => `${describeOutcome(candidate.decision)} ${total > 0 ? Math.round((candidate.weight / total) * 100) : 0}%`)
        .join(', ')
      return `t${entry.tick} ${entry.combatantId}: roll ${entry.roll.toFixed(3)} -> ${describeOutcome(entry.chosen)} [${parts}]`
    }
    case 'fallback':
      return `t${entry.tick} ${entry.combatantId}: no candidates -> fallback ${describeOutcome(entry.chosen)}`
    case 'forced':
      return `t${entry.tick} ${entry.combatantId}: forced ${entry.behaviour} (no roll)`
    case 'skipped':
      return `t${entry.tick} ${entry.combatantId}: skipped (${entry.reason})`
  }
}

export class DecisionPanel {
  private readonly root: HTMLElement
  private readonly list: HTMLElement
  private records: DecisionRecord[] = []

  constructor(parent: HTMLElement) {
    this.root = document.createElement('section')
    this.root.dataset.testid = 'decision-panel'
    this.root.className = 'decision-panel'
    const heading = document.createElement('h2')
    heading.textContent = 'Decision trace'
    this.list = document.createElement('ol')
    this.root.append(heading, this.list)
    parent.append(this.root)
  }

  record(entry: DecisionRecord): void {
    this.records.push(entry)
    if (this.records.length > MAX_ROWS) this.records = this.records.slice(-MAX_ROWS)
  }

  /** Called at each new bout and on rematch: the trace describes one bout, not a session. */
  clear(): void {
    this.records = []
    this.list.replaceChildren()
  }

  render(): void {
    const rows = this.records.map((entry) => {
      const row = document.createElement('li')
      row.dataset.testid = 'decision-panel-row'
      row.textContent = describeRecord(entry)
      return row
    })
    this.list.replaceChildren(...rows)
  }
}
```

- [ ] **Step 4: Wire it in `main.ts`, dev only**

Follow exactly how `?audioDebug=1` is read and gated in `main.ts`. The panel is constructed only when both `import.meta.env.DEV` and the `debugDecisions` parameter are true; the collector is passed to `advanceBattleTick` on every tick; `render()` runs once per frame after the tick loop; `clear()` is called wherever the code already resets presentation for a new bout and for rematch.

- [ ] **Step 5: Run the dev e2e test**

Run: `npx playwright test tests/decision-panel.spec.ts`
Expected: PASS

- [ ] **Step 6: Add the production-absence check**

In `tests/smoke.spec.ts`, find the existing production-preview test that asserts `?audioDebug=1` shows nothing and `window.__GLADIATOR_TEST__` is absent, and extend it:

```typescript
  await page.goto('/?debugDecisions=1')
  await expect(page.getByTestId('decision-panel')).toHaveCount(0)
```

- [ ] **Step 7: Verify the module is statically absent from the bundle**

```bash
npm run build
grep -r "decision-panel" dist/ || echo "absent from production bundle"
```

Expected: `absent from production bundle`. If it appears, the gating is not static — the panel must be behind `import.meta.env.DEV` in a form the bundler can eliminate, matching how the existing debug surfaces do it.

- [ ] **Step 8: Run the full check sequence**

Run: `npm run check`
Expected: PASS (unit, build, e2e).

- [ ] **Step 9: Commit**

```bash
git add src/presentation/DecisionPanel.ts src/main.ts tests/decision-panel.spec.ts tests/smoke.spec.ts
git commit -m "feat(dev): add a decision trace panel behind ?debugDecisions=1

Renders the phase-4 collector's four record shapes -- weighted selections
with candidate percentages and the roll, deterministic fallbacks, forced
behaviours, and skipped decisions. Dev-only and statically absent from
production, like the existing debug surfaces; cleared at each new bout and
on rematch."
```

---

### Task 7: Motion verification

Static screenshots cannot catch this slice's defects: a camera flip, a stepped idle and damping lag are all motion artefacts. This task is developer verification, **not** the two-reviewer human gate, which remains out of scope.

**Files:**
- No source changes expected. If this task finds a defect, fix it in the task that owns it and re-run that task's checks.

**Interfaces:**
- Consumes: everything from Tasks 1-6.
- Produces: a recorded confirmation that the three reported defects are gone.

- [ ] **Step 1: Record the clips**

Run: `npm run review:clips`
Expected: clips and traces written under `docs/reviews/clips/` (gitignored).

- [ ] **Step 2: Watch for the camera defect specifically**

Watch the `technical vs technical` clip, which spends 69% of its bout beyond the old clamp and 52% beyond 60°, and the `fast vs heavy` clip (58.6% / 36.1%). Confirm: the fighters read as facing each other throughout; the camera never swings to the far side of the arena; there is no visible snap as the pair rotates through the frame vertical.

- [ ] **Step 3: Watch for the idle and start-stop reading**

Watch a `heavy vs heavy` clip, where fighters are in motion for only about a third of ticks. Confirm standing fighters look alive rather than frozen, and that the idle is smooth rather than stepping at 60 Hz.

- [ ] **Step 4: Check reduced motion**

With the OS or browser set to `prefers-reduced-motion: reduce`, run `npm run dev` and watch one bout. Confirm the idle is completely still and that anticipation, contact and result are all still readable.

- [ ] **Step 5: Sanity-check the panel against a real bout**

Run `npm run dev` with `?seed=20260815&debugDecisions=1`, watch one bout, and confirm the trace explains what you saw: forced disengages appear as `forced`, and a committed attack's weighted record lists the candidates that were live at that moment.

- [ ] **Step 6: Record the outcome**

Append a short section to `docs/reviews/2026-08-16-readable-deep-combat-human-review.md` under a new heading `## 2026-08-19 legibility slice — developer verification`, stating what was watched and what was observed. Do **not** fill in any cell of the two-reviewer gate table: that gate is unchanged and still not run.

- [ ] **Step 7: Commit**

```bash
git add docs/reviews/2026-08-16-readable-deep-combat-human-review.md
git commit -m "docs(review): record developer verification of the legibility slice

Motion artefacts that screenshots cannot catch, checked on recorded clips:
camera continuity through the frame vertical, idle smoothness, reduced
motion, and the decision trace against a real bout. The two-reviewer human
gate is untouched and still not run."
```

---

## Self-Review

**Spec coverage.** Camera continuity and clamp → Task 1. Rig directionality (visor, chest/back, foot) → Task 2. Idle layer with all five bounding rules → Task 3. Baseline regeneration on both OSes → Task 4. Diagnostic seam with four record shapes and three-hash proof → Task 5. Panel, production absence, clear-on-rematch → Task 6. Motion verification and clips → Task 7. The spec's "on-screen framing error" acceptance criterion is covered by Task 1 Step 12 (whole-bout continuity) plus Task 7 Step 2 (watched on clips); a per-tick numeric on-screen-error metric is deliberately not automated, because the threshold that would make it meaningful is exactly what Task 7 exists to establish by eye.

**Placeholders.** None. Three steps direct the implementer to read surrounding code before inserting (Task 2 Steps 10 and 14, Task 3 Step 3) rather than guessing bindings; each states exactly what to match and why, and gives the full code to adapt.

**Type consistency.** `DecisionRecord`/`DecisionCollector` are defined in Task 5 and consumed under the same names in Task 6. `DecisionOutcome` mirrors `CombatDecision`'s shape from `combatDecision.ts` deliberately, so the panel does not import simulation internals. `sampleIdleLayer`/`computeIdlePhase`/`idleAmplitude` are defined in Task 3 Step 3 and used with matching signatures in Step 7. `addBoxSegment`'s new trailing parameter is defaulted, so Task 2's other call sites are untouched.

**Known risk flagged for the implementer.** Task 5 Step 4 adds a `scoreCombatCandidates` call that phase 4 did not previously make. It is pure and draws no randomness, so behaviour is unchanged — but the task explicitly instructs verifying this by reading the function first, and the three-hash check in Step 7 is what proves it. If any hash moves, that approach is invalid and the task stops rather than adjusting the literal.
