// Grade 0-100 for one version, and the tune loop: try one fix, re-grade, keep it only if the grade goes up.
import { existsSync, readFileSync, writeFileSync, appendFileSync, copyFileSync } from 'node:fs';
import { join } from 'node:path';
import { layout } from './edit.mjs';
import { timing, onScreen, CLIP, isSwitchSound } from './rules.mjs';
import { byId } from '../effects/catalog.mjs';
import { shape } from './formats.mjs';

const CAPTION_STYLES = ['tg-active-now', 'tg-active-reveal', 'tg-active-pop', 'tg-mark-marker', 'tg-mark-box', 'tg-active-color', 'tg-pill-sentence'];

const STOP = new Set('a an the is are was it its it\'s of to in on and or but so that this you i we be as at for with'.split(' '));
const bare = (s) => s.toLowerCase().replace(/[^a-z0-9']/g, '');
export const PARTS = [
  ['hook', 'Hook', 0.16, 'AI judge: would the first 3 s - hook title + first words - stop a scroller? 0-100.'],
  ['clarity', 'One idea', 0.13, 'AI judge: is there ONE clear idea a newcomer gets? 0-100.'],
  ['shape', 'Structure', 0.12, 'Code: share of the beats this video format needs that the cut plays (a beat counts when half of one of its parts plays), minus 40 if the cut does not end inside the closing beat.'],
  ['ending', 'Ending', 0.08, 'AI judge: does it end on a satisfying, complete line - the closing beat of its format? 0-100.'],
  ['length', 'Length', 0.1, 'Code: 100 from 20 to 60 s; minus 1.2 per second over 60, minus 4 per second under 20.'],
  ['rules', 'Rule book', 0.23, 'Code: 100 x e^-((12 x bad + 4 x warn) / 120) over the Checks list (captions, cuts, effects, safe area, missing beats...).'],
  ['pace', 'Pace', 0.09, 'Code: cuts per minute (an always-moving camera move counts as half a cut); 100 from 15 to 35, minus 6 per cut under 15, minus 4 per cut over 35.'],
  ['interest', 'Visual interest', 0.09, 'Code: 40 + 60 x (effects + punch zooms + half the slow pushes + half the always-moving camera moves) per 10 s, full marks at 1.5 per 10 s.'],
];

export function grade(L, judge, geom = [], take = []) {
  const issues = onScreen(L, [...timing(L).filter((x) => x.rule !== 'Too long for a Reel'), ...geom, ...take]);
  const bad = issues.filter((x) => x.sev === 'bad').length, warn = issues.filter((x) => x.sev === 'warn').length;
  const len = L.total, cam = (L.flow?.length ?? 0) * 0.5, cpm = ((L.pieces.length - 1 + cam) / len) * 60, sh = shape(L), moves = L.fx.length + L.p.snap.length + L.p.slow.length * 0.5 + cam;
  const parts = {
    hook: judge.hook, clarity: judge.clarity, ending: judge.ending, shape: sh.score,
    length: Math.round(len > 60 ? Math.max(0, 100 - (len - 60) * 1.2) : len < 20 ? Math.max(0, 100 - (20 - len) * 4) : 100),
    rules: Math.round(100 * Math.exp(-(12 * bad + 4 * warn) / 120)),
    interest: Math.round(40 + 60 * Math.min(1, ((moves / len) * 10) / 1.5)),
    pace: Math.round(cpm < 15 ? Math.max(0, 100 - (15 - cpm) * 6) : cpm > 35 ? Math.max(0, 100 - (cpm - 35) * 4) : 100),
  };
  const jr = judge.reasons ?? {};
  const why = {
    hook: jr.hook ?? judge.why ?? '', clarity: jr.clarity ?? judge.why ?? '', ending: jr.ending ?? judge.why ?? '', shape: sh.why,
    length: `${len.toFixed(0)} s long${len > 60 ? ` - ${(len - 60).toFixed(0)} s over 60` : len < 20 ? ` - ${(20 - len).toFixed(0)} s under 20` : ' - inside 20-60 s'}`,
    rules: `${bad} bad + ${warn} warn checks failed${issues.length ? `: ${[...new Set(issues.map((x) => x.rule))].slice(0, 4).join(', ')}` : ''}`,
    pace: `${cpm.toFixed(1)} cuts per minute${cam ? ` (${L.pieces.length - 1} cuts + ${L.flow.length} camera moves counted as half each)` : ''}${cpm < 15 ? ' - under 15, feels slow' : cpm > 35 ? ' - over 35, feels choppy' : ''}`,
    interest: `${(moves / len * 10).toFixed(2)} moves per 10 s (${L.fx.length} effects, ${L.p.snap.length} punch zooms, ${L.p.slow.length} slow pushes${cam ? `, ${L.flow.length} always-moving camera moves at half each` : ''}); full marks at 1.5`,
  };
  const total = +PARTS.reduce((a, [k, , w]) => a + (parts[k] ?? 0) * w, 0).toFixed(1);
  const weakest = PARTS.map(([k, label]) => ({ k, label, v: parts[k] ?? 0 })).sort((a, b) => a.v - b.v)[0];
  return { total, parts, why, weakest, bad, warn, issues, beats: sh.beats, format: sh.format };
}

// Geometry findings still true after a candidate: drop the ones about an effect it removed or a title it moved.
function geomAfter(geom, p, before) {
  const gone = (before.effects ?? []).filter((e) => !(p.effects ?? []).some((x) => x.fx === e.fx && x.at === e.at)).map((e) => e.fx);
  return geom.filter((g) => !gone.some((f) => g.msg.includes(`effect ${f}`)) && !((p.titleY ?? 360) !== (before.titleY ?? 360) && /hook title|subtitle/.test(g.msg)));
}

function candidates(p, L, face, geom, ctx = {}) {
  const out = [], caps = new Map(L.captions.filter((c) => c.kind === 'cap').map((c) => [c.i, c]));
  if (p.capHold && [...caps.values()].some((c) => c.voice != null && c.t1 - c.voice > 0.6)) out.push({ label: 'End each caption with its word', apply: (q) => ({ ...q, capHold: false }) });
  const fillers = (p.highlight ?? []).filter((i) => caps.has(i) && STOP.has(bare(caps.get(i).text)));
  if (fillers.length) out.push({ label: `Un-highlight filler words (${fillers.map((i) => caps.get(i).text).join(', ')})`, apply: (q) => ({ ...q, highlight: q.highlight.filter((i) => !fillers.includes(i)) }) });
  let lastHi = -9;
  const crowded = (p.highlight ?? []).filter((i) => caps.has(i)).sort((a, b) => caps.get(a).t0 - caps.get(b).t0).filter((i) => { const t = caps.get(i).t0; const c = t - lastHi < 2.5; if (!c) lastHi = t; return c; });
  if (crowded.length) out.push({ label: `Drop ${crowded.length} crowded highlights`, apply: (q) => ({ ...q, highlight: q.highlight.filter((i) => !crowded.includes(i)) }) });
  const ty = p.titleY ?? 360;
  if (face && ty + 120 > face.y0 && ty - 120 < face.y1) out.push({ scan: true, win: [0, 3.6], label: `Move hook title off the face (y ${ty} -> ${Math.min(960, face.y1 + 150)})`, apply: (q) => ({ ...q, titleY: Math.min(960, face.y1 + 150) }) });
  const sfxT = (p.sfx ?? []).filter((x) => !isSwitchSound(x)).map((x) => ({ x, t: x.at === 0 ? 0 : L.outAt(L.words[x.at]?.start ?? -1) })).filter((s) => s.t != null).sort((a, b) => a.t - b.t);
  let lastS = -9;
  const dense = sfxT.filter((s) => { const c = s.t - lastS < 4; if (!c) lastS = s.t; return c; }).map((s) => s.x);
  if (dense.length) out.push({ label: `Drop ${dense.length} crowded sounds`, apply: (q) => ({ ...q, sfx: q.sfx.filter((x) => !dense.includes(x)) }) });
  const fxSounds = L.fx.filter((e) => e.sounds.length).map((e) => ({ e, t: e.t0 })).sort((a, b) => a.t - b.t);
  const crowdedFx = fxSounds.filter((x) => [...sfxT.map((s) => s.t), ...fxSounds.filter((y) => y !== x).map((y) => y.t)].some((t) => Math.abs(t - x.t) < 4 && t <= x.t));
  if (crowdedFx.length) out.push({ label: `Mute ${crowdedFx.length} effect sounds that crowd others (${crowdedFx.map((x) => x.e.fx).join(', ')})`, apply: (q) => ({ ...q, effects: q.effects.map((x, k) => (crowdedFx.some((c) => c.e.k === k) ? { ...x, sound: false } : x)) }) });
  const keptIdx = new Set(L.captions.filter((c) => c.kind === 'cap').map((c) => c.i));
  L.pieces.forEach((pc, k) => {
    const pr = L.pieces[k - 1];
    if (!pr || pc.snap || pr.snap || pc.e - pc.s >= 0.7 || pc.s < pr.e || pc.s - pr.e > 1.5) return;
    const gap = L.words.map((w, i) => i).filter((i) => !keptIdx.has(i) && L.words[i].start >= pr.e - 0.1 && L.words[i].end <= pc.s + 0.1);
    if (gap.length && gap.length <= 4 && !gap.every((i) => /^(uh|um|erm|ah)[,.]?$/i.test(L.words[i].text))) out.push({ label: `Put back "${gap.map((i) => L.words[i].text).join(' ')}" at ${pc.o.toFixed(1)} s (removes a jump cut)`, apply: (q) => restore(q, gap) });
  });
  for (const e of L.fx) {
    const src = (p.effects ?? [])[e.k];
    if (!src) continue;
    if (geom.some((g) => g.rule === 'Text on the face' && g.msg.includes(`effect ${e.fx}`))) out.push({ label: `Drop ${e.fx} (covers the face)`, apply: (q) => ({ ...q, effects: q.effects.filter((x) => x !== src) }) });
    if (e.t0 < 2) out.push({ label: `Drop ${e.fx} (in the first 2 s)`, apply: (q) => ({ ...q, effects: q.effects.filter((x) => x !== src) }) });
  }
  const fx = [...L.fx].sort((a, b) => a.t0 - b.t0);
  fx.forEach((e, k) => { const pr = fx[k - 1]; const src = (p.effects ?? [])[e.k]; if (pr && src && e.t0 - (pr.t0 + pr.dur) < 1.5) out.push({ label: `Drop ${e.fx} (too close to ${pr.fx})`, apply: (q) => ({ ...q, effects: q.effects.filter((x) => x !== src) }) }); });
  const geomHit = (re) => geom.filter((g) => re.test(g.msg));
  if (geomHit(/hook title|subtitle/).length) {
    const fb = ctx.faceBottom?.(L) ?? (face ? face.y1 : 760);
    for (const y of [fb + 135, Math.min(1060, fb + 220), 1000]) if (Math.abs(y - (p.titleY ?? 360)) > 20 && y <= 1065) out.push({ scan: true, win: [0, 3.6], label: `Move hook title to y ${Math.round(y)} (below the chin)`, apply: (q) => ({ ...q, titleY: Math.round(y) }) });
    if (p.subtitle && !p.titleEdited) out.push({ scan: true, win: [0, 3.6], label: 'Drop the subtitle line', apply: (q) => ({ ...q, subtitle: '' }) });
  }
  for (const e of L.fx) {
    const src = (p.effects ?? [])[e.k];
    if (!src || !geomHit(new RegExp(`effect ${e.fx}\\b`)).length) continue;
    const g = geomHit(new RegExp(`effect ${e.fx}\\b`))[0];
    if (byId[e.fx]?.params?.y != null || e.fx === 'glass-type') for (const y of [300, 820, 960]) out.push({ scan: true, win: [e.t0 - 0.1, e.t0 + e.dur + 0.1], label: `Move ${e.fx} card to y ${y} (${g.rule.toLowerCase()})`, apply: (q) => ({ ...q, effects: q.effects.map((x) => (x === src ? { ...x, y } : x)) }) });
    out.push({ label: `Drop ${e.fx} (${g.rule.toLowerCase()})`, apply: (q) => ({ ...q, effects: q.effects.filter((x) => x !== src) }) });
  }
  if (geomHit(/caption/).some((g) => g.rule !== 'Text collides')) for (const id of CAPTION_STYLES.filter((x) => x !== (p.captionStyle || 'tg-active-now'))) out.push({ scan: true, label: `Caption style ${id}`, apply: (q) => ({ ...q, captionStyle: id }) });
  for (const g of geom.filter((x) => x.rule === 'Face off-center')) {
    const pc = L.pieces.find((x) => g.t >= x.o && g.t < x.o + x.e - x.s);
    if (pc?.snap) { const i = (p.snap ?? []).find((i) => Math.abs(L.words[i].start - pc.s) < 0.1); if (i != null) out.push({ scan: true, win: [pc.o - 0.1, pc.o + pc.e - pc.s + 0.1], label: `No punch zoom at ${g.t.toFixed(1)} s (face sits far off-center)`, apply: (q) => ({ ...q, snap: q.snap.filter((x) => x !== i) }) }); }
    else { const sl = (p.slow ?? []).find(([a, b]) => L.words[a].start <= pc?.e && L.words[b].end >= pc?.s); if (sl) out.push({ scan: true, win: [g.t - 3, g.t + 3], label: `No slow push at ${g.t.toFixed(1)} s (face sits far off-center)`, apply: (q) => ({ ...q, slow: q.slow.filter((x) => x !== sl) }) }); }
  }
  for (const e of (L.edges ?? []).filter((x) => x.level > CLIP)) {
    const w = L.words, kept = new Set(L.captions.filter((c) => c.kind === 'cap').map((c) => c.i));
    if (e.kind === 'out') {
      const b = w.findIndex((x, i) => kept.has(i) && x.end <= e.src + 0.06 && !(w[i + 1] && w[i + 1].end <= e.src + 0.06 && kept.has(i + 1)) && x.end > e.src - 0.5);
      if (b < 0) continue;
      const more = []; for (let j = b + 1; j < Math.min(w.length, b + 4) && !kept.has(j); j++) { more.push(j); if (!w[j + 1] || w[j + 1].start - w[j].end > 0.08) break; }
      if (more.length) out.push({ label: `Keep "${more.map((j) => w[j].text).join(' ')}" so the cut at ${e.t.toFixed(1)} s lands in a pause`, apply: (q) => restore(q, more) });
      out.push({ label: `Cut "${w[b].text}" too so the cut at ${e.t.toFixed(1)} s lands in a pause`, apply: (q) => ({ ...q, drop: [...(q.drop ?? []), [b, b]] }) });
    } else {
      const a = w.findIndex((x, i) => kept.has(i) && x.start >= e.src - 0.06);
      if (a < 0) continue;
      const more = []; for (let j = a - 1; j >= Math.max(0, a - 3) && !kept.has(j); j--) { more.unshift(j); if (!w[j - 1] || w[j].start - w[j - 1].end > 0.08) break; }
      if (more.length) out.push({ label: `Keep "${more.map((j) => w[j].text).join(' ')}" so the cut at ${e.t.toFixed(1)} s lands in a pause`, apply: (q) => restore(q, more) });
      out.push({ label: `Cut "${w[a].text}" too so the cut at ${e.t.toFixed(1)} s lands in a pause`, apply: (q) => ({ ...q, drop: [...(q.drop ?? []), [a, a]] }) });
    }
  }
  return out;
}

// A windowed scan replaces only the findings inside its window; the full re-scan after tuning settles everything.
function merge(old, got, win) {
  if (!win) return got;
  const [a, b] = win, os = old.stats ?? {}, ns = got.stats ?? {}, lo = (k) => Math.min(os[k] ?? Infinity, ns[k] ?? Infinity), hi = (k) => Math.max(os[k] ?? 0, ns[k] ?? 0);
  return { ...old, issues: [...(old.issues ?? []).filter((i) => i.t == null || i.t < a || i.t > b), ...(got.issues ?? [])],
    stats: { ...os, faceGap: lo('faceGap'), capGap: lo('capGap'), blur: hi('blur'), capW: hi('capW'), zoomOff: hi('zoomOff') } };
}

function restore(q, idx) {
  const p = JSON.parse(JSON.stringify(q));
  p.drop = (p.drop ?? []).flatMap(([a, b]) => { const r = []; let s = null; for (let i = a; i <= b + 1; i++) { if (i <= b && !idx.includes(i)) { if (s == null) s = i; } else if (s != null) { r.push([s, i - 1]); s = null; } } return r; });
  if (p.keep) for (const i of [...idx].sort((a, b) => b - a)) { const r = p.keep.find(([a]) => a === i + 1); if (r) r[0] = i; }
  if (p.keep) for (const i of [...idx].sort((a, b) => a - b)) { const r = p.keep.find(([, b]) => b === i - 1); if (r) r[1] = i; }
  return p;
}

// Runs the loop on runs/<r>/plan.json. Every try is scanned in the page (ctx.scan) and graded; kept only if the grade goes up.
// Every try lands in grades.jsonl, kept or not, with its delta; the start plan is kept as plan.orig.json.
export async function tune(dir, judge, face, ctx) {
  const planFile = join(dir, 'plan.json'), hist = join(dir, 'grades.jsonl'), geomFile = join(dir, 'geom.json');
  if (!existsSync(join(dir, 'plan.orig.json'))) copyFileSync(planFile, join(dir, 'plan.orig.json'));
  let geomDoc = existsSync(geomFile) ? JSON.parse(readFileSync(geomFile, 'utf8')) : { issues: [] };
  let p = JSON.parse(readFileSync(planFile, 'utf8'));
  const log = existsSync(hist) ? readFileSync(hist, 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l)) : [];
  const write = (row) => { log.push(row); appendFileSync(hist, JSON.stringify(row) + '\n'); };
  const score = (L, g) => grade(L, judge, g.issues ?? [], ctx.take ? ctx.take(L) : []);
  let cur = score(layout(dir, p), geomDoc);
  if (!log.length || log.at(-1).grade !== cur.total) write({ i: log.length, at: new Date().toISOString(), kind: log.length ? 'rescan' : 'start', label: log.length ? 'Re-scan of the current plan' : 'Start', grade: cur.total, from: log.at(-1)?.grade ?? null, delta: log.length ? +(cur.total - log.at(-1).grade).toFixed(1) : 0, kept: true, parts: cur.parts });
  const tried = new Set(log.filter((r) => r.kind === 'try').map((r) => `${r.label}@${r.from}`));
  let tries = 0;
  const cap = ctx.maxTries ?? 25;
  for (let round = 0; round < 25 && tries < cap; round++) {
    const L = layout(dir, p), list = candidates(p, L, face, geomDoc.issues ?? [], ctx).filter((x) => !tried.has(`${x.label}@${cur.total}`));
    if (!list.length) break;
    let best = null;
    for (const c of list) {
      if (tries >= cap) break;
      tried.add(`${c.label}@${cur.total}`); tries++;
      const q = c.apply(p), Lq = layout(dir, q);
      const g2 = c.scan && ctx.scan ? merge(geomDoc, await ctx.scan(q, c.win), c.win) : { ...geomDoc, issues: geomAfter(geomDoc.issues ?? [], q, p) }, next = score(Lq, g2);
      const before = new Set(cur.issues.map((x) => x.rule + x.msg)), after = new Set(next.issues.map((x) => x.rule + x.msg));
      const row = { i: log.length, at: new Date().toISOString(), kind: 'try', label: c.label, grade: next.total, from: cur.total, delta: +(next.total - cur.total).toFixed(1), kept: false, scanned: !!c.scan, parts: next.parts,
        fixed: cur.issues.filter((x) => !after.has(x.rule + x.msg)).map((x) => x.rule), added: next.issues.filter((x) => !before.has(x.rule + x.msg)).map((x) => x.rule) };
      write(row);
      if (next.total > cur.total && (!best || next.total > best.next.total)) best = { q, g2, next, row };
    }
    if (!best) break;
    best.row.kept = true;
    write({ ...best.row, i: log.length, kind: 'keep', label: `Kept: ${best.row.label}` });
    p = best.q; geomDoc = best.g2; cur = best.next;
  }
  writeFileSync(planFile, JSON.stringify(p, null, 1));
  writeFileSync(geomFile, JSON.stringify(geomDoc, null, 1));
  return { grade: cur, log, tries };
}
