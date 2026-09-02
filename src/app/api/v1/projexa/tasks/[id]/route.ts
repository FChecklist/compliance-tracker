// R67 F-26 (audit recommendation R-242) -- ONE task, by id.
//
// WHY THIS ROUTE EXISTS. After a Send, PROJEXA re-read the entire task list to
// discover the row it had just created, so the composer sat empty and Send sat
// disabled for the 590-1740 ms that re-read took, with nothing on screen to
// look at. The minted row is now inserted straight into the pane from the POST
// response and polled HERE until it reaches a terminal status -- one row, not
// fifty, and only while something is actually running.
//
// Same source of truth as the list: compliance.pipeline_tasks joined to its
// submission, the same projection, so a polled row and a listed row can never
// render differently. Same guards as the list too -- org scope, and the
// "member"/"read" floor (API_READ_WITHOUT_ROLE_CHECK: a read that skips the
// floor lets rank-1 roles see work that is not theirs).
import { NextRequest, NextResponse } from "next/server"
import { and, eq } from "drizzle-orm"
import { requireAuthOrApiKey, requireRoleOrScope } from "@/lib/supabase/auth-guard"
import { withTenantContext } from "@/lib/db/tenant-scoped"
import { pipelineTasks, submissions } from "@/lib/db/schema"

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await requireAuthOrApiKey(request)
  if (ctx.response) return ctx.response
  if (!ctx.orgId) return NextResponse.json({ error: "No organisation on this account" }, { status: 400 })

  const roleErr = requireRoleOrScope(ctx, "member", "read")
  if (roleErr) return roleErr

  const { id } = await params
  if (!id) return NextResponse.json({ error: "A task id is required" }, { status: 400 })

  try {
    const rows = await withTenantContext({ orgId: ctx.orgId }, (db) =>
      db
        .select({
          id: pipelineTasks.id,
          submissionId: pipelineTasks.submissionId,
          sequence: pipelineTasks.sequence,
          dependsOn: pipelineTasks.dependsOn,
          projectId: pipelineTasks.projectId,
          derivedChain: pipelineTasks.derivedChain,
          functionId: pipelineTasks.functionId,
          params: pipelineTasks.params,
          status: pipelineTasks.status,
          error: pipelineTasks.error,
          createdAt: pipelineTasks.createdAt,
          updatedAt: pipelineTasks.updatedAt,
          rawInput: submissions.rawInput,
          mode: submissions.mode,
        })
        .from(pipelineTasks)
        .leftJoin(submissions, eq(pipelineTasks.submissionId, submissions.id))
        // org_id is in the WHERE as well as in the tenant context: this is the
        // house pattern for every scoped read here, and it means a task id from
        // another org is a 404 rather than a row.
        .where(and(eq(pipelineTasks.id, id), eq(pipelineTasks.orgId, ctx.orgId!)))
        .limit(1)
    )

    const task = rows[0]
    if (!task) return NextResponse.json({ error: "Task not found" }, { status: 404 })
    return NextResponse.json({ task })
  } catch (error) {
    console.error("v1 projexa task GET error:", error)
    const message = error instanceof Error ? error.message : "Failed to read the task"
    return NextResponse.json({ error: message }, { status: 400 })
  }
}
