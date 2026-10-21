// GhostFlix server — Express app: static SPA + JSON API + password-protected admin.
import express from 'express';
import crypto from 'node:crypto';
import path from 'node:path';
import { readFileSync, existsSync } from 'node:fs';
import { TmdbCatalog } from './tmdb.js';
import { DemoCatalog } from './demo.js';
import { Store } from './store.js';
import { parseSource, playerFor, PROVIDER_LABELS, SourceError, validatePattern, fillPattern, nexstreamUrl, isBlocked } from './sources.js';
import { toVtt } from './subtitles.js';
import { previewImport, commitImport, runJob, startScheduler } from './importers.js';

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
const DISCORD_URL = env.DISCORD_INVITE_URL || 'https://discord.gg/zenclipsdaily-arc-raiders-store-bloodstrike-1408818003591827539'; // GhostGames community server
const authOrigin = AUTH ? new URL(AUTH.url).origin : '';
app.use((req, res, next) => {
  res.setHeader('Content-Security-Policy', [
    "default-src 'self'", "script-src 'self'", "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
    "font-src 'self' https://fonts.gstatic.com", "img-src 'self' data: https://image.tmdb.org https://archive.org https://*.archive.org https://i.ytimg.com https://*.googleusercontent.com https://cdn.discordapp.com",
    // Any http(s) player may be framed — no host restrictions.
    "media-src 'self' blob: https: http:", `connect-src 'self' https: http:${authOrigin ? ` ${authOrigin.replace('https://', 'wss://')}` : ''}`,
    'frame-src https: http:', "object-src 'none'", "base-uri 'self'", "frame-ancestors 'self'",
  ].join('; '));
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  next();
});

const wrap = (fn) => (req, res) => Promise.resolve(fn(req, res)).catch((e) => {
  const status = e.status || 500; if (status >= 500) console.error(e);
  res.status(status).json({ error: e.message || 'Server error' });
});
const T = (t) => { if (t !== 'movie' && t !== 'tv' && t !== 'all') { const e = new Error('Bad type'); e.status = 400; throw e; } return t; };
const ID = (v) => { const n = parseInt(v, 10); if (!(n > 0)) { const e = new Error('Bad id'); e.status = 400; throw e; } return n; };
const cacheFor = (res, s) => res.setHeader('Cache-Control', `public, max-age=${s}`);
const patternFor = (type) => store.data.patterns?.[type] || '';
const withPlayable = (c) => (c ? { ...c, playable: (catalog.mode === 'demo' && !!c.demo) || store.hasAnyFor(c.media_type, c.id) || !!patternFor(c.media_type) || !!env.NEXSTREAM_API_KEY } : c);
const markList = (d) => ({ ...d, results: d.results.map(withPlayable) });

// ---- public API ---------------------------------------------------------------
app.get('/api/config', (req, res) => res.json({ mode: catalog.mode, hasTmdbKey: !!env.TMDB_API_KEY, adminEnabled: !!env.ADMIN_PASSWORD, region: env.TMDB_REGION || 'US',
  auth: AUTH, discordUrl: DISCORD_URL, githubUrl: env.GITHUB_URL || 'https://github.com/GhostFaceModz/GhostFlix', parties: env.ENABLE_WATCH_PARTIES === '1' }));
app.get('/api/home', wrap(async (req, res) => {
  const d = await catalog.home();
  const free = catalog.mode === 'demo' ? [] : store.playableCards();
  if (free.length) d.rows.splice(1, 0, { id: 'free', title: 'Free to watch on GhostFlix', link: '/browse/free/all', items: free.slice(0, 30) });
  d.rows.forEach((r) => (r.items = r.items.map(withPlayable)));
  d.hero = d.hero.map(withPlayable);
  cacheFor(res, 60); res.json(d);
}));
app.get('/api/discover', wrap(async (req, res) => {
  const d = await catalog.discoverPage();
  d.top10 = d.top10.map(withPlayable); [...d.rows, ...d.moods].forEach((r) => (r.items = r.items.map(withPlayable)));
  cacheFor(res, 120); res.json(d);
}));
const CURATED = JSON.parse(readFileSync(path.join(ROOT, 'data/live-channels.json'), 'utf8')).channels;
app.get('/api/live', (req, res) => {
  const out = [];
  for (const c of [...CURATED, ...(store.data.channels || [])]) {
    try { const p = playerFor(parseSource(c.url, env), env); out.push({ id: c.id, name: c.name, category: c.category || 'Other', logo: c.logo || '', official: c.official || c.url, custom: !!c.custom, player: p }); } catch {}
  }
  res.json({ channels: out });
});
app.get('/api/genres', wrap(async (req, res) => { cacheFor(res, 3600); res.json(await catalog.genres()); }));
app.get('/api/list/:type/:category', wrap(async (req, res) => {
  if (req.params.type === 'free') { const all = catalog.mode === 'demo' ? (await demo.list('all', 'trending', req.query.page)).results : store.playableCards(); return res.json({ page: 1, total_pages: 1, results: all.map(withPlayable) }); }
  res.json(markList(await catalog.list(T(req.params.type), String(req.params.category), +req.query.page || 1)));
}));
app.get('/api/discover/:type/:genre', wrap(async (req, res) => res.json(markList(await catalog.discover(T(req.params.type), ID(req.params.genre), +req.query.page || 1)))));
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
  if (!list.length && env.NEXSTREAM_API_KEY) {
    // Last resort: NexStream (api.codespecters.com). Enable by setting NEXSTREAM_API_KEY.
    try { list = [{ ...parseSource(nexstreamUrl(type, id, s, e, env.NEXSTREAM_API_KEY), env), label: 'NexStream', origin: 'nexstream' }]; } catch {}
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

admin.get('/state', (req, res) => res.json({ mode: catalog.mode, backend: store.backend, sources: store.allSources().reverse(),
  subs: Object.entries(store.data.subs || {}).flatMap(([key, list]) => list.map(({ vtt, ...t }) => ({ key, ...t, title: store.data.titles[key.split(':').slice(0, 2).join(':')]?.title || key }))), unmatched: store.data.unmatched, jobs: store.data.jobs,
  patterns: store.data.patterns || { movie: '', tv: '' }, channels: store.data.channels || [], hasYouTubeKey: !!env.YOUTUBE_API_KEY, nexstream: !!env.NEXSTREAM_API_KEY, updatedAt: store.data.updatedAt }));
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
app.use(express.static(path.join(ROOT, 'public'), { maxAge: '1h', index: false }));
app.get('/admin', (req, res) => res.sendFile(path.join(ROOT, 'public/admin.html')));
app.get(/^\/(?!api\/).*/, (req, res) => res.sendFile(path.join(ROOT, 'public/index.html')));

app.listen(PORT, () => {
  console.log(`GhostFlix on http://localhost:${PORT} — catalog: ${catalog.mode}${catalog.mode === 'demo' ? ' (set TMDB_API_KEY for the full catalog)' : ''}, store: ${store.backend}, admin: ${env.ADMIN_PASSWORD ? 'on' : 'off (set ADMIN_PASSWORD)'}`);
  startScheduler(ctx);
});
