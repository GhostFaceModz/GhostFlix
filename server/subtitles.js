// Subtitle helpers: SRT -> WebVTT conversion + light sanitising.
export function toVtt(text, filename = '') {
  let t = String(text || '').replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n').trim();
  if (!t) throw Object.assign(new Error('Subtitle file is empty.'), { status: 400 });
  if (t.length > 2_000_000) throw Object.assign(new Error('Subtitle file is too large (2 MB max).'), { status: 400 });
  const isVtt = /^WEBVTT/.test(t);
  if (!isVtt) {
    if (!/\d{2}:\d{2}:\d{2}[,.]\d{3}\s*-->/.test(t)) throw Object.assign(new Error(`Not a valid .srt or .vtt file${filename ? ` (${filename})` : ''}.`), { status: 400 });
    t = 'WEBVTT\n\n' + t
      .replace(/^\d+\n(?=\d{2}:\d{2}:\d{2}[,.]\d{3})/gm, '')                       // drop SRT cue numbers
      .replace(/(\d{2}:\d{2}:\d{2}),(\d{3})/g, '$1.$2')                             // comma -> dot
      .replace(/\{\\an?\d+\}/g, '');                                                // strip SSA position tags
  }
  // Strip anything that could be markup beyond the VTT cue tags (b, i, u, c, v, lang, ruby, rt).
  t = t.replace(/<(?!\/?(?:b|i|u|c|v|lang|ruby|rt)(?:[\s.>]|$))[^>]*>/gi, '').replace(/<font[^>]*>|<\/font>/gi, '');
  return t + '\n';
}
