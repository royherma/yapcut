#!/usr/bin/env node
// node bin/listen.mjs <session id> [video]: tells Yap Studio this session is listening (green chip) and prints each new note of that video as a NOTE line, every unanswered one again each minute.
import { readdirSync, readFileSync, existsSync, statSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { openNotes } from './notes-open.mjs';
const [id, ...rest] = process.argv.slice(2), label = rest.join(' ');
if (!id) { console.error('usage: node bin/listen.mjs <session id> [label]'); process.exit(1); }
const RUNS = join(dirname(fileURLToPath(import.meta.url)), '..', 'runs'), BASE = process.env.YAP_URL || 'http://127.0.0.1:4901';
const seen = new Map();
const mine = label && existsSync(join(RUNS, label)) ? label : null;
const files = () => readdirSync(RUNS).filter((d) => !mine || d === mine).map((d) => join(RUNS, d, 'notes.jsonl')).filter(existsSync);
for (const f of files()) seen.set(f, statSync(f).size);
const beat = () => fetch(`${BASE}/api/claude/beat`, { method: 'POST', body: JSON.stringify({ id, label }) }).catch(() => console.log('BEAT FAILED - is the preview server up?'));
const stamp = () => writeFileSync(join(RUNS, `.listener-${id}.json`), JSON.stringify({ id, video: mine, at: Date.now() }));
beat(); stamp(); setInterval(() => { beat(); stamp(); }, 20000);
const nag = () => { for (const n of openNotes(6, Date.now(), mine).filter((x) => Date.now() - Date.parse(x.at) > 60e3)) console.log(`WAITING ${n.video} ${n.at} @${n.t}s ${n.text}`); };
nag(); setInterval(nag, 60000);
setInterval(() => {
  for (const f of files()) {
    const size = statSync(f).size, from = seen.get(f) ?? 0;
    if (size <= from) { seen.set(f, size); continue; }
    const text = readFileSync(f).subarray(from).toString('utf8');
    seen.set(f, size);
    for (const l of text.split('\n').filter(Boolean)) { try { const n = JSON.parse(l); if (n.kind !== 'reply' && n.kind !== 'edit') console.log(`NOTE ${f.split('/').at(-2)} ${l}`); } catch {} }
  }
}, 2000);
console.log(`listening as ${id} on ${RUNS}`);
