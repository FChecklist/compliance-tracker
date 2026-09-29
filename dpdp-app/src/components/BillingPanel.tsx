import { useEffect, useState } from "react"
import type { DpdpClient } from "@/lib/client"
import { declarePayment, myBilling } from "@/lib/api"
import type { BillingStatusPayload } from "@/lib/rpc-types"

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

function formatRupees(paise: number): string {
  return `Rs ${(paise / 100).toLocaleString("en-IN")}`
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
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    myBilling(client, orgId).then(
      (b) => { if (!cancelled) setBilling(b) },
      () => { if (!cancelled) setBilling(null) }, // not the owner, or not deployed yet -- the pill just doesn't show
    )
    return () => { cancelled = true }
  }, [client, orgId])

  if (billing === undefined || billing === null) return null

  async function pay() {
    setBusy(true)
    setError(null)
    try {
      const amount = chosen === "year" ? YEARLY_PAISE : MONTHLY_PAISE
      await declarePayment(client, chosen, amount, orgId)
      setBilling(await myBilling(client, orgId))
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  const trialDays = billing.state === "trial" ? daysLeft(billing.trialEndsAt) : null
  const pillLabel = billing.state === "active"
    ? `Billing: active (${billing.interval === "year" ? "yearly" : "monthly"})`
    : billing.state === "awaiting_confirmation"
    ? "Billing: confirming your payment…"
    : trialDays === null
    ? "Billing"
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
          {billing.state === "active" ? (
            <>
              <p style={{ margin: "0 0 4px", fontWeight: 700, color: "var(--dpdp-ink)" }}>You're on the {billing.interval === "year" ? "yearly" : "monthly"} plan</p>
              {billing.lastConfirmedAt && <p style={{ margin: 0 }}>Confirmed {new Date(billing.lastConfirmedAt).toLocaleDateString("en-IN")}.</p>}
            </>
          ) : billing.state === "awaiting_confirmation" ? (
            <>
              <p style={{ margin: "0 0 4px", fontWeight: 700, color: "var(--dpdp-ink)" }}>Thanks -- we've noted your payment</p>
              <p style={{ margin: 0 }}>
                {billing.selfDeclaredAmountPaise != null && `${formatRupees(billing.selfDeclaredAmountPaise)} (${billing.selfDeclaredInterval === "year" ? "yearly" : "monthly"}), `}
                We usually confirm within 48 hours once we've seen the payment. Your account keeps working exactly as before in the meantime.
              </p>
            </>
          ) : (
            <>
              <p style={{ margin: "0 0 4px", fontWeight: 700, color: "var(--dpdp-ink)" }}>
                {trialDays === null ? "Choose a plan" : `${trialDays} day${trialDays === 1 ? "" : "s"} left in your free trial`}
              </p>
              <p style={{ margin: "0 0 10px" }}>Nothing stops working when the trial ends -- this is just so you can plan ahead.</p>
              <div className="flex gap-2 mb-3" role="radiogroup" aria-label="Plan">
                <label style={{ display: "flex", alignItems: "center", gap: 6, cursor: "pointer" }}>
                  <input type="radio" name="dpdp-plan" checked={chosen === "year"} onChange={() => setChosen("year")} /> Yearly -- {formatRupees(YEARLY_PAISE)}
                </label>
                <label style={{ display: "flex", alignItems: "center", gap: 6, cursor: "pointer" }}>
                  <input type="radio" name="dpdp-plan" checked={chosen === "month"} onChange={() => setChosen("month")} /> Monthly -- {formatRupees(MONTHLY_PAISE)}
                </label>
              </div>
              <p style={{ margin: "0 0 10px", fontSize: 12.5 }}>We'll send payment details separately. Once you've paid, tell us here:</p>
              <button type="button" onClick={pay} disabled={busy} style={{ background: "var(--dpdp-v)", color: "#fff", borderRadius: 10, padding: "9px 14px", fontWeight: 600, fontSize: 13.5 }}>
                {busy ? "Saving…" : "I've paid"}
              </button>
            </>
          )}
          {error && <p role="alert" style={{ margin: "10px 0 0", color: "var(--dpdp-r)", fontWeight: 600 }}>{error}</p>}
          <button type="button" onClick={() => setOpen(false)} style={{ background: "transparent", color: "var(--dpdp-ink3)", textDecoration: "underline", fontSize: 12, marginTop: 10, display: "block" }}>Close</button>
        </div>
      )}
    </div>
  )
}
