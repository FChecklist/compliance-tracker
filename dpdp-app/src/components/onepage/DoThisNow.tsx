import type { DoThisNow as DoThisNowT } from "@/lib/dpdp-onepage/view-model"

// Port of veridian-dpdp.html's .now box (vNow()'s rendered output).
export function DoThisNow({ now, onAction }: { now: DoThisNowT; onAction?: (action: string) => void }) {
  return (
    <div className="rounded-[22px] px-5 py-[18px] flex gap-4 items-center flex-wrap" style={{ background: "var(--dpdp-ink)", color: "#fff" }}>
      <div className="text-[22px] w-12 h-12 rounded-2xl grid place-items-center flex-none" style={{ background: "rgba(255,255,255,.1)" }}>{now.icon}</div>
      <div className="flex-1 min-w-[220px]">
        <div style={{ fontSize: 12, fontWeight: 600, color: "#B9BCF0" }}>Do this now</div>
        <b className="block" style={{ fontFamily: "Sora, sans-serif", fontSize: 19, fontWeight: 700, lineHeight: 1.25, margin: "3px 0 4px", letterSpacing: "-0.01em" }}>{now.title}</b>
        <span style={{ fontSize: 13.5, color: "#CFD1F3" }}>{now.subtitle}</span>
      </div>
      {now.buttonLabel && (
        <button
          type="button"
          onClick={() => now.action && onAction?.(now.action)}
          className="flex-none font-bold rounded-xl px-[18px] py-[11px]"
          style={{ background: "#F2B53A", color: "var(--dpdp-ink)", fontSize: 14 }}
        >
          {now.buttonLabel}
        </button>
      )}
    </div>
  )
}
