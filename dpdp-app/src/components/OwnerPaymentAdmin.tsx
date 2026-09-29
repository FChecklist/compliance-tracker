import { useEffect, useState } from "react"
import type { DpdpClient } from "@/lib/client"
import { amIPlatformAdmin, ownerApprovePayment, ownerPendingClaims, ownerRejectPayment, sendInvoiceEmail } from "@/lib/api"
import type { PendingClaimWire } from "@/lib/rpc-types"

// Payment confirmation flow (drizzle/0658) -- VERIDIAN's own review
// screen, not any one organisation's. Renders nothing for anyone who
// isn't dpdp.platform_admin (checked server-side by every RPC this
// component calls; amIPlatformAdmin is only asked here so the button
// row doesn't flash and immediately 403 for everyone else). Lives
// bottom-right so it never collides with BillingPanel's own pill
// (bottom-left, one org's own billing).
function formatRupees(paise: number | null): string {
  return paise == null ? "--" : `Rs ${(paise / 100).toLocaleString("en-IN")}`
}

export function OwnerPaymentAdmin({ client }: { client: DpdpClient }) {
  const [isAdmin, setIsAdmin] = useState<boolean | null>(null)
  const [open, setOpen] = useState(false)
  const [claims, setClaims] = useState<PendingClaimWire[]>([])
  const [busyOrgId, setBusyOrgId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)

  async function refresh() {
    try {
      setClaims(await ownerPendingClaims(client))
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    }
  }

  useEffect(() => {
    let cancelled = false
    amIPlatformAdmin(client).then((v) => {
      if (cancelled) return
      setIsAdmin(v)
      if (v) void refresh()
    })
    return () => { cancelled = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [client])

  if (!isAdmin) return null

  async function approve(orgId: string) {
    setBusyOrgId(orgId)
    setError(null)
    setNotice(null)
    try {
      const result = await ownerApprovePayment(client, orgId)
      const invoice = await sendInvoiceEmail(client, result.paymentId)
      setNotice(invoice.ok ? "Approved -- invoice sent." : `Approved -- invoice email failed (${invoice.error}). Payment is still confirmed; you can tell the customer directly.`)
      await refresh()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusyOrgId(null)
    }
  }

  async function reject(orgId: string) {
    setBusyOrgId(orgId)
    setError(null)
    setNotice(null)
    try {
      await ownerRejectPayment(client, orgId)
      setNotice("Sent back to trial -- they can submit again.")
      await refresh()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusyOrgId(null)
    }
  }

  return (
    <div style={{ position: "fixed", right: 14, bottom: 14, zIndex: 40, maxWidth: 380 }}>
      <button
        type="button" onClick={() => { setOpen((o) => !o); void refresh() }}
        style={{
          background: "var(--dpdp-card)", border: "1px solid var(--dpdp-line)", borderRadius: 999,
          padding: "9px 14px", fontSize: 12.5, fontWeight: 600, color: "var(--dpdp-ink2)", boxShadow: "0 2px 10px rgba(0,0,0,0.08)",
        }}
      >
        💰 Payments awaiting confirmation{claims.length > 0 ? ` (${claims.length})` : ""}
      </button>
      {open && (
        <div
          role="dialog" aria-label="Payments awaiting confirmation"
          style={{
            marginTop: 8, background: "var(--dpdp-card)", border: "1px solid var(--dpdp-line)", borderRadius: 16,
            padding: 16, boxShadow: "0 8px 28px rgba(0,0,0,0.14)", fontSize: 13.5, color: "var(--dpdp-ink2)", maxHeight: "70vh", overflowY: "auto",
          }}
        >
          <p style={{ margin: "0 0 10px", fontWeight: 700, color: "var(--dpdp-ink)" }}>Payments awaiting confirmation</p>
          {claims.length === 0 && <p style={{ margin: 0, fontSize: 12.5 }}>Nothing waiting right now.</p>}
          {claims.map((c) => (
            <div key={c.orgId} style={{ border: "1px solid var(--dpdp-line)", borderRadius: 10, padding: "10px 12px", marginBottom: 10 }}>
              <p style={{ margin: "0 0 2px", fontWeight: 600, color: "var(--dpdp-ink)" }}>{c.orgName}</p>
              <p style={{ margin: "0 0 2px", fontSize: 12 }}>{c.product === "institution" ? "Institution" : "Firm"} edition -- {c.ownerEmail ?? "(no owner email on file)"}</p>
              <p style={{ margin: "0 0 2px", fontSize: 12 }}>{formatRupees(c.amountPaise)} ({c.interval === "year" ? "yearly" : "monthly"})</p>
              {c.reference && <p style={{ margin: "0 0 2px", fontSize: 12 }}>Reference: {c.reference}</p>}
              {c.proofPath && (
                <p style={{ margin: "0 0 2px", fontSize: 12 }}>
                  Screenshot: <code style={{ fontSize: 11 }}>{c.proofPath}</code> (Storage -- dpdp-payment-proofs)
                </p>
              )}
              {c.note && <p style={{ margin: "0 0 2px", fontSize: 12, fontStyle: "italic" }}>"{c.note}"</p>}
              {c.declaredAt && <p style={{ margin: "0 0 6px", fontSize: 11, color: "var(--dpdp-ink3)" }}>Declared {new Date(c.declaredAt).toLocaleString("en-IN")}</p>}
              <div style={{ display: "flex", gap: 8 }}>
                <button type="button" onClick={() => void approve(c.orgId)} disabled={busyOrgId === c.orgId}
                  style={{ background: "var(--dpdp-v)", color: "#fff", borderRadius: 8, padding: "6px 12px", fontWeight: 600, fontSize: 12.5 }}>
                  {busyOrgId === c.orgId ? "Working…" : "Approve"}
                </button>
                <button type="button" onClick={() => void reject(c.orgId)} disabled={busyOrgId === c.orgId}
                  style={{ background: "transparent", color: "var(--dpdp-r)", border: "1px solid var(--dpdp-r)", borderRadius: 8, padding: "6px 12px", fontWeight: 600, fontSize: 12.5 }}>
                  Can't confirm
                </button>
              </div>
            </div>
          ))}
          {notice && <p style={{ margin: "6px 0 0", color: "var(--dpdp-v)", fontWeight: 600, fontSize: 12.5 }}>{notice}</p>}
          {error && <p role="alert" style={{ margin: "6px 0 0", color: "var(--dpdp-r)", fontWeight: 600, fontSize: 12.5 }}>{error}</p>}
          <button type="button" onClick={() => setOpen(false)} style={{ background: "transparent", color: "var(--dpdp-ink3)", textDecoration: "underline", fontSize: 12, marginTop: 10, display: "block" }}>Close</button>
        </div>
      )}
    </div>
  )
}
