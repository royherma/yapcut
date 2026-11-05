// RECIPE.md as checks. timing(L) runs on the numbers; the face / safe-zone checks run in the preview page on the real
// on-screen boxes and come back as `geom` findings.
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { W, H } from './edit.mjs';
import { subject } from './fx.mjs';
import { shape } from './formats.mjs';

export const FIX = {
  'Captions overlap': 'Shorten the first word so it ends before the next starts',
  'Caption flashes': 'Merges with the next word automatically; or keep the pause',
  'Caption lingers': 'Captions picker: turn on End with the word',
  'Highlight on a filler word': 'Move the highlight to the payoff word of the line',
  'Too many highlights': 'Keep one highlight per sentence, drop the weaker one',
  'Effect in the first 2 s': 'Start it after the hook title is gone (2 s+)',
  'Effects too close': 'Space effects 1.5 s+ apart or drop one',
  'Sounds too dense': 'One sound per 4 s at most - drop the weaker one',
  'Edit every second': 'Keep the word between the cuts, or cut the whole bit',
  'Slow start': 'Start the reel on the first spoken word',
  'Ends mid-thought': 'End on a full sentence',
  'Missing beat': 'Put the beat back - its words are listed under Structure',
  'Ends before the close': 'End on the closing beat of the format (a takeaway, the total, or a question)',
  'Repeated thought': 'Cut the earlier try',
  'Too long for a Reel': 'Cut to the strongest 20-60 s',
  'Text on the face': 'Move it below the chin or to the side, or drop it',
  'Under Instagram UI': 'Keep text inside the safe area (220-1480 px tall, left of 940 px)',
  'Caption too wide': 'Shorter word or smaller highlight size',
  'Voice too quiet': 'Normalize the voice to about -14 LUFS in the final render',
  'Bright caption area': 'Add a shadow plate behind captions or move them',
  'Head under top UI': 'Reframe lower or zoom out a bit',
  'Cut clips speech': 'Move the cut into the next pause: keep the word whole or drop back to the last breath',
  'Text collides': 'Move the effect card clear of the caption and title, or drop it',
  'Blurred text': 'Text must be sharp once it is on screen - no blur held past the entrance',
  'Hand over face': 'Cut around the moment or keep text away from it',
  'Looks wrong': 'What the frame judge saw - see its note',
  'Face off-center': 'Zoom toward the face, not the middle of the frame',
};
export const CLIP = 0.25; // voice level at a cut edge above this is heard as a clipped word
export const isSwitchSound = (x) => /^(mediacut|shutter|itemin|itemout)$/.test(x.sound) || /click|^run:/.test(x.ref ?? '');
export const SAFE = { top: 220, bottom: 1480, right: 940 }; // Instagram UI covers outside these (px on 1080x1920)
const STOP = new Set('a an the is are was it its it\'s of to in on and or but so that this you i we be as at for with'.split(' '));
const bare = (s) => s.toLowerCase().replace(/[^a-z0-9']/g, '');

// Union of the head box over 4 frames of the take, in 1080x1920 px.
export function faceZone(proxy, cache, dur) {
  const file = join(cache, 'face-zone.json');
  if (existsSync(file)) return JSON.parse(readFileSync(file, 'utf8'));
  if (existsSync(join(cache, 'faces.json'))) {
    const F = JSON.parse(readFileSync(join(cache, 'faces.json'), 'utf8')).filter((f) => f.face), q = (xs, p) => xs.sort((a, b) => a - b)[Math.floor((xs.length - 1) * p)];
    const z = { x0: Math.round(q(F.map((f) => f.face[0] - f.face[2] * 0.12), 0.05) * W), y0: Math.round(q(F.map((f) => f.face[1] - f.face[3] * 0.38), 0.05) * H),
      x1: Math.round(q(F.map((f) => f.face[0] + f.face[2] * 1.12), 0.95) * W), y1: Math.round(q(F.map((f) => f.face[1] + f.face[3] * 1.2), 0.95) * H) };
    writeFileSync(file, JSON.stringify(z));
    return z;
  }
  const boxes = [0.2, 0.4, 0.6, 0.8].map((f, i) => {
    const c = join(cache, `face${i}`);
    mkdirSync(c, { recursive: true });
    const s = subject(proxy, c, (dur * f) / 0.45);
    const hw = s.headW * W, hx = s.head[0] * W, hy = s.head[1] * H;
    return [hx - hw * 0.4, hy - hw * 0.3, hx + hw * 0.4, hy + hw * 0.55];
  });
  const z = { x0: Math.min(...boxes.map((b) => b[0])), y0: Math.min(...boxes.map((b) => b[1])), x1: Math.max(...boxes.map((b) => b[2])), y1: Math.max(...boxes.map((b) => b[3])) };
  for (const k in z) z[k] = Math.round(z[k]);
  writeFileSync(file, JSON.stringify(z));
  return z;
}

// [{rule, sev: bad|warn|info, t, msg}] - t in output seconds so the page can jump there.
export function timing(L) {
  const out = [], add = (rule, sev, t, msg) => out.push({ rule, sev, t: t == null ? null : +t.toFixed(2), msg });
  const caps = L.captions.filter((c) => c.kind === 'cap');
  caps.forEach((c, k) => {
    const n = caps[k + 1];
    if (n && n.t0 < c.t1 - 0.01) add('Captions overlap', 'bad', c.t0, `"${c.text}" and "${n.text}" on screen together`);
    if (c.voice != null && c.t1 - c.voice > 0.6) add('Caption lingers', 'warn', c.voice, `"${c.text}" stays ${(c.t1 - c.voice).toFixed(1)} s after the word is said`);
    if (c.t1 - c.t0 < 0.2) add('Caption flashes', 'warn', c.t0, `"${c.text}" shows ${Math.round((c.t1 - c.t0) * 1000)} ms - too fast to read`);
    if (c.hi && STOP.has(bare(c.text))) add('Highlight on a filler word', 'warn', c.t0, `"${c.text}" is highlighted`);
  });
  const his = caps.filter((c) => c.hi);
  his.forEach((c, k) => { if (k && c.t0 - his[k - 1].t0 < 2.5) add('Too many highlights', 'warn', c.t0, `"${his[k - 1].text}" then "${c.text}" ${(c.t0 - his[k - 1].t0).toFixed(1)} s apart`); });
  const fx = L.fx.filter((e) => e.fx !== 'index-panel').sort((a, b) => a.t0 - b.t0);
  fx.forEach((e, k) => {
    if (e.t0 < 2 && L.p?.title) add('Effect in the first 2 s', 'warn', e.t0, `${e.fx} fights the hook title`);
    const p = fx[k - 1];
    if (p && e.t0 - (p.t0 + p.dur) < 1.5 && p.cat?.group !== 'layout' && e.cat?.group !== 'layout') add('Effects too close', 'warn', e.t0, `${p.fx} then ${e.fx} ${(e.t0 - p.t0 - p.dur).toFixed(1)} s apart`);
  });
  const askAt = L.words.map((w, i) => ({ w, i, o: L.outAt(w.start + 0.01) })).filter((x) => x.o != null && /\?$/.test(x.w.text));
  for (const q of askAt) if (!fx.some((e) => e.cat?.group !== 'layout' && e.fx !== 'digital-zoom' && e.t0 <= q.o + 0.4 && e.t0 + e.dur >= q.o - 1.2)) add('Question with nothing on screen', 'warn', q.o, `"${q.w.text}" asks the viewer something - pop a question card or a big word here`);
  const lay = fx.filter((e) => e.cat?.group === 'layout');
  if (lay[0] && lay[0].t0 > 0.05 && lay[0].t0 < 1.5) add('Gap at the start', 'warn', 0, `${lay[0].fx} starts at ${lay[0].t0.toFixed(2)} s, not 0:00`);
  let cov = null; fx.forEach((e) => { const g = cov && e.t0 - (cov.t0 + cov.dur); if (g > 0.05 && g < 0.6) add('Silly gap', 'warn', cov.t0 + cov.dur, `${(g * 1000).toFixed(0)} ms of plain video between ${cov.fx} and ${e.fx}`); if (!cov || e.t0 + e.dur > cov.t0 + cov.dur) cov = e; });
  const sfx = L.sfx.filter((x) => !(x.db < 0) && !isSwitchSound(x)).sort((a, b) => a.at - b.at);
  sfx.forEach((x, k) => { if (k && x.at - sfx[k - 1].at < 4) add('Sounds too dense', 'warn', x.at, `${sfx[k - 1].sound} then ${x.sound} ${(x.at - sfx[k - 1].at).toFixed(1)} s apart`); });
  L.pieces.forEach((pc, k) => { if (k && !pc.gap && !L.pieces[k - 1].gap && !pc.snap && !pc.hold && !L.pieces[k - 1].snap && !L.pieces[k - 1].hold && pc.e - pc.s < 0.7) add('Edit every second', 'warn', pc.o, `${((pc.e - pc.s) * 1000).toFixed(0)} ms piece between two cuts`); });
  const firstSaid = Math.min(...L.words.map((w) => L.outAt(w.start + 0.01)).filter((x) => x != null));
  if (firstSaid > 0.4) add('Slow start', 'warn', 0, `first word at ${firstSaid.toFixed(2)} s`);
  const last = caps.at(-1);
  if (last && !/[.!?]$/.test(last.text)) add('Ends mid-thought', 'warn', last.t0, `last word "${last.text}"`);
  const words = caps.map((c) => bare(c.text)), seen = new Map();
  for (let i = 0; i + 3 < words.length; i++) {
    const g = words.slice(i, i + 4).join(' ');
    if (seen.has(g) && i - seen.get(g) > 4) add('Repeated thought', 'warn', caps[i].t0, `"${g}" said twice`);
    else seen.set(g, i);
  }
  for (const e of L.edges ?? []) if (e.level > CLIP) add('Cut clips speech', 'bad', e.t, `${e.kind === 'out' ? 'cuts off the end of' : 'starts in the middle of'} "${e.word}" (voice ${Math.round(e.level * 100)}% loud at the cut)`);
  out.push(...shape(L).issues);
  if (L.total > 60) add('Too long for a Reel', 'warn', null, `${L.total.toFixed(0)} s (aim 20-60 s)`);
  return out;
}

// Every rule with pass/fail and the number it measured, for the checks list. scan = geom.json stats from the page.
const CAPTION_ONLY = ['Captions overlap', 'Caption lingers', 'Caption flashes', 'Highlight on a filler word', 'Too many highlights', 'Caption too wide', 'Bright caption area'];
export const onScreen = (L, issues) => (L.p?.captionStyle === 'none' ? issues.filter((i) => !CAPTION_ONLY.includes(i.rule)) : issues);
const sev = (r) => (['Missing beat', 'Ends before the close', 'Captions overlap', 'Text on the face', 'Cut clips speech', 'Text collides', 'Blurred text'].includes(r) ? 'bad' : 'warn');
export function checks(L, issues, scan = {}, take = null) {
  const caps = L.captions.filter((c) => c.kind === 'cap'), his = caps.filter((c) => c.hi), fx = L.fx.filter((e) => e.fx !== 'index-panel').sort((a, b) => a.t0 - b.t0);
  const gaps = (xs) => xs.slice(1).map((x, k) => x - xs[k]), min = (xs) => (xs.length ? Math.min(...xs) : null), f1 = (x) => (x == null ? '-' : x.toFixed(1));
  const fxGap = min(fx.slice(1).map((e, k) => e.t0 - fx[k].t0 - fx[k].dur)), sfxGap = min(gaps(L.sfx.filter((x) => !(x.db < 0) && !isSwitchSound(x)).map((x) => x.at).sort((a, b) => a - b)));
  const jumps = L.pieces.filter((pc, k) => k && !pc.snap && !L.pieces[k - 1].snap).map((pc) => pc.e - pc.s), edges = L.edges ?? [];
  const loudest = edges.reduce((m, e) => Math.max(m, e.level), 0), sc = scan.stats ?? {};
  const stat = {
    'Captions overlap': `${caps.length} captions checked`,
    'Caption lingers': `longest caption after its word ${f1(Math.max(0, ...caps.filter((c) => c.voice != null).map((c) => c.t1 - c.voice)))} s (max 0.6)`,
    'Caption flashes': `shortest caption ${Math.round(1000 * (min(caps.map((c) => c.t1 - c.t0)) ?? 0))} ms (min 200)`,
    'Highlight on a filler word': `${his.length} highlights`,
    'Too many highlights': `closest highlights ${f1(min(gaps(his.map((c) => c.t0))))} s apart (min 2.5)`,
    'Effect in the first 2 s': fx.length ? `first effect at ${f1(fx[0].t0)} s` : 'no effects',
    'Effects too close': fxGap == null ? `${fx.length} effect${fx.length === 1 ? '' : 's'}` : `closest effects ${f1(fxGap)} s apart (min 1.5)`,
    'Sounds too dense': sfxGap == null ? `${L.sfx.length} sounds` : `closest sounds ${f1(sfxGap)} s apart (min 4)`,
    'Edit every second': jumps.length ? `shortest piece ${Math.round(1000 * min(jumps))} ms (min 700)` : 'no cuts',
    'Slow start': `first word at ${Math.min(...L.words.map((w) => L.outAt(w.start + 0.01)).filter((x) => x != null)).toFixed(2)} s (max 0.4)`,
    'Ends mid-thought': caps.at(-1) ? `ends on "${caps.at(-1).text}"` : '-',
    'Repeated thought': `${caps.length} words scanned for repeats`,
    'Missing beat': shape(L).why,
    'Ends before the close': shape(L).why,
    'Too long for a Reel': `${L.total.toFixed(0)} s (aim 20-60)`,
    'Cut clips speech': `${edges.length} cut edges, loudest ${Math.round(loudest * 100)}% (max ${Math.round(CLIP * 100)}%)`,
    'Text on the face': sc.frames ? `${sc.boxes} boxes in ${sc.frames} frames vs the tracked face, closest ${sc.faceGap ?? '-'} px` : 'not scanned yet',
    'Under Instagram UI': sc.frames ? `${sc.boxes} boxes vs the Reels buttons and top bar` : 'not scanned yet',
    'Text collides': sc.frames ? `closest effect-to-caption gap ${sc.capGap ?? '-'} px` : 'not scanned yet',
    'Blurred text': sc.frames ? `most blur held on text ${sc.blur ?? 0} px` : 'not scanned yet',
    'Caption too wide': sc.frames ? `widest caption ${sc.capW ?? '-'} px (max 960)` : 'not scanned yet',
    'Hand over face': scan.faces ? `hand on the face in ${scan.faces.filter((f) => f[5]).length} of ${scan.faces.length} kept frames (Apple Vision, every 0.25 s)` : 'not scanned yet',
    'Face off-center': sc.frames ? `face at most ${sc.zoomOff ?? 0} px from the middle while zoomed (max 150)` : 'not scanned yet',
    'Looks wrong': scan.visual ? `${scan.visual.frames} frames looked at by the frame judge` : 'frame judge not run',
    ...(take ? { 'Voice too quiet': `${take.lufs} LUFS (min -20)`, 'Bright caption area': `${take.captionLuma}/255 behind captions (max 150)`, 'Head under top UI': `face starts at y ${take.face.y0} (min ${SAFE.top})` } : {}),
  };
  if (L.p?.captionStyle === 'none') for (const r of CAPTION_ONLY) stat[r] = 'not run - captions off';
  return Object.keys(stat).map((rule) => {
    const hit = issues.filter((i) => i.rule === rule), first = hit.find((i) => i.t != null) ?? hit[0];
    return { rule, sev: hit[0]?.sev ?? sev(rule), pass: hit.length ? false : /not (scanned|run)/.test(stat[rule]) ? null : true, n: hit.length, stat: stat[rule], t: first?.t ?? null, box: first?.box ?? null, ids: hit.map((i) => i.id), fix: FIX[rule] ?? '' };
  }).sort((a, b) => (a.pass === false ? 0 : a.pass == null ? 1 : 2) - (b.pass === false ? 0 : b.pass == null ? 1 : 2) || (a.sev === 'bad' ? 0 : 1) - (b.sev === 'bad' ? 0 : 1));
}

// Runs of 0.5 s+ where a hand covers a quarter of the face, from facesOut rows [t, x0, y0, x1, y1, hand].
export function handOnFace(faces) {
  const out = [];
  let run = [];
  const flush = () => { if (run.length >= 2) out.push({ rule: 'Hand over face', sev: 'warn', t: run[0][0], box: { x: run[0][1], y: run[0][2], w: run[0][3] - run[0][1], h: run[0][4] - run[0][2] }, msg: `hand covers the face for ${(run.length * 0.25).toFixed(2)} s` }); run = []; };
  faces.forEach((f, k) => { if (f[5] && (!run.length || f[0] - run.at(-1)[0] < 0.4)) run.push(f); else { flush(); if (f[5]) run.push(f); } });
  flush();
  return out;
}
