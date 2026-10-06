// The chat on a computer: a panel in the lower left corner in the look of Lukáš's interface, above whatever
// his interface has there just then (the stage card, the fire card, the timeline). The message list, the field
// you type in, and the people in the room with "Mute". It folds to a small tab that counts what you have not read.
//
//   T or Enter   puts the cursor into the field (and unfolds the panel)
//   Enter        sends; in an empty field it leaves the field
//   Escape       leaves the field
// While the cursor is in the field the walking keys type letters: the walking code ignores keys aimed at a field.
//
// Messages are React text nodes: whatever a person typed is shown as those characters, never as markup or a link.
// Inside the headset the same chat is a tab of the hand menu (components/XRChat.jsx).
import { useEffect, useRef, useState } from 'react'
import { useMp, useMultiplayer } from './Multiplayer'
import { UI_TEXT } from '../lib/nd/ui.js'
import { MAX_CHARS, attachChat, sendChat, shown, timeOf, toggleMute, typed, useChat, watching } from '../lib/chat'
import { OUTFITS, lookOf } from '../lib/people/wardrobe'
import { useApp } from '../lib/theatre/app'

/**
 * The chat's link to the room. It stands directly inside <Multiplayer> (App.jsx), so messages are read from the
 * first moment; it also tells the others when this person is writing and keeps the list of people for the panels.
 */
export function ChatLink() {
  const mp = useMp()
  const { peers, me } = useMultiplayer()
  const typing = useChat((s) => s.typing)
  useEffect(() => attachChat(mp), [mp])
  // one small flag in presence, there only while it is true
  useEffect(() => { mp.setFields({ ty: typing ? 1 : undefined }) }, [mp, typing])
  useEffect(() => {
    useChat.setState({ me: { id: me.id, name: me.name, color: me.color }, people: peers.map((p) => ({ id: p.id, name: p.name, color: p.color, w: p.fields?.w, kind: p.kind })) })
  }, [peers, me.id, me.name, me.color])
  return null
}

export function Chat() {
  const xr = useApp((s) => s.xr)
  const ready = useApp((s) => !!s.theatre)
  if (xr || !ready) return null
  return <Panel />
}

const isField = (el) => el instanceof HTMLElement && (el.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName))

function Panel() {
  const lang = useApp((s) => s.lang)
  const open = useChat((s) => s.open)
  const unread = useChat((s) => s.unread)
  const all = useChat((s) => s.messages)
  const muted = useChat((s) => s.muted)
  const people = useChat((s) => s.people)
  const me = useChat((s) => s.me)
  const [tab, setTab] = useState('messages')
  const [text, setText] = useState('')
  const field = useRef(), list = useRef(), box = useRef()
  const run = useRef({ focus: false, stick: true }).current
  const t = (key) => UI_TEXT[lang][key] ?? key
  const messages = shown(all, muted)

  // unfolded, the list is in front of the person: nothing is unread
  useEffect(() => (open ? watching() : undefined), [open])

  // T or Enter: into the field
  useEffect(() => {
    const down = (e) => {
      if (e.repeat || e.metaKey || e.ctrlKey || e.altKey || e.defaultPrevented || isField(e.target)) return
      if (e.code !== 'KeyT' && e.key !== 'Enter') return
      // Enter on a button presses that button
      if (e.key === 'Enter' && e.target instanceof HTMLElement && /^(BUTTON|A|SUMMARY)$/.test(e.target.tagName)) return
      e.preventDefault() // the T is not typed
      run.focus = true
      setTab('messages')
      useChat.setState({ open: true })
      field.current?.focus()
    }
    window.addEventListener('keydown', down)
    return () => window.removeEventListener('keydown', down)
  }, [run])
  useEffect(() => { if (open && run.focus) { run.focus = false; field.current?.focus() } }, [open, tab, run])

  // the newest message stays in view unless the person has scrolled back
  useEffect(() => { const el = list.current; if (el && run.stick) el.scrollTop = el.scrollHeight }, [messages.length, open, tab, run])

  // above the interface's lower edge, wherever that is now (as the thumb stick does, components/Touch.jsx)
  useEffect(() => {
    const el = box.current
    if (!el) return
    const rect = (q) => {
      const r = document.querySelector(q)?.getBoundingClientRect()
      return r && r.width > 2 && r.height > 2 ? r : null
    }
    const place = () => {
      const h = window.innerHeight, w = window.innerWidth
      const line = rect('#nd-ui .timeline') ?? rect('#nd-ui .tl-show')
      let bottom = h - (line?.top ?? h) + 6, left = 16
      let cardTop = h, cardRight = 0
      for (const q of ['#nd-ui .stagecard', '#nd-ui .firecard', '.touch']) {
        const r = rect(q)
        if (!r || r.left > 200 || r.bottom < h * 0.5) continue
        cardTop = Math.min(cardTop, r.top); cardRight = Math.max(cardRight, r.right)
      }
      // what is above: the masthead, the readout, and on a narrow screen the toolbar that wraps below them
      let top = 0
      for (const q of ['#nd-ui .masthead', '.perf', '#nd-ui .toolbar']) { const r = rect(q); if (r && r.left < 340 && r.bottom < h * 0.5) top = Math.max(top, r.bottom) }
      // above the card when there is room for a few lines, else beside it
      if (cardTop < h) {
        if (cardTop - top >= 200 || cardRight + 340 > w) bottom = h - cardTop + 6
        else left = cardRight + 6
      }
      // never under the panel of views and layers on the right
      const side = rect('#nd-ui .side')
      const room = (side && side.bottom > h - bottom - 200 ? side.left : w) - left - 6
      el.style.setProperty('--chat-width', `${Math.round(Math.max(200, Math.min(320, room)))}px`)
      el.style.setProperty('--chat-left', `${Math.round(left)}px`)
      el.style.setProperty('--chat-bottom', `${Math.round(bottom)}px`)
      el.style.setProperty('--chat-room', `${Math.round(h - bottom - top - 12)}px`)
    }
    place()
    const timer = setInterval(place, 250) // his cards open, close and change height by themselves
    window.addEventListener('resize', place)
    return () => { clearInterval(timer); window.removeEventListener('resize', place) }
  }, [open])

  const submit = (e) => {
    e?.preventDefault()
    if (sendChat(text)) { setText(''); run.stick = true }
  }
  const keyDown = (e) => {
    if (e.key === 'Escape') { e.target.blur(); return }
    if (e.key !== 'Enter' || e.nativeEvent.isComposing) return
    e.preventDefault()
    if (text.trim() === '') e.target.blur()
    else submit()
  }

  if (!open) {
    return (
      <button ref={box} className="chat-tab" onClick={() => useChat.setState({ open: true })} aria-label={unread ? `${t('chat')}: ${unread}` : t('chat')}>
        {t('chat')}{unread > 0 && <b>{unread > 99 ? '99+' : unread}</b>}
      </button>
    )
  }
  return (
    <section ref={box} className="card chat" aria-label={t('chat')}>
      <h3 className="split">
        <span className="eb">{t('chat')}</span>
        <span className="mini">
          <button aria-pressed={tab === 'people'} onClick={() => setTab(tab === 'people' ? 'messages' : 'people')}>{t('chatPeople')} · {people.length + 1}</button>
          <button onClick={() => useChat.setState({ open: false })}>{t('chatFold')}</button>
        </span>
      </h3>
      {tab === 'people' ? (
        <ul className="chat-people">
          {me && <li><i style={{ background: me.color }} /><span><b>{me.name}</b><small>{t('chatYou')}</small></span></li>}
          {people.map((p) => (
            <li key={p.id}>
              <i style={{ background: p.color }} />
              <span><b>{p.name}</b><small>{OUTFITS[lookOf(p.w, p.id).outfit][lang]}</small></span>
              <button className="chip-btn" aria-pressed={!!muted[p.id]} onClick={() => toggleMute(p.id)}>{t(muted[p.id] ? 'chatMuted' : 'chatMute')}</button>
            </li>
          ))}
          {people.length === 0 && <li className="none">{t('chatAlone')}</li>}
        </ul>
      ) : (
        <ol
          ref={list} className="chat-list" aria-live="polite"
          onScroll={(e) => { const el = e.currentTarget; run.stick = el.scrollHeight - el.scrollTop - el.clientHeight < 12 }}
        >
          {messages.length === 0 && <li className="none">{t('chatEmpty')}</li>}
          {messages.map((m) => (
            <li key={m.id}>
              <b style={{ color: m.color }}>{m.name}</b><time>{timeOf(m.at, lang)}</time>
              <p>{m.text}</p>
            </li>
          ))}
        </ol>
      )}
      <form className="chat-form" onSubmit={submit}>
        <input
          ref={field} type="text" value={text} maxLength={MAX_CHARS} placeholder={t('chatPlaceholder')} aria-label={t('chatField')}
          spellCheck={false} autoComplete="off" enterKeyHint="send"
          onChange={(e) => { setText(e.target.value); typed(e.target.value !== '') }} onKeyDown={keyDown} onBlur={() => typed(false)}
        />
        {text.length > MAX_CHARS - 40 && <span className="chat-count">{MAX_CHARS - text.length}</span>}
        <button className="chip-btn" type="submit">{t('chatSend')}</button>
      </form>
    </section>
  )
}
