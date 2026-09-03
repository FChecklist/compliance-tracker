// R67 F-26 (audit recommendation R-242) -- Task Master's page cursor.
//
// THE MEASURED PROBLEM. GET /api/tasks?limit=50 ran on EVERY navigation at
// 590-1740 ms, and again after every Send -- and the row the user had just
// created appeared only when that whole 50-row re-read completed, so the
// composer sat empty and Send sat disabled for several seconds with nothing to
// look at. Task Master shows ten rows. Fifty were being fetched.
//
// So the list is paged, and the page has to be a KEYSET, not an offset: rows
// are minted while the user is reading, and an OFFSET page-2 silently repeats
// or skips rows whenever the set shifts underneath it.
//
// THE SORT KEY IS COMPOSITE, AND THE CURSOR MUST CARRY ALL OF IT. M24 orders
// Task Master by whose move it is FIRST ("what is stuck on ME") and only then
// by recency:
//
//     ORDER BY (status IN ('to_do','waiting')) DESC, created_at DESC, id DESC
//
// A cursor of (created_at, id) alone cannot express a position in that
// ordering: the first needs-you row is almost always OLDER than the newest
// done row, so resuming from "created_at < X" would drop every needs-you row
// created before X -- exactly the rows the pane exists to show. The cursor
// therefore carries the needs-you rank too. It stays one opaque token in the
// query string; nothing outside this file parses it.
//
// `id DESC` is the final tiebreaker on purpose: two tasks minted by the same
// submission share a created_at to the microsecond, and without a unique last
// key a page boundary landing between them repeats one and drops the other.

/** The statuses M24 groups as "needs you" -- nothing moves without a person. */
export const NEEDS_YOU_STATUSES = ["to_do", "waiting"] as const;

export type TaskCursor = { rank: 0 | 1; createdAt: Date; id: string };

/** 1 for a row that needs the user, 0 for everything else -- the leading sort key. */
export function needsYouRank(status: string | null | undefined): 0 | 1 {
  return (NEEDS_YOU_STATUSES as readonly string[]).includes(status ?? "") ? 1 : 0;
}

/** The cursor that resumes immediately AFTER this row. */
export function buildTaskCursor(row: { status?: string | null; createdAt: Date | string; id: string }): string {
  const createdAt = row.createdAt instanceof Date ? row.createdAt : new Date(row.createdAt);
  return `${needsYouRank(row.status)},${createdAt.toISOString()},${row.id}`;
}

/**
 * Parses a cursor, or null for anything malformed.
 *
 * NULL, NOT AN ERROR: a cursor is a position, and a position this server no
 * longer understands (a stale bookmark, a truncated URL) must degrade to "start
 * from the top", never to a 500 on a read. Splits on the first two commas only,
 * so an id containing one survives.
 */
export function parseTaskCursor(raw: string | null | undefined): TaskCursor | null {
  if (!raw) return null;
  const firstComma = raw.indexOf(",");
  const secondComma = raw.indexOf(",", firstComma + 1);
  if (firstComma < 1 || secondComma < 0) return null;

  const rankPart = raw.slice(0, firstComma);
  const timePart = raw.slice(firstComma + 1, secondComma);
  const id = raw.slice(secondComma + 1);
  if (rankPart !== "0" && rankPart !== "1") return null;
  if (!id) return null;

  const createdAt = new Date(timePart);
  if (Number.isNaN(createdAt.getTime())) return null;

  return { rank: rankPart === "1" ? 1 : 0, createdAt, id };
}

/**
 * The cursor for the NEXT page, or null when this page is the last one.
 *
 * A page shorter than the limit is the end of the list, and handing back a
 * cursor there would give the UI a "Show 20 more" control that loads nothing --
 * a dead end, which M24 forbids.
 */
export function nextTaskCursor(
  rows: { status?: string | null; createdAt: Date | string; id: string }[],
  limit: number
): string | null {
  if (rows.length === 0 || rows.length < limit) return null;
  return buildTaskCursor(rows[rows.length - 1]);
}
