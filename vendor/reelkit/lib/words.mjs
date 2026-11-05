import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { homedir } from 'node:os';
import { join } from 'node:path';

const WHISPER_MODEL = process.env.REELKIT_WHISPER_MODEL || join(homedir(), '.cache/whisper/ggml-large-v3-turbo.bin');

export const norm = (s) => s.toLowerCase().replace(/[^a-z0-9$+]/g, '');

const WHISPERX = join(homedir(), '.cache/whisperx-venv/bin/whisperx');

// Writes <dir>/words.json as [{text,start,end}]. WhisperX force-aligns words to the audio;
// whisper-cli word times run ~0.4s early, so it is only the fallback.
export function transcribe(audioPath, dir) {
  const wav = join(dir, 'voice.16k.wav');
  execFileSync('ffmpeg', ['-v', 'error', '-y', '-i', audioPath, '-ar', '16000', '-ac', '1', wav]);
  let words = null;
  if (existsSync(WHISPERX)) {
    try { execFileSync(WHISPERX, [wav, '--model', 'small.en', '--language', 'en', '--compute_type', 'int8', '--output_format', 'json', '--output_dir', dir], { stdio: 'ignore' }); } catch {} // exits non-zero after writing (mutex abort on teardown)
    const out = join(dir, 'voice.16k.json');
    if (existsSync(out)) {
      words = JSON.parse(readFileSync(out, 'utf8')).segments.flatMap((s) => s.words || [])
        .filter((w) => w.start != null).map((w) => ({ text: w.word.trim(), start: w.start, end: w.end }));
    }
  }
  if (!words?.length) {
    execFileSync('whisper-cli', ['-m', WHISPER_MODEL, '-f', wav, '-oj', '-ml', '1', '-sow', '-np', '-of', join(dir, 'voice.16k')], { stdio: 'ignore' });
    words = JSON.parse(readFileSync(join(dir, 'voice.16k.json'), 'utf8')).transcription
      .map((s) => ({ text: s.text.trim(), start: s.offsets.from / 1000, end: s.offsets.to / 1000 }));
  }
  const file = join(dir, 'words.json');
  writeFileSync(file, JSON.stringify(words.filter((w) => w.text && norm(w.text)), null, 0));
  return file;
}

export const loadWords = (file) => JSON.parse(readFileSync(file, 'utf8'));

// Index of the first word at or after `from` where `phrase` starts; spacing-insensitive ("Grok Bot" == "GrokBot").
export function findPhrase(words, phrase, from = 0) {
  const target = norm(phrase);
  for (let i = from; i < words.length; i++) {
    let acc = '';
    for (let j = i; j < words.length; j++) {
      acc += norm(words[j].text);
      if (acc === target || (acc.startsWith(target) && j === i)) return i;
      if (!target.startsWith(acc)) break;
    }
  }
  return -1;
}

export function audioDuration(path) {
  return Number(execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', path]).toString().trim());
}

export { existsSync };

// Keep the script's exact words (spelling, names, punctuation); take only timing from the speech.
// Longest-common-subsequence match on normalized tokens, then unmatched script words share the gap between matches.
export function alignToScript(heard, script) {
  const said = script.replace(/\s+/g, ' ').trim().split(' ').filter((t) => norm(t));
  const a = said.map(norm), b = heard.map((w) => norm(w.text));
  const L = Array.from({ length: a.length + 1 }, () => new Int16Array(b.length + 1));
  for (let i = a.length - 1; i >= 0; i--) for (let j = b.length - 1; j >= 0; j--)
    L[i][j] = a[i] === b[j] ? L[i + 1][j + 1] + 1 : Math.max(L[i + 1][j], L[i][j + 1]);
  const out = said.map((text) => ({ text }));
  for (let i = 0, j = 0; i < a.length && j < b.length;) {
    if (a[i] === b[j]) { out[i].start = heard[j].start; out[i].end = heard[j].end; out[i].heard = true; i++; j++; }
    else if (L[i + 1][j] >= L[i][j + 1]) i++; else j++;
  }
  const end = heard[heard.length - 1]?.end ?? 0;
  for (let i = 0; i < out.length; i++) {
    if (out[i].start != null) continue;
    let k = i; while (k < out.length && out[k].start == null) k++;
    const from = i ? out[i - 1].end : 0, to = k < out.length ? out[k].start : end;
    const step = (to - from) / (k - i);
    for (let m = i; m < k; m++) { out[m].start = from + step * (m - i); out[m].end = out[m].start + step * 0.9; }
    i = k - 1;
  }
  return out;
}

// Spans of `heard` to keep so the take reads like the script once: where a line was said twice, the
// last try wins. Script and speech are matched preferring the LATEST occurrence; in each gap between
// matches, speech beyond what the script needs there is an earlier attempt or an ad-lib and is cut.
// Pauses over maxGap shrink to maxGap.
export function keepSpans(heard, script, { pad = 0.08, maxGap = 0.45 } = {}) {
  const a = script.replace(/\s+/g, ' ').trim().split(' ').map(norm).filter(Boolean), b = heard.map((w) => norm(w.text));
  const L = Array.from({ length: a.length + 1 }, () => new Int16Array(b.length + 1));
  for (let i = 1; i <= a.length; i++) for (let j = 1; j <= b.length; j++)
    L[i][j] = a[i - 1] === b[j - 1] ? L[i - 1][j - 1] + 1 : Math.max(L[i - 1][j], L[i][j - 1]);
  const pairs = [];
  for (let i = a.length, j = b.length; i && j;) {
    if (a[i - 1] === b[j - 1] && L[i][j] === L[i - 1][j - 1] + 1) { pairs.unshift([i - 1, j - 1]); i--; j--; }
    else if (L[i][j - 1] >= L[i - 1][j]) j--; else i--;
  }
  const keep = new Array(b.length).fill(false);
  const bounds = [[-1, -1], ...pairs, [a.length, b.length]];
  for (let k = 1; k < bounds.length; k++) {
    const [i0, j0] = bounds[k - 1], [i1, j1] = bounds[k];
    if (k < bounds.length - 1) keep[j1] = true;
    const need = i1 - i0 - 1, have = j1 - j0 - 1; // keep the last `need` heard words of the gap
    for (let j = Math.max(j0 + 1, j1 - need); j < j1; j++) keep[j] = true;
    if (have > need && need) for (let j = j1 - need; j < j1; j++) keep[j] = true;
  }
  const spans = [];
  heard.forEach((w, j) => {
    if (!keep[j]) return;
    const last = spans[spans.length - 1];
    if (last && last.j === j - 1 && w.start - last.end <= maxGap) { last.end = w.end; last.j = j; }
    else spans.push({ start: w.start, end: w.end, j });
  });
  return spans.map((s, k) => ({ start: Math.max(0, s.start - pad), end: s.end + (k === spans.length - 1 ? 0.5 : pad) }));
}
