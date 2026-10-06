// <Multiplayer room name color handle> connects the scene to a room and shows everyone else as an avatar.
// Put it inside <XR> (it reads the headset's tracked hands and controllers) around the parts that share state.
//
//   const { connected, synced, peers, me, doc, mp } = useMultiplayer()
//   const [count, setCount] = useShared('count', 0)          // one Y.Map entry, like useState, last writer wins
//   const { items, set, update, remove } = useSharedMap('objects') // a collection keyed by id
//   const [fields, setFields] = usePresence()                 // low-rate per-person fields others see as peer.fields
//   mp.hold(id, position, quaternion) / mp.release()          // while you carry a shared object (every frame)
//   mp.peerHead / peerHand / peerHeld(id, pos, quat)          // smoothed poses of others, for useFrame
//
// Nothing here re-renders React per network tick: poses go through refs in useFrame.
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import { useFrame } from '@react-three/fiber'
import { UNSAFE_useXRStore } from '@react-three/xr'
import { Matrix4, Quaternion, Vector3 } from 'three'
import { Multiplayer as Connection, defaultRoom } from '../lib/multiplayer'
import { Avatar } from './Avatar'

const Context = createContext(null)

/** The connection object itself (for useFrame code). Throws outside <Multiplayer>. */
export function useMp() {
  const mp = useContext(Context)
  if (!mp) throw new Error('useMp/useMultiplayer/useShared need a <Multiplayer> above them')
  return mp
}

export function Multiplayer({ room, name, color, handle, avatars = true, children }) {
  const resolvedRoom = room ?? defaultRoom()
  const mp = useMemo(() => new Connection({ room: resolvedRoom, name, color, handle }), [resolvedRoom]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (import.meta.env.DEV) window.__graspableMultiplayer = mp // for looking at mp.stats and mp.me in the preview
    return () => { mp.destroy(); if (window.__graspableMultiplayer === mp) delete window.__graspableMultiplayer }
  }, [mp])
  useEffect(() => { mp.setIdentity({ name, color, handle }) }, [mp, name, color, handle])
  return (
    <Context.Provider value={mp}>
      <PosePublisher mp={mp} />
      {avatars && <Avatars />}
      {children}
    </Context.Provider>
  )
}

/** { connected, synced, peers, me, doc, mp } — re-renders only when who is here changes. */
export function useMultiplayer() {
  const mp = useMp()
  const snap = useSyncExternalStore(mp.subscribe.bind(mp), mp.getSnapshot.bind(mp), mp.getSnapshot.bind(mp))
  return { ...snap, me: mp.me, doc: mp.doc, mp }
}

/** Everyone else, as avatars. <Multiplayer> renders this unless avatars={false}; use it yourself to place them elsewhere in the tree. */
export function Avatars() {
  const { peers } = useMultiplayer()
  return peers.map((p) => <Avatar key={p.id} {...p} />)
}

const SHARED = 'shared'

/**
 * [value, setValue] over one entry of the room's `shared` Y.Map. Last writer wins; `initial` shows until the
 * room has a value and is written once the document has synced and the entry is still missing.
 */
export function useShared(key, initial) {
  const mp = useMp()
  const map = mp.doc.getMap(SHARED)
  const read = () => (map.has(key) ? map.get(key) : initial)
  const [value, setValue] = useState(read)
  useEffect(() => {
    const on = (e) => { if (e.keysChanged.has(key)) setValue(map.has(key) ? map.get(key) : initial) }
    map.observe(on)
    setValue(read())
    const seed = () => { if (initial !== undefined && !map.has(key)) map.set(key, initial) }
    if (mp.offline || mp.provider?.synced) seed()
    const onSync = (synced) => { if (synced) seed() }
    mp.provider?.on('sync', onSync)
    return () => { map.unobserve(on); mp.provider?.off('sync', onSync) }
  }, [map, key]) // eslint-disable-line react-hooks/exhaustive-deps
  const set = useCallback((next) => { map.set(key, typeof next === 'function' ? next(map.has(key) ? map.get(key) : initial) : next) }, [map, key, initial])
  return [value, set]
}

/**
 * A Y.Map used as a collection: `items` is a plain object snapshot (re-rendered on any change),
 * `set(id, value)` replaces an entry, `update(id, patch)` merges into it, `remove(id)` deletes it.
 * Values are plain JSON; keep them small and change them when something settles, not every frame.
 */
export function useSharedMap(name) {
  const mp = useMp()
  const map = mp.doc.getMap(name)
  const [items, setItems] = useState(() => map.toJSON())
  useEffect(() => {
    const on = () => setItems(map.toJSON())
    map.observeDeep(on)
    on()
    return () => map.unobserveDeep(on)
  }, [map])
  return useMemo(() => ({
    map,
    items,
    set: (id, value) => map.set(id, value),
    update: (id, patch) => map.set(id, { ...(map.get(id) ?? {}), ...patch }),
    remove: (id) => map.delete(id),
    transact: (fn) => mp.doc.transact(fn),
  }), [map, items, mp])
}

/** [fields, setFields]: your own low-rate presence fields (merged). Others see them as peer.fields. */
export function usePresence() {
  const mp = useMp()
  const [fields, setLocal] = useState(() => { const { held, ...rest } = mp.local.f; return rest })
  const setFields = useCallback((patch) => { mp.setFields(patch); setLocal((f) => ({ ...f, ...patch })) }, [mp])
  return [fields, setFields]
}

// ---- where I am: head and hands in world space, every frame, sent at PRESENCE_HZ ----------------
const IDENTITY = new Matrix4()
const _scale = new Vector3()
const _a = new Vector3(), _b = new Vector3()
const clamp01 = (v) => Math.min(1, Math.max(0, v))

function PosePublisher({ mp }) {
  const xrStore = UNSAFE_useXRStore()
  const tmp = useRef({
    head: { position: new Vector3(), quaternion: new Quaternion() },
    left: { position: new Vector3(), quaternion: new Quaternion(), grip: 0, kind: 'hand' },
    right: { position: new Vector3(), quaternion: new Quaternion(), grip: 0, kind: 'hand' },
    m: new Matrix4(),
  }).current
  useFrame((state, _dt, frame) => {
    const xr = xrStore?.getState()
    // In XR the camera React Three Fiber renders with is the headset camera, parented to the XROrigin:
    // its world matrix is the head in the scene's world space, origin moves and teleports included.
    state.camera.matrixWorld.decompose(tmp.head.position, tmp.head.quaternion, _scale)
    let left = null, right = null
    const ref = xr?.originReferenceSpace
    if (frame && xr?.session && ref) {
      const originM = xr.origin ? xr.origin.matrixWorld : IDENTITY
      for (const s of xr.inputSourceStates) {
        if (s.type !== 'hand' && s.type !== 'controller') continue
        const side = s.inputSource.handedness
        if (side !== 'left' && side !== 'right') continue
        const out = side === 'left' ? tmp.left : tmp.right
        let pose = null, grip = 0
        if (s.type === 'hand') {
          const hand = s.inputSource.hand
          const wrist = hand?.get('wrist')
          pose = wrist && frame.getJointPose ? frame.getJointPose(wrist, ref) : null
          const thumb = hand?.get('thumb-tip'), index = hand?.get('index-finger-tip')
          if (pose && thumb && index) {
            const t = frame.getJointPose(thumb, ref), i = frame.getJointPose(index, ref)
            if (t && i) {
              _a.set(t.transform.position.x, t.transform.position.y, t.transform.position.z)
              _b.set(i.transform.position.x, i.transform.position.y, i.transform.position.z)
              grip = clamp01(1 - (_a.distanceTo(_b) - 0.015) / 0.05) // touching = 1, 6.5 cm apart = 0
            }
          }
        } else {
          pose = s.inputSource.gripSpace ? frame.getPose(s.inputSource.gripSpace, ref) : null
          const g = s.gamepad ?? {}
          grip = Math.max(g['xr-standard-squeeze']?.button ?? 0, g['xr-standard-trigger']?.button ?? 0)
        }
        if (!pose) continue
        tmp.m.fromArray(pose.transform.matrix).premultiply(originM).decompose(out.position, out.quaternion, _scale)
        out.grip = grip
        out.kind = s.type
        if (side === 'left') left = out; else right = out
      }
    }
    mp.setPose(xr?.session ? 'xr' : 'screen', tmp.head, left, right)
    mp.flush()
  })
  return null
}
