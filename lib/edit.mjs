// The edit as numbers: kept pieces, zooms, captions, sounds, effects. Shared by `yapcut render` and the browser preview.
import { readFileSync, existsSync, readdirSync, realpathSync, statSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { SFX_DIR, sfxPath } from './sfx-path.mjs';
import { loadWords, keepSpans } from '../vendor/reelkit/lib/words.mjs';
import { resolveEffects, srcTime } from './fx.mjs';
import { envelope, fine } from './envelope.mjs';
import { CAM_TITLE_Y, camTitle, dropWindows } from './board.mjs';
import { MOVE_KINDS, peakOf, cameraPath } from './cammove.mjs';
import { jsonOf } from './atomic.mjs';

export const W = 1080, H = 1920, FPS = 30;
export { SFX_DIR, sfxPath };
const SLOT_OF = { softin: 'itemin', softout: 'itemout', click: 'tick', softwhoosh: 'camdown', shutter: 'mediacut', sparkle: 'float' };
const PACKS = join(dirname(fileURLToPath(import.meta.url)), '..', 'sound-packs.json');
export function soundPacks() { try { return jsonOf(PACKS); } catch { return { active: null, packs: {} }; } }
export function packOf(p) { const P = soundPacks(); return P.packs[p?.soundPack] ?? P.packs[P.active] ?? null; }
export const SFX_DB = -14; // her rule: sound effects never louder than the voice
export const SOUNDS = {
  whoosh: ['Clean', '201'], pop: ['Clean', '234'], ding: ['Clean', '231'], boom: ['Clean', '251'],
  click: ['Clean', '232'], typing: ['Clean', '233'], shutter: ['Clean', '241'], scratch: ['Clean', '243'],
  sparkle: ['Clean', '221'], riser: ['Clean', '222'], softwhoosh: ['Clean', ['201', '202', '203', '204']],
  softin: [['Clean', '221'], ['Clean', '223']], softout: [['Clean', '211'], ['Clean', '242']],
};
export const GAP_K = 1000; // held-beat cards are not plan.effects: card k = GAP_K + index in plan.gaps
const MAX_GAP = 0.45, PAD = 0.08, QUIET = 0.12, TAIL = 0.14, TAIL_END = 0.26, LEAD = 0.07, SNAP_ZOOM = 1.18, SLOW_ZOOM = 1.12, SNAP_SECS = 1.2;
export const HOLD_ZOOM = 1.35; // tight crop: face up top, hands and table out of frame

// Apple Vision faces of the take (preview/server.mjs writes fx-cache/faces.json next to the real raw file).
export function facesFor(dir) {
  const raw = readdirSync(dir).find((f) => f.startsWith('raw.'));
  const file = raw && join(dirname(realpathSync(join(dir, raw))), 'fx-cache', 'faces.json');
  return file && existsSync(file) ? jsonOf(file) : [];
}
// Zoom z about the face: top-left offset that puts the face center at (540, 640) without showing an edge.
export function framing(z, f) {
  const cl = (v, lo) => Math.min(0, Math.max(lo, v));
  return f ? [cl(W / 2 - z * f[0] * W, W * (1 - z)), cl(640 - z * f[1] * H, H * (1 - z))] : [(W / 2) * (1 - z), (H / 2) * (1 - z)];
}

export const rawOf = (dir) => join(dir, readdirSync(dir).find((f) => f.startsWith('raw.')));

// Kept source spans [{s,e,words:[i]}]: plan.keep (play order) or script repeats, minus plan drops and long pauses.
// plan.lockEdges {"firstWord-lastWord": [s, e]} = approved cut points: a span with the same words keeps them when this code changes.
export function spans(dir, words, p) {
  const out = cutSpans(dir, words, p), lock = p.lockEdges;
  if (lock) for (const x of out) { const k = lock[`${x.words[0]}-${x.words.at(-1)}`]; if (k) { x.s = k[0]; x.e = k[1]; } }
  return out;
}

const wordIndexes = (ranges, n) => (ranges ?? []).flatMap(([a, b]) => (Number.isInteger(a) && Number.isInteger(b) ? Array.from({ length: Math.max(0, b - a + 1) }, (_, k) => a + k) : [])).filter((i) => i >= 0 && i < n);

function cutSpans(dir, words, p) {
  const scriptFile = join(dir, 'script.txt');
  const dropped = new Set(wordIndexes(p.drop, words.length));
  let kept;
  if (p.keep) kept = wordIndexes(p.keep, words.length).filter((i) => !dropped.has(i));
  else {
    const script = existsSync(scriptFile) ? readFileSync(scriptFile, 'utf8').replace(/\([^)]*\)|[*#]/g, ' ') : words.map((w) => w.text).join(' ');
    const keepTimes = keepSpans(words, script, { pad: 0, maxGap: 999 });
    kept = words.map((w, i) => i).filter((i) => !dropped.has(i)
      && keepTimes.some((s) => words[i].start >= s.start - 0.01 && words[i].end <= s.end + 0.6));
  }
  const keptSet = new Set(kept);
  const padEnd = (i) => (words[i + 1] ? Math.min(words[i].end + PAD, Math.max(words[i].end, words[i + 1].start - 0.01)) : words[i].end + PAD);
  const padStart = (i) => (words[i - 1] ? Math.max(words[i].start - PAD, Math.min(words[i].start, words[i - 1].end + 0.01)) : words[i].start - PAD);
  const out = [];
  for (const i of kept) {
    const w = words[i], last = out.at(-1);
    if (last && last.words.at(-1) === i - 1 && (w.start - words[i - 1].end <= (p.maxGap ?? MAX_GAP) || p.keepPause?.includes(i - 1))) { last.e = padEnd(i); last.words.push(i); }
    else out.push({ s: Math.max(0, padStart(i)), e: padEnd(i), words: [i] });
  }
  if (out.length) {
    const last = out.at(-1), lw = last.words.at(-1), next = words[lw + 1];
    last.e = Math.max(last.e, Math.min(words[lw].end + 0.4, next && !keptSet.has(lw + 1) ? next.start - 0.01 : Infinity));
  }
  const raw = readdirSync(dir).find((f) => f.startsWith('raw.'));
  if (raw) quietEdges(out, words, keptSet, fine(join(dir, raw)), p);
  for (let k = 1; k < out.length; k++) {
    const A = out[k - 1], B = out[k], i = A.words.at(-1);
    if (B.words[0] === i + 1 && A.e > B.s) { const mid = (words[i].end + words[i + 1].start) / 2; A.e = Math.max(words[i].end, mid); B.s = Math.min(words[i + 1].start, mid); }
  }
  if (p.endHold && out.length) out.at(-1).e += p.endHold;
  // plan.squeeze [[s, e]] = source seconds of silence to drop inside a span (the middle of a long pause), found from the audio, not from word times.
  // plan.pauseSet [{after, from, to, secs}] = your own length for one pause: it replaces any squeeze inside [from, to].
  const set = p.pauseSet ?? [], mine = set.filter((x) => x.to - x.from > x.secs + 0.04).map((x) => [x.from + x.secs / 2, x.to - x.secs / 2]);
  const sq = [...(p.squeeze ?? []).filter(([a, b]) => !(p.unsqueeze ?? []).some(([u, v]) => u < b && v > a) && !set.some((x) => x.from < b && x.to > a)), ...mine];
  if (!sq.length) return out;
  return out.flatMap((sp) => {
    const parts = [];
    let s = sp.s;
    for (const [a, b] of sq.filter(([a, b]) => a > sp.s && b < sp.e).sort((x, y) => x[0] - y[0])) { parts.push({ s, e: a }); s = b; }
    parts.push({ s, e: sp.e });
    return parts.map((x) => ({ ...x, words: sp.words.filter((i) => words[i].start < x.e && words[i].end > x.s) })).filter((x) => x.words.length);
  });
}

// plan.keepPause [i] keeps the whole natural pause after word i (spans()). plan.tight [[i, secs]] shortens the pause after word i to secs; plan.gaps [[i, secs]] holds a beat after word i with a
// silent stretch of the take (the next effect is pulled back to cover it, so nobody sees a frozen face).
function beats(pieces, words, p, dir) {
  const at = (pc, x) => pieces.findIndex((q) => q.s <= x && x <= q.e + 0.06);
  for (const [i, secs] of p.tight ?? []) {
    const a = words[i], b = words[i + 1], k = a && b ? at(null, a.end) : -1;
    if (k < 0 || b.start - a.end <= secs || pieces[k].e < b.start) continue;
    const pc = pieces[k];
    pieces.splice(k, 1, { ...pc, e: a.end + secs / 2 }, { ...pc, s: b.start - secs / 2 });
  }
  if (!p.gaps?.length) return;
  const env = fine(rawOf(dir)), quiet = (t) => (env.rms[Math.round(t * 100)] ?? 1) < QUIET;
  for (const [gi, [i0, secs, ins]] of [...p.gaps.entries()].reverse()) {
    let i = ins ? Math.min(i0, words.length - 1) : i0;
    while (ins && i > 0 && at(null, words[i].end) < 0) i--;
    const a = words[i], k = a ? at(null, a.end) : -1;
    if (k < 0 && !ins) continue;
    let src = null, len = secs;
    for (let j = 0; j + 1 < words.length && src == null; j++) {
      for (let t = words[j].end + 0.05; t + secs <= words[j + 1].start - 0.05 && src == null; t += 0.05) if (Array.from({ length: Math.ceil(secs * 100) }, (_, n) => quiet(t + n / 100)).every(Boolean)) src = t;
    }
    if (ins && src == null) src = words[0]?.start ?? 0;
    if (src == null) continue;
    const pc = pieces[k] ?? { z: pieces[0]?.z ?? [1, 1] }, reps = Math.ceil(secs / len - 1e-6), d = secs / reps;
    const fill = Array.from({ length: reps }, () => ({ s: src, e: src + d, z: pc.z, gap: true, gi, ...(ins ? { mute: true } : {}) }));
    if (k < 0) { pieces.unshift(...fill); continue; }
    const cut = Math.min(pc.e, a.end + 0.04);
    pieces.splice(k, 1, ...[{ ...pc, e: cut }, ...fill, ...(pc.e - cut > 0.4 ? [{ ...pc, s: cut }] : [])]);
  }
}

const secsCache = new Map();
function wavSecs(f) {
  const key = `${f}|${statSync(f).mtimeMs}`;
  if (!secsCache.has(key)) secsCache.set(key, Number(execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', f]).toString()) || null);
  return secsCache.get(key);
}

// Moves each cut edge into the nearest silence so no word is clipped, and leaves a breath after sentence ends.
function quietEdges(out, words, kept, env, p = {}) {
  const at = (t) => env.rms[Math.max(0, Math.round(t * 100))] ?? 0;
  const quietRun = (t) => at(t) < QUIET && at(t + 0.01) < QUIET && at(t + 0.02) < QUIET;
  for (const sp of out) {
    const a = sp.words[0], b = sp.words.at(-1), wa = words[a], wb = words[b];
    // A kept neighbour sits in the next/previous piece: crossing it replays its audio twice.
    const prevEnd = words[a - 1] ? words[a - 1].end : wa.start - 0.6;
    const nextStart = words[b + 1] ? words[b + 1].start : wb.end + 0.6;
    let e = null;
    for (let t = wb.end - 0.03; t <= Math.min(nextStart + 0.04, wb.end + 0.45); t += 0.01) if (quietRun(t)) { e = t; break; }
    if (e == null) { e = wb.end; for (let t = wb.end - (kept.has(b + 1) ? 0.03 : 0.08); t <= Math.min(nextStart + (kept.has(b + 1) ? 0.06 : 0.1), wb.end + 0.3); t += 0.01) if (at(t) < at(e)) e = t; }
    else { const want = e + (/[.!?]$/.test(wb.text) ? p.tailEnd ?? TAIL_END : p.tail ?? TAIL); const ceil = nextStart - (kept.has(b + 1) ? 0.06 : 0.2); while (e < want && e + 0.01 < ceil && at(e + 0.01) < QUIET) e += 0.01; }
    // A cut next word's first sound (f, s, h) is quiet and starts before its aligned start: end in the silence before it.
    if (!kept.has(b + 1) && words[b + 1] && nextStart - wb.end < 0.1 && e > nextStart - 0.2) for (let t = nextStart - 0.2; t > wb.start + 0.1; t -= 0.01) if (quietRun(t)) { e = t; break; }
    let s = null;
    for (let t = wa.start; t >= Math.max(prevEnd - 0.04, wa.start - 0.45); t -= 0.01) if (quietRun(t - 0.02)) { s = t; break; }
    // WhisperX ends a word late in fast speech, so the true onset can sit before prevEnd.
    if (s == null) { s = wa.start; for (let t = wa.start; t >= Math.max(prevEnd - (kept.has(a - 1) ? 0 : 0.08), wa.start - 0.3); t -= 0.01) if (at(t) < at(s)) s = t; }
    else { const want = s - (p.lead ?? LEAD), floor = kept.has(a - 1) ? prevEnd + 0.02 : -Infinity; while (s > want && s - 0.01 > floor && at(s - 0.01) < QUIET) s -= 0.01; }
    sp.s = Math.max(0, +s.toFixed(3)); sp.e = +Math.max(e, sp.s + 0.1).toFixed(3);
  }
}

const peaks = new Map();
function peakDb(f) {
  const key = `${f}|${statSync(f).mtimeMs}`;
  if (!peaks.has(key)) peaks.set(key, +/max_volume: (-?[\d.]+) dB/.exec(spawnSync('ffmpeg', ['-v', 'info', '-i', f, '-af', 'volumedetect', '-f', 'null', '-']).stderr?.toString() ?? '')?.[1] || 0);
  return peaks.get(key);
}

export function layout(dir, plan) {
  const words = loadWords(join(dir, 'words.json'));
  const p = plan ? JSON.parse(JSON.stringify(plan)) : JSON.parse(readFileSync(join(dir, 'plan.json'), 'utf8'));
  p.snap ??= []; p.slow ??= []; p.sfx ??= []; p.highlight ??= [];
  const nG = p.gaps?.length ?? 0, ins = (p.inserts ?? []).map((n) => { const f = n.file && sfxPath(n.file), s = f && existsSync(f) ? wavSecs(f) : null; return s ? { ...n, secs: +(s + 0.15).toFixed(3) } : null; }).filter(Boolean);
  if (ins.length) { p.drop = [...(p.drop ?? []), ...ins.flatMap((n) => n.replaces ? [n.replaces] : [])]; p.gaps = [...(p.gaps ?? []), ...ins.map((n) => [n.after ?? n.replaces[0] - 1, n.secs, true])]; }
  const punch = p.snap;
  if (p.flow) { p.snap = []; p.slow = []; p.hold = []; }
  const calm = [...(p.camdrop ?? []), ...(p.effects ?? []).filter((e) => e.drop && Number.isInteger(e.at)).map((e) => [e.at, e.to ?? e.at])]
    .filter(([a, b]) => words[a] && words[b]).map(([a, b]) => [words[a].start - 1.5, words[b].end + 1.5]);
  const moving = MOVE_KINDS.flatMap((kind) => (p[kind] ?? []).filter(([a, b]) => words[a] && words[b]).map(([a, b]) => [words[a].start, words[b].end]));
  calm.push(...moving);
  const inCalm = (a, b) => calm.some(([x, y]) => a < y && b > x);
  p.snap = p.snap.filter((i) => !words[i] || !inCalm(words[i].start, words[i].start + SNAP_SECS));
  for (const k of ['slow', 'hold']) if (p[k]) p[k] = p[k].filter(([a, b]) => !words[a] || !words[b] || !inCalm(words[a].start, words[b].end));
  const sp = spans(dir, words, p);

  // Split spans into pieces at snap words and tight-crop holds so each piece has one zoom.
  const marks = [...p.snap.filter((i) => words[i]).map((i) => ({ i, a: words[i].start - 0.04, len: p.snapSecs?.[i] ?? SNAP_SECS, z: p.snapZoom?.[i] ?? SNAP_ZOOM, snap: true })),
    ...(p.hold ?? []).filter(([a, b]) => words[a] && words[b]).map(([a, b, z]) => ({ a: words[a].start - 0.04, b: words[b].end + 0.06, z: z ?? HOLD_ZOOM, hold: true }))];
  const pieces = [];
  for (const s of sp) {
    let cur = { s: s.s, e: s.e, z: [1, 1] };
    const ms = marks.filter((m) => (m.snap ? s.words.includes(m.i) : m.b > s.s && m.a < s.e)).sort((x, y) => x.a - y.a);
    for (const m of ms) {
      const a = Math.max(cur.s, m.a), b = Math.min(s.e, m.snap ? a + m.len : m.b);
      if (b <= a + 0.05) continue;
      if (a > cur.s + 0.1) pieces.push({ ...cur, e: a });
      pieces.push({ s: a, e: b, z: [m.z, m.z], ...(m.snap ? { snap: true } : { hold: true }) });
      cur = { s: b, e: s.e, z: [1, 1] };
    }
    if (cur.e - cur.s > 0.05) pieces.push(cur);
  }
  beats(pieces, words, p, dir);
  let t = 0;
  for (const pc of pieces) { pc.o = t; t += pc.e - pc.s; }
  const faces = facesFor(dir);
  for (const pc of pieces) {
    const f = faces.filter((x) => x.face && x.t >= pc.s - 0.13 && x.t < pc.e + 0.13).map((x) => [x.face[0] + x.face[2] / 2, x.face[1] + x.face[3] / 2]);
    const mid = (k) => f.map((x) => x[k]).sort((a, b) => a - b)[f.length >> 1];
    if (f.length) pc.f = [+mid(0).toFixed(4), +mid(1).toFixed(4)];
  }
  const total = t;
  const outAt = (sec) => {
    const pc = pieces.find((x) => !x.gap && sec >= x.s - 1e-3 && sec < x.e);
    return pc ? pc.o + (sec - pc.s) : null;
  };

  for (const [a, b, zz = SLOW_ZOOM] of p.slow) {
    if (!words[a] || !words[b]) continue;
    const t0 = outAt(words[a].start), t1 = outAt(words[b].end - 0.01);
    if (t0 == null || t1 == null || t1 <= t0) continue;
    const z = (x) => 1 + (zz - 1) * Math.min(1, Math.max(0, (x - t0) / (t1 - t0)));
    for (const pc of pieces) if (!pc.snap && !pc.hold && pc.o < t1 && pc.o + (pc.e - pc.s) > t0) pc.z = [z(pc.o), z(pc.o + pc.e - pc.s)];
  }

  const fx = resolveEffects(p.effects ?? [], words, outAt, total);
  const placed = [];
  ins.forEach((n, k) => {
    const ps = pieces.filter((x) => x.gap && x.gi === nG + k);
    if (!ps.length) return;
    const t0 = ps[0].o, end = ps.at(-1).o + ps.at(-1).e - ps.at(-1).s, fills = (x) => x.cat.group === 'layout' || x.fx === 'digital-zoom';
    for (let j = fx.length - 1; j >= 0; j--) if (fills(fx[j]) && fx[j].t0 >= t0 - 0.01 && fx[j].t0 < end - 0.05) fx.splice(j, 1);
    for (const x of fx) if (fills(x) && x.t0 < t0 && x.t0 + x.dur > t0) x.dur = +(t0 - x.t0).toFixed(3);
    const ms = [].concat(n.media ?? {}), cut = ms.map((m, j) => (j === ms.length - 1 ? end : t0 + (m.until ?? (end - t0) * (j + 1) / ms.length)));
    ms.forEach((m, j) => {
      const a = j ? cut[j - 1] : t0, card = resolveEffects([{ ...m, fx: 'full-picture', t: a, dur: cut[j] - a, sound: false }], words, outAt, total)[0];
      if (card) fx.push({ ...card, cat: { ...card.cat, matte: false }, k: j ? GAP_K + 500 + k * 10 + j : GAP_K + nG + k, dur: +(cut[j] - a).toFixed(3) });
    });
    const nx = fx.filter((x) => fills(x) && x.t0 >= end - 0.01 && x.t0 - end < 0.4).sort((x, y) => x.t0 - y.t0)[0], last = fx.findLast((x) => x.k >= GAP_K && fills(x) && Math.abs(x.t0 + x.dur - end) < 0.02);
    if (nx && last) last.dur = +(nx.t0 - last.t0).toFixed(3);
    placed.push({ n, t0, end });
  });
  for (const g of pieces.filter((x) => x.gap && x.gi < nG)) {
    const end = g.o + g.e - g.s, next = fx.filter((x) => x.t0 >= end - 0.2 && x.t0 <= end + 0.6 && (x.assets?.src || x.params?.src || x.params?.text)).sort((x, y) => x.t0 - y.t0)[0];
    const prev = fx.filter((x) => x.cat?.group === 'layout' && Math.abs(x.t0 + x.dur - g.o) < 0.6).sort((x, y) => y.t0 - x.t0)[0];
    if (prev) { prev.dur = Math.max(prev.dur, end - prev.t0); continue; }
    const t0 = Math.max(0, Math.min(g.o, end - 0.7));
    if (next) fx.push({ ...next, fx: 'full-picture', cat: { ...next.cat, matte: false }, k: GAP_K + g.gi, t0, dur: end - t0, sounds: [] });
  }
  fx.sort((x, y) => x.t0 - y.t0);
  if (fx.some((e) => e.fx === 'voice-orb')) {
    const env = envelope(rawOf(dir)), toSrc = srcTime(pieces), at = (t) => Math.min(env.rms.length - 1, Math.round(toSrc(t) * env.fps));
    for (const e of fx.filter((x) => x.fx === 'voice-orb')) {
      const n = Math.ceil(e.dur * env.fps);
      e.params.levels = Array.from({ length: n }, (_, k) => env.rms[at(e.t0 + k / env.fps)]);
      e.params.bright = Array.from({ length: n }, (_, k) => env.zcr[at(e.t0 + k / env.fps)]);
    }
  }
  const wins = MOVE_KINDS.flatMap((kind) => (p[kind] ?? []).map(([a, b, amt = 1]) => {
    const t0 = words[a] && outAt(words[a].start + 0.01), t1 = words[b] && outAt(words[b].end - 0.01);
    return t0 != null && t1 > t0 ? { kind, amt, t0, t1: Math.min(t1, total), dur: Math.min(t1, total) - t0 } : null;
  })).filter(Boolean);
  const flow = p.flow ? flowPath(p, words, outAt, total, pieces, punch, [...dropWindows(p, words, outAt, fx, pieces.slice(1).map((x) => x.o)), ...wins], fx) : null;
  const moves = p.camWhoosh === false ? [] : dropWindows(p, words, outAt, fx, pieces.slice(1).map((x) => x.o)).flatMap((w) => [{ sound: 'camdown', at: Math.max(0.15, w.t0), db: -8 }, { sound: 'camup', at: w.t1 + 0.15, db: -8 }]);
  const cues = [...p.sfx.map((x) => ({ sound: x.at === 0 && x.sound === 'whoosh' ? 'hook' : x.sound, at: x.t != null ? +x.t : x.at === 0 && !x.end ? 0 : x.end ? outAt((words[x.at]?.end ?? 0) - 0.01) : outAt(words[x.at]?.start ?? -1), ...(x.ref ? { ref: x.ref } : {}), ...(x.db ? { db: x.db } : {}), ...(x.len ? { len: x.len } : {}) })),
    ...placed.map(({ n, t0 }) => ({ sound: 'file', at: t0 + 0.02, ref: n.file, db: n.db ?? 0 })), ...fx.flatMap((e) => e.sounds), ...moves];
  const pack = packOf(p), banned = new Set((soundPacks().banned ?? []).map((b) => b.file));
  if (pack?.slots.mediacut) for (const c of cues.filter((x) => x.sound === 'itemin' && x.at != null)) {
    const out = cues.find((y) => y.sound === 'itemout' && !y.skip && y.at != null && y.at <= c.at + 0.05 && c.at - y.at < 1);
    if (out) { out.skip = true; c.sound = 'mediacut'; }
  }
  const used = {}, loud = cues.filter((x) => /^(whoosh|hook)$/.test(x.sound) && x.at != null);
  const hook = (soundPacks().hookSounds ?? []).find((x) => x.id === p.hookSound);
  const sfx = cues.filter((x) => !x.skip && !(hook && x.at != null && x.at < 0.35) && !(x.db < 0 && loud.some((y) => Math.abs(y.at - x.at) < 0.3))).map((x) => {
    if (x.ref) { const file = sfxPath(x.ref); return x.at == null || !file || !existsSync(file) ? null : { sound: x.sound ?? 'file', file, ref: x.ref, at: Math.max(0, x.at - 0.02), ...(x.db ? { db: x.db } : {}), ...(x.len ? { len: x.len } : {}) }; }
    const slot = pack?.slots[SLOT_OF[x.sound] ?? x.sound];
    if (slot) {
      const ok = slot.approved.filter((f) => !banned.has(f));
      if (!ok.length || x.at == null) return null;
      const n = used[x.sound] = (used[x.sound] ?? -1) + 1, ref = ok[n % ok.length], file = sfxPath(ref);
      return { sound: x.sound, file, ref, at: Math.max(0, x.at - (/whoosh|hook|cam/.test(x.sound) ? 0.15 : 0.03)), len: slot.len, ...(x.db ? { db: x.db } : {}) };
    }
    const S0 = SOUNDS[x.sound] || SOUNDS.pop, n = used[x.sound] = (used[x.sound] ?? -1) + 1, pick = Array.isArray(S0[0]) ? S0[n % S0.length] : S0;
    const cat = pick[0], num = Array.isArray(pick[1]) ? pick[1][n % pick[1].length] : pick[1];
    const folder = join(SFX_DIR, cat.toLowerCase());
    const file = existsSync(folder) && readdirSync(folder).find((f) => f.startsWith(`${num}_`));
    return x.at == null || !file ? null : { sound: x.sound, file: join(folder, file), ref: `${cat.toLowerCase()}/${file}`, at: Math.max(0, x.at - (/whoosh/.test(x.sound) ? 0.15 : 0.03)), ...(x.db ? { db: x.db } : {}) };
  }).filter(Boolean);
  if (hook) sfx.unshift({ sound: 'hook', file: sfxPath(hook.ref), ref: hook.ref, at: 0, len: hook.len, ...(hook.db ? { db: hook.db } : {}) });
  for (const a of p.sfxAdd ?? []) { const file = sfxPath(a.ref); if (file && existsSync(file)) sfx.push({ sound: 'added', file, ref: a.ref, at: +a.t, ...(a.db ? { db: a.db } : {}) }); }
  // A swapped sound keeps the replaced one's peak level.
  for (const ed of p.sfxEdits ?? []) {
    const i = sfx.findIndex((x) => x.ref === ed.from && Math.abs(x.at - ed.at) < 0.06), file = ed.to && sfxPath(ed.to);
    if (i >= 0) { if (!ed.to) sfx.splice(i, 1); else if (file && existsSync(file)) sfx[i] = { ...sfx[i], ref: ed.to, file, db: +((sfx[i].db ?? 0) + peakDb(sfx[i].file) - peakDb(file)).toFixed(1) }; }
  }

  const L0 = { words, p, pieces, total, outAt, fx, sfx, flow, path: cameraPath(wins, flow, total), edges: cutEdges(dir, words, pieces), captions: captions(words, p, outAt, total, voiceEnds(dir, words), placed.flatMap(({ n, t0 }) => (n.words ?? []).map(([text, s, e]) => ({ i: -1, w: { text, start: s, end: e }, o: t0 + s, d: e - s })))) };
  const hookEnd = p.hookCaps && L0.captions.find((c) => c.kind === 'title')?.t1;
  if (hookEnd) for (const c of L0.captions) if (c.kind === 'cap' && c.t0 < hookEnd && c.t1 > hookEnd) c.t1 = hookEnd;
  return L0;
}

// Always-moving camera: keys [t, zoom, pan] at beats, smooth curve through them. plan.flow = true | {amount, keys: [[wordIndex | 'end', zoom, pan]]}.
// Returns segments [t0, t1, z0..z3, x0..x3]: value = a + b*u + c*u^2 + d*u^3, u = (t - t0) / (t1 - t0). Pan shifts the face point, in frame widths.
export function flowPath(p, words, outAt, total, pieces, punch = [], calm = [], cards = []) {
  const f = p.flow === true ? {} : p.flow, amt = f.amount ?? 1, at = (i) => (i === 'end' ? total : words[i] && outAt(words[i].start + 0.01));
  let keys;
  if (f.keys?.length) keys = f.keys.map(([i, z, x = 0]) => [at(i), z, x]).filter((k) => k[0] != null);
  else {
    const hot = new Set([...(p.highlight ?? []), ...punch]), cand = [];
    words.forEach((w, i) => {
      const o = outAt(w.start + 0.01);
      if (o == null || o < 1.2 || o > total - 1) return;
      if (hot.has(i)) cand.push({ t: o, hot: true });
      else if (i && /[.!?]$/.test(words[i - 1].text)) cand.push({ t: o });
    });
    for (const pc of pieces.slice(1)) if (pc.o > 1.2 && pc.o < total - 1) cand.push({ t: pc.o });
    cand.sort((x, y) => x.t - y.t);
    const rnd = (k) => { const v = Math.sin(k * 12.9898 + (f.seed ?? 7) * 78.233) * 43758.5453; return v - Math.floor(v); };
    keys = [[0, 1, 0]];
    let z = 1, side = 1, n = 0;
    const push = (t, nz, fast) => {
      const last = keys.at(-1);
      for (let g = last[0] + 2.4; g < t - (fast ? 0.9 : 1.2); g = keys.at(-1)[0] + 2.4) { z = z > 1.14 ? 1.04 + rnd(++n) * 0.05 : 1.17 + rnd(++n) * 0.08; side = -side; keys.push([g, z, side * (0.015 + rnd(++n) * 0.03)]); }
      if (fast) { const k = keys.at(-1), drift = Math.min(0.04, (t - k[0]) * 0.025); z = k[1] > 1.15 ? k[1] - drift : k[1] + drift; keys.push([t, z, k[2] * 0.6]); }
      z = nz; side = -side; keys.push([t + (fast ? 0.45 : 0), z, side * (0.015 + rnd(++n) * 0.03)]);
    };
    for (const c of cand) {
      if (c.t - keys.at(-1)[0] < (c.hot ? 1.1 : 1.8)) continue;
      push(c.t, c.hot ? Math.min(1.3, Math.max(z, 1.1) + 0.1 + rnd(++n) * 0.05) : z > 1.14 ? 1.03 + rnd(++n) * 0.06 : 1.17 + rnd(++n) * 0.1, c.hot);
    }
    push(total, Math.max(1.06, z - 0.06), false);
    keys.at(-1)[0] = total;
    keys = keys.map(([t, z, x]) => [t, 1 + (z - 1) * amt, x * amt]);
  }
  for (const w of calm) {
    keys = keys.filter(([t]) => t < w.t0 - 0.6 || t > w.t1 + 0.6);
    keys.push([Math.max(0, w.t0 - 0.6), 1, 0], [Math.min(total, w.t1 + 0.6), 1, 0]);
  }
  for (const e of cards) {
    keys = keys.filter(([t]) => t < e.t0 - 0.5 || t > e.t0 + e.dur + 0.3);
    keys.push([Math.max(0, e.t0 - 0.5), 1.02, 0], [Math.min(total, e.t0 + e.dur + 0.3), 1.07, 0]);
  }
  keys.sort((x, y) => x[0] - y[0]);
  keys = keys.filter((k, i) => !i || k[0] - keys[i - 1][0] > 0.05);
  if (keys.length < 2) return [];
  const slopes = (ch) => {
    const d = keys.slice(1).map((k, i) => (k[ch] - keys[i][ch]) / (k[0] - keys[i][0]));
    return keys.map((_, i) => (i === 0 || i === keys.length - 1 || d[i - 1] * d[i] <= 0 ? 0 : (2 * d[i - 1] * d[i]) / (d[i - 1] + d[i])));
  };
  const mz = slopes(1), mx = slopes(2), r = (v) => +v.toFixed(5);
  const poly = (p0, p1, m0, m1, h) => { const M0 = m0 * h, M1 = m1 * h; return [p0, M0, 3 * (p1 - p0) - 2 * M0 - M1, 2 * (p0 - p1) + M0 + M1].map(r); };
  return keys.slice(1).map((k, i) => { const a = keys[i], h = k[0] - a[0]; return [r(a[0]), r(k[0]), ...poly(a[1], k[1], mz[i], mz[i + 1], h), ...poly(a[2], k[2], mx[i], mx[i + 1], h)]; });
}
export function flowAt(segs, t) {
  if (!segs?.length) return [1, 0];
  const s = segs.find((x) => t < x[1]) ?? segs.at(-1), u = Math.min(1, Math.max(0, (t - s[0]) / (s[1] - s[0])));
  return [s[2] + u * (s[3] + u * (s[4] + u * s[5])), s[6] + u * (s[7] + u * (s[8] + u * s[9]))];
}

// Voice level on the last frame played before each jump cut and the first frame after it (1 = loud speech).
// Where each word's voice stops (source s): the aligner hands the last word before a pause the whole pause.
function voiceEnds(dir, words) {
  const raw = readdirSync(dir).find((f) => f.startsWith('raw.'));
  if (!raw) return words.map((w) => w.end);
  const rms = fine(join(dir, raw)).rms;
  return words.map((w) => {
    let quiet = 0;
    for (let f = Math.round(w.start * 100) + 12; f < Math.round(w.end * 100); f++) if ((rms[f] ?? 0) < 0.2 ? ++quiet >= 12 : (quiet = 0)) return Math.min((f - 11) / 100, w.start + 1.2);
    return Math.min(w.end, w.start + 1.2);
  });
}

function cutEdges(dir, words, pieces) {
  const raw = readdirSync(dir).find((f) => f.startsWith('raw.'));
  if (!raw) return [];
  const env = fine(join(dir, raw)), lv = (a, b) => { let m = 0; for (let f = Math.round(a * 100); f < Math.round(b * 100); f++) m = Math.max(m, env.rms[f] ?? 0); return m; };
  const near = (t) => words.reduce((best, w) => (Math.abs((w.start + w.end) / 2 - t) < Math.abs((best.start + best.end) / 2 - t) ? w : best), words[0]);
  const out = [];
  pieces.forEach((pc, k) => {
    const nx = pieces[k + 1];
    if (nx && Math.abs(nx.s - pc.e) < 0.02) return;
    out.push({ kind: 'out', t: +(pc.o + pc.e - pc.s).toFixed(2), src: pc.e, level: lv(pc.e - 0.02, pc.e), word: near(pc.e - 0.05).text });
    if (nx) out.push({ kind: 'in', t: +nx.o.toFixed(2), src: nx.s, level: lv(nx.s, nx.s + 0.02), word: near(nx.s + 0.05).text });
  });
  return out;
}

// [{t0, t1, kind: title|sub|cap, text, hi, y}] in output seconds; words shown under 0.2 s ride with the next word.
export function captions(words, p, outAt, total, voiceEnd = words.map((w) => w.end), extra = []) {
  const hi = new Set(p.highlight);
  const titleEnd = Math.min(p.titleDur ?? 3.2, total), ty = camTitle(p, words, outAt) ? CAM_TITLE_Y : p.titleY ?? 360;
  const tx = 540 + (p.titleDX ?? 0), ev = [{ t0: 0, t1: titleEnd, kind: 'title', text: p.title, y: ty, x: tx, s: p.titleScale ?? 1, ts: p.titleStyle || 'serif', moved: !!p.titleMoved, color: p.titleColor || null, anim: p.titleAnim || null, ...(p.hookCaps ? { capY: p.hookCaps.y, capS: p.hookCaps.s } : {}), ...(p.titleWt ? { wt: p.titleWt } : {}) }];
  if (p.subtitle) ev.push({ t0: 0, t1: titleEnd, kind: 'sub', text: p.subtitle, y: ty + 160, x: tx });
  const spoken = (i) => (!p.keep || p.keep.some(([a, b]) => i >= a && i <= b)) && !(p.drop ?? []).some(([a, b]) => i >= a && i <= b);
  const shown = [...words.map((w, i) => ({ i, w, o: outAt(w.start + 0.01) })).filter((x) => x.o != null && spoken(x.i) && !(p.quietTitle && x.o < titleEnd - 0.05) && !p.noCaps?.some(([a, b]) => x.i >= a && x.i <= b)), ...extra].sort((a, b) => a.o - b.o);
  const norm = (w) => String(w).toLowerCase().replace(/[^a-z0-9]/g, ''), toks = String(p.title ?? '').split(/\s+/).filter(Boolean);
  const said = words.map((w, i) => ({ w, o: outAt(w.start + 0.01) })).filter((x) => x.o != null).sort((a, b) => a.o - b.o).slice(0, toks.length);
  if (toks.length && said.length === toks.length && toks.every((t, i) => norm(t) === norm(said[i].w.text))) ev[0].wt = said.map((x) => +x.o.toFixed(3));
  const caps = shown.map((x, k) => {
    const next = shown[k + 1]?.o ?? total;
    const voice = x.o + (x.d ?? voiceEnd[x.i] - x.w.start);
    return { t0: x.o, t1: Math.min(next, Math.max(x.o + 0.35, (p.capHold ? x.o + x.w.end - x.w.start : voice) + 0.25)), kind: 'cap', text: x.w.text, hi: hi.has(x.i), i: x.i, voice, y: 1290 + (p.captionDY ?? 0), s: p.captionScale ?? 1 };
  });
  for (let k = 0; k < caps.length - 1; k++) {
    const c = caps[k], n = caps[k + 1];
    if (c.t1 - c.t0 < 0.2 && n.t0 - c.t1 < 0.05 && !/[.!?,]$/.test(c.text)) {
      caps[k + 1] = { ...n, t0: c.t0, text: `${c.text} ${n.text}`, hi: n.hi || c.hi, i: n.hi ? n.i : c.i };
      caps[k] = null;
    }
  }
  return [...ev, ...caps.filter(Boolean)];
}

// your script edits: cut words, or bring cut words back into the play order next to their neighbours. Returns a new plan.
export function editWords(plan, words, idx, keep) {
  const p = JSON.parse(JSON.stringify(plan)), dropped = new Set(wordIndexes(p.drop, words.length));
  let order = wordIndexes(p.keep ?? [[0, words.length - 1]], words.length).filter((i) => !dropped.has(i));
  const set = new Set(idx);
  if (!keep) order = order.filter((i) => !set.has(i));
  else for (const i of [...set].sort((a, b) => a - b)) {
    if (order.includes(i)) continue;
    let at = order.findIndex((j, k) => j < i && (order[k + 1] == null || order[k + 1] > i) && i - j <= 40);
    if (at < 0) at = order.findIndex((j) => j > i && j - i <= 40) - 1;
    order.splice(at + 1, 0, i);
  }
  const ranges = [];
  for (const i of order) { const r = ranges.at(-1); if (r && i === r[1] + 1) r[1] = i; else ranges.push([i, i]); }
  p.keep = ranges; p.drop = [];
  return p;
}

// Zoom bars for the page: every punch zoom, slow push and tight crop in output seconds, with what the drag edits.
export function zoomsOf(L) {
  const { p, words, outAt } = L, out = [];
  for (const i of p.snap ?? []) { const t0 = words[i] && outAt(words[i].start + 0.01); if (t0 != null) out.push({ kind: 'snap', k: i, t0: +t0.toFixed(2), dur: p.snapSecs?.[i] ?? SNAP_SECS, z: p.snapZoom?.[i] ?? SNAP_ZOOM }); }
  for (const [kind, list, zd] of [['slow', p.slow ?? [], SLOW_ZOOM], ['hold', p.hold ?? [], HOLD_ZOOM], ['camdrop', p.camdrop ?? [], 1], ...MOVE_KINDS.map((k) => [k, p[k] ?? [], peakOf(k)])]) list.forEach(([a, b, z], k) => {
    const t0 = words[a] && outAt(words[a].start + 0.01), t1 = words[b] && outAt(words[b].end - 0.01);
    const zoom = MOVE_KINDS.includes(kind) ? 1 + (zd - 1) * (z ?? 1) : z ?? zd;
    if (t0 != null && t1 != null && t1 > t0) out.push({ kind, k, t0: +t0.toFixed(2), dur: +(t1 - t0).toFixed(2), z: +zoom.toFixed(3), ...(MOVE_KINDS.includes(kind) ? { amt: z ?? 1 } : {}) });
  });
  return out.sort((x, y) => x.t0 - y.t0);
}

// Kept words nearest a new zoom range [t, t + dur] in output seconds: [first, last] word index, null if none.
export function wordsIn(L, t, dur) {
  const said = L.words.map((w, i) => ({ i, a: L.outAt(w.start + 0.01), b: L.outAt(w.end - 0.01) })).filter((x) => x.a != null && x.b != null);
  if (!said.length) return null;
  const first = said.reduce((m, x) => (Math.abs(x.a - t) < Math.abs(m.a - t) ? x : m)), end = t + dur;
  const last = said.filter((x) => x.a >= first.a).reduce((m, x) => (Math.abs(x.b - end) < Math.abs(m.b - end) ? x : m), first);
  return [first.i, Math.max(first.i, last.i)];
}
