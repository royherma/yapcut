// Export: ffmpeg bakes cuts + face-centred zooms + voice + sounds into base.mp4, HyperFrames renders effects, title and
// captions over it (same runtime as the preview), a last ffmpeg pass crops to the ratio and encodes the format.
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, statSync, writeFileSync, copyFileSync, rmSync, readFileSync, realpathSync, appendFileSync, renameSync } from 'node:fs';
import { join, dirname, extname, basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import { layout, rawOf, FPS, SFX_DB, W, H, facesFor } from './edit.mjs';
import { boardFor, BOARD_DIR, needsCam } from './board.mjs';
import { cpSync, readdirSync } from 'node:fs';
import { fxProject, srcTime, HF, hfEnv } from './fx.mjs';
import { birefnetUpTo } from './matte.mjs';
import { wideOf } from './wide.mjs';
import { pageFor } from '../vendor/caption-lab/lib/page.mjs';
import { themeCss } from '../effects/themes.mjs';
import { gradeHtml } from '../effects/grades.mjs';
import { buildCues, chunkWords, capLimits } from '../vendor/caption-lab/lib/cues.mjs';
import { layoutSpans } from './presets.mjs';
import { CFG, chromeLaunch } from './config.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..'), FFMPEG = CFG.ffmpeg;
export const RATIOS = {
  '9:16': { name: '9:16 Reels / TikTok', vf: null },
  '4:5': { name: '4:5 Feed', h: 1350 },
  '1:1': { name: '1:1 Square', h: 1080 },
  '16:9': { name: '16:9 YouTube, blurred sides', vf: 'split[a][b];[a]scale=1920:1080:force_original_aspect_ratio=increase,crop=1920:1080,boxblur=40:2,eq=brightness=-0.1[bg];[b]scale=-2:1080[fg];[bg][fg]overlay=(W-w)/2:0' },
};
export const FORMATS = {
  mp4: { name: 'MP4 (H.264)', ext: 'mp4', hfQuality: 'looks', v: ['-c:v', 'libx264', '-preset', 'medium', '-crf', '17', '-pix_fmt', 'yuv420p'], a: ['-c:a', 'aac', '-b:a', '192k', '-movflags', '+faststart'] },
  draft: { name: 'Draft 480p (fast)', ext: 'mp4', hfQuality: 'draft', draft: true, v: ['-c:v', 'libx264', '-preset', 'veryfast', '-crf', '28', '-pix_fmt', 'yuv420p'], a: ['-c:a', 'aac', '-b:a', '96k', '-movflags', '+faststart'] },
  prores: { name: 'ProRes 422 HQ (.mov)', ext: 'mov', hfQuality: 'delivery', v: ['-c:v', 'prores_ks', '-profile:v', '3', '-pix_fmt', 'yuv422p10le', '-vendor', 'apl0'], a: ['-c:a', 'pcm_s16le'] },
};

function run(cmd, args, { cwd, env, onLine, job } = {}) {
  return new Promise((ok, no) => {
    if (job?.cancel) return no(new Error('cancelled'));
    const p = spawn(cmd, args, { cwd, env, stdio: ['ignore', 'pipe', 'pipe'], ...(job ? { detached: true } : {}) });
    if (job) job.child = p;
    p.on('error', no);
    let tail = '';
    const feed = (d) => { const s = String(d); tail = (tail + s).slice(-1500); if (onLine) s.split(/[\r\n]+/).forEach((l) => l.trim() && onLine(l)); };
    p.stdout.on('data', feed); p.stderr.on('data', feed);
    p.on('close', (code, sig) => { if (job?.child === p) job.child = null; if (job?.cancel) return no(new Error('cancelled')); code || sig ? no(new Error(`${cmd.split('/').pop()} exit ${code ?? sig}: ${tail.trim().split('\n').slice(-2).join(' ').slice(0, 300)}`)) : ok(); });
  });
}
const DRAFT_FPS = 10, DRAFT_SCALE = 'scale=trunc(iw*480/min(iw\\,ih)/2)*2:trunc(ih*480/min(iw\\,ih)/2)*2';
const ff = (args, total, onPct, job) => run(FFMPEG, ['-v', 'error', '-y', '-progress', 'pipe:1', '-nostats', ...args], { job, onLine: (l) => { const m = /^out_time_us=(\d+)/.exec(l); if (m && onPct) onPct(Math.min(1, +m[1] / 1e6 / total)); } });

// Same framing as lib/edit.mjs framing(): face centre at (540, 640), never showing an edge. Expressions run on the 2x source.
const zx = (f, pan, ox = 0) => (f || pan ? `-2*max(${W}*(1-zoom),min(0,${W / 2}-zoom*(${f ? f[0] : 0.5}${pan ? `+${pan}` : ''})*${W}))/zoom${ox ? `+${2 * ox}*(1-1/zoom)` : ''}` : 'iw/2-iw/zoom/2');
// The camera path from lib/edit.mjs flowPath() as an ffmpeg expression of `on` for one piece; same numbers as flowAt() in the player.
function flowExpr(segs, o, len, ch) {
  const T = `(${o.toFixed(4)}+on/${FPS})`, S = segs.filter((x) => x[1] > o && x[0] < o + len);
  if (!S.length) return null;
  const poly = (x) => { const u = `clip((${T}-${x[0]})/${(x[1] - x[0]).toFixed(5)},0,1)`, c = x.slice(ch, ch + 4); return `(${c[0]}+${u}*(${c[1]}+${u}*(${c[2]}+${u}*${c[3]})))`; };
  return S.slice(0, -1).reduceRight((acc, x) => `if(lt(${T},${x[1]}),${poly(x)},${acc})`, poly(S.at(-1)));
}
const zy = (f) => (f ? `-2*max(${H}*(1-zoom),min(0,640-zoom*${f[1]}*${H}))/zoom` : 'ih/2-ih/zoom/2');

// mask: the BiRefNet masks of the take through the same cuts + zooms, gray FFV1 (.mkv), black past the masked frames.
// The mask clip starts on a 1/5 s mark so fps=30 picks the same 25 fps frames as the picture.
export async function base(dir, L, final, onPct, { mask = false, job } = {}) {
  const out = /\.\w+$/.test(final) ? final.replace(/(\.\w+)$/, '.part$1') : `${final}.part`;
  try { await baseTo(dir, L, out, onPct, { mask, job }); renameSync(out, final); } finally { rmSync(out, { force: true }); }
}
async function baseTo(dir, L, out, onPct, { mask, job }) {
  const wd = wideOf(dir), PW = wd ? wd.w : W, n = L.pieces.length, cont = (a, b) => a && b && Math.abs(b.s - a.e) < 0.02;
  const f0 = mask ? Math.max(0, Math.floor((Math.min(...L.pieces.map((pc) => pc.s)) * 25 - 2) / 5) * 5) : 0, t0 = f0 / 25, last = Math.max(...L.pieces.map((pc) => pc.e)) - t0 + 0.5;
  const pad = mask ? `tpad=stop_mode=add:stop_duration=${Math.ceil(last)}:color=black,` : '';
  const fg = [`[0:v]${pad}fps=${FPS},scale=${PW * 2}:${H * 2}:force_original_aspect_ratio=increase,crop=${PW * 2}:${H * 2},setsar=1,split=${n}${L.pieces.map((_, k) => `[s${k}]`).join('')}`];
  if (!mask) fg.push(`[0:a]aresample=48000,asplit=${n}${L.pieces.map((_, k) => `[r${k}]`).join('')}`);
  L.pieces.forEach((pc, k) => {
    const frames = Math.max(1, Math.round((pc.e - pc.s) * FPS)), len = pc.e - pc.s;
    const fz = L.path && flowExpr(L.path, pc.o, len, 2), fx = L.path && flowExpr(L.path, pc.o, len, 6);
    const z = `(${pc.z[0].toFixed(4)}+${(pc.z[1] - pc.z[0]).toFixed(4)}*on/${frames})${fz ? `*${fz}` : ''}`;
    fg.push(`[s${k}]trim=start=${(pc.s - t0).toFixed(3)}:end=${(pc.e - t0).toFixed(3)},setpts=PTS-STARTPTS,zoompan=z='${z}':d=1:x='${zx(pc.f, fx, wd?.ox)}':y='${zy(pc.f)}':s=${PW}x${H}:fps=${FPS}[v${k}]`);
    if (mask) return;
    const fades = [!cont(L.pieces[k - 1], pc) && 'afade=t=in:st=0:d=0.012', !cont(pc, L.pieces[k + 1]) && `afade=t=out:st=${Math.max(0, len - 0.012).toFixed(3)}:d=0.012`].filter(Boolean);
    fg.push(`[r${k}]atrim=start=${pc.s.toFixed(3)}:end=${pc.e.toFixed(3)},asetpts=PTS-STARTPTS${pc.mute ? ',volume=0' : ''}${fades.length ? ',' + fades.join(',') : ''}[a${k}]`);
  });
  const script = `${out}.filter.txt`;
  if (mask) {
    fg.push(`${L.pieces.map((_, k) => `[v${k}]`).join('')}concat=n=${n}:v=1:a=0,format=gray[vout]`);
    writeFileSync(script, fg.join(';\n'));
    await ff(['-framerate', '25', '-start_number', String(f0), '-t', last.toFixed(3), '-i', join(dirname(realpathSync(rawOf(dir))), 'matte-birefnet', '%05d.png'), '-filter_complex_script', script, '-map', '[vout]', '-c:v', 'ffv1', '-pix_fmt', 'gray', out], L.total, onPct, job);
    return rmSync(script, { force: true });
  }
  fg.push(`${L.pieces.map((_, k) => `[v${k}][a${k}]`).join('')}concat=n=${n}:v=1:a=1[vout][voice]`);
  L.sfx.forEach((x, k) => fg.push(`[${k + 1}:a]aresample=48000,${x.len ? `atrim=0:${x.len},afade=t=out:st=${Math.max(0, x.len - 0.06)}:d=0.06,` : ''}volume=${SFX_DB + (x.db ?? 0)}dB,adelay=${Math.round(x.at * 1000)}:all=1[x${k}]`));
  fg.push(L.sfx.length ? `[voice]${L.sfx.map((_, k) => `[x${k}]`).join('')}amix=inputs=${L.sfx.length + 1}:duration=first:normalize=0[aout]` : '[voice]anull[aout]');
  writeFileSync(script, fg.join(';\n'));
  await ff(['-i', rawOf(dir), ...L.sfx.flatMap((x) => ['-i', x.file]), '-filter_complex_script', script, '-map', '[vout]', '-map', '[aout]',
    '-c:v', 'libx264', '-preset', 'fast', '-crf', '14', '-g', '30', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-b:a', '256k', out], L.total, onPct, job);
  rmSync(script, { force: true });
}

// The board layer the preview draws (lib/board.mjs + preview/boardlayer.js), copied into the HyperFrames project.
function boardFiles(dir, L, proj) {
  if (!needsCam(L.p)) return '';
  const video = dirname(realpathSync(rawOf(dir))), B = boardFor(video, L, facesFor(dir), L.p.cam);
  if (!B) return '';
  cpSync(BOARD_DIR, join(proj, 'board'), { recursive: true, filter: (f) => !/\/(node_modules|stories)\b/.test(f) });
  if (existsSync(join(video, 'assets'))) cpSync(join(video, 'assets'), join(proj, 'boardart', 'assets'), { recursive: true });
  copyFileSync(join(ROOT, 'preview/boardlayer.js'), join(proj, 'boardlayer.js'));
  const prims = readdirSync(join(BOARD_DIR, 'prims')).filter((f) => f.endsWith('.js'));
  return `<script>window.YB=${JSON.stringify({ ...B, assets: 'boardart/' })};</script><script src="board/board.js"></script>${prims.map((f) => `<script src="board/prims/${f}"></script>`).join('')}<script src="boardlayer.js"></script>`;
}

function overlayTail(L, faces) {
  const data = { total: L.total, captions: L.captions, captionStyle: L.p.captionStyle || 'tg-active-now', faces, fx: L.fx.map((e) => ({ fx: e.fx, t0: e.t0, dur: e.dur, params: { out: e.params?.out, split: e.params?.split, size: e.params?.size, shape: e.params?.shape, capY: e.params?.capY } })) };
  return `<link rel="stylesheet" href="player.css" />
<style>${themeCss(L.p.theme)}</style>
<div id="caps" class="layer"><div id="ttl" class="cap title"></div><div id="sub" class="cap sub"></div><div id="cw" class="cap word"></div></div>
<script>window.YO=${JSON.stringify(data)};</script><script src="hook-engine.js"></script><script src="rpnhooks.js"></script><script src="titlestyle.js"></script><script src="overlay.js"></script>`;
}

function captionsHtml(L) {
  const caps = L.captions.filter((c) => c.kind === 'cap'), { words, hi: hiAt } = chunkWords(caps);
  const cues = buildCues(words, capLimits(L.p)).map((q) => { const hi = hiAt.filter((i) => i >= q.from && i <= q.to); return hi.length ? { ...q, emph: hi } : q; });
  return pageFor(L.p.captionStyle || 'tg-active-now', { duration: L.total, width: W, height: H, anchorY: 0.68 + (L.p.captionDY ?? 0) / 1920, headline: '', words, cues }, { data: { noTitle: !!L.p.title, layouts: layoutSpans(L) } }).replace('</head>', `<style>${themeCss(L.p.theme)}</style></head>`);
}

// Crop window for a shorter ratio: the head stays in (80 px over the face top), captions and title are lifted inside if the window cuts them.
function fitRatio(dir, L, h) {
  const a = join(dirname(realpathSync(rawOf(dir))), 'analysis.json'), face = existsSync(a) ? JSON.parse(readFileSync(a, 'utf8')).face : null;
  const top = Math.max(0, Math.min(H - h, Math.round((face?.y0 ?? 260) - 80))), bottom = top + h;
  const capY = L.captions.find((c) => c.kind === 'cap')?.y, lift = capY != null && capY > bottom - 170 ? bottom - 170 - capY : 0;
  if (lift) { L.p.captionDY = (L.p.captionDY ?? 0) + lift; for (const c of L.captions) if (c.kind === 'cap') c.y += lift; }
  for (const c of L.captions) if (c.kind !== 'cap' && c.y + 130 > bottom - 220) c.y = bottom - 350;
  return `crop=1080:${h}:0:${top}`;
}

// The HyperFrames page Export renders: effects, board, grade, title and captions over base.mp4.
function buildProject(dir, L, baseFile, faces, mask = null) {
  const media = [];
  for (const e of L.fx) if (e.params?.file && existsSync(e.params.file)) { const nm = `media${e.k}${extname(e.params.file)}`; media.push([e.params.file, nm]); e.params = { ...e.params, src: nm }; }
  for (const e of L.fx) if (Array.isArray(e.params?.items)) e.params = { ...e.params, items: e.params.items.map((it, n) => { if (!it?.file || !existsSync(it.file)) return it; const nm = `media${e.k}-${n}${extname(it.file)}`; media.push([it.file, nm]); return { ...it, src: nm }; }) };
  for (const e of L.fx) if (/^\/bglib\//.test(e.params?.meBg ?? '')) { const f = join(ROOT, 'library', 'backgrounds', e.params.meBg.slice(7)), nm = `bg${e.k}${extname(f)}`; if (existsSync(f)) { media.push([f, nm]); e.params = { ...e.params, meBg: nm }; } }
  const { proj } = fxProject(dir, { base: baseFile, raw: rawOf(dir), fx: L.fx, total: L.total, toSrc: srcTime(L.pieces), name: 'export', tail: overlayTail(L, faces), mask });
  for (const [from, nm] of media) copyFileSync(from, join(proj, nm));
  const board = boardFiles(dir, L, proj);
  if (board) writeFileSync(join(proj, 'index.html'), readFileSync(join(proj, 'index.html'), 'utf8').replace('<script src="runtime.js"></script>', `<script src="runtime.js"></script>\n${board}`));
  writeFileSync(join(proj, 'index.html'), readFileSync(join(proj, 'index.html'), 'utf8').replace('</body>', `${gradeHtml(L.p.color, L.p.colorAmt)}\n</body>`));
  copyFileSync(join(ROOT, 'effects/overlay.js'), join(proj, 'overlay.js'));
  copyFileSync(join(ROOT, 'preview/player.css'), join(proj, 'player.css'));
  copyFileSync(join(ROOT, 'preview/titlestyle.js'), join(proj, 'titlestyle.js'));
  for (const f of ['hook-engine.js', 'rpnhooks.js']) copyFileSync(join(ROOT, 'preview', f), join(proj, f));
  if (L.p.captionStyle !== 'none') writeFileSync(join(proj, 'captions.html'), captionsHtml(L));
  return proj;
}

// base.mp4 is rebuilt only when the cut changed; draft and export check reuse it so cut-out mattes stay cached.
async function freshBase(dir, L, baseFile, onPct, job) {
  const newest = Math.max(...['plan.json', 'words.json'].map((f) => statSync(join(dir, f)).mtimeMs));
  if (!existsSync(baseFile) || statSync(baseFile).mtimeMs < newest) await base(dir, L, baseFile, onPct, { job });
  else onPct?.(1);
}

// Draft renders from a half-size copy of the cut: the page sizes videos by CSS, so only pixel count drops (cut-outs too).
async function halfBase(baseFile, job) {
  const out = baseFile.replace(/\.mp4$/, '-half.mp4');
  if (!existsSync(out) || statSync(out).mtimeMs < statSync(baseFile).mtimeMs) { const tmp = out.replace(/\.mp4$/, '.part.mp4'); try { await ff(['-i', baseFile, '-vf', 'scale=trunc(iw/4)*2:trunc(ih/4)*2', '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '18', '-c:a', 'copy', tmp], 1, null, job); renameSync(tmp, out); } finally { rmSync(tmp, { force: true }); } }
  return out;
}

// Whole-edit BiRefNet mask, rebuilt when more of the take is masked; null when the take uses Apple Vision only.
async function freshMask(dir, L, work, job) {
  const upTo = birefnetUpTo(dir);
  if (!upTo) return null;
  const file = join(work, `mask-${Number.isFinite(upTo) ? Math.round(upTo * 25) : 'all'}.mkv`);
  if (!existsSync(file)) {
    for (const f of readdirSync(work)) if (/^mask-.*\.mkv$/.test(f)) rmSync(join(work, f), { force: true });
    await base(dir, L, file, null, { mask: true, job });
  }
  return { file, upTo };
}

const jobs = [];
export const exportJobs = () => jobs.map(({ cancel, child, ...j }) => j);

// Every finished, failed or cancelled export, kept for good in runs/<video>/exports.jsonl (bin/export-log.mjs reads it).
function logJob(job, outDir) {
  try {
    const vdir = dirname(outDir), cmpFile = join(vdir, 'compare.json'), take = existsSync(cmpFile) ? statSync(cmpFile).birthtimeMs : null, end = Date.now();
    const line = { id: job.id, run: job.run, label: job.label, ratio: job.ratio, format: job.format, state: job.error === 'cancelled' ? 'cancel' : job.state, stage: job.stage, error: job.error,
      started: new Date(job.started).toISOString(), ended: new Date(end).toISOString(), secs: Math.round((end - job.started) / 1000),
      file: job.state === 'done' ? basename(job.file) : null, size: job.size, takeAt: take ? new Date(take).toISOString() : null, sinceTakeSecs: take ? Math.round((end - take) / 1000) : null };
    appendFileSync(join(vdir, 'exports.jsonl'), JSON.stringify(line) + '\n');
  } catch {}
}

export function startExport({ run: r, dir, outDir, label, ratio, format, speed = 1, faces = [], log = () => {} }) {
  const R = RATIOS[ratio], F = FORMATS[format], sp = Math.max(0.5, Math.min(2, +speed || 1)), fast = Math.abs(sp - 1) > 0.001;
  if (!R || !F) throw new Error('pick a ratio and a format');
  const slug = (label || r).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40), stamp = new Date().toLocaleString('sv-SE', { timeZone: 'Asia/Bangkok' }).slice(5, 16).replace(/[-:]/g, '').replace(' ', '-');
  mkdirSync(outDir, { recursive: true });
  const file = join(outDir, `${slug}-${ratio.replace(':', 'x')}${F.draft ? '-draft' : ''}${fast ? `-${sp}x` : ''}-${stamp}-${birefnetUpTo(dir) ? 'birefnet' : 'apple'}-cutout.${F.ext}`);
  const job = { id: `x${Date.now().toString(36)}`, run: r, label, ratio, ratioName: R.name, format, formatName: F.name, speed: sp, state: 'running', stage: 'Starting', pct: 0, started: Date.now(), eta: null, file, size: null, error: null, secs: null };
  jobs.unshift(job); jobs.length = Math.min(jobs.length, 20);
  const span = (a, b) => (f) => { job.pct = Math.max(job.pct, +(a + (b - a) * f).toFixed(1)); const el = (Date.now() - job.started) / 1000; job.eta = job.pct > 3 ? Math.round((el * (100 - job.pct)) / job.pct) : null; };
  const stage = (s, a, b) => { job.stage = s; const f = span(a, b); f(0); return f; };
  (async () => {
    const L = layout(dir), work = join(dir, 'export'), baseFile = join(work, wideOf(dir) ? 'base-wide.mp4' : 'base.mp4'), crop = R.h ? fitRatio(dir, L, R.h) : R.vf;
    const vf = [F.draft ? [crop, DRAFT_SCALE].filter(Boolean).join(',') : crop, fast ? `setpts=PTS/${sp},fps=${FPS}` : ''].filter(Boolean).join(',');
    const stop = () => { if (job.cancel) throw new Error('cancelled'); };
    mkdirSync(work, { recursive: true });
    const cut = stage('Cutting + zooming the take', 0, 18);
    await (F.draft ? freshBase(dir, L, baseFile, cut, job) : base(dir, L, baseFile, cut, { job }));
    stop();
    const p = stage('Preparing effects (cut-outs run once, then cached)', 18, 25);
    const projBase = F.draft ? await halfBase(baseFile, job) : baseFile;
    stop();
    const proj = buildProject(dir, L, projBase, faces, await freshMask(dir, L, work, job));
    p(1);
    stop();
    const hf = stage('Rendering with HyperFrames', 25, 92), hfOut = join(work, 'hf.mp4');
    await run('npx', ['--yes', HF, 'render', '--quality', F.hfQuality, ...(F.draft ? ['--fps', String(DRAFT_FPS)] : []), '--workers', 'auto', '--output', hfOut], { cwd: proj, env: hfEnv, onLine: (l) => {
      const m = /@hf-progress\s+(\{.*\})/.exec(l);
      if (m) { try { const x = JSON.parse(m[1]); if (x.pct != null) hf(Math.min(1, x.pct / 100)); job.last = x.total ? `${x.code} ${x.done}/${x.total} frames` : x.code; } catch {} }
      else job.last = l.replace(/\x1b\[[0-9;]*m/g, '').slice(0, 160);
    }, job });
    stop();
    const fin = stage('Encoding ' + F.name + ', ' + ratio + (fast ? `, ${sp}x` : ''), 92, 100);
    const loud = ['-af', `${fast ? `atempo=${sp},` : ''}loudnorm=I=-14:TP=-1.5:LRA=11`, '-ar', '48000'];
    if (!vf && format === 'mp4') await ff(['-i', hfOut, '-map', '0:v', '-map', '0:a?', '-c:v', 'copy', ...loud, ...F.a, file], L.total, fin, job);
    else await ff(['-i', hfOut, ...(vf ? ['-filter_complex', `[0:v]${vf}[v]`, '-map', '[v]'] : ['-map', '0:v']), '-map', '0:a?', ...loud, ...F.v, ...F.a, file], L.total / sp, fin, job);
    Object.assign(job, { state: 'done', stage: 'Done', pct: 100, eta: 0, size: statSync(file).size, secs: Math.round((Date.now() - job.started) / 1000) });
    log(`EXPORT done ${file} (${(job.size / 1e6).toFixed(1)} MB, ${job.secs} s)`);
    logJob(job, outDir);
  })().catch((e) => { if (job.cancel) rmSync(file, { force: true }); const msg = String(e.message || e).slice(0, 400); Object.assign(job, { state: 'fail', error: msg, secs: Math.round((Date.now() - job.started) / 1000) }); log(`EXPORT failed: ${job.error}`); logJob(job, outDir); });
  return job;
}

export function cancelExport(id) {
  const j = jobs.find((x) => x.id === id && x.state === 'running');
  if (j) { j.cancel = true; if (j.child?.pid) try { process.kill(-j.child.pid, 'SIGTERM'); } catch {} }
  return !!j;
}

// Export check: stills of the export at chosen seconds, next to the preview at the same seconds. Reuses base.mp4 while the cut is unchanged.
export async function checkExport({ run: r, dir, faces = [], at, out, previewUrl }) {
  const L = layout(dir), work = join(dir, 'export'), baseFile = join(work, wideOf(dir) ? 'base-wide.mp4' : 'base.mp4');
  mkdirSync(work, { recursive: true }); rmSync(out, { recursive: true, force: true }); mkdirSync(out, { recursive: true });
  await freshBase(dir, L, baseFile);
  const times = (at?.length ? at : L.fx.flatMap((e) => [e.t0 + 0.6, e.t0 + e.dur / 2])).filter((t) => t >= 0 && t < L.total).map((t) => +t.toFixed(2));
  const proj = buildProject(dir, L, baseFile, faces, await freshMask(dir, L, work));
  await run('npx', ['--yes', HF, 'snapshot', '--at', times.join(','), '--no-end', '--describe', 'false', '-o', join(out, 'export')], { cwd: proj, env: hfEnv });
  const { chromium } = await import('playwright-core');
  const b = await chromium.launch(chromeLaunch());
  try {
    const pg = await b.newPage({ viewport: { width: W, height: H } });
    await pg.goto(`${previewUrl}/play/${r}`, { waitUntil: 'load' }); await pg.waitForTimeout(2500);
    for (const t of times) { await pg.evaluate((t) => window.postMessage({ cmd: 'seek', t }, '*'), t); await pg.waitForTimeout(1200); await pg.screenshot({ path: join(out, `preview-${t}.png`) }); }
  } finally { await b.close().catch(() => {}); }
  const shots = readdirSync(join(out, 'export')).filter((f) => f.endsWith('.png')).sort();
  return { times, export: shots.map((f) => join(out, 'export', f)), preview: times.map((t) => join(out, `preview-${t}.png`)) };
}
