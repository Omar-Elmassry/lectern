import katex from "katex";
import type { MarkedExtension } from "marked";
import { escapeHtml } from "./util";

/**
 * `$inline$`, `$$display$$` and ```` ```math ```` fences, rendered with KaTeX.
 *
 * Dollar rules follow GitHub/pandoc so prices stay prose: the opening `$` must
 * not be followed by whitespace, the closing `$` must not be preceded by
 * whitespace or followed by a digit ("$5 and $10" is text), and `\$` is a
 * literal dollar. Code spans and fences are never touched, since marked does
 * not run inline tokenizers inside them.
 */
export function renderTex(tex: string, display: boolean): string {
  return `${MATH_OPEN}${renderKatex(tex, display)}${MATH_CLOSE}`;
}

/** Comment markers around rendered math, so the word count can skip it. */
export const MATH_OPEN = "<!--math-->";
export const MATH_CLOSE = "<!--/math-->";

function renderKatex(tex: string, display: boolean): string {
  try {
    const html = katex.renderToString(tex, {
      displayMode: display,
      throwOnError: true,
      strict: false,
      trust: false,
      output: "htmlAndMathml",
    });
    return display ? `<div class="math math-display">${html}</div>` : `<span class="math">${html}</span>`;
  } catch (err) {
    const message = err instanceof Error ? err.message.replace(/^KaTeX parse error: /, "") : String(err);
    const tag = display ? "div" : "span";
    return (
      `<${tag} class="math math-error${display ? " math-display" : ""}" title="${escapeHtml(message)}">` +
      `${escapeHtml(display ? `$$${tex}$$` : `$${tex}$`)}</${tag}>`
    );
  }
}

interface MathToken {
  type: "mathInline" | "mathBlock";
  raw: string;
  tex: string;
}

const BLOCK_RE = /^ {0,3}\$\$([\s\S]+?)\$\$[ \t]*(?:\n+|$)/;
const INLINE_RE = /^\$(?!\s)((?:\\.|[^\\$\n])+?)(?<!\s)\$(?!\d)/;

/** First `$` not escaped by a backslash. */
function firstDollar(src: string): number | undefined {
  for (let i = src.indexOf("$"); i >= 0; i = src.indexOf("$", i + 1)) {
    let slashes = 0;
    for (let j = i - 1; j >= 0 && src[j] === "\\"; j--) {
      slashes++;
    }
    if (slashes % 2 === 0) {
      return i;
    }
  }
  return undefined;
}

export const mathExtension: MarkedExtension = {
  extensions: [
    {
      name: "mathBlock",
      level: "block",
      start: (src: string) => {
        const m = /^ {0,3}\$\$/m.exec(src);
        return m ? m.index : undefined;
      },
      tokenizer(src: string) {
        const m = BLOCK_RE.exec(src);
        if (!m || !m[1].trim()) {
          return undefined;
        }
        const token: MathToken = { type: "mathBlock", raw: m[0], tex: m[1].trim() };
        return token;
      },
      renderer: (token) => renderTex((token as unknown as MathToken).tex, true) + "\n",
    },
    {
      name: "mathInline",
      level: "inline",
      start: firstDollar,
      tokenizer(src: string) {
        // `$$x$$` written inline is display math in a paragraph.
        const display = /^\$\$(?!\s)([^$\n]+?)(?<!\s)\$\$/.exec(src);
        if (display) {
          const token: MathToken = { type: "mathInline", raw: display[0], tex: `\\displaystyle ${display[1]}` };
          return token;
        }
        const m = INLINE_RE.exec(src);
        if (!m) {
          return undefined;
        }
        const token: MathToken = { type: "mathInline", raw: m[0], tex: m[1] };
        return token;
      },
      renderer: (token) => renderTex((token as unknown as MathToken).tex, false),
    },
  ],
};
