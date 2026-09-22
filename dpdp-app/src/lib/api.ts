import type { ObligationRow, ViewerContext } from "@/lib/dpdp-onepage/view-model"
import type { DpdpClient, RpcError } from "./client"
import type { AreaAssignmentWire, AreaPayload, FirstVisitPayload, HistoryEntryWire, MyPagePayload } from "./rpc-types"

export class RpcFailure extends Error {
  code?: string
  constructor(err: RpcError) {
    super(err.message)
    this.name = "RpcFailure"
    this.code = err.code
  }
}

export type MyPage = Omit<MyPagePayload, "rows"> & { rows: ObligationRow[] }

export async function fetchMyPage(client: DpdpClient): Promise<MyPage> {
  const { data, error } = await client.rpc("dpdp_my_page")
  if (error) throw new RpcFailure(error)
  const page = data as MyPagePayload
  return { ...page, rows: page.rows.map((r) => ({ ...r, due: new Date(r.due) })) }
}

export async function markDone(client: DpdpClient, obligationId: string): Promise<void> {
  const { error } = await client.rpc("dpdp_mark_done", { p_obligation_id: obligationId })
  if (error) throw new RpcFailure(error)
}

export async function acknowledgeWelcome(client: DpdpClient): Promise<void> {
  const { error } = await client.rpc("dpdp_acknowledge_welcome")
  if (error) throw new RpcFailure(error)
}

export async function flagNotMe(client: DpdpClient): Promise<void> {
  const { error } = await client.rpc("dpdp_flag_not_me")
  if (error) throw new RpcFailure(error)
}

export function viewerContext(v: MyPagePayload["viewer"]): ViewerContext {
  return { kind: v.kind, me: v.email, caSub: v.caSub ?? undefined }
}

// ---------------------------------------------------------------------
// WO-DPDP-011 Step 3: the owner's page (drizzle/0605).
// ---------------------------------------------------------------------

export type Area = AreaPayload
export type AreaAssignment = AreaAssignmentWire
export type HistoryItem = Omit<HistoryEntryWire, "occurredAt"> & { occurredAt: Date }

/** areasForProduct(): the first-visit wizard's rows for this org's product. */
export async function fetchAreas(client: DpdpClient, product: "firm" | "institution"): Promise<Area[]> {
  const { data, error } = await client.rpc("dpdp_areas_for_product", { p_product: product })
  if (error) throw new RpcFailure(error)
  return data as Area[]
}

/** completeOwnerFirstVisit(): saves step 2's answers and stamps the owner's first visit. Owner-only. */
export async function completeOwnerFirstVisit(client: DpdpClient, orgId: string, assignments: AreaAssignment[]): Promise<FirstVisitPayload> {
  const { data, error } = await client.rpc("dpdp_complete_owner_first_visit", { p_org_id: orgId, p_assignments: assignments })
  if (error) throw new RpcFailure(error)
  return data as FirstVisitPayload
}

/** assignObligation() with the WO-011 §4 fix: the named person gets a membership too. Owner-only. */
export async function assignPerson(client: DpdpClient, obligationId: string, email: string): Promise<void> {
  const { error } = await client.rpc("dpdp_assign_person", { p_obligation_id: obligationId, p_email: email })
  if (error) throw new RpcFailure(error)
}

/** "Doesn't apply" for one job -- the owner or the person it's assigned to. */
export async function markNotApplicable(client: DpdpClient, obligationId: string, reason?: string): Promise<void> {
  const { error } = await client.rpc("dpdp_mark_not_applicable", { p_obligation_id: obligationId, p_reason: reason ?? null })
  if (error) throw new RpcFailure(error)
}

/** listOnePageHistory(): the org's events, newest first (the RPC caps at 50; the UI shows 15). */
export async function fetchHistory(client: DpdpClient, orgId?: string, limit = 15): Promise<HistoryItem[]> {
  const { data, error } = await client.rpc("dpdp_org_history", { p_limit: limit, ...(orgId ? { p_org_id: orgId } : {}) })
  if (error) throw new RpcFailure(error)
  return (data as HistoryEntryWire[]).map((h) => ({ ...h, occurredAt: new Date(h.occurredAt) }))
}
