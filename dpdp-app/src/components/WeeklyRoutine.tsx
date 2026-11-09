import "./onepage/dpdp-onepage-tokens.css"
import { useEffect, useState } from "react"
import { fetchHistory, fetchWeeklyRuns, logWeeklyRun } from "@/lib/api"
import type { DpdpClient } from "@/lib/client"
import type { ObligationRow } from "@/lib/dpdp-onepage/view-model"
import { cadence, checkCounts, checkedKey, dayLine, DOER_LABEL, runsToEntries, STAGES, stageLog, type HistoryLike, type RoutineStage } from "@/lib/weekly-routine"

// The weekly routine, at the top of the signed-in page: Discover, Act, Confirm, every week. Each stage lists its numbered steps (who does it, what the
// result looks like), then its latest log line, so a non-technical person sees in one glance what ran, when and how it ended. The rhythm strip shows the
// last run, the next run and any missed weeks. Everything shown is read from the organisation's own History and jobs (src/lib/weekly-routine.ts);
// a stage with no entry says so plainly. The sign-off on Confirm is kept on this device until the server learns a weekly-sign-off record.
const card = { background: "var(--dpdp-card)", borderColor: "var(--dpdp-line)" } as const
const when = (d: Date) => `${dayLine(d)}, ${d.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", timeZone: "UTC" })} UTC`

export function WeeklyRoutine({ client, orgId, rows, offline }: { client: DpdpClient; orgId: string; rows: ObligationRow[]; offline: boolean }) {
  const [entries, setEntries] = useState<HistoryLike[] | null>(null)
  const [failed, setFailed] = useState(false)
  const [signedAt, setSignedAt] = useState<string | null>(() => {
    try { return window.localStorage.getItem(checkedKey(orgId, new Date())) } catch { return null }
  })
  const now = new Date()

  // Two sources, merged: the weekly record (the server's own run log, once the database has it) and History (always there). If the weekly record
  // is not available the call simply fails and the screen shows History alone, exactly as before -- no error is shown for that.
  const [recorded, setRecorded] = useState(false)
  useEffect(() => {
    let live = true
    Promise.allSettled([fetchHistory(client, orgId, 50), fetchWeeklyRuns(client, orgId, 4)]).then(([h, w]) => {
      if (!live) return
      const hist: HistoryLike[] = h.status === "fulfilled" ? h.value.map((x) => ({ kind: x.kind, summary: x.summary, actorLabel: x.actorLabel, occurredAt: x.occurredAt })) : []
      const runs: HistoryLike[] = w.status === "fulfilled" ? runsToEntries(w.value) : []
      setRecorded(w.status === "fulfilled")
      if (h.status === "rejected" && w.status === "rejected") setFailed(true)
      setEntries([...hist, ...runs])
    })
    return () => { live = false }
  }, [client, orgId, rows])

  async function signOff() {
    const stamp = new Date().toISOString()
    // Server first (it also writes History); if the database does not have the weekly record yet, keep it on this device.
    try { await logWeeklyRun(client, orgId, "confirm") } catch { /* not available yet: the device copy below is the record */ }
    try { window.localStorage.setItem(checkedKey(orgId, new Date()), stamp) } catch { /* private window: it shows for this visit only */ }
    setSignedAt(stamp)
  }

  const list = entries ?? []
  const rhythm = cadence(list, now)
  const counts = checkCounts(rows, now)

  return (
    <div className="dpdp-onepage" id="weekly-routine" data-testid="weekly-routine">
      <div className="max-w-[1240px] mx-auto px-5 pt-4">
        <section className="rounded-[22px] border p-6" style={card} aria-labelledby="weekly-h">
          <h2 id="weekly-h" style={{ fontFamily: "Sora, sans-serif", fontSize: 22, fontWeight: 700, margin: "0 0 4px", color: "var(--dpdp-ink)" }}>Your weekly routine</h2>
          <p style={{ fontSize: 14, color: "var(--dpdp-ink2)", margin: "0 0 14px", maxWidth: "74ch" }}>
            Three small stages, once a week: Discover, Act, Confirm. Most of it is done for you by the automatic helper; where a person is needed, it says so.
          </p>

          <div role="group" aria-label="Weekly rhythm" className="rounded-2xl border p-4 mb-5" style={{ borderColor: "var(--dpdp-line)", background: "rgba(0,0,0,0.02)" }}>
            <div className="flex gap-x-8 gap-y-2 flex-wrap" style={{ fontSize: 14, color: "var(--dpdp-ink)" }}>
              <span>Last run: <b>{entries === null ? "Loading…" : rhythm.lastRun ? when(rhythm.lastRun) : "Nothing recorded yet"}</b></span>
              <span>Next run: <b>{dayLine(rhythm.nextRun)}</b></span>
              <span>Missed weeks (of the last 3 finished): <b>{entries === null ? "…" : rhythm.missed}</b></span>
            </div>
            <ol aria-label="The last four weeks" className="flex gap-2 mt-3 flex-wrap" style={{ listStyle: "none", padding: 0, margin: 0 }}>
              {rhythm.weeks.map((w) => (
                <li key={w.start.toISOString()} style={{ fontSize: 12.5, padding: "4px 10px", borderRadius: 999, border: "1px solid var(--dpdp-line)", background: w.ran ? "var(--dpdp-vL)" : "#fff", color: w.ran ? "var(--dpdp-v)" : "var(--dpdp-ink3)", fontWeight: 600 }}>
                  {dayLine(w.start).replace(/^\w+ /, "Week of ")}: {w.ran ? "✓ run" : w.current ? "not yet this week" : "missed"}
                </li>
              ))}
            </ol>
            {failed && <p role="status" style={{ fontSize: 12.5, color: "var(--dpdp-ink3)", margin: "8px 0 0" }}>We could not read your History just now, so the lines below may look empty. Try again in a moment.</p>}
            {recorded && <p style={{ fontSize: 12.5, color: "var(--dpdp-ink3)", margin: "8px 0 0" }}>These lines come from your weekly record and History.</p>}
            {offline && <p style={{ fontSize: 12.5, color: "var(--dpdp-ink3)", margin: "8px 0 0" }}>You are offline, so these lines show what was last saved on this device.</p>}
          </div>

          <div className="grid gap-4" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(300px, 1fr))" }}>
            {STAGES.map((s, i) => <Stage key={s.id} stage={s} index={i + 1} entries={list} loaded={entries !== null} now={now} counts={s.id === "check" ? counts : null} signedAt={signedAt} onSignOff={signOff} />)}
          </div>
        </section>
      </div>
    </div>
  )
}

function Stage({ stage, index, entries, loaded, now, counts, signedAt, onSignOff }: {
  stage: RoutineStage; index: number; entries: HistoryLike[]; loaded: boolean; now: Date
  counts: ReturnType<typeof checkCounts> | null; signedAt: string | null; onSignOff: () => void | Promise<void>
}) {
  const log = stageLog(stage.id, entries, now)
  const checked = stage.id === "check" && signedAt !== null
  return (
    <article className="rounded-2xl border p-4" style={{ borderColor: "var(--dpdp-line)", background: "#fff" }} aria-labelledby={`stage-${stage.id}`} data-stage={stage.id}>
      <h3 id={`stage-${stage.id}`} style={{ fontFamily: "Sora, sans-serif", fontSize: 18, fontWeight: 700, margin: 0, color: "var(--dpdp-ink)" }}>Stage {index} · {stage.name}</h3>
      <p style={{ fontSize: 13.5, color: "var(--dpdp-ink2)", margin: "4px 0 10px" }}>{stage.promise}</p>
      <ol style={{ listStyle: "none", padding: 0, margin: 0 }}>
        {stage.steps.map((st) => (
          <li key={st.n} className="mb-3" style={{ fontSize: 13.5, color: "var(--dpdp-ink)" }}>
            <b>Step {st.n}.</b> {st.what}
            <div style={{ fontSize: 12.5, color: "var(--dpdp-ink3)" }}><b>Who:</b> {DOER_LABEL[st.doer]} · <b>You will see:</b> {st.result}</div>
          </li>
        ))}
      </ol>

      {counts && (
        <p data-testid="check-counts" style={{ fontSize: 14, margin: "0 0 8px", color: "var(--dpdp-ink)" }}>
          This week: <b>{counts.done}</b> done · <b>{counts.open}</b> still open · <b>{counts.late}</b> late
        </p>
      )}
      {stage.id === "check" && (
        checked
          ? <p role="status" style={{ fontSize: 13.5, fontWeight: 600, color: "var(--dpdp-g, #0B5F26)", margin: "0 0 8px" }}>✓ This week is checked ({when(new Date(signedAt))})</p>
          : <button type="button" onClick={() => void onSignOff()} className="font-bold text-white rounded-lg mb-2" style={{ background: "var(--dpdp-v)", fontSize: 14, padding: "10px 16px" }}>This week is checked</button>
      )}

      <div role="group" aria-label={`Latest log, ${stage.name}`} style={{ fontSize: 13, borderTop: "1px solid var(--dpdp-line)", paddingTop: 8, color: "var(--dpdp-ink2)" }}>
        <b>Latest log:</b>{" "}
        {!loaded ? "Loading…" : log.lastAt
          ? <>{log.lastWhat} — {log.lastWho}, {when(log.lastAt)}. {log.thisWeek ? `Done ${log.countThisWeek === 1 ? "once" : `${log.countThisWeek} times`} this week.` : "Not yet this week."}</>
          : "Nothing recorded yet. It will appear here the first time it runs."}
        {stage.id === "check" && (
          <div>Last update: {signedAt ? `checked on ${when(new Date(signedAt))} (saved on this device)` : "not checked yet this week"}.</div>
        )}
      </div>
    </article>
  )
}
