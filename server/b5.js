// GhostFlix Stages E/F: community (public profiles, friends, watch-together chat, activity/achievements), mood + Top 10 rows,
// request-a-title / bug reports (Reports inbox), admin tools (schedules, users, backups, health, content controls, feature
// switches, roles) and the moderator API (/api/mod/*).
// - Signed-in calls send the Supabase access token (Authorization: Bearer); the server validates it with Supabase Auth.
// - Banned users (public.ghostflix_bans) get 403 on every account feature here, and restrictive RLS policies block their
//   direct table access; the ban is also applied in Supabase Auth so they can't sign in again until unbanned.
// - Moderator routes call PostgREST with the moderator's OWN token, so the database's RLS policies (ghostflix_is_mod) decide
//   what they can read or change. Admin routes stay behind the admin cookie and use the service key.
import crypto from 'node:crypto';
import { supa, limiter } from './b3.js';
import { card } from './tmdb.js';
import { rankOf as rankOfB6 } from './b6.js';

const clip = (v, n) => String(v ?? '').replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '').trim().slice(0, n);
const KEY_RE = /^(movie|tv):\d{1,10}$/;
const err = (status, message) => Object.assign(new Error(message), { status });
export const FEATURE_KEYS = [
  ['live', 'Live TV'], ['chat', 'Watch-together chat'], ['friends', 'Friends'], ['publicProfiles', 'Public profile links'], ['themes', 'Seasonal themes'],
  ['top10', 'Top 10 on GhostFlix'], ['moods', 'Mood picker'], ['requests', 'Request a title'], ['bugs', 'Bug reports'],
  ['achievements', 'Achievements & streaks'], ['countdowns', 'Countdown timers'], ['push', 'Push notifications'],
];
export const MOODS = {
  scared: { label: 'Scared', emoji: '😱', movie: '27|53', tv: '9648|10765', kw: ['supernatural', 'haunted house', 'slasher'] },
  funny: { label: 'Funny', emoji: '😂', movie: '35', tv: '35', kw: ['stand-up comedy', 'parody', 'slapstick comedy'] },
  cosy: { label: 'Cosy', emoji: '☕', movie: '10751|16', tv: '10751|35', kw: ['feel-good', 'heartwarming', 'christmas'] },
  mindblown: { label: 'Mind-blown', emoji: '🤯', movie: '878|9648', tv: '10765|9648', kw: ['twist ending', 'time travel', 'mind-bending'] },
  romantic: { label: 'Romantic', emoji: '💘', movie: '10749', tv: '10749|18', kw: ['romantic comedy', 'love at first sight', 'first love'] },
  action: { label: 'Action-packed', emoji: '💥', movie: '28|12', tv: '10759', kw: ['martial arts', 'heist', 'car chase'] },
};
/** Scheduled themes/banners: the entry active right now (by kind), or null. */
export function activeScheduled(list, kind, now = Date.now()) {
  return (Array.isArray(list) ? list : []).filter((x) => x.kind === kind && Date.parse(x.start) <= now && now < Date.parse(x.end)).sort((a, b) => Date.parse(b.start) - Date.parse(a.start))[0] || null;
}

export function mountB5(app, { env, wrap, cacheFor, isAdmin, admin, store, catalog, stats, siteCfg }) {
  const sb = supa(env);
  const AUTH_URL = (env.SUPABASE_PUBLIC_URL || env.SUPABASE_URL || '').replace(/\/$/, '');
  const ANON = env.SUPABASE_ANON_KEY;
  const SRV = (env.SUPABASE_URL || '').replace(/\/$/, '');
  const adminIds = String(env.ADMIN_DISCORD_ID || '').split(',').map((x) => x.trim()).filter(Boolean);
  const feat = (k) => (k === 'live' ? store.data.site?.sections?.live !== false : store.data.site?.features?.[k] !== false);
  const needFeat = (k) => { if (!feat(k)) throw err(403, 'This feature is switched off right now.'); };
  const needSb = () => { if (!sb) throw err(503, 'Accounts aren’t set up on this server.'); };

  // ---------------------------------------------------------------- auth helpers
  const tokCache = new Map(), banCache = new Map();
  const tokenOf = (req) => String(req.get('authorization') || '').replace(/^Bearer\s+/i, '').trim();
  async function userOf(req) {
    const tok = tokenOf(req); if (!tok || tok.length > 4000 || !AUTH_URL || !ANON) return null;
    const h = crypto.createHash('sha256').update(tok).digest('hex');
    let c = tokCache.get(h);
    if (!c || Date.now() - c.at > 60e3) {
      const r = await fetch(`${AUTH_URL}/auth/v1/user`, { headers: { apikey: ANON, Authorization: `Bearer ${tok}` }, signal: AbortSignal.timeout(6000) }).catch(() => null);
      if (!r?.ok) { tokCache.delete(h); return null; }
      const u = await r.json(); const m = u.user_metadata || {};
      const discord = (u.identities || []).filter((i) => i.provider === 'discord').map((i) => String(i.id || i.identity_data?.provider_id || i.identity_data?.sub));
      c = { at: Date.now(), u: { id: u.id, name: clip(m.custom_claims?.global_name || m.full_name || m.name || m.user_name || (u.email || 'Viewer').split('@')[0], 40), avatar: clip(m.avatar_url || m.picture || '', 400), discord, token: tok } };
      tokCache.set(h, c); if (tokCache.size > 3000) tokCache.delete(tokCache.keys().next().value);
    }
    return { ...c.u, token: tok };
  }
  async function bannedNow(uid) {
    const c = banCache.get(uid); if (c && Date.now() - c.at < 30e3) return c.v;
    let v = false; if (sb) { try { v = !!(await sb(`ghostflix_bans?select=user_id&user_id=eq.${uid}`))?.length; } catch {} }
    banCache.set(uid, { at: Date.now(), v }); return v;
  }
  async function needUser(req) {
    needSb(); const u = await userOf(req); if (!u) throw err(401, 'Sign in first.');
    if (await bannedNow(u.id)) throw err(403, 'Your account is suspended.');
    touchSeen(u); return u;
  }
  const seenAt = new Map();
  function touchSeen(u) {
    if (!sb || Date.now() - (seenAt.get(u.id) || 0) < 5 * 60e3) return; seenAt.set(u.id, Date.now());
    sb('ghostflix_social?on_conflict=user_id', { method: 'POST', body: { user_id: u.id, display_name: u.name, last_seen: new Date().toISOString() }, prefer: 'resolution=merge-duplicates,return=minimal' }).catch(() => {});
  }
  // PostgREST as the signed-in user (RLS applies).
  const asUser = (tok) => async (path, { method = 'GET', body, prefer } = {}) => {
    const r = await fetch(`${AUTH_URL}/rest/v1/${path}`, { method, headers: { apikey: ANON, Authorization: `Bearer ${tok}`, 'Content-Type': 'application/json', ...(prefer ? { Prefer: prefer } : {}) }, body: body ? JSON.stringify(body) : undefined });
    if (!r.ok) throw err(r.status === 401 || r.status === 403 ? 403 : 502, `Not allowed (${r.status})`);
    return r.status === 204 ? null : r.json().catch(() => null);
  };
  const authAdmin = (path, opts = {}) => fetch(`${SRV}/auth/v1/admin/${path}`, { ...opts, headers: { apikey: env.SUPABASE_SERVICE_KEY, Authorization: `Bearer ${env.SUPABASE_SERVICE_KEY}`, 'Content-Type': 'application/json' } });
  const rid = (n) => { const a = 'abcdefghijkmnpqrstuvwxyz23456789'; return [...crypto.randomBytes(n)].map((b) => a[b % a.length]).join(''); };

  // ---------------------------------------------------------------- me / social
  app.post('/api/me/ping', wrap(async (req, res) => {
    const u = await userOf(req); if (!u || !sb) return res.json({ signedIn: false });
    const banned = await bannedNow(u.id); if (!banned) touchSeen(u);
    let mod = false; try { mod = !banned && !!(await asUser(u.token)(`ghostflix_roles?select=role&user_id=eq.${u.id}`))?.length; } catch {}
    res.set('Cache-Control', 'no-store').json({ signedIn: true, banned, mod, admin: adminIds.length > 0 && u.discord.some((d) => adminIds.includes(d)) });
  }));
  async function socialRow(u, create) {
    let r = (await sb(`ghostflix_social?user_id=eq.${u.id}&select=*`))?.[0];
    if (!r || (create && !r.friend_code)) {
      for (let i = 0; i < 4; i++) {
        try { r = (await sb('ghostflix_social?on_conflict=user_id', { method: 'POST', body: { user_id: u.id, display_name: u.name, friend_code: r?.friend_code || rid(8), last_seen: new Date().toISOString() }, prefer: 'resolution=merge-duplicates,return=representation' }))?.[0]; break; } catch (e) { if (i === 3) throw e; }
      }
    }
    return r;
  }
  app.get('/api/me/social', wrap(async (req, res) => {
    const u = await needUser(req); const r = await socialRow(u, true);
    res.set('Cache-Control', 'no-store').json({ code: r.friend_code, friends_on: r.friends_on, share_watching: r.share_watching, name: r.display_name || u.name });
  }));
  app.put('/api/me/social', wrap(async (req, res) => {
    const u = await needUser(req); await socialRow(u, true); const b = req.body || {}; const patch = { updated_at: new Date().toISOString() };
    if ('friends_on' in b) { needFeat('friends'); patch.friends_on = !!b.friends_on; }
    if ('share_watching' in b) patch.share_watching = !!b.share_watching;
    if (patch.share_watching === false || patch.friends_on === false) { patch.watching = null; patch.watching_at = null; }
    if ('name' in b) patch.display_name = clip(b.name, 40) || u.name;
    const r = (await sb(`ghostflix_social?user_id=eq.${u.id}`, { method: 'PATCH', body: patch, prefer: 'return=representation' }))?.[0];
    res.json({ code: r.friend_code, friends_on: r.friends_on, share_watching: r.share_watching, name: r.display_name });
  }));
  const okWatch = limiter(30, 60e3);
  app.post('/api/me/watching', wrap(async (req, res) => {
    const u = await needUser(req); if (!okWatch(u.id)) return res.status(429).json({ error: 'Slow down' });
    const b = req.body || {}; const w = b && KEY_RE.test(b.key || '') ? { key: b.key, title: clip(b.title, 120), sub: clip(b.sub, 60), href: /^\/(watch|title)\/(movie|tv)\/\d+/.test(b.href || '') ? clip(b.href, 120) : '' } : null;
    await sb(`ghostflix_social?user_id=eq.${u.id}&share_watching=is.true&friends_on=is.true`, { method: 'PATCH', body: { watching: w, watching_at: w ? new Date().toISOString() : null }, prefer: 'return=minimal' });
    res.json({ ok: true });
  }));

  // ---------------------------------------------------------------- public profile links (opt-in, per profile)
  const cardOf = (x) => (x && KEY_RE.test(`${x.media_type}:${x.id}`) ? { id: +x.id, media_type: x.media_type, title: clip(x.title, 120), year: x.year ? +x.year || null : null, poster: /^https:\/\/image\.tmdb\.org\//.test(x.poster || '') ? x.poster : null } : null);
  const listOf = (a, n) => (Array.isArray(a) ? a.slice(0, n).map(cardOf).filter(Boolean) : []);
  const badgesOf = (a) => (Array.isArray(a) ? a.slice(0, 40).map((x) => ({ id: clip(x?.id, 30), icon: clip(x?.icon, 8), name: clip(x?.name, 40) })).filter((x) => x.id) : []);
  app.get('/api/me/public/:pid', wrap(async (req, res) => {
    const u = await needUser(req); const pid = clip(req.params.pid, 20);
    const r = (await sb(`ghostflix_public_profiles?user_id=eq.${u.id}&profile_id=eq.${encodeURIComponent(pid)}&select=*`))?.[0] || null;
    res.set('Cache-Control', 'no-store').json(r ? { ...r, user_id: undefined } : { enabled: false });
  }));
  app.put('/api/me/public/:pid', wrap(async (req, res) => {
    needFeat('publicProfiles'); const u = await needUser(req); const pid = clip(req.params.pid, 20); if (!/^[a-z0-9]{1,20}$/i.test(pid)) throw err(400, 'Bad profile');
    const b = req.body || {}; const cur = (await sb(`ghostflix_public_profiles?user_id=eq.${u.id}&profile_id=eq.${encodeURIComponent(pid)}&select=slug`))?.[0];
    const row = { user_id: u.id, profile_id: pid, slug: cur?.slug || rid(10), enabled: !!b.enabled, name: clip(b.name, 40) || 'Viewer', color: /^#[0-9a-f]{6}$/i.test(b.color || '') ? b.color : '#5fe3ff',
      avatar: /^https:\/\//.test(b.avatar || '') ? clip(b.avatar, 400) : null, bio: clip(b.bio, 300).replace(/[\u202a-\u202e\u2066-\u2069\ufeff]/g, ''), genres: (Array.isArray(b.genres) ? b.genres : []).map((g) => parseInt(g, 10)).filter((g) => g > 0 && g < 1e6).slice(0, 8),
      lists: listOf(b.lists, 60), show_history: !!b.show_history, history: b.show_history ? listOf(b.history, 30) : [], badges: badgesOf(b.badges), updated_at: new Date().toISOString() };
    const r = (await sb('ghostflix_public_profiles?on_conflict=user_id,profile_id', { method: 'POST', body: row, prefer: 'resolution=merge-duplicates,return=representation' }))?.[0];
    res.json({ ...r, user_id: undefined });
  }));
  app.get('/api/u/:slug', wrap(async (req, res) => {
    if (!feat('publicProfiles') || !sb || !/^[a-z0-9]{10}$/.test(req.params.slug)) throw err(404, 'This profile isn’t public.');
    const r = (await sb(`ghostflix_public_profiles?slug=eq.${req.params.slug}&enabled=is.true&select=slug,name,color,avatar,bio,genres,lists,show_history,history,badges,updated_at,user_id`))?.[0];
    if (!r || (await bannedNow(r.user_id))) throw err(404, 'This profile isn’t public.');
    r.tag = await tagOf(r.user_id); delete r.user_id; if (!r.show_history) r.history = [];
    res.set('Cache-Control', 'no-store').json(r);
  }));

  // ---------------------------------------------------------------- friends (opt-in)
  const pair = (x, y) => (x < y ? [x, y] : [y, x]);
  app.get('/api/friends', wrap(async (req, res) => {
    needFeat('friends'); const u = await needUser(req); const me = await socialRow(u, true);
    const rows = (await sb(`ghostflix_friends?or=(a.eq.${u.id},b.eq.${u.id})&select=*`)) || [];
    const other = (r) => (r.a === u.id ? r.b : r.a);
    const ids = rows.map(other); const prof = {};
    if (ids.length) for (const s of (await sb(`ghostflix_social?user_id=in.(${ids.join(',')})&select=user_id,display_name,friends_on,share_watching,watching,watching_at,last_seen`)) || []) prof[s.user_id] = s;
    const tags = await tagsOf(ids);
    const view = (r) => { const p = prof[other(r)] || {}; const fresh = p.watching_at && Date.now() - Date.parse(p.watching_at) < 6 * 3600e3;
      return { id: other(r), name: p.display_name || 'Viewer', tag: tags[other(r)] || null, since: r.created_at, watching: r.status === 'accepted' && p.friends_on && p.share_watching && fresh ? { ...p.watching, at: p.watching_at } : null }; };
    res.set('Cache-Control', 'no-store').json({ on: me.friends_on, code: me.friend_code, share_watching: me.share_watching,
      friends: rows.filter((r) => r.status === 'accepted').map(view), incoming: rows.filter((r) => r.status === 'pending' && r.requested_by !== u.id).map(view), outgoing: rows.filter((r) => r.status === 'pending' && r.requested_by === u.id).map(view) });
  }));
  const okFriend = limiter(20, 3600e3);
  app.post('/api/friends/add', wrap(async (req, res) => {
    needFeat('friends'); const u = await needUser(req); if (!okFriend(u.id)) throw err(429, 'Too many friend requests — try later.');
    const me = await socialRow(u, true); if (!me.friends_on) throw err(400, 'Turn on Friends first.');
    const code = String(req.body?.code || '').toLowerCase().replace(/[^a-z0-9]/g, '').slice(-8);
    const t = (await sb(`ghostflix_social?friend_code=eq.${code}&friends_on=is.true&select=user_id,display_name`))?.[0];
    if (!t || t.user_id === u.id) throw err(404, t ? 'That’s your own code.' : 'No one with Friends turned on has that code.');
    if (await bannedNow(t.user_id)) throw err(404, 'No one with Friends turned on has that code.');
    const [a, b] = pair(u.id, t.user_id);
    const ex = (await sb(`ghostflix_friends?a=eq.${a}&b=eq.${b}&select=*`))?.[0];
    if (ex?.status === 'accepted') return res.json({ ok: true, status: 'accepted', name: t.display_name });
    if (ex && ex.requested_by !== u.id) { await sb(`ghostflix_friends?a=eq.${a}&b=eq.${b}`, { method: 'PATCH', body: { status: 'accepted' }, prefer: 'return=minimal' }); return res.json({ ok: true, status: 'accepted', name: t.display_name }); }
    if (!ex) await sb('ghostflix_friends', { method: 'POST', body: { a, b, status: 'pending', requested_by: u.id }, prefer: 'return=minimal' });
    res.json({ ok: true, status: 'pending', name: t.display_name });
  }));
  const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  app.post('/api/friends/respond', wrap(async (req, res) => {
    needFeat('friends'); const u = await needUser(req); const id = String(req.body?.id || ''); if (!UUID.test(id)) throw err(400, 'Bad request');
    const [a, b] = pair(u.id, id);
    if (req.body?.accept) await sb(`ghostflix_friends?a=eq.${a}&b=eq.${b}&requested_by=eq.${id}&status=eq.pending`, { method: 'PATCH', body: { status: 'accepted' }, prefer: 'return=minimal' });
    else await sb(`ghostflix_friends?a=eq.${a}&b=eq.${b}&status=eq.pending`, { method: 'DELETE', prefer: 'return=minimal' });
    res.json({ ok: true });
  }));
  app.delete('/api/friends/:id', wrap(async (req, res) => {
    const u = await needUser(req); const id = req.params.id; if (!UUID.test(id)) throw err(400, 'Bad request');
    const [a, b] = pair(u.id, id); await sb(`ghostflix_friends?a=eq.${a}&b=eq.${b}`, { method: 'DELETE', prefer: 'return=minimal' }); res.json({ ok: true });
  }));

  // ---------------------------------------------------------------- watch-together chat (friends only; NOT Watch Parties sync)
  const ROOM = /^(movie|tv):[0-9]{1,10}(:[0-9]{1,3}:[0-9]{1,4})?$/;
  const okChatShort = limiter(5, 15e3), okChatLong = limiter(60, 3600e3);
  app.get('/api/chat/:room', wrap(async (req, res) => {
    needFeat('chat'); const u = await needUser(req); const room = req.params.room; if (!ROOM.test(room)) throw err(400, 'Bad room');
    const rows = (await asUser(u.token)(`ghostflix_chat?room=eq.${room}&select=id,user_id,name,body,created_at&order=created_at.desc&limit=60`)) || [];
    res.set('Cache-Control', 'no-store').json({ me: u.id, messages: rows.reverse(), tags: await tagsOf([u.id, ...rows.map((m) => m.user_id)]) });
  }));
  app.post('/api/chat/:room', wrap(async (req, res) => {
    needFeat('chat'); const u = await needUser(req); const room = req.params.room; if (!ROOM.test(room)) throw err(400, 'Bad room');
    const body = clip(req.body?.body, 300); if (!body) throw err(400, 'Say something first.');
    if (!okChatShort(u.id) || !okChatLong(u.id)) throw err(429, 'You’re sending messages too fast — wait a few seconds.');
    const me = await socialRow(u, true); if (!me.friends_on) throw err(400, 'Turn on Friends to chat with them.');
    const r = (await sb('ghostflix_chat', { method: 'POST', body: { room, user_id: u.id, name: me.display_name || u.name, body }, prefer: 'return=representation' }))?.[0];
    res.json({ id: r.id, user_id: r.user_id, name: r.name, body: r.body, created_at: r.created_at, tag: await tagOf(u.id) });
  }));

  // ---------------------------------------------------------------- Reports inbox: requests, bug reports, chat reports
  const okInbox = limiter(8, 3600e3);
  const visitorOf = (req) => crypto.createHash('sha256').update(`${req.ip}|${new Date().toISOString().slice(0, 10)}|${env.SESSION_SECRET || 'gf'}`).digest('hex').slice(0, 16);
  app.post('/api/inbox', wrap(async (req, res) => {
    needSb(); const b = req.body || {}; const kind = ['request', 'bug', 'chat'].includes(b.kind) ? b.kind : null; if (!kind) throw err(400, 'Bad report');
    if (kind === 'request') needFeat('requests'); if (kind === 'bug') needFeat('bugs');
    const u = await userOf(req).catch(() => null); if (u && (await bannedNow(u.id))) throw err(403, 'Your account is suspended.');
    if (kind === 'chat' && !u) throw err(401, 'Sign in first.');
    if (!okInbox(u?.id || req.ip)) throw err(429, 'Thanks — you’ve sent a lot already. Try again later.');
    const data = {};
    if (kind === 'request') { const c = cardOf(b.title_card); if (c) data.card = c; }
    if (kind === 'bug') { data.page = clip(b.page, 200); data.ua = clip(req.get('user-agent'), 200); data.viewport = clip(b.viewport, 20); data.app = clip(b.app, 20); }
    let title = clip(b.title, 200), body = clip(b.body, 2000);
    if (kind === 'chat') {
      const id = parseInt(b.message_id, 10); if (!(id > 0)) throw err(400, 'Bad report');
      const m = (await asUser(u.token)(`ghostflix_chat?id=eq.${id}&select=id,room,user_id,name,body,created_at`))?.[0]; if (!m) throw err(404, 'Message not found');
      Object.assign(data, { message: m }); title = `Chat message from ${m.name}`; body = clip(b.body, 500) || 'Reported from watch-together chat';
    }
    if (!title && !body) throw err(400, 'Tell us a little more.');
    let shot = null; if (kind === 'bug' && typeof b.screenshot === 'string' && /^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/=]+$/.test(b.screenshot) && b.screenshot.length <= 900000) shot = b.screenshot;
    await sb('ghostflix_inbox', { method: 'POST', body: { kind, title: title || (kind === 'bug' ? 'Bug report' : 'Request'), body, data, screenshot: shot, user_id: u?.id || null, visitor: visitorOf(req) }, prefer: 'return=minimal' });
    res.json({ ok: true });
  }));

  // ---------------------------------------------------------------- mood picker + Top 10 this week
  const kwIds = new Map();
  async function keywordId(q) {
    if (kwIds.has(q)) return kwIds.get(q);
    let id = null; try { const d = await catalog.get('/search/keyword', { query: q }, 7 * 864e5); id = (d.results || []).find((x) => x.name.toLowerCase() === q)?.id || d.results?.[0]?.id || null; } catch {}
    kwIds.set(q, id); return id;
  }
  const cardOfTmdb = (x, t) => ({ ...card(x, t), playable: true });
  app.get('/api/mood/:mood', wrap(async (req, res) => {
    needFeat('moods'); const m = MOODS[req.params.mood]; if (!m || catalog.mode === 'demo') throw err(404, 'Unknown mood');
    const kws = (await Promise.all(m.kw.map(keywordId))).filter(Boolean).join('|');
    const base = { sort_by: 'popularity.desc', include_adult: 'false', page: 1 };
    const [a, b, c] = await Promise.all([
      catalog.get('/discover/movie', { ...base, with_genres: m.movie, 'vote_count.gte': 300 }, 6 * 3600e3).catch(() => ({ results: [] })),
      kws ? catalog.get('/discover/movie', { ...base, with_keywords: kws, 'vote_count.gte': 100 }, 6 * 3600e3).catch(() => ({ results: [] })) : { results: [] },
      catalog.get('/discover/tv', { ...base, with_genres: m.tv, 'vote_count.gte': 100 }, 6 * 3600e3).catch(() => ({ results: [] })),
    ]);
    const lists = [a.results.map((x) => cardOfTmdb(x, 'movie')), b.results.map((x) => cardOfTmdb(x, 'movie')), c.results.map((x) => cardOfTmdb(x, 'tv'))];
    const seen = new Set(), out = [];
    for (let i = 0; i < 20 && out.length < 24; i++) for (const l of lists) { const x = l[i]; if (x && x.poster && !seen.has(`${x.media_type}:${x.id}`) && !hidden().has(`${x.media_type}:${x.id}`)) { seen.add(`${x.media_type}:${x.id}`); out.push(x); } }
    cacheFor(res, 1800); res.json({ mood: req.params.mood, title: `${m.emoji} ${m.label} picks`, items: out });
  }));
  app.get('/api/moods', (req, res) => { cacheFor(res, 3600); res.json(Object.entries(MOODS).map(([id, m]) => ({ id, label: m.label, emoji: m.emoji }))); });
  let top10 = { at: 0, items: [], distinct: 0 };
  app.get('/api/top10', wrap(async (req, res) => {
    if (!feat('top10') || !sb) return res.json({ items: [] });
    if (Date.now() - top10.at > 15 * 60e3) {
      const rows = (await sb('rpc/ghostflix_top10', { method: 'POST', body: { days: 7 } }).catch(() => [])) || [];
      const ok = rows.filter((r) => !hidden().has(r.title_key));
      let items = [];
      if (ok.length >= 10) items = (await Promise.all(ok.slice(0, 10).map(async (r) => { const [t, id] = r.title_key.split(':'); try { const d = await catalog.title(t, +id); return { ...d, media_type: t, playable: true }; } catch { return null; } }))).filter(Boolean);
      top10 = { at: Date.now(), items: items.length >= 10 ? items.slice(0, 10).map((d) => ({ id: d.id, media_type: d.media_type, title: d.title, year: d.year, poster: d.poster, backdrop: d.backdrop, backdrop_sm: d.backdrop_sm || d.backdrop, rating: d.rating, overview: d.overview, playable: true })) : [], distinct: rows.length };
    }
    cacheFor(res, 300); res.json({ items: top10.items });
  }));

  // ---------------------------------------------------------------- content controls helpers (used by index.js too)
  const hidden = () => new Set((store.data.content?.hidden || []).map((x) => x.key));
  const pins = () => store.data.content?.pins || [];

  // ================================================================= ADMIN (behind the admin cookie)
  const saveSite = async (patch) => { store.data.site = { ...(store.data.site || {}), ...patch }; await store.save(); };
  // 22: scheduled themes & banners
  const schedOf = (x) => {
    const kind = x?.kind === 'theme' ? 'theme' : x?.kind === 'banner' ? 'banner' : null; const s = Date.parse(x?.start), e = Date.parse(x?.end);
    if (!kind || !(s > 0) || !(e > s)) return null;
    return { id: /^[a-z0-9]{6,12}$/.test(x.id || '') ? x.id : rid(8), kind, start: new Date(s).toISOString(), end: new Date(e).toISOString(),
      theme: kind === 'theme' ? (['halloween', 'normal'].includes(x.theme) ? x.theme : 'halloween') : undefined,
      text: kind === 'banner' ? clip(x.text, 280) : undefined, color: kind === 'banner' && /^#[0-9a-f]{6}$/i.test(x.color || '') ? x.color : kind === 'banner' ? '#5fe3ff' : undefined };
  };
  admin.get('/schedule', (req, res) => res.set('Cache-Control', 'no-store').json({ items: store.data.site?.schedule || [], now: new Date().toISOString() }));
  admin.put('/schedule', wrap(async (req, res) => {
    const items = (Array.isArray(req.body?.items) ? req.body.items : []).slice(0, 50).map(schedOf).filter((x) => x && (x.kind === 'theme' || x.text));
    await saveSite({ schedule: items }); res.json({ items });
  }));
  // 48: feature switches
  admin.get('/features', (req, res) => res.set('Cache-Control', 'no-store').json({ keys: FEATURE_KEYS, features: Object.fromEntries(FEATURE_KEYS.map(([k]) => [k, feat(k)])) }));
  admin.put('/features', wrap(async (req, res) => {
    const b = req.body?.features || {}; const cur = store.data.site || {};
    const features = { ...(cur.features || {}) }; const sections = { ...(cur.sections || {}) };
    for (const [k] of FEATURE_KEYS) if (k in b) { if (k === 'live') sections.live = !!b[k]; else features[k] = !!b[k]; }
    await saveSite({ features, sections }); res.json({ features: Object.fromEntries(FEATURE_KEYS.map(([k]) => [k, feat(k)])) });
  }));
  // 47: content controls (hide site-wide; pin/feature in the hero or at the front of a home row)
  admin.get('/content', (req, res) => res.set('Cache-Control', 'no-store').json({ hidden: store.data.content?.hidden || [], pins: pins() }));
  admin.put('/content', wrap(async (req, res) => {
    const b = req.body || {}; const one = (x) => (x && KEY_RE.test(x.key || '') ? { key: x.key, title: clip(x.title, 120) } : null);
    const content = {
      hidden: (Array.isArray(b.hidden) ? b.hidden : []).slice(0, 500).map(one).filter(Boolean),
      pins: (Array.isArray(b.pins) ? b.pins : []).slice(0, 40).map((x) => { const o = one(x); return o && /^[\w-]{1,40}$/.test(x.row || '') ? { ...o, row: x.row } : null; }).filter(Boolean),
    };
    store.data.content = content; await store.save(); top10.at = 0; res.json(content);
  }));
  // 23: users — ban (reversible), unban, remove
  const UUIDp = (v) => { if (!UUID.test(v || '')) throw err(400, 'Bad user'); return v; };
  async function isAdminUser(uid) {
    const r = await authAdmin(`users/${uid}`); if (!r.ok) return false; const u = await r.json();
    return (u.identities || []).some((i) => i.provider === 'discord' && adminIds.includes(String(i.id || i.identity_data?.provider_id || i.identity_data?.sub)));
  }
  // OWNER tag = the ADMIN_DISCORD_ID account only; MODERATOR tag = live ghostflix_roles row (goes when the role is removed).
  const ownCache = new Map(), roleCache = new Map();
  async function tagOf(uid) {
    if (!sb || !UUID.test(uid || '')) return null;
    let o = ownCache.get(uid); if (!o || Date.now() - o.at > 3600e3) { o = { at: Date.now(), v: adminIds.length ? await isAdminUser(uid).catch(() => false) : false }; ownCache.set(uid, o); }
    if (o.v) return 'owner';
    let r = roleCache.get(uid); if (!r || Date.now() - r.at > 60e3) { r = { at: Date.now(), v: (await sb(`ghostflix_roles?select=role&user_id=eq.${uid}`).catch(() => []))?.[0]?.role === 'moderator' }; roleCache.set(uid, r); }
    return r.v ? 'mod' : null;
  }
  const tagsOf = async (ids) => Object.fromEntries(await Promise.all([...new Set(ids)].map(async (id) => [id, await tagOf(id)])));
  admin.post('/users/:uid/ban', wrap(async (req, res) => {
    needSb(); const uid = UUIDp(req.params.uid); if (await isAdminUser(uid)) throw err(400, 'You can’t ban the admin account.');
    await sb('ghostflix_bans?on_conflict=user_id', { method: 'POST', body: { user_id: uid, reason: clip(req.body?.reason, 200), banned_by: 'admin' }, prefer: 'resolution=merge-duplicates,return=minimal' });
    await authAdmin(`users/${uid}`, { method: 'PUT', body: JSON.stringify({ ban_duration: '876000h' }) }).catch(() => {});
    banCache.delete(uid); for (const [k, v] of tokCache) if (v.u.id === uid) tokCache.delete(k);
    res.json({ ok: true });
  }));
  admin.post('/users/:uid/unban', wrap(async (req, res) => {
    needSb(); const uid = UUIDp(req.params.uid);
    await sb(`ghostflix_bans?user_id=eq.${uid}`, { method: 'DELETE', prefer: 'return=minimal' });
    await authAdmin(`users/${uid}`, { method: 'PUT', body: JSON.stringify({ ban_duration: 'none' }) }).catch(() => {});
    banCache.delete(uid); res.json({ ok: true });
  }));
  admin.delete('/users/:uid', wrap(async (req, res) => {
    needSb(); const uid = UUIDp(req.params.uid); if (await isAdminUser(uid)) throw err(400, 'You can’t remove the admin account.');
    const r = await authAdmin(`users/${uid}`, { method: 'DELETE' }); if (!r.ok) throw err(502, `Auth said ${r.status}`);
    res.json({ ok: true }); // account rows cascade (watchlist, history, profiles, social, friends, chat, roles, bans…)
  }));
  // 49: roles / Team — searching is admin-only; changing roles additionally needs the admin's own Discord sign-in token.
  async function allUsers() {
    const out = []; for (let page = 1; page <= 10; page++) {
      const r = await authAdmin(`users?page=${page}&per_page=200`); if (!r.ok) break; const j = await r.json(); out.push(...(j.users || [])); if ((j.users || []).length < 200) break;
    } return out;
  }
  const mask = (e) => { if (!e) return ''; const [u, d] = String(e).split('@'); return d ? `${u.slice(0, 2)}${'•'.repeat(Math.max(1, Math.min(6, u.length - 2)))}@${d}` : '•••'; };
  const nameOfU = (u) => { const m = u.user_metadata || {}; return clip(m.custom_claims?.global_name || m.full_name || m.name || m.user_name || '', 60); };
  admin.get('/team', wrap(async (req, res) => {
    needSb(); const q = String(req.query.q || '').toLowerCase().trim().slice(0, 60);
    const [users, roles] = await Promise.all([allUsers(), sb('ghostflix_roles?select=*')]);
    const role = Object.fromEntries((roles || []).map((r) => [r.user_id, r]));
    const view = (u) => ({ uid: u.id, name: nameOfU(u), email: mask(u.email), providers: (u.app_metadata?.providers || []).filter(Boolean), role: role[u.id]?.role || null, granted_at: role[u.id]?.granted_at || null,
      admin: (u.identities || []).some((i) => i.provider === 'discord' && adminIds.includes(String(i.id || i.identity_data?.provider_id || i.identity_data?.sub))) });
    const results = q ? users.filter((u) => [nameOfU(u), u.email, u.id].some((v) => String(v || '').toLowerCase().includes(q))).slice(0, 25).map(view) : [];
    res.set('Cache-Control', 'no-store').json({ mods: users.filter((u) => role[u.id]).map(view), results });
  }));
  admin.post('/team/:uid', wrap(async (req, res) => {
    needSb(); const uid = UUIDp(req.params.uid); const me = await userOf(req);
    if (!me || !me.discord.some((d) => adminIds.includes(d))) throw err(403, 'Only the GhostFlix admin’s Discord account can change roles. Sign in on the main site with Discord, then try again.');
    if (req.body?.role === 'moderator') await sb('ghostflix_roles?on_conflict=user_id', { method: 'POST', body: { user_id: uid, role: 'moderator', granted_by: `discord:${me.discord[0]}` }, prefer: 'resolution=merge-duplicates,return=minimal' });
    else await sb(`ghostflix_roles?user_id=eq.${uid}`, { method: 'DELETE', prefer: 'return=minimal' });
    roleCache.delete(uid);
    res.json({ ok: true });
  }));
  // All members (Team tab): admin cookie AND the admin's own Discord sign-in token (same check as role changes). Never for mods.
  const needOwner = async (req) => { const me = await userOf(req); if (!me || !me.discord.some((d) => adminIds.includes(d))) throw err(403, 'Only the GhostFlix admin’s Discord account can view members. Sign in on the main site with Discord, then try again.'); };
  const discOf = (u) => { const i = (u.identities || []).find((x) => x.provider === 'discord'); if (!i) return null; const d = i.identity_data || {}; return { id: String(d.provider_id || d.sub || i.id), name: clip(d.custom_claims?.global_name || d.full_name || d.name || '', 60), user: clip(d.user_name || d.preferred_username || d.name || '', 60) }; };
  const isOwnerU = (u) => (u.identities || []).some((i) => i.provider === 'discord' && adminIds.includes(String(i.id || i.identity_data?.provider_id || i.identity_data?.sub)));
  admin.get('/members', wrap(async (req, res) => {
    needSb(); await needOwner(req);
    const [users, roles, days, soc] = await Promise.all([allUsers(), sb('ghostflix_roles?select=user_id,role'), sb('ghostflix_watch_days?select=user_id,seconds&limit=500000'), sb('ghostflix_social?select=user_id,display_name,last_seen&limit=50000')]);
    const role = Object.fromEntries((roles || []).map((r) => [r.user_id, r.role])); const so = Object.fromEntries((soc || []).map((r) => [r.user_id, r])); const secs = {};
    for (const d of days || []) secs[d.user_id] = (secs[d.user_id] || 0) + (d.seconds > 0 ? d.seconds : 0);
    let list = users.map((u) => { const m = u.user_metadata || {}; const dc = discOf(u); const own = isOwnerU(u); const r = rankOfB6({ watch_seconds: secs[u.id] || 0 });
      return { uid: u.id, name: so[u.id]?.display_name || nameOfU(u) || (u.email || '').split('@')[0], email: u.email || '', avatar: clip(m.avatar_url || m.picture || '', 400), discord: dc, tag: own ? 'owner' : role[u.id] === 'moderator' ? 'mod' : null,
        joined: u.created_at, last: [so[u.id]?.last_seen, u.last_sign_in_at].filter(Boolean).sort().pop() || null, hours: r.hours, tier: { i: r.tier.i, name: r.tier.name, emoji: r.tier.emoji } }; });
    const q = String(req.query.q || '').toLowerCase().trim().slice(0, 60);
    if (q) list = list.filter((x) => [x.name, x.email, x.uid, x.discord?.id, x.discord?.user, x.discord?.name].some((v) => String(v || '').toLowerCase().includes(q)));
    if (req.query.mods === '1') list = list.filter((x) => x.tag);
    if (req.query.discord === '1') list = list.filter((x) => x.discord);
    const by = { new: (x) => Date.parse(x.joined) || 0, watched: (x) => x.hours, rank: (x) => x.tier.i * 1e7 + x.hours, active: (x) => Date.parse(x.last || 0) || 0 }[req.query.sort] || ((x) => Date.parse(x.joined) || 0);
    list.sort((x, y) => by(y) - by(x));
    const pages = Math.max(1, Math.ceil(list.length / 25)); const page = Math.min(pages, Math.max(1, parseInt(req.query.page, 10) || 1));
    res.set('Cache-Control', 'no-store').json({ total: list.length, page, pages, members: list.slice((page - 1) * 25, page * 25) });
  }));
  admin.get('/members/:uid', wrap(async (req, res) => {
    needSb(); await needOwner(req); const uid = UUIDp(req.params.uid);
    const r = await authAdmin(`users/${uid}`); if (!r.ok) throw err(404, 'No such member'); const u = await r.json(); const m = u.user_metadata || {};
    const n = (x) => (Array.isArray(x) ? x.length : 0);
    const [profiles, sum, wl, shared, flair, pub, soc, fr, fol, fing, inbox, ban, roleR] = await Promise.all([
      sb(`ghostflix_profiles?user_id=eq.${uid}&select=id,name,kids&order=position`), sb('rpc/ghostflix_watch_summary', { method: 'POST', body: { p_uid: uid, p_profile: 'main' } }),
      sb(`ghostflix_watchlist?user_id=eq.${uid}&select=tmdb_id&limit=10000`), sb(`ghostflix_shared_lists?or=(a.eq.${uid},b.eq.${uid})&select=id`),
      sb(`ghostflix_flair?user_id=eq.${uid}&select=profile_id,fav4,show_stats,show_watching`), sb(`ghostflix_public_profiles?user_id=eq.${uid}&select=profile_id,slug,enabled,show_history`),
      sb(`ghostflix_social?user_id=eq.${uid}&select=display_name,friends_on,share_watching,last_seen`), sb(`ghostflix_friends?or=(a.eq.${uid},b.eq.${uid})&status=eq.accepted&select=a`),
      sb(`ghostflix_follows?followee=eq.${uid}&select=follower`), sb(`ghostflix_follows?follower=eq.${uid}&select=followee`),
      sb(`ghostflix_inbox?or=(user_id.eq.${uid},data->>user_id.eq.${uid},data->message->>user_id.eq.${uid})&select=id,kind,status,title,user_id,created_at&order=created_at.desc&limit=50`),
      sb(`ghostflix_bans?user_id=eq.${uid}&select=reason,banned_at`), sb(`ghostflix_roles?user_id=eq.${uid}&select=role,granted_at`)].map((p) => p.catch(() => null)));
    const s = soc?.[0] || {}; const rk = rankOfB6(sum); const own = isOwnerU(u);
    res.set('Cache-Control', 'no-store').json({ uid, name: s.display_name || nameOfU(u), email: u.email || '', avatar: clip(m.avatar_url || m.picture || '', 400), discord: discOf(u), providers: (u.app_metadata?.providers || []).filter(Boolean),
      tag: own ? 'owner' : roleR?.[0]?.role === 'moderator' ? 'mod' : null, role: roleR?.[0] || null, banned: ban?.[0] || null, joined: u.created_at, last: [s.last_seen, u.last_sign_in_at].filter(Boolean).sort().pop() || null,
      profiles: [{ id: 'main', name: (profiles || []).find((p) => p.id === 'main')?.name || 'Main' }, ...(profiles || []).filter((p) => p.id !== 'main').map((p) => ({ id: p.id, name: p.name, kids: !!p.kids }))],
      hours: rk.hours, rank: { name: rk.tier.name, emoji: rk.tier.emoji }, titles: sum?.titles || 0, lists: { watchlist: n(wl), shared: n(shared) }, favourites: (flair || []).reduce((t, f) => t + n(f.fav4), 0),
      friends: n(fr), followers: n(fol), following: n(fing),
      privacy: { friends_on: !!s.friends_on, share_watching: !!s.share_watching, public: (pub || []).map((p) => ({ profile: p.profile_id, enabled: p.enabled, slug: p.enabled ? p.slug : null, show_history: p.show_history })), stats: (flair || []).map((f) => ({ profile: f.profile_id, show_stats: f.show_stats, show_watching: f.show_watching })) },
      reports: (inbox || []).map((x) => ({ id: x.id, kind: x.kind, status: x.status, title: x.title, by_them: x.user_id === uid, at: x.created_at })) });
  }));
  // Reports inbox + Flags (admin view of everything)
  const INBOX_COLS = 'id,kind,status,title,body,data,user_id,visitor,by_mod,notes,created_at,updated_at';
  admin.get('/inbox', wrap(async (req, res) => {
    needSb(); const flags = req.query.flags === '1';
    const kinds = flags ? 'kind=in.(flag_title,flag_kids,flag_user,flag_chat,flag_comment,announce)' : 'kind=in.(request,bug,chat)';
    const st = ['open', 'in_progress', 'done', 'wontfix'].includes(req.query.status) ? `&status=eq.${req.query.status}` : '';
    const rows = (await sb(`ghostflix_inbox?${kinds}${st}&select=${INBOX_COLS},has_shot:screenshot&order=created_at.desc&limit=200`)) || [];
    res.set('Cache-Control', 'no-store').json({ items: rows.map((r) => ({ ...r, has_shot: !!r.has_shot, user_id: r.user_id ? r.user_id.slice(0, 8) : null })) });
  }));
  admin.get('/inbox/:id/shot', wrap(async (req, res) => {
    needSb(); const r = (await sb(`ghostflix_inbox?id=eq.${parseInt(req.params.id, 10) || 0}&select=screenshot`))?.[0];
    const m = r?.screenshot?.match(/^data:(image\/(?:jpeg|png|webp));base64,(.+)$/); if (!m) return res.status(404).end();
    res.set({ 'Content-Type': m[1], 'Cache-Control': 'private, max-age=600', 'Content-Security-Policy': "default-src 'none'" }).send(Buffer.from(m[2], 'base64'));
  }));
  const STATUSES = ['open', 'in_progress', 'done', 'wontfix'];
  const addNote = (notes, by, text) => [...(Array.isArray(notes) ? notes : []), { by, text: clip(text, 500), at: new Date().toISOString() }].slice(-30);
  admin.patch('/inbox/:id', wrap(async (req, res) => {
    needSb(); const id = parseInt(req.params.id, 10) || 0; const cur = (await sb(`ghostflix_inbox?id=eq.${id}&select=notes`))?.[0]; if (!cur) throw err(404, 'Not found');
    const patch = { updated_at: new Date().toISOString() }; if (STATUSES.includes(req.body?.status)) patch.status = req.body.status; if (clip(req.body?.note, 500)) patch.notes = addNote(cur.notes, 'admin', req.body.note);
    await sb(`ghostflix_inbox?id=eq.${id}`, { method: 'PATCH', body: patch, prefer: 'return=minimal' }); res.json({ ok: true });
  }));
  admin.delete('/inbox/:id', wrap(async (req, res) => { needSb(); await sb(`ghostflix_inbox?id=eq.${parseInt(req.params.id, 10) || 0}`, { method: 'DELETE', prefer: 'return=minimal' }); res.json({ ok: true }); }));
  // Approving a moderator suggestion / acting on a flag
  admin.post('/inbox/:id/approve', wrap(async (req, res) => {
    needSb(); const id = parseInt(req.params.id, 10) || 0; const r = (await sb(`ghostflix_inbox?id=eq.${id}&select=*`))?.[0]; if (!r) throw err(404, 'Not found');
    let result = {};
    if (r.kind === 'announce' && r.data?.type === 'push') result = await stats.broadcast({ title: 'GhostFlix', body: clip(r.body, 200), url: '/', tag: `gf-an-${id}` });
    else if (r.kind === 'announce') await saveSite({ announcement: { on: true, text: clip(r.body, 280), color: /^#[0-9a-f]{6}$/i.test(r.data?.color || '') ? r.data.color : '#5fe3ff' } });
    else if ((r.kind === 'flag_title' || r.kind === 'flag_kids') && KEY_RE.test(r.data?.key || '')) { const h = store.data.content?.hidden || []; if (!h.some((x) => x.key === r.data.key)) { store.data.content = { pins: pins(), ...(store.data.content || {}), hidden: [...h, { key: r.data.key, title: clip(r.title, 120) }] }; await store.save(); } }
    else if (r.kind === 'flag_chat' && +r.data?.message_id > 0) await sb(`ghostflix_chat?id=eq.${+r.data.message_id}`, { method: 'PATCH', body: { hidden: true }, prefer: 'return=minimal' });
    await sb(`ghostflix_inbox?id=eq.${id}`, { method: 'PATCH', body: { status: 'done', notes: addNote(r.notes, 'admin', 'Approved'), updated_at: new Date().toISOString() }, prefer: 'return=minimal' });
    res.json({ ok: true, result });
  }));
  admin.post('/chat/:id/hide', wrap(async (req, res) => { needSb(); await sb(`ghostflix_chat?id=eq.${parseInt(req.params.id, 10) || 0}`, { method: 'PATCH', body: { hidden: true }, prefer: 'return=minimal' }); res.json({ ok: true }); }));
  admin.get('/modlog', wrap(async (req, res) => { needSb(); res.set('Cache-Control', 'no-store').json({ items: (await sb('ghostflix_mod_log?select=*&order=created_at.desc&limit=200')) || [] }); }));
  // Broken-source reports with moderator status
  admin.get('/source-reports', wrap(async (req, res) => { needSb(); res.set('Cache-Control', 'no-store').json({ items: (await sb('ghostflix_source_reports?select=*&order=created_at.desc&limit=200')) || [] }); }));
  // 44: visitor charts (devices + countries come from ghostflix_stats; peak hours here)
  admin.get('/visitors', wrap(async (req, res) => {
    needSb(); const days = Math.max(1, Math.min(90, parseInt(req.query.days, 10) || 30));
    const [hours, st] = await Promise.all([sb('rpc/ghostflix_hours', { method: 'POST', body: { days } }), sb('rpc/ghostflix_stats', { method: 'POST', body: { days } }).catch(() => null)]);
    res.set('Cache-Control', 'no-store').json({ days, hours: hours || [], devices: st?.devices || [], countries: st?.countries || [] });
  }));
  // 45: one-click backup of the GhostFlix Supabase tables (+ the app store) as a downloadable JSON file
  const BACKUP_TABLES = ['ghostflix_store', 'ghostflix_profiles', 'ghostflix_profile_data', 'ghostflix_watchlist', 'ghostflix_history', 'ghostflix_source_reports', 'ghostflix_push_subs', 'ghostflix_events',
    'ghostflix_social', 'ghostflix_public_profiles', 'ghostflix_friends', 'ghostflix_chat', 'ghostflix_activity', 'ghostflix_inbox', 'ghostflix_roles', 'ghostflix_bans', 'ghostflix_mod_log'];
  admin.get('/backup/info', (req, res) => res.set('Cache-Control', 'no-store').json({ last: store.data.meta?.lastBackup || null, tables: BACKUP_TABLES }));
  admin.get('/backup', wrap(async (req, res) => {
    needSb(); const out = { app: 'GhostFlix', made: new Date().toISOString(), tables: {}, counts: {} };
    for (const t of BACKUP_TABLES) {
      const rows = []; for (let off = 0; off < 200000; off += 1000) {
        let part; try { part = await sb(`${t}?select=*&limit=1000&offset=${off}`); } catch { break; }
        rows.push(...(part || [])); if (!part || part.length < 1000) break;
      }
      out.tables[t] = rows; out.counts[t] = rows.length;
    }
    const body = JSON.stringify(out);
    store.data.meta = { ...(store.data.meta || {}), lastBackup: { at: out.made, bytes: body.length, rows: Object.values(out.counts).reduce((a, b) => a + b, 0) } }; await store.save();
    res.set({ 'Content-Type': 'application/json', 'Content-Disposition': `attachment; filename="ghostflix-backup-${out.made.slice(0, 10)}.json"`, 'Cache-Control': 'no-store' }).send(body);
  }));
  // 32: maintenance check — fetch the public site without the admin cookie, as a visitor would.
  admin.get('/maint-check', wrap(async (req, res) => {
    const pub = (env.PUBLIC_URL || 'https://ghostflix.uk').replace(/\/$/, ''); const h = { 'User-Agent': 'gf-maint-check', DNT: '1' };
    const [a, b] = await Promise.all([fetch(`${pub}/`, { headers: h, signal: AbortSignal.timeout(10000) }).catch(() => null), fetch(`${pub}/api/home`, { headers: h, signal: AbortSignal.timeout(10000) }).catch(() => null)]);
    res.set('Cache-Control', 'no-store').json({ maintenance: !!store.data.site?.maintenance, page: a?.status ?? null, api: b?.status ?? null });
  }));
  // 46: site health (Render API server-side with RENDER_API_KEY, never sent to the browser)
  const started = Date.now();
  admin.get('/health', wrap(async (req, res) => {
    const out = { server: { up_s: Math.round((Date.now() - started) / 1000), node: process.version, rss_mb: Math.round(process.memoryUsage().rss / 1048576) }, render: null, response: null, db: null };
    const pub = (env.PUBLIC_URL || 'https://ghostflix.uk').replace(/\/$/, '');
    const t0 = Date.now(); try { const r = await fetch(`${pub}/healthz`, { signal: AbortSignal.timeout(10000), headers: { 'User-Agent': 'gf-health' } }); out.response = { ms: Date.now() - t0, status: r.status, url: `${pub}/healthz` }; } catch (e) { out.response = { ms: null, error: e.name }; }
    const svc = env.RENDER_SERVICE_ID || 'srv-dbc36d6q1p3s73c4la4g';
    if (env.RENDER_API_KEY) {
      try {
        const h = { Authorization: `Bearer ${env.RENDER_API_KEY}`, Accept: 'application/json' };
        const [s, d] = await Promise.all([fetch(`https://api.render.com/v1/services/${svc}`, { headers: h, signal: AbortSignal.timeout(8000) }), fetch(`https://api.render.com/v1/services/${svc}/deploys?limit=5`, { headers: h, signal: AbortSignal.timeout(8000) })]);
        const sj = s.ok ? await s.json() : null; const dj = d.ok ? await d.json() : [];
        out.render = { ok: s.ok, status: sj ? (sj.suspended === 'suspended' ? 'suspended' : 'running') : `API ${s.status}`, name: sj?.name, plan: sj?.serviceDetails?.plan, region: sj?.serviceDetails?.region,
          deploys: (dj || []).map((x) => x.deploy || x).map((x) => ({ id: x.id, status: x.status, commit: x.commit?.id?.slice(0, 7), message: clip(x.commit?.message, 90), created: x.createdAt, finished: x.finishedAt })) };
      } catch (e) { out.render = { ok: false, status: 'Render API unreachable' }; }
    } else out.render = { ok: false, status: 'RENDER_API_KEY not set on the server' };
    if (sb) { try { out.db = await sb('rpc/ghostflix_health', { method: 'POST', body: {} }); } catch { out.db = { error: 'query failed' }; } }
    res.set('Cache-Control', 'no-store').json(out);
  }));

  // ================================================================= MODERATORS (/api/mod/*, RLS-enforced)
  async function needMod(req) {
    const u = await needUser(req); const q = asUser(u.token);
    const role = (await q(`ghostflix_roles?select=role&user_id=eq.${u.id}`).catch(() => []))?.[0];
    if (role?.role !== 'moderator') throw err(403, 'Moderators only.');
    return { u, q, log: (action, target, detail = {}) => q('ghostflix_mod_log', { method: 'POST', body: { mod_id: u.id, mod_name: u.name, action, target: clip(target, 200), detail }, prefer: 'return=minimal' }).catch((e) => console.warn('[mod] log failed', e.message)) };
  }
  app.get('/api/mod/me', wrap(async (req, res) => { const { u } = await needMod(req); res.set('Cache-Control', 'no-store').json({ mod: true, name: u.name }); }));
  app.get('/api/mod/inbox', wrap(async (req, res) => {
    const { q } = await needMod(req);
    const kinds = { requests: 'request', bugs: 'bug', chat: 'chat', flags: 'flag_title,flag_kids,flag_user,flag_chat,flag_comment,announce' }[req.query.kind] || 'request,bug,chat';
    const st = STATUSES.includes(req.query.status) ? `&status=eq.${req.query.status}` : '';
    const rows = (await q(`ghostflix_inbox?kind=in.(${kinds})${st}&select=id,kind,status,title,body,data,notes,created_at,updated_at&order=created_at.desc&limit=200`)) || [];
    res.set('Cache-Control', 'no-store').json({ items: rows.map((r) => ({ ...r, data: { ...r.data, ua: undefined } })) });
  }));
  app.get('/api/mod/inbox/:id/shot', wrap(async (req, res) => {
    const { q } = await needMod(req); const r = (await q(`ghostflix_inbox?id=eq.${parseInt(req.params.id, 10) || 0}&select=screenshot`))?.[0];
    const m = r?.screenshot?.match(/^data:(image\/(?:jpeg|png|webp));base64,(.+)$/); if (!m) return res.status(404).json({ error: 'No screenshot' });
    res.set('Cache-Control', 'no-store').json({ src: r.screenshot });
  }));
  app.patch('/api/mod/inbox/:id', wrap(async (req, res) => {
    const { q, log, u } = await needMod(req); const id = parseInt(req.params.id, 10) || 0;
    const cur = (await q(`ghostflix_inbox?id=eq.${id}&select=notes,status,kind,title`))?.[0]; if (!cur) throw err(404, 'Not found');
    const patch = { updated_at: new Date().toISOString() }; if (STATUSES.includes(req.body?.status)) patch.status = req.body.status; if (clip(req.body?.note, 500)) patch.notes = addNote(cur.notes, u.name, req.body.note);
    await q(`ghostflix_inbox?id=eq.${id}`, { method: 'PATCH', body: patch, prefer: 'return=minimal' });
    log('inbox.update', `#${id} ${cur.kind}: ${cur.title}`, { status: patch.status, note: patch.notes ? clip(req.body.note, 200) : undefined }); res.json({ ok: true });
  }));
  app.get('/api/mod/reports', wrap(async (req, res) => {
    const { q } = await needMod(req); const st = STATUSES.includes(req.query.status) ? `&status=eq.${req.query.status}` : '';
    res.set('Cache-Control', 'no-store').json({ items: (await q(`ghostflix_source_reports?select=id,created_at,media_type,tmdb_id,season,episode,source,reason,device,status,notes,updated_at${st}&order=created_at.desc&limit=200`)) || [] });
  }));
  app.post('/api/mod/reports/:id', wrap(async (req, res) => {
    const { q, log, u } = await needMod(req); const id = parseInt(req.params.id, 10) || 0;
    const cur = (await q(`ghostflix_source_reports?id=eq.${id}&select=notes,media_type,tmdb_id,season,episode,source`))?.[0]; if (!cur) throw err(404, 'Not found');
    const works = req.body?.works === true; const status = works ? 'done' : STATUSES.includes(req.body?.status) ? req.body.status : null;
    const note = works ? 'Tested, works now' : clip(req.body?.note, 500);
    await q(`ghostflix_source_reports?id=eq.${id}`, { method: 'PATCH', body: { ...(status ? { status } : {}), ...(note ? { notes: addNote(cur.notes, u.name, note) } : {}), updated_at: new Date().toISOString() }, prefer: 'return=minimal' });
    log(works ? 'source.works' : 'source.update', `${cur.media_type}:${cur.tmdb_id}${cur.season != null ? ` S${cur.season}E${cur.episode}` : ''} · ${cur.source}`, { status, note }); res.json({ ok: true });
  }));
  const FLAG_KINDS = ['flag_title', 'flag_kids', 'flag_user', 'flag_chat', 'flag_comment'];
  app.post('/api/mod/flag', wrap(async (req, res) => {
    const { q, log, u } = await needMod(req); const b = req.body || {}; const kind = FLAG_KINDS.includes(b.kind) ? b.kind : null; if (!kind) throw err(400, 'Bad flag');
    const data = {}; if (KEY_RE.test(b.key || '')) data.key = b.key; if (UUID.test(b.user_id || '')) data.user_id = b.user_id; if (+b.message_id > 0) data.message_id = +b.message_id; if (+b.inbox_id > 0) data.inbox_id = +b.inbox_id;
    if ((kind === 'flag_title' || kind === 'flag_kids') && !data.key) throw err(400, 'Pick a title');
    if (kind === 'flag_user' && /^[a-z0-9]{10}$/.test(b.slug || '') && sb) { const p = (await sb(`ghostflix_public_profiles?slug=eq.${b.slug}&select=user_id`))?.[0]; if (p) Object.assign(data, { user_id: p.user_id, slug: b.slug, what: b.what === 'bio' ? 'bio' : 'profile' }); } // flag a public profile's bio/tagline
    if (kind === 'flag_user' && !data.user_id) throw err(400, 'Pick a user');
    const title = clip(b.title, 200) || kind.replace('flag_', 'Flag: ');
    await q('ghostflix_inbox', { method: 'POST', body: { kind, title, body: clip(b.body, 1000), data, by_mod: u.id }, prefer: 'return=minimal' });
    log(`flag.${kind.slice(5)}`, title, data); res.json({ ok: true });
  }));
  app.post('/api/mod/suggest', wrap(async (req, res) => {
    const { q, log, u } = await needMod(req); const type = req.body?.type === 'push' ? 'push' : 'banner'; const text = clip(req.body?.text, type === 'push' ? 200 : 280); if (!text) throw err(400, 'Write the message first.');
    const data = { type, color: /^#[0-9a-f]{6}$/i.test(req.body?.color || '') ? req.body.color : undefined };
    await q('ghostflix_inbox', { method: 'POST', body: { kind: 'announce', title: type === 'push' ? 'Suggested push message' : 'Suggested banner', body: text, data, by_mod: u.id }, prefer: 'return=minimal' });
    log(`suggest.${type}`, text); res.json({ ok: true });
  }));
  app.get('/api/mod/users', wrap(async (req, res) => {
    const { q } = await needMod(req); const s = String(req.query.q || '').replace(/[^\p{L}\p{N} ._-]/gu, '').trim().slice(0, 40);
    const rows = (await q(`ghostflix_social?select=user_id,display_name,last_seen${s ? `&display_name=ilike.*${encodeURIComponent(s)}*` : ''}&order=last_seen.desc.nullslast&limit=50`)) || [];
    res.set('Cache-Control', 'no-store').json({ items: rows });
  }));
  app.get('/api/mod/log', wrap(async (req, res) => { const { q } = await needMod(req); res.set('Cache-Control', 'no-store').json({ items: (await q('ghostflix_mod_log?select=action,target,detail,created_at&order=created_at.desc&limit=100')) || [] }); }));
  app.get('/api/mod/title', wrap(async (req, res) => { await needMod(req); const s = String(req.query.q || '').trim().slice(0, 80); res.json(s ? await catalog.search(s, 1) : { results: [] }); }));

  return { hidden, pins, feat, userOf, needUser, bannedNow, sb, tagOf };
}
