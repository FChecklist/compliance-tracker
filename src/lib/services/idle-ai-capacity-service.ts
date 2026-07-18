// AI Cost Governance & FinOps gap-closure (2026-07-18): "Unused/idle AI
// capacity (provisioned but not consumed) identified". Per the task's own
// recommended approach ("simple quarterly query, not worth dedicated
// tooling at current scale"): this is one deterministic query, not a new
// tracking table -- customerModelConfig (Layer 2/org) and clientModelConfig
// (Layer 3/client) ARE the real "provisioned AI capacity" records in this
// schema (a BYO API key configured for a layer), and both already carry
// lastUsedAt for exactly this purpose -- see orchestra-model-resolver.ts's
// borrowFromSharedPool(), which already computes "idle" from lastUsedAt
// rather than a second stored flag; this reuses that same posture at a
// quarterly (90-day) cadence instead of that function's 5-minute
// shared-pool-borrowing cutoff, a materially different question ("has this
// org's own configured capacity gone unused for a business-relevant
// stretch of time" vs "is it safe to borrow right now").
// isActive=true + encryptedApiKey IS NOT NULL is the filter for "actually
// provisioned" -- a row without an API key was never real capacity in the
// first place, just a placeholder.
import { db, customerModelConfig, clientModelConfig } from "@/lib/db"
import { and, eq, isNotNull } from "drizzle-orm"

export type ProvisionedAiCapacityConfigType = "org" | "client"

export type ProvisionedAiCapacityRow = {
  configType: ProvisionedAiCapacityConfigType
  configId: string
  ownerId: string // orgId (configType='org') or clientId (configType='client')
  provider: string
  model: string | null
  createdAt: Date
  lastUsedAt: Date | null
}

export type IdleAiCapacity = ProvisionedAiCapacityRow & {
  daysIdle: number
  neverUsed: boolean
}

/** Pure: null when the config has been used (or created) within cutoffDays -- not idle. "Idle" is measured from lastUsedAt when present, else createdAt (a never-used config is idle from the day it was provisioned, not from some earlier epoch). */
export function classifyIdleCapacity(row: ProvisionedAiCapacityRow, cutoffDays: number, now: Date): IdleAiCapacity | null {
  const referenceDate = row.lastUsedAt ?? row.createdAt
  const daysIdle = (now.getTime() - referenceDate.getTime()) / 86_400_000
  if (daysIdle < cutoffDays) return null
  return { ...row, daysIdle, neverUsed: row.lastUsedAt === null }
}

export type IdleAiCapacityReport = {
  cutoffDays: number
  ranAt: string
  idleCapacity: IdleAiCapacity[]
}

const DEFAULT_CUTOFF_DAYS = 90

/** DB wrapper: real customerModelConfig/clientModelConfig rows, classified against a quarterly (default 90-day) idle cutoff. */
export async function findIdleAiCapacity(cutoffDays = DEFAULT_CUTOFF_DAYS): Promise<IdleAiCapacityReport> {
  const now = new Date()

  const [orgConfigs, clientConfigs] = await Promise.all([
    db.query.customerModelConfig.findMany({
      where: and(eq(customerModelConfig.isActive, true), isNotNull(customerModelConfig.encryptedApiKey)),
      columns: { id: true, orgId: true, provider: true, modelName: true, createdAt: true, lastUsedAt: true },
    }),
    db.query.clientModelConfig.findMany({
      where: and(eq(clientModelConfig.isActive, true), isNotNull(clientModelConfig.encryptedApiKey)),
      columns: { id: true, clientId: true, provider: true, modelName: true, createdAt: true, lastUsedAt: true },
    }),
  ])

  const rows: ProvisionedAiCapacityRow[] = [
    ...orgConfigs.map((c) => ({ configType: "org" as const, configId: c.id, ownerId: c.orgId, provider: c.provider, model: c.modelName, createdAt: c.createdAt, lastUsedAt: c.lastUsedAt })),
    ...clientConfigs.map((c) => ({ configType: "client" as const, configId: c.id, ownerId: c.clientId, provider: c.provider, model: c.modelName, createdAt: c.createdAt, lastUsedAt: c.lastUsedAt })),
  ]

  const idleCapacity = rows
    .map((row) => classifyIdleCapacity(row, cutoffDays, now))
    .filter((r): r is IdleAiCapacity => r !== null)

  return { cutoffDays, ranAt: now.toISOString(), idleCapacity }
}
