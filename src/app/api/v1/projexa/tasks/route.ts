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
import { and, desc, eq, inArray, sql } from "drizzle-orm"
import { requireAuthOrApiKey, requireRoleOrScope } from "@/lib/supabase/auth-guard"
import { withTenantContext } from "@/lib/db/tenant-scoped"
import { pipelineTasks, submissions } from "@/lib/db/schema"
import { runSubmission, runDirectTask } from "@/lib/pipeline/run-submission"
import { NEEDS_YOU_STATUSES, nextTaskCursor, parseTaskCursor } from "@/lib/pipeline/task-cursor"
import { withRouteTiming } from "@/lib/route-timing"

const TASK_STATUSES = ["to_do", "in_progress", "waiting", "done", "blocked"] as const
type TaskStatus = (typeof TASK_STATUSES)[number]

// R67 F-26 (R-242): the leading sort key -- 1 for a row that needs the user, 0
// for everything else. Built once at module scope so the ORDER BY and the
// cursor predicate below can never express it two different ways, which would
// make a page boundary repeat or skip rows.
const NEEDS_YOU_RANK = sql`(case when ${pipelineTasks.status} in (${sql.join(
  NEEDS_YOU_STATUSES.map((s) => sql`${s}`),
  sql`, `
)}) then 1 else 0 end)`

// R67 F-28 (R-249): the exported handler is unchanged in shape -- both CI
// route guards read it with a regex -- and delegates to its original body so
// the response carries Server-Timing: app;dur=<ms> measured HERE. See
// src/lib/route-timing.ts for why the export is not rewritten instead.
export async function POST(...args: Parameters<typeof POST_impl>) {
  return withRouteTiming("POST", () => POST_impl(...args))
}

async function POST_impl(request: NextRequest) {
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
// R67 F-28 (R-249): the exported handler is unchanged in shape -- both CI
// route guards read it with a regex -- and delegates to its original body so
// the response carries Server-Timing: app;dur=<ms> measured HERE. See
// src/lib/route-timing.ts for why the export is not rewritten instead.
export async function GET(...args: Parameters<typeof GET_impl>) {
  return withRouteTiming("GET", () => GET_impl(...args))
}

async function GET_impl(request: NextRequest) {
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
  // R67 F-26 (R-242): a KEYSET page, not an offset one. Rows are minted while
  // the user reads, and an offset page 2 silently repeats or skips whatever
  // shifted underneath it. A cursor this server no longer understands is
  // ignored (parseTaskCursor returns null), so a stale bookmark starts from the
  // top rather than failing a read.
  const cursor = parseTaskCursor(url.searchParams.get("cursor"))

  try {
    const { rows, statusTotals } = await withTenantContext({ orgId: ctx.orgId }, async (db) => {
      // The predicate that defines the SET the user is looking at (org, and
      // optionally one project and one status filter). The cursor is NOT part
      // of it: a cursor names a position inside this set, not a smaller set.
      const setConditions = [eq(pipelineTasks.orgId, ctx.orgId!)]
      if (projectId) setConditions.push(eq(pipelineTasks.projectId, projectId))
      if (requested.length > 0) setConditions.push(inArray(pipelineTasks.status, requested))

      const conditions = [...setConditions]
      if (cursor) {
        // Strictly after the cursor's position in (rank DESC, created_at DESC,
        // id DESC). All three parts are needed: see task-cursor.ts.
        conditions.push(sql`(
          ${NEEDS_YOU_RANK} < ${cursor.rank}
          or (${NEEDS_YOU_RANK} = ${cursor.rank} and (
            ${pipelineTasks.createdAt} < ${cursor.createdAt}
            or (${pipelineTasks.createdAt} = ${cursor.createdAt} and ${pipelineTasks.id} < ${cursor.id})
          ))
        )`)
      }
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
        // M24 orders Task Master by WHOSE MOVE IT IS first and only then by
        // recency: with limit=20 a plain created_at DESC would fill the page
        // with the newest completed rows and push what is stuck on the user off
        // the bottom, which is the one thing the pane exists to prevent.
        .orderBy(sql`${NEEDS_YOU_RANK} desc`, desc(pipelineTasks.createdAt), desc(pipelineTasks.id))
        .limit(limit)

      // R67 F-26 FIX: the header tabs count the SET, not the page. Before
      // paging existed the two were the same thing (limit=50 over a pane that
      // showed all 50), so counting rows.filter(...) was honest. With
      // limit=20 it is not: a user with 34 open tasks would read "Home 20",
      // and after "Show 20 more" the pane would show 40 rows above tabs still
      // reading 20. One extra grouped aggregate over the same predicate,
      // inside the same transaction, keeps the tabs true at any page size.
      const totals = await db
        .select({ status: pipelineTasks.status, n: sql<number>`count(*)::int` })
        .from(pipelineTasks)
        .where(and(...setConditions))
        .groupBy(pipelineTasks.status)

      return { rows: page, statusTotals: totals }
    })

    const group = (statuses: TaskStatus[]) => rows.filter((r) => statuses.includes(r.status as TaskStatus))
    const total = (statuses: TaskStatus[]) =>
      statusTotals.reduce((sum, t) => (statuses.includes(t.status as TaskStatus) ? sum + Number(t.n) : sum), 0)

    return NextResponse.json({
      tasks: rows,
      // null when this page is the last one -- so the UI never renders a
      // "Show 20 more" control that would load nothing.
      nextCursor: nextTaskCursor(rows, limit),
      // LIVE COUNTS over the whole set (M24's header tabs), independent of how
      // many pages the client has pulled. `groups` below stays page-scoped --
      // it carries the rows actually being rendered.
      counts: {
        needsYou: total(["to_do", "waiting"]),
        running: total(["in_progress"]),
        done: total(["done"]),
        blocked: total(["blocked"]),
        total: statusTotals.reduce((sum, t) => sum + Number(t.n), 0),
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
