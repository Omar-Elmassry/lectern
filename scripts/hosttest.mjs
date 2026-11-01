import Module from "module";
import { createRequire } from "module";
import { fileURLToPath } from "url";
import { readFileSync } from "fs";

// ---- fake vscode module ----
const configStore = {};
const configSubs = [];
const posted = [];

class FakeUri {
  constructor(p, scheme = "file", query = "") { this.fsPath = p; this.path = p; this.scheme = scheme; this.query = query; }
  toString() { return `${this.scheme}:${this.path}${this.query ? "?" + this.query : ""}`; }
  static joinPath(base, ...parts) { return new FakeUri(require("path").posix.join(base.fsPath.replace(/\\/g, "/"), ...parts)); }
  static file(p) { return new FakeUri(p); }
  static parse(s) { return new FakeUri(s.replace(/^https?:\/\//, "")); }
  with(_c) { return this; }
}

const vscodeStub = {
  Uri: FakeUri,
  FileType: { File: 1 },
  ViewColumn: { Active: 1, Beside: 2, One: 1, Two: 2 },
  workspace: {
    get workspaceFolders() { return []; },
    getConfiguration: () => ({
      get: (k, d) => (k in configStore ? configStore[k] : d),
      update: (k, v, t) => {
        configStore[k] = v;
        // fire change event listeners (like VS Code does)
        for (const cb of configSubs) cb({ affectsConfiguration: (sec) => sec === "lectern" });
        return Promise.resolve();
      },
    }),
    onDidChangeTextDocument: () => ({ dispose() {} }),
    onDidChangeConfiguration: (cb) => { configSubs.push(cb); return { dispose() {} }; },
    workspaceFolder: null,
    getWorkspaceFolder: () => null,
    findFiles: async () => [],
    getWorkspaceFolder: () => undefined,
    onDidRenameFiles: () => ({ dispose() {} }),
    createFileSystemWatcher: () => ({ dispose() {}, onDidCreate: () => ({ dispose() {} }), onDidDelete: () => ({ dispose() {} }) }),
    applyEdit: async () => true,
    fs: { stat: async () => ({ type: 1 }) },
  },
  window: {
    activeColorTheme: { kind: 2 },
    onDidChangeActiveColorTheme: () => ({ dispose() {} }),
    activeTextEditor: undefined,
    tabGroups: {
      activeTabGroup: { activeTab: null },
      onDidChangeActiveTabGroup: () => ({ dispose() {} }),
      onDidChangeTabs: () => ({ dispose() {} }),
      onDidChangeTabGroups: () => ({ dispose() {} }),
    },
    showErrorMessage: (m) => console.error("VS CODE ERROR:", m),
    showInformationMessage: () => Promise.resolve(undefined),
    createStatusBarItem: () => ({
      text: "",
      tooltip: "",
      show() {},
      hide() {},
      dispose() {},
    }),
    onDidChangeActiveTextEditor: () => ({ dispose() {} }),
  },
  commands: {
    executeCommand: async (c, ...a) => console.log("[executeCommand]", c, ...a.map(String)),
    registerCommand: () => ({ dispose() {} }),
  },
  env: { openExternal: async () => true, language: "en" },
  extensions: { all: [] },
  l10n: { t: (s) => s },
  ThemeColor: class {},
  WorkspaceEdit: class {
    replace() {}
  },
  Selection: class {},
  Position: class {},
  Range: class {},
};

Module._load = (function (origLoad) {
  return function (request, parent, isMain) {
    if (request === "vscode") return vscodeStub;
    return origLoad.apply(this, arguments);
  };
})(Module._load);

const require = createRequire(import.meta.url);
const extPath = fileURLToPath(new URL("../dist/extension.js", import.meta.url));
const ext = require(extPath);

// ---- fake document / webview / panel ----
const document = {
  uri: new FakeUri("C:/fake/sample/README.md"),
  getText: () => "# Hello\n\n[[Journal]]\n\n- [ ] task\n",
  lineCount: 4,
  lineAt: (i) => ({ range: { get start() { return i; }, get end() { return i; } }, text: "- [ ] task" }),
};

const webviewSubs = [];
const webview = {
  cspSource: "https://*.vscode-cdn.net",
  options: null,
  html: "",
  postMessage: async (m) => posted.push(m),
  asWebviewUri: (u) => ({ toString: () => "https://f.webview.value/" + u.path }),
  onDidReceiveMessage: (cb) => { webviewSubs.push(cb); return { dispose() {} }; },
};

const panel = { webview, visible: true, reveal() {}, onDidDispose: () => ({ dispose() {} }), onDidChangeViewState: () => ({ dispose() {} }) };

const provider = {
  resolveCustomTextEditor: (doc, p2, tok) => {
    void doc, p2, tok;
  },
};
void provider;

// ResolveCustomTextEditorProvider is registered by activate() via registerCustomEditorProvider; call it directly:
const registered = [];
vscodeStub.window.registerCustomEditorProvider = (viewType, p) => { registered.push(p); return { dispose() {} }; };
vscodeStub.commands.registerCommand = (id) => { registered.push({ command: id }); return { dispose() {} }; };

vscodeStub.window.showInformationMessage = async () => undefined;
ext.activate({ extensionUri: new FakeUri("C:/fake/ext"), subscriptions: [], globalState: { get: () => undefined, update: async () => {} } });

const providerInstance = registered[0];
console.log("provider registered:", registered.length, "handlers; instance is provider:", providerInstance instanceof Object);

await providerInstance.resolveCustomTextEditor(document, panel, undefined);

console.log("initial html length:", panel.webview.html.length);
webviewSubs.forEach((cb) => cb({ type: "ready" }));
await new Promise((r) => setTimeout(r, 60)); // let async update finish

const firstUpdate = posted.find((p) => p.type === "update");
console.log("initial update delivered:", !!firstUpdate);
console.log("initial settings:", firstUpdate?.settings);
console.log("html contains script and css:", panel.webview.html.includes("main.js") && panel.webview.html.includes("main.css"));

// ---- simulate the webview sending setSetting ----
webviewSubs.forEach((cb) => cb({ type: "setSetting", key: "backgroundMode", value: "sepia" }));
await new Promise((r) => setTimeout(r, 80));

console.log("config after set:", configStore);
const lastUpdate = posted.filter((p) => p.type === "update").pop();
console.log("last settings after setSetting:", lastUpdate?.settings);
const roundTrip = lastUpdate?.settings.backgroundMode === "sepia";
console.log("ROUND TRIP OK:", roundTrip);

// ---- openLink scheme handling ----
const opened = [];
const warned = [];
vscodeStub.env.openExternal = async (u) => opened.push(String(u.fsPath ?? u));
vscodeStub.window.showWarningMessage = async (m) => warned.push(m);
vscodeStub.Uri.parse = (s) => new FakeUri(s);
for (const href of ["command:workbench.action.terminal.new", "vscode:extension/x.y", "mailto:a@b.c", "https://example.com", "bad%E0%A4%A.md"]) {
  webviewSubs.forEach((cb) => cb({ type: "openLink", href }));
}
await new Promise((r) => setTimeout(r, 30));
console.log("external opened:", opened);
console.log("blocked:", warned.length);
const schemes = warned.length === 2 && opened.length === 2 && opened.every((o) => /^(mailto|https):/.test(o));
console.log("LINK SCHEMES OK:", schemes);

// ---- a git diff opened in the reader: two panels, one per side ----
function fakeSide(uri, text) {
  const subs = [];
  const sent = [];
  const disposers = [];
  const doc = { uri, getText: () => text, lineCount: 1, lineAt: () => ({ range: {}, text: "" }) };
  const view = {
    cspSource: "x",
    options: null,
    html: "",
    postMessage: async (m) => sent.push(m),
    asWebviewUri: (u) => ({ toString: () => "https://f.webview.value/" + u.path }),
    onDidReceiveMessage: (cb) => { subs.push(cb); return { dispose() {} }; },
  };
  const p = {
    webview: view, visible: true, active: false, viewColumn: 1, reveal() {},
    onDidChangeViewState: () => ({ dispose() {} }),
    onDidDispose: (cb) => { disposers.push(cb); return { dispose() {} }; },
  };
  return { doc, panel: p, sent, send: (m) => subs.forEach((cb) => cb(m)), dispose: () => disposers.forEach((cb) => cb()) };
}
const filePath = "C:/fake/notes/a.md";
const gitSide = fakeSide(new FakeUri(filePath, "git", JSON.stringify({ path: filePath, ref: "~" })), "# A\n\nold words\n");
const fileSide = fakeSide(new FakeUri(filePath), "# A\n\nnew words\n");
await providerInstance.resolveCustomTextEditor(gitSide.doc, gitSide.panel, undefined);
await providerInstance.resolveCustomTextEditor(fileSide.doc, fileSide.panel, undefined);
gitSide.send({ type: "ready" });
fileSide.send({ type: "ready" });
await new Promise((r) => setTimeout(r, 60));
const lastOf = (side) => side.sent.filter((m) => m.type === "update").pop();
const before = lastOf(gitSide);
const after = lastOf(fileSide);
console.log("diff sides:", before?.diff?.label, "|", after?.diff?.label);
const paired =
  before?.diff?.side === "original" && before.diff.other === "# A\n\nnew words\n" && before.settings.readOnly === true &&
  after?.diff?.side === "modified" && after.diff.other === "# A\n\nold words\n" && after.settings.readOnly === false &&
  before.settings.docBase.endsWith("C:/fake/notes"); // images resolve next to the real file

fileSide.send({ type: "diffScroll", id: "3", frac: 0.25 });
const relayed = gitSide.sent.find((m) => m.type === "diffScroll");
const scrollOk = relayed?.id === "3" && relayed.frac === 0.25;

gitSide.dispose(); // closing the diff: the other side becomes a normal reader
await new Promise((r) => setTimeout(r, 60));
const unpaired = lastOf(fileSide)?.diff === undefined;
console.log("DIFF PAIRING OK:", paired, "scroll relay:", scrollOk, "unpaired:", unpaired);
if (!roundTrip || !schemes || !paired || !scrollOk || !unpaired) process.exitCode = 1;
