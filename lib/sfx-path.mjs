import { join, normalize } from 'node:path';
import { homedir } from 'node:os';
import { CFG } from './config.mjs';
export const SFX_DIR = CFG.sfxDir, OV_DIR = CFG.openverseDir, HF_DIR = CFG.hyperframesSfxDir, RUNS_DIR = CFG.runsDir;
// run:<video>/media/<file> = a clip's own audio cut for this video (a demo's sound in a held beat).
export function sfxPath(ref) {
  const [base, rel] = ref.startsWith('ov:') ? [OV_DIR, ref.slice(3)] : ref.startsWith('hf:') ? [HF_DIR, ref.slice(3)] : ref.startsWith('run:') ? [RUNS_DIR, ref.slice(4)] : [SFX_DIR, ref], p = normalize(join(base, rel));
  return p.startsWith(base + '/') ? p : null;
}
export const audioType = (f) => (/\.mp3$/i.test(f) ? 'audio/mpeg' : /\.m4a$/i.test(f) ? 'audio/mp4' : 'audio/wav');
// Rising note n (0-based, wraps after 8) from bin/synth-scale.mjs: clean/32x marimba, clean/33x glass.
export const ladderRef = (voice, n) => `clean/${voice === 'glass' ? 33 : 32}${(n % 8) + 1}_clean_${voice === 'glass' ? 'glass' : 'marimba'}_step_${(n % 8) + 1}_${['c5', 'd5', 'e5', 'g5', 'a5', 'c6', 'd6', 'e6'][n % 8]}.wav`;
