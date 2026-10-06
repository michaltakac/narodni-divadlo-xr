// The numbered hotspots inside the headset: small round markers standing in the building where they belong,
// always turned to you, the same ones the current stage or X-ray layer shows on the computer (one rule for
// both, lib/nd/ui.js). Point at one and press the trigger, pinch at it from afar, or touch it: its card opens
// beside it, facing you. One card at a time; it is this person's own, like the card on the computer.
//
// A marker far away would be a dot, so markers and the card keep their size in your view: a marker is 4 % of
// its distance across (its number 1.7 %), and the card is as large as a panel read from 45 cm.
// All markers are one instanced mesh with one picture of every marker (one draw call); they ignore depth, like
// the HTML markers that lie over the picture.
import { useEffect, useMemo, useRef, useState } from 'react'
import { useFrame } from '@react-three/fiber'
import { Container, Image, Text } from '@react-three/uikit'
import { CanvasTexture, InstancedBufferAttribute, LinearFilter, LinearMipmapLinearFilter, Matrix4, MeshBasicMaterial, Object3D, PlaneGeometry, SRGBColorSpace, Vector3 } from 'three'
import { Btn, C, Eyebrow, Para, ROOT, SMALL, Title } from './XRUI'
import { POKE, pulse } from '../lib/interaction'
import { HOTSPOTS, LAYERS, STAGES } from '../lib/nd/data/content.js'
import { hotspotBelongs, hotspotWorld, insideBuilding } from '../lib/nd/ui.js'
import { useApp } from '../lib/theatre/app'

export const MARKER = { size: 0.04, min: 0.035, layer: 0.8 } // across, as a part of the distance; never smaller than `min` metres
export const CARD = { width: 320, reach: 0.45 } // millimetres; the distance (metres) at which it has that size
const COLS = 10, CELL = 96
const ROWS = Math.ceil((HOTSPOTS.length * 2) / COLS)
const ITEMS = HOTSPOTS.map((h, index) => ({ h, index, world: hotspotWorld(h), color: h.layer ? LAYERS.find((l) => l.id === h.layer)?.color : null }))

const UP = new Vector3(0, 1, 0)
const _o = new Object3D(), _m = new Matrix4(), _right = new Vector3()

/** Every marker twice (at rest, and yellow when pointed at or open) in one picture. */
function paint(canvas) {
  const c = canvas.getContext('2d')
  c.clearRect(0, 0, canvas.width, canvas.height)
  c.textAlign = 'center'
  c.textBaseline = 'middle'
  ITEMS.forEach(({ h, index, color }) => {
    for (const active of [0, 1]) {
      const cell = index * 2 + active
      const x = ((cell % COLS) + 0.5) * CELL, y = (Math.floor(cell / COLS) + 0.5) * CELL
      const line = CELL * 0.075
      c.beginPath()
      c.arc(x, y, CELL / 2 - line / 2 - 1, 0, Math.PI * 2)
      c.fillStyle = active ? C.accent : C.bg
      c.fill()
      c.lineWidth = line
      c.strokeStyle = color ?? C.accent
      c.stroke()
      if (h.layer) {
        // his ◆ in the colour of the layer
        const r = CELL * 0.17
        c.beginPath(); c.moveTo(x, y - r); c.lineTo(x + r, y); c.lineTo(x, y + r); c.lineTo(x - r, y); c.closePath()
        c.fillStyle = active ? C.onAccent : color
        c.fill()
      } else {
        c.font = `${CELL * 0.6}px "Bebas Neue XR", "Bebas Neue", Impact, sans-serif`
        c.fillStyle = active ? C.onAccent : C.fg
        c.fillText(String(index + 1), x, y + CELL * 0.045)
      }
    }
  })
}

export function XRHotspots({ theatre }) {
  const lang = useApp((s) => s.lang)
  const [open, setOpen] = useState(null) // the id of the hotspot whose card is open
  const [names, setNames] = useState('')
  const mesh = useRef()
  const run = useRef({ shown: [], hover: null, down: null, open: null, names: '' }).current
  run.open = open

  const { texture, geometry, material, cells } = useMemo(() => {
    const canvas = document.createElement('canvas')
    canvas.width = COLS * CELL; canvas.height = ROWS * CELL
    const texture = new CanvasTexture(canvas)
    texture.colorSpace = SRGBColorSpace
    texture.minFilter = LinearMipmapLinearFilter; texture.magFilter = LinearFilter; texture.anisotropy = 4
    const geometry = new PlaneGeometry(1, 1)
    const cells = new InstancedBufferAttribute(new Float32Array(ITEMS.length * 2), 2)
    geometry.setAttribute('aCell', cells)
    const material = new MeshBasicMaterial({ map: texture, transparent: true, depthTest: false, depthWrite: false, toneMapped: false, fog: false })
    // each instance shows its own cell of the picture
    material.onBeforeCompile = (shader) => {
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', '#include <common>\nattribute vec2 aCell;')
        .replace('#include <uv_vertex>', `#include <uv_vertex>\nvMapUv = (uv + aCell) * vec2(${(1 / COLS).toFixed(6)}, ${(1 / ROWS).toFixed(6)});`)
    }
    return { texture, geometry, material, cells }
  }, [])
  useEffect(() => {
    let alive = true
    const draw = () => { if (alive) { paint(texture.image); texture.needsUpdate = true } }
    draw()
    // his numerals are Bebas Neue: the file comes with the app, so they are the same offline
    const font = new FontFace('Bebas Neue XR', 'url(fonts/bebas-neue.ttf)')
    font.load().then((f) => { document.fonts.add(f); draw() }).catch(() => {})
    return () => { alive = false; texture.dispose(); geometry.dispose(); material.dispose() }
  }, [texture, geometry, material])

  useFrame(() => {
    const m = mesh.current
    const { state: st, eye } = theatre
    const inside = insideBuilding(eye.position)
    let n = 0, names = '', openShown = false
    for (const it of ITEMS) {
      if (!hotspotBelongs(it.h, st, STAGES, st.lastStop, st.T, inside)) continue
      const size = Math.max(MARKER.min, eye.position.distanceTo(it.world) * MARKER.size) * (it.h.layer ? MARKER.layer : 1)
      _o.position.copy(it.world)
      _o.quaternion.copy(eye.quaternion)
      _o.scale.setScalar(size)
      _o.updateMatrix()
      m.setMatrixAt(n, _o.matrix)
      const active = it.h.id === run.open || it.h.id === run.hover
      if (it.h.id === run.open) openShown = true
      const cell = it.index * 2 + (active ? 1 : 0)
      cells.setXY(n, cell % COLS, ROWS - 1 - Math.floor(cell / COLS))
      run.shown[n++] = it
      names += ` ${it.h.id}`
    }
    run.shown.length = n
    m.count = n
    m.visible = n > 0
    m.instanceMatrix.needsUpdate = true
    cells.needsUpdate = true
    m.boundingSphere = null // the markers have moved (they turn with the head): pointers must find them where they are
    // a card whose hotspot no longer belongs to the mode, stop or episode closes with it
    if (run.open && !openShown) { run.open = null; setOpen(null) }
    if (names !== run.names) { run.names = names; setNames(names) }
  })

  const id = (e) => run.shown[e.instanceId]?.h.id ?? null
  const press = (e) => {
    const hit = id(e)
    if (run.down?.pointer !== e.pointerId) return
    const same = run.down.id === hit
    run.down = null
    if (same && hit) setOpen((now) => (now === hit ? null : hit))
  }
  const item = open && ITEMS.find((it) => it.h.id === open)
  return (
    <>
      <instancedMesh
        ref={mesh} args={[geometry, material, ITEMS.length]} name={`hotspots${names}`} frustumCulled={false} renderOrder={10} visible={false}
        pointerEventsType={POKE}
        onPointerMove={(e) => { run.hover = id(e) }}
        onPointerLeave={(e) => { run.hover = null; if (e.pointerType === 'touch') press(e); else if (run.down?.pointer === e.pointerId) run.down = null }}
        onPointerDown={(e) => { e.stopPropagation(); run.down = { pointer: e.pointerId, id: id(e) }; pulse(e) }}
        onPointerUp={press}
      />
      {item && <HotspotCard key={item.h.id} item={item} lang={lang} theatre={theatre} onClose={() => setOpen(null)} />}
    </>
  )
}

function HotspotCard({ item, lang, theatre, onClose }) {
  const group = useRef()
  const { h, world } = item
  const text = h[lang]
  const credit = (lang === 'en' ? h.creditEn : null) ?? h.credit ?? ''
  // beside its marker, facing the person, as large in their view as a panel in the hand
  useFrame(() => {
    const g = group.current
    const eye = theatre.eye
    const d = eye.position.distanceTo(world)
    const scale = Math.max(1, d / CARD.reach)
    const marker = Math.max(MARKER.min, d * MARKER.size)
    g.position.copy(world).addScaledVector(_right.set(1, 0, 0).applyQuaternion(eye.quaternion), marker * 0.5 + 0.012 * scale)
    g.quaternion.setFromRotationMatrix(_m.lookAt(eye.position, g.position, UP))
    g.scale.setScalar(scale)
  })
  return (
    <group ref={group} name={`hotspot card ${h.id}`}>
      <Container
        {...ROOT} depthTest={false} renderOrder={20} anchorX="left" anchorY="center" width={CARD.width}
        flexDirection="column" gap={7} padding={13} backgroundColor={C.bg} borderWidth={1} borderColor={C.line}
      >
        <Eyebrow lang={lang}>{h.year ?? (h.layer ? LAYERS.find((l) => l.id === h.layer)[lang] : '')}</Eyebrow>
        <Title lang={lang} marginRight={26}>{text.title}</Title>
        <Para>{text.text}</Para>
        {h.img && <Image src={`textures/${h.img}.jpg`} width="100%" flexShrink={0} />}
        {h.img && <Text fontSize={SMALL} lineHeight="140%" color={C.muted}>{credit}</Text>}
        <Btn kind="ghost" positionType="absolute" positionTop={4} positionRight={4} width={30} height={30} paddingX={0} size={20} onPress={onClose}>×</Btn>
      </Container>
    </group>
  )
}
