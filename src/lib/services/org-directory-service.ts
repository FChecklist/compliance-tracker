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
import { and, eq } from "drizzle-orm"
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
 * The calling org's active users, filtered by `q` and capped.
 *
 * Org scoping is BOTH the withTenantContext org and an explicit
 * users.orgId equality -- the same belt-and-braces every other read in this
 * codebase uses, because a directory that leaked one org's staff names into
 * another org's picker would be a data-protection incident, not a UI bug.
 * Inactive users are excluded: assigning work to a leaver is never intended.
 */
export async function listOrgDirectory(
  ctx: { orgId: string },
  options: { q?: string; limit?: number } = {}
): Promise<OrgDirectoryUser[]> {
  if (!ctx.orgId) throw new ServiceError("An organisation is required to read the directory", 400)
  const limit = resolveDirectoryLimit(options.limit)
  const rows = await withTenantContext({ orgId: ctx.orgId }, (db) =>
    db.query.users.findMany({
      where: and(eq(users.orgId, ctx.orgId), eq(users.isActive, true)),
      columns: { id: true, name: true, email: true, role: true },
      orderBy: (t, { asc }) => asc(t.name),
    })
  )
  return rows
    .filter((u) => matchesDirectoryQuery(u, options.q))
    .slice(0, limit)
    .map((u) => ({ id: u.id, name: u.name, email: u.email, role: u.role }))
}
