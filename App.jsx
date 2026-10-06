// The National Theatre in Prague (Národní divadlo) as a place several people walk through together, on a
// screen and in a headset. The model is by Lukáš Eršil (lib/nd, MIT, see NOTICE.md); everyone in the room
// sees the same building state and each other as figures in the clothes of 1868 to 1883 (components/People.jsx,
// on the poses of the multi-user kit, read MULTIPLAYER.md) and can write to each other (lib/chat.js).
import { Canvas } from '@react-three/fiber'
import { ACESFilmicToneMapping } from 'three'
import { XR, PointerEvents, createXRStore, noEvents } from '@react-three/xr'
import { Multiplayer } from './components/Multiplayer'
import { Hand, Controller } from './components/Hands'
import { Room } from './components/Room'
import { Overlay } from './components/Overlay'
import { PerfProbe, PerfReadout } from './components/Perf'
import { FOV } from './components/Walk'
import { LIGHT, say } from './lib/theatre/app'
import { Touch } from './components/Touch'
import { Wardrobe } from './components/Wardrobe'
import { Wearing } from './components/People'
import { Chat, ChatLink } from './components/Chat'
import { useWardrobe } from './lib/people/wardrobe'
import { sessionName } from './lib/names'
import './App.css'

// Hands first, controllers as a fallback; both get the same pointers (ray, grab, and poke for hands).
// One way into the headset, the "Enter VR" button of the masthead: no session is offered to the browser's own
// button besides it (the emulator in Graspable's preview drew that offer as a second "Enter XR" pill).
const store = createXRStore({ emulate: false, offerSession: false, hand: Hand, controller: Controller })

// no headset, or the browser refused: say so instead of failing silently
const enterVR = () => store.enterVR().catch(() => say({ cz: 'Nenašel jsem žádný headset pro VR.', en: 'No VR headset was found.' }))

// A scripted browser (Graspable's checks, which replay recorded headset sessions) gets a room of its own with every
// page load, unless the address names one: the relay keeps a room's building state and its chat, and a replay must
// start where its recording started, not where the check before it left the room. People are not affected.
const scripted = typeof navigator !== 'undefined' && navigator.webdriver && !new URLSearchParams(location.search).has('room')
const ROOM = scripted ? `dev-check-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}` : undefined

export default function App() {
  // the name on the plate: the one chosen in the wardrobe, else the kit's own for this tab
  const name = useWardrobe((s) => s.name.trim()) || sessionName()
  return (
    <>
      {/* noEvents + <PointerEvents />: the mouse goes through the same pointer events as hands and controllers. */}
      <Canvas
        shadows="percentage" events={noEvents} dpr={LIGHT ? [1, 1.5] : [1, 2]}
        gl={{ antialias: true, powerPreference: 'high-performance', toneMapping: ACESFilmicToneMapping, toneMappingExposure: 1.05 }}
        camera={{ position: [0, 1.65, 0], fov: FOV, near: 0.12, far: 5000 }}
      >
        <PointerEvents />
        <XR store={store}>
          {/* the kit's head-and-hands avatars are replaced by the figures of components/People.jsx */}
          <Multiplayer avatars={false} name={name} room={ROOM}>
            <Wearing />
            <ChatLink />
            <Room />
          </Multiplayer>
        </XR>
        <PerfProbe />
      </Canvas>
      {/* the controls on a computer and a phone; inside the headset the menu is in the scene (components/XRMenu.jsx) */}
      <Overlay onEnterVR={enterVR} />
      <Wardrobe />
      <Chat />
      <Touch />
      <PerfReadout />
    </>
  )
}
