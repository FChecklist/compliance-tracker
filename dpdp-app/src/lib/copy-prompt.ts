// The one-tap Copy page (/copy/#<token>): the pure half. The Monday email cannot run a script, so its "Copy" button is a link to
// this page; the page fetches the person's ready-made prompt from their own AI work link (GET /ai/<token>/prompt, served by the
// dpdp-ai-link function through the app host's /ai/ proxy, so it is the same origin: no CORS) and puts it on the clipboard.
//
// The token rides in the URL FRAGMENT, which a browser never sends to any server, so opening the link from the email leaves no token
// in a request line or a log until the page itself calls /ai/<token>/prompt (the same request every AI makes to the same link).
// No DOM and no globals here: every side effect is passed in, so `bun test` covers it.

/** The token shape the AI link uses (64 hex today, room for other opaque encodings), read from the fragment. Nothing else is accepted. */
const TOKEN_RE = /^[A-Za-z0-9_-]{16,256}$/

/** `#<token>` -> the token, or null when the fragment is empty or is not a token. */
export function promptTokenFromHash(hash: string): string | null {
  const raw = hash.replace(/^#/, "")
  return TOKEN_RE.test(raw) ? raw : null
}

/** Same origin as the page: the app host's /ai/ proxy forwards it to the dpdp-ai-link function. */
export function promptPath(token: string): string {
  return `/ai/${token}/prompt`
}

export type PromptResult =
  | { kind: "ok"; text: string }
  | { kind: "gone" } // expired, revoked, or not a link at all: one answer, so a guessed address learns nothing
  | { kind: "error" }

type FetchLike = (input: string, init?: RequestInit) => Promise<Response>

/** GET the prompt. Never throws. A prompt is accepted only when it looks like one, so an error page can never be copied as "the prompt". */
export async function fetchPrompt(token: string, fetchFn: FetchLike): Promise<PromptResult> {
  try {
    const res = await fetchFn(promptPath(token), { method: "GET", cache: "no-store", credentials: "omit", referrerPolicy: "no-referrer" })
    if (res.status === 404 || res.status === 410 || res.status === 401) return { kind: "gone" }
    if (!res.ok) return { kind: "error" }
    const text = (await res.text()).replace(/\r\n/g, "\n").trim()
    // Accepted only when it is text that carries THIS person's own link, so an error page (or anything else a 200 might hold) is never copied as "the prompt".
    if (text.length === 0 || text.length > 20_000 || /^\s*</.test(text) || !text.includes(`/ai/${token}`)) return { kind: "error" }
    return { kind: "ok", text }
  } catch {
    return { kind: "error" }
  }
}

export type ClipboardDeps = {
  /** navigator.clipboard.writeText, when the browser has it. */
  writeText?: (text: string) => Promise<void>
  /** The old select-and-copy fallback (document.execCommand), for a browser without the async clipboard. */
  legacyCopy?: (text: string) => boolean
}

/** Puts `text` on the clipboard. False when the browser refuses (for example Safari, which wants a tap first): the page then shows its button. */
export async function copyToClipboard(text: string, deps: ClipboardDeps): Promise<boolean> {
  if (deps.writeText) {
    try {
      await deps.writeText(text)
      return true
    } catch { /* fall through to the legacy path */ }
  }
  if (deps.legacyCopy) {
    try {
      return deps.legacyCopy(text) === true
    } catch {
      return false
    }
  }
  return false
}
