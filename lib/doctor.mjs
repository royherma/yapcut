import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { CFG } from './config.mjs';
import { provider } from './llm.mjs';

const ok = (cmd, args, re) => { const r = spawnSync(cmd, args, { encoding: 'utf8' }); return r.status === 0 && (!re || re.test(r.stdout + r.stderr)); };

export function doctor() {
  let ai = null; try { ai = provider(); } catch {}
  const rows = [
    ['ffmpeg with captions (libass)', ok(CFG.ffmpeg, ['-hide_banner', '-filters'], /\bsubtitles\b/), `${CFG.ffmpeg}  (brew install ffmpeg@7, or YAPCUT_FFMPEG)`],
    ['ffprobe', ok(CFG.ffprobe, ['-version']), CFG.ffprobe],
    ['Chrome for previews and export', !!CFG.chrome && existsSync(CFG.chrome), CFG.chrome ?? 'install Google Chrome, or set YAPCUT_CHROME'],
    ['AI CLI', !!ai, ai ? `${ai} (YAPCUT_LLM=claude|codex to switch)` : 'install Claude Code or Codex'],
    ['swiftc (face boxes, cut-outs)', ok('swiftc', ['--version']), 'xcode-select --install'],
    ['word timing (Qwen3 aligner)', ok(CFG.alignPython, ['-c', 'import qwen_asr, torch, soundfile']), `${CFG.alignPython}  (scripts/install.sh)`],
    ['uvx (Parakeet speech-to-text)', ok(CFG.uvx, ['--version']), CFG.uvx],
    ['sounds', existsSync(`${CFG.sfxDir}/clean`), CFG.sfxDir],
  ];
  for (const [what, good, how] of rows) console.log(`${good ? 'ok  ' : 'FAIL'}  ${what.padEnd(32)} ${how}`);
  return rows.every((r) => r[1]);
}
