# Skinned Gladiators Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the procedural box-and-capsule gladiators with skinned KayKit characters driven by the pack's animation clips, built into `.glb` files by a Blender script.

**Architecture:** A Blender build script turns three vendored CC0 characters into `public/models/<archetype>.glb` (trimmed clips, custom props, anchor empties, one custom clip). At runtime `SkinnedFighter` loads and clones them, `clipMapping` picks a clip and a clip time from simulation state, `FighterAnimator` applies it through an `AnimationMixer` with `update(0)` so nothing depends on wall-clock time. `ArenaView` swaps its rig type; `ProceduralFighter`, `PoseController` and `poses/` are deleted.

**Tech Stack:** three r179 (`GLTFLoader`, `SkeletonUtils`, `AnimationMixer`), Vite 7, Vitest 3, Playwright, Blender 5.2 headless Python.

Spec: `docs/superpowers/specs/2026-09-04-skinned-gladiators-design.md`.

## Global Constraints

- `src/simulation/**` is not modified. Every existing simulation test stays green without edits.
- No `Date.now()` / `performance.now()` in the animation path. Clip time derives from `tick + alpha`, phase boundaries and `travelledDistance`.
- Blender version: 5.2. Run it as `"C:/Program Files/Blender Foundation/Blender 5.2/blender.exe"` (Git Bash path: `/c/Program Files/Blender Foundation/Blender 5.2/blender.exe`).
- Tooling: call binaries directly, not through `npx` (`node node_modules/vitest/vitest.mjs run --project fast`, `node node_modules/typescript/bin/tsc -p tsconfig.json`, `node node_modules/@playwright/test/cli.js test --project fast`).
- Commit messages: Conventional Commits, no `Co-Authored-By`.
- Shipped model files must be under 2 MB each and must satisfy the contract test.
- The `legibility.spec.ts` 130 px bar and the balance bands are never lowered.

## File structure

| Path | Responsibility |
|---|---|
| `assets/kaykit/{Knight,Barbarian,Rogue}.glb`, `assets/kaykit/LICENSE.txt` | Vendored CC0 source pack. Never edited. |
| `tools/blender/build_gladiators.py` | Blender headless build: source → `public/models/*.glb`. |
| `public/models/{heavy,fast,technical}.glb` | Shipped models, committed, produced only by the script. |
| `src/presentation/fighterModelContract.ts` | Names the runtime relies on: bones, anchors, slots, clip table. Imported by the contract test, `SkinnedFighter`, `clipMapping`. |
| `src/presentation/fighterModelContract.test.ts` | Reads the shipped `.glb` JSON with `node:fs` and asserts the contract. |
| `src/presentation/gait.ts` (+test) | Moved from `poses/gait.ts`; now also owns `STYLE_GAIT_CYCLE_DISTANCE`. |
| `src/presentation/clipMapping.ts` (+test) | Pure: simulation state → `{ clip, time, weaponTrailActive }`. |
| `src/presentation/SkinnedFighter.ts` | `loadFighterModels`, `createSkinnedFighter`. |
| `src/presentation/FighterAnimator.ts` (+test) | `AnimationMixer` wrapper with explicit `time`, `update(0)`. |
| `src/presentation/ArenaView.ts` | Uses `SkinnedFighter` + `FighterAnimator`; drops IK, flinch, pose application. |
| `src/main.ts` | Awaits `loadFighterModels()` before building `ArenaView`. |

---

### Task 1: Vendor the pack and write the model contract test (red)

**Files:**
- Create: `assets/kaykit/Knight.glb`, `assets/kaykit/Barbarian.glb`, `assets/kaykit/Rogue.glb`, `assets/kaykit/LICENSE.txt`, `assets/kaykit/README.md`
- Create: `src/presentation/fighterModelContract.ts`
- Test: `src/presentation/fighterModelContract.test.ts`

**Interfaces:**
- Produces: `FIGHTER_BONE_NAMES: readonly FighterBoneName[]`, `FIGHTER_ANCHOR_NAMES: readonly EquipmentAnchorName[]`, `ANCHOR_NODE_NAMES: Record<EquipmentAnchorName, string>`, `MESH_SLOTS: ReadonlySet<string>`, `MODEL_FILES: Record<Archetype, string>`, `ATTACK_CLIPS: Record<AttackActionId, { clip: string; contactAt: number }>`, `DEFENSE_CLIPS: Record<DefenseActionId, string>`, `BASE_CLIPS = { idle: 'Idle', walk: 'Walking_A', hit: 'Hit_A', death: 'Death_A' }`, `requiredClipsFor(archetype): string[]`.

- [ ] **Step 1: Vendor the source files**

```bash
mkdir -p assets/kaykit
BASE=https://raw.githubusercontent.com/KayKit-Game-Assets/KayKit-Character-Pack-Adventures-1.0/HEAD
for c in Knight Barbarian Rogue; do
  curl -sL "$BASE/addons/kaykit_character_pack_adventures/Characters/gltf/$c.glb" -o assets/kaykit/$c.glb
done
curl -sL "$BASE/LICENSE.txt" -o assets/kaykit/LICENSE.txt
ls -la assets/kaykit
```

Expected: three files of about 3.6 MB each and a LICENSE.txt that says CC0 1.0 Universal.

Write `assets/kaykit/README.md`:

```markdown
# KayKit Character Pack: Adventurers 1.0 (source)

CC0 1.0 — https://github.com/KayKit-Game-Assets/KayKit-Character-Pack-Adventures-1.0

These are the untouched source characters. The shipped models in
`public/models/` are built from them by `tools/blender/build_gladiators.py`
(`npm run models:build`). Never edit either set by hand.
```

- [ ] **Step 2: Write the contract module**

`src/presentation/fighterModelContract.ts`:

```ts
// The names the runtime relies on inside the shipped .glb files. Everything
// here is checked against the files by `fighterModelContract.test.ts`, so a
// rebuilt model that no longer satisfies the code fails in the fast suite.

import type { AttackActionId, DefenseActionId } from '../simulation/combatActions'
import type { Archetype } from '../simulation/fighters'

export type FighterBoneName =
  | 'root' | 'hips' | 'spine' | 'chest' | 'head'
  | 'upperarm.l' | 'lowerarm.l' | 'hand.l' | 'handslot.l'
  | 'upperarm.r' | 'lowerarm.r' | 'hand.r' | 'handslot.r'
  | 'upperleg.l' | 'lowerleg.l' | 'foot.l'
  | 'upperleg.r' | 'lowerleg.r' | 'foot.r'

export const FIGHTER_BONE_NAMES: readonly FighterBoneName[] = [
  'root', 'hips', 'spine', 'chest', 'head',
  'upperarm.l', 'lowerarm.l', 'hand.l', 'handslot.l',
  'upperarm.r', 'lowerarm.r', 'hand.r', 'handslot.r',
  'upperleg.l', 'lowerleg.l', 'foot.l',
  'upperleg.r', 'lowerleg.r', 'foot.r',
]

export type EquipmentAnchorName = 'weaponHand' | 'offHand' | 'weaponTip' | 'shieldCenter' | 'hitCenter'

/** Anchor -> node name inside the .glb. `weaponHand`/`offHand` are the pack's own hand-slot bones; the other three are empties the build script adds. */
export const ANCHOR_NODE_NAMES: Readonly<Record<EquipmentAnchorName, string>> = {
  weaponHand: 'handslot.r',
  offHand: 'handslot.l',
  weaponTip: 'weaponTip',
  shieldCenter: 'shieldCenter',
  hitCenter: 'hitCenter',
}
export const FIGHTER_ANCHOR_NAMES: readonly EquipmentAnchorName[] = ['weaponHand', 'offHand', 'weaponTip', 'shieldCenter', 'hitCenter']

/** `extras.slot` values the build script writes on every mesh node. */
export const MESH_SLOTS: ReadonlySet<string> = new Set(['body', 'helmet', 'weapon', 'shield', 'net'])

export const MODEL_FILES: Readonly<Record<Archetype, string>> = {
  heavy: 'models/heavy.glb',
  fast: 'models/fast.glb',
  technical: 'models/technical.glb',
}

export interface AttackClip { clip: string; contactAt: number }

export const ATTACK_CLIPS: Readonly<Record<AttackActionId, AttackClip>> = {
  'heavy-shield-jab': { clip: 'Block_Attack', contactAt: 0.45 },
  'heavy-cleave': { clip: '1H_Melee_Attack_Chop', contactAt: 0.5 },
  'fast-slash': { clip: '2H_Melee_Attack_Chop', contactAt: 0.45 },
  'fast-burst-lunge': { clip: '2H_Melee_Attack_Stab', contactAt: 0.5 },
  'technical-thrust': { clip: '1H_Melee_Attack_Stab', contactAt: 0.5 },
  'technical-driving-thrust': { clip: 'Spear_Drive', contactAt: 0.5 },
  'technical-parry-counter': { clip: '1H_Melee_Attack_Slice_Horizontal', contactAt: 0.45 },
}

export const DEFENSE_CLIPS: Readonly<Record<DefenseActionId, string>> = {
  'heavy-guard': 'Block',
  'fast-evade': 'Dodge_Backward',
  'technical-parry': 'Block_Attack',
}

export const BASE_CLIPS = { idle: 'Idle', walk: 'Walking_A', hit: 'Hit_A', death: 'Death_A' } as const

const ARCHETYPE_ATTACKS: Readonly<Record<Archetype, readonly AttackActionId[]>> = {
  heavy: ['heavy-shield-jab', 'heavy-cleave'],
  fast: ['fast-slash', 'fast-burst-lunge'],
  technical: ['technical-thrust', 'technical-driving-thrust', 'technical-parry-counter'],
}
const ARCHETYPE_DEFENSE: Readonly<Record<Archetype, DefenseActionId>> = {
  heavy: 'heavy-guard',
  fast: 'fast-evade',
  technical: 'technical-parry',
}

/** Every clip name the runtime may ask this archetype's file for. */
export function requiredClipsFor(archetype: Archetype): string[] {
  const names = new Set<string>(Object.values(BASE_CLIPS))
  for (const id of ARCHETYPE_ATTACKS[archetype]) names.add(ATTACK_CLIPS[id].clip)
  names.add(DEFENSE_CLIPS[ARCHETYPE_DEFENSE[archetype]])
  return [...names]
}

```

This module is imported by browser code, so it must not import `node:fs`; the GLB reader lives in the test file below.

- [ ] **Step 3: Write the failing contract test**

`src/presentation/fighterModelContract.test.ts`:

```ts
import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import type { Archetype } from '../simulation/fighters'
import {
  ANCHOR_NODE_NAMES,
  FIGHTER_ANCHOR_NAMES,
  FIGHTER_BONE_NAMES,
  MESH_SLOTS,
  MODEL_FILES,
  requiredClipsFor,
} from './fighterModelContract'

const ARCHETYPES: readonly Archetype[] = ['heavy', 'fast', 'technical']
const MAX_BYTES = 2 * 1024 * 1024

interface GlbJson {
  nodes: { name?: string; mesh?: number; children?: number[]; extras?: Record<string, unknown> }[]
  animations?: { name?: string }[]
}

/** Minimal GLB reader: the JSON chunk only, no three.js, no WebGL. */
function readGlbJson(path: string): { json: GlbJson; byteLength: number } {
  const buffer = readFileSync(path)
  if (buffer.readUInt32LE(0) !== 0x46546c67) throw new Error(`${path} is not a GLB (bad magic)`)
  const jsonLength = buffer.readUInt32LE(12)
  const json = JSON.parse(buffer.subarray(20, 20 + jsonLength).toString('utf8')) as GlbJson
  return { json, byteLength: buffer.byteLength }
}

describe.each(ARCHETYPES)('shipped model for %s', (archetype) => {
  const path = resolve(process.cwd(), 'public', MODEL_FILES[archetype])

  it('exists under public/models', () => {
    expect(existsSync(path), `${path} missing -- run npm run models:build`).toBe(true)
  })

  it('carries every bone and anchor the runtime addresses by name', () => {
    const { json } = readGlbJson(path)
    const names = new Set(json.nodes.map((node) => node.name))
    for (const bone of FIGHTER_BONE_NAMES) expect(names, `bone ${bone}`).toContain(bone)
    for (const anchor of FIGHTER_ANCHOR_NAMES) expect(names, `anchor ${anchor}`).toContain(ANCHOR_NODE_NAMES[anchor])
  })

  it('carries every clip the mapping can select for this archetype', () => {
    const { json } = readGlbJson(path)
    const clips = new Set((json.animations ?? []).map((animation) => animation.name))
    for (const clip of requiredClipsFor(archetype)) expect(clips, `clip ${clip}`).toContain(clip)
  })

  it('tags every mesh node with a known silhouette slot', () => {
    const { json } = readGlbJson(path)
    const meshNodes = json.nodes.filter((node) => node.mesh !== undefined)
    expect(meshNodes.length).toBeGreaterThan(0)
    for (const node of meshNodes) {
      const slot = node.extras?.slot
      expect(MESH_SLOTS.has(String(slot)), `${node.name} has slot ${String(slot)}`).toBe(true)
    }
  })

  it('stays under the size budget', () => {
    expect(readGlbJson(path).byteLength).toBeLessThan(MAX_BYTES)
  })
})
```

- [ ] **Step 4: Run the test and watch it fail on the missing files**

Run: `node node_modules/vitest/vitest.mjs run --project fast src/presentation/fighterModelContract.test.ts`
Expected: FAIL, "missing -- run npm run models:build" for all three archetypes.

- [ ] **Step 5: Commit**

```bash
git add assets/kaykit src/presentation/fighterModelContract.ts src/presentation/fighterModelContract.test.ts
git commit -m "feat(models): vendor the KayKit Adventurers pack and pin the model contract"
```

---

### Task 2: Blender build script (turns the contract test green)

**Files:**
- Create: `tools/blender/build_gladiators.py`
- Create: `public/models/heavy.glb`, `public/models/fast.glb`, `public/models/technical.glb` (generated)
- Modify: `package.json` (add `models:build`)

**Interfaces:**
- Consumes: the names in `fighterModelContract.ts` (the script hard-codes the same strings; the contract test is what keeps them equal).
- Produces: the three shipped `.glb` files.

- [ ] **Step 1: Add the npm script**

In `package.json` `"scripts"`, after `"preview"`:

```json
"models:build": "\"C:/Program Files/Blender Foundation/Blender 5.2/blender.exe\" --background --python tools/blender/build_gladiators.py",
```

- [ ] **Step 2: Write the build script**

`tools/blender/build_gladiators.py`:

```python
"""Builds public/models/{heavy,fast,technical}.glb from assets/kaykit/*.glb.

Run:  npm run models:build   (blender --background --python tools/blender/build_gladiators.py)

Contract (checked by src/presentation/fighterModelContract.test.ts):
  bones  root hips spine chest head upperarm.l lowerarm.l hand.l handslot.l
         upperarm.r lowerarm.r hand.r handslot.r upperleg.l lowerleg.l foot.l
         upperleg.r lowerleg.r foot.r            (all from the pack, untouched)
  empties weaponTip (child of handslot.r), shieldCenter (child of handslot.l),
         hitCenter (child of spine)
  extras.slot on every mesh: body | helmet | weapon | shield | net
  clips  the KEEP_CLIPS set below plus Spear_Drive on technical
"""
import math
import os
import sys

import bpy
from mathutils import Matrix, Vector

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
SRC = os.path.join(ROOT, 'assets', 'kaykit')
OUT = os.path.join(ROOT, 'public', 'models')
TARGET_HEIGHT = 1.8

KEEP_CLIPS = {
    'Idle', 'Walking_A', 'Hit_A', 'Death_A',
    'Block', 'Block_Attack', 'Dodge_Backward',
    '1H_Melee_Attack_Chop', '1H_Melee_Attack_Stab', '1H_Melee_Attack_Slice_Horizontal',
    '2H_Melee_Attack_Chop', '2H_Melee_Attack_Stab',
}

# archetype -> (source character, kept pack meshes -> slot, props to build)
BUILDS = {
    'heavy': {
        'source': 'Knight.glb',
        'keep': {'1H_Sword': 'weapon', 'Rectangle_Shield': 'shield', 'Knight_Helmet': 'helmet'},
        'build': [],
    },
    'fast': {
        'source': 'Barbarian.glb',
        'keep': {},
        'build': ['trident', 'net'],
    },
    'technical': {
        'source': 'Rogue.glb',
        'keep': {'Round_Shield': 'shield'},
        'build': ['spear'],
    },
}

# Pack meshes that serve as the placement reference for built props.
WEAPON_REFERENCE = {'Knight.glb': '1H_Sword', 'Barbarian.glb': '1H_Axe', 'Rogue.glb': 'Knife'}
SHIELD_REFERENCE = {'Knight.glb': 'Rectangle_Shield', 'Barbarian.glb': 'Barbarian_Round_Shield', 'Rogue.glb': 'Knife_Offhand'}


def log(*parts):
    print('[build_gladiators]', *parts)


def reset_scene():
    bpy.ops.wm.read_factory_settings(use_empty=True)


def import_source(name):
    bpy.ops.import_scene.gltf(filepath=os.path.join(SRC, name))
    arm = next(o for o in bpy.data.objects if o.type == 'ARMATURE')
    return arm


def mesh_objects(arm):
    return [o for o in bpy.data.objects if o.type == 'MESH' and (o.parent == arm or (o.parent and o.parent.parent == arm))]


def all_mesh_objects():
    return [o for o in bpy.data.objects if o.type == 'MESH']


def is_body_part(obj):
    # The six skinned parts carry an armature modifier; props do not.
    return any(m.type == 'ARMATURE' for m in obj.modifiers)


def delete_object(obj):
    bpy.data.objects.remove(obj, do_unlink=True)


def prune_clips(arm):
    if not arm.animation_data:
        return
    for track in list(arm.animation_data.nla_tracks):
        names = {s.action.name for s in track.strips if s.action}
        if not names & KEEP_CLIPS:
            arm.animation_data.nla_tracks.remove(track)
    for action in list(bpy.data.actions):
        if action.name not in KEEP_CLIPS and action.name != 'Spear_Drive':
            bpy.data.actions.remove(action)


def standing_height(arm):
    lo, hi = math.inf, -math.inf
    for obj in all_mesh_objects():
        if not is_body_part(obj):
            continue
        for corner in obj.bound_box:
            z = (obj.matrix_world @ Vector(corner)).z
            lo, hi = min(lo, z), max(hi, z)
    return hi - lo


def bone_tail_matrix(arm, bone_name):
    pbone = arm.pose.bones[bone_name]
    return arm.matrix_world @ pbone.matrix @ Matrix.Translation((0.0, pbone.length, 0.0))


def parent_to_bone(obj, arm, bone_name):
    """Bone-parent `obj` while keeping its current world transform."""
    world = obj.matrix_world.copy()
    obj.parent = arm
    obj.parent_type = 'BONE'
    obj.parent_bone = bone_name
    obj.matrix_parent_inverse = bone_tail_matrix(arm, bone_name).inverted()
    obj.matrix_world = world


def add_empty(name, arm, bone_name, world_position):
    empty = bpy.data.objects.new(name, None)
    empty.empty_display_size = 0.05
    bpy.context.scene.collection.objects.link(empty)
    empty.matrix_world = Matrix.Translation(world_position)
    parent_to_bone(empty, arm, bone_name)
    return empty


def solid_material(name, rgba):
    mat = bpy.data.materials.new(name)
    mat.use_nodes = True
    bsdf = mat.node_tree.nodes.get('Principled BSDF')
    bsdf.inputs['Base Color'].default_value = rgba
    bsdf.inputs['Roughness'].default_value = 0.8
    return mat


def new_mesh_object(name, mesh_op, material, slot, **kwargs):
    mesh_op(**kwargs)
    obj = bpy.context.active_object
    obj.name = name
    obj.data.materials.append(material)
    obj['slot'] = slot
    return obj


def longest_axis(obj):
    dims = obj.dimensions
    return max(range(3), key=lambda i: dims[i])


def world_extent_along(obj, axis):
    """Min/max world points of `obj` along its own local `axis`."""
    pts = [obj.matrix_world @ Vector(c) for c in obj.bound_box]
    direction = (obj.matrix_world.to_3x3() @ Vector([1 if i == axis else 0 for i in range(3)])).normalized()
    proj = [(p.dot(direction), p) for p in pts]
    return min(proj)[1], max(proj)[1], direction


def build_shaft_weapon(name, reference, arm, length, radius, tip_builder, slot='weapon'):
    """A cylinder shaft along the reference weapon's long axis, plus a tip."""
    axis = longest_axis(reference)
    base, _far, direction = world_extent_along(reference, axis)
    wood = solid_material(f'{name}_wood', (0.45, 0.3, 0.15, 1))
    iron = solid_material(f'{name}_iron', (0.55, 0.55, 0.6, 1))
    shaft = new_mesh_object(name, bpy.ops.mesh.primitive_cylinder_add, wood, slot, radius=radius, depth=length)
    # Cylinder's own axis is local Z: aim it along `direction`, start at `base`.
    rot = Vector((0, 0, 1)).rotation_difference(direction).to_matrix().to_4x4()
    shaft.matrix_world = Matrix.Translation(base + direction * (length / 2)) @ rot
    tip_objs = tip_builder(base + direction * length, direction, iron)
    for t in tip_objs:
        t.parent = shaft
        t.matrix_parent_inverse = shaft.matrix_world.inverted()
        t['slot'] = slot
    parent_to_bone(shaft, arm, reference.parent_bone)
    return shaft, base + direction * length


def trident_tip(tip, direction, iron):
    objs = []
    side = direction.orthogonal().normalized()
    for k in (-1, 0, 1):
        bpy.ops.mesh.primitive_cone_add(radius1=0.025, radius2=0.0, depth=0.28)
        prong = bpy.context.active_object
        prong.name = f'trident_prong_{k + 1}'
        prong.data.materials.append(iron)
        rot = Vector((0, 0, 1)).rotation_difference(direction).to_matrix().to_4x4()
        prong.matrix_world = Matrix.Translation(tip + side * (k * 0.09) + direction * 0.14) @ rot
        objs.append(prong)
    bpy.ops.mesh.primitive_cube_add(size=1)
    bar = bpy.context.active_object
    bar.name = 'trident_bar'
    bar.data.materials.append(iron)
    bar.scale = (0.26, 0.03, 0.03)
    rot = side.rotation_difference(Vector((1, 0, 0))).to_matrix().to_4x4().inverted()
    bar.matrix_world = Matrix.Translation(tip) @ rot @ Matrix.Diagonal((0.26, 0.03, 0.03, 1))
    objs.append(bar)
    return objs


def spear_tip(tip, direction, iron):
    bpy.ops.mesh.primitive_cone_add(radius1=0.045, radius2=0.0, depth=0.3)
    head = bpy.context.active_object
    head.name = 'spear_head'
    head.data.materials.append(iron)
    rot = Vector((0, 0, 1)).rotation_difference(direction).to_matrix().to_4x4()
    head.matrix_world = Matrix.Translation(tip + direction * 0.15) @ rot
    return [head]


def build_net(reference, arm):
    rope = solid_material('net_rope', (0.6, 0.55, 0.4, 1))
    net = new_mesh_object('net', bpy.ops.mesh.primitive_cylinder_add, rope, 'net', radius=0.42, depth=0.02, vertices=24)
    net.matrix_world = reference.matrix_world.copy()
    parent_to_bone(net, arm, reference.parent_bone)
    return net


def build_archetype(archetype, spec):
    reset_scene()
    arm = import_source(spec['source'])
    log(archetype, 'imported', spec['source'], 'height', round(standing_height(arm), 3))

    weapon_ref = bpy.data.objects[WEAPON_REFERENCE[spec['source']]]
    shield_ref = bpy.data.objects[SHIELD_REFERENCE[spec['source']]]

    # Tag body parts before anything is deleted or added.
    for obj in all_mesh_objects():
        if is_body_part(obj):
            obj['slot'] = 'body'

    # Anchor positions read off the reference props while they still exist.
    axis = longest_axis(weapon_ref)
    _base, weapon_far, _dir = world_extent_along(weapon_ref, axis)
    shield_center = shield_ref.matrix_world @ (sum((Vector(c) for c in shield_ref.bound_box), Vector()) / 8)

    keep = spec['keep']
    for obj in list(all_mesh_objects()):
        if is_body_part(obj):
            continue
        if obj.name in keep:
            obj['slot'] = keep[obj.name]
        elif obj.name in (weapon_ref.name, shield_ref.name) and spec['build']:
            continue  # still needed as placement references; deleted below
        else:
            delete_object(obj)

    weapon_tip = weapon_far
    if 'trident' in spec['build']:
        _, weapon_tip = build_shaft_weapon('trident', weapon_ref, arm, length=1.6, radius=0.022, tip_builder=trident_tip)
    if 'spear' in spec['build']:
        _, weapon_tip = build_shaft_weapon('spear', weapon_ref, arm, length=1.9, radius=0.02, tip_builder=spear_tip)
    if 'net' in spec['build']:
        build_net(shield_ref, arm)

    for obj in (weapon_ref, shield_ref):
        if obj.name not in keep and obj.name in bpy.data.objects:
            delete_object(obj)

    add_empty('weaponTip', arm, 'handslot.r', weapon_tip)
    add_empty('shieldCenter', arm, 'handslot.l', shield_center)
    chest_tail = bone_tail_matrix(arm, 'spine').to_translation()
    add_empty('hitCenter', arm, 'spine', chest_tail)

    if archetype == 'technical':
        author_spear_drive(arm)

    prune_clips(arm)

    scale = TARGET_HEIGHT / standing_height(arm)
    arm.scale = (scale, scale, scale)
    log(archetype, 'scale', round(scale, 4), 'clips', sorted(a.name for a in bpy.data.actions))

    os.makedirs(OUT, exist_ok=True)
    out = os.path.join(OUT, f'{archetype}.glb')
    bpy.ops.export_scene.gltf(
        filepath=out,
        export_format='GLB',
        export_extras=True,
        export_apply=True,
        export_yup=True,
        export_animations=True,
        export_animation_mode='ACTIONS',
        export_skins=True,
        export_def_bones=False,
        export_optimize_animation_size=True,
        export_image_format='AUTO',
    )
    log(archetype, 'wrote', out, os.path.getsize(out), 'bytes')


def author_spear_drive(arm):
    """The one clip authored here rather than taken from the pack: a lunge with
    the spear driven forward. Frames at 24 fps; strike at frame 15 of 30 (50%)."""
    action = bpy.data.actions.new('Spear_Drive')
    if not arm.animation_data:
        arm.animation_data_create()
    arm.animation_data.action = action
    if hasattr(action, 'slots') and hasattr(arm.animation_data, 'action_slot'):
        slot = action.slots.new(id_type='OBJECT', name='Rig')
        arm.animation_data.action_slot = slot

    def key(frame, bone, rot_deg):
        pbone = arm.pose.bones[bone]
        pbone.rotation_mode = 'XYZ'
        pbone.rotation_euler = tuple(math.radians(d) for d in rot_deg)
        pbone.keyframe_insert(data_path='rotation_euler', frame=frame)

    # frame: 1 guard, 10 windup (arm back, torso coiled), 15 strike (arm out, torso forward), 30 back to guard
    for bone, guard, windup, strike in (
        ('chest',      (0, 0, 0),    (-8, 0, 20),   (18, 0, -12)),
        ('hips',       (0, 0, 0),    (0, 0, 8),     (6, 0, -6)),
        ('upperarm.r', (0, 0, 0),    (-25, 0, 35),  (70, 0, -20)),
        ('lowerarm.r', (0, 0, 0),    (-60, 0, 0),   (-5, 0, 0)),
        ('upperleg.l', (0, 0, 0),    (10, 0, 0),    (-35, 0, 0)),
        ('upperleg.r', (0, 0, 0),    (-10, 0, 0),   (25, 0, 0)),
    ):
        key(1, bone, guard)
        key(10, bone, windup)
        key(15, bone, strike)
        key(30, bone, guard)

    arm.animation_data.action = None
    track = arm.animation_data.nla_tracks.new()
    track.name = 'Spear_Drive'
    strip = track.strips.new('Spear_Drive', 1, action)
    if hasattr(strip, 'action_slot') and hasattr(action, 'slots') and len(action.slots):
        strip.action_slot = action.slots[0]


def main():
    for archetype, spec in BUILDS.items():
        build_archetype(archetype, spec)


if __name__ == '__main__':
    try:
        main()
    except Exception:
        import traceback
        traceback.print_exc()
        sys.exit(1)
```

- [ ] **Step 3: Run the build and fix Blender API mismatches until it completes**

Run: `npm run models:build 2>&1 | rg -v '^$' | tail -40`

Expected: three `[build_gladiators] <archetype> wrote ...` lines. The importer/exporter keyword names above are Blender 4.2–5.x; if Blender 5.2 rejects one, print the accepted set with

```bash
"/c/Program Files/Blender Foundation/Blender 5.2/blender.exe" --background --python-expr "import bpy; print(bpy.ops.export_scene.gltf.get_rna_type().properties.keys())"
```

and adjust the call. Known places that may need a touch in 5.x: `action.slots.new(...)` signature, `strip.action_slot`, and whether the importer already pushed each animation onto its own NLA track (verify with `--python-expr "import bpy; bpy.ops.import_scene.gltf(filepath='assets/kaykit/Rogue.glb'); a=[o for o in bpy.data.objects if o.type=='ARMATURE'][0]; print([t.name for t in a.animation_data.nla_tracks])"`). If it did not, push every action to a track before pruning, the same way `author_spear_drive` does.

- [ ] **Step 4: Run the contract test**

Run: `node node_modules/vitest/vitest.mjs run --project fast src/presentation/fighterModelContract.test.ts`
Expected: PASS, 15 tests. If the size test fails, the culprit is almost always clips that survived pruning (check the `clips` log line) or the 1024² texture; halve the texture with `img.scale(512, 512)` on each `bpy.data.images` entry before export.

- [ ] **Step 5: Eyeball the output in the viewer**

Drop each file onto `https://gltf-viewer.donmccurdy.com/` and confirm: character stands on the origin, spear points away from the hand, `Spear_Drive` is in the animation list and moves the right arm. Note anything wrong in the commit message; fix props placement in the script rather than in Blender's UI.

- [ ] **Step 6: Commit**

```bash
git add tools/blender/build_gladiators.py public/models package.json
git commit -m "feat(models): build the three gladiators from the KayKit pack in headless Blender"
```

---

### Task 3: Move `gait.ts` up and give it the cycle distances

**Files:**
- Create: `src/presentation/gait.ts`, `src/presentation/gait.test.ts`
- Delete: `src/presentation/poses/gait.ts`
- Modify: `src/presentation/poses/combatPoses.ts` (remove `STYLE_GAIT_CYCLE_DISTANCE`, import it from `../gait` for the one remaining use until Task 6 deletes the file), `src/presentation/CombatAudio.ts:110`, `src/presentation/CombatAudio.test.ts:11`, `src/presentation/PoseController.ts` (import path), `src/presentation/footstepThresholds.test.ts:7` (comment only)

**Interfaces:**
- Produces: `STYLE_GAIT_CYCLE_DISTANCE: Record<Archetype, number>` (`heavy: 1.4, fast: 0.95, technical: 1.15`), `computeGaitPhase(travelledDistance, archetype): number`, `classifyPlantedFoot(travelledDistance, archetype)`, `classifyGaitPhase(phase)`, `DOUBLE_SUPPORT_FRACTION`.

- [ ] **Step 1: Write the failing test**

`src/presentation/gait.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { classifyPlantedFoot, computeGaitPhase, STYLE_GAIT_CYCLE_DISTANCE } from './gait'

describe('gait', () => {
  it('wraps travelled distance into a 0..1 phase per archetype cycle', () => {
    expect(computeGaitPhase(0, 'heavy')).toBe(0)
    expect(computeGaitPhase(STYLE_GAIT_CYCLE_DISTANCE.heavy / 2, 'heavy')).toBeCloseTo(0.5)
    expect(computeGaitPhase(STYLE_GAIT_CYCLE_DISTANCE.fast * 1.25, 'fast')).toBeCloseTo(0.25)
  })

  it('alternates planted foot across a cycle with a double-support window at each plant', () => {
    const cycle = STYLE_GAIT_CYCLE_DISTANCE.technical
    expect(classifyPlantedFoot(0, 'technical')).toBe('both')
    expect(classifyPlantedFoot(cycle * 0.25, 'technical')).toBe('right')
    expect(classifyPlantedFoot(cycle * 0.5, 'technical')).toBe('both')
    expect(classifyPlantedFoot(cycle * 0.75, 'technical')).toBe('left')
  })
})
```

- [ ] **Step 2: Run it to see it fail**

Run: `node node_modules/vitest/vitest.mjs run --project fast src/presentation/gait.test.ts`
Expected: FAIL, cannot find module `./gait`.

- [ ] **Step 3: Move the module**

`git mv src/presentation/poses/gait.ts src/presentation/gait.ts`. In the moved file replace the two import lines with:

```ts
import type { Archetype } from '../simulation/fighters'

/** Travelled distance per full gait cycle (both feet), per archetype. Authored content, shared by the clip mapping's walk time and the footstep audio thresholds. */
export const STYLE_GAIT_CYCLE_DISTANCE: Readonly<Record<Archetype, number>> = {
  heavy: 1.4,
  fast: 0.95,
  technical: 1.15,
}
```

Delete the `STYLE_GAIT_CYCLE_DISTANCE` block (with its doc comment) from `poses/combatPoses.ts` and add `import { STYLE_GAIT_CYCLE_DISTANCE } from '../gait'` there only if the file still references it (search first; if the only use was the export, add nothing). Update:

- `CombatAudio.ts:110` → `export { classifyPlantedFoot } from './gait'`
- `CombatAudio.test.ts:11` → `import { STYLE_GAIT_CYCLE_DISTANCE } from './gait'`
- `PoseController.ts` → replace `'./poses/gait'` with `'./gait'`
- `footstepThresholds.test.ts:7` comment → `// STYLE_GAIT_CYCLE_DISTANCE.heavy, gait.ts`

- [ ] **Step 4: Type-check and run the fast suite**

Run: `node node_modules/typescript/bin/tsc -p tsconfig.json && node node_modules/vitest/vitest.mjs run --project fast`
Expected: tsc clean; all tests pass including the new `gait.test.ts` (2 tests).

- [ ] **Step 5: Commit**

```bash
git add -A src/presentation
git commit -m "refactor(presentation): move gait math and its cycle distances out of poses/"
```

---

### Task 4: `clipMapping` — pure selection of clip and time

**Files:**
- Create: `src/presentation/clipMapping.ts`
- Test: `src/presentation/clipMapping.test.ts`

**Interfaces:**
- Consumes: `ATTACK_CLIPS`, `DEFENSE_CLIPS`, `BASE_CLIPS` from `fighterModelContract.ts`; `computeGaitPhase` from `gait.ts`; `TICKS_PER_SECOND` from `../simulation/movement`; `FighterCombatState` from `../simulation/encounter`.
- Produces:

```ts
export interface ClipSelection { clip: string; time: number; weaponTrailActive: boolean }
export interface ClipMappingInput {
  archetype: Archetype
  state: Readonly<FighterCombatState>
  tick: number
  alpha: number
  staggerStartTick?: number
  defeatedAtTick?: number
  durations: ReadonlyMap<string, number>
}
export function selectClip(input: ClipMappingInput): ClipSelection
```

- [ ] **Step 1: Write the failing tests**

`src/presentation/clipMapping.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import type { FighterCombatState } from '../simulation/encounter'
import { TICKS_PER_SECOND } from '../simulation/movement'
import { selectClip, type ClipMappingInput } from './clipMapping'
import { STYLE_GAIT_CYCLE_DISTANCE } from './gait'

const D = new Map<string, number>([
  ['Idle', 1.0], ['Walking_A', 1.0], ['Hit_A', 0.6], ['Death_A', 0.8],
  ['1H_Melee_Attack_Chop', 1.0], ['Block', 1.0], ['Dodge_Backward', 0.4],
])

function state(overrides: Partial<FighterCombatState> = {}): FighterCombatState {
  return {
    id: 'home.brutus',
    factionId: 'home',
    definition: { id: 'brutus', name: 'Brutus', school: 'Test', archetype: 'heavy', maxHp: 100, power: 10, accuracy: 0.8, defenseChance: 0.3, criticalChance: 0.1 },
    position: { x: 0, z: 0 },
    facing: { x: 0, z: 1 },
    travelledDistance: 0,
    hp: 100,
    status: 'active',
    locomotionIntent: 'hold',
    velocity: { x: 0, z: 0 },
    action: { type: 'neutral' },
    staggerUntilTick: 0,
    nextDecisionTick: 0,
    nextActionSerial: 0,
    lastContactTick: -1,
    lastResolutionTick: -1,
    reactionLedger: [],
    ...overrides,
  } as FighterCombatState
}

function input(overrides: Partial<ClipMappingInput> = {}): ClipMappingInput {
  return { archetype: 'heavy', state: state(), tick: 0, alpha: 0, durations: D, ...overrides }
}

describe('selectClip', () => {
  it('idles by default, looping on the tick clock', () => {
    expect(selectClip(input({ tick: 30, alpha: 0.5 }))).toEqual({ clip: 'Idle', time: (30.5 / TICKS_PER_SECOND) % 1.0, weaponTrailActive: false })
  })

  it('walks on travelled distance when moving, so the same distance gives the same frame', () => {
    const moving = state({ velocity: { x: 0, z: 0.3 }, travelledDistance: STYLE_GAIT_CYCLE_DISTANCE.heavy * 2.25 })
    expect(selectClip(input({ state: moving, tick: 5 }))).toEqual({ clip: 'Walking_A', time: 0.25, weaponTrailActive: false })
    expect(selectClip(input({ state: moving, tick: 500 })).time).toBe(0.25)
  })

  it('lands an attack clip\'s strike frame on the simulation contact tick', () => {
    const attacking = (phase: 'windup' | 'contact' | 'impact' | 'recovery', started: number, ends: number) =>
      state({ action: { type: 'active', instanceId: 'a1', definitionId: 'heavy-cleave', phase, phaseStartedTick: started, phaseEndsAtTick: ends, targetId: 'away.drusus' } })
    // windup 0..20 -> clip 0..0.5 (contactAt for heavy-cleave is 0.5, duration 1.0)
    expect(selectClip(input({ state: attacking('windup', 0, 20), tick: 10 })).time).toBeCloseTo(0.25)
    expect(selectClip(input({ state: attacking('windup', 0, 20), tick: 10 })).weaponTrailActive).toBe(false)
    expect(selectClip(input({ state: attacking('windup', 0, 20), tick: 14 })).weaponTrailActive).toBe(true)
    // contact tick -> exactly contactAt
    expect(selectClip(input({ state: attacking('contact', 20, 21), tick: 20 })).time).toBeCloseTo(0.5)
    expect(selectClip(input({ state: attacking('contact', 20, 21), tick: 20 })).weaponTrailActive).toBe(true)
    // impact holds between contactAt and contactAt + 0.15
    expect(selectClip(input({ state: attacking('impact', 21, 31), tick: 26 })).time).toBeCloseTo(0.575)
    // recovery runs the rest out
    expect(selectClip(input({ state: attacking('recovery', 31, 51), tick: 41 })).time).toBeCloseTo(0.825)
    expect(selectClip(input({ state: attacking('recovery', 31, 51), tick: 41 })).weaponTrailActive).toBe(false)
  })

  it('plays the defense clip over impact then recovery', () => {
    const blocking = (phase: 'impact' | 'recovery') =>
      state({ action: { type: 'active', instanceId: 'd1', definitionId: 'heavy-guard', phase, phaseStartedTick: 0, phaseEndsAtTick: 10, targetId: 'away.drusus' } })
    expect(selectClip(input({ state: blocking('impact'), tick: 5 }))).toEqual({ clip: 'Block', time: 0.3, weaponTrailActive: false })
    expect(selectClip(input({ state: blocking('recovery'), tick: 5 })).time).toBeCloseTo(0.8)
  })

  it('prefers the hit clip while staggered, timed from the stagger start', () => {
    const staggered = state({ staggerUntilTick: 40, action: { type: 'active', instanceId: 'a1', definitionId: 'heavy-cleave', phase: 'windup', phaseStartedTick: 0, phaseEndsAtTick: 20, targetId: 'x' } })
    expect(selectClip(input({ state: staggered, tick: 30, staggerStartTick: 24 }))).toEqual({ clip: 'Hit_A', time: 6 / TICKS_PER_SECOND, weaponTrailActive: false })
    expect(selectClip(input({ state: staggered, tick: 39, staggerStartTick: 0 })).time).toBe(0.6) // clamped to the clip end
  })

  it('holds the last death frame once defeated', () => {
    const defeated = state({ status: 'defeated', staggerUntilTick: 999 })
    expect(selectClip(input({ state: defeated, tick: 100, defeatedAtTick: 90 })).clip).toBe('Death_A')
    expect(selectClip(input({ state: defeated, tick: 100, defeatedAtTick: 90 })).time).toBeCloseTo(10 / TICKS_PER_SECOND)
    expect(selectClip(input({ state: defeated, tick: 1000, defeatedAtTick: 90 })).time).toBe(0.8)
  })

  it('falls back to the current tick when a stagger or defeat start was never recorded', () => {
    expect(selectClip(input({ state: state({ staggerUntilTick: 40 }), tick: 30 })).time).toBe(0)
    expect(selectClip(input({ state: state({ status: 'defeated' }), tick: 30 })).time).toBe(0)
  })
})
```

- [ ] **Step 2: Run to see it fail**

Run: `node node_modules/vitest/vitest.mjs run --project fast src/presentation/clipMapping.test.ts`
Expected: FAIL, cannot find module `./clipMapping`.

- [ ] **Step 3: Implement**

`src/presentation/clipMapping.ts`:

```ts
// Pure: which clip a fighter plays this frame and at what time. The only
// clock is `tick + alpha`; no wall clock enters here, so a re-render at the
// same tick pair reproduces the same skeleton (smoke.spec.ts relies on it).
//
// Rule-free like the rest of presentation: reads `FighterCombatState`, never
// decides an outcome, never writes anything back.

import type { AttackActionId, CombatActionPhase, DefenseActionId } from '../simulation/combatActions'
import type { FighterCombatState } from '../simulation/encounter'
import type { Archetype } from '../simulation/fighters'
import { TICKS_PER_SECOND } from '../simulation/movement'
import { ATTACK_CLIPS, BASE_CLIPS, DEFENSE_CLIPS } from './fighterModelContract'
import { computeGaitPhase } from './gait'

export interface ClipSelection {
  clip: string
  /** Seconds into the clip. */
  time: number
  weaponTrailActive: boolean
}

export interface ClipMappingInput {
  archetype: Archetype
  state: Readonly<FighterCombatState>
  tick: number
  alpha: number
  /** Tick of the `fighter-staggered` event that opened the current stagger; `ArenaView` records it. */
  staggerStartTick?: number
  /** Tick of the `fighter-defeated` event. */
  defeatedAtTick?: number
  /** Clip durations in seconds, from the loaded model. */
  durations: ReadonlyMap<string, number>
}

/** Held portion of an attack clip after the strike frame, as a fraction of the clip. */
const IMPACT_HOLD_FRACTION = 0.15
/** Fraction of a defense clip spent raising the guard; the rest lowers it. */
const DEFENSE_IMPACT_FRACTION = 0.6
/** Windup progress from which the weapon trail shows (same rule `PoseController` used). */
const WEAPON_TRAIL_WINDUP_THRESHOLD = 0.6
const MOVING_SPEED_EPSILON = 0.01

const clamp01 = (value: number): number => Math.min(1, Math.max(0, value))

function isAttackActionId(id: string): id is AttackActionId {
  return Object.prototype.hasOwnProperty.call(ATTACK_CLIPS, id)
}
function isDefenseActionId(id: string): id is DefenseActionId {
  return Object.prototype.hasOwnProperty.call(DEFENSE_CLIPS, id)
}

function phaseProgress(t: number, startedTick: number, endsAtTick: number): number {
  const span = endsAtTick - startedTick
  return span > 0 ? clamp01((t - startedTick) / span) : 1
}

function attackTime(phase: CombatActionPhase, p: number, contactAt: number, duration: number): number {
  const hold = Math.min(contactAt + IMPACT_HOLD_FRACTION, 0.95)
  switch (phase) {
    case 'windup':
      return p * contactAt * duration
    case 'contact':
    case 'impact':
      return (contactAt + p * (hold - contactAt)) * duration
    case 'recovery':
      return (hold + p * (1 - hold)) * duration
  }
}

export function selectClip(input: ClipMappingInput): ClipSelection {
  const { state, tick, alpha, durations } = input
  const t = tick + alpha
  const durationOf = (clip: string): number => durations.get(clip) ?? 1
  const still = (clip: string, time: number): ClipSelection => ({ clip, time, weaponTrailActive: false })

  if (state.status === 'defeated') {
    const clip = BASE_CLIPS.death
    const since = (t - (input.defeatedAtTick ?? tick)) / TICKS_PER_SECOND
    return still(clip, Math.min(Math.max(0, since), durationOf(clip)))
  }

  if (state.staggerUntilTick > tick) {
    const clip = BASE_CLIPS.hit
    const since = (t - (input.staggerStartTick ?? tick)) / TICKS_PER_SECOND
    return still(clip, Math.min(Math.max(0, since), durationOf(clip)))
  }

  const action = state.action
  if (action.type === 'active') {
    const p = phaseProgress(t, action.phaseStartedTick, action.phaseEndsAtTick)
    if (isAttackActionId(action.definitionId)) {
      const { clip, contactAt } = ATTACK_CLIPS[action.definitionId]
      const trail = action.phase === 'contact' || action.phase === 'impact' || (action.phase === 'windup' && p >= WEAPON_TRAIL_WINDUP_THRESHOLD)
      return { clip, time: attackTime(action.phase, p, contactAt, durationOf(clip)), weaponTrailActive: trail }
    }
    if (isDefenseActionId(action.definitionId)) {
      const clip = DEFENSE_CLIPS[action.definitionId]
      const duration = durationOf(clip)
      const time = action.phase === 'recovery'
        ? (DEFENSE_IMPACT_FRACTION + p * (1 - DEFENSE_IMPACT_FRACTION)) * duration
        : p * DEFENSE_IMPACT_FRACTION * duration
      return still(clip, time)
    }
  }

  if (Math.hypot(state.velocity.x, state.velocity.z) > MOVING_SPEED_EPSILON) {
    const clip = BASE_CLIPS.walk
    return still(clip, computeGaitPhase(state.travelledDistance, input.archetype) * durationOf(clip))
  }

  const idle = BASE_CLIPS.idle
  return still(idle, (t / TICKS_PER_SECOND) % durationOf(idle))
}
```

- [ ] **Step 4: Run the tests**

Run: `node node_modules/vitest/vitest.mjs run --project fast src/presentation/clipMapping.test.ts`
Expected: PASS, 7 tests. If the `Vec2` field names differ from `{x, z}` in `../simulation/movement`, match them (check `export interface Vec2`).

- [ ] **Step 5: Commit**

```bash
git add src/presentation/clipMapping.ts src/presentation/clipMapping.test.ts
git commit -m "feat(presentation): map simulation state to a clip and a tick-derived clip time"
```

---

### Task 5: `FighterAnimator` and `SkinnedFighter`

**Files:**
- Create: `src/presentation/FighterAnimator.ts`, `src/presentation/FighterAnimator.test.ts`
- Create: `src/presentation/SkinnedFighter.ts`

**Interfaces:**
- Consumes: `ClipSelection` from `clipMapping.ts`; `FIGHTER_BONE_NAMES`, `ANCHOR_NODE_NAMES`, `MODEL_FILES` from `fighterModelContract.ts`.
- Produces:

```ts
// FighterAnimator.ts
export class FighterAnimator {
  constructor(root: THREE.Object3D, clips: Iterable<THREE.AnimationClip>)
  readonly durations: ReadonlyMap<string, number>
  apply(selection: { clip: string; time: number }): void
  dispose(): void
}
// SkinnedFighter.ts
export type FighterModelSet = Readonly<Record<Archetype, GLTF>>
export function loadFighterModels(loader?: GLTFLoader): Promise<FighterModelSet>
export interface SkinnedFighter {
  root: THREE.Group
  bones: ReadonlyMap<FighterBoneName, THREE.Object3D>
  anchors: ReadonlyMap<EquipmentAnchorName, THREE.Object3D>
  clips: readonly THREE.AnimationClip[]
  horizontalEquipmentRadius: number
  dispose(): void
  isDisposed(): boolean
}
export function createSkinnedFighter(models: FighterModelSet, archetype: Archetype): SkinnedFighter
```

- [ ] **Step 1: Write the failing animator test (synthetic bone, no file, no WebGL)**

`src/presentation/FighterAnimator.test.ts`:

```ts
import * as THREE from 'three'
import { describe, expect, it } from 'vitest'
import { FighterAnimator } from './FighterAnimator'

function rig(): { root: THREE.Group; bone: THREE.Bone; clips: THREE.AnimationClip[] } {
  const root = new THREE.Group()
  const bone = new THREE.Bone()
  bone.name = 'chest'
  root.add(bone)
  const rise = new THREE.AnimationClip('Rise', 1, [new THREE.VectorKeyframeTrack('chest.position', [0, 1], [0, 0, 0, 0, 2, 0])])
  const slide = new THREE.AnimationClip('Slide', 2, [new THREE.VectorKeyframeTrack('chest.position', [0, 2], [0, 0, 0, 4, 0, 0])])
  return { root, bone, clips: [rise, slide] }
}

describe('FighterAnimator', () => {
  it('exposes clip durations by name', () => {
    const { root, clips } = rig()
    expect(new FighterAnimator(root, clips).durations).toEqual(new Map([['Rise', 1], ['Slide', 2]]))
  })

  it('poses the skeleton at an explicit clip time without any wall clock', () => {
    const { root, bone, clips } = rig()
    const animator = new FighterAnimator(root, clips)
    animator.apply({ clip: 'Rise', time: 0.5 })
    expect(bone.position.y).toBeCloseTo(1)
    animator.apply({ clip: 'Rise', time: 0.5 })
    expect(bone.position.y).toBeCloseTo(1) // idempotent: same input, same skeleton
  })

  it('switches clips cleanly, the previous clip contributing nothing', () => {
    const { root, bone, clips } = rig()
    const animator = new FighterAnimator(root, clips)
    animator.apply({ clip: 'Rise', time: 1 })
    animator.apply({ clip: 'Slide', time: 1 })
    expect(bone.position.x).toBeCloseTo(2)
    expect(bone.position.y).toBeCloseTo(0)
  })

  it('clamps a time past the end to the last frame', () => {
    const { root, bone, clips } = rig()
    new FighterAnimator(root, clips).apply({ clip: 'Rise', time: 5 })
    expect(bone.position.y).toBeCloseTo(2)
  })

  it('throws on an unknown clip so a contract drift is loud', () => {
    const { root, clips } = rig()
    expect(() => new FighterAnimator(root, clips).apply({ clip: 'Nope', time: 0 })).toThrow(/Nope/)
  })
})
```

- [ ] **Step 2: Run to see it fail**

Run: `node node_modules/vitest/vitest.mjs run --project fast src/presentation/FighterAnimator.test.ts`
Expected: FAIL, cannot find module `./FighterAnimator`.

- [ ] **Step 3: Implement the animator**

`src/presentation/FighterAnimator.ts`:

```ts
// One AnimationMixer per rig, driven by an explicit clip time rather than by
// elapsed wall time: `apply` sets `action.time` and calls `mixer.update(0)`,
// so the skeleton is a pure function of the selection it was handed.

import * as THREE from 'three'

export class FighterAnimator {
  private readonly mixer: THREE.AnimationMixer
  private readonly actions = new Map<string, THREE.AnimationAction>()
  private active: THREE.AnimationAction | undefined
  readonly durations: ReadonlyMap<string, number>

  constructor(root: THREE.Object3D, clips: Iterable<THREE.AnimationClip>) {
    this.mixer = new THREE.AnimationMixer(root)
    const durations = new Map<string, number>()
    for (const clip of clips) {
      const action = this.mixer.clipAction(clip)
      action.setLoop(THREE.LoopOnce, 1)
      action.clampWhenFinished = true
      action.enabled = false
      this.actions.set(clip.name, action)
      durations.set(clip.name, clip.duration)
    }
    this.durations = durations
  }

  apply(selection: { clip: string; time: number }): void {
    const action = this.actions.get(selection.clip)
    if (!action) throw new Error(`FighterAnimator: no clip named ${selection.clip}`)
    if (this.active && this.active !== action) {
      this.active.enabled = false
      this.active.stop()
    }
    this.active = action
    action.enabled = true
    action.setEffectiveWeight(1)
    action.setEffectiveTimeScale(1)
    action.paused = false
    if (!action.isRunning()) action.play()
    action.time = Math.min(Math.max(0, selection.time), action.getClip().duration)
    this.mixer.update(0)
  }

  dispose(): void {
    this.mixer.stopAllAction()
    for (const action of this.actions.values()) this.mixer.uncacheAction(action.getClip())
  }
}
```

If the "clamps a time past the end" test fails because `LoopOnce` at `time === duration` snaps back, set `action.time = Math.min(time, duration - 1e-6)` instead.

- [ ] **Step 4: Run the animator tests**

Run: `node node_modules/vitest/vitest.mjs run --project fast src/presentation/FighterAnimator.test.ts`
Expected: PASS, 5 tests.

- [ ] **Step 5: Implement `SkinnedFighter` (e2e-covered; no unit test because GLTFLoader needs a browser for textures)**

`src/presentation/SkinnedFighter.ts`:

```ts
// Loads the three shipped models once and clones a skinned rig per fighter.
// Replaces ProceduralFighter: same `root` (world placement only), same five
// anchor names, same `horizontalEquipmentRadius` contract for the camera.

import * as THREE from 'three'
import { GLTFLoader, type GLTF } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { clone as cloneSkeleton } from 'three/examples/jsm/utils/SkeletonUtils.js'
import type { Archetype } from '../simulation/fighters'
import { ANCHOR_NODE_NAMES, FIGHTER_ANCHOR_NAMES, FIGHTER_BONE_NAMES, MODEL_FILES, type EquipmentAnchorName, type FighterBoneName } from './fighterModelContract'

export type FighterModelSet = Readonly<Record<Archetype, GLTF>>

export async function loadFighterModels(loader: GLTFLoader = new GLTFLoader()): Promise<FighterModelSet> {
  const base = import.meta.env.BASE_URL
  const load = (archetype: Archetype) => loader.loadAsync(`${base}${MODEL_FILES[archetype]}`)
  const [heavy, fast, technical] = await Promise.all([load('heavy'), load('fast'), load('technical')])
  return { heavy, fast, technical }
}

export interface SkinnedFighter {
  root: THREE.Group
  bones: ReadonlyMap<FighterBoneName, THREE.Object3D>
  anchors: ReadonlyMap<EquipmentAnchorName, THREE.Object3D>
  clips: readonly THREE.AnimationClip[]
  horizontalEquipmentRadius: number
  dispose(): void
  isDisposed(): boolean
}

const BOX = new THREE.Box3()

/** Farthest any mesh's world-space box corner sits from the rig's vertical axis, in the rest pose (same measurement the procedural rig used for the camera). */
function computeHorizontalEquipmentRadius(root: THREE.Object3D): number {
  root.updateMatrixWorld(true)
  let radius = 0
  root.traverse((object) => {
    if (!(object as THREE.Mesh).isMesh) return
    BOX.setFromObject(object)
    if (BOX.isEmpty()) return
    for (const x of [BOX.min.x, BOX.max.x]) for (const z of [BOX.min.z, BOX.max.z]) radius = Math.max(radius, Math.hypot(x, z))
  })
  return radius
}

export function createSkinnedFighter(models: FighterModelSet, archetype: Archetype): SkinnedFighter {
  const source = models[archetype]
  const scene = cloneSkeleton(source.scene)
  const root = new THREE.Group()
  root.name = `fighter:${archetype}`
  root.add(scene)

  const byName = new Map<string, THREE.Object3D>()
  scene.traverse((object) => {
    byName.set(object.name, object)
    if ((object as THREE.Mesh).isMesh) {
      object.castShadow = true
      object.frustumCulled = false // skinned parts move outside their bind-pose bounds
    }
  })

  const bones = new Map<FighterBoneName, THREE.Object3D>()
  for (const name of FIGHTER_BONE_NAMES) {
    const bone = byName.get(name)
    if (!bone) throw new Error(`Model ${archetype} has no bone ${name}`)
    bones.set(name, bone)
  }
  const anchors = new Map<EquipmentAnchorName, THREE.Object3D>()
  for (const name of FIGHTER_ANCHOR_NAMES) {
    const node = byName.get(ANCHOR_NODE_NAMES[name])
    if (!node) throw new Error(`Model ${archetype} has no anchor ${ANCHOR_NODE_NAMES[name]}`)
    anchors.set(name, node)
  }

  const horizontalEquipmentRadius = computeHorizontalEquipmentRadius(root)
  let disposed = false
  return {
    root,
    bones,
    anchors,
    clips: source.animations,
    horizontalEquipmentRadius,
    dispose(): void {
      if (disposed) return
      root.clear() // geometries/materials are shared with the source GLTF and stay alive
      disposed = true
    },
    isDisposed: () => disposed,
  }
}
```

- [ ] **Step 6: Type-check**

Run: `node node_modules/typescript/bin/tsc -p tsconfig.json`
Expected: clean. If `import.meta.env.BASE_URL` is not typed, add `/// <reference types="vite/client" />` at the top of the file (the deleted `legibilityMode.ts` used the same directive).

- [ ] **Step 7: Commit**

```bash
git add src/presentation/FighterAnimator.ts src/presentation/FighterAnimator.test.ts src/presentation/SkinnedFighter.ts
git commit -m "feat(presentation): skinned fighter loader and a tick-driven clip animator"
```

---

### Task 6: Switch `ArenaView` and `main.ts`; delete the procedural rig

**Files:**
- Modify: `src/presentation/ArenaView.ts` (imports at 13-21; `BODY_SILHOUETTE_SLOTS` at ~178; `applyPoseToJoints` at ~332; `FighterRig` at ~461; constructor at ~546; per-frame loop at ~780-812; `processNewEvents` at ~849; `computeContactTarget` at ~907; `reconcileRigs`/`disposeRig` at ~1007-1040; `buildArenaDebugSnapshot` at ~1228-1300)
- Modify: `src/main.ts:149` and the `ArenaView` construction
- Delete: `src/presentation/ProceduralFighter.ts`, `src/presentation/ProceduralFighter.test.ts`, `src/presentation/PoseController.ts`, `src/presentation/PoseController.test.ts`, `src/presentation/poses/combatPoses.ts`, `src/presentation/poses/combatPoses.test.ts`, `src/presentation/poses/idle.ts`, `src/presentation/poses/idle.test.ts`
- Modify (comments naming deleted modules): `src/presentation/CombatAudio.ts:79,102-103,189`, `src/presentation/footstepThresholds.ts:36`, `src/presentation/DecisionPanel.test.ts:10`, `src/main.ts:230-247`, `tests/combat-visuals.spec.ts:216-228`, `tests/legibility.spec.ts:154,473-479`

**Interfaces:**
- Consumes: `createSkinnedFighter`, `loadFighterModels`, `FighterModelSet`, `SkinnedFighter`; `FighterAnimator`; `selectClip`; `FIGHTER_BONE_NAMES`, `FighterBoneName`.
- Produces: `new ArenaView(canvas, models: FighterModelSet | null)`. `ArenaDebugSnapshot.jointRotations` is now keyed by `FighterBoneName`.

- [ ] **Step 1: Delete the procedural modules and see what breaks**

```bash
git rm -q src/presentation/ProceduralFighter.ts src/presentation/ProceduralFighter.test.ts src/presentation/PoseController.ts src/presentation/PoseController.test.ts src/presentation/poses/combatPoses.ts src/presentation/poses/combatPoses.test.ts src/presentation/poses/idle.ts src/presentation/poses/idle.test.ts
node node_modules/typescript/bin/tsc -p tsconfig.json 2>&1 | head -30
```

Expected: errors only in `ArenaView.ts` (and `gait.ts` if Task 3 left an import of `./poses/combatPoses` — remove it).

- [ ] **Step 2: Rewrite the rig plumbing in `ArenaView.ts`**

Imports (replace lines 15-17):

```ts
import { createSkinnedFighter, type FighterModelSet, type SkinnedFighter } from './SkinnedFighter'
import { FighterAnimator } from './FighterAnimator'
import { selectClip } from './clipMapping'
import { FIGHTER_BONE_NAMES, type FighterBoneName } from './fighterModelContract'
```

Silhouette slots:

```ts
export const BODY_SILHOUETTE_SLOTS: ReadonlySet<string> = new Set(['body', 'helmet'])
export const HELD_EQUIPMENT_SLOTS: ReadonlySet<string> = new Set(['weapon', 'shield', 'net'])
const LONG_HANDHELD_WEAPON_SLOT = 'weapon'
```

Delete `applyPoseToJoints` and its doc comment entirely. Replace `FighterRig`:

```ts
interface FighterRig {
  fighter: SkinnedFighter
  animator: FighterAnimator
  /** Tick of the `fighter-staggered` event that opened the current stagger; cleared with the rig on every new bout. */
  staggerStartTick?: number
  /** Tick of the `fighter-defeated` event. */
  defeatedAtTick?: number
  trailGeometry: THREE.BufferGeometry
  trailMaterial: THREE.LineBasicMaterial
  trailLine: THREE.Line
  trailPoints: THREE.Vector3[]
}
```

Constructor: `constructor(private readonly canvas: HTMLCanvasElement, private readonly models: FighterModelSet | null)`. Directly after the `try { ... } catch { ... }` block that sets up the renderer, add:

```ts
    if (!this.models && !this.contextLost) {
      // Models failed to load: same readable fallback as "no WebGL", the season keeps running.
      this.renderer?.dispose()
      this.renderer = undefined
      this.contextLost = true
    }
```

(`this.renderer` is declared `readonly`; drop the `readonly` on that field.)

Per-frame loop (replace the block from `const contactTarget = ...` through `this.updateWeaponTrail(...)`):

```ts
      const selection = selectClip({
        archetype: currState.definition.archetype,
        state: currState,
        tick: current.encounter.tick,
        alpha,
        staggerStartTick: rig.staggerStartTick,
        defeatedAtTick: rig.defeatedAtTick,
        durations: rig.animator.durations,
      })
      rig.animator.apply(selection)
      rig.fighter.root.updateMatrixWorld(true)

      this.updateWeaponTrail(rig, selection.weaponTrailActive && !reducedMotion)
```

`processNewEvents`: replace the `defense-declined` case with:

```ts
        case 'fighter-staggered': {
          const rig = this.rigs.get(event.targetId)
          if (rig) rig.staggerStartTick = event.tick
          break
        }
        case 'fighter-defeated': {
          const rig = this.rigs.get(event.targetId)
          if (rig) rig.defeatedAtTick = event.tick
          break
        }
```

Check the field names on those two event types in `src/simulation/encounter.ts` (`rg -n "type: 'fighter-staggered'" -B2 -A6 src/simulation/encounter.ts`) and use exactly the id field they carry (`targetId`, `combatantId` or `fighterId`).

Delete `computeContactTarget` and its doc comment. In `reconcileRigs`:

```ts
    if (!this.models) return
    for (const id of ids) {
      if (this.rigs.has(id)) continue
      const archetype = combatants[id].definition.archetype
      const fighter = createSkinnedFighter(this.models, archetype)
      this.scene.add(fighter.root)
      const trail = createTrail()
      this.scene.add(trail.line)
      this.rigs.set(id, {
        fighter,
        animator: new FighterAnimator(fighter.root, fighter.clips),
        trailGeometry: trail.geometry,
        trailMaterial: trail.material,
        trailLine: trail.line,
        trailPoints: [],
      })
    }
```

(`if (!this.models) return` goes at the top of the function, before the disposal loop, only if `contextLost` does not already short-circuit the caller; check `sync()`/`applyFrame()` and keep whichever guard is already there.) In `disposeRig` add `rig.animator.dispose()` before `rig.fighter.dispose()`.

Debug snapshot: replace `JointName`/`SEMANTIC_JOINT_NAMES`/`rig.fighter.joints` with `FighterBoneName`/`FIGHTER_BONE_NAMES`/`rig.fighter.bones` (three places: the `ArenaDebugSnapshot` type, `rotationsForRig`'s type, and the loop). The `if (!joint)` branch stays.

Update the module header comment (lines 1-11) to name `SkinnedFighter`/`FighterAnimator` instead of `ProceduralFighter`/`PoseController`.

- [ ] **Step 3: Make `main.ts` load the models first**

Add near the other imports: `import { loadFighterModels } from './presentation/SkinnedFighter'`. Replace `const arenaView = new ArenaView(canvas)` with:

```ts
// Top-level await: the arena cannot build a rig before its models are parsed,
// and every e2e test waits for `window.__GLADIATOR_TEST__`, which is published
// below this line -- so nothing in the suite observes a half-loaded arena.
// A failed load takes the same readable-fallback path as missing WebGL.
const fighterModels = await loadFighterModels().catch((error: unknown) => {
  console.error('Fighter models failed to load; arena display disabled.', error)
  return null
})
const arenaView = new ArenaView(canvas, fighterModels)
```

If `tsc` rejects top-level await, `tsconfig.json` needs `"module": "ESNext"` and `"target": "ES2022"` — both already set — and Vite's build target must allow it; `vite.config.ts` has no `build.target`, so the default (`baseline-widely-available`) does.

Update the comments at `main.ts:230-247` to say `clipMapping`/`FighterAnimator` where they say `PoseController`.

- [ ] **Step 4: Fix the remaining comment references**

In each file listed under "Modify (comments…)" replace `PoseController`/`ProceduralFighter`/`poses/gait.ts` with `FighterAnimator`/`SkinnedFighter`/`gait.ts`. Comments only; behaviour unchanged. In `tests/combat-visuals.spec.ts:216-228` the root-yaw regression note describes the old `applyPoseToJoints` bug; keep the test, shorten the comment to: `// Root-yaw regression: pose application must never touch the root's world facing. Kept as the guard for the clip-driven rig too.`

- [ ] **Step 5: Type-check and run the fast unit suite**

Run: `node node_modules/typescript/bin/tsc -p tsconfig.json && node node_modules/vitest/vitest.mjs run --project fast`
Expected: tsc clean. Every test passes except possibly `ArenaCamera.test.ts`'s recorded-trace replay (Task 7 handles it). `slowSuites.test.ts` passes: no slow file was added or removed.

- [ ] **Step 6: Build and run the fast e2e suite**

Run: `npm run build && node node_modules/@playwright/test/cli.js test --project fast 2>&1 | tail -30`
Expected: every non-screenshot test passes. The five arena screenshot comparisons FAIL (different fighters) — that is Task 8. Any other failure is a real bug: fix it here. Two to look for:

- `renders movement-rich encounter combat` / `jointTransformsFinite`: a NaN in a bone means `apply` was called with a clip time `NaN` — check `durations` has the clip.
- `separates body height from full prop bounds`: `bodyHeightPx` must be smaller than the full bounds; if equal, the `extras.slot` tags did not arrive in `userData.slot` — confirm with `page.evaluate` that a mesh's `userData` carries `slot`, and if not, read `object.userData.gltfExtras?.slot` as well.

- [ ] **Step 7: Commit**

```bash
git add -A src tests
git commit -m "feat(presentation): render skinned gladiators driven by pack clips; drop the procedural rig"
```

---

### Task 7: Re-record the camera traces for the new framing radii

**Files:**
- Modify: `src/presentation/ArenaCamera.test.ts:78-82` (`RIG_EQUIPMENT_RADIUS`), `src/testSupport/frozenFixtures/cameraTraces.ts`

- [ ] **Step 1: Measure the new radii in Node**

The measurement needs the parsed models, so take it from the browser, where the loader works:

```bash
npm run dev &
sleep 4
node -e "
const { chromium } = require('@playwright/test');
(async () => {
  const b = await chromium.launch(); const p = await b.newPage();
  await p.goto('http://127.0.0.1:4173/?seed=20260815&snapshot');
  await p.waitForFunction(() => Boolean(window.__GLADIATOR_TEST__));
  const radii = await p.evaluate(() => {
    const api = window.__GLADIATOR_TEST__;
    api.startNextSeries(); api.assign('brutus', 0); api.assign('aquila', 1); api.assign('nerva', 2); api.confirm();
    api.advanceTicks(1);
    return api.getArenaDebugSnapshot().framingTargets;
  });
  console.log(JSON.stringify(radii, null, 2));
  await b.close();
})();"
```

(`framingTargets` is already part of the debug snapshot: see `buildArenaDebugSnapshot`.) Note the radius for `heavy` (brutus). Repeat with lineups `aquila, nerva, brutus` and `nerva, brutus, aquila` to read `fast` and `technical`, or read all three from any bout that renders them.

- [ ] **Step 2: Update `RIG_EQUIPMENT_RADIUS` and re-record the traces**

Write the three numbers into `RIG_EQUIPMENT_RADIUS` in `ArenaCamera.test.ts`. Run:

`node node_modules/vitest/vitest.mjs run --project fast src/presentation/ArenaCamera.test.ts`

If the replay assertions fail only on `crossings` / `openingDistance`, update those literals in `frozenFixtures/cameraTraces.ts` from the values the failure prints, and replace the "RE-RECORDED by the retiarius-reach slice" comment with one stating: the framing radii moved with the skinned models; `ticks` must NOT move (the simulation is untouched) — if `ticks` differs, stop: something changed the bout, and that is a bug, not a re-baseline.

- [ ] **Step 3: Run the whole fast unit suite**

Run: `node node_modules/vitest/vitest.mjs run --project fast`
Expected: all green.

- [ ] **Step 4: Commit**

```bash
git add src/presentation/ArenaCamera.test.ts src/testSupport/frozenFixtures/cameraTraces.ts
git commit -m "test(camera): re-record the framing traces for the skinned models' radii; bout lengths unchanged"
```

---

### Task 8: Screenshot baselines, README, final checks

**Files:**
- Modify: `tests/__screenshots__/win32/{heavy-cleave,fast-burst,technical-parry,combat-outcomes,combat-safe-frame}.png`
- Modify: `README.md` (the «Три типа гладиаторов» rig paragraph, the «Проверки» block, the «Дальнейший roadmap» item 4)
- Modify: `AGENTS.md` («Other commands»: add `npm run models:build`)

- [ ] **Step 1: Re-capture the win32 arena baselines**

Run: `node node_modules/@playwright/test/cli.js test --project fast tests/combat-visuals.spec.ts --update-snapshots`

Then open each regenerated PNG under `tests/__screenshots__/win32/` and check: both fighters visible and textured, weapon in the right hand, shield/net in the left, camera framing both, no T-pose. `planning.png` and `season-board.png` must not have changed (`git status` shows only the five arena files).

- [ ] **Step 2: Run the full fast check**

Run: `npm run check`
Expected: unit, build and e2e all green on win32.

- [ ] **Step 3: Update the docs**

README «Три типа гладиаторов»: replace the sentences describing the procedural kits with one paragraph: models are the CC0 KayKit Adventurers characters built by `npm run models:build` from `assets/kaykit/` via `tools/blender/build_gladiators.py` (Blender 5.2); the murmillo is the Knight with sword and rectangle shield, the retiarius the Barbarian with a built trident and net, the hoplomachus the Rogue with a built spear and round shield; animation is the pack's clips plus the script-authored `Spear_Drive`, selected by `src/presentation/clipMapping.ts` from tick and phase. «Проверки»: add `npm run models:build  # пересобрать public/models/*.glb из assets/kaykit (нужен Blender 5.2)`. Roadmap item 4 → «Импортированные модели: сделано (KayKit + Blender-пайплайн); следующий шаг — свои клипы под каждый тип.» AGENTS.md «Other commands»: add the same line.

- [ ] **Step 4: Commit and push; trigger the Linux baselines**

```bash
git add tests/__screenshots__/win32 README.md AGENTS.md
git commit -m "test(e2e): re-baseline the arena screenshots for the skinned gladiators; document the model pipeline"
git push -u origin feature/skinned-gladiators
gh workflow run update-baselines.yml --ref feature/skinned-gladiators
```

Wait for the workflow (`gh run list --workflow=update-baselines.yml --limit 1`), then `git pull` and look at the committed Linux PNGs the same way as the win32 ones.

- [ ] **Step 5: Open the PR**

PR body: what changed, the three archetype screenshots, a sentence per attack on whether the strike frame reads as landing on the contact tick (from watching a bout at ×1 in `npm run dev`), and the `legibility.spec.ts` result from `node node_modules/@playwright/test/cli.js test --project slow tests/legibility.spec.ts` (about 12 minutes). If legibility fails the 130 px bar, report the measured number and adjust `TARGET_HEIGHT` in the build script or `FLAT_DISTANCE` in `ArenaCamera.ts` — never the bar.
