"use server"

import { revalidatePath } from "next/cache"
import { getDpdpAuthContext } from "@/lib/services/dpdp-session"
import { markObligationDone } from "@/lib/services/dpdp-obligation-service"

export async function markOnePageJobDone(obligationId: string) {
  const ctx = await getDpdpAuthContext()
  if (!ctx) throw new Error("Not signed in")
  await markObligationDone(ctx.orgId, ctx.identityId, ctx.level === "owner" ? "Owner" : "Staff", obligationId)
  revalidatePath("/dpdp/home")
}
