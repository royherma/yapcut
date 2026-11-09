// Jev (TypeSafe) frame check: every frame at 2 fps gets yes/no answers + a face box, grouped into issues with a fix each.
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { request, Agent } from 'node:https';
import { existsSync, readFileSync, appendFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { secret } from './config.mjs';

const URL_ = 'https://api.typesafe.ai/v1/systemone';
const MODEL = 'jev-1.14.0';
export const USD_PER_TOKEN = 0.042 / 1e6;

const keyOf = () => { const key = secret('TYPESAFE_API_KEY'); if (!key) throw new Error('Jev needs a TypeSafe key: paste it in Frame check settings'); return key; };

export const KINDS = {
  text_on_face: { q: "Overlaid words (captions, titles or labels) cover part of the speaker's face or eyes", rule: 'Text over the face', sev: 'bad' },
  card_on_face: { q: "An image, video clip, screenshot or graphic card covers part of the speaker's face", rule: 'Card covers the face', sev: 'bad' },
  hand_face: { q: "A hand covers the speaker's face", rule: 'Hand over the face', sev: 'warn' },
  text_clash: { q: 'Two separate overlaid text blocks or cards overlap or crowd each other', rule: 'Text blocks collide', sev: 'bad' },
  text_cut: { q: 'Overlaid text is cut off at the frame edge, blurred or hard to read', rule: 'Text cut off or unreadable', sev: 'warn' },
  broken: { q: 'The frame looks broken: black, blank, frozen, or an empty graphic card', rule: 'Broken frame', sev: 'bad' },
  face_gone: { q: "The speaker's face is clearly visible and not cut off by the frame edge", rule: 'Face missing or cut off', sev: 'warn', invert: true },
};
const QS = Object.fromEntries([
  ...Object.entries(KINDS).map(([k, x]) => [k === 'face_gone' ? 'face_ok' : k, { type: 'noul', instructions: x.q }]),
  ['face_box', { type: 'box', instructions: "The speaker's face" }],
  ['problem_box', { type: 'box', instructions: 'The overlaid text or graphic that looks most wrong: covering the face, cut off, faded, hard to read, or overlapping other text' }],
]);
const QKEY = MODEL + JSON.stringify(QS);

// Same frame bytes = same answers: re-checks only pay for frames the edit changed. runs/.jev-cache.jsonl
const CACHE = join(dirname(fileURLToPath(import.meta.url)), '..', 'runs', '.jev-cache.jsonl');
let memo = null;
const memoOf = () => (memo ??= new Map(existsSync(CACHE) ? readFileSync(CACHE, 'utf8').split('\n').filter(Boolean).map((l) => { const x = JSON.parse(l); return [x.h, x.a]; }) : []));

export async function ask(jpg) {
  const h = createHash('sha1').update(QKEY).update(jpg).digest('hex'), hit = memoOf().get(h);
  if (hit) return { a: hit, tokens: 0, ms: 0, cached: true };
  const x = await call(jpg);
  memo.set(h, x.a); appendFileSync(CACHE, JSON.stringify({ h, a: x.a }) + '\n');
  return x;
}

// node:https, not fetch: Node 26 fetch ran 58 parallel Jev calls in 13.2 s vs 1.5 s on Node 20.
const agent = new Agent({ keepAlive: true, maxSockets: 32 });
const post = (body) => new Promise((ok, no) => {
  const q = request(URL_, { method: 'POST', agent, headers: { authorization: `Bearer ${keyOf()}`, 'content-type': 'application/json', 'content-length': Buffer.byteLength(body), 'TypeSafe-Danger-Zone-Images': 'true' } }, (r) => {
    let text = ''; r.setEncoding('utf8'); r.on('data', (d) => (text += d)); r.on('end', () => ok({ status: r.statusCode, text, retry: r.headers['retry-after'] }));
  });
  q.on('error', no); q.end(body);
});

async function call(jpg) {
  const body = JSON.stringify({ model: MODEL, state: 'Frame of a vertical talking-head Reel edit: `frame`', assets: { frame: { type: 'image', format: 'jpg', data_base64: jpg.toString('base64') } }, questions: QS });
  for (let a = 0; ; a++) {
    const t0 = Date.now(), r = await post(body);
    if (r.status === 200) { const j = JSON.parse(r.text); return { a: j.answers, tokens: j.usage?.input_tokens ?? 0, ms: Date.now() - t0 }; }
    if (a >= 3 || ![429, 500, 502, 503, 504].includes(r.status)) throw new Error(`Jev ${r.status}: ${r.text.slice(0, 160)}`);
    await new Promise((ok) => setTimeout(ok, 1000 * (+r.retry || a + 1)));
  }
}

const raw = (k, a) => (k === 'face_gone' ? 1 - (a.face_ok?.noul ?? 1) : a[k]?.noul ?? 0);
export const SETTLE = ['text_on_face', 'card_on_face', 'text_clash', 'text_cut'];
const score = (k, f) => (f.settle && SETTLE.includes(k) ? Math.min(raw(k, f.a), raw(k, f.settle)) : raw(k, f.a));
export const flagged = (a, thr = 0.6) => SETTLE.some((k) => raw(k, a) >= thr);
const box = (b) => b && { x: Math.round(b.left * 1080), y: Math.round(b.top * 1920), w: Math.round((b.right - b.left) * 1080), h: Math.round((b.bottom - b.top) * 1920) };
const overlap = (a, b) => Math.max(0, Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x)) * Math.max(0, Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y));

const pieceOf = (x) => `${x.what}:${x.k ?? ''}`;
const shift = (r, dx, dy) => ({ ...r, x: r.x + dx, y: r.y + dy });

// Smallest move that keeps this piece off the face and off other text in EVERY frame it is on screen, or null.
function clearMove(x, all) {
  const on = all.filter((f) => (f.targets ?? []).some((y) => pieceOf(y) === pieceOf(x)));
  const ok = (dx, dy) => on.every((f) => {
    const me = shift(f.targets.find((y) => pieceOf(y) === pieceOf(x)).r, dx, dy);
    if (me.y < 30 || me.y + me.h > 1890 || me.x < 10 || me.x + me.w > 1070) return false;
    if (f.face && overlap(me, f.face) > 0.05 * f.face.w * f.face.h) return false;
    return f.targets.every((y) => pieceOf(y) === pieceOf(x) || overlap(me, y.r) < 0.05 * Math.min(me.w * me.h, y.r.w * y.r.h));
  });
  const dxs = x.what === 'captions' ? [0] : [0, -60, 60, -140, 140];
  for (let d = 20; d <= 1400; d += 20) for (const dy of [d, -d]) for (const dx of dxs) if (ok(dx, dy)) return { dx, dy };
  return null;
}
const moveText = (x, m, why) => `Move the ${x.label} ${[m.dy ? `${Math.abs(m.dy)} px ${m.dy > 0 ? 'down' : 'up'}` : '', m.dx ? `${Math.abs(m.dx)} px ${m.dx > 0 ? 'right' : 'left'}` : ''].filter(Boolean).join(', ')}, ${why}`;

// Visual fix for any piece on screen (captions, hook title, effect card, overlay): find the piece at fault, find a clear spot.
function fixFor(kind, w, all) {
  const T = w.targets ?? [], area = (r) => r.w * r.h;
  let cands = [];
  if ((kind === 'text_on_face' || kind === 'card_on_face') && w.face) cands = T.filter((x) => (x.what === 'fx') === (kind === 'card_on_face') && overlap(x.r, w.face) > 0.1 * area(w.face)).sort((p, q) => overlap(q.r, w.face) - overlap(p.r, w.face));
  if ((kind === 'text_on_face' || kind === 'card_on_face') && w.face && !cands.length) {
    const gap = (r) => Math.max(0, r.y - (w.face.y + w.face.h), w.face.y - (r.y + r.h));
    cands = T.filter((x) => (x.what === 'fx') === (kind === 'card_on_face') && gap(x.r) < 200).sort((p, q) => gap(p.r) - gap(q.r));
  }
  if (kind === 'text_clash') for (const a of T) for (const b of T) if (a !== b && area(a.r) <= area(b.r) && overlap(a.r, b.r) > 0) cands.push(a, b);
  if (kind === 'text_cut') cands = T.filter((x) => x.r.x < 0 || x.r.x + x.r.w > 1080 || x.r.y < 0 || x.r.y + x.r.h > 1920);
  const why = { text_on_face: 'clear of the face', card_on_face: 'clear of the face', text_clash: 'so it stops overlapping the other text', text_cut: 'back inside the frame' }[kind];
  for (const x of cands) {
    const m = clearMove(x, all);
    if (m) return { type: 'move', text: moveText(x, m, why), move: { what: x.what, k: x.k, dx: m.dx, dy: m.dy, label: x.label }, target: x };
  }
  const ask = {
    text_on_face: 'Move the text off the face',
    card_on_face: 'Move, shrink or re-time the card so the face shows',
    hand_face: 'Tighter crop or a cut here so the hand is out of frame',
    text_clash: 'Space the two text blocks apart in time or position',
    text_cut: 'Shrink or re-wrap the text so it sits inside the frame',
    broken: 'Look at this frame: re-time or drop the card that leaves it blank',
    face_gone: 'Re-frame the zoom so the whole face is in shot',
  }[kind];
  return { type: 'claude', text: ask, target: cands[0] };
}

// frames: [{n, t, a, targets}] sorted by t. A run of flagged frames (gaps of one frame allowed) is one issue.
export function issuesOf(frames, thr = 0.6) {
  const out = [];
  for (const kind of Object.keys(KINDS)) {
    let cur = null, gap = 0;
    const close = () => { if (cur) out.push(cur); cur = null; };
    for (const f of frames) {
      const s = score(kind, f);
      if (s >= thr) {
        if (!cur) cur = { kind, rule: KINDS[kind].rule, sev: KINDS[kind].sev, t0: f.t, t1: f.t, frames: [], worst: f, p: s };
        cur.t1 = f.t; cur.frames.push(f.n); if (s > cur.p) { cur.p = s; cur.worst = f; }
        gap = 0;
      } else if (cur && ++gap > 1) close();
    }
    close();
  }
  return out.sort((a, b) => a.t0 - b.t0).map((x, i) => {
    const w = x.worst, fix = fixFor(x.kind, w, frames);
    return { id: `jev-${x.kind}-${x.t0.toFixed(1)}`, kind: x.kind, rule: x.rule, sev: x.sev, t0: x.t0, t1: x.t1, t: w.t, n: w.n, frames: x.frames.length, p: +x.p.toFixed(2), face: w.face, targets: (w.targets ?? []).map((x) => ({ label: x.label, r: x.r })), ns: x.frames, target: fix.target?.r ?? ((w.a.problem_box?.confidence ?? 0) >= 0.2 ? box(w.a.problem_box.box) : null), fix: { type: fix.type, text: fix.text, move: fix.move ?? null } };
  });
}

export const faceOf = (a) => ((a.face_box?.confidence ?? 0) >= 0.3 ? box(a.face_box.box) : null);
