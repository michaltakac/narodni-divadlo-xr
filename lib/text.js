// Text for the scene: drawn once into a canvas, shown on a plane (see components/Label.jsx).
// The system font is used, so nothing is downloaded.
import { CanvasTexture, LinearFilter, LinearMipmapLinearFilter, SRGBColorSpace } from 'three'

export const FONT = "system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif"
const EM = 96 // canvas pixels per em
export const LINE = 1.3 // line height in em

let ctx
const context = (weight) => {
  ctx ??= document.createElement('canvas').getContext('2d')
  ctx.font = `${weight} ${EM}px ${FONT}`
  return ctx
}

/** Width in metres of `text` set at `size` metres (the font size, one em). */
export const textWidth = (text, size, weight = 500) => (context(weight).measureText(String(text)).width / EM) * size

/** A white-on-transparent texture of one line of text; tint it with the material's colour. */
export function textTexture(text, weight = 500) {
  const pad = EM * 0.1
  const canvas = document.createElement('canvas')
  canvas.width = Math.max(2, Math.ceil(context(weight).measureText(text).width + pad * 2))
  canvas.height = Math.ceil(EM * LINE)
  const c = canvas.getContext('2d')
  c.font = `${weight} ${EM}px ${FONT}`
  c.textBaseline = 'middle'
  c.fillStyle = '#fff'
  c.fillText(text, pad, canvas.height / 2 + EM * 0.04)
  const texture = new CanvasTexture(canvas)
  texture.colorSpace = SRGBColorSpace
  texture.minFilter = LinearMipmapLinearFilter
  texture.magFilter = LinearFilter
  texture.anisotropy = 8
  return { texture, aspect: canvas.width / canvas.height }
}
