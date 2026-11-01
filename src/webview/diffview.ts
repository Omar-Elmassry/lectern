import { diffWords } from "../markdown/diff";
import { renderMarkdown, type DiffSummary, type ReaderSettings } from "../markdown/render";

/** Sent by the host when this panel is one side of a diff. */
export interface DiffInfo {
  side: "original" | "modified";
  /** The other side's full Markdown. */
  other: string;
  /** Short name of this side, e.g. "Before · Index". */
  label: string;
}

type Post = (msg: unknown) => void;

/** Text inside these is not word-diffed: formulas and diagrams are drawn, not read. */
const NO_WORD_DIFF = ".katex, .mermaid-block, .fm-chip";
/** Above this share of changed text, highlighting words is just noise. */
const MAX_WORD_RATIO = 0.85;

/**
 * Highlight the words that differ inside each changed block: removed words on
 * the original side, added words on the modified side.
 */
export function highlightWords(root: HTMLElement, summary: DiffSummary, info: DiffInfo, settings: ReaderSettings): void {
  const scratch = document.createElement("div");
  root.querySelectorAll<HTMLElement>(".diff-changed[data-diff-id]").forEach((block) => {
    const otherMd = summary.pairs[block.dataset.diffId ?? ""];
    if (otherMd === undefined || block.querySelector(".katex-display, .mermaid-block")) {
      return;
    }
    try {
      scratch.innerHTML = renderMarkdown(otherMd, settings).html;
    } catch {
      return;
    }
    markTaskChanges(block, scratch);
    const mine = textNodes(block);
    const theirs = textNodes(scratch);
    const original = info.side === "original";
    const d = original ? diffWords(mine.text, theirs.text) : diffWords(theirs.text, mine.text);
    if (!d || d.ratio > MAX_WORD_RATIO) {
      return;
    }
    wrapRanges(mine.nodes, original ? d.removed : d.added, original ? "del" : "ins");
  });
}

/** Ring the task boxes that were ticked or unticked, which word marks can't show. */
function markTaskChanges(block: HTMLElement, other: HTMLElement): void {
  const tasks = (el: HTMLElement) =>
    [...el.querySelectorAll<HTMLInputElement>("input.task-cb")].map((cb) => ({
      cb,
      text: (cb.closest("li")?.textContent ?? "").trim(),
    }));
  const mine = tasks(block);
  const theirs = tasks(other);
  // Match tasks by their text, so items added or removed around them don't matter;
  // a task whose text also changed is matched by position when the counts agree.
  const byText = new Map(theirs.map((t) => [t.text, t.cb.checked]));
  mine.forEach(({ cb, text }, i) => {
    const was = byText.has(text) ? byText.get(text) : mine.length === theirs.length ? theirs[i].cb.checked : undefined;
    if (was !== undefined && was !== cb.checked) {
      cb.classList.add("diff-task");
      cb.title = cb.checked ? "Ticked in this version" : "Not ticked in this version";
    }
  });
}

interface TextRun {
  node: Text;
  start: number;
}

function textNodes(el: Element): { text: string; nodes: TextRun[] } {
  const nodes: TextRun[] = [];
  let text = "";
  const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    if (n.parentElement?.closest(NO_WORD_DIFF)) {
      continue;
    }
    nodes.push({ node: n as Text, start: text.length });
    text += n.nodeValue ?? "";
  }
  return { text, nodes };
}

/** Wrap the character ranges (of the concatenated text) in `<ins>` / `<del>`. */
function wrapRanges(nodes: TextRun[], ranges: Array<[number, number]>, tag: "ins" | "del"): void {
  for (const { node, start } of nodes) {
    const value = node.nodeValue ?? "";
    const end = start + value.length;
    const local = ranges
      .filter(([s, e]) => s < end && e > start)
      .map(([s, e]) => [Math.max(s, start) - start, Math.min(e, end) - start] as const);
    if (local.length === 0) {
      continue;
    }
    const frag = document.createDocumentFragment();
    let at = 0;
    for (const [s, e] of local) {
      if (s > at) {
        frag.append(value.slice(at, s));
      }
      const piece = value.slice(s, e);
      if (piece.trim()) {
        const mark = document.createElement(tag);
        mark.className = "diff-word";
        mark.textContent = piece;
        frag.append(mark);
      } else {
        frag.append(piece);
      }
      at = e;
    }
    if (at < value.length) {
      frag.append(value.slice(at));
    }
    node.replaceWith(frag);
  }
}

/* ---------------- diff bar ---------------- */

const ARROW_UP = `<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M4 10l4-4 4 4"/></svg>`;
const ARROW_DOWN = `<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M4 6l4 4 4-4"/></svg>`;

let post: Post = () => {};

/** Show, update or remove the bar at the top of a diff side. */
export function updateDiffBar(info: DiffInfo | undefined, summary: DiffSummary | undefined, send: Post): void {
  post = send;
  document.body.classList.toggle("diff-mode", !!info);
  document.body.dataset.diffSide = info?.side ?? "";
  let bar = document.getElementById("diff-bar");
  if (!info || !summary) {
    bar?.remove();
    return;
  }
  if (!bar) {
    bar = document.createElement("div");
    bar.id = "diff-bar";
    bar.setAttribute("role", "toolbar");
    bar.setAttribute("aria-label", "Changes");
    bar.innerHTML = `
      <span class="db-side"></span>
      <span class="db-counts" aria-live="polite"></span>
      <span class="db-spacer"></span>
      <button type="button" class="db-btn" id="db-prev" title="Previous change (Alt+Up)" aria-label="Previous change">${ARROW_UP}</button>
      <button type="button" class="db-btn" id="db-next" title="Next change (Alt+Down)" aria-label="Next change">${ARROW_DOWN}</button>
      <button type="button" class="db-btn db-text" id="db-text" title="Show the changes as a text diff of the Markdown source">Text diff</button>`;
    document.body.appendChild(bar);
    bar.querySelector("#db-prev")!.addEventListener("click", () => goToChange(-1));
    bar.querySelector("#db-next")!.addEventListener("click", () => goToChange(1));
    bar.querySelector("#db-text")!.addEventListener("click", () => post({ type: "openTextDiff" }));
  }
  (bar.querySelector(".db-side") as HTMLElement).textContent = info.label;
  const parts: string[] = [];
  if (summary.added) {
    parts.push(`<span class="db-add">+${summary.added} added</span>`);
  }
  if (summary.removed) {
    parts.push(`<span class="db-del">−${summary.removed} removed</span>`);
  }
  if (summary.changed) {
    parts.push(`<span class="db-chg">~${summary.changed} changed</span>`);
  }
  (bar.querySelector(".db-counts") as HTMLElement).innerHTML = parts.length
    ? parts.join(" ")
    : `<span class="db-none">No changes to the text</span>`;
}

const BAR_SPACE = 52; // px kept clear under the bar when jumping to a change

function changes(): HTMLElement[] {
  return [...document.querySelectorAll<HTMLElement>("#root .diff, #root .diff-gap")];
}

function pageTop(el: Element): number {
  return el.getBoundingClientRect().top + window.scrollY;
}

/** On opening a diff: if the first change is below the first screen, start there. */
export function revealFirstChange(): void {
  const first = changes()[0];
  if (first && pageTop(first) > window.innerHeight * 0.6) {
    window.scrollTo({ top: pageTop(first) - BAR_SPACE, behavior: "instant" });
  }
}

/** Scroll to the next (dir 1) or previous (dir -1) change. */
export function goToChange(dir: 1 | -1): void {
  const y = window.scrollY + BAR_SPACE;
  const list = changes();
  const target =
    dir > 0 ? list.find((el) => pageTop(el) > y + 2) : [...list].reverse().find((el) => pageTop(el) < y - 2);
  if (target) {
    window.scrollTo({ top: Math.max(0, pageTop(target) - BAR_SPACE), behavior: "smooth" });
    target.classList.remove("diff-flash");
    void target.offsetWidth; // restart the animation
    target.classList.add("diff-flash");
  }
}

/* ---------------- scroll sync ---------------- */

/** Until this time, scroll events come from following the other side. */
let followingUntil = 0;
let syncQueued = false;

/** Both sides mark the same blocks with the same `data-sync` id. */
function syncPoints(): HTMLElement[] {
  return [...document.querySelectorAll<HTMLElement>("#root [data-sync]")];
}

/**
 * Where this side is scrolled to, as a sync id plus how far past it. Measured
 * at the line just under the bar, where the reader is looking, so blocks that
 * are the same on both sides line up exactly there.
 */
function scrollPosition(): { id: string; frac: number } {
  const y = window.scrollY + BAR_SPACE;
  const points = syncPoints();
  let i = -1;
  while (i + 1 < points.length && pageTop(points[i + 1]) <= y) {
    i++;
  }
  const from = i >= 0 ? pageTop(points[i]) : 0;
  const to = i + 1 < points.length ? pageTop(points[i + 1]) : document.documentElement.scrollHeight;
  return { id: i >= 0 ? points[i].dataset.sync ?? "" : "", frac: to > from ? (y - from) / (to - from) : 0 };
}

export function initDiffSync(): void {
  window.addEventListener(
    "scroll",
    () => {
      if (!document.body.classList.contains("diff-mode") || performance.now() < followingUntil || syncQueued) {
        return;
      }
      syncQueued = true;
      requestAnimationFrame(() => {
        syncQueued = false;
        post({ type: "diffScroll", ...scrollPosition() });
      });
    },
    { passive: true }
  );

  window.addEventListener("keydown", (e) => {
    if (!document.body.classList.contains("diff-mode") || !e.altKey) {
      return;
    }
    // VS Code doesn't pass keys from a webview inside a diff editor on to its
    // keybindings, so the diff handles Ctrl+Alt+R (Cmd+Alt+R) itself.
    const mac = /Mac/.test(navigator.platform);
    if ((mac ? e.metaKey : e.ctrlKey) && (e.code === "KeyR" || e.key.toLowerCase() === "r")) {
      e.preventDefault();
      post({ type: "openTextDiff" });
      return;
    }
    if (e.ctrlKey || e.metaKey) {
      return;
    }
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      goToChange(e.key === "ArrowDown" ? 1 : -1);
    }
  });
}

/** Scroll to the position the other side reported. */
export function followScroll(id: string, frac: number): void {
  const points = syncPoints();
  const i = id ? points.findIndex((p) => p.dataset.sync === id) : -1;
  if (id && i < 0) {
    return;
  }
  const from = i >= 0 ? pageTop(points[i]) : 0;
  const to = i + 1 < points.length ? pageTop(points[i + 1]) : document.documentElement.scrollHeight;
  followingUntil = performance.now() + 150;
  // Instant: the page's smooth scrolling would echo scroll events back to the other side.
  const top = from + Math.min(1, Math.max(0, frac)) * (to - from) - BAR_SPACE;
  window.scrollTo({ top: Math.max(0, top), behavior: "instant" });
}
