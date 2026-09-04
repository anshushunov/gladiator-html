/// <reference types="vite/client" />

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
