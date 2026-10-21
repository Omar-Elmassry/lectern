import * as vscode from "vscode";
import { ReaderSettings, WikiMaps } from "./markdown/render";
import { WikiResolver } from "./markdown/wiki";
import { getNonce } from "./nonce";
import {
  PREF_DEFAULTS,
  PREF_KEYS,
  isPrefKey,
  sanitizePref,
  type PrefKey,
  type ReaderPrefs,
} from "./settings";

export class ReaderEditorProvider implements vscode.CustomTextEditorProvider {
  public static readonly viewType = "lectern.reader";

  /** Open reader panels by document URI, for reusing them on link clicks. */
  private readonly panels = new Map<string, vscode.WebviewPanel>();
  /** `note.md#heading` targets waiting for their new panel's first render. */
  private readonly pendingAnchors = new Map<string, string>();

  constructor(
    private readonly extensionUri: vscode.Uri,
    private readonly wiki: WikiResolver
  ) {}

  resolveCustomTextEditor(
    document: vscode.TextDocument,
    webviewPanel: vscode.WebviewPanel,
    _token: vscode.CancellationToken
  ): void {
    const docDir = vscode.Uri.joinPath(document.uri, "..");
    const roots = new Set<string>([this.extensionUri.toString(), docDir.toString()]);
    for (const f of vscode.workspace.workspaceFolders ?? []) {
      roots.add(f.uri.toString());
    }
    webviewPanel.webview.options = {
      enableScripts: true,
      localResourceRoots: [...roots].map((r) => vscode.Uri.parse(r)),
    };

    webviewPanel.webview.html = this.getHtml(webviewPanel.webview);

    // The first render is triggered by the webview's "ready" message, which
    // guarantees its message listener exists.
    const update = this.makeUpdater(document, webviewPanel);

    // Coalesce keystrokes: re-rendering a long note on every character
    // makes typing in a side-by-side source editor lag.
    let timer: ReturnType<typeof setTimeout> | undefined;
    const updateSoon = () => {
      clearTimeout(timer);
      timer = setTimeout(() => void update(), 150);
    };

    const subs: vscode.Disposable[] = [
      vscode.workspace.onDidChangeTextDocument((e) => {
        if (e.document.uri.toString() === document.uri.toString() && e.contentChanges.length > 0) {
          updateSoon();
        }
      }),
      vscode.workspace.onDidChangeConfiguration((e) => {
        if (e.affectsConfiguration("lectern")) {
          void update();
        }
      }),
      // "Editor" mode follows the theme's light/dark kind.
      vscode.window.onDidChangeActiveColorTheme(() => void update()),
    ];
    const key = document.uri.toString();
    this.panels.set(key, webviewPanel);
    webviewPanel.onDidDispose(() => {
      clearTimeout(timer);
      subs.forEach((d) => d.dispose());
      if (this.panels.get(key) === webviewPanel) {
        this.panels.delete(key);
      }
    });

    webviewPanel.webview.onDidReceiveMessage((msg) => {
      switch (msg && msg.type) {
        case "ready":
          void update().then(() => {
            const anchor = this.pendingAnchors.get(key);
            if (anchor) {
              this.pendingAnchors.delete(key);
              void webviewPanel.webview.postMessage({ type: "scrollTo", anchor });
            }
          });
          break;
        case "toggleTask":
          // The webview already shows the new state; if the edit does not
          // happen, re-send the document so the checkbox snaps back.
          void this.setTask(document, Number(msg.line), msg.checked === true).then((edited) => {
            if (!edited) {
              void update();
            }
          });
          break;
        case "openLink":
          void this.openLink(document, String(msg.href ?? ""));
          break;
        case "setSetting":
          this.setReaderSetting(String(msg.key ?? ""), msg.value)
            .then(() => void update())
            .catch((err: unknown) =>
              void vscode.window.showErrorMessage(
                `Lectern: could not apply setting - ${String(err)}`
              )
            );
          break;
        case "resetSettings":
          this.resetReaderSettings()
            .then(() => void update())
            .catch((err: unknown) =>
              void vscode.window.showErrorMessage(
                `Lectern: could not reset settings - ${String(err)}`
              )
            );
          break;
        default:
          break;
      }
    });
  }

  private getHtml(webview: vscode.Webview): string {
    const jsUri = webview
      .asWebviewUri(vscode.Uri.joinPath(this.extensionUri, "dist", "webview", "main.js"))
      .toString();
    const cssUri = webview
      .asWebviewUri(vscode.Uri.joinPath(this.extensionUri, "dist", "webview", "main.css"))
      .toString();
    const mermaidUri = webview
      .asWebviewUri(vscode.Uri.joinPath(this.extensionUri, "dist", "webview", "mermaid.js"))
      .toString();
    const nonce = getNonce();
    return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src ${webview.cspSource} data: https: http:; media-src ${webview.cspSource} data: https: http:; style-src ${webview.cspSource} 'unsafe-inline'; font-src ${webview.cspSource} data:; script-src 'nonce-${nonce}'; base-uri 'none'; form-action 'none';">
<meta name="lectern-mermaid" content="${mermaidUri}">
<link rel="stylesheet" href="${cssUri}">
</head>
<body>
<div id="root"></div>
<script nonce="${nonce}" src="${jsUri}"></script>
</body>
</html>`;
  }

  private async setReaderSetting(key: string, value: unknown): Promise<void> {
    if (!isPrefKey(key)) {
      return;
    }
    const clean = sanitizePref(key, value);
    if (clean !== undefined) {
      await vscode.workspace.getConfiguration("lectern").update(key, clean, true);
    }
  }

  private async resetReaderSettings(): Promise<void> {
    const cfg = vscode.workspace.getConfiguration("lectern");
    for (const key of PREF_KEYS) {
      // `undefined` removes the user override and restores the default value.
      await cfg.update(key, undefined, true);
    }
  }

  private makeUpdater(
    document: vscode.TextDocument,
    webviewPanel: vscode.WebviewPanel
  ): () => Promise<void> {
    let inFlight = 0;
    return async () => {
      const ticket = ++inFlight;
      const settings = await this.collectSettings(document, webviewPanel);
      if (ticket !== inFlight) {
        return; // a newer update is pending
      }
      void webviewPanel.webview.postMessage({
        type: "update",
        content: document.getText(),
        settings,
      });
    };
  }

  private async collectSettings(
    document: vscode.TextDocument,
    webviewPanel: vscode.WebviewPanel
  ): Promise<ReaderSettings> {
    const cfg = vscode.workspace.getConfiguration("lectern");
    const docDir = vscode.Uri.joinPath(document.uri, "..");
    const docBase = webviewPanel.webview.asWebviewUri(docDir).toString();
    const folder = vscode.workspace.getWorkspaceFolder(document.uri);
    const rootBase = folder ? webviewPanel.webview.asWebviewUri(folder.uri).toString() : undefined;
    const text = document.getText();

    // Same shape the renderer's wikilink tokenizer accepts (no line breaks).
    const linkTargets = collect(text, /(?<!!)\[\[([^\][|#\n]+)(?:#[^\][|\n]*)?(?:\|[^\][\n]+)?\]\]/g, 1);
    const embedTargets = collect(text, /!\[\[([^\][|#\n]+)(?:#[^\][|\n]*)?(?:\|[^\][\n]+)?\]\]/g, 1);

    let wiki: WikiMaps = { links: {}, embeds: {} };
    try {
      wiki = await this.wiki.resolveAll(document.uri, linkTargets, embedTargets);
    } catch {
      /* keep empty maps */
    }

    return {
      ...readPrefs(cfg),
      themeKind: vscode.window.activeColorTheme.kind,
      docBase,
      rootBase,
      wiki: wiki.links,
      embeds: wiki.embeds,
    };
  }

  /**
   * Set the task on `line` to `checked`. Resolves false when nothing was
   * edited (stale line number, already in that state, edit rejected).
   */
  private async setTask(document: vscode.TextDocument, line: number, checked: boolean): Promise<boolean> {
    if (!Number.isInteger(line) || line < 0 || line >= document.lineCount) {
      return false;
    }
    const textLine = document.lineAt(line);
    const newText = textLine.text.replace(
      /^((?:\s*>)*\s*(?:[-*+]|\d+[.)])\s+\[)([ xX])(\])/,
      (_m, a: string, _c: string, b: string) => a + (checked ? "x" : " ") + b
    );
    if (newText === textLine.text) {
      return false;
    }
    const edit = new vscode.WorkspaceEdit();
    edit.replace(document.uri, textLine.range, newText);
    return vscode.workspace.applyEdit(edit);
  }

  private async openLink(document: vscode.TextDocument, href: string): Promise<void> {
    if (!href) {
      return;
    }
    const scheme = /^([a-z][a-z\d+\-.]*):/i.exec(href)?.[1].toLowerCase();
    // One letter is a Windows drive (C:/...), not a scheme.
    if (scheme && scheme.length > 1 && scheme !== "file") {
      // Only hand safe schemes to the OS; `command:` / `vscode:` URIs from a
      // document must never run.
      if (EXTERNAL_SCHEMES.has(scheme)) {
        void vscode.env.openExternal(vscode.Uri.parse(href, true));
      } else {
        void vscode.window.showWarningMessage(`Lectern: blocked link with "${scheme}:" scheme.`);
      }
      return;
    }

    const hashAt = href.indexOf("#");
    const pathPart = hashAt >= 0 ? href.slice(0, hashAt) : href;
    const fragment = hashAt >= 0 ? safeDecode(href.slice(hashAt + 1)) : "";
    if (!pathPart) {
      return;
    }

    let target: vscode.Uri;
    if (scheme === "file") {
      target = vscode.Uri.parse(pathPart, true);
    } else {
      const decoded = safeDecode(pathPart).replace(/\\/g, "/");
      const root = vscode.workspace.getWorkspaceFolder(document.uri)?.uri;
      if (/^[A-Za-z]:\//.test(decoded)) {
        target = vscode.Uri.file(decoded);
      } else if (decoded.startsWith("/") && root) {
        // Workspace-root relative (Obsidian / GitHub style).
        target = vscode.Uri.joinPath(root, decoded);
      } else {
        target = vscode.Uri.joinPath(document.uri, "..", decoded);
      }
    }
    await this.openTarget(target, fragment);
  }

  private async openTarget(uri: vscode.Uri, fragment: string): Promise<void> {
    try {
      await vscode.workspace.fs.stat(uri);
    } catch {
      void vscode.window.showErrorMessage(`Lectern: file not found: "${uri.path}"`);
      return;
    }
    if (!MARKDOWN_FILE.test(uri.path)) {
      await vscode.commands.executeCommand("vscode.open", uri, vscode.ViewColumn.Beside);
      return;
    }
    const key = uri.toString();
    const open = this.panels.get(key);
    if (open) {
      open.reveal(open.viewColumn);
      if (fragment) {
        void open.webview.postMessage({ type: "scrollTo", anchor: fragment });
      }
      return;
    }
    if (fragment) {
      this.pendingAnchors.set(key, fragment);
    }
    await vscode.commands.executeCommand(
      "vscode.openWith",
      uri,
      ReaderEditorProvider.viewType,
      vscode.ViewColumn.Active
    );
  }
}

const EXTERNAL_SCHEMES = new Set(["http", "https", "mailto", "tel", "ftp", "ftps"]);
const MARKDOWN_FILE = /\.(md|markdown|mdx)$/i;

function safeDecode(text: string): string {
  try {
    return decodeURIComponent(text);
  } catch {
    return text;
  }
}

/** User settings, validated: settings.json can hold anything. */
function readPrefs(cfg: vscode.WorkspaceConfiguration): ReaderPrefs {
  const prefs = { ...PREF_DEFAULTS };
  for (const key of PREF_KEYS) {
    const value = sanitizePref(key, cfg.get(key));
    if (value !== undefined) {
      (prefs as Record<PrefKey, unknown>)[key] = value;
    }
  }
  return prefs;
}

function collect(src: string, re: RegExp, group: number): string[] {
  const out = new Set<string>();
  let m: RegExpExecArray | null;
  const rx = new RegExp(re.source, re.flags);
  while ((m = rx.exec(src)) !== null) {
    if (m[group] !== undefined) {
      out.add(m[group].trim());
    }
  }
  return [...out];
}
