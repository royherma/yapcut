#!/usr/bin/env node
// Talking-head take in, edited vertical reel out, in the order of RECIPE.md.
import { readFileSync, writeFileSync, existsSync, mkdirSync, copyFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join, resolve, dirname, extname, basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import { transcribe, loadWords } from '../vendor/reelkit/lib/words.mjs';
import { W, H, FPS, SFX_DB, layout, captions, rawOf } from '../lib/edit.mjs';
import { renderEffects, showcase, srcTime } from '../lib/fx.mjs';
import { makePersonas, judgeAll, PERSONAS } from '../lib/personas.mjs';
import { EFFECTS, byId } from '../effects/catalog.mjs';
import { askJSONSync, provider } from '../lib/llm.mjs';
import { transcribe as alignWords } from '../lib/take.mjs';
import { doctor } from '../lib/doctor.mjs';
import { CFG } from '../lib/config.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const FFMPEG = CFG.ffmpeg; // the default ffmpeg build has no libass, so no captions

const [cmd, target, ...rest] = process.argv.slice(2);
const flag = (k, d) => { const i = rest.indexOf(`--${k}`); return i < 0 ? d : rest[i + 1]; };

if (!cmd || cmd === 'help') {
  console.log(`yapcut new <video> [--name n] [--script file] [--no-fx]   transcribe, plan, render -> runs/<name>/out.mp4
yapcut plan <run> [--no-fx]   re-pick title, cuts, zooms, highlights, sounds, effects (Claude Code or Codex) -> plan.json
yapcut preview <group>        versions side by side, rule book, tune loop, grades: http://yapcut-preview.localhost:4901 (runs/<group>/compare.json)
yapcut personas <video> [hook teacher hype minimal]   persona agents cut versions + judge scores all -> runs/<video>/compare.json
yapcut render <run>           full-quality MP4 (minutes): only when the edit is final
yapcut fx                     list the video effects
yapcut fx <run> <effect> <word> [--to word] [--dur s] [--set '{"text":"..."}']   add one effect to plan.json
yapcut fx <run> clear         remove all effects from plan.json
yapcut doctor                 check ffmpeg, Chrome, the AI CLI, word timing
yapcut showcase <run>         every effect back to back on this take -> runs/<run>/showcase.mp4 + effects/demos/`);
  process.exit(0);
}

const runDir = (t) => (existsSync(t) && !extname(t) ? resolve(t) : join(ROOT, 'runs', t));
const noFx = process.argv.includes('--no-fx');

if (cmd === 'doctor') process.exit(doctor() ? 0 : 1);
else if (cmd === 'fx') fxCommand();
else if (cmd === 'showcase') {
  const dir = runDir(target);
  if (!existsSync(join(dir, 'timemap.json'))) render(dir);
  showcase(dir, { raw: rawOf(dir), only: flag('only')?.split(',') });
} else if (cmd === 'new') {
  const src = resolve(target);
  const name = flag('name', basename(src, extname(src)).toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(-40));
  const dir = join(ROOT, 'runs', name);
  mkdirSync(dir, { recursive: true });
  const raw = join(dir, `raw${extname(src).toLowerCase()}`);
  if (!existsSync(raw)) copyFileSync(src, raw);
  const script = flag('script');
  if (script) copyFileSync(resolve(script), join(dir, 'script.txt'));
  step('transcribe'); await alignWords(dir, raw, (m) => console.log(`  ${m}`));
  step('plan'); plan(dir);
  step('render'); render(dir);
} else if (cmd === 'plan') plan(runDir(target));
else if (cmd === 'preview') execFileSync(process.execPath, [join(ROOT, 'preview/server.mjs'), ...[target, ...rest].filter(Boolean)], { stdio: 'inherit' });
else if (cmd === 'personas') personas(target, rest.filter((r) => !r.startsWith('--')));
else if (cmd === 'render') render(runDir(target));
else { console.error(`unknown command: ${cmd}`); process.exit(1); }

function step(s) { console.log(`- ${s}`); }

// Persona agents cut versions of a video, the judge scores every version, compare.json lists them for the preview.
async function personas(video, ids) {
  const runs = join(ROOT, 'runs'), file = join(runs, video, 'compare.json');
  const c = JSON.parse(readFileSync(file, 'utf8'));
  const made = await makePersonas(video, runs, video, ids.length ? ids : Object.keys(PERSONAS));
  for (const m of made) { if (!c.runs.includes(m.run)) c.runs.push(m.run); c.label[m.run] = m.persona.name; }
  c.persona = { ...(c.persona ?? {}), ...Object.fromEntries(made.map((m) => [m.run, { name: m.persona.name, brief: m.persona.brief, style: JSON.parse(readFileSync(join(runs, m.run, 'plan.json'), 'utf8')).style }])) };
  c.judge = { ...c.judge, ...(await judgeAll(runs, c.runs)) };
  writeFileSync(file, JSON.stringify(c, null, 1));
  console.log(`  ${c.runs.length} versions in ${file} - preview: POST /api/run/${video} or "Run again"`);
}

function plan(dir) {
  const words = loadWords(join(dir, 'words.json'));
  const listing = words.map((w, i) => `${i}:${w.text}@${w.start.toFixed(2)}`).join(' ');
  const prompt = `You edit a talking-head Instagram Reel. Words are "index:word@seconds".
${listing}

Return ONLY JSON:
{"title":"<on-screen hook, max 6 words, says why to stay, not a copy of the first line>",
 "subtitle":"<max 6 words or empty>",
 "drop":[[from,to]],      // word index ranges to cut: false starts, fumbles, a line said twice (cut the EARLIER try)
 "highlight":[i],         // punch words: numbers, the payoff word. About one per sentence, never filler words
 "snap":[i],              // quick 1.2 s zoom-in starting on this word. Max one per 4 seconds; first one on the hook line
 "slow":[[from,to]],      // slow push-in across one whole sentence. 1-3 of these, never overlapping a snap
 "sfx":[{"at":i,"sound":"whoosh|pop|ding|boom|click|typing|shutter|scratch|sparkle|riser"}]${noFx ? '' : `,
 "effects":[{"fx":"<effect id>","at":i,"to":i_optional, ...params}]`}}
Rules for sfx: one at word 0 (whoosh), then only where a sound adds meaning (pop on a highlight, ding on a number reveal,
typing on computer talk, scratch on a twist). Max one per 4 seconds. Over-editing is the most common mistake: when unsure, leave it out.${noFx ? '' : `
Effects (each brings its own sound, so no sfx on the same word). id: what it shows (params):
${EFFECTS.map((e) => `- ${e.id}: ${e.what}${Object.keys(e.params).length ? ` (${Object.entries(e.params).map(([k, v]) => `${k}: ${v}`).join('; ')})` : ''}`).join('\n')}
Rules for effects: 3-6 per reel, each one illustrating what is SAID at that word (a list -> checklist with each item's "at"
word index, a number going up -> chart-grow or price-stack, a reveal -> spotlight or vertigo, "comment X" -> comment-cta).
Never two effects within 1.5 s of each other, never on the first 2 seconds, never repeat an effect. Write params in the
speaker's own words, short. "to" ends the effect on that word; omit it to use the default length.`}`;
  let p;
  try {
    p = askJSONSync(prompt);
  } catch (e) {
    console.log(`  AI plan failed (${e.message.split('\n')[0]}); using plain defaults`);
    const nums = words.flatMap((w, i) => (/\d/.test(w.text) ? [i] : []));
    p = { title: words.slice(0, 6).map((w) => w.text).join(' '), subtitle: '', drop: [], highlight: nums, snap: nums.slice(0, 1), slow: [], sfx: [{ at: 0, sound: 'whoosh' }] };
  }
  p.overlays ??= [];
  p.effects = (p.effects ?? []).filter((e) => byId[e.fx]);
  writeFileSync(join(dir, 'plan.json'), JSON.stringify(p, null, 1));
  console.log(`  plan: "${p.title}" | ${p.drop.length} cuts, ${p.highlight.length} highlights, ${p.snap.length} snaps, ${p.slow.length} slow, ${p.sfx.length} sounds, effects: ${p.effects.map((e) => `${e.fx}@${e.at}`).join(' ') || 'none'}`);
  return p;
}

function fxCommand() {
  if (!target) {
    for (const e of EFFECTS) console.log(`${e.id.padEnd(14)} ${e.what}${e.matte ? '  [cut-out]' : ''}${Object.keys(e.params).length ? `\n${' '.repeat(15)}params: ${Object.keys(e.params).join(', ')}` : ''}`);
    return;
  }
  const dir = runDir(target), file = join(dir, 'plan.json');
  const p = JSON.parse(readFileSync(file, 'utf8'));
  const [id, at] = rest;
  if (id === 'clear') p.effects = [];
  else {
    if (!byId[id]) { console.error(`unknown effect "${id}" - run: yapcut fx`); process.exit(1); }
    if (at == null || Number.isNaN(Number(at))) { console.error('give the word index the effect starts on (words.json, 0-based)'); process.exit(1); }
    const e = { fx: id, at: Number(at), ...(flag('to') ? { to: Number(flag('to')) } : {}), ...(flag('dur') ? { dur: Number(flag('dur')) } : {}), ...JSON.parse(flag('set', '{}')) };
    p.effects = [...(p.effects ?? []).filter((x) => !(x.fx === id && x.at === e.at)), e].sort((a, b) => a.at - b.at);
  }
  writeFileSync(file, JSON.stringify(p, null, 1));
  console.log(`  effects: ${p.effects.map((e) => `${e.fx}@${e.at}`).join(' ') || 'none'} -> yapcut render ${basename(dir)}`);
}

function render(dir) {
  const { words, p, pieces, total, outAt, fx, sfx } = layout(dir);
  const raw = rawOf(dir);
  writeFileSync(join(dir, 'captions.ass'), ass(words, p, outAt, total));

  const n = pieces.length;
  const fg = [`[0:v]fps=${FPS},scale=${W * 2}:${H * 2}:force_original_aspect_ratio=increase,crop=${W * 2}:${H * 2},setsar=1,split=${n}${pieces.map((_, k) => `[s${k}]`).join('')}`,
    `[0:a]aresample=48000,asplit=${n}${pieces.map((_, k) => `[r${k}]`).join('')}`];
  pieces.forEach((pc, k) => {
    const frames = Math.max(1, Math.round((pc.e - pc.s) * FPS));
    const z = `${pc.z[0].toFixed(4)}+${(pc.z[1] - pc.z[0]).toFixed(4)}*on/${frames}`;
    // zoompan works on the 2x source so the centered crop moves in half-pixels, not visible 1px jumps.
    fg.push(`[s${k}]trim=start=${pc.s.toFixed(3)}:end=${pc.e.toFixed(3)},setpts=PTS-STARTPTS,zoompan=z='${z}':d=1:x='iw/2-iw/zoom/2':y='ih/2-ih/zoom/2':s=${W}x${H}:fps=${FPS}[v${k}]`);
    fg.push(`[r${k}]atrim=start=${pc.s.toFixed(3)}:end=${pc.e.toFixed(3)},asetpts=PTS-STARTPTS[a${k}]`);
  });
  fg.push(`${pieces.map((_, k) => `[v${k}][a${k}]`).join('')}concat=n=${n}:v=1:a=1[vout][aout]`);
  writeFileSync(join(dir, 'filter.txt'), fg.join(';\n'));
  const base = join(dir, 'base.mp4');
  execFileSync(FFMPEG, ['-v', 'error', '-y', '-i', raw, '-filter_complex_script', join(dir, 'filter.txt'), '-map', '[vout]', '-map', '[aout]',
    '-c:v', 'libx264', '-preset', 'fast', '-crf', '14', '-g', '30', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-b:a', '256k', base], { stdio: 'inherit' });

  writeFileSync(join(dir, 'timemap.json'), JSON.stringify(pieces.map(({ s, e, o }) => ({ s, e, o }))));
  const toSrc = srcTime(pieces);
  const video = fx.length ? renderEffects(dir, { base, raw, fx, total, toSrc }) : base;

  const mix = [`[0:v]ass=${join(dir, 'captions.ass')}[vout]`];
  sfx.forEach((x, k) => mix.push(`[${k + 1}:a]aresample=48000,volume=${SFX_DB}dB,adelay=${Math.round(x.at * 1000)}:all=1[x${k}]`));
  mix.push(sfx.length ? `[0:a]${sfx.map((_, k) => `[x${k}]`).join('')}amix=inputs=${sfx.length + 1}:duration=first:normalize=0[aout]` : '[0:a]anull[aout]');
  writeFileSync(join(dir, 'mix.txt'), mix.join(';\n'));
  const out = join(dir, 'out.mp4');
  execFileSync(FFMPEG, ['-v', 'error', '-y', '-i', video, ...sfx.flatMap((x) => ['-i', x.file]),
    '-filter_complex_script', join(dir, 'mix.txt'), '-map', '[vout]', '-map', '[aout]',
    '-c:v', 'libx264', '-preset', 'medium', '-crf', '19', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-b:a', '192k', '-movflags', '+faststart', out], { stdio: 'inherit' });
  const srcDur = Number(execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', raw]).toString());
  console.log(`  ${srcDur.toFixed(1)}s take -> ${total.toFixed(1)}s reel, ${n} pieces, ${pieces.filter((x) => x.snap).length} snap zooms, ${fx.length} effects, ${sfx.length} sounds`);
  console.log(`  ${out}`);
}

// ASS time is H:MM:SS.cc
function ts(s) { const c = Math.max(0, Math.round(s * 100)); return `${Math.floor(c / 360000)}:${String(Math.floor(c / 6000) % 60).padStart(2, '0')}:${String(Math.floor(c / 100) % 60).padStart(2, '0')}.${String(c % 100).padStart(2, '0')}`; }
function esc(s) { return s.replace(/[{}\\]/g, ''); }

function ass(words, p, outAt, total) {
  const ev = captions(words, p, outAt, total).map((c) => {
    if (c.kind === 'title') return `Dialogue: 1,${ts(c.t0)},${ts(c.t1)},Title,,0,0,0,,{\\pos(${c.x ?? 540},${c.y})\\fad(120,200)}${esc(c.text).replace(/^(.{12,}?)\s/, '$1\\N')}`;
    if (c.kind === 'sub') return `Dialogue: 1,${ts(c.t0)},${ts(c.t1)},Sub,,0,0,0,,{\\pos(${c.x ?? 540},${c.y})\\fad(120,200)}${esc(c.text)}`;
    const style = c.hi && c.text.length <= 11 ? '{\\c&H3CE6FF&\\fs118\\fscx80\\fscy80\\t(0,90,\\fscx100\\fscy100)}' : '{\\fscx88\\fscy88\\t(0,70,\\fscx100\\fscy100)}';
    return `Dialogue: 0,${ts(c.t0)},${ts(c.t1)},Cap,,0,0,0,,{\\pos(540,${c.y})}${style}${esc(c.text)}`;
  });
  return `[Script Info]
ScriptType: v4.00+
PlayResX: ${W}
PlayResY: ${H}
WrapStyle: 0

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Cap,Georgia,92,&H00FFFFFF,&H00FFFFFF,&H64000000,&H78000000,0,0,0,0,100,100,0,0,1,1.5,3,5,60,60,0,1
Style: Title,Georgia,104,&H00FFFFFF,&H00FFFFFF,&H64000000,&H78000000,0,0,0,0,100,100,-1,0,1,1.5,4,5,80,80,0,1
Style: Sub,Georgia,46,&H00FFFFFF,&H00FFFFFF,&H64000000,&H78000000,0,1,0,0,100,100,1,0,1,1,3,5,80,80,0,1

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
${ev.join('\n')}
`;
}
