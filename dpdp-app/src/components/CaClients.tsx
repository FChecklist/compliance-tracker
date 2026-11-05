import "./onepage/dpdp-onepage-tokens.css"
import { useState, useTransition, type FormEvent, type ReactNode } from "react"
import type { CaClient } from "@/lib/api"
import { GuidedError } from "@/components/GuidedError"

// WO-DPDP-010 §3 "CA firm view", ported from src/app/dpdp/(app)/ca-clients/
// page.tsx (copy verbatim) onto dpdp_my_clients, plus the two things WO-011
// §4 lists that the Next.js page never had: a "Where it is" column (the
// file's stage, from the RPC) and "+ Add a client" / "Set it up for them"
// (dpdp_create_client_org). "Open" hands the client's org id back to the
// page, which re-reads dpdp_my_page for that org -- the static app's
// equivalent of switchDpdpActiveOrg + router.refresh().

export type NewClient = { name: string; product: "firm" | "institution"; ownerEmail?: string }

const input = { padding: "11px 13px", border: "1px solid var(--dpdp-line)", borderRadius: 12, fontSize: 14, background: "#fff", width: "100%" } as const
const label = { fontSize: 13, fontWeight: 600, color: "var(--dpdp-ink2)", display: "block", marginBottom: 4 } as const

export function AddClientForm({ onCreate, onCancel, refetch }: { onCreate: (c: NewClient) => Promise<void>; onCancel?: () => void; refetch: () => Promise<void> }) {
  const [name, setName] = useState("")
  const [product, setProduct] = useState<"firm" | "institution">("firm")
  const [setUp, setSetUp] = useState(false)
  const [ownerEmail, setOwnerEmail] = useState("")
  const [error, setError] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()

  function submit(e: FormEvent) {
    e.preventDefault()
    setError(null)
    if (!name.trim()) {
      setError("An organisation name is required")
      return
    }
    const owner = setUp ? ownerEmail.trim() : ""
    if (setUp && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(owner)) {
      setError("That does not look like an email address — fix it or untick “Set it up for them”.")
      return
    }
    startTransition(async () => {
      try {
        await onCreate({ name: name.trim(), product, ownerEmail: owner || undefined })
        await refetch()
        setName("")
        setOwnerEmail("")
        setSetUp(false)
        onCancel?.()
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err))
      }
    })
  }

  return (
    <form onSubmit={submit} noValidate className="rounded-2xl border p-5 flex flex-col gap-3.5 text-left" style={{ background: "var(--dpdp-card)", borderColor: "var(--dpdp-line)" }}>
      <div>
        <label htmlFor="client-name" style={label}>Client name</label>
        <input id="client-name" name="client-name" type="text" required value={name} onChange={(e) => setName(e.target.value)} disabled={pending} placeholder="e.g. Mehta Traders" style={input} />
      </div>
      <fieldset style={{ border: 0, padding: 0, margin: 0 }}>
        <legend style={label}>What kind of organisation</legend>
        <div className="flex gap-4 flex-wrap" style={{ fontSize: 14, color: "var(--dpdp-ink)" }}>
          <label className="inline-flex gap-1.5 items-center cursor-pointer">
            <input type="radio" name="product" value="firm" checked={product === "firm"} onChange={() => setProduct("firm")} disabled={pending} /> A company, NGO or firm
          </label>
          <label className="inline-flex gap-1.5 items-center cursor-pointer">
            <input type="radio" name="product" value="institution" checked={product === "institution"} onChange={() => setProduct("institution")} disabled={pending} /> A school
          </label>
        </div>
      </fieldset>
      <label className="inline-flex gap-1.5 items-center cursor-pointer" style={{ fontSize: 14, color: "var(--dpdp-ink)" }}>
        <input type="checkbox" checked={setUp} onChange={(e) => setSetUp(e.target.checked)} disabled={pending} /> Set it up for them — name the owner now
      </label>
      {setUp && (
        <div>
          <label htmlFor="owner-email" style={label}>Owner&rsquo;s email</label>
          <input id="owner-email" name="owner-email" type="email" autoComplete="off" value={ownerEmail} onChange={(e) => setOwnerEmail(e.target.value)} disabled={pending} placeholder="owner@client.example" style={input} />
          <div style={{ fontSize: 12.5, color: "var(--dpdp-ink3)", marginTop: 4 }}>They get the list you set up and a &ldquo;looks right — confirm&rdquo; screen on their first visit.</div>
        </div>
      )}
      {error && <GuidedError message={error} />}
      <div className="flex gap-2.5 items-center flex-wrap">
        <button type="submit" disabled={pending} className="font-bold text-white" style={{ background: "var(--dpdp-v)", fontSize: 14, padding: "11px 18px", borderRadius: 12, opacity: pending ? 0.6 : 1 }}>
          {pending ? "Adding…" : "Add a client"}
        </button>
        {onCancel && (
          <button type="button" disabled={pending} onClick={onCancel} style={{ background: "transparent", color: "var(--dpdp-ink3)", fontSize: 13.5, padding: "11px 10px", textDecoration: "underline" }}>
            Never mind
          </button>
        )}
        <span style={{ fontSize: 12.5, color: "var(--dpdp-ink3)" }}>The whole DPDP list is opened for them at once. Nothing is emailed to anybody yet.</span>
      </div>
    </form>
  )
}

type Rag = { key: "green" | "amber" | "red"; label: string; bg: string; fg: string; bar: string }
const RAGS: Record<Rag["key"], Rag> = {
  green: { key: "green", label: "On track", bg: "var(--dpdp-gL)", fg: "#0F6B2B", bar: "var(--dpdp-g)" },
  amber: { key: "amber", label: "Needs a push", bg: "var(--dpdp-aL)", fg: "#8A5A00", bar: "#F2B53A" },
  red: { key: "red", label: "Needs attention", bg: "var(--dpdp-rL)", fg: "var(--dpdp-r)", bar: "var(--dpdp-r)" },
}
/** Red / amber / green for one client: a signed-off file or 80%+ done is green; under 30% done is red; in between is amber. */
function ragFor(c: CaClient): Rag {
  const pct = c.total ? (c.done / c.total) * 100 : 0
  if (c.whereItIs === "Signed off" || pct >= 80) return RAGS.green
  if (pct < 30) return RAGS.red
  return RAGS.amber
}

function Card({ label, value, note }: { label: string; value: string; note?: string }) {
  return (
    <div className="rounded-2xl border p-[14px_16px]" style={{ background: "var(--dpdp-card)", borderColor: "var(--dpdp-line)" }}>
      <span style={{ fontSize: 12.5, color: "var(--dpdp-ink3)" }}>{label}</span>
      <b className="block mt-1" style={{ fontFamily: "Sora, sans-serif", fontSize: 24, fontWeight: 700, letterSpacing: "-0.02em" }}>{value}</b>
      {note && <span style={{ fontSize: 12, color: "var(--dpdp-ink3)" }}>{note}</span>}
    </div>
  )
}

/** One look across every client: how many, how much is done, who needs attention. */
function ClientsDashboard({ clients }: { clients: CaClient[] }) {
  const done = clients.reduce((n, c) => n + c.done, 0)
  const total = clients.reduce((n, c) => n + c.total, 0)
  const pct = total ? Math.round((done / total) * 100) : 0
  const signed = clients.filter((c) => c.whereItIs === "Signed off").length
  const red = clients.filter((c) => ragFor(c).key === "red").length
  const amber = clients.filter((c) => ragFor(c).key === "amber").length
  return (
    <section aria-labelledby="dash-h" className="mb-5">
      <h2 id="dash-h" style={{ fontFamily: "Sora, sans-serif", fontSize: 20, fontWeight: 700, margin: "0 0 10px", color: "var(--dpdp-ink)" }}>All your clients at a glance</h2>
      <div className="grid gap-3" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(170px, 1fr))" }}>
        <Card label="Clients" value={String(clients.length)} />
        <Card label="Jobs done, all clients" value={`${pct}%`} note={`${done} of ${total} jobs`} />
        <Card label="Signed off" value={String(signed)} note="files with the certificate ready" />
        <Card label="Need attention" value={String(red)} note={`${amber} more need a push`} />
      </div>
    </section>
  )
}

/** The path a professional follows for each client, in order, in plain words. */
function HowTo({ clients, onAdd }: { clients: CaClient[]; onAdd: () => void }) {
  const steps: Array<{ title: string; text: string; done: boolean; action?: ReactNode }> = [
    { title: "Add the client", text: "Type the client's name. Nothing is emailed to anybody yet.", done: clients.length > 0,
      action: <button type="button" onClick={onAdd} className="font-bold text-white" style={{ background: "var(--dpdp-v)", fontSize: 13, padding: "8px 14px", borderRadius: 10 }}>Start with a new client</button> },
    { title: "Pick their kind of business", text: "A company, an NGO or a school. The right DPDP job list is chosen for that kind.", done: clients.length > 0 },
    { title: "The job list is made for you", text: "Every DPDP job is opened at once, each with a date and the law it comes from.", done: clients.length > 0 },
    { title: "Give each job to a person", text: "Open the client, then give every job to the right person. Nobody is emailed until it is given.", done: clients.some((c) => c.done > 0) },
    { title: "Track it, then sign off", text: "Watch the green, amber and red on this page. When every job is done, the file is signed off and the certificate is ready.", done: clients.some((c) => c.whereItIs === "Signed off") },
  ]
  return (
    <section aria-labelledby="howto-h" className="rounded-2xl border p-5 mb-5" style={{ background: "var(--dpdp-card)", borderColor: "var(--dpdp-line)" }}>
      <h2 id="howto-h" style={{ fontFamily: "Sora, sans-serif", fontSize: 20, fontWeight: 700, margin: "0 0 4px", color: "var(--dpdp-ink)" }}>How to create DPDP compliance for a client</h2>
      <p style={{ fontSize: 13.5, color: "var(--dpdp-ink2)", margin: "0 0 12px" }}>Five easy steps, the same for every client.</p>
      <ol className="flex flex-col gap-2.5 p-0 m-0">
        {steps.map((st, i) => (
          <li key={st.title} className="flex gap-3 items-start list-none">
            <span className="rounded-full grid place-items-center flex-none font-bold" style={{ width: 28, height: 28, fontSize: 13, background: st.done ? "var(--dpdp-g)" : "var(--dpdp-vL)", color: st.done ? "#fff" : "var(--dpdp-v)" }}>{st.done ? "✓" : i + 1}</span>
            <div className="flex-1 min-w-0">
              <b style={{ fontSize: 14.5, color: "var(--dpdp-ink)" }}>{st.title}</b>
              <div style={{ fontSize: 13, color: "var(--dpdp-ink2)" }}>{st.text}</div>
              {st.action && <div className="mt-1.5">{st.action}</div>}
            </div>
          </li>
        ))}
      </ol>
    </section>
  )
}

export function CaClients({
  clients, onOpen, onCreate, onBack, refetch,
}: {
  clients: CaClient[]
  onOpen: (orgId: string) => void
  onCreate: (c: NewClient) => Promise<void>
  onBack: () => void
  refetch: () => Promise<void>
}) {
  const [adding, setAdding] = useState(false)

  return (
    <div className="dpdp-onepage">
      <div className="max-w-[900px] mx-auto px-5 py-6">
        <div className="flex justify-between items-end gap-3.5 flex-wrap mb-1.5">
          <h1 style={{ fontFamily: "Sora, sans-serif", fontSize: 28, fontWeight: 700, margin: "0 0 6px", color: "var(--dpdp-ink)" }}>My CA clients</h1>
          <button type="button" onClick={onBack} style={{ background: "transparent", color: "var(--dpdp-ink3)", fontSize: 13.5, padding: "6px 8px", textDecoration: "underline" }}>
            ← Back to my page
          </button>
        </div>
        <p style={{ fontSize: 14.5, color: "var(--dpdp-ink2)", margin: "0 0 20px" }}>
          Every organisation that named you as their CA manager or CA partner.
        </p>
        {clients.length > 0 && <ClientsDashboard clients={clients} />}
        <HowTo clients={clients} onAdd={() => setAdding(true)} />
        {clients.length === 0 ? (
          <div className="rounded-2xl border p-6 text-center mb-4" style={{ background: "var(--dpdp-card)", borderColor: "var(--dpdp-line)", color: "var(--dpdp-ink3)" }}>
            No client has named you yet.
          </div>
        ) : (
          <div className="rounded-[22px] border overflow-auto mb-4" style={{ background: "var(--dpdp-card)", borderColor: "var(--dpdp-line)" }}>
            <table className="w-full border-collapse" style={{ minWidth: 640 }}>
              <thead>
                <tr>
                  {["Client", "As", "Done", "Where it is", ""].map((h, i) => (
                    <th key={i} className="text-left whitespace-nowrap" style={{ background: "#F8F9FC", color: "var(--dpdp-ink3)", fontSize: 12, fontWeight: 600, padding: 12, borderBottom: "1px solid var(--dpdp-line)" }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {clients.map((c) => {
                  const pct = c.total ? Math.round((c.done / c.total) * 100) : 0
                  return (
                    <tr key={c.org.id}>
                      <td style={{ padding: 12, borderBottom: "1px solid var(--dpdp-line2)" }}>
                        <b style={{ fontFamily: "Sora, sans-serif", fontSize: 15, color: "var(--dpdp-ink)" }}>{c.org.name}</b>
                        <div style={{ fontSize: 12, color: "var(--dpdp-ink3)", marginTop: 2 }}>{c.org.product === "institution" ? "School" : "Company or firm"}{c.setUpByMe ? " · you set it up" : ""}</div>
                      </td>
                      <td style={{ padding: 12, borderBottom: "1px solid var(--dpdp-line2)", fontSize: 13, color: "var(--dpdp-ink2)", whiteSpace: "nowrap" }}>{c.caSub === "partner" ? "CA partner" : "CA manager"}</td>
                      <td style={{ padding: 12, borderBottom: "1px solid var(--dpdp-line2)", fontSize: 13, color: "var(--dpdp-ink2)", whiteSpace: "nowrap" }}><div>{c.done} of {c.total} done ({pct}%)</div>
                        <div className="rounded-full mt-1" style={{ height: 6, width: 120, background: "var(--dpdp-line2)" }} aria-hidden="true"><div className="rounded-full" style={{ height: 6, width: `${pct}%`, background: ragFor(c).bar }} /></div>
                        <span className="inline-block rounded-[20px] mt-1" style={{ fontSize: 11.5, fontWeight: 700, padding: "2px 9px", background: ragFor(c).bg, color: ragFor(c).fg }}>{ragFor(c).label}</span>
                      </td>
                      <td style={{ padding: 12, borderBottom: "1px solid var(--dpdp-line2)" }}>
                        <span className="inline-block rounded-[20px]" style={{ fontSize: 11.5, fontWeight: 600, padding: "3px 10px", background: c.whereItIs === "Signed off" ? "var(--dpdp-gL)" : c.whereItIs.startsWith("Waiting") ? "var(--dpdp-aL)" : "var(--dpdp-line2)", color: c.whereItIs === "Signed off" ? "#0F6B2B" : c.whereItIs.startsWith("Waiting") ? "#8A5A00" : "var(--dpdp-ink2)" }}>
                          {c.whereItIs}
                        </span>
                      </td>
                      <td style={{ padding: 12, borderBottom: "1px solid var(--dpdp-line2)", textAlign: "right" }}>
                        <button type="button" onClick={() => onOpen(c.org.id)} aria-label={`Open ${c.org.name}`} className="font-bold text-white rounded-lg" style={{ background: "var(--dpdp-v)", fontSize: 13, padding: "9px 16px" }}>
                          Open
                        </button>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
        {adding ? (
          <AddClientForm onCreate={onCreate} onCancel={() => setAdding(false)} refetch={refetch} />
        ) : (
          <button type="button" onClick={() => setAdding(true)} className="font-bold text-white" style={{ background: "var(--dpdp-v)", fontSize: 14, padding: "11px 18px", borderRadius: 12 }}>
            + Add a client
          </button>
        )}
      </div>
    </div>
  )
}
