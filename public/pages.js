// Discover, Live TV and Watch Parties pages.
import { embedSandbox } from './settings.js?v=20261022b';
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];

// ---- Discover ---------------------------------------------------------------------------
export async function viewDiscover(ctx) {
  const { main, api, rowHTML, wireRows, history } = ctx;
  main.innerHTML = `<div class="page disc"><h1>Discover</h1><p class="lead">What’s hot, what’s next, and picks for your mood.</p><div class="disc-rows"><div class="row"><div class="track">${'<div class="card"><div class="pic skel"></div></div>'.repeat(8)}</div></div></div></div>`;
  const d = await api('/api/discover');
  const last = history.all()[0];
  let because = null;
  if (last) { try { const t = await api(`/api/title/${last.media_type}/${last.id}`); if (t.recommendations?.length) because = { id: 'because', title: `Because you watched ${t.title}`, items: t.recommendations }; } catch {} }
  // Continue watching / resume positions
  const resume = { id: 'resume', title: 'Continue Watching', items: [] };
  try { const r = await api('/api/watch-position'); if (r && r.positions) { for (const [type, ids] of Object.entries(r.positions)) { for (const [id, pos] of Object.entries(ids)) { const title = history.all().find((c) => c.media_type === type && String(c.id) === id); if (title) { resume.items.push({ ...title, position: pos }); } } } } } catch {}
  const moodBar = `<div class="pills mood-pills" role="tablist">${d.moods.map((m, i) => `<button class="pill ${i === 0 ? 'on' : ''}" role="tab" data-mood="${i}">${esc(m.title)}</button>`).join('')}</div>`;
  $('.disc-rows', main).outerHTML = `<div class="disc-rows">
    ${rowHTML({ id: 'top10', title: 'Top 10 today', top10: true, items: d.top10 }, 'd0')}
    ${because ? rowHTML(because, 'd1') : ''}
    ${resume.items.length ? rowHTML(resume, 'dr') : ''}
    ${d.rows.map((r, i) => rowHTML(r, 'd' + (i + 2))).join('')}
    <section class="row"><div class="row-h"><h2>Pick a mood</h2></div><div style="padding:0 var(--pad)">${moodBar}</div><div id="moodShelf">${rowHTML({ ...d.moods[0], title: '' }, 'mood')}</div></section>
  </div>`;
  // the page has its own padding; rows bleed to the edges
  $$('.disc-rows', main).forEach((el) => (el.style.margin = '0 calc(-1 * var(--pad))'));
  $$('[data-mood]', main).forEach((b) => (b.onclick = () => {
    $$('[data-mood]', main).forEach((x) => x.classList.toggle('on', x === b));
    $('#moodShelf', main).innerHTML = rowHTML({ ...d.moods[+b.dataset.mood], title: '' }, 'mood'); wireRows($('#moodShelf', main));
  }));
  wireRows(main);
}

// ---- Live TV ----------------------------------------------------------------------------
export async function viewLive(ctx) {
  const { main, api } = ctx;
  main.innerHTML = `<div class="page live"><h1>Live TV</h1><p class="lead">Free channels from broadcasters’ official live streams.</p><div class="live-top skel" style="aspect-ratio:16/9;border-radius:18px"></div></div>`;
  const { channels } = await api('/api/live');
  const cats = ['All', ...new Set(channels.map((c) => c.category))];
  const now = new Date(); const start = new Date(now); start.setMinutes(now.getMinutes() < 30 ? 0 : 30, 0, 0);
  const slots = Array.from({ length: 6 }, (_, i) => new Date(start.getTime() + i * 30 * 60e3));
  const fmt = (d) => d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  const nowPct = ((now - start) / (3 * 3600e3)) * 100;
  let cat = 'All', sel = channels[0];
  const initials = (n) => esc(n.split(/\s+/).map((w) => w[0]).slice(0, 2).join(''));
  const draw = () => {
    const list = channels.filter((c) => cat === 'All' || c.category === cat);
    main.innerHTML = `<div class="page live"><h1>Live TV</h1><p class="lead">Free channels from broadcasters’ official live streams.</p>
      <div class="live-top"><div class="live-player" id="livePlayer"></div>
        <div class="live-info"><span class="live-badge"><i></i>LIVE</span><h2>${esc(sel?.name || '')}</h2><p>${esc(sel?.category || '')} · official stream</p>
        ${sel ? `<a class="btn dark sm" href="${esc(sel.official)}" target="_blank" rel="noopener">Open official source</a>` : ''}</div></div>
      <div class="pills" style="margin-top:22px">${cats.map((c) => `<button class="pill ${c === cat ? 'on' : ''}" data-cat="${esc(c)}">${esc(c)}</button>`).join('')}</div>
      <div class="guide" role="grid" aria-label="Channel guide">
        <div class="g-head"><div class="g-ch">Channels</div><div class="g-times">${slots.map((t) => `<span>${fmt(t)}</span>`).join('')}<i class="g-now" style="left:${nowPct}%"></i></div></div>
        ${list.map((c) => `<button class="g-row ${c === sel ? 'on' : ''}" data-ch="${esc(c.id)}" role="row"><div class="g-ch"><span class="g-logo">${c.logo ? `<img src="${esc(c.logo)}" alt="">` : initials(c.name)}</span><span><b>${esc(c.name)}</b><small>${esc(c.category)}</small></span></div>
          <div class="g-prog"><div class="g-block"><b>${esc(c.name)} — Live</b><small>Now streaming · ${fmt(now)}</small></div><i class="g-now" style="left:${nowPct}%"></i></div></button>`).join('')}
      </div><p class="set-note">Channels are each broadcaster’s official YouTube live stream; availability can vary by region and time.</p></div>`;
    mount();
    $$('[data-cat]', main).forEach((b) => (b.onclick = () => { cat = b.dataset.cat; draw(); }));
    $$('[data-ch]', main).forEach((b) => (b.onclick = () => { sel = channels.find((c) => c.id === b.dataset.ch); draw(); window.scrollTo({ top: 0, behavior: 'smooth' }); }));
  };
  const mount = () => {
      const el = $('#livePlayer', main); if (!sel || !el) return;
      el.innerHTML = '';
      const p = sel.player;
      if (p.kind === 'hls' || (p.src && p.src.endsWith('.m3u8'))) {
        const v = document.createElement('video'); v.controls = true; v.playsInline = true;
        el.appendChild(v);
        if (v.canPlayType('application/vnd.apple.mpegurl')) {
          v.src = p.src;
        } else {
          loadHLS(v, p.src);
        }
      } else {
        const f = document.createElement('iframe'); f.src = p.src; f.allow = 'autoplay; fullscreen; picture-in-picture; encrypted-media'; f.allowFullscreen = true; f.title = sel.name;
        f.referrerPolicy = 'unsafe-url'; const sb = embedSandbox(p.src, p.sandbox); if (sb) f.setAttribute('sandbox', sb);
        el.appendChild(f);
      }
    };

  function loadHLS(video, src) {
    if (!window.Hls) {
      const s = document.createElement('script'); s.src = '/vendor/hls.min.js'; s.onload = () => initHLS(video, src); document.head.appendChild(s);
    } else initHLS(video, src);
  }
  function initHLS(video, src) {
    if (!window.Hls.isSupported()) return;
    const h = new window.Hls(); h.loadSource(src); h.attachMedia(video);
    h.on(window.Hls.Events.ERROR, (e, d) => { if (d.fatal) h.destroy(); });
  }
  draw();
}

// ---- Watch Parties -----------------------------------------------------------------------
const EMOJI = ['😂', '😱', '🔥', '👻', '❤️', '👏'];
const rid = () => Math.random().toString(36).slice(2, 8);
let party = null; // active room state
export function leaveParty() { document.body.classList.remove('in-party'); if (party) { try { party.chan?.unsubscribe(); } catch {} window.removeEventListener('message', party.onMsg); clearInterval(party.tick); party = null; } }

export async function viewPartyHome(ctx) {
  const { main, api, history, list, go } = ctx;
  leaveParty();
  const picks = [...history.all(), ...list.all()].filter((c, i, a) => a.findIndex((x) => x.media_type === c.media_type && x.id === c.id) === i).slice(0, 8);
  main.innerHTML = `<div class="page party-home"><h1>Watch Parties</h1><p class="lead">Watch together in sync — play, pause and seek for everyone, with chat and reactions.</p>
    ${ctx.config.auth ? '' : '<div class="notice" style="margin:0 0 18px;position:static">Realtime isn’t configured on this server (SUPABASE_PUBLIC_URL / SUPABASE_ANON_KEY), so parties run in solo mode.</div>'}
    <div class="ph-grid"><div class="ph-card"><h2>Start a party</h2><p>Pick something to watch:</p>
      <form id="phSearch" class="search" style="width:100%;margin:10px 0 14px"><svg viewBox="0 0 24 24"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/></svg><input name="q" placeholder="Search a title" autocomplete="off"></form>
      <div class="ph-picks" id="phPicks">${picks.map(pick).join('') || '<p class="dim">Search for a title above.</p>'}</div></div>
    <div class="ph-card"><h2>Join a party</h2><p>Got a code or link from a friend?</p><form id="phJoin" class="ph-join"><input name="code" placeholder="Party code, e.g. k3x9qa" maxlength="80" autocomplete="off"><button class="btn cta sm">Join</button></form>
      <ul class="ph-how"><li>Share the link — anyone with it can join.</li><li>Sync works for GhostFlix’s own player (MP4/HLS) and YouTube.</li><li>Other embeds: use the 3-2-1 countdown.</li></ul></div></div></div>`;
  function pick(c) { return `<button class="ph-pick" data-t="${c.media_type}:${c.id}"><img src="${esc(c.poster || '')}" alt="" loading="lazy"><span>${esc(c.title)}</span></button>`; }
  const wire = () => $$('[data-t]', main).forEach((b) => (b.onclick = () => go(`/party/${rid()}?t=${b.dataset.t}`)));
  wire();
  let st; $('#phSearch input', main).oninput = (e) => { clearTimeout(st); const q = e.target.value.trim(); if (q.length < 2) return; st = setTimeout(async () => { const d = await api(`/api/search?q=${encodeURIComponent(q)}`); $('#phPicks', main).innerHTML = d.results.slice(0, 12).map(pick).join('') || '<p class="dim">No matches.</p>'; wire(); }, 300); };
  $('#phSearch', main).onsubmit = (e) => e.preventDefault();
  $('#phJoin', main).onsubmit = (e) => { e.preventDefault(); const v = e.target.code.value.trim(); const m = v.match(/party\/([a-z0-9]{4,12})(\?t=[a-z]+:\d+)?/i); if (m) go(`/party/${m[1]}${m[2] || ''}`); else if (/^[a-z0-9]{4,12}$/i.test(v)) go(`/party/${v.toLowerCase()}`); };
}

export async function viewParty(ctx, room) {
  const { main, api, auth, toast } = ctx;
  leaveParty();
  document.body.classList.add('in-party');
  const t = new URLSearchParams(location.search).get('t');
  const me = { id: rid() + rid(), name: auth?.user ? auth.meta().name : `Ghost-${Math.floor(1000 + Math.random() * 9000)}` };
  party = { room, me, applying: 0, chan: null, onMsg: null, tick: null, yt: { state: -1, time: 0 }, title: t };
  const link = `${location.origin}/party/${room}${t ? `?t=${t}` : ''}`;
  main.innerHTML = `<div class="page party"><div class="party-grid">
    <div><div class="party-stage" id="pStage"><div class="empty"><img src="/img/logo.svg" alt=""><h2>${t ? 'Loading…' : 'Waiting for the host'}</h2><p>${t ? '' : 'The host’s pick will appear here.'}</p></div><div class="reacts" id="pReacts"></div></div>
      <div class="party-bar"><div><b id="pTitle">Watch party</b><small id="pSync">Room ${esc(room)}</small></div>
        <div class="emo">${EMOJI.map((e) => `<button type="button" data-emo="${e}" aria-label="React ${e}">${e}</button>`).join('')}</div>
        <button class="btn dark sm" id="pCount" type="button">3-2-1</button><button class="btn cta sm" id="pCopy" type="button">Copy invite</button></div></div>
    <aside class="chat"><div class="chat-h"><b>Chat</b><span id="pPeople">1 watching</span></div><div class="chat-log" id="pLog"><p class="sys">You joined as <b>${esc(me.name)}</b>. Share the invite link to watch together.</p></div>
      <form class="chat-f" id="pForm"><input name="m" placeholder="Say something…" maxlength="300" autocomplete="off"><button class="btn cta sm" aria-label="Send">➤</button></form></aside></div></div>`;
  const log = (html, cls = '') => { const el = $('#pLog', main); if (!el) return; el.insertAdjacentHTML('beforeend', `<p class="${cls}">${html}</p>`); el.scrollTop = el.scrollHeight; };
  const float = (e) => { const r = $('#pReacts', main); if (!r) return; const s = document.createElement('span'); s.textContent = e; s.style.left = 10 + Math.random() * 80 + '%'; r.appendChild(s); setTimeout(() => s.remove(), 2600); };
  $('#pCopy', main).onclick = async () => { try { await navigator.clipboard.writeText(link); toast('Invite link copied'); } catch { prompt('Copy this link', link); } };

  // ---- player ----
  let ctl = null; // { play(), pause(), seek(t), time(), playing() }
  async function loadTitle(key) {
    const [type, id] = key.split(':');
    const d = await api(`/api/play/${type}/${id}`);
    $('#pTitle', main).textContent = d.title + (d.sources.length ? '' : ' · trailer');
    const src = d.sources[0] || (d.trailer ? { kind: 'iframe', src: d.trailer.src, provider: 'youtube' } : null);
    const stage = $('#pStage', main); stage.querySelectorAll('video,iframe,.empty').forEach((n) => n.remove());
    if (!src) { stage.insertAdjacentHTML('afterbegin', '<div class="empty"><h2>Nothing to play yet</h2></div>'); return; }
    if (src.kind === 'video' || src.kind === 'hls') {
      const v = document.createElement('video'); v.controls = true; v.playsInline = true; v.src = src.kind === 'video' ? src.src : ''; stage.prepend(v);
      if (src.kind === 'hls' && !v.canPlayType('application/vnd.apple.mpegurl')) { await new Promise((r) => { const s = document.createElement('script'); s.src = '/vendor/hls.min.js'; s.onload = r; document.head.appendChild(s); }); const h = new window.Hls(); h.loadSource(src.src); h.attachMedia(v); } else if (src.kind === 'hls') v.src = src.src;
      ctl = { play: () => v.play().catch(() => {}), pause: () => v.pause(), seek: (x) => (v.currentTime = x), time: () => v.currentTime, playing: () => !v.paused };
      ['play', 'pause', 'seeked'].forEach((ev) => v.addEventListener(ev, () => local(ev === 'seeked' ? 'seek' : ev)));
      setSync('Synced player');
    } else {
      const isYT = /youtube(-nocookie)?\.com\/embed\/[\w-]{11}/.test(src.src);
      const f = document.createElement('iframe'); f.allow = 'autoplay; fullscreen; encrypted-media; picture-in-picture'; f.allowFullscreen = true;
      f.referrerPolicy = 'unsafe-url';
      f.src = isYT ? src.src.replace('autoplay=1', 'autoplay=0') + `&enablejsapi=1&origin=${encodeURIComponent(location.origin)}` : src.src.replace(/([?&])autoplay=(1|true)/, '$1autoplay=0');
      { const sb = embedSandbox(f.src, src.sandbox); if (sb) f.setAttribute('sandbox', sb); }
      stage.prepend(f);
      if (isYT) {
        const cmd = (func, args = []) => f.contentWindow?.postMessage(JSON.stringify({ event: 'command', func, args }), '*');
        f.addEventListener('load', () => { f.contentWindow.postMessage(JSON.stringify({ event: 'listening', id: 'gf' }), '*'); });
        let lastT = 0, lastAt = Date.now();
        party.onMsg = (e) => {
          if (e.source !== f.contentWindow) return; let m; try { m = JSON.parse(e.data); } catch { return; }
          const info = m.info || {}; if (m.event !== 'infoDelivery' && m.event !== 'onStateChange') return;
          if (typeof info.currentTime === 'number') {
            const expected = lastT + (party.yt.state === 1 ? (Date.now() - lastAt) / 1000 : 0);
            if (Math.abs(info.currentTime - expected) > 2.5 && party.yt.state !== -1) { party.yt.time = info.currentTime; local('seek'); }
            lastT = info.currentTime; lastAt = Date.now(); party.yt.time = info.currentTime;
          }
          const st = typeof info.playerState === 'number' ? info.playerState : m.event === 'onStateChange' ? m.info : undefined;
          if (typeof st === 'number' && st !== party.yt.state) { const prev = party.yt.state; party.yt.state = st; if (st === 1 && prev !== 1) local('play'); if (st === 2) local('pause'); }
        };
        window.addEventListener('message', party.onMsg);
        ctl = { play: () => cmd('playVideo'), pause: () => cmd('pauseVideo'), seek: (x) => cmd('seekTo', [x, true]), time: () => party.yt.time, playing: () => party.yt.state === 1 };
        setSync('Synced YouTube player');
      } else { ctl = null; setSync('This source can’t be synced — use 3-2-1'); }
    }
  }
  const setSync = (txt) => { const el = $('#pSync', main); if (el) el.textContent = `Room ${room} · ${txt}`; };

  // ---- realtime ----
  const send = (event, payload) => party?.chan?.send({ type: 'broadcast', event, payload: { ...payload, from: me.id, name: me.name } });
  function local(action) {
    if (!ctl || Date.now() < party.applying) return;
    send('ctl', { action, t: ctl.time() });
  }
  function remote({ action, t, name }) {
    if (!ctl) return; party.applying = Date.now() + 1200;
    if (action === 'seek' || Math.abs(ctl.time() - t) > 2) ctl.seek(t);
    if (action === 'play') ctl.play(); if (action === 'pause') ctl.pause();
    log(`<b>${esc(name)}</b> ${action === 'seek' ? 'jumped to' : action === 'play' ? 'pressed play at' : 'paused at'} ${fmtT(t)}`, 'sys');
  }
  const fmtT = (s) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;

  $('#pForm', main).onsubmit = (e) => { e.preventDefault(); const v = e.target.m.value.trim(); if (!v) return; e.target.m.value = ''; log(`<b>${esc(me.name)}</b> ${esc(v)}`, 'me'); send('chat', { text: v.slice(0, 300) }); };
  $$('[data-emo]', main).forEach((b) => (b.onclick = () => { float(b.dataset.emo); send('react', { emoji: b.dataset.emo }); }));
  $('#pCount', main).onclick = () => { send('count', {}); countdown(); };
  const countdown = () => { let n = 3; const r = $('#pReacts', main); const el = document.createElement('div'); el.className = 'count'; r.appendChild(el); const step = () => { el.textContent = n || 'Play!'; if (n-- < 0) return el.remove(); setTimeout(step, 900); }; step(); };

  if (t) loadTitle(t).catch((e) => toast(e.message));
  if (!ctx.config.auth) { log('Realtime is not configured on this server — you’re watching solo.', 'sys'); return; }
  try {
    const sb = await auth.client();
    const chan = sb.channel(`ghostflix-party-${room}`, { config: { broadcast: { self: false }, presence: { key: me.id } } });
    party.chan = chan;
    chan.on('broadcast', { event: 'ctl' }, ({ payload }) => remote(payload))
      .on('broadcast', { event: 'chat' }, ({ payload }) => log(`<b>${esc(payload.name)}</b> ${esc(payload.text)}`))
      .on('broadcast', { event: 'react' }, ({ payload }) => float(payload.emoji))
      .on('broadcast', { event: 'count' }, () => countdown())
      .on('broadcast', { event: 'hello' }, ({ payload }) => { if (party.title) send('state', { t: party.title, time: ctl?.time() || 0, playing: ctl?.playing() || false, to: payload.from }); })
      .on('broadcast', { event: 'state' }, async ({ payload }) => {
        if (payload.to !== me.id) return;
        if (!party.title && payload.t) { party.title = payload.t; history.replaceState(history.state, '', `/party/${room}?t=${payload.t}`); await loadTitle(payload.t); }
        if (ctl) setTimeout(() => remote({ action: payload.playing ? 'play' : 'pause', t: payload.time, name: 'Host' }), 1500);
      })
      .on('presence', { event: 'sync' }, () => { const n = Object.keys(chan.presenceState()).length; const el = $('#pPeople', main); if (el) el.textContent = `${n} watching`; })
      .on('presence', { event: 'join' }, ({ newPresences }) => newPresences.forEach((p) => p.key !== me.id && log(`<b>${esc(p.name || 'Someone')}</b> joined`, 'sys')))
      .subscribe(async (status) => { if (status === 'SUBSCRIBED') { await chan.track({ name: me.name }); send('hello', {}); } });
  } catch (e) { log('Couldn’t connect to the party server — watching solo.', 'sys'); }
}
