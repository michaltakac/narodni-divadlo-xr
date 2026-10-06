// The chat: short text messages between the people in the room, on a computer (components/Chat.jsx) and
// inside the headset (components/XRChat.jsx), and as speech bubbles above heads (components/People.jsx).
//
//   the room      the last 50 messages live in the room's document as one list ('chat'), so whoever joins later
//                 reads what was said before; each send drops what is older. A message is plain JSON
//                 { i id, f sender, n name, c colour, x text, a time } and is only ever shown as text.
//   each person   who they have muted, what they have not read yet, and what they are typing stay with them;
//                 "is typing" travels as one presence flag (`ty`) while it is true.
//
// Nothing a person types is trusted on arrival either: every entry is checked and cut again when it is read.
import { create } from 'zustand'
import { colorFor } from './names'
import { TOUCH, say } from './theatre/app'

export const MAX_CHARS = 240
export const KEEP = 50
export const GAP_MS = 1000 // at most one message a second per person
export const BUBBLE_S = 6 // a speech bubble stands this long, then fades
export const LINE_S = 5 // the line near the hand in the headset

/** The words both interfaces use (merged into UI_TEXT in lib/nd/ui.js). */
export const CHAT_TEXT = {
  cz: {
    chat: 'Chat', chatMessages: 'Zprávy', chatPeople: 'Lidé', chatSend: 'Odeslat', chatFold: 'Sbalit',
    chatPlaceholder: 'Napište zprávu… (T nebo Enter)', chatEmpty: 'Zatím nikdo nic nenapsal.', chatAlone: 'Nikdo další tu teď není.',
    chatMute: 'Ztlumit', chatMuted: 'Ztlumeno', chatYou: 'vy', chatField: 'Zpráva', chatMic: 'Mikrofon', chatListening: 'Poslouchám…',
    chatShift: 'Shift', chatMore: 'Další',
  },
  en: {
    chat: 'Chat', chatMessages: 'Messages', chatPeople: 'People', chatSend: 'Send', chatFold: 'Fold',
    chatPlaceholder: 'Write a message… (T or Enter)', chatEmpty: 'Nobody has written anything yet.', chatAlone: 'Nobody else is here right now.',
    chatMute: 'Mute', chatMuted: 'Muted', chatYou: 'you', chatField: 'Message', chatMic: 'Mic', chatListening: 'Listening…',
    chatShift: 'Shift', chatMore: 'More',
  },
}

/** Ready phrases of the headset menu: sent with one press, in the menu's language. */
export const PHRASES = {
  cz: ['Dobrý den!', 'Podívejte se', 'Pojďte za mnou', 'Sejdeme se ve foyer', 'Na jeviště!', 'Krásné, že?', 'Děkuji'],
  en: ['Hello!', 'Look at this', 'Follow me', 'Meet me in the foyer', 'To the stage!', 'Beautiful, isn’t it?', 'Thank you'],
}

const NOTES = {
  tooFast: { cz: 'Nejvýš jedna zpráva za sekundu.', en: 'At most one message a second.' },
  noSpeech: { cz: 'Rozpoznávání řeči tu není k dispozici.', en: 'Speech recognition is not available here.' },
}

// control characters, zero-width and direction-override marks go; runs of white space become one space
// (built from a string of escapes: a line separator written out inside a regular expression would end it)
const JUNK = new RegExp('[\\u0000-\\u001f\\u007f-\\u009f\\u200b-\\u200f\\u2028-\\u202e\\u2060-\\u2069\\ufeff]', 'g')
/** A message as it may be sent and shown: one line of plain text, at most MAX_CHARS characters. */
export const clean = (text, max = MAX_CHARS) => [...String(text ?? '').replace(JUNK, ' ').replace(/\s+/g, ' ').trim()].slice(0, max).join('').trim()

export const useChat = create(() => ({
  messages: [],  // the room's last 50, oldest first: { id, from, name, color, text, at }
  people: [],    // everyone else in the room, for the list with "Mute": { id, name, color, w, kind }
  me: null,      // { id, name, color }
  muted: {},     // people this person has muted, by their id in the room; forgotten when the page closes
  unread: 0,     // messages that arrived while nobody was looking at the list
  // the panel on a computer is unfolded; on a phone or in a small window it starts as its tab
  open: !TOUCH && (globalThis.innerWidth ?? 1280) > 760 && (globalThis.innerHeight ?? 800) >= 600,
  draft: '',     // what is being written on the keys in the headset
  last: null,    // the newest message that arrived live from someone else, for the line near the hand
  typing: false, // this person is writing
  sent: 0,       // how many messages this person has sent since the page opened
  noSpeech: false, // the browser offered speech recognition and then refused it
}))

/** Messages this person is shown: without the people they have muted. */
export const shown = (messages, muted) => messages.filter((m) => !muted[m.from])
export const timeOf = (at, lang) => (at ? new Date(at).toLocaleTimeString(lang === 'cz' ? 'cs-CZ' : 'en-GB', { hour: '2-digit', minute: '2-digit' }) : '')

// what each person said last, for the bubble above their head (read every frame, so not in React)
const said = new Map()
export const saidBy = (id) => said.get(id) ?? null

let watchers = 0
/** Call while the message list is in front of the person; returns the function that ends it. */
export function watching() {
  watchers++
  useChat.setState({ unread: 0 })
  return () => { watchers-- }
}

function parse(e) {
  if (!e || typeof e !== 'object' || typeof e.x !== 'string') return null
  const text = clean(e.x)
  const from = Number(e.f)
  if (!text || !Number.isFinite(from)) return null
  const at = Number.isFinite(e.a) ? e.a : 0
  return { id: clean(e.i, 40) || `${from}-${at}`, from, name: clean(e.n, 24) || 'Someone', color: /^#[0-9a-f]{6}$/i.test(e.c) ? e.c : colorFor(from), text, at }
}

let link = null
/** Connect the chat to the room (components/Chat.jsx does it once the connection exists). */
export function attachChat(mp) {
  const list = mp.doc.getArray('chat')
  link = { mp, list }
  const read = () => {
    const out = [], ids = new Set(), lastAt = new Map()
    for (const entry of list.toArray()) {
      const m = parse(entry)
      if (!m || ids.has(m.id)) continue
      // the one-a-second rule, held up on this side too (by the sender's own clock)
      const before = lastAt.get(m.from)
      if (before !== undefined && m.at >= before && m.at - before < GAP_MS - 100) continue
      lastAt.set(m.from, m.at)
      ids.add(m.id)
      out.push(m)
    }
    return out.slice(-KEEP)
  }
  const onChange = () => {
    const state = useChat.getState()
    const known = new Set(state.messages.map((m) => m.id))
    const messages = read()
    const patch = { messages }
    // what arrives while the room's history is still loading was said before this person came: no bubble, not unread
    const live = mp.offline || !!mp.provider?.synced
    if (live) {
      const now = performance.now()
      let unread = state.unread
      for (const m of messages) {
        if (known.has(m.id) || Math.abs(Date.now() - m.at) > 120000) continue
        said.set(m.from, { id: m.id, text: m.text, at: now })
        if (m.from === mp.me.id || state.muted[m.from]) continue
        if (!watchers) unread++
        patch.last = { ...m, seen: now }
      }
      patch.unread = unread
    }
    useChat.setState(patch)
  }
  list.observe(onChange)
  useChat.setState({ messages: read() })
  return () => { list.unobserve(onChange); if (link?.list === list) link = null }
}

let lastSent = 0
/** Say something to everyone in the room. False when there was nothing to send or it came too soon after the last one. */
export function sendChat(raw) {
  const text = clean(raw)
  if (!text || !link) return false
  const now = Date.now()
  if (now - lastSent < GAP_MS) { say(NOTES.tooFast); return false }
  lastSent = now
  const { mp, list } = link
  mp.doc.transact(() => {
    list.push([{ i: `${mp.me.id.toString(36)}-${now.toString(36)}`, f: mp.me.id, n: mp.me.name, c: mp.me.color, x: text, a: now }])
    if (list.length > KEEP) list.delete(0, list.length - KEEP)
  })
  useChat.setState((s) => ({ sent: s.sent + 1 }))
  typed(false)
  return true
}

export const toggleMute = (id) => useChat.setState((s) => { const muted = { ...s.muted }; if (muted[id]) delete muted[id]; else muted[id] = true; return { muted } })

let typingTimer = 0
/** Called with every change of the field: others see three dots until four seconds after the last key, or until it is sent or left. */
export function typed(writing) {
  clearTimeout(typingTimer)
  if (writing) typingTimer = setTimeout(() => useChat.setState({ typing: false }), 4000)
  if (useChat.getState().typing !== !!writing) useChat.setState({ typing: !!writing })
}

// ---- the keys in the headset: a quiet click, made here (no sound file)
let audio = null
export function click() {
  try {
    audio ??= new (window.AudioContext || window.webkitAudioContext)()
    if (audio.state === 'suspended') audio.resume()
    const t = audio.currentTime
    const osc = audio.createOscillator(), gain = audio.createGain()
    osc.type = 'triangle'
    osc.frequency.setValueAtTime(1500, t)
    osc.frequency.exponentialRampToValueAtTime(650, t + 0.03)
    gain.gain.setValueAtTime(0.045, t)
    gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.045)
    osc.connect(gain).connect(audio.destination)
    osc.start(t)
    osc.stop(t + 0.05)
  } catch {}
}

// ---- speech to text, where the browser has it. The browser listens and hands back words; this app keeps no
// sound and sends none: the words go into the field for the person to check and send.
const Recognition = typeof window !== 'undefined' ? (window.SpeechRecognition || window.webkitSpeechRecognition) : null
export const canListen = !!Recognition

/** Start listening; onText(words so far) while the person speaks, onEnd() when it stops. Returns the function that stops it. */
export function listen(lang, onText, onEnd) {
  let rec
  try {
    rec = new Recognition()
    rec.lang = lang === 'cz' ? 'cs-CZ' : 'en-US'
    rec.interimResults = true
    rec.continuous = false
    rec.onresult = (e) => { let words = ''; for (let i = 0; i < e.results.length; i++) words += e.results[i][0].transcript; onText(words) }
    rec.onerror = (e) => {
      if (e.error === 'no-speech' || e.error === 'aborted') return
      say(NOTES.noSpeech)
      if (e.error === 'not-allowed' || e.error === 'service-not-allowed' || e.error === 'language-not-supported') useChat.setState({ noSpeech: true })
    }
    rec.onend = () => onEnd()
    rec.start()
  } catch {
    useChat.setState({ noSpeech: true })
    onEnd()
    return () => {}
  }
  return () => { try { rec.stop() } catch {} }
}
