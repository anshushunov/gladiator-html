import * as THREE from 'three'
import { describe, expect, it, vi } from 'vitest'
import type { Archetype } from '../simulation/fighters'
import {
  createProceduralFighter,
  EQUIPMENT_ANCHOR_NAMES,
  measureSilhouetteExtent,
  SEMANTIC_JOINT_NAMES,
  type JointName,
} from './ProceduralFighter'

const ARCHETYPES: readonly Archetype[] = ['heavy', 'fast', 'technical']

// Independently transcribed from design.md's "Procedural humanoid rig" tree
// (and the brief's exact hierarchy resolution) rather than imported from the
// implementation, so this test actually proves the built graph matches the
// spec instead of only proving it agrees with itself.
const EXPECTED_PARENT: Readonly<Record<JointName, JointName | null>> = {
  root: null,
  pelvis: 'root',
  torso: 'pelvis',
  chest: 'torso',
  neck: 'chest',
  head: 'neck',
  headTop: 'head',
  'shoulder.L': 'chest',
  'upperArm.L': 'shoulder.L',
  'forearm.L': 'upperArm.L',
  'hand.L': 'forearm.L',
  'shoulder.R': 'chest',
  'upperArm.R': 'shoulder.R',
  'forearm.R': 'upperArm.R',
  'hand.R': 'forearm.R',
  'upperLeg.L': 'pelvis',
  'lowerLeg.L': 'upperLeg.L',
  'foot.L': 'lowerLeg.L',
  'upperLeg.R': 'pelvis',
  'lowerLeg.R': 'upperLeg.R',
  'foot.R': 'lowerLeg.R',
}

function expectFiniteVector3(vector: THREE.Vector3): void {
  expect(Number.isFinite(vector.x)).toBe(true)
  expect(Number.isFinite(vector.y)).toBe(true)
  expect(Number.isFinite(vector.z)).toBe(true)
}

describe('createProceduralFighter', () => {
  it.each(ARCHETYPES)('builds the exact semantic joint hierarchy for %s', (archetype) => {
    const fighter = createProceduralFighter({ archetype })

    // `'root'` is deliberately the one name in `SEMANTIC_JOINT_NAMES` with no
    // corresponding entry in `fighter.joints` -- see that constant's own
    // comment in `ProceduralFighter.ts`. World placement lives only on
    // `fighter.root` itself, unreachable by joint-name lookup, so no
    // pose-application loop keyed off this vocabulary can ever overwrite it.
    const jointNamesExcludingRoot = SEMANTIC_JOINT_NAMES.filter((name) => name !== 'root')
    expect([...fighter.joints.keys()].sort()).toEqual([...jointNamesExcludingRoot].sort())
    expect([...fighter.anchors.keys()].sort()).toEqual([...EQUIPMENT_ANCHOR_NAMES].sort())
    expect(fighter.root.parent).toBeNull()
    expect(fighter.joints.get('root')).toBeUndefined()
    expect(fighter.joints.has('root')).toBe(false)

    for (const [name, parentName] of Object.entries(EXPECTED_PARENT) as [JointName, JointName | null][]) {
      if (name === 'root') {
        // `'root'` has no joints-map entry of its own; its identity (no
        // parent) is asserted directly against `fighter.root` above.
        continue
      }
      const joint = fighter.joints.get(name)
      expect(joint, `missing joint '${name}'`).toBeDefined()
      if (parentName === null) {
        expect(joint!.parent).toBeNull()
      } else if (parentName === 'root') {
        // `pelvis`'s authored parent is the root Group itself, not a
        // joints-map lookup (which would be `undefined` now).
        expect(joint!.parent).toBe(fighter.root)
      } else {
        expect(joint!.parent).toBe(fighter.joints.get(parentName))
      }
    }

    fighter.dispose()
  })

  // `shoulder.*` is a zero-length, rotation-only joint in the rest pose --
  // `upperArm.*` is added at local (0,0,0) relative to it (a real skeletal
  // rig commonly has a shoulder joint that carries no bone length of its
  // own), so the two intentionally share a world position. These are the
  // *only* joint pairs this rig intends to coincide; every other joint must
  // land at a distinct world position, or the rig has silently collapsed.
  const INTENDED_COINCIDENCES: readonly (readonly [JointName, JointName])[] = [
    ['shoulder.L', 'upperArm.L'],
    ['shoulder.R', 'upperArm.R'],
  ]

  it.each(ARCHETYPES)('gives every joint a finite transform, with exactly the intended coincident pairs for %s', (archetype) => {
    const fighter = createProceduralFighter({ archetype })
    fighter.root.updateMatrixWorld(true)

    const worldPositions = new Map<JointName, THREE.Vector3>()
    for (const [name, joint] of fighter.joints) {
      expectFiniteVector3(joint.position)
      expectFiniteVector3(joint.quaternion as unknown as THREE.Vector3)
      const world = new THREE.Vector3()
      joint.getWorldPosition(world)
      expectFiniteVector3(world)
      worldPositions.set(name, world)
    }

    for (const [a, b] of INTENDED_COINCIDENCES) {
      const distance = worldPositions.get(a)!.distanceTo(worldPositions.get(b)!)
      expect(distance, `${a} and ${b} were expected to coincide`).toBeLessThan(1e-9)
    }

    // Every joint NOT named above must have a distinct world position --
    // tightened from a bare "more than one distinct position" check, which
    // would still pass even if two unrelated joints on the same limb
    // accidentally landed on top of each other.
    const distinctKeys = new Set(
      [...worldPositions.values()].map((v) => `${v.x.toFixed(6)},${v.y.toFixed(6)},${v.z.toFixed(6)}`),
    )
    // Derived from `fighter.joints.size` (which `worldPositions` was built
    // from), not `SEMANTIC_JOINT_NAMES.length`, since `'root'` is in the
    // latter but deliberately absent from the former.
    const expectedDistinctCount = fighter.joints.size - INTENDED_COINCIDENCES.length
    expect(distinctKeys.size).toBe(expectedDistinctCount)

    fighter.dispose()
  })

  it.each(ARCHETYPES)('provides all five equipment anchors as real descendants of root for %s', (archetype) => {
    const fighter = createProceduralFighter({ archetype })

    for (const anchorName of EQUIPMENT_ANCHOR_NAMES) {
      const anchor = fighter.anchors.get(anchorName)
      expect(anchor, `missing anchor '${anchorName}'`).toBeDefined()

      let current: THREE.Object3D | null = anchor!
      let reachedRoot = false
      while (current) {
        if (current === fighter.root) {
          reachedRoot = true
          break
        }
        current = current.parent
      }
      expect(reachedRoot, `anchor '${anchorName}' is not a descendant of root`).toBe(true)
    }

    fighter.dispose()
  })

  function isDescendantOf(object: THREE.Object3D, ancestor: THREE.Object3D): boolean {
    let current: THREE.Object3D | null = object
    while (current) {
      if (current === ancestor) return true
      current = current.parent
    }
    return false
  }

  it('attaches weapon/shield equipment only under their anchors, and worn decoration only under its body joint (never an anchor)', () => {
    for (const archetype of ARCHETYPES) {
      const fighter = createProceduralFighter({ archetype })

      const weaponHand = fighter.anchors.get('weaponHand')!
      const shieldCenter = fighter.anchors.get('shieldCenter')!
      const hitCenter = fighter.anchors.get('hitCenter')!
      const head = fighter.joints.get('head')!
      const chest = fighter.joints.get('chest')!
      const allAnchors = [...fighter.anchors.values()]

      const meshesBySlot = new Map<string, THREE.Mesh[]>()
      fighter.root.traverse((object) => {
        if (object instanceof THREE.Mesh && typeof object.userData.slot === 'string') {
          const list = meshesBySlot.get(object.userData.slot) ?? []
          list.push(object)
          meshesBySlot.set(object.userData.slot, list)
        }
      })

      // Weapon/shield equipment: anchor-addressable, per brief resolution #2.
      const weaponMeshes = meshesBySlot.get('weapon') ?? []
      expect(weaponMeshes.length, `${archetype} should have a weapon mesh`).toBeGreaterThan(0)
      for (const mesh of weaponMeshes) {
        expect(isDescendantOf(mesh, weaponHand), `${archetype} weapon mesh should be under weaponHand`).toBe(true)
      }

      const shieldMeshes = meshesBySlot.get('shield') ?? []
      expect(shieldMeshes.length, `${archetype} should have a shield mesh`).toBeGreaterThan(0)
      for (const mesh of shieldMeshes) {
        expect(isDescendantOf(mesh, shieldCenter), `${archetype} shield mesh should be under shieldCenter`).toBe(true)
      }

      // hitCenter is a contact marker only -- it must never carry equipment
      // geometry of its own.
      expect(hitCenter.children.some((child) => child instanceof THREE.Mesh)).toBe(false)

      // Worn decoration: deliberately NOT anchor-addressable. It must live
      // under its own body joint and must never be reachable from any of
      // the five equipment anchors.
      const helmetMeshes = [...(meshesBySlot.get('helmet') ?? []), ...(meshesBySlot.get('crest') ?? [])]
      if (archetype === 'heavy') {
        expect(helmetMeshes.length, 'heavy should have a helmet/crest mesh').toBeGreaterThan(0)
      }
      for (const mesh of helmetMeshes) {
        expect(isDescendantOf(mesh, head), `${archetype} helmet/crest should be under the head joint`).toBe(true)
        expect(
          allAnchors.some((anchor) => isDescendantOf(mesh, anchor)),
          `${archetype} helmet/crest must not be reachable from any equipment anchor`,
        ).toBe(false)
      }

      const armorMeshes = meshesBySlot.get('armor') ?? []
      if (archetype === 'fast') {
        expect(armorMeshes.length, 'fast should have a light-armor mesh').toBeGreaterThan(0)
      }
      for (const mesh of armorMeshes) {
        expect(isDescendantOf(mesh, chest), `${archetype} armor should be under the chest joint`).toBe(true)
        expect(
          allAnchors.some((anchor) => isDescendantOf(mesh, anchor)),
          `${archetype} armor must not be reachable from any equipment anchor`,
        ).toBe(false)
      }

      fighter.dispose()
    }
  })

  it.each(ARCHETYPES)('reports a positive finite horizontalEquipmentRadius for %s', (archetype) => {
    const fighter = createProceduralFighter({ archetype })
    expect(Number.isFinite(fighter.horizontalEquipmentRadius)).toBe(true)
    expect(fighter.horizontalEquipmentRadius).toBeGreaterThan(0)
    fighter.dispose()
  })

  it('gives the three styles distinct horizontal equipment radii (not just distinct references)', () => {
    const radii = Object.fromEntries(
      ARCHETYPES.map((archetype) => {
        const fighter = createProceduralFighter({ archetype })
        const radius = fighter.horizontalEquipmentRadius
        fighter.dispose()
        return [archetype, radius]
      }),
    ) as Record<Archetype, number>

    expect(radii.heavy).not.toBeCloseTo(radii.fast, 2)
    expect(radii.heavy).not.toBeCloseTo(radii.technical, 2)
    expect(radii.fast).not.toBeCloseTo(radii.technical, 2)
  })

  it('gives the three styles distinct real body/equipment silhouette extents', () => {
    const extents = Object.fromEntries(
      ARCHETYPES.map((archetype) => {
        const fighter = createProceduralFighter({ archetype })
        const extent = measureSilhouetteExtent(fighter)
        fighter.dispose()
        return [archetype, extent]
      }),
    ) as Record<Archetype, ReturnType<typeof measureSilhouetteExtent>>

    for (const dimension of ['width', 'height', 'depth'] as const) {
      for (const value of Object.values(extents)) {
        expect(Number.isFinite(value[dimension])).toBe(true)
        expect(value[dimension]).toBeGreaterThan(0)
      }
    }

    // A real numeric comparison of the full tuple, pairwise, for every style
    // pair -- not merely `not.toBe` on object references.
    const pairs: readonly [Archetype, Archetype][] = [
      ['heavy', 'fast'],
      ['heavy', 'technical'],
      ['fast', 'technical'],
    ]
    for (const [a, b] of pairs) {
      const tupleA = [extents[a].width, extents[a].height, extents[a].depth, extents[a].horizontalEquipmentRadius]
      const tupleB = [extents[b].width, extents[b].height, extents[b].depth, extents[b].horizontalEquipmentRadius]
      expect(tupleA).not.toEqual(tupleB)
      // At least one dimension must differ by a visually meaningful margin
      // (not float noise), otherwise a single-colour silhouette could still
      // look identical.
      const meaningfulDifference = tupleA.some((value, index) => Math.abs(value - tupleB[index]) > 0.03)
      expect(meaningfulDifference, `${a} vs ${b} extents differ only by noise: ${tupleA} vs ${tupleB}`).toBe(true)
    }
  })

  it('gives each foot a forward bias, so a back view is not a mirror of a front view', () => {
    const fighter = createProceduralFighter({ archetype: 'heavy' })
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

    fighter.dispose()
  })

  it('keeps both feet on the floor plane in the rest pose', () => {
    const fighter = createProceduralFighter({ archetype: 'heavy' })
    for (const name of ['foot.L', 'foot.R'] as const) {
      const foot = fighter.joints.get(name)!
      const box = new THREE.Box3().setFromObject(foot)
      expect(box.min.y).toBeGreaterThan(-0.02)
      expect(box.min.y).toBeLessThan(0.02)
    }
    fighter.dispose()
  })

  it('gives the head a front: a visor slot on the forward hemisphere', () => {
    const fighter = createProceduralFighter({ archetype: 'fast' })
    const head = fighter.joints.get('head')!
    const visor = head.children.find(
      (child): child is THREE.Mesh => child instanceof THREE.Mesh && child.userData.slot === 'visor',
    )
    expect(visor).toBeDefined()
    // Sits forward of the head's own centre.
    expect(visor!.position.z).toBeGreaterThan(0)

    // It must be real protruding geometry, not just a dark colour: that is
    // the stated reason it exists as a separate mesh at all (legible even
    // where the head is only a few pixels wide).
    const headSphere = head.children.find(
      (child): child is THREE.Mesh => child instanceof THREE.Mesh && child.userData.slot === 'skin',
    )
    expect(headSphere).toBeDefined()
    const sphereBox = new THREE.Box3().setFromObject(headSphere!)
    const visorBox = new THREE.Box3().setFromObject(visor!)
    const visorSize = new THREE.Vector3()
    visorBox.getSize(visorSize)
    expect(visorSize.x).toBeGreaterThan(0.01)
    expect(visorSize.y).toBeGreaterThan(0.01)
    expect(visorSize.z).toBeGreaterThan(0.01)
    // Protrudes forward of the head sphere's own surface, not sunk inside it.
    expect(visorBox.max.z).toBeGreaterThan(sphereBox.max.z)

    fighter.dispose()
  })

  it('separates chest from back by value, without introducing a third hue', () => {
    const fighter = createProceduralFighter({ archetype: 'technical' })
    const chest = fighter.joints.get('chest')!
    const plate = chest.children.find(
      (child): child is THREE.Mesh => child instanceof THREE.Mesh && child.userData.slot === 'breastplate',
    )
    expect(plate).toBeDefined()
    expect(plate!.position.z).toBeGreaterThan(0)

    // Must be derived from the fighter's own house/cloth colour (lightened),
    // never a hard-coded literal and never a third hue that would compete
    // with the red/blue/green that already separates the three styles.
    let houseColor: THREE.Color | undefined
    fighter.root.traverse((object) => {
      if (!houseColor && object instanceof THREE.Mesh && object.userData.slot === 'cloth') {
        houseColor = (object.material as THREE.MeshStandardMaterial).color
      }
    })
    expect(houseColor).toBeDefined()

    const plateColor = (plate!.material as THREE.MeshStandardMaterial).color
    // Not a literal copy of the house colour -- it must actually be lightened.
    expect(plateColor.equals(houseColor!)).toBe(false)

    const houseHsl = houseColor!.getHSL({ h: 0, s: 0, l: 0 })
    const plateHsl = plateColor.getHSL({ h: 0, s: 0, l: 0 })
    // Same hue as the source colour (within float rounding) -- no third hue.
    expect(Math.abs(plateHsl.h - houseHsl.h)).toBeLessThan(0.005)
    // Strictly lighter -- value, not hue, carries the front/back contrast.
    expect(plateHsl.l).toBeGreaterThan(houseHsl.l)

    fighter.dispose()
  })

  // Task 7's motion-check found the front-only lightened plate correct in
  // construction but too small a contrast to read at the arena's shipped
  // framing distance (a fighter roughly 90px tall). The back gets the
  // mirror-image darkening so the cue is a full light-to-dark swing rather
  // than a one-sided nudge off the base cloth colour, and reads even when a
  // shield is covering the front (a shield never covers the back).
  it('darkens the back to match the front-lightened breastplate, doubling the value contrast', () => {
    const fighter = createProceduralFighter({ archetype: 'technical' })
    const chest = fighter.joints.get('chest')!
    const backplate = chest.children.find(
      (child): child is THREE.Mesh => child instanceof THREE.Mesh && child.userData.slot === 'backplate',
    )
    expect(backplate).toBeDefined()
    // Sits behind the chest's own centre -- the mirror of the breastplate.
    expect(backplate!.position.z).toBeLessThan(0)

    let houseColor: THREE.Color | undefined
    fighter.root.traverse((object) => {
      if (!houseColor && object instanceof THREE.Mesh && object.userData.slot === 'cloth') {
        houseColor = (object.material as THREE.MeshStandardMaterial).color
      }
    })
    expect(houseColor).toBeDefined()

    const backplateColor = (backplate!.material as THREE.MeshStandardMaterial).color
    expect(backplateColor.equals(houseColor!)).toBe(false)

    const houseHsl = houseColor!.getHSL({ h: 0, s: 0, l: 0 })
    const backplateHsl = backplateColor.getHSL({ h: 0, s: 0, l: 0 })
    // Same hue as the source colour -- no third hue on the back either.
    expect(Math.abs(backplateHsl.h - houseHsl.h)).toBeLessThan(0.005)
    // Strictly darker, the mirror of the breastplate's strictly-lighter front.
    expect(backplateHsl.l).toBeLessThan(houseHsl.l)

    fighter.dispose()
  })
})

describe('dispose', () => {
  it('releases geometries and materials and reports isDisposed()', () => {
    const fighter = createProceduralFighter({ archetype: 'heavy' })

    // Some meshes (rim outlines) deliberately reuse their source mesh's
    // geometry, and several body-segment meshes share the same style
    // material -- so this collects unique instances rather than pushing one
    // entry per mesh, which would spy the same object's `dispose` more than
    // once and make the assertions fragile.
    const geometries = new Set<THREE.BufferGeometry>()
    const materials = new Set<THREE.Material>()
    fighter.root.traverse((object) => {
      if (object instanceof THREE.Mesh) {
        geometries.add(object.geometry)
        const material = object.material
        if (Array.isArray(material)) material.forEach((m) => materials.add(m))
        else materials.add(material)
      }
    })
    expect(geometries.size).toBeGreaterThan(0)
    expect(materials.size).toBeGreaterThan(0)

    const disposeGeometrySpies = [...geometries].map((geometry) => vi.spyOn(geometry, 'dispose'))
    const disposeMaterialSpies = [...materials].map((material) => vi.spyOn(material, 'dispose'))

    expect(fighter.isDisposed()).toBe(false)
    fighter.dispose()
    expect(fighter.isDisposed()).toBe(true)

    for (const spy of disposeGeometrySpies) expect(spy).toHaveBeenCalled()
    for (const spy of disposeMaterialSpies) expect(spy).toHaveBeenCalled()

    expect(fighter.root.children.length).toBe(0)
  })

  it('is idempotent when called twice', () => {
    const fighter = createProceduralFighter({ archetype: 'fast' })
    fighter.dispose()
    expect(() => fighter.dispose()).not.toThrow()
    expect(fighter.isDisposed()).toBe(true)
  })
})
