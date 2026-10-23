import { Cosmetics, BORDER_GROUPS, GLOWS, avatarWrap } from './cosmetics.js?v=20261023zp';
import { SEASONS, HALLOWEEN, applySeason, resolveSeason, SFX } from './season.js?v=20261023zp';
// GhostFlix settings: stored in localStorage, applied live (theme, accent, cards, subtitles, player prefs).
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
export const ACCENTS = {
  ghost: { name: 'GhostGames cyan', acc: '#5fe3ff', acc2: '#2a8cff', soft: '#c9f4ff' },
  violet: { name: 'Spectral violet', acc: '#b69bff', acc2: '#7a5cff', soft: '#e6dcff' },
  ember: { name: 'Ember', acc: '#ff8a4c', acc2: '#ff5a1a', soft: '#ffe0cc' },
  lime: { name: 'Slime', acc: '#8dff7a', acc2: '#2fcf5a', soft: '#dcffd5' },
  rose: { name: 'Rose', acc: '#ff7aa8', acc2: '#ff3d7a', soft: '#ffd9e6' },
  gold: { name: 'Gold', acc: '#ffd166', acc2: '#f5a524', soft: '#fff1c9' },
};
const DEFAULTS = {
  theme: 'dark', accent: 'ghost', cardLayout: 'poster', cardSize: 'm', motion: 'full', season: 'normal', bgAnim: true, pumpkinCursor: true, spookySounds: false,
  autoplayHero: true, region: '', autoplay: true, rememberPosition: true, preferProvider: 'any', blockPopups: true,
  subs: { enabled: true, lang: 'en', size: 100, color: '#ffffff', bg: 'rgba(0,0,0,.6)', font: 'sans', edge: 'shadow' },
};
export const Settings = {
  // season 'auto' used to be the default and was stored with every settings save; only keep it if it was picked on purpose.
  get() { try { const s = JSON.parse(localStorage.getItem('gf.settings')) || {}; if (s.season === 'auto' && !s.seasonPicked) delete s.season; return { ...DEFAULTS, ...s, subs: { ...DEFAULTS.subs, ...(s.subs || {}) } }; } catch { return structuredClone(DEFAULTS); } },
  set(patch) { const cur = Settings.get(); const next = { ...cur, ...patch, subs: { ...cur.subs, ...(patch.subs || {}) } }; localStorage.setItem('gf.settings', JSON.stringify(next)); applySettings(next); return next; },
  reset() { localStorage.removeItem('gf.settings'); applySettings(Settings.get()); },
};
const FONTS = { sans: 'Poppins, Inter, system-ui, sans-serif', serif: 'Georgia, "Times New Roman", serif', mono: 'ui-monospace, Menlo, Consolas, monospace', casual: '"Comic Sans MS", "Comic Neue", cursive' };
export function subtitleCSS(s) {
  const edge = s.edge === 'shadow' ? 'text-shadow:0 2px 4px rgba(0,0,0,.9);' : s.edge === 'outline' ? 'text-shadow:-1px -1px 0 #000,1px -1px 0 #000,-1px 1px 0 #000,1px 1px 0 #000;' : '';
  return `font-size:${(s.size / 100) * 1.25}em;color:${s.color};background:${s.bg};font-family:${FONTS[s.font] || FONTS.sans};${edge}`;
}
export function applySettings(s = Settings.get()) {
  const r = document.documentElement; const season = applySeason(s); const a = season === 'halloween' ? HALLOWEEN : ACCENTS[s.accent] || ACCENTS.ghost;
  r.dataset.theme = s.theme; r.dataset.cards = s.cardLayout; r.dataset.size = s.cardSize; r.dataset.motion = s.motion;
  r.style.setProperty('--acc', a.acc); r.style.setProperty('--acc2', a.acc2); r.style.setProperty('--acc-soft', a.soft);
  r.style.setProperty('--acc-glow', hexA(a.acc, 0.45));
  let st = document.getElementById('gfSubStyle');
  if (!st) { st = document.createElement('style'); st.id = 'gfSubStyle'; document.head.appendChild(st); }
  st.textContent = `video::cue{${subtitleCSS(s.subs)}}`;
  document.querySelector('meta[name=theme-color]')?.setAttribute('content', season === 'halloween' && s.theme !== 'light' ? (s.theme === 'amoled' ? '#000000' : '#0d0714') : { amoled: '#000000', dim: '#10141d', light: '#f4f6fa' }[s.theme] || '#04050a');
  const tb = document.getElementById('themeTgl'); if (tb) { const l = s.theme === 'light'; tb.setAttribute('aria-label', l ? 'Switch to dark theme' : 'Switch to light theme'); tb.setAttribute('aria-pressed', String(l)); }
}
/** Signed in: adopt the seasonal theme saved on the account (Supabase user metadata gf_season). */
export function seasonFromUser(user) {
  const v = user?.user_metadata?.gf_season; if (!SEASONS.some(([k]) => k === v) || v === Settings.get().season) return false;
  Settings.set({ season: v, seasonPicked: true }); return true;
}
// Pop-up blocking for third-party embed players: sandbox without allow-popups / allow-top-navigation / allow-modals.
export const POPUP_SANDBOX = 'allow-scripts allow-same-origin allow-forms allow-presentation allow-orientation-lock allow-pointer-lock';
const OFFICIAL_EMBED = /(^|\.)(youtube\.com|youtube-nocookie\.com|vimeo\.com|archive\.org|dailymotion\.com|mediadelivery\.net|cloudflarestream\.com|videodelivery\.net)$/i;
/** Sandbox to apply to an iframe player: POPUP_SANDBOX for third-party embeds while "Block pop-ups" is on, else the fallback (current behaviour). */
export function embedSandbox(src, fallback = '') {
  let host = ''; try { host = new URL(src, location.href).hostname; } catch {}
  return Settings.get().blockPopups && host && !OFFICIAL_EMBED.test(host) ? POPUP_SANDBOX : fallback || '';
}
function hexA(hex, a) { const n = parseInt(hex.slice(1), 16); return `rgba(${n >> 16},${(n >> 8) & 255},${n & 255},${a})`; }

// ---- views --------------------------------------------------------------------------
const I = {
  history: '<path d="M3 12a9 9 0 1 0 3-6.7L3 8"/><path d="M3 3v5h5M12 7v5l3 2"/>',
  tv: '<rect x="3" y="5" width="18" height="12" rx="2"/><path d="M8 21h8"/>',
  profiles: '<rect x="7" y="3" width="14" height="14" rx="2"/><path d="M3 7v12a2 2 0 0 0 2 2h12"/><circle cx="14" cy="8.5" r="2.2"/><path d="M10.5 14c.6-1.6 2-2.5 3.5-2.5s2.9.9 3.5 2.5"/>',
  user: '<circle cx="12" cy="12" r="9"/><circle cx="12" cy="10" r="3"/><path d="M6.5 18.5c1.2-2.1 3.2-3.2 5.5-3.2s4.3 1.1 5.5 3.2"/>',
  bell: '<path d="M6 16V11a6 6 0 0 1 12 0v5l1.6 2H4.4Z"/><path d="M10 20.5a2.2 2.2 0 0 0 4 0"/>',
  sliders: '<path d="M4 6h10M18 6h2M4 12h4M12 12h8M4 18h12M20 18h0"/><circle cx="16" cy="6" r="2"/><circle cx="10" cy="12" r="2"/><circle cx="18" cy="18" r="2"/>',
  palette: '<path d="M12 3a9 9 0 1 0 0 18c1.1 0 1.8-.9 1.8-1.8 0-.5-.2-.9-.5-1.2-.3-.3-.5-.7-.5-1.2 0-1 .8-1.8 1.8-1.8H17a4 4 0 0 0 4-4C21 6.6 17 3 12 3Z"/><circle cx="7.5" cy="11" r="1.2"/><circle cx="10" cy="7" r="1.2"/><circle cx="15" cy="7" r="1.2"/>',
  play: '<circle cx="12" cy="12" r="9"/><path d="M10 8.5v7l5.5-3.5z"/>',
  subs: '<rect x="3" y="5" width="18" height="14" rx="2"/><path d="M7 13h4M13 13h4M7 16h7"/>',
  link: '<path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1"/><path d="M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1"/>',
  chev: '<path d="M9 5l7 7-7 7"/>',
};
const ico = (k) => `<svg viewBox="0 0 24 24" aria-hidden="true">${I[k]}</svg>`;
const item = (href, icon, t, sub) => `<a class="set-item" href="${href}" data-link><span class="si">${ico(icon)}</span><span class="st"><b>${t}</b><small>${sub}</small></span><span class="sc">${ico('chev')}</span></a>`;
const group = (label, items) => `<div class="set-label">${label}</div><div class="set-group">${items.join('')}</div>`;
const header = (title, back = '/settings') => `<div class="set-top"><a class="set-back" href="${back}" data-link aria-label="Back">${ico('chev')}</a><h1>${esc(title)}</h1></div>`;
const seg = (name, opts, cur) => `<div class="seg" role="radiogroup">${opts.map(([v, l]) => `<button type="button" role="radio" aria-checked="${v === cur}" class="${v === cur ? 'on' : ''}" data-set="${name}" data-val="${esc(v)}">${l}</button>`).join('')}</div>`;
const row = (label, ctl, hint = '') => `<div class="set-row"><div><b>${label}</b>${hint ? `<small>${hint}</small>` : ''}</div>${ctl}</div>`;
const toggle = (name, on) => `<button type="button" class="tgl ${on ? 'on' : ''}" role="switch" aria-checked="${!!on}" data-tgl="${name}"><i></i></button>`;

export function renderSettings(main, ctx, sub) {
  const s = Settings.get(); const u = ctx.auth?.user; const m = u ? ctx.auth.meta() : null;
  const wire = (rerender) => {
    main.querySelectorAll('[data-set]').forEach((b) => (b.onclick = () => { const k = b.dataset.set, v = b.dataset.val; const patch = k.startsWith('subs.') ? { subs: { [k.slice(5)]: isNaN(+v) || v === '' ? v : +v } } : { [k]: v }; Settings.set(patch); rerender(); }));
    main.querySelectorAll('[data-tgl]').forEach((b) => (b.onclick = () => { const k = b.dataset.tgl; const cur = k.startsWith('subs.') ? Settings.get().subs[k.slice(5)] : Settings.get()[k]; Settings.set(k.startsWith('subs.') ? { subs: { [k.slice(5)]: !cur } } : { [k]: !cur }); rerender(); }));
    main.querySelectorAll('select[data-sel]').forEach((el) => (el.onchange = () => { const k = el.dataset.sel; Settings.set(k.startsWith('subs.') ? { subs: { [k.slice(5)]: el.value } } : { [k]: el.value }); rerender(); }));
    main.querySelectorAll('input[type=range][data-rng]').forEach((el) => (el.oninput = () => { const k = el.dataset.rng; Settings.set({ subs: { [k.slice(5)]: +el.value } }); const p = main.querySelector('.sub-prev span'); if (p) p.setAttribute('style', subtitleCSS(Settings.get().subs).replace(/font-size:[^;]+;/, `font-size:${(+el.value / 100) * 20}px;`)); main.querySelector(`[data-out="${k}"]`).textContent = el.value + '%'; }));
  };
  const re = () => renderSettings(main, ctx, sub);

  if (!sub) {
    main.innerHTML = `<div class="page settings"><h1 class="set-h1">Settings</h1>
      <div class="tiles">
        <a class="tile" href="/settings/history" data-link><span>${ico('history')}</span>History</a>
        <a class="tile" href="/settings/tv" data-link><span>${ico('tv')}</span>TV Sync</a>
        <a class="tile" href="/settings/profiles" data-link><span>${ico('profiles')}</span>Profiles</a>
        ${u ? `<a class="tile" href="/settings/account" data-link><span>${m.av ? `<img src="${esc(m.av)}" alt="" referrerpolicy="no-referrer">` : ico('user')}</span>${esc(m.name.split(' ')[0])}</a>` : `<button class="tile" type="button" data-signin><span>${ico('user')}</span>Sign in</button>`}
      </div>
      ${group('Account', [...(u ? [item('/profile', 'user', 'My profile', 'Your public profile page').replace('data-link', 'data-link data-my-profile')] : []), item('/profile', 'user', 'Profile', 'Avatar border and name glow'), item('/settings/account', 'user', 'Account', 'Profile, sync and backup')])}
      ${group('App', [item('/settings/preferences', 'sliders', 'Preferences', 'Language, content and behavior'), item('/settings/preferences?to=notifications', 'bell', 'Notifications', 'Off, in GhostFlix only, or on your phone'), item('/settings/appearance', 'palette', 'Appearance', 'Theme, seasonal look, layout and cards')])}
      ${group('Playback', [item('/settings/player', 'play', 'Player', 'Playback, gestures and sources'), item('/settings/subtitles', 'subs', 'Subtitles', 'Style, size and languages')])}
      ${group('Integrations', [item('/settings/connections', 'link', 'Connections', 'Discord, GitHub')])}
      <p class="set-foot">GhostFlix · a personal project · no video files hosted here</p></div>`;
    return;
  }
  if (sub === 'profile') {
    const c = Cosmetics.get(); const name = m?.name || 'Viewer';
    const av = m?.av ? `<img src="${esc(m.av)}" alt="" referrerpolicy="no-referrer">` : `<span class="ini">${esc(name[0] || '?')}</span>`;
    const custom = c.glow && !GLOWS.some(([v]) => v === c.glow);
    main.innerHTML = `<div class="page settings profile-cos">${header('Profile')}
      <div class="set-group pad cos-prev"><div class="cos-me">${avatarWrap(av, c.border)}<div><b class="gf-name">${esc(name)}</b><small>${u ? 'Signed in · saved to your account' : 'Saved on this device · sign in to sync'}</small></div></div></div>
      <div class="set-label">Avatar border</div>
      ${BORDER_GROUPS.map((g) => `<div class="set-group pad cos-group" data-cat="${g.id}"><div class="cos-cat">${esc(g.name)}</div><div class="cos-grid">${g.items.map(([id, label]) => `<button type="button" class="cos-opt ${c.border === id ? 'on' : ''}" data-border="${id}" aria-pressed="${c.border === id}">${avatarWrap(av, id)}<span>${esc(label)}</span></button>`).join('')}</div></div>`).join('')}
      <div class="set-label">Name glow</div><div class="set-group pad"><div class="glows">${GLOWS.map(([v, l]) => `<button type="button" class="glow-sw ${c.glow === v ? 'on' : ''}" data-glow="${v}" title="${l}" aria-label="${l}" style="${v ? `--sw:${v}` : ''}">${v ? '' : '⌀'}</button>`).join('')}
        <label class="glow-custom ${custom ? 'on' : ''}" title="Custom colour"><input type="color" id="glowCustom" value="${c.glow || '#5fe3ff'}" aria-label="Custom glow colour"><span>Custom</span></label></div>
        <p class="set-note">Shown as a glow on your display name (here and in the header).</p></div><div id="gfFlair"></div><div id="gfCommunityProfile"></div></div>`;
    ctx.flair?.mountProfile(main.querySelector('#gfFlair'), u ? { name, av: m?.av } : null);
    ctx.community?.profileExtras(main.querySelector('#gfCommunityProfile'));
    const save = async (patch) => {
      Cosmetics.set(patch); re();
      if (u) { try { const cl = await ctx.auth.client(); const cur = Cosmetics.get(); const { error } = await cl.auth.updateUser({ data: { gf_border: cur.border, gf_glow: cur.glow } }); if (error) throw error; } catch (e) { ctx.toast('Saved on this device (account sync failed)'); } }
    };
    main.querySelectorAll('[data-border]').forEach((b) => (b.onclick = () => save({ border: b.dataset.border })));
    main.querySelectorAll('[data-glow]').forEach((b) => (b.onclick = () => save({ glow: b.dataset.glow })));
    const ci = main.querySelector('#glowCustom');
    ci.oninput = () => { document.documentElement.style.setProperty('--gf-glow', ci.value); document.documentElement.dataset.glow = '1'; };
    ci.onchange = () => save({ glow: ci.value });
    return;
  }
  if (sub === 'history') {
    const h = ctx.history.all();
    main.innerHTML = `<div class="page settings">${header('History')}
      <div class="set-actions"><span class="dim">${h.length} title${h.length === 1 ? '' : 's'}${u ? ' · synced to your account' : ' · on this device'}</span>${h.length ? '<button class="btn dark sm" id="clearHist" type="button">Clear history</button>' : ''}</div>
      ${h.length ? `<div class="hist">${h.map((c, i) => `<div class="hist-row"><a href="${ctx.watchHref(c, c.s, c.e)}" data-link class="hist-pic">${c.backdrop || c.poster ? `<img src="${esc(c.backdrop || c.poster)}" alt="" loading="lazy">` : ''}${c.progress ? `<i style="width:${Math.min(100, c.progress)}%"></i>` : ''}</a>
        <div class="hist-t"><a href="/title/${c.media_type}/${c.id}" data-link><b>${esc(c.title)}</b></a><small>${c.s != null ? `S${esc(c.s)} · E${esc(c.e)} · ` : ''}${c.media_type === 'tv' ? 'Series' : 'Movie'} · ${new Date(c.at || Date.now()).toLocaleDateString(undefined, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}${c.progress ? ` · ${Math.round(c.progress)}%` : ''}</small></div>
        <button class="hist-x" type="button" data-rm="${i}" aria-label="Remove ${esc(c.title)} from history">×</button></div>`).join('')}</div>`
        : '<div class="empty"><img src="/img/logo.svg" alt=""><h2>No history yet</h2><p>Titles you play show up here.</p></div>'}</div>`;
    const cl = main.querySelector('#clearHist'); if (cl) cl.onclick = () => { if (confirm('Clear your entire watch history?')) { ctx.history.clear(); re(); ctx.toast('History cleared'); } };
    main.querySelectorAll('[data-rm]').forEach((b) => (b.onclick = () => { ctx.history.remove(h[+b.dataset.rm]); re(); }));
    return;
  }
  if (sub === 'appearance') {
    const cardPrev = (layout) => `<div class="lay-prev ${layout}">${'<i></i>'.repeat(layout === 'poster' ? 4 : 2)}</div>`;
    const live = resolveSeason(s.season);
    main.innerHTML = `<div class="page settings">${header('Appearance')}
      <div class="set-label">Seasonal theme</div><div class="set-group pad">
        <div class="themes seasons" role="radiogroup" aria-label="Seasonal theme">${SEASONS.map(([v, l]) => `<button type="button" role="radio" aria-checked="${s.season === v}" class="theme season-opt so-${v} ${s.season === v ? 'on' : ''}" data-season="${v}"><span><i></i><b class="so-art" aria-hidden="true"></b></span>${l}</button>`).join('')}</div>
        <p class="set-note">${s.season === 'auto' ? `Auto shows Halloween for all of October and the normal look the rest of the year. Right now: <b>${live ? 'Halloween' : 'Normal'}</b>.` : s.season === 'halloween' ? 'Halloween look on all year, until you change it.' : 'The normal GhostFlix look, all year.'} ${u ? 'Saved to your account.' : 'Saved on this device.'}</p>
        ${row('Background animation', toggle('bgAnim', s.bgAnim), 'Ghosts drifting slowly behind the page')}
        ${live ? `${row('Pumpkin cursor', toggle('pumpkinCursor', s.pumpkinCursor), 'Desktop only (mouse pointers)')}
        ${row('Spooky sounds', toggle('spookySounds', s.spookySounds), 'Soft whoosh on hover and a ghostly “ooo” on click. Off by default.')}` : ''}
      </div>
      <div class="set-label">Theme</div><div class="set-group pad">
        <div class="themes">${[['dark', 'Dark', '#04050a'], ['amoled', 'AMOLED black', '#000'], ['dim', 'Dim', '#10141d'], ['light', 'Light', '#f4f6fa']].map(([v, l, c]) => `<button type="button" class="theme ${s.theme === v ? 'on' : ''}" data-set="theme" data-val="${v}"><span style="background:${c}"><i></i></span>${l}</button>`).join('')}</div></div>
      <div class="set-label">Accent colour</div><div class="set-group pad">${live ? '<p class="set-note" style="margin:0 0 10px">The Halloween look uses orange and purple; your accent comes back with the normal look.</p>' : ''}<div class="swatches">${Object.entries(ACCENTS).map(([k, a]) => `<button type="button" class="sw ${s.accent === k ? 'on' : ''}" data-set="accent" data-val="${k}" title="${a.name}" aria-label="${a.name}" style="--c:${a.acc};--c2:${a.acc2}"></button>`).join('')}</div><small class="dim">${esc((ACCENTS[s.accent] || ACCENTS.ghost).name)}</small></div>
      <div class="set-label">Cards</div><div class="set-group pad">
        ${row('Layout', `<div class="lays">${[['poster', 'Poster'], ['landscape', 'Landscape']].map(([v, l]) => `<button type="button" class="lay ${s.cardLayout === v ? 'on' : ''}" data-set="cardLayout" data-val="${v}">${cardPrev(v)}${l}</button>`).join('')}</div>`)}
        ${row('Card size', seg('cardSize', [['s', 'Small'], ['m', 'Medium'], ['l', 'Large']], s.cardSize))}
        ${row('Motion', seg('motion', [['full', 'Full'], ['reduced', 'Reduced']], s.motion), 'Hover zoom and transitions')}
      </div>
      <div class="set-label">Preview</div><div class="set-group pad prev-row" id="appPrev"></div>
      <p style="margin-top:18px"><button class="btn dark sm" type="button" id="resetApp">Reset appearance</button></p></div>`;
    ctx.previewCards(main.querySelector('#appPrev'));
    const saveSeason = async (v) => {
      Settings.set({ season: v, seasonPicked: true }); re();
      if (u) { try { const cl = await ctx.auth.client(); const { error } = await cl.auth.updateUser({ data: { gf_season: v } }); if (error) throw error; } catch { ctx.toast('Saved on this device (account sync failed)'); } }
    };
    main.querySelectorAll('[data-season]').forEach((b) => (b.onclick = () => saveSeason(b.dataset.season)));
    main.querySelector('#resetApp').onclick = () => { Settings.set({ theme: 'dark', accent: 'ghost', cardLayout: 'poster', cardSize: 'm', motion: 'full' }); re(); };
    const st = main.querySelector('[data-tgl="spookySounds"]'); if (st) st.addEventListener('click', () => { if (!Settings.get().spookySounds) SFX.preview(); }); // runs before the toggle flips it
    wire(re); return;
  }
  if (sub === 'subtitles') {
    const S = s.subs;
    const langs = [['en', 'English'], ['es', 'Spanish'], ['fr', 'French'], ['de', 'German'], ['it', 'Italian'], ['pt', 'Portuguese'], ['nl', 'Dutch'], ['pl', 'Polish'], ['tr', 'Turkish'], ['ar', 'Arabic'], ['hi', 'Hindi'], ['ja', 'Japanese'], ['ko', 'Korean'], ['zh', 'Chinese']];
    main.innerHTML = `<div class="page settings">${header('Subtitles')}
      <div class="sub-prev"><span style="${subtitleCSS(S).replace(/font-size:[^;]+;/, `font-size:${(S.size / 100) * 20}px;`)}">The night is young, Watson.</span></div>
      <div class="set-group pad">
        ${row('Show subtitles', toggle('subs.enabled', S.enabled), 'When a title has subtitle tracks')}
        ${row('Default language', `<div class="select"><select data-sel="subs.lang">${langs.map(([v, l]) => `<option value="${v}" ${S.lang === v ? 'selected' : ''}>${l}</option>`).join('')}</select></div>`)}
        ${row('Size', `<div class="rng"><input type="range" min="60" max="200" step="10" value="${S.size}" data-rng="subs.size" aria-label="Subtitle size"><output data-out="subs.size">${S.size}%</output></div>`)}
        ${row('Text colour', `<div class="swatches sm">${['#ffffff', '#ffe066', '#5fe3ff', '#8dff7a', '#ff9ec7'].map((c) => `<button type="button" class="sw ${S.color === c ? 'on' : ''}" style="--c:${c};--c2:${c}" data-set="subs.color" data-val="${c}" aria-label="Colour ${c}"></button>`).join('')}</div>`)}
        ${row('Background', seg('subs.bg', [['transparent', 'None'], ['rgba(0,0,0,.6)', 'Dim'], ['rgba(0,0,0,.9)', 'Solid']], S.bg))}
        ${row('Font', seg('subs.font', [['sans', 'Sans'], ['serif', 'Serif'], ['mono', 'Mono'], ['casual', 'Casual']], S.font))}
        ${row('Edge', seg('subs.edge', [['none', 'None'], ['shadow', 'Shadow'], ['outline', 'Outline']], S.edge))}
      </div><p class="set-note">Applies to GhostFlix’s own player (MP4/HLS sources with subtitle tracks). Embedded players like YouTube or Vimeo use their own caption settings.</p></div>`;
    wire(re); return;
  }
  if (sub === 'player') {
    main.innerHTML = `<div class="page settings">${header('Player')}<div class="set-group pad">
      ${row('Autoplay', toggle('autoplay', s.autoplay), 'Start playing as soon as the player opens')}
      ${row('Remember position', toggle('rememberPosition', s.rememberPosition), 'Resume where you left off (jumps to the exact spot on CineSrc and MP4/HLS)')}
      ${row('Block pop-ups', toggle('blockPopups', s.blockPopups), 'Stops players opening ads in new tabs. Turn off if a movie won’t play.')}
      ${row('Preferred source', `<div class="select"><select data-sel="preferProvider">${[['any', 'Best available'], ['archive', 'Internet Archive'], ['youtube', 'YouTube'], ['vimeo', 'Vimeo'], ['file', 'Direct / own hosting']].map(([v, l]) => `<option value="${v}" ${s.preferProvider === v ? 'selected' : ''}>${l}</option>`).join('')}</select></div>`, 'When a title has several legit sources')}
      ${row('Keyboard', '<span class="dim" style="font-size:13px">Esc closes · Space plays/pauses · ←/→ seek 10s</span>')}
    </div></div>`;
    wire(re); return;
  }
  if (sub === 'preferences') {
    main.innerHTML = `<div class="page settings">${header('Preferences')}<div class="set-group pad">
      ${row('Where-to-watch region', `<div class="select"><select data-sel="region">${[['', 'Auto (browser)'], ['US', 'United States'], ['GB', 'United Kingdom'], ['CA', 'Canada'], ['AU', 'Australia'], ['IE', 'Ireland'], ['DE', 'Germany'], ['FR', 'France'], ['ES', 'Spain'], ['IT', 'Italy'], ['NL', 'Netherlands'], ['IN', 'India'], ['BR', 'Brazil'], ['MX', 'Mexico']].map(([v, l]) => `<option value="${v}" ${s.region === v ? 'selected' : ''}>${l}</option>`).join('')}</select></div>`, 'Used for streaming-service availability')}
      ${row('Auto-rotate hero', toggle('autoplayHero', s.autoplayHero), 'Cycle featured titles on Home')}
    </div><div class="set-label" id="notifications">Notifications</div><div class="set-group pad" id="pushBox"></div><p style="margin-top:18px"><button class="btn dark sm" type="button" id="resetAll">Reset all settings</button></p></div>`;
    main.querySelector('#resetAll').onclick = () => { if (confirm('Reset all settings to defaults?')) { Settings.reset(); re(); } };
    ctx.push?.mount(main.querySelector('#pushBox'));
    if (/[?&]to=notifications/.test(location.search)) setTimeout(() => { const n = main.querySelector('#notifications'); if (n) scrollTo({ top: n.getBoundingClientRect().top + scrollY - 90 }); }, 60);
    wire(re); return;
  }
  if (sub === 'account') {
    main.innerHTML = `<div class="page settings">${header('Account')}
      <div class="set-group pad">${u ? `<div class="who">${m.av ? `<img src="${esc(m.av)}" alt="" referrerpolicy="no-referrer">` : ''}<div><b class="gf-name">${esc(m.name)}</b><small>${esc(u.email || '')}${m.provider ? ' · via ' + esc(m.provider) : ''}</small></div></div><p class="set-note">Your list and watch history sync automatically.</p><button class="btn dark sm" data-signout type="button">Sign out</button>`
        : `<b>Not signed in</b><p class="set-note">Sign in with Google or Discord to sync your list and history across devices.</p><button class="btn cta sm" data-signin type="button">Sign in</button>`}</div>
      <div class="set-label">Backup</div><div class="set-group pad">${row('Export my data', '<button class="btn dark sm" id="exp" type="button">Download</button>', 'List, history and settings as JSON')}${row('Import', '<label class="btn dark sm">Choose file<input type="file" id="imp" accept="application/json" hidden></label>')}</div></div>`;
    main.querySelector('#exp').onclick = () => { const blob = new Blob([JSON.stringify({ list: ctx.list.all(), history: ctx.history.all(), settings: Settings.get() }, null, 1)], { type: 'application/json' }); const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = 'ghostflix-backup.json'; a.click(); };
    main.querySelector('#imp').onchange = async (e) => { try { const d = JSON.parse(await e.target.files[0].text()); if (d.list) ctx.list.replace(d.list); if (d.history) ctx.history.replace(d.history); if (d.settings) Settings.set(d.settings); ctx.toast('Backup restored'); re(); } catch { ctx.toast('That file isn’t a GhostFlix backup'); } };
    return;
  }
  if (sub === 'connections') {
    main.innerHTML = `<div class="page settings">${header('Connections')}<div class="set-group">
      ${ctx.discordUrl ? `<a class="set-item" href="${esc(ctx.discordUrl)}" target="_blank" rel="noopener"><span class="si" style="background:#5865F2;color:#fff">${'<svg viewBox="0 0 24 24"><path fill="currentColor" stroke="none" d="M20.3 4.4A19.8 19.8 0 0 0 15.4 3l-.6 1.3a18.4 18.4 0 0 0-5.5 0L8.6 3a19.7 19.7 0 0 0-4.9 1.5C.6 9.1-.3 13.6.1 18.1a19.9 19.9 0 0 0 6 3l1.3-2a12.9 12.9 0 0 1-2-1l.5-.4a14.2 14.2 0 0 0 12.2 0l.5.4c-.6.4-1.3.7-2 1l1.3 2a19.8 19.8 0 0 0 6-3c.5-5.2-.8-9.7-3.6-13.7Z"/></svg>'}</span><span class="st"><b>Discord</b><small>Join the community server</small></span><span class="sc">${ico('chev')}</span></a>` : ''}
      ${ctx.githubUrl ? `<a class="set-item" href="${esc(ctx.githubUrl)}" target="_blank" rel="noopener"><span class="si">${ico('link')}</span><span class="st"><b>GitHub</b><small>Source code</small></span><span class="sc">${ico('chev')}</span></a>` : `<div class="set-item"><span class="si">${ico('link')}</span><span class="st"><b>GitHub</b><small>Coming soon</small></span></div>`}
    </div></div>`;
    return;
  }
  // tv / profiles: honest placeholders
  const t = sub === 'tv' ? ['TV Sync', 'Pair a TV by code to continue watching on the big screen. Coming soon — for now, sign in on the TV’s browser to sync your list and history.'] : ['Profiles', 'Multiple viewer profiles per account are coming soon. Today each signed-in account has one profile.'];
  main.innerHTML = `<div class="page settings">${header(t[0])}<div class="set-group pad"><p class="set-note" style="margin:0">${t[1]}</p></div></div>`;
}
