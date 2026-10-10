import { useEffect, useState, type FormEvent } from "react"
import type { DpdpClient } from "@/lib/client"
import { fetchMyAccount, lockedAnswerGrievance, lockedDownload, lockedRecordBreach } from "@/lib/api"
import type { MyAccountPayload } from "@/lib/rpc-types"
import { dueLine, formatRupees } from "@/lib/billing-state"
import { BillingPanel } from "./BillingPanel"
import { Card } from "./Screens"

// The "Payment due" screen (drizzle/0734). Shown instead of the working screens when the account is LOCKED. It is calm on purpose: the data is
// safe, nothing is deleted, and the person can do the four things the law or common sense says must stay open:
//   * Pay (the BillingPanel, inline) and say they have paid;
//   * Download my data;
//   * Record a personal data breach (the 72-hour clock must never wait for an invoice);
//   * Answer a grievance (a person is waiting for an answer).
// A consent withdrawal needs no button here: it arrives as a link to the person's own page and never meets the payment gate.
// The server refuses everything else; this screen is not the lock, it is the explanation.

const box = { border: "1px solid var(--dpdp-line)", borderRadius: 14, padding: "14px 16px", textAlign: "left", marginTop: 14 } as const
const input = { display: "block", width: "100%", marginTop: 4, padding: "8px 10px", borderRadius: 8, border: "1px solid var(--dpdp-line)", fontSize: 14, background: "#fff", color: "var(--dpdp-ink)" } as const
const primary = { background: "var(--dpdp-v)", color: "#fff", borderRadius: 12, padding: "12px 20px", fontWeight: 700, fontSize: 15 } as const
const quiet = { background: "transparent", color: "var(--dpdp-v)", border: "1px solid var(--dpdp-v)", borderRadius: 12, padding: "10px 16px", fontWeight: 600, fontSize: 14 } as const

function downloadJson(name: string, data: unknown) {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" })
  const url = URL.createObjectURL(blob)
  const a = document.createElement("a")
  a.href = url
  a.download = name
  document.body.appendChild(a)
  a.click()
  a.remove()
  URL.revokeObjectURL(url)
}

export function PaymentDue({ client, email, onSignOut, onRetry }: { client: DpdpClient; email: string | null; onSignOut: () => void; onRetry: () => void }) {
  const [account, setAccount] = useState<MyAccountPayload | null | undefined>(undefined)
  const [showPay, setShowPay] = useState(false)
  const [msg, setMsg] = useState<string | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [breach, setBreach] = useState("")
  const [grievanceRef, setGrievanceRef] = useState("")
  const [grievanceAnswer, setGrievanceAnswer] = useState("")

  useEffect(() => {
    let cancelled = false
    fetchMyAccount(client).then((a) => { if (!cancelled) setAccount(a) }, () => { if (!cancelled) setAccount(null) })
    return () => { cancelled = true }
  }, [client])

  async function run(fn: () => Promise<string | void>) {
    setBusy(true)
    setErr(null)
    setMsg(null)
    try {
      const m = await fn()
      if (m) setMsg(m)
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  const isOwner = account?.hasAccount === true && account.money != null
  const orgId = account?.orgId ?? null
  const amount = account && account.hasAccount && account.money ? account.money : null

  return (
    <Card icon="🕊️" title="Payment due">
      <p style={{ fontSize: 15, color: "var(--dpdp-ink2)", margin: "0 auto 8px", maxWidth: "46ch" }}>
        {email ? <>Signed in as <b>{email}</b>. </> : null}
        {dueLine("LOCKED")}
      </p>
      {account && account.hasAccount && (
        <p style={{ fontSize: 13, color: "var(--dpdp-ink3)", margin: "0 auto", maxWidth: "46ch" }}>
          Paid up to {account.periodEndsOn}. Nothing has been deleted, and your record is kept.
        </p>
      )}

      <div style={box}>
        <b style={{ color: "var(--dpdp-ink)" }}>Pay</b>
        {isOwner ? (
          <>
            <p style={{ margin: "6px 0 10px", fontSize: 13.5 }}>
              {amount ? <>Your plan is {formatRupees(amount.monthlyPaise)} a month, or {formatRupees(amount.yearPaise)} for a year (ten months), plus GST.{amount.offerLabel ? ` ${amount.offerLabel}.` : ""} </> : null}
              Pay by bank transfer or UPI, then tell us here. Everything opens again once we have seen the payment.
            </p>
            <button type="button" style={primary} onClick={() => setShowPay(true)} aria-expanded={showPay}>Pay now</button>
            {showPay && orgId && <div style={{ marginTop: 12 }}><BillingPanel client={client} orgId={orgId} inline /></div>}
          </>
        ) : (
          <p style={{ margin: "6px 0 0", fontSize: 13.5 }}>
            {account === undefined ? "One moment…" : "Please ask the owner of your organisation to complete the payment. Everything opens again once it is seen."}
          </p>
        )}
      </div>

      <div style={box}>
        <b style={{ color: "var(--dpdp-ink)" }}>Download my data</b>
        <p style={{ margin: "6px 0 10px", fontSize: 13.5 }}>Your jobs and the dated record, as one file. We keep a fingerprint of your documents, not the documents, so keep your own originals.</p>
        <button type="button" style={quiet} disabled={busy || !isOwner} onClick={() => void run(async () => {
          const data = await lockedDownload(client, orgId)
          downloadJson(`dpdp-data-${new Date().toISOString().slice(0, 10)}.json`, data)
          return "Your file has been downloaded."
        })}>Download my data</button>
        {!isOwner && account !== undefined && <p style={{ margin: "8px 0 0", fontSize: 12.5 }}>The owner of the organisation can download it.</p>}
      </div>

      <div style={box}>
        <b style={{ color: "var(--dpdp-ink)" }}>Always open: things the law does not wait for</b>
        <form onSubmit={(e: FormEvent) => { e.preventDefault(); void run(async () => {
          const r = await lockedRecordBreach(client, breach.trim(), orgId)
          setBreach("")
          return `Recorded. The 72-hour clock for telling the Board started now (by ${new Date(r.boardDeadline).toLocaleString("en-IN")}).`
        }) }} style={{ marginTop: 10 }}>
          <label style={{ fontSize: 13.5, fontWeight: 600 }}>Record a personal data breach
            <textarea style={input} rows={3} value={breach} onChange={(e) => setBreach(e.target.value)} placeholder="What happened, in a few sentences" required maxLength={4000} />
          </label>
          <button type="submit" style={{ ...quiet, marginTop: 8 }} disabled={busy || breach.trim() === ""}>Record the breach</button>
        </form>
        <form onSubmit={(e: FormEvent) => { e.preventDefault(); void run(async () => {
          await lockedAnswerGrievance(client, grievanceRef.trim(), grievanceAnswer.trim(), orgId)
          setGrievanceRef("")
          setGrievanceAnswer("")
          return "Your answer is recorded."
        }) }} style={{ marginTop: 14 }}>
          <label style={{ fontSize: 13.5, fontWeight: 600 }}>Answer a grievance
            <input style={input} type="text" value={grievanceRef} onChange={(e) => setGrievanceRef(e.target.value)} placeholder="The grievance reference" required maxLength={80} />
          </label>
          <label style={{ fontSize: 13.5, fontWeight: 600, display: "block", marginTop: 6 }}>Your answer
            <textarea style={input} rows={3} value={grievanceAnswer} onChange={(e) => setGrievanceAnswer(e.target.value)} required maxLength={4000} />
          </label>
          <button type="submit" style={{ ...quiet, marginTop: 8 }} disabled={busy || !isOwner || grievanceRef.trim() === "" || grievanceAnswer.trim() === ""}>Record my answer</button>
        </form>
        <p style={{ margin: "14px 0 0", fontSize: 13 }}>
          A person who withdraws their consent uses the link in their own message. That link keeps working, and the withdrawal is honoured and dated.
        </p>
      </div>

      {msg && <p role="status" style={{ margin: "12px 0 0", color: "var(--dpdp-v)", fontWeight: 600, fontSize: 13.5 }}>{msg}</p>}
      {err && <p role="alert" style={{ margin: "12px 0 0", color: "var(--dpdp-r)", fontWeight: 600, fontSize: 13.5 }}>{err}</p>}

      <div className="flex gap-2.5 items-center justify-center flex-wrap" style={{ marginTop: 18 }}>
        <button type="button" onClick={onRetry} style={quiet}>I have paid: check again</button>
        <button type="button" onClick={onSignOut} style={{ background: "transparent", color: "var(--dpdp-ink3)", fontSize: 13.5, textDecoration: "underline" }}>Sign out</button>
      </div>
    </Card>
  )
}
