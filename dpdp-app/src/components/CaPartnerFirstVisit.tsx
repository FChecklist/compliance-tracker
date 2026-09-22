import "./onepage/dpdp-onepage-tokens.css"
import { useState, useTransition } from "react"
import type { CaClient } from "@/lib/api"
import { AddClientForm, type NewClient } from "./CaClients"

// WO-DPDP-010 §4 "First visit, for every role" -- the CA PARTNER's three
// steps, which WO-010 left unbuilt ("STILL TO BUILD: CA partner's 3-step")
// and WO-011 §4 assigns to the static app. There is no Next.js source to
// port, so the copy here is new and deliberately short; the shape is the
// owner wizard's (FirstVisitWizard.tsx): a three-tab rail, one screen per
// step, nothing sent to anybody.
//   1. This client -- what the client named you into, and how many jobs
//      are yours here.
//   2. Your clients -- every org that has named you (dpdp_my_clients), and
//      "+ Add a client" / "Set it up for them" (dpdp_create_client_org).
//      Optional: skipping it is fine.
//   3. Got it -- one paragraph on how the weekly email and the sign-off
//      chain work, then the same acknowledge as every other role
//      (dpdp_acknowledge_welcome stamps first_visit_seen_at). Nothing else
//      needs persisting, so no new RPC exists for this screen.
export function CaPartnerFirstVisit({
  orgName, jobCount, clients, refetch, onCreate, onAcknowledge, onNotMe,
}: {
  orgName: string
  jobCount: number
  clients: CaClient[]
  refetch: () => Promise<void>
  onCreate: (c: NewClient) => Promise<void>
  onAcknowledge: () => Promise<void>
  onNotMe: () => Promise<void>
}) {
  const [step, setStep] = useState<1 | 2 | 3>(1)
  const [adding, setAdding] = useState(false)
  const [pending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)
  const [confirmingNotMe, setConfirmingNotMe] = useState(false)

  function runAndRefresh(action: () => Promise<void>) {
    startTransition(async () => {
      setError(null)
      try {
        await action()
        await refetch()
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e))
      }
    })
  }

  const STEPS = ["This client", "Your clients", "How it works"]

  return (
    <div className="dpdp-onepage">
      <div className="max-w-[900px] mx-auto px-5 py-6">
        <div className="flex justify-between items-end gap-3.5 flex-wrap mb-5">
          <h1 style={{ fontFamily: "Sora, sans-serif", fontSize: 30, fontWeight: 700, margin: 0, color: "var(--dpdp-ink)" }}>{orgName}</h1>
        </div>
        <div className="rounded-[22px] border overflow-hidden" style={{ background: "var(--dpdp-card)", borderColor: "var(--dpdp-line)" }}>
          <div className="grid grid-cols-3" style={{ borderBottom: "1px solid var(--dpdp-line2)", background: "#FAFBFD" }}>
            {STEPS.map((label, i) => {
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
            {step === 1 && (
              <>
                <h2 style={{ fontSize: 24, margin: "0 0 6px", fontWeight: 700 }}>Welcome to VERIDIAN</h2>
                <p style={{ fontSize: 15, color: "var(--dpdp-ink2)", margin: "0 0 18px", maxWidth: "72ch" }}>
                  <b>{orgName}</b> named you as their <b>CA partner</b>
                  {jobCount > 0 ? <> — you have <b>{jobCount} job{jobCount === 1 ? "" : "s"}</b> of your own here, and you sign the file once the CA manager has checked it.</> : <>. You sign the file once the CA manager has checked it.</>}
                </p>
                {error && <div role="alert" className="rounded-xl px-3.5 py-2.5 mb-3" style={{ background: "var(--dpdp-rL)", color: "var(--dpdp-r)", fontSize: 13, fontWeight: 600 }}>{error}</div>}
                {!confirmingNotMe ? (
                  <div className="flex gap-2.5 items-center flex-wrap mt-4.5">
                    <button type="button" onClick={() => setStep(2)} className="font-bold text-white" style={{ background: "var(--dpdp-v)", fontSize: 15, padding: "13px 22px", borderRadius: 14 }}>
                      Next — my clients
                    </button>
                    <button type="button" disabled={pending} onClick={() => setConfirmingNotMe(true)} style={{ background: "transparent", color: "var(--dpdp-ink3)", fontSize: 13.5, padding: "13px 10px", textDecoration: "underline" }}>
                      This isn&rsquo;t me
                    </button>
                  </div>
                ) : (
                  <div className="rounded-2xl p-4" style={{ background: "var(--dpdp-rL)", border: "1px solid #FBC5CF" }}>
                    <p style={{ fontSize: 14, margin: "0 0 12px", color: "var(--dpdp-ink)" }}>
                      We&rsquo;ll tell the owner this needs reassigning, and won&rsquo;t show your name on these jobs as done.
                    </p>
                    <div className="flex gap-2.5 items-center flex-wrap">
                      <button type="button" disabled={pending} onClick={() => runAndRefresh(onNotMe)} className="font-bold text-white" style={{ background: "var(--dpdp-r)", fontSize: 14, padding: "11px 18px", borderRadius: 12, opacity: pending ? 0.6 : 1 }}>
                        Yes, tell the owner
                      </button>
                      <button type="button" disabled={pending} onClick={() => setConfirmingNotMe(false)} style={{ background: "transparent", color: "var(--dpdp-ink3)", fontSize: 13.5, padding: "11px 10px" }}>
                        Never mind
                      </button>
                    </div>
                  </div>
                )}
              </>
            )}
            {step === 2 && (
              <>
                <h2 style={{ fontSize: 24, margin: "0 0 6px", fontWeight: 700 }}>Your clients</h2>
                <p style={{ fontSize: 15, color: "var(--dpdp-ink2)", margin: "0 0 18px", maxWidth: "72ch" }}>
                  Every organisation that named you as their CA manager or CA partner. You can add a client now — or set one up on their behalf and name the owner — or skip this and do it later from &ldquo;My clients&rdquo;.
                </p>
                {clients.length === 0 ? (
                  <div className="rounded-2xl border p-5 text-center mb-4" style={{ borderColor: "var(--dpdp-line2)", color: "var(--dpdp-ink3)", fontSize: 14 }}>No client has named you yet.</div>
                ) : (
                  <ul className="mb-4" style={{ margin: "0 0 16px", padding: 0, listStyle: "none" }}>
                    {clients.map((c) => (
                      <li key={c.org.id} className="flex justify-between gap-3 py-2.5" style={{ borderBottom: "1px solid var(--dpdp-line2)", fontSize: 14 }}>
                        <b style={{ fontFamily: "Sora, sans-serif" }}>{c.org.name}</b>
                        <span style={{ color: "var(--dpdp-ink3)" }}>As {c.caSub === "partner" ? "CA partner" : "CA manager"} · {c.done} of {c.total} done · {c.whereItIs}</span>
                      </li>
                    ))}
                  </ul>
                )}
                {adding ? (
                  <AddClientForm onCreate={onCreate} onCancel={() => setAdding(false)} refetch={refetch} />
                ) : (
                  <button type="button" onClick={() => setAdding(true)} className="font-bold text-white" style={{ background: "var(--dpdp-v)", fontSize: 14, padding: "11px 18px", borderRadius: 12 }}>
                    + Add a client
                  </button>
                )}
                <div className="flex gap-2.5 items-center flex-wrap mt-4.5">
                  <button type="button" onClick={() => setStep(3)} className="font-bold text-white" style={{ background: "var(--dpdp-v)", fontSize: 15, padding: "13px 22px", borderRadius: 14 }}>
                    Next — how it works
                  </button>
                  <button type="button" onClick={() => setStep(1)} style={{ background: "transparent", color: "var(--dpdp-ink3)", fontSize: 13.5, padding: "13px 10px", textDecoration: "underline" }}>
                    Back
                  </button>
                </div>
              </>
            )}
            {step === 3 && (
              <>
                <h2 style={{ fontSize: 24, margin: "0 0 6px", fontWeight: 700 }}>How it works</h2>
                <p style={{ fontSize: 15, color: "var(--dpdp-ink2)", margin: "0 0 12px", maxWidth: "72ch" }}>
                  Every Monday, each person named on a job gets one email with their own jobs and a button to press. Late jobs go red; after two weeks the coordinator is copied; after a month the owner is told by name.
                </p>
                <p style={{ fontSize: 15, color: "var(--dpdp-ink2)", margin: "0 0 18px", maxWidth: "72ch" }}>
                  The file closes in a chain: the owner confirms, the CA manager checks the proof, and <b>you sign</b>. Your signing job stays &ldquo;Waiting&rdquo; until the step before it is done — nothing is asked of you before then.
                </p>
                {error && <div role="alert" className="rounded-xl px-3.5 py-2.5 mb-3" style={{ background: "var(--dpdp-rL)", color: "var(--dpdp-r)", fontSize: 13, fontWeight: 600 }}>{error}</div>}
                <div className="flex gap-2.5 items-center flex-wrap mt-4.5">
                  <button type="button" disabled={pending} onClick={() => runAndRefresh(onAcknowledge)} className="font-bold text-white" style={{ background: "var(--dpdp-g)", fontSize: 15, padding: "13px 22px", borderRadius: 14, opacity: pending ? 0.6 : 1 }}>
                    Got it — show me my jobs
                  </button>
                  <button type="button" disabled={pending} onClick={() => setStep(2)} style={{ background: "transparent", color: "var(--dpdp-ink3)", fontSize: 13.5, padding: "13px 10px", textDecoration: "underline" }}>
                    Back
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
