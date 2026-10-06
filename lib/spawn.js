// Where each person starts: on the far pavement of Národní, opposite the middle of the main façade, looking at
// the entrance with the head only slightly up: the pavement here lies 1.4 m above the street before the theatre, so
// the loggia's arches are in the picture as it is, and people standing on that street stay in it too, above the
// timeline at the bottom of the screen. People stand side
// by side along the pavement. Two people must not start inside each other, so a newcomer takes the first place
// nobody has claimed (claims travel as the presence field `spawn`). Alone, you always get place 0, so tests
// are repeatable.
import { FRAME, bToWorld } from './nd/config.js'

// Building frame (lib/nd/config.js): u east, v south. The loggia's front is at v ≈ −7.9 and its middle at
// u ≈ 0.6; the three candelabra stand at v ≈ −13; the two tram tracks lie between v ≈ −13.5 and −19.5 (the far
// side of the far car); the house across the street begins at v ≈ −27. The row stands at v ≈ −25.3, close to that
// house: six metres clear of the trams, and far enough back that the loggia fits into the picture with the street
// before it (the trigas on the corner pylons, 30 m up, take a look upwards). It follows the street, which is not
// quite parallel to the façade. No trees grow here.
const MIDDLE = 0.6, ROW = -25.3, SKEW = -0.055, APART = 1.2
const PLACES = [0, 1, -1, 2, -2, 3, -3, 4].map((k) => { const u = MIDDLE + k * APART; return [u, ROW + SKEW * (u - MIDDLE)] })
// yaw of someone looking south along +v, at the façade (a camera at yaw 0 looks along −z)
export const FACING = FRAME.rotationY + Math.PI
/** How far the head is tilted up at the start on a screen (in a headset the head is the person's own). */
export const LOOK_UP = 0.08
export const SPAWNS = PLACES.map(([u, v]) => { const p = bToWorld(u, 0, v); return { position: [p.x, 0, p.z], yaw: FACING, pitch: LOOK_UP } })

export function pickSpawn(peers) {
  const taken = new Set(peers.map((p) => p.fields?.spawn).filter((s) => s !== undefined))
  for (let s = 0; s < SPAWNS.length; s++) if (!taken.has(s)) return s
  return peers.length % SPAWNS.length
}

/**
 * A world point in the space of the person standing at `slot` (the XR origin's local space): what the
 * emulated headset, hands and controllers use for `look_at` and `set_transform` in XR tests.
 */
export function toLocal([x, y, z], slot = 0) {
  const { position: [px, py, pz], yaw } = SPAWNS[slot]
  const dx = x - px, dz = z - pz, c = Math.cos(-yaw), s = Math.sin(-yaw)
  return [c * dx + s * dz, y - py, -s * dx + c * dz]
}
export function toWorld([x, y, z], slot = 0) {
  const { position: [px, py, pz], yaw } = SPAWNS[slot]
  const c = Math.cos(yaw), s = Math.sin(yaw)
  return [px + c * x + s * z, py + y, pz - s * x + c * z]
}
