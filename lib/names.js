// A name and a colour for someone who has not told us theirs. The name is kept per browser tab, so
// two tabs on one computer are two different people.
const ADJECTIVES = ['Quiet', 'Bright', 'Swift', 'Gentle', 'Bold', 'Calm', 'Curious', 'Lucky', 'Merry', 'Keen', 'Steady', 'Sunny']
const ANIMALS = ['Fox', 'Otter', 'Heron', 'Lynx', 'Finch', 'Badger', 'Hare', 'Owl', 'Seal', 'Wren', 'Moth', 'Deer']

/** Twelve colours that read well on skin-coloured and dark avatars and against a light room. */
export const COLORS = ['#ff7a59', '#ffb347', '#f5d547', '#8bd450', '#3ec6a8', '#4cb8ff', '#7a8cff', '#b784f5', '#ff78c8', '#ff5d8f', '#c9a27e', '#9fb3c8']

export const hashString = (s) => { let h = 2166136261; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619) } return h >>> 0 }

export const colorFor = (seed) => COLORS[hashString(String(seed)) % COLORS.length]

export function randomName() {
  const pick = (list) => list[Math.floor(Math.random() * list.length)]
  return `${pick(ADJECTIVES)} ${pick(ANIMALS)}`
}

/** The name for this tab: given once, remembered until the tab closes. */
export function sessionName() {
  try {
    let name = sessionStorage.getItem('graspable-mp-name')
    if (!name) { name = randomName(); sessionStorage.setItem('graspable-mp-name', name) }
    return name
  } catch { return randomName() }
}
