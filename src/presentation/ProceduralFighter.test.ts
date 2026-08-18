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

    expect([...fighter.joints.keys()].sort()).toEqual([...SEMANTIC_JOINT_NAMES].sort())
    expect([...fighter.anchors.keys()].sort()).toEqual([...EQUIPMENT_ANCHOR_NAMES].sort())
    expect(fighter.root.parent).toBeNull()
    expect(fighter.joints.get('root')).toBe(fighter.root)

    for (const [name, parentName] of Object.entries(EXPECTED_PARENT) as [JointName, JointName | null][]) {
      const joint = fighter.joints.get(name)
      expect(joint, `missing joint '${name}'`).toBeDefined()
      if (parentName === null) {
        expect(joint!.parent).toBeNull()
      } else {
        expect(joint!.parent).toBe(fighter.joints.get(parentName))
      }
    }

    fighter.dispose()
  })

  it.each(ARCHETYPES)('gives every joint a finite, unique transform for %s', (archetype) => {
    const fighter = createProceduralFighter({ archetype })
    fighter.root.updateMatrixWorld(true)

    const worldPositions: THREE.Vector3[] = []
    for (const joint of fighter.joints.values()) {
      expectFiniteVector3(joint.position)
      expectFiniteVector3(joint.quaternion as unknown as THREE.Vector3)
      const world = new THREE.Vector3()
      joint.getWorldPosition(world)
      expectFiniteVector3(world)
      worldPositions.push(world)
    }

    // Every joint's own local position is finite (checked above); this also
    // proves no two joints were accidentally built at the exact same offset
    // stack, i.e. the rig has real extent rather than being collapsed to a
    // single point.
    const distinctKeys = new Set(worldPositions.map((v) => `${v.x.toFixed(6)},${v.y.toFixed(6)},${v.z.toFixed(6)}`))
    expect(distinctKeys.size).toBeGreaterThan(1)

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

  it('attaches style-specific equipment only under the weapon/shield anchors', () => {
    for (const archetype of ARCHETYPES) {
      const fighter = createProceduralFighter({ archetype })

      const weaponHand = fighter.anchors.get('weaponHand')!
      const shieldCenter = fighter.anchors.get('shieldCenter')!

      const weaponHasMesh = weaponHand.children.some((child) => child instanceof THREE.Mesh)
      const shieldHasMesh = shieldCenter.children.some((child) => child instanceof THREE.Mesh)
      expect(weaponHasMesh, `${archetype} weaponHand should carry a weapon mesh`).toBe(true)
      expect(shieldHasMesh, `${archetype} shieldCenter should carry a shield mesh`).toBe(true)

      // hitCenter is a contact marker only -- it must never carry equipment
      // geometry of its own.
      const hitCenter = fighter.anchors.get('hitCenter')!
      expect(hitCenter.children.some((child) => child instanceof THREE.Mesh)).toBe(false)

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
