// The chat inside the headset, in the same words as the panel on a computer (components/Chat.jsx):
//
//   ChatTab        the "Chat" tab of the hand menu: the messages (drag the list to scroll it), the people in the
//                  room with "Mute", the ready phrases that send with one press, and the field being written
//   ChatKeyboard   the keys, a second panel that hangs below the menu and leans towards you like a keyboard:
//                  QWERTZ with the Czech accented letters or QWERTY (the CZ/EN key), digits, Shift, space, delete,
//                  the microphone where the browser can turn speech into text, and Send. Keys are 32 mm at 45 cm
//                  (and grow with the menu): a ray or the tip of an index finger presses them, each press answers
//                  with a pulse on the controller and a quiet click. While this tab is open the menu stands in
//                  front of you instead of on your hand (components/XRMenu.jsx), so both hands can type.
//   ChatLine       with the menu closed: a new message as a small line beside the hand that carries the menu
import { useEffect, useRef, useState } from 'react'
import { useFrame } from '@react-three/fiber'
import { Container, Text } from '@react-three/uikit'
import { Btn, C, ROOT, SMALL, Seg, UI } from './XRUI'
import { useMultiplayer } from './Multiplayer'
import { usePress } from '../lib/interaction'
import { LINE_S, MAX_CHARS, PHRASES, canListen, click, listen, sendChat, shown, timeOf, toggleMute, typed, useChat, watching } from '../lib/chat'
import { OUTFITS, lookOf } from '../lib/people/wardrobe'

const PER_PAGE = 7 // people on one page of the list

export function ChatTab({ lang, t }) {
  const { peers } = useMultiplayer()
  const all = useChat((s) => s.messages)
  const muted = useChat((s) => s.muted)
  const draft = useChat((s) => s.draft)
  const [view, setView] = useState('messages')
  const [page, setPage] = useState(0)
  const list = useRef()
  const run = useRef({ stick: true }).current
  const messages = shown(all, muted)
  useEffect(() => watching(), [])

  // the newest message stays in view unless the person has dragged the list back
  useFrame(() => {
    const el = list.current
    if (!el || !run.stick) return
    const max = el.maxScrollPosition?.peek()?.[1], at = el.scrollPosition.peek()
    if (max != null && max > 0 && Math.abs((at?.[1] ?? 0) - max) > 0.5) el.scrollPosition.value = [0, max]
  })

  const pages = Math.max(1, Math.ceil(peers.length / PER_PAGE))
  const onPage = peers.slice(Math.min(page, pages - 1) * PER_PAGE).slice(0, PER_PAGE)
  // the field shows the end of a long message, where the next letter goes
  const tail = draft.length > 96 ? `…${draft.slice(-95)}` : draft
  return (
    <>
      <Container flexDirection="row" alignItems="center" gap={8} flexShrink={0}>
        <Seg height={30}>
          <Btn kind="seg" on={view === 'messages'} height="100%" onPress={() => setView('messages')}>{t('chatMessages')}</Btn>
          <Btn kind="seg" on={view === 'people'} height="100%" onPress={() => setView('people')}>{`${t('chatPeople')} · ${peers.length + 1}`}</Btn>
        </Seg>
        {view === 'people' && pages > 1 && <Btn kind="ghost" marginLeft="auto" onPress={() => setPage((page + 1) % pages)}>{`${t('chatMore')} ${Math.min(page, pages - 1) + 1}/${pages}`}</Btn>}
      </Container>

      {view === 'messages' ? (
        <Container
          ref={list} flexDirection="column" gap={7} flexGrow={1} flexBasis={0} overflow="scroll" paddingRight={12} scrollbarWidth={6} scrollbarColor={C.lineHi}
          onScroll={(x, y) => { const max = list.current?.maxScrollPosition?.peek()?.[1] ?? 0; run.stick = y >= max - 6 }}
        >
          {messages.length === 0 && <Text fontSize={UI} color={C.muted}>{t('chatEmpty')}</Text>}
          {messages.map((m) => (
            <Container key={m.id} flexDirection="column" flexShrink={0}>
              <Container flexDirection="row" alignItems="flex-end" gap={8}>
                <Text fontWeight="bold" color={m.color}>{m.name}</Text>
                <Text fontSize={UI} color={C.muted}>{timeOf(m.at, lang)}</Text>
              </Container>
              <Text lineHeight="135%">{m.text}</Text>
            </Container>
          ))}
        </Container>
      ) : (
        <Container flexDirection="column" gap={4} flexGrow={1} flexBasis={0}>
          {peers.length === 0 && <Text fontSize={UI} color={C.muted}>{t('chatAlone')}</Text>}
          {onPage.map((p) => (
            <Container key={p.id} flexDirection="row" alignItems="center" gap={8} height={30} flexShrink={0}>
              <Container width={9} height={9} borderRadius={5} backgroundColor={p.color} flexShrink={0} />
              <Container flexDirection="column" flexGrow={1} flexBasis={0}>
                <Text lineHeight="120%">{p.name}</Text>
                <Text fontSize={UI} lineHeight="120%" color={C.muted}>{OUTFITS[lookOf(p.fields?.w, p.id).outfit][lang]}</Text>
              </Container>
              <Btn on={!!muted[p.id]} width={84} paddingX={0} onPress={() => toggleMute(p.id)}>{t(muted[p.id] ? 'chatMuted' : 'chatMute')}</Btn>
            </Container>
          ))}
        </Container>
      )}

      <Container flexDirection="row" flexWrap="wrap" gap={4} flexShrink={0}>
        {PHRASES[lang].map((phrase) => <Btn key={phrase} kind="view" height={24} paddingX={7} onPress={() => sendChat(phrase)}>{phrase}</Btn>)}
      </Container>
      <Container flexDirection="row" alignItems="flex-start" gap={8} height={46} paddingX={8} paddingY={5} backgroundColor={C.raised} borderWidth={1} borderColor={draft ? C.accent : C.line} flexShrink={0}>
        <Text flexGrow={1} flexBasis={0} lineHeight="125%" color={draft ? C.fg : C.muted}>{draft ? `${tail}|` : `${t('chatField')}…`}</Text>
        <Text fontSize={UI} color={C.muted} flexShrink={0}>{`${[...draft].length}/${MAX_CHARS}`}</Text>
      </Container>
    </>
  )
}

// Each row is twelve keys wide. Czech: QWERTZ, the accented letters in a row of their own and beside the letters;
// English: QWERTY and a row of signs in the place of the accents.
const LAYOUTS = {
  cz: ['1234567890-!', 'ěščřžýáíéúůó', 'qwertzuiopďť', 'asdfghjklň\':', 'yxcvbnm,.?'],
  en: ['1234567890-!', '@():;\'"/+=&%', 'qwertyuiop', 'asdfghjkl', 'zxcvbnm,.?'],
}
const KEY = 32, GAP = 3
// a capital comes by itself at the start and after a full stop, a question or an exclamation mark
const startsSentence = (text) => text === '' || /[.?!]\s$/.test(text)

export function ChatKeyboard({ lang, t, hand, width }) {
  const draft = useChat((s) => s.draft)
  const noSpeech = useChat((s) => s.noSpeech)
  const sent = useChat((s) => s.sent)
  const [layout, setLayout] = useState(lang)
  const [shift, setShift] = useState(() => startsSentence(draft))
  const [hearing, setHearing] = useState(false)
  const stop = useRef(null)
  useEffect(() => () => { stop.current?.(); typed(false) }, [])

  const write = (next) => {
    const text = [...next].slice(0, MAX_CHARS).join('')
    useChat.setState({ draft: text })
    setShift(startsSentence(text))
    typed(text !== '')
  }
  const type = (ch) => { if ([...draft].length < MAX_CHARS) write(draft + (shift ? ch.toLocaleUpperCase('cs') : ch)) }
  const send = () => { stop.current?.(); if (sendChat(draft)) write('') }
  const mic = () => {
    if (hearing) { stop.current?.(); return }
    // what is heard is written after what is already there, for the person to check and send
    const before = draft && !draft.endsWith(' ') ? `${draft} ` : draft
    setHearing(true)
    stop.current = listen(lang, (words) => write(before + words), () => { stop.current = null; setHearing(false) })
  }

  return (
    // the group's name says what this person has done in the chat, in words (Graspable's XR tests compare objects by name)
    <group name={`chat: ${sent} sent, field "${draft}", keys ${layout}`} position={[0, -0.004, 0]} rotation={[-0.35, 0, 0]}>
      <Container
        {...ROOT} renderOrder={30} anchorX={hand === 'left' ? 'left' : 'right'} anchorY="top" width={width}
        flexDirection="column" gap={GAP} padding={12} backgroundColor={C.bg} borderWidth={1} borderColor={C.line}
      >
        {LAYOUTS[layout].map((row, i) => (
          <Container key={i} flexDirection="row" gap={GAP} justifyContent="center" flexShrink={0}>
            {[...row].map((ch) => <Key key={ch} label={shift ? ch.toLocaleUpperCase('cs') : ch} onPress={() => type(ch)} />)}
          </Container>
        ))}
        <Container flexDirection="row" gap={GAP} flexShrink={0}>
          <Key label={t('chatShift')} width={50} on={shift} onPress={() => setShift(!shift)} />
          <Key label={layout === 'cz' ? 'CZ' : 'EN'} width={44} onPress={() => setLayout(layout === 'cz' ? 'en' : 'cz')} />
          <Key label={t('keySpace')} grow onPress={() => type(' ')} />
          <Key label={t('keyDelete')} width={66} onPress={() => write([...draft].slice(0, -1).join(''))} />
          {canListen && !noSpeech && <Key label={hearing ? t('chatListening') : t('chatMic')} width={hearing ? 84 : 66} on={hearing} onPress={mic} />}
          <Key label={t('chatSend')} width={74} cta onPress={send} />
        </Container>
      </Container>
    </group>
  )
}

function Key({ label, width = KEY, grow = false, on = false, cta = false, onPress }) {
  const { hovered, pressed, handlers } = usePress({ onPress, onDown: click })
  const lit = on || cta
  return (
    <Container
      width={grow ? undefined : width} flexGrow={grow ? 1 : 0} flexBasis={grow ? 0 : undefined} height={KEY} flexShrink={0}
      alignItems="center" justifyContent="center"
      backgroundColor={pressed ? C.fg : lit ? (hovered ? C.accentHover : C.accent) : hovered ? C.line : C.raised}
      borderWidth={1} borderColor={lit ? C.accent : hovered ? C.fg : C.line} {...handlers}
    >
      <Text fontSize={label.length > 1 ? 13 : 15} fontWeight={cta ? 'bold' : 'medium'} color={pressed || lit ? C.onAccent : C.fg}>{label}</Text>
    </Container>
  )
}

/** The newest message from someone else for a few seconds after it arrived, else null. */
export function useNewMessage() {
  const last = useChat((s) => s.last)
  const [message, setMessage] = useState(null)
  useEffect(() => {
    const left = last ? LINE_S * 1000 - (performance.now() - last.seen) : 0
    if (left <= 0) { setMessage(null); return }
    setMessage(last)
    const timer = setTimeout(() => setMessage(null), left)
    return () => clearTimeout(timer)
  }, [last])
  return message
}

/** With the menu closed: who wrote, and the beginning of what they wrote. It takes no pointers. */
export function ChatLine({ message, hand }) {
  const text = message.text.length > 90 ? `${message.text.slice(0, 89)}…` : message.text
  return (
    <Container
      {...ROOT} pointerEvents="none" renderOrder={30} anchorX={hand === 'left' ? 'left' : 'right'} anchorY="bottom" width={260}
      flexDirection="column" gap={2} paddingX={10} paddingY={7} backgroundColor={C.bg} borderWidth={1} borderColor={C.line}
    >
      <Text fontSize={SMALL} fontWeight="bold" color={message.color}>{message.name}</Text>
      <Text lineHeight="130%">{text}</Text>
    </Container>
  )
}
