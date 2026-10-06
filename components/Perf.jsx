// A small readout you switch on with the P key (or ?perf in the address, handy in a headset): frames per
// second, draw calls and triangles of the last frame. In a headset the numbers are per eye and it floats
// at the lower edge of the view.
import { useEffect, useMemo, useRef } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import { CanvasTexture, LinearFilter, Quaternion, SRGBColorSpace, Vector3 } from 'three'
import { useApp } from '../lib/theatre/app'

const _p = new Vector3(), _q = new Quaternion(), _s = new Vector3()

/** Inside <Canvas>: counts, and shows the numbers in the headset. */
export function PerfProbe() {
  const gl = useThree((s) => s.gl)
  const on = useApp((s) => s.perf)
  const xr = useApp((s) => s.xr)
  const plate = useRef()
  const acc = useRef({ frames: 0, time: 0 }).current
  const canvas = useMemo(() => { const c = document.createElement('canvas'); c.width = 768; c.height = 64; return c }, [])
  const texture = useMemo(() => { const t = new CanvasTexture(canvas); t.colorSpace = SRGBColorSpace; t.minFilter = LinearFilter; t.generateMipmaps = false; return t }, [canvas])
  useEffect(() => () => texture.dispose(), [texture])

  // before everything else in the frame: start counting from zero
  useFrame(() => { gl.info.reset() }, -10)
  // after the frame is drawn
  useFrame((state, delta) => {
    if (!on) return
    acc.frames++
    acc.time += delta
    if (acc.time >= 0.5) {
      const eyes = gl.xr.isPresenting ? Math.max(1, gl.xr.getCamera().cameras.length) : 1
      const text = `${Math.round(acc.frames / acc.time)} fps   ${Math.round(gl.info.render.calls / eyes)} draw calls   ${Math.round(gl.info.render.triangles / eyes).toLocaleString('en-US')} triangles${eyes > 1 ? ' / eye' : ''}`
      acc.frames = 0; acc.time = 0
      perfText.value = text
      perfText.listeners.forEach((f) => f(text))
      if (gl.xr.isPresenting) {
        const c = canvas.getContext('2d')
        c.fillStyle = '#000'; c.fillRect(0, 0, 768, 64)
        c.fillStyle = '#fff'; c.font = '500 22px ui-monospace, Menlo, monospace'; c.textBaseline = 'middle'
        c.fillText(text, 12, 34)
        texture.needsUpdate = true
      }
    }
    if (plate.current) {
      state.camera.matrixWorld.decompose(_p, _q, _s)
      plate.current.position.copy(_p)
      plate.current.quaternion.copy(_q)
    }
  }, 2)

  if (!on || !xr) return null
  return (
    <group ref={plate} name="performance readout">
      <mesh position={[0, -0.32, -1]} renderOrder={9500}>
        <planeGeometry args={[0.84, 0.07]} />
        <meshBasicMaterial map={texture} depthTest={false} fog={false} toneMapped={false} transparent opacity={0.9} />
      </mesh>
    </group>
  )
}

export const perfText = { value: '', listeners: new Set() }
if (import.meta.env?.DEV) window.__perf = perfText // for the console and tests, like __theatre

/** Outside <Canvas>: the readout on a computer. */
export function PerfReadout() {
  const on = useApp((s) => s.perf)
  const xr = useApp((s) => s.xr)
  const el = useRef()
  useEffect(() => {
    const show = (text) => { if (el.current) el.current.textContent = text }
    perfText.listeners.add(show)
    return () => perfText.listeners.delete(show)
  }, [])
  if (!on || xr) return null
  return <div className="perf" ref={el}>{perfText.value || '…'}</div>
}
