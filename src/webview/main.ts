import type { ReaderSettings, RenderResult } from "../markdown/render";
import { renderMarkdown } from "../markdown/render";
import { slugify } from "../markdown/util";
import { PREF_BOUNDS, PREF_DEFAULTS, sanitizePref, type PrefKey } from "../settings";
import "katex/dist/katex.min.css";
import "./style.css";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
declare function acquireVsCodeApi(): { postMessage(msg: any): void };
const vscode = acquireVsCodeApi();
// Scripts added later (the Mermaid bundle) must carry the page's CSP nonce.
const SCRIPT_NONCE = (document.currentScript as HTMLScriptElement | null)?.nonce ?? "";

/**
 * VS Code injects a default stylesheet (`#_defaultStyles`) into every webview.
 * It paints host-theme colors onto plain markdown elements - most visibly
 * `code` (textPreformat-*), links and `kbd` - which clash badly with the
 * Reader's own light/sepia/dark reading modes. The sheet only consumes
 * `--vscode-*` variables; it does not define them, so it is safe to remove.
 * We keep the useful parts (find highlights, scrollbars) in our own sheet.
 */
const HOST_STYLE_ID = "_defaultStyles";

const THEME_VARS_KEPT = [
  "--vscode-editor-background",
  "--vscode-editor-foreground",
  "--vscode-focusBorder",
  "--vscode-editor-selectionBackground",
  "--vscode-editor-font-family",
  "--vscode-editor-findMatchHighlightBackground",
  "--vscode-editor-findMatchBackground",
  "--vscode-scrollbarSlider-background",
  "--vscode-contrastBorder",
  "--vscode-contrastActiveBorder",
];

function stripHostDefaultStyles(): void {
  const el = document.documentElement;
  const cs = typeof getComputedStyle === "function" ? getComputedStyle(el) : null;
  if (cs) {
    // Snapshot theme variables as inline styles in case a future VS Code
    // version ships them inside the sheet we are about to delete. Do not
    // shadow values the host already maintains inline.
    for (const name of THEME_VARS_KEPT) {
      if (el.style.getPropertyValue(name)) {
        continue;
      }
      const value = cs.getPropertyValue(name).trim();
      if (value) {
        el.style.setProperty(name, value);
      }
    }
  }

  const kill = (): void => {
    document.getElementById(HOST_STYLE_ID)?.remove();
  };
  kill();

  if (typeof MutationObserver === "function" && document.head) {
    const observer = new MutationObserver(kill);
    observer.observe(document.head, { childList: true });
  }
}

stripHostDefaultStyles();

const root = document.getElementById("root") as HTMLElement;

const state = {
  scrollY: 0,
};

let currentSettings: ReaderSettings | null = null;

/** Font presets offered in the panel; any other fontFamily value is "custom". */
const FONT_PRESETS = [
  { label: "Sans", value: "" },
  { label: "Serif", value: '"Iowan Old Style", Charter, Georgia, Cambria, "Times New Roman", serif' },
  { label: "Mono", value: 'ui-monospace, "Cascadia Code", Consolas, "Courier New", monospace' },
];

const WIDTH_PRESETS = [
  { label: "Narrow", value: 640 },
  { label: "Normal", value: 760 },
  { label: "Wide", value: 920 },
];

const ICONS = {
  expand:
    '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M9.5 2.5h4v4M13.5 2.5 9 7M6.5 13.5h-4v-4M2.5 13.5 7 9"/></svg>',
  zoomIn: '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M3 8h10M8 3v10"/></svg>',
  zoomOut: '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M3 8h10"/></svg>',
  fit: '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M2.5 6V2.5H6M10 2.5h3.5V6M13.5 10v3.5H10M6 13.5H2.5V10"/></svg>',
  close: '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M3.5 3.5l9 9M12.5 3.5l-9 9"/></svg>',
  outline:
    '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M2.5 4h11M5.5 8h8M5.5 12h8M2.5 8h.01M2.5 12h.01"/></svg>',
  settings:
    '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M3 4.5h6M12 4.5h1M3 11.5h1M7 11.5h6"/><circle cx="10.5" cy="4.5" r="1.5"/><circle cx="5.5" cy="11.5" r="1.5"/></svg>',
};

function ensureShell(): void {
  if (document.getElementById("progress-bar")) {
    return;
  }
  const progress = document.createElement("div");
  progress.id = "progress-bar";
  progress.setAttribute("aria-hidden", "true");
  document.body.appendChild(progress);

  const toc = document.createElement("aside");
  toc.id = "toc-panel";
  toc.className = "rd-panel";
  toc.setAttribute("aria-label", "Outline");
  toc.innerHTML = `<div id="toc-title">Outline</div><nav id="toc-list" aria-label="Headings"></nav>`;
  document.body.appendChild(toc);

  const option = (attr: string, value: string | number, label: string) =>
    `<button type="button" ${attr}="${value}" aria-pressed="false">${label}</button>`;
  const swatch = (mode: string, label: string, title: string) =>
    `<button type="button" class="bgs" data-mode="${mode}" title="${title}" aria-pressed="false">` +
    `<span class="sw sw-${mode}" aria-hidden="true"></span><span class="bgs-name">${label}</span></button>`;

  const settings = document.createElement("div");
  settings.id = "reader-settings";
  settings.className = "rd-panel";
  settings.setAttribute("role", "dialog");
  settings.setAttribute("aria-label", "Reading settings");
  settings.innerHTML = `
  <div class="rs-title">Reading settings</div>
  <div class="rs-section">
    <div class="rs-label" id="rs-bg-label">Background</div>
    <div class="rs-swatches" id="rs-bg" role="group" aria-labelledby="rs-bg-label">
      ${swatch("editor", "Editor", "Follow the editor theme")}
      ${swatch("light", "Light", "Light")}
      ${swatch("sepia", "Sepia", "Sepia")}
      ${swatch("dark", "Dark", "Dark")}
      ${swatch("black", "Black", "Black")}
    </div>
  </div>
  <div class="rs-section">
    <div class="rs-label" id="rs-font-label">Font</div>
    <div class="rs-row rs-seg" id="rs-font" role="group" aria-labelledby="rs-font-label">
      ${FONT_PRESETS.map((f, i) => option("data-font", i, f.label)).join("")}
    </div>
  </div>
  <div class="rs-section">
    <div class="rs-label" id="rs-fsize-label">Text size</div>
    <div class="rs-row" role="group" aria-labelledby="rs-fsize-label">
      <button type="button" id="rs-fminus" aria-label="Smaller text">A−</button>
      <span class="rs-value" id="rs-fsize" aria-live="polite"></span>
      <button type="button" id="rs-fplus" aria-label="Larger text">A+</button>
    </div>
  </div>
  <div class="rs-section">
    <div class="rs-label" id="rs-width-label">Line width</div>
    <div class="rs-row rs-seg" id="rs-width" role="group" aria-labelledby="rs-width-label">
      ${WIDTH_PRESETS.map((w) => option("data-w", w.value, w.label)).join("")}
    </div>
  </div>
  <div class="rs-section">
    <div class="rs-label" id="rs-lsp-label">Line spacing</div>
    <div class="rs-row" role="group" aria-labelledby="rs-lsp-label">
      <button type="button" id="rs-lminus" aria-label="Tighter line spacing">−</button>
      <span class="rs-value" id="rs-lsp" aria-live="polite"></span>
      <button type="button" id="rs-lplus" aria-label="Looser line spacing">+</button>
    </div>
  </div>
  <button type="button" class="rs-reset" id="rs-reset">Restore defaults</button>`;
  document.body.appendChild(settings);

  const tocBtn = document.createElement("button");
  tocBtn.type = "button";
  tocBtn.id = "toc-toggle";
  tocBtn.className = "rd-fab";
  tocBtn.title = "Outline";
  tocBtn.setAttribute("aria-label", "Outline");
  tocBtn.setAttribute("aria-controls", "toc-panel");
  tocBtn.innerHTML = ICONS.outline;
  document.body.appendChild(tocBtn);

  const gear = document.createElement("button");
  gear.type = "button";
  gear.id = "settings-toggle";
  gear.className = "rd-fab";
  gear.title = "Reading settings";
  gear.setAttribute("aria-label", "Reading settings");
  gear.setAttribute("aria-controls", "reader-settings");
  gear.innerHTML = ICONS.settings;
  document.body.appendChild(gear);

  const stats = document.createElement("div");
  stats.id = "stats-chip";
  document.body.appendChild(stats);

  setPanel(null);
}

/* ---------- panels (outline / settings) ---------- */

const PANELS = {
  toc: { panel: "toc-panel", toggle: "toc-toggle" },
  settings: { panel: "reader-settings", toggle: "settings-toggle" },
} as const;
type PanelName = keyof typeof PANELS;
let openPanel: PanelName | null = null;

/**
 * Open one panel (closing the other) or close both. Closed panels are inert
 * so their controls leave the Tab order and the accessibility tree.
 */
function setPanel(name: PanelName | null, opts: { restoreFocus?: boolean } = {}): void {
  const previous = openPanel;
  openPanel = name;
  for (const key of Object.keys(PANELS) as PanelName[]) {
    const open = key === name;
    const panel = document.getElementById(PANELS[key].panel);
    if (panel) {
      panel.classList.toggle("open", open);
      panel.inert = !open;
    }
    document.getElementById(PANELS[key].toggle)?.setAttribute("aria-expanded", String(open));
  }
  if (name && name !== previous) {
    const panel = document.getElementById(PANELS[name].panel);
    const first =
      panel?.querySelector<HTMLElement>(".toc-row.active, [aria-pressed='true']") ??
      panel?.querySelector<HTMLElement>("a, button");
    first?.focus({ preventScroll: true });
  } else if (!name && previous && opts.restoreFocus) {
    document.getElementById(PANELS[previous].toggle)?.focus();
  }
}

function applySettings(s: ReaderSettings): void {
  currentSettings = s;
  const r = document.documentElement.style;
  r.setProperty("--rd-width", `${s.readingWidth}px`);
  r.setProperty("--rd-font-size", `${s.fontSize}px`);
  r.setProperty("--rd-line-height", String(s.lineHeight));
  if (s.fontFamily) {
    r.setProperty("--rd-font-family", s.fontFamily);
  } else {
    r.removeProperty("--rd-font-family");
  }

  const mode = s.backgroundMode;
  document.body.dataset.mode = mode;
  const editorDark = s.themeKind === 2 || s.themeKind === 3;
  const dark = mode === "dark" || mode === "black" || (mode === "editor" && editorDark);
  document.body.dataset.theme = dark ? "dark" : "light";
  updateSettingsPanel();
  if (root.querySelector(".mermaid-block") && diagramThemeKey() !== drawnThemeKey) {
    void drawDiagrams();
  }
}

function updateSettingsPanel(): void {
  if (!currentSettings) {
    return;
  }
  const s = currentSettings;
  const press = (selector: string, isOn: (b: HTMLButtonElement) => boolean) => {
    document.querySelectorAll<HTMLButtonElement>(selector).forEach((b) => {
      const on = isOn(b);
      b.classList.toggle("active", on);
      b.setAttribute("aria-pressed", String(on));
    });
  };
  press("#rs-bg .bgs", (b) => b.dataset.mode === s.backgroundMode);
  press("#rs-font button", (b) => FONT_PRESETS[Number(b.dataset.font)]?.value === s.fontFamily);
  press("#rs-width button", (b) => Math.abs(s.readingWidth - Number(b.dataset.w)) <= 1);

  const fsize = document.getElementById("rs-fsize");
  if (fsize) {
    fsize.textContent = `${s.fontSize}px`;
  }
  const lsp = document.getElementById("rs-lsp");
  if (lsp) {
    lsp.textContent = s.lineHeight.toFixed(2);
  }
  // Disable steppers at the schema bounds instead of silently doing nothing.
  const at = (id: string, disabled: boolean) => {
    const b = document.getElementById(id) as HTMLButtonElement | null;
    if (b) {
      b.disabled = disabled;
    }
  };
  at("rs-fminus", s.fontSize <= PREF_BOUNDS.fontSize.min);
  at("rs-fplus", s.fontSize >= PREF_BOUNDS.fontSize.max);
  at("rs-lminus", s.lineHeight <= PREF_BOUNDS.lineHeight.min);
  at("rs-lplus", s.lineHeight >= PREF_BOUNDS.lineHeight.max);
}

const LANG_ALIASES: Record<string, string> = {
  js: "JavaScript",
  javascript: "JavaScript",
  jsx: "JSX",
  ts: "TypeScript",
  typescript: "TypeScript",
  tsx: "TSX",
  py: "Python",
  python: "Python",
  sh: "Shell",
  bash: "Bash",
  zsh: "Shell",
  shell: "Shell",
  c: "C",
  cpp: "C++",
  "c++": "C++",
  cc: "C++",
  cs: "C#",
  csharp: "C#",
  md: "Markdown",
  markdown: "Markdown",
  json: "JSON",
  jsonc: "JSON",
  yaml: "YAML",
  yml: "YAML",
  html: "HTML",
  xml: "XML",
  css: "CSS",
  scss: "SCSS",
  less: "Less",
  sql: "SQL",
  rust: "Rust",
  rs: "Rust",
  go: "Go",
  java: "Java",
  kotlin: "Kotlin",
  swift: "Swift",
  php: "PHP",
  ruby: "Ruby",
  rb: "Ruby",
  diff: "Diff",
  dockerfile: "Dockerfile",
  docker: "Dockerfile",
  makefile: "Makefile",
  ini: "INI",
  toml: "TOML",
  csv: "CSV",
  ps1: "PowerShell",
  powershell: "PowerShell",
  nix: "Nix",
  lua: "Lua",
  perl: "Perl",
  txt: "Plain text",
  text: "Plain text",
  plaintext: "Plain text",
};

function prettifyLang(raw: string): string {
  const key = raw.toLowerCase();
  const alias = LANG_ALIASES[key];
  if (alias) {
    return alias;
  }
  return raw.charAt(0).toUpperCase() + raw.slice(1);
}

function render(content: string, s: ReaderSettings): void {
  let result: RenderResult;
  try {
    result = renderMarkdown(content, s);
  } catch (err) {
    result = { html: `<pre>Rendering error: ${String(err)}</pre>`, taskLines: [], words: 0 };
  }

  const reading = document.createElement("div");
  reading.className = "reading";
  reading.innerHTML = content.trim()
    ? result.html
    : `<p class="empty-note">This note is empty. Start writing in the source editor and it will appear here.</p>`;

  root.replaceChildren(reading);

  // Mark list items that contain checkboxes for styling.
  root.querySelectorAll("input.task-cb").forEach((el) => {
    el.closest("li")?.classList.add("task-item");
  });

  // Wrap code blocks: language chip + copy button.
  root.querySelectorAll("pre:not(.mermaid-src)").forEach((pre) => {
    const wrap = document.createElement("div");
    wrap.className = "code-block";

    const codeEl = pre.querySelector("code");
    const m = /(?:^|\s)language-([A-Za-z0-9#+._-]+)/.exec(codeEl?.className ?? "");
    const btn = document.createElement("button");
    btn.className = "copy-btn";
    btn.textContent = "Copy";
    btn.addEventListener("click", async () => {
      const code = codeEl?.textContent ?? pre.textContent ?? "";
      try {
        await navigator.clipboard.writeText(code);
        btn.textContent = "Copied!";
        setTimeout(() => (btn.textContent = "Copy"), 1200);
      } catch {
        btn.textContent = "Ctrl+C";
        setTimeout(() => (btn.textContent = "Copy"), 1200);
      }
    });
    pre.replaceWith(wrap);
    wrap.appendChild(pre);
    wrap.appendChild(btn);

    if (m) {
      const chip = document.createElement("span");
      chip.className = "code-lang";
      chip.textContent = prettifyLang(m[1]);
      wrap.appendChild(chip);
    }
  });

  // Stats chip
  const mins = Math.max(1, Math.round(result.words / 220));
  const chip = document.getElementById("stats-chip");
  if (chip) {
    chip.textContent = `${result.words} words \u00B7 ~${mins} min read`;
  }

  buildToc();
  void drawDiagrams();
}

function buildToc(): void {
  const list = document.getElementById("toc-list");
  if (!list) {
    return;
  }
  list.innerHTML = "";
  const headings = Array.from(root.querySelectorAll("h1,h2,h3,h4,h5,h6"));
  for (const h of headings) {
    const row = document.createElement("a");
    row.className = `toc-row toc-${h.tagName.toLowerCase()}`;
    row.href = `#${h.id}`;
    row.textContent = h.textContent ?? "";
    row.dataset.target = h.id;
    list.appendChild(row);
  }
}

/* ---------- mermaid diagrams ---------- */

type Mermaid = NonNullable<Window["lecternMermaid"]>;
declare global {
  interface Window {
    lecternMermaid?: typeof import("mermaid").default;
  }
}

let mermaidLoad: Promise<Mermaid | null> | null = null;

/** Loads dist/webview/mermaid.js once, on first use. */
function loadMermaid(): Promise<Mermaid | null> {
  if (window.lecternMermaid) {
    return Promise.resolve(window.lecternMermaid);
  }
  mermaidLoad ??= new Promise((resolve) => {
    const src = document.querySelector<HTMLMetaElement>('meta[name="lectern-mermaid"]')?.content;
    if (!src) {
      resolve(null);
      return;
    }
    window.addEventListener("lectern-mermaid-ready", () => resolve(window.lecternMermaid ?? null), {
      once: true,
    });
    const script = document.createElement("script");
    script.src = src;
    script.nonce = SCRIPT_NONCE;
    script.onerror = () => {
      mermaidLoad = null;
      resolve(null);
    };
    document.head.appendChild(script);
  });
  return mermaidLoad;
}

/** Resolves any CSS color (including color-mix) to #rrggbb, which Mermaid's theming needs. */
function toHex(cssColor: string): string {
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = 1;
  const g = canvas.getContext("2d");
  if (!g) {
    return "#888888";
  }
  g.fillStyle = cssColor;
  g.fillRect(0, 0, 1, 1);
  const [r, gr, b] = g.getImageData(0, 0, 1, 1).data;
  return "#" + [r, gr, b].map((v) => v.toString(16).padStart(2, "0")).join("");
}

function diagramTheme(): Record<string, string | boolean> {
  const cs = getComputedStyle(document.body);
  const v = (name: string) => toHex(cs.getPropertyValue(name).trim() || "#888");
  const bg = v("--rd-bg");
  const fg = v("--rd-fg");
  const box = v("--rd-code-bg");
  const border = v("--rd-border-strong");
  const muted = v("--rd-muted");
  // Categorical colors (pie slices, mind map / timeline branches, git lanes, gantt bars):
  // the callout hues, tinted toward the page so the text color stays readable.
  const accent = v("--rd-accent");
  const hues = ["#4d78cc", "#57ab5a", "#d0996b", "#b083f0", "#6bcbb8", "#e5534b", "#986ee2"];
  const tint = (hue: string, pct: number) => toHex(`color-mix(in srgb, ${hue} ${pct}%, ${bg})`);
  const scale: Record<string, string> = {};
  for (let i = 0; i < 12; i++) {
    const fill = tint(hues[i % hues.length], 45);
    scale[`pie${i + 1}`] = fill;
    scale[`cScale${i}`] = fill;
    scale[`cScaleLabel${i}`] = fg;
    if (i < 8) {
      scale[`git${i}`] = fill;
      scale[`gitBranchLabel${i}`] = fg;
    }
  }
  return {
    ...scale,
    pieStrokeColor: bg,
    pieOuterStrokeColor: border,
    pieSectionTextColor: fg,
    pieTitleTextColor: fg,
    pieLegendTextColor: fg,
    commitLabelColor: fg,
    commitLabelBackground: box,
    sectionBkgColor: v("--rd-quote-bg"),
    altSectionBkgColor: bg,
    sectionBkgColor2: v("--rd-quote-bg"),
    gridColor: v("--rd-border"),
    taskBkgColor: tint(accent, 45),
    taskBorderColor: border,
    activeTaskBkgColor: tint("#4d78cc", 45),
    activeTaskBorderColor: border,
    doneTaskBkgColor: tint("#57ab5a", 45),
    doneTaskBorderColor: border,
    taskTextColor: fg,
    taskTextLightColor: fg,
    taskTextDarkColor: fg,
    taskTextOutsideColor: fg,
    taskTextClickableColor: fg,
    todayLineColor: accent,
    darkMode: document.body.dataset.theme === "dark",
    fontFamily: getComputedStyle(root).fontFamily,
    fontSize: "15px",
    background: bg,
    mainBkg: box,
    primaryColor: box,
    primaryTextColor: fg,
    primaryBorderColor: border,
    secondaryColor: v("--rd-quote-bg"),
    tertiaryColor: bg,
    nodeBorder: border,
    clusterBkg: v("--rd-quote-bg"),
    clusterBorder: border,
    lineColor: muted,
    textColor: fg,
    titleColor: fg,
    edgeLabelBackground: bg,
    noteBkgColor: v("--rd-accent-soft"),
    noteTextColor: fg,
    noteBorderColor: v("--rd-accent"),
    actorBkg: box,
    actorBorder: border,
    actorTextColor: fg,
    signalColor: fg,
    signalTextColor: fg,
    labelBoxBkgColor: box,
    labelTextColor: fg,
  };
}

function diagramThemeKey(): string {
  return JSON.stringify(diagramTheme());
}

/** Rendered SVG (or error HTML) per theme + source, so re-renders while typing are instant. */
const diagramCache = new Map<string, string>();
let diagramRun = 0;
let diagramSeq = 0;
let drawnThemeKey = "";

function diagramError(source: string, err: unknown): string {
  // Mermaid parse errors read "Parse error on line N:" / excerpt / caret / "Expecting …".
  const lines = (err instanceof Error ? err.message : String(err)).split("\n").filter((l) => l.trim());
  const last = lines.length > 1 ? lines[lines.length - 1] : "";
  const message = (lines[0] ?? "") + (last && !/^-*\^$/.test(last) ? ` ${last}` : "");
  const esc = (t: string) => t.replace(/[&<>"]/g, (c) => `&#${c.charCodeAt(0)};`);
  return (
    `<div class="mermaid-error" role="note"><strong>Diagram error:</strong> ${esc(message)}</div>` +
    `<pre class="mermaid-src">${esc(source)}</pre>`
  );
}

function paintDiagram(block: HTMLElement, html: string): void {
  block.innerHTML = html;
  const failed = html.includes('class="mermaid-error"');
  block.classList.toggle("failed", failed);
  block.classList.add("drawn");
  if (!failed) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "diagram-expand";
    btn.title = "Full screen";
    btn.setAttribute("aria-label", "Open diagram full screen");
    btn.innerHTML = ICONS.expand;
    block.appendChild(btn);
  }
}

/* ---------- full-screen diagram viewer ---------- */

interface Viewer {
  box: HTMLElement;
  stage: HTMLElement;
  w: number;
  h: number;
  scale: number;
  x: number;
  y: number;
  returnFocus: HTMLElement | null;
}

let viewer: Viewer | null = null;
const MIN_SCALE = 0.1;
const MAX_SCALE = 16;

function openDiagramViewer(block: HTMLElement): void {
  const svg = block.querySelector<SVGSVGElement>(":scope > svg");
  if (!svg) {
    return;
  }
  closeDiagramViewer();
  const vb = svg.viewBox.baseVal;
  const rect = svg.getBoundingClientRect();
  const w = vb && vb.width ? vb.width : rect.width;
  const h = vb && vb.height ? vb.height : rect.height;

  const box = document.createElement("div");
  box.id = "diagram-viewer";
  box.setAttribute("role", "dialog");
  box.setAttribute("aria-modal", "true");
  box.setAttribute("aria-label", "Diagram, full screen");
  box.tabIndex = -1;

  const stage = document.createElement("div");
  stage.className = "dv-stage";
  const copy = svg.cloneNode(true) as SVGSVGElement;
  copy.removeAttribute("style"); // Mermaid's max-width
  copy.setAttribute("width", String(w));
  copy.setAttribute("height", String(h));
  stage.appendChild(copy);
  box.appendChild(stage);

  const bar = document.createElement("div");
  bar.className = "dv-toolbar";
  const tool = (action: string, label: string, icon: string, key: string) =>
    `<button type="button" data-dv="${action}" aria-label="${label}" title="${label} (${key})">${icon}</button>`;
  bar.innerHTML =
    tool("out", "Zoom out", ICONS.zoomOut, "-") +
    `<span class="dv-zoom" aria-live="polite"></span>` +
    tool("in", "Zoom in", ICONS.zoomIn, "+") +
    tool("fit", "Fit to screen", ICONS.fit, "0") +
    tool("close", "Close", ICONS.close, "Esc");
  box.appendChild(bar);

  const hint = document.createElement("div");
  hint.className = "dv-hint";
  hint.textContent = "Scroll to zoom · drag to move · Esc to close";
  box.appendChild(hint);

  document.body.appendChild(box);
  document.body.classList.add("dv-open");
  viewer = { box, stage, w, h, scale: 1, x: 0, y: 0, returnFocus: block.querySelector(".diagram-expand") };
  fitDiagram();
  wireViewer(box);
  box.focus();
}

function closeDiagramViewer(): boolean {
  if (!viewer) {
    return false;
  }
  const { box, returnFocus } = viewer;
  viewer = null;
  box.remove();
  document.body.classList.remove("dv-open");
  returnFocus?.focus();
  return true;
}

function applyViewerTransform(): void {
  if (!viewer) {
    return;
  }
  viewer.stage.style.transform = `translate(${viewer.x}px, ${viewer.y}px) scale(${viewer.scale})`;
  const label = viewer.box.querySelector(".dv-zoom");
  if (label) {
    label.textContent = `${Math.round(viewer.scale * 100)}%`;
  }
}

/** Largest scale that fits the window with a margin, centred. */
function fitDiagram(): void {
  if (!viewer) {
    return;
  }
  const vw = viewer.box.clientWidth;
  const vh = viewer.box.clientHeight;
  const margin = 48;
  const scale = Math.min((vw - margin * 2) / viewer.w, (vh - margin * 2 - 40) / viewer.h, 4);
  viewer.scale = Math.max(MIN_SCALE, scale);
  viewer.x = (vw - viewer.w * viewer.scale) / 2;
  viewer.y = (vh - viewer.h * viewer.scale) / 2;
  applyViewerTransform();
}

/** Zoom by `factor`, keeping the point (cx, cy) in the viewer fixed. */
function zoomDiagram(factor: number, cx?: number, cy?: number): void {
  if (!viewer) {
    return;
  }
  const px = cx ?? viewer.box.clientWidth / 2;
  const py = cy ?? viewer.box.clientHeight / 2;
  const next = Math.min(MAX_SCALE, Math.max(MIN_SCALE, viewer.scale * factor));
  const k = next / viewer.scale;
  viewer.x = px - (px - viewer.x) * k;
  viewer.y = py - (py - viewer.y) * k;
  viewer.scale = next;
  applyViewerTransform();
}

function panDiagram(dx: number, dy: number): void {
  if (!viewer) {
    return;
  }
  viewer.x += dx;
  viewer.y += dy;
  applyViewerTransform();
}

function wireViewer(box: HTMLElement): void {
  box.addEventListener(
    "wheel",
    (e) => {
      e.preventDefault();
      const r = box.getBoundingClientRect();
      zoomDiagram(Math.exp(-e.deltaY * 0.0015), e.clientX - r.left, e.clientY - r.top);
    },
    { passive: false }
  );

  let drag: { id: number; x: number; y: number } | null = null;
  box.addEventListener("pointerdown", (e) => {
    if ((e.target as HTMLElement).closest(".dv-toolbar") || e.button !== 0) {
      return;
    }
    drag = { id: e.pointerId, x: e.clientX, y: e.clientY };
    box.setPointerCapture(e.pointerId);
    box.classList.add("dragging");
  });
  box.addEventListener("pointermove", (e) => {
    if (!drag || e.pointerId !== drag.id) {
      return;
    }
    panDiagram(e.clientX - drag.x, e.clientY - drag.y);
    drag.x = e.clientX;
    drag.y = e.clientY;
  });
  const endDrag = (e: PointerEvent) => {
    if (drag && e.pointerId === drag.id) {
      drag = null;
      box.classList.remove("dragging");
    }
  };
  box.addEventListener("pointerup", endDrag);
  box.addEventListener("pointercancel", endDrag);
  box.addEventListener("dblclick", (e) => {
    if (!(e.target as HTMLElement).closest(".dv-toolbar")) {
      const r = box.getBoundingClientRect();
      zoomDiagram(2, e.clientX - r.left, e.clientY - r.top);
    }
  });

  box.addEventListener("click", (e) => {
    const action = (e.target as HTMLElement).closest<HTMLElement>("[data-dv]")?.dataset.dv;
    if (action === "in") {
      zoomDiagram(1.25);
    } else if (action === "out") {
      zoomDiagram(0.8);
    } else if (action === "fit") {
      fitDiagram();
    } else if (action === "close") {
      closeDiagramViewer();
    }
  });

  box.addEventListener("keydown", (e) => {
    const step = 60;
    const keys: Record<string, () => void> = {
      "+": () => zoomDiagram(1.25),
      "=": () => zoomDiagram(1.25),
      "-": () => zoomDiagram(0.8),
      _: () => zoomDiagram(0.8),
      "0": () => fitDiagram(),
      ArrowLeft: () => panDiagram(step, 0),
      ArrowRight: () => panDiagram(-step, 0),
      ArrowUp: () => panDiagram(0, step),
      ArrowDown: () => panDiagram(0, -step),
    };
    const run = keys[e.key];
    if (run && !e.ctrlKey && !e.metaKey && !e.altKey) {
      e.preventDefault();
      run();
    } else if (e.key === "Tab") {
      // Keep focus inside the dialog.
      const items = [...box.querySelectorAll<HTMLElement>("button")];
      const i = items.indexOf(document.activeElement as HTMLElement);
      const next = e.shiftKey ? (i <= 0 ? items.length - 1 : i - 1) : (i + 1) % items.length;
      e.preventDefault();
      items[next]?.focus();
    }
  });
}

window.addEventListener("resize", () => {
  if (viewer) {
    fitDiagram();
  }
});

async function drawDiagrams(): Promise<void> {
  const blocks = [...root.querySelectorAll<HTMLElement>(".mermaid-block")];
  if (!blocks.length) {
    return;
  }
  const run = ++diagramRun;
  const theme = diagramTheme();
  const themeKey = JSON.stringify(theme);
  drawnThemeKey = themeKey;
  for (const block of blocks) {
    block.dataset.source ??= block.querySelector(".mermaid-src")?.textContent ?? "";
  }

  // Cached diagrams paint synchronously, before the caller restores scroll.
  const pending = blocks.filter((block) => {
    const cached = diagramCache.get(themeKey + "\n" + block.dataset.source);
    if (cached !== undefined) {
      paintDiagram(block, cached);
    }
    return cached === undefined;
  });
  if (!pending.length) {
    return;
  }

  const mermaid = await loadMermaid();
  if (run !== diagramRun) {
    return;
  }
  if (!mermaid) {
    pending.forEach((b) => paintDiagram(b, diagramError(b.dataset.source ?? "", "Mermaid could not be loaded.")));
    return;
  }
  mermaid.initialize({
    startOnLoad: false,
    securityLevel: "strict",
    theme: "base",
    themeVariables: theme,
    fontFamily: String(theme.fontFamily),
  });

  for (const block of pending) {
    const source = block.dataset.source ?? "";
    const id = `lectern-mermaid-${++diagramSeq}`;
    let html: string;
    try {
      html = (await mermaid.render(id, source)).svg;
    } catch (err) {
      html = diagramError(source, err);
      // Mermaid may leave its temporary render container behind on errors.
      document.getElementById(`d${id}`)?.remove();
      document.getElementById(id)?.remove();
    }
    if (diagramCache.size > 100) {
      diagramCache.delete(diagramCache.keys().next().value as string);
    }
    diagramCache.set(themeKey + "\n" + source, html);
    if (run !== diagramRun) {
      return;
    }
    paintDiagram(block, html);
  }
}

/* ---------- interactions ---------- */

function setSetting<K extends PrefKey>(key: K, value: unknown): void {
  const clean = sanitizePref(key, value);
  if (!currentSettings || clean === undefined) {
    return;
  }
  // Apply locally right away so changes are visible immediately, then persist.
  currentSettings = { ...currentSettings, [key]: clean };
  applySettings(currentSettings);
  vscode.postMessage({ type: "setSetting", key, value });
}

document.addEventListener("click", (e) => {
  const target = e.target as HTMLElement;

  const copyBtn = target.closest("button.copy-btn");
  if (copyBtn) {
    return; // handled by its own listener
  }

  const cb = target.closest("input.task-cb");
  if (cb instanceof HTMLInputElement) {
    // Let the browser flip the box (instant feedback, also for Space on a
    // focused box); the host writes the file and the re-render confirms it.
    const line = Number(cb.dataset.taskLine);
    if (Number.isInteger(line) && line >= 0) {
      vscode.postMessage({ type: "toggleTask", line, checked: cb.checked });
    }
    return;
  }

  const tocRow = target.closest("a.toc-row");
  if (tocRow instanceof HTMLAnchorElement) {
    e.preventDefault();
    setPanel(null);
    const id = tocRow.dataset.target;
    goTo(id ? document.getElementById(id) : null);
    return;
  }

  // Diagrams open full screen from their button or a click on the drawing.
  const diagram = target.closest<HTMLElement>(".mermaid-block.drawn:not(.failed)");
  if (diagram && target.closest(".reading")) {
    openDiagramViewer(diagram);
    return;
  }

  // Images zoom unless they are themselves a link.
  if (target instanceof HTMLImageElement && target.closest(".reading") && !target.closest("a")) {
    openLightbox(target);
    return;
  }

  const link = target.closest("a.md-link");
  if (link instanceof HTMLAnchorElement) {
    e.preventDefault();
    const href = link.getAttribute("href") ?? "";
    if (!href) {
      return;
    }
    if (href.startsWith("#")) {
      scrollToAnchor(href.slice(1));
      return;
    }
    vscode.postMessage({ type: "openLink", href });
    return;
  }

  // --- Reading settings panel controls ---

  const bgBtn = target.closest<HTMLButtonElement>("#rs-bg .bgs");
  if (bgBtn) {
    setSetting("backgroundMode", bgBtn.dataset.mode);
    return;
  }
  // sanitizePref clamps to the schema bounds.
  const fontSize = currentSettings?.fontSize ?? PREF_DEFAULTS.fontSize;
  const lineHeight = currentSettings?.lineHeight ?? PREF_DEFAULTS.lineHeight;
  if (target.id === "rs-fplus") {
    setSetting("fontSize", Math.round(fontSize) + 1);
    return;
  }
  if (target.id === "rs-fminus") {
    setSetting("fontSize", Math.round(fontSize) - 1);
    return;
  }
  if (target.id === "rs-lplus") {
    setSetting("lineHeight", Math.round((lineHeight + 0.05) * 100) / 100);
    return;
  }
  if (target.id === "rs-lminus") {
    setSetting("lineHeight", Math.round((lineHeight - 0.05) * 100) / 100);
    return;
  }
  const fontBtn = target.closest<HTMLButtonElement>("#rs-font button");
  if (fontBtn) {
    setSetting("fontFamily", FONT_PRESETS[Number(fontBtn.dataset.font)]?.value ?? "");
    return;
  }
  const wBtn = target.closest<HTMLButtonElement>("#rs-width button");
  if (wBtn) {
    setSetting("readingWidth", Number(wBtn.dataset.w));
    return;
  }

  if (target.id === "rs-reset") {
    if (currentSettings) {
      applySettings({ ...currentSettings, ...PREF_DEFAULTS });
    }
    vscode.postMessage({ type: "resetSettings" });
    return;
  }

  if (target.closest("#settings-toggle")) {
    setPanel(openPanel === "settings" ? null : "settings");
    return;
  }
  if (target.closest("#toc-toggle")) {
    setPanel(openPanel === "toc" ? null : "toc");
    return;
  }

  // Click elsewhere closes the open panel.
  if (openPanel && !target.closest(".rd-panel")) {
    setPanel(null);
  }
});

/**
 * Scroll to a heading given an id (`part-2`), a percent-encoded id (marked
 * encodes non-ASCII hrefs) or heading text as written in `[[Note#Part 2]]`.
 */
function scrollToAnchor(anchor: string): void {
  let decoded = anchor;
  try {
    decoded = decodeURIComponent(anchor);
  } catch {
    /* keep as-is */
  }
  const el =
    document.getElementById(anchor) ??
    document.getElementById(decoded) ??
    document.getElementById(slugify(decoded));
  goTo(el);
}

/**
 * Scroll to a heading and move keyboard focus there too, so Tab continues
 * from the section the reader jumped to.
 */
function goTo(el: HTMLElement | null): void {
  if (!el) {
    return;
  }
  const reduce = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
  el.scrollIntoView({ behavior: reduce ? "auto" : "smooth", block: "start" });
  if (!el.hasAttribute("tabindex")) {
    el.setAttribute("tabindex", "-1");
  }
  el.focus({ preventScroll: true });
}

document.addEventListener("keydown", (e) => {
  if (e.key !== "Escape") {
    return;
  }
  if (closeDiagramViewer() || closeLightbox()) {
    e.preventDefault();
  } else if (openPanel) {
    e.preventDefault();
    setPanel(null, { restoreFocus: true });
  }
});

/* ---------- image lightbox ---------- */

function openLightbox(img: HTMLImageElement): void {
  closeLightbox();
  const box = document.createElement("div");
  box.id = "lightbox";
  box.setAttribute("role", "dialog");
  box.setAttribute("aria-label", img.alt ? `Image: ${img.alt}` : "Image");
  box.tabIndex = -1;
  const big = document.createElement("img");
  big.src = img.currentSrc || img.src;
  big.alt = img.alt;
  box.appendChild(big);
  if (img.alt) {
    const caption = document.createElement("div");
    caption.className = "lightbox-caption";
    caption.textContent = img.alt;
    box.appendChild(caption);
  }
  box.addEventListener("click", () => closeLightbox());
  document.body.appendChild(box);
  box.focus();
}

/** Close the lightbox; returns whether one was open. */
function closeLightbox(): boolean {
  const box = document.getElementById("lightbox");
  box?.remove();
  return !!box;
}

/* ---------- scroll progress + active toc ---------- */

let ticking = false;
window.addEventListener("scroll", () => {
  const bar = document.getElementById("progress-bar");
  const max = document.documentElement.scrollHeight - window.innerHeight;
  if (bar) {
    bar.style.width = `${max > 0 ? Math.min(100, (window.scrollY / max) * 100) : 100}%`;
  }
  if (!ticking) {
    ticking = true;
    window.requestAnimationFrame(() => {
      updateActiveToc();
      ticking = false;
    });
  }
});

function updateActiveToc(): void {
  const rows = Array.from(document.querySelectorAll<HTMLElement>("a.toc-row"));
  if (rows.length === 0) {
    return;
  }
  let active = rows[0];
  for (const row of rows) {
    const el = document.getElementById(row.dataset.target ?? "");
    if (el && el.getBoundingClientRect().top <= 120) {
      active = row;
    }
  }
  rows.forEach((r) => r.classList.toggle("active", r === active));
}

/* ---------- main loop ---------- */

ensureShell();
vscode.postMessage({ type: "ready" });

// eslint-disable-next-line @typescript-eslint/no-explicit-any
window.addEventListener("message", (event: MessageEvent<any>) => {
  const msg = event.data as
    | { type: "update"; content: string; settings: ReaderSettings }
    | { type: "scrollTo"; anchor: string }
    | undefined;
  if (msg?.type === "update") {
    applySettings(msg.settings);
    state.scrollY = window.scrollY;
    render(msg.content, msg.settings);
    // Restore scroll position across re-renders.
    window.scrollTo(0, state.scrollY);
  } else if (msg?.type === "scrollTo") {
    scrollToAnchor(msg.anchor);
  }
});
