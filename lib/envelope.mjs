// Voice loudness and brightness per frame (30 fps) of a take, cached next to the real raw file. Drives voice-orb.
import { existsSync, readFileSync, writeFileSync, realpathSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join, dirname } from 'node:path';
import { CFG } from './config.mjs';

const FFMPEG = CFG.ffmpeg;
const RATE = 16000, FPS = 30;

export function envelope(raw) {
  const real = realpathSync(raw), file = join(dirname(real), 'envelope.json');
  if (existsSync(file)) return JSON.parse(readFileSync(file, 'utf8'));
  const pcm = execFileSync(FFMPEG, ['-v', 'error', '-i', real, '-af', 'aresample=async=1:first_pts=0', '-ac', '1', '-ar', String(RATE), '-f', 'f32le', '-'], { maxBuffer: 1 << 30 });
  const x = new Float32Array(pcm.buffer.slice(pcm.byteOffset, pcm.byteOffset + pcm.length));
  const rms = [], zcr = [];
  for (let f = 0; Math.round((f + 1) * RATE / FPS) <= x.length; f++) {
    const a = Math.round(f * RATE / FPS), b = Math.round((f + 1) * RATE / FPS);
    let s = 0, z = 0;
    for (let k = a; k < b; k++) { s += x[k] * x[k]; if (k > a && (x[k] >= 0) !== (x[k - 1] >= 0)) z++; }
    rms.push(Math.sqrt(s / (b - a))); zcr.push(z / (b - a));
  }
  const top = [...rms].sort((a, b) => a - b)[Math.floor(rms.length * 0.98)] || 1;
  const out = { fps: FPS, rms: rms.map((v) => +Math.min(1, v / top).toFixed(3)), zcr: zcr.map((v) => +Math.min(1, v * 6).toFixed(3)) };
  writeFileSync(file, JSON.stringify(out));
  return out;
}

// Voice loudness every 10 ms, 1 = the take's loud speech (p90 of voiced frames). Finds quiet points for cuts.
export function fine(raw) {
  const real = realpathSync(raw), file = join(dirname(real), 'loud100.json');
  if (existsSync(file)) return JSON.parse(readFileSync(file, 'utf8'));
  const pcm = execFileSync(FFMPEG, ['-v', 'error', '-i', real, '-ac', '1', '-ar', String(RATE), '-af', 'aresample=async=1:first_pts=0,highpass=f=80', '-f', 'f32le', '-'], { maxBuffer: 1 << 30 });
  const x = new Float32Array(pcm.buffer.slice(pcm.byteOffset, pcm.byteOffset + pcm.length)), n = RATE / 100, rms = [];
  for (let a = 0; a + n <= x.length; a += n) { let s = 0; for (let k = a; k < a + n; k++) s += x[k] * x[k]; rms.push(Math.sqrt(s / n)); }
  const sorted = [...rms].sort((a, b) => a - b), floor = sorted[Math.floor(rms.length * 0.1)];
  const voiced = sorted.filter((v) => v > floor * 4), top = voiced[Math.floor(voiced.length * 0.9)] || sorted.at(-1) || 1;
  const out = { fps: 100, rms: rms.map((v) => +Math.min(2, v / top).toFixed(3)) };
  writeFileSync(file, JSON.stringify(out));
  return out;
}
