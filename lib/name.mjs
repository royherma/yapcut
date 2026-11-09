// A short readable name for a take, from what is said in it: the fast model of whichever AI CLI is installed (lib/llm.mjs).
import { askText, firstJSON } from './llm.mjs';

export const namePrompt = (words, script = '') => `Name this talking-head video so the creator can tell it apart from their other takes in a list.
${script ? `Their script:\n${script.slice(0, 3000)}\n\n` : ''}What they say:
${words.map((w) => w.text).join(' ').slice(0, 4000)}

The name is its topic in 2-5 words, Title Case, no quotes, no emoji, no "Video"/"Take"/"Reel". Example: "Why Create If AI Can".
Return ONLY JSON: {"name":"..."}`;

export function nameTake(words, script = '') {
  if (!words.length) return Promise.resolve(null);
  return askText(namePrompt(words, script), { fast: true, timeout: 90000 }).then((out) => {
    const name = String(firstJSON(out).name ?? '').replace(/["“”]/g, '').trim().slice(0, 60);
    if (!name) throw new Error('AI returned an empty name');
    return name;
  });
}
