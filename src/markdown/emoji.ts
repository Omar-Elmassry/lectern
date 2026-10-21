import { nameToEmoji } from "gemoji";
import type { MarkedExtension } from "marked";
import { escapeHtml } from "./util";

/**
 * GitHub-style `:shortcode:` emoji (`:tada:`, `:+1:`, `:white_check_mark:`), using
 * GitHub's own list. Unknown codes stay as typed, so times like `10:30:45` and
 * text such as `:foo:` are left alone. Code spans and fences are never touched,
 * since marked does not run inline tokenizers inside them.
 */
const SHORTCODE_RE = /^:([a-z0-9_+-]+):/;

interface EmojiToken {
  type: "emoji";
  raw: string;
  name: string;
  emoji: string;
}

export function emojiFor(name: string): string | undefined {
  return Object.prototype.hasOwnProperty.call(nameToEmoji, name) ? nameToEmoji[name] : undefined;
}

export const emojiExtension: MarkedExtension = {
  extensions: [
    {
      name: "emoji",
      level: "inline",
      // Only stop at a real shortcode: cutting text at every ":" would split
      // bare URLs ("https://…") before the autolinker sees them.
      start(src: string) {
        const re = /:([a-z0-9_+-]+):/g;
        for (let m = re.exec(src); m; m = re.exec(src)) {
          if (emojiFor(m[1])) {
            return m.index;
          }
          re.lastIndex = m.index + 1;
        }
        return undefined;
      },
      tokenizer(src: string) {
        const m = SHORTCODE_RE.exec(src);
        const emoji = m ? emojiFor(m[1]) : undefined;
        if (!m || !emoji) {
          return undefined;
        }
        const token: EmojiToken = { type: "emoji", raw: m[0], name: m[1], emoji };
        return token;
      },
      renderer(token) {
        const { name, emoji } = token as unknown as EmojiToken;
        return `<span class="emoji" role="img" aria-label="${escapeHtml(name.replace(/_/g, " "))}" title=":${escapeHtml(name)}:">${emoji}</span>`;
      },
    },
  ],
};
