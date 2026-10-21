import * as esbuild from 'esbuild';
import { readFile } from 'fs/promises';
import { writeNotices } from './scripts/notices.mjs';

const production = process.argv.includes('--production');
const watch = process.argv.includes('--watch');

/** @type {import('esbuild').BuildOptions} */
const common = {
  bundle: true,
  minify: production,
  sourcemap: !production,
  sourcesContent: false,
  outdir: 'dist',
  outbase: 'src',
  logLevel: 'info',
  target: 'es2020',
  metafile: production,
};

// KaTeX lists woff2, woff and ttf for every face. Webviews always support woff2,
// so drop the fallbacks and ship only those files.
/** @type {import('esbuild').Plugin} */
const katexWoff2Only = {
  name: 'katex-woff2-only',
  setup(build) {
    build.onLoad({ filter: /katex[\\/]dist[\\/]katex\.min\.css$/ }, async (args) => {
      const css = await readFile(args.path, 'utf8');
      return {
        contents: css.replace(/,url\([^)]+\.(?:woff|ttf)\) format\("(?:woff|truetype)"\)/g, ''),
        loader: 'css',
        resolveDir: args.path.replace(/[\\/][^\\/]+$/, ''),
      };
    });
  },
};

/** @type {import('esbuild').BuildOptions} */
const webview = {
  ...common,
  platform: 'browser',
  format: 'iife',
  loader: { '.woff2': 'file' },
  assetNames: 'webview/fonts/[name]-[hash]',
  plugins: [katexWoff2Only],
};

/** @type {import('esbuild').BuildOptions[]} */
const builds = [
  // Extension host: Node, CommonJS, `vscode` provided at runtime.
  { ...common, entryPoints: ['src/extension.ts'], platform: 'node', format: 'cjs', external: ['vscode'] },
  // Webview: browser IIFE, so nothing (e.g. the acquireVsCodeApi handle) leaks to globals.
  { ...webview, entryPoints: ['src/webview/main.ts'] },
  // Mermaid is large; it gets its own bundle that main.ts loads on demand.
  { ...webview, entryPoints: ['src/webview/mermaid.ts'], sourcemap: false },
];

if (watch) {
  for (const options of builds) {
    const ctx = await esbuild.context(options);
    await ctx.watch();
  }
} else {
  const results = await Promise.all(builds.map((options) => esbuild.build(options)));
  if (production) {
    // Bundled dependencies keep their license notices with the shipped code.
    const pkgs = writeNotices(results.map((r) => r.metafile));
    console.log(`THIRD_PARTY_NOTICES.md: ${pkgs.length} packages`);
  }
}
