# Design history

How Lectern got to 1.0.0, and why some of its rules exist. Before the first release it was
a private extension called **Reader** (`reader-md`, settings `readerMd.*`); the
pre-release build names below (`0.1.1-…`) come from that period.

## Per-mode theming

Each `backgroundMode` (`editor`, `light`, `sepia`, `dark`, `black`) defines a *complete*
`--rd-*` token set, so no palette can half-inherit another's colors. "Restore defaults"
sets every `lectern.*` key to `undefined`, which removes the user's override instead of
writing a literal default.

## The light-mode "dark chip" bug

In the Light palette, inline code and code blocks showed up as dark, unreadable chips. It
took several builds to find the cause:

| Build | Change | Outcome |
| --- | --- | --- |
| `0.1.1-fix` | Assorted fixes, plus a visible build stamp so "did the new build load?" stopped being guesswork | Chips persisted |
| `0.1.1-gpu` | Removed every `backdrop-filter` and translucent background (GPU compositing hypothesis), using opaque `color-mix(…, var(--rd-bg))` instead | Chips persisted |
| `0.1.1-armor` | Code "armor": clear inherited painting inside code with `!important`, then re-apply our colors | Code blocks fixed; inline code color still wrong |
| `0.1.1-hoststrip` | Remove VS Code's injected `#_defaultStyles` sheet and own every color it used to set | **Fixed** |

Two lessons from this period are now rules:

- **The real culprit was VS Code's default webview stylesheet**, a layered sheet that styles
  `code`, links, `kbd`, `blockquote` and `body` with editor-theme colors. `theming.md`
  explains the fix and how to check it still works.
- **A long detour came from reading the wrong console.** Computed styles looked correct
  because they were taken in the workbench DevTools, not the webview's. `debugging.md` §1
  explains how to tell them apart.

The no-translucency and no-`backdrop-filter` rules stayed even though they weren't the
root cause: they removed a class of GPU artifacts and cost nothing.

## Review and UI/UX audit

Before release, a code review and an audit in a real browser fixed, each with a test:

- **Correctness:** task checkboxes mapped to the wrong source line (inside quotes, CRLF
  files); GitHub alerts lost their type and first line; wiki links were rewritten inside
  code; non-Latin headings got empty ids; image paths were encoded twice; the reader
  ignored theme changes; the outline wasn't indented by level.
- **Security:** `script-src` limited to a per-document nonce; `command:` and `vscode:` links
  blocked; the webview bundled as an IIFE so nothing leaks to page globals.
- **UI/UX:** task checkboxes were rendered `disabled` and could never be clicked (Chromium
  drops clicks on disabled controls, and happy-dom doesn't model that, so only a real
  browser caught it); panels became keyboard-friendly and `inert` when closed; front
  matter, image lightbox, ghost links for missing notes, empty-note state, High Contrast
  borders and narrow-pane layout were added.
- The build stamp was retired; installs are verified by file hash (`development.md`).

## Toward 1.0.0

- Renamed to **Lectern**, with a new icon, `lectern.*` ids, and `Ctrl+Alt+R` instead of
  `Ctrl+Shift+R` (VS Code's Refactor key).
- Added math (KaTeX), Mermaid diagrams with a full-screen viewer, and emoji shortcodes.
- Raised the minimum VS Code to 1.82: the stylesheet relies on `color-mix()`, which needs
  Chromium 111+, and 1.80–1.81 ship Chromium 108.

## Known limitations

- Removing the host sheet depends on its id, `#_defaultStyles`; a rename in a future VS Code
  would silently bring the old colors back (`theming.md` has the check).
- Appearance can't be tested headlessly (happy-dom has no CSS engine); use
  `scripts/preview.mjs` in Chromium or a real webview.
