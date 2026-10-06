// The look of Lukáš Eršil's interface (lib/nd/ui.css) for panels that stand in the scene, built with
// @react-three/uikit: black panels, white type, one yellow accent for what is active, square corners,
// Bebas Neue for headings and DM Sans for text. Used by the menu on the hand (XRMenu.jsx) and by the hotspot
// cards (XRHotspots.jsx).
//
// Sizes are in millimetres (ROOT.pixelSize): a panel read from 45 cm has no text smaller than SMALL = 10, whose
// capital letters are 7 mm tall, 1.5 % of that distance.
// The fonts are multi-channel distance fields made from the TTF files (public/fonts, see NOTICE.md), so nothing
// is downloaded from elsewhere. A panel is a handful of draw calls whatever it holds: uikit draws all boxes of
// a panel as one instanced mesh and all letters of one font as another, and only touches them when they change.
import { useRef, useState } from 'react'
import { Container, Text } from '@react-three/uikit'
import { Vector3 } from 'three'
import { POKE, clamp, pulse, usePress } from '../lib/interaction'

export const C = {
  bg: '#000000', raised: '#1a1a1a', line: '#333333', lineHi: '#666666',
  fg: '#ffffff', fg2: '#cccccc', muted: '#999999',
  accent: '#ffe600', accentHover: '#f5c400', onAccent: '#000000',
  danger: '#c8102e', dangerSoft: '#30040b',
}
export const FONTS = {
  dm: { medium: 'fonts/dm-sans-500.json', bold: 'fonts/dm-sans-700.json' },
  bebas: { normal: 'fonts/bebas-neue.json' },
}
export const SMALL = 10, UI = 11, TITLE = 22
/** How tall a capital letter is, as a part of the font size (both fonts). */
export const CAP_HEIGHT = 0.7
/**
 * Props of the outermost Container of a panel. It takes pointers itself (so a ray does not go through it to what
 * is behind) but no grabs: a controller held close to a panel would otherwise grab at it, and a grabbing hand
 * has no ray and no fingertip.
 */
export const ROOT = { pixelSize: 0.001, fontFamilies: FONTS, fontFamily: 'dm', fontWeight: 'medium', fontSize: UI, lineHeight: '130%', color: C.fg, pointerEvents: 'auto', pointerEventsType: POKE }

export const upper = (text, lang) => String(text).toLocaleUpperCase(lang === 'cz' ? 'cs' : 'en')

/** Small capitals with the yellow square of the brand. */
export function Eyebrow({ children, lang, color = C.accent, ...props }) {
  return (
    <Container flexDirection="row" alignItems="center" gap={8} flexShrink={0} {...props}>
      <Container width={6} height={6} backgroundColor={color} flexShrink={0} />
      <Text fontSize={SMALL} fontWeight="bold" letterSpacing={1.6} color={color} flexShrink={0}>{upper(children, lang)}</Text>
    </Container>
  )
}

export function Title({ children, lang, size = TITLE, ...props }) {
  return <Text fontFamily="bebas" fontWeight="normal" fontSize={size} lineHeight="105%" letterSpacing={0.2} flexShrink={0} {...props}>{upper(children, lang)}</Text>
}

export function Para({ children, ...props }) {
  return <Text fontSize={UI} lineHeight="150%" color={C.fg2} flexShrink={0} {...props}>{children}</Text>
}

// [background, border, text] at rest, under a pointer, and switched on
const KINDS = {
  chip: { rest: [C.bg, C.line, C.fg2], over: [C.bg, C.lineHi, C.fg], on: [C.accent, C.accent, C.onAccent] },
  seg: { rest: [C.bg, C.bg, C.fg2], over: [C.raised, C.raised, C.fg], on: [C.accent, C.accent, C.onAccent] },
  view: { rest: [C.raised, C.line, C.fg2], over: [C.raised, C.lineHi, C.fg], on: [C.accent, C.accent, C.onAccent] },
  cta: { rest: [C.accent, C.accent, C.onAccent], over: [C.accentHover, C.accentHover, C.onAccent], on: [C.accent, C.accent, C.onAccent] },
  fire: { rest: [C.bg, C.danger, C.fg], over: [C.dangerSoft, C.danger, C.fg], on: [C.danger, C.danger, C.fg] },
  ghost: { rest: [C.bg, C.bg, C.muted], over: [C.raised, C.raised, C.fg], on: [C.bg, C.bg, C.fg] },
}

/**
 * Something to press: with a controller's ray and trigger, a pinch from afar, or the tip of the index finger.
 * `on` shows it switched on (the yellow of his aria-pressed). A string child becomes its label.
 */
export function Btn({ kind = 'chip', on = false, onPress, children, bold = false, size = UI, ...props }) {
  const { hovered, pressed, handlers } = usePress({ onPress })
  const [bg, border, fg] = KINDS[kind][on ? 'on' : hovered ? 'over' : 'rest']
  return (
    <Container
      height={28} paddingX={10} flexDirection="row" alignItems="center" justifyContent="center" gap={8} flexShrink={0}
      backgroundColor={bg} borderWidth={1} borderColor={pressed ? C.fg : border} color={fg}
      fontSize={size} fontWeight={bold || kind === 'cta' ? 'bold' : 'medium'} {...handlers} {...props}
    >
      {typeof children === 'string' ? <Text>{children}</Text> : children}
    </Container>
  )
}

/** His segmented control: a frame with two or more Btn kind="seg" inside. */
export function Seg({ children, ...props }) {
  return <Container flexDirection="row" height={34} padding={3} gap={2} backgroundColor={C.bg} borderWidth={1} borderColor={C.line} flexShrink={0} {...props}>{children}</Container>
}

const _p = new Vector3()
const EDGE = 9 // the rail starts and ends this far inside the strip you can grab

/**
 * A slider with its name and its value above it. The whole strip, 3 cm tall, takes the ray or the fingertip:
 * press anywhere on it and drag. While it is dragged the value is yellow and the knob follows the pointer even
 * when it leaves the strip.
 * `marks`: places (0…1) of small ticks on the rail.
 */
export function Slider({ label, text, min, max, step = 0.1, value, onChange, marks, ...props }) {
  const strip = useRef()
  const drag = useRef(null)
  const [held, setHeld] = useState(false)
  const [hovered, setHovered] = useState(false)
  const at = (e) => {
    const width = strip.current.size.peek()?.[0] ?? 1
    // a captured ray reports `point` at the distance it had when it was pressed (on a sphere about the hand);
    // where the ray meets the panel's plane is `pointOnFace`
    const x = (strip.current.worldToLocal(_p.copy(e.pointOnFace ?? e.point)).x + 0.5) * width
    const v = min + clamp((x - EDGE) / (width - EDGE * 2)) * (max - min)
    return clamp(+(Math.round(v / step) * step).toFixed(4), min, max)
  }
  const end = (e) => {
    if (drag.current !== e.pointerId) return
    drag.current = null
    strip.current?.releasePointerCapture?.(e.pointerId)
    setHeld(false)
  }
  const k = clamp((value - min) / (max - min))
  const pct = `${(k * 100).toFixed(2)}%`
  return (
    <Container flexDirection="column" flexShrink={0} {...props}>
      <Container flexDirection="row" justifyContent="space-between" alignItems="center" gap={8} paddingX={EDGE}>
        <Text fontSize={SMALL} color={C.fg2}>{label}</Text>
        <Text fontSize={SMALL} fontWeight={held ? 'bold' : 'medium'} color={held ? C.accent : C.fg}>{text}</Text>
      </Container>
      <Container
        ref={strip} height={30} paddingX={EDGE} flexDirection="row" alignItems="center" pointerEventsType={POKE}
        backgroundColor={hovered || held ? C.raised : C.bg}
        onPointerEnter={() => setHovered(true)}
        onPointerDown={(e) => { e.stopPropagation(); drag.current = e.pointerId; strip.current.setPointerCapture?.(e.pointerId); setHeld(true); pulse(e); onChange(at(e)) }}
        onPointerMove={(e) => { if (drag.current === e.pointerId) onChange(at(e)) }}
        onPointerUp={end} onPointerCancel={end}
        onPointerLeave={(e) => { setHovered(false); end(e) }}
      >
        <Container flexGrow={1} height={4} backgroundColor={C.line} pointerEvents="none">
          <Container positionType="absolute" positionLeft={0} positionTop={0} height={4} width={pct} backgroundColor={C.accent} pointerEvents="none" />
          {marks?.map((m, i) => (
            <Container key={i} positionType="absolute" positionLeft={`${m * 100}%`} positionTop={-3} marginLeft={-1} width={2} height={10} backgroundColor={m <= k + 1e-4 ? C.accent : C.lineHi} pointerEvents="none" />
          ))}
          <Container positionType="absolute" positionLeft={pct} positionTop={-10} marginLeft={-7} width={14} height={24} backgroundColor={held ? C.accent : C.fg} borderWidth={1} borderColor={C.bg} pointerEvents="none" />
        </Container>
      </Container>
    </Container>
  )
}
