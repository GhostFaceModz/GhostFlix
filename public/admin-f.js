// Stage F admin tabs: activity feed + visitor charts, reports inbox + moderator flags, users ban/unban/remove,
// team & roles + mod log, schedule, feature switches, hide/pin, health, backup, maintenance surfacing.
const { $, $$, esc, toast, api, box, bars, fmt, F, reloadUsers, loadSite } = window.__gfAdmin;
const when = (x, o = {}) => (x ? new Date(x).toLocaleString(undefined, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', ...o }) : '—');
const ago = (x) => { if (!x) return '—'; const s = Math.max(0, (Date.now() - new Date(x)) / 1000); return s < 60 ? 'just now' : s < 3600 ? `${Math.round(s / 60)}m ago` : s < 86400 ? `${Math.round(s / 3600)}h ago` : `${Math.round(s / 86400)}d ago`; };
const STATUS = { open: 'Open', in_progress: 'In progress', done: 'Done', wontfix: 'Won’t fix' };
// Bug reports / title requests: 'done' reads as Fixed, and the owner/mods can reply to the reporter.
const RSTATUS = { ...STATUS, done: 'Fixed' }; const canReply = (r) => r.kind === 'bug' || r.kind === 'request';
const repliesHTML = (r) => (canReply(r) ? `<div class="ib-rep">${(r.replies || []).map((x) => `<div class="ib-r"><b>${esc(x.by_name)}</b> <span class="pv">${x.by_role === 'owner' ? 'Owner' : 'Mod'}</span>${x.status ? ` <span class="st st-${esc(x.status)}">${RSTATUS[x.status] || esc(x.status)}</span>` : ''} <span class="dim small">${ago(x.created_at)}${x.delivered ? ` · ${esc(x.delivered)}` : ''}</span><p>${esc(x.body)}</p></div>`).join('')}`
  + (r.signed_in ? '' : '<p class="ib-anon">Reporter not signed in — they can’t see replies. Your reply is kept here for the record.</p>')
  + '<textarea class="ib-rbox" data-reply maxlength="1000" rows="2" aria-label="Reply to the reporter" placeholder="Reply to the reporter, e.g. Fixed, try again now (sent with the status on the left)"></textarea></div>' : '');
const KIND = { request: '🎬 Request', bug: '🐞 Bug', chat: '💬 Chat report', flag_title: '⚑ Title', flag_kids: '🧒 Kids safety', flag_user: '👤 User', flag_chat: '💬 Chat', flag_comment: '🗨️ Comment', announce: '📣 Suggestion' };
// Confirm dialog (native <dialog>) — every destructive/user-affecting action goes through this.
function confirmBox(title, body, ok = 'Confirm', danger = false, withReason = false) {
  return new Promise((done) => {
    const d = document.createElement('dialog'); d.className = 'cdlg';
    d.innerHTML = `<form method="dialog"><h3>${esc(title)}</h3><p class="dim">${body}</p>${withReason ? '<input name="r" maxlength="200" placeholder="Reason (optional, only you see it)">' : ''}<div class="btns"><button value="no" class="btn ghost sm">Cancel</button><button value="yes" class="btn sm ${danger ? 'danger' : 'glow'}">${esc(ok)}</button></div></form>`;
    document.body.appendChild(d); d.addEventListener('close', () => { const v = d.returnValue === 'yes'; const r = d.querySelector('[name=r]')?.value || ''; d.remove(); done(v ? { reason: r } : null); }); d.showModal();
  });
}

// ---- maintenance surfacing
F.maint = (on) => {
  $('#maintBar').hidden = !on; $('#maintState').innerHTML = on ? '<b class="pv bad">ON</b>' : '<b class="pv">off</b>';
  document.querySelector('[data-tab="site"]').classList.toggle('warn', !!on);
};
$('#maintCheck').onclick = async () => {
  $('#maintOut').textContent = 'Checking as a signed-out visitor…';
  try { const r = await api('/api/admin/maint-check'); $('#maintOut').textContent = r.maintenance ? `✅ Maintenance is live: visitors get HTTP ${r.page} (“back soon” page) and the API answers ${r.api}.` : `Site is open: visitors get HTTP ${r.page}, API ${r.api}.`; }
  catch (e) { $('#maintOut').textContent = e.message; }
};

// ---- activity feed + visitor charts
let feedT = null, VD = 30;
async function loadFeed() {
  clearTimeout(feedT); if (!$('[data-pane="activity"]').hidden) feedT = setTimeout(loadFeed, 10e3);
  try {
    const d = await api('/api/admin/feed'); $('#feedLive').textContent = `· ${fmt(d.live)} live now`; $('#feedNote').textContent = d.note || '';
    $('#feed').innerHTML = d.items.length ? d.items.map((x) => `<li><span class="fdot ${x.type === 'tv' ? 'tv' : ''}"></span><span>${esc(x.text)}${x.device ? ` <span class="dim">· ${esc(x.device)}</span>` : ''}</span><time class="dim small">${ago(x.at)}</time></li>`).join('') : '<li class="dim">Nothing yet since the server last started. Plays show up here as they happen.</li>';
  } catch (e) { $('#feed').innerHTML = `<li class="err">${esc(e.message)}</li>`; }
}
function hoursChart(hours) {
  const by = Array.from({ length: 24 }, (_, h) => hours.find((x) => +x.hour === h) || { hour: h, views: 0, visitors: 0 });
  const max = Math.max(1, ...by.map((x) => +x.views)); const peak = by.reduce((a, b) => (+b.views > +a.views ? b : a), by[0]);
  return `<div class="hours" role="img" aria-label="Page views by hour of day (UTC)">${by.map((x) => `<i style="height:${Math.max(2, (x.views / max) * 100)}%" title="${String(x.hour).padStart(2, '0')}:00 UTC — ${x.views} views, ${x.visitors} visitors"${x === peak && +x.views ? ' class="pk"' : ''}></i>`).join('')}</div><div class="ticks"><span>00</span><span>06</span><span>12</span><span>18</span><span>23</span></div><p class="dim small">${+peak.views ? `Busiest hour: <b>${String(peak.hour).padStart(2, '0')}:00–${String((peak.hour + 1) % 24).padStart(2, '0')}:00 UTC</b>. ` : ''}Hours are UTC (UK time is UTC+1 in summer).</p>`;
}
async function loadVisitors() {
  $$('#vRange [data-days]').forEach((b) => b.classList.toggle('on', +b.dataset.days === VD));
  try {
    const d = await api(`/api/admin/visitors?days=${VD}`);
    const unknown = d.countries.length && d.countries.every((c) => c.country === '??');
    $('#vGrid').innerHTML = [
      box(`Peak hours · last ${d.days} days`, hoursChart(d.hours), 'wide'),
      box('Devices', bars(d.devices, 'device', (x) => esc(x.device[0].toUpperCase() + x.device.slice(1)))),
      box('Countries', bars(d.countries, 'country', (x) => (x.country === '??' ? 'Unknown' : esc(x.country))) + (unknown ? '<p class="dim small">Country needs a CDN country header (e.g. Cloudflare in front of Render); the host doesn’t send one yet, so visits show as Unknown.</p>' : '')),
    ].join('');
  } catch (e) { $('#vGrid').innerHTML = `<p class="err">${esc(e.message)}</p>`; }
}
$('#vRange').addEventListener('click', (e) => { const b = e.target.closest('[data-days]'); if (b) { VD = +b.dataset.days; loadVisitors(); } });

// ---- reports inbox + flags
let IBK = '', IBS = '';
const notesHTML = (n) => (Array.isArray(n) && n.length ? `<ul class="notes">${n.map((x) => `<li><b>${esc(x.by)}</b> ${esc(x.text)} <span class="dim small">${ago(x.at)}</span></li>`).join('')}</ul>` : '');
function itemHTML(r, flags) {
  const d = r.data || {}; const tl = d.key ? `/title/${d.key.replace(':', '/')}` : d.card ? `/title/${d.card.media_type}/${d.card.id}` : null;
  const extra = [d.page && `Page <code>${esc(d.page)}</code>`, d.viewport && esc(d.viewport), d.app && 'installed app', d.room && `Room <code>${esc(d.room)}</code>`, d.message && `“${esc(d.message)}”`, d.author && `by ${esc(d.author)}`, d.user_id && `user ${esc(String(d.user_id).slice(0, 8))}`, d.type && `${esc(d.type)}`].filter(Boolean).join(' · ');
  return `<div class="ib" data-id="${r.id}"><div class="ibh"><span class="pv">${KIND[r.kind] || esc(r.kind)}</span><b>${tl ? `<a href="${tl}" target="_blank" rel="noopener">${esc(r.title || '')}</a>` : esc(r.title || '')}</b><span class="st st-${r.status}">${(canReply(r) ? RSTATUS : STATUS)[r.status] || r.status}</span>${canReply(r) && !r.signed_in ? '<span class="pv anon">Reporter not signed in</span>' : ''}<time class="dim small" title="${esc(r.created_at)}">${ago(r.created_at)}</time></div>
    ${r.body ? `<p class="ibb">${esc(r.body)}</p>` : ''}${extra ? `<p class="dim small">${extra}</p>` : ''}${r.has_shot ? `<details class="shot"><summary>Screenshot</summary><img loading="lazy" alt="Bug report screenshot" data-src="/api/admin/inbox/${r.id}/shot"></details>` : ''}${notesHTML(r.notes)}${repliesHTML(r)}
    <div class="iba"><div class="select sm"><select data-st aria-label="Status">${Object.entries(canReply(r) ? RSTATUS : STATUS).map(([k, v]) => `<option value="${k}"${k === r.status ? ' selected' : ''}>${v}</option>`).join('')}</select></div><input data-note maxlength="500" placeholder="Add a note…">${canReply(r) ? '<button type="button" class="ok" data-sendreply>Send reply</button>' : ''}<button type="button" data-save>Save note/status</button>${flags && r.status !== 'done' && ['flag_title', 'flag_kids', 'flag_chat', 'announce'].includes(r.kind) ? `<button type="button" class="ok" data-approve>${r.kind === 'announce' ? (d.type === 'push' ? 'Approve & send push' : 'Approve & publish banner') : r.kind === 'flag_chat' ? 'Hide message' : 'Hide title site-wide'}</button>` : ''}${r.kind === 'chat' && +d.message_id > 0 && r.status !== 'done' ? `<button type="button" data-hidechat="${+d.message_id}">Hide message</button>` : ''}<button type="button" class="danger" data-del>Delete</button></div></div>`;
}
function wireInbox(el, reload, flags) {
  $$('details.shot', el).forEach((dt) => dt.addEventListener('toggle', () => { const i = dt.querySelector('img'); if (dt.open && !i.src) i.src = i.dataset.src; }));
  $$('.ib', el).forEach((it) => {
    const id = it.dataset.id; const q = (s) => it.querySelector(s);
    q('[data-save]').onclick = async () => { try { await api(`/api/admin/inbox/${id}`, { method: 'PATCH', body: { status: q('[data-st]').value, note: q('[data-note]').value } }); toast('Saved'); reload(); } catch (e) { toast(e.message); } };
    const sr = q('[data-sendreply]'); if (sr) sr.onclick = async () => { const body = q('[data-reply]').value.trim(); if (!body) return toast('Write a reply first'); sr.disabled = true;
      try { const j = await api(`/api/admin/inbox/${id}/reply`, { method: 'POST', body: { body, status: q('[data-st]').value } }); toast(j.signed_in ? `Reply sent (${j.delivered})` : 'Saved — reporter wasn’t signed in, so they won’t see it'); reload(); } catch (e) { sr.disabled = false; toast(e.message); } };
    q('[data-del]').onclick = async () => { if (!(await confirmBox('Delete this item?', 'It’s removed from the inbox for you and the moderators. This can’t be undone.', 'Delete', true))) return; try { await api(`/api/admin/inbox/${id}`, { method: 'DELETE' }); toast('Deleted'); reload(); } catch (e) { toast(e.message); } };
    const ap = q('[data-approve]'); if (ap) ap.onclick = async () => { if (!(await confirmBox(ap.textContent + '?', 'This takes effect on the live site straight away.', ap.textContent))) return; try { const r = await api(`/api/admin/inbox/${id}/approve`, { method: 'POST', body: {} }); toast(r.result?.sent != null ? `Sent to ${r.result.sent} device(s)` : 'Done'); reload(); if (flags) loadCtl(); } catch (e) { toast(e.message); } };
    const hc = q('[data-hidechat]'); if (hc) hc.onclick = async () => { const row = { data: { message_id: +hc.dataset.hidechat } }; if (!(await confirmBox('Hide this chat message?', 'Friends will no longer see it.', 'Hide'))) return; try { await api(`/api/admin/chat/${row.data.message_id}/hide`, { method: 'POST', body: {} }); await api(`/api/admin/inbox/${id}`, { method: 'PATCH', body: { status: 'done', note: 'Message hidden' } }); toast('Hidden'); reload(); } catch (e) { toast(e.message); } };
  });
}
async function loadInbox() {
  try {
    const d = await api(`/api/admin/inbox?status=${IBS}`); const items = IBK ? d.items.filter((x) => x.kind === IBK) : d.items;
    $('#ibList').innerHTML = items.length ? items.map((r) => itemHTML(r, false)).join('') : '<p class="dim">Nothing here 🎉</p>'; wireInbox($('#ibList'), loadInbox, false);
    const open = d.items.filter((x) => x.status === 'open').length; F.ibOpen = open; badge();
  } catch (e) { $('#ibList').innerHTML = `<p class="err">${esc(e.message)}</p>`; }
}
async function loadFlags() {
  try {
    const d = await api('/api/admin/inbox?flags=1'); $('#flagList').innerHTML = d.items.length ? d.items.map((r) => itemHTML(r, true)).join('') : '<p class="dim">No flags from moderators.</p>'; wireInbox($('#flagList'), loadFlags, true);
    const open = d.items.filter((x) => x.status === 'open').length; $('#flagCnt').hidden = !open; $('#flagCnt').textContent = open; F.flOpen = open; badge();
  } catch (e) { $('#flagList').innerHTML = `<p class="err">${esc(e.message)}</p>`; }
}
function badge() { const c = $('#repCnt'); const n = (F.ibOpen || 0) + (F.flOpen || 0); if (n) { c.hidden = false; c.textContent = n; } }
$('#ibKind').addEventListener('click', (e) => { const b = e.target.closest('[data-k]'); if (!b) return; IBK = b.dataset.k; $$('#ibKind button').forEach((x) => x.classList.toggle('on', x === b)); loadInbox(); });
$('#ibStatus').onchange = (e) => { IBS = e.target.value; loadInbox(); };

// ---- users: ban / unban / remove (confirm dialogs)
F.wireUsers = () => {
  $$('[data-ban]').forEach((b) => (b.onclick = async () => { const c = await confirmBox(`Ban ${b.dataset.n}?`, 'They’re signed out and can’t sign in or use chat/friends. Reversible any time with Unban.', 'Ban', true, true); if (!c) return; try { await api(`/api/admin/users/${b.dataset.ban}/ban`, { method: 'POST', body: { reason: c.reason } }); toast('Banned'); reloadUsers(); } catch (e) { toast(e.message); } }));
  $$('[data-unban]').forEach((b) => (b.onclick = async () => { if (!(await confirmBox(`Unban ${b.dataset.n}?`, 'They can sign in and use GhostFlix normally again.', 'Unban'))) return; try { await api(`/api/admin/users/${b.dataset.unban}/unban`, { method: 'POST', body: {} }); toast('Unbanned'); reloadUsers(); } catch (e) { toast(e.message); } }));
  $$('[data-rm]').forEach((b) => (b.onclick = async () => { if (!(await confirmBox(`Remove ${b.dataset.n}?`, '<b>Permanent.</b> Deletes the account and its GhostFlix data (lists, history, profiles, friends, chat). Use Ban if you might want to undo it.', 'Remove account', true))) return; try { await api(`/api/admin/users/${b.dataset.rm}`, { method: 'DELETE' }); toast('Removed'); reloadUsers(); } catch (e) { toast(e.message); } }));
};

// ---- team & roles (role changes need the admin's own Discord sign-in token from the main site)
function siteToken() { try { const s = JSON.parse(localStorage.getItem('ghostflix-auth') || 'null'); const t = s?.access_token || s?.currentSession?.access_token; const exp = s?.expires_at || 0; return t && exp * 1000 > Date.now() + 30e3 ? t : null; } catch { return null; } }
function roleWho() { $('#roleWho').innerHTML = siteToken() ? '✅ Signed in on the main site in this browser — role changes are checked against your Discord account.' : '⚠️ Not signed in on the main site in this browser (or the sign-in expired). <a href="/" target="_blank">Open GhostFlix</a>, sign in with Discord, then come back to change roles.'; }
const urow = (u, inMods) => `<div class="tr trow"><div><b>${esc(u.name || u.email || u.uid.slice(0, 8))}${u.admin ? ' <span class="pv">admin</span>' : ''}${u.role ? ` <span class="pv">${esc(u.role)}</span>` : ''}</b><span class="dim small">${esc(u.email)} · ${esc(u.providers.join(', '))}${u.granted_at ? ` · since ${when(u.granted_at, { year: '2-digit' })}` : ''}</span></div>${u.admin ? '<span class="dim small">Owner</span>' : u.role ? `<button type="button" data-role="" data-uid="${u.uid}" data-n="${esc(u.name || u.email)}">Remove moderator</button>` : `<button type="button" data-role="moderator" data-uid="${u.uid}" data-n="${esc(u.name || u.email)}">Make moderator</button>`}</div>`;
async function loadTeam(q = '') {
  roleWho(); $('#teamErr').textContent = '';
  try {
    const d = await api(`/api/admin/team?q=${encodeURIComponent(q)}`);
    $('#modList').innerHTML = d.mods.length ? d.mods.map((u) => urow(u, true)).join('') : '<p class="dim small">No moderators yet.</p>';
    $('#teamRes').innerHTML = q ? (d.results.length ? d.results.map((u) => urow(u)).join('') : '<p class="dim small">No matching users.</p>') : '';
    $$('[data-role]').forEach((b) => (b.onclick = async () => {
      const mk = b.dataset.role === 'moderator';
      if (!(await confirmBox(mk ? `Make ${b.dataset.n} a moderator?` : `Remove ${b.dataset.n} as moderator?`, mk ? 'They get the /mod panel: inbox, flags, users list (names + last seen) and suggestions. No admin access.' : 'They lose access to /mod straight away.', mk ? 'Make moderator' : 'Remove', !mk))) return;
      const tok = siteToken(); if (!tok) { roleWho(); return toast('Sign in with Discord on the main site first'); }
      try { await api(`/api/admin/team/${b.dataset.uid}`, { method: 'POST', body: { role: b.dataset.role }, headers: { Authorization: `Bearer ${tok}` } }); toast('Role updated'); loadTeam($('#teamQ').value.trim()); }
      catch (e) { $('#teamErr').textContent = e.message; }
    }));
  } catch (e) { $('#teamErr').textContent = e.message; }
}
let tq; $('#teamQ').oninput = (e) => { clearTimeout(tq); tq = setTimeout(() => loadTeam(e.target.value.trim()), 350); };
// ---- all members (admin-only API; also needs the admin's Discord sign-in token, same as role changes)
const MEM = { page: 1, mods: false, discord: false };
const memTag = (t) => (t === 'owner' ? ' <span class="mtag own">👑 OWNER</span>' : t === 'mod' ? ' <span class="mtag mod">🛡️ MODERATOR</span>' : '');
const memAv = (x, sz = 40) => `<span class="mav" style="--s:${sz}px">${x.avatar ? `<img src="${esc(x.avatar)}" alt="" referrerpolicy="no-referrer" loading="lazy">` : esc((x.name || '?')[0])}</span>`;
async function loadMembers() {
  const tok = siteToken(); $('#memErr').textContent = '';
  if (!tok) { $('#memList').innerHTML = '<p class="dim small">Sign in with Discord on the main site in this browser to see members.</p>'; return; }
  try {
    const d = await api(`/api/admin/members?page=${MEM.page}&sort=${$('#memSort').value}&q=${encodeURIComponent($('#memQ').value.trim())}${MEM.mods ? '&mods=1' : ''}${MEM.discord ? '&discord=1' : ''}`, { headers: { Authorization: `Bearer ${tok}` } });
    MEM.page = d.page; $('#memTotal').textContent = `${d.total}`; $('#memPage').textContent = `Page ${d.page} of ${d.pages}`; $('#memPrev').disabled = d.page <= 1; $('#memNext').disabled = d.page >= d.pages;
    $('#memList').innerHTML = d.members.length ? d.members.map((x) => `<button type="button" class="tr mrow" data-mem="${x.uid}">${memAv(x)}<div><b>${esc(x.name || 'Viewer')}${memTag(x.tag)}</b><span class="dim small">${esc(x.email)}${x.discord ? ` · Discord ${esc(x.discord.user || x.discord.id)}` : ''}</span></div><span class="dim small mst">${x.tier.emoji} ${x.hours} h<br>${ago(x.last)}</span></button>`).join('') : '<p class="dim small">No members match.</p>';
    $$('[data-mem]').forEach((b) => (b.onclick = () => memberView(b.dataset.mem)));
  } catch (e) { $('#memErr').textContent = e.message; }
}
async function memberView(uid) {
  const tok = siteToken(); if (!tok) return toast('Sign in with Discord on the main site first');
  const dl = document.createElement('dialog'); dl.className = 'cdlg memd'; dl.innerHTML = '<p class="dim">Loading…</p>'; document.body.appendChild(dl); dl.addEventListener('close', () => dl.remove()); dl.showModal();
  let x; try { x = await api(`/api/admin/members/${uid}`, { headers: { Authorization: `Bearer ${tok}` } }); } catch (e) { dl.innerHTML = `<p class="err">${esc(e.message)}</p><div class="btns"><button class="btn ghost sm" onclick="this.closest('dialog').close()">Close</button></div>`; return; }
  const yn = (v) => (v ? '<b class="pv ok">on</b>' : '<b class="pv">off</b>');
  const row = (k, v) => `<div class="kv"><span class="dim">${k}</span><span>${v}</span></div>`;
  dl.innerHTML = `<div class="memh">${memAv(x, 64)}<div><h3>${esc(x.name || 'Viewer')}${memTag(x.tag)}</h3><span class="dim small">${x.profiles.map((p) => esc(p.name) + (p.kids ? ' (kids)' : '')).join(' · ')}</span></div></div>
    ${row('Email', esc(x.email || '—'))}${row('Discord', x.discord ? `${esc(x.discord.user || x.discord.name || '')} <span class="dim">${esc(x.discord.id)}</span>` : 'not linked')}${row('Sign-in', esc(x.providers.join(', ') || '—'))}
    ${row('Joined', when(x.joined, { year: 'numeric' }))}${row('Last active', `${when(x.last, { year: 'numeric' })} (${ago(x.last)})`)}
    ${row('Watch time', `${x.hours} h`)}${row('Rank', `${x.rank.emoji} ${esc(x.rank.name)}`)}${row('Titles watched', x.titles)}
    ${row('Lists', `${x.lists.watchlist} in My List · ${x.lists.shared} shared`)}${row('Favourites', x.favourites)}${row('Friends', `${x.friends} · ${x.followers} followers · following ${x.following}`)}
    ${row('Friends feature', yn(x.privacy.friends_on))}${row('Share watching', yn(x.privacy.share_watching))}
    ${row('Public profile', x.privacy.public.length ? x.privacy.public.map((p) => `${esc(p.profile)}: ${p.enabled ? `<a href="/u/${esc(p.slug)}" target="_blank">on</a>` : 'off'}${p.show_history ? ' (+history)' : ''}`).join(' · ') : 'off')}
    ${row('Profile stats', x.privacy.stats.length ? x.privacy.stats.map((p) => `${esc(p.profile)}: stats ${p.show_stats ? 'shown' : 'hidden'}, watching ${p.show_watching ? 'shown' : 'hidden'}`).join(' · ') : 'defaults')}
    ${x.banned ? row('Banned', `<b class="bad">${when(x.banned.banned_at)}</b> ${esc(x.banned.reason || '')}`) : ''}
    <h4 class="sub">Reports &amp; flags <small class="dim">${x.reports.length}</small></h4>${x.reports.length ? x.reports.map((r) => `<div class="kv"><span>${esc(KIND[r.kind] || r.kind)} · ${esc(r.title || '')} <span class="dim">${r.by_them ? '(sent by them)' : '(about them)'}</span></span><span class="dim small">${esc(STATUS[r.status] || r.status)} · ${when(r.at)}</span></div>`).join('') : '<p class="dim small">None.</p>'}
    <div class="btns">${x.tag === 'owner' ? '' : `<button type="button" class="btn sm" id="memRole">${x.tag === 'mod' ? 'Remove moderator' : 'Make moderator'}</button>`}<button type="button" class="btn ghost sm" id="memClose">Close</button></div>`;
  dl.querySelector('#memClose').onclick = () => dl.close();
  const rb = dl.querySelector('#memRole'); if (rb) rb.onclick = async () => {
    const mk = x.tag !== 'mod'; dl.close();
    if (!(await confirmBox(mk ? `Make ${x.name} a moderator?` : `Remove ${x.name} as moderator?`, mk ? 'They get the /mod panel: inbox, flags, users list (names + last seen) and suggestions. No admin access.' : 'They lose access to /mod straight away.', mk ? 'Make moderator' : 'Remove', !mk))) return;
    const t = siteToken(); if (!t) { roleWho(); return toast('Sign in with Discord on the main site first'); }
    try { await api(`/api/admin/team/${x.uid}`, { method: 'POST', body: { role: mk ? 'moderator' : '' }, headers: { Authorization: `Bearer ${t}` } }); toast('Role updated'); loadTeam($('#teamQ').value.trim()); loadMembers(); } catch (e) { toast(e.message); }
  };
}
let mq; $('#memQ').oninput = () => { clearTimeout(mq); mq = setTimeout(() => { MEM.page = 1; loadMembers(); }, 350); };
$('#memSort').onchange = () => { MEM.page = 1; loadMembers(); };
$$('[data-mf]').forEach((b) => (b.onclick = () => { MEM[b.dataset.mf] = !MEM[b.dataset.mf]; b.classList.toggle('on', MEM[b.dataset.mf]); MEM.page = 1; loadMembers(); }));
$('#memPrev').onclick = () => { MEM.page--; loadMembers(); }; $('#memNext').onclick = () => { MEM.page++; loadMembers(); };
async function loadModLog() {
  try { const d = await api('/api/admin/modlog'); $('#modLog').innerHTML = d.items.length ? d.items.map((x) => `<div class="tr lrow"><div><b>${esc(x.mod_name || String(x.mod_id).slice(0, 8))}</b> <span class="pv">${esc(x.action)}</span><span class="dim small">${esc(x.target || '')}${x.detail?.status ? ` → ${esc(STATUS[x.detail.status] || x.detail.status)}` : ''}${x.detail?.note ? ` · “${esc(x.detail.note)}”` : ''}</span></div><time class="dim small">${when(x.created_at)}</time></div>`).join('') : '<p class="dim small">No moderator activity yet.</p>'; }
  catch (e) { $('#modLog').innerHTML = `<p class="err">${esc(e.message)}</p>`; }
}

// ---- schedule
let SCH = [];
const localIn = (iso) => { const d = new Date(iso); return new Date(d - d.getTimezoneOffset() * 60e3).toISOString().slice(0, 16); };
function renderSch(now) {
  $('#schNow').textContent = when(now, { year: 'numeric' });
  const t = Date.now();
  $('#schList').innerHTML = SCH.length ? SCH.map((x, i) => { const live = Date.parse(x.start) <= t && t < Date.parse(x.end), past = Date.parse(x.end) <= t; return `<div class="tr srow${past ? ' past' : ''}"><div><b>${x.kind === 'theme' ? `🎨 Theme: ${esc(x.theme)}` : `<span class="swatch" style="background:${esc(x.color)}"></span>📣 ${esc(x.text)}`}</b><span class="dim small">${when(x.start)} → ${when(x.end)}</span></div><span class="pv${live ? ' ok' : past ? ' dim' : ''}">${live ? 'Live now' : past ? 'Finished' : 'Upcoming'}</span><button type="button" data-sdel="${i}">Remove</button></div>`; }).join('') : '<p class="dim small">Nothing scheduled.</p>';
  $$('[data-sdel]', $('#schList')).forEach((b) => (b.onclick = async () => { if (!(await confirmBox('Remove this scheduled item?', esc(SCH[+b.dataset.sdel].text || SCH[+b.dataset.sdel].theme), 'Remove', true))) return; saveSch(SCH.filter((_, i) => i !== +b.dataset.sdel)); }));
}
async function loadSch() { try { const d = await api('/api/admin/schedule'); SCH = d.items; renderSch(d.now); } catch (e) { $('#schErr').textContent = e.message; } }
async function saveSch(items) { $('#schErr').textContent = ''; try { const d = await api('/api/admin/schedule', { method: 'PUT', body: { items } }); SCH = d.items; renderSch(new Date()); toast('Schedule saved'); } catch (e) { $('#schErr').textContent = e.message; } }
const schKind = () => { const th = $('#schKind').value === 'theme'; $('#schThemeW').hidden = !th; $('#schTextW').hidden = th; $('#schColorW').hidden = th; };
$('#schKind').onchange = schKind;
$('#schAdd').onclick = () => {
  const s = $('#schStart').value, e = $('#schEnd').value; if (!s || !e) return ($('#schErr').textContent = 'Pick a start and end time.');
  if (new Date(e) <= new Date(s)) return ($('#schErr').textContent = 'The end must be after the start.');
  const kind = $('#schKind').value; if (kind === 'banner' && !$('#schText').value.trim()) return ($('#schErr').textContent = 'Write the banner text.');
  saveSch([...SCH, { kind, theme: $('#schTheme').value, text: $('#schText').value.trim(), color: $('#schColor').value, start: new Date(s).toISOString(), end: new Date(e).toISOString() }]);
  $('#schText').value = '';
};
(() => { const n = new Date(); n.setMinutes(0, 0, 0); n.setHours(n.getHours() + 1); $('#schStart').value = localIn(n); n.setDate(n.getDate() + 1); $('#schEnd').value = localIn(n); })();

// ---- feature switches
const FEAT_HELP = { live: 'Live TV section', chat: 'Watch-together chat on title pages', friends: 'Friends, friend codes and “watching”', publicProfiles: 'Public profile links', themes: 'Seasonal themes (incl. scheduled)', top10: 'Top 10 on GhostFlix this week', moods: 'Mood picker on Home', requests: 'Request a title', bugs: 'Report a bug', achievements: 'Badges & streaks', countdowns: 'Release countdowns', push: 'Push notifications (opt-in + sender)' };
async function loadFeat() {
  try {
    const d = await api('/api/admin/features');
    $('#featList').innerHTML = d.keys.map(([k, label]) => `<label class="fs"><span><b>${esc(label || k)}</b><small class="dim">${esc(FEAT_HELP[k] || '')}</small></span><input type="checkbox" role="switch" data-f="${k}" ${d.features[k] ? 'checked' : ''}><i aria-hidden="true"></i></label>`).join('');
    $$('[data-f]').forEach((c) => (c.onchange = async () => { $('#featErr').textContent = ''; try { await api('/api/admin/features', { method: 'PUT', body: { features: { [c.dataset.f]: c.checked } } }); toast(`${FEAT_HELP[c.dataset.f] || c.dataset.f}: ${c.checked ? 'on' : 'off'}`); } catch (e) { c.checked = !c.checked; $('#featErr').textContent = e.message; } }));
  } catch (e) { $('#featList').innerHTML = `<p class="err">${esc(e.message)}</p>`; }
}

// ---- hide / pin
let CTL = { hidden: [], pins: [] }, ROWS = null;
async function loadCtl() {
  try { CTL = await api('/api/admin/content'); if (!ROWS) ROWS = (await api('/api/admin/site')).rows.filter((r) => !['continue', 'mylist'].includes(r.id)); renderCtl(); } catch (e) { $('#ctlErr').textContent = e.message; }
}
const rowName = (id) => (id === 'hero' ? 'Hero (first slide)' : id === 'featured' ? '“Featured on GhostFlix” row' : ROWS?.find((r) => r.id === id)?.title || id);
function renderCtl() {
  const link = (k) => `/title/${k.replace(':', '/')}`;
  $('#ctlHidden').innerHTML = CTL.hidden.length ? CTL.hidden.map((x, i) => `<div class="tr crow"><div><b><a href="${link(x.key)}" target="_blank" rel="noopener">${esc(x.title || x.key)}</a></b><span class="dim small">${esc(x.key)}</span></div><button type="button" data-unhide="${i}">Unhide</button></div>`).join('') : '<p class="dim small">Nothing hidden.</p>';
  $('#ctlPins').innerHTML = CTL.pins.length ? CTL.pins.map((x, i) => `<div class="tr crow"><div><b><a href="${link(x.key)}" target="_blank" rel="noopener">${esc(x.title || x.key)}</a></b><span class="dim small">${esc(rowName(x.row))}</span></div><button type="button" data-unpin="${i}">Unpin</button></div>`).join('') : '<p class="dim small">Nothing pinned.</p>';
  $$('[data-unhide]').forEach((b) => (b.onclick = () => saveCtl({ ...CTL, hidden: CTL.hidden.filter((_, i) => i !== +b.dataset.unhide) }, 'Visible again')));
  $$('[data-unpin]').forEach((b) => (b.onclick = () => saveCtl({ ...CTL, pins: CTL.pins.filter((_, i) => i !== +b.dataset.unpin) }, 'Unpinned')));
}
async function saveCtl(next, msg) { $('#ctlErr').textContent = ''; try { CTL = await api('/api/admin/content', { method: 'PUT', body: next }); renderCtl(); toast(msg); } catch (e) { $('#ctlErr').textContent = e.message; } }
let ct; $('#ctlQ').oninput = (e) => {
  clearTimeout(ct); const q = e.target.value.trim(); if (q.length < 2) { $('#ctlRes').innerHTML = ''; return; }
  ct = setTimeout(async () => {
    try {
      const d = await api(`/api/admin/lookup?q=${encodeURIComponent(q)}`); if (!ROWS) await loadCtl();
      const opts = `<option value="">Pin to…</option><option value="hero">Hero (first slide)</option><option value="featured">Featured row</option>${(ROWS || []).map((r) => `<option value="${esc(r.id)}">Front of “${esc(r.title)}”</option>`).join('')}`;
      $('#ctlRes').innerHTML = d.results.slice(0, 8).map((c, i) => `<div class="res ctlres"><img src="${esc(c.poster || '')}" alt=""><div><b>${esc(c.title)}</b><span>${c.media_type === 'tv' ? 'Series' : 'Movie'}${c.year ? ' · ' + c.year : ''} · TMDB ${c.id}</span></div><div class="ca"><button type="button" class="mini danger" data-hide="${i}">Hide</button><div class="select sm"><select data-pin="${i}" aria-label="Pin">${opts}</select></div></div></div>`).join('') || '<div class="res dim">No matches</div>';
      const key = (c) => `${c.media_type}:${c.id}`;
      $$('#ctlRes [data-hide]').forEach((b) => (b.onclick = async () => { const c = d.results[+b.dataset.hide]; if (!(await confirmBox(`Hide “${c.title}” site-wide?`, 'It disappears from every row, search, Top 10 and its detail page for everyone. You can unhide it here.', 'Hide', true))) return; $('#ctlRes').innerHTML = ''; $('#ctlQ').value = ''; saveCtl({ ...CTL, hidden: [...CTL.hidden.filter((x) => x.key !== key(c)), { key: key(c), title: c.title }] }, 'Hidden site-wide'); }));
      $$('#ctlRes [data-pin]').forEach((s) => (s.onchange = () => { const c = d.results[+s.dataset.pin]; if (!s.value) return; $('#ctlRes').innerHTML = ''; $('#ctlQ').value = ''; saveCtl({ ...CTL, pins: [...CTL.pins.filter((x) => !(x.key === key(c) && x.row === s.value)), { key: key(c), title: c.title, row: s.value }] }, `Pinned to ${rowName(s.value)}`); }));
    } catch (err) { $('#ctlRes').innerHTML = `<div class="res err">${esc(err.message)}</div>`; }
  }, 300);
};

// ---- health + backup
const dur = (s) => (s < 3600 ? `${Math.round(s / 60)} min` : s < 86400 ? `${(s / 3600).toFixed(1)} h` : `${(s / 86400).toFixed(1)} days`);
async function loadHealth() {
  $('#health').innerHTML = '<p class="dim">Checking…</p>';
  try {
    const d = await api('/api/admin/health'); const R = d.render, live = R?.deploys?.find((x) => x.status === 'live');
    const ms = d.response?.ms; const sp = ms == null ? 'bad' : ms < 600 ? 'ok' : ms < 1500 ? 'warn' : 'bad';
    $('#health').innerHTML = [
      box('Render service', `<p class="big ${R?.ok && R.status === 'running' ? 'ok' : 'bad'}">${R?.ok ? (R.status === 'running' ? '🟢 Running' : `🔴 ${esc(R.status)}`) : `⚠️ ${esc(R?.status || 'Unknown')}`}</p>${R?.name ? `<p class="dim small">${esc(R.name)} · ${esc(R.plan || '')} · ${esc(R.region || '')}</p>` : ''}`),
      box('Last deploy', live ? `<p class="big">${when(live.finished)}</p><p class="dim small"><code>${esc(live.commit)}</code> ${esc(live.message || '')}</p>${R.deploys[0] && R.deploys[0] !== live ? `<p class="small">Newer: ${esc(R.deploys[0].status)} (${esc(R.deploys[0].commit)})</p>` : ''}` : '<p class="dim small">Needs RENDER_API_KEY on the server.</p>'),
      box('Response time', `<p class="big ${sp}">${ms == null ? 'No answer' : `${ms} ms`}</p><p class="dim small">GET ${esc(d.response?.url || '/healthz')} from the server${d.response?.status ? ` · HTTP ${d.response.status}` : ''}</p>`),
      box('Uptime', `<p class="big">${dur(d.server.up_s)}</p><p class="dim small">Since this instance started · Node ${esc(d.server.node)} · ${d.server.rss_mb} MB RAM${d.db?.keepalive ? ` · keep-alive pings OK ${d.db.keepalive.ok}/${d.db.keepalive.pings} in ${d.db.keepalive.window_hours} h` : ''}</p>`),
      box('Scheduled jobs (pg_cron)', (d.db?.cron || []).map((j) => `<div class="bar-row t"><span class="bl">${j.active ? '🟢' : '⚪'} <b>${esc(j.job)}</b> <span class="dim small">${esc(j.schedule)}</span></span><span class="small">${j.last ? `${j.last.status === 'succeeded' ? '✅' : '❌'} ${ago(j.last.start)}` : 'never ran'}</span><b class="small">${j.runs24h}/24h${j.failed24h ? ` · <span class="bad">${j.failed24h} failed</span>` : ''}</b></div>`).join('') || '<p class="dim small">No jobs found.</p>', 'wide'),
    ].join('');
  } catch (e) { $('#health').innerHTML = `<p class="err">${esc(e.message)}</p>`; }
}
$('#hRefresh').onclick = loadHealth;
async function loadBk() { try { const d = await api('/api/admin/backup/info'); $('#bkLast').innerHTML = d.last ? `Last backup: <b>${when(d.last.at, { year: 'numeric' })}</b> · ${fmt(d.last.rows)} rows · ${(d.last.bytes / 1048576).toFixed(2)} MB` : 'Last backup: <b>never</b>'; } catch (e) { $('#bkLast').textContent = e.message; } }
$('#bkGo').onclick = async (e) => {
  const b = e.currentTarget; b.disabled = true; $('#bkOut').textContent = 'Building the backup…';
  try {
    const r = await fetch('/api/admin/backup'); if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || `Error ${r.status}`);
    const blob = await r.blob(); const name = (r.headers.get('Content-Disposition') || '').match(/filename="([^"]+)"/)?.[1] || 'ghostflix-backup.json';
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name; document.body.appendChild(a); a.click(); setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 2000);
    $('#bkOut').textContent = `Downloaded ${name} (${(blob.size / 1048576).toFixed(2)} MB).`; loadBk();
  } catch (err) { $('#bkOut').textContent = err.message; }
  b.disabled = false;
};

// ---- tab hooks
F.onTab = (t) => {
  if (t === 'activity') { loadFeed(); loadVisitors(); }
  if (t === 'reports') { loadInbox(); loadFlags(); }
  if (t === 'team') { loadTeam($('#teamQ').value.trim()); loadMembers(); loadModLog(); }
  if (t === 'schedule') { schKind(); loadSch(); }
  if (t === 'features') loadFeat();
  if (t === 'content') loadCtl();
  if (t === 'system') { loadHealth(); loadBk(); }
};
// Open-item badge on the Reports tab even before it's opened.
setTimeout(() => { if ($('#dash') && !$('#dash').hidden) { loadInbox(); loadFlags(); } }, 1500);
