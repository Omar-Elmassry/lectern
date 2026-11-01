import * as vscode from "vscode";

/**
 * VS Code opens a diff in a custom editor as two separate editors, one per
 * side, and tells the extension nothing about the pair. The git extension's
 * side has a `git:` URI that names the file on disk, so two Lectern editors
 * for the same file that open together in the same editor group are the two
 * sides of one diff.
 */

/** Both sides of a diff open within this many milliseconds of each other. */
export const PAIR_WINDOW_MS = 3000;

interface GitParams {
  path: string;
  ref: string;
}

function gitParams(uri: vscode.Uri): GitParams | undefined {
  if (uri.scheme !== "git") {
    return undefined;
  }
  try {
    const q = JSON.parse(uri.query) as Partial<GitParams>;
    return typeof q.path === "string" ? { path: q.path, ref: typeof q.ref === "string" ? q.ref : "" } : undefined;
  } catch {
    return undefined;
  }
}

export function isGitUri(uri: vscode.Uri): boolean {
  return gitParams(uri) !== undefined;
}

/** The file on disk a document belongs to: itself, or the file a `git:` version is of. */
export function diskUri(uri: vscode.Uri): vscode.Uri {
  const git = gitParams(uri);
  return git ? vscode.Uri.file(git.path) : uri;
}

/** Comparable key for "same file", or undefined for documents not on disk. */
export function diskKey(uri: vscode.Uri): string | undefined {
  const disk = diskUri(uri);
  if (disk.scheme !== "file") {
    return undefined;
  }
  return process.platform === "win32" ? disk.fsPath.toLowerCase() : disk.fsPath;
}

/**
 * How "old" a version is: the lower one is the original side. Git's change
 * views compare HEAD with the index, or the index with the working tree.
 */
export function age(uri: vscode.Uri): number {
  const git = gitParams(uri);
  if (!git) {
    return 3; // the file itself
  }
  if (git.ref === "HEAD") {
    return 0;
  }
  if (git.ref === "~" || /^~\d$/.test(git.ref)) {
    return 1; // the index, shown as the old side of working-tree changes
  }
  if (git.ref === "") {
    return 2; // the index, shown as the new side of staged changes
  }
  return 1.5; // a commit
}

/** Short label for one side of a diff, e.g. "Before · Index". */
export function sideLabel(uri: vscode.Uri, side: "original" | "modified"): string {
  const git = gitParams(uri);
  let where = "Working tree";
  if (git) {
    if (git.ref === "HEAD") {
      where = "HEAD";
    } else if (git.ref === "" || git.ref.startsWith("~")) {
      where = "Index";
    } else {
      where = /^[0-9a-f]{40}$/i.test(git.ref) ? git.ref.slice(0, 7) : git.ref;
    }
  } else if (uri.scheme !== "file") {
    where = uri.scheme;
  }
  return `${side === "original" ? "Before" : "After"} · ${where}`;
}

/** The small part of the git extension's API that is used here. */
interface GitApi {
  getRepository(uri: vscode.Uri): { getCommit(ref: string): Promise<{ commitDate?: Date; authorDate?: Date }> } | null;
}

/** When the commit a `git:` version comes from was made, or undefined if unknown. */
export async function commitTime(uri: vscode.Uri): Promise<number | undefined> {
  const git = gitParams(uri);
  if (!git || !git.ref || git.ref.startsWith("~")) {
    return undefined; // the index, not a commit
  }
  try {
    const ext = vscode.extensions.getExtension<{ getAPI(v: 1): GitApi }>("vscode.git");
    if (!ext) {
      return undefined;
    }
    const api = (ext.isActive ? ext.exports : await ext.activate()).getAPI(1);
    const commit = await api.getRepository(vscode.Uri.file(git.path))?.getCommit(git.ref);
    return (commit?.commitDate ?? commit?.authorDate)?.getTime();
  } catch {
    return undefined;
  }
}

/** Reopen the active editor (or diff) with another editor, e.g. "default" for text. */
export async function reopenActiveWith(editorId: string): Promise<void> {
  try {
    await vscode.commands.executeCommand("reopenActiveEditorWith", editorId);
  } catch {
    // Older VS Code: let the user pick the editor.
    await vscode.commands.executeCommand("workbench.action.reopenWithEditor");
  }
}
