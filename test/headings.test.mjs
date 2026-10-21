import { test } from "node:test";
import assert from "node:assert/strict";
import { render, util } from "./helpers.mjs";

const ids = (md) => [...render(md).html.matchAll(/<h\d id="([^"]*)"/g)].map((m) => m[1]);

test("slugs keep non-Latin letters", () => {
  assert.deepEqual(ids("## مقدمة الكتاب\n## Über uns\n## 日本語"), ["مقدمة-الكتاب", "über-uns", "日本語"]);
});

test("duplicate headings get unique ids", () => {
  assert.deepEqual(ids("## Intro\n## Intro\n## Intro"), ["intro", "intro-1", "intro-2"]);
});

test("slug uses visible text, not markdown syntax", () => {
  assert.deepEqual(ids("## See [the docs](https://x.y/z) & **more**"), ["see-the-docs-more"]);
});

test("punctuation-only headings still get an id", () => {
  assert.deepEqual(ids("## ???\n## !!!"), ["section", "section-1"]);
});

test("htmlToText decodes the entities escapeHtml produces", () => {
  assert.equal(util.htmlToText("<b>a &amp; b &lt;c&gt;</b>"), "a & b <c>");
});
