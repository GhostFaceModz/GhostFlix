// Applies the saved theme before first paint (loaded synchronously in <head>; CSP disallows inline scripts).
(function () {
  try {
    var s = JSON.parse(localStorage.getItem('gf.settings') || '{}') || {};
    var r = document.documentElement; r.dataset.theme = s.theme || 'dark';
    // Seasonal look (default Normal; auto = Halloween all October, only if picked): set before paint so there is no colour flash.
    if (s.season === 'halloween' || (s.season === 'auto' && s.seasonPicked && new Date().getMonth() === 9)) r.dataset.season = 'halloween';
    if (s.bgAnim !== false) r.dataset.bganim = '1';
    var c = JSON.parse(localStorage.getItem('gf.cosmetics') || '{}') || {};
    if (c.glow) { r.style.setProperty('--gf-glow', c.glow); r.dataset.glow = '1'; }
  } catch (e) { document.documentElement.dataset.theme = 'dark'; }
  // Animated header title: only where VP9-alpha WebM works. Safari/WebKit (incl. every iOS browser) gets the static PNG and never loads the video.
  try {
    var ua = navigator.userAgent;
    var webkit = (/AppleWebKit/i.test(ua) && !/Chrome|Chromium|CriOS|Edg|OPR|Android/i.test(ua)) || /iPad|iPhone|iPod/i.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
    var t = document.createElement('video');
    var ok = !webkit && !!t.canPlayType && t.canPlayType('video/webm; codecs="vp09.00.10.08"') !== '';
    if (!ok) document.documentElement.classList.add('gf-novid');
    else document.addEventListener('DOMContentLoaded', function () {
      var v = document.querySelector('#nav .wm-vid'); if (!v) return;
      v.innerHTML = '<source src="/brand/ghostflix-melt.webm?v=2" type="video/webm">';
      v.load(); var p = v.play(); if (p && p.catch) p.catch(function () {});
    });
  } catch (e) { document.documentElement.classList.add('gf-novid'); }
})();
