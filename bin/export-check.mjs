#!/usr/bin/env node
// Export vs preview at chosen seconds, in ~1 min instead of a full export: node bin/export-check.mjs <version> [seconds...]
import { execFileSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { CFG } from '../lib/config.mjs';

const [run, ...at] = process.argv.slice(2);
if (!run) { console.error('usage: node bin/export-check.mjs <version> [seconds...]  (no seconds = every effect)'); process.exit(1); }
const r = await fetch(`http://127.0.0.1:${process.env.PORT || 4901}/api/export-check/${run}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ at: at.map(Number) }) }).then((x) => x.json());
if (!r.ok) { console.error(r.error); process.exit(1); }
const FF = CFG.ffmpeg, dir = dirname(r.preview[0]);
r.times.forEach((t, i) => {
  const pair = join(dir, `pair-${t}.jpg`);
  execFileSync(FF, ['-v', 'error', '-y', '-i', r.export[i], '-i', r.preview[i], '-filter_complex', '[0]scale=540:960[a];[1]scale=540:960[b];[a][b]hstack,drawtext=text=EXPORT:x=20:y=20:fontsize=36:fontcolor=red:box=1,drawtext=text=PREVIEW:x=560:y=20:fontsize=36:fontcolor=red:box=1', pair]);
  console.log(`${t}s  ${pair}`);
});
