// The wardrobe on a computer: a panel in the look of Lukáš's interface (opened with "Wardrobe" in the toolbar)
// where a person chooses who they are: one of the outfits of 1868 to 1883, its cloth colour, a skin tone and the
// name on their plate. The figure turns slowly in a small canvas of its own (lib/people/studio.js). Inside the
// headset the same choices are a tab of the hand menu (components/XRWardrobe.jsx), with the same words.
import { useEffect, useMemo, useRef } from 'react'
import { UI_TEXT } from '../lib/nd/ui.js'
import { portrait, thumbnail } from '../lib/people/studio'
import { NAME_MAX, OUTFITS, SKINS, setLook, useWardrobe } from '../lib/people/wardrobe'
import { sessionName } from '../lib/names'
import { useApp } from '../lib/theatre/app'

export function Wardrobe() {
  const open = useApp((s) => s.wardrobe)
  const xr = useApp((s) => s.xr)
  if (!open || xr) return null
  return <Panel />
}

function Panel() {
  const lang = useApp((s) => s.lang)
  const mirror = useApp((s) => s.mirror)
  const look = useWardrobe()
  const t = (key) => UI_TEXT[lang][key] ?? key
  const other = lang === 'cz' ? 'en' : 'cz'
  const canvas = useRef()
  const now = useRef(look)
  now.current = look

  // the preview: the figure as it is now, turning slowly
  useEffect(() => {
    let frame = 0, angle = 0.5, last = performance.now()
    const tick = (time) => {
      const dt = Math.min(0.1, (time - last) / 1000)
      last = time
      angle += dt * 0.6
      if (canvas.current) portrait(canvas.current, now.current, angle, dt)
      frame = requestAnimationFrame(tick)
    }
    frame = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(frame)
  }, [])

  // the small pictures show every outfit in the chosen colour number and skin
  const pictures = useMemo(() => OUTFITS.map((o, outfit) => thumbnail({ outfit, cloth: look.cloth, skin: look.skin })), [look.cloth, look.skin])
  const close = () => useApp.setState({ wardrobe: false })

  return (
    <section className="card wardrobe" aria-label={t('wardrobe')}>
      <button className="close" onClick={close} aria-label={t('close')}>×</button>
      <h3 className="split"><span className="eb">{t('wardrobe')}</span><span className="wd-years">{t('wardrobeYears')}</span></h3>
      <div className="wd-top">
        <canvas ref={canvas} className="wd-preview" width={240} height={400} aria-label={OUTFITS[look.outfit][lang]} />
        <div className="wd-side">
          <label className="wd-field">
            <span>{t('plateName')}</span>
            <input
              type="text" value={look.name} maxLength={NAME_MAX} placeholder={sessionName()} spellCheck={false} autoComplete="off"
              onChange={(e) => setLook({ name: e.target.value })} onKeyDown={(e) => { if (e.key === 'Enter' || e.key === 'Escape') e.target.blur() }}
            />
          </label>
          <div className="wd-field">
            <span>{t('cloth')}</span>
            <div className="wd-swatches">
              {OUTFITS[look.outfit].cloth.map((c, i) => <button key={i} className="wd-swatch" style={{ background: c }} aria-pressed={look.cloth === i} aria-label={`${t('cloth')} ${i + 1}`} onClick={() => setLook({ cloth: i })} />)}
            </div>
          </div>
          <div className="wd-field">
            <span>{t('skin')}</span>
            <div className="wd-swatches">
              {SKINS.map((c, i) => <button key={i} className="wd-swatch" style={{ background: c }} aria-pressed={look.skin === i} aria-label={`${t('skin')} ${i + 1}`} onClick={() => setLook({ skin: i })} />)}
            </div>
          </div>
          <div className="wd-actions">
            <button className="chip-btn" title={t('showMeTitle')} onClick={(e) => { e.currentTarget.blur(); useApp.setState((s) => ({ showMe: s.showMe + 1 })) }}>{t('showMe')} · M</button>
            <button className="chip-btn" aria-pressed={mirror} onClick={() => useApp.setState({ mirror: !mirror })}>{t('mirror')}</button>
          </div>
        </div>
      </div>
      <div className="wd-list">
        {OUTFITS.map((o, i) => (
          <button key={o.id} className="view-btn wd-outfit" aria-pressed={look.outfit === i} onClick={() => setLook({ outfit: i })}>
            <img src={pictures[i]} alt="" />
            <span><b>{o[lang]}</b><small lang={other === 'cz' ? 'cs' : 'en'}>{o[other]}</small></span>
          </button>
        ))}
      </div>
    </section>
  )
}
