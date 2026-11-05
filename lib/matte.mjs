// Video cut-out with Apple Vision person segmentation (bin/matte), split across parallel workers, merged as VP9 alpha.
import { execFileSync, execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { existsSync, rmSync, statSync, readFileSync, realpathSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { wideOf } from './wide.mjs';
import { CFG } from './config.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..'), BIN = join(ROOT, 'bin/matte'), FFMPEG = CFG.ffmpeg;
const JOBS = 3;

const q = (s) => `'${String(s).replace(/'/g, `'\\''`)}'`;
const build = () => { if (!existsSync(BIN) || statSync(BIN).mtimeMs < statSync(`${BIN}.swift`).mtimeMs) execFileSync('swiftc', ['-O', `${BIN}.swift`, '-o', BIN]); };
const probe = (f) => execFileSync('ffprobe', ['-v', 'error', '-count_packets', '-select_streams', 'v:0', '-show_entries', 'stream=width,height,r_frame_rate,start_time,nb_read_packets', '-of', 'csv=p=0', f]).toString().trim().split(',');

function plan(input, out, quality) {
  build();
  const [w, h, rate, start, n] = probe(input), frames = +n, per = Math.ceil(frames / JOBS);
  const parts = Array.from({ length: Math.min(JOBS, frames) }, (_, k) => `${out}.part${k}`);
  return { parts, seg: ['-c', `${parts.map((f, k) => `${q(BIN)} ${q(input)} ${w} ${h} ${quality} ${k * per} ${Math.min(frames, (k + 1) * per)} ${+start || 0} > ${q(f)} 2>/dev/null &`).join(' ')} wait`],
    merge: ['-v', 'error', '-y', '-i', input, '-f', 'rawvideo', '-pix_fmt', 'gray', '-s', `${w}x${h}`, '-r', rate, '-i', `concat:${parts.join('|')}`,
      '-filter_complex', '[0:v][1:v]alphamerge,format=yuva420p', '-an', '-c:v', 'libvpx-vp9', '-deadline', 'realtime', '-cpu-used', '8', '-row-mt', '1', '-b:v', '0', '-crf', '22', '-auto-alt-ref', '0', out] };
}

const readJson = (f) => { try { return JSON.parse(readFileSync(f, 'utf8')); } catch { return null; } };

// Source seconds of the take with a BiRefNet mask ready (bin/birefnet.py), when runs/<take>/cutout.json says engine birefnet; else 0.
export function birefnetUpTo(dir) {
  if (wideOf(dir)) return 0;
  let take; try { take = dirname(realpathSync(join(dir, 'raw.mp4'))); } catch { return 0; }
  if (readJson(join(take, 'cutout.json'))?.engine !== 'birefnet') return 0;
  const p = readJson(join(take, 'matte-birefnet', 'progress.json'));
  return !p ? 0 : p.state === 'done' ? Infinity : Math.max(0, (p.done - 2) / 25);
}

// Paired by frame number: the .mkv mask has millisecond times, so pairing by time reuses the previous mask on every other frame.
const mergeArgs = (color, mask, out) => ['-v', 'error', '-y', '-i', color, '-i', mask, '-filter_complex', '[0:v]setpts=N/30/TB[c];[1:v]setpts=N/30/TB[m];[c][m]alphamerge,format=yuva420p', '-an',
  '-c:v', 'libvpx-vp9', '-deadline', 'realtime', '-cpu-used', '8', '-row-mt', '1', '-b:v', '0', '-crf', '22', '-auto-alt-ref', '0', out];
export const mergeMatte = (color, mask, out) => { execFileSync(FFMPEG, mergeArgs(color, mask, out)); return out; };

export function cutOutFast(input, out, { quality = 'accurate' } = {}) {
  if (existsSync(out)) return out;
  const P = plan(input, out, quality);
  try { execFileSync('sh', P.seg); execFileSync(FFMPEG, P.merge); } finally { P.parts.forEach((f) => rmSync(f, { force: true })); }
  return out;
}

const pexec = promisify(execFile);
export async function cutOutFastAsync(input, out, { quality = 'accurate' } = {}) {
  if (existsSync(out)) return out;
  const P = plan(input, out, quality);
  try { await pexec('sh', P.seg); await pexec(FFMPEG, P.merge); } finally { P.parts.forEach((f) => rmSync(f, { force: true })); }
  return out;
}

// Cut-out of one stretch of an edit, framed like the edit (cuts + zooms), for the browser preview. Same file for the same pieces.
function stretch(L, t0, dur) {
  const t1 = t0 + dur, lerp = (z, f) => +(z[0] + (z[1] - z[0]) * f).toFixed(4);
  return L.pieces.filter((pc) => pc.o < t1 && pc.o + (pc.e - pc.s) > t0).map((pc) => {
    const len = pc.e - pc.s, a = Math.max(t0, pc.o) - pc.o, b = Math.min(t1, pc.o + len) - pc.o;
    return { s: +(pc.s + a).toFixed(3), e: +(pc.s + b).toFixed(3), o: +(pc.o + a - t0).toFixed(3), z: [lerp(pc.z, a / len), lerp(pc.z, b / len)], f: pc.f };
  });
}
export const matteEngine = (dir, L, t0, dur) => (stretch(L, t0, dur).every((pc) => pc.e <= birefnetUpTo(dir)) ? 'birefnet' : 'apple');

export async function editMatte(dir, L, t0, dur, cache) {
  const pieces = stretch(L, t0, dur), bir = matteEngine(dir, L, t0, dur) === 'birefnet';
  const { createHash } = await import('node:crypto'), { rawOf } = await import('./edit.mjs'), { base } = await import('./export.mjs');
  const out = join(cache, `pm-${createHash('sha1').update(JSON.stringify(bir ? [rawOf(dir), pieces, 'birefnet2'] : [rawOf(dir), pieces, 'apple2', ...(wideOf(dir) ? ['wide'] : [])])).digest('hex').slice(0, 16)}.webm`);
  if (existsSync(out)) return out;
  const seg = `${out}.seg.mp4`, mseg = `${out}.mask.mkv`, piece = { pieces, sfx: [], total: dur };
  await base(dir, piece, seg);
  try {
    if (!bir) return await cutOutFastAsync(seg, out);
    await base(dir, piece, mseg, null, { mask: true });
    await pexec(FFMPEG, mergeArgs(seg, mseg, out));
    return out;
  } finally { rmSync(seg, { force: true }); rmSync(mseg, { force: true }); }
}
