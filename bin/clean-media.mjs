#!/usr/bin/env node
// Softly hides text burned into a clip (its own subtitles), only over those letters and only while they show. Text that is part of the shot stays.
// Usage: clean-media.mjs <video>           every clip in runs/<video>/rpn-scenes.json, rewrites scenes to the cleaned files
//        clean-media.mjs --file <in> <out>  one clip
// A scene with `keepText: true` is skipped: its text is the point (a terminal, a post).
import { readFileSync, writeFileSync, mkdirSync, existsSync, readdirSync } from 'node:fs';
import { join, dirname, basename } from 'node:path';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { CFG } from '../lib/config.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..'), RUNS = join(ROOT, 'runs'), CACHE = join(ROOT, '.cache', 'clean-media');
const FF = CFG.ffmpeg, PROBE = CFG.ffprobe, OCR = join(ROOT, 'bin', 'ocrbox');
const FPS = 3, SIGMA = 22, PAD = 0.012, FEATHER = 14;
if (!existsSync(OCR)) execFileSync('swiftc', ['-O', `${OCR}.swift`, '-o', OCR]);

const probe = (f) => { const [w, h] = execFileSync(PROBE, ['-v', 'error', '-select_streams', 'v', '-show_entries', 'stream=width,height', '-of', 'csv=p=0', f], { encoding: 'utf8' }).trim().split(','); return { w: +w, h: +h }; };

function scan(file) {
  const key = createHash('sha1').update(`${file}:${readFileSync(file).length}`).digest('hex').slice(0, 16), json = join(CACHE, `${key}.json`);
  if (existsSync(json)) return JSON.parse(readFileSync(json, 'utf8'));
  const dir = join(CACHE, key); mkdirSync(dir, { recursive: true });
  execFileSync(FF, ['-v', 'error', '-y', '-i', file, '-vf', `fps=${FPS},scale=960:-2`, join(dir, 'f%05d.png')]);
  const frames = readdirSync(dir).sort().map((f) => join(dir, f)), rows = [];
  for (let i = 0; i < frames.length; i += 60) rows.push(...execFileSync(OCR, frames.slice(i, i + 60), { encoding: 'utf8', maxBuffer: 1 << 26 }).trim().split('\n').map((l) => JSON.parse(l || '[]')));
  writeFileSync(json, JSON.stringify(rows));
  return rows;
}

// A subtitle line sits at one height and keeps changing its words; a label on the set keeps its words.
function subtitles(rows) {
  const bands = {};
  rows.forEach((row, i) => row.forEach((b) => { (bands[Math.round((b.y + b.h / 2) * 40)] ??= []).push({ ...b, i }); }));
  const lines = Object.values(bands).filter((list) => new Set(list.map((b) => b.t.toLowerCase())).size >= 4).flat().sort((a, b) => a.i - b.i);
  const segs = [];
  for (const b of lines) {
    const t = b.i / FPS, last = segs.findLast((s) => Math.abs(s.cy - (b.y + b.h / 2)) < 0.03 && t - s.t1 < 0.5);
    if (last) { last.t1 = t; last.x0 = Math.min(last.x0, b.x); last.x1 = Math.max(last.x1, b.x + b.w); last.y0 = Math.min(last.y0, b.y); last.y1 = Math.max(last.y1, b.y + b.h); }
    else segs.push({ t0: t, t1: t, cy: b.y + b.h / 2, x0: b.x, x1: b.x + b.w, y0: b.y, y1: b.y + b.h });
  }
  return segs;
}

function patch(file, out, windows) {
  const rows = scan(file), segs = subtitles(rows).filter((s) => !windows || windows.some(([a, b]) => s.t1 + 0.4 >= a && s.t0 - 0.4 <= b)), { w, h } = probe(file);
  if (!segs.length) return { segs: 0 };
  const even = (n) => Math.max(2, Math.round(n / 2) * 2), g = [];
  let last = '0:v';
  g.push(`[0:v]split=${segs.length + 1}[base]${segs.map((_, i) => `[s${i}]`).join('')}`);
  last = 'base';
  segs.forEach((s, i) => {
    const x = even(Math.max(0, s.x0 - PAD) * w), y = even(Math.max(0, s.y0 - PAD) * h), W = even(Math.min(w - x, (s.x1 - s.x0 + 2 * PAD) * w)), H = even(Math.min(h - y, (s.y1 - s.y0 + 2 * PAD) * h));
    const f = Math.min(FEATHER, Math.floor(H / 3)), a = Math.max(0, s.t0 - 0.2).toFixed(2), b = (s.t1 + 0.34).toFixed(2);
    g.push(`[s${i}]crop=${W}:${H}:${x}:${y},gblur=sigma=${SIGMA}[c${i}]`, `color=black:s=${W}x${H}:r=30,format=gray,drawbox=x=${f}:y=${f}:w=${W - 2 * f}:h=${H - 2 * f}:color=white:t=fill,boxblur=${f}[m${i}]`, `[c${i}][m${i}]alphamerge[d${i}]`, `[${last}][d${i}]overlay=${x}:${y}:enable='between(t,${a},${b})':shortest=1[o${i}]`);
    last = `o${i}`;
  });
  execFileSync(FF, ['-v', 'error', '-y', '-i', file, '-filter_complex', g.join(';'), '-map', `[${last}]`, '-map', '0:a?', '-c:v', 'libx264', '-crf', '19', '-preset', 'veryfast', '-pix_fmt', 'yuv420p', '-c:a', 'copy', out]);
  return { segs: segs.length };
}

if (process.argv[2] === '--file') { console.log(basename(process.argv[3]), patch(process.argv[3], process.argv[4])); process.exit(0); }

const video = process.argv[2];
if (!video) { console.error('usage: clean-media.mjs <video> | --file <in> <out>'); process.exit(1); }
const scenesFile = join(RUNS, video, 'rpn-scenes.json'), S = JSON.parse(readFileSync(scenesFile, 'utf8'));
const concept = JSON.parse(readFileSync(join(RUNS, video, 'compare.json'), 'utf8')).mediaFrom, mediaFile = join(concept, 'media.json'), M = JSON.parse(readFileSync(mediaFile, 'utf8'));
const words = JSON.parse(readFileSync(join(RUNS, `${video}-p-clean-full`, 'words.json'), 'utf8'));
const used = {};
for (const s of S.scenes) if (s.media && !s.keepText) (used[s.media.replace(/-clean$/, '')] ??= []).push([s.from ?? 0, (s.from ?? 0) + (words[Math.min(s.to, words.length - 1)].end - words[s.at].start) + 0.5]);
for (const [id, windows] of Object.entries(used)) {
  const it = M.items.find((i) => i.id === id);
  if (!it || it.kind !== 'video' || it.source === 'you') continue;
  const name = `${id}-clean`, file = join(concept, 'media', `${name}.mp4`), { segs } = patch(join(concept, it.file), file, windows);
  console.log(`${id}: ${segs ? `${segs} text patches` : 'no burned-in text in the parts used'}`);
  for (const s of S.scenes) if (s.media === id || s.media === name) s.media = segs ? name : id;
  M.items = M.items.filter((i) => i.id !== name);
  if (segs) M.items.push({ ...it, id: name, file: `media/${name}.mp4`, caption: `${it.caption ?? ''} (text softened)` });
}
writeFileSync(mediaFile, JSON.stringify(M, null, 1));
writeFileSync(scenesFile, JSON.stringify(S, null, 1));
