// R67 WS-C (C-11) -- WHICH ROWS A TASK MASTER TAB ASKS FOR, AND WHAT THE
// NUMBER ON THAT TAB MEANS.
//
// THE DEFECT THIS CLOSES. GET /api/v1/projexa/tasks took `status` only as raw
// pipeline_task_status values, and PROJEXA's five tabs are not raw statuses --
// "Approval Pending" is to_do + waiting + blocked, "In Queue" is in_progress.
// So the pane asked for fifty rows of everything on every navigation and did
// the filtering in the browser, which is why the counts were computed over a
// PAGE (`rows.filter(...).length` on a list capped at 50) and quietly stopped
// being true the moment an org had more than fifty tasks.
//
// Two facts live here, both pure so both are asserted in task-tabs.test.ts:
//   1. the tab vocabulary -> the statuses it selects
//   2. a grouped count -> the per-tab numbers
//
// The counts are deliberately NOT derived from the returned page. A count and
// a page are different questions: "how many are there" and "which ones am I
// looking at now". Answering the first with the second is the defect.

/** compliance.pipeline_task_status -- M24's closed five, verbatim. */
export const PIPELINE_STATUSES = ["to_do", "in_progress", "waiting", "done", "blocked"] as const;
export type PipelineStatus = (typeof PIPELINE_STATUSES)[number];

/**
 * C-11's own vocabulary, verbatim: "accepting needs_you|waiting|approval|
 * queued|done". These are what a TAB asks for; the five above are what the
 * column holds, and the two sets are not the same shape.
 */
export const TASK_TAB_KEYS = ["needs_you", "waiting", "approval", "queued", "done"] as const;
export type TaskTabKey = (typeof TASK_TAB_KEYS)[number];

/**
 * A tab asks for a SET of statuses.
 *
 * `needs_you` and `approval` are the same set on purpose: PROJEXA's tab is
 * called "Approval Pending" and M24's group is called "needs you", and they
 * are one list under two names. Giving them two different answers here is how
 * a product ends up with two lists that disagree about the same rows.
 */
const TAB_STATUSES: Readonly<Record<TaskTabKey, readonly PipelineStatus[]>> = {
  needs_you: ["to_do", "waiting", "blocked"],
  approval: ["to_do", "waiting", "blocked"],
  waiting: ["waiting"],
  queued: ["in_progress"],
  done: ["done"],
};

export type StatusFilter = {
  /** The statuses to select. Empty means "every status" -- no filter at all. */
  statuses: PipelineStatus[];
  /** The tab this resolved to, when the caller named one. */
  tab: TaskTabKey | null;
  /**
   * Values the caller sent that are neither a tab key nor a real status. Kept
   * rather than silently dropped: a caller that misspells a filter and gets
   * every row back has been told nothing, and that is how a filter bug hides.
   */
  unknown: string[];
};

/**
 * Read the `status` query parameter. Accepts BOTH vocabularies -- the tab keys
 * above and the raw statuses -- because the composer's existing callers send
 * raw statuses today and must keep working unchanged.
 */
export function resolveStatusFilter(statusParam: string | null | undefined): StatusFilter {
  const parts = (statusParam ?? "")
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter((s) => s.length > 0);

  const statuses = new Set<PipelineStatus>();
  const unknown: string[] = [];
  let tab: TaskTabKey | null = null;

  for (const part of parts) {
    if ((TASK_TAB_KEYS as readonly string[]).includes(part)) {
      const key = part as TaskTabKey;
      if (tab === null) tab = key;
      for (const s of TAB_STATUSES[key]) statuses.add(s);
    } else if ((PIPELINE_STATUSES as readonly string[]).includes(part)) {
      statuses.add(part as PipelineStatus);
    } else {
      unknown.push(part);
    }
  }

  return { statuses: [...statuses], tab, unknown };
}

/** One row of the grouped `SELECT status, count(*) ... GROUP BY status`. */
export type StatusCountRow = { status: string | null; n: number };

export type TaskCounts = {
  /**
   * The four names this route has returned since R53. UNCHANGED MEANING --
   * `needsYou` is still to_do + waiting and `blocked` is still its own number,
   * because a caller reading them today must not silently start getting a
   * different total. What IS different is where they come from: a grouped
   * count over the whole scope rather than over the returned page.
   */
  needsYou: number;
  running: number;
  done: number;
  blocked: number;
  total: number;
  /**
   * C-11's own payload: one number per TAB, keyed by the same vocabulary the
   * `status` filter accepts, so the number on a tab and the rows that tab asks
   * for are derived from one table (TAB_STATUSES) and cannot drift apart.
   */
  tabs: Record<TaskTabKey, number>;
  /** Per raw status, so a caller can build a tab this file has not heard of. */
  byStatus: Record<PipelineStatus, number>;
};

/**
 * The per-tab numbers, from a grouped count over the WHOLE scope -- never from
 * the page of rows the same request returns.
 */
export function tabCountsFrom(rows: readonly StatusCountRow[]): TaskCounts {
  const byStatus = { to_do: 0, in_progress: 0, waiting: 0, done: 0, blocked: 0 } as Record<PipelineStatus, number>;
  let total = 0;
  for (const row of rows) {
    const n = Number.isFinite(row.n) ? Math.max(0, Math.trunc(row.n)) : 0;
    total += n;
    if (row.status && (PIPELINE_STATUSES as readonly string[]).includes(row.status)) {
      byStatus[row.status as PipelineStatus] += n;
    }
  }

  const tabs = {} as Record<TaskTabKey, number>;
  for (const key of TASK_TAB_KEYS) {
    tabs[key] = TAB_STATUSES[key].reduce((sum, s) => sum + byStatus[s], 0);
  }

  return {
    needsYou: byStatus.to_do + byStatus.waiting,
    running: byStatus.in_progress,
    done: byStatus.done,
    blocked: byStatus.blocked,
    total,
    tabs,
    byStatus,
  };
}
