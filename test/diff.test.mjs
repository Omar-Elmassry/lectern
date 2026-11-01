import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "module";
import { renderMarkdown, settings } from "./helpers.mjs";

const require = createRequire(import.meta.url);
const { diffBlocks, diffWords } = require("../out/test/diff.js");

const types = (ops) => ops.map((o) => o.type).join(" ");

test("identical blocks are all the same", () => {
  assert.equal(types(diffBlocks(["a", "b", "c"], ["a", "b", "c"])), "same same same");
});

test("added and removed blocks keep document order", () => {
  const ops = diffBlocks(["# Title", "one", "three"], ["# Title", "one", "two", "three"]);
  assert.equal(types(ops), "same same added same");
  assert.deepEqual(ops[2], { type: "added", b: 2 });

  assert.equal(types(diffBlocks(["# T", "gone", "stay"], ["# T", "stay"])), "same removed same");
});

test("an edited block of the same kind is one change", () => {
  const ops = diffBlocks(["# Title", "The quick brown fox."], ["# Title", "The quick red fox."]);
  assert.equal(types(ops), "same changed");
  assert.deepEqual(ops[1], { type: "changed", a: 1, b: 1 });
});

test("a block of a different kind is a removal plus an addition", () => {
  assert.equal(types(diffBlocks(["intro", "## Old"], ["intro", "- new item"])), "same removed added");
});

test("a long rewrite is not paired as a change", () => {
  const a = "alpha beta gamma delta epsilon zeta eta theta iota kappa";
  const b = "one two three four five six seven eight nine ten";
  assert.equal(types(diffBlocks([a], [b])), "removed added");
});

test("word diff finds the changed words", () => {
  const a = "The quick brown fox jumps.";
  const b = "The quick red fox jumps high.";
  const d = diffWords(a, b);
  assert.deepEqual(d.removed.map(([s, e]) => a.slice(s, e)), ["brown"]);
  assert.deepEqual(d.added.map(([s, e]) => b.slice(s, e)), ["red", "high"]);
  assert.ok(d.ratio > 0 && d.ratio < 0.5);
});

test("changed words only a space apart are one highlight", () => {
  const a = "Press it again to go back to the source.";
  const b = "Press the same keys again to return to the plain source.";
  const d = diffWords(a, b);
  assert.deepEqual(d.removed.map(([s, e]) => a.slice(s, e)), ["it", "go back"]);
  assert.deepEqual(d.added.map(([s, e]) => b.slice(s, e)), ["the same keys", "return", "plain"]);
});

test("word diff ignores reflowed whitespace", () => {
  const d = diffWords("one two\nthree", "one  two three");
  assert.deepEqual(d.removed, []);
  assert.deepEqual(d.added, []);
  assert.equal(d.ratio, 0);
});

const ORIGINAL = "# Notes\n\nKeep this.\n\nThe quick brown fox.\n\nOld paragraph to drop.\n";
const MODIFIED = "# Notes\n\nKeep this.\n\nThe quick red fox.\n\n- [ ] a new task\n";

test("the modified side marks added and changed blocks", () => {
  const r = renderMarkdown(MODIFIED, settings(), { side: "modified", other: ORIGINAL });
  assert.deepEqual({ ...r.diff, pairs: undefined }, { added: 1, removed: 1, changed: 1, pairs: undefined });
  assert.match(r.html, /<div class="diff diff-changed" data-sync="2" data-diff-id="2">\s*<p>The quick red fox.<\/p>/);
  assert.match(r.html, /<div class="diff diff-added" data-sync="4">\s*<ul>/);
  assert.match(r.html, /<div class="diff-gap diff-gap-removed" data-sync="3" role="note">1 block removed<\/div>/);
  assert.equal(r.diff.pairs[2], "The quick brown fox.");
  // Unchanged blocks only get a zero-height scroll anchor.
  assert.match(r.html, /<div class="diff-anchor" data-sync="1"><\/div>\s*<p>Keep this.<\/p>/);
});

test("the original side marks removed blocks and shares the ids", () => {
  const r = renderMarkdown(ORIGINAL, settings({ readOnly: true }), { side: "original", other: MODIFIED });
  assert.match(r.html, /<div class="diff diff-removed" data-sync="3">\s*<p>Old paragraph to drop.<\/p>/);
  assert.match(r.html, /<div class="diff-gap diff-gap-added" data-sync="4" role="note">1 block added<\/div>/);
  assert.match(r.html, /data-diff-id="2">\s*<p>The quick brown fox.<\/p>/);
});

test("task lines still map to the source in a diff", () => {
  const r = renderMarkdown(MODIFIED, settings(), { side: "modified", other: ORIGINAL });
  assert.deepEqual(r.taskLines, [6]);
  assert.match(r.html, /data-task-line="6"[^>]*aria-label="Toggle task"/);
});

test("read-only renders disable task checkboxes", () => {
  const r = renderMarkdown("- [ ] todo\n", settings({ readOnly: true }));
  assert.match(r.html, /data-task-line="0"[^>]*disabled=""/);
});

test("changed front matter is marked", () => {
  const r = renderMarkdown("---\ntags: [a, b]\n---\nText\n", settings(), {
    side: "modified",
    other: "---\ntags: [a]\n---\nText\n",
  });
  assert.match(r.html, /^<div class="diff diff-changed"><dl/);
  assert.equal(r.diff.changed, 0); // properties aren't a block
});

test("without a diff nothing is marked", () => {
  const r = renderMarkdown(MODIFIED, settings());
  assert.equal(r.diff, undefined);
  assert.doesNotMatch(r.html, /diff-/);
});
