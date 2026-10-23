// GhostFlix Stage G: profile flair + rank card + watch stats + badges shelf, Favourite 4, follows, shared lists.
// Everything is validated server-side (server/b6.js): rank locks, sanitising, friends-only follows/lists, privacy.
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
import { tagHTML } from './community.js?v=20261023zk';
const keyOf = (c) => `${c.media_type}:${c.id}`;

// Original ghost mascots (drawn here; no third-party characters). viewBox 0 0 64 64, idle animation in CSS.
const BODY = 'M32 7C19 7 10 17 10 30v24l5.5-5 5.5 5 5.5-5 5.5 5 5.5-5 5.5 5 5.5-5 5.5 5V30C54 17 45 7 32 7z';
const EYES = '<g class="gm-eyes"><ellipse cx="25" cy="29" rx="3.2" ry="4.3" fill="#10131c"/><ellipse cx="39" cy="29" rx="3.2" ry="4.3" fill="#10131c"/><circle cx="26" cy="27.4" r="1.1" fill="#fff"/><circle cx="40" cy="27.4" r="1.1" fill="#fff"/></g>';
const BLUSH = '<circle cx="20.5" cy="35" r="2.6" fill="#ff8fb1" opacity=".55"/><circle cx="43.5" cy="35" r="2.6" fill="#ff8fb1" opacity=".55"/>';
export const MASCOTS = {
  boo: { name: 'Boo', svg: `<path class="gm-b" d="${BODY}" fill="#f4f7ff"/>${EYES}${BLUSH}<ellipse cx="32" cy="38" rx="2.6" ry="3" fill="#10131c"/>` },
  sheet: { name: 'Sleepy Sheet', svg: `<path class="gm-b" d="${BODY}" fill="#c9b8ff"/><path d="M21 29q4 3 8 0M35 29q4 3 8 0" stroke="#2a1d52" stroke-width="2.2" fill="none" stroke-linecap="round"/>${BLUSH}<path d="M29 38q3 2 6 0" stroke="#2a1d52" stroke-width="2" fill="none" stroke-linecap="round"/><text class="gm-z" x="47" y="14" font-size="10" font-weight="700" fill="#c9b8ff">z</text>` },
  pumpkin: { name: 'Pumpkin Spirit', svg: `<path class="gm-b" d="${BODY}" fill="#ff9a3c"/><path d="M24 12q8-3 16 0M22 18q10-4 20 0" stroke="#d96a12" stroke-width="1.6" fill="none"/><rect x="30" y="2.5" width="4" height="6" rx="1.5" fill="#3f8f3a"/><path d="M34 5q6-4 9 1-5 1-9-1z" fill="#57b44f"/><path d="M22 27l5-3 1 6zM42 27l-5-3-1 6z" fill="#3a1600"/><path d="M24 37l3 2 3-2 2 2 2-2 3 2 3-2-2 4h-12z" fill="#3a1600"/>` },
  popcorn: { name: 'Popcorn Pal', svg: `<path class="gm-b" d="${BODY}" fill="#f4f7ff"/>${EYES}<path d="M28 36q4 4 8 0" stroke="#10131c" stroke-width="2" fill="none" stroke-linecap="round"/><g class="gm-pc"><path d="M22 42h20l-2.5 16h-15z" fill="#e50914"/><path d="M27 42l1.3 16M32 42v16M37 42l-1.3 16" stroke="#fff" stroke-width="2"/><circle cx="24" cy="41" r="3" fill="#ffe7a3"/><circle cx="29" cy="39.5" r="3.2" fill="#fff4cc"/><circle cx="35" cy="39.5" r="3.2" fill="#ffe7a3"/><circle cx="40" cy="41" r="3" fill="#fff4cc"/></g>` },
  director: { name: 'The Director', svg: `<path class="gm-b" d="${BODY}" fill="#e8ecff"/><ellipse cx="29" cy="11" rx="15" ry="5.5" fill="#7a1022" transform="rotate(-12 29 11)"/><circle cx="20" cy="9" r="2" fill="#7a1022"/>${EYES}<path d="M27 37h10" stroke="#10131c" stroke-width="2.2" stroke-linecap="round"/><g transform="translate(40 40) rotate(-14)"><rect width="16" height="11" rx="1.5" fill="#1b1f2a"/><path d="M0 0h16l-1.5-4h-15z" fill="#f4f7ff"/><path d="M3 -4l2 4M8 -4l2 4M13 -4l2 4" stroke="#1b1f2a" stroke-width="1.6"/></g>` },
  wisp: { name: 'Will-o’-Wisp', svg: `<defs><radialGradient id="gmw" cx="50%" cy="40%" r="60%"><stop offset="0" stop-color="#d9fffb"/><stop offset=".6" stop-color="#5fe3ff"/><stop offset="1" stop-color="#2a7bff"/></radialGradient></defs><path class="gm-b" d="M32 3c3 6 11 9 15 16 5 9 4 16 4 23 0 9-7 17-19 17s-19-8-19-17c0-9 3-14 8-19 2 4 4 5 6 5-2-9 2-18 5-25z" fill="url(#gmw)"/>${EYES}<path d="M28 41q4 3 8 0" stroke="#10131c" stroke-width="2" fill="none" stroke-linecap="round"/>` },
};
export const mascotSVG = (id) => (MASCOTS[id] ? `<svg class="gm gm-${id}" viewBox="0 0 64 64" aria-hidden="true">${MASCOTS[id].svg}</svg>` : '');
// Rank borders (ids match server/b6.js RANK_BORDERS) and name effects (NAME_FX).
export const RANK_BORDERS = [['rk-neon', 'Neon'], ['rk-fire', 'Fire'], ['rk-mist', 'Ghost mist'], ['rk-vine', 'Pumpkin vine'], ['rk-glitch', 'Glitch']];
export const NAME_FX = [['glow', 'Glow'], ['shimmer', 'Shimmer'], ['rainbow', 'Rainbow']];
// Seasonal frames only appear in their month (UK time).
export const seasonNow = () => { const m = +new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/London', month: 'numeric' }).format(new Date()); return m === 10 ? 'halloween' : m === 12 ? 'christmas' : null; };
const FRAME = { halloween: ['🎃', '🦇', '🕸️'], christmas: ['🎄', '❄️', '🎁'] };

// Avatar with flair: border ring, mascot (else photo/initial), seasonal frame.
export function avatarHTML({ img, name, color, mascot, border = 'none', seasonal = true, size = 96 }) {
  const inner = mascot && MASCOTS[mascot] ? `<span class="ini fl-m">${mascotSVG(mascot)}</span>` : img ? `<img src="${esc(img)}" alt="" referrerpolicy="no-referrer">` : `<span class="ini" style="${color ? `background:${esc(color)};color:#04050a` : ''}">${esc((name || '?')[0])}</span>`;
  const s = seasonal ? seasonNow() : null;
  const av = `<span class="gf-av gfb-${esc(border || 'none')} fl-av" style="--sz:${size}px">${inner}</span>`;
  return s ? `<span class="fl-frame sfr-${s}" style="--sz:${size}px">${av}${FRAME[s].map((e, i) => `<i class="sfr-i sfr-${i}" aria-hidden="true">${e}</i>`).join('')}</span>` : av;
}
export const nameHTML = (name, fx) => `<span class="fl-name${fx ? ` nfx-${esc(fx)}` : ''}" data-t="${esc(name)}">${esc(name)}</span>`;
export const bannerStyle = (b) => (b?.type === 'backdrop' ? `background-image:linear-gradient(180deg,rgba(4,5,10,.05),rgba(4,5,10,.85)),url('${esc(b.url)}')` : b?.type === 'gradient' ? `background-image:linear-gradient(${+b.angle || 135}deg,${esc(b.a)},${esc(b.b)})` : '');

export function rankCardHTML(r, own) {
  if (!r) return '';
  const t = r.tier; const n = r.next;
  return `<div class="rkc" style="--tc:${esc(t.color)}"><div class="rkc-h"><span class="rkc-e" aria-hidden="true">${t.emoji}</span><div><small>GhostFlix rank</small><b>${esc(t.name)}</b></div><span class="rkc-hrs"><b>${r.hours}</b> h</span></div>
    <div class="rkc-bar" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${Math.round(r.progress * 100)}" aria-label="Progress to next rank"><i style="width:${Math.max(2, Math.round(r.progress * 100))}%"></i></div>
    <p class="rkc-n">${n ? `<b>${n.need_hours} h</b> more to ${n.emoji} ${esc(n.name)}` : 'Top rank reached 🎉'}${own ? ` · Same tiers as the Discord roles (<code>/flixrank</code>)${r.discord ? ' · Discord linked ✓' : ' · Sign in with Discord to get the role'}` : ''}</p></div>`;
}
export function statsHTML(s, genreName) {
  if (!s) return '';
  const max = Math.max(0.01, ...s.month_days.map((d) => d.h));
  const now = new Date(); const dim = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
  const byDay = Object.fromEntries(s.month_days.map((d) => [+String(d.d).slice(8, 10), d.h]));
  const bars = Array.from({ length: dim }, (_, i) => { const h = byDay[i + 1] || 0; return `<i style="height:${h ? Math.max(6, (h / max) * 100) : 2}%" title="${i + 1}: ${h} h"></i>`; }).join('');
  const gmax = Math.max(1, ...s.genres.map((g) => g.n));
  const gs = s.genres.map((g) => `<div class="gbar"><span>${esc(genreName?.(g.id) || 'Other')}</span><i><b style="width:${Math.round((g.n / gmax) * 100)}%"></b></i><small>${g.n}</small></div>`).join('');
  return `<div class="wst"><div class="wst-k"><div><b>${s.month_hours}</b><small>hours this month</small></div><div><b>${s.best_day ? s.best_day.hours : 0}</b><small>longest binge (h)${s.best_day ? ` · ${new Date(s.best_day.d + 'T12:00:00').toLocaleDateString(undefined, { day: 'numeric', month: 'short' })}` : ''}</small></div><div><b>${s.best_run}</b><small>days in a row</small></div><div><b>${s.titles}</b><small>titles watched</small></div></div>
    <div class="wst-c"><small class="dim">This month, hours per day</small><div class="mbars" aria-hidden="true">${bars}</div></div>
    ${gs ? `<div class="wst-c"><small class="dim">Top genres</small>${gs}</div>` : ''}</div>`;
}
export const badgesHTML = (bs) => `<div class="badges fl-badges">${(bs || []).map((b) => `<div class="badge ${b.got ? '' : 'locked'}" title="${esc(b.desc)}"><span class="bi" aria-hidden="true">${b.icon}</span><b>${esc(b.name)}</b><small>${b.got ? 'Unlocked' : esc(b.desc)}</small>${!b.got && b.prog ? `<span class="bp"><i style="width:${Math.round(b.prog * 100)}%"></i></span>` : ''}</div>`).join('')}</div>`;

export function createFlair(ctx) {
  const call = (...a) => ctx.comm.call(...a);
  const signedIn = () => !!ctx.auth()?.user;
  const pid = () => ctx.profiles?.active?.()?.id || 'main';
  const toast = (m) => ctx.toast?.(m);
  function modal(label, html, onMount) {
    const m = document.createElement('div'); m.className = 'authm open gfm fl-modal'; m.setAttribute('role', 'dialog'); m.setAttribute('aria-modal', 'true'); m.setAttribute('aria-label', label);
    m.innerHTML = `<div class="bx"><button class="x" type="button" aria-label="Close">×</button>${html}</div>`;
    const close = () => m.remove();
    m.addEventListener('click', (e) => { if (e.target === m || e.target.closest('.x,[data-close]')) close(); });
    m.addEventListener('keydown', (e) => { if (e.key === 'Escape') { e.stopPropagation(); close(); } });
    document.body.appendChild(m); onMount?.(m, close); return m;
  }
  // Title chooser: My List + recently watched, plus catalogue search.
  function chooseTitle(label, onPick, { needBackdrop } = {}) {
    const seen = new Set(); const mine = [...(ctx.list() || []), ...(ctx.history() || [])].filter((c) => c && c.id && c.media_type && !seen.has(keyOf(c)) && seen.add(keyOf(c)) && (!needBackdrop || c.backdrop)).slice(0, 60);
    const tile = (c) => `<button type="button" class="ch-t" data-k="${esc(keyOf(c))}">${(needBackdrop ? c.backdrop : c.poster) ? `<img src="${esc(needBackdrop ? c.backdrop : c.poster)}" alt="" loading="lazy">` : '<span class="ch-np">🎬</span>'}<span>${esc(c.title)}</span></button>`;
    let pool = new Map(mine.map((c) => [keyOf(c), c]));
    modal(label, `<h2>${esc(label)}</h2><form class="ch-s"><input type="search" placeholder="Search titles…" aria-label="Search titles" maxlength="100"><button class="btn dark sm" type="submit">Search</button></form><div class="ch-g ${needBackdrop ? 'wide' : ''}">${mine.map(tile).join('') || '<p class="dim">Nothing in My List or history yet — search above.</p>'}</div>`, (m, close) => {
      const g = $('.ch-g', m);
      g.onclick = (e) => { const b = e.target.closest('[data-k]'); if (!b) return; const c = pool.get(b.dataset.k); if (c) { close(); onPick(c); } };
      $('.ch-s', m).onsubmit = async (e) => { e.preventDefault(); const q = $('input', m).value.trim(); if (!q) return; g.innerHTML = '<p class="dim">Searching…</p>';
        try { const d = await ctx.api(`/api/search?q=${encodeURIComponent(q)}`); const r = (d.results || []).filter((c) => c.media_type && (!needBackdrop || c.backdrop)).slice(0, 30); pool = new Map(r.map((c) => [keyOf(c), c])); g.innerHTML = r.map(tile).join('') || '<p class="dim">No matches.</p>'; } catch (er) { g.innerHTML = `<p class="dim">${esc(er.message)}</p>`; } };
      setTimeout(() => $('input', m)?.focus(), 30);
    });
  }
  const slim = (c) => ({ id: c.id, media_type: c.media_type, title: c.title, year: c.year, poster: c.poster, backdrop: c.backdrop });

  // ------------------------------------------------ Settings › Profile: rank card, stats, badges, flair editor
  async function mountProfile(el, me) {
    if (!el) return;
    for (let i = 0; i < 40 && !signedIn() && localStorage.getItem('ghostflix-auth'); i++) await new Promise((r) => setTimeout(r, 100)); // session still restoring
    if (!el.isConnected) return;
    if (!me) { const m = ctx.auth()?.meta?.() || {}; me = { name: m.name, av: m.av }; }
    if (!signedIn()) { el.innerHTML = '<div class="set-label">Rank &amp; flair</div><div class="set-group pad"><p class="dim">Sign in to see your GhostFlix rank, watch stats and badges, and unlock animated borders.</p></div>'; return; }
    el.innerHTML = '<div class="set-label">Rank &amp; flair</div><div class="set-group pad"><div class="skel" style="height:120px;border-radius:14px"></div></div>';
    const P = pid(); let d;
    try { d = await call(`/api/me/flair/${encodeURIComponent(P)}`); } catch (e) { el.innerHTML = `<div class="set-label">Rank &amp; flair</div><div class="set-group pad"><p class="dim">${esc(e.message)}</p></div>`; return; }
    let f = { ...d.flair }; const ti = d.unlock_all ? d.tiers.length - 1 : d.rank.tier.i; const tierAt = (i) => d.tiers[i];
    const lockNote = (i) => `🔒 ${tierAt(i).emoji} ${esc(tierAt(i).name)} · ${tierAt(i).hours} h`;
    const preview = () => `<div class="fl-card" style="${bannerStyle(f.banner)}"><div class="fl-card-in">${avatarHTML({ img: me?.av, name: me?.name, mascot: f.mascot, border: f.border, seasonal: f.seasonal, size: 84 })}<div><b class="fl-pn">${nameHTML(me?.name || 'Viewer', f.name_fx)}${tagHTML(d.tag)}</b>${f.tagline ? `<small class="fl-tag">${esc(f.tagline)}</small>` : ''}<span class="fl-chip" style="--tc:${esc(d.rank.tier.color)}">${d.rank.tier.emoji} ${esc(d.rank.tier.name)}</span></div></div></div>`;
    const favs = () => `<div class="fav4 ed">${[0, 1, 2, 3].map((i) => { const c = f.fav4[i]; return c ? `<div class="fv"><img src="${esc(c.poster || '')}" alt=""><span>${esc(c.title)}</span><button type="button" class="fv-x" data-fvx="${i}" aria-label="Remove ${esc(c.title)}">×</button></div>` : `<button type="button" class="fv add" data-fvadd="${i}" aria-label="Add a favourite"><span>＋</span></button>`; }).join('')}</div>`;
    const bannerEd = () => { const b = f.banner; const g = b?.type === 'gradient' ? b : { a: '#2a0845', b: '#e50914', angle: 135 };
      return `<div class="fl-ban"><div class="seg" role="group" aria-label="Banner"><button type="button" class="pill ${!b ? 'on' : ''}" data-ban="none">None</button><button type="button" class="pill ${b?.type === 'gradient' ? 'on' : ''}" data-ban="gradient">Gradient</button><button type="button" class="pill ${b?.type === 'backdrop' ? 'on' : ''}" data-ban="backdrop">Film backdrop</button></div>
      ${b?.type === 'gradient' ? `<div class="fl-grad"><label>From <input type="color" id="flGa" value="${esc(g.a)}"></label><label>To <input type="color" id="flGb" value="${esc(g.b)}"></label><label>Angle <input type="range" id="flGr" min="0" max="360" step="15" value="${+g.angle}"></label></div>` : ''}
      ${b?.type === 'backdrop' ? `<p class="small dim">Backdrop: <b>${esc(b.title || 'film still')}</b> <button type="button" class="btn dark sm" data-ban="backdrop">Change</button></p>` : ''}</div>`; };
    const render = () => {
      el.innerHTML = `<div class="set-label">Rank &amp; flair</div>
      <div class="set-group pad">${preview()}</div>
      <div class="set-group pad">${rankCardHTML(d.rank, true)}</div>
      <div class="set-label">Watch stats</div><div class="set-group pad">${statsHTML(d.stats, ctx.genreName)}</div>
      <div class="set-label">Badges</div><div class="set-group pad">${badgesHTML(d.badges)}</div>
      <div class="set-label">Rank borders</div><div class="set-group pad"><div class="cos-grid">${[['none', 'Use Look border'], ...RANK_BORDERS].map(([id, l]) => { const need = d.unlocks.borders[id]; const lock = need != null && need > ti; return `<button type="button" class="cos-opt ${f.border === id ? 'on' : ''} ${lock ? 'locked' : ''}" data-rb="${id}" aria-pressed="${f.border === id}" ${lock ? `aria-disabled="true" title="Unlocks at ${esc(tierAt(need).name)}"` : ''}>${avatarHTML({ img: me?.av, name: me?.name, mascot: f.mascot, border: id === 'none' ? 'none' : id, seasonal: false, size: 48 })}<span>${esc(l)}</span>${lock ? `<small class="lk">${lockNote(need)}</small>` : ''}</button>`; }).join('')}</div><p class="set-note">Animated borders unlock as your rank goes up. They show on your public profile and the card above.</p></div>
      <div class="set-label">Ghost mascot avatar</div><div class="set-group pad"><div class="cos-grid">${[['', 'My photo'], ...Object.entries(MASCOTS).map(([k, v]) => [k, v.name])].map(([id, l]) => `<button type="button" class="cos-opt ${String(f.mascot || '') === id ? 'on' : ''}" data-ms="${id}" aria-pressed="${String(f.mascot || '') === id}">${avatarHTML({ img: me?.av, name: me?.name, mascot: id || null, border: 'none', seasonal: false, size: 48 })}<span>${esc(l)}</span></button>`).join('')}</div></div>
      <div class="set-label">Name effect</div><div class="set-group pad"><div class="fl-fx">${[['', 'None'], ...NAME_FX].map(([id, l]) => { const need = d.unlocks.name_fx[id]; const lock = id && need > ti; return `<button type="button" class="pill ${String(f.name_fx || '') === id ? 'on' : ''} ${lock ? 'locked' : ''}" data-fx="${id}" aria-pressed="${String(f.name_fx || '') === id}" ${lock ? 'aria-disabled="true"' : ''}>${id ? nameHTML(l, id) : l}${lock ? ` <small>${lockNote(need)}</small>` : ''}</button>`; }).join('')}</div></div>
      <div class="set-label">Banner, tagline &amp; frame</div><div class="set-group pad">${bannerEd()}
        <label class="fl-in"><span>Tagline <small class="dim" id="flTc">${Array.from(f.tagline || '').length}/60</small></span><input id="flTag" maxlength="120" value="${esc(f.tagline || '')}" placeholder="e.g. 👻 Horror at 2am, always"></label>
        <label class="tg"><span><b>Seasonal frame</b><small>🎃 Halloween in October, 🎄 Christmas in December — only during that month</small></span><input type="checkbox" id="flSeas" ${f.seasonal ? 'checked' : ''}></label></div>
      <div class="set-label">Favourite 4</div><div class="set-group pad">${favs()}<p class="set-note">Pick from My List, your history or search. Shown on your public profile.</p></div>
      <div class="fl-save"><button class="btn cta" type="button" id="flSave">Save flair</button><span class="dim small" id="flMsg"></span></div>`;
      wire();
    };
    const save = async (patch, quiet) => {
      try { const r = await call(`/api/me/flair/${encodeURIComponent(P)}`, { method: 'PUT', body: patch }); f = { ...r.flair }; if (!quiet) toast('Flair saved'); render(); }
      catch (e) { toast(e.message); }
    };
    function wire() {
      $$('[data-rb]', el).forEach((b) => (b.onclick = () => { const need = d.unlocks.borders[b.dataset.rb]; if (need != null && need > ti) return toast(`Unlocks at ${tierAt(need).emoji} ${tierAt(need).name} (${tierAt(need).hours} h watched)`); f.border = b.dataset.rb; render(); }));
      $$('[data-ms]', el).forEach((b) => (b.onclick = () => { f.mascot = b.dataset.ms || null; render(); }));
      $$('[data-fx]', el).forEach((b) => (b.onclick = () => { const id = b.dataset.fx; if (id && d.unlocks.name_fx[id] > ti) return toast(`Unlocks at ${tierAt(d.unlocks.name_fx[id]).emoji} ${tierAt(d.unlocks.name_fx[id]).name}`); f.name_fx = id || null; render(); }));
      $$('[data-ban]', el).forEach((b) => (b.onclick = () => { const t = b.dataset.ban;
        if (t === 'none') { f.banner = null; render(); } else if (t === 'gradient') { f.banner = { type: 'gradient', a: '#2a0845', b: '#e50914', angle: 135 }; render(); }
        else chooseTitle('Pick a banner backdrop', (c) => { f.banner = { type: 'backdrop', url: c.backdrop, title: c.title, key: keyOf(c) }; render(); }, { needBackdrop: true }); }));
      const gr = () => { f.banner = { type: 'gradient', a: $('#flGa', el).value, b: $('#flGb', el).value, angle: +$('#flGr', el).value }; const c = $('.fl-card', el); if (c) c.setAttribute('style', bannerStyle(f.banner)); };
      ['#flGa', '#flGb', '#flGr'].forEach((s) => { const i = $(s, el); if (i) i.oninput = gr; });
      const tg = $('#flTag', el); tg.oninput = () => { const a = Array.from(tg.value); if (a.length > 60) tg.value = a.slice(0, 60).join(''); f.tagline = tg.value; $('#flTc', el).textContent = `${Array.from(tg.value).length}/60`; };
      $('#flSeas', el).onchange = (e) => { f.seasonal = e.target.checked; };
      $$('[data-fvx]', el).forEach((b) => (b.onclick = () => { f.fav4 = f.fav4.filter((_, i) => i !== +b.dataset.fvx); render(); }));
      $$('[data-fvadd]', el).forEach((b) => (b.onclick = () => chooseTitle('Add a favourite', (c) => { if (f.fav4.some((x) => keyOf(x) === keyOf(c))) return toast('Already in your Favourite 4'); f.fav4 = [...f.fav4, slim(c)].slice(0, 4); render(); })));
      $('#flSave', el).onclick = () => save({ border: f.border, mascot: f.mascot, name_fx: f.name_fx, seasonal: f.seasonal, banner: f.banner, tagline: f.tagline, fav4: f.fav4.map(slim) });
    }
    render();
  }

  // ------------------------------------------------ public profile /u/:slug decorations
  async function publicPage(slug) {
    const root = $('.pubp', ctx.main); if (!root) return;
    let x; try { x = await ctx.api(`/api/u/${slug}/extra`); } catch { return; }
    if (!root.isConnected) return;
    const fl = x.flair || {}; const h = $('.pubp-h', root); const name = $('h1', root)?.firstChild?.textContent || '';
    if (fl.banner) { const b = document.createElement('div'); b.className = 'fl-banner'; b.setAttribute('style', bannerStyle(fl.banner)); root.prepend(b); root.classList.add('has-ban'); }
    const av = $('.pubp-av', root);
    if (av) { const img = $('img', av)?.getAttribute('src'); const color = getComputedStyle(av).getPropertyValue('--pc').trim(); const w = document.createElement('div'); w.className = 'pubp-fav'; w.innerHTML = avatarHTML({ img, name, color, mascot: fl.mascot, border: fl.border, seasonal: fl.seasonal, size: 96 }); av.replaceWith(w); }
    const h1 = $('h1', root); if (h1 && fl.name_fx) h1.innerHTML = nameHTML(name, fl.name_fx) + tagHTML(x.tag);
    if (h1 && fl.tagline) h1.insertAdjacentHTML('afterend', `<p class="fl-tag">${esc(fl.tagline)}</p>`);
    if (h1 && x.rank) h1.insertAdjacentHTML('beforebegin', `<span class="fl-chip" style="--tc:${esc(x.rank.tier.color)}">${x.rank.tier.emoji} ${esc(x.rank.tier.name)}</span>`);
    let html = '';
    if (x.watching) html += `<a class="fl-watch" href="${esc(x.watching.href || '#')}" data-link>▶ Watching now: <b>${esc(x.watching.title)}</b>${x.watching.sub ? ` · ${esc(x.watching.sub)}` : ''}</a>`;
    if (fl.fav4?.length) { ctx.remember?.(fl.fav4); html += `<h2 class="fr-h">Favourite 4</h2><div class="fav4">${fl.fav4.map((c) => `<a class="fv" href="/title/${c.media_type}/${c.id}" data-link>${c.poster ? `<img src="${esc(c.poster)}" alt="" loading="lazy">` : ''}<span>${esc(c.title)}</span></a>`).join('')}</div>`; }
    if (x.rank) html += `<h2 class="fr-h">Rank</h2>${rankCardHTML(x.rank, false)}`;
    if (x.stats) html += `<h2 class="fr-h">Watch stats</h2>${statsHTML(x.stats, ctx.genreName)}`;
    if (x.badges) { $$('h2', root).forEach((t) => { if (/^Badges$/i.test(t.textContent.trim())) t.textContent = 'Achievements'; }); html += `<h2 class="fr-h">Badges</h2>${badgesHTML(x.badges)}`; }
    const sec = document.createElement('div'); sec.className = 'fl-pub'; sec.innerHTML = html; (h || root.firstElementChild)?.after(sec);
    for (let i = 0; i < 40 && !ctx.comm.state?.mod && signedIn() && sec.isConnected; i++) await new Promise((r) => setTimeout(r, 100)); // mod flag arrives with /api/me/ping
    if (!ctx.comm.state?.mod || !sec.isConnected) return; // button is a convenience; /api/mod/flag re-checks the role server-side
    sec.insertAdjacentHTML('beforeend', `<p class="fl-mod"><button class="btn dark sm" type="button" id="flFlag">🚩 Flag bio / tagline</button></p>`);
    const fb = $('#flFlag', sec); if (fb) fb.onclick = async () => {
      const why = prompt('Why flag this bio/tagline? (sent to the admin inbox)'); if (why == null) return;
      const bio = $('.pubp-h .lead', root)?.textContent || '';
      try { await call('/api/mod/flag', { method: 'POST', body: { kind: 'flag_user', slug, what: 'bio', title: `Bio: ${name}`.slice(0, 120), body: `${why}\n\nTagline: ${fl.tagline || '—'}\nBio: ${bio}`.slice(0, 1000) } }); fb.disabled = true; fb.textContent = '🚩 Flagged'; toast('Flagged for the admin'); } catch (e) { toast(e.message); }
    };
  }

  // ------------------------------------------------ Friends page: follow toggles, following now, shared lists
  async function friends() {
    const root = $('.friends', ctx.main); if (!root || !signedIn()) return;
    let fr, fo, sl; try { [fr, fo, sl] = await Promise.all([call('/api/friends'), call('/api/me/following'), call('/api/me/shared-lists')]); } catch { return; }
    if (!root.isConnected || !fr.on) return;
    const acc = new Set(fr.friends.map((f) => f.id)); const fol = new Set(fo.ids);
    $$('[data-rm]', root).forEach((b) => { const id = b.dataset.rm; if (!acc.has(id) || b.parentElement.querySelector('[data-fol]')) return;
      const on = fol.has(id); b.insertAdjacentHTML('beforebegin', `<button class="btn ${on ? 'cta' : 'dark'} sm fl-fol" type="button" data-fol="${id}" aria-pressed="${on}">${on ? '✓ Following' : '+ Follow'}</button>`); });
    $$('[data-fol]', root).forEach((b) => (b.onclick = async () => { const on = b.getAttribute('aria-pressed') !== 'true';
      try { await call('/api/me/follow', { method: 'POST', body: { id: b.dataset.fol, on } }); b.setAttribute('aria-pressed', String(on)); b.className = `btn ${on ? 'cta' : 'dark'} sm fl-fol`; b.textContent = on ? '✓ Following' : '+ Follow'; toast(on ? 'Following — you’ll see what they watch on Home (if they share it)' : 'Unfollowed'); } catch (e) { toast(e.message); } }));
    const watching = fo.following.filter((f) => f.watching);
    const box = document.createElement('div'); box.className = 'fl-friends';
    box.innerHTML = `<h2 class="fr-h">Following <small class="dim">${fo.following.length}</small></h2><div class="set-group pad">${fo.following.length ? (watching.length ? watching.map((f) => `<a class="fl-watch" href="${esc(f.watching.href || '#')}" data-link><b>${esc(f.name)}${tagHTML(f.tag)}</b> ▶ ${esc(f.watching.title)}${f.watching.sub ? ` · ${esc(f.watching.sub)}` : ''}</a>`).join('') : '<p class="dim">Nobody you follow is watching right now (or they haven’t turned on sharing).</p>') : '<p class="dim">Follow friends to see what they’re watching on your Home page. Off by default — they only show up if they turned on <b>Share what I’m watching</b>.</p>'}</div>
      <h2 class="fr-h">Shared lists <small class="dim">${sl.lists.length}</small></h2><div class="set-group pad">${sl.lists.map((l) => `<a class="shl" href="/shared/${l.id}" data-link><span class="shl-p">${l.preview.map((p) => `<img src="${esc(p)}" alt="" loading="lazy">`).join('') || '🎬'}</span><span><b>${esc(l.name)}</b><small class="dim">with ${esc(l.friend.name)} · ${l.count} title${l.count === 1 ? '' : 's'}</small></span></a>`).join('')}
      ${fr.friends.length ? `<form class="shl-new" id="shlNew"><input id="shlName" maxlength="60" placeholder="New list, e.g. Movie night 🍿" aria-label="List name" required><select id="shlFr" aria-label="Build it with">${fr.friends.map((f) => `<option value="${esc(f.id)}">with ${esc(f.name)}</option>`).join('')}</select><button class="btn cta sm" type="submit">Create</button></form>` : '<p class="dim">Add a friend to build a list together.</p>'}</div>`;
    const anchor = $$('.fr-h', root).find((t) => /^Your friends/.test(t.textContent)); anchor ? anchor.before(box) : root.append(box);
    const form = $('#shlNew', box); if (form) form.onsubmit = async (e) => { e.preventDefault();
      try { const r = await call('/api/me/shared-lists', { method: 'POST', body: { friend: $('#shlFr', box).value, name: $('#shlName', box).value } }); history.pushState({}, '', `/shared/${r.id}`); dispatchEvent(new PopStateEvent('popstate')); } catch (er) { toast(er.message); } };
  }
  async function viewShared(id) {
    const main = ctx.main; document.title = 'Shared list — GhostFlix';
    if (!signedIn()) { main.innerHTML = '<div class="page narrow"><h1>Shared list</h1><p class="lead">Sign in to see this list.</p></div>'; return; }
    main.innerHTML = '<div class="page"><div class="skel" style="height:200px;border-radius:16px"></div></div>';
    let l; try { l = await call(`/api/me/shared-lists/${id}`); } catch (e) { main.innerHTML = `<div class="page narrow"><h1>Shared list</h1><p class="lead">${esc(e.message)}</p><a class="btn dark" href="/friends" data-link>Back to Friends</a></div>`; return; }
    document.title = `${l.name} — GhostFlix`; ctx.remember?.(l.items);
    main.innerHTML = `<div class="page shlp"><a class="dim small" href="/friends" data-link>‹ Friends</a><h1>${esc(l.name)}</h1><p class="lead">Built together with <b>${esc(l.friend.name)}</b> · ${l.count} title${l.count === 1 ? '' : 's'}${l.still_friends ? '' : ' · read-only (no longer friends)'}</p>
      <div class="shl-acts">${l.still_friends ? '<button class="btn cta sm" type="button" id="shlAdd">＋ Add a title</button>' : ''}<button class="btn dark sm" type="button" id="shlRen">Rename</button><button class="btn dark sm" type="button" id="shlDel">Delete list</button></div>
      <div class="shl-g">${l.items.map((c) => `<div class="shl-i">${ctx.cardHTML(c)}<small class="dim">added by ${esc(c.by)}</small>${l.still_friends ? `<button class="fv-x" type="button" data-rmk="${esc(keyOf(c))}" aria-label="Remove ${esc(c.title)}">×</button>` : ''}</div>`).join('') || '<p class="dim">Empty — add the first title.</p>'}</div></div>`;
    const re = () => viewShared(id);
    const add = $('#shlAdd', main); if (add) add.onclick = () => chooseTitle('Add to shared list', async (c) => { try { const r = await call(`/api/me/shared-lists/${id}/items`, { method: 'POST', body: { card: slim(c) } }); toast(r.dup ? 'Already on the list' : `Added ${c.title}`); re(); } catch (e) { toast(e.message); } });
    $$('[data-rmk]', main).forEach((b) => (b.onclick = async () => { try { await call(`/api/me/shared-lists/${id}/items`, { method: 'POST', body: { remove: b.dataset.rmk } }); re(); } catch (e) { toast(e.message); } }));
    $('#shlRen', main).onclick = async () => { const n = prompt('Rename list', l.name); if (!n) return; try { await call(`/api/me/shared-lists/${id}`, { method: 'PATCH', body: { name: n } }); re(); } catch (e) { toast(e.message); } };
    $('#shlDel', main).onclick = async () => { if (!confirm(`Delete “${l.name}” for both of you?`)) return; try { await call(`/api/me/shared-lists/${id}`, { method: 'DELETE' }); history.pushState({}, '', '/friends'); dispatchEvent(new PopStateEvent('popstate')); } catch (e) { toast(e.message); } };
  }
  // ------------------------------------------------ Home: friends you follow who are watching now
  async function homeStrip(rowsEl, after) {
    if (!signedIn() || !ctx.comm.feat?.('friends')) return;
    let fo; try { fo = await call('/api/me/following'); } catch { return; }
    const w = (fo.following || []).filter((f) => f.watching); if (!w.length || !rowsEl.isConnected || after('gf-fwatch')) return;
    const sec = document.createElement('section'); sec.className = 'row fl-home'; sec.dataset.row = 'gf-fwatch';
    sec.innerHTML = `<div class="row-h"><h2>Friends watching now</h2><a class="more" href="/friends" data-link>Friends ›</a></div><div class="fl-chips">${w.map((f) => `<a class="fl-watch" href="${esc(f.watching.href || '#')}" data-link><b>${esc(f.name)}${tagHTML(f.tag)}</b> ▶ ${esc(f.watching.title)}${f.watching.sub ? ` · ${esc(f.watching.sub)}` : ''}</a>`).join('')}</div>`;
    const ref = after('continue') || after('mylist'); ref ? ref.after(sec) : rowsEl.prepend(sec);
  }
  return { mountProfile, publicPage, friends, viewShared, homeStrip };
}
