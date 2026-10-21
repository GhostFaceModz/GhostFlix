const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
let toastT; const toast = (m) => { const t = $('#toast'); t.textContent = m; t.classList.add('on'); clearTimeout(toastT); toastT = setTimeout(() => t.classList.remove('on'), 2600); };
async function api(path, opts = {}) {
  const r = await fetch(path, { ...opts, headers: { 'content-type': 'application/json', ...(opts.headers || {}) }, body: opts.body && typeof opts.body !== 'string' ? JSON.stringify(opts.body) : opts.body });
  const d = await r.json().catch(() => ({}));
  if (!r.ok) throw Object.assign(new Error(d.error || `Error ${r.status}`), { status: r.status });
  return d;
}
let STATE = null, PICK = null, PREVIEW = null;

async function boot() {
  const cfg = await api('/api/config');
  try { STATE = await api('/api/admin/state'); showDash(); }
  catch (e) {
    $('#login').hidden = false;
    if (!cfg.adminEnabled) { $('#loginNote').innerHTML = 'Admin is <b>disabled</b>. Set the <code>ADMIN_PASSWORD</code> environment variable and restart.'; $('#loginForm').hidden = true; }
  }
}
$('#loginForm').onsubmit = async (e) => {
  e.preventDefault(); $('#loginErr').textContent = '';
  try { await api('/api/admin/login', { method: 'POST', body: { password: e.target.password.value } }); STATE = await api('/api/admin/state'); $('#login').hidden = true; showDash(); }
  catch (err) { $('#loginErr').textContent = err.message; }
};
$('#logout').onclick = async () => { await api('/api/admin/logout', { method: 'POST' }); location.reload(); };

function showDash() {
  $('#dash').hidden = false; $('#logout').hidden = false;
  $('#who').textContent = `Catalog: ${STATE.mode === 'demo' ? 'demo (no TMDB key)' : 'TMDB'} · Store: ${STATE.backend}`;
  $('#ytNote').innerHTML = STATE.hasYouTubeKey ? '' : 'Tip: without <code>YOUTUBE_API_KEY</code>, YouTube imports only see the latest ~15 videos of a playlist/channel.';
  renderAll();
}
$('#subFile').onchange = async (e) => {
  const f = e.target.files[0]; e.target.value = ''; if (!f) return;
  if (!PICK) { toast('Pick a title first'); return; }
  try {
    const r = await api('/api/admin/subs', { method: 'POST', body: { type: PICK.media_type, id: PICK.id, season: $('#season').value, episode: $('#episode').value, lang: $('#subLang').value, label: $('#subLabel').value, filename: f.name, content: await f.text() } });
    toast(`Subtitles saved (${r.cues} cues) → ${r.key}`); refresh();
  } catch (err) { toast(err.message); }
};
function renderSubs() {
  $('#subTable').innerHTML = (STATE.subs || []).map((t) => `<div class="tr" style="grid-template-columns:1fr 90px 90px"><div><b>${esc(t.title)}</b><span class="dim small">${esc(t.key)}</span></div><span class="pv">${esc(t.lang)} · ${esc(t.label)}</span><div><a class="mini" href="/api/subs/${esc(t.sid)}.vtt" target="_blank" style="display:inline-grid;place-items:center">VTT</a> <button data-sdel="${esc(t.sid)}">×</button></div></div>`).join('') || '<p class="dim">No subtitle tracks yet.</p>';
  $$('[data-sdel]').forEach((b) => (b.onclick = async () => { await api(`/api/admin/subs/${b.dataset.sdel}`, { method: 'DELETE' }); refresh(); }));
}
async function savePatterns(movie, tv) {
  $('#patErr').textContent = '';
  try { await api('/api/admin/patterns', { method: 'PUT', body: { movie, tv } }); toast('Patterns saved'); refresh(); }
  catch (err) { $('#patErr').textContent = err.message; }
}
$('#patSave').onclick = () => savePatterns($('#patMovie').value, $('#patTv').value);
$('#patClear').onclick = () => { $('#patMovie').value = ''; $('#patTv').value = ''; savePatterns('', ''); };
$('#chAdd').onclick = async () => {
  $('#chErr').textContent = '';
  try { await api('/api/admin/channels', { method: 'POST', body: { name: $('#chName').value, category: $('#chCat').value, url: $('#chUrl').value } }); $('#chName').value = $('#chUrl').value = ''; toast('Channel added'); refresh(); }
  catch (err) { $('#chErr').textContent = err.message; }
};
function renderChannels() {
  $('#chTable').innerHTML = (STATE.channels || []).map((c) => `<div class="tr" style="grid-template-columns:1fr 1fr 60px"><div><b>${esc(c.name)}</b><span class="dim small">${esc(c.category)}</span></div><span class="u">${esc(c.url)}</span><button data-chdel="${esc(c.id)}">×</button></div>`).join('') || '<p class="dim small">No custom channels yet (curated defaults always show).</p>';
  $$('[data-chdel]').forEach((b) => (b.onclick = async () => { await api(`/api/admin/channels/${b.dataset.chdel}`, { method: 'DELETE' }); refresh(); }));
}
function renderAll() {
  renderChannels();
  if (document.activeElement?.id !== 'patMovie') $('#patMovie').value = STATE.patterns?.movie || '';
  if (document.activeElement?.id !== 'patTv') $('#patTv').value = STATE.patterns?.tv || '';
  const titles = new Set(STATE.sources.map((s) => s.key.split(':').slice(0, 2).join(':')));
  $('#stats').innerHTML = [[STATE.sources.length, 'Playable sources'], [titles.size, 'Titles with video'], [STATE.unmatched.length, 'Unmatched'], [STATE.jobs.length, 'Import jobs']]
    .map(([n, l]) => `<div class="stat"><b>${n}</b><span>${l}</span></div>`).join('');
  renderSources(); renderSubs(); renderUnmatched(); renderJobs();
}
async function refresh() { STATE = await api('/api/admin/state'); renderAll(); }

// ---- add video ----
let lt;
$('#lookupQ').oninput = (e) => {
  clearTimeout(lt); const q = e.target.value.trim();
  if (q.length < 2) { $('#lookupRes').innerHTML = ''; return; }
  lt = setTimeout(async () => {
    try {
      const d = await api(`/api/admin/lookup?q=${encodeURIComponent(q)}`);
      $('#lookupRes').innerHTML = d.results.slice(0, 10).map((c, i) => `<button class="res" data-i="${i}"><img src="${esc(c.poster || '')}" alt=""><div><b>${esc(c.title)}</b><span>${c.media_type === 'tv' ? 'Series' : 'Movie'}${c.year ? ' · ' + c.year : ''} · TMDB ${c.id}</span></div></button>`).join('') || '<div class="res dim">No matches</div>';
      $$('#lookupRes .res[data-i]').forEach((b) => (b.onclick = () => pick(d.results[+b.dataset.i])));
    } catch (err) { $('#lookupRes').innerHTML = `<div class="res err">${esc(err.message)}</div>`; }
  }, 300);
};
function pick(c) {
  PICK = c; $('#lookupRes').innerHTML = ''; $('#lookupQ').value = '';
  $('#picked').innerHTML = `<img src="${esc(c.poster || '')}" alt=""><div><b>${esc(c.title)}</b><span>${c.media_type === 'tv' ? 'Series' : 'Movie'}${c.year ? ' · ' + c.year : ''} · TMDB id ${c.id}</span></div>`;
  $('#epFields').hidden = c.media_type !== 'tv'; checkAdd();
}
let vt, VALID = false;
$('#srcUrl').oninput = () => {
  clearTimeout(vt); VALID = false; checkAdd();
  const v = $('#srcUrl').value.trim(); if (!v) { $('#validate').innerHTML = ''; return; }
  vt = setTimeout(async () => {
    try { const d = await api('/api/admin/validate', { method: 'POST', body: { url: v } }); VALID = true; $('#validate').innerHTML = `<span class="ok">${esc(d.providerName)} source recognised</span> <span class="dim">→ ${esc(d.player.src.slice(0, 90))}</span>`; }
    catch (err) { $('#validate').innerHTML = `<span class="err">${esc(err.message)}</span>`; }
    checkAdd();
  }, 250);
};
const checkAdd = () => ($('#addBtn').disabled = !(PICK && VALID));
$('#addBtn').onclick = async () => {
  $('#addErr').textContent = '';
  try {
    const r = await api('/api/admin/sources', { method: 'POST', body: { url: $('#srcUrl').value, type: PICK.media_type, id: PICK.id, season: $('#season').value, episode: $('#episode').value, label: $('#srcLabel').value } });
    toast(`Saved to ${r.key}`); $('#srcUrl').value = ''; $('#srcLabel').value = ''; $('#validate').innerHTML = ''; VALID = false; checkAdd(); refresh();
  } catch (err) { $('#addErr').textContent = err.message; }
};

// ---- sources table ----
$('#srcFilter').oninput = renderSources;
function renderSources() {
  const f = $('#srcFilter').value.toLowerCase();
  const list = STATE.sources.filter((s) => !f || JSON.stringify(s).toLowerCase().includes(f));
  $('#srcCount').textContent = `(${STATE.sources.length})`;
  $('#srcTable').innerHTML = list.slice(0, 400).map((s) => {
    const [t, id, ep] = s.key.split(':');
    return `<div class="tr"><img src="${esc(s.title?.poster || '')}" alt=""><div><b>${esc(s.title?.title || `${t} ${id}`)}${ep ? ` · ${esc(ep.toUpperCase())}` : ''}</b><span class="dim">${t === 'tv' ? 'Series' : 'Movie'} · TMDB ${esc(id)}${s.label ? ' · ' + esc(s.label) : ''}</span></div>
      <div class="u hide-sm"><a href="${esc(s.url)}" target="_blank" rel="noopener">${esc(s.url)}</a></div><div class="hide-sm"><span class="pv">${esc(s.provider)}</span><div class="dim small">${esc(s.origin)}</div></div>
      <div><a class="mini" href="/watch/${t}/${id}${ep ? `?s=${parseInt(ep.slice(1))}&e=${ep.split('e')[1]}` : ''}" target="_blank" style="display:inline-grid;place-items:center">▶</a> <button data-del="${esc(s.sid)}">Remove</button></div></div>`;
  }).join('') || '<p class="dim">No sources yet. Add one above or run an import.</p>';
  $$('[data-del]').forEach((b) => (b.onclick = async () => { if (!confirm('Remove this source?')) return; await api(`/api/admin/sources/${b.dataset.del}`, { method: 'DELETE' }); refresh(); }));
}

// ---- import ----
$('#seedIA').onclick = () => { $('#impUrl').value = 'https://archive.org/details/feature_films'; $('#impType').value = 'movie'; $('#impLimit').value = 100; runPreview(); };
$('#impBtn').onclick = runPreview;
async function runPreview() {
  $('#impErr').textContent = ''; $('#impOut').innerHTML = '<p class="dim" style="margin-top:14px">Fetching videos and matching to the catalog… (large imports can take a minute)</p>';
  $('#impBtn').disabled = true;
  try {
    PREVIEW = await api('/api/admin/import/preview', { method: 'POST', body: { url: $('#impUrl').value, limit: +$('#impLimit').value, type: $('#impType').value } });
    renderPreview();
  } catch (err) { $('#impErr').textContent = err.message; $('#impOut').innerHTML = ''; }
  $('#impBtn').disabled = false;
}
function renderPreview() {
  const P = PREVIEW;
  $('#impOut').innerHTML = `<div class="imp-head"><b>${P.count} videos · ${P.matched} matched</b><div class="btns" style="margin:0"><button class="mini" id="selM">Select matched</button><button class="mini" id="selN">None</button><button class="btn glow sm" id="commit" style="margin:0">Add selected</button></div></div>
    ${P.note ? `<p class="dim small">${esc(P.note)}</p>` : ''}
    <div class="imp-list">${P.results.map((r, i) => `<label class="imp-row"><input type="checkbox" data-i="${i}" ${r.match && r.match.score >= 0.75 ? 'checked' : ''} ${r.source ? '' : 'disabled'}>
      <img src="${esc(r.thumb || '')}" alt="" loading="lazy"><div><b>${esc(r.raw)}</b><div class="dim small">→ “${esc(r.parsed.title)}”${r.parsed.year ? ' (' + r.parsed.year + ')' : ''}${r.season != null ? ` S${r.season}E${r.episode}` : ''}</div>${r.error ? `<div class="no small">${esc(r.error)}</div>` : ''}</div>
      <div class="m">${r.match ? `<img src="${esc(r.match.poster || '')}" alt=""><div><b>${esc(r.match.title)}</b> <span class="dim">${r.match.year || ''} · ${r.match.media_type}</span> <span class="sc">${Math.round(r.match.score * 100)}%</span></div>` : '<span class="no">No match — will go to Unmatched</span>'}</div></label>`).join('')}</div>`;
  $('#selM').onclick = () => $$('#impOut [data-i]').forEach((c) => (c.checked = !!PREVIEW.results[+c.dataset.i].match));
  $('#selN').onclick = () => $$('#impOut [data-i]').forEach((c) => (c.checked = false));
  $('#commit').onclick = async () => {
    const rows = $$('#impOut [data-i]:checked').map((c) => PREVIEW.results[+c.dataset.i]);
    try {
      const r = await api('/api/admin/import/commit', { method: 'POST', body: { rows, saveJob: true, url: $('#impUrl').value, limit: +$('#impLimit').value, type: $('#impType').value, resync: $('#impResync').checked } });
      toast(`Added ${r.added} · ${r.duplicates} already present · ${r.unmatched} unmatched`); $('#impOut').innerHTML = ''; refresh();
    } catch (err) { $('#impErr').textContent = err.message; }
  };
}

// ---- unmatched + jobs ----
function renderUnmatched() {
  $('#unmatched').innerHTML = STATE.unmatched.slice(0, 200).map((u) => `<div class="tr" style="grid-template-columns:64px 1fr 190px"><img src="${esc(u.thumb || '')}" alt="" style="width:64px;height:36px"><div><b>${esc(u.raw)}</b><a class="u" href="${esc(u.ref)}" target="_blank" rel="noopener">${esc(u.ref)}</a></div>
    <div><input placeholder="TMDB id" data-uid="${u.uid}" style="height:32px;width:90px;display:inline-block"> <select data-ut="${u.uid}" style="height:32px;background:#0a0e17;color:#fff;border-radius:8px;border:1px solid rgba(255,255,255,.14)"><option value="movie">movie</option><option value="tv">tv</option></select> <button class="mini" data-assign="${u.uid}">Save</button> <button class="mini" data-dismiss="${u.uid}">×</button></div></div>`).join('') || '<p class="dim">Nothing unmatched 🎉</p>';
  $$('[data-assign]').forEach((b) => (b.onclick = async () => {
    const id = $(`[data-uid="${b.dataset.assign}"]`).value.trim(); if (!id) return;
    try { await api(`/api/admin/unmatched/${b.dataset.assign}/assign`, { method: 'POST', body: { id, type: $(`[data-ut="${b.dataset.assign}"]`).value } }); toast('Assigned'); refresh(); } catch (e) { toast(e.message); }
  }));
  $$('[data-dismiss]').forEach((b) => (b.onclick = async () => { await api(`/api/admin/unmatched/${b.dataset.dismiss}`, { method: 'DELETE' }); refresh(); }));
}
function renderJobs() {
  $('#jobs').innerHTML = STATE.jobs.map((j) => `<div class="tr" style="grid-template-columns:1fr auto"><div><b class="u" style="color:#fff">${esc(j.url)}</b><span class="dim small">limit ${j.limit} · last run ${j.lastRun ? new Date(j.lastRun).toLocaleString() : 'never'}${j.lastResult ? ` · +${j.lastResult.added ?? 0}${j.lastResult.error ? ' · ' + esc(j.lastResult.error) : ''}` : ''}</span></div>
    <div style="display:flex;gap:6px;align-items:center"><label class="check" style="height:30px;font-size:12px"><input type="checkbox" data-rs="${j.id}" ${j.resync ? 'checked' : ''}> daily</label><button class="mini" data-run="${j.id}">Run now</button><button class="mini" data-jdel="${j.id}">×</button></div></div>`).join('') || '<p class="dim">No saved imports yet.</p>';
  $$('[data-rs]').forEach((c) => (c.onchange = () => api(`/api/admin/jobs/${c.dataset.rs}`, { method: 'PATCH', body: { resync: c.checked } }).then(() => toast('Saved'))));
  $$('[data-run]').forEach((b) => (b.onclick = async () => { b.disabled = true; b.textContent = 'Running…'; try { const r = await api(`/api/admin/jobs/${b.dataset.run}/run`, { method: 'POST' }); toast(`+${r.added} new · ${r.unmatched} unmatched`); } catch (e) { toast(e.message); } refresh(); }));
  $$('[data-jdel]').forEach((b) => (b.onclick = async () => { await api(`/api/admin/jobs/${b.dataset.jdel}`, { method: 'DELETE' }); refresh(); }));
}
$('#restore').onchange = async (e) => {
  const f = e.target.files[0]; if (!f) return;
  try { const r = await api('/api/admin/restore', { method: 'POST', body: await f.text() }); toast(`Restored${r.skipped ? ` (${r.skipped} invalid sources skipped)` : ''}`); refresh(); } catch (err) { toast(err.message); }
};
boot();
