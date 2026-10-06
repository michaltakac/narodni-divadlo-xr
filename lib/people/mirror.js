// A real mirror in a gilded frame: the scene is drawn once more from behind the glass and shown on it.
//
// What it costs is kept small in three ways. The picture is drawn through a frustum fitted to the glass
// (from the eye's mirror image through the four corners, cut off exactly at the glass), so nothing outside
// that narrow view is drawn and every pixel of the modest picture is used. It is drawn only while `live` is
// set and the glass is in view. And the picture is stored the way the screen and the headset store theirs
// (tone-mapped, sRGB), so no material needs a second shader for it.
//
// In a headset the glass is drawn once for each eye and its picture is made anew just before each, so the
// reflection has depth like a real one.
import { BoxGeometry, CanvasTexture, Color, Float32BufferAttribute, Group, LinearFilter, Matrix4, Mesh, MeshBasicMaterial, MeshStandardMaterial, PerspectiveCamera, PlaneGeometry, SRGBColorSpace, ShaderMaterial, SphereGeometry, Vector3, WebGLRenderTarget } from 'three'
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js'

/**
 * While a mirror draws its picture: `busy` stops another mirror from drawing inside it, and `before` / `after`
 * let others change what the mirror sees (a person sees their own head only in the mirror). `glow` is set by the
 * computer's glow pass (components/Room.jsx), which draws only what shines by itself: a mirror is dark in it and
 * draws nothing, so its picture is made once a frame, not twice.
 */
export const mirrorPass = { busy: false, glow: false, before: new Set(), after: new Set() }

const GOLD = '#c9a24a', GOLD_DARK = '#8f6f2c', WOOD = '#24170f'
const _x = new Vector3(), _y = new Vector3(), _n = new Vector3(), _c = new Vector3(), _eye = new Vector3(), _p = new Vector3()
const _xc = new Vector3(), _zc = new Vector3(), _m = new Matrix4()

function box(w, h, d, x, y, z, color) {
  const g = new BoxGeometry(w, h, d).translate(x, y, z).toNonIndexed()
  const c = new Color(color), n = g.attributes.position.count, colors = new Float32Array(n * 3)
  for (let i = 0; i < n; i++) colors.set([c.r, c.g, c.b], i * 3)
  g.setAttribute('color', new Float32BufferAttribute(colors, 3))
  return g
}

/**
 * { group, setLive(on), live, dispose() }. The group's origin is on the floor under the middle of the glass and
 * its +z is the way the mirror faces.
 *   width, height   of the glass, metres;  lift: how far its lower edge is above the floor
 *   pixels          of the picture per metre of glass
 *   back            how far the glass stands from the wall behind it (a closed case), 0 for a mirror on feet
 *   plate           words on a plate above the glass;  lamps: two glowing globes beside it
 */
export function createMirror({ width = 0.74, height = 1.78, lift = 0.16, pixels = 480, back = 0, plate = null, lamps = false, gain = 1, name = 'mirror' } = {}) {
  const target = new WebGLRenderTarget(Math.round(width * pixels), Math.round(height * pixels), { samples: 4, colorSpace: SRGBColorSpace })
  target.texture.minFilter = target.texture.magFilter = LinearFilter
  target.texture.generateMipmaps = false
  target.isXRRenderTarget = true // three.js then tone-maps and encodes into it as it does for the screen and the headset
  target.texture.internalFormat = 'RGBA8' // and the bytes are kept as they were written (already encoded), as on a screen

  const material = new ShaderMaterial({
    uniforms: { map: { value: target.texture }, live: { value: 0 }, hdr: { value: 0 }, dark: { value: 0 }, exposure: { value: 1 }, gain: { value: gain } },
    vertexShader: 'varying vec2 vUv; void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
    // The picture is ready for the screen. When this frame is drawn into the computer's glow pipeline instead
    // (linear light, tone-mapped at its end), it is taken back to linear light first: the curve is the
    // usual fit of the ACES one, turned round.
    fragmentShader: `
      uniform sampler2D map; uniform float live, hdr, dark, exposure, gain; varying vec2 vUv;
      vec3 toLinear(vec3 c) { return mix(pow((c + 0.055) / 1.055, vec3(2.4)), c / 12.92, step(c, vec3(0.04045))); }
      vec3 toSRGB(vec3 c) { return mix(1.055 * pow(c, vec3(1.0 / 2.4)) - 0.055, c * 12.92, step(c, vec3(0.0031308))); }
      vec3 untone(vec3 y) { y = min(y, vec3(0.985)); vec3 a = 2.51 - 2.43 * y, b = 0.03 - 0.59 * y; return (-b + sqrt(b * b + 0.56 * a * y)) / (2.0 * a); }
      void main() {
        vec3 dull = toSRGB(mix(vec3(0.03, 0.032, 0.035), vec3(0.16, 0.17, 0.18), vUv.y));
        vec3 c = mix(dull, texture2D(map, vec2(1.0 - vUv.x, vUv.y)).rgb * vec3(0.95, 0.965, 0.96) * gain, live);
        gl_FragColor = vec4(mix(c, untone(toLinear(c)) / exposure, hdr) * (1.0 - dark), 1.0);
      }`,
  })
  material.toneMapped = false

  const glass = new Mesh(new PlaneGeometry(width, height), material)
  glass.name = `${name} glass`
  glass.position.set(0, lift + height / 2, 0)

  // ---- the frame: gilded bars, a crest, and either feet or a case that reaches back to the wall
  const F = 0.07, top = lift + height, half = width / 2
  const parts = [
    box(F, height + F * 2, 0.06, -half - F / 2, lift + height / 2, -0.005, GOLD),
    box(F, height + F * 2, 0.06, half + F / 2, lift + height / 2, -0.005, GOLD),
    box(width, F, 0.06, 0, top + F / 2, -0.005, GOLD),
    box(width, F, 0.06, 0, lift - F / 2, -0.005, GOLD),
    box(width + F * 2 + 0.06, 0.035, 0.09, 0, top + F + 0.017, -0.005, GOLD_DARK), // a cornice
    box(width + 0.02, height + 0.02, 0.012, 0, lift + height / 2, -0.02, WOOD), // behind the glass
  ]
  const crest = plate ? 0.15 : 0.1
  parts.push(box(plate ? width + F : width * 0.5, crest, 0.04, 0, top + F + 0.035 + crest / 2, -0.01, plate ? WOOD : GOLD))
  if (plate) parts.push(box(width + F + 0.04, 0.02, 0.06, 0, top + F + 0.035 + crest + 0.01, -0.01, GOLD))
  else parts.push(box(width * 0.24, 0.05, 0.04, 0, top + F + 0.035 + crest + 0.025, -0.01, GOLD_DARK))
  if (back > 0) parts.push(box(width + F * 2, top + F, back, 0, (top + F) / 2, -0.035 - back / 2, WOOD))
  else {
    for (const sd of [-1, 1]) parts.push(box(F, 0.05, 0.5, sd * (half + F / 2), 0.025, 0, GOLD_DARK), box(0.04, lift, 0.04, sd * (half + F / 2), lift / 2, 0, GOLD))
  }
  const frame = new Mesh(mergeGeometries(parts), new MeshStandardMaterial({ vertexColors: true, metalness: 0.78, roughness: 0.36 }))
  frame.name = `${name} frame`
  frame.castShadow = true
  parts.forEach((g) => g.dispose())

  const group = new Group()
  group.name = name
  group.add(frame, glass)
  const owned = [target, material, glass.geometry, frame.geometry, frame.material]

  if (plate) {
    const canvas = document.createElement('canvas')
    canvas.width = 1024; canvas.height = 192
    const texture = new CanvasTexture(canvas)
    texture.colorSpace = SRGBColorSpace
    texture.anisotropy = 8
    const paint = () => {
      const c = canvas.getContext('2d')
      c.fillStyle = '#17100a'; c.fillRect(0, 0, 1024, 192)
      c.strokeStyle = '#d9b45a'; c.lineWidth = 5; c.strokeRect(12, 12, 1000, 168)
      c.fillStyle = '#e8c56a'; c.textAlign = 'center'; c.textBaseline = 'middle'
      c.font = '112px "Bebas Neue XR", "Bebas Neue", Impact, "Arial Narrow", sans-serif'
      c.fillText(plate.toLocaleUpperCase('cs'), 512, 104, 950)
      texture.needsUpdate = true
    }
    paint()
    document.fonts?.load('112px "Bebas Neue"').then(paint).catch(() => {}) // the letters of the interface, once they are there
    const w = width + F - 0.04
    const sign = new Mesh(new PlaneGeometry(w, (w * 192) / 1024), new MeshBasicMaterial({ map: texture }))
    sign.name = `plate ${plate}`
    sign.position.set(0, top + F + 0.035 + crest / 2, 0.011)
    group.add(sign)
    owned.push(texture, sign.geometry, sign.material)
  }
  if (lamps) {
    // gas light: a globe on a gilded arm each side; they shine by themselves (and glow at night on a computer)
    const globes = mergeGeometries([-1, 1].map((sd) => new SphereGeometry(0.055, 14, 10).translate(sd * (half + 0.24), top - 0.12, 0.1)))
    const light = new Mesh(globes, new MeshBasicMaterial({ color: '#ffe2ae' }))
    light.name = `${name} lamps`
    const arms = new Mesh(mergeGeometries([-1, 1].flatMap((sd) => [box(0.2, 0.025, 0.025, sd * (half + 0.15), top - 0.22, 0.02, GOLD), box(0.025, 0.07, 0.025, sd * (half + 0.24), top - 0.19, 0.06, GOLD), box(0.025, 0.025, 0.1, sd * (half + 0.24), top - 0.22, 0.06, GOLD)])), frame.material)
    arms.name = `${name} lamp arms`
    group.add(light, arms)
    owned.push(globes, light.material, arms.geometry)
  }

  const camera = new PerspectiveCamera()
  const api = {
    group, glass, target, live: false,
    setLive(on) { api.live = on; if (!on) material.uniforms.live.value = 0 },
    dispose() { for (const o of owned) o.dispose() },
  }

  glass.onBeforeRender = (renderer, scene, viewer) => {
    material.uniforms.dark.value = mirrorPass.glow ? 1 : 0
    if (!api.live || mirrorPass.busy || mirrorPass.glow) return
    const e = glass.matrixWorld.elements
    _x.set(e[0], e[1], e[2]).normalize(); _y.set(e[4], e[5], e[6]).normalize(); _n.set(e[8], e[9], e[10]).normalize()
    _c.setFromMatrixPosition(glass.matrixWorld)
    _eye.setFromMatrixPosition(viewer.matrixWorld)
    const d = _p.subVectors(_eye, _c).dot(_n) // how far the eye is in front of the glass
    if (d < 0.03) return
    // the eye's mirror image looks back through the glass: its picture's edges are the glass's edges
    camera.position.copy(_eye).addScaledVector(_n, -2 * d)
    camera.quaternion.setFromRotationMatrix(_m.makeBasis(_xc.copy(_x).negate(), _y, _zc.copy(_n).negate()))
    _p.subVectors(_c, camera.position)
    const px = _p.dot(_xc), py = _p.dot(_y)
    camera.projectionMatrix.makePerspective(px - width / 2, px + width / 2, py + height / 2, py - height / 2, d, 1500)
    camera.projectionMatrixInverse.copy(camera.projectionMatrix).invert()

    const outer = renderer.getRenderTarget()
    const keep = [renderer.xr.enabled, renderer.shadowMap.autoUpdate, renderer.shadowMap.needsUpdate]
    mirrorPass.busy = true
    for (const f of mirrorPass.before) f()
    glass.visible = false
    renderer.xr.enabled = false // draw with this camera, not the headset's
    renderer.shadowMap.autoUpdate = renderer.shadowMap.needsUpdate = false
    renderer.setRenderTarget(target)
    renderer.clear()
    renderer.render(scene, camera)
    ;[renderer.xr.enabled, renderer.shadowMap.autoUpdate, renderer.shadowMap.needsUpdate] = keep
    renderer.setRenderTarget(outer)
    if (viewer.viewport !== undefined) renderer.state.viewport(viewer.viewport) // back to this eye's half of the headset's picture
    glass.visible = true
    for (const f of mirrorPass.after) f()
    mirrorPass.busy = false

    const u = material.uniforms
    u.live.value = 1
    u.hdr.value = outer && !outer.isXRRenderTarget ? 1 : 0
    u.exposure.value = renderer.toneMappingExposure
  }
  return api
}
