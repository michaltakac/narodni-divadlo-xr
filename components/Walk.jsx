// Walking through the theatre at real size, on a computer and in a headset, with real walls and floors.
//
//   computer   W A S D walk, ← → turn, ↑ ↓ look up and down, Shift faster, drag with the mouse to look around
//   touch      a thumb stick in the lower left corner walks, dragging anywhere else looks around (components/Touch.jsx)
//   headset    left thumbstick walks where you look, right thumbstick turns in steps and, pushed forward, throws
//              the teleport arc (components/Teleport.jsx). With the menu on the right hand the two sticks swap.
//              "Teleport only" (the menu's Places tab) switches the walking stick off.
//   "Walk through walls" (this person only): nothing stops you, and E / Q (right thumbstick up / down) move you
//   up and down
//   Being taken somewhere (a viewpoint, back to the street, a teleport) is `player.request`: at once on a screen,
//   behind a short fade in the headset, and said to the others (presence field `tp`) so they see the figure go
//   out and come in instead of sliding across (components/People.jsx).
//
// The body is a capsule moved by Rapier's character controller against colliders made from the model
// (lib/theatre/colliders.js, set up in lib/theatre/load.js). Where the feet are goes to <XROrigin> in a headset and to the camera on a screen,
// so the multi-user kit sends the head from where this person really stands.
import { useEffect, useRef } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import { XROrigin } from '@react-three/xr'
import { Euler, Quaternion, Vector3 } from 'three'
import { useMultiplayer } from './Multiplayer'
import { EYE, aim, hooks, noclipIsAutomatic, player, say, setNoclip, touch, useApp } from '../lib/theatre/app'
import { BODY } from '../lib/theatre/load'
import { SPAWNS, pickSpawn } from '../lib/spawn'

const CENTRE = BODY.half + BODY.radius // the capsule's centre above the feet
const WALK = 2.2, RUN = 6, FLY = 5, FLY_FAST = 16 // metres per second
const TURN = 1.9, LOOK = 1.2 // radians per second with the arrow keys
const SNAP = Math.PI / 6 // a step of the right thumbstick
const GRAVITY = 22
const FADE_OUT = 0.12, FADE_IN = 0.22 // seconds, around a move in the headset
export const FOV = 65

const DOWN = { x: 0, y: -1, z: 0 }
const UPRIGHT = { x: 0, y: 0, z: 0, w: 1 }
const stuck = new Set()
const _e = new Euler(0, 0, 0, 'YXZ')
const _q = new Quaternion()
const _head = new Vector3()
const _off = new Vector3()
const _centre = new Vector3()
const _dir = new Vector3()

export function Walk({ theatre }) {
  const gl = useThree((s) => s.gl)
  const camera = useThree((s) => s.camera)
  const { peers, synced, mp } = useMultiplayer()
  const origin = useRef()
  const fade = useRef()
  const keys = useRef(new Set()).current
  const run = useRef({ vy: 0, presenting: false, align: false, snapArmed: true, fade: null, seenT: -1, seenVersion: -1, moves: 0 }).current

  const physics = theatre.physics
  const { world, rapier } = physics

  // ---- what is solid for me right now, and the ground under a point
  const solidFor = (inCut) => (c) => c.handle !== physics.body.handle && physics.colliders.allows(c.handle, inCut)
  const groundBelow = (from, reach) => {
    const hit = world.castRay(new rapier.Ray(from, DOWN), reach, true, undefined, undefined, undefined, undefined, solidFor(theatre.cutAway(from)))
    return hit ? hit.timeOfImpact : null
  }
  // the floor a standing person's eyes at `eye` belong to: his cameras also look over seat backs and parapets,
  // so what lies closer than a body's length under the eyes is furniture, not the floor
  const floorBelow = (eye) => {
    let y = eye.y
    for (let k = 0; k < 6; k++) {
      const d = groundBelow({ x: eye.x, y, z: eye.z }, 2.7 - (eye.y - y))
      if (d == null) return null
      y -= d
      if (eye.y - y >= 1.2) return eye.y - y
      y -= 0.01
    }
    return null
  }
  const refresh = () => {
    if (run.seenT === theatre.R.T && run.seenVersion === theatre.version && !theatre.fire.active) return
    run.seenT = theatre.R.T; run.seenVersion = theatre.version
    physics.colliders.refresh()
  }
  const standAt = (x, z, y = 6) => {
    refresh()
    const d = groundBelow({ x, y, z }, 60)
    player.feet.set(x, d == null ? 0 : y - d, z)
    run.vy = 0
  }

  // ---- a free place on the street, once the room has told us who is here (as in the template)
  const decided = useRef(false)
  useEffect(() => {
    if (decided.current || !(synced || mp.offline)) return
    const t = setTimeout(() => {
      decided.current = true
      const slot = pickSpawn(peers)
      mp.setFields({ spawn: slot })
      player.slot = slot
      if (!player.moved) { const s = SPAWNS[slot]; standAt(s.position[0], s.position[2]); player.yaw = s.yaw; player.pitch = s.pitch }
    }, 400)
    return () => clearTimeout(t)
  }, [synced, peers, mp]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { const s = SPAWNS[player.slot]; if (!player.moved) standAt(s.position[0], s.position[2]) }, [physics]) // eslint-disable-line react-hooks/exhaustive-deps

  // ---- keyboard and mouse
  useEffect(() => {
    const typing = (e) => { const t = e.target; return t instanceof HTMLElement && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName)) }
    const down = (e) => {
      if (e.metaKey || e.ctrlKey || e.altKey || typing(e)) return
      if (e.code === 'KeyP' && !e.repeat) useApp.setState((s) => ({ perf: !s.perf }))
      keys.add(e.code)
      if (e.code.startsWith('Arrow')) e.preventDefault()
    }
    const up = (e) => keys.delete(e.code)
    const clear = () => keys.clear()
    const el = gl.domElement
    let drag = null
    const pd = (e) => { if (e.button !== 0 || gl.xr.isPresenting) return; drag = { id: e.pointerId, x: e.clientX, y: e.clientY }; el.setPointerCapture?.(e.pointerId); document.activeElement?.blur?.() }
    const pm = (e) => {
      if (!drag || e.pointerId !== drag.id) return
      player.yaw -= (e.clientX - drag.x) * 0.0032
      player.pitch = Math.max(-1.5, Math.min(1.5, player.pitch - (e.clientY - drag.y) * 0.0032))
      drag.x = e.clientX; drag.y = e.clientY
    }
    const pu = (e) => { if (drag && e.pointerId === drag.id) drag = null }
    window.addEventListener('keydown', down); window.addEventListener('keyup', up); window.addEventListener('blur', clear)
    el.addEventListener('pointerdown', pd); el.addEventListener('pointermove', pm); el.addEventListener('pointerup', pu); el.addEventListener('pointercancel', pu)
    return () => {
      window.removeEventListener('keydown', down); window.removeEventListener('keyup', up); window.removeEventListener('blur', clear)
      el.removeEventListener('pointerdown', pd); el.removeEventListener('pointermove', pm); el.removeEventListener('pointerup', pu); el.removeEventListener('pointercancel', pu)
    }
  }, [gl, keys])

  // ---- being taken somewhere: a viewpoint, or back to the street
  const arrive = (req, headHeight) => {
    refresh()
    mp.setFields({ tp: ++run.moves }) // to the others: this is a jump, not a walk
    if (req.at) {
      player.feet.copy(req.at)
    } else if (req.feet) {
      standAt(req.feet.x, req.feet.z)
      if (req.noclip === false) setNoclip(false)
    } else {
      // is there something to stand on under the place his camera looks from?
      const drop = req.air ? null : floorBelow(req.eye)
      if (drop != null) {
        player.feet.set(req.eye.x, req.eye.y - drop, req.eye.z)
        if (noclipIsAutomatic()) setNoclip(false)
      } else {
        // nothing to stand on (above the roofs, over the river, a floor that is not built yet): float there, and say so
        player.feet.set(req.eye.x, req.eye.y - headHeight, req.eye.z)
        if (!useApp.getState().noclip) setNoclip(true, true)
        say({ key: 'airNotice' })
      }
    }
    player.yaw = req.yaw
    player.pitch = req.pitch ?? 0
    player.moved = true
    run.vy = 0
  }

  useFrame((state, delta) => {
    const dt = Math.min(delta, 0.05)
    const presenting = gl.xr.isPresenting
    const o = origin.current
    const { noclip, menuHand, teleportOnly } = useApp.getState()
    const xrCamera = gl.xr.getCamera()

    // entering or leaving the headset: keep standing where we stand, looking where we looked
    if (presenting !== run.presenting) {
      run.presenting = presenting
      run.align = presenting
      useApp.setState({ xr: presenting })
      if (!presenting) {
        camera.fov = FOV
        camera.aspect = state.size.width / state.size.height
        camera.updateProjectionMatrix()
        player.pitch = 0
      }
    }
    // the head inside the play space (origin space): where it is and which way it faces
    let headYaw = 0, headHeight = EYE
    if (presenting) {
      _head.copy(xrCamera.position)
      headYaw = _e.setFromQuaternion(xrCamera.quaternion).y
      headHeight = Math.max(0.4, _head.y)
      if (run.align) { o.rotation.y = player.yaw - headYaw; placeOrigin(o); run.align = false }
    }

    // a pending move: at once on a screen, behind a short fade in the headset (never a flight)
    if (player.request && !run.fade) {
      if (presenting) run.fade = { t: 0, req: player.request, done: false }
      else arrive(player.request, EYE)
      player.request = null
    }
    if (run.fade) {
      const f = run.fade
      f.t += delta
      if (!f.done && f.t >= FADE_OUT) { arrive(f.req, headHeight); o.rotation.y = player.yaw - headYaw; placeOrigin(o); f.done = true }
      const k = f.done ? 1 - (f.t - FADE_OUT) / FADE_IN : f.t / FADE_OUT
      fade.current.material.opacity = Math.max(0, Math.min(1, k))
      fade.current.visible = k > 0
      if (f.done && k <= 0) { run.fade = null; fade.current.position.set(0, 0, 0) }
    } else if (fade.current.visible) fade.current.visible = false

    // ---- what the person asks for
    let ahead = 0, side = 0, rise = 0, fast = false
    if (presenting) {
      for (const source of gl.xr.getSession()?.inputSources ?? []) {
        const axes = source.gamepad?.axes
        if (!axes || axes.length < 2) continue
        const x = axes.length >= 4 ? axes[2] : axes[0], y = axes.length >= 4 ? axes[3] : axes[1]
        if (source.hand) continue
        // the hand with the menu walks; the other one turns, teleports and (through walls) goes up and down
        if (source.handedness === menuHand) {
          if (!teleportOnly && Math.hypot(x, y) > 0.15) { side += x; ahead -= y }
        } else if (source.handedness === 'left' || source.handedness === 'right') {
          // forward is the teleport arc, and while it is out left and right turn its arrow, not the person
          const throwing = aim.stick || (!noclip && y < -0.5 && -y >= Math.abs(x))
          if (throwing) run.snapArmed = false
          else if (Math.abs(x) > 0.6 && run.snapArmed) { o.rotation.y -= Math.sign(x) * SNAP; placeOrigin(o); run.snapArmed = false } // turns about the head
          else if (Math.abs(x) < 0.3) run.snapArmed = true
          if (noclip && Math.abs(y) > 0.3 && Math.abs(y) > Math.abs(x)) rise -= y
        }
      }
      player.yaw = o.rotation.y + headYaw
    } else {
      if (keys.has('KeyW')) ahead += 1
      if (keys.has('KeyS')) ahead -= 1
      if (keys.has('KeyD')) side += 1
      if (keys.has('KeyA')) side -= 1
      if (keys.has('ArrowLeft')) player.yaw += TURN * dt
      if (keys.has('ArrowRight')) player.yaw -= TURN * dt
      if (keys.has('ArrowUp')) player.pitch = Math.min(1.5, player.pitch + LOOK * dt)
      if (keys.has('ArrowDown')) player.pitch = Math.max(-1.5, player.pitch - LOOK * dt)
      if (noclip) { if (keys.has('KeyE')) rise += 1; if (keys.has('KeyQ')) rise -= 1 }
      fast = keys.has('ShiftLeft') || keys.has('ShiftRight')
      // a touch screen: the thumb stick, and the two buttons while walking through walls
      ahead += touch.ahead; side += touch.side
      if (noclip) rise += touch.rise
    }
    const len = Math.hypot(ahead, side)
    if (len > 1) { ahead /= len; side /= len }
    if (len > 0 || rise !== 0) { if (!player.moved) player.moved = true; hooks.moved?.(); if (useApp.getState().place) useApp.setState({ place: null }) }
    const speed = noclip ? (fast ? FLY_FAST : FLY) : (fast ? RUN : WALK)
    const sin = Math.sin(player.yaw), cos = Math.cos(player.yaw)
    // forward is (−sin, −cos), right is (cos, −sin)
    let dx = (-sin * ahead + cos * side) * speed * dt
    let dz = (-cos * ahead - sin * side) * speed * dt

    // in a headset the body follows the head: a real step is a step in the theatre (and a wall stops it too)
    if (presenting) {
      _off.set(_head.x, 0, _head.z).applyAxisAngle(UP, o.rotation.y)
      dx += o.position.x + _off.x - player.feet.x
      dz += o.position.z + _off.z - player.feet.z
    }

    const feet = player.feet
    if (noclip) {
      feet.x += dx; feet.z += dz; feet.y += rise * speed * dt
      run.vy = 0
    } else {
      refresh()
      _centre.set(feet.x, feet.y + CENTRE, feet.z)
      physics.body.setTranslation(_centre)
      run.vy = Math.max(-40, run.vy - GRAVITY * dt)
      // whatever the body already overlaps (it was put down among the seats, a wall has just been built round it)
      // does not hold it: it walks out, and the thing is solid again once it is clear of it
      const solid = solidFor(theatre.cutAway(_centre))
      stuck.clear()
      world.intersectionsWithShape(_centre, UPRIGHT, physics.probe, (c) => { stuck.add(c.handle); return true }, undefined, undefined, physics.body, undefined, solid)
      physics.controller.computeColliderMovement(physics.body, { x: dx, y: run.vy * dt, z: dz }, undefined, undefined, stuck.size ? (c) => !stuck.has(c.handle) && solid(c) : solid)
      const m = physics.controller.computedMovement()
      feet.x += m.x; feet.y += m.y; feet.z += m.z
      if (physics.controller.computedGrounded()) run.vy = 0
      if (feet.y < -60) { const s = SPAWNS[player.slot]; standAt(s.position[0], s.position[2]) } // fell out of the world
    }

    // ---- the result: the play space in a headset, the camera on a screen
    if (presenting) placeOrigin(o)
    else {
      o.position.copy(feet)
      o.rotation.y = player.yaw
      camera.position.set(feet.x, feet.y + EYE, feet.z)
      camera.rotation.set(player.pitch, player.yaw, 0, 'YXZ')
      camera.updateMatrixWorld()
    }
    // the fade is a small shell round the head
    if (fade.current.visible) {
      state.camera.matrixWorld.decompose(fade.current.position, _q, _dir)
    }
  }, -2)

  return (
    <>
      <XROrigin ref={origin} name="you" />
      <mesh ref={fade} name="fade" visible={false} renderOrder={10000} frustumCulled={false}>
        <sphereGeometry args={[0.3, 16, 12]} />
        <meshBasicMaterial color="#000" side={1} transparent opacity={0} depthTest={false} depthWrite={false} fog={false} toneMapped={false} />
      </mesh>
    </>
  )
}

const UP = new Vector3(0, 1, 0)
/** Put the play space so that the head (at _head inside it) is above the feet. */
function placeOrigin(o) {
  _off.set(_head.x, 0, _head.z).applyAxisAngle(UP, o.rotation.y)
  o.position.set(player.feet.x - _off.x, player.feet.y, player.feet.z - _off.z)
}
