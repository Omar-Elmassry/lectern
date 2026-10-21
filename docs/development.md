# Development

## Prerequisites

- Node 22+ for the tooling (`npm test` uses `node:test`, `screenshots` uses the built-in
  `WebSocket`; CI runs Node 22). The extension itself targets VS Code `^1.82`, whose
  extension host is Node 18, so `@types/node` stays at 18 and `@types/vscode` at `~1.82`
  (vsce rejects types newer than `engines.vscode`).
- The `code` CLI on PATH (on macOS: Command Palette > *Shell Command: Install 'code'
  command in PATH*; the Windows and Linux installers add it).

## The core loop

```sh
# 1. typecheck (no emit) and unit tests
npm run typecheck
npm test

# 2. bundle host + webview into dist/
npm run compile             # node esbuild.mjs; --production minifies

# 3. integration harnesses (need dist/; see below)
node scripts/webtest.mjs
node scripts/hosttest.mjs

# 4. regenerate package.json from the template, then package
#    (vscode:prepublish rebuilds dist/ minified, so the VSIX is never stale)
node scripts/make-package.mjs
npx --yes @vscode/vsce package -o lectern.vsix

# 5. install into your VS Code
code --install-extension lectern.vsix --force
```

For interactive work press **F5**: `.vscode/launch.json` starts `npm run watch` and opens
`sample/` in an Extension Development Host. `npm run watch` plus `npm run open` does the
same from a terminal.

## Non-obvious gotchas

### `package.json` is generated
`scripts/make-package.mjs` **overwrites** `package.json` from a JS template. If you edit
`package.json` directly (version, menus, deps, `when` clauses), the next `make-package`
run silently reverts it. Always edit the template, then run the script. `package.json`
and `package-lock.json` are committed; keep them in sync with the template. Settings
must also match `src/settings.ts` (`npm test` checks this).

### Dependencies
Runtime libraries (`marked`, `marked-highlight`, `highlight.js`, `katex`, `mermaid`,
`gemoji`) are bundled by esbuild; `node_modules/` is never shipped. Keep them in
`dependencies` anyway so the manifest says what the extension contains, and keep
test-only tools (`happy-dom`, `esbuild`, `typescript`) in `devDependencies` in the
**template**, or `npm prune` removes them. `marked` is pinned to `^13` on purpose (the
renderer API changed in 14); after editing the template run `npm install` and check
`npm ls marked --depth=0` reports `13.x`.

### `THIRD_PARTY_NOTICES.md` is generated
Bundling copies third-party code into the VSIX, and its licenses (MIT, BSD, ISC,
Apache-2.0, EPL-2.0, …) require their notices to ship with it. `node esbuild.mjs
--production` (which `vsce package` runs) reads esbuild's metafile and rewrites
`THIRD_PARTY_NOTICES.md` with every bundled package, its license text and a source link
(`scripts/notices.mjs`). Commit the result after changing dependencies; CI fails if the
committed file is out of date.

### Tests
- `npm test` (`scripts/test.mjs`) bundles `render.ts`, `util.ts`, `wiki.ts`,
  `settings.ts`, `math.ts` and `emoji.ts` into `out/test/` and runs `test/*.test.mjs` with
  `node:test`. The wiki
  resolver suite stubs `vscode` and uses a real temp folder. Add a test with every
  renderer fix; most bugs fixed so far were invisible without one.
- `scripts/webtest.mjs` — happy-dom. Stubs `acquireVsCodeApi`, loads the built webview
  bundle, drives DOM events, asserts on captured `postMessage` payloads. **happy-dom
  neither computes CSS nor models disabled-control click suppression** (that hid the
  "checkboxes cannot be clicked" bug), so verify interaction in a real browser too.
- `scripts/hosttest.mjs` — stubs a fake `vscode` module via `Module._load`, exercises
  `ReaderEditorProvider` end to end (`ROUND TRIP OK`, `LINK SCHEMES OK`).
- `scripts/preview.mjs [file.md] [port]` — serves the real webview bundle with stubbed
  theme variables at `http://127.0.0.1:8321/?mode=<mode>&theme=<1-4>` for visual and
  keyboard checks in Chromium. Posted messages are recorded in `window.__posted`.

### Bundling
`esbuild.mjs` runs three builds with `outbase: "src"`: the host (`dist/extension.js`,
Node CJS, `vscode` external), the webview (`dist/webview/main.js` + `main.css`, browser
IIFE so nothing leaks to page globals) and Mermaid (`dist/webview/mermaid.js`, loaded on
demand). A small plugin strips the woff/ttf fallbacks from KaTeX's CSS so only the woff2
fonts (`dist/webview/fonts/`) ship. Target `es2020`, no `sourcesContent`.

`scripts/preview.mjs` applies the same Content-Security-Policy as the real webview, so a
dependency that needs `eval` or inline scripts fails in the browser preview too.

### `.vscodeignore`
Ship list is controlled here. Sources, scripts, tests, docs, the sample, source maps,
`node_modules/`, `.github/`, `CONTRIBUTING.md`, `images/icon.svg` and
`images/screenshots/` are excluded, so the VSIX contains only `dist/**`,
`images/icon.png`, `package.json`, `README.md`, `CHANGELOG.md`, `LICENSE` and
`THIRD_PARTY_NOTICES.md` (about
1.9 MB, mostly `mermaid.js`). `npx @vscode/vsce ls` prints the list. README images are
not shipped: vsce rewrites their relative paths to the GitHub repository.

### Verifying the install actually changed
An install that "did nothing" is almost always a stale VSIX or the window not reloaded.
Confirm the installed bytes match the build:

```powershell
$dir = "$env:USERPROFILE\.vscode\extensions\omarelmasry.lectern-1.0.0"
(Get-FileHash "$dir\dist\webview\main.js").Hash -eq (Get-FileHash "dist\webview\main.js").Hash
```

Then in VS Code: **Developer: Reload Window**.

### Screenshots
`npm run screenshots` rebuilds and regenerates the README images from
`sample/README.md`: framed PNG stills and `demo.gif`, a scripted walkthrough with a drawn
cursor (headless Chrome/Edge over the DevTools protocol; frames are encoded with ffmpeg).
Set `CHROME` / `FFMPEG` if they are not found; without ffmpeg only the stills are made.
`node scripts/screenshots.mjs --gif-only` re-records just the GIF, `--stills-only` skips
it. The stills are the `stills` / `tiles` lists and the GIF storyboard is `recordDemo()`. Run it after visible UI changes so the README stays accurate.

### Releasing
1. Move the **Unreleased** notes in `CHANGELOG.md` under the new version.
2. Bump `version` in `scripts/make-package.mjs`, run it, then `npm install` to sync the
   lockfile.
3. Commit and push, then tag and push the tag:
   `git tag -a vX.Y.Z -m "Lectern X.Y.Z" && git push origin vX.Y.Z`.
4. The tag starts `.github/workflows/release.yml`:
   - **verify** fails unless the tag matches `version` in `package.json` and
     `CHANGELOG.md` has a `## [X.Y.Z]` section;
   - **checks** runs `ci.yml` (it is a reusable workflow), which builds the VSIX;
   - **publish** takes that VSIX as `lectern-X.Y.Z.vsix` and publishes it to GitHub
     Releases (with the changelog section as notes), the VS Code Marketplace and Open
     VSX. Every step skips work already done, so a failed run can simply be re-run.

The store steps need two repository secrets (**Settings > Secrets and variables >
Actions**, or `gh secret set NAME`):

| Secret | Token |
| --- | --- |
| `VSCE_PAT` | Azure DevOps personal access token, organization *All accessible organizations*, scope **Marketplace > Manage** |
| `OVSX_PAT` | Open VSX access token (open-vsx.org > Settings > Access Tokens) |

Both tokens expire; when one does, the matching step fails with an authentication
error. Create a new token, update the secret and re-run the failed job. To publish by
hand instead: `npx @vscode/vsce publish --packagePath lectern-X.Y.Z.vsix` and
`npx ovsx publish lectern-X.Y.Z.vsix`.
