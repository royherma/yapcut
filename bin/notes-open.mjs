#!/usr/bin/env node
// node bin/notes-open.mjs [hours] [video]: your notes with no reply yet, newest last. Exit 1 when any are open.
import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

export const RUNS = join(dirname(fileURLToPath(import.meta.url)), '..', 'runs');
export function openNotes(hours = 6, now = Date.now(), only = null) {
  const open = [];
  for (const video of readdirSync(RUNS)) {
    if (only && video !== only) continue;
    const file = join(RUNS, video, 'notes.jsonl');
    if (!existsSync(file)) continue;
    const rows = readFileSync(file, 'utf8').split('\n').filter(Boolean).flatMap((l) => { try { return [JSON.parse(l)]; } catch { return []; } });
    const answered = new Set(rows.filter((n) => n.kind === 'reply').map((n) => n.to));
    for (const n of rows) if ((n.kind === 'note' || n.kind === 'idea') && !answered.has(n.at) && now - Date.parse(n.at) < hours * 3600e3) open.push({ video, at: n.at, t: n.t, text: n.text });
  }
  return open.sort((a, b) => Date.parse(a.at) - Date.parse(b.at));
}
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const open = openNotes(+process.argv[2] || 6, Date.now(), process.argv[3]);
  for (const n of open) console.log(`${n.video} ${n.at} @${n.t}s ${n.text}`);
  process.exit(open.length ? 1 : 0);
}
