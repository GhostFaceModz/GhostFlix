// Demo catalog: same interface as TmdbCatalog, backed by data/demo.json (public-domain
// titles on the Internet Archive). Lets GhostFlix render — and actually play films —
// before a TMDB key is configured.
import { readFileSync } from 'node:fs';
import { scoreMatches } from './tmdb.js';

export class DemoCatalog {
  constructor(file = new URL('../data/demo.json', import.meta.url)) {
    const d = JSON.parse(readFileSync(file, 'utf8'));
    this.mode = 'demo';
    this.genreMap = d.genres;
    this.titles = d.titles;
    this.byKey = new Map(d.titles.map((t) => [`${t.media_type}:${t.id}`, t]));
  }
  card(t) { return { id: t.id, media_type: t.media_type, title: t.title, year: t.year, overview: t.overview, poster: t.poster, backdrop: t.backdrop, rating: null, genre_ids: t.genre_ids, demo: true }; }
  page(arr, page = 1, per = 20) { const p = Math.max(1, +page || 1); return { page: p, total_pages: Math.max(1, Math.ceil(arr.length / per)), results: arr.slice((p - 1) * per, p * per).map((t) => this.card(t)) }; }
  ofType(type) { return this.titles.filter((t) => type === 'all' || t.media_type === type); }
  async genres() {
    const used = (type) => [...new Set(this.ofType(type).flatMap((t) => t.genre_ids))].map((id) => ({ id: +id, name: this.genreMap[id] })).filter((g) => g.name).sort((a, b) => a.name.localeCompare(b.name));
    return { movie: used('movie'), tv: used('tv') };
  }
  sorted(type, category) {
    const arr = this.ofType(type);
    if (category === 'top_rated') return [...arr].sort((a, b) => (a.year || 0) - (b.year || 0));
    if (category === 'popular') return [...arr].sort((a, b) => a.title.localeCompare(b.title));
    return arr;
  }
  async list(type, category, page) { return this.page(this.sorted(type, category), page); }
  async discover(type, genre, page) { return this.page(this.ofType(type).filter((t) => t.genre_ids.includes(+genre)), page); }
  async search(q, page) {
    const n = q.toLowerCase();
    return this.page(this.titles.filter((t) => t.title.toLowerCase().includes(n) || (t.overview || '').toLowerCase().includes(n) || (t.creator || '').toLowerCase().includes(n)), page);
  }
  async home() {
    const all = this.titles;
    const heroIds = ['Night of the Living Dead', 'Nosferatu', 'His Girl Friday', 'The General', 'Sherlock Holmes (1954)'];
    const hero = heroIds.map((n) => all.find((t) => t.title === n)).filter(Boolean).map((t) => this.card(t));
    const g = (id) => all.filter((t) => t.genre_ids.includes(id)).map((t) => this.card(t));
    const rows = [
      { id: 'trending', title: 'Trending in the vault', link: '/browse/all/trending', items: all.slice(0, 14).map((t) => this.card(t)) },
      { id: 'top10', title: 'Top 10 classics', top10: true, items: all.slice(0, 10).map((t) => this.card(t)) },
      { id: 'series', title: 'Series', link: '/tv', items: this.ofType('tv').map((t) => this.card(t)) },
      { id: 'horror', title: 'Midnight horror', link: '/genre/movie/27', items: g(27) },
      { id: 'comedy', title: 'Golden-age comedy', link: '/genre/movie/35', items: g(35) },
      { id: 'noir', title: 'Crime & noir', link: '/genre/movie/80', items: g(80) },
      { id: 'mystery', title: 'Mystery & suspense', link: '/genre/movie/9648', items: [...new Map([...g(9648), ...g(53)].map((c) => [c.id, c])).values()] },
      { id: 'scifi', title: 'Retro sci-fi & fantasy', link: '/genre/movie/878', items: [...new Map([...g(878), ...g(14)].map((c) => [c.id, c])).values()] },
      { id: 'silent', title: 'Silent era', items: all.filter((t) => t.year && t.year < 1930).map((t) => this.card(t)) },
      { id: 'top-rated', title: 'Oldest first', link: '/browse/movie/top_rated', items: this.sorted('movie', 'top_rated').slice(0, 20).map((t) => this.card(t)) },
    ];
    return { mode: 'demo', genres: await this.genres(), hero, rows };
  }
  async discoverPage() {
    const h = await this.home(); const by = (id) => h.rows.find((r) => r.id === id)?.items || [];
    return { top10: by('top10'), rows: [{ id: 'trending', title: 'Trending in the vault', items: by('trending') }, { id: 'series', title: 'Series', items: by('series') }, { id: 'silent', title: 'Silent era', items: by('silent') }],
      moods: [{ id: 'spooky', title: 'After dark', items: by('horror') }, { id: 'feelgood', title: 'Feel-good picks', items: by('comedy') }, { id: 'edge', title: 'Edge of your seat', items: by('mystery') }, { id: 'mind', title: 'Mind-benders', items: by('scifi') }] };
  }
  async title(type, id) {
    const t = this.byKey.get(`${type}:${id}`);
    if (!t) { const e = new Error('Not found'); e.status = 404; throw e; }
    const rec = this.titles.filter((x) => x !== t && x.genre_ids.some((g) => t.genre_ids.includes(g))).slice(0, 14).map((x) => this.card(x));
    return {
      ...this.card(t), backdrop_sm: t.backdrop, tagline: '', status: 'Released', certification: null, runtime: t.runtime || null,
      genres: t.genre_ids.map((id) => ({ id, name: this.genreMap[id] })).filter((g) => g.name), release_date: t.year ? String(t.year) : null,
      directors: t.creator ? [t.creator] : [], created_by: [], cast: [], trailers: [], languages: [],
      providers: { region: 'ALL', link: t.ia ? `https://archive.org/details/${t.ia}` : 'https://archive.org', free: [{ id: 'ia', name: 'Internet Archive', logo: '/img/ia.svg' }], flatrate: [], ads: [], rent: [], buy: [] },
      license: t.license, ia: t.ia,
      seasons: t.seasons ? t.seasons.map((s) => ({ season_number: s.season_number, name: s.name, episode_count: s.episodes.length, poster: t.poster })) : null,
      number_of_seasons: t.seasons?.length || null, recommendations: rec,
    };
  }
  async season(id, n) {
    const t = this.byKey.get(`tv:${id}`);
    const s = t?.seasons?.find((x) => x.season_number === +n);
    if (!s) { const e = new Error('Not found'); e.status = 404; throw e; }
    return { season_number: s.season_number, name: s.name, episodes: s.episodes.map(({ ia, ...e }) => e) };
  }
  /** Built-in playable sources for demo titles (Internet Archive items). */
  demoSources(type, id, s, e) {
    const t = this.byKey.get(`${type}:${id}`);
    if (!t) return [];
    if (type === 'movie' && t.ia) return [{ provider: 'archive', id: t.ia, label: 'Internet Archive', origin: 'demo' }];
    if (type === 'tv') {
      const ep = t.seasons?.find((x) => x.season_number === (+s || 1))?.episodes.find((x) => x.episode_number === (+e || 1));
      if (ep?.ia) return [{ provider: 'archive', id: ep.ia, label: 'Internet Archive', origin: 'demo' }];
    }
    return [];
  }
  async match(title, year, type = 'movie') { return scoreMatches(title, year, this.ofType(type).map((t) => this.card(t))); }
}
