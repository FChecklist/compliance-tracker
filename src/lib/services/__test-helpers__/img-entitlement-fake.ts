// R68 Phase 8 (IMG-031) -- shared test seam for the IMG entitlement gate.
//
// WHY THIS EXISTS. Phase 8 puts assertImgEntitled() at the top of every memory
// recall and write path. Every existing memory test drives those paths through
// a QUEUE-BASED fake tx (`responses[i++]`), so an unanswered entitlement query
// would consume the queue slot the test meant for its first real SELECT and
// silently shift every index-sensitive assertion in four large files by one.
//
// The alternative -- prepending an entitlement row to ~250 individual fixtures
// -- would have been mechanical churn that buries what each test is actually
// about. Answering the gate OUT OF BAND, exactly as
// r68-phase6-write-path.test.ts's own header describes doing for the Phase 6
// authorization gate ("stubbing the whole module also keeps the gate's own DB
// reads out of makeQueueTx's response queue, so every existing index-sensitive
// assertion below still means exactly what it meant before"), keeps each
// existing test meaning what it already meant: "an ENTITLED org recalls this".
//
// The gate REFUSING is not stubbed away anywhere -- it is proven directly, and
// end-to-end through the real recall and write functions, in
// r68-phase8-packaging.test.ts and memory-entitlement.test.ts.
//
// Lives in a subdirectory on purpose: scripts/report-test-coverage-gap.mjs
// scans src/lib/services/*.ts flat, and a test seam is not a service that owes
// the repo a sibling test.

/**
 * The gate's query is recognised by a table name only it reads. This is the
 * same JSON.stringify-the-drizzle-fragment trick memory-recall-service.test.ts
 * already uses for the graph tier (`s.includes("graph_node")`) and
 * r68-phase6-write-path.test.ts uses for its sqlOf() assertions.
 */
export const IMG_ENTITLEMENT_SQL_MARKER = "org_product_branch_enablements"

export function isImgEntitlementQuery(query: unknown): boolean {
  try {
    return JSON.stringify(query ?? null)?.includes(IMG_ENTITLEMENT_SQL_MARKER) ?? false
  } catch {
    return false
  }
}

/** The row shape memory-entitlement.ts's checkImgEntitlement() reads back. */
export function imgEntitlementRow(entitled: boolean, orgId: string | null = "org-1") {
  return [{ tx_org_id: orgId, entitled }]
}

/** An entitled answer for the default `org-1` every memory test fixture uses. */
export function imgEntitled(orgId = "org-1") {
  return imgEntitlementRow(true, orgId)
}
