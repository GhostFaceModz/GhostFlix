// Admin → 📣 Promote tab: editable reward text for /promote and the full promoter list (clicks, watching, sign-ups, Discord).
const { $, esc, toast, api, F } = window.__gfAdmin;
const when = (iso) => (iso ? new Date(iso).toLocaleString([], { day: 'numeric', month: 'short', year: '2-digit', hour: '2-digit', minute: '2-digit' }) : '—');
async function loadPromo() {
  $('#prErr').textContent = '';
  let d; try { d = await api('/api/admin/promo'); } catch (e) { $('#prList').innerHTML = `<p class="err">${esc(e.message)}</p>`; return; }
  const inp = $('#prReward'); if (document.activeElement !== inp) inp.value = d.custom ? d.reward : '';
  inp.placeholder = d.defaultReward;
  const p = d.promoters || []; const tot = p.reduce((a, r) => ({ c: a.c + r.clicks, w: a.w + (r.watching || 0), s: a.s + r.signups }), { c: 0, w: 0, s: 0 });
  $('#prSum').textContent = `${p.length} promoter${p.length === 1 ? '' : 's'} · ${tot.c} clicks · ${tot.w} watching · ${tot.s} sign-ups · ranked by watching + sign-ups×${d.bonus || 3}`;
  $('#prList').innerHTML = d.error ? `<p class="err">${esc(d.error)}</p>` : p.length ? p.map((r) => `<div class="tr prow"><span class="pv">${r.rank ? `#${r.rank}` : '—'}</span><div><b>${esc(r.display_name || 'Viewer')}</b><span class="dim small">${r.discord_username ? `Discord @${esc(r.discord_username)}` : 'No Discord linked'}${r.discord_id ? ` · ID <span class="u">${esc(r.discord_id)}</span>` : ''}</span></div><div><b>${r.clicks}</b><span class="dim small">clicks</span></div><div><b>${r.watching || 0}</b><span class="dim small">watching</span></div><div><b>${r.signups}</b><span class="dim small">sign-ups</span></div><div class="dim small">code <b>${esc(r.code)}</b>last sign-up ${when(r.last_signup)}</div></div>`).join('') : '<p class="dim small">Nobody has created a referral link yet.</p>';
}
async function saveReward(text) {
  try { const r = await api('/api/admin/promo', { method: 'PUT', body: { reward: text } }); toast('Reward text saved'); $('#prReward').value = text ? r.reward : ''; } catch (e) { $('#prErr').textContent = e.message; }
}
$('#prSave').onclick = () => saveReward($('#prReward').value.trim());
$('#prDefault').onclick = () => saveReward('');
$('#prRefresh').onclick = loadPromo;
const prev = F.onTab; F.onTab = (t) => { prev?.(t); if (t === 'promote') loadPromo(); };
