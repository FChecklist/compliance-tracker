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
import { and, count, desc, eq, inArray } from "drizzle-orm"
import { requireAuthOrApiKey, requireRoleOrScope, resolveActingUser } from "@/lib/supabase/auth-guard"
import { withTenantContext } from "@/lib/db/tenant-scoped"
import { pipelineTasks, submissions } from "@/lib/db/schema"
import { runSubmission, runDirectTask } from "@/lib/pipeline/run-submission"
import { missingSlots } from "@/lib/pipeline/function-slots"
import { resolveStatusFilter, tabCountsFrom, type PipelineStatus } from "@/lib/pipeline/task-tabs"

type TaskStatus = PipelineStatus

/**
 * The POST body's own fields, narrowed once. Kept out of the handler so the
 * handler reads as the decision it makes -- pill path or typed path -- rather
 * than as a dozen type guards with a decision buried in them.
 */
function readSubmissionBody(body: Record<string, unknown>) {
  const functionId = typeof body.functionId === "string" ? body.functionId.trim() : ""
  return {
    mode: typeof body.mode === "string" ? body.mode : "Projects",
    projectId: typeof body.projectId === "string" ? body.projectId : null,
    functionId,
    params: (body.params as Record<string, unknown> | undefined) ?? {},
    note: typeof body.rawInput === "string" ? body.rawInput : undefined,
    rawInput: typeof body.rawInput === "string" ? body.rawInput : "",
  }
}

// R67 C-03 (decision D-05) -- THE IDENTITY BRIDGE, RESOLVED ONCE PER
// SUBMISSION AND NEVER FABRICATED.
//
// POST's own `actorId` is `ctx.dbUser?.id ?? ctx.apiKey!.id`, and PROJEXA
// always calls this with a per-ORG API key -- so for every real PROJEXA
// request it is an api_keys.id. That is fine for pipeline_tasks (its user_id
// is not a users FK) and fatally wrong for anything attributing a business
// row to a PERSON, e.g. pms_time_entries.user_id, whose FK is hard.
//
// A session caller's own dbUser always wins. An API-key caller may send
// actorEmail (the same convention /v1/projexa/timesheets already uses) and it
// is resolved to a real, active, org-scoped compliance.users row.
//
// *** IT RETURNS NULL RATHER THAN REFUSING THE WHOLE REQUEST. *** Every
// read-only function is unaffected by a missing actor, and the one executor
// that needs a person refuses in its own words -- 400ing every submission on
// a field most callers legitimately never send would be the wrong trade.
async function resolveActorUserId(
  ctx: Parameters<typeof resolveActingUser>[0],
  body: Record<string, unknown>
): Promise<string | null> {
  if (ctx.dbUser?.id) return ctx.dbUser.id
  const actorEmail = typeof body.actorEmail === "string" ? body.actorEmail.trim() : ""
  if (!actorEmail) return null
  const { user } = await resolveActingUser(ctx, actorEmail)
  return user?.id ?? null
}

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

  const { mode, projectId, functionId, params, note, rawInput } = readSubmissionBody(body)
  const actorUserId = await resolveActorUserId(ctx, body)

  try {
    if (functionId.length > 0) {
      const result = await runDirectTask({
        orgId: ctx.orgId,
        userId: actorId,
        mode,
        projectId,
        functionId,
        params,
        note,
        role: ctx.dbUser?.role ?? null,
        actorUserId,
      })
      return NextResponse.json(result, { status: 201 })
    }

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
      actorUserId,
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
 *
 * R67 C-11 -- TWO CHANGES, BOTH ABOUT THE NUMBER ON A TAB.
 *
 * 1. `status` now also accepts the TAB vocabulary (needs_you | waiting |
 *    approval | queued | done), resolved in src/lib/pipeline/task-tabs.ts, so
 *    the pane can ask for one tab's rows instead of pulling fifty rows of
 *    everything on every navigation and filtering them in the browser. The raw
 *    statuses every existing caller sends still work, unchanged.
 *
 * 2. `counts` comes from a GROUPED COUNT over the whole scope, not from
 *    `rows.filter(...).length` over a page capped at `limit`. The old numbers
 *    were true only while an org had fewer than fifty tasks, and silently
 *    wrong after that -- and "Completed (50)" beside a list of 50 rows looks
 *    exactly like a correct answer.
 */
export async function GET(request: NextRequest) {
  const ctx = await requireAuthOrApiKey(request)
  if (ctx.response) return ctx.response
  if (!ctx.orgId) return NextResponse.json({ error: "No organisation on this account" }, { status: 400 })

  const roleErr = requireRoleOrScope(ctx, "member", "read")
  if (roleErr) return roleErr

  const url = new URL(request.url)
  const projectId = url.searchParams.get("projectId")
  const filter = resolveStatusFilter(url.searchParams.get("status"))
  const limitRaw = Number(url.searchParams.get("limit") ?? "50")
  const limit = Number.isFinite(limitRaw) ? Math.min(Math.max(Math.trunc(limitRaw), 1), 200) : 50

  // A FILTER THAT MATCHED NOTHING IS A 400, NOT AN EMPTY LIST. Returning every
  // row for `?status=needs-you` (a real misspelling of a real key) would look
  // like the filter worked and be impossible to notice.
  if (filter.unknown.length > 0 && filter.statuses.length === 0) {
    return NextResponse.json(
      { error: `Unknown status filter: ${filter.unknown.join(", ")}. Use needs_you, waiting, approval, queued or done.` },
      { status: 400 }
    )
  }

  try {
    const { rows, countRows } = await withTenantContext({ orgId: ctx.orgId }, async (db) => {
      // The SCOPE both queries share. The status filter narrows the page only:
      // the counts must be over every status or a tab could never show the
      // number for a tab that is not open.
      const scope = [eq(pipelineTasks.orgId, ctx.orgId!)]
      if (projectId) scope.push(eq(pipelineTasks.projectId, projectId))

      const conditions = [...scope]
      if (filter.statuses.length > 0) conditions.push(inArray(pipelineTasks.status, filter.statuses))

      const page = await db
        .select({
          id: pipelineTasks.id,
          submissionId: pipelineTasks.submissionId,
          sequence: pipelineTasks.sequence,
          dependsOn: pipelineTasks.dependsOn,
          projectId: pipelineTasks.projectId,
          derivedChain: pipelineTasks.derivedChain,
          functionId: pipelineTasks.functionId,
          params: pipelineTasks.params,
          result: pipelineTasks.result,
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

      // ONE grouped count, five rows back at most -- not a second full read.
      const grouped = await db
        .select({ status: pipelineTasks.status, n: count() })
        .from(pipelineTasks)
        .where(and(...scope))
        .groupBy(pipelineTasks.status)

      return { rows: page, countRows: grouped }
    })

    // R67 C-11 / D-03: the SLOTS a blocked row is short, computed from the
    // function's own declaration rather than parsed out of its error string.
    // This is the `missing` half of the { code, missing } payload PROJEXA's
    // task-errors.ts already reads; before it, the client had to infer the
    // question from the backend's wording.
    const tasks = rows.map((r) => ({
      ...r,
      missing: r.functionId ? missingSlots(r.functionId, (r.params ?? {}) as Record<string, unknown>) : [],
    }))

    const group = (statuses: TaskStatus[]) => tasks.filter((r) => statuses.includes(r.status as TaskStatus))
    const counts = tabCountsFrom(countRows)

    return NextResponse.json({
      tasks,
      // LIVE COUNTS, so the user knows before clicking (M24's header tabs) --
      // over the whole scope, so they stay true past the page limit.
      counts,
      // Whether this page is all of what the filter matched. A client that
      // prints a count beside a list needs to know which of the two it is
      // showing; guessing from `rows.length === limit` is a guess.
      page: {
        limit,
        returned: tasks.length,
        truncated: tasks.length >= limit,
        status: filter.tab ?? (filter.statuses.length > 0 ? filter.statuses.join(",") : null),
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
