import { test } from "node:test";
import assert from "node:assert/strict";
import { render } from "./helpers.mjs";

const html = (md) => render(md).html;
const emoji = (h) => [...h.matchAll(/<span class="emoji"[^>]*>([^<]+)<\/span>/g)].map((m) => m[1]);

test("GitHub shortcodes become emoji", () => {
  assert.deepEqual(emoji(html("Ship it :rocket: :+1: :white_check_mark: :-1:")), ["🚀", "👍", "✅", "👎"]);
});

test("emoji are labelled for screen readers and show the code on hover", () => {
  assert.match(html(":tada:"), /<span class="emoji" role="img" aria-label="tada" title=":tada:">🎉<\/span>/);
  assert.match(html(":white_check_mark:"), /aria-label="white check mark"/);
});

test("unknown codes, times and ratios stay as typed", () => {
  for (const md of [":not_an_emoji:", "Meet at 10:30:45", "ratio 1:2:3", "Note: smile: no", "::"]) {
    assert.equal(emoji(html(md)).length, 0, md);
  }
  assert.match(html("Meet at 10:30:45 :smile:"), /Meet at 10:30:45 <span class="emoji"/);
});

test("emoji are not parsed inside code", () => {
  assert.equal(emoji(html("Type `:smile:` to get one")).length, 0);
  assert.equal(emoji(html("```\n:smile:\n```")).length, 0);
});

test("bare URLs still autolink next to emoji", () => {
  const h = html("See https://example.com/a:b :smile: and www.example.org");
  assert.match(h, /<a [^>]*href="https:\/\/example\.com\/a:b"/);
  assert.match(h, /<a [^>]*href="http:\/\/www\.example\.org"/);
  assert.equal(emoji(h).length, 1);
});

test("emoji work in headings, tables, tasks and callouts", () => {
  assert.equal(emoji(html("## Done :tada:")).length, 1);
  assert.match(html("## Done :tada:"), /<h2 id="done">/);
  assert.equal(emoji(html("| a |\n|---|\n| :star: |")).length, 1);
  assert.equal(emoji(html("- [ ] buy :apple:")).length, 1);
  assert.equal(emoji(html("> [!tip] Nice :sparkles:\n> Body :fire:")).length, 2);
});

test("emoji do not count as words", () => {
  assert.equal(render("Great job :tada: :rocket:").words, 2);
});
