/**
 * Diffs for the reading-view diff: which top-level Markdown blocks were added,
 * removed or changed, and which words changed inside a changed block.
 * Pure functions, shared by the renderer (blocks) and the webview (words).
 */

export type BlockOp =
  | { type: "same"; a: number; b: number }
  | { type: "changed"; a: number; b: number }
  | { type: "removed"; a: number }
  | { type: "added"; b: number };

/** Above this many cells the LCS table is skipped and the middle is one hunk. */
const MAX_CELLS = 4_000_000;

/**
 * Edit script from blocks `a` (original) to blocks `b` (modified), in document
 * order. Blocks compare by text; a removed and an added block of the same kind
 * that still share most of their words become one "changed" op.
 */
export function diffBlocks(a: string[], b: string[]): BlockOp[] {
  const ids = new Map<string, number>();
  const id = (s: string) => {
    let v = ids.get(s);
    if (v === undefined) {
      v = ids.size;
      ids.set(s, v);
    }
    return v;
  };
  const A = a.map(id);
  const B = b.map(id);

  let start = 0;
  while (start < A.length && start < B.length && A[start] === B[start]) {
    start++;
  }
  let endA = A.length;
  let endB = B.length;
  while (endA > start && endB > start && A[endA - 1] === B[endB - 1]) {
    endA--;
    endB--;
  }

  const ops: BlockOp[] = [];
  for (let i = 0; i < start; i++) {
    ops.push({ type: "same", a: i, b: i });
  }

  // Matching pairs in the middle, from an LCS table.
  const pairs: Array<[number, number]> = [];
  const n = endA - start;
  const m = endB - start;
  if (n > 0 && m > 0 && n * m <= MAX_CELLS) {
    const w = m + 1;
    const table = new Uint32Array((n + 1) * w);
    for (let i = n - 1; i >= 0; i--) {
      for (let j = m - 1; j >= 0; j--) {
        table[i * w + j] =
          A[start + i] === B[start + j]
            ? table[(i + 1) * w + j + 1] + 1
            : Math.max(table[(i + 1) * w + j], table[i * w + j + 1]);
      }
    }
    let i = 0;
    let j = 0;
    while (i < n && j < m) {
      if (A[start + i] === B[start + j]) {
        pairs.push([start + i, start + j]);
        i++;
        j++;
      } else if (table[(i + 1) * w + j] >= table[i * w + j + 1]) {
        i++;
      } else {
        j++;
      }
    }
  }
  pairs.push([endA, endB]);

  let i = start;
  let j = start;
  for (const [pa, pb] of pairs) {
    pushHunk(ops, a, b, i, pa, j, pb);
    if (pa < endA) {
      ops.push({ type: "same", a: pa, b: pb });
    }
    i = pa + 1;
    j = pb + 1;
  }

  for (let k = 0; k < A.length - endA; k++) {
    ops.push({ type: "same", a: endA + k, b: endB + k });
  }
  return ops;
}

/** Blocks a[i0..i1) were replaced by b[j0..j1): pair similar ones as changes. */
function pushHunk(ops: BlockOp[], a: string[], b: string[], i0: number, i1: number, j0: number, j1: number): void {
  let i = i0;
  let j = j0;
  while (i < i1 || j < j1) {
    if (i < i1 && j < j1 && similar(a[i], b[j])) {
      ops.push({ type: "changed", a: i++, b: j++ });
    } else if (i < i1 && (j >= j1 || i1 - i >= j1 - j)) {
      ops.push({ type: "removed", a: i++ });
    } else {
      ops.push({ type: "added", b: j++ });
    }
  }
}

/** Rough block kind, from how its Markdown starts. */
export function blockKind(raw: string): string {
  const s = raw.trimStart();
  const heading = /^(#{1,6})\s/.exec(s);
  if (heading) {
    return `h${heading[1].length}`;
  }
  if (/^(```|~~~)/.test(s)) {
    return "code";
  }
  if (/^\$\$/.test(s)) {
    return "math";
  }
  if (/^>/.test(s)) {
    return "quote";
  }
  if (/^([-*+]|\d+[.)])\s/.test(s)) {
    return "list";
  }
  if (/^\|/.test(s)) {
    return "table";
  }
  if (/^</.test(s)) {
    return "html";
  }
  return "p";
}

function similar(x: string, y: string): boolean {
  if (blockKind(x) !== blockKind(y)) {
    return false;
  }
  const wx = words(x);
  const wy = words(y);
  if (wx.length < 8 || wy.length < 8) {
    return true; // short blocks of the same kind: an edit, not a rewrite
  }
  const bag = new Map<string, number>();
  for (const w of wx) {
    bag.set(w, (bag.get(w) ?? 0) + 1);
  }
  let shared = 0;
  for (const w of wy) {
    const c = bag.get(w) ?? 0;
    if (c > 0) {
      shared++;
      bag.set(w, c - 1);
    }
  }
  return (2 * shared) / (wx.length + wy.length) >= 0.4;
}

function words(s: string): string[] {
  return s.toLowerCase().match(/[\p{L}\p{N}_]+/gu) ?? [];
}

/* ---------------- words ---------------- */

export interface WordDiff {
  /** Character ranges [start, end) of `a` that are not in `b`. */
  removed: Array<[number, number]>;
  /** Character ranges [start, end) of `b` that are not in `a`. */
  added: Array<[number, number]>;
  /** Share of the non-space text that changed, 0..1. */
  ratio: number;
}

const WORD_RE = /\s+|[\p{L}\p{N}_]+|[^\s\p{L}\p{N}_]/gu;
const MAX_WORD_CELLS = 1_000_000;

/** Word-level diff of two plain texts, or null when they are too long. */
export function diffWords(a: string, b: string): WordDiff | null {
  const ta = tokenize(a);
  const tb = tokenize(b);
  const n = ta.length;
  const m = tb.length;
  if (n * m > MAX_WORD_CELLS) {
    return null;
  }
  const w = m + 1;
  const table = new Uint32Array((n + 1) * w);
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      table[i * w + j] =
        ta[i].text === tb[j].text
          ? table[(i + 1) * w + j + 1] + 1
          : Math.max(table[(i + 1) * w + j], table[i * w + j + 1]);
    }
  }

  const removed: Array<[number, number]> = [];
  const added: Array<[number, number]> = [];
  let changed = 0;
  let i = 0;
  let j = 0;
  while (i < n || j < m) {
    if (i < n && j < m && ta[i].text === tb[j].text) {
      i++;
      j++;
    } else if (j >= m || (i < n && table[(i + 1) * w + j] >= table[i * w + j + 1])) {
      changed += addRange(removed, ta[i]);
      i++;
    } else {
      changed += addRange(added, tb[j]);
      j++;
    }
  }

  const total = solid(a) + solid(b);
  return {
    removed: trimRanges(removed, a),
    added: trimRanges(added, b),
    ratio: total ? changed / total : 0,
  };
}

interface WordToken {
  text: string;
  start: number;
  end: number;
}

function tokenize(s: string): WordToken[] {
  const out: WordToken[] = [];
  for (const m of s.matchAll(WORD_RE)) {
    const start = m.index ?? 0;
    // Any run of whitespace matches any other: reflowed text is not a change.
    out.push({ text: /^\s/.test(m[0]) ? " " : m[0], start, end: start + m[0].length });
  }
  return out;
}

/** Append a token's range, merging with the previous one when they touch. */
function addRange(ranges: Array<[number, number]>, tok: WordToken): number {
  const last = ranges[ranges.length - 1];
  if (last && last[1] === tok.start) {
    last[1] = tok.end;
  } else {
    ranges.push([tok.start, tok.end]);
  }
  return tok.text === " " ? 0 : tok.end - tok.start;
}

/**
 * Drop whitespace at the edges of each range and ranges that are only
 * whitespace, then join ranges only a space apart: "go back" reads as one change.
 */
function trimRanges(ranges: Array<[number, number]>, s: string): Array<[number, number]> {
  const out: Array<[number, number]> = [];
  for (let [start, end] of ranges) {
    while (start < end && /\s/.test(s[start])) {
      start++;
    }
    while (end > start && /\s/.test(s[end - 1])) {
      end--;
    }
    if (end <= start) {
      continue;
    }
    const last = out[out.length - 1];
    if (last && /^\s*$/.test(s.slice(last[1], start))) {
      last[1] = end;
    } else {
      out.push([start, end]);
    }
  }
  return out;
}

function solid(s: string): number {
  return s.replace(/\s+/g, "").length;
}
