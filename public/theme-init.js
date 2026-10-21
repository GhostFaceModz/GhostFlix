// Applies the saved theme before first paint (loaded synchronously in <head>; CSP disallows inline scripts).
(function () {
  try {
    var s = JSON.parse(localStorage.getItem('gf.settings') || '{}') || {};
    var r = document.documentElement; r.dataset.theme = s.theme || 'dark';
    var c = JSON.parse(localStorage.getItem('gf.cosmetics') || '{}') || {};
    if (c.glow) { r.style.setProperty('--gf-glow', c.glow); r.dataset.glow = '1'; }
  } catch (e) { document.documentElement.dataset.theme = 'dark'; }
})();
