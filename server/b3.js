// GhostFlix batch-3 API: skip-segment timings, broken-source reports (and later: stats, push).
// Mounted from index.js. Server-side Supabase access uses SUPABASE_URL + SUPABASE_SERVICE_KEY (RLS bypass);
// the tables here have RLS on with no anon/authenticated grants, so only this server can read/write them.
import crypto from 'node:crypto';
import { mountCatalog } from './b3-catalog.js';

export function supa(env) {
  if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_KEY) return null;
  const base = env.SUPABASE_URL.replace(/\/$/, '') + '/rest/v1/';
  return async (path, { method = 'GET', body, prefer } = {}) => {
    const r = await fetch(base + path, { method, headers: { apikey: env.SUPABASE_SERVICE_KEY, Authorization: `Bearer ${env.SUPABASE_SERVICE_KEY}`, 'Content-Type': 'application/json', ...(prefer ? { Prefer: prefer } : {}) }, body: body ? JSON.stringify(body) : undefined });
    if (!r.ok) { const e = new Error(`supabase ${r.status}`); e.detail = (await r.text()).slice(0, 200); throw e; }
    return r.status === 204 ? null : r.json().catch(() => null);
  };
}

// Tiny fixed-window rate limiter per key.
export function limiter(max, windowMs) {
  const m = new Map();
  return (key) => {
    const now = Date.now(); let v = m.get(key);
    if (!v || v.reset < now) { v = { n: 0, reset: now + windowMs }; m.set(key, v); }
    if (m.size > 5000) for (const [k, x] of m) if (x.reset < now) m.delete(k);
    return ++v.n <= max;
  };
}

export const deviceOf = (ua = '') => (/ipad|tablet/i.test(ua) ? 'tablet' : /mobi|iphone|android/i.test(ua) ? 'mobile' : 'desktop');

export function mountB3(app, { env, wrap, cacheFor, catalog, markList }) {
  const sb = supa(env);
  mountCatalog(app, { env, wrap, cacheFor, catalog, markList });

  // ---- skip intro / recap: TheIntroDB (api.theintrodb.org, free, no key, community-verified) ----
  const SEG = new Map(); // key -> { at, data }
  const segOf = (arr, dur) => (Array.isArray(arr) ? arr : []).map((x) => ({ start: x.start_ms == null ? 0 : x.start_ms / 1000, end: x.end_ms == null ? null : x.end_ms / 1000 }))
    .filter((x) => x.end == null || (x.end > x.start && (!dur || x.end <= dur + 5)));
  app.get('/api/segments/:type/:id', wrap(async (req, res) => {
    const type = req.params.type === 'tv' ? 'tv' : req.params.type === 'movie' ? 'movie' : null;
    const id = parseInt(req.params.id, 10); if (!type || !(id > 0)) return res.status(400).json({ error: 'Bad request' });
    const s = parseInt(req.query.s, 10), e = parseInt(req.query.e, 10), dur = Math.round(+req.query.dur || 0);
    if (type === 'tv' && !(s >= 0 && e > 0)) return res.status(400).json({ error: 'Season and episode needed' });
    const key = `${type}:${id}:${type === 'tv' ? `${s}:${e}` : ''}:${dur ? Math.round(dur / 60) : ''}`;
    let hit = SEG.get(key);
    if (!hit || Date.now() - hit.at > 12 * 3600e3) {
      const q = new URLSearchParams({ tmdb_id: String(id) });
      if (type === 'tv') { q.set('season', String(s)); q.set('episode', String(e)); }
      if (dur > 60) q.set('duration_ms', String(dur * 1000));
      let data = { source: 'theintrodb', intro: [], recap: [], credits: [] };
      try {
        const r = await fetch(`https://api.theintrodb.org/v4/media?${q}`, { signal: AbortSignal.timeout(6000), headers: { 'User-Agent': 'GhostFlix (ghostflix.uk)' } });
        if (r.ok) {
          const j = await r.json();
          // Timings are for one specific cut. If any segment starts after the end of the stream we're playing, it's a different
          // cut (e.g. no recap) and every timestamp may be shifted, so the client must not offer skip buttons.
          const all = ['intro', 'recap', 'credits'].flatMap((k) => (Array.isArray(j[k]) ? j[k] : []));
          const reliable = !(dur > 0 && all.some((x) => (x.start_ms || 0) / 1000 > dur - 5 || (x.end_ms != null && x.end_ms / 1000 > dur + 5)));
          data = { source: 'theintrodb', reliable, intro: segOf(j.intro, dur), recap: segOf(j.recap, dur), credits: segOf(j.credits, dur) };
        }
      } catch {}
      hit = { at: Date.now(), data }; SEG.set(key, hit);
      if (SEG.size > 3000) SEG.delete(SEG.keys().next().value);
    }
    cacheFor(res, 3600); res.json(hit.data);
  }));

  // ---- broken-source reports ----
  const okReport = limiter(30, 3600e3);
  app.post('/api/report-source', wrap(async (req, res) => {
    const b = req.body || {};
    const type = b.type === 'tv' ? 'tv' : b.type === 'movie' ? 'movie' : null, id = parseInt(b.id, 10);
    const source = String(b.source || '').slice(0, 40).trim();
    if (!type || !(id > 0) || !source) return res.status(400).json({ error: 'Bad report' });
    if (!okReport(req.ip)) return res.status(429).json({ error: 'Too many reports — thanks, we’ve got it.' });
    const row = { media_type: type, tmdb_id: id, season: Number.isInteger(+b.s) && b.s !== null ? +b.s : null, episode: Number.isInteger(+b.e) && b.e !== null ? +b.e : null,
      source, reason: String(b.reason || 'broken').slice(0, 80), device: deviceOf(req.get('user-agent')),
      visitor: crypto.createHash('sha256').update(`${req.ip}|${new Date().toISOString().slice(0, 10)}|${env.SESSION_SECRET || 'gf'}`).digest('hex').slice(0, 16) };
    if (sb) { try { await sb('ghostflix_source_reports', { method: 'POST', body: row, prefer: 'return=minimal' }); } catch (e) { console.warn('[report] save failed', e.message); } }
    else console.log('[report] broken source', row.media_type, row.tmdb_id, row.season, row.episode, row.source);
    res.json({ ok: true });
  }));

  return { sb };
}
