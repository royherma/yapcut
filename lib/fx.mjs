// Effects layer: plan.json `effects` -> HyperFrames composition over base.mp4 -> fx.mp4.
import { existsSync, mkdirSync, copyFileSync, writeFileSync, readFileSync, statSync, rmSync, readdirSync, realpathSync } from 'node:fs';
import { execFileSync, spawnSync } from 'node:child_process';
import { join, resolve, dirname, extname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { EFFECTS, byId } from '../effects/catalog.mjs';
import { cutOutFast, mergeMatte } from './matte.mjs';
import { ladderRef } from './sfx-path.mjs';
import { wideOf } from './wide.mjs';
import { CFG } from './config.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const FFMPEG = CFG.ffmpeg;
const HF = 'hyperframes@0.8.156';
const W = 1080, H = 1920, FPS = 30;
const env = { ...process.env, PATH: CFG.nodeBin ? `${CFG.nodeBin}:${process.env.PATH}` : process.env.PATH };

const wordTime = (words, outAt, i, edge = 'start') => (words[i] ? outAt(words[i][edge] + (edge === 'end' ? -0.01 : 0.01)) : null);

// Word indexes in the plan become output-video seconds: effect start/end and any {at} inside params.
// A layout touches the next layout (under 0.4 s apart or overlapping), or a later effect under 0.4 s after it; effects on top of it don't cut it short.
// Steps into C D E G A C' D' E' that climb, peak and land on C' (index 5), so every phrase resolves.
const melody = (n) => n <= 6 ? Array.from({ length: n }, (_, i) => 5 - (n - 1) + i) : [...Array.from({ length: n - 3 }, (_, i) => [0, 1, 2, 3, 4, 3, 2, 3, 4][i % 9]), 6, 7, 5];

export function resolveEffects(list, words, outAt, total) {
  const out = list.map((e, k) => {
    const cat = byId[e.fx];
    if (!cat) { console.log(`  skip effect ${k}: unknown "${e.fx}"`); return null; }
    const w0 = e.t ?? wordTime(words, outAt, e.at), t0 = e.t == null && cat.group === 'layout' && w0 != null && w0 < 0.6 ? 0 : w0;
    if (t0 == null) { console.log(`  skip ${e.fx}: word ${e.at} was cut`); return null; }
    const tEnd = e.to != null ? wordTime(words, outAt, e.to, 'end') : null;
    const dur = Math.max(0.4, Math.min(total - t0 - 0.05, e.dur ?? (tEnd != null && tEnd > t0 ? tEnd - t0 + 0.3 : cat.dur)));
    const params = JSON.parse(JSON.stringify(e, (key, v) => (v && typeof v === 'object' && Number.isInteger(v.at) && key !== ''
      ? { ...v, t: wordTime(words, outAt, v.at) } : v)));
    const sounds = e.sound === false || !cat.sound ? [] : e.drop && !e.sound ? [{ sound: 'itemin', at: t0, db: -4 }, { sound: 'itemout', at: t0 + dur - 0.25, db: -10 }] : [{ sound: e.sound || cat.sound, at: t0 }];
    for (const w of params.stat?.words ?? []) if (w?.t != null) sounds.push({ sound: 'punch', at: w.t, db: -6 });
    if (e.fx === 'photo-grid' && e.ladder !== 'off') {
      const phrases = [[]];
      for (const it of params.items ?? []) { if ((it?.clear || it?.big) && phrases.at(-1).length) phrases.push([]); if (it?.t != null && !it.quiet) phrases.at(-1).push(it); }
      phrases.forEach((ph, k) => melody(ph.length).forEach((step, j) => sounds.push(e.ladder === 'none' ? { sound: 'pop', at: ph[j].t }
        : k === phrases.length - 1 && j === ph.length - 1 && e.finale !== false ? { ref: 'clean/339_clean_glass_resolve_cmaj.wav', at: ph[j].t, db: -2 } : { ref: ladderRef(e.ladder, step), at: ph[j].t, db: -4 })));
    }
    if (e.fx === 'checklist') for (const it of params.items ?? []) if (it?.t != null && it.t > t0 + 0.2 && it.t < t0 + dur - 0.3) sounds.push({ sound: 'tick', at: it.t, db: -6 });
    return { k, fx: e.fx, t0, dur, params, cat, sounds };
  }).filter(Boolean);
  const lay = out.filter((e) => e.cat.group === 'layout').sort((a, b) => a.t0 - b.t0), fills = (x) => x.cat.group === 'layout' || x.fx === 'digital-zoom';
  out.filter(fills).forEach((e) => { const n = out.filter((x) => x !== e && x.t0 > e.t0 && (fills(x) || x.t0 >= e.t0 + e.dur - 0.05)).sort((a, b) => a.t0 - b.t0)[0], gap = n && n.t0 - (e.t0 + e.dur); if (n && gap < 0.4) e.dur = +Math.max(0.4, n.t0 - e.t0).toFixed(3); });
  for (const c of out.filter((e) => e.params?.place === 'above' && e.params?.dur == null)) { const n = lay.find((l) => l.t0 > c.t0); c.dur = +Math.max(c.dur, Math.min(2.6, (n ? n.t0 : total) - c.t0 - 0.05)).toFixed(3); }
  for (const z of out.filter((e) => ['digital-zoom', 'zoom-through', 'vertigo'].includes(e.fx))) { const n = lay.find((l) => l.t0 > z.t0 && l.t0 < z.t0 + z.dur); if (n) z.dur = +Math.max(0.3, n.t0 - z.t0 - 0.05).toFixed(3); }
  return out;
}

function ff(args) { execFileSync(FFMPEG, ['-v', 'error', '-y', ...args]); }

export function stillAt(video, t, out, vf) { if (!existsSync(out)) ff(['-ss', t.toFixed(3), '-i', video, '-frames:v', '1', ...(vf ? ['-vf', vf] : []), '-q:v', '2', out]); return out; }

function birefnetCut(seg, mask, e, out) {
  if (existsSync(out)) return out;
  const mseg = `${out}.mask.mkv`;
  try { ff(['-ss', e.t0.toFixed(3), '-i', mask, '-t', e.dur.toFixed(3), '-c:v', 'ffv1', '-pix_fmt', 'gray', mseg]); return mergeMatte(seg, mseg, out); } finally { rmSync(mseg, { force: true }); }
}

function cutOut(input, out) {
  if (existsSync(out)) return out;
  if (/\.(mp4|mov)$/i.test(input)) { try { return cutOutFast(input, out); } catch (e) { console.log(`  fast cut-out failed, using HyperFrames: ${e.message.slice(0, 200)}`); } }
  const r = spawnSync('npx', ['--yes', HF, 'remove-background', input, '-o', out, '--json'], { env, encoding: 'utf8' });
  if (r.status !== 0 || !existsSync(out)) throw new Error(`remove-background failed: ${(r.stderr || '').slice(-400)}`);
  return out;
}

// Speaker box from the take's Apple Vision faces (median over the whole take). The preview uses this one, so Export must too.
export function visionSubject(dir) {
  const raw = readdirSync(dir).find((f) => f.startsWith('raw.'));
  if (!raw) return null;
  const cache = join(dirname(realpathSync(join(dir, raw))), 'fx-cache'), file = join(cache, 'subject.json'), faces = join(cache, 'faces.json');
  if (existsSync(file)) return JSON.parse(readFileSync(file, 'utf8'));
  const F = existsSync(faces) ? JSON.parse(readFileSync(faces, 'utf8')).filter((f) => f.face) : [];
  if (!F.length) return null;
  const mid = (xs) => xs.sort((a, b) => a - b)[xs.length >> 1], q90 = (xs) => xs.sort((a, b) => a - b)[Math.floor(xs.length * 0.9)];
  const x = mid(F.map((f) => f.face[0])), y = mid(F.map((f) => f.face[1])), w = mid(F.map((f) => f.face[2])), h = mid(F.map((f) => f.face[3]));
  const s = { head: [x + w / 2, y + h * 0.45], headW: w, box: [Math.max(0, x - w * 0.9), Math.max(0, y - h * 0.35), Math.min(1, w * 2.8), 1 - Math.max(0, y - h * 0.35)], chin: +q90(F.map((f) => f.face[1] + f.face[3] * 1.2)).toFixed(4), from: 'apple-vision' };
  writeFileSync(file, JSON.stringify(s));
  return s;
}

// Head point and body box from one cut-out still, so effects aim at the speaker instead of the frame center.
export function subject(base, cache, total) {
  const file = join(cache, 'subject.json');
  if (existsSync(file)) return JSON.parse(readFileSync(file, 'utf8'));
  const jpg = join(cache, 'subject.jpg');
  if (!existsSync(jpg)) ff(['-ss', (total * 0.45).toFixed(3), '-i', base, '-frames:v', '1', '-vf', `scale=${W}:${H}:force_original_aspect_ratio=increase,crop=${W}:${H}`, '-q:v', '2', jpg]);
  const png = cutOut(jpg, join(cache, 'subject.png'));
  const box = (vf) => {
    const r = spawnSync(FFMPEG, ['-i', png, '-vf', vf, '-f', 'null', '-'], { encoding: 'utf8' });
    const m = [...r.stderr.matchAll(/crop=(\d+):(\d+):(\d+):(\d+)/g)].at(-1);
    return m ? m.slice(1, 5).map(Number) : null;
  };
  const [bw, bh, bx, by] = box('alphaextract,cropdetect=limit=0.2:round=2:reset=0:skip=0') ?? [W * 0.6, H * 0.7, W * 0.2, H * 0.2];
  const topH = Math.round(bh * 0.14);
  const top = box(`alphaextract,crop=${W}:${topH}:0:${by},cropdetect=limit=0.2:round=2:reset=0:skip=0`);
  const headW = top ? top[0] : bw * 0.3, headX = top ? top[2] + top[0] / 2 : bx + bw / 2;
  const s = { head: [headX / W, (by + headW * 0.62) / H], headW: headW / W, box: [bx / W, by / H, bw / W, bh / H] };
  writeFileSync(file, JSON.stringify(s));
  return s;
}

export const srcTime = (pieces) => (t) => { const pc = pieces.find((x) => t >= x.o && t < x.o + (x.e - x.s)) ?? pieces.at(-1); return pc.s + (t - pc.o); };

const SHOWCASE = {
  checklist: { title: 'How it works', items: ['Record the take', 'Drop it into Claude', 'Type: edit it'] },
  'freeze-label': {},
  'ui-world': { prompt: 'Edit my reel in my style' },
  'chart-grow': { values: [10, 12, 11, 17, 24, 41, 78], label: '+680%' },
  'pull-back': { title: 'reel.mp4' },
  'green-screen': { text: 'no editor' },
  'paper-cut': { letters: 'EDIT' },
  'cover-story': { title: 'Studio' },
  'glass-type': { text: 'Claude edited this' },
  'scribble-note': { text: "can't edit" },
  'price-stack': { label: 'Video editor', price: 150, count: 6 },
  'gravity-drop': { items: ['16', '17', '18', '19'], month: 'OCT' },
  'storyboard-deck': { labels: ['01 LOFI', '02 HI-FI', '03 SHOWCASE'] },
  'file-drop': { file: 'raw-take.mp4', size: '148 MB' },
  'jiggle-delete': { labels: ['Mail', 'Notes', 'Photos', 'Music', 'Maps', 'Clips'] },
  'eyedropper-grade': { color: '#d98f3a' },
  'film-look': {},
  'index-panel': { total: '40+ total effects', items: ['Kinetic hook', 'Gravity drop', 'Giant captions', 'Prompt bar', 'File drop', 'Jiggle delete', 'Film look', 'Title card'] },
  'comment-cta': { word: 'Edit', reply: 'Sent you the link' },
};

// Every effect back to back over a looped copy of the take, with a "07/23 name" label, then one demo clip per effect.
export function showcase(dir, { raw, only }) {
  const pieces = JSON.parse(readFileSync(join(dir, 'timemap.json'), 'utf8'));
  const base = join(dir, 'base.mp4');
  const baseDur = Number(execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', base]).toString());
  const list = only ? only.map((id) => byId[id]).filter(Boolean) : EFFECTS;
  let cursor = 0;
  const fx = list.map((cat, k) => {
    const t0 = cursor + 0.5, dur = cat.dur;
    cursor = t0 + dur + 0.35;
    return { k, fx: cat.id, t0, dur, cat, params: { fx: cat.id, ...(SHOWCASE[cat.id] ?? {}) }, sounds: [] };
  });
  const total = cursor + 0.3;
  const work = join(dir, 'showcase');
  mkdirSync(work, { recursive: true });
  const looped = join(work, 'base.mp4');
  ff(['-stream_loop', String(Math.ceil(total / baseDur)), '-i', base, '-t', total.toFixed(3), '-c:v', 'libx264', '-crf', '14', '-preset', 'fast', '-c:a', 'aac', looped]);
  const toSrc = (t) => srcTime(pieces)(t % baseDur);
  const video = renderEffects(dir, { base: looped, raw, fx, total, toSrc, name: 'showcase' });
  const labels = fx.map((e, i) => `Dialogue: 0,${ts(e.t0 - 0.4)},${ts(e.t0 + e.dur)},L,,0,0,0,,{\\pos(540,1640)}{\\c&H3CE6FF&}${String(i + 1).padStart(2, '0')}/${fx.length}  {\\c&HFFFFFF&}${e.cat.name.toLowerCase()}`);
  writeFileSync(join(work, 'labels.ass'), `[Script Info]\nScriptType: v4.00+\nPlayResX: ${W}\nPlayResY: ${H}\n\n[V4+ Styles]\nFormat: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding\nStyle: L,Inter,64,&H00FFFFFF,&H00FFFFFF,&H00000000,&H96000000,-1,0,0,0,100,100,0,0,1,0,4,5,40,40,0,1\n\n[Events]\nFormat: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text\n${labels.join('\n')}\n`);
  const out = join(dir, only ? 'showcase-part.mp4' : 'showcase.mp4');
  ff(['-i', video, '-vf', `ass=${join(work, 'labels.ass')}`, '-c:v', 'libx264', '-crf', '19', '-preset', 'medium', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-movflags', '+faststart', out]);
  const demos = join(ROOT, 'effects', 'demos');
  mkdirSync(demos, { recursive: true });
  for (const e of fx) {
    const a = Math.max(0, e.t0 - 0.3), len = e.dur + 0.5;
    ff(['-ss', a.toFixed(3), '-i', out, '-t', len.toFixed(3), '-vf', 'scale=540:960', '-c:v', 'libx264', '-crf', '24', '-preset', 'medium', '-pix_fmt', 'yuv420p', '-an', '-movflags', '+faststart', join(demos, `${e.fx}.mp4`)]);
    ff(['-ss', (e.t0 + e.dur * 0.55).toFixed(3), '-i', out, '-frames:v', '1', '-vf', 'scale=540:960', '-q:v', '3', join(demos, `${e.fx}.jpg`)]);
  }
  console.log(`  ${fx.length} effects, ${total.toFixed(1)}s -> ${out}\n  demo clips -> ${demos}`);
  return out;
}

function ts(s) { const c = Math.max(0, Math.round(s * 100)); return `${Math.floor(c / 360000)}:${String(Math.floor(c / 6000) % 60).padStart(2, '0')}:${String(Math.floor(c / 100) % 60).padStart(2, '0')}.${String(c % 100).padStart(2, '0')}`; }

export function renderEffects(dir, opts) {
  const { proj, work, name } = fxProject(dir, opts);
  const out = join(work, `${name}.mp4`);
  const r = spawnSync('npx', ['--yes', HF, 'render', '--quality', process.env.YAPCUT_DRAFT ? 'draft' : 'looks', '--output', out], { cwd: proj, env, stdio: 'inherit' });
  if (r.status !== 0 || !existsSync(out)) throw new Error(`hyperframes render failed (exit ${r.status})`);
  return out;
}

// The HyperFrames project for an edit: base.mp4 + every effect's assets (cut-outs, stills, freezes) + runtime. tail = extra layers.
export function fxProject(dir, { base, raw, fx, total, toSrc, name = 'fx', tail = '', mask = null }) {
  const work = join(dir, name), cache = join(dir, 'fx-cache'), proj = join(work, 'project');
  mkdirSync(cache, { recursive: true });
  rmSync(proj, { recursive: true, force: true });
  mkdirSync(proj, { recursive: true });
  const stamp = `${statSync(base).size}`;
  copyFileSync(base, join(proj, 'base.mp4'));
  const wd = wideOf(dir), cropVf = wd ? `crop=${W}:${H}:${wd.ox}:0` : undefined, subj = visionSubject(dir) ?? subject(base, cache, total);
  const media = [];
  const busy = fx.map((e) => [e.t0 - 0.5, e.t0 + e.dur + 0.5]);

  const effects = fx.map((e) => {
    const a = {};
    const tag = `${e.k}-${e.t0.toFixed(2)}-${e.dur.toFixed(2)}-${stamp}`;
    if (e.cat.matte || e.params?.cutout === 'on' || e.params?.meBg) {
      const seg = join(cache, `seg-${tag}.mp4`);
      if (!existsSync(seg)) ff(['-ss', e.t0.toFixed(3), '-i', base, '-t', e.dur.toFixed(3), '-an', '-c:v', 'libx264', '-crf', '12', '-preset', 'fast', seg]);
      const better = mask && Array.from({ length: Math.ceil(e.dur * 10) + 1 }, (_, i) => toSrc(Math.min(e.t0 + i / 10, e.t0 + e.dur - 0.01))).every((t) => t <= mask.upTo);
      const m = better ? birefnetCut(seg, mask.file, e, join(cache, `matte-${tag}-bir2.webm`)) : cutOut(seg, join(cache, `matte-${tag}-a2.webm`));
      copyFileSync(m, join(proj, `m${e.k}.webm`));
      a.matte = `m${e.k}.webm`;
      const copies = e.fx === 'doodle-boil' ? 3 : 1;
      for (let c = 0; c < copies; c++) media.push({ id: c ? `m${e.k}c${c}` : `m${e.k}`, src: a.matte, start: e.t0, dur: e.dur, wrap: `mw${e.k}${c ? `c${c}` : ''}` });
    }
    if (e.cat.freeze) a.freeze = copyIn(stillAt(base, e.t0 + 0.02, join(cache, `freeze-${tag}.jpg`), cropVf), proj, `freeze${e.k}.jpg`);
    if (e.cat.before) {
      const out = join(cache, `before-${tag}.mp4`);
      if (!existsSync(out)) ff(['-ss', toSrc(e.t0).toFixed(3), '-i', raw, '-t', e.dur.toFixed(3), '-an', '-vf', `fps=${FPS},scale=${W}:${H}:force_original_aspect_ratio=increase,crop=${W}:${H},setsar=1`, '-c:v', 'libx264', '-crf', '16', '-preset', 'fast', out]);
      copyFileSync(out, join(proj, `before${e.k}.mp4`));
      media.push({ id: `before${e.k}`, src: `before${e.k}.mp4`, start: e.t0, dur: e.dur, wrap: `bw${e.k}` });
      a.before = `before${e.k}.mp4`;
    }
    const given = [].concat(e.params.images ?? e.params.image ?? []).filter((x) => typeof x === 'string');
    if (given.length) a.images = given.map((p, i) => copyIn(resolve(p), proj, `img${e.k}-${i}${extname(p)}`));
    else if (e.cat.stills) a.images = spread(total, busy, e.cat.stills).map((t, i) => copyIn(stillAt(base, t, join(cache, `still-${stamp}-${t.toFixed(2)}.jpg`), cropVf), proj, `img${e.k}-${i}.jpg`));
    return { k: e.k, fx: e.fx, t0: e.t0, dur: e.dur, params: e.params, assets: a };
  });

  copyFileSync(join(ROOT, 'effects/runtime.js'), join(proj, 'runtime.js'));
  copyFileSync(join(ROOT, 'effects/fx.css'), join(proj, 'fx.css'));
  writeFileSync(join(proj, 'hyperframes.json'), JSON.stringify({ media: { autoProxy: true } }));
  writeFileSync(join(proj, 'index.html'), page({ total, subj, effects, media, tail, wide: wd }));
  return { proj, work, name, effects };
}
export { HF, env as hfEnv };

function copyIn(src, proj, name) { copyFileSync(src, join(proj, name)); return name; }

// n timestamps spread over the reel, skipping effect windows so the cards show other moments.
function spread(total, busy, n) {
  const free = [];
  for (let t = 0.6; t < total - 0.6; t += 0.25) if (!busy.some(([a, b]) => t > a && t < b)) free.push(t);
  const pool = free.length >= n ? free : Array.from({ length: n * 4 }, (_, i) => 0.6 + (i * (total - 1.2)) / (n * 4));
  return Array.from({ length: n }, (_, i) => pool[Math.floor(((i + 0.5) * pool.length) / n)]);
}

export function page({ total, subj, effects, media, cam, tail = '', wide = null }) {
  const vid = (m) => (m.empty ? `<div class="mw" id="${m.wrap}"></div>` : `<div class="mw" id="${m.wrap}"><video id="${m.id}" src="${m.src}" muted playsinline data-start="${m.start.toFixed(3)}" data-duration="${m.dur.toFixed(3)}" data-track-index="2"></video></div>`);
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=${W}, height=${H}" />
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;600;800;900&family=Reddit+Sans:wght@800&family=Bodoni+Moda:ital,wght@0,500;0,700;1,500&family=Gochi+Hand&family=Instrument+Serif:ital@0;1&family=JetBrains+Mono:wght@500;700&display=swap" rel="stylesheet" />
<script src="https://cdn.jsdelivr.net/npm/gsap@3.14.2/dist/gsap.min.js"></script>
<link rel="stylesheet" href="fx.css" />
${wide ? `<style>#cam{overflow:visible!important;clip-path:inset(0px 0px 0px 0px round 0px)}#base,#cam video,.mw video{left:-${wide.ox}px!important;width:${wide.w}px!important}</style>` : ''}
<script>window.FX = ${JSON.stringify({ duration: total, W, H, subject: subj, effects, ...(wide ? { wide } : {}) })};</script>
</head>
<body>
<div id="fx" data-composition-id="fx" data-start="0" data-duration="${total.toFixed(3)}" data-fps="${FPS}" data-width="${W}" data-height="${H}">
<div id="under" class="layer"></div>
<div id="cam" class="layer">${cam ?? `<video id="base" src="base.mp4" playsinline data-has-audio="true" data-start="0" data-duration="${total.toFixed(3)}" data-track-index="0"></video>`}<div id="camfx" class="layer"></div></div>
<div id="behind" class="layer"></div>
<div id="before" class="layer">${media.filter((m) => m.id.startsWith('before')).map(vid).join('')}</div>
<div id="mattes" class="layer">${media.filter((m) => !m.id.startsWith('before')).map(vid).join('')}</div>
<div id="clips" class="layer">${effects.filter((e) => e.params?.kind === 'video' && e.params?.src).map((e) => ['clip', 'clipb'].map((id, i) => `<video id="${id}${e.k}" class="cover" src="${e.params.src}" muted playsinline data-start="${e.t0.toFixed(3)}" data-duration="${e.dur.toFixed(3)}" data-media-start="${(+e.params.from || 0).toFixed(3)}" data-track-index="${30 + 2 * e.k + i}"></video>`).join('')).join('')}</div>
<div id="front" class="layer"></div>
</div>
<svg width="0" height="0" style="position:absolute">
<filter id="sticker" x="-10%" y="-10%" width="120%" height="120%"><feMorphology in="SourceAlpha" operator="dilate" radius="14" result="d"/><feFlood flood-color="#fff"/><feComposite in2="d" operator="in" result="w"/><feMerge><feMergeNode in="w"/><feMergeNode in="SourceGraphic"/></feMerge></filter>
${[0, 1, 2].map((s) => `<filter id="boil${s}" x="-10%" y="-10%" width="120%" height="120%"><feMorphology in="SourceAlpha" operator="dilate" radius="${17 + s}" result="d"/><feMorphology in="SourceAlpha" operator="dilate" radius="${8 + s}" result="e"/><feComposite in="d" in2="e" operator="out" result="ring"/><feTurbulence type="fractalNoise" baseFrequency="0.035" numOctaves="2" seed="${s * 7 + 3}" result="n"/><feDisplacementMap in="ring" in2="n" scale="24" xChannelSelector="R" yChannelSelector="G" result="r2"/><feFlood flood-color="#fff"/><feComposite in2="r2" operator="in"/></filter>`).join('\n')}
<filter id="paper"><feTurbulence type="fractalNoise" baseFrequency="0.9" numOctaves="3" seed="4"/><feColorMatrix values="0 0 0 0 0.93  0 0 0 0 0.9  0 0 0 0 0.85  0 0 0 -0.9 0.9"/></filter>
</svg>
<script src="runtime.js"></script>
${tail}
</body>
</html>`;
}
