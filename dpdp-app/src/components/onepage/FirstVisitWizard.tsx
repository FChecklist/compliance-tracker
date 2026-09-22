import "./dpdp-onepage-tokens.css"
import { useState, useTransition } from "react"
import { AREA_CAN_MARK_NA, AREA_HELP, AREA_PREFILL_WITH_OWNER, PARTS, partsForRows, type ObligationRow } from "@/lib/dpdp-onepage/view-model"

export type Area = { area: string; jobs: string[]; isGroup: boolean }
export type AreaAnswer = { emails: string; na: boolean }

// Port of veridian-dpdp.html's vWizard() -- the client-owner's 3-step first
// visit. Step 3 (policy) is intentionally NOT included here -- it's
// optional in the spec, and PolicySection (always visible further down the
// real page) already covers it, so completing the wizard isn't gated on it.
//
// WO-DPDP-011 port: `router.refresh()` became the `refetch` prop (see
// OnePageView.tsx for why), and an RPC failure is shown in the wizard's own
// error box instead of bubbling out of a server action. Copy is verbatim
// from the Next.js version.
export function FirstVisitWizard({
  orgName, rows, areas, ownerEmail, refetch, onComplete,
}: {
  orgName: string
  rows: ObligationRow[]
  areas: Area[]
  ownerEmail: string
  refetch: () => Promise<void>
  onComplete: (assignments: Array<{ area: string; emails: string[]; na: boolean }>) => Promise<void>
}) {
  const [step, setStep] = useState<1 | 2>(1)
  const [pending, startTransition] = useTransition()
  const [answers, setAnswers] = useState<Record<string, AreaAnswer>>(() => {
    const initial: Record<string, AreaAnswer> = {}
    for (const a of areas) initial[a.area] = { emails: AREA_PREFILL_WITH_OWNER.has(a.area) ? ownerEmail : "", na: false }
    return initial
  })
  const [error, setError] = useState<string | null>(null)

  const parts = partsForRows(rows)
  const totalJobs = rows.length

  function setEmails(area: string, emails: string) {
    setAnswers((prev) => ({ ...prev, [area]: { ...prev[area], emails } }))
  }
  function toggleNa(area: string, na: boolean) {
    setAnswers((prev) => ({ ...prev, [area]: { ...prev[area], na } }))
  }

  function handleSave() {
    setError(null)
    const bad: string[] = []
    for (const a of areas) {
      const ans = answers[a.area]
      if (ans.na) continue
      const list = ans.emails.split(/[,;\s]+/).filter(Boolean)
      for (const e of list) if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(e)) bad.push(`${a.area}: ${e}`)
    }
    if (bad.length) {
      setError(`These do not look like email addresses — fix them or clear the box: ${bad.join(", ")}`)
      return
    }
    const assignments = areas.map((a) => {
      const ans = answers[a.area]
      return { area: a.area, na: ans.na, emails: ans.na ? [] : ans.emails.split(/[,;\s]+/).filter(Boolean) }
    })
    // Await inside the transition so React tracks the mutation as pending
    // work, then refetch so the page repaints from the real, re-read DB
    // state (the RPC stamped firstVisitSeenAt; the refetched page is what
    // stops showing the wizard). refetch runs only after success so a failed
    // write can't repaint the page.
    startTransition(async () => {
      try {
        await onComplete(assignments)
        await refetch()
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e))
      }
    })
  }

  const answeredCount = areas.filter((a) => answers[a.area]?.na || answers[a.area]?.emails.trim()).length

  return (
    <div className="dpdp-onepage">
      <div className="max-w-[1240px] mx-auto px-5 py-6">
        <div className="flex justify-between items-end gap-3.5 flex-wrap mb-5">
          <h1 style={{ fontFamily: "Sora, sans-serif", fontSize: 30, fontWeight: 700, margin: 0, color: "var(--dpdp-ink)" }}>{orgName}</h1>
        </div>
        <div className="rounded-[22px] border overflow-hidden" style={{ background: "var(--dpdp-card)", borderColor: "var(--dpdp-line)" }}>
          <div className="grid grid-cols-3" style={{ borderBottom: "1px solid var(--dpdp-line2)", background: "#FAFBFD" }}>
            {["Create your list", "Who looks after what"].map((label, i) => {
              const n = i + 1
              const state = n < step ? "dn" : n === step ? "on" : ""
              return (
                <div key={label} className="flex gap-2.5 items-center px-[18px] py-3.5" style={{ fontSize: 13, fontWeight: 600, color: state === "on" ? "var(--dpdp-ink)" : "var(--dpdp-ink3)", background: state === "on" ? "#fff" : undefined, boxShadow: state === "on" ? "inset 0 -2px 0 var(--dpdp-v)" : undefined }}>
                  <span className="rounded-full grid place-items-center flex-none" style={{ width: 26, height: 26, fontFamily: "Sora, sans-serif", fontWeight: 700, fontSize: 12, background: state === "dn" ? "var(--dpdp-g)" : state === "on" ? "var(--dpdp-v)" : "var(--dpdp-line2)", color: state === "" ? "var(--dpdp-ink3)" : "#fff" }}>
                    {state === "dn" ? "✓" : n}
                  </span>
                  <span>{label}</span>
                </div>
              )
            })}
          </div>
          <div className="p-7">
            {step === 1 ? (
              <>
                <h2 style={{ fontSize: 24, margin: "0 0 6px", fontWeight: 700 }}>First, here is your DPDP list</h2>
                <p style={{ fontSize: 15, color: "var(--dpdp-ink2)", margin: "0 0 18px", maxWidth: "72ch" }}>
                  We have already written down what the DPDP Act asks of your organisation — <b>{totalJobs} jobs</b>. You can add, change, remove or mark any of them &ldquo;doesn&rsquo;t apply&rdquo; later.
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
                <div className="flex gap-2.5 items-center flex-wrap mt-4.5">
                  <button type="button" onClick={() => setStep(2)} className="font-bold text-white" style={{ background: "var(--dpdp-v)", fontSize: 15, padding: "13px 22px", borderRadius: 14 }}>
                    ✓ Create the list
                  </button>
                  <span style={{ fontSize: 13, color: "var(--dpdp-ink3)" }}>Nothing is sent to anybody yet.</span>
                </div>
              </>
            ) : (
              <>
                <h2 style={{ fontSize: 24, margin: "0 0 6px", fontWeight: 700 }}>Who looks after what?</h2>
                <p style={{ fontSize: 15, color: "var(--dpdp-ink2)", margin: "0 0 18px", maxWidth: "72ch" }}>
                  An email next to each. <b>Not sure? Leave it empty</b> — it shows amber and can be filled in later. <b>Don&rsquo;t have one?</b> Tick &ldquo;we don&rsquo;t have this&rdquo;. One person can look after several things — just type the same email.
                </p>
                {areas.map((a) => {
                  const ans = answers[a.area]
                  const isPrefilled = AREA_PREFILL_WITH_OWNER.has(a.area) && ans.emails === ownerEmail
                  return (
                    <div key={a.area} className="grid gap-3.5 items-start py-3.5" style={{ gridTemplateColumns: "240px 1fr", borderBottom: "1px solid var(--dpdp-line2)" }}>
                      <div>
                        <b style={{ fontSize: 14, display: "block" }}>{a.area}{isPrefilled && <span className="ml-1.5 rounded-[20px]" style={{ display: "inline-block", background: "var(--dpdp-vL)", color: "var(--dpdp-v)", fontSize: 11, fontWeight: 700, padding: "2px 8px" }}>your email — change if someone else</span>}</b>
                        <div style={{ fontSize: 12.5, color: "var(--dpdp-ink3)", marginTop: 3 }}>{AREA_HELP[a.area] ?? ""}</div>
                      </div>
                      <div>
                        {a.isGroup ? (
                          <textarea rows={2} value={ans.emails} onChange={(e) => setEmails(a.area, e.target.value)} placeholder="paste every email, separated by commas" disabled={ans.na}
                            className="w-full" style={{ padding: "11px 13px", border: "1px solid var(--dpdp-line)", borderRadius: 12, fontSize: 14, opacity: ans.na ? 0.35 : 1 }} />
                        ) : (
                          <input type="email" value={ans.emails} onChange={(e) => setEmails(a.area, e.target.value)} placeholder="name@example.com" disabled={ans.na}
                            className="w-full" style={{ padding: "11px 13px", border: "1px solid var(--dpdp-line)", borderRadius: 12, fontSize: 14, opacity: ans.na ? 0.35 : 1 }} />
                        )}
                        <div style={{ fontSize: 11.5, color: "var(--dpdp-ink3)", marginTop: 4 }}>{a.jobs.length} job{a.jobs.length !== 1 ? "s" : ""}: {a.jobs.slice(0, 3).join(" · ")}{a.jobs.length > 3 ? ` — and ${a.jobs.length - 3} more` : ""}</div>
                        {AREA_CAN_MARK_NA.has(a.area) && (
                          <label className="inline-flex gap-1.5 items-center mt-2 cursor-pointer" style={{ fontSize: 12.5, color: "var(--dpdp-ink2)" }}>
                            <input type="checkbox" checked={ans.na} onChange={(e) => toggleNa(a.area, e.target.checked)} /> We don&rsquo;t have this
                          </label>
                        )}
                      </div>
                    </div>
                  )
                })}
                {error && <div className="rounded-2xl p-3.5 mt-4" style={{ background: "var(--dpdp-rL)", border: "1px solid #FBC5CF", fontSize: 13.5 }}>{error}</div>}
                <div className="flex gap-2.5 items-center flex-wrap mt-4.5">
                  <button type="button" disabled={pending} onClick={handleSave} className="font-bold text-white" style={{ background: "var(--dpdp-g)", fontSize: 15, padding: "13px 22px", borderRadius: 14, opacity: pending ? 0.6 : 1 }}>
                    ✓ Save and send the first emails
                  </button>
                  <span style={{ fontSize: 13, color: "var(--dpdp-ink3)" }}>{answeredCount} of {areas.length} answered. Empty ones stay amber — that is fine.</span>
                </div>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
