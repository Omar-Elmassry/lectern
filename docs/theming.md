# Theming

The reading view has its own color system and must **never** inherit VS Code's
editor-theme element styling. This file explains the token system and the host-stylesheet
problem that shaped it (`history.md` has the story).

## The token system (`style.css`)

Every color used in the reading column comes from a `--rd-*` custom property. There are
two orthogonal axes:

1. **`body[data-mode]`** — the reader's chosen palette. Each of `editor`, `light`, `sepia`,
   `dark`, `black` defines the **full** token set (there are no shared fallbacks; each
   block is self-contained so a mode can never half-inherit another's colors).
2. **`body[data-theme]`** — `dark` or `light`: dark for the Dark and Black palettes, and
   for Editor when VS Code's theme is dark or High Contrast. Used for things that only
   care about light vs dark: the highlight.js palette, a few code-block tweaks, and the
   `darkMode` flag of the Mermaid theme.

Core tokens: `--rd-bg`, `--rd-fg`, `--rd-muted`, `--rd-border`, `--rd-border-strong`,
`--rd-accent`, `--rd-accent-soft`, `--rd-code-bg`, `--rd-quote-bg`, `--rd-selection`.
Accent per mode: `editor` uses `--vscode-focusBorder`, `light` `#0969da`, `sepia`
`#9a6a2f`, `dark` `#6ea8ff`, `black` `#79b3ff`.

The webview writes `data-mode` / `data-theme` and the layout tokens (`--rd-width`,
`--rd-font-size`, `--rd-line-height`, `--rd-font-family`) in `applySettings()`. The
`editor` block derives its colors from `--vscode-*` variables (mixed with `color-mix()`),
so it follows the VS Code theme live; High Contrast themes get their own border tokens.

Mermaid diagrams are themed from the same tokens: `diagramTheme()` in `main.ts` reads
them, resolves each to `#rrggbb` (Mermaid can't parse `color-mix()`), and redraws
diagrams when the palette changes. Charts that need several colors (pie slices, mind map
and timeline branches, git lanes, gantt bars) use the callout hues mixed 45% into
`--rd-bg`, so `--rd-fg` text stays readable on them in every palette. KaTeX output inherits `color` and needs no theming.

## Hard rules (learned the hard way)

1. **No translucent backgrounds.** The webview is composited by the GPU; `rgb(... / x)`
   and `color-mix(..., transparent)` produced visible **chip/band artifacts** behind code
   blocks. All translucency was replaced with opaque `color-mix(in srgb, <color> <pct>,
   var(--rd-bg))`, which blends against a known solid base. This includes overlays: the
   image lightbox and the diagram viewer use a solid `var(--rd-bg)`.
2. **No `backdrop-filter: blur()`.** It forced extra compositing layers and amplified the
   artifacts.
3. **Code blocks must not paint their own per-line backgrounds.** The host's highlight
   machinery sometimes paints line backgrounds; the webview armor (below) neutralizes them.
4. **Own every element VS Code styles.** Do not rely on "VS Code probably won't touch
   this." Explicitly set color/background for `code`, `kbd`, links, `blockquote`, and
   `body` padding. See the host-stylesheet section.

### Code "armor"
A defensive block clears any inherited painting inside code and then re-applies ours:

```css
.reading pre, .reading pre code, .reading pre code *, .reading code {
  background-color: transparent !important;
  background-image: none !important;
  text-shadow: none;
  box-shadow: none;
}
.reading pre { background-color: var(--rd-code-bg) !important; }
.reading code { background-color: var(--rd-code-bg) !important; color: var(--rd-fg); }
```

(The `.reading pre`/`code` background rules follow the clear-out so ours wins.)

## The host stylesheet problem (`#_defaultStyles`)

### What happened
VS Code injects a stylesheet with `id="_defaultStyles"` into **every** webview, wrapped
in `@layer vscode-default`. It styles plain markdown elements using editor-theme
variables, regardless of our palettes. The damaging rules:

```css
code {
  font-family: var(--monaco-monospace-font);
  color: var(--vscode-textPreformat-foreground);
  background-color: var(--vscode-textPreformat-background);
  padding: 1px 3px; border-radius: 4px;
}
a, a code { color: var(--vscode-textLink-foreground); }
a:hover   { color: var(--vscode-textLink-activeForeground); }
kbd       { /* keybindingLabel colors + shadow */ }
blockquote{ background: var(--vscode-textBlockQuote-background); ... }
body      { padding: 0 20px; font-family/size/weight: var(--vscode-font-*); ... }
```

Symptoms: in a fixed **light** palette, inline code rendered as dark, theme-colored
"chips" with unreadable text; links and `kbd` adopted the editor theme's colors. Because
the rules live in a CSS cascade **layer**, they are otherwise hard to out-specify —
`!important` from us is needed, or remove the source.

### The fix (`main.ts:stripHostDefaultStyles`)
At webview module load — before the shell is built:

1. Snapshot the `--vscode-*` variables we still consume onto `<html>` as inline styles,
   **but only if the host is not already maintaining them inline** (`THEME_VARS_KEPT`,
   e.g. `--vscode-editor-background`, `--vscode-focusBorder`,
   `--vscode-editor-findMatchHighlightBackground`, scrollbar slider). This guards against
   a future VS Code that defines the variables *inside* the sheet we delete, without
   shadowing host updates on theme change.
2. Remove `document.getElementById("_defaultStyles")`.
3. Install a `MutationObserver` on `document.head` that re-removes it if VS Code injects a
   replacement (it does, e.g. on theme change).

Deleting the sheet is safe because **it only consumes `--vscode-*` variables; it does not
define them** — verified by dumping the sheet's full text from webview DevTools. Editor
mode theming therefore survives.

### What we re-implemented ourselves
Two parts of the sheet were genuinely useful and are now in our CSS:

```css
html { scrollbar-color: var(--vscode-scrollbarSlider-background, rgb(121 121 121 / 40%)) var(--rd-bg); }
::highlight(find-highlight)         { background-color: var(--vscode-editor-findMatchHighlightBackground, rgb(234 92 0 / 33%)); }
::highlight(current-find-highlight) { background-color: var(--vscode-editor-findMatchBackground, rgb(234 92 0 / 66%)); }
```

And we assert ownership of everything that used to leak: explicit `color` on `.reading
code` (→ `--rd-fg`) and `.reading a.md-link code` (→ accent), `a.md-link:hover` → accent,
`kbd` color + `box-shadow: none`, and `body { padding: 0; font-weight: 400 }` (the sheet
was adding `padding: 0 20px`).

### If it regresses
- Confirm the sheet still exists and is still named `#_defaultStyles` in the running VS
  Code (a rename would silently defeat the remover). See `debugging.md`.
- If a future sheet starts **defining** `--vscode-*`, the variable snapshot becomes
  load-bearing; check `THEME_VARS_KEPT` covers anything referenced by our re-implemented
  rules and the host-driven pieces.

## Runtime constraints
`color-mix()` needs Chromium 111+ and `::highlight()` Chromium 105+. VS Code 1.80–1.81
ship Electron 22 (Chromium 108), which lacks `color-mix()`, so `engines.vscode` is
`^1.82.0` (Electron 25, Chromium 114). Do not lower it without replacing `color-mix()`.
