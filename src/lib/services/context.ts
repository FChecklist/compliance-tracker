import type { users } from "@/lib/db"

// Shared context every service function takes -- deliberately mirrors
// logActivity()'s discriminated dbUser/apiKey actor shape (src/lib/audit.ts)
// so a service function can pass `ctx.actor` straight into logActivity()
// without re-deriving it. This is what lets a route handler built on
// requireAuthOrApiKey() (Wave 9) and an MCP tool handler share the exact
// same service call -- both just need to construct one of these.
export type ServiceActor =
  | { dbUser: typeof users.$inferSelect; apiKey?: never }
  | { dbUser?: never; apiKey: { id: string; name: string } }

export type ServiceContext = {
  orgId: string
  actor: ServiceActor
  request?: Request
}

// Convenience for read-only service calls that don't write an audit log and
// so don't need a real actor -- e.g. GET routes where session auth alone
// (no dbUser distinction needed) is sufficient. Kept separate from
// ServiceContext (which mutating calls require) so a missing actor on a
// write path is a compile error, not a runtime surprise.
export type ReadContext = {
  orgId: string
}
