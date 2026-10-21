import { createRequire } from "module";
const require = createRequire(import.meta.url);

export const { renderMarkdown } = require("../out/test/render.js");
export const util = require("../out/test/util.js");

export function settings(overrides = {}) {
  return {
    readingWidth: 760,
    fontFamily: "",
    fontSize: 18,
    lineHeight: 1.7,
    backgroundMode: "editor",
    themeKind: 2,
    docBase: "BASE",
    wiki: { Home: "home.md" },
    embeds: {},
    ...overrides,
  };
}

export const render = (md, s) => renderMarkdown(md, settings(s));
