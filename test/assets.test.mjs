import { test } from "node:test";
import assert from "node:assert/strict";
import { render } from "./helpers.mjs";

const src = (md, s) => [...render(md, s).html.matchAll(/src="([^"]*)"/g)].map((m) => m[1]);

test("relative images are encoded exactly once", () => {
  assert.deepEqual(src("![a](my%20pic.png)"), ["BASE/my%20pic.png"]);
  assert.deepEqual(src("![a](<my pic.png>)"), ["BASE/my%20pic.png"]);
  assert.deepEqual(src("![a](img/caf%C3%A9.png)"), ["BASE/img/caf%C3%A9.png"]);
});

test("query and hash suffixes are preserved", () => {
  assert.deepEqual(src("![a](d.svg#icon)"), ["BASE/d.svg#icon"]);
});

test("external and data urls are untouched", () => {
  assert.deepEqual(src("![a](https://x.y/a%20b.png)"), ["https://x.y/a%20b.png"]);
  assert.deepEqual(src("![a](data:image/png;base64,AAA=)"), ["data:image/png;base64,AAA="]);
});

test("workspace-rooted paths use rootBase when available", () => {
  assert.deepEqual(src("![a](/assets/x.png)", { rootBase: "ROOT" }), ["ROOT/assets/x.png"]);
  assert.deepEqual(src("![a](/assets/x.png)"), ["BASE/assets/x.png"]);
});

test("raw HTML media resolve against the document", () => {
  assert.deepEqual(src('<img src="pic one.png" width="40">'), ["BASE/pic%20one.png"]);
  assert.deepEqual(src('<video poster="p.jpg" src="https://cdn/x.mp4"></video>'), ["https://cdn/x.mp4"]);
  assert.match(render('<video poster="p.jpg"></video>').html, /poster="BASE\/p.jpg"/);
  assert.match(render("text <img src='a.png'> inline").html, /src='BASE\/a.png'/);
});
