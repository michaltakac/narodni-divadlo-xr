// One line of text in the scene. `size` is the font size in metres.
// Readable sizes: about 0.02 at arm's length, 0.05 or more for something 2 m away.
import { useEffect, useMemo } from 'react'
import { LINE, textTexture } from '../lib/text'

export function Label({ text, size = 0.03, color = '#f4f6fb', weight = 500, width, name, ...props }) {
  const str = String(text)
  const { texture, aspect } = useMemo(() => textTexture(str, weight), [str, weight])
  useEffect(() => () => texture.dispose(), [texture])
  let h = size * LINE, w = h * aspect
  if (width && w > width) { h *= width / w; w = width } // too long for its box: shrink to fit
  return (
    <mesh name={name ?? `label ${str}`} renderOrder={2} {...props}>
      <planeGeometry args={[w, h]} />
      <meshBasicMaterial map={texture} color={color} transparent depthWrite={false} toneMapped={false} />
    </mesh>
  )
}
