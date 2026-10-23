// GhostFlix server — Express app: static SPA + JSON API + password-protected admin.
import express from 'express';
import crypto from 'node:crypto';
import path from 'node:path';
import { readFileSync, existsSync } from 'node:fs';
import { TmdbCatalog } from './tmdb.js';
import { DemoCatalog } from './demo.js';
import { Store } from './store.js';
import { parseSource, playerFor, PROVIDER_LABELS, SourceError, validatePattern, fillPattern, cinesrcUrl, vidcoreUrl, isBlocked } from './sources.js';
import { toVtt } from './subtitles.js';
import { previewImport, commitImport, runJob, startScheduler } from './importers.js';
import { mountB3 } from './b3.js';
import { mountSeasonal } from './seasonal.js';
import { mountKids } from './b3-kids.js';
import { mountStats } from './b3-stats.js';
import { mountB5, activeScheduled, FEATURE_KEYS } from './b5.js';
import { mountB6 } from './b6.js';

import { fileURLToPath } from 'node:url';
const ROOT = path.resolve(fileURLToPath(new URL('..', import.meta.url)));
// Minimal .env loader (no dependency) for local dev.
if (existsSync(path.join(ROOT, '.env'))) {
  for (const line of readFileSync(path.join(ROOT, '.env'), 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/); if (m && !(m[1] in process.env)) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
}
const env = process.env;
const PORT = +env.PORT || 3000;
const demo = new DemoCatalog();
const catalog = env.TMDB_API_KEY ? new TmdbCatalog(env) : demo;
const store = await new Store(env).load();
const ctx = { store, catalog, env };

// ---- iptv-org Live TV channels -------------------------------------------------------
// Fetches and parses M3U playlists from iptv-org (US + UK), caches for 1 hour.
let IPTV_CACHE = { channels: [], expires: 0 };
async function loadIPTVChannels() {
  const now = Date.now();
  if (IPTV_CACHE.channels.length && now < IPTV_CACHE.expires) return IPTV_CACHE.channels;
  const urls = [
    'https://iptv-org.github.io/iptv/countries/us.m3u',
    'https://iptv-org.github.io/iptv/countries/gb.m3u'
  ];
  const channels = [];
  for (let i = 0; i < urls.length; i++) {
    const url = urls[i];
    const country = i === 0 ? 'US' : i === 1 ? 'GB' : 'Other';
    try {
      const res = await fetch(url);
      if (!res.ok) continue;
      const text = await res.text();
      parseM3U(text, channels, country);
    } catch {}
  }
  // Keep only channels with a valid http(s) URL and a non-empty name
  const valid = channels.filter(c => c.url && /^https?:\/\//i.test(c.url) && c.name.trim() && c.name.trim().length >= 3 && !/^\d+$/.test(c.name.trim()));
  // Remove stub/placeholder entries: short names, numeric-only names
  IPTV_CACHE = { channels: valid, expires: now + 60 * 60 * 1000 }; // 1 hour cache
  return valid;
}

function parseM3U(text, out, country) {
  const lines = text.split('\n');
  let name = '', logo = '', group = '', tvgId = '';
  for (const line of lines) {
    if (line.startsWith('#EXTINF:')) {
      const attrs = line.slice(8);
      const nameMatch = attrs.match(/,([^,]+)$/);
      if (nameMatch) name = nameMatch[1].trim();
      const logoMatch = attrs.match(/tvg-logo="([^"]*)"/);
      if (logoMatch) logo = logoMatch[1];
      const groupMatch = attrs.match(/group-title="([^"]*)"/);
      if (groupMatch) group = groupMatch[1];
      const idMatch = attrs.match(/tvg-id="([^"]*)"/);
      if (idMatch) tvgId = idMatch[1];
    } else if (line && !line.startsWith('#')) {
      const url = line.trim();
      if (url.startsWith('http') && name) {
        const cat = normalizeCategory(group);
        out.push({
          id: `iptv-${tvgId || crypto.createHash('md5').update(url).digest('hex').slice(0, 8)}`,
          name: name.trim(),
          category: cat,
          logo: logo || '',
          url,
          official: '',
          custom: false,
          iptv: true,
          country: country || 'Other' 
        });
      }
      name = logo = group = tvgId = '';
    }
  }
}

function normalizeCategory(g) {
  const map = {
    'news': 'News', 'sports': 'Sports', 'movies': 'Movies', 'music': 'Music',
    'kids': 'Kids', 'documentary': 'Documentary', 'entertainment': 'Entertainment',
    'lifestyle': 'Lifestyle', 'general': 'General', 'religious': 'Religious',
    'shop': 'Shopping', 'business': 'Business', 'weather': 'Weather',
    'animation': 'Animation', 'classic': 'Classic', 'auto': 'Auto',
    'cooking': 'Cooking', 'travel': 'Travel', 'culture': 'Culture',
    'education': 'Education', 'science': 'Science', 'game': 'Gaming',
    'relax': 'Relax', 'nature': 'Nature', 'outdoor': 'Outdoor'
  };
  const key = (g || '').toLowerCase().split(';')[0].trim();
  return map[key] || (key ? key.charAt(0).toUpperCase() + key.slice(1) : 'Other');
}

const app = express();
app.disable('x-powered-by');
app.set('trust proxy', 1);
app.use(express.json({ limit: '8mb' }));

// Security headers. frame-src allows any http(s) player, so any host can be embedded.
// Public Supabase Auth config (URL + publishable/anon key are designed to be public; RLS protects data).
const AUTH = env.SUPABASE_PUBLIC_URL && env.SUPABASE_ANON_KEY ? {
  url: env.SUPABASE_PUBLIC_URL.replace(/\/$/, ''), key: env.SUPABASE_ANON_KEY,
  google: env.AUTH_GOOGLE !== 'false', discord: env.AUTH_DISCORD !== 'false',
} : null;
const DISCORD_URL = env.DISCORD_INVITE_URL || 'https://discord.gg/PZnVDsYGsC'; // GhostGames community server
const authOrigin = AUTH ? new URL(AUTH.url).origin : '';
app.use((req, res, next) => {
  res.setHeader('Content-Security-Policy', [
    "default-src 'self'", "script-src 'self'", "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
    "font-src 'self' https://fonts.gstatic.com", "img-src 'self' data: https:", // https: so Live TV channel logos (imgur, wikimedia, pluto, plex…) load
    // Any http(s) player may be framed — no host restrictions.
    "media-src 'self' blob: https: http:", `connect-src 'self' https: http:${authOrigin ? ` ${authOrigin.replace('https://', 'wss://')}` : ''}`,
    'frame-src https: http:', "object-src 'none'", "base-uri 'self'", "frame-ancestors 'self'",
  ].join('; '));
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  next();
});

// ---- site config (admin-controlled: announcement, hero, sections, maintenance) ---------
const SECTION_KEYS = ['discover', 'live', 'mylist'];
const siteCfg = () => {
  const d = store.data.site || {};
  return {
    announcement: { on: !!d.announcement?.on, text: String(d.announcement?.text || ''), color: d.announcement?.color || '#5fe3ff' },
    hero: d.hero?.id ? { type: d.hero.type, id: d.hero.id, title: d.hero.title || '' } : null,
    sections: Object.fromEntries(SECTION_KEYS.map((k) => [k, d.sections?.[k] !== false])),
    rows: { ...(d.rows || {}) },
    maintenance: !!d.maintenance,
    // Stage F: scheduled banner (overrides the manual announcement while active), scheduled theme, feature switches.
    ...(() => {
      const b = activeScheduled(d.schedule, 'banner'), t = activeScheduled(d.schedule, 'theme');
      const features = Object.fromEntries(FEATURE_KEYS.map(([k]) => [k, k === 'live' ? d.sections?.live !== false : d.features?.[k] !== false]));
      return { ...(b ? { announcement: { on: true, text: b.text, color: b.color, until: b.end, scheduled: true } } : {}), theme: features.themes && t ? { name: t.theme, until: t.end } : null, features };
    })(),
  };
};
// Stage F (47): titles hidden site-wide by the admin disappear from every catalog response (cards pruned; title/play pages 404).
const HIDDEN = () => { const h = store.data.content?.hidden; if (!h?.length) return null; if (HIDDEN.src !== h) { HIDDEN.src = h; HIDDEN.set = new Set(h.map((x) => x.key)); } return HIDDEN.set; };
const isCardObj = (x) => x && typeof x === 'object' && !Array.isArray(x) && (x.media_type === 'movie' || x.media_type === 'tv') && Number.isFinite(+x.id) && x.id !== '';
function pruneHidden(o, set, depth = 0) {
  if (!o || typeof o !== 'object' || depth > 6) return o;
  if (Array.isArray(o)) return o.filter((x) => !isCardObj(x) || !set.has(`${x.media_type}:${x.id}`)).map((x) => pruneHidden(x, set, depth + 1));
  for (const [k, v] of Object.entries(o)) if (v && typeof v === 'object') o[k] = pruneHidden(v, set, depth + 1);
  return o;
}
const MAINT_HTML = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>GhostFlix — back soon</title><meta name="robots" content="noindex"><link rel="icon" href="/favicon.svg" type="image/svg+xml"><link rel="stylesheet" href="/app.css"></head>
<body><div class="bg" aria-hidden="true"></div><main class="maint"><img src="/img/logo.svg" alt="" width="84" height="84"><h1>GHOST<em>FLIX</em> is getting a tune-up</h1><p>We’re doing a bit of maintenance and will be back soon. Thanks for your patience!</p></main></body></html>`;
app.use((req, res, next) => {
  if (!store.data.site?.maintenance || isAdmin(req)) return next();
  const p = req.path;
  if (p.startsWith('/api/admin') || p === '/admin' || p === '/admin.html' || p === '/api/site-config' || p === '/api/config' || p === '/healthz' || p === '/health' || p.startsWith('/vendor/') || /\.[a-z0-9]{2,5}$/i.test(p)) return next();
  res.setHeader('Cache-Control', 'no-store'); res.setHeader('Retry-After', '3600');
  if (p.startsWith('/api/')) return res.status(503).json({ error: 'GhostFlix is in maintenance mode. Back soon!', maintenance: true });
  res.status(503).type('html').send(MAINT_HTML);
});

const wrap = (fn) => (req, res) => Promise.resolve(fn(req, res)).catch((e) => {
  const status = e.status || 500; if (status >= 500) console.error(e);
  res.status(status).json({ error: e.message || 'Server error' });
});
const T = (t) => { if (t !== 'movie' && t !== 'tv' && t !== 'all') { const e = new Error('Bad type'); e.status = 400; throw e; } return t; };
const ID = (v) => { const n = parseInt(v, 10); if (!(n > 0)) { const e = new Error('Bad id'); e.status = 400; throw e; } return n; };
const cacheFor = (res, s) => res.setHeader('Cache-Control', `public, max-age=${s}`);
const patternFor = (type) => store.data.patterns?.[type] || '';
const withPlayable = (c) => (c ? { ...c, playable: catalog.mode === 'demo' ? (!!c.demo || store.hasAnyFor(c.media_type, c.id) || !!patternFor(c.media_type)) : true } : c);
const markList = (d) => ({ ...d, results: d.results.map(withPlayable) });
const KIDS = mountKids(app, { env, wrap, cacheFor, catalog }); // kids-profile filter: must come before the catalog routes
app.use('/api', (req, res, next) => {
  const set = HIDDEN(); if (!set || req.method !== 'GET' || /^\/api\/(admin|mod|site-config|config|stats|push|track|me|friends|chat|u\/)/.test(req.originalUrl) || isAdmin(req)) return next();
  const m = req.originalUrl.match(/^\/api\/(?:title|play|tv)\/(movie|tv)?\/?(\d+)/);
  const key = m ? `${m[1] || 'tv'}:${m[2]}` : null;
  if (key && set.has(key)) return res.status(404).json({ error: 'This title isn’t available on GhostFlix.' });
  const json = res.json.bind(res);
  res.json = (body) => json(res.statusCode < 400 && body && typeof body === 'object' ? pruneHidden(body, set) : body);
  next();
});
mountSeasonal(app, { wrap, cacheFor, catalog, mark: withPlayable }); // Halloween Horror Picks (home row while the Halloween look is on)

// ---- public API ---------------------------------------------------------------
app.get('/api/config', (req, res) => res.json({ mode: catalog.mode, hasTmdbKey: !!env.TMDB_API_KEY, adminEnabled: !!env.ADMIN_PASSWORD, region: env.TMDB_REGION || 'US',
  auth: AUTH, discordUrl: DISCORD_URL, githubUrl: env.GITHUB_URL || 'https://github.com/GhostFaceModz/GhostFlix', parties: env.ENABLE_WATCH_PARTIES === '1' }));
app.get('/api/site-config', (req, res) => { res.setHeader('Cache-Control', 'no-store'); const c = siteCfg(); res.json({ ...c, admin: isAdmin(req) }); });
app.get('/api/home', wrap(async (req, res) => {
  const d = await catalog.home();
  const free = catalog.mode === 'demo' ? [] : store.playableCards();
  // Build resume positions from store
  let positions = {};
  if (store.data.watchPositions) {
    for (const [key, pos] of Object.entries(store.data.watchPositions)) {
      const [t, id] = key.split(':', 2);
      positions[t] = positions[t] || {};
      positions[t][id] = Math.round(pos * 100) / 100; // seconds
    }
  }
  d.resumePositions = positions;
  if (free.length) d.rows.splice(1, 0, { id: 'free', title: 'Free to watch on GhostFlix', link: '/browse/free/all', items: free.slice(0, 30) });
  d.rows.forEach((r) => (r.items = r.items.map(withPlayable)));
  d.hero = d.hero.map(withPlayable);
  const site = siteCfg();
  d.rows = d.rows.filter((r) => site.rows[r.id] !== false);
  if (site.hero) { try { const h = withPlayable({ ...(await catalog.title(site.hero.type, site.hero.id)), media_type: site.hero.type }); d.hero = [h, ...d.hero.filter((x) => !(x.id === h.id && x.media_type === h.media_type))]; } catch {} }
  // Stage F (47): pinned/featured titles — 'hero' goes first in the hero, 'featured' builds a row at the top, any other row id goes to the front of that row.
  const pins = store.data.content?.pins || [];
  if (pins.length && catalog.mode !== 'demo') {
    const cardsOf = await Promise.all(pins.map(async (p) => { const [t, id] = p.key.split(':'); try { const x = await catalog.title(t, +id); return { p, c: withPlayable({ id: x.id, media_type: t, title: x.title, year: x.year, overview: x.overview, poster: x.poster, backdrop: x.backdrop, backdrop_sm: x.backdrop_sm, rating: x.rating, genre_ids: x.genre_ids, pinned: true }) }; } catch { return null; } }));
    const same = (a, b) => a.id === b.id && a.media_type === b.media_type;
    const feat = [];
    for (const z of cardsOf.filter(Boolean).reverse()) {
      if (z.p.row === 'hero') d.hero = [z.c, ...d.hero.filter((x) => !same(x, z.c))];
      else if (z.p.row === 'featured') feat.unshift(z.c);
      else { const r = d.rows.find((x) => x.id === z.p.row); if (r) r.items = [z.c, ...r.items.filter((x) => !same(x, z.c))]; }
    }
    if (feat.length) d.rows.unshift({ id: 'featured', title: 'Featured on GhostFlix', items: feat });
  }
  cacheFor(res, 60); res.json(d);
}));
app.get('/api/discover', wrap(async (req, res) => {
  const d = await catalog.discoverPage();
  d.top10 = d.top10.map(withPlayable); [...d.rows, ...d.moods].forEach((r) => (r.items = r.items.map(withPlayable)));
  cacheFor(res, 120); res.json(d);
}));
const CURATED = JSON.parse(readFileSync(path.join(ROOT, 'data/live-channels.json'), 'utf8')).channels;
// Live TV is served in pages per group (Featured / country) and category, so the browser never
// downloads ~1,500 channels at once. The resolved list is memoised until the iptv-org cache or the
// admin channel list changes. GET /api/live without ?limit still returns everything (old clients).
const LIVE_GROUPS = { featured: 'Featured', GB: 'UK', US: 'USA' };
let LIVE_MEMO = { all: [] };
async function liveChannels() {
  const iptv = await loadIPTVChannels();
  const custom = store.data.channels || [];
  if (LIVE_MEMO.iptv === iptv && LIVE_MEMO.custom === custom && LIVE_MEMO.n === custom.length) return LIVE_MEMO.all;
  const all = [];
  for (const c of [...CURATED, ...custom, ...iptv]) {
    try { const p = playerFor(parseSource(c.url, env), env); all.push({ id: c.id, name: c.name, category: c.category || 'Other', logo: c.logo || '', official: c.official || c.url, custom: !!c.custom, player: p, iptv: !!c.iptv, country: c.country || 'Other', group: c.iptv ? (c.country || 'Other') : 'featured' }); } catch {}
  }
  LIVE_MEMO = { iptv, custom, n: custom.length, all };
  return all;
}
app.get('/api/live', async (req, res) => {
  const all = await liveChannels();
  if (req.query.limit === undefined) {
    const iptv = all.filter((c) => c.iptv);
    return res.json({ channels: all, countries: [...new Set(iptv.map((c) => c.country))], categories: [...new Set(iptv.map((c) => c.category))] });
  }
  const groups = Object.entries(LIVE_GROUPS).map(([id, name]) => ({ id, name, count: all.filter((c) => c.group === id).length })).filter((g) => g.count);
  const group = groups.some((g) => g.id === req.query.group) ? req.query.group : groups[0]?.id;
  const inGroup = all.filter((c) => c.group === group);
  const counts = {}; for (const c of inGroup) counts[c.category] = (counts[c.category] || 0) + 1;
  const categories = Object.entries(counts).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(([name, count]) => ({ name, count }));
  const cat = String(req.query.cat || 'All');
  const list = cat === 'All' ? inGroup : inGroup.filter((c) => c.category === cat);
  const offset = Math.max(0, +req.query.offset || 0), limit = Math.min(100, Math.max(1, +req.query.limit || 40));
  cacheFor(res, 300);
  res.json({ group, groups, categories, cat, total: list.length, offset, channels: list.slice(offset, offset + limit).map(({ group: _g, ...c }) => c) });
});
app.get('/api/genres', wrap(async (req, res) => { cacheFor(res, 3600); res.json(await catalog.genres()); }));
app.get('/api/list/:type/:category', wrap(async (req, res) => {
  if (req.params.type === 'free') { const all = catalog.mode === 'demo' ? (await demo.list('all', 'trending', req.query.page)).results : store.playableCards(); return res.json({ page: 1, total_pages: 1, results: all.map(withPlayable) }); }
  res.json(markList(await catalog.list(T(req.params.type), String(req.params.category), +req.query.page || 1)));
}));
const SORTS = ['popular', 'top_rated', 'newest'];
app.get('/api/discover/:type/:genre', wrap(async (req, res) => res.json(markList(await catalog.discover(T(req.params.type), ID(req.params.genre), +req.query.page || 1, SORTS.includes(req.query.sort) ? req.query.sort : 'popular')))));
app.get('/api/genre-tiles/:type', wrap(async (req, res) => {
  const type = T(req.params.type);
  const tiles = catalog.genreTiles ? await catalog.genreTiles(type) : ((await catalog.genres())[type] || []).map((g) => ({ id: g.id, name: g.name, backdrop: null }));
  cacheFor(res, 3600); res.json({ type, tiles });
}));
app.get('/api/search/people', wrap(async (req, res) => {
  const q = String(req.query.q || '').trim().slice(0, 100);
  cacheFor(res, 300); res.json({ results: q && catalog.searchPeople ? await catalog.searchPeople(q) : [] });
}));
app.get('/api/person/:id', wrap(async (req, res) => {
  if (!catalog.person) { const e = new Error('People need the TMDB catalog'); e.status = 404; throw e; }
  const d = await catalog.person(ID(req.params.id)); d.credits = d.credits.map(withPlayable);
  cacheFor(res, 600); res.json(d);
}));
app.get('/api/search', wrap(async (req, res) => {
  const q = String(req.query.q || '').trim().slice(0, 100);
  res.json(q ? markList(await catalog.search(q, +req.query.page || 1)) : { page: 1, total_pages: 0, results: [] });
}));
app.get('/api/title/:type/:id', wrap(async (req, res) => {
  const type = T(req.params.type), id = ID(req.params.id);
  const d = await catalog.title(type, id, String(req.query.region || env.TMDB_REGION || 'US').toUpperCase().slice(0, 2));
  const own = store.sourcesFor(Store.key(type, id));
  const episodes = Object.keys(store.data.sources).filter((k) => k.startsWith(`${type}:${id}:`)).map((k) => k.split(':')[2]);
  d.playable = (catalog.mode === 'demo' && demo.demoSources(type, id, 1, 1).length > 0) || own.length > 0 || episodes.length > 0 || !!patternFor(type);
  d.playableEpisodes = episodes; d.recommendations = (d.recommendations || []).map(withPlayable);
  cacheFor(res, 60); res.json(d);
}));
app.get('/api/tv/:id/season/:n', wrap(async (req, res) => {
  const id = ID(req.params.id), n = parseInt(req.params.n, 10);
  const s = await catalog.season(id, n);
  s.episodes = s.episodes.map((e) => ({ ...e, playable: (catalog.mode === 'demo' && demo.demoSources('tv', id, n, e.episode_number).length > 0) || store.sourcesFor(Store.key('tv', id, n, e.episode_number)).length > 0 || !!patternFor('tv') }));
  res.json(s);
}));
app.get('/api/play/:type/:id', wrap(async (req, res) => {
  const type = T(req.params.type), id = ID(req.params.id);
  const s = req.query.s, e = req.query.e;
  let list = type === 'tv' && s != null && e != null ? store.sourcesFor(Store.key(type, id, s, e)) : store.sourcesFor(Store.key(type, id));
  if (!list.length && type === 'tv' && s != null) list = store.sourcesFor(Store.key(type, id)); // whole-series source
  if (!list.length && catalog.mode === 'demo') list = demo.demoSources(type, id, s, e);
  if (!list.length && patternFor(type)) {
    // Owner's link pattern — only used when the title has no specific source. Re-validated against the denylist.
    try { list = [{ ...parseSource(fillPattern(patternFor(type), { tmdb_id: id, season: s ?? 1, episode: e ?? 1 }), env), label: 'Pattern', origin: 'pattern' }]; } catch {}
  }
  if (!list.length) {
      // Built-in catch-all: CineSrc (cinesrc.st) — free, no key, covers movies + series.
      try { list = [{ ...parseSource(cinesrcUrl(type, id, s, e), env), label: 'CineSrc', origin: 'cinesrc' }]; } catch {}
      // Offer the existing Vidcore backup as a second choice so the player's source switcher has somewhere to go.
      if (list.length) try { list.push({ ...parseSource(vidcoreUrl(type, id, s, e), env), label: 'Vidcore', origin: 'vidcore' }); } catch {}
    }
    if (!list.length) {
      // Second backup: Vidcore (vidcore.org) — free, no key, clean iframe to edgeone.dev.
      try { list = [{ ...parseSource(vidcoreUrl(type, id, s, e), env), label: 'Vidcore', origin: 'vidcore' }]; } catch {}
    }
  const sources = [];
  for (const src of list) { try { sources.push({ ...playerFor(src, env), provider: src.provider, providerName: PROVIDER_LABELS[src.provider], label: src.label || '' }); } catch {} }
  let trailer = null, meta = null;
  try { meta = await catalog.title(type, id); trailer = meta.trailers?.[0] || null; } catch {}
  const subKey = type === 'tv' && s != null && e != null ? Store.key(type, id, s, e) : Store.key(type, id);
  const subtitles = (store.data.subs?.[subKey] || []).map((t) => ({ url: `/api/subs/${t.sid}.vtt`, lang: t.lang, label: t.label }));
  res.json({ type, id, season: s ?? null, episode: e ?? null, subtitles, title: meta?.title || '', poster: meta?.poster, backdrop: meta?.backdrop_sm || meta?.backdrop, year: meta?.year,
    sources, trailer: trailer ? { ...trailer, src: `https://www.youtube-nocookie.com/embed/${trailer.key}?autoplay=1&rel=0&modestbranding=1&playsinline=1` } : null,
    providers: meta?.providers || null });
}));

// ---- admin auth -----------------------------------------------------------------
// ADMIN_PASSWORD_SHA256 (hex sha256 of the password) can be used instead of ADMIN_PASSWORD.
const ADMIN_HASH = (env.ADMIN_PASSWORD_SHA256 || (env.ADMIN_PASSWORD ? crypto.createHash('sha256').update(env.ADMIN_PASSWORD).digest('hex') : '')).trim().toLowerCase();
if (ADMIN_HASH) env.ADMIN_PASSWORD = env.ADMIN_PASSWORD || 'hash-configured';
const SECRET = crypto.createHash('sha256').update(`${env.SESSION_SECRET || ''}|${ADMIN_HASH}|ghostflix`).digest();
const sign = (exp) => `${exp}.${crypto.createHmac('sha256', SECRET).update(String(exp)).digest('hex')}`;
const cookieOf = (req, name) => (req.headers.cookie || '').split(/;\s*/).map((c) => c.split('=')).find(([k]) => k === name)?.[1];
function isAdmin(req) {
  if (!env.ADMIN_PASSWORD) return false;
  const tok = decodeURIComponent(cookieOf(req, 'gf_admin') || ''); const [exp] = tok.split('.');
  if (!exp || +exp < Date.now()) return false;
  const good = sign(exp);
  return tok.length === good.length && crypto.timingSafeEqual(Buffer.from(tok), Buffer.from(good));
}
const attempts = new Map();
app.post('/api/admin/login', (req, res) => {
  if (!env.ADMIN_PASSWORD) return res.status(503).json({ error: 'Admin is disabled. Set the ADMIN_PASSWORD environment variable.' });
  const ip = req.ip; const a = attempts.get(ip) || { n: 0, t: Date.now() };
  if (Date.now() - a.t > 15 * 60e3) { a.n = 0; a.t = Date.now(); }
  if (a.n >= 10) return res.status(429).json({ error: 'Too many attempts. Try again in 15 minutes.' });
  const pw = String(req.body?.password || '');
  const ok = crypto.timingSafeEqual(Buffer.from(crypto.createHash('sha256').update(pw).digest('hex')), Buffer.from(ADMIN_HASH.padEnd(64, '0').slice(0, 64)));
  if (!ok) { a.n++; attempts.set(ip, a); return res.status(401).json({ error: 'Wrong password.' }); }
  attempts.delete(ip);
  const exp = Date.now() + 7 * 864e5;
  res.setHeader('Set-Cookie', `gf_admin=${encodeURIComponent(sign(exp))}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${7 * 86400}${req.secure ? '; Secure' : ''}`);
  res.json({ ok: true });
});
// Discord sign-in → admin, only for the Discord account whose user ID is in ADMIN_DISCORD_ID.
app.post('/api/admin/discord', wrap(async (req, res) => {
  const tok = String(req.get('authorization') || '').replace(/^Bearer\s+/i, '');
  if (!AUTH || !env.ADMIN_DISCORD_ID || !tok) return res.json({ admin: false });
  const r = await fetch(`${AUTH.url}/auth/v1/user`, { headers: { apikey: AUTH.key, Authorization: `Bearer ${tok}` } });
  if (!r.ok) return res.json({ admin: false });
  const u = await r.json();
  const ids = String(env.ADMIN_DISCORD_ID).split(',').map((x) => x.trim()).filter(Boolean);
  const ok = (u.identities || []).some((i) => i.provider === 'discord' && ids.includes(String(i.id || i.identity_data?.provider_id || i.identity_data?.sub)));
  if (!ok) return res.json({ admin: false });
  const exp = Date.now() + 7 * 864e5;
  res.setHeader('Set-Cookie', `gf_admin=${encodeURIComponent(sign(exp))}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${7 * 86400}${req.secure ? '; Secure' : ''}`);
  res.json({ admin: true });
}));
app.get('/api/admin/me', (req, res) => { res.setHeader('Cache-Control', 'no-store'); res.json({ admin: isAdmin(req) }); });
app.post('/api/admin/logout', (req, res) => { res.setHeader('Set-Cookie', 'gf_admin=; Path=/; Max-Age=0; HttpOnly; SameSite=Strict'); res.json({ ok: true }); });
const admin = express.Router();
admin.use((req, res, next) => (isAdmin(req) ? next() : res.status(401).json({ error: 'Not signed in.' })));
app.use('/api/admin', admin);
const B3 = mountB3(app, { env, wrap, cacheFor, isAdmin, admin, store, catalog, markList });
const STATS = mountStats(app, { env, wrap, admin, catalog, store }); // first-party stats + web push (Stage D)
const B5 = mountB5(app, { env, wrap, cacheFor, isAdmin, admin, store, catalog, stats: STATS, siteCfg }); // community, admin tools, moderators (Stages E/F)
mountB6(app, { env, wrap, sb: B5.sb, needUser: B5.needUser, bannedNow: B5.bannedNow, feat: B5.feat, ROOT, catalog }); // profile flair, rank, stats, follows, shared lists, OG cards (Stage G)

admin.get('/state', (req, res) => res.json({ mode: catalog.mode, backend: store.backend, sources: store.allSources().reverse(),
  subs: Object.entries(store.data.subs || {}).flatMap(([key, list]) => list.map(({ vtt, ...t }) => ({ key, ...t, title: store.data.titles[key.split(':').slice(0, 2).join(':')]?.title || key }))), unmatched: store.data.unmatched, jobs: store.data.jobs,
  patterns: store.data.patterns || { movie: '', tv: '' }, channels: store.data.channels || [], hasYouTubeKey: !!env.YOUTUBE_API_KEY, updatedAt: store.data.updatedAt }));
admin.get('/lookup', wrap(async (req, res) => {
  const q = String(req.query.q || '').trim();
  if (/^\d+$/.test(q)) {
    const out = [];
    for (const t of ['movie', 'tv']) { try { const d = await catalog.title(t, +q); out.push({ id: d.id, media_type: t, title: d.title, year: d.year, poster: d.poster }); } catch {} }
    return res.json({ results: out });
  }
  res.json(q ? await catalog.search(q, 1) : { results: [] });
}));
admin.post('/validate', (req, res) => {
  try { const s = parseSource(req.body?.url, env); res.json({ ok: true, source: s, player: playerFor(s, env), providerName: PROVIDER_LABELS[s.provider] }); }
  catch (e) { res.status(400).json({ error: e.message }); }
});
admin.post('/sources', wrap(async (req, res) => {
  const { url, type, id, season, episode, label } = req.body || {};
  const t = T(type), n = ID(id);
  if (t === 'all') throw new SourceError('Pick a movie or series.');
  const src = parseSource(url, env);
  const key = Store.key(t, n, t === 'tv' ? season : null, t === 'tv' ? episode : null);
  const entry = store.addSource(key, src, { label: String(label || '').slice(0, 80), origin: 'manual' });
  if (!entry) return res.status(409).json({ error: 'That source is already attached to this title.' });
  if (!store.data.titles[`${t}:${n}`]) { try { store.rememberTitle(t, await catalog.title(t, n)); } catch {} }
  await store.save(); res.json({ ok: true, key, source: entry });
}));
admin.post('/subs', wrap(async (req, res) => {
  const { type, id, season, episode, lang, label, content, filename } = req.body || {};
  const t = T(type), n = ID(id);
  const vtt = toVtt(content, filename);
  const code = String(lang || 'en').toLowerCase().replace(/[^a-z-]/g, '').slice(0, 8) || 'en';
  const key = Store.key(t, n, t === 'tv' ? season : null, t === 'tv' ? episode : null);
  store.data.subs ||= {};
  const entry = { sid: crypto.randomBytes(5).toString('hex'), lang: code, label: String(label || code.toUpperCase()).slice(0, 40), vtt, addedAt: new Date().toISOString() };
  (store.data.subs[key] ||= []).push(entry);
  if (!store.data.titles[`${t}:${n}`]) { try { store.rememberTitle(t, await catalog.title(t, n)); } catch {} }
  await store.save(); res.json({ ok: true, key, sid: entry.sid, cues: (vtt.match(/-->/g) || []).length });
}));
admin.delete('/subs/:sid', wrap(async (req, res) => {
  for (const [k, list] of Object.entries(store.data.subs || {})) { const i = list.findIndex((x) => x.sid === req.params.sid); if (i >= 0) { list.splice(i, 1); if (!list.length) delete store.data.subs[k]; await store.save(); return res.json({ ok: true }); } }
  res.status(404).json({ error: 'Not found' });
}));
admin.put('/patterns', wrap(async (req, res) => {
  const movie = validatePattern('movie', req.body?.movie, env);
  const tv = validatePattern('tv', req.body?.tv, env);
  store.data.patterns = { movie, tv }; await store.save(); res.json({ ok: true, patterns: store.data.patterns });
}));
admin.post('/channels', wrap(async (req, res) => {
  const { name, category, url, logo } = req.body || {};
  if (!String(name || '').trim()) throw new SourceError('Channel name is required.');
  const src = parseSource(url, env); // denylist + http(s) rules
  if (logo) parseSource(logo, env);
  const c = { id: 'c' + crypto.randomBytes(4).toString('hex'), name: String(name).trim().slice(0, 60), category: String(category || 'Other').slice(0, 30), url: src.url, logo: logo || '', custom: true };
  (store.data.channels ||= []).push(c); await store.save(); res.json({ ok: true, channel: c });
}));
admin.delete('/channels/:id', wrap(async (req, res) => { store.data.channels = (store.data.channels || []).filter((c) => c.id !== req.params.id); await store.save(); res.json({ ok: true }); }));
admin.delete('/sources/:sid', wrap(async (req, res) => { const ok = store.removeSource(String(req.params.sid)); await store.save(); res.status(ok ? 200 : 404).json({ ok }); }));
admin.patch('/sources/:sid', wrap(async (req, res) => {
  for (const [key, list] of Object.entries(store.data.sources)) {
    const i = list.findIndex((x) => x.sid === req.params.sid); if (i < 0) continue;
    const cur = list[i]; const next = { ...cur };
    if (req.body?.url != null && String(req.body.url).trim() && String(req.body.url).trim() !== cur.url) Object.assign(next, parseSource(req.body.url, env));
    if (req.body?.label != null) next.label = String(req.body.label).slice(0, 80);
    next.sid = cur.sid; next.origin = cur.origin; next.addedAt = cur.addedAt; next.editedAt = new Date().toISOString();
    list[i] = next; await store.save(); return res.json({ ok: true, key, source: next });
  }
  res.status(404).json({ error: 'Not found' });
}));
admin.get('/site', wrap(async (req, res) => {
  let rows = [];
  try { rows = (await catalog.home()).rows.map((r) => ({ id: r.id, title: r.title })); } catch {}
  if (catalog.mode !== 'demo' && store.playableCards().length) rows.splice(1, 0, { id: 'free', title: 'Free to watch on GhostFlix' });
  rows.unshift({ id: 'continue', title: 'Continue watching (per viewer)' }, { id: 'mylist', title: 'My List (per viewer)' });
  const keys = new Set(Object.keys(store.data.sources).map((k) => k.split(':').slice(0, 2).join(':')));
  const stats = { titlesWithEmbeds: keys.size, users: null };
  if (store.supa) {
    try {
      const r = await fetch(`${store.supa.url}/auth/v1/admin/users?page=1&per_page=1`, { headers: { apikey: store.supa.key, Authorization: `Bearer ${store.supa.key}` } });
      if (r.ok) { const tot = r.headers.get('x-total-count'); const j = await r.json(); stats.users = tot != null ? +tot : (j.total ?? null); }
    } catch {}
  }
  res.json({ site: siteCfg(), rows, stats, sectionKeys: SECTION_KEYS });
}));
admin.put('/site', wrap(async (req, res) => {
  const b = req.body || {}; const cur = store.data.site || {};
  const next = { ...cur };
  if (b.announcement) {
    const color = /^#[0-9a-f]{6}$/i.test(b.announcement.color || '') ? b.announcement.color : '#5fe3ff';
    next.announcement = { on: !!b.announcement.on, text: String(b.announcement.text || '').slice(0, 280), color };
  }
  if ('hero' in b) next.hero = b.hero && b.hero.id ? { type: T(b.hero.type) === 'all' ? 'movie' : b.hero.type, id: ID(b.hero.id), title: String(b.hero.title || '').slice(0, 120) } : null;
  if (b.sections) next.sections = Object.fromEntries(SECTION_KEYS.map((k) => [k, b.sections[k] !== false]));
  if (b.rows) next.rows = Object.fromEntries(Object.entries(b.rows).filter(([k, v]) => /^[\w-]{1,40}$/.test(k) && v === false).map(([k]) => [k, false]));
  if ('maintenance' in b) next.maintenance = !!b.maintenance;
  store.data.site = next; await store.save(); res.json({ ok: true, site: siteCfg() });
}));
admin.post('/import/preview', wrap(async (req, res) => res.json(await previewImport(req.body || {}, ctx))));
admin.post('/import/commit', wrap(async (req, res) => {
  const { rows = [], saveJob, url, limit, type, resync } = req.body || {};
  let origin = 'import';
  if (saveJob && url) {
    let job = store.data.jobs.find((j) => j.url === url);
    if (!job) { job = { id: crypto.randomBytes(4).toString('hex'), url, limit: +limit || 200, type: type || 'auto', resync: !!resync, createdAt: new Date().toISOString() }; store.data.jobs.push(job); }
    else Object.assign(job, { resync: !!resync, limit: +limit || job.limit });
    job.lastRun = new Date().toISOString(); origin = `job:${job.id}`;
  }
  res.json(await commitImport(rows.slice(0, 1000), { ...ctx, origin }));
}));
admin.post('/unmatched/:uid/assign', wrap(async (req, res) => {
  const u = store.data.unmatched.find((x) => x.uid === req.params.uid);
  if (!u) return res.status(404).json({ error: 'Not found' });
  const { type, id, season, episode } = req.body || {};
  const r = await commitImport([{ ref: u.ref, raw: u.raw, match: { id: ID(id), media_type: T(type) }, season: season ?? null, episode: episode ?? null }], { ...ctx, origin: u.origin });
  res.json(r);
}));
admin.delete('/unmatched/:uid', wrap(async (req, res) => { store.data.unmatched = store.data.unmatched.filter((x) => x.uid !== req.params.uid); await store.save(); res.json({ ok: true }); }));
admin.post('/jobs/:id/run', wrap(async (req, res) => { const j = store.data.jobs.find((x) => x.id === req.params.id); if (!j) return res.status(404).json({ error: 'Not found' }); res.json(await runJob(j, ctx)); }));
admin.patch('/jobs/:id', wrap(async (req, res) => { const j = store.data.jobs.find((x) => x.id === req.params.id); if (!j) return res.status(404).json({ error: 'Not found' }); j.resync = !!req.body?.resync; await store.save(); res.json(j); }));
admin.delete('/jobs/:id', wrap(async (req, res) => { store.data.jobs = store.data.jobs.filter((x) => x.id !== req.params.id); await store.save(); res.json({ ok: true }); }));
admin.get('/export', (req, res) => { res.setHeader('Content-Disposition', 'attachment; filename="ghostflix-store.json"'); res.json(store.data); });
admin.post('/restore', wrap(async (req, res) => {
  const d = req.body; if (!d || typeof d.sources !== 'object') throw new SourceError('Not a GhostFlix export.');
  // Re-parse every source on restore so a hand-edited file still normalises to valid sources.
  const sources = {}; let skipped = 0;
  for (const [k, list] of Object.entries(d.sources)) for (const s of list) { try { const p = parseSource(s.url || s.id, env); (sources[k] ||= []).push({ ...s, ...p }); } catch { skipped++; } }
  store.data = { ...store.data, ...d, sources }; await store.save(); res.json({ ok: true, skipped });
}));

// Watch position endpoints
// POST /api/watch-position: save position
// GET /api/watch-position: get saved positions
app.post('/api/watch-position', wrap(async (req, res) => {
  const { type, id, position } = req.body;
  if (type && id != null) {
    store.watchPosition(type, id, position != null ? position : 0);
    res.json({ ok: true, position: store.getWatchPosition(type, id) });
  } else {
    res.status(400).json({ error: 'type and id required' });
  }
}));
app.get('/api/watch-position', wrap(async (req, res) => {
  const positions = {};
  if (store.data.watchPositions) {
    for (const [key, pos] of Object.entries(store.data.watchPositions)) {
      const [t, id] = key.split(':', 2);
      positions[t] = positions[t] || {};
      positions[t][id] = pos;
    }
  }
  res.json({ positions });
}));

// External cron hook for the daily re-sync (Render free instances sleep when idle).
app.post('/api/cron/resync', wrap(async (req, res) => {
  if (!env.CRON_SECRET || req.get('x-cron-secret') !== env.CRON_SECRET) return res.status(401).json({ error: 'unauthorized' });
  const out = [];
  for (const j of store.data.jobs.filter((x) => x.resync)) { try { out.push({ id: j.id, ...(await runJob(j, ctx)) }); } catch (e) { out.push({ id: j.id, error: e.message }); } }
  res.json({ ran: out.length, out });
}));
app.get('/api/subs/:sid.vtt', (req, res) => {
  for (const list of Object.values(store.data.subs || {})) {
    const t = list.find((x) => x.sid === req.params.sid);
    if (t) { res.type('text/vtt; charset=utf-8'); cacheFor(res, 3600); return res.send(t.vtt); }
  }
  res.status(404).end();
});
app.get(['/healthz', '/health'], (req, res) => res.json({ ok: true, mode: catalog.mode }));

// ---- static + SPA ---------------------------------------------------------------
app.use('/vendor/supabase.js', (req, res) => res.sendFile(path.join(ROOT, 'node_modules/@supabase/supabase-js/dist/umd/supabase.js')));
app.use('/vendor/hls.min.js', (req, res) => res.sendFile(path.join(ROOT, 'node_modules/hls.js/dist/hls.min.js')));
app.use('/vendor/html2canvas.min.js', (req, res) => { res.set('Cache-Control', 'public, max-age=604800'); res.sendFile(path.join(ROOT, 'node_modules/html2canvas/dist/html2canvas.min.js')); }); // bug-report screenshots (self-hosted for CSP)
// PWA: service worker from root scope (never HTTP-cached so new deploys are picked up) + manifest with its proper type.
app.get('/sw.js', (req, res) => { res.set({ 'Cache-Control': 'no-cache', 'Service-Worker-Allowed': '/' }); res.type('application/javascript'); res.sendFile(path.join(ROOT, 'public/sw.js')); });
app.get('/manifest.webmanifest', (req, res) => { res.set('Cache-Control', 'public, max-age=3600'); res.type('application/manifest+json'); res.sendFile(path.join(ROOT, 'public/manifest.webmanifest')); });
// Versioned assets (?v=…) change URL on every release, so browsers may keep them for a year.
// Unversioned files keep a short cache; HTML is always revalidated.
app.get('/admin.html', (req, res) => res.redirect(301, '/admin')); // one admin panel: the old URL points at /admin
app.use(express.static(path.join(ROOT, 'public'), { maxAge: '1h', index: false, setHeaders(res, file) {
  if (/\.html$/.test(file)) res.setHeader('Cache-Control', 'no-cache');
  else if (res.req?.query?.v !== undefined) res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
} }));
app.get('/admin', (req, res) => { res.set('Cache-Control', 'no-cache'); res.sendFile(path.join(ROOT, 'public/admin.html')); });
app.get('/mod', (req, res) => { res.set('Cache-Control', 'no-cache'); res.sendFile(path.join(ROOT, 'public/mod.html')); }); // moderator panel (separate from /admin; its API is RLS-enforced)
app.get(/^\/(?!api\/).*/, (req, res) => { res.set('Cache-Control', 'no-cache'); res.sendFile(path.join(ROOT, 'public/index.html')); });

app.listen(PORT, () => {
  console.log(`GhostFlix on http://localhost:${PORT} — catalog: ${catalog.mode}${catalog.mode === 'demo' ? ' (set TMDB_API_KEY for the full catalog)' : ''}, store: ${store.backend}, admin: ${env.ADMIN_PASSWORD ? 'on' : 'off (set ADMIN_PASSWORD)'}`);
  startScheduler(ctx);
});
