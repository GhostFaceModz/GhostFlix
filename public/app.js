// GhostFlix front-end — tiny dependency-free SPA.
import { createAuth, ICONS } from './auth.js?v=20261023zr';
import { applyCosmetics } from './cosmetics.js?v=20261023zr';
import { Settings, applySettings, renderSettings, embedSandbox } from './settings.js?v=20261023zr';
import { createPush } from './push.js?v=20261023zr';
import { viewDiscover, viewLive, viewPartyHome, viewParty, leaveParty } from './pages.js?v=20261023zr';
import { Profiles, lsKey, createProfiles } from './profiles.js?v=20261023zr';
import { createCommunity } from './community.js?v=20261023zr';
import { createFlair } from './flair.js?v=20261023zr';
import { createPromote } from './promote.js?v=20261023zr';
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
// list/continue/eps/remind/ratings are per viewer profile (see profiles.js); everything else is per device.
let PROF = null, PUSH = null, COMM = null, FLAIR = null;
const PROMO = createPromote({ call: (p, o) => COMM.call(p, o), auth: () => AUTH, toast: (m) => toast(m), main });
const LS = {
  get(k, d) { try { return JSON.parse(localStorage.getItem(lsKey(k))) ?? d; } catch { return d; } },
  set(k, v) { try { localStorage.setItem(lsKey(k), JSON.stringify(v)); } catch {} PROF?.touched(k); if (k === 'list' || k === 'continue' || k === 'remind') PUSH?.sync(); },
};
// Account sync (auth.js) only ever reads/writes the first ('main') profile's list + history, whichever profile is active.
const mainLS = (k, max) => ({ all: () => { try { return JSON.parse(localStorage.getItem('gf.' + k)) || []; } catch { return []; } }, replace(arr) { try { localStorage.setItem('gf.' + k, JSON.stringify(arr.slice(0, max))); } catch {} } });
const MainList = mainLS('list', 300), MainHistory = mainLS('continue', 200);
const AUTHM = () => (Profiles.active().id === 'main' ? AUTH : null);
const keyOf = (c) => `${c.media_type}:${c.id}`;
const slim = (c) => ({ id: c.id, media_type: c.media_type, title: c.title, year: c.year, poster: c.poster, backdrop: c.backdrop_sm || c.backdrop, rating: c.rating, playable: c.playable, ...(c.demo ? { demo: true } : {}) });
const List = {
  all: () => LS.get('list', []),
  has: (c) => List.all().some((x) => keyOf(x) === keyOf(c)),
  toggle(c) {
    let l = List.all(); const on = List.has(c);
    l = on ? l.filter((x) => keyOf(x) !== keyOf(c)) : [slim(c), ...l];
    LS.set('list', l.slice(0, 300)); toast(on ? `Removed from My List` : `Added “${c.title}” to My List`); AUTHM()?.onToggle(c, !on); return !on;
  },
  replace(arr) { LS.set('list', arr.slice(0, 300)); },
};
const Continue = {
  all: () => LS.get('continue', []),
  get: (c) => Continue.all().find((x) => keyOf(x) === keyOf(c)),
  put(c, extra = {}) {
    const l = Continue.all().filter((x) => keyOf(x) !== keyOf(c));
    let prev = Continue.get(c) || {};
    // A different episode starts fresh: don't carry the old episode's position/progress over.
    if ('s' in extra && (prev.s ?? null) != (extra.s ?? null) || 'e' in extra && (prev.e ?? null) != (extra.e ?? null)) { const { time, progress, dur, done, next, approx, ...rest } = prev; prev = rest; }
    const entry = { ...prev, ...slim(c), ...extra, at: Date.now() };
    l.unshift(entry); LS.set('continue', l.slice(0, 200)); AUTHM()?.onHistory(entry); EpLog.note(entry);
  },
  remove(c) { LS.set('continue', Continue.all().filter((x) => keyOf(x) !== keyOf(c))); AUTHM()?.onHistoryRemove(c); },
  clear() { LS.set('continue', []); AUTHM()?.onHistoryClear(); },
  replace(arr) { LS.set('continue', arr.slice(0, 200)); },
};

// Per-episode progress for ticks/bars on episode lists: gf.eps {tv:id: {"s:e": [pct, done, at]}}.
const EpLog = {
  all: () => LS.get('eps', {}),
  of: (c) => EpLog.all()[keyOf(c)] || {},
  note(x) {
    if (x.media_type !== 'tv' || x.s == null || x.e == null || !(x.progress > 0 || x.done)) return;
    const a = EpLog.all(), k = keyOf(x), m = (a[k] ||= {}), id = `${x.s}:${x.e}`, old = m[id];
    m[id] = [Math.round(Math.max(x.progress || 0, x.done ? 100 : 0)), x.done || old?.[1] ? 1 : 0, Date.now()];
    const ks = Object.keys(a); if (ks.length > 300) delete a[ks[0]];
    LS.set('eps', a);
  },
};
// "Remind me" for titles that aren't out yet: gf.remind [{...card, date, label, told}].
const todayISO = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
const fmtDate = (iso) => { try { return new Date(iso + 'T12:00:00').toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: iso.slice(0, 4) === todayISO().slice(0, 4) ? undefined : 'numeric' }); } catch { return iso; } };
const Remind = {
  all: () => LS.get('remind', []),
  has: (c) => Remind.all().some((x) => keyOf(x) === keyOf(c)),
  toggle(c, date, label = '') {
    const on = Remind.has(c); let l = Remind.all().filter((x) => keyOf(x) !== keyOf(c));
    if (!on) l = [{ ...slim(c), date, label, at: Date.now() }, ...l].slice(0, 200);
    LS.set('remind', l); toast(on ? 'Reminder removed' : `We’ll remind you when “${c.title}” is out (${fmtDate(date)})`);
    window.dispatchEvent(new CustomEvent('gf:remind', { detail: { card: slim(c), date, on: !on } })); return !on;
  },
  /** Reminders whose date has arrived and haven't been shown yet. */
  due() { const t = todayISO(), l = Remind.all(), due = l.filter((x) => x.date && x.date <= t && !x.told); if (due.length) LS.set('remind', l.map((x) => (due.includes(x) ? { ...x, told: 1 } : x))); return due; },
};
const remindBtn = (c, date, label = '', cls = 'btn dark') => `<button class="${cls} remind${Remind.has(c) ? ' on' : ''}" type="button" data-remind="${keyOf(c)}" data-date="${esc(date)}" data-label="${esc(label)}" aria-pressed="${Remind.has(c)}">${Remind.has(c) ? '🔔 Reminder set' : '🔔 Remind me'}</button>`;
// Thumbs down / up / Love: gf.ratings {"movie:1": {v: -1|1|2, at, ...card, genre_ids}} (per profile).
const Ratings = {
  all: () => LS.get('ratings', {}),
  of: (c) => Ratings.all()[keyOf(c)]?.v || 0,
  set(c, v) {
    const a = Ratings.all(), k = keyOf(c), cur = a[k]?.v || 0;
    if (cur === v) delete a[k]; else a[k] = { ...slim(c), genre_ids: c.genre_ids || (c.genres || []).map((g) => g.id), v, at: Date.now() };
    const ks = Object.keys(a); if (ks.length > 1000) delete a[ks.sort((x, y) => a[x].at - a[y].at)[0]];
    LS.set('ratings', a); return cur === v ? 0 : v;
  },
};
const RATE = [[-1, '👎', 'Not for me'], [1, '👍', 'I like this'], [2, '❤️', 'Love this!']];
const rateHTML = (c) => { const v = Ratings.of(c); return `<span class="rate" role="group" aria-label="Rate this title">${RATE.map(([n, e, l]) => `<button class="btn icon rt${v === n ? ' on' : ''}" type="button" data-rate="${keyOf(c)}" data-v="${n}" aria-pressed="${v === n}" aria-label="${l}" title="${l}"><span aria-hidden="true">${e}</span></button>`).join('')}</span>`; };
/** "Because you …" rows: seeds are the newest Loved, then Liked titles, then recent watches you didn't thumbs-down.
 *  Recommendations from the seeds are merged, ranked by how many seeds suggest them and how well their genres match
 *  what you liked vs. disliked; thumbs-down titles (and finished ones) are left out. */
async function because(n = 1) {
  const r = Ratings.all(), vals = Object.values(r), hist = Continue.all();
  const down = new Set(vals.filter((x) => x.v < 0).map(keyOf)), done = new Set(hist.filter((x) => x.done && x.media_type === 'movie').map(keyOf));
  const seeds = [];
  const add = (x, why) => { if (x && !down.has(keyOf(x)) && !seeds.some((s) => keyOf(s.c) === keyOf(x))) seeds.push({ c: x, why }); };
  vals.filter((x) => x.v === 2).sort((a, b) => b.at - a.at).forEach((x) => add(x, 'loved'));
  vals.filter((x) => x.v === 1).sort((a, b) => b.at - a.at).forEach((x) => add(x, 'liked'));
  hist.forEach((x) => add(x, 'watched'));
  if (!seeds.length) return [];
  const g = {}; for (const x of vals) for (const id of x.genre_ids || []) g[id] = (g[id] || 0) + (x.v < 0 ? -1.5 : x.v);
  const pool = seeds.slice(0, n + 2);
  const recs = await Promise.all(pool.map((s) => api(`/api/title/${s.c.media_type}/${s.c.id}?region=${region()}`).then((t) => ({ s, t })).catch(() => null)));
  const freq = new Map();
  for (const x of recs) for (const c of x?.t.recommendations || []) freq.set(keyOf(c), (freq.get(keyOf(c)) || 0) + 1);
  const seen = new Set(pool.map((s) => keyOf(s.c)));
  const score = (c) => (freq.get(keyOf(c)) || 0) * 2 + (c.genre_ids || []).reduce((a, id) => a + (g[id] || 0), 0) * 0.3 + (c.rating || 0) * 0.05;
  const out = [];
  for (const x of recs) {
    if (!x || out.length >= n) continue;
    const items = (x.t.recommendations || []).filter((c) => !down.has(keyOf(c)) && !done.has(keyOf(c)) && !seen.has(keyOf(c)));
    if (items.length < 4) continue;
    items.sort((a, b) => score(b) - score(a)); items.forEach((c) => seen.add(keyOf(c)));
    out.push({ seed: x.s.c, title: `Because you ${x.s.why} ${x.t.title}`, items: items.slice(0, 20) });
  }
  return out;
}
/** Release date in the future for a title (movie release, or a series' next episode/premiere), else null. */
function upcoming(c) {
  const t = todayISO();
  if (c.media_type === 'movie' && c.release_date > t) return { date: c.release_date, label: 'Out' };
  if (c.media_type === 'tv' && c.next_episode?.air_date > t) return { date: c.next_episode.air_date, label: c.next_episode.e === 1 ? `Season ${c.next_episode.s}` : `S${c.next_episode.s} E${c.next_episode.e}` };
  if (c.media_type === 'tv' && c.release_date > t) return { date: c.release_date, label: 'Premieres' };
  return null;
}

// ---- resume -----------------------------------------------------------------------
// Each title keeps one history entry: last season/episode, seconds in (time), duration (dur),
// percent (progress), done (>= 90%), next episode and whether the time is an estimate (approx).
const DONE_PCT = 90;
const fmtPos = (sec) => { const m = Math.round(sec / 60); return m >= 60 ? `${Math.floor(m / 60)}h ${m % 60 ? (m % 60) + 'm' : ''}`.trim() : `${Math.max(1, m)} min`; };
function nextEpisode(c, s, e) {
  s = +s; e = +e; if (!(s >= 0) || !(e > 0)) return null;
  const seasons = (CARDS.get(keyOf(c)) || c).seasons;
  if (!seasons?.length) return { s, e: e + 1 };
  const cur = seasons.find((x) => x.season_number === s);
  if (cur && e < (cur.episode_count || 0)) return { s, e: e + 1 };
  const nx = seasons.filter((x) => x.season_number > s && x.season_number > 0).sort((a, b) => a.season_number - b.season_number)[0];
  return nx ? { s: nx.season_number, e: 1 } : null;
}
/** What the Resume button should do for a title, or null if it was never played. */
function resumeInfo(c) {
  const h = Continue.get(c); if (!h) return null;
  const pct = h.progress != null ? Math.max(0, Math.min(100, h.progress)) : null;
  const url = (s, e, t) => { const q = new URLSearchParams(); if (s != null && e != null) { q.set('s', s); q.set('e', e); } if (t) q.set('r', '1'); const qs = q.toString(); return `/watch/${c.media_type}/${c.id}${qs ? '?' + qs : ''}`; };
  const t = !h.done && h.time >= 30 ? h.time : 0;
  if (c.media_type === 'tv' && h.s != null && h.e != null) {
    if (h.done) { const n = h.next || nextEpisode(c, h.s, h.e); if (n) return { s: n.s, e: n.e, t: 0, pct: 0, href: url(n.s, n.e, 0), label: `Resume S${n.s}:E${n.e}`, sub: 'Next episode' }; return { s: h.s, e: h.e, t: 0, pct: 100, href: url(h.s, h.e, 0), label: 'Watch again', sub: 'Finished' }; }
    return { s: h.s, e: h.e, t, pct, approx: !!h.approx, href: url(h.s, h.e, t), label: `Resume S${h.s}:E${h.e}${t ? ' · ' + fmtPos(t) : ''}` };
  }
  if (h.done) return { t: 0, pct: 100, href: url(null, null, 0), label: 'Watch again', sub: 'Finished' };
  return { t, pct, approx: !!h.approx, href: url(null, null, t), label: t ? `Resume · ${fmtPos(t)}` : 'Resume' };
}

// ---- helpers --------------------------------------------------------------------
// Prefetched responses (hover/touch on a title link): used once, within 2 minutes.
const PREF = new Map();
function prefetch(path) {
  if (PREF.has(path)) return PREF.get(path).p;
  const p = api(path, true); PREF.set(path, { p, at: Date.now() }); p.catch(() => PREF.delete(path));
  if (PREF.size > 40) PREF.delete(PREF.keys().next().value);
  return p;
}
/** On a kids profile every catalogue request carries ?kids=<max age> so the server drops titles above it. */
const kidsUrl = (path) => { const a = Profiles.kidsAge(); if (a == null || !path.startsWith('/api/') || /[?&]kids=/.test(path)) return path; return path + (path.includes('?') ? '&' : '?') + 'kids=' + a; };
async function api(path, noCache) {
  const h = !noCache && PREF.get(path); if (h) { PREF.delete(path); if (Date.now() - h.at < 120e3) return h.p; }
  const r = await fetch(kidsUrl(path), { headers: { accept: 'application/json' } });
  const d = await r.json().catch(() => ({}));
  if (!r.ok) throw Object.assign(new Error(d.error || `Request failed (${r.status})`), { status: r.status });
  if (d && d.kids && d.blocked) throw Object.assign(new Error(d.error || 'Not available on this kids profile.'), { status: 403 }); // sent as 200 so it isn't logged as a failed request
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
  const inner = `<div class="pic${art ? ' art' : ''}"${art ? ` style="--h:${hue}"` : ''}>${pic}${opts.s != null ? `<span class="ep-badge">S${esc(opts.s)} E${esc(opts.e)}</span>` : ''}${opts.tag ? `<span class="nb">${esc(opts.tag)}</span>` : ''}${prog}
    <div class="info"><b>${esc(c.title)}</b><span>${c.rating ? `<i class="rt">${c.rating}</i>` : ''}${c.year ? `<i>${c.year}</i>` : ''}${c.media_type === 'tv' ? '<i>Series</i>' : ''}</span>
    ${g ? `<span style="margin-top:3px">${esc(g)}</span>` : ''}
    <div class="acts"><a class="p" href="${opts.play || watchHref(c, opts.s, opts.e)}" data-link aria-label="Play ${esc(c.title)}">${ICON.play}</a>
    <button data-list="${keyOf(c)}" aria-label="${inList ? 'Remove from' : 'Add to'} My List">${inList ? ICON.check : ICON.plus}</button>
    <a href="${href(c)}" data-link aria-label="More info" style="margin-left:auto">${ICON.down}</a></div></div></div>`;
  // Card = div with a full-size link layer (no nested <a> elements).
  const hit = `<a class="hit" href="${href(c)}" data-link aria-label="${esc(c.title)}${c.year ? ' (' + c.year + ')' : ''}"></a>`;
  if (opts.rank) return `<div class="card top" data-key="${keyOf(c)}"><span class="num" aria-hidden="true">${opts.rank}</span>${inner}${hit}</div>`;
  return `<div class="card" data-key="${keyOf(c)}">${inner}${hit}</div>`;
}
const CARDS = new Map(); // key -> card data, for list toggles
const remember = (arr) => arr.forEach((c) => CARDS.set(keyOf(c), c));

// Continue-watching card: badge/progress/play link follow the resume target.
function contOpts(c) { const r = resumeInfo(c); return r ? { progress: r.pct > 0 ? r.pct : null, s: r.s, e: r.e, play: r.href } : { progress: c.progress, s: c.s, e: c.e }; }
function rowHTML(r, i) {
  if (!r.items?.length) return '';
  remember(r.items);
  const items = r.items.map((c, n) => cardHTML(c, r.top10 ? { rank: n + 1 } : r.cont ? contOpts(c) : r.soon && c.release_date ? { tag: fmtDate(c.release_date) } : {})).join('');
  return `<section class="row"${r.cont ? ' data-cont' : ''} data-row="${esc(r.id || '')}" aria-labelledby="rh${i}"><div class="row-h"><h2 id="rh${i}">${esc(r.title)}</h2>${r.link ? `<a href="${r.link}" data-link>Explore all ›</a>` : ''}</div>
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
function titleSkeleton() {
  main.innerHTML = `<section class="hero detail-hero skel-hero"><div class="hero-in"><div class="skel sk-line" style="width:90px;height:14px"></div><div class="skel sk-line" style="width:min(520px,80%);height:48px;margin-top:14px"></div><div class="skel sk-line" style="width:240px;height:18px;margin-top:16px"></div><div class="skel sk-line" style="width:min(600px,92%);height:62px;margin-top:16px"></div><div style="display:flex;gap:10px;margin-top:20px"><div class="skel sk-line" style="width:140px;height:46px;border-radius:999px"></div><div class="skel sk-line" style="width:46px;height:46px;border-radius:50%"></div></div></div></section>
  <div class="dwrap"><div><div class="skel sk-line" style="width:140px;height:22px;margin:8px 0 16px"></div>${'<div class="ep skel" style="height:96px;margin-bottom:10px"></div>'.repeat(3)}</div><aside class="facts">${'<div class="skel sk-line" style="height:14px;margin:10px 0"></div>'.repeat(6)}</aside></div>`;
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
  const rs = resumeInfo(c);
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
        <a class="btn cta${rs ? ' resume' : ''}" href="${rs ? rs.href : watchHref(c)}" data-link>${ICON.play}${esc(rs ? rs.label : 'Play')}</a>
        ${detail ? `<button class="btn icon ${List.has(c) ? 'on' : ''}" data-list="${keyOf(c)}" aria-label="My List">${List.has(c) ? ICON.check : ICON.plus}</button>${rateHTML(c)}${upcoming(c) ? remindBtn(c, upcoming(c).date, upcoming(c).label) + (COMM?.countdownHTML(upcoming(c).date, upcoming(c).label) || '') : ''}${CONFIG.parties && Profiles.kidsAge() == null ? `<a class="btn dark" href="/party/${Math.random().toString(36).slice(2, 8)}?t=${keyOf(c)}" data-link>👻 Watch together</a>` : ''}`
          : `<a class="btn dark" href="${href(c)}" data-link>${ICON.info}Details</a>`}
      </div>
      ${rs && (rs.pct > 0 || rs.sub) ? `<div class="resume-bar"${rs.approx ? ' title="Approximate — this player doesn’t report its exact position"' : ''}>${rs.pct > 0 ? `<span class="rb"><i style="width:${Math.max(3, rs.pct).toFixed(1)}%"></i></span>` : ''}<small>${rs.sub ? esc(rs.sub) : `${Math.round(rs.pct)}% watched${rs.approx ? ' (approx.)' : ''}`}${detail && rs.t ? ` · <a href="${rs.href.replace('r=1', 'r=0')}" data-link>Start over</a>` : ''}</small></div>` : ''}
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
  const kids = Profiles.kidsAge() != null;
  const d = await api(kids ? '/api/kids/home' : '/api/home');
  main.innerHTML = '';
  const cont = Continue.all().map((c) => ({ ...c }));
  const rows = [...d.rows];
  if (cont.length) rows.unshift({ id: 'continue', title: 'Continue watching', items: cont, cont: true });
  const list = List.all(); if (list.length) rows.splice(cont.length ? 2 : 1, 0, { id: 'mylist', title: 'My List', link: '/my-list', items: list });
  const shown = rows.filter((r) => SITE.rows?.[r.id] !== false);
  main.innerHTML = `<div class="rows">${shown.map(rowHTML).join('')}</div>`;
  mountHero(d.hero.length ? d.hero : shown[0]?.items.slice(0, 5) || []);
  wireRows(); markNewEpisodes($('[data-row="mylist"]', main));
  const rowsEl = $('.rows', main), after = (id) => $(`[data-row="${id}"]`, rowsEl);
  if (SITE.rows?.because !== false) because(2).then((bs) => {
    if (!rowsEl.isConnected) return;
    for (const b of bs.reverse()) { const tmp = document.createElement('div'); tmp.innerHTML = rowHTML({ id: 'because-' + b.seed.id, title: b.title, items: b.items }); const ref = after('mylist') || after('continue'); ref ? ref.after(tmp.firstElementChild) : rowsEl.prepend(tmp.firstElementChild); }
    if (bs.length) wireRows(rowsEl);
  }).catch(() => {});
  // Seasonal row: while the Halloween look is on (Settings › Appearance › Seasonal theme). Kids profiles get family-friendly picks.
  if (document.documentElement.dataset.season === 'halloween' && SITE.rows?.halloween !== false) api('/api/seasonal/halloween').then((h) => {
    if (!rowsEl.isConnected || !h.items?.length || after('halloween')) return;
    const tmp = document.createElement('div'); tmp.innerHTML = rowHTML({ id: 'halloween', title: h.title, items: h.items, link: h.kids == null ? '/genre/movie/27' : '' }, 'halloween');
    const ref = after('mylist') || after('continue'); ref ? ref.after(tmp.firstElementChild) : rowsEl.prepend(tmp.firstElementChild); wireRows(rowsEl);
  }).catch(() => {});
  if (!kids) { COMM?.homeExtras(rowsEl, after); FLAIR?.homeStrip(rowsEl, after); }
  if (kids) return;
  if (SITE.rows?.collections !== false) api('/api/collections/featured').then((c) => {
    if (!rowsEl.isConnected || !c.items?.length) return;
    const tmp = document.createElement('div'); tmp.innerHTML = collRowHTML(c.items);
    const ref = after('top10') || after('pop-tv'); ref ? ref.after(tmp.firstElementChild) : rowsEl.append(tmp.firstElementChild); wireRows(rowsEl);
  }).catch(() => {});
  if (SITE.rows?.soon !== false) api(`/api/coming-soon/movie?region=${region()}`).then((c) => {
    if (!rowsEl.isConnected || !c.results?.length) return;
    const tmp = document.createElement('div'); tmp.innerHTML = rowHTML({ id: 'soon', title: 'Coming soon', link: '/coming-soon', items: c.results.slice(0, 20), soon: true }, 'soon');
    const ref = after('now') || after('top-tv'); ref ? ref.after(tmp.firstElementChild) : rowsEl.append(tmp.firstElementChild); wireRows(rowsEl);
  }).catch(() => {});
}
function collRowHTML(items) {
  return `<section class="row colls" data-row="collections" aria-labelledby="rhcoll"><div class="row-h"><h2 id="rhcoll">Collections</h2></div>
    <div class="track-wrap"><button class="arrow l" aria-label="Scroll left" disabled>${ICON.left}</button><div class="track">${items.map((c) => `<a class="coll" href="/collection/${c.id}" data-link style="--h:${(c.id * 47) % 360}"><img src="${esc(c.backdrop)}" alt="" loading="lazy" decoding="async"><span class="coll-t"><b>${esc(c.name)}</b><small>${c.count} films${c.years?.length === 2 && c.years[0] !== c.years[1] ? ` · ${c.years[0]}–${c.years[1]}` : ''}</small></span></a>`).join('')}</div><button class="arrow r" aria-label="Scroll right">${ICON.right}</button></div></section>`;
}
// "New episode" badges on saved series (My List): latest episode aired in the last 21 days and not watched yet.
async function markNewEpisodes(root) {
  if (!root) return;
  const els = $$('.card[data-key^="tv:"]', root).filter((el) => List.all().some((x) => keyOf(x) === el.dataset.key)); if (!els.length) return;
  const ids = [...new Set(els.map((el) => el.dataset.key.split(':')[1]))].slice(0, 60);
  let st; try { st = await api(`/api/tv-status?ids=${ids.join(',')}`); } catch { return; }
  const t0 = Date.parse(st.today), seen = (id, ep) => { const m = EpLog.all()[`tv:${id}`]; return !!m?.[`${ep.s}:${ep.e}`]?.[1]; };
  for (const sh of st.shows || []) {
    const ep = sh.last; if (!ep?.air_date) continue;
    const age = (t0 - Date.parse(ep.air_date)) / 864e5; if (age < 0 || age > 21 || seen(sh.id, ep)) continue;
    const tag = ep.e === 1 ? 'New season' : 'New episode';
    els.filter((el) => el.dataset.key === `tv:${sh.id}`).forEach((el) => { const pic = $('.pic', el); if (pic && !$('.nb', pic)) { pic.insertAdjacentHTML('beforeend', `<span class="nb" title="S${ep.s} E${ep.e} · ${esc(ep.name)} — aired ${esc(fmtDate(ep.air_date))}">${tag}</span>`); el.classList.add('has-new'); } });
  }
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
// Year / rating / runtime filters (URL: yr=2010-2019, r=7, rt=90-120). Runtime = episode length for series.
const FILTERS = {
  yr: [['', 'Any year'], [`${new Date().getFullYear()}-`, 'This year'], ['2020-', '2020s'], ['2010-2019', '2010s'], ['2000-2009', '2000s'], ['1990-1999', '1990s'], ['1980-1989', '1980s'], ['-1979', 'Before 1980']],
  r: [['', 'Any rating'], ['6', '6+ ★'], ['7', '7+ ★'], ['8', '8+ ★']],
  rt: { movie: [['', 'Any length'], ['-90', 'Under 90 min'], ['90-120', '90–120 min'], ['120-', 'Over 2 hours']], tv: [['', 'Any length'], ['-30', 'Episodes under 30 min'], ['30-60', '30–60 min episodes'], ['60-', 'Episodes 60+ min']] },
};
function readFilters() {
  const q = new URLSearchParams(location.search), pick = (k, opts) => (opts.some(([v]) => v === q.get(k)) ? q.get(k) : '');
  return { yr: pick('yr', FILTERS.yr), r: pick('r', FILTERS.r), rt: q.get('rt') && /^\d*-\d*$/.test(q.get('rt')) ? q.get('rt') : '' };
}
/** API query string for the active filters ('' when none). */
function filterQS(f) {
  const o = new URLSearchParams(), [yf, yt] = f.yr.split('-'), [a, b] = f.rt.split('-');
  if (yf) o.set('yf', yf); if (yt) o.set('yt', yt); if (f.r) o.set('rmin', f.r); if (a) o.set('rtmin', a); if (b) o.set('rtmax', b);
  return o.toString();
}
function filterBar(type, f) {
  const sel = (k, opts, label) => `<label class="fsel"><span class="sr">${label}</span><select data-f="${k}" aria-label="${label}">${opts.map(([v, n]) => `<option value="${v}"${f[k] === v ? ' selected' : ''}>${n}</option>`).join('')}</select></label>`;
  const any = f.yr || f.r || f.rt;
  return `<div class="fbar" role="group" aria-label="Filters">${sel('yr', FILTERS.yr, 'Year')}${sel('r', FILTERS.r, 'Rating')}${sel('rt', FILTERS.rt[type === 'tv' ? 'tv' : 'movie'], type === 'tv' ? 'Episode length' : 'Runtime')}${any ? '<button class="fclear" type="button" data-fclear>Clear filters</button>' : ''}</div>`;
}
function wireFilters() {
  const apply = (f) => { const q = new URLSearchParams(location.search); for (const k of ['yr', 'r', 'rt']) f[k] ? q.set(k, f[k]) : q.delete(k); const qs = q.toString(); go(location.pathname + (qs ? '?' + qs : '')); };
  $$('[data-f]', main).forEach((el) => (el.onchange = () => apply({ ...readFilters(), [el.dataset.f]: el.value })));
  const c = $('[data-fclear]', main); if (c) c.onclick = () => apply({ yr: '', r: '', rt: '' });
}
const GENRE_SORTS = [['popular', 'Popular'], ['top_rated', 'Top rated'], ['newest', 'Newest']];
async function viewGenre(type, id) {
  const g = GENRES[type]?.find((x) => x.id === +id);
  const sort = GENRE_SORTS.some(([k]) => k === new URLSearchParams(location.search).get('sort')) ? new URLSearchParams(location.search).get('sort') : 'popular';
  const f = readFilters(), fq = filterQS(f), keep = (base) => { const q = new URLSearchParams(location.search); q.delete('sort'); if (base) q.set('sort', base); const s = q.toString(); return s ? `?${s}` : ''; };
  const sq = keep(sort === 'popular' ? '' : sort);
  const head = `<div class="g-bar"><a class="g-back" href="/genres${type === 'tv' ? '?type=tv' : ''}" data-link>‹ All genres</a>
    <div class="seg" role="group" aria-label="Sort">${GENRE_SORTS.map(([k, n]) => `<a href="/genre/${type}/${id}${keep(k === 'popular' ? '' : k)}" data-link class="${k === sort ? 'on' : ''}"${k === sort ? ' aria-current="true"' : ''}>${n}</a>`).join('')}</div></div>${filterBar(type, f)}`;
  await gridView({ title: `${g?.name || 'Genre'} ${type === 'tv' ? 'series' : 'movies'}`, head, pills: [{ href: `/browse/${type}/popular`, name: 'All' }, ...(GENRES[type] || []).map((x) => ({ href: `/genre/${type}/${x.id}${sq}`, name: x.name, on: x.id === +id }))],
    url: (p) => (fq ? `/api/filter/${type}?genre=${id}&page=${p}&sort=${sort}&${fq}` : `/api/discover/${type}/${id}?page=${p}&sort=${sort}`), infinite: true,
    empty: '<div class="empty"><img src="/img/logo.svg" alt=""><h2>Nothing matches those filters</h2><p>Try a wider year range or a lower rating.</p></div>', after: wireFilters });
}
let gridObserver;
async function gridView({ title, lead = '', head = '', pills = [], url, empty, infinite = false, after }) {
  gridObserver?.disconnect(); gridObserver = null;
  main.innerHTML = `<div class="page"><h1>${esc(title)}</h1>${lead ? `<p class="lead">${esc(lead)}</p>` : ''}${head}
    ${pills.length ? `<div class="pills">${pills.map((p) => `<a class="pill ${p.on ? 'on' : ''}" href="${p.href}" data-link>${esc(p.name)}</a>`).join('')}</div>` : ''}
    <div class="grid">${'<div class="card"><div class="pic skel"></div></div>'.repeat(12)}</div><div class="more"></div></div>`;
  const grid = $('.grid', main), more = $('.more', main);
  after?.();
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
    <div class="pills">${GENRES.movie.slice(0, 14).map((g) => `<a class="pill" href="/genre/movie/${g.id}" data-link>${esc(g.name)}</a>`).join('')}<a class="pill" href="/genres" data-link>All genres ›</a></div></div>`;
    $('#pageSearch').onsubmit = (e) => { e.preventDefault(); const v = e.target.q.value.trim(); if (v) go(`/search?q=${encodeURIComponent(v)}`); };
    return;
  }
  const gm = matchGenres(q), f = readFilters(), fq = filterQS(f);
  const head = `${filterBar('movie', f).replace('aria-label="Runtime"', 'aria-label="Runtime (episode length for series)"')}<div class="sx">${gm.length ? `<div class="sx-genres" aria-label="Genres">${gm.map(({ type, g }) => `<a class="gchip" href="/genre/${type}/${g.id}" data-link style="--gh:${genreHue(g.id)}"><small>Genre</small>${esc(g.name)} <span>${type === 'tv' ? 'Series' : 'Movies'}</span></a>`).join('')}</div>` : ''}<div class="sx-people" hidden></div></div>`;
  const people = api(`/api/search/people?q=${encodeURIComponent(q)}`).catch(() => ({ results: [] }));
  const grid = gridView({ title: `Results for “${q}”`, head, url: (p) => (fq ? `/api/search-filtered?q=${encodeURIComponent(q)}&page=${p}&${fq}` : `/api/search?q=${encodeURIComponent(q)}&page=${p}`), after: wireFilters,
    empty: `<div class="empty"><img src="/img/logo.svg" alt=""><h2>No title matches for “${esc(q)}”${fq ? ' with those filters' : ''}</h2><p>${fq ? 'Try clearing a filter.' : 'Check the spelling or try a different title.'}</p></div>` });
  const pr = await people; const box = location.pathname === '/search' && new URLSearchParams(location.search).get('q') === q ? $('.sx-people', main) : null; // ignore stale results while typing
  const nq = normQ(q), words = nq.split(' ').filter(Boolean);
  // TMDB person search is fuzzy; only show people whose name actually matches what was typed.
  const list = (pr.results || []).filter((x) => { const n = normQ(x.name); return n.includes(nq) || words.every((w) => n.split(' ').some((p) => p.startsWith(w))); }).slice(0, 12);
  if (box && list.length) {
    box.hidden = false;
    box.innerHTML = `<h2>People</h2><div class="cast people">${list.map((x) => `<a class="person" href="/person/${x.id}" data-link><div class="ph">${x.profile ? `<img src="${esc(x.profile)}" alt="" loading="lazy">` : `<span>${esc(x.name.split(' ').map((w) => w[0]).join('').slice(0, 2))}</span>`}</div><b>${esc(x.name)}</b><span>${esc(x.known_for?.[0] || x.dept || '')}</span></a>`).join('')}</div>`;
  }
  await grid;
}
const normQ = (v) => String(v || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9& ]+/g, ' ').replace(/\s+/g, ' ').trim();
const GENRE_ALIAS = { scifi: 'science fiction', 'sci fi': 'science fiction', sf: 'science fiction', romcom: 'romance', 'rom com': 'romance', romantic: 'romance', cartoon: 'animation', cartoons: 'animation', animated: 'animation', anime: 'animation', docs: 'documentary', doc: 'documentary', documentaries: 'documentary', scary: 'horror', funny: 'comedy', comedies: 'comedy', kids: 'kids', thrillers: 'thriller', westerns: 'western', musical: 'music', superhero: 'action', detective: 'crime', murder: 'mystery' };
function matchGenres(q) {
  const n = normQ(q), a = GENRE_ALIAS[n] || n;
  if (a.length < 3) return [];
  const out = [];
  for (const type of ['movie', 'tv']) for (const g of GENRES[type] || []) {
    const gn = normQ(g.name), words = gn.split(/ & | /);
    if (gn === a || gn.startsWith(a) || words.some((w) => w.length > 2 && w.startsWith(a)) || (a.length > 4 && words.some((w) => w.length > 3 && a.startsWith(w)))) out.push({ type, g });
  }
  return out.slice(0, 6);
}
const genreHue = (id) => (id * 67) % 360;
async function viewPerson(id) {
  skeleton();
  const d = await api(`/api/person/${id}`);
  document.title = `${d.name} — GhostFlix`;
  const all = d.credits || []; remember(all);
  const nm = all.filter((c) => c.media_type === 'movie').length, nt = all.length - nm;
  const bio = d.biography || '';
  main.innerHTML = `<div class="page pp"><div class="pp-head"><div class="pp-ph">${d.profile ? `<img src="${esc(d.profile)}" alt="">` : `<span>${esc(d.name.split(' ').map((w) => w[0]).join('').slice(0, 2))}</span>`}</div>
    <div class="pp-in"><small class="pp-k">${esc(d.dept || 'Person')}</small><h1>${esc(d.name)}</h1>
    <p class="pp-meta">${[d.birthday ? `Born ${esc(d.birthday)}` : '', esc(d.place_of_birth || ''), `${nm} movie${nm === 1 ? '' : 's'} · ${nt} series`].filter(Boolean).join(' <span class="dotsep">·</span> ')}</p>
    ${bio ? `<p class="pp-bio">${esc(bio.length > 520 ? bio.slice(0, 520).replace(/\s+\S*$/, '') + '…' : bio)}</p>${bio.length > 520 ? '<button class="pp-more" type="button">Read more</button>' : ''}` : ''}</div></div>
    <div class="pills" role="group" aria-label="Filter">${[['all', `All (${all.length})`], ['movie', `Movies (${nm})`], ['tv', `Series (${nt})`]].map(([k, n], i) => `<button class="pill${i ? '' : ' on'}" data-pf="${k}" type="button">${n}</button>`).join('')}</div>
    <div class="grid">${all.map((c) => cardHTML(c)).join('') || '<p class="empty">No movies or series listed.</p>'}</div></div>`;
  const more = $('.pp-more', main); if (more) more.onclick = () => { $('.pp-bio', main).textContent = bio; more.remove(); };
  $$('[data-pf]', main).forEach((b) => (b.onclick = () => {
    $$('[data-pf]', main).forEach((x) => x.classList.toggle('on', x === b));
    const list = b.dataset.pf === 'all' ? all : all.filter((c) => c.media_type === b.dataset.pf);
    $('.grid', main).innerHTML = list.map((c) => cardHTML(c)).join('');
  }));
}
function viewMyList() {
  const list = List.all(), cont = Continue.all(), rem = Remind.all();
  remember([...list, ...cont, ...rem]);
  main.innerHTML = `<div class="page"><h1>My List</h1><p class="lead">Saved on this device.</p>
    ${list.length ? `<div class="grid">${list.map((c) => cardHTML(c)).join('')}</div>` : `<div class="empty"><img src="/img/logo.svg" alt=""><h2>Your list is empty</h2><p>Tap <b>+</b> on any title to save it here.</p></div>`}
    ${rem.length ? `<h1 id="reminders" style="margin-top:46px;font-size:24px">Reminders</h1><p class="lead"><a class="pill" href="/coming-soon" data-link>Coming soon ›</a></p><div class="grid">${rem.map((c) => `<div class="cs-item">${cardHTML(c, { tag: c.date <= todayISO() ? 'Out now' : fmtDate(c.date) })}${c.date > todayISO() && COMM?.countdownHTML(c.date, c.label) ? `<div class="cs-meta">${COMM.countdownHTML(c.date, c.label)}</div>` : ''}</div>`).join('')}</div>` : ''}
    ${cont.length ? `<h1 id="continue" style="margin-top:46px;font-size:24px">Continue watching</h1><p class="lead"><a class="pill" href="/settings/history" data-link>Manage history</a></p><div class="grid">${cont.map((c) => cardHTML(c, contOpts(c))).join('')}</div>` : ''}</div>`;
  markNewEpisodes($('.grid', main));
}

async function viewGenres() {
  const type = new URLSearchParams(location.search).get('type') === 'tv' ? 'tv' : 'movie';
  const tile = (g) => `<a class="gtile" href="/genre/${type}/${g.id}" data-link style="--gh:${genreHue(g.id)}">${g.backdrop ? `<img src="${esc(g.backdrop)}" alt="" loading="lazy" decoding="async">` : ''}<span class="gt-n">${esc(g.name)}</span>${g.title ? `<span class="gt-t">${esc(g.title)}</span>` : ''}</a>`;
  main.innerHTML = `<div class="page gpage"><div class="g-top"><div><h1>Genres</h1><p class="lead">Browse by mood.</p></div>
    <div class="seg" role="group" aria-label="Type"><a href="/genres" data-link class="${type === 'movie' ? 'on' : ''}">Movies</a><a href="/genres?type=tv" data-link class="${type === 'tv' ? 'on' : ''}">Series</a></div></div>
    <div class="gtiles">${(GENRES[type] || []).map(tile).join('') || '<p class="empty">No genres yet.</p>'}</div></div>`;
  try {
    const d = await api(`/api/genre-tiles/${type}`);
    const box = $('.gtiles', main); if (box && d.tiles?.length) box.innerHTML = d.tiles.map(tile).join('');
  } catch {}
}
async function viewCollection(id) {
  titleSkeleton();
  const d = await api(`/api/collection/${id}`);
  document.title = `${d.name} — GhostFlix`;
  remember(d.parts);
  const t = todayISO(), out = d.parts.filter((c) => !c.release_date || c.release_date <= t);
  const next = out.find((c) => !Continue.get(c)?.done) || out[0];
  const h = Continue.get(next || {});
  main.innerHTML = `<section class="hero detail-hero coll-hero"><div class="hero-bg"><img src="${esc(d.backdrop || d.poster || '')}" alt="" fetchpriority="high"></div>
    ${d.poster ? `<div class="hero-poster"><img src="${esc(d.poster)}" alt=""></div>` : ''}
    <div class="hero-in"><div class="kicker"><img src="/img/logo.svg" alt="">Collection</div><h1>${esc(d.name)}</h1>
    <div class="meta"><span class="gen">${out.length} film${out.length === 1 ? '' : 's'}${out.length ? ` <span class="dotsep">·</span> ${out[0].year || ''}${out.length > 1 ? `–${out[out.length - 1].year || ''}` : ''}` : ''}${d.parts.length > out.length ? ` <span class="dotsep">·</span> ${d.parts.length - out.length} upcoming` : ''}</span></div>
    <p class="ov">${esc(d.overview)}</p>
    ${next ? `<div class="btns"><a class="btn cta" href="${watchHref(next)}" data-link>${ICON.play}${esc(h && !h.done ? `Resume ${next.title}` : next === out[0] ? `Start with ${next.title}` : `Next: ${next.title}`)}</a></div>` : ''}</div></section>
    <div class="page" style="padding-top:10px"><h2 class="sech">In order</h2><div class="grid coll-grid">${d.parts.map((c, i) => `<div class="cpart">${cardHTML(c, Continue.get(c)?.done ? { tag: '✓ Watched' } : c.release_date > t ? { tag: fmtDate(c.release_date) } : {})}<small>${i + 1}. ${c.release_date > t ? `Coming ${esc(fmtDate(c.release_date))}` : c.year || ''}</small></div>`).join('')}</div></div>`;
}
async function viewComingSoon() {
  const type = new URLSearchParams(location.search).get('type') === 'tv' ? 'tv' : 'movie';
  main.innerHTML = `<div class="page"><div class="g-top"><div><h1>Coming soon</h1><p class="lead">${type === 'tv' ? 'New series premiering in the next six months.' : `Films opening in cinemas (${esc(region())}) in the next six months.`} Tap <b>Remind me</b> and we’ll tell you when it’s out.</p></div>
    <div class="seg" role="group" aria-label="Type"><a href="/coming-soon" data-link class="${type === 'movie' ? 'on' : ''}">Movies</a><a href="/coming-soon?type=tv" data-link class="${type === 'tv' ? 'on' : ''}">Series</a></div></div>
    <div class="grid cs-grid">${'<div class="card"><div class="pic skel"></div></div>'.repeat(12)}</div><div class="more"></div></div>`;
  const grid = $('.cs-grid', main), more = $('.more', main); let page = 1;
  const item = (c) => `<div class="cs-item">${cardHTML(c, { tag: fmtDate(c.release_date) })}<div class="cs-meta"><span>${type === 'tv' ? 'Premieres' : 'Out'} <b>${esc(fmtDate(c.release_date))}</b></span>${remindBtn(c, c.release_date, type === 'tv' ? 'Premieres' : 'Out', 'pill remind')}${COMM?.countdownHTML(c.release_date, type === 'tv' ? 'Premieres' : 'Out') || ''}</div></div>`;
  const load = async () => {
    const d = await api(`/api/coming-soon/${type}?page=${page}&region=${region()}`); remember(d.results);
    if (page === 1) grid.innerHTML = d.results.length ? '' : '<div class="empty"><h2>Nothing scheduled yet</h2></div>';
    grid.insertAdjacentHTML('beforeend', d.results.map(item).join(''));
    more.innerHTML = page < d.total_pages ? '<button class="btn ghost sm">Load more</button>' : '';
    const b = $('button', more); if (b) b.onclick = async () => { b.disabled = true; b.textContent = 'Loading…'; page++; await load(); };
  };
  await load();
}
let previewCache = null;
async function previewCards(el) {
  try { previewCache ||= (await api('/api/list/all/trending')).results.slice(0, 6); } catch { previewCache = []; }
  remember(previewCache); el.innerHTML = `<div class="track" style="padding:6px 0 10px;margin:0">${previewCache.map((c) => cardHTML(c)).join('')}</div>`;
}
const pageCtx = () => ({ because, main, api, rowHTML, wireRows, history: Continue, list: List, go, auth: AUTH, toast, config: CONFIG });
// Web push (Stage D): follows TV series in My List / Continue watching and Remind-me titles of the active profile.
PUSH = createPush({
  shows: () => { const seen = new Set(), out = []; for (const c of [...List.all(), ...Continue.all().slice(0, 60)]) if (c.media_type === 'tv' && !seen.has(c.id)) { seen.add(c.id); out.push({ id: c.id, title: c.title }); } return out.slice(0, 200); },
  reminders: () => Remind.all().filter((x) => x.date).map((x) => ({ key: keyOf(x), title: x.title, date: x.date, label: x.label || '' })).slice(0, 200),
  // Notifications choice (Off / In GhostFlix only / Phone) per account + profile; the server checks this list hourly.
  list: () => { const seen = new Set(), out = []; for (const c of [...List.all(), ...Continue.all().slice(0, 60).filter((c) => c.media_type === 'tv')]) { const k = keyOf(c); if ((c.media_type === 'movie' || c.media_type === 'tv') && !seen.has(k)) { seen.add(k); out.push({ t: c.media_type, id: c.id, title: c.title }); } } return out.slice(0, 300); },
  profile: () => Profiles.active().id, signedIn: () => !!AUTH?.user,
  call: (path, o) => (COMM ? COMM.call(path, o) : fetch(path, { method: o?.method || 'GET', headers: { 'Content-Type': 'application/json' }, body: o?.body ? JSON.stringify(o.body) : undefined }).then(async (r) => { const j = await r.json().catch(() => ({})); if (!r.ok) throw new Error(j.error || `Error ${r.status}`); return j; })),
  toast,
});
const settingsCtx = () => ({ community: COMM, flair: FLAIR, push: PUSH, auth: AUTH, list: List, history: Continue, toast, watchHref, previewCards, discordUrl: CONFIG.discordUrl, githubUrl: CONFIG.githubUrl });
async function viewTitle(type, id) {
  if (!PREF.has(`/api/title/${type}/${id}?region=${region()}`)) titleSkeleton();
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
    ${d.collection ? `<a class="coll-banner" href="/collection/${d.collection.id}" data-link>${d.collection.backdrop ? `<img src="${esc(d.collection.backdrop)}" alt="" loading="lazy">` : ''}<span><small>Part of</small><b>${esc(d.collection.name)}</b><i>View the collection ›</i></span></a>` : ''}
    ${d.trailers?.length ? `<section class="sec"><h2>Trailers & videos</h2><div class="trailers">${d.trailers.map((t) => `<div class="trailer" role="button" tabindex="0" data-yt="${esc(t.key)}"><div class="th"><img src="https://i.ytimg.com/vi/${esc(t.key)}/mqdefault.jpg" alt="" loading="lazy"></div><b>${esc(t.name)}</b></div>`).join('')}</div></section>` : ''}
    ${d.cast?.length ? `<section class="sec"><h2>Cast</h2><div class="cast">${d.cast.map((c) => `<a class="person" href="/person/${c.id}" data-link><div class="ph">${c.profile ? `<img src="${esc(c.profile)}" alt="" loading="lazy">` : initials(c.name)}</div><b>${esc(c.name)}</b><span>${esc(c.character)}</span></a>`).join('')}</div></section>` : ''}
    ${d.recommendations?.length ? `<section class="sec" style="margin-left:calc(-1 * var(--pad));margin-right:calc(-1 * var(--pad))">${rowHTML({ title: 'More like this', items: d.recommendations }, 'rec')}</section>` : ''}
  </div>
  <aside class="facts"><dl>
    ${d.directors?.length ? `<dt>Director</dt><dd>${esc(d.directors.join(', '))}</dd>` : ''}
    ${d.created_by?.length ? `<dt>Created by</dt><dd>${esc(d.created_by.join(', '))}</dd>` : ''}
    ${d.release_date ? `<dt>${d.release_date > todayISO() ? (type === 'tv' ? 'Premieres' : 'Release date') : type === 'tv' ? 'First aired' : 'Released'}</dt><dd>${esc(d.release_date)}${d.release_date > todayISO() && COMM?.countdownHTML(d.release_date) ? `<br>${COMM.countdownHTML(d.release_date)}` : ''}</dd>` : ''}
    ${d.status ? `<dt>Status</dt><dd>${esc(d.status)}</dd>` : ''}
    ${d.next_episode?.air_date ? `<dt>Next episode</dt><dd>S${d.next_episode.s} E${d.next_episode.e} · ${esc(fmtDate(d.next_episode.air_date))}${COMM?.countdownHTML(d.next_episode.air_date, 'Next episode') ? `<br>${COMM.countdownHTML(d.next_episode.air_date, 'Next episode')}` : ''}</dd>` : ''}
    ${d.languages?.length ? `<dt>Languages</dt><dd>${esc(d.languages.slice(0, 4).join(', '))}</dd>` : ''}
    ${d.license ? `<dt>License</dt><dd>${esc(d.license)}</dd>` : ''}
    ${d.cast?.length ? `<dt>Starring</dt><dd>${esc(d.cast.slice(0, 4).map((c) => c.name).join(', '))}</dd>` : ''}
    ${d.imdb_id ? `<dt>Links</dt><dd><a href="https://www.imdb.com/title/${esc(d.imdb_id)}/" target="_blank" rel="noopener" style="color:var(--acc)">IMDb</a>${d.homepage ? ` · <a href="${esc(d.homepage)}" target="_blank" rel="noopener" style="color:var(--acc)">Official site</a>` : ''}</dd>` : ''}
  </dl>${provHTML}</aside></div>`;
  wireRows();
  if (Profiles.kidsAge() == null) { const cur = d.media_type === 'tv' ? Continue.get(d) : null; COMM?.mountChat($('.dwrap > div', main), d, { episodes: cur?.s != null ? [{ s: cur.s, e: cur.e }] : [] }); }
  $$('[data-yt]', main).forEach((el) => { const open = () => openPlayer({ kind: 'iframe', src: `https://www.youtube-nocookie.com/embed/${el.dataset.yt}?autoplay=1&rel=0&modestbranding=1&playsinline=1`, title: d.title, sub: 'Trailer', trailer: true }); el.onclick = open; el.onkeydown = (e) => e.key === 'Enter' && open(); });
  if ($('#seasonSel')) {
    const sel = $('#seasonSel'); const cont = resumeInfo(d);
    if (cont?.s != null && d.seasons.some((s) => s.season_number === +cont.s)) sel.value = cont.s;
    const load = async () => {
      const eps = $('#eps'); eps.innerHTML = '<div class="ep skel" style="height:110px"></div>'.repeat(3);
      try {
        const s = await api(`/api/tv/${id}/season/${sel.value}`);
        const log = EpLog.of(d), cur = Continue.get(d), t = todayISO();
        eps.innerHTML = s.episodes.map((e) => {
          const w = log[`${s.season_number}:${e.episode_number}`], isCur = cur && +cur.s === s.season_number && +cur.e === e.episode_number;
          const pct = w ? (w[1] ? 100 : w[0]) : isCur && cur.progress > 0 ? cur.progress : 0, done = w?.[1] || (isCur && cur.done);
          const future = e.air_date && e.air_date > t;
          return `<a class="ep${done ? ' watched' : ''}${isCur ? ' current' : ''}${future ? ' unaired' : ''}" href="${watchHref(d, s.season_number, e.episode_number)}" data-link><div class="n">${e.episode_number}</div>
          <div class="st">${e.still ? `<img src="${esc(e.still)}" alt="" loading="lazy">` : ''}<div class="pl">${ICON.play}</div>${done ? `<span class="tick" title="Watched">${ICON.check}</span>` : ''}${pct > 0 && !done ? `<div class="prog"><i style="width:${Math.max(4, Math.min(100, pct))}%"></i></div>` : ''}</div>
          <div><div class="t"><b>${e.episode_number}. ${esc(e.name)}${e.playable ? '<span class="free">Free</span>' : ''}</b><span>${future ? `Airs ${esc(fmtDate(e.air_date))}` : [done ? 'Watched' : pct > 0 ? `${Math.round(pct)}% watched` : '', fmtRuntime(e.runtime)].filter(Boolean).join(' · ')}</span></div><p>${esc(e.overview || (future ? 'Not aired yet.' : 'No description yet.'))}</p></div></a>`;
        }).join('') || '<p class="empty">No episodes listed yet.</p>';
        $('.ep.current', eps)?.scrollIntoView?.({ block: 'nearest' });
      } catch (e) { eps.innerHTML = `<p class="empty">${esc(e.message)}</p>`; }
    };
    sel.onchange = load; load();
  }
}

// ---- player ---------------------------------------------------------------------
let hlsLib = null;
async function viewWatch(type, id, s, e, r) {
  const qs = s != null ? `?s=${s}&e=${e}` : '';
  const d = await api(`/api/play/${type}/${id}${qs}`);
  const c = { ...(CARDS.get(`${type}:${id}`) || {}), id: +id, media_type: type, title: d.title, year: d.year, poster: d.poster, backdrop: d.backdrop };
  const sub = s != null ? `S${s} · E${e}` : d.year || '';
  if (d.sources.length) {
    c.playable = true;
    // Saved position for this exact episode/movie (unless finished or the user chose Start over).
    const prev = Continue.get(c);
    const same = prev && (prev.s ?? null) == (s ?? null) && (prev.e ?? null) == (e ?? null);
    const startAt = Settings.get().rememberPosition && r !== '0' && same && !prev.done && prev.time >= 30 ? prev.time : 0;
    const approxStart = !!(startAt && prev.approx); // estimated time only: never seek to it
    Continue.put(c, { s: s != null ? +s : null, e: e != null ? +e : null, ...(same && !prev.done ? {} : { time: 0, progress: 0, done: false, next: null, approx: false }) });
    const srcs = SrcMem.order(c, d.sources);
    if (type === 'tv' && !CARDS.get(keyOf(c))?.seasons) api(`/api/title/tv/${id}`).then((t) => { if (t?.seasons) CARDS.set(keyOf(c), { ...(CARDS.get(keyOf(c)) || {}), ...t }); }).catch(() => {});
    track('play', { t: keyOf(c), tt: d.title, src: srcLabel(srcs[0]) });
    PROMO.watched();
    { const full = CARDS.get(keyOf(c)) || {}; COMM?.onPlay(c, { sub: s != null ? `S${s} E${e}` : '', runtime: full.runtime || (type === 'tv' ? 45 : 0), genre_ids: c.genre_ids || full.genre_ids || (full.genres || []).map((g) => g.id) }); }
    openPlayer({ ...srcs[0], title: d.title, sub, all: srcs, card: c, s: s != null ? +s : null, e: e != null ? +e : null, subs: d.subtitles || [], startAt: approxStart ? 0 : startAt, approxStart: approxStart ? startAt : 0, resume: r === '1' });
  } else if (d.trailer) {
    openPlayer({ kind: 'iframe', src: d.trailer.src, title: d.title, sub: d.trailer.name || 'Trailer', trailer: true });
  } else {
    openPlayer({ kind: 'none', title: d.title, sub, card: c, providers: d.providers });
  }
}
// ---- playback progress ------------------------------------------------------------
// Embedded players that report playback via postMessage (CineSrc: {type:'cinesrc:timeupdate', currentTime, duration};
// common PLAYER_EVENT/MEDIA_DATA shapes too) give exact positions. Others only get season/episode plus an
// estimate of time spent with the player open (approx).
const START_PARAMS = [[/(^|\.)cinesrc\.st$/i, 't', { continueprompt: 'false' }]]; // host -> start-time URL param
const isCineSrc = (src) => { try { return /(^|\.)cinesrc\.st$/i.test(new URL(src).hostname); } catch { return false; } };
function withStart(src, t, direct, tv) {
  // Series on CineSrc: our own Up next countdown (+ Still watching?) replaces CineSrc's built-in auto-next.
  if (tv && isCineSrc(src)) { try { const u = new URL(src); u.searchParams.set('autonext', 'false'); src = u.toString(); } catch {} }
  if (!(t >= 30)) return src;
  try {
    const u = new URL(src); const m = START_PARAMS.find(([re]) => re.test(u.hostname)); if (!m) return src;
    u.searchParams.set(m[1], String(Math.floor(t))); if (direct) for (const [k, v] of Object.entries(m[2] || {})) u.searchParams.set(k, v);
    return u.toString();
  } catch { return src; }
}
const supportsStart = (src) => { try { const h = new URL(src).hostname; return START_PARAMS.some(([re]) => re.test(h)); } catch { return false; } };
function parsePlayerMsg(d) {
  if (typeof d === 'string') { if (d[0] !== '{') return null; try { d = JSON.parse(d); } catch { return null; } }
  if (!d || typeof d !== 'object') return null;
  let type = String(d.type || d.event || ''), p = d;
  if (/^(PLAYER_EVENT|MEDIA_DATA)$/i.test(type) && d.data && typeof d.data === 'object') { p = d.data; type = /^MEDIA_DATA$/i.test(type) ? (p.event || 'media') : String(p.event || p.type || ''); }
  type = type.replace(/^[\w-]+:/, '').toLowerCase();
  const num = (v) => (typeof v === 'number' && isFinite(v) ? v : typeof v === 'string' && v.trim() !== '' && isFinite(+v) ? +v : null);
  return { type, time: num(p.currentTime ?? p.current_time ?? p.time ?? p.position), dur: num(p.duration), s: num(p.season), e: num(p.episode) };
}
let TRACK = null;
function fromFrame(src, frame) { try { for (let w = src, i = 0; w && i < 5; w = w.parent, i++) { if (w === frame.contentWindow) return true; if (w === w.parent) break; } } catch {} return false; }
window.addEventListener('message', (ev) => { if (TRACK?.frame && fromFrame(ev.source, TRACK.frame)) { const m = parsePlayerMsg(ev.data); if (m) TRACK.onMsg(m); } });
function startTracker(o) {
  const c = o.card; if (!c) return null;
  const prev = Continue.get(c);
  const rt = () => T.epRt || (CARDS.get(keyOf(c)) || c).runtime; // minutes (TMDB); per-episode estimate for series (may arrive after open)
  const T = { frame: null, label: '', real: false, open: 0, ok: false, s: o.s ?? null, e: o.e ?? null, last: 0, time: 0, dur: 0,
    approx: prev?.approx && !prev.done && (prev.s ?? null) == (o.s ?? null) && (prev.e ?? null) == (o.e ?? null) ? prev.time || 0 : 0 };
  const save = (force) => {
    if (!force && Date.now() - T.last < 8000) return; T.last = Date.now();
    const real = T.real && T.dur > 0;
    const runtime = rt(); const time = real ? T.time : T.approx, dur = real ? T.dur : runtime ? runtime * 60 : 0;
    if (!real && time < 15) return;
    const pct = dur ? Math.min(100, (time / dur) * 100) : null, done = pct != null && pct >= DONE_PCT;
    Continue.put(c, { s: T.s, e: T.e, time: Math.round(time), dur: Math.round(dur) || null, progress: pct != null ? Math.round(pct * 10) / 10 : null, done, next: done && c.media_type === 'tv' ? nextEpisode(c, T.s, T.e) : null, approx: !real, src: T.label || null });
  };
  T.onMsg = (m) => {
    if (m.type === 'nextepisode' && m.s != null && m.e != null) { save(true); T.s = m.s; T.e = m.e; T.time = 0; T.dur = 0; T.approx = 0; T.last = 0; Continue.put(c, { s: m.s, e: m.e, time: 0, progress: 0, done: false, next: null }); const sp = $('.player-top .psub'); if (sp) sp.textContent = `S${m.s} · E${m.e}`; T.onUpdate?.(m); return; }
    if (m.dur > 0) T.dur = m.dur;
    if (m.time != null && T.dur > 0) { T.real = true; T.time = m.time; if (m.time > 1) T.worked(); }
    if (m.type === 'play' || m.type === 'ready') T.worked(m.type === 'play');
    if (m.type === 'ended') { T.real = true; if (T.dur) T.time = T.dur; save(true); T.onUpdate?.(m); return; }
    if (T.real) save(/^(pause|seeked)$/.test(m.type));
    T.onUpdate?.(m);
  };
  // A source "worked" once it reports real playback (or ~3 min open for players that report nothing): remember it for this show.
  T.worked = (sure = true) => { if (sure && !T.ok && T.label) { T.ok = true; SrcMem.setPref(c, T.label); } };
  T.setFrame = (f, label) => { T.frame = f; T.label = label || ''; T.ok = false; T.open = 0; };
  T.video = (v) => { T.real = true; T.time = v.currentTime; T.dur = v.duration || 0; if (v.currentTime > 1) T.worked(); save(v.paused || v.ended); T.onUpdate?.({ type: v.ended ? 'ended' : 'timeupdate' }); };
  T.tick = setInterval(() => { if (!T.real && document.visibilityState === 'visible') { T.approx += 5; T.open += 5; if (T.open >= 180) T.worked(); save(); } }, 5000);
  T.finish = () => { if (T.real && T.dur) T.time = T.dur; else if (rt()) T.approx = Math.max(T.approx, rt() * 60); T.last = 0; save(true); };
  T.runtime = rt;
  T.stop = () => { clearInterval(T.tick); save(true); if (TRACK === T) TRACK = null; };
  return T;
}
function closePlayer() {
  TRACK?.stop();
  const p = $('.player'); if (!p) return;
  const v = $('video', p); if (v) v.pause();
  p.remove(); document.body.style.overflow = '';
}
// ---- per-show source memory (per device) -------------------------------------------
// gf.srcpref {type:id: label} = the source that last played this title; gf.broken {type:id: [labels]} = reported broken (tried last).
const srcLabel = (x) => x.label || x.providerName || 'Source';
const SrcMem = {
  pref: (c) => LS.get('srcpref', {})[keyOf(c)] || null,
  broken: (c) => LS.get('broken', {})[keyOf(c)] || [],
  setPref(c, label) {
    const m = LS.get('srcpref', {}); const k = keyOf(c);
    if (m[k] !== label) { delete m[k]; m[k] = label; const ks = Object.keys(m); ks.slice(0, Math.max(0, ks.length - 400)).forEach((x) => delete m[x]); LS.set('srcpref', m); }
    const b = LS.get('broken', {}); if (b[k]?.includes(label)) { b[k] = b[k].filter((x) => x !== label); if (!b[k].length) delete b[k]; LS.set('broken', b); }
  },
  addBroken(c, label) {
    const b = LS.get('broken', {}); const k = keyOf(c); b[k] = [...new Set([...(b[k] || []), label])]; const ks = Object.keys(b); ks.slice(0, Math.max(0, ks.length - 400)).forEach((x) => delete b[x]); LS.set('broken', b);
    const m = LS.get('srcpref', {}); if (m[k] === label) { delete m[k]; LS.set('srcpref', m); }
  },
  order(c, list) {
    const pref = SrcMem.pref(c), br = SrcMem.broken(c), gp = Settings.get().preferProvider;
    const score = (x) => (br.includes(srcLabel(x)) ? 100 : 0) - (srcLabel(x) === pref ? 10 : 0) - (x.provider === gp ? 1 : 0);
    return list.map((x, i) => [x, i]).sort((p, q) => score(p[0]) - score(q[0]) || p[1] - q[1]).map((p) => p[0]);
  },
};
// Up next / Still watching? state: consecutive countdown-driven autoplays this session (any interaction resets it).
const AutoRun = { get: () => +sessionStorage.getItem('gf.autoplays') || 0, set: (n) => sessionStorage.setItem('gf.autoplays', String(n)) };
const STILL_AFTER = 3, UPNEXT_SECS = 10;
function openPlayer(o) {
  closePlayer();
  const el = document.createElement('div'); el.className = 'player'; el.setAttribute('role', 'dialog'); el.setAttribute('aria-label', `Playing ${o.title}`);
  const playable = !o.trailer && /^(iframe|video|hls)$/.test(o.kind);
  const tools = playable && o.card ? `<div class="ptools">${o.all?.length > 1 ? `<div class="srcs" role="group" aria-label="Video source">${o.all.map((x, i) => `<button class="pill" data-src="${i}">${esc(srcLabel(x))}</button>`).join('')}</div>` : ''}<button class="ptool" data-report title="Report this source as broken"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 21V4m0 0h11l-2 4 2 4H5"/></svg><span>Report broken</span></button>${COMM?.feat('bugs') ? '<button class="ptool" data-bug title="Report a bug"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 9a4 4 0 0 1 8 0v5a4 4 0 0 1-8 0zM12 9v9M4 13h4m8 0h4M5 7l3 2m11-2-3 2M5 19l3-2m11 2-3-2"/></svg><span>Bug</span></button>' : ''}</div>` : '';
  const fsBtn = `<button class="ptool pfs" type="button" data-fs title="Fullscreen" aria-label="Fullscreen"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5"/></svg></button>`;
  el.innerHTML = `<div class="player-top"><button class="back" aria-label="Close player"><svg viewBox="0 0 24 24"><path d="M15 5l-7 7 7 7"/></svg></button><div class="ptitle"><b>${esc(o.title)}</b> <span class="psub">${esc(o.sub || '')}</span></div>${tools}${fsBtn}</div><div class="player-stage"></div><button class="skipseg" hidden></button><div class="upnext" hidden></div>${o.trailer ? '<div class="trailer-flag">Trailer · full title not available on GhostFlix</div>' : ''}`;
  document.body.appendChild(el); document.body.style.overflow = 'hidden';
  const stage = $('.player-stage', el);
  TRACK = playable ? startTracker(o) : null;
  const T = TRACK;
  if (o.approxStart) toast(`Resuming ${o.sub || ''} — you watched about ${fmtPos(o.approxStart)} last time`);
  let startAt = o.startAt || 0, cur = 0, vid = null;
  const tv = o.card?.media_type === 'tv' && o.s != null;
  if (tv && T) api(`/api/tv/${o.card.id}/season/${o.s}`).then((sd) => { const ep = sd.episodes?.find((x) => x.episode_number === o.e); if (ep?.runtime) T.epRt = ep.runtime; }).catch(() => {});
  const mount = async (x) => {
    stage.innerHTML = ''; vid = null; $('.pop-flag', el)?.remove();
    if (x.kind === 'iframe') {
      const f = document.createElement('iframe'); const base = Settings.get().autoplay ? x.src : x.src.replace(/([?&])autoplay=(1|true)&?/, '$1').replace(/[?&]$/, ''); f.src = withStart(base, startAt, o.resume, tv); f.allow = 'autoplay; fullscreen; picture-in-picture; encrypted-media'; f.allowFullscreen = true;
      f.referrerPolicy = 'unsafe-url'; f.title = o.title; const sb = embedSandbox(x.src, x.sandbox); if (sb) f.setAttribute('sandbox', sb); stage.appendChild(f); T?.setFrame(f, srcLabel(x));
      if (startAt >= 30 && !supportsStart(x.src)) toast(`Last time you got to ${fmtPos(startAt)} — this player can’t jump there automatically`);
      if (sb && sb !== x.sandbox) {
        const b = document.createElement('button'); b.type = 'button'; b.className = 'pop-flag'; b.innerHTML = 'Pop-ups blocked · Not playing? <u>Allow</u>';
        b.title = 'Allow pop-ups for embedded players (can be changed in Settings › Player)';
        b.onclick = () => { Settings.set({ blockPopups: false }); toast('Pop-ups allowed · reloading player'); mount(x); }; $('.player-top', el).insertBefore(b, $('.ptools', el) || $('.pfs', el)); setTimeout(() => { b.classList.add('gone'); setTimeout(() => b.remove(), 900); }, 6000);
      }
    } else if (x.kind === 'video' || x.kind === 'hls') {
      const v = document.createElement('video'); vid = v; v.controls = true; v.autoplay = Settings.get().autoplay; v.playsInline = true; v.poster = o.card?.backdrop || ''; v.crossOrigin = 'anonymous';
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
      if (startAt >= 30) v.addEventListener('loadedmetadata', () => { if (startAt < v.duration - 30) v.currentTime = startAt; }, { once: true });
      T?.setFrame(null, srcLabel(x));
      ['timeupdate', 'pause', 'ended'].forEach((ev) => v.addEventListener(ev, () => v.duration && T?.video(v)));
      ['seeking', 'volumechange', 'ratechange'].forEach((ev) => v.addEventListener(ev, () => AutoRun.set(0)));
    } else {
      const p = o.providers; const any = p && (p.flatrate?.length || p.free?.length || p.rent?.length || p.buy?.length);
      stage.innerHTML = `<div class="player-msg"><img src="/img/logo.svg" alt="" width="64" style="margin:0 auto;filter:drop-shadow(0 0 14px var(--acc-glow))"><h2>Not streaming on GhostFlix yet</h2><p>There’s no trailer or stream added for this one yet.${any ? ' Check where it’s streaming instead:' : ''}</p>${any ? `<a class="btn glow sm" href="${esc(p.link)}" target="_blank" rel="noopener">Where to watch</a>` : ''}</div>`;
    }
    const br = o.card ? SrcMem.broken(o.card) : [];
    $$('[data-src]', el).forEach((b) => { const sx = o.all[+b.dataset.src], on = +b.dataset.src === cur; b.classList.toggle('on', on); b.classList.toggle('bad', br.includes(srcLabel(sx))); b.setAttribute('aria-pressed', String(on)); b.title = br.includes(srcLabel(sx)) ? 'You reported this source as broken' : ''; });
  };
  // ---- our fullscreen: the whole player (bar + embedded player). iPhone Safari has no element fullscreen: native video
  // goes fullscreen itself, embedded players use their own fullscreen button (iframe has allow="fullscreen" + allowfullscreen).
  const fsEl = () => document.fullscreenElement || document.webkitFullscreenElement;
  const fs = $('[data-fs]', el);
  fs.onclick = () => {
    if (fsEl()) { (document.exitFullscreen || document.webkitExitFullscreen)?.call(document); return; }
    const req = el.requestFullscreen || el.webkitRequestFullscreen;
    if (req) Promise.resolve(req.call(el)).then(() => screen.orientation?.lock?.('landscape').catch(() => {})).catch(() => {});
    else if (vid?.webkitEnterFullscreen) vid.webkitEnterFullscreen();
    else toast('Use the player’s own fullscreen button on this device');
  };
  const fsSync = () => { const on = fsEl() === el; fs.classList.toggle('on', on); fs.title = on ? 'Exit fullscreen' : 'Fullscreen'; fs.setAttribute('aria-label', fs.title); };
  document.addEventListener('fullscreenchange', fsSync); document.addEventListener('webkitfullscreenchange', fsSync);
  // ---- top bar overlays the player and auto-hides: any tap on the page (incl. inside the embedded player, seen as
  // window blur → iframe focused) or 4s idle hides it; the handle, a top-edge hover (desktop) or keyboard focus brings it back.
  const top = $('.player-top', el), handle = document.createElement('button');
  handle.type = 'button'; handle.className = 'pbar-handle'; handle.setAttribute('aria-label', 'Show player controls'); handle.title = 'Show title, sources & Report';
  handle.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 9l6 6 6-6"/></svg>';
  const edge = document.createElement('div'); edge.className = 'pbar-edge'; el.append(handle, edge);
  let barT = 0, barMoved = 0; // last real mouse move over the bar (:hover can stay stuck after a tap or when the pointer moves into the iframe)
  const barHide = () => { clearTimeout(barT); el.classList.add('bar-off'); top.setAttribute('aria-hidden', 'true'); top.inert = true; };
  const barArm = () => { clearTimeout(barT); barT = setTimeout(() => { if (Date.now() - barMoved < 3000 || top.querySelector(':focus-visible')) barArm(); else barHide(); }, 4000); };
  const barShow = () => {
    if (!el.isConnected) return;
    const a = document.activeElement; if (a?.tagName === 'IFRAME' && el.contains(a)) { el.tabIndex = -1; el.focus({ preventScroll: true }); } // pull focus back from the iframe to re-arm the blur detector
    el.classList.remove('bar-off'); top.removeAttribute('aria-hidden'); top.inert = false; barArm();
  };
  handle.onclick = (e) => { e.stopPropagation(); barShow(); };
  edge.addEventListener('mousemove', (e) => { if (e.movementX || e.movementY) barShow(); }); // real moves only (layout changes fire fake ones)
  top.addEventListener('pointerdown', (e) => { e.stopPropagation(); barArm(); });
  top.addEventListener('mousemove', (e) => { if (e.movementX || e.movementY) barMoved = Date.now(); }); top.addEventListener('focusin', barShow);
  el.addEventListener('pointerdown', (e) => { if (!e.target.closest('.player-top,.pbar-handle,.upnext,.skipseg')) barHide(); });
  el.addEventListener('mousemove', (e) => { if ((e.movementX || e.movementY) && e.clientY < 70 && el.classList.contains('bar-off') && matchMedia('(hover:hover)').matches) barShow(); });
  const onBlur = () => { if (!el.isConnected) return window.removeEventListener('blur', onBlur); setTimeout(() => { const a = document.activeElement; if (a?.tagName === 'IFRAME' && el.contains(a)) barHide(); }, 0); };
  window.addEventListener('blur', onBlur);
  barArm();
  const switchTo = (i) => { cur = i; if (T?.real) startAt = T.time; segKey = ''; segs = null; hideSkip(); mount(o.all[i]); };
  mount(o);
  $$('[data-src]', el).forEach((b) => (b.onclick = () => { AutoRun.set(0); switchTo(+b.dataset.src); }));

  // ---- Report broken: per device it moves this source to the back for this title, and it's sent to the admin. ----
  const bugB = $('[data-bug]', el); if (bugB) bugB.onclick = () => COMM?.openBug('player');
  const rep = $('[data-report]', el);
  if (rep) rep.onclick = () => {
    const x = o.all?.[cur] || o; const label = srcLabel(x); const c = o.card;
    SrcMem.addBroken(c, label);
    fetch('/api/report-source', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ type: c.media_type, id: c.id, s: T?.s ?? o.s, e: T?.e ?? o.e, source: label }) }).catch(() => {});
    const br = SrcMem.broken(c); const nextI = (o.all || []).findIndex((y, i) => i !== cur && !br.includes(srcLabel(y)));
    if (nextI >= 0) { switchTo(nextI); toast(`Thanks — reported ${label}. Trying ${srcLabel(o.all[nextI])}…`); }
    else { mount(o.all?.[cur] || o); toast(`Thanks — reported ${label}${o.all?.length > 1 ? '. No other working sources for this title right now' : ''}.`); }
  };

  // ---- Skip intro / recap: only with TheIntroDB timings, only for players that report time and can seek. ----
  const skipBtn = $('.skipseg', el); let segs = null, segKey = '', skipAt = null;
  const canSeek = () => !!(vid || (T?.frame && isCineSrc(T.frame.src)));
  const seekTo = (t) => { if (vid) vid.currentTime = t; else if (T?.frame) try { T.frame.contentWindow.postMessage({ type: 'cinesrc:command', command: 'seek', args: [t] }, new URL(T.frame.src).origin); } catch {} };
  const sendCmd = (command) => { if (vid) { if (command === 'pause') vid.pause(); return; } try { T.frame.contentWindow.postMessage({ type: 'cinesrc:command', command, args: [] }, new URL(T.frame.src).origin); } catch {} };
  function hideSkip() { skipBtn.hidden = true; skipAt = null; }
  skipBtn.onclick = () => { if (skipAt != null) { seekTo(skipAt); AutoRun.set(0); hideSkip(); } };
  const loadSegs = () => {
    const k = `${T.s}:${T.e}`; if (segKey === k) return; segKey = k; segs = null;
    const q = o.card.media_type === 'tv' ? `s=${T.s}&e=${T.e}&` : '';
    fetch(`/api/segments/${o.card.media_type}/${o.card.id}?${q}dur=${Math.round(T.dur)}`).then((r) => (r.ok ? r.json() : null)).then((d) => { if (segKey === k) segs = d?.reliable === false ? null : d; }).catch(() => {});
  };
  const updateSkip = () => {
    if (!segs || !T.real || !canSeek()) return hideSkip();
    const t = T.time; let hit = null;
    for (const [kind, label] of [['recap', 'Skip recap'], ['intro', 'Skip intro']]) for (const g of segs[kind] || []) { const end = g.end ?? null; if (end != null && t >= g.start && t < end - 2) hit = { label, end }; }
    if (!hit) return hideSkip();
    skipAt = hit.end; skipBtn.textContent = hit.label; skipBtn.hidden = false;
  };
  const creditsAt = () => { const cr = (segs?.credits || []).find((g) => g.end == null || g.end >= T.dur - 90); return cr && cr.start > T.dur * 0.6 ? cr.start : null; };

  // ---- Up next countdown + Still watching? ----
  const up = $('.upnext', el); let upState = null; // { n, mode, timer }
  const nextOf = () => (tv && T ? nextEpisode(o.card, T.s, T.e) : null);
  const hideUp = () => { if (upState?.timer) clearInterval(upState.timer); upState = null; up.hidden = true; up.innerHTML = ''; };
  const playNext = (n, auto) => {
    AutoRun.set(auto ? AutoRun.get() + 1 : 0); hideUp(); T?.finish();
    history.replaceState(history.state, '', watchHref(o.card, n.s, n.e)); render();
  };
  const reallyClose = () => (location.pathname.startsWith('/watch/') ? (history.length > 1 ? history.back() : go('/')) : closePlayer());
  const showStill = (n) => {
    sendCmd('pause'); upState = { n, mode: 'still' }; up.hidden = false; up.className = 'upnext still';
    up.innerHTML = `<div class="un-box" role="alertdialog" aria-label="Are you still watching?"><h3>Are you still watching <em>${esc(o.title)}</em>?</h3><p>We’ve played ${STILL_AFTER} episodes in a row without hearing from you.</p><div class="un-btns"><button class="btn glow sm" data-un="go">Continue watching</button><button class="btn ghost sm" data-un="stop">Back to browsing</button></div></div>`;
    $('[data-un="go"]', up).onclick = () => playNext(n, false); $('[data-un="stop"]', up).onclick = () => { hideUp(); reallyClose(); };
    $('[data-un="go"]', up).focus();
  };
  const showUp = (mode) => {
    if (upState) return; const n = nextOf(); if (!n) return false;
    if (mode !== 'close' && AutoRun.get() >= STILL_AFTER) { showStill(n); return true; }
    let left = UPNEXT_SECS; upState = { n, mode }; up.hidden = false; up.className = 'upnext';
    up.innerHTML = `<div class="un-box" role="alertdialog" aria-label="Next episode"><div class="un-th"><span class="un-n">${left}</span></div><div class="un-txt"><small>Next episode in <b class="un-s">${left}</b>s</small><h3>S${n.s}:E${n.e}<span class="un-name"></span></h3><div class="un-btns"><button class="btn glow sm" data-un="go">${ICON.play} Play now</button><button class="btn ghost sm" data-un="stop">${mode === 'close' ? 'Close' : 'Cancel'}</button></div></div></div>`;
    api(`/api/tv/${o.card.id}/season/${n.s}`).then((sd) => { const ep = sd.episodes?.find((x) => x.episode_number === n.e); if (!ep || upState?.n !== n) return; $('.un-name', up).textContent = ` · ${ep.name}`; if (ep.still) $('.un-th', up).style.backgroundImage = `url("${ep.still}")`; }).catch(() => {});
    $('[data-un="go"]', up).onclick = () => playNext(n, false);
    $('[data-un="stop"]', up).onclick = () => { AutoRun.set(0); const m = upState?.mode; hideUp(); if (m === 'close') reallyClose(); };
    upState.timer = setInterval(() => { left--; $$('.un-n,.un-s', up).forEach((x) => (x.textContent = left)); if (left <= 0) playNext(n, true); }, 1000);
    return true;
  };
  let upDone = ''; // episode key the countdown already ran for (Cancel = don't nag again for that episode)
  if (T && o.card) T.onUpdate = (m) => {
    if (m.type === 'nextepisode') { hideUp(); hideSkip(); upDone = ''; history.replaceState(history.state, '', watchHref(o.card, T.s, T.e)); return; }
    if (/^(pause|seeking|seeked|volumechange|ratechange)$/.test(m.type) && T.dur && T.time < T.dur - 30) AutoRun.set(0);
    if (T.real && T.dur > 60) loadSegs();
    updateSkip();
    const k = `${T.s}:${T.e}`;
    if (tv && T.real && T.dur > 120 && upDone !== k) {
      const ca = creditsAt(); const left = T.dur - T.time;
      if (m.type === 'ended' || (ca != null && T.time >= ca) || left <= 20) { if (showUp('end')) upDone = k; }
    }
  };
  // Interacting with our player UI (not the countdown itself) counts as "still here".
  el.addEventListener('pointerdown', (e) => { if (!e.target.closest('.upnext')) AutoRun.set(0); });
  el.addEventListener('keydown', () => AutoRun.set(0));

  // Close: players with no events (e.g. Vidcore) get the Up next countdown when closed near the end of an episode.
  $('.back', el).onclick = () => {
    if (upState) { hideUp(); return reallyClose(); }
    if (tv && T && !T.real && T.runtime() && T.approx >= T.runtime() * 60 * 0.8 && showUp('close')) return;
    reallyClose();
  };
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
  [/^\/(?:settings\/)?profiles$/, () => PROF.renderManage(main, new URLSearchParams(location.search)), 'settings'],
  [/^\/settings\/(history|appearance|subtitles|player|preferences|account|connections|tv|profiles|profile)$/, (m) => renderSettings(main, settingsCtx(), m[1]), 'settings'],
  [/^\/title\/(movie|tv)\/(\d+)$/, (m) => viewTitle(m[1], m[2]), null],
  [/^\/person\/(\d+)$/, (m) => viewPerson(m[1]), 'search'],
  [/^\/collection\/(\d+)$/, (m) => viewCollection(m[1]), 'movies'],
  [/^\/coming-soon$/, () => viewComingSoon(), 'movies'],
  [/^\/friends$/, () => COMM.viewFriends(), 'friends'],
  [/^\/my-reports$/, () => COMM.viewMyReports(), 'settings'],
  [/^\/promote$/, () => PROMO.viewPromote(), 'promote'],
  [/^\/shared\/(\d{1,12})$/, (m) => FLAIR.viewShared(m[1]), 'friends'],
  [/^\/u\/([a-z0-9]{10})$/, (m) => COMM.viewPublic(m[1]).then(() => FLAIR.publicPage(m[1])), null],
  [/^\/request$/, () => { const q = new URLSearchParams(location.search).get('q') || ''; history.replaceState({}, '', '/'); render(); setTimeout(() => COMM.openRequest(q), 300); }, 'home'],
];
let lastPage = null;
// After closing the player the page underneath isn't re-rendered, so refresh its Resume buttons/progress bars.
function refreshResume() {
  $$('.hero[data-key]', main).forEach((h) => {
    const c = CARDS.get(h.dataset.key); if (!c) return;
    const t = document.createElement('div'); t.innerHTML = heroHTML(c, { detail: h.classList.contains('detail-hero') });
    const n = t.firstElementChild; $('.btn.cta', h)?.replaceWith($('.btn.cta', n)); $('.resume-bar', h)?.remove();
    const bar = $('.resume-bar', n); if (bar) $('.btns', h)?.after(bar);
  });
  $$('[data-cont] .card[data-key], #continue ~ .grid .card[data-key]', main).forEach((el) => {
    const c = Continue.all().find((x) => keyOf(x) === el.dataset.key); if (!c) return;
    const t = document.createElement('div'); t.innerHTML = cardHTML(c, contOpts(c)); el.replaceWith(t.firstElementChild);
  });
}
async function render() {
  const path = location.pathname.replace(/\/+$/, '') || '/';
  const w = path.match(/^\/watch\/(movie|tv)\/(\d+)$/);
  if (w) {
    const q = new URLSearchParams(location.search);
    if (!lastPage) { lastPage = `/title/${w[1]}/${w[2]}`; await routeTo(lastPage); }
    try { await viewWatch(w[1], w[2], q.get('s'), q.get('e'), q.get('r')); } catch (e) { toast(e.message); if (e.status === 403) history.replaceState({}, '', lastPage || '/'); }
    return;
  }
  closePlayer();
  if (lastPage === path + location.search && main.innerHTML) return refreshResume(); // returning from player
  lastPage = path + location.search;
  await routeTo(path);
}
async function routeTo(path) {
  clearInterval(heroTimer); if (!path.startsWith('/party/')) leaveParty();
  document.title = 'GhostFlix — your new movie night';
  if (Profiles.kidsAge() != null && /^\/(live|party)(\/|$)/.test(path)) return errorView(Object.assign(new Error(path.startsWith('/live') ? 'Live TV isn’t available on kids profiles.' : 'Watch parties aren’t available on kids profiles.'), { status: 403 }));
  for (const [re, fn, nav] of routes) {
    const m = path.match(re);
    if (m) {
      const n = typeof nav === 'function' ? nav(m) : nav;
      $$('[data-nav]').forEach((a) => a.classList.toggle('on', a.dataset.nav === n));
      window.scrollTo({ top: 0, behavior: 'instant' });
      try { await fn(m); } catch (e) { errorView(e); }
      trackPv(path);
      return;
    }
  }
  errorView(Object.assign(new Error('That page drifted into the ether.'), { status: 404 }));
}
function go(url) { history.pushState({}, '', url); render(); }
// "My profile": the active viewer profile's public page (/u/<slug>) if it's switched on, otherwise where it's set up (/profile).
async function openMyProfile() {
  let slug = null;
  if (AUTH?.user && COMM?.feat('publicProfiles')) { try { const p = await COMM.call(`/api/me/public/${encodeURIComponent(Profiles.active().id)}`); if (p.enabled && p.slug) slug = p.slug; } catch {} }
  go(slug ? `/u/${slug}` : '/profile');
}

document.addEventListener('click', (e) => {
  const lb = e.target.closest('[data-list]');
  if (lb) {
    e.preventDefault(); e.stopPropagation();
    const c = CARDS.get(lb.dataset.list); if (!c) return;
    const on = List.toggle(c);
    $$(`[data-list="${lb.dataset.list}"]`).forEach((b) => { b.innerHTML = on ? ICON.check : ICON.plus; b.classList.toggle('on', on); });
    return;
  }
  const rt = e.target.closest('[data-rate]');
  if (rt) {
    e.preventDefault(); e.stopPropagation();
    const c = CARDS.get(rt.dataset.rate); if (!c) return;
    const v = Ratings.set(c, +rt.dataset.v);
    $$(`[data-rate="${rt.dataset.rate}"]`).forEach((b) => { const on = +b.dataset.v === v; b.classList.toggle('on', on); b.setAttribute('aria-pressed', String(on)); });
    toast(v === 2 ? 'Loved — we’ll recommend more like this' : v === 1 ? 'Thanks — we’ll find more like this' : v === -1 ? 'Got it — we’ll show less like this' : 'Rating removed');
    return;
  }
  const rb = e.target.closest('[data-remind]');
  if (rb) {
    e.preventDefault(); e.stopPropagation();
    const c = CARDS.get(rb.dataset.remind) || Remind.all().find((x) => keyOf(x) === rb.dataset.remind); if (!c) return;
    const on = Remind.toggle(c, rb.dataset.date, rb.dataset.label);
    $$(`[data-remind="${rb.dataset.remind}"]`).forEach((b) => { b.classList.toggle('on', on); b.setAttribute('aria-pressed', String(on)); b.textContent = on ? '🔔 Reminder set' : '🔔 Remind me'; });
    return;
  }
  const ob = e.target.closest('[data-open-bug],[data-open-request]');
  if (ob) { e.preventDefault(); if (ob.hasAttribute('data-open-bug')) COMM?.openBug('menu'); else COMM?.openRequest(); return; }
  const mp = e.target.closest('[data-my-profile]');
  if (mp) { e.preventDefault(); mp.closest('.acct')?.classList.remove('open'); openMyProfile(); return; }
  const a = e.target.closest('a[data-link]');
  if (a && !e.metaKey && !e.ctrlKey && !e.shiftKey && a.origin === location.origin) { e.preventDefault(); go(a.pathname + a.search); }
});
window.addEventListener('popstate', render);
// Preload title pages on hover (after a short pause) or touch, so opening them is instant.
let pfT;
const pfFor = (a) => { const m = a?.pathname?.match(/^\/title\/(movie|tv)\/(\d+)$/); if (!m || a.origin !== location.origin) return; prefetch(`/api/title/${m[1]}/${m[2]}?region=${region()}`).then((d) => { if (d?.backdrop) new Image().src = d.backdrop; }).catch(() => {}); };
document.addEventListener('pointerover', (e) => { if (e.pointerType !== 'mouse') return; const a = e.target.closest?.('a[href^="/title/"]'); clearTimeout(pfT); if (a) pfT = setTimeout(() => pfFor(a), 120); }, { passive: true });
document.addEventListener('touchstart', (e) => pfFor(e.target.closest?.('a[href^="/title/"]')), { passive: true });
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
  if (open) { $('#drawerX').focus(); COMM?.refreshMe(); fetch('/api/admin/me').then((r) => r.json()).then((d) => ($('#adminLink').hidden = !d.admin)).catch(() => {}); }
}
burger.onclick = () => setDrawer(true); $('#drawerX').onclick = () => setDrawer(false); scrim.onclick = () => setDrawer(false);
drawerEl.addEventListener('click', (e) => { if (e.target.closest('a,[data-signin],[data-signout]')) setDrawer(false); });
document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && drawerEl.classList.contains('open')) setDrawer(false); });

// ---- installable app (PWA) ----
if ('serviceWorker' in navigator) window.addEventListener('load', () => navigator.serviceWorker.register('/sw.js?v=20261023zr').catch(() => {}));
const installEl = $('#drawerInstall');
const standalone = () => matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
// Installed app: Android keeps it alive in the background and this single-page app never does a full page load, so a new
// deploy only arrived once the app was killed. When the app comes back to the foreground, check the live build and reload if it changed.
const BUILD = new URL(import.meta.url).searchParams.get('v'); let buildChk = 0;
document.addEventListener('visibilitychange', async () => {
  if (document.visibilityState !== 'visible' || !standalone() || !BUILD || Date.now() - buildChk < 60e3) return; buildChk = Date.now();
  try {
    const live = (await (await fetch('/', { cache: 'no-store' })).text()).match(/\/app\.js\?v=([\w.-]+)/)?.[1];
    if (live && live !== BUILD && !$('.player') && !document.fullscreenElement) location.reload();
  } catch {}
});
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
  PROMO.captureRef(); // ?ref=CODE promoter links
  try { SITE = await api('/api/site-config'); } catch {} applySite();
  // Stage F: admin-scheduled theme applies unless this viewer picked a seasonal look themselves; the switch can turn themes off.
  { const st = Settings.get(); if (SITE.features?.themes === false) applySettings({ ...st, season: 'normal' }); else if (SITE.theme?.name && !st.seasonPicked) applySettings({ ...st, season: SITE.theme.name }); }
  try { CONFIG = await api('/api/config'); GENRES = await api('/api/genres'); } catch {} document.querySelectorAll('[data-feature=parties]').forEach((el) => (el.hidden = !CONFIG.parties));
  AUTH = createAuth({ config: CONFIG, list: MainList, history: MainHistory, toast, onChange: () => { if (/^\/(my-list|settings.*)?$/.test(location.pathname)) { lastPage = null; render(); } } });
  AUTH.subscribe(() => { if (/^\/(settings|profile$)/.test(location.pathname)) { lastPage = null; render(); } });
  PROF = createProfiles({ auth: AUTH, toast, onSwitch: () => {
    PREF.clear(); lastPage = null; PUSH.sync(); PUSH.refresh();
    if (Profiles.kidsAge() != null && /^\/(live|party|profiles|settings\/profiles)(\/|$)/.test(location.pathname)) history.replaceState({}, '', '/');
    render();
  } });
  COMM = createCommunity({ api, auth: () => AUTH, toast, rowHTML, wireRows, cardHTML, remember, keyOf, genreName, profiles: Profiles, list: () => List.all(), history: () => Continue.all(), site: () => SITE, genres: () => GENRES, main, afterFriends: () => FLAIR?.friends() });
  { let was = AUTH.user?.id; AUTH.subscribe((u) => { PROMO.claim(); if (u?.id !== was) { was = u?.id; if (location.pathname === '/promote') { lastPage = null; render(); } } }); setTimeout(() => PROMO.claim(), 2000); }
  FLAIR = createFlair({ api, comm: COMM, auth: () => AUTH, toast, cardHTML, remember, genreName, profiles: Profiles, list: () => List.all(), history: () => Continue.all(), main });
  COMM.applyFeatures(); AUTH.subscribe(() => { COMM.refreshMe(); COMM.pullActivity(); PUSH.refresh(); }); setTimeout(() => { COMM.refreshMe(); COMM.pullActivity(); PUSH.refresh(); }, 1500);
  if (CONFIG.discordUrl) {
    const b = $('#dcBubble'); b.href = CONFIG.discordUrl; b.innerHTML = ICONS.DISCORD_SVG; b.hidden = false; $('#drawerDiscord').href = CONFIG.discordUrl;
  } else $('#drawerDiscord').hidden = true;
  if (CONFIG.githubUrl) { const g = $('#ghBubble'); g.href = CONFIG.githubUrl; g.hidden = false; const dg = $('#drawerGithub'); dg.href = CONFIG.githubUrl; dg.hidden = false; }
  if (CONFIG.mode === 'demo' && !sessionStorage.getItem('gf.nb')) {
    $('#banner').innerHTML = `<div class="notice"><span>👻</span><span><b>Demo catalog.</b> Showing public-domain classics from the Internet Archive. Add <code>TMDB_API_KEY</code> to unlock the full movie & series catalog.</span><button class="x" aria-label="Dismiss">×</button></div>`;
    $('#banner .x').onclick = () => { sessionStorage.setItem('gf.nb', 1); $('#banner').innerHTML = ''; };
  }
  render();
  const due = Remind.due();
  if (due.length) setTimeout(() => toast(due.length === 1 ? `🔔 “${due[0].title}” is out now` : `🔔 ${due.length} reminders are out now: ${due.slice(0, 3).map((x) => x.title).join(', ')}`), 1200);
})();

// Admin link in the menu: only visible when this browser is logged in as admin.
fetch('/api/admin/me', { credentials: 'same-origin', cache: 'no-store' }).then((r) => r.json()).then((d) => { const a = document.getElementById('adminLink'); if (a && d.admin) a.hidden = false; }).catch(() => {});

// ---- first-party stats (no third-party trackers). Skipped entirely with Do Not Track / Global Privacy Control.
// The server turns each request into an anonymous daily visitor hash; we never send IDs from here.
const NOTRACK = navigator.globalPrivacyControl === true || navigator.doNotTrack === '1';
const isStandalone = () => matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
let firstPv = true, lastPv = '';
function track(k, x = {}) {
  if (NOTRACK) return;
  try {
    const body = JSON.stringify({ k, p: location.pathname, sa: isStandalone(), si: !!AUTH?.user, ...x });
    fetch('/api/track', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body, keepalive: true, credentials: 'omit' }).catch(() => {});
  } catch {}
}
function trackPv(path) {
  if (path === lastPv) return; lastPv = path;
  const m = path.match(/^\/title\/(movie|tv)\/(\d+)/);
  const x = m ? { t: `${m[1]}:${m[2]}`, tt: document.title.replace(/\s+[—–-]\s+GhostFlix.*$/, '') } : {};
  if (firstPv) { firstPv = false; if (document.referrer) x.r = document.referrer; }
  setTimeout(() => track('pv', x), m ? 600 : 0); // title pages: let the title load first
}
setInterval(() => { if (document.visibilityState === 'visible') track('hb'); }, 60e3);
