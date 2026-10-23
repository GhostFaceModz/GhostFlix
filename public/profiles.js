// Viewer profiles ("Who's watching?"): up to 5 per signed-in account, one local profile when signed out.
// Each profile keeps its own My List, Continue watching/resume, ratings, episode log and reminders. The first profile
// ('main') uses the original storage keys and the original Supabase tables; other profiles use gf.p.<id>.* locally and
// ghostflix_profile_data (one JSON blob per kind) in Supabase. Kids profiles have an age limit and a 4-digit PIN to leave.
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const KEY = 'gf.profiles';
export const MAX_PROFILES = 5;
export const COLORS = ['#5fe3ff', '#ff5a7a', '#3ddc84', '#f5c518', '#a78bfa', '#ff9f43', '#60a5fa', '#f472b6'];
export const AGES = [[0, 'U / G — all ages'], [8, 'PG / TV-PG'], [14, '12A / PG-13 / TV-14'], [15, '15']];
export const SCOPED = new Set(['list', 'continue', 'eps', 'remind', 'ratings']);
const DEF = () => ({ id: 'main', name: 'Me', color: COLORS[0], kids: false, max_age: null, pin_hash: null, position: 0 });
const read = () => { try { const s = JSON.parse(localStorage.getItem(KEY)); if (s?.list?.length) return s; } catch {} return { list: [DEF()], active: 'main', uid: null }; };
const write = (s) => { try { localStorage.setItem(KEY, JSON.stringify(s)); } catch {} };
export const Profiles = {
  all: () => read().list,
  active() { const s = read(); return s.list.find((p) => p.id === s.active) || s.list[0]; },
  kidsAge() { const p = Profiles.active(); return p.kids ? (p.max_age ?? 8) : null; },
};
/** localStorage key for a storage kind in a profile. */
export const lsKey = (k, pid = Profiles.active().id) => (SCOPED.has(k) && pid !== 'main' ? `gf.p.${pid}.${k}` : 'gf.' + k);
const stampKey = (pid, k) => `gf.ps.${pid}.${k}`;
export const ageLabel = (a) => (AGES.find((x) => x[0] === a) || AGES[1])[1];
const pinHash = async (pid, pin) => [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`ghostflix-pin:${pid}:${pin}`)))].map((b) => b.toString(16).padStart(2, '0')).join('');
const newId = () => Math.random().toString(36).slice(2, 10).replace(/[^a-z0-9]/g, 'x') || 'p' + Date.now();
export const avatarHTML = (p, size = 0) => `<span class="pav${p.kids ? ' kids' : ''}" style="--pc:${esc(p.color)}${size ? `;--ps:${size}px` : ''}" aria-hidden="true">${esc((p.name || '?').trim()[0]?.toUpperCase() || '?')}</span>`;

export function createProfiles({ auth, toast, onSwitch }) {
  const kindsOf = (pid) => (pid === 'main' ? ['ratings', 'eps', 'remind'] : ['list', 'continue', 'ratings', 'eps', 'remind']);
  const T = 'ghostflix_profiles', D = 'ghostflix_profile_data';
  let tableOk = true;
  const missing = (e) => e && (e.code === '42P01' || e.code === 'PGRST205' || /does not exist|schema cache/i.test(e.message || ''));
  const sb = async () => (auth?.user && tableOk ? auth.client() : null);
  const row = (p, uid) => ({ user_id: uid, id: p.id, name: p.name, color: p.color, kids: !!p.kids, max_age: p.kids ? (p.max_age ?? 8) : null, pin_hash: p.kids ? p.pin_hash : null, position: p.position || 0, updated_at: new Date().toISOString() });

  // ---- data sync (non-main kinds) ----
  const timers = {};
  function touched(k) {
    const pid = Profiles.active().id; if (!SCOPED.has(k) || !kindsOf(pid).includes(k)) return;
    try { localStorage.setItem(stampKey(pid, k), String(Date.now())); } catch {}
    if (!auth?.user) return;
    clearTimeout(timers[pid + k]); timers[pid + k] = setTimeout(() => push(pid, k), 2500);
  }
  async function push(pid, k) {
    const c = await sb(); if (!c) return;
    let data; try { data = JSON.parse(localStorage.getItem(lsKey(k, pid))); } catch {} if (data == null) data = k === 'eps' || k === 'ratings' ? {} : [];
    const at = +localStorage.getItem(stampKey(pid, k)) || Date.now();
    const { error } = await c.from(D).upsert({ user_id: auth.user.id, profile_id: pid, kind: k, data, updated_at: new Date(at).toISOString() });
    if (error && missing(error)) tableOk = false;
  }
  async function pullData(pid) {
    const c = await sb(); if (!c) return false;
    const { data, error } = await c.from(D).select('kind,data,updated_at').eq('profile_id', pid);
    if (error) { if (missing(error)) tableOk = false; return false; }
    let changed = false;
    for (const k of kindsOf(pid)) {
      const r = data.find((x) => x.kind === k); const local = +localStorage.getItem(stampKey(pid, k)) || 0; const remote = r ? Date.parse(r.updated_at) : 0;
      if (r && remote > local) { try { localStorage.setItem(lsKey(k, pid), JSON.stringify(r.data)); localStorage.setItem(stampKey(pid, k), String(remote)); } catch {} changed = true; }
      else if (local > remote && localStorage.getItem(lsKey(k, pid)) != null) await push(pid, k);
    }
    return changed;
  }

  // ---- profiles sync ----
  async function loadRemote() {
    const c = await sb(); if (!c) return;
    const uid = auth.user.id;
    const { data, error } = await c.from(T).select('id,name,color,kids,max_age,pin_hash,position').order('position');
    if (error) { if (missing(error)) tableOk = false; return; }
    const s = read();
    if (!data.length) {
      const first = auth.meta?.().name?.split(/\s+/)[0];
      const list = s.list.slice(0, 1).map((p) => ({ ...p, id: 'main', name: p.name === 'Me' && first ? first.slice(0, 24) : p.name }));
      await c.from(T).upsert(list.map((p) => row(p, uid)));
      write({ list, active: 'main', uid });
    } else {
      const list = data.map((p) => ({ ...p, kids: !!p.kids }));
      const active = list.some((p) => p.id === s.active) && s.uid === uid ? s.active : (list.find((p) => p.id === s.active)?.id || 'main');
      write({ list, active: list.some((p) => p.id === active) ? active : list[0].id, uid });
    }
    apply();
    const changed = await pullData(Profiles.active().id);
    chip();
    if (read().list.length > 1 && !sessionStorage.getItem('gf.picked')) picker();
    else if (changed) onSwitch?.();
  }
  async function saveProfile(p) {
    const s = read(); const i = s.list.findIndex((x) => x.id === p.id);
    if (i < 0) { if (s.list.length >= MAX_PROFILES) throw new Error(`Up to ${MAX_PROFILES} profiles per account.`); p.position = Math.max(0, ...s.list.map((x) => x.position || 0)) + 1; s.list.push(p); } else s.list[i] = p;
    const c = await sb();
    if (c) { const { error } = await c.from(T).upsert(row(p, auth.user.id)); if (error) throw new Error(/5 profiles/.test(error.message) ? 'Up to 5 profiles per account.' : 'Couldn’t save the profile: ' + error.message); }
    write(s); apply(); chip();
  }
  async function removeProfile(id) {
    if (id === 'main') return;
    const s = read(); s.list = s.list.filter((x) => x.id !== id); if (s.active === id) s.active = 'main';
    const c = await sb();
    if (c) { await c.from(D).delete().eq('profile_id', id); const { error } = await c.from(T).delete().eq('id', id); if (error) throw new Error('Couldn’t delete: ' + error.message); }
    for (const k of SCOPED) { localStorage.removeItem(lsKey(k, id)); localStorage.removeItem(stampKey(id, k)); }
    write(s); apply(); chip();
  }

  // ---- PIN ----
  function askPin(p, title = `Enter ${p.name}’s PIN`) {
    return new Promise((resolve) => {
      if (!p.pin_hash) return resolve(true);
      const m = document.createElement('div'); m.className = 'authm open pinm'; m.setAttribute('role', 'dialog'); m.setAttribute('aria-modal', 'true'); m.setAttribute('aria-labelledby', 'pinH');
      m.innerHTML = `<form class="bx"><button class="x" type="button" aria-label="Close">×</button>${avatarHTML(p, 64)}<h2 id="pinH">${esc(title)}</h2><p>Kids profiles need the 4-digit PIN to leave.</p>
        <input class="pin-in" type="password" inputmode="numeric" pattern="[0-9]{4}" maxlength="4" autocomplete="off" aria-label="4-digit PIN" required><div class="er" role="alert"></div><button class="pb pd" type="submit">Unlock</button></form>`;
      const done = (v) => { m.remove(); resolve(v); };
      m.addEventListener('click', (e) => { if (e.target === m || e.target.closest('.x')) done(false); });
      m.addEventListener('keydown', (e) => { if (e.key === 'Escape') done(false); });
      const inp = m.querySelector('input');
      inp.addEventListener('input', () => { inp.value = inp.value.replace(/\D/g, '').slice(0, 4); if (inp.value.length === 4) m.querySelector('form').requestSubmit(); });
      m.querySelector('form').addEventListener('submit', async (e) => {
        e.preventDefault();
        if ((await pinHash(p.id, inp.value)) === p.pin_hash) return done(true);
        m.querySelector('.er').textContent = 'Wrong PIN — try again.'; inp.value = ''; inp.focus();
      });
      document.body.appendChild(m); setTimeout(() => inp.focus(), 30);
    });
  }
  const leaveKidsOk = async (to) => { const cur = Profiles.active(); if (!cur.kids || (to && to.kids && to.id === cur.id)) return true; if (to?.kids && (to.max_age ?? 8) <= (cur.max_age ?? 8)) return true; return askPin(cur); };

  // ---- switching ----
  async function switchTo(id) {
    const s = read(); const to = s.list.find((p) => p.id === id); if (!to) return false;
    if (s.active !== id && !(await leaveKidsOk(to))) return false;
    sessionStorage.setItem('gf.picked', '1');
    if (s.active !== id) { s.active = id; write(s); apply(); chip(); await pullData(id).catch(() => {}); toast(`Watching as ${to.name}`); }
    onSwitch?.(); return true;
  }
  function apply() {
    const p = Profiles.active(); const h = document.documentElement;
    if (p.kids) h.dataset.kids = String(p.max_age ?? 8); else delete h.dataset.kids;
  }
  function chip() {
    const acc = document.getElementById('account'); if (!acc) return;
    let b = document.getElementById('profChip');
    const p = Profiles.active(); const show = read().list.length > 1 || p.kids;
    if (!show) { b?.remove(); return; }
    if (!b) { b = document.createElement('button'); b.id = 'profChip'; b.type = 'button'; b.className = 'prof-chip'; acc.before(b); b.onclick = () => picker(); }
    b.innerHTML = `${avatarHTML(p)}${p.kids ? '<small>Kids</small>' : ''}`; b.setAttribute('aria-label', `Profile: ${p.name}${p.kids ? ' (kids)' : ''}. Switch profile`); b.title = `${p.name} — switch profile`;
  }
  function picker() {
    document.querySelector('.whos')?.remove();
    const s = read(); const m = document.createElement('div'); m.className = 'whos'; m.setAttribute('role', 'dialog'); m.setAttribute('aria-modal', 'true'); m.setAttribute('aria-labelledby', 'whosH');
    m.innerHTML = `<div class="whos-in"><img class="gh" src="/img/logo.svg" alt=""><h1 id="whosH">Who’s watching?</h1>
      <div class="whos-grid">${s.list.map((p) => `<button type="button" class="whos-p${p.id === s.active ? ' on' : ''}" data-pick="${esc(p.id)}">${avatarHTML(p, 104)}<b>${esc(p.name)}</b>${p.kids ? `<small>Kids · ${esc(ageLabel(p.max_age ?? 8).split(' ')[0])}</small>` : ''}</button>`).join('')}
      ${auth?.user && s.list.length < MAX_PROFILES && !Profiles.active().kids ? '<a class="whos-p add" href="/profiles?new=1" data-link data-close><span class="pav add" aria-hidden="true">+</span><b>Add profile</b></a>' : ''}</div>
      <a class="btn ghost sm" href="/profiles" data-link data-close>Manage profiles</a>${sessionStorage.getItem('gf.picked') ? '<button type="button" class="whos-x" aria-label="Close" data-close>×</button>' : ''}</div>`;
    m.addEventListener('click', async (e) => {
      const b = e.target.closest('[data-pick]'); if (b) { if (await switchTo(b.dataset.pick)) m.remove(); return; }
      if (e.target.closest('[data-close]')) { sessionStorage.setItem('gf.picked', '1'); m.remove(); }
    });
    m.addEventListener('keydown', (e) => { if (e.key === 'Escape' && sessionStorage.getItem('gf.picked')) m.remove(); });
    document.body.appendChild(m); setTimeout(() => m.querySelector('.whos-p.on, .whos-p')?.focus(), 30);
  }

  // ---- manage page (/profiles) ----
  async function renderManage(main, q) {
    const cur = Profiles.active();
    if (cur.kids && !(await askPin(cur, 'PIN needed to manage profiles'))) { history.replaceState({}, '', '/'); onSwitch?.(); return; }
    const s = read(); const signedIn = !!auth?.user;
    main.innerHTML = `<div class="page profiles-page"><h1>Profiles</h1><p class="lead">${signedIn ? `Up to ${MAX_PROFILES} profiles on your account. Each one keeps its own list, history, resume points and ratings.` : 'Signed out, this device has one local profile. <button class="linkbtn" type="button" data-signin>Sign in</button> to add up to 5 profiles that sync across devices.'}</p>
      <div class="prof-list">${s.list.map((p) => `<button type="button" class="prof-row" data-edit="${esc(p.id)}">${avatarHTML(p, 56)}<span><b>${esc(p.name)}</b><small>${p.kids ? `Kids profile · up to ${esc(ageLabel(p.max_age ?? 8))}${p.pin_hash ? ' · PIN set' : ''}` : p.id === s.active ? 'Watching now' : 'Standard profile'}</small></span><i>Edit</i></button>`).join('')}
      ${signedIn && s.list.length < MAX_PROFILES ? '<button type="button" class="prof-row add" data-edit="new"><span class="pav add" style="--ps:56px" aria-hidden="true">+</span><span><b>Add profile</b><small>' + (MAX_PROFILES - s.list.length) + ' left</small></span></button>' : ''}</div>
      ${s.list.length > 1 ? '<p style="margin-top:18px"><button class="btn dark sm" type="button" data-whos>Switch profile</button></p>' : ''}
      <div id="profEdit"></div></div>`;
    main.querySelector('[data-whos]')?.addEventListener('click', picker);
    main.querySelectorAll('[data-edit]').forEach((b) => (b.onclick = () => editor(main, b.dataset.edit)));
    if (q?.get('new') && signedIn && s.list.length < MAX_PROFILES) editor(main, 'new');
  }
  function editor(main, id) {
    const s = read(); const isNew = id === 'new';
    const p = isNew ? { id: newId(), name: '', color: COLORS[s.list.length % COLORS.length], kids: false, max_age: 8, pin_hash: null } : { ...s.list.find((x) => x.id === id) };
    const box = main.querySelector('#profEdit');
    box.innerHTML = `<form class="prof-ed set-group pad" novalidate><h2>${isNew ? 'Add profile' : 'Edit profile'}</h2>
      <div class="pe-top"><span class="pe-av">${avatarHTML(p, 72)}</span><label class="pe-f"><span>Name</span><input name="name" maxlength="24" required value="${esc(p.name)}" placeholder="e.g. Sam"></label></div>
      <fieldset class="pe-colors"><legend>Avatar colour</legend>${COLORS.map((c) => `<label><input type="radio" name="color" value="${c}"${c === p.color ? ' checked' : ''}><span style="--pc:${c}" aria-label="${c}"></span></label>`).join('')}</fieldset>
      <label class="pe-sw"><input type="checkbox" name="kids"${p.kids ? ' checked' : ''}><span><b>Kids profile</b><small>Only shows titles rated at or below the limit (UK BBFC rating first, then US). Titles without a rating are hidden. Live TV is turned off.</small></span></label>
      <div class="pe-kids"${p.kids ? '' : ' hidden'}><label class="pe-f"><span>Maximum rating</span><select name="max_age">${AGES.map(([a, l]) => `<option value="${a}"${(p.max_age ?? 8) === a ? ' selected' : ''}>${l}</option>`).join('')}</select></label>
        <label class="pe-f"><span>${p.pin_hash ? 'New 4-digit PIN (leave empty to keep)' : '4-digit PIN to leave this profile'}</span><input name="pin" type="password" inputmode="numeric" pattern="[0-9]{4}" maxlength="4" autocomplete="new-password"></label></div>
      <div class="er" role="alert"></div>
      <div class="pe-btns"><button class="btn cta sm" type="submit">${isNew ? 'Create profile' : 'Save'}</button><button class="btn dark sm" type="button" data-cancel>Cancel</button>${!isNew && p.id !== 'main' ? '<button class="btn dark sm danger" type="button" data-del>Delete profile</button>' : ''}</div></form>`;
    const f = box.querySelector('form'); const er = f.querySelector('.er');
    const prev = () => { const t = { ...p, name: f.name.value || '?', color: f.color.value, kids: f.kids.checked }; f.querySelector('.pe-av').innerHTML = avatarHTML(t, 72); };
    f.addEventListener('input', (e) => { if (e.target.name === 'pin') e.target.value = e.target.value.replace(/\D/g, '').slice(0, 4); f.querySelector('.pe-kids').hidden = !f.kids.checked; prev(); });
    f.querySelector('[data-cancel]').onclick = () => (box.innerHTML = '');
    f.querySelector('[data-del]')?.addEventListener('click', async () => {
      if (!confirm(`Delete “${p.name}”? Its list, history and ratings are removed.`)) return;
      try { await removeProfile(p.id); toast('Profile deleted'); renderManage(main); onSwitch?.(true); } catch (e) { er.textContent = e.message; }
    });
    f.addEventListener('submit', async (e) => {
      e.preventDefault(); er.textContent = '';
      const name = f.name.value.trim(); if (!name) { er.textContent = 'Give the profile a name.'; f.name.focus(); return; }
      if (s.list.some((x) => x.id !== p.id && x.name.toLowerCase() === name.toLowerCase())) { er.textContent = 'Another profile already has that name.'; return; }
      const kids = f.kids.checked, pin = f.pin?.value || '';
      if (kids && pin && !/^\d{4}$/.test(pin)) { er.textContent = 'The PIN must be 4 digits.'; return; }
      if (kids && !pin && !p.pin_hash) { er.textContent = 'Set a 4-digit PIN so kids can’t switch out of this profile.'; f.pin.focus(); return; }
      if (kids && p.id === s.active && !s.list.some((x) => !x.kids && x.id !== p.id) && s.list.length > 1) { /* fine */ }
      const out = { ...p, name, color: f.color.value, kids, max_age: kids ? +f.max_age.value : null, pin_hash: kids ? (pin ? await pinHash(p.id, pin) : p.pin_hash) : null };
      try { await saveProfile(out); toast(isNew ? `Profile “${name}” created` : 'Profile saved'); renderManage(main); if (out.id === Profiles.active().id) onSwitch?.(true); } catch (e2) { er.textContent = e2.message; }
    });
    f.name.focus(); box.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }

  // Signing out of a kids profile needs the PIN too (otherwise it's an easy way out).
  document.addEventListener('click', async (e) => {
    const so = e.target.closest('[data-signout]'); if (!so || so.dataset.pinOk) return;
    const cur = Profiles.active(); if (!cur.kids) return;
    e.preventDefault(); e.stopImmediatePropagation();
    if (await askPin(cur, 'PIN needed to sign out')) { so.dataset.pinOk = '1'; so.click(); delete so.dataset.pinOk; }
  }, true);

  let lastUid = null;
  auth?.subscribe?.((u) => {
    const uid = u?.id || null; if (uid === lastUid) return; const was = lastUid; lastUid = uid;
    if (uid) loadRemote().catch((e) => console.warn('[ghostflix] profiles', e));
    else if (was) { const s = read(); const keep = s.list.find((x) => x.id === 'main') || DEF(); write({ list: [{ ...keep, position: 0 }], active: 'main', uid: null }); apply(); chip(); onSwitch?.(true); }
  });
  apply(); chip();
  return { touched, switchTo, picker, renderManage, askPin, apply, chip };
}
