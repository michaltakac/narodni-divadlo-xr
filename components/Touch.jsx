// Walking on a touch screen (phones and tablets): a thumb stick in the lower left corner walks, dragging
// anywhere else on the picture looks around (that is the same drag as with a mouse, components/Walk.jsx), and
// while "Walk through walls" is on two buttons next to the stick take you up and down.
// The stick sits above whatever the interface has at the lower edge just then (the timeline, the stage card,
// the panel on a phone), so neither covers the other.
import { useEffect, useRef, useState } from 'react'
import { TOUCH, touch, useApp } from '../lib/theatre/app'

const REACH = 40 // how far the knob travels from the middle, pixels
const DEAD = 0.14
const SIZE = 112 // the stick's diameter (App.css)

export function Touch() {
  const [on, setOn] = useState(TOUCH)
  const xr = useApp((s) => s.xr)
  const noclip = useApp((s) => s.noclip)
  const ready = useApp((s) => !!s.theatre)
  const knob = useRef()
  const held = useRef(null) // the finger on the stick

  // a computer with a touch screen: the stick appears with the first touch
  useEffect(() => {
    if (on) return
    const first = (e) => { if (e.pointerType === 'touch') setOn(true) }
    window.addEventListener('pointerdown', first, true)
    return () => window.removeEventListener('pointerdown', first, true)
  }, [on])

  // above the interface's lower edge, wherever that is now
  useEffect(() => {
    if (!on) return
    const root = document.documentElement
    const box = (q) => {
      const el = document.querySelector(`#nd-ui ${q}`)
      const r = el?.getBoundingClientRect()
      return r && r.width > 2 && r.height > 2 && getComputedStyle(el).visibility !== 'hidden' ? r : null
    }
    const place = () => {
      const w = window.innerWidth, h = window.innerHeight
      const line = box('.timeline') ?? box('.tl-show') // the timeline, or the tab it folds into
      let bottom = h - (line?.top ?? h) + 10, left = 16
      // a card in the lower left corner (the stage card, the fire card, the panel on a phone): above it, or on a
      // screen too low for that (a phone held sideways) to the right of it
      let cardTop = h, cardRight = 0
      for (const q of ['.stagecard', '.firecard', '.side']) {
        const r = box(q)
        if (!r || r.left > SIZE + 90 || r.bottom < h * 0.5) continue
        cardTop = Math.min(cardTop, r.top); cardRight = Math.max(cardRight, r.right)
      }
      if (cardTop < h) {
        if (cardTop - 10 - SIZE >= 110) bottom = h - cardTop + 10
        else if (cardRight + 10 + SIZE + 70 <= w) left = cardRight + 10
      }
      root.style.setProperty('--touch-left', `${Math.round(left)}px`)
      root.style.setProperty('--touch-bottom', `${Math.round(bottom)}px`)
      root.style.setProperty('--touch-top', `${Math.round(bottom + SIZE + 10)}px`)
    }
    place()
    const timer = setInterval(place, 250) // his cards open, close and change height by themselves
    window.addEventListener('resize', place)
    return () => {
      clearInterval(timer)
      window.removeEventListener('resize', place)
      root.style.removeProperty('--touch-left')
      root.style.removeProperty('--touch-bottom')
      root.style.removeProperty('--touch-top')
    }
  }, [on])

  const release = () => { touch.ahead = touch.side = touch.rise = 0 }
  useEffect(() => release, [])
  useEffect(() => { if (!noclip) touch.rise = 0 }, [noclip])

  if (!on || xr || !ready) return null

  const move = (e) => {
    if (e.pointerId !== held.current) return
    const r = e.currentTarget.getBoundingClientRect()
    let x = (e.clientX - (r.left + r.width / 2)) / REACH, y = (e.clientY - (r.top + r.height / 2)) / REACH
    const len = Math.hypot(x, y)
    if (len > 1) { x /= len; y /= len }
    knob.current.style.transform = `translate(${(x * REACH).toFixed(1)}px, ${(y * REACH).toFixed(1)}px)`
    touch.side = len < DEAD ? 0 : x
    touch.ahead = len < DEAD ? 0 : -y
  }
  const down = (e) => { held.current = e.pointerId; e.currentTarget.setPointerCapture?.(e.pointerId); move(e); e.preventDefault() }
  const up = (e) => {
    if (e.pointerId !== held.current) return
    held.current = null
    touch.ahead = touch.side = 0
    knob.current.style.transform = ''
  }
  const rise = (dir) => ({
    onPointerDown: (e) => { e.currentTarget.setPointerCapture?.(e.pointerId); touch.rise = dir; e.preventDefault() },
    onPointerUp: () => { touch.rise = 0 },
    onPointerCancel: () => { touch.rise = 0 },
    onContextMenu: (e) => e.preventDefault(),
  })

  return (
    <div className="touch">
      <div className="stick" role="application" aria-label="Walk" onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={up} onContextMenu={(e) => e.preventDefault()}>
        <i ref={knob} />
      </div>
      {noclip && (
        <div className="rise">
          <button aria-label="Up" {...rise(1)}>▲</button>
          <button aria-label="Down" {...rise(-1)}>▼</button>
        </div>
      )}
    </div>
  )
}
