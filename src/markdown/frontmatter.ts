import { escapeHtml } from "./util";

export type FrontMatterValue = string | string[];

export interface FrontMatter {
  entries: [string, FrontMatterValue][];
}

const FENCE = /^---[ \t]*\n([\s\S]*?)\n(?:---|\.\.\.)[ \t]*(?:\n|$)/;

/**
 * Split a leading YAML front matter block off the document. The block is
 * replaced with the same number of line breaks so source line numbers in
 * the body (used by task checkboxes) are unchanged.
 */
export function splitFrontMatter(src: string): { body: string; frontMatter: FrontMatter | null } {
  const m = FENCE.exec(src);
  if (!m) {
    return { body: src, frontMatter: null };
  }
  const lines = m[0].split("\n").length - 1;
  return {
    body: "\n".repeat(lines) + src.slice(m[0].length),
    frontMatter: parseYamlLite(m[1]),
  };
}

/**
 * The YAML subset notes actually use: `key: value`, `key: [a, b]` and
 * `key:` followed by `- item` lines. Anything more nested is kept as text.
 */
function parseYamlLite(yaml: string): FrontMatter {
  const entries: [string, FrontMatterValue][] = [];
  let current: [string, FrontMatterValue] | null = null;
  for (const line of yaml.split("\n")) {
    if (!line.trim() || line.trimStart().startsWith("#")) {
      continue;
    }
    const kv = /^([^\s:#][^:]*?):(?:\s+(.*))?$/.exec(line);
    if (kv && !/^\s/.test(line)) {
      current = [kv[1].trim(), parseScalarOrList(kv[2] ?? "")];
      entries.push(current);
      continue;
    }
    if (!current) {
      continue;
    }
    const item = /^\s*-\s+(.*)$/.exec(line);
    if (item) {
      const list = Array.isArray(current[1]) ? current[1] : current[1] ? [current[1]] : [];
      list.push(unquote(item[1]));
      current[1] = list;
    } else {
      const text = Array.isArray(current[1]) ? current[1].join(", ") : current[1];
      current[1] = `${text} ${line.trim()}`.trim();
    }
  }
  return { entries };
}

function parseScalarOrList(raw: string): FrontMatterValue {
  const v = raw.trim();
  if (v.startsWith("[") && v.endsWith("]")) {
    return v
      .slice(1, -1)
      .split(",")
      .map((s) => unquote(s))
      .filter(Boolean);
  }
  return unquote(v);
}

function unquote(s: string): string {
  const t = s.trim();
  return /^(["']).*\1$/.test(t) ? t.slice(1, -1) : t;
}

export function renderFrontMatter(fm: FrontMatter): string {
  if (fm.entries.length === 0) {
    return "";
  }
  const rows = fm.entries
    .map(([key, value]) => {
      const dd = Array.isArray(value)
        ? value.map((v) => `<span class="fm-chip">${escapeHtml(v)}</span>`).join(" ")
        : escapeHtml(value);
      return `<div class="fm-row"><dt>${escapeHtml(key)}</dt><dd>${dd}</dd></div>`;
    })
    .join("");
  return `<dl class="frontmatter" aria-label="Properties">${rows}</dl>\n`;
}
