export const DEFAULT_THEME = 'light';

const TG_RAINBOW = 'linear-gradient(90deg,#ff2d95,#ff7a1a,#ffd23f,#22d96e,#00d5ff,#0066ff,#8a55ff)';

export const THEMES = {
  classic: { name: 'Classic', bg: '#fbfaf7', paper: '#ffffff', ink: '#161616', text: '#161616', over: '#ffffff', accent: '#0066ff', kw: '#0066ff', bgDeep: '#ebe6dc', grad: TG_RAINBOW, swatch: ['#ffffff', '#0066ff', '#ff2d95', '#ffd23f', '#22d96e'] },
  light: { name: 'Light', bg: '#fbfaf7', paper: '#ffffff', ink: '#161616', text: '#161616', over: '#ffffff', accent: '#ff3d2e', kw: '#161616', bgDeep: '#ebe6dc' },
  dark: { name: 'Dark', bg: '#161616', paper: '#fbfaf7', ink: '#161616', text: '#fbfaf7', accent: '#ff3d2e', kw: '#161616' },
  anthropic: { name: 'Anthropic', bg: '#161616', paper: '#f3f2ef', ink: '#161616', text: '#f3f2ef', accent: '#d2502f', kw: '#d2502f' },
  forest: { name: 'Forest green', bg: '#1f3d2b', paper: '#f1ebdd', ink: '#14261b', text: '#f1ebdd', accent: '#faf6ea', kw: '#1f3d2b' },
  mono: { name: 'Mono', bg: '#0b0b0b', paper: '#ffffff', ink: '#0b0b0b', text: '#ffffff', accent: '#ffe63c', kw: '#0b0b0b', kwBg: '#ffe63c' },
  midnight: { name: 'Midnight', bg: '#0f1b2d', paper: '#e8eef7', ink: '#0f1b2d', text: '#e8eef7', accent: '#4da3ff', kw: '#1c6fd1' },
};

export const themeId = (id) => (THEMES[id] ? id : DEFAULT_THEME);

const rgb = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
const lum = (h) => { const [r, g, b] = rgb(h).map((v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }); return 0.2126 * r + 0.7152 * g + 0.0722 * b; };
const contrast = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };
const mix = (h, k) => '#' + rgb(h).map((v) => Math.round(v * k).toString(16).padStart(2, '0')).join('');

export function themeVars(id) {
  const t = THEMES[themeId(id)], onAccent = contrast(t.accent, t.ink) >= contrast(t.accent, t.text) ? t.ink : t.text;
  const v = { bg: t.bg, 'bg-deep': t.bgDeep ?? mix(t.bg, 0.75), paper: t.paper, ink: t.ink, text: t.text, accent: t.accent, 'on-accent': onAccent, kw: t.kw ?? t.accent, 'kw-bg': t.kwBg ?? 'transparent', over: t.over ?? t.text, grad: t.grad ?? 'none', hl: t.hlGrad ? t.grad : 'none', 'hl-fill': t.hlGrad ? 'transparent' : 'currentColor', hlc: t.hlc ?? t.accent, ...(t.hlGrad ? { 'hl-ts': 'none', 'hl-fx': 'drop-shadow(0 6px 0 rgba(0,0,0,.55))' } : {}), fill: t.grad ?? 'linear-gradient(90deg,var(--t-accent),color-mix(in srgb,var(--t-accent) 65%,#fff))' };
  for (const k of ['bg', 'paper', 'ink', 'text', 'accent']) v[`${k}-rgb`] = rgb(t[k]).join(',');
  return v;
}

export function themeCss(id) {
  return `:root{${Object.entries(themeVars(id)).map(([k, x]) => `--t-${k}:${x}`).join(';')}}`;
}

export const themeList = () => Object.entries(THEMES).map(([id, t]) => ({ id, name: t.name, swatch: t.swatch ?? [...new Set([t.bg, t.paper, t.accent, t.text])] }));
