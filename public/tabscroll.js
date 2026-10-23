// Horizontal tab bar helper for /admin and /mod: on desktop a mouse can't swipe, so add ‹ › buttons when the row
// overflows, map the vertical wheel to sideways scrolling, allow click-and-drag, and keep the active tab in view.
// Touch swipe is untouched (native overflow scrolling).
export function scrollTabs(nav) {
  if (!nav || nav.dataset.ts) return; nav.dataset.ts = '1';
  const wrap = document.createElement('div'); wrap.className = 'tabs-wrap'; nav.before(wrap); wrap.append(nav);
  const mk = (dir, label) => { const b = document.createElement('button'); b.type = 'button'; b.className = `tabs-arr ${dir}`; b.setAttribute('aria-label', label); b.tabIndex = -1; b.innerHTML = dir === 'l' ? '‹' : '›'; b.hidden = true; wrap.append(b); return b; };
  const L = mk('l', 'Scroll tabs left'), R = mk('r', 'Scroll tabs right');
  const max = () => nav.scrollWidth - nav.clientWidth;
  const sync = () => { const m = max(); L.hidden = !(m > 2 && nav.scrollLeft > 2); R.hidden = !(m > 2 && nav.scrollLeft < m - 2); wrap.classList.toggle('ovf', m > 2); };
  const step = (d) => nav.scrollBy({ left: d * Math.max(160, nav.clientWidth * 0.6), behavior: 'smooth' });
  L.onclick = () => step(-1); R.onclick = () => step(1);
  nav.addEventListener('scroll', sync, { passive: true }); addEventListener('resize', sync);
  // keep the active tab in view horizontally (no vertical page jump), incl. when the hidden dashboard first appears
  const center = () => { const a = nav.querySelector('.on'); if (!a || !nav.clientWidth) return; const l = a.offsetLeft - nav.offsetLeft, w = a.offsetWidth; if (l < nav.scrollLeft + 40 || l + w > nav.scrollLeft + nav.clientWidth - 40) nav.scrollLeft = l - (nav.clientWidth - w) / 2; };
  let lastW = 0; if ('ResizeObserver' in window) new ResizeObserver(() => { if (!lastW && nav.clientWidth) center(); lastW = nav.clientWidth; sync(); }).observe(nav);
  new MutationObserver((recs) => { if (recs.some((r) => r.target !== nav && r.target.classList?.contains('on'))) requestAnimationFrame(() => { center(); sync(); }); }).observe(nav, { subtree: true, attributeFilter: ['class'] });
  nav.addEventListener('wheel', (e) => {
    if (Math.abs(e.deltaY) <= Math.abs(e.deltaX)) return; const m = max(); if (m <= 2) return;
    const d = e.deltaMode === 1 ? e.deltaY * 32 : e.deltaY;
    if ((d < 0 && nav.scrollLeft <= 0) || (d > 0 && nav.scrollLeft >= m - 1)) return; // at the end: let the page scroll
    nav.scrollLeft += d; e.preventDefault();
  }, { passive: false });
  // click-and-drag with a mouse (a real drag swallows the click so it doesn't switch tabs)
  let drag = null, moved = false;
  nav.addEventListener('pointerdown', (e) => { if (e.pointerType !== 'mouse' || e.button !== 0) return; drag = { x: e.clientX, s: nav.scrollLeft }; moved = false; });
  addEventListener('pointermove', (e) => { if (!drag) return; const dx = e.clientX - drag.x; if (!moved && Math.abs(dx) < 6) return; moved = true; nav.classList.add('dragging'); nav.scrollLeft = drag.s - dx; });
  addEventListener('pointerup', () => { if (!drag) return; drag = null; setTimeout(() => nav.classList.remove('dragging'), 0); });
  nav.addEventListener('click', (e) => { if (moved) { e.preventDefault(); e.stopImmediatePropagation(); moved = false; } }, true);
  nav.addEventListener('dragstart', (e) => e.preventDefault());
  requestAnimationFrame(sync); setTimeout(sync, 300);
  return sync;
}
