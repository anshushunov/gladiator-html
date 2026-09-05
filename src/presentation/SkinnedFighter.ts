/// <reference types="vite/client" />

// Loads the three shipped models once and clones a skinned rig per fighter.
// Took over from the procedural rig this slice replaced, and deliberately kept
// its three load-bearing contracts rather than inventing new ones: `root` is a
// wrapper the caller places and turns and nothing else ever writes, the same
// five equipment anchor names resolve, and `horizontalEquipmentRadius` still
// measures what the camera's group framing consumes.

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

/**
 * The name a contract node actually carries once `GLTFLoader` has built the
 * scene. Every bone in the pack is named `upperarm.l`-style, and `.` is a
 * reserved character in three.js's own property paths, so `GLTFLoader` runs
 * every node name through `PropertyBinding.sanitizeNodeName` before assigning
 * it (`upperarm.l` -> `upperarml`). The `.glb` on disk still holds the dotted
 * name -- which is what `fighterModelContract.test.ts` asserts against, since
 * it reads the file's own JSON chunk rather than a loaded scene -- so the
 * contract keeps the authored names and the translation happens here, at the
 * one place a loaded scene is addressed by name.
 *
 * Deliberately three.js's own function rather than a local `replace(/\./g,
 * '')`: it is the exact rule `GLTFLoader` applied, so a future pack that
 * introduces some other reserved character (`[`, `]`, `:`, `/`, whitespace)
 * cannot drift the two apart.
 */
function loadedNodeName(contractName: string): string {
  return THREE.PropertyBinding.sanitizeNodeName(contractName)
}

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
      // Only the skinned parts: their drawn pose leaves the bind-pose bounds
      // three.js culls against, so culling them is wrong. A bone-parented prop
      // (weapon, shield, net, helmet) is an ordinary `Mesh` whose `matrixWorld`
      // does track where it is drawn, so its bounds are correct and it keeps
      // the culling.
      if ((object as THREE.SkinnedMesh).isSkinnedMesh) object.frustumCulled = false
    }
  })

  const bones = new Map<FighterBoneName, THREE.Object3D>()
  for (const name of FIGHTER_BONE_NAMES) {
    const bone = byName.get(loadedNodeName(name))
    if (!bone) throw new Error(`Model ${archetype} has no bone ${name}`)
    bones.set(name, bone)
  }
  const anchors = new Map<EquipmentAnchorName, THREE.Object3D>()
  for (const name of FIGHTER_ANCHOR_NAMES) {
    const node = byName.get(loadedNodeName(ANCHOR_NODE_NAMES[name]))
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
      // `SkeletonUtils.clone` gives every cloned `SkinnedMesh` its OWN
      // `Skeleton` (that is the whole reason it is used instead of
      // `Object3D.clone`), and a `Skeleton` owns a GPU bone texture allocated
      // on first render. Geometries and materials are shared with the source
      // GLTF and must stay alive; the per-instance skeletons must not, or
      // every disposed rig leaks one bone texture for the session.
      root.traverse((object) => {
        const skinned = object as THREE.SkinnedMesh
        if (skinned.isSkinnedMesh) skinned.skeleton?.dispose()
      })
      root.clear()
      disposed = true
    },
    isDisposed: () => disposed,
  }
}
