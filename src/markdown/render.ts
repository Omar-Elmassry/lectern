import { Marked, type Token, type Tokens } from "marked";
import { markedHighlight } from "marked-highlight";
import hljs from "highlight.js/lib/common";
import type { ReaderPrefs } from "../settings";
import { renderFrontMatter, splitFrontMatter } from "./frontmatter";
import { emojiExtension } from "./emoji";
import { MATH_CLOSE, MATH_OPEN, mathExtension, renderTex } from "./math";
import { slugify, escapeHtml, htmlToText } from "./util";

/** Everything the webview needs for one render: user prefs plus context. */
export interface ReaderSettings extends ReaderPrefs {
  themeKind: number; // vscode.ColorThemeKind: 1 light, 2 dark, 3 high contrast, 4 high contrast light
  docBase: string; // webview base uri for document-relative resources
  rootBase?: string; // webview base uri of the workspace folder, for `/path` resources
  wiki: Record<string, string | null>; // resolved [[links]]
  embeds: Record<string, string | null>; // resolved ![[embeds]]
}

export interface RenderResult {
  html: string;
  taskLines: number[];
  words: number;
}

export interface WikiMaps {
  /** key: link target (without alias/heading), value: relative href or null */
  links: Record<string, string | null>;
  /** key: embed target, value: relative href or null */
  embeds: Record<string, string | null>;
}

const CALLOUT_TITLES: Record<string, string> = {
  note: "Note",
  abstract: "Abstract",
  summary: "Summary",
  tldr: "TL;DR",
  info: "Info",
  todo: "Todo",
  tip: "Tip",
  hint: "Hint",
  important: "Important",
  success: "Success",
  check: "Check",
  done: "Done",
  question: "Question",
  help: "Help",
  faq: "FAQ",
  warning: "Warning",
  attention: "Attention",
  caution: "Caution",
  failure: "Failure",
  fail: "Fail",
  missing: "Missing",
  danger: "Danger",
  error: "Error",
  bug: "Bug",
  example: "Example",
  quote: "Quote",
  cite: "Citation",
};

const CALLOUT_EMOJI: Record<string, string> = {
  note: "\u{1F4DD}",
  abstract: "\u{1F4CB}",
  summary: "\u{1F4CB}",
  tldr: "\u{1F4CB}",
  info: "\u2139\uFE0F",
  todo: "\u2611\uFE0F",
  tip: "\u{1F525}",
  hint: "\u{1F525}",
  important: "\u{1F525}",
  success: "\u2705",
  check: "\u2705",
  done: "\u2705",
  question: "\u2753",
  help: "\u2753",
  faq: "\u2753",
  warning: "\u26A0\uFE0F",
  attention: "\u26A0\uFE0F",
  caution: "\u26A0\uFE0F",
  failure: "\u274C",
  fail: "\u274C",
  missing: "\u274C",
  danger: "\u26A1",
  error: "\u26A1",
  bug: "\u{1F41B}",
  example: "\u{1F4C4}",
  quote: "\u{1F4AC}",
  cite: "\u{1F4AC}",
};

interface AnyToken {
  [key: string]: unknown;
}

const marked = new Marked(
  markedHighlight({
    emptyLangClass: "hljs",
    langPrefix: "language-",
    highlight(code, lang) {
      // Rendered by the `code` renderer below; keep the source untouched.
      if (lang === "math" || lang === "mermaid") {
        return code;
      }
      try {
        const language = hljs.getLanguage(lang as string) ? (lang as string) : "plaintext";
        return hljs.highlight(code, { language }).value;
      } catch {
        return code;
      }
    },
  }),
  { gfm: true, breaks: false }
);

marked.use(mathExtension);
marked.use(emojiExtension);

marked.use({
  useNewRenderer: true,
  renderer: {
    code(token: Tokens.Code) {
      const lang = (token.lang ?? "").trim().split(/\s+/)[0];
      if (lang === "math") {
        return renderTex(token.text, true) + "\n";
      }
      if (lang === "mermaid") {
        // Drawn by the webview, which loads Mermaid only when a diagram exists.
        return `<div class="mermaid-block"><pre class="mermaid-src">${escapeHtml(token.text)}</pre></div>\n`;
      }
      return false;
    },

    blockquote(this: { parser: { parse(t: Token[]): string } }, token: Tokens.Blockquote) {
      const tokens = token.tokens;
      const p0 = tokens[0];
      if (p0 && p0.type === "paragraph") {
        // The callout marker owns the first line only: `> [!type]+/- Title`.
        const text = (p0 as Tokens.Paragraph).text;
        const nl = text.indexOf("\n");
        const firstLine = nl >= 0 ? text.slice(0, nl) : text;
        const m = /^\s*\[!([^\]\s]+)\]([+-]?)[ \t]*(.*)$/.exec(firstLine);
        if (m) {
          const rest = nl >= 0 ? text.slice(nl + 1) : "";
          let body = rest.trim() ? `<p>${marked.parseInline(rest) as string}</p>\n` : "";
          body += this.parser.parse(tokens.slice(1));
          return renderCallout(m[1], m[2], m[3].trim(), body);
        }
      }
      const inner = this.parser.parse(tokens);
      return `<blockquote>\n${inner}</blockquote>\n`;
    },

    heading(this: { parser: { parseInline(t: Tokens.Generic[]): string } }, token: Tokens.Heading) {
      const depth = token.depth;
      const inner = this.parser.parseInline(token.tokens);
      const id = uniqueSlug(slugify(htmlToText(inner)) || "section");
      return `<h${depth} id="${escapeHtml(id)}">${inner}</h${depth}>\n`;
    },

    link(this: { parser: { parseInline(t: Tokens.Generic[]): string } }, token: Tokens.Link) {
      const parser = this.parser;
      const href = (token.href ?? "") as string;
      const title = token.title ? ` title="${escapeHtml(token.title as string)}"` : "";
      const inner = parser.parseInline(token.tokens as never[]);
      return `<a class="md-link" href="${escapeHtml(href)}"${title}>${inner}</a>`;
    },

    checkbox({ checked }: Tokens.Checkbox) {
      const line = ctx ? ctx.taskLines[ctx.taskIndex++] ?? -1 : -1;
      // Interactive unless we could not map it to a source line. (Chromium
      // never dispatches clicks to disabled inputs.)
      const state = line >= 0 ? ' aria-label="Toggle task"' : ' disabled=""';
      return `<input class="task-cb" data-task-line="${line}" type="checkbox"${checked ? ' checked=""' : ""}${state}>`;
    },

    image(token: Tokens.Image) {
      const href = resolveAsset(token.href ?? "");
      const title = token.title ? ` title="${escapeHtml(token.title)}"` : "";
      const alt = escapeHtml(token.text ?? "");
      return `<img src="${escapeHtml(href)}" alt="${alt}" loading="lazy"${title}>`;
    },

    // Raw HTML media (`<img src="pic.png">`) resolves like markdown images.
    html(token: Tokens.HTML | Tokens.Tag) {
      return token.text.replace(
        /(<(?:img|video|audio|source)\b[^>]*?\s(?:src|poster)\s*=\s*)(["'])([^"']*)\2/gi,
        (_m, head: string, q: string, src: string) =>
          `${head}${q}${escapeHtml(resolveAsset(htmlToText(src)))}${q}`
      );
    },
  },
});

interface WikiToken {
  type: "wikilink";
  raw: string;
  embed: boolean;
  target: string;
  alias?: string;
}

const WIKI_RE = /^(!?)\[\[([^[\]|\n]+)(?:\|([^[\]\n]+))?\]\]/;
const IMAGE_EXT = /\.(png|jpe?g|gif|webp|svg|bmp|ico|avif)$/i;
const VIDEO_EXT = /\.(mp4|webm|mov|ogv)$/i;

// [[links]] and ![[embeds]] as an inline extension, so code spans and fences
// are left alone (marked never runs inline tokenizers inside them).
marked.use({
  extensions: [
    {
      name: "wikilink",
      level: "inline",
      start(src: string) {
        const i = src.indexOf("[[");
        if (i < 0) {
          return undefined;
        }
        return i > 0 && src[i - 1] === "!" ? i - 1 : i;
      },
      tokenizer(src: string) {
        const m = WIKI_RE.exec(src);
        if (!m) {
          return undefined;
        }
        const token: WikiToken = {
          type: "wikilink",
          raw: m[0],
          embed: m[1] === "!",
          target: m[2].trim(),
          alias: m[3]?.trim(),
        };
        return token;
      },
      renderer(token) {
        return renderWiki(token as unknown as WikiToken);
      },
    },
  ],
});

function renderWiki({ embed, target, alias }: WikiToken): string {
  const s = ctx?.settings;
  const hashAt = target.indexOf("#");
  const name = (hashAt >= 0 ? target.slice(0, hashAt) : target).trim();
  const heading = hashAt >= 0 ? target.slice(hashAt + 1).trim() : "";
  const ghost = (text: string) =>
    `<span class="wiki-ghost" title="Not found in workspace">${escapeHtml(text)}</span>`;

  if (!name) {
    // [[#Heading]] points into the current document.
    return heading
      ? `<a class="md-link" href="#${escapeHtml(slugify(heading))}">${escapeHtml(alias ?? heading)}</a>`
      : ghost(`[[${target}]]`);
  }

  if (embed) {
    const resolved = s ? s.embeds[name] ?? s.wiki[name] ?? null : null;
    if (!s || !resolved) {
      return ghost(`![[${target}]]`);
    }
    const url = escapeHtml(`${s.docBase}/${encodeRel(resolved)}`);
    if (IMAGE_EXT.test(resolved)) {
      // Obsidian uses `|300` or `|300x200` for size, anything else is alt text.
      const size = alias ? /^(\d+)(?:x(\d+))?$/.exec(alias) : null;
      const dims = size ? ` width="${size[1]}"${size[2] ? ` height="${size[2]}"` : ""}` : "";
      const alt = escapeHtml(size || !alias ? name.replace(/\.[^.]+$/, "") : alias);
      return `<img src="${url}" alt="${alt}" loading="lazy"${dims}>`;
    }
    if (VIDEO_EXT.test(resolved)) {
      return `<video src="${url}" controls preload="metadata"></video>`;
    }
    // Embedded notes / other files fall back to a link that opens them.
    const href = escapeHtml(encodeRel(resolved) + (heading ? `#${heading}` : ""));
    return `<a class="md-link" href="${href}">${escapeHtml(alias ?? target)}</a>`;
  }

  const resolved = s?.wiki[name] ?? null;
  if (!resolved) {
    return ghost(`[[${alias ?? target}]]`);
  }
  const href = escapeHtml(encodeRel(resolved) + (heading ? `#${heading}` : ""));
  return `<a class="md-link" href="${href}">${escapeHtml(alias ?? target)}</a>`;
}

marked.use({
  hooks: {
    processAllTokens(tokens: Token[]): Token[] {
      // Only the top-level parse; callouts call parseInline mid-render.
      if (ctx && !ctx.annotated) {
        ctx.annotated = true;
        annotateTaskLines(tokens, ctx.text, 0, ctx.taskLines);
      }
      return tokens;
    },
  },
});

/**
 * Record the source line of every GFM task item, in the same pre-order the
 * renderer emits checkboxes. Tokens carry no positions, so each token's raw
 * text is located inside its parent's text. Nesting (list indentation, `>`
 * markers) shifts columns but never line counts, so a line offset within the
 * parent text maps directly onto the source.
 */
function annotateTaskLines(tokens: Token[], src: string, baseLine: number, out: number[]): void {
  let cursor = 0;
  let line = baseLine;
  for (const tok of tokens) {
    const raw = tok.raw ?? "";
    const at = raw ? src.indexOf(raw, cursor) : -1;
    if (at >= 0) {
      line += countNewlines(src, cursor, at);
      cursor = at;
    }

    if (tok.type === "list") {
      annotateTaskLines((tok as Tokens.List).items, raw, line, out);
    } else if (tok.type === "list_item") {
      const item = tok as Tokens.ListItem;
      if (item.task) {
        out.push(line);
      }
      annotateTaskLines(item.tokens, item.text, line, out);
    } else if (tok.type === "blockquote") {
      const bq = tok as Tokens.Blockquote;
      annotateTaskLines(bq.tokens, bq.text, line, out);
    }

    if (at >= 0) {
      line += countNewlines(src, at, at + raw.length);
      cursor = at + raw.length;
    }
  }
}

function countNewlines(text: string, from: number, to: number): number {
  let n = 0;
  for (let i = from; i < to; i++) {
    if (text.charCodeAt(i) === 10) {
      n++;
    }
  }
  return n;
}

function isExternalHref(href: string): boolean {
  return (
    /^[a-zA-Z][a-zA-Z\d+\-.]*:/.test(href) || href.startsWith("//") || href.startsWith("data:")
  );
}

/**
 * Obsidian callouts / GitHub alerts. `fold` is "" (static), "+" (foldable,
 * open) or "-" (foldable, collapsed); foldable ones use <details>.
 */
function renderCallout(kindRaw: string, fold: string, titleMd: string, body: string): string {
  const kind = sanitizeKind(kindRaw);
  const title = titleMd
    ? (marked.parseInline(titleMd) as string)
    : escapeHtml(CALLOUT_TITLES[kind] ?? capitalize(kindRaw.toLowerCase()));
  const icon = CALLOUT_EMOJI[kind] ?? CALLOUT_EMOJI.note;
  const head =
    `<span class="callout-icon" aria-hidden="true">${icon}</span>` +
    `<span class="callout-heading">${title}</span>`;
  const open = `<blockquote class="callout" data-callout="${escapeHtml(kind)}">\n`;
  if (fold) {
    return (
      open +
      `<details${fold === "+" ? " open" : ""}><summary class="callout-title">${head}</summary>\n` +
      `<div class="callout-body">\n${body}</div></details>\n</blockquote>\n`
    );
  }
  return open + `<div class="callout-title">${head}</div>\n${body}</blockquote>\n`;
}

/** De-duplicate heading ids within one render: intro, intro-1, intro-2. */
function uniqueSlug(base: string): string {
  if (!ctx) {
    return base;
  }
  let id = base;
  for (let n = 1; ctx.usedIds.has(id); n++) {
    id = `${base}-${n}`;
  }
  ctx.usedIds.add(id);
  return id;
}

/**
 * Words a reader actually reads: rendered text without code blocks or
 * markup. CJK has no spaces, so each ideograph / kana counts as a word.
 */
function countWords(html: string): number {
  const text = htmlToText(
    html
      .replace(/<pre[\s\S]*?<\/pre>/g, " ")
      .split(MATH_OPEN)
      .map((part, i) => (i === 0 ? part : part.slice(part.indexOf(MATH_CLOSE) + MATH_CLOSE.length)))
      .join(" ")
  );
  const cjk = text.match(/[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]/gu)?.length ?? 0;
  const rest = text.replace(/[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]/gu, " ");
  const words = rest.match(/[\p{L}\p{M}\p{N}]+(?:['’-][\p{L}\p{M}\p{N}]+)*/gu)?.length ?? 0;
  return words + cjk;
}

function sanitizeKind(kind: string): string {
  const clean = kind.toLowerCase().replace(/[^a-z0-9_-]/g, "");
  return clean.length > 0 ? clean : "note";
}

function capitalize(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

/**
 * Map a document-relative (or `/workspace-rooted`) resource path to a webview
 * URL. Paths may arrive percent-encoded (marked encodes hrefs, authors write
 * `%20`), so each segment is decoded before being encoded exactly once.
 */
function resolveAsset(href: string): string {
  const s = ctx?.settings;
  if (!s || !href || href.startsWith("#") || isExternalHref(href)) {
    return href;
  }
  const split = /^([^?#]*)(.*)$/.exec(href);
  const path = split ? split[1] : href;
  const suffix = split ? split[2] : "";
  const rooted = path.startsWith("/") && s.rootBase;
  const base = rooted ? s.rootBase : s.docBase;
  const rel = path.replace(/^\/+/, "").split("/").map(safeDecode).join("/");
  return `${base}/${encodeRel(rel)}${suffix}`;
}

function safeDecode(seg: string): string {
  try {
    return decodeURIComponent(seg);
  } catch {
    return seg;
  }
}

function encodeRel(rel: string): string {
  return rel
    .replace(/\\/g, "/")
    .split("/")
    .map((seg) => encodeURIComponent(seg))
    .join("/");
}

interface RenderContext {
  settings: ReaderSettings;
  /** Normalised markdown, i.e. exactly what the lexer sees. */
  text: string;
  taskLines: number[];
  taskIndex: number;
  annotated: boolean;
  usedIds: Set<string>;
}

/** State for the render in progress; marked's renderers are synchronous. */
let ctx: RenderContext | null = null;

export function renderMarkdown(source: string, settings: ReaderSettings): RenderResult {
  // TextDocument line numbers count CRLF as a single break.
  const { body: text, frontMatter } = splitFrontMatter(source.replace(/\r\n?/g, "\n"));
  ctx = { settings, text, taskLines: [], taskIndex: 0, annotated: false, usedIds: new Set() };
  const taskLines = ctx.taskLines;
  let html: string;
  try {
    html = marked.parse(text) as string;
  } catch {
    html = `<pre>${escapeHtml(source)}</pre>`;
  } finally {
    ctx = null;
  }

  const words = countWords(html);
  if (frontMatter) {
    html = renderFrontMatter(frontMatter) + html;
  }
  return { html, taskLines, words };
}
