import "./onepage/dpdp-onepage-tokens.css"
import type { CaClient } from "@/lib/api"
import { firmRow, firmTotals, sortFirmRows, STEP_NAMES } from "@/lib/dashboard-rules"
import { AgeBadge, StateMark, Tile } from "@/components/DashboardParts"

// The Firm (and Accountant Partner) dashboard: one row per client, oldest pending first. Five columns: Client, This week, With whom, Age, Open.
// "This week" shows the three steps (Discover, Decide, Do) as one short line each, so the table stays at five columns on a phone.
export function FirmDashboard({ clients, onOpen }: { clients: CaClient[]; onOpen: (orgId: string) => void }) {
  const rows = sortFirmRows(clients.map((c) => firmRow(c)))
  const t = firmTotals(rows)
  return (
    <section aria-labelledby="firm-dash-h" data-testid="firm-dashboard" className="mb-5">
      <h2 id="firm-dash-h" style={{ fontFamily: "Sora, sans-serif", fontSize: 20, fontWeight: 700, margin: "0 0 10px", color: "var(--dpdp-ink)" }}>This week, client by client</h2>
      <div className="grid gap-3 mb-3" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))" }}>
        <Tile label="Clients" value={String(t.clients)} />
        <Tile label="Done this week" value={String(t.done)} />
        <Tile label="Pending" value={String(t.pending)} />
        <Tile label="Oldest pending" value={t.oldestPending === null ? "No date" : `${t.oldestPending} days`} />
      </div>
      {rows.length === 0 ? (
        <p className="rounded-2xl border p-5" style={{ background: "var(--dpdp-card)", borderColor: "var(--dpdp-line)", color: "var(--dpdp-ink3)" }}>No clients yet. Add the first one below.</p>
      ) : (
        <div className="rounded-[22px] border overflow-x-auto" style={{ background: "var(--dpdp-card)", borderColor: "var(--dpdp-line)" }}>
          <table className="w-full border-collapse">
            <caption className="sr-only">Clients, with this week&rsquo;s Discover, Decide and Do, who must act next, and age in days. Oldest pending first.</caption>
            <thead>
              <tr>
                {["Client", "This week", "With whom", "Age", "Open"].map((h) => (
                  <th key={h} scope="col" className="text-left" style={{ background: "#F8F9FC", color: "var(--dpdp-ink3)", fontSize: 12, fontWeight: 600, padding: 10, borderBottom: "1px solid var(--dpdp-line)" }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.orgId}>
                  <th scope="row" className="text-left" style={{ padding: 10, borderBottom: "1px solid var(--dpdp-line2)", fontSize: 14.5, color: "var(--dpdp-ink)" }}>{r.name}</th>
                  <td style={{ padding: 10, borderBottom: "1px solid var(--dpdp-line2)", fontSize: 12.5 }}>
                    {(["discover", "decide", "do"] as const).map((s) => <div key={s}>{STEP_NAMES[s]}: <StateMark state={r.steps[s]} /></div>)}
                  </td>
                  <td style={{ padding: 10, borderBottom: "1px solid var(--dpdp-line2)", fontSize: 13, color: "var(--dpdp-ink2)" }}>{r.withWhom ?? "Nobody. All done."}</td>
                  <td style={{ padding: 10, borderBottom: "1px solid var(--dpdp-line2)" }}>{r.firstPending ? <AgeBadge days={r.ageDays} bucket={r.bucket} /> : <span style={{ fontSize: 13 }}>—</span>}</td>
                  <td style={{ padding: 10, borderBottom: "1px solid var(--dpdp-line2)" }}>
                    <button type="button" onClick={() => onOpen(r.orgId)} aria-label={`Open ${r.name}`} className="font-bold text-white rounded-lg" style={{ background: "var(--dpdp-v)", fontSize: 13, padding: "9px 14px" }}>Open</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <p style={{ fontSize: 12.5, color: "var(--dpdp-ink3)", margin: "8px 0 0" }}>Age is days since the work became pending. Green 0 to 7, amber 8 to 14, orange 15 to 30, red over 30. &ldquo;No date&rdquo; means the date is not recorded yet.</p>
    </section>
  )
}
