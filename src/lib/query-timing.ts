// R67 F-33 (audit recommendation R-278) -- PER-QUERY TIMINGS FOR ONE WRITE.
//
// R-278's first instruction is the same one R-274 gave the /labour page: stop
// guessing, measure. Before this file nothing in this repo could say how a
// single POST's time was divided between its queries. route-timing.ts's
// `app;dur` gives the whole handler as one number, which is enough to say a
// write is slow and useless for saying which of its eight round trips made it
// slow.
//
// A timer is created per OPERATION (one task create), and every query inside
// that operation is wrapped by name. What comes out is one line naming the
// operation, its total, and each query's own share -- the record R-278 asks to
// be kept for one create.
//
// OFF BY DEFAULT. `DEBUG_LATENCY=1` turns the log line on; without it the only
// cost is two Date.now() calls per query and an array push, so an instrumented
// write path carries no log noise and no file handle in normal operation. The
// timings are still COLLECTED when the flag is off, because a caller may want
// to attach them to its own response (Server-Timing) or assert them in a test
// -- collection is cheap, printing is not.
//
//   DEBUG_LATENCY=1            -> one JSON line per operation on stdout
//   DEBUG_LATENCY_FILE=<path>  -> also appends that line to the file
//
// This is deliberately NOT a wrapper around the db client. Wrapping the client
// would time every query in the process, including the ones nobody is looking
// at, and would have to guess a name for each. Naming the queries at the call
// site is what makes the output readable.

export type QueryTiming = {
  /** Names the query, not the operation: "issue.insert", not "createIssue". */
  label: string
  ms: number
  /** A query that failed is the most interesting line in any such log. */
  outcome: "ok" | "error"
}

export type QueryTimer = {
  /** Times one query. The value, and any throw, pass through untouched. */
  time<T>(label: string, fn: () => Promise<T>): Promise<T>
  /** Records a step that was answered without a query (a cache hit). */
  note(label: string, ms?: number): void
  timings(): QueryTiming[]
  totalMs(): number
  /** Emits the operation's line. Safe to call more than once; only the first prints. */
  finish(extra?: Record<string, unknown>): void
}

export function latencyDebugEnabled(): boolean {
  return process.env.DEBUG_LATENCY === "1"
}

/**
 * Creates a timer for one operation.
 *
 * `scope` names the operation the way a reader would ask about it --
 * "createIssue", "recordAttendance" -- so a log line can be found from a
 * screen's complaint without knowing the file it came from.
 */
export function createQueryTimer(scope: string): QueryTimer {
  const entries: QueryTiming[] = []
  const startedAt = Date.now()
  let finished = false

  async function time<T>(label: string, fn: () => Promise<T>): Promise<T> {
    const queryStartedAt = Date.now()
    try {
      const value = await fn()
      entries.push({ label, ms: Date.now() - queryStartedAt, outcome: "ok" })
      return value
    } catch (err) {
      // Recorded BEFORE re-throwing: the slow query that then failed is
      // exactly the one a reader of this log is looking for.
      entries.push({ label, ms: Date.now() - queryStartedAt, outcome: "error" })
      throw err
    }
  }

  function note(label: string, ms = 0): void {
    entries.push({ label, ms, outcome: "ok" })
  }

  function timings(): QueryTiming[] {
    return entries.slice()
  }

  function totalMs(): number {
    return Date.now() - startedAt
  }

  function finish(extra: Record<string, unknown> = {}): void {
    if (finished) return
    finished = true
    if (!latencyDebugEnabled()) return
    const line = JSON.stringify({
      t: "query-timing",
      scope,
      totalMs: totalMs(),
      queries: entries,
      ...extra,
    })
    console.log(line)
    void appendLatencyLine(line)
  }

  return { time, note, timings, totalMs, finish }
}

async function appendLatencyLine(line: string): Promise<void> {
  const file = process.env.DEBUG_LATENCY_FILE
  if (!file) return
  try {
    // Imported lazily so a route that never sets the variable does not pull
    // node:fs into its bundle at all.
    const { appendFile } = await import("node:fs/promises")
    await appendFile(file, line + "\n", "utf8")
  } catch (err) {
    // A profiler must never be able to break the request it is profiling.
    console.error("[query-timing] could not append to DEBUG_LATENCY_FILE:", err instanceof Error ? err.message : err)
  }
}
