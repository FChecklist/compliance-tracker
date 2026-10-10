import { useCallback, useEffect, useState, type CSSProperties, type FormEvent, type ReactNode } from "react"
import type { DpdpClient } from "@/lib/client"
import { partnerAcceptTerms, partnerDashboard, partnerGetCode, partnerSavePayoutDetails, partnerStatement } from "@/lib/api"
import type { PartnerDashboardPayload, PartnerDetailsInput } from "@/lib/rpc-types"
import { PUBLIC_SITE } from "@/lib/brand"
import { STATUS_TEXT, downloadText, recentPeriods, rupees, statementCsv } from "@/lib/partner"
import "./onepage/dpdp-onepage-tokens.css"

// Sales Partner (drizzle/0674): the partner's own screen. Reached from the Share box, the top bar of the
// page, and the "open your organisation" screen, so a signed-in person with no organisation can use it.
// Shows counts and money only. Visits to the public site are not counted anywhere, so there is no
// "visits" number. Payout details come back masked from the database; the full values are never shown here.

const card: CSSProperties = { background: "var(--dpdp-card)", border: "1px solid var(--dpdp-line)", borderRadius: 18, padding: 20, marginBottom: 16 }
const h2: CSSProperties = { fontFamily: "Sora, sans-serif", fontSize: 17, fontWeight: 700, margin: "0 0 10px", color: "var(--dpdp-ink)" }
const muted: CSSProperties = { fontSize: 13, color: "var(--dpdp-ink3)", margin: "0 0 8px" }
const input: CSSProperties = { borderColor: "var(--dpdp-line)", fontSize: 15, color: "var(--dpdp-ink)", background: "#fff", width: "100%" }
const primary: CSSProperties = { background: "var(--dpdp-v)", color: "#fff", fontSize: 14.5, fontWeight: 700, padding: "11px 20px", borderRadius: 12 }
const secondary: CSSProperties = { background: "#fff", color: "var(--dpdp-v)", border: "1.4px solid var(--dpdp-line)", fontSize: 13.5, fontWeight: 600, padding: "8px 14px", borderRadius: 10 }

function Stat({ label, value, note }: { label: string; value: string | number; note?: string }) {
  return (
    <div style={{ border: "1px solid var(--dpdp-line)", borderRadius: 12, padding: "10px 12px", minWidth: 120, flex: "1 1 120px" }}>
      <div style={{ fontSize: 12, color: "var(--dpdp-ink3)" }}>{label}</div>
      <div style={{ fontSize: 20, fontWeight: 700, color: "var(--dpdp-ink)" }}>{value}</div>
      {note && <div style={{ fontSize: 11.5, color: "var(--dpdp-ink3)" }}>{note}</div>}
    </div>
  )
}

function Err({ message }: { message: string | null }) {
  return message ? <p role="alert" style={{ margin: "8px 0 0", fontSize: 13, fontWeight: 600, color: "var(--dpdp-r)" }}>{message}</p> : null
}

function Field({ id, label, children }: { id: string; label: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-1.5" style={{ marginBottom: 12 }}>
      <label htmlFor={id} style={{ fontSize: 13, fontWeight: 600, color: "var(--dpdp-ink2)" }}>{label}</label>
      {children}
    </div>
  )
}

function DetailsForm({ client, onSaved, current }: { client: DpdpClient; onSaved: () => void; current: PartnerDashboardPayload["payoutDetails"] }) {
  const [method, setMethod] = useState<"upi" | "bank">(current?.method ?? "upi")
  const [f, setF] = useState<PartnerDetailsInput>({ method: current?.method ?? "upi" })
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const set = (k: keyof PartnerDetailsInput, v: string) => setF((p) => ({ ...p, [k]: v }))
  async function submit(e: FormEvent) {
    e.preventDefault()
    setBusy(true)
    setError(null)
    try {
      await partnerSavePayoutDetails(client, { ...f, method })
      onSaved()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }
  return (
    <form onSubmit={submit} className="text-left">
      <fieldset className="flex gap-4 border-0 p-0 m-0" style={{ marginBottom: 12 }}>
        <legend style={{ fontSize: 13, fontWeight: 600, color: "var(--dpdp-ink2)", marginBottom: 6 }}>How do you want to be paid?</legend>
        <label className="flex gap-2 items-center"><input type="radio" name="pm" checked={method === "upi"} onChange={() => setMethod("upi")} /> UPI</label>
        <label className="flex gap-2 items-center"><input type="radio" name="pm" checked={method === "bank"} onChange={() => setMethod("bank")} /> Bank transfer</label>
      </fieldset>
      {method === "upi" ? (
        <Field id="pd-upi" label="UPI id (for example name@bank)">
          <input id="pd-upi" required className="rounded-xl border px-3.5 py-3" style={input} autoComplete="off" value={f.upiId ?? ""} onChange={(e) => set("upiId", e.target.value)} />
        </Field>
      ) : (
        <>
          <Field id="pd-name" label="Name on the bank account">
            <input id="pd-name" required className="rounded-xl border px-3.5 py-3" style={input} autoComplete="off" value={f.accountName ?? ""} onChange={(e) => set("accountName", e.target.value)} />
          </Field>
          <Field id="pd-acct" label="Account number">
            <input id="pd-acct" required inputMode="numeric" className="rounded-xl border px-3.5 py-3" style={input} autoComplete="off" value={f.accountNumber ?? ""} onChange={(e) => set("accountNumber", e.target.value)} />
          </Field>
          <Field id="pd-ifsc" label="IFSC code">
            <input id="pd-ifsc" required className="rounded-xl border px-3.5 py-3" style={input} autoComplete="off" value={f.ifsc ?? ""} onChange={(e) => set("ifsc", e.target.value)} />
          </Field>
        </>
      )}
      <Field id="pd-pan" label="PAN (optional)">
        <input id="pd-pan" className="rounded-xl border px-3.5 py-3" style={input} autoComplete="off" value={f.pan ?? ""} onChange={(e) => set("pan", e.target.value)} />
      </Field>
      <p style={muted}>We keep these details only to pay you. After you save them, we show them masked. We never put them in an AI link or an email.</p>
      <button type="submit" disabled={busy} style={{ ...primary, opacity: busy ? 0.6 : 1 }}>{busy ? "Saving..." : "Save payout details"}</button>
      <Err message={error} />
    </form>
  )
}

export function SalesPartner({ client, email, onClose }: { client: DpdpClient; email: string | null; onClose: () => void }) {
  const [d, setD] = useState<PartnerDashboardPayload | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [name, setName] = useState("")
  const [agree, setAgree] = useState(false)
  const [busy, setBusy] = useState(false)
  const [changing, setChanging] = useState(false)
  const [copied, setCopied] = useState(false)
  const [period, setPeriod] = useState(() => recentPeriods(new Date(), 1)[0])
  const [notice, setNotice] = useState<string | null>(null)

  const fetchDash = useCallback(async () => {
    let dash = await partnerDashboard(client)
    // An active partner's code is made on first sight, so the link is ready.
    if (dash.status === "active" && !dash.code) {
      try { dash = { ...dash, code: (await partnerGetCode(client)).code } } catch { /* the link appears on the next visit */ }
    }
    return dash
  }, [client])

  const load = useCallback(async () => {
    try {
      setD(await fetchDash())
      setError(null)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    }
  }, [fetchDash])

  useEffect(() => {
    let cancelled = false
    fetchDash().then(
      (dash) => { if (!cancelled) { setD(dash); setError(null) } },
      (e) => { if (!cancelled) setError(e instanceof Error ? e.message : String(e)) },
    )
    return () => { cancelled = true }
  }, [fetchDash])

  async function accept() {
    if (!d) return
    setBusy(true)
    setError(null)
    try {
      await partnerAcceptTerms(client, d.currentTermsVersion, name)
      await load()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  async function downloadStatement() {
    setError(null)
    try {
      const s = await partnerStatement(client, period)
      downloadText(`veridian-partner-statement-${period}.csv`, statementCsv(s))
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    }
  }

  const link = d?.code ? `${PUBLIC_SITE}?ref=${d.code}` : null
  async function copyLink() {
    if (!link) return
    try { await navigator.clipboard.writeText(link); setCopied(true) } catch { setCopied(false) }
  }

  const status = d?.status ?? null
  const st = status ? STATUS_TEXT[status] : null
  const needsAccept = !!d && (status === null || (status !== "ended" && d.needsTerms))

  return (
    <div className="dpdp-onepage min-h-screen">
      <div className="max-w-[760px] mx-auto px-5 py-8">
        <div className="flex items-center justify-between gap-3 flex-wrap" style={{ marginBottom: 14 }}>
          <h1 style={{ fontFamily: "Sora, sans-serif", fontSize: 26, fontWeight: 700, margin: 0, color: "var(--dpdp-ink)" }}>Sales Partner</h1>
          <button type="button" onClick={onClose} style={secondary}>Back to my page</button>
        </div>
        {email && <p style={muted}>Signed in as <b>{email}</b></p>}
        <Err message={error} />
        {!d && !error && <p style={muted}>Loading...</p>}

        {d && (
          <>
            {st && (
              <div style={card}>
                <p style={{ margin: 0, fontWeight: 700, color: "var(--dpdp-ink)" }}>Your status: {st.label}</p>
                <p style={{ ...muted, margin: "4px 0 0" }}>{st.line}</p>
              </div>
            )}

            {status === null && (
              <div style={card}>
                <h2 style={h2}>Earn a commission</h2>
                <p style={muted}>Share VERIDIAN with firms and organisations. You earn 20% of each yearly payment from an organisation you referred, on every renewal. Anyone with a VERIDIAN sign-in can join. It is free.</p>
              </div>
            )}

            {needsAccept && (
              <div style={card}>
                <h2 style={h2}>{status === null ? "Step 1: accept the partner terms" : `Accept the updated partner terms (version ${d.currentTermsVersion})`}</h2>
                <p style={muted}>Read the <a href="/partner/terms/" target="_blank" rel="noopener noreferrer" style={{ textDecoration: "underline" }}>Sales Partner terms</a> (version {d.currentTermsVersion}). They are short and in plain English.</p>
                {status === null && (
                  <Field id="sp-name" label="Your name (optional, used in our emails to you)">
                    <input id="sp-name" maxLength={80} className="rounded-xl border px-3.5 py-3" style={input} value={name} onChange={(e) => setName(e.target.value)} />
                  </Field>
                )}
                <label className="flex gap-2 items-start" style={{ fontSize: 14, marginBottom: 12 }}>
                  <input type="checkbox" checked={agree} onChange={(e) => setAgree(e.target.checked)} style={{ marginTop: 4 }} />
                  <span>I have read the Sales Partner terms, version {d.currentTermsVersion}, and I accept them.</span>
                </label>
                <button type="button" disabled={!agree || busy} onClick={() => void accept()} style={{ ...primary, opacity: !agree || busy ? 0.6 : 1 }}>{busy ? "Saving..." : "Accept the terms"}</button>
              </div>
            )}

            {status === "applied" && !needsAccept && !d.hasPayoutDetails && (
              <div style={card}>
                <h2 style={h2}>Step 2: add your payout details</h2>
                <DetailsForm client={client} current={null} onSaved={() => { setNotice("Saved. You are an active Sales Partner."); void load() }} />
              </div>
            )}

            {notice && <p style={{ ...muted, color: "var(--dpdp-v)", fontWeight: 600 }}>{notice}</p>}

            {status && status !== "applied" && d.funnel && d.money && (
              <>
                {status === "active" && (
                  <div style={card}>
                    <h2 style={h2}>Your personal link</h2>
                    {link ? (
                      <>
                        <p style={{ margin: "0 0 8px", wordBreak: "break-all" }}><code>{link}</code></p>
                        <div className="flex gap-2 flex-wrap">
                          <button type="button" onClick={() => void copyLink()} style={secondary}>{copied ? "Copied" : "Copy link"}</button>
                          <a style={{ ...secondary, display: "inline-block" }} target="_blank" rel="noopener noreferrer" href={`https://wa.me/?text=${encodeURIComponent(`VERIDIAN DPDP ${link}`)}`}>WhatsApp</a>
                        </div>
                        <p style={{ ...muted, marginTop: 8 }}>Your code: <b>{d.code}</b>. The link opens our public website. It holds your code and nothing else.</p>
                      </>
                    ) : <p style={muted}>Your link is being made. Reload this page in a moment.</p>}
                  </div>
                )}

                <div style={card}>
                  <h2 style={h2}>Organisations you referred</h2>
                  <div className="flex gap-2 flex-wrap">
                    <Stat label="Signed up" value={d.funnel.signedUp} />
                    <Stat label="In their free trial" value={d.funnel.inTrial} />
                    <Stat label="Paying" value={d.funnel.paying} />
                  </div>
                  <p style={{ ...muted, marginTop: 8 }}>
                    These are counts only. We do not show who they are. We do not count visits to the website.
                    {d.funnel.notCounted > 0 && ` ${d.funnel.notCounted} sign-up${d.funnel.notCounted === 1 ? "" : "s"} did not count (your own organisation, or a time when your status was not active).`}
                  </p>
                </div>

                <div style={card}>
                  <h2 style={h2}>Your commission</h2>
                  <div className="flex gap-2 flex-wrap">
                    <Stat label="Earned in total" value={rupees(d.money.earnedPaise)} />
                    <Stat label={`Waiting (${d.payableAfterDays} days)`} value={rupees(d.money.waitingPaise)} />
                    <Stat label="Payable" value={rupees(d.money.payablePaise)} note={`Next payout: ${d.nextPayoutOn}`} />
                    <Stat label="Paid (net)" value={rupees(d.money.paidNetPaise)} note={`Gross ${rupees(d.money.paidGrossPaise)}, TDS ${rupees(d.money.paidTdsPaise)}`} />
                  </div>
                  <p style={{ ...muted, marginTop: 8 }}>
                    A commission becomes payable {d.payableAfterDays} days after the client&rsquo;s payment is confirmed. We pay once a month, on the {d.payoutDay}th,
                    for everything payable before the end of the month before. A balance under {rupees(d.minPayoutPaise)} carries forward.
                    Tax (TDS) is deducted where the law requires it and shown on your statement.
                  </p>
                  {(d.lines ?? []).length > 0 ? (
                    <div style={{ overflowX: "auto", marginTop: 10 }}>
                      <table style={{ width: "100%", fontSize: 12.5, borderCollapse: "collapse" }}>
                        <thead>
                          <tr style={{ textAlign: "left", color: "var(--dpdp-ink3)" }}>
                            <th>Made on</th><th>Basis</th><th>Gross</th><th>TDS</th><th>Net</th><th>Status</th>
                          </tr>
                        </thead>
                        <tbody>
                          {(d.lines ?? []).map((l, i) => (
                            <tr key={i} style={{ borderTop: "1px solid var(--dpdp-line)" }}>
                              <td>{l.at.slice(0, 10)}</td>
                              <td>{l.basis === "yearly" ? `Yearly ${l.ratePercent}%` : `First month ${l.ratePercent}%`}</td>
                              <td>{rupees(l.grossPaise)}</td>
                              <td>{rupees(l.tdsPaise)}{l.tdsPaise !== null && !l.tdsIsFinal ? " (est.)" : ""}</td>
                              <td>{rupees(l.netPaise)}</td>
                              <td>{l.status === "paid" ? `Paid ${l.paidOn ?? ""}` : l.status === "payable" ? "Payable" : `Payable from ${l.payableOn}`}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  ) : <p style={muted}>No commission yet. It appears here after an organisation you referred pays and we confirm the payment.</p>}
                  <div className="flex gap-2 items-center flex-wrap" style={{ marginTop: 12 }}>
                    <label htmlFor="sp-month" style={{ fontSize: 13, fontWeight: 600 }}>Statement for</label>
                    <select id="sp-month" value={period} onChange={(e) => setPeriod(e.target.value)} className="rounded-lg border px-2 py-2" style={{ borderColor: "var(--dpdp-line)" }}>
                      {recentPeriods(new Date(), 12).map((p) => <option key={p} value={p}>{p}</option>)}
                    </select>
                    <button type="button" onClick={() => void downloadStatement()} style={secondary}>Download CSV</button>
                  </div>
                </div>
              </>
            )}

            {status && status !== "applied" && (
              <div style={card}>
                <h2 style={h2}>Your payout details</h2>
                {d.payoutDetails ? (
                  <p style={{ margin: "0 0 8px", fontSize: 14 }}>
                    {d.payoutDetails.method === "upi"
                      ? <>UPI: <b>{d.payoutDetails.upiMasked}</b></>
                      : <>Bank: <b>{d.payoutDetails.nameMasked}</b>, account <b>{d.payoutDetails.accountMasked}</b>, IFSC <b>{d.payoutDetails.ifscMasked}</b></>}
                    {d.payoutDetails.panMasked && <> &middot; PAN <b>{d.payoutDetails.panMasked}</b></>}
                  </p>
                ) : <p style={muted}>No payout details saved.</p>}
                {status !== "ended" && (changing ? (
                  <DetailsForm client={client} current={d.payoutDetails ?? null} onSaved={() => { setChanging(false); setNotice("Saved. We sent you an email to confirm the change."); void load() }} />
                ) : <button type="button" onClick={() => setChanging(true)} style={secondary}>Change payout details</button>)}
                <p style={{ ...muted, marginTop: 10 }}>Terms accepted: version {d.termsVersion ?? "--"}{d.termsAcceptedAt ? `, ${d.termsAcceptedAt.slice(0, 10)}` : ""}. <a href="/partner/terms/" target="_blank" rel="noopener noreferrer" style={{ textDecoration: "underline" }}>Read the terms</a>.</p>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  )
}
