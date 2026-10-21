// Tiny persistent store: one JSON document.
// Backends:
//   * file (default) — DATA_DIR/store.json, atomic writes. On Render's free tier the disk is
//     ephemeral, so the store also boots from data/seed-store.json (commit an Admin export there).
//   * Supabase (optional, free tier) — set SUPABASE_URL + SUPABASE_SERVICE_KEY; the document is
//     kept in table `ghostflix_store` (see README for the one-line SQL).
import { readFile, writeFile, rename, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const empty = () => ({ version: 1, sources: {}, titles: {}, subs: {}, unmatched: [], jobs: [], updatedAt: null });

export class Store {
  constructor(env = process.env) {
    this.env = env;
    this.dir = path.resolve(ROOT, env.DATA_DIR || 'data');
    this.file = path.join(this.dir, 'store.json');
    this.seed = path.join(ROOT, 'data', 'seed-store.json');
    this.supa = env.SUPABASE_URL && env.SUPABASE_SERVICE_KEY ? { url: env.SUPABASE_URL.replace(/\/$/, ''), key: env.SUPABASE_SERVICE_KEY } : null;
    this.data = empty();
    this._saving = Promise.resolve();
  }
  get backend() { return this.supa ? 'supabase' : 'file'; }

  async load() {
    let doc = null;
    if (this.supa) {
      try {
        const r = await fetch(`${this.supa.url}/rest/v1/ghostflix_store?id=eq.main&select=data`, { headers: this._supaHeaders() });
        if (r.ok) { const rows = await r.json(); doc = rows[0]?.data || null; } else console.warn('[store] supabase load failed', r.status);
      } catch (e) { console.warn('[store] supabase load error', e.message); }
    } else if (existsSync(this.file)) {
      doc = JSON.parse(await readFile(this.file, 'utf8'));
    }
    if (!doc && existsSync(this.seed)) { doc = JSON.parse(await readFile(this.seed, 'utf8')); console.log('[store] booted from data/seed-store.json'); }
    this.data = { ...empty(), ...(doc || {}) };
    return this;
  }
  _supaHeaders() { return { apikey: this.supa.key, Authorization: `Bearer ${this.supa.key}`, 'Content-Type': 'application/json' }; }

  save() {
    this.data.updatedAt = new Date().toISOString();
    const snapshot = JSON.stringify(this.data, null, 1);
    this._saving = this._saving.then(async () => {
      if (this.supa) {
        const r = await fetch(`${this.supa.url}/rest/v1/ghostflix_store`, { method: 'POST',
          headers: { ...this._supaHeaders(), Prefer: 'resolution=merge-duplicates' }, body: JSON.stringify({ id: 'main', data: JSON.parse(snapshot) }) });
        if (!r.ok) console.warn('[store] supabase save failed', r.status, await r.text());
      } else {
        await mkdir(this.dir, { recursive: true });
        await writeFile(this.file + '.tmp', snapshot);
        await rename(this.file + '.tmp', this.file);
      }
    }).catch((e) => console.error('[store] save error', e));
    return this._saving;
  }

  // ---- sources -------------------------------------------------------------
  static key(type, id, s, e) { return `${type}:${id}${s != null && e != null && s !== '' && e !== '' ? `:s${+s}e${+e}` : ''}`; }
  sourcesFor(key) { return this.data.sources[key] || []; }
  hasAnyFor(type, id) { const p = `${type}:${id}`; return Object.keys(this.data.sources).some((k) => (k === p || k.startsWith(p + ':')) && this.data.sources[k].length); }
  addSource(key, src, meta = {}) {
    const list = (this.data.sources[key] ||= []);
    if (list.some((x) => x.provider === src.provider && x.id === src.id && (x.file || '') === (src.file || ''))) return null;
    const entry = { ...src, sid: crypto.randomBytes(5).toString('hex'), label: meta.label || '', origin: meta.origin || 'manual', addedAt: new Date().toISOString() };
    list.push(entry);
    return entry;
  }
  removeSource(sid) {
    for (const [k, list] of Object.entries(this.data.sources)) {
      const i = list.findIndex((x) => x.sid === sid);
      if (i >= 0) { list.splice(i, 1); if (!list.length) delete this.data.sources[k]; return true; }
    }
    return false;
  }
  allSources() {
    return Object.entries(this.data.sources).flatMap(([key, list]) => list.map((s) => ({ key, ...s, title: this.data.titles[key.split(':').slice(0, 2).join(':')] || null })));
  }
  rememberTitle(type, card) {
    if (!card) return;
    const { id, title, year, poster, backdrop, overview, genre_ids, rating } = card;
    this.data.titles[`${type}:${id}`] = { id, media_type: type, title, year, poster, backdrop, overview, genre_ids, rating };
  }
  playableCards() {
    const seen = new Set();
    return Object.keys(this.data.sources).map((k) => k.split(':').slice(0, 2).join(':')).filter((k) => !seen.has(k) && seen.add(k))
      .map((k) => this.data.titles[k]).filter(Boolean).reverse();
  }
}
