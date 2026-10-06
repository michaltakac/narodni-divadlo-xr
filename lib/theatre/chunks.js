// Headset rendering: far fewer draw calls and triangles than the ~830 separate pieces of the model.
//
// A piece of the building only moves while its construction stage animates (or it burns, or it is one of the
// few things that always move). Once its stage is finished it never moves apart again, so all finished pieces
// that share a stage, a material and an X-ray behaviour are merged into one mesh (a "chunk"). While a chunk
// stands in for its pieces they are put on a layer no camera draws; when the clock goes back into their
// stage, or the fire takes them, the chunk steps aside and the separate animated pieces are drawn again.
//
// Chunks also know where they are: the inside of the theatre is not drawn while you are outside (and the
// other way round), and a façade is not drawn from behind. X-ray, the section and the fire show the whole house,
// which is the most there is to draw, so there the headset leaves out what the picture does not need: the far
// surroundings, the trams and the trees, the small carved pieces of the ghost shell in X-ray (balusters, statues,
// moulded frames: it is a transparent hint of the house), and in a section the half of the house that is cut
// away (the merged pieces are parted along the long axis where the section first cuts, so that half is not
// sent to the graphics card at all). A computer draws the separate pieces and keeps all of it.
import * as THREE from 'three'
import { FRAME, FP, H, bToWorld } from '../nd/config.js'
import { offsetPolygon, pointInPolygon } from '../nd/core/geom.js'

const HIDDEN = 5 // a layer no camera has (1 and 2 are the eyes in WebXR)
const NEAR_SITE = 115 // metres from the middle of the house: the streets round it, the embankment, the houses opposite
const DETAIL = { size: 4, triangles: 40 } // a piece of the shell smaller than this and finer than this is ornament
const SLICE_AT = -1.9 // the house in two halves along its long axis, parted where the section first cuts (model.js)
const MAX_INSTANCE_VERTS = 1500000 // a repeated piece bigger than this stays one instanced draw call
const EPS = 1e-4

const _v = new THREE.Vector3()
const _n = new THREE.Vector3()
const _m = new THREE.Matrix4()
const _nm = new THREE.Matrix3()
const _c = new THREE.Vector3()

const cosR = Math.cos(FRAME.rotationY), sinR = Math.sin(FRAME.rotationY)
/** world → building frame (u east, y up, v south) */
export function toBuilding(p, out = new THREE.Vector3()) {
  const dx = p.x - FRAME.origin.x, dz = p.z - FRAME.origin.z
  return out.set(dx * cosR - dz * sinR, p.y, dx * sinR + dz * cosR)
}

// which way a point outside the plan faces: the outward normal of the nearest edge of the footprint
const OUTLINE = FP.all
function sideOf(u, v) {
  let best = Infinity, side = 'N'
  for (let i = 0; i < OUTLINE.length; i++) {
    const a = OUTLINE[i], b = OUTLINE[(i + 1) % OUTLINE.length]
    const ex = b[0] - a[0], ez = b[1] - a[1]
    const l2 = ex * ex + ez * ez || 1
    const t = Math.min(1, Math.max(0, ((u - a[0]) * ex + (v - a[1]) * ez) / l2))
    const px = a[0] + ex * t, pz = a[1] + ez * t
    const d = (u - px) ** 2 + (v - pz) ** 2
    if (d < best) {
      best = d
      // CCW outline in (u, v): outward normal is (ez, −ex)
      const nx = ez, nz = -ex
      side = Math.abs(nx) > Math.abs(nz) ? (nx > 0 ? 'E' : 'W') : (nz > 0 ? 'S' : 'N')
    }
  }
  return side
}

// rooms: inside the outer walls of the main house and the south wing (the walls are about a metre thick)
const DEEP = [offsetPolygon(FP.main, -1.4), offsetPolygon(FP.south, -1.4)]
const NEAR = offsetPolygon(FP.all, 0.4)
/**
 * 'in' in a room of the house, 'out' clear of it (also in the loggia and on the roofs, which are open to the
 * street), 'edge' in between: in a wall, on the terrace, at the foot of a façade.
 */
export function whereIs(b) {
  if (b.y > H.cornice || b.y < H.foundation - 1) return 'out'
  if (!pointInPolygon(b.x, b.z, NEAR)) return 'out'
  if (DEEP.some((poly) => pointInPolygon(b.x, b.z, poly))) return 'in'
  if (pointInPolygon(b.x, b.z, FP.loggia)) return 'out'
  return 'edge'
}
const overHouse = (b) => b.y > H.cornice && pointInPolygon(b.x, b.z, NEAR)

// the same place: a few millimetres are allowed in position (his stage bars stop easing that close to their rest)
const same = (a, b) => {
  const x = a.elements, y = b.elements
  for (let i = 0; i < 16; i++) if (Math.abs(x[i] - y[i]) > (i >= 12 && i < 15 ? 6e-3 : 1e-4)) return false
  return true
}
const vertexCount = (g) => g.attributes.position.count
const indexCount = (g) => (g.index ? g.index.count : g.attributes.position.count)

export function createChunks(theatre) {
  const { world, root, R, fire, cut } = theatre
  const [long, plan] = theatre.planes // the long section and the horizontal section (world space)
  const group = new THREE.Group()
  group.name = 'merged finished stages'
  group.visible = false
  world.add(group)

  const itemOf = (o) => { for (; o; o = o.parent) if (o.userData.item) return o.userData.item; return null }
  const underRoot = (o) => { for (; o; o = o.parent) if (o === root) return true; return false }
  const foyer = (o) => { for (; o; o = o.parent) if (o.name === 'foyer-frame') return true; return false }
  const dynamic = new Set() // items and loose meshes that keep moving on their own: never merged
  const chunks = new Map()
  let sources = null
  let probe = null
  let enabled = false

  // what the fire takes (same rule as Fire.start in lib/nd/fx/fire.js)
  const burns = (it) => {
    if (!it || it.obj.userData.survives || foyer(it.obj)) return false
    return (it.stage === 2 && it.remove == null) || it.stage === 4 || it.stage === 5
  }

  function collect() {
    sources = []
    world.updateMatrixWorld(true)
    world.traverse((o) => {
      if (!o.isMesh || o.parent === group) return
      const src = o.userData.src
      if (src === 'sky' || src === 'fire' || !o.geometry?.attributes?.position) return
      const inside = !!o.userData.pocheInside
      const item = itemOf(o)
      // the material the piece has outside X-ray (the registry swaps in ghosts)
      const material = inside ? o.material : item && item.obj === o ? item.material : (o.userData.origMat ?? o.material)
      sources.push({ mesh: o, item, inside, src, clipped: underRoot(o), baseMaterial: material })
    })
  }

  const zoneOf = (s, bx, by, bz) => {
    if (s.src === 'trams') return 'trams'
    if (s.src === 'site') return s.mesh.isInstancedMesh ? 'trees' : 'site'
    if (s.src === 'facade') return by > H.cornice - 0.6 ? 'top' : sideOf(bx, bz)
    if (s.src === 'interior' || s.src === 'partitions' || s.src === 'stage') return 'int'
    if (s.src === 'systems') return 'sys'
    return 'shell'
  }

  function keyOf(s, zone, material) {
    const it = s.item
    return [
      it ? `${it.stage}/${it.remove}/${it.until}/${it.xray}/${it.layer}/${it.modern ? 1 : 0}/${burns(it) ? 1 : 0}` : 'loose',
      material.uuid, zone, s.inside ? 'i' : 'f', s.clipped ? 'c' : 'u', s.mesh.castShadow ? 1 : 0, s.mesh.receiveShadow ? 1 : 0, s.mesh.renderOrder,
      s.detail ? 'd' : '',
    ].join('|')
  }

  // one source (or one instance of it) appended to a chunk's arrays, in world space
  // how far a chunk reaches down and across the long axis: what the two section planes ask
  const grow = (chunk, x, y, z) => {
    if (y < chunk.yMin) chunk.yMin = y
    const d = long.normal.x * x + long.normal.y * y + long.normal.z * z
    if (d > chunk.acrossMax) chunk.acrossMax = d
  }
  // `keep(P, a, b, c)`: only the triangles it accepts (the offsets of their corners in the world positions P)
  function append(chunk, geo, matrix, keep) {
    const pos = geo.attributes.position, nor = geo.attributes.normal, uv = geo.attributes.uv
    const base = chunk.count
    const n = pos.count
    chunk.reserve(n, indexCount(geo))
    _nm.getNormalMatrix(matrix)
    const flip = matrix.determinant() < 0
    const P = chunk.position, N = chunk.normal, UV = chunk.uv
    for (let i = 0; i < n; i++) {
      _v.fromBufferAttribute(pos, i).applyMatrix4(matrix)
      const k = (base + i) * 3
      P[k] = _v.x; P[k + 1] = _v.y; P[k + 2] = _v.z
      if (!keep) grow(chunk, _v.x, _v.y, _v.z)
      if (nor) { _n.fromBufferAttribute(nor, i).applyMatrix3(_nm).normalize(); N[k] = _n.x * 127; N[k + 1] = _n.y * 127; N[k + 2] = _n.z * 127 } else N[k + 1] = 127
      if (uv) { UV[(base + i) * 2] = uv.getX(i); UV[(base + i) * 2 + 1] = uv.getY(i) }
    }
    const I = chunk.index
    let w = chunk.indices
    const a = geo.index?.array
    for (let i = 0, end = a ? a.length : n; i < end; i += 3) {
      const i0 = base + (a ? a[i] : i), i1 = base + (a ? a[i + 1] : i + 1), i2 = base + (a ? a[i + 2] : i + 2)
      if (keep) {
        if (!keep(P, i0 * 3, i1 * 3, i2 * 3)) continue
        for (const k of [i0 * 3, i1 * 3, i2 * 3]) grow(chunk, P[k], P[k + 1], P[k + 2])
      }
      I[w++] = i0; I[w++] = flip ? i2 : i1; I[w++] = flip ? i1 : i2
    }
    chunk.indices = w
    chunk.count += n
  }

  function newChunk(key, s, zone, merged) {
    const chunk = {
      key, zone, merged, item: s.item, inside: s.inside, clipped: s.clipped, baseMaterial: s.baseMaterial, burns: burns(s.item),
      sources: [], count: 0, indices: 0, triangles: 0,
      position: merged ? new Float32Array(3000) : null, normal: merged ? new Int8Array(3000) : null, uv: merged ? new Float32Array(2000) : null, index: merged ? new Uint32Array(3000) : null,
      steady: 0, restless: 0, mesh: null, box: new THREE.Box3(), yMin: Infinity, acrossMax: -Infinity,
      reserve(nv, ni) {
        if ((this.count + nv) * 3 > this.position.length) {
          const size = Math.max((this.count + nv) * 3, this.position.length * 2)
          const grow = (a, len) => { const b = new a.constructor(len); b.set(a); return b }
          this.position = grow(this.position, size); this.normal = grow(this.normal, size); this.uv = grow(this.uv, (size / 3) * 2)
        }
        if (this.indices + ni > this.index.length) { const b = new Uint32Array(Math.max(this.indices + ni, this.index.length * 2)); b.set(this.index); this.index = b }
      },
    }
    chunks.set(key, chunk)
    return chunk
  }

  // the chunk a source (or one instance of it) at `matrix` belongs to
  // `part`: only a part of the mesh goes in ({ zone | half, keep }, see build)
  const bucket = (s, matrix, geo, merged, part) => {
    geo.boundingBox ?? geo.computeBoundingBox()
    geo.boundingBox.getCenter(_c).applyMatrix4(matrix)
    // the building's pieces go by the half of the house they are in, so a section can leave a half out
    const half = s.clipped && merged ? part?.half ?? (sides(geo, matrix) === 1 ? 0 : 1) : ''
    toBuilding(_c, _c)
    const zone = part?.zone ?? zoneOf(s, _c.x, _c.y, _c.z)
    const key = merged ? `${keyOf(s, zone, s.baseMaterial)}|${half}` : `apart|${(s.item?.obj ?? s.mesh).uuid}|${zone}`
    const chunk = chunks.get(key) ?? newChunk(key, s, zone, merged)
    chunk.detail = !!s.detail
    chunk.box.expandByPoint(_c)
    if (merged) append(chunk, geo, matrix, part?.keep)
    return chunk
  }
  const isFar = (P, a, b, c) => Math.hypot((P[a] + P[b] + P[c]) / 3 - middle.x, (P[a + 2] + P[b + 2] + P[c + 2]) / 3 - middle.z) > NEAR_SITE
  // Which half of the house: 0 is what lies wholly on the river side of the line where the section first cuts
  // (so with the section there that half is left out as a whole), 1 is everything that reaches across it.
  const beyond = (x, z) => long.normal.x * x + long.normal.z * z - across0 < SLICE_AT
  const inHalf0 = (P, a, b, c) => beyond(P[a], P[a + 2]) && beyond(P[b], P[b + 2]) && beyond(P[c], P[c + 2])
  // the corners of a mesh's box: 1 all beyond the line, 2 none, 3 on both sides
  const sides = (geo, matrix) => {
    const { min, max } = geo.boundingBox
    let seen = 0
    for (let i = 0; i < 8; i++) { _v.set(i & 1 ? max.x : min.x, i & 2 ? max.y : min.y, i & 4 ? max.z : min.z).applyMatrix4(matrix); seen |= beyond(_v.x, _v.z) ? 1 : 2 }
    return seen
  }

  const showPieces = (c, on) => { if (on) for (const s of c.sources) s.want = true }
  const applyPieces = () => { for (const s of sources) { s.mesh.layers.set(s.want ? 0 : HIDDEN); s.want = false } }

  function build() {
    for (const c of chunks.values()) if (c.mesh) { c.mesh.geometry.dispose(); group.remove(c.mesh) }
    for (const s of sources ?? []) s.mesh.layers.set(0)
    chunks.clear()
    collect()
    // pieces in their finished places, whatever the clock says now
    const saved = R.items.map((it) => [it, it.obj.position.clone(), it.obj.scale.clone()])
    for (const [it] of saved) { it.obj.position.copy(it.basePos); it.obj.scale.copy(it.baseScale) }
    world.updateMatrixWorld(true)
    for (const s of sources) {
      const o = s.mesh
      const geo = o.geometry
      const touched = new Set()
      // not merged: what moves by itself (trams, the turntable, the curtain) and very big repeated pieces
      const merged = s.src !== 'trams' && !dynamic.has(s.item ?? o) && !(o.isInstancedMesh && o.count * vertexCount(geo) > MAX_INSTANCE_VERTS)
      // ornament of the shell: what X-ray turns into a ghost and is small and finely modelled
      const ghost = s.item?.xray === 'ghost' || s.item?.xray === 'ghostSoft'
      geo.boundingBox ?? geo.computeBoundingBox()
      geo.boundingBox.getSize(_c)
      s.detail = ghost && (s.src === 'facade' || s.src === 'shell') && Math.max(_c.x, _c.y, _c.z) < DETAIL.size && indexCount(geo) / 3 >= DETAIL.triangles
      if (s.src === 'site' && merged && !o.isInstancedMesh) {
        // the ground, the streets and the neighbouring houses are single meshes that reach half a kilometre: near and far part
        for (const far of [false, true]) touched.add(bucket(s, o.matrixWorld, geo, true, { zone: far ? 'far' : 'site', keep: (P, a, b, c) => isFar(P, a, b, c) === far }))
      } else if (s.clipped && merged && !o.isInstancedMesh && sides(geo, o.matrixWorld) === 3) {
        // a floor, a long wall, a whole storey of partitions: parted along the axis, triangle by triangle
        for (const half of [0, 1]) touched.add(bucket(s, o.matrixWorld, geo, true, { half, keep: (P, a, b, c) => inHalf0(P, a, b, c) === (half === 0) }))
      } else if (o.isInstancedMesh && merged) {
        const owner = o.userData.item ?? (s.inside ? o.parent.userData.item : null) // a wall's dark twin shares its instances
        const base = owner?.baseMatrices ?? o.instanceMatrix.array
        for (let i = 0; i < o.count; i++) touched.add(bucket(s, _m.fromArray(base, i * 16).premultiply(o.matrixWorld), geo, true))
      } else touched.add(bucket(s, o.matrixWorld, geo, merged))
      s.matrix = o.matrixWorld.clone()
      for (const c of touched) c.sources.push(s)
    }
    for (const [it, p, sc] of saved) { it.obj.position.copy(p); it.obj.scale.copy(sc) }
    R.update(R.T, true)
    world.updateMatrixWorld(true)

    for (const c of [...chunks.values()]) {
      if (!c.merged) continue
      if (!c.indices) { chunks.delete(c.key); continue } // a far part with nothing in it
      const g = new THREE.BufferGeometry()
      g.setAttribute('position', new THREE.BufferAttribute(c.position.slice(0, c.count * 3), 3))
      g.setAttribute('normal', new THREE.BufferAttribute(c.normal.slice(0, c.count * 3), 3, true))
      g.setAttribute('uv', new THREE.BufferAttribute(c.uv.slice(0, c.count * 2), 2))
      g.setIndex(new THREE.BufferAttribute(c.index.slice(0, c.indices), 1))
      g.computeBoundingSphere()
      c.position = c.normal = c.uv = c.index = null
      c.triangles = c.indices / 3
      const mesh = new THREE.Mesh(g, c.baseMaterial)
      const first = c.sources[0].mesh
      mesh.castShadow = first.castShadow
      mesh.receiveShadow = first.receiveShadow
      mesh.renderOrder = first.renderOrder
      mesh.name = `merged ${c.zone} ${first.name || first.userData.src}`
      mesh.visible = false
      mesh.raycast = () => {}
      c.mesh = mesh
      group.add(mesh)
    }
  }

  const windowOpen = (c, T) => {
    const it = c.item
    if (!it) return true
    if (it.stage != null && T < it.stage + 1 - EPS) return false
    if (it.remove != null && T > it.remove + EPS) return false
    if (it.until != null && T > it.until) return false
    return true
  }

  // where the house stands, and the long axis in the terms of the section plane (its constant is −(across0 + u))
  const middle = bToWorld(0, 0, 40)
  const ghosts = [theatre.M.ghost, theatre.M.ghostSoft, theatre.M.ghostStruct].flatMap((m) => [m, theatre.unclip(m)])
  const across0 = -long.constant - (cut.on ? cut.u : -1000)

  const stats = { chunks: 0, merged: 0, shown: 0, triangles: 0, rebuilds: 0 }
  const b = new THREE.Vector3()

  return {
    group, stats, chunks,
    get enabled() { return enabled },

    /** Merge on (headset) or back to the separate pieces (computer). */
    setEnabled(on) {
      if (on === enabled) return
      enabled = on
      if (!on) {
        for (const c of chunks.values()) if (c.mesh) c.mesh.visible = false
        for (const s of sources ?? []) s.mesh.layers.set(0)
      }
      // three.js draws a see-through two-sided surface twice (backs, then fronts). The ghost shell writes no
      // depth and is a faint hint, so one pass looks the same and halves its triangles.
      for (const m of ghosts) m.forceSinglePass = on
      group.visible = on
    },

    /** Once a frame, after the theatre's own tick. `eye` is the viewer's head in world space. */
    update(eye) {
      if (!enabled) return
      if (!sources) {
        // before the first merge, watch two frames: whatever moves by itself (the turntable) is left out from the start
        if (!probe) { collect(); probe = sources.map((s) => s.mesh.matrixWorld.clone()); sources = null; return }
        collect()
        sources.forEach((s, i) => { if (probe[i] && !same(s.mesh.matrixWorld, probe[i])) dynamic.add(s.item ?? s.mesh) })
        if (theatre.ctx.hynais?.userData.item) dynamic.add(theatre.ctx.hynais.userData.item) // the curtain rises when you step behind it
        build()
        stats.rebuilds++
      }
      const T = R.T
      const burning = fire.active
      const { xray, layers } = R.mode
      toBuilding(eye, b)
      const where = whereIs(b)
      const above = overHouse(b)
      // X-ray and the section look through the house; so does the fire once the roof starts to fall in
      const everything = xray || cut.on || (burning && fire.t > 7.4)
      const roofed = T >= 3
      let rebuild = false
      stats.merged = stats.shown = stats.triangles = 0
      for (const c of chunks.values()) {
        // ---- where it is and where you are
        let seen = true
        const z = c.zone
        if (!everything) {
          if (z === 'int') seen = where !== 'out' || !roofed
          else if (z === 'site' || z === 'far' || z === 'trees' || z === 'trams' || z === 'top') seen = where !== 'in'
          else if (z === 'sys') seen = false
        }
        // X-ray and a section are about the house: no far surroundings, trams or trees, and a plainer ghost
        if ((xray || cut.on) && (z === 'far' || z === 'trees' || z === 'trams')) seen = false
        if (xray && c.detail) seen = false
        if (!xray && (z === 'N' || z === 'E' || z === 'S' || z === 'W')) {
          // a façade is seen from in front of it, or from above the roofs
          if (where === 'in') seen = everything
          else if (!above) seen = z === 'N' ? b.z < c.box.max.z : z === 'S' ? b.z > c.box.min.z : z === 'W' ? b.x < c.box.max.x : b.x > c.box.min.x
        }
        // wholly in the part the section has cut away: nothing of it would be drawn
        if (seen && cut.on && c.merged && c.clipped && (c.acrossMax + long.constant < 0 || plan.constant - c.yMin < 0)) seen = false

        // ---- merged, or its separate pieces
        let merged = false
        if (c.merged && windowOpen(c, T) && !(burning && c.burns)) {
          let rest = true
          for (const s of c.sources) if (!same(s.mesh.matrixWorld, s.matrix)) { rest = false; break }
          // steady for a few frames: the pieces' world matrices are final only after they were drawn once
          c.steady = rest ? c.steady + 1 : 0
          merged = c.steady >= 3
          // something in it keeps moving by itself (the stage lifts while they demonstrate): take it out for good
          c.restless = rest ? 0 : c.restless + 1
          if (c.restless > 1500) {
            for (const s of c.sources) if (!same(s.mesh.matrixWorld, s.matrix)) dynamic.add(s.item ?? s.mesh)
            rebuild = true
          }
        } else c.steady = c.restless = 0
        showPieces(c, !merged && seen)
        if (!c.mesh) continue
        if (!merged) { c.mesh.visible = false; continue }
        stats.merged++

        // ---- the registry's X-ray rules (Registry.applyVisibility), for the whole chunk at once
        const it = c.item
        let visible = seen
        let material = c.baseMaterial
        if (it) {
          const ghost = (kind) => { const m = R.ghostMaterials[kind]; return m ? (c.clipped ? m : theatre.unclip(m)) : material }
          switch (it.xray) {
            case 'ghost': if (xray) material = ghost('shell'); break
            case 'ghostSoft': if (xray) material = ghost('soft'); break
            case 'hide': if (xray) visible = false; break
            case 'struct': if (xray) { visible &&= layers.has('structure'); material = ghost('structure') } break
            case 'layer': visible &&= xray && layers.has(it.layer); break
            case 'layerAlways': if (xray) { visible &&= layers.has(it.layer); material = ghost('layer:' + it.layer) } break
            default: break
          }
          if (R.mode.fire && it.modern) visible = false
        }
        if (c.inside) visible = visible && cut.on && material === c.baseMaterial // the dark cut face of a wall
        else if (c.mesh.material !== material) c.mesh.material = material
        c.mesh.visible = visible
        if (visible) { stats.shown++; stats.triangles += c.triangles }
      }
      applyPieces() // a piece is drawn by itself when any chunk it is part of wants that
      stats.chunks = chunks.size
      if (rebuild) { build(); stats.rebuilds++ }
    },
  }
}
