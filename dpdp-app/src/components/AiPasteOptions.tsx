import { useState } from "react"
import { COPIED_LINE, DO_NOT_FORWARD_NOTE, THIRD_PARTY_NOTE, chatOptions } from "@/lib/ai-chat-options"

// The short paste (two lines and the link) in a box, a plain Copy button, and the buttons that take it to an AI chat (src/lib/ai-chat-options.ts).
// The page that renders this already requires a signed-in session.
const btn = { background: "var(--dpdp-v)", fontSize: 13, padding: "9px 14px", textDecoration: "none", display: "inline-block" } as const

export function AiPasteOptions({ paste, onReplace, replacing }: { paste: string; onReplace?: () => void; replacing?: boolean }) {
  const [copied, setCopied] = useState(false)
  async function copy() {
    try {
      await navigator.clipboard.writeText(paste)
      setCopied(true)
      setTimeout(() => setCopied(false), 4000)
    } catch {
      setCopied(false)
    }
  }
  return (
    <div>
      <p role="alert" className="rounded-xl px-3.5 py-2.5 mb-3" style={{ background: "var(--dpdp-rL)", color: "var(--dpdp-r)", fontSize: 13, fontWeight: 700 }}>{DO_NOT_FORWARD_NOTE}</p>
      <div data-testid="ai-paste" className="rounded-xl border px-3.5 py-3 mb-2 break-words" style={{ borderColor: "var(--dpdp-line)", background: "#fff", fontSize: 13, color: "var(--dpdp-ink)", whiteSpace: "pre-wrap", userSelect: "all" }}>{paste}</div>
      <div className="flex gap-2.5 items-center flex-wrap mb-2">
        <button type="button" onClick={copy} className="font-bold text-white rounded-lg" style={btn}>{copied ? "✓ Copied" : "📋 Copy"}</button>
        {chatOptions(paste).map((o) => (
          <a
            key={o.id} href={o.href} target="_blank" rel="noopener noreferrer" className="font-bold text-white rounded-lg" style={btn}
            onClick={() => { void copy() }}
          >
            {o.label}
          </a>
        ))}
      </div>
      {copied && <p role="status" style={{ fontSize: 13, fontWeight: 600, color: "var(--dpdp-ink)", margin: "0 0 6px" }}>{COPIED_LINE}</p>}
      <p style={{ fontSize: 12.5, color: "var(--dpdp-ink3)", margin: "0 0 8px", maxWidth: "72ch" }}>{THIRD_PARTY_NOTE}</p>
      {onReplace && (
        <button type="button" disabled={replacing} onClick={onReplace} style={{ background: "transparent", color: "var(--dpdp-v)", fontSize: 13, padding: "4px 0", textDecoration: "underline" }}>
          {replacing ? "Replacing…" : "Replace this link with a new one"}
        </button>
      )}
      <p style={{ fontSize: 12.5, color: "var(--dpdp-r)", fontWeight: 700, margin: "10px 0 0" }}>{DO_NOT_FORWARD_NOTE}</p>
    </div>
  )
}
