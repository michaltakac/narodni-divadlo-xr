// Multi-user core: one Yjs document per room over a WebSocket to Graspable's relay, plus awareness for
// everything that changes every frame (where people and their hands are, what they hold).
//
//   shared state  → the Y.Doc (useShared / useSharedMap in components/Multiplayer.jsx): kept by the relay,
//                   merged, survives everyone leaving. For things that matter: positions of objects at rest,
//                   scores, colours, text.
//   presence      → awareness: lost when a person leaves, sent at PRESENCE_HZ as one small message per
//                   person. For poses, what is held, a pointer, a status. Never put it in the Y.Doc:
//                   every doc update is stored for ever.
//   local state   → React state / refs as usual: hover, animation, the camera.
//
// The relay address comes from VITE_GRASPABLE_REALTIME when set, else REALTIME_URL below. While the address
// is still the placeholder the app stays single-user without errors.
import * as Y from 'yjs'
import { WebsocketProvider } from 'y-websocket'
import { encodeAwarenessUpdate } from 'y-protocols/awareness'
import { Quaternion, Vector3 } from 'three'
import { colorFor, sessionName } from './names'

// Graspable's relay (infra/realtime). VITE_GRASPABLE_REALTIME points the app at another one.
export const REALTIME_URL = 'wss://realtime.graspable.dev'

export const PRESENCE_HZ = 20 // awareness messages per second per person (the relay drops beyond 30)
export const STALE_MS = 1500 // a peer silent this long starts to fade
export const GONE_MS = 4000 // and is hidden after this
const DELAY_MS = 2.5 * (1000 / PRESENCE_HZ) // render others this far in the past: there is always a sample ahead
const RING = 8 // samples kept per peer

export const relayUrl = () => import.meta.env.VITE_GRASPABLE_REALTIME || REALTIME_URL

const ROOM_ID = /^[a-z0-9][a-z0-9:_-]{2,80}$/
export const slug = (s) => String(s).toLowerCase().replace(/[^a-z0-9:_-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 80)

/**
 * The room for this page: the published app's id (from an address /a/<id>/), else `?room=` in the
 * address, else the address itself for an app on its own host, else a dev room named after the dev server (everyone opening the same
 * preview address lands in the same room).
 */
export function defaultRoom() {
  // A published app is served at /a/<app id>/: everyone who opens it meets in the app's own room.
  const app = /^\/a\/([a-z0-9]{8})\//.exec(globalThis.location?.pathname ?? '')?.[1]
  if (app) return app
  const q = new URLSearchParams(globalThis.location?.search ?? '').get('room')
  if (q) { const r = slug(q); if (ROOM_ID.test(r)) return r; if (ROOM_ID.test('dev-' + r)) return 'dev-' + r }
  // A published app at an address of its own (its name on the apps domain, or its owner's domain): the room is the address.
  const host = globalThis.location?.hostname ?? ''
  if (host.includes('.') && !/^[\d.]+$/.test(host) && !host.endsWith('.localhost')) return slug(`at-${host}`)
  return slug(`dev-${globalThis.location?.host ?? 'local'}`)
}

// Positions in millimetres, rotations in thousandths: 7 small integers for a pose instead of 7 floats.
const P = 1000, R = 1000
export const packPose = (out, i, pos, quat) => {
  out[i] = Math.round(pos.x * P); out[i + 1] = Math.round(pos.y * P); out[i + 2] = Math.round(pos.z * P)
  out[i + 3] = Math.round(quat.x * R); out[i + 4] = Math.round(quat.y * R); out[i + 5] = Math.round(quat.z * R); out[i + 6] = Math.round(quat.w * R)
}
const unpackPose = (into, j, arr, i) => {
  into[j] = arr[i] / P; into[j + 1] = arr[i + 1] / P; into[j + 2] = arr[i + 2] / P
  into[j + 3] = arr[i + 3] / R; into[j + 4] = arr[i + 4] / R; into[j + 5] = arr[i + 5] / R; into[j + 6] = arr[i + 6] / R
}

// One sample = head (7), left hand (7 + grip + kind), right hand (9), held object (7): 32 floats.
const HEAD = 0, LEFT = 7, RIGHT = 16, HELD = 25, SIZE = 32
const _qa = new Quaternion(), _qb = new Quaternion()

/** The last few poses of one peer and a reader that interpolates between them a little in the past. */
class Track {
  constructor() {
    this.data = new Float32Array(RING * SIZE)
    this.times = new Float64Array(RING)
    this.flags = new Uint8Array(RING) // bit 1 left, 2 right, 4 held
    this.heldId = new Array(RING).fill(null)
    this.count = 0
    this.head = 0 // next slot
    this.lastSeen = 0
    this.lastTick = -1
  }
  push(t, state) {
    // Awareness re-sends an unchanged state every 15 s as a heartbeat (also from a hidden tab whose frame
    // loop has stopped): the tick counter tells a real pose from a repeat, which must not look like life.
    if (typeof state.t === 'number') { if (state.t === this.lastTick) return; this.lastTick = state.t }
    const s = this.head, o = s * SIZE
    const d = this.data, p = state.p
    if (!Array.isArray(p) || p.length < 7) return
    unpackPose(d, o + HEAD, p, 0)
    let flags = 0
    if (Array.isArray(state.l) && state.l.length >= 9) { unpackPose(d, o + LEFT, state.l, 0); d[o + LEFT + 7] = state.l[7] / 100; d[o + LEFT + 8] = state.l[8]; flags |= 1 }
    if (Array.isArray(state.r) && state.r.length >= 9) { unpackPose(d, o + RIGHT, state.r, 0); d[o + RIGHT + 7] = state.r[7] / 100; d[o + RIGHT + 8] = state.r[8]; flags |= 2 }
    const held = state.f?.held
    if (held && Array.isArray(held.p) && held.p.length >= 7) { unpackPose(d, o + HELD, held.p, 0); this.heldId[s] = held.id; flags |= 4 } else this.heldId[s] = null
    this.flags[s] = flags
    this.times[s] = t
    this.head = (s + 1) % RING
    if (this.count < RING) this.count++
    this.lastSeen = t
  }
  /** Indices (a, b) of the samples around renderT and the blend between them. */
  locate(renderT) {
    const n = this.count
    if (n === 0) return null
    const newest = (this.head - 1 + RING) % RING
    if (n === 1 || renderT >= this.times[newest]) return [newest, newest, 0]
    let b = newest
    for (let k = 1; k < n; k++) {
      const a = (newest - k + RING) % RING
      if (this.times[a] <= renderT) {
        const span = this.times[b] - this.times[a]
        return [a, b, span > 0 ? (renderT - this.times[a]) / span : 0]
      }
      b = a
    }
    return [b, b, 0] // older than everything we kept
  }
  /** Write the interpolated pose at offset `part` into pos/quat; returns false when that part is absent. */
  read(renderT, part, pos, quat) {
    const at = this.locate(renderT)
    if (!at) return false
    const [a, b, u] = at
    const bit = part === LEFT ? 1 : part === RIGHT ? 2 : part === HELD ? 4 : 0
    if (bit && !(this.flags[a] & bit && this.flags[b] & bit)) {
      const s = this.flags[b] & bit ? b : this.flags[a] & bit ? a : -1
      if (s < 0) return false
      return this.readSlot(s, part, pos, quat)
    }
    const d = this.data, oa = a * SIZE + part, ob = b * SIZE + part
    pos.set(d[oa] + (d[ob] - d[oa]) * u, d[oa + 1] + (d[ob + 1] - d[oa + 1]) * u, d[oa + 2] + (d[ob + 2] - d[oa + 2]) * u)
    _qa.set(d[oa + 3], d[oa + 4], d[oa + 5], d[oa + 6])
    _qb.set(d[ob + 3], d[ob + 4], d[ob + 5], d[ob + 6])
    quat.slerpQuaternions(_qa, _qb, u).normalize()
    return true
  }
  readSlot(s, part, pos, quat) {
    const d = this.data, o = s * SIZE + part
    pos.set(d[o], d[o + 1], d[o + 2])
    quat.set(d[o + 3], d[o + 4], d[o + 5], d[o + 6]).normalize()
    return true
  }
  /** Grip 0..1 and kind (0 hand, 1 controller) of a hand part, from the newest sample. */
  handInfo(part) {
    const s = (this.head - 1 + RING) % RING
    const o = s * SIZE + part
    return this.flags[s] & (part === LEFT ? 1 : 2) ? [this.data[o + 7], this.data[o + 8]] : null
  }
  heldObject() {
    const s = (this.head - 1 + RING) % RING
    return this.flags[s] & 4 ? this.heldId[s] : null
  }
}

/**
 * One connection to one room. Create with `createMultiplayer`, or let <Multiplayer> do it.
 *   mp.doc, mp.awareness, mp.provider   the Yjs pieces (provider is null while no relay is configured)
 *   mp.me                                { id, name, color, handle }
 *   mp.subscribe(fn) / mp.getSnapshot()  { connected, synced, peers: [{ id, name, color, handle, kind, fields }] }
 *   mp.setPose(head, left, right)        called by <Multiplayer> every frame; sent PRESENCE_HZ times a second
 *   mp.setFields(patch) / mp.hold(id, pos, quat) / mp.release()   presence (sent with the next pose)
 *   mp.peerHead(id, pos, quat), mp.peerHand(id, 'left'|'right', pos, quat), mp.peerHeld(id, pos, quat)   smoothed reads
 */
export class Multiplayer {
  constructor({ room = defaultRoom(), name, color, handle = null, url = relayUrl() } = {}) {
    this.room = ROOM_ID.test(room) ? room : slug('dev-' + room)
    this.doc = new Y.Doc()
    const myName = name || sessionName()
    this.me = { id: this.doc.clientID, name: myName, color: color || colorFor(myName), handle }
    this.listeners = new Set()
    this.snapshot = { connected: false, synced: false, peers: [] }
    this.tracks = new Map() // clientID → Track
    this.local = { n: this.me.name, c: this.me.color, h: handle, k: 'screen', t: 0, p: [0, 0, 0, 0, 0, 0, 1000], l: null, r: null, f: {} }
    this.dirty = true
    this.lastSend = 0
    this.stats = { bytesPerUpdate: 0, sentPerSecond: 0, _sent: 0, _since: 0 }
    this.offline = url === 'off' // VITE_GRASPABLE_REALTIME=off: no relay, one person
    this.provider = null
    this.awareness = null
    this.rosterKey = ''
    if (this.offline) {
      console.info('[multiplayer] the relay is switched off (VITE_GRASPABLE_REALTIME=off): running single-user')
      // a stand-alone awareness so presence APIs keep working
      this.awareness = new WebsocketProvider('ws://localhost:1', this.room, this.doc, { connect: false, disableBc: true }).awareness
    } else {
      this.provider = new WebsocketProvider(url.replace(/\/+$/, '') + '/r', this.room, this.doc, { disableBc: true, maxBackoffTime: 5000 })
      this.awareness = this.provider.awareness
      this.provider.on('status', ({ status }) => this.update({ connected: status === 'connected' }))
      this.provider.on('sync', (synced) => this.update({ synced }))
      this.provider.on('closed', ({ code, reason }) => console.warn(`[multiplayer] the relay closed the connection (${code} ${reason}); staying single-user`))
    }
    this.awareness.setLocalState(this.local)
    this.onAwareness = ({ added, updated, removed }) => {
      const now = performance.now()
      const states = this.awareness.getStates()
      for (const id of added.concat(updated)) {
        if (id === this.me.id) continue
        const s = states.get(id)
        if (!s) continue
        let t = this.tracks.get(id)
        if (!t) this.tracks.set(id, (t = new Track()))
        t.push(now, s)
      }
      for (const id of removed) this.tracks.delete(id)
      this.roster()
    }
    this.awareness.on('update', this.onAwareness)
  }

  // ---- for React ----
  subscribe(fn) { this.listeners.add(fn); return () => this.listeners.delete(fn) }
  getSnapshot() { return this.snapshot }
  update(patch) { this.snapshot = { ...this.snapshot, ...patch }; for (const fn of this.listeners) fn(this.snapshot) }
  /** Re-read who is here; a React update only when a name, colour, handle, kind or a low-rate field changed. */
  roster() {
    const peers = []
    for (const [id, s] of this.awareness.getStates()) {
      if (id === this.me.id || !s) continue
      const { held, ...fields } = s.f ?? {}
      peers.push({ id, name: s.n ?? 'Someone', color: s.c ?? colorFor(id), handle: s.h ?? null, kind: s.k ?? 'screen', fields })
    }
    peers.sort((a, b) => a.id - b.id)
    const key = JSON.stringify(peers)
    if (key !== this.rosterKey) { this.rosterKey = key; this.update({ peers }) }
  }

  // ---- presence out ----
  setIdentity({ name, color, handle }) {
    if (name) { this.me.name = name; this.local.n = name }
    if (color) { this.me.color = color; this.local.c = color }
    if (handle !== undefined) { this.me.handle = handle; this.local.h = handle }
    this.dirty = true
  }
  /** Called every frame with world-space poses; null for a hand that is not tracked. kind: 'xr' | 'screen'. */
  setPose(kind, head, left, right) {
    const L = this.local
    L.k = kind
    packPose(L.p, 0, head.position, head.quaternion)
    L.l = left ? this.packHand(L.l, left) : null
    L.r = right ? this.packHand(L.r, right) : null
  }
  packHand(arr, hand) {
    arr ??= new Array(9).fill(0)
    packPose(arr, 0, hand.position, hand.quaternion)
    arr[7] = Math.round(Math.min(1, Math.max(0, hand.grip ?? 0)) * 100)
    arr[8] = hand.kind === 'controller' ? 1 : 0
    return arr
  }
  /** Low-rate presence: merged into the fields others see as peer.fields. Sent with the next pose. */
  setFields(patch) { this.local.f = { ...this.local.f, ...patch }; this.dirty = true }
  /** While you hold a shared object: its id and pose, every frame (sent PRESENCE_HZ times a second). */
  hold(id, position, quaternion) {
    let held = this.local.f.held
    if (!held || held.id !== id) { held = { id, p: new Array(7).fill(0) }; this.local.f = { ...this.local.f, held } }
    packPose(held.p, 0, position, quaternion)
  }
  release() { if (this.local.f.held) { const { held, ...rest } = this.local.f; this.local.f = rest; this.dirty = true } }
  holding() { return this.local.f.held?.id ?? null }
  /** Send at most PRESENCE_HZ times a second; <Multiplayer> calls this every frame. */
  flush(now = performance.now()) {
    if (now - this.lastSend < 1000 / PRESENCE_HZ) return
    this.lastSend = now
    // A fresh object when identity or fields changed, so local 'change' listeners see it; the same
    // object (mutated in place) for poses alone, which only need to be sent.
    if (this.dirty) { this.local = { ...this.local }; this.dirty = false }
    this.local.t = (this.local.t + 1) % 1000000
    this.awareness.setLocalState(this.local)
    const st = this.stats
    st._sent++
    if (now - st._since > 1000) {
      st.sentPerSecond = st._sent / ((now - st._since) / 1000); st._sent = 0; st._since = now
      st.bytesPerUpdate = encodeAwarenessUpdate(this.awareness, [this.me.id]).byteLength + 2 // + the message type and length prefix
    }
  }

  // ---- presence in (for useFrame: no allocation, no React) ----
  track(id) { return this.tracks.get(id) }
  renderTime(now = performance.now()) { return now - DELAY_MS }
  peerHead(id, pos, quat, now) { const t = this.tracks.get(id); return !!t && t.read(this.renderTime(now), HEAD, pos, quat) }
  peerHand(id, side, pos, quat, now) { const t = this.tracks.get(id); return !!t && t.read(this.renderTime(now), side === 'left' ? LEFT : RIGHT, pos, quat) }
  /** [grip 0..1, kind 0 hand | 1 controller] or null. */
  peerHandInfo(id, side) { const t = this.tracks.get(id); return t ? t.handInfo(side === 'left' ? LEFT : RIGHT) : null }
  /** The id of the object this peer holds (null if none); with pos/quat given, its smoothed pose is written too. */
  peerHeld(id, pos, quat, now) {
    const t = this.tracks.get(id)
    if (!t) return null
    const held = t.heldObject()
    if (held !== null && pos && quat) t.read(this.renderTime(now), HELD, pos, quat)
    return held
  }
  /** Milliseconds since this peer was last heard from (Infinity if never). */
  peerAge(id, now = performance.now()) { const t = this.tracks.get(id); return t ? now - t.lastSeen : Infinity }
  /** 1 while fresh, fading to 0 between STALE_MS and GONE_MS. */
  peerOpacity(id, now) { const age = this.peerAge(id, now); return age < STALE_MS ? 1 : Math.max(0, 1 - (age - STALE_MS) / (GONE_MS - STALE_MS)) }
  peerFields(id) { return this.awareness.getStates().get(id)?.f ?? null }

  destroy() {
    this.awareness.off('update', this.onAwareness)
    this.awareness.setLocalState(null)
    this.provider?.destroy()
    this.awareness.destroy?.()
    this.doc.destroy()
    this.listeners.clear()
  }
}

export const createMultiplayer = (options) => new Multiplayer(options)

// Scratch objects for callers that want to read a pose without allocating.
export const scratch = { position: new Vector3(), quaternion: new Quaternion() }
