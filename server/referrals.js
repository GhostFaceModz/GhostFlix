// "Promote GhostFlix": personal referral links (/?ref=CODE), click + "watching" counting, first-sign-up attribution, public top 10,
// and the admin promoter list for paying out Bloodstrike Gold. Tables: supabase/migrations/20261023_referrals.sql.
// All writes go through the service key here; users only ever read their own rows (RLS).
import crypto from 'node:crypto';
import { limiter } from './b3.js';

export const DEFAULT_REWARD = 'Bloodstrike Gold rewards for every person who joins with your link';
export const CODE_RE = /^[A-Za-z0-9]{4,16}$/;
const ALPHA = 'abcdefghjkmnpqrstuvwxyz23456789'; // no 0/o/1/l/i look-alikes
export const newCode = (n = 7) => Array.from(crypto.randomBytes(n), (b) => ALPHA[b % ALPHA.length]).join('');
const NEW_ACCOUNT_MS = 2 * 3600e3; // only accounts created in the last 2 hours count as "new" sign-ups
const err = (status, message) => Object.assign(new Error(message), { status });
const clip = (v, n) => String(v ?? '').replace(/[\u0000-\u001f]/g, '').trim().slice(0, n);

/** Leaderboard score: everyone who starts watching through the link counts; a sign-up is a bonus worth 3. */
export const SIGNUP_BONUS = 3;
export const scoreOf = (r) => (Number(r?.watching) || 0) + (Number(r?.signups) || 0) * SIGNUP_BONUS;
/** Leaderboard order: highest score, then sign-ups, then clicks, then who started earliest. */
export const rankSort = (a, b) => scoreOf(b) - scoreOf(a) || b.signups - a.signups || b.clicks - a.clicks || String(a.created_at).localeCompare(String(b.created_at));
export const DEVICE_RE = /^[A-Za-z0-9_-]{16,64}$/;
/** Is this account new enough to be attributed to a referrer? */
export const isNewAccount = (createdAt, now = Date.now()) => { const t = Date.parse(createdAt || ''); return Number.isFinite(t) && now - t >= -60e3 && now - t <= NEW_ACCOUNT_MS; };

export function mountReferrals(app, { env, wrap, admin, store, sb, needUser }) {
  const SRV = (env.SUPABASE_URL || '').replace(/\/$/, ''), KEY = env.SUPABASE_SERVICE_KEY;
  const SALT = crypto.createHash('sha256').update(`${env.SESSION_SECRET || ''}|${KEY || ''}|gf-ref`).digest('hex');
  const reward = () => clip(store.data.promo?.reward, 200) || DEFAULT_REWARD;
  const need = () => { if (!sb) throw err(503, 'Accounts aren’t set up on this server.'); };
  const clickIp = limiter(40, 3600e3), clickCode = limiter(1, 3600e3), watchIp = limiter(40, 3600e3), watchCode = limiter(1, 3600e3), meLimit = limiter(30, 60e3), claimLimit = limiter(10, 3600e3);

  // Full auth record (created_at, Discord identity) via the Auth admin API.
  async function authUser(id) {
    const r = await fetch(`${SRV}/auth/v1/admin/users/${id}`, { headers: { apikey: KEY, Authorization: `Bearer ${KEY}` }, signal: AbortSignal.timeout(6000) }).catch(() => null);
    if (!r?.ok) throw err(502, 'Couldn’t check your account right now. Try again in a minute.');
    return r.json();
  }
  const discordOf = (u) => { const i = (u.identities || []).find((x) => x.provider === 'discord'); const d = i?.identity_data || {}; const m = u.user_metadata || {};
    return i ? { id: String(i.id || d.provider_id || d.sub || ''), username: clip(d.name || d.user_name || d.full_name || m.user_name || m.name || '', 60) } : null; };

  let board = { at: 0, rows: [] };
  async function stats(force) {
    if (!force && Date.now() - board.at < 30e3) return board.rows;
    const rows = (await sb('ghostflix_ref_stats?select=user_id,code,display_name,discord_id,discord_username,created_at,clicks,signups,last_signup,watching&limit=5000')) || [];
    rows.forEach((r) => { r.watching = Number(r.watching) || 0; r.score = scoreOf(r); }); rows.sort(rankSort); board = { at: Date.now(), rows }; return rows;
  }
  const rankOf = (rows, uid) => { const i = rows.filter((r) => r.score > 0).findIndex((r) => r.user_id === uid); return i < 0 ? null : i + 1; };

  // Public: promo text + top 10 by score (display names only).
  app.get('/api/promo', wrap(async (req, res) => {
    let top = [];
    if (sb) { try { top = (await stats()).filter((r) => r.score > 0).slice(0, 10).map((r, i) => ({ rank: i + 1, name: r.display_name || 'Ghost', watching: r.watching, signups: r.signups, score: r.score })); } catch {} }
    res.setHeader('Cache-Control', 'no-store'); res.json({ reward: reward(), discord: 'https://discord.gg/zenclipsdaily', bonus: SIGNUP_BONUS, top });
  }));

  // Public: someone opened a ?ref= link. One click per visitor (IP hash) per code per day, plus an IP rate limit.
  app.post('/api/ref/click', wrap(async (req, res) => {
    need(); const code = String(req.body?.code || '').trim();
    if (!CODE_RE.test(code)) throw err(400, 'Bad code');
    // Render sits behind Cloudflare, so req.ip alone is an edge address; cf-connecting-ip is the visitor.
    const ip = String(req.get('cf-connecting-ip') || req.ip || ''); const vh = crypto.createHash('sha256').update(`${SALT}|${ip}|${code.toLowerCase()}`).digest('hex').slice(0, 40);
    if (!clickIp(ip) || !clickCode(vh)) return res.json({ ok: true, counted: false });
    const own = (await sb(`ghostflix_ref_codes?select=user_id,code&code=ilike.${encodeURIComponent(code)}`))?.[0];
    if (!own) return res.status(404).json({ ok: false, error: 'Unknown code' });
    // A signed-in promoter opening their own link doesn't count.
    if (req.get('authorization')) { try { const u = await needUser(req); if (u.id === own.user_id) return res.json({ ok: true, counted: false, self: true }); } catch {} }
    let counted = true;
    try { await sb('ghostflix_ref_clicks?on_conflict=code,visitor_hash,day', { method: 'POST', body: { code: own.code, visitor_hash: vh }, prefer: 'resolution=ignore-duplicates,return=minimal' }); } catch { counted = false; }
    board.at = 0; res.json({ ok: true, counted, code: own.code });
  }));

  // Public: a visitor who arrived via a ?ref= link started playing something. Counts once per device ever (device_id
  // unique), at most once per visitor IP per code per day, IP rate limit, and never the promoter themselves.
  app.post('/api/ref/watch', wrap(async (req, res) => {
    need(); const code = String(req.body?.code || '').trim(), device = String(req.body?.device || '').trim();
    if (!CODE_RE.test(code) || !DEVICE_RE.test(device)) throw err(400, 'Bad request');
    const ip = String(req.get('cf-connecting-ip') || req.ip || ''); const vh = crypto.createHash('sha256').update(`${SALT}|${ip}|${code.toLowerCase()}`).digest('hex').slice(0, 40);
    if (!watchIp(ip) || !watchCode(vh)) return res.json({ ok: true, counted: false });
    const own = (await sb(`ghostflix_ref_codes?select=user_id,code&code=ilike.${encodeURIComponent(code)}`))?.[0];
    if (!own) return res.status(404).json({ ok: false, error: 'Unknown code' });
    if (req.get('authorization')) { try { const u = await needUser(req); if (u.id === own.user_id) return res.json({ ok: true, counted: false, self: true }); } catch {} }
    let got = [];
    try { got = (await sb('ghostflix_ref_watches?on_conflict=device_id', { method: 'POST', body: { code: own.code, device_id: device, visitor_hash: vh }, prefer: 'resolution=ignore-duplicates,return=representation' })) || []; }
    catch { return res.json({ ok: true, counted: false }); } // same visitor + code already counted today
    if (got.length) board.at = 0;
    res.json({ ok: true, counted: got.length > 0, done: true, code: own.code }); // done: this device is settled (counted now or before)
  }));

  // Signed in: get (or create) my stable code, with my clicks / sign-ups / rank.
  app.get('/api/me/referral', wrap(async (req, res) => {
    const u = await needUser(req); if (!meLimit(u.id)) throw err(429, 'Slow down a little.');
    res.setHeader('Cache-Control', 'no-store');
    let mine = (await sb(`ghostflix_ref_codes?select=code&user_id=eq.${u.id}`))?.[0];
    const full = await authUser(u.id); const dc = discordOf(full);
    const info = { display_name: clip(u.name, 40) || 'Ghost', discord_id: dc?.id || null, discord_username: dc?.username || null };
    if (!mine) {
      for (let i = 0; i < 5 && !mine; i++) {
        try { mine = (await sb('ghostflix_ref_codes', { method: 'POST', body: { user_id: u.id, code: newCode(), ...info }, prefer: 'return=representation' }))?.[0]; }
        catch { mine = (await sb(`ghostflix_ref_codes?select=code&user_id=eq.${u.id}`))?.[0]; } // code collision, or created in parallel
      }
      if (!mine) throw err(502, 'Couldn’t create your link. Try again.');
      board.at = 0;
    } else sb(`ghostflix_ref_codes?user_id=eq.${u.id}`, { method: 'PATCH', body: info, prefer: 'return=minimal' }).catch(() => {}); // keep names fresh for payouts
    const rows = await stats(); const me = rows.find((r) => r.user_id === u.id) || { clicks: 0, signups: 0, watching: 0, score: 0 };
    res.json({ code: mine.code, link: `https://ghostflix.uk/?ref=${mine.code}`, clicks: me.clicks, watching: me.watching, signups: me.signups, score: me.score, rank: rankOf(rows, u.id), promoters: rows.filter((r) => r.score > 0).length, discord: !!dc });
  }));

  // Signed in: attribute this (new) account to the code it arrived with. Once per account, never yourself, never old accounts.
  app.post('/api/ref/claim', wrap(async (req, res) => {
    const u = await needUser(req); if (!claimLimit(u.id)) throw err(429, 'Slow down a little.');
    const code = String(req.body?.code || '').trim(); if (!CODE_RE.test(code)) throw err(400, 'Bad code');
    const own = (await sb(`ghostflix_ref_codes?select=user_id,code&code=ilike.${encodeURIComponent(code)}`))?.[0];
    if (!own) return res.json({ ok: false, reason: 'unknown' });
    if (own.user_id === u.id) return res.json({ ok: false, reason: 'self' });
    const full = await authUser(u.id);
    if (!isNewAccount(full.created_at)) return res.json({ ok: false, reason: 'existing' });
    // Same Discord account behind both sides (e.g. a second login method) also counts as self.
    const dc = discordOf(full); const refDc = (await sb(`ghostflix_ref_codes?select=discord_id&user_id=eq.${own.user_id}`))?.[0]?.discord_id;
    if (dc?.id && refDc && dc.id === refDc) return res.json({ ok: false, reason: 'self' });
    try { await sb('ghostflix_ref_signups?on_conflict=referred_user_id', { method: 'POST', body: { referred_user_id: u.id, referrer_id: own.user_id, code: own.code }, prefer: 'resolution=ignore-duplicates,return=minimal' }); }
    catch { return res.json({ ok: false, reason: 'error' }); }
    const got = (await sb(`ghostflix_ref_signups?select=referrer_id&referred_user_id=eq.${u.id}`))?.[0];
    board.at = 0; res.json({ ok: got?.referrer_id === own.user_id, reason: got?.referrer_id === own.user_id ? 'counted' : 'already' });
  }));

  // Admin: every promoter with clicks, watching, sign-ups and Discord details; editable reward text.
  admin.get('/promo', wrap(async (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    let rows = [], error = null; if (sb) { try { rows = await stats(true); } catch (e) { error = 'Referral tables missing or unreachable — run supabase/migrations/20261023_referrals.sql.'; } }
    let n = 0; res.json({ reward: reward(), custom: !!store.data.promo?.reward, defaultReward: DEFAULT_REWARD, error,
      bonus: SIGNUP_BONUS, promoters: rows.map((r) => ({ ...r, rank: r.score > 0 ? ++n : null })) });
  }));
  admin.put('/promo', wrap(async (req, res) => {
    const t = clip(req.body?.reward, 200);
    store.data.promo = { ...(store.data.promo || {}), reward: t }; await store.save();
    res.json({ ok: true, reward: reward() });
  }));
}
