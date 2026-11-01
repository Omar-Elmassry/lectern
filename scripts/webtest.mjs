import { Window } from "happy-dom";

const posted = [];
const window = new Window({ url: "http://localhost/test.html" });
const document = window.document;

// Stub the VS Code webview API before the bundle runs.
window.acquireVsCodeApi = () => ({
  postMessage: (m) => posted.push(JSON.parse(JSON.stringify(m))),
  getState: () => ({}),
  setState: () => {},
});

document.write(
  `<html><head><link rel="stylesheet" href="main.css"></head><body><div id="root"></div></body></html>`
);

// Load the bundled webview script in this document context.
import { readFileSync } from "fs";
import { fileURLToPath } from "url";

const mainJs = readFileSync(
  fileURLToPath(new URL("../dist/webview/main.js", import.meta.url)),
  "utf8"
);
window.eval(mainJs);

console.log("script executed without throwing (length " + mainJs.length + ")");

console.log("shell built:", {
  progressBar: !!document.getElementById("progress-bar"),
  tocPanel: !!document.getElementById("toc-panel"),
  tocToggle: !!document.getElementById("toc-toggle"),
  gear: !!document.getElementById("settings-toggle"),
  settingsPanel: !!document.getElementById("reader-settings"),
  swatches: document.querySelectorAll("#rs-bg .bgs").length,
});

const { renderMarkdown } = await import("../dist/webview/main.js").catch(() => ({ renderMarkdown: null }));
void renderMarkdown;

const sample = "# Hello\n\nBody text.\n\n```ts\nconst a = 1;\n```\n\n- [ ] task\n";

function hostEcho(mod = {}) {
  // Simulate the extension host replying with settings
  const settings = {
    readingWidth: 760,
    fontFamily: "",
    fontSize: 18,
    lineHeight: 1.7,
    themeKind: 2,
    docBase: "https://f.example/docs",
    wiki: {},
    embeds: {},
    ...mod,
  };
  window.dispatchEvent(
    new window.MessageEvent("message", {
      data: { type: "update", content: sample, settings },
    })
  );
}

// initial update delivered by host on "ready"
hostEcho();
const root = document.getElementById("root");

console.log("after first update:", {
  headings: root.querySelectorAll("h1").length,
  codeLang: document.querySelector(".code-lang")?.textContent ?? "(none)",
  copyBtn: !!document.querySelector(".copy-btn"),
  tocRows: document.querySelectorAll("a.toc-row").length,
  bodyMode: document.body.dataset.mode,
  fontSizeVar: document.documentElement.style.getPropertyValue("--rd-font-size"),
  postedTypes: posted.map((p) => p.type),
});

// every outline row must carry its heading level (toc-h1..toc-h6) for indentation
for (const row of document.querySelectorAll("a.toc-row")) {
  const level = document.getElementById(row.dataset.target)?.tagName.toLowerCase();
  if (!row.classList.contains(`toc-${level}`)) {
    throw new Error(`toc row "${row.textContent}" has class "${row.className}", expected toc-${level}`);
  }
}
console.log("toc levels OK");

// --- click the gear button ---
document.getElementById("settings-toggle").click();
const panel = document.getElementById("reader-settings");
console.log("panel open after gear click:", panel.classList.contains("open"));

// --- click the sepia swatch ---
const sepia = document.querySelector('#rs-bg .bgs[data-mode="sepia"]');
console.log("sepia swatch found:", !!sepia);
sepia.click();
console.log("posted after sepia:", JSON.stringify(posted[posted.length - 1]));

// optimistic: applied locally WITHOUT waiting for host echo
console.log("body mode (optimistic, no echo):", document.body.dataset.mode);
console.log(
  "sepia active:",
  document.querySelector('#rs-bg .bgs[data-mode="sepia"]').classList.contains("active")
);

// host echoes back the new setting
hostEcho({ backgroundMode: "sepia" });
console.log("body mode after echo:", document.body.dataset.mode);

// --- A+ click ---
document.getElementById("rs-fplus").click();
console.log("posted after fplus:", JSON.stringify(posted[posted.length - 1]));
// optimistic without echo
console.log("fsize label (optimistic):", document.getElementById("rs-fsize").textContent);
console.log(
  "--rd-font-size:",
  document.documentElement.style.getPropertyValue("--rd-font-size")
);
hostEcho({ backgroundMode: "sepia", fontSize: 19 });

// --- outline on the left ---
console.log(
  "toc open from left:",
  (() => {
    document.getElementById("toc-toggle").click();
    return document.getElementById("toc-panel").classList.contains("open");
  })()
);

// --- restore defaults ---
document.getElementById("rs-reset").click();
console.log("posted after reset:", JSON.stringify(posted[posted.length - 1]));
const reset =
  document.body.dataset.mode === "editor" &&
  document.getElementById("rs-fsize").textContent === "18px" &&
  document.documentElement.style.getPropertyValue("--rd-font-size") === "18px";
console.log("reset applied:", reset);
if (!reset) process.exitCode = 1;

// --- one side of a diff ---
const diffSettings = { readingWidth: 760, fontFamily: "", fontSize: 18, lineHeight: 1.7, themeKind: 2, docBase: "x", wiki: {}, embeds: {} };
const sendDiff = (diff) =>
  window.dispatchEvent(
    new window.MessageEvent("message", {
      data: { type: "update", content: "# T\n\nThe quick red fox.\n\nNew block.\n", settings: diffSettings, diff },
    })
  );
sendDiff({ side: "modified", other: "# T\n\nThe quick brown fox.\n", label: "After · Working tree" });
const words = [...document.querySelectorAll("#root ins.diff-word")].map((e) => e.textContent);
const counts = document.querySelector("#diff-bar .db-counts")?.textContent;
const addedBlock = !!document.querySelector("#root .diff-added");
console.log("diff words:", words, "counts:", counts);
document.getElementById("db-text").click();
const askedText = posted[posted.length - 1]?.type === "openTextDiff";
window.dispatchEvent(new window.MessageEvent("message", { data: { type: "update", content: "# T\n", settings: diffSettings } }));
const barGone = !document.getElementById("diff-bar") && !document.body.classList.contains("diff-mode");
const diffOk =
  words.join("|") === "red" && counts === "+1 added ~1 changed" && addedBlock && askedText && barGone;
console.log("DIFF VIEW OK:", diffOk);
if (!diffOk) process.exitCode = 1;

// --- pinned outline and mind map ---
const mapSettings = { ...diffSettings, outlinePinned: false, title: "notes" };
const sendDoc = (content, settings) =>
  window.dispatchEvent(new window.MessageEvent("message", { data: { type: "update", content, settings } }));
sendDoc("# Title\n\n## One\n\n### One A\n\n## Two\n", mapSettings);
document.getElementById("toc-pin").click();
const pinPosted = JSON.stringify(posted[posted.length - 1]) === JSON.stringify({ type: "setSetting", key: "outlinePinned", value: true });
const pinned = document.body.classList.contains("toc-pinned") && document.getElementById("toc-panel").classList.contains("open");
document.querySelector("a.toc-row").click(); // jumping keeps a pinned outline open
const stillOpen = document.getElementById("toc-panel").classList.contains("open");
document.getElementById("toc-mindmap").click();
const mapNodes = [...document.querySelectorAll("#diagram-viewer .mm-node")].map((n) => n.getAttribute("aria-label"));
console.log("pin:", { pinPosted, pinned, stillOpen }, "mind map:", mapNodes);
window.dispatchEvent(new window.KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
document.dispatchEvent(new window.KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
sendDoc("Just text.\n", mapSettings);
const mapDisabled = document.getElementById("toc-mindmap").disabled;
const mapOk =
  pinPosted && pinned && stillOpen && mapNodes.join("|") === "Title|One|One A|Two" && mapDisabled &&
  !document.getElementById("diagram-viewer");
console.log("PIN AND MIND MAP OK:", mapOk);
if (!mapOk) process.exitCode = 1;
