import { test } from "node:test";
import assert from "node:assert/strict";
import { render } from "./helpers.mjs";

const lines = (md) =>
  [...render(md).html.matchAll(/data-task-line="(-?\d+)"/g)].map((m) => Number(m[1]));

test("simple task list maps to source lines", () => {
  assert.deepEqual(lines("- [ ] a\n- [x] b\n- [ ] c"), [0, 1, 2]);
});

test("task-like lines inside code fences are ignored", () => {
  assert.deepEqual(lines("```\n- [ ] not a task\n```\n\n- [ ] real"), [4]);
});

test("tasks inside blockquotes and callouts are counted", () => {
  assert.deepEqual(lines("> - [ ] quoted\n\n- [ ] second"), [0, 2]);
  assert.deepEqual(lines("> [!todo] List\n> - [ ] one\n> - [x] two"), [1, 2]);
});

test("nested and loose lists", () => {
  const md = "- [ ] parent\n  - [ ] child\n    - [x] grandchild\n\n- [ ] loose\n\n  more text\n- [ ] last";
  assert.deepEqual(lines(md), [0, 1, 2, 4, 7]);
});

test("link reference definitions and paragraphs before tasks", () => {
  const md = "Intro text\n[ref]: https://example.com\n\n- [ ] after def\n\nSome [ref] use\n\n1. [ ] ordered";
  assert.deepEqual(lines(md), [3, 7]);
});

test("CRLF documents keep line numbers", () => {
  assert.deepEqual(lines("# T\r\n\r\n- [ ] a\r\n- [ ] b"), [2, 3]);
});

test("raw HTML checkboxes do not shift task numbering", () => {
  const html = render('<input type="checkbox">\n\n- [ ] real').html;
  assert.deepEqual(lines('<input type="checkbox">\n\n- [ ] real'), [2]);
  assert.match(html, /<input type="checkbox">/);
});
