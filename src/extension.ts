import * as vscode from "vscode";
import { reopenActiveWith } from "./diffPairing";
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
      // In a text diff, show the same diff in the reading view.
      const input = vscode.window.tabGroups.activeTabGroup.activeTab?.input;
      if (
        input instanceof vscode.TabInputTextDiff &&
        (!uri || uri.toString() === input.modified.toString() || uri.toString() === input.original.toString())
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
      if (!uri && provider.isDiffActive()) {
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

  context.subscriptions.push(
    vscode.commands.registerCommand("lectern.openSettings", () => {
      vscode.commands.executeCommand("workbench.action.openSettings", `@ext:${context.extension.id}`);
    })
  );
}

export function deactivate() {}
