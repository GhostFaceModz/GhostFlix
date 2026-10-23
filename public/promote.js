// "Promote GhostFlix": the /promote page (personal referral link, own stats, public top 10) plus ?ref= link tracking.
// A ?ref=CODE visit is remembered on this device for 30 days and counted once a day; if that visitor then creates a
// NEW account, it's credited to the promoter once (the server re-checks: no self-referrals, no existing accounts).
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const $ = (s, r = document) => r.querySelector(s);
const REF = 'gf.ref', DAY = 864e5, KEEP = 30 * DAY, CODE_RE = /^[A-Za-z0-9]{4,16}$/;
const DISCORD = 'https://discord.gg/zenclipsdaily';
const ls = { get: (k) => { try { return JSON.parse(localStorage.getItem(k)); } catch { return null; } }, set: (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} }, del: (k) => { try { localStorage.removeItem(k); } catch {} } };
const storedToken = () => { try { return JSON.parse(localStorage.getItem('ghostflix-auth'))?.access_token || null; } catch { return null; } };
const fmt = (n) => Number(n || 0).toLocaleString();

export function createPromote(ctx) {
  // ctx: { call (signed-in fetch), auth(), toast, main }
  const pending = () => { const r = ls.get(REF); if (!r || !CODE_RE.test(r.code || '') || Date.now() - r.at > KEEP) { if (r) ls.del(REF); return null; } return r; };

  // Run on every page load: remember ?ref=CODE, count the click once per day per device, tidy the URL.
  function captureRef() {
    const u = new URL(location.href); const code = (u.searchParams.get('ref') || '').trim();
    if (!u.searchParams.has('ref')) return;
    u.searchParams.delete('ref'); history.replaceState(history.state, '', u.pathname + (u.search || '') + u.hash);
    if (!CODE_RE.test(code)) return;
    const cur = pending(); if (!cur || cur.code.toLowerCase() !== code.toLowerCase()) ls.set(REF, { code, at: Date.now() });
    const seenKey = `gf.refc.${code.toLowerCase()}`; if (Date.now() - (Number(localStorage.getItem(seenKey)) || 0) < DAY) return;
    try { localStorage.setItem(seenKey, String(Date.now())); } catch {}
    const t = storedToken();
    fetch('/api/ref/click', { method: 'POST', headers: { 'Content-Type': 'application/json', ...(t ? { Authorization: `Bearer ${t}` } : {}) }, body: JSON.stringify({ code }), keepalive: true })
      .then((r) => (r.status === 404 ? ls.del(REF) : null)).catch(() => {});
  }

  // After sign-in: if this device arrived via a promoter's link BEFORE this account existed, credit them (once).
  let claiming = false;
  async function claim() {
    const user = ctx.auth()?.user; const r = pending(); if (!user || !r || claiming) return;
    const made = Date.parse(user.created_at || '');
    if (!Number.isFinite(made) || r.at > made + 60e3 || Date.now() - made > 2 * 3600e3) { ls.del(REF); return; } // existing account: never attributed
    claiming = true;
    try { const j = await ctx.call('/api/ref/claim', { method: 'POST', body: { code: r.code } }); ls.del(REF); if (j.ok) ctx.toast('👻 Welcome to GhostFlix! Your friend’s invite was counted.'); }
    catch (e) { if (e.status && e.status < 500 && e.status !== 429) ls.del(REF); }
    finally { claiming = false; }
  }

  async function authReady() {
    const a = ctx.auth(); if (!a?.enabled || a.user) return;
    try { const c = await Promise.race([a.client(), new Promise((r) => setTimeout(r, 3000))]); if (c?.auth) await Promise.race([c.auth.getSession(), new Promise((r) => setTimeout(r, 2500))]); } catch {}
  }

  const ordinal = (n) => { const s = ['th', 'st', 'nd', 'rd'], v = n % 100; return n + (s[(v - 20) % 10] || s[v] || s[0]); };
  const boardHTML = (top) => top.length
    ? `<ol class="pr-board">${top.map((r) => `<li><span class="pr-rk${r.rank <= 3 ? ' top' : ''}">${r.rank}</span><b>${esc(r.name)}</b><span class="dim">${fmt(r.signups)} sign-up${r.signups === 1 ? '' : 's'}</span></li>`).join('')}</ol>`
    : '<p class="dim pr-none">No sign-ups yet — the top spot is wide open. 👀</p>';
  const linkHTML = (me) => `<div class="pr-link"><input id="prLink" readonly value="${esc(me.link)}" aria-label="Your referral link"><button class="btn cta sm" type="button" id="prCopy">Copy</button></div>
    <div class="pr-share">${navigator.share ? '<button class="btn dark sm" type="button" id="prShare">Share…</button>' : ''}
      <a class="btn dark sm" target="_blank" rel="noopener" href="https://x.com/intent/post?text=${encodeURIComponent('Free movies, series & live TV on GhostFlix 👻 ' + me.link)}">Post on X</a>
      <a class="btn dark sm" target="_blank" rel="noopener" href="https://wa.me/?text=${encodeURIComponent('Check out GhostFlix 👻 ' + me.link)}">WhatsApp</a>
      <a class="btn dark sm" target="_blank" rel="noopener" href="https://www.reddit.com/submit?url=${encodeURIComponent(me.link)}&title=${encodeURIComponent('GhostFlix — movies, series & live TV')}">Reddit</a></div>
    <div class="pr-stats"><div><b>${fmt(me.clicks)}</b><small>Link clicks</small></div><div><b>${fmt(me.signups)}</b><small>Sign-ups</small></div><div><b>${me.rank ? ordinal(me.rank) : '—'}</b><small>Leaderboard</small></div></div>
    <p class="dim small">Clicks count once per person per day. A sign-up counts when someone makes a brand-new GhostFlix account after opening your link. TikTok and Instagram don’t have share links — copy yours and put it in your bio, caption or story.</p>`;

  async function viewPromote() {
    const main = ctx.main; document.title = 'Promote GhostFlix — GhostFlix';
    main.innerHTML = '<div class="page narrow promote"><h1>Promote GhostFlix</h1><div class="skel" style="height:220px;border-radius:16px"></div></div>';
    let info = { reward: 'Bloodstrike Gold rewards for every person who joins with your link', top: [] };
    const [, got] = await Promise.all([authReady(), fetch('/api/promo', { cache: 'no-store' }).then((r) => (r.ok ? r.json() : null)).catch(() => null)]);
    if (got) info = got; if (location.pathname !== '/promote') return;
    const signed = !!ctx.auth()?.user; const canDiscord = !!ctx.auth()?.enabled;
    main.innerHTML = `<div class="page narrow promote">
      <div class="pr-hero"><img src="/img/logo.svg" alt="" width="56" height="56"><div><h1>Promote GhostFlix</h1><p class="lead">Bring your people to GhostFlix and get rewarded for it.</p></div></div>
      <div class="set-group pad pr-reward"><small class="dim">🎁 The reward</small><b>${esc(info.reward)}</b></div>
      <h2 class="fr-h">How it works</h2>
      <div class="set-group pad"><ol class="pr-steps">
        <li><b>Grab your personal link</b><span>Sign in with Discord and tap <em>Get my link</em>. It’s yours for good.</span></li>
        <li><b>Spread the word</b><span>Share it on TikTok, Instagram, X or YouTube, send it to friends, or drop it in other Discord servers you’re part of.</span></li>
        <li><b>Climb the board</b><span>Every new account made through your link counts toward your total.</span></li>
        <li><b>Collect your gold</b><span>Claim Bloodstrike Gold in the <a href="${DISCORD}" target="_blank" rel="noopener">ZenClipsDaily Discord</a>.</span></li></ol></div>
      <div class="set-group pad pr-get" id="prGet">${signed ? '<div class="skel" style="height:120px;border-radius:12px"></div>'
        : `<p class="pr-get-t">Ready to start? Your link takes a second.</p><button class="btn cta pr-big" type="button" ${canDiscord ? 'data-sso="discord"' : 'id="prSign"'}>Get my link</button><p class="dim small">You’ll sign in with Discord, then come straight back here.</p>`}</div>
      <h2 class="fr-h">🏆 Top promoters</h2>
      <div class="set-group pad">${boardHTML(info.top || [])}</div>
      <h2 class="fr-h">The rules</h2>
      <div class="set-group pad"><ul class="pr-rules">
        <li>No spam — don’t flood comments, DMs or servers that don’t allow promo. Spammed or fake sign-ups don’t count.</li>
        <li>GhostFlix staff decide who gets rewarded and how much; their call is final.</li>
        <li>Rewards are claimed in the <a href="${DISCORD}" target="_blank" rel="noopener">ZenClipsDaily Discord</a> (discord.gg/zenclipsdaily).</li>
        <li>Signing up yourself or re-using existing accounts doesn’t count.</li></ul></div>
    </div>`;
    const sg = $('#prSign'); if (sg) sg.onclick = () => ctx.auth()?.openModal?.();
    if (signed) loadMine();
  }

  async function loadMine() {
    const box = $('#prGet'); if (!box) return;
    let me; try { me = await ctx.call('/api/me/referral'); } catch (e) { box.innerHTML = `<p class="lead">${esc(e.message)}</p><button class="btn dark sm" type="button" id="prRetry">Try again</button>`; $('#prRetry').onclick = loadMine; return; }
    if (location.pathname !== '/promote') return;
    box.innerHTML = `<small class="dim">Your personal link</small>${linkHTML(me)}`;
    $('#prCopy').onclick = async () => { const i = $('#prLink'); try { await navigator.clipboard.writeText(me.link); } catch { i.select(); document.execCommand?.('copy'); } ctx.toast('Link copied — go share it!'); };
    $('#prLink').onfocus = (e) => e.target.select();
    const sh = $('#prShare'); if (sh) sh.onclick = () => navigator.share({ title: 'GhostFlix', text: 'Watch on GhostFlix 👻', url: me.link }).catch(() => {});
  }

  return { captureRef, claim, viewPromote };
}
