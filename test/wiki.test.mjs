import { test } from "node:test";
import assert from "node:assert/strict";
import { render } from "./helpers.mjs";

const s = {
  wiki: { Home: "home.md", "My Note": "notes/My Note.md" },
  embeds: { "shot.png": "img/shot.png", "clip.mp4": "media/clip.mp4", "doc.pdf": "files/doc.pdf" },
};
const r = (md) => render(md, s).html;

test("wiki links resolve, with alias and heading", () => {
  assert.match(r("[[Home]]"), /<a class="md-link" href="home.md">Home<\/a>/);
  assert.match(r("[[Home|start]]"), />start<\/a>/);
  assert.match(r("[[My Note#Part 2]]"), /href="notes\/My%20Note.md#Part 2"/);
});

test("unresolved links render as ghosts", () => {
  assert.match(r("[[Nope]]"), /<span class="wiki-ghost"[^>]*>\[\[Nope\]\]<\/span>/);
});

test("same-document heading links", () => {
  assert.match(r("[[#Getting Started]]"), /href="#getting-started"/);
});

test("wiki syntax inside code is left alone", () => {
  assert.match(r("Use `[[Home]]` syntax"), /<code>\[\[Home\]\]<\/code>/);
  assert.match(r("```\n[[Home]] and ![[shot.png]]\n```"), /\[\[Home\]\] and !\[\[shot.png\]\]/);
});

test("image embeds with size and alt", () => {
  assert.match(r("![[shot.png]]"), /<img src="BASE\/img\/shot.png" alt="shot" loading="lazy">/);
  assert.match(r("![[shot.png|300]]"), /width="300">/);
  assert.match(r("![[shot.png|300x200]]"), /width="300" height="200">/);
  assert.match(r("![[shot.png|A screenshot]]"), /alt="A screenshot"/);
});

test("video and file embeds", () => {
  assert.match(r("![[clip.mp4]]"), /<video src="BASE\/media\/clip.mp4" controls/);
  // Files open through the host, not via the webview resource URL.
  assert.match(r("![[doc.pdf]]"), /<a class="md-link" href="files\/doc.pdf">doc.pdf<\/a>/);
});

test("wiki links work inside callout titles and tables", () => {
  assert.match(r("> [!note] See [[Home]]\n> body"), /callout-heading">See <a class="md-link" href="home.md">/);
  assert.match(r("| a |\n|---|\n| [[Home]] |"), /<td><a class="md-link" href="home.md">Home<\/a><\/td>/);
});
