import { LAWS, PARTS, SENSITIVE_DATA_TYPES, avatarColor, avatarInitial, blocked, daysLate, dueStatus, isToday, type GroupAnswerKind, type ObligationRow, type PartSummary, type ViewerContext } from "@/lib/dpdp-onepage/view-model"

const GROUP_ANSWER_LABEL: Record<GroupAnswerKind, string> = {
  done: "Done",
  never_had_any: "Doesn't apply to me",
  cannot: "I can't",
}

function Avatar({ email, small }: { email: string; small?: boolean }) {
  const size = small ? 20 : 26
  return (
    <span className="inline-flex items-center gap-2 max-w-full align-middle">
      <span
        className="rounded-full text-white font-bold grid place-items-center flex-none"
        style={{ width: size, height: size, fontSize: small ? 9.5 : 11, fontFamily: "Sora, sans-serif", background: avatarColor(email) }}
      >
        {avatarInitial(email)}
      </span>
      <span className="overflow-hidden text-ellipsis whitespace-nowrap" style={{ fontSize: 12.5, color: "var(--dpdp-ink2)" }}>{email}</span>
    </span>
  )
}

// Port of veridian-dpdp.html's lawCell() -- groups codes by law, sorts
// s/a/d/g, shows "⚡ required today" under any row today's law requires.
function LawCell({ codes }: { codes: string[] | null }) {
  if (!codes?.length) return <span style={{ color: "var(--dpdp-ink3)" }}>—</span>
  const groups: Record<string, string[]> = {}
  const order: string[] = []
  for (const c of codes) {
    const [k, ref] = [c.split(":")[0], c.slice(2)]
    if (!groups[k]) { groups[k] = []; order.push(k) }
    if (ref) groups[k].push(ref)
  }
  order.sort((a, b) => "asdg".indexOf(a) - "asdg".indexOf(b))
  const bg = { d: "var(--dpdp-vL)", s: "var(--dpdp-gL)", g: "var(--dpdp-line2)" } as const
  const fg = { d: "#2F339A", s: "#0F6B2B", g: "var(--dpdp-ink3)" } as const
  return (
    <>
      {order.map((k) => (
        <span key={k} title={LAWS[k]?.title} className="inline-block rounded-[7px] mr-1 mb-0.5 cursor-help" style={{ fontSize: 11, fontWeight: 600, padding: "2px 8px", background: bg[k as "d"], color: fg[k as "d"] }}>
          {LAWS[k]?.label ?? k}{groups[k].length ? ` ${groups[k].join(" · ")}` : ""}
        </span>
      ))}
      {isToday(codes) && <span className="block mt-[3px]" style={{ fontSize: 11, fontWeight: 600, color: "#0F6B2B" }}>⚡ required today</span>}
    </>
  )
}

function DataTypeCell({ types }: { types: string[] | null }) {
  if (!types?.length) return <span style={{ color: "var(--dpdp-ink3)" }}>—</span>
  return (
    <>
      {types.map((t) => {
        const sens = SENSITIVE_DATA_TYPES.has(t)
        return (
          <span key={t} className="inline-block rounded-[7px] mr-1 mb-0.5" style={{ fontSize: 11, fontWeight: sens ? 600 : 500, padding: "2px 8px", background: sens ? "var(--dpdp-rL)" : "var(--dpdp-line2)", color: sens ? "#9E2620" : "var(--dpdp-ink2)" }}>
            {t}
          </span>
        )
      })}
    </>
  )
}

function DueCell({ row, now }: { row: ObligationRow; now: Date }) {
  const status = dueStatus(row, now)
  const color = row.yes || row.na ? "var(--dpdp-ink2)" : status === "late" ? "var(--dpdp-r)" : status === "soon" ? "var(--dpdp-a)" : "var(--dpdp-ink2)"
  return (
    <span>
      <span style={{ fontFamily: "Sora, sans-serif", fontSize: 12.5, fontWeight: 600, color, whiteSpace: "nowrap" }}>
        {row.due.toLocaleDateString("en-IN", { day: "2-digit", month: "short" })}
      </span>
      {!row.yes && status === "late" && (
        <span className="ml-1 rounded-[20px]" style={{ fontSize: 11, fontWeight: 600, padding: "2px 8px", background: "var(--dpdp-rL)", color: "var(--dpdp-r)" }}>
          {daysLate(row, now)} days late
        </span>
      )}
    </span>
  )
}

function GroupAnswerButtons({ row, onAnswerGroup }: { row: ObligationRow; onAnswerGroup: (obligationId: string, answer: GroupAnswerKind) => void }) {
  return (
    <div className="flex flex-col gap-1 items-start">
      <div className="flex gap-1 flex-wrap">
        {(["done", "never_had_any", "cannot"] as const).map((k) => (
          <button
            key={k}
            type="button"
            onClick={() => onAnswerGroup(row.id, k)}
            className="rounded-lg font-semibold"
            style={{
              fontSize: 11, padding: "4px 8px",
              background: row.myGroupAnswer === k ? "var(--dpdp-g)" : "#fff",
              color: row.myGroupAnswer === k ? "#fff" : "var(--dpdp-ink2)",
              border: `1.4px solid ${row.myGroupAnswer === k ? "var(--dpdp-g)" : "var(--dpdp-line)"}`,
            }}
          >
            {GROUP_ANSWER_LABEL[k]}
          </button>
        ))}
      </div>
      <span style={{ fontSize: 11, color: "var(--dpdp-ink3)" }}>{row.groupDone ?? 0} of {row.groupTotal ?? 0} answered</span>
    </div>
  )
}

function StampOrAction({
  row, allRows, mine, onMarkYes, onAnswerGroup,
}: { row: ObligationRow; allRows: ObligationRow[]; mine: boolean; onMarkYes?: (id: string) => void; onAnswerGroup?: (obligationId: string, answer: GroupAnswerKind) => void }) {
  if (row.na) return <span className="inline-block rounded-lg" style={{ fontSize: 12, fontWeight: 700, padding: "3px 11px", background: "#EFEFF4", color: "var(--dpdp-ink3)" }}>Doesn't apply</span>
  if (row.yes && row.answer === "n") return <span style={{ fontSize: 12, fontWeight: 700, padding: "3px 11px", background: "var(--dpdp-rL)", color: "var(--dpdp-r)", borderRadius: 8, display: "inline-block" }}>No</span>
  if (row.yes) {
    return (
      <span className="inline-block rounded-lg" style={{ padding: "3px 11px", fontSize: 12, fontWeight: 700, color: "var(--dpdp-g)", border: "1.6px solid var(--dpdp-g)", background: "#fff", transform: "rotate(-3deg)", letterSpacing: "0.03em" }}>
        YES
      </span>
    )
  }
  if (blocked(row, allRows)) {
    return <span style={{ fontSize: 12, fontWeight: 700, padding: "3px 11px", background: "var(--dpdp-cL)", color: "var(--dpdp-c)", borderRadius: 8, display: "inline-block" }}>Waiting</span>
  }
  if (row.isGroup && row.viewerIsGroupMember && onAnswerGroup) {
    return <GroupAnswerButtons row={row} onAnswerGroup={onAnswerGroup} />
  }
  if (mine && onMarkYes) {
    return (
      <button
        type="button" onClick={() => onMarkYes(row.id)}
        className="rounded-lg text-white font-semibold"
        style={{ background: "var(--dpdp-g)", fontSize: 11.5, padding: "5px 10px" }}
      >
        Mark Yes
      </button>
    )
  }
  return <span style={{ fontSize: 12, fontWeight: 700, padding: "3px 11px", background: "var(--dpdp-rL)", color: "var(--dpdp-r)", borderRadius: 8, display: "inline-block" }}>No</span>
}

export function JobsTable({
  rows, allRows, partSummaries, viewer, staffView, now = new Date(), onMarkYes, onAnswerGroup,
}: {
  rows: ObligationRow[] // the currently chip-filtered rows to render in the table body
  allRows: ObligationRow[] // the full, unfiltered set -- for blocked()/dependency lookups, which must see rows even when a filter hides them
  partSummaries: PartSummary[] // stable "X of Y done" counts per part, independent of the active filter chip (spec's own vTasks(): computed once from the full row set, not the filtered `shown` subset)
  viewer: ViewerContext
  staffView?: boolean // narrower table for staff/parents (WO §3: "Narrow table for staff and parents")
  now?: Date
  onMarkYes?: (id: string) => void
  onAnswerGroup?: (obligationId: string, answer: GroupAnswerKind) => void
}) {
  const byPart = new Map<number, ObligationRow[]>()
  for (const r of rows) {
    if (!byPart.has(r.part)) byPart.set(r.part, [])
    byPart.get(r.part)!.push(r)
  }
  const summaryByPart = new Map(partSummaries.map((p) => [p.n, p]))

  if (!rows.length) {
    return <div className="text-center py-6" style={{ color: "var(--dpdp-ink3)" }}>Nothing here.</div>
  }

  return (
    <div className="rounded-[22px] border overflow-auto" style={{ background: "var(--dpdp-card)", borderColor: "var(--dpdp-line)" }}>
      <table className="w-full border-collapse" style={{ minWidth: staffView ? 760 : 1320 }}>
        <thead>
          <tr>
            {["#", "Data set", "Data type", "What has to be done", "Law", "Person responsible", "Due date", "Done?", "Emails sent"].map((h) => (
              <th key={h} className="text-left whitespace-nowrap" style={{ background: "#F8F9FC", color: "var(--dpdp-ink3)", fontSize: 12, fontWeight: 600, padding: 12, borderBottom: "1px solid var(--dpdp-line)" }}>{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {PARTS.filter((p) => byPart.has(p.n)).map((p) => (
            <PartGroup key={p.n} part={p} rows={byPart.get(p.n)!} summary={summaryByPart.get(p.n)} viewer={viewer} allRows={allRows} now={now} staffView={staffView} onMarkYes={onMarkYes} onAnswerGroup={onAnswerGroup} />
          ))}
        </tbody>
      </table>
    </div>
  )
}

function PartGroup({
  part, rows, summary, viewer, allRows, now, staffView, onMarkYes, onAnswerGroup,
}: { part: { n: number; name: string; color: string }; rows: ObligationRow[]; summary?: PartSummary; viewer: ViewerContext; allRows: ObligationRow[]; now: Date; staffView?: boolean; onMarkYes?: (id: string) => void; onAnswerGroup?: (obligationId: string, answer: GroupAnswerKind) => void }) {
  // summary.done/all is the stable, na-excluding count from the FULL row
  // set (partsForRows), not derived from `rows` (which is whatever the
  // active filter chip happens to show) -- found live: with a chip other
  // than "All" active, or an area marked na, deriving from `rows` gave a
  // wrong/inconsistent count against PartsTrack's own ring for the same part.
  const done = summary?.done ?? rows.filter((r) => r.yes).length
  const total = summary?.all ?? rows.length
  let n = 0
  return (
    <>
      {!staffView && (
        <tr>
          <td colSpan={9} style={{ background: `color-mix(in srgb, ${part.color} 7%, #fff)`, color: part.color, fontFamily: "Sora, sans-serif", fontWeight: 700, fontSize: 13.5, padding: "10px 14px", borderLeft: `4px solid ${part.color}` }}>
            Part {part.n} · {part.name}
            <span className="ml-2.5" style={{ fontFamily: "inherit", fontWeight: 500, fontSize: 12, color: "var(--dpdp-ink3)" }}>{done} of {total} done</span>
          </td>
        </tr>
      )}
      {rows.map((row) => {
        n++
        const mine = row.by === viewer.me
        return (
          <tr key={row.id} style={row.yes ? { background: "#F7FBF8" } : !row.by && !row.na ? { background: "var(--dpdp-aL)" } : undefined}>
            <td className="text-center" style={{ color: "var(--dpdp-ink3)", fontFamily: "Sora, sans-serif", fontSize: 12, fontWeight: 600, width: 44, padding: 12, borderBottom: "1px solid var(--dpdp-line2)" }}>{n}</td>
            <td style={{ fontWeight: 600, minWidth: 118, color: "var(--dpdp-ink)", padding: 12, borderBottom: "1px solid var(--dpdp-line2)" }}>{row.dataSet ?? <span style={{ color: "var(--dpdp-ink3)" }}>—</span>}</td>
            <td style={{ minWidth: 170, maxWidth: 240, padding: 12, borderBottom: "1px solid var(--dpdp-line2)" }}><DataTypeCell types={row.dataTypes} /></td>
            <td style={{ fontWeight: 600, minWidth: 250, color: "var(--dpdp-ink)", padding: 12, borderBottom: "1px solid var(--dpdp-line2)", textDecoration: row.na ? "line-through" : undefined }}>{row.what}</td>
            <td style={{ minWidth: 150, padding: 12, borderBottom: "1px solid var(--dpdp-line2)" }}><LawCell codes={row.lawCodes} /></td>
            <td style={{ padding: 12, borderBottom: "1px solid var(--dpdp-line2)" }}>
              {row.na ? <span style={{ color: "var(--dpdp-ink3)" }}>—</span>
                : row.by ? <Avatar email={row.by} />
                : <span className="inline-block rounded-[20px]" style={{ fontSize: 11, fontWeight: 600, padding: "2px 8px", background: "var(--dpdp-aL)", color: "#8A5A00" }}>nobody</span>}
            </td>
            <td style={{ padding: 12, borderBottom: "1px solid var(--dpdp-line2)" }}><DueCell row={row} now={now} /></td>
            <td style={{ padding: 12, borderBottom: "1px solid var(--dpdp-line2)" }}><StampOrAction row={row} allRows={allRows} mine={mine} onMarkYes={onMarkYes} onAnswerGroup={onAnswerGroup} /></td>
            <td className="text-center" style={{ padding: 12, borderBottom: "1px solid var(--dpdp-line2)" }}>{row.sent}</td>
          </tr>
        )
      })}
    </>
  )
}
