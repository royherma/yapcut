// Word board (reelkit notation engine) on a yapcut version: runs/<video>/board.json, `at` = word index in words.json.
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fit, loadTheme } from '../vendor/reelkit/board/fit.mjs';
import { EASES } from '../vendor/camera-moves/public/camera.js';

export const BOARD_DIR = new URL('../vendor/reelkit/board/', import.meta.url).pathname;
const BOARD_FLOOR = 0.4;
const preset = (n) => JSON.parse(readFileSync(new URL(`../vendor/camera-moves/presets/${n}.json`, import.meta.url), 'utf8'));
export const CAMS = { 'hook-drop': preset('hook-drop'), 'drop-blur': preset('drop-blur') };
export const CAM_TITLE_Y = 400;

export function boardFor(videoDir, L, faces, camName) {
  const file = join(videoDir, 'board.json'), has = L.p?.board && existsSync(file), windows = dropWindows(L.p ?? {}, L.words, L.outAt, L.fx, (L.pieces ?? []).slice(1).map((x) => x.o));
  if (!CAMS[camName] && windows.length) camName = 'hook-drop';
  if (!has && !CAMS[camName]) return null;
  const board = has ? JSON.parse(readFileSync(file, 'utf8')) : { beats: [] }, theme = loadTheme(board.theme || 'pastel-serif');
  const out = new Array(L.words.length);
  let next = L.total;
  for (let i = L.words.length - 1; i >= 0; i--) { const o = L.outAt(L.words[i].start + 0.01); out[i] = o ?? next; if (o != null) next = o; }
  const words = L.words.map((w, i) => ({ ...w, start: out[i] }));
  const withHair = faces.filter((f) => f.face).map((f) => ({ ...f, face: [f.face[0], f.face[1] - 0.38 * f.face[3], f.face[2], f.face[3] * 1.38] }));
  const hairTop = withHair.map((f) => f.face[1]).sort((x, y) => x - y)[Math.floor((withHair.length - 1) * 0.05)] ?? 0.4;
  const base = CAMS[camName], dy = base ? Math.min(0.25, Math.max(base.moves.at(-1).to.y, BOARD_FLOOR - hairTop)) : 0;
  const cam = base && { ...base, moves: base.moves.map((m, i, all) => ({ ...m, ease: Array.isArray(m.ease) ? m.ease : EASES[m.ease] ?? EASES.smooth, ...(i === all.length - 1 ? { to: { ...m.to, y: +dy.toFixed(4) } } : {}) })) };
  const shifted = withHair.map((f) => ({ ...f, face: [f.face[0], f.face[1] + dy, f.face[2], f.face[3]] }));
  for (const b of board.beats) if (b.el?.logo) b.el = { ...b.el, type: 'cutout', image: `/board/logos/${b.el.logo}.svg`, pop: 'none' };
  const kept = { ...board, beats: board.beats.filter((b) => b.do !== 'add' || L.outAt(L.words[b.at]?.start + 0.01) != null) };
  const fitted = fit(kept, words, theme, { faces: shifted.length ? shifted : null });
  const exit = (theme.exit?.dur ?? 0.32) + 0.05;
  let cleared = -Infinity;
  for (const x of fitted.beats) {
    if (x.do === 'clear' && !x.ids) cleared = x.t;
    else if (x.do === 'add' && x.t < cleared + exit) x.t = +(cleared + exit).toFixed(3);
  }
  fitted.beats.sort((a, b) => a.t - b.t);
  return { fitted, theme: { ...theme, move: { ...theme.move, enterAfter: 0.6 }, font: { ...theme.font, file: `/board/${theme.font.file}` } }, cam: cam && windows.length && !has ? { ...cam, windows } : cam, dropped: board.beats.length - kept.beats.length };
}

const LOGOS = (existsSync(join(BOARD_DIR, 'logos')) ? readdirSync(join(BOARD_DIR, 'logos')) : []).filter((f) => f.endsWith('.svg')).map((f) => f.slice(0, -4));

export function dropWindows(p, words, outAt, fx = [], cuts = []) {
  const ws = (p.camdrop ?? []).map(([a, b]) => [words[a] && outAt(words[a].start + 0.01), words[b] && outAt(words[b].end - 0.01)])
    .concat(fx.filter((e) => (p.effects ?? [])[e.k]?.drop).map((e) => [e.t0, e.t0 + e.dur]))
    .filter(([t0, t1]) => t0 != null && t1 != null && t1 > t0).sort((x, y) => x[0] - y[0]);
  const out = [];
  for (const [t0, t1] of ws) { const last = out.at(-1); if (last && t0 <= last.t1 + 0.6) last.t1 = Math.max(last.t1, t1); else out.push({ t0, t1 }); }
  for (const w of out) {
    const c0 = cuts.find((c) => c > w.t0 - 0.6 && c < w.t0 + 0.5), c1 = cuts.find((c) => c > w.t1 - 0.9 && c < w.t1 + 0.5);
    if (c0 != null) w.t0 = c0 <= w.t0 ? c0 + 0.15 : c0 - 0.75;
    if (c1 != null) w.t1 = c1 + 0.35;
    const next = cuts.find((c) => c > w.t0 - 0.15);
    w.d = Math.max(0.35, Math.min(1.36, (w.t1 - w.t0) / 3, next != null ? next - (w.t0 - 0.15) - 0.05 : 9));
    const lay = fx.find((e) => e.cat?.group === 'layout' && e.t0 > w.t0 && e.t0 < w.t1 + w.d + 0.1);
    if (lay) w.t1 = Math.max(w.t0 + 0.6, lay.t0 - w.d - 0.05);
  }
  return out.map((w) => ({ t0: +w.t0.toFixed(3), t1: +w.t1.toFixed(3), d: +w.d.toFixed(3) }));
}
export const needsCam = (p) => !!(p.board || p.cam || p.camdrop?.length || (p.effects ?? []).some((e) => e.drop));
export const camTitle = (p, words, outAt) => !p.titleMoved && !p.board && (!!CAMS[p.cam] || (words ? dropWindows(p, words, outAt).some((w) => w.t0 < 0.5) : false));

const hookWords = (L) => { const said = L.words.map((w, i) => ({ i, o: L.outAt(w.start + 0.01) })).filter((x) => x.o != null && x.o < 3.2).sort((a, b) => a.o - b.o); return said.length ? [said[0].i, said.at(-1).i] : null; };
export const hookDrop = (L) => { const h = hookWords(L); return !!h && (L.p.camdrop ?? []).some(([a]) => a === h[0]); };
export function setHookDrop(L, on) {
  const h = hookWords(L), rest = (L.p.camdrop ?? []).filter(([a]) => !h || a !== h[0]);
  return on && h ? [h, ...rest] : rest;
}
