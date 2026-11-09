// Hook camera presets as zoom kinds laid on a word range.
// Moves use camera-moves' preset shape; here `x` is the yapcut pan (frame widths the face point shifts), zoom never under 1.
import { poseAt } from '../vendor/camera-moves/public/camera.js';

const PUNCH = [0.49, -0.19, 0.03, 1], PULL = [0.3, 0, 0.15, 1.12];
export const CAM_MOVES = {
  dvzoom: { len: 2.5, base: { zoom: 1 }, moves: [{ at: 0, dur: 0.75, ease: [0.2, 0.6, 0.35, 1], to: { zoom: 1.25 } }] },
  dvhook: { len: 4.6, base: { zoom: 1 }, moves: [
    { at: 0, dur: 0.75, ease: [0.2, 0.6, 0.35, 1], to: { zoom: 1.35 } },
    { at: 1.45, dur: 0.42, ease: [0.5, 0, 0.3, 1], to: { zoom: 1.12 } },
    { at: 2.2, dur: 0.6, ease: PULL, to: { zoom: 1.04 } },
    { at: 3.38, dur: 1.21, ease: PUNCH, to: { zoom: 1.75 } }] },
  dvpush: { len: 2.2, base: { zoom: 1 }, moves: [
    { at: 0, dur: 0.75, ease: [0.2, 0.6, 0.35, 1], to: { zoom: 1.35 } },
    { at: 1.45, dur: 0.42, ease: [0.5, 0, 0.3, 1], to: { zoom: 1.15 } }] },
  dvpull: { len: 2.6, base: { zoom: 1.3 }, moves: [
    { at: 0, dur: 0.6, ease: PULL, to: { zoom: 1.04 } },
    { at: 1.2, dur: 1.21, ease: PUNCH, to: { zoom: 1.7 } }] },
  dvpunch: { len: 1.7, base: { zoom: 1 }, moves: [
    { at: 0, dur: 0.35, ease: 'smooth', to: { zoom: 1.08 } },
    { at: 0.4, dur: 1.21, ease: PUNCH, to: { zoom: 1.6 } }] },
};
export const MOVE_KINDS = Object.keys(CAM_MOVES);
export const peakOf = (kind) => Math.max(CAM_MOVES[kind].base.zoom, ...CAM_MOVES[kind].moves.map((m) => m.to.zoom));

// A longer bar spreads the moves out but never slows them; a shorter one squeezes both.
function stretched(kind, dur) {
  const M = CAM_MOVES[kind], k = dur / M.len, kd = Math.min(1, k);
  return { base: M.base, moves: M.moves.map((m) => ({ ...m, at: m.at * k, dur: m.dur * kd })) };
}

const HZ = 15, ID = (a, b) => [a, b, 1, 0, 0, 0, 0, 0, 0, 0];
const r5 = (v) => +v.toFixed(5);
const herm = (p0, p1, m0, m1, h) => { const M0 = m0 * h, M1 = m1 * h; return [p0, M0, 3 * (p1 - p0) - 2 * M0 - M1, 2 * (p0 - p1) + M0 + M1].map(r5); };
const evalSeg = (s, t, ch) => { const h = s[1] - s[0], u = (t - s[0]) / h, c = s.slice(ch, ch + 4); return [c[0] + u * (c[1] + u * (c[2] + u * c[3])), (c[1] + u * (2 * c[2] + u * 3 * c[3])) / h]; };
// Exact piece [a, b] of a cubic segment (a cubic Hermite rebuilt from its own ends is the same cubic).
function clipSeg(s, a, b) {
  const [z0, dz0] = evalSeg(s, a, 2), [z1, dz1] = evalSeg(s, b, 2), [x0, dx0] = evalSeg(s, a, 6), [x1, dx1] = evalSeg(s, b, 6);
  return [r5(a), r5(b), ...herm(z0, z1, dz0, dz1, b - a), ...herm(x0, x1, dx0, dx1, b - a)];
}

function moveSegs(kind, t0, dur, amt = 1) {
  const P = stretched(kind, dur), at = (t) => { const q = poseAt(Math.max(0, t), P); return [Math.max(1, 1 + (q.zoom - 1) * amt), q.x * amt]; };
  const n = Math.max(1, Math.round(dur * HZ)), h = dur / n, d = 0.004, out = [];
  const slope = (t) => { const a = at(t - d), b = at(t + d); return [(b[0] - a[0]) / (2 * d), (b[1] - a[1]) / (2 * d)]; };
  for (let i = 0; i < n; i++) {
    const ta = i * h, tb = (i + 1) * h, A = at(ta), B = at(tb), sa = slope(ta), sb = slope(Math.min(tb, dur - d));
    out.push([r5(t0 + ta), r5(t0 + tb), ...herm(A[0], B[0], sa[0], sb[0], h), ...herm(A[1], B[1], sa[1], sb[1], h)]);
  }
  return out;
}

// One camera path for the player and export: the always-moving path (or a still camera) with each move window cut in.
// Overlapping moves: the later one takes over at its start.
export function cameraPath(wins, flow, total) {
  if (!wins.length) return flow?.length ? flow : null;
  const base = flow?.length ? flow : [ID(0, total)], out = [];
  const fill = (a, b) => { for (const s of base) { const x = Math.max(a, s[0]), y = Math.min(b, s[1]); if (y - x > 1e-3) out.push(base === flow ? clipSeg(s, x, y) : ID(r5(x), r5(y))); } };
  let t = 0;
  const W = [...wins].sort((a, b) => a.t0 - b.t0);
  W.forEach((w, i) => {
    const end = Math.min(w.t0 + w.dur, W[i + 1]?.t0 ?? Infinity);
    if (end - w.t0 < 1e-3) return;
    fill(t, w.t0);
    for (const s of moveSegs(w.kind, w.t0, w.dur, w.amt)) if (s[0] < end - 1e-3) out.push(s[1] > end ? clipSeg(s, s[0], end) : s);
    t = end;
  });
  fill(t, total);
  return out;
}
