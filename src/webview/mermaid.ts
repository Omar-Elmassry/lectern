// Separate bundle (dist/webview/mermaid.js), loaded by main.ts only when a
// document contains a ```mermaid block, so plain notes never pay for it.
import mermaid from "mermaid";

declare global {
  interface Window {
    lecternMermaid?: typeof mermaid;
  }
}

window.lecternMermaid = mermaid;
window.dispatchEvent(new Event("lectern-mermaid-ready"));
