// Batch-3 catalog extras: collections, filtered discover/search, TV episode status (new-episode badges), coming soon.
import { card, cards, epInfo } from './tmdb.js';

const IMG = 'https://image.tmdb.org/t/p/';
const img = (p, size) => (p ? IMG + size + p : null);
const int = (v) => { const n = parseInt(v, 10); return Number.isFinite(n) ? n : null; };
// Popular film series for the home "Collections" row (TMDB collection ids).
const FEATURED = [1241, 10, 119, 9485, 404609, 10194, 328, 264, 2344, 87359, 295, 131635, 31562, 84, 263, 8091, 2150, 86311];

/** Year / rating / runtime filters shared by discover and search. Runtime is minutes (episode runtime for series). */
export function parseFilters(q) {
  const f = { yf: int(q.yf), yt: int(q.yt), rmin: +q.rmin > 0 ? Math.min(9.5, +q.rmin) : null, rtmin: int(q.rtmin), rtmax: int(q.rtmax) };
  for (const k of ['yf', 'yt']) if (f[k] != null && (f[k] < 1870 || f[k] > 2100)) f[k] = null;
  for (const k of ['rtmin', 'rtmax']) if (f[k] != null && (f[k] < 0 || f[k] > 600)) f[k] = null;
  f.any = Object.entries(f).some(([k, v]) => k !== 'any' && v != null);
  return f;
}
export const passes = (c, f) => (f.yf == null || (c.year && c.year >= f.yf)) && (f.yt == null || (c.year && c.year <= f.yt)) && (f.rmin == null || (c.rating || 0) >= f.rmin)
  && (f.rtmin == null || (c.runtime && c.runtime >= f.rtmin)) && (f.rtmax == null || (c.runtime && c.runtime <= f.rtmax));

export function mountCatalog(app, { env, wrap, cacheFor, catalog, markList }) {
  const tm = catalog && typeof catalog.get === 'function' ? catalog : null;
  const need = () => { if (!tm) { const e = new Error('Needs the TMDB catalog'); e.status = 404; throw e; } };
  const T = (t) => { if (t !== 'movie' && t !== 'tv') { const e = new Error('Bad type'); e.status = 400; throw e; } return t; };
  const ID = (v) => { const n = int(v); if (!(n > 0)) { const e = new Error('Bad id'); e.status = 400; throw e; } return n; };
  const today = () => new Date().toISOString().slice(0, 10);
  const addDays = (n) => new Date(Date.now() + n * 864e5).toISOString().slice(0, 10);

  // ---- collections ----
  const collection = async (id) => {
    const d = await tm.get(`/collection/${id}`, {}, 24 * 3600e3);
    const parts = (d.parts || []).map((x) => ({ ...card(x, 'movie'), release_date: x.release_date || null })).filter((c) => c.poster || c.backdrop)
      .sort((a, b) => (a.release_date || '9999').localeCompare(b.release_date || '9999'));
    return { id: d.id, name: d.name, overview: d.overview || '', poster: img(d.poster_path, 'w342'), backdrop: img(d.backdrop_path, 'original'), backdrop_sm: img(d.backdrop_path, 'w780'), parts };
  };
  app.get('/api/collection/:id', wrap(async (req, res) => {
    need(); const d = await collection(ID(req.params.id)); d.parts = markList({ results: d.parts }).results;
    cacheFor(res, 3600); res.json(d);
  }));
  let featured = null;
  app.get('/api/collections/featured', wrap(async (req, res) => {
    need();
    if (!featured || Date.now() - featured.at > 24 * 3600e3) {
      const all = await Promise.all(FEATURED.map((id) => collection(id).catch(() => null)));
      featured = { at: Date.now(), items: all.filter((c) => c && c.backdrop_sm && c.parts.length > 1).map((c) => ({ id: c.id, name: c.name.replace(/ Collection$/i, ''), backdrop: c.backdrop_sm, poster: c.poster, count: c.parts.filter((p) => p.release_date && p.release_date <= today()).length || c.parts.length, years: [c.parts[0]?.year, c.parts.filter((p) => p.year && p.release_date <= today()).pop()?.year].filter(Boolean) })) };
    }
    cacheFor(res, 3600); res.json({ items: featured.items });
  }));

  // ---- runtime lookup (search filter) ----
  const runtimeOf = async (c) => {
    try { const d = await tm.get(`/${c.media_type}/${c.id}`, {}, 24 * 3600e3); return d.runtime || d.episode_run_time?.[0] || d.last_episode_to_air?.runtime || null; } catch { return null; }
  };

  // ---- filtered discover (genre pages + "all") ----
  app.get('/api/filter/:type', wrap(async (req, res) => {
    need(); const type = T(req.params.type), f = parseFilters(req.query), page = Math.max(1, Math.min(500, int(req.query.page) || 1));
    const date = type === 'tv' ? 'first_air_date' : 'primary_release_date';
    const sort = String(req.query.sort || 'popular');
    const p = sort === 'top_rated' ? { sort_by: 'vote_average.desc', 'vote_count.gte': 300 } : sort === 'newest' ? { sort_by: `${date}.desc`, [`${date}.lte`]: today(), 'vote_count.gte': 20 } : { sort_by: 'popularity.desc', 'vote_count.gte': 50 };
    if (int(req.query.genre) > 0) p.with_genres = int(req.query.genre);
    if (f.yf) p[`${date}.gte`] = `${f.yf}-01-01`;
    if (f.yt) p[`${date}.lte`] = f.yt >= +today().slice(0, 4) ? today() : `${f.yt}-12-31`;
    if (f.rmin) { p['vote_average.gte'] = f.rmin; p['vote_count.gte'] = Math.max(p['vote_count.gte'], 100); }
    if (f.rtmin != null) p['with_runtime.gte'] = f.rtmin;
    if (f.rtmax != null) p['with_runtime.lte'] = f.rtmax;
    const d = await tm.get(`/discover/${type}`, { ...p, page });
    cacheFor(res, 600); res.json(markList({ page: d.page, total_pages: Math.min(d.total_pages, 500), results: cards(d.results, type) }));
  }));

  // ---- filtered search: 3 TMDB pages per page so filters don't leave pages empty ----
  app.get('/api/search-filtered', wrap(async (req, res) => {
    need(); const q = String(req.query.q || '').trim().slice(0, 100), f = parseFilters(req.query), page = Math.max(1, Math.min(150, int(req.query.page) || 1));
    if (!q) return res.json({ page: 1, total_pages: 0, results: [] });
    const first = (page - 1) * 3 + 1;
    const pages = await Promise.all([0, 1, 2].map((i) => tm.get('/search/multi', { query: q, page: first + i, include_adult: 'false' }, 10 * 60e3).catch(() => null)));
    const total = pages[0]?.total_pages || 0;
    let list = pages.flatMap((d) => (d && d.page <= d.total_pages ? cards(d.results) : []));
    const seen = new Set(); list = list.filter((c) => { const k = `${c.media_type}:${c.id}`; if (seen.has(k)) return false; seen.add(k); return true; });
    list = list.filter((c) => passes({ ...c, runtime: 1 }, { ...f, rtmin: null, rtmax: null }));
    if (f.rtmin != null || f.rtmax != null) {
      const rts = await Promise.all(list.map(runtimeOf));
      list = list.map((c, i) => ({ ...c, runtime: rts[i] })).filter((c) => passes(c, f));
    }
    res.json(markList({ page, total_pages: Math.ceil(total / 3), results: list }));
  }));

  // ---- TV status for new-episode badges ----
  app.get('/api/tv-status', wrap(async (req, res) => {
    need(); const ids = [...new Set(String(req.query.ids || '').split(',').map(int).filter((n) => n > 0))].slice(0, 60);
    const out = await Promise.all(ids.map(async (id) => {
      try { const d = await tm.get(`/tv/${id}`, {}, 3 * 3600e3); return { id, status: d.status || null, last: epInfo(d.last_episode_to_air), next: epInfo(d.next_episode_to_air) }; } catch { return { id, last: null, next: null }; }
    }));
    cacheFor(res, 900); res.json({ today: today(), shows: out });
  }));

  // ---- coming soon ----
  app.get('/api/coming-soon/:type', wrap(async (req, res) => {
    need(); const type = T(req.params.type), page = Math.max(1, Math.min(20, int(req.query.page) || 1));
    const region = String(req.query.region || env.TMDB_REGION || 'US').toUpperCase().replace(/[^A-Z]/g, '').slice(0, 2) || 'US';
    let d, list;
    if (type === 'movie') {
      d = await tm.get('/discover/movie', { region, 'primary_release_date.gte': addDays(1), 'primary_release_date.lte': addDays(180), with_release_type: '2|3', sort_by: 'popularity.desc', page }, 3 * 3600e3);
      list = (d.results || []).map((x) => ({ ...card(x, 'movie'), release_date: x.release_date || null }));
    } else {
      d = await tm.get('/discover/tv', { 'first_air_date.gte': addDays(1), 'first_air_date.lte': addDays(180), sort_by: 'popularity.desc', 'with_original_language': 'en', page }, 3 * 3600e3);
      list = (d.results || []).map((x) => ({ ...card(x, 'tv'), release_date: x.first_air_date || null }));
    }
    list = list.filter((c) => c && (c.poster || c.backdrop) && c.release_date && c.release_date > today()).sort((a, b) => a.release_date.localeCompare(b.release_date));
    cacheFor(res, 1800); res.json(markList({ page: d.page, total_pages: Math.min(d.total_pages, 20), region, results: list }));
  }));
}
