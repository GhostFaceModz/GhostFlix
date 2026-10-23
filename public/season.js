// Seasonal looks (Settings › Appearance › Seasonal theme). "auto" = Halloween for all of October, Normal otherwise.
// Halloween: orange/purple accents, a few slow ghosts/bats behind the content, a glow on the logo (the logo video itself
// is untouched), an optional pumpkin cursor (desktop), optional synthesised sound effects, and a pumpkin-ghost favicon.
export const SEASONS = [['auto', 'Auto (seasonal)'], ['normal', 'Normal'], ['halloween', 'Halloween']];
export const HALLOWEEN = { acc: '#ff7a18', acc2: '#9b5cff', soft: '#ffd9b8' };
/** Resolve a season setting to the active season ('' = normal). */
export function resolveSeason(v, d = new Date()) { return v === 'halloween' || (v !== 'normal' && d.getMonth() === 9) ? 'halloween' : ''; }

const ICONS = { '': ['/favicon.svg', '/icons/apple-touch-icon.png'], halloween: ['/favicon-halloween.svg?v=1', '/icons/apple-touch-icon-halloween.png?v=1'] };
function setIcons(season) {
  const [fav, apple] = ICONS[season] || ICONS[''];
  const i = document.querySelector('link[rel=icon]'); if (i && i.getAttribute('href') !== fav) i.setAttribute('href', fav);
  const a = document.querySelector('link[rel=apple-touch-icon]'); if (a && a.getAttribute('href') !== apple) a.setAttribute('href', apple);
}
function decor(on) {
  let el = document.getElementById('gfSpooky');
  if (!on) { el?.remove(); return; }
  if (el || !document.body) return;
  el = document.createElement('div'); el.id = 'gfSpooky'; el.setAttribute('aria-hidden', 'true');
  el.innerHTML = '<i class="sp-ghost g1"></i><i class="sp-ghost g2"></i><i class="sp-ghost g3"></i><i class="sp-bat b1"></i><i class="sp-bat b2"></i><i class="sp-bat b3"></i><i class="sp-bat b4"></i>';
  (document.querySelector('body > .bg') || document.body).append(el);
}

// ---- sound effects (WebAudio, synthesised: no files to download). Off by default. ----
let ctx = null, wired = false, enabled = false, lastHover = 0;
const audio = () => { if (!ctx) { const A = window.AudioContext || window.webkitAudioContext; if (!A) return null; ctx = new A(); } if (ctx.state === 'suspended') ctx.resume().catch(() => {}); return ctx; };
function tone({ f0, f1, dur, vol, type = 'sine', vib = 0 }) {
  const c = audio(); if (!c) return; const t = c.currentTime;
  const o = c.createOscillator(), g = c.createGain(); o.type = type;
  o.frequency.setValueAtTime(f0, t); o.frequency.exponentialRampToValueAtTime(f1, t + dur);
  if (vib) { const l = c.createOscillator(), lg = c.createGain(); l.frequency.value = 7; lg.gain.value = vib; l.connect(lg).connect(o.frequency); l.start(t); l.stop(t + dur); }
  g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(vol, t + 0.03); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  o.connect(g).connect(c.destination); o.start(t); o.stop(t + dur + 0.02);
}
function whoosh() {
  const c = audio(); if (!c) return; const t = c.currentTime, dur = 0.16;
  const b = c.createBuffer(1, Math.ceil(c.sampleRate * dur), c.sampleRate), d = b.getChannelData(0);
  for (let i = 0; i < d.length; i++) d[i] = (Math.random() * 2 - 1) * Math.sin((Math.PI * i) / d.length);
  const s = c.createBufferSource(), f = c.createBiquadFilter(), g = c.createGain(); s.buffer = b;
  f.type = 'bandpass'; f.Q.value = 2.5; f.frequency.setValueAtTime(500, t); f.frequency.exponentialRampToValueAtTime(1400, t + dur);
  g.gain.value = 0.035; s.connect(f).connect(g).connect(c.destination); s.start(t);
}
export const SFX = { hover: whoosh, click: () => tone({ f0: 620, f1: 330, dur: 0.22, vol: 0.05, vib: 18 }), preview: () => tone({ f0: 620, f1: 330, dur: 0.22, vol: 0.05, vib: 18 }) };
const HOVER = '.card, .btn, .set-item, .tile, .pill, .nav-links a, .coll';
const CLICK = 'a, button, [role=button]';
function wireSounds() {
  if (wired) return; wired = true;
  document.addEventListener('pointerover', (e) => {
    if (!enabled || e.pointerType !== 'mouse') return; const el = e.target.closest?.(HOVER); if (!el || el.contains(e.relatedTarget)) return;
    const n = performance.now(); if (n - lastHover < 140 || !ctx) return; lastHover = n; whoosh(); // only after a first click has unlocked audio
  }, { passive: true });
  document.addEventListener('pointerdown', (e) => { if (enabled && e.target.closest?.(CLICK)) SFX.click(); }, { passive: true });
}

/** Apply the season to the page. Returns the active season ('' or 'halloween'). */
export function applySeason(s) {
  const r = document.documentElement; const season = resolveSeason(s.season);
  if (season) r.dataset.season = season; else delete r.dataset.season;
  if (season && s.pumpkinCursor) r.dataset.pumpkin = '1'; else delete r.dataset.pumpkin;
  enabled = !!(season && s.spookySounds); if (enabled) wireSounds();
  setIcons(season);
  if (document.body) decor(!!season); else document.addEventListener('DOMContentLoaded', () => decor(!!resolveSeason(s.season)), { once: true });
  return season;
}
