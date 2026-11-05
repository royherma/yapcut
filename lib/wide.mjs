// Full-frame mode: runs/<take>/frame.json {"mode":"full"} next to the raw keeps the whole landscape frame, 1920 px tall, as a
// plane `w` px wide whose middle 1080 px are the usual 9:16 canvas (ox px of overscan each side). null = today's centre strip.
import { readFileSync, realpathSync, readdirSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join, dirname } from 'node:path';

const W = 1080, H = 1920, dims = {};
export function wideOf(dir) {
  const raw = readdirSync(dir).find((f) => f.startsWith('raw.'));
  if (!raw) return null;
  const real = realpathSync(join(dir, raw));
  try { if (JSON.parse(readFileSync(join(dirname(real), 'frame.json'), 'utf8')).mode !== 'full') return null; } catch { return null; }
  const [w, h] = (dims[real] ??= execFileSync('ffprobe', ['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=width,height', '-of', 'csv=p=0', real]).toString().trim().split(',').map(Number));
  if (w / h < (W / H) * 1.2) return null;
  const pw = 2 * Math.round((H * w) / h / 2);
  return { w: pw, ox: (pw - W) / 2 };
}
