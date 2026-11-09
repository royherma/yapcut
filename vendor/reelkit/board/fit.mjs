import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { findPhrase, norm } from '../lib/words.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
export const loadTheme = (name) => JSON.parse(readFileSync(join(HERE, 'themes', `${name}.json`), 'utf8'));
const plain = (s = '') => s.replace(/\[([^\]]+)\]\([^)]+\)/g, '$1');

function wordIndex(words, at, from) {
  if (typeof at === 'number') return Math.max(0, Math.min(words.length - 1, Math.round(at)));
  const k = findPhrase(words, at, from);
  if (k < 0) throw new Error(`beat at "${at}": phrase not found after word ${from}`);
  return k;
}

// "words" entrance: each text word appears when it is spoken, if it is spoken within the next 40 words.
function wordTimes(text, words, idx, lead) {
  let k = idx;
  return plain(text).split(/\s+/).filter(Boolean).map((tok) => {
    const n = norm(tok);
    const hit = words.slice(k, k + 40).findIndex((w) => norm(w.text) === n);
    if (hit < 0) return null;
    k += hit + 1;
    return +(words[k - 1].start - lead).toFixed(3);
  });
}

// faces: yapcut fx-cache/faces.json, face = [x, y, w, h] as 0-1 of the frame; the board takes the taller free span above or below.
export function bandFromFaces(faces, H = 1920) {
  const q = (xs, p) => xs.sort((a, b) => a - b)[Math.floor((xs.length - 1) * p)];
  const f = faces.filter((x) => x.face);
  const top = q(f.map((x) => x.face[1] * H), 0.05), bot = q(f.map((x) => (x.face[1] + x.face[3]) * H), 0.95);
  const above = [180, Math.min(760, top - 40)], below = [Math.max(bot + 50, 900), 1460];
  return above[1] - above[0] >= below[1] - below[0] ? above : below;
}

export function fit(board, words, theme, { faces = null } = {}) {
  let cursor = 0;
  const live = new Map();
  const warnings = [];
  const beats = board.beats.map((b, i) => {
    const idx = wordIndex(words, b.at, cursor);
    cursor = idx;
    const w = words[idx];
    const lead = b.lead ?? theme.leadByKind?.[b.el?.type] ?? theme.lead;
    const t = +Math.max(0, w.start - (i === 0 && idx === 0 ? w.start : lead)).toFixed(3);
    const out = { ...b, idx, word: w.text, wordT: w.start, t, lead };
    if (b.slot && theme.slots?.[b.slot]) out.place = theme.slots[b.slot];
    if (b.do === 'add' && b.el.type === 'text' && b.el.enter === 'words') out.el = { ...b.el, times: wordTimes(b.el.text, words, idx, b.el.wordLead ?? theme.lead) };
    return out;
  });
  beats.sort((a, b) => a.t - b.t);
  const stack = [];
  for (let i = 0; i < beats.length; i++) {
    const b = beats[i];
    if (b.do === 'clear') { const gone = new Set(b.ids || stack); for (let k = stack.length - 1; k >= 0; k--) if (gone.has(stack[k])) stack.splice(k, 1); }
    if (b.do === 'add' && b.col === 'new') stack.length = 0;
    if (b.do !== 'add' || b.beside || b.orbit || b.place || b.el.type === 'stroke') continue;
    if (stack.length >= theme.maxStack) {
      const drop = stack.splice(stack.length > 1 ? 1 : 0, 1)[0];
      beats.splice(i, 0, { do: 'clear', ids: [drop], auto: true, idx: b.idx, word: b.word, wordT: b.wordT, t: b.t });
      warnings.push(`auto-cleared ${drop} at ${b.t.toFixed(1)} s (max ${theme.maxStack} stacked)`);
      i++;
    }
    stack.push(b.id || `_${b.idx}`);
  }
  beats.forEach((b, i) => {
    if (b.do === 'add') live.set(b.id || `_${b.idx}`, b.t);
    if (b.do !== 'clear') return;
    const ids = (b.ids || [...live.keys()]).filter((id) => live.has(id));
    const need = Math.max(b.t, ...ids.map((id) => live.get(id) + theme.minHold));
    const next = beats.slice(i + 1).find((x) => x.do === 'add' || x.do === 'swap');
    const t = +Math.min(need, next ? next.t - 0.05 : need).toFixed(3);
    if (t > b.t) { warnings.push(`clear at ${b.t.toFixed(1)} s held to ${t.toFixed(1)} s (min hold ${theme.minHold} s)`); b.t = t; }
    for (const id of ids) {
      if (b.t - live.get(id) < theme.minHold - 0.01) warnings.push(`${id} held only ${(b.t - live.get(id)).toFixed(2)} s: next beat comes first`);
      live.delete(id);
    }
  });
  const band = board.fixedBand ? [...board.fixedBand] : faces?.length ? bandFromFaces(faces) : [...(board.band || [170, 720])];
  return { theme: theme.name, band, beats, warnings };
}

export function timingTable(fitted) {
  return fitted.beats.map((b) => ({
    t: b.t, word: b.word, wordT: +b.wordT.toFixed(3), offMs: Math.round((b.t - b.wordT) * 1000), leadMs: Math.round((b.lead ?? 0) * 1000), do: b.do,
    what: b.id || b.from && `${b.from}->${b.to}` || b.to || (b.ids || []).join(',') || 'all',
  }));
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const dir = resolve(process.argv[2]);
  const board = JSON.parse(readFileSync(join(dir, 'board.json'), 'utf8'));
  const { words } = JSON.parse(readFileSync(join(dir, 'words.json'), 'utf8'));
  const ff = join(dir, 'faces.json');
  const f = fit(board, words, loadTheme(board.theme), { faces: existsSync(ff) ? JSON.parse(readFileSync(ff, 'utf8')) : null });
  const rows = timingTable(f);
  console.table(rows);
  const worst = Math.max(...rows.filter((r) => r.do !== 'clear').map((r) => Math.abs(r.offMs + r.leadMs)));
  console.log(`${rows.length} beats, worst miss vs intended lead ${worst} ms (limit 150; leads copied from the reference)${f.warnings.length ? `\nwarnings: ${f.warnings.join('; ')}` : ''}`);
  process.exit(worst > 150 ? 1 : 0);
}
