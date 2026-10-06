// A short message to this person inside the headset (on a screen the HTML layer shows it): a line of text
// that floats in front of the head for a few seconds, e.g. when a viewpoint switches "Walk through walls" on.
import { useEffect, useMemo, useRef, useState } from 'react'
import { useFrame } from '@react-three/fiber'
import { Quaternion, Vector3 } from 'three'
import { Label } from './Label'
import { useApp } from '../lib/theatre/app'

const TEXT = {
  airNotice: { cz: 'Tohle místo je ve vzduchu: „Procházet zdmi“ je zapnuté.', en: 'This spot is in mid-air: “Walk through walls” is on.' },
}
const _p = new Vector3(), _q = new Quaternion(), _s = new Vector3()

export function Notice() {
  const notice = useApp((s) => s.notice)
  const xr = useApp((s) => s.xr)
  const lang = useApp((s) => s.lang)
  const [shown, setShown] = useState(null)
  const group = useRef()
  useEffect(() => {
    if (!notice) return
    setShown(notice)
    const t = setTimeout(() => setShown(null), 6000)
    return () => clearTimeout(t)
  }, [notice])
  const text = useMemo(() => (shown ? (TEXT[shown.key]?.[lang] ?? shown[lang] ?? shown.en ?? '') : ''), [shown, lang])
  useFrame((state) => {
    if (!group.current) return
    state.camera.matrixWorld.decompose(_p, _q, _s)
    group.current.position.copy(_p)
    group.current.quaternion.copy(_q)
  })
  if (!xr || !text) return null
  return (
    <group ref={group} name="notice">
      <mesh position={[0, -0.22, -1.2]} renderOrder={9000}>
        <planeGeometry args={[1.02, 0.09]} />
        <meshBasicMaterial color="#000" transparent opacity={0.85} depthTest={false} fog={false} toneMapped={false} />
      </mesh>
      <Label text={text} size={0.034} width={0.96} position={[0, -0.22, -1.199]} renderOrder={9001} />
    </group>
  )
}
