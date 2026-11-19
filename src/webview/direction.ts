import { textDirection, type TextDir } from "../markdown/direction";

/** Always read left to right, whatever the text around them: code, math and diagrams. */
const ALWAYS_LTR = "pre, code, .code-block, .katex, .katex-display, .mermaid-block";

/** Text that does not decide a block's direction. */
const NOT_PROSE = "pre, code, .katex, .mermaid-block, svg, .copy-btn, .code-lang, .diff-gap";

/**
 * Blocks that take the direction of their own text. List items and table
 * cells are left out on purpose: they follow their list or table, so the
 * bullets and columns of one list or table stay on one side.
 */
const OWN_DIR = "h1, h2, h3, h4, h5, h6, p, ul, ol, blockquote, table, .frontmatter dd";

/**
 * Give the rendered page and each block in it a text direction, so text in
 * Arabic-script languages (Arabic, Persian, Urdu, ...) reads right to left and English text left to right,
 * also when both are in one document. Blocks without letters keep the
 * direction of the page.
 */
export function applyDirection(reading: HTMLElement): void {
  reading.querySelectorAll(ALWAYS_LTR).forEach((el) => el.setAttribute("dir", "ltr"));
  reading.dir = textDirection(proseText(reading)) ?? "ltr";

  reading.querySelectorAll<HTMLElement>(OWN_DIR).forEach((el) => {
    if (el.tagName === "P" && el.parentElement?.closest("li, td, th")) {
      return; // A paragraph in a list item follows the list.
    }
    const dir = blockDirection(el);
    if (dir) {
      el.dir = dir;
    }
  });
}

/** A callout takes the direction of its body: a default title like "Note" is always English. */
function blockDirection(el: HTMLElement): TextDir | null {
  if (el.classList.contains("callout")) {
    return textDirection(proseText(el, ".callout-title")) ?? textDirection(proseText(el));
  }
  return textDirection(proseText(el));
}

/** The text of `el` that people read as prose: no code, formulas or diagrams. */
export function proseText(el: Element, skip?: string): string {
  const selector = skip ? `${NOT_PROSE}, ${skip}` : NOT_PROSE;
  let text = "";
  const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    const hidden = n.parentElement?.closest(selector);
    if (hidden && el.contains(hidden)) {
      continue;
    }
    text += n.nodeValue ?? "";
  }
  return text;
}
