import { test } from "node:test";
import assert from "node:assert/strict";
import { render } from "./helpers.mjs";

const words = (md) => render(md).words;

test("counts prose, not markup", () => {
  assert.equal(words("# Title here\n\n**Bold** and [a link](https://example.com/very/long/url)."), 6);
  assert.equal(words("- [ ] one\n- [x] two\n\n| a | b |\n|---|---|\n| c | d |"), 6);
});

test("code blocks are excluded, inline code counts", () => {
  assert.equal(words("Run `npm test` now\n\n```js\nconst a = 1; const b = 2;\n```"), 4);
});

test("contractions, hyphens, Arabic and CJK", () => {
  assert.equal(words("It's a well-known fact"), 4);
  assert.equal(words("مرحبا بالعالم"), 2);
  assert.equal(words("日本語です"), 5);
});
