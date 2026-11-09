// "Add something here": one claude -p call picks an effect (or draws a concept card) for what is said at time t.
import { layout } from './edit.mjs';
import { claude } from './personas.mjs';
import { EFFECTS, USE, byId } from '../effects/catalog.mjs';

const catalog = () => EFFECTS.filter((e) => e.id !== 'media-card').map((e) => `- ${e.id}: ${e.what}. Use when: ${USE[e.id]?.[0] ?? '-'}. Avoid: ${USE[e.id]?.[1] ?? '-'}.${Object.keys(e.params).length ? ` Params: ${Object.entries(e.params).map(([k, v]) => `${k} (${v})`).join('; ')}` : ''}`).join('\n');

export function cleanSvg(s) {
  const m = String(s || '').match(/<svg[\s\S]*<\/svg>/i);
  if (!m) return '';
  return m[0].replace(/<script[\s\S]*?<\/script>/gi, '').replace(/<foreignObject[\s\S]*?<\/foreignObject>/gi, '')
    .replace(/\son\w+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, '').replace(/(href\s*=\s*["'])\s*javascript:[^"']*/gi, '$1#').replace(/<image\b[^>]*>/gi, '');
}

export async function addHere(dir, t, ask = '') {
  const L = layout(dir), said = L.words.map((w, i) => ({ i, text: w.text, o: L.outAt(w.start + 0.01) })).filter((x) => x.o != null).sort((a, b) => a.o - b.o);
  const near = said.filter((x) => x.o >= t - 1.5 && x.o <= t + 6);
  if (!near.length) throw new Error(`nothing is said near ${t.toFixed(1)} s`);
  const have = L.fx.map((e) => `${e.fx} ${e.t0.toFixed(1)}-${(e.t0 + e.dur).toFixed(1)} s`).join(', ') || 'none';
  const prompt = `You add ONE on-screen element to a vertical Instagram Reel (1080x1920, talking head) at about ${t.toFixed(1)} s.
What the speaker says around then, as "wordIndex:word@seconds": ${near.map((x) => `${x.i}:${x.text}@${x.o.toFixed(1)}`).join(' ')}
Whole video for context: ${said.map((x) => x.text).join(' ').slice(0, 2500)}
Creator's direction: ${ask || 'pick what helps a newcomer get this moment fastest'}
Effects already in this edit (do not repeat one, do not overlap their times): ${have}

Effects you can use:
${catalog()}

concept-card is the default for an idea a simple picture explains: a contrast (old vs new, with vs without), a loop, steps, a scale, a before/after number.
Its svg: one self-contained <svg viewBox="0 0 800 460" xmlns="http://www.w3.org/2000/svg">, flat and bold, white (#fff) and one accent (#ffe63c) on transparent,
strokes 6-10 px, Inter font, 1-4 short labels (max 3 words each, font-size 40+), no photos, no scripts, no tiny text.

Return ONLY JSON: {"fx":"<effect id>","at":<wordIndex where it starts>,"to":<wordIndex where it ends, optional>,"why":"<one line: what is said and why this>", ...params}`;
  const e = await claude(prompt);
  if (!byId[e.fx]) throw new Error(`Claude picked an unknown effect "${e.fx}"`);
  if (!near.some((x) => x.i === e.at)) e.at = near.reduce((b, x) => (Math.abs(x.o - t) < Math.abs(b.o - t) ? x : b)).i;
  if (e.to != null && !(e.to > e.at && said.some((x) => x.i === e.to))) delete e.to;
  if (e.fx === 'concept-card') { e.svg = cleanSvg(e.svg); if (!e.svg) throw new Error('Claude returned no usable picture'); }
  e.added = 'you-here';
  return e;
}

// The hook title owns the first 3.2 s; anything added there moves to just after it.
export const afterTitle = (L, t) => (L.p.title && t < 3.2 ? Math.min(3.3, Math.max(0, L.total - 1)) : t);

// Instant add, no LLM: the chosen effect at t, its text params filled from the sentence being said.
export function quickFx(L, t, fx) {
  const cat = byId[fx];
  if (!cat || fx === 'media-card') throw new Error(`unknown effect "${fx}"`);
  const said = L.words.map((w, i) => ({ i, text: w.text, o: L.outAt(w.start + 0.01) })).filter((x) => x.o != null).sort((a, b) => a.o - b.o);
  if (!said.length) throw new Error('nothing is said in this version');
  const k = said.reduce((b, x, j) => (Math.abs(x.o - t) < Math.abs(said[b].o - t) ? j : b), 0), end = (x) => /[.!?]$/.test(x.text);
  let a = k; while (a > 0 && !end(said[a - 1]) && k - a < 6) a--;
  a = Math.max(a, k - 2);
  let b = k; while (b < said.length - 1 && !end(said[b]) && b - a < 6) b++;
  const words = said.slice(a, b + 1).map((x) => x.text.replace(/[,;:]$/, '')), line = words.join(' ').replace(/[.!?]$/, '');
  const chunks = (n) => Array.from({ length: Math.min(n, Math.ceil(words.length / 3)) }, (_, j) => words.slice(j * 3, j * 3 + 3).join(' ').replace(/[.!?]$/, '')).filter(Boolean);
  const e = { fx, at: said[k].i, why: `You added it at ${t.toFixed(1)} s` };
  for (const key of Object.keys(cat.params)) {
    if (['text', 'title', 'prompt'].includes(key)) e[key] = line;
    else if (['items', 'lines', 'labels'].includes(key)) e[key] = chunks(3);
    else if (key === 'word') e[key] = words.reduce((m, w) => (w.length > m.length ? w : m), '').replace(/[.!?]$/, '');
  }
  return e;
}
