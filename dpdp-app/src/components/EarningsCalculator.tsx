import { useState } from "react"
import { EARNINGS_DISCLAIMER, earningsExample, formatRupees, planForClients } from "@/lib/billing-state"
import type { PlanWirePayload } from "@/lib/rpc-types"

// The firm's small earnings calculator: clients x what you charge each per month, minus the plan that covers that many clients. The plan price
// comes from the plans table (dpdp_public_plans) through `plans`; nothing is typed in here. Labelled as an example, never a promise.
export function EarningsCalculator({ plans }: { plans: PlanWirePayload[] }) {
  const [clients, setClients] = useState(20)
  const [fee, setFee] = useState(500)
  const plan = planForClients(plans, clients)
  const e = earningsExample(clients, fee, plan ? plan.monthlyPaise : 0)
  const field = { display: "block", width: "100%", marginTop: 3, padding: "6px 8px", borderRadius: 8, border: "1px solid var(--dpdp-line)", fontSize: 14, background: "#fff", color: "var(--dpdp-ink)" } as const
  return (
    <div style={{ border: "1px solid var(--dpdp-line)", borderRadius: 12, padding: "12px 14px", textAlign: "left" }}>
      <b style={{ color: "var(--dpdp-ink)", fontSize: 14 }}>What could this earn your firm?</b>
      <div style={{ display: "flex", gap: 10, marginTop: 8 }}>
        <label style={{ flex: 1, fontSize: 13 }}>Clients
          <input style={field} type="number" min={0} max={1000} inputMode="numeric" value={clients} onChange={(ev) => setClients(Number(ev.target.value))} />
        </label>
        <label style={{ flex: 1, fontSize: 13 }}>You charge each, a month (Rs)
          <input style={field} type="number" min={0} inputMode="numeric" value={fee} onChange={(ev) => setFee(Number(ev.target.value))} />
        </label>
      </div>
      <p style={{ margin: "10px 0 0", fontSize: 13.5, color: "var(--dpdp-ink2)" }} aria-live="polite">
        {e.clients} clients × {formatRupees(e.feePerClientRupees * 100)} = {formatRupees(e.monthlyIncomeRupees * 100)} a month
        {plan ? <>, less the {plan.name} plan {formatRupees(plan.monthlyPaise)}</> : <>, less your plan</>}
        {" "}= <b>{formatRupees(Math.round(e.netRupees * 100))}</b> a month.
      </p>
      <p style={{ margin: "4px 0 0", fontSize: 12, color: "var(--dpdp-ink3)" }}>{EARNINGS_DISCLAIMER} Plan prices are per month, plus GST.</p>
    </div>
  )
}
