// Seasonal home rows. Halloween: "Halloween Horror Picks" = popular TMDB horror (genre 27) mixed with well-loved classics.
// Kids profiles (?kids=<max age>) get family-friendly Halloween films/series instead (TMDB "halloween" keyword, family or
// animation genres, GB certification at or under the profile's limit); the kids middleware then filters the cards again.
import { cards } from './tmdb.js';

const GB_LTE = { 0: 'U', 8: 'PG', 14: '12A', 15: '15' };
const H6 = 6 * 3600e3;

export function mountSeasonal(app, { wrap, cacheFor, catalog, mark = (c) => c }) {
  const live = () => catalog.mode !== 'demo' && typeof catalog.get === 'function';
  let kw = null; // TMDB keyword id for "halloween", looked up once
  async function halloweenKeyword() {
    if (kw) return kw;
    const d = await catalog.get('/search/keyword', { query: 'halloween' }, 7 * 864e5);
    const k = (d.results || []).find((x) => String(x.name).toLowerCase() === 'halloween'); kw = k?.id || null; return kw;
  }
  const mix = (a, b, n) => { // two from a, then one from b, no duplicates
    const out = [], seen = new Set(); let i = 0, j = 0;
    const push = (c) => { const k = `${c.media_type}:${c.id}`; if (c.poster && !seen.has(k)) { seen.add(k); out.push(c); } };
    while (out.length < n && (i < a.length || j < b.length)) { if (i < a.length) push(a[i++]); if (i < a.length && out.length < n) push(a[i++]); if (j < b.length && out.length < n) push(b[j++]); }
    return out;
  };

  app.get('/api/seasonal/halloween', wrap(async (req, res) => {
    const kidsQ = req.query.kids; const kids = kidsQ !== undefined && kidsQ !== '' && GB_LTE[+kidsQ] !== undefined ? +kidsQ : null;
    if (!live()) { cacheFor(res, 300); return res.json({ id: 'halloween', title: kids == null ? 'Halloween Horror Picks' : 'Halloween Picks', items: [] }); }
    let items;
    if (kids == null) {
      const today = new Date().toISOString().slice(0, 10);
      const [pop, classics] = await Promise.all([
        catalog.get('/discover/movie', { with_genres: '27', sort_by: 'popularity.desc', 'vote_count.gte': 300, 'primary_release_date.lte': today, include_adult: 'false' }, H6).then((d) => cards(d.results, 'movie')),
        catalog.get('/discover/movie', { with_genres: '27', sort_by: 'vote_count.desc', 'vote_count.gte': 1500, 'primary_release_date.lte': '1999-12-31', include_adult: 'false' }, 7 * 864e5).then((d) => cards(d.results, 'movie')),
      ]);
      items = mix(pop, classics, 24);
    } else {
      const lte = GB_LTE[kids]; const k = await halloweenKeyword().catch(() => null);
      const base = { certification_country: 'GB', 'certification.lte': lte, sort_by: 'popularity.desc', 'vote_count.gte': 30, include_adult: 'false' };
      const [mv, tv] = await Promise.all([
        catalog.get('/discover/movie', k ? { ...base, with_keywords: String(k), with_genres: '10751|16' } : { ...base, with_genres: '10751,14' }, H6).then((d) => cards(d.results, 'movie')).catch(() => []),
        k ? catalog.get('/discover/tv', { with_keywords: String(k), with_genres: '10762|10751|16', sort_by: 'popularity.desc', 'vote_count.gte': 5 }, H6).then((d) => cards(d.results, 'tv')).catch(() => []) : [],
      ]);
      items = mix(mv, tv, 24);
    }
    cacheFor(res, 1800);
    res.json({ id: 'halloween', title: kids == null ? 'Halloween Horror Picks' : 'Halloween Picks', kids, items: items.map(mark) });
  }));
}
