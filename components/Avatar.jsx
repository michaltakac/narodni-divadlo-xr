// Someone else in the room: a head with a visor, two hands (or controllers) and a name plate that always
// faces you. Poses are read from the connection every frame (interpolated, a little in the past), never
// through React. A peer who falls silent fades out; one who leaves disappears with their awareness.
import { useEffect, useMemo, useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import { CanvasTexture, LinearFilter, SRGBColorSpace, Vector3 } from 'three'
import { useMp } from './Multiplayer'

const SKIN = '#f3efe8'
const DARK = '#1b2030'

export function Avatar({ id, name, color, handle, kind }) {
  const mp = useMp()
  const root = useRef(), head = useRef(), plate = useRef(), left = useRef(), right = useRef()
  const materials = useRef([])
  const last = useRef({ opacity: -1, lKind: -1, rKind: -1 })
  const plateTex = useMemo(() => namePlate(name, handle, color), [name, handle, color])
  useEffect(() => () => plateTex.texture.dispose(), [plateTex])

  useFrame((state) => {
    const g = root.current
    if (!g) return
    const now = performance.now()
    const opacity = mp.peerOpacity(id, now)
    g.visible = opacity > 0 && mp.peerHead(id, head.current.position, head.current.quaternion, now)
    if (!g.visible) return
    for (const [side, ref, key] of [['left', left, 'lKind'], ['right', right, 'rKind']]) {
      const h = ref.current
      h.visible = mp.peerHand(id, side, h.position, h.quaternion, now)
      if (!h.visible) continue
      const info = mp.peerHandInfo(id, side)
      const handKind = info ? info[1] : 0
      if (handKind !== last.current[key]) { last.current[key] = handKind; h.children[0].visible = handKind === 0; h.children[1].visible = handKind === 1 }
      // hand: fingers curl with the pinch; controller: the trigger ring tightens a little
      const grip = info ? info[0] : 0
      if (handKind === 0) h.children[0].children[1].rotation.x = -0.2 - grip * 1.3
      else h.children[1].scale.setScalar(1 - grip * 0.1)
    }
    // the name plate floats above the head, faces the viewer, and grows with distance so it stays readable
    const p = plate.current
    p.position.set(head.current.position.x, head.current.position.y + 0.3, head.current.position.z)
    p.quaternion.copy(state.camera.quaternion)
    const dist = state.camera.getWorldPosition(_cam).distanceTo(p.position)
    p.scale.setScalar(Math.max(1, dist / 1.6))
    if (opacity !== last.current.opacity) {
      last.current.opacity = opacity
      for (const m of materials.current) if (m) m.opacity = opacity * (m.userData.base ?? 1)
    }
  })

  const mat = (i, base = 1) => (m) => { if (m) { m.userData.base = base; materials.current[i] = m } }
  const hand = (ref, name) => (
    <group ref={ref} name={name} visible={false}>
      {/* a tracked hand: a palm and fingers that curl when the person pinches */}
      <group>
        <mesh position={[0, 0, -0.03]} scale={[0.042, 0.016, 0.05]} castShadow>
          <sphereGeometry args={[1, 16, 12]} />
          <meshStandardMaterial ref={mat(3)} color={SKIN} roughness={0.6} transparent />
        </mesh>
        <group position={[0, 0, -0.075]} rotation={[-0.2, 0, 0]}>
          <mesh position={[0, 0, -0.035]} scale={[0.038, 0.013, 0.04]} castShadow>
            <sphereGeometry args={[1, 16, 12]} />
            <meshStandardMaterial ref={mat(4)} color={SKIN} roughness={0.6} transparent />
          </mesh>
        </group>
        <mesh position={[0.04, 0, -0.03]} rotation={[0.3, 0, -0.7]} scale={[0.013, 0.03, 0.013]} castShadow>
          <sphereGeometry args={[1, 12, 10]} />
          <meshStandardMaterial ref={mat(5)} color={SKIN} roughness={0.6} transparent />
        </mesh>
      </group>
      {/* a controller: handle and ring, in the person's colour */}
      <group visible={false} rotation={[-0.6, 0, 0]}>
        <mesh position={[0, -0.03, 0.02]} castShadow>
          <capsuleGeometry args={[0.016, 0.08, 6, 14]} />
          <meshStandardMaterial ref={mat(6)} color={DARK} roughness={0.5} transparent />
        </mesh>
        <mesh position={[0, 0.018, -0.015]} rotation={[0.9, 0, 0]}>
          <torusGeometry args={[0.034, 0.006, 10, 28]} />
          <meshStandardMaterial ref={mat(7)} color={color} roughness={0.4} transparent />
        </mesh>
      </group>
    </group>
  )

  return (
    <group ref={root} name={`avatar ${name}`} visible={false} userData={{ peer: id }}>
      <group ref={head} name="avatar head">
        <mesh castShadow>
          <sphereGeometry args={[0.105, 28, 20]} />
          <meshStandardMaterial ref={mat(0)} color={color} roughness={0.55} transparent />
        </mesh>
        {/* the visor marks which way they look (a camera looks down its −Z) */}
        <mesh position={[0, 0.012, -0.082]} rotation={[0, 0, Math.PI / 2]}>
          <capsuleGeometry args={[0.024, 0.1, 6, 14]} />
          <meshStandardMaterial ref={mat(1)} color={DARK} roughness={0.25} metalness={0.3} transparent />
        </mesh>
        <mesh position={[0, -0.1, 0.01]} scale={[1, 0.6, 1]}>
          <sphereGeometry args={[0.045, 16, 12]} />
          <meshStandardMaterial ref={mat(2)} color={SKIN} roughness={0.7} transparent />
        </mesh>
      </group>
      <mesh ref={plate} name="avatar name" renderOrder={3}>
        <planeGeometry args={[plateTex.aspect * 0.075, 0.075]} />
        <meshBasicMaterial ref={mat(8)} map={plateTex.texture} transparent depthWrite={false} toneMapped={false} />
      </mesh>
      {hand(left, 'avatar left hand')}
      {hand(right, 'avatar right hand')}
    </group>
  )
}
const _cam = new Vector3()

/** A dark pill with the person's colour dot, their name and, smaller, their @handle. System font, nothing downloaded. */
function namePlate(name, handle, color) {
  const H = 96, pad = 28, dot = 22, gap = 14
  const c = document.createElement('canvas').getContext('2d')
  const font = (w, px) => `${w} ${px}px system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif`
  c.font = font(600, 44)
  const nameW = c.measureText(name).width
  c.font = font(500, 30)
  const handleW = handle ? c.measureText('@' + handle).width + gap : 0
  const W = Math.ceil(pad + dot + gap + nameW + handleW + pad)
  const canvas = c.canvas
  canvas.width = W
  canvas.height = H
  const ctx = canvas.getContext('2d')
  ctx.fillStyle = 'rgba(20, 24, 34, 0.82)'
  ctx.beginPath()
  ctx.roundRect(0, 0, W, H, H / 2)
  ctx.fill()
  ctx.fillStyle = color
  ctx.beginPath()
  ctx.arc(pad + dot / 2, H / 2, dot / 2, 0, Math.PI * 2)
  ctx.fill()
  ctx.textBaseline = 'middle'
  ctx.fillStyle = '#f6f7fb'
  ctx.font = font(600, 44)
  ctx.fillText(name, pad + dot + gap, H / 2 + 2)
  if (handle) {
    ctx.fillStyle = '#aab3c5'
    ctx.font = font(500, 30)
    ctx.fillText('@' + handle, pad + dot + gap + nameW + gap, H / 2 + 4)
  }
  const texture = new CanvasTexture(canvas)
  texture.colorSpace = SRGBColorSpace
  texture.minFilter = LinearFilter
  texture.magFilter = LinearFilter
  texture.anisotropy = 8
  return { texture, aspect: W / H }
}
