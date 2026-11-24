import "./onepage/dpdp-onepage-tokens.css"
import type { ObligationRow } from "@/lib/dpdp-onepage/view-model"
import { clientItems, STEP_NAMES, type StepId } from "@/lib/dashboard-rules"
import { AgeBadge, StateMark, Tile } from "@/components/DashboardParts"

const NEXT: Record<StepId, string> = {
  discover: "Say what data there is, where it is, and with whom.",
  decide: "Name who will do each job, and by when.",
  do: "Do each job, then mark it done.",
}
const SHOWN = 5

// The client's own dashboard: Step 1 Discover, Step 2 Decide, Step 3 Do. It only reads the rows of the one organisation already loaded for this
// signed-in person, so a client never sees another client's data.
export function ClientDashboard({ rows }: { rows: ObligationRow[] }) {
  const items = clientItems(rows)
  const pending = items.filter((i) => i.state === "pending")
  const oldest = pending.reduce<number | null>((m, i) => (i.ageDays === null ? m : m === null ? i.ageDays : Math.max(m, i.ageDays)), null)
  return (
    <div className="dpdp-onepage" data-testid="client-dashboard">
      <div className="max-w-[1240px] mx-auto px-5 pt-4">
        <section className="rounded-[22px] border p-6" style={{ background: "var(--dpdp-card)", borderColor: "var(--dpdp-line)" }} aria-labelledby="client-dash-h">
          <h2 id="client-dash-h" style={{ fontFamily: "Sora, sans-serif", fontSize: 22, fontWeight: 700, margin: "0 0 10px", color: "var(--dpdp-ink)" }}>Where things stand</h2>
          <div className="grid gap-3 mb-4" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))" }}>
            <Tile label="Done" value={String(items.length - pending.length)} />
            <Tile label="Pending" value={String(pending.length)} />
            <Tile label="Oldest pending" value={oldest === null ? "None" : `${oldest} days`} />
          </div>
          <div className="grid gap-4" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))" }}>
            {(["discover", "decide", "do"] as StepId[]).map((s, i) => {
              const inStep = items.filter((x) => x.step === s)
              const open = inStep.filter((x) => x.state === "pending").sort((a, b) => (b.ageDays ?? 0) - (a.ageDays ?? 0))
              const done = inStep.length - open.length
              return (
                <article key={s} className="rounded-2xl border p-4" style={{ borderColor: "var(--dpdp-line)", background: "#fff" }} aria-labelledby={`cd-${s}`}>
                  <h3 id={`cd-${s}`} style={{ fontFamily: "Sora, sans-serif", fontSize: 17, fontWeight: 700, margin: 0 }}>Step {i + 1} · {STEP_NAMES[s]}</h3>
                  <p style={{ fontSize: 13, color: "var(--dpdp-ink2)", margin: "4px 0 8px" }}>{done} done · {open.length} pending</p>
                  {open.length === 0 ? <p style={{ fontSize: 13.5 }}><StateMark state="done" /> Nothing pending here.</p> : (
                    <table className="w-full border-collapse" style={{ fontSize: 13 }}>
                      <caption className="sr-only">Pending items for {STEP_NAMES[s]}, oldest first</caption>
                      <thead><tr>{["Item", "With whom", "Age"].map((h) => <th key={h} scope="col" className="text-left" style={{ fontSize: 12, color: "var(--dpdp-ink3)", padding: "4px 6px 4px 0" }}>{h}</th>)}</tr></thead>
                      <tbody>
                        {open.slice(0, SHOWN).map((x) => (
                          <tr key={x.id}>
                            <td style={{ padding: "6px 6px 6px 0", borderTop: "1px solid var(--dpdp-line2)" }}>{x.what}</td>
                            <td style={{ padding: "6px 6px 6px 0", borderTop: "1px solid var(--dpdp-line2)", wordBreak: "break-word" }}>{x.withWhom}</td>
                            <td style={{ padding: "6px 0", borderTop: "1px solid var(--dpdp-line2)" }}><AgeBadge days={x.ageDays} bucket={x.bucket} /></td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  )}
                  {open.length > SHOWN && <p style={{ fontSize: 12.5, color: "var(--dpdp-ink3)", margin: "6px 0 0" }}>and {open.length - SHOWN} more, in the list below.</p>}
                  <p style={{ fontSize: 13, margin: "8px 0 0", color: "var(--dpdp-ink)" }}><b>Next:</b> {open.length === 0 ? "Nothing. Check again next week." : NEXT[s]}</p>
                </article>
              )
            })}
          </div>
          <p style={{ fontSize: 12.5, color: "var(--dpdp-ink3)", margin: "10px 0 0" }}>Age is days past the due date. Green 0 to 7, amber 8 to 14, orange 15 to 30, red over 30.</p>
        </section>
      </div>
    </div>
  )
}
