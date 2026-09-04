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
