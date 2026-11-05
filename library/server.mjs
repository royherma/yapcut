#!/usr/bin/env node
// yapcut library on :4900: sound browser for the sound dir (lib/config.mjs) at /, video effects gallery at /fx.
// Favorites and tags save to marks.json in the sound library.
import { refuseForeign } from '../lib/local-only.mjs';
import { createServer } from 'node:http';
import { readFileSync, writeFileSync, existsSync, statSync, createReadStream, renameSync } from 'node:fs';
import { execFile } from 'node:child_process';
import { join, normalize, dirname } from 'node:path';
import { homedir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { EFFECTS } from '../effects/catalog.mjs';
import { sfxPath, audioType } from '../lib/sfx-path.mjs';
import { CFG } from '../lib/config.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const LIB = CFG.sfxDir;
const MARKS = join(LIB, 'marks.json');
const PORT = Number(process.env.PORT || 4900);
const DEMOS = join(HERE, '..', 'effects', 'demos');

const marks = () => (existsSync(MARKS) ? JSON.parse(readFileSync(MARKS, 'utf8')) : {});
const PACKS = join(HERE, '..', 'sound-packs.json');
const packs = () => JSON.parse(readFileSync(PACKS, 'utf8'));

function sounds() {
  const peaks = JSON.parse(readFileSync(join(HERE, 'peaks.json'), 'utf8'));
  const [head, ...rows] = readFileSync(join(LIB, 'catalog.csv'), 'utf8').trim().split(/\r?\n/);
  const cols = head.split(',');
  const m = marks();
  return rows.map((line) => {
    const parts = [];
    for (let i = 0, cur = '', q = false; i <= line.length; i++) {
      const c = line[i];
      if (c === undefined || (c === ',' && !q)) { parts.push(cur); cur = ''; }
      else if (c === '"') { if (q && line[i + 1] === '"') { cur += '"'; i++; } else q = !q; }
      else cur += c;
    }
    const r = Object.fromEntries(cols.map((c, i) => [c, parts[i]]));
    const rel = r.file.slice(LIB.length + 1);
    return { id: rel, category: r.category, name: r.name, seconds: Number(r.seconds), peaks: peaks[rel] || [], ...(m[rel] || {}) };
  });
}

const body = (req) => new Promise((ok) => { let s = ''; req.on('data', (c) => (s += c)); req.on('end', () => ok(JSON.parse(s || '{}'))); });
const json = (res, o) => { res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify(o)); };
const safe = (rel) => { const p = sfxPath(rel); return p && existsSync(p) ? p : null; };

createServer(async (req, res) => {
  if (refuseForeign(req, res)) return;
  const url = new URL(req.url, 'http://x');
  if (url.pathname === '/') { res.writeHead(200, { 'content-type': 'text/html' }); return res.end(readFileSync(join(HERE, 'index.html'))); }
  if (url.pathname === '/fx') { res.writeHead(200, { 'content-type': 'text/html' }); return res.end(readFileSync(join(HERE, 'effects.html'))); }
  if (url.pathname === '/api/effects') return json(res, EFFECTS.map((e) => ({ ...e, demo: existsSync(join(DEMOS, `${e.id}.mp4`)) })));
  if (url.pathname.startsWith('/demos/')) {
    const p = normalize(join(DEMOS, decodeURIComponent(url.pathname.slice(7))));
    if (!p.startsWith(DEMOS + '/') || !existsSync(p)) { res.writeHead(404); return res.end(); }
    res.writeHead(200, { 'content-type': p.endsWith('.mp4') ? 'video/mp4' : 'image/jpeg', 'cache-control': 'no-cache' });
    return createReadStream(p).pipe(res);
  }
  if (url.pathname === '/pack') { res.writeHead(200, { 'content-type': 'text/html', 'cache-control': 'no-store' }); return res.end(readFileSync(join(HERE, 'pack.html'))); }
  if (url.pathname === '/api/packs') { const P = packs(), byId = Object.fromEntries(sounds().map((s) => [s.id, s])); for (const pk of Object.values(P.packs)) for (const sl of Object.values(pk.slots)) sl.info = Object.fromEntries(sl.candidates.map((id) => [id, { name: byId[id]?.name, seconds: byId[id]?.seconds, category: byId[id]?.category }])); return json(res, P); }
  if (req.method === 'POST' && url.pathname === '/api/pack') {
    const { pack, slot, id, state } = await body(req), P = packs(), sl = P.packs[pack]?.slots?.[slot];
    if (!sl || !sl.candidates.includes(id) || !['approve', 'reject', 'clear'].includes(state)) return json(res, { ok: false });
    sl.approved = sl.approved.filter((x) => x !== id); sl.rejected = sl.rejected.filter((x) => x !== id);
    if (state === 'approve') sl.approved.push(id); if (state === 'reject') sl.rejected.push(id);
    writeFileSync(PACKS + '.tmp', JSON.stringify(P, null, 1)); renameSync(PACKS + '.tmp', PACKS);
    console.log(`DECISION pack=${pack} slot=${slot} ${state} ${id}`);
    return json(res, { ok: true, slot: sl });
  }
  if (url.pathname === '/api/sounds') return json(res, sounds());
  if (url.pathname.startsWith('/sfx/')) {
    const p = safe(decodeURIComponent(url.pathname.slice(5)));
    if (!p) { res.writeHead(404); return res.end(); }
    const size = statSync(p).size, range = /bytes=(\d*)-(\d*)/.exec(req.headers.range || '');
    if (range) {
      const a = Number(range[1] || 0), b = range[2] ? Number(range[2]) : size - 1;
      res.writeHead(206, { 'content-type': audioType(p), 'accept-ranges': 'bytes', 'content-range': `bytes ${a}-${b}/${size}`, 'content-length': b - a + 1 });
      return createReadStream(p, { start: a, end: b }).pipe(res);
    }
    res.writeHead(200, { 'content-type': audioType(p), 'accept-ranges': 'bytes', 'content-length': size });
    return createReadStream(p).pipe(res);
  }
  if (req.method === 'POST' && url.pathname === '/api/mark') {
    const { id, fav, tags } = await body(req);
    if (!safe(id)) return json(res, { ok: false });
    const m = marks();
    const cur = { ...(m[id] || {}), ...(fav !== undefined && { fav }), ...(tags !== undefined && { tags }) };
    if (!cur.fav) delete cur.fav;
    if (!cur.tags?.length) delete cur.tags;
    if (Object.keys(cur).length) m[id] = cur; else delete m[id];
    writeFileSync(MARKS + '.tmp', JSON.stringify(m, null, 1)); renameSync(MARKS + '.tmp', MARKS);
    return json(res, { ok: true, ...cur });
  }
  if (req.method === 'POST' && url.pathname === '/api/reveal') {
    const p = safe((await body(req)).id);
    if (p) execFile('open', ['-R', p]);
    return json(res, { ok: !!p });
  }
  res.writeHead(404); res.end();
}).listen(PORT, '127.0.0.1', () => console.log(`yapcut library: http://yapcut.localhost:${PORT}/  effects: http://yapcut.localhost:${PORT}/fx`));
