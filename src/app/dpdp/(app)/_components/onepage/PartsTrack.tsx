"use client"

import type { PartSummary } from "@/lib/dpdp-onepage/view-model"

// Port of veridian-dpdp.html's .track / .tnode / .tring markup (vTasks()'s
// parts.map(...) block). Not shown to staff or parents (WO §3) -- callers
// decide that, this component just renders whatever list it's given.
export function PartsTrack({ parts, onJump }: { parts: PartSummary[]; onJump?: (partNumber: number) => void }) {
  if (parts.length <= 1) return null // spec: track only renders when parts.length>1

  return (
    <div
      className="flex gap-1 rounded-[22px] border p-[16px_10px_14px] my-[18px_0_14px] relative overflow-x-auto"
      style={{ background: "var(--dpdp-card)", borderColor: "var(--dpdp-line)" }}
    >
      {parts.map((p) => {
        const C = 2 * Math.PI * 15
        const full = p.pct === 100
        return (
          <button
            key={p.n}
            type="button"
            onClick={() => onJump?.(p.n)}
            title={`${p.done} of ${p.all} done`}
            className="group flex-1 min-w-[108px] flex flex-col items-center relative z-10 px-1 rounded-xl"
          >
            <svg viewBox="0 0 36 36" style={{ width: 46, height: 46 }}>
              <circle cx="18" cy="18" r="15" fill="#fff" stroke="var(--dpdp-line2)" strokeWidth="3.4" />
              {p.pct > 0 && (
                <circle
                  cx="18" cy="18" r="15" fill="none" stroke={p.color} strokeWidth="3.4" strokeLinecap="round"
                  strokeDasharray={`${((C * p.pct) / 100).toFixed(1)} ${C.toFixed(1)}`}
                  transform="rotate(-90 18 18)"
                />
              )}
              <text x="18" y="22.5" textAnchor="middle" style={{ fontFamily: "Sora, sans-serif", fontSize: 11, fontWeight: 800 }} fill={full ? "var(--dpdp-g)" : "var(--dpdp-ink)"}>
                {full ? "✓" : p.n}
              </text>
            </svg>
            <span className="text-center mt-[7px] leading-[1.25]" style={{ fontSize: 12.5, fontWeight: 600, color: "var(--dpdp-ink)" }}>{p.name}</span>
            <span className="mt-[2px]" style={{ fontSize: 11.5, color: "var(--dpdp-ink3)" }}>{p.done} of {p.all}</span>
          </button>
        )
      })}
    </div>
  )
}
