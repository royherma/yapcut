import { writeFileSync, renameSync, readFileSync, statSync } from 'node:fs';

export function writeJson(file, obj, space = 1) {
  const tmp = `${file}.${process.pid}.tmp`;
  writeFileSync(tmp, JSON.stringify(obj, null, space));
  renameSync(tmp, file);
}

const parsed = new Map();
// Shared parse, re-read only when mtime, size or inode change: callers must never mutate the result.
export function jsonOf(file) {
  const st = statSync(file, { throwIfNoEntry: false }), m = parsed.get(file);
  if (!st) { parsed.delete(file); return JSON.parse(readFileSync(file, 'utf8')); }
  if (m && m.t === st.mtimeMs && m.n === st.size && m.i === st.ino) return m.v;
  const v = JSON.parse(readFileSync(file, 'utf8'));
  parsed.set(file, { t: st.mtimeMs, n: st.size, i: st.ino, v });
  return v;
}
