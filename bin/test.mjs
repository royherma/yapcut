#!/usr/bin/env node
// node bin/test.mjs: every version of every take lays out on the current code, and no approved cut moved (bin/approved-check.mjs).
import { readdirSync, existsSync, readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { layout } from '../lib/edit.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..'), RUNS = join(ROOT, 'runs');
let n = 0, bad = 0;
for (const v of existsSync(RUNS) ? readdirSync(RUNS).sort() : []) {
  const f = join(RUNS, v, 'compare.json');
  if (!existsSync(f)) continue;
  let runs;
  try { runs = JSON.parse(readFileSync(f, 'utf8')).runs ?? []; } catch (e) { bad++; console.log(`FAIL ${v}/compare.json: ${e.message}`); continue; }
  for (const r of runs) {
    n++;
    try { layout(join(RUNS, r)); } catch (e) { bad++; console.log(`FAIL ${r}: ${String(e.message || e).split('\n')[0]}`); }
  }
}
console.log(`${n} versions, ${bad} failed`);
const check = join(ROOT, 'bin/approved-check.mjs'), ap = existsSync(check) ? spawnSync(process.execPath, [check], { encoding: 'utf8' }) : { status: 0, stdout: '' };
process.stdout.write(ap.stdout.split('\n').filter((l) => /^MOVED|approved versions/.test(l)).join('\n') + '\n');
process.exit(bad || ap.status ? 1 : 0);
