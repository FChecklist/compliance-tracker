"use client"

import type { FilterKey } from "@/lib/dpdp-onepage/view-model"

const CHIP_LABELS: Array<[FilterKey, string]> = [
  ["all", "All"], ["mine", "Mine"], ["pending", "Not done"], ["late", "Late"],
  ["today", "Required today"], ["nobody", "Nobody named"], ["done", "Done"],
]

// Port of veridian-dpdp.html's .chip / .tools toolbar row.
export function FilterChips({
  counts, active, onChange,
}: { counts: Record<FilterKey, number>; active: FilterKey; onChange: (f: FilterKey) => void }) {
  return (
    <div className="flex gap-1.5 flex-wrap items-center mb-2.5">
      {CHIP_LABELS.map(([key, label]) => {
        const on = active === key
        return (
          <button
            key={key}
            type="button"
            onClick={() => onChange(key)}
            className="rounded-[20px] font-semibold"
            style={{
              padding: "7px 13px", fontSize: 12.5,
              background: on ? "var(--dpdp-ink)" : "var(--dpdp-card)",
              color: on ? "#fff" : "var(--dpdp-ink2)",
              border: `1px solid ${on ? "var(--dpdp-ink)" : "var(--dpdp-line)"}`,
            }}
          >
            {label}
            <i
              className="ml-1.5 not-italic rounded-[10px]"
              style={{
                fontSize: 11, padding: "1px 7px",
                background: on ? "rgba(255,255,255,.18)" : "var(--dpdp-line2)",
                color: on ? "#fff" : "var(--dpdp-ink2)",
              }}
            >
              {counts[key]}
            </i>
          </button>
        )
      })}
    </div>
  )
}
