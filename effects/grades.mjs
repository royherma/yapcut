// Color grades for the footage layers only (#cam, #before, #mattes), never captions or cards. Runs in node and the browser:
// one SVG filter (saturation matrix, then per-channel lift / gamma / gain + contrast) drawn by Chrome in preview AND export.
export const DEFAULT_GRADE = 'none';

const ch = (lift = 0, gamma = 1, gain = 1) => ({ lift, gamma, gain });
export const GRADES = {
  none: { name: 'Original', note: 'the camera as shot' },
  golden: { name: 'Golden', note: 'warm skin, soft yellow light', sat: 1.08, contrast: 1.04, r: ch(0, 1.03, 1.06), g: ch(0, 1, 1.01), b: ch(0, 0.98, 0.9) },
  cinema: { name: 'Teal & orange', note: 'film look: teal shadows, warm skin', sat: 1.05, contrast: 1.1, r: ch(-0.02, 1, 1.06), g: ch(0.01, 1, 1), b: ch(0.05, 1, 0.9) },
  clean: { name: 'Bright & clean', note: 'lifted, airy, a touch cool', sat: 1.06, contrast: 1, r: ch(0, 1.12, 1.03), g: ch(0, 1.12, 1.03), b: ch(0, 1.12, 1.05) },
  film: { name: 'Faded film', note: 'milky blacks, warm, low contrast', sat: 0.85, contrast: 0.92, r: ch(0.06, 1, 1), g: ch(0.05, 1, 0.98), b: ch(0.04, 1, 0.93) },
  moody: { name: 'Moody', note: 'muted, deeper shadows, cool', sat: 0.75, contrast: 1.12, r: ch(-0.02, 0.92, 0.96), g: ch(-0.02, 0.92, 1), b: ch(-0.01, 0.92, 1.02) },
  cool: { name: 'Cool blue', note: 'clean daylight blue', sat: 0.95, contrast: 1.02, r: ch(0, 1, 0.94), g: ch(0, 1, 0.99), b: ch(0.02, 1, 1.06) },
  vivid: { name: 'Punchy', note: 'more color and contrast', sat: 1.3, contrast: 1.12 },
  bw: { name: 'Black & white', note: 'high-contrast mono', sat: 0, contrast: 1.15 },
  airy: { name: 'Airy warm', note: 'bright & clean, a touch warmer', sat: 1.04, contrast: 0.98, r: ch(0.01, 1.14, 1.05), g: ch(0.01, 1.13, 1.03), b: ch(0.01, 1.12, 1) },
  crisp: { name: 'Crisp', note: 'bright & clean with more snap', sat: 1.08, contrast: 1.08, r: ch(0, 1.08, 1.03), g: ch(0, 1.08, 1.03), b: ch(0, 1.08, 1.04) },
  pastel: { name: 'Soft pastel', note: 'lifted, gentle, low contrast', sat: 0.85, contrast: 0.9, r: ch(0.05, 1.1, 1.02), g: ch(0.04, 1.1, 1), b: ch(0.05, 1.1, 1.02) },
  portra: { name: 'Portra film', note: 'warm film skin, soft greens', sat: 0.95, contrast: 0.96, r: ch(0.03, 1.04, 1.04), g: ch(0.025, 1.02, 1), b: ch(0.02, 1, 0.92) },
  fuji: { name: 'Fuji green', note: 'film with green-teal mids', sat: 0.92, contrast: 1.02, r: ch(0.01, 1, 0.97), g: ch(0.02, 1.03, 1.02), b: ch(0.03, 1, 0.97) },
  sunset: { name: 'Sunset', note: 'golden-hour orange', sat: 1.1, contrast: 1.05, r: ch(0.02, 1.05, 1.08), g: ch(0, 1, 0.98), b: ch(0.02, 0.95, 0.85) },
  nordic: { name: 'Nordic', note: 'pale, cool, quiet color', sat: 0.7, contrast: 1, r: ch(0.02, 1.06, 0.97), g: ch(0.02, 1.06, 1), b: ch(0.03, 1.06, 1.04) },
  bleach: { name: 'Bleach bypass', note: 'gritty, low color, hard contrast', sat: 0.55, contrast: 1.25 },
  sepia: { name: 'Sepia', note: 'warm brown mono', sat: 0, contrast: 1.08, r: ch(0.03, 1, 1.04), g: ch(0.02, 1, 0.98), b: ch(0, 1, 0.86) },
};

export const gradeId = (id) => (GRADES[id] ? id : DEFAULT_GRADE);
export const gradeAmt = (a) => (a == null || !Number.isFinite(+a) ? 1 : Math.max(0, Math.min(1, +a)));
export const gradeList = () => Object.entries(GRADES).map(([id, g]) => ({ id, name: g.name, note: g.note }));

const W = [0.2126, 0.7152, 0.0722], N = 64, f4 = (x) => +x.toFixed(4);

function matrix(g, a) {
  const s = 1 + ((g.sat ?? 1) - 1) * a;
  return [0, 1, 2].flatMap((i) => [...W.map((w, j) => f4((1 - s) * w + (i === j ? s : 0))), 0, 0]).concat([0, 0, 0, 1, 0]);
}

function table(g, c, a) {
  const { lift, gamma, gain } = g[c] ?? ch(), k = g.contrast ?? 1;
  return Array.from({ length: N + 1 }, (_, i) => {
    const x = i / N, y = Math.min(1, Math.max(0, (lift + (gain - lift) * x ** (1 / gamma) - 0.5) * k + 0.5));
    return f4(x + (y - x) * a);
  });
}

// `<filter id=...>` for one grade at strength a (0-1); empty filter = identity.
export function gradeFilter(fid, id, a) {
  const g = GRADES[gradeId(id)];
  a = gradeAmt(a);
  if (!g.sat && !g.contrast && !g.r) return `<filter id="${fid}" color-interpolation-filters="sRGB"><feColorMatrix type="saturate" values="1"/></filter>`;
  const fn = (c) => `<feFunc${c.toUpperCase()} type="table" tableValues="${table(g, c, a).join(' ')}"/>`;
  return `<filter id="${fid}" color-interpolation-filters="sRGB" x="0" y="0" width="100%" height="100%"><feColorMatrix type="matrix" values="${matrix(g, a).join(' ')}"/><feComponentTransfer>${['r', 'g', 'b'].map(fn).join('')}</feComponentTransfer></filter>`;
}

export const GRADE_TARGETS = '#cam, #before, #mattes';

export function gradeHtml(id, a) {
  return `<svg id="cgsvg" width="0" height="0" style="position:absolute">${gradeFilter('cgrade', id, a)}</svg><style id="cgcss">${gradeId(id) === 'none' ? '' : `${GRADE_TARGETS}{filter:url(#cgrade)}`}</style>`;
}
