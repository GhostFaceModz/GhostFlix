// Profile cosmetics: avatar borders + name glow. Stored in localStorage (gf.cosmetics) and,
// when signed in, in Supabase user metadata (gf_border, gf_glow).
const KEY = 'gf.cosmetics';
export const BORDER_GROUPS = [
  { id: 'basic', name: 'Basic', items: [['none', 'None'], ['solid', 'Solid accent'], ['gradient', 'Gradient ring'], ['ghost', 'Ghost-white dashed']] },
  { id: 'fx', name: 'Effects', items: [['neon', 'Neon glow'], ['pulse', 'Pulse ring'], ['gold', 'Gold']] },
  { id: 'discord', name: 'Discord borders', items: [['blurple', 'Blurple ring'], ['nitro', 'Nitro gradient'], ['online', 'Online'], ['idle', 'Idle'], ['dnd', 'Do Not Disturb'], ['streaming', 'Streaming'], ['boost', 'Boost shimmer'], ['hype', 'Hype tri-colour']] },
];
export const BORDERS = BORDER_GROUPS.flatMap((g) => g.items.map(([id]) => id));
export const GLOWS = [['', 'None'], ['#5fe3ff', 'Cyan'], ['#b69bff', 'Violet'], ['#ff7aa8', 'Pink'], ['#ffd166', 'Gold'], ['#8dff7a', 'Green'], ['#ff5a5a', 'Red'], ['#ffffff', 'White']];
const valid = (c) => ({ border: BORDERS.includes(c?.border) ? c.border : 'none', glow: /^#[0-9a-f]{6}$/i.test(c?.glow || '') ? c.glow.toLowerCase() : '' });
export const Cosmetics = {
  get() { try { return valid(JSON.parse(localStorage.getItem(KEY)) || {}); } catch { return valid({}); } },
  set(patch, { silent = false } = {}) {
    const next = valid({ ...Cosmetics.get(), ...patch });
    try { localStorage.setItem(KEY, JSON.stringify(next)); } catch {}
    applyCosmetics(next); if (!silent) window.dispatchEvent(new CustomEvent('gf:cosmetics', { detail: next }));
    return next;
  },
  // adopt values saved on the account (called on sign-in)
  fromUser(user) {
    const m = user?.user_metadata || {};
    if (m.gf_border === undefined && m.gf_glow === undefined) return false;
    const cur = Cosmetics.get(); const next = valid({ border: m.gf_border ?? cur.border, glow: m.gf_glow ?? cur.glow });
    if (next.border === cur.border && next.glow === cur.glow) return false;
    Cosmetics.set(next); return true;
  },
};
export function applyCosmetics(c = Cosmetics.get()) {
  const r = document.documentElement;
  if (c.glow) { r.style.setProperty('--gf-glow', c.glow); r.dataset.glow = '1'; } else { r.style.removeProperty('--gf-glow'); delete r.dataset.glow; }
}
// Wrap an avatar (img or initial) in the selected border.
export const avatarWrap = (inner, border = Cosmetics.get().border) => `<span class="gf-av gfb-${border}">${inner}</span>`;
