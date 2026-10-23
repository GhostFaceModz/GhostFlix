// Kids profiles: age ratings (BBFC first, then US MPA/TV Parental Guidelines) and a response filter.
// When a request carries ?kids=<max age>, every movie/series card above that age (or without a known rating) is removed
// from the JSON, and a title page above it is refused. Unknown ratings are hidden on purpose (safer default), except
// series in TMDB's "Kids" genre.
import { cards } from './tmdb.js';

const GB = { U: 0, PG: 8, '12A': 12, 12: 12, 15: 15, 18: 18, R18: 18 };
const US_MOVIE = { G: 0, PG: 8, 'PG-13': 13, R: 17, 'NC-17': 18 };
const US_TV = { 'TV-Y': 0, 'TV-Y7': 7, 'TV-Y7-FV': 7, 'TV-G': 0, 'TV-PG': 8, 'TV-14': 14, 'TV-MA': 17 };
export const KIDS_LEVELS = [0, 8, 14, 15];
const GB_LTE = { 0: 'U', 8: 'PG', 14: '12A', 15: '15' };

export function mountKids(app, { env, wrap, cacheFor, catalog }) {
  const key = String(env.TMDB_API_KEY || '').trim();
  const CERT = new Map(); // "movie:1" -> { age, label, at }
  const pending = new Map();
  async function tmdb(path, params = {}) {
    const q = new URLSearchParams({ language: 'en-US', ...params }); const bearer = key.startsWith('eyJ'); if (!bearer) q.set('api_key', key);
    const r = await fetch(`https://api.themoviedb.org/3${path}?${q}`, { headers: { accept: 'application/json', ...(bearer ? { Authorization: `Bearer ${key}` } : {}) }, signal: AbortSignal.timeout(8000) });
    if (!r.ok) throw Object.assign(new Error(`TMDB ${r.status}`), { status: r.status });
    return r.json();
  }
  async function certOf(type, id) {
    const k = `${type}:${id}`; const hit = CERT.get(k);
    if (hit && Date.now() - hit.at < 7 * 864e5) return hit;
    if (pending.has(k)) return pending.get(k);
    const p = (async () => {
      let v = { age: null, label: null, at: Date.now() };
      try {
        const d = await tmdb(`/${type}/${id}`, { append_to_response: type === 'movie' ? 'release_dates' : 'content_ratings' });
        const pick = (cc) => type === 'movie'
          ? (d.release_dates?.results || []).find((r) => r.iso_3166_1 === cc)?.release_dates?.map((x) => (x.certification || '').trim()).find(Boolean)
          : (d.content_ratings?.results || []).find((r) => r.iso_3166_1 === cc)?.rating?.trim();
        const gb = pick('GB'), us = pick('US');
        if (gb && GB[gb] != null) v = { ...v, age: GB[gb], label: gb };
        else if (us && (type === 'movie' ? US_MOVIE : US_TV)[us] != null) v = { ...v, age: (type === 'movie' ? US_MOVIE : US_TV)[us], label: us };
        else if (type === 'tv' && (d.genres || []).some((g) => g.id === 10762)) v = { ...v, age: 0, label: 'Kids' };
        if (d.adult) v = { ...v, age: 18, label: '18' };
      } catch (e) { if (e.status !== 404) { pending.delete(k); return { age: null, label: null, at: 0 }; } }
      CERT.set(k, v); if (CERT.size > 30000) CERT.delete(CERT.keys().next().value);
      pending.delete(k); return v;
    })();
    pending.set(k, p); return p;
  }
  async function allowedSet(items, max) {
    const keys = [...new Set(items.map((c) => `${c.media_type}:${c.id}`))];
    const ok = new Set(); let i = 0;
    const worker = async () => { while (i < keys.length) { const k = keys[i++]; const [t, id] = k.split(':'); const c = await certOf(t, id); if (c.age != null && c.age <= max) ok.add(k); } };
    await Promise.all(Array.from({ length: Math.min(12, keys.length) }, worker));
    return ok;
  }
  const isCard = (x) => x && typeof x === 'object' && (x.media_type === 'movie' || x.media_type === 'tv') && Number.isFinite(+x.id);
  function collect(o, out, depth = 0) {
    if (!o || typeof o !== 'object' || depth > 6) return;
    if (Array.isArray(o)) { for (const x of o) { if (isCard(x)) out.push(x); collect(x, out, depth + 1); } return; }
    for (const v of Object.values(o)) collect(v, out, depth + 1);
  }
  function prune(o, ok, depth = 0) {
    if (!o || typeof o !== 'object' || depth > 6) return o;
    if (Array.isArray(o)) return o.filter((x) => !isCard(x) || ok.has(`${x.media_type}:${x.id}`)).map((x) => prune(x, ok, depth + 1));
    for (const [k, v] of Object.entries(o)) if (v && typeof v === 'object') o[k] = prune(v, ok, depth + 1);
    return o;
  }
  const SKIP = /^\/api\/(config|site-config|genres|segments|report-source|tv-status|admin|kids\/cert|cert|stats|push|track|profiles)/;
  // Must be registered before the catalog routes.
  const middleware = (req, res, next) => {
    const max = KIDS_LEVELS.includes(+req.query.kids) && req.query.kids !== '' ? +req.query.kids : null;
    if (max == null || req.method !== 'GET' || SKIP.test(req.originalUrl)) return next();
    res.setHeader('Vary', 'Accept-Encoding');
    const json = res.json.bind(res);
    res.json = (body) => {
      if (res.statusCode >= 400 || !body || typeof body !== 'object') return json(body);
      (async () => {
        const pm = req.originalUrl.match(/^\/api\/play\/(movie|tv)\/(\d+)/);
        if (pm) { const c = await certOf(pm[1], pm[2]); if (c.age == null || c.age > max) { return json({ error: c.label ? `This is rated ${c.label}, which is above this kids profile’s limit.` : 'This has no age rating, so it can’t be played on a kids profile.', kids: true, blocked: true, cert: c.label }); } }
        const top = isCard(body) && (body.cast || body.seasons !== undefined || body.runtime !== undefined) ? body : null;
        if (top) { const c = await certOf(top.media_type, top.id); if (c.age == null || c.age > max) { return json({ error: c.label ? `“${top.title}” is rated ${c.label}, which is above this kids profile’s limit.` : `“${top.title}” has no age rating, so it’s hidden on kids profiles.`, kids: true, blocked: true, cert: c.label }); } }
        const items = []; collect(body, items);
        const ok = await allowedSet(items, max);
        json(prune(body, ok));
      })().catch((e) => { console.warn('[kids] filter failed', e.message); res.status(503); json({ error: 'Couldn’t check age ratings right now.', kids: true }); });
      return res;
    };
    next();
  };

  app.use('/api', middleware);

  // Ratings for a few titles at once (used by the player before starting playback on a kids profile).
  app.get('/api/cert', wrap(async (req, res) => {
    const keys = String(req.query.keys || '').split(',').filter((k) => /^(movie|tv):\d+$/.test(k)).slice(0, 40);
    const out = {}; await Promise.all(keys.map(async (k) => { const [t, id] = k.split(':'); const c = await certOf(t, id); out[k] = { age: c.age, label: c.label }; }));
    cacheFor(res, 3600); res.json(out);
  }));

  // A kids home page: rows built from age-limited discover queries (and then filtered again by the middleware).
  app.get('/api/kids/home', wrap(async (req, res) => {
    const max = KIDS_LEVELS.includes(+req.query.kids) ? +req.query.kids : 0;
    const lte = GB_LTE[max];
    const mv = (extra) => catalog.get('/discover/movie', { certification_country: 'GB', 'certification.lte': lte, sort_by: 'popularity.desc', 'vote_count.gte': 50, include_adult: 'false', ...extra }, 6 * 3600e3).then((d) => cards(d.results, 'movie'));
    const tv = (extra) => catalog.get('/discover/tv', { sort_by: 'popularity.desc', 'vote_count.gte': 20, include_adult: 'false', ...extra }, 6 * 3600e3).then((d) => cards(d.results, 'tv'));
    const [pop, anim, fam, kidsTv, famTv, animTv] = await Promise.all([
      mv({}), mv({ with_genres: '16' }), mv({ with_genres: '10751' }),
      tv({ with_genres: '10762' }), tv({ with_genres: '10751' }), tv({ with_genres: '16', without_genres: '10759,80,18' }),
    ]);
    const rows = [
      { id: 'k-pop', title: 'Popular films', items: pop }, { id: 'k-kidstv', title: 'Kids’ series', items: kidsTv },
      { id: 'k-anim', title: 'Animated films', items: anim }, { id: 'k-famtv', title: 'Family series', items: famTv },
      { id: 'k-fam', title: 'Family films', items: fam }, { id: 'k-animtv', title: 'Cartoons', items: animTv },
    ];
    cacheFor(res, 1800); res.json({ hero: [], rows, kids: max });
  }));

  return { middleware, certOf };
}
