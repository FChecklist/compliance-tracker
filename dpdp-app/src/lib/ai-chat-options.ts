// The AI Link page's "open it in your AI" buttons (owner, 2026-10-05). The signed-in page shows the short paste (two lines and the link); these
// buttons take it to an AI chat. Until 2026-10-06 three sites received the paste in the address (?q=); that put the secret
// link in other companies' URLs, so ALL buttons now COPY the paste first and then open the plain site, and the page says "Copied. Press Ctrl+V, then Send". These are other companies' websites and may change how their addresses work at any time.
// PURE: no DOM, no globals; src/lib/ai-chat-options.test.ts pins every address.

export type ChatOption = {
  id: "chatgpt" | "grok" | "claude" | "gemini" | "deepseek" | "zai"
  label: string
  /** "copy-open": copy first, then open the site; the person pastes. ("open" is retained in the type only; nothing returns it, because the secret link must not travel in another company's URL.) */
  kind: "open" | "copy-open"
  href: string
}

export const THIRD_PARTY_NOTE = "These buttons open other companies' websites, which can change how their links work at any time. Each button copies the text first; press Ctrl+V in the box, then Send."

// SECURITY (owner, 2026-10-06): the paste holds the secret AI link, so it is NEVER placed in another company's address (it would reach their
// logs, history and referrers). Every button copies to the clipboard first and opens the plain site; the person pastes. `paste` is kept in the
// signature for callers and to make the rule testable: no returned href may contain any part of it.
// eslint-disable-next-line @typescript-eslint/no-unused-vars
export function chatOptions(_paste: string): ChatOption[] {
  return [
    { id: "chatgpt", label: "Copy, then open ChatGPT", kind: "copy-open", href: "https://chatgpt.com/" },
    { id: "grok", label: "Copy, then open Grok", kind: "copy-open", href: "https://grok.com/" },
    { id: "claude", label: "Copy, then open Claude", kind: "copy-open", href: "https://claude.ai/new" },
    { id: "gemini", label: "Copy, then open Gemini", kind: "copy-open", href: "https://gemini.google.com/app" },
    { id: "deepseek", label: "Copy, then open DeepSeek", kind: "copy-open", href: "https://chat.deepseek.com/" },
    { id: "zai", label: "Copy, then open z.ai", kind: "copy-open", href: "https://chat.z.ai/" },
  ]
}

export const COPIED_LINE = "Copied. Press Ctrl+V, then Send"
export const DO_NOT_FORWARD_NOTE = "DO NOT FORWARD this link: anyone with it can act as you."
