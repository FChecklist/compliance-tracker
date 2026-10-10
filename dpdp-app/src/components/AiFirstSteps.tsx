import "./onepage/dpdp-onepage-tokens.css"
import { useEffect, useState } from "react"
import { aiLinkUrl, aiLinkWarning, createAiWorkLink } from "@/lib/api"
import { aiWorkLinkWarningSentence } from "@/lib/ai-work-link"
import { copyToClipboard, fetchPrompt } from "@/lib/copy-prompt"
import type { DpdpClient } from "@/lib/client"
import type { AiLinkWarning } from "@/lib/rpc-types"
import { browserClipboard } from "@/lib/browser-clipboard"

// The top of /app/: three numbered steps, Option 1 first and biggest. Step 1 is one tap -- it makes the person's AI work link and puts the SAME
// two-line paste the Monday email carries on the clipboard (the server's own GET /ai/<token>/prompt text, so the page and the email can never
// drift apart). The data warning (real counts) sits directly above the button, before anything is copied. Step 2 and 3 are plain words.
// Fine control (hide emails, 1/30 days, a label, the list of links and Revoke) stays in the "AI work link" section lower on the page.
const AI_NAMES = "ChatGPT, Claude, Gemini, Grok, DeepSeek"
const num = { width: 30, height: 30, borderRadius: 15, background: "var(--dpdp-v)", color: "#fff", fontWeight: 700, fontSize: 15, display: "inline-flex", alignItems: "center", justifyContent: "center", flex: "0 0 30px" } as const

export function AiFirstSteps({ client, orgId, offline, onMade }: { client: DpdpClient; orgId: string; offline: boolean; onMade?: () => Promise<void> }) {
  const [warning, setWarning] = useState<AiLinkWarning | null>(null)
  const [small, setSmall] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [prompt, setPrompt] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)

  useEffect(() => {
    if (offline) return
    let cancelled = false
    aiLinkWarning(client, orgId).then((w) => { if (!cancelled) setWarning(w) }, () => { /* the button then explains; the section below shows the error */ })
    return () => { cancelled = true }
  }, [client, orgId, offline])

  async function put(text: string) {
    const ok = await copyToClipboard(text, browserClipboard())
    setCopied(ok)
    if (ok) window.setTimeout(() => setCopied(false), 4000)
    return ok
  }

  async function make() {
    setBusy(true)
    setError(null)
    try {
      const link = await createAiWorkLink(client, { level: small ? 1 : 0, hideEmails: true, days: 7, label: "Step 1 copy", orgId })
      const got = await fetchPrompt(link.token, (u, i) => fetch(u, i))
      const text = got.kind === "ok" ? got.text : aiLinkUrl(link.token)
      setPrompt(text)
      if (!(await put(text))) setError("Your browser did not allow the automatic copy. Tap “Copy again” below.")
      await onMade?.()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  const card = { background: "var(--dpdp-card)", borderColor: "var(--dpdp-line)" } as const
  return (
    <div className="dpdp-onepage" id="start-here" data-testid="ai-first-steps">
      <div className="max-w-[1240px] mx-auto px-5 pt-4">
        <div className="rounded-[22px] border p-6" style={card}>
          <h2 style={{ fontFamily: "Sora, sans-serif", fontSize: 22, fontWeight: 700, margin: "0 0 14px", color: "var(--dpdp-ink)" }}>Do your DPDP jobs in 3 steps</h2>

          <div className="flex gap-3.5 items-start mb-5" data-step="1">
            <span style={num} aria-hidden="true">1</span>
            <div style={{ minWidth: 0, flex: 1 }}>
              <div style={{ fontSize: 17, fontWeight: 700, color: "var(--dpdp-ink)" }}>Option 1 · Copy your AI work link <span style={{ fontWeight: 600, fontSize: 12.5, color: "var(--dpdp-g, #0B5F26)" }}>(easiest)</span></div>
              {warning && <p style={{ fontSize: 13.5, color: "var(--dpdp-ink2)", margin: "6px 0 10px", maxWidth: "74ch" }}><strong>Before you copy.</strong> {aiWorkLinkWarningSentence(warning)}</p>}
              <label className="inline-flex gap-1.5 items-center cursor-pointer mb-3" style={{ fontSize: 13.5, color: "var(--dpdp-ink)", display: "flex" }}>
                <input type="checkbox" checked={small} onChange={(e) => setSmall(e.target.checked)} disabled={busy} />
                Let my AI also make small updates for me (anything important still waits for my OK)
              </label>
              <button
                type="button" onClick={() => void make()} disabled={busy || offline || !warning}
                className="font-bold text-white rounded-lg"
                style={{ background: "var(--dpdp-v)", fontSize: 16, padding: "13px 24px", borderRadius: 14, opacity: busy || offline || !warning ? 0.6 : 1 }}
              >
                {busy ? "Making your link…" : copied ? "✓ Copied" : prompt ? "Copy a new link" : "📋 Copy my AI work link"}
              </button>
              {offline && <p style={{ fontSize: 12.5, color: "var(--dpdp-ink3)", margin: "8px 0 0" }}>This one step needs internet, because the link is made on our side. Everything else here works from your device.</p>}
              {error && <div role="alert" className="rounded-xl px-3.5 py-2.5 mt-3" style={{ background: "var(--dpdp-rL)", color: "var(--dpdp-r)", fontSize: 13, fontWeight: 600 }}>{error}</div>}
              {prompt && (
                <div className="mt-3">
                  <pre
                    tabIndex={0} aria-label="Your AI work link, ready to paste" data-testid="ai-first-prompt"
                    style={{ whiteSpace: "pre-wrap", wordBreak: "break-word", maxHeight: 180, overflow: "auto", margin: 0, padding: 12, fontSize: 12.5, lineHeight: 1.5, borderRadius: 12, border: "1px solid var(--dpdp-line)", background: "rgba(0,0,0,0.03)", userSelect: "all" }}
                  >{prompt}</pre>
                  <button type="button" onClick={() => void put(prompt)} style={{ background: "transparent", color: "var(--dpdp-v)", fontSize: 13, padding: "6px 0", textDecoration: "underline" }}>Copy again</button>
                </div>
              )}
            </div>
          </div>

          <div className="flex gap-3.5 items-start mb-5" data-step="2">
            <span style={num} aria-hidden="true">2</span>
            <div>
              <div style={{ fontSize: 16, fontWeight: 700, color: "var(--dpdp-ink)" }}>Paste it into your AI</div>
              <p style={{ fontSize: 13.5, color: "var(--dpdp-ink2)", margin: "4px 0 0", maxWidth: "74ch" }}>Open {AI_NAMES} (any AI chat that can open web links), paste with Ctrl+V (on a phone: press and hold, then Paste), and press send. The same box is in your Monday email, so you can also do this straight from your inbox.</p>
            </div>
          </div>

          <div className="flex gap-3.5 items-start mb-5" data-step="3">
            <span style={num} aria-hidden="true">3</span>
            <div>
              <div style={{ fontSize: 16, fontWeight: 700, color: "var(--dpdp-ink)" }}>Your AI tells you what to do</div>
              <p style={{ fontSize: 13.5, color: "var(--dpdp-ink2)", margin: "4px 0 0", maxWidth: "74ch" }}>It reads your jobs, explains each one in plain words and says what is late. If you allowed small updates it makes them for you; anything with legal weight comes back as a button for you to confirm. It never writes or changes code.</p>
            </div>
          </div>

          <p style={{ fontSize: 13.5, color: "var(--dpdp-ink2)", margin: 0 }}>
            Prefer to do it yourself? <a href="#jobs" style={{ color: "var(--dpdp-v)", fontWeight: 700 }}>Go to your jobs ↓</a>
            {" · "}<a href="#ai-link-settings" style={{ color: "var(--dpdp-v)", fontWeight: 700 }}>More link options (hide emails, 1 or 30 days, turn a link off)</a>
          </p>
        </div>
      </div>
    </div>
  )
}
