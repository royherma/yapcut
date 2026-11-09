import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildCues, settle } from './cues.mjs';

export const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
export const SOUNDTRACK = join(ROOT, '..', 'soundtrack', 'work');
export const W = 1080, H = 1920;
export const FFMPEG = existsSync('/opt/homebrew/opt/ffmpeg@7/bin/ffmpeg') ? '/opt/homebrew/opt/ffmpeg@7/bin/ffmpeg' : 'ffmpeg';

export const workDir = (slug) => join(ROOT, 'work', slug);

export function clips() {
  const out = new Map();
  if (existsSync(SOUNDTRACK)) for (const d of readdirSync(SOUNDTRACK)) {
    const f = join(SOUNDTRACK, d, 'speech.json');
    if (existsSync(f)) { const s = JSON.parse(readFileSync(f, 'utf8')); if (s.video && existsSync(s.video)) out.set(d, { slug: d, title: s.title ?? d, seconds: s.seconds, at: statSync(f).mtimeMs }); }
  }
  return [...out.values()].sort((a, b) => (b.at ?? 0) - (a.at ?? 0));
}

const QWEN_PY = join(homedir(), '.cache/qwen-align-venv/bin/python');
const UVX = join(homedir(), '.local/bin/uvx');

/** Parakeet text (verbatim, punctuated) timed by Qwen3-ForcedAligner (bin/qwen_align.py). Cached in work/<slug>/words.json. */
export function alignedWords(slug, video) {
  const dir = workDir(slug), out = join(dir, 'words.json');
  if (!existsSync(out)) {
    const asr = join(dir, 'asr'), wav = join(asr, 'voice.wav');
    mkdirSync(asr, { recursive: true });
    execFileSync(FFMPEG, ['-v', 'error', '-i', video, '-vn', '-af', 'aresample=async=1:first_pts=0', '-ac', '1', '-ar', '16000', '-y', wav]);
    execFileSync(UVX, ['--python', '3.12', 'parakeet-mlx@0.7.0', wav, '--output-format', 'json', '--output-dir', join(asr, 'parakeet')], { stdio: 'ignore' });
    execFileSync(QWEN_PY, ['-I', join(ROOT, 'bin/qwen_align.py'), wav, join(asr, 'parakeet/voice.json'), out], { stdio: 'ignore' });
  }
  const d = JSON.parse(readFileSync(out, 'utf8')), fixed = applyGlossary(d.words);
  if (fixed.edits.length) { d.words = fixed.words; d.edits = [...(d.edits ?? []), ...fixed.edits]; writeFileSync(out, JSON.stringify(d, null, 1)); }
  return d.words;
}

const GLOSSARY = [
  [['clawed', 'code'], ['Claude', 'Code']], [['clawd', 'code'], ['Claude', 'Code']], [['cloud', 'code'], ['Claude', 'Code']],
  [['clawed'], ['Claude']], [['clawd'], ['Claude']],
  [['chat', 'gpt'], ['ChatGPT']], [['chat', 'gbt'], ['ChatGPT']], [['chatgpt'], ['ChatGPT']],
  [['open', 'ai'], ['OpenAI']],
  [['coraps'], ['Corax']], [['korax'], ['Corax']],
];

/** Product names speech models mishear, fixed in place; a merged word spans the time of the words it replaces. */
export function applyGlossary(words) {
  const out = [], edits = [], bare = (w) => w.toLowerCase().replace(/[^a-z0-9']/g, '');
  for (let i = 0; i < words.length;) {
    const hit = GLOSSARY.find(([from]) => from.every((b, k) => words[i + k] && bare(words[i + k].text) === b));
    if (!hit) { out.push(words[i++]); continue; }
    const [from, to] = hit, src = words.slice(i, i + from.length), tail = src.at(-1).text.match(/[^\w']+$/)?.[0] ?? '';
    const next = to.map((t, k) => ({ ...src[0], text: t + (k === to.length - 1 ? tail : ''), start: (src[k] ?? src[0]).start, end: (to.length === src.length ? src[k] : src.at(-1)).end }));
    if (next.map((w) => w.text).join(' ') !== src.map((w) => w.text).join(' ')) edits.push(`${src[0].start.toFixed(2)} s: ${src.map((w) => w.text).join(' ')} -> ${next.map((w) => w.text).join(' ')} (glossary)`);
    out.push(...next);
    i += from.length;
  }
  return { words: out, edits };
}

/** Hand fix of one word in work/<slug>/words.json; empty text deletes it. Logged in `edits`. */
export function setWord(slug, i, text) {
  const f = join(workDir(slug), 'words.json'), d = JSON.parse(readFileSync(f, 'utf8')), w = d.words[i];
  if (!w) throw new Error(`no word ${i}`);
  const clean = String(text ?? '').replace(/[<>]/g, '').replace(/\s+/g, ' ').trim().slice(0, 40);
  d.edits = [...(d.edits ?? []), `${w.start.toFixed(2)} s: ${w.text} -> ${clean || '(deleted)'}`];
  if (clean) w.text = clean; else d.words.splice(i, 1);
  writeFileSync(f, JSON.stringify(d, null, 1));
  return d.words;
}

export function fresh(slug) {
  const s = JSON.parse(readFileSync(join(SOUNDTRACK, slug, 'speech.json'), 'utf8'));
  const words = alignedWords(slug, s.video);
  return { slug, title: s.title ?? slug, video: s.video, duration: s.seconds, width: W, height: H, anchorY: 0.62, style: null, words, cues: buildCues(words) };
}

const prefsFile = (slug) => join(workDir(slug), 'lab.json');

export function loadLab(slug) {
  const lab = fresh(slug), f = prefsFile(slug);
  if (existsSync(f)) { const p = JSON.parse(readFileSync(f, 'utf8')); lab.anchorY = p.anchorY ?? lab.anchorY; lab.style = p.style ?? null; lab.headline = p.headline ?? ''; lab.speed = p.speed ?? 1; }
  return lab;
}

export function saveLab(lab) {
  mkdirSync(workDir(lab.slug), { recursive: true });
  writeFileSync(prefsFile(lab.slug), JSON.stringify({ anchorY: lab.anchorY, style: lab.style, headline: lab.headline || undefined, speed: lab.speed && lab.speed !== 1 ? lab.speed : undefined }, null, 1));
}

export function clData(lab) {
  return { duration: lab.duration, width: lab.width, height: lab.height, anchorY: lab.anchorY, headline: lab.headline || '', speed: lab.speed || 1, words: lab.words, cues: settle(lab.cues, lab.duration) };
}

export function frame(lab, t) {
  const dir = join(workDir(lab.slug), 'frames');
  const f = join(dir, `${(+t).toFixed(2)}.jpg`);
  if (!existsSync(f)) {
    mkdirSync(dir, { recursive: true });
    execFileSync(FFMPEG, ['-v', 'error', '-ss', String(t), '-i', lab.video, '-frames:v', '1', '-vf', `scale=${W}:${H}`, '-q:v', '3', '-y', f]);
  }
  return f;
}
