import { test } from "node:test";
import assert from "node:assert/strict";
import Module, { createRequire } from "module";
import { mkdtempSync, mkdirSync, writeFileSync, globSync } from "fs";
import { tmpdir } from "os";
import path from "path";

// A temp workspace:  root/{Home.md, notes/Journal.md, notes/deep/Journal.md, img/shot.png, docs/guide/page.md}
const root = mkdtempSync(path.join(tmpdir(), "lectern-wiki-"));
for (const f of ["Home.md", "notes/Journal.md", "notes/deep/Journal.md", "img/shot.png", "docs/guide/page.md"]) {
  mkdirSync(path.dirname(path.join(root, f)), { recursive: true });
  writeFileSync(path.join(root, f), "x");
}

const uri = (p) => ({ fsPath: p, path: p });
const vscodeStub = {
  workspace: {
    createFileSystemWatcher: () => ({ dispose() {}, onDidCreate: () => ({ dispose() {} }), onDidDelete: () => ({ dispose() {} }) }),
    onDidRenameFiles: () => ({ dispose() {} }),
    getWorkspaceFolder: () => ({ uri: uri(root) }),
    findFiles: async (glob) => {
      const expanded = glob.replace(/\{([^}]*)\}/, (_m, alts) => `@(${alts.split(",").join("|")})`);
      return globSync(expanded, { cwd: root }).map((p) => uri(path.join(root, p)));
    },
  },
};
const load = Module._load;
Module._load = function (req, ...rest) {
  return req === "vscode" ? vscodeStub : load.call(this, req, ...rest);
};
const { WikiResolver } = createRequire(import.meta.url)("../out/test/wiki.js");

const resolver = new WikiResolver();
const fromDoc = (doc, links, embeds = []) =>
  resolver.resolveAll(uri(path.join(root, doc)), links, embeds);

test("resolves sibling notes and folder-qualified links without extension", async () => {
  const { links } = await fromDoc("Home.md", ["notes/Journal", "notes/Journal.md", "Missing"]);
  assert.deepEqual(links, { "notes/Journal": "notes/Journal.md", "notes/Journal.md": "notes/Journal.md", Missing: null });
});

test("vault-root paths resolve from a nested document", async () => {
  const { links } = await fromDoc("docs/guide/page.md", ["notes/Journal", "Home"]);
  assert.deepEqual(links, { "notes/Journal": "../../notes/Journal.md", Home: "../../Home.md" });
});

test("bare names search the workspace and prefer the shortest path", async () => {
  const { links } = await fromDoc("docs/guide/page.md", ["Journal"]);
  assert.equal(links.Journal, "../../notes/Journal.md");
});

test("embeds with their own extension are found anywhere", async () => {
  const { embeds } = await fromDoc("notes/Journal.md", [], ["shot.png"]);
  assert.equal(embeds["shot.png"], "../img/shot.png");
});
