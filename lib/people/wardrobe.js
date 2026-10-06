// The wardrobe: who a person is in the theatre. Eight outfits worn in Prague while the theatre was being
// built (1868 to 1883), four cloth colours for each and four skin tones. The choice is each person's own:
// it is kept on this device (localStorage) and travels to the others as one small number in presence
// (`w`, see packLook), next to the name the multi-user kit already sends.
import { create } from 'zustand'

export const SKINS = ['#f0d3bd', '#dcae8a', '#b47c55', '#7b4f35']

// `height` is the person's own height in metres (hats come on top). `cloth` are the four colours of the
// main garment, first the most usual one.
export const OUTFITS = [
  { id: 'gentleman', cz: 'Pán v redingotu', en: 'Gentleman in a frock coat', height: 1.77, cloth: ['#1b1b1f', '#33343b', '#1c2742', '#33261f'] },
  { id: 'burgher', cz: 'Měšťan v čamaře', en: 'Burgher in a čamara', height: 1.72, cloth: ['#1d1c1f', '#3a2a20', '#1f2b4a', '#3a3d42'] },
  { id: 'lady', cz: 'Dáma s turnýrou', en: 'Lady in a bustle dress', height: 1.63, cloth: ['#701f30', '#1f4f3f', '#2a4877', '#553060'] },
  { id: 'girl', cz: 'Dívka v denních šatech', en: 'Young woman in a day dress', height: 1.61, cloth: ['#6f8fb3', '#8ba27c', '#c98a90', '#d6bd78'] },
  { id: 'mason', cz: 'Kameník ze stavby', en: 'Stonemason from the site', height: 1.74, cloth: ['#5d4833', '#565b60', '#585b3c', '#7c4b31'] },
  { id: 'carpenter', cz: 'Tesař', en: 'Carpenter', height: 1.76, cloth: ['#5c4a39', '#3f4b5a', '#4c513c', '#302d2c'] },
  { id: 'sokol', cz: 'Sokol', en: 'Sokol member', height: 1.79, cloth: ['#b8a888', '#a39a86', '#9c8463', '#c6b896'] },
  { id: 'painter', cz: 'Malíř generace Národního divadla', en: 'Painter of the National Theatre generation', height: 1.73, cloth: ['#3e2a22', '#24392d', '#4d1f29', '#242b47'] },
]

/** The words both interfaces use (the HTML panel and the tab in the headset menu). */
export const WARDROBE_TEXT = {
  cz: {
    wardrobe: 'Šatník', outfit: 'Oděv', cloth: 'Látka', skin: 'Pleť', plateName: 'Jméno na štítku', mirror: 'Zrcadlo',
    showMe: 'Ukázat mě', showMeTitle: 'Na chvíli vás ukáže zepředu (klávesa M).', wardrobeYears: 'Praha 1868–1883',
    keyDone: 'Hotovo', keyDelete: 'Smazat', keySpace: 'Mezera', namePlaceholder: 'Vaše jméno',
  },
  en: {
    wardrobe: 'Wardrobe', outfit: 'Outfit', cloth: 'Cloth', skin: 'Skin', plateName: 'Name on the plate', mirror: 'Mirror',
    showMe: 'Show me', showMeTitle: 'Shows you from the front for a moment (the M key).', wardrobeYears: 'Prague 1868–1883',
    keyDone: 'Done', keyDelete: 'Delete', keySpace: 'Space', namePlaceholder: 'Your name',
  },
}

export const NAME_MAX = 20
const clampInt = (v, n) => { const i = Math.floor(Number(v)); return Number.isFinite(i) ? ((i % n) + n) % n : 0 }
export const cleanLook = (l) => ({ outfit: clampInt(l?.outfit, OUTFITS.length), cloth: clampInt(l?.cloth, 4), skin: clampInt(l?.skin, SKINS.length) })

/** Outfit, cloth and skin as one number below 256: what is sent to the others. */
export const packLook = (l) => l.outfit + l.cloth * 16 + l.skin * 64
export const unpackLook = (w) => cleanLook({ outfit: w & 15, cloth: (w >> 4) & 3, skin: (w >> 6) & 3 })
/** Someone who has not said what they wear (an older page): always the same for the same person. */
export const lookOf = (w, id) => (Number.isInteger(w) ? unpackLook(w) : cleanLook({ outfit: id % 8, cloth: (id >> 3) % 4, skin: (id >> 5) % 4 }))

const KEY = 'nd-wardrobe'
const pick = (n) => Math.floor(Math.random() * n)
function remembered() {
  try {
    const saved = JSON.parse(localStorage.getItem(KEY))
    if (saved && typeof saved === 'object') return { ...cleanLook(saved), name: typeof saved.name === 'string' ? saved.name.slice(0, NAME_MAX) : '' }
  } catch {}
  return null
}
const remember = (look) => { try { localStorage.setItem(KEY, JSON.stringify(look)) } catch {} }

/** This person's choice: { outfit, cloth, skin, name }. An empty name means the kit's own (a random one per tab). */
export const useWardrobe = create(() => {
  const saved = remembered()
  if (saved) return saved
  // a newcomer: a street of 1880, not a row of copies
  const fresh = { outfit: pick(OUTFITS.length), cloth: pick(4), skin: pick(SKINS.length), name: '' }
  remember(fresh)
  return fresh
})

export function setLook(patch) {
  const next = { ...useWardrobe.getState(), ...patch }
  const look = { ...cleanLook(next), name: String(next.name ?? '').slice(0, NAME_MAX) }
  useWardrobe.setState(look)
  remember(look)
}
