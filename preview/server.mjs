#!/usr/bin/env node
import { refuseForeign } from '../lib/local-only.mjs';
import { pipeline as pipe } from 'node:stream';
// yapcut preview on :4901 (ports: yapcut-preview). Every video (runs/<video>/compare.json) with its versions, played live
// from a 540x960 copy of the take: no encoding. Runs the pipeline per video: rules, face scan, tune loop, grade.
// Usage: node preview/server.mjs [video ...] [--no-pipeline]
import { createServer } from 'node:http';
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync, existsSync, statSync, createReadStream, appendFileSync, copyFileSync, realpathSync, readdirSync, rmSync, symlinkSync, lstatSync } from 'node:fs';
import { execFileSync, spawn } from 'node:child_process';
import { join, dirname, resolve, basename, extname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { audioType } from '../lib/sfx-path.mjs';
import { layout, rawOf, sfxPath, soundPacks, packOf, editWords, framing, zoomsOf, wordsIn, GAP_K } from '../lib/edit.mjs';
import { page, srcTime, visionSubject } from '../lib/fx.mjs';
import { faceZone, timing, checks, handOnFace, onScreen, SAFE, FIX } from '../lib/rules.mjs';
import { byId } from '../effects/catalog.mjs';
import { grade, tune, PARTS } from '../lib/grade.mjs';
import { analyze, takeIssues } from '../lib/analyze.mjs';
import { makePresets, layoutSpans } from '../lib/presets.mjs';
import { copyStyle, applyStyle } from '../lib/style.mjs';
import { transcribe, makeIdeas } from '../lib/take.mjs';
import { nameTake } from '../lib/name.mjs';
import { askJSON, provider } from '../lib/llm.mjs';
import { renameSync, mkdirSync, createWriteStream } from 'node:fs';
import { pageFor, OURS } from '../vendor/caption-lab/lib/page.mjs';
import { themeCss, themeId, themeList } from '../effects/themes.mjs';
import { gradeHtml, gradeId, gradeAmt, gradeList } from '../effects/grades.mjs';
import { buildCues, chunkWords, capLimits } from '../vendor/caption-lab/lib/cues.mjs';
import { addHere, quickFx, afterTitle } from '../lib/addfx.mjs';
import { makeOverlay, drawForLayout } from '../lib/overlay.mjs';
import { startExport, checkExport, exportJobs, cancelExport, RATIOS, FORMATS } from '../lib/export.mjs';
import { editMatte, matteEngine, birefnetUpTo } from '../lib/matte.mjs';
import { wideOf } from '../lib/wide.mjs';
import { makeLayoutRuns, makeFlowRun } from '../lib/layouts.mjs';
import { EFFECTS } from '../effects/catalog.mjs';
import { MOVE_KINDS } from '../lib/cammove.mjs';
import { boardFor, BOARD_DIR, CAMS, CAM_TITLE_Y, camTitle, needsCam, hookDrop, setHookDrop } from '../lib/board.mjs';
import { ask as jevAsk, issuesOf as jevIssues, faceOf as jevFace, flagged as jevFlagged, KINDS as JEV_KINDS, USD_PER_TOKEN } from '../lib/jev.mjs';
import { CFG, chromeLaunch } from '../lib/config.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const RUNS = join(ROOT, 'runs');
mkdirSync(RUNS, { recursive: true });
const PORT = +process.env.PORT || 4901;
const FFMPEG = CFG.ffmpeg;
const only = process.argv.slice(2).filter((a) => !a.startsWith('--'));
const videos = () => readdirSync(RUNS).filter((d) => existsSync(join(RUNS, d, 'compare.json')) && (!only.length || only.includes(d))).sort();
const cmp = (v) => JSON.parse(readFileSync(join(RUNS, v, 'compare.json'), 'utf8'));
const videoOf = (r) => videos().find((v) => cmp(v).runs.includes(r));
const runDir = (r) => join(RUNS, r);
const baseDir = (v) => (readdirSync(join(RUNS, v)).some((f) => f.startsWith('raw.')) ? join(RUNS, v) : runDir(cmp(v).runs[0]));
const hasTake = (v) => readdirSync(join(RUNS, v)).some((f) => f.startsWith('raw.')) || cmp(v).runs.length > 0;
const durs = {};
const secs = (f) => { const k = `${f}@${statSync(f).mtimeMs}`; return (durs[k] ??= Number(execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', f]).toString())); };

function proxyOf(dir) {
  const real = realpathSync(rawOf(dir)), out = join(dirname(real), 'proxy.mp4');
  if (!existsSync(out) || statSync(out).mtimeMs < statSync(real).mtimeMs) {
    execFileSync(FFMPEG, ['-v', 'error', '-y', '-i', real, '-vf', 'fps=30,scale=540:960:force_original_aspect_ratio=increase,crop=540:960,setsar=1',
      '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '22', '-g', '15', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-b:a', '160k', '-movflags', '+faststart', out]);
  }
  return out;
}
function takeProxy(dir) {
  if (!wideOf(dir)) return proxyOf(dir);
  const real = realpathSync(rawOf(dir)), out = join(dirname(real), 'proxy-wide.mp4');
  if (!existsSync(out) || statSync(out).mtimeMs < statSync(real).mtimeMs) {
    execFileSync(FFMPEG, ['-v', 'error', '-y', '-i', real, '-vf', 'fps=30,scale=-2:960,setsar=1',
      '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '22', '-g', '15', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-b:a', '160k', '-movflags', '+faststart', out]);
  }
  return out;
}
// Media clips play in the preview from a <=960 px copy with a keyframe every 15 frames (fast seeks); Export reads the originals.
const PMEDIA = join(RUNS, '.preview-media'), pmQ = [], pmWant = new Set(), mthumbs = {};
let pmRun = false;
const pmOut = (real, ext) => join(PMEDIA, createHash('sha1').update(real).digest('hex').slice(0, 16) + ext);
const fresh = (out, real) => existsSync(out) && statSync(out).mtimeMs >= statSync(real).mtimeMs;
function mediaCopy(file) {
  const real = realpathSync(file), out = pmOut(real, '.mp4');
  if (fresh(out, real)) return out;
  if (!pmWant.has(out)) { pmWant.add(out); pmQ.push({ real, out }); pmNext(); }
  return null;
}
function pmNext() {
  if (pmRun || !pmQ.length) return;
  pmRun = true; mkdirSync(PMEDIA, { recursive: true });
  const { real, out } = pmQ.shift(), tmp = `${out}.part.mp4`;
  spawn(FFMPEG, ['-v', 'error', '-y', '-i', real, '-map', '0:v:0', '-map', '0:a:0?', '-vf', "scale='if(gt(iw,ih),min(960,iw),-2)':'if(gt(iw,ih),-2,min(960,ih))',setsar=1",
    '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '24', '-g', '15', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-b:a', '128k', '-movflags', '+faststart', tmp], { stdio: 'ignore' })
    .on('close', (code) => { try { if (code === 0) renameSync(tmp, out); else rmSync(tmp, { force: true }); } catch {} pmWant.delete(out); pmRun = false; pmNext(); });
}
function mediaThumb(file) {
  const real = realpathSync(file), out = pmOut(real, '.jpg');
  if (fresh(out, real)) return Promise.resolve(out);
  return (mthumbs[out] ??= new Promise((ok) => { mkdirSync(PMEDIA, { recursive: true }); spawn(FFMPEG, ['-v', 'error', '-y', '-ss', '1', '-i', real, '-frames:v', '1', '-vf', 'scale=320:-2', '-q:v', '5', out], { stdio: 'ignore' }).on('close', () => { delete mthumbs[out]; ok(existsSync(out) ? out : null); }); }));
}
const isVid = (f) => /\.(mp4|mov|m4v|webm)$/i.test(f);
const sendMedia = (req, res, file, type, url) => { const c = isVid(file) && !url.searchParams.has('orig') ? mediaCopy(file) : null; return sendFile(req, res, c || file, c ? 'video/mp4' : type); };
const srcInfo = {};
/** The original take as shot (not the 540x960 preview copy): what Export renders from. */
function sourceOf(dir) {
  const real = realpathSync(rawOf(dir)), k = `${real}@${statSync(real).mtimeMs}`;
  if (srcInfo[k]) return srcInfo[k];
  const j = JSON.parse(execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'stream=codec_type,codec_name,width,height,avg_frame_rate,sample_rate,bit_rate:format=size,duration,bit_rate', '-of', 'json', real]).toString());
  const v = j.streams.find((x) => x.codec_type === 'video') ?? {}, a = j.streams.find((x) => x.codec_type === 'audio'), [n, d] = (v.avg_frame_rate ?? '0/1').split('/').map(Number);
  return (srcInfo[k] = { w: v.width, h: v.height, fps: d ? Math.round((n / d) * 100) / 100 : null, codec: v.codec_name, mbps: Math.round(Number(v.bit_rate ?? j.format.bit_rate) / 1e5) / 10, mb: Math.round(Number(j.format.size) / 1e5) / 10, secs: Math.round(Number(j.format.duration) * 10) / 10, audio: a ? `${a.codec_name} ${Math.round(Number(a.sample_rate) / 1000)} kHz` : 'no audio', file: basename(real) });
}
const BGLIB = join(ROOT, 'library', 'backgrounds'), backgrounds = () => (existsSync(BGLIB) ? readdirSync(BGLIB).filter((f) => /\.(jpe?g|png|webp|mp4|webm|mov)$/i.test(f)).sort() : []);
const MIME = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.gif': 'image/gif', '.mp4': 'video/mp4', '.mov': 'video/quicktime', '.webm': 'video/webm' };
/** Every picture or clip this take can use: the project's media.json (compare.json `mediaFrom`) plus files dropped in runs/<v>/media/. `keys` = the file stems a version's effects use for it. */
function libraryOf(v) {
  const c = cmp(v), out = [], seen = new Set(), mb = (f) => Math.round(statSync(f).size / 1e5) / 10;
  if (c.mediaFrom && existsSync(join(c.mediaFrom, 'media.json'))) for (const i of JSON.parse(readFileSync(join(c.mediaFrom, 'media.json'), 'utf8')).items) {
    const f = join(c.mediaFrom, i.file); if (!existsSync(f) || i.q?.rejected || !MIME[extname(f).toLowerCase()]) continue;
    seen.add(`rpn-${i.id}`); out.push({ id: i.id, file: f, kind: i.kind === 'video' ? 'video' : 'image', role: i.role, credit: i.credit, caption: i.caption, w: i.w, h: i.h, seconds: i.seconds, mb: mb(f), keys: [`rpn-${i.id}`, i.id] });
  }
  const md = join(RUNS, v, 'media');
  if (existsSync(md)) for (const n of readdirSync(md)) { const stem = n.replace(/\.[^.]+$/, ''); if (seen.has(stem) || !MIME[extname(n).toLowerCase()]) continue; out.push({ id: stem, file: join(md, n), kind: /\.(mp4|mov|webm)$/i.test(n) ? 'video' : 'image', mb: mb(join(md, n)), keys: [stem] }); }
  return out;
}
const sourceLine = (s) => `${s.w}x${s.h} · ${s.fps} fps · ${s.codec} · ${s.mbps} Mbps · ${s.mb} MB · ${s.audio}`;
const takeDir = (dir) => dirname(proxyOf(dir));
const takeCache = (dir) => join(takeDir(dir), 'fx-cache');
const face = (dir) => { const p = proxyOf(dir); return faceZone(p, takeCache(dir), secs(p)); };
const analysis = (dir) => { const p = proxyOf(dir); return analyze(takeDir(dir), p, secs(p), face(dir), JSON.parse(readFileSync(join(dir, 'words.json'), 'utf8'))); };
const FACES_BIN = join(ROOT, 'bin/faces');
// Apple Vision face + hand boxes every 0.25 s of the take, cached per take: [{t, face, hands}] in source seconds.
function facesOf(dir) {
  const file = join(takeCache(dir), 'faces.json');
  if (existsSync(file)) return JSON.parse(readFileSync(file, 'utf8'));
  if (!existsSync(FACES_BIN)) execFileSync('swiftc', ['-O', join(ROOT, 'bin/faces.swift'), '-o', FACES_BIN]);
  const out = execFileSync(FACES_BIN, [proxyOf(dir), '0.25'], { maxBuffer: 1 << 26 }).toString();
  mkdirSync(takeCache(dir), { recursive: true });
  writeFileSync(file, out);
  return JSON.parse(out);
}
// Speaker box for the effects runtime (head point, head width, body box as frame fractions), from the Vision faces when no cut-out exists.
function subjectOf(dir) {
  facesOf(dir);
  return visionSubject(dir);
}
const area = (b) => Math.max(0, b[2]) * Math.max(0, b[3]);
const inter = (a, b) => area([0, 0, Math.min(a[0] + a[2], b[0] + b[2]) - Math.max(a[0], b[0]), Math.min(a[1] + a[3], b[1] + b[3]) - Math.max(a[1], b[1])]);
// Face per kept frame in output time and 1080x1920 px, padded for cap + chin: [t, x0, y0, x1, y1, handOnFace].
function facesOut(r, L) {
  const dir = runDir(r), F = facesOf(dir), out = [];
  for (const pc of L.pieces) for (const f of F) {
    if (!f.face || f.t < pc.s || f.t >= pc.e) continue;
    const [x, y, w, h] = f.face, hand = f.hands.some((b) => inter(b, f.face) > 0.25 * area(f.face));
    out.push([+(pc.o + f.t - pc.s).toFixed(2), Math.round((x - w * 0.12) * 1080), Math.round((y - h * 0.38) * 1920), Math.round((x + w * 1.12) * 1080), Math.round((y + h * 1.2) * 1920), hand ? 1 : 0]);
  }
  return out.sort((a, b) => a[0] - b[0]);
}
const geomFile = (r) => join(runDir(r), 'geom.json');
const hist = (r) => { const f = join(runDir(r), 'grades.jsonl'); return existsSync(f) ? readFileSync(f, 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l)) : []; };
const geomAll = (r) => (existsSync(geomFile(r)) ? JSON.parse(readFileSync(geomFile(r), 'utf8')) : {});
const geomOf = (r) => geomAll(r).issues ?? [];
const jsonl = (f) => (existsSync(f) ? readFileSync(f, 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l)) : []);

const clearRedo = (edits) => { for (const f of readdirSync(edits).filter((x) => /^redo-\d+\.json$/.test(x))) rmSync(join(edits, f)); };
const pool = async (items, n, fn) => { const q = [...items]; await Promise.all(Array.from({ length: n }, async () => { while (q.length) await fn(q.shift()); })); };

// Candidate plans the tune loop asks the page to scan: id -> {plan, done}. Lives only while that scan runs.
const cands = {};
const MATTES = {};
let candN = 0;
export async function scanPlan(browser, r, plan, win) {
  const id = `c${++candN}`, pg = await browser.newPage({ viewport: { width: 540, height: 960 } });
  const got = new Promise((done) => { cands[id] = { plan, done }; });
  try {
    await pg.goto(`http://127.0.0.1:${PORT}/play/${r}?scan=1&cand=${id}${win ? `&from=${Math.max(0, win[0]).toFixed(2)}&to=${win[1].toFixed(2)}` : ''}`);
    return await Promise.race([got, new Promise((_, no) => setTimeout(() => no(new Error(`scan of ${r} timed out`)), 120000))]);
  } finally { await pg.close(); delete cands[id]; }
}

// Pipeline per video. Each step: {id, label, state: todo|run|done|fail, secs, note}.
const PIPE = [['take', 'Load take'], ['words', 'Transcribe'], ['name', 'Name the take'], ['faces', 'Track face + hands'], ['analyze', 'Analyze take'], ['ideas', 'Cuts + effect ideas'], ['presets', 'Build preset grid'], ['title', 'Hook title below the chin'], ['plan', 'Plan versions'], ['rules', 'Rule book'], ['grade', 'Grade'], ['board', 'Board check']];
const pipes = {}, logs = {}, busy = {}, working = {};
const work = (v, r, on) => { (working[v] ??= new Set())[on ? 'add' : 'delete'](r); };
// runs/<video>/upstream.json {steps: [{id, label, state, note, secs}]}: steps that made the take (script, voice, avatar render), written by whoever runs them.
const upstream = (v) => { try { return JSON.parse(readFileSync(join(RUNS, v, 'upstream.json'), 'utf8')).steps.map((s) => ({ state: 'todo', secs: null, note: '', ...s, up: true })); } catch { return []; } };
const pipeOf = (v) => [...upstream(v), ...(pipes[v] ??= PIPE.map(([id, label]) => ({ id, label, state: 'todo', secs: null, note: '' })))];
const say = (v, s) => { (logs[v] ??= []).push(s); console.log(`[${v}] ${s}`); };
// Measured step times across takes (runs/.pipe-times.jsonl) give each step an expected length, so progress follows the clock, not the step count.
const TIMES = join(RUNS, '.pipe-times.jsonl'), DEFAULT_ETA = { take: 13, words: 66, name: 14, faces: 23, analyze: 5, ideas: 110, presets: 0.2, title: 7, plan: 1, rules: 0.3, grade: 0.5, board: 0.1 };
function etas() {
  let rows = [];
  try { rows = readFileSync(TIMES, 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l)); } catch {}
  return Object.fromEntries(PIPE.map(([id]) => { const xs = rows.filter((r) => r.id === id && r.secs > 0.05 && !r.cached).slice(-20).map((r) => r.secs).sort((a, b) => a - b); return [id, xs.length ? xs[Math.floor(xs.length / 2)] : DEFAULT_ETA[id] ?? 1]; }));
}
async function step(v, id, fn) {
  const st = pipeOf(v).find((x) => x.id === id), t0 = Date.now();
  st.state = 'run'; st.note = ''; st.secs = null; st.t0 = t0;
  await new Promise((r) => setTimeout(r, 30));
  try { st.note = (await fn()) ?? ''; st.state = 'done'; } catch (e) { st.state = 'fail'; st.note = String(e.message || e).slice(0, 200); }
  st.secs = +((Date.now() - t0) / 1000).toFixed(1);
  if (st.state === 'done') try { appendFileSync(TIMES, JSON.stringify({ id, secs: st.secs, v, at: new Date().toISOString(), cached: /already/.test(st.note) }) + '\n'); } catch {}
  say(v, `${st.state === 'fail' ? 'FAIL ' : ''}${st.label}: ${st.note} (${st.secs}s)`);
  if (st.state === 'fail') throw new Error(st.note);
}

async function scanAll(v, tag) {
  const { chromium } = await import('playwright-core');
  const browser = await chromium.launch(chromeLaunch({ handleSIGTERM: false, handleSIGINT: false, handleSIGHUP: false }));
  const c = cmp(v), out = [];
  try {
    await pool(c.runs, 4, async (r) => {
      const pg = await browser.newPage({ viewport: { width: 540, height: 960 } });
      await pg.goto(`http://127.0.0.1:${PORT}/play/${r}?scan=1`);
      await pg.waitForFunction(() => document.title.startsWith('scanned'), null, { timeout: 120000 });
      out.push(`${c.label[r]} ${(await pg.title()).replace('scanned ', '')}`);
      await pg.close();
    });
  } finally { await browser.close(); }
  return `${tag}: ${out.join(', ')} on screen`;
}

const takeOf = (r) => (L) => [...(existsSync(join(takeDir(runDir(r)), 'analysis.json')) ? takeIssues(analysis(runDir(r))) : []), ...handOnFace(facesOut(r, L))];
const faceBottom = (r) => (L) => Math.max(0, ...facesOut(r, L).filter((f) => f[0] < 3.3).map((f) => f[4]));

// Visual frame judge: key frames of a version on one contact sheet, looked at by the AI (lib/llm.mjs). runs/<r>/look.json.
const lookOf = (r) => (existsSync(join(runDir(r), 'look.json')) ? JSON.parse(readFileSync(join(runDir(r), 'look.json'), 'utf8')) : null);
async function look(browser, r) {
  const D = runData(r), dir = join(runDir(r), 'look');
  mkdirSync(dir, { recursive: true });
  const ts = [...new Set([1.2, ...D.fx.map((e) => e.t0 + Math.min(1.2, e.dur / 2)), ...Array.from({ length: 8 }, (_, k) => ((k + 0.5) * D.total) / 8)].map((t) => +Math.min(D.total - 0.1, t).toFixed(1)))].sort((a, b) => a - b).slice(0, 12);
  const pg = await browser.newPage({ viewport: { width: 540, height: 960 } });
  try {
    await pg.goto(`http://127.0.0.1:${PORT}/play/${r}`);
    await pg.waitForFunction(() => document.getElementById('va')?.readyState >= 2, null, { timeout: 60000 });
    await pg.waitForTimeout(800);
    for (const [k, t] of ts.entries()) { await pg.evaluate((t) => window.postMessage({ cmd: 'seek', t }, '*'), t); await pg.waitForTimeout(450); await pg.screenshot({ path: join(dir, `f${k}.png`) }); }
  } finally { await pg.close(); }
  const cols = 6, rows = Math.ceil(ts.length / cols), sheet = join(dir, 'sheet.jpg');
  const ins = ts.flatMap((_, k) => ['-i', join(dir, `f${k}.png`)]);
  const lab = ts.map((t, k) => `[${k}:v]scale=270:480,drawtext=fontfile=/System/Library/Fonts/Helvetica.ttc:text='${k + 1}  ${t.toFixed(1)}s':x=8:y=8:fontsize=22:fontcolor=yellow:box=1:boxcolor=black@0.7[v${k}]`).join(';');
  const pad = Array.from({ length: rows * cols - ts.length }, (_, k) => `color=black:s=270x480:d=1[p${k}]`).join(';');
  const all = [...ts.map((_, k) => `[v${k}]`), ...Array.from({ length: rows * cols - ts.length }, (_, k) => `[p${k}]`)];
  const layoutS = all.map((_, k) => `${(k % cols) * 270}_${Math.floor(k / cols) * 480}`).join('|');
  execFileSync(FFMPEG, ['-v', 'error', '-y', ...ins, '-filter_complex', `${lab}${pad ? ';' + pad : ''};${all.join('')}xstack=inputs=${all.length}:layout=${layoutS}`, '-frames:v', '1', '-q:v', '3', sheet]);
  const prompt = `Read the image ${sheet}. It is ${ts.length} frames (numbered, with the time in seconds) of ONE vertical Instagram Reel edit of a talking-head video: captions, a hook title in the first 3 s, effect cards.
List only problems a viewer would clearly notice: text over the speaker's face or eyes, two text blocks overlapping or crammed together, blurred / cut-off / unreadable text, text running off the frame, the face badly framed or cut off, a hand covering the face, an empty or broken-looking card. Ignore style taste. If a frame is fine, say nothing about it.
Return ONLY JSON: {"issues":[{"frame":n,"t":seconds,"sev":"bad"|"warn","what":"<one plain sentence>"}]}`;
  const t0 = Date.now(), out = await askJSON(prompt, { images: [sheet] });
  const res = { at: new Date().toISOString(), frames: ts.length, times: ts, secs: +((Date.now() - t0) / 1000).toFixed(0), sheet: `/look/${r}/sheet.jpg`, issues: (out.issues ?? []).map((i) => ({ rule: 'Looks wrong', sev: i.sev === 'bad' ? 'bad' : 'warn', t: i.t ?? ts[(i.frame ?? 1) - 1] ?? null, msg: `frame judge: ${i.what}` })) };
  writeFileSync(join(runDir(r), 'look.json'), JSON.stringify(res, null, 1));
  return res;
}
async function lookAll(v, n = 6) {
  const { chromium } = await import('playwright-core');
  const browser = await chromium.launch(chromeLaunch({ handleSIGTERM: false, handleSIGINT: false, handleSIGHUP: false }));
  const c = cmp(v), top = c.runs.map((r) => ({ r, g: runData(r).grade })).sort((a, b) => b.g - a.g).slice(0, n), out = [];
  try { await pool(top.map((x) => x.r), 3, async (r) => { work(v, r, true); const L = await look(browser, r).finally(() => work(v, r, false)); out.push(`${c.label[r]} ${L.issues.length}`); say(v, `looked at ${c.label[r]}: ${L.issues.length} problems in ${L.frames} frames (${L.secs} s)`); }); } finally { await browser.close(); }
  return `top ${top.length} by grade: ${out.join(', ')} problems seen (on your own AI plan)`;
}

// Hook title (center y, ~230 px tall + subtitle) goes below the lowest chin of the first 3.3 s, above the captions.
function placeTitle(r) {
  const f = join(runDir(r), 'plan.json'), p = JSON.parse(readFileSync(f, 'utf8'));
  if (p.titleMoved) return null;
  const L = layout(runDir(r), p);
  const zy = (row) => { const pc = L.pieces.find((x) => row[0] >= x.o && row[0] < x.o + x.e - x.s) ?? L.pieces[0], z = Math.max(...pc.z), ty = framing(z, pc.f)[1]; return [ty + row[2] * z, ty + row[4] * z]; };
  const F = facesOut(r, L).filter((x) => x[0] < 3.3).map(zy), top = Math.min(...F.map((x) => x[0])), bottom = Math.max(...F.map((x) => x[1]));
  const ty = p.titleY ?? 360;
  if (!F.length || ty + 120 < top || ty - 120 > bottom) return null;
  p.titleY = Math.min(1040, Math.round(bottom + 135));
  writeFileSync(f, JSON.stringify(p, null, 1));
  return p.titleY;
}

// Frame scan of one version, on demand (you opened it). One shared browser, one scan per version at a time.
let scanBrowser = null;
const scanning = {};
const sharedBrowser = async () => {
  if (!scanBrowser) { const { chromium } = await import('playwright-core'); scanBrowser = await chromium.launch(chromeLaunch({ handleSIGTERM: false, handleSIGINT: false, handleSIGHUP: false })); }
  return scanBrowser;
};

// One frame of the current edit at output time t: runs/<r>/shots/<plan mtime>-<t>.jpg, older edits' frames deleted.
const shotQ = {}, shotPg = {};
function shot(r, t) {
  const dir = join(runDir(r), 'shots'), ver = Math.round(Math.max(mt(join(runDir(r), 'plan.json')), mt(join(RUNS, videoOf(r) ?? '', 'board.json')))), f = join(dir, `${ver}-${t.toFixed(1)}.jpg`);
  if (existsSync(f)) return Promise.resolve(f);
  return (shotQ[r] = (shotQ[r] ?? Promise.resolve()).catch(() => {}).then(async () => {
    if (existsSync(f)) return f;
    mkdirSync(dir, { recursive: true });
    let P = shotPg[r];
    if (!P || P.ver !== ver) {
      if (P) await P.pg.close().catch(() => {});
      for (const x of readdirSync(dir)) if (!x.startsWith(`${ver}-`)) rmSync(join(dir, x), { force: true });
      const pg = await (await sharedBrowser()).newPage({ viewport: { width: 540, height: 960 } });
      await pg.goto(`http://127.0.0.1:${PORT}/play/${r}`);
      await pg.waitForFunction(() => document.getElementById('va')?.readyState >= 2, null, { timeout: 60000 });
      await pg.waitForTimeout(800);
      P = shotPg[r] = { pg, ver };
    }
    clearTimeout(P.idle); P.idle = setTimeout(() => { P.pg.close().catch(() => {}); if (shotPg[r] === P) delete shotPg[r]; }, 120000);
    await P.pg.evaluate((t) => window.postMessage({ cmd: 'seek', t }, '*'), t);
    await P.pg.waitForTimeout(450);
    await P.pg.screenshot({ path: f, type: 'jpeg', quality: 70 });
    return f;
  }));
}

// Same frame drawn in another caption / hook look, for the picture menus: runs/<r>/stylepics/<plan mtime>-<style>-<hook>-<t>.jpg.
const picPool = [], picWait = [];
async function picPage() {
  const free = picPool.find((p) => !p.busy);
  if (free) { free.busy = true; return free; }
  if (picPool.length < 3) { const p = { busy: true, pg: await (await sharedBrowser()).newPage({ viewport: { width: 360, height: 640 } }) }; picPool.push(p); return p; }
  return new Promise((ok) => picWait.push(ok));
}
function picDone(p) { const next = picWait.shift(); if (next) next(p); else p.busy = false; }
const picQ = {};
function stylePic(r, style, hook, t, ov = '') {
  const dir = join(runDir(r), 'stylepics'), ver = Math.round(mt(join(runDir(r), 'plan.json')) + mt(join(ROOT, 'preview/titlestyle.js')) + mt(join(ROOT, 'effects/runtime.js'))), f = join(dir, `${ver}-${style}-${hook}-${t.toFixed(1)}${ov ? `-${ov.replace(/[^\w-]/g, '_')}` : ''}.jpg`);
  if (existsSync(f)) return Promise.resolve(f);
  return (picQ[f] ??= (async () => {
    mkdirSync(dir, { recursive: true });
    for (const x of readdirSync(dir)) if (!x.startsWith(`${ver}-`)) rmSync(join(dir, x), { force: true });
    const P = await picPage();
    let broke = false;
    try {
      await P.pg.goto(`http://127.0.0.1:${PORT}/play/${r}?style=${encodeURIComponent(style)}&titleStyle=${encodeURIComponent(hook)}&sample=1${ov ? `&ov=${encodeURIComponent(ov)}` : ''}`, { timeout: 20000, waitUntil: 'domcontentloaded' });
      await P.pg.waitForFunction(() => document.getElementById('va')?.readyState >= 2 && (!document.getElementById('capframe') || document.getElementById('capframe').contentWindow.CL_READY), null, { timeout: 20000 });
      await P.pg.evaluate(() => document.fonts.ready);
      await P.pg.evaluate((t) => window.postMessage({ cmd: 'seek', t }, '*'), t);
      await P.pg.waitForTimeout(600);
      await P.pg.screenshot({ path: f, type: 'jpeg', quality: 72 });
      await P.pg.goto('about:blank').catch(() => {});
      return f;
    } catch (e) { broke = true; throw e; } finally {
      if (broke) { picPool.splice(picPool.indexOf(P), 1); P.pg.close().catch(() => {}); const next = picWait.shift(); if (next) picPage().then(next); } else picDone(P);
      delete picQ[f];
    }
  })());
}

const looking = {};
function lookOne(r) {
  return (looking[r] ??= (async () => {
    const v = videoOf(r); work(v, r, true);
    try { const L = await look(await sharedBrowser(), r); say(v, `frame judge on ${cmp(v).label[r]}: ${L.issues.length} flagged in ${L.frames} frames`); return L; }
    finally { work(v, r, false); delete looking[r]; }
  })());
}

// Jev check: every frame at 2 fps, 6 pages capture while up to 16 Jev calls run. runs/<r>/jev.json, frames in runs/<r>/jev/.
const jevJobs = {};
const jevOf = (r) => (existsSync(join(runDir(r), 'jev.json')) ? JSON.parse(readFileSync(join(runDir(r), 'jev.json'), 'utf8')) : null);
function jevCheck(r) {
  if (jevJobs[r]?.state === 'run') return jevJobs[r];
  const D = runData(r), v = videoOf(r), dir = join(runDir(r), 'jev'), ts = Array.from({ length: Math.floor(D.total * 2) }, (_, i) => +((i + 0.5) / 2).toFixed(2));
  const J = (jevJobs[r] = { state: 'run', phase: 'Opening the edit', total: ts.length, captured: 0, done: 0, cached: 0, tokens: 0, ms: [], live: ts.map(() => 0), t0: Date.now(), ver: planHash(r) });
  rmSync(`${dir}-prev`, { recursive: true, force: true }); if (existsSync(dir)) renameSync(dir, `${dir}-prev`); mkdirSync(dir, { recursive: true });
  (async () => {
    const frames = [], calls = [], q = ts.map((t, n) => ({ t, n })), browser = await sharedBrowser();
    let live = 0, settleQ = null, allIn; const waiters = [], slot = () => (live < 16 ? (live++, Promise.resolve()) : new Promise((ok) => waiters.push(ok))), free = () => { const w = waiters.shift(); w ? w() : live--; };
    const captured = new Promise((ok) => (allIn = ok));
    const settleList = async () => { await captured; await Promise.all(calls); if (!settleQ) { settleQ = frames.filter((f) => jevFlagged(f.a)); J.settleN = settleQ.length; J.phase = `Second look 0.2 s later at ${settleQ.length} flagged frames (text may still be animating in)`; settleQ = [...settleQ]; } return settleQ; };
    await Promise.all(Array.from({ length: 6 }, async () => {
      const pg = await browser.newPage({ viewport: { width: 360, height: 640 } });
      try {
        await pg.goto(`http://127.0.0.1:${PORT}/play/${r}`);
        await pg.waitForFunction(() => document.getElementById('va')?.readyState >= 2 && window.__ySnap, null, { timeout: 60000 });
        J.phase = 'Capturing frames + asking Jev';
        while (q.length) {
          const { t, n } = q.shift(), targets = await pg.evaluate((t) => window.__ySnap(t), t), file = join(dir, `${n}.jpg`);
          const jpg = await pg.screenshot({ type: 'jpeg', quality: 75 }); writeFileSync(file, jpg); J.captured++; J.live[n] = 1; if (J.captured === ts.length) { J.capSecs = +((Date.now() - J.t0) / 1000).toFixed(1); allIn(); }
          calls.push(slot().then(() => jevAsk(jpg)).then((x) => { J.done++; J.live[n] = Math.max(...Object.entries(x.a).filter(([k, y]) => y.type === 'noul' && k !== 'face_ok').map(([, y]) => y.noul), 1 - (x.a.face_ok?.noul ?? 1)) >= 0.6 ? 3 : 2; J.tokens += x.tokens; if (x.cached) J.cached++; else J.ms.push(x.ms); frames.push({ n, t, a: x.a, face: jevFace(x.a), targets }); }).finally(free));
        }
        const sq = await settleList();
        while (sq.length) {
          const f = sq.shift(), t2 = +Math.min(D.total - 0.05, f.t + 0.2).toFixed(2);
          await pg.evaluate((t) => window.__ySnap(t), t2);
          const x = await jevAsk(await pg.screenshot({ type: 'jpeg', quality: 75 }));
          f.settle = x.a; J.tokens += x.tokens; J.settled = (J.settled ?? 0) + 1;
        }
      } finally { await pg.close(); }
    }));
    await Promise.all(calls);
    frames.sort((a, b) => a.t - b.t);
    const prev = jevOf(r), issues = jevIssues(frames), dropped = frames.filter((f) => f.settle && !jevFlagged(f.settle) && jevFlagged(f.a)).length, secs = +((Date.now() - J.t0) / 1000).toFixed(1), cost = +(J.tokens * USD_PER_TOKEN).toFixed(4);
    const ms = [...J.ms].sort((a, b) => a - b), res = { at: new Date().toISOString(), ver: J.ver, frames: frames.length, cached: J.cached, rechecked: J.settleN ?? 0, dropped, secs, capSecs: J.capSecs, jevMs: { median: ms[ms.length >> 1], max: ms.at(-1) }, tokens: J.tokens, cost, issues, prev: prev ? { at: prev.at, ids: prev.issues.map((i) => i.id) } : null, times: frames.map((f) => [f.t, ...Object.keys(JEV_KINDS).filter((k) => k !== 'face_gone').map((k) => +Math.min(f.a[k]?.noul ?? 0, f.settle?.[k]?.noul ?? 1).toFixed(2)), +(1 - (f.a.face_ok?.noul ?? 1)).toFixed(2)]) };
    writeFileSync(join(runDir(r), 'jev.json'), JSON.stringify(res, null, 1));
    Object.assign(J, { state: 'done', phase: 'Done', secs, cost });
    say(v, `JEV ${cmp(v).label[r]}: ${frames.length} frames (${J.cached} unchanged) in ${secs} s, ${issues.length} issues, $${cost} billed to TypeSafe`);
  })().catch((e) => { Object.assign(J, { state: 'fail', error: String(e.message || e).slice(0, 300) }); say(v, `JEV FAIL ${r}: ${J.error}`); });
  return J;
}
// Accepted frame-check issues with no direct fix: the AI (lib/llm.mjs) looks at the frames and picks edits from the move API, then the check re-runs.
const fixJobs = {};
function jevFix(r, ids) {
  if (fixJobs[r]?.state === 'run') return fixJobs[r];
  const R = jevOf(r), v = videoOf(r), iss = (R?.issues ?? []).filter((i) => ids.includes(i.id)), F = (fixJobs[r] = { state: 'run', phase: `Claude is looking at ${iss.length} problem${iss.length === 1 ? '' : 's'}`, n: iss.length, t0: Date.now(), applied: [], skipped: [] });
  (async () => {
    const p = JSON.parse(readFileSync(join(runDir(r), 'plan.json'), 'utf8')), D = runData(r);
    const fx = (p.effects ?? []).map((e, k) => ({ k, fx: e.fx, name: e.fx === 'media-card' ? 'image/video card' : e.fx, t: D.fx?.[k]?.t0 ?? e.t, dur: D.fx?.[k]?.dur ?? e.dur, dx: e.dx ?? 0, dy: e.dy ?? 0, scale: e.scale ?? 1 }));
    const list = iss.map((i) => ({ id: i.id, problem: i.rule, from: i.t0, to: i.t1, frame: join(runDir(r), 'jev', `${i.n}.jpg`), face: i.face, wrong_box: i.target, on_screen: i.targets }));
    const prompt = `You fix a vertical 1080x1920 talking-head Reel edit. Each problem below has a frame image (Read it; it is a 360x640 screenshot of the edit; boxes are in 1080x1920 pixels).
Problems: ${JSON.stringify(list)}
Effect cards (k = index): ${JSON.stringify(fx)}
Captions shift captionDY=${p.captionDY ?? 0}, hook title y=${p.titleY ?? 360}.
Pick the smallest edit that fixes each problem visually without causing a new one. Never delete an effect unless the problem is the effect being there at all; if the bug is inside an effect or the caption style, skip it and say so (no text or card over the face, no text over other text, everything inside the frame). Allowed ops:
{"op":"move","what":"fx"|"title"|"captions","k":<fx k>,"dx":px,"dy":px}  (captions: dy only)
{"op":"scale","k":<fx k>,"scale":0.5-1.5,"dx":<absolute dx>,"dy":<absolute dy>}
{"op":"time","k":<fx k>,"t":seconds,"dur":seconds}
{"op":"delete","k":<fx k>}
If a problem cannot be fixed with these ops (e.g. a caption style that fades words on purpose, a zoom framing), skip it with a short reason.
Return ONLY JSON: {"ops":[{...,"id":"<problem id>","why":"<one plain sentence>"}],"skip":[{"id":"...","why":"..."}]}`;
    const out = await askJSON(prompt, { images: list.map((x) => x.frame) });
    F.phase = `Applying ${out.ops?.length ?? 0} edit${out.ops?.length === 1 ? '' : 's'}`; F.skipped = out.skip ?? [];
    const label = (k) => fx[k]?.name ?? 'card';
    for (const o of out.ops ?? []) {
      const body = o.op === 'move' ? { what: o.what, k: o.k, dx: Math.round(o.dx || 0), dy: Math.round(o.dy || 0), label: o.what === 'fx' ? label(o.k) : o.what }
        : o.op === 'scale' ? { what: 'fx', k: o.k, set: { scale: o.scale, dx: o.dx, dy: o.dy }, label: label(o.k) }
        : o.op === 'time' ? { what: 'fxtime', k: o.k, t: o.t, dur: o.dur, mode: 'move', label: label(o.k) }
        : o.op === 'delete' ? { what: 'delete', item: { what: 'fx', k: o.k }, label: label(o.k) } : null;
      if (!body) continue;
      const j = await fetch(`http://127.0.0.1:${PORT}/api/move/${r}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }).then((x) => x.json()).catch((e) => ({ ok: false, error: e.message }));
      (j.ok ? F.applied : F.skipped).push({ id: o.id, why: j.ok ? o.why : `${o.why} (could not apply: ${j.error})` });
    }
    F.secs = +((Date.now() - F.t0) / 1000).toFixed(1);
    say(v, `JEV FIX ${cmp(v).label[r]}: ${F.applied.length} edits, ${F.skipped.length} skipped in ${F.secs} s (on your own AI plan)`);
    Object.assign(F, { state: 'done', phase: 'Done' });
    if (F.applied.length) jevCheck(r);
  })().catch((e) => { Object.assign(fixJobs[r], { state: 'fail', error: String(e.message || e).slice(0, 300) }); say(v, `JEV FIX FAIL ${r}: ${e.message}`); });
  return F;
}
const planHash = (r) => createHash('sha1').update(readFileSync(join(runDir(r), 'plan.json'))).digest('hex').slice(0, 12);
const jevView = (r) => { const J = jevJobs[r], R = jevOf(r); return { job: J ? { state: J.state, phase: J.phase, total: J.total, captured: J.captured, done: J.done, cached: J.cached, live: J.live.join(''), secs: +((Date.now() - J.t0) / 1000).toFixed(1), cost: +(J.tokens * USD_PER_TOKEN).toFixed(4), error: J.error } : null, result: R, stale: !!R && R.ver !== planHash(r) }; };

function scanOne(r) {
  return (scanning[r] ??= (async () => {
    const v = videoOf(r); work(v, r, true);
    try {
      await sharedBrowser();
      const pg = await scanBrowser.newPage({ viewport: { width: 540, height: 960 } }), t0 = Date.now();
      try { await pg.goto(`http://127.0.0.1:${PORT}/play/${r}?scan=1`); await pg.waitForFunction(() => document.title.startsWith('scanned'), null, { timeout: 120000 }); say(v, `scanned ${cmp(v).label[r]}: ${(await pg.title()).replace('scanned ', '')} findings (${((Date.now() - t0) / 1000).toFixed(1)} s)`); }
      finally { await pg.close(); }
    } finally { work(v, r, false); delete scanning[r]; }
  })());
}

// You pick a version and asks to improve it: tune it (every try logged), re-scan it in full, frame judge, grade.
const improving = {};
async function improve(r) {
  const v = videoOf(r), c = cmp(v), t0 = Date.now();
  if (improving[r]) return;
  improving[r] = true; work(v, r, true);
  const { chromium } = await import('playwright-core');
  const browser = await chromium.launch(chromeLaunch({ handleSIGTERM: false, handleSIGINT: false, handleSIGHUP: false }));
  try {
    say(v, `IMPROVE ${c.label[r]}: start at ${runData(r).grade}`);
    const { log, tries } = await tune(runDir(r), c.judge[r], face(runDir(r)), { scan: (q, win) => scanPlan(browser, r, q, win), take: takeOf(r), faceBottom: faceBottom(r) });
    const pg = await browser.newPage({ viewport: { width: 540, height: 960 } });
    await pg.goto(`http://127.0.0.1:${PORT}/play/${r}?scan=1`);
    await pg.waitForFunction(() => document.title.startsWith('scanned'), null, { timeout: 120000 });
    await pg.close();
    const row = (kind, label, prev) => { const d = runData(r); appendFileSync(join(runDir(r), 'grades.jsonl'), JSON.stringify({ i: hist(r).length, at: new Date().toISOString(), kind, label, grade: d.grade, from: prev, delta: +(d.grade - prev).toFixed(1), kept: true, parts: d.parts }) + '\n'); return d.grade; };
    const g1 = row('rescan', 'Full frame re-scan after tuning', log.at(-1).grade);
    const L = await look(browser, r);
    row('look', `Frame judge looked at ${L.frames} frames: ${L.issues.length ? L.issues.map((i) => i.msg.replace('frame judge: ', '')).join(' / ').slice(0, 160) : 'nothing wrong'}`, g1);
    say(v, `IMPROVE ${c.label[r]}: ${log[0].grade} -> ${runData(r).grade} (${tries} tries, ${log.filter((x) => x.kind === 'keep').length} kept, frame judge saw ${L.issues.length}, ${((Date.now() - t0) / 1000).toFixed(0)} s)`);
  } catch (e) { say(v, `IMPROVE ${c.label[r]} STOPPED: ${e.message}`); }
  finally { await browser.close(); improving[r] = false; work(v, r, false); }
}

// Tune every version: each candidate fix is scanned in a real page and graded; all tries logged.
async function tuneAll(v) {
  const { chromium } = await import('playwright-core');
  const browser = await chromium.launch(chromeLaunch({ handleSIGTERM: false, handleSIGINT: false, handleSIGHUP: false }));
  const c = cmp(v), out = [];
  try {
    await pool(c.runs, 4, async (r) => {
      const t0 = Date.now(); work(v, r, true);
      const { log, tries } = await tune(runDir(r), c.judge[r], face(runDir(r)), { scan: (q, win) => scanPlan(browser, r, q, win), take: takeOf(r), faceBottom: faceBottom(r) });
      const best = log.filter((x) => x.kept).at(-1).grade, start = log[0].grade;
      out.push(`${c.label[r]} ${start}->${best} (${tries} tries, ${log.filter((x) => x.kind === 'try' && x.kept).length} kept, ${((Date.now() - t0) / 1000).toFixed(0)}s)`);
      say(v, `tuned ${out.at(-1)}`); work(v, r, false);
    });
  } finally { await browser.close(); }
  return out.join(', ');
}

// your hand edits in the page (drag, resize, style picks) survive a rebuild.
const ZOOM_NAMES = { snap: 'punch zoom', slow: 'slow push', hold: 'tight crop', camdrop: 'camera drop', dvzoom: 'push-in zoom', dvhook: 'hook push', dvpush: 'push and settle', dvpull: 'pull out and punch', dvpunch: 'wind-up punch' };
const ZOOM_KINDS = Object.keys(ZOOM_NAMES);
// Set by page pickers without an undo snapshot, so undo/redo must leave them as they are.
const NOTE_KEYS = ['title', 'subtitle', 'titleEdited', 'titleDur', 'titleStyle', 'captionStyle', 'capHold', 'quietTitle', 'cam', 'camdrop', 'color', 'colorAmt', 'theme', 'hookSound', 'sfxEdits', 'sfxAdd', 'soundPack'];
const keepNoteKeys = (cur, f) => { const p = JSON.parse(readFileSync(f, 'utf8')); for (const k of NOTE_KEYS) { if (k in cur) p[k] = cur[k]; else delete p[k]; } writeFileSync(f, JSON.stringify(p, null, 1)); };
const HAND_KEYS = ['lockEdges', 'sfxAdd', 'titleAnim', 'titleWt', 'sfxEdits', 'hookCaps', 'titleY', 'titleDX', 'titleScale', 'titleMoved', 'titleStyle', 'theme', 'color', 'colorAmt', 'captionDY', 'captionScale', 'captionStyle', 'capHold', 'cam', 'camdrop', ...MOVE_KINDS, 'board', 'soundPack', 'hookSound', 'flow', 'quietTitle', 'titleDur', 'titleColor'];
async function pipeline(v, fresh) {
  if (busy[v]) return;
  if (!hasTake(v)) return say(v, 'waiting for the take (upstream steps still running)');
  busy[v] = true;
  const c = cmp(v), dirs = c.runs.map(runDir), base = baseDir(v);
  pipes[v] = null; pipeOf(v);
  const hand = {};
  if (fresh) for (const d of dirs) {
    if (existsSync(join(d, 'plan.json'))) { const p = JSON.parse(readFileSync(join(d, 'plan.json'), 'utf8')); hand[d] = Object.fromEntries((p.titleEdited ? [...HAND_KEYS, 'title', 'subtitle', 'titleEdited'] : HAND_KEYS).filter((k) => p[k] != null).map((k) => [k, p[k]])); }
    if (existsSync(join(d, 'plan.orig.json'))) copyFileSync(join(d, 'plan.orig.json'), join(d, 'plan.json'));
    for (const f of ['grades.jsonl', 'geom.json']) rmSync(join(d, f), { force: true });
  }
  try {
    await step(v, 'take', () => { const p = proxyOf(base); return `${secs(p).toFixed(0)} s take · source ${sourceLine(sourceOf(base))} · preview plays a 540x960 copy, export uses the source`; });
    await step(v, 'words', async () => { const t0 = Date.now(), w = await transcribe(base, rawOf(base), (s) => say(v, `transcribe: ${s}`)); return `${w.length} words, Parakeet text + Qwen3 word timing (${((Date.now() - t0) / 1000).toFixed(0)} s)`; });
    await step(v, 'name', async () => { const cur = cmp(v); if (cur.name) return `"${cur.name}" (already named)`; if (cur.title && cur.title !== String(cur.take ?? '').replace(/\.[^.]+$/, '')) { setName(v, cur.title, 'hand'); return `"${cur.title}" (title already set by hand)`; } const script = existsSync(join(RUNS, v, 'script.txt')) ? readFileSync(join(RUNS, v, 'script.txt'), 'utf8') : ''; const n = await nameTake(JSON.parse(readFileSync(join(base, 'words.json'), 'utf8')), script); if (!n) return 'no words, kept the file name'; setName(v, n, 'claude'); return `"${n}" from what is said (${provider()}, fast model)`; });
    await step(v, 'faces', () => { const t0 = Date.now(), f = facesOf(base); return `${f.filter((x) => x.face).length}/${f.length} frames with a face, ${f.filter((x) => x.hands.length).length} with hands (Apple Vision, ${((Date.now() - t0) / 1000).toFixed(1)} s)`; });
    await step(v, 'analyze', () => { const a = analysis(base); return `voice ${a.lufs} LUFS, caption band ${a.captionLuma}/255, face y ${a.face.y0}-${a.face.y1}, ${a.wpm} wpm, ${a.longPauses} pauses > 1 s`; });
    await step(v, 'ideas', async () => { if (existsSync(join(RUNS, v, 'ideas.json'))) return 'ideas.json already there'; const t0 = Date.now(), w = JSON.parse(readFileSync(join(base, 'words.json'), 'utf8')), script = existsSync(join(RUNS, v, 'script.txt')) ? readFileSync(join(RUNS, v, 'script.txt'), 'utf8') : ''; const i = await makeIdeas(join(RUNS, v), w, face(base), secs(proxyOf(base)), (s) => say(v, s), script); return `${Object.keys(i.cuts).join('/')} cuts, ${i.effects.length} effect ideas, judged (${((Date.now() - t0) / 1000).toFixed(0)} s, on your own AI plan)`; });
    await step(v, 'presets', () => { if (!existsSync(join(RUNS, v, 'ideas.json'))) return 'no ideas.json yet - personas only'; const t0 = performance.now(), made = makePresets(RUNS, v, base === join(RUNS, v) ? v : c.runs[0], { force: fresh }); Object.assign(c, cmp(v)); const st = existsSync(join(RUNS, v, 'style.json')) ? JSON.parse(readFileSync(join(RUNS, v, 'style.json'), 'utf8')) : null; if (st) applyStyle(st, c.runs.map(runDir)); for (const [d, h] of Object.entries(hand)) if (Object.keys(h).length && existsSync(join(d, 'plan.json'))) { const p = JSON.parse(readFileSync(join(d, 'plan.json'), 'utf8')); writeFileSync(join(d, 'plan.json'), JSON.stringify({ ...p, ...h }, null, 1)); } return `${made.length} presets (clean/light/medium/heavy x full/60/30) in ${(performance.now() - t0).toFixed(0)} ms${st ? `, style copied from ${st.creator || st.url}` : ''}`; });
    await step(v, 'title', () => cmp(v).runs.map((r) => { const y = placeTitle(r); return y ? `${cmp(v).label[r]} -> y ${y}` : null; }).filter(Boolean).join(', ') || 'every hook title already clear of the face');
    await step(v, 'plan', () => c.runs.map((r) => `${c.label[r]} ${layout(runDir(r)).total.toFixed(0)}s`).join(', '));
    await step(v, 'rules', () => c.runs.map((r) => `${c.label[r]} ${timing(layout(runDir(r))).length}`).join(', ') + ' timing issues');
    await step(v, 'grade', () => c.runs.map((r) => `${c.label[r]} ${runData(r).grade}`).join(', '));
    await step(v, 'board', () => boardCheck(v));
    say(v, 'PIPELINE DONE');
  } catch (e) { say(v, `PIPELINE STOPPED: ${e.message}`); }
  busy[v] = false;
}

function runData(r, cand) {
  const plan = cands[cand]?.plan, v = videoOf(r), c = cmp(v), dir = runDir(r), L = layout(dir, plan), toSrc = srcTime(L.pieces);
  const stills = (e) => (e.cat.stills && !e.params.images && !e.params.image
    ? Array.from({ length: e.cat.stills }, (_, i) => `/still/${r}/${toSrc(((i + 0.5) * L.total) / e.cat.stills).toFixed(2)}.jpg`) : undefined);
  const fx = L.fx.map((e) => ({ k: e.k, fx: e.fx, t0: e.t0, dur: e.dur, params: e.params, matte: !!e.cat.matte || e.params?.cutout === 'on' || !!e.params?.meBg,
    assets: { ...(stills(e) ? { images: stills(e) } : {}), ...(e.cat.freeze ? { freeze: `/still/${r}/${toSrc(e.t0 + 0.02).toFixed(2)}.jpg` } : {}) } }));
  const faces = facesOut(r, L), lk = cand ? null : lookOf(r), planAt = mt(join(dir, 'plan.json'));
  const stale = { frames: !cand && !!geomAll(r).stale, judge: !!lk && Date.parse(lk.at) < planAt - 1000 };
  const tk = [...(existsSync(join(takeDir(dir), 'analysis.json')) ? takeIssues(analysis(dir)) : []), ...handOnFace(faces), ...(lk?.issues ?? []).map((i) => ({ ...i, src: 'judge', stale: stale.judge }))];
  const g = grade(L, c.judge[r], geomOf(r), tk);
  const issues = onScreen(L, [...timing(L), ...geomOf(r).map((i) => ({ ...i, src: 'frames', stale: stale.frames })), ...tk]).map((i, n) => ({ ...i, id: `${r}:${n}`, fix: FIX[i.rule] ?? '' })).sort((a, b) => (a.t ?? -1) - (b.t ?? -1));
  const p = plan ?? JSON.parse(readFileSync(join(dir, 'plan.json'), 'utf8'));
  const a = existsSync(join(takeDir(dir), 'analysis.json')) ? analysis(dir) : null;
  return {
    scanned: existsSync(geomFile(r)) && !geomAll(r).stale, created: birth(dir), updated: Math.max(...['plan.json', 'grades.jsonl', 'look.json', 'geom.json'].map((f) => mt(join(dir, f)))) || null,
    script: scriptOf(L), checks: checks(L, issues, { ...geomAll(r), faces, visual: lk }, a), look: lk, preset: c.preset?.[r] ?? null, faces,
    intent: { who: c.persona?.[r]?.name ?? c.preset?.[r]?.name ?? 'Hand-made', brief: c.persona?.[r]?.brief ?? c.preset?.[r]?.brief ?? '', style: p.style ?? c.persona?.[r]?.style ?? '',
      captionStyle: p.captionStyle || 'tg-active-now', title: p.title, subtitle: p.subtitle ?? '',
      effects: L.fx.map((e) => ({ fx: e.fx, name: byId[e.fx]?.name ?? e.fx, t0: +e.t0.toFixed(2), dur: e.dur, why: (p.effects ?? [])[e.k]?.why ?? '' })) },
    run: r, video: v, total: L.total, title: p.title, face: face(dir), safe: SAFE,
    pieces: L.pieces.map((x) => [+x.o.toFixed(3), +x.s.toFixed(3), +x.e.toFixed(3), +x.z[0].toFixed(4), +x.z[1].toFixed(4), x.f?.[0] ?? null, x.f?.[1] ?? null, x.mute ? 1 : 0]),
    captions: L.captions, sfx: L.sfx.map((x) => ({ url: `/sfx/${encodeURIComponent(x.ref)}`, ref: x.ref, at: x.at, sound: x.sound, db: x.db ?? 0, len: x.len ?? null })),
    fx, issues, grade: g.total, parts: g.parts, partWhy: g.why, beats: g.beats, format: g.format, repairs: p.repairs ?? [], weakest: g.weakest, history: hist(r), label: c.label[r], why: c.judge[r].why, persona: c.persona?.[r] ?? null, captionStyle: p.captionStyle || 'tg-active-now', hookSound: p.hookSound ?? null, titleStyle: p.titleStyle || 'serif', theme: themeId(p.theme), color: gradeId(p.color), colorAmt: gradeAmt(p.colorAmt), soundPack: packOf(p) ? (soundPacks().packs[p.soundPack] ? p.soundPack : soundPacks().active) : null,
    zooms: zoomsOf(L), flow: L.flow, path: L.path, stale, board: needsCam(p) ? boardOf(v, L, facesOf(dir), p.cam) : null, cam: p.cam || hookDrop(L) ? 'hook-drop' : null, quietTitle: !!p.quietTitle, capHold: !!p.capHold, hook: { y: camTitle(p) ? CAM_TITLE_Y : p.titleY ?? 360, dx: p.titleDX ?? 0, scale: p.titleScale ?? 1, dur: p.titleDur ?? 3.2, color: p.titleColor || '', anim: p.titleAnim || '', still: /-static$/.test(p.titleStyle || '') },
    cuts: L.pieces.length - 1, words: L.captions.filter((x) => x.kind === 'cap').length,
  };
}

function boardOf(v, L, faces, cam) {
  const b = boardFor(join(RUNS, v), L, faces, cam);
  return b && { ...b, assets: `/boardart/${v}/` };
}

// Every version with a board: pictures centered in their circles + no board items overlapping (bin/board-check.mjs, ~30 s each).
async function boardCheck(v) {
  const rs = cmp(v).runs.filter((r) => { try { return JSON.parse(readFileSync(join(runDir(r), 'plan.json'), 'utf8')).board; } catch { return false; } });
  if (!rs.length) return 'no board in this video';
  const out = [];
  for (const r of rs) {
    const res = await new Promise((ok) => { const c = spawn(process.execPath, [join(ROOT, 'bin/board-check.mjs'), r, join(runDir(r), 'board-check')], { env: { ...process.env, PORT } }); let o = ''; c.stdout.on('data', (d) => (o += d)); c.stderr.on('data', (d) => (o += d)); c.on('close', (code) => ok({ code, o: o.trim().split('\n') })); });
    out.push(`${cmp(v).label[r]}: ${res.o.at(-1)}`);
    if (res.code) throw new Error(`${cmp(v).label[r]}: ${res.o.slice(-4).join(' / ')}`);
  }
  return out.join(', ');
}

// Play-order script: kept words with their output time, cut words between them struck, a jump marker on reorders.
function scriptOf(L) {
  const kept = L.words.map((w, i) => ({ i, text: w.text, o: L.outAt(w.start + 0.01) })).filter((x) => x.o != null).sort((a, b) => a.o - b.o);
  const out = [], cut = (a, b) => { for (let j = a; j < b; j++) out.push({ i: j, text: L.words[j].text, o: null, cut: true }); };
  if (kept[0] && kept[0].i <= 40) cut(0, kept[0].i);
  kept.forEach((x, k) => {
    const pr = kept[k - 1];
    if (pr && x.i > pr.i + 1 && x.i - pr.i <= 40) cut(pr.i + 1, x.i);
    else if (pr && x.i !== pr.i + 1) out.push({ jump: true, o: +x.o.toFixed(2) });
    if (pr && x.i === pr.i + 1) {
      const gone = L.words[x.i].start - L.words[pr.i].start - (x.o - pr.o);
      const set = (L.p.pauseSet ?? []).find((q) => q.after === pr.i), A = L.words[pr.i], B = L.words[x.i];
      const sq = (L.p.squeeze ?? []).filter(([a, b]) => a < B.end && b > A.start && !(L.p.unsqueeze ?? []).some(([u, v]) => u < b && v > a));
      const full = set ? set.to - set.from : sq.length ? Math.max(...sq.map((q) => q[1])) - Math.min(...sq.map((q) => q[0])) + 0.24 : Math.max(gone, B.start - A.end);
      const played = set ? set.secs : Math.max(0, full - gone);
      if (gone >= 0.1 || set) out.push({ pause: true, after: pr.i, secs: +gone.toFixed(2), played: +played.toFixed(2), full: +full.toFixed(2), set: !!set, o: +x.o.toFixed(2) });
    }
    out.push({ i: x.i, text: x.text, o: +x.o.toFixed(2) });
  });
  return out;
}

function ideasOf(v) {
  let d; try { d = JSON.parse(readFileSync(join(RUNS, v, 'edit-ideas.json'), 'utf8')); } catch { return null; }
  if (!Array.isArray(d.ideas) || !d.ideas.length) return null;
  const dec = {}; for (const x of jsonl(join(RUNS, v, 'edit-ideas-decisions.jsonl'))) dec[x.id] = x;
  return { ...d, ideas: d.ideas.map((i) => ({ ...i, decision: dec[i.id]?.decision ?? null, decisionNote: dec[i.id]?.note ?? '', decisionOption: dec[i.id]?.option ?? null })) };
}

function videoData(v) {
  const c = cmp(v), dir = hasTake(v) ? baseDir(v) : null;
  const favs = {}; for (const n of jsonl(join(RUNS, v, 'notes.jsonl'))) if (n.kind === 'fav') favs[n.run] = !!n.on;
  return { video: v, title: c.title, name: c.name ?? null, take: c.take, source: (() => { try { return sourceOf(baseDir(v)); } catch { return null; } })(), parts: PARTS, pipe: pipeOf(v), busy: !!busy[v], log: (logs[v] ?? []).slice(-8), working: [...(working[v] ?? [])], favs,
    analysis: dir && existsSync(join(takeDir(dir), 'analysis.json')) ? analysis(dir) : null, stamp: stamp(v), ideas: ideasOf(v),
    notes: jsonl(join(RUNS, v, 'notes.jsonl')).slice(-30), runs: remember(v, c.runs.map((r) => runData(r))) };
}

// caption-lab style over this version: its words in final-video time, our highlights as the style's accent words.
function captionPage(r, style, cand, theme) {
  const L = layout(runDir(r), cands[cand]?.plan);
  const caps = L.captions.filter((c) => c.kind === 'cap');
  const { words, hi: hiAt } = chunkWords(caps);
  const cues = buildCues(words, capLimits(L.p)).map((q) => { const hi = hiAt.filter((i) => i >= q.from && i <= q.to); return hi.length ? { ...q, emph: hi } : q; });
  return pageFor(style || L.p.captionStyle || 'tg-active-now', { duration: L.total, width: 1080, height: 1920, anchorY: 0.68 + (L.p.captionDY ?? 0) / 1920, headline: '', words, cues }, { data: { noTitle: !!L.p.title, layouts: layoutSpans(L) } }).replace('</head>', `<style>${themeCss(theme || L.p.theme)}</style></head>`);
}

function playerPage(r, style, cand, theme, color, amt, ov) {
  const D = { ...runData(r, cand), ...(style ? { captionStyle: style } : {}) };
  const [, ovK, ovKey, ovVal] = /^(\d+)\.(\w+)\.(.*)$/.exec(ov || '') ?? [], ovE = ovKey && D.fx.find((e) => e.k === +ovK);
  if (ovE) ovE.params = { ...ovE.params, [ovKey]: ovVal };
  if (theme) D.theme = themeId(theme);
  const subj = subjectOf(runDir(r));
  const media = D.fx.filter((e) => e.matte).flatMap((e) => Array.from({ length: e.fx === 'doodle-boil' ? 3 : 1 }, (_, c) => ({ id: `m${e.k}`, wrap: `mw${e.k}${c ? `c${c}` : ''}`, empty: true })));
  const cam = '<div id="zoom" class="layer"><video id="va" class="cut" playsinline preload="auto"></video><video id="vb" class="cut" playsinline preload="auto"></video></div>';
  const tail = `<div id="caps" class="layer"><div id="ttl" class="cap title"></div><div id="sub" class="cap sub"></div><div id="cw" class="cap word"></div></div>
<script>window.YP=${JSON.stringify({ ...D, video: `/take/${r}.mp4` })};</script>${D.board ? ['board.js', 'prims/text.js', 'prims/number.js', 'prims/pill.js', 'prims/cutout.js', 'prims/stroke.js', 'prims/shot.js'].map((f) => `<script src="/board/${f}"></script>`).join('') + '<script src="/preview/boardlayer.js"></script>' : ''}<script src="/preview/hook-engine.js"></script><script src="/preview/rpnhooks.js"></script><script src="/preview/titlestyle.js"></script><script src="/preview/player.js"></script>`;
  return page({ total: D.total, subj, effects: D.fx, media, cam, tail, wide: wideOf(runDir(r)) })
    .replace('<script>window.FX', '<script>window.__timelines={};window.FX')
    .replace('href="fx.css"', 'href="/fx/fx.css"').replace('src="runtime.js"', 'src="/fx/runtime.js"')
    .replace('</head>', `<link rel="stylesheet" href="/preview/player.css" />\n<style id="theme">${themeCss(D.theme)}</style>\n</head>`)
    .replace('</body>', `${gradeHtml(color ?? D.color, amt ?? D.colorAmt)}\n</body>`);
}

function sendFile(req, res, file, type) {
  if (!existsSync(file)) { res.writeHead(404); return res.end(); }
  const size = statSync(file).size, m = /bytes=(\d*)-(\d*)/.exec(req.headers.range || '');
  if (m) {
    const a = Number(m[1] || 0), b = m[2] ? Number(m[2]) : size - 1;
    res.writeHead(206, { 'content-type': type, 'accept-ranges': 'bytes', 'content-range': `bytes ${a}-${b}/${size}`, 'content-length': b - a + 1 });
    return pipe(createReadStream(file, { start: a, end: b }), res, () => {});
  }
  res.writeHead(200, { 'content-type': type, 'accept-ranges': 'bytes', 'content-length': size, 'cache-control': 'no-cache' });
  pipe(createReadStream(file), res, () => {});
}
const listeners = new Map();
const sessions = new Map();
const sessionOf = (id) => {
  if (sessions.has(id)) return sessions.get(id);
  let hit = null;
  try {
    const root = join(process.env.HOME, '.claude', 'projects');
    for (const d of readdirSync(root)) {
      const f = readdirSync(join(root, d)).find((x) => x.startsWith(id) && x.endsWith('.jsonl'));
      if (!f) continue;
      const head = readFileSync(join(root, d, f)).subarray(0, 262144).toString('utf8');
      hit = { full: f.slice(0, -6), cwd: head.match(/"cwd":"([^"]+)"/)?.[1] ?? null };
      break;
    }
  } catch {}
  if (hit) sessions.set(id, hit);
  return hit;
};
const json = (res, o) => { res.writeHead(200, { 'content-type': 'application/json', 'cache-control': 'no-store' }); res.end(JSON.stringify(o)); };
const body = (req) => new Promise((ok) => { let s = ''; req.on('data', (c) => (s += c)); req.on('end', () => { try { ok(JSON.parse(s || '{}')); } catch { ok({}); } }); });
const mt = (f) => (existsSync(f) ? statSync(f).mtimeMs : 0);
const birth = (f) => (existsSync(f) ? statSync(f).birthtimeMs : null);
const takeRaw = (v) => { try { const d = baseDir(v), f = readdirSync(d).find((x) => x.startsWith('raw.')); return f ? realpathSync(join(d, f)) : null; } catch { return null; } };
// Best live grade per take, for the take menu; refreshed by videoData, warmed one take at a time off the request path.
const bestMemo = {}, warmQ = new Set();
const remember = (v, rs) => { bestMemo[v] = { at: stamp(v), best: rs.length ? Math.max(...rs.map((x) => x.grade)) : null }; return rs; };
function warm(v) {
  if (warmQ.has(v)) return;
  warmQ.add(v);
  if (warmQ.size === 1) setTimeout(function next() { const [w] = warmQ; try { videoData(w); } catch { bestMemo[w] = { at: stamp(w), best: null }; } warmQ.delete(w); if (warmQ.size) setTimeout(next, 50); }, 50);
}
function takeFacts(v, c) {
  const raw = takeRaw(v), st = stamp(v), m = bestMemo[v];
  const up = Math.max(0, ...c.runs.map((r) => Math.max(Date.parse(hist(r).at(-1)?.at) || 0, mt(join(runDir(r), 'geom.json'))))) || null;
  if (!m || m.at !== st) warm(v);
  let len = null; try { if (raw) len = Math.round(secs(raw)); } catch {}
  return { created: raw ? birth(raw) : birth(join(RUNS, v, 'compare.json')), updated: up, secs: len, best: m?.best ?? null, thumb: !!raw };
}
const thumbQ = {};
function thumbOf(v) {
  const raw = takeRaw(v), out = join(RUNS, v, 'thumb.jpg');
  if (!raw) return Promise.resolve(null);
  if (existsSync(out) && mt(out) >= mt(raw)) return Promise.resolve(out);
  return (thumbQ[v] ??= new Promise((ok) => spawn(FFMPEG, ['-v', 'error', '-y', '-ss', '1', '-i', raw, '-frames:v', '1', '-vf', 'scale=-2:192', '-q:v', '4', out]).on('close', (code) => { delete thumbQ[v]; ok(code === 0 ? out : null); })));
}
const stamp = (v) => Math.max(mt(join(RUNS, v, 'compare.json')), mt(join(RUNS, v, 'board.json')), mt(join(RUNS, v, 'notes.jsonl')), mt(join(RUNS, v, 'edit-ideas.json')), mt(join(RUNS, v, 'edit-ideas-decisions.jsonl')), ...cmp(v).runs.flatMap((r) => ['plan.json', 'geom.json', 'grades.jsonl'].map((f) => mt(join(runDir(r), f)))));

// Rebuilt on every open: one Finder folder of links to each take's runs/<v>/exports.
function allExports() {
  const d = join(ROOT, 'exports'); mkdirSync(d, { recursive: true });
  for (const f of readdirSync(d)) if (lstatSync(join(d, f)).isSymbolicLink()) rmSync(join(d, f));
  for (const v of videos()) {
    const x = join(RUNS, v, 'exports'); if (!existsSync(x) || !readdirSync(x).some((f) => f.endsWith('.mp4'))) continue;
    const c = cmp(v), n = String(c.name || c.title || v).replace(/[/:]/g, '-').slice(0, 60);
    symlinkSync(x, join(d, existsSync(join(d, n)) ? `${n} (${v})` : n));
  }
  return d;
}
function setName(v, name, by) { const f = join(RUNS, v, 'compare.json'), c = JSON.parse(readFileSync(f, 'utf8')); if (name) Object.assign(c, { name, nameBy: by }); else { delete c.name; delete c.nameBy; } writeFileSync(f, JSON.stringify(c, null, 1)); }

// A new take: runs/<slug>/ with an empty compare.json; the pipeline fills it (transcribe, ideas, presets, scan, tune).
const STYLES = join(ROOT, 'styles');
const styleOf = (id) => { try { return JSON.parse(readFileSync(join(STYLES, id, 'style.json'), 'utf8')); } catch { return null; } };
const savedStyles = () => (existsSync(STYLES) ? readdirSync(STYLES).map(styleOf).filter(Boolean).sort((a, b) => b.made.localeCompare(a.made)) : []);
const styleRun = (v, s) => { const c = cmp(v); return c.runs.find((r) => new RegExp(`^${s.level} full$`, 'i').test(c.label[r] || '')) || c.runs.find((r) => (c.label[r] || '').toLowerCase().startsWith(s.level)) || null; };
function newTake(name) {
  const stem = name.replace(/\.[^.]+$/, ''), slug0 = stem.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'take';
  let v = slug0, n = 2;
  while (existsSync(join(RUNS, v))) v = `${slug0}-${n++}`;
  mkdirSync(join(RUNS, v), { recursive: true });
  writeFileSync(join(RUNS, v, 'compare.json'), JSON.stringify({ title: stem, take: name, runs: [], label: {}, judge: {}, persona: {}, preset: {} }, null, 1));
  return v;
}

// Drop folder: a video saved into inbox/ (size steady for 3 s) moves into runs/<slug>/ and starts the pipeline.
const INBOX = join(ROOT, 'inbox'), seenSize = {};
setInterval(() => {
  if (!existsSync(INBOX)) return;
  for (const f of readdirSync(INBOX).filter((x) => /\.(mp4|mov|m4v|webm)$/i.test(x))) {
    const size = statSync(join(INBOX, f)).size;
    if (seenSize[f] !== size) { seenSize[f] = size; continue; }
    delete seenSize[f];
    const v = newTake(f);
    renameSync(join(INBOX, f), join(RUNS, v, `raw.${f.split('.').pop().toLowerCase()}`));
    say(v, `picked up inbox/${f}`);
    pipeline(v, true);
  }
}, 3000);

createServer(async (req, res) => {
  if (refuseForeign(req, res)) return;
  const url = new URL(req.url, 'http://x'), path = decodeURIComponent(url.pathname);
  const by = (label) => req.headers['x-yapcut-who'] === 'page' ? label : label.replace(/^You: /, 'Agent: ');
  try {
    if (path === '/' && (/^#?\d+$/.test(url.searchParams.get('v') || '') || /^[a-z0-9-]+$/i.test(url.searchParams.get('r') || '') && !(url.searchParams.get('r') || '').includes('-p-'))) {
      const q = url.searchParams, n = (q.get('v') || '').replace('#', ''), list = videos().map((x) => ({ x, c: takeFacts(x, cmp(x)).created || 0 })).sort((a, b) => a.c - b.c || (a.x < b.x ? -1 : 1));
      const v = /^\d+$/.test(n) ? list[+n - 1]?.x : q.get('v'), want = (q.get('r') || '').toLowerCase(), runs = v ? cmp(v).runs : [];
      const r = !want ? '' : runs.find((x) => x === want) || runs.find((x) => x === `${v}-p-${want}`) || runs.find((x) => x === `${v}-p-${want}-full`) || (/^[a-z]$/.test(want) ? runs[want.charCodeAt(0) - 97] : '') || '';
      if (v) { q.set('v', v); if (r) q.set('r', r); else q.delete('r'); res.writeHead(302, { location: '/?' + q }); return res.end(); }
    }
    if (path === '/') { res.writeHead(200, { 'content-type': 'text/html', 'cache-control': 'no-store' }); return res.end(readFileSync(join(ROOT, 'preview/index.html'), 'utf8').replace('</head>', '<script>window.YAP_VIEW=' + JSON.stringify(CFG.defaultView === 'full' ? 'full' : 'simple') + '</script></head>')); }
    if (path.startsWith('/preview/')) return sendFile(req, res, join(ROOT, 'preview', basename(path)), path.endsWith('.css') ? 'text/css' : 'text/javascript');
    if (path.startsWith('/board/')) { const f = resolve(BOARD_DIR, path.slice(7)); return f.startsWith(BOARD_DIR.replace(/\/?$/, '/')) ? sendFile(req, res, f, f.endsWith('.woff2') ? 'font/woff2' : f.endsWith('.ttf') ? 'font/ttf' : f.endsWith('.svg') ? 'image/svg+xml' : 'text/javascript') : (res.writeHead(404), res.end()); }
    const art = path.match(/^\/boardart\/([\w-]+)\/([\w./-]+\.(png|svg))$/);
    if (art && !art[2].includes('..')) return sendFile(req, res, join(RUNS, art[1], art[2]), art[3] === 'svg' ? 'image/svg+xml' : 'image/png');
    if (path.startsWith('/fx/')) return sendFile(req, res, join(ROOT, 'effects', basename(path)), path.endsWith('.css') ? 'text/css' : 'text/javascript');
    if (path === '/api/sound-packs') { const P = soundPacks(); return json(res, { active: P.active, hookSounds: P.hookSounds ?? [], packs: Object.entries(P.packs).map(([id, k]) => ({ id, name: k.name, note: k.note, slots: Object.entries(k.slots).map(([sl, v]) => ({ id: sl, label: v.label, use: v.use, files: v.approved })) })) }); }
    if (path === '/api/themes') return json(res, themeList());
    if (req.method === 'POST' && path === '/api/claude/beat') { const b = await body(req); if (b.id) listeners.set(String(b.id).slice(0, 40), { id: String(b.id).slice(0, 40), label: String(b.label ?? '').slice(0, 60), at: Date.now() }); return json(res, { ok: true }); }
    if (path === '/api/claude') return json(res, [...listeners.values()].filter((x) => Date.now() - x.at < 75000).map((x) => ({ ...x, ...sessionOf(x.id), ago: Math.round((Date.now() - x.at) / 1000) })));
    if (path === '/api/grades') return json(res, gradeList());
    if (path === '/api/videos') return json(res, videos().map((v) => { const c = cmp(v); return { video: v, title: c.title, name: c.name ?? null, versions: c.runs.length, busy: !!busy[v], ...takeFacts(v, c) }; }));
    let m;
    if (path === '/api/styles') return json(res, savedStyles());
    if ((m = path.match(/^\/styles\/([0-9a-f]{10})\/sheet\.jpg$/))) return sendFile(req, res, join(STYLES, m[1], 'sheet.jpg'), 'image/jpeg');
    if (req.method === 'POST' && path === '/api/style') {
      const b = await body(req);
      try { return json(res, { ok: true, style: await copyStyle(String(b.url || ''), { root: ROOT, captionStyles: OURS, themes: themeList(), say: (s) => console.log(`[style] ${s}`) }) }); } catch (e) { return json(res, { ok: false, error: String(e.message || e).split('\n')[0].slice(0, 200) }); }
    }
    if (req.method === 'POST' && (m = path.match(/^\/api\/style\/([0-9a-f]{10})\/use\/([\w-]+)$/)) && videos().includes(m[2])) {
      const s = styleOf(m[1]); if (!s) return json(res, { ok: false, error: 'no such style' });
      writeFileSync(join(RUNS, m[2], 'style.json'), JSON.stringify(s, null, 1)); applyStyle(s, cmp(m[2]).runs.map(runDir));
      say(m[2], `copied the style of ${s.creator || s.url}: captions ${s.captionStyle}, hook ${s.titleStyle}, theme ${s.theme}, ${s.level} edit`);
      return json(res, { ok: true, run: styleRun(m[2], s) });
    }
    if ((m = path.match(/^\/thumb\/([\w-]+)\.jpg$/)) && videos().includes(m[1])) { const f = await thumbOf(m[1]); if (!f) { res.writeHead(404); return res.end(); } return sendFile(req, res, f, 'image/jpeg'); }
    if ((m = path.match(/^\/api\/(video|pipe|run|note)\/([\w-]+)$/)) && !videos().includes(m[2])) { res.writeHead(404, { 'content-type': 'application/json' }); return res.end('{"error":"no such video"}'); }
    if ((m = path.match(/^\/api\/video\/([\w-]+)$/))) return json(res, videoData(m[1]));
    if ((m = path.match(/^\/api\/library\/([\w-]+)$/))) { const L = libraryOf(m[1]); for (const it of L) if (isVid(it.file)) try { mediaCopy(it.file); } catch {} return json(res, L.map(({ file, ...i }, n) => ({ ...i, src: `/libfile/${m[1]}/${n}` }))); }
    if ((m = path.match(/^\/libfile\/([\w-]+)\/(\d+)$/))) { const it = libraryOf(m[1])[+m[2]]; if (!it) { res.writeHead(404); return res.end(); } return sendMedia(req, res, it.file, MIME[extname(it.file).toLowerCase()], url); }
    if ((m = path.match(/^\/mthumb\/([\w-]+)\/(\d+)$/))) { const it = libraryOf(m[1])[+m[2]], f = it && isVid(it.file) && (await mediaThumb(it.file)); if (!f) { res.writeHead(404); return res.end(); } res.writeHead(200, { 'content-type': 'image/jpeg', 'cache-control': 'max-age=3600' }); return res.end(readFileSync(f)); }
    if ((m = path.match(/^\/api\/pipe\/([\w-]+)$/))) return json(res, { eta: etas(), now: Date.now(), page: mt(join(ROOT, 'preview/index.html')), pipe: pipeOf(m[1]), busy: !!busy[m[1]], working: [...(working[m[1]] ?? [])], log: (logs[m[1]] ?? []).slice(-8), stamp: stamp(m[1]) });
    if ((m = path.match(/^\/play\/([\w-]+)$/))) { res.writeHead(200, { 'content-type': 'text/html', 'cache-control': 'no-store' }); return res.end(playerPage(m[1], url.searchParams.get('style'), url.searchParams.get('cand'), url.searchParams.get('theme'), url.searchParams.get('color'), url.searchParams.get('amt'), url.searchParams.get('ov'))); }
    if ((m = path.match(/^\/captions\/([\w-]+)$/))) { res.writeHead(200, { 'content-type': 'text/html', 'cache-control': 'no-store' }); return res.end(captionPage(m[1], url.searchParams.get('style'), url.searchParams.get('cand'), url.searchParams.get('theme'))); }
    if (path === '/api/caption-styles') return json(res, OURS);
    if (path === '/api/export-options') return json(res, { ratios: Object.entries(RATIOS).map(([id, x]) => ({ id, name: x.name })), formats: Object.entries(FORMATS).map(([id, x]) => ({ id, name: x.name })) });
    if (path === '/api/exports') return json(res, exportJobs().map((j) => ({ ...j, url: `/exports/${videoOf(j.run)}/${basename(j.file)}`, name: basename(j.file) })));
    if ((m = path.match(/^\/exports\/([\w-]+)\/([\w.-]+)$/))) return sendFile(req, res, join(RUNS, m[1], 'exports', m[2]), m[2].endsWith('.mov') ? 'video/quicktime' : 'video/mp4');
    if (req.method === 'POST' && (m = path.match(/^\/api\/export\/([\w-]+)$/))) {
      const r = m[1], v = videoOf(r), b = await body(req);
      if (!v) return json(res, { ok: false, error: 'no such version' });
      if (exportJobs().some((j) => j.state === 'running')) return json(res, { ok: false, error: 'an export is already running - wait for it or cancel it' });
      try { const j = startExport({ run: r, dir: runDir(r), outDir: join(RUNS, v, 'exports'), label: cmp(v).label[r], ratio: b.ratio, format: b.format, speed: b.speed, faces: facesOut(r, layout(runDir(r))), log: (s) => say(v, s) }); say(v, `EXPORT ${cmp(v).label[r]} ${b.ratio} ${b.format}${b.speed && +b.speed !== 1 ? ` ${b.speed}x` : ''} -> ${j.file}`); return json(res, { ok: true, id: j.id }); }
      catch (e) { return json(res, { ok: false, error: e.message }); }
    }
    if (req.method === 'POST' && (m = path.match(/^\/api\/export-check\/([\w-]+)$/))) {
      const r = m[1], v = videoOf(r), b = await body(req);
      if (!v) return json(res, { ok: false, error: 'no such version' });
      if (exportJobs().some((j) => j.state === 'running' && j.run === r)) return json(res, { ok: false, error: 'this version is exporting right now' });
      try { return json(res, { ok: true, ...(await checkExport({ run: r, dir: runDir(r), faces: (() => { try { return facesOut(r, layout(runDir(r))); } catch { return []; } })(), at: b.at, out: join(RUNS, v, 'export-check', r), previewUrl: `http://127.0.0.1:${PORT}` })) }); }
      catch (e) { return json(res, { ok: false, error: String(e.message || e).slice(0, 400) }); }
    }
    if (req.method === 'POST' && (m = path.match(/^\/api\/export-cancel\/(\w+)$/))) return json(res, { ok: cancelExport(m[1]) });
    if (req.method === 'POST' && (m = path.match(/^\/api\/name\/([\w-]+)$/)) && existsSync(join(RUNS, m[1], 'compare.json'))) { const n = String((await body(req)).name ?? '').trim().slice(0, 60); setName(m[1], n || null, 'you'); say(m[1], n ? `renamed to "${n}"` : 'name cleared'); return json(res, { ok: true, name: n || null }); }
    if (req.method === 'POST' && (m = path.match(/^\/api\/folder\/([\w-]+)$/)) && existsSync(join(RUNS, m[1], 'compare.json'))) { const x = join(RUNS, m[1], 'exports'); spawn('open', [existsSync(x) ? x : join(RUNS, m[1])]); return json(res, { ok: true }); }
    if (req.method === 'POST' && path === '/api/folder-all') { spawn('open', [allExports()]); return json(res, { ok: true }); }
    if (req.method === 'POST' && (m = path.match(/^\/api\/reveal\/([\w-]+)\/([\w.-]+)$/))) { const f = join(RUNS, m[1], 'exports', m[2]); if (!existsSync(f)) return json(res, { ok: false }); spawn('open', ['-R', f]); return json(res, { ok: true }); }
    if (path === '/api/effects') return json(res, EFFECTS.filter((e) => !['media-card', 'concept-card'].includes(e.id)).map((e) => ({ id: e.id, name: e.name, what: e.what, matte: !!e.matte, group: e.group ?? null, props: e.props?.map((q) => (q.key === 'meBg' ? { ...q, options: [['', 'Your room'], ...backgrounds().map((f) => [`/bglib/${f}`, f.replace(/\.[^.]+$/, '').replace(/[-_]/g, ' ')])] } : q)) ?? null })));
    if ((m = path.match(/^\/bglib\/([\w.-]+)$/))) return sendFile(req, res, join(BGLIB, m[1]), MIME[extname(m[1]).toLowerCase()] || 'application/octet-stream');
    if ((m = path.match(/^\/api\/jev\/([\w-]+)$/))) { if (!videoOf(m[1])) return json(res, { ok: false, error: 'no such version' }); if (req.method === 'POST') jevCheck(m[1]); return json(res, { ok: true, ...jevView(m[1]) }); }
    if ((m = path.match(/^\/api\/jev-fix\/([\w-]+)$/))) { if (!videoOf(m[1])) return json(res, { ok: false, error: 'no such version' }); if (req.method === 'POST') jevFix(m[1], (await body(req)).ids ?? []); const F = fixJobs[m[1]]; return json(res, { ok: true, fix: F ? { ...F, secs: F.secs ?? +((Date.now() - F.t0) / 1000).toFixed(1) } : null }); }
    if ((m = path.match(/^\/jevf\/([\w-]+)\/(\d+)\.jpg$/))) return sendFile(req, res, join(runDir(m[1]), url.searchParams.get('prev') ? 'jev-prev' : 'jev', `${m[2]}.jpg`), 'image/jpeg');
    if ((m = path.match(/^\/look\/([\w-]+)\/sheet\.jpg$/))) return sendFile(req, res, join(runDir(m[1]), 'look', 'sheet.jpg'), 'image/jpeg');
    if ((m = path.match(/^\/noteshot\/([\w-]+)\/([\d.-]+\.jpg)$/))) { const f = join(RUNS, m[1], 'note-shots', m[2]); if (!existsSync(f)) { res.writeHead(404); return res.end(); } return sendFile(req, res, f, 'image/jpeg'); }
    if ((m = path.match(/^\/shot\/([\w-]+)\/([\d.]+)\.jpg$/))) { if (!videoOf(m[1])) { res.writeHead(404); return res.end(); } const f = await shot(m[1], Math.max(0, +m[2])); res.setHeader('cache-control', 'no-store'); return sendFile(req, res, f, 'image/jpeg'); }
    if ((m = path.match(/^\/stylepic\/([\w-]+)\.jpg$/))) {
      const q = url.searchParams, st = q.get('style') ?? '', hk = q.get('titleStyle') ?? 'serif', ov = q.get('ov') ?? '';
      if (!videoOf(m[1]) || !/^[\w-]+$/.test(st) || !/^[\w-]+$/.test(hk) || !/^(\d+\.\w+\.[\w./-]*)?$/.test(ov) || ov.includes('..')) { res.writeHead(404); return res.end(); }
      try { const f = await stylePic(m[1], st, hk, Math.max(0, +q.get('t') || 0), ov); res.setHeader('cache-control', 'max-age=3600'); return sendFile(req, res, f, 'image/jpeg'); }
      catch (e) { res.writeHead(500); return res.end(e.message); }
    }
    if ((m = path.match(/^\/take\/([\w-]+)\.mp4$/)))return sendFile(req, res, takeProxy(runDir(m[1])), 'video/mp4');
    if ((m = path.match(/^\/still\/([\w-]+)\/([\d.]+)\.jpg$/))) {
      const out = join(takeCache(runDir(m[1])), `still-${m[2]}.jpg`);
      if (!existsSync(out)) execFileSync(FFMPEG, ['-v', 'error', '-y', '-ss', m[2], '-i', proxyOf(runDir(m[1])), '-frames:v', '1', '-q:v', '3', out]);
      return sendFile(req, res, out, 'image/jpeg');
    }
    if (path.startsWith('/sfxwave/')) {
      const f = sfxPath(decodeURIComponent(path.slice(9)));
      if (!f || !existsSync(f)) { res.writeHead(404); return res.end(); }
      let pk = [];
      try { const raw = execFileSync(CFG.ffmpeg, ['-v', 'error', '-i', f, '-ac', '1', '-ar', '4000', '-f', 's16le', '-'], { maxBuffer: 1 << 24 }); const n = raw.length >> 1, B = 48; for (let b = 0; b < B; b++) { let m = 0; for (let i = Math.floor((b * n) / B); i < Math.floor(((b + 1) * n) / B); i++) m = Math.max(m, Math.abs(raw.readInt16LE(i * 2))); pk.push(m / 32768); } } catch {}
      const top = Math.max(0.05, ...pk), bars = pk.map((v, i) => `<rect x="${i * 2}" y="${(10 - (v / top) * 9).toFixed(1)}" width="1.3" height="${Math.max(0.6, (v / top) * 18).toFixed(1)}" rx=".6"/>`).join('');
      res.writeHead(200, { 'content-type': 'image/svg+xml', 'cache-control': 'max-age=3600' });
      return res.end(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 96 20" preserveAspectRatio="none"><g fill="#7cc4ff">${bars}</g></svg>`);
    }
    if (req.method === 'POST' && path === '/api/sfx-ban') {
      const b = await body(req), ref = String(b.ref || ''), f = join(ROOT, 'sound-packs.json'), d = JSON.parse(readFileSync(f, 'utf8'));
      if (!ref) return json(res, { ok: false, error: 'no sound' });
      if (!(d.banned ?? []).some((x) => x.file === ref)) (d.banned ??= []).push({ file: ref, why: `You ${new Date().toISOString().slice(5, 10)}: banned from the sounds row` });
      for (const pk of Object.values(d.packs)) for (const sl of Object.values(pk.slots ?? {})) for (const k of ['approved', 'candidates']) if (sl[k]) sl[k] = sl[k].filter((x) => x !== ref);
      writeFileSync(f, JSON.stringify(d, null, 2));
      for (const v of videos()) pipeline(v, false);
      return json(res, { ok: true });
    }
    if (path.startsWith('/sfx/')) {
      const f = sfxPath(decodeURIComponent(path.slice(5)));
      return f && existsSync(f) ? sendFile(req, res, f, audioType(f)) : (res.writeHead(404), res.end());
    }
    if (req.method === 'POST' && (m = path.match(/^\/api\/geom\/([\w-]+)$/))) {
      const b = await body(req), cand = url.searchParams.get('cand');
      if (cand && cands[cand]) { cands[cand].done(b); return json(res, { ok: true }); }
      writeFileSync(geomFile(m[1]), JSON.stringify(b, null, 1));
      return json(res, { ok: true });
    }
    if (req.method === 'POST' && path === '/api/upload') {
      const name = basename(url.searchParams.get('name') || 'take.mp4'), ext = (name.match(/\.(mp4|mov|m4v|webm)$/i)?.[1] || '').toLowerCase();
      if (!ext) { req.resume(); return json(res, { ok: false, error: 'drop a video file (.mp4, .mov, .m4v, .webm)' }); }
      const part = join(RUNS, `.upload-${Date.now()}.part`);
      await new Promise((ok, no) => req.pipe(createWriteStream(part)).on('finish', ok).on('error', no));
      const v = newTake(name), file = join(RUNS, v, `raw.${ext}`), st = styleOf(url.searchParams.get('style') || '');
      renameSync(part, file);
      if (st) writeFileSync(join(RUNS, v, 'style.json'), JSON.stringify(st, null, 1));
      say(v, `got ${name} (${(statSync(file).size / 1e6).toFixed(1)} MB) from the page`);
      pipeline(v, true);
      return json(res, { ok: true, video: v, styled: !!st });
    }
    if (req.method === 'POST' && (m = path.match(/^\/api\/script\/([\w-]+)$/)) && videos().includes(m[1])) {
      let t = ''; for await (const ch of req) t += ch;
      writeFileSync(join(RUNS, m[1], 'script.txt'), t);
      say(m[1], `script set (${t.split(/\s+/).filter(Boolean).length} words) - used by the next ideas step`);
      return json(res, { ok: true });
    }
    if (req.method === 'POST' && (m = path.match(/^\/api\/(edit|undo|redo|move)\/([\w-]+)$/))) {
      const r = m[2], v = videoOf(r);
      if (!v) return json(res, { ok: false, error: 'no such version' });
      const dir = runDir(r), planFile = join(dir, 'plan.json'), edits = join(dir, 'edits'), before = runData(r).grade;
      mkdirSync(edits, { recursive: true });
      const snaps = readdirSync(edits).filter((f) => /^\d+\.json$/.test(f)).sort();
      let label, b0;
      const redos = readdirSync(edits).filter((f) => /^redo-\d+\.json$/.test(f)).sort();
      if (m[1] === 'undo') {
        if (!snaps.length) return json(res, { ok: false, error: 'nothing to undo' });
        copyFileSync(planFile, join(edits, `redo-${String(redos.length + 1).padStart(4, '0')}.json`));
        const cur = JSON.parse(readFileSync(planFile, 'utf8'));
        copyFileSync(join(edits, snaps.at(-1)), planFile); keepNoteKeys(cur, planFile); renameSync(join(edits, snaps.at(-1)), join(edits, `undone-${snaps.at(-1)}`));
        label = 'You: undo last edit';
      } else if (m[1] === 'redo') {
        if (!redos.length) return json(res, { ok: false, error: 'nothing to redo' });
        copyFileSync(planFile, join(edits, `${String(snaps.length + 1).padStart(3, '0')}.json`));
        const cur = JSON.parse(readFileSync(planFile, 'utf8'));
        copyFileSync(join(edits, redos.at(-1)), planFile); keepNoteKeys(cur, planFile); rmSync(join(edits, redos.at(-1)));
        label = 'You: redo';
      } else if (m[1] === 'move') {
        const b = await body(req), dx = Math.round(+b.dx || 0), dy = Math.round(+b.dy || 0), p = JSON.parse(readFileSync(planFile, 'utf8')), e = (p.effects ?? [])[+b.k];
        const gapK = +(b.item?.k ?? b.k);
        if (gapK >= GAP_K && ['delete', 'fx', 'fxtime', 'fxprops', 'fxswap'].includes(b.what)) {
          if (b.what !== 'delete') return json(res, { ok: false, error: 'This is a held beat. Delete it to remove the pause.' });
          if (!(p.gaps ?? [])[gapK - GAP_K]) return json(res, { ok: false, error: 'no held beat there' });
          copyFileSync(planFile, join(edits, `${String(snaps.length + 1).padStart(3, '0')}.json`));
          p.gaps.splice(gapK - GAP_K, 1);
          writeFileSync(planFile, JSON.stringify(p, null, 1));
          label = 'You: deleted held beat';
        } else if (b.what === 'delete') {
          const it = b.item ?? {}, list = it.what === 'zoom' ? null : p.effects ?? [];
          let gone;
          if (it.what === 'fx' && list[+it.k]) gone = `${list[+it.k].fx === 'media-card' ? list[+it.k].name ?? 'media' : list[+it.k].fx} card`;
          else if (it.what === 'title' && p.title) gone = 'hook title';
          else if (it.what === 'zoom' && ZOOM_KINDS.includes(it.kind) && (it.kind === 'snap' ? (p.snap ?? []).includes(+it.k) : (p[it.kind] ?? [])[+it.k])) gone = ZOOM_NAMES[it.kind];
          if (!gone) return json(res, { ok: false, error: 'nothing to delete there' });
          copyFileSync(planFile, join(edits, `${String(snaps.length + 1).padStart(3, '0')}.json`));
          if (it.what === 'fx') list.splice(+it.k, 1);
          else if (it.what === 'title') { p.title = ''; p.subtitle = ''; }
          else if (it.kind === 'snap') { p.snap = p.snap.filter((i) => i !== +it.k); if (p.snapSecs) delete p.snapSecs[it.k]; if (p.snapZoom) delete p.snapZoom[it.k]; }
          else p[it.kind].splice(+it.k, 1);
          writeFileSync(planFile, JSON.stringify(p, null, 1));
          label = `You: deleted ${gone}`;
        } else if (b.what === 'flow') {
          copyFileSync(planFile, join(edits, `${String(snaps.length + 1).padStart(3, '0')}.json`));
          if (b.on) p.flow = p.flow || true; else delete p.flow;
          writeFileSync(planFile, JSON.stringify(p, null, 1));
          label = `You: always-moving camera ${b.on ? 'on' : 'off'}`;
        } else if (b.what === 'zoom') {
          const L = layout(dir, p), t = Math.max(0, +b.t || 0), d = Math.max(0.4, +b.dur || 2.4), kind = b.kind, rng = wordsIn(L, t, d);
          if (!rng || !ZOOM_KINDS.includes(kind)) return json(res, { ok: false, error: 'no words there' });
          copyFileSync(planFile, join(edits, `${String(snaps.length + 1).padStart(3, '0')}.json`));
          if (kind === 'snap') {
            p.snap = (p.snap ?? []).filter((i) => i !== +b.k); p.snap.push(rng[0]); p.snap.sort((x, y) => x - y);
            p.snapSecs = { ...(p.snapSecs ?? {}) }; delete p.snapSecs[b.k]; if (Math.abs(d - 1.2) > 0.05) p.snapSecs[rng[0]] = +d.toFixed(2);
            if (!Object.keys(p.snapSecs).length) delete p.snapSecs;
          } else if (b.add) (p[kind] ??= []).push(kind === 'hold' ? [rng[0], rng[1], 1.35] : rng);
          else { const list = p[kind] ?? [], old = list[+b.k]; if (!old) return json(res, { ok: false, error: 'no such zoom' }); list[+b.k] = old[2] != null ? [rng[0], rng[1], old[2]] : kind === 'hold' ? [rng[0], rng[1], 1.35] : rng; }
          writeFileSync(planFile, JSON.stringify(p, null, 1));
          const name = ZOOM_NAMES[kind];
          label = `You: ${b.add ? 'added' : b.mode === 'move' ? 'moved' : 'resized'} ${name} to ${t.toFixed(1)}-${(t + d).toFixed(1)} s ("${L.words.slice(rng[0], rng[1] + 1).map((w) => w.text).join(' ').slice(0, 40)}")`;
        } else if (b.what === 'zoomswap' || b.what === 'zoomprops') {
          const from = b.kind, list = from === 'snap' ? null : p[from] ?? [], old = from === 'snap' ? (p.snap ?? []).includes(+b.k) && [+b.k] : list[+b.k];
          if (!old || !ZOOM_KINDS.includes(from) || (b.what === 'zoomswap' && !ZOOM_KINDS.includes(b.to))) return json(res, { ok: false, error: 'no such zoom' });
          copyFileSync(planFile, join(edits, `${String(snaps.length + 1).padStart(3, '0')}.json`));
          if (b.what === 'zoomprops') {
            const z = +(+b.z).toFixed(3);
            if (from === 'snap') p.snapZoom = { ...(p.snapZoom ?? {}), [b.k]: z };
            else list[+b.k] = [old[0], old[1], z];
            label = `You: ${ZOOM_NAMES[from]} ${MOVE_KINDS.includes(from) ? `strength ${Math.round(z * 100)}%` : `${z}x`}`;
          } else {
            const L = layout(dir, p), z = zoomsOf(L).find((x) => x.kind === from && x.k === +b.k), rng = z ? wordsIn(L, z.t0, z.dur) : [old[0], old[1] ?? old[0]];
            if (from === 'snap') { p.snap = p.snap.filter((i) => i !== +b.k); if (p.snapSecs) delete p.snapSecs[b.k]; if (p.snapZoom) delete p.snapZoom[b.k]; } else list.splice(+b.k, 1);
            if (b.to === 'snap') { p.snap = [...new Set([...(p.snap ?? []), rng[0]])].sort((x, y) => x - y); if (z && Math.abs(z.dur - 1.2) > 0.05) p.snapSecs = { ...(p.snapSecs ?? {}), [rng[0]]: z.dur }; }
            else (p[b.to] ??= []).push(b.to === 'hold' ? [rng[0], rng[1], 1.35] : rng);
            label = `You: switched ${ZOOM_NAMES[from]} to ${ZOOM_NAMES[b.to]}`;
          }
          writeFileSync(planFile, JSON.stringify(p, null, 1));
        } else if (b.what === 'fxswap') {
          const to = byId[b.fx];
          if (!e || !to || to.group !== byId[e.fx]?.group || to.group !== 'layout') return json(res, { ok: false, error: 'can only switch a layout to another layout' });
          copyFileSync(planFile, join(edits, `${String(snaps.length + 1).padStart(3, '0')}.json`));
          const was = e.fx; e.fx = to.id;
          if ('title' in to.params && !e.title) e.title = e.text;
          if ('text' in to.params && !e.text) e.text = e.title;
          writeFileSync(planFile, JSON.stringify(p, null, 1));
          label = `You: switched layout ${byId[was].name} -> ${to.name}`;
        } else if (b.what === 'fxtime') {
          const t = +b.t, d = +b.dur;
          if (!e || !(t >= 0) || !(d >= 0.4)) return json(res, { ok: false, error: 'bad effect time' });
          copyFileSync(planFile, join(edits, `${String(snaps.length + 1).padStart(3, '0')}.json`));
          e.t = +t.toFixed(2); e.dur = +d.toFixed(2);
          writeFileSync(planFile, JSON.stringify(p, null, 1));
          label = `You: ${b.mode === 'move' ? 'moved' : 'resized'} ${e.fx} to ${e.t.toFixed(1)}-${(e.t + e.dur).toFixed(1)} s`;
        } else if (b.what === 'titleprops') {
          const v = b.props ?? {}, said = [], cl = (x, lo, hi) => Math.max(lo, Math.min(hi, +x));
          copyFileSync(planFile, join(edits, `${String(snaps.length + 1).padStart(3, '0')}.json`));
          if (v.y != null && Number.isFinite(+v.y)) { p.titleY = Math.round(cl(v.y, 120, 1800)); p.titleMoved = true; said.push(`height ${p.titleY}`); }
          if (v.dx != null && Number.isFinite(+v.dx)) { p.titleDX = Math.round(cl(v.dx, -500, 500)); said.push(`sideways ${p.titleDX}`); }
          if (v.scale != null && Number.isFinite(+v.scale)) { p.titleScale = +cl(v.scale, 0.3, 3).toFixed(2); said.push(`size ${Math.round(p.titleScale * 100)}%`); }
          if (v.dur != null && Number.isFinite(+v.dur)) { p.titleDur = +cl(v.dur, 0.8, 10).toFixed(1); said.push(`on screen ${p.titleDur} s`); }
          if (v.color != null) { if (/^#[0-9a-f]{6}$/i.test(v.color)) p.titleColor = v.color; else delete p.titleColor; said.push(`colour ${p.titleColor || 'default'}`); }
          if (v.anim != null) { if (/^[a-z]+$/.test(v.anim) && v.anim !== 'look') p.titleAnim = v.anim; else delete p.titleAnim; said.push(`entrance ${p.titleAnim || 'look default'}`); }
          if (v.animate != null && p.titleStyle && p.titleStyle !== 'serif') { const base = p.titleStyle.replace(/-static$/, ''); p.titleStyle = v.animate ? base : `${base}-static`; said.push(v.animate ? 'animated' : 'still'); }
          if (!said.length) return json(res, { ok: false, error: 'nothing to set' });
          writeFileSync(planFile, JSON.stringify(p, null, 1));
          label = `You: hook ${said.join(', ')}`;
        } else if (b.what === 'fxprops') {
          const defs = e && byId[e.fx]?.props, set = Object.entries(b.props ?? {}).map(([k, v]) => [defs?.find((d) => d.key === k), v]).map(([d, v]) => [d, d?.options ? String(v) : +v]).filter(([d, v]) => d && (d.key === 'meBg' ? v === '' || backgrounds().some((f) => `/bglib/${f}` === v) : d.options ? d.options.some((o) => o[0] === v) : Number.isFinite(v)));
          if (!set.length) return json(res, { ok: false, error: 'nothing to set' });
          const pic = set.find(([d, v]) => d.key === 'top' && (v === 'redraw' || (v === 'picture' && !e.svg)));
          if (pic) { try { e.svg = await drawForLayout(dir, e); pic[1] = 'picture'; } catch (er) { return json(res, { ok: false, error: er.message }); } }
          copyFileSync(planFile, join(edits, `${String(snaps.length + 1).padStart(3, '0')}.json`));
          const targets = b.all ? (p.effects ?? []).filter((x) => x.fx === e.fx) : [e];
          for (const t of targets) for (const [d, v] of set) t[d.key] = d.options ? v : Math.max(d.min, Math.min(d.max, v));
          writeFileSync(planFile, JSON.stringify(p, null, 1));
          label = `You: ${b.all ? `all ${targets.length} ` : ''}${byId[e.fx].name} ${set.map(([d]) => `${d.label.toLowerCase()} ${e[d.key]}`).join(', ')}`;
        } else {
        const set = b.set && typeof b.set === 'object' ? b.set : null, sc = (x) => Math.max(0.3, Math.min(3, +x || 1));
        if (!['title', 'captions', 'fx'].includes(b.what) || (b.what === 'fx' && !e) || (!dx && !dy && !set)) return json(res, { ok: false, error: 'nothing to move' });
        copyFileSync(planFile, join(edits, `${String(snaps.length + 1).padStart(3, '0')}.json`));
        if (set) {
          const s2 = sc(set.scale);
          if (b.what === 'fx') { e.scale = +s2.toFixed(3); if (set.dx != null) e.dx = Math.round(+set.dx); if (set.dy != null) e.dy = Math.round(+set.dy); }
          else if (b.what === 'title') p.titleScale = +s2.toFixed(3);
          else p.captionScale = +s2.toFixed(3);
          label = `You: resized ${b.what === 'fx' ? `${e.fx === 'media-card' ? e.name ?? 'media' : e.fx} card` : b.what === 'title' ? 'hook title' : 'captions'} to ${Math.round(s2 * 100)}%`;
        } else if (b.what === 'title') { p.titleY = Math.max(120, Math.min(1800, (camTitle(p) ? CAM_TITLE_Y : p.titleY ?? 360) + dy)); p.titleDX = Math.max(-500, Math.min(500, (p.titleDX ?? 0) + dx)); p.titleMoved = true; }
        else if (b.what === 'captions') p.captionDY = Math.max(-1100, Math.min(500, (p.captionDY ?? 0) + dy));
        else { e.dx = (e.dx ?? 0) + dx; e.dy = (e.dy ?? 0) + dy; }
        writeFileSync(planFile, JSON.stringify(p, null, 1));
        const dir2 = (n, pos, neg) => (n ? `${Math.abs(n)} px ${n > 0 ? pos : neg}` : '');
        if (!set) label = `You: moved ${b.what === 'fx' ? `${e.fx} card` : b.what === 'title' ? 'hook title' : 'captions'} ${[dir2(dy, 'down', 'up'), b.what === 'captions' ? '' : dir2(dx, 'right', 'left')].filter(Boolean).join(', ')}`;
        }
      } else if ((b0 = await body(req)).op === 'pause' || b0.op === 'pauselen') {
        const w = layout(dir).words, i = +b0.after;
        if (!(Number.isInteger(i) && i >= 0 && i + 1 < w.length)) return json(res, { ok: false, error: 'bad word' });
        copyFileSync(planFile, join(edits, `${String(snaps.length + 1).padStart(3, '0')}.json`));
        const p = JSON.parse(readFileSync(planFile, 'utf8')), old = (p.pauseSet ?? []).find((q) => q.after === i);
        // The whole pause: an audio squeeze already found inside it (plus the margins it kept), else the transcript gap.
        const sq = (p.squeeze ?? []).filter(([x, y]) => x < w[i + 1].end && y > w[i].start), M = 0.12;
        const from = old?.from ?? (sq.length ? Math.min(...sq.map((q) => q[0])) - M : w[i].end), to = old?.to ?? (sq.length ? Math.max(...sq.map((q) => q[1])) + M : w[i + 1].start);
        const secs = Math.max(0, Math.min(to - from, +b0.secs || 0));
        p.keepPause = [...new Set([...(p.keepPause ?? []), i])];
        p.pauseSet = (p.pauseSet ?? []).filter((q) => q.after !== i);
        if (b0.op === 'pause') p.unsqueeze = [...(p.unsqueeze ?? []), ...sq];
        else p.pauseSet.push({ after: i, from: +from.toFixed(2), to: +to.toFixed(2), secs: +secs.toFixed(2) });
        writeFileSync(planFile, JSON.stringify(p, null, 1));
        label = b0.op === 'pause' ? `You: removed the pause cut after "${w[i].text}"` : `You: pause after "${w[i].text}" set to ${secs.toFixed(2)} s`;
      } else if (b0.op === 'batch') {
        const w = layout(dir).words, ok = (l) => (Array.isArray(l) ? l : []).map(Number).filter((i) => Number.isInteger(i) && i >= 0 && i < w.length);
        const cut = ok(b0.cut), keep = ok(b0.keep), say3 = (l) => l.slice(0, 6).map((i) => w[i].text).join(' ').slice(0, 50);
        if (!cut.length && !keep.length) return json(res, { ok: false, error: 'nothing marked' });
        copyFileSync(planFile, join(edits, `${String(snaps.length + 1).padStart(3, '0')}.json`));
        let p = JSON.parse(readFileSync(planFile, 'utf8'));
        if (keep.length) p = editWords(p, w, keep, true);
        if (cut.length) p = editWords(p, w, cut, false);
        writeFileSync(planFile, JSON.stringify(p, null, 1));
        label = `You: ${[cut.length && `cut ${cut.length} words ("${say3(cut)}")`, keep.length && `brought back ${keep.length} ("${say3(keep)}")`].filter(Boolean).join(', ')}`;
      } else {
        const b = b0, from = +b.from, to = +(b.to ?? b.from), keep = b.op === 'keep', p = JSON.parse(readFileSync(planFile, 'utf8')), w = layout(dir).words;
        if (!(from >= 0 && to >= from && to < w.length)) return json(res, { ok: false, error: 'bad word range' });
        copyFileSync(planFile, join(edits, `${String(snaps.length + 1).padStart(3, '0')}.json`));
        writeFileSync(planFile, JSON.stringify(editWords(p, w, Array.from({ length: to - from + 1 }, (_, k) => from + k), keep), null, 1));
        label = `You: ${keep ? 'bring back' : 'cut'} "${w.slice(from, to + 1).map((x) => x.text).join(' ').slice(0, 60)}"`;
      }
      if (!['undo', 'redo'].includes(m[1])) clearRedo(edits);
      if (existsSync(geomFile(r))) writeFileSync(geomFile(r), JSON.stringify({ ...geomAll(r), stale: true }, null, 1));
      const after = runData(r);
      appendFileSync(join(dir, 'grades.jsonl'), JSON.stringify({ i: hist(r).length, at: new Date().toISOString(), kind: 'edit', label: by(label), grade: after.grade, from: before, delta: +(after.grade - before).toFixed(1), kept: true, parts: after.parts }) + '\n');
      appendFileSync(join(RUNS, v, 'notes.jsonl'), JSON.stringify({ kind: 'edit', run: r, text: by(label), at: new Date().toISOString() }) + '\n');
      say(v, `${cmp(v).label[r]}: ${label} -> ${before} -> ${after.grade}`);
      return json(res, { ok: true, grade: after.grade, from: before, total: after.total, undo: readdirSync(edits).filter((f) => /^\d+\.json$/.test(f)).length, redo: readdirSync(edits).filter((f) => /^redo-\d+\.json$/.test(f)).length });
    }
    if ((m = path.match(/^\/media\/([\w-]+)\/([\w.-]+)$/))) {
      const ext = (m[2].split('.').pop() || '').toLowerCase(), type = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp', svg: 'image/svg+xml', mp4: 'video/mp4', mov: 'video/quicktime', m4v: 'video/mp4', webm: 'video/webm' }[ext];
      return type ? sendMedia(req, res, join(RUNS, m[1], 'media', m[2]), type, url) : (res.writeHead(404), res.end());
    }
    if (req.method === 'POST' && (m = path.match(/^\/api\/overlay\/([\w-]+)$/))) {
      const r = m[1], v = videoOf(r), b = await body(req);
      if (!v) return json(res, { ok: false, error: 'no such version' });
      const dir = runDir(r), planFile = join(dir, 'plan.json'), edits = join(dir, 'edits'), before = runData(r).grade;
      let e;
      try { e = await makeOverlay(dir, join(RUNS, v, 'media'), v, Math.max(0, +b.t || 0), b.mode, String(b.ask || '')); } catch (er) { return json(res, { ok: false, error: er.message }); }
      mkdirSync(edits, { recursive: true });
      const snaps = readdirSync(edits).filter((f) => /^\d+\.json$/.test(f)).sort(), p = JSON.parse(readFileSync(planFile, 'utf8'));
      copyFileSync(planFile, join(edits, `${String(snaps.length + 1).padStart(3, '0')}.json`));
      p.effects = [...(p.effects ?? []), e];
      writeFileSync(planFile, JSON.stringify(p, null, 1));
      clearRedo(edits);
      const after = runData(r), fx = after.fx.find((x) => x.k === p.effects.length - 1), label = `You: Overlay + ${b.mode} at ${fx ? fx.t0.toFixed(1) : '?'} s (${e.fx === 'concept-card' ? 'drawn picture' : e.name})`;
      appendFileSync(join(RUNS, v, 'notes.jsonl'), JSON.stringify({ kind: 'edit', run: r, text: by(label), at: new Date().toISOString() }) + '\n');
      say(v, `${cmp(v).label[r]}: ${label} -> ${before} -> ${after.grade}`);
      return json(res, { ok: true, t0: fx?.t0 ?? +b.t, why: e.why, credit: e.credit ?? '', grade: after.grade, from: before, undo: readdirSync(edits).filter((f) => /^\d+\.json$/.test(f)).length });
    }
    if (req.method === 'POST' && (m = path.match(/^\/api\/media\/([\w-]+)$/))) {
      const r = m[1], v = videoOf(r), name = basename(url.searchParams.get('name') || 'media'), t = Math.max(0, +url.searchParams.get('t') || 0);
      const ext = (name.match(/\.(png|jpe?g|gif|webp|svg|mp4|mov|m4v|webm)$/i)?.[1] || '').toLowerCase();
      if (!v || !ext) { req.resume(); return json(res, { ok: false, error: v ? 'drop an image (png, jpg, gif, webp, svg) or a clip (mp4, mov, webm)' : 'no such version' }); }
      const md = join(RUNS, v, 'media'), stem = name.replace(/\.[^.]+$/, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'media';
      mkdirSync(md, { recursive: true });
      let fn = `${stem}.${ext}`, n = 2; while (existsSync(join(md, fn))) fn = `${stem}-${n++}.${ext}`;
      await new Promise((ok, no) => req.pipe(createWriteStream(join(md, fn))).on('finish', ok).on('error', no));
      const kind = /^(mp4|mov|m4v|webm)$/.test(ext) ? 'video' : 'image', dir = runDir(r), planFile = join(dir, 'plan.json'), edits = join(dir, 'edits'), before = runData(r).grade;
      let dur = 3; if (kind === 'video') { try { dur = Math.max(1, Math.min(6, secs(join(md, fn)))); } catch { dur = 4; } }
      const L0 = layout(dir), total = L0.total, e = { fx: 'media-card', t: +Math.min(t, Math.max(0, total - dur)).toFixed(2), dur: +dur.toFixed(2), kind, src: `/media/${v}/${fn}`, file: join(md, fn), name, why: `you dropped ${name} here` };
      mkdirSync(edits, { recursive: true });
      const snaps = readdirSync(edits).filter((f) => /^\d+\.json$/.test(f)).sort(), p = JSON.parse(readFileSync(planFile, 'utf8'));
      copyFileSync(planFile, join(edits, `${String(snaps.length + 1).padStart(3, '0')}.json`));
      p.effects = [...(p.effects ?? []), e];
      writeFileSync(planFile, JSON.stringify(p, null, 1));
      clearRedo(edits);
      if (existsSync(geomFile(r))) writeFileSync(geomFile(r), JSON.stringify({ ...geomAll(r), stale: true }, null, 1));
      const after = runData(r), label = `You: dropped ${name} at ${e.t.toFixed(1)} s (${kind}, ${e.dur.toFixed(1)} s)`;
      appendFileSync(join(dir, 'grades.jsonl'), JSON.stringify({ i: hist(r).length, at: new Date().toISOString(), kind: 'edit', label: by(label), grade: after.grade, from: before, delta: +(after.grade - before).toFixed(1), kept: true, parts: after.parts }) + '\n');
      appendFileSync(join(RUNS, v, 'notes.jsonl'), JSON.stringify({ kind: 'edit', run: r, text: by(label), at: new Date().toISOString() }) + '\n');
      say(v, `${cmp(v).label[r]}: ${label} -> ${before} -> ${after.grade}`);
      return json(res, { ok: true, kind, t: e.t, dur: e.dur, grade: after.grade, from: before, undo: readdirSync(edits).filter((f) => /^\d+\.json$/.test(f)).length });
    }
    if (req.method === 'POST' && (m = path.match(/^\/api\/flow-version\/([\w-]+)$/))) {
      const v = m[1], b = await body(req);
      if (!videos().includes(v)) return json(res, { ok: false, error: 'no such video' });
      let run;
      try { run = makeFlowRun(RUNS, v, String(b.from || '')); } catch (er) { return json(res, { ok: false, error: er.message }); }
      say(v, `Always moving version from ${cmp(v).label[b.from]}: ${run}`);
      pipeline(v, false);
      return json(res, { ok: true, run });
    }
    if (req.method === 'POST' && (m = path.match(/^\/api\/refresh\/([\w-]+)$/))) {
      if (!videos().includes(m[1])) return json(res, { ok: false, error: 'no such video' });
      pipeline(m[1], false);
      return json(res, { ok: true });
    }
    if (req.method === 'POST' && (m = path.match(/^\/api\/layouts\/([\w-]+)$/))) {
      const v = m[1], b = await body(req);
      if (!videos().includes(v)) return json(res, { ok: false, error: 'no such video' });
      let out;
      try { out = makeLayoutRuns(RUNS, v, String(b.from || '')); } catch (er) { return json(res, { ok: false, error: er.message }); }
      say(v, `Layout versions from ${cmp(v).label[b.from]}: ${out.made.length} made, layouts at ${out.spots.map(([a, z]) => `${a}-${z} s`).join(', ')}`);
      pipeline(v, false);
      return json(res, { ok: true, ...out });
    }
    if (req.method === 'POST' && (m = path.match(/^\/api\/cutout\/([\w-]+)$/))) {
      if (!videoOf(m[1])) return json(res, { ok: false, error: 'no such version' });
      const b = await body(req), engine = b.engine === 'birefnet' ? 'birefnet' : 'apple';
      writeFileSync(join(dirname(realpathSync(rawOf(runDir(m[1])))), 'cutout.json'), JSON.stringify({ engine }) + '\n');
      say(videoOf(m[1]), `Cut-out engine: ${engine === 'birefnet' ? 'BiRefNet (better)' : 'Apple Vision (fast)'}`);
      return json(res, { ok: true, engine });
    }
    if ((m = path.match(/^\/api\/better\/([\w-]+)$/))) {
      if (!videoOf(m[1])) return json(res, { on: false });
      const take = dirname(realpathSync(rawOf(runDir(m[1])))), masks = existsSync(join(take, 'matte-birefnet', 'progress.json'));
      const upTo = birefnetUpTo(runDir(m[1]));
      if (!upTo) return json(res, { on: false, engine: 'apple', masks });
      const L = layout(runDir(m[1]), cands[url.searchParams.get('cand')]?.plan);
      const spans = L.pieces.filter((pc) => pc.s < upTo).map((pc) => [+pc.o.toFixed(2), +(pc.o + Math.min(pc.e, upTo) - pc.s).toFixed(2)]);
      return json(res, { on: true, engine: 'birefnet', masks, done: !Number.isFinite(upTo), upTo: Number.isFinite(upTo) ? +upTo.toFixed(1) : null, total: L.total, spans });
    }
    if ((m = path.match(/^\/api\/pmatte\/([\w-]+)$/))) {
      const r = m[1], k = +url.searchParams.get('k'), cand = url.searchParams.get('cand');
      if (!videoOf(r)) return json(res, { ok: false, error: 'no such version' });
      const L = layout(runDir(r), cands[cand]?.plan), e = L.fx.find((x) => x.k === k);
      if (!e?.cat.matte && e?.params?.cutout !== 'on' && !e?.params?.meBg) return json(res, { ok: false, error: 'no cut-out effect there' });
      const key = `${r}|${k}|${e.t0.toFixed(2)}|${e.dur.toFixed(2)}|${matteEngine(runDir(r), L, e.t0, e.dur)}`, job = (MATTES[key] ??= { state: 'run', at: Date.now() });
      if (!job.p) job.p = editMatte(runDir(r), L, e.t0, e.dur, takeCache(runDir(r))).then((f) => Object.assign(job, { state: 'done', file: basename(f), secs: +((Date.now() - job.at) / 1000).toFixed(1) }), (er) => Object.assign(job, { state: 'fail', error: String(er.message).slice(0, 300) }));
      return json(res, { ok: job.state !== 'fail', state: job.state, error: job.error, secs: job.secs, url: job.file ? `/pmatte/${r}/${job.file}` : null, start: e.t0, dur: e.dur, engine: key.split('|').pop(), better: Number.isFinite(birefnetUpTo(runDir(r))) && birefnetUpTo(runDir(r)) > 0 });
    }
    if ((m = path.match(/^\/pmatte\/([\w-]+)\/(pm-[0-9a-f]{16}\.webm)$/)) && videoOf(m[1])) return sendFile(req, res, join(takeCache(runDir(m[1])), m[2]), 'video/webm');
    if (req.method === 'POST' && (m = path.match(/^\/api\/addfx\/([\w-]+)$/))) {
      const r = m[1], v = videoOf(r), b = await body(req);
      if (!v) return json(res, { ok: false, error: 'no such version' });
      const dir = runDir(r), planFile = join(dir, 'plan.json'), edits = join(dir, 'edits'), before = runData(r).grade, t0 = Date.now();
      const L0 = layout(dir), t = afterTitle(L0, Math.max(0, +b.t || 0)), moved = t !== Math.max(0, +b.t || 0);
      if (!b.fx) say(v, `${cmp(v).label[r]}: Claude is making something for ${t.toFixed(1)} s${b.ask ? ` ("${String(b.ask).slice(0, 60)}")` : ''}`);
      let e;
      try { e = b.fx ? quickFx(L0, t, String(b.fx)) : await addHere(dir, t, [b.draw ? 'Use concept-card and draw it.' : '', String(b.ask || '').slice(0, 400)].filter(Boolean).join(' ')); } catch (er) { return json(res, { ok: false, error: er.message }); }
      mkdirSync(edits, { recursive: true });
      const snaps = readdirSync(edits).filter((f) => /^\d+\.json$/.test(f)).sort(), p = JSON.parse(readFileSync(planFile, 'utf8'));
      copyFileSync(planFile, join(edits, `${String(snaps.length + 1).padStart(3, '0')}.json`));
      p.effects = [...(p.effects ?? []), e];
      writeFileSync(planFile, JSON.stringify(p, null, 1));
      clearRedo(edits);
      if (existsSync(geomFile(r))) writeFileSync(geomFile(r), JSON.stringify({ ...geomAll(r), stale: true }, null, 1));
      const after = runData(r), label = `You: add ${e.fx} at ${t.toFixed(1)} s - ${e.why ?? ''}`.slice(0, 160), added = after.fx.find((x) => x.k === p.effects.length - 1);
      appendFileSync(join(dir, 'grades.jsonl'), JSON.stringify({ i: hist(r).length, at: new Date().toISOString(), kind: 'edit', label: by(label), grade: after.grade, from: before, delta: +(after.grade - before).toFixed(1), kept: true, parts: after.parts }) + '\n');
      appendFileSync(join(RUNS, v, 'notes.jsonl'), JSON.stringify({ kind: 'edit', run: r, text: by(label), at: new Date().toISOString() }) + '\n');
      say(v, `${cmp(v).label[r]}: ${label} -> ${before} -> ${after.grade} (${((Date.now() - t0) / 1000).toFixed(0)} s, on your own AI plan)`);
      return json(res, { ok: true, fx: e.fx, name: byId[e.fx]?.name ?? e.fx, why: e.why ?? '', t0: added?.t0 ?? t, dur: added?.dur ?? null, moved, grade: after.grade, from: before, undo: readdirSync(edits).filter((f) => /^\d+\.json$/.test(f)).length });
    }
    if (req.method === 'POST' && (m = path.match(/^\/api\/look\/([\w-]+)$/))) { if (!videoOf(m[1])) return json(res, { ok: false, error: 'no such version' }); const L = await lookOne(m[1]); return json(res, { ok: true, flagged: L.issues.length, frames: L.frames }); }
    if (req.method === 'POST' && (m = path.match(/^\/api\/scan\/([\w-]+)$/))) { if (!videoOf(m[1])) return json(res, { ok: false, error: 'no such version' }); const t0 = Date.now(); await scanOne(m[1]); return json(res, { ok: true, run: m[1], secs: +((Date.now() - t0) / 1000).toFixed(1) }); }
    if (req.method === 'POST' && (m = path.match(/^\/api\/improve\/([\w-]+)$/))) { if (!videoOf(m[1])) return json(res, { ok: false, error: 'no such version' }); improve(m[1]); return json(res, { ok: true, run: m[1] }); }
    if (req.method === 'POST' && (m = path.match(/^\/api\/run\/([\w-]+)$/))) { pipeline(m[1], true); return json(res, { ok: true }); }
    if ((m = path.match(/^\/api\/edit-ideas\/([\w-]+)$/))) {
      if (!videos().includes(m[1])) { res.writeHead(404, { 'content-type': 'application/json' }); return res.end('{"error":"no such video"}'); }
      if (req.method === 'GET') return json(res, ideasOf(m[1]));
      if (req.method === 'POST') {
        const d = await body(req), data = ideasOf(m[1]), idea = data?.ideas.find((i) => i.id === d.id);
        if (!idea || !['approve', 'change', 'skip', 'custom'].includes(d.decision)) return json(res, { ok: false, error: 'unknown idea or decision' });
        const opt = d.option ? (idea.options ?? []).find((o) => o.id === d.option) : null;
        if (d.option && !opt) return json(res, { ok: false, error: 'unknown option' });
        const at = new Date().toISOString(), note = String(d.note ?? '').slice(0, 500), run = cmp(m[1]).runs.includes(data.version) ? data.version : null;
        appendFileSync(join(RUNS, m[1], 'edit-ideas-decisions.jsonl'), JSON.stringify({ id: idea.id, decision: d.decision, note, ...(opt ? { option: opt.id } : {}), version: data.version, at }) + '\n');
        const n = { kind: 'idea', run, label: data.version, t: idea.at, idea: idea.id, decision: d.decision, option: opt?.id, text: `${idea.id} ${d.decision.toUpperCase()}${opt ? ` option ${opt.id} "${opt.label}"` : ''} (${idea.kind} ${idea.at}-${idea.to}s): ${opt ? `${opt.say ?? idea.say} | how: ${opt.how}` : idea.say}${note ? ` | You: ${note}` : ''}`, at };
        appendFileSync(join(RUNS, m[1], 'notes.jsonl'), JSON.stringify(n) + '\n');
        console.log(`NOTE ${JSON.stringify(n)}`);
        return json(res, { ok: true, ideas: ideasOf(m[1]) });
      }
    }
    if (req.method === 'POST' && (m = path.match(/^\/api\/note\/([\w-]+)$/))) {
      const d = { ...(await body(req)), at: new Date().toISOString() };
      if (!d.kind) return json(res, { ok: false, error: 'empty note' });
      if (d.shot && d.run && d.t != null && cmp(m[1]).runs.includes(d.run)) {
        try { const dir = join(RUNS, m[1], 'note-shots'), f = join(dir, `${Date.now()}-${(+d.t).toFixed(1)}.jpg`); mkdirSync(dir, { recursive: true }); copyFileSync(await shot(d.run, Math.max(0, +d.t)), f); d.shot = f; } catch (e) { d.shot = null; d.shotError = String(e.message || e); }
      }
      appendFileSync(join(RUNS, m[1], 'notes.jsonl'), JSON.stringify(d) + '\n');
      console.log(`NOTE ${JSON.stringify(d)}`);
      if (d.kind === 'caption-style' && d.run && cmp(m[1]).runs.includes(d.run) && /^[\w-]+$/.test(d.text)) { const f = join(runDir(d.run), 'plan.json'), p = JSON.parse(readFileSync(f, 'utf8')); p.captionStyle = d.text; writeFileSync(f, JSON.stringify(p, null, 1)); }
      if (d.kind === 'hook-style' && d.run && cmp(m[1]).runs.includes(d.run)) { const f = join(runDir(d.run), 'plan.json'), p = JSON.parse(readFileSync(f, 'utf8')); p.titleStyle = d.text; writeFileSync(f, JSON.stringify(p, null, 1)); }
      if (d.kind === 'hook-text' && d.run && cmp(m[1]).runs.includes(d.run) && typeof d.title === 'string') { const f = join(runDir(d.run), 'plan.json'), p = JSON.parse(readFileSync(f, 'utf8')); p.title = d.title.trim().slice(0, 120); p.subtitle = String(d.subtitle ?? '').trim().slice(0, 120); p.titleEdited = true; writeFileSync(f, JSON.stringify(p, null, 1)); }
      if (d.kind === 'hook-len' && d.run && cmp(m[1]).runs.includes(d.run) && +d.text > 0) { const f = join(runDir(d.run), 'plan.json'), p = JSON.parse(readFileSync(f, 'utf8')); p.titleDur = +Math.max(0.5, Math.min(15, +d.text)).toFixed(2); writeFileSync(f, JSON.stringify(p, null, 1)); }
      if (d.kind === 'cap-hold' && d.run && cmp(m[1]).runs.includes(d.run)) { const f = join(runDir(d.run), 'plan.json'), p = JSON.parse(readFileSync(f, 'utf8')); if (d.text === 'on') p.capHold = true; else delete p.capHold; writeFileSync(f, JSON.stringify(p, null, 1)); }
      if (d.kind === 'hook-quiet' && d.run && cmp(m[1]).runs.includes(d.run)) { const f = join(runDir(d.run), 'plan.json'), p = JSON.parse(readFileSync(f, 'utf8')); p.quietTitle = d.text === 'on'; writeFileSync(f, JSON.stringify(p, null, 1)); }
      if (d.kind === 'hook-cam' &&d.run && cmp(m[1]).runs.includes(d.run) && (d.text === 'none' || CAMS[d.text])) { const f = join(runDir(d.run), 'plan.json'), p = JSON.parse(readFileSync(f, 'utf8')); delete p.cam; p.camdrop = setHookDrop(layout(runDir(d.run), p), d.text !== 'none'); writeFileSync(f, JSON.stringify(p, null, 1)); }
      if (d.kind === 'color-grade' && d.run && cmp(m[1]).runs.includes(d.run) && gradeId(d.text) === d.text) { const f = join(runDir(d.run), 'plan.json'), p = JSON.parse(readFileSync(f, 'utf8')); p.color = d.text; p.colorAmt = gradeAmt(d.amt); writeFileSync(f, JSON.stringify(p, null, 1)); }
      if (d.kind === 'theme' && d.run && cmp(m[1]).runs.includes(d.run) && themeId(d.text) === d.text) { const f = join(runDir(d.run), 'plan.json'), p = JSON.parse(readFileSync(f, 'utf8')); p.theme = d.text; writeFileSync(f, JSON.stringify(p, null, 1)); }
      if (d.kind === 'hook-sound' && d.run && cmp(m[1]).runs.includes(d.run) && (d.text === 'none' || (soundPacks().hookSounds ?? []).some((x) => x.id === d.text))) { const f = join(runDir(d.run), 'plan.json'), p = JSON.parse(readFileSync(f, 'utf8')); if (d.text === 'none') delete p.hookSound; else p.hookSound = d.text; writeFileSync(f, JSON.stringify(p, null, 1)); }
      if (d.kind === 'sfx-edit' && d.run && cmp(m[1]).runs.includes(d.run) && typeof d.from === 'string' && Number.isFinite(+d.cue) && (d.to === null || (typeof d.to === 'string' && sfxPath(d.to)))) { const f = join(runDir(d.run), 'plan.json'), p = JSON.parse(readFileSync(f, 'utf8')), E = (p.sfxEdits ??= []), e = E.find((x) => Math.abs(x.at - +d.cue) < 0.06 && (x.to === d.from || x.from === d.from)); if (e) e.to = d.to; else E.push({ at: +d.cue, from: d.from, to: d.to }); writeFileSync(f, JSON.stringify(p, null, 1)); }
      if (d.kind === 'sfx-add' && d.run && cmp(m[1]).runs.includes(d.run) && Number.isFinite(+d.t) && typeof d.to === 'string' && sfxPath(d.to)) { const f = join(runDir(d.run), 'plan.json'), p = JSON.parse(readFileSync(f, 'utf8')); (p.sfxAdd ??= []).push({ t: +(+d.t).toFixed(2), ref: d.to }); writeFileSync(f, JSON.stringify(p, null, 1)); }
      if (d.kind === 'sound-pack' && d.run && cmp(m[1]).runs.includes(d.run) && soundPacks().packs[d.text]) { const f = join(runDir(d.run), 'plan.json'), p = JSON.parse(readFileSync(f, 'utf8')); p.soundPack = d.text; writeFileSync(f, JSON.stringify(p, null, 1)); }
      return json(res, { ok: true, got: d });
    }
    res.writeHead(404); res.end();
  } catch (e) {
    console.error(e);
    if (!res.headersSent) res.writeHead(500, { 'content-type': 'text/plain' });
    res.end(String(e.stack || e));
  }
}).listen(PORT, '127.0.0.1', async () => {
  console.log(`LIVE http://yapcut-preview.localhost:${PORT}/  (${videos().join(', ')})`);
  if (!process.argv.includes('--no-pipeline')) for (const v of videos()) await pipeline(v, false);
});
