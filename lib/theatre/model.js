// The theatre as one object the app can mount: Lukáš Eršil's builders (lib/nd) run unchanged and fill a group,
// and this file does what his src/main.js did around them, for the WebGL renderer and without his orbit camera:
// sky, sun and night, the build clock, X-ray, the two section planes, the fire, the per-frame ticks.
// What the building shows is driven by `input` (the state everyone in the room shares, see director.js).
import * as THREE from 'three'
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js'
import { vec3, mix, smoothstep, positionLocal, normalize, setTime } from './tsl.js'
import { MeshBasicNodeMaterial } from './webgpu.js'
import { FRAME, bToWorld, AXIS, audToB, facadeToB } from '../nd/config.js'
import { Registry } from '../nd/core/registry.js'
import { createMaterials, U, layerMaterial, addSectionInsides } from '../nd/core/materials.js'
import { buildSite } from '../nd/site.js'
import { buildShell } from '../nd/building/shell.js'
import { buildFacade } from '../nd/building/facade.js'
import { buildScaffold } from '../nd/building/scaffold.js'
import { buildPartitions } from '../nd/building/partitions.js'
import { buildInterior } from '../nd/building/interior.js'
import { buildStage } from '../nd/building/stage.js'
import { buildSystems } from '../nd/building/systems.js'
import { Fire } from '../nd/fx/fire.js'
import { buildTrams } from '../nd/trams.js'
import { STAGES, LAYERS } from '../nd/data/content.js'

// auditorium-frame point [u, y, v] → building frame
const A = ([u, y, v]) => { const [bu, bv] = audToB(u, v); return [bu, y, bv] }
// façade-frame point (foyer) → building frame
const F = ([u, y, v]) => { const [bu, bv] = facadeToB(u, v); return [bu, y, bv] }

// His eight viewpoints (src/main.js), in the building frame [u, y, v]. Here they are places you are taken to:
// you stand at `pos` looking at `tgt`. `air` marks the ones with nothing to stand on.
export const VIEWPOINTS = [
  // his camera stood at v = −26, which is inside the house across the street: on foot it is the pavement in front of it
  { id: 'v-street', pos: [6, 1.8, -21], tgt: [0, 14, -3], cz: 'Národní třída', en: 'Národní Street' },
  { id: 'v-river', pos: [-112, 9, 18], tgt: [0, 16, 34], cz: 'Od řeky', en: 'From the river', air: true },
  { id: 'v-dome', pos: [-26, 46, 2], tgt: [0, 37, 26], cz: 'Kopule', en: 'Dome', air: true },
  { id: 'v-loggia', pos: [-10.2, 8.4, -4.6], tgt: [9, 10.0, -3.4], cz: 'Lodžie', en: 'Loggia' },
  { id: 'v-foyer', pos: F([-9.4, 8.4, 4.6]), tgt: F([9, 10.2, 4.6]), cz: 'Foyer', en: 'Foyer' },
  { id: 'v-aud', pos: A([0, 7.9, 17.0]), tgt: A([0, 9.2, 36.6]), cz: 'Hlediště', en: 'Auditorium' }, // from the I. balcony on the axis
  { id: 'v-ceiling', pos: A([0.4, 4.2, 23.0]), tgt: A([0, 23.4, 25.6]), cz: 'Strop a lustr', en: 'Ceiling and chandelier' },
  { id: 'v-stage', pos: A([0, 8.5, 50.8]), tgt: A([0, 9, 22]), cz: 'Z jeviště', en: 'From the stage', air: true },
]

export const DEFAULT_INPUT = () => ({
  clock: { t: 7, play: false, at: 0, snap: false }, // target of the build clock; while `play`, it runs on from `t` since `at`
  xray: false,
  layers: LAYERS.map((l) => l.id),
  cut: { on: false, u: -1.9, y: 46, auto: false },
  night: false,
  fire: { s: 0, at: 0 }, // 0 none, 1 burning since `at`, 2 rebuilding since `at`
})

export const PLAY_SPEED = 0.16 // build-clock units per second, as in his Play
const REBUILD_SECONDS = 3.4
export const stopOf = (T) => (T <= 0.001 ? 0 : Math.min(7, Math.ceil(T - 0.001)))

const nextFrame = () => new Promise((resolve) => (typeof document !== 'undefined' && !document.hidden && typeof requestAnimationFrame === 'function' ? requestAnimationFrame(() => resolve()) : setTimeout(resolve, 0)))

export async function buildTheatre({ onProgress = () => {} } = {}) {
  const world = new THREE.Group()
  world.name = 'theatre world'

  // sky dome
  const sky = new THREE.Mesh(new THREE.SphereGeometry(3500, 32, 16), new MeshBasicNodeMaterial({ side: THREE.BackSide, depthWrite: false, fog: false }))
  const dirY = normalize(positionLocal).y
  const dayCol = mix(vec3(0.83, 0.86, 0.88), vec3(0.36, 0.55, 0.78), smoothstep(-0.02, 0.45, dirY))
  const nightCol = mix(vec3(0.09, 0.11, 0.17), vec3(0.015, 0.022, 0.045), smoothstep(-0.02, 0.5, dirY))
  const xrayCol = mix(vec3(0.05, 0.09, 0.15), vec3(0.01, 0.02, 0.05), smoothstep(-0.02, 0.5, dirY))
  sky.material.colorNode = mix(mix(dayCol, nightCol, U.night), xrayCol, U.xray)
  sky.renderOrder = -1
  sky.name = 'sky'
  sky.frustumCulled = false
  // a headset draws no further than its own far plane (1 km by default): the dome is kept smaller than that and
  // round the viewer's head. It is drawn first and writes no depth, so everything else still lies in front of it.
  sky.scale.setScalar(900 / 3500)
  world.add(sky)
  const fog = new THREE.Fog(0xcfd6dc, 380, 1900)

  // lights
  const hemi = new THREE.HemisphereLight(0xdfe8f2, 0x6b6052, 0.9)
  world.add(hemi)
  const sun = new THREE.DirectionalLight(0xfff0dc, 3.1)
  sun.castShadow = true
  sun.shadow.mapSize.set(4096, 4096)
  sun.shadow.camera.left = -110; sun.shadow.camera.right = 110
  sun.shadow.camera.top = 110; sun.shadow.camera.bottom = -110
  sun.shadow.camera.near = 10; sun.shadow.camera.far = 600
  sun.shadow.bias = -0.0004
  sun.shadow.normalBias = 0.06
  const centre = bToWorld(0, 0, 40)
  const sunDir = new THREE.Vector3(-0.836, 0.5, -0.224).normalize()
  sun.position.copy(centre).addScaledVector(sunDir, 260)
  sun.target.position.copy(centre)
  world.add(sun, sun.target)
  const moonCol = new THREE.Color(0x8fa6d8)
  const sunCol = new THREE.Color(0xfff0dc)

  // ------------------------------------------------------------------ model
  const M = createMaterials({ reversedDepth: false })
  onProgress(0.05)
  await nextFrame()
  const R = new Registry()
  R.setGhostMaterial('shell', M.ghost)
  R.setGhostMaterial('soft', M.ghostSoft)
  R.setGhostMaterial('structure', M.ghostStruct)
  for (const l of LAYERS) R.setGhostMaterial('layer:' + l.id, layerMaterial(l.color))

  // every object remembers which builder made it (what is inside, what is outside, what is surroundings)
  const tag = (src) => world.traverse((o) => { o.userData.src ??= src })
  tag('sky')
  buildSite(world, M, R)
  tag('site')
  onProgress(0.15)
  await nextFrame()

  const root = new THREE.Group()
  root.name = 'narodni-divadlo'
  root.position.copy(FRAME.origin)
  root.rotation.y = FRAME.rotationY
  const planeLong = new THREE.Plane()
  const planePlan = new THREE.Plane()
  world.add(root)

  // auditorium/stage frame: turned about Zítek's axis inside the building frame
  const audPivot = new THREE.Group()
  audPivot.position.set(AXIS.shiftU, 0, AXIS.pivotV)
  const audRot = new THREE.Group()
  audRot.rotation.y = AXIS.angle
  const audRoot = new THREE.Group()
  audRoot.position.set(0, 0, -AXIS.pivotV)
  audRoot.name = 'auditorium-frame'
  root.add(audPivot)
  audPivot.add(audRot)
  audRot.add(audRoot)
  // his code reads the camera in world space (the curtain rises when you stand behind it, flames face you):
  // `eye` is kept at the viewer's head, also in a headset where the real camera hangs under the XR origin
  const eye = new THREE.PerspectiveCamera()
  const ctx = { root, audRoot, M, R, scene: world, camera: eye }
  const builders = { shell: buildShell, partitions: buildPartitions, facade: buildFacade, scaffold: buildScaffold, interior: buildInterior, stage: buildStage, systems: buildSystems, trams: buildTrams }
  let done = 0
  for (const [name, build] of Object.entries(builders)) {
    build(ctx)
    tag(name)
    onProgress(0.15 + 0.7 * (++done / 8))
    await nextFrame() // a slow CPU spends seconds here: keep the page responsive between the parts
  }
  const fire = new Fire(ctx)
  tag('fire')
  addSectionInsides(root, M) // dark inside of the walls in a section
  world.traverse((o) => { if (o.userData.pocheInside) o.userData.src = o.parent.userData.src })

  // ------------------------------------------------------------------ section planes (world space)
  // His page clips everything under the building root (ClippingGroup). WebGL clips per material, so every
  // material of the building gets the two planes and whatever shares one outside the building (the terrain's
  // X-ray ghost, the wood of a tree trunk) gets an unclipped copy.
  const planes = [planeLong, planePlan]
  const underRoot = (o) => { for (; o; o = o.parent) if (o === root) return true; return false }
  const clipped = new Set()
  const clip = (m) => {
    if (!m || clipped.has(m)) return
    m.clippingPlanes = planes
    m.clipShadows = true
    clipped.add(m)
  }
  const free = new Map()
  const unclipped = (m) => {
    if (!clipped.has(m)) return m
    if (!free.has(m)) { const c = m.clone(); c.clippingPlanes = null; free.set(m, c) }
    return free.get(m)
  }
  Object.values(M).forEach((m) => { if (m?.isMaterial) clip(m) })
  Object.values(R.ghostMaterials).forEach(clip)
  R.update(7, true) // finished state: the plastered finishes are in place
  root.traverse((o) => { if (o.isMesh) { clip(o.material); clip(o.userData.item?.material); clip(o.userData.finish) } })
  for (const it of R.items) if (underRoot(it.obj)) clip(it.material)
  const outside = []
  world.traverse((o) => {
    if (!o.isMesh || underRoot(o)) return
    o.material = unclipped(o.material)
    const it = o.userData.item
    if (it) { it.material = unclipped(it.material); outside.push(it) }
  })
  const applyVisibility = R.applyVisibility.bind(R)
  R.applyVisibility = (it) => {
    applyVisibility(it)
    if (it.obj.isMesh && outside.includes(it)) it.obj.material = unclipped(it.obj.material)
  }

  // the long section follows Zítek's axis: cut.u is measured across the auditorium frame
  const axisP = (u) => { const [bu, bv] = audToB(u, AXIS.pivotV); return bToWorld(bu, 0, bv) }
  const eWorld = axisP(1).sub(axisP(0)).normalize()
  const cut = { on: false, u: -1.9, y: 46 }
  function applyCut() {
    const u = cut.on ? cut.u : -1000
    const y = cut.on ? cut.y : 1000
    // keep points with u >= cutU (removes the river-side half)
    planeLong.normal.copy(eWorld)
    planeLong.constant = -eWorld.dot(axisP(u))
    planePlan.normal.set(0, -1, 0)
    planePlan.constant = y
  }
  applyCut()
  /** Is a world point inside the building's clipped volume and cut away by the section? */
  const cutAway = (p) => cut.on && (planeLong.distanceToPoint(p) < 0 || planePlan.distanceToPoint(p) < 0)

  // ------------------------------------------------------------------ state
  const input = DEFAULT_INPUT()
  const state = { T: 7, target: 7, playing: false, xray: false, xr: 0, night: 0, nightTarget: 0, lang: 'cz', layers: new Set(input.layers), lastStop: 7, autoCut: false, fire: false }
  Object.defineProperty(state, 'cutOn', { get: () => cut.on }) // hotspots inside the building need the section
  R.setMode({ xray: false, layers: state.layers })
  R.update(state.T, true)

  let jumped = false // the clock was set, not run, to where it is
  const fogDay = new THREE.Color(0xcfd6dc), fogNight = new THREE.Color(0x141b29), fogX = new THREE.Color(0x0b1422)
  const theatre = {
    world, root, sky, fog, sun, hemi, M, R, ctx, fire, cut, planes, eye, state, input, cutAway, unclip: unclipped,
    envIntensity: 0.55,
    version: 0, // goes up whenever what is drawn or solid may have changed for a reason other than the clock
    onStage: () => {}, // (stop) the clock entered another stage
    onStop: () => {},  // (stage, arrived) for the automatic section of the interior stages

    /** Soft reflections for the gilding, from the renderer that will draw the theatre. */
    environment(renderer) {
      const pmrem = new THREE.PMREMGenerator(renderer)
      const env = pmrem.fromScene(new RoomEnvironment(), 0.04).texture
      pmrem.dispose()
      return env
    },

    targetNow() {
      const c = input.clock
      return c.play ? Math.min(7, c.t + Math.max(0, (Date.now() - c.at) / 1000) * PLAY_SPEED) : c.t
    },

    /** Take over a piece of the shared state. */
    set(key, value) {
      input[key] = value
      if (key === 'clock' && value.jump) { state.T = value.t; jumped = true } // Play starts from here, the fire from the finished house
      if (key === 'xray' || key === 'layers') {
        state.xray = input.xray
        state.layers = new Set(input.layers)
        R.setMode({ xray: state.xray, layers: state.layers })
        theatre.version++
      } else if (key === 'cut') {
        cut.on = value.on; cut.u = value.u; cut.y = value.y
        state.autoCut = value.auto
        applyCut()
        theatre.version++
      } else if (key === 'night') state.nightTarget = value ? 1 : 0
      else if (key === 'fire') syncFire()
    },

    /** Show the shared state as it is now, without the transition (for someone who has just joined). */
    jump() {
      state.target = state.T = theatre.targetNow()
      state.lastStop = stopOf(state.T)
      state.night = state.nightTarget
      state.xr = state.xray ? 1 : 0
      R.update(state.T, true)
      ctx.setCables?.()
      theatre.onStage(state.lastStop)
    },

    tick(dt, elapsed) {
      setTime(elapsed)
      sky.position.copy(eye.position)
      // build clock
      state.target = theatre.targetNow()
      state.playing = input.clock.play && state.target < 7
      const d = state.target - state.T
      if (Math.abs(d) > 1e-4) {
        const speed = state.playing || input.clock.snap ? 10 : Math.max(0.45, Math.abs(d) * 1.4)
        state.T += Math.sign(d) * Math.min(Math.abs(d), speed * dt)
      } else state.T = state.target
      R.update(state.T)
      // his fly-bar cables follow the bars only while the clock runs through the stage-machinery stage: after a jump over it
      // (the fire starts from the finished house) they are set once by hand
      if (jumped) { jumped = false; ctx.setCables?.() }
      const stop = stopOf(state.T)
      if (stop !== state.lastStop) {
        state.lastStop = stop
        theatre.onStage(stop)
        // passing through intermediate stops on the way to another one must not toggle the section
        if (state.playing || stop === stopOf(state.target)) theatre.onStop(STAGES[stop])
      }

      // day / night
      state.night += (state.nightTarget - state.night) * Math.min(1, dt * 2.2)
      state.xr += ((state.xray ? 1 : 0) - state.xr) * Math.min(1, dt * 3)
      U.night.value = state.night
      U.xray.value = state.xr
      const dark = Math.max(state.night, state.xr * 0.85)
      sun.intensity = THREE.MathUtils.lerp(3.1, 0.35, dark)
      sun.color.lerpColors(sunCol, moonCol, dark)
      hemi.intensity = THREE.MathUtils.lerp(0.9, 0.2, dark)
      theatre.envIntensity = THREE.MathUtils.lerp(0.55, 0.12, dark)
      fog.color.lerpColors(fogDay, state.xr > state.night ? fogX : fogNight, dark)

      for (const f of ctx.ticks ?? []) f(dt, state.T, state)
      syncFire()
      fire.update(dt)
    },
  }

  // the fire runs from the moment it was lit, so everyone (also who joins later) sees the same minute of it
  let lit = 0, rebuilt = 0 // the `at` of the fire and of the rebuild this page has already acted on
  function syncFire() {
    const f = input.fire
    const age = Math.max(0, (Date.now() - f.at) / 1000)
    if (f.s === 1 && lit !== f.at) {
      lit = f.at
      fire.start()
      fire.t = age
    } else if (f.s === 2 && rebuilt !== f.at) {
      rebuilt = f.at
      if (!fire.active && age < REBUILD_SECONDS) { fire.start(); fire.t = 60; fire.update(0) } // joined mid-rebuild: it had fallen in
      if (fire.active) { fire.rebuild(); fire.rt = age }
    } else if (f.s === 0 && fire.active) fire.stop()
    if (f.s !== 1) lit = 0
    if (state.fire !== fire.active) theatre.version++
    state.fire = fire.active
  }

  onProgress(1)
  return theatre
}
