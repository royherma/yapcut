#!/usr/bin/env node
// Kept words that lose 30 ms+ of their sound to a cut. Usage: clip-scan.mjs <version> [video]
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { layout } from '../lib/edit.mjs';
import { voiceDb, clippedWords } from '../lib/clipcheck.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..'), [run, vid] = process.argv.slice(2), video = vid || run.replace(/-p-.*$/, '');
const orig = JSON.parse(readFileSync(join(ROOT, 'runs', `${video}-p-clean-full`, 'words.json'), 'utf8'));
const out = clippedWords(layout(join(ROOT, 'runs', run)), Array.isArray(orig) ? orig : orig.words, voiceDb(join(ROOT, 'runs', video, 'asr', 'voice.wav')));
console.log(`${run}: ${out.length} kept words lose 30 ms+ of their sound`);
for (const x of out.slice(0, 40)) console.log(JSON.stringify(x));
