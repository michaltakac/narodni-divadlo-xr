// What you see of your own hands and controllers, and the pointers you act with. Passed to
// createXRStore({ hand: Hand, controller: Controller }) in App.jsx. Both are built from simple shapes
// here, so nothing is downloaded. Other people see you through components/Avatar.jsx instead.
//
// Pointers (from @react-three/xr; they send ordinary pointer events to meshes):
//   hand        poke (fingertip, pointerType 'touch'), grab (pinch at an object, 'grab'), ray (pinch from afar, 'ray')
//   controller  ray + trigger, grab + squeeze
import { useMemo, useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import { DefaultXRController, DefaultXRHand, XRSpace, useXRInputSourceStateContext, useXRSpace } from '@react-three/xr'
import { Matrix4, Object3D, Vector3 } from 'three'
import { handColor } from '../lib/people/figure'
import { useWardrobe } from '../lib/people/wardrobe'

const ACCENT = '#4cb8ff'
const KNOB = '#dfe6f1'

export function Hand() {
  return (
    <>
      <HandModel />
      <DefaultXRHand
        model={false}
        touchPointer={{ hoverRadius: 0.05, downRadius: 0.012, cursorModel: { color: ACCENT } }}
        grabPointer={{ radius: 0.07, cursorModel: { color: ACCENT } }}
        rayPointer={{ minDistance: 0.25, rayModel: { color: KNOB, maxLength: 0.25 }, cursorModel: { color: ACCENT } }}
      />
    </>
  )
}

export function Controller() {
  return (
    <>
      <XRSpace space="grip-space">
        <group name="controller" rotation={[-0.6, 0, 0]}>
          <mesh position={[0, -0.03, 0.02]} castShadow>
            <capsuleGeometry args={[0.018, 0.085, 6, 16]} />
            <meshStandardMaterial color={KNOB} roughness={0.5} />
          </mesh>
          <mesh position={[0, 0.018, -0.015]} rotation={[0.9, 0, 0]}>
            <torusGeometry args={[0.038, 0.006, 10, 32]} />
            <meshStandardMaterial color="#1b2030" roughness={0.4} />
          </mesh>
        </group>
      </XRSpace>
      <DefaultXRController model={false} rayPointer={{ rayModel: { color: KNOB }, cursorModel: { color: ACCENT } }} grabPointer={{ radius: 0.07, cursorModel: { color: ACCENT } }} />
    </>
  )
}

// The 25 WebXR hand joints in their fixed order: wrist, then 4 thumb joints, then 5 for each finger.
const RADIUS = [0.019, 0.016, 0.012, 0.0105, 0.009, ...[0, 1, 2, 3].flatMap((f) => [0.013, 0.0105 - f * 0.0005, 0.0092 - f * 0.0005, 0.0084 - f * 0.0005, 0.0076 - f * 0.0005])]
const BONES = [
  [0, 1], [1, 2], [2, 3], [3, 4],
  ...[5, 10, 15, 20].flatMap((m) => [[0, m], [m, m + 1], [m + 1, m + 2], [m + 2, m + 3], [m + 3, m + 4]]),
  [2, 6], [6, 11], [11, 16], [16, 21], [5, 10], [10, 15], [15, 20], // the palm
]
const UP = new Vector3(0, 1, 0)

function HandModel() {
  const state = useXRInputSourceStateContext('hand')
  const space = useXRSpace() // the hand's own space: joints are read relative to it
  const joints = useRef()
  const bones = useRef()
  const tmp = useMemo(() => ({ poses: new Float32Array(25 * 16), points: RADIUS.map(() => new Vector3()), object: new Object3D(), dir: new Vector3(), matrix: new Matrix4() }), [])
  useFrame((_, __, frame) => {
    const hand = state.inputSource.hand
    const ok = frame != null && space != null && frame.fillPoses(hand.values(), space, tmp.poses)
    joints.current.visible = bones.current.visible = !!ok
    if (!ok) return
    const { points, object, dir } = tmp
    points.forEach((p, i) => {
      p.setFromMatrixPosition(tmp.matrix.fromArray(tmp.poses, i * 16))
      object.position.copy(p)
      object.quaternion.identity()
      object.scale.setScalar(RADIUS[i])
      object.updateMatrix()
      joints.current.setMatrixAt(i, object.matrix)
    })
    BONES.forEach(([a, b], i) => {
      dir.subVectors(points[b], points[a])
      const length = dir.length() || 0.0001
      object.position.addVectors(points[a], points[b]).multiplyScalar(0.5)
      object.quaternion.setFromUnitVectors(UP, dir.divideScalar(length))
      const r = Math.min(RADIUS[a], RADIUS[b])
      object.scale.set(r, length, r)
      object.updateMatrix()
      bones.current.setMatrixAt(i, object.matrix)
    })
    joints.current.instanceMatrix.needsUpdate = bones.current.instanceMatrix.needsUpdate = true
  })
  // the hands of the figure this person is (lib/people): their skin tone, or the lady's gloves
  const color = useWardrobe((s) => handColor(s))
  const material = <meshStandardMaterial color={color} roughness={0.6} />
  return (
    <group name={`hand ${state.inputSource.handedness}`}>
      <instancedMesh ref={joints} args={[null, null, RADIUS.length]} frustumCulled={false} castShadow visible={false}>
        <sphereGeometry args={[1, 16, 12]} />
        {material}
      </instancedMesh>
      <instancedMesh ref={bones} args={[null, null, BONES.length]} frustumCulled={false} castShadow visible={false}>
        <cylinderGeometry args={[1, 1, 1, 12, 1, true]} />
        {material}
      </instancedMesh>
    </group>
  )
}
