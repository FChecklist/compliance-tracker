// PROJEXA-BUILD-002 WP-13 (register row AW-605): the organisation-wide list of the proposals a SCHEDULE prepared, for the proposals
// page. GET answers 200 with the pending rows of compliance.submissions whose chain says source "scheduler_bridge": the proposals of a
// connected-folder scan (a NEW project read from a workbook found in a mailbox or a Drive folder, which have no project yet and so
// cannot appear on a project's approval list) and any write a schedule proposed for a project.
//
// WHO SEES WHAT. A member sees the proposals of the schedules they own; a manager or above sees the organisation's. A key that names
// no person sees none. The list carries names, counts and states, never an amount, and never the parameters of a proposal of a
// function other than the folder scan (a create_boq proposal holds rates). GET writes nothing and asks no model.
//
// Approving a proposal of a new project is not done here: this is the list a person reads, and the answer for each proposal says
// what it waits on (answers to the extraction's questions, or an approval).
import { NextRequest, NextResponse } from "next/server"
import { requireAuthOrApiKey, requireRoleOrScope, requireOrg } from "@/lib/supabase/auth-guard"
import { ServiceError } from "@/lib/services/compliance-service"
import { withRouteTiming } from "@/lib/route-timing"
import { ROLE_RANK, type UserRole } from "@/lib/supabase/role-rank"
import { listSchedulerProposals } from "@/lib/services/folder-watch-store"

export async function GET(...args: Parameters<typeof GET_impl>) {
  return withRouteTiming("GET", () => GET_impl(...args))
}

async function GET_impl(request: NextRequest) {
  const ctx = await requireAuthOrApiKey(request)
  if (ctx.response) return ctx.response
  if (!ctx.orgId) return requireOrg(ctx)!

  const roleErr = requireRoleOrScope(ctx, "member", "read")
  if (roleErr) return roleErr

  try {
    const person = ctx.dbUser
    if (!person) return NextResponse.json({ count: 0, proposals: [] })
    const sees = (ROLE_RANK[person.role as UserRole] ?? 0) >= ROLE_RANK.manager ? {} : { onlyFor: person.id }
    const proposals = await listSchedulerProposals({ orgId: ctx.orgId, actorId: person.id }, sees)
    return NextResponse.json({ count: proposals.length, proposals })
  } catch (error) {
    if (error instanceof ServiceError) return NextResponse.json({ error: error.message }, { status: error.status })
    console.error("v1 projexa scheduler proposals list error:", error)
    return NextResponse.json({ error: "Failed to read the proposals prepared by schedules" }, { status: 500 })
  }
}
