// R63 (owner directive, 2026-08-29): reads the data-driven AI-connector
// provider list -- adding/editing a provider is a DB row, never a code
// change (matches this table's own migration header). Deterministic:
// returns exactly the active rows, in sort order, or an empty array --
// never throws for an empty/missing table.
import { db, aiConnectorProviders } from '@/lib/db'
import { eq, asc, and } from 'drizzle-orm'

export type SupportLevel = 'native_one_click' | 'requires_paid_plan' | 'enterprise_admin_only' | 'developer_only'

export interface AiConnectorProvider {
  readonly providerKey: string
  readonly displayName: string
  readonly supportLevel: SupportLevel
  readonly deepLinkTemplate: string | null
  readonly instructionsMd: string
  readonly requiresPlan: string | null
}

export async function listActiveConnectorProviders(): Promise<AiConnectorProvider[]> {
  const rows = await db.query.aiConnectorProviders.findMany({
    where: eq(aiConnectorProviders.status, 'active'),
    orderBy: asc(aiConnectorProviders.sortOrder),
  })
  return rows.map((r) => ({
    providerKey: r.providerKey,
    displayName: r.displayName,
    supportLevel: r.supportLevel as SupportLevel,
    deepLinkTemplate: r.deepLinkTemplate,
    instructionsMd: r.instructionsMd,
    requiresPlan: r.requiresPlan,
  }))
}

export async function getConnectorProvider(providerKey: string): Promise<AiConnectorProvider | null> {
  const row = await db.query.aiConnectorProviders.findFirst({
    where: and(eq(aiConnectorProviders.providerKey, providerKey), eq(aiConnectorProviders.status, 'active')),
  })
  if (!row) return null
  return {
    providerKey: row.providerKey,
    displayName: row.displayName,
    supportLevel: row.supportLevel as SupportLevel,
    deepLinkTemplate: row.deepLinkTemplate,
    instructionsMd: row.instructionsMd,
    requiresPlan: row.requiresPlan,
  }
}

/**
 * True closed-ended gate: a provider only ever gets a real "click to
 * connect" button when its own deep_link_template is non-null -- a
 * developer_only/enterprise_admin_only provider with no confirmed URL
 * always renders as instructions-only, never a broken/misleading button.
 */
export function hasOneClickLink(provider: AiConnectorProvider): boolean {
  return provider.deepLinkTemplate !== null && provider.deepLinkTemplate.length > 0
}
