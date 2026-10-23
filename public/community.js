// GhostFlix community features (Stage E): mood picker, Top 10 on GhostFlix, countdowns, achievements & streaks,
// opt-in public profile links, opt-in friends, friends-only watch-together chat, request-a-title and bug reports.
// Everything social is OFF until the viewer turns it on. Signed-in calls carry the Supabase access token; the server
// and the database's RLS policies decide what's allowed (friends-only chat, banned accounts, moderators).
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const dayISO = (d = new Date()) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const ago = (iso) => { const s = Math.max(0, (Date.now() - Date.parse(iso)) / 1000); return s < 60 ? 'just now' : s < 3600 ? `${Math.floor(s / 60)}m ago` : s < 86400 ? `${Math.floor(s / 3600)}h ago` : `${Math.floor(s / 86400)}d ago`; };
// OWNER / MODERATOR tag next to names — the server decides (Discord ID / live mod role); it's never stored by the client.
export const tagHTML = (t) => (t === 'owner' ? ' <span class="gf-tag own" title="GhostFlix owner">👑 OWNER</span>' : t === 'mod' ? ' <span class="gf-tag mod" title="GhostFlix moderator">🛡️ MOD</span>' : '');
const GENRE_BADGE = { 27: ['🎃', 'Horror hound'], 35: ['😂', 'Comedy connoisseur'], 28: ['💥', 'Action hero'], 878: ['🚀', 'Sci-fi voyager'], 18: ['🎭', 'Drama devotee'], 16: ['✏️', 'Animation addict'], 10749: ['💘', 'Hopeless romantic'], 53: ['🔪', 'Thrill seeker'], 99: ['🧠', 'Documentary buff'], 80: ['🕵️', 'Crime solver'], 9648: ['🔎', 'Mystery maven'], 14: ['🧙', 'Fantasy fan'], 10765: ['🛸', 'Sci-fi & fantasy fan'], 10759: ['⚔️', 'Adventure seeker'], 10751: ['🏡', 'Family favourite'] };

export function createCommunity(ctx) {
  // ctx: { api, auth(), toast, rowHTML, wireRows, cardHTML, remember, keyOf, profiles, list(), history(), site(), genres(), go, main }
  const feat = (k) => ctx.site()?.features?.[k] !== false;
  const state = { mod: false, banned: false, social: null };
  async function token() { const a = ctx.auth(); if (!a?.user) return null; try { const c = await a.client(); return (await c.auth.getSession()).data.session?.access_token || null; } catch { return null; } }
  async function call(path, { method = 'GET', body } = {}) {
    const t = await token();
    const r = await fetch(path, { method, headers: { ...(body ? { 'Content-Type': 'application/json' } : {}), ...(t ? { Authorization: `Bearer ${t}` } : {}) }, body: body ? JSON.stringify(body) : undefined, cache: 'no-store' });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw Object.assign(new Error(j.error || `Error ${r.status}`), { status: r.status });
    return j;
  }
  const signedIn = () => !!ctx.auth()?.user;
  // On a direct page load the Supabase session restores asynchronously; wait for it (max ~3s) before deciding "signed out".
  async function authReady() {
    const a = ctx.auth(); if (!a?.enabled || a.user) return;
    try { const c = await Promise.race([a.client(), new Promise((r) => setTimeout(r, 3000))]); if (c?.auth) await Promise.race([c.auth.getSession(), new Promise((r) => setTimeout(r, 2500))]); } catch {}
    for (let i = 0; i < 10 && !a.user && hasStoredSession(); i++) await new Promise((r) => setTimeout(r, 100));
  }
  const hasStoredSession = () => { try { return !!localStorage.getItem('ghostflix-auth'); } catch { return false; } };

  // ---- who am I (moderator link, suspended accounts)
  async function refreshMe() {
    if (!signedIn()) { state.mod = false; state.banned = false; } else {
      try { const d = await call('/api/me/ping', { method: 'POST' }); state.mod = !!d.mod; state.banned = !!d.banned; } catch {}
    }
    const ml = $('#modLink'); if (ml) ml.hidden = !state.mod;
    if (state.banned && !sessionStorage.getItem('gf.bantold')) { sessionStorage.setItem('gf.bantold', '1'); ctx.toast('Your GhostFlix account is suspended — account features are switched off.'); }
    applyFeatures();
  }
  function applyFeatures() {
    $$('[data-gf-feat]').forEach((el) => (el.hidden = !feat(el.dataset.gfFeat)));
  }

  // ---- countdowns (Coming soon, reminders, title pages)
  const target = (date) => { const t = Date.parse(/T/.test(date) ? date : `${date}T00:00:00`); return Number.isFinite(t) ? t : null; };
  function cdText(t) {
    let s = Math.floor((t - Date.now()) / 1000); if (s <= 0) return 'Out now';
    const d = Math.floor(s / 86400); s -= d * 86400; const h = Math.floor(s / 3600); s -= h * 3600; const m = Math.floor(s / 60); s -= m * 60;
    return d > 0 ? `${d}d ${h}h ${m}m` : `${h}h ${String(m).padStart(2, '0')}m ${String(s).padStart(2, '0')}s`;
  }
  const countdownHTML = (date, label = '') => { const t = target(date); if (!feat('countdowns') || !t || t <= Date.now()) return ''; return `<span class="cd" data-cd="${t}" title="${esc(label)} ${esc(date)}"><i aria-hidden="true">⏳</i><span>${esc(cdText(t))}</span></span>`; };
  setInterval(() => { for (const el of $$('[data-cd]')) { const s = el.querySelector('span'); if (s) s.textContent = cdText(+el.dataset.cd); } }, 1000);

  // ---- achievements & streaks (per viewer profile; synced to the account when signed in)
  const actKey = () => `gf.act.${ctx.profiles.active().id}`;
  const Act = {
    all() { try { return JSON.parse(localStorage.getItem(actKey())) || {}; } catch { return {}; } },
    save(a) { try { localStorage.setItem(actKey(), JSON.stringify(a)); } catch {} },
  };
  async function syncActivity(day, row) {
    if (!signedIn() || state.banned) return;
    try {
      const c = await ctx.auth().client(); const uid = ctx.auth().user.id;
      await c.from('ghostflix_activity').upsert({ user_id: uid, profile_id: ctx.profiles.active().id, day, minutes: Math.min(1440, Math.round(row.minutes)), plays: row.plays, genres: row.genres, updated_at: new Date().toISOString() });
    } catch {}
  }
  async function pullActivity() {
    if (!signedIn() || state.banned) return;
    try {
      const c = await ctx.auth().client(); const { data } = await c.from('ghostflix_activity').select('day,minutes,plays,genres').eq('profile_id', ctx.profiles.active().id).order('day', { ascending: false }).limit(400);
      if (!data?.length) return; const a = Act.all();
      for (const r of data) { const cur = a[r.day]; if (!cur || (cur.plays || 0) < r.plays) a[r.day] = { minutes: r.minutes, plays: r.plays, genres: r.genres || {} }; }
      Act.save(a);
    } catch {}
  }
  function notePlay(card, runtime, genreIds) {
    const a = Act.all(), day = dayISO(); const r = a[day] || { minutes: 0, plays: 0, genres: {} };
    r.plays += 1; r.minutes = Math.min(1440, r.minutes + Math.min(180, runtime || (card.media_type === 'tv' ? 45 : 110)));
    for (const g of (genreIds || []).slice(0, 4)) r.genres[g] = (r.genres[g] || 0) + 1;
    a[day] = r; const days = Object.keys(a).sort(); if (days.length > 400) for (const d of days.slice(0, days.length - 400)) delete a[d];
    Act.save(a); syncActivity(day, r);
    const before = new Set(achievements(Act.all(), true).filter((b) => b.got).map((b) => b.id));
    return before;
  }
  function streaks(a) {
    const days = new Set(Object.keys(a).filter((d) => a[d].plays > 0)); let cur = 0; const d = new Date();
    if (!days.has(dayISO(d))) d.setDate(d.getDate() - 1);
    while (days.has(dayISO(d))) { cur++; d.setDate(d.getDate() - 1); }
    let best = 0, run = 0, prev = null;
    for (const x of [...days].sort()) { const t = Date.parse(`${x}T12:00:00`); run = prev && Math.round((t - prev) / 864e5) === 1 ? run + 1 : 1; best = Math.max(best, run); prev = t; }
    return { cur, best, days: days.size };
  }
  function achievements(a = Act.all(), raw = false) {
    const st = streaks(a); const mins = Object.values(a).reduce((s, r) => s + (r.minutes || 0), 0); const hours = mins / 60;
    const plays = Object.values(a).reduce((s, r) => s + (r.plays || 0), 0);
    const g = {}; for (const r of Object.values(a)) for (const [k, v] of Object.entries(r.genres || {})) g[k] = (g[k] || 0) + v;
    const list = [
      { id: 'first', icon: '🎬', name: 'First watch', desc: 'Start your first title', got: plays >= 1 },
      ...[3, 7, 30].map((n) => ({ id: `streak${n}`, icon: n >= 30 ? '🔥' : n >= 7 ? '⚡' : '✨', name: `${n}-day streak`, desc: `Watch something ${n} days in a row`, got: st.best >= n, prog: Math.min(1, st.best / n) })),
      ...[1, 10, 50, 100, 250].map((n) => ({ id: `hours${n}`, icon: n >= 100 ? '🏆' : n >= 50 ? '🥇' : n >= 10 ? '🥈' : '🥉', name: `${n} hour${n > 1 ? 's' : ''} watched`, desc: `Watch about ${n} hour${n > 1 ? 's' : ''} in total`, got: hours >= n, prog: Math.min(1, hours / n) })),
      ...Object.entries(GENRE_BADGE).map(([id, [icon, name]]) => ({ id: `g${id}`, icon, name, desc: `Start 5 titles in ${ctx.genreName(+id) || 'this genre'}`, got: (g[id] || 0) >= 5, prog: Math.min(1, (g[id] || 0) / 5), genre: true })),
    ];
    return raw ? list : { list, streak: st, hours, plays };
  }
  function badgesHTML(items, empty = 'No badges yet') {
    return items.length ? `<div class="badges">${items.map((b) => `<div class="badge${b.got === false ? ' locked' : ''}" title="${esc(b.desc || b.name)}"><span class="bi">${esc(b.icon)}</span><b>${esc(b.name)}</b>${b.got === false && b.prog ? `<i class="bp"><i style="width:${Math.round(b.prog * 100)}%"></i></i>` : ''}</div>`).join('')}</div>` : `<p class="dim small">${esc(empty)}</p>`;
  }
  const earned = () => achievements(Act.all(), true).filter((b) => b.got).map(({ id, icon, name }) => ({ id, icon, name }));

  // ---- playback hook
  let lastWatchPost = 0;
  function onPlay(card, info = {}) {
    if (feat('achievements')) {
      const before = new Set(earned().map((b) => b.id));
      notePlay(card, info.runtime, info.genre_ids || card.genre_ids);
      const fresh = earned().filter((b) => !before.has(b.id));
      if (fresh.length) setTimeout(() => ctx.toast(`${fresh[0].icon} Badge unlocked: ${fresh[0].name}`), 2600);
    }
    if (signedIn() && feat('friends') && Date.now() - lastWatchPost > 20e3) {
      lastWatchPost = Date.now();
      call('/api/me/watching', { method: 'POST', body: { key: ctx.keyOf(card), title: card.title, sub: info.sub || '', href: `/title/${card.media_type}/${card.id}` } }).catch(() => {});
    }
  }

  // ---- Home: mood picker + Top 10 on GhostFlix
  async function homeExtras(rowsEl, after, kids) {
    if (feat('top10')) ctx.api('/api/top10').then((t) => {
      if (!rowsEl.isConnected || (t.items || []).length < 10 || after('gf-top10')) return;
      const tmp = document.createElement('div'); tmp.innerHTML = ctx.rowHTML({ id: 'gf-top10', title: 'Top 10 on GhostFlix this week', items: t.items.slice(0, 10), top10: true }, 'gftop');
      const ref = after('trending') || after('mylist') || after('continue'); ref ? ref.after(tmp.firstElementChild) : rowsEl.prepend(tmp.firstElementChild); ctx.wireRows(rowsEl);
    }).catch(() => {});
    if (!feat('moods')) return;
    let moods = []; try { moods = await ctx.api('/api/moods'); } catch { return; }
    if (!rowsEl.isConnected || after('gf-moods')) return;
    const sec = document.createElement('section'); sec.className = 'row moods'; sec.dataset.row = 'gf-moods';
    sec.innerHTML = `<div class="row-h"><h2>What’s your mood?</h2></div><div class="mood-chips" role="group" aria-label="Pick a mood">${moods.map((m) => `<button class="pill mood" type="button" data-mood="${esc(m.id)}" aria-pressed="false"><span aria-hidden="true">${esc(m.emoji)}</span> ${esc(m.label)}</button>`).join('')}</div><div class="mood-row"></div>`;
    const ref = after('continue') || after('mylist'); ref ? ref.after(sec) : rowsEl.prepend(sec);
    const out = $('.mood-row', sec);
    const pick = async (id) => {
      $$('[data-mood]', sec).forEach((b) => { const on = b.dataset.mood === id; b.classList.toggle('on', on); b.setAttribute('aria-pressed', String(on)); });
      try { sessionStorage.setItem('gf.mood', id); } catch {}
      out.innerHTML = '<div class="track"><div class="card"><div class="pic skel"></div></div><div class="card"><div class="pic skel"></div></div><div class="card"><div class="pic skel"></div></div></div>';
      try { const d = await ctx.api(`/api/mood/${id}`); out.innerHTML = d.items?.length ? ctx.rowHTML({ id: 'gf-mood-row', title: d.title, items: d.items }, 'mood') : '<p class="dim small">Nothing for this mood right now.</p>'; ctx.wireRows(out); }
      catch (e) { out.innerHTML = `<p class="dim small">${esc(e.message)}</p>`; }
    };
    $$('[data-mood]', sec).forEach((b) => (b.onclick = () => (b.classList.contains('on') ? (b.classList.remove('on'), b.setAttribute('aria-pressed', 'false'), (out.innerHTML = ''), sessionStorage.removeItem('gf.mood')) : pick(b.dataset.mood))));
    const last = sessionStorage.getItem('gf.mood'); if (last && moods.some((m) => m.id === last)) pick(last);
  }

  // ---- modal helper
  function modal(label, html, onMount) {
    const m = document.createElement('div'); m.className = 'authm open gfm'; m.setAttribute('role', 'dialog'); m.setAttribute('aria-modal', 'true'); m.setAttribute('aria-label', label);
    m.innerHTML = `<div class="bx"><button class="x" type="button" aria-label="Close">×</button>${html}</div>`;
    const close = () => m.remove();
    m.addEventListener('click', (e) => { if (e.target === m || e.target.closest('.x,[data-close]')) close(); });
    m.addEventListener('keydown', (e) => { if (e.key === 'Escape') { e.stopPropagation(); close(); } });
    (document.querySelector('.player') || document.body).appendChild(m); onMount?.(m, close); setTimeout(() => $('input,textarea,select,button:not(.x)', m)?.focus(), 30); return m;
  }

  // ---- Request a title
  function openRequest(prefill = '') {
    if (!feat('requests')) return ctx.toast('Requests are switched off right now.');
    let pick = null;
    modal('Request a title', `<h2>Request a title</h2><p>Can’t find something, or it won’t play? Tell us and we’ll look into it.</p>
      <div class="gff"><label>Title<input id="rqQ" type="search" maxlength="120" placeholder="Search for a film or series" value="${esc(prefill)}" autocomplete="off"></label><div class="rq-res" id="rqRes"></div>
      <label>Note <span class="dim">(optional)</span><textarea id="rqN" maxlength="1000" rows="3" placeholder="e.g. season 2 is missing, or the 4K version"></textarea></label></div>
      <button class="pb pg gfsend" type="button" id="rqGo">Send request</button><div class="er" id="rqEr"></div>`, (m, close) => {
      const q = $('#rqQ', m), res = $('#rqRes', m); let t;
      const search = async () => {
        const v = q.value.trim(); pick = null; if (v.length < 2) { res.innerHTML = ''; return; }
        try { const d = await ctx.api(`/api/search?q=${encodeURIComponent(v)}`); res.innerHTML = (d.results || []).filter((x) => x.media_type === 'movie' || x.media_type === 'tv').slice(0, 6).map((x, i) => `<button type="button" class="rq-opt" data-i="${i}">${x.poster ? `<img src="${esc(x.poster)}" alt="">` : '<span class="np"></span>'}<span><b>${esc(x.title)}</b><small>${x.media_type === 'tv' ? 'Series' : 'Film'}${x.year ? ` · ${x.year}` : ''}</small></span></button>`).join('') || '<p class="dim small">No matches — we’ll send what you typed.</p>';
          $$('.rq-opt', res).forEach((b) => (b.onclick = () => { const x = d.results.filter((y) => y.media_type === 'movie' || y.media_type === 'tv')[+b.dataset.i]; pick = x; $$('.rq-opt', res).forEach((o) => o.classList.toggle('on', o === b)); }));
        } catch {}
      };
      q.oninput = () => { clearTimeout(t); t = setTimeout(search, 350); }; if (prefill) search();
      $('#rqGo', m).onclick = async (e) => {
        const title = pick ? `${pick.title}${pick.year ? ` (${pick.year})` : ''}` : q.value.trim(); if (!title) { $('#rqEr', m).textContent = 'Type a title first.'; return; }
        e.target.disabled = true;
        try { await call('/api/inbox', { method: 'POST', body: { kind: 'request', title, body: $('#rqN', m).value, title_card: pick ? { id: pick.id, media_type: pick.media_type, title: pick.title, year: pick.year, poster: pick.poster } : null } }); close(); ctx.toast('Thanks! Your request was sent.'); }
        catch (err) { $('#rqEr', m).textContent = err.message; e.target.disabled = false; }
      };
    });
  }

  // ---- Bug report (optional screenshot of our own page only; embedded players are never captured)
  let h2c = null;
  const loadH2C = () => (h2c ||= new Promise((ok, no) => { if (window.html2canvas) return ok(window.html2canvas); const s = document.createElement('script'); s.src = '/vendor/html2canvas.min.js'; s.onload = () => ok(window.html2canvas); s.onerror = () => { h2c = null; no(new Error('Couldn’t load the screenshot tool')); }; document.head.appendChild(s); }));
  async function shot() {
    const H = await loadH2C();
    const canvas = await H(document.body, { backgroundColor: '#04050a', logging: false, useCORS: false, foreignObjectRendering: false, scale: Math.min(1, 1280 / innerWidth),
      x: scrollX, y: scrollY, width: innerWidth, height: innerHeight, windowWidth: innerWidth, windowHeight: innerHeight,
      ignoreElements: (el) => el.tagName === 'IFRAME' || el.tagName === 'VIDEO' || el.classList?.contains('gfm') || el.id === 'toast' });
    for (const q of [0.7, 0.5, 0.35]) { const u = canvas.toDataURL('image/jpeg', q); if (u.length <= 880000) return u; }
    return null;
  }
  function openBug(where = '') {
    if (!feat('bugs')) return ctx.toast('Bug reports are switched off right now.');
    const page = location.pathname + location.search;
    let pending = null;
    if (!document.querySelector('.player')) pending = shot().catch(() => null); // capture before the dialog covers the page
    else pending = shot().catch(() => null);
    modal('Report a bug', `<h2>Report a bug</h2><p>What went wrong? We’ll include the page you’re on${where ? ` (${esc(where)})` : ''}.</p>
      <div class="gff"><label>What happened?<textarea id="bgB" maxlength="2000" rows="4" placeholder="e.g. the Next episode button doesn’t appear"></textarea></label>
      <label class="chk"><input type="checkbox" id="bgS" checked> Include a screenshot of GhostFlix <span class="dim">(our page only — video players are left out)</span></label><div class="bg-prev" id="bgP"></div></div>
      <button class="pb pg gfsend" type="button" id="bgGo">Send report</button><div class="er" id="bgEr"></div>`, (m, close) => {
      const prev = $('#bgP', m); pending.then((u) => { if (u && m.isConnected) prev.innerHTML = `<img src="${u}" alt="Screenshot preview">`; else if (m.isConnected) prev.innerHTML = '<p class="dim small">Screenshot unavailable — the report will still send.</p>'; });
      $('#bgS', m).onchange = (e) => { prev.hidden = !e.target.checked; };
      $('#bgGo', m).onclick = async (e) => {
        const body = $('#bgB', m).value.trim(); if (body.length < 3) { $('#bgEr', m).textContent = 'Tell us a little about the problem.'; return; }
        e.target.disabled = true; e.target.textContent = 'Sending…';
        const screenshot = $('#bgS', m).checked ? await pending : null;
        try { await call('/api/inbox', { method: 'POST', body: { kind: 'bug', title: body.slice(0, 80), body, page, viewport: `${innerWidth}x${innerHeight}`, app: where || 'menu', screenshot } }); close(); ctx.toast('Thanks! Your bug report was sent.'); }
        catch (err) { $('#bgEr', m).textContent = err.message; e.target.disabled = false; e.target.textContent = 'Send report'; }
      };
    });
  }

  // ---- Watch-together chat (friends only; NOT Watch Parties)
  async function mountChat(host, card, opts = {}) {
    await authReady();
    if (!host || !feat('chat') || !feat('friends')) return;
    const base = `${card.media_type}:${card.id}`;
    const wrap = document.createElement('section'); wrap.className = 'sec gfchat'; host.appendChild(wrap);
    const head = (inner) => `<h2>Watch-together chat <small class="dim">friends only</small></h2>${inner}`;
    if (!signedIn()) { wrap.innerHTML = head('<p class="dim">Sign in and turn on <a href="/friends" data-link>Friends</a> to chat about this with your friends.</p>'); return; }
    let soc; try { soc = state.social || (state.social = await call('/api/me/social')); } catch (e) { wrap.innerHTML = head(`<p class="dim">${esc(e.message)}</p>`); return; }
    if (!soc.friends_on) { wrap.innerHTML = head('<p class="dim">Chat with friends while you watch. It’s off until you turn on <a href="/friends" data-link>Friends</a>.</p>'); return; }
    const eps = opts.episodes || [];
    wrap.innerHTML = head(`${eps.length ? `<div class="select chat-room"><select aria-label="Chat room"><option value="${base}">Whole ${card.media_type === 'tv' ? 'series' : 'film'}</option>${eps.map((x) => `<option value="${base}:${x.s}:${x.e}"${x.sel ? ' selected' : ''}>S${x.s} E${x.e}</option>`).join('')}</select></div>` : ''}
      <div class="chat-log" aria-live="polite"></div><form class="chat-f"><input maxlength="300" placeholder="Message your friends…" aria-label="Chat message" autocomplete="off"><button class="btn cta sm" type="submit">Send</button></form><p class="dim small">Only friends see your messages. Be kind — reports go to the GhostFlix team.</p>`);
    const log = $('.chat-log', wrap), form = $('.chat-f', wrap), inp = $('input', form), sel = $('select', wrap);
    let room = sel ? sel.value : base, me = null, chan = null, poll = null; const seen = new Set(), tags = {};
    const line = (m) => `<div class="cm${m.user_id === me ? ' me' : ''}" data-id="${m.id}"><b>${esc(m.user_id === me ? 'You' : m.name)}${tagHTML(m.tag || tags[m.user_id])}</b><span>${esc(m.body)}</span><time>${esc(ago(m.created_at))}</time>${m.user_id !== me ? `<button type="button" class="cm-r" data-report="${m.id}" title="Report this message" aria-label="Report message">⚑</button>` : ''}</div>`;
    const add = (m) => { if (seen.has(m.id)) return; seen.add(m.id); const empty = $('.chat-empty', log); empty?.remove(); log.insertAdjacentHTML('beforeend', line(m)); log.scrollTop = log.scrollHeight; };
    async function load() {
      try { const d = await call(`/api/chat/${room}`); me = d.me; Object.assign(tags, d.tags); seen.clear(); log.innerHTML = d.messages.length ? '' : '<p class="dim small chat-empty">No messages yet. Say hi 👋</p>'; d.messages.forEach(add); }
      catch (e) { log.innerHTML = `<p class="dim small">${esc(e.message)}</p>`; }
    }
    async function subscribe() {
      try { const c = await ctx.auth().client(); if (chan) c.removeChannel(chan);
        chan = c.channel(`gfchat-${room}-${Math.random().toString(36).slice(2, 7)}`).on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'ghostflix_chat', filter: `room=eq.${room}` }, (p) => { if (wrap.isConnected) add(p.new); }).subscribe();
      } catch {}
      clearInterval(poll); poll = setInterval(() => { if (!wrap.isConnected) { clearInterval(poll); ctx.auth().client().then((c) => chan && c.removeChannel(chan)).catch(() => {}); return; } if (document.visibilityState === 'visible') call(`/api/chat/${room}`).then((d) => d.messages.forEach(add)).catch(() => {}); }, 20e3);
    }
    if (sel) sel.onchange = () => { room = sel.value; load(); subscribe(); };
    form.onsubmit = async (e) => {
      e.preventDefault(); const body = inp.value.trim(); if (!body) return; inp.disabled = true;
      try { const m = await call(`/api/chat/${room}`, { method: 'POST', body: { body } }); add(m); inp.value = ''; } catch (err) { ctx.toast(err.message); }
      inp.disabled = false; inp.focus();
    };
    log.addEventListener('click', async (e) => {
      const b = e.target.closest('[data-report]'); if (!b) return;
      if (!confirm('Report this message to the GhostFlix team?')) return;
      try { await call('/api/inbox', { method: 'POST', body: { kind: 'chat', message_id: +b.dataset.report } }); b.disabled = true; b.textContent = '✓'; ctx.toast('Thanks — the message was reported.'); } catch (err) { ctx.toast(err.message); }
    });
    await load(); subscribe();
  }

  // ---- Friends page
  async function viewFriends() {
    await authReady();
    const main = ctx.main; document.title = 'Friends — GhostFlix';
    if (!feat('friends')) { main.innerHTML = '<div class="page"><div class="empty"><h2>Friends is switched off right now</h2></div></div>'; return; }
    const addCode = new URLSearchParams(location.search).get('add') || '';
    if (!signedIn()) { main.innerHTML = `<div class="page narrow"><h1>Friends</h1><p class="lead">Sign in to add friends, see what they’re watching (if they allow it) and chat while you watch.</p><button class="btn cta" type="button" id="frSign">Sign in</button></div>`; $('#frSign').onclick = () => ctx.auth()?.openModal?.(); return; }
    main.innerHTML = '<div class="page narrow"><h1>Friends</h1><div class="skel" style="height:160px;border-radius:16px"></div></div>';
    let d; try { d = await call('/api/friends'); } catch (e) { main.innerHTML = `<div class="page narrow"><h1>Friends</h1><p class="lead">${esc(e.message)}</p></div>`; return; }
    state.social = null;
    const link = `${location.origin}/friends?add=${d.code}`;
    const person = (f, act) => `<div class="fr"><span class="fr-av" style="--h:${(parseInt(f.id.slice(0, 6), 16) % 360)}">${esc((f.name || '?')[0])}</span><div class="fr-t"><b>${esc(f.name)}${tagHTML(f.tag)}</b>${f.watching ? `<a href="${esc(f.watching.href || '#')}" data-link class="fr-w">▶ Watching <b>${esc(f.watching.title)}</b>${f.watching.sub ? ` · ${esc(f.watching.sub)}` : ''} <small>${esc(ago(f.watching.at))}</small></a>` : '<small class="dim">Friend since ' + new Date(f.since).toLocaleDateString() + '</small>'}</div>${act}</div>`;
    main.innerHTML = `<div class="page narrow friends"><h1>Friends</h1><p class="lead">Add friends with a code or link. Totally optional — nobody can find you unless you share your code.</p>
      <div class="set-group pad"><label class="tg"><span><b>Friends</b><small>Let people add you with your code, and chat with friends on title pages</small></span><input type="checkbox" id="frOn" ${d.on ? 'checked' : ''}></label>
      <label class="tg" ${d.on ? '' : 'hidden'}><span><b>Share what I’m watching</b><small>Friends see the title you’re currently watching. Off by default.</small></span><input type="checkbox" id="frShare" ${d.share_watching ? 'checked' : ''}></label></div>
      ${d.on ? `<div class="set-group pad"><div class="fr-code"><div><small class="dim">Your friend code</small><b class="code">${esc(d.code)}</b></div><button class="btn dark sm" id="frCopy" type="button">Copy invite link</button></div>
        <form class="fr-add" id="frAdd"><input id="frCodeIn" maxlength="60" placeholder="Enter a friend’s code or link" value="${esc(addCode)}" aria-label="Friend code"><button class="btn cta sm" type="submit">Add friend</button></form></div>
      ${d.incoming.length ? `<h2 class="fr-h">Requests</h2><div class="set-group">${d.incoming.map((f) => person(f, `<span class="fr-act"><button class="btn cta sm" data-acc="${f.id}">Accept</button><button class="btn dark sm" data-dec="${f.id}">Decline</button></span>`)).join('')}</div>` : ''}
      <h2 class="fr-h">Your friends <small class="dim">${d.friends.length}</small></h2><div class="set-group">${d.friends.length ? d.friends.map((f) => person(f, `<button class="btn dark sm" data-rm="${f.id}" aria-label="Remove ${esc(f.name)}">Remove</button>`)).join('') : '<p class="dim pad">No friends yet — share your invite link.</p>'}</div>
      ${d.outgoing.length ? `<h2 class="fr-h">Sent</h2><div class="set-group">${d.outgoing.map((f) => person(f, `<button class="btn dark sm" data-rm="${f.id}">Cancel</button>`)).join('')}</div>` : ''}` : (addCode ? '<p class="lead">Turn on Friends above to accept this invite.</p>' : '')}</div>`;
    const re = () => viewFriends();
    $('#frOn').onchange = async (e) => { try { await call('/api/me/social', { method: 'PUT', body: { friends_on: e.target.checked } }); re(); } catch (err) { ctx.toast(err.message); e.target.checked = !e.target.checked; } };
    const sh = $('#frShare'); if (sh) sh.onchange = async (e) => { try { await call('/api/me/social', { method: 'PUT', body: { share_watching: e.target.checked } }); ctx.toast(e.target.checked ? 'Friends can now see what you’re watching' : 'Your viewing is private'); } catch (err) { ctx.toast(err.message); e.target.checked = !e.target.checked; } };
    const cp = $('#frCopy'); if (cp) cp.onclick = async () => { try { if (navigator.share && matchMedia('(pointer:coarse)').matches) await navigator.share({ title: 'Add me on GhostFlix', url: link }); else { await navigator.clipboard.writeText(link); ctx.toast('Invite link copied'); } } catch {} };
    const fa = $('#frAdd'); if (fa) fa.onsubmit = async (e) => { e.preventDefault(); try { const r = await call('/api/friends/add', { method: 'POST', body: { code: $('#frCodeIn').value } }); ctx.toast(r.status === 'accepted' ? `You and ${r.name} are now friends` : `Friend request sent to ${r.name}`); history.replaceState({}, '', '/friends'); re(); } catch (err) { ctx.toast(err.message); } };
    $$('[data-acc],[data-dec]').forEach((b) => (b.onclick = async () => { try { await call('/api/friends/respond', { method: 'POST', body: { id: b.dataset.acc || b.dataset.dec, accept: !!b.dataset.acc } }); re(); } catch (err) { ctx.toast(err.message); } }));
    $$('[data-rm]').forEach((b) => (b.onclick = async () => { if (!confirm('Remove this friend?')) return; try { await fetch(`/api/friends/${b.dataset.rm}`, { method: 'DELETE', headers: { Authorization: `Bearer ${await token()}` } }); re(); } catch {} }));
    if (addCode && d.on) fa?.requestSubmit?.();
    ctx.afterFriends?.(); // Stage G: follows + shared lists (flair.js)
  }

  // ---- Public profile (view) + settings
  async function viewPublic(slug) {
    const main = ctx.main;
    let p; try { p = await ctx.api(`/api/u/${slug}`); } catch (e) { main.innerHTML = '<div class="page narrow"><div class="empty"><img src="/img/logo.svg" alt=""><h2>This profile isn’t public</h2><p>The link may be old, or its owner turned it off.</p></div></div>'; return; }
    document.title = `${p.name} — GhostFlix`;
    ctx.remember([...(p.lists || []), ...(p.history || [])]);
    const gn = (p.genres || []).map((g) => ctx.genreName(g)).filter(Boolean);
    main.innerHTML = `<div class="page pubp"><div class="pubp-h" style="--pc:${esc(p.color)}"><span class="pubp-av">${p.avatar ? `<img src="${esc(p.avatar)}" alt="" referrerpolicy="no-referrer">` : esc((p.name || '?')[0])}</span><div><h1>${esc(p.name)}${tagHTML(p.tag)}</h1>${p.bio ? `<p class="lead">${esc(p.bio)}</p>` : ''}${gn.length ? `<div class="pubp-g">${gn.map((g) => `<span class="pill">${esc(g)}</span>`).join('')}</div>` : ''}</div></div>
      ${p.badges?.length ? `<h2 class="fr-h">Badges</h2>${badgesHTML(p.badges)}` : ''}
      ${p.lists?.length ? `<h2 class="fr-h">Their list</h2><div class="grid">${p.lists.map((c) => ctx.cardHTML(c)).join('')}</div>` : ''}
      ${p.show_history && p.history?.length ? `<h2 class="fr-h">Recently watched</h2><div class="grid">${p.history.map((c) => ctx.cardHTML(c)).join('')}</div>` : ''}
      <p class="dim small" style="margin-top:30px">Public GhostFlix profile · shared by its owner</p></div>`;
  }
  async function profileExtras(el) {
    if (!el) return;
    const a = achievements(); const st = a.streak;
    el.innerHTML = `${feat('achievements') ? `<div class="set-label">Badges & streaks</div><div class="set-group pad"><div class="ach-stats"><div><b>${st.cur}</b><small>day streak</small></div><div><b>${st.best}</b><small>best streak</small></div><div><b>${a.hours < 10 ? a.hours.toFixed(1) : Math.round(a.hours)}</b><small>hours watched*</small></div><div><b>${a.list.filter((b) => b.got).length}</b><small>badges</small></div></div>
      ${badgesHTML(a.list.filter((b) => b.got), 'Start watching to earn your first badge.')}<details class="ach-more"><summary>All badges</summary>${badgesHTML(a.list.filter((b) => !b.got))}</details><p class="set-note">*Estimated from title runtimes for this viewer profile${signedIn() ? ', synced to your account' : ' on this device'}.</p></div>` : ''}
      ${feat('publicProfiles') ? '<div class="set-label">Public profile link</div><div class="set-group pad" id="pubSet"><p class="dim small">Loading…</p></div>' : ''}`;
    const box = $('#pubSet', el); if (!box) return;
    await authReady();
    if (!signedIn()) { box.innerHTML = '<p class="set-note">Sign in to create a public profile link. It’s off by default.</p>'; return; }
    const pr = ctx.profiles.active(); let cur = {};
    try { cur = await call(`/api/me/public/${pr.id}`); } catch (e) { box.innerHTML = `<p class="set-note">${esc(e.message)}</p>`; return; }
    let fl = { show_stats: true, show_watching: false }; try { fl = (await call(`/api/me/flair/${pr.id}`)).flair || fl; } catch {} // Stage G privacy toggles
    const G = ctx.genres(); const all = [...new Map([...G.movie, ...G.tv].map((g) => [g.id, g])).values()];
    const picked = new Set(cur.genres || []); const m = ctx.auth().meta?.() || {};
    box.innerHTML = `<label class="tg"><span><b>Public profile for “${esc(pr.name)}”</b><small>Anyone with the link sees your avatar, name, bio, favourite genres, badges and the lists you choose. Never your history unless you tick it.</small></span><input type="checkbox" id="pbOn" ${cur.enabled ? 'checked' : ''}></label>
      <div class="gff pb-fields"><label>Display name<input id="pbName" maxlength="40" value="${esc(cur.name || pr.name || m.name || '')}"></label>
      <label>Bio<textarea id="pbBio" maxlength="300" rows="2" placeholder="A line about what you like to watch">${esc(cur.bio || '')}</textarea></label>
      <div><small class="dim">Favourite genres (up to 8)</small><div class="pb-g">${all.map((g) => `<button type="button" class="pill${picked.has(g.id) ? ' on' : ''}" data-g="${g.id}">${esc(g.name)}</button>`).join('')}</div></div>
      <div><small class="dim">Privacy — what this link shows</small></div>
      <label class="chk"><input type="checkbox" id="pbList" ${cur.lists?.length || !cur.slug ? 'checked' : ''}> Show My List</label>
      <label class="chk"><input type="checkbox" id="pbHist" ${cur.show_history ? 'checked' : ''}> Show recently watched <span class="dim">(off by default)</span></label>
      <label class="chk"><input type="checkbox" id="pbStats" ${fl.show_stats ? 'checked' : ''}> Show my rank, watch stats &amp; badges</label>
      <label class="chk"><input type="checkbox" id="pbWatch" ${fl.show_watching ? 'checked' : ''}> Show what I’m watching now <span class="dim">(off by default · also posts it to the ZenClipsDaily Discord · also needs Friends › Share what I’m watching)</span></label>
      <label class="chk"><input type="checkbox" id="pbAv" ${cur.avatar || !cur.slug ? 'checked' : ''}> Show my account avatar</label></div>
      <div class="pb-act"><button class="btn cta sm" id="pbSave" type="button">Save</button>${cur.enabled && cur.slug ? `<a class="btn dark sm" href="/u/${cur.slug}" data-link>View</a><button class="btn dark sm" id="pbCopy" type="button">Copy link</button>` : ''}</div>`;
    $$('[data-g]', box).forEach((b) => (b.onclick = () => { const id = +b.dataset.g; if (picked.has(id)) picked.delete(id); else if (picked.size < 8) picked.add(id); b.classList.toggle('on', picked.has(id)); }));
    $('#pbSave', box).onclick = async (e) => {
      e.target.disabled = true;
      try {
        const body = { enabled: $('#pbOn', box).checked, name: $('#pbName', box).value, bio: $('#pbBio', box).value, color: pr.color, genres: [...picked], avatar: $('#pbAv', box).checked ? m.av || null : null,
          lists: $('#pbList', box).checked ? ctx.list().slice(0, 60) : [], show_history: $('#pbHist', box).checked, history: $('#pbHist', box).checked ? ctx.history().slice(0, 30) : [], badges: feat('achievements') ? earned() : [] };
        const r = await call(`/api/me/public/${pr.id}`, { method: 'PUT', body }); await call(`/api/me/flair/${pr.id}`, { method: 'PUT', body: { show_stats: $('#pbStats', box).checked, show_watching: $('#pbWatch', box).checked } }).catch(() => {}); ctx.toast(r.enabled ? 'Public profile saved' : 'Public profile is off'); profileExtras(el);
      } catch (err) { ctx.toast(err.message); e.target.disabled = false; }
    };
    const cp = $('#pbCopy', box); if (cp) cp.onclick = async () => { try { await navigator.clipboard.writeText(`${location.origin}/u/${cur.slug}`); ctx.toast('Link copied'); } catch {} };
  }

  return { feat, refreshMe, applyFeatures, countdownHTML, onPlay, homeExtras, openRequest, openBug, mountChat, viewFriends, viewPublic, profileExtras, pullActivity, call, get state() { return state; } };
}
