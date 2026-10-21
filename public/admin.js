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
  renderAll(); loadSite();
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
  $('#addErr').textContent = ''; $('#addBtn').disabled = true; progress('#addProg', 0, 1, `Saving source to ${PICK.title}…`, true);
  try {
    const r = await api('/api/admin/sources', { method: 'POST', body: { url: $('#srcUrl').value, type: PICK.media_type, id: PICK.id, season: $('#season').value, episode: $('#episode').value, label: $('#srcLabel').value } });
    progress('#addProg', 1, 1, `Saved ✓ ${r.key}`); setTimeout(() => ($('#addProg').hidden = true), 2500);
    toast(`Saved to ${r.key}`); $('#srcUrl').value = ''; $('#srcLabel').value = ''; $('#validate').innerHTML = ''; VALID = false; checkAdd(); refresh();
  } catch (err) { $('#addErr').textContent = err.message; $('#addProg').hidden = true; checkAdd(); }
};

// ---- sources table ----
$('#srcFilter').oninput = renderSources;
function renderSources() {
  const f = $('#srcFilter').value.toLowerCase();
  const list = STATE.sources.filter((s) => !f || [s.title?.title, s.key, s.url, s.label, s.provider, s.origin].join(' ').toLowerCase().includes(f));
  $('#srcCount').textContent = `(${STATE.sources.length})`;
  $('#srcTable').innerHTML = list.slice(0, 400).map((s) => {
    const [t, id, ep] = s.key.split(':');
    return `<div class="tr"><img src="${esc(s.title?.poster || '')}" alt=""><div><b>${esc(s.title?.title || `${t} ${id}`)}${ep ? ` · ${esc(ep.toUpperCase())}` : ''}</b><span class="dim">${t === 'tv' ? 'Series' : 'Movie'} · TMDB ${esc(id)}${s.label ? ' · ' + esc(s.label) : ''}</span></div>
      <div class="u hide-sm"><a href="${esc(s.url)}" target="_blank" rel="noopener">${esc(s.url)}</a></div><div class="hide-sm"><span class="pv">${esc(s.provider)}</span><div class="dim small">${esc(s.origin)}</div></div>
      <div><a class="mini" href="/watch/${t}/${id}${ep ? `?s=${parseInt(ep.slice(1))}&e=${ep.split('e')[1]}` : ''}" target="_blank" style="display:inline-grid;place-items:center">▶</a> <button data-edit="${esc(s.sid)}">Edit</button> <button data-del="${esc(s.sid)}">Delete</button></div></div>`;
  }).join('') || '<p class="dim">No sources yet. Add one above or run an import.</p>';
  $$('[data-edit]').forEach((b) => (b.onclick = () => editSource(b)));
  $$('[data-del]').forEach((b) => (b.onclick = async () => { if (!confirm('Delete this embed from the title? This can’t be undone.')) return; await api(`/api/admin/sources/${b.dataset.del}`, { method: 'DELETE' }); refresh(); }));
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

function editSource(btn) {
  const s = STATE.sources.find((x) => x.sid === btn.dataset.edit); if (!s) return;
  const tr = btn.closest('.tr'); const div = document.createElement('div'); div.className = 'tr edit';
  div.innerHTML = `<div class="ed"><b>${esc(s.title?.title || s.key)}</b><label>Embed / video link</label><input data-f="url" value="${esc(s.url)}"><label>Label</label><input data-f="label" value="${esc(s.label || '')}" maxlength="80">
    <div class="btns"><button class="btn glow sm" data-save type="button">Save</button><button class="btn ghost sm" data-cancel type="button">Cancel</button></div><p class="err"></p></div>`;
  tr.replaceWith(div);
  $('[data-cancel]', div).onclick = renderSources;
  $('[data-save]', div).onclick = async () => {
    try { await api(`/api/admin/sources/${s.sid}`, { method: 'PATCH', body: { url: $('[data-f=url]', div).value, label: $('[data-f=label]', div).value } }); toast('Saved'); refresh(); }
    catch (e) { $('.err', div).textContent = e.message; }
  };
}

// ---- progress indicator ----
function progress(sel, done, total, text, indeterminate = false) {
  const box = $(sel); box.hidden = false; box.classList.toggle('ind', indeterminate);
  $('.bar i', box).style.width = indeterminate ? '' : `${Math.round((done / Math.max(1, total)) * 100)}%`;
  $('.pt', box).textContent = text;
}

// ---- bulk add: drag & drop / paste ----
const URL_RE = /https?:\/\/[^\s,;"'<>]+/gi;
const TMDB_RE = /themoviedb\.org\/(movie|tv)\/(\d+)[^/\s]*(?:\/season\/(\d+)(?:\/episode\/(\d+))?)?/i;
function inferFromEmbed(u) {
  try {
    const x = new URL(u); const q = x.searchParams;
    const tm = q.get('tmdb') || q.get('tmdb_id') || q.get('id');
    const m = x.pathname.match(/\/(movie|tv)\/(\d+)(?:[/-](\d+)[/-](\d+))?(?:\/|$)/i);
    if (m) return { type: m[1].toLowerCase(), id: +m[2], season: m[3] ? +m[3] : (q.get('s') || q.get('season') || null), episode: m[4] ? +m[4] : (q.get('e') || q.get('episode') || null) };
    const t = (x.pathname.match(/\b(movie|tv)\b/i) || [])[1];
    if (t && /^\d+$/.test(tm || '')) return { type: t.toLowerCase(), id: +tm, season: q.get('s') || q.get('season'), episode: q.get('e') || q.get('episode') };
  } catch {}
  return null;
}
function parseLine(line) {
  const raw = line.trim(); const item = { raw };
  const iframe = raw.match(/<iframe[^>]+src=["']([^"']+)/i);
  const urls = iframe ? [iframe[1]] : (raw.match(URL_RE) || []).map((u) => u.replace(/[).\]]+$/, ''));
  const tmdbUrl = urls.find((u) => TMDB_RE.test(u)); const embed = urls.find((u) => u !== tmdbUrl);
  const tm = tmdbUrl && tmdbUrl.match(TMDB_RE);
  if (tm) Object.assign(item, { type: tm[1].toLowerCase(), id: +tm[2], season: tm[3] ? +tm[3] : null, episode: tm[4] ? +tm[4] : null });
  const cells = raw.split(/\t|,|;/).map((c) => c.trim());
  const pre = raw.match(/^(movie|tv)\s*[:,\s]\s*(\d+)(?:\s*[:,\s]\s*(\d*))?(?:\s*[:,\s]\s*(\d*))?/i);
  if (!item.id && pre) Object.assign(item, { type: pre[1].toLowerCase(), id: +pre[2], season: pre[3] ? +pre[3] : null, episode: pre[4] ? +pre[4] : null });
  if (!item.id && embed) { const g = inferFromEmbed(embed); if (g) Object.assign(item, g); }
  if (embed) item.url = embed;
  // label: last CSV cell that isn't a URL/number/type, or trailing text after the URL
  const lab = cells.slice(1).reverse().find((c) => c && !/^https?:/i.test(c) && !/^\d*$/.test(c) && !/^(movie|tv)$/i.test(c));
  const tail = embed && raw.split(embed)[1]?.replace(/^[\s,;|]+/, '').trim();
  item.label = (lab && cells.length > 2 ? lab : tail && !URL_RE.test(tail) ? tail : '') || '';
  URL_RE.lastIndex = 0;
  return item;
}
function parseList(text, name = '') {
  const t = String(text || '').trim(); if (!t) return [];
  if (/\.json$/i.test(name) || /^[[{]/.test(t)) {
    try {
      let d = JSON.parse(t); if (!Array.isArray(d)) d = d.items || d.titles || d.sources || [d];
      return d.map((o) => typeof o === 'string' ? parseLine(o) : {
        raw: JSON.stringify(o).slice(0, 140), type: String(o.type || o.media_type || '').toLowerCase() || (o.url ? inferFromEmbed(o.url)?.type : ''), id: +(o.id || o.tmdb_id || o.tmdb || (o.url ? inferFromEmbed(o.url)?.id : 0)) || null,
        season: o.season ?? o.s ?? null, episode: o.episode ?? o.e ?? null, url: o.url || o.embed || o.link || '', label: o.label || '',
      });
    } catch (e) { return [{ raw: name || 'JSON', error: `Invalid JSON: ${e.message}` }]; }
  }
  return t.split(/\r?\n/).filter((l) => l.trim() && !/^\s*#/.test(l) && !/^\s*type\s*[,;\t]/i.test(l)).map(parseLine);
}
function finalize(it) {
  if (it.error) return it;
  if (!it.url) return { ...it, error: it.id ? 'No video/embed link on this line' : 'No link found' };
  if (!it.id) {
    if (PICK) return { ...it, type: PICK.media_type, id: PICK.id, title: PICK.title, season: it.season ?? ($('#season').value || null), episode: it.episode ?? ($('#episode').value || null) };
    return { ...it, error: 'No TMDB title — add a TMDB URL / “movie,ID” prefix, or pick a title above' };
  }
  if (it.type !== 'movie' && it.type !== 'tv') return { ...it, error: 'Unknown type (movie or tv)' };
  return it;
}
let LAST_BATCH = [];
async function runBulk(items) {
  items = items.map(finalize); const total = items.length; if (!total) { toast('Nothing to add'); return; }
  const res = $('#bulkRes'); res.innerHTML = items.map((it, i) => `<li data-r="${i}" class="${it.error ? 'no' : 'wait'}"><span class="st">${it.error ? '✗' : '…'}</span> <span class="what">${esc(it.title || (it.id ? `${it.type} ${it.id}${it.season ? ` S${it.season}E${it.episode || '?'}` : ''}` : it.raw.slice(0, 80)))}</span> <span class="msg dim small">${esc(it.error || 'queued')}</span></li>`).join('');
  $('#bulkBtn').disabled = true; LAST_BATCH = []; let ok = 0, fail = 0, done = 0;
  for (const [i, it] of items.entries()) {
    const li = $(`[data-r="${i}"]`, res);
    if (!it.error) {
      progress('#bulkProg', done, total, `Adding ${done + 1} of ${total}…`); li.className = 'busy'; $('.msg', li).textContent = 'adding…';
      try {
        const r = await api('/api/admin/sources', { method: 'POST', body: { url: it.url, type: it.type, id: it.id, season: it.type === 'tv' ? it.season ?? '' : '', episode: it.type === 'tv' ? it.episode ?? '' : '', label: it.label || '' } });
        LAST_BATCH.push(r.source.sid); ok++; li.className = 'ok'; $('.st', li).textContent = '✓'; $('.msg', li).textContent = `saved → ${r.key}`;
      } catch (e) { fail++; li.className = 'no'; $('.st', li).textContent = '✗'; $('.msg', li).textContent = e.message; }
    } else fail++;
    done++; progress('#bulkProg', done, total, `${done} of ${total} processed · ${ok} added · ${fail} failed`);
  }
  progress('#bulkProg', total, total, `Done: ${ok} added · ${fail} failed (of ${total})`);
  $('#bulkBtn').disabled = false; $('#bulkUndo').hidden = !LAST_BATCH.length; if (ok) refresh();
}
$('#bulkUndo').onclick = async () => {
  if (!LAST_BATCH.length || !confirm(`Remove the ${LAST_BATCH.length} source(s) added in this batch?`)) return;
  let n = 0; for (const sid of LAST_BATCH) { progress('#bulkProg', n, LAST_BATCH.length, `Removing ${n + 1} of ${LAST_BATCH.length}…`); try { await api(`/api/admin/sources/${sid}`, { method: 'DELETE' }); } catch {} n++; }
  progress('#bulkProg', n, n, `Removed ${n} source(s)`); LAST_BATCH = []; $('#bulkUndo').hidden = true; $('#bulkRes').innerHTML = ''; refresh();
};
$('#bulkBtn').onclick = () => runBulk(parseList($('#bulkText').value));
const readFile = (f) => new Promise((resolve, reject) => {
  const r = new FileReader();
  r.onprogress = (e) => e.lengthComputable && progress('#bulkProg', e.loaded, e.total, `Reading ${f.name}… ${Math.round((e.loaded / e.total) * 100)}%`);
  r.onload = () => resolve(r.result); r.onerror = () => reject(r.error); r.readAsText(f);
});
async function handleDrop(dt) {
  let items = [];
  const files = [...(dt.files || [])];
  for (const f of files) {
    if (/^video\//.test(f.type) || /\.(mp4|mkv|webm|mov|avi|m4v|ts)$/i.test(f.name)) { items.push({ raw: f.name, error: 'Video file uploads aren’t supported — host the file and drop its link' }); continue; }
    if (!/\.(txt|csv|tsv|json)$/i.test(f.name) && !/^(text\/|application\/json)/.test(f.type)) { items.push({ raw: f.name, error: 'Unsupported file type (use .txt, .csv or .json)' }); continue; }
    if (f.size > 2e6) { items.push({ raw: f.name, error: 'File too large (max 2 MB)' }); continue; }
    try { items = items.concat(parseList(await readFile(f), f.name)); } catch (e) { items.push({ raw: f.name, error: `Couldn’t read file: ${e.message}` }); }
  }
  if (!files.length) items = parseList(dt.getData('text/uri-list') && !dt.getData('text/plain') ? dt.getData('text/uri-list') : dt.getData('text/plain') || dt.getData('text/uri-list'));
  // A single bare TMDB link: just pick that title in the form.
  if (items.length === 1 && items[0].id && !items[0].url && !items[0].error) {
    try { const d = await api(`/api/admin/lookup?q=${items[0].id}`); const c = d.results.find((x) => x.media_type === items[0].type); if (c) { pick(c); toast(`Picked ${c.title}`); return; } } catch {}
  }
  runBulk(items);
}
const dz = $('#dropZone');
['dragenter', 'dragover'].forEach((ev) => dz.addEventListener(ev, (e) => { e.preventDefault(); dz.classList.add('over'); }));
['dragleave', 'drop'].forEach((ev) => dz.addEventListener(ev, () => dz.classList.remove('over')));
dz.addEventListener('drop', (e) => { e.preventDefault(); handleDrop(e.dataTransfer); });
dz.addEventListener('click', () => $('#dropFile').click());
dz.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); $('#dropFile').click(); } });
$('#dropFile').onchange = (e) => { const files = [...e.target.files]; e.target.value = ''; if (files.length) handleDrop({ files, getData: () => '' }); };
// don't let a stray drop elsewhere navigate away from the admin
['dragover', 'drop'].forEach((ev) => window.addEventListener(ev, (e) => { if (!dz.contains(e.target)) e.preventDefault(); }));

// ---- site controls ----
let SITE = null, HERO = null;
const SECTION_NAMES = { discover: 'Discover', live: 'Live TV', genres: 'Genres', mylist: 'My List' };
async function loadSite() {
  try { SITE = await api('/api/admin/site'); } catch (e) { $('#siteErr').textContent = e.message; return; }
  const s = SITE.site;
  $('#anText').value = s.announcement.text; $('#anOn').checked = s.announcement.on; $('#anColor').value = s.announcement.color || '#5fe3ff';
  $('#maintOn').checked = s.maintenance; HERO = s.hero; renderHero();
  $('#secChecks').innerHTML = SITE.sectionKeys.map((k) => `<label class="check"><input type="checkbox" data-sec="${k}" ${s.sections[k] ? 'checked' : ''}> ${SECTION_NAMES[k] || k}</label>`).join('') + '<p class="dim small">There’s no Downloads section on GhostFlix yet, so there’s nothing to toggle for it.</p>';
  $('#rowChecks').innerHTML = SITE.rows.map((r) => `<label class="check"><input type="checkbox" data-row="${esc(r.id)}" ${s.rows[r.id] === false ? '' : 'checked'}> ${esc(r.title)}</label>`).join('') || '<p class="dim small">No rows</p>';
  const st = SITE.stats; const base = $('#stats');
  base.querySelector('.stat.users')?.remove();
  if (st.users != null) base.insertAdjacentHTML('beforeend', `<div class="stat users"><b>${st.users}</b><span>Signed-up users</span></div>`);
}
function renderHero() {
  $('#heroPicked').innerHTML = HERO ? `<div><b>${esc(HERO.title || `${HERO.type} ${HERO.id}`)}</b><span>${HERO.type === 'tv' ? 'Series' : 'Movie'} · TMDB ${HERO.id} · pinned as the first home hero</span></div>` : '<span class="dim">Auto (trending titles rotate)</span>';
}
let ht;
$('#heroQ').oninput = (e) => {
  clearTimeout(ht); const q = e.target.value.trim(); if (q.length < 2) { $('#heroRes').innerHTML = ''; return; }
  ht = setTimeout(async () => {
    try {
      const d = await api(`/api/admin/lookup?q=${encodeURIComponent(q)}`);
      $('#heroRes').innerHTML = d.results.slice(0, 8).map((c, i) => `<button class="res" data-h="${i}" type="button"><img src="${esc(c.poster || '')}" alt=""><div><b>${esc(c.title)}</b><span>${c.media_type === 'tv' ? 'Series' : 'Movie'}${c.year ? ' · ' + c.year : ''} · TMDB ${c.id}</span></div></button>`).join('') || '<div class="res dim">No matches</div>';
      $$('#heroRes [data-h]').forEach((b) => (b.onclick = () => { const c = d.results[+b.dataset.h]; HERO = { type: c.media_type, id: c.id, title: c.title }; $('#heroRes').innerHTML = ''; $('#heroQ').value = ''; renderHero(); }));
    } catch (err) { $('#heroRes').innerHTML = `<div class="res err">${esc(err.message)}</div>`; }
  }, 300);
};
$('#heroAuto').onclick = () => { HERO = null; renderHero(); };
async function saveSite(body) {
  $('#siteErr').textContent = '';
  try { await api('/api/admin/site', { method: 'PUT', body }); toast('Site settings saved'); await loadSite(); }
  catch (e) { $('#siteErr').textContent = e.message; }
}
$('#siteSave').onclick = () => {
  const m = $('#maintOn').checked;
  if (m && !SITE.site.maintenance && !confirm('Turn on maintenance mode? Visitors will only see a “back soon” page.')) return;
  saveSite({
    announcement: { on: $('#anOn').checked, text: $('#anText').value, color: $('#anColor').value }, hero: HERO, maintenance: m,
    sections: Object.fromEntries($$('[data-sec]').map((c) => [c.dataset.sec, c.checked])), rows: Object.fromEntries($$('[data-row]').map((c) => [c.dataset.row, c.checked])),
  });
};
$('#siteReset').onclick = () => { if (confirm('Reset site settings to defaults (no banner, auto hero, all sections and rows on, maintenance off)?')) saveSite({ announcement: { on: false, text: '', color: '#5fe3ff' }, hero: null, maintenance: false, sections: {}, rows: {} }); };

boot();
