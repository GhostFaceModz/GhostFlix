// Join-Discord nudge: small toast after ~5 min on the site (browsing or watching) or on the 2nd visit; once per session,
// Join / ✕ hides it for 14 days; never shown (and removed) while anything is fullscreen (the player).
(function () { try {
  const K = 'gf_dcn', S = sessionStorage, L = localStorage, d = JSON.parse(L.getItem(K) || '{}');
  if ((d.until || 0) > Date.now()) return;
  if (!S.getItem(K + 'v')) { S.setItem(K + 'v', '1'); d.v = (d.v || 0) + 1; }
  const save = () => L.setItem(K, JSON.stringify(d));
  const fs = () => !!(document.fullscreenElement || document.webkitFullscreenElement);
  save(); let el = null;
  const hide = (days) => { if (days) { d.until = Date.now() + days * 864e5; save(); } if (el) { el.remove(); el = null; } };
  function show() {
    if (el || S.getItem(K + 's') || fs()) return; S.setItem(K + 's', '1');
    const st = document.createElement('style');
    st.textContent = '#gfDcn{position:fixed;left:16px;bottom:16px;z-index:9990;max-width:340px;display:flex;gap:12px;align-items:center;padding:12px 30px 12px 14px;border-radius:14px;background:var(--card,#0d111b);border:1px solid color-mix(in srgb,var(--acc,#5fe3ff) 45%,transparent);box-shadow:0 10px 30px rgba(0,0,0,.55);color:#fff;font-family:inherit;font-size:13px;line-height:1.35;font-weight:500;animation:gfDcn .35s ease}#gfDcn a{flex:none;background:var(--acc,#5fe3ff);color:#04050a;text-decoration:none;font-weight:700;padding:8px 12px;border-radius:10px}#gfDcn button{position:absolute;top:4px;right:6px;background:none;border:0;color:#9aa4b2;font-size:15px;cursor:pointer}@media (max-width:760px){#gfDcn{bottom:calc(84px + env(safe-area-inset-bottom));right:16px}}@keyframes gfDcn{from{opacity:0;transform:translateY(12px)}}';
    document.head.appendChild(st);
    el = document.createElement('div'); el.id = 'gfDcn'; el.setAttribute('role', 'status');
    el.innerHTML = '<span>👻 Join 1,800+ players on our Discord: game nights, giveaways, movie nights</span><a href="https://discord.gg/PZnVDsYGsC" target="_blank" rel="noopener">Join</a><button type="button" aria-label="Dismiss">✕</button>';
    el.querySelector('a').onclick = () => hide(14); el.querySelector('button').onclick = () => hide(14);
    document.body.appendChild(el);
  }
  document.addEventListener('fullscreenchange', () => { if (fs()) hide(); });
  document.addEventListener('webkitfullscreenchange', () => { if (fs()) hide(); });
  if (d.v >= 2) setTimeout(show, 20000);
  setInterval(() => { if (document.visibilityState !== 'visible') return; d.t = (d.t || 0) + 15; save(); if (d.t >= 300) show(); }, 15000);
} catch (e) {} })();
