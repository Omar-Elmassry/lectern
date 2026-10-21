# Debugging

## 1. Open the RIGHT developer tools

There are two unrelated consoles, and they look similar:

- **Win/Linux:** `Help > Toggle Developer Tools` (or `Developer: Toggle Developer Tools`)
  opens the **workbench** console. Its document URL is `vscode-file://vscode-app/...`.
  **Webview `console.log`s do not appear here.** If you see that URL, you are in the wrong
  place and every "the console shows X" conclusion is void.
- **The webview:** run **`Developer: Open Webview Developer Tools`** with a **Lectern tab
  active/focused**. Its document URL starts with **`vscode-webview://`**. This is the only
  console that shows webview output and the only place `#_defaultStyles` and the dom are
  visible.

Always print `location.href` first and confirm the `vscode-webview://` prefix before
trusting anything. (A full diagnostic dump taken in the workbench console once sent
this project down the wrong path.)

## 2. Console snippets

### Identify the context and the active style sheets
```js
(() => {
  const sheets = [...document.styleSheets].map(s => {
    const el = s.ownerNode;
    let rules = 0; try { rules = s.cssRules.length; } catch {}
    return { id: el?.id || "(link)", tag: el?.tagName, rules };
  });
  return { url: location.href, mode: document.body.dataset.mode,
           theme: document.body.dataset.theme, sheets };
})()
```
Expected healthy output: `#_defaultStyles` **absent** and one `main.css` link with a
few hundred rules (our styles plus KaTeX's). In a note with diagrams, Mermaid adds a
`<style>` inside each SVG; that's expected.

### Read a computed color and find who painted it
```js
(() => {
  const pre = document.querySelector(".reading pre");
  const code = document.querySelector(".reading pre code, .reading code");
  const cs = el => el && getComputedStyle(el);
  return {
    preBg: cs(pre)?.backgroundColor,
    codeColor: cs(code)?.color,
    codeBg: cs(code)?.backgroundColor,
    bodyBg: cs(document.body)?.backgroundColor,
    styledSpans: document.querySelectorAll('pre code [style]').length,
  };
})()
```
In light mode `codeColor` should be the dark ink (`--rd-fg`), not a red/blue theme token;
`styledSpans` should be `0`.

### Detect translucent backgrounds (banned — see `theming.md`)
```js
[...document.querySelectorAll("*")].filter(el => {
  const bg = getComputedStyle(el).backgroundColor;
  const m = bg.match(/rgba?\(([^)]+)\)/); if (!m) return false;
  const parts = m[1].split(/[,/]/).map(s => parseFloat(s));
  const a = parts.length === 4 ? parts[3] : 1;
  return a > 0 && a < 1;
}).length   // must be 0
```

### Improved contrast scanner (light mode)
Walk text nodes, compute relative luminance of text vs. its effective background, and
report anything below ~4.5:1. Earlier run: 67 elements scanned, 0 low-contrast.

## 3. Reproducing outside VS Code

`happy-dom` (used by `webtest.mjs`) does **not** compute CSS, so appearance bugs cannot be
tested there. For visual checks, serve the real webview bundle in a browser:

```sh
npm run compile
node scripts/preview.mjs sample/README.md   # http://127.0.0.1:8321/?mode=dark&theme=2
```

Open it in a Chromium browser and run the snippets above. This reproduces
CSS/paint issues but **not** the actual webview's GPU compositing, so GPU-only artifacts
(see `history.md` §"gpu") must be verified in VS Code itself.

## 4. Verifying a packaged build

1. Install: `code.cmd --install-extension <vsix> --force`.
2. Compare hashes of installed vs. local `dist/webview/main.js` (see `development.md`).
3. **Developer: Reload Window**.
4. If behaviour still looks old after a matching hash and a reload, the window is stale or
   the wrong VSIX was installed — not a code bug.

## 5. Common false leads (do not repeat)

- **"The CSS is wrong" when the computed styles are right.** In the light-mode chip bug,
  computed styles were *correct* (`codeColor rgb(207,34,46)` = the intended light keyword
  red, transparent token bg) yet the chips on screen were dark. The cause was a *different*
  stylesheet (the host's) plus rendering/compositing, not our tokens. Trust the computed
  values, then look for **other** sheets and for paint-time effects.
- **A "fix didn't work" that was actually a stale install.** Always compare the installed file hash first.
- **A workbench-console dump.** See §1.
- **Chasing `!important` wars against the host sheet.** Layered host rules are easier to
  *remove* (we own the webview) than to win against. Prefer removal.
- **Non-project `style` groups in the workbench console** (two 32/14-rule groups seen in
  one dump) come from other extensions/theme injection; they are not in the webview and do
  not affect it.
