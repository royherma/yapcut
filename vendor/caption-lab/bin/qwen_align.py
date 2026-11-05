# ~/.cache/qwen-align-venv/bin/python -I bin/qwen_align.py <voice.wav> <parakeet.json> <out.json> [whisper.json]
# Parakeet's words (verbatim + punctuation) timed by Qwen3-ForcedAligner-0.6B. 30 s bench vs MFA: 20 ms median, WhisperX 51 ms.
import difflib
import json
import re
import sys
import unicodedata

import soundfile as sf
import torch
from qwen_asr import Qwen3ForcedAligner

CHUNK_S, PAD_S = 25, 0.3
wav, src, out = sys.argv[1:4]
fixes = []
if len(sys.argv) > 4:
    wx = [w["word"].strip() for s in json.load(open(sys.argv[4]))["segments"] for w in s.get("words", []) if w["word"].strip()]
    DICT = set(open("/usr/share/dict/words").read().lower().split())
    bare = lambda w: re.sub(r"[^a-z']", "", w.lower())
    real = lambda w: not bare(w) or bare(w).replace("'", "") in DICT or "'" in bare(w) or w[:1].isupper() or any(c.isdigit() for c in w)

def spell(text):
    if len(sys.argv) <= 4:
        return text
    words = text.split()
    sm = difflib.SequenceMatcher(a=[bare(w) for w in words], b=[bare(w) for w in wx], autojunk=False)
    for tag, i1, i2, j1, j2 in sm.get_opcodes():
        if tag == "replace" and i2 - i1 == 1 and j2 - j1 == 1 and not real(words[i1]):
            tail = re.search(r"[^\w']*$", words[i1]).group(0)
            fixes.append(f"{words[i1]} -> {wx[j1]}")
            words[i1] = re.sub(r"[^\w']*$", "", wx[j1]) + tail
    return " ".join(words)
alignable = lambda w: any(c == "'" or unicodedata.category(c)[0] in "LN" for c in w)

sents = [s for s in json.load(open(src))["sentences"] if s["text"].strip()]
chunks, cur = [], []
for s in sents:
    if cur and s["end"] - cur[0]["start"] > CHUNK_S:
        chunks.append(cur)
        cur = []
    cur.append(s)
if cur:
    chunks.append(cur)

device = "mps" if torch.backends.mps.is_available() else "cpu"
model = Qwen3ForcedAligner.from_pretrained("Qwen/Qwen3-ForcedAligner-0.6B", dtype=torch.float16 if device == "mps" else torch.float32, device_map=device)
audio, sr = sf.read(wav, dtype="float32")
if audio.ndim > 1:
    audio = audio.mean(axis=1)

words = []
for c in chunks:
    t0 = max(0.0, c[0]["start"] - PAD_S)
    seg = audio[int(t0 * sr):int((c[-1]["end"] + PAD_S) * sr)]
    tokens = spell(" ".join(s["text"].strip() for s in c)).split()
    items = model.align(audio=(seg, sr), text=" ".join(tokens), language="English")[0].items
    timed = iter(items)
    for tok in tokens:
        if alignable(tok):
            it = next(timed)
            words.append({"text": tok, "start": round(it.start_time + t0, 3), "end": round(it.end_time + t0, 3)})
        elif words:
            words[-1]["text"] += " " + tok
for a, b in zip(words, words[1:]):
    if b["start"] < a["start"]:
        b["start"] = a["start"]
    b["end"] = max(b["end"], b["start"] + 0.02)
json.dump({"source": "parakeet-tdt-0.6b-v3 text + Qwen3-ForcedAligner-0.6B", "fixes": fixes, "words": words}, open(out, "w"), indent=1)
print(len(words), "words")
