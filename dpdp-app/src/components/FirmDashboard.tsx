import "./onepage/dpdp-onepage-tokens.css"
import type { CaClient } from "@/lib/api"
import { firmRow, firmTotals } from "@/lib/dashboard-rules"
import { Tile } from "@/components/DashboardParts"

// The Firm (and Accountant Partner) dashboard: the totals strip and a one-line summary. The per-client rows (done, with whom, age) live in the
// one clients table in CaClients.tsx, so each client appears once on the page.
export function FirmDashboard({ clients }: { clients: CaClient[] }) {
  const rows = clients.map((c) => firmRow(c))
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
        <p style={{ fontSize: 14, color: "var(--dpdp-ink2)", margin: "0 0 4px" }}>
          {t.pending === 0 ? "Nothing is pending this week." : <>{rows.filter((r) => r.firstPending).length} of {t.clients} clients have work pending. The table below shows who must act next and the age in days.</>}
        </p>
      )}
      <p style={{ fontSize: 12.5, color: "var(--dpdp-ink3)", margin: "8px 0 0" }}>Age is days since the work became pending. Green 0 to 7, amber 8 to 14, orange 15 to 30, red over 30. &ldquo;No date&rdquo; means the date is not recorded yet.</p>
    </section>
  )
}
