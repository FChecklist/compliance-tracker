import { useEffect, useState } from "react"
import type { DpdpClient } from "@/lib/client"
import { confirmOnlinePayment, fetchMyAccount, myBilling, startOnlinePayment } from "@/lib/api"
import { PayFrameError, payViaFrame } from "@/lib/pay-frame"
import type { BillingStatusPayload, MyAccountPayload, PayInterval } from "@/lib/rpc-types"
import { clientsLine, formatRupees, intervalWord, ladderLine, packLength, yearAsMonthlyPhrase, yearlyPerClientLine, yearOffLabel } from "@/lib/billing-state"
import { parseDbTimestamp } from "@/lib/db-time"
import { PAY_EMAIL } from "@/lib/payment-proof-mail"
import { BOX_K3 } from "@/lib/terms"
import { TermsCheckbox, TermsWhy } from "./TermsBox"
import { GuidedError } from "@/components/GuidedError"

// WO-DPDP-016 §7-8: the billing widget, lower-left of the owner's own page
// (Owner instruction, this session). Owner-only -- App.tsx only renders
// this for viewer.kind === "owner".
//
// ONE WAY TO PAY (Owner decision, 2026-11-02): the same flow as Corporate Tambola -- choose the trial pack, a month or a year, press pay, Razorpay's
// window opens, the person pays, and Razorpay tells us (the browser's signed result through /dpdp-pay/verify, and the webhook as the backstop); the
// account is then made paid and active. Nothing else is offered here: no manual transfer details and no payment-claim button. The only address the
// panel names is the one public DPDP mailbox (PAY_EMAIL, src/lib/payment-proof-mail.ts), for a person who needs help.
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

/** onPaid: told once, right after the server has confirmed a payment made in this panel (the Payment due screen uses it to open the working screens again). */
export function BillingPanel({ client, orgId, inline = false, onPaid }: { client: DpdpClient; orgId: string; inline?: boolean; onPaid?: () => void }) {
  const [open, setOpen] = useState(inline)
  const [account, setAccount] = useState<MyAccountPayload | null>(null)
  const [billing, setBilling] = useState<BillingStatusPayload | null | undefined>(undefined)
  const [chosen, setChosen] = useState<PayInterval | null>(null) // null = the default for this account (the pack if it is still on offer, else a year)
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
            const a = await fetchMyAccount(client, orgId).catch(() => null) // the plan, the state and the price move with the payment
            if (!cancelled && a) setAccount(a)
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

  /** Reads the billing state AND the account again, so the pill, the plan line and the price show the payment without a page reload. A read that fails changes nothing. */
  async function reread(): Promise<void> {
    const [b, a] = await Promise.allSettled([myBilling(client, orgId), fetchMyAccount(client, orgId)])
    if (b.status === "fulfilled") setBilling(b.value)
    if (a.status === "fulfilled" && a.value) setAccount(a.value)
  }

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
        await reread()
        setPayStatus("received")
        onPaid?.()
      }
    } catch (e) {
      clearPending(orgId)
      if (!(e instanceof PayFrameError && e.cancelled)) setError(e instanceof Error ? e.message : String(e))
    }
    setBusy(false)
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
  /** The whole ladder in one calm line, shown before anyone pays the pack so what comes after it is no surprise; built from the account's own numbers. */
  const ladder = pack && packOffered ? ladderLine({ monthlyPaise: monthPaise, yearlyMonthsCharged: yearlyMonths, packPricePaise: pack.pricePaise, packDays: pack.days }) : null
  const perClient = price && price.perClient.includedClients > 0 ? clientsLine({ includedClients: price.perClient.includedClients, extraClientMonthlyPaise: price.perClient.extraMonthlyPaise, yearlyMonthsCharged: yearlyMonths }) : null
  /** The "per client per month" line for the YEARLY plan only (never claimed for monthly); computed from the base price, not the account's total. */
  const yearlyPerClient = price && price.perClient.includedClients > 0 ? yearlyPerClientLine({ monthlyPaise: price.baseMonthlyPaise, yearlyMonthsCharged: yearlyMonths, includedClients: price.perClient.includedClients }) : null
  /** "effectively about ... a month" beside the yearly figure, said for the account's own yearly total. */
  const yearEffective = yearAsMonthlyPhrase(monthPaise, yearlyMonths)

  // Online payment charges the account's own price (drizzle/0755 dpdp__pay_begin_core). Only a client covered by its firm has nothing to pay itself.
  // An organisation with no account row (made before billing) can pay online for a year only; the server refuses a month or the pack for it.
  const noAccount = !(account?.hasAccount === true)
  const coveredByFirm = account?.hasAccount === true && account.coveredByFirm
  const yearOnly = noAccount && choice !== "year"
  /** What the person sees when the Razorpay window cannot be opened (the service is switched off, or the connection dropped). There is nothing else to pay with; "Try again" clears the sticky flag. */
  const onlineOffNote = (
    <div role="status">
      <p style={{ margin: "0 0 6px", fontSize: 12.5 }}>Online payment is not available right now. Please try again in a few minutes, or write to {PAY_EMAIL} and we will help.</p>
      <button type="button" onClick={() => setOnlineOff(false)} style={{ background: "transparent", color: "var(--dpdp-v)", textDecoration: "underline", fontSize: 12.5 }}>Try again</button>
    </div>
  )
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
                    ? onlineOffNote
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
                  The whole price, up front: {ladder}{perClient ? ` ${perClient}` : ""}{yearlyPerClient ? ` ${yearlyPerClient}` : ""}{pack && account?.hasAccount && account.accountType === "firm" ? ` The trial pack covers up to ${pack.maxClients} clients.` : ""}
                </p>
              )}
              {!ladder && perClient && <p style={{ margin: "0 0 10px" }}>{perClient}{yearlyPerClient ? ` ${yearlyPerClient}` : ""}</p>}
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
                  <input type="radio" name="dpdp-plan" checked={choice === "year"} onChange={() => setChosen("year")} /> Yearly -- {formatRupees(yearPaise)}{yearOff ? ` (${yearOff}${yearEffective ? `, ${yearEffective}` : ""})` : ""}
                </label>
              </div>
              <div style={{ margin: "0 0 10px" }}>
                {onlineOff ? onlineOffNote : coveredByFirm ? (
                  <p style={{ margin: 0, fontSize: 12.5 }}>Your firm covers this organisation, so there is nothing for you to pay here.</p>
                ) : yearOnly ? (
                  <p style={{ margin: 0, fontSize: 12.5 }}>For this organisation, online payment is for the yearly plan. Please choose Yearly.</p>
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
            </>
          )}
          {error && <GuidedError message={error} />}
          <button type="button" onClick={() => setOpen(false)} style={{ background: "transparent", color: "var(--dpdp-ink3)", textDecoration: "underline", fontSize: 12, marginTop: 10, display: "block" }}>Close</button>
        </div>
      )}
    </div>
  )
}
