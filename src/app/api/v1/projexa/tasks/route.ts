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
import { requireAuthOrApiKey, requireRoleOrScope, resolveActingUser } from "@/lib/supabase/auth-guard"
import { withTenantContext } from "@/lib/db/tenant-scoped"
import { pipelineTasks, submissions } from "@/lib/db/schema"
import { runSubmission, runDirectTask, proposeSubmission, submitForVerdict, confirmSubmission } from "@/lib/pipeline/run-submission"
import {
  failureFromRow,
  isStatementTimeoutMessage,
  parseFailure,
  pipelineFailure,
  revealsInternals,
} from "@/lib/pipeline/error-codes"
import { functionLabel } from "@/lib/pipeline/function-registry"
import { NEEDS_YOU_STATUSES, nextTaskCursor, parseTaskCursor } from "@/lib/pipeline/task-cursor"
import { resolveStatusFilter, tabCountsFrom, validFilterKeys } from "@/lib/pipeline/task-tabs"
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

/**
 * R67 C-03 -- THE IDENTITY BRIDGE (decision D-05).
 *
 * `actorId` below is `ctx.dbUser?.id ?? ctx.apiKey!.id`, and PROJEXA always
 * calls this with a per-ORG API key -- so for every real PROJEXA request it is
 * an api_keys.id. That is fine for pipeline_tasks (its user_id is not a users
 * FK) and fatally wrong for anything attributing a business row to a PERSON,
 * e.g. pms_time_entries.user_id, whose FK is hard.
 *
 * A session caller's own dbUser always wins. An API-key caller may send
 * actorEmail (the same convention /v1/projexa/timesheets already uses) and it
 * is resolved to a real, active, org-scoped compliance.users row.
 *
 * *** IT RETURNS NULL RATHER THAN REFUSING THE WHOLE REQUEST. *** Every
 * read-only function is unaffected by a missing actor, and the one executor
 * that needs a person refuses in its own words -- 400ing every submission on
 * a field most callers legitimately never send would be the wrong trade.
 */
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
  // R67 C-03 (D-05): the real person, when the caller identified one.
  const actorUserId = await resolveActorUserId(ctx, body)

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

    // R67 B-07 -- STEP TWO: CONFIRM. Only this branch executes a write that
    // came from typed input. The server re-derives the proposal from the
    // submission's own stored rawInput and refuses a functionId it did not
    // itself derive, so a submission id is a reference to what the user
    // actually said -- not a licence to run anything.
    if (body.confirm === true) {
      const submissionId = typeof body.submissionId === "string" ? body.submissionId.trim() : ""
      if (!submissionId) {
        return NextResponse.json({ error: "confirm needs submissionId" }, { status: 400 })
      }
      const outcome = await confirmSubmission({
        orgId: ctx.orgId,
        userId: actorId,
        submissionId,
        functionId: typeof body.functionId === "string" ? body.functionId.trim() : undefined,
        params: (body.params as Record<string, unknown>) ?? {},
        role: ctx.dbUser?.role ?? null,
        actorUserId,
      })
      if (outcome.ok) return NextResponse.json(outcome.result, { status: 201 })
      if (outcome.reason === "not_found") {
        return NextResponse.json({ error: "That submission is not on this account" }, { status: 404 })
      }
      if (outcome.reason === "needs_input") {
        // 200, not an error: the answer is a question, and nothing was minted.
        return NextResponse.json(outcome.verdict, { status: 200 })
      }
      return NextResponse.json({ failure: outcome.failure }, { status: 409 })
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
        actorUserId,
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

    // R67 B-07 -- STEP ONE: THE VERDICT. The typed path no longer resolves
    // and executes in one shot. It answers with what was understood, what is
    // still missing (with real choices for it) and a submissionId to confirm
    // against -- and it mints NO pipeline_tasks row, which is what stops an
    // unanswered question being recorded as blocked work and counted in the
    // Home badge.
    //
    // The old resolve-all-then-execute-all behaviour is still reachable, and
    // still the right answer for the two callers that are not a person
    // watching a composer: {execute:true} here, and the assistant/submissions
    // routes, which call runSubmission() directly and are untouched.
    if (body.execute === true) {
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
    }

    const verdict = await submitForVerdict({
      orgId: ctx.orgId,
      userId: actorId,
      mode,
      projectId,
      selectedChain: body.selectedChain,
      rawInput,
      role: ctx.dbUser?.role ?? null,
    })
    // 200, not 201: a verdict creates no task.
    return NextResponse.json(verdict, { status: 200 })
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
 * blocked    -- blocked, carrying the STRUCTURED failure (B-01/B-08) on each
 *               row, never an empty list and never a generic failure
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
  // R67 C-11 -- A TAB ASKS FOR ITS OWN ROWS.
  //
  // `status` still accepts the raw five (every existing caller sends those and
  // is unchanged), and now ALSO accepts PROJEXA's own tab vocabulary --
  // needs_you|waiting|approval|queued|done -- which the raw statuses cannot
  // express: "Approval Pending" is three of them, "In Queue" is one. Before
  // this the pane asked for fifty rows of everything on every navigation and
  // filtered them in the browser.
  const statusParam = url.searchParams.get("status")
  const filter = resolveStatusFilter(statusParam)
  // A FILTER THAT MATCHED NOTHING IS A 400, NOT AN UNFILTERED LIST. Returning
  // every row for a misspelled tab looks like it worked and is how a filter
  // bug hides for a release.
  if (statusParam && filter.statuses.length === 0) {
    return NextResponse.json(
      { error: `Unknown status filter: ${filter.unknown.join(", ")}. Valid values: ${validFilterKeys().join(", ")}` },
      { status: 400 }
    )
  }
  const requested = filter.statuses as TaskStatus[]
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
      // R67 C-11: the org/project scope WITHOUT the status filter -- see the
      // tabTotals aggregate below for why the two are different questions.
      const scopeConditions = [eq(pipelineTasks.orgId, ctx.orgId!)]
      if (projectId) scopeConditions.push(eq(pipelineTasks.projectId, projectId))

      const setConditions = [...scopeConditions]
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
          // R67 B-08 (drizzle/0533): the typed failure, in its own columns.
          errorCode: pipelineTasks.errorCode,
          errorParams: pipelineTasks.errorParams,
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
      // reading 20. One grouped aggregate, inside the same transaction, keeps
      // the tabs true at any page size.
      //
      // R67 C-11, FIX PASS -- TWO CHANGES TO F-26'S AGGREGATE, BOTH DELIBERATE
      // AND NEITHER OF THEM A SECOND QUERY.
      //
      // (a) IT NOW GROUPS BY error_code AS WELL. "How many of these blocked
      //     rows are infrastructure" cannot be recovered later from a count
      //     that already threw the code away, and it is what `systemBlocked`
      //     reports.
      //
      // (b) IT COUNTS THE ORG/PROJECT SCOPE, NOT THE STATUS-FILTERED SET.
      //     C-11 lets a tab ask the server for its own rows; the moment it
      //     does, an aggregate over the filtered predicate would report 0 for
      //     every tab the user is NOT on -- so selecting "Completed" would
      //     blank the Home badge. A header badge exists precisely to say what
      //     is behind a tab you have not clicked, which is F-26's own stated
      //     intent ("so the user knows before clicking").
      //
      //     For every request that sends no status filter -- which is every
      //     caller before C-11, and every F-26 test -- setConditions and
      //     scopeConditions are the same predicate and the four legacy numbers
      //     are byte-identical. The change is visible only to a caller that
      //     filters, and for that caller it is the correct number rather than
      //     a zero.
      const totals = await db
        .select({
          status: pipelineTasks.status,
          errorCode: pipelineTasks.errorCode,
          n: sql<number>`count(*)::int`,
        })
        .from(pipelineTasks)
        .where(and(...scopeConditions))
        .groupBy(pipelineTasks.status, pipelineTasks.errorCode)

      return { rows: page, statusTotals: totals }
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
    //
    // R67 FIX PASS -- `error` IS NO LONGER RETURNED. It used to be spread
    // through verbatim "for backward compatibility", which meant every row
    // written before B-01 still shipped its original prose to every browser,
    // the R66 driver string "write CONNECT_TIMEOUT 3.109.171.244:6543"
    // included. B-01's own rule is that the raw text lives only in a `debug`
    // field this route never selects, and a column nothing renders is still a
    // payload somebody can read. What replaces it:
    //   * a legacy string that DISCLOSES INTERNALS (a driver errno or a
    //     host:port) is converted here into a real closed-vocabulary failure
    //     -- the same two predicates normaliseThrownError() uses, so there is
    //     no second classifier -- and the text itself is dropped;
    //   * any other legacy string travels as `legacyError`, which projexa's
    //     own legacyToCode() maps back into the dictionary. That keeps ONE
    //     legacy prose mapping in the programme, in the repo that owns the
    //     wording, exactly as B-10 decided.
    //
    // R67 B-08: the typed columns win when they are populated; the serialised
    // `error` object is the fallback for a row written between B-01 and the
    // 0528 migration. A row older than B-01 holds real English and yields
    // null here -- the client's own legacyToCode() maps those, so the
    // programme has ONE legacy mapping rather than two that drift.
    // `missing` has no column of its own -- it is a Fix-chain hint, not
    // something anyone groups by -- so it is taken from the serialised object
    // and merged onto the typed code, which is the authority.
    //
    // R67 MERGE (lane B x lane F2): this decoration runs over the PAGE, which
    // is now a keyset page rather than the whole set. That is deliberate --
    // decorating rows nobody is rendering would be wasted work, and the
    // header counts below no longer come from these rows at all.
    const decorated = rows.map(({ error, ...row }) => {
      const parsed = parseFailure(error)
      const typed = failureFromRow(row.errorCode, row.errorParams)
      const structured = typed ? { ...typed, missing: parsed?.missing ?? [] } : parsed
      const legacy = !structured && typeof error === "string" && error.trim().length > 0 ? error.trim() : null
      const legacyFailure =
        legacy && isStatementTimeoutMessage(legacy)
          ? pipelineFailure("UPSTREAM_TIMEOUT")
          : legacy && revealsInternals(legacy)
            ? pipelineFailure("BACKEND_UNAVAILABLE")
            : null
      return {
        ...row,
        label: row.functionId ? functionLabel(row.functionId) : null,
        failure: structured ?? legacyFailure,
        /** Safe legacy prose only -- null once the row has any structured failure. */
        legacyError: legacyFailure ? null : legacy,
      }
    })

    const tabCounts = tabCountsFrom(statusTotals)
    const group = (statuses: TaskStatus[]) => decorated.filter((r) => statuses.includes(r.status as TaskStatus))
    const total = (statuses: TaskStatus[]) =>
      statusTotals.reduce((sum, t) => (statuses.includes(t.status as TaskStatus) ? sum + Number(t.n) : sum), 0)

    return NextResponse.json({
      tasks: decorated,
      // null when this page is the last one -- so the UI never renders a
      // "Show 20 more" control that would load nothing.
      nextCursor: nextTaskCursor(rows, limit),
      // LIVE COUNTS over the whole set (M24's header tabs), independent of how
      // many pages the client has pulled. `groups` below stays page-scoped --
      // it carries the rows actually being rendered.
      //
      // R67 MERGE: lane B computed these from the page (`group(...).length`),
      // which was exact while the route returned the entire set in one read.
      // Lane F2's paging made that untrue, and F2's grouped aggregate is how
      // B's stated intent -- "so the user knows before clicking" -- survives
      // paging. Same numbers as B for an unpaged read; correct ones after.
      counts: {
        needsYou: total(["to_do", "waiting"]),
        running: total(["in_progress"]),
        done: total(["done"]),
        blocked: total(["blocked"]),
        total: statusTotals.reduce((sum, t) => sum + Number(t.n), 0),
        // R67 C-11: one number per TAB, keyed by the same vocabulary `status`
        // accepts, from the UNFILTERED scope -- so selecting a tab does not
        // zero every other tab's badge. `systemBlocked` rides along because it
        // is the same grouped read.
        tabs: tabCounts.tabs,
        systemBlocked: tabCounts.systemBlocked,
      },
      /**
       * R67 C-11 -- WHICH FILTER THE SERVER ACTUALLY APPLIED.
       *
       * The client sends a tab key; the server resolves it to statuses. Saying
       * so back is what lets the pane assert that the rows it is rendering are
       * the rows it asked for, rather than assuming it.
       */
      filter: { tab: filter.tab, statuses: requested },
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
