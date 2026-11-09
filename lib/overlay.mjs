// Overlay + at the playhead: draw a concept picture, reuse this video's media, or find a photo / clip for what is said at t.
import { existsSync, mkdirSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { layout } from './edit.mjs';
import { claude } from './personas.mjs';
import { cleanSvg } from './addfx.mjs';
import { secret } from './config.mjs';

const UA = { 'user-agent': 'yapcut/1.0 (+https://github.com/royherma/yapcut)' };
const MEDIA = /\.(png|jpe?g|gif|webp|svg|mp4|mov|m4v|webm)$/i;

function sentenceAt(L, t) {
  const said = L.words.map((w, i) => ({ i, text: w.text, o: L.outAt(w.start + 0.01) })).filter((x) => x.o != null).sort((a, b) => a.o - b.o);
  if (!said.length) throw new Error('nothing is said in this version');
  const k = said.reduce((b, x, j) => (Math.abs(x.o - t) < Math.abs(said[b].o - t) ? j : b), 0), end = (x) => /[.!?]$/.test(x.text);
  let a = k; while (a > 0 && !end(said[a - 1])) a--;
  let b = k; while (b < said.length - 1 && !end(said[b])) b++;
  return { said, line: said.slice(a, b + 1), k };
}

async function download(url, file) {
  const r = await fetch(url, { headers: UA, redirect: 'follow' });
  if (!r.ok) throw new Error(`download ${r.status}`);
  writeFileSync(file, Buffer.from(await r.arrayBuffer()));
  return file;
}

const serpKey = () => secret('SERP_API_KEY');
const tries = (q) => [...new Set([q, q.split(/\s+/).slice(0, 2).join(' '), q.split(/\s+/)[0]])];

async function findPhoto(q, md, stem) {
  const key = serpKey();
  if (!key) throw new Error('photo search needs a SerpAPI key: paste it in Frame check settings');
  for (const qq of tries(q)) for (const lic of ['fmc', '']) {
    const r = await fetch(`https://serpapi.com/search.json?engine=google_images&q=${encodeURIComponent(qq)}${lic ? `&licenses=${lic}` : ''}&api_key=${key}`, { signal: AbortSignal.timeout(30000) });
    const hits = r.ok ? ((await r.json()).images_results ?? []).filter((x) => x.original && (x.original_width ?? 0) >= 800 && x.original_width / (x.original_height || 1) >= 1.1) : [];
    for (const hit of hits.slice(0, 4)) {
      const ext = (hit.original.match(/\.(jpe?g|png|webp)(\?|$)/i)?.[1] || 'jpg').toLowerCase();
      try { return { file: await download(hit.original, join(md, `${stem}.${ext}`)), credit: `${hit.title ?? qq} - ${hit.source ?? ''} ${hit.link ?? ''}${lic ? ' (Google: free to use commercially)' : ' (Google image, check the license before posting)'}` }; } catch {}
    }
  }
  throw new Error(`no photo found for "${q}"`);
}

async function findClip(q, md, stem) {
  let hit;
  for (const qq of tries(q)) {
    const u = `https://commons.wikimedia.org/w/api.php?action=query&generator=search&gsrnamespace=6&gsrsearch=${encodeURIComponent(qq + ' filetype:video')}&gsrlimit=15&prop=videoinfo&viprop=url|size&format=json`;
    const pages = Object.values((await (await fetch(u, { headers: UA, signal: AbortSignal.timeout(30000) })).json()).query?.pages ?? {});
    hit = pages.map((p) => ({ title: p.title, ...(p.videoinfo?.[0] ?? {}) })).find((x) => x.url && (x.width ?? 0) >= 640 && (x.duration ?? 0) >= 3 && (x.size ?? 0) <= 60e6);
    if (hit) break;
  }
  if (!hit) throw new Error(`no clip found for "${q}"`);
  const raw = await download(hit.url, join(md, `${stem}-src${hit.url.match(/\.\w+$/)?.[0] ?? '.webm'}`)), out = join(md, `${stem}.mp4`);
  execFileSync('ffmpeg', ['-v', 'error', '-y', '-ss', String(Math.min(2, hit.duration / 4)), '-i', raw, '-t', '5', '-an', '-vf', 'scale=1080:-2', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', out]);
  rmSync(raw);
  return { file: out, credit: `${hit.title} (Wikimedia Commons) ${hit.descriptionurl ?? ''}` };
}

export async function makeOverlay(dir, md, v, t, mode, ask = '') {
  const L = layout(dir), { said, line } = sentenceAt(L, t), mine = mode === 'mine' && existsSync(md) ? readdirSync(md).filter((f) => MEDIA.test(f) && !/-src\./.test(f)) : [];
  if (mode === 'mine' && !mine.length) throw new Error('this video has no media yet');
  const want = {
    draw: `"svg":"<one self-contained <svg viewBox=\\"0 0 800 460\\" xmlns=\\"http://www.w3.org/2000/svg\\">: flat and bold, white (#fff) and one accent (#ffe63c) on transparent, strokes 6-10 px, Inter font, 1-4 short labels (max 3 words, font-size 40+), no photos, no scripts>","title":"<max 5 words, or empty>"`,
    mine: `"file":"<exactly one of: ${mine.join(', ')}; or none if nothing fits>"`,
    photo: `"query":"<2-4 plain words for a Google image search>"`,
    video: `"query":"<2-3 plain words to search Wikimedia Commons for a short real-world clip>"`,
  }[mode];
  if (!want) throw new Error(`unknown overlay "${mode}"`);
  const e0 = await claude(`You add ONE overlay above the speaker's head in a vertical talking-head Reel (1080x1920), at about ${t.toFixed(1)} s.
The sentence being said, as "wordIndex:word@seconds": ${line.map((x) => `${x.i}:${x.text}@${x.o.toFixed(1)}`).join(' ')}
Whole video for context: ${said.map((x) => x.text).join(' ').slice(0, 2500)}
Creator's direction: ${ask || 'show the idea of this line so a newcomer gets it at a glance, and lead into what comes next'}
Return ONLY JSON: {"at":<wordIndex it appears on>,"to":<wordIndex it leaves after>,"why":"<one line>",${want}}`);
  const idx = new Set(line.map((x) => x.i)), at = idx.has(e0.at) ? e0.at : line[0].i, to = idx.has(e0.to) && e0.to > at ? e0.to : line.at(-1).i;
  const base = { at, to, place: 'above', why: e0.why || `Overlay + at ${t.toFixed(1)} s`, added: `overlay-${mode}` };
  if (mode === 'draw') { const svg = cleanSvg(e0.svg); if (!svg) throw new Error('Claude returned no usable picture'); return { ...base, fx: 'concept-card', svg, title: e0.title || '' }; }
  mkdirSync(md, { recursive: true });
  let file, credit = '';
  if (mode === 'mine') { if (!mine.includes(e0.file)) throw new Error('none of this video\'s media fits this line'); file = join(md, e0.file); }
  else ({ file, credit } = await (mode === 'photo' ? findPhoto : findClip)(String(e0.query || line.map((x) => x.text).join(' ')), md, `ov-${Date.now().toString(36)}`));
  const name = file.split('/').pop();
  return { ...base, fx: 'media-card', kind: /\.(mp4|mov|m4v|webm)$/i.test(name) ? 'video' : 'image', src: `/media/${v}/${name}`, file, name, ...(credit ? { credit } : {}) };
}

export async function drawForLayout(dir, e) {
  const L = layout(dir), i = L.words.findIndex((w, k) => k === e.at), t = i >= 0 ? L.outAt(L.words[i].start + 0.01) ?? 0 : 0, { said, line } = sentenceAt(L, t);
  const r = await claude(`Draw ONE clear picture for the top half of a vertical talking-head Reel (1080x1920). The speaker is below it and the caption already shows his words, so do NOT write the sentence out - show the idea.
The sentence: "${line.map((x) => x.text).join(' ')}"
Whole video for context: ${said.map((x) => x.text).join(' ').slice(0, 2500)}
${e.text ? `The point of THIS card (draw this, not the rest of the sentence): "${e.text}"` : ''}
Return ONLY JSON: {"svg":"<one self-contained <svg viewBox=\\"0 0 1000 700\\" xmlns=\\"http://www.w3.org/2000/svg\\">: drawn on a light card, ink #16161a, one accent #2563eb, optional soft fill #ffe63c, strokes 8-12 px, rounded joins, Inter font, at most 3 labels of max 3 words (font-size 54+), simple icons and arrows, lots of empty space, no photos, no scripts>"}`);
  const svg = cleanSvg(r.svg);
  if (!svg) throw new Error('Claude returned no usable picture');
  return svg;
}
