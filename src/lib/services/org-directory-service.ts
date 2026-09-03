// R67 lane D22 (item D-58, rec R-187; the same endpoint item D-75 names).
//
// WHY THIS EXISTS: PROJEXA's MoM screens asked a human to type a VERIDIAN user
// id by hand -- the object page literally said "No org directory/picker yet --
// paste a known VERIDIAN user ID" next to a box hinting `usr_abc123`. An
// action item's owner is a real FK into compliance.users, so a typo produces
// either a 500 or an action item nobody is assigned, and PROJEXA's own
// /api/org-members lists PROJEXA Supabase auth users, whose ids mean nothing
// on this side. This is the missing half: the calling org's own VERIDIAN
// users, searchable, id kept internal and never printed.
//
// Deliberately its own tiny service rather than a new export on hr-service.ts:
// that file is the HR module (employee profiles, org chart, leave) and this is
// a generic directory lookup used by meetings, tasks and approvals. It reads
// nothing HR-specific and must not start depending on employee_profiles.
import { users } from "@/lib/db"
import { withTenantContext } from "@/lib/db/tenant-scoped"
import { and, eq, ilike, inArray, or } from "drizzle-orm"
import { ServiceError } from "./compliance-service"
export { ServiceError }

export type OrgDirectoryUser = { id: string; name: string; email: string; role: string }

/** Hard ceiling on one directory page -- a picker is a search box, never a data export. */
export const ORG_DIRECTORY_MAX_LIMIT = 50
const ORG_DIRECTORY_DEFAULT_LIMIT = 20

/**
 * Pure: does this person match what was typed?
 *
 * Matched against BOTH name and email, case-insensitively, as a substring --
 * "arj" has to find "Arjun Mehta", and a site manager who only knows a
 * colleague's email has to be able to type that instead. An empty query
 * matches everyone, which is what makes the picker usable before a key is
 * pressed.
 */
export function matchesDirectoryQuery(user: { name: string; email: string }, q: string | undefined): boolean {
  const needle = (q ?? "").trim().toLowerCase()
  if (!needle) return true
  return user.name.toLowerCase().includes(needle) || user.email.toLowerCase().includes(needle)
}

/** Pure: clamps a caller-supplied limit into 1..ORG_DIRECTORY_MAX_LIMIT, defaulting when absent or unreadable. */
export function resolveDirectoryLimit(raw: string | number | null | undefined): number {
  const n = typeof raw === "string" ? Number.parseInt(raw, 10) : typeof raw === "number" ? raw : Number.NaN
  if (!Number.isFinite(n)) return ORG_DIRECTORY_DEFAULT_LIMIT
  return Math.min(ORG_DIRECTORY_MAX_LIMIT, Math.max(1, Math.trunc(n)))
}

/**
 * Pure: the directory page, from already-loaded rows.
 *
 * R67 lane D22 (item D-75) made this its own exported function so the rule
 * that matters most here -- A PICKER MUST ONLY EVER SHOW THE CALLING ORG'S
 * OWN PEOPLE -- is provable in a unit test rather than only readable in a
 * where-clause. It is the THIRD layer of that guarantee, not the only one:
 * withTenantContext sets app.current_org_id for RLS, the query carries an
 * explicit users.orgId equality, and this filters the rows again. A directory
 * that leaked one org's staff names into another org's picker would be a
 * data-protection incident, not a UI bug, so it is checked three times and
 * asserted once.
 *
 * Inactive users are excluded here too: assigning work to a leaver is never
 * intended.
 */
// `orgId` is nullable on compliance.users (a platform-level account has none),
// and a row with no org is not a row of THIS org -- the equality below excludes
// it, which is the behaviour we want and the reason the constraint admits null
// rather than pretending the column is NOT NULL.
export function filterDirectoryRows<T extends { id: string; orgId: string | null; isActive: boolean; name: string; email: string }>(
  rows: T[],
  options: { orgId: string; q?: string; limit?: number | string | null; ids?: string[] }
): T[] {
  const limit = resolveDirectoryLimit(options.limit)
  const wanted = options.ids && options.ids.length ? new Set(options.ids) : null
  return rows
    .filter((u) => u.orgId === options.orgId && u.isActive === true)
    // `ids` is a RESOLUTION, not a search: a screen that already holds ids
    // (a task's assignees, an action item's owner) needs their names so it can
    // print words instead of keys, and asking it to guess a query string that
    // happens to match them would be absurd. Still org-scoped and still
    // capped, so it cannot be used to walk another org's user table.
    .filter((u) => (wanted ? wanted.has(u.id) : matchesDirectoryQuery(u, options.q)))
    .slice(0, limit)
}

/**
 * Pure: the LIKE pattern for a typed query, with the wildcards a human typed
 * treated as the characters they typed.
 *
 * `%`, `_` and `\` are SQL LIKE metacharacters; matchesDirectoryQuery() treats
 * them as ordinary text (String.includes has no wildcards). Escaping them here
 * is what makes the SQL predicate and the in-memory predicate agree exactly --
 * without it a needle containing `_` would match extra rows in SQL, and with a
 * LIMIT in play those extras can push a genuine match out of the page before
 * filterDirectoryRows() ever sees it.
 */
export function directoryLikePattern(q: string): string {
  return `%${q.replace(/([\\%_])/g, "\\$1")}%`
}

/**
 * The calling org's active users, filtered by `q` and capped.
 *
 * Org scoping is BOTH the withTenantContext org and an explicit
 * users.orgId equality, and then filterDirectoryRows() once more -- see its
 * comment for why this one is checked three times.
 *
 * R67 lane D22 (review finding): the search and the cap are applied IN THE
 * QUERY, not only afterwards in JS. This runs from a picker on every keystroke
 * (OrgUserPicker, AttendeesField) and, since D-77, on every task object page
 * load to resolve ids to names; loading a 2,000-user org's whole user table per
 * character on a 5-connection pool is the same class of problem the repo
 * already has on /scope. filterDirectoryRows() stays exactly as it was -- it is
 * the provable third layer of the org guarantee (D-75's acceptance clause), now
 * applied over an already-narrow row set rather than over the whole table.
 */
export async function listOrgDirectory(
  ctx: { orgId: string },
  options: { q?: string; limit?: number; ids?: string[] } = {}
): Promise<OrgDirectoryUser[]> {
  if (!ctx.orgId) throw new ServiceError("An organisation is required to read the directory", 400)
  const limit = resolveDirectoryLimit(options.limit)
  const needle = (options.q ?? "").trim()
  const ids = options.ids && options.ids.length ? options.ids : null
  // `ids` wins over `q` in exactly the order filterDirectoryRows() applies
  // them, so the two layers can never disagree about which predicate is live.
  const narrowing = ids
    ? inArray(users.id, ids)
    : needle
      ? or(ilike(users.name, directoryLikePattern(needle)), ilike(users.email, directoryLikePattern(needle)))
      : undefined
  const rows = await withTenantContext({ orgId: ctx.orgId }, (db) =>
    db.query.users.findMany({
      where: and(eq(users.orgId, ctx.orgId), eq(users.isActive, true), narrowing),
      columns: { id: true, orgId: true, name: true, email: true, role: true, isActive: true },
      orderBy: (t, { asc }) => asc(t.name),
      limit,
    })
  )
  return filterDirectoryRows(rows, { orgId: ctx.orgId, q: options.q, limit, ids: options.ids })
    .map((u) => ({ id: u.id, name: u.name, email: u.email, role: u.role }))
}
