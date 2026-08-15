import * as THREE from 'three'
import type { BattleState, FighterId } from '../simulation/battle'

export class ArenaView {
  private readonly renderer: THREE.WebGLRenderer
  private readonly scene = new THREE.Scene()
  private readonly camera = new THREE.PerspectiveCamera(38, 1, 0.1, 100)
  private readonly fighters = new Map<FighterId, THREE.Group>()
  private readonly observer: ResizeObserver

  constructor(private readonly canvas: HTMLCanvasElement) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true })
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
    this.renderer.shadowMap.enabled = true
    this.scene.background = new THREE.Color(0x16131a)
    this.scene.fog = new THREE.Fog(0x16131a, 14, 24)
    this.camera.position.set(0, 8.8, 13)
    this.camera.lookAt(0, 0, 0)

    this.buildArena()
    this.fighters.set('red', this.buildFighter(0xb83b34, 0xf0b071))
    this.fighters.set('blue', this.buildFighter(0x2a6f8e, 0xb9d7dc))

    this.observer = new ResizeObserver(() => this.resize())
    this.observer.observe(canvas.parentElement ?? canvas)
    this.resize()
  }

  sync(state: BattleState): void {
    for (const fighter of state.fighters) {
      const mesh = this.fighters.get(fighter.id)
      if (!mesh) continue
      mesh.position.x = fighter.x
      mesh.rotation.y = fighter.id === 'red' ? Math.PI / 2 : -Math.PI / 2
      mesh.rotation.z = fighter.hp === 0 ? (fighter.id === 'red' ? -1.3 : 1.3) : 0
    }
    this.renderer.render(this.scene, this.camera)
  }

  dispose(): void {
    this.observer.disconnect()
    this.renderer.dispose()
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

    const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.48, 1.15, 5, 12), cloth)
    body.position.y = 1.18
    const head = new THREE.Mesh(new THREE.SphereGeometry(0.34, 16, 12), skin)
    head.position.y = 2.1
    const helmet = new THREE.Mesh(new THREE.SphereGeometry(0.39, 16, 8, 0, Math.PI * 2, 0, Math.PI / 2), bronze)
    helmet.position.y = 2.15
    const plume = new THREE.Mesh(
      new THREE.BoxGeometry(0.12, 0.5, 0.65),
      new THREE.MeshStandardMaterial({ color: plumeColor, roughness: 0.7 }),
    )
    plume.position.y = 2.62
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
