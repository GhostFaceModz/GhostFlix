// GhostFlix accounts: Supabase Auth (Google / Discord) + watchlist & history sync.
// Works without config: if /api/config has no `auth`, the Sign-in dialog explains it isn't set up.
const GOOGLE_SVG = '<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path fill="#4285F4" d="M21.6 12.2c0-.7-.1-1.4-.2-2H12v3.8h5.4a4.6 4.6 0 0 1-2 3v2.5h3.2c1.9-1.7 3-4.3 3-7.3Z"/><path fill="#34A853" d="M12 22c2.7 0 5-.9 6.6-2.4l-3.2-2.5c-.9.6-2 1-3.4 1-2.6 0-4.8-1.8-5.6-4.1H3.1v2.6A10 10 0 0 0 12 22Z"/><path fill="#FBBC05" d="M6.4 14c-.2-.6-.3-1.3-.3-2s.1-1.4.3-2V7.4H3.1a10 10 0 0 0 0 9.2L6.4 14Z"/><path fill="#EA4335" d="M12 6c1.5 0 2.8.5 3.8 1.5l2.9-2.9A10 10 0 0 0 3.1 7.4L6.4 10C7.2 7.7 9.4 6 12 6Z"/></svg>';
export const DISCORD_SVG = '<svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true"><path fill="currentColor" d="M20.3 4.4A19.8 19.8 0 0 0 15.4 3l-.6 1.3a18.4 18.4 0 0 0-5.5 0L8.6 3a19.7 19.7 0 0 0-4.9 1.5C.6 9.1-.3 13.6.1 18.1a19.9 19.9 0 0 0 6 3l1.3-2a12.9 12.9 0 0 1-2-1l.5-.4a14.2 14.2 0 0 0 12.2 0l.5.4c-.6.4-1.3.7-2 1l1.3 2a19.8 19.8 0 0 0 6-3c.5-5.2-.8-9.7-3.6-13.7ZM8.3 15.3c-1.2 0-2.2-1.1-2.2-2.4s1-2.4 2.2-2.4 2.2 1.1 2.2 2.4-1 2.4-2.2 2.4Zm7.4 0c-1.2 0-2.2-1.1-2.2-2.4s1-2.4 2.2-2.4 2.2 1.1 2.2 2.4-1 2.4-2.2 2.4Z"/></svg>';
export const ICONS = { DISCORD_SVG };
import { Cosmetics, avatarWrap } from './cosmetics.js?v=20261023yf';
import { seasonFromUser } from './settings.js?v=20261023yf';
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const WL = 'ghostflix_watchlist', HI = 'ghostflix_history';

export function createAuth({ config, list, history, toast, onChange }) {
  let sb = null, user = null, ok = { [WL]: true, [HI]: true }, modal = null;
  const slot = document.getElementById('account');
  const A = config.auth;
  const listeners = new Set();
  const emit = () => listeners.forEach((f) => f(user));

  const loadLib = () => (window.supabase ? Promise.resolve(window.supabase) : new Promise((res, rej) => {
    const s = document.createElement('script'); s.src = '/vendor/supabase.js'; s.onload = () => res(window.supabase); s.onerror = rej; document.head.appendChild(s);
  }));
  async function client() {
    if (sb || !A) return sb;
    const lib = await loadLib();
    sb = lib.createClient(A.url, A.key, { auth: { flowType: 'pkce', persistSession: true, autoRefreshToken: true, detectSessionInUrl: true, storageKey: 'ghostflix-auth' } });
    sb.auth.onAuthStateChange((_e, session) => { const was = user?.id; user = session?.user || null; if (user) { Cosmetics.fromUser(user); seasonFromUser(user); } render(); if (user && user.id !== was) sync(); if (session?.access_token) checkDiscordAdmin(session.access_token); });
    return sb;
  }
  const meta = () => { const m = user?.user_metadata || {}; return { name: m.custom_claims?.global_name || m.full_name || m.name || m.user_name || (user?.email || 'Viewer').split('@')[0], av: m.avatar_url || m.picture || '', provider: user?.app_metadata?.provider || '' }; };

  function render() {
    emit();
    drawer();
    if (!slot) return;
    if (!user) {
      const g = !A || A.google, d = !A || A.discord;
      slot.innerHTML = `<div class="sso-wrap">${g ? `<button class="sso g" type="button" data-sso="google" aria-label="Sign in with Google" title="Sign in with Google">${GOOGLE_SVG}</button>` : ''}${d ? `<button class="sso d" type="button" data-sso="discord" aria-label="Sign in with Discord" title="Sign in with Discord">${DISCORD_SVG}</button>` : ''}</div>`;
      return;
    }
    const m = meta();
    slot.innerHTML = `<div class="acct"><button class="acct-me" type="button" aria-haspopup="menu" aria-expanded="false">${avatarWrap(m.av ? `<img src="${esc(m.av)}" alt="" referrerpolicy="no-referrer">` : `<span class="ini">${esc(m.name[0] || '?')}</span>`)}<span class="un gf-name">${esc(m.name)}</span><svg viewBox="0 0 24 24" width="14" height="14"><path fill="currentColor" d="M12 15.5 5.5 9l1.4-1.4 5.1 5.1 5.1-5.1L18.5 9z"/></svg></button>
      <div class="acct-dd" role="menu"><div class="acct-h"><b class="gf-name">${esc(m.name)}</b><span>${esc(user.email || '')}</span></div>
      <a href="/my-list" data-link role="menuitem">My List</a><a href="/settings/history" data-link role="menuitem">History</a><a href="/profiles" data-link role="menuitem">Switch profile</a><a href="/settings" data-link role="menuitem">Settings</a><button type="button" data-signout role="menuitem">Sign out</button></div></div>`;
  }
  function drawer() {
    const d = document.getElementById('drawerAuth'); if (!d) return;
    const m = meta();
    d.innerHTML = user ? `<div style="display:flex;gap:10px;align-items:center;margin-bottom:12px">${m.av ? avatarWrap(`<img src="${esc(m.av)}" alt="" width="36" height="36" style="border-radius:50%" referrerpolicy="no-referrer">`) : ''}<b style="font-size:14px" class="gf-name">${esc(m.name)}</b></div><button class="btn dark sm" data-signout type="button">Sign out</button>`
      : `<button class="btn cta sm" data-signin type="button">Sign in</button>`;
  }
  function openModal() {
    if (!modal) {
      modal = document.createElement('div'); modal.className = 'authm'; modal.setAttribute('role', 'dialog'); modal.setAttribute('aria-modal', 'true'); modal.setAttribute('aria-labelledby', 'authH');
      modal.innerHTML = `<div class="bx"><button type="button" class="x" aria-label="Close">×</button><img class="gh" src="/img/logo.svg" alt="">
        <h2 id="authH">Sign in to GhostFlix</h2><p>Sync your list and watch history across devices.</p>
        ${A ? `${A.google ? `<button type="button" class="pb pg" data-p="google">${GOOGLE_SVG}Continue with Google</button>` : ''}${A.discord ? `<button type="button" class="pb pd" data-p="discord">${DISCORD_SVG}Continue with Discord</button>` : ''}`
          : '<p class="er">Sign-in isn’t configured on this server yet (SUPABASE_PUBLIC_URL / SUPABASE_ANON_KEY).</p>'}
        <div class="er" role="alert"></div><small>Everything still works on this device without an account.</small></div>`;
      document.body.appendChild(modal);
      modal.addEventListener('click', (e) => { if (e.target === modal || e.target.closest('.x')) close(); const b = e.target.closest('[data-p]'); if (b) login(b.dataset.p, b); });
    }
    modal.classList.add('open'); setTimeout(() => modal.querySelector('.pb,.x')?.focus(), 30);
  }
  const close = () => modal?.classList.remove('open');
  async function login(provider, btn) {
    if (!A) { openModal(); return; }
    btn.disabled = true; const er = modal?.contains(btn) ? modal.querySelector('.er') : { set textContent(v) { if (v) toast(v); } }; er.textContent = '';
    try {
      const c = await client();
      const back = new URL(location.pathname.startsWith('/watch/') ? '/' : location.pathname + location.search, location.origin);
      const { error } = await c.auth.signInWithOAuth({ provider, options: { redirectTo: back.href } });
      if (error) throw error;
    } catch (e) {
      btn.disabled = false;
      er.textContent = /not enabled|Unsupported provider/i.test(e?.message || '') ? `${provider === 'discord' ? 'Discord' : 'Google'} sign-in isn’t enabled yet.` : `Couldn’t start sign-in: ${e?.message || e}`;
    }
  }
  async function signOut() { const c = await client(); await c?.auth.signOut(); user = null; render(); toast('Signed out. Your data stays on this device.'); }

  // ---- sync -------------------------------------------------------------------------
  const missing = (e) => e && (e.code === '42P01' || e.code === 'PGRST205' || /does not exist|schema cache/i.test(e.message || ''));
  const key = (x) => `${x.media_type}:${x.id}`;
  const card = (c) => ({ title: c.title, year: c.year, poster: c.poster, backdrop: c.backdrop, rating: c.rating, ...(c.demo ? { demo: true } : {}) });
  async function sync() {
    if (!user || !sb) return;
    // watchlist: union merge
    const w = await sb.from(WL).select('media_type,tmdb_id,data,added_at').order('added_at', { ascending: false });
    if (w.error) ok[WL] = !missing(w.error) && ok[WL];
    else {
      const local = list.all(); const remote = w.data.map((r) => ({ ...(r.data || {}), id: Number(r.tmdb_id), media_type: r.media_type }));
      const rk = new Set(remote.map(key));
      list.replace([...local, ...remote.filter((r) => !local.some((l) => key(l) === key(r)))]);
      const up = local.filter((l) => !rk.has(key(l))).map((c) => ({ user_id: user.id, media_type: c.media_type, tmdb_id: c.id, data: card(c) }));
      if (up.length) await sb.from(WL).upsert(up, { ignoreDuplicates: true });
    }
    // history: newest entry wins per title
    const h = await sb.from(HI).select('media_type,tmdb_id,season,episode,progress,time,data,watched_at').order('watched_at', { ascending: false }).limit(200);
    if (h.error) ok[HI] = !missing(h.error) && ok[HI];
    else {
      const local = history.all();
      const remote = h.data.map((r) => ({ ...(r.data || {}), id: Number(r.tmdb_id), media_type: r.media_type, s: r.season, e: r.episode, progress: r.progress, time: r.time, at: Date.parse(r.watched_at) }));
      const map = new Map(); [...remote, ...local].forEach((x) => { const p = map.get(key(x)); if (!p || (x.at || 0) > (p.at || 0)) map.set(key(x), x); });
      history.replace([...map.values()].sort((a, b) => (b.at || 0) - (a.at || 0)));
      const rmap = new Map(remote.map((r) => [key(r), r]));
      const up = local.filter((l) => !rmap.has(key(l)) || (l.at || 0) > (rmap.get(key(l)).at || 0)).map(histRow);
      if (up.length) await sb.from(HI).upsert(up);
    }
    onChange?.();
  }
  const histRow = (c) => ({ user_id: user.id, media_type: c.media_type, tmdb_id: c.id, season: c.s ?? null, episode: c.e ?? null, progress: c.progress ?? null, time: c.time ?? null, data: { ...card(c), ...(c.dur ? { dur: c.dur } : {}), ...(c.done ? { done: true } : {}), ...(c.next ? { next: c.next } : {}), ...(c.approx ? { approx: true } : {}), ...(c.src ? { src: c.src } : {}) }, watched_at: new Date(c.at || Date.now()).toISOString() });
  async function run(table, q) { if (!user || !sb || !ok[table]) return; const { error } = await q(); if (error && missing(error)) ok[table] = false; }
  const onToggle = (c, on) => run(WL, () => (on ? sb.from(WL).upsert({ user_id: user.id, media_type: c.media_type, tmdb_id: c.id, data: card(c) }) : sb.from(WL).delete().match({ user_id: user.id, media_type: c.media_type, tmdb_id: c.id })));
  let hT = null; const pending = new Map();
  const onHistory = (c) => { if (!user) return; pending.set(key(c), c); clearTimeout(hT); hT = setTimeout(() => { const rows = [...pending.values()].map(histRow); pending.clear(); run(HI, () => sb.from(HI).upsert(rows)); }, 3000); };
  const onHistoryRemove = (c) => run(HI, () => sb.from(HI).delete().match({ user_id: user.id, media_type: c.media_type, tmdb_id: c.id }));
  const onHistoryClear = () => run(HI, () => sb.from(HI).delete().eq('user_id', user.id));

  document.addEventListener('click', (e) => {
    if (e.target.closest('[data-signin]')) { openModal(); return; }
    const sso = e.target.closest('[data-sso]'); if (sso) { login(sso.dataset.sso, sso); return; }
    const me = e.target.closest('.acct-me'); if (me) { const o = me.parentNode.classList.toggle('open'); me.setAttribute('aria-expanded', o); return; }
    if (e.target.closest('[data-signout]')) { signOut(); return; }
    document.querySelectorAll('.acct.open').forEach((a) => !a.contains(e.target) && a.classList.remove('open'));
  });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') { close(); document.querySelectorAll('.acct.open').forEach((a) => a.classList.remove('open')); } });

  window.addEventListener('gf:cosmetics', () => render());
  render();
  // Only load the SDK eagerly when a session might exist (stored session or OAuth callback ?code=).
  if (A && (localStorage.getItem('ghostflix-auth') || /[?&]code=/.test(location.search))) client().then(async (c) => {
    const { data } = await c.auth.getSession(); user = data.session?.user || null; if (user) { Cosmetics.fromUser(user); seasonFromUser(user); } render(); if (user) sync();
    const u = new URL(location.href); if (u.searchParams.has('code')) { u.searchParams.delete('code'); window.history.replaceState(window.history.state, '', u.pathname + u.search + u.hash); }
  }).catch((e) => console.warn('[ghostflix] auth init', e));
  return { client, onToggle, onHistory, onHistoryRemove, onHistoryClear, openModal, signOut, meta, subscribe: (f) => listeners.add(f), get user() { return user; }, get enabled() { return !!A; } };
}

// If the signed-in Discord account is the site owner's, the server grants admin and the menu shows the Admin link.
let adminChecked = '';
function checkDiscordAdmin(token) {
  if (adminChecked === token) return; adminChecked = token;
  fetch('/api/admin/discord', { method: 'POST', credentials: 'same-origin', headers: { Authorization: `Bearer ${token}` } })
    .then((r) => r.json()).then((d) => { const a = document.getElementById('adminLink'); if (a && d.admin) a.hidden = false; }).catch(() => {});
}
