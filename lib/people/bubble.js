// What stands above a person's head while they chat (components/People.jsx): the speech bubble with their last
// message and the three dots of someone who is writing. Both are drawn once into a canvas, like the name plate,
// in the system font: any letter a person can type shows, also ones the headset menu's own font does not have.
import { CanvasTexture, LinearFilter, SRGBColorSpace } from 'three'

/** Metres per canvas pixel at arm's length: the same scale as the name plate (96 px = 75 mm). */
export const BUBBLE_PX = 0.075 / 96
const FONT = (px) => `600 ${px}px system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif`
const SIZE = 44, LINE = 56, PAD = 28, WIDE = 640, TAIL = 16

function wrap(ctx, text, width) {
  const lines = []
  let line = ''
  for (const word of text.split(' ')) {
    let rest = word
    // a word longer than a line is broken where it has to be
    while (ctx.measureText(rest).width > width) {
      let n = rest.length
      while (n > 1 && ctx.measureText(rest.slice(0, n)).width > width) n--
      if (line) { lines.push(line); line = '' }
      lines.push(rest.slice(0, n))
      rest = rest.slice(n)
    }
    const next = line ? `${line} ${rest}` : rest
    if (ctx.measureText(next).width > width && line) { lines.push(line); line = rest } else line = next
  }
  if (line) lines.push(line)
  return lines
}

const finish = (canvas) => {
  const texture = new CanvasTexture(canvas)
  texture.colorSpace = SRGBColorSpace
  texture.minFilter = LinearFilter
  texture.magFilter = LinearFilter
  texture.generateMipmaps = false
  texture.anisotropy = 8
  return texture
}

/** A light bubble with a tail at the lower edge and the text in dark letters; { texture, width, height } in metres. */
export function bubbleTexture(text) {
  const probe = document.createElement('canvas').getContext('2d')
  probe.font = FONT(SIZE)
  const lines = wrap(probe, text, WIDE)
  const inner = Math.max(...lines.map((l) => probe.measureText(l).width), 40)
  const W = Math.ceil(inner + PAD * 2), H = lines.length * LINE + PAD * 2 - (LINE - SIZE) + TAIL
  const canvas = probe.canvas
  canvas.width = W
  canvas.height = H
  const c = canvas.getContext('2d')
  c.fillStyle = 'rgba(246, 241, 228, 0.96)'
  c.beginPath()
  c.roundRect(0, 0, W, H - TAIL, 26)
  c.fill()
  c.beginPath()
  c.moveTo(W / 2 - TAIL, H - TAIL - 1); c.lineTo(W / 2, H); c.lineTo(W / 2 + TAIL, H - TAIL - 1)
  c.fill()
  c.font = FONT(SIZE)
  c.textBaseline = 'middle'
  c.fillStyle = '#14171f'
  lines.forEach((l, i) => c.fillText(l, PAD, PAD + SIZE / 2 + i * LINE + 2))
  return { texture: finish(canvas), width: W * BUBBLE_PX, height: H * BUBBLE_PX }
}

let dots = null
/** Three dots, three times side by side with one dot lit in each: one texture for everyone, stepped by its offset. */
export function dotsTexture() {
  if (dots) return dots
  const W = 150, H = 72
  const canvas = document.createElement('canvas')
  canvas.width = W * 3
  canvas.height = H
  const c = canvas.getContext('2d')
  for (let f = 0; f < 3; f++) {
    c.fillStyle = 'rgba(246, 241, 228, 0.96)'
    c.beginPath()
    c.roundRect(f * W + 4, 4, W - 8, H - 8, (H - 8) / 2)
    c.fill()
    for (let d = 0; d < 3; d++) {
      c.fillStyle = d === f ? '#14171f' : 'rgba(20, 23, 31, 0.35)'
      c.beginPath()
      c.arc(f * W + W / 2 + (d - 1) * 32, H / 2, d === f ? 10 : 8, 0, Math.PI * 2)
      c.fill()
    }
  }
  const texture = finish(canvas)
  texture.repeat.set(1 / 3, 1)
  dots = { texture, width: W * BUBBLE_PX, height: H * BUBBLE_PX }
  return dots
}
