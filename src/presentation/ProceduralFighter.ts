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
   * Horizontal (ground-plane) reach of this fighter's actual built geometry in
   * the rest pose, measured off the real meshes (see
   * `computeHorizontalEquipmentRadius`) rather than off an anchor plus a
   * shield constant (brief resolution #7). Read by `ArenaCamera` group framing
   * via `ArenaView`; presentation-only and never fed back into simulation.
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

/**
 * A kit's equipment: a *kind* per slot, picking which geometry the builders
 * below assemble, plus the numbers that size it. Every per-archetype decision
 * lives here in `STYLE_SPECS`; no builder branches on the archetype id itself,
 * so a kit can be re-armed by editing values alone.
 */
interface EquipmentProportions {
  /** Which weapon to build. All three are modelled along the hand -> tip segment. */
  weaponKind: 'gladius' | 'spear' | 'trident'
  /** Hand-to-tip length: the weapon tip anchor sits exactly this far from the hand. */
  weaponLength: number
  /** The weapon's cross-section, read per kind: a blade's width, or a shaft's diameter. */
  weaponWidth: number
  /** The weapon's other cross-section: a blade's thickness, or the head/prongs' stoutness. */
  weaponThickness: number
  /**
   * Direction only: the share of the hand -> tip *direction* pointing forward
   * (+Z) rather than down (-Y); 0..1. Magnitude comes from `weaponLength`, so
   * changing the bias swings the weapon without shortening it.
   */
  weaponForwardBias: number
  /** Which shield to build, or `'none'` for a kit that carries none at all. */
  shieldKind: 'scutum' | 'parma' | 'none'
  /**
   * The off hand's footprint: the shield's when `shieldKind` is not `'none'`,
   * the `offhandProp`'s otherwise. A `'parma'` is an ellipse of these two
   * diameters; a `'scutum'` is a slab of this chord width and this height.
   */
  shieldWidth: number
  shieldHeight: number
  /**
   * How far a `'scutum'` wraps around its bearer: 0 is a flat slab, 1 the full
   * `SCUTUM_MAX_SWEEP` arc. Ignored by the other shield kinds, which are flat.
   */
  shieldCurvature: number
  shieldThickness: number
  shieldForwardOffset: number
  /** A helmet with a brim, optionally topped by a crest, or none at all. */
  helmetKind: 'brimmed-crested' | 'brimmed' | 'none'
  /** `'one-low'` guards the lead (left) shin only; `'two-high'` guards both, up to the knee. */
  greaves: 'none' | 'one-low' | 'two-high'
  /** A galerus rising off the off-hand shoulder. */
  shoulderGuard: boolean
  /** A held off-hand prop that is not a shield. Absent leaves the off hand empty. */
  offhandProp?: 'net'
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
    // Murmillo. Every element traces to a row of
    // `docs/reference/gladiator-equipment.md` §1; the scutum is the type's
    // "large positive prop" and carries the identity almost on its own.
    equipment: {
      weaponKind: 'gladius',
      weaponLength: 0.55,
      // The gladius is a short blade beside a shield that dwarfs it, so it is
      // never going to be the cue -- but at ~0.06 it was a hairline. Widened
      // enough to read as a blade rather than as a scratch.
      weaponWidth: 0.075,
      weaponThickness: 0.05,
      weaponForwardBias: 0.5,
      shieldKind: 'scutum',
      // Chord 0.72 x height 1.10 -- roughly knee-to-chin on a 1.74-tall rig,
      // the proportion the reliefs show. Curvature 0.75 of the 120-degree
      // maximum is a 90-degree wrap, the commonly reconstructed value; it
      // bows the slab ~0.15 forward, which is what makes the shield read as a
      // curved body rather than as a flat door at the shipped framing.
      shieldWidth: 0.72,
      shieldHeight: 1.10,
      shieldCurvature: 0.75,
      shieldThickness: 0.08,
      shieldForwardOffset: 0.12,
      helmetKind: 'brimmed-crested',
      // One short ocrea on the lead (shield-side, i.e. left) leg. The crest
      // and this single greave are the murmillo's two silhouette asymmetries.
      greaves: 'one-low',
      shoulderGuard: false,
      hasLightArmor: false,
    },
    // Deep violet-slate: the darkest of the three type values, and clear of
    // both the HUD's home red (#b34d3a) and away blue (#4383a0), so type and
    // side never argue. See the equipment bible's palette note.
    clothColor: 0x3d3358,
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
    // Retiarius. `docs/reference/gladiator-equipment.md` §3. The three
    // absences (no shield, no helmet, no greaves) are all attested, but
    // absence is a weak cue at 50-90 px, so the identity is carried by two
    // positive props: the net and the trident.
    equipment: {
      weaponKind: 'trident',
      // The fuscina is a polearm, not a short weapon: 0.50 made the most
      // heavily-armed silhouette of the three read as the emptiest. This is
      // hand-to-tip (the builder draws no butt behind the grip) and the
      // retiarius grips well up the shaft, so the drawn 1.15 sits below the
      // hoplomachus' 1.30 -- deliberately, so the two polearms differ in
      // length as well as in head, and the hoplomachus keeps the longest
      // reach his content already gives him.
      weaponLength: 1.15,
      weaponWidth: 0.07,
      // Prong stoutness. The head spans ~0.33 across three prongs -- drawn
      // wider than scale so the *fork* is what separates this polearm from
      // the hoplomachus' single-point spear, which is the slice's main
      // legibility risk.
      weaponThickness: 0.06,
      // Angled down-and-forward rather than levelled like the spear: two
      // polearms held at the same angle would read as the same weapon.
      weaponForwardBias: 0.70,
      shieldKind: 'none',
      // No shield, so these size the net's fall (see `buildOffhandProp`):
      // how far it spreads, its longest cord, and a cord's cross-section. Two
      // solid-box versions of this prop (flat, then near-cubic) both read as a
      // shield on screen, which is the one thing this type must not read as;
      // the shape is now cords with gaps, and these are its dimensions.
      shieldWidth: 0.42,
      shieldHeight: 0.78,
      shieldCurvature: 0,
      shieldThickness: 0.075,
      shieldForwardOffset: 0.08,
      helmetKind: 'none',
      greaves: 'none',
      // The galerus on the off-hand (left) shoulder -- the type's diagnostic
      // piece, and the asymmetry that reads even when the polearms do not.
      shoulderGuard: true,
      offhandProp: 'net',
      // No torso armour: the retiarius is the least-armoured man in the
      // arena, and a bronze chest band would blur exactly the "bare" read
      // that separates him from the hoplomachus.
      hasLightArmor: false,
    },
    // Pale undyed linen: the lightest of the three type values, so the pair
    // the polearms put at risk is separated by a full value swing.
    clothColor: 0xd8cfa8,
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
    // Hoplomachus. `docs/reference/gladiator-equipment.md` §2. The long level
    // spear line plus the tall pair of greaves; the small parma is a cue by
    // contrast with the murmillo's slab, not on its own.
    equipment: {
      weaponKind: 'spear',
      // Deliberately unchanged. `weaponLength` sets the `weaponTip` anchor,
      // from which `PoseController` derives its weapon-arm IK reach gate, and
      // that boundary is frozen by
      // `PoseController.test.ts`'s "gates the weapon-arm IK at a frozen reach
      // boundary" test. Nothing about this task needs the spear longer -- the
      // reported defect was that it was too thin to see, not too short.
      weaponLength: 1.30,
      // 0.045 landed at roughly two pixels at the shipped framing: a spear
      // that measured right and was invisible. Drawn far thicker than a real
      // shaft on purpose (equipment bible, "deliberate departures").
      weaponWidth: 0.08,
      // Head stoutness: a single leaf point ~0.18 across and ~0.21 long. Kept
      // narrower than the trident's fork, since one point versus three is the
      // whole distinction between the two polearms.
      weaponThickness: 0.055,
      weaponForwardBias: 0.95,
      shieldKind: 'parma',
      // A *small* round shield: 0.45 across, against the murmillo's
      // 0.72 x 1.10 slab. At 0.80 it was the same size class as the scutum
      // and the contrast that names both types was gone.
      shieldWidth: 0.45,
      shieldHeight: 0.45,
      shieldCurvature: 0,
      shieldThickness: 0.05,
      shieldForwardOffset: 0.10,
      // Brimmed, but no crest: the crest block is the murmillo's exclusive
      // crown cue. See the equipment bible's "attested but deliberately not
      // drawn" note -- this is a legibility omission, not a claim that the
      // hoplomachus' helmet was crestless.
      helmetKind: 'brimmed',
      // The tall pair, this type's most distinctive leg signature.
      greaves: 'two-high',
      shoulderGuard: false,
      hasLightArmor: false,
    },
    // Mid olive-green: the middle of the three type values.
    clothColor: 0x77914a,
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

// ---------------------------------------------------------------------------
// Equipment geometry
//
// One builder per slot, each branching on its own `EquipmentProportions` kind
// and never on the archetype id: re-arming a kit is authoring numbers in
// `STYLE_SPECS`, and only a genuinely new *kind* is a new case down here.
// ---------------------------------------------------------------------------

/** The arc a `shieldCurvature` of 1 wraps a scutum through. */
const SCUTUM_MAX_SWEEP = (2 * Math.PI) / 3

/** A flat elliptical disc facing forward (+Z), of the two given diameters. */
function createDiscGeometry(width: number, height: number, thickness: number): THREE.BufferGeometry {
  // Modelled as a unit cylinder about +Y, then laid face-forward and scaled to
  // the two diameters, so a round shield can also be authored as an oval.
  const geometry = new THREE.CylinderGeometry(0.5, 0.5, 1, 20)
  geometry.rotateX(Math.PI / 2)
  geometry.scale(width, height, thickness)
  return geometry
}

/**
 * A slab of `width` chord and `height`, bowed forward (+Z) about a vertical
 * axis -- the scutum's wrap around its bearer. A `curvature` of 0 degenerates
 * to a plain flat box rather than to a division by `sin(0)`.
 */
function createCurvedSlabGeometry(width: number, height: number, thickness: number, curvature: number): THREE.BufferGeometry {
  const sweep = Math.min(Math.max(curvature, 0), 1) * SCUTUM_MAX_SWEEP
  if (sweep < 1e-3) return new THREE.BoxGeometry(width, height, thickness)

  const half = sweep / 2
  const outer = width / 2 / Math.sin(half)
  const inner = Math.max(outer - thickness, outer * 0.5)
  // An annular sector centred on the shape plane's -Y, extruded along that
  // plane's normal, then tipped so the extrusion runs up the shield's height
  // and the sector's mid-point lands on the anchor with its bulge forward.
  const shape = new THREE.Shape()
  shape.absarc(0, 0, outer, -Math.PI / 2 - half, -Math.PI / 2 + half, false)
  shape.absarc(0, 0, inner, -Math.PI / 2 + half, -Math.PI / 2 - half, true)
  const geometry = new THREE.ExtrudeGeometry(shape, { depth: height, bevelEnabled: false, curveSegments: 16 })
  geometry.translate(0, outer, -height / 2)
  geometry.rotateX(-Math.PI / 2)
  return geometry
}

/**
 * The weapon, under `weaponHand`. Every kind is modelled along its own local
 * +Y and the whole assembly is then rotated onto the hand -> tip direction: a
 * box merely *long enough* to contain the tip still runs along the wrong axis,
 * and reads as a plank hanging off the fist rather than as a spear held out.
 */
function buildWeapon(
  owned: Owned,
  equipment: EquipmentProportions,
  weaponHand: THREE.Object3D,
  tipDirection: THREE.Vector3,
  bronze: THREE.Material,
  wood: THREE.Material,
): void {
  const shaft = new THREE.Group()
  shaft.name = 'weaponShaft'
  shaft.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), tipDirection)
  weaponHand.add(shaft)

  // `y` runs from 0 (the fist) to `weaponLength` (the tip). The full-length
  // part goes in first, so it is the mesh anything looking up "the weapon"
  // finds -- and that mesh's own local axis is the weapon's axis.
  const addPart = (geometry: THREE.BufferGeometry, material: THREE.Material, y: number, x = 0): void => {
    const mesh = new THREE.Mesh(trackedGeometry(owned, geometry), material)
    mesh.position.set(x, y, 0)
    mesh.userData.slot = 'weapon'
    shaft.add(mesh)
  }

  const { weaponLength: length, weaponWidth: width, weaponThickness: thickness } = equipment
  switch (equipment.weaponKind) {
    case 'gladius':
      addPart(new THREE.BoxGeometry(width, length * 0.82, thickness), bronze, length * 0.59)
      addPart(new THREE.BoxGeometry(width * 3.2, thickness, thickness * 1.8), bronze, length * 0.15)
      break
    case 'spear':
      addPart(new THREE.CylinderGeometry(width * 0.5, width * 0.5, length * 0.86, 8), wood, length * 0.43)
      addPart(new THREE.ConeGeometry(thickness * 1.6, length * 0.16, 8), bronze, length * 0.92)
      break
    case 'trident': {
      const prongLength = length * 0.22
      addPart(new THREE.CylinderGeometry(width * 0.5, width * 0.5, length - prongLength, 8), wood, (length - prongLength) / 2)
      for (const x of [-width * 1.8, 0, width * 1.8]) {
        addPart(new THREE.ConeGeometry(thickness * 0.7, prongLength, 6), bronze, length - prongLength / 2, x)
      }
      break
    }
  }
}

// ---------------------------------------------------------------------------
// Body-oriented attachments
//
// Everything held in a hand inherits that hand's rotation, and the combat poses
// swing the shield forearm through roughly 75 degrees. A shield authored as an
// upright slab therefore rendered lying *along* the forearm -- a plank jutting
// forward at shoulder height, covering no part of the body, at roughly 4:1
// wide-to-tall on screen. That was the Task 4 review's blocking finding, and it
// was confirmed over 120 ticks across two bouts and both facings, so it is not
// pose-dependent and no `STYLE_SPECS` value can right it: the tilt does not come
// from the shield.
//
// A body-oriented attachment is the fix. It follows its parent joint's world
// *position*, so the shield still travels with the hand, but takes its world
// *orientation* from the rig root, i.e. from where the fighter faces. A slab
// authored upright stays upright and keeps bowing around the body; a net
// authored hanging keeps hanging, instead of swinging up into the shield
// position it must never occupy.
//
// Both `Object3D` matrix entry points are overridden because Three.js uses them
// for different things: the renderer and this module's own
// `root.updateMatrixWorld(true)` go through `updateMatrixWorld`, while
// `Box3.setFromObject` goes through `updateWorldMatrix`. Overriding one and not
// the other would leave the measured bounds disagreeing with the drawn pixels.
// Neither override consults `matrixWorldNeedsUpdate`: this transform depends on
// an object that is *not* its parent, so a dirty flag on the local chain cannot
// tell it whether it is stale. It recomposes every time, which is two extra
// matrix compositions per fighter per frame.
// ---------------------------------------------------------------------------

const ATTACHMENT_POSITION = new THREE.Vector3()
const ATTACHMENT_ORIENTATION = new THREE.Quaternion()
const ATTACHMENT_UNIT_SCALE = new THREE.Vector3(1, 1, 1)
const ATTACHMENT_FRAME = new THREE.Matrix4()

function createBodyOrientedAttachment(name: string, orientationSource: THREE.Object3D): THREE.Group {
  const group = new THREE.Group()
  group.name = name

  const composeWorld = (): void => {
    if (group.parent) ATTACHMENT_POSITION.setFromMatrixPosition(group.parent.matrixWorld)
    else ATTACHMENT_POSITION.set(0, 0, 0)
    ATTACHMENT_ORIENTATION.setFromRotationMatrix(orientationSource.matrixWorld)
    ATTACHMENT_FRAME.compose(ATTACHMENT_POSITION, ATTACHMENT_ORIENTATION, ATTACHMENT_UNIT_SCALE)
    if (group.matrixAutoUpdate) group.updateMatrix()
    group.matrixWorld.multiplyMatrices(ATTACHMENT_FRAME, group.matrix)
    group.matrixWorldNeedsUpdate = false
  }

  group.updateMatrixWorld = function (): void {
    composeWorld()
    for (const child of this.children) child.updateMatrixWorld(true)
  }

  group.updateWorldMatrix = function (updateParents: boolean, updateChildren: boolean): void {
    if (updateParents && this.parent !== null) this.parent.updateWorldMatrix(true, false)
    composeWorld()
    if (updateChildren) for (const child of this.children) child.updateWorldMatrix(false, true)
  }

  return group
}

/** The shield, under `shieldCenter`. `'none'` builds no shield mesh at all. */
function buildShield(owned: Owned, equipment: EquipmentProportions, shieldCenter: THREE.Object3D, bronze: THREE.Material): void {
  if (equipment.shieldKind === 'none') return
  const geometry =
    equipment.shieldKind === 'scutum'
      ? createCurvedSlabGeometry(equipment.shieldWidth, equipment.shieldHeight, equipment.shieldThickness, equipment.shieldCurvature)
      : createDiscGeometry(equipment.shieldWidth, equipment.shieldHeight, equipment.shieldThickness)
  const mesh = new THREE.Mesh(trackedGeometry(owned, geometry), bronze)
  mesh.userData.slot = 'shield'
  shieldCenter.add(mesh)
}

/**
 * The fall of the net: each cord's drop as a share of the whole fall. The
 * lengths are deliberately unequal and deliberately not monotonic, because the
 * ragged bottom edge is the cue -- see `buildOffhandProp`.
 */
const NET_CORD_DROPS: readonly number[] = [1, 0.54, 0.83, 0.41]

/**
 * A held off-hand prop that is not a shield -- the Retiarius' net. Carried
 * rather than worn, so it is anchor-addressable like the shield it stands in
 * for.
 *
 * Drawn as a gathered head in the fist plus a fall of unequal cords, for one
 * reason: **a solid box reads as a board at every set of dimensions we tried.**
 * A flat 0.62 x 0.72 x 0.08 net read as a shield; re-authored near-cubic at
 * 0.50 x 0.50 x 0.45 it still read as a shield, and on the type whose entire
 * diagnostic is that he has none. Only a *broken outline* -- gaps between the
 * cords and an uneven hem -- reads as a net at 50-90 px. It also hangs from a
 * body-oriented attachment rather than from the hand's own frame, so it falls
 * under the fist instead of swinging up across the chest into the position a
 * shield occupies.
 */
function buildOffhandProp(
  owned: Owned,
  equipment: EquipmentProportions,
  offHand: THREE.Object3D,
  orientationSource: THREE.Object3D,
  wood: THREE.Material,
): void {
  if (equipment.offhandProp !== 'net') return

  const hang = createBodyOrientedAttachment('netHang', orientationSource)
  offHand.add(hang)

  // Read off the off-hand footprint fields: `shieldWidth` is how far the fall
  // spreads, `shieldHeight` the longest cord, `shieldThickness` a cord's
  // cross-section.
  const { shieldWidth: spread, shieldHeight: fall, shieldThickness: cord } = equipment

  const addPart = (geometry: THREE.BufferGeometry, x: number, y: number, z: number): void => {
    const mesh = new THREE.Mesh(trackedGeometry(owned, geometry), wood)
    mesh.position.set(x, y, z)
    mesh.userData.slot = 'net'
    hang.add(mesh)
  }

  // The gathered head, bunched in the fist. Goes in first, so it is the mesh
  // anything looking up "the net" finds.
  const headHeight = cord * 2.4
  addPart(new THREE.BoxGeometry(spread * 0.58, headHeight, spread * 0.46), 0, -headHeight / 2, 0)

  NET_CORD_DROPS.forEach((drop, index) => {
    const across = NET_CORD_DROPS.length === 1 ? 0 : index / (NET_CORD_DROPS.length - 1) - 0.5
    const length = fall * drop
    addPart(
      new THREE.BoxGeometry(cord, length, cord),
      across * spread,
      -headHeight - length / 2,
      (index % 2 === 0 ? 1 : -1) * cord * 0.9,
    )
  })
}

/**
 * The helmet: a dome and a brim, optionally topped by a crest. Worn, so it
 * parents to the `head` joint and is deliberately not anchor-addressable (see
 * `EquipmentAnchorName`).
 */
function buildHelmet(
  owned: Owned,
  equipment: EquipmentProportions,
  body: BodyProportions,
  head: THREE.Object3D,
  bronze: THREE.Material,
  wood: THREE.Material,
): void {
  if (equipment.helmetKind === 'none') return

  const domeGeometry = trackedGeometry(owned, new THREE.SphereGeometry(body.headRadius * 1.15, 12, 8, 0, Math.PI * 2, 0, Math.PI / 2))
  const dome = new THREE.Mesh(domeGeometry, bronze)
  dome.userData.slot = 'helmet'
  head.add(dome)

  const brimGeometry = trackedGeometry(owned, new THREE.CylinderGeometry(body.headRadius * 1.5, body.headRadius * 1.25, body.headRadius * 0.18, 16))
  const brim = new THREE.Mesh(brimGeometry, bronze)
  brim.position.y = -body.headRadius * 0.04
  brim.userData.slot = 'helmet'
  head.add(brim)

  if (equipment.helmetKind !== 'brimmed-crested') return

  // A semicircular comb sitting *on* the dome, front to back. The previous
  // crest was a 0.08 x 0.32 x 0.26 box floating a head-radius above the skull:
  // at the shipped framing it read as a pale rectangle hovering over the
  // helmet, and -- being the most tall-rectangle-shaped object on the fighter
  // -- it competed with the scutum for the cue the scutum is supposed to
  // carry (Task 4 review). Modelled as a half-cylinder whose axis is the
  // thickness, so its flat diameter beds into the dome and only the arc shows.
  const crestRadius = body.headRadius * 1.05
  const crestGeometry = trackedGeometry(
    owned,
    new THREE.CylinderGeometry(crestRadius, crestRadius, body.headRadius * 0.24, 14, 1, false, 0, Math.PI),
  )
  // Stands the half-disc up in the fighter's sagittal plane: the cylinder's
  // own axis becomes the crest's (thin) width, and its flat edge its base.
  crestGeometry.rotateZ(Math.PI / 2)
  const crest = new THREE.Mesh(crestGeometry, wood)
  crest.position.set(0, body.headRadius * 0.52, 0)
  crest.userData.slot = 'crest'
  head.add(crest)
}

/**
 * Shin armour, worn and parented to the leg it covers. Both kinds grow upward
 * from the ankle, so a low greave guards the shin and a high one reaches the
 * knee without either needing its own placement rule.
 */
function buildGreaves(
  owned: Owned,
  equipment: EquipmentProportions,
  body: BodyProportions,
  joints: ReadonlyMap<JointName, THREE.Object3D>,
  bronze: THREE.Material,
): void {
  if (equipment.greaves === 'none') return

  const high = equipment.greaves === 'two-high'
  const sides: readonly ('L' | 'R')[] = high ? ['L', 'R'] : ['L']
  const height = body.lowerLegLength * (high ? 0.85 : 0.55)

  for (const side of sides) {
    const lowerLeg = joints.get(`lowerLeg.${side}`)!
    const geometry = trackedGeometry(owned, new THREE.BoxGeometry(body.limbRadius * 2, height, body.limbRadius * 1.4))
    const greave = new THREE.Mesh(geometry, bronze)
    greave.position.set(0, -body.lowerLegLength + height / 2, body.limbRadius * 0.3)
    greave.userData.slot = 'greave'
    lowerLeg.add(greave)
  }
}

/**
 * A galerus rising off the off-hand (left) shoulder -- the shoulder a kit
 * without a shield turns toward its opponent. Worn, so it parents to the
 * shoulder joint.
 */
function buildShoulderGuard(
  owned: Owned,
  equipment: EquipmentProportions,
  body: BodyProportions,
  joints: ReadonlyMap<JointName, THREE.Object3D>,
  bronze: THREE.Material,
): void {
  if (!equipment.shoulderGuard) return

  // Broader than it is tall, and set well outboard. The first version was a
  // tall box rising `chestHeight * 0.18` above the shoulder: since the arena
  // camera looks *down*, the far shoulder projects upward on screen, so on
  // roughly half the facings it silhouetted over the crown and read as a
  // squared-off hat -- on the one type whose diagnostic is that he wears no
  // helmet (Task 4 review). A plate that stops short of the head and sits
  // clearly to the side of it reads as a pauldron from both facings.
  const shoulder = joints.get('shoulder.L')!
  const geometry = trackedGeometry(owned, new THREE.BoxGeometry(body.limbRadius * 3.4, body.chestHeight * 0.40, body.limbRadius * 2.6))
  const guard = new THREE.Mesh(geometry, bronze)
  guard.position.set(body.limbRadius * 1.35, -body.chestHeight * 0.04, 0)
  guard.userData.slot = 'shoulderGuard'
  shoulder.add(guard)
}

function buildEquipment(
  owned: Owned,
  spec: StyleSpec,
  joints: ReadonlyMap<JointName, THREE.Object3D>,
  anchors: Map<EquipmentAnchorName, THREE.Object3D>,
  /** The rig root, used only as the orientation source for the body-oriented off-hand attachments. */
  root: THREE.Object3D,
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

  // The bias picks a *direction* only; `weaponLength` sets how far along it
  // the tip sits, so a weapon stays exactly as long as it is authored to be
  // however it is angled -- and the tip anchor is the weapon's real point.
  const tipDirection = new THREE.Vector3(0, -(1 - equipment.weaponForwardBias), equipment.weaponForwardBias).normalize()

  buildWeapon(owned, equipment, weaponHand, tipDirection, bronze, wood)

  const weaponTip = new THREE.Group()
  weaponTip.name = 'weaponTip'
  weaponTip.position.copy(tipDirection).multiplyScalar(equipment.weaponLength)
  weaponHand.add(weaponTip)
  anchors.set('weaponTip', weaponTip)

  // offHand / shieldCenter -- the off (left) hand carries the shield, or
  // whatever a shieldless kit carries instead of one.
  const offHand = new THREE.Group()
  offHand.name = 'offHand'
  handL.add(offHand)
  anchors.set('offHand', offHand)

  // Both anchors exist for every kit, shield or no shield: the five anchor
  // names are a closed contract (see `EquipmentAnchorName`), and a kit that
  // carries nothing in that hand still has an off hand to address.
  //
  // Body-oriented (see `createBodyOrientedAttachment`): it travels with the
  // fist but stands the way the fighter stands, so `shieldForwardOffset` is a
  // step forward *for the fighter* and a shield authored upright is drawn
  // upright at every point of the pose cycle.
  const shieldCenter = createBodyOrientedAttachment('shieldCenter', root)
  shieldCenter.position.set(0, 0, equipment.shieldForwardOffset)
  offHand.add(shieldCenter)
  anchors.set('shieldCenter', shieldCenter)

  buildShield(owned, equipment, shieldCenter, bronze)
  buildOffhandProp(owned, equipment, offHand, root, wood)

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

  buildHelmet(owned, equipment, spec.body, head, bronze, wood)
  buildGreaves(owned, equipment, spec.body, joints, bronze)
  buildShoulderGuard(owned, equipment, spec.body, joints, bronze)

  if (equipment.hasLightArmor) {
    const strapGeometry = trackedGeometry(owned, new THREE.BoxGeometry(spec.body.torsoWidth * 0.7, spec.body.chestHeight * 0.35, spec.body.torsoDepth * 0.5))
    const strap = new THREE.Mesh(strapGeometry, bronze)
    strap.position.set(0, spec.body.chestHeight * 0.55, 0)
    strap.userData.slot = 'armor'
    chest.add(strap)
  }
}

/**
 * The rig's real ground-plane reach in the rest pose: the farthest any built
 * mesh's own world-space `Box3` corner gets from the rig's vertical axis.
 *
 * Measured off the actual geometry rather than off an anchor plus a shield
 * constant, because a kit can have no such constant -- the Retiarius carries
 * no shield at all -- and because the camera that frames a pair (`ArenaView`
 * -> `ArenaCamera`) has to see the reach that is genuinely on screen. Every
 * slotted mesh counts, body as well as equipment: a shieldless fighter's own
 * shoulders and feet can out-reach what little he carries, and the framing
 * still has to contain them.
 */
function computeHorizontalEquipmentRadius(root: THREE.Group): number {
  root.updateMatrixWorld(true)

  const box = new THREE.Box3()
  let radius = 0
  root.traverse((object) => {
    if (!object.userData.slot) return
    box.setFromObject(object)
    // All four horizontal corners, not just (min,min) and (max,max): the
    // farthest corner of an axis-aligned box is just as often the mixed pair.
    // A box over x in [-1.0, -0.9], z in [0.9, 1.0] is 1.414 out at
    // (min.x, max.z) but only 1.345 at either matched corner -- and this
    // radius is what the camera frames a pair by, so under-reporting it
    // frames closer than is safe. Do not "simplify" this back to two corners.
    for (const x of [box.min.x, box.max.x]) {
      for (const z of [box.min.z, box.max.z]) {
        radius = Math.max(radius, Math.hypot(x, z))
      }
    }
  })
  return radius
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
  buildEquipment(owned, spec, joints, anchors, root)

  const horizontalEquipmentRadius = computeHorizontalEquipmentRadius(root)

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
