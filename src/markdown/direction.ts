/**
 * Text direction of plain text, for languages written in the Arabic script:
 * Arabic, Persian, Urdu, Pashto, Kurdish (Sorani), Sindhi, Punjabi
 * (Shahmukhi), Uyghur and others. Other scripts read left to right.
 * Pure, so the webview and the tests share it.
 */
export type TextDir = "ltr" | "rtl";

/** Letters of the Arabic script, including its extended and presentation forms. */
const RTL_LETTER = /\p{Script=Arabic}/u;
const LETTER = /\p{L}/u;

/**
 * The direction most of the letters in `text` are written in, or null when it
 * has no letters (numbers, symbols, empty). Digits, punctuation and marks
 * don't count. A tie goes to the first letter.
 *
 * This counts letters instead of taking the first one (as `dir="auto"`
 * does), because Arabic technical notes often start a sentence with an
 * English name: "React مكتبة لبناء الواجهات" is an Arabic sentence.
 */
export function textDirection(text: string): TextDir | null {
  let rtl = 0;
  let ltr = 0;
  let first: TextDir | null = null;
  for (const ch of text) {
    if (!LETTER.test(ch)) {
      continue;
    }
    const dir: TextDir = RTL_LETTER.test(ch) ? "rtl" : "ltr";
    first ??= dir;
    if (dir === "rtl") {
      rtl++;
    } else {
      ltr++;
    }
  }
  if (!first) {
    return null;
  }
  return rtl === ltr ? first : rtl > ltr ? "rtl" : "ltr";
}
