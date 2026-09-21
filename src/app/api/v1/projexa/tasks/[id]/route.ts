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
//
// PROJEXA-E2E-001 / WO-PROJEXA-AI-LINK-001 follow-up (2026-09-21) -- PATCH
// added below. Context: PROJEXA's AI Link (org_ai_link -> public GET
// /api/ai/[token] -> apply flow at POST /api/ai/apply, both in the projexa
// repo) used to read AND write PROJEXA's own local `public.todos` table --
// a table with no reachable screen anywhere in PROJEXA's current UI (dead
// since the R52 M24Shell rewrite). Repointing the AI Link's snapshot/apply
// target to THIS table (pipeline_tasks, what the real Tasks tab shows) closes
// that divergence -- but pipeline_tasks lives in a DIFFERENT Supabase project
// than org_ai_link/todos (this repo's pcrjmlpuqsbocqfwoxod vs projexa's own
// evpckeuxgvahguwsaeul), so there is no cross-database query PROJEXA's SQL
// layer could use -- the write has to go through THIS repo's own API, same as
// every other cross-repo PROJEXA write.
//
// A direct schema read (src/lib/db/schema.ts's pipelineTasks table) found NO
// assignee_id, NO due_date, and NO note/description column on this table --
// only `status` is real. So of the AI Link's 5-verb allowlist (ASSIGN,
// SET_DUE, NOTE, MARK_STATUS, DRAFT), only MARK_STATUS has anything to target
// here; the apply route's own fix (projexa repo) honestly refuses the other
// three for a pipeline_tasks target rather than forcing them onto a field
// that doesn't exist.
//
// Even `status` is not a plain field-write, though -- it is currently set
// ONLY by run-submission.ts's own executor (markInProgress()/updateTask()),
// and pipeline_task_status is an M24-closed 5-value enum specifically because
// this repo's own directive (§22/#27) is "AI must NOT directly perform
// uncontrolled database mutation... software validates, authorizes, executes,
// logs". This PATCH is that validating software, not a bypass of it: it is
// role-gated exactly like POST/GET above, org-scoped exactly like GET above,
// and -- the part that keeps it from corrupting the executor's own state
// machine -- it accepts ONLY the two states a human sign-off plausibly means
// ('to_do' = reopen, 'done' = mark complete). 'in_progress'/'waiting'/
// 'blocked' stay executor-exclusive; a manual claim to be "in progress" or
// "blocked" would fake execution state this endpoint has no way to verify.
import { NextRequest, NextResponse } from "next/server"
import { and, eq } from "drizzle-orm"
import { requireAuthOrApiKey, requireRoleOrScope } from "@/lib/supabase/auth-guard"
import { withTenantContext } from "@/lib/db/tenant-scoped"
import { pipelineTasks, submissions } from "@/lib/db/schema"
import { withRouteTiming } from "@/lib/route-timing"

// The only two states a manual PATCH may set. Deliberately a strict subset of
// pipelineTaskStatusEnum, not the whole thing -- see this file's header.
const MANUAL_STATUSES = ["to_do", "done"] as const
type ManualStatus = (typeof MANUAL_STATUSES)[number]

// R67 F-28 (R-249): the exported handler is unchanged in shape -- both CI
// route guards read it with a regex -- and delegates to its original body so
// the response carries Server-Timing: app;dur=<ms> measured HERE. See
// src/lib/route-timing.ts for why the export is not rewritten instead.
export async function GET(...args: Parameters<typeof GET_impl>) {
  return withRouteTiming("GET", () => GET_impl(...args))
}

async function GET_impl(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
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

// R67 F-28 (R-249): same reason as GET/POST above -- Server-Timing measured
// at the true entry point.
export async function PATCH(...args: Parameters<typeof PATCH_impl>) {
  return withRouteTiming("PATCH", () => PATCH_impl(...args))
}

/**
 * A narrow, explicit manual status write -- see this file's header for why
 * it exists and why it is deliberately not a general field-write endpoint.
 * Same guards as POST (the "member"/"write" floor, not "read"), same org
 * scoping as GET (id + orgId both in the WHERE, so a foreign-org id is a 404
 * rather than a row belonging to someone else).
 */
async function PATCH_impl(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await requireAuthOrApiKey(request)
  if (ctx.response) return ctx.response
  if (!ctx.orgId) return NextResponse.json({ error: "No organisation on this account" }, { status: 400 })

  const roleErr = requireRoleOrScope(ctx, "member", "write")
  if (roleErr) return roleErr

  const { id } = await params
  if (!id) return NextResponse.json({ error: "A task id is required" }, { status: 400 })

  let body: Record<string, unknown>
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: "Body must be JSON" }, { status: 400 })
  }

  const status = typeof body.status === "string" ? body.status : null
  if (!status || !MANUAL_STATUSES.includes(status as ManualStatus)) {
    return NextResponse.json(
      {
        error: `status must be one of: ${MANUAL_STATUSES.join(", ")} -- in_progress/waiting/blocked are set only by the execution pipeline itself, never by a manual write`,
      },
      { status: 400 }
    )
  }

  try {
    const updated = await withTenantContext({ orgId: ctx.orgId }, async (db) => {
      const rows = await db
        .update(pipelineTasks)
        // org_id in the WHERE (not just the tenant context) is the same
        // house pattern GET/POST use above -- a task id from another org
        // updates nothing rather than someone else's row.
        .set({ status: status as ManualStatus, updatedAt: new Date() })
        .where(and(eq(pipelineTasks.id, id), eq(pipelineTasks.orgId, ctx.orgId!)))
        .returning({
          id: pipelineTasks.id,
          status: pipelineTasks.status,
          updatedAt: pipelineTasks.updatedAt,
        })
      return rows[0]
    })

    if (!updated) return NextResponse.json({ error: "Task not found" }, { status: 404 })
    return NextResponse.json({ task: updated })
  } catch (error) {
    console.error("v1 projexa task PATCH error:", error)
    const message = error instanceof Error ? error.message : "Failed to update the task"
    return NextResponse.json({ error: message }, { status: 400 })
  }
}
