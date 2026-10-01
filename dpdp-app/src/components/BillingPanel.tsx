import { useEffect, useState } from "react"
import type { DpdpClient } from "@/lib/client"
import { declarePayment, myBilling, startOnlinePayment, uploadPaymentProof } from "@/lib/api"
import type { BillingStatusPayload } from "@/lib/rpc-types"
import { PAY_EMAIL, paymentProofMailto } from "@/lib/payment-proof-mail"

// Where to actually send the money -- swap these for the real values the
// moment the Owner shares them (bank/UPI details + a QR code image at
// public/payment-qr.png; WhatsApp number). Until then the email address is
// real and already works -- that channel needs nothing to swap. It is the
// one public DPDP mailbox (PAY_EMAIL, src/lib/payment-proof-mail.ts), not a
// personal address: a proof mailed there is filed as an invoice ticket.
const PAY_UPI_ID = "veridian@upi (ask the Owner for the real UPI ID)"
const PAY_BANK = { accountName: "VERIDIAN (bank details pending)", accountNumber: "-- pending --", ifsc: "-- pending --" }
const PAY_QR_IMAGE = "/payment-qr.png"
const PAY_WHATSAPP_NUMBER = "" // e.g. "919999999999" -- wa.me link is hidden until this is set

// WO-DPDP-016 §7-8: the billing widget, lower-left of the owner's own page
// (Owner instruction, this session). Owner-only -- App.tsx only renders
// this for viewer.kind === "owner". Access to the product never depends
// on anything shown here: trial, awaiting_confirmation and active all
// work identically. "I've paid" is a claim, not a fact -- the Owner's own
// manual confirmation (outside this app) is what actually moves an org to
// active and, if it was referred, is the one moment a referral commission
// is earned.
//
// Prices are the Owner's own numbers (chat, this session): both editions
// Rs 1999/mo (shown for comparison; not the plan actually sold) or
// Rs 9999/yr (yearly is what's actually sold). Paise, matching every other
// money column in this schema (dpdp.band.annual_paise).
const MONTHLY_PAISE = 199_900
const YEARLY_PAISE = 999_900

// Online payment (Razorpay, supabase/functions/dpdp-pay). The yearly price below must equal the server's own (dpdp_plan_price_paise in
// drizzle/0673): the server charges ITS number, this one is only what is shown, and src/lib/services/dpdp-pay-logic.test.ts fails if they differ.
const PENDING_KEY = (orgId: string) => `dpdp-pay-pending:${orgId}`
const POLL_TRIES = 15
const POLL_EVERY_MS = 4000
const PENDING_MAX_AGE_MS = 30 * 60_000
/** The last-confirmed date as it was before the owner left for Razorpay, or null if there is no recent pending payment (a marker older than 30 minutes is dropped, so an abandoned payment does not re-open this panel on every page load). */
function readPending(orgId: string): string | null {
  try {
    const raw = sessionStorage.getItem(PENDING_KEY(orgId))
    if (!raw) return null
    const v = JSON.parse(raw) as { b?: string; t?: number }
    if (typeof v.b !== "string" || typeof v.t !== "number" || Date.now() - v.t > PENDING_MAX_AGE_MS) {
      sessionStorage.removeItem(PENDING_KEY(orgId))
      return null
    }
    return v.b
  } catch { return null }
}
function writePending(orgId: string, baseline: string) {
  try { sessionStorage.setItem(PENDING_KEY(orgId), JSON.stringify({ b: baseline, t: Date.now() })) } catch { /* no storage: the page still pays, it just will not auto-check on return */ }
}
function clearPending(orgId: string) {
  try { sessionStorage.removeItem(PENDING_KEY(orgId)) } catch { /* nothing to clear */ }
}

function formatRupees(paise: number): string {
  return `Rs ${(paise / 100).toLocaleString("en-IN")}`
}

/** A yearly plan is up for renewal from 45 days before its anniversary (latest confirmed payment + 1 year). */
function renewalDue(lastConfirmedAt: string | null): boolean {
  if (!lastConfirmedAt) return false
  const renews = new Date(lastConfirmedAt)
  renews.setFullYear(renews.getFullYear() + 1)
  return Date.now() >= renews.getTime() - 45 * 86_400_000
}
function renewalDate(lastConfirmedAt: string | null): string {
  if (!lastConfirmedAt) return ""
  const renews = new Date(lastConfirmedAt)
  renews.setFullYear(renews.getFullYear() + 1)
  return renews.toLocaleDateString("en-IN")
}

function daysLeft(iso: string | null): number | null {
  if (!iso) return null
  const ms = new Date(iso).getTime() - Date.now()
  return Math.max(0, Math.ceil(ms / 86_400_000))
}

export function BillingPanel({ client, orgId }: { client: DpdpClient; orgId: string }) {
  const [open, setOpen] = useState(false)
  const [billing, setBilling] = useState<BillingStatusPayload | null | undefined>(undefined)
  const [chosen, setChosen] = useState<"month" | "year">("year")
  const [reference, setReference] = useState("")
  const [note, setNote] = useState("")
  const [proofFile, setProofFile] = useState<File | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [onlineOff, setOnlineOff] = useState(false)
  const [payStatus, setPayStatus] = useState<"idle" | "waiting" | "received" | "slow">("idle")

  useEffect(() => {
    let cancelled = false
    myBilling(client, orgId).then(
      (b) => { if (!cancelled) setBilling(b) },
      () => { if (!cancelled) setBilling(null) }, // not the owner, or not deployed yet -- the pill just doesn't show
    )
    return () => { cancelled = true }
  }, [client, orgId])

  // Coming back from Razorpay's page: payOnline() left a marker holding the last-confirmed date as it was BEFORE paying. The webhook (not this
  // browser) is what records the payment, so we poll the owner's own billing until that date changes, a few times, then stop and say so honestly.
  const loaded = billing !== undefined && billing !== null
  useEffect(() => {
    if (!loaded) return
    const baseline = readPending(orgId)
    if (baseline === null) return
    let cancelled = false
    ;(async () => {
      setOpen(true)
      setPayStatus("waiting")
      for (let i = 0; i < POLL_TRIES && !cancelled; i++) {
        try {
          const b = await myBilling(client, orgId)
          if (cancelled) return
          setBilling(b)
          if (b.state === "active" && (b.lastConfirmedAt ?? "none") !== baseline) {
            clearPending(orgId)
            setPayStatus("received")
            return
          }
        } catch { /* keep trying: a blip must not look like a failed payment */ }
        await new Promise((r) => setTimeout(r, POLL_EVERY_MS))
      }
      if (!cancelled) {
        clearPending(orgId)
        setPayStatus("slow")
      }
    })()
    return () => { cancelled = true }
  }, [loaded, client, orgId])

  if (billing === undefined || billing === null) return null

  async function payOnline() {
    if (!billing) return
    setBusy(true)
    setError(null)
    const r = await startOnlinePayment(client, orgId)
    if (!r.ok) {
      if (r.notEnabled) setOnlineOff(true)
      else setError(r.error)
      setBusy(false)
      return
    }
    writePending(orgId, billing.lastConfirmedAt ?? "none")
    window.location.assign(r.url)
  }

  async function pay() {
    setBusy(true)
    setError(null)
    try {
      const amount = chosen === "year" ? YEARLY_PAISE : MONTHLY_PAISE
      const proofPath = proofFile ? (await uploadPaymentProof(client, orgId, proofFile)) ?? undefined : undefined
      await declarePayment(client, chosen, amount, orgId, { reference: reference.trim(), note: note.trim(), proofPath })
      setBilling(await myBilling(client, orgId))
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  const amountDue = chosen === "year" ? YEARLY_PAISE : MONTHLY_PAISE
  const waMessage = encodeURIComponent(`VERIDIAN payment -- org ${orgId}, ${formatRupees(amountDue)} (${chosen}ly). Reference: ${reference || "(see attached)"}`)
  const proofMailto = paymentProofMailto({ orgId, amountLabel: formatRupees(amountDue), interval: chosen, reference })

  const trialDays = billing.state === "trial" ? daysLeft(billing.trialEndsAt) : null
  const pillLabel = payStatus === "waiting"
    ? "Billing: checking your payment…"
    : payStatus === "received"
    ? "Billing: payment received"
    : billing.state === "active"
    ? `Billing: active (${billing.interval === "year" ? "yearly" : "monthly"})`
    : billing.state === "awaiting_confirmation"
    ? "Billing: confirming your payment…"
    : trialDays === null
    ? "Billing"
    : trialDays === 0
    ? "Payment pending"
    : `Free trial -- ${trialDays} day${trialDays === 1 ? "" : "s"} left`

  return (
    <div style={{ position: "fixed", left: 14, bottom: 14, zIndex: 40, maxWidth: 320 }}>
      <button
        type="button" onClick={() => setOpen((o) => !o)}
        style={{
          background: "var(--dpdp-card)", border: "1px solid var(--dpdp-line)", borderRadius: 999,
          padding: "9px 14px", fontSize: 12.5, fontWeight: 600, color: "var(--dpdp-ink2)", boxShadow: "0 2px 10px rgba(0,0,0,0.08)",
        }}
      >
        💳 {pillLabel}
      </button>
      {open && (
        <div
          role="dialog" aria-label="Billing"
          style={{
            marginTop: 8, background: "var(--dpdp-card)", border: "1px solid var(--dpdp-line)", borderRadius: 16,
            padding: 16, boxShadow: "0 8px 28px rgba(0,0,0,0.14)", fontSize: 13.5, color: "var(--dpdp-ink2)",
          }}
        >
          {payStatus === "waiting" && (
            <p role="status" style={{ margin: "0 0 10px", fontWeight: 600, color: "var(--dpdp-ink)" }}>Waiting for your payment to be confirmed… this usually takes under a minute.</p>
          )}
          {payStatus === "received" && (
            <p role="status" style={{ margin: "0 0 10px", fontWeight: 700, color: "var(--dpdp-g, #0a7d4f)" }}>Payment received, thank you. We email a receipt to the owner's address.</p>
          )}
          {payStatus === "slow" && (
            <p role="status" style={{ margin: "0 0 10px" }}>
              We have not seen the confirmation yet. If you finished paying, it can take a few minutes: you can close this page and we will email your receipt.
              If nothing arrives within a day, write to {PAY_EMAIL}.
            </p>
          )}
          {billing.state === "active" ? (
            <>
              <p style={{ margin: "0 0 4px", fontWeight: 700, color: "var(--dpdp-ink)" }}>You're on the {billing.interval === "year" ? "yearly" : "monthly"} plan</p>
              {billing.lastConfirmedAt && <p style={{ margin: 0 }}>Confirmed {new Date(billing.lastConfirmedAt).toLocaleDateString("en-IN")}.</p>}
              {billing.interval === "year" && renewalDue(billing.lastConfirmedAt) && (
                <div style={{ marginTop: 10 }}>
                  <p style={{ margin: "0 0 6px" }}>Your yearly plan comes up for renewal on {renewalDate(billing.lastConfirmedAt)}.</p>
                  {onlineOff
                    ? <p style={{ margin: 0 }}>Online payment is not switched on yet. Please pay by bank transfer and email {PAY_EMAIL} with the reference.</p>
                    : (
                      <button type="button" onClick={payOnline} disabled={busy} style={{ background: "var(--dpdp-v)", color: "#fff", borderRadius: 10, padding: "9px 14px", fontWeight: 600, fontSize: 13.5 }}>
                        {busy ? "Opening…" : `Renew online -- ${formatRupees(YEARLY_PAISE)}`}
                      </button>
                    )}
                </div>
              )}
            </>
          ) : billing.state === "awaiting_confirmation" ? (
            <>
              <p style={{ margin: "0 0 4px", fontWeight: 700, color: "var(--dpdp-ink)" }}>Thanks -- we've noted your payment</p>
              <p style={{ margin: 0 }}>
                {billing.selfDeclaredAmountPaise != null && `${formatRupees(billing.selfDeclaredAmountPaise)} (${billing.selfDeclaredInterval === "year" ? "yearly" : "monthly"}), `}
                We usually confirm within 48 hours once we've seen the payment. Your account keeps working exactly as before in the meantime.
              </p>
              {billing.selfDeclaredReference && <p style={{ margin: "6px 0 0", fontSize: 12 }}>Reference: {billing.selfDeclaredReference}</p>}
              {billing.selfDeclaredProofPath && <p style={{ margin: "2px 0 0", fontSize: 12 }}>Screenshot attached.</p>}
            </>
          ) : (
            <>
              <p style={{ margin: "0 0 4px", fontWeight: 700, color: "var(--dpdp-ink)" }}>
                {trialDays === null ? "Choose a plan" : trialDays === 0 ? "Payment pending -- your free trial has ended" : `${trialDays} day${trialDays === 1 ? "" : "s"} left in your free trial`}
              </p>
              <p style={{ margin: "0 0 10px" }}>{trialDays === 0 ? "You can keep signing in and your data is safe. Please choose a plan below to continue." : "Nothing stops working when the trial ends -- this is just so you can plan ahead."}</p>
              <div className="flex gap-2 mb-3" role="radiogroup" aria-label="Plan">
                <label style={{ display: "flex", alignItems: "center", gap: 6, cursor: "pointer" }}>
                  <input type="radio" name="dpdp-plan" checked={chosen === "year"} onChange={() => setChosen("year")} /> Yearly -- {formatRupees(YEARLY_PAISE)}
                </label>
                <label style={{ display: "flex", alignItems: "center", gap: 6, cursor: "pointer" }}>
                  <input type="radio" name="dpdp-plan" checked={chosen === "month"} onChange={() => setChosen("month")} /> Monthly -- {formatRupees(MONTHLY_PAISE)}
                </label>
              </div>
              {chosen === "year" && (
                <div style={{ margin: "0 0 10px" }}>
                  {onlineOff ? (
                    <p style={{ margin: 0, fontSize: 12.5 }}>Online payment is not switched on yet. Please pay by bank transfer below.</p>
                  ) : (
                    <>
                      <button type="button" onClick={payOnline} disabled={busy} style={{ background: "var(--dpdp-v)", color: "#fff", borderRadius: 10, padding: "9px 14px", fontWeight: 600, fontSize: 13.5 }}>
                        {busy ? "Opening…" : `Pay online -- ${formatRupees(YEARLY_PAISE)} a year`}
                      </button>
                      <p style={{ margin: "6px 0 0", fontSize: 12 }}>
                        You go to Razorpay's own page to pay. Your card or UPI details are entered there, not on this site. We email a receipt once the payment is confirmed.
                      </p>
                    </>
                  )}
                </div>
              )}
              <div style={{ background: "var(--dpdp-bg2, #f6f5fb)", borderRadius: 10, padding: "10px 12px", margin: "0 0 10px", fontSize: 12.5 }}>
                <p style={{ margin: "0 0 6px", fontWeight: 600, color: "var(--dpdp-ink)" }}>{chosen === "year" ? "Or pay by UPI or bank transfer" : "Pay by UPI or bank transfer"}</p>
                <img src={PAY_QR_IMAGE} alt="UPI QR code" style={{ width: 96, height: 96, borderRadius: 8, marginBottom: 6 }}
                  onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = "none" }} />
                <p style={{ margin: "0 0 2px" }}>UPI: <strong>{PAY_UPI_ID}</strong></p>
                <p style={{ margin: 0 }}>Bank: {PAY_BANK.accountName}, A/C {PAY_BANK.accountNumber}, IFSC {PAY_BANK.ifsc}</p>
              </div>
              <label style={{ display: "block", margin: "0 0 6px" }}>
                Reference / UTR number (optional, helps us match it faster)
                <input type="text" value={reference} onChange={(e) => setReference(e.target.value)} placeholder="e.g. 12-digit UTR"
                  style={{ display: "block", width: "100%", marginTop: 3, padding: "6px 8px", borderRadius: 8, border: "1px solid var(--dpdp-line)", fontSize: 13 }} />
              </label>
              <label style={{ display: "block", margin: "0 0 6px" }}>
                Screenshot of the payment (optional)
                <input type="file" accept="image/*" onChange={(e) => setProofFile(e.target.files?.[0] ?? null)}
                  style={{ display: "block", width: "100%", marginTop: 3, fontSize: 12.5 }} />
              </label>
              <label style={{ display: "block", margin: "0 0 10px" }}>
                Anything else we should know? (optional)
                <textarea value={note} onChange={(e) => setNote(e.target.value)} rows={2}
                  style={{ display: "block", width: "100%", marginTop: 3, padding: "6px 8px", borderRadius: 8, border: "1px solid var(--dpdp-line)", fontSize: 13, resize: "vertical" }} />
              </label>
              <div style={{ display: "flex", gap: 8, marginBottom: 10 }}>
                <button type="button" onClick={pay} disabled={busy} style={{ background: "var(--dpdp-v)", color: "#fff", borderRadius: 10, padding: "9px 14px", fontWeight: 600, fontSize: 13.5 }}>
                  {busy ? "Saving…" : "I have paid by bank transfer"}
                </button>
                {PAY_WHATSAPP_NUMBER && (
                  <a href={`https://wa.me/${PAY_WHATSAPP_NUMBER}?text=${waMessage}`} target="_blank" rel="noreferrer"
                    style={{ alignSelf: "center", fontSize: 12.5, color: "var(--dpdp-v)", textDecoration: "underline" }}>
                    or send on WhatsApp
                  </a>
                )}
              </div>
              <p style={{ margin: 0, fontSize: 12 }}>
                Prefer email? <a href={proofMailto} style={{ color: "var(--dpdp-v)" }}>{PAY_EMAIL}</a> -- attach your screenshot there.
              </p>
            </>
          )}
          {error && <p role="alert" style={{ margin: "10px 0 0", color: "var(--dpdp-r)", fontWeight: 600 }}>{error}</p>}
          <button type="button" onClick={() => setOpen(false)} style={{ background: "transparent", color: "var(--dpdp-ink3)", textDecoration: "underline", fontSize: 12, marginTop: 10, display: "block" }}>Close</button>
        </div>
      )}
    </div>
  )
}
