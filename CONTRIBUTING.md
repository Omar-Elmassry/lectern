# Contributing to Lectern

Thanks for helping! Bug reports, ideas and pull requests are all welcome.

## Reporting a bug

Open an issue with the smallest bit of Markdown that shows the problem, a screenshot if
it's visual, and your Lectern, VS Code and OS versions.

## Building and running

You need Node 22+ and VS Code 1.82 or newer.

```sh
npm install
npm run typecheck   # TypeScript, no output
npm test            # renderer, math, emoji, wiki-link and settings tests
npm run compile     # bundles into dist/
```

Press **F5** in VS Code to launch an Extension Development Host with the `sample/`
folder open (`npm run watch` rebuilds on save). Open `sample/README.md` and press
`Ctrl+Alt+R`.

For UI work without restarting VS Code, `node scripts/preview.mjs` serves the real
reading view at <http://127.0.0.1:8321/?mode=dark&theme=2>.

Before opening a pull request, also run the two integration checks:

```sh
node scripts/webtest.mjs
node scripts/hosttest.mjs
```

## Things worth knowing

- **`package.json` is generated.** Edit `scripts/make-package.mjs` and run
  `node scripts/make-package.mjs`; direct edits are overwritten.
- **`THIRD_PARTY_NOTICES.md` is generated** by `node esbuild.mjs --production`. If you
  add or update a dependency, run it and commit the updated file.
- **Add a test with every renderer fix** (`test/*.test.mjs`). Most past bugs were
  invisible without one.
- **No translucent backgrounds or `backdrop-filter`** in the webview CSS; they cause
  GPU glitches in VS Code. See [docs/theming.md](docs/theming.md).
- After UI changes, regenerate the README images with `npm run screenshots` (the demo
  GIF also needs [ffmpeg](https://ffmpeg.org/) on your PATH).

The [docs/](docs/README.md) folder explains the architecture, theming and debugging in
more depth.

## Pull requests

Keep each pull request focused on one change, describe what and why, and add a line to
`CHANGELOG.md` under **Unreleased** if users will notice it. By contributing you agree
that your work is released under the [MIT License](LICENSE).
