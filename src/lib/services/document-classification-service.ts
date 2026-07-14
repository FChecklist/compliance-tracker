// Priority 13 (Document Correspondent/Type Auto-Classification, Paperless-
// ngx pattern, drizzle/0186_document_classification.sql). Confirmed gap:
// zero hits for "correspondent"/"autoClassif"/"matchingRule" anywhere in
// src/lib/services/ before this file -- every document.category/tag was
// 100% manually typed.
//
// The Paperless-ngx pattern ported here (as a design pattern, not a literal
// dependency): a Correspondent register (document_correspondents) plus
// per-org matching RULES (document_matching_rules) that auto-tag a document
// with its correspondent/category/tags on ingest. documents.category (Wave
// 61) already covers Paperless-ngx's "DocumentType" concept -- this file
// does NOT fork that into a parallel document_types entity table.
//
// Deliberately deterministic, no AI call -- 4 match algorithms (any_word/
// all_words/exact/regex), evaluated against the document's filename and/or
// its Document AI extracted text (document-extraction-service.ts), first
// matching rule (by priority, then id) wins, mirroring Paperless-ngx's own
// "first match wins" semantics rather than merging every match.
//
// Additive/suggestive discipline: applyClassificationWithDb() NEVER
// overwrites a category or correspondentId a human (or a prior version) has
// already set -- it only fills in what's still null. Tags are unioned, never
// removed. `documents.autoClassified` records whether this pass (rather than
// a human) set category/correspondentId, so a UI can show "auto-tagged,
// please confirm" instead of silently presenting a guess as manual input.
import { documents, documentMatchingRules, documentCorrespondents } from "@/lib/db"
import { withTenantContext, type TenantDb } from "@/lib/db/tenant-scoped"
import { and, eq } from "drizzle-orm"
import { ServiceError } from "./compliance-service"
export { ServiceError }

export type MatchField = "filename" | "content" | "both"
export type RuleType = "any_word" | "all_words" | "exact" | "regex"

export const RULE_TYPES: RuleType[] = ["any_word", "all_words", "exact", "regex"]
export const MATCH_FIELDS: MatchField[] = ["filename", "content", "both"]

export type MatchingRule = {
  id: string
  isActive: boolean
  matchField: MatchField
  ruleType: RuleType
  pattern: string
  priority: number
  targetCorrespondentId: string | null
  targetCategory: string | null
  targetTags: string[] | null
}

export type ClassificationInput = { fileName: string; extractedText?: string | null }

export type ClassificationResult = {
  matchedRuleId: string
  correspondentId: string | null
  category: string | null
  tags: string[]
}

// ─── Pure, DB-free matching logic (unit-testable directly) ────────────────

/**
 * Evaluates a single rule against a document's filename and/or extracted
 * text, per the rule's matchField. A 'content' or 'both' rule with no
 * extractedText yet (e.g. a non-image upload, or an image whose Document AI
 * extraction hasn't completed/succeeded) simply never matches on content --
 * a real, disclosed limitation, not a silent crash.
 */
export function evaluateRule(rule: Pick<MatchingRule, "matchField" | "ruleType" | "pattern">, input: ClassificationInput): boolean {
  const haystacks: string[] = []
  if (rule.matchField === "filename" || rule.matchField === "both") haystacks.push(input.fileName ?? "")
  if ((rule.matchField === "content" || rule.matchField === "both") && input.extractedText) haystacks.push(input.extractedText)
  const text = haystacks.filter(Boolean).join("\n")
  if (!text) return false

  if (rule.ruleType === "regex") {
    try {
      return new RegExp(rule.pattern, "i").test(text)
    } catch {
      // An invalid regex pattern never matches -- never throws and blocks
      // classification for every other document/rule.
      return false
    }
  }

  const lowerText = text.toLowerCase()
  if (rule.ruleType === "exact") return lowerText.includes(rule.pattern.toLowerCase().trim())

  const words = rule.pattern.split(/\s+/).map((w) => w.trim().toLowerCase()).filter(Boolean)
  if (words.length === 0) return false
  if (rule.ruleType === "any_word") return words.some((w) => lowerText.includes(w))
  return words.every((w) => lowerText.includes(w)) // all_words
}

/**
 * Evaluates every ACTIVE rule in priority order (lowest number first, then
 * id for a deterministic tie-break) and returns the first match -- "first
 * matching rule wins", same semantics as Paperless-ngx, so a user's rule
 * list stays predictable rather than silently merging every match.
 */
export function classifyDocument(rules: MatchingRule[], input: ClassificationInput): ClassificationResult | null {
  const active = [...rules].filter((r) => r.isActive).sort((a, b) => a.priority - b.priority || a.id.localeCompare(b.id))
  for (const rule of active) {
    if (evaluateRule(rule, input)) {
      return {
        matchedRuleId: rule.id,
        correspondentId: rule.targetCorrespondentId ?? null,
        category: rule.targetCategory ?? null,
        tags: rule.targetTags ?? [],
      }
    }
  }
  return null
}

// ─── Validation (validate-then-throw, matching report-taxonomy.ts's convention) ──

export type CreateMatchingRuleInput = {
  name: string
  matchField?: MatchField
  ruleType: RuleType
  pattern: string
  priority?: number
  targetCorrespondentId?: string | null
  targetCategory?: string | null
  targetTags?: string[] | null
  isActive?: boolean
}

export function validateMatchingRuleInput(input: Partial<CreateMatchingRuleInput>): { valid: true } | { valid: false; reason: string } {
  if (!input.name?.trim()) return { valid: false, reason: "name is required" }
  if (!input.pattern?.trim()) return { valid: false, reason: "pattern is required" }
  if (!input.ruleType || !RULE_TYPES.includes(input.ruleType)) return { valid: false, reason: `ruleType must be one of: ${RULE_TYPES.join(", ")}` }
  if (input.matchField && !MATCH_FIELDS.includes(input.matchField)) return { valid: false, reason: `matchField must be one of: ${MATCH_FIELDS.join(", ")}` }
  if (!input.targetCorrespondentId && !input.targetCategory && (!input.targetTags || input.targetTags.length === 0)) {
    return { valid: false, reason: "a matching rule must set at least one of targetCorrespondentId, targetCategory, or targetTags" }
  }
  if (input.ruleType === "regex") {
    try {
      new RegExp(input.pattern)
    } catch {
      return { valid: false, reason: "pattern is not a valid regular expression" }
    }
  }
  return { valid: true }
}

// ─── Correspondents CRUD ───────────────────────────────────────────────────

export async function listCorrespondents(ctx: { orgId: string }) {
  return withTenantContext({ orgId: ctx.orgId }, (db) =>
    db.query.documentCorrespondents.findMany({
      where: (t, { eq }) => eq(t.orgId, ctx.orgId),
      orderBy: (t, { asc }) => asc(t.name),
    })
  )
}

export async function createCorrespondent(ctx: { orgId: string }, input: { name: string }) {
  const name = input.name?.trim()
  if (!name) throw new ServiceError("name is required", 400)
  return withTenantContext({ orgId: ctx.orgId }, async (db) => {
    const [row] = await db.insert(documentCorrespondents).values({ orgId: ctx.orgId, name }).returning()
    return row
  })
}

export async function deleteCorrespondent(ctx: { orgId: string }, id: string) {
  return withTenantContext({ orgId: ctx.orgId }, async (db) => {
    const existing = await db.query.documentCorrespondents.findFirst({ where: and(eq(documentCorrespondents.id, id), eq(documentCorrespondents.orgId, ctx.orgId)) })
    if (!existing) throw new ServiceError("Correspondent not found", 404)
    await db.delete(documentCorrespondents).where(eq(documentCorrespondents.id, id))
  })
}

// ─── Matching rules CRUD ────────────────────────────────────────────────────

export async function listMatchingRules(ctx: { orgId: string }) {
  return withTenantContext({ orgId: ctx.orgId }, (db) =>
    db.query.documentMatchingRules.findMany({
      where: eq(documentMatchingRules.orgId, ctx.orgId),
      orderBy: (t, { asc }) => asc(t.priority),
    })
  )
}

export async function createMatchingRule(ctx: { orgId: string }, input: CreateMatchingRuleInput) {
  const check = validateMatchingRuleInput(input)
  if (!check.valid) throw new ServiceError(check.reason, 400)
  return withTenantContext({ orgId: ctx.orgId }, async (db) => {
    const [row] = await db.insert(documentMatchingRules).values({
      orgId: ctx.orgId,
      name: input.name.trim(),
      matchField: input.matchField ?? "both",
      ruleType: input.ruleType,
      pattern: input.pattern.trim(),
      priority: input.priority ?? 100,
      targetCorrespondentId: input.targetCorrespondentId || null,
      targetCategory: input.targetCategory || null,
      targetTags: input.targetTags && input.targetTags.length > 0 ? input.targetTags : null,
      isActive: input.isActive ?? true,
    }).returning()
    return row
  })
}

export async function updateMatchingRule(ctx: { orgId: string }, id: string, patch: Partial<CreateMatchingRuleInput>) {
  return withTenantContext({ orgId: ctx.orgId }, async (db) => {
    const existing = await db.query.documentMatchingRules.findFirst({ where: and(eq(documentMatchingRules.id, id), eq(documentMatchingRules.orgId, ctx.orgId)) })
    if (!existing) throw new ServiceError("Matching rule not found", 404)

    const merged: CreateMatchingRuleInput = {
      name: patch.name ?? existing.name,
      matchField: patch.matchField ?? (existing.matchField as MatchField),
      ruleType: patch.ruleType ?? (existing.ruleType as RuleType),
      pattern: patch.pattern ?? existing.pattern,
      priority: patch.priority ?? existing.priority,
      targetCorrespondentId: patch.targetCorrespondentId !== undefined ? patch.targetCorrespondentId : existing.targetCorrespondentId,
      targetCategory: patch.targetCategory !== undefined ? patch.targetCategory : existing.targetCategory,
      targetTags: patch.targetTags !== undefined ? patch.targetTags : (existing.targetTags as string[] | null),
      isActive: patch.isActive ?? existing.isActive,
    }
    const check = validateMatchingRuleInput(merged)
    if (!check.valid) throw new ServiceError(check.reason, 400)

    const [row] = await db.update(documentMatchingRules).set({
      name: merged.name.trim(),
      matchField: merged.matchField,
      ruleType: merged.ruleType,
      pattern: merged.pattern.trim(),
      priority: merged.priority,
      targetCorrespondentId: merged.targetCorrespondentId || null,
      targetCategory: merged.targetCategory || null,
      targetTags: merged.targetTags && merged.targetTags.length > 0 ? merged.targetTags : null,
      isActive: merged.isActive,
      updatedAt: new Date(),
    }).where(eq(documentMatchingRules.id, id)).returning()
    return row
  })
}

export async function deleteMatchingRule(ctx: { orgId: string }, id: string) {
  return withTenantContext({ orgId: ctx.orgId }, async (db) => {
    const existing = await db.query.documentMatchingRules.findFirst({ where: and(eq(documentMatchingRules.id, id), eq(documentMatchingRules.orgId, ctx.orgId)) })
    if (!existing) throw new ServiceError("Matching rule not found", 404)
    await db.delete(documentMatchingRules).where(eq(documentMatchingRules.id, id))
  })
}

// ─── Applying classification to a real document (additive, never-override) ──

/**
 * Runs every active rule for this org against a document and, on a match,
 * writes its result onto the documents row -- but ONLY additively:
 *  - category/correspondentId are set ONLY if currently null (never
 *    overwrites an explicit user choice, or a value inherited from a
 *    previous version per document-service.ts's versioning convention).
 *  - tags are unioned with whatever tags already exist -- never removed.
 *  - autoClassified is set true only the first time this pass is what
 *    actually filled in category/correspondentId (stays false forever for a
 *    document a human classified themselves).
 * Accepts an already-open TenantDb so callers already inside a
 * withTenantContext block (e.g. the upload route) can call this without a
 * nested transaction, matching document-service.ts's markSupersededVersion()
 * convention.
 */
export async function applyClassificationWithDb(
  db: TenantDb,
  orgId: string,
  documentId: string,
  input: { extractedText?: string | null } = {}
): Promise<ClassificationResult | null> {
  const doc = await db.query.documents.findFirst({ where: and(eq(documents.id, documentId), eq(documents.orgId, orgId)) })
  if (!doc) return null

  const rules = await db.query.documentMatchingRules.findMany({ where: eq(documentMatchingRules.orgId, orgId) })
  const result = classifyDocument(rules as unknown as MatchingRule[], { fileName: doc.name, extractedText: input.extractedText ?? null })
  if (!result) return null

  const existingTags = Array.isArray(doc.tags) ? (doc.tags as string[]) : []
  const mergedTags = Array.from(new Set([...existingTags, ...result.tags]))
  const willSetCategory = doc.category == null && result.category != null
  const willSetCorrespondent = doc.correspondentId == null && result.correspondentId != null

  await db.update(documents).set({
    category: doc.category ?? result.category ?? doc.category,
    correspondentId: doc.correspondentId ?? result.correspondentId,
    tags: mergedTags,
    autoClassified: doc.autoClassified || willSetCategory || willSetCorrespondent,
  }).where(eq(documents.id, documentId))

  return result
}

export async function autoClassifyDocument(ctx: { orgId: string }, documentId: string, input: { extractedText?: string | null } = {}) {
  return withTenantContext({ orgId: ctx.orgId }, (db) => applyClassificationWithDb(db, ctx.orgId, documentId, input))
}
