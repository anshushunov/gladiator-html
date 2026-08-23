import * as THREE from 'three'
import { describe, expect, it, vi } from 'vitest'
import type { Archetype } from '../simulation/fighters'
import {
  createProceduralFighter,
  EQUIPMENT_ANCHOR_NAMES,
  measureSilhouetteExtent,
  SEMANTIC_JOINT_NAMES,
  type JointName,
  type ProceduralFighter,
} from './ProceduralFighter'

const ARCHETYPES: readonly Archetype[] = ['heavy', 'fast', 'technical']

/**
 * The kits whose historical type carries no shield at all -- `fast` is the
 * Retiarius, who fights with a net in the off hand instead (see
 * `./gladiatorTypes.ts` for the archetype -> type-name mapping).
 */
const SHIELDLESS_ARCHETYPES: ReadonlySet<Archetype> = new Set<Archetype>(['fast'])

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
      const offHand = fighter.anchors.get('offHand')!
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

      // Per kind, not per fighter: the two shield-bearing kits must each build
      // a shield, and the shieldless one (Retiarius) must build none anywhere
      // in the rig -- "no shield mesh under the anchor" would still pass if a
      // stray shield were parented somewhere else, so this counts meshes over
      // the whole rig and only then checks the parent of the ones that exist.
      const shieldMeshes = meshesBySlot.get('shield') ?? []
      if (SHIELDLESS_ARCHETYPES.has(archetype)) {
        expect(shieldMeshes.length, `${archetype} fights with no shield at all`).toBe(0)
      } else {
        expect(shieldMeshes.length, `${archetype} should have a shield mesh`).toBeGreaterThan(0)
      }
      for (const mesh of shieldMeshes) {
        expect(isDescendantOf(mesh, shieldCenter), `${archetype} shield mesh should be under shieldCenter`).toBe(true)
      }

      // An off-hand prop that is not a shield (the Retiarius' net) is still
      // held equipment, so it is anchor-addressable like the weapon and the
      // shield -- it hangs off `offHand`, never off a bare body joint.
      const offhandPropMeshes = meshesBySlot.get('net') ?? []
      if (SHIELDLESS_ARCHETYPES.has(archetype)) {
        expect(offhandPropMeshes.length, `${archetype} should still fill its off hand`).toBeGreaterThan(0)
      }
      for (const mesh of offhandPropMeshes) {
        expect(isDescendantOf(mesh, offHand), `${archetype} off-hand prop should be under offHand`).toBe(true)
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

      // None of the three types wore torso armour: the murmillo and the
      // hoplomachus fought bare-chested, and the retiarius' whole identity is
      // that he is the least-armoured man in the arena -- his attested kit is
      // a loincloth, a belt, an arm sleeve and a shoulder guard, nothing on
      // the chest (see `docs/reference/gladiator-equipment.md` §3). So the
      // expectation is that *no* kit builds one, which is a stronger statement
      // than the per-archetype check it replaces: that one pinned `fast`'s
      // pre-authoring placeholder rather than any claim about the type. The
      // parentage rule below stays, so it still holds the day a kit that
      // really did wear a cuirass is added.
      const armorMeshes = meshesBySlot.get('armor') ?? []
      expect(armorMeshes.length, `${archetype} wore no torso armour`).toBe(0)
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

const propSlots = (f: ProceduralFighter): string[] => {
  const slots: string[] = []
  f.root.traverse((o) => { if (o.userData.slot) slots.push(String(o.userData.slot)) })
  return slots
}
const findBySlot = (f: ProceduralFighter, slot: string): THREE.Object3D | undefined => {
  let found: THREE.Object3D | undefined
  f.root.traverse((o) => { if (!found && o.userData.slot === slot) found = o })
  return found
}

describe('equipment kinds', () => {
  it('builds no shield mesh for a shieldless kit', () => {
    const f = createProceduralFighter({ archetype: 'fast' })
    expect(propSlots(f)).not.toContain('shield')
    f.dispose()
  })

  it('builds a scutum taller than it is wide', () => {
    const f = createProceduralFighter({ archetype: 'heavy' })
    const size = new THREE.Box3().setFromObject(findBySlot(f, 'shield')!).getSize(new THREE.Vector3())
    expect(size.y / size.x).toBeGreaterThan(1.3)
    f.dispose()
  })

  it('points the weapon mesh along the hand-to-tip segment', () => {
    // Direction, not containment: a large axis-aligned Box3 contains the tip
    // even when the mesh runs along the wrong axis.
    const f = createProceduralFighter({ archetype: 'technical' })
    const hand = new THREE.Vector3(); f.anchors.get('weaponHand')!.getWorldPosition(hand)
    const tip = new THREE.Vector3(); f.anchors.get('weaponTip')!.getWorldPosition(tip)
    const mesh = findBySlot(f, 'weapon') as THREE.Mesh
    const meshAxis = new THREE.Vector3(0, 1, 0).applyQuaternion(mesh.getWorldQuaternion(new THREE.Quaternion()))
    expect(meshAxis.dot(tip.clone().sub(hand).normalize())).toBeGreaterThan(0.95)
    f.dispose()
  })

  it('derives the equipment radius from real prop bounds, not a shield constant', () => {
    const f = createProceduralFighter({ archetype: 'fast' })
    let expected = 0
    f.root.updateMatrixWorld(true)
    f.root.traverse((o) => {
      if (!o.userData.slot) return
      const box = new THREE.Box3().setFromObject(o)
      // All four horizontal corners. The plan's text sampled only (min,min)
      // and (max,max), which under-reports a box whose farthest corner is the
      // mixed pair; amended by human ruling 2026-08-24 for this line alone,
      // in step with `computeHorizontalEquipmentRadius`'s own sweep.
      for (const x of [box.min.x, box.max.x]) {
        for (const z of [box.min.z, box.max.z]) expected = Math.max(expected, Math.hypot(x, z))
      }
    })
    expect(f.horizontalEquipmentRadius).toBeCloseTo(expected, 2)
    f.dispose()
  })
})

describe('type silhouettes', () => {
  it('separates the three by horizontal equipment reach', () => {
    const reach = (a: Archetype): number => {
      const f = createProceduralFighter({ archetype: a }); const v = f.horizontalEquipmentRadius; f.dispose(); return v
    }
    const [murmillo, retiarius, hoplomachus] = [reach('heavy'), reach('fast'), reach('technical')]
    expect(Math.abs(hoplomachus - murmillo)).toBeGreaterThan(0.3)
    expect(Math.abs(retiarius - murmillo)).toBeGreaterThan(0.3)
  })
  it('gives the retiarius a net and no helmet', () => {
    const f = createProceduralFighter({ archetype: 'fast' })
    expect(propSlots(f)).toContain('net')
    expect(propSlots(f)).not.toContain('helmet')
    f.dispose()
  })
})

/**
 * `buildGreaves`, `buildShoulderGuard` and `helmetKind: 'brimmed'` had no kit
 * using them before this task, so these are their first execution and this
 * block is their only coverage. It checks placement, not just presence: a
 * greave floating off the shin or a galerus buried inside the neck compiles
 * perfectly well.
 *
 * Every expectation here traces to a row of `docs/reference/gladiator-equipment.md`.
 */
describe('type kits', () => {
  const meshesWithSlot = (f: ProceduralFighter, slot: string): THREE.Mesh[] => {
    const found: THREE.Mesh[] = []
    f.root.traverse((o) => {
      if (o instanceof THREE.Mesh && o.userData.slot === slot) found.push(o)
    })
    return found
  }

  it('gives the murmillo one low ocrea on the lead leg, the hoplomachus two high greaves, and the retiarius none', () => {
    const murmillo = createProceduralFighter({ archetype: 'heavy' })
    const hoplomachus = createProceduralFighter({ archetype: 'technical' })
    const retiarius = createProceduralFighter({ archetype: 'fast' })

    const murmilloGreaves = meshesWithSlot(murmillo, 'greave')
    expect(murmilloGreaves, 'the murmillo wears one ocrea').toHaveLength(1)
    // The lead leg is the shield side, and the off hand is the left hand.
    expect(murmilloGreaves[0].parent).toBe(murmillo.joints.get('lowerLeg.L'))

    const hoplomachusGreaves = meshesWithSlot(hoplomachus, 'greave')
    expect(hoplomachusGreaves, 'the hoplomachus wears a pair').toHaveLength(2)
    expect(new Set(hoplomachusGreaves.map((greave) => greave.parent))).toEqual(
      new Set([hoplomachus.joints.get('lowerLeg.L'), hoplomachus.joints.get('lowerLeg.R')]),
    )

    expect(meshesWithSlot(retiarius, 'greave'), 'the retiarius fights bare-legged').toHaveLength(0)

    // Placement: every greave grows up the shin from the ankle and stops at
    // the knee it hangs from, rather than sinking through the floor or riding
    // up over the thigh. `shinCoverage` is height as a fraction of the shin,
    // so "high" and "low" are compared as shapes, not as raw world units on
    // two differently proportioned bodies.
    const shinCoverage = (fighter: ProceduralFighter, greave: THREE.Mesh): number => {
      fighter.root.updateMatrixWorld(true)
      const box = new THREE.Box3().setFromObject(greave)
      const knee = new THREE.Vector3()
      greave.parent!.getWorldPosition(knee)
      expect(box.min.y, 'a greave starts at the ankle, not through the floor').toBeGreaterThan(-0.02)
      expect(box.max.y, 'a greave stops at or below the knee').toBeLessThanOrEqual(knee.y + 1e-6)
      return (box.max.y - box.min.y) / knee.y
    }

    const low = shinCoverage(murmillo, murmilloGreaves[0])
    for (const greave of hoplomachusGreaves) {
      expect(shinCoverage(hoplomachus, greave), 'a high greave covers more shin than a low one').toBeGreaterThan(low + 0.15)
    }

    murmillo.dispose()
    hoplomachus.dispose()
    retiarius.dispose()
  })

  it('gives only the retiarius a galerus, on the shoulder above his netted hand', () => {
    for (const archetype of ARCHETYPES) {
      const fighter = createProceduralFighter({ archetype })
      const guards = meshesWithSlot(fighter, 'shoulderGuard')

      if (archetype === 'fast') {
        expect(guards, 'the retiarius wears one galerus').toHaveLength(1)
        expect(guards[0].parent).toBe(fighter.joints.get('shoulder.L'))

        fighter.root.updateMatrixWorld(true)
        const box = new THREE.Box3().setFromObject(guards[0])
        const shoulder = new THREE.Vector3()
        guards[0].parent!.getWorldPosition(shoulder)
        // Rises above the shoulder it guards (that is what it is for) and sits
        // outboard of the body's centre line rather than inside the neck.
        expect(box.max.y, 'the galerus rises above the shoulder').toBeGreaterThan(shoulder.y)
        expect(box.min.x, 'the galerus sits outboard on the left side').toBeGreaterThan(0)
      } else {
        expect(guards, `${archetype} wears no galerus`).toHaveLength(0)
      }

      fighter.dispose()
    }
  })

  it('crowns only the murmillo, and leaves the hoplomachus brimmed but bare-crowned', () => {
    const murmillo = createProceduralFighter({ archetype: 'heavy' })
    expect(meshesWithSlot(murmillo, 'helmet').length, 'the murmillo wears a brimmed helmet').toBeGreaterThan(0)
    expect(meshesWithSlot(murmillo, 'crest'), 'the murmillo carries the crest').toHaveLength(1)
    murmillo.dispose()

    // The hoplomachus' helmet did carry a crest tube historically, but the rig
    // has exactly one crown cue and spending it on both types would make the
    // pair harder to tell apart, not easier -- see the equipment bible's
    // "attested but deliberately not drawn" note.
    const hoplomachus = createProceduralFighter({ archetype: 'technical' })
    expect(meshesWithSlot(hoplomachus, 'helmet').length, 'the hoplomachus wears a brimmed helmet').toBeGreaterThan(0)
    expect(meshesWithSlot(hoplomachus, 'crest'), 'the crest stays the murmillo\'s alone').toHaveLength(0)
    hoplomachus.dispose()
  })

  it('makes the parma read as a small shield beside the scutum slab', () => {
    // Frontal area, because that is the quantity a viewer resolves at 50-90 px:
    // "small round shield" has to mean small *against the other one*, not
    // merely round.
    const frontalArea = (archetype: Archetype): number => {
      const fighter = createProceduralFighter({ archetype })
      const size = new THREE.Box3().setFromObject(findBySlot(fighter, 'shield')!).getSize(new THREE.Vector3())
      fighter.dispose()
      return size.x * size.y
    }
    expect(frontalArea('heavy')).toBeGreaterThan(frontalArea('technical') * 2.5)
  })

  it('draws both polearm shafts thick enough to survive the shipped framing', () => {
    // `weaponWidth: 0.045` landed at roughly two pixels at the shipped framing,
    // which is why the spear was reported as unreadable. Measured on the
    // geometry's own bounds, not the world AABB: every weapon part is modelled
    // along local +Y and then rotated onto the hand -> tip line, so the world
    // box of a nearly-horizontal shaft says nothing about its cross-section.
    const MIN_SHAFT_CROSS_SECTION = 0.06
    for (const archetype of ['technical', 'fast'] as const) {
      const fighter = createProceduralFighter({ archetype })
      // The full-length part goes in first, so this is the shaft itself.
      const shaft = findBySlot(fighter, 'weapon') as THREE.Mesh
      shaft.geometry.computeBoundingBox()
      const size = shaft.geometry.boundingBox!.getSize(new THREE.Vector3())
      expect(Math.min(size.x, size.z), `${archetype}'s shaft is too thin to read`).toBeGreaterThan(MIN_SHAFT_CROSS_SECTION)
      fighter.dispose()
    }
  })

  it('keeps the type palette clear of the red/blue that already means home/away', () => {
    // The HUD marks sides with `.fighter-card--home` #b34d3a and
    // `.fighter-card--away` #4383a0 (src/style.css). A type colour sitting on
    // either hue makes the two channels collide: a murmillo would read as
    // "home" whichever side he is actually fighting for.
    const SIDE_HUES = [new THREE.Color(0xb34d3a), new THREE.Color(0x4383a0)].map((c) => c.getHSL({ h: 0, s: 0, l: 0 }).h)
    const hueDistance = (a: number, b: number): number => Math.min(Math.abs(a - b), 1 - Math.abs(a - b))

    const typeHsl = ARCHETYPES.map((archetype) => {
      const fighter = createProceduralFighter({ archetype })
      let cloth: THREE.Color | undefined
      fighter.root.traverse((object) => {
        if (!cloth && object instanceof THREE.Mesh && object.userData.slot === 'cloth') {
          cloth = (object.material as THREE.MeshStandardMaterial).color
        }
      })
      fighter.dispose()
      return { archetype, hsl: cloth!.getHSL({ h: 0, s: 0, l: 0 }) }
    })

    for (const { archetype, hsl } of typeHsl) {
      for (const sideHue of SIDE_HUES) {
        expect(hueDistance(hsl.h, sideHue), `${archetype}'s type colour collides with a side colour`).toBeGreaterThan(0.08)
      }
    }

    // And the three separate by *value* as well as hue, so the types survive
    // the greyscale/colour-blind check the design spec asks for. The widest
    // gap is spent on the hoplomachus/retiarius pair, which is the one the
    // two long polearms put at risk.
    const lightnesses = typeHsl.map(({ hsl }) => hsl.l).sort((a, b) => a - b)
    for (let i = 1; i < lightnesses.length; i += 1) {
      expect(lightnesses[i] - lightnesses[i - 1], 'two type colours share a value').toBeGreaterThan(0.08)
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
