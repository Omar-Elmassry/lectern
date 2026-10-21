/**
 * GitHub-style heading slug that keeps letters and digits from every script
 * (Arabic, CJK, accented Latin, ...). Returns "" for punctuation-only text.
 */
export function slugify(text: string): string {
  return text
    .trim()
    .toLowerCase()
    .replace(/[^\p{L}\p{M}\p{N}\s_-]/gu, "")
    .replace(/[\s_-]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/** Plain text of rendered inline HTML, for slugs and labels. */
export function htmlToText(html: string): string {
  return html
    .replace(/<[^>]*>/g, "")
    .replace(/&(amp|lt|gt|quot|#39);/g, (_m, e: string) =>
      ({ amp: "&", lt: "<", gt: ">", quot: '"', "#39": "'" })[e] ?? ""
    );
}

export function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
