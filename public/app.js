// GhostFlix front-end — tiny dependency-free SPA.
import { createAuth, ICONS } from './auth.js?v=20261021c';
import { applyCosmetics } from './cosmetics.js?v=20261021c';
import { Settings, applySettings, renderSettings, embedSandbox } from './settings.js?v=20261022b';
import { viewDiscover, viewLive, viewPartyHome, viewParty, leaveParty } from './pages.js?v=20261022b';
applySettings(); applyCosmetics();
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const main = $('#main');
const ICON = {
  play: '<svg viewBox="0 0 24 24"><path d="M7 4.5v15c0 .8.9 1.3 1.6.8l11.5-7.5c.6-.4.6-1.3 0-1.7L8.6 3.7C7.9 3.2 7 3.7 7 4.5Z"/></svg>',
  info: '<svg viewBox="0 0 24 24"><path d="M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20Zm1 15h-2v-6h2v6Zm0-8h-2V7h2v2Z"/></svg>',
  plus: '<svg viewBox="0 0 24 24"><path d="M11 5h2v6h6v2h-6v6h-2v-6H5v-2h6z"/></svg>',
  check: '<svg viewBox="0 0 24 24"><path d="m9.5 16.2-4.2-4.2-1.4 1.4 5.6 5.6 11-11-1.4-1.4z"/></svg>',
  down: '<svg viewBox="0 0 24 24"><path d="M12 15.5 5.5 9l1.4-1.4 5.1 5.1 5.1-5.1L18.5 9z"/></svg>',
  left: '<svg viewBox="0 0 24 24"><path d="M15 5l-7 7 7 7"/></svg>',
  right: '<svg viewBox="0 0 24 24"><path d="M9 5l7 7-7 7"/></svg>',
};
let CONFIG = { mode: 'demo' };
let SITE = { sections: {}, rows: {}, announcement: { on: false } };
const sectionOn = (k) => SITE.sections?.[k] !== false;
let AUTH = null;
const region = () => Settings.get().region || (navigator.language || 'en-US').split('-')[1] || 'US';

// ---- storage (watchlist + continue watching) ----------------------------------
const LS = {
  get(k, d) { try { return JSON.parse(localStorage.getItem('gf.' + k)) ?? d; } catch { return d; } },
  set(k, v) { try { localStorage.setItem('gf.' + k, JSON.stringify(v)); } catch {} },
};
const keyOf = (c) => `${c.media_type}:${c.id}`;
const slim = (c) => ({ id: c.id, media_type: c.media_type, title: c.title, year: c.year, poster: c.poster, backdrop: c.backdrop_sm || c.backdrop, rating: c.rating, playable: c.playable, ...(c.demo ? { demo: true } : {}) });
const List = {
  all: () => LS.get('list', []),
  has: (c) => List.all().some((x) => keyOf(x) === keyOf(c)),
  toggle(c) {
    let l = List.all(); const on = List.has(c);
    l = on ? l.filter((x) => keyOf(x) !== keyOf(c)) : [slim(c), ...l];
    LS.set('list', l.slice(0, 300)); toast(on ? `Removed from My List` : `Added “${c.title}” to My List`); AUTH?.onToggle(c, !on); return !on;
  },
  replace(arr) { LS.set('list', arr.slice(0, 300)); },
};
const Continue = {
  all: () => LS.get('continue', []),
  get: (c) => Continue.all().find((x) => keyOf(x) === keyOf(c)),
  put(c, extra = {}) {
    const l = Continue.all().filter((x) => keyOf(x) !== keyOf(c));
    const entry = { ...Continue.get(c), ...slim(c), ...extra, at: Date.now() };
    l.unshift(entry); LS.set('continue', l.slice(0, 200)); AUTH?.onHistory(entry);
  },
  remove(c) { LS.set('continue', Continue.all().filter((x) => keyOf(x) !== keyOf(c))); AUTH?.onHistoryRemove(c); },
  clear() { LS.set('continue', []); AUTH?.onHistoryClear(); },
  replace(arr) { LS.set('continue', arr.slice(0, 200)); },
};

// ---- helpers --------------------------------------------------------------------
async function api(path) {
  const r = await fetch(path, { headers: { accept: 'application/json' } });
  const d = await r.json().catch(() => ({}));
  if (!r.ok) throw Object.assign(new Error(d.error || `Request failed (${r.status})`), { status: r.status });
  return d;
}
let toastT;
function toast(msg) { const t = $('#toast'); t.textContent = msg; t.classList.add('on'); clearTimeout(toastT); toastT = setTimeout(() => t.classList.remove('on'), 2400); }
const href = (c) => `/title/${c.media_type}/${c.id}`;
const watchHref = (c, s, e) => `/watch/${c.media_type}/${c.id}${s != null ? `?s=${s}&e=${e}` : ''}`;
const fmtRuntime = (m) => (m ? (m >= 60 ? `${Math.floor(m / 60)}h ${m % 60 ? (m % 60) + 'm' : ''}`.trim() : `${m}m`) : '');
const initials = (n) => esc(String(n).split(/\s+/).map((w) => w[0]).slice(0, 2).join(''));
let GENRES = { movie: [], tv: [] };
const genreName = (id) => [...GENRES.movie, ...GENRES.tv].find((g) => g.id === id)?.name;

function cardHTML(c, opts = {}) {
  const inList = List.has(c);
  // Demo titles use archive frame-grabs, so they get a designed "poster art" treatment (duotone + typeset title).
  const land = document.documentElement.dataset.cards === 'landscape' && !opts.rank;
  const art = c.demo || !(land ? c.backdrop : c.poster);
  const hue = (c.id * 47) % 360;
  const pic = art ? `${c.poster ? `<img src="${esc(c.poster)}" alt="" loading="lazy" decoding="async">` : ''}<div class="art-t"><small>${c.year || ''}${c.media_type === 'tv' ? ' · Series' : ''}</small><b>${esc(c.title)}</b></div>`
    : `<img src="${esc(land ? c.backdrop : c.poster)}" alt="" loading="lazy" decoding="async">`;
  const prog = opts.progress != null ? `<div class="prog"><i style="width:${Math.max(4, Math.min(100, opts.progress))}%"></i></div>` : '';
  const g = (c.genre_ids || []).slice(0, 2).map(genreName).filter(Boolean).join(' · ');
  const inner = `<div class="pic${art ? ' art' : ''}"${art ? ` style="--h:${hue}"` : ''}>${pic}${opts.s != null ? `<span class="ep-badge">S${esc(opts.s)} E${esc(opts.e)}</span>` : ''}${prog}
    <div class="info"><b>${esc(c.title)}</b><span>${c.rating ? `<i class="rt">${c.rating}</i>` : ''}${c.year ? `<i>${c.year}</i>` : ''}${c.media_type === 'tv' ? '<i>Series</i>' : ''}</span>
    ${g ? `<span style="margin-top:3px">${esc(g)}</span>` : ''}
    <div class="acts"><a class="p" href="${watchHref(c, opts.s, opts.e)}" data-link aria-label="Play ${esc(c.title)}">${ICON.play}</a>
    <button data-list="${keyOf(c)}" aria-label="${inList ? 'Remove from' : 'Add to'} My List">${inList ? ICON.check : ICON.plus}</button>
    <a href="${href(c)}" data-link aria-label="More info" style="margin-left:auto">${ICON.down}</a></div></div></div>`;
  // Card = div with a full-size link layer (no nested <a> elements).
  const hit = `<a class="hit" href="${href(c)}" data-link aria-label="${esc(c.title)}${c.year ? ' (' + c.year + ')' : ''}"></a>`;
  if (opts.rank) return `<div class="card top" data-key="${keyOf(c)}"><span class="num" aria-hidden="true">${opts.rank}</span>${inner}${hit}</div>`;
  return `<div class="card" data-key="${keyOf(c)}">${inner}${hit}</div>`;
}
const CARDS = new Map(); // key -> card data, for list toggles
const remember = (arr) => arr.forEach((c) => CARDS.set(keyOf(c), c));

function rowHTML(r, i) {
  if (!r.items?.length) return '';
  remember(r.items);
  const items = r.items.map((c, n) => cardHTML(c, r.top10 ? { rank: n + 1 } : r.cont ? { progress: c.progress, s: c.s, e: c.e } : {})).join('');
  return `<section class="row" aria-labelledby="rh${i}"><div class="row-h"><h2 id="rh${i}">${esc(r.title)}</h2>${r.link ? `<a href="${r.link}" data-link>Explore all ›</a>` : ''}</div>
    <div class="track-wrap"><button class="arrow l" aria-label="Scroll left" disabled>${ICON.left}</button><div class="track">${items}</div><button class="arrow r" aria-label="Scroll right">${ICON.right}</button></div></section>`;
}
function wireRows(root = main) {
  $$('.track-wrap', root).forEach((w) => {
    const t = $('.track', w), l = $('.arrow.l', w), r = $('.arrow.r', w);
    const upd = () => { l.disabled = t.scrollLeft < 10; r.disabled = t.scrollLeft + t.clientWidth >= t.scrollWidth - 10; };
    l.onclick = () => t.scrollBy({ left: -t.clientWidth * 0.85, behavior: 'smooth' });
    r.onclick = () => t.scrollBy({ left: t.clientWidth * 0.85, behavior: 'smooth' });
    t.addEventListener('scroll', upd, { passive: true }); requestAnimationFrame(upd);
  });
}
function skeleton() {
  main.innerHTML = `<div class="hero skel" style="min-height:70vh"></div><div class="rows">${[0, 1].map(() => `<div class="row"><div class="row-h"><h2 class="skel" style="width:180px;height:20px;border-radius:6px"></h2></div><div class="track">${'<div class="card"><div class="pic skel"></div></div>'.repeat(8)}</div></div>`).join('')}</div>`;
}
function errorView(e) {
  main.innerHTML = `<div class="page"><div class="empty"><img src="/img/logo.svg" alt=""><h2>${e.status === 404 ? 'Nothing haunts this page' : 'Something went bump'}</h2><p>${esc(e.message)}</p><p style="margin-top:18px"><a class="btn ghost sm" href="/" data-link>Back home</a></p></div></div>`;
}

function ringHTML(r) {
  const pct = Math.max(0, Math.min(10, r)) / 10, C = 2 * Math.PI * 19;
  const col = r >= 7 ? '#3ddc84' : r >= 5 ? '#f5c518' : '#ff5a7a';
  return `<span class="ring" title="TMDB user score ${r}/10"><svg viewBox="0 0 46 46"><circle class="bgc" cx="23" cy="23" r="19"/><circle cx="23" cy="23" r="19" stroke="${col}" stroke-linecap="round" stroke-dasharray="${(C * pct).toFixed(1)} ${C.toFixed(1)}"/></svg><b>${r.toFixed(1)}</b></span>`;
}
// ---- hero -----------------------------------------------------------------------
let heroTimer;
function heroHTML(c, { detail = false, items = [] } = {}) {
  const lowres = !c.backdrop || c.backdrop === c.poster;
  const g = (c.genres || (c.genre_ids || []).map((id) => ({ id, name: genreName(id) }))).filter((x) => x.name).slice(0, 2);
  const cont = Continue.get(c);
    const playLabel = c.playable ? (cont ? 'Resume' : 'Play') : 'Play';
  return `<section class="hero ${detail ? 'detail-hero' : ''} ${lowres ? 'lowres' : ''}" data-key="${keyOf(c)}">
    <div class="hero-bg"><img src="${esc(c.backdrop || c.poster || '')}" alt="" fetchpriority="high"></div>
    ${c.poster ? `<div class="hero-poster${c.demo ? ' art' : ''}" style="--h:${(c.id * 47) % 360}"><img src="${esc(c.poster)}" alt="">${c.demo ? `<div class="art-t"><small>${c.year || ''}${c.media_type === 'tv' ? ' · SERIES' : ''}</small><b>${esc(c.title)}</b></div>` : ''}</div>` : ''}
    <div class="hero-in">
      <div class="kicker"><img src="/img/logo.svg" alt="">${c.media_type === 'tv' ? 'Series' : 'Film'}${c.playable ? ' · Free on GhostFlix' : ''}</div>
      <h1>${esc(c.title)}</h1>
      ${detail && c.tagline ? `<p class="tagline">${esc(c.tagline)}</p>` : ''}
      <div class="meta">${c.rating ? ringHTML(c.rating) : ''}<span class="gen">${[c.year, g.map((x) => esc(x.name)).join(' / ')].filter(Boolean).join(' <span class="dotsep">·</span> ')}</span>
        ${c.certification ? `<span class="chip cert">${esc(c.certification)}</span>` : ''}${c.runtime && detail ? `<span>${fmtRuntime(c.runtime)}</span>` : ''}${c.number_of_seasons && detail ? `<span>${c.number_of_seasons} season${c.number_of_seasons > 1 ? 's' : ''}</span>` : ''}
        ${c.playable ? '<span class="chip acc">Free to watch</span>' : ''}</div>
      <p class="ov">${esc(c.overview)}</p>
      <div class="btns">
        <a class="btn cta" href="${c.playable && cont?.s != null ? watchHref(c, cont.s, cont.e) : watchHref(c)}" data-link>${ICON.play}${playLabel}</a>
        ${detail ? `<button class="btn icon ${List.has(c) ? 'on' : ''}" data-list="${keyOf(c)}" aria-label="My List">${List.has(c) ? ICON.check : ICON.plus}</button>${CONFIG.parties ? `<a class="btn dark" href="/party/${Math.random().toString(36).slice(2, 8)}?t=${keyOf(c)}" data-link>👻 Watch together</a>` : ''}`
          : `<a class="btn dark" href="${href(c)}" data-link>${ICON.info}Details</a>`}
      </div>
    </div>
    ${items.length > 1 ? `<div class="hero-dots">${items.map((x, i) => `<button aria-label="Show ${esc(x.title)}" data-hero="${i}" class="${x === c ? 'on' : ''}"></button>`).join('')}</div>` : ''}
  </section>`;
}
function mountHero(items) {
  remember(items);
  let i = 0;
  const show = (n) => {
    i = (n + items.length) % items.length;
    const old = $('.hero', main); const tmp = document.createElement('div'); tmp.innerHTML = heroHTML(items[i], { items });
    old.replaceWith(tmp.firstElementChild);
    $$('[data-hero]', main).forEach((b) => (b.onclick = () => { show(+b.dataset.hero); restart(); }));
  };
  const restart = () => { clearInterval(heroTimer); if (items.length > 1 && Settings.get().autoplayHero) heroTimer = setInterval(() => document.visibilityState === 'visible' && window.scrollY < 300 && show(i + 1), 9000); };
  main.insertAdjacentHTML('afterbegin', heroHTML(items[0], { items }));
  $$('[data-hero]', main).forEach((b) => (b.onclick = () => { show(+b.dataset.hero); restart(); }));
  restart();
}

// ---- views ----------------------------------------------------------------------
async function viewHome() {
  skeleton();
  const d = await api('/api/home');
  main.innerHTML = '';
  const cont = Continue.all().map((c) => ({ ...c }));
  const rows = [...d.rows];
  if (cont.length) rows.unshift({ id: 'continue', title: 'Continue watching', items: cont, cont: true });
  const list = List.all(); if (list.length) rows.splice(cont.length ? 2 : 1, 0, { id: 'mylist', title: 'My List', link: '/my-list', items: list });
  const shown = rows.filter((r) => SITE.rows?.[r.id] !== false);
  main.innerHTML = `<div class="rows">${shown.map(rowHTML).join('')}</div>`;
  mountHero(d.hero.length ? d.hero : shown[0]?.items.slice(0, 5) || []);
  wireRows();
}
async function viewBrowse(type, category, title) {
  const cats = type === 'tv' ? [['trending', 'Trending'], ['popular', 'Popular'], ['top_rated', 'Top rated'], ['on_the_air', 'On the air'], ['airing_today', 'Airing today']]
    : type === 'movie' ? [['trending', 'Trending'], ['popular', 'Popular'], ['top_rated', 'Top rated'], ['now_playing', 'Now playing'], ['upcoming', 'Upcoming']] : [];
  const gl = type === 'movie' || type === 'tv' ? GENRES[type] : [];
  const visibleCats = CONFIG.mode === 'demo' ? cats.slice(0, 3) : cats;
  await gridView({
    title: title || (type === 'free' ? 'Free to watch' : type === 'tv' ? 'Series' : type === 'movie' ? 'Movies' : 'Trending'),
    lead: type === 'free' ? 'Full titles from legit sources — public domain, official channels, and GhostFlix’s own hosting.' : '',
    pills: [...visibleCats.map(([k, n]) => ({ href: `/browse/${type}/${k}`, name: n, on: k === category })), ...gl.map((g) => ({ href: `/genre/${type}/${g.id}`, name: g.name }))],
    url: (p) => `/api/list/${type}/${category}?page=${p}`, infinite: type === 'movie' || type === 'tv',
  });
}
async function viewGenre(type, id) {
  const g = GENRES[type]?.find((x) => x.id === +id);
  await gridView({ title: `${g?.name || 'Genre'} ${type === 'tv' ? 'series' : 'movies'}`, pills: [{ href: `/browse/${type}/popular`, name: 'All' }, ...(GENRES[type] || []).map((x) => ({ href: `/genre/${type}/${x.id}`, name: x.name, on: x.id === +id }))],
    url: (p) => `/api/discover/${type}/${id}?page=${p}`, infinite: true });
}
let gridObserver;
async function gridView({ title, lead = '', pills = [], url, empty, infinite = false }) {
  gridObserver?.disconnect(); gridObserver = null;
  main.innerHTML = `<div class="page"><h1>${esc(title)}</h1>${lead ? `<p class="lead">${esc(lead)}</p>` : ''}
    ${pills.length ? `<div class="pills">${pills.map((p) => `<a class="pill ${p.on ? 'on' : ''}" href="${p.href}" data-link>${esc(p.name)}</a>`).join('')}</div>` : ''}
    <div class="grid">${'<div class="card"><div class="pic skel"></div></div>'.repeat(12)}</div><div class="more"></div></div>`;
  const grid = $('.grid', main), more = $('.more', main);
  let page = 1;
  const load = async () => {
    const d = await api(url(page)); remember(d.results);
    if (page === 1) grid.innerHTML = '';
    grid.insertAdjacentHTML('beforeend', d.results.map((c) => cardHTML(c)).join(''));
    if (page === 1 && !d.results.length) grid.outerHTML = empty || `<div class="empty"><img src="/img/logo.svg" alt=""><h2>Nothing here yet</h2><p>Try another category or search.</p></div>`;
    if (infinite) { more.innerHTML = ''; return page < d.total_pages; }
    more.innerHTML = page < d.total_pages ? '<button class="btn ghost sm">Load more</button>' : '';
    const b = $('button', more); if (b) b.onclick = async () => { b.disabled = true; b.textContent = 'Loading…'; page++; await load(); };
  };
  if (!infinite) return load();
  let busy = false;
  const obs = new IntersectionObserver(async (es) => {
    if (busy || !es.some((e) => e.isIntersecting)) return;
    if (!more.isConnected) return obs.disconnect();
    busy = true; more.innerHTML = '<button class="btn ghost sm" disabled>Loading…</button>'; page++;
    let hasMore = true;
    try { hasMore = await load(); } catch { page--; more.innerHTML = ''; }
    busy = false;
    if (!hasMore || !more.isConnected || gridObserver !== obs) return obs.disconnect();
    obs.unobserve(more); obs.observe(more); // re-check in case the sentinel is still in view
  }, { rootMargin: '0px 0px 700px 0px' });
  if (await load() && more.isConnected) { gridObserver = obs; obs.observe(more); }
}
async function viewSearch(q) {
  $('#q').value = q || '';
  if (!q) {
    main.innerHTML = `<div class="page"><h1>Search</h1><p class="lead">Find movies, series and people.</p>
    <form class="search" style="width:100%;max-width:560px;height:50px;margin:0 0 24px" id="pageSearch"><svg viewBox="0 0 24 24"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/></svg><input name="q" type="search" placeholder="Search GhostFlix" autofocus></form>
    <div class="pills">${GENRES.movie.slice(0, 14).map((g) => `<a class="pill" href="/genre/movie/${g.id}" data-link>${esc(g.name)}</a>`).join('')}</div></div>`;
    $('#pageSearch').onsubmit = (e) => { e.preventDefault(); const v = e.target.q.value.trim(); if (v) go(`/search?q=${encodeURIComponent(v)}`); };
    return;
  }
  await gridView({ title: `Results for “${q}”`, url: (p) => `/api/search?q=${encodeURIComponent(q)}&page=${p}`,
    empty: `<div class="empty"><img src="/img/logo.svg" alt=""><h2>No matches for “${esc(q)}”</h2><p>Check the spelling or try a different title.</p></div>` });
}
function viewMyList() {
  const list = List.all(), cont = Continue.all();
  remember([...list, ...cont]);
  main.innerHTML = `<div class="page"><h1>My List</h1><p class="lead">Saved on this device.</p>
    ${list.length ? `<div class="grid">${list.map((c) => cardHTML(c)).join('')}</div>` : `<div class="empty"><img src="/img/logo.svg" alt=""><h2>Your list is empty</h2><p>Tap <b>+</b> on any title to save it here.</p></div>`}
    ${cont.length ? `<h1 id="continue" style="margin-top:46px;font-size:24px">Continue watching</h1><p class="lead"><a class="pill" href="/settings/history" data-link>Manage history</a></p><div class="grid">${cont.map((c) => cardHTML(c, { progress: c.progress, s: c.s, e: c.e })).join('')}</div>` : ''}</div>`;
}

function viewGenres() {
  const block = (type, label) => `<h2 style="font-size:20px;margin:26px 0 12px">${label}</h2><div class="pills">${(GENRES[type] || []).map((g) => `<a class="pill" href="/genre/${type}/${g.id}" data-link>${esc(g.name)}</a>`).join('') || '<span style="color:var(--dim)">No genres yet.</span>'}</div>`;
  main.innerHTML = `<div class="page"><h1>Genres</h1><p class="lead">Browse by mood.</p>${block('movie', 'Movies')}${block('tv', 'Series')}</div>`;
}
let previewCache = null;
async function previewCards(el) {
  try { previewCache ||= (await api('/api/list/all/trending')).results.slice(0, 6); } catch { previewCache = []; }
  remember(previewCache); el.innerHTML = `<div class="track" style="padding:6px 0 10px;margin:0">${previewCache.map((c) => cardHTML(c)).join('')}</div>`;
}
const pageCtx = () => ({ main, api, rowHTML, wireRows, history: Continue, list: List, go, auth: AUTH, toast, config: CONFIG });
const settingsCtx = () => ({ auth: AUTH, list: List, history: Continue, toast, watchHref, previewCards, discordUrl: CONFIG.discordUrl, githubUrl: CONFIG.githubUrl });
async function viewTitle(type, id) {
  skeleton();
  const d = await api(`/api/title/${type}/${id}?region=${region()}`);
  remember([d]); CARDS.set(keyOf(d), d);
  document.title = `${d.title} — GhostFlix`;
  const p = d.providers;
  const provGroup = (label, arr) => (arr?.length ? `<div class="grp"><span>${label}</span><div class="logos">${arr.map((x) => `<a href="${esc(p.link)}" target="_blank" rel="noopener" title="${esc(x.name)}"><img src="${esc(x.logo)}" alt="${esc(x.name)}" loading="lazy"></a>`).join('')}</div></div>` : '');
  const provHTML = p && (p.flatrate?.length || p.free?.length || p.ads?.length || p.rent?.length || p.buy?.length)
    ? `<div class="prov"><h3>Where to watch <small>${esc(p.region)}${CONFIG.mode === 'tmdb' ? ' · JustWatch' : ''}</small></h3>${provGroup('Free', p.free)}${provGroup('With ads', p.ads)}${provGroup('Stream', p.flatrate)}${provGroup('Rent', p.rent)}${provGroup('Buy', p.buy)}</div>`
    : `<div class="prov"><h3>Where to watch</h3><p style="color:var(--dim)">No streaming info for your region yet.</p></div>`;
  main.innerHTML = `${heroHTML(d, { detail: true })}
  <div class="dwrap"><div>
    ${d.media_type === 'tv' && d.seasons?.length ? `<section class="sec" id="episodes"><h2>Episodes</h2><div class="season-bar"><div class="select"><select id="seasonSel" aria-label="Season">${d.seasons.map((s) => `<option value="${s.season_number}">${esc(s.name)}${s.episode_count ? ` (${s.episode_count})` : ''}</option>`).join('')}</select></div></div><div class="eps" id="eps"></div></section>` : ''}
    ${d.trailers?.length ? `<section class="sec"><h2>Trailers & videos</h2><div class="trailers">${d.trailers.map((t) => `<div class="trailer" role="button" tabindex="0" data-yt="${esc(t.key)}"><div class="th"><img src="https://i.ytimg.com/vi/${esc(t.key)}/mqdefault.jpg" alt="" loading="lazy"></div><b>${esc(t.name)}</b></div>`).join('')}</div></section>` : ''}
    ${d.cast?.length ? `<section class="sec"><h2>Cast</h2><div class="cast">${d.cast.map((c) => `<div class="person"><div class="ph">${c.profile ? `<img src="${esc(c.profile)}" alt="" loading="lazy">` : initials(c.name)}</div><b>${esc(c.name)}</b><span>${esc(c.character)}</span></div>`).join('')}</div></section>` : ''}
    ${d.recommendations?.length ? `<section class="sec" style="margin-left:calc(-1 * var(--pad));margin-right:calc(-1 * var(--pad))">${rowHTML({ title: 'More like this', items: d.recommendations }, 'rec')}</section>` : ''}
  </div>
  <aside class="facts"><dl>
    ${d.directors?.length ? `<dt>Director</dt><dd>${esc(d.directors.join(', '))}</dd>` : ''}
    ${d.created_by?.length ? `<dt>Created by</dt><dd>${esc(d.created_by.join(', '))}</dd>` : ''}
    ${d.release_date ? `<dt>${type === 'tv' ? 'First aired' : 'Released'}</dt><dd>${esc(d.release_date)}</dd>` : ''}
    ${d.status ? `<dt>Status</dt><dd>${esc(d.status)}</dd>` : ''}
    ${d.languages?.length ? `<dt>Languages</dt><dd>${esc(d.languages.slice(0, 4).join(', '))}</dd>` : ''}
    ${d.license ? `<dt>License</dt><dd>${esc(d.license)}</dd>` : ''}
    ${d.cast?.length ? `<dt>Starring</dt><dd>${esc(d.cast.slice(0, 4).map((c) => c.name).join(', '))}</dd>` : ''}
    ${d.imdb_id ? `<dt>Links</dt><dd><a href="https://www.imdb.com/title/${esc(d.imdb_id)}/" target="_blank" rel="noopener" style="color:var(--acc)">IMDb</a>${d.homepage ? ` · <a href="${esc(d.homepage)}" target="_blank" rel="noopener" style="color:var(--acc)">Official site</a>` : ''}</dd>` : ''}
  </dl>${provHTML}</aside></div>`;
  wireRows();
  $$('[data-yt]', main).forEach((el) => { const open = () => openPlayer({ kind: 'iframe', src: `https://www.youtube-nocookie.com/embed/${el.dataset.yt}?autoplay=1&rel=0&modestbranding=1&playsinline=1`, title: d.title, sub: 'Trailer', trailer: true }); el.onclick = open; el.onkeydown = (e) => e.key === 'Enter' && open(); });
  if ($('#seasonSel')) {
    const sel = $('#seasonSel'); const cont = Continue.get(d);
    if (cont?.s != null && d.seasons.some((s) => s.season_number === +cont.s)) sel.value = cont.s;
    const load = async () => {
      const eps = $('#eps'); eps.innerHTML = '<div class="ep skel" style="height:110px"></div>'.repeat(3);
      try {
        const s = await api(`/api/tv/${id}/season/${sel.value}`);
        eps.innerHTML = s.episodes.map((e) => `<a class="ep" href="${watchHref(d, s.season_number, e.episode_number)}" data-link><div class="n">${e.episode_number}</div>
          <div class="st">${e.still ? `<img src="${esc(e.still)}" alt="" loading="lazy">` : ''}<div class="pl">${ICON.play}</div></div>
          <div><div class="t"><b>${e.episode_number}. ${esc(e.name)}${e.playable ? '<span class="free">Free</span>' : ''}</b><span>${fmtRuntime(e.runtime)}</span></div><p>${esc(e.overview || 'No description yet.')}</p></div></a>`).join('') || '<p class="empty">No episodes listed yet.</p>';
      } catch (e) { eps.innerHTML = `<p class="empty">${esc(e.message)}</p>`; }
    };
    sel.onchange = load; load();
  }
}

// ---- player ---------------------------------------------------------------------
let hlsLib = null;
async function viewWatch(type, id, s, e) {
  const qs = s != null ? `?s=${s}&e=${e}` : '';
  const d = await api(`/api/play/${type}/${id}${qs}`);
  const c = { ...(CARDS.get(`${type}:${id}`) || {}), id: +id, media_type: type, title: d.title, year: d.year, poster: d.poster, backdrop: d.backdrop };
  const sub = s != null ? `S${s} · E${e}` : d.year || '';
  if (d.sources.length) {
    c.playable = true;
    Continue.put(c, { s: s ?? null, e: e ?? null });
    const pref = Settings.get().preferProvider; const srcs = [...d.sources].sort((a, b) => (b.provider === pref) - (a.provider === pref));
    openPlayer({ ...srcs[0], title: d.title, sub, all: srcs, card: c, s, e, subs: d.subtitles || [] });
  } else if (d.trailer) {
    openPlayer({ kind: 'iframe', src: d.trailer.src, title: d.title, sub: d.trailer.name || 'Trailer', trailer: true });
  } else {
    openPlayer({ kind: 'none', title: d.title, sub, card: c, providers: d.providers });
  }
}
function closePlayer() {
  const p = $('.player'); if (!p) return;
  const v = $('video', p); if (v) v.pause();
  p.remove(); document.body.style.overflow = '';
}
function openPlayer(o) {
  closePlayer();
  const el = document.createElement('div'); el.className = 'player'; el.setAttribute('role', 'dialog'); el.setAttribute('aria-label', `Playing ${o.title}`);
  const srcBtns = o.all?.length > 1 ? `<div class="srcs">${o.all.map((x, i) => `<button class="pill ${i === 0 ? 'on' : ''}" data-src="${i}">${esc(x.label || x.providerName)}</button>`).join('')}</div>` : '';
  el.innerHTML = `<div class="player-top"><button class="back" aria-label="Close player"><svg viewBox="0 0 24 24"><path d="M15 5l-7 7 7 7"/></svg></button><div><b>${esc(o.title)}</b> <span>${esc(o.sub || '')}</span></div>${srcBtns}</div><div class="player-stage"></div>${o.trailer ? '<div class="trailer-flag">Trailer · full title not available on GhostFlix</div>' : ''}`;
  document.body.appendChild(el); document.body.style.overflow = 'hidden';
  const stage = $('.player-stage', el);
  const mount = async (x) => {
    stage.innerHTML = '';
    if (x.kind === 'iframe') {
      const f = document.createElement('iframe'); f.src = Settings.get().autoplay ? x.src : x.src.replace(/([?&])autoplay=(1|true)&?/, '$1').replace(/[?&]$/, ''); f.allow = 'autoplay; fullscreen; picture-in-picture; encrypted-media'; f.allowFullscreen = true;
      f.referrerPolicy = 'unsafe-url'; f.title = o.title; const sb = embedSandbox(x.src, x.sandbox); if (sb) f.setAttribute('sandbox', sb); stage.appendChild(f);
      if (sb && sb !== x.sandbox) {
        const b = document.createElement('button'); b.type = 'button'; b.className = 'pop-flag'; b.innerHTML = 'Pop-ups blocked · Not playing? <u>Allow</u>';
        b.title = 'Allow pop-ups for embedded players (can be changed in Settings › Player)';
        b.onclick = () => { Settings.set({ blockPopups: false }); toast('Pop-ups allowed · reloading player'); mount(x); }; stage.appendChild(b);
      }
    } else if (x.kind === 'video' || x.kind === 'hls') {
      const v = document.createElement('video'); v.controls = true; v.autoplay = Settings.get().autoplay; v.playsInline = true; v.poster = o.card?.backdrop || ''; v.crossOrigin = 'anonymous';
      const S = Settings.get().subs;
      (o.subs || []).forEach((t, i) => { const tr = document.createElement('track'); tr.kind = 'subtitles'; tr.src = t.url; tr.srclang = t.lang || 'und'; tr.label = t.label || t.lang || `Track ${i + 1}`; v.appendChild(tr); });
      stage.appendChild(v);
      const pickTrack = () => { const tt = [...v.textTracks].filter((t) => t.kind === 'subtitles' || t.kind === 'captions'); const best = S.enabled ? tt.find((t) => (t.language || '').toLowerCase().startsWith(S.lang)) || null : null; tt.forEach((t) => (t.mode = t === best ? 'showing' : 'disabled')); };
      v.textTracks.addEventListener?.('addtrack', pickTrack); v.addEventListener('loadedmetadata', pickTrack); setTimeout(pickTrack, 0);
      v.addEventListener('keydown', (e) => { if (e.key === 'ArrowRight') v.currentTime += 10; if (e.key === 'ArrowLeft') v.currentTime -= 10; });
      if (x.kind === 'hls' && !v.canPlayType('application/vnd.apple.mpegurl')) {
        if (!hlsLib) { await new Promise((res, rej) => { const s = document.createElement('script'); s.src = '/vendor/hls.min.js'; s.onload = res; s.onerror = rej; document.head.appendChild(s); }); hlsLib = window.Hls; }
        const h = new hlsLib(); h.loadSource(x.src); h.attachMedia(v);
      } else v.src = x.src;
      const prev = o.card && Continue.get(o.card);
      if (Settings.get().rememberPosition && prev?.time && prev.s == o.s && prev.e == o.e) v.addEventListener('loadedmetadata', () => { if (prev.time < v.duration - 30) v.currentTime = prev.time; }, { once: true });
      let last = 0;
      v.addEventListener('timeupdate', () => { if (o.card && Date.now() - last > 4000 && v.duration) { last = Date.now(); Continue.put(o.card, { s: o.s ?? null, e: o.e ?? null, time: v.currentTime, progress: (v.currentTime / v.duration) * 100 }); } });
    } else {
      const p = o.providers; const any = p && (p.flatrate?.length || p.free?.length || p.rent?.length || p.buy?.length);
      stage.innerHTML = `<div class="player-msg"><img src="/img/logo.svg" alt="" width="64" style="margin:0 auto;filter:drop-shadow(0 0 14px var(--acc-glow))"><h2>Not streaming on GhostFlix yet</h2><p>There’s no trailer or stream added for this one yet.${any ? ' Check where it’s streaming instead:' : ''}</p>${any ? `<a class="btn glow sm" href="${esc(p.link)}" target="_blank" rel="noopener">Where to watch</a>` : ''}</div>`;
    }
  };
  mount(o);
  $$('[data-src]', el).forEach((b) => (b.onclick = () => { $$('[data-src]', el).forEach((x) => x.classList.remove('on')); b.classList.add('on'); mount(o.all[+b.dataset.src]); }));
  $('.back', el).onclick = () => (location.pathname.startsWith('/watch/') ? (history.length > 1 ? history.back() : go('/')) : closePlayer());
  el.tabIndex = -1; el.focus();
}
document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && $('.player')) $('.player .back').click(); });

function sectionOff() { main.innerHTML = `<div class="page"><div class="empty"><img src="/img/logo.svg" alt=""><h2>This section is switched off</h2><p>It’s temporarily unavailable. Check back soon.</p><p style="margin-top:16px"><a class="btn ghost sm" href="/" data-link>Back home</a></p></div></div>`; }
function applySite() {
  const map = { discover: 'discover', live: 'live', 'my-list': 'mylist' };
  $$('[data-nav]').forEach((a) => { const k = map[a.dataset.nav]; if (k) a.hidden = !sectionOn(k); });
  const an = SITE.announcement || {}; const box = $('#announce');
  if (an.on && an.text && sessionStorage.getItem('gf.an') !== an.text) {
    box.innerHTML = `<div class="announce" role="status" style="--an:${/^#[0-9a-f]{6}$/i.test(an.color || '') ? an.color : '#5fe3ff'}"><span>${esc(an.text)}</span><button class="x" type="button" aria-label="Dismiss announcement">×</button></div>`;
    $('.x', box).onclick = () => { sessionStorage.setItem('gf.an', an.text); box.innerHTML = ''; document.body.classList.remove('has-announce'); };
    document.body.classList.add('has-announce');
  } else { box.innerHTML = ''; document.body.classList.remove('has-announce'); }
}

// ---- router ---------------------------------------------------------------------
const routes = [
  [/^\/$/, () => viewHome(), 'home'],
  [/^\/movies$/, () => viewBrowse('movie', 'popular', 'Movies'), 'movies'],
  [/^\/tv$/, () => viewBrowse('tv', 'popular', 'Series'), 'tv'],
  [/^\/browse\/(free|all|movie|tv)\/(\w+)$/, (m) => viewBrowse(m[1], m[2]), (m) => (m[1] === 'tv' ? 'tv' : 'movies')],
  [/^\/genre\/(movie|tv)\/(\d+)$/, (m) => viewGenre(m[1], m[2]), (m) => (m[1] === 'tv' ? 'tv' : 'movies')],
  [/^\/search$/, () => viewSearch(new URLSearchParams(location.search).get('q') || ''), 'search'],
  [/^\/my-list$/, () => (sectionOn('mylist') ? (() => viewMyList())() : sectionOff()), 'my-list'],
  [/^\/genres$/, () => viewGenres(), 'genres'],
  [/^\/discover$/, () => (sectionOn('discover') ? (() => viewDiscover(pageCtx()))() : sectionOff()), 'discover'],
  [/^\/live$/, () => (sectionOn('live') ? (() => viewLive(pageCtx()))() : sectionOff()), 'live'],
  // Watch Parties: built but disabled for now (enable with ENABLE_WATCH_PARTIES=1).
  [/^\/party$/, () => (CONFIG.parties ? viewPartyHome(pageCtx()) : (history.replaceState({}, '', '/'), render())), 'party'],
  [/^\/party\/([a-z0-9]{4,12})$/i, (m) => (CONFIG.parties ? viewParty(pageCtx(), m[1].toLowerCase()) : (history.replaceState({}, '', '/'), render())), 'party'],
  [/^\/settings$/, () => renderSettings(main, settingsCtx()), 'settings'],
  [/^\/profile$/, () => renderSettings(main, settingsCtx(), 'profile'), 'settings'],
  [/^\/settings\/(history|appearance|subtitles|player|preferences|account|connections|tv|profiles|profile)$/, (m) => renderSettings(main, settingsCtx(), m[1]), 'settings'],
  [/^\/title\/(movie|tv)\/(\d+)$/, (m) => viewTitle(m[1], m[2]), null],
];
let lastPage = null;
async function render() {
  const path = location.pathname.replace(/\/+$/, '') || '/';
  const w = path.match(/^\/watch\/(movie|tv)\/(\d+)$/);
  if (w) {
    const q = new URLSearchParams(location.search);
    if (!lastPage) { lastPage = `/title/${w[1]}/${w[2]}`; await routeTo(lastPage); }
    try { await viewWatch(w[1], w[2], q.get('s'), q.get('e')); } catch (e) { toast(e.message); }
    return;
  }
  closePlayer();
  if (lastPage === path + location.search && main.innerHTML) return; // returning from player
  lastPage = path + location.search;
  await routeTo(path);
}
async function routeTo(path) {
  clearInterval(heroTimer); if (!path.startsWith('/party/')) leaveParty();
  document.title = 'GhostFlix — movies & series';
  for (const [re, fn, nav] of routes) {
    const m = path.match(re);
    if (m) {
      const n = typeof nav === 'function' ? nav(m) : nav;
      $$('[data-nav]').forEach((a) => a.classList.toggle('on', a.dataset.nav === n));
      window.scrollTo({ top: 0, behavior: 'instant' });
      try { await fn(m); } catch (e) { errorView(e); }
      return;
    }
  }
  errorView(Object.assign(new Error('That page drifted into the ether.'), { status: 404 }));
}
function go(url) { history.pushState({}, '', url); render(); }

document.addEventListener('click', (e) => {
  const lb = e.target.closest('[data-list]');
  if (lb) {
    e.preventDefault(); e.stopPropagation();
    const c = CARDS.get(lb.dataset.list); if (!c) return;
    const on = List.toggle(c);
    $$(`[data-list="${lb.dataset.list}"]`).forEach((b) => { b.innerHTML = on ? ICON.check : ICON.plus; b.classList.toggle('on', on); });
    return;
  }
  const a = e.target.closest('a[data-link]');
  if (a && !e.metaKey && !e.ctrlKey && !e.shiftKey && a.origin === location.origin) { e.preventDefault(); go(a.pathname + a.search); }
});
window.addEventListener('popstate', render);
document.addEventListener('error', (e) => { if (e.target.tagName === 'IMG' && e.target.closest('.pic,.hero-poster,.st,.ph')) e.target.style.visibility = 'hidden'; }, true);
document.addEventListener('load', (e) => { if (e.target.matches?.('.hero-bg img')) e.target.classList.add('in'); }, true);
new MutationObserver(() => $$('.hero-bg img:not(.in)').forEach((i) => i.complete && i.naturalWidth && i.classList.add('in'))).observe(main, { childList: true, subtree: true });
$('#searchForm').addEventListener('submit', (e) => { e.preventDefault(); const v = $('#q').value.trim(); if (v) go(`/search?q=${encodeURIComponent(v)}`); });
let st; $('#q').addEventListener('input', (e) => { clearTimeout(st); const v = e.target.value.trim(); st = setTimeout(() => v.length > 1 && (location.pathname === '/search' ? history.replaceState({}, '', `/search?q=${encodeURIComponent(v)}`) || render() : go(`/search?q=${encodeURIComponent(v)}`)), 450); });
const nav = $('#nav'); const onScroll = () => nav.classList.toggle('solid', window.scrollY > 30); window.addEventListener('scroll', onScroll, { passive: true }); onScroll();
$('#yr').textContent = new Date().getFullYear();
$('#themeTgl').onclick = () => { const light = Settings.get().theme === 'light'; Settings.set({ theme: light ? 'dark' : 'light' }); if (location.pathname === '/settings/appearance') { lastPage = null; render(); } };

// ---- drawer menu ----
const drawerEl = $('#drawer'), scrim = $('#scrim'), burger = $('#burger');
function setDrawer(open) {
  drawerEl.classList.toggle('open', open); drawerEl.setAttribute('aria-hidden', String(!open)); scrim.hidden = !open; burger.setAttribute('aria-expanded', String(open));
  if (open) { $('#drawerX').focus(); fetch('/api/admin/me').then((r) => r.json()).then((d) => ($('#drawerAdmin').hidden = !d.admin)).catch(() => {}); }
}
burger.onclick = () => setDrawer(true); $('#drawerX').onclick = () => setDrawer(false); scrim.onclick = () => setDrawer(false);
drawerEl.addEventListener('click', (e) => { if (e.target.closest('a,[data-signin],[data-signout]')) setDrawer(false); });
document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && drawerEl.classList.contains('open')) setDrawer(false); });

// ---- installable app (PWA) ----
if ('serviceWorker' in navigator) window.addEventListener('load', () => navigator.serviceWorker.register('/sw.js?v=20261022b').catch(() => {}));
const installEl = $('#drawerInstall');
const standalone = () => matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
const isIOS = /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
let installPrompt = null;
if (!standalone() && isIOS) installEl.hidden = false;
window.addEventListener('beforeinstallprompt', (e) => { e.preventDefault(); installPrompt = e; if (!standalone()) installEl.hidden = false; });
window.addEventListener('appinstalled', () => { installPrompt = null; installEl.hidden = true; toast('GhostFlix installed'); });
installEl.addEventListener('click', async (e) => {
  e.preventDefault();
  if (installPrompt) { installPrompt.prompt(); const { outcome } = await installPrompt.userChoice.catch(() => ({})); if (outcome === 'accepted') installEl.hidden = true; installPrompt = null; return; }
  const m = document.createElement('div'); m.className = 'authm open'; m.setAttribute('role', 'dialog'); m.setAttribute('aria-modal', 'true'); m.setAttribute('aria-label', 'Install GhostFlix');
  m.innerHTML = `<div class="bx"><button class="x" type="button" aria-label="Close">×</button><img class="gh" src="/icons/icon-192.png" alt="" style="border-radius:16px"><h2>Install GhostFlix</h2>
    <p>${isIOS ? 'In Safari, tap the <b>Share</b> button <span aria-hidden="true">(□↑)</span>, then choose <b>Add to Home Screen</b>.' : 'Open your browser menu and choose <b>Install app</b> or <b>Add to Home screen</b>.'}</p><button class="pb pd" type="button" data-ok>Got it</button></div>`;
  m.addEventListener('click', (ev) => { if (ev.target === m || ev.target.closest('.x,[data-ok]')) m.remove(); });
  document.body.appendChild(m);
});

(async () => {
  try { SITE = await api('/api/site-config'); } catch {} applySite();
  try { CONFIG = await api('/api/config'); GENRES = await api('/api/genres'); } catch {} document.querySelectorAll('[data-feature=parties]').forEach((el) => (el.hidden = !CONFIG.parties));
  AUTH = createAuth({ config: CONFIG, list: List, history: Continue, toast, onChange: () => { if (/^\/(my-list|settings.*)?$/.test(location.pathname)) { lastPage = null; render(); } } });
  AUTH.subscribe(() => { if (location.pathname.startsWith('/settings')) { lastPage = null; render(); } });
  if (CONFIG.discordUrl) {
    const b = $('#dcBubble'); b.href = CONFIG.discordUrl; b.innerHTML = ICONS.DISCORD_SVG; b.hidden = false; $('#drawerDiscord').href = CONFIG.discordUrl;
  } else $('#drawerDiscord').hidden = true;
  if (CONFIG.githubUrl) { const g = $('#ghBubble'); g.href = CONFIG.githubUrl; g.hidden = false; }
  if (CONFIG.mode === 'demo' && !sessionStorage.getItem('gf.nb')) {
    $('#banner').innerHTML = `<div class="notice"><span>👻</span><span><b>Demo catalog.</b> Showing public-domain classics from the Internet Archive. Add <code>TMDB_API_KEY</code> to unlock the full movie & series catalog.</span><button class="x" aria-label="Dismiss">×</button></div>`;
    $('#banner .x').onclick = () => { sessionStorage.setItem('gf.nb', 1); $('#banner').innerHTML = ''; };
  }
  render();
})();

// Admin link in the menu: only visible when this browser is logged in as admin.
fetch('/api/admin/me', { credentials: 'same-origin', cache: 'no-store' }).then((r) => r.json()).then((d) => { const a = document.getElementById('adminLink'); if (a && d.admin) a.hidden = false; }).catch(() => {});
