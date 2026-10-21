import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "module";

const require = createRequire(import.meta.url);
const s = require("../out/test/settings.js");
const schema = require("../package.json").contributes.configuration.properties;

test("settings.ts matches the package.json configuration schema", () => {
  assert.deepEqual(Object.keys(schema).sort(), s.PREF_KEYS.map((k) => `lectern.${k}`).sort());
  for (const key of s.PREF_KEYS) {
    const prop = schema[`lectern.${key}`];
    assert.deepEqual(prop.default, s.PREF_DEFAULTS[key], `${key} default`);
    if (s.PREF_BOUNDS[key]) {
      assert.equal(prop.minimum, s.PREF_BOUNDS[key].min, `${key} minimum`);
      assert.equal(prop.maximum, s.PREF_BOUNDS[key].max, `${key} maximum`);
    }
  }
  assert.deepEqual(schema["lectern.backgroundMode"].enum, [...s.BACKGROUND_MODES]);
});

test("sanitizePref validates and clamps", () => {
  assert.equal(s.sanitizePref("fontSize", 99), 28);
  assert.equal(s.sanitizePref("fontSize", "20"), undefined);
  assert.equal(s.sanitizePref("lineHeight", Number.NaN), undefined);
  assert.equal(s.sanitizePref("backgroundMode", "sepia"), "sepia");
  assert.equal(s.sanitizePref("backgroundMode", "neon"), undefined);
  assert.equal(s.sanitizePref("fontFamily", "  Georgia  "), "Georgia");
});
