import "./dpdp-onepage-tokens.css"
import { useEffect, useState, useTransition } from "react"
import { Seal } from "./Seal"
import { DoThisNow } from "./DoThisNow"
import { PartsTrack } from "./PartsTrack"
import { FilterChips } from "./FilterChips"
import { JobsTable } from "./JobsTable"
import type { JobActionHandlers } from "@/lib/dpdp-onepage/job-actions"
import {
  applyFilter, filterCounts, heroStats, partsForRows, vNow,
  type FilterKey, type GroupAnswerKind, type ObligationRow, type ViewerContext,
} from "@/lib/dpdp-onepage/view-model"

// WO-DPDP-010 §3 "THE ONE PAGE, FOR EVERY ROLE": composes Hero (Seal + Do
// this now + stat cards) + Parts track + Filter chips + The table, exactly
// as the spec lays them out. Owner/coordinator/GO/CA-only sections (policy,
// email preview, report, history) are separate, not yet built -- this is
// the shared skeleton every role's page will extend.
//
// WO-DPDP-011 port: `router.refresh()` (a Next.js server re-render) became
// the `refetch` prop -- the page owns the Supabase fetch and re-runs it
// after a successful mutation, so the visible row updates from the real,
// re-read DB state rather than from an optimistic guess.
export function OnePageView({
  orgName, rows, viewer, refetch, onMarkYes, onAnswerGroup, jobActions,
}: {
  orgName: string
  rows: ObligationRow[]
  viewer: ViewerContext
  refetch: () => Promise<void>
  onMarkYes?: (obligationId: string) => Promise<void>
  onAnswerGroup?: (obligationId: string, answer: GroupAnswerKind) => Promise<void>
  /** Add a note / give to someone / change the date / doesn't apply. Each may throw the database's plain-English refusal; the page is re-read after a success. */
  jobActions?: JobActionHandlers
}) {
  const [filter, setFilter] = useState<FilterKey>("all")
  const [pending, startTransition] = useTransition()
  const [actionError, setActionError] = useState<string | null>(null)
  const now = new Date()

  const staffView = viewer.kind === "staff" || viewer.kind === "parent"
  // Real bug found while building the group-answer flow: `r.isGroup` alone
  // showed EVERY group job (e.g. "All teachers") to EVERY staff member,
  // including ones who aren't in that group -- viewerIsGroupMember (set
  // server-side in getOnePageData, the only place that can know real group
  // membership) is the actual gate.
  const visibleRows = staffView ? rows.filter((r) => r.by === viewer.me || (r.isGroup && r.viewerIsGroupMember)) : rows
  const stats = heroStats(visibleRows)
  const now_ = vNow(visibleRows, viewer, now)
  const counts = filterCounts(visibleRows, viewer, now)
  const filtered = applyFilter(visibleRows, filter, viewer, now)
  const parts = staffView ? [] : partsForRows(visibleRows)

  // The RPC's plain-English failure ("Waiting — the step before this one
  // isn't done yet", "Job not found", ...) is shown inline, never alert()ed;
  // refetch runs only after success so a failed write can't repaint the row.
  function runThenRefetch(action: () => Promise<void>) {
    startTransition(async () => {
      setActionError(null)
      try {
        await action()
        await refetch()
      } catch (e) {
        setActionError(e instanceof Error ? e.message : String(e))
      }
    })
  }

  // The sentence a job control leaves behind ("Note saved."), cleared by the next one or after a while.
  const [saved, setSaved] = useState<string | null>(null)
  useEffect(() => {
    if (!saved) return
    const t = window.setTimeout(() => setSaved(null), 12_000)
    return () => window.clearTimeout(t)
  }, [saved])

  // The four job controls keep their own errors (the form that asked shows the refusal and stays open), so unlike Mark Yes they do not go through
  // runThenRefetch: they run, re-read the page, and let a failure reach the form.
  const withRefetch = <A extends unknown[]>(fn?: (...a: A) => Promise<void>) => fn && (async (...a: A) => { await fn(...a); await refetch() })
  const actions: JobActionHandlers | undefined = jobActions && {
    onNote: withRefetch(jobActions.onNote),
    onAssign: withRefetch(jobActions.onAssign),
    onSetDue: withRefetch(jobActions.onSetDue),
    onNotApplicable: withRefetch(jobActions.onNotApplicable),
    onSaved: setSaved,
  }

  function handleMarkYes(id: string) {
    if (!onMarkYes) return
    runThenRefetch(() => onMarkYes(id))
  }

  function handleAnswerGroup(id: string, answer: GroupAnswerKind) {
    if (!onAnswerGroup) return
    runThenRefetch(() => onAnswerGroup(id, answer))
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

        {actionError && (
          <div role="alert" className="mb-2.5 rounded-xl px-3.5 py-2.5" style={{ background: "var(--dpdp-rL)", color: "var(--dpdp-r)", fontSize: 13, fontWeight: 600 }}>
            {actionError}
          </div>
        )}

        {/* What was just done, in words, kept on screen while the person works down a long list. A staff member has no History on their page, so this is
            their only confirmation; the region exists before it has words (a live region announces a change, not an insertion) and a row that a filter then
            hides cannot take its message with it. */}
        <div role="status" aria-live="polite" className="sticky top-2 z-20">
          {saved && <div className="rounded-xl px-3.5 py-2.5 mb-2.5" style={{ background: "var(--dpdp-gL)", color: "#0B5F26", fontSize: 13.5, fontWeight: 700, boxShadow: "0 2px 10px rgba(20,30,60,.12)" }}>✓ {saved}</div>}
        </div>

        <div style={pending ? { opacity: 0.6, pointerEvents: "none" } : undefined}>
          <JobsTable rows={filtered} allRows={visibleRows} partSummaries={parts} viewer={viewer} staffView={staffView} now={now} onMarkYes={onMarkYes ? handleMarkYes : undefined} onAnswerGroup={onAnswerGroup ? handleAnswerGroup : undefined} actions={actions} />
        </div>

        <div className="text-center mt-7" style={{ fontSize: 12, color: "var(--dpdp-ink3)" }}>
          VERIDIAN · VERy INDIAN — Your DPDP proof, not just your DPDP policy. · Stored in India · no passwords · we never keep your documents
        </div>
      </div>
    </div>
  )
}
