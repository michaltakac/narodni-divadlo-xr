# Notice

This project is a multi-user WebXR version of **Národní divadlo 3D**, the interactive model of the National
Theatre in Prague by **Lukáš Eršil** (<https://github.com/lukasersil/narodni-divadlo-3d>, MIT licence). We found
it through his post on X (<https://x.com/lukasersil/status/2107068853154992567>). The multi-user WebXR version
was made in Graspable.

## What comes from his project

Everything under `lib/nd/` is his code and data, with his `LICENSE` (MIT, © 2026 Lukáš Eršil) next to it.

| Here | From his repository | State |
|---|---|---|
| `lib/nd/building/*.js` (shell, facade, interior, partitions, scaffold, sculpture, stage, systems, util) | `src/building/` | unchanged |
| `lib/nd/core/geom.js`, `lib/nd/core/registry.js` | `src/core/` | unchanged |
| `lib/nd/config.js`, `lib/nd/trams.js`, `lib/nd/fx/fire.js` | `src/` | unchanged |
| `lib/nd/data/content.js`, `data/site.js`, `data/partitions.js` | `src/data/` | unchanged |
| `lib/nd/core/materials.js` | `src/core/materials.js` | one line: textures are loaded from `textures/` instead of `assets/` |
| `lib/nd/site.js` | `src/site.js` | changed for walking at 1:1: the terrain sampler knows the ground is flattened round the theatre (as his terrain mesh draws it), and the road strips have a point every 2.5 m and five across, so roads, tram tracks, trees and derricks lie on the drawn ground instead of floating up to 1.8 m above it |
| `lib/nd/ui.js` | `src/ui.js` | changed: buttons ask for a change and show the state everyone shares; "Walk through walls", "Back to the street", the "Wardrobe" button (its words come from `lib/people/wardrobe.js`), notices and offers (one line you can press) added; a hint for touch screens; "About" starts with the credit for this version; his portrait is not used; pictures come from `textures/` |
| `lib/nd/markup.js`, `lib/nd/ui.css` | the body and the `<style>` of `index.html` | changed: his masthead is replaced, three toolbar buttons and a performance readout added, notices show on a phone, the stage card stays clear of the toolbar on a phone held sideways, the 3D stage is this app's canvas |
| `public/textures/*.jpg` | `assets/` | unchanged copies (see the licences below) |

Not taken over: `assets/avatar.png` (his portrait and signature), `src/main.js` (his renderer, orbit camera and
main loop; its scene set-up, viewpoints, build clock and day/night logic are ported in `lib/theatre/model.js`),
`src/core/shaderdedupe.js` (specific to the WebGPU renderer), `tools/` and `serve.py`.

His model is written for three.js's WebGPU renderer and node materials. This app draws with the WebGL renderer
(one renderer for screen and headset). `lib/theatre/webgpu.js` and `lib/theatre/tsl.js` stand in for
`three/webgpu` and `three/tsl` (see `vite.config.js`) and turn his node expressions into GLSL, which is why his
geometry, registry, materials and fire run as he wrote them.

## Licences of the data and textures

These keep their own licences (as listed in his README and in "About the model"); name them when you pass the
project on, and share changed CC BY-SA textures under the same licence.

- **Footprint**: RÚIAN (no. 223), ČÚZK, CC BY 4.0. **Heights, surrounding buildings and terrain**: IPR Praha,
  Budovy 3D and height rasters, CC BY 4.0. **River, bridge and streets**: © OpenStreetMap contributors, ODbL.
  These are in `lib/nd/data/site.js`.
- **Layout**: J. Fialka's plans and long section (Šubert's guide, 1883) and the 1914 section from Architektonický
  obzor, public domain; vectorised in `lib/nd/data/partitions.js`.
- **Stage machinery and building services**: figures taken from the ND technical documentation (2008–2021),
  V. Mužík's series in TOPIN (2023–2025) and ENESA / ND (2018, 2026); the texts are Lukáš Eršil's own.
- **Historic illustrations** for the cards and "About" (`fasada_1883`, `krov_1876`, `lomy`, `lustr`, `nadrze`,
  `opona_zenisek`, `pozar`, `pudorys_1883`, `rez_1883`, `triga`, `zakladni_kamen`): F. A. Šubert, Národní divadlo
  v Praze (1881, 1883) and the Světozor magazine (1881, 1883), public domain.
- **Interior textures made from photographs** (Wikimedia Commons): `tex_curtain.jpg`, the Hynais curtain after a
  photo by Lehotsky, CC BY-SA 3.0; `tex_ceiling.jpg`, the auditorium ceiling with Ženíšek's paintings after a
  photo by Dobroš, CC BY-SA 4.0, rectified to the plan; `tex_foyer_ceiling.jpg` and `tex_foyer_lunette.jpg`, the
  foyer ceiling and Aleš's lunettes after photos by Palickap, CC BY-SA 3.0. The paintings themselves are public
  domain.
- **Other interior textures** (`tex_parapet.jpg`, `tex_parapet_scroll.jpg`, `tex_lambrequin.jpg`,
  `tex_frieze.jpg`, `tex_backdrop_landscape.jpg`, `tex_backdrop_temple.jpg`): made by his
  `tools/prep_textures.py`. His README says the gilt parapet reliefs and the garlands are drawn procedurally; it
  names no separate source for the others.
- **Fonts**: Bebas Neue (Ryoichi Tsunekawa, Dharma Type) and DM Sans (Colophon Foundry, Jonny Pinhorn, Indian
  Type Foundry), SIL Open Font License 1.1. The HTML interface loads them from Google Fonts. The menu inside the
  headset uses copies that come with the app, so it works offline: `public/fonts/bebas-neue.json|png` and
  `public/fonts/dm-sans-500.json|png`, `dm-sans-700.json|png` are distance-field atlases made from the Google
  Fonts TTF files with `msdf-bmfont-xml` (48 px, range 4, only the characters the texts use plus the Czech
  alphabet; a new character in a text needs the atlas made again), and `public/fonts/bebas-neue.ttf` is the
  font file itself, for the numerals on the hotspot markers.
- **Panels in the scene**: `@react-three/uikit` (pmndrs, Bela Bohlender), MIT.

## What is new here

`App.jsx`, `components/Room.jsx`, `Walk.jsx`, `Touch.jsx`, `Overlay.jsx`, `Perf.jsx`, `Notice.jsx`, `XRMenu.jsx`,
`XRHotspots.jsx`, `XRUI.jsx` (the menu and the hotspots inside the headset, in his look and wording), `lib/theatre/*` and
`lib/spawn.js` were written for this version. The multi-user kit (`components/Multiplayer.jsx`,
`components/Avatar.jsx`, `lib/multiplayer.js`, see `MULTIPLAYER.md`) is Graspable's.
