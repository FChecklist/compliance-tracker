import { useState, type CSSProperties, type FormEvent } from "react"
import type { ObligationRow, ViewerContext } from "@/lib/dpdp-onepage/view-model"
import {
  ACTION_LABEL, NOTE_MAX, checkDue, checkEmail, checkNote, checkReason, dayOf, dueBounds, offeredActions, requiredTodayWarning, type JobActionHandlers, type JobActionKind,
} from "@/lib/dpdp-onepage/job-actions"

// The four things a person can do to one job besides saying Yes: add a note, give it to someone, change its date, say it doesn't apply.
// (owner, 2026-09-30). The database decides who may (drizzle/0605 + 0666); this only offers what it will accept, checks in plain words before
// it asks, and shows the database's own plain-English refusal inline, in the panel, without closing it. Nothing here writes on its own: each
// form ends in an explicit button, and the parent re-reads the page after a success so the row shows the real, stored result.

const label: CSSProperties = { display: "block", fontSize: 12.5, fontWeight: 600, color: "var(--dpdp-ink2)", marginBottom: 4 }
const field: CSSProperties = { width: "100%", border: "1.4px solid var(--dpdp-line)", borderRadius: 10, padding: "8px 10px", fontSize: 13.5, fontFamily: "inherit", color: "var(--dpdp-ink)", background: "#fff" }
const help: CSSProperties = { fontSize: 12, color: "var(--dpdp-ink3)", marginTop: 4 }

/** The small "More" button in a row's last cell. */
export function MoreButton({ open, count, onClick, rowId }: { open: boolean; count: number; onClick: () => void; rowId: string }) {
  if (count === 0) return null
  return (
    <button
      type="button" onClick={onClick} aria-expanded={open} aria-controls={`job-actions-${rowId}`}
      className="rounded-lg font-semibold whitespace-nowrap"
      style={{ fontSize: 11.5, padding: "5px 10px", background: open ? "var(--dpdp-vL)" : "#fff", color: "var(--dpdp-v)", border: "1.4px solid var(--dpdp-line)" }}
    >
      {open ? "Close" : "More ▾"}
    </button>
  )
}

/** The panel under a row: a tab per available action, then that action's form. */
export function JobActionsPanel({
  row, viewer, handlers, now, onDone,
}: { row: ObligationRow; viewer: ViewerContext; handlers: JobActionHandlers; now: Date; onDone: (saved: string) => void }) {
  const kinds = offeredActions(row, viewer, handlers)
  const [kind, setKind] = useState<JobActionKind>(kinds[0] ?? "note")
  if (kinds.length === 0) return null
  const active = kinds.includes(kind) ? kind : kinds[0]

  return (
    <div id={`job-actions-${row.id}`} className="rounded-2xl border p-4" style={{ background: "#FBFBFE", borderColor: "var(--dpdp-line)" }}>
      <div role="tablist" aria-label="What would you like to do with this job?" className="flex gap-1.5 flex-wrap mb-3">
        {kinds.map((k) => (
          <button
            key={k} type="button" role="tab" aria-selected={k === active} onClick={() => setKind(k)}
            className="rounded-lg font-semibold"
            style={{ fontSize: 12.5, padding: "6px 12px", background: k === active ? "var(--dpdp-v)" : "#fff", color: k === active ? "#fff" : "var(--dpdp-ink2)", border: `1.4px solid ${k === active ? "var(--dpdp-v)" : "var(--dpdp-line)"}` }}
          >
            {ACTION_LABEL[k]}
          </button>
        ))}
      </div>
      {active === "note" && handlers.onNote && <NoteForm row={row} onSubmit={handlers.onNote} onDone={onDone} />}
      {active === "assign" && handlers.onAssign && <AssignForm row={row} onSubmit={handlers.onAssign} onDone={onDone} />}
      {active === "due" && handlers.onSetDue && <DueForm row={row} now={now} onSubmit={handlers.onSetDue} onDone={onDone} />}
      {active === "na" && handlers.onNotApplicable && <NotApplicableForm row={row} owner={viewer.kind === "owner"} onSubmit={handlers.onNotApplicable} onDone={onDone} />}
    </div>
  )
}

/** Runs one submit: plain-English checks first, then the call; a refusal from the database stays on the form. `saved` is the sentence shown on the row afterwards. */
function useSubmit(check: () => { ok: true; value: string } | { ok: false; message: string }, run: (value: string) => Promise<void>, onDone: (saved: string) => void, saved: (value: string) => string) {
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  async function submit(e: FormEvent) {
    e.preventDefault()
    if (busy) return
    setError(null)
    const c = check()
    if (!c.ok) { setError(c.message); return }
    setBusy(true)
    try {
      await run(c.value)
      onDone(saved(c.value))
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
      setBusy(false)
    }
  }
  return { error, busy, submit }
}

function Actions({ busy, doing, done, error, tone }: { busy: boolean; doing: string; done: string; error: string | null; tone?: "danger" }) {
  return (
    <>
      {error && <div role="alert" className="rounded-xl px-3 py-2 mt-3" style={{ background: "var(--dpdp-rL)", color: "var(--dpdp-r)", fontSize: 13, fontWeight: 600 }}>{error}</div>}
      <div className="mt-3">
        <button
          type="submit" disabled={busy} className="font-bold text-white"
          style={{ background: tone === "danger" ? "var(--dpdp-r)" : "var(--dpdp-v)", fontSize: 13.5, padding: "9px 16px", borderRadius: 10, opacity: busy ? 0.6 : 1 }}
        >
          {busy ? doing : done}
        </button>
      </div>
    </>
  )
}

function NoteForm({ row, onSubmit, onDone }: { row: ObligationRow; onSubmit: (id: string, text: string) => Promise<void>; onDone: (saved: string) => void }) {
  const [text, setText] = useState("")
  const { error, busy, submit } = useSubmit(() => checkNote(text), (v) => onSubmit(row.id, v), onDone, () => "Note saved.")
  return (
    <form onSubmit={submit} noValidate>
      <label htmlFor={`note-${row.id}`} style={label}>Your note</label>
      <textarea id={`note-${row.id}`} value={text} onChange={(e) => setText(e.target.value)} disabled={busy} rows={3} maxLength={NOTE_MAX + 200} placeholder="e.g. The signed agreement is with the CA; we chase again on Friday." style={{ ...field, resize: "vertical" }} />
      <div style={help}>
        {text.trim().length} of {NOTE_MAX}. It goes into the History, where the owner and the people who look after the whole list can read it. It can&rsquo;t be edited or removed afterwards, so leave out passwords, ID numbers and other people&rsquo;s private details.
      </div>
      <Actions busy={busy} doing="Saving…" done="Save note" error={error} />
    </form>
  )
}

function AssignForm({ row, onSubmit, onDone }: { row: ObligationRow; onSubmit: (id: string, email: string) => Promise<void>; onDone: (saved: string) => void }) {
  const [email, setEmail] = useState("")
  const { error, busy, submit } = useSubmit(() => checkEmail(email), (v) => onSubmit(row.id, v), onDone, (v) => `Job given to ${v}.`)
  return (
    <form onSubmit={submit} noValidate>
      <label htmlFor={`assign-${row.id}`} style={label}>Their email address</label>
      <input id={`assign-${row.id}`} type="email" autoComplete="off" value={email} onChange={(e) => setEmail(e.target.value)} disabled={busy} placeholder="name@company.com" style={field} />
      <div style={help}>
        {row.by ? <>It is with <b>{row.by}</b> now. </> : <>Nobody has it yet. </>}
        The person you name can sign in with this address and sees the job; it appears in their Monday email.
      </div>
      <Actions busy={busy} doing="Giving…" done="Give this job" error={error} />
    </form>
  )
}

function DueForm({ row, now, onSubmit, onDone }: { row: ObligationRow; now: Date; onSubmit: (id: string, dueOn: string) => Promise<void>; onDone: (saved: string) => void }) {
  const [value, setValue] = useState(dayOf(row.due))
  const { min, max } = dueBounds(now)
  const { error, busy, submit } = useSubmit(() => checkDue(value, now), (v) => onSubmit(row.id, v), onDone, (v) => `Date changed to ${new Date(`${v}T00:00:00Z`).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric", timeZone: "UTC" })}.`)
  return (
    <form onSubmit={submit} noValidate>
      <label htmlFor={`due-${row.id}`} style={label}>New due date</label>
      <input id={`due-${row.id}`} type="date" value={value} min={min} max={max} onChange={(e) => setValue(e.target.value)} disabled={busy} style={{ ...field, width: "auto" }} />
      <div style={help}>
        It is due {row.due.toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" })} now. A new date changes when the job counts as late in your list and in the weekly emails; it doesn&rsquo;t change what the law asks of you.
      </div>
      <Actions busy={busy} doing="Saving…" done="Change the date" error={error} />
    </form>
  )
}

function NotApplicableForm({ row, owner, onSubmit, onDone }: { row: ObligationRow; owner: boolean; onSubmit: (id: string, reason: string) => Promise<void>; onDone: (saved: string) => void }) {
  const [reason, setReason] = useState("")
  const [sure, setSure] = useState(false)
  const warning = requiredTodayWarning(row)
  const { error, busy, submit } = useSubmit(
    () => (sure ? checkReason(reason) : { ok: false as const, message: "Tick the box to confirm that this job really doesn't apply." }),
    (v) => onSubmit(row.id, v),
    onDone,
    () => "Marked as not applicable.",
  )
  return (
    <form onSubmit={submit} noValidate>
      {warning && <div className="rounded-xl px-3 py-2 mb-3" style={{ background: "var(--dpdp-aL)", color: "#8A5A00", fontSize: 13, fontWeight: 600 }}>{warning}</div>}
      <label htmlFor={`na-${row.id}`} style={label}>Why doesn&rsquo;t this apply{owner ? " to your organisation" : " to you"}?</label>
      <textarea id={`na-${row.id}`} value={reason} onChange={(e) => setReason(e.target.value)} disabled={busy} rows={3} maxLength={NOTE_MAX + 200} placeholder="e.g. We have no cameras at any of our premises." style={{ ...field, resize: "vertical" }} />
      <label className="inline-flex gap-1.5 items-start cursor-pointer mt-2.5" style={{ fontSize: 13, color: "var(--dpdp-ink)" }}>
        <input type="checkbox" checked={sure} onChange={(e) => setSure(e.target.checked)} disabled={busy} style={{ marginTop: 3 }} />
        <span>This job really doesn&rsquo;t apply. I understand it is recorded in the History with my name and this reason, and can&rsquo;t be undone from this page.</span>
      </label>
      <Actions busy={busy} doing="Saving…" done="It doesn't apply" error={error} tone="danger" />
    </form>
  )
}
