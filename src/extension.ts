import * as vscode from "vscode";
import { WikiResolver } from "./markdown/wiki";
import { ReaderEditorProvider } from "./readerProvider";

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
    vscode.commands.registerCommand("lectern.openSettings", () => {
      vscode.commands.executeCommand("workbench.action.openSettings", `@ext:${context.extension.id}`);
    })
  );
}

export function deactivate() {}
