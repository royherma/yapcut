// Copy a style: a link to a video you like -> the closest YapCut looks (captions, hook, theme, edit level), each with its reason.
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { CFG } from './config.mjs';
import { askText } from './llm.mjs';

export const HOOKS = [
  ['fly', 'big caps, each line flies in from a different side'], ['ali', 'camera drops, words light up as they are said, gold/blue keywords'],
  ['pill', 'title in rounded pill boxes that pop in'], ['kinetic', 'words slam in one by one, big caps'], ['tiktok', 'white text with a black outline'],
  ['snap', 'grey see-through bar across the frame'], ['strip', 'white band from the top edge'], ['post', 'hook shown as an X post card'],
  ['bold', 'heavy outlined title that pops in'], ['stamp', 'title stamps in'], ['serif', 'calm serif title, no animation'],
];
export const LEVELS = [
  ['clean', 'just the cut: fumbles and pauses out, nothing added'], ['light', 'a few zooms and sounds, rare effects'],
  ['medium', 'highlights, a zoom every ~6 s, 2-3 effects'], ['heavy', 'every beat edited: zooms every ~3.5 s, effects wherever one fits, sounds on big moments'],
];

const FFMPEG = CFG.ffmpeg, FFPROBE = CFG.ffprobe;
const slugOf = (url) => createHash('sha1').update(url.trim()).digest('hex').slice(0, 10);
const run = (bin, args, opts = {}) => execFileSync(bin, args, { encoding: 'utf8', maxBuffer: 1 << 26, ...opts });

function download(url, dir) {
  const have = existsSync(dir) && readdirSync(dir).find((f) => /^ref\.(mp4|mkv|webm|mov)$/.test(f));
  if (have) return join(dir, have);
  run(CFG.uvx, ['yt-dlp', '-q', '--no-playlist', '--match-filter', 'duration<=?240', '-f', 'bv*[height<=1920][ext=mp4]+ba[ext=m4a]/b[ext=mp4]/b',
    '--merge-output-format', 'mp4', '--ffmpeg-location', dirname(FFMPEG), '--write-info-json', '-o', join(dir, 'ref.%(ext)s'), url], { timeout: 240000 });
  const f = readdirSync(dir).find((x) => /^ref\.(mp4|mkv|webm|mov)$/.test(x));
  if (!f) throw new Error('could not download that link (private, too long over 4 min, or not a video page)');
  return join(dir, f);
}

function measure(file, dir) {
  const secs = +run(FFPROBE, ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', file]).trim();
  const [w, h] = run(FFPROBE, ['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=width,height', '-of', 'csv=p=0', file]).trim().split(',').map(Number);
  const scan = execFileSync(FFMPEG, ['-hide_banner', '-nostats', '-i', file, '-vf', "select='gt(scene,0.3)',metadata=print:file=-", '-an', '-f', 'null', '-'], { encoding: 'utf8', maxBuffer: 1 << 26, stdio: ['ignore', 'pipe', 'ignore'] });
  const cuts = (scan.match(/pts_time/g) || []).length;
  const sheet = join(dir, 'sheet.jpg'), span = Math.min(secs, 60);
  execFileSync(FFMPEG, ['-v', 'error', '-y', '-t', String(span), '-i', file, '-vf', `fps=${(12 / span).toFixed(4)},scale=360:-2,tile=4x3`, '-frames:v', '1', '-q:v', '3', sheet]);
  return { secs: +secs.toFixed(1), w, h, cuts, cutsPerMin: +(cuts / (secs / 60)).toFixed(1), sheet };
}

const pick = (id, ok, dflt) => (ok.includes(id) ? id : dflt);

export async function copyStyle(url, { root, captionStyles, themes, say = () => {} }) {
  if (!/^https?:\/\//.test(url)) throw new Error('paste a full link that starts with https://');
  const id = slugOf(url), dir = join(root, 'styles', id);
  mkdirSync(dir, { recursive: true });
  const done = join(dir, 'style.json');
  if (existsSync(done)) return JSON.parse(readFileSync(done, 'utf8'));
  say('downloading the video');
  const file = download(url, dir);
  let info = {};
  try { info = JSON.parse(readFileSync(join(dir, 'ref.info.json'), 'utf8')); } catch {}
  say('measuring cuts and frames');
  const m = measure(file, dir);
  say('matching it to YapCut looks');
  const list = (rows) => rows.map(([k, d]) => `- ${k}: ${d}`).join('\n');
  const prompt = `You match a short vertical video's editing style to the closest settings of a video editor.
Read the image ${m.sheet}: 12 frames from the first ${Math.min(m.secs, 60).toFixed(0)} s of the video, left to right, top to bottom.
Measured: ${m.secs} s long, ${m.w}x${m.h}, ${m.cuts} picture changes (${m.cutsPerMin} per minute). Title: ${JSON.stringify(info.title || '')}. Creator: ${JSON.stringify(info.uploader || '')}.

Pick ONE id from each list.
Caption styles:
${list(captionStyles.map((s) => [s.id, s.title]))}
- none: no captions
Hook title looks (the big title in the first seconds):
${list(HOOKS)}
Themes (colors for cards and effects):
${list(themes.map((t) => [t.id, t.name || t.title || t.id]))}
Edit level:
${list(LEVELS)}

Answer with JSON only, no prose around it:
{"summary": "<one plain sentence: what makes this video's look>", "captionStyle": "<id>", "titleStyle": "<id>", "theme": "<id>", "level": "<id>",
 "why": {"captionStyle": "<what you saw in the frames, short>", "titleStyle": "<short>", "theme": "<short>", "level": "<short, use the cuts per minute>"}}`;
  const text = await askText(prompt, { images: [m.sheet] });
  const j = JSON.parse(text.slice(text.indexOf('{'), text.lastIndexOf('}') + 1));
  const capIds = [...captionStyles.map((s) => s.id), 'none'];
  const style = {
    id, url, title: info.title || url, creator: info.uploader || '', made: new Date().toISOString(), measured: { ...m, sheet: 'sheet.jpg' },
    summary: j.summary || '',
    captionStyle: pick(j.captionStyle, capIds, capIds[0]), titleStyle: pick(j.titleStyle, HOOKS.map((h) => h[0]), 'bold'),
    theme: pick(j.theme, themes.map((t) => t.id), themes[0]?.id), level: pick(j.level, LEVELS.map((l) => l[0]), 'medium'), why: j.why || {},
  };
  writeFileSync(done, JSON.stringify(style, null, 1));
  return style;
}

export function applyStyle(style, runDirs) {
  for (const d of runDirs) {
    const f = join(d, 'plan.json');
    if (!existsSync(f)) continue;
    const p = JSON.parse(readFileSync(f, 'utf8'));
    Object.assign(p, { captionStyle: style.captionStyle, titleStyle: style.titleStyle, theme: style.theme, copiedStyle: style.id });
    writeFileSync(f, JSON.stringify(p, null, 1));
  }
}
