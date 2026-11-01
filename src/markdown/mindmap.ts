/**
 * The mind map: a note's headings as a tree that grows to the right from the
 * title. Pure tree building and layout; the webview draws the SVG.
 */

export interface HeadingInfo {
  /** Element id to jump to; "" for a root that is not a heading. */
  id: string;
  text: string;
  level: number;
}

export interface MindNode extends HeadingInfo {
  children: MindNode[];
  /** Index of the branch under the root, for its colour; -1 for the root. */
  branch: number;
  depth: number;
}

/**
 * Build the tree. A single top heading (usually the `# Title`) becomes the
 * root; otherwise `title` does and every top heading is a branch.
 */
export function buildTree(headings: HeadingInfo[], title: string): MindNode {
  const top = Math.min(...headings.map((h) => h.level));
  const tops = headings.filter((h) => h.level === top);
  const singleRoot = tops.length === 1 && headings[0]?.level === top;
  const rootInfo = singleRoot ? headings[0] : { id: "", text: title, level: 0 };
  const root: MindNode = { ...rootInfo, children: [], branch: -1, depth: 0 };

  const stack: MindNode[] = [root];
  for (const h of singleRoot ? headings.slice(1) : headings) {
    while (stack.length > 1 && stack[stack.length - 1].level >= h.level) {
      stack.pop();
    }
    const parent = stack[stack.length - 1];
    const node: MindNode = {
      ...h,
      children: [],
      depth: parent.depth + 1,
      branch: parent === root ? root.children.length : parent.branch,
    };
    parent.children.push(node);
    stack.push(node);
  }
  return root;
}

export interface PlacedNode {
  node: MindNode;
  /** Path of child indexes from the root, e.g. "0.2"; stable across re-layouts. */
  key: string;
  x: number;
  y: number;
  w: number;
  h: number;
  /** Has children, shown or folded. */
  parent: boolean;
  folded: boolean;
  hidden: number;
}

export interface PlacedLink {
  from: PlacedNode;
  to: PlacedNode;
}

export interface MindLayout {
  nodes: PlacedNode[];
  links: PlacedLink[];
  width: number;
  height: number;
}

export interface LayoutOptions {
  /** Width of a node's label in px, by depth (the root uses a bigger font). */
  measure: (text: string, depth: number) => number;
  folded?: ReadonlySet<string>;
}

const PAD_X = 12;
const ROW_GAP = 10;
const COL_GAP = 56;
const MARGIN = 24;
export const MAX_LABEL = 48;

export function nodeHeight(depth: number): number {
  return depth === 0 ? 40 : depth === 1 ? 32 : 28;
}

export function label(text: string): string {
  const t = text.trim();
  return t.length > MAX_LABEL ? `${t.slice(0, MAX_LABEL - 1).trimEnd()}…` : t;
}

/**
 * Lay the tree out left to right: each node's children start a column gap
 * after its right edge, leaves are stacked top to bottom, and a parent sits
 * level with the middle of its children.
 */
export function layout(root: MindNode, opts: LayoutOptions): MindLayout {
  const folded = opts.folded ?? new Set<string>();
  const nodes: PlacedNode[] = [];
  const links: PlacedLink[] = [];
  let cursor = MARGIN;

  const place = (node: MindNode, key: string, x: number): PlacedNode => {
    const w = Math.ceil(opts.measure(label(node.text), node.depth)) + PAD_X * 2;
    const h = nodeHeight(node.depth);
    const isFolded = folded.has(key) && node.children.length > 0;
    const placed: PlacedNode = {
      node,
      key,
      x,
      y: 0,
      w,
      h,
      parent: node.children.length > 0,
      folded: isFolded,
      hidden: isFolded ? count(node) - 1 : 0,
    };
    nodes.push(placed);
    if (node.children.length === 0 || isFolded) {
      placed.y = cursor;
      cursor += h + ROW_GAP;
      return placed;
    }
    const kids = node.children.map((c, i) => place(c, key ? `${key}.${i}` : String(i), x + w + COL_GAP));
    const first = kids[0];
    const last = kids[kids.length - 1];
    placed.y = (first.y + first.h / 2 + last.y + last.h / 2) / 2 - h / 2;
    for (const k of kids) {
      links.push({ from: placed, to: k });
    }
    return placed;
  };

  place(root, "", MARGIN);

  // A tall parent can poke above the first row: shift everything down.
  const minY = Math.min(...nodes.map((n) => n.y));
  if (minY < MARGIN) {
    for (const n of nodes) {
      n.y += MARGIN - minY;
    }
  }
  const width = Math.max(...nodes.map((n) => n.x + n.w)) + MARGIN;
  const height = Math.max(...nodes.map((n) => n.y + n.h)) + MARGIN;
  return { nodes, links, width, height };
}

function count(node: MindNode): number {
  return 1 + node.children.reduce((n, c) => n + count(c), 0);
}
