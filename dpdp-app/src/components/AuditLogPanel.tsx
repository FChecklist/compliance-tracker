import "./onepage/dpdp-onepage-tokens.css"
import { useEffect, useState } from "react"
import { downloadAuditLog, getAuditOrgs, saveTextFile, verifyAuditChain, type AuditOrgs } from "@/lib/audit-api"
import type { DpdpClient } from "@/lib/client"

// The audit log, for the people it is about (owner spec 2026-10-06, item 4). A signed-in person downloads their own log; the owner or a head of department can also
// download the organisation's whole log and verify its chain. Every value in the file is masked on the server; the log is never e-mailed; each download needs a code
// confirmed just now (the same e-mailed code used to sign in, asked for again here), is limited to a few an hour, and is itself recorded.
const card = { background: "var(--dpdp-card)", borderColor: "var(--dpdp-line)" } as const
const alertStyle = { background: "var(--dpdp-rL)", color: "var(--dpdp-r)", fontSize: 13, fontWeight: 600 } as const
const btn = { background: "var(--dpdp-v)", fontSize: 14, padding: "10px 16px" } as const
const fieldInput = { padding: "11px 13px", border: "1px solid var(--dpdp-line)", borderRadius: 12, fontSize: 14, background: "#fff", width: 160 } as const

type Step = "idle" | "code-sent" | "ready"

export function AuditLogPanel({ client, orgId, email }: { client: DpdpClient; orgId: string; email: string | null }) {
  const [info, setInfo] = useState<AuditOrgs | null>(null)
  const [step, setStep] = useState<Step>("idle")
  const [code, setCode] = useState("")
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let live = true
    void getAuditOrgs(client).then((r) => {
      if (!live) return
      setInfo(r)
      if (r?.codeFresh) setStep("ready")
    })
    return () => { live = false }
  }, [client, orgId])

  const mine = info?.orgs.find((o) => o.orgId === orgId) ?? info?.orgs[0] ?? null

  async function sendCode() {
    if (!email) return
    setBusy(true); setError(null); setMessage(null)
    const { error: e } = await client.auth.signInWithOtp({ email, options: { emailRedirectTo: new URL("/app/", window.location.origin).href } })
    setBusy(false)
    if (e) { setError("We could not send a code. Try again in a minute."); return }
    setStep("code-sent"); setMessage("We e-mailed you a code. Enter it here (you can ignore the sign-in link in the same e-mail).")
  }

  async function confirmCode() {
    if (!email || !code.trim()) return
    setBusy(true); setError(null)
    const { error: e } = await client.auth.verifyOtp({ email, token: code.trim(), type: "email" })
    if (e) { setBusy(false); setError("That code did not work. Check it, or send a new one."); return }
    setCode("")
    const r = await getAuditOrgs(client)
    setInfo(r); setBusy(false)
    if (r?.codeFresh) { setStep("ready"); setMessage("Code confirmed. You can download now.") } else setError("The code was accepted but is not recent enough. Send a new one.")
  }

  async function download(scope: "own" | "organisation") {
    if (!mine) return
    setBusy(true); setError(null); setMessage(null)
    const r = await downloadAuditLog(client, scope, mine.orgId)
    setBusy(false)
    if (r.ok) {
      saveTextFile(r.filename, r.text)
      setMessage(`Saved ${r.filename}. Verification hash: ${r.verificationHash}`)
      return
    }
    if (r.code === "FRESH_CODE_REQUIRED") { setStep("idle"); setError("Confirm a new code first (it is valid for a few minutes).") } else setError(r.message)
  }

  async function verify() {
    if (!mine) return
    setBusy(true); setError(null); setMessage(null)
    const r = await verifyAuditChain(client, mine.orgId)
    setBusy(false)
    if (r.ok) setMessage(`The chain is intact (${r.rows ?? 0} entries checked).`)
    else setError(r.error ?? `The chain does not check out${r.reason ? ` (${r.reason})` : ""}. ${r.detail ?? ""}`)
  }

  return (
    <section id="audit-log" className="rounded-2xl border p-5 mt-5" style={card} aria-labelledby="audit-log-h">
      <h2 id="audit-log-h" style={{ fontSize: 18, fontWeight: 700, margin: "0 0 6px" }}>Your audit log</h2>
      <p style={{ fontSize: 13.5, color: "var(--dpdp-ink2)", margin: "0 0 12px", maxWidth: "70ch" }}>
        A record of what was done with your organisation's DPDP records and by whom, kept for 365 days for security and audit (DPDP Rules 6 and 8(3)). You can download your own entries here. Names, e-mail addresses, network addresses and device ids are shortened in the file, and it is never sent by e-mail.
      </p>
      {!info && <p style={{ fontSize: 13 }}>Loading…</p>}
      {info && !mine && <p style={{ fontSize: 13 }}>You are not part of an organisation here yet.</p>}
      {mine && (
        <>
          {step !== "ready" && (
            <div className="mb-3">
              <p style={{ fontSize: 13, margin: "0 0 8px" }}>To download, confirm a fresh code first. It is sent to {email ?? "your e-mail"}.</p>
              {step === "idle" && <button type="button" disabled={busy || !email} onClick={sendCode} className="font-bold text-white rounded-lg" style={btn}>{busy ? "Sending…" : "Send me a code"}</button>}
              {step === "code-sent" && (
                <div className="flex gap-2.5 items-center flex-wrap">
                  <input aria-label="Code from your e-mail" inputMode="numeric" autoComplete="one-time-code" value={code} onChange={(e) => setCode(e.target.value)} style={fieldInput} />
                  <button type="button" disabled={busy || !code.trim()} onClick={confirmCode} className="font-bold text-white rounded-lg" style={btn}>{busy ? "Checking…" : "Confirm code"}</button>
                  <button type="button" disabled={busy} onClick={sendCode} style={{ background: "transparent", color: "var(--dpdp-v)", fontSize: 13, textDecoration: "underline" }}>Send a new code</button>
                </div>
              )}
            </div>
          )}
          {step === "ready" && (
            <div className="flex gap-2.5 items-center flex-wrap mb-2">
              {mine.canDownloadOwn && <button type="button" disabled={busy} onClick={() => download("own")} className="font-bold text-white rounded-lg" style={btn}>Download my log</button>}
              {mine.canDownloadOrganisation && <button type="button" disabled={busy} onClick={() => download("organisation")} className="font-bold text-white rounded-lg" style={btn}>Download the whole organisation's log</button>}
              {mine.canDownloadOrganisation && <button type="button" disabled={busy} onClick={verify} style={{ background: "transparent", color: "var(--dpdp-v)", fontSize: 14, textDecoration: "underline" }}>Verify chain</button>}
            </div>
          )}
        </>
      )}
      {error && <p role="alert" className="rounded-xl px-3.5 py-2.5 mt-2" style={alertStyle}>{error}</p>}
      {message && <p role="status" style={{ fontSize: 13, fontWeight: 600, marginTop: 8, wordBreak: "break-all" }}>{message}</p>}
    </section>
  )
}
