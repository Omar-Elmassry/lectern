import { test } from "node:test";
import assert from "node:assert/strict";
import { render } from "./helpers.mjs";

test("GitHub alerts keep their kind and their body", () => {
  const { html } = render("> [!WARNING]\n> careful now");
  assert.match(html, /data-callout="warning"/);
  assert.match(html, /<span class="callout-heading">Warning<\/span>/);
  assert.match(html, /<p>careful now<\/p>/);
});

test("custom title with inline formatting", () => {
  const { html } = render("> [!tip] Use **bold** here\n> body");
  assert.match(html, /callout-heading">Use <strong>bold<\/strong> here</);
  assert.match(html, /<p>body<\/p>/);
});

test("unknown kinds are capitalised and default to note icon", () => {
  const { html } = render("> [!Recipe]\n> eggs");
  assert.match(html, /data-callout="recipe"/);
  assert.match(html, /callout-heading">Recipe</);
});

test("foldable callouts render as details", () => {
  const closed = render("> [!faq]- Why?\n> Because").html;
  assert.match(closed, /<details><summary class="callout-title">/);
  assert.match(closed, /<p>Because<\/p>/);
  const open = render("> [!faq]+ Why?\n> Because").html;
  assert.match(open, /<details open>/);
});

test("callout with block content after the title", () => {
  const { html } = render("> [!note]\n>\n> - item\n>\n> ```js\n> x\n> ```");
  assert.match(html, /<li>item<\/li>/);
  assert.match(html, /<code class="language-js">/);
});

test("plain blockquotes are untouched", () => {
  assert.match(render("> just a quote").html, /^<blockquote>\n<p>just a quote<\/p>/);
});
