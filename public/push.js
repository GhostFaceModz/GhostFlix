// Web push opt-in (Stage D): new episodes of followed series + "Remind me" titles. Per device; the server keeps the
// subscription and what to watch for (series ids + reminder dates), and an hourly job sends the notifications.
const ON = 'gf.push';
const b64u = (s) => { const p = '='.repeat((4 - (s.length % 4)) % 4), raw = atob((s + p).replace(/-/g, '+').replace(/_/g, '/')); return Uint8Array.from(raw, (c) => c.charCodeAt(0)); };
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

export function createPush({ shows, reminders, toast }) {
  const supported = 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
  const isIOS = /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  const standalone = () => matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
  let key;
  const getKey = async () => (key !== undefined ? key : (key = (await fetch('/api/push/key').then((r) => r.json()).catch(() => ({}))).key || null));
  const ready = () => Promise.race([navigator.serviceWorker.ready, new Promise((_, rej) => setTimeout(() => rej(new Error('The app’s service worker isn’t ready yet — reload and try again')), 8000))]);
  const current = async () => { if (!supported) return null; const r = await navigator.serviceWorker.getRegistration(); return r ? r.pushManager.getSubscription() : null; };
  const post = async (url, body) => { const r = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }); const d = await r.json().catch(() => ({})); if (!r.ok) throw new Error(d.error || `Error ${r.status}`); return d; };
  const send = (sub) => post('/api/push/subscribe', { sub: sub.toJSON(), shows: shows(), reminders: reminders() });

  async function enable() {
    const k = await getKey(); if (!k) throw new Error('Notifications aren’t set up on the server yet');
    const perm = await Notification.requestPermission();
    if (perm !== 'granted') throw new Error(perm === 'denied' ? 'Notifications are blocked for GhostFlix — allow them in your browser’s site settings' : 'Permission wasn’t granted');
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
  let t;
  /** Re-send what this device follows (debounced) after My List / Continue watching / reminders change. */
  function sync() {
    if (!supported || localStorage.getItem(ON) !== '1') return;
    clearTimeout(t); t = setTimeout(async () => { try { const sub = await current(); if (sub) await send(sub); } catch {} }, 3000);
  }
  async function isOn() { return supported && localStorage.getItem(ON) === '1' && Notification.permission === 'granted' && !!(await current().catch(() => null)); }

  async function mount(el) {
    if (!el) return;
    const iosNote = '<p class="set-note">📱 On iPhone and iPad, notifications only work when GhostFlix is installed: in Safari tap <b>Share → Add to Home Screen</b>, open GhostFlix from your home screen, then turn this on (iOS 16.4 or newer).</p>';
    if (!supported) { el.innerHTML = isIOS && !standalone() ? iosNote : '<p class="set-note" style="margin:0">This browser doesn’t support notifications.</p>'; return; }
    const draw = async (busy = false) => {
      const on = await isOn(), k = await getKey();
      const n = shows().length, r = reminders().length;
      el.innerHTML = `<div class="set-row"><div><b>New episodes &amp; reminders</b><small>Get a notification when a series in My List or Continue watching has a new episode, or a title you tapped <b>Remind me</b> on comes out. This device only.</small></div>
        <button type="button" class="tgl ${on ? 'on' : ''}" role="switch" aria-checked="${on}" aria-label="Notifications" data-push ${busy || !k ? 'disabled' : ''}><i></i></button></div>
        ${on ? `<div class="set-row"><div><b>Following</b><small>${n} series · ${r} reminder${r === 1 ? '' : 's'} on this profile</small></div><button class="btn dark sm" type="button" data-push-test>Send a test</button></div>` : ''}
        ${!k ? '<p class="set-note">Notifications aren’t set up on the server yet.</p>' : ''}
        ${Notification.permission === 'denied' ? '<p class="set-note">Notifications are blocked for this site — allow them in your browser’s site settings first.</p>' : ''}
        ${isIOS ? iosNote : '<p class="set-note" style="margin-bottom:0">On iPhone/iPad this works only from the installed home-screen app.</p>'}`;
      el.querySelector('[data-push]').onclick = async () => {
        draw(true);
        try { if (on) { await disable(); toast('Notifications off'); } else { const d = await enable(); toast(`Notifications on — following ${d.shows} series and ${d.reminders} reminders`); } }
        catch (e) { toast(e.message); }
        draw();
      };
      const tb = el.querySelector('[data-push-test]');
      if (tb) tb.onclick = async () => { tb.disabled = true; try { const sub = await current(); await post('/api/push/test', { endpoint: sub?.endpoint }); toast('Test sent — it should pop up in a few seconds'); } catch (e) { toast(e.message); } tb.disabled = false; };
    };
    el.innerHTML = '<p class="set-note" style="margin:0">Loading…</p>';
    draw();
  }
  return { mount, sync, enable, disable, isOn, supported };
}
