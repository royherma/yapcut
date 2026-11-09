import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { pickEmphasis } from './cues.mjs';
import { clData, H, ROOT, W } from './lab.mjs';

export const STYLE_DIR = join(ROOT, 'styles');

export function styles() {
  return readdirSync(STYLE_DIR).filter((f) => f.endsWith('.html')).map((f) => {
    const html = readFileSync(join(STYLE_DIR, f), 'utf8');
    return { id: f.replace(/\.html$/, ''), title: html.match(/<title>([^<]*)<\/title>/)?.[1] ?? f };
  });
}

const RUNTIME = `<script>
(function () {
  var root = document.querySelector('[data-cl-root]');
  var id = root.getAttribute('data-composition-id');
  function place() {
    CL.cues.forEach(function (c) {
      document.querySelectorAll('[data-cl-cue="' + c.id + '"]').forEach(function (el) {
        el.style.transformOrigin = '50% ' + (CL.anchorY * 100) + '%';
        el.style.transform = 'translate(' + (c.x || 0) + 'px,' + (c.y || 0) + 'px) scale(' + (c.scale || 1) + ')';
      });
    });
  }
  window.CL_API = {
    id: id,
    seek: function (t) { var tl = window.__timelines && window.__timelines[id]; if (tl) tl.seek(t, false); },
    setCue: function (i, p) { var c = CL.cues.find(function (q) { return q.id === i; }); if (c) { Object.assign(c, p); place(); } },
    place: place,
  };
  place();
  var t = new URLSearchParams(location.search).get('t');
  if (t !== null) window.CL_API.seek(+t);
  window.CL_READY = true;
})();
</script>`;

/** opts: { bg: still behind the captions, video: clip to embed (render), matte: cut-out speaker (.webm render, .png still) layered over CL_MATTE titles } */
export function stylePage(id, lab, opts = {}) {
  const file = join(STYLE_DIR, `${id}.html`);
  if (!existsSync(file)) throw new Error(`no style ${id}`);
  let html = readFileSync(file, 'utf8');
  const data = { ...clData(lab), matte: !!opts.matte, ...(opts.data ?? {}) };
  html = html.replace('<!--CL_DATA-->', `<script>window.CL = ${JSON.stringify(data)};</script>`);
  html = html.replaceAll('__CL_DURATION__', String(lab.duration));
  if (opts.video) html = html.replace('<!--CL_VIDEO-->', `<video id="a-roll" class="clip" src="${opts.video}" playsinline${opts.muted ? ' muted' : ' data-has-audio="true"'} data-start="0" data-duration="${lab.duration}" data-track-index="0" style="position:absolute;inset:0;width:100%;height:100%;object-fit:cover;z-index:0"></video>`);
  if (opts.matte) html = html.replace('<!--CL_MATTE-->', opts.matte.endsWith('.png')
    ? `<img id="cl-matte" src="${opts.matte}" style="position:absolute;inset:0;width:100%;height:100%;object-fit:cover;z-index:2">`
    : `<video id="cl-matte" src="${opts.matte}" muted playsinline data-start="0" data-duration="${lab.duration}" data-track-index="1" style="position:absolute;inset:0;width:100%;height:100%;object-fit:cover;z-index:2"></video>`);
  if (opts.bg) html = html.replace('</head>', `<style>html,body{background:#000 url("${opts.bg}") center/cover no-repeat !important}</style></head>`);
  return html.replace('</body>', `${RUNTIME}</body>`);
}

export const OURS = [
  { id: 'tg-pill-sentence', title: 'Pill · Sentence', note: 'white boxes per line, keyword green' },
  { id: 'tg-mark-marker', group: 'Highlight set', title: 'Mark · Marker', note: 'highlighter on the word being said' },
  { id: 'tg-mark-box', group: 'Highlight set', title: 'Mark · Box', note: 'warm box on the word being said' },
  { id: 'tg-mark-underline', group: 'Highlight set', title: 'Mark · Underline', note: 'hand-drawn line under the word being said' },
  { id: 'tg-mark-sweep', group: 'Highlight set', title: 'Mark · Sweep', note: 'line fills under the word as it is said' },
  { id: 'tg-mark-circle', group: 'Highlight set', title: 'Mark · Circle', note: 'hand-drawn circle around the word being said' },
  { id: 'tg-active-pop', group: 'Active word', title: 'Active · Pop', note: 'serif, word being said grows and turns warm' },
  { id: 'tg-active-jump', group: 'Active word', title: 'Active · Jump', note: 'serif, word being said hops up and lands' },
  { id: 'tg-active-italic', group: 'Active word', title: 'Active · Italic pop', note: 'serif, word being said goes italic, warm, a bit bigger' },
  { id: 'tg-active-spotlight', group: 'Active word', title: 'Active · Spotlight', note: 'serif, all words dim, the one being said lights up' },
  { id: 'tg-active-color', group: 'Active word', title: 'Active · Color', note: 'bold outlined caps, word being said turns yellow' },
  { id: 'tg-active-bounce', group: 'Active word', title: 'Active · Bounce', note: 'bold outlined caps, word being said turns green and springs' },
  { id: 'tg-active-glide', group: 'Active word', title: 'Active · Glide', note: 'bold caps, a yellow pill slides from word to word' },
  { id: 'tg-active-fill', group: 'Active word', title: 'Active · Fill', note: 'bold caps, each word fills with color over the time it is said' },
  { id: 'tg-active-reveal', group: 'Active word', title: 'Active · Reveal', note: 'bold caps, each word pops in the moment it is said' },
  { id: 'tg-active-now', group: 'Active word', title: 'Active · Now', note: 'serif, calm: one word at a time, two when fast, centered, a gap after it; color only on the key word' },
];
export const ALIAS = {"tg-serif-whisper":"tg-active-now","tg-serif-solo":"tg-active-reveal","tg-serif-glow":"tg-active-pop","tg-serif-ink":"tg-mark-marker","tg-serif-stack":"tg-active-color","tg-serif-mix":"tg-active-color","tg-serif-box":"tg-mark-box","tg-serif-auto":"tg-mark-marker","tg-serif-caps":"tg-active-reveal","tg-serif-duo":"tg-active-now","tg-pill-dani":"tg-pill-sentence"};
export const FITTED = new Set(['caption-pill-karaoke']);

const SAMPLE = [[['The', 0.16], ['quick', 0.34], ['brown', 0.28], ['fox', 0.44]], [['jumps', 0.38], ['over', 0.2], ['the', 0.1], ['lazy', 0.4], ['dog.', 0.58]]];

/** A style playing "The quick brown fox..." on a plain dark backdrop, for comparing looks without the clip. */
export function samplePage(id, speed = 1) {
  const words = [], cues = [];
  let t = 0.1;
  SAMPLE.forEach((line) => {
    const from = words.length;
    line.forEach(([text, said]) => { words.push({ text, start: +t.toFixed(2), end: +(t + said).toFixed(2) }); t += said + 0.05; });
    cues.push({ id: cues.length, from, to: words.length - 1, start: words[from].start, end: words.at(-1).end, x: 0, y: 0, scale: 1, emph: pickEmphasis(words, from, words.length - 1) });
    t += 0.4;
  });
  const low = /^tg-rh-(title|mix)$|^tg-pill-/.test(id);
  const lab = { slug: 'sample', duration: +(words.at(-1).end + 0.45).toFixed(2), width: W, height: H, anchorY: low ? 0.565 : 0.5, headline: 'Quick', words, cues };
  const html = pageFor(id, lab, { data: { speed, titleY: 0.47, layouts: [{ t0: cues[1].start - 0.05, t1: lab.duration }] } });
  return html.replace('</head>', '<style>html,body{background:radial-gradient(120% 60% at 50% 50%,#3a352f,#191715) !important}</style></head>');
}

/** A renderable 9:16 page for a style id: our templates (file-variant) or a fitted HyperFrames block. */
export function pageFor(id, lab, opts = {}) {
  id = ALIAS[id] ?? id;
  const ours = id.match(/^(tg-[a-z]+)-(\w+)$/);
  const html = ours ? stylePage(ours[1], lab, { ...opts, data: { ...opts.data, variant: ours[2] } }) : FITTED.has(id) ? stylePage(id, lab, opts) : null;
  if (!html) throw new Error(`${id} is not fitted to 9:16 yet`);
  return opts.solid ? html.replace('</head>', '<style>html,body{background:#000}</style></head>') : html;
}
