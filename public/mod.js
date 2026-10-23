// GhostFlix moderator panel (/mod). Uses the visitor's own Supabase session; every /api/mod/* call is checked
// server-side (role row read under RLS as the user) — this page only decides what to show.
const $ = (s, r = document) => r.querySelector(s), $$ = (s, r = document) => [...r.querySelectorAll(s)];
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
let toastT; const toast = (m) => { const t = $('#toast'); t.textContent = m; t.classList.add('on'); clearTimeout(toastT); toastT = setTimeout(() => t.classList.remove('on'), 2600); };
const ago = (x) => { if (!x) return 'never'; const s = Math.max(0, (Date.now() - new Date(x)) / 1000); return s < 60 ? 'just now' : s < 3600 ? `${Math.round(s / 60)}m ago` : s < 86400 ? `${Math.round(s / 3600)}h ago` : `${Math.round(s / 86400)}d ago`; };
const when = (x) => (x ? new Date(x).toLocaleString(undefined, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : '—');
const STATUS = { open: 'Open', in_progress: 'In progress', done: 'Done', wontfix: 'Won’t fix' };
const KIND = { request: '🎬 Request', bug: '🐞 Bug', chat: '💬 Chat report', flag_title: '⚑ Title', flag_kids: '🧒 Kids safety', flag_user: '👤 User', flag_chat: '💬 Chat', flag_comment: '🗨️ Comment', announce: '📣 Suggestion' };

let SB = null;
async function client() {
  if (SB) return SB;
  const cfg = await (await fetch('/api/config')).json(); if (!cfg.auth?.url) throw new Error('Accounts are switched off.');
  if (!window.supabase) await new Promise((res, rej) => { const s = document.createElement('script'); s.src = '/vendor/supabase.js'; s.onload = res; s.onerror = rej; document.head.appendChild(s); });
  SB = window.supabase.createClient(cfg.auth.url, cfg.auth.key, { auth: { flowType: 'pkce', persistSession: true, autoRefreshToken: true, detectSessionInUrl: false, storageKey: 'ghostflix-auth' } });
  return SB;
}
async function token() { try { return (await (await client()).auth.getSession()).data.session?.access_token || null; } catch { return null; } }
async function api(path, { method = 'GET', body } = {}) {
  const t = await token();
  const r = await fetch(path, { method, cache: 'no-store', headers: { ...(body ? { 'Content-Type': 'application/json' } : {}), ...(t ? { Authorization: `Bearer ${t}` } : {}) }, body: body ? JSON.stringify(body) : undefined });
  const j = await r.json().catch(() => ({})); if (!r.ok) throw Object.assign(new Error(j.error || `Error ${r.status}`), { status: r.status }); return j;
}
function confirmBox(title, body, ok = 'Confirm', withReason = false) {
  return new Promise((done) => {
    const d = document.createElement('dialog'); d.className = 'cdlg';
    d.innerHTML = `<form method="dialog"><h3>${esc(title)}</h3><p class="dim">${esc(body)}</p>${withReason ? '<input name="r" maxlength="500" placeholder="Reason for the admin">' : ''}<div class="btns"><button value="no" class="btn ghost sm">Cancel</button><button value="yes" class="btn glow sm">${esc(ok)}</button></div></form>`;
    document.body.appendChild(d); d.addEventListener('close', () => { const v = d.returnValue === 'yes'; const r = d.querySelector('[name=r]')?.value || ''; d.remove(); done(v ? { reason: r } : null); }); d.showModal();
  });
}

// ---- tabs (sticky pills, remembers the last one)
const TABS = ['inbox', 'sources', 'flags', 'users', 'suggest', 'log'];
function showTab(t) {
  if (!TABS.includes(t)) t = 'inbox';
  $$('#tabs a').forEach((a) => { const on = a.dataset.tab === t; a.classList.toggle('on', on); a.setAttribute('aria-selected', String(on)); if (on) a.scrollIntoView({ inline: 'center', block: 'nearest' }); });
  $$('[data-pane]').forEach((p) => (p.hidden = p.dataset.pane !== t));
  try { localStorage.setItem('gf.modTab', t); } catch {}
  ({ inbox: loadInbox, sources: loadSrc, flags: loadFlags, users: () => loadUsers($('#uQ').value.trim()), suggest: sgType, log: loadLog })[t]();
}

// ---- inbox
let IBK = '';
const notesHTML = (n) => (Array.isArray(n) && n.length ? `<ul class="notes">${n.map((x) => `<li><b>${esc(x.by)}</b> ${esc(x.text)} <span class="dim small">${ago(x.at)}</span></li>`).join('')}</ul>` : '');
function itemHTML(r, { flag = true, edit = true } = {}) {
  const d = r.data || {}; const tl = d.key ? `/title/${d.key.replace(':', '/')}` : d.card ? `/title/${d.card.media_type}/${d.card.id}` : null;
  const extra = [d.page && `Page <code>${esc(d.page)}</code>`, d.viewport && esc(d.viewport), d.room && `Room <code>${esc(d.room)}</code>`, d.message && `“${esc(d.message)}”`, d.author && `by ${esc(d.author)}`, d.type && esc(d.type)].filter(Boolean).join(' · ');
  return `<div class="ib" data-id="${r.id}"><div class="ibh"><span class="pv">${KIND[r.kind] || esc(r.kind)}</span><b>${tl ? `<a href="${tl}" target="_blank" rel="noopener">${esc(r.title || '')}</a>` : esc(r.title || '')}</b><span class="st st-${esc(r.status)}">${STATUS[r.status] || esc(r.status)}</span><time class="dim small">${ago(r.created_at)}</time></div>
    ${r.body ? `<p class="ibb">${esc(r.body)}</p>` : ''}${extra ? `<p class="dim small">${extra}</p>` : ''}${r.kind === 'bug' ? `<details class="shot" data-shot="${r.id}"><summary>Screenshot (if attached)</summary></details>` : ''}${notesHTML(r.notes)}
    ${edit ? `<div class="iba"><div class="select sm"><select data-st aria-label="Status">${Object.entries(STATUS).map(([k, v]) => `<option value="${k}"${k === r.status ? ' selected' : ''}>${v}</option>`).join('')}</select></div><input data-note maxlength="500" placeholder="Add a note…"><button type="button" data-save>Save</button>${flag && r.kind === 'chat' && +d.message_id > 0 ? `<button type="button" class="danger" data-flagchat="${+d.message_id}">Flag for admin</button>` : ''}</div>` : ''}</div>`;
}
function wireItems(el, reload) {
  $$('details[data-shot]', el).forEach((dt) => dt.addEventListener('toggle', async () => {
    if (!dt.open || dt.dataset.done) return; dt.dataset.done = 1;
    try { const j = await api(`/api/mod/inbox/${dt.dataset.shot}/shot`); const i = new Image(); i.alt = 'Bug report screenshot'; i.src = j.src; dt.appendChild(i); } catch { dt.insertAdjacentHTML('beforeend', '<p class="dim small">No screenshot attached.</p>'); }
  }));
  $$('.ib', el).forEach((it) => {
    const id = it.dataset.id, q = (s) => it.querySelector(s); if (!q('[data-save]')) return;
    q('[data-save]').onclick = async () => { try { await api(`/api/mod/inbox/${id}`, { method: 'PATCH', body: { status: q('[data-st]').value, note: q('[data-note]').value } }); toast('Saved'); reload(); } catch (e) { toast(e.message); } };
    const fc = q('[data-flagchat]'); if (fc) fc.onclick = async () => { const c = await confirmBox('Flag this chat message?', 'The admin can hide it for everyone.', 'Flag', true); if (!c) return; try { await api('/api/mod/flag', { method: 'POST', body: { kind: 'flag_chat', message_id: +fc.dataset.flagchat, inbox_id: +id, title: `Chat message (report #${id})`, body: c.reason || it.querySelector('.ibb')?.textContent || '' } }); await api(`/api/mod/inbox/${id}`, { method: 'PATCH', body: { status: 'in_progress', note: 'Flagged for admin' } }); toast('Flagged for the admin'); reload(); } catch (e) { toast(e.message); } };
  });
}
async function loadInbox() {
  try {
    const d = await api(`/api/mod/inbox?kind=${IBK}&status=${$('#ibStatus').value}`);
    $('#ibList').innerHTML = d.items.length ? d.items.map((r) => itemHTML(r)).join('') : '<p class="dim">Nothing here 🎉</p>'; wireItems($('#ibList'), loadInbox);
    if (!IBK && !$('#ibStatus').value) { const n = d.items.filter((x) => x.status === 'open').length; $('#ibCnt').hidden = !n; $('#ibCnt').textContent = n; }
  } catch (e) { $('#ibList').innerHTML = `<p class="err">${esc(e.message)}</p>`; }
}
$('#ibKind').addEventListener('click', (e) => { const b = e.target.closest('[data-k]'); if (!b) return; IBK = b.dataset.k; $$('#ibKind button').forEach((x) => x.classList.toggle('on', x === b)); loadInbox(); });
$('#ibStatus').onchange = loadInbox;

// ---- broken sources
async function loadSrc() {
  try {
    const st = $('#srcStatus').value; const d = await api(`/api/mod/reports?status=${st}`);
    $('#srcList').innerHTML = d.items.length ? d.items.map((r) => { const ep = r.season != null ? ` S${r.season}E${r.episode}` : ''; const href = `/title/${r.media_type}/${r.tmdb_id}`; return `<div class="ib" data-id="${r.id}"><div class="ibh"><span class="pv">${esc(r.source)}</span><b><a href="${href}" target="_blank" rel="noopener">${r.media_type === 'tv' ? 'Series' : 'Movie'} ${r.tmdb_id}${ep}</a></b><span class="st st-${esc(r.status || 'open')}">${STATUS[r.status || 'open']}</span><time class="dim small">${ago(r.created_at)}</time></div>${r.reason ? `<p class="ibb">${esc(r.reason)}</p>` : ''}${r.device ? `<p class="dim small">${esc(r.device)}</p>` : ''}${notesHTML(r.notes)}<div class="iba">${r.status !== 'done' ? '<button type="button" class="ok" data-works>✅ Tested, works now</button>' : ''}<div class="select sm"><select data-st aria-label="Status">${Object.entries(STATUS).map(([k, v]) => `<option value="${k}"${k === (r.status || 'open') ? ' selected' : ''}>${v}</option>`).join('')}</select></div><input data-note maxlength="500" placeholder="Add a note…"><button type="button" data-save>Save</button></div></div>`; }).join('') : '<p class="dim">No reports with this status 🎉</p>';
    $$('#srcList .ib').forEach((it) => {
      const id = it.dataset.id, q = (s) => it.querySelector(s);
      const w = q('[data-works]'); if (w) w.onclick = async () => { try { await api(`/api/mod/reports/${id}`, { method: 'POST', body: { works: true } }); toast('Marked as working'); loadSrc(); } catch (e) { toast(e.message); } };
      q('[data-save]').onclick = async () => { try { await api(`/api/mod/reports/${id}`, { method: 'POST', body: { status: q('[data-st]').value, note: q('[data-note]').value } }); toast('Saved'); loadSrc(); } catch (e) { toast(e.message); } };
    });
    if (st === 'open') { const n = d.items.length; $('#srcCnt').hidden = !n; $('#srcCnt').textContent = n; }
  } catch (e) { $('#srcList').innerHTML = `<p class="err">${esc(e.message)}</p>`; }
}
$('#srcStatus').onchange = loadSrc;

// ---- flags
let PICK = null, ftT;
$('#ftQ').oninput = (e) => {
  clearTimeout(ftT); const q = e.target.value.trim(); if (q.length < 2) { $('#ftRes').innerHTML = ''; return; }
  ftT = setTimeout(async () => {
    try { const d = await api(`/api/mod/title?q=${encodeURIComponent(q)}`); const rs = (d.results || []).filter((c) => c.media_type === 'movie' || c.media_type === 'tv').slice(0, 8);
      $('#ftRes').innerHTML = rs.map((c, i) => `<button type="button" class="res" data-i="${i}"><img src="${esc(c.poster || '')}" alt=""><div><b>${esc(c.title)}</b><span>${c.media_type === 'tv' ? 'Series' : 'Movie'}${c.year ? ' · ' + esc(c.year) : ''}</span></div></button>`).join('') || '<div class="res dim">No matches</div>';
      $$('#ftRes [data-i]').forEach((b) => (b.onclick = () => { PICK = rs[+b.dataset.i]; $('#ftRes').innerHTML = ''; $('#ftQ').value = ''; $('#ftPicked').innerHTML = `<img src="${esc(PICK.poster || '')}" alt=""><div><b>${esc(PICK.title)}</b><span>${PICK.media_type === 'tv' ? 'Series' : 'Movie'}${PICK.year ? ' · ' + esc(PICK.year) : ''}</span></div>`; }));
    } catch (err) { $('#ftRes').innerHTML = `<div class="res err">${esc(err.message)}</div>`; }
  }, 300);
};
$('#ftGo').onclick = async () => {
  $('#ftErr').textContent = ''; if (!PICK) return ($('#ftErr').textContent = 'Pick a title first.');
  try { await api('/api/mod/flag', { method: 'POST', body: { kind: $('#ftKind').value, key: `${PICK.media_type}:${PICK.id}`, title: PICK.title, body: $('#ftWhy').value } }); toast('Flag sent to the admin'); PICK = null; $('#ftPicked').innerHTML = '<span class="dim small">No title picked.</span>'; $('#ftWhy').value = ''; loadFlags(); }
  catch (e) { $('#ftErr').textContent = e.message; }
};
$('#fcGo').onclick = async () => {
  $('#fcErr').textContent = ''; const t = $('#fcText').value.trim(); if (!t) return ($('#fcErr').textContent = 'Paste the message and why it should go.');
  const kind = $('#fcKind').value; const where = $('#fcWhere').value.trim();
  try { await api('/api/mod/flag', { method: 'POST', body: { kind, title: `${kind === 'flag_chat' ? 'Chat message' : 'Comment'}${where ? ` · ${where}` : ''}`, body: t } }); toast('Flag sent to the admin'); $('#fcText').value = ''; $('#fcWhere').value = ''; loadFlags(); }
  catch (e) { $('#fcErr').textContent = e.message; }
};
async function loadFlags() {
  try { const d = await api('/api/mod/inbox?kind=flags'); $('#flagList').innerHTML = d.items.length ? d.items.map((r) => itemHTML(r, { edit: false })).join('') : '<p class="dim">No flags or suggestions yet.</p>'; }
  catch (e) { $('#flagList').innerHTML = `<p class="err">${esc(e.message)}</p>`; }
}

// ---- users: name + last seen only
let uT; $('#uQ').oninput = (e) => { clearTimeout(uT); uT = setTimeout(() => loadUsers(e.target.value.trim()), 300); };
async function loadUsers(q = '') {
  try {
    const d = await api(`/api/mod/users?q=${encodeURIComponent(q)}`);
    $('#uList').innerHTML = d.items.length ? d.items.map((u, i) => `<div class="tr trow"><div><b>${esc(u.display_name || 'Unnamed viewer')}</b><span class="dim small">Last seen ${ago(u.last_seen)}</span></div><button type="button" data-fu="${i}">Flag user</button></div>`).join('') : '<p class="dim small">No users match.</p>';
    $$('[data-fu]').forEach((b) => (b.onclick = async () => { const u = d.items[+b.dataset.fu]; const c = await confirmBox(`Flag ${u.display_name || 'this user'}?`, 'The admin reviews it; nothing happens to their account automatically.', 'Flag user', true); if (!c) return; try { await api('/api/mod/flag', { method: 'POST', body: { kind: 'flag_user', user_id: u.user_id, title: `User: ${u.display_name || 'Unnamed'}`, body: c.reason } }); toast('User flagged for the admin'); } catch (e) { toast(e.message); } }));
  } catch (e) { $('#uList').innerHTML = `<p class="err">${esc(e.message)}</p>`; }
}

// ---- suggestions
function sgType() { const push = $('#sgType').value === 'push'; $('#sgColorW').hidden = push; const m = push ? 200 : 280; $('#sgText').maxLength = m; $('#sgMax').textContent = `(max ${m})`; }
$('#sgType').onchange = sgType;
$('#sgGo').onclick = async () => {
  $('#sgErr').textContent = '';
  try { await api('/api/mod/suggest', { method: 'POST', body: { type: $('#sgType').value, text: $('#sgText').value, color: $('#sgColor').value } }); toast('Sent to the admin for approval'); $('#sgText').value = ''; }
  catch (e) { $('#sgErr').textContent = e.message; }
};

// ---- log
async function loadLog() {
  try { const d = await api('/api/mod/log'); $('#logList').innerHTML = d.items.length ? d.items.map((x) => `<div class="tr lrow"><div><b><span class="pv">${esc(x.action)}</span></b><span class="dim small">${esc(x.target || '')}${x.detail?.status ? ` → ${esc(STATUS[x.detail.status] || x.detail.status)}` : ''}${x.detail?.note ? ` · “${esc(x.detail.note)}”` : ''}</span></div><time class="dim small">${when(x.created_at)}</time></div>`).join('') : '<p class="dim small">Nothing yet.</p>'; }
  catch (e) { $('#logList').innerHTML = `<p class="err">${esc(e.message)}</p>`; }
}

// ---- boot: only moderators get the dashboard (the API refuses everyone else regardless)
(async () => {
  try {
    if (!(await token())) { $('#gateMsg').innerHTML = 'Sign in on <a href="/">GhostFlix</a> first, then come back here.'; return; }
    const me = await api('/api/mod/me'); $('#who').textContent = me.name || ''; $('#gate').hidden = true; $('#dash').hidden = false;
    $('#tabs').addEventListener('click', (e) => { const a = e.target.closest('[data-tab]'); if (!a) return; e.preventDefault(); history.replaceState(null, '', `#${a.dataset.tab}`); showTab(a.dataset.tab); });
    window.addEventListener('hashchange', () => showTab(location.hash.slice(1)));
    let saved = 'inbox'; try { saved = localStorage.getItem('gf.modTab') || 'inbox'; } catch {}
    showTab(TABS.includes(location.hash.slice(1)) ? location.hash.slice(1) : saved);
    if (location.hash.slice(1) !== 'sources') api('/api/mod/reports?status=open').then((d) => { const n = d.items.length; $('#srcCnt').hidden = !n; $('#srcCnt').textContent = n; }).catch(() => {});
  } catch (e) {
    $('#gateMsg').textContent = e.status === 403 ? (/suspended/i.test(e.message) ? e.message : 'This page is for GhostFlix moderators only.') : e.status === 503 ? 'GhostFlix is in maintenance mode right now.' : e.message;
  }
})();
