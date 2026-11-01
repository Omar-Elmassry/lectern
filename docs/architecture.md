# Architecture

## Process split

VS Code extensions run in two very different JavaScript contexts, and this extension
keeps them strictly separated:

```
              ┌──────────────────────────── extension host (Node) ────────────────────────────┐
  *.md  ──►  │ ReaderEditorProvider.resolveCustomTextEditor()                                │
  (open with │   • reads document text                                                       │
   "Lectern  │   • collects lectern.* prefs (validated)  + activeColorTheme + docBase/rootBase│
   view")    │   • resolves [[wiki]] links/embeds through the cached WikiResolver            │
             │   postMessage({type:"update", content, settings})  ──────────────┐           │
             └──────────────────────────────────────────────────────────────────│───────────┘
                                                                                ▼
             ┌──────────────────────── webview (browser sandbox) ─────────────────────────────┐
             │ main.ts: render(content, settings) -> markdown/render.ts (marked v13, hljs,    │
             │          KaTeX, emoji); inject HTML, build TOC, draw Mermaid diagrams on demand│
             │ postMessage({type:"toggleTask"|"openLink"|"setSetting"|"resetSettings"|"ready"})│
             └───────────────────────────────────────────────────────────────────────────────┘
```

- Host side: `src/extension.ts` (activation, commands), `src/readerProvider.ts`
  (the `CustomTextEditorProvider`), `src/diffPairing.ts` (diff helpers) and
  `src/markdown/wiki.ts` (`WikiResolver`). Only these may `import "vscode"`.
- Webview side: `src/webview/main.ts`, `src/webview/diffview.ts` + `src/webview/style.css`, and
  `src/webview/mermaid.ts` (a separate on-demand bundle). No Node/vscode APIs, only
  `acquireVsCodeApi()` and DOM. Bundled as browser IIFEs.
- Shared pure code: `src/markdown/render.ts`, `diff.ts`, `math.ts`, `emoji.ts`, `frontmatter.ts`,
  `util.ts` and `src/settings.ts`. None of them import `vscode`, so `npm test` runs them
  in plain Node.

## File map

| Path | Role |
| --- | --- |
| `src/extension.ts` | `activate()`: creates the `WikiResolver`, registers the custom editor provider + 5 commands (`lectern.open`, `lectern.openSource`, `lectern.showMindMap`, `lectern.toggleDiffDefault`, `lectern.openSettings`). In a diff, `open` and `openSource` reopen the whole diff with the other editor. |
| `src/readerProvider.ts` | Provider: HTML/CSP, settings collection, message handling, task edits, link opening, open-panel registry, pairing the two sides of a diff. |
| `src/diffPairing.ts` | Reads `git:` URIs (which file, which version), labels diff sides, `reopenActiveWith()`. |
| `src/settings.ts` | `lectern.*` keys, defaults, bounds, `sanitizePref()`. Single source of truth for host and webview. |
| `src/markdown/diff.ts` | `diffBlocks()` (LCS over top-level blocks, similar blocks paired as changes) and `diffWords()`. Pure. |
| `src/markdown/mindmap.ts` | Mind map: `buildTree()` (headings to a tree; one top heading is the root, else the file name) and `layout()` (left-to-right tree, folding). Pure. |
| `src/markdown/render.ts` | `renderMarkdown(content, settings, diff?) -> {html, taskLines, words, diff?}`; marked v13 + marked-highlight + highlight.js; callouts, wiki-link extension, task line mapping, heading ids, asset URLs. |
| `src/markdown/math.ts` | `$…$` / `$$…$$` marked extensions and `renderTex()` (KaTeX, `trust: false`). ```` ```math ```` and ```` ```mermaid ```` fences go through the `code` renderer in `render.ts`. |
| `src/markdown/emoji.ts` | `:shortcode:` inline extension backed by `gemoji`'s `nameToEmoji`. `start()` only stops at known codes so bare URLs still autolink. |
| `src/markdown/frontmatter.ts` | Splits leading YAML front matter off and renders it as a properties list. |
| `src/markdown/util.ts` | `slugify`, `htmlToText`, `escapeHtml`. |
| `src/markdown/wiki.ts` | `WikiResolver` — resolves `[[link]]` / `![[embed]]` targets; cached, cleared on file create/delete/rename. |
| `src/nonce.ts` | CSP nonce (crypto). |
| `src/webview/main.ts` | Shell, panels, settings UI, TOC, image lightbox, Mermaid loading/theming and the full-screen diagram viewer, render loop, message plumbing, host-stylesheet stripping. |
| `src/webview/diffview.ts` | Diff UI: word highlights inside changed blocks, the diff bar (counts, previous/next, Text diff) and scroll sync. |
| `src/webview/mindmapview.ts` | Draws the mind map as an SVG (branch colours, fold buttons) for the full-screen viewer in `main.ts`. |
| `src/webview/mermaid.ts` | Entry for `dist/webview/mermaid.js` (~5 MB). Sets `window.lecternMermaid`; loaded on demand by `main.ts`. |
| `src/webview/style.css` | All theming (token blocks per mode/theme) and layout. |
| `test/*.test.mjs` | `node:test` suites run by `npm test`: renderer (tasks, callouts, headings, assets, wiki, front matter, math, emoji, words, diffs), mind map tree and layout, wiki resolver, settings schema. |
| `scripts/*.mjs` | `make-package` (generates `package.json`), `test` (bundles + runs `test/`), `webtest`, `hosttest`, `preview` (serves the real webview in a browser), `screenshots` (README images), `notices` (writes `THIRD_PARTY_NOTICES.md` during production builds). |
| `esbuild.mjs` | Three builds: host (Node CJS, `vscode` external), webview `main` and webview `mermaid` (browser IIFEs). KaTeX fonts ship as woff2 only. Production builds also regenerate `THIRD_PARTY_NOTICES.md`. |
| `dist/` | Build output that ships in the VSIX: `extension.js`, `webview/main.js`, `webview/main.css`, `webview/mermaid.js` and `webview/fonts/*.woff2` (KaTeX). |

## Message protocol

Webview → host (`vscode.postMessage`):

| Message | Payload | Host action |
| --- | --- | --- |
| `ready` | — | Sends the first `update`, then any pending `scrollTo` anchor. |
| `toggleTask` | `{ line: number, checked: boolean }` | Sets `[ ]`/`[x]` on that line via `WorkspaceEdit` (idempotent). If nothing was edited, re-sends `update` so the optimistic checkbox snaps back. |
| `openLink` | `{ href: string }` | http(s)/mailto/tel/ftp(s) → `openExternal`; any other scheme is blocked. Paths (relative, `/workspace-root`, `C:/…`, `file:`) open in the editor, markdown in Lectern, with `#fragment` scrolling. |
| `setSetting` | `{ key, value }` | `sanitizePref()` then writes one `lectern.*` value to Global settings. |
| `resetSettings` | — | Sets all keys to `undefined` (removes overrides → defaults). |
| `diffScroll` | `{ id: string, frac: number }` | Diff only: relayed to the other side's panel. |
| `openTextDiff` | — | Diff only: reopens the diff as VS Code's text diff. |

Host → webview:

| Message | Payload | Effect |
| --- | --- | --- |
| `update` | `{ content: string, settings: ReaderSettings, diff?: { side, other, label } }` | Re-renders and re-applies settings. Sent on `ready`, document change (debounced 150 ms; in a diff, a change to either side), `lectern` config change and color theme change. |
| `diffScroll` | `{ id: string, frac: number }` | Diff only: the other side scrolled; follow it. |
| `mindmap` | — | Opens the mind map (from **Lectern: Show Mind Map**). |
| `scrollTo` | `{ anchor: string }` | Scrolls to a heading by id, percent-decoded id or `slugify()`d text. |

`makeUpdater()` tags each update with a ticket so a slow wiki resolution cannot paint
stale content over a newer one.

## Settings

Declared in `package.json` (template: `scripts/make-package.mjs`) and mirrored in
`src/settings.ts`; `test/settings.test.mjs` fails if the two drift.

| Key | Default | Range/enum |
| --- | --- | --- |
| `backgroundMode` | `editor` | `editor` \| `light` \| `sepia` \| `dark` \| `black` |
| `readingWidth` | `760` | 480–1600 |
| `fontFamily` | `""` | string (empty = default sans stack; the panel offers Sans/Serif/Mono presets) |
| `fontSize` | `18` | 12–28 |
| `lineHeight` | `1.7` | 1.2–2.4 |
| `outlinePinned` | `false` | boolean |

`ReaderSettings` (what the webview receives) is those prefs plus `themeKind`
(`vscode.ColorThemeKind`: 1 light, 2 dark, 3 high contrast, 4 high contrast light),
`docBase` / `rootBase` (webview URI bases for document- and workspace-relative
resources), the `wiki` / `embeds` maps of resolved targets, `readOnly` (task
checkboxes disabled: the old side of a diff) and `title` (the file name, for the mind
map's root).

## Reading-view diffs

When the user opens a diff of a Markdown file with Lectern (the book button or
`Ctrl+Alt+R` in a text diff, or `workbench.diffEditorAssociations`), VS Code opens two
separate Lectern editors side by side, one per version. The extension API does not say
they belong together (the tab's input is unknown to extensions), so
`ReaderEditorProvider.pairDiffSides()` pairs them itself: two readers for the same file
on disk, at least one of them a `git:` version, opened in the same editor group within
3 seconds. The older version (`HEAD` < index < working tree) is the original side;
for two commits, `commitTime()` asks the git extension for both commit dates. Each
side's `update` then carries the other side's text.

Inside such a diff VS Code leaves `activeCustomEditorId` empty, a webview's `active`
flag is unreliable, and keys pressed in the webview never reach VS Code's keybindings.
So the extension sets its own `lectern.inDiff` context key (for the title-bar button)
from the tab state on every tab change, and the diff page handles `Ctrl+Alt+R` itself
and posts `openTextDiff`. The book button passes the file on disk even for a commit
diff, so `lectern.open` matches the diff by file, not by URI.

`renderMarkdown(..., { side, other })` lexes both texts and runs `diffBlocks()` over the
top-level blocks, always from original to modified, so both sides get the same list of
operations. A `processAllTokens` hook inserts HTML marker tokens around this side's
blocks: `.diff-changed`, `.diff-added` or `.diff-removed` wrappers, `.diff-gap` lines
where the other side has blocks this side doesn't, and zero-height `.diff-anchor`s
before unchanged blocks. Every marker has `data-sync=<operation index>`, so the same id
exists on both sides. Inserting tokens (not text) keeps task line numbers correct.

In the webview, `highlightWords()` renders the other side's version of each changed
block, compares the plain text with `diffWords()` and wraps the differences in
`<ins>` / `<del>`, skipping formulas and diagrams and blocks where more than 60%
changed. Scroll sync posts the nearest `data-sync` id above the line under the diff
bar plus a fraction of the way to the next one; the other side scrolls to the same
point.

The original side (any `git:` document) is read-only. Its images, links and wiki links
resolve against the file on disk (`diskUri()`), since a `git:` URI has no folder of
its own.

## Rendering pipeline (`render.ts`)

- `new Marked(markedHighlight({...}), { gfm: true, breaks: false })`, plus
  `marked.use({ useNewRenderer: true, renderer })` — **required for marked v13**.
- Per render, a module-level `ctx` holds the settings, the normalised text, task lines and
  used heading ids. marked renderers are synchronous, so this is safe; it is cleared in
  `finally`.
- Front matter is split off first and replaced by blank lines, so line numbers hold.
- **Task lines:** the `processAllTokens` hook walks the token tree and records each task
  item's source line by locating every token's `raw` inside its parent's text (nesting
  changes columns, never line counts). The `checkbox` renderer consumes them in order.
- **Wiki links / embeds** are an inline extension (`wikilink`), so code is never touched.
- **Callouts:** a blockquote whose first line is `[!type]±` becomes a callout; `+`/`-`
  render a `<details>` (open/collapsed).
- **Headings** get unique, Unicode-aware `slugify()` ids from their visible text.
- **Assets:** markdown images and raw HTML `img/video/audio/source` go through
  `resolveAsset()` (decode once, encode once, `/` = workspace root).
- **Emoji:** `:shortcode:` → `<span class="emoji" role="img" aria-label>`; unknown codes
  and code are left alone.
- **Math:** inline/block extensions follow GitHub's dollar rules (no space inside the
  delimiters, no digit after the closing `$`, `\$` escapes). Output is wrapped in
  `<!--math-->` markers so `countWords()` can skip it. Bad TeX renders as a red
  `.math-error` with the message in `title`.
- **Mermaid:** the renderer only emits `<div class="mermaid-block"><pre class="mermaid-src">`
  with the escaped source; drawing happens in the webview (see below).

## Diagrams in the webview

`drawDiagrams()` runs after every render and whenever the palette changes. It reads the
`--rd-*` colors (resolved to hex through a 1px canvas, since `color-mix()` is not
understood by Mermaid's theming), paints cached SVGs synchronously (so typing doesn't
flicker or move the scroll position), then loads `mermaid.js` once via a `<script>`
carrying the page's CSP nonce (URL from `<meta name="lectern-mermaid">`) and renders the
rest with `securityLevel: "strict"`. Results are cached per theme + source.

The full-screen viewer (`openDiagramViewer()`) clones the drawn SVG into a fixed
`#diagram-viewer` dialog and positions it with one `translate(...) scale(...)` transform:
wheel zoom keeps the point under the pointer fixed, drag pans with pointer capture, and
`fitDiagram()` re-fits on open, `0` and window resize. Escape is handled by the global
key handler (viewer first, then lightbox, then panels).

## Webview shell (`main.ts`)

`ensureShell()` builds the fixed chrome once: progress bar, outline panel, settings
panel, two icon buttons and the stats chip. `setPanel()` opens at most one panel; closed
panels are `inert`. `applySettings()` writes CSS custom properties and
`body.dataset.mode` / `body.dataset.theme`, then `render()` injects the HTML, wraps code
blocks (copy button + language chip) and builds the TOC. `setSetting()` applies
optimistically and posts to the host; the host's next `update` is the source of truth.

The strip-host-stylesheet logic runs at module load, before the shell is built — see
`theming.md`.
