import { useEffect, useState, type FormEvent } from "react"
import type { DpdpClient } from "@/lib/client"
import { fetchMyAccount, saveProfile } from "@/lib/api"
import type { MyAccountPayload, ProfileProgress } from "@/lib/rpc-types"

// "Complete your profile": a calm card with a progress figure. Every field is optional and nothing waits on it; a value that does not fit is
// simply left out and said so in plain words. The owner of the account only (the server refuses anyone else).
export const PROFILE_TITLE = "Complete your profile"
export const PROFILE_NUDGE = "A few details help us help you. Add them whenever you like; everything works without them."

type Draft = Record<string, string>
const FIRM_FIELDS: Array<[string, string]> = [["firmName", "Firm name"], ["city", "City"], ["gstin", "GSTIN"], ["clientsEstimate", "About how many clients"], ["contactPerson", "Contact person"], ["phone", "Phone"], ["registrationNo", "Membership or firm registration number"]]
const INSTITUTION_FIELDS: Array<[string, string]> = [["legalName", "Legal name"], ["city", "City"], ["gstin", "GSTIN"], ["contactPerson", "Contact person"], ["phone", "Phone"], ["dpoName", "DPO or Grievance Officer name"], ["dpoEmail", "DPO or Grievance Officer e-mail"]]

export function ProfileCard({ client, orgId }: { client: DpdpClient; orgId: string }) {
  const [account, setAccount] = useState<MyAccountPayload | null>(null)
  const [open, setOpen] = useState(false)
  const [draft, setDraft] = useState<Draft>({})
  const [declared, setDeclared] = useState<boolean | null>(null)
  const [busy, setBusy] = useState(false)
  const [note, setNote] = useState<string | null>(null)
  const [progress, setProgress] = useState<ProfileProgress | null>(null)

  useEffect(() => {
    let cancelled = false
    fetchMyAccount(client, orgId).then((a) => { if (!cancelled) setAccount(a) }, () => { /* an older database: no card */ })
    return () => { cancelled = true }
  }, [client, orgId])

  if (!account || !account.hasAccount || account.coveredByFirm || !account.profile) return null
  const p = progress ?? account.profile
  const isFirm = account.accountType === "firm"
  const fields = isFirm ? FIRM_FIELDS : INSTITUTION_FIELDS
  const stored = (p.fields ?? {}) as Record<string, unknown>
  const isDeclared = account.verification.declared

  async function submit(e: FormEvent) {
    e.preventDefault()
    setBusy(true)
    setNote(null)
    const body: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(draft)) body[k] = v
    if (isFirm) {
      if (draft.registrationNo !== undefined && draft.registrationNo.trim() !== "" && !(stored.professionalBody as string | undefined)) body.professionalBody = "other"
      if (declared !== null && declared !== isDeclared) body.practitionerDeclared = declared
    }
    try {
      const r = await saveProfile(client, body, orgId)
      setProgress(r.profile)
      setDraft({})
      setDeclared(null)
      setNote(r.ignored.length > 0 ? `Saved. We left out ${r.ignored.length === 1 ? "one value" : `${r.ignored.length} values`} that did not look right; you can try again any time.` : r.note ?? "Saved. Thank you.")
      setAccount(await fetchMyAccount(client, orgId))
    } catch (err) {
      setNote(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }

  const input = { display: "block", width: "100%", marginTop: 3, padding: "6px 8px", borderRadius: 8, border: "1px solid var(--dpdp-line)", fontSize: 13 } as const
  return (
    <section aria-label={PROFILE_TITLE} style={{ maxWidth: 1240, margin: "10px auto 0", padding: "0 20px" }}>
      <div style={{ background: "var(--dpdp-card)", border: "1px solid var(--dpdp-line)", borderRadius: 14, padding: "12px 16px", fontSize: 13.5, color: "var(--dpdp-ink2)" }}>
        <div style={{ display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
          <b style={{ color: "var(--dpdp-ink)" }}>{PROFILE_TITLE}</b>
          <progress aria-label="Profile progress" max={100} value={p.percent} style={{ flex: "0 1 160px" }} />
          <span>{p.done} of {p.total}</span>
          <button type="button" onClick={() => setOpen((o) => !o)} style={{ background: "transparent", color: "var(--dpdp-v)", textDecoration: "underline", fontWeight: 600 }}>{open ? "Close" : p.done === p.total ? "Edit" : "Add details"}</button>
        </div>
        {!open && p.done < p.total && <p style={{ margin: "6px 0 0", fontSize: 12.5 }}>{PROFILE_NUDGE}</p>}
        {open && (
          <form onSubmit={(e) => void submit(e)} style={{ marginTop: 10 }}>
            {isFirm && (
              <label style={{ display: "block", marginBottom: 8 }}>
                <input type="checkbox" checked={declared ?? isDeclared} onChange={(e) => setDeclared(e.target.checked)} /> I am a practising CA / CS / cost accountant
                <span style={{ display: "block", fontSize: 12, color: "var(--dpdp-ink3)" }}>This puts your own firm&rsquo;s file on the free plan (no client organisations). The membership number is optional.</span>
              </label>
            )}
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 8 }}>
              {fields.map(([k, label]) => (
                <label key={k}>{label}
                  <input style={input} defaultValue={stored[k] === undefined ? "" : String(stored[k])} onChange={(e) => setDraft((d) => ({ ...d, [k]: e.target.value }))} autoComplete="off" />
                </label>
              ))}
              {isFirm && (
                <label>Professional body
                  <select style={input} defaultValue={(stored.professionalBody as string | undefined) ?? ""} onChange={(e) => setDraft((d) => ({ ...d, professionalBody: e.target.value }))}>
                    <option value="">Not now</option><option value="ICAI">ICAI</option><option value="ICSI">ICSI</option><option value="ICMAI">ICMAI</option><option value="other">Another body</option>
                  </select>
                </label>
              )}
              {!isFirm && (
                <label>Type of organisation
                  <select style={input} defaultValue={(stored.institutionType as string | undefined) ?? ""} onChange={(e) => setDraft((d) => ({ ...d, institutionType: e.target.value }))}>
                    <option value="">Not now</option><option value="company">Company</option><option value="school">School</option><option value="NGO">NGO</option><option value="other">Other</option>
                  </select>
                </label>
              )}
              {!isFirm && (
                <label>Size
                  <select style={input} defaultValue={(stored.sizeBand as string | undefined) ?? ""} onChange={(e) => setDraft((d) => ({ ...d, sizeBand: e.target.value }))}>
                    <option value="">Not now</option><option value="1-10">1 to 10 people</option><option value="11-50">11 to 50</option><option value="51-200">51 to 200</option><option value="201-1000">201 to 1000</option><option value="1000+">More than 1000</option>
                  </select>
                </label>
              )}
            </div>
            <button type="submit" disabled={busy} style={{ marginTop: 10, background: "var(--dpdp-v)", color: "#fff", borderRadius: 8, padding: "7px 14px", fontWeight: 600, fontSize: 13 }}>{busy ? "Saving..." : "Save"}</button>
          </form>
        )}
        {note && <p role="status" style={{ margin: "8px 0 0", fontSize: 12.5 }}>{note}</p>}
      </div>
    </section>
  )
}
