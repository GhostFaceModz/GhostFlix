// Bulk importers: YouTube playlists/channels and Internet Archive collections/searches.
// Each fetched video becomes an explicit, allowlisted source (parseSource) matched to a
// TMDB title by title + year. Nothing is ever generated from a TMDB id.
import crypto from 'node:crypto';
import { parseSource, isBlocked } from './sources.js';
import { Store } from './store.js';

const UA = { 'User-Agent': 'GhostFlix/1.0 (+self-hosted catalog importer)' };
const MAX_DEFAULT = 200;

export function detectImport(raw) {
  const s = String(raw || '').trim();
  if (isBlocked(s)) return null; // never import from denylisted hosts
  if (/^collection:[\w.-]+$/i.test(s)) return { kind: 'archive', query: s };
  let u; try { u = new URL(/^https?:/i.test(s) ? s : 'https://' + s); } catch { return null; }
  const h = u.hostname.replace(/^www\.|^m\./, '');
  if (h === 'youtube.com' || h === 'youtu.be' || h === 'music.youtube.com') {
    const list = u.searchParams.get('list');
    if (list) return { kind: 'youtube', playlist: list };
    let m = u.pathname.match(/^\/channel\/(UC[\w-]{22})/); if (m) return { kind: 'youtube', channelId: m[1] };
    m = u.pathname.match(/^\/(@[\w.\-]+)/); if (m) return { kind: 'youtube', handle: m[1] };
    m = u.pathname.match(/^\/(?:c|user)\/([\w.\-]+)/); if (m) return { kind: 'youtube', legacy: u.pathname.split('/').slice(0, 3).join('/') };
    return null;
  }
  if (h === 'archive.org') {
    if (/^\/(search|search\.php|advancedsearch\.php)/.test(u.pathname)) {
      const q = u.searchParams.get('query') || u.searchParams.get('q');
      return q ? { kind: 'archive', query: q } : null;
    }
    const m = u.pathname.match(/^\/details\/([\w.\-]+)/);
    if (m) { const q = u.searchParams.get('query'); return { kind: 'archive', collection: m[1], ...(q ? { extra: q } : {}) }; }
  }
  return null;
}

// ---- title cleanup ------------------------------------------------------------
const JUNK = /\b(full[\s-]*(length\s*)?(movie|film|episode)s?|free|official( video| trailer)?|hd|hq|uhd|4k|1080p|720p|480p|colou?ri[sz]ed|restored|remastered|public domain|classic( movie| film)?|english|subtitled|w\/? ?subs?|ipod|dvd ?rip|bluray|blu-ray|x26[45]|avi|mp4|mkv|movie|film)\b/gi;
export function parseTitle(raw) {
  let t = String(raw || '').replace(/[_]+/g, ' ').replace(/\.(avi|mp4|mkv|mpe?g)$/i, '');
  let season = null, episode = null;
  const se = t.match(/\bS(\d{1,2})\s*[ .-]?\s*E(\d{1,3})\b/i) || t.match(/\bSeason\s*(\d{1,2})\D{1,6}Ep(?:isode)?\.?\s*(\d{1,3})\b/i);
  if (se) { season = +se[1]; episode = +se[2]; t = t.slice(0, se.index); }
  let year = null;
  const ym = t.match(/[([]\s*((?:18|19|20)\d{2})\s*[)\]]/) || t.match(/(?:^|[\s,|:–—-])((?:18[89]|19\d|20[0-3])\d)(?=$|[\s,|:–—-])/);
  if (ym) {
    const before = t.slice(0, ym.index).replace(/[\s|:–—,-]+$/, '').trim();
    if (before.replace(/[([]/g, '').trim()) { year = +ym[1]; t = before; } // text after the year is usually notes
  }
  t = t.replace(/[([][^)\]]*[)\]]?/g, ' ');                  // drop bracketed notes
  t = t.split(/\s[|•~]\s|\s[-–—]\s(?=(full|free|hd|official|starring|with|classic|public|\d{4}|english|color|colou?ri[sz]ed|restored|complete))/i)[0];
  t = t.replace(JUNK, ' ').replace(/[|:–—-]+\s*$/g, ' ').replace(/\s{2,}/g, ' ').trim().replace(/[\s,.:;-]+$/, '');
  return { title: t || String(raw).trim(), year, season, episode };
}

// ---- fetchers -----------------------------------------------------------------
async function getJson(url, headers = {}) {
  const r = await fetch(url, { headers: { ...UA, ...headers } });
  if (!r.ok) throw new Error(`HTTP ${r.status} from ${new URL(url).hostname}`);
  return r.json();
}
async function getText(url) {
  const r = await fetch(url, { headers: { ...UA, 'Accept-Language': 'en' } });
  if (!r.ok) throw new Error(`HTTP ${r.status} from ${new URL(url).hostname}`);
  return r.text();
}

async function resolveChannelId(spec) {
  if (spec.channelId) return spec.channelId;
  const html = await getText(`https://www.youtube.com/${spec.handle || spec.legacy.replace(/^\//, '')}`);
  const m = html.match(/"(?:externalId|channelId)":"(UC[\w-]{22})"/) || html.match(/youtube\.com\/channel\/(UC[\w-]{22})/);
  if (!m) throw new Error('Could not resolve that YouTube channel.');
  return m[1];
}

async function fetchYouTube(spec, env, limit) {
  const key = env.YOUTUBE_API_KEY;
  let playlist = spec.playlist, channelId = null;
  if (!playlist) { channelId = await resolveChannelId(spec); playlist = 'UU' + channelId.slice(2); } // uploads playlist
  if (key) {
    const out = []; let pageToken = '';
    do {
      const d = await getJson(`https://www.googleapis.com/youtube/v3/playlistItems?part=snippet,contentDetails&maxResults=50&playlistId=${encodeURIComponent(playlist)}&key=${encodeURIComponent(key)}${pageToken ? '&pageToken=' + pageToken : ''}`);
      for (const it of d.items || []) {
        const vid = it.contentDetails?.videoId; const title = it.snippet?.title;
        if (vid && title && !/^(Private|Deleted) video$/i.test(title)) out.push({ title, ref: `https://www.youtube.com/watch?v=${vid}`, thumb: it.snippet?.thumbnails?.medium?.url, published: it.contentDetails?.videoPublishedAt });
      }
      pageToken = d.nextPageToken || '';
    } while (pageToken && out.length < limit);
    return { items: out.slice(0, limit), note: null };
  }
  // No API key: public RSS feed (YouTube returns only the latest ~15 videos).
  const feed = await getText(`https://www.youtube.com/feeds/videos.xml?${spec.playlist ? 'playlist_id=' + encodeURIComponent(playlist) : 'channel_id=' + channelId}`);
  const items = [...feed.matchAll(/<entry>[\s\S]*?<yt:videoId>([\w-]{11})<\/yt:videoId>[\s\S]*?<title>([\s\S]*?)<\/title>[\s\S]*?<\/entry>/g)].map((m) => ({
    title: m[2].replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>'),
    ref: `https://www.youtube.com/watch?v=${m[1]}`, thumb: `https://i.ytimg.com/vi/${m[1]}/mqdefault.jpg`,
  }));
  return { items: items.slice(0, limit), note: 'No YOUTUBE_API_KEY set — the public feed only lists the latest ~15 videos. Add a free YouTube Data API key to import whole playlists/channels.' };
}

async function fetchArchive(spec, limit) {
  let q = spec.query;
  if (spec.collection) {
    const meta = await getJson(`https://archive.org/metadata/${encodeURIComponent(spec.collection)}/metadata`).catch(() => null);
    const isCollection = meta?.result?.mediatype === 'collection';
    if (!isCollection) {
      return { items: [{ title: String(meta?.result?.title || spec.collection), year: meta?.result?.year || meta?.result?.date, ref: `https://archive.org/details/${spec.collection}`, thumb: `https://archive.org/services/img/${spec.collection}` }], note: null };
    }
    q = `collection:(${spec.collection})${spec.extra ? ` AND (${spec.extra})` : ''}`;
  }
  q = `(${q}) AND mediatype:(movies)`;
  const out = []; const rows = Math.min(limit, 500); let page = 1;
  while (out.length < limit) {
    const d = await getJson(`https://archive.org/advancedsearch.php?q=${encodeURIComponent(q)}&fl[]=identifier&fl[]=title&fl[]=year&fl[]=date&sort[]=downloads+desc&rows=${rows}&page=${page}&output=json`);
    const docs = d.response?.docs || [];
    for (const x of docs) out.push({ title: Array.isArray(x.title) ? x.title[0] : x.title || x.identifier, year: x.year || x.date, ref: `https://archive.org/details/${x.identifier}`, thumb: `https://archive.org/services/img/${x.identifier}` });
    if (docs.length < rows) break; page++;
  }
  return { items: out.slice(0, limit), note: null };
}

/** Fetch + match. Returns a preview (nothing is saved). */
export async function previewImport({ url, limit = MAX_DEFAULT, type = 'auto' }, { catalog, env = process.env }) {
  const spec = detectImport(url);
  if (!spec) { const e = new Error('Paste a YouTube playlist/channel URL, or an Internet Archive collection (archive.org/details/<collection>) or search URL.'); e.status = 400; throw e; }
  limit = Math.max(1, Math.min(+limit || MAX_DEFAULT, 1000));
  const { items, note } = spec.kind === 'youtube' ? await fetchYouTube(spec, env, limit) : await fetchArchive(spec, limit);
  const results = [];
  const queue = [...items];
  const worker = async () => {
    while (queue.length) {
      const it = queue.shift();
      let src = null; let error = null;
      try { src = parseSource(it.ref, env); } catch (e) { error = e.message; }
      const p = parseTitle(it.title);
      const yr = p.year || (it.year ? +String(it.year).slice(0, 4) || null : null);
      const asTv = type === 'tv' || (type === 'auto' && p.season != null);
      let match = null;
      if (src) {
        try { match = await catalog.match(p.title, asTv ? null : yr, asTv ? 'tv' : 'movie'); } catch (e) { error = e.message; }
        if (!match && type === 'auto' && !asTv) { try { match = await catalog.match(p.title, yr, 'tv'); } catch {} }
      }
      results.push({ raw: it.title, ref: it.ref, thumb: it.thumb, parsed: { ...p, year: yr }, source: src, error,
        match: match ? { id: match.id, media_type: match.media_type, title: match.title, year: match.year, poster: match.poster, score: match.score } : null,
        season: asTv ? p.season ?? null : null, episode: asTv ? p.episode ?? null : null });
    }
  };
  await Promise.all(Array.from({ length: 6 }, worker));
  const order = new Map(items.map((it, i) => [it.ref, i]));
  results.sort((a, b) => order.get(a.ref) - order.get(b.ref));
  return { kind: spec.kind, spec, note, count: results.length, matched: results.filter((r) => r.match).length, results };
}

/** Save previewed rows. rows: [{ref, match:{id,media_type}, season?, episode?}] */
export async function commitImport(rows, { store, catalog, env = process.env, origin = 'import', keepUnmatched = true }) {
  let added = 0, dup = 0, unmatched = 0;
  for (const r of rows) {
    let src; try { src = parseSource(r.ref, env); } catch { continue; }
    if (r.match?.id && (r.match.media_type === 'movie' || r.match.media_type === 'tv')) {
      const isEp = r.match.media_type === 'tv' && r.season != null && r.episode != null;
      const key = Store.key(r.match.media_type, r.match.id, isEp ? r.season : null, isEp ? r.episode : null);
      const entry = store.addSource(key, src, { origin, label: r.label || '' });
      if (entry) {
        added++;
        if (!store.data.titles[`${r.match.media_type}:${r.match.id}`]) {
          try { store.rememberTitle(r.match.media_type, await catalog.title(r.match.media_type, r.match.id)); } catch { store.rememberTitle(r.match.media_type, { ...r.match }); }
        }
      } else dup++;
      store.data.unmatched = store.data.unmatched.filter((u) => u.ref !== r.ref);
    } else if (keepUnmatched && !store.data.unmatched.some((u) => u.ref === r.ref) && !store.allSources().some((s) => s.url === src.url)) {
      store.data.unmatched.push({ uid: crypto.randomBytes(4).toString('hex'), ref: r.ref, raw: r.raw, parsed: r.parsed, thumb: r.thumb, origin, at: new Date().toISOString() });
      unmatched++;
    }
  }
  await store.save();
  return { added, duplicates: dup, unmatched };
}

/** Run a saved import job (used by the daily re-sync). Auto-adds confident matches only. */
export async function runJob(job, ctx) {
  const prev = await previewImport({ url: job.url, limit: job.limit, type: job.type || 'auto' }, ctx);
  const known = new Set(ctx.store.allSources().map((s) => s.url));
  const fresh = prev.results.filter((r) => r.source && !known.has(r.source.url));
  const rows = fresh.map((r) => ({ ...r, match: r.match && r.match.score >= (job.minScore ?? 0.75) ? r.match : null }));
  const res = await commitImport(rows, { ...ctx, origin: `job:${job.id}` });
  job.lastRun = new Date().toISOString();
  job.lastResult = { ...res, fetched: prev.count, note: prev.note };
  await ctx.store.save();
  return job.lastResult;
}

export function startScheduler(ctx, everyMs = 60 * 60e3) {
  const tick = async () => {
    for (const job of ctx.store.data.jobs.filter((j) => j.resync)) {
      if (job.lastRun && Date.now() - Date.parse(job.lastRun) < 23.5 * 3600e3) continue;
      try { console.log('[resync]', job.url, await runJob(job, ctx)); } catch (e) { job.lastRun = new Date().toISOString(); job.lastResult = { error: e.message }; console.warn('[resync] failed', job.url, e.message); }
    }
  };
  setTimeout(tick, 15e3).unref();
  return setInterval(tick, everyMs).unref();
}
