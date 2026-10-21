// Screenshots for header, Discover, Watch Party (with a 2-viewer realtime check) and Live TV.
import puppeteer from 'puppeteer-core';
const BASE = process.env.BASE || 'http://localhost:3000';
const OUT = new URL('../screens/', import.meta.url).pathname;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const browser = await puppeteer.launch({ executablePath: process.env.CHROME || '/usr/bin/google-chrome', headless: 'new', args: ['--no-sandbox', '--hide-scrollbars', '--autoplay-policy=no-user-gesture-required'] });
const settle = async (p) => { await sleep(800); await p.evaluate(() => document.querySelectorAll('img[loading=lazy]').forEach((i) => (i.loading = 'eager'))); await p.waitForNetworkIdle({ idleTime: 700, timeout: 10000 }).catch(() => {}); await sleep(600); };
const VIEWS = { desktop: { width: 1440, height: 900 }, mobile: { width: 390, height: 844, deviceScaleFactor: 2, isMobile: true, hasTouch: true } };
const H = [{ id: 900005, media_type: 'movie', title: 'Detour', year: 1945, poster: 'https://archive.org/services/img/Detour', demo: true, at: Date.now() }];
for (const [name, vp] of Object.entries(VIEWS)) {
  const ctx = await browser.createBrowserContext();
  const p = await ctx.newPage(); await p.setViewport(vp);
  p.on('pageerror', (e) => console.warn(`[${name}] pageerror`, e.message));
  const shot = async (f, clip) => { await p.screenshot({ path: `${OUT}${f}-${name}.png`, ...(clip ? { clip } : {}) }); console.log('saved', `screens/${f}-${name}.png`); };
  await p.goto(BASE + '/', { waitUntil: 'domcontentloaded' });
  await p.evaluate((h) => { sessionStorage.setItem('gf.nb', '1'); localStorage.setItem('gf.continue', JSON.stringify(h)); localStorage.setItem('gf.settings', JSON.stringify({ autoplayHero: false })); }, H);
  await p.goto(BASE + '/', { waitUntil: 'domcontentloaded' }); await settle(p);
  await shot('header', { x: 0, y: 0, width: vp.width, height: 90 });
  await shot('home');
  await p.goto(BASE + '/discover', { waitUntil: 'domcontentloaded' }); await settle(p); await shot('discover');
  await p.goto(BASE + '/live', { waitUntil: 'domcontentloaded' }); await settle(p); await sleep(2500); await shot('live-tv');
  await p.goto(BASE + '/party', { waitUntil: 'domcontentloaded' }); await settle(p); await shot('party-home');
  const room = `/party/shot${name.slice(0, 2)}?t=movie:900002`;
  await p.goto(BASE + room, { waitUntil: 'domcontentloaded' }); await settle(p);
  // second viewer in a separate context to verify realtime chat
  const ctx2 = await browser.createBrowserContext(); const q = await ctx2.newPage(); await q.setViewport({ width: 1000, height: 700 });
  await q.goto(BASE + room, { waitUntil: 'domcontentloaded' }); await sleep(4000);
  await q.type('#pForm input', 'Popcorn ready 🍿'); await q.keyboard.press('Enter'); await sleep(300);
  await q.click('[data-emo="👻"]').catch(() => {}); await sleep(2500);
  const got = await p.evaluate(() => document.querySelector('#pLog')?.innerText || '');
  console.log(`[${name}] realtime chat received:`, /Popcorn ready/.test(got), '| people:', await p.evaluate(() => document.querySelector('#pPeople')?.textContent));
  await p.type('#pForm input', 'Starting in 3… 👻'); await p.keyboard.press('Enter'); await sleep(400);
  await shot('watch-party');
  await ctx2.close(); await ctx.close();
}
await browser.close();
