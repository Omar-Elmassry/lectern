import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "module";

const require = createRequire(import.meta.url);
const { textDirection } = require("../out/test/direction.js");
const { diffWords } = require("../out/test/diff.js");

test("Arabic-script languages are right to left", () => {
  assert.equal(textDirection("مرحبا بالعالم"), "rtl"); // Arabic
  assert.equal(textDirection("سلام دنیا"), "rtl"); // Persian
  assert.equal(textDirection("یہ اردو کا ایک جملہ ہے"), "rtl"); // Urdu
  assert.equal(textDirection("زه پښتو وایم"), "rtl"); // Pashto
  assert.equal(textDirection("من کوردی دەزانم"), "rtl"); // Kurdish (Sorani)
  assert.equal(textDirection("مان سنڌي ڳالهايان ٿو"), "rtl"); // Sindhi
  assert.equal(textDirection("میں پنجابی بولدا ہاں"), "rtl"); // Punjabi (Shahmukhi)
  assert.equal(textDirection("ﻣﺮﺣﺒﺎ"), "rtl"); // Arabic presentation forms
});

test("Latin, Cyrillic and CJK text is left to right", () => {
  assert.equal(textDirection("Hello world"), "ltr");
  assert.equal(textDirection("Привет мир"), "ltr");
  assert.equal(textDirection("你好世界"), "ltr");
});

test("text without letters has no direction", () => {
  assert.equal(textDirection(""), null);
  assert.equal(textDirection("123 — 4.5%"), null);
  assert.equal(textDirection("١٢٣"), null); // Arabic-Indic digits are not letters
  assert.equal(textDirection("🎉 !!"), null);
});

test("most letters win, so an Arabic sentence may start with an English name", () => {
  assert.equal(textDirection("React مكتبة لبناء واجهات المستخدم"), "rtl");
  assert.equal(textDirection("Use the الأمر command to start"), "ltr");
});

test("a tie goes to the first letter", () => {
  assert.equal(textDirection("ab سم"), "ltr");
  assert.equal(textDirection("سم ab"), "rtl");
});

test("Arabic diacritics stay inside their word in word diffs", () => {
  const d = diffWords("كَتَبَ الطالبُ الدرسَ", "كَتَبَ المعلمُ الدرسَ");
  assert.deepEqual(d.removed.map(([s, e]) => "كَتَبَ الطالبُ الدرسَ".slice(s, e)), ["الطالبُ"]);
  assert.deepEqual(d.added.map(([s, e]) => "كَتَبَ المعلمُ الدرسَ".slice(s, e)), ["المعلمُ"]);
});

test("Persian words with a zero-width non-joiner are one word", () => {
  const a = "می\u200Cخواهم بروم";
  const b = "می\u200Cخواهم بمانم";
  const d = diffWords(a, b);
  assert.deepEqual(d.removed.map(([s, e]) => a.slice(s, e)), ["بروم"]);
});
