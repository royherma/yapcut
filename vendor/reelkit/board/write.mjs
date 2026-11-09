#!/usr/bin/env node
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { claude } from '../../../lib/personas.mjs';
import { loadTheme } from './fit.mjs';

const KINDS = ['text', 'number', 'cutout', 'stroke', 'pill'];

export function boardPrompt(words, theme, direction = '') {
  const listing = words.map((w, i) => `${i}:${w.text}@${w.start.toFixed(1)}`).join(' ');
  return `You design the on-screen graphics ("the board") for a vertical talking-head video (1080x1920). The board lives in the free
band of the frame that does not cover the face. You write a list of beats; code handles all positions and seconds.

The video, as "wordIndex:word@seconds":
${listing}

${direction ? `Creator's direction: ${direction}\n` : ''}Element kinds (the "el" of an add):
- text: {"type":"text","text":"...","size":"hero|title|body|small","color":<name>,"enter":"rise|type|words","halo":bool,"deco":"sparkle","align":"left"}
  Colored words inline: "How much [money](gold) do you need". "\\n" breaks lines. Max 3 lines, max 26 chars a line.
  enter "type" = letters type in (short headers), "words" = each word appears as it is spoken (quotes).
- number: {"type":"number","to":1000000,"fmt":"$" or "+$" or "%","size":"hero","color":<name>,"label":"Investment"} - counts up from 0.
- cutout: {"type":"cutout","emoji":"one emoji","art":"one photographable object, 4-10 words","color":<name>,"label":"two\\nlines","size":"normal|big|small"}
  - a magazine-style photo cutout in a colored circle (art becomes the picture; emoji is the fallback).
- pill: {"type":"pill","to":10000000,"fmt":"+$","color":"red"} or {"type":"pill","text":"..."} - a small colored tag.
- stroke: {"type":"stroke","shape":"ellipse","around":"<id>","color":<name>} - hand-drawn ring around an element (emphasis).
Colors: ${Object.keys(theme.colors).filter((c) => c !== 'ink').join(', ')} (omit for white).

Verbs ("do"):
- add: {"at":<wordIndex>,"do":"add","id":"short-id","el":{...}} - stacks under what is there. Options: "beside":"<id>","side":"left|right"
  (same row), "orbit":"<id>" (small cutouts around a big one), "col":"new" (start a new column to the right, for a mind map), "first":true (top of stack).
- swap: {"at":..,"do":"swap","id":"<id>","el":{"to":2500000}} - a number rolls to a new value. Also "el":{"halo":true}.
- link: {"at":..,"do":"link","from":"<id>","to":"<id>","shape":"loop|curl|squiggle|bracket","side":"left|right"} - hand-drawn connector.
  loop = between two side-by-side items, curl = between two stacked numbers, squiggle = orbit spokes, bracket = mind-map branches.
- clear: {"at":..,"do":"clear"} all leave, or {"do":"clear","ids":[...]} only those.
- pan: {"at":..,"do":"pan","to":"<id>"} - slide the board so that item's column is centered (after a "col":"new").

Rules:
- "at" is the index of the word the element belongs to: the number when the number is said, the key noun, the first word of a quote.
- One change every 2-3 s while the board is up. Each element stays at least 1.2 s. Max 4 things stacked; clear before a new topic.
- Leave the board empty when nothing concrete is being said (stories, asides) - that is fine.
- Text on screen is a short distillation, not the transcript. Section changes get a header (enter "type", color salmon, halo).
- Numbers and money always become a number element; a change in a number is a swap, not a new element.

Return ONLY JSON: {"theme":"${theme.name}","beats":[...]}`;
}

export function validate(board, words) {
  const ids = new Set(), errs = [];
  for (const b of board.beats) {
    if (!Number.isInteger(b.at) || b.at < 0 || b.at >= words.length) errs.push(`bad at ${b.at}`);
    if (b.do === 'add') {
      if (!KINDS.includes(b.el?.type)) errs.push(`unknown kind ${b.el?.type}`);
      if (b.el?.type === 'stroke' && !ids.has(b.el.around)) errs.push(`ring around missing ${b.el.around}`);
      if (b.id) ids.add(b.id);
    }
    for (const k of ['beside', 'orbit']) if (b[k] && !ids.has(b[k])) errs.push(`${b.id}: ${k} unknown ${b[k]}`);
    if (['swap'].includes(b.do) && !ids.has(b.id)) errs.push(`swap unknown ${b.id}`);
    if (b.do === 'link' && !(ids.has(b.from) && ids.has(b.to))) errs.push(`link unknown ${b.from}->${b.to}`);
  }
  return errs;
}

export function compare(a, b, words) {
  const near = (x, y) => x.do === y.do && Math.abs(x.at - y.at) <= 3;
  const hit = a.beats.filter((x) => b.beats.some((y) => near(x, y))).length;
  const count = (bd, d) => bd.beats.filter((x) => x.do === d).length;
  const span = (bd) => { const s = bd.beats.map((x) => words[x.at].start); return `${Math.min(...s).toFixed(0)}-${Math.max(...s).toFixed(0)} s`; };
  return {
    beats: [a.beats.length, b.beats.length], span: [span(a), span(b)],
    verbs: Object.fromEntries(['add', 'swap', 'link', 'clear', 'pan'].map((d) => [d, [count(a, d), count(b, d)]])),
    sameWordWithin3: `${hit}/${a.beats.length}`,
  };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const dir = resolve(process.argv[2]);
  const theme = loadTheme(process.argv[3] || 'pastel-serif');
  const { words } = JSON.parse(readFileSync(join(dir, 'words.json'), 'utf8'));
  const t0 = Date.now();
  const board = await claude(boardPrompt(words, theme, process.argv[4] || ''));
  const errs = validate(board, words);
  board.beats = board.beats.filter((b) => b.do !== 'add' || KINDS.includes(b.el?.type));
  writeFileSync(join(dir, 'board.claude.json'), JSON.stringify(board, null, 1));
  console.log(`board.claude.json: ${board.beats.length} beats in ${((Date.now() - t0) / 1000).toFixed(0)} s${errs.length ? `\nproblems: ${errs.join('; ')}` : ''}`);
  if (!existsSync(join(dir, 'board.json'))) { writeFileSync(join(dir, 'board.json'), JSON.stringify(board, null, 1)); console.log('also saved as board.json (no hand-written one here)'); }
  try { console.log(JSON.stringify(compare(JSON.parse(readFileSync(join(dir, 'board.json'), 'utf8')), board, words), null, 1)); } catch {}
}
