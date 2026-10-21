// Bundles the markdown modules (vscode is stubbed by the tests) and runs the node:test suites in test/.
import * as esbuild from "esbuild";
import { spawnSync } from "child_process";

await esbuild.build({
  entryPoints: {
    render: "src/markdown/render.ts",
    util: "src/markdown/util.ts",
    wiki: "src/markdown/wiki.ts",
    settings: "src/settings.ts",
    math: "src/markdown/math.ts",
    emoji: "src/markdown/emoji.ts",
  },
  external: ["vscode"],
  bundle: true,
  format: "cjs",
  platform: "node",
  outdir: "out/test",
  logLevel: "error",
});

const res = spawnSync(process.execPath, ["--test", "test/*.test.mjs"], { stdio: "inherit" });
process.exit(res.status ?? 1);
