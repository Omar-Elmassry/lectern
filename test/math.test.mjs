import { test } from "node:test";
import assert from "node:assert/strict";
import { render } from "./helpers.mjs";

const html = (md) => render(md).html;
const inline = (h) => (h.match(/<span class="math">/g) ?? []).length;
const display = (h) => (h.match(/class="math math-display"/g) ?? []).length;

test("inline math renders with KaTeX", () => {
  const h = html("Energy is $E = mc^2$ here.");
  assert.equal(inline(h), 1);
  assert.match(h, /class="katex"/);
  assert.match(h, /<math/); // MathML for screen readers
  assert.match(h, /^<p>Energy is /);
});

test("display math: $$ blocks, one-line $$ and ```math fences", () => {
  assert.equal(display(html("Before\n\n$$\n\\int_0^1 x\\,dx\n$$\n\nAfter")), 1);
  assert.equal(display(html("$$a^2 + b^2 = c^2$$")), 1);
  assert.equal(display(html("```math\n\\frac{1}{2}\n```")), 1);
  assert.match(html("```math\n\\frac{1}{2}\n```"), /katex-display/);
});

test("a $$ block can interrupt a paragraph", () => {
  const h = html("Here it comes:\n$$\nx = 1\n$$");
  assert.equal(display(h), 1);
  assert.match(h, /<p>Here it comes:<\/p>/);
});

test("prices and stray dollars stay text", () => {
  for (const md of [
    "It costs $5 and $10.",
    "Between $ 1 and 2 $ is not math",
    "A lone $ sign",
    "Pay $20, not $30",
  ]) {
    assert.equal(inline(html(md)), 0, md);
  }
  assert.match(html("It costs $5 and $10."), /It costs \$5 and \$10\./);
});

test("escaped dollars are literal", () => {
  const h = html("Price: \\$x\\$ and \\$5");
  assert.equal(inline(h), 0);
  assert.match(h, /Price: \$x\$ and \$5/);
});

test("math is not parsed inside code", () => {
  assert.equal(inline(html("Use `$x$` literally")), 0);
  assert.equal(inline(html("```js\nconst s = `$x$`;\n```")), 0);
  assert.equal(display(html("```\n$$x$$\n```")), 0);
});

test("invalid TeX shows the source with an error, not a crash", () => {
  const h = html("Broken: $\\frac{1$ here");
  assert.match(h, /class="math math-error"/);
  assert.match(h, /title="[^"]+"/);
  assert.match(h, /\$\\frac\{1\$/);
});

test("TeX cannot inject links or HTML", () => {
  const h = html("$\\href{javascript:alert(1)}{x}$ and $\\htmlId{evil}{x}$");
  // The source survives only as escaped annotation text; no link or id is created.
  assert.doesNotMatch(h, /href=/);
  assert.doesNotMatch(h, /id="evil"/);
});

test("formulas do not count as words", () => {
  assert.equal(render("Two words $a + b + c + d$").words, 2);
  assert.equal(render("One\n\n$$\nx + y + z\n$$").words, 1);
});

test("math in headings keeps a usable id and works in tables and callouts", () => {
  assert.match(html("## Area $\\pi r^2$"), /<h2 id="area[^"]*">/);
  assert.equal(inline(html("| a |\n|---|\n| $x$ |")), 1);
  assert.equal(inline(html("> [!note] Formula\n> Here $x^2$")), 1);
});

test("mermaid fences are left for the webview, escaped and not highlighted", () => {
  const h = html("```mermaid\ngraph TD\n  A-->B<script>\n```");
  assert.match(h, /<div class="mermaid-block"><pre class="mermaid-src">graph TD\n {2}A--&gt;B&lt;script&gt;\n?<\/pre><\/div>/);
  assert.doesNotMatch(h, /hljs/);
  assert.equal(render("Diagram:\n\n```mermaid\ngraph TD\n  A-->B\n```").words, 1);
});
