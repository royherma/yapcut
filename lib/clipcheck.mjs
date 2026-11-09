import { readFileSync } from 'node:fs';

export function voiceDb(wav) {
  const b = readFileSync(wav), d = b.indexOf('data') + 8, sr = b.readUInt32LE(24), hop = sr / 100, n = Math.floor((b.length - d) / 2 / hop);
  const db = Array.from({ length: n }, (_, k) => { let s = 0; for (let j = 0; j < hop; j++) { const v = b.readInt16LE(d + 2 * (k * hop + j)); s += v * v; } return 10 * Math.log10(s / hop / 32768 ** 2 + 1e-12); });
  return { db, voiced: [...db].sort((x, y) => x - y)[Math.floor(n * 0.8)] - 22 };
}

// Kept words whose sound runs on, unbroken, past a cut edge: [{i, word, lostMs, of, at}]. O = the untrimmed transcript words.
export function clippedWords(L, O, { db, voiced }, minMs = 30) {
  const p = L.p, said = (i) => (!p.keep || p.keep.some(([a, z]) => i >= a && i <= z)) && !(p.drop ?? []).some(([a, z]) => i >= a && i <= z);
  const played = (t) => L.pieces.some((pc) => !pc.gap && t >= pc.s && t < pc.e), out = [];
  O.forEach((w, i) => {
    if (!said(i)) return;
    const from = said(i - 1) || !O[i - 1] ? w.start : Math.max(O[i - 1].end, w.start - 0.1), to = said(i + 1) || !O[i + 1] ? w.end : Math.min(O[i + 1].start, w.end + 0.1);
    const fr = []; for (let t = from; t < to; t += 0.01) fr.push({ v: db[Math.round(t * 100)] >= voiced, on: played(t) });
    let lost = 0;
    for (const dir of [1, -1]) for (let k = 0; k < fr.length; k++) {
      const q = fr[dir > 0 ? k : fr.length - 1 - k], back = fr[(dir > 0 ? k : fr.length - 1 - k) - dir];
      if (q?.v && !q.on && !q.clip && back?.v && (back.on || back.clip)) { q.clip = true; lost++; }
    }
    if (lost * 10 >= minMs) out.push({ i, word: w.text, lostMs: lost * 10, of: fr.filter((f) => f.v).length * 10, at: +(L.outAt(w.start + 0.01) ?? L.outAt(w.end - 0.02) ?? -1).toFixed(2) });
  });
  return out.sort((a, z) => z.lostMs - a.lostMs);
}
