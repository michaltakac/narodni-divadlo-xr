// The controls on a computer: Lukáš Eršil's interface as an HTML layer over the canvas (his toolbar, side
// panel, stage card, timeline, fire card, hotspot markers and cards, About), wanted here on purpose and
// hidden while a headset session runs. His markup and code are in lib/nd (markup.js, ui.js, ui.css); this
// component mounts them once the model is built and adds this version's masthead with the "Enter VR" button.
import { useEffect, useRef } from 'react'
import { MARKUP } from '../lib/nd/markup.js'
import { initUI } from '../lib/nd/ui.js'
import { STAGES, LAYERS } from '../lib/nd/data/content.js'
import { VIEWPOINTS } from '../lib/theatre/model.js'
import { TOUCH, hooks, useApp } from '../lib/theatre/app'
import '../lib/nd/ui.css'

export function Overlay({ onEnterVR }) {
  const host = useRef()
  const theatre = useApp((s) => s.theatre)
  const director = useApp((s) => s.director)
  const view = useApp((s) => s.view)
  const xr = useApp((s) => s.xr)
  const progress = useApp((s) => s.progress)
  const error = useApp((s) => s.error)

  // his markup goes in by hand: his code builds on it with DOM calls, so React must not manage what is inside
  useEffect(() => {
    const el = host.current
    el.innerHTML = MARKUP
    return () => { el.innerHTML = ''; document.body.classList.remove('tl-hidden') }
  }, [])

  // the loading veil shows how far the model is, then fades away (his main.js did this)
  useEffect(() => {
    const bar = host.current.querySelector('#load-bar')
    if (!bar) return
    bar.style.setProperty('--p', progress.toFixed(3))
    bar.setAttribute('aria-valuenow', Math.round(progress * 100))
  }, [progress])
  useEffect(() => {
    if (!error) return
    const el = host.current.querySelector('#load-err')
    if (el) { el.hidden = false; el.textContent = `The model could not start: ${error?.message ?? error}` }
  }, [error])

  useEffect(() => {
    if (!theatre || !director || !view) return
    const abort = new AbortController()
    const lang = useApp.getState().lang // his interface starts in Czech; it is built again when the headset's camera takes over
    const ui = initUI({
      state: theatre.state, STAGES, LAYERS, VIEWPOINTS, backend: 'WebGL 2',
      camera: view.camera, renderer: { domElement: view.canvas }, actions: director.actions, signal: abort.signal, touch: TOUCH,
    })
    if (lang !== theatre.state.lang) ui.setLang(lang)
    director.setUI(ui)
    hooks.moved = ui.clearViews
    ui.setNoclip(useApp.getState().noclip)
    ui.setWardrobe(useApp.getState().wardrobe)
    const stop = useApp.subscribe((s, old) => {
      if (s.noclip !== old.noclip) ui.setNoclip(s.noclip)
      if (s.wardrobe !== old.wardrobe) ui.setWardrobe(s.wardrobe)
      if (s.notice !== old.notice && s.notice) ui.notice(s.notice)
    })
    const veil = host.current.querySelector('#loading')
    let gone
    if (veil) { veil.style.opacity = '0'; veil.style.pointerEvents = 'none'; gone = setTimeout(() => veil.remove(), 900) }
    return () => {
      abort.abort(); stop(); clearTimeout(gone)
      director.setUI(null)
      hooks.moved = null
      // his code filled these by hand: empty them so a second start (development) begins clean
      if (host.current) host.current.innerHTML = MARKUP.replace(/<div class="loading"[\s\S]*$/, '')
    }
  }, [theatre, director, view])

  return (
    <div id="nd-ui" hidden={xr}>
      <header className="masthead">
        <div className="mast">
          <h1>Národní <span>divadlo</span></h1>
          <p className="credit">Model by Lukáš Eršil. Multi-user WebXR version made in Graspable.</p>
          <button className="enter-xr" onClick={onEnterVR}>Enter VR</button>
        </div>
      </header>
      <div ref={host} />
    </div>
  )
}
