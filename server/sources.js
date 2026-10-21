// Video sources.
//
// Policy:
//  * Any http(s) video/embed URL (or pasted <iframe> code) is accepted for a title — nothing is
//    denylisted, so any host can be embedded. Only the http(s) scheme and basic URL sanity are enforced.
//  * Well-known providers (YouTube, Vimeo, Internet Archive, Dailymotion, Bunny, Cloudflare Stream) are
//    normalised to {provider, id} and their embed URLs rebuilt server-side; other pages become an
//    unrestricted generic iframe, and .mp4/.webm/.m3u8 links play in GhostFlix's own player.
//  * Optional admin "link patterns" ({tmdb_id}/{season}/{episode}) for the owner's own host are validated
//    the same way (see patterns below).

// No hosts are blocked. Kept as an empty list so importers/tests that consult it keep working;
// isBlocked() below always returns false.
export const BLOCKED_PATTERNS = [];

const YT_HOSTS = ['youtube.com', 'www.youtube.com', 'm.youtube.com', 'music.youtube.com', 'youtu.be', 'www.youtube-nocookie.com', 'youtube-nocookie.com'];
// Generic (non-provider) iframes are rendered with NO sandbox attribute, so embedded pages can do
// anything (popups, top-level navigation, downloads) — embed anything, no restrictions.
export const GENERIC_SANDBOX = '';

export class SourceError extends Error { constructor(msg) { super(msg); this.status = 400; } }

export const isBlocked = (s) => BLOCKED_PATTERNS.some((re) => re.test(String(s)));

function toUrl(input) {
  let s = String(input || '').trim();
  const m = s.match(/<iframe[^>]+src=["']([^"']+)["']/i); // allow pasting an <iframe> embed code
  if (m) s = m[1];
  if (s.startsWith('//')) s = 'https:' + s;
  if (/^[a-z][a-z0-9+.-]*:/i.test(s) && !/^https?:\/\//i.test(s)) throw new SourceError('Only http(s) links are supported.');
  if (!/^https?:\/\//i.test(s)) s = 'https://' + s;
  let u;
  try { u = new URL(s); } catch { throw new SourceError('That does not look like a valid URL.'); }
  if (u.username || u.password) throw new SourceError('URLs with credentials are not allowed.');
  return u;
}

/** Parse a pasted link / embed code into a normalized source. Throws SourceError. */
export function parseSource(input, env = process.env) {
  const u = toUrl(input);
  if (u.protocol !== 'https:' && u.protocol !== 'http:') throw new SourceError('Only http(s) links are supported.');
  const host = u.hostname.toLowerCase().replace(/\.$/, '');
  const path = u.pathname;

  // YouTube
  if (YT_HOSTS.includes(host)) {
    // Official channel live streams: /embed/live_stream?channel=UC… or /channel/UC…/live
    const live = (path === '/embed/live_stream' && u.searchParams.get('channel')) || (path.match(/^\/channel\/(UC[\w-]{22})\/live\/?$/) || [])[1];
    if (live) {
      if (!/^UC[\w-]{22}$/.test(live)) throw new SourceError('Invalid YouTube channel id.');
      return { provider: 'youtube_live', id: live, url: `https://www.youtube.com/channel/${live}/live` };
    }
    let id = null;
    if (host === 'youtu.be') id = path.slice(1).split('/')[0];
    else if (u.searchParams.get('v')) id = u.searchParams.get('v');
    else { const m = path.match(/^\/(?:embed|shorts|live|v)\/([\w-]{11})/); if (m) id = m[1]; }
    if (!id || !/^[\w-]{11}$/.test(id)) throw new SourceError('Could not find a YouTube video id in that link (playlists/channels go in Import).');
    const start = parseInt(u.searchParams.get('t') || u.searchParams.get('start') || '0', 10) || 0;
    return { provider: 'youtube', id, ...(start ? { start } : {}), url: `https://www.youtube.com/watch?v=${id}` };
  }
  // Vimeo
  if (host === 'vimeo.com' || host === 'www.vimeo.com' || host === 'player.vimeo.com') {
    const m = path.match(/(?:^\/video\/|^\/(?:channels\/[\w-]+\/|groups\/[\w-]+\/videos\/)?)(\d{5,12})(?:\/([0-9a-f]{6,20}))?/i);
    if (!m) throw new SourceError('Could not find a Vimeo video id in that link.');
    const hash = m[2] || u.searchParams.get('h') || '';
    if (hash && !/^[0-9a-f]{6,20}$/i.test(hash)) throw new SourceError('Invalid Vimeo privacy hash.');
    return { provider: 'vimeo', id: m[1], ...(hash ? { hash } : {}), url: `https://vimeo.com/${m[1]}${hash ? '/' + hash : ''}` };
  }
  // Internet Archive (item page / embed / specific file)
  if (host === 'archive.org' || host === 'www.archive.org') {
    const m = path.match(/^\/(?:details|embed|download)\/([^/]+)(?:\/(.+))?$/);
    if (!m) throw new SourceError('Use an archive.org/details/<item> or /embed/<item> link (collections/searches go in Import).');
    const id = decodeURIComponent(m[1]);
    if (!/^[\w.\-]{2,120}$/.test(id)) throw new SourceError('Invalid Internet Archive identifier.');
    const file = m[2] ? decodeURIComponent(m[2]) : '';
    if (file && (/\.\.|[<>"']/.test(file) || file.length > 300)) throw new SourceError('Invalid Internet Archive file name.');
    return { provider: 'archive', id, ...(file ? { file } : {}), url: `https://archive.org/details/${id}${file ? '/' + encodeURI(file) : ''}` };
  }
  // Dailymotion
  if (/(^|\.)dailymotion\.com$/.test(host) || host === 'dai.ly') {
    let id = null;
    if (host === 'dai.ly') id = path.slice(1);
    else if (u.searchParams.get('video')) id = u.searchParams.get('video');
    else { const m = path.match(/\/(?:embed\/)?video\/([a-z0-9]+)/i); if (m) id = m[1]; }
    if (!id || !/^x[a-z0-9]{4,12}$/i.test(id)) throw new SourceError('Could not find a Dailymotion video id in that link.');
    return { provider: 'dailymotion', id, url: `https://www.dailymotion.com/video/${id}` };
  }
  // Bunny Stream player
  if (host === 'iframe.mediadelivery.net' || host === 'player.mediadelivery.net') {
    const m = path.match(/^\/(?:embed|play)\/(\d+)\/([0-9a-f-]{36})/i);
    if (!m) throw new SourceError('Use a Bunny Stream link like iframe.mediadelivery.net/embed/<library>/<video-guid>.');
    return { provider: 'bunny', id: `${m[1]}/${m[2]}`, url: `https://iframe.mediadelivery.net/embed/${m[1]}/${m[2]}` };
  }
  // Cloudflare Stream player (not manifests — those fall through to the HLS branch)
  if ((host.endsWith('.cloudflarestream.com') || host.endsWith('videodelivery.net')) && !/\.(m3u8|mpd|mp4)$/i.test(path)) {
    const m = path.match(/^\/([0-9a-f]{32})(?:\/(?:iframe|watch))?\/?$/i);
    if (!m) throw new SourceError('Use a Cloudflare Stream link like customer-xxxx.cloudflarestream.com/<video-uid>/iframe.');
    const sub = host.endsWith('.cloudflarestream.com') ? host : 'iframe.videodelivery.net';
    if (!/^(customer-[a-z0-9]+\.cloudflarestream\.com|iframe\.videodelivery\.net|watch\.videodelivery\.net|videodelivery\.net)$/.test(sub)) throw new SourceError('Unrecognised Cloudflare Stream host.');
    return { provider: 'cloudflare', id: m[1], host: sub.includes('cloudflarestream') ? sub : 'iframe.videodelivery.net', url: `https://${sub}/${m[1]}/iframe` };
  }
  // Direct files (MP4 / WebM / HLS) from any non-denylisted host
  u.hash = '';
  if (/\.(mp4|m4v|webm|m3u8)$/i.test(path)) {
    const kind = /\.m3u8$/i.test(path) ? 'hls' : 'file';
    return { provider: kind, id: u.toString(), url: u.toString() };
  }
  // Anything else: generic embed page (rendered in a sandboxed iframe)
  return { provider: 'embed', id: u.toString(), url: u.toString(), host };
}

/** Build the player descriptor from a stored source (never from raw user input). */
export function playerFor(src, env = process.env) {
  const enc = encodeURIComponent;
  switch (src.provider) {
    case 'youtube': return { kind: 'iframe', src: `https://www.youtube-nocookie.com/embed/${enc(src.id)}?autoplay=1&rel=0&modestbranding=1&playsinline=1${src.start ? '&start=' + (+src.start) : ''}` };
    case 'youtube_live': return { kind: 'iframe', src: `https://www.youtube.com/embed/live_stream?channel=${enc(src.id)}&autoplay=1&mute=0&playsinline=1` };
    case 'vimeo': return { kind: 'iframe', src: `https://player.vimeo.com/video/${enc(src.id)}?autoplay=1&dnt=1${src.hash ? '&h=' + enc(src.hash) : ''}` };
    case 'archive': return { kind: 'iframe', src: `https://archive.org/embed/${enc(src.id)}${src.file ? '/' + src.file.split('/').map(enc).join('/') : ''}?autoplay=1` };
    case 'dailymotion': return { kind: 'iframe', src: `https://geo.dailymotion.com/player.html?video=${enc(src.id)}&autoplay=1` };
    case 'bunny': { const [lib, vid] = src.id.split('/'); return { kind: 'iframe', src: `https://iframe.mediadelivery.net/embed/${enc(lib)}/${enc(vid)}?autoplay=true&preload=true` }; }
    case 'cloudflare': return { kind: 'iframe', src: `https://${src.host || 'iframe.videodelivery.net'}/${enc(src.id)}/iframe?autoplay=true` };
    case 'file': case 'hls': case 'embed': {
      // Re-parse at play time so stored sources always render through the same rules.
      const again = parseSource(src.id, env);
      if (again.provider === 'embed') return { kind: 'iframe', src: again.id, sandbox: GENERIC_SANDBOX };
      if (again.provider === 'hls' || again.provider === 'file') return { kind: again.provider === 'hls' ? 'hls' : 'video', src: again.id };
      return playerFor(again, env);
    }
    default: throw new SourceError('Unknown provider');
  }
}

export const PROVIDER_LABELS = { youtube: 'YouTube', youtube_live: 'YouTube Live', vimeo: 'Vimeo', archive: 'Internet Archive', dailymotion: 'Dailymotion', bunny: 'Bunny Stream', cloudflare: 'Cloudflare Stream', file: 'Direct video', hls: 'HLS stream', embed: 'Embed' };

// ---- link patterns (owner's own host) ------------------------------------------------
const PH = { movie: ['{tmdb_id}'], tv: ['{tmdb_id}', '{season}', '{episode}'] };
/** Validate a pattern like https://media.example.com/movie/{tmdb_id}. Returns the normalised pattern. */
export function validatePattern(type, pattern, env = process.env) {
  const p = String(pattern || '').trim();
  if (!p) return '';
  for (const ph of PH[type]) if (!p.includes(ph)) throw new SourceError(`The ${type === 'tv' ? 'series' : 'movie'} pattern must contain ${PH[type].join(', ')}.`);
  const sample = fillPattern(p, { tmdb_id: 12345, season: 1, episode: 2 });
  if (/\{[a-z_]+\}/i.test(sample)) throw new SourceError('Unknown placeholder. Use {tmdb_id}, {season}, {episode}.');
  parseSource(sample, env); // same rules as a pasted link (denylist, http(s) only)
  if (!/^https?:\/\/[^/{}]+\//i.test(p)) throw new SourceError('The host part of the pattern must be fixed (placeholders only in the path/query).');
  return p;
}
export function fillPattern(p, v) {
  return p.replace(/\{tmdb_id\}/g, encodeURIComponent(v.tmdb_id)).replace(/\{season\}/g, encodeURIComponent(v.season ?? '')).replace(/\{episode\}/g, encodeURIComponent(v.episode ?? ''));
}

// ---- CineSrc (cinesrc.st) ------------------------------------------------------------
// Free TMDB-based embed API, no key required. Bundled as the default catch-all so every
// movie/series with no attached source still plays. Movie: /embed/movie/{tmdb_id};
// TV: /embed/tv/{tmdb_id}?s={season}&e={episode}.
export function cinesrcUrl(type, id, season, episode) {
  const base = 'https://cinesrc.st/embed';
  return type === 'tv' ? `${base}/tv/${id}?s=${season ?? 1}&e=${episode ?? 1}` : `${base}/movie/${id}`;
}

// ---- NexStream (api.codespecters.com) ---------------------------------------------
// Free embeddable streaming API: /embed/movie/{tmdbId} and /embed/tv/{tmdbId}/{season}/{episode},
// ?apikey=<key> (domain-locked, required). Used as an automatic last-resort source for titles
// with no specific source when NEXSTREAM_API_KEY is set.
export function nexstreamUrl(type, id, season, episode, key) {
  const base = 'https://api.codespecters.com/embed';
  const path = type === 'tv' ? `/tv/${id}/${season ?? 1}/${episode ?? 1}` : `/movie/${id}`;
  return `${base}${path}?apikey=${encodeURIComponent(key)}`;
}
