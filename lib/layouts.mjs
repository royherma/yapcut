// Layout versions: copies of one version, each with one split-screen layout on 2-3 spoken sentences. Loaded on demand.
import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync, symlinkSync, copyFileSync, realpathSync } from 'node:fs';
import { join } from 'node:path';
import { layout } from './edit.mjs';
import { quickFx } from './addfx.mjs';
import { EFFECTS } from '../effects/catalog.mjs';

export const LAYOUTS = EFFECTS.filter((e) => e.group === 'layout');

// Sentences (or comma clauses) that fit a layout: after the hook title, 2-9 s long, one per stretch of the video, closest to 4.5 s.
function sentences(L) {
  const said = L.words.map((w, i) => ({ i, w, o: L.outAt(w.start + 0.01), e: L.outAt(w.end - 0.01) })).filter((x) => x.o != null && x.e != null).sort((a, b) => a.o - b.o);
  const out = [];
  let cur = [];
  for (const x of said) { cur.push(x); if (/[.!?]$/.test(x.w.text) || (/[,;:]$/.test(x.w.text) && x.e - cur[0].o >= 2.5)) { out.push(cur); cur = []; } }
  if (cur.length) out.push(cur);
  return out.map((s) => ({ at: s[0].i, to: s.at(-1).i, t0: s[0].o, t1: s.at(-1).e }));
}

// Sentences (or comma clauses) that fit a layout: after the hook title, 2-9 s long, one per stretch of the video, closest to 4.5 s.
export function layoutSpots(L, n) {
  const ok = sentences(L).filter((s) => s.t0 >= 3.5 && s.t1 <= L.total - 1.5 && s.t1 - s.t0 >= 2 && s.t1 - s.t0 <= 9);
  const fit = (x, y) => Math.abs(x.t1 - x.t0 - 4.5) - Math.abs(y.t1 - y.t0 - 4.5), out = [];
  for (let k = 0; k < n; k++) { const a = (L.total * k) / n, b = (L.total * (k + 1)) / n, s = ok.filter((x) => x.t0 >= a && x.t0 < b).sort(fit)[0]; if (s) out.push(s); }
  for (const s of ok.slice().sort(fit)) if (out.length < n && !out.some((x) => s.t0 < x.t1 + 1 && s.t1 > x.t0 - 1)) out.push(s);
  return out.sort((x, y) => x.t0 - y.t0);
}

// Mostly split: everything after the hook sits in the layout; every third sentence and the last one go back to full screen.
export function mostlySpans(L) {
  const all = sentences(L).filter((s) => s.t0 >= 3.5), last = all.length - 1, spans = [];
  all.forEach((s, k) => {
    if (k % 3 === 2 || k === last) return;
    const prev = spans.at(-1);
    if (prev && prev.k === k - 1) Object.assign(prev, { to: s.to, t1: s.t1, k }); else spans.push({ ...s, k });
  });
  return spans.filter((s) => s.t1 - s.t0 >= 1.5);
}

export function makeLayoutRuns(runsDir, video, from) {
  const file = join(runsDir, video, 'compare.json'), c = JSON.parse(readFileSync(file, 'utf8'));
  if (!c.runs.includes(from)) throw new Error(`no version ${from}`);
  const src = join(runsDir, from), L = layout(src), spots = layoutSpots(L, L.total < 40 ? 2 : 3), mostly = mostlySpans(L);
  if (!spots.length) throw new Error('no sentence between 2 and 9 s after the hook title');
  const plan = JSON.parse(readFileSync(join(src, 'plan.json'), 'utf8')), raw = readdirSync(src).find((f) => f.startsWith('raw.'));
  c.preset ??= {}; c.judge ??= {};
  const fxAt = (s, id) => ({ ...quickFx(L, s.t0 + 0.05, id), at: s.at, to: s.to, why: `layout version, ${s.t0.toFixed(1)}-${s.t1.toFixed(1)} s` });
  const write = (id, name, spans, ids) => {
    const run = `${from}-lay-${id}`, dir = join(runsDir, run);
    const clash = new Set(L.fx.filter((e) => spans.some((s) => e.t0 < s.t1 + 0.3 && e.t0 + e.dur > s.t0 - 0.3)).map((e) => e.k));
    mkdirSync(dir, { recursive: true });
    if (!readdirSync(dir).some((f) => f.startsWith('raw.'))) symlinkSync(realpathSync(join(src, raw)), join(dir, raw));
    copyFileSync(join(src, 'words.json'), join(dir, 'words.json'));
    const p = { ...plan, effects: [...(plan.effects ?? []).filter((_, k) => !clash.has(k)), ...spans.map((s, k) => fxAt(s, ids[k % ids.length]))] };
    writeFileSync(join(dir, 'plan.json'), JSON.stringify(p, null, 1));
    writeFileSync(join(dir, 'plan.orig.json'), JSON.stringify(p, null, 1));
    if (!c.runs.includes(run)) c.runs.push(run);
    c.label[run] = `${c.label[from] ?? from} · ${name}`;
    c.preset[run] = { id: `layout-${id}`, name: c.label[run], intensity: 'layout', length: c.preset[from]?.length, from, brief: `${c.preset[from]?.brief ?? ''} Layout: ${name}, ${spans.length} section${spans.length === 1 ? '' : 's'}.`.trim() };
    if (c.judge[from]) c.judge[run] = c.judge[from];
    return run;
  };
  const ids = LAYOUTS.map((x) => x.id), made = [
    ...LAYOUTS.map((cat) => write(cat.id, cat.name, spots, [cat.id])),
    ...(mostly.length ? LAYOUTS.map((cat) => write(`mostly-${cat.id}`, `Mostly ${cat.name}`, mostly, [cat.id])) : []),
    write('mixed', 'Mixed layouts', mostly.length ? mostly : spots, ids),
  ];
  writeFileSync(file, JSON.stringify(c, null, 1));
  return { made, spots: spots.map((s) => [+s.t0.toFixed(1), +s.t1.toFixed(1)]), mostly: mostly.map((s) => [+s.t0.toFixed(1), +s.t1.toFixed(1)]) };
}

// "Always moving" version: a copy of one version with the whole-video camera path on (plan.flow, see flowPath in lib/edit.mjs).
export function makeFlowRun(runsDir, video, from) {
  const file = join(runsDir, video, 'compare.json'), c = JSON.parse(readFileSync(file, 'utf8'));
  if (!c.runs.includes(from)) throw new Error(`no version ${from}`);
  const src = join(runsDir, from), run = `${from}-flow`, dir = join(runsDir, run), raw = readdirSync(src).find((f) => f.startsWith('raw.'));
  const p = { ...JSON.parse(readFileSync(join(src, 'plan.json'), 'utf8')), flow: true };
  mkdirSync(dir, { recursive: true });
  if (!readdirSync(dir).some((f) => f.startsWith('raw.'))) symlinkSync(realpathSync(join(src, raw)), join(dir, raw));
  copyFileSync(join(src, 'words.json'), join(dir, 'words.json'));
  writeFileSync(join(dir, 'plan.json'), JSON.stringify(p, null, 1));
  writeFileSync(join(dir, 'plan.orig.json'), JSON.stringify(p, null, 1));
  c.preset ??= {}; c.judge ??= {};
  if (!c.runs.includes(run)) c.runs.push(run);
  c.label[run] = `${c.label[from] ?? from} · Always moving`;
  c.preset[run] = { id: 'flow', name: c.label[run], intensity: c.preset[from]?.intensity ?? 'flow', length: c.preset[from]?.length, from, brief: `${c.preset[from]?.brief ?? ''} Camera never still: drifts in, out, left, right, pushes in fast on key words.`.trim() };
  if (c.judge[from]) c.judge[run] = c.judge[from];
  writeFileSync(file, JSON.stringify(c, null, 1));
  return run;
}
