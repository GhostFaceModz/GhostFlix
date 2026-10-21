// Headless screenshots of key pages → screens/*.png
// Usage: BASE=http://localhost:3000 ADMIN_PASSWORD=... [ONLY=home,detail,series,settings,admin] node scripts/screens.mjs
import puppeteer from 'puppeteer-core';
import { mkdir } from 'node:fs/promises';

const BASE = process.env.BASE || 'http://localhost:3000';
const OUT = new URL('../screens/', import.meta.url).pathname;
const PW = process.env.ADMIN_PASSWORD || '';
const MOVIE = process.env.MOVIE || '/title/movie/900001';
const SERIES = process.env.SERIES || '/title/tv/900500';
const ONLY = (process.env.ONLY || '').split(',').filter(Boolean);
const want = (k) => !ONLY.length || ONLY.includes(k);
await mkdir(OUT, { recursive: true });
const browser = await puppeteer.launch({ executablePath: process.env.CHROME || '/usr/bin/google-chrome', headless: 'new', args: ['--no-sandbox', '--hide-scrollbars'] });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const settle = async (page) => {
  await sleep(700);
  await page.evaluate(() => document.querySelectorAll('img[loading=lazy]').forEach((i) => (i.loading = 'eager')));
  await page.waitForNetworkIdle({ idleTime: 700, timeout: 12000 }).catch(() => {}); await sleep(700);
};
const VIEWS = { desktop: { width: 1440, height: 900, deviceScaleFactor: 1 }, mobile: { width: 390, height: 844, deviceScaleFactor: 2, isMobile: true, hasTouch: true } };
const now = Date.now();
const HISTORY = [
  { id: 900500, media_type: 'tv', title: 'Sherlock Holmes (1954)', year: 1954, poster: 'https://archive.org/services/img/SherlockHolmes-TheCaseOfTheRedHeadedLeague', backdrop: 'https://archive.org/services/img/SherlockHolmes-TheCaseOfTheRedHeadedLeague', demo: true, playable: true, s: 1, e: 6, at: now - 36e5 },
  { id: 900005, media_type: 'movie', title: 'Detour', year: 1945, poster: 'https://archive.org/services/img/Detour', backdrop: 'https://archive.org/services/img/Detour', demo: true, playable: true, progress: 42, at: now - 864e5 },
  { id: 900004, media_type: 'movie', title: 'The General', year: 1926, poster: 'https://archive.org/download/The_General_Buster_Keaton/General-still.jpg', backdrop: 'https://archive.org/download/The_General_Buster_Keaton/General-still.jpg', demo: true, playable: true, progress: 80, at: now - 3 * 864e5 },
];

for (const [name, vp] of Object.entries(VIEWS)) {
  const page = await browser.newPage();
  await page.setViewport(vp);
  page.on('pageerror', (e) => console.warn(`[${name}] pageerror`, e.message));
  const shot = async (file, full = false) => { await page.screenshot({ path: `${OUT}${file}-${name}.png`, fullPage: full }); console.log('saved', `screens/${file}-${name}.png`); };
  const go = async (p) => { await page.goto(BASE + p, { waitUntil: 'domcontentloaded' }); await settle(page); };
  await page.goto(BASE + '/', { waitUntil: 'domcontentloaded' });
  await page.evaluate((h) => { sessionStorage.setItem('gf.nb', '1'); localStorage.setItem('gf.continue', JSON.stringify(h)); localStorage.setItem('gf.settings', JSON.stringify({ autoplayHero: false })); }, HISTORY);
  if (want('home')) { await go('/'); await shot('home'); await shot('home-full', true);
    await page.click('#burger'); await sleep(700); await shot('menu'); await page.click('#drawerX'); await sleep(400); }
  if (want('detail')) { await go(MOVIE); await shot('movie-detail'); await shot('movie-detail-full', true); }
  if (want('series')) { await go(SERIES); await shot('series-detail');
    await page.evaluate(() => { document.querySelector('#episodes')?.scrollIntoView({ block: 'start' }); window.scrollBy(0, -70); }); await sleep(900); await shot('series-episodes'); }
  if (want('browse')) { await go('/movies'); await shot('browse'); }
  if (want('settings')) {
    await go('/settings'); await shot('settings');
    await go('/settings/history'); await shot('settings-history');
    await go('/settings/appearance'); await shot('settings-appearance');
    await go('/settings/subtitles'); await shot('settings-subtitles');
    await page.evaluate(() => document.querySelector('[data-signin]')?.click()); await go('/settings'); await page.evaluate(() => document.querySelector('[data-signin]')?.click()); await sleep(600); await shot('signin');
  }
  if (want('admin')) {
    await go('/admin');
    if (PW) {
      if (await page.$('#login:not([hidden])')) { await page.type('#loginForm input[name=password]', PW); await page.click('#loginForm button'); }
      await page.waitForSelector('#dash:not([hidden])', { timeout: 10000 });
      await page.type('#lookupQ', 'Night of the'); await sleep(1200);
      await page.click('#lookupRes .res[data-i="0"]').catch(() => {});
      await page.type('#srcUrl', 'https://archive.org/details/Night.Of.The.Living.Dead_1080p'); await sleep(1200);
      await page.type('#srcLabel', 'Restored 1080p');
      await page.evaluate(() => { document.querySelector('#impUrl').value = 'https://archive.org/details/feature_films'; document.querySelector('#impLimit').value = 14; document.querySelector('#impType').value = 'movie'; });
      await page.click('#impBtn'); await page.waitForSelector('#impOut .imp-row', { timeout: 60000 }).catch(() => {}); await settle(page);
      await shot('admin'); await shot('admin-full', true);
    } else await shot('admin-login');
  }
  await page.close();
}
await browser.close();
