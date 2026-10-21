import { test } from "node:test";
import assert from "node:assert/strict";
import { render } from "./helpers.mjs";

const md = `---
title: "My note"
tags: [reading, vscode]
aliases:
  - first
  - second
description: a long
  folded line
---

# Body

- [ ] task`;

test("front matter renders as a properties list, not a heading", () => {
  const { html } = render(md);
  assert.doesNotMatch(html, /<hr>/);
  assert.match(html, /^<dl class="frontmatter"/);
  assert.match(html, /<dt>title<\/dt><dd>My note<\/dd>/);
  assert.match(html, /<dt>tags<\/dt><dd><span class="fm-chip">reading<\/span> <span class="fm-chip">vscode<\/span><\/dd>/);
  assert.match(html, /<dt>aliases<\/dt><dd><span class="fm-chip">first<\/span> <span class="fm-chip">second<\/span>/);
  assert.match(html, /<dt>description<\/dt><dd>a long folded line<\/dd>/);
  assert.match(html, /<h1 id="body">Body<\/h1>/);
});

test("task lines below front matter keep their source line numbers", () => {
  assert.match(render(md).html, /data-task-line="12"/);
});

test("front matter does not count as words", () => {
  assert.equal(render(md).words, 2);
});

test("values are escaped and a lone --- rule is untouched", () => {
  assert.match(render("---\nx: <b>\n---\n").html, /<dd>&lt;b&gt;<\/dd>/);
  assert.match(render("text\n\n---\n\nmore").html, /<hr>/);
});
