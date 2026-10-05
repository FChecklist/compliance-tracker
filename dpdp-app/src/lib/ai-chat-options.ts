// The AI Link page's "open it in your AI" buttons (owner, 2026-10-05). The signed-in page shows the short paste (two lines and the link); these
// buttons take it to an AI chat. Three sites accept the prompt in the address (?q=), so the button opens them with the paste already in the box.
// The other three do not (Gemini ignored ?q when signed out; DeepSeek and z.ai ignore it), so their buttons COPY the paste first and then open the
// site, and the page says "Copied. Press Ctrl+V, then Send". These are other companies' websites and may change how their addresses work at any time.
// PURE: no DOM, no globals; src/lib/ai-chat-options.test.ts pins every address.

export type ChatOption = {
  id: "chatgpt" | "grok" | "claude" | "gemini" | "deepseek" | "zai"
  label: string
  /** "open": the address carries the paste. "copy-open": copy first, then open the site; the person pastes. */
  kind: "open" | "copy-open"
  href: string
}

export const THIRD_PARTY_NOTE = "These buttons open other companies' websites, which can change how their links work at any time. If a button does not fill the box, use Copy and paste it yourself."

export function chatOptions(paste: string): ChatOption[] {
  const q = encodeURIComponent(paste)
  return [
    { id: "chatgpt", label: "Open in ChatGPT", kind: "open", href: `https://chatgpt.com/?q=${q}` },
    { id: "grok", label: "Open in Grok", kind: "open", href: `https://grok.com/?q=${q}` },
    { id: "claude", label: "Open in Claude", kind: "open", href: `https://claude.ai/new?q=${q}` },
    { id: "gemini", label: "Copy, then open Gemini", kind: "copy-open", href: `https://gemini.google.com/app?q=${q}` },
    { id: "deepseek", label: "Copy, then open DeepSeek", kind: "copy-open", href: "https://chat.deepseek.com/" },
    { id: "zai", label: "Copy, then open z.ai", kind: "copy-open", href: "https://chat.z.ai/" },
  ]
}

export const COPIED_LINE = "Copied. Press Ctrl+V, then Send"
export const DO_NOT_FORWARD_NOTE = "DO NOT FORWARD this link or share it with anyone. Anyone who has it can read your DPDP view, and make small changes, as you."
