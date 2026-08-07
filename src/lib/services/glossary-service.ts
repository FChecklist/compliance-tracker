// AI Architecture / Explainability & Transparency gap-closure (2026-07-18).
// "Explain Business Terminology" -- no structured glossary/explainer feature
// existed anywhere (confirmed: zero hits for "glossary" across src/ and
// schema.ts). businessTerminologyGlossary (schema.ts, migration 0225) is
// the table; this is its service layer, following the same org-scoped-or-
// platform-default read pattern as report-engine-service.ts's
// report_definitions (org_id nullable = platform-wide, seeded with a
// starting set of real platform terms, extensible per-org).
import { businessTerminologyGlossary } from "@/lib/db"
import { withTenantContext } from "@/lib/db/tenant-scoped"
import { and, eq, or, isNull } from "drizzle-orm"
import { ServiceError } from "./compliance-service"
export { ServiceError }

export async function listGlossaryTerms(ctx: { orgId: string }) {
  return withTenantContext({ orgId: ctx.orgId }, (db) =>
    db.query.businessTerminologyGlossary.findMany({
      where: or(eq(businessTerminologyGlossary.orgId, ctx.orgId), isNull(businessTerminologyGlossary.orgId)),
      orderBy: (t, { asc }) => asc(t.term),
    })
  )
}

/**
 * Case-insensitive lookup by term OR alias -- the real "hover/inline
 * explainer" call site (GlossaryTermTooltip) needs to resolve a term it
 * spotted in running text without knowing ahead of time whether it matches
 * the canonical term or one of its aliases.
 */
export async function findGlossaryTerm(ctx: { orgId: string }, term: string) {
  const needle = term.trim().toLowerCase()
  if (!needle) return null
  return withTenantContext({ orgId: ctx.orgId }, async (db) => {
    // Alias match is checked in application code (aliases is a jsonb
    // string[], and the glossary is small enough that fetching every
    // visible term once isn't a real cost) -- keeps the term-or-alias
    // matching logic in one readable place instead of split across SQL/TS.
    const all = await db.query.businessTerminologyGlossary.findMany({
      where: or(eq(businessTerminologyGlossary.orgId, ctx.orgId), isNull(businessTerminologyGlossary.orgId)),
    })
    const exact = all.find((c) => c.term.toLowerCase() === needle)
    if (exact) return exact
    return all.find((c) => Array.isArray(c.aliases) && (c.aliases as string[]).some((a) => a.toLowerCase() === needle)) ?? null
  })
}

export async function createGlossaryTerm(
  ctx: { orgId: string },
  input: { term: string; definition: string; category?: string; aliases?: string[] }
) {
  const term = input.term?.trim()
  const definition = input.definition?.trim()
  if (!term) throw new ServiceError("term is required", 400, { code: "VALIDATION_FAILED" })
  if (!definition) throw new ServiceError("definition is required", 400, { code: "VALIDATION_FAILED" })

  return withTenantContext({ orgId: ctx.orgId }, async (db) => {
    const [row] = await db.insert(businessTerminologyGlossary).values({
      orgId: ctx.orgId, term, definition,
      category: input.category?.trim() || null,
      aliases: input.aliases ?? [],
    }).returning()
    return row
  })
}

export async function updateGlossaryTerm(
  ctx: { orgId: string },
  termId: string,
  patch: Partial<{ term: string; definition: string; category: string | null; aliases: string[] }>
) {
  return withTenantContext({ orgId: ctx.orgId }, async (db) => {
    // Org-owned rows only -- an org can never edit a platform-wide (org_id
    // IS NULL) term through this path, matching report_definitions' own
    // "platform rows are read-only to orgs" convention.
    const existing = await db.query.businessTerminologyGlossary.findFirst({
      where: and(eq(businessTerminologyGlossary.id, termId), eq(businessTerminologyGlossary.orgId, ctx.orgId)),
    })
    if (!existing) throw new ServiceError("Glossary term not found", 404, { code: "NOT_FOUND" })

    const [row] = await db.update(businessTerminologyGlossary)
      .set({ ...patch, updatedAt: new Date() })
      .where(eq(businessTerminologyGlossary.id, termId)).returning()
    return row
  })
}

export async function deleteGlossaryTerm(ctx: { orgId: string }, termId: string) {
  return withTenantContext({ orgId: ctx.orgId }, async (db) => {
    const existing = await db.query.businessTerminologyGlossary.findFirst({
      where: and(eq(businessTerminologyGlossary.id, termId), eq(businessTerminologyGlossary.orgId, ctx.orgId)),
    })
    if (!existing) throw new ServiceError("Glossary term not found", 404, { code: "NOT_FOUND" })
    await db.delete(businessTerminologyGlossary).where(eq(businessTerminologyGlossary.id, termId))
    return { success: true }
  })
}
