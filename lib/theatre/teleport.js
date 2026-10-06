// Teleporting: where an arc thrown from a hand (or a straight look from a screen) comes down, and whether a
// person may be put down there. No drawing and no input here (components/Teleport.jsx does those): only the rule.
//
//   the arc      leaves the hand like a thrown ball and stops at the first thing it meets: what is solid for a
//                walking person right now (lib/theatre/colliders.js: not built yet, burnt down or cut away by the
//                section does not count, and floors stay floors in a section), a tram, or another person. It never
//                reaches further than REACH metres from where the person stands.
//   may land     on what carries a walking person: a triangle that lies flatter than the steepest stair, is not a
//                roof, a statue, the river or a house of the surroundings, with room for a body above it, no wall
//                within the body's width and ground under the whole body (so no ledges, sills and parapets).
//                Pointing at a seat, a baluster or a lamp means the floor it stands on.
//   may not      everything else: a wall, a ceiling, the end of the arc in mid-air, a tram, another person.
//   noclip       with "Walk through walls" on, anywhere the arc reaches, also its end in mid-air.
import { Matrix4, Vector3 } from 'three'
import { NEVER, FURNITURE } from './colliders.js'

export const REACH = 12 // metres at a time, measured on the ground
const SPEED = 10.4, GRAVITY = 9.8, STEP = 0.04 // the throw (a level throw at 45° comes down just inside REACH), and the seconds one piece of the arc takes
const PIECES = 90
const FLAT = 0.64 // the normal's y of the steepest thing that carries (the same line colliders.js draws)
const HEAD_ROOM = 1.8, WIDTH = 0.3, UNDER = 1.3 // metres: above the feet, to a wall, from furniture down to its floor
const PERSON = 0.4, APART = 0.8 // an arc stops this close to someone; nobody lands closer to someone than this
const TRAM = { half: 1.25, top: 3.7, length: 7.5 / 2 + 0.6, margin: 0.4 }

const UPWARD = { x: 0, y: 1, z: 0 }, DOWNWARD = { x: 0, y: -1, z: 0 }
const ROUND = Array.from({ length: 8 }, (_, i) => ({ x: Math.cos((i * Math.PI) / 4), y: 0, z: Math.sin((i * Math.PI) / 4) }))
const _p = new Vector3(), _v = new Vector3(), _n = new Vector3(), _d = new Vector3(), _l = new Vector3(), _t = new Vector3()

/**
 * @returns {{ arc(from, dir, feet, opts, out), ray(from, dir, feet, opts, out) }}
 * opts: { noclip, people: Vector3[] (heads of the others) }
 * out:  { points: Float32Array, count, spot: Vector3, valid, why, far }  (make one with `result()`)
 */
export function createTeleport(theatre) {
  const { world, rapier, colliders, body } = theatre.physics
  const ray = new rapier.Ray({ x: 0, y: 0, z: 0 }, { x: 0, y: -1, z: 0 })
  let inCut = false
  const solid = (c) => c.handle !== body.handle && colliders.allows(c.handle, inCut)
  /** The first solid thing from `o` along the unit vector `d` within `reach`: { toi, ny, tag } or null. */
  const cast = (o, d, reach) => {
    ray.origin.x = o.x; ray.origin.y = o.y; ray.origin.z = o.z
    ray.dir.x = d.x; ray.dir.y = d.y; ray.dir.z = d.z
    inCut = theatre.cutAway(o)
    const hit = world.castRayAndGetNormal(ray, reach, true, undefined, undefined, undefined, undefined, solid)
    if (!hit) return null
    const n = hit.normal
    const facing = n.x * d.x + n.y * d.y + n.z * d.z
    return { toi: hit.timeOfImpact, ny: facing > 0 ? -n.y : n.y, tag: colliders.tag(hit.collider.handle, hit.featureId) }
  }
  /** As `cast`, looking through furniture. */
  const castPast = (o, d, reach) => {
    _l.copy(o)
    for (let k = 0, left = reach; k < 5 && left > 0; k++) {
      const hit = cast(_l, d, left)
      if (!hit) return null
      if (hit.tag !== FURNITURE) { hit.toi += reach - left; return hit }
      const step = hit.toi + 0.01
      _l.x += d.x * step; _l.y += d.y * step; _l.z += d.z * step
      left -= step
    }
    return null
  }

  // the trams: their cars are not solid for a walking person (they would run them over), but nobody is put on one
  const trams = theatre.world.getObjectByName('trams')
  const cars = trams?.children.find((c) => c.isInstancedMesh && c.geometry.parameters?.height === 0.95)
  const carInverse = cars ? Array.from({ length: cars.count }, () => new Matrix4()) : []
  let carsAt = -1
  const inTram = (p, margin = 0) => {
    if (!cars || !trams.visible) return false
    const now = performance.now()
    if (now - carsAt > 30) { // they move: where they are now, once per look
      carsAt = now
      for (let i = 0; i < cars.count; i++) { cars.getMatrixAt(i, carInverse[i]); if (Math.abs(carInverse[i].determinant()) > 1e-9) carInverse[i].invert(); else carInverse[i].makeScale(0, 0, 0) }
    }
    for (const m of carInverse) {
      if (m.elements[0] === 0 && m.elements[5] === 0) continue
      _t.copy(p).applyMatrix4(m)
      if (Math.abs(_t.x) < TRAM.half + margin && _t.y > -0.5 && _t.y < TRAM.top && Math.abs(_t.z) < TRAM.length + margin) return true
    }
    return false
  }
  const inPerson = (p, people) => {
    for (const h of people) if (Math.hypot(p.x - h.x, p.z - h.z) < PERSON && p.y < h.y + 0.25 && p.y > h.y - 1.9) return true
    return false
  }

  /** May a person stand with the feet at `p`? Returns null when they may, else why not. */
  const standing = (p, people) => {
    for (const h of people) if (Math.hypot(p.x - h.x, p.z - h.z) < APART && Math.abs(h.y - 1.6 - p.y) < 1.6) return 'person'
    if (inTram(_d.set(p.x, p.y + 1, p.z), TRAM.margin)) return 'tram'
    if (castPast(_d.set(p.x, p.y + 0.3, p.z), UPWARD, HEAD_ROOM - 0.3)) return 'low'
    _d.set(p.x, p.y + 0.9, p.z)
    for (const d of ROUND) if (castPast(_d, d, WIDTH)) return 'wall'
    // ground under the whole body, not just under the point: no ledges, sills, parapets or brinks
    for (let i = 0; i < 8; i += 2) {
      const hit = cast(_d.set(p.x + ROUND[i].x * 0.25, p.y + 0.5, p.z + ROUND[i].z * 0.25), DOWNWARD, 1.0)
      if (!hit) return 'edge'
    }
    return null
  }

  /** What was hit at `out.spot`: decide whether it is a place to stand, and move the spot to the floor if it is furniture. */
  const settle = (hit, dir, opts, out) => {
    if (opts.noclip) { out.valid = !inPerson(out.spot, opts.people); out.why = out.valid ? null : 'person'; return out }
    if (hit.tag === NEVER) return fail(out, 'never')
    if (hit.tag === FURNITURE) {
      // a seat, a baluster, a lamp: the floor it stands on, a hand's width back towards the person
      const back = Math.hypot(dir.x, dir.z) || 1
      _p.set(out.spot.x - (dir.x / back) * 0.12, out.spot.y + 0.05, out.spot.z - (dir.z / back) * 0.12)
      const floor = castPast(_p, DOWNWARD, UNDER)
      if (!floor || floor.tag === NEVER || floor.ny < FLAT) return fail(out, 'furniture')
      out.spot.set(_p.x, _p.y - floor.toi, _p.z)
    } else if (hit.ny < FLAT) return fail(out, hit.ny < -0.3 ? 'ceiling' : 'wall')
    const why = standing(out.spot, opts.people)
    if (why) return fail(out, why)
    out.valid = true; out.why = null
    return out
  }
  const fail = (out, why) => { out.valid = false; out.why = why; return out }

  return {
    result: () => ({ points: new Float32Array((PIECES + 1) * 3), count: 0, spot: new Vector3(), valid: false, why: null, far: false }),

    /** A throw from `from` along the unit vector `dir`, by someone whose feet are at `feet`. */
    arc(from, dir, feet, opts, out) {
      const pts = out.points
      _p.copy(from); _v.copy(dir).multiplyScalar(SPEED)
      pts[0] = _p.x; pts[1] = _p.y; pts[2] = _p.z
      out.count = 1; out.far = false
      const put = (p) => { const o = out.count * 3; pts[o] = p.x; pts[o + 1] = p.y; pts[o + 2] = p.z; out.count++; out.spot.copy(p) }
      for (let i = 0; i < PIECES; i++) {
        _n.copy(_p).addScaledVector(_v, STEP)
        _v.y -= GRAVITY * STEP
        _d.subVectors(_n, _p)
        let length = _d.length()
        _d.divideScalar(length)
        // no further than REACH from the feet
        const d0 = Math.hypot(_p.x - feet.x, _p.z - feet.z), d1 = Math.hypot(_n.x - feet.x, _n.z - feet.z)
        const far = d1 > REACH
        if (far) length *= Math.max(0, Math.min(1, (REACH - d0) / (d1 - d0 || 1)))
        const hit = cast(_p, _d, length)
        if (hit) length = hit.toi
        // a tram or a person in the way (looked for at a few points of the piece)
        let other = null
        for (let k = 1; k <= 3 && !other; k++) {
          _l.copy(_p).addScaledVector(_d, (length * k) / 3)
          if (inPerson(_l, opts.people)) other = 'person'; else if (inTram(_l)) other = 'tram'
          if (other) { put(_l); return fail(out, other) }
        }
        put(_n.copy(_p).addScaledVector(_d, length))
        if (hit) return settle(hit, _d, opts, out)
        if (far || _n.y < feet.y - 40) { out.far = far; if (opts.noclip) { out.valid = true; out.why = null; return out } return fail(out, 'air') }
        _p.copy(_n)
      }
      return fail(out, 'air')
    },

    /** A straight look from `from` along `dir` (a double-click on a screen): the same rule, without the throw. */
    ray(from, dir, feet, opts, out) {
      out.points[0] = from.x; out.points[1] = from.y; out.points[2] = from.z
      out.count = 2; out.far = false
      const reach = REACH * 4
      const hit = cast(from, dir, reach)
      const length = hit ? hit.toi : reach
      out.spot.copy(from).addScaledVector(dir, length)
      if (Math.hypot(out.spot.x - feet.x, out.spot.z - feet.z) > REACH) {
        out.far = true
        if (!opts.noclip) return fail(out, 'far')
        // through walls: as far along the look as one move goes
        const flat = Math.hypot(dir.x, dir.z)
        out.spot.copy(from).addScaledVector(dir, flat > 1e-3 ? Math.min(length, REACH / flat) : Math.min(length, REACH))
        out.valid = true; out.why = null
        return out
      }
      if (inTram(out.spot, TRAM.margin)) return fail(out, 'tram')
      if (!hit) return opts.noclip ? ((out.valid = true), (out.why = null), out) : fail(out, 'air')
      return settle(hit, dir, opts, out)
    },
  }
}
