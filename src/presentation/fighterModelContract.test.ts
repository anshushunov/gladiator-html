import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { PropertyBinding } from 'three'
import { describe, expect, it } from 'vitest'
import type { Archetype } from '../simulation/fighters'
import { BODY_SILHOUETTE_SLOTS, HELD_EQUIPMENT_SLOTS } from './ArenaView'
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

/**
 * Every node `createSkinnedFighter` addresses by name. `handslot.l`/`handslot.r`
 * are deliberately in both source lists (they are bones AND the two hand
 * anchors), so this is de-duplicated before anything is asserted about it.
 */
const REQUIRED_NODE_NAMES: readonly string[] = [...new Set([...FIGHTER_BONE_NAMES, ...Object.values(ANCHOR_NODE_NAMES)])]

/**
 * The exact transform `GLTFLoader` applies to a node name before assigning it
 * (`createUniqueName` -> `PropertyBinding.sanitizeNodeName`): strips the
 * characters three.js reserves for property paths, `[ ] . : /`, and turns
 * whitespace into `_`. Three.js's own function rather than a local copy of the
 * regex, so this test cannot drift away from the loader it is describing --
 * which is the same reason `SkinnedFighter.createSkinnedFighter` calls it too.
 */
const sanitize = (name: string): string => PropertyBinding.sanitizeNodeName(name)

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

  /**
   * `GLTFLoader` does not use a node's authored name verbatim: it sanitizes
   * first (see `sanitize` above) and de-duplicates SECOND, appending `_1`,
   * `_2`, ... to whichever colliding node it reaches later. Every bone in this
   * pack is named `upperarm.l`-style, so the loaded scene actually holds
   * `upperarml` -- which is why `createSkinnedFighter` looks nodes up by their
   * sanitized name rather than by the authored one.
   *
   * The failure mode that translation opens is silent, and the "carries every
   * bone and anchor" test above cannot see it: that one asserts the authored,
   * dotted names, which are exactly what stays in the file no matter what the
   * loader does with them afterwards. If a rebuilt pack ever shipped two nodes
   * whose names collapse to the same sanitized string -- a `hand.l` next to a
   * `handl`, or a mesh reusing a bone's name -- the loader would hand the
   * un-suffixed name to whichever it reached first and suffix the other, and
   * `byName.get(...)` would silently bind the WRONG node instead of throwing.
   * Nothing downstream would report it: the rig would build, every bone would
   * resolve, and one limb would simply be driven by another limb's track.
   */
  it('has no node that collides with a required node once GLTFLoader sanitizes it', () => {
    const { json } = readGlbJson(path)

    // (1) The contract's own names must stay distinct under sanitization, or
    // two different bones would address one and the same loaded node.
    const sanitizedRequired = REQUIRED_NODE_NAMES.map(sanitize)
    expect(
      new Set(sanitizedRequired).size,
      `two required node names sanitize to the same string: ${sanitizedRequired.join(', ')}`,
    ).toBe(REQUIRED_NODE_NAMES.length)

    // (2) ...and no OTHER node in the file may sanitize onto one of them.
    const requiredBySanitized = new Map(REQUIRED_NODE_NAMES.map((name) => [sanitize(name), name]))
    for (const node of json.nodes) {
      if (node.name === undefined) continue
      const claimed = requiredBySanitized.get(sanitize(node.name))
      if (claimed === undefined) continue
      expect(node.name, `node "${node.name}" sanitizes onto required node "${claimed}"`).toBe(claimed)
    }

    // (3) ...and each required node appears exactly once under its own authored
    // name. Two literal `handslot.l` nodes collide after sanitization just as
    // surely as a `handslot.l` and a `handslotl` do, and (2) cannot see that
    // case because both of them match the required name exactly.
    for (const name of REQUIRED_NODE_NAMES) {
      const occurrences = json.nodes.filter((node) => node.name === name).length
      expect(occurrences, `node ${name} appears ${occurrences} times, expected exactly once`).toBe(1)
    }
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

/**
 * `ArenaView` splits every slot into "worn" (counts toward the scale floor's
 * `bodyHeightPx`) and "held" (counts toward `fullBoundsPx` only). The safe
 * direction for an *unknown* slot is that it cannot inflate a body-size floor,
 * so `accumulateProjectedBounds` silently drops it from the body set -- which
 * means a newly worn slot added to a rebuilt pack would silently *under*-report
 * the very number the floor is asserted on. Pinning the partition here (rather
 * than only the membership `MESH_SLOTS` already checks against the files) is
 * what turns that silence into a failing test.
 */
describe('silhouette slot partition', () => {
  it('covers every slot the shipped models may carry, exactly once', () => {
    expect([...BODY_SILHOUETTE_SLOTS].filter((slot) => HELD_EQUIPMENT_SLOTS.has(slot))).toEqual([])
    expect(new Set([...BODY_SILHOUETTE_SLOTS, ...HELD_EQUIPMENT_SLOTS])).toEqual(new Set(MESH_SLOTS))
  })
})
