// The people in the theatre: everyone as a whole figure in the clothes of 1868 to 1883 (lib/people/figure.js),
// in place of the multi-user kit's head-and-hands avatars. Nothing new is sent for the bodies: a figure is posed
// here from the head and hand poses the kit already shares, and what a person wears travels as one number in
// their presence (`w`, lib/people/wardrobe.js) next to their name.
//
//   others   figure + the kit's name plate above the head; they fade out when they fall silent. Above the plate
//            stands what they have just written (a speech bubble, six seconds) or three dots while they write.
//            Someone who is taken somewhere (a teleport, a viewpoint: their presence field `tp` counts those) goes
//            out where they stood and comes in where they land, instead of sliding across in between
//   you      your own figure without its head, so looking down you see your body, arms and hands; M (on a
//            computer) steps the camera out in front of you for a moment
//   mirrors  your own (Wardrobe › Mirror: only you see it) and the one on the wall of the foyer
import { useEffect, useMemo, useRef } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import { CanvasTexture, Euler, LinearFilter, Quaternion, SRGBColorSpace, Vector3 } from 'three'
import { useMp, useMultiplayer } from './Multiplayer'
import { Figure } from '../lib/people/figure'
import { createMirror, mirrorPass } from '../lib/people/mirror'
import { OUTFITS, lookOf, packLook, useWardrobe } from '../lib/people/wardrobe'
import { LIGHT, player, useApp } from '../lib/theatre/app'
import { H, V, FP, FACADE, bToWorld, facadeToB } from '../lib/nd/config.js'
import { toBuilding } from '../lib/theatre/chunks'
import { BUBBLE_S, saidBy, useChat } from '../lib/chat'
import { bubbleTexture, dotsTexture } from '../lib/people/bubble'

const DOWN = { x: 0, y: -1, z: 0 }
const _cam = new Vector3(), _q = new Quaternion(), _f = new Vector3(), _r = new Vector3(), _pivot = new Vector3(), _dir = new Vector3(), _look = new Quaternion()
const _e = new Euler(0, 0, 0, 'YXZ')
const pose = () => ({ position: new Vector3(), quaternion: new Quaternion() })

/**
 * What I wear, to everyone: one number in my presence, sent with the next pose and to whoever joins later.
 * It stands directly inside <Multiplayer> (App.jsx), so it is said from the first moment, before the theatre is built.
 */
export function Wearing() {
  const mp = useMp()
  const outfit = useWardrobe((s) => s.outfit), cloth = useWardrobe((s) => s.cloth), skin = useWardrobe((s) => s.skin)
  useEffect(() => { mp.setFields({ w: packLook({ outfit, cloth, skin }) }) }, [mp, outfit, cloth, skin])
  return null
}

export function People({ theatre }) {
  const { peers } = useMultiplayer()
  return (
    <>
      <Self theatre={theatre} />
      {peers.map((p) => <Person key={p.id} peer={p} theatre={theatre} />)}
      <OwnMirror />
      <FoyerMirror theatre={theatre} />
    </>
  )
}

/** The height of the ground under a point, when there is ground within a body's length. */
function groundUnder(theatre, p) {
  const { world, rapier, colliders, body } = theatre.physics
  const inCut = theatre.cutAway(p)
  const hit = world.castRay(new rapier.Ray(p, DOWN), 2.4, true, undefined, undefined, undefined, undefined, (c) => c.handle !== body.handle && colliders.allows(c.handle, inCut))
  return hit ? p.y - hit.timeOfImpact : null
}

// How much of the lamps' light reaches someone: all of it in the house and up to LAMP_NEAR metres from its walls
// (the candelabra, the globes in the arches, the floodlit stone), a quarter of it from LAMP_FAR metres on.
const LAMP_NEAR = 14, LAMP_FAR = 60, _bp = new Vector3()
function lampLight(p) {
  const { x, z } = toBuilding(p, _bp), poly = FP.all
  let best = Infinity, inside = false
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [ax, az] = poly[i], [bx, bz] = poly[j]
    if ((az > z) !== (bz > z) && x < ((bx - ax) * (z - az)) / (bz - az) + ax) inside = !inside
    const ex = bx - ax, ez = bz - az
    const t = Math.min(1, Math.max(0, ((x - ax) * ex + (z - az) * ez) / (ex * ex + ez * ez || 1)))
    best = Math.min(best, Math.hypot(x - ax - ex * t, z - az - ez * t))
  }
  if (inside) return 1
  const k = Math.min(1, Math.max(0, (best - LAMP_NEAR) / (LAMP_FAR - LAMP_NEAR)))
  return 1 - 0.75 * k * k * (3 - 2 * k)
}

// a pose as the kit packs it (millimetres, thousandths) into { position, quaternion }
function unpack(arr, into) {
  into.position.set(arr[0] / 1000, arr[1] / 1000, arr[2] / 1000)
  into.quaternion.set(arr[3], arr[4], arr[5], arr[6]).normalize()
  return into
}

// ------------------------------------------------------------------------------------------------ you
const VIEW = { out: 0.7, hold: 1.8, back: 0.6, distance: 2.6 } // the M view: seconds out, held, back; metres in front

function Self({ theatre }) {
  const mp = useMp()
  const gl = useThree((s) => s.gl)
  const outfit = useWardrobe((s) => s.outfit), cloth = useWardrobe((s) => s.cloth), skin = useWardrobe((s) => s.skin)
  const figure = useMemo(() => new Figure(), [])
  useMemo(() => figure.setLook({ outfit, cloth, skin }), [figure, outfit, cloth, skin])
  const tmp = useRef({ head: pose(), left: pose(), right: pose() }).current
  const run = useRef({ view: -1, shown: false }).current
  const showMe = useApp((s) => s.showMe)

  // my head and, with tracked hands, my hands are drawn for the mirror only
  useEffect(() => {
    const before = () => figure.reveal(true), after = () => figure.reveal(false)
    mirrorPass.before.add(before); mirrorPass.after.add(after)
    return () => { mirrorPass.before.delete(before); mirrorPass.after.delete(after); figure.dispose() }
  }, [figure])

  // M, or "Show me" in the wardrobe: the camera steps out in front of me and comes back
  useEffect(() => { if (showMe && run.view < 0 && !gl.xr.isPresenting) run.view = 0 }, [showMe]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    const down = (e) => {
      const t = e.target
      if (e.code !== 'KeyM' || e.repeat || e.metaKey || e.ctrlKey || e.altKey) return
      if (t instanceof HTMLElement && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName))) return
      useApp.setState((s) => ({ showMe: s.showMe + 1 }))
    }
    window.addEventListener('keydown', down)
    return () => window.removeEventListener('keydown', down)
  }, [])

  useFrame((state, delta) => {
    const L = mp.local // what the kit has just read of me: the same poses everyone else gets
    const presenting = gl.xr.isPresenting
    const head = unpack(L.p, tmp.head)
    const left = L.l ? unpack(L.l, tmp.left) : null, right = L.r ? unpack(L.r, tmp.right) : null
    if (left) left.held = L.l[8] === 1 // a controller: its grip is in the palm (a tracked hand gives the wrist)
    if (right) right.held = L.r[8] === 1
    figure.mesh.castShadow = !(presenting || LIGHT) // the lighter drawing keeps one baked shadow map: nobody may be baked into it
    figure.setLight(theatre.state.night, lampLight(head.position))
    figure.update(delta, head, left, right, {
      xr: presenting, floor: player.feet.y, hideHead: !run.shown,
      // tracked hands are drawn finger by finger (components/Hands.jsx); the figure's own would lie over them
      hideLeft: presenting && !!L.l && L.l[8] === 0, hideRight: presenting && !!L.r && L.r[8] === 0,
    })

    if (run.view < 0 || presenting) { run.view = -1; run.shown = false; return }
    run.view += delta
    const t = run.view, total = VIEW.out + VIEW.hold + VIEW.back
    let u = t < VIEW.out ? t / VIEW.out : t < VIEW.out + VIEW.hold ? 1 : 1 - (t - VIEW.out - VIEW.hold) / VIEW.back
    if (t >= total) { run.view = -1; u = 0 }
    u = u * u * (3 - 2 * u)
    // round my right side to the front, looking at me all the way; never through a wall
    const yaw = _e.setFromQuaternion(head.quaternion).y
    _f.set(-Math.sin(yaw), 0, -Math.cos(yaw)); _r.set(Math.cos(yaw), 0, -Math.sin(yaw))
    _pivot.copy(head.position); _pivot.y -= 0.5 * u
    const a = Math.PI * u
    _dir.copy(_f).multiplyScalar(-Math.cos(a)).addScaledVector(_r, Math.sin(a))
    _dir.y = 0.08 * u
    _dir.normalize()
    let radius = VIEW.distance * u
    const { world, rapier, body } = theatre.physics
    const hit = world.castRay(new rapier.Ray(_pivot, _dir), radius + 0.3, true, undefined, undefined, undefined, undefined, (c) => c.handle !== body.handle)
    if (hit) radius = Math.max(0, Math.min(radius, hit.timeOfImpact - 0.3))
    const camera = state.camera
    camera.position.copy(_pivot).addScaledVector(_dir, radius)
    _look.setFromRotationMatrix(camera.matrix.lookAt(camera.position, _pivot, camera.up))
    camera.quaternion.copy(head.quaternion).slerp(_look, Math.min(1, radius / 0.35))
    camera.updateMatrixWorld()
    run.shown = radius > 0.5
  }, 0.5) // after the kit has read the head (0), before the picture is drawn (1)

  return <primitive object={figure.mesh} name="your figure" />
}

// ------------------------------------------------------------------------------------------------ the others
const FADE = 0.6 // seconds a speech bubble takes to go
// someone who jumps: seconds to go out where they stood, to stay away (the kit still blends the two places), to come in
const JUMP = { out: 0.15, away: 0.12, in: 0.25 }
// Name plates and bubbles are read, they do not shine: in the computer's glow pass (night, X-ray, indoors) they are
// drawn black, so no halo is laid over their letters and lamps behind them do not glow through.
// A bubble is a wide flat sign above someone who may stand right beside a wall, and that wall would cut it off. So it
// is tested against the scene as if it hung at a third of its distance: what stands beside or behind the speaker
// does not cut into it, a wall near the viewer and the viewer's own hands still cover it. Only the depth is moved,
// the picture stays where it is for both eyes.
const pullDepth = (shader) => {
  shader.vertexShader = shader.vertexShader.replace('#include <project_vertex>', '#include <project_vertex>\n  vec4 nearer = projectionMatrix * vec4(mvPosition.xyz * 0.35, 1.0);\n  gl_Position.z = nearer.z / nearer.w * gl_Position.w;')
}
const noGlow = (mesh) => { if (mesh) mesh.onBeforeRender = () => mesh.material.color.setScalar(mirrorPass.glow ? 0 : 1) }
function Person({ peer, theatre }) {
  const mp = useMp()
  const { id, name, color, handle, kind } = peer
  const figure = useMemo(() => new Figure(), [])
  useEffect(() => () => figure.dispose(), [figure])
  const look = useMemo(() => lookOf(peer.fields?.w, id), [peer.fields?.w, id])
  useMemo(() => figure.setLook(look), [figure, look])
  const plateTex = useMemo(() => namePlate(name, handle, color), [name, handle, color])
  useEffect(() => () => plateTex.texture.dispose(), [plateTex])
  const plate = useRef()
  const tmp = useRef({ head: pose(), left: pose(), right: pose() }).current
  const run = useRef({ opacity: -1, floor: null, asked: 0, said: null, bubble: null, tp: peer.fields?.tp ?? 0, jump: -1 }).current
  // the chat: their last message as a bubble, three dots while they write; neither for someone I have muted
  const muted = useChat((s) => !!s.muted[id])
  const writing = !!peer.fields?.ty
  const bubble = useRef(), dots = useRef()
  const dotsTex = useMemo(() => dotsTexture(), [])
  useEffect(() => () => run.bubble?.texture.dispose(), [run])

  useFrame((state, delta) => {
    const now = performance.now()
    // a jump was said (it comes with the pose that made it): out at the old place, in at the new one
    const tp = peer.fields?.tp ?? 0
    if (tp !== run.tp) { run.tp = tp; if (run.jump < 0) run.jump = 0 }
    let shown = 1, held = false
    if (run.jump >= 0) {
      const t = (run.jump += delta)
      if (t < JUMP.out) { shown = 1 - t / JUMP.out; held = true }
      else if (t < JUMP.out + JUMP.away) { shown = 0; figure.fresh = true }
      else { shown = Math.min(1, (t - JUMP.out - JUMP.away) / JUMP.in); if (shown >= 1) run.jump = -1 }
    }
    const opacity = mp.peerOpacity(id, now) * shown
    const here = opacity > 0 && mp.peerHead(id, tmp.head.position, tmp.head.quaternion, now)
    figure.mesh.visible = plate.current.visible = here
    if (!here) { figure.fresh = true; bubble.current.visible = dots.current.visible = false; return }
    if (held) { // going out: the figure and its plate stay where they stood
      if (opacity !== run.opacity) { run.opacity = opacity; figure.setOpacity(opacity); plate.current.material.opacity = opacity }
      bubble.current.material.opacity = Math.min(bubble.current.material.opacity, opacity)
      return
    }
    const left = mp.peerHand(id, 'left', tmp.left.position, tmp.left.quaternion, now) ? tmp.left : null
    const right = mp.peerHand(id, 'right', tmp.right.position, tmp.right.quaternion, now) ? tmp.right : null
    if (left) left.held = mp.peerHandInfo(id, 'left')?.[1] === 1
    if (right) right.held = mp.peerHandInfo(id, 'right')?.[1] === 1
    const xr = kind === 'xr'
    // someone in a headset has their own height: the ground under them says how tall (asked a few times a second)
    if (xr && now - run.asked > 200) { run.asked = now; run.floor = groundUnder(theatre, tmp.head.position) }
    figure.mesh.castShadow = !(state.gl.xr.isPresenting || LIGHT)
    figure.update(delta, tmp.head, left, right, { xr, floor: xr ? run.floor : null })
    figure.setLight(theatre.state.night, lampLight(tmp.head.position))
    if (opacity !== run.opacity) { run.opacity = opacity; figure.setOpacity(opacity); plate.current.material.opacity = opacity }
    // the name plate floats above the hat, faces the viewer, and grows with distance so it stays readable
    const p = plate.current
    p.position.copy(figure.top)
    p.position.y += 0.36 * figure.scale
    state.camera.matrixWorld.decompose(_cam, _q, _dir)
    p.quaternion.copy(_q)
    const grow = Math.max(1, _cam.distanceTo(p.position) / 1.6)
    p.scale.setScalar(grow)

    // the bubble stands on the plate, turned to the viewer, and grows with distance like the plate: its capital
    // letters stay 1.5 % of the distance tall, so it reads from ten metres (and further) as it does from two
    const b = bubble.current, d = dots.current
    const said = muted ? null : saidBy(id)
    const age = said ? (now - said.at) / 1000 : Infinity
    const speaking = age < BUBBLE_S + FADE
    if (speaking && run.said !== said.id) {
      run.said = said.id
      run.bubble?.texture.dispose()
      run.bubble = bubbleTexture(said.text)
      b.material.map = run.bubble.texture
      b.material.needsUpdate = true
    }
    b.visible = speaking
    d.visible = !speaking && writing && !muted
    const shownOne = speaking ? b : d.visible ? d : null
    if (shownOne) {
      const size = speaking ? run.bubble : dotsTex
      const k = Math.min(grow, 20)
      shownOne.scale.set(size.width * k, size.height * k, 1)
      shownOne.position.copy(p.position)
      shownOne.position.y += (0.0375 + 0.012) * grow + size.height * k / 2
      shownOne.quaternion.copy(_q)
      shownOne.material.opacity = opacity * (speaking ? Math.min(1, age / 0.12, (BUBBLE_S + FADE - age) / FADE) : 1)
      if (!speaking) dotsTex.texture.offset.x = (Math.floor(now / 350) % 3) / 3
    }
  }, 0.5)

  return (
    <>
      <primitive object={figure.mesh} name={`figure ${name}: ${OUTFITS[look.outfit].en}`} userData={{ peer: id }} />
      <mesh ref={(m) => { plate.current = m; noGlow(m) }} name={`name plate ${name}`} renderOrder={3} visible={false}>
        <planeGeometry args={[plateTex.aspect * 0.075, 0.075]} />
        <meshBasicMaterial map={plateTex.texture} transparent depthWrite={false} toneMapped={false} />
      </mesh>
      <mesh ref={(m) => { bubble.current = m; noGlow(m) }} name={`speech bubble ${name}`} renderOrder={4} visible={false}>
        <planeGeometry args={[1, 1]} />
        <meshBasicMaterial transparent depthWrite={false} toneMapped={false} fog={false} onBeforeCompile={pullDepth} />
      </mesh>
      <mesh ref={(m) => { dots.current = m; noGlow(m) }} name={`typing ${name}`} renderOrder={4} visible={false}>
        <planeGeometry args={[1, 1]} />
        <meshBasicMaterial map={dotsTex.texture} transparent depthWrite={false} toneMapped={false} fog={false} onBeforeCompile={pullDepth} />
      </mesh>
    </>
  )
}

/** The kit's name plate (components/Avatar.jsx): a dark pill with the person's colour dot, their name and, smaller, their @handle. */
function namePlate(name, handle, color) {
  const HEIGHT = 96, pad = 28, dot = 22, gap = 14
  const c = document.createElement('canvas').getContext('2d')
  const font = (w, px) => `${w} ${px}px system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif`
  c.font = font(600, 44)
  const nameW = c.measureText(name).width
  c.font = font(500, 30)
  const handleW = handle ? c.measureText('@' + handle).width + gap : 0
  const W = Math.ceil(pad + dot + gap + nameW + handleW + pad)
  const canvas = c.canvas
  canvas.width = W
  canvas.height = HEIGHT
  const ctx = canvas.getContext('2d')
  ctx.fillStyle = 'rgba(20, 24, 34, 0.82)'
  ctx.beginPath()
  ctx.roundRect(0, 0, W, HEIGHT, HEIGHT / 2)
  ctx.fill()
  ctx.fillStyle = color
  ctx.beginPath()
  ctx.arc(pad + dot / 2, HEIGHT / 2, dot / 2, 0, Math.PI * 2)
  ctx.fill()
  ctx.textBaseline = 'middle'
  ctx.fillStyle = '#f6f7fb'
  ctx.font = font(600, 44)
  ctx.fillText(name, pad + dot + gap, HEIGHT / 2 + 2)
  if (handle) {
    ctx.fillStyle = '#aab3c5'
    ctx.font = font(500, 30)
    ctx.fillText('@' + handle, pad + dot + gap + nameW + gap, HEIGHT / 2 + 4)
  }
  const texture = new CanvasTexture(canvas)
  texture.colorSpace = SRGBColorSpace
  texture.minFilter = LinearFilter
  texture.magFilter = LinearFilter
  texture.anisotropy = 8
  return { texture, aspect: W / HEIGHT }
}

// ------------------------------------------------------------------------------------------------ mirrors
/** Wardrobe › Mirror: a tall glass a step and a half in front of you, facing you, until you close it. Yours alone. */
function OwnMirror() {
  const on = useApp((s) => s.mirror)
  const camera = useThree((s) => s.camera)
  const gl = useThree((s) => s.gl)
  const mirror = useMemo(() => {
    if (!on) return null
    const m = createMirror({ name: 'your mirror', pixels: gl.xr.isPresenting || LIGHT ? 400 : 560 })
    camera.getWorldDirection(_f)
    _f.y = 0
    if (_f.lengthSq() < 1e-6) _f.set(0, 0, -1)
    _f.normalize()
    m.group.position.copy(player.feet).addScaledVector(_f, 1.5)
    m.group.rotation.y = Math.atan2(-_f.x, -_f.z)
    m.setLive(true)
    return m
  }, [on]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => () => mirror?.dispose(), [mirror])
  return mirror ? <primitive object={mirror.group} /> : null
}

// The foyer (lib/nd/building/interior.js, in the façade frame): 21.5 × 6.4 m behind the loggia, floor at 6.6 m.
// Its long walls are all doors and pilasters with the founders' busts, so the glass hangs on the west end wall,
// between the door in that wall and the corner with the doors to the auditorium, two steps from where the
// "Foyer" viewpoint puts you.
const FOYER = (() => {
  const front = [...FP.loggia].sort((a, b) => a[1] - b[1]).slice(0, 2)
  const uc = ((front[0][0] + front[1][0]) / 2) * Math.cos(FACADE.angle) + ((front[0][1] + front[1][1]) / 2) * Math.sin(FACADE.angle)
  // 0.3 m off the west wall (the case reaches back to it), half way between that wall's door and the south wall
  const u = uc - 10.75 + 0.3, v = ((V.foyer[0] + V.foyer[1]) / 2 + 1 + V.foyer[1]) / 2
  const at = (du) => bToWorld(...((p) => [p[0], H.loggiaFloor + 0.03, p[1]])(facadeToB(u + du, v)))
  const position = at(0), ahead = at(1).sub(position)
  return { position, yaw: Math.atan2(ahead.x, ahead.z), built: 4.5, near: 10, far: 24 }
})()

function FoyerMirror({ theatre }) {
  const mirror = useMemo(() => {
    const m = createMirror({ name: 'foyer mirror', height: 1.9, lift: 0.22, back: 0.26, plate: 'Šatna · Wardrobe', lamps: true, gain: 1.08, pixels: LIGHT ? 400 : 520 })
    m.group.position.copy(FOYER.position)
    m.group.rotation.y = FOYER.yaw
    return m
  }, [])
  useEffect(() => () => mirror.dispose(), [mirror])
  useFrame(() => {
    // it is there once the foyer is built, and it only reflects for someone who stands in the foyer before it
    const g = mirror.group, eye = theatre.eye.position
    const dx = eye.x - g.position.x, dz = eye.z - g.position.z
    g.visible = theatre.state.T >= FOYER.built && dx * dx + dz * dz < FOYER.far * FOYER.far && !theatre.cutAway(g.position)
    const live = g.visible && Math.abs(eye.y - g.position.y - 1.5) < 2.5 && dx * dx + dz * dz < FOYER.near * FOYER.near && dx * Math.sin(FOYER.yaw) + dz * Math.cos(FOYER.yaw) > 0.05
    if (live !== mirror.live) mirror.setLive(live)
  })
  return <primitive object={mirror.group} />
}
