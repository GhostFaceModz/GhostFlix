// TMDB-backed catalog. Key stays server-side; responses are cached in memory.
// Accepts either a v3 API key or a v4 "API Read Access Token" in TMDB_API_KEY.
const IMG = 'https://image.tmdb.org/t/p/';
const img = (p, size) => (p ? IMG + size + p : null);
const yearOf = (d) => (d ? +String(d).slice(0, 4) || null : null);

export function card(x, forcedType) {
  const media_type = forcedType || x.media_type || (x.first_air_date !== undefined || x.name ? 'tv' : 'movie');
  if (media_type !== 'movie' && media_type !== 'tv') return null;
  return {
    id: x.id, media_type, title: x.title || x.name || x.original_title || x.original_name || 'Untitled',
    year: yearOf(x.release_date || x.first_air_date), overview: x.overview || '',
    poster: img(x.poster_path, 'w342'), backdrop: img(x.backdrop_path, 'w1280'),
    rating: x.vote_average ? Math.round(x.vote_average * 10) / 10 : null, votes: x.vote_count || 0,
    genre_ids: x.genre_ids || (x.genres || []).map((g) => g.id), popularity: x.popularity || 0,
  };
}
const cards = (arr, t) => (arr || []).map((x) => card(x, t)).filter((c) => c && (c.poster || c.backdrop));

export class TmdbCatalog {
  constructor(env = process.env) {
    this.key = String(env.TMDB_API_KEY || '').trim();
    this.lang = env.TMDB_LANGUAGE || 'en-US';
    this.region = env.TMDB_REGION || 'US';
    this.cache = new Map();
    this.mode = 'tmdb';
  }
  async get(path, params = {}, ttl = 30 * 60e3) {
    const q = new URLSearchParams({ language: this.lang, ...params });
    const bearer = this.key.startsWith('eyJ');
    if (!bearer) q.set('api_key', this.key);
    const url = `https://api.themoviedb.org/3${path}?${q}`;
    const ck = path + '?' + q;
    const hit = this.cache.get(ck);
    if (hit && hit.exp > Date.now()) return hit.val;
    const r = await fetch(url, { headers: { accept: 'application/json', ...(bearer ? { Authorization: `Bearer ${this.key}` } : {}) } });
    if (!r.ok) { const e = new Error(`TMDB ${r.status} on ${path}`); e.status = r.status === 404 ? 404 : 502; throw e; }
    const val = await r.json();
    if (this.cache.size > 1500) this.cache.delete(this.cache.keys().next().value);
    this.cache.set(ck, { val, exp: Date.now() + ttl });
    return val;
  }

  async genres() {
    const [m, t] = await Promise.all([this.get('/genre/movie/list', {}, 864e5), this.get('/genre/tv/list', {}, 864e5)]);
    return { movie: m.genres, tv: t.genres };
  }
  async list(type, category, page = 1) {
    const map = {
      trending: [`/trending/${type === 'tv' ? 'tv' : type === 'all' ? 'all' : 'movie'}/week`],
      popular: [`/${type}/popular`], top_rated: [`/${type}/top_rated`],
      now_playing: ['/movie/now_playing'], upcoming: ['/movie/upcoming'],
      airing_today: ['/tv/airing_today'], on_the_air: ['/tv/on_the_air'],
    };
    const p = map[category];
    if (!p) { const e = new Error('Unknown category'); e.status = 404; throw e; }
    const d = await this.get(p[0], { page });
    return { page: d.page, total_pages: Math.min(d.total_pages, 500), results: cards(d.results, type === 'all' ? undefined : type) };
  }
  async discover(type, genre, page = 1) {
    const d = await this.get(`/discover/${type}`, { with_genres: genre, sort_by: 'popularity.desc', page, 'vote_count.gte': 50 });
    return { page: d.page, total_pages: Math.min(d.total_pages, 500), results: cards(d.results, type) };
  }
  async search(q, page = 1) {
    const d = await this.get('/search/multi', { query: q, page, include_adult: 'false' }, 10 * 60e3);
    return { page: d.page, total_pages: d.total_pages, results: cards(d.results) };
  }
  async home() {
    const [g, trending, popM, popT, topM, topT, nowP] = await Promise.all([
      this.genres(), this.list('all', 'trending'), this.list('movie', 'popular'), this.list('tv', 'popular'),
      this.list('movie', 'top_rated'), this.list('tv', 'top_rated'), this.list('movie', 'now_playing'),
    ]);
    const pick = [[28, 'Action'], [35, 'Comedy'], [27, 'Horror'], [878, 'Sci-Fi'], [16, 'Animation'], [99, 'Documentaries']];
    const genreRows = await Promise.all(pick.map(async ([id, name]) => ({ id: `g${id}`, title: name, link: `/genre/movie/${id}`, items: (await this.discover('movie', id)).results })));
    return {
      mode: this.mode, genres: g,
      hero: trending.results.filter((c) => c.backdrop).slice(0, 6),
      rows: [
        { id: 'trending', title: 'Trending this week', link: '/browse/all/trending', items: trending.results },
        { id: 'pop-movies', title: 'Popular movies', link: '/browse/movie/popular', items: popM.results },
        { id: 'pop-tv', title: 'Popular series', link: '/browse/tv/popular', items: popT.results },
        { id: 'top10', title: 'Top 10 today', top10: true, items: trending.results.slice(0, 10) },
        { id: 'top-movies', title: 'Top rated movies', link: '/browse/movie/top_rated', items: topM.results },
        { id: 'top-tv', title: 'Top rated series', link: '/browse/tv/top_rated', items: topT.results },
        { id: 'now', title: 'In theaters now', link: '/browse/movie/now_playing', items: nowP.results },
        ...genreRows,
      ],
    };
  }
  async discoverPage() {
    const moods = [['feelgood', 'Feel-good picks', '35|10751'], ['edge', 'Edge of your seat', '53|80'], ['mind', 'Mind-benders', '878|9648'],
      ['date', 'Date night', '10749'], ['spooky', 'After dark', '27'], ['toons', 'Animated worlds', '16']];
    const [day, week, upcoming, onAir, ...moodRows] = await Promise.all([
      this.get('/trending/all/day'), this.list('all', 'trending'), this.list('movie', 'upcoming'), this.list('tv', 'on_the_air'),
      ...moods.map(([, , g]) => this.get('/discover/movie', { with_genres: g, sort_by: 'popularity.desc', 'vote_count.gte': 200 })),
    ]);
    return { top10: cards(day.results).slice(0, 10), rows: [
      { id: 'trending', title: 'Trending this week', link: '/browse/all/trending', items: week.results },
      { id: 'upcoming', title: 'Coming soon', link: '/browse/movie/upcoming', items: upcoming.results },
      { id: 'onair', title: 'New episodes this week', link: '/browse/tv/on_the_air', items: onAir.results },
    ], moods: moods.map(([id, title], i) => ({ id, title, items: cards(moodRows[i].results, 'movie') })) };
  }
  async title(type, id, region = this.region) {
    const d = await this.get(`/${type}/${id}`, { append_to_response: 'credits,videos,watch/providers,recommendations,similar,external_ids,release_dates,content_ratings', include_video_language: 'en,null' }, 6 * 3600e3);
    const c = card(d, type);
    const vids = (d.videos?.results || []).filter((v) => v.site === 'YouTube' && /^[\w-]{11}$/.test(v.key));
    const rank = (v) => (v.type === 'Trailer' ? 0 : v.type === 'Teaser' ? 1 : 2) - (v.official ? 0.5 : 0);
    const prov = d['watch/providers']?.results?.[region] || d['watch/providers']?.results?.US || null;
    const logo = (arr) => (arr || []).map((p) => ({ id: p.provider_id, name: p.provider_name, logo: img(p.logo_path, 'w92') }));
    let cert = null;
    if (type === 'movie') cert = (d.release_dates?.results || []).find((r) => r.iso_3166_1 === region)?.release_dates?.find((x) => x.certification)?.certification || null;
    else cert = (d.content_ratings?.results || []).find((r) => r.iso_3166_1 === region)?.rating || null;
    return {
      ...c, backdrop: img(d.backdrop_path, 'original') || c.backdrop, backdrop_sm: c.backdrop,
      tagline: d.tagline || '', status: d.status, certification: cert,
      runtime: d.runtime || d.episode_run_time?.[0] || null, genres: d.genres || [],
      release_date: d.release_date || d.first_air_date || null, imdb_id: d.imdb_id || d.external_ids?.imdb_id || null,
      homepage: d.homepage || null, languages: (d.spoken_languages || []).map((l) => l.english_name),
      created_by: (d.created_by || []).map((p) => p.name),
      directors: (d.credits?.crew || []).filter((p) => p.job === 'Director').map((p) => p.name).slice(0, 3),
      cast: (d.credits?.cast || []).slice(0, 18).map((p) => ({ id: p.id, name: p.name, character: p.character, profile: img(p.profile_path, 'w185') })),
      trailers: vids.sort((a, b) => rank(a) - rank(b)).slice(0, 6).map((v) => ({ key: v.key, name: v.name, type: v.type })),
      providers: prov ? { region: d['watch/providers'].results[region] ? region : 'US', link: prov.link, flatrate: logo(prov.flatrate), free: logo(prov.free), ads: logo(prov.ads), rent: logo(prov.rent), buy: logo(prov.buy) } : null,
      seasons: type === 'tv' ? (d.seasons || []).filter((s) => s.season_number > 0 || (d.seasons || []).length === 1).map((s) => ({ season_number: s.season_number, name: s.name, episode_count: s.episode_count, poster: img(s.poster_path, 'w185'), air_date: s.air_date })) : null,
      number_of_seasons: d.number_of_seasons || null, number_of_episodes: d.number_of_episodes || null,
      recommendations: cards(d.recommendations?.results?.length ? d.recommendations.results : d.similar?.results, type).slice(0, 18),
    };
  }
  async season(id, n) {
    const d = await this.get(`/tv/${id}/season/${n}`, {}, 6 * 3600e3);
    return { season_number: d.season_number, name: d.name, overview: d.overview, episodes: (d.episodes || []).map((e) => ({
      episode_number: e.episode_number, name: e.name, overview: e.overview, air_date: e.air_date, runtime: e.runtime,
      still: img(e.still_path, 'w300'), rating: e.vote_average ? Math.round(e.vote_average * 10) / 10 : null })) };
  }
  /** Used by importers: find the best TMDB match for a title (+ optional year). */
  async match(title, year, type = 'movie') {
    const tries = [];
    if (year) tries.push([`/search/${type}`, { query: title, [type === 'movie' ? 'primary_release_year' : 'first_air_date_year']: year }]);
    tries.push([`/search/${type}`, { query: title }]);
    for (const [p, params] of tries) {
      const d = await this.get(p, { ...params, include_adult: 'false' }, 864e5);
      const best = scoreMatches(title, year, cards(d.results, type));
      if (best) return best;
    }
    return null;
  }
}

// ---- matching helpers (shared with demo catalog) --------------------------------
export const norm = (s) => String(s || '').toLowerCase().normalize('NFKD').replace(/[\u0300-\u036f]/g, '')
  .replace(/&/g, ' and ').replace(/^(the|a|an)\s+/, '').replace(/[^a-z0-9]+/g, ' ').trim();
function similarity(a, b) {
  a = norm(a); b = norm(b);
  if (!a || !b) return 0;
  if (a === b) return 1;
  const A = new Set(a.split(' ')), B = new Set(b.split(' '));
  const inter = [...A].filter((w) => B.has(w)).length;
  return inter / Math.max(A.size, B.size);
}
export function scoreMatches(title, year, list) {
  let best = null;
  list.forEach((c, i) => {
    let s = similarity(title, c.title);
    if (year && c.year) s -= Math.min(Math.abs(c.year - year), 5) * 0.08;
    else if (year && !c.year) s -= 0.1;
    s -= i * 0.01; // prefer TMDB's own ranking slightly
    if (!best || s > best.score) best = { ...c, score: Math.round(s * 100) / 100 };
  });
  return best && best.score >= 0.6 ? best : null;
}
