import { getDpdpAuthContext } from "@/lib/services/dpdp-session"
import { listCaClientOrgs } from "@/lib/services/dpdp-organisation-service"
import { OpenClientButton } from "./OpenClientButton"
import "../_components/onepage/dpdp-onepage-tokens.css"

// WO-DPDP-010 §3 "CA firm view": every org where the signed-in identity is
// named CA manager/partner on a live obligation, one row per client, with
// a "% done" stat and a button to switch the session's active org and jump
// straight to that client's own /dpdp/home -- reuses the existing (pre-
// WO-010) switchDpdpActiveOrg API rather than inventing a second mechanism
// for "look at a different org from this identity".
export default async function CaClientsPage() {
  const ctx = await getDpdpAuthContext()
  if (!ctx) return null
  const clients = await listCaClientOrgs(ctx.identityId)

  return (
    <div className="dpdp-onepage">
      <div className="max-w-[900px] mx-auto px-5 py-6">
        <h1 style={{ fontFamily: "Sora, sans-serif", fontSize: 28, fontWeight: 700, margin: "0 0 6px", color: "var(--dpdp-ink)" }}>My CA clients</h1>
        <p style={{ fontSize: 14.5, color: "var(--dpdp-ink2)", margin: "0 0 20px" }}>
          Every organisation that named you as their CA manager or CA partner.
        </p>
        {clients.length === 0 ? (
          <div className="rounded-2xl border p-6 text-center" style={{ background: "var(--dpdp-card)", borderColor: "var(--dpdp-line)", color: "var(--dpdp-ink3)" }}>
            No client has named you yet.
          </div>
        ) : (
          <div className="rounded-[22px] border overflow-hidden" style={{ background: "var(--dpdp-card)", borderColor: "var(--dpdp-line)" }}>
            {clients.map((c, i) => {
              const pct = c.total ? Math.round((c.done / c.total) * 100) : 0
              return (
                <div
                  key={c.org.id}
                  className="flex items-center justify-between gap-4 px-5 py-4"
                  style={{ borderBottom: i < clients.length - 1 ? "1px solid var(--dpdp-line2)" : undefined }}
                >
                  <div>
                    <b style={{ fontFamily: "Sora, sans-serif", fontSize: 16, color: "var(--dpdp-ink)" }}>{c.org.name}</b>
                    <div style={{ fontSize: 12.5, color: "var(--dpdp-ink3)", marginTop: 2 }}>
                      As {c.caSub === "partner" ? "CA partner" : "CA manager"} · {c.done} of {c.total} done ({pct}%)
                    </div>
                  </div>
                  <OpenClientButton orgId={c.org.id} />
                </div>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}
