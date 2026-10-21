import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseSource, playerFor, validatePattern, fillPattern, GENERIC_SANDBOX } from '../server/sources.js';
import { parseTitle, detectImport } from '../server/importers.js';
import { toVtt } from '../server/subtitles.js';

test('allowlisted providers parse and rebuild embeds', () => {
  assert.equal(playerFor(parseSource('https://youtu.be/dQw4w9WgXcQ')).src.startsWith('https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ'), true);
  assert.equal(parseSource('https://vimeo.com/76979871').provider, 'vimeo');
  assert.equal(parseSource('archive.org/details/his_girl_friday').id, 'his_girl_friday');
  assert.equal(parseSource('https://www.dailymotion.com/video/x8abc12').provider, 'dailymotion');
  assert.equal(parseSource('https://iframe.mediadelivery.net/embed/12345/1b2c3d4e-1111-2222-3333-444455556666').provider, 'bunny');
  assert.equal(parseSource('https://customer-abc123.cloudflarestream.com/0123456789abcdef0123456789abcdef/iframe').provider, 'cloudflare');
  assert.equal(parseSource('https://archive.org/download/Detour/Detour.mp4').provider, 'archive');
});
test('every host is accepted — nothing is blocked', () => {
  for (const u of ['https://vidsrc.to/embed/movie/550', 'https://vidsrc.me/embed/1', 'https://vidsrc.xyz/embed/movie/1', 'https://vidsrc.net/x', 'https://vidcore.org/x',
    'https://www.2embed.cc/embed/550', 'https://multiembed.mov/?video_id=550', 'https://superembed.stream/x', 'https://embed.su/embed/movie/1',
    'https://autoembed.cc/x', 'https://vidlink.pro/movie/1', 'https://player.smashystream.com/x', 'https://moviesapi.club/movie/1',
    '<iframe src="https://vidsrc.to/embed/movie/1"></iframe>', 'https://own.example/proxy?u=https://vidsrc.to/x']) {
    assert.equal(parseSource(u).provider, 'embed', u);
  }
});
test('any other http(s) link is accepted', () => {
  const e = parseSource('https://media.example.com/watch/abc');
  assert.equal(e.provider, 'embed');
  const p = playerFor(e); assert.equal(p.kind, 'iframe'); assert.equal(p.sandbox, ''); assert.equal(p.sandbox, GENERIC_SANDBOX);
  assert.equal(parseSource('https://cdn.example.com/film.mp4').provider, 'file');
  assert.equal(parseSource('https://cdn.example.com/hls/master.m3u8').provider, 'hls');
  assert.equal(parseSource('<iframe src="https://player.example.net/e/1" allowfullscreen></iframe>').id, 'https://player.example.net/e/1');
  assert.throws(() => parseSource('javascript:alert(1)'));
  assert.throws(() => parseSource('ftp://example.com/a.mp4'));
});
test('link patterns', () => {
  assert.equal(validatePattern('movie', 'https://media.example.com/movie/{tmdb_id}'), 'https://media.example.com/movie/{tmdb_id}');
  assert.equal(fillPattern('https://m.example.com/tv/{tmdb_id}/{season}/{episode}', { tmdb_id: 1399, season: 2, episode: 5 }), 'https://m.example.com/tv/1399/2/5');
  assert.throws(() => validatePattern('tv', 'https://media.example.com/tv/{tmdb_id}'), /must contain/);
  assert.equal(validatePattern('movie', 'https://vidsrc.to/embed/movie/{tmdb_id}'), 'https://vidsrc.to/embed/movie/{tmdb_id}');
  assert.throws(() => validatePattern('movie', 'https://{tmdb_id}.example.com/x'));
  assert.equal(validatePattern('movie', ''), '');
});
test('title parsing', () => {
  assert.deepEqual(parseTitle('Night of the Living Dead (1968) | Full Movie | HD'), { title: 'Night of the Living Dead', year: 1968, season: null, episode: null });
  assert.equal(parseTitle('Sherlock Holmes S01E07 The Red Headed League').episode, 7);
  assert.equal(parseTitle('2001: A Space Odyssey').title, '2001: A Space Odyssey');
});
test('import URL detection', () => {
  assert.deepEqual(detectImport('https://archive.org/details/feature_films'), { kind: 'archive', collection: 'feature_films' });
  assert.equal(detectImport('https://www.youtube.com/playlist?list=PL123').playlist, 'PL123');
  assert.equal(detectImport('https://example.com'), null);
  assert.equal(detectImport('https://vidsrc.to/vapi/movie/new'), null);
});
test('srt -> vtt', () => {
  const v = toVtt('1\n00:00:01,000 --> 00:00:02,500\n<script>x</script>Hello <i>there</i>\n');
  assert.match(v, /^WEBVTT/); assert.match(v, /00:00:01\.000 --> 00:00:02\.500/); assert.doesNotMatch(v, /script/); assert.match(v, /<i>there<\/i>/);
});
