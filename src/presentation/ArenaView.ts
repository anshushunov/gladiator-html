import * as THREE from 'three'
import { fighterBySide, sideForCombatantId, type BattleState } from '../simulation/battle'
import type { EncounterEvent } from '../simulation/encounter'
import type { Archetype, FighterDefinition, FighterSide } from '../simulation/fighters'

const SIDES: readonly FighterSide[] = ['home', 'away']
const REACTION_DECAY_PER_SECOND = 5
const FALL_ANGLES: Record<FighterSide, number> = { home: -1.3, away: 1.3 }

const ARENA_PALETTES: Record<Archetype, { tunic: number; plume: number }> = {
  heavy: { tunic: 0xb83b34, plume: 0xf0b071 },
  fast: { tunic: 0x2a6f8e, plume: 0xb9d7dc },
  technical: { tunic: 0x4f6b3d, plume: 0xe0c26a },
}

interface SideReactions {
  lunge: number
  recovery: number
  block: number
  hit: number
  critical: number
  defeated: boolean
}

function createReactions(): SideReactions {
  return { lunge: 0, recovery: 0, block: 0, hit: 0, critical: 0, defeated: false }
}

export class ArenaView {
  private readonly renderer: THREE.WebGLRenderer
  private readonly scene = new THREE.Scene()
  private readonly camera = new THREE.PerspectiveCamera(38, 1, 0.1, 100)
  private readonly fighters: Record<FighterSide, THREE.Group>
  private readonly reactions: Record<FighterSide, SideReactions> = {
    home: createReactions(),
    away: createReactions(),
  }
  private readonly observer: ResizeObserver
  private activeBoutIndex?: number
  private lastEventId = -1
  private lastFrameTime: number | null = null

  constructor(private readonly canvas: HTMLCanvasElement) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true })
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
    this.renderer.shadowMap.enabled = true
    this.scene.background = new THREE.Color(0x16131a)
    this.scene.fog = new THREE.Fog(0x16131a, 14, 24)
    this.camera.position.set(0, 8.8, 13)
    this.camera.lookAt(0, 0, 0)

    this.buildArena()
    this.fighters = {
      home: this.buildFighter(ARENA_PALETTES.heavy.tunic, ARENA_PALETTES.heavy.plume),
      away: this.buildFighter(ARENA_PALETTES.fast.tunic, ARENA_PALETTES.fast.plume),
    }

    this.observer = new ResizeObserver(() => this.resize())
    this.observer.observe(canvas.parentElement ?? canvas)
    this.resize()
  }

  startBout(boutIndex: number, homeDefinition: FighterDefinition, awayDefinition: FighterDefinition): void {
    this.activeBoutIndex = boutIndex
    this.lastEventId = -1
    this.lastFrameTime = null
    for (const side of SIDES) {
      this.reactions[side] = createReactions()
      const definition = side === 'home' ? homeDefinition : awayDefinition
      this.applyPalette(this.fighters[side], ARENA_PALETTES[definition.archetype])
      this.resetPose(this.fighters[side], side)
    }
    this.canvas.hidden = false
    this.canvas.dataset.activeBoutIndex = String(boutIndex)
    this.canvas.dataset.lastEventId = String(this.lastEventId)
  }

  clearBout(): void {
    this.activeBoutIndex = undefined
    this.lastEventId = -1
    this.lastFrameTime = null
    for (const side of SIDES) {
      this.reactions[side] = createReactions()
      this.resetPose(this.fighters[side], side)
    }
    delete this.canvas.dataset.activeBoutIndex
    delete this.canvas.dataset.lastEventId
    this.canvas.hidden = true
  }

  sync(state: BattleState): void {
    const now = performance.now()
    const elapsed = this.lastFrameTime === null ? 0 : Math.min((now - this.lastFrameTime) / 1000, 0.05)
    this.lastFrameTime = now

    for (const side of SIDES) {
      const reactions = this.reactions[side]
      if (reactions.defeated) continue
      reactions.lunge = decayFromOne(reactions.lunge, elapsed)
      reactions.recovery = decayFromOne(reactions.recovery, elapsed)
      reactions.block = decayFromOne(reactions.block, elapsed)
      reactions.hit = decayFromOne(reactions.hit, elapsed)
      reactions.critical = decayFromOne(reactions.critical, elapsed)
    }

    for (const event of state.events) {
      if (event.id <= this.lastEventId) continue
      this.applyEvent(state, event)
      this.lastEventId = event.id
    }
    this.canvas.dataset.lastEventId = String(this.lastEventId)
    if (this.activeBoutIndex !== undefined) {
      this.canvas.dataset.activeBoutIndex = String(this.activeBoutIndex)
    }

    this.applySimulation(state)
    this.renderer.render(this.scene, this.camera)
  }

  dispose(): void {
    this.observer.disconnect()
    this.renderer.dispose()
  }

  private applyEvent(state: BattleState, event: EncounterEvent): void {
    switch (event.type) {
      case 'action-started':
      case 'attack-missed':
      case 'critical-hit': {
        const actor = this.reactions[sideForCombatantId(state, event.actorId)]
        if (actor.defeated) break
        if (event.type === 'action-started') actor.lunge = 1
        else if (event.type === 'attack-missed') actor.recovery = 1
        else actor.critical = 1
        break
      }
      case 'attack-blocked':
      case 'damage-dealt': {
        const target = this.reactions[sideForCombatantId(state, event.targetId)]
        if (target.defeated) break
        if (event.type === 'attack-blocked') target.block = 1
        else target.hit = 1
        break
      }
      case 'fighter-defeated':
        this.reactions[sideForCombatantId(state, event.defeatedId)].defeated = true
        break
      default:
        break
    }
  }

  private applySimulation(state: BattleState): void {
    for (const side of SIDES) {
      const fighter = fighterBySide(state, side)
      const group = this.fighters[side]
      const reactions = this.reactions[side]
      const forward = side === 'home' ? 1 : -1

      group.position.x = fighter.position.x
      group.position.y = 0
      group.position.z = 0
      group.rotation.y = side === 'home' ? Math.PI / 2 : -Math.PI / 2
      group.scale.set(1, 1, 1)

      if (reactions.defeated || fighter.status === 'defeated') {
        group.rotation.z = FALL_ANGLES[side]
        continue
      }

      group.position.x += (reactions.lunge * 0.5 - reactions.hit * 0.12) * forward
      group.position.y += reactions.critical * 0.12
      group.rotation.z = forward * (reactions.hit * 0.35 - reactions.recovery * 0.2 + reactions.block * 0.18)
      group.scale.setScalar(1 + reactions.critical * 0.1)
    }
  }

  private applyPalette(group: THREE.Group, palette: { tunic: number; plume: number }): void {
    for (const child of group.children) {
      const slot = child.userData.slot
      if (slot !== 'cloth' && slot !== 'plume') continue
      const material = (child as THREE.Mesh).material as THREE.MeshStandardMaterial
      material.color.setHex(slot === 'cloth' ? palette.tunic : palette.plume)
    }
  }

  private resetPose(group: THREE.Group, side: FighterSide): void {
    group.position.set(0, 0, 0)
    group.rotation.set(0, side === 'home' ? Math.PI / 2 : -Math.PI / 2, 0)
    group.scale.set(1, 1, 1)
  }

  private buildArena(): void {
    const floor = new THREE.Mesh(
      new THREE.CircleGeometry(7.7, 64),
      new THREE.MeshStandardMaterial({ color: 0x8a6845, roughness: 1 }),
    )
    floor.rotation.x = -Math.PI / 2
    floor.receiveShadow = true
    this.scene.add(floor)

    const ring = new THREE.Mesh(
      new THREE.TorusGeometry(7.7, 0.13, 8, 96),
      new THREE.MeshStandardMaterial({ color: 0xa77a45, metalness: 0.45, roughness: 0.55 }),
    )
    ring.rotation.x = Math.PI / 2
    ring.position.y = 0.04
    this.scene.add(ring)

    const key = new THREE.DirectionalLight(0xffd8a8, 3.2)
    key.position.set(-4, 10, 6)
    key.castShadow = true
    this.scene.add(key, new THREE.HemisphereLight(0xc9d6ef, 0x3d251a, 1.6))
  }

  private buildFighter(tunicColor: number, plumeColor: number): THREE.Group {
    const fighter = new THREE.Group()
    const skin = new THREE.MeshStandardMaterial({ color: 0x9c6244, roughness: 0.9 })
    const bronze = new THREE.MeshStandardMaterial({ color: 0x6f4a2a, metalness: 0.75, roughness: 0.35 })
    const cloth = new THREE.MeshStandardMaterial({ color: tunicColor, roughness: 0.85 })
    const plumeMaterial = new THREE.MeshStandardMaterial({ color: plumeColor, roughness: 0.7 })

    const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.48, 1.15, 5, 12), cloth)
    body.position.y = 1.18
    body.userData.slot = 'cloth'
    const head = new THREE.Mesh(new THREE.SphereGeometry(0.34, 16, 12), skin)
    head.position.y = 2.1
    const helmet = new THREE.Mesh(new THREE.SphereGeometry(0.39, 16, 8, 0, Math.PI * 2, 0, Math.PI / 2), bronze)
    helmet.position.y = 2.15
    const plume = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.5, 0.65), plumeMaterial)
    plume.position.y = 2.62
    plume.userData.slot = 'plume'
    const shield = new THREE.Mesh(new THREE.CylinderGeometry(0.62, 0.62, 0.12, 24), bronze)
    shield.rotation.z = Math.PI / 2
    shield.position.set(0.45, 1.25, 0)
    const sword = new THREE.Mesh(new THREE.BoxGeometry(0.06, 1.45, 0.12), bronze)
    sword.rotation.z = -0.55
    sword.position.set(-0.62, 1.25, 0)

    for (const mesh of [body, head, helmet, plume, shield, sword]) {
      mesh.castShadow = true
      fighter.add(mesh)
    }
    this.scene.add(fighter)
    return fighter
  }

  private resize(): void {
    const width = this.canvas.clientWidth
    const height = this.canvas.clientHeight
    if (!width || !height) return
    this.camera.aspect = width / height
    this.camera.updateProjectionMatrix()
    this.renderer.setSize(width, height, false)
  }
}

function decayFromOne(value: number, elapsed: number): number {
  return Math.max(0, value - elapsed * REACTION_DECAY_PER_SECOND)
}
