import { useEffect, useState } from "react"
import type { DpdpClient } from "@/lib/client"
import { amIPlatformAdmin, ownerMarkPaid, ownerPendingVerifications, ownerVerifyFirm } from "@/lib/api"
import type { PendingVerificationWire } from "@/lib/rpc-types"
import { parseDbTimestamp } from "@/lib/db-time"

// The platform owner's account screen (drizzle/0734): check a firm's professional membership, and mark an account paid. Renders nothing for
// anyone who is not dpdp.platform_admin; every RPC re-checks that server-side and writes to the audit trail. Stacked above the payments pill.
export function OwnerAccountsAdmin({ client }: { client: DpdpClient }) {
  const [isAdmin, setIsAdmin] = useState<boolean | null>(null)
  const [open, setOpen] = useState(false)
  const [pending, setPending] = useState<PendingVerificationWire[]>([])
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [payOrg, setPayOrg] = useState("")
  const [payInterval, setPayInterval] = useState<"month" | "year">("month")
  const [payRef, setPayRef] = useState("")
  const [payUntil, setPayUntil] = useState("")

  async function refresh() {
    try {
      setPending(await ownerPendingVerifications(client))
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

  async function decide(orgId: string, decision: "verified" | "rejected") {
    setBusy(orgId)
    setError(null)
    setNotice(null)
    try {
      await ownerVerifyFirm(client, orgId, decision)
      setNotice(decision === "verified" ? "Verified. Their own file can now be on the free plan." : "Not accepted. They stay on a paid plan.")
      await refresh()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(null)
    }
  }

  async function markPaid() {
    setBusy("pay")
    setError(null)
    setNotice(null)
    try {
      await ownerMarkPaid(client, payOrg.trim(), payInterval, { paidUntil: payUntil || null, reference: payRef })
      setNotice("Marked paid. The account is active.")
      setPayOrg("")
      setPayRef("")
      setPayUntil("")
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(null)
    }
  }

  const field = { display: "block", width: "100%", marginTop: 3, padding: "6px 8px", borderRadius: 8, border: "1px solid var(--dpdp-line)", fontSize: 13 } as const
  return (
    <div style={{ position: "fixed", right: 14, bottom: 98, zIndex: 40, maxWidth: 380 }}>
      <button
        type="button" onClick={() => { setOpen((o) => !o); void refresh() }}
        style={{ background: "var(--dpdp-card)", border: "1px solid var(--dpdp-line)", borderRadius: 999, padding: "9px 14px", fontSize: 12.5, fontWeight: 600, color: "var(--dpdp-ink2)", boxShadow: "0 2px 10px rgba(0,0,0,0.08)" }}
      >
        🏷️ Accounts{pending.length > 0 ? ` (${pending.length} to check)` : ""}
      </button>
      {open && (
        <div role="dialog" aria-label="Accounts" style={{ marginTop: 8, background: "var(--dpdp-card)", border: "1px solid var(--dpdp-line)", borderRadius: 16, padding: 16, boxShadow: "0 8px 28px rgba(0,0,0,0.14)", fontSize: 13.5, color: "var(--dpdp-ink2)", maxHeight: "70vh", overflowY: "auto" }}>
          <p style={{ margin: "0 0 10px", fontWeight: 700, color: "var(--dpdp-ink)" }}>Firms waiting to be checked</p>
          {pending.length === 0 && <p style={{ margin: 0, fontSize: 12.5 }}>Nothing waiting right now.</p>}
          {pending.map((p) => (
            <div key={p.orgId} style={{ border: "1px solid var(--dpdp-line)", borderRadius: 10, padding: "10px 12px", marginBottom: 10 }}>
              <p style={{ margin: "0 0 2px", fontWeight: 600, color: "var(--dpdp-ink)" }}>{p.orgName}</p>
              <p style={{ margin: "0 0 2px", fontSize: 12 }}>{p.professionalBody}: {p.registrationNo}</p>
              <p style={{ margin: "0 0 6px", fontSize: 11, color: "var(--dpdp-ink3)" }}>Asked {parseDbTimestamp(p.requestedAt).toLocaleDateString("en-IN")}</p>
              <div style={{ display: "flex", gap: 8 }}>
                <button type="button" disabled={busy === p.orgId} onClick={() => void decide(p.orgId, "verified")} style={{ background: "var(--dpdp-v)", color: "#fff", borderRadius: 8, padding: "6px 12px", fontWeight: 600, fontSize: 12.5 }}>Verified</button>
                <button type="button" disabled={busy === p.orgId} onClick={() => void decide(p.orgId, "rejected")} style={{ background: "transparent", color: "var(--dpdp-r)", border: "1px solid var(--dpdp-r)", borderRadius: 8, padding: "6px 12px", fontWeight: 600, fontSize: 12.5 }}>Can&rsquo;t verify</button>
              </div>
            </div>
          ))}
          <p style={{ margin: "14px 0 6px", fontWeight: 700, color: "var(--dpdp-ink)" }}>Mark an account paid</p>
          <label style={{ display: "block", marginBottom: 6 }}>Organisation id
            <input style={field} value={payOrg} onChange={(e) => setPayOrg(e.target.value)} autoComplete="off" />
          </label>
          <label style={{ display: "block", marginBottom: 6 }}>Paid for
            <select style={field} value={payInterval} onChange={(e) => setPayInterval(e.target.value as "month" | "year")}>
              <option value="month">One month</option>
              <option value="year">One year</option>
            </select>
          </label>
          <label style={{ display: "block", marginBottom: 6 }}>Reference (optional)
            <input style={field} value={payRef} onChange={(e) => setPayRef(e.target.value)} autoComplete="off" />
          </label>
          <label style={{ display: "block", marginBottom: 8 }}>Paid until (optional, otherwise worked out)
            <input style={field} type="date" value={payUntil} onChange={(e) => setPayUntil(e.target.value)} />
          </label>
          <button type="button" disabled={busy === "pay" || payOrg.trim() === ""} onClick={() => void markPaid()} style={{ background: "var(--dpdp-v)", color: "#fff", borderRadius: 8, padding: "7px 14px", fontWeight: 600, fontSize: 13 }}>
            {busy === "pay" ? "Working…" : "Mark paid"}
          </button>
          {notice && <p style={{ margin: "8px 0 0", color: "var(--dpdp-v)", fontWeight: 600, fontSize: 12.5 }}>{notice}</p>}
          {error && <p role="alert" style={{ margin: "8px 0 0", color: "var(--dpdp-r)", fontWeight: 600, fontSize: 12.5 }}>{error}</p>}
          <button type="button" onClick={() => setOpen(false)} style={{ background: "transparent", color: "var(--dpdp-ink3)", textDecoration: "underline", fontSize: 12, marginTop: 10, display: "block" }}>Close</button>
        </div>
      )}
    </div>
  )
}
