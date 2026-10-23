// GhostFlix Stage G: profile flair (rank-locked animated borders + name effects, ghost-mascot avatars, seasonal frames,
// banners, tagline, Favourite 4), rank card + watch stats + badges, follows ("what my friends are watching"), shared
// lists between two friends, and Open Graph cards for public profile links.
// Privacy: every route works on the caller's own rows (id from their validated Supabase token). A public profile shows
// stats / "watching now" only when its owner opted in (stats on by default once the profile is public; watching off).
// Rank = GhostBot's /flixrank formula: sum of public.ghostflix_watch_days, read by the service-only SQL function
// ghostflix_watch_summary (GhostBot's tables are never written here). Emails are never read or returned.
import fs from 'node:fs';
import path from 'node:path';

const err = (status, message) => Object.assign(new Error(message), { status });
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const KEY_RE = /^(movie|tv):\d{1,10}$/;
const IMG_RE = /^https:\/\/image\.tmdb\.org\/t\/p\/(w\d{2,4}|original)\/[A-Za-z0-9_-]+\.(jpg|jpeg|png|webp)$/;
// Text from users: drop control + bidi-override chars, collapse whitespace, cap by code points (keeps emoji intact).
export const cleanText = (v, n) => Array.from(String(v ?? '').replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f\u202a-\u202e\u2066-\u2069\ufeff]/g, '').replace(/[ \t]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim()).slice(0, n).join('');

// Same tiers as GhostBot /flixrank (ghostgames-bot flixrank.ts FLIX_TIERS).
export const TIERS = [
  { key: 'extra', name: 'Extra', emoji: '🎟️', hours: 0, color: '#bcaaa4' },
  { key: 'background', name: 'Background Ghost', emoji: '👥', hours: 1, color: '#1abc9c' },
  { key: 'supporting', name: 'Supporting Ghost', emoji: '🎭', hours: 5, color: '#57f287' },
  { key: 'lead', name: 'Lead', emoji: '🌟', hours: 15, color: '#5865f2' },
  { key: 'director', name: 'Director', emoji: '🎬', hours: 40, color: '#e67e22' },
  { key: 'legend', name: 'GhostFlix Legend', emoji: '🎞️', hours: 100, color: '#e50914' },
];
const tierIdx = (sec) => { let i = 0; TIERS.forEach((t, j) => { if ((sec || 0) >= t.hours * 3600) i = j; }); return i; };
// Rank unlocks (index into TIERS). Plain borders from the existing Look picker stay free.
export const RANK_BORDERS = { 'rk-neon': 1, 'rk-fire': 2, 'rk-mist': 3, 'rk-vine': 4, 'rk-glitch': 5 };
export const NAME_FX = { glow: 3, shimmer: 4, rainbow: 5 };
export const MASCOTS = ['boo', 'sheet', 'pumpkin', 'popcorn', 'director', 'wisp'];
// the free borders from the Look picker (public/cosmetics.js BORDER_GROUPS)
const FREE_BORDERS = new Set(['none', 'solid', 'gradient', 'ghost', 'neon', 'pulse', 'gold', 'blurple', 'nitro', 'online', 'idle', 'dnd', 'streaming', 'boost', 'hype']);

export function rankOf(sum) {
  const sec = sum?.watch_seconds || 0; const i = tierIdx(sec); const t = TIERS[i]; const n = TIERS[i + 1] || null;
  const progress = n ? Math.max(0, Math.min(1, (sec - t.hours * 3600) / ((n.hours - t.hours) * 3600))) : 1;
  return { seconds: sec, hours: +(sec / 3600).toFixed(1), tier: { ...t, i }, next: n ? { ...n, i: i + 1, need_hours: +((n.hours * 3600 - sec) / 3600).toFixed(1) } : null, progress, discord: !!sum?.discord };
}
export function badgesOf(sum) {
  const s = sum || {}; const horror = +(s.genres?.['27'] || 0); const best = s.best_day?.s || 0;
  return [
    { id: 'nightowl', icon: '🦉', name: 'Night Owl', desc: 'Watch 3 titles after midnight (UK time)', got: s.night >= 3, prog: Math.min(1, (s.night || 0) / 3) },
    { id: 'binger', icon: '🍿', name: 'Binger', desc: 'Watch 3 hours in one day', got: best >= 3 * 3600, prog: Math.min(1, best / (3 * 3600)) },
    { id: 'horror', icon: '🎃', name: 'Horror Fan', desc: 'Start 5 horror titles', got: horror >= 5, prog: Math.min(1, horror / 5) },
    { id: 'review', icon: '✍️', name: 'First Review', desc: 'Rate a title 👎 👍 or ❤️', got: (s.ratings || 0) >= 1, prog: 0 },
    { id: 'h100', icon: '💯', name: '100 Hours', desc: 'Watch 100 hours (same clock as /flixrank)', got: (s.watch_seconds || 0) >= 360000, prog: Math.min(1, (s.watch_seconds || 0) / 360000) },
  ];
}
const statsOf = (sum) => {
  const g = Object.entries(sum?.genres || {}).map(([id, n]) => ({ id: +id, n: +n })).filter((x) => x.id > 0 && x.n > 0).sort((a, b) => b.n - a.n).slice(0, 6);
  return { month_hours: +((sum?.month_seconds || 0) / 3600).toFixed(1), month_days: (sum?.month_days || []).map((x) => ({ d: x.d, h: +(x.s / 3600).toFixed(2) })), best_day: sum?.best_day ? { d: sum.best_day.d, hours: +(sum.best_day.s / 3600).toFixed(1) } : null, best_run: sum?.best_run || 0, titles: sum?.titles || 0, genres: g };
};
const cardOf = (x) => (x && KEY_RE.test(`${x.media_type}:${x.id}`) ? { id: +x.id, media_type: x.media_type, title: cleanText(x.title, 120), year: x.year ? +x.year || null : null, poster: IMG_RE.test(x.poster || '') ? x.poster : null, backdrop: IMG_RE.test(x.backdrop || '') ? x.backdrop : null } : null);
const HEX = /^#[0-9a-f]{6}$/i;
function bannerOf(b) {
  if (b?.type === 'backdrop' && IMG_RE.test(b.url || '')) return { type: 'backdrop', url: b.url.replace(/\/t\/p\/[^/]+\//, '/t/p/w1280/'), title: cleanText(b.title, 120), key: KEY_RE.test(b.key || '') ? b.key : null };
  if (b?.type === 'gradient' && HEX.test(b.a || '') && HEX.test(b.b || '')) return { type: 'gradient', a: b.a.toLowerCase(), b: b.b.toLowerCase(), angle: Math.max(0, Math.min(360, parseInt(b.angle, 10) || 135)) };
  return null;
}
const DEF = { border: 'none', mascot: null, name_fx: null, seasonal: true, banner: null, tagline: '', fav4: [], show_stats: true, show_watching: false };
const viewFlair = (f, rank) => {
  const r = { ...DEF, ...(f || {}) }; delete r.user_id; delete r.updated_at;
  // a lock re-applies if the tier ever drops (e.g. data reset): never show what isn't unlocked
  if (RANK_BORDERS[r.border] != null && RANK_BORDERS[r.border] > rank.tier.i) r.border = 'none';
  if (r.name_fx && !(NAME_FX[r.name_fx] <= rank.tier.i)) r.name_fx = null;
  return r;
};

export function mountB6(app, { env, wrap, sb, needUser, bannedNow, feat, ROOT, catalog }) {
  const needFeat = (k) => { if (!feat(k)) throw err(403, 'This feature is switched off right now.'); };
  const needSb = () => { if (!sb) throw err(503, 'Accounts aren’t set up on this server.'); };
  const pidOf = (p) => { const s = String(p || 'main'); if (!/^[a-z0-9]{1,20}$/i.test(s)) throw err(400, 'Bad profile'); return s; };
  const sumCache = new Map();
  async function summary(uid, pid) {
    const k = `${uid}:${pid}`; const c = sumCache.get(k); if (c && Date.now() - c.at < 60e3) return c.v;
    const v = await sb('rpc/ghostflix_watch_summary', { method: 'POST', body: { p_uid: uid, p_profile: pid } });
    sumCache.set(k, { at: Date.now(), v }); if (sumCache.size > 2000) sumCache.delete(sumCache.keys().next().value); return v;
  }
  const flairRow = async (uid, pid) => (await sb(`ghostflix_flair?user_id=eq.${uid}&profile_id=eq.${encodeURIComponent(pid)}&select=*`))?.[0] || null;
  const pair = (x, y) => (x < y ? [x, y] : [y, x]);
  async function friends(uid, other) {
    const [a, b] = pair(uid, other); return !!(await sb(`ghostflix_friends?a=eq.${a}&b=eq.${b}&status=eq.accepted&select=a`))?.length;
  }
  const fresh = (s) => s?.friends_on && s?.share_watching && s.watching && s.watching_at && Date.now() - Date.parse(s.watching_at) < 6 * 3600e3;

  // ---------------------------------------------------------------- my rank, stats, badges, flair
  app.get('/api/me/rank', wrap(async (req, res) => {
    needSb(); const u = await needUser(req); const pid = pidOf(req.query.pid); const s = await summary(u.id, pid);
    res.set('Cache-Control', 'no-store').json({ rank: rankOf(s), stats: statsOf(s), badges: badgesOf(s), tiers: TIERS });
  }));
  app.get('/api/me/flair/:pid', wrap(async (req, res) => {
    needSb(); const u = await needUser(req); const pid = pidOf(req.params.pid);
    const [f, s] = await Promise.all([flairRow(u.id, pid), summary(u.id, pid)]); const rank = rankOf(s);
    res.set('Cache-Control', 'no-store').json({ flair: viewFlair(f, rank), rank, stats: statsOf(s), badges: badgesOf(s), tiers: TIERS, unlocks: { borders: RANK_BORDERS, name_fx: NAME_FX }, mascots: MASCOTS });
  }));
  app.put('/api/me/flair/:pid', wrap(async (req, res) => {
    needSb(); const u = await needUser(req); const pid = pidOf(req.params.pid); const b = req.body || {};
    const rank = rankOf(await summary(u.id, pid)); const cur = { ...DEF, ...((await flairRow(u.id, pid)) || {}) };
    const row = { user_id: u.id, profile_id: pid, updated_at: new Date().toISOString() };
    for (const k of ['border', 'mascot', 'name_fx', 'seasonal', 'banner', 'tagline', 'fav4', 'show_stats', 'show_watching']) row[k] = k in b ? undefined : cur[k];
    if ('border' in b) {
      const v = String(b.border || 'none');
      if (RANK_BORDERS[v] != null) { if (RANK_BORDERS[v] > rank.tier.i) throw err(403, `That border unlocks at ${TIERS[RANK_BORDERS[v]].emoji} ${TIERS[RANK_BORDERS[v]].name} (${TIERS[RANK_BORDERS[v]].hours} h).`); row.border = v; }
      else row.border = FREE_BORDERS.has(v) ? v : 'none';
    }
    if ('name_fx' in b) {
      const v = b.name_fx ? String(b.name_fx) : null;
      if (v && NAME_FX[v] == null) throw err(400, 'Unknown name effect');
      if (v && NAME_FX[v] > rank.tier.i) throw err(403, `That name effect unlocks at ${TIERS[NAME_FX[v]].emoji} ${TIERS[NAME_FX[v]].name} (${TIERS[NAME_FX[v]].hours} h).`);
      row.name_fx = v;
    }
    if ('mascot' in b) row.mascot = MASCOTS.includes(b.mascot) ? b.mascot : null;
    if ('seasonal' in b) row.seasonal = !!b.seasonal;
    if ('banner' in b) row.banner = bannerOf(b.banner);
    if ('tagline' in b) row.tagline = cleanText(b.tagline, 60).replace(/\n/g, ' ');
    if ('fav4' in b) { const seen = new Set(); row.fav4 = (Array.isArray(b.fav4) ? b.fav4 : []).map(cardOf).filter((c) => c && !seen.has(`${c.media_type}:${c.id}`) && seen.add(`${c.media_type}:${c.id}`)).slice(0, 4); }
    if ('show_stats' in b) row.show_stats = !!b.show_stats;
    if ('show_watching' in b) row.show_watching = !!b.show_watching;
    const r = (await sb('ghostflix_flair?on_conflict=user_id,profile_id', { method: 'POST', body: row, prefer: 'resolution=merge-duplicates,return=representation' }))?.[0];
    res.json({ flair: viewFlair(r, rank), rank });
  }));

  // ---------------------------------------------------------------- public profile extras (opt-in only)
  async function publicExtra(slug) {
    if (!feat('publicProfiles') || !sb || !/^[a-z0-9]{10}$/.test(slug)) return null;
    const p = (await sb(`ghostflix_public_profiles?slug=eq.${slug}&enabled=is.true&select=user_id,profile_id,name,bio,color,avatar`))?.[0];
    if (!p || (await bannedNow(p.user_id))) return null;
    const [f, s, soc] = await Promise.all([flairRow(p.user_id, p.profile_id), summary(p.user_id, p.profile_id), sb(`ghostflix_social?user_id=eq.${p.user_id}&select=friends_on,share_watching,watching,watching_at`).then((x) => x?.[0])]);
    const rank = rankOf(s); const fl = viewFlair(f, rank);
    const out = { profile: { name: p.name, bio: p.bio, color: p.color, avatar: p.avatar }, flair: { border: fl.border, mascot: fl.mascot, name_fx: fl.name_fx, seasonal: fl.seasonal, banner: fl.banner, tagline: fl.tagline, fav4: fl.fav4 } };
    if (fl.show_stats) { out.rank = { ...rank, seconds: undefined, discord: undefined }; out.stats = statsOf(s); out.badges = badgesOf(s); }
    if (fl.show_watching && fresh(soc)) out.watching = { title: soc.watching.title, sub: soc.watching.sub, href: soc.watching.href, at: soc.watching_at };
    return out;
  }
  app.get('/api/u/:slug/extra', wrap(async (req, res) => {
    const x = await publicExtra(req.params.slug); if (!x) throw err(404, 'This profile isn’t public.');
    delete x.profile; res.set('Cache-Control', 'no-store').json(x);
  }));
  // Open Graph / Discord preview for /u/<slug> (crawlers don't run JS). Private or missing → the normal page, no details.
  const INDEX = path.join(ROOT, 'public/index.html');
  const escA = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  app.get(/^\/u\/([a-z0-9]{10})$/, (req, res, next) => ogPage(req, res).catch(next));
  async function ogPage(req, res) {
    const html = await fs.promises.readFile(INDEX, 'utf8');
    let x = null; try { x = await publicExtra(req.params[0]); } catch {}
    res.set('Cache-Control', 'no-cache');
    if (!x) return res.type('html').send(html.replace(/<meta name="robots"[^>]*>/, '').replace('</head>', '<meta name="robots" content="noindex">\n</head>'));
    const host = String(req.get('host') || 'ghostflix.uk'); const base = `${/^(localhost|127\.)/.test(host) ? 'http' : 'https'}://${host}`;
    const url = `${base}/u/${req.params[0]}`;
    const title = `${x.profile.name} on GhostFlix${x.rank ? ` · ${x.rank.tier.emoji} ${x.rank.tier.name}` : ''}`;
    const bits = [x.flair.tagline, x.profile.bio].filter(Boolean).join(' — ');
    const desc = (bits || 'Their public GhostFlix profile.') + (x.rank ? ` · ${x.rank.hours} h watched` : '') + (x.flair.fav4?.length ? ` · Favourites: ${x.flair.fav4.map((c) => c.title).join(', ')}` : '');
    const img = x.flair.banner?.type === 'backdrop' ? x.flair.banner.url : x.flair.fav4?.find((c) => c.backdrop)?.backdrop || `${base}/og-image.png`;
    const color = x.rank?.tier.color || x.profile.color || '#04050a';
    const set = (h, prop, v) => h.replace(new RegExp(`(<meta (?:property|name)="${prop}" content=")[^"]*(")`), `$1${escA(v)}$2`);
    let h = html.replace(/<title>[^<]*<\/title>/, `<title>${escA(title)}</title>`);
    for (const [k, v] of [['description', desc], ['og:title', title], ['og:description', desc], ['og:url', url], ['og:image', img], ['og:image:alt', `${x.profile.name}'s GhostFlix profile`], ['twitter:title', title], ['twitter:description', desc], ['twitter:image', img], ['twitter:image:alt', `${x.profile.name}'s GhostFlix profile`], ['theme-color', color]]) h = set(h, k, v);
    if (!/og-image\.png$/.test(img)) h = h.replace(/<meta property="og:image:(type|width|height)"[^>]*>\n?/g, '');
    h = h.replace('<meta property="og:type" content="website">', '<meta property="og:type" content="profile">');
    res.type('html').send(h);
  }

  // ---------------------------------------------------------------- follows (friends only; see them only if they share)
  app.get('/api/me/following', wrap(async (req, res) => {
    needSb(); needFeat('friends'); const u = await needUser(req);
    const rows = (await sb(`ghostflix_follows?follower=eq.${u.id}&select=followee`)) || []; const ids = rows.map((r) => r.followee).filter((x) => UUID.test(x));
    let out = [];
    if (ids.length) {
      const fr = new Set(((await sb(`ghostflix_friends?status=eq.accepted&or=(and(a.eq.${u.id},b.in.(${ids.join(',')})),and(b.eq.${u.id},a.in.(${ids.join(',')})))&select=a,b`)) || []).map((r) => (r.a === u.id ? r.b : r.a)));
      const soc = (await sb(`ghostflix_social?user_id=in.(${[...fr].join(',') || '00000000-0000-0000-0000-000000000000'})&select=user_id,display_name,friends_on,share_watching,watching,watching_at`)) || [];
      out = soc.map((s) => ({ id: s.user_id, name: s.display_name || 'Viewer', watching: fresh(s) ? { title: s.watching.title, sub: s.watching.sub, href: s.watching.href, at: s.watching_at } : null }));
    }
    res.set('Cache-Control', 'no-store').json({ ids: out.map((x) => x.id), following: out });
  }));
  app.post('/api/me/follow', wrap(async (req, res) => {
    needSb(); needFeat('friends'); const u = await needUser(req); const id = String(req.body?.id || ''); if (!UUID.test(id) || id === u.id) throw err(400, 'Bad request');
    if (req.body?.on) { if (!(await friends(u.id, id))) throw err(403, 'You can only follow friends.'); await sb('ghostflix_follows?on_conflict=follower,followee', { method: 'POST', body: { follower: u.id, followee: id }, prefer: 'resolution=ignore-duplicates,return=minimal' }); }
    else await sb(`ghostflix_follows?follower=eq.${u.id}&followee=eq.${id}`, { method: 'DELETE', prefer: 'return=minimal' });
    res.json({ ok: true, on: !!req.body?.on });
  }));

  // ---------------------------------------------------------------- shared lists (two friends build one together)
  const names = async (ids) => { const m = {}; if (ids.length) for (const s of (await sb(`ghostflix_social?user_id=in.(${[...new Set(ids)].join(',')})&select=user_id,display_name`)) || []) m[s.user_id] = s.display_name || 'Viewer'; return m; };
  async function myList(u, id) {
    const n = parseInt(id, 10) || 0; const l = (await sb(`ghostflix_shared_lists?id=eq.${n}&or=(a.eq.${u.id},b.eq.${u.id})&select=*`))?.[0];
    if (!l) throw err(404, 'List not found'); return l;
  }
  const viewList = (l, me, nm, full) => ({ id: l.id, name: l.name, friend: { id: l.a === me ? l.b : l.a, name: nm[l.a === me ? l.b : l.a] || 'Viewer' }, count: (l.items || []).length, updated_at: l.updated_at, ...(full ? { items: (l.items || []).map((it) => ({ ...it, by: it.by === me ? 'you' : nm[it.by] || 'Friend' })) } : { preview: (l.items || []).slice(0, 4).map((c) => c.poster).filter(Boolean) }) });
  app.get('/api/me/shared-lists', wrap(async (req, res) => {
    needSb(); needFeat('friends'); const u = await needUser(req);
    const ls = (await sb(`ghostflix_shared_lists?or=(a.eq.${u.id},b.eq.${u.id})&select=*&order=updated_at.desc&limit=50`)) || [];
    const nm = await names(ls.flatMap((l) => [l.a, l.b])); res.set('Cache-Control', 'no-store').json({ lists: ls.map((l) => viewList(l, u.id, nm, false)) });
  }));
  app.post('/api/me/shared-lists', wrap(async (req, res) => {
    needSb(); needFeat('friends'); const u = await needUser(req); const fid = String(req.body?.friend || ''); const name = cleanText(req.body?.name, 60).replace(/\n/g, ' ');
    if (!UUID.test(fid) || !name) throw err(400, 'Pick a friend and a name.'); if (!(await friends(u.id, fid))) throw err(403, 'Shared lists are for friends.');
    const mine = (await sb(`ghostflix_shared_lists?or=(a.eq.${u.id},b.eq.${u.id})&select=id`)) || []; if (mine.length >= 30) throw err(400, 'That’s the maximum of 30 shared lists.');
    const [a, b] = pair(u.id, fid); const l = (await sb('ghostflix_shared_lists', { method: 'POST', body: { a, b, name, created_by: u.id }, prefer: 'return=representation' }))?.[0];
    res.json({ id: l.id });
  }));
  app.get('/api/me/shared-lists/:id', wrap(async (req, res) => {
    needSb(); needFeat('friends'); const u = await needUser(req); const l = await myList(u, req.params.id);
    const nm = await names([l.a, l.b, ...(l.items || []).map((i) => i.by).filter((x) => UUID.test(x || ''))]);
    res.set('Cache-Control', 'no-store').json({ ...viewList(l, u.id, nm, true), still_friends: await friends(l.a, l.b) });
  }));
  app.post('/api/me/shared-lists/:id/items', wrap(async (req, res) => {
    needSb(); needFeat('friends'); const u = await needUser(req); const l = await myList(u, req.params.id);
    if (!(await friends(l.a, l.b))) throw err(403, 'You’re no longer friends, so this list is read-only.');
    let items = Array.isArray(l.items) ? l.items : [];
    if (req.body?.remove) { const k = String(req.body.remove); items = items.filter((c) => `${c.media_type}:${c.id}` !== k); }
    else { const c = cardOf(req.body?.card); if (!c) throw err(400, 'Bad title'); if (items.some((x) => x.media_type === c.media_type && x.id === c.id)) return res.json({ ok: true, dup: true }); if (items.length >= 100) throw err(400, 'A shared list holds up to 100 titles.'); items = [{ ...c, by: u.id, at: new Date().toISOString() }, ...items]; }
    await sb(`ghostflix_shared_lists?id=eq.${l.id}`, { method: 'PATCH', body: { items, updated_at: new Date().toISOString() }, prefer: 'return=minimal' }); res.json({ ok: true, count: items.length });
  }));
  app.patch('/api/me/shared-lists/:id', wrap(async (req, res) => {
    needSb(); needFeat('friends'); const u = await needUser(req); const l = await myList(u, req.params.id); const name = cleanText(req.body?.name, 60).replace(/\n/g, ' '); if (!name) throw err(400, 'Name it first.');
    await sb(`ghostflix_shared_lists?id=eq.${l.id}`, { method: 'PATCH', body: { name, updated_at: new Date().toISOString() }, prefer: 'return=minimal' }); res.json({ ok: true });
  }));
  app.delete('/api/me/shared-lists/:id', wrap(async (req, res) => {
    needSb(); needFeat('friends'); const u = await needUser(req); const l = await myList(u, req.params.id);
    await sb(`ghostflix_shared_lists?id=eq.${l.id}`, { method: 'DELETE', prefer: 'return=minimal' }); res.json({ ok: true });
  }));
  return { summary, rankOf };
}
