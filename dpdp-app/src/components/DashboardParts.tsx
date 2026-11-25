import type { AgeBucket } from "@/lib/dashboard-rules"
import { BUCKET_LABEL } from "@/lib/dashboard-rules"

const COLOURS: Record<AgeBucket, { bg: string; fg: string }> = {
  green: { bg: "#DDF3E4", fg: "#0F6B2B" }, amber: { bg: "#FFF1CC", fg: "#7A5200" },
  orange: { bg: "#FFE0C2", fg: "#8A3F00" }, red: { bg: "#FCD9D9", fg: "#9B1C1C" }, none: { bg: "#EEF0F4", fg: "#4A5160" },
}

/** Ageing as colour plus words (never colour alone). */
export function AgeBadge({ days, bucket }: { days: number | null; bucket: AgeBucket }) {
  const c = COLOURS[bucket]
  return (
    <span className="inline-block rounded-[20px] whitespace-nowrap" title={BUCKET_LABEL[bucket]} style={{ background: c.bg, color: c.fg, fontSize: 12, fontWeight: 700, padding: "3px 10px" }}>
      {days === null ? "No date" : `${days} ${days === 1 ? "day" : "days"}`}
    </span>
  )
}

export function StateMark({ state }: { state: "done" | "pending" }) {
  return <span style={{ fontSize: 13, fontWeight: 600, color: state === "done" ? "#0F6B2B" : "#7A5200" }}>{state === "done" ? "✓ Done" : "Pending"}</span>
}

export function Tile({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-2xl border p-[12px_14px]" style={{ background: "var(--dpdp-card)", borderColor: "var(--dpdp-line)" }}>
      <span style={{ fontSize: 12.5, color: "var(--dpdp-ink3)" }}>{label}</span>
      <b className="block mt-1" style={{ fontFamily: "Sora, sans-serif", fontSize: 24, fontWeight: 700 }}>{value}</b>
    </div>
  )
}
