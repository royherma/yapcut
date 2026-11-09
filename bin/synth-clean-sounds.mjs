// Clean UI sound set made from scratch with ffmpeg: whooshes (filtered noise + faint pitch sweep), ticks (decaying sines), thumps.
import { execFileSync } from 'node:child_process';
import { mkdirSync, appendFileSync, readFileSync } from 'node:fs';
import { CFG } from '../lib/config.mjs';
const OUT = CFG.sfxDir + '/clean', CAT = CFG.sfxDir + '/catalog.csv';
mkdirSync(OUT, { recursive: true });
const tail = ',loudnorm=I=-20:TP=-2,afade=t=in:d=0.004,aformat=sample_fmts=s16:channel_layouts=stereo';
const run = (args) => execFileSync('ffmpeg', ['-v', 'error', '-y', ...args]);
const whoosh = (d, c, hp, lp, pk, k, f0, f1) => ['-f', 'lavfi', '-i', `anoisesrc=d=${d}:c=${c}:r=48000:a=0.6:seed=7`, '-f', 'lavfi', '-i', `aevalsrc='0.05*sin(2*PI*(${f0}*t+${(f1 - f0) / (2 * d)}*t*t))':d=${d}:s=48000`,
  '-filter_complex', `[0]highpass=f=${hp},lowpass=f=${lp}[n];[n][1]amix=inputs=2:normalize=0,volume=eval=frame:volume='if(lt(t,${pk}),pow(t/${pk},1.6),exp(-(t-${pk})*${k}))',afade=t=out:st=${d - 0.04}:d=0.04${tail}`];
const tick = (d, f, dec, noise) => ['-f', 'lavfi', '-i', `aevalsrc='sin(2*PI*${f}*t)*exp(-t*${dec})+${noise}*(random(0)-0.5)*exp(-t*400)':d=${d}:s=48000`, '-af', `highpass=f=150${tail}`];
const thump = (d, f, drop, dec) => ['-f', 'lavfi', '-i', `aevalsrc='sin(2*PI*(${f}*t-${drop}*t*t))*exp(-t*${dec})+0.15*(random(0)-0.5)*exp(-t*60)':d=${d}:s=48000`, '-af', `lowpass=f=2500${tail}`];
const set = [
  ['201', 'Clean whoosh (hook) 1', 0.5, whoosh(0.5, 'pink', 300, 6000, 0.22, 9, 900, 300)],
  ['202', 'Clean whoosh (hook) 2', 0.6, whoosh(0.6, 'white', 600, 9000, 0.18, 8, 1400, 400)],
  ['203', 'Clean whoosh (hook) 3', 0.45, whoosh(0.45, 'pink', 200, 4000, 0.15, 12, 700, 200)],
  ['204', 'Clean whoosh (hook) 4', 0.55, whoosh(0.55, 'brown', 120, 3000, 0.25, 9, 500, 150)],
  ['211', 'Clean drop (down) 1', 0.6, whoosh(0.6, 'pink', 150, 2500, 0.3, 8, 600, 180)],
  ['212', 'Clean drop (down) 2', 0.55, whoosh(0.55, 'brown', 100, 1800, 0.28, 9, 400, 120)],
  ['213', 'Clean drop (down) 3', 0.65, whoosh(0.65, 'pink', 250, 3500, 0.32, 7, 800, 250)],
  ['214', 'Clean drop (down) 4', 0.5, whoosh(0.5, 'white', 400, 4000, 0.25, 10, 700, 200)],
  ['221', 'Clean rise (up) 1', 0.55, whoosh(0.55, 'pink', 200, 4000, 0.35, 12, 250, 800)],
  ['222', 'Clean rise (up) 2', 0.6, whoosh(0.6, 'brown', 120, 2500, 0.38, 11, 180, 600)],
  ['223', 'Clean rise (up) 3', 0.5, whoosh(0.5, 'pink', 300, 5000, 0.32, 13, 300, 1000)],
  ['224', 'Clean rise (up) 4', 0.55, whoosh(0.55, 'white', 500, 6000, 0.36, 12, 400, 1200)],
  ['231', 'Clean tick 1', 0.08, tick(0.08, 2400, 70, 0.3)],
  ['232', 'Clean tick 2', 0.08, tick(0.08, 1800, 60, 0.2)],
  ['233', 'Clean tick (wood) 3', 0.1, tick(0.1, 950, 45, 0.25)],
  ['234', 'Clean tap 4', 0.05, tick(0.05, 3200, 120, 0.5)],
  ['241', 'Clean out (soft tick) 1', 0.09, tick(0.09, 1200, 55, 0.1)],
  ['242', 'Clean out (low tap) 2', 0.1, tick(0.1, 700, 50, 0.15)],
  ['243', 'Clean out (fade whoosh) 3', 0.3, whoosh(0.3, 'pink', 400, 3000, 0.05, 14, 600, 300)],
  ['244', 'Clean out (soft tick) 4', 0.08, tick(0.08, 1500, 65, 0.08)],
  ['251', 'Clean thump 1', 0.3, thump(0.3, 110, 120, 16)],
  ['252', 'Clean thump 2', 0.25, thump(0.25, 140, 160, 20)],
  ['253', 'Clean punch whoosh 3', 0.35, whoosh(0.35, 'pink', 150, 3000, 0.08, 14, 500, 120)],
];
const have = readFileSync(CAT, 'utf8');
for (const [n, name, secs, args] of set) {
  const file = `${OUT}/${n}_${name.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/_$/, '')}.wav`;
  run([...args, '-t', String(secs), file]);
  if (!have.includes(`Clean,${n},`)) appendFileSync(CAT, `\nClean,${n},${name},${secs},${file}`);
}
console.log(set.length, 'made in', OUT);
