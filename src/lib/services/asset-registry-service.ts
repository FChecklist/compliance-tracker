// Universal Metadata Registry (UMR) core service -- Priority 3,
// tree4-unified/50-completion-plan/08-priority3-umr-tracker.yaml, agent
// 1/umr-core. CRUD over compliance.platform_assets, the single metadata
// index every object on the platform can register into (this pass:
// worker_agents, computation_engines, prompt_templates, dynamic_chains --
// see scripts/backfill-platform-assets.ts; the ~330-table retrofit is a
// documented follow-on, not attempted here).
//
// platform_assets spans both platform-tier (orgId null: e.g.
// computation_engines, prompt_templates, which aren't org-scoped at all)
// and org-scoped rows (dynamic_chains). Following
// capability-registry-service.ts's precedent for the same kind of
// entity-agnostic, mixed-tier table, this service uses the plain `db`
// client (no withTenantContext) -- callers that need tenant-scoped reads
// pass orgId as an explicit filter, same as capability-registry-service.ts
// does over `embeddings`.
import { db, platformAssets, type assetTypeEnum, type assetStatusEnum } from "@/lib/db"
import { and, eq, isNull } from "drizzle-orm"
import { ServiceError } from "./compliance-service"
export { ServiceError }

export type AssetType = (typeof assetTypeEnum.enumValues)[number]
export type AssetStatus = (typeof assetStatusEnum.enumValues)[number]

export type RegisterAssetInput = {
  name: string
  assetType: AssetType
  sourceTable: string
  sourceId: string
  module?: string | null
  department?: string | null
  ownerId?: string | null
  status?: AssetStatus
  createdBy?: string | null
  version?: string
  tags?: string[]
  aiEnabled?: boolean
  aiCapabilities?: string[] | null
  permissions?: string[] | null
  parentAssetId?: string | null
  searchKeywords?: string | null
  purpose?: string | null
  dependencies?: string[] | null
  orgId?: string | null
}

export type ValidationResult = { valid: true } | { valid: false; reason: string }

// Pure validation core for registerAsset() -- required-field checks only;
// the "does a row already exist for this source" check is necessarily a DB
// round-trip and stays in registerAsset() itself. Extracted so the decision
// logic is unit-testable without a live DB, matching this codebase's
// established pattern (see task-service.ts's validateChainDepth,
// approval-workflow-service.ts's isSelfApproval).
export function validateRegisterAssetInput(input: RegisterAssetInput): ValidationResult {
  if (!input.name?.trim()) return { valid: false, reason: "name is required" }
  if (!input.assetType) return { valid: false, reason: "assetType is required" }
  if (!input.sourceTable?.trim()) return { valid: false, reason: "sourceTable is required" }
  if (!input.sourceId?.trim()) return { valid: false, reason: "sourceId is required" }
  return { valid: true }
}

// The "compiler at build time" hook: whatever code creates a new
// worker_agent / computation_engine / prompt_template / dynamic_chain (or,
// eventually, any other registered object) calls this right after, so the
// index row always exists alongside the real data. Validates the required
// fields, then lets the DB generate the Asset ID (compliance.
// generate_asset_id(), a real sequence -- see migration 0150) and enforce
// the one-row-per-source uniqueness constraint; both are checked here too
// so a bad call fails with a clear 400/409 instead of a raw Postgres error.
export async function registerAsset(input: RegisterAssetInput) {
  const validation = validateRegisterAssetInput(input)
  if (!validation.valid) throw new ServiceError(validation.reason, 400)

  const name = input.name.trim()
  const sourceTable = input.sourceTable.trim()
  const sourceId = input.sourceId.trim()

  const existing = await getAssetBySource(sourceTable, sourceId)
  if (existing) {
    throw new ServiceError(
      `An asset is already registered for ${sourceTable}:${sourceId} (${existing.assetId})`,
      409
    )
  }

  const [row] = await db
    .insert(platformAssets)
    .values({
      name,
      assetType: input.assetType,
      sourceTable,
      sourceId,
      module: input.module ?? null,
      department: input.department ?? null,
      ownerId: input.ownerId ?? null, // null = 'System', per contract
      status: input.status ?? "active",
      createdBy: input.createdBy ?? null,
      version: input.version ?? "1.0",
      tags: input.tags ?? [],
      aiEnabled: input.aiEnabled ?? false,
      aiCapabilities: input.aiCapabilities ?? null,
      permissions: input.permissions ?? null,
      parentAssetId: input.parentAssetId ?? null,
      searchKeywords: input.searchKeywords ?? null,
      purpose: input.purpose ?? null,
      dependencies: input.dependencies ?? null,
      orgId: input.orgId ?? null,
      // assetId intentionally omitted -- compliance.generate_asset_id()
      // column default fills it, race-safe under concurrent inserts.
    })
    .returning()

  return row
}

// O(1) direct index lookup -- the "Index 1" the Owner's spec names: look up
// any object on the platform by its universal Asset ID without knowing
// which of the ~330 tables it actually lives in.
export async function getAssetByAssetId(assetId: string) {
  if (!assetId?.trim()) throw new ServiceError("assetId is required", 400)
  const row = await db.query.platformAssets.findFirst({
    where: eq(platformAssets.assetId, assetId.trim()),
  })
  return row ?? null
}

// Reverse lookup -- "does this real row already have a registry entry, and
// what's its Asset ID" -- used both by registerAsset()'s own duplicate
// check and by any caller that only knows the source table/row.
export async function getAssetBySource(sourceTable: string, sourceId: string) {
  if (!sourceTable?.trim() || !sourceId?.trim()) {
    throw new ServiceError("sourceTable and sourceId are required", 400)
  }
  const row = await db.query.platformAssets.findFirst({
    where: and(eq(platformAssets.sourceTable, sourceTable.trim()), eq(platformAssets.sourceId, sourceId.trim())),
  })
  return row ?? null
}

export type UpdateAssetInput = Partial<
  Omit<RegisterAssetInput, "sourceTable" | "sourceId" | "assetType">
> & { name?: string }

export async function updateAsset(assetId: string, input: UpdateAssetInput) {
  const existing = await getAssetByAssetId(assetId)
  if (!existing) throw new ServiceError(`No asset found for ${assetId}`, 404)
  if (input.name !== undefined && !input.name.trim()) {
    throw new ServiceError("name cannot be blank", 400)
  }

  const [row] = await db
    .update(platformAssets)
    .set({
      ...input,
      name: input.name?.trim() ?? undefined,
      updatedAt: new Date(),
    })
    .where(eq(platformAssets.assetId, assetId))
    .returning()

  return row
}

// Soft-delete only, via status -- never a hard DELETE. Matches this
// codebase's own established caution about destructive operations (see
// AGENTS.md's prohibition on permanent data deletion, and worker_agents'
// lifecycleStatus 'retired' precedent rather than row removal).
export async function archiveAsset(assetId: string) {
  const existing = await getAssetByAssetId(assetId)
  if (!existing) throw new ServiceError(`No asset found for ${assetId}`, 404)

  const [row] = await db
    .update(platformAssets)
    .set({ status: "archived", updatedAt: new Date() })
    .where(eq(platformAssets.assetId, assetId))
    .returning()

  return row
}

export type OrgFilterMode = { mode: "none" } | { mode: "platform-only" } | { mode: "org"; orgId: string }

// opts.orgId accepts `null` explicitly (meaning "platform-tier assets
// only") distinctly from `undefined` (meaning "no org filter at all", the
// default). Pure decision function, unit-testable without touching
// drizzle-orm or a live DB -- resolveOrgFilterCondition() below just maps
// its output to a query condition.
export function resolveOrgFilterMode(orgId: string | null | undefined): OrgFilterMode {
  if (orgId === undefined) return { mode: "none" }
  if (orgId === null) return { mode: "platform-only" }
  return { mode: "org", orgId }
}

// `eq(col, null)` would silently compile to `col = NULL`, which SQL always
// evaluates false -- the "platform-only" mode is routed through `isNull()`
// instead so it actually matches platform-tier rows.
function orgFilterCondition(orgId: string | null | undefined) {
  const resolved = resolveOrgFilterMode(orgId)
  if (resolved.mode === "none") return undefined
  return resolved.mode === "platform-only" ? isNull(platformAssets.orgId) : eq(platformAssets.orgId, resolved.orgId)
}

export async function listAssetsByType(assetType: AssetType, opts?: { orgId?: string | null; status?: AssetStatus }) {
  const conditions = [eq(platformAssets.assetType, assetType)]
  const orgCondition = orgFilterCondition(opts?.orgId)
  if (orgCondition) conditions.push(orgCondition)
  if (opts?.status) conditions.push(eq(platformAssets.status, opts.status))

  return db.query.platformAssets.findMany({
    where: and(...conditions),
    orderBy: (t, { desc }) => desc(t.createdAt),
  })
}

export async function listAssetsByModule(module: string, opts?: { orgId?: string | null; status?: AssetStatus }) {
  if (!module?.trim()) throw new ServiceError("module is required", 400)
  const conditions = [eq(platformAssets.module, module.trim())]
  const orgCondition = orgFilterCondition(opts?.orgId)
  if (orgCondition) conditions.push(orgCondition)
  if (opts?.status) conditions.push(eq(platformAssets.status, opts.status))

  return db.query.platformAssets.findMany({
    where: and(...conditions),
    orderBy: (t, { desc }) => desc(t.createdAt),
  })
}

// Exported for callers that already have a raw list and just want the sort
// this service applies everywhere else, without a DB round-trip.
export function sortByCreatedAtDesc<T extends { createdAt: Date }>(rows: T[]): T[] {
  return [...rows].sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
}
