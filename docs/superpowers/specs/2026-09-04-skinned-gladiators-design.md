# Skinned gladiators — Design

**Status:** approved in conversation, 2026-09-04. First slice of the "imported models"
roadmap item (README, «Дальнейший roadmap» #4).

**Decisions already taken by the design owner:**

- Source models come from a free CC0 rigged pack, not hand-modelled and not Mixamo.
- The pack's own animation clips replace the procedural `PoseController`. The old
  poses were authored against the procedural rig's joint axes and would bend a
  Blender armature the wrong way; the pack already ships every movement the
  bout needs.
- One clip is authored in Blender inside this slice, as proof that the
  Blender → game path works end to end.

---

## 1. Goal and non-goals

**Goal.** The three gladiator types are rendered as skinned, textured low-poly
characters driven by animation clips, and a developer can add a new clip by
editing the Blender build script (or a `.blend`) and rebuilding one `.glb`.

**Non-goals for this slice:**

- New combat behaviour. The simulation is not touched; every determinism test
  in `src/simulation/` must stay green without edits.
- Cross-fading between clips, additive layers, or IK. One clip plays at a time.
- Facial expressions, cloth, blood, or any effect beyond what already exists
  (weapon trail, contact flash).
- Mobile performance budgets.

## 2. Assets and the Blender pipeline

### 2.1 Source pack

**KayKit Character Pack: Adventurers 1.0**, CC0 1.0, from
`https://github.com/KayKit-Game-Assets/KayKit-Character-Pack-Adventures-1.0`.
Vendored into the repo as `assets/kaykit/{Knight,Barbarian,Rogue}.glb` plus the
pack's `LICENSE.txt` (about 11 MB total). Vendoring keeps the build reproducible
offline; the files are CC0 so there is no licensing cost.

Measured facts the design relies on (Knight.glb, Blender glTF I/O 1.7.33):

- One armature per character, identical skeleton across all three: `root` →
  `hips` → `spine` → `chest` → {`upperarm.l/r` → `lowerarm` → `wrist` → `hand` →
  `handslot`, `head`}; `hips` → `upperleg.l/r` → `lowerleg` → `foot` → `toes`;
  plus IK helper bones (`kneeIK`, `handIK`, foot-roll controls) that are part of
  the skin and carry baked animation.
- Six skinned body meshes per character, one 1024² atlas texture embedded.
- Weapons and shields are plain meshes parented under `handslot.l` /
  `handslot.r`.
- 76 clips, identical set on all three characters. Durations of the ones used:
  `Idle` 1.067 s, `Walking_A` 1.067 s, `1H_Melee_Attack_Chop` 1.067 s,
  `1H_Melee_Attack_Slice_Horizontal` 1.067 s, `1H_Melee_Attack_Stab` 1.6 s,
  `2H_Melee_Attack_Chop` 1.633 s, `2H_Melee_Attack_Stab` 1.6 s, `Block` 1.067 s,
  `Block_Attack` 1.067 s, `Dodge_Backward` 0.4 s, `Hit_A` 0.667 s,
  `Death_A` 0.8 s.
- Mesh height about 2.0 world units; the procedural rig was 1.7–1.9.

### 2.2 Build script

`tools/blender/build_gladiators.py`, run by `npm run models:build` as
`blender --background --python tools/blender/build_gladiators.py`. Blender 5.2 is
the tested version. The script is the single source of truth for the shipped
models; nobody edits `public/models/*.glb` by hand.

For each archetype it:

1. Imports the source character.
2. Deletes weapon and shield meshes the archetype does not use, and the cape.
3. Builds the props the pack lacks from primitives and parents them to the
   hand slots: a **trident** (shaft + three prongs) and a **net** (flat disc
   with a rim) for the retiarius; a **spear** (shaft + leaf tip) for the
   hoplomachus. The murmillo uses the pack's `Rectangle_Shield` and `1H_Sword`.
   The hoplomachus uses the pack's `Round_Shield`.
4. Adds three empties parented to bones: `weaponTip` (end of the weapon, child
   of `handslot.r`), `shieldCenter` (child of `handslot.l`, at the shield's
   face; for the retiarius, at the net), `hitCenter` (child of `spine`, at chest
   height). `handslot.r` and `handslot.l` themselves serve as `weaponHand` and
   `offHand`.
5. Tags every mesh with a custom property `slot` (exported as
   `extras.slot`) — `body` for the skinned parts, `helmet`, `shield`, `weapon`,
   `net`. `ArenaView` reads `userData.slot` exactly as it does today.
6. Keeps only the clips in §4's table plus `Idle`, `Walking_A`, `Hit_A`,
   `Death_A`, deleting the rest so the shipped file is small.
7. Authors the custom clip `Spear_Drive` (hoplomachus only) as keyframes on
   `hips`, `chest`, `upperarm.r`, `lowerarm.r`, `upperleg.l/r`: a lunge with the
   spear driven forward, about 1.2 s, strike at 50 %.
8. Scales the armature so the standing height is 1.8 world units, applies the
   transform, and exports `public/models/<archetype>.glb` with all actions as
   NLA tracks so the exporter writes them as glTF animations.

Archetype mapping:

| archetype   | character | right hand           | left hand          | extra     |
|-------------|-----------|----------------------|--------------------|-----------|
| `heavy`     | Knight    | `1H_Sword`           | `Rectangle_Shield` | helmet    |
| `fast`      | Barbarian | trident (built)      | net (built)        | —         |
| `technical` | Rogue     | spear (built)        | `Round_Shield`     | —         |

The three characters already differ in build and texture, which is what the
2026-08-23 legibility playtest asked for; house colours stay in the HUD.

**Amendment, 2026-09-05 (Task 7b): the standing height in step 8 is 2.0 world
units, not 1.8.** With 1.8 the slow legibility harness measured the on-screen
body height at the 92nd percentile of in-band ticks, 1280x820, at **117.0–124.4
px against the pre-committed 130 px floor, failing in eight of the nine
pairings** (worst: 08 nerva vs cassius, 117.04 px). §7 and §9 named the two
available fixes as the armature scale or the camera's `FLAT_DISTANCE`, and the
armature scale was chosen — `FLAT_DISTANCE` and `EASE_WIDTH_EXTENT` are swept
constants and stay put. At 2.0 the same harness measures p92 **146.05–164.72
px**, clearing the floor in all nine pairings by 12.4–26.7 %. The rise is more
than the 11 % of height because the camera is elevated: a taller man's head sits
markedly closer to it than his feet, so projected body height grows faster than
the model. Every archetype's `horizontalEquipmentRadius` scales by 10/9 with the
rig, so `ArenaCamera.ts`'s measured `WIDEST_EQUIPMENT_RADIUS` (and the band edge
derived from it) moved in the same commit. The retiarius' net disc was also cut
from 0.42 to 0.30 source units, for the safe-area reason recorded in the task-7b
report.

**Safe-area ruling of the same date (design owner, on the Task 7b report).**
Standing the models at 2.0 put two pairings outside the 5 % canvas inset at
1024x768 — the one viewport whose canvas (542x518) is narrow rather than wide,
and therefore the only one where horizontal fit is ever decided. Both were
diagnosed by a controlled rebuild (the same trace replayed against a build
differing only in the net disc's radius, 0.30 → 0.05 source units), and they
have different causes and different answers:

1. **Pairing 04 (retiarius vs retiarius) was the net**, and cutting the disc
   removed every violation. The net is exempted instead of shrunk further: the
   amended rule now reads "long **or thrown** handheld props — the spear shaft,
   the trident, and the retiarius' net — may leave frame", since the net is held
   at arm's length and thrown exactly like the trident it is paired with, and
   the size that would have kept it inside (source radius ≤ 0.205, a disc about
   half the buckler) no longer reads as a net. `ArenaView`'s debug snapshot
   gained `boundsPxWithoutExemptProps` so the harness can assert on it;
   `boundsPxWithoutWeapon` is unchanged and still means "body + helmet +
   shield".
2. **Pairing 05 (retiarius vs hoplomachus) is the fighter's own body** — with
   the net reduced to a token disc, `home.aquila`'s `minX` is bit-identical, so
   the 59.8 px of box left of his root is arm and torso. It is recorded as a
   **named deviation** (`KNOWN_SAFE_AREA_DEVIATIONS` in
   `tests/legibility.spec.ts`), not as a loosened rule: 9 violating ticks of
   2088, worst overshoot −13.49 px, bounded in the harness at 12 ticks and 18 px
   so it can neither deepen nor spread unnoticed, while every other
   pairing/viewport is still asserted at exactly zero. It pre-dates the 2.0 rig
   (the 1.8 build measured 1 tick, −0.66 px, at the same tick and edge) and no
   standing height removes it: **the safe area needs ≤ 1.79 units and the 130 px
   floor needs ≥ 1.89**, so the two criteria cannot both be met and the floor
   wins.

The documented way to retire the deviation, deliberately left to a later slice
because it is measurement work rather than an edit: re-sweep `FLAT_DISTANCE`
against a fresh recording of the 2.0 rig (the existing 46,647-tick recording is
of the procedural rig and is not a valid input). **≈9.30** is the distance that
pulls the body inside the inset, and on the linear estimate it still leaves the
binding pairing near 138 px of body height.

### 2.3 The glTF contract

A unit test (`src/presentation/fighterModelContract.test.ts`) reads each shipped
`.glb`'s JSON chunk with `node:fs`, no three.js, no WebGL, and asserts:

- the node names in `FIGHTER_BONE_NAMES` and `FIGHTER_ANCHOR_NAMES` exist;
- every clip name in `CLIP_TABLE` for that archetype exists;
- every mesh node carries an `extras.slot` from the known set;
- the file is under 2 MB (the source is 3.6 MB with 76 clips; the trimmed
  clip set is what makes the difference).

This is the check that a rebuilt model still satisfies the code that loads it.

## 3. Runtime: `SkinnedFighter`

`src/presentation/SkinnedFighter.ts` replaces `ProceduralFighter.ts`.

```ts
export type FighterBoneName = 'root' | 'hips' | 'spine' | 'chest' | 'head'
  | 'upperarm.l' | 'lowerarm.l' | 'hand.l' | 'handslot.l'
  | 'upperarm.r' | 'lowerarm.r' | 'hand.r' | 'handslot.r'
  | 'upperleg.l' | 'lowerleg.l' | 'foot.l' | 'upperleg.r' | 'lowerleg.r' | 'foot.r'
export type EquipmentAnchorName = 'weaponHand' | 'offHand' | 'weaponTip' | 'shieldCenter' | 'hitCenter'

export interface FighterModelSet { /* one parsed GLTF per archetype */ }
export function loadFighterModels(loader = new GLTFLoader()): Promise<FighterModelSet>

export interface SkinnedFighter {
  root: THREE.Group                        // world placement only, same rule as before
  bones: ReadonlyMap<FighterBoneName, THREE.Bone>
  anchors: ReadonlyMap<EquipmentAnchorName, THREE.Object3D>
  clips: ReadonlyMap<string, THREE.AnimationClip>
  horizontalEquipmentRadius: number        // Box3 of the rest pose, as today
  dispose(): void
  isDisposed(): boolean
}
export function createSkinnedFighter(models: FighterModelSet, archetype: Archetype): SkinnedFighter
```

- `createSkinnedFighter` clones the parsed scene with `SkeletonUtils.clone`
  (skinned meshes need their own skeleton per instance), wraps it in a fresh
  `root` group, indexes bones and anchors by name, and measures the framing
  radius off the rest pose the same way `computeHorizontalEquipmentRadius`
  does today. Materials and geometries are shared between instances; `dispose`
  only detaches the clone.
- Files are fetched from `/models/<archetype>.glb` (Vite `public/`).

**Loading is asynchronous.** `main.ts` awaits `loadFighterModels()` before
constructing `ArenaView`, before starting the frame loop, and before publishing
`window.__GLADIATOR_TEST__`. Every existing test waits for the test API, so
nothing in the suite observes a half-loaded arena. If loading rejects, `main.ts`
takes the same path as "WebGL unavailable at startup": the readable fallback is
shown and the season still runs. The three files total about 2–3 MB; a loading
line in the fallback element covers the wait.

## 4. Animation: `clipMapping` and `FighterAnimator`

### 4.1 `clipMapping.ts` — pure

```ts
export interface ClipSelection { clip: string; time: number; weaponTrailActive: boolean }
export interface ClipMappingInput {
  archetype: Archetype
  state: Readonly<FighterCombatState>
  tick: number            // current simulation tick
  alpha: number           // render interpolation 0..1
  staggerStartTick?: number
  defeatedAtTick?: number
  durations: ReadonlyMap<string, number>   // clip durations from the loaded file
}
export function selectClip(input: ClipMappingInput): ClipSelection
```

`t = tick + alpha` is the only clock. `TICKS_PER_SECOND` (movement.ts, 60) turns
ticks into seconds. Rules, first match wins:

1. `state.status === 'defeated'` → `Death_A`, `time = min((t − defeatedAtTick)/60, D)`;
   the last frame holds.
2. `state.staggerUntilTick > tick` → `Hit_A`, `time = min((t − staggerStartTick)/60, D)`.
3. `state.action.type === 'active'` and the id is an attack → the clip from the
   table below. Phase progress `p = (t − phaseStartedTick) / (phaseEndsAtTick − phaseStartedTick)`,
   clamped to 0..1. With `c = contactAt` and `h = min(c + 0.15, 0.95)`:
   `windup` → `time = p · c · D`; `contact`/`impact` → `time = (c + p · (h − c)) · D`;
   `recovery` → `time = (h + p · (1 − h)) · D`. The clip's strike frame therefore
   lands on the simulation's contact tick whatever the action's tick counts are.
   `weaponTrailActive` is true for `windup` with `p ≥ 0.6` and for
   `contact`/`impact`, the same rule `PoseController` used.
4. The id is a defense → its clip; `impact` → `time = p · 0.6 · D`,
   `recovery` → `time = (0.6 + p · 0.4) · D`.
5. `|state.velocity| > 0.01` → `Walking_A`, `time = gaitPhase · D` where
   `gaitPhase = computeGaitPhase(travelledDistance, archetype)` from `gait.ts`.
   Footstep audio keeps its existing `classifyPlantedFoot` math untouched.
6. Otherwise `Idle`, `time = (t / 60) mod D`.

| action id                   | clip                               | contactAt |
|-----------------------------|------------------------------------|-----------|
| `heavy-shield-jab`          | `Block_Attack`                     | 0.45      |
| `heavy-cleave`              | `1H_Melee_Attack_Chop`             | 0.50      |
| `fast-slash`                | `2H_Melee_Attack_Chop`             | 0.45      |
| `fast-burst-lunge`          | `2H_Melee_Attack_Stab`             | 0.50      |
| `technical-thrust`          | `1H_Melee_Attack_Stab`             | 0.50      |
| `technical-driving-thrust`  | `Spear_Drive` (custom)             | 0.50      |
| `technical-parry-counter`   | `1H_Melee_Attack_Slice_Horizontal` | 0.45      |
| `heavy-guard`               | `Block`                            | —         |
| `fast-evade`                | `Dodge_Backward`                   | —         |
| `technical-parry`           | `Block_Attack`                     | —         |

`contactAt` values are authored guesses to be tuned by eye during
implementation; they live in one table and nowhere else.

`STYLE_GAIT_CYCLE_DISTANCE` moves from `poses/combatPoses.ts` into `gait.ts`,
which itself moves up to `src/presentation/gait.ts`; nothing else in `poses/`
survives.

### 4.2 `FighterAnimator`

One per rig. Holds an `AnimationMixer` on the fighter's root and one
`AnimationAction` per clip, all created up front with `clampWhenFinished`.
`apply(selection)` stops every action except the selected one, sets its
`weight = 1`, `time = selection.time`, and calls `mixer.update(0)`. No wall
clock is ever read, so two frames with the same `(tick, alpha)` produce the same
skeleton, which is what `smoke.spec.ts`'s "replays no new effects when the same
tick pair is re-rendered" and the arena debug snapshot rely on.

## 5. `ArenaView` and `main.ts` changes

- `FighterRig` becomes `{ fighter: SkinnedFighter, animator: FighterAnimator,
  trail, staggerStartTick?, defeatedAtTick? }`. `processNewEvents` records
  `fighter-staggered` and `fighter-defeated` ticks per rig; both reset with the
  rig on every new bout, as everything else does.
- Per frame: set root position/yaw from interpolated state exactly as now, call
  `selectClip`, `animator.apply`, `updateMatrixWorld`, then the existing trail,
  flash and framing code. `computeContactTarget`, the IK plumbing, the
  `pendingDefenseDeclinedTick` flinch and `applyPoseToJoints` are deleted.
- The debug snapshot iterates `FIGHTER_BONE_NAMES` for its finite-transform
  check; `BODY_SILHOUETTE_SLOTS` becomes `{'body', 'helmet'}` and the long
  weapon slot stays `'weapon'`, so `legibility.spec.ts` keeps measuring body
  height without the spear and trident.
- `main.ts`: `await loadFighterModels()` then construct `ArenaView(canvas, models)`.
  The constructor signature grows by the model set; nothing else in `main.ts`
  changes.

## 6. What is deleted, and what is lost on purpose

Deleted: `ProceduralFighter.ts` (+test), `PoseController.ts` (+test),
`poses/combatPoses.ts` (+test), `poses/idle.ts` (+test), `poses/gait.ts`
(moved). The visual sections of README that describe the procedural rig are
rewritten in one paragraph.

Lost, knowingly:

- The recognition flinch on `defense-declined`. The pack has no such clip; a
  future Blender-authored one can restore it through the same table.
- Weapon-arm IK toward the contact point. The clips' own reach replaces it.
- The per-style guard/stagger/defeat poses. Replaced by shared pack clips; the
  three characters still read as three types through build, kit and texture.

## 7. Tests and baselines

- **Unit (fast):** `clipMapping.test.ts` (every rule above, with hand-built
  states; the strike-frame alignment property for each attack), the glTF
  contract test (§2.3), `gait.test.ts` (moved). `ArenaCamera.test.ts` keeps its
  smoothness assertions; the three recorded traces in
  `frozenFixtures/cameraTraces.ts` will move because the framing radii change,
  and are re-recorded once from a probe run with the reason stated in the
  commit. The `slowSuites.test.ts` filesystem guard needs no change.
- **e2e (fast):** existing specs run unchanged except for wording that names
  `ProceduralFighter`. The five arena screenshots (`heavy-cleave`, `fast-burst`,
  `technical-parry`, `combat-outcomes`, `combat-safe-frame`) are re-captured on
  win32 locally and on Linux via the `update baselines` workflow, and every
  regenerated PNG is looked at before it is committed. DOM-only screenshots must
  not move.
- **e2e (slow):** `legibility.spec.ts` keeps its 130 px body-height bar. If the
  new models fail it, the fix is the armature scale or the camera's
  `FLAT_DISTANCE`, reported with the measurement, not a lowered bar.
- **Manual:** one screenshot of a live bout per archetype pairing attached to
  the PR, and a paragraph on whether the strike frames read as landing on
  contact.

## 8. Determinism

The simulation is untouched. Presentation stays a pure function of
`(previousTick state, currentTick state, alpha)`: clip choice and clip time are
derived from ticks, phase boundaries and travelled distance; the mixer is
advanced by `update(0)` after an explicit `time` set; no `Date.now()` or
`performance.now()` enters the animation path. The existing "same tick pair,
different alpha, no new effects" and "re-render at alpha=1 reproduces the
snapshot" e2e tests are the regression guards.

## 9. Risks

- **Blender round-trip of animations.** Importing a glTF and re-exporting can
  drop actions unless each is pushed to an NLA track. The build script does
  that explicitly, and the contract test catches a missing clip.
- **Skinned-mesh bounds.** `Box3.setFromObject` on a `SkinnedMesh` uses the
  bind-pose geometry bounds; that is exactly the rest pose we want for the
  framing radius, but the number will differ from the procedural rig's, hence
  the camera-trace re-record.
- **Legibility bar.** The pack's proportions (large head, short legs) may put
  body height under the 130 px bar at the current camera distance. Handled per
  §7, not by editing the harness.
- **Clip fit.** Some pack clips hold a weapon in a way the built props do not
  match (e.g. the net hand). Acceptable for this slice; the fix is a
  Blender-authored clip, which is what the pipeline is for.
