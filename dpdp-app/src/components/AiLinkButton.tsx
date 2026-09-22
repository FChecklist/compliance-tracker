import "./onepage/dpdp-onepage-tokens.css"
import { useState } from "react"
import { aiLinkUrl, createAiLink } from "@/lib/api"
import type { DpdpClient } from "@/lib/client"
import type { AiLinkPayload } from "@/lib/rpc-types"

// WO-DPDP-012 §7 on the static app: "Copy AI link". dpdp_create_ai_link
// (drizzle/0607) returns the token EXACTLY ONCE -- only its sha256 is
// stored -- so the URL is shown once, right here, with a copy button, and
// any earlier live link is revoked by the same call. The URL is this
// host's /ai/<token> (functions/ai/[token].ts proxies the Edge Function
// and serves it as real text/html). Copy below is
// src/app/dpdp/(app)/ai-link/page.tsx's, verbatim.
const CAN_SEE = [
  "Duties — what's done and what's late",
  "Where each kind of data is kept",
  "Which outside firms hold your data, and whether they've signed",
  "How many people are in each group — counts only",
  "Open requests and complaints, by reference number",
]
const CANNOT_SEE = [
  "Any customer, employee or parent's name, phone or email",
  "Any evidence file — only whether one exists",
  "Your staff's email addresses",
  "The contents of a complaint",
  "Anything about your other organisations",
]

export function AiLinkButton({ client, orgId }: { client: DpdpClient; orgId: string }) {
  const [link, setLink] = useState<AiLinkPayload | null>(null)
  const [busy, setBusy] = useState(false)
  const [copied, setCopied] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function make() {
    setBusy(true)
    setError(null)
    try {
      setLink(await createAiLink(client, orgId))
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  const url = link ? aiLinkUrl(link.token) : null

  async function copy() {
    if (!url) return
    try {
      await navigator.clipboard.writeText(url)
      setCopied(true)
      setTimeout(() => setCopied(false), 2200)
    } catch {
      setError("Could not copy — select the link and copy it by hand.")
    }
  }

  return (
    <div className="dpdp-onepage">
      <div className="max-w-[1240px] mx-auto px-5 pb-8">
        <div className="rounded-[22px] border p-6" style={{ background: "var(--dpdp-card)", borderColor: "var(--dpdp-line)" }}>
          <h2 style={{ fontFamily: "Sora, sans-serif", fontSize: 20, fontWeight: 700, margin: "0 0 6px", color: "var(--dpdp-ink)" }}>🤖 AI Link</h2>
          <p style={{ fontSize: 14, color: "var(--dpdp-ink2)", margin: "0 0 14px", maxWidth: "72ch" }}>
            Paste this link into ChatGPT, Claude, Gemini or any other AI. It can read where you stand and tell you what to do about it. <b>It cannot change anything.</b> Whatever it suggests, you enter yourself, inside the product.
          </p>
          {error && <div role="alert" className="rounded-xl px-3.5 py-2.5 mb-3" style={{ background: "var(--dpdp-rL)", color: "var(--dpdp-r)", fontSize: 13, fontWeight: 600 }}>{error}</div>}
          {url && link ? (
            <>
              <div className="rounded-xl border px-3.5 py-3 mb-2 font-mono break-all" style={{ borderColor: "var(--dpdp-line)", background: "#fff", fontSize: 12.5, color: "var(--dpdp-v)" }}>{url}</div>
              <div className="flex gap-3 items-center flex-wrap mb-3">
                <button type="button" onClick={copy} className="font-bold text-white rounded-lg" style={{ background: "var(--dpdp-v)", fontSize: 13, padding: "9px 16px" }}>
                  {copied ? "✓ Copied" : "📋 Copy my AI Link"}
                </button>
                <span style={{ fontSize: 12.5, color: "var(--dpdp-ink3)" }}>Read-only · expires {new Date(link.expiresAt).toLocaleDateString("en-IN")}{link.revokedPrevious > 0 ? " · your previous link no longer works" : ""}</span>
              </div>
              <p style={{ fontSize: 13, color: "var(--dpdp-ink2)", margin: "0 0 14px", maxWidth: "72ch" }}>
                The raw value is only ever shown once (when created or replaced) — never stored in a way that could be shown again. Copy it now; to get a new one later, press the button again and the old link stops working.
              </p>
            </>
          ) : (
            <div className="flex gap-3 items-center flex-wrap mb-3">
              <button type="button" disabled={busy} onClick={make} className="font-bold text-white rounded-lg" style={{ background: "var(--dpdp-v)", fontSize: 13, padding: "9px 16px", opacity: busy ? 0.6 : 1 }}>
                {busy ? "Making…" : "🤖 Make my AI Link"}
              </button>
              <span style={{ fontSize: 12.5, color: "var(--dpdp-ink3)" }}>Shown once, then only you have it. Any earlier link stops working.</span>
            </div>
          )}
          <div className="grid grid-cols-2 gap-3 my-3">
            <div className="rounded-xl p-4" style={{ background: "var(--dpdp-gL)" }}>
              <b className="block mb-2" style={{ fontSize: 13.5 }}>✅ What it can see</b>
              <ul className="list-disc pl-4 space-y-1" style={{ fontSize: 13, color: "var(--dpdp-ink2)" }}>{CAN_SEE.map((x) => <li key={x}>{x}</li>)}</ul>
            </div>
            <div className="rounded-xl p-4" style={{ background: "var(--dpdp-rL)" }}>
              <b className="block mb-2" style={{ fontSize: 13.5 }}>🚫 What it can never see</b>
              <ul className="list-disc pl-4 space-y-1" style={{ fontSize: 13, color: "var(--dpdp-ink2)" }}>{CANNOT_SEE.map((x) => <li key={x}>{x}</li>)}</ul>
            </div>
          </div>
          <div className="rounded-xl p-4" style={{ background: "var(--dpdp-aL)", fontSize: 13, color: "var(--dpdp-ink2)" }}>
            <b>Why this is built the way it is:</b> we sell you protection against personal data leaving your control. It would be absurd if our own feature sent your customers&rsquo; names to a server elsewhere. Nothing personal is in that link — it carries the shape of your compliance, never the people inside it.
          </div>
        </div>
      </div>
    </div>
  )
}
