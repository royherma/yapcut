// One door to the AI: Claude Code (`claude -p`) or Codex (`codex exec`, signs in with a ChatGPT plan). YAPCUT_LLM=claude|codex picks; default = whichever is installed, claude first.
import { spawn, spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const installed = (bin) => spawnSync('sh', ['-c', `command -v ${bin}`], { stdio: 'ignore' }).status === 0;
let picked;
export function provider() {
  if (picked) return picked;
  const want = process.env.YAPCUT_LLM;
  if (want && want !== 'claude' && want !== 'codex') throw new Error(`YAPCUT_LLM must be claude or codex, got "${want}"`);
  picked = want || (installed('claude') ? 'claude' : installed('codex') ? 'codex' : null);
  if (!picked) throw new Error('No AI CLI found: install Claude Code (claude) or Codex (codex), or set YAPCUT_LLM');
  return picked;
}

function command(prompt, { images = [], fast = false }) {
  if (provider() === 'claude') {
    const args = ['-p', prompt, '--output-format', 'text', '--strict-mcp-config', '--disable-slash-commands'];
    if (images.length) args.push('--allowedTools', 'Read');
    if (fast) args.push('--model', process.env.YAPCUT_CLAUDE_FAST_MODEL || 'haiku');
    return { bin: 'claude', args, stdin: null, outFile: null, cleanup: () => {} };
  }
  const dir = mkdtempSync(join(tmpdir(), 'yapcut-codex-')), outFile = join(dir, 'last.txt');
  const args = ['exec', '--skip-git-repo-check', '--ephemeral', '--ignore-user-config', '--ignore-rules', '--sandbox', 'read-only', '--color', 'never', '-o', outFile];
  for (const img of images) args.push('-i', img);
  const model = fast ? process.env.YAPCUT_CODEX_FAST_MODEL : process.env.YAPCUT_CODEX_MODEL;
  if (model) args.push('-m', model);
  args.push('-');
  return { bin: 'codex', args, stdin: prompt, outFile, cleanup: () => rmSync(dir, { recursive: true, force: true }) };
}

const answer = (c, stdout) => {
  if (!c.outFile) return stdout;
  try { return readFileSync(c.outFile, 'utf8'); } catch { return stdout; }
};

export function askText(prompt, { images = [], fast = false, timeout = 360000 } = {}) {
  const c = command(prompt, { images, fast });
  return new Promise((ok, fail) => {
    const p = spawn(c.bin, c.args, { stdio: [c.stdin == null ? 'ignore' : 'pipe', 'pipe', 'pipe'] });
    let out = '', err = '';
    p.stdout.on('data', (d) => (out += d)); p.stderr.on('data', (d) => (err += d));
    if (c.stdin != null) p.stdin.end(c.stdin);
    const timer = setTimeout(() => { p.kill(); fail(new Error(`${c.bin} timed out after ${Math.round(timeout / 1000)} s`)); }, timeout);
    p.on('error', (e) => { clearTimeout(timer); c.cleanup(); fail(e); });
    p.on('close', (code) => {
      clearTimeout(timer);
      const text = answer(c, out); c.cleanup();
      code === 0 || text.trim() ? ok(text) : fail(new Error(`${c.bin} exit ${code}: ${(err || out).slice(-300)}`));
    });
  });
}

export function askTextSync(prompt, { images = [], fast = false, timeout = 300000 } = {}) {
  const c = command(prompt, { images, fast });
  try {
    const r = spawnSync(c.bin, c.args, { input: c.stdin ?? undefined, encoding: 'utf8', maxBuffer: 1 << 24, timeout });
    const text = answer(c, r.stdout ?? '');
    if (r.error) throw r.error;
    if (r.status !== 0 && !text.trim()) throw new Error(`${c.bin} exit ${r.status}: ${(r.stderr || '').slice(-300)}`);
    return text;
  } finally { c.cleanup(); }
}

export const firstJSON = (text, who = provider()) => {
  const m = String(text).match(/\{[\s\S]*\}/);
  if (!m) throw new Error(`${who} returned no JSON: ${String(text).slice(-200)}`);
  return JSON.parse(m[0]);
};

export const askJSON = async (prompt, opts) => firstJSON(await askText(prompt, opts));
export const askJSONSync = (prompt, opts) => firstJSON(askTextSync(prompt, opts));
