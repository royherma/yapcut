# The edit recipe

The rules YapCut edits by. The AI reads `effects/catalog.mjs` for when each effect fits; these are the rest.

| Step | Rule | What YapCut does |
| --- | --- | --- |
| 1 Trim | Cut fumbles and silences, quick jumps between thoughts | Drops repeated or flubbed lines (the last try wins), shrinks pauses |
| 2 Text | One consistent style, hook text on screen | Hook title at the top for the first ~3 s, one caption style for the whole video |
| 3 Zooms | Slow zoom over a section, quick snap zoom on one beat, always centered | Slow push-in on chosen lines, snap zoom on punch words |
| 4 Overlays | Pictures and clips that show what is said | Drop files on the timeline in the preview, or let the AI pick an effect |
| 5 Captions | One word or a short phrase at a time, key words stand out | Caption styles in `vendor/caption-lab/styles`, picked per version |
| 6 Sound effects | Last, with a purpose, never louder than the voice | From `sounds/`, mixed well under the voice |

## Moments

| Moment | Rule |
| --- | --- |
| A question line | Show the question on screen, never the answer before it is said |
| A power statement (a number, "10x cheaper", a superlative) | Each part pops on its own spoken word with a sound on that beat |
| Two numbers compared | Reveal each as it is said, never both at once |
| Picking a picture | It shows the thing said (a chart, a demo, the post), never a logo card |
| Cards and captions | A card sits in empty space, never on the caption line or over the face |
| Captions | No full stop, comma or colon at the end of a caption; keep ? and ! |
| Between cuts | No flash of a tiny piece; a cut lands on a real pause |
| Dead air | Nothing new on screen for 2 s or more: cut it or fill it |
| Charts | The whole chart, still, with a circle or arrow on the point |
| End | Finish on an ask: a comment or follow call in the last ~3 s |
