import * as vscode from "vscode";
import * as path from "path";
import { promises as fsp } from "fs";
import type { WikiMaps } from "./render";

const NOTE_EXTS = ["", ".md", ".markdown", ".mdx"];

/**
 * Resolves `[[Name]]` / `![[file]]` targets to paths relative to the
 * document directory (POSIX style), Obsidian-like:
 *   1. relative to the current document,
 *   2. relative to the workspace folder root (vault-style `folder/Note`),
 *   3. anywhere in the workspace, preferring the shortest path.
 * Each step tries the name as-is, then with a markdown extension.
 *
 * Results are cached per (document dir, target) and dropped whenever files
 * are created, deleted or renamed, so typing does not rescan the workspace.
 */
export class WikiResolver implements vscode.Disposable {
  private readonly cache = new Map<string, Promise<string | null>>();
  private readonly subs: vscode.Disposable[] = [];

  constructor() {
    const watcher = vscode.workspace.createFileSystemWatcher("**/*", false, true, false);
    const clear = () => this.cache.clear();
    this.subs.push(
      watcher,
      watcher.onDidCreate(clear),
      watcher.onDidDelete(clear),
      vscode.workspace.onDidRenameFiles(clear)
    );
  }

  dispose(): void {
    this.subs.forEach((d) => d.dispose());
    this.cache.clear();
  }

  async resolveAll(docUri: vscode.Uri, links: string[], embeds: string[]): Promise<WikiMaps> {
    const out: WikiMaps = { links: {}, embeds: {} };
    const pending: Promise<void>[] = [];
    for (const name of new Set(links)) {
      pending.push(this.resolve(docUri, name).then((r) => void (out.links[name] = r)));
    }
    for (const name of new Set(embeds)) {
      pending.push(this.resolve(docUri, name).then((r) => void (out.embeds[name] = r)));
    }
    await Promise.all(pending);
    return out;
  }

  private resolve(docUri: vscode.Uri, name: string): Promise<string | null> {
    const docDir = path.dirname(docUri.fsPath);
    const key = `${docDir}\0${name}`;
    let hit = this.cache.get(key);
    if (!hit) {
      hit = lookup(docUri, docDir, name).catch(() => null);
      this.cache.set(key, hit);
    }
    return hit;
  }
}

async function lookup(docUri: vscode.Uri, docDir: string, name: string): Promise<string | null> {
  const clean = name.replace(/\\/g, "/").replace(/^\/+/, "");
  if (!clean) {
    return null;
  }
  const rel = (abs: string) => path.relative(docDir, abs).replace(/\\/g, "/");

  const local = await firstFile(path.join(docDir, clean));
  if (local) {
    return rel(local);
  }

  const root = vscode.workspace.getWorkspaceFolder(docUri)?.uri.fsPath;
  if (root) {
    const rooted = await firstFile(path.join(root, clean));
    if (rooted) {
      return rel(rooted);
    }
  }

  // Search by file name; a `folder/Note` target must match its path suffix.
  const base = path.posix.basename(clean);
  const globs = [`**/${escapeGlob(base)}`, `**/${escapeGlob(base)}.{md,markdown,mdx}`];
  for (const glob of globs) {
    const found = await vscode.workspace.findFiles(glob, "**/node_modules/**", 200);
    const matches = found
      .map((u) => u.fsPath)
      .filter(
        (p) =>
          !clean.includes("/") ||
          stripExt(p.replace(/\\/g, "/")).endsWith("/" + stripExt(clean))
      );
    if (matches.length > 0) {
      matches.sort((a, b) => rel(a).split("/").length - rel(b).split("/").length || a.length - b.length);
      return rel(matches[0]);
    }
  }
  return null;
}

async function firstFile(absNoExt: string): Promise<string | null> {
  for (const ext of NOTE_EXTS) {
    const candidate = absNoExt + ext;
    try {
      if ((await fsp.stat(candidate)).isFile()) {
        return candidate;
      }
    } catch {
      /* not found, try the next extension */
    }
  }
  return null;
}

function stripExt(p: string): string {
  return p.replace(/\.(md|markdown|mdx)$/i, "");
}

function escapeGlob(name: string): string {
  return name.replace(/[*?{}[\]]/g, "[$&]");
}
