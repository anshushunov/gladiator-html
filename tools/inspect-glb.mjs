// Prints what a .glb actually contains, without a browser or a viewer:
// node/mesh counts, animation names with durations, every mesh node's
// `extras.slot`, and the world-space position of named nodes relative to a
// chosen ancestor. Reads the JSON chunk only -- no three.js, no WebGL.
//
//   node tools/inspect-glb.mjs public/models/*.glb
//   node tools/inspect-glb.mjs --relative-to=root --nodes=weaponTip,hitCenter f.glb
import { readFileSync } from 'node:fs'

const args = process.argv.slice(2)
const opt = (name, fallback) => {
  const hit = args.find((a) => a.startsWith(`--${name}=`))
  return hit ? hit.slice(name.length + 3) : fallback
}
const files = args.filter((a) => !a.startsWith('--'))
const relativeTo = opt('relative-to', 'root')
const wanted = opt('nodes', 'weaponTip,shieldCenter,hitCenter,handslot.r,handslot.l').split(',')

function readGlbJson(path) {
  const buffer = readFileSync(path)
  if (buffer.readUInt32LE(0) !== 0x46546c67) throw new Error(`${path}: bad GLB magic`)
  const jsonLength = buffer.readUInt32LE(12)
  return { json: JSON.parse(buffer.subarray(20, 20 + jsonLength).toString('utf8')), bytes: buffer.byteLength }
}

const mul = (a, b) => {
  const out = new Array(16).fill(0)
  for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++) for (let k = 0; k < 4; k++) out[c * 4 + r] += a[k * 4 + r] * b[c * 4 + k]
  return out
}
/** Column-major TRS -> 4x4, matching glTF's own node convention. */
function trs(node) {
  if (node.matrix) return node.matrix
  const [x, y, z, w] = node.rotation ?? [0, 0, 0, 1]
  const [sx, sy, sz] = node.scale ?? [1, 1, 1]
  const [tx, ty, tz] = node.translation ?? [0, 0, 0]
  const r = [
    1 - 2 * (y * y + z * z), 2 * (x * y + z * w), 2 * (x * z - y * w),
    2 * (x * y - z * w), 1 - 2 * (x * x + z * z), 2 * (y * z + x * w),
    2 * (x * z + y * w), 2 * (y * z - x * w), 1 - 2 * (x * x + y * y),
  ]
  return [
    r[0] * sx, r[1] * sx, r[2] * sx, 0,
    r[3] * sy, r[4] * sy, r[5] * sy, 0,
    r[6] * sz, r[7] * sz, r[8] * sz, 0,
    tx, ty, tz, 1,
  ]
}

for (const file of files) {
  const { json, bytes } = readGlbJson(file)
  const nodes = json.nodes ?? []
  const world = new Array(nodes.length)
  const walk = (i, parent) => {
    world[i] = mul(parent, trs(nodes[i]))
    for (const child of nodes[i].children ?? []) walk(child, world[i])
  }
  const identity = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]
  for (const scene of json.scenes ?? []) for (const rootNode of scene.nodes ?? []) walk(rootNode, identity)
  const byName = new Map(nodes.map((n, i) => [n.name, i]))
  const pos = (i) => world[i]?.slice(12, 15).map((v) => Number(v.toFixed(3)))
  const origin = pos(byName.get(relativeTo)) ?? [0, 0, 0]

  console.log(`\n=== ${file}  ${(bytes / 1024).toFixed(1)} KiB`)
  console.log(`nodes ${nodes.length}  meshes ${(json.meshes ?? []).length}  materials ${(json.materials ?? []).length}` +
    `  images ${(json.images ?? []).length}  skins ${(json.skins ?? []).length}  animations ${(json.animations ?? []).length}`)

  console.log('animations:')
  for (const anim of json.animations ?? []) {
    const ends = anim.samplers.map((s) => json.accessors[s.input]?.max?.[0] ?? 0)
    console.log(`  ${anim.name}  ${Math.max(0, ...ends).toFixed(3)}s  channels ${anim.channels.length}`)
  }

  console.log('mesh nodes (extras.slot):')
  for (const [i, node] of nodes.entries()) {
    if (node.mesh === undefined) continue
    console.log(`  ${node.name}  slot=${node.extras?.slot ?? '<none>'}  at ${pos(i)}`)
  }

  console.log(`named nodes, relative to "${relativeTo}":`)
  for (const name of wanted) {
    const i = byName.get(name)
    if (i === undefined) { console.log(`  ${name}  MISSING`); continue }
    const p = pos(i)
    console.log(`  ${name}  ${p.map((v, k) => Number((v - origin[k]).toFixed(3)))}`)
  }
}
