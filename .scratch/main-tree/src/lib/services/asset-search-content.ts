// Priority 3 UMR dispatch (agent 3, vector-search wiring). Pure helper
// extracted out of asset-vector-search-service.ts specifically so it can be
// unit-tested with zero dependency on platform_assets/embeddings (both live
// behind @/lib/db and @/lib/embeddings, which this file deliberately does
// not import) -- same reasoning as asset-dependency-utils.ts's own header.

/**
 * Builds the combined text an asset's search embedding is generated from.
 * Mirrors capability-registry-service.ts's buildCapabilityContent():
 * concatenate the fields that actually carry the asset's meaning (not just
 * its name), so a query like "the thing that files GST returns" can match
 * an asset whose purpose/searchKeywords mention GST even if its name
 * doesn't. Falsy fields (null/undefined/empty string) are dropped, not
 * turned into a stray " | " separator.
 */
export function buildAssetSearchContent(asset: { name: string; purpose?: string | null; searchKeywords?: string | null }): string {
  return [asset.name, asset.purpose || null, asset.searchKeywords || null].filter(Boolean).join(" | ")
}
