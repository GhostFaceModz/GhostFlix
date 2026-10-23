// GhostFlix Stage D: first-party visitor stats + web push. No third-party trackers.
// - Events go to public.ghostflix_events (RLS on, no policies, no anon/authenticated grants) via the service key.
// - Visitors are an HMAC of (day, IP, user agent) with a server secret: changes every UTC day, IPs are never stored.
// - Live users are an in-memory heartbeat map (last 2 minutes) on this server instance.
// - Push subscriptions live in public.ghostflix_push_subs (server-only). Sender: POST /api/cron/push (pg_cron + pg_net hourly,
//   cron key checked against Supabase Vault) plus an in-process hourly timer while the server is awake.
import crypto from 'node:crypto';
import webpush from 'web-push';
import { supa, limiter, deviceOf } from './b3.js';

const BOT = /bot|crawl|spider|slurp|headless|lighthouse|preview|facebookexternalhit|embedly|curl|wget|python|axios|node-fetch|monitor|uptime/i;
const LIVE_MS = 2 * 60 * 1000;
const clip = (v, n) => (v == null ? null : String(v).slice(0, n) || null);
const today = () => new Date().toISOString().slice(0, 10);

export function mountStats(app, { env, wrap, admin, catalog }) {
  const sb = supa(env);
  const secret = env.SESSION_SECRET || env.SUPABASE_SERVICE_KEY || 'gf-stats';
  const visitorOf = (req) => crypto.createHmac('sha256', secret).update(`${today()}|${req.ip}|${req.get('user-agent') || ''}`).digest('hex').slice(0, 24);
  const live = new Map(); // visitor -> { at, path, device, sa }
  const okTrack = limiter(120, 60_000);
  let queue = [];
  const flush = async () => {
    if (!queue.length || !sb) { queue = []; return; }
    const rows = queue.splice(0, 200);
    try { await sb('ghostflix_events', { method: 'POST', body: rows, prefer: 'return=minimal' }); } catch (e) { console.warn('[stats] insert failed', e.message, e.detail || ''); }
  };
  setInterval(flush, 5000).unref();

  app.post('/api/track', (req, res) => {
    res.status(204).end();
    const ua = req.get('user-agent') || '';
    if (BOT.test(ua) || req.get('sec-gpc') === '1' || req.get('dnt') === '1') return;
    if (!okTrack(req.ip)) return;
    let b = req.body || {};
    if (typeof b === 'string') { try { b = JSON.parse(b); } catch { return; } }
    const kind = b.k === 'play' ? 'play' : b.k === 'pv' ? 'pv' : b.k === 'hb' ? 'hb' : null;
    if (!kind) return;
    const visitor = visitorOf(req);
    const device = /smart-?tv|tizen|webos|appletv|android tv|bravia|crkey/i.test(ua) ? 'tv' : deviceOf(ua);
    const sa = b.sa === true;
    const path = clip(String(b.p || '').split('?')[0].replace(/[^\w\-/.%]/g, ''), 200);
    live.set(visitor, { at: Date.now(), path, device, sa });
    if (live.size > 20000) for (const [k, v] of live) if (Date.now() - v.at > LIVE_MS) live.delete(k);
    if (kind === 'hb') return;
    let ref = null;
    try { if (b.r) { const h = new URL(String(b.r)).hostname.replace(/^www\./, ''); if (h && !/(^|\.)ghostflix\.uk$/i.test(h) && h !== req.hostname) ref = clip(h, 120); } } catch {}
    const cc = String(req.get('cf-ipcountry') || req.get('x-vercel-ip-country') || req.get('x-country-code') || '').toUpperCase();
    queue.push({ kind, visitor, path, device, standalone: sa, signed_in: b.si === true, ref,
      title_key: /^(movie|tv):\d{1,10}$/.test(b.t || '') ? b.t : null, title: clip(b.tt, 200), source: kind === 'play' ? clip(b.src, 80) : null,
      country: /^[A-Z]{2}$/.test(cc) && cc !== 'XX' ? cc : null });
    if (queue.length >= 50) flush();
  });

  const liveNow = () => { const now = Date.now(); const out = []; for (const [k, v] of live) { if (now - v.at > LIVE_MS) live.delete(k); else out.push(v); } return out; };

  admin.get('/stats', wrap(async (req, res) => {
    const days = Math.max(1, Math.min(90, parseInt(req.query.days, 10) || 30));
    await flush();
    const l = liveNow();
    const livePages = Object.entries(l.reduce((m, v) => ((m[v.path || '/'] = (m[v.path || '/'] || 0) + 1), m), {})).sort((a, b) => b[1] - a[1]).slice(0, 8).map(([path, n]) => ({ path, n }));
    let stats = null, error = null;
    if (sb) { try { stats = await sb('rpc/ghostflix_stats', { method: 'POST', body: { days } }); } catch (e) { error = 'Stats query failed'; console.warn('[stats]', e.message, e.detail || ''); } }
    else error = 'Supabase is not configured';
    res.set('Cache-Control', 'no-store').json({ live: { now: l.length, installed: l.filter((v) => v.sa).length, pages: livePages, note: 'This server instance only, last 2 min' }, stats, error, push: { configured: !!(env.VAPID_PUBLIC_KEY && env.VAPID_PRIVATE_KEY) } });
  }));

  // ---------------------------------------------------------------- web push
  const pushOn = !!(env.VAPID_PUBLIC_KEY && env.VAPID_PRIVATE_KEY && sb);
  if (pushOn) webpush.setVapidDetails(env.VAPID_SUBJECT || 'https://ghostflix.uk', env.VAPID_PUBLIC_KEY, env.VAPID_PRIVATE_KEY);
  const okPush = limiter(30, 60_000);
  const cleanList = (a, fn, max) => (Array.isArray(a) ? a.slice(0, max).map(fn).filter(Boolean) : []);
  const showOf = (x) => { const id = parseInt(x?.id, 10); return id > 0 ? { id, title: clip(x.title, 120) || '' } : null; };
  const remOf = (x) => (/^(movie|tv):\d{1,10}$/.test(x?.key || '') && /^\d{4}-\d{2}-\d{2}$/.test(x?.date || '') ? { key: x.key, title: clip(x.title, 120) || '', date: x.date, label: clip(x.label, 60) } : null);

  app.get('/api/push/key', (req, res) => res.set('Cache-Control', 'no-store').json({ key: pushOn ? env.VAPID_PUBLIC_KEY : null }));
  app.post('/api/push/subscribe', wrap(async (req, res) => {
    if (!pushOn) return res.status(503).json({ error: 'Notifications aren’t set up yet' });
    if (!okPush(req.ip)) return res.status(429).json({ error: 'Slow down a moment' });
    const s = req.body?.sub || {};
    const endpoint = String(s.endpoint || ''), p256dh = String(s.keys?.p256dh || ''), auth = String(s.keys?.auth || '');
    if (!/^https:\/\//.test(endpoint) || endpoint.length > 1000 || !p256dh || p256dh.length > 200 || !auth || auth.length > 100) return res.status(400).json({ error: 'Bad subscription' });
    const row = { endpoint, p256dh, auth, ua: deviceOf(req.get('user-agent')), updated_at: new Date().toISOString(), fails: 0,
      shows: cleanList(req.body.shows, showOf, 200), reminders: cleanList(req.body.reminders, remOf, 200) };
    await sb('ghostflix_push_subs?on_conflict=endpoint', { method: 'POST', body: row, prefer: 'resolution=merge-duplicates,return=minimal' });
    res.json({ ok: true, shows: row.shows.length, reminders: row.reminders.length });
  }));
  app.post('/api/push/unsubscribe', wrap(async (req, res) => {
    const endpoint = String(req.body?.endpoint || '');
    if (sb && /^https:\/\//.test(endpoint)) await sb(`ghostflix_push_subs?endpoint=eq.${encodeURIComponent(endpoint)}`, { method: 'DELETE', prefer: 'return=minimal' }).catch(() => {});
    res.json({ ok: true });
  }));
  app.post('/api/push/test', wrap(async (req, res) => {
    if (!pushOn) return res.status(503).json({ error: 'Notifications aren’t set up yet' });
    if (!okPush(req.ip)) return res.status(429).json({ error: 'Slow down a moment' });
    const endpoint = String(req.body?.endpoint || '');
    const rows = /^https:\/\//.test(endpoint) ? await sb(`ghostflix_push_subs?endpoint=eq.${encodeURIComponent(endpoint)}&select=endpoint,p256dh,auth`) : [];
    if (!rows?.length) return res.status(404).json({ error: 'Subscription not found — toggle notifications off and on' });
    try { await send(rows[0], { title: 'GhostFlix notifications are on 👻', body: 'We’ll tell you when new episodes and reminded titles land.', url: '/settings/preferences', tag: 'gf-test' }); res.json({ ok: true }); }
    catch (e) { res.status(502).json({ error: `Push service said ${e.statusCode || 'no'}` }); }
  }));

  const send = (row, payload) => webpush.sendNotification({ endpoint: row.endpoint, keys: { p256dh: row.p256dh, auth: row.auth } }, JSON.stringify(payload), { TTL: 86400, urgency: 'normal' });
  const daysAgo = (n) => new Date(Date.now() - n * 864e5).toISOString().slice(0, 10);
  let running = null;
  async function runSender() {
    if (!pushOn) return { skipped: 'not configured' };
    if (running) return running;
    running = (async () => {
      const rows = (await sb('ghostflix_push_subs?select=*&order=updated_at.desc&limit=2000')) || [];
      const ids = [...new Set(rows.flatMap((r) => (r.shows || []).map((s) => s.id)))].slice(0, 400);
      const eps = new Map(); const t = today(), since = daysAgo(2);
      for (const id of ids) {
        try {
          const d = await catalog.get(`/tv/${id}`, {}, 3 * 3600e3);
          const ep = d?.last_episode_to_air;
          if (ep?.air_date && ep.air_date >= since && ep.air_date <= t) eps.set(id, { name: d.name, s: ep.season_number, e: ep.episode_number, ep: ep.name, code: `${ep.season_number}x${ep.episode_number}` });
        } catch {}
      }
      let sent = 0, removed = 0, failed = 0;
      for (const r of rows) {
        const was = r.sent || {}, now = { ...was }, notes = [];
        for (const s of r.shows || []) { const x = eps.get(s.id); if (x && was[`tv:${s.id}`] !== x.code) { now[`tv:${s.id}`] = x.code; notes.push({ title: `New episode: ${x.name}`, body: `S${x.s} · E${x.e}${x.ep ? ` “${x.ep}”` : ''} is out now`, url: `/title/tv/${s.id}`, tag: `tv-${s.id}` }); } }
        for (const m of r.reminders || []) { if (m.date <= t && m.date >= daysAgo(14) && !was[`r:${m.key}`]) { now[`r:${m.key}`] = m.date; notes.push({ title: `${m.title || 'A title you’re waiting for'} is out`, body: m.label ? `${m.label} — tap to take a look` : 'Your reminder: it’s out now', url: `/title/${m.key.replace(':', '/')}`, tag: `r-${m.key}` }); } }
        if (!notes.length) continue;
        const batch = notes.length > 3 ? [{ title: `${notes.length} things you follow are out`, body: notes.slice(0, 4).map((n) => n.title.replace(/^New episode: /, '')).join(', '), url: '/coming-soon', tag: 'gf-batch' }] : notes;
        try {
          for (const p of batch) { await send(r, p); sent++; }
          await sb(`ghostflix_push_subs?endpoint=eq.${encodeURIComponent(r.endpoint)}`, { method: 'PATCH', body: { sent: now, last_sent_at: new Date().toISOString(), fails: 0 }, prefer: 'return=minimal' });
        } catch (e) {
          console.warn('[push] send failed', e.statusCode || '');
          if (e.statusCode === 410 || (e.statusCode === 404 && (r.fails || 0) >= 2)) { removed++; await sb(`ghostflix_push_subs?endpoint=eq.${encodeURIComponent(r.endpoint)}`, { method: 'DELETE', prefer: 'return=minimal' }).catch(() => {}); }
          else { failed++; await sb(`ghostflix_push_subs?endpoint=eq.${encodeURIComponent(r.endpoint)}`, { method: 'PATCH', body: { fails: (r.fails || 0) + 1 }, prefer: 'return=minimal' }).catch(() => {}); }
        }
      }
      return { subs: rows.length, shows: ids.length, newEpisodes: eps.size, sent, removed, failed };
    })().finally(() => { setTimeout(() => { running = null; }, 0); });
    return running;
  }
  app.post('/api/cron/push', wrap(async (req, res) => {
    const k = String(req.get('x-cron-secret') || '');
    let ok = !!(env.CRON_SECRET && k && k.length === env.CRON_SECRET.length && crypto.timingSafeEqual(Buffer.from(k), Buffer.from(env.CRON_SECRET)));
    if (!ok && sb && k && k.length <= 200) { try { ok = (await sb('rpc/ghostflix_cron_ok', { method: 'POST', body: { k } })) === true; } catch {} }
    if (!ok) return res.status(401).json({ error: 'Unauthorized' });
    res.json(await runSender());
  }));
  if (pushOn) setInterval(() => runSender().then((r) => r.sent && console.log('[push] sent', r.sent)).catch((e) => console.warn('[push] run failed', e.message)), 3600e3).unref();
  return { runSender };
}
