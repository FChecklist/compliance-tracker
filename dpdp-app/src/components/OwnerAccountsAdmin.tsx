import { useEffect, useState } from "react"
import type { DpdpClient } from "@/lib/client"
import { amIPlatformAdmin, fetchPlatformMode, ownerDeclaredFirms, ownerDowngradeFirm, ownerMailAllowlist, ownerMarkPaid, ownerPurgeTestData, ownerSetMode } from "@/lib/api"
import type { DeclaredFirmWire, PlatformModePayload } from "@/lib/rpc-types"
import { forgetCachedMode } from "@/lib/platform-mode"
import { parseDbTimestamp } from "@/lib/db-time"

// The platform owner's account screen (drizzle/0734, 0735): the firms that declared themselves practitioners (with an audited downgrade to paid), "mark paid",
// and the Test / Live switch with its e-mail allowlist and purge. Nobody verifies a firm in advance. Renders nothing for
// anyone who is not dpdp.platform_admin; every RPC re-checks that server-side and writes to the audit trail. Stacked above the payments pill.
export function OwnerAccountsAdmin({ client }: { client: DpdpClient }) {
  const [isAdmin, setIsAdmin] = useState<boolean | null>(null)
  const [open, setOpen] = useState(false)
  const [firms, setFirms] = useState<DeclaredFirmWire[]>([])
  const [mode, setModeState] = useState<PlatformModePayload | null>(null)
  const [allow, setAllow] = useState<Array<{ email: string; note: string | null }>>([])
  const [allowNew, setAllowNew] = useState("")
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [payOrg, setPayOrg] = useState("")
  const [payInterval, setPayInterval] = useState<"month" | "year">("month")
  const [payRef, setPayRef] = useState("")
  const [payUntil, setPayUntil] = useState("")

  async function refresh() {
    try {
      setFirms(await ownerDeclaredFirms(client, "live"))
      setModeState(await fetchPlatformMode(client))
      setAllow(await ownerMailAllowlist(client, "list"))
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

  async function downgrade(orgId: string) {
    setBusy(orgId)
    setError(null)
    setNotice(null)
    try {
      await ownerDowngradeFirm(client, orgId, "abuse review")
      setNotice("Moved to a paid plan. It is in the audit trail.")
      await refresh()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(null)
    }
  }

  async function switchMode(next: "TEST" | "LIVE") {
    setBusy("mode")
    setError(null)
    setNotice(null)
    try {
      const m = await ownerSetMode(client, next, "switched from the owner screen")
      forgetCachedMode()
      setModeState(m)
      setNotice(next === "TEST" ? "Test mode is on. New accounts are practice accounts and only the allowlist is e-mailed." : "Live mode is on.")
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(null)
    }
  }

  async function purge() {
    if (!window.confirm("Delete every test account and its data? Real accounts and the audit trail are not touched.")) return
    setBusy("purge")
    setError(null)
    setNotice(null)
    try {
      const r = await ownerPurgeTestData(client)
      setNotice(`Removed ${r.organisationsDeleted} test organisation${r.organisationsDeleted === 1 ? "" : "s"}.`)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(null)
    }
  }

  async function allowAction(action: "add" | "remove", email: string) {
    setBusy("allow")
    setError(null)
    try {
      setAllow(await ownerMailAllowlist(client, action, email))
      if (action === "add") setAllowNew("")
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
        Accounts{mode?.test ? " (Test mode)" : ""}
      </button>
      {open && (
        <div role="dialog" aria-label="Accounts" style={{ marginTop: 8, background: "var(--dpdp-card)", border: "1px solid var(--dpdp-line)", borderRadius: 16, padding: 16, boxShadow: "0 8px 28px rgba(0,0,0,0.14)", fontSize: 13.5, color: "var(--dpdp-ink2)", maxHeight: "70vh", overflowY: "auto" }}>
          <p style={{ margin: "0 0 6px", fontWeight: 700, color: "var(--dpdp-ink)" }}>Test / Live mode: {mode?.mode ?? "..."}</p>
          <div style={{ display: "flex", gap: 8, marginBottom: 6 }}>
            <button type="button" disabled={busy === "mode" || mode?.mode === "TEST"} onClick={() => void switchMode("TEST")} style={{ background: "transparent", border: "1px solid var(--dpdp-line)", borderRadius: 8, padding: "6px 12px", fontWeight: 600, fontSize: 12.5 }}>Switch to Test</button>
            <button type="button" disabled={busy === "mode" || mode?.mode === "LIVE"} onClick={() => void switchMode("LIVE")} style={{ background: "var(--dpdp-v)", color: "#fff", borderRadius: 8, padding: "6px 12px", fontWeight: 600, fontSize: 12.5 }}>Switch to Live</button>
          </div>
          <p style={{ margin: "0 0 4px", fontSize: 12 }}>In Test mode only these addresses are e-mailed:</p>
          {allow.map((a) => (
            <p key={a.email} style={{ margin: "0 0 2px", fontSize: 12 }}>{a.email} <button type="button" disabled={busy === "allow"} onClick={() => void allowAction("remove", a.email)} style={{ background: "transparent", color: "var(--dpdp-ink3)", textDecoration: "underline", fontSize: 11.5 }}>remove</button></p>
          ))}
          <div style={{ display: "flex", gap: 6, margin: "4px 0 8px" }}>
            <input style={{ ...field, marginTop: 0 }} placeholder="Add an address" value={allowNew} onChange={(e) => setAllowNew(e.target.value)} autoComplete="off" />
            <button type="button" disabled={busy === "allow" || allowNew.trim() === ""} onClick={() => void allowAction("add", allowNew)} style={{ background: "var(--dpdp-v)", color: "#fff", borderRadius: 8, padding: "6px 12px", fontWeight: 600, fontSize: 12.5 }}>Add</button>
          </div>
          <button type="button" disabled={busy === "purge"} onClick={() => void purge()} style={{ background: "transparent", color: "var(--dpdp-r)", border: "1px solid var(--dpdp-r)", borderRadius: 8, padding: "6px 12px", fontWeight: 600, fontSize: 12.5 }}>Delete all test accounts</button>

          <p style={{ margin: "14px 0 10px", fontWeight: 700, color: "var(--dpdp-ink)" }}>Firms that declared themselves practitioners</p>
          {firms.length === 0 && <p style={{ margin: 0, fontSize: 12.5 }}>None yet.</p>}
          {firms.map((p) => (
            <div key={p.orgId} style={{ border: "1px solid var(--dpdp-line)", borderRadius: 10, padding: "10px 12px", marginBottom: 10 }}>
              <p style={{ margin: "0 0 2px", fontWeight: 600, color: "var(--dpdp-ink)" }}>{p.orgName}{p.status === "downgraded" ? " (on a paid plan)" : ""}</p>
              <p style={{ margin: "0 0 2px", fontSize: 12 }}>{p.professionalBody ? `${p.professionalBody}: ${p.registrationNo ?? "no number given"}` : "No number given"}{p.registrationNo ? (p.formatOk === false ? " (format looks unusual)" : p.formatOk ? " (format ok)" : "") : ""}</p>
              {p.declaredAt && <p style={{ margin: "0 0 6px", fontSize: 11, color: "var(--dpdp-ink3)" }}>Declared {parseDbTimestamp(p.declaredAt).toLocaleDateString("en-IN")}</p>}
              {p.status === "declared" && (
                <button type="button" disabled={busy === p.orgId} onClick={() => void downgrade(p.orgId)} style={{ background: "transparent", color: "var(--dpdp-r)", border: "1px solid var(--dpdp-r)", borderRadius: 8, padding: "6px 12px", fontWeight: 600, fontSize: 12.5 }}>Move to a paid plan</button>
              )}
            </div>
          ))}          <p style={{ margin: "14px 0 6px", fontWeight: 700, color: "var(--dpdp-ink)" }}>Mark an account paid</p>
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
