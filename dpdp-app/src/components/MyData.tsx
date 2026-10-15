// "My data": what we hold about the signed-in person, a way to ask for a copy, a correction or erasure, and a place to name a nominee
// (DPDP Act sections 11, 12 and 14). Backed by drizzle/0752. Short, plain words; every control has an accessible name.
import { useCallback, useEffect, useState } from "react"
import type { DpdpClient } from "../lib/client"
import { clearMyNominee, myData, requestMyRight, setMyNominee } from "../lib/api"
import type { MyDataPayload, RightKind } from "../lib/rpc-types"

const day = (iso: string) => new Date(iso).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" })
const KIND_LABEL: Record<RightKind, string> = { access: "A copy of my data", correction: "Correct my data", erasure: "Erase my data" }

export function MyData({ client, onClose }: { client: DpdpClient; onClose: () => void }) {
  const [data, setData] = useState<MyDataPayload | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [kind, setKind] = useState<RightKind>("access")
  const [details, setDetails] = useState("")
  const [message, setMessage] = useState<string | null>(null)
  const [nName, setNName] = useState("")
  const [nEmail, setNEmail] = useState("")
  const [nRel, setNRel] = useState("")
  const [busy, setBusy] = useState(false)

  const [reload, setReload] = useState(0)
  const load = useCallback(async () => { setReload((n) => n + 1) }, [])
  useEffect(() => {
    let live = true
    myData(client)
      .then((d) => { if (live) { setData(d); setError(null) } })
      .catch(() => { if (live) setError("We could not load your data. Please try again.") })
    return () => { live = false }
  }, [client, reload])

  const send = async () => {
    setBusy(true)
    setMessage(null)
    try {
      const r = await requestMyRight(client, kind, details)
      if (r.ok) {
        setMessage(`Received. Your reference is ${r.ref ?? "on its way"}. We reply within 30 days.`)
        setDetails("")
        await load()
      } else setMessage(r.reason)
    } catch {
      setMessage("That did not go through. Please try again.")
    } finally { setBusy(false) }
  }
  const saveNominee = async () => {
    setBusy(true)
    setMessage(null)
    try {
      const r = await setMyNominee(client, nName, nEmail, nRel)
      setMessage(r.ok ? "Your nominee is saved." : r.reason)
      if (r.ok) { setNName(""); setNEmail(""); setNRel(""); await load() }
    } catch {
      setMessage("That did not go through. Please try again.")
    } finally { setBusy(false) }
  }
  const removeNominee = async () => {
    setBusy(true)
    try { await clearMyNominee(client); setMessage("Your nominee is removed."); await load() } catch { setMessage("That did not go through. Please try again.") } finally { setBusy(false) }
  }

  const field = { border: "1px solid var(--dpdp-line, #d8d4c8)", borderRadius: 8, padding: "7px 9px", width: "100%", fontSize: 14, background: "#fff" } as const
  const btn = { background: "var(--dpdp-v)", color: "#fff", borderRadius: 8, padding: "8px 14px", fontWeight: 600, fontSize: 14 } as const

  return (
    <div role="dialog" aria-modal="true" aria-label="Your data and rights" style={{ position: "fixed", inset: 0, background: "rgba(20,16,40,.55)", zIndex: 60, overflowY: "auto", padding: "16px" }}>
      <div style={{ maxWidth: 640, margin: "0 auto", background: "var(--dpdp-bg, #fffdf9)", color: "var(--dpdp-ink, #1c1830)", borderRadius: 12, padding: "18px 18px 22px" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12 }}>
          <h2 style={{ fontSize: 20, fontWeight: 700, margin: 0 }}>Your data and rights</h2>
          <button type="button" onClick={onClose} style={{ ...btn, background: "transparent", color: "var(--dpdp-ink3, #55524a)", textDecoration: "underline" }}>Close</button>
        </div>
        {error && <p role="alert" style={{ marginTop: 12 }}>{error}</p>}
        {!data && !error && <p style={{ marginTop: 12 }}>Loading…</p>}
        {data && (
          <>
            <h3 style={{ fontWeight: 700, marginTop: 16 }}>What we hold</h3>
            <ul style={{ lineHeight: 1.6, paddingLeft: 18, listStyle: "disc" }}>
              <li>Your sign-in e-mail: {data.identity.email} (since {day(data.identity.createdAt)})</li>
              <li>Organisations you belong to: {data.organisations.length === 0 ? "none" : data.organisations.map((o) => `${o.name} (${o.level})`).join(", ")}</li>
              <li>E-mails we sent you: {data.emailsSent}</li>
              <li>Actions recorded under your name: {data.actionsRecorded}</li>
            </ul>

            <h3 style={{ fontWeight: 700, marginTop: 16 }}>Ask us</h3>
            <fieldset style={{ border: 0, padding: 0, margin: "6px 0" }}>
              <legend style={{ position: "absolute", left: -9999 }}>What do you want?</legend>
              {(Object.keys(KIND_LABEL) as RightKind[]).map((k) => (
                <label key={k} style={{ display: "block", padding: "3px 0" }}>
                  <input type="radio" name="right-kind" checked={kind === k} onChange={() => setKind(k)} /> {KIND_LABEL[k]}
                </label>
              ))}
            </fieldset>
            <label style={{ display: "block", marginTop: 6 }}>
              <span style={{ display: "block", fontSize: 13, marginBottom: 3 }}>{kind === "correction" ? "What is wrong, and what should it be?" : "Anything we should know (optional)"}</span>
              <textarea value={details} onChange={(e) => setDetails(e.target.value)} rows={3} maxLength={2000} style={field} />
            </label>
            <button type="button" disabled={busy} onClick={() => void send()} style={{ ...btn, marginTop: 8 }}>Send request</button>

            {data.requests.length > 0 && (
              <>
                <h3 style={{ fontWeight: 700, marginTop: 16 }}>Your requests</h3>
                <ul style={{ lineHeight: 1.6, paddingLeft: 18, listStyle: "disc" }}>
                  {data.requests.map((r) => (
                    <li key={r.ref}>{r.ref}: {KIND_LABEL[r.kind]}, {r.state === "open" ? `open, we reply by ${day(r.dueAt)}` : "answered"}</li>
                  ))}
                </ul>
              </>
            )}

            <h3 style={{ fontWeight: 700, marginTop: 16 }}>Your nominee</h3>
            <p style={{ fontSize: 13.5, margin: "2px 0 6px" }}>Someone you choose to use these rights for you if you die or cannot act.</p>
            {data.nominee ? (
              <p>
                {data.nominee.name}{data.nominee.relation ? ` (${data.nominee.relation})` : ""}{data.nominee.email ? `, ${data.nominee.email}` : ""}{" "}
                <button type="button" disabled={busy} onClick={() => void removeNominee()} style={{ textDecoration: "underline", color: "var(--dpdp-v)" }}>Remove nominee</button>
              </p>
            ) : (
              <p style={{ margin: "2px 0 6px" }}>No nominee yet.</p>
            )}
            <div style={{ display: "grid", gap: 6 }}>
              <label>Nominee name<input value={nName} onChange={(e) => setNName(e.target.value)} maxLength={120} style={field} /></label>
              <label>Nominee e-mail (optional)<input value={nEmail} onChange={(e) => setNEmail(e.target.value)} maxLength={320} inputMode="email" style={field} /></label>
              <label>Relationship (optional)<input value={nRel} onChange={(e) => setNRel(e.target.value)} maxLength={60} style={field} /></label>
              <div><button type="button" disabled={busy} onClick={() => void saveNominee()} style={btn}>Save nominee</button></div>
            </div>
          </>
        )}
        {message && <p role="status" style={{ marginTop: 12, fontWeight: 600 }}>{message}</p>}
      </div>
    </div>
  )
}
