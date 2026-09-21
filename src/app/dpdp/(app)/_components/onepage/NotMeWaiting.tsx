import "./dpdp-onepage-tokens.css"

// WO-DPDP-010 §4: shown instead of the jobs view for as long as (a) this
// person said "this isn't me" AND (b) they still have live jobs assigned to
// them -- home/page.tsx recomputes (b) from the real obligations on every
// load, so the moment the owner reassigns the work away, this screen simply
// stops appearing on its own; no separate "resolved" flag to clear.
export function NotMeWaiting({ orgName }: { orgName: string }) {
  return (
    <div className="dpdp-onepage">
      <div className="max-w-[760px] mx-auto px-5 py-14">
        <div className="rounded-[22px] border p-8 text-center" style={{ background: "var(--dpdp-card)", borderColor: "var(--dpdp-line)" }}>
          <div style={{ fontSize: 40, marginBottom: 10 }}>⏳</div>
          <h1 style={{ fontFamily: "Sora, sans-serif", fontSize: 24, fontWeight: 700, margin: "0 0 8px", color: "var(--dpdp-ink)" }}>
            We&rsquo;ve told {orgName}&rsquo;s owner
          </h1>
          <p style={{ fontSize: 15, color: "var(--dpdp-ink2)", margin: 0, maxWidth: "48ch", marginLeft: "auto", marginRight: "auto" }}>
            You said these jobs weren&rsquo;t yours. We&rsquo;ve let the owner know it needs reassigning — nothing more to do here until they fix it.
          </p>
        </div>
      </div>
    </div>
  )
}
