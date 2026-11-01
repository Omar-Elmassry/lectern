import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "module";

const require = createRequire(import.meta.url);
const { buildTree, layout, label, MAX_LABEL } = require("../out/test/mindmap.js");

const h = (level, text) => ({ id: text.toLowerCase().replace(/\s+/g, "-"), text, level });
const shape = (n) => (n.children.length ? `${n.text}(${n.children.map(shape).join(",")})` : n.text);

test("a single top heading is the root", () => {
  const tree = buildTree([h(1, "Title"), h(2, "A"), h(3, "A1"), h(2, "B")], "file");
  assert.equal(shape(tree), "Title(A(A1),B)");
  assert.equal(tree.id, "title");
  assert.deepEqual(tree.children.map((c) => c.branch), [0, 1]);
  assert.equal(tree.children[0].children[0].branch, 0); // keeps its branch colour
});

test("several top headings hang off the file title", () => {
  const tree = buildTree([h(2, "A"), h(2, "B"), h(3, "B1")], "notes");
  assert.equal(shape(tree), "notes(A,B(B1))");
  assert.equal(tree.id, "");
});

test("text before the first top heading still gets the title root", () => {
  // The first heading is not the top level, so it can't be the root.
  const tree = buildTree([h(3, "Intro"), h(1, "Title"), h(2, "A")], "doc");
  assert.equal(shape(tree), "doc(Intro,Title(A))");
});

test("skipped levels nest under the nearest higher heading", () => {
  const tree = buildTree([h(1, "T"), h(2, "A"), h(4, "deep"), h(3, "mid"), h(2, "B")], "x");
  assert.equal(shape(tree), "T(A(deep,mid),B)");
});

test("no headings: only the title", () => {
  assert.equal(shape(buildTree([], "empty")), "empty");
});

const measure = (text) => text.length * 8;

test("layout places children right of their parent and centres the parent", () => {
  const tree = buildTree([h(1, "Root"), h(2, "A"), h(2, "B"), h(2, "C")], "x");
  const { nodes, links, width, height } = layout(tree, { measure });
  const [root, a, b, c] = nodes;
  assert.equal(links.length, 3);
  for (const kid of [a, b, c]) {
    assert.ok(kid.x > root.x + root.w, "child to the right");
  }
  assert.ok(a.y < b.y && b.y < c.y, "children top to bottom");
  const mid = (n) => n.y + n.h / 2;
  assert.equal(mid(root), (mid(a) + mid(c)) / 2);
  assert.ok(nodes.every((n) => n.x + n.w <= width && n.y + n.h <= height && n.y >= 0));
});

test("folding a branch hides its children and counts them", () => {
  const tree = buildTree([h(1, "R"), h(2, "A"), h(3, "A1"), h(3, "A2"), h(4, "A2a"), h(2, "B")], "x");
  const open = layout(tree, { measure });
  assert.equal(open.nodes.length, 6);
  const folded = layout(tree, { measure, folded: new Set(["0"]) });
  assert.equal(folded.nodes.length, 3);
  const a = folded.nodes.find((n) => n.key === "0");
  assert.equal(a.folded, true);
  assert.equal(a.hidden, 3);
  assert.ok(folded.height < open.height);
});

test("long headings are shortened", () => {
  const long = "word ".repeat(30);
  assert.equal(label(long).length, MAX_LABEL);
  assert.ok(label(long).endsWith("…"));
  assert.equal(label("  Short  "), "Short");
});
