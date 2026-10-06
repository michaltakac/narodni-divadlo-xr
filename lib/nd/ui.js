// Lukáš Eršil's interface (src/ui.js of narodni-divadlo-3d, MIT), changed for this multi-user version:
//  - the toolbar buttons only ask for a change (actions.*); what they show comes back through syncShared(),
//    so a change made by someone else in the room moves the same buttons
//  - "Walk through walls", "Back to the street", "Wardrobe" and short notices are new; the viewpoints take you to a place;
//    a notice can be an offer (one line you can press, e.g. "Watch from the river" after Play on the street)
//  - on a touch screen the hint names the thumb stick instead of the keys
//  - the hint mentions the double-click (double-tap) that takes you to a spot, and the texts for teleporting
//    (components/Teleport.jsx, the Places tab of the menu in the headset) are here with the others
//  - "About" starts with the credit for this version and no longer shows the author's portrait
//  - pictures are loaded from textures/ and every listener ends with the `signal` it is given
//  - the texts, the About text and the rule for which hotspots show are exported: the menu in the headset
//    (components/XRMenu.jsx, components/XRHotspots.jsx) uses the same ones
import * as THREE from 'three/webgpu';
import { HOTSPOTS, UI_TEXT as UI_BASE } from './data/content.js';
import { bToWorld, audToB, FRAME, FP, H } from './config.js';
import { pointInPolygon } from './core/geom.js';
import { WARDROBE_TEXT } from '../people/wardrobe.js';
import { CHAT_TEXT } from '../chat.js';

const $ = (id) => document.getElementById(id);

// texts this version adds or replaces
const UI_EXTRA = {
  cz: {
    hint: 'W A S D chůze · šipky otáčení a pohled · tažením myši rozhlížení · dvojklik na zem vás tam přenese · Shift rychleji · M ukáže vás',
    hintTouch: 'Páčkou vlevo dole chůze · tažením prstu rozhlížení · dvojím klepnutím na zem se tam přenesete',
    watchRiver: 'Sledovat od řeky',
    noclip: 'Procházet zdmi',
    noclipTitle: 'Projdete vším a můžete stoupat (E) a klesat (Q). Platí jen pro vás.',
    street: 'Zpět na ulici',
    airNotice: 'Tohle místo je ve vzduchu: zapnul jsem vám „Procházet zdmi“. E nahoru, Q dolů.',
    // teleporting (components/Teleport.jsx); {hand} is teleRight or teleLeft
    teleFar: 'Tak daleko to najednou nejde: nejvýš 12 metrů.',
    teleStick: 'Teleport: {hand} páčku dopředu a držet, obloukem zamířit, páčkou do stran natočit šipku, pustit.',
    teleTrigger: 'Teleport: držte {hand} spoušť, zamiřte obloukem a pusťte. (Páčka vás teď nese nahoru a dolů.)',
    teleHand: 'Teleport: ukažte {hand} rukou, dlaní vzhůru a s nataženým ukazovákem. Spojením palce a ukazováku se přenesete.',
    teleRight: 'pravou', teleLeft: 'levou',
    teleOnly: 'Jen teleport',
  },
  en: {
    hint: 'W A S D to walk · arrows to turn and look · drag to look around · double-click the ground to go there · Shift to go faster · M shows you',
    hintTouch: 'Thumb stick in the lower left to walk · drag to look around · double-tap the ground to go there',
    watchRiver: 'Watch from the river',
    noclip: 'Walk through walls',
    noclipTitle: 'You pass through everything and can go up (E) and down (Q). Only for you.',
    street: 'Back to the street',
    airNotice: 'This spot is in mid-air: “Walk through walls” is now on for you. E up, Q down.',
    teleFar: 'That is too far for one move: 12 metres at most.',
    teleStick: 'Teleport: push the {hand} thumbstick forward and hold, aim the arc, turn the stick to turn the arrow, let go.',
    teleTrigger: 'Teleport: hold the {hand} trigger, aim the arc, let go. (The thumbstick now moves you up and down.)',
    teleHand: 'Teleport: point with your {hand} hand, palm up, index finger out. Pinch thumb and index finger to go.',
    teleRight: 'right', teleLeft: 'left',
    teleOnly: 'Teleport only',
  },
};
export const UI_TEXT = { cz: { ...UI_BASE.cz, ...UI_EXTRA.cz, ...WARDROBE_TEXT.cz, ...CHAT_TEXT.cz }, en: { ...UI_BASE.en, ...UI_EXTRA.en, ...WARDROBE_TEXT.en, ...CHAT_TEXT.en } };

/** The About text (the credit for this multi-user version, then his own text), also read by the menu in the headset. */
export function aboutHTML(lang) {
  // the credit for this multi-user version, in front of his own text
  const czCredit = `<p>Model vytvořil Lukáš Eršil (<a href="https://github.com/lukasersil/narodni-divadlo-3d" target="_blank" rel="noopener">github.com/lukasersil/narodni-divadlo-3d</a>, MIT). Našli jsme ho díky jeho příspěvku na X (<a href="https://x.com/lukasersil/status/2107068853154992567" target="_blank" rel="noopener">x.com/lukasersil/status/2107068853154992567</a>) a Michal Takáč si řekl, že by byla zábava vyzkoušet, kam až ho Graspable dokáže posunout: tato víceuživatelská verze pro WebXR vznikla v Graspable.</p>`;
  const enCredit = `<p>The model is by Lukáš Eršil (<a href="https://github.com/lukasersil/narodni-divadlo-3d" target="_blank" rel="noopener">github.com/lukasersil/narodni-divadlo-3d</a>, MIT). We found it through his post on X (<a href="https://x.com/lukasersil/status/2107068853154992567" target="_blank" rel="noopener">x.com/lukasersil/status/2107068853154992567</a>), and Michal Takáč thought it would be fun to test how far Graspable can take it: this multi-user WebXR version was made in Graspable.</p>`;
  const czText = `
    <p>Interaktivní model historické budovy Národního divadla (Josef Zítek, Josef Schulz, 1868–1883). Časová osa ukazuje postup stavby ve zjednodušených etapách: základy, zdivo, železnou kopuli, kamennou fasádu, interiéry a jevištní techniku; na konci je budova v dnešní podobě. Režim Rentgen zprůhlední plášť a ukáže konstrukce a technické systémy, Řez otevře budovu podél osy jako historický výkres.</p>
    <ul>
      <li>Půdorys: RÚIAN (č. p. 223, ČÚZK, CC BY 4.0); výšky, okolní budovy a terén: IPR Praha – Budovy 3D a výškové rastry (CC BY 4.0); řeka, most a ulice: © přispěvatelé OpenStreetMap (ODbL).</li>
      <li>Dispozice: půdorysy a podélný řez J. Fialky (Šubertův průvodce 1883) a řez z Architektonického obzoru 1914.</li>
      <li>Jevištní technika: technická dokumentace ND (2008–2021); TZB: seriál V. Mužíka, TOPIN 2023–2025; energetika: ENESA, ND 2018 a 2026.</li>
      <li>Historie: F. A. Šubert, Národní divadlo v Praze (1881, 1883), a časopis Světozor (1881, 1883); obrazové přílohy jsou volné dílo.</li>
      <li>Textury interiéru: Hynaisova opona podle fotografie Lehotsky (Wikimedia Commons, CC BY-SA 3.0); strop hlediště se Ženíškovými malbami podle fotografie Dobroš (CC BY-SA 4.0), narovnané do půdorysu; strop foyeru a Alšovy lunety podle fotografií Palickap (CC BY-SA 3.0); malby samotné jsou volné dílo.</li>
      <li>Fasády, střecha a kopule jsou porovnané s fotografiemi z Wikimedia Commons.</li>
    </ul>
    <p>Model je zjednodušená rekonstrukce v měřítku 1&nbsp;:&nbsp;1. Sochy a lustr jsou schematické; opona, stropy a lunety jsou textury z fotografií.</p>
    <p>Zdrojový kód je volně ke stažení na <a href="https://github.com/lukasersil/narodni-divadlo-3d" target="_blank" rel="noopener">GitHubu</a> (licence MIT). Model si můžete stáhnout a rozvíjet dál.</p>`;
  const enText = `
    <p>An interactive model of the National Theatre’s historic building (Josef Zítek, Josef Schulz, 1868–1883). The timeline shows the construction in simplified phases: foundations, walls, the iron dome, the stone façade, interiors and stage machinery, ending with the building as it is today. X-ray turns the shell transparent to show structure and building services; Section opens the building along its axis like the historic drawing.</p>
    <ul>
      <li>Footprint: RÚIAN (no. 223, ČÚZK, CC BY 4.0); heights, surrounding buildings and terrain: IPR Praha Buildings 3D and height rasters (CC BY 4.0); river, bridge and streets: © OpenStreetMap contributors (ODbL).</li>
      <li>Layout: J. Fialka’s plans and long section (Šubert’s guide, 1883) and the 1914 section from Architektonický obzor.</li>
      <li>Stage machinery: ND technical documentation (2008–2021); building services: V. Mužík’s series, TOPIN 2023–2025; energy: ENESA, ND 2018 and 2026.</li>
      <li>History: F. A. Šubert, Národní divadlo v Praze (1881, 1883), and the Světozor magazine (1881, 1883); illustrations are public domain.</li>
      <li>Interior textures: Hynais curtain after a photo by Lehotsky (Wikimedia Commons, CC BY-SA 3.0); the auditorium ceiling with Ženíšek’s paintings after a photo by Dobroš (CC BY-SA 4.0), rectified to the plan; the foyer ceiling and Aleš’s lunettes after photos by Palickap (CC BY-SA 3.0); the paintings themselves are public domain.</li>
      <li>Façades, roof and dome were checked against photographs from Wikimedia Commons.</li>
    </ul>
    <p>The model is a simplified 1:1 reconstruction. Statues and the chandelier are schematic; the curtain, ceilings and lunettes are textures made from photographs.</p>
    <p>The source code is free to download on <a href="https://github.com/lukasersil/narodni-divadlo-3d" target="_blank" rel="noopener">GitHub</a> (MIT licence), so you can take the model and build on it.</p>`;
  return lang === 'cz' ? czCredit + czText : enCredit + enText;
}

/** Where a hotspot stands, in world space. aud: position given in the auditorium frame (Zítek's axis, see AXIS in config.js). */
export function hotspotWorld(h) {
  const [bu, bv] = h.aud ? audToB(h.pos[0], h.pos[2]) : [h.pos[0], h.pos[2]];
  return h.world ? new THREE.Vector3(...h.pos) : bToWorld(bu, h.pos[1], bv);
}
const cosR = Math.cos(FRAME.rotationY), sinR = Math.sin(FRAME.rotationY);
/** Is a world point inside the building? (then exterior hotspots would float through the walls) */
export function insideBuilding(p) {
  const dx = p.x - FRAME.origin.x, dz = p.z - FRAME.origin.z;
  return p.y < H.cornice && pointInPolygon(dx * cosR - dz * sinR, dx * sinR + dz * cosR, FP.all);
}
/** Does hotspot `h` belong to the mode, stop and episode shown now? `inside`: the viewer stands in the building. */
export function hotspotBelongs(h, state, STAGES, current, T, inside) {
  if (h.layer) return !state.fire && state.xray && state.layers.has(h.layer) && T > 6.05; // services are built in stage 6
  return !state.xray && !state.fire && (h.stops ?? []).includes(current) && T >= Math.min(h.from ?? 0, STAGES[current].t) - 0.001
    && (h.needsCut ? state.cutOn || inside : !inside); // interior hotspots need the section or a camera inside
}

export function initUI({ state, STAGES, LAYERS, VIEWPOINTS = [], backend, camera, renderer, actions, signal, touch = false }) {
  const t = (k) => UI_TEXT[state.lang][k] ?? k;

  // ---------------------------------------------------------------- timeline
  const stops = $('stops');
  const knots = $('knots');
  STAGES.forEach((s, i) => {
    const b = document.createElement('button');
    b.className = 'stop';
    b.innerHTML = `<span class="yr"></span><span class="nm"></span>`;
    b.addEventListener('click', () => actions.goStop(i));
    stops.appendChild(b);
    const k = document.createElement('div');
    k.className = 'knot';
    k.style.left = `${(i / (STAGES.length - 1)) * 100}%`;
    knots.appendChild(k);
  });
  const scrub = $('scrub');
  scrub.addEventListener('input', () => actions.scrub(parseFloat(scrub.value)));

  const playBtn = $('btn-play');
  playBtn.addEventListener('click', () => actions.play());

  // ---------------------------------------------------------------- toolbar
  const ext = $('btn-ext'), xr = $('btn-xray');
  const setX = (on) => {
    actions.setXray(on);
    if (on && window.innerWidth > 760) openPanel(true);
  };
  ext.addEventListener('click', () => setX(false));
  xr.addEventListener('click', () => setX(true));

  const cutBtn = $('btn-cut');
  cutBtn.addEventListener('click', () => {
    const on = cutBtn.getAttribute('aria-pressed') !== 'true';
    actions.setCut(on);
    if (on && window.innerWidth > 760) openPanel(true);
  });
  const cutLong = $('cut-long'), cutPlan = $('cut-plan');
  const cutLabel = () => {
    // Czech uses a decimal comma and a true minus sign
    const num = (x) => { const s = x.toFixed(1).replace('-', '−'); return state.lang === 'cz' ? s.replace('.', ',') : s; };
    $('cut-long-v').textContent = `${num(+cutLong.value)} m ${t('fromAxis')}`;
    $('cut-plan-v').textContent = +cutPlan.value >= 45.9 ? '—' : `${num(+cutPlan.value + 191.3)} ${t('asl')}`;
  };
  const onCut = () => { cutLabel(); actions.setCutValues(parseFloat(cutLong.value), parseFloat(cutPlan.value)); };
  cutLong.addEventListener('input', onCut);
  cutPlan.addEventListener('input', onCut);
  // a released slider gives the keyboard back, so the arrow keys turn you again
  for (const r of [cutLong, cutPlan, scrub]) r.addEventListener('change', () => r.blur());
  cutLabel();

  const nightBtn = $('btn-night');
  nightBtn.addEventListener('click', () => {
    actions.setNight(nightBtn.getAttribute('aria-pressed') !== 'true');
  });

  // each person's own: walking through walls and the way back to the start
  const noclipBtn = $('btn-noclip');
  noclipBtn.addEventListener('click', () => actions.setNoclip(noclipBtn.getAttribute('aria-pressed') !== 'true'));
  $('btn-street').addEventListener('click', () => { clearViews(); actions.backToStreet(); });
  // the wardrobe: its panel is this version's own (components/Wardrobe.jsx)
  const wardrobeBtn = $('btn-wardrobe');
  wardrobeBtn.addEventListener('click', () => actions.setWardrobe(wardrobeBtn.getAttribute('aria-pressed') !== 'true'));

  // ---------------------------------------------------------------- bottom: description card and timeline can be put away
  // the description card is the stage card, or the fire card while the theatre burns; × or the "i" button hides it,
  // the chevron folds the whole timeline into a tab in the corner
  const bottomView = { desc: true, timeline: true };
  let fireOn = false;
  const descBtn = $('btn-desc');
  function applyBottom() {
    $('stagecard').classList.toggle('dismissed', !bottomView.desc);
    $('firecard').hidden = !(fireOn && bottomView.desc);
    descBtn.setAttribute('aria-pressed', String(bottomView.desc));
    document.body.classList.toggle('tl-hidden', !bottomView.timeline);
  }
  const setDesc = (on) => { bottomView.desc = on; applyBottom(); };
  descBtn.addEventListener('click', () => setDesc(!bottomView.desc));
  $('sc-close').addEventListener('click', () => setDesc(false));
  $('fire-close').addEventListener('click', () => setDesc(false));
  $('btn-tl-hide').addEventListener('click', () => { bottomView.timeline = false; applyBottom(); $('tl-show').focus(); });
  $('tl-show').addEventListener('click', () => { bottomView.timeline = true; applyBottom(); $('btn-tl-hide').focus(); });

  const fireBtn = $('btn-fire');
  function fireUI(on) {
    fireOn = on;
    fireBtn.setAttribute('aria-pressed', String(on));
    $('stagecard').style.visibility = on ? 'hidden' : '';
    applyBottom();
  }
  fireBtn.addEventListener('click', () => {
    actions.fire(fireBtn.getAttribute('aria-pressed') !== 'true');
  });
  $('btn-rebuild').addEventListener('click', () => actions.rebuild());

  const panelBtn = $('btn-panel');
  const side = $('side');
  function openPanel(on) {
    side.dataset.collapsed = String(!on);
    panelBtn.setAttribute('aria-expanded', String(on));
    $('stagecard').classList.toggle('show-mobile', !on); // mobile: panel and stage card share the bottom area
  }
  panelBtn.addEventListener('click', () => openPanel(side.dataset.collapsed === 'true'));
  openPanel(window.innerWidth > 760);

  // ---------------------------------------------------------------- viewpoints
  const viewWrap = $('views');
  const viewBtns = VIEWPOINTS.map((vp) => {
    const b = document.createElement('button');
    b.className = 'view-btn';
    b.setAttribute('aria-pressed', 'false');
    b.addEventListener('click', () => {
      viewBtns.forEach((x) => x.setAttribute('aria-pressed', String(x === b)));
      actions.viewpoint(vp.id);
    });
    viewWrap.appendChild(b);
    return b;
  });
  const clearViews = () => viewBtns.forEach((x) => x.setAttribute('aria-pressed', 'false'));
  stops.addEventListener('click', clearViews);

  // ---------------------------------------------------------------- layers
  const layerWrap = $('layers');
  const layerBtns = LAYERS.map((l) => {
    const b = document.createElement('button');
    b.className = 'layer';
    b.setAttribute('aria-pressed', 'true');
    b.innerHTML = `<span class="dot" style="background:${l.color}"></span><span class="lbl"></span>`;
    b.addEventListener('click', () => {
      const set = new Set(state.layers);
      if (set.has(l.id)) set.delete(l.id); else set.add(l.id);
      apply(set);
    });
    layerWrap.appendChild(b);
    return b;
  });
  const apply = (set) => actions.setLayers(set);
  $('layers-all').addEventListener('click', () => apply(new Set(LAYERS.map((l) => l.id))));
  $('layers-none').addEventListener('click', () => apply(new Set()));

  // ---------------------------------------------------------------- language
  const cz = $('btn-cz'), en = $('btn-en');
  function setLang(lang) {
    state.lang = lang;
    document.documentElement.lang = lang === 'cz' ? 'cs' : 'en';
    cz.setAttribute('aria-pressed', String(lang === 'cz'));
    en.setAttribute('aria-pressed', String(lang === 'en'));
    document.querySelectorAll('[data-t]').forEach((el) => { el.textContent = t(el.dataset.t); });
    document.querySelectorAll('[data-ta]').forEach((el) => el.setAttribute('aria-label', t(el.dataset.ta)));
    document.querySelectorAll('[data-tt]').forEach((el) => { el.title = t(el.dataset.tt); });
    document.querySelectorAll('[data-talt]').forEach((el) => el.setAttribute('alt', t(el.dataset.talt)));
    items.forEach((it) => it.el.setAttribute('aria-label', it.h[lang].title));
    STAGES.forEach((s, i) => {
      const b = stops.children[i];
      b.querySelector('.yr').textContent = s.years.split(' · ')[0];
      b.querySelector('.nm').textContent = s[lang].title;
      b.setAttribute('aria-label', `${s[lang].title}, ${s.years}`);
    });
    LAYERS.forEach((l, i) => { layerBtns[i].querySelector('.lbl').textContent = l[lang]; });
    VIEWPOINTS.forEach((vp, i) => { viewBtns[i].textContent = vp[lang]; });
    playBtn.setAttribute('aria-label', state.playing ? t('pause') : t('play'));
    showStage(current);
    if (openHs) openInfo(openHs);
    renderAbout();
    cutLabel();
    showNotice();
    actions.langChanged?.(lang);
  }
  cz.addEventListener('click', () => setLang('cz'));
  en.addEventListener('click', () => setLang('en'));

  // ---------------------------------------------------------------- stage card
  let current = 7;
  function showStage(i) {
    current = i;
    const s = STAGES[i];
    $('sc-eyebrow').textContent = `${i === 0 ? '' : t('stageWord') + ' ' + i + ' · '}${s.years}`;
    $('sc-title').textContent = s[state.lang].title;
    $('sc-text').textContent = s[state.lang].text;
    [...stops.children].forEach((b, k) => (k === i ? b.setAttribute('aria-current', 'step') : b.removeAttribute('aria-current')));
  }

  // ---------------------------------------------------------------- hotspots
  const layer = $('hotspots');
  const items = HOTSPOTS.map((h, idx) => {
    const el = document.createElement('button');
    el.className = 'hs' + (h.layer ? ' layer-hs' : '');
    el.tabIndex = -1;                      // hidden until updateHotspots shows it
    el.setAttribute('aria-hidden', 'true');
    el.textContent = h.layer ? '◆' : String(idx + 1);
    if (h.layer) {
      const c = LAYERS.find((l) => l.id === h.layer)?.color;
      el.style.color = c;
      el.style.borderColor = c;
    }
    el.addEventListener('click', (ev) => { ev.stopPropagation(); openInfo(h); });
    layer.appendChild(el);
    return { h, el, world: hotspotWorld(h), shown: false };
  });
  let openHs = null;
  function openInfo(h) {
    openHs = h;
    const c = h[state.lang];
    $('info-yr').textContent = h.year ?? (h.layer ? LAYERS.find((l) => l.id === h.layer)[state.lang] : '');
    $('info-title').textContent = c.title;
    $('info-text').textContent = c.text;
    const fig = $('info-fig');
    if (h.img) {
      fig.hidden = false;
      $('info-img').src = `textures/${h.img}.jpg`;
      $('info-img').alt = c.title;
      $('info-cap').textContent = (state.lang === 'en' ? h.creditEn : null) ?? h.credit ?? '';
    } else fig.hidden = true;
    $('info').hidden = false;
    items.forEach((it) => it.el.classList.toggle('active', it.h === h));
  }
  function closeInfo() {
    $('info').hidden = true;
    openHs = null;
    items.forEach((it) => it.el.classList.remove('active'));
  }
  $('info-close').addEventListener('click', closeInfo);

  const v = new THREE.Vector3();
  const camDir = new THREE.Vector3();
  function updateHotspots(T) {
    const w = renderer.domElement.clientWidth, hgt = renderer.domElement.clientHeight;
    camera.getWorldDirection(camDir);
    const inside = insideBuilding(camera.position);
    for (const it of items) {
      const h = it.h;
      let vis = hotspotBelongs(h, state, STAGES, current, T, inside);
      // an open card whose hotspot no longer belongs to the mode, stop or episode closes with it
      if (!vis && openHs === h) closeInfo();
      if (vis) {
        v.copy(it.world).sub(camera.position);
        if (v.dot(camDir) < 0.5) vis = false;
      }
      if (vis) {
        v.copy(it.world).project(camera);
        if (Math.abs(v.x) > 1.05 || Math.abs(v.y) > 1.05) vis = false;
        else {
          const x = (v.x * 0.5 + 0.5) * w, y = (-v.y * 0.5 + 0.5) * hgt;
          it.el.style.transform = `translate(${x.toFixed(1)}px, ${y.toFixed(1)}px)`;
        }
      }
      if (vis !== it.shown) {
        it.el.style.opacity = vis ? '1' : '0';
        it.el.style.pointerEvents = vis ? 'auto' : 'none';
        it.el.tabIndex = vis ? 0 : -1;
        it.el.setAttribute('aria-hidden', String(!vis));
        it.shown = vis;
      }
    }
  }

  // ---------------------------------------------------------------- about
  function renderAbout() {
    $('about-title').textContent = t('about');
    $('about-body').innerHTML = aboutHTML(state.lang) +
      `<img class="drawing" src="textures/rez_1883.jpg" alt="${state.lang === 'cz' ? 'Podélný řez Národním divadlem, J. Fialka 1883' : 'Long section of the National Theatre, J. Fialka 1883'}">` +
      `<div class="about-foot"><div class="author"><span><b>Lukáš Eršil</b><small>@lukasersil</small></span></div><span class="role">${t('author')}<span>${t('backend')}: ${backend}</span></span></div>`;
  }
  // About dialog: focus moves into it, Tab stays inside, focus returns to the button on close
  const about = $('about');
  const openAbout = () => { about.hidden = false; $('about-close').focus(); };
  const closeAbout = () => {
    if (about.hidden) return;
    about.hidden = true;
    $('btn-about').focus();
  };
  $('btn-about').addEventListener('click', openAbout);
  $('about-close').addEventListener('click', closeAbout);
  about.addEventListener('click', (e) => { if (e.target.id === 'about') closeAbout(); });
  about.addEventListener('keydown', (e) => {
    if (e.key !== 'Tab') return;
    const f = [...about.querySelectorAll('button, a[href], [tabindex]:not([tabindex="-1"])')].filter((el) => !el.hidden);
    if (!f.length) return;
    const first = f[0], last = f[f.length - 1];
    if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
  });
  window.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') { closeAbout(); closeInfo(); }
  }, { signal });

  // hint: how to walk; fades out after the first steps. The same strip shows short notices later.
  const hint = $('hint');
  const hintKey = touch ? 'hintTouch' : 'hint';
  hint.dataset.t = hintKey;
  let notice = null, noticeTimer = 0;
  // an offer (n.action) is one line you can press; it goes away by itself, and nothing happens unless you press it
  const endNotice = () => { hint.style.opacity = '0'; hint.classList.remove('offer'); if (notice?.action) notice = null; };
  function showNotice(n = notice) {
    notice = n;
    hint.classList.toggle('notice', !!n);
    hint.classList.toggle('offer', !!n?.action);
    if (!n) { hint.textContent = t(hintKey); return; }
    const text = n.key ? t(n.key) : (n[state.lang] ?? n.en ?? '');
    if (n.action) {
      const b = document.createElement('button');
      b.textContent = text;
      b.addEventListener('click', () => { const run = n.action; endNotice(); run(); });
      hint.replaceChildren(b);
    } else hint.textContent = text;
    hint.style.opacity = '1';
    clearTimeout(noticeTimer);
    noticeTimer = setTimeout(endNotice, n.action ? 12000 : 7000);
  }
  const hideHint = () => { if (!notice) hint.style.opacity = '0'; };
  renderer.domElement.addEventListener('pointerdown', hideHint, { once: true, signal });
  window.addEventListener('keydown', hideHint, { once: true, signal });
  noticeTimer = setTimeout(hideHint, 12000);
  signal?.addEventListener('abort', () => clearTimeout(noticeTimer));

  setLang('cz');

  let lastPlaying = null;
  let lastT = null;
  return {
    showStage,
    setLang,
    setXray: setX,
    clearViews,
    /** Press a viewpoint for this person (its button lights up as if they had). */
    goView(id) { viewBtns[VIEWPOINTS.findIndex((vp) => vp.id === id)]?.click(); },
    notice: showNotice,
    setNoclip(on) { noclipBtn.setAttribute('aria-pressed', String(!!on)); },
    setWardrobe(on) { wardrobeBtn.setAttribute('aria-pressed', String(!!on)); },
    /** The state everyone in the room shares has changed (here or elsewhere): the buttons show it. */
    syncShared(shared) {
      ext.setAttribute('aria-pressed', String(!shared.xray));
      xr.setAttribute('aria-pressed', String(shared.xray));
      $('layer-card').hidden = !shared.xray;
      const set = new Set(shared.layers);
      LAYERS.forEach((l, i) => layerBtns[i].setAttribute('aria-pressed', String(set.has(l.id))));
      const cut = shared.cut;
      if (cut.on && cutBtn.getAttribute('aria-pressed') !== 'true' && window.innerWidth > 760) openPanel(true);
      cutBtn.setAttribute('aria-pressed', String(cut.on));
      $('cut-card').hidden = !cut.on;
      if (document.activeElement !== cutLong) cutLong.value = String(cut.u);
      if (document.activeElement !== cutPlan) cutPlan.value = String(cut.y);
      cutLabel();
      nightBtn.setAttribute('aria-pressed', String(!!shared.night));
      if (fireOn !== (shared.fire.s === 1)) fireUI(shared.fire.s === 1);
    },
    update(T) {
      if (T !== lastT) { // the timeline DOM only changes with the clock
        lastT = T;
        scrub.value = String(T);
        $('rail-fill').style.width = `${(T / 7) * 100}%`;
        for (let i = 0; i < knots.children.length; i++) knots.children[i].classList.toggle('done', T >= STAGES[i].t - 0.001);
      }
      if (state.playing !== lastPlaying) {
        lastPlaying = state.playing;
        $('play-icon').setAttribute('d', state.playing ? 'M4 2.5h3v11H4zM9 2.5h3v11H9z' : 'M4 2.5v11l9-5.5z');
        playBtn.setAttribute('aria-label', state.playing ? t('pause') : t('play'));
      }
      updateHotspots(T);
    },
  };
}
