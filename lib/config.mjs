// Every machine-specific path and key. Env vars win, then lib/config.local.mjs (private, never exported), then repo defaults.
import { existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const local = existsSync(join(ROOT, 'lib/config.local.mjs')) ? (await import('./config.local.mjs')).default : {};
const env = process.env;
const firstFile = (...c) => c.find((f) => f && existsSync(f));
const pick = (envName, localKey, ...fallbacks) => env[envName] || local[localKey] || firstFile(...fallbacks) || fallbacks.at(-1);

export const CFG = {
  root: ROOT,
  ffmpeg: pick('YAPCUT_FFMPEG', 'ffmpeg', '/opt/homebrew/opt/ffmpeg@7/bin/ffmpeg', '/usr/local/opt/ffmpeg@7/bin/ffmpeg', 'ffmpeg'),
  ffprobe: pick('YAPCUT_FFPROBE', 'ffprobe', '/opt/homebrew/opt/ffmpeg@7/bin/ffprobe', '/usr/local/opt/ffmpeg@7/bin/ffprobe', 'ffprobe'),
  chrome: pick('YAPCUT_CHROME', 'chrome', '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', '/Applications/Chromium.app/Contents/MacOS/Chromium', undefined),
  nodeBin: env.YAPCUT_NODE_BIN || local.nodeBin || '',
  sfxDir: env.YAPCUT_SFX_DIR || local.sfxDir || join(ROOT, 'sounds'),
  openverseDir: env.YAPCUT_OPENVERSE_DIR || local.openverseDir || join(ROOT, 'sounds/openverse'),
  hyperframesSfxDir: env.YAPCUT_HF_SFX_DIR || local.hyperframesSfxDir || join(ROOT, 'sounds/hyperframes'),
  defaultView: env.YAPCUT_VIEW || local.defaultView || 'simple',
  runsDir: env.YAPCUT_RUNS_DIR || join(ROOT, 'runs'),
  alignPython: pick('YAPCUT_ALIGN_PYTHON', 'alignPython', join(ROOT, '.venv/bin/python'), 'python3'),
  uvx: pick('YAPCUT_UVX', 'uvx', join(env.HOME || '', '.local/bin/uvx'), '/opt/homebrew/bin/uvx', 'uvx'),
  captionLab: env.YAPCUT_CAPTION_LAB || local.captionLab || join(ROOT, 'vendor/caption-lab'),
};

// API keys for optional paid features: env var only, unless the private config.local.mjs supplies secret().
export const secret = (name) => env[name] || (local.secret ? local.secret(name) : '') || '';

export const chromeLaunch = (extra = {}) => (CFG.chrome ? { executablePath: CFG.chrome, ...extra } : { channel: 'chrome', ...extra });
