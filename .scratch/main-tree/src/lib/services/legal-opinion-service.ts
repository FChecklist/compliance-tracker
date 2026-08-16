// Legal opinion document drafting -- token substitution over an ordered
// clause template, reusing the exact same clm_contract_templates/
// clm_template_clauses/clm_clauses infrastructure erp-contract-service.ts's
// generateContractFromTemplate() already built for CLM contracts (a
// template's clauses are generic text, not inherently contract-specific).
// Deliberately NOT generative/AI authoring, same posture as CLM's own
// contract generation -- plain {{token}} substitution over clause text a
// human wrote and can review, not an LLM drafting legal content.
import { legalOpinions, clmContractTemplates, clmTemplateClauses, users } from "@/lib/db"
import { withTenantContext } from "@/lib/db/tenant-scoped"
import { and, eq } from "drizzle-orm"
import { ServiceError } from "./compliance-service"
export { ServiceError }
import { logActivity } from "@/lib/audit"

export type LegalOpinionContext = { orgId: string; userId: string; dbUser: typeof users.$inferSelect }

export async function generateOpinionDraft(
  ctx: LegalOpinionContext, opinionId: string, templateId: string,
  tokens: Record<string, string>, includeOptionalClauseIds?: string[]
) {
  return withTenantContext({ orgId: ctx.orgId, userId: ctx.userId }, async (db) => {
    const opinion = await db.query.legalOpinions.findFirst({ where: and(eq(legalOpinions.id, opinionId), eq(legalOpinions.orgId, ctx.orgId)) })
    if (!opinion) throw new ServiceError("Legal opinion not found", 404)
    const template = await db.query.clmContractTemplates.findFirst({ where: and(eq(clmContractTemplates.id, templateId), eq(clmContractTemplates.orgId, ctx.orgId)) })
    if (!template) throw new ServiceError("Template not found", 404)

    const templateClauses = await db.query.clmTemplateClauses.findMany({
      where: eq(clmTemplateClauses.templateId, templateId), orderBy: (t, { asc }) => asc(t.position), with: { clause: true },
    })
    const included = templateClauses.filter((tc) => !tc.isOptional || includeOptionalClauseIds?.includes(tc.clauseId))
    if (included.length === 0) throw new ServiceError("This template has no clauses to include", 400)

    const allTokens: Record<string, string> = { topic: opinion.topic, advisor: opinion.advisor ?? "", ...tokens }
    const bodyText = included.map((tc) => {
      let text = `## ${tc.clause.title}\n\n${tc.clause.bodyText}`
      for (const [key, value] of Object.entries(allTokens)) text = text.replaceAll(`{{${key}}}`, value)
      return text
    }).join("\n\n")

    const [updated] = await db.update(legalOpinions).set({ templateId, bodyText, generatedAt: new Date() }).where(eq(legalOpinions.id, opinionId)).returning()
    await logActivity({ tx: db, orgId: ctx.orgId, dbUser: ctx.dbUser, action: "legal_opinion.generated_from_template", entityType: "legal_opinion", entityId: opinionId, details: JSON.stringify({ templateId }) })
    return updated
  })
}
