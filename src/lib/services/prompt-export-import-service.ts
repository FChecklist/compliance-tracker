// VERIDIAN_Architecture_v2.0 phase_8 (2026-07-28): engine-prompt-export /
// engine-prompt-import. A portable, single-template JSON bundle -- distinct
// from PR #561's scripts/export-prompt-versions-gitops.ts, which is a
// one-way, whole-registry DB->git file-tree exporter for GitOps/CI review
// with no import counterpart (confirmed by reading that script before
// writing this one). This is the real remaining gap: export ONE template's
// content as a bundle a human/another environment can carry around, and a
// validated path to bring that bundle back into this system.
//
// Import never silently re-promotes a version's lifecycle state or trusts
// the bundle's own semver/label claims wholesale -- every imported version
// lands as a new 'Draft' version on the target template (creating the
// template first if templateKey doesn't already exist), same "re-earn
// Production status through the real state machine" posture
// rollbackPromptVersion() already established in prompt-os-service.ts.
import { db, promptTemplates, promptVersions } from "@/lib/db"
import { eq } from "drizzle-orm"
import { ServiceError } from "./compliance-service"
export { ServiceError }
import { requirePromptPermissionForUser } from "./permission-service"
import { nextSemanticVersion } from "./prompt-os-service"
import type { PromptOsContext } from "./prompt-os-service"

export const PROMPT_BUNDLE_FORMAT_VERSION = 1

export type PromptBundleVersion = {
  version: number
  content: string
  label: string | null
  major: number
  minor: number
  patch: number
}

export type PromptBundle = {
  bundleFormatVersion: number
  templateKey: string
  displayName: string
  description: string | null
  versions: PromptBundleVersion[]
  exportedAt: string
}

export async function exportPromptBundle(templateKey: string): Promise<PromptBundle> {
  const template = await db.query.promptTemplates.findFirst({ where: eq(promptTemplates.templateKey, templateKey) })
  if (!template) throw new ServiceError("Unknown templateKey", 404)

  const versions = await db.query.promptVersions.findMany({
    where: eq(promptVersions.promptTemplateId, template.id),
    orderBy: (t, { asc }) => asc(t.version),
  })

  return {
    bundleFormatVersion: PROMPT_BUNDLE_FORMAT_VERSION,
    templateKey: template.templateKey,
    displayName: template.displayName,
    description: template.description,
    versions: versions.map((v) => ({
      version: v.version, content: v.content, label: v.label,
      major: v.major, minor: v.minor, patch: v.patch,
    })),
    exportedAt: new Date().toISOString(),
  }
}

function isValidBundle(value: unknown): value is PromptBundle {
  if (!value || typeof value !== "object") return false
  const v = value as Record<string, unknown>
  return (
    typeof v.bundleFormatVersion === "number" &&
    typeof v.templateKey === "string" && v.templateKey.trim().length > 0 &&
    typeof v.displayName === "string" && v.displayName.trim().length > 0 &&
    Array.isArray(v.versions) &&
    v.versions.every((ver) => ver && typeof ver === "object" && typeof (ver as Record<string, unknown>).content === "string")
  )
}

export type PromptImportResult = {
  templateKey: string
  createdTemplate: boolean
  importedVersionIds: string[]
}

/**
 * Validates and ingests an exported prompt bundle. If a template with this
 * templateKey already exists, appends the bundle's versions as new Draft
 * versions on it (never overwrites/deletes existing history -- same
 * append-only posture as every other prompt-os-service.ts write path);
 * otherwise creates the template first. Content is deduplicated against the
 * target template's current latest version to make re-importing an
 * unchanged bundle a no-op rather than piling up identical Draft versions.
 */
export async function importPromptBundle(ctx: PromptOsContext, bundle: unknown): Promise<PromptImportResult> {
  requirePromptPermissionForUser(ctx.dbUser, "prompt.import.run")

  if (!isValidBundle(bundle)) throw new ServiceError("Invalid prompt bundle: missing required fields", 400)
  if (bundle.bundleFormatVersion !== PROMPT_BUNDLE_FORMAT_VERSION) {
    throw new ServiceError(`Unsupported bundle format version: ${bundle.bundleFormatVersion}`, 400)
  }
  if (bundle.versions.length === 0) throw new ServiceError("Bundle contains no versions to import", 400)

  return db.transaction(async (tx) => {
    let template = await tx.query.promptTemplates.findFirst({ where: eq(promptTemplates.templateKey, bundle.templateKey) })
    let createdTemplate = false
    if (!template) {
      const [row] = await tx.insert(promptTemplates).values({
        templateKey: bundle.templateKey, displayName: bundle.displayName, description: bundle.description ?? null,
      }).returning()
      template = row
      createdTemplate = true
    }

    const importedVersionIds: string[] = []
    for (const bundleVersion of bundle.versions) {
      const latest = await tx.query.promptVersions.findFirst({
        where: eq(promptVersions.promptTemplateId, template.id),
        orderBy: (t, { desc }) => desc(t.version),
      })
      if (latest?.content === bundleVersion.content) continue // unchanged -- skip, keeps re-import idempotent

      const nextVersion = (latest?.version ?? 0) + 1
      const semver = nextSemanticVersion(latest, "minor")
      const [row] = await tx.insert(promptVersions).values({
        promptTemplateId: template.id, version: nextVersion, content: bundleVersion.content,
        label: null, createdById: ctx.userId, lifecycleState: "Draft",
        major: semver.major, minor: semver.minor, patch: semver.patch,
      }).returning()
      importedVersionIds.push(row.id)
    }

    return { templateKey: template.templateKey, createdTemplate, importedVersionIds }
  })
}
