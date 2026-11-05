const STOP = new Set('the a an and or but of to in on at for with from by is are was were be been it its it\'s this that these those there their they them we we\'re you your i i\'m my me our he she his her as so if then than just very really have has had do does did can could will would should might going gonna about into up down out over not no yes why what how when where which who what\'s that\'s there\'s here\'s let\'s don\'t can\'t won\'t isn\'t didn\'t doesn\'t'.split(' '));

export const bare = (w) => w.toLowerCase().replace(/[^a-z0-9']/g, '');

export function pickEmphasis(words, from, to) {
  let best = -1, len = 0;
  for (let i = from; i <= to; i++) {
    const b = Math.max(0, ...words[i].text.split(/\s+/).map(bare).filter((x) => !STOP.has(x)).map((x) => x.length));
    if (b >= 5 && b > len) { best = i; len = b; }
  }
  return best < 0 ? [] : [best];
}

export function buildCues(words, { maxWords = 4, maxChars = 22, maxSeconds = 2.4, pause = 0.25 } = {}) {
  const cues = [];
  let from = 0;
  const close = (to) => {
    cues.push({ from, to, start: words[from].start, end: words[to].end, x: 0, y: 0, scale: 1, emph: pickEmphasis(words, from, to) });
    from = to + 1;
  };
  for (let i = 0; i < words.length; i++) {
    const next = words[i + 1];
    if (!next) { close(i); break; }
    const n = i - from + 1;
    const chars = words.slice(from, i + 2).map((w) => w.text).join(' ').length;
    const ends = words[i].brk || /[.,!?;:]$/.test(words[i].text) || next.start - words[i].end >= pause;
    if (ends || n >= maxWords || chars > maxChars || next.end - words[from].start > maxSeconds) close(i);
  }
  return cues.map((c, i) => ({ id: i, ...c }));
}

export function settle(cues, duration) {
  const out = cues.map((c) => ({ ...c }));
  for (let i = 0; i < out.length; i++) {
    const next = out[i + 1];
    out[i].show = Math.max(0, out[i].start);
    out[i].hide = Math.min(next ? next.start : duration, out[i].end + 0.35);
    if (out[i].hide <= out[i].show) out[i].hide = out[i].show + 0.05;
  }
  return out;
}

// Layout caption chunks ("is ridiculous") back to one entry per word, time split by letter count; hi = indexes of highlighted words.
export function chunkWords(caps) {
  const words = [], hi = [];
  for (const c of caps) {
    const parts = c.text.split(/\s+/).filter(Boolean), tot = parts.reduce((a, p) => a + p.length, 0) || 1;
    let t = c.t0;
    for (const p of parts) {
      const d = (c.t1 - c.t0) * p.length / tot;
      if (c.hi) hi.push(words.length);
      words.push({ text: p.replace(/[.,;:]+(["'”’)]*)$/, '$1'), start: +t.toFixed(3), end: +(t + d).toFixed(3), ...(/[.,!?;:]["'”’)]*$/.test(p) ? { brk: true } : {}) });
      t += d;
    }
  }
  return { words, hi };
}

export const capLimits = (p) => (p?.capWords ? { maxWords: p.capWords, maxChars: p.capWords * 8 } : {});
