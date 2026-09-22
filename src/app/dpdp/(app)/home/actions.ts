"use server"

import { revalidatePath } from "next/cache"
import { getDpdpAuthContext } from "@/lib/services/dpdp-session"
import { answerGroupObligation, markObligationDone } from "@/lib/services/dpdp-obligation-service"
import { acknowledgeRoleWelcome, completeOwnerFirstVisit, flagNotMe, type AreaAssignment } from "@/lib/services/dpdp-onepage-service"
import type { GroupAnswerKind } from "@/lib/dpdp-onepage/view-model"

export async function markOnePageJobDone(obligationId: string) {
  const ctx = await getDpdpAuthContext()
  if (!ctx) throw new Error("Not signed in")
  await markObligationDone(ctx.orgId, ctx.identityId, ctx.level === "owner" ? "Owner" : "Staff", obligationId)
  revalidatePath("/dpdp/home")
}

export async function saveFirstVisitAssignments(membershipId: string, assignments: AreaAssignment[]) {
  const ctx = await getDpdpAuthContext()
  if (!ctx) throw new Error("Not signed in")
  await completeOwnerFirstVisit(ctx.orgId, ctx.identityId, "Owner", membershipId, assignments)
  revalidatePath("/dpdp/home")
}

export async function acknowledgeOnePageWelcome(membershipId: string) {
  const ctx = await getDpdpAuthContext()
  if (!ctx) throw new Error("Not signed in")
  await acknowledgeRoleWelcome(ctx.orgId, ctx.identityId, ctx.level === "owner" ? "Owner" : "Staff", membershipId)
  revalidatePath("/dpdp/home")
}

export async function flagOnePageNotMe(membershipId: string) {
  const ctx = await getDpdpAuthContext()
  if (!ctx) throw new Error("Not signed in")
  await flagNotMe(ctx.orgId, ctx.identityId, ctx.level === "owner" ? "Owner" : "Staff", membershipId)
  revalidatePath("/dpdp/home")
}

export async function answerOnePageGroupJob(obligationId: string, answer: GroupAnswerKind) {
  const ctx = await getDpdpAuthContext()
  if (!ctx) throw new Error("Not signed in")
  await answerGroupObligation(ctx.orgId, ctx.identityId, ctx.level === "owner" ? "Owner" : "Staff", obligationId, answer)
  revalidatePath("/dpdp/home")
}
