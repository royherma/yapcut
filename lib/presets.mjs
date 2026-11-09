// Preset grid: one take -> every edit intensity x length, built from the take's ideas (cuts + effect pool) with no LLM call.
// runs/<video>/ideas.json = {cuts: {full|60|30: {keep, drop, title, subtitle}}, effects: [{fx, at, to, why, ...}], highlight, snap}.
import { existsSync, mkdirSync, readFileSync, writeFileSync, symlinkSync, copyFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { byId } from '../effects/catalog.mjs';
import { wordRanges } from './formats.mjs';

export const INTENSITY = {
  clean: { name: 'Clean', brief: 'Only the cut: fumbles, repeats and long pauses out. Captions and the hook title, nothing else.', fx: 0, snapEvery: 0, slow: 0, hi: false, caption: 'tg-active-reveal' },
  light: { name: 'Light', brief: 'The cut plus one keyword highlight per sentence and a punch zoom every ~9 s. No effects.', fx: 0, snapEvery: 9, slow: 1, hi: true, caption: 'tg-active-now' },
  medium: { name: 'Medium', brief: 'Highlights, a zoom every ~6 s and 2-3 effects on the lines that show something.', fx: 3, fxGap: 6, snapEvery: 6, slow: 2, hi: true, caption: 'tg-mark-marker' },
  showcase: { name: 'Showcase', brief: 'Every pinned effect lands on its own word, back to back, like a demo reel.', fx: 99, fxGap: -99, snapEvery: 0, slow: 0, hi: true, caption: 'tg-pill-sentence', titleStyle: 'kinetic', theme: 'light', maxGap: 2, pinned: true },
  story: { name: 'Story', brief: 'Every pinned picture, screen and effect on its own word, the same effect as often as the script needs it, no effect list panel.', fx: 99, fxGap: -99, snapEvery: 0, slow: 3, slowFree: true, hi: true, caption: 'tg-pill-sentence', titleStyle: 'kinetic', theme: 'light', maxGap: 2, pinned: true, repeat: true, noIndex: true, pops: true },
  heavy: { name: 'Heavy', brief: 'Every beat edited: zooms every ~3.5 s, an effect wherever one fits, a sound on the big moments.', fx: 8, fxGap: 3, snapEvery: 3.5, slow: 3, hi: true, caption: 'tg-active-pop', pops: true },
};
export const LENGTHS = { full: 'Full', 60: '60 s', 30: '30 s' };
const range = ([a, b]) => Array.from({ length: b - a + 1 }, (_, k) => a + k);

// Kept word indices in play order with an estimated output time each.
function playOrder(words, cut) {
  const dropped = new Set((cut.drop ?? []).flatMap(range));
  const idx = cut.keep.flatMap(range).filter((i) => !dropped.has(i) && words[i]);
  let t = 0;
  return idx.map((i, k) => { const prev = idx[k - 1]; if (k) t += prev === i - 1 ? Math.min(0.3, words[i].start - words[prev].end) + (words[prev].end - words[prev].start) : 0.15 + (words[prev].end - words[prev].start); return { i, t }; });
}

export function presetPlan(ideas, words, intensity, length, opts = {}) {
  const P = INTENSITY[intensity], cut = ideas.cuts[length], order = playOrder(words, cut), at = new Map(order.map((x) => [x.i, x.t]));
  const sentences = [];
  order.forEach((x) => { if (!sentences.length || /[.!?]$/.test(words[sentences.at(-1).at(-1).i].text)) sentences.push([]); sentences.at(-1).push(x); });
  const pick = new Set(ideas.highlight ?? []);
  const highlight = P.hi ? sentences.map((s) => s.find((x) => pick.has(x.i))).filter(Boolean).map((x) => x.i) : [];
  const effects = [];
  let lastEnd = 2.5;
  for (const e of ((P.pinned ? opts.pinned : ideas.effects) ?? []).filter((e) => byId[e.fx] && at.has(e.at) && (e.to == null || at.has(e.to))).sort((a, b) => at.get(a.at) - at.get(b.at))) {
    if (effects.length >= P.fx || (!P.repeat && effects.some((x) => x.fx === e.fx))) continue;
    const t0 = at.get(e.at), dur = e.to != null ? Math.max(byId[e.fx].dur, at.get(e.to) - t0) : byId[e.fx].dur;
    if (!P.pinned && (t0 - lastEnd < (P.fxGap ?? 99) || t0 < 2.5)) continue;
    effects.push(e); lastEnd = t0 + dur;
  }
  if (P.pinned && !P.noIndex && effects.length) {
    const rows = effects.filter((e) => e.fx !== 'comment-cta').map((e) => ({ text: e.panelLabel ?? byId[e.fx].name, at: e.at }));
    effects.unshift({ fx: 'index-panel', at: order[0].i, to: order.at(-1).i, items: rows, total: '40+ total effects', why: 'list of every effect in the video' });
  }
  const snap = [];
  const busy = (i) => effects.some((e) => { const t0 = at.get(e.at), t1 = e.to != null ? at.get(e.to) : t0 + (e.dur ?? byId[e.fx].dur); return at.get(i) >= t0 - 0.5 && at.get(i) <= Math.max(t1, t0 + (e.dur ?? byId[e.fx].dur)) + 0.3; });
  if (P.snapEvery) for (const i of [...new Set([...(ideas.snap ?? []), ...highlight])].filter((i) => at.has(i) && !busy(i)).sort((a, b) => at.get(a) - at.get(b))) if (!snap.length || at.get(i) - at.get(snap.at(-1)) >= P.snapEvery) snap.push(i);
  const slow = sentences.filter((s) => s.length > 5 && !s.some((x) => snap.includes(x.i)) && !(P.slowFree && s.slice(1, -1).some((x) => busy(x.i)))).sort((a, b) => (b.at(-1).t - b[0].t) - (a.at(-1).t - a[0].t)).slice(0, P.slow).map((s) => [s[0].i, s.at(-1).i]);
  const sfx = [{ at: 0, sound: 'whoosh' }];
  if (P.pops) { let last = -9; for (const i of snap) if (at.get(i) - last >= 4 && !effects.some((e) => Math.abs(at.get(e.at) - at.get(i)) < 4)) { sfx.push({ at: i, sound: 'pop' }); last = at.get(i); } }
  return { style: P.brief, preset: { intensity, length }, format: ideas.format ?? null, formatWhy: ideas.formatWhy ?? '', beats: ideas.beats ?? {}, repairs: cut.repairs ?? [], title: cut.title, subtitle: cut.subtitle ?? '', titleY: opts.titleY ?? 1000, keep: cut.keep, drop: cut.drop ?? [],
    highlight, snap, slow, sfx: intensity === 'clean' ? [] : sfx, effects, overlays: [], captionStyle: P.caption, ...(P.titleStyle ? { titleStyle: P.titleStyle } : {}), ...(P.theme ? { theme: P.theme } : {}), ...(P.maxGap ? { maxGap: P.maxGap } : {}), ...(P.board ? { board: true, cam: P.cam, title: '', subtitle: '' } : {}), quietTitle: false };
}

// runs/<video>/pinned.json = [{fx, word, ...params}] in spoken order -> effects on those words, each lasting until the next one starts.
export function pinEffects(pins, words) {
  const norm = (t) => t.toLowerCase().replace(/[^a-z0-9]/g, '');
  let from = 0;
  const out = pins.map(({ word, alt = [], ...e }) => {
    const i = words.findIndex((w, k) => k >= from && [word, ...alt].some((x) => norm(w.text) === norm(x)));
    if (i < 0) throw new Error(`pinned word "${word}" not found after word ${from}`);
    from = i + 1;
    return { ...e, at: i, why: e.why ?? `said "${word}"` };
  });
  return out.map((e, k) => ({ ...e, dur: e.dur ?? +Math.min(byId[e.fx].dur, (out[k + 1] ? words[out[k + 1].at].start : Infinity) - words[e.at].start - 0.05).toFixed(2) }));
}

// Writes runs/<video>-p-<intensity>-<length>/ for every cell and registers them in compare.json. Milliseconds per cell.
export function makePresets(runsDir, video, base, opts = {}) {
  const ideas = JSON.parse(readFileSync(join(runsDir, video, 'ideas.json'), 'utf8')), words = JSON.parse(readFileSync(join(runsDir, base, 'words.json'), 'utf8'));
  for (const cut of Object.values(ideas.cuts)) for (const k of ['keep', 'drop']) cut[k] = wordRanges(cut[k] ?? [], words);
  const file = join(runsDir, video, 'compare.json'), c = JSON.parse(readFileSync(file, 'utf8'));
  c.preset ??= {}; c.judge ??= {};
  const pinFile = join(runsDir, video, 'pinned.json'), pinned = existsSync(pinFile) ? pinEffects(JSON.parse(readFileSync(pinFile, 'utf8')), words) : null;
  const made = [];
  for (const length of Object.keys(LENGTHS).filter((l) => ideas.cuts[l])) for (const intensity of Object.keys(INTENSITY)) {
    if (INTENSITY[intensity].board && (!c.ali || !existsSync(join(runsDir, video, 'board.json')))) continue;
    if ((INTENSITY[intensity].pinned && !pinned) || ((INTENSITY[intensity].pinned || INTENSITY[intensity].fullOnly) && length !== 'full')) continue;
    const run = `${video}-p-${intensity}-${length}`, dir = join(runsDir, run);
    if (existsSync(join(dir, 'plan.orig.json')) && !opts.force) { made.push(run); continue; }
    const plan = presetPlan(ideas, words, intensity, length, { ...opts, pinned });
    mkdirSync(dir, { recursive: true });
    const raw = readdirSync(join(runsDir, video)).find((f) => f.startsWith('raw.'));
    if (!readdirSync(dir).some((f) => f.startsWith('raw.'))) symlinkSync(join(runsDir, video, raw), join(dir, raw));
    copyFileSync(join(runsDir, base, 'words.json'), join(dir, 'words.json'));
    writeFileSync(join(dir, 'plan.json'), JSON.stringify(plan, null, 1));
    writeFileSync(join(dir, 'plan.orig.json'), JSON.stringify(plan, null, 1));
    if (!c.runs.includes(run)) c.runs.push(run);
    c.label[run] = `${INTENSITY[intensity].name} ${LENGTHS[length]}`;
    c.preset[run] = { id: `${intensity}-${length}`, name: c.label[run], intensity, length, brief: INTENSITY[intensity].brief };
    if (ideas.cuts[length].judge) c.judge[run] = ideas.cuts[length].judge;
    made.push(run);
  }
  writeFileSync(file, JSON.stringify(c, null, 1));
  return made;
}

// Ideas for a take already cut by hand or by personas: its cuts per length + the union of every plan's effects and highlights.
export function ideasFromPlans(runsDir, video, cutRuns, judge, otherRuns = []) {
  const plans = [...Object.values(cutRuns), ...otherRuns].map((r) => JSON.parse(readFileSync(join(runsDir, r, existsSync(join(runsDir, r, 'plan.orig.json')) ? 'plan.orig.json' : 'plan.json'), 'utf8')));
  const cuts = Object.fromEntries(Object.entries(cutRuns).map(([len, r]) => { const p = JSON.parse(readFileSync(join(runsDir, r, 'plan.orig.json'), 'utf8')); return [len, { keep: p.keep, drop: p.drop ?? [], title: p.title, subtitle: p.subtitle ?? '', judge: judge[r], from: r }]; }));
  const seen = new Set(), effects = [];
  for (const p of plans) for (const e of p.effects ?? []) { const k = `${e.fx}@${e.at}`; if (!seen.has(k)) { seen.add(k); effects.push(e); } }
  const ideas = { cuts, effects, highlight: [...new Set(plans.flatMap((p) => p.highlight ?? []))].sort((a, b) => a - b), snap: [...new Set(plans.flatMap((p) => p.snap ?? []))].sort((a, b) => a - b) };
  writeFileSync(join(runsDir, video, 'ideas.json'), JSON.stringify(ideas, null, 1));
  return ideas;
}

const LAYOUT_FX = new Set(['split-top', 'split-screen', 'title-stack']);
/** Times a layout effect owns the frame, for caption styles that add a box there. */
export const layoutSpans = (L) => L.fx.filter((e) => LAYOUT_FX.has(e.fx)).map((e) => ({ t0: +e.t0.toFixed(3), t1: +(e.t0 + e.dur).toFixed(3) }));
