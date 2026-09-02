// R53 Phase 6 -- /api/v1/projexa/tasks. The E-120 backend half.
//
// R52's handoff (platform.claude_log id 26): PROJEXA's composer has no
// endpoint to post to, and its Task Master has nothing to read, because
// compliance-tracker exposed /api/tasks but nothing on the /api/v1/projexa
// API-key path.
//
// *** IT READS AND WRITES compliance.pipeline_tasks, NOT compliance.tasks.
// *** M24 rules pipeline_tasks is the Task Master data source.
// compliance.tasks is a different, older AI-workforce dispatch system
// (~1,900 rows, client_id / assistant_id / task_embedding / dynamic_chain_id
// -- none of M24's shape). Reading the wrong one would fill Task Master with
// another system's rows and look like it was working.
//
// POST accepts EITHER shape, because the composer has two real input modes:
//   { rawInput }                -> the typed path: full segment/classify
//                                  pipeline, may mint SEVERAL tasks and a
//                                  mix of TASK and CHAT verdicts
//   { functionId, params }      -> the pill path: the user already chose the
//                                  function, so no classifier and NO MODEL
//                                  CALL EVER
import { NextRequest, NextResponse } from "next/server"
import { and, desc, eq, inArray } from "drizzle-orm"
import { requireAuthOrApiKey, requireRoleOrScope } from "@/lib/supabase/auth-guard"
import { withTenantContext } from "@/lib/db/tenant-scoped"
import { pipelineTasks, submissions } from "@/lib/db/schema"
import { runSubmission, runDirectTask, proposeSubmission } from "@/lib/pipeline/run-submission"
import { parseFailure } from "@/lib/pipeline/error-codes"
import { functionLabel } from "@/lib/pipeline/function-registry"

const TASK_STATUSES = ["to_do", "in_progress", "waiting", "done", "blocked"] as const
type TaskStatus = (typeof TASK_STATUSES)[number]

export async function POST(request: NextRequest) {
  const ctx = await requireAuthOrApiKey(request)
  if (ctx.response) return ctx.response
  if (!ctx.orgId) return NextResponse.json({ error: "No organisation on this account" }, { status: 400 })

  const roleErr = requireRoleOrScope(ctx, "member", "write")
  if (roleErr) return roleErr

  const actorId = ctx.dbUser?.id ?? ctx.apiKey!.id

  let body: Record<string, unknown>
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: "Body must be JSON" }, { status: 400 })
  }

  const mode = typeof body.mode === "string" ? body.mode : "Projects"
  const projectId = typeof body.projectId === "string" ? body.projectId : null

  try {
    // R67 B-05 -- STEP ONE: PROPOSE. {rawInput, dryRun:true} classifies,
    // derives the chain, works out what is still missing and offers the real
    // choices for it, WITHOUT minting a task. A parameter the classifier
    // could not fill used to become a pipeline_tasks row with status
    // 'blocked'; now it is a question, answered before anything is recorded,
    // and it is counted in no badge because no row exists. Step two is the
    // existing {functionId, params} path below, unchanged.
    if (body.dryRun === true) {
      const rawInput = typeof body.rawInput === "string" ? body.rawInput : ""
      if (rawInput.trim().length === 0) {
        return NextResponse.json({ error: "dryRun needs rawInput" }, { status: 400 })
      }
      const proposal = await proposeSubmission({
        orgId: ctx.orgId,
        userId: actorId,
        mode,
        projectId,
        rawInput,
        role: ctx.dbUser?.role ?? null,
      })
      // 200, not 201: nothing was created.
      return NextResponse.json(proposal, { status: 200 })
    }

    if (typeof body.functionId === "string" && body.functionId.trim().length > 0) {
      const result = await runDirectTask({
        orgId: ctx.orgId,
        userId: actorId,
        mode,
        projectId,
        functionId: body.functionId.trim(),
        params: (body.params as Record<string, unknown>) ?? {},
        note: typeof body.rawInput === "string" ? body.rawInput : undefined,
        role: ctx.dbUser?.role ?? null,
      })
      return NextResponse.json(result, { status: 201 })
    }

    const rawInput = typeof body.rawInput === "string" ? body.rawInput : ""
    if (rawInput.trim().length === 0) {
      return NextResponse.json(
        { error: "Provide either functionId (the pill path) or rawInput (the typed path)" },
        { status: 400 }
      )
    }

    const result = await runSubmission({
      orgId: ctx.orgId,
      userId: actorId,
      mode,
      projectId,
      selectedChain: body.selectedChain,
      rawInput,
      role: ctx.dbUser?.role ?? null,
    })
    return NextResponse.json(result, { status: 201 })
  } catch (error) {
    console.error("v1 projexa tasks POST error:", error)
    const message = error instanceof Error ? error.message : "Failed to create a task"
    return NextResponse.json({ error: message }, { status: 400 })
  }
}

/**
 * Task Master's list. Grouped the way M24 requires -- BY WHOSE MOVE IT IS,
 * not by date: "Today" mixes your work with other people's, and the whole
 * question a PM asks is what is stuck on ME.
 *
 * needsYou   -- to_do / waiting: nothing will move without a person
 * running    -- in_progress
 * done       -- done
 * blocked    -- blocked, with the backend's own error text on each row,
 *               never an empty list and never a generic failure
 */
export async function GET(request: NextRequest) {
  const ctx = await requireAuthOrApiKey(request)
  if (ctx.response) return ctx.response
  if (!ctx.orgId) return NextResponse.json({ error: "No organisation on this account" }, { status: 400 })

  const roleErr = requireRoleOrScope(ctx, "member", "read")
  if (roleErr) return roleErr

  const url = new URL(request.url)
  const projectId = url.searchParams.get("projectId")
  const statusParam = url.searchParams.get("status")
  const requested = (statusParam ? statusParam.split(",") : [])
    .map((s) => s.trim())
    .filter((s): s is TaskStatus => (TASK_STATUSES as readonly string[]).includes(s))
  const limitRaw = Number(url.searchParams.get("limit") ?? "50")
  const limit = Number.isFinite(limitRaw) ? Math.min(Math.max(Math.trunc(limitRaw), 1), 200) : 50

  try {
    const rows = await withTenantContext({ orgId: ctx.orgId }, async (db) => {
      const conditions = [eq(pipelineTasks.orgId, ctx.orgId!)]
      if (projectId) conditions.push(eq(pipelineTasks.projectId, projectId))
      if (requested.length > 0) conditions.push(inArray(pipelineTasks.status, requested))
      return db
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
        .where(and(...conditions))
        .orderBy(desc(pipelineTasks.createdAt))
        .limit(limit)
    })

    // R67 B-01 (D-03): every row gains the STRUCTURED failure and the
    // function's HUMAN LABEL, so the client can render a sentence and a Fix
    // chain without parsing prose and without ever printing a function id.
    //   failure -- {code, missing, context, picker}, parsed from the column
    //              run-submission.ts now writes as JSON. null for a row
    //              written before this change (the client's own
    //              legacyToCode() covers those, so there is one legacy
    //              mapping in the programme, not two).
    //   label   -- "Record progress", never "record_work_progress".
    // `error` is still returned verbatim for backward compatibility; nothing
    // new should render it.
    const decorated = rows.map((r) => ({
      ...r,
      label: r.functionId ? functionLabel(r.functionId) : null,
      failure: parseFailure(r.error),
    }))
    const group = (statuses: TaskStatus[]) => decorated.filter((r) => statuses.includes(r.status as TaskStatus))

    return NextResponse.json({
      tasks: decorated,
      // LIVE COUNTS, so the user knows before clicking (M24's header tabs).
      counts: {
        needsYou: group(["to_do", "waiting"]).length,
        running: group(["in_progress"]).length,
        done: group(["done"]).length,
        blocked: group(["blocked"]).length,
        total: rows.length,
      },
      groups: {
        needsYou: group(["to_do", "waiting"]),
        running: group(["in_progress"]),
        done: group(["done"]),
        blocked: group(["blocked"]),
      },
    })
  } catch (error) {
    console.error("v1 projexa tasks GET error:", error)
    const message = error instanceof Error ? error.message : "Failed to read tasks"
    return NextResponse.json({ error: message }, { status: 400 })
  }
}
