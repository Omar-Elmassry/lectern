// Serves the real webview bundle in a browser for UI work:
//   node scripts/preview.mjs [file.md] [port]
// then open http://127.0.0.1:<port>/?mode=dark&theme=2
// Query params: mode (editor|light|sepia|dark|black), theme (1 light, 2 dark,
// 3 hc), width, size, lh, file (another .md). VS Code theme variables are stubbed per theme kind.
// A diff, side by side: /diff?old=a.md&new=b.md (plus the params above).
import { createServer } from "http";
import { readFileSync } from "fs";
import path from "path";

const defaultFile = process.argv[2] ?? "sample/README.md";
const port = Number(process.argv[3] ?? 8321);
const root = path.resolve(".");
const docBaseOf = (file) => "/" + path.dirname(file).split(path.sep).join("/");

// Same policy as the real webview (readerProvider.getHtml), with 'self' for the
// webview origin. Screenshot staging pages (?stage) skip it so they can use iframes.
const CSP = "default-src 'none'; img-src 'self' data: https: http:; media-src 'self' data: https: http:; " +
  "style-src 'self' 'unsafe-inline'; font-src 'self' data:; script-src 'nonce-preview'; base-uri 'none'; form-action 'none';";

const page = (strict, file, diff) => `<!DOCTYPE html>
<html lang="en"><head><meta charset="UTF-8">
${strict ? `<meta http-equiv="Content-Security-Policy" content="${CSP}">` : ""}
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="lectern-mermaid" content="/dist/webview/mermaid.js">
<style id="vsvars"></style>
<link rel="stylesheet" href="/dist/webview/main.css">
</head><body><div id="root"></div>
<script nonce="preview">
const q = new URLSearchParams(location.search);
const kind = Number(q.get("theme") ?? 2);
const vars = {
  1: { bg: "#ffffff", fg: "#3b3b3b", focus: "#005fb8", sel: "#add6ff" },
  2: { bg: "#1f1f1f", fg: "#cccccc", focus: "#0078d4", sel: "#264f78" },
  3: { bg: "#000000", fg: "#ffffff", focus: "#f38518", sel: "#ffffff" },
  4: { bg: "#ffffff", fg: "#292929", focus: "#006bbd", sel: "#0f4a85" },
}[kind];
document.documentElement.style.cssText =
  "--vscode-editor-background:" + vars.bg + ";--vscode-editor-foreground:" + vars.fg +
  ";--vscode-focusBorder:" + vars.focus + ";--vscode-editor-selectionBackground:" + vars.sel +
  ";--vscode-editor-font-family:Consolas, 'Courier New', monospace";
document.body.className = ["", "vscode-light", "vscode-dark", "vscode-high-contrast", "vscode-high-contrast-light"][kind];
window.__posted = [];
window.acquireVsCodeApi = () => ({ postMessage: (m) => {
  window.__posted.push(m);
  if (m.type === "ready") send();
  if (m.type === "diffScroll" && parent !== window) parent.postMessage(m, "*");
} });
let content = ${JSON.stringify(readFileSync(file, "utf8"))};
const diff = ${JSON.stringify(diff ?? null)} ?? undefined;
function send() {
  window.postMessage({ type: "update", content, settings: {
    backgroundMode: q.get("mode") ?? "editor", readingWidth: Number(q.get("width") ?? 760),
    fontFamily: "", fontSize: Number(q.get("size") ?? 18), lineHeight: Number(q.get("lh") ?? 1.7),
    themeKind: kind, docBase: ${JSON.stringify(docBaseOf(defaultFile))}, wiki: {}, embeds: {},
    readOnly: diff?.side === "original",
  }, diff }, "*");
}
</script>
<script nonce="preview" src="/dist/webview/main.js"></script>
</body></html>`;

createServer((req, res) => {
  const url = new URL(req.url, "http://x");
  const q = url.searchParams;
  if (url.pathname === "/") {
    const file = q.get("file") ?? defaultFile;
    const against = q.get("against");
    const side = q.get("side") === "original" ? "original" : "modified";
    const diff = against
      ? { side, other: readFileSync(against, "utf8"), label: side === "original" ? "Before · Index" : "After · Working tree" }
      : undefined;
    res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
    return res.end(page(!q.has("stage"), file, diff));
  }
  if (url.pathname === "/diff") {
    // Two frames like VS Code's diff editor; diffScroll messages are relayed between them.
    const rest = [...q].filter(([k]) => k !== "old" && k !== "new").map(([k, v]) => `&${k}=${encodeURIComponent(v)}`).join("");
    const src = (file, against, side) =>
      `/?file=${encodeURIComponent(file)}&against=${encodeURIComponent(against)}&side=${side}${rest}`;
    res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
    return res.end(`<!DOCTYPE html><html><body style="margin:0;display:flex;height:100vh;background:#444;gap:2px">
<iframe id="o" style="flex:1;border:0" src="${src(q.get("old"), q.get("new"), "original")}"></iframe>
<iframe id="m" style="flex:1;border:0" src="${src(q.get("new"), q.get("old"), "modified")}"></iframe>
<script>
addEventListener("message", (e) => {
  if (e.data?.type !== "diffScroll") return;
  const to = e.source === o.contentWindow ? m : o;
  to.contentWindow.postMessage(e.data, "*");
});
</script></body></html>`);
  }
  const p = path.join(root, decodeURIComponent(url.pathname));
  if (!p.startsWith(root)) {
    res.writeHead(403);
    return res.end();
  }
  try {
    const body = readFileSync(p);
    const type = { ".css": "text/css", ".js": "text/javascript", ".png": "image/png", ".svg": "image/svg+xml", ".woff2": "font/woff2" }[path.extname(p)] ?? "application/octet-stream";
    res.writeHead(200, { "content-type": type });
    res.end(body);
  } catch {
    res.writeHead(404);
    res.end();
  }
}).listen(port, "127.0.0.1", () => console.log(`preview: http://127.0.0.1:${port}/`));
