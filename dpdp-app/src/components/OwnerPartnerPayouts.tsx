import { useEffect, useState, type CSSProperties } from "react"
import type { DpdpClient } from "@/lib/client"
import {
  adminPartnerList, adminPartnerMarkPaid, adminPartnerPayoutRun, adminPartnerSetSettings, adminPartnerSetStatus, adminPartnerSettings,
  amIPlatformAdmin, flushPartnerEmails,
} from "@/lib/api"
import type { AdminPartnerRow, AdminPartnerSettings, AdminPayoutRun } from "@/lib/rpc-types"
import { downloadText, payoutRunCsv, recentPeriods, rupees } from "@/lib/partner"

// The Owner's monthly partner payout run (drizzle/0674). Renders nothing for anyone who is not on
// dpdp.platform_admin (every RPC here checks that itself; amIPlatformAdmin only stops the button from
// flashing). The steps: 1. set the TDS percentage once (0 is allowed); 2. open the month; 3. download the
// payout list and send the money by UPI or bank transfer, outside this system; 4. type each UTR and press
// "Mark paid", which flips that partner's commissions to paid and emails them. Full payout details are shown
// here, to the Owner only, because the Owner has to send the money.
const box: CSSProperties = { border: "1px solid var(--dpdp-line)", borderRadius: 10, padding: "10px 12px", marginBottom: 10 }
const small: CSSProperties = { fontSize: 12, margin: "0 0 2px" }
const btn: CSSProperties = { background: "var(--dpdp-v)", color: "#fff", borderRadius: 8, padding: "6px 12px", fontWeight: 600, fontSize: 12.5 }
const ghost: CSSProperties = { background: "transparent", color: "var(--dpdp-v)", border: "1px solid var(--dpdp-line)", borderRadius: 8, padding: "5px 10px", fontWeight: 600, fontSize: 12 }

export function OwnerPartnerPayouts({ client }: { client: DpdpClient }) {
  const [isAdmin, setIsAdmin] = useState<boolean | null>(null)
  const [open, setOpen] = useState(false)
  const [settings, setSettings] = useState<AdminPartnerSettings | null>(null)
  const [tds, setTds] = useState("")
  const [min, setMin] = useState("")
  const [partners, setPartners] = useState<AdminPartnerRow[]>([])
  const [period, setPeriod] = useState(() => recentPeriods(new Date(), 2)[1])
  const [run, setRun] = useState<AdminPayoutRun | null>(null)
  const [refs, setRefs] = useState<Record<string, string>>({})
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)

  const fail = (e: unknown) => setError(e instanceof Error ? e.message : String(e))

  async function refresh(p = period) {
    setError(null)
    try {
      const [s, list, r] = await Promise.all([adminPartnerSettings(client), adminPartnerList(client), adminPartnerPayoutRun(client, p)])
      setSettings(s)
      setTds(s.tdsPercentSet ? String(s.tdsPercent) : "")
      setMin(String(s.minPayoutPaise / 100))
      setPartners(list)
      setRun(r)
    } catch (e) {
      fail(e)
    }
  }

  useEffect(() => {
    let cancelled = false
    amIPlatformAdmin(client).then((v) => { if (!cancelled) setIsAdmin(v) })
    return () => { cancelled = true }
  }, [client])

  if (!isAdmin) return null

  async function saveSettings() {
    setBusy("settings")
    setError(null)
    try {
      const t = tds.trim() === "" ? undefined : Number(tds)
      const m = min.trim() === "" ? undefined : Math.round(Number(min) * 100)
      if ((t !== undefined && !Number.isFinite(t)) || (m !== undefined && !Number.isFinite(m))) throw new Error("Enter numbers only.")
      await adminPartnerSetSettings(client, { tdsPercent: t, minPayoutPaise: m })
      setNotice("Settings saved.")
      await refresh()
    } catch (e) {
      fail(e)
    } finally {
      setBusy(null)
    }
  }

  async function markPaid(identityId: string) {
    const reference = (refs[identityId] ?? "").trim()
    setBusy(identityId)
    setError(null)
    setNotice(null)
    try {
      const r = await adminPartnerMarkPaid(client, period, identityId, reference)
      const mail = await flushPartnerEmails(client)
      setNotice(`${r.alreadyPaid ? "Already marked paid" : "Marked paid"}: ${rupees(r.netPaise)}. ${mail.ok ? "The partner has been emailed." : `The email will go out within 30 minutes (${mail.error}).`}`)
      await refresh()
    } catch (e) {
      fail(e)
    } finally {
      setBusy(null)
    }
  }

  async function setStatus(identityId: string, status: "active" | "paused" | "ended") {
    setBusy(identityId)
    setError(null)
    try {
      await adminPartnerSetStatus(client, identityId, status)
      await refresh()
    } catch (e) {
      fail(e)
    } finally {
      setBusy(null)
    }
  }

  return (
    <div style={{ position: "fixed", right: 14, bottom: 62, zIndex: 40, maxWidth: 480 }}>
      <button
        type="button" onClick={() => { setOpen((o) => !o); if (!open) void refresh() }}
        style={{ background: "var(--dpdp-card)", border: "1px solid var(--dpdp-line)", borderRadius: 999, padding: "9px 14px", fontSize: 12.5, fontWeight: 600, color: "var(--dpdp-ink2)", boxShadow: "0 2px 10px rgba(0,0,0,0.08)" }}
      >
        🤝 Partner payouts
      </button>
      {open && (
        <div role="dialog" aria-label="Partner payouts" style={{ marginTop: 8, background: "var(--dpdp-card)", border: "1px solid var(--dpdp-line)", borderRadius: 16, padding: 16, boxShadow: "0 8px 28px rgba(0,0,0,0.14)", fontSize: 13.5, color: "var(--dpdp-ink2)", maxHeight: "75vh", overflowY: "auto" }}>
          <p style={{ margin: "0 0 10px", fontWeight: 700, color: "var(--dpdp-ink)" }}>Partner payouts</p>

          {settings && (
            <div style={box}>
              <p style={{ ...small, fontWeight: 700 }}>Payout settings</p>
              <p style={small}>Payable {settings.payableAfterDays} days after the payment is confirmed. Paid once a month on the {settings.payoutDay}th.</p>
              <div className="flex gap-2 items-end flex-wrap" style={{ marginTop: 6 }}>
                <label style={{ fontSize: 12 }}>TDS % (0 if none)<br /><input value={tds} onChange={(e) => setTds(e.target.value)} inputMode="decimal" style={{ width: 80, border: "1px solid var(--dpdp-line)", borderRadius: 6, padding: "4px 6px" }} /></label>
                <label style={{ fontSize: 12 }}>Minimum payout (Rs)<br /><input value={min} onChange={(e) => setMin(e.target.value)} inputMode="decimal" style={{ width: 90, border: "1px solid var(--dpdp-line)", borderRadius: 6, padding: "4px 6px" }} /></label>
                <button type="button" disabled={busy === "settings"} onClick={() => void saveSettings()} style={btn}>Save</button>
              </div>
              {!settings.tdsPercentSet && <p style={{ ...small, color: "var(--dpdp-r)", marginTop: 6 }}>The TDS percentage is not set. Set it (your CA decides; 0 is allowed) before you can mark a payout as paid.</p>}
            </div>
          )}

          <div style={box}>
            <div className="flex gap-2 items-center flex-wrap">
              <label style={{ fontSize: 12.5, fontWeight: 600 }} htmlFor="pp-month">Pay for month</label>
              <select id="pp-month" value={period} onChange={(e) => { setPeriod(e.target.value); void refresh(e.target.value) }} style={{ border: "1px solid var(--dpdp-line)", borderRadius: 6, padding: "4px 6px" }}>
                {recentPeriods(new Date(), 13).slice(1).map((p) => <option key={p} value={p}>{p}</option>)}
              </select>
              {run && run.partners.some((p) => p.meetsMinimum) && (
                <button type="button" style={ghost} onClick={() => downloadText(`veridian-partner-payouts-${run.period}.csv`, payoutRunCsv(run))}>Download payout list (CSV)</button>
              )}
            </div>
            {run && <p style={{ ...small, marginTop: 6 }}>Everything that became payable before {run.payableBefore}.</p>}
            {run && run.partners.length === 0 && <p style={small}>Nothing to pay for this month.</p>}
            {run?.partners.map((p) => (
              <div key={p.identityId} style={{ ...box, marginTop: 8, marginBottom: 0 }}>
                <p style={{ ...small, fontWeight: 700, color: "var(--dpdp-ink)" }}>{p.name ?? p.email} {p.name ? `(${p.email})` : ""}</p>
                <p style={small}>{p.commissions} commission{p.commissions === 1 ? "" : "s"}: gross {rupees(p.grossPaise)}, TDS {rupees(p.tdsPaise)}, <b>net {rupees(p.netPaise)}</b></p>
                <p style={small}>
                  {p.method === "upi" ? <>UPI <b>{p.upiId}</b></> : <>Bank: {p.accountName}, A/C <b>{p.accountNumber}</b>, IFSC <b>{p.ifsc}</b></>}
                  {p.pan ? <> &middot; PAN {p.pan}</> : null}
                </p>
                {p.detailsChangedRecently && <p style={{ ...small, color: "var(--dpdp-r)" }}>Payout details were changed in the last 7 days. Check with the partner before you send.</p>}
                {p.meetsMinimum ? (
                  <div className="flex gap-2 items-center flex-wrap" style={{ marginTop: 6 }}>
                    <input aria-label={`UTR for ${p.email}`} placeholder="UTR / reference" value={refs[p.identityId] ?? ""} onChange={(e) => setRefs((r) => ({ ...r, [p.identityId]: e.target.value }))} style={{ border: "1px solid var(--dpdp-line)", borderRadius: 6, padding: "4px 6px", width: 170 }} />
                    <button type="button" disabled={busy === p.identityId || !settings?.tdsPercentSet} onClick={() => void markPaid(p.identityId)} style={{ ...btn, opacity: busy === p.identityId || !settings?.tdsPercentSet ? 0.6 : 1 }}>
                      {busy === p.identityId ? "Working..." : "Mark paid"}
                    </button>
                  </div>
                ) : <p style={small}>Under the minimum of {rupees(run.minPayoutPaise)}. It carries forward to next month.</p>}
              </div>
            ))}
            {run && run.held.length > 0 && (
              <div style={{ marginTop: 8 }}>
                <p style={{ ...small, fontWeight: 700 }}>Held (cannot be paid yet)</p>
                {run.held.map((h) => <p key={h.identityId} style={small}>{h.email}: {rupees(h.grossPaise)}, {h.reason}</p>)}
              </div>
            )}
          </div>

          <div style={box}>
            <p style={{ ...small, fontWeight: 700 }}>Partners</p>
            {partners.length === 0 && <p style={small}>No partner yet.</p>}
            {partners.map((p) => (
              <div key={p.identityId} style={{ borderTop: "1px solid var(--dpdp-line)", padding: "6px 0" }}>
                <p style={small}><b>{p.email}</b> &middot; {p.status} &middot; {p.signedUp} signed up &middot; waiting {rupees(p.waitingPaise)} &middot; payable {rupees(p.payablePaise)} &middot; paid (net) {rupees(p.paidNetPaise)}</p>
                <div className="flex gap-2 flex-wrap">
                  {p.status !== "paused" && p.status !== "ended" && <button type="button" style={ghost} disabled={busy === p.identityId} onClick={() => void setStatus(p.identityId, "paused")}>Pause</button>}
                  {(p.status === "paused" || p.status === "ended") && <button type="button" style={ghost} disabled={busy === p.identityId} onClick={() => void setStatus(p.identityId, "active")}>Make active</button>}
                  {p.status !== "ended" && <button type="button" style={ghost} disabled={busy === p.identityId} onClick={() => void setStatus(p.identityId, "ended")}>End</button>}
                </div>
              </div>
            ))}
          </div>

          {notice && <p style={{ margin: "6px 0 0", color: "var(--dpdp-v)", fontWeight: 600, fontSize: 12.5 }}>{notice}</p>}
          {error && <p role="alert" style={{ margin: "6px 0 0", color: "var(--dpdp-r)", fontWeight: 600, fontSize: 12.5 }}>{error}</p>}
          <button type="button" onClick={() => setOpen(false)} style={{ background: "transparent", color: "var(--dpdp-ink3)", textDecoration: "underline", fontSize: 12, marginTop: 10, display: "block" }}>Close</button>
        </div>
      )}
    </div>
  )
}
