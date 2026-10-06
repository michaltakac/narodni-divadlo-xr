// The menu inside the headset: everything Lukáš Eršil's HTML interface does on a computer, with his wording
// and his look, as a panel in the scene (components/XRUI.jsx).
//
//   where      on the left hand: beside the left controller, or with bare hands beside the left wrist; it always
//              faces your eyes, like a watch you look at. The other hand works it: ray and trigger, a pinch from
//              afar, or the tip of the index finger.
//   open       the menu or Y button of that controller (B when the menu is on the right hand); with bare hands,
//              turn that palm towards your face. Closed, nothing of it is in the scene.
//   size       its smallest letters are 7 mm tall at 45 cm from the eyes (1.5 % of the distance); held further
//              away it grows with the distance, so that stays true
//   Pin        leaves it standing where it is, half as big again so it reads from a step away; Unpin or × ends that
//   tabs       in two rows, each as tall and lettered as the buttons below them:
//              Timeline · View · Fire · Places (the viewpoints, how to teleport, "Teleport only") / Wardrobe (who you are, components/XRWardrobe.jsx) · Chat
//              (components/XRChat.jsx; its keys hang below the panel) · About
//   Chat       a keyboard on the back of one hand cannot be typed on and hangs out of sight: while the Chat tab is
//              open the menu leaves the hand and stands in front of you, the field and the first keys a little
//              below your eyes, so the messages and all the keys are in view and both hands are free. Another tab,
//              or closing it, puts it back on the hand. (Pin still leaves it wherever you want it.)
//   closed     nothing of it is in the scene, except for a few seconds a new chat message as a line beside that hand
//
// What is shared (clock, Play, X-ray and layers, section, night, fire) goes through the same actions as on the
// computer (lib/theatre/director.js) and is shown from the room's state, so a change by someone else moves the
// same buttons here. The menu itself is each person's own: nobody else sees it.
import { useMemo, useRef, useState } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import { useXR } from '@react-three/xr'
import { Container, Image, Text } from '@react-three/uikit'
import { Matrix4, Quaternion, Vector3 } from 'three'
import { Btn, C, Eyebrow, Para, ROOT, SMALL, Seg, Slider, Title, upper } from './XRUI'
import { STAGES, LAYERS } from '../lib/nd/data/content.js'
import { UI_TEXT, aboutHTML } from '../lib/nd/ui.js'
import { VIEWPOINTS, stopOf } from '../lib/theatre/model.js'
import { setLang, setTeleportOnly, useApp } from '../lib/theatre/app'
import { WardrobeTab } from './XRWardrobe'
import { ChatKeyboard, ChatLine, ChatTab, useNewMessage } from './XRChat'
import { useChat } from '../lib/chat'

// the few words the menu needs that his interface does not have
const EXTRA = {
  cz: { tabFire: 'Požár', tabPlaces: 'Místa', day: 'Den', pin: 'Připnout', unpin: 'Odepnout', menuHand: 'Menu na ruce', left: 'Levá', right: 'Pravá' },
  en: { tabFire: 'Fire', tabPlaces: 'Places', day: 'Day', pin: 'Pin', unpin: 'Unpin', menuHand: 'Menu on hand', left: 'Left', right: 'Right' },
}
const TEXT = { cz: { ...UI_TEXT.cz, ...EXTRA.cz }, en: { ...UI_TEXT.en, ...EXTRA.en } }
const TABS = [[['timeline', 'tlShow'], ['view', 'toolbar'], ['fire', 'tabFire'], ['places', 'tabPlaces']], [['wardrobe', 'wardrobe'], ['chat', 'chat'], ['about', 'about']]]

// The panel has one size on every tab, so it stands still when a tab or a text changes under the pointer.
// width and height in millimetres at `reach` metres from the eyes; held further away it grows with the distance (up to
// `grow` times), so its smallest letters stay 1.5 % of their distance tall; pinned it is `pinned` times as large
// (the Chat tab is lower, `chat`: with its keys below it, it still fits into one look)
export const MENU = { width: 440, height: 512, chat: 420, reach: 0.45, grow: 1.6, pinned: 1.5 }
// While typing: how far from the eyes the middle of the panel stands and how far above eye level (radians), which
// puts the field and the first keys some twenty degrees below the eyes and the last keys at chest height; and how
// far the person may walk off before it comes after them
const TYPING = { distance: 0.5, rise: 0.09, leash: 1.1 }
const BESIDE = 0.05, ABOVE = 0.07 // the panel's lower corner from the hand, metres
const PALM_OPEN = 0.6, PALM_SHUT = 0.3 // how squarely the palm must face the eyes (cosine)
const MENU_BUTTONS = [5, 12] // Y (B on the right) and, where the browser passes it on, the menu button

const UP = new Vector3(0, 1, 0)
const _m = new Matrix4(), _q = new Quaternion(), _s = new Vector3()
const _hand = new Vector3(), _a = new Vector3(), _b = new Vector3()
const _x = new Vector3(), _y = new Vector3(), _z = new Vector3(), _corner = new Vector3(), _centre = new Vector3()

export function XRMenu({ theatre }) {
  const gl = useThree((s) => s.gl)
  const origin = useXR((s) => s.origin)
  const originSpace = useXR((s) => s.originReferenceSpace)
  const hand = useApp((s) => s.menuHand)
  const [open, setOpen] = useState(false)
  const [pinned, setPinned] = useState(false)
  const [tab, setTab] = useState('timeline')
  const group = useRef()
  const run = useRef({ open, pinned, front: false, button: false, palm: 0, facing: 0, armed: true, placed: false, scale: 1, line: false }).current
  run.open = open; run.pinned = pinned
  // typing: the menu stands in front of the person instead of on their hand
  const front = open && tab === 'chat' && !pinned
  if (front !== run.front) { run.front = front; if (!run.pinned) run.placed = false }
  // closed, a new chat message shows for a few seconds as a line where the menu would be
  const news = useNewMessage()
  const line = !open && !!news
  if (line !== run.line) { run.line = line; if (line) run.placed = false }
  if (import.meta.env?.DEV) window.__menu = run // for the console and tests, like __theatre
  const show = (on) => { if (on === run.open) return; run.open = on; if (on) run.placed = false; else { run.pinned = false; setPinned(false); setTab('timeline') } setOpen(on) }
  const close = () => { run.armed = false; show(false) } // a bare hand must turn away before it opens the menu again

  useFrame((state, delta, frame) => {
    const session = gl.xr.getSession()
    const space = originSpace ?? gl.xr.getReferenceSpace()
    if (!session || !frame || !space) return
    let source = null
    for (const s of session.inputSources) if (s.handedness === hand && (s.hand || s.gripSpace)) source = s
    const world = (pose, target) => {
      if (!pose) return false
      _m.fromArray(pose.transform.matrix)
      if (origin) _m.premultiply(origin.matrixWorld)
      target.setFromMatrixPosition(_m)
      return true
    }
    origin?.updateWorldMatrix(true, false) // the walking code has just moved it
    const head = theatre.eye.position
    let tracked = false
    if (source?.hand) {
      const joint = (name) => frame.getJointPose?.(source.hand.get(name), space)
      tracked = world(joint('wrist'), _hand)
      // which way the palm looks, from three joints (the same for every headset): across the knuckles × along the hand
      if (tracked && world(joint('index-finger-phalanx-proximal'), _a) && world(joint('pinky-finger-phalanx-proximal'), _b)) {
        _a.sub(_hand); _b.sub(_hand)
        const palm = hand === 'left' ? _b.cross(_a).normalize() : _a.cross(_b).normalize()
        const facing = palm.dot(_z.copy(head).sub(_hand).normalize())
        run.palm = facing
        run.facing = facing > PALM_OPEN ? run.facing + delta : facing < PALM_SHUT ? 0 : run.facing
        if (facing < PALM_SHUT) run.armed = true
        if (!run.pinned && !run.front) { // (typing turns the palms away: only × closes it then)
          if (!run.open && run.armed && run.facing > 0.25) show(true)
          else if (run.open && facing < PALM_SHUT) show(false)
        }
      }
      run.button = false
    } else if (source) {
      tracked = world(frame.getPose(source.gripSpace, space), _hand)
      const buttons = source.gamepad?.buttons ?? []
      const down = MENU_BUTTONS.some((i) => buttons[i]?.pressed)
      if (down && !run.button) show(!run.open)
      run.button = down
    }

    const g = group.current
    if (!g) return
    if (run.front && !run.pinned) {
      // in front of the person, upright and square to them, where they looked when they opened the tab; it
      // stays there while they type and comes after them only when they have walked away from it
      const k = TYPING.distance / MENU.reach
      if (!run.placed || _centre.copy(g.position).sub(head).setY(0).length() > TYPING.leash) {
        _a.set(0, 0, -1).applyQuaternion(theatre.eye.quaternion).setY(0)
        if (_a.lengthSq() < 1e-4) _a.set(0, 0, -1)
        _a.normalize()
        _centre.copy(head).addScaledVector(_a, Math.cos(TYPING.rise) * TYPING.distance)
        _centre.y += Math.sin(TYPING.rise) * TYPING.distance
        // square to the eyes from its middle, like a page held up to read
        _z.copy(head).sub(_centre).normalize()
        _x.crossVectors(UP, _z).normalize()
        _y.crossVectors(_z, _x)
        const side = hand === 'left' ? -1 : 1 // the panel is anchored at its lower corner on that side
        g.position.copy(_centre).addScaledVector(_y, -MENU.chat * 0.0005 * k).addScaledVector(_x, side * MENU.width * 0.0005 * k)
        g.quaternion.setFromRotationMatrix(_m.makeBasis(_x, _y, _z))
        run.scale = k
        if (!run.placed) g.scale.setScalar(k)
        run.placed = true
      }
    } else if (!run.pinned && tracked) {
      // the panel's lower corner stands beside and above the hand, the panel reaches towards the other hand, and
      // its face is square to the eyes (measured from its middle), upright
      const side = hand === 'left' ? 1 : -1
      const axes = (from) => {
        _z.copy(head).sub(from).normalize()
        _x.crossVectors(UP, _z)
        if (_x.lengthSq() < 1e-4) _x.set(1, 0, 0).applyQuaternion(theatre.eye.quaternion) // the hand right under the eyes
        _x.normalize()
        _y.crossVectors(_z, _x)
      }
      const half = MENU.height * 0.0005 * g.scale.x, across = MENU.width * 0.0005 * g.scale.x
      // (the axes depend on where the middle is and the middle on the axes: three rounds settle it)
      axes(_hand)
      for (let i = 0; i < 3; i++) {
        _corner.copy(_hand).addScaledVector(_x, side * BESIDE).addScaledVector(_y, ABOVE)
        axes(_centre.copy(_corner).addScaledVector(_x, side * across).addScaledVector(_y, half))
      }
      _corner.copy(_hand).addScaledVector(_x, side * BESIDE).addScaledVector(_y, ABOVE)
      _centre.copy(_corner).addScaledVector(_x, side * across).addScaledVector(_y, half)
      _q.setFromRotationMatrix(_m.makeBasis(_x, _y, _z))
      const k = run.placed ? 1 - Math.exp(-20 * delta) : 1 // eased, so a trembling hand does not shake the text
      g.position.lerp(_corner, k)
      g.quaternion.slerp(_q, k)
      run.scale = Math.min(MENU.grow, Math.max(1, head.distanceTo(_centre) / MENU.reach))
      if (!run.placed) g.scale.setScalar(run.scale)
      run.placed = true
    } else if (run.line && !tracked) {
      // no hand or controller in sight: the line waits low in front of the eyes instead
      g.quaternion.copy(theatre.eye.quaternion)
      g.position.copy(head).add(_a.set(hand === 'left' ? -0.3 : 0.3, -0.24, -0.6).applyQuaternion(g.quaternion))
      run.scale = 1.3
      if (!run.placed) g.scale.setScalar(run.scale)
      run.placed = true
    }
    const scale = run.pinned ? MENU.pinned : run.scale
    g.scale.setScalar(g.scale.x + (scale - g.scale.x) * (1 - Math.exp(-8 * delta)))
    g.visible = run.placed
  })

  if (line) return <group key="line" ref={group} name="chat line" visible={false}><ChatLine message={news} hand={hand} /></group>
  if (!open) return null
  return (
    <group key="menu" ref={group} name={`menu ${pinned ? 'pinned' : front ? 'in front for typing' : `on the ${hand} hand`}`} visible={false}>
      <Panel theatre={theatre} hand={hand} pinned={pinned} tab={tab} setTab={setTab} onPin={() => setPinned((p) => !p)} onClose={close} />
    </group>
  )
}

function Panel({ theatre, hand, pinned, tab, setTab, onPin, onClose }) {
  const lang = useApp((s) => s.lang)
  const t = (key) => TEXT[lang][key] ?? key
  const unread = useChat((s) => s.unread)
  return (
    <>
    {/* renderOrder: drawn after the hotspot markers and cards, which ignore depth */}
    <Container
      {...ROOT} renderOrder={30} anchorX={hand === 'left' ? 'left' : 'right'} anchorY="bottom" width={MENU.width} height={tab === 'chat' ? MENU.chat : MENU.height}
      flexDirection="column" gap={10} padding={12} backgroundColor={C.bg} borderWidth={1} borderColor={C.line}
    >
      <Container flexDirection="row" alignItems="center" gap={6} flexShrink={0}>
        <Container flexDirection="row" gap={5} marginRight="auto">
          <Title lang={lang} size={24}>Národní</Title>
          <Title lang={lang} size={24} color={C.accent}>divadlo</Title>
        </Container>
        <Btn on={pinned} onPress={onPin}>{t(pinned ? 'unpin' : 'pin')}</Btn>
        <Btn kind="ghost" width={30} paddingX={0} size={20} onPress={onClose}>×</Btn>
      </Container>
      <Container flexDirection="column" padding={3} gap={2} backgroundColor={C.bg} borderWidth={1} borderColor={C.line} flexShrink={0}>
        {TABS.map((row, i) => (
          <Container key={i} flexDirection="row" gap={2}>
            {row.map(([id, key]) => <Btn key={id} kind="seg" on={tab === id} flexGrow={1} flexBasis={0} paddingX={2} onPress={() => setTab(id)}>{id === 'chat' && unread > 0 && tab !== 'chat' ? `${t(key)} ${Math.min(unread, 99)}` : t(key)}</Btn>)}
          </Container>
        ))}
      </Container>
      {tab === 'timeline' && <Timeline theatre={theatre} lang={lang} t={t} />}
      {tab === 'view' && <View lang={lang} t={t} />}
      {tab === 'fire' && <FireTab lang={lang} t={t} />}
      {tab === 'places' && <Places lang={lang} t={t} />}
      {tab === 'wardrobe' && <WardrobeTab lang={lang} t={t} />}
      {tab === 'chat' && <ChatTab lang={lang} t={t} />}
      {tab === 'about' && <About lang={lang} t={t} hand={hand} />}
    </Container>
    {tab === 'chat' && <ChatKeyboard lang={lang} t={t} hand={hand} width={MENU.width} />}
    </>
  )
}

const Card = ({ children, ...props }) => (
  <Container flexDirection="column" gap={8} padding={12} borderWidth={1} borderColor={C.line} backgroundColor={C.bg} flexShrink={0} {...props}>{children}</Container>
)
const useActions = () => useApp((s) => s.director.actions)

// ---------------------------------------------------------------- Timeline
const MARKS = STAGES.map((s) => s.t / 7)

function Timeline({ theatre, lang, t }) {
  const actions = useActions()
  const stage = useApp((s) => s.stage)
  const playing = useApp((s) => s.playing)
  // the build clock moves by itself (Play, someone else's slider): followed here, drawn again only when it has moved
  const [T, setT] = useState(theatre.state.T)
  const seen = useRef(T)
  useFrame(() => { const now = theatre.state.T; if (Math.abs(now - seen.current) > 0.004 || (now !== seen.current && now === theatre.state.target)) { seen.current = now; setT(now) } })
  const s = STAGES[stage]
  return (
    <>
      <Container flexDirection="row" flexWrap="wrap" gap={4} flexShrink={0}>
        {STAGES.map((st, i) => <Stop key={st.id} stage={st} lang={lang} current={i === stage} onPress={() => { useApp.setState({ place: null }); actions.goStop(i) }} />)}
      </Container>
      <Container flexDirection="row" alignItems="flex-end" gap={8} flexShrink={0}>
        <Btn kind="cta" height={30} width={112} paddingX={4} onPress={() => actions.play()}>{t(playing ? 'pause' : 'play')}</Btn>
        <Slider flexGrow={1} label={t('timeline')} text={STAGES[stopOf(T)].years.split(' · ')[0]} min={0} max={7} step={0.01} value={T} marks={MARKS} onChange={(v) => actions.scrub(v)} />
      </Container>
      <Card flexGrow={1}>
        <Eyebrow lang={lang}>{`${stage === 0 ? '' : `${t('stageWord')} ${stage} · `}${s.years}`}</Eyebrow>
        <Title lang={lang}>{s[lang].title}</Title>
        <Para>{s[lang].text}</Para>
      </Card>
    </>
  )
}

function Stop({ stage, lang, current, onPress }) {
  return (
    <Btn kind="ghost" on={current} onPress={onPress} width={100} height={46} paddingX={2} flexDirection="column" gap={1} borderBottomWidth={2} borderColor={current ? C.accent : C.line}>
      <Text fontFamily="bebas" fontWeight="normal" fontSize={14} letterSpacing={0.7} color={current ? C.accent : C.muted}>{stage.years.split(' · ')[0]}</Text>
      <Text fontSize={SMALL} lineHeight="110%" textAlign="center" fontWeight={current ? 'bold' : 'medium'}>{stage[lang].title}</Text>
    </Btn>
  )
}

// ---------------------------------------------------------------- View
// Czech uses a decimal comma and a true minus sign (his cutLabel)
const num = (x, lang) => { const s = x.toFixed(1).replace('-', '−'); return lang === 'cz' ? s.replace('.', ',') : s }

function View({ lang, t }) {
  const actions = useActions()
  const xray = useApp((s) => s.input.xray)
  const layers = useApp((s) => s.input.layers)
  const cut = useApp((s) => s.input.cut)
  const night = useApp((s) => s.input.night)
  const toggle = (id) => { const set = new Set(layers); if (set.has(id)) set.delete(id); else set.add(id); actions.setLayers(set) }
  return (
    <>
      <Container flexDirection="row" gap={6} flexShrink={0}>
        <Seg flexGrow={1}>
          <Btn kind="seg" on={!xray} flexGrow={1} height="100%" onPress={() => actions.setXray(false)}>{t('exterior')}</Btn>
          <Btn kind="seg" on={xray} flexGrow={1} height="100%" onPress={() => actions.setXray(true)}>{t('xray')}</Btn>
        </Seg>
        <Btn height={34} on={cut.on} onPress={() => actions.setCut(!cut.on)}>{t('cut')}</Btn>
        <Seg flexGrow={1}>
          <Btn kind="seg" on={!night} flexGrow={1} height="100%" onPress={() => actions.setNight(false)}>{t('day')}</Btn>
          <Btn kind="seg" on={night} flexGrow={1} height="100%" onPress={() => actions.setNight(true)}>{t('night')}</Btn>
        </Seg>
      </Container>
      {cut.on && (
        <Card gap={6}>
          <Eyebrow lang={lang}>{t('cut')}</Eyebrow>
          <Slider label={t('cutLong')} text={`${num(cut.u, lang)} m ${t('fromAxis')}`} min={-26} max={22} value={cut.u} onChange={(u) => actions.setCutValues(u, cut.y)} />
          <Slider label={t('cutPlan')} text={cut.y >= 45.9 ? '—' : `${num(cut.y + 191.3, lang)} ${t('asl')}`} min={-8} max={46} value={cut.y} onChange={(y) => actions.setCutValues(cut.u, y)} />
        </Card>
      )}
      {xray && (
        <Card gap={4}>
          <Container flexDirection="row" alignItems="center" gap={4}>
            <Eyebrow lang={lang} marginRight="auto">{t('layers')}</Eyebrow>
            <Btn kind="ghost" height={24} size={SMALL} onPress={() => actions.setLayers(new Set(LAYERS.map((l) => l.id)))}>{t('all')}</Btn>
            <Btn kind="ghost" height={24} size={SMALL} onPress={() => actions.setLayers(new Set())}>{t('none')}</Btn>
          </Container>
          <Container flexDirection="row" flexWrap="wrap">
            {LAYERS.map((l) => {
              const on = layers.includes(l.id)
              return (
                <Btn key={l.id} kind="ghost" on={on} width="50%" height={26} paddingX={6} gap={9} justifyContent="flex-start" onPress={() => toggle(l.id)}>
                  <Container width={9} height={9} backgroundColor={l.color} opacity={on ? 1 : 0.3} flexShrink={0} />
                  <Text>{l[lang]}</Text>
                </Btn>
              )
            })}
          </Container>
        </Card>
      )}
    </>
  )
}

// ---------------------------------------------------------------- Fire
function FireTab({ lang, t }) {
  const actions = useActions()
  const burning = useApp((s) => s.input.fire.s === 1)
  return (
    <>
      <Btn kind="fire" height={34} alignSelf="flex-start" on={burning} onPress={() => actions.fire(!burning)}>{t('fire')}</Btn>
      <Card borderColor={C.danger}>
        <Title lang={lang}>{t('fireTitle')}</Title>
        <Para>{t('fireText')}</Para>
        <Image src="textures/pozar.jpg" width="100%" height={130} objectFit="cover" keepAspectRatio={false} flexShrink={0} />
        <Text fontSize={SMALL} color={C.muted}>{t('fireCredit')}</Text>
        {burning && <Btn kind="cta" height={34} alignSelf="flex-start" onPress={() => actions.rebuild()}>{t('rebuild')}</Btn>}
      </Card>
    </>
  )
}

// ---------------------------------------------------------------- Places
function Places({ lang, t }) {
  const actions = useActions()
  const place = useApp((s) => s.place)
  const noclip = useApp((s) => s.noclip)
  const teleportOnly = useApp((s) => s.teleportOnly)
  // how to teleport with what is in the person's hands right now (components/Teleport.jsx)
  const menuHand = useApp((s) => s.menuHand)
  const hands = useApp((s) => s.xrInput) === 'hands'
  const pointing = t(menuHand === 'left' ? 'teleRight' : 'teleLeft'), carrying = t(menuHand === 'left' ? 'teleLeft' : 'teleRight')
  const how = hands ? t('teleHand').replace('{hand}', pointing) : noclip ? t('teleTrigger').replace('{hand}', carrying) : t('teleStick').replace('{hand}', pointing)
  return (
    <>
      <Card>
        <Eyebrow lang={lang}>{t('views')}</Eyebrow>
        <Container flexDirection="row" flexWrap="wrap" gap={4}>
          {VIEWPOINTS.map((vp) => <Btn key={vp.id} kind="view" on={place === vp.id} width={192} height={30} justifyContent="flex-start" onPress={() => actions.viewpoint(vp.id)}>{vp[lang]}</Btn>)}
        </Container>
      </Card>
      <Container flexDirection="row" gap={6} flexShrink={0}>
        <Btn height={34} onPress={() => actions.backToStreet()}>{t('street')}</Btn>
        <Btn height={34} on={noclip} onPress={() => actions.setNoclip(!noclip)}>{t('noclip')}</Btn>
        <Btn height={34} on={teleportOnly} onPress={() => setTeleportOnly(!teleportOnly)}>{t('teleOnly')}</Btn>
      </Container>
      <Para>{how}</Para>
    </>
  )
}

// ---------------------------------------------------------------- About
/** His About text as paragraphs and list items: the same words as in the dialog on the computer. */
function aboutBlocks(lang) {
  const blocks = []
  for (const m of aboutHTML(lang).matchAll(/<(p|li)>([\s\S]*?)<\/\1>/g)) {
    blocks.push({ item: m[1] === 'li', text: m[2].replace(/<[^>]+>/g, '').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim() })
  }
  return blocks
}

function About({ lang, t, hand }) {
  const blocks = useMemo(() => aboutBlocks(lang), [lang])
  return (
    <>
      <Container flexDirection="row" alignItems="center" gap={8} flexShrink={0}>
        <Seg>
          <Btn kind="seg" on={lang === 'cz'} width={44} height="100%" onPress={() => setLang('cz')}>CZ</Btn>
          <Btn kind="seg" on={lang === 'en'} width={44} height="100%" onPress={() => setLang('en')}>EN</Btn>
        </Seg>
        <Text fontSize={SMALL} color={C.fg2} marginLeft="auto">{t('menuHand')}</Text>
        <Seg>
          <Btn kind="seg" on={hand === 'left'} height="100%" onPress={() => useApp.setState({ menuHand: 'left' })}>{t('left')}</Btn>
          <Btn kind="seg" on={hand === 'right'} height="100%" onPress={() => useApp.setState({ menuHand: 'right' })}>{t('right')}</Btn>
        </Seg>
      </Container>
      {/* drag the text with the ray or a finger to scroll it */}
      <Container flexDirection="column" gap={8} flexGrow={1} flexBasis={0} overflow="scroll" paddingRight={12} scrollbarWidth={6} scrollbarColor={C.lineHi} flexShrink={0}>
        <Title lang={lang} size={30}>{t('about')}</Title>
        {blocks.map((b, i) => (b.item ? (
          <Container key={i} flexDirection="row" gap={10} paddingTop={6} borderTopWidth={1} borderColor={C.line} flexShrink={0}>
            <Container width={6} height={6} marginTop={5} backgroundColor={C.accent} flexShrink={0} />
            <Para flexShrink={1} flexGrow={1} flexBasis={0}>{b.text}</Para>
          </Container>
        ) : <Para key={i}>{b.text}</Para>))}
        <Image src="textures/rez_1883.jpg" width="100%" flexShrink={0} />
        <Container flexDirection="row" alignItems="center" justifyContent="space-between" gap={12} paddingTop={10} borderTopWidth={1} borderColor={C.line} flexShrink={0}>
          <Container flexDirection="column">
            <Title lang={lang} size={15}>Lukáš Eršil</Title>
            <Text fontSize={SMALL} color={C.muted}>@lukasersil</Text>
          </Container>
          <Container flexDirection="column" alignItems="flex-end">
            <Text fontSize={SMALL} fontWeight="bold" letterSpacing={1.6} color={C.muted}>{upper(t('author'), lang)}</Text>
            <Text fontSize={SMALL} letterSpacing={0.8} color={C.muted}>{upper(`${t('backend')}: WebGL 2`, lang)}</Text>
          </Container>
        </Container>
      </Container>
    </>
  )
}
