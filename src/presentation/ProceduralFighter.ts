// Shared procedural humanoid rig: one semantic joint hierarchy, primitive
// body/equipment builders, and disposal, reused by all three styles.
//
// This module owns:
// - `JointName`/`SEMANTIC_JOINT_NAMES` and `EquipmentAnchorName`/
//   `EQUIPMENT_ANCHOR_NAMES`, the fixed semantic contract every style's rig
//   satisfies exactly (Task 15 brief resolutions #1/#2). A later imported
//   skeletal model can reuse this same joint/anchor vocabulary.
// - `createProceduralFighter`, which builds the joint graph (Three.js
//   `Group`s, no meshes) plus per-style primitive body meshes and equipment
//   (attached only under the weapon/shield anchors), and returns a handle
//   with `dispose()`/`isDisposed()`.
// - `measureSilhouetteExtent`, a small helper over a built fighter's actual
//   `THREE.Box3` used to prove the three styles are visually distinguishable
//   as single-colour silhouettes (design.md's "Procedural humanoid rig").
//
// Pose *data* (immutable joint-transform dictionaries the future
// `PoseController` samples) lives in `./poses/combatPoses.ts`, not here: this
// file only ever builds the rest-pose rig. Equipment/contact anchors are
// presentation-only and never enter encounter state (they carry no collision
// and are never read by `src/simulation/**`).
//
// Vitest runs headlessly (no WebGL): everything here is renderer-free --
// `Object3D` graph construction, `updateMatrixWorld`, and `Box3` all work
// without a `WebGLRenderer` or canvas.

import * as THREE from 'three'
import type { Archetype } from '../simulation/fighters'

// ---------------------------------------------------------------------------
// Semantic contract
// ---------------------------------------------------------------------------

export type JointName =
  | 'root'
  | 'pelvis'
  | 'torso'
  | 'chest'
  | 'neck'
  | 'head'
  | 'headTop'
  | 'shoulder.L'
  | 'upperArm.L'
  | 'forearm.L'
  | 'hand.L'
  | 'shoulder.R'
  | 'upperArm.R'
  | 'forearm.R'
  | 'hand.R'
  | 'upperLeg.L'
  | 'lowerLeg.L'
  | 'foot.L'
  | 'upperLeg.R'
  | 'lowerLeg.R'
  | 'foot.R'

/**
 * `'root'` stays in this vocabulary (a future imported skeletal model's own
 * root bone can still be addressed by the same name) but is deliberately
 * *not* a key of any built `ProceduralFighter.joints` map -- see
 * `createProceduralFighter`'s comment at the `root` `Group` below for why.
 * Every pose-application loop elsewhere (`ArenaView.applyPoseToJoints`,
 * `PoseController.applyPoseToRig`) already does `fighter.joints.get(name)`
 * followed by `if (!joint) continue`, so omitting `'root'` from the joints
 * map -- rather than special-casing it in every one of those loops -- makes
 * "a pose silently overwrites the rig's world facing" structurally
 * impossible: there is no joint object left for any pose data to reach.
 * This was exactly how the facing bug happened (Task 19 human-review
 * finding): `applyPoseToJoints` zeroed the root's yaw the instant it hit
 * `'root'` in this list, once per frame, because `root` used to be both the
 * rig's world-placement `Group` *and* a joint entry pose data could write.
 */
export const SEMANTIC_JOINT_NAMES: readonly JointName[] = [
  'root',
  'pelvis',
  'torso',
  'chest',
  'neck',
  'head',
  'headTop',
  'shoulder.L',
  'upperArm.L',
  'forearm.L',
  'hand.L',
  'shoulder.R',
  'upperArm.R',
  'forearm.R',
  'hand.R',
  'upperLeg.L',
  'lowerLeg.L',
  'foot.L',
  'upperLeg.R',
  'lowerLeg.R',
  'foot.R',
]

/**
 * The five equipment/contact anchors govern only the things a consumer must
 * be able to *discover and address* by name: the weapon (`weaponHand`,
 * `weaponTip`), the shield (`offHand`, `shieldCenter`), and the general
 * body-hit target (`hitCenter`) that contact-resolution zones map onto
 * (design.md's "Presentation only adds an authored height and maps it to a
 * rig anchor"). That is a closed, exact five -- the Step 1 rig test pins
 * this literal set, and a later imported skeletal model reuses the same
 * five names, so it is not extended for new equipment categories.
 *
 * Worn body decoration that nothing needs to address individually --
 * Heavy's helmet/crest, Fast's light-armor strap -- is deliberately *not*
 * anchor-addressable. It parents directly to its own semantic body joint
 * (`head`, `chest`; see `buildEquipment`'s `hasHelmet`/`hasLightArmor`
 * branches) like any other body-fixed mesh. Do not "fix" this by adding a
 * sixth anchor (e.g. a `helmetMount`) for it: none of the five anchors is a
 * sane parent for worn decoration (`hitCenter` is a hit target, not a
 * mounting point), and doing so would break the Step 1 test's exact
 * five-anchor assertion. `ProceduralFighter.test.ts`'s "attaches weapon/
 * shield equipment only under their anchors, and worn decoration only under
 * its body joint" test pins both halves of this split.
 */
export type EquipmentAnchorName = 'weaponHand' | 'offHand' | 'weaponTip' | 'shieldCenter' | 'hitCenter'

export const EQUIPMENT_ANCHOR_NAMES: readonly EquipmentAnchorName[] = [
  'weaponHand',
  'offHand',
  'weaponTip',
  'shieldCenter',
  'hitCenter',
]

export interface ProceduralFighterOptions {
  archetype: Archetype
}

export interface ProceduralFighter {
  /**
   * World placement (position + facing yaw) only -- owned exclusively by
   * `ArenaView`, which derives it every frame from `lerp(previousTick,
   * currentTick, alpha)` (design.md). Deliberately not reachable via `joints`
   * (see `SEMANTIC_JOINT_NAMES`'s doc comment): a pose describes body
   * configuration, never world placement, so nothing that samples a pose by
   * semantic joint name should be able to touch this transform at all.
   */
  root: THREE.Group
  joints: ReadonlyMap<JointName, THREE.Object3D>
  anchors: ReadonlyMap<EquipmentAnchorName, THREE.Object3D>
  /**
   * Style-authored horizontal (ground-plane) reach of this fighter's actual
   * built equipment, derived from the anchors' rest-pose world positions
   * (brief resolution #7). Read later by `ArenaCamera` group framing
   * (Task 17); presentation-only and never fed back into simulation.
   */
  horizontalEquipmentRadius: number
  dispose(): void
  isDisposed(): boolean
}

// ---------------------------------------------------------------------------
// Style proportions
//
// Bone lengths/widths and equipment extents differ per style; joint *names*
// and the hierarchy they attach to never do (brief resolution #1). Numbers
// are authored world units on the same scale as `src/simulation/movement.ts`
// arena distances (a fighter is roughly 1.7-1.9 units tall).
// ---------------------------------------------------------------------------

interface BodyProportions {
  upperLegLength: number
  lowerLegLength: number
  footLength: number
  hipWidth: number
  torsoHeight: number // pelvis -> torso
  chestHeight: number // torso -> chest
  neckHeight: number
  headHeight: number // neck -> head
  headTopHeight: number // head -> headTop
  shoulderWidth: number
  shoulderY: number // chest -> shoulder, vertical
  upperArmLength: number
  forearmLength: number
  handLength: number
  torsoWidth: number
  torsoDepth: number
  pelvisWidth: number
  pelvisDepth: number
  limbRadius: number
  headRadius: number
}

interface EquipmentProportions {
  shieldRadius: number
  shieldThickness: number
  shieldForwardOffset: number
  weaponLength: number
  weaponWidth: number
  weaponThickness: number
  /** Fraction of `weaponLength` projected onto the forward (+Z) axis vs down (-Y); 0..1. */
  weaponForwardBias: number
  hasHelmet: boolean
  hasLightArmor: boolean
}

interface StyleSpec {
  body: BodyProportions
  equipment: EquipmentProportions
  clothColor: number
}

const STYLE_SPECS: Readonly<Record<Archetype, StyleSpec>> = {
  heavy: {
    body: {
      upperLegLength: 0.42,
      lowerLegLength: 0.40,
      footLength: 0.28,
      hipWidth: 0.22,
      torsoHeight: 0.22,
      chestHeight: 0.30,
      neckHeight: 0.10,
      headHeight: 0.16,
      headTopHeight: 0.14,
      shoulderWidth: 0.34,
      shoulderY: 0.22,
      upperArmLength: 0.30,
      forearmLength: 0.28,
      handLength: 0.12,
      torsoWidth: 0.50,
      torsoDepth: 0.32,
      pelvisWidth: 0.34,
      pelvisDepth: 0.26,
      limbRadius: 0.10,
      headRadius: 0.16,
    },
    equipment: {
      shieldRadius: 0.55,
      shieldThickness: 0.08,
      shieldForwardOffset: 0.10,
      weaponLength: 0.55,
      weaponWidth: 0.06,
      weaponThickness: 0.05,
      weaponForwardBias: 0.5,
      hasHelmet: true,
      hasLightArmor: false,
    },
    clothColor: 0xb83b34,
  },
  fast: {
    body: {
      upperLegLength: 0.46,
      lowerLegLength: 0.44,
      footLength: 0.26,
      hipWidth: 0.16,
      torsoHeight: 0.20,
      chestHeight: 0.26,
      neckHeight: 0.09,
      headHeight: 0.14,
      headTopHeight: 0.12,
      shoulderWidth: 0.24,
      shoulderY: 0.20,
      upperArmLength: 0.28,
      forearmLength: 0.27,
      handLength: 0.11,
      torsoWidth: 0.34,
      torsoDepth: 0.22,
      pelvisWidth: 0.24,
      pelvisDepth: 0.18,
      limbRadius: 0.075,
      headRadius: 0.13,
    },
    equipment: {
      shieldRadius: 0.28,
      shieldThickness: 0.06,
      shieldForwardOffset: 0.08,
      weaponLength: 0.50,
      weaponWidth: 0.05,
      weaponThickness: 0.04,
      weaponForwardBias: 0.5,
      hasHelmet: false,
      hasLightArmor: true,
    },
    clothColor: 0x2a6f8e,
  },
  technical: {
    body: {
      upperLegLength: 0.50,
      lowerLegLength: 0.48,
      footLength: 0.27,
      hipWidth: 0.18,
      torsoHeight: 0.24,
      chestHeight: 0.30,
      neckHeight: 0.11,
      headHeight: 0.15,
      headTopHeight: 0.13,
      shoulderWidth: 0.27,
      shoulderY: 0.22,
      upperArmLength: 0.32,
      forearmLength: 0.30,
      handLength: 0.12,
      torsoWidth: 0.38,
      torsoDepth: 0.24,
      pelvisWidth: 0.26,
      pelvisDepth: 0.20,
      limbRadius: 0.08,
      headRadius: 0.14,
    },
    equipment: {
      shieldRadius: 0.40,
      shieldThickness: 0.07,
      shieldForwardOffset: 0.10,
      weaponLength: 1.30,
      weaponWidth: 0.045,
      weaponThickness: 0.045,
      weaponForwardBias: 0.95,
      hasHelmet: false,
      hasLightArmor: false,
    },
    clothColor: 0x4f6b3d,
  },
}

// ---------------------------------------------------------------------------
// Rig construction
// ---------------------------------------------------------------------------

const SKIN_COLOR = 0x9c6244
const BRONZE_COLOR = 0x6f4a2a
const WOOD_COLOR = 0x8a6b3f
const OUTLINE_COLOR = 0x0c0a10
const RIM_SCALE = 1.05

interface Owned {
  geometries: THREE.BufferGeometry[]
  materials: THREE.Material[]
  /** One shared unlit back-face material for every rim outline in this fighter instance (see `addRimOutline`). */
  outlineMaterial: THREE.Material
}

function trackedMaterial(owned: Owned, material: THREE.Material): THREE.Material {
  owned.materials.push(material)
  return material
}

function trackedGeometry<T extends THREE.BufferGeometry>(owned: Owned, geometry: T): T {
  owned.geometries.push(geometry)
  return geometry
}

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

/**
 * Adds a capsule "bone" mesh spanning from `joint` toward its child by
 * `length`, along `direction` (`-1` down, the default, for arms/legs whose
 * child joint sits below in the rest pose; `+1` up, for the neck, whose
 * child `head` sits above `chest`).
 */
function addCapsuleBone(
  owned: Owned,
  joint: THREE.Object3D,
  length: number,
  radius: number,
  material: THREE.Material,
  slot: string,
  direction: 1 | -1 = -1,
): THREE.Mesh {
  const cylinderLength = Math.max(length - radius * 2, 0.01)
  const geometry = trackedGeometry(owned, new THREE.CapsuleGeometry(radius, cylinderLength, 4, 8))
  const mesh = new THREE.Mesh(geometry, material)
  mesh.position.set(0, direction * (length / 2), 0)
  mesh.userData.slot = slot
  joint.add(mesh)
  return mesh
}

function addSphere(
  owned: Owned,
  joint: THREE.Object3D,
  radius: number,
  material: THREE.Material,
  slot: string,
): THREE.Mesh {
  const geometry = trackedGeometry(owned, new THREE.SphereGeometry(radius, 12, 8))
  const mesh = new THREE.Mesh(geometry, material)
  mesh.userData.slot = slot
  joint.add(mesh)
  addRimOutline(owned, joint, mesh)
  return mesh
}

/**
 * A cheap duplicate-geometry rim outline: the same geometry, scaled slightly
 * larger, rendered back-face-only in a near-black unlit material. This keeps
 * silhouettes readable against the floor without a post-processing pipeline
 * (design.md's "Arena, camera, and effects" section). Every rim outline in
 * one fighter instance shares `owned.outlineMaterial` -- there is nothing
 * style- or mesh-specific about an unlit black back-face material, so
 * allocating a fresh one per outlined mesh would just be extra tracked
 * objects to dispose for no visual difference.
 */
function addRimOutline(owned: Owned, joint: THREE.Object3D, sourceMesh: THREE.Mesh): THREE.Mesh {
  const outline = new THREE.Mesh(sourceMesh.geometry, owned.outlineMaterial)
  outline.position.copy(sourceMesh.position)
  outline.scale.setScalar(RIM_SCALE)
  outline.userData.slot = 'rim'
  joint.add(outline)
  return outline
}

function addJoint(joints: Map<JointName, THREE.Object3D>, name: JointName, parent: THREE.Object3D, y: number, x = 0, z = 0): THREE.Group {
  const group = new THREE.Group()
  group.name = name
  group.position.set(x, y, z)
  parent.add(group)
  joints.set(name, group)
  return group
}

function buildLimb(
  owned: Owned,
  joints: Map<JointName, THREE.Object3D>,
  side: 'L' | 'R',
  parent: THREE.Object3D,
  x: number,
  y: number,
  body: BodyProportions,
  material: THREE.Material,
): void {
  const shoulder = addJoint(joints, `shoulder.${side}`, parent, y, x, 0)
  const upperArm = addJoint(joints, `upperArm.${side}`, shoulder, 0)
  addCapsuleBone(owned, upperArm, body.upperArmLength, body.limbRadius * 0.9, material, 'limb')
  const forearm = addJoint(joints, `forearm.${side}`, upperArm, -body.upperArmLength)
  addCapsuleBone(owned, forearm, body.forearmLength, body.limbRadius * 0.75, material, 'limb')
  const hand = addJoint(joints, `hand.${side}`, forearm, -body.forearmLength)
  addSphere(owned, hand, body.limbRadius * 0.8, material, 'limb')
}

function buildLeg(
  owned: Owned,
  joints: Map<JointName, THREE.Object3D>,
  side: 'L' | 'R',
  parent: THREE.Object3D,
  x: number,
  body: BodyProportions,
  material: THREE.Material,
): void {
  const upperLeg = addJoint(joints, `upperLeg.${side}`, parent, 0, x, 0)
  addCapsuleBone(owned, upperLeg, body.upperLegLength, body.limbRadius, material, 'limb')
  const lowerLeg = addJoint(joints, `lowerLeg.${side}`, upperLeg, -body.upperLegLength)
  addCapsuleBone(owned, lowerLeg, body.lowerLegLength, body.limbRadius * 0.85, material, 'limb')
  const foot = addJoint(joints, `foot.${side}`, lowerLeg, -body.lowerLegLength)
  // Lengthened beyond the style's own footLength and shifted so the heel
  // sits almost directly under the ankle and nearly the whole box reaches
  // forward -- a Z-centred foot reads identically from front and back, which
  // is half of why a back view is mistaken for a face-on view. The original
  // (bare footLength, quarter-length offset) fix was correct in construction
  // but too small a silhouette change to survive the arena's shipped framing
  // distance (Task 7's motion-check finding); this is the same asymmetry,
  // scaled up until it reads as a distinct forward-pointing shape rather
  // than a few centred pixels.
  const footDepth = body.footLength * 1.4
  addBoxSegment(owned, foot, body.limbRadius * 1.7, body.limbRadius * 0.75, footDepth, material, 'limb', footDepth * 0.42)
}

function buildEquipment(
  owned: Owned,
  archetype: Archetype,
  spec: StyleSpec,
  joints: ReadonlyMap<JointName, THREE.Object3D>,
  anchors: Map<EquipmentAnchorName, THREE.Object3D>,
): void {
  const { equipment } = spec
  const bronze = trackedMaterial(owned, new THREE.MeshStandardMaterial({ color: BRONZE_COLOR, metalness: 0.7, roughness: 0.35 }))
  const wood = trackedMaterial(owned, new THREE.MeshStandardMaterial({ color: WOOD_COLOR, roughness: 0.8 }))

  const handR = joints.get('hand.R')!
  const handL = joints.get('hand.L')!
  const chest = joints.get('chest')!
  const head = joints.get('head')!

  // weaponHand / weaponTip -- the dominant (right) hand always carries the
  // style's weapon, anchored only to these two anchor points.
  const weaponHand = new THREE.Group()
  weaponHand.name = 'weaponHand'
  handR.add(weaponHand)
  anchors.set('weaponHand', weaponHand)

  const forwardZ = equipment.weaponLength * equipment.weaponForwardBias
  const downY = -equipment.weaponLength * (1 - equipment.weaponForwardBias)
  const tipLocal: readonly [number, number, number] = [0, downY, forwardZ]

  const weaponGeometry = trackedGeometry(owned, new THREE.BoxGeometry(equipment.weaponWidth, equipment.weaponLength, equipment.weaponThickness))
  const weaponMesh = new THREE.Mesh(weaponGeometry, bronze)
  weaponMesh.position.set(tipLocal[0] / 2, tipLocal[1] / 2, tipLocal[2] / 2)
  weaponMesh.userData.slot = 'weapon'
  weaponHand.add(weaponMesh)

  const weaponTip = new THREE.Group()
  weaponTip.name = 'weaponTip'
  weaponTip.position.set(...tipLocal)
  weaponHand.add(weaponTip)
  anchors.set('weaponTip', weaponTip)

  if (archetype === 'technical') {
    const tipGeometry = trackedGeometry(owned, new THREE.ConeGeometry(equipment.weaponThickness * 1.6, 0.12, 8))
    const tipMesh = new THREE.Mesh(tipGeometry, bronze)
    tipMesh.userData.slot = 'weapon'
    weaponTip.add(tipMesh)
  }

  // offHand / shieldCenter -- the off (left) hand carries the shield.
  const offHand = new THREE.Group()
  offHand.name = 'offHand'
  handL.add(offHand)
  anchors.set('offHand', offHand)

  const shieldCenter = new THREE.Group()
  shieldCenter.name = 'shieldCenter'
  shieldCenter.position.set(0, 0, equipment.shieldForwardOffset)
  offHand.add(shieldCenter)
  anchors.set('shieldCenter', shieldCenter)

  const shieldGeometry = trackedGeometry(
    owned,
    new THREE.CylinderGeometry(equipment.shieldRadius, equipment.shieldRadius, equipment.shieldThickness, 20),
  )
  const shieldMesh = new THREE.Mesh(shieldGeometry, bronze)
  shieldMesh.rotation.x = Math.PI / 2
  shieldMesh.userData.slot = 'shield'
  shieldCenter.add(shieldMesh)

  // hitCenter -- contact marker only, no equipment mesh of its own.
  const hitCenter = new THREE.Group()
  hitCenter.name = 'hitCenter'
  hitCenter.position.set(0, spec.body.chestHeight * 0.5, spec.body.torsoDepth * 0.5)
  chest.add(hitCenter)
  anchors.set('hitCenter', hitCenter)

  // Front-versus-back carried by value inside the fighter's own house colour.
  // A third hue would compete with the red/blue that already separates the two
  // fighters from each other. The back gets the mirror-image treatment
  // (darkened, not left at the base cloth colour) so the two sides span a
  // full light-to-dark range instead of a one-sided nudge -- doubling the
  // contrast available for the same silhouette cost, and legible even when
  // the shield hides the front (a shield never covers the back).
  const plateGeometry = trackedGeometry(owned, new THREE.BoxGeometry(spec.body.torsoWidth * 0.72, spec.body.chestHeight * 0.62, spec.body.torsoDepth * 0.32))
  const lightenedHouseColor = new THREE.Color(spec.clothColor).lerp(new THREE.Color(0xffffff), 0.35)
  const plate = new THREE.Mesh(plateGeometry, trackedMaterial(owned, new THREE.MeshStandardMaterial({ color: lightenedHouseColor, metalness: 0.35, roughness: 0.45 })))
  plate.position.set(0, spec.body.chestHeight * 0.5, spec.body.torsoDepth * 0.5)
  plate.userData.slot = 'breastplate'
  chest.add(plate)

  const backplateGeometry = trackedGeometry(owned, new THREE.BoxGeometry(spec.body.torsoWidth * 0.72, spec.body.chestHeight * 0.62, spec.body.torsoDepth * 0.32))
  const darkenedHouseColor = new THREE.Color(spec.clothColor).lerp(new THREE.Color(0x000000), 0.35)
  const backplate = new THREE.Mesh(backplateGeometry, trackedMaterial(owned, new THREE.MeshStandardMaterial({ color: darkenedHouseColor, metalness: 0.35, roughness: 0.45 })))
  backplate.position.set(0, spec.body.chestHeight * 0.5, -spec.body.torsoDepth * 0.5)
  backplate.userData.slot = 'backplate'
  chest.add(backplate)

  if (equipment.hasHelmet) {
    const domeGeometry = trackedGeometry(owned, new THREE.SphereGeometry(spec.body.headRadius * 1.15, 12, 8, 0, Math.PI * 2, 0, Math.PI / 2))
    const dome = new THREE.Mesh(domeGeometry, bronze)
    dome.userData.slot = 'helmet'
    head.add(dome)
    const crestGeometry = trackedGeometry(owned, new THREE.BoxGeometry(0.08, 0.32, spec.body.headRadius * 1.6))
    const crest = new THREE.Mesh(crestGeometry, wood)
    crest.position.set(0, spec.body.headRadius * 1.4, 0)
    crest.userData.slot = 'crest'
    head.add(crest)
  }

  if (equipment.hasLightArmor) {
    const strapGeometry = trackedGeometry(owned, new THREE.BoxGeometry(spec.body.torsoWidth * 0.7, spec.body.chestHeight * 0.35, spec.body.torsoDepth * 0.5))
    const strap = new THREE.Mesh(strapGeometry, bronze)
    strap.position.set(0, spec.body.chestHeight * 0.55, 0)
    strap.userData.slot = 'armor'
    chest.add(strap)
  }
}

function computeHorizontalEquipmentRadius(root: THREE.Group, anchors: ReadonlyMap<EquipmentAnchorName, THREE.Object3D>, equipment: EquipmentProportions): number {
  root.updateMatrixWorld(true)

  const weaponTipWorld = new THREE.Vector3()
  anchors.get('weaponTip')!.getWorldPosition(weaponTipWorld)
  const weaponReach = Math.sqrt(weaponTipWorld.x * weaponTipWorld.x + weaponTipWorld.z * weaponTipWorld.z)

  const shieldWorld = new THREE.Vector3()
  anchors.get('shieldCenter')!.getWorldPosition(shieldWorld)
  const shieldHandReach = Math.sqrt(shieldWorld.x * shieldWorld.x + shieldWorld.z * shieldWorld.z)
  const shieldReach = shieldHandReach + equipment.shieldRadius

  return Math.max(weaponReach, shieldReach)
}

export function createProceduralFighter(options: ProceduralFighterOptions): ProceduralFighter {
  const spec = STYLE_SPECS[options.archetype]
  const body = spec.body
  const outlineMaterial = new THREE.MeshBasicMaterial({ color: OUTLINE_COLOR, side: THREE.BackSide })
  const owned: Owned = { geometries: [], materials: [outlineMaterial], outlineMaterial }

  const skin = trackedMaterial(owned, new THREE.MeshStandardMaterial({ color: SKIN_COLOR, roughness: 0.9 }))
  const cloth = trackedMaterial(owned, new THREE.MeshStandardMaterial({ color: spec.clothColor, roughness: 0.85 }))

  const joints = new Map<JointName, THREE.Object3D>()

  const root = new THREE.Group()
  root.name = 'root'
  // Deliberately never `joints.set('root', root)`: the root Group carries
  // this fighter's world placement (position + facing), which `ArenaView`
  // sets every frame from interpolated simulation state, never from pose
  // data. Registering it as an ordinary semantic joint used to make it
  // reachable from `SEMANTIC_JOINT_NAMES`-driven pose-application loops,
  // which zeroed the facing every frame the instant any pose sample walked
  // that list (no authored pose in `poses/combatPoses.ts` defines a `root`
  // entry, so `PoseController.buildFullPose` always filled it with the
  // identity transform). `'root'` stays in `SEMANTIC_JOINT_NAMES` itself
  // (see that constant's own comment) as vocabulary only; this rig simply
  // has no joint object under that name for any pose to reach.

  const groundY = body.upperLegLength + body.lowerLegLength
  const pelvis = addJoint(joints, 'pelvis', root, groundY)
  const torso = addJoint(joints, 'torso', pelvis, body.torsoHeight)
  const chest = addJoint(joints, 'chest', torso, body.chestHeight)
  const neck = addJoint(joints, 'neck', chest, body.neckHeight)
  const head = addJoint(joints, 'head', neck, body.headHeight)
  addJoint(joints, 'headTop', head, body.headTopHeight)

  addBoxSegment(owned, pelvis, body.pelvisWidth, body.torsoHeight, body.pelvisDepth, cloth, 'cloth')
  addBoxSegment(owned, torso, body.torsoWidth, body.chestHeight, body.torsoDepth, cloth, 'cloth')
  addCapsuleBone(owned, chest, body.neckHeight, body.limbRadius * 0.6, skin, 'skin', 1)
  addSphere(owned, head, body.headRadius, skin, 'skin')

  // A dark slot across the front of the head. Deliberately geometry, not just
  // colour: it has to read as a front at the arena's framing distance, where
  // the whole head is a few pixels wide. Sized to actually punch through the
  // head sphere's own silhouette rather than sit almost flush with it --
  // the original box (forward face barely past the sphere's surface) was
  // correctly built but too shallow a protrusion to survive downsampling to
  // that size (Task 7's motion-check finding); wider (near the head's own
  // diameter, wrapping toward both temples) and noticeably deeper fixes that.
  const visorGeometry = trackedGeometry(owned, new THREE.BoxGeometry(spec.body.headRadius * 1.9, spec.body.headRadius * 0.6, spec.body.headRadius * 0.75))
  const visor = new THREE.Mesh(visorGeometry, trackedMaterial(owned, new THREE.MeshStandardMaterial({ color: 0x11151c, roughness: 0.6 })))
  visor.position.set(0, spec.body.headRadius * 0.05, spec.body.headRadius * 0.85)
  visor.userData.slot = 'visor'
  head.add(visor)

  buildLimb(owned, joints, 'L', chest, body.shoulderWidth, body.shoulderY, body, skin)
  buildLimb(owned, joints, 'R', chest, -body.shoulderWidth, body.shoulderY, body, skin)
  buildLeg(owned, joints, 'L', pelvis, body.hipWidth, body, cloth)
  buildLeg(owned, joints, 'R', pelvis, -body.hipWidth, body, cloth)

  const anchors = new Map<EquipmentAnchorName, THREE.Object3D>()
  buildEquipment(owned, options.archetype, spec, joints, anchors)

  const horizontalEquipmentRadius = computeHorizontalEquipmentRadius(root, anchors, spec.equipment)

  let disposed = false

  return {
    root,
    joints,
    anchors,
    horizontalEquipmentRadius,
    dispose(): void {
      if (disposed) return
      for (const geometry of owned.geometries) geometry.dispose()
      for (const material of owned.materials) material.dispose()
      root.clear()
      disposed = true
    },
    isDisposed(): boolean {
      return disposed
    },
  }
}

// ---------------------------------------------------------------------------
// Silhouette measurement
// ---------------------------------------------------------------------------

export interface SilhouetteExtent {
  width: number
  height: number
  depth: number
  horizontalEquipmentRadius: number
}

/**
 * The built fighter's real ground-plane/vertical extent (`THREE.Box3` over
 * every mesh under `root`, including equipment), used to prove the three
 * styles are distinguishable as a single-colour silhouette (design.md's
 * "Procedural humanoid rig" section) with an actual numeric comparison
 * rather than a check that three objects are non-identical references.
 */
export function measureSilhouetteExtent(fighter: ProceduralFighter): SilhouetteExtent {
  fighter.root.updateMatrixWorld(true)
  const box = new THREE.Box3().setFromObject(fighter.root)
  const size = new THREE.Vector3()
  box.getSize(size)
  return {
    width: size.x,
    height: size.y,
    depth: size.z,
    horizontalEquipmentRadius: fighter.horizontalEquipmentRadius,
  }
}
