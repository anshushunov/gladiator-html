import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import type { Archetype } from '../simulation/fighters'
import {
  ANCHOR_NODE_NAMES,
  FIGHTER_ANCHOR_NAMES,
  FIGHTER_BONE_NAMES,
  MESH_SLOTS,
  MODEL_FILES,
  requiredClipsFor,
} from './fighterModelContract'

const ARCHETYPES: readonly Archetype[] = ['heavy', 'fast', 'technical']
const MAX_BYTES = 2 * 1024 * 1024

interface GlbJson {
  nodes: { name?: string; mesh?: number; children?: number[]; extras?: Record<string, unknown> }[]
  animations?: { name?: string }[]
}

/** Minimal GLB reader: the JSON chunk only, no three.js, no WebGL. */
function readGlbJson(path: string): { json: GlbJson; byteLength: number } {
  const buffer = readFileSync(path)
  if (buffer.readUInt32LE(0) !== 0x46546c67) throw new Error(`${path} is not a GLB (bad magic)`)
  const jsonLength = buffer.readUInt32LE(12)
  const json = JSON.parse(buffer.subarray(20, 20 + jsonLength).toString('utf8')) as GlbJson
  return { json, byteLength: buffer.byteLength }
}

describe.each(ARCHETYPES)('shipped model for %s', (archetype) => {
  const path = resolve(process.cwd(), 'public', MODEL_FILES[archetype])

  it('exists under public/models', () => {
    expect(existsSync(path), `${path} missing -- run npm run models:build`).toBe(true)
  })

  it('carries every bone and anchor the runtime addresses by name', () => {
    const { json } = readGlbJson(path)
    const names = new Set(json.nodes.map((node) => node.name))
    for (const bone of FIGHTER_BONE_NAMES) expect(names, `bone ${bone}`).toContain(bone)
    for (const anchor of FIGHTER_ANCHOR_NAMES) expect(names, `anchor ${anchor}`).toContain(ANCHOR_NODE_NAMES[anchor])
  })

  it('carries every clip the mapping can select for this archetype', () => {
    const { json } = readGlbJson(path)
    const clips = new Set((json.animations ?? []).map((animation) => animation.name))
    for (const clip of requiredClipsFor(archetype)) expect(clips, `clip ${clip}`).toContain(clip)
  })

  it('tags every mesh node with a known silhouette slot', () => {
    const { json } = readGlbJson(path)
    const meshNodes = json.nodes.filter((node) => node.mesh !== undefined)
    expect(meshNodes.length).toBeGreaterThan(0)
    for (const node of meshNodes) {
      const slot = node.extras?.slot
      expect(MESH_SLOTS.has(String(slot)), `${node.name} has slot ${String(slot)}`).toBe(true)
    }
  })

  it('stays under the size budget', () => {
    expect(readGlbJson(path).byteLength).toBeLessThan(MAX_BYTES)
  })
})
