// What stops you and what you stand on: static Rapier colliders made from the model's own geometry.
// One triangle-mesh collider per registered piece of the building (and one per loose mesh), so a piece
// can be switched off as a whole when it is not built yet or has burnt down. Where the section has cut the
// building away its walls let you through; its floors, stairs and the ground stay solid (see `split` below).
// Kept light for a headset: small detailed things (statues, capitals, lamps) and every instance of a repeated piece (balusters, seats, scaffold poles) are just their box.
// Every triangle also says what it is to someone who wants to be put down on it (lib/theatre/teleport.js): a floor
// like any other, something nobody stands on (NEVER: roofs, statues, the river, the houses around), or furniture
// (FURNITURE: seats, balusters, lamps: you stand on the floor under it, as you do when you walk up to it).
import * as THREE from 'three'

export const NEVER = 1, FURNITURE = 2
const STEP = 0.45, DECK = 1.5 // a box no taller than a step, or as large as a deck (m²), is a floor and not furniture

const BOX_INDEX = [0, 1, 2, 2, 1, 3, 4, 6, 5, 5, 6, 7, 0, 4, 1, 1, 4, 5, 2, 3, 6, 6, 3, 7, 0, 2, 4, 4, 2, 6, 1, 5, 3, 3, 5, 7]
const _v = new THREE.Vector3()
const _m = new THREE.Matrix4()

function pushBox(box, matrix, verts, index, tags, tag) {
  const base = verts.length / 3
  let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity, z0 = Infinity, z1 = -Infinity
  for (let i = 0; i < 8; i++) {
    _v.set(i & 1 ? box.max.x : box.min.x, i & 2 ? box.max.y : box.min.y, i & 4 ? box.max.z : box.min.z).applyMatrix4(matrix)
    verts.push(_v.x, _v.y, _v.z)
    x0 = Math.min(x0, _v.x); x1 = Math.max(x1, _v.x); y0 = Math.min(y0, _v.y); y1 = Math.max(y1, _v.y); z0 = Math.min(z0, _v.z); z1 = Math.max(z1, _v.z)
  }
  for (const k of BOX_INDEX) index.push(base + k)
  const floor = y1 - y0 <= STEP || (x1 - x0) * (z1 - z0) >= DECK
  for (let i = 0; i < 12; i++) tags.push(tag || (floor ? 0 : FURNITURE))
}

function pushMesh(geometry, matrix, verts, index, tags, tag) {
  for (let i = triangles(geometry); i > 0; i--) tags.push(tag)
  const pos = geometry.attributes.position
  const base = verts.length / 3
  for (let i = 0; i < pos.count; i++) {
    _v.fromBufferAttribute(pos, i).applyMatrix4(matrix)
    verts.push(_v.x, _v.y, _v.z)
  }
  if (geometry.index) { const a = geometry.index.array; for (let i = 0; i < a.length; i++) index.push(base + a[i]) }
  else for (let i = 0; i < pos.count; i++) index.push(base + i)
}

const triangles = (g) => (g.index ? g.index.count : g.attributes.position.count) / 3

function solid(o) {
  if (!o.isMesh || !o.geometry?.attributes?.position) return false
  if (o.userData.pocheInside) return false
  const src = o.userData.src
  if (src === 'sky' || src === 'fire' || src === 'trams' || src === 'systems') return false
  const m = o.material
  if (m && m.transparent && m.depthWrite === false) return false
  return true
}

/**
 * @returns {{ count, triangles, refresh(), allows(handle, inCut), tag(handle, feature) }} `allows` is the filter for character
 * queries: is the collider with this handle solid right now?
 */
export function buildColliders(theatre, rapier, physics) {
  const { world, root, R, ctx } = theatre
  const itemOf = (o) => { for (; o; o = o.parent) if (o.userData.item) return o.userData.item; return null }
  const underRoot = (o) => { for (; o; o = o.parent) if (o === root) return true; return false }

  // every piece in its finished place (pieces of later stages, the scaffolding that is gone again)
  const saved = R.items.map((it) => [it, it.obj.position.clone(), it.obj.scale.clone()])
  for (const [it] of saved) { it.obj.position.copy(it.basePos); it.obj.scale.copy(it.baseScale) }
  world.updateMatrixWorld(true)

  // what nobody is put down on: the roofs (copper, slate, glass), gilding and bronze, statues, the river, and
  // the houses around the theatre
  const { M } = theatre
  const never = new Set([M.copper, M.slate, M.ctxRoof, M.glass, M.gold, M.bronze, M.statue, M.water].filter(Boolean))
  const tagOf = (o) => (o.name === 'vltava' || o.name.startsWith('okoli_') || never.has(o.material) || never.has(o.userData.item?.material) ? NEVER : 0)

  const skip = new Set([ctx.hynais?.userData.item].filter(Boolean)) // the curtain rises when you come to it
  const groups = new Map() // item | mesh → { item, clipped, verts, index }
  world.traverse((o) => {
    if (!solid(o)) return
    const item = itemOf(o)
    if (item && (skip.has(item) || item.xray === 'layer')) return
    const key = item ?? o
    let g = groups.get(key)
    if (!g) groups.set(key, g = { item, clipped: underRoot(o), verts: [], index: [], tags: [] })
    const geo = o.geometry
    if (!geo.boundingBox) geo.computeBoundingBox()
    const box = geo.boundingBox
    const size = box.getSize(_v)
    const big = Math.max(size.x, size.y, size.z)
    const tag = tagOf(o)
    if (o.isInstancedMesh) {
      const base = o.userData.item?.baseMatrices ?? o.instanceMatrix.array
      // a few long pieces (stair flights, beams) keep their shape, and so does the stone frame of an open arch
      // (the five arches into the porch under the loggia): its box would wall up the opening
      const whole = (big > 6 && o.count <= 12 && triangles(geo) <= 400) || o.name.startsWith('frame-ao')
      for (let i = 0; i < o.count; i++) {
        _m.fromArray(base, i * 16).premultiply(o.matrixWorld)
        if (whole) pushMesh(geo, _m, g.verts, g.index, g.tags, tag); else pushBox(box, _m, g.verts, g.index, g.tags, tag)
      }
    } else if (triangles(geo) > 300 && big < 3) pushBox(box, o.matrixWorld, g.verts, g.index, g.tags, tag || FURNITURE)
    else pushMesh(geo, o.matrixWorld, g.verts, g.index, g.tags, tag)
  })

  for (const [it, p, s] of saved) { it.obj.position.copy(p); it.obj.scale.copy(s) }
  R.update(R.T, true)
  world.updateMatrixWorld(true)

  // In a section the cut-away part of the house is not drawn and its walls let you through, but nobody may fall
  // because of a display mode: whatever you stand on (floors, stair treads, roofs: every triangle that lies
  // flatter than about 50°) stays solid there. So each piece of the building is two colliders, what carries
  // you and what only stops you.
  const split = (verts, index, tags) => {
    const floor = [], wall = [], floorTags = [], wallTags = []
    for (let i = 0; i < index.length; i += 3) {
      const a = index[i] * 3, b = index[i + 1] * 3, c = index[i + 2] * 3
      const ux = verts[b] - verts[a], uy = verts[b + 1] - verts[a + 1], uz = verts[b + 2] - verts[a + 2]
      const vx = verts[c] - verts[a], vy = verts[c + 1] - verts[a + 1], vz = verts[c + 2] - verts[a + 2]
      const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx
      const flat = Math.abs(ny) > 0.64 * Math.hypot(nx, ny, nz)
      ;(flat ? floor : wall).push(index[i], index[i + 1], index[i + 2])
      ;(flat ? floorTags : wallTags).push(tags[i / 3])
    }
    return { floor: [floor, floorTags], wall: [wall, wallTags] }
  }
  // only the vertices a part uses (Rapier builds its tree over all of them)
  const compact = (verts, index) => {
    const map = new Map(), v = [], ix = []
    for (const k of index) {
      let n = map.get(k)
      if (n === undefined) { n = v.length / 3; map.set(k, n); v.push(verts[k * 3], verts[k * 3 + 1], verts[k * 3 + 2]) }
      ix.push(n)
    }
    return [new Float32Array(v), new Uint32Array(ix)]
  }

  const byHandle = new Map()
  const list = []
  let tris = 0
  for (const g of groups.values()) {
    if (g.index.length < 3) continue
    const parts = g.clipped ? split(g.verts, g.index, g.tags) : { wall: [g.index, g.tags] }
    for (const [kind, [index, tags]] of Object.entries(parts)) {
      if (index.length < 3) continue
      const collider = physics.createCollider(rapier.ColliderDesc.trimesh(...compact(g.verts, index)))
      const entry = { item: g.item, clipped: g.clipped, floor: kind === 'floor', on: true, tags: Uint8Array.from(tags) }
      byHandle.set(collider.handle, entry)
      list.push(entry)
      tris += index.length / 3
    }
  }
  physics.updateSceneQueries?.()

  const xrayHides = (it) => {
    const { xray, layers } = R.mode
    if (!xray) return false
    return it.xray === 'hide' || (it.xray === 'struct' && !layers.has('structure')) || (it.xray === 'layerAlways' && !layers.has(it.layer))
  }

  return {
    count: list.length,
    triangles: tris,
    /** Work out again which pieces stand (after the clock, the fire or X-ray changed). */
    refresh() {
      const burning = theatre.fire.active
      for (const e of list) {
        const it = e.item
        if (!it) { e.on = true; continue }
        let on = it.e > 0.9
        if (on && R.mode.fire && it.modern) on = false
        if (on && burning && !it.obj.visible && !xrayHides(it)) on = false // fallen in or burnt out
        e.on = on
      }
    },
    /** What the triangle a ray hit is to stand on: 0 a floor like any other, NEVER or FURNITURE (`feature`: the hit's featureId). */
    tag(handle, feature) {
      const tags = byHandle.get(handle)?.tags
      if (!tags || feature == null) return 0
      return tags[feature >= tags.length ? feature - tags.length : feature] ?? 0 // a hit from behind counts on from the last triangle
    },
    allows(handle, inCut) {
      const e = byHandle.get(handle)
      if (!e) return true
      return e.on && !(inCut && e.clipped && !e.floor)
    },
  }
}
