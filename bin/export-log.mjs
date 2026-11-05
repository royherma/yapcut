#!/usr/bin/env node
// Every export per video: time from take to first export, how many done / failed / cancelled, typical export time.
// Reads runs/<video>/exports.jsonl (written by lib/export.mjs); exports made before that log existed come from the files in runs/<video>/exports/.
// Usage: node bin/export-log.mjs [video] [--json]
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const RUNS = join(dirname(fileURLToPath(import.meta.url)), '..', 'runs');
const [only] = process.argv.slice(2).filter((a) => !a.startsWith('--')), asJson = process.argv.includes('--json');
const bkk = (ms) => (ms ? new Date(ms).toLocaleString('en-GB', { timeZone: 'Asia/Bangkok', day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }) : '-');
const dur = (s) => (s == null ? '-' : s < 90 ? `${s} s` : s < 5400 ? `${Math.round(s / 60)} min` : s < 172800 ? `${(s / 3600).toFixed(1)} h` : `${(s / 86400).toFixed(1)} d`);
const median = (a) => { const v = a.filter((x) => x != null).sort((x, y) => x - y); return v.length ? v[Math.floor(v.length / 2)] : null; };

const rows = [];
for (const v of readdirSync(RUNS).filter((d) => existsSync(join(RUNS, d, 'compare.json')) && (!only || d === only))) {
  const take = statSync(join(RUNS, v, 'compare.json')).birthtimeMs, logF = join(RUNS, v, 'exports.jsonl');
  const logged = existsSync(logF) ? readFileSync(logF, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)) : [];
  const seen = new Set(logged.map((x) => x.file).filter(Boolean)), xd = join(RUNS, v, 'exports');
  const fromFiles = existsSync(xd) ? readdirSync(xd).filter((f) => /\.(mp4|mov|webm)$/.test(f) && !seen.has(f)).map((f) => ({ state: 'done', file: f, ended: new Date(statSync(join(xd, f)).mtimeMs).toISOString(), secs: null, source: 'file' })) : [];
  const all = [...logged, ...fromFiles].sort((a, b) => Date.parse(a.ended) - Date.parse(b.ended));
  if (!all.length && only !== v) continue;
  const done = all.filter((x) => x.state === 'done'), first = done[0];
  rows.push({ video: v, takeAt: take, firstExportAt: first ? Date.parse(first.ended) : null, takeToFirstSecs: first ? Math.round((Date.parse(first.ended) - take) / 1000) : null,
    done: done.length, failed: all.filter((x) => x.state === 'fail').length, cancelled: all.filter((x) => x.state === 'cancel').length,
    medianExportSecs: median(done.map((x) => x.secs)), lastError: all.filter((x) => x.state === 'fail').at(-1)?.error ?? null, exports: all });
}
rows.sort((a, b) => a.takeAt - b.takeAt);
if (asJson) { console.log(JSON.stringify(rows, null, 1)); process.exit(0); }
const head = ['video', 'take (Bangkok)', 'first export', 'take → first', 'done', 'fail', 'cancel', 'export time'];
const body = rows.map((r) => [r.video.slice(0, 34), bkk(r.takeAt), bkk(r.firstExportAt), dur(r.takeToFirstSecs), r.done, r.failed, r.cancelled, dur(r.medianExportSecs)].map(String));
const w = head.map((h, i) => Math.max(h.length, ...body.map((b) => b[i].length)));
for (const r of [head, ...body]) console.log(r.map((c, i) => c.padEnd(w[i])).join('  '));
const fails = rows.filter((r) => r.lastError);
if (fails.length) { console.log('\nlast error per video:'); for (const r of fails) console.log(`  ${r.video}: ${r.lastError}`); }
console.log(`\n${rows.length} videos with exports. Export time is only known for exports logged since 2026-10-30; older ones come from their files (marked -).`);
