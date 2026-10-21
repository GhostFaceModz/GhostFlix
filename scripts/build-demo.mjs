// Builds data/demo.json — a small, offline-friendly demo catalog of public-domain
// titles hosted on the Internet Archive. Used when TMDB_API_KEY is not set.
// Run: node scripts/build-demo.mjs
import { writeFile } from 'node:fs/promises';

const MOVIES = [
  'Night.Of.The.Living.Dead_1080p', 'his_girl_friday', 'Nosferatu_most_complete_version_93_mins.',
  'The_General_Buster_Keaton', 'Detour', 'house_on_haunted_hill_ipod', 'Charade_1953',
  'CarnivalofSouls', 'DasKabinettdesDoktorCaligariTheCabinetofDrCaligari', 'ScarletStreet',
  'TheStranger_0', 'meet_john_doe', 'Sita_Sings_the_Blues', 'gullivers_travels1939',
  'ThePhantomoftheOpera', 'lost_world', 'Horror_Express', 'Hitchcock_Secret_Agent',
  'mclintok_widescreen', 'royal_wedding', 'TheFlyingDeuces', 'suddenly', 'BattleshipPotemkin',
  'secret_weapon', 'penny_serenade', 'Quicksand_clear', 'JungleBook', 'my_favorite_brunette',
  'teenagers_from_outerspace', 'Killers_from_space', 'TheGhoul', 'dressed_to_kill',
  'plan-9-from-outer-space', 'Cyrano_DeBergerac', 'impact', 'little_princess',
];
// Ordered by original air date (Oct 1954 onward).
const SHERLOCK = [
  'SherlockHolmes-TheCaseoftheCunninghamHeritage', 'SherlockHolmes-TheCaseofLadyBeryl',
  'SherlockHolmes-TheCaseofthePennsylvaniaGun', 'SherlockHolmes-TheCaseoftheTexasCowgirl',
  'SherlockHolmes-TheCaseoftheBelligerentGhost', 'SherlockHolmes-TheCaseoftheShyBallerina',
  'SherlockHolmes-TheCaseOfTheRedHeadedLeague', 'SherlockHolmes-TheCaseOfTheFrenchInterpreter_714',
  'SherlockHolmes-TheCaseOfTheSingingViolin', 'SherlockHolmes-TheCaseOfTheEiffelTower',
  'SherlockHolmes-TheCaseOfTheHauntedGainsborough', 'SherlockHolmes-TheCaseOfTheDiamondTooth',
];

// Genre ids mirror TMDB's genre ids so the UI behaves identically in both modes.
const GENRES = { 28: 'Action', 12: 'Adventure', 16: 'Animation', 35: 'Comedy', 80: 'Crime', 18: 'Drama',
  14: 'Fantasy', 27: 'Horror', 9648: 'Mystery', 10749: 'Romance', 878: 'Science Fiction', 53: 'Thriller',
  10752: 'War', 37: 'Western', 10402: 'Music', 36: 'History', 10751: 'Family' };
const KEYWORDS = [
  [/horror|vampire|zombie|haunted|ghoul/i, 27], [/comedy|laurel|stooges/i, 35], [/noir|crime|gangster/i, 80],
  [/mystery|sherlock|detective/i, 9648], [/thriller|suspense|spy/i, 53], [/sci-?fi|science fiction|space|outer/i, 878],
  [/western/i, 37], [/adventure|tarzan|jungle/i, 12], [/fantasy|fairy/i, 14], [/animat|cartoon/i, 16],
  [/romance|romantic/i, 10749], [/war\b|nazi/i, 10752], [/musical|dance|music/i, 10402], [/drama/i, 18],
  [/history|historical/i, 36], [/action/i, 28],
];
const OVERRIDES = {
  'Night.Of.The.Living.Dead_1080p': { genres: [27, 53] }, 'his_girl_friday': { genres: [35, 10749] },
  'The_General_Buster_Keaton': { genres: [35, 12, 10752] }, 'Detour': { genres: [80, 18, 53] },
  'Charade_1953': { genres: [80, 18, 9648] }, 'Sita_Sings_the_Blues': { genres: [16, 10402, 14] },
  'gullivers_travels1939': { genres: [16, 12, 14] }, 'Hitchcock_Secret_Agent': { genres: [53, 9648] },
  'meet_john_doe': { genres: [35, 18] }, 'BattleshipPotemkin': { genres: [18, 36, 10752] },
  'Nosferatu_most_complete_version_93_mins.': { genres: [27, 14] }, 'plan-9-from-outer-space': { genres: [878, 27] },
  'secret_weapon': { genres: [9648, 80] }, 'dressed_to_kill': { genres: [9648, 80] },
  'Cyrano_DeBergerac': { genres: [18, 10749] }, 'little_princess': { genres: [18, 10751] },
};

// Hand-written blurbs where the archive description is just a link/note.
const TEXT = {
  'Night.Of.The.Living.Dead_1080p': ['Night of the Living Dead', 'A group of strangers barricade themselves inside a rural Pennsylvania farmhouse as the recently dead rise and lay siege. George A. Romero\'s low-budget landmark that reinvented the horror film.'],
  'Nosferatu_most_complete_version_93_mins.': ['Nosferatu', 'Estate agent Hutter travels to the Carpathian mountains to sell a house to the mysterious Count Orlok — and unleashes a plague upon his hometown. F. W. Murnau\'s silent expressionist masterpiece.'],
  'The_General_Buster_Keaton': ['The General', 'When Union spies steal his beloved locomotive — with his sweetheart aboard — Southern engineer Johnnie Gray gives chase in one of the greatest action-comedies ever filmed. Starring Buster Keaton.'],
  'Detour': [null, 'A down-on-his-luck nightclub pianist hitchhikes west to reunite with his girlfriend, but a sudden death and a ruthless stranger drag him into a nightmare. A lean, fatalistic film noir classic.'],
  'Charade_1953': [null, 'An anthology of three stories of intrigue and romance, starring James Mason and Pamela Mason.'],
  'DasKabinettdesDoktorCaligariTheCabinetofDrCaligari': ['The Cabinet of Dr. Caligari', 'A sinister showman and his sleepwalking servant arrive at a village fair — and a string of murders follows. The towering work of German Expressionist cinema.'],
  'meet_john_doe': [null, 'A fired reporter invents a fictional everyman who threatens suicide in protest of social ills — then hires a drifter to play him, igniting a national movement. Directed by Frank Capra, starring Gary Cooper and Barbara Stanwyck.'],
  'gullivers_travels1939': [null, 'Shipwrecked sailor Lemuel Gulliver washes ashore in Lilliput, a tiny kingdom on the brink of war over a wedding song. The Fleischer Studios animated feature.'],
  'Hitchcock_Secret_Agent': [null, 'During the First World War, a British novelist is sent to Switzerland under a false identity to hunt down an enemy agent. An early Alfred Hitchcock spy thriller.'],
  'mclintok_widescreen': [null, 'A rough-and-tumble cattle baron\'s life is turned upside down when his estranged wife returns to town. John Wayne and Maureen O\'Hara in a rowdy comedy western.'],
  'my_favorite_brunette': [null, 'A baby photographer who dreams of being a private eye gets mistaken for one — and tangled up with a beautiful woman and a gang of crooks. Bob Hope and Dorothy Lamour.'],
  'Killers_from_space': [null, 'A scientist survives a plane crash near a nuclear test site, only to discover that aliens with bulging eyes are plotting to conquer Earth.'],
  'BattleshipPotemkin': ['Battleship Potemkin', 'Sailors aboard a Russian battleship mutiny against their officers in 1905, sparking an uprising in Odessa. Sergei Eisenstein\'s revolutionary silent film.'],
  'little_princess': ['The Little Princess', 'When her father goes missing in the Boer War, wealthy schoolgirl Sara Crewe is reduced to a servant at her boarding school — but never loses hope. Starring Shirley Temple.'],
  'Cyrano_DeBergerac': [null, 'France, 1640: Cyrano, a brilliant swordsman and poet cursed with an enormous nose, secretly helps a handsome rival woo the woman he loves. José Ferrer won an Oscar for the role.'],
};
const strip = (s = '') => String(Array.isArray(s) ? s.join(' ') : s)
  .replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;/g, "'")
  .replace(/https?:\/\/\S+/g, '').replace(/\s+/g, ' ').trim();
const clip = (s, n = 420) => (s.length > n ? s.slice(0, s.lastIndexOf(' ', n)) + '…' : s);
const cleanTitle = (t) => strip(Array.isArray(t) ? t[0] : t)
  .replace(/\((?:the )?[^)]*\)$/i, (m) => (/\d{4}|hd|ipod|complete|colorized|full movie/i.test(m) ? '' : m))
  .replace(/\b(full movie|hd|ipod)\b/gi, '').replace(/\s{2,}/g, ' ').trim();

async function meta(id) {
  const r = await fetch(`https://archive.org/metadata/${encodeURIComponent(id)}`);
  if (!r.ok) throw new Error(`${id}: ${r.status}`);
  return r.json();
}
function bestImage(id, files) {
  const imgs = files.filter((f) => /^(JPEG|PNG)$/.test(f.format || '') && !/thumb|__ia_thumb/i.test(f.name))
    .map((f) => ({ ...f, size: +f.size || 0 })).filter((f) => f.size > 15000 && f.size < 4e6)
    .sort((a, b) => b.size - a.size);
  return imgs[0] ? `https://archive.org/download/${encodeURIComponent(id)}/${encodeURIComponent(imgs[0].name)}`
    : `https://archive.org/services/img/${encodeURIComponent(id)}`;
}
function genresFor(id, m) {
  if (OVERRIDES[id]?.genres) return OVERRIDES[id].genres.filter((g) => GENRES[g]);
  const hay = [m.subject, m.title, m.description].flat().filter(Boolean).join(' ');
  const out = [];
  for (const [re, g] of KEYWORDS) if (re.test(hay) && !out.includes(g)) out.push(g);
  return (out.length ? out : [18]).slice(0, 3);
}
const yearOf = (m) => +(String(m.year || m.date || '').match(/(18|19|20)\d{2}/) || [])[0] || null;
const runtimeMin = (r) => { if (!r) return null; const p = String(r).split(':').map(Number);
  if (p.length === 3) return p[0] * 60 + p[1]; if (p.length === 2) return p[0]; const n = parseInt(r, 10); return n > 400 ? Math.round(n / 60) : n || null; };

const titles = [];
let n = 1;
for (const id of MOVIES) {
  try {
    const d = await meta(id); const m = d.metadata || {};
    const img = bestImage(id, d.files || []);
    const [tt, ov] = TEXT[id] || [];
    titles.push({ id: 900000 + n++, media_type: 'movie', title: tt || cleanTitle(m.title), year: yearOf(m),
      overview: ov || clip(strip(m.description).replace(/^(From IMDb\s*:|IMDb page)\s*/i, '')) || 'A public-domain classic from the Internet Archive.',
      genre_ids: genresFor(id, m), runtime: runtimeMin(m.runtime), poster: img, backdrop: img,
      creator: strip(m.creator || m.director || ''), ia: id, license: 'Public domain / open license (Internet Archive)' });
    process.stdout.write('.');
  } catch (e) { console.warn('\nskip', id, e.message); }
}
// Demo series
const eps = [];
let first = null;
for (const id of SHERLOCK) {
  try {
    const d = await meta(id); const m = d.metadata || {};
    first ||= bestImage(id, d.files || []);
    eps.push({ episode_number: eps.length + 1, name: cleanTitle(m.title).replace(/^Sherlock Holmes\s*-\s*/i, ''),
      overview: clip(strip(m.description).replace(/^.*?(Originally aired [A-Za-z]+ \d+(st|nd|rd|th)?, \d{4}\.?|Season 1, Ep(isode)? \d+(: The Case of [\w' -]+?(?= [A-Z][a-z]+ (is|was)|$))?)\s*(\|\s*Originally Aired - [^|]+)?/i, '').trim(), 260) || 'A classic Holmes and Watson mystery.', runtime: runtimeMin(m.runtime) || 26, still: `https://archive.org/services/img/${encodeURIComponent(id)}`, ia: id });
    process.stdout.write('+');
  } catch (e) { console.warn('\nskip', id, e.message); }
}
titles.push({ id: 900500, media_type: 'tv', title: 'Sherlock Holmes (1954)', year: 1954,
  overview: 'Ronald Howard and H. Marion Crawford star as Holmes and Watson in this 1950s television series, many episodes of which are in the public domain and preserved on the Internet Archive. (Demo: episode order is approximate.)',
  genre_ids: [9648, 80], poster: first, backdrop: first, ia: null,
  seasons: [{ season_number: 1, name: 'Season 1', episodes: eps }], license: 'Public domain (Internet Archive)' });

await writeFile(new URL('../data/demo.json', import.meta.url), JSON.stringify({ generated: new Date().toISOString(), genres: GENRES, titles }, null, 1));
console.log(`\nwrote ${titles.length} titles`);
