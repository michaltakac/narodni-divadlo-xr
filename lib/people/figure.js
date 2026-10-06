// A whole person, built in code from the shapes Lukáš's statues are made of (lofted rings, ellipsoids, tapered
// limbs), dressed as people were in Prague between 1868 and 1883. One figure is one skinned mesh, so one draw
// call, of about two thousand triangles: the cloth and skin colours are vertex colours, and thirteen rigid
// bones (hips, chest, head, two arms of three parts, two legs of two) move it.
//
//   geometryFor(look)        the mesh of an outfit in one cloth colour and skin tone (built once, then shared)
//   new Figure()             .mesh goes into the scene; .setLook(look); .update(dt, head, left, right, options)
//
// The figure is posed from what the multi-user kit knows of a person: where the head is and where it looks,
// and in a headset where the hands are. Everything else follows: the body stands under the neck and turns
// towards the walking direction, legs step by the distance walked, arms hang and swing or reach for the hands.
// A figure faces −z like a camera, +x is its right hand. Sizes below are for a person 1.72 m tall.
import { Bone, BufferGeometry, Color, Euler, Float32BufferAttribute, Matrix4, MeshStandardMaterial, Quaternion, Skeleton, SkinnedMesh, Sphere, Uint16BufferAttribute, Vector3 } from 'three'
import { OUTFITS, SKINS, packLook } from './wardrobe.js'
import { mirrorPass } from './mirror.js'

export const B = { hips: 0, chest: 1, head: 2, armL: 3, foreL: 4, handL: 5, armR: 6, foreR: 7, handR: 8, thighL: 9, shinL: 10, thighR: 11, shinR: 12 }
// where each bone turns, in the pose the mesh is built in (standing, arms down)
const PIVOT = [
  [0, 0.95, 0], [0, 1.1, 0], [0, 1.49, 0],
  [-0.195, 1.385, 0], [-0.2, 1.07, 0], [-0.2, 0.81, 0],
  [0.195, 1.385, 0], [0.2, 1.07, 0], [0.2, 0.81, 0],
  [-0.09, 0.93, 0], [-0.09, 0.49, 0],
  [0.09, 0.93, 0], [0.09, 0.49, 0],
]
const DESIGN = 1.72 // the height the shapes below are drawn for
const EYE = 1.615 // its eyes
const NECK = 1.49
// shoulder to elbow, elbow to wrist, and from the wrist to the middle of the palm, where a controller is held
const ARM = 0.315, FORE = 0.26, PALM = 0.07, THIGH = 0.44, SHIN = 0.415, ANKLE = 0.075
/** Eye height of a person on a computer (lib/theatre/app.js EYE): their feet are this far under the head they send. */
const SCREEN_EYE = 1.65

// ---------------------------------------------------------------------------------------------- building
const _col = new Color()
const WHITE = new Color('#ffffff')
/** A colour lighter (f > 1, towards white) or darker (f < 1). */
function tone(hex, f) {
  _col.set(hex)
  if (f >= 1) _col.lerp(WHITE, Math.min(1, f - 1)); else _col.multiplyScalar(f)
  return '#' + _col.getHexString()
}
function mix(a, b, t) { return '#' + _col.set(a).lerp(new Color(b), t).getHexString() }
const rgb = new Map()
const rgbOf = (hex) => { let c = rgb.get(hex); if (!c) { c = new Color(hex); rgb.set(hex, c) } return c }
const pairs = (bone) => (typeof bone === 'number' ? [[bone, 1]] : bone)

class Build {
  constructor() { this.pos = []; this.nor = []; this.col = []; this.idx = []; this.wgt = []; this.m = null }
  point(x, y, z) { const v = new Vector3(x, y, z); return this.m ? v.applyMatrix4(this.m) : v }
  /** Build what `fn` builds moved and turned by `matrix`. */
  place(matrix, fn) { const keep = this.m; this.m = keep ? keep.clone().multiply(matrix) : matrix; fn(); this.m = keep }
  tri(a, b, c, color) {
    const ux = b.p.x - a.p.x, uy = b.p.y - a.p.y, uz = b.p.z - a.p.z
    const vx = c.p.x - a.p.x, vy = c.p.y - a.p.y, vz = c.p.z - a.p.z
    const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx
    if (nx * nx + ny * ny + nz * nz < 1e-14) return // the tip of a shape: nothing to draw
    // the corners know which way the surface faces; the order follows
    const out = nx * (a.n.x + b.n.x + c.n.x) + ny * (a.n.y + b.n.y + c.n.y) + nz * (a.n.z + b.n.z + c.n.z)
    const { r, g, b: blue } = rgbOf(color)
    for (const v of out < 0 ? [a, c, b] : [a, b, c]) {
      this.pos.push(v.p.x, v.p.y, v.p.z)
      this.nor.push(v.n.x, v.n.y, v.n.z)
      this.col.push(r, g, blue)
      const w = v.bones
      this.idx.push(w[0][0], w[1]?.[0] ?? 0, 0, 0)
      this.wgt.push(w[0][1], w[1]?.[1] ?? 0, 0, 0)
    }
  }
  geometry() {
    const g = new BufferGeometry()
    g.setAttribute('position', new Float32BufferAttribute(this.pos, 3))
    g.setAttribute('normal', new Float32BufferAttribute(this.nor, 3))
    g.setAttribute('color', new Float32BufferAttribute(this.col, 3))
    g.setAttribute('skinIndex', new Uint16BufferAttribute(this.idx, 4))
    g.setAttribute('skinWeight', new Float32BufferAttribute(this.wgt, 4))
    return g
  }
}

const TAU = Math.PI * 2
/**
 * A skin over rings, like a lathe whose rings may be oval, off centre, and deeper at the back than at the front.
 * rings: [y, rx, rz = rx, { x, z, front, back, bone }], listed from the bottom up. Walking up the profile the
 * surface faces outwards; a ring that only widens faces down (the underside of a brim), one that narrows faces up.
 * color: a colour, or (i, k, d) => colour | null for the patch between ring i and i + 1 in column k; column 0
 * is the middle of the front, d counts columns from there (the same left and right). null leaves a hole.
 * bone: a bone, [[bone, weight], [bone, weight]], or (side) => one of these (side +1 the figure's right).
 */
function loft(b, rings, { seg = 12, color, bone = B.chest, capTop, capBottom, inside = false } = {}) {
  const R = rings.map((r) => ({ y: r[0], rx: r[1], rz: r[2] ?? r[1], ...(r[3] ?? {}) }))
  const at = (i, t) => {
    const r = R[i], s = Math.sin(t), c = Math.cos(t)
    return b.point((r.x ?? 0) + r.rx * s, r.y, (r.z ?? 0) - r.rz * (c > 0 ? r.front ?? 1 : r.back ?? 1) * c)
  }
  const last = R.length - 1
  const grid = R.map((r, i) => {
    const row = []
    for (let k = 0; k <= seg; k++) {
      const t = ((k - 0.5) / seg) * TAU
      const p = at(i, t)
      const round = at(i, t + 0.01).sub(at(i, t - 0.01))
      const along = at(Math.min(last, i + 1), t).sub(at(Math.max(0, i - 1), t))
      const n = along.clone().cross(round)
      if (n.lengthSq() < 1e-16) n.copy(along).multiplyScalar(i === 0 ? -1 : 1) // a ring shrunk to a point: the tip of the shape
      n.normalize()
      if (inside) n.negate()
      const w = r.bone ?? bone
      row.push({ p, n, bones: pairs(typeof w === 'function' ? w(Math.sin(t) >= 0 ? 1 : -1) : w) })
    }
    return row
  })
  const paint = (i, k) => (typeof color === 'function' ? color(i, k, Math.min(k, seg - k)) : color)
  for (let i = 0; i < last; i++) for (let k = 0; k < seg; k++) {
    const c = paint(i, k)
    if (!c) continue
    b.tri(grid[i][k], grid[i][k + 1], grid[i + 1][k + 1], c)
    b.tri(grid[i][k], grid[i + 1][k + 1], grid[i + 1][k], c)
  }
  const cap = (i, c, up) => {
    const r = R[i]
    const centre = b.point(r.x ?? 0, r.y, r.z ?? 0)
    const n = b.point(r.x ?? 0, r.y + up, r.z ?? 0).sub(centre).normalize()
    const mid = { p: centre, n, bones: grid[i][0].bones }
    for (let k = 0; k < seg; k++) b.tri(mid, { ...grid[i][k], n }, { ...grid[i][k + 1], n }, c)
  }
  if (capTop) cap(last, capTop, 1)
  if (capBottom) cap(0, capBottom, -1)
}

/** An ellipsoid about `c` with radii `r`. color as in loft (rows count from the bottom). */
function ball(b, c, r, { seg = 8, rows = 5, color, bone = B.chest } = {}) {
  const rings = []
  for (let j = 0; j <= rows; j++) {
    const a = Math.PI - (j / rows) * Math.PI, w = Math.max(0, Math.sin(a))
    rings.push([c[1] + r[1] * Math.cos(a), r[0] * w, r[2] * w, { x: c[0], z: c[2] }])
  }
  loft(b, rings, { seg, color, bone })
}

// ---------------------------------------------------------------------------------------------- the body
const SHIRT = '#eee9dd'
const sides = [-1, 1]

function legs(b, { cloth, shoe, bootTo = 0, rollAt = 0, under = cloth }) {
  for (const sd of sides) {
    const T = sd < 0 ? B.thighL : B.thighR, S = sd < 0 ? B.shinL : B.shinR, x = sd * 0.09
    const ys = [0.07, 0.14, 0.25, 0.38, 0.47, 0.56, 0.75, 0.9, 0.97]
    const rs = [0.043, 0.046, 0.053, 0.057, 0.058, 0.065, 0.079, 0.088, 0.084]
    const bones = [S, S, S, S, [[T, 0.5], [S, 0.5]], T, T, T, [[T, 0.4], [B.hips, 0.6]]]
    loft(b, ys.map((y, i) => [y, rs[i], rs[i], { x, bone: bones[i] }]), {
      seg: 8, capBottom: shoe,
      color: (i) => { const y = (ys[i] + ys[i + 1]) / 2; return y < bootTo ? shoe : y < rollAt ? under : cloth },
    })
    if (rollAt) loft(b, [[rollAt - 0.035, 0.058, 0.058, { x }], [rollAt - 0.02, 0.07, 0.07, { x }], [rollAt + 0.015, 0.071, 0.071, { x }], [rollAt + 0.03, 0.06, 0.06, { x }]], { seg: 8, color: tone(cloth, 1.18), bone: S })
    foot(b, sd, shoe)
  }
}
function foot(b, sd, shoe) {
  ball(b, [sd * 0.092, 0.046, -0.05], [0.05, 0.046, 0.125], { seg: 8, rows: 4, color: shoe, bone: sd < 0 ? B.shinL : B.shinR })
}

function arms(b, { sleeve, cuff = sleeve, hand, rolled = false, skin, r = 1 }) {
  for (const sd of sides) {
    const A = sd < 0 ? B.armL : B.armR, F = sd < 0 ? B.foreL : B.foreR, H = sd < 0 ? B.handL : B.handR, x = sd * 0.2
    const ys = [0.815, 0.855, 0.96, 1.07, 1.23, 1.35, 1.395, 1.412]
    const rs = [0.034, 0.038, 0.044, 0.047, 0.053, 0.056, 0.046, 0.018].map((v, i) => (rolled && i < 3 ? v : v * r))
    const bones = [F, F, F, [[A, 0.5], [F, 0.5]], A, A, [[A, 0.6], [B.chest, 0.4]], [[A, 0.4], [B.chest, 0.6]]]
    loft(b, ys.map((y, i) => [y, rs[i], rs[i], { x: i === 6 ? sd * 0.19 : i === 7 ? sd * 0.178 : x, bone: bones[i] }]), {
      seg: 8, capBottom: rolled ? skin : cuff, capTop: sleeve,
      color: (i) => (rolled ? (i < 3 ? skin : sleeve) : i === 0 ? cuff : sleeve),
    })
    if (rolled) loft(b, [[1.04, 0.047, 0.047, { x }], [1.055, 0.06, 0.06, { x }], [1.095, 0.061, 0.061, { x }], [1.11, 0.05, 0.05, { x }]], { seg: 8, color: tone(sleeve, 0.9), bone: [[A, 0.5], [F, 0.5]] })
    ball(b, [x, 0.75, -0.006], [0.029, 0.07, 0.042], { seg: 6, rows: 4, color: hand, bone: H })
    ball(b, [x - sd * 0.012, 0.77, -0.046], [0.013, 0.03, 0.016], { seg: 5, rows: 3, color: hand, bone: H }) // the thumb, forwards
  }
}

function head(b, { skin, hair, collar = skin, bun = 0, beard = false, goatee = false, moustache = false, long = false }) {
  loft(b, [[1.425, 0.052, 0.052, { bone: B.chest }], [1.475, 0.046, 0.046, { bone: [[B.chest, 0.5], [B.head, 0.5]] }], [1.535, 0.044, 0.046, { bone: B.head }]], { seg: 8, color: (i) => (i === 0 ? collar : skin) })
  const H = { bone: B.head }
  // hair: the crown, the back of the head, and a little in front of the ears
  ball(b, [0, 1.61, -0.004], [0.078, 0.105, 0.09], { seg: 12, rows: 8, ...H, color: (i, k, d) => (i >= 6 || (i >= (long ? 2 : 3) && d >= 4) || (i >= 5 && d >= 3) ? hair : skin) })
  ball(b, [0, 1.597, -0.093], [0.012, 0.023, 0.017], { seg: 6, rows: 3, ...H, color: tone(skin, 0.92) })
  for (const sd of sides) ball(b, [sd * 0.031, 1.628, -0.079], [0.011, 0.008, 0.008], { seg: 6, rows: 3, ...H, color: '#2a211c' })
  if (bun) ball(b, [0, bun, 0.088], [0.055, 0.05, 0.05], { seg: 8, rows: 5, ...H, color: hair })
  if (beard) ball(b, [0, 1.535, -0.05], [0.055, 0.05, 0.05], { seg: 8, rows: 4, ...H, color: hair })
  if (goatee) ball(b, [0, 1.52, -0.072], [0.024, 0.036, 0.022], { seg: 6, rows: 4, ...H, color: hair })
  if (moustache) ball(b, [0, 1.572, -0.088], [0.036, 0.009, 0.013], { seg: 6, rows: 3, ...H, color: hair })
}

const hipsToChest = (y) => (y <= 0.98 ? B.hips : y < 1.09 ? [[B.hips, 0.5], [B.chest, 0.5]] : B.chest)
const MAN = [[0.9, 0.168, 0.112], [0.97, 0.162, 0.11], [1.04, 0.15, 0.104], [1.12, 0.155, 0.108], [1.2, 0.168, 0.115], [1.28, 0.182, 0.12], [1.36, 0.19, 0.118], [1.415, 0.178, 0.1], [1.445, 0.1, 0.07], [1.46, 0.055, 0.055]]
const WOMAN = [[0.92, 0.15, 0.115], [0.98, 0.125, 0.095], [1.03, 0.108, 0.085], [1.1, 0.118, 0.094], [1.18, 0.14, 0.108, { front: 1.15 }], [1.27, 0.155, 0.11, { front: 1.22 }], [1.34, 0.162, 0.1], [1.4, 0.155, 0.09], [1.435, 0.09, 0.065], [1.455, 0.052, 0.052]]
/** The trunk. `grow` makes it thicker (a coat over the shirt). Patches count from the hips up: 0…8. */
function torso(b, rings, color, grow = 0) {
  loft(b, rings.map(([y, rx, rz, o], i) => [y, rx + (i < rings.length - 2 ? grow : 0), rz + (i < rings.length - 2 ? grow : 0), { ...o, bone: hipsToChest(y) }]), { seg: 14, color })
}
/** How deep the front of a man's chest is at height y (for what is pinned on it). */
const chestFront = (y, grow = 0) => { let i = 0; while (i < MAN.length - 2 && MAN[i + 1][0] < y) i++; const [y0, , z0] = MAN[i], [y1, , z1] = MAN[i + 1]; return z0 + ((z1 - z0) * (y - y0)) / (y1 - y0) + grow }
/** Cloth that hangs from the hips and is pushed by the legs: `w` of it follows the thigh on its side. */
const hangs = (w) => (side) => [[B.hips, 1 - w], [side > 0 ? B.thighR : B.thighL, w]]
/** A coat's skirt or a dress: rings as in loft, with how much each follows the legs. */
function skirt(b, rings, color, seg = 14, lining) {
  loft(b, rings.map(([y, rx, rz, w, o]) => [y, rx, rz, { ...o, bone: w ? hangs(w) : B.hips }]), { seg, color, capBottom: lining })
}

// ---------------------------------------------------------------------------------------------- hats
const HAT = { bone: B.head }
function topHat(b, color) {
  const band = tone(color, 1.5)
  loft(b, [[1.648, 0.08, 0.092], [1.652, 0.128, 0.142], [1.662, 0.13, 0.144], [1.668, 0.082, 0.094], [1.672, 0.079, 0.091], [1.7, 0.078, 0.09], [1.83, 0.086, 0.097]], { seg: 14, ...HAT, color: (i) => (i === 4 ? band : color), capTop: color })
}
function softHat(b, color) {
  loft(b, [[1.65, 0.08, 0.092], [1.656, 0.142, 0.156], [1.666, 0.143, 0.157], [1.672, 0.084, 0.096], [1.7, 0.083, 0.095], [1.755, 0.08, 0.092], [1.785, 0.06, 0.07], [1.795, 0.02, 0.024]], { seg: 14, ...HAT, color: (i) => (i === 3 ? tone(color, 0.55) : color), capTop: color })
}
function flatCap(b, color) {
  ball(b, [0, 1.7, -0.008], [0.106, 0.036, 0.118], { seg: 12, rows: 5, ...HAT, color })
  ball(b, [0, 1.683, -0.118], [0.07, 0.011, 0.05], { seg: 8, rows: 3, ...HAT, color: tone(color, 0.7) })
}
function softCap(b, color) {
  loft(b, [[1.664, 0.081, 0.093], [1.69, 0.085, 0.097]], { seg: 12, ...HAT, color: tone(color, 0.75) })
  ball(b, [0, 1.722, 0.012], [0.1, 0.052, 0.112], { seg: 12, rows: 5, ...HAT, color })
  ball(b, [0, 1.676, -0.105], [0.058, 0.01, 0.04], { seg: 8, rows: 3, ...HAT, color: tone(color, 0.6) })
}
function sokolCap(b) {
  loft(b, [[1.655, 0.08, 0.092], [1.665, 0.086, 0.098], [1.735, 0.087, 0.099], [1.75, 0.074, 0.085]], { seg: 14, ...HAT, color: '#1b1816', capTop: '#8e1c16' })
  // the falcon's feather, on the left
  b.place(new Matrix4().makeTranslation(-0.082, 1.71, 0.01).multiply(new Matrix4().makeRotationX(0.42)).multiply(new Matrix4().makeRotationZ(0.12)), () => {
    loft(b, [[0, 0.004, 0.01], [0.09, 0.008, 0.03], [0.17, 0.007, 0.026], [0.24, 0.002, 0.006]], { seg: 6, ...HAT, color: (i) => (i === 1 ? '#5b4a3a' : '#8a785f') })
  })
}
function beret(b, color) {
  loft(b, [[1.66, 0.081, 0.093], [1.69, 0.084, 0.096]], { seg: 12, ...HAT, color: tone(color, 0.7) })
  b.place(new Matrix4().makeTranslation(0.028, 1.712, 0.008).multiply(new Matrix4().makeRotationZ(-0.26)), () => {
    ball(b, [0, 0, 0], [0.142, 0.04, 0.134], { seg: 12, rows: 5, ...HAT, color })
    ball(b, [0, 0.04, 0], [0.012, 0.012, 0.012], { seg: 5, rows: 3, ...HAT, color: tone(color, 0.7) })
  })
}
function ladysHat(b, color, ribbon) {
  // small, worn forward over the brow, its ribbon hanging down behind
  b.place(new Matrix4().makeTranslation(0, 1.7, -0.012).multiply(new Matrix4().makeRotationX(-0.2)), () => {
    loft(b, [[0, 0.05, 0.058], [0.004, 0.094, 0.104], [0.012, 0.095, 0.105], [0.016, 0.058, 0.066], [0.03, 0.057, 0.065], [0.062, 0.055, 0.062]], { seg: 12, ...HAT, color: (i) => (i === 3 ? ribbon : color), capTop: color })
    ball(b, [0.052, 0.045, 0.02], [0.03, 0.03, 0.03], { seg: 6, rows: 4, ...HAT, color: ribbon }) // a rosette
  })
  for (const sd of sides) loft(b, [[1.47, 0.02, 0.005, { x: sd * 0.03, z: 0.118 }], [1.6, 0.017, 0.005, { x: sd * 0.024, z: 0.112 }], [1.71, 0.014, 0.005, { x: sd * 0.016, z: 0.07 }]], { seg: 6, ...HAT, color: ribbon })
}
function bonnet(b, color, ribbon) {
  // covers the back and the top of the head; the brim stands round the face, the ribbon is tied under the chin
  ball(b, [0, 1.615, 0.014], [0.09, 0.116, 0.106], { seg: 12, rows: 8, ...HAT, color: (i, k, d) => (i < 2 || (d <= 2 && i < 6) || (d === 3 && i < 4) ? null : i === 5 && d > 2 ? ribbon : color) })
  b.place(new Matrix4().makeTranslation(0, 1.612, -0.022).multiply(new Matrix4().makeRotationX(-Math.PI / 2)), () => {
    const open = (c) => (i, k, d) => (d <= 2 ? null : c)
    loft(b, [[0, 0.088, 0.112], [0.062, 0.118, 0.14]], { seg: 14, ...HAT, color: open(color) })
    loft(b, [[0, 0.086, 0.11], [0.062, 0.116, 0.138]], { seg: 14, ...HAT, color: open(tone(color, 0.82)), inside: true })
  })
  for (const sd of sides) ball(b, [sd * 0.03, 1.492, -0.062], [0.032, 0.017, 0.012], { seg: 6, rows: 3, ...HAT, color: ribbon })
}

// ---------------------------------------------------------------------------------------------- the wardrobe
const HAIR = ['#2b1d15', '#4b3323', '#15110f', '#7a5a3a', '#8b8377']
const hairOf = (outfit, skin) => (skin === 3 ? HAIR[2] : skin === 2 ? HAIR[outfit % 2 ? 0 : 2] : HAIR[(outfit * 3 + skin) % HAIR.length])

const TAILOR = {
  // black frock coat to the knee, waistcoat, cravat, top hat
  gentleman(b, { cloth, skin, hair }) {
    legs(b, { cloth: '#5e5e64', shoe: '#141416' })
    const G = 0.012
    torso(b, MAN, (i, k, d) => (d === 0 && i >= 5 && i <= 7 ? SHIRT : d === 0 && i === 4 ? '#b8a57c' : d === 1 && i >= 5 && i <= 6 ? tone(cloth, 1.2) : cloth), G)
    skirt(b, [[0.5, 0.215, 0.168, 0.5], [0.75, 0.2, 0.152, 0.38], [0.95, 0.178, 0.128, 0.12], [1.05, 0.162, 0.116, 0]], (i, k, d) => (d === 0 && i === 0 ? tone(cloth, 0.75) : cloth), 14, tone(cloth, 0.6))
    arms(b, { sleeve: cloth, cuff: SHIRT, hand: skin })
    ball(b, [0, 1.425, -(chestFront(1.425, G) + 0.012)], [0.032, 0.03, 0.016], { seg: 6, rows: 4, color: '#27324d' }) // the cravat
    head(b, { skin, hair, collar: SHIRT, moustache: true })
    topHat(b, '#121214')
  },
  // čamara: the braided patriotic coat, closed to the neck, and a soft round hat
  burgher(b, { cloth, skin, hair }) {
    legs(b, { cloth: '#6b6558', shoe: '#1a1614' })
    const G = 0.014, braid = mix(cloth, '#b9b09a', 0.5)
    torso(b, MAN, cloth, G)
    skirt(b, [[0.66, 0.204, 0.156, 0.45], [0.84, 0.192, 0.14, 0.3], [0.97, 0.178, 0.126, 0.1], [1.05, 0.164, 0.118, 0]], cloth, 14, tone(cloth, 0.6))
    // the braiding: five frogs across the chest, each with its two olives
    for (const y of [1.37, 1.3, 1.23, 1.16, 1.09]) {
      const z = -(chestFront(y, G) + 0.006)
      ball(b, [0, y, z], [0.078, 0.008, 0.012], { seg: 6, rows: 3, color: braid, bone: hipsToChest(y) })
      for (const sd of sides) ball(b, [sd * 0.078, y, z + 0.008], [0.014, 0.014, 0.012], { seg: 5, rows: 3, color: braid, bone: hipsToChest(y) })
    }
    arms(b, { sleeve: cloth, cuff: braid, hand: skin })
    head(b, { skin, hair, collar: cloth, beard: true, moustache: true })
    softHat(b, '#2b2723')
  },
  // bustle dress: fitted bodice, the fullness of the skirt carried at the back, gloves, a small hat with a ribbon
  lady(b, { cloth, skin, hair }) {
    const over = tone(cloth, 1.28), ribbon = '#eadcc0'
    skirt(b, [[0.02, 0.33, 0.25, 0.3, { back: 1.75 }], [0.13, 0.325, 0.245, 0.3, { back: 1.7 }], [0.55, 0.25, 0.19, 0.28, { back: 1.8 }], [0.86, 0.19, 0.15, 0.14, { back: 2.05 }], [0.97, 0.15, 0.115, 0, { back: 1.95 }], [1.035, 0.11, 0.088, 0, { back: 1.1 }]],
      (i, k, d) => (i === 0 ? tone(cloth, 0.72) : i >= 2 && (d <= 3 || d >= 6) ? over : cloth), 16, tone(cloth, 0.5))
    for (const sd of sides) foot(b, sd, '#2a1f1c')
    torso(b, WOMAN, (i, k, d) => (d === 0 && i >= 2 && i <= 6 ? tone(cloth, 0.7) : cloth))
    ball(b, [0, 1.418, -0.09], [0.034, 0.03, 0.014], { seg: 6, rows: 4, color: SHIRT }) // lace at the throat
    ball(b, [0, 0.99, 0.2], [0.07, 0.05, 0.04], { seg: 6, rows: 4, color: over, bone: B.hips }) // the bow on the bustle
    arms(b, { sleeve: cloth, cuff: SHIRT, hand: '#e9dfc9', r: 0.86 })
    head(b, { skin, hair, collar: SHIRT, bun: 1.655 })
    ladysHat(b, tone(cloth, 0.62), ribbon)
  },
  // day dress with an apron-front overskirt drawn up at the sides, and a bonnet
  girl(b, { cloth, skin, hair }) {
    const apron = '#efe6d2'
    skirt(b, [[0.06, 0.3, 0.25, 0.3, { back: 1.25 }], [0.15, 0.295, 0.245, 0.3, { back: 1.25 }], [0.5, 0.25, 0.2, 0.28, { back: 1.35 }], [0.86, 0.186, 0.15, 0.14, { back: 1.55 }], [0.97, 0.146, 0.115, 0, { back: 1.45 }], [1.035, 0.108, 0.086, 0]],
      (i, k, d) => (i === 0 ? tone(cloth, 0.78) : i === 2 && d <= 4 ? apron : i >= 3 && d <= 6 ? apron : i >= 3 ? tone(cloth, 1.15) : cloth), 16, tone(cloth, 0.5))
    for (const sd of sides) foot(b, sd, '#3a2a22')
    torso(b, WOMAN, (i, k, d) => (i >= 7 ? SHIRT : d === 0 && i >= 2 ? tone(cloth, 0.75) : cloth))
    arms(b, { sleeve: cloth, cuff: SHIRT, hand: skin, r: 0.88 })
    head(b, { skin, hair, collar: SHIRT, bun: 1.6, long: true })
    bonnet(b, '#dccb9f', tone(cloth, 0.8))
  },
  // from the building site: shirt with rolled sleeves, waistcoat, leather apron, flat cap
  mason(b, { cloth, skin, hair }) {
    const shirt = '#dcd5c3', leather = '#8a5d3a', trousers = '#4b443b'
    legs(b, { cloth: trousers, shoe: '#2a2320', bootTo: 0.22 })
    torso(b, MAN, (i, k, d) => (i === 0 ? trousers : i >= 7 || (d === 0 && i >= 5) ? shirt : cloth))
    // the apron: a bib on the chest and a skirt below the knee, only in front
    const front = (n) => (i, k, d) => (d <= n ? leather : null)
    loft(b, [[1.04, 0.17, 0.124], [1.15, 0.175, 0.128], [1.3, 0.198, 0.136], [1.315, 0.19, 0.126]], { seg: 14, color: front(1), bone: B.chest })
    skirt(b, [[0.4, 0.2, 0.152, 0.45], [0.7, 0.195, 0.146, 0.3], [0.95, 0.186, 0.136, 0.1], [1.04, 0.17, 0.124, 0]], front(3))
    loft(b, [[1.0, 0.172, 0.128], [1.05, 0.172, 0.128]], { seg: 14, color: tone(leather, 0.6), bone: B.hips }) // its strap round the waist
    arms(b, { sleeve: shirt, rolled: true, hand: skin, skin })
    head(b, { skin, hair, collar: skin, moustache: true })
    flatCap(b, tone(cloth, 0.85))
  },
  // linen shirt, braces, rolled trousers, a soft cap
  carpenter(b, { cloth, skin, hair }) {
    const linen = '#d9ceb5', braces = '#5b3d27'
    legs(b, { cloth, shoe: '#3a2c22', bootTo: 0.15, rollAt: 0.32, under: '#8f8776' })
    torso(b, MAN, (i, k, d) => (i <= 2 ? cloth : (k === 2 || k === 12 || k === 5 || k === 9) && i <= 7 ? braces : d === 0 && i >= 6 ? skin : linen), 0.004)
    arms(b, { sleeve: linen, rolled: true, hand: skin, skin, r: 1.06 })
    head(b, { skin, hair, collar: skin, beard: true })
    softCap(b, mix(cloth, '#8a8068', 0.35))
  },
  // the red shirt, the jacket over one shoulder, the round cap with a falcon's feather
  sokol(b, { cloth, skin, hair }) {
    const red = '#b3261e', braid = tone(cloth, 0.62)
    legs(b, { cloth, shoe: '#17130f', bootTo: 0.45 })
    torso(b, MAN, (i, k, d) => (i === 0 ? cloth : i === 1 ? (d === 0 ? '#c9a24a' : '#2a1c14') : d === 0 && i <= 6 ? tone(red, 0.78) : red))
    arms(b, { sleeve: red, cuff: tone(red, 0.78), hand: skin, r: 1.07 })
    // the jacket hangs from the left shoulder, over the arm
    const L = [[B.chest, 0.6], [B.armL, 0.4]]
    loft(b, [[0.84, 0.2, 0.165, { x: -0.085, bone: L }], [1.1, 0.198, 0.16, { x: -0.082, bone: L }], [1.34, 0.205, 0.152, { x: -0.07 }], [1.435, 0.15, 0.115, { x: -0.06 }], [1.468, 0.075, 0.07, { x: -0.03 }]],
      { seg: 14, bone: B.chest, color: (i, k) => (k < 7 ? null : k === 7 || k === 13 || i === 0 ? braid : cloth) })
    head(b, { skin, hair, collar: red, moustache: true })
    sokolCap(b)
  },
  // velvet jacket, loose bow tie, wide beret, a brush in the breast pocket
  painter(b, { cloth, skin, hair }) {
    const G = 0.012, tie = '#17171b'
    legs(b, { cloth: '#77715f', shoe: '#4a3526' })
    torso(b, MAN, (i, k, d) => (d === 0 && i >= 3 && i <= 7 ? SHIRT : d === 1 && i >= 4 && i <= 6 ? tone(cloth, 1.18) : cloth), G)
    skirt(b, [[0.82, 0.192, 0.138, 0.2], [0.97, 0.18, 0.128, 0.05], [1.05, 0.164, 0.118, 0]], cloth, 14, tone(cloth, 0.6))
    arms(b, { sleeve: cloth, cuff: SHIRT, hand: skin })
    const z = -(chestFront(1.4, G) + 0.014)
    for (const sd of sides) {
      ball(b, [sd * 0.05, 1.402, z], [0.046, 0.03, 0.014], { seg: 6, rows: 4, color: tie })
      ball(b, [sd * 0.022, 1.34, z - 0.004], [0.017, 0.048, 0.01], { seg: 5, rows: 4, color: tie })
    }
    ball(b, [0, 1.402, z - 0.006], [0.015, 0.017, 0.012], { seg: 5, rows: 3, color: tie })
    // the breast pocket on the left, and the brush that stands in it
    const zp = -(chestFront(1.27, G) + 0.004)
    ball(b, [-0.09, 1.268, zp], [0.036, 0.007, 0.008], { seg: 6, rows: 3, color: tone(cloth, 0.6) })
    b.place(new Matrix4().makeTranslation(-0.09, 1.25, zp - 0.008).multiply(new Matrix4().makeRotationZ(0.1)), () => {
      loft(b, [[0, 0.006, 0.006], [0.105, 0.006, 0.006], [0.107, 0.008, 0.008], [0.135, 0.008, 0.008], [0.137, 0.009, 0.006], [0.165, 0.007, 0.005], [0.18, 0.001, 0.001]], { seg: 6, color: (i) => (i < 2 ? '#c79a5b' : i < 4 ? '#b9b9b4' : '#b5261c') })
    })
    head(b, { skin, hair, collar: SHIRT, goatee: true, moustache: true, long: true })
    beret(b, tone(cloth, 0.78))
  },
}

const made = new Map()
/** The mesh of a look ({ outfit, cloth, skin }): built once and shared by everyone who wears it. */
export function geometryFor(look) {
  const key = packLook(look)
  let g = made.get(key)
  if (!g) {
    const outfit = OUTFITS[look.outfit]
    const b = new Build()
    TAILOR[outfit.id](b, { cloth: outfit.cloth[look.cloth], skin: SKINS[look.skin], hair: hairOf(look.outfit, look.skin) })
    g = b.geometry()
    g.userData = { triangles: b.pos.length / 9, k: outfit.height / DESIGN }
    made.set(key, g)
  }
  return g
}
/** The colour of this person's own hands in the headset: the lady wears gloves. */
export const handColor = (look) => (OUTFITS[look.outfit].id === 'lady' ? '#e9dfc9' : SKINS[look.skin])

// ---------------------------------------------------------------------------------------------- the figure
let cloth = null
/** Matt cloth: one material (one shader) for every figure. */
const material = () => (cloth ??= new MeshStandardMaterial({ vertexColors: true, roughness: 0.86, metalness: 0 }))

// At night a figure gives off a little of its own colours, as the façade does under its floodlights: a cool tint
// everywhere and the warm light of the lamps near the theatre. No lamp is a real light, so it costs nothing more.
const lit = (shader) => { shader.fragmentShader = shader.fragmentShader.replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\n  totalEmissiveRadiance *= diffuseColor.rgb;') }
const NIGHT = [0.05, 0.062, 0.095], LAMPS = [0.5, 0.36, 0.2]

const clamp = (v, a, b) => Math.min(b, Math.max(a, v))
const wrap = (a) => { a = (a + Math.PI) % TAU; return (a < 0 ? a + TAU : a) - Math.PI }
const UP = new Vector3(0, 1, 0), DOWN = new Vector3(0, -1, 0), XAXIS = new Vector3(1, 0, 0)
const GRIP = new Quaternion().setFromAxisAngle(XAXIS, Math.PI / 2) // the mesh's hand points down, a hand pose points along −z
const _e = new Euler(0, 0, 0, 'YXZ')
const _qb = new Quaternion(), _qh = new Quaternion(), _qc = new Quaternion(), _q = new Quaternion(), _q2 = new Quaternion()
const _neck = new Vector3(), _hips = new Vector3(), _chest = new Vector3(), _headAt = new Vector3(), _off = new Vector3(), _hc = new Vector3()
const _fwd = new Vector3(), _right = new Vector3(), _a = new Vector3(), _b2 = new Vector3(), _k = new Vector3(), _t = new Vector3(), _d = new Vector3(), _p = new Vector3(), _pole = new Vector3()
const _scale = new Vector3()

/** Two bones from `from` to `to`: where the joint between them is (bent towards `pole`) and where the end really is. */
function reach(from, to, a, b, pole, joint, end) {
  _d.subVectors(to, from)
  let d = _d.length()
  if (d < 1e-5) { _d.copy(DOWN); d = 1e-5 } else _d.divideScalar(d)
  const dc = clamp(d, Math.abs(a - b) + 0.01, a + b - 0.002)
  const x = (a * a - b * b + dc * dc) / (2 * dc)
  const h = Math.sqrt(Math.max(0, a * a - x * x))
  _p.copy(pole).addScaledVector(_d, -pole.dot(_d))
  if (_p.lengthSq() < 1e-8) _p.set(_d.y, -_d.x, 0)
  _p.normalize()
  joint.copy(from).addScaledVector(_d, x).addScaledVector(_p, h)
  end.copy(from).addScaledVector(_d, dc)
}

export class Figure {
  constructor() {
    this.bones = PIVOT.map(() => { const bone = new Bone(); bone.matrixAutoUpdate = false; return bone })
    this.skeleton = new Skeleton(this.bones, PIVOT.map((p) => new Matrix4().makeTranslation(-p[0], -p[1], -p[2])))
    this.material = material().clone() // the same shader; its own opacity, for someone who fades out
    this.material.onBeforeCompile = lit
    this.glow = new Color(0)
    this.mesh = new SkinnedMesh(new BufferGeometry(), this.material)
    // the computer's glow pass draws only what shines: a figure is lit, it is no lamp, so it stays dark there
    this.mesh.onBeforeRender = () => { if (mirrorPass.glow) this.material.emissive.setScalar(0); else this.material.emissive.copy(this.glow) }
    this.mesh.bind(this.skeleton, new Matrix4())
    // the bones are set in world space, so the mesh itself never moves: its sphere says where the figure is
    this.mesh.matrixAutoUpdate = false
    this.mesh.boundingSphere = new Sphere(new Vector3(), 2)
    this.mesh.receiveShadow = true
    this.k = 1
    this.key = -1
    this.fresh = true
    this.yaw = 0
    this.turning = false
    this.phase = 0
    this.amp = 0
    this.tall = 0
    this.time = Math.random() * 10
    this.prev = new Vector3()
    this.v = new Vector3()
    /** Where the top of the head is, hat not counted (for the name plate). */
    this.top = new Vector3()
    this.hidden = { head: false, left: false, right: false }
    // the three parts a person may not see of themselves: where they are, to hide and show them again
    this.parts = [B.head, B.handL, B.handR].map((index) => ({ index, position: new Vector3(), quaternion: new Quaternion() }))
    this.scale = 1
  }

  setLook(look) {
    const key = packLook(look)
    if (key === this.key) return
    this.key = key
    this.mesh.geometry = geometryFor(look)
    this.k = this.mesh.geometry.userData.k
  }

  setOpacity(opacity) {
    const m = this.material, see = opacity < 1
    if (m.transparent !== see) { m.transparent = see; m.needsUpdate = true }
    m.opacity = opacity
  }

  /** night: 0 day … 1 night; lamps: 0 far from any lamp … 1 beside the lit façade or indoors. */
  setLight(night, lamps) {
    this.glow.setRGB(night * (NIGHT[0] + lamps * LAMPS[0]), night * (NIGHT[1] + lamps * LAMPS[1]), night * (NIGHT[2] + lamps * LAMPS[2]))
  }

  put(index, position, quaternion, s) { this.bones[index].matrixWorld.compose(position, quaternion, _scale.setScalar(s)) }
  part(n, position, quaternion, s, hide) {
    const part = this.parts[n]
    part.position.copy(position); part.quaternion.copy(quaternion)
    this.put(part.index, position, quaternion, hide ? 0 : s)
  }

  /**
   * head: { position, quaternion } of the eyes in world space; left, right: the same for the hands, or null.
   * A hand with `held` set is a controller's grip (the middle of the palm); without it, the wrist of a tracked hand.
   * options: xr (the person is in a headset: their real height and hands), floor (the height of the ground under
   * them, when known), hideHead / hideLeft / hideRight (parts this person must not see of themselves).
   */
  update(dt, head, left, right, { xr = false, floor = null, hideHead = false, hideLeft = false, hideRight = false } = {}) {
    dt = Math.min(dt, 0.1)
    this.time += dt
    const k = this.k
    const headYaw = _e.setFromQuaternion(head.quaternion).y

    // ---- how tall, and where the ground is
    let s = k, ground
    if (xr) {
      let h = floor == null ? NaN : head.position.y - floor
      if (!(h > 0.6 && h < 2.25)) h = NaN
      if (h === h) this.tall = Math.max(this.tall, h) // the tallest they have stood: sitting down does not make them a child
      s = clamp((this.tall || EYE * k) / EYE, 0.8 * k, 1.22 * k)
      ground = h === h ? floor : head.position.y - s * EYE
    } else ground = floor ?? head.position.y - SCREEN_EYE

    // ---- walking: how fast the head travels over the ground
    if (this.fresh) { this.fresh = false; this.prev.copy(head.position); this.yaw = headYaw; this.v.set(0, 0, 0) }
    const dx = head.position.x - this.prev.x, dz = head.position.z - this.prev.z
    if (dt < 1e-4 || dx * dx + dz * dz > 2.25) this.v.set(0, 0, 0) // taken somewhere else: no stride
    else { const f = 1 - Math.exp(-10 * dt); this.v.x += (dx / dt - this.v.x) * f; this.v.z += (dz / dt - this.v.z) * f }
    this.prev.copy(head.position)
    const speed = Math.hypot(this.v.x, this.v.z)

    // ---- the body turns towards where it walks; standing, it follows the head once that has turned far
    let target = this.yaw, direction = 1
    if (speed > 0.3) {
      const move = Math.atan2(-this.v.x, -this.v.z)
      if (Math.abs(wrap(move - headYaw)) < 1.9) target = move
      else { target = move + Math.PI; direction = -1 } // walking backwards
      this.turning = false
    } else {
      const off = Math.abs(wrap(headYaw - this.yaw))
      if (off > 0.7) this.turning = true
      else if (off < 0.08) this.turning = false
      if (this.turning) target = headYaw
    }
    this.yaw += wrap(target - this.yaw) * (1 - Math.exp(-7 * dt))
    const turned = wrap(headYaw - this.yaw)
    if (Math.abs(turned) > 1.35) this.yaw = headYaw - Math.sign(turned) * 1.35 // a neck turns only so far

    const step = (0.45 + 0.2 * Math.min(speed, 5)) * s
    this.phase += ((direction * speed * dt) / step) * Math.PI
    this.amp += ((speed > 0.3 ? Math.min(0.62, 0.22 + 0.09 * speed) : 0) - this.amp) * (1 - Math.exp(-9 * dt))
    const A = this.amp

    // ---- hips, chest and head
    _neck.set(0, -0.125 * s, 0.085 * s).applyQuaternion(head.quaternion).add(head.position)
    // looking down, a head also comes forward on its neck: the body stays that much behind the eyes
    const down = Math.max(0, -_d.set(0, 0, -1).applyQuaternion(head.quaternion).y) * 0.07 * s
    _neck.x += Math.sin(headYaw) * down; _neck.z += Math.cos(headYaw) * down
    const standing = ground + NECK * s
    // bending the knees, sitting down. A head held a few centimetres low is still standing: a knee comes far
    // forward for very little height, through an apron or a coat
    const SLACK = 0.05 * s
    const low = xr ? clamp(standing - _neck.y - SLACK, 0, 0.55 * s) : 0
    const lean = xr ? Math.min(0.6, (low / s) * 1.1) : Math.min(0.1, speed * 0.025)
    _qb.setFromAxisAngle(UP, this.yaw)
    _fwd.set(0, 0, -1).applyQuaternion(_qb)
    _right.set(1, 0, 0).applyQuaternion(_qb)
    _qh.copy(_qb).multiply(_q.setFromAxisAngle(XAXIS, -lean * 0.4))
    _qc.setFromAxisAngle(UP, this.yaw + clamp(turned, -0.9, 0.9) * 0.45).multiply(_q.setFromAxisAngle(XAXIS, -lean))
    _hc.set(0, (PIVOT[1][1] - PIVOT[0][1]) * s, 0).applyQuaternion(_qh)
    _off.set(0, (NECK - PIVOT[1][1]) * s, 0).applyQuaternion(_qc)
    _hips.copy(_neck).sub(_off).sub(_hc)
    // on a computer the figure keeps its own height under the head; the hips dip a little with each step
    const dip = (THIGH + SHIN) * s * (1 - Math.cos(A * Math.sin(this.phase)))
    _hips.y = xr ? clamp(_hips.y + SLACK, ground + 0.36 * s, ground + PIVOT[0][1] * s) : ground + PIVOT[0][1] * s - dip
    _chest.copy(_hips).add(_hc)
    _headAt.copy(_chest).add(_off)
    this.put(B.hips, _hips, _qh, s)
    this.put(B.chest, _chest, _qc, s)
    this.part(0, _headAt, head.quaternion, s, hideHead)
    this.top.set(0, (DESIGN - NECK) * s, 0).applyQuaternion(head.quaternion).add(_headAt)

    // ---- legs: each foot is put where the stride has it, the knee bends forwards
    for (const side of sides) {
      const thigh = side < 0 ? B.thighL : B.thighR
      const ph = this.phase + (side < 0 ? Math.PI : 0)
      _a.set(side * 0.09 * s, (PIVOT[thigh][1] - PIVOT[0][1]) * s, 0).applyQuaternion(_qh).add(_hips)
      _t.copy(_a).addScaledVector(_fwd, Math.sin(A * Math.sin(ph)) * (THIGH + SHIN) * s)
      _t.y = ground + ANKLE * s + A * 0.24 * s * Math.max(0, Math.cos(ph)) // lifted while it swings forwards
      _pole.copy(_fwd).addScaledVector(UP, 0.3)
      reach(_a, _t, THIGH * s, SHIN * s, _pole, _k, _b2)
      this.put(thigh, _a, _q.setFromUnitVectors(DOWN, _d.subVectors(_k, _a).normalize()).multiply(_qb), s)
      this.put(thigh + 1, _k, _q.setFromUnitVectors(DOWN, _d.subVectors(_b2, _k).normalize()).multiply(_qb), s)
    }

    // ---- arms: to the hand when there is one, else hanging and swinging against the legs
    for (const side of sides) {
      const arm = side < 0 ? B.armL : B.armR
      const hand = side < 0 ? left : right
      const hide = side < 0 ? hideLeft : hideRight
      _a.set(side * 0.195 * s, (PIVOT[arm][1] - PIVOT[1][1]) * s, 0).applyQuaternion(_qc).add(_chest)
      if (hand) {
        // An arm of two fixed lengths: the elbow hangs down and a little out and back, and bends as far as the
        // distance asks. The wrist is a palm behind a controller. Further away than the arm is long, it is
        // stretched out straight towards the hand and ends there.
        _t.copy(hand.position)
        if (hand.held) _t.add(_d.set(0, 0, PALM * s).applyQuaternion(hand.quaternion))
        _pole.copy(_right).multiplyScalar(side * 0.4).addScaledVector(UP, -1).addScaledVector(_fwd, -0.35)
        reach(_a, _t, ARM * s, FORE * s, _pole, _k, _b2)
        _q2.copy(hand.quaternion).multiply(GRIP)
      } else {
        const swing = -A * 0.8 * Math.sin(this.phase + (side < 0 ? Math.PI : 0)) + Math.sin(this.time * 1.1 + side) * 0.012
        const bend = swing + 0.14 + A * 0.5
        _k.copy(_a).addScaledVector(_right, side * 0.05 * ARM * s).addScaledVector(UP, -Math.cos(swing) * ARM * s).addScaledVector(_fwd, Math.sin(swing) * ARM * s)
        _b2.copy(_k).addScaledVector(_right, -side * 0.02 * FORE * s).addScaledVector(UP, -Math.cos(bend) * FORE * s).addScaledVector(_fwd, Math.sin(bend) * FORE * s)
      }
      this.put(arm, _a, _q.setFromUnitVectors(DOWN, _d.subVectors(_k, _a).normalize()).multiply(_qb), s)
      this.put(arm + 1, _k, _q.setFromUnitVectors(DOWN, _d.subVectors(_b2, _k).normalize()).multiply(_qb), s)
      this.part(side < 0 ? 1 : 2, _b2, hand ? _q2 : _q, s, hide)
    }

    this.mesh.boundingSphere.center.set(_hips.x, ground + 0.95 * s, _hips.z)
    this.mesh.boundingSphere.radius = 1.5 * s
    this.hidden.head = hideHead; this.hidden.left = hideLeft; this.hidden.right = hideRight
    this.scale = s
  }

  /** Show or hide the parts this person does not see of themselves, between two drawings of one frame (the mirror). */
  reveal(on) {
    const h = this.hidden
    if (!h.head && !h.left && !h.right) return
    const hide = [h.head, h.left, h.right]
    this.parts.forEach((part, n) => { if (hide[n]) this.put(part.index, part.position, part.quaternion, on ? this.scale : 0) })
    this.skeleton.update()
  }

  dispose() { this.skeleton.dispose(); this.material.dispose() }
}
