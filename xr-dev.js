// Graspable dev-only XR bridge (not part of production builds — see index.jsx).
// Emulates a headset with IWER so the preview can enter XR on a desktop, and exposes
// record/replay of real sessions so a play-through becomes a deterministic fixture.
//
// Protocol with the Graspable app (window.parent via postMessage, source "graspable-xr"):
//   → { type: "graspable-xr", op: "record" | "stop" | "replay", recording?, options? }
//   → { type: "graspable-xr", op: "highlight", file, line }      outline the objects written at file:line
//   → { type: "graspable-xr", op: "room", room }                 load a synthetic room (hit tests, planes, meshes)
//   → { type: "graspable-xr", op: "device", device }             reload the page emulating "quest3" or "glasses"
//   → { type: "graspable-xr", op: "tree" }                       ← { op: "tree", nodes } the scene hierarchy (Scene panel)
//   → { type: "graspable-xr", op: "select", id }                 outline one object (by uuid)
//   ← { type: "graspable-xr", op: "ready" | "recording" | "replayed" | "error", ... }
//   ← { type: "graspable-xr", op: "picked", source, objectType, id }  ⌥-click on an object in the preview
// Source locations come from graspable-source.js (userData.graspableSource = "App.jsx:26:5-33:11").
// The Graspable harness also calls window.__graspableXR.replay() directly to run fixtures as tests.
//
// AR needs a world: IWER's Synthetic Environment Module loads a scanned room (living_room,
// meeting_room, music_room, office_large, office_small) so hit tests, planes and meshes behave like
// Quest passthrough; its DevUI lets you point controllers and press buttons with mouse + keyboard.
// Fixtures store the room, and replays load the same one.
import { XRDevice, ActionRecorder, metaQuest3, metaVRGlasses } from 'iwer'
import { SyntheticEnvironmentModule } from '@iwer/sem'
import { DevUI } from '@iwer/devui'
import { _roots } from '@react-three/fiber'
import { Box3, Box3Helper, Vector3 } from 'three'

// Which headset is emulated: Quest 3 (controllers and hands), or Meta VR Glasses (eyes and hands: gaze to aim,
// pinch to select, a narrower view). `?xrDevice=glasses` on the page picks the glasses; the preview toolbar sets it.
const DEVICES = { quest3: metaQuest3, glasses: metaVRGlasses }
const deviceId = Object.hasOwn(DEVICES, new URLSearchParams(location.search).get('xrDevice')) ? new URLSearchParams(location.search).get('xrDevice') : 'quest3'
const device = new XRDevice(DEVICES[deviceId])
/** The runtime is installed once per page: another headset means a reload with `?xrDevice=`. */
function switchDevice(id) { if (!Object.hasOwn(DEVICES, id) || id === deviceId) return; const url = new URL(location.href); url.searchParams.set('xrDevice', id); location.replace(url) }
device.installRuntime({ forceInstall: true })
device.installSEM(SyntheticEnvironmentModule)
device.installDevUI(DevUI)

// DevUI re-applies its own controller/headset poses every frame (it ignores IWER's control mode),
// which would undo a replay or scripted actions: pause its per-frame render while they run.
function suspendDevUI() { const d = device.devui; if (d && !d.suspendedRender) { d.suspendedRender = d.render; d.render = () => {} } }
function resumeDevUI() { const d = device.devui; if (d?.suspendedRender) { d.render = d.suspendedRender; d.suspendedRender = null } }

export const ROOMS = ['living_room', 'meeting_room', 'music_room', 'office_large', 'office_small']
const state = { recorder: null, session: null, refSpace: null, frames: 0, mode: null, beforeTop: null, rigRoots: null, room: null }

/** Load a synthetic room and resolve once its planes/meshes are tracked (hit tests need them). */
async function loadRoom(room = 'living_room') {
  if (!ROOMS.includes(room)) throw new Error(`unknown room ${room} (one of ${ROOMS.join(', ')})`)
  if (state.room === room) return room
  device.sem.deleteAll()
  device.sem.loadDefaultEnvironment(room)
  for (let i = 0; i < 100 && !(device.sem.trackedPlanes.size || device.sem.trackedMeshes.size); i++) await new Promise((r) => setTimeout(r, 50))
  state.room = room
  post({ op: 'room', room })
  return room
}
const roomReady = loadRoom(new URLSearchParams(location.search).get('xrRoom') ?? 'living_room').catch((err) => post({ op: 'error', message: String(err?.message ?? err) }))
// The app's canvas is the one React Three Fiber renders into: IWER's room and DevUI add canvases of their own.
const appCanvas = () => [...document.querySelectorAll('canvas')].find((c) => _roots?.get?.(c)) ?? null
const r3fState = () => { const canvas = appCanvas(); return canvas && _roots.get(canvas).store.getState() }
const topIds = () => (r3fState()?.scene?.children ?? []).map((o) => o.uuid)
// The XR input rig (origin group with controllers/hands, pointer rays) is mounted as new top-level
// subtrees once a session starts; controller models load into them later. Freeze the set of
// top-level objects added since session start when recording/replay begins (or after 3 s), and
// leave those subtrees out of scene assertions. Objects the app adds during a recording still count.
const inRigTree = (o) => { for (let p = o; p; p = p.parent) if (state.rigRoots?.has(p.uuid)) return true; return false }
function freezeRig() { if (!state.rigRoots && state.beforeTop) state.rigRoots = new Set(topIds().filter((id) => !state.beforeTop.has(id))) }
const post = (msg) => window.parent !== window && window.parent.postMessage({ type: 'graspable-xr', ...msg }, '*')
// Scene graph summary from the React Three Fiber root (type, name, position, mesh colour) for scene assertions.
function sceneSnapshot() {
  const st = r3fState()
  if (!st?.scene) return null
  const out = []
  st.scene.traverse((o) => {
    if (o === st.scene || inRigTree(o) || o.userData?.graspableHelper) return
    const mat = o.material && !Array.isArray(o.material) ? o.material : null
    out.push({ type: o.type, name: o.name || null, position: o.position ? o.position.toArray().map((n) => +n.toFixed(3)) : null, color: mat?.color?.getHexString?.() ?? null, visible: o.visible })
  })
  return out
}

// PNG of the app canvas right after the next frame (works without preserveDrawingBuffer); null if there is no canvas.
const capture = () => new Promise((resolve) => requestAnimationFrame(() => { const c = appCanvas(); try { resolve(c ? c.toDataURL('image/png') : null) } catch { resolve(null) } }))

// Observe the app's session so we can record frames without touching app code.
const origRequest = navigator.xr.requestSession.bind(navigator.xr)
navigator.xr.requestSession = async (mode, init) => {
  const beforeTop = new Set(topIds())
  const session = await origRequest(mode, init)
  state.session = session
  state.mode = mode
  state.beforeTop = beforeTop
  state.rigRoots = null
  setTimeout(freezeRig, 3000)
  state.refSpace = await session.requestReferenceSpace('local-floor').catch(() => session.requestReferenceSpace('local'))
  const origRAF = session.requestAnimationFrame.bind(session)
  session.requestAnimationFrame = (cb) => origRAF((t, frame) => { state.frame = frame; if (state.recorder) { state.recorder.recordFrame(frame); state.frames++ } cb(t, frame) })
  session.addEventListener('end', () => { state.session = null; if (state.recorder) stop() })
  return session
}

function record(options = {}) {
  if (!state.session || !state.refSpace) throw new Error('enter XR first (press Enter AR/VR in the preview)')
  freezeRig()
  state.recorder = new ActionRecorder(state.session, state.refSpace, { maxDurationMs: options.maxDurationMs ?? 120_000, capPolicy: 'stop' })
  state.frames = 0
  post({ op: 'ready', recording: true })
}

function takeRecording() {
  const rec = state.recorder
  state.recorder = null
  if (!rec) return null
  const raw = rec.toJSON()
  return typeof raw === 'string' ? JSON.parse(raw) : raw
}

function stop() {
  const recording = takeRecording()
  if (!recording) return null
  capture().then((screenshot) => post({ op: 'recording', recording, frames: state.frames, mode: state.mode, room: state.room, device: deviceId, screenshot, scene: sceneSnapshot() }))
  return recording
}

async function replay(recording, options = {}) {
  await roomReady
  await loadRoom(options.room ?? state.room ?? 'living_room')
  if (!state.session) {
    // Replay needs a live session: start one the same way the app does (mode from the fixture when present).
    await navigator.xr.requestSession(options.mode ?? 'immersive-vr', { optionalFeatures: ['local-floor', 'hand-tracking'] })
    await new Promise((resolve) => setTimeout(resolve, 1000)) // let the XR layer mount its rig
  }
  freezeRig()
  suspendDevUI()
  const player = device.createActionPlayer(state.refSpace, recording, { loop: false, playbackRate: options.playbackRate ?? 1 })
  // Without an event context the player moves the recorded controllers but never fires their
  // select/squeeze events: recorded trigger pulls and grips would replay as nothing.
  player.setEventContext({ session: state.session, getFrame: () => state.frame })
  const frames = recording?.frames ?? []
  if (options.step !== undefined) { player.stepFrames(options.step); return player }
  if (options.realtime) {
    const durationMs = frames.length > 1 ? frames[frames.length - 1][0] - frames[0][0] : 0
    await new Promise((resolve) => { player.play(); setTimeout(resolve, durationMs / (options.playbackRate ?? 1) + 300) })
  } else if (!(recording?.schema ?? []).some(([, schema]) => schema?.hasHand)) {
    // Deterministic, live-driven: each recorded frame is applied to the *live* emulated headset and
    // controllers inside the XR frame callback — exactly how the recording was produced — so the app
    // keeps its input sources (no swap it must re-bind to) and IWER emits select/squeeze itself.
    player.stop()
    const schemas = new Map(recording.schema)
    const apply = (f) => {
      device.position.set(f[1], f[2], f[3])
      device.quaternion.set(f[4], f[5], f[6], f[7])
      for (const input of f.slice(8)) {
        if (!Array.isArray(input)) continue
        const controller = device.controllers[schemas.get(input[0])?.handedness]
        if (!controller) continue
        controller.position.set(input[1], input[2], input[3])
        controller.quaternion.set(input[4], input[5], input[6], input[7])
        const { buttons = [], axes = [] } = controller.gamepadConfig ?? {}
        ;(input[9] ?? []).forEach((b, i) => { if (buttons[i] && Array.isArray(b)) controller.updateButtonValue(buttons[i].id, b[2] ?? 0) })
        input.slice(10).forEach((v, i) => { if (axes[i] && typeof v === 'number') controller.updateAxis(axes[i].id, axes[i].type, v) })
      }
    }
    const inFrame = (fn) => new Promise((resolve) => state.session.requestAnimationFrame(() => { fn(); resolve() }))
    for (let i = 0; i < (options.warmupFrames ?? 10); i++) await inFrame(() => apply(frames[0]))
    for (let i = 1; i < frames.length; i++) await inFrame(() => apply(frames[i]))
    for (let i = 0; i < 3; i++) await inFrame(() => {}) // let the last edges and renders land
  } else {
    // Hand-tracked recordings: IWER's player provides the hands. Deterministic: one recorded frame
    // per rendered frame, so the replay always ends exactly on the last sample.
    // IWER's device loop calls playFrame() on a playing player every frame, advancing it by
    // wall-clock time even while we step it: switch that off so only our steps move it.
    player.playFrame = () => {}
    // Step inside the XR frame callback, so events carry the frame that is current when they fire.
    const stepInFrame = (n) => new Promise((resolve) => state.session.requestAnimationFrame(() => { player.stepFrames(n); resolve() }))
    const nextFrame = () => new Promise((resolve) => state.session.requestAnimationFrame(() => resolve()))
    // The player brings its own input sources: hold the first recorded frame while the app reacts
    // to the swap (new controllers, new hit test sources), as it had when the recording started.
    for (let i = 0; i < (options.warmupFrames ?? 45); i++) await stepInFrame(0)
    for (let i = 1; i < frames.length; i++) await stepInFrame(1)
    await nextFrame()
  }
  // Snapshot while the last recorded frame is still applied; stop() returns inputs to the live device pose.
  const screenshot = await capture()
  const scene = sceneSnapshot()
  player.stop()
  resumeDevUI()
  post({ op: 'replayed', screenshot, scene })
  // Returned too, for callers without a parent window (the harness drives the page headlessly).
  return { scene, screenshot }
}

// ---- scripted interaction (the harness's verify_app actions) -----------------------------
// IWER remote-control methods (device.remote.listMethods()): look_at { device, target }, select
// { device, duration? }, set_transform { device, position?, orientation? }, animate_to, set_gamepad_state
// { device, buttons?, axes? }, get_world_state, get_objects, get_transform… Devices: headset,
// controller-left, controller-right, hand-left, hand-right. [x, y, z] arrays are accepted for vectors.
// Plus \`press\` { device, button, value?, duration? }: a named button (trigger, squeeze, thumbstick,
// a-button, b-button, x-button, y-button, thumbrest) held for duration ms (default 150), then released —
// no need to know remote-control button indices, which differ from the xr-standard gamepad order.
const toVec = (v) => (Array.isArray(v) ? { x: v[0], y: v[1], z: v[2] } : v)
const normalize = (params = {}) => Object.fromEntries(Object.entries(params).map(([k, v]) => [k, ['target', 'position'].includes(k) ? toVec(v) : v]))
const round = (v) => +v.toFixed(3)
// Visible app objects in world space (what the agent reasons about), the XR rig and helpers left out.
function worldObjects(limit = 80) {
  const st = r3fState()
  if (!st?.scene) return []
  const out = []
  const p = new Vector3()
  st.scene.traverse((o) => {
    if (o === st.scene || !o.visible || !(o.isMesh || o.isLine || o.isPoints || o.isSprite) || inRigTree(o) || o.userData?.graspableHelper) return
    for (let q = o.parent; q; q = q.parent) if (!q.visible) return
    o.getWorldPosition(p)
    const mat = o.material && !Array.isArray(o.material) ? o.material : null
    out.push({ type: o.type, name: o.name || null, source: o.userData?.graspableSource ?? null, world: [round(p.x), round(p.y), round(p.z)], color: mat?.color?.getHexString?.() ?? null })
  })
  return out.slice(0, limit)
}
async function press({ device: id = 'controller-right', button = 'trigger', value = 1, duration = 150 }) {
  const controller = device.controllers[id.replace('controller-', '')]
  if (!controller) throw new Error(`press: no controller ${id} (controller-left or controller-right)`)
  const ids = (controller.gamepadConfig?.buttons ?? []).filter(Boolean).map((b) => b.id)
  if (!ids.includes(button)) throw new Error(`press: ${id} has no button ${button} (one of ${ids.join(', ')})`)
  controller.updateButtonValue(button, value)
  await new Promise((r) => setTimeout(r, Math.min(10_000, Math.max(16, duration))))
  controller.updateButtonValue(button, 0)
  return { device: id, button, duration }
}

async function act(actions = [], options = {}) {
  if (!state.session) throw new Error('enter XR first')
  freezeRig()
  suspendDevUI()
  if (options.record) record()
  const results = []
  for (const a of actions) {
    try { results.push({ method: a.method, result: a.method === 'press' ? await press(a.params ?? {}) : await device.remote.dispatch(a.method, normalize(a.params)) }) }
    catch (err) { results.push({ method: a.method, error: String(err?.message ?? err) }) }
    await new Promise((r) => setTimeout(r, Math.min(10_000, Math.max(0, a.wait_ms ?? 300))))
  }
  // Recorded while scripted: the same fixture format the preview's Record button writes.
  const fixture = options.record ? { frames: state.frames, mode: state.mode, room: state.room, scene: sceneSnapshot(), golden: await capture(), recording: takeRecording() } : null
  return { results, objects: worldObjects(), fixture }
}

// ---- scene ↔ code provenance -------------------------------------------------------------
const parseSource = (s) => { const m = /^(.+):(\d+):(\d+)-(\d+):(\d+)$/.exec(s ?? ''); return m && { file: m[1], from: +m[2], to: +m[4] } }

// ⌥-click in the preview: the nearest tagged object under the pointer (walking up to the JSX that
// wrote it) is reported to the app, which opens and selects that code. The app's own handlers
// never see the click.
window.addEventListener('pointerdown', (e) => {
  if (!e.altKey || e.button !== 0) return
  const st = r3fState()
  if (!st?.scene || !st.raycaster || !st.camera) return
  const rect = st.gl.domElement.getBoundingClientRect()
  st.raycaster.setFromCamera({ x: ((e.clientX - rect.left) / rect.width) * 2 - 1, y: -((e.clientY - rect.top) / rect.height) * 2 + 1 }, st.camera)
  for (const hit of st.raycaster.intersectObjects(st.scene.children, true)) {
    for (let o = hit.object; o; o = o.parent) {
      if (inRigTree(o)) break
      const source = o.userData?.graspableSource
      if (source) { e.preventDefault(); e.stopPropagation(); showHighlight([o]); post({ op: 'picked', source, objectType: o.type, name: o.name || null, id: o.uuid }); return }
    }
  }
}, true)

// Editor cursor → preview: outline the innermost objects whose JSX spans that line.
let helpers = []
let helperLoop = 0
function showHighlight(objects) {
  const st = r3fState()
  for (const h of helpers) { h.removeFromParent(); h.dispose?.() }
  helpers = []
  cancelAnimationFrame(helperLoop)
  if (!st?.scene || !objects.length) return
  // A padded box, so the outline stands clear of the object instead of tracing its own edges.
  const size = new Vector3()
  const fit = (box, o) => { box.setFromObject(o); box.getSize(size); return box.expandByScalar(Math.max(size.x, size.y, size.z) * 0.08 + 0.01) }
  helpers = objects.map((o) => { const h = new Box3Helper(fit(new Box3(), o), 0x22d3ee); h.userData.target = o; h.userData.graspableHelper = true; st.scene.add(h); return h })
  const follow = () => { for (const h of helpers) fit(h.box, h.userData.target); helperLoop = requestAnimationFrame(follow) }
  follow()
}
function highlight(file, line) {
  const st = r3fState()
  if (!st?.scene || !file || !line) return showHighlight([])
  let best = [], bestSpan = Infinity
  st.scene.traverse((o) => {
    const src = parseSource(o.userData?.graspableSource)
    if (!src || src.file !== file || line < src.from || line > src.to || inRigTree(o)) return
    const span = src.to - src.from
    if (span < bestSpan) { best = [o]; bestSpan = span } else if (span === bestSpan) best.push(o)
  })
  showHighlight(best)
}

// Scene panel: every object once, linked to its parent (top-level objects have parent null); the XR
// rig is flagged, outline helpers are left out.
function sceneTree(limit = 2000) {
  const st = r3fState()
  if (!st?.scene) return null
  const nodes = []
  st.scene.traverse((o) => {
    if (o === st.scene || o.userData?.graspableHelper || nodes.length >= limit) return
    nodes.push({ id: o.uuid, parent: o.parent === st.scene ? null : o.parent?.uuid ?? null, type: o.type, name: o.name || null, source: o.userData?.graspableSource ?? null, visible: o.visible, rig: inRigTree(o) })
  })
  return nodes
}
function select(id) { const o = id && r3fState()?.scene?.getObjectByProperty('uuid', id); showHighlight(o ? [o] : []) }

// Stop / restart React Three Fiber's frame loop: a heavy scene (splats on software WebGL) never
// leaves the page idle long enough for a screenshot; paused, the last frame can be captured.
function pause() { const st = r3fState(); if (!st?.setFrameloop) return false; state.frameloop = st.frameloop; st.setFrameloop('never'); return true }
function resume() { const st = r3fState(); if (st?.setFrameloop && state.frameloop) st.setFrameloop(state.frameloop) }

window.__graspableXR = { device, record, stop, replay, sceneSnapshot, sceneTree, select, worldObjects, act, highlight, loadRoom, suspendDevUI, resumeDevUI, pause, resume, get state() { return state } }
window.addEventListener('message', (e) => {
  const m = e.data
  if (!m || m.type !== 'graspable-xr') return
  Promise.resolve().then(() => (m.op === 'device' ? switchDevice(m.device) : m.op === 'record' ? record(m.options) : m.op === 'stop' ? stop() : m.op === 'replay' ? replay(m.recording, m.options) : m.op === 'highlight' ? highlight(m.file, m.line) : m.op === 'room' ? loadRoom(m.room) : m.op === 'tree' ? post({ op: 'tree', nodes: sceneTree() }) : m.op === 'select' ? select(m.id) : undefined)).catch((err) => post({ op: 'error', message: String(err?.message ?? err) }))
})
post({ op: 'ready', device: deviceId })
