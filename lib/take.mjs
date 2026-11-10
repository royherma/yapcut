// A new yap, end to end before the preview pipeline: word-accurate transcript, then one `claude -p` ideas call (cuts per
// length + effect pool + highlights) and a judge score per cut. $0 cash (your own AI plan).
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { spawn, spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { EFFECTS, USE } from '../effects/catalog.mjs';
import { claude, judgePrompt } from './personas.mjs';
import { SAFE } from './rules.mjs';
import { FORMATS, formatList, wordRanges, repairCut, beatsKept } from './formats.mjs';
import { CFG } from './config.mjs';

const FFMPEG = CFG.ffmpeg, CL = CFG.captionLab;
const FFPROBE = CFG.ffprobe, QWEN_PY = CFG.alignPython, UVX = CFG.uvx;

const probe = (f, entries, streams = []) => spawnSync(FFPROBE, ['-v', 'error', ...streams, '-show_entries', entries, '-of', 'csv=p=0', f], { encoding: 'utf8' }).stdout;
// Seconds the audio stream starts after the video (PhoneCam .mov: 1.57 s). Unpadded, every word lands that much early.
export function audioLead(raw) {
  const out = probe(raw, 'stream=codec_type,start_time');
  const at = (kind) => +(out.match(new RegExp(`^${kind},([\\d.]+)`, 'm'))?.[1] ?? 0);
  return /^video,/m.test(out) ? at('audio') - at('video') : 0;
}

// onPct gets each "NN%" the tool prints (parakeet's bar).
const run = (cmd, args, onPct) => new Promise((ok, fail) => {
  const p = spawn(cmd, args, { stdio: ['ignore', 'pipe', 'pipe'] });
  let err = '', last = -1;
  const scan = (d) => { const m = [...String(d).matchAll(/(\d{1,3}(?:\.\d+)?)%/g)].at(-1); const v = m && Math.floor(+m[1]); if (onPct && v != null && v !== last && v <= 100) { last = v; onPct(v); } };
  p.on('error', fail);
  p.stdout.on('data', scan);
  p.stderr.on('data', (d) => { err = (err + d).slice(-600); scan(d); });
  p.on('close', (code) => (code ? fail(new Error(`${cmd.split('/').pop()} exit ${code}: ${err.trim().split('\n').at(-1)}`)) : ok()));
});

// Parakeet text + Qwen3-ForcedAligner timing (caption-lab/bin/qwen_align.py) -> <dir>/words.json as [{text, start, end}].
// A take voiced by our own TTS (HeyGen) ships its exact times as <dir>/tts-words.json; that wins over aligning.
export async function transcribe(dir, raw, log = () => {}) {
  const out = join(dir, 'words.json'), meta = join(dir, 'words.meta.json'), lead = audioLead(raw);
  if (existsSync(out)) {
    if (Math.abs(lead) > 0.02 && !existsSync(meta)) log(`WARNING audio starts ${lead.toFixed(2)} s after the video and words.json predates the pad check: words may be ${lead.toFixed(2)} s early. Delete words.json to re-time.`);
    return JSON.parse(readFileSync(out, 'utf8'));
  }
  const tts = join(dir, 'tts-words.json');
  if (existsSync(tts)) {
    const wav = join(dir, 'asr', 'voice.wav');
    mkdirSync(join(dir, 'asr'), { recursive: true });
    if (!existsSync(wav)) await run(FFMPEG, ['-v', 'error', '-i', raw, '-vn', '-af', 'aresample=async=1:first_pts=0', '-ac', '1', '-ar', '16000', '-y', wav]);
    const words = endsToSilence(JSON.parse(readFileSync(tts, 'utf8')), wav);
    writeFileSync(out, JSON.stringify(words)); log('tts word times'); return words;
  }
  const asr = join(dir, 'asr'), wav = join(asr, 'voice.wav'), aligned = join(asr, 'aligned.json');
  mkdirSync(asr, { recursive: true });
  await run(FFMPEG, ['-v', 'error', '-i', raw, '-vn', '-af', 'aresample=async=1:first_pts=0', '-ac', '1', '-ar', '16000', '-y', wav]);
  const [aStart, aDur] = probe(raw, 'stream=start_time,duration', ['-select_streams', 'a:0']).trim().split(',').map(Number), wavDur = +probe(wav, 'format=duration');
  if (lead > 0.02 && !(Math.abs(wavDur - (aStart + aDur)) <= 0.1)) throw new Error(`voice.wav is ${wavDur.toFixed(2)} s but the audio ends at ${(aStart + aDur).toFixed(2)} s: the ${lead.toFixed(2)} s lead was not padded, every word would land early`);
  log('parakeet');
  await run(UVX, ['--python', '3.12', 'parakeet-mlx@0.7.0', wav, '--output-format', 'json', '--output-dir', join(asr, 'parakeet')], (v) => log(`parakeet ${v}%`));
  log('align');
  await run(QWEN_PY, ['-I', join(CL, 'bin/qwen_align.py'), wav, join(asr, 'parakeet/voice.json'), aligned]);
  const words = endsToSilence(JSON.parse(readFileSync(aligned, 'utf8')).words, wav);
  writeFileSync(out, JSON.stringify(words));
  writeFileSync(meta, JSON.stringify({ aligner: 'qwen3-forced-aligner-0.6b', audioLead: +lead.toFixed(3), wavDur, made: new Date().toISOString() }));
  return words;
}

// A word before a pause ends where the voice goes quiet, not where the timer says: WhisperX gives "21%" ~0.15 s of a 1 s
// number and TTS times end 0.1-0.3 s early, and the cut step trims anything past `end` as silence.
export function endsToSilence(words, wav) {
  const log = spawnSync(FFMPEG, ['-hide_banner', '-i', wav, '-af', 'silencedetect=noise=-38dB:d=0.15', '-f', 'null', '-'], { encoding: 'utf8' }).stderr;
  const quiet = [...log.matchAll(/silence_start: ([\d.]+)/g)].map((m) => +m[1]);
  return words.map((w, i) => {
    const next = words[i + 1]?.start ?? Infinity;
    if (next - w.end < 0.25) return w;
    const hush = quiet.find((t) => t > w.end - 0.05) ?? next, end = Math.max(w.end, Math.min(hush, next - 0.02));
    return Number.isFinite(end) ? { ...w, end: +end.toFixed(3) } : w;
  });
}

const catalogText = () => EFFECTS.map((e) => `- ${e.id}: ${e.what}. Use when: ${USE[e.id][0]}. Avoid: ${USE[e.id][1]}.${Object.keys(e.params).length ? ` Params: ${Object.entries(e.params).map(([k, v]) => `${k} (${v})`).join('; ')}` : ''}`).join('\n');

export function ideasPrompt(words, face, total, script = '') {
  const listing = words.map((w, i) => `${i}:${w.text}@${w.start.toFixed(1)}`).join(' ');
  return `You prepare one raw talking-head take for a set of vertical Instagram Reel edits. Other code turns your answer into
clean / light / medium / heavy edits at every length, so give the raw material, not one edit.

The take (${total.toFixed(0)} s), as "index:word@seconds":
${listing}

Frame 1080x1920. Face in x ${face.x0}-${face.x1}, y ${face.y0}-${face.y1}. Instagram covers y < ${SAFE.top}, y > ${SAFE.bottom}, x > ${SAFE.right} (lower half).

${script ? `The creator's own script for this take (use it to choose what to keep, in this order where possible):\n${script.slice(0, 6000)}\n\n` : ''}Effects (pick by meaning: an effect must illustrate what is SAID at its word):
${catalogText()}

Video formats (pick the ONE this take is; it decides which beats every cut must keep):
${formatList()}

Return ONLY JSON. Every range is [from,to] WORD INDEXES (the number before the colon), never seconds:
{"format": "<format id>", "formatWhy": "<one line: why this take is that format>",
 "beats": {"<beat id>": [[from,to]], ...},   // where each beat of that format is said in the take, every beat id of the format
 "cuts": {
   "full": {"keep":[[from,to]], "drop":[[from,to]], "title":"<hook, max 6 words>", "subtitle":"<max 6 words or empty>"},
   "60":   {... the strongest 40-60 s; keep ranges are in PLAY order, you may open on a later, stronger line ...} or null if the take is under 45 s,
   "30":   {... the strongest 20-30 s, one idea ...} or null if the take is under 25 s },
 "effects": [{"fx":"<id>","at":i,"to":i,"why":"<what is said here and why this effect>", ...params}],
 "highlight": [i],
 "snap": [i]}
Rules: every cut drops false starts, fillers, repeats and fumbles, keeps only full thoughts and whole sentences.
Every cut, at every length, keeps every needed beat of the format (a short version of it is fine) and ENDS inside the beat marked "the cut ends here" - a 30 s cut is the same shape, just tighter.
effects: 8-14 candidates spread over the whole take, never in the first 2 s, all different moments; fill every param with real text from the take.
highlight: the one payoff word of each sentence (never a filler word). snap: 10-20 punch words worth a quick zoom.`;
}

export async function makeIdeas(dir, words, face, total, log = () => {}, script = '') {
  const file = join(dir, 'ideas.json');
  if (existsSync(file)) return JSON.parse(readFileSync(file, 'utf8'));
  const t0 = Date.now(), ideas = await claude(ideasPrompt(words, face, total, script));
  for (const k of Object.keys(ideas.cuts)) if (!ideas.cuts[k]?.keep?.length) delete ideas.cuts[k];
  if (!FORMATS[ideas.format]) { log(`unknown format "${ideas.format}" - no beat checks`); ideas.format = null; }
  ideas.beats = Object.fromEntries(Object.entries(ideas.beats ?? {}).map(([k, r]) => [k, wordRanges(Array.isArray(r[0]) ? r : [r], words)]));
  for (const cut of Object.values(ideas.cuts)) for (const k of ['keep', 'drop']) cut[k] = wordRanges(cut[k] ?? [], words);
  log(`ideas ${((Date.now() - t0) / 1000).toFixed(0)} s: ${FORMATS[ideas.format]?.name ?? 'no format'}, ${Object.keys(ideas.cuts).join('/')} cuts, ${ideas.effects?.length ?? 0} effect ideas`);
  const order = ['full', '60', '30'].filter((k) => ideas.cuts[k]);
  order.forEach((len, k) => {
    const cut = ideas.cuts[len], donor = k ? { ...ideas.cuts[order[k - 1]], name: order[k - 1] === 'full' ? 'full' : `${order[k - 1]} s` } : null;
    cut.repairs = repairCut(cut, words, ideas.format, ideas.beats, len === 'full' ? [] : ideas.cuts.full?.drop ?? [], donor);
    if (cut.repairs.length) log(`${len} cut: ${cut.repairs.join('; ')}`);
  });
  await Promise.all(Object.values(ideas.cuts).map(async (cut) => {
    const dropped = new Set((cut.drop ?? []).flatMap(([a, b]) => Array.from({ length: b - a + 1 }, (_, k) => a + k)));
    const kept = cut.keep.flatMap(([a, b]) => Array.from({ length: b - a + 1 }, (_, k) => a + k)).filter((i) => words[i] && !dropped.has(i));
    const secs = kept.reduce((s, i) => s + words[i].end - words[i].start + 0.12, 0);
    cut.judge = await claude(judgePrompt({ title: cut.title, total: secs, text: kept.map((i) => words[i].text).join(' '), fx: '', format: ideas.format, beats: beatsKept(ideas.format, ideas.beats, kept) }));
  }));
  writeFileSync(file, JSON.stringify(ideas, null, 1));
  return ideas;
}
