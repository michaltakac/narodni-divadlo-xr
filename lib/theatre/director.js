// Keeping everyone in step. What the building shows (the build clock and Play, Exterior or X-ray and its
// layers, the section and its sliders, day or night, the fire and the rebuild) lives in one Y.Map of the room's
// document, a handful of small entries that change when someone presses something. Each page turns those
// entries into the same picture by itself (lib/theatre/model.js): the clock and the fire run from the time
// stamp in their entry, so nothing is sent while they animate and someone who joins later lands in step.
//
// The actions have the names of the ones in Lukáš's src/main.js, so his interface (lib/nd/ui.js) drives them.
// Language, viewpoints, open cards and "Walk through walls" are each person's own and never come through here.
import { STAGES } from '../nd/data/content.js'
import { DEFAULT_INPUT, stopOf } from './model.js'
import { goToViewpoint, backToStreet, setNoclip, player, say, useApp } from './app.js'
import { toBuilding, whereIs } from './chunks.js'

const KEYS = Object.keys(DEFAULT_INPUT())
const SLIDER_MS = 120 // a dragged slider writes to the room at most this often

export function createDirector(theatre) {
  let map = null
  let ui = null
  let jumped = false
  const timers = {}
  const waiting = {}

  // one entry changed (here or by someone else): the building and the buttons follow
  const apply = (key, value) => {
    theatre.set(key, value)
    ui?.syncShared(theatre.input)
    useApp.setState({ input: { ...theatre.input } }) // the menu in the headset shows it
  }
  const write = (key, value) => {
    clearTimeout(timers[key]); delete timers[key]; delete waiting[key]
    if (map) map.set(key, value) // the observer below applies it
    else apply(key, value)
  }
  // while a slider is dragged: this page follows at once, the room a few times a second
  const writeSoon = (key, value) => {
    apply(key, value)
    waiting[key] = value
    timers[key] ??= setTimeout(() => { delete timers[key]; if (key in waiting) { const v = waiting[key]; delete waiting[key]; if (map) map.set(key, v) } }, SLIDER_MS)
  }
  const transact = (fn) => (map ? map.doc.transact(fn) : fn())

  const endFire = () => { if (theatre.input.fire.s !== 0) write('fire', { s: 0, at: 0 }) }
  // interiors and stage machinery need the section cut (his stopCut)
  const stopCut = (st) => {
    const cut = theatre.input.cut
    if (st.cut && !cut.on) write('cut', { ...cut, on: true, auto: true })
    else if (!st.cut && cut.auto) write('cut', { ...cut, on: false, auto: false })
  }
  const enterStop = (i) => {
    theatre.state.lastStop = i
    ui?.showStage(i)
    stopCut(STAGES[i])
  }
  theatre.onStage = (i) => ui?.showStage(i)
  theatre.onStop = stopCut

  const actions = {
    goStop(i) {
      transact(() => {
        endFire()
        write('clock', { t: STAGES[i].t, play: false, at: 0, snap: false })
        enterStop(i)
      })
    },
    scrub(T) {
      endFire()
      theatre.state.T = T
      writeSoon('clock', { t: T, play: false, at: 0, snap: true })
    },
    play() {
      const { state } = theatre
      if (state.playing) { write('clock', { t: state.target, play: false, at: 0, snap: false }); return }
      transact(() => {
        endFire()
        const from = state.T >= 6.99 ? 0 : state.T
        write('clock', { t: from, play: true, at: Date.now(), snap: false, jump: true }) // play on from where the clock is now
        enterStop(stopOf(from))
      })
      // nobody is flown around here: from the foot of the façade little of the construction shows, so whoever
      // pressed Play there gets an offer, and stays where they are unless they take it
      const { xr, noclip } = useApp.getState()
      if (!xr && !noclip && player.feet.y < 5 && whereIs(toBuilding(player.feet)) === 'out') say({ key: 'watchRiver', action: () => ui?.goView('v-river') })
    },
    setXray(on) { write('xray', !!on) },
    setLayers(set) { write('layers', [...set]) },
    setCut(on) { write('cut', { ...theatre.input.cut, on: !!on, auto: false }) },
    setCutValues(u, y) { writeSoon('cut', { ...theatre.input.cut, u, y }) },
    setNight(on) { write('night', !!on) },
    fire(on) {
      if (!on) { write('fire', { s: 0, at: 0 }); return }
      // the theatre burned complete, two months after its first opening: no scaffolding, all interiors, no section
      transact(() => {
        write('clock', { t: 7, play: false, at: 0, snap: false, jump: true })
        write('cut', { ...theatre.input.cut, on: false, auto: false })
        write('fire', { s: 1, at: Date.now() })
      })
    },
    rebuild() { write('fire', { s: 2, at: Date.now() }) },
    // each person's own
    viewpoint(id) { goToViewpoint(id) },
    backToStreet,
    setNoclip,
    setWardrobe(on) { useApp.setState({ wardrobe: !!on }) },
    langChanged(lang) { useApp.setState({ lang }) },
  }
  useApp.setState({ input: { ...theatre.input } })

  return {
    actions,
    theatre,
    setUI(next) { ui = next; ui?.syncShared(theatre.input); ui?.showStage(theatre.state.lastStop) },

    /** Connect to the room's document. Returns the function that disconnects again. */
    attach(doc) {
      const m = doc.getMap('theatre')
      const take = (keys, remote) => {
        for (const key of keys) if (KEYS.includes(key) && m.has(key) && !(key in waiting && !remote)) apply(key, m.get(key))
      }
      const observer = (e) => {
        take(e.keysChanged, !e.transaction.local)
        if (!e.transaction.local && !jumped) this.arrive()
      }
      m.observe(observer)
      map = m
      take(KEYS, true) // what the document already holds
      return () => { m.unobserve(observer); if (map === m) map = null }
    },

    /** The room's state has arrived for the first time: show it as it is, without replaying the way there. */
    arrive() {
      if (jumped) return
      jumped = true
      theatre.jump()
      // a section that a construction stage had switched on by itself must not outlive that stage (the last
      // person left while it was on, and the room kept it): the stage we arrive in decides
      stopCut(STAGES[theatre.state.lastStop])
      ui?.syncShared(theatre.input)
    },

    dispose() { for (const k of Object.keys(timers)) clearTimeout(timers[k]) },
    /** His interface, once it is mounted. */
    get ui() { return ui },
  }
}
