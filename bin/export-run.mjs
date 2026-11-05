#!/usr/bin/env node
// node bin/export-run.mjs <version> [ratio=9:16] [format=mp4] [speed=1]: the page's Export, run as its own process so a preview server restart can't kill it.
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { layout, facesFor } from '../lib/edit.mjs';
import { startExport, exportJobs } from '../lib/export.mjs';

const [run, ratio = '9:16', format = 'mp4', speed = '1'] = process.argv.slice(2);
if (!run) { console.error('usage: node bin/export-run.mjs <version> [ratio] [format] [speed]'); process.exit(1); }
const RUNS = join(dirname(fileURLToPath(import.meta.url)), '..', 'runs'), dir = join(RUNS, run);
const video = run.replace(/-p-[\w-]+$/, ''), cmp = JSON.parse(readFileSync(join(RUNS, video, 'compare.json'), 'utf8'));
const area = (b) => Math.max(0, b[2]) * Math.max(0, b[3]);
const inter = (a, b) => area([0, 0, Math.min(a[0] + a[2], b[0] + b[2]) - Math.max(a[0], b[0]), Math.min(a[1] + a[3], b[1] + b[3]) - Math.max(a[1], b[1])]);
const L = layout(dir), F = facesFor(dir), faces = [];
for (const pc of L.pieces) for (const f of F) {
  if (!f.face || f.t < pc.s || f.t >= pc.e) continue;
  const [x, y, w, h] = f.face, hand = (f.hands ?? []).some((b) => inter(b, f.face) > 0.25 * area(f.face));
  faces.push([+(pc.o + f.t - pc.s).toFixed(2), Math.round((x - w * 0.12) * 1080), Math.round((y - h * 0.38) * 1920), Math.round((x + w * 1.12) * 1080), Math.round((y + h * 1.2) * 1920), hand ? 1 : 0]);
}
const job = startExport({ run, dir, outDir: join(RUNS, video, 'exports'), label: cmp.label?.[run] ?? run, ratio, format, speed: +speed, faces, log: (s) => console.log(s) });
console.log(`EXPORT started ${job.file}`);
let last = '';
const tick = setInterval(() => {
  const j = exportJobs().find((x) => x.id === job.id);
  const line = `${j.state} ${j.pct.toFixed(0)}% ${j.stage}`;
  if (line !== last) { console.log(`PROGRESS ${line}`); last = line; }
  if (j.state !== 'running') { clearInterval(tick); console.log(j.state === 'done' ? `DONE ${j.file} ${(j.size / 1e6).toFixed(1)} MB ${j.secs} s` : `FAILED ${j.error}`); process.exit(j.state === 'done' ? 0 : 1); }
}, 2000);
