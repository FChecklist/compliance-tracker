import type { ObligationRow, ViewerContext } from "@/lib/dpdp-onepage/view-model"
import type { DpdpClient, RpcError } from "./client"
import type { MyPagePayload } from "./rpc-types"

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
