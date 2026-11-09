export const OUT = { w: 1080, h: 1920 };

export const EASES = {
  'ali-fit': [0.51, 0.28, 0.27, 0.96],
  smooth: [0.65, 0.0, 0.35, 1.0],
  snappy: [0.2, 0.0, 0.0, 1.0],
  linear: [0, 0, 1, 1],
};

function bezier([x1, y1, x2, y2]) {
  const ax = 3 * x1 - 3 * x2 + 1, bx = 3 * x2 - 6 * x1, cx = 3 * x1;
  const ay = 3 * y1 - 3 * y2 + 1, by = 3 * y2 - 6 * y1, cy = 3 * y1;
  const X = (s) => ((ax * s + bx) * s + cx) * s;
  const Y = (s) => ((ay * s + by) * s + cy) * s;
  return (u) => {
    if (u <= 0) return 0;
    if (u >= 1) return 1;
    let lo = 0, hi = 1, s = u;
    for (let i = 0; i < 30; i++) {
      s = (lo + hi) / 2;
      if (X(s) < u) lo = s; else hi = s;
    }
    return Y(s);
  };
}

export function easeFn(ease) {
  return bezier(Array.isArray(ease) ? ease : EASES[ease] || EASES.smooth);
}

const KEYS = ['zoom', 'x', 'y', 'rot'];
const ZERO = { zoom: 1, x: 0, y: 0, rot: 0 };

export function poseAt(t, preset) {
  let pose = { ...ZERO, ...preset.base };
  const moves = [...(preset.moves || [])].sort((a, b) => a.at - b.at);
  for (const m of moves) {
    if (t <= m.at) break;
    const to = { ...pose, ...m.to };
    const k = easeFn(m.ease)(Math.min(1, (t - m.at) / Math.max(m.dur, 1e-3)));
    const next = {};
    for (const key of KEYS) next[key] = pose[key] + (to[key] - pose[key]) * k;
    pose = next;
  }
  return pose;
}

export function blurPoses(t, preset, fps = 30) {
  const shutter = (preset.blur ?? 0) / fps, now = poseAt(t, preset);
  if (shutter <= 0) return [now];
  const then = poseAt(Math.max(0, t - shutter), preset);
  const travel = Math.abs(Math.log(now.zoom / then.zoom)) + Math.hypot(now.x - then.x, now.y - then.y);
  if (travel < 0.004) return [now];
  const n = Math.min(12, 2 + Math.ceil(travel * 120));
  return Array.from({ length: n }, (_, i) => poseAt(t - shutter * (i / (n - 1)), preset));
}

export function baseScale(src) {
  return Math.max(OUT.w / src.w, OUT.h / src.h);
}

export function frameOf(pose, src) {
  const s = baseScale(src) * pose.zoom;
  const cx = OUT.w / 2 + pose.x * OUT.w, cy = OUT.h / 2 + pose.y * OUT.h;
  const hw = (src.w * s) / 2, hh = (src.h * s) / 2;
  return {
    scale: s,
    gapTop: Math.max(0, cy - hh),
    gapBottom: Math.max(0, OUT.h - (cy + hh)),
    gapLeft: Math.max(0, cx - hw),
    gapRight: Math.max(0, OUT.w - (cx + hw)),
    window: {
      x0: (src.w / 2 - cx / s) / src.w, y0: (src.h / 2 - cy / s) / src.h,
      x1: (src.w / 2 + (OUT.w - cx) / s) / src.w, y1: (src.h / 2 + (OUT.h - cy) / s) / src.h,
    },
  };
}

export function shadeAlpha(yFrac, fill) {
  const h = fill.shadeHeight || 0, solid = Math.min(fill.shadeSolid || 0, h);
  if (h <= 0 || yFrac >= h) return 0;
  const u = yFrac <= solid ? 0 : (yFrac - solid) / (h - solid);
  return (fill.shadeStrength ?? 1) * (1 - u * u * (3 - 2 * u));
}

export function report(preset, src, duration, fps = 30) {
  let gapTop = 0, gapSide = 0, gapBottom = 0, maxScale = 0;
  for (let i = 0; i <= Math.ceil(duration * fps); i++) {
    const f = frameOf(poseAt(i / fps, preset), src);
    gapTop = Math.max(gapTop, f.gapTop / f.scale / src.h);
    gapBottom = Math.max(gapBottom, f.gapBottom / f.scale / src.h);
    gapSide = Math.max(gapSide, Math.max(f.gapLeft, f.gapRight) / f.scale / src.w);
    maxScale = Math.max(maxScale, f.scale);
  }
  return { gapTop, gapBottom, gapSide, maxScale, needWidth: Math.ceil(src.w * maxScale) };
}
