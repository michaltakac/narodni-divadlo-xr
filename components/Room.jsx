// The place everyone meets: the National Theatre in Prague and the streets around it, at real size.
// The model is Lukáš Eršil's (lib/nd, built by lib/theatre/model.js); this component puts it in the scene,
// keeps it in step with the room (lib/theatre/director.js), lets people walk through it (Walk.jsx) and draws
// it: with his shadows and night glow on a computer, merged and without a post-processing pass in a headset
// and on a phone or tablet.
import { useEffect, useMemo, useRef } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import { Color, HalfFloatType, Vector2, Vector3, WebGLRenderTarget } from 'three'
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js'
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js'
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js'
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js'
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js'
import { useMultiplayer } from './Multiplayer'
import { Walk } from './Walk'
import { Notice } from './Notice'
import { XRMenu } from './XRMenu'
import { XRHotspots } from './XRHotspots'
import { People } from './People'
import { Teleport } from './Teleport'
import { createChunks, toBuilding, whereIs } from '../lib/theatre/chunks'
import { loadTheatre } from '../lib/theatre/load'
import { LIGHT, busy, useApp } from '../lib/theatre/app'
import { STAGES } from '../lib/nd/data/content.js'
import { mirrorPass } from '../lib/people/mirror'

const _scale = new Vector3()
const _b = new Vector3()

export function Room() {
  const theatre = useApp((s) => s.theatre)
  const summary = useApp((s) => s.summary)
  const xr = useApp((s) => s.xr)
  useEffect(() => { loadTheatre() }, [])
  if (!theatre) return null
  return (
    <>
      <primitive object={theatre.world} />
      {/* what everyone in the room sees, in words: Graspable's XR tests compare objects by name */}
      <group name={summary} />
      <Theatre theatre={theatre} />
      <Walk theatre={theatre} />
      {/* everyone, in the clothes of the years the theatre was built, and the mirrors */}
      <People theatre={theatre} />
      <Notice />
      {/* inside the headset: the menu on the hand and the hotspots in the building (on a screen the HTML layer does this) */}
      {/* (a hand whose pointer is on one of them is busy: it does not throw the teleport arc, components/Teleport.jsx) */}
      <group onPointerMove={onPanel} onPointerDown={onPanel}>
        {xr && <XRMenu theatre={theatre} />}
        {xr && <XRHotspots theatre={theatre} />}
      </group>
      {/* point at a spot and be there: the arc in the headset, a double-click on a screen */}
      <Teleport theatre={theatre} />
    </>
  )
}

const onPanel = (e) => { const hand = e.pointerState?.inputSource?.handedness; if (hand in busy) busy[hand] = performance.now() }

const chunksOf = new WeakMap()

function Theatre({ theatre }) {
  const gl = useThree((s) => s.gl)
  const scene = useThree((s) => s.scene)
  const camera = useThree((s) => s.camera)
  const size = useThree((s) => s.size)
  const { doc, synced } = useMultiplayer()
  const director = useApp((s) => s.director)
  const chunks = useMemo(() => { if (!chunksOf.has(theatre)) chunksOf.set(theatre, createChunks(theatre)); return chunksOf.get(theatre) }, [theatre])
  theatre.chunks = chunks
  const run = useRef({ headset: false, baked: '', bakedAt: 0, summary: '', where: 'out', stage: -1, playing: null }).current

  // ---- the room: its state arrives, changes here go out
  useEffect(() => director.attach(doc), [director, doc])
  useEffect(() => { if (synced) director.arrive() }, [director, synced])

  // ---- the scene around the model
  useEffect(() => {
    gl.localClippingEnabled = true // the two section planes
    gl.info.autoReset = false // counted per frame by the readout (components/Perf.jsx)
    const env = theatre.environment(gl)
    scene.environment = env
    scene.fog = theatre.fog
    useApp.setState({ view: { camera, canvas: gl.domElement } })
    return () => { scene.environment = null; scene.fog = null; env.dispose(); useApp.setState({ view: null }) }
  }, [gl, scene, camera, theatre])

  // ---- his glow on a computer: bloom of what shines by itself (windows and lamps at night, flames, the X-ray
  // layers). His WebGPU pipeline wrote the emissive light into a second target in the same pass; here the scene
  // is drawn once more at half size with every light switched off, which leaves exactly that light.
  const post = useMemo(() => {
    const composer = new EffectComposer(gl, new WebGLRenderTarget(1, 1, { type: HalfFloatType, samples: 4 }))
    composer.addPass(new RenderPass(scene, camera))
    const add = new ShaderPass({
      uniforms: { tDiffuse: { value: null }, tGlow: { value: null } },
      vertexShader: 'varying vec2 vUv; void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
      // the halo is compressed as it gets strong, keeping its colour: a lamp far away glows exactly as his bloom
      // draws it, a lamp close to the eye (a big bright disc feeds every blur level) stays a globe with a soft
      // halo instead of washing the picture out
      fragmentShader: 'uniform sampler2D tDiffuse; uniform sampler2D tGlow; varying vec2 vUv; void main() { vec3 g = texture2D(tGlow, vUv).rgb; g /= 1.0 + max(g.r, max(g.g, g.b)) * 1.6; gl_FragColor = texture2D(tDiffuse, vUv) + vec4(g, 0.0); }',
    })
    composer.addPass(add)
    composer.addPass(new OutputPass())
    const glow = new WebGLRenderTarget(1, 1, { type: HalfFloatType })
    const bloom = new UnrealBloomPass(new Vector2(1, 1), 0.8, 0.4, 0.28) // his strength, radius and threshold
    const ghosts = [theatre.M.ghost, theatre.M.ghostSoft, theatre.M.ghostStruct].flatMap((m) => [m, theatre.unclip(m)])
    const black = new Color(0)
    const fogColor = new Color()
    /** Draw only the light that surfaces give off themselves, and blur it. */
    const renderGlow = (cam) => {
      const { sun, hemi, sky, fog, fire } = theatre
      const keep = [sun.intensity, hemi.intensity, scene.environmentIntensity, fire.light.intensity, gl.shadowMap.autoUpdate, gl.shadowMap.needsUpdate]
      fogColor.copy(fog.color)
      sun.intensity = hemi.intensity = scene.environmentIntensity = fire.light.intensity = 0
      fog.color.copy(black)
      sky.visible = false
      for (const m of ghosts) m.visible = false
      gl.shadowMap.autoUpdate = gl.shadowMap.needsUpdate = false
      gl.setRenderTarget(glow)
      gl.clear()
      mirrorPass.glow = true // a mirror shines by nothing of its own
      gl.render(scene, cam)
      mirrorPass.glow = false
      gl.setRenderTarget(null)
      ;[sun.intensity, hemi.intensity, scene.environmentIntensity, fire.light.intensity, gl.shadowMap.autoUpdate, gl.shadowMap.needsUpdate] = keep
      fog.color.copy(fogColor)
      sky.visible = true
      for (const m of ghosts) m.visible = true
      bloom.render(gl, null, glow, 0, false)
      // the bloom leaves the renderer drawing into `glow`. The composer hands back whatever target it found, so
      // without this every later frame drawn without the glow would go into that texture and the screen would
      // keep its last picture.
      gl.setRenderTarget(null)
      add.uniforms.tGlow.value = bloom.renderTargetsHorizontal[0].texture
    }
    const setSize = (w, h, ratio) => {
      composer.setPixelRatio(ratio)
      composer.setSize(w, h)
      const gw = Math.max(2, Math.round((w * ratio) / 2)), gh = Math.max(2, Math.round((h * ratio) / 2))
      glow.setSize(gw, gh)
      bloom.setSize(gw, gh)
    }
    const dispose = () => { composer.dispose(); glow.dispose(); bloom.dispose() }
    return { composer, renderGlow, setSize, dispose }
  }, [gl, scene, camera, theatre])
  useEffect(() => { post.setSize(size.width, size.height, gl.getPixelRatio()) }, [post, gl, size])
  useEffect(() => () => post.dispose(), [post])

  useFrame((state, delta) => {
    const dt = Math.min(delta, 0.05)
    const presenting = gl.xr.isPresenting
    // his code reads the viewer's head in world space
    state.camera.matrixWorld.decompose(theatre.eye.position, theatre.eye.quaternion, _scale)
    theatre.tick(dt, state.clock.elapsedTime)
    scene.environmentIntensity = theatre.envIntensity

    // ---- headset: merged finished stages, a shadow map that is only redrawn when the building has changed
    const headset = presenting || LIGHT
    const { sun, state: st } = theatre
    if (headset !== run.headset) {
      run.headset = headset
      chunks.setEnabled(headset)
      sun.shadow.mapSize.setScalar(headset ? 2048 : 4096)
      sun.shadow.map?.dispose()
      sun.shadow.map = null
      gl.shadowMap.autoUpdate = !headset
      gl.shadowMap.needsUpdate = true
      sun.shadow.intensity = 1
      run.baked = ''
      if (presenting) gl.xr.setFoveation?.(1)
    }
    chunks.update(theatre.eye.position)
    run.where = whereIs(toBuilding(theatre.eye.position, _b))
    if (headset) {
      const still = !st.playing && Math.abs(st.T - st.target) < 1e-4 && !theatre.fire.active
      const key = `${st.T.toFixed(3)}|${theatre.version}|${chunks.stats.rebuilds}|${chunks.stats.merged}`
      if (!still) { sun.shadow.intensity = 0; run.baked = '' } // nothing stale on what is moving
      else if (key !== run.baked && state.clock.elapsedTime - run.bakedAt > 0.4) {
        run.baked = key
        run.bakedAt = state.clock.elapsedTime
        gl.shadowMap.needsUpdate = true
        sun.shadow.intensity = 1
      }
    }

    // ---- the HTML layer follows the clock and keeps its markers on their places
    if (!presenting) director.ui?.update(st.T)
    const stage = st.lastStop
    const words = `theatre: stage ${stage} ${STAGES[stage].id}, ${st.xray ? 'x-ray' : 'exterior'}, ${theatre.input.night ? 'night' : 'day'}, ${theatre.cut.on ? 'section' : 'whole'}${theatre.fire.active ? ', fire' : ''}`
    if (words !== run.summary) { run.summary = words; useApp.setState({ summary: words }) }
    if (stage !== run.stage || st.playing !== run.playing) { run.stage = stage; run.playing = st.playing; useApp.setState({ stage, playing: st.playing }) }
  }, -1)

  // ---- drawing (taking over from React Three Fiber): one renderer, no post-processing pass in the headset
  useFrame((state) => {
    const { state: st } = theatre
    // plain daylight outdoors has next to nothing that shines by itself: drawn directly, like the headset and a phone
    const glowing = !LIGHT && (st.night > 0.02 || st.xr > 0.02 || theatre.fire.active || run.where !== 'out')
    if (gl.xr.isPresenting || !glowing) { gl.render(scene, state.camera); return }
    post.renderGlow(state.camera)
    post.composer.render()
  }, 1)

  return null
}
