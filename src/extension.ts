import * as vscode from "vscode";
import { diskKey, reopenActiveWith } from "./diffPairing";
import { WikiResolver } from "./markdown/wiki";
import { ReaderEditorProvider } from "./readerProvider";

const MARKDOWN_GLOBS = ["*.md", "*.markdown", "*.mdx"];

export function activate(context: vscode.ExtensionContext) {
  const wiki = new WikiResolver();
  context.subscriptions.push(wiki);
  const provider = new ReaderEditorProvider(context.extensionUri, wiki);

  context.subscriptions.push(
    vscode.window.registerCustomEditorProvider("lectern.reader", provider, {
      webviewOptions: { enableFindWidget: true, retainContextWhenHidden: true },
      supportsMultipleEditorsPerDocument: false,
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand("lectern.open", async (uri?: vscode.Uri) => {
      // In a text diff, show the same diff in the reading view. The title-bar
      // button passes the file the diff is of, which for a commit diff is the
      // file on disk rather than either side, so compare files, not URIs.
      const input = vscode.window.tabGroups.activeTabGroup.activeTab?.input;
      const sameFile = (a: vscode.Uri, b: vscode.Uri) =>
        a.toString() === b.toString() || (diskKey(a) !== undefined && diskKey(a) === diskKey(b));
      if (
        input instanceof vscode.TabInputTextDiff &&
        (!uri || sameFile(uri, input.modified) || sameFile(uri, input.original))
      ) {
        await reopenActiveWith("lectern.reader");
        return;
      }
      const target = uri ?? vscode.window.activeTextEditor?.document.uri;
      if (!target) {
        vscode.window.showErrorMessage("Lectern: no markdown file is open.");
        return;
      }
      await vscode.commands.executeCommand(
        "vscode.openWith",
        target,
        "lectern.reader",
        vscode.ViewColumn.Active
      );
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand("lectern.openSource", async (uri?: vscode.Uri) => {
      // In a reading-view diff, go back to the text diff.
      if (provider.isDiffActive()) {
        await reopenActiveWith("default");
        return;
      }
      let target: vscode.Uri | undefined = uri;
      if (!target && vscode.window.tabGroups.activeTabGroup.activeTab) {
        const input = vscode.window.tabGroups.activeTabGroup.activeTab.input;
        if (input instanceof vscode.TabInputCustom) {
          target = input.uri;
        } else if (input instanceof vscode.TabInputText) {
          target = input.uri;
        }
      }
      if (!target) {
        vscode.window.showErrorMessage("Lectern: no markdown file is open.");
        return;
      }
      await vscode.commands.executeCommand(
        "vscode.openWith",
        target,
        "default",
        vscode.ViewColumn.Active
      );
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand("lectern.toggleDiffDefault", async () => {
      const cfg = vscode.workspace.getConfiguration("workbench");
      const current = cfg.inspect<Record<string, string>>("diffEditorAssociations")?.globalValue ?? {};
      const on = MARKDOWN_GLOBS.every((g) => current[g] === ReaderEditorProvider.viewType);
      const next = { ...current };
      for (const g of MARKDOWN_GLOBS) {
        if (on) {
          delete next[g];
        } else {
          next[g] = ReaderEditorProvider.viewType;
        }
      }
      try {
        await cfg.update("diffEditorAssociations", next, vscode.ConfigurationTarget.Global);
      } catch {
        // VS Code before `workbench.diffEditorAssociations` uses the normal
        // editor associations for diffs too.
        void vscode.window.showInformationMessage(
          'Lectern: this version of VS Code opens Markdown changes with the editor set in "workbench.editorAssociations".'
        );
        return;
      }
      void vscode.window.showInformationMessage(
        on
          ? "Lectern: Markdown changes open as a text diff again."
          : "Lectern: Markdown changes now open in the reading view. Run this command again to switch back."
      );
    })
  );

  // Keep the reading-diff context key in step with the active tab.
  context.subscriptions.push(
    vscode.window.tabGroups.onDidChangeTabs(() => provider.updateDiffContext()),
    vscode.window.tabGroups.onDidChangeTabGroups(() => provider.updateDiffContext())
  );

  context.subscriptions.push(
    vscode.commands.registerCommand("lectern.showMindMap", () => {
      if (!provider.showMindMap()) {
        void vscode.window.showInformationMessage("Lectern: open a note in the reading view to see its mind map.");
      }
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand("lectern.openSettings", () => {
      vscode.commands.executeCommand("workbench.action.openSettings", `@ext:${context.extension.id}`);
    })
  );

  // For the end-to-end tests only: which documents are paired, and as which side.
  if (process.env.LECTERN_TEST) {
    return { diffSides: () => provider.diffSidesForTests() };
  }
  return undefined;
}

export function deactivate() {}
