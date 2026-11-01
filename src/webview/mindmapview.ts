import { buildTree, label, layout, type HeadingInfo, type MindNode } from "../markdown/mindmap";

const SVG_NS = "http://www.w3.org/2000/svg";
/** Branch colours: the same hues as the diagrams' categorical colours. */
const HUES = ["#4d78cc", "#57ab5a", "#d0996b", "#b083f0", "#6bcbb8", "#e5534b", "#986ee2"];

const FONT_SIZE = [18, 15, 14];
const FONT_WEIGHT = [700, 600, 400];
const style = (depth: number) => Math.min(depth, 2);

/** The headings of the rendered note, in order. */
export function readHeadings(root: ParentNode): HeadingInfo[] {
  return Array.from(root.querySelectorAll<HTMLElement>("h1,h2,h3,h4,h5,h6")).map((h) => ({
    id: h.id,
    text: (h.textContent ?? "").replace(/\s+/g, " ").trim(),
    level: Number(h.tagName[1]),
  }));
}

export function mindTree(root: ParentNode, title: string): MindNode {
  return buildTree(readHeadings(root), title);
}

let canvas: HTMLCanvasElement | null = null;

/** Draw the mind map as an SVG, with `folded` branches (by node key) collapsed. */
export function drawMindMap(
  tree: MindNode,
  folded: ReadonlySet<string>,
  fontFamily: string
): { svg: SVGSVGElement; w: number; h: number } {
  canvas ??= document.createElement("canvas");
  const ctx = canvas.getContext("2d");
  const font = (depth: number) => `${FONT_WEIGHT[style(depth)]} ${FONT_SIZE[style(depth)]}px ${fontFamily}`;
  const measure = (text: string, depth: number) => {
    if (!ctx) {
      return text.length * FONT_SIZE[style(depth)] * 0.55;
    }
    ctx.font = font(depth);
    return ctx.measureText(text).width;
  };
  const { nodes, links, width, height } = layout(tree, { measure, folded });

  const el = <K extends keyof SVGElementTagNameMap>(tag: K, attrs: Record<string, string | number>) => {
    const e = document.createElementNS(SVG_NS, tag);
    for (const [k, v] of Object.entries(attrs)) {
      e.setAttribute(k, String(v));
    }
    return e;
  };
  const hue = (branch: number) => (branch < 0 ? "var(--rd-accent)" : HUES[branch % HUES.length]);

  const svg = el("svg", { viewBox: `0 0 ${width} ${height}`, width, height, class: "mindmap", role: "tree" });
  svg.setAttribute("aria-label", `Mind map of ${tree.text}`);
  svg.style.fontFamily = fontFamily;

  const linkLayer = el("g", { class: "mm-links" });
  for (const { from, to } of links) {
    const x1 = from.x + from.w;
    const y1 = from.y + from.h / 2;
    const x2 = to.x;
    const y2 = to.y + to.h / 2;
    const mx = (x1 + x2) / 2;
    const path = el("path", { d: `M${x1},${y1} C${mx},${y1} ${mx},${y2} ${x2},${y2}`, class: "mm-link" });
    path.style.setProperty("--mm-c", hue(to.node.branch));
    linkLayer.appendChild(path);
  }
  svg.appendChild(linkLayer);

  for (const n of nodes) {
    const d = n.node.depth;
    const g = el("g", { class: `mm-node mm-d${style(d)}`, tabindex: 0, role: "treeitem" });
    g.style.setProperty("--mm-c", hue(n.node.branch));
    g.dataset.key = n.key;
    g.dataset.target = n.node.id;
    g.setAttribute("aria-level", String(d + 1));
    g.setAttribute("aria-label", n.node.text);
    if (n.parent) {
      g.setAttribute("aria-expanded", String(!n.folded));
    }
    g.appendChild(el("rect", { x: n.x, y: n.y, width: n.w, height: n.h, rx: d === 0 ? 10 : 7 }));
    const text = el("text", {
      x: n.x + n.w / 2,
      y: n.y + n.h / 2,
      "text-anchor": "middle",
      "dominant-baseline": "central",
      "font-size": FONT_SIZE[style(d)],
      "font-weight": FONT_WEIGHT[style(d)],
    });
    text.textContent = label(n.node.text);
    g.appendChild(text);
    if (label(n.node.text) !== n.node.text.trim()) {
      const title = el("title", {});
      title.textContent = n.node.text;
      g.appendChild(title);
    }
    svg.appendChild(g);

    if (n.parent) {
      // Fold button on the right edge, where the branch starts.
      const fold = el("g", { class: `mm-fold${n.folded ? " folded" : ""}` });
      fold.style.setProperty("--mm-c", hue(n.node.branch < 0 ? -1 : n.node.branch));
      fold.dataset.fold = n.key;
      const cx = n.x + n.w;
      const cy = n.y + n.h / 2;
      fold.appendChild(el("circle", { cx, cy, r: n.folded ? 9 : 6 }));
      if (n.folded) {
        const t = el("text", { x: cx, y: cy, "text-anchor": "middle", "dominant-baseline": "central", "font-size": 10 });
        t.textContent = n.hidden > 99 ? "99+" : String(n.hidden);
        fold.appendChild(t);
      }
      const tip = el("title", {});
      tip.textContent = n.folded ? `Show ${n.hidden} hidden headings` : "Fold this branch";
      fold.appendChild(tip);
      svg.appendChild(fold);
    }
  }
  return { svg, w: width, h: height };
}
