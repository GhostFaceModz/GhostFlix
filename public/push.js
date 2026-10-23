// Notifications: one choice per account + profile — Off / In GhostFlix only (bell + toasts) / Phone notifications (web push
// on this device too). The server keeps the choice + a snapshot of My List, and an hourly job checks it against TMDB.
// Web push itself is per device (Stage D): the server keeps the subscription, followed series and "Remind me" dates.
const ON = 'gf.push';
const b64u = (s) => { const p = '='.repeat((4 - (s.length % 4)) % 4), raw = atob((s + p).replace(/-/g, '+').replace(/_/g, '/')); return Uint8Array.from(raw, (c) => c.charCodeAt(0)); };
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

export function createPush({ shows, reminders, list, profile, signedIn, call, toast }) {
  const supported = 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
  const isIOS = /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  const isAndroid = /android/i.test(navigator.userAgent);
  const standalone = () => matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
  let key;
  const getKey = async () => (key !== undefined ? key : (key = (await fetch('/api/push/key').then((r) => r.json()).catch(() => ({}))).key || null));
  const ready = () => Promise.race([navigator.serviceWorker.ready, new Promise((_, rej) => setTimeout(() => rej(new Error('The app’s service worker isn’t ready yet — reload and try again')), 8000))]);
  const current = async () => { if (!supported) return null; const r = await navigator.serviceWorker.getRegistration(); return r ? r.pushManager.getSubscription() : null; };
  const post = (url, body) => call(url, { method: 'POST', body });
  const send = (sub) => post('/api/push/subscribe', { sub: sub.toJSON(), shows: shows(), reminders: reminders(), profile: profile() });

  async function enable() {
    const k = await getKey(); if (!k) throw new Error('Notifications aren’t set up on the server yet');
    const perm = await Notification.requestPermission();
    if (perm !== 'granted') throw Object.assign(new Error(perm === 'denied' ? 'Notifications are blocked for GhostFlix — allow them in your browser’s site settings' : 'Permission wasn’t granted'), { denied: true });
    const reg = await ready();
    let sub = await reg.pushManager.getSubscription();
    if (!sub) sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64u(k) });
    const d = await send(sub); localStorage.setItem(ON, '1'); return d;
  }
  async function disable() {
    const sub = await current().catch(() => null);
    if (sub) { post('/api/push/unsubscribe', { endpoint: sub.endpoint }).catch(() => {}); await sub.unsubscribe().catch(() => {}); }
    localStorage.removeItem(ON);
  }
  async function isOn() { return supported && localStorage.getItem(ON) === '1' && Notification.permission === 'granted' && !!(await current().catch(() => null)); }

  // ---- the choice (per account + profile on the server; signed out it's just this device's push on/off)
  const modes = new Map(); // profile id -> 'off' | 'site' | 'push'
  async function getMode(force) {
    const pid = profile();
    if (!signedIn()) return (await isOn()) ? 'push' : 'off';
    if (!force && modes.has(pid)) return modes.get(pid);
    try { const d = await call(`/api/notify/${pid}`); modes.set(pid, d.mode); return d.mode; } catch { return modes.get(pid) || ((await isOn()) ? 'push' : 'off'); }
  }
  async function setMode(m) {
    let mode = m, note = '';
    if (m === 'push') {
      try { await enable(); } catch (e) { if (!signedIn()) throw e; mode = 'site'; note = e.denied ? 'denied' : e.message; }
    } else await disable();
    if (signedIn()) { await call(`/api/notify/${profile()}`, { method: 'PUT', body: { mode, list: list() } }); modes.set(profile(), mode); }
    refresh(); return { mode, note };
  }

  let t, tl;
  /** Re-send what this device / profile follows (debounced) after My List / Continue watching / reminders change. */
  function sync() {
    if (supported && localStorage.getItem(ON) === '1') { clearTimeout(t); t = setTimeout(async () => { try { const sub = await current(); if (sub) await send(sub); } catch {} }, 3000); }
    clearTimeout(tl); tl = setTimeout(async () => { if (signedIn() && (await getMode()) !== 'off') post(`/api/notify/${profile()}/list`, { list: list() }).catch(() => {}); }, 3500);
  }

  // ---- in-app bell (header) + toasts for new ones while GhostFlix is open
  let bell = null, notes = [], unread = 0, pollT;
  const seenKey = () => `gf.notify.seen.${profile()}`;
  const ago = (d) => { const m = Math.round((Date.now() - new Date(d)) / 60000); return m < 60 ? `${Math.max(1, m)}m` : m < 1440 ? `${Math.round(m / 60)}h` : `${Math.round(m / 1440)}d`; };
  function drawBell() {
    if (!bell) {
      const acct = document.getElementById('account'); if (!acct) return;
      bell = document.createElement('div'); bell.className = 'gf-bell'; bell.hidden = true;
      bell.innerHTML = '<button class="theme-tgl" type="button" aria-label="Notifications" aria-haspopup="true" aria-expanded="false"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 16V11a6 6 0 0 1 12 0v5l1.6 2H4.4Z"/><path d="M10 20.5a2.2 2.2 0 0 0 4 0"/></svg><i hidden></i></button><div class="gf-bell-pop" role="menu" hidden></div>';
      acct.before(bell);
      const btn = bell.querySelector('button'), pop = bell.querySelector('.gf-bell-pop');
      btn.onclick = (e) => {
        e.stopPropagation(); const open = pop.hidden; pop.hidden = !open; btn.setAttribute('aria-expanded', open);
        if (open && unread) { unread = 0; drawBell(); post(`/api/notify/${profile()}/read`, {}).catch(() => {}); }
      };
      document.addEventListener('click', (e) => { if (!bell.contains(e.target)) { pop.hidden = true; btn.setAttribute('aria-expanded', 'false'); } });
      pop.addEventListener('click', (e) => { if (e.target.closest('a')) pop.hidden = true; });
    }
    const dot = bell.querySelector('i'); dot.hidden = !unread; dot.textContent = unread > 9 ? '9+' : unread || '';
    bell.querySelector('.gf-bell-pop').innerHTML = `<div class="gf-bell-h"><b>Notifications</b><a href="/settings/preferences?to=notifications" data-link>Settings</a></div>${notes.length ? notes.map((n) => `<a href="${esc(n.url || '/')}" data-link role="menuitem"><b>${esc(n.title)}</b>${n.body ? `<small>${esc(n.body)}</small>` : ''}<time>${ago(n.created_at)}</time></a>`).join('') : '<p>Nothing yet. We’ll let you know when something from your list comes out.</p>'}`;
  }
  async function poll() {
    if (!signedIn()) { if (bell) bell.hidden = true; return; }
    let d; try { d = await call(`/api/notify/${profile()}/notes`); } catch { return; }
    modes.set(profile(), d.mode); drawBell(); if (!bell) return;
    bell.hidden = d.mode === 'off'; notes = d.notes || []; unread = d.unread || 0; drawBell();
    const seen = +localStorage.getItem(seenKey()) || 0, fresh = notes.filter((n) => n.id > seen);
    if (notes.length) localStorage.setItem(seenKey(), Math.max(seen, ...notes.map((n) => n.id)));
    if (seen && fresh.length && d.mode !== 'off') toast(fresh.length === 1 ? `🔔 ${fresh[0].title}` : `🔔 ${fresh.length} new notifications`);
  }
  function refresh() { clearTimeout(pollT); pollT = setTimeout(poll, 400); }
  setInterval(() => { if (document.visibilityState === 'visible') poll(); }, 5 * 60e3);
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') refresh(); });

  // ---- Settings › Preferences › Notifications
  const CHOICES = [
    ['off', 'Off', 'No notifications from GhostFlix.'],
    ['site', 'In GhostFlix only', 'A bell and pop-ups while you’re on GhostFlix. Nothing on your phone.'],
    ['push', 'Phone notifications', 'Alerts on this phone or computer even when GhostFlix is closed — plus the bell.'],
  ];
  const help = () => isIOS ? 'on iPhone/iPad open <b>Settings → Notifications → GhostFlix</b> and turn on <b>Allow Notifications</b>.'
    : isAndroid ? (standalone() ? 'long-press the GhostFlix app icon → <b>App info → Notifications</b> → allow.' : 'tap the icon left of the address bar → <b>Permissions → Notifications</b> → <b>Allow</b>.')
    : 'click the icon left of the address bar → <b>Notifications</b> → <b>Allow</b>.';
  async function mount(el) {
    if (!el) return;
    const iosNote = '<p class="set-note">📱 On iPhone and iPad, phone notifications only work when GhostFlix is installed: in Safari tap <b>Share → Add to Home Screen</b>, open GhostFlix from your home screen, then pick <b>Phone notifications</b> here (iOS 16.4 or newer).</p>';
    let flash = '';
    const draw = async (busy = false) => {
      const [mode, k, on] = await Promise.all([getMode(true), supported ? getKey() : null, isOn()]);
      const pushOk = supported && !!k, si = signedIn(), denied = supported && Notification.permission === 'denied';
      const n = list().length, r = reminders().length;
      el.innerHTML = `<div class="gf-nchoice" role="radiogroup" aria-label="Notifications">${CHOICES.map(([v, l, d]) => {
          const dis = busy || (v === 'site' && !si) || (v === 'push' && !pushOk && mode !== 'push');
          return `<label class="${mode === v ? 'on' : ''}${dis ? ' dis' : ''}"><input type="radio" name="gfn" value="${v}" ${mode === v ? 'checked' : ''} ${dis ? 'disabled' : ''}><span><b>${l}</b><small>${d}</small></span></label>`;
        }).join('')}</div>
        ${flash}
        ${mode !== 'off' ? `<p class="set-note">You’ll hear about: new episodes and seasons of series in My List or Continue watching, films from My List coming out, titles from your list featured on GhostFlix${r ? ', your Remind-me titles' : ''} and GhostFlix announcements — at most 3 a day, never the same thing twice.${si ? ` Following ${n} title${n === 1 ? '' : 's'} on this profile.` : ''}</p>` : ''}
        ${mode === 'push' && pushOk && !on ? `<div class="set-row"><div><b>Not on this device yet</b><small>Phone notifications are on for this profile — allow them here too.</small></div><button class="btn dark sm" type="button" data-push-here>Turn on here</button></div>` : ''}
        ${mode === 'push' && on ? '<div class="set-row"><div><b>This device</b><small>Notifications will pop up here even when GhostFlix is closed.</small></div><button class="btn dark sm" type="button" data-push-test>Send a test</button></div>' : ''}
        ${!si ? '<p class="set-note">Sign in to get notifications in GhostFlix and to save your choice for each profile. Signed out, phone notifications work for this device only.</p>' : '<p class="set-note">Saved for this profile on your account.</p>'}
        ${supported && !k ? '<p class="set-note">Phone notifications aren’t set up on the server yet.</p>' : ''}
        ${denied && !flash ? `<p class="set-note">🔕 Notifications are blocked for GhostFlix on this device. To allow them: ${help()} Then pick <b>Phone notifications</b> again.</p>` : ''}
        ${!supported ? (isIOS && !standalone() ? iosNote : '<p class="set-note">This browser can’t show phone notifications.</p>') : isIOS ? iosNote : ''}`;
      el.querySelectorAll('input[name=gfn]').forEach((i) => (i.onchange = async () => {
        flash = ''; draw(true);
        try {
          const d = await setMode(i.value);
          if (d.note === 'denied') flash = `<p class="set-note gf-warn">Your browser didn’t allow notifications, so you’ll get them <b>in GhostFlix only</b> for now. To allow them: ${help()} Then pick <b>Phone notifications</b> again.</p>`;
          else if (d.note) flash = `<p class="set-note gf-warn">${esc(d.note)} — you’ll get them in GhostFlix only for now.</p>`;
          toast(d.mode === 'off' ? 'Notifications off' : d.mode === 'site' ? 'Notifications: in GhostFlix only' : 'Phone notifications on');
        } catch (e) { toast(e.message); }
        draw();
      }));
      const here = el.querySelector('[data-push-here]');
      if (here) here.onclick = async () => { here.disabled = true; try { await enable(); toast('Phone notifications on for this device'); } catch (e) { flash = e.denied ? `<p class="set-note gf-warn">Blocked by your browser. To allow: ${help()}</p>` : ''; toast(e.message); } draw(); };
      const tb = el.querySelector('[data-push-test]');
      if (tb) tb.onclick = async () => { tb.disabled = true; try { const sub = await current(); await post('/api/push/test', { endpoint: sub?.endpoint }); toast('Test sent — it should pop up in a few seconds'); } catch (e) { toast(e.message); } tb.disabled = false; };
    };
    el.innerHTML = '<p class="set-note" style="margin:0">Loading…</p>';
    draw();
  }
  return { mount, sync, enable, disable, isOn, supported, refresh };
}
