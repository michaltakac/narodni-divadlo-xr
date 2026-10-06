// The "Wardrobe" tab of the menu inside the headset: the same choices, in the same words, as the wardrobe panel
// on a computer (components/Wardrobe.jsx). The outfits with their small pictures, four cloth colours, four skin
// tones, the name on the plate (typed on the keys that take the list's place while you type), and "Mirror",
// which stands a tall mirror in front of you until you close it.
import { useMemo, useState } from 'react'
import { Container, Image, Text } from '@react-three/uikit'
import { Btn, C, SMALL } from './XRUI'
import { usePress } from '../lib/interaction'
import { thumbnail } from '../lib/people/studio'
import { NAME_MAX, OUTFITS, SKINS, setLook, useWardrobe } from '../lib/people/wardrobe'
import { sessionName } from '../lib/names'
import { useApp } from '../lib/theatre/app'

const ROWS = ['ěščřžýáíéúů', 'qwertzuiop', 'asdfghjkl', 'yxcvbnmďťňó'].map((r) => [...r])

export function WardrobeTab({ lang, t }) {
  const look = useWardrobe()
  const mirror = useApp((s) => s.mirror)
  const [typing, setTyping] = useState(false)
  const [caps, setCaps] = useState(true)
  // every outfit in the chosen colour number and skin
  const pictures = useMemo(() => OUTFITS.map((o, outfit) => thumbnail({ outfit, cloth: look.cloth, skin: look.skin })), [look.cloth, look.skin])
  const type = (ch) => {
    if (look.name.length >= NAME_MAX) return
    setLook({ name: look.name + (caps ? ch.toLocaleUpperCase('cs') : ch) })
    setCaps(ch === ' ')
  }
  return (
    <>
      <Container flexDirection="row" alignItems="flex-end" gap={6} flexShrink={0}>
        <Container flexDirection="column" gap={2} flexGrow={1} flexBasis={0}>
          <Text fontSize={SMALL} color={C.fg2}>{t('plateName')}</Text>
          <Btn kind="view" on={typing} height={30} justifyContent="flex-start" onPress={() => { setCaps(look.name === '' || look.name.endsWith(' ')); setTyping(!typing) }}>
            {typing ? `${look.name}|` : look.name.trim() || sessionName()}
          </Btn>
        </Container>
        <Btn height={30} on={mirror} onPress={() => useApp.setState({ mirror: !mirror })}>{t('mirror')}</Btn>
      </Container>

      {typing ? (
        <Container flexDirection="column" gap={3} height={212} flexShrink={0} justifyContent="center">
          {ROWS.map((row, i) => (
            <Container key={i} flexDirection="row" gap={3} justifyContent="center">
              {row.map((ch) => <Btn key={ch} kind="view" width={34} height={34} paddingX={0} size={14} onPress={() => type(ch)}>{caps ? ch.toLocaleUpperCase('cs') : ch}</Btn>)}
            </Container>
          ))}
          <Container flexDirection="row" gap={3} justifyContent="center">
            <Btn kind="view" on={caps} width={60} height={34} paddingX={0} onPress={() => setCaps(!caps)}>ABC</Btn>
            <Btn kind="view" width={150} height={34} onPress={() => type(' ')}>{t('keySpace')}</Btn>
            <Btn kind="view" width={86} height={34} paddingX={0} onPress={() => { setLook({ name: look.name.slice(0, -1) }); setCaps(look.name.length <= 1) }}>{t('keyDelete')}</Btn>
            <Btn kind="cta" width={86} height={34} paddingX={0} onPress={() => { setLook({ name: look.name.trim() }); setTyping(false) }}>{t('keyDone')}</Btn>
          </Container>
        </Container>
      ) : (
        <Container flexDirection="row" flexWrap="wrap" gap={4} height={212} flexShrink={0} alignContent="flex-start">
          {OUTFITS.map((o, i) => (
            <Btn key={o.id} kind="view" on={look.outfit === i} width={203} height={50} paddingX={4} gap={8} justifyContent="flex-start" onPress={() => setLook({ outfit: i })}>
              <Image src={pictures[i]} width={30} height={42} flexShrink={0} keepAspectRatio={false} backgroundColor={look.outfit === i ? '#f6f1e4' : '#0d0d0d'} />
              <Text flexGrow={1} flexBasis={0} flexShrink={1} lineHeight="120%">{o[lang]}</Text>
            </Btn>
          ))}
        </Container>
      )}

      <Container flexDirection="row" gap={16} flexShrink={0}>
        <Swatches label={t('cloth')} colors={OUTFITS[look.outfit].cloth} chosen={look.cloth} onPick={(cloth) => setLook({ cloth })} />
        <Swatches label={t('skin')} colors={SKINS} chosen={look.skin} onPick={(skin) => setLook({ skin })} />
      </Container>
    </>
  )
}

function Swatches({ label, colors, chosen, onPick }) {
  return (
    <Container flexDirection="column" gap={3} flexGrow={1} flexBasis={0}>
      <Text fontSize={SMALL} color={C.fg2}>{label}</Text>
      <Container flexDirection="row" gap={5}>
        {colors.map((color, i) => <Swatch key={i} color={color} on={chosen === i} onPress={() => onPick(i)} />)}
      </Container>
    </Container>
  )
}

function Swatch({ color, on, onPress }) {
  const { hovered, handlers } = usePress({ onPress })
  return <Container flexGrow={1} flexBasis={0} height={30} backgroundColor={color} borderWidth={on ? 3 : 1} borderColor={on ? C.accent : hovered ? C.fg : C.lineHi} {...handlers} />
}
