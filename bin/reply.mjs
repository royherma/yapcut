#!/usr/bin/env node
// node bin/reply.mjs <video> <note time (at) | last> "<text>": Claude's answer under your note in Yap Studio's Sent to Claude list.
import { appendFileSync, readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
const [video, to, ...words] = process.argv.slice(2), text = words.join(' ').trim();
if (!video || !to || !text) { console.error('usage: node bin/reply.mjs <video> <note at|last> "<text>"'); process.exit(1); }
const file = join(dirname(fileURLToPath(import.meta.url)), '..', 'runs', video, 'notes.jsonl');
const notes = readFileSync(file, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)).filter((n) => n.kind === 'note' || n.kind === 'idea');
const note = to === 'last' ? notes.at(-1) : notes.find((n) => n.at === to);
if (!note) { console.error(`no note ${to} in ${file}`); process.exit(1); }
appendFileSync(file, JSON.stringify({ kind: 'reply', to: note.at, run: note.run, text, at: new Date().toISOString() }) + '\n');
console.log(`replied to ${note.label} at ${note.t}: ${note.text.slice(0, 60)}`);
