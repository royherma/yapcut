// What the take itself tells us, measured once per take: voice loudness, how bright the caption band is, where the face
// sits, speaking speed. Cached in runs/<take>/analysis.json; findings feed the rule book.
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { SAFE } from './rules.mjs';
import { CFG } from './config.mjs';

const FFMPEG = CFG.ffmpeg;

function luma(proxy, crop, dur) {
  const r = spawnSync(FFMPEG, ['-v', 'info', '-i', proxy, '-vf', `fps=${(8 / dur).toFixed(4)},${crop ? `crop=${crop},` : ''}signalstats,metadata=print:key=lavfi.signalstats.YAVG`, '-f', 'null', '-'], { encoding: 'utf8' });
  const v = [...r.stderr.matchAll(/YAVG=([\d.]+)/g)].map((m) => Number(m[1]));
  return v.length ? Math.round(v.reduce((a, b) => a + b, 0) / v.length) : null;
}

export function analyze(takeDir, proxy, dur, face, words) {
  const file = join(takeDir, 'analysis.json');
  if (existsSync(file)) return JSON.parse(readFileSync(file, 'utf8'));
  const loud = spawnSync(FFMPEG, ['-i', proxy, '-af', 'ebur128', '-f', 'null', '-'], { encoding: 'utf8' }).stderr;
  const lufs = Number(loud.match(/I:\s+(-?[\d.]+) LUFS/g)?.at(-1).match(/-?[\d.]+/)[0]);
  const gaps = words.slice(1).map((w, i) => w.start - words[i].end);
  const a = {
    lufs, frameLuma: luma(proxy, null, dur), captionLuma: luma(proxy, '540:100:0:595', dur), face,
    wpm: Math.round((words.length / dur) * 60), longPauses: gaps.filter((g) => g > 1).length,
  };
  writeFileSync(file, JSON.stringify(a, null, 1));
  return a;
}

export function takeIssues(a) {
  const out = [];
  if (a.lufs < -20) out.push({ rule: 'Voice too quiet', sev: 'warn', t: null, msg: `${a.lufs} LUFS (Reels play at about -14)` });
  if (a.captionLuma > 150) out.push({ rule: 'Bright caption area', sev: 'warn', t: null, msg: `background behind captions is ${a.captionLuma}/255 bright - white words lose contrast` });
  if (a.face.y0 < SAFE.top) out.push({ rule: 'Head under top UI', sev: 'warn', t: null, msg: `face starts at y ${a.face.y0}, Instagram's top bar covers to ${SAFE.top}` });
  return out;
}
