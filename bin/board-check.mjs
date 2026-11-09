#!/usr/bin/env node
// node bin/board-check.mjs <version> [outDir]: every board picture centered in its circle + no two board items overlapping (swept every 0.25 s).
// Writes runs/<version>/board-check.json; exit 1 when anything fails. Runs as the last Yap Studio pipeline step for versions with a board.
import { chromium } from 'playwright-core';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromeLaunch } from '../lib/config.mjs';
const [run, out = `/tmp/board-check-${run}`] = process.argv.slice(2);
if (!run) { console.error('usage: node bin/board-check.mjs <version> [outDir]'); process.exit(1); }
const PORT = process.env.PORT || 4901, STEP = 0.25, MIN_OVERLAP = +(process.env.MIN_OVERLAP ?? 6);
mkdirSync(out, { recursive: true });
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const b = await chromium.launch(chromeLaunch());
const p = await b.newPage({ viewport: { width: 1080, height: 1920 } });
p.goto(`http://127.0.0.1:${PORT}/play/${run}`).catch(() => {});
await p.waitForFunction(() => window.YP && window.__timelines && document.querySelectorAll('.bel').length, null, { timeout: 30000 });
await wait(1500);
const { beats, total } = await p.evaluate(() => ({ total: window.YP.total, beats: (window.YP.board?.fitted.beats ?? []).filter((x) => x.do === 'add' && x.el.type === 'cutout').map((x) => ({ id: x.id, t: x.t, pop: x.el.pop || 'up' })) }));
const seek = async (t, ms) => { await p.evaluate((t) => { window.__timelines.fx.seek(t, false); }, t); await wait(ms); };

const centering = [];
for (const { id, t, pop } of beats) {
  await seek(t + 0.9, 300);
  const c = await p.evaluate((id) => {
    const bl = document.querySelector(`.bel[data-id="${id}"] .blob`), im = bl?.querySelector('img');
    if (!im) return null;
    const a = bl.getBoundingClientRect(), r = im.getBoundingClientRect();
    return { dx: Math.round(r.x + r.width / 2 - a.x - a.width / 2), dy: Math.round(r.y + r.height / 2 - a.y - a.height / 2) };
  }, id);
  if (!c) continue;
  await p.locator(`.bel[data-id="${id}"] .blob`).screenshot({ path: `${out}/${id}.png`, timeout: 5000 }).catch(() => {});
  const off = pop === 'none' ? Math.hypot(c.dx, c.dy) : Math.abs(c.dx);
  centering.push({ id, t: +t.toFixed(2), off: Math.round(off), ok: off <= 4, shot: `${out}/${id}.png` });
}

const hits = [];
for (let t = 0; t < total; t += STEP) {
  await seek(t, 40);
  const bx = await p.evaluate(() => [...document.querySelectorAll('.bel')].filter((n) => getComputedStyle(n).visibility !== 'hidden' && +getComputedStyle(n).opacity > 0.3)
    .map((n) => { const r = (n.firstElementChild || n).getBoundingClientRect(); return { id: n.dataset.id, x: r.x, y: r.y, w: r.width, h: r.height }; }));
  for (let i = 0; i < bx.length; i++) for (let j = i + 1; j < bx.length; j++) {
    const a = bx[i], c = bx[j], ox = Math.min(a.x + a.w, c.x + c.w) - Math.max(a.x, c.x), oy = Math.min(a.y + a.h, c.y + c.h) - Math.max(a.y, c.y);
    if (ox > MIN_OVERLAP && oy > MIN_OVERLAP) hits.push({ t: +t.toFixed(2), pair: `${a.id} x ${c.id}`, px: `${Math.round(ox)}x${Math.round(oy)}` });
  }
}
await b.close();

const overlaps = Object.values(hits.reduce((m, h) => { const k = h.pair; (m[k] ??= { pair: k, from: h.t, to: h.t, px: h.px }).to = h.t; return m; }, {}));
const bad = centering.filter((c) => !c.ok);
const res = { at: new Date().toISOString(), run, centering, overlaps, ok: !bad.length && !overlaps.length, summary: `${centering.length - bad.length}/${centering.length} pictures centered, ${overlaps.length} overlaps` };
writeFileSync(join(dirname(fileURLToPath(import.meta.url)), '..', 'runs', run, 'board-check.json'), JSON.stringify(res, null, 1));
for (const c of bad) console.log(`OFF ${c.id} at ${c.t} s: ${c.off} px from center -> ${c.shot}`);
for (const o of overlaps) console.log(`OVERLAP ${o.pair} ${o.from}-${o.to} s (${o.px} px)`);
console.log(res.summary);
process.exit(res.ok ? 0 : 1);
