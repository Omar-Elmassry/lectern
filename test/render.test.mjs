import { test } from "node:test";
import assert from "node:assert/strict";
import { render } from "./helpers.mjs";

test("renders a basic document", () => {
  const { html } = render("# Title\n\nHello **world**");
  assert.match(html, /<h1 id="title">Title<\/h1>/);
  assert.match(html, /<strong>world<\/strong>/);
});
