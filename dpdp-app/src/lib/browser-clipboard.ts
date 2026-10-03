import type { ClipboardDeps } from "./copy-prompt"

// The browser's clipboard, in the shape copy-prompt.ts takes (kept apart from it: that file has no DOM so `bun test` covers it).
export function browserClipboard(): ClipboardDeps {
  return {
    writeText: typeof navigator !== "undefined" && navigator.clipboard?.writeText ? (t) => navigator.clipboard.writeText(t) : undefined,
    legacyCopy: (t) => {
      const ta = document.createElement("textarea")
      ta.value = t
      ta.setAttribute("readonly", "")
      ta.style.position = "fixed"
      ta.style.opacity = "0"
      document.body.appendChild(ta)
      ta.select()
      try { return document.execCommand("copy") } finally { document.body.removeChild(ta) }
    },
  }
}
