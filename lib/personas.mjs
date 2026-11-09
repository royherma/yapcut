// Editor personas: each one cuts its own version of a take with the AI (lib/llm.mjs) and says why; a separate judge scores
// hook / one idea / ending on what each version actually says. Runs on your own AI plan.
import { askJSON } from './llm.mjs';
import { existsSync, mkdirSync, readFileSync, writeFileSync, symlinkSync, copyFileSync } from 'node:fs';
import { join } from 'node:path';
import { EFFECTS, USE, byId } from '../effects/catalog.mjs';
import { layout } from './edit.mjs';
import { SAFE } from './rules.mjs';
import { FORMATS } from './formats.mjs';
import { OURS } from '../vendor/caption-lab/lib/page.mjs';

export const PERSONAS = {
  hook: { name: 'Hook hunter', brief: 'Make people stop scrolling. Open on the single strongest line of the whole take (reorder with keep). 30-45 s. Every second earns its place. 3-4 effects, snap zooms on punch words.' },
  teacher: { name: 'Teacher', brief: 'Make the idea understood by someone new to it: what it is, why it matters, what to do. 45-60 s. Effects that SHOW the idea (checklist for lists, chart for improvement, glass card for a definition). 4-5 effects, calm pace.' },
  hype: { name: 'Hype editor', brief: 'Maximum energy for a reveal-style reel. 30-50 s. Big effects on the big moments (cut-out effects like vertigo, cover story for the takeaway, zoom-through on topic jumps), a sound on every beat that matters. 5-6 effects.' },
  minimal: { name: 'Minimalist', brief: 'Clean and confident. 25-45 s. Captions and zooms carry it; at most one effect, only if it truly shows something. Let the words land.' },
};

export const claude = (prompt) => askJSON(prompt);

const catalogText = () => EFFECTS.map((e) => `- ${e.id}: ${e.what}. Use when: ${USE[e.id][0]}. Avoid: ${USE[e.id][1]}.${Object.keys(e.params).length ? ` Params: ${Object.entries(e.params).map(([k, v]) => `${k} (${v})`).join('; ')}` : ''}`).join('\n');

export function personaPrompt(persona, words, face) {
  const listing = words.map((w, i) => `${i}:${w.text}@${w.start.toFixed(1)}`).join(' ');
  return `You are the "${persona.name}" editor cutting a vertical Instagram Reel from one raw talking-head take.
Your style: ${persona.brief}

The take, as "index:word@seconds":
${listing}

Frame is 1080x1920. The speaker's face sits in x ${face.x0}-${face.x1}, y ${face.y0}-${face.y1}: no text may cover it.
Instagram covers y < ${SAFE.top}, y > ${SAFE.bottom} and x > ${SAFE.right} (lower half). Captions sit at y 1290. The hook title shows for the first 3 s at titleY (center, default 360 - that is ON the face here, so set titleY below the chin, about ${face.y1 + 150}).

Effects you can use (pick by meaning: an effect must illustrate what is SAID at that word):
${catalogText()}

Caption styles (pick the one that fits your style): ${OURS.filter((o) => !o.group || o.group === 'Active word').map((o) => `${o.id} (${o.note})`).join('; ')}.

Rules: cut false starts, fillers and repeats; keep only full thoughts; end on a full sentence. Effects never in the first 2 s, never within 1.5 s of each other, never the same effect twice. Sounds max one per 4 s. One highlight per sentence at most, never on filler words.

Return ONLY JSON:
{"style":"<2 sentences: why this style fits THIS video>",
 "captionStyle":"<one caption style id>",
 "title":"<hook on screen, max 6 words>", "subtitle":"<max 6 words or empty>", "titleY": <number>,
 "keep":[[from,to]],        // word ranges in PLAY order (you may open on a later line)
 "drop":[[from,to]],        // fumbles inside kept ranges
 "highlight":[i], "snap":[i], "slow":[[from,to]],
 "sfx":[{"at":i,"sound":"whoosh|pop|ding|boom|click|typing|shutter|scratch|sparkle|riser"}],
 "effects":[{"fx":"<id>","at":i,"to":i,"why":"<one line: what is said here and why this effect>", ...params}]}`;
}

export function judgePrompt(v) {
  const f = v.format && FORMATS[v.format], beats = (v.beats ?? []).map((b) => `${b.label} (${b.what}): ${b.kept ? 'kept' : 'MISSING'}`).join('; ');
  return `You judge Instagram Reel edits for a creator. Score this version 0-100 on three things, strictly and comparably:
- hook: would the first 3 seconds (title + first words) stop a scroller?
- clarity: is there ONE clear idea a newcomer gets?
- ending: does it end on a satisfying, complete line${f ? ` - for a ${f.name}, that is the "${f.beats.find((b) => b.last)?.label ?? 'last'}" beat` : ''}?
${f ? `This video is a ${f.name} (${f.what}). Its beats: ${beats}.\n` : ''}Title on screen: "${v.title}"
What is said, in order (${v.total.toFixed(0)} s): ${v.text}
Effects: ${v.fx || 'none'}
Return ONLY JSON: {"hook":n,"clarity":n,"ending":n,"why":"<one line, the main reason>","reasons":{"hook":"<why this number, quote the words>","clarity":"<why>","ending":"<why, quote the last line>"}}`;
}

export async function makePersonas(video, runsDir, base, ids = Object.keys(PERSONAS), log = console.log) {
  const words = JSON.parse(readFileSync(join(runsDir, base, 'words.json'), 'utf8'));
  const face = JSON.parse(readFileSync(join(runsDir, video, 'fx-cache', 'face-zone.json'), 'utf8'));
  const made = await Promise.all(ids.map(async (id) => {
    const persona = PERSONAS[id], run = `${video}-${id}`, dir = join(runsDir, run);
    const t0 = Date.now();
    const p = await claude(personaPrompt(persona, words, face));
    p.effects = (p.effects ?? []).filter((e) => byId[e.fx]);
    p.overlays = [];
    mkdirSync(dir, { recursive: true });
    if (!existsSync(join(dir, 'raw.mp4'))) symlinkSync(join(runsDir, video, 'raw.mp4'), join(dir, 'raw.mp4'));
    copyFileSync(join(runsDir, base, 'words.json'), join(dir, 'words.json'));
    writeFileSync(join(dir, 'plan.json'), JSON.stringify(p, null, 1));
    writeFileSync(join(dir, 'plan.orig.json'), JSON.stringify(p, null, 1));
    log(`${persona.name}: ${p.effects.length} effects, "${p.title}" (${((Date.now() - t0) / 1000).toFixed(0)}s)`);
    return { id, run, persona };
  }));
  return made;
}

export async function judgeAll(runsDir, runs, log = console.log) {
  return Object.fromEntries(await Promise.all(runs.map(async (r) => {
    const L = layout(join(runsDir, r));
    const text = L.words.map((w) => ({ w, o: L.outAt(w.start + 0.01) })).filter((x) => x.o != null).sort((a, b) => a.o - b.o).map((x) => x.w.text).join(' ');
    const j = await claude(judgePrompt({ title: L.p.title, total: L.total, text, fx: L.fx.map((e) => `${e.fx}@${e.t0.toFixed(0)}s`).join(', ') }));
    log(`judge ${r}: hook ${j.hook}, one idea ${j.clarity}, ending ${j.ending}`);
    return [r, j];
  })));
}
