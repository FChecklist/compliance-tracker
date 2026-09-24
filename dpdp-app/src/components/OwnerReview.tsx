import "./onepage/dpdp-onepage-tokens.css"
import { useState, useTransition } from "react"
import { PARTS, partsForRows, type ObligationRow } from "@/lib/dpdp-onepage/view-model"

// WO-DPDP-010 §2/§4: the OWNER's first visit when a CA "set it up for them"
// (organisation.set_up_by_membership_id set, owner_confirmed_at null). The
// schema's own words for this act -- "Looks right -- confirm" -- are the
// button. In place of the owner wizard (there is nothing to create: the CA
// already did), this shows what the CA set up -- the list by part and who
// looks after what -- and asks for one confirmation
// (dpdp_owner_confirm_setup stamps owner_confirmed_at and the owner's
// first_visit_seen_at together). No Next.js source exists for this screen;
// the copy is new. Nothing is sent to anybody on confirm.
export function OwnerReview({
  orgName, caEmail, rows, refetch, onConfirm,
}: {
  orgName: string
  caEmail: string | null
  rows: ObligationRow[]
  refetch: () => Promise<void>
  onConfirm: () => Promise<void>
}) {
  const [pending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)
  const parts = partsForRows(rows)
  const totalJobs = rows.length
  const people = [...new Set(rows.filter((r) => r.by && !r.na).map((r) => r.by!))]
  const nobody = rows.filter((r) => !r.by && !r.na).length
  const who = caEmail ?? "Your CA"

  function confirm() {
    startTransition(async () => {
      setError(null)
      try {
        await onConfirm()
        await refetch()
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e))
      }
    })
  }

  return (
    <div className="dpdp-onepage">
      <div className="max-w-[1240px] mx-auto px-5 py-6">
        <div className="flex justify-between items-end gap-3.5 flex-wrap mb-5">
          <h1 style={{ fontFamily: "Sora, sans-serif", fontSize: 30, fontWeight: 700, margin: 0, color: "var(--dpdp-ink)" }}>{orgName}</h1>
        </div>
        <div className="rounded-[22px] border overflow-hidden" style={{ background: "var(--dpdp-card)", borderColor: "var(--dpdp-line)" }}>
          <div className="p-7">
            <h2 style={{ fontSize: 24, margin: "0 0 6px", fontWeight: 700 }}>{who} set this up for you</h2>
            <p style={{ fontSize: 15, color: "var(--dpdp-ink2)", margin: "0 0 18px", maxWidth: "72ch" }}>
              Here is the DPDP list they created — <b>{totalJobs} jobs</b> — and who looks after what. If it looks right, confirm below. If anything is wrong, tell your CA and they can change it before you confirm. You can add, change, remove or mark any job &ldquo;doesn&rsquo;t apply&rdquo; later.
            </p>
            <div className="grid grid-cols-2 gap-2.5 mb-5">
              {PARTS.map((p) => {
                const part = parts.find((x) => x.n === p.n)
                if (!part) return null
                return (
                  <div key={p.n} className="p-3" style={{ border: "1px solid var(--dpdp-line2)", borderLeft: `4px solid ${p.color}`, borderRadius: 12, fontSize: 13.5, background: "#fff" }}>
                    <i className="not-italic" style={{ fontSize: 11.5, fontWeight: 700, color: p.color, marginRight: 8 }}>Part {p.n}</i>
                    <b style={{ fontFamily: "Sora, sans-serif" }}>{p.name}</b> — {part.all} job{part.all !== 1 ? "s" : ""}
                  </div>
                )
              })}
            </div>
            <h3 style={{ fontSize: 16, margin: "0 0 8px", fontWeight: 700 }}>Who looks after what</h3>
            {people.length === 0 ? (
              <p style={{ fontSize: 14, color: "var(--dpdp-ink3)", margin: "0 0 18px" }}>Nobody has been named yet — every job shows amber until you or your CA name someone.</p>
            ) : (
              <ul style={{ margin: "0 0 18px", padding: 0, listStyle: "none" }}>
                {people.map((p) => (
                  <li key={p} className="py-2" style={{ borderBottom: "1px solid var(--dpdp-line2)", fontSize: 14 }}>
                    <b>{p}</b> <span style={{ color: "var(--dpdp-ink3)" }}>— {rows.filter((r) => r.by === p && !r.na).length} job{rows.filter((r) => r.by === p && !r.na).length !== 1 ? "s" : ""}</span>
                  </li>
                ))}
                {nobody > 0 && (
                  <li className="py-2" style={{ fontSize: 14, color: "var(--dpdp-ink3)" }}>{nobody} job{nobody !== 1 ? "s have" : " has"} nobody yet — that is fine for now.</li>
                )}
              </ul>
            )}
            {error && <div role="alert" className="rounded-2xl p-3.5 mb-4" style={{ background: "var(--dpdp-rL)", border: "1px solid #FBC5CF", fontSize: 13.5 }}>{error}</div>}
            <div className="flex gap-2.5 items-center flex-wrap mt-4.5">
              <button type="button" disabled={pending} onClick={confirm} className="font-bold text-white" style={{ background: "var(--dpdp-g)", fontSize: 15, padding: "13px 22px", borderRadius: 14, opacity: pending ? 0.6 : 1 }}>
                Looks right — confirm
              </button>
              <span style={{ fontSize: 13, color: "var(--dpdp-ink3)" }}>Nothing is sent to anybody yet.</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
