// Area 14 (Common functionalities) gap-close: search-command.tsx's
// "Standard" tab previously called /api/compliance?search= directly, so
// standard (non-AI-semantic) global search only ever covered one entity
// type. This service backs the new unified /api/search route, covering
// compliance items, tasks, and clients -- the three highest-traffic entity
// types with a title/name field worth full-text-ish matching on.
import { complianceItems, tasks, clients } from "@/lib/db"
import { withTenantContext } from "@/lib/db/tenant-scoped"
import { ilike, or, and, eq } from "drizzle-orm"
import type { ReadContext } from "./context"

// Postgres' default LIKE/ILIKE escape character is already backslash, so
// escaping the two wildcard metacharacters (and a literal backslash itself,
// so it isn't misread as the start of an escape sequence) is enough --
// no explicit ESCAPE clause needed. Without this, searching for a literal
// "50%" silently behaved as "50" followed by anything, which is surprising
// and (for an org boundary search route) a minor info-shape leak.
export function escapeLikePattern(term: string): string {
  return term.replace(/[\\%_]/g, (ch) => `\\${ch}`)
}

export type SearchResultItem = {
  type: "compliance_item" | "task" | "client"
  id: string
  title: string
  status?: string | null
}

export type SearchResults = {
  compliance_items: SearchResultItem[]
  tasks: SearchResultItem[]
  clients: SearchResultItem[]
}

const EMPTY_RESULTS: SearchResults = { compliance_items: [], tasks: [], clients: [] }

export async function searchAll(ctx: ReadContext, query: string, limit = 8): Promise<SearchResults> {
  const { orgId } = ctx
  const term = query.trim()
  if (!term) return EMPTY_RESULTS

  const pattern = `%${escapeLikePattern(term)}%`
  const cappedLimit = Math.min(20, Math.max(1, limit))

  return withTenantContext({ orgId }, async (db) => {
    const [complianceRows, taskRows, clientRows] = await Promise.all([
      db.query.complianceItems.findMany({
        where: and(
          eq(complianceItems.orgId, orgId),
          or(ilike(complianceItems.title, pattern), ilike(complianceItems.description, pattern))
        ),
        limit: cappedLimit,
        columns: { id: true, title: true, status: true },
      }),
      db.query.tasks.findMany({
        where: and(
          eq(tasks.orgId, orgId),
          or(ilike(tasks.title, pattern), ilike(tasks.description, pattern))
        ),
        limit: cappedLimit,
        columns: { id: true, title: true, status: true },
      }),
      db.query.clients.findMany({
        where: and(eq(clients.orgId, orgId), ilike(clients.name, pattern)),
        limit: cappedLimit,
        columns: { id: true, name: true, isActive: true },
      }),
    ])

    return {
      compliance_items: complianceRows.map((c) => ({ type: "compliance_item" as const, id: c.id, title: c.title, status: c.status })),
      tasks: taskRows.map((t) => ({ type: "task" as const, id: t.id, title: t.title, status: t.status })),
      clients: clientRows.map((c) => ({ type: "client" as const, id: c.id, title: c.name, status: c.isActive ? "active" : "inactive" })),
    }
  })
}
