import { useEffect, useState } from "react"
import type { DpdpClient } from "@/lib/client"
import { confirmOnlinePayment, declarePayment, fetchMyAccount, myBilling, startOnlinePayment, uploadPaymentProof } from "@/lib/api"
import { PayFrameError, payViaFrame } from "@/lib/pay-frame"
import type { BillingStatusPayload, MyAccountPayload, PayInterval } from "@/lib/rpc-types"
import { clientsLine, formatRupees, intervalWord, ladderLine, packLength, yearOffLabel } from "@/lib/billing-state"
import { parseDbTimestamp } from "@/lib/db-time"
import { PAY_EMAIL, paymentProofMailto } from "@/lib/payment-proof-mail"
import { BOX_K3 } from "@/lib/terms"
import { TermsCheckbox, TermsWhy } from "./TermsBox"
import { GuidedError } from "@/components/GuidedError"

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
// this for viewer.kind === "owner". "I've paid" is a claim, not a fact --
// the Owner's own manual confirmation (outside this app) is what actually
// moves an org to active.
//
// POLICY CHANGE 2026-10-06 (drizzle/0734, Owner decision in chat): an
// account that stays unpaid past its trial, the due day and a short grace
// is LOCKED, and its working screens give way to the Payment due screen
// (PaymentDue.tsx, which embeds this panel). Until then (trial, due, grace)
// everything works. The state and the price come from dpdp_my_account.
//
// The prices below are ONLY the fallback for an older organisation that has
// no account row yet (the plan table's Organisation price, Rs 999 a month and
// half of twelve months for a year). A real account's price is read through
// dpdp_my_account (the plan table, the trial pack, and for a Professional the
// number of clients); it is never typed into a screen.
const MONTHLY_PAISE = 99_900
const YEARLY_PAISE = 599_400

// Online payment (Razorpay, supabase/functions/dpdp-pay). The fallback prices above must equal the server's own (dpdp_plan_price_paise in
// drizzle/0755): the server charges ITS number, these are only what is shown, and src/lib/services/dpdp-pay-logic.test.ts fails if they differ.
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

/** A yearly plan is up for renewal from 45 days before its anniversary (latest confirmed payment + 1 year). */
function renewalDue(lastConfirmedAt: string | null): boolean {
  if (!lastConfirmedAt) return false
  const renews = parseDbTimestamp(lastConfirmedAt)
  renews.setFullYear(renews.getFullYear() + 1)
  return Date.now() >= renews.getTime() - 45 * 86_400_000
}
function renewalDate(lastConfirmedAt: string | null): string {
  if (!lastConfirmedAt) return ""
  const renews = parseDbTimestamp(lastConfirmedAt)
  renews.setFullYear(renews.getFullYear() + 1)
  return renews.toLocaleDateString("en-IN")
}

function daysLeft(iso: string | null): number | null {
  if (!iso) return null
  const ms = parseDbTimestamp(iso).getTime() - Date.now()
  return Math.max(0, Math.ceil(ms / 86_400_000))
}

export function BillingPanel({ client, orgId, inline = false }: { client: DpdpClient; orgId: string; inline?: boolean }) {
  const [open, setOpen] = useState(inline)
  const [account, setAccount] = useState<MyAccountPayload | null>(null)
  const [billing, setBilling] = useState<BillingStatusPayload | null | undefined>(undefined)
  const [chosen, setChosen] = useState<PayInterval | null>(null) // null = the default for this account (the pack if it is still on offer, else a year)
  const [reference, setReference] = useState("")
  const [note, setNote] = useState("")
  const [proofFile, setProofFile] = useState<File | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [onlineOff, setOnlineOff] = useState(false)
  const [payStatus, setPayStatus] = useState<"idle" | "waiting" | "received" | "slow">("idle")
  const [terms, setTerms] = useState(false) // K3: never pre-ticked

  useEffect(() => {
    let cancelled = false
    fetchMyAccount(client, orgId).then((a) => { if (!cancelled) setAccount(a) }, () => { /* an older database: the fallback prices below apply */ })
    return () => { cancelled = true }
  }, [client, orgId])

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

  async function payOnline(interval: PayInterval) {
    if (!billing || !terms) return
    setBusy(true)
    setError(null)
    const r = await startOnlinePayment(client, orgId, terms, interval)
    if (!r.ok) {
      if (r.notEnabled) setOnlineOff(true)
      else setError(r.error)
      setBusy(false)
      return
    }
    // Razorpay's window runs in the registered pay frame on top of this page; only its signed result comes back here.
    writePending(orgId, billing.lastConfirmedAt ?? "none")
    try {
      const resp = await payViaFrame(r.hop, r.opts)
      setPayStatus("waiting")
      const c = await confirmOnlinePayment(resp)
      clearPending(orgId)
      if (!c.ok) {
        setPayStatus("idle")
        setError(c.error)
      } else {
        setBilling(await myBilling(client, orgId))
        setPayStatus("received")
      }
    } catch (e) {
      clearPending(orgId)
      if (!(e instanceof PayFrameError && e.cancelled)) setError(e instanceof Error ? e.message : String(e))
    }
    setBusy(false)
  }

  async function pay() {
    setBusy(true)
    setError(null)
    try {
      const amount = amountDue
      const proofPath = proofFile ? (await uploadPaymentProof(client, orgId, proofFile)) ?? undefined : undefined
      await declarePayment(client, choice, amount, orgId, { reference: reference.trim(), note: note.trim(), proofPath })
      setBilling(await myBilling(client, orgId))
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  const price = account?.hasAccount && account.money ? account.money : null
  const monthPaise = price ? price.monthPaise : MONTHLY_PAISE
  const yearPaise = price ? price.yearPaise : YEARLY_PAISE
  const pack = price ? price.pack : null
  const packOffered = pack?.available === true
  const yearlyMonths = price ? price.yearlyMonthsCharged : YEARLY_PAISE / MONTHLY_PAISE
  const yearOff = yearOffLabel(yearlyMonths)
  // What was chosen; if nothing yet, the trial pack while it is on offer (it is the gentle first step), else a year.
  const choice: PayInterval = chosen === "pack" && !packOffered ? "year" : chosen ?? (packOffered ? "pack" : "year")
  const amountDue = choice === "pack" ? (pack?.pricePaise ?? 0) : choice === "year" ? yearPaise : monthPaise
  const intervalText = intervalWord(choice)
  const waMessage = encodeURIComponent(`VERIDIAN payment -- org ${orgId}, ${formatRupees(amountDue)} (${intervalText}). Reference: ${reference || "(see attached)"}`)
  const proofMailto = paymentProofMailto({ orgId, amountLabel: formatRupees(amountDue), interval: choice, reference })
  /** The whole ladder in one calm line, shown before anyone pays the pack so what comes after it is no surprise; built from the account's own numbers. */
  const ladder = pack && packOffered ? ladderLine({ monthlyPaise: monthPaise, yearlyMonthsCharged: yearlyMonths, packPricePaise: pack.pricePaise, packDays: pack.days }) : null
  const perClient = price && price.perClient.includedClients > 0 ? clientsLine({ includedClients: price.perClient.includedClients, extraClientMonthlyPaise: price.perClient.extraMonthlyPaise }) : null

  // Online payment charges the account's own price (drizzle/0755 dpdp__pay_begin_core). Only a client covered by its firm has nothing to pay itself.
  // An organisation with no account row (made before billing) can pay online for a year only; the server refuses a month or the pack for it.
  const noAccount = !(account?.hasAccount === true)
  const onlineUnavailable = onlineOff || (account?.hasAccount === true && account.coveredByFirm) || (noAccount && choice !== "year")
  const state = account?.hasAccount ? account.state : null
  const needsPayment = state === "DUE" || state === "GRACE" || state === "LOCKED"
  const onPack = pack?.onPack === true
  const trialDays = billing.state === "trial" ? daysLeft(billing.trialEndsAt) : null
  const pillLabel = payStatus === "waiting"
    ? "Billing: checking your payment…"
    : payStatus === "received"
    ? "Billing: payment received"
    : billing.state === "active"
    ? `Billing: active (${intervalWord(billing.interval)})`
    : billing.state === "awaiting_confirmation"
    ? "Billing: confirming your payment…"
    : trialDays === null
    ? "Billing"
    : trialDays === 0
    ? "Payment pending"
    : `Free trial -- ${trialDays} day${trialDays === 1 ? "" : "s"} left`

  return (
    <div style={inline ? { maxWidth: 420, margin: "0 auto" } : { position: "fixed", left: 14, bottom: 14, zIndex: 40, maxWidth: 320 }}>
      {!inline && (
      <button
        type="button" onClick={() => setOpen((o) => !o)}
        style={{
          background: "var(--dpdp-card)", border: "1px solid var(--dpdp-line)", borderRadius: 999,
          padding: "9px 14px", fontSize: 12.5, fontWeight: 600, color: "var(--dpdp-ink2)", boxShadow: "0 2px 10px rgba(0,0,0,0.08)",
        }}
      >
        💳 {state === "DUE" || state === "GRACE" ? "Payment due" : pillLabel}
      </button>
      )}
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
          {billing.state === "active" && !needsPayment && !onPack ? (
            <>
              <p style={{ margin: "0 0 4px", fontWeight: 700, color: "var(--dpdp-ink)" }}>You're on the {intervalWord(billing.interval)} plan</p>
              {billing.lastConfirmedAt && <p style={{ margin: 0 }}>Confirmed {parseDbTimestamp(billing.lastConfirmedAt).toLocaleDateString("en-IN")}.</p>}
              {billing.interval === "year" && renewalDue(billing.lastConfirmedAt) && (
                <div style={{ marginTop: 10 }}>
                  <p style={{ margin: "0 0 6px" }}>Your yearly plan comes up for renewal on {renewalDate(billing.lastConfirmedAt)}.</p>
                  {onlineOff
                    ? <p style={{ margin: 0 }}>Online payment is not switched on yet. Please pay by bank transfer and email {PAY_EMAIL} with the reference.</p>
                    : (
                      <>
                        <TermsCheckbox box={BOX_K3} checked={terms} onChange={setTerms} disabled={busy} />
                        <button type="button" onClick={() => void payOnline("year")} disabled={busy || !terms} aria-describedby={terms ? undefined : "terms-why-k3"} style={{ background: "var(--dpdp-v)", color: "#fff", borderRadius: 10, padding: "9px 14px", fontWeight: 600, fontSize: 13.5, opacity: busy || !terms ? 0.6 : 1 }}>
                          {busy ? "Opening…" : `Renew online -- ${formatRupees(yearPaise)}`}
                        </button>
                        <TermsWhy id="terms-why-k3" ticked={terms} />
                      </>
                    )}
                </div>
              )}
            </>
          ) : billing.state === "awaiting_confirmation" ? (
            <>
              <p style={{ margin: "0 0 4px", fontWeight: 700, color: "var(--dpdp-ink)" }}>Thanks -- we've noted your payment</p>
              <p style={{ margin: 0 }}>
                {billing.selfDeclaredAmountPaise != null && `${formatRupees(billing.selfDeclaredAmountPaise)} (${intervalWord(billing.selfDeclaredInterval)}), `}
                We usually confirm within 48 hours once we've seen the payment.
              </p>
              {billing.selfDeclaredReference && <p style={{ margin: "6px 0 0", fontSize: 12 }}>Reference: {billing.selfDeclaredReference}</p>}
              {billing.selfDeclaredProofPath && <p style={{ margin: "2px 0 0", fontSize: 12 }}>Screenshot attached.</p>}
            </>
          ) : (
            <>
              <p style={{ margin: "0 0 4px", fontWeight: 700, color: "var(--dpdp-ink)" }}>
                {needsPayment || trialDays === 0
                  ? "Payment is due for this account"
                  : onPack ? `You're on the trial pack${price?.paidUntil ? `, to ${price.paidUntil}` : ""}`
                  : trialDays === null ? "Choose a plan" : `${trialDays} day${trialDays === 1 ? "" : "s"} left in your free trial`}
              </p>
              <p style={{ margin: "0 0 10px" }}>
                {state === "LOCKED"
                  ? "Your data is safe. Everything opens again as soon as we have seen the payment."
                  : needsPayment || trialDays === 0
                  ? "Everything still works for now, and your data is safe. Please pay when you can so it stays that way."
                  : onPack
                  ? "Everything works. To carry on after the pack, or to add more clients than it covers, start a month or a year now: the time is added after the pack ends."
                  : "Everything works during the trial. Paying before it ends keeps it that way."}
              </p>
              {ladder && (
                <p style={{ margin: "0 0 10px", fontWeight: 600, color: "var(--dpdp-ink)" }}>
                  The whole price, up front: {ladder}{perClient ? ` ${perClient}` : ""}{pack && account?.hasAccount && account.accountType === "firm" ? ` The trial pack covers up to ${pack.maxClients} clients.` : ""}
                </p>
              )}
              {!ladder && perClient && <p style={{ margin: "0 0 10px" }}>{perClient}</p>}
              {price?.offerLabel && <p style={{ margin: "0 0 8px", fontWeight: 600, color: "var(--dpdp-v)" }}>{price.offerLabel}</p>}
              <div className="flex gap-3 mb-3 flex-wrap" role="radiogroup" aria-label="Plan">
                {packOffered && pack && (
                  <label style={{ display: "flex", alignItems: "center", gap: 6, cursor: "pointer" }}>
                    <input type="radio" name="dpdp-plan" checked={choice === "pack"} onChange={() => setChosen("pack")} /> Trial pack -- {formatRupees(pack.pricePaise)} for {packLength(pack.days)}
                  </label>
                )}
                <label style={{ display: "flex", alignItems: "center", gap: 6, cursor: "pointer" }}>
                  <input type="radio" name="dpdp-plan" checked={choice === "month"} onChange={() => setChosen("month")} /> Monthly -- {formatRupees(monthPaise)}
                </label>
                <label style={{ display: "flex", alignItems: "center", gap: 6, cursor: "pointer" }}>
                  <input type="radio" name="dpdp-plan" checked={choice === "year"} onChange={() => setChosen("year")} /> Yearly -- {formatRupees(yearPaise)}{yearOff ? ` (${yearOff})` : ""}
                </label>
              </div>
              <div style={{ margin: "0 0 10px" }}>
                {onlineUnavailable ? (
                  <p style={{ margin: 0, fontSize: 12.5 }}>{onlineOff ? "Online payment is not switched on yet. Please pay by bank transfer below." : "Please pay by bank transfer below."}</p>
                ) : (
                  <>
                    <TermsCheckbox box={BOX_K3} checked={terms} onChange={setTerms} disabled={busy} />
                    <button type="button" onClick={() => void payOnline(choice)} disabled={busy || !terms} aria-describedby={terms ? undefined : "terms-why-k3"} style={{ background: "var(--dpdp-v)", color: "#fff", borderRadius: 10, padding: "9px 14px", fontWeight: 600, fontSize: 13.5, opacity: busy || !terms ? 0.6 : 1 }}>
                      {busy ? "Opening…" : `Pay online -- ${formatRupees(amountDue)} ${choice === "pack" ? `for ${packLength(pack?.days ?? 0)}` : choice === "year" ? "a year" : "a month"}`}
                    </button>
                    <TermsWhy id="terms-why-k3" ticked={terms} />
                    <p style={{ margin: "6px 0 0", fontSize: 12 }}>
                      You go to Razorpay's own page to pay. Your card or UPI details are entered there, not on this site. We email a receipt once the payment is confirmed.
                    </p>
                  </>
                )}
              </div>
              <div style={{ background: "var(--dpdp-bg2, #f6f5fb)", borderRadius: 10, padding: "10px 12px", margin: "0 0 10px", fontSize: 12.5 }}>
                <p style={{ margin: "0 0 6px", fontWeight: 600, color: "var(--dpdp-ink)" }}>{onlineUnavailable ? "Pay by UPI or bank transfer" : "Or pay by UPI or bank transfer"}</p>
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
          {error && <GuidedError message={error} />}
          <button type="button" onClick={() => setOpen(false)} style={{ background: "transparent", color: "var(--dpdp-ink3)", textDecoration: "underline", fontSize: 12, marginTop: 10, display: "block" }}>Close</button>
        </div>
      )}
    </div>
  )
}
