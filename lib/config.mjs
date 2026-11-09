// Every machine-specific path and key. Env vars win, then lib/config.local.mjs (private, never exported), then repo defaults.
import { existsSync, readFileSync, writeFileSync, mkdirSync, chmodSync, renameSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
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

const SETTINGS_DIR = env.YAPCUT_SETTINGS_DIR || join(homedir(), '.config/yapcut');
export const KEYS_FILE = join(SETTINGS_DIR, 'keys.json');
export const PREFS_FILE = join(SETTINGS_DIR, 'settings.json');
const readJson = (f) => { try { return JSON.parse(readFileSync(f, 'utf8')); } catch { return {}; } };
let keysAt = -1, keysMemo = {};
const savedKeys = () => { let m = 0; try { m = statSync(KEYS_FILE).mtimeMs; } catch { keysMemo = {}; keysAt = -1; return keysMemo; } if (m !== keysAt) { keysAt = m; keysMemo = readJson(KEYS_FILE); } return keysMemo; };
function writeSecure(file, obj) {
  mkdirSync(SETTINGS_DIR, { recursive: true, mode: 0o700 }); chmodSync(SETTINGS_DIR, 0o700);
  const tmp = `${file}.${process.pid}.tmp`;
  writeFileSync(tmp, JSON.stringify(obj, null, 1), { mode: 0o600 }); chmodSync(tmp, 0o600); renameSync(tmp, file);
}

// API keys for optional paid features: env var, then keys typed into the page (~/.config/yapcut/keys.json, mode 600), then the private config.local.mjs secret().
export const secret = (name) => env[name] || savedKeys()[name] || (local.secret ? local.secret(name) : '') || '';
export const secretSource = (name) => (env[name] ? 'env' : savedKeys()[name] ? 'page' : (local.secret ? local.secret(name) : '') ? 'config' : '');
export const saveSecret = (name, value) => { const k = { ...readJson(KEYS_FILE) }; if (value) k[name] = value; else delete k[name]; writeSecure(KEYS_FILE, k); keysAt = -1; };
export const prefs = () => readJson(PREFS_FILE);
export const savePref = (name, value) => writeSecure(PREFS_FILE, { ...prefs(), [name]: value });

export const chromeLaunch = (extra = {}) => (CFG.chrome ? { executablePath: CFG.chrome, ...extra } : { channel: 'chrome', ...extra });
