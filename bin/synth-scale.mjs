// Rising note ladders for spoken lists: each item gets the next step up (clean/32x marimba, clean/33x glass pluck).
import { execFileSync } from 'node:child_process';
import { readFileSync, appendFileSync } from 'node:fs';
import { CFG } from '../lib/config.mjs';
const OUT = CFG.sfxDir + '/clean', CAT = CFG.sfxDir + '/catalog.csv';
const STEPS = [['C5', 523.25], ['D5', 587.33], ['E5', 659.25], ['G5', 783.99], ['A5', 880], ['C6', 1046.5], ['D6', 1174.66], ['E6', 1318.51]];
const VOICES = [
  ['32', 'marimba', 0.5, (f) => `0.8*sin(2*PI*${f}*t)*exp(-t*9)+0.35*sin(2*PI*${4 * f}*t)*exp(-t*40)+0.12*sin(2*PI*${10 * f}*t)*exp(-t*90)`],
  ['33', 'glass', 0.7, (f) => `0.7*sin(2*PI*${f}*t)*exp(-t*6)+0.25*sin(2*PI*${2 * f}*t)*exp(-t*12)+0.1*sin(2*PI*${3.01 * f}*t)*exp(-t*20)`],
];
const have = readFileSync(CAT, 'utf8');
for (const [pre, voice, secs, expr] of VOICES) STEPS.forEach(([note, f], k) => {
  const n = `${pre}${k + 1}`, name = `${voice}_step_${k + 1}_${note.toLowerCase()}`, file = `${OUT}/${n}_clean_${name}.wav`;
  execFileSync('ffmpeg', ['-v', 'error', '-y', '-f', 'lavfi', '-i', `aevalsrc='${expr(f)}':d=${secs}:s=48000`, '-af', 'highpass=f=120,loudnorm=I=-20:TP=-2,afade=t=in:d=0.003,aformat=sample_fmts=s16:channel_layouts=stereo', '-t', String(secs), file]);
  if (!have.includes(`Clean,${n},`)) appendFileSync(CAT, `\nClean,${n},${name},${secs},${file}`);
});
const chord = [261.63, 523.25, 659.25, 783.99, 1046.5].map((f, k) => `${k ? 0.32 : 0.5}*sin(2*PI*${f}*t)*exp(-t*${k ? 2.6 : 1.8})+${k ? 0.1 : 0}*sin(2*PI*${2 * f}*t)*exp(-t*7)`).join('+');
const cfile = `${OUT}/339_clean_glass_resolve_cmaj.wav`;
execFileSync('ffmpeg', ['-v', 'error', '-y', '-f', 'lavfi', '-i', `aevalsrc='${chord}':d=1.8:s=48000`, '-af', 'highpass=f=60,loudnorm=I=-18:TP=-2,afade=t=in:d=0.003,afade=t=out:st=1.5:d=0.3,aformat=sample_fmts=s16:channel_layouts=stereo', '-t', '1.8', cfile]);
if (!have.includes('Clean,339,')) appendFileSync(CAT, `\nClean,339,glass_resolve_cmaj,1.8,${cfile}`);
console.log(VOICES.length * STEPS.length + 1, 'notes made in', OUT);
