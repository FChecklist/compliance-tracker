import { useState } from "react"
import { JobActionsPanel } from "./JobActions"
import { GroupAnswerButtons } from "./JobsTable"
import { offeredActions, type JobActionHandlers, type JobActionKind } from "@/lib/dpdp-onepage/job-actions"
import { blocked, daysLate, dueStatus, live, mineFor, yesFor, type GroupAnswerKind, type ObligationRow, type ViewerContext } from "@/lib/dpdp-onepage/view-model"

// "What you have to do": the first thing every person sees. Only the jobs
// that are theirs, in plain words, the soonest date first, one big button per
// job. The full list (every job, every person) stays one tap away.

const big = { fontSize: 14.5, padding: "11px 18px", borderRadius: 12, fontWeight: 700 } as const

function dueWords(row: ObligationRow, now: Date): { text: string; color: string } {
  const status = dueStatus(row, now)
  const date = row.due.toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" })
  if (status === "late") return { text: `Was due ${date} · ${daysLate(row, now)} days late`, color: "var(--dpdp-r)" }
  if (status === "soon") return { text: `Due ${date} · coming up soon`, color: "#8A5A00" }
  return { text: `Due ${date}`, color: "var(--dpdp-ink2)" }
}

function JobCard({
  row, allRows, viewer, now, onMarkYes, onAnswerGroup, actions,
}: {
  row: ObligationRow; allRows: ObligationRow[]; viewer: ViewerContext; now: Date
  onMarkYes?: (id: string) => void; onAnswerGroup?: (id: string, a: GroupAnswerKind) => void; actions?: JobActionHandlers
}) {
  const [panel, setPanel] = useState<JobActionKind | null>(null)
  const [busy, setBusy] = useState(false)
  const offered = actions ? offeredActions(row, viewer, actions) : []
  const waiting = blocked(row, allRows)
  const due = dueWords(row, now)
  const openPanel = (k: JobActionKind) => setPanel((p) => (p === k ? null : k))
  return (
    <li className="rounded-2xl border p-4 list-none" style={{ background: "var(--dpdp-card)", borderColor: dueStatus(row, now) === "late" ? "var(--dpdp-r)" : "var(--dpdp-line)" }} data-job-card={row.id}>
      <div style={{ fontFamily: "Sora, sans-serif", fontSize: 16.5, fontWeight: 700, color: "var(--dpdp-ink)", lineHeight: 1.3 }}>{row.what}</div>
      <div className="mt-1" style={{ fontSize: 13.5, fontWeight: 600, color: due.color }}>{due.text}</div>
      {row.dataSet && <div style={{ fontSize: 12.5, color: "var(--dpdp-ink3)", marginTop: 2 }}>About: {row.dataSet}</div>}
      <div className="flex gap-2.5 flex-wrap items-start mt-3">
        {waiting ? (
          <span className="rounded-xl" style={{ ...big, background: "var(--dpdp-cL)", color: "var(--dpdp-c)" }}>Waiting for the step before this one</span>
        ) : row.isGroup && onAnswerGroup ? (
          <GroupAnswerButtons row={row} onAnswerGroup={onAnswerGroup} />
        ) : onMarkYes ? (
          <button type="button" onClick={() => onMarkYes(row.id)} className="text-white" style={{ ...big, background: "var(--dpdp-g)" }}>✓ Mark done</button>
        ) : null}
        {offered.includes("note") && (
          <button type="button" aria-expanded={panel === "note"} onClick={() => openPanel("note")} disabled={busy} style={{ ...big, background: "#fff", color: "var(--dpdp-v)", border: "1.4px solid var(--dpdp-v)" }}>✎ Add a note</button>
        )}
        {offered.includes("assign") && (
          <button type="button" aria-expanded={panel === "assign"} onClick={() => openPanel("assign")} disabled={busy} style={{ ...big, background: "#fff", color: "var(--dpdp-ink2)", border: "1.4px solid var(--dpdp-line)" }}>🙋 Ask for help</button>
        )}
        {offered.length > 0 && (
          <button type="button" aria-expanded={panel === "due"} onClick={() => openPanel("due")} disabled={busy} style={{ ...big, background: "transparent", color: "var(--dpdp-ink3)", textDecoration: "underline", fontWeight: 600 }}>Edit this job</button>
        )}
      </div>
      {panel && actions && offered.length > 0 && (
        <div className="mt-3">
          <JobActionsPanel
            row={row} viewer={viewer} handlers={actions} allRows={allRows} now={now} initial={panel} onBusy={setBusy}
            onDone={(message) => { setPanel(null); actions.onSaved?.(message) }}
          />
        </div>
      )}
    </li>
  )
}

export function MyJobs({
  rows, allRows, viewer, now, onMarkYes, onAnswerGroup, actions, onShowAll,
}: {
  rows: ObligationRow[]; allRows: ObligationRow[]; viewer: ViewerContext; now: Date
  onMarkYes?: (id: string) => void; onAnswerGroup?: (id: string, a: GroupAnswerKind) => void; actions?: JobActionHandlers
  onShowAll: () => void
}) {
  const mine = mineFor(live(rows), viewer)
  const todo = mine.filter((r) => !yesFor(r, viewer)).sort((a, b) => a.due.getTime() - b.due.getTime())
  const finished = mine.length - todo.length
  return (
    <section aria-labelledby="my-jobs-h" className="mb-4">
      <div className="flex justify-between items-end gap-3 flex-wrap mb-3">
        <h2 id="my-jobs-h" style={{ fontFamily: "Sora, sans-serif", fontSize: 24, fontWeight: 700, margin: 0, color: "var(--dpdp-ink)" }}>What you have to do</h2>
        <span style={{ fontSize: 13.5, color: "var(--dpdp-ink2)" }}>{todo.length} to do · {finished} finished</span>
      </div>
      {todo.length === 0 ? (
        <div className="rounded-2xl border p-6 text-center" style={{ background: "var(--dpdp-gL)", borderColor: "var(--dpdp-line)", color: "#0B5F26", fontWeight: 700 }}>
          Nothing is waiting on you right now. Every job that is yours is done — well done.
        </div>
      ) : (
        <ul className="flex flex-col gap-3 p-0 m-0">
          {todo.map((r) => (
            <JobCard key={r.id} row={r} allRows={allRows} viewer={viewer} now={now} onMarkYes={onMarkYes} onAnswerGroup={onAnswerGroup} actions={actions} />
          ))}
        </ul>
      )}
      <div className="mt-3">
        <button type="button" onClick={onShowAll} style={{ background: "transparent", color: "var(--dpdp-v)", fontSize: 14, fontWeight: 700, textDecoration: "underline", padding: "6px 2px" }}>
          See the full list of every job →
        </button>
      </div>
    </section>
  )
}
