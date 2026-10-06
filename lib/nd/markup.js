// Lukáš Eršil's interface markup (the body of index.html of narodni-divadlo-3d, MIT), as the HTML layer over the
// canvas. Changed for this version: his masthead is replaced (see components/Overlay.jsx), the toolbar has
// "Walk through walls", "Back to the street" and "Wardrobe", pictures come from textures/, and the WebGPU note is gone.
export const MARKUP = String.raw`<div id="hotspots"></div>


<div class="hint" id="hint" data-t="hint"></div>

<nav class="toolbar" data-ta="toolbar" aria-label="Zobrazení">
  <div class="seg" role="group" data-ta="mode" aria-label="Režim">
    <button id="btn-ext" aria-pressed="true" data-t="exterior">Exteriér</button>
    <button id="btn-xray" aria-pressed="false" data-t="xray">Rentgen</button>
  </div>
  <button class="chip-btn" id="btn-cut" aria-pressed="false" data-t="cut">Řez</button>
  <button class="chip-btn" id="btn-night" aria-pressed="false" data-t="night">Noc</button>
  <div class="seg" role="group" data-ta="language" aria-label="Jazyk">
    <button id="btn-cz" aria-pressed="true">CZ</button>
    <button id="btn-en" aria-pressed="false">EN</button>
  </div>
  <button class="chip-btn" id="btn-noclip" aria-pressed="false" data-t="noclip" data-tt="noclipTitle">Procházet zdmi</button>
  <button class="chip-btn" id="btn-street" data-t="street">Zpět na ulici</button>
  <button class="chip-btn" id="btn-wardrobe" aria-pressed="false" data-t="wardrobe">Šatník</button>
  <button class="chip-btn" id="btn-about" data-t="about">O modelu</button>
  <button class="chip-btn panel-toggle" id="btn-panel" aria-expanded="false" aria-controls="side" data-ta="menu" data-tt="menu" aria-label="Pohledy a vrstvy"><svg viewBox="0 0 16 16" aria-hidden="true"><path d="M2 4h12M2 8h12M2 12h12" fill="none" stroke="currentColor" stroke-width="1.6"/></svg></button>
</nav>

<aside class="side" id="side" data-collapsed="true">
  <section class="card" id="views-card">
    <h3 class="eb" data-t="views">Pohledy</h3>
    <div class="views" id="views"></div>
  </section>
  <section class="card" id="cut-card" hidden>
    <h3 class="eb" data-t="cut">Řez</h3>
    <div class="slider">
      <label for="cut-long"><b data-t="cutLong">Podélný řez</b><span id="cut-long-v"></span></label>
      <input type="range" id="cut-long" min="-26" max="22" step="0.1" value="-1.9">
    </div>
    <div class="slider">
      <label for="cut-plan"><b data-t="cutPlan">Vodorovný řez</b><span id="cut-plan-v"></span></label>
      <input type="range" id="cut-plan" min="-8" max="46" step="0.1" value="46">
    </div>
  </section>
  <section class="card" id="layer-card" hidden>
    <h3 class="split"><span class="eb" data-t="layers">Vrstvy</span><span class="mini"><button id="layers-all" data-t="all">Vše</button><button id="layers-none" data-t="none">Nic</button></span></h3>
    <div class="layers" id="layers"></div>
  </section>
</aside>

<div class="bottom">
  <section class="card stagecard" id="stagecard" aria-live="polite">
    <button class="close" id="sc-close" data-ta="hideDesc" data-tt="hideDesc" aria-label="Skrýt popis">×</button>
    <div class="eyebrow eb" id="sc-eyebrow"></div>
    <h2 id="sc-title"></h2>
    <p id="sc-text"></p>
  </section>
  <div class="timeline">
    <button class="play" id="btn-play" aria-label="Přehrát stavbu">
      <svg viewBox="0 0 16 16" aria-hidden="true"><path id="play-icon" d="M4 2.5v11l9-5.5z" fill="currentColor"/></svg>
    </button>
    <div class="track">
      <div class="rail">
        <div class="bar"></div><div class="fill" id="rail-fill"></div>
        <div id="knots"></div>
        <input type="range" id="scrub" min="0" max="7" step="0.01" value="7" data-ta="timeline" aria-label="Časová osa stavby">
      </div>
      <div class="stops" id="stops"></div>
    </div>
    <button class="fire-btn" id="btn-fire" aria-pressed="false" data-t="fire">Požár 1881</button>
    <div class="tl-tools">
      <button class="icon-btn" id="btn-desc" aria-pressed="true" data-ta="descToggle" data-tt="descToggle" aria-label="Popis etapy"><svg viewBox="0 0 16 16" aria-hidden="true"><path d="M7 2.5h2v2H7zM7 6.5h2v7H7z" fill="currentColor"/></svg></button>
      <button class="icon-btn" id="btn-tl-hide" data-ta="tlHide" data-tt="tlHide" aria-label="Skrýt časovou osu"><svg viewBox="0 0 16 16" aria-hidden="true"><path d="M3 5.5l5 5 5-5" fill="none" stroke="currentColor" stroke-width="2"/></svg></button>
    </div>
  </div>
</div>
<button class="tl-show" id="tl-show"><svg viewBox="0 0 16 16" aria-hidden="true"><path d="M3 10.5l5-5 5 5" fill="none" stroke="currentColor" stroke-width="2.4"/></svg><span data-t="tlShow">Časová osa</span></button>

<section class="card info" id="info" hidden aria-live="polite">
  <button class="close" id="info-close" data-ta="close" aria-label="Zavřít">×</button>
  <div class="yr eb" id="info-yr"></div>
  <h4 id="info-title"></h4>
  <p id="info-text"></p>
  <figure id="info-fig" hidden><img id="info-img" alt=""><figcaption id="info-cap"></figcaption></figure>
</section>

<section class="card firecard" id="firecard" hidden>
  <button class="close" id="fire-close" data-ta="hideDesc" data-tt="hideDesc" aria-label="Skrýt popis">×</button>
  <h4 data-t="fireTitle">12. srpna 1881</h4>
  <p data-t="fireText"></p>
  <figure><img src="textures/pozar.jpg" data-talt="fireAlt" alt="Hořící Národní divadlo 12. 8. 1881"><figcaption data-t="fireCredit">Světozor 1881, volné dílo</figcaption></figure>
  <button class="cta" id="btn-rebuild" data-t="rebuild">Obnova 1883</button>
</section>

<div class="about" id="about" hidden>
  <div class="card" role="dialog" aria-modal="true" aria-labelledby="about-title">
    <button class="close" id="about-close" data-ta="close" aria-label="Zavřít">×</button>
    <h4 id="about-title">O modelu</h4>
    <div id="about-body"></div>
  </div>
</div>

<div class="loading" id="loading">
  <div class="inner">
    <div class="crown">Národ <span>sobě.</span></div>
    <div class="rule" id="load-bar" role="progressbar" aria-label="Načítání" aria-valuemin="0" aria-valuemax="100" aria-valuenow="0"><i></i></div>
    <div class="msg" data-t="loading">Stavím model…</div>
    <div class="err" id="load-err" hidden></div>
  </div>
</div>

`
