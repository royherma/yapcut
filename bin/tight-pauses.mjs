#!/usr/bin/env node
// node bin/tight-pauses.mjs <version> [secs=0.1] [--redo]: no quiet stretch in the played audio lasts longer than secs. Adds to what is there; --redo replaces earlier runs. One undo step.
import { readFileSync, writeFileSync, copyFileSync, mkdirSync, readdirSync, existsSync, realpathSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { layout, rawOf } from '../lib/edit.mjs';

const args = process.argv.slice(2), redo = args.includes('--redo'), [run, s0] = args.filter((a) => a !== '--redo'), secs = s0 == null ? 0.1 : +s0;
if (!run || !(secs >= 0)) { console.error('usage: node bin/tight-pauses.mjs <version> [secs=0.1]'); process.exit(1); }
const dir = join(dirname(fileURLToPath(import.meta.url)), '..', 'runs', run), planFile = join(dir, 'plan.json');
if (!existsSync(planFile)) { console.error(`no plan.json in ${dir}`); process.exit(1); }

// Quiet = under 6% of the take's loud level AND no hiss above 3.5 kHz (an "s" or "t" is quiet on level but loud up there).
const raw = realpathSync(rawOf(dir)), qFile = join(dirname(raw), 'quiet100.json');
const env = (filter) => {
  const b = execFileSync('ffmpeg', ['-v', 'error', '-i', raw, '-af', `aresample=async=1:first_pts=0${filter}`, '-ac', '1', '-ar', '16000', '-f', 'f32le', '-'], { maxBuffer: 1 << 30 });
  const x = new Float32Array(b.buffer.slice(b.byteOffset, b.byteOffset + b.length)), e = [];
  for (let a = 0; a + 160 <= x.length; a += 160) { let q = 0; for (let k = a; k < a + 160; k++) q += x[k] * x[k]; e.push(Math.sqrt(q / 160)); }
  return e;
};
if (!existsSync(qFile)) {
  const lv = env(''), hf = env(',highpass=f=3500,highpass=f=3500'), s = (a) => [...a].sort((x, y) => x - y);
  const top = s(lv)[Math.floor(lv.length * 0.95)], floor = s(hf)[Math.floor(hf.length * 0.1)] || 1e-6;
  writeFileSync(qFile, JSON.stringify(lv.map((v, f) => (v < top * 0.06 && hf[f] < floor * 8 ? 1 : 0)).join('')));
}
const Q = JSON.parse(readFileSync(qFile, 'utf8')), quiet = (f) => Q[f] === '1';

function quietRuns(L) {
  const out = [];
  let cur = null;
  for (const pc of [...L.pieces].sort((a, b) => a.o - b.o)) {
    for (let f = Math.ceil(pc.s * 100); f < Math.floor(pc.e * 100); f++) {
      if (quiet(f)) { if (!cur) cur = { parts: [] }; const last = cur.parts.at(-1); if (last && last.pc === pc) last.b = (f + 1) / 100; else cur.parts.push({ pc, a: f / 100, b: (f + 1) / 100 }); }
      else if (cur) { out.push(cur); cur = null; }
    }
  }
  if (cur) out.push(cur);
  return out.map((r) => ({ ...r, len: r.parts.reduce((n, x) => n + x.b - x.a, 0) })).filter((r) => r.len > secs + 0.02);
}

const p = JSON.parse(readFileSync(planFile, 'utf8'));
const edits = join(dir, 'edits');
mkdirSync(edits, { recursive: true });
copyFileSync(planFile, join(edits, `${String(readdirSync(edits).filter((f) => /^\d+\.json$/.test(f)).length + 1).padStart(3, '0')}.json`));
const before = p.tightAuto ?? { pauses: [], squeeze: [] };
const auto = new Set(redo ? before.pauses ?? [] : []), autoSq = JSON.stringify(redo ? before.squeeze ?? [] : []);
p.pauseSet = (p.pauseSet ?? []).filter((q) => !auto.has(q.after));
p.keepPause = (p.keepPause ?? []).filter((i) => !auto.has(i));
p.squeeze = (p.squeeze ?? []).filter((q) => !autoSq.includes(JSON.stringify(q)));
const L0 = layout(dir, p), squeeze = [], pauses = [], w = L0.words, mine = new Set(p.pauseSet.map((q) => q.after));
const kept = w.map((x, i) => ({ i, o: L0.outAt(x.start + 0.01) })).filter((x) => x.o != null).sort((a, b) => a.o - b.o);
for (let k = 1; k < kept.length; k++) {
  const a = kept[k - 1].i;
  if (kept[k].i !== a + 1 || mine.has(a)) continue;
  const runs = [];
  let run = null;
  for (let f = Math.round(w[a].start * 100) + 5; f <= Math.round(w[a + 1].start * 100) + 5; f++) {
    if (quiet(f)) run = run ? { ...run, b: f + 1 } : { a: f, b: f + 1 };
    else { if (run && run.b - run.a >= 8) runs.push(run); run = null; }
  }
  if (run && run.b - run.a >= 8) runs.push(run);
  let lastA = Math.round(w[a].start * 100), firstB = Math.round(w[a + 1].end * 100);
  for (let f = Math.round(w[a].start * 100); f <= Math.round(w[a].end * 100); f++) if (!quiet(f)) lastA = f;
  for (let f = Math.round(w[a + 1].end * 100); f >= Math.round(w[a + 1].start * 100); f--) if (!quiet(f)) firstB = f;
  runs.splice(0, runs.length, ...runs.filter((r) => r.a > lastA && r.b <= firstB));
  const best = runs.length ? { a: runs[0].a, b: runs.at(-1).b } : { a: Math.round(w[a].end * 100), b: Math.round(w[a + 1].start * 100) };
  if (best && (best.b - best.a) / 100 > secs + 0.04) pauses.push({ after: a, from: best.a / 100, to: best.b / 100, secs });
}
p.pauseSet = [...p.pauseSet, ...pauses];
p.keepPause = [...new Set([...p.keepPause, ...pauses.map((q) => q.after)])];
let L = layout(dir, p);
for (let round = 0; round < 4; round++) {
  const runs = quietRuns(L);
  if (!runs.length) break;
  const add = [];
  for (const r of runs) {
    const first = r.parts[0], last = r.parts.at(-1), keep = secs / 2;
    if (r.parts.length === 1) { const a = first.a + keep, b = first.b - keep; if (b - a > 0.02) add.push([a, Math.min(b, first.pc.e - 0.005)]); continue; }
    if (first.b - first.a > keep + 0.02) add.push([first.a + keep, first.pc.e - 0.005]);
    if (last.b - last.a > keep + 0.02) add.push([last.pc.s + 0.005, last.b - keep]);
    for (const mid of r.parts.slice(1, -1)) add.push([mid.pc.s + 0.005, mid.pc.e - 0.005]);
  }
  const ok = add.map(([a, b]) => [+a.toFixed(3), +b.toFixed(3)]).filter(([a, b]) => b - a > 0.015);
  if (!ok.length) break;
  squeeze.push(...ok);
  p.squeeze = [...p.squeeze, ...ok];
  L = layout(dir, p);
}
p.tightAuto = { secs, pauses: [...(redo ? [] : before.pauses ?? []), ...pauses.map((q) => q.after)], squeeze: [...(redo ? [] : before.squeeze ?? []), ...squeeze] };
const said = (a) => { for (let i = a; i < L.words.length; i++) { const o = L.outAt(L.words[i].start + 0.01); if (o != null) return o; } return null; };
const timed = (p.effects ?? []).filter((e) => Number.isInteger(e.at) && e.t != null).sort((a, b) => a.t - b.t), cards = timed.filter((e) => e.fx === 'media-card');
for (const e of timed) { const o = said(e.at); if (o != null) e.t = e === cards[0] && e.t === 0 ? 0 : +o.toFixed(2); }
cards.forEach((e, k) => { e.dur = +((cards[k + 1]?.t ?? L.total) - e.t).toFixed(2); });
writeFileSync(planFile, JSON.stringify(p, null, 1));
const left = quietRuns(layout(dir)).sort((x, y) => y.len - x.len);
console.log(`${pauses.length} pauses set to ${secs} s + ${squeeze.length} cut-point trims, ${L0.total.toFixed(1)} s -> ${L.total.toFixed(1)} s, ${timed.length} effects back on their words`);
console.log(`still over ${(secs + 0.02).toFixed(2)} s: ${left.length}${left.length ? ' - ' + left.slice(0, 6).map((x) => `${x.parts[0].a.toFixed(2)} ${x.len.toFixed(2)}`).join(', ') : ''}`);
