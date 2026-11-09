// The kinds of talking-head video we make, and the beats each one needs to land. The ideas step picks one per take.
// need: a cut without this beat is broken. last: the cut must end inside this beat.
export const FORMATS = {
  breakdown: { name: 'Number breakdown', what: 'adds up a cost, budget or set of numbers to one total', beats: [
    { id: 'claim', label: 'Claim', need: true, what: 'the promise or the total up front' },
    { id: 'items', label: 'The parts', need: true, what: 'each line item with its number' },
    { id: 'total', label: 'Total', need: true, what: 'the sum or the takeaway number' },
    { id: 'close', label: 'Close', need: true, last: true, what: 'what it means for you, or a question / call to action' }] },
  howto: { name: 'How-to', what: 'teaches the steps to do one thing', beats: [
    { id: 'problem', label: 'Problem', need: true, what: 'what you will be able to do, or the pain' },
    { id: 'steps', label: 'Steps', need: true, what: 'the steps in order' },
    { id: 'result', label: 'Result', need: true, last: true, what: 'the result, or the one thing to remember' }] },
  list: { name: 'List', what: 'N tools, tips or reasons', beats: [
    { id: 'promise', label: 'Promise', need: true, what: 'how many and what you get' },
    { id: 'items', label: 'Items', need: true, what: 'each item' },
    { id: 'close', label: 'Close', need: false, last: true, what: 'the best one, or a call to action' }] },
  take: { name: 'Hot take', what: 'one opinion argued', beats: [
    { id: 'claim', label: 'Claim', need: true, what: 'the opinion, said plainly' },
    { id: 'reasons', label: 'Reasons', need: true, what: 'why, with proof' },
    { id: 'restate', label: 'Land it', need: true, last: true, what: 'the claim again, sharper, or a question to the viewer' }] },
  story: { name: 'Story', what: 'something that happened and what it taught', beats: [
    { id: 'setup', label: 'Setup', need: true, what: 'who, where, what was at stake' },
    { id: 'turn', label: 'Turn', need: true, what: 'what changed or went wrong' },
    { id: 'lesson', label: 'Lesson', need: true, last: true, what: 'what it means' }] },
  demo: { name: 'Tool demo', what: 'shows one tool or feature working', beats: [
    { id: 'what', label: 'What it is', need: true, what: 'the tool and what it does, in one line' },
    { id: 'show', label: 'Show it', need: true, what: 'it working' },
    { id: 'verdict', label: 'Verdict', need: true, last: true, what: 'who should use it, or where to get it' }] },
  compare: { name: 'Comparison', what: 'X vs Y', beats: [
    { id: 'setup', label: 'Setup', need: true, what: 'the two things' },
    { id: 'diffs', label: 'Differences', need: true, what: 'how they differ' },
    { id: 'pick', label: 'Pick', need: true, last: true, what: 'which one, for whom' }] },
  news: { name: 'News', what: 'something just happened', beats: [
    { id: 'what', label: 'What happened', need: true, what: 'the news in one line' },
    { id: 'why', label: 'Why it matters', need: true, what: 'what changes' },
    { id: 'next', label: 'What to do', need: false, last: true, what: 'what to do about it' }] },
  moment: { name: 'Moment', what: 'one reaction, joke or clip that loops - no ending needed', beats: [
    { id: 'moment', label: 'The moment', need: true, what: 'the line itself' }] },
};

export const formatList = () => Object.entries(FORMATS).map(([id, f]) => `- ${id}: ${f.name} - ${f.what}. Beats: ${f.beats.map((b) => `${b.id} (${b.what}${b.need ? '' : ', optional'}${b.last ? ', the cut ends here' : ''})`).join(', ')}`).join('\n');

const range = ([a, b]) => Array.from({ length: b - a + 1 }, (_, k) => a + k);

// Which beats a cut keeps: a beat counts as kept when half of one of its parts plays (a beat can be said in several places). Returns [{id, label, need, last, kept, share}].
export function beatsKept(format, beats = {}, keptIdx) {
  const f = FORMATS[format];
  if (!f) return [];
  const kept = new Set(keptIdx);
  return f.beats.map((b) => {
    const rs = beats[b.id] ?? [], part = (r) => range(r).filter((i) => kept.has(i)).length / range(r).length;
    const share = Math.max(0, ...rs.map(part));
    return { id: b.id, label: b.label, need: b.need, last: !!b.last, what: b.what, found: rs.length > 0, kept: share >= 0.5, share: +share.toFixed(2) };
  });
}

// Cuts must be word index ranges; the LLM sometimes answers in seconds - map those to the words they cover.
export function wordRanges(ranges, words) {
  if (ranges.flat().every(Number.isInteger)) return ranges;
  return ranges.map(([a, b]) => { const ix = words.flatMap((w, i) => (w.start >= a - 0.05 && w.start < b ? [i] : [])); return ix.length ? [ix[0], ix.at(-1)] : null; }).filter(Boolean);
}

const ENDS = /[.!?]["')]*$/, FILLER = /^(uh|um|erm|ah|so|like|now|and|okay|ok|yeah)[,.]?$/i;

// Repairs one cut in place so it plays whole sentences and every needed beat, ending inside the format's last beat.
// Returns the list of repairs made, in words, for the log and the page.
export function repairCut(cut, words, format, beats = {}, fullDrop = [], donor = null) {
  const done = [], f = FORMATS[format], says = ([a, b]) => `"${words.slice(a, b + 1).map((w) => w.text).join(' ').slice(0, 60)}"`;
  cut.drop = (cut.drop ?? []).filter(([a, b]) => {
    const startsSentence = a === 0 || ENDS.test(words[a - 1].text), fillers = words.slice(a, b + 1).every((w) => FILLER.test(w.text));
    const broken = startsSentence && !fillers && a === b && !ENDS.test(words[b].text);
    if (broken) done.push(`kept ${says([a, b])} - cutting it left a sentence without its start`);
    return !broken;
  });
  cut.keep = cut.keep.map(([a, b]) => {
    let b2 = b;
    for (let k = 0; k < 14 && b2 < words.length - 1 && !ENDS.test(words[b2].text); k++) b2++;
    if (!ENDS.test(words[b2].text)) b2 = b;
    if (b2 !== b) done.push(`finished the sentence ${says([b + 1, b2])}`);
    return [a, b2];
  });
  if (!f) return dedupe(cut, done);
  const inKeep = (i) => cut.keep.some(([a, b]) => i >= a && i <= b);
  const addDrops = ([a, b]) => {
    cut.drop = cut.drop.flatMap(([x, y]) => [[x, Math.min(y, a - 1)], [Math.max(x, b + 1), y]].filter(([p, q]) => p <= q));
    for (const d of fullDrop) if (d[0] >= a && d[1] <= b && !cut.drop.some((x) => x[0] === d[0])) cut.drop.push(d);
  };
  for (const b of f.beats.filter((x) => x.need && !x.last && beats[x.id]?.length)) {
    for (const r of beats[b.id]) {
      const idx = range(r);
      if (idx.filter(inKeep).length / idx.length >= 0.5) continue;
      const tight = donor ? donor.keep.map(([a, z]) => [Math.max(a, r[0]), Math.min(z, r[1])]).filter(([a, z]) => a <= z) : [];
      const add = tight.length ? tight : [r], at = cut.keep.findLastIndex(([a]) => a < r[0]);
      cut.keep.splice(at + 1, 0, ...add); add.forEach(addDrops);
      done.push(`added the ${b.label} beat ${says(r)}${tight.length ? ` as the ${donor.name} cut plays it` : ''}`);
      break;
    }
  }
  const last = f.beats.find((x) => x.last), lr = last && beats[last.id]?.at(-1);
  if (lr) {
    const endsInside = (() => { const [, e] = cut.keep.at(-1); return e >= lr[0] && e <= lr[1]; })();
    if (!endsInside) {
      cut.keep = cut.keep.flatMap(([a, b]) => (b < lr[0] || a > lr[1] ? [[a, b]] : [[a, lr[0] - 1], [lr[1] + 1, b]].filter(([x, y]) => x <= y)));
      cut.keep.push(lr); addDrops(lr);
      done.push(`ends on the ${last.label} beat ${says(lr)}`);
    }
  }
  return dedupe(cut, done);
}

// No word plays twice: a range that runs into words an earlier range already played is trimmed.
function dedupe(cut, done) {
  const seen = new Set();
  cut.keep = cut.keep.flatMap(([a, b]) => {
    const out = [];
    let s = null;
    for (let i = a; i <= b + 1; i++) {
      if (i <= b && !seen.has(i)) { if (s == null) s = i; } else if (s != null) { out.push([s, i - 1]); s = null; }
    }
    for (let i = a; i <= b; i++) seen.add(i);
    return out;
  });
  return done;
}

// Structure score for one laid-out version (L from edit.mjs layout): which needed beats play and whether it ends in the closing one.
export function shape(L) {
  const f = FORMATS[L.p.format];
  if (!f) return { score: 100, why: 'no format picked for this take - nothing to check', beats: [], format: null, issues: [] };
  const played = L.words.map((w, i) => ({ i, o: L.outAt(w.start + 0.01) })).filter((x) => x.o != null).sort((a, b) => a.o - b.o);
  const beats = beatsKept(L.p.format, L.p.beats, played.map((x) => x.i)), lastW = played.at(-1);
  const need = beats.filter((b) => b.need), missing = need.filter((b) => !b.kept), lb = f.beats.find((b) => b.last), lr = lb && (L.p.beats?.[lb.id] ?? []).at(-1);
  const lastI = lastW?.i, endsIn = !lr || (lastI >= lr[0] && lastI <= lr[1]);
  const score = Math.max(0, Math.round((100 * (need.length - missing.length)) / Math.max(1, need.length) - (endsIn ? 0 : 40)));
  const issues = [
    ...missing.map((b) => ({ rule: 'Missing beat', sev: 'bad', t: null, msg: `${f.name} needs "${b.label}" (${b.what}) - this cut ${b.found ? `plays ${Math.round(b.share * 100)}% of it` : 'never says it'}` })),
    ...(endsIn ? [] : [{ rule: 'Ends before the close', sev: 'bad', t: lastW?.o ?? null, msg: `ends on "${L.words[lastI]?.text}", not inside "${lb.label}" (${lb.what})` }]),
  ];
  const why = `${f.name}: ${need.length - missing.length}/${need.length} needed beats play${missing.length ? ` - missing ${missing.map((b) => b.label).join(', ')}` : ''}${endsIn ? '' : `; ends before ${lb.label} (-40)`}`;
  return { score, why, beats, format: { id: L.p.format, name: f.name, why: L.p.formatWhy ?? '' }, issues };
}
