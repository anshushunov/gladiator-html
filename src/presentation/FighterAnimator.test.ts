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
