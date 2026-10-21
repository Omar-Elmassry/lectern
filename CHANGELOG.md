# Changelog

All notable changes to Lectern are listed here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project uses
[Semantic Versioning](https://semver.org/).

## [Unreleased]

## [1.0.0] - 2026-10-21

The first release of Lectern: a calm, distraction-free reading view for Markdown.

### Reading

- Opens `.md`, `.markdown` and `.mdx` files as a clean reading page in the same tab.
  `Ctrl+Alt+R` / `Cmd+Alt+R`, the book button in the editor title bar, or the Explorer
  menu switches to it; the same shortcut goes back to the source.
- Five palettes: Editor (follows your VS Code theme), Light, Sepia, Dark and Black, with
  High Contrast support.
- In-view settings panel for palette, font (Sans / Serif / Mono), text size, line width
  and line spacing, saved as regular `lectern.*` settings.
- Outline panel that tracks the current section, a reading-progress bar, and a word
  count with reading time.
- Live updates while you edit the source in a split editor.
- Requires VS Code 1.82 or newer.

### Markdown

- GitHub Flavored Markdown: tables, task lists, strikethrough, autolinks.
- Syntax-highlighted code blocks (35+ languages) with a language label and copy button.
- Obsidian callouts, including foldable ones (`[!tip]-` / `[!tip]+`), and GitHub alerts
  (`> [!WARNING]`).
- **Math** with KaTeX: `$inline$`, `$$display$$` and ```` ```math ```` blocks. Dollar
  amounts like "$5 and $10" stay text; `\$` is a literal dollar.
- **Mermaid diagrams** (```` ```mermaid ````), drawn in the reading palette and redrawn
  when it changes. Mermaid only loads for notes that contain a diagram.
- **Full-screen diagram viewer**: click a diagram to zoom (wheel, buttons, `+`/`-`),
  pan (drag, arrow keys), fit (`0`) and close (`Esc`).
- **Emoji shortcodes** (`:rocket:`, `:+1:`, …) from GitHub's list.
- YAML front matter shown as a properties block, with tags as chips.
- Click an image to view it full window.

### Notes and links

- Clickable task lists: ticking a box updates `[ ]` / `[x]` in the file.
- Wiki links and embeds: `[[Note]]`, `[[Note#Heading]]`, `[[Note|label]]`,
  `![[image.png|300]]`, videos and folder paths, resolved across the workspace. Missing
  notes get a dashed underline.
- Links to other Markdown files open in Lectern, at the `#heading` if there is one; web
  links open in the browser.

### Accessibility and safety

- Keyboard and screen-reader friendly panels and viewer, visible focus, and reduced
  motion when the OS asks for it.
- Scripts in Markdown never run, links can't trigger VS Code commands, and formulas and
  diagrams can't add links or scripts.

[Unreleased]: https://github.com/Omar-Elmassry/lectern/compare/v1.0.0...HEAD
[1.0.0]: https://github.com/Omar-Elmassry/lectern/releases/tag/v1.0.0
