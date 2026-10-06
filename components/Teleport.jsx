// Teleporting: point at a spot and be there, for people whom walking with the thumbstick makes queasy.
// Where the arc comes down and whether a person may stand there is lib/theatre/teleport.js; this component reads
// the hands, draws the arc and the ring, and asks the walking code (components/Walk.jsx) for the move, which
// happens behind the same short fade as a viewpoint.
//
//   controllers   push the thumbstick of the pointing hand forward and hold: the arc leaves that controller.
//                 Turning the stick left or right turns the ring's arrow. Let go: you are there, facing the way
//                 the arrow points (with the stick straight forward: the way you threw).
//                 With "Walk through walls" on, that stick moves you up and down, so the arc is on the trigger of
//                 the other controller (the one that carries the menu): hold it, aim, let go. It does not start
//                 while that controller points at the menu or a hotspot.
//   bare hands    point with the pointing hand, palm up, index finger out: the arc leaves the hand. Pinch thumb
//                 and index finger to go. Not while that hand is on the menu, a slider, the keys or a hotspot.
//   the pointing hand is the one that does not carry the menu: the right one, or the left one for people who
//                 moved the menu to their right hand (the menu's About tab)
//   ring          yellow where you may land, red where you may not (nothing happens then)
//   computer      double-click the ground (double-tap on a touch screen): you are taken there, looking the way
//                 you looked. A place you may not land on does nothing; one too far away says so.
//
// Only this person sees their arc. All its dots are one instanced mesh and the ring is one mesh: two draw calls
// while it is out, none otherwise.
import { useEffect, useMemo, useRef } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import { useXR } from '@react-three/xr'
import { ConeGeometry, Matrix4, MeshBasicMaterial, Object3D, Quaternion, SphereGeometry, TorusGeometry, Vector3 } from 'three'
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js'
import { useMultiplayer } from './Multiplayer'
import { createTeleport } from '../lib/theatre/teleport'
import { aim, isBusy, player, say, useApp } from '../lib/theatre/app'

const DOTS = 80, GAP = 0.2 // how many dots the arc has at most, and how far apart they are (metres)
const MAY = '#ffe600', MAY_NOT = '#ff3b30' // his accent yellow; a red that also reads at night
const HAND = { up: 0.5, keep: 0.2, straight: 0.93, hold: 0.2, pinch: 0.02, apart: 0.035, tilt: 0.35 }
const AGAIN = 0.5 // seconds before the next arc after a move
const BEFORE = 0.15, PAST = 24 // a pinch tugs at the hand: it goes where the arc stood this many seconds before it closed

const UP = new Vector3(0, 1, 0)
const _m = new Matrix4(), _q = new Quaternion(), _o = new Object3D()
const _from = new Vector3(), _dir = new Vector3(), _a = new Vector3(), _b = new Vector3(), _c = new Vector3(), _eye = new Vector3()
const J = { wrist: new Vector3(), index: new Vector3(), mid: new Vector3(), tip: new Vector3(), pinky: new Vector3(), middle: new Vector3(), thumb: new Vector3() }
const JOINTS = { wrist: 'wrist', index: 'index-finger-phalanx-proximal', mid: 'index-finger-phalanx-intermediate', tip: 'index-finger-tip', pinky: 'pinky-finger-phalanx-proximal', middle: 'middle-finger-phalanx-proximal', thumb: 'thumb-tip' }

export function Teleport({ theatre }) {
  const gl = useThree((s) => s.gl)
  const camera = useThree((s) => s.camera)
  const origin = useXR((s) => s.origin)
  const originSpace = useXR((s) => s.originReferenceSpace)
  const { peers, mp } = useMultiplayer()
  const tp = useMemo(() => createTeleport(theatre), [theatre])
  const out = useMemo(() => tp.result(), [tp])
  const dots = useRef(), ring = useRef()
  const run = useRef({ aim: null, wait: 0, ready: 0, pinched: false, trigger: false, from: new Vector3(), dir: new Vector3(), peers, past: Array.from({ length: PAST }, () => ({ t: -1, valid: false, yaw: 0, spot: new Vector3() })), n: 0 }).current
  run.peers = peers
  const opts = useRef({ noclip: false, people: [] }).current
  if (import.meta.env?.DEV) window.__teleport = { run, out, tp } // for the console and tests, like __menu

  const { dotGeometry, ringGeometry, material } = useMemo(() => {
    // the ring lies on the ground; its arrow points where you will look (−z at yaw 0, like a camera)
    const arrow = new ConeGeometry(0.13, 0.3, 3).rotateX(-Math.PI / 2).scale(1, 0.12, 1).translate(0, 0, -0.52)
    const ringGeometry = mergeGeometries([new TorusGeometry(0.3, 0.02, 8, 40).rotateX(-Math.PI / 2), arrow])
    // seen through what stands between (a column, your own menu): you must never lose sight of where you will be
    const material = new MeshBasicMaterial({ color: MAY, transparent: true, opacity: 0.95, depthTest: false, depthWrite: false, toneMapped: false, fog: false })
    return { dotGeometry: new SphereGeometry(1, 8, 6), ringGeometry, material }
  }, [])
  useEffect(() => () => { dotGeometry.dispose(); ringGeometry.dispose(); material.dispose(); aim.on = aim.stick = false }, [dotGeometry, ringGeometry, material])

  /** The heads of everyone else, for "never on another person". */
  const others = () => {
    const now = performance.now(), list = opts.people
    let n = 0
    for (const p of run.peers) {
      const v = (list[n] ??= new Vector3())
      if (mp.peerOpacity(p.id, now) > 0 && mp.peerHead(p.id, v, _q, now)) n++
    }
    list.length = n
  }

  // ---- on a computer and a phone: a double-click or double-tap on the ground
  useEffect(() => {
    const el = gl.domElement
    let down = null, last = null
    const jump = (x, y) => {
      const r = el.getBoundingClientRect()
      _from.setFromMatrixPosition(camera.matrixWorld)
      _dir.set(((x - r.left) / r.width) * 2 - 1, -((y - r.top) / r.height) * 2 + 1, 0.5).unproject(camera).sub(_from).normalize()
      opts.noclip = useApp.getState().noclip
      others()
      theatre.physics.colliders.refresh()
      tp.ray(_from, _dir, player.feet, opts, out)
      if (out.valid) player.request = { at: out.spot.clone(), yaw: player.yaw, pitch: player.pitch }
      else if (out.why === 'far') say({ key: 'teleFar' })
    }
    const pd = (e) => { down = gl.xr.isPresenting || (e.pointerType === 'mouse' && e.button !== 0) ? null : { id: e.pointerId, x: e.clientX, y: e.clientY, t: e.timeStamp } }
    const pu = (e) => {
      if (!down || down.id !== e.pointerId) return
      const click = e.timeStamp - down.t < 300 && Math.hypot(e.clientX - down.x, e.clientY - down.y) < 8 // not a drag to look around
      down = null
      if (!click) { last = null; return }
      if (last && e.timeStamp - last.t < 400 && Math.hypot(e.clientX - last.x, e.clientY - last.y) < 30) { last = null; jump(e.clientX, e.clientY) }
      else last = { t: e.timeStamp, x: e.clientX, y: e.clientY }
    }
    el.addEventListener('pointerdown', pd); el.addEventListener('pointerup', pu)
    return () => { el.removeEventListener('pointerdown', pd); el.removeEventListener('pointerup', pu) }
  }, [gl, camera, theatre, tp, out]) // eslint-disable-line react-hooks/exhaustive-deps

  // ---- in the headset
  useFrame((state, delta, frame) => {
    const d = dots.current, r = ring.current
    const stop = () => { run.aim = null; aim.on = aim.stick = false; d.visible = false; if (r.visible) { r.visible = false; r.name = 'teleport ring'; r.position.set(0, 0, 0) } }
    const session = gl.xr.getSession()
    const space = originSpace ?? gl.xr.getReferenceSpace()
    if (!session || !frame || !space) { stop(); return }
    const { noclip, menuHand, xrInput } = useApp.getState()
    const point = menuHand === 'left' ? 'right' : 'left'
    let pointer = null, carrier = null
    for (const s of session.inputSources) { if (s.handedness === point) pointer = s; else if (s.handedness === menuHand) carrier = s }
    // what the person holds, for the line in the menu that says how to teleport
    const holds = (pointer ?? carrier) ? ((pointer ?? carrier).hand ? 'hands' : 'controllers') : xrInput
    if (holds !== xrInput) useApp.setState({ xrInput: holds })

    run.wait -= delta
    if (run.wait > 0 || player.request) { stop(); return }
    origin?.updateWorldMatrix(true, false) // the walking code has just moved it
    const world = (pose) => { if (!pose) return false; _m.fromArray(pose.transform.matrix); if (origin) _m.premultiply(origin.matrixWorld); return true }

    let go = false, source = null
    if (pointer?.hand) {
      // ---- a bare hand: palm up, index finger out; a pinch goes
      source = pointer
      let seen = true
      for (const k in JOINTS) seen = seen && world(frame.getJointPose?.(pointer.hand.get(JOINTS[k]), space)) && !!J[k].setFromMatrixPosition(_m)
      if (!seen) { stop(); return }
      _a.subVectors(J.index, J.wrist); _b.subVectors(J.pinky, J.wrist)
      const palm = (point === 'left' ? _c.crossVectors(_b, _a) : _c.crossVectors(_a, _b)).normalize().y // which way the palm looks, as in the menu
      const straight = J.tip.distanceTo(J.index) / (J.mid.distanceTo(J.index) + J.tip.distanceTo(J.mid) || 1)
      const gap = J.thumb.distanceTo(J.tip)
      const pinched = !!pointer.gamepad?.buttons[0]?.pressed || gap < (run.pinched ? HAND.apart : HAND.pinch)
      const free = !isBusy(point)
      run.palm = palm; run.straight = straight // (read by tests)
      // along the hand, lifted a little: a hand held out comfortably points at the ground a few steps away
      _dir.subVectors(J.middle, J.wrist).normalize()
      _a.copy(UP).addScaledVector(_dir, -_dir.y).normalize()
      _dir.multiplyScalar(Math.cos(HAND.tilt)).addScaledVector(_a, Math.sin(HAND.tilt)).normalize()
      if (!run.aim) {
        run.ready = palm > HAND.up && straight > HAND.straight && !pinched && free ? run.ready + delta : 0
        if (run.ready > HAND.hold) { run.aim = { mode: 'hand', turn: 0, t: 0 }; run.from.copy(J.index); run.dir.copy(_dir) }
      } else if (run.aim.mode !== 'hand' || palm < HAND.keep || !free) { run.aim = null; run.ready = 0 }
      else if (pinched && !run.pinched && run.aim.t > 0.15) go = true
      run.pinched = pinched
      if (run.aim) {
        // a hand trembles and a pinch tugs at it: the arc follows a little behind
        const k = 1 - Math.exp(-14 * delta)
        run.from.lerp(J.index, k); run.dir.lerp(_dir, k).normalize()
      }
    } else {
      const stick = pointer?.gamepad && !noclip ? pointer : null
      const trigger = noclip && carrier?.gamepad && !carrier.hand ? carrier : null
      if (run.aim && run.aim.mode !== (stick ? 'stick' : trigger ? 'trigger' : '')) run.aim = null
      if (stick) {
        // ---- the thumbstick of the pointing hand: forward throws, left and right turn the arrow, letting go goes
        source = stick
        const axes = stick.gamepad.axes
        const x = axes.length >= 4 ? axes[2] : axes[0] ?? 0, y = axes.length >= 4 ? axes[3] : axes[1] ?? 0
        const push = Math.hypot(x, y)
        if (!run.aim) { if (y < -0.6 && -y >= Math.abs(x)) run.aim = { mode: 'stick', turn: 0, t: 0 } }
        else if (push > 0.5) run.aim.turn = Math.atan2(-x, -y)
        else if (push < 0.25) go = true
      } else if (trigger) {
        // ---- through walls: the trigger of the hand with the menu
        source = trigger
        const pressed = !!trigger.gamepad.buttons[0]?.pressed
        if (!run.aim) { if (pressed && !run.trigger && !isBusy(menuHand)) run.aim = { mode: 'trigger', turn: 0, t: 0 } }
        else if (!pressed) go = true
        run.trigger = pressed
      }
      if (run.aim) {
        if (!world(frame.getPose(source.targetRaySpace, space))) { stop(); return }
        run.from.setFromMatrixPosition(_m)
        run.dir.set(0, 0, -1).transformDirection(_m)
      }
    }
    if (!run.aim) { stop(); return }

    // ---- the arc, the ring, and on letting go the move
    const a = run.aim
    if (a.t === 0) { theatre.physics.colliders.refresh(); for (const p of run.past) p.t = -1 } // what stands right now (the walking code does not ask while it goes through walls)
    a.t += delta
    opts.noclip = noclip
    others()
    tp.arc(run.from, run.dir, player.feet, opts, out)
    const dx = out.spot.x - run.from.x, dz = out.spot.z - run.from.z
    const thrown = Math.hypot(dx, dz) > 0.3 ? Math.atan2(-dx, -dz) : player.yaw // straight down at your feet: the way you look
    const yaw = thrown + a.turn
    aim.on = true; aim.stick = a.mode === 'stick'

    material.color.set(out.valid ? MAY : MAY_NOT)
    state.camera.getWorldPosition(_eye)
    const pts = out.points
    let n = 0, carry = (state.clock.elapsedTime * 0.8) % GAP // the dots run from the hand to the spot
    for (let i = 1; i < out.count && n < DOTS; i++) {
      _a.fromArray(pts, (i - 1) * 3); _b.fromArray(pts, i * 3)
      const length = _a.distanceTo(_b)
      let s = carry
      for (; s < length && n < DOTS; s += GAP) {
        _o.position.lerpVectors(_a, _b, s / length)
        _o.scale.setScalar(Math.max(0.011, _o.position.distanceTo(_eye) * 0.0042))
        _o.updateMatrix()
        d.setMatrixAt(n++, _o.matrix)
      }
      carry = s - length
    }
    d.count = n
    d.instanceMatrix.needsUpdate = true
    d.visible = n > 0
    r.position.copy(out.spot)
    r.position.y += 0.03
    r.rotation.y = yaw
    r.name = `teleport ring: ${out.valid ? 'may land' : 'may not land'}`
    r.visible = true

    // (what the arc showed in the last moments, for the pinch)
    const now = run.past[run.n++ % PAST]
    now.t = a.t; now.valid = out.valid; now.yaw = yaw; now.spot.copy(out.spot)
    if (go) {
      let chosen = now
      if (a.mode === 'hand') for (const p of run.past) if (p.t >= 0 && p.t <= a.t - BEFORE && (chosen === now || p.t > chosen.t)) chosen = p
      if (chosen.valid) {
        player.request = { at: chosen.spot.clone(), yaw: chosen.yaw, pitch: 0 }
        run.wait = AGAIN
      }
      try { source?.gamepad?.hapticActuators?.[0]?.pulse(chosen.valid ? 0.5 : 0.15, chosen.valid ? 25 : 60) } catch {}
      stop()
    }
  }, -1.5) // after the walking code has placed the person (−2), before the theatre reads the head (−1)

  return (
    <>
      <instancedMesh ref={dots} args={[dotGeometry, material, DOTS]} name="teleport arc" frustumCulled={false} renderOrder={8} visible={false} />
      <mesh ref={ring} geometry={ringGeometry} material={material} name="teleport ring" frustumCulled={false} renderOrder={8} visible={false} />
    </>
  )
}
