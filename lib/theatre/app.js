// What the parts of the app share outside React: the theatre once it is built, where this person stands,
// and the few flags the HTML interface and the scene both need. Nothing in here is sent to other people.
import { create } from 'zustand'
import { Vector3 } from 'three'
import { VIEWPOINTS } from './model.js'
import { bToWorld } from '../nd/config.js'
import { SPAWNS } from '../spawn.js'

const stored = (key) => { try { return localStorage.getItem(key) } catch { return null } }

export const useApp = create(() => ({
  theatre: null,     // set when the model is built
  director: null,    // the shared state and its actions (lib/theatre/director.js)
  view: null,        // { camera, canvas } of the 3D view, for the HTML markers
  summary: '',       // the shared state in words (the name of a scene object, for tests)
  progress: 0,       // 0…1 while it builds
  error: null,
  noclip: false,     // "Walk through walls": this person only
  xr: false,         // a headset session is running
  perf: typeof location !== 'undefined' && new URLSearchParams(location.search).has('perf'), // the P readout
  notice: null,      // { text, id }: a short message to this person (also shown in the headset)
  // what the menu in the headset shows (components/XRMenu.jsx); the HTML interface keeps these in its own buttons
  lang: 'cz',        // this person's language
  input: null,       // the state everyone shares, as it is now (a new object whenever an entry changes)
  stage: 7,          // the stage the build clock is in
  playing: false,    // the build clock runs
  place: null,       // the viewpoint this person was last taken to, until they walk on
  menuHand: 'left',  // the hand that carries the menu in the headset; the other one points, turns and teleports
  teleportOnly: stored('nd-teleport-only') === '1', // no walking with the thumbstick in the headset (it makes some people queasy)
  xrInput: 'controllers', // what the person holds in the headset right now: 'controllers' or 'hands' (bare)
  // the wardrobe (lib/people): what this person wears is in useWardrobe; these are only what is open
  wardrobe: false,   // the wardrobe panel on a computer
  mirror: false,     // this person's own mirror stands in front of them
  showMe: 0,         // counts the times they asked to be shown from the front (M)
}))

export const EYE = 1.65 // eye height on a computer, metres

/** This person: where their feet are and where they look (yaw about y, pitch up and down, radians). */
export const player = {
  feet: new Vector3(...SPAWNS[0].position),
  yaw: SPAWNS[0].yaw,
  pitch: SPAWNS[0].pitch,
  slot: 0,
  moved: false,   // has walked or been taken somewhere since the start
  request: null,  // a move the walking code carries out on its next frame: { eye | feet | at, yaw, pitch, air, noclip }
                  // (`at`: the feet exactly there, a teleport; `feet`: on the ground under that point)
}

/** The teleport arc (components/Teleport.jsx): while it is out, the stick that turns in steps turns its arrow instead. */
export const aim = { on: false, stick: false }
/** When a pointer of each hand was last on something to press (the menu, its keys, a hotspot): that hand is busy. */
export const busy = { left: 0, right: 0 }
export const isBusy = (hand, now = performance.now()) => now - busy[hand] < 300
/** "Teleport only": remembered on this device. */
export const setTeleportOnly = (on) => { try { localStorage.setItem('nd-teleport-only', on ? '1' : '0') } catch {} useApp.setState({ teleportOnly: !!on }) }

/** What a touch screen asks for (components/Touch.jsx): the thumb stick and the two buttons for up and down. */
export const touch = { ahead: 0, side: 0, rise: 0 }

const coarse = typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches
const query = new URLSearchParams(globalThis.location?.search ?? '')
/** A phone or a tablet: it gets the thumb stick and the headset's lighter drawing. `?touch` tries it on a computer. */
export const TOUCH = coarse || query.has('touch')
/** The headset's drawing (merged pieces, no glow pass) outside a headset: on phones, and with `?merge` on a computer. */
export const LIGHT = TOUCH || query.has('merge')

/** Things the walking code tells the interface. */
export const hooks = { moved: null }

let notices = 0
/** A short message to this person: a key of the interface texts ({ key }) or { cz, en }. */
export const say = (notice) => useApp.setState({ notice: notice ? { ...notice, id: ++notices } : null })
let automatic = false
/** "Walk through walls" on or off. `byViewpoint`: switched on because a viewpoint is in mid-air, not by the person. */
export const setNoclip = (on, byViewpoint = false) => { automatic = !!on && byViewpoint; useApp.setState({ noclip: !!on }) }
/** Was it a viewpoint that switched it on? Then the next place with a floor switches it off again. */
export const noclipIsAutomatic = () => automatic

/** Take this person to one of the eight viewpoints: they arrive there looking the way his camera looked. */
export function goToViewpoint(id) {
  const vp = VIEWPOINTS.find((v) => v.id === id)
  if (!vp) return false
  const eye = bToWorld(...vp.pos)
  const d = bToWorld(...vp.tgt).sub(eye)
  player.request = { eye, yaw: Math.atan2(-d.x, -d.z), pitch: Math.atan2(d.y, Math.hypot(d.x, d.z)), air: !!vp.air, name: vp }
  useApp.setState({ place: id })
  return true
}

/** Back to the start on Národní street, on foot. */
export function backToStreet() {
  const s = SPAWNS[player.slot] ?? SPAWNS[0]
  player.request = { feet: new Vector3(...s.position), yaw: s.yaw, pitch: s.pitch, noclip: false, street: true }
  useApp.setState({ place: null })
}

/** This person's language, from the menu in the headset: his HTML interface switches with it. */
export function setLang(lang) {
  const { director, theatre } = useApp.getState()
  if (director?.ui) director.ui.setLang(lang) // tells us back through actions.langChanged
  else { if (theatre) theatre.state.lang = lang; useApp.setState({ lang }) }
}
