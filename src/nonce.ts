import { randomBytes } from "crypto";

/** A fresh CSP nonce for each webview document. */
export function getNonce(): string {
  return randomBytes(16).toString("base64");
}
