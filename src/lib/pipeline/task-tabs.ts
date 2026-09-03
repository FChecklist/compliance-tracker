// R67 WS-C (C-11) -- WHICH ROWS A TASK MASTER TAB ASKS FOR, AND WHAT THE
// NUMBER ON THAT TAB MEANS.
//
// THE DEFECT THIS CLOSES. GET /api/v1/projexa/tasks took `status` only as raw
// pipeline_task_status values, and PROJEXA's five tabs are not raw statuses --
// "Approval Pending" is to_do + waiting + blocked, "In Queue" is in_progress.
// So the pane asked for fifty rows of everything on every navigation and did
// the filtering in the browser.
//
// ---------------------------------------------------------------------------
// FIX PASS, decision D-11 -- WHAT THIS FILE NO LONGER CLAIMS.
//
// Lane C wrote this against a route that returned the whole set and counted
// `rows.filter(...).length`. Lanes B and F2 have since merged to main and
// between them fixed the count independently: the route now runs a grouped
// aggregate over the whole predicate and pages the ROWS with a keyset cursor.
// That half of C-11 is therefore already true on main and is not re-done here.
//
// What lane C still adds, and all this file now holds:
//   1. THE TAB VOCABULARY -- needs_you|waiting|approval|queued|done -- which
//      the raw five statuses cannot express, so a tab can ask the server for
//      its own rows instead of filtering fifty in the browser;
//   2. `counts.tabs`, keyed by that same vocabulary, so the number on a tab
//      and the rows that tab asks for are derived from ONE table below and
//      cannot drift apart.
//
// TWO THINGS LANE C DELIBERATELY DROPPED HERE, both because main decided them
// the other way and D-11 makes main canonical:
//   * needs-you no longer EXCLUDES infrastructure failures. Lane B's B-06
//     records a transport failure as `waiting` rather than `blocked` and keeps
//     it in "needs you" with a [Retry] -- a deliberate, documented product
//     call. `systemBlocked` is still REPORTED below (it is a real fact, and a
//     number that only ever disappears is a number nobody can audit) but
//     nothing is subtracted with it, because a count that disagreed with the
//     list it labels is the exact defect C-11 exists to remove.
//   * the four legacy count names keep main's meanings, verbatim.
//
// PURE. Both facts are asserted in task-tabs.test.ts.

/** Codes that mean "nobody on site can act on this". */
import { isSystemErrorCode } from "./failure-classification";

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
 *
 * They include `blocked` where main's own `counts.needsYou` does not, and that
 * is not a disagreement: main's four numbers answer "how many are in each
 * STATUS group", these answer "how many rows does this TAB show", and the
 * PROJEXA tab genuinely shows a blocked row -- it is the one a person most has
 * to act on.
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

/** The words a 400 names when a filter matched nothing this server knows. */
export function validFilterKeys(): string[] {
  return [...TASK_TAB_KEYS, ...PIPELINE_STATUSES];
}

/**
 * One row of the grouped `SELECT status, error_code, count(*) ... GROUP BY 1,2`.
 *
 * R67 C-13: the code is part of the grouping because "how many of these are
 * infrastructure" is a question the product may want to answer, and it cannot
 * be answered later from a count that already threw the code away.
 */
export type StatusCountRow = { status: string | null; errorCode?: string | null; n: number };

export type TaskCounts = {
  /**
   * The four names this route has returned since R53, with MAIN'S MEANINGS --
   * `needsYou` is to_do + waiting and `blocked` is its own number -- because a
   * caller reading them today must not silently start getting a different
   * total.
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
  /**
   * R67 C-13: how many BLOCKED rows carry an infrastructure code. Reported,
   * never subtracted -- see this file's header for why.
   */
  systemBlocked: number;
};

/**
 * The per-tab numbers, from a grouped count over the WHOLE scope -- never from
 * the page of rows the same request returns.
 */
export function tabCountsFrom(rows: readonly StatusCountRow[]): TaskCounts {
  const byStatus = { to_do: 0, in_progress: 0, waiting: 0, done: 0, blocked: 0 } as Record<PipelineStatus, number>;
  let total = 0;
  let systemBlocked = 0;
  for (const row of rows) {
    const n = Number.isFinite(row.n) ? Math.max(0, Math.trunc(row.n)) : 0;
    total += n;
    if (row.status && (PIPELINE_STATUSES as readonly string[]).includes(row.status)) {
      byStatus[row.status as PipelineStatus] += n;
      if (row.status === "blocked" && isSystemErrorCode(row.errorCode)) systemBlocked += n;
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
    systemBlocked,
  };
}
