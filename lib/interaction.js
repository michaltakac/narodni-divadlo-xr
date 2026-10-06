// Shared behaviour of everything you can press, the same for a poking finger, a pinch on a ray, a
// controller trigger and the mouse. Hands, controllers and the mouse all send ordinary pointer events.
import { useRef, useState } from 'react'

/**
 * Put pointerEventsType={POKE} on anything a fingertip should press: a hand has a poke pointer and a grab
 * pointer at the same fingertip, and the grab pointer wins unless the object refuses it. usePress adds it.
 */
export const POKE = { deny: 'grab' }

/**
 * const { hovered, pressed, handlers } = usePress({ onPress })
 * Spread `handlers` on a mesh or group. onPress fires on release while still on the object. Not onClick:
 * clicks are dropped when a press lasts longer than 300 ms, which a slow poke does.
 */
export function usePress({ onPress, onDown, disabled = false } = {}) {
  const [hovered, setHovered] = useState(false)
  const [pressed, setPressed] = useState(false)
  const over = useRef(new Set())
  const by = useRef(null)
  if (disabled) return { hovered: false, pressed: false, handlers: {} }
  const release = (e, fire) => {
    if (by.current !== e.pointerId) return
    by.current = null
    setPressed(false)
    if (fire) onPress?.(e)
  }
  const handlers = {
    pointerEventsType: POKE,
    onPointerEnter: (e) => { over.current.add(e.pointerId); setHovered(true) },
    // A ray or the mouse that slides off cancels the press; a finger that pulls away has pressed.
    onPointerLeave: (e) => { over.current.delete(e.pointerId); setHovered(over.current.size > 0); release(e, e.pointerType === 'touch') },
    onPointerDown: (e) => { e.stopPropagation(); by.current = e.pointerId; setPressed(true); pulse(e); onDown?.(e) },
    onPointerUp: (e) => release(e, true),
  }
  return { hovered, pressed, handlers }
}

/** A short buzz on the controller that caused pointer event `e` (hands have no motor). */
export function pulse(e, strength = 0.5, ms = 15) {
  try { e?.nativeEvent?.inputSource?.gamepad?.hapticActuators?.[0]?.pulse(strength, ms) } catch {}
}

export const clamp = (v, min = 0, max = 1) => Math.min(max, Math.max(min, v))
/** Frame-rate independent easing towards a target: value = ease(value, target, delta). */
export const ease = (value, target, delta, speed = 18) => value + (target - value) * (1 - Math.exp(-speed * delta))
