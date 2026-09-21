"use client"

import "./dpdp-onepage-tokens.css"
import { useState, useTransition } from "react"
import { useRouter } from "next/navigation"
import { Seal } from "./Seal"
import { DoThisNow } from "./DoThisNow"
import { PartsTrack } from "./PartsTrack"
import { FilterChips } from "./FilterChips"
import { JobsTable } from "./JobsTable"
import {
  applyFilter, filterCounts, heroStats, partsForRows, vNow,
  type FilterKey, type ObligationRow, type ViewerContext,
} from "@/lib/dpdp-onepage/view-model"

// WO-DPDP-010 §3 "THE ONE PAGE, FOR EVERY ROLE": composes Hero (Seal + Do
// this now + stat cards) + Parts track + Filter chips + The table, exactly
// as the spec lays them out. Owner/coordinator/GO/CA-only sections (policy,
// email preview, report, history) are separate, not yet built -- this is
// the shared skeleton every role's page will extend.
export function OnePageView({
  orgName, rows, viewer, onMarkYes,
}: {
  orgName: string
  rows: ObligationRow[]
  viewer: ViewerContext
  onMarkYes?: (obligationId: string) => Promise<void>
}) {
  const router = useRouter()
  const [filter, setFilter] = useState<FilterKey>("all")
  const [pending, startTransition] = useTransition()
  const now = new Date()

  const staffView = viewer.kind === "staff" || viewer.kind === "parent"
  const visibleRows = staffView ? rows.filter((r) => r.by === viewer.me || r.isGroup) : rows
  const stats = heroStats(visibleRows)
  const now_ = vNow(visibleRows, viewer, now)
  const counts = filterCounts(visibleRows, viewer, now)
  const filtered = applyFilter(visibleRows, filter, viewer, now)
  const parts = staffView ? [] : partsForRows(visibleRows)

  function handleMarkYes(id: string) {
    if (!onMarkYes) return
    // Both await AND router.refresh() are needed -- see
    // FirstVisitWizard.tsx's identical fix for the full explanation.
    // Without router.refresh(), invoking the server action directly (not
    // through a <form>) leaves the DB write correct but the visible row
    // unchanged until a manual reload.
    startTransition(async () => {
      await onMarkYes(id)
      router.refresh()
    })
  }

  return (
    <div className="dpdp-onepage" style={{ fontFamily: "'Instrument Sans', system-ui, sans-serif" }}>
      <div className="max-w-[1240px] mx-auto px-5 py-6">
        <div className="flex justify-between items-end gap-3.5 flex-wrap mb-5">
          <h1 style={{ fontFamily: "Sora, sans-serif", fontSize: 30, fontWeight: 700, margin: 0, lineHeight: 1.1, color: "var(--dpdp-ink)" }}>{orgName}</h1>
        </div>

        <div className="grid gap-4.5 mb-1.5" style={{ gridTemplateColumns: staffView ? "1fr" : "236px 1fr" }}>
          {!staffView && <Seal done={stats.done} total={stats.total} />}
          <div className="flex flex-col gap-3 min-w-0">
            <DoThisNow now={now_} onAction={(a) => a === "mine" || a === "today" || a === "late" || a === "nobody" ? setFilter(a as FilterKey) : undefined} />
            {!staffView && (
              <div className="grid grid-cols-3 gap-3">
                {[
                  ["Emails sent so far", String(stats.sent)],
                  ["Last email", "—"],
                  ["Next email", "—"],
                ].map(([label, value]) => (
                  <div key={label} className="rounded-2xl border p-[14px_16px]" style={{ background: "var(--dpdp-card)", borderColor: "var(--dpdp-line)", minHeight: 86 }}>
                    <span style={{ fontSize: 12.5, color: "var(--dpdp-ink3)" }}>{label}</span>
                    <b className="block mt-1" style={{ fontFamily: "Sora, sans-serif", fontSize: 21, fontWeight: 700, letterSpacing: "-0.02em" }}>{value}</b>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        {!staffView && parts.length > 1 && <PartsTrack parts={parts} />}

        {!staffView && (
          <FilterChips counts={counts} active={filter} onChange={setFilter} />
        )}

        <div style={pending ? { opacity: 0.6, pointerEvents: "none" } : undefined}>
          <JobsTable rows={filtered} allRows={visibleRows} partSummaries={parts} viewer={viewer} staffView={staffView} now={now} onMarkYes={onMarkYes ? handleMarkYes : undefined} />
        </div>

        <div className="text-center mt-7" style={{ fontSize: 12, color: "var(--dpdp-ink3)" }}>
          VERIDIAN · VERy INDIAN — Your DPDP proof, not just your DPDP policy. · Stored in India · no passwords · we never keep your documents
        </div>
      </div>
    </div>
  )
}
