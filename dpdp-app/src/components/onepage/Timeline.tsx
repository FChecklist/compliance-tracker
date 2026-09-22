import { avatarColor, avatarInitial } from "@/lib/dpdp-onepage/view-model"

export type HistoryEntry = { who: string; what: string; at: Date; isNew?: boolean }

// Port of veridian-dpdp.html's vHistory()/.hist/.h/.hdot markup. "Nothing
// here can be edited" (spec's own subtitle) -- this component is read-only
// by construction, no action props.
export function Timeline({ entries }: { entries: HistoryEntry[] }) {
  if (!entries.length) {
    return <div className="p-4" style={{ color: "var(--dpdp-ink3)" }}>Nothing yet.</div>
  }
  return (
    <div className="rounded-[22px] border py-2" style={{ background: "var(--dpdp-card)", borderColor: "var(--dpdp-line)" }}>
      {entries.slice(0, 15).map((h, i) => (
        <div key={i} className="flex gap-3.5 px-[18px] py-2.5 relative">
          <span
            className="rounded-full flex-none mt-1.5 relative z-10"
            style={{ width: 12, height: 12, background: h.isNew ? "var(--dpdp-g)" : "var(--dpdp-v)", boxShadow: `0 0 0 4px ${h.isNew ? "var(--dpdp-gL)" : "var(--dpdp-vL)"}` }}
          />
          <div className="flex-1 min-w-0">
            <div className="flex gap-2.5 items-center flex-wrap">
              <span className="inline-flex items-center gap-2 align-middle">
                <span className="rounded-full text-white font-bold grid place-items-center flex-none" style={{ width: 20, height: 20, fontSize: 9.5, fontFamily: "Sora, sans-serif", background: avatarColor(h.who) }}>
                  {avatarInitial(h.who)}
                </span>
                <span style={{ fontSize: 12.5, color: "var(--dpdp-ink2)" }}>{h.who}</span>
              </span>
              <time style={{ fontSize: 12, color: "var(--dpdp-ink3)" }}>
                {h.at.toLocaleDateString("en-IN", { day: "2-digit", month: "short" })} {h.at.toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" })}
              </time>
            </div>
            <div className="mt-[3px]" style={{ fontSize: 13.5, color: "var(--dpdp-ink)" }}>{h.what}</div>
          </div>
        </div>
      ))}
    </div>
  )
}
