import { useEffect, useRef, useState } from "react"
import { copyToClipboard, fetchPrompt, promptTokenFromHash } from "@/lib/copy-prompt"
import { browserClipboard } from "@/lib/browser-clipboard"
import { Card } from "./Screens"

// The one-tap Copy page behind the "Copy" button in the Monday email's prompt box (owner, 2026-09-30: "a simple copy icon on the upper
// right ... the moment the user comes to the prompt, it gets copied ... make user life easy"). An email cannot run a script, so the
// button is a link here. On arrival the page fetches the person's prompt and tries to put it on the clipboard by itself; a browser that
// refuses (Safari and Firefox want a tap first) leaves the big Copy button, which is always there. Opening the page changes nothing on
// the server: it only reads the prompt the person's own link already serves.

const lead = { fontSize: 15, color: "var(--dpdp-ink2)", margin: "0 auto 18px", maxWidth: "44ch" } as const
const quiet = { fontSize: 13, color: "var(--dpdp-ink3)", margin: "14px auto 0", maxWidth: "46ch" } as const
const big = { background: "var(--dpdp-v)", fontSize: 18, fontWeight: 700, padding: "16px 30px", borderRadius: 16, minWidth: 220 } as const

type State =
  | { kind: "checking" }
  | { kind: "no-token" }
  | { kind: "gone" }
  | { kind: "error" }
  | { kind: "ready"; text: string }

export function CopyPromptPage() {
  // Read once, before the first render, so "no token" is the starting state rather than a state set inside the effect.
  const [token] = useState(() => promptTokenFromHash(window.location.hash))
  const [state, setState] = useState<State>(() => (token ? { kind: "checking" } : { kind: "no-token" }))
  const [copied, setCopied] = useState<"auto" | "tap" | null>(null)
  const started = useRef(false)

  useEffect(() => {
    if (started.current) return // StrictMode runs effects twice in development; one fetch is enough
    started.current = true
    // The token has done its job as soon as it is read: take it out of the address bar and the history entry.
    if (window.location.hash) window.history.replaceState(null, "", window.location.pathname + window.location.search)
    if (!token) return
    void (async () => {
      const r = await fetchPrompt(token, (input, init) => fetch(input, init))
      if (r.kind !== "ok") { setState({ kind: r.kind }); return }
      setState({ kind: "ready", text: r.text })
      if (await copyToClipboard(r.text, browserClipboard())) setCopied("auto")
    })()
  }, [token])

  async function copyNow(text: string) {
    if (await copyToClipboard(text, browserClipboard())) {
      setCopied("tap")
      window.setTimeout(() => setCopied((c) => (c === "tap" ? "auto" : c)), 2500)
    }
  }

  if (state.kind === "checking") {
    return (
      <Card icon="⏳" title="Getting your prompt">
        <p style={{ fontSize: 15, color: "var(--dpdp-ink2)", margin: 0 }}>One moment.</p>
      </Card>
    )
  }
  if (state.kind === "no-token") {
    return (
      <Card icon="📋" title="Open this from your email">
        <p style={lead}>This page copies your prompt when you reach it from the <strong>Copy</strong> button in your Monday email. Open that email and tap Copy again.</p>
      </Card>
    )
  }
  if (state.kind === "gone") {
    return (
      <Card icon="🙈" title="This link has stopped working">
        <p role="alert" style={lead}>It has expired or was turned off, so nothing was copied.</p>
        <p style={quiet}>When there is something for you to do, next Monday's email brings a fresh one. Or open your page and make a new AI Work link there.</p>
      </Card>
    )
  }
  if (state.kind === "error") {
    return (
      <Card icon="⚠️" title="Could not get your prompt">
        <p role="alert" style={{ fontSize: 14, color: "var(--dpdp-r)", margin: "0 auto 18px", maxWidth: "48ch", fontWeight: 600 }}>Something went wrong on our side. Nothing was copied.</p>
        <p style={quiet}>Go back to your email and tap Copy again in a moment.</p>
      </Card>
    )
  }

  const { text } = state
  return (
    <Card icon={copied ? "✅" : "📋"} title={copied ? "Copied" : "Your prompt is ready"}>
      <p role="status" style={lead}>
        {copied
          ? <>It is on your clipboard. Now open your AI (ChatGPT, Claude, Gemini, Grok, DeepSeek) and <strong>paste</strong> it: Ctrl+V, or press and hold and choose Paste.</>
          : <>Tap <strong>Copy</strong>, then open your AI (ChatGPT, Claude, Gemini, Grok, DeepSeek) and paste it.</>}
      </p>
      <button type="button" className="dpdp-btn" style={big} onClick={() => void copyNow(text)}>
        {copied === "tap" ? "Copied ✓" : copied === "auto" ? "Copy again" : "Copy the prompt"}
      </button>
      <pre
        tabIndex={0}
        aria-label="Your prompt"
        onClick={(e) => { const s = window.getSelection(); if (s) { const r = document.createRange(); r.selectNodeContents(e.currentTarget); s.removeAllRanges(); s.addRange(r) } }}
        style={{ textAlign: "left", whiteSpace: "pre-wrap", wordBreak: "break-word", maxHeight: 260, overflow: "auto", margin: "22px 0 0", padding: 14, fontSize: 12.5, lineHeight: 1.5, borderRadius: 12, border: "1px solid var(--dpdp-line, #E2E8F0)", background: "rgba(0,0,0,0.03)", userSelect: "all" }}
      >{text}</pre>
      <p style={quiet}>This prompt holds your private AI Work link. Paste it only into an AI you trust, and do not share it.</p>
    </Card>
  )
}
