// Regenerates the README images in images/screenshots/ from sample/README.md:
//   npm run screenshots          (builds first; or: node scripts/screenshots.mjs)
// Starts scripts/preview.mjs, drives headless Chrome over the DevTools protocol
// (Node's built-in WebSocket, so Node 22+), frames each shot in a window on a warm
// backdrop and saves PNGs. If ffmpeg is on PATH it also records demo.gif, a scripted
// walkthrough with a visible cursor. Set CHROME / FFMPEG if they are not found.
import { spawn, spawnSync } from "child_process";
import { existsSync, mkdirSync, mkdtempSync, rmSync, statSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import path from "path";

const PREVIEW_PORT = 8398;
const DEBUG_PORT = 9339;
const OUT = "images/screenshots";
const base = `http://127.0.0.1:${PREVIEW_PORT}/`;
const J = JSON.stringify;

const stills = [
  { name: "hero", query: "mode=dark&theme=2", open: "toc-toggle" },
  { name: "callouts", query: "mode=light&theme=1", at: "callouts-obsidian-style", light: true },
  { name: "code", query: "mode=dark&theme=2", at: "code-blocks" },
  { name: "math", query: "mode=sepia&theme=1", at: "math", light: true, height: 330 },
  { name: "diagrams", query: "mode=dark&theme=2", at: "diagrams", height: 1070 },
  { name: "diagram-viewer", query: "mode=dark&theme=2", at: "diagrams", click: ".mermaid-block .diagram-expand" },
  { name: "settings", query: "mode=sepia&theme=1", at: "lists-and-tasks", open: "settings-toggle", light: true },
];

/* ---------------- page templates ---------------- */

const BACKDROP = `background:
  radial-gradient(circle at 15% 0%, #FFE9D2 0, transparent 50%),
  linear-gradient(135deg, #FFD2A6 0%, #F7A375 50%, #EC6A45 100%);`;

const CURSOR = `<svg id="cursor" width="28" height="28" viewBox="0 0 24 24"><path
  d="M3 2 L3 19.5 L7.8 15 L11.2 22.2 L14.4 20.8 L11 13.6 L17.6 13.6 Z" fill="#141414"
  stroke="#fff" stroke-width="1.5" stroke-linejoin="round"/></svg><div id="ring"></div>`;

function windowPage({ width, height, src, light, cursor }) {
  const winW = width - Math.round(width * 0.1);
  const winH = height - Math.round(height * 0.12);
  const bar = light ? "#E7E5E2" : "#2A2A2A";
  const tab = light ? "#FFFFFF" : "#1F1F1F";
  const ink = light ? "#333" : "#D6D6D6";
  return `<!DOCTYPE html><html><head><style>
  html,body{margin:0;width:${width}px;height:${height}px;overflow:hidden}
  body{${BACKDROP}display:grid;place-items:center;font:13px system-ui,-apple-system,"Segoe UI",sans-serif}
  .win{width:${winW}px;height:${winH}px;border-radius:14px;overflow:hidden;display:flex;flex-direction:column;
    box-shadow:0 40px 90px -24px rgba(120,40,10,.55),0 0 0 1px rgba(60,20,0,.12)}
  .bar{height:40px;flex:none;display:flex;align-items:end;gap:8px;padding:0 14px;background:${bar}}
  .dots{display:flex;gap:8px;align-self:center;margin-right:14px}
  .dots i{width:12px;height:12px;border-radius:50%;display:block}
  .tab{height:32px;display:flex;align-items:center;gap:8px;padding:0 16px;background:${tab};color:${ink};
    border-radius:8px 8px 0 0}
  .tab img{width:16px;height:16px}
  iframe{flex:1;border:0;width:100%;background:${tab}}
  #cursor{position:fixed;left:0;top:0;z-index:10;pointer-events:none;filter:drop-shadow(0 2px 3px rgba(0,0,0,.35));
    display:${cursor ? "block" : "none"}}
  #ring{position:fixed;width:34px;height:34px;margin:-17px 0 0 -17px;border-radius:50%;border:3px solid #FF7A50;
    z-index:9;pointer-events:none;opacity:0}
  #ring.on{animation:ring .45s ease-out}
  @keyframes ring{from{opacity:1;transform:scale(.4)}to{opacity:0;transform:scale(1.6)}}
  </style></head><body>
  <div class="win"><div class="bar"><span class="dots"><i style="background:#FF5F57"></i><i
    style="background:#FEBC2E"></i><i style="background:#28C840"></i></span>
    <span class="tab"><img src="/images/icon.png" alt="">README.md</span></div>
    <iframe src="${src}"></iframe></div>${CURSOR}</body></html>`;
}

// The same document side by side in several palettes, `columns` per row.
function tilesPage({ width, height, modes, columns = modes.length, scale = 0.6, readingWidth = 520 }) {
  const gap = 28;
  const rows = Math.ceil(modes.length / columns);
  const caption = 46;
  const tileW = Math.floor((width - 140 - gap * (columns - 1)) / columns);
  const tileH = Math.floor((height - 110 - gap * (rows - 1)) / rows) - caption;
  const frameW = Math.round(tileW / scale);
  const frameH = Math.round((tileH - 30) / scale);
  const tiles = modes
    .map(
      (m) => `<figure><div class="win"><div class="bar"><i></i><i></i><i></i></div><div class="clip">
      <iframe src="${base}?mode=${m}&theme=2&size=17&width=${readingWidth}"></iframe></div></div>
      <figcaption>${m[0].toUpperCase() + m.slice(1)}</figcaption></figure>`
    )
    .join("");
  return `<!DOCTYPE html><html><head><style>
  html,body{margin:0;width:${width}px;height:${height}px;overflow:hidden}
  body{${BACKDROP}display:grid;grid-template-columns:repeat(${columns},${tileW}px);gap:${gap}px;
    justify-content:center;align-content:center;font:600 20px system-ui,-apple-system,"Segoe UI",sans-serif}
  figure{margin:0;display:flex;flex-direction:column;align-items:center;gap:14px}
  .win{width:${tileW}px;height:${tileH}px;border-radius:12px;overflow:hidden;background:#fff;
    box-shadow:0 30px 70px -24px rgba(120,40,10,.55),0 0 0 1px rgba(60,20,0,.12)}
  .bar{height:30px;display:flex;gap:7px;align-items:center;padding:0 12px;background:#2A2A2A}
  .bar i{width:10px;height:10px;border-radius:50%;background:#555}
  .clip{width:${tileW}px;height:${tileH - 30}px;overflow:hidden}
  iframe{width:${frameW}px;height:${frameH}px;border:0;transform:scale(${scale});transform-origin:0 0}
  figcaption{color:#fff;text-shadow:0 1px 8px rgba(120,40,10,.45);height:${caption - 14}px}
  </style></head><body>${tiles}</body></html>`;
}

// Installed in the top page; drives the reading view inside the iframe.
const DEMO_HELPERS = `window.demo = {
  x: 0, y: 0,
  frame: () => document.querySelector("iframe"),
  doc() { return this.frame().contentDocument; },
  el(sel, i = 0) { return this.doc().querySelectorAll(sel)[i]; },
  point(sel, i) {
    const r = this.el(sel, i).getBoundingClientRect();
    const f = this.frame().getBoundingClientRect();
    return [f.left + r.left + r.width / 2, f.top + r.top + r.height / 2];
  },
  cursor(x, y) {
    this.x = x; this.y = y;
    document.getElementById("cursor").style.transform = "translate(" + (x - 3) + "px," + (y - 2) + "px)";
  },
  click(sel, i) {
    const ring = document.getElementById("ring");
    ring.style.left = this.x + "px"; ring.style.top = this.y + "px";
    ring.classList.remove("on"); void ring.offsetWidth; ring.classList.add("on");
    this.el(sel, i).click();
  },
  key(key) { this.doc().dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true })); },
  scrollY() { return this.frame().contentWindow.scrollY; },
  top(sel, i = 0) { return this.el(sel, i).getBoundingClientRect().top + this.scrollY(); },
  scroll(y) { this.frame().contentWindow.scrollTo({ top: y, behavior: "instant" }); },
  // Mouse-wheel over the full-screen diagram viewer, at the drawn cursor.
  wheel(dy) {
    const f = this.frame().getBoundingClientRect();
    this.doc().getElementById("diagram-viewer").dispatchEvent(new WheelEvent("wheel", {
      deltaY: dy, clientX: this.x - f.left, clientY: this.y - f.top, bubbles: true, cancelable: true,
    }));
  },
};`;

/* ---------------- browser plumbing ---------------- */

function findExe(envVar, candidates) {
  const found = [process.env[envVar], ...candidates].find((c) => c && existsSync(c));
  return found ?? null;
}
const chromePath = findExe("CHROME", [
  "C:/Program Files/Google/Chrome/Application/chrome.exe",
  "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  "/usr/bin/google-chrome",
  "/usr/bin/chromium",
]);
if (!chromePath) throw new Error("No Chrome/Edge found; set CHROME=/path/to/browser");
const ffmpeg =
  process.env.FFMPEG ?? (spawnSync("ffmpeg", ["-version"]).status === 0 ? "ffmpeg" : null);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function waitFor(url) {
  for (let i = 0; i < 100; i++) {
    try {
      const res = await fetch(url);
      if (res.ok) return res;
    } catch {}
    await sleep(100);
  }
  throw new Error(`timed out waiting for ${url}`);
}

function connect(wsUrl) {
  const ws = new WebSocket(wsUrl);
  let id = 0;
  const pending = new Map();
  ws.onmessage = (ev) => {
    const msg = JSON.parse(ev.data);
    if (msg.id && pending.has(msg.id)) {
      const { resolve, reject } = pending.get(msg.id);
      pending.delete(msg.id);
      msg.error ? reject(new Error(msg.error.message)) : resolve(msg.result);
    }
  };
  const send = (method, params = {}) =>
    new Promise((resolve, reject) => {
      pending.set(++id, { resolve, reject });
      ws.send(JSON.stringify({ id, method, params }));
    });
  return new Promise((resolve) => (ws.onopen = () => resolve({ ws, send })));
}

const preview = spawn(process.execPath, ["scripts/preview.mjs", "sample/README.md", String(PREVIEW_PORT)], {
  stdio: "ignore",
});
const chrome = spawn(
  chromePath,
  [
    "--headless=new",
    "--disable-gpu",
    "--hide-scrollbars",
    "--force-color-profile=srgb",
    `--remote-debugging-port=${DEBUG_PORT}`,
    `--user-data-dir=${mkdtempSync(path.join(tmpdir(), "lectern-shots-"))}`,
    "about:blank",
  ],
  { stdio: "ignore" }
);

let send;
const evaluate = async (expression) =>
  (await send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true })).result.value;

async function setSize(width, height) {
  await send("Emulation.setDeviceMetricsOverride", { width, height, deviceScaleFactor: 1, mobile: false });
}

// Opens a page of our own HTML on the preview origin, so its iframes are same-origin.
async function showPage(html) {
  await send("Page.navigate", { url: `${base}?stage` });
  await sleep(300);
  await evaluate(`document.open(); document.write(${J(html)}); document.close();`);
  await evaluate(`(async () => {
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
    for (let i = 0; i < 200; i++) {
      const frames = [...document.querySelectorAll("iframe")];
      const ready = (d) => d?.querySelector("#root h1") && !d.querySelector(".mermaid-block:not(.drawn)");
      if (frames.length && frames.every((f) => ready(f.contentDocument))) break;
      await sleep(50);
    }
    await sleep(400);
  })()`);
}

async function capture(file) {
  const { data } = await send("Page.captureScreenshot", { format: "png" });
  writeFileSync(file, Buffer.from(data, "base64"));
}

/* ---------------- stills ---------------- */

const tiles = [
  { name: "modes", height: 820, modes: ["light", "sepia", "dark", "black"] },
  // One diagram in every palette; each tile is scrolled to the first diagram.
  {
    name: "diagram-themes",
    height: 1060,
    modes: ["light", "sepia", "dark", "black"],
    columns: 2,
    scale: 0.8,
    readingWidth: 760,
    at: ".mermaid-block",
  },
];

async function shootStills() {
  const width = 1600;
  for (const shot of stills) {
    const height = shot.height ?? 1000;
    await setSize(width, height);
    await showPage(windowPage({ width, height, src: `${base}?${shot.query}`, light: shot.light }));
    await evaluate(`(async () => {
      ${DEMO_HELPERS}
      await demo.doc().fonts.ready;
      // Scroll twice: late layout (fonts, diagrams) can still shift content.
      for (let i = 0; i < 2; i++) {
        ${shot.at ? `demo.scroll(demo.top(${J("#" + shot.at)}) - 28);` : ""}
        await new Promise((r) => setTimeout(r, 300));
      }
      ${shot.open ? `demo.el(${J("#" + shot.open)}).click();` : ""}
      ${shot.click ? `demo.el(${J(shot.click)}).click();` : ""}
      await new Promise((r) => setTimeout(r, 600));
    })()`);
    await capture(path.join(OUT, `${shot.name}.png`));
    console.log(`${OUT}/${shot.name}.png`);
  }
  for (const t of tiles) {
    await setSize(width, t.height);
    await showPage(tilesPage({ width, ...t }));
    if (t.at) {
      await evaluate(`(async () => {
        for (let i = 0; i < 2; i++) {
          for (const f of document.querySelectorAll("iframe")) {
            await f.contentDocument.fonts.ready;
            const el = f.contentDocument.querySelector(${J(t.at)});
            f.contentWindow.scrollTo({ top: el.getBoundingClientRect().top + f.contentWindow.scrollY - 24, behavior: "instant" });
          }
          await new Promise((r) => setTimeout(r, 400));
        }
      })()`);
    }
    await capture(path.join(OUT, `${t.name}.png`));
    console.log(`${OUT}/${t.name}.png`);
  }
}

/* ---------------- demo gif ---------------- */

async function recordDemo() {
  const width = 1200;
  const height = 750;
  const dir = mkdtempSync(path.join(tmpdir(), "lectern-gif-"));
  const frames = [];
  const snap = async (ms) => {
    const file = path.join(dir, `f${String(frames.length).padStart(4, "0")}.png`);
    await capture(file);
    frames.push({ file, ms });
  };
  const ease = (t) => (t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2);
  const STEP = 40;

  const hold = (ms) => snap(ms);
  // Captures frames for real time while CSS transitions / smooth scrolls run.
  const settle = async (ms) => {
    const end = Date.now() + ms;
    let last = Date.now();
    while (Date.now() < end) {
      await snap(0);
      const now = Date.now();
      frames[frames.length - 1].ms = now - last;
      last = now;
    }
  };
  const moveTo = async (sel, i = 0, ms = 600) => {
    const [x0, y0] = await evaluate("[demo.x, demo.y]");
    const [x1, y1] = await evaluate(`demo.point(${J(sel)}, ${i})`);
    const n = Math.max(1, Math.round(ms / STEP));
    for (let k = 1; k <= n; k++) {
      const t = ease(k / n);
      await evaluate(`demo.cursor(${x0 + (x1 - x0) * t}, ${y0 + (y1 - y0) * t})`);
      await snap(STEP);
    }
  };
  const click = async (sel, i = 0, ms = 300) => {
    await evaluate(`demo.click(${J(sel)}, ${i})`);
    await settle(ms);
  };
  const scrollTo = async (sel, ms = 800, i = 0) => {
    const from = await evaluate("demo.scrollY()");
    const to = sel ? (await evaluate(`demo.top(${J(sel)}, ${i})`)) - 28 : 0;
    const n = Math.max(1, Math.round(ms / STEP));
    for (let k = 1; k <= n; k++) {
      await evaluate(`demo.scroll(${from + (to - from) * ease(k / n)})`);
      await snap(STEP);
    }
  };
  const pick = (sel, i = 0, move = 500, after = 900) =>
    moveTo(sel, i, move).then(() => click(sel, i)).then(() => hold(after));

  await setSize(width, height);
  await showPage(windowPage({ width, height, src: `${base}?mode=dark&theme=2`, cursor: true }));
  await evaluate(DEMO_HELPERS + `demo.cursor(${width * 0.62}, ${height * 0.55});`);

  await hold(1000);
  // Outline: open it and jump to a section.
  await pick("#toc-toggle", 0, 550, 300);
  await moveTo('a.toc-row[data-target="callouts-obsidian-style"]', 0, 450);
  await click('a.toc-row[data-target="callouts-obsidian-style"]', 0, 800);
  await hold(500);
  // Unfold a collapsed callout.
  await pick("details > summary.callout-title", 0, 450, 800);
  // Tick a task; the source file is edited in VS Code.
  await scrollTo("#lists-and-tasks", 700);
  await pick('input[type="checkbox"]', 2, 450, 800);
  // Math, then a diagram full screen: zoom in towards the cursor, close.
  await scrollTo("#math", 900);
  await hold(900);
  await scrollTo("#diagrams", 800);
  await hold(500);
  await pick(".mermaid-block.drawn", 0, 500, 500);
  await moveTo("#diagram-viewer .dv-stage", 0, 400);
  for (let k = 0; k < 10; k++) {
    await evaluate("demo.wheel(-45)");
    await snap(STEP);
  }
  await hold(700);
  await evaluate('demo.key("Escape")');
  await settle(250);
  // Palettes and fonts over the diagrams: each change redraws them in the new colors.
  await pick("#settings-toggle", 0, 550, 300);
  await pick('#rs-bg .bgs[data-mode="light"]', 0, 400, 1100);
  await scrollTo("#more-diagram-types", 1200);
  await hold(600);
  await pick('#rs-bg .bgs[data-mode="sepia"]', 0, 400, 1100);
  await pick('#rs-font button[data-font="1"]', 0, 400, 1000);
  await scrollTo(".mermaid-block", 1600, 7);
  await hold(500);
  await pick('#rs-bg .bgs[data-mode="black"]', 0, 400, 1100);
  await pick('#rs-font button[data-font="0"]', 0, 350, 600);
  await scrollTo(".mermaid-block", 1000, 8);
  await pick('#rs-bg .bgs[data-mode="dark"]', 0, 350, 1100);
  await evaluate('demo.key("Escape")');
  await settle(250);
  await scrollTo(null, 700);
  await hold(400);

  const list = frames.map((f) => `file '${f.file.replace(/\\/g, "/")}'\nduration ${(Math.max(f.ms, 20) / 1000).toFixed(3)}`);
  list.push(`file '${frames[frames.length - 1].file.replace(/\\/g, "/")}'`);
  const listFile = path.join(dir, "frames.txt");
  writeFileSync(listFile, list.join("\n"));
  const out = path.join(OUT, "demo.gif");
  const res = spawnSync(
    ffmpeg,
    [
      "-y", "-loglevel", "error", "-f", "concat", "-safe", "0", "-i", listFile,
      "-vf", "fps=25,split[a][b];[a]palettegen=max_colors=256:stats_mode=full[p];[b][p]paletteuse=dither=sierra2_4a:diff_mode=rectangle",
      "-loop", "0", out,
    ],
    { stdio: "inherit" }
  );
  rmSync(dir, { recursive: true, force: true });
  if (res.status !== 0) throw new Error("ffmpeg failed");
  console.log(`${out} (${frames.length} frames, ${(statSync(out).size / 1e6).toFixed(1)} MB)`);
}

/* ---------------- main ---------------- */

try {
  await waitFor(base);
  await waitFor(`http://127.0.0.1:${DEBUG_PORT}/json/version`);
  const target = await (await fetch(`http://127.0.0.1:${DEBUG_PORT}/json/new?about:blank`, { method: "PUT" })).json();
  const conn = await connect(target.webSocketDebuggerUrl);
  send = conn.send;
  await send("Page.enable");
  mkdirSync(OUT, { recursive: true });

  if (!process.argv.includes("--gif-only")) await shootStills();
  if (process.argv.includes("--stills-only")) {
    // skip the GIF
  } else if (ffmpeg) await recordDemo();
  else console.log("ffmpeg not found: skipped demo.gif (set FFMPEG to enable)");
  conn.ws.close();
} finally {
  chrome.kill();
  preview.kill();
}
