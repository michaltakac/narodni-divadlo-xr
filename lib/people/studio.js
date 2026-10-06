// The wardrobe's own small drawing: one figure, standing, on nothing. It makes the little pictures of the
// outfits (for the list on a computer and in the headset menu) and the preview that turns slowly in the panel
// on a computer. It has a renderer of its own, so the theatre's is not disturbed; nothing is made until the
// wardrobe is first opened.
import { DirectionalLight, HemisphereLight, PerspectiveCamera, Quaternion, Scene, Vector3, WebGLRenderer } from 'three'
import { Figure } from './figure.js'
import { packLook } from './wardrobe.js'

let studio = null
function open() {
  if (studio) return studio
  const renderer = new WebGLRenderer({ alpha: true, antialias: true, preserveDrawingBuffer: true })
  renderer.setClearColor(0x000000, 0)
  const scene = new Scene()
  const camera = new PerspectiveCamera(24, 1, 0.5, 20)
  const sun = new DirectionalLight('#fff3e2', 2.6)
  sun.position.set(-1.6, 2.2, 1.2) // from the viewer's upper left, wherever the viewer stands
  camera.add(sun, new HemisphereLight('#ffffff', '#5a5148', 1.5))
  sun.target.position.set(0, 1, 0)
  scene.add(camera, sun.target)
  const figure = new Figure()
  scene.add(figure.mesh)
  const head = { position: new Vector3(0, 1.65, 0), quaternion: new Quaternion() }
  studio = { renderer, scene, camera, figure, head, size: '' }
  return studio
}

function draw(look, width, height, angle, dt) {
  const s = open()
  const key = `${width}x${height}`
  if (s.size !== key) { s.size = key; s.renderer.setSize(width, height, false); s.camera.aspect = width / height; s.camera.updateProjectionMatrix() }
  s.figure.setLook(look)
  s.figure.update(dt, s.head, null, null)
  const tall = s.figure.scale * 1.72
  const centre = (tall + 0.14) / 2, distance = ((tall + 0.34) / 2) / Math.tan((s.camera.fov * Math.PI) / 360)
  s.camera.position.set(Math.sin(angle) * distance, centre, -Math.cos(angle) * distance)
  s.camera.lookAt(0, centre, 0)
  s.renderer.render(s.scene, s.camera)
  return s.renderer.domElement
}

/** A picture of a look at any size and from any side, as a data: address (for looking at the wardrobe while it is made). */
export const picture = (look, width, height, angle = 0) => draw(look, width, height, angle, 0).toDataURL('image/png')

const pictures = new Map()
/** A small picture of a look, as a data: address (kept once made). */
export function thumbnail(look) {
  const key = packLook(look)
  if (!pictures.has(key)) pictures.set(key, draw(look, 132, 184, 0.45, 0).toDataURL('image/png'))
  return pictures.get(key)
}

/** Draw a look into a 2D canvas of the page, seen from `angle` (0 is the front). */
export function portrait(canvas, look, angle, dt = 0.016) {
  const source = draw(look, canvas.width, canvas.height, angle, dt)
  const c = canvas.getContext('2d')
  c.clearRect(0, 0, canvas.width, canvas.height)
  c.drawImage(source, 0, 0)
}
