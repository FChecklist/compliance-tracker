import { NextRequest, NextResponse, after } from "next/server"
import { requireAuthOrApiKey, requireRoleOrScope, requireActingPerson } from "@/lib/supabase/auth-guard"
import { createProject, ServiceError } from "@/lib/services/construction-dashboard-service"
import { createBoq } from "@/lib/services/construction-boq-service"
import {
  createDbProjectSourceLedger,
  createEdgeExtractCaller,
  getProjectSourceJob,
  listOpenExtractionJobs,
  runExtractionJob,
  startExtractionJob,
  type CreateFromDocumentDeps,
  type CreateFromDocumentInput,
  type CreateFromDocumentResult,
} from "@/lib/services/document-extraction-service"
import { loadEmailJobFile } from "@/lib/services/email-attachment-intake"
import { ExtractionRejectedError, MAX_REQUEST_BODY_BYTES, ProjectCreatedUnlinkedError, ProjectCreatedWithoutBoqError, WORKBOOK_LIMITS } from "@/lib/services/document-extraction-schema"

// PROJEXA-BUILD-001 U-37 (PMD-03, register rows BR-507 and BR-508): create a project and its BOQ from an uploaded xlsx workbook.
//
// multipart/form-data: `file` (the .xlsx workbook, at most 5 MB), `productId` (the product the project belongs to, as for the plain
// project-create route), optional `name` (replaces the project name the extraction found). BUILD-002 WP-02 adds three optional
// fields and one query parameter:
//   acknowledgeQuestions=true   the person has seen the open questions and wants the project created without those lines
//   acknowledgeShortfall=true   the person has seen that the lines add up to less than the file prints and wants the BOQ as it is
//                               (never covers a total that is too high)
//   mode=prepare                read and check the file and stop (state ready or needs_answers); the default creates
//   ?async=1                    answer 202 as soon as the file is claimed and run the job after the response
//
// BUILD-002 WP-12 (way 4, email): an inbound email with a workbook attached leaves a prepared job on the same ledger (origin email,
// state ready or needs_answers, nothing created). GET ?open=1 lists every job of the organisation that waits for a person, from an
// upload in prepare mode or from an email, with a JobView each (origin, via, questions, reconciliation) and the approve action. A person
// approves an emailed job by posting `jobId` and `productId` (and acknowledgeQuestions=true when the job has questions and the person
// wants the project without those lines) instead of a file: the file is read from the stored attachment the job names, never from the
// request, and the parked job is finished from what it stored with no second model call.
//
// The ledger row of the file is the JOB RECORD, with the state received, reading, needs_answers, ready, created or rejected
// (document-extraction-service.ts, ledger notes). A job with open questions waits in needs_answers; a second submit of the same file
// finishes it with no second model call. GET ?jobId=<id> (the id a 202 or a 200 pending answer returned) or ?sha256=<hex> reads a job.
//
//   201 {duplicate:false, state:"created", projectId, project, boq, extraction:{sheets,rows,lines}, questions, reconciliation}
//                                                                                     a project and BOQ were created
//   200 {duplicate:false, state:"needs_answers"|"ready", jobId, questions, reconciliation, extraction}
//                                                                                     nothing was created: the job waits for a person
//                                                                                     (or for the create call, in mode prepare)
//   202 {state, jobId}                                                                with ?async=1: the job runs after this answer; read it
//                                                                                     with GET (state received, then the states above)
//   200 {duplicate:true, projectId}                                                   this exact file was submitted before: the FIRST
//                                                                                     project is returned and nothing is inserted
//   429 {error, code:"extraction_rate_limited"} + Retry-After                         the organisation started too many extractions in the
//                                                                                     last hour (LEDGER_RATE_LIMIT); nothing was created
//   4xx/5xx {error, code, issues?}                                                    a refusal with a stable code; nothing was created
//                                                                                     (500 boq_create_failed carries the projectId of the
//                                                                                     project that does exist, see ProjectCreatedWithoutBoqError;
//                                                                                     500 project_link_failed does the same when recording the
//                                                                                     project against the upload failed, see
//                                                                                     ProjectCreatedUnlinkedError)
//
// Everything that reads the file, calls the model and checks its answer is in document-extraction-service.ts; this route is
// transport. It reuses createProject() and createBoq() and adds no insert of its own. The model call is made by the Supabase Edge
// Function projexa-document-extract (E-13), never here. Auth and role are those of the sibling project-create route (member,
// write scope, an acting person named for an API key). A project-scoped (project_ai) key is refused: it is held to its own project
// and this route creates a new one.
//
// Not done here: the sibling route's 60 s project-picker cache is private to that file, so a project created here appears in the
// picker within a minute instead of at once. createBoq() clears the dashboard cache itself.

// The route waits for the Edge Function, whose own model timeout is 100 s (handler.ts DEFAULT_LIMITS) and whose caller gives up
// after 110 s (createEdgeExtractCaller), so the default platform limit is too short for a real extraction.
export const maxDuration = 150

/**
 * The request body, read only up to MAX_REQUEST_BODY_BYTES. formData() holds the whole body in memory before the file's own size
 * can be checked, so this route reads the stream itself and stops at the ceiling; a declared Content-Length over the ceiling is
 * refused before any byte is read. Returns null when the body is over the ceiling.
 */
async function readBodyWithinLimit(request: NextRequest): Promise<Uint8Array<ArrayBuffer> | null> {
  const declared = Number(request.headers.get("content-length"))
  if (Number.isFinite(declared) && declared > MAX_REQUEST_BODY_BYTES) return null
  if (!request.body) return new Uint8Array(0)
  const reader = request.body.getReader()
  const chunks: Uint8Array[] = []
  let total = 0
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    total += value.byteLength
    if (total > MAX_REQUEST_BODY_BYTES) {
      await reader.cancel().catch(() => undefined)
      return null
    }
    chunks.push(value)
  }
  const body = new Uint8Array(total)
  let offset = 0
  for (const chunk of chunks) {
    body.set(chunk, offset)
    offset += chunk.byteLength
  }
  return body
}

/** The options of an upload beyond the file and the product: a name, the mode and the two acknowledgements. Null when the mode is neither create nor prepare. */
function readOptions(form: FormData): Pick<CreateFromDocumentInput, "projectName" | "mode" | "acknowledgeQuestions" | "acknowledgeShortfall"> | null {
  const mode = String(form.get("mode") ?? "create").trim()
  if (mode !== "create" && mode !== "prepare") return null
  return {
    projectName: String(form.get("name") ?? "").trim() || undefined,
    mode,
    acknowledgeQuestions: String(form.get("acknowledgeQuestions") ?? "") === "true",
    acknowledgeShortfall: String(form.get("acknowledgeShortfall") ?? "") === "true",
  }
}

/**
 * The file to read: the uploaded one or, with a job id and no file (WP-12), the stored attachment of an emailed job of this organisation
 * that still waits. The bytes of an emailed job come from the row the job names, never from the request. 404 when there is no such job.
 */
async function readSource(
  file: FormDataEntryValue | null,
  emailJobId: string,
  ctx: { orgId: string; actorId: string },
): Promise<{ fileName: string; bytes: Uint8Array } | { response: NextResponse }> {
  if (file instanceof File) return { fileName: file.name || "upload.xlsx", bytes: new Uint8Array(await file.arrayBuffer()) }
  const emailed = await loadEmailJobFile(ctx, emailJobId)
  if (!emailed) return { response: NextResponse.json({ error: "No emailed proposal with that job id is waiting", code: "job_not_found" }, { status: 404 }) }
  return { fileName: emailed.fileName, bytes: emailed.bytes }
}

/** The multipart form of the request, or the 413 / 400 answer when the body is over the ceiling or is not multipart form data. */
async function readUploadForm(request: NextRequest): Promise<{ form: FormData } | { response: NextResponse }> {
  const body = await readBodyWithinLimit(request)
  if (!body) return { response: NextResponse.json({ error: "The request is larger than 5 MB", code: "workbook_too_large" }, { status: 413 }) }
  try {
    return { form: await new Response(body, { headers: { "content-type": request.headers.get("content-type") ?? "" } }).formData() }
  } catch {
    return { response: NextResponse.json({ error: "The request body is not multipart form data", code: "invalid_form" }, { status: 400 }) }
  }
}

type Answer = CreateFromDocumentResult<Awaited<ReturnType<typeof createProject>>, Awaited<ReturnType<typeof createBoq>>>

/** The HTTP answer for a finished run: the first project (200), a job that waits (200 with its state and questions), or a created project (201). */
function answerFor(result: Answer): NextResponse {
  if (result.duplicate) return NextResponse.json({ duplicate: true, projectId: result.projectId }, { status: 200 })
  if (result.pending) {
    return NextResponse.json(
      { duplicate: false, state: result.state, jobId: result.jobId, questions: result.questions, reconciliation: result.reconciliation, extraction: result.extraction },
      { status: 200 },
    )
  }
  return NextResponse.json(
    {
      duplicate: false,
      state: "created",
      projectId: result.projectId,
      project: result.project,
      boq: result.boq,
      extraction: result.extraction,
      questions: result.questions,
      reconciliation: result.reconciliation,
    },
    { status: 201 },
  )
}

export async function POST(request: NextRequest) {
  const ctx = await requireAuthOrApiKey(request)
  if (ctx.response) return ctx.response
  const roleErr = requireRoleOrScope(ctx, "member", "write")
  if (roleErr) return roleErr
  if (!ctx.orgId) return NextResponse.json({ error: "No organisation on this account" }, { status: 400 })
  if (ctx.apiKey?.keyKind === "project_ai") {
    return NextResponse.json({ error: "A project key is held to its own project and cannot create a new one", code: "project_key_not_allowed" }, { status: 403 })
  }
  const { acting, error: actingError } = await requireActingPerson(request, ctx)
  if (actingError) return actingError
  const orgId = ctx.orgId

  try {
    const upload = await readUploadForm(request)
    if ("response" in upload) return upload.response
    const form = upload.form
    const file = form.get("file")
    const emailJobId = String(form.get("jobId") ?? "").trim()
    if (!(file instanceof File) && !emailJobId) return NextResponse.json({ error: "No file provided", code: "no_file" }, { status: 400 })
    const productId = String(form.get("productId") ?? "").trim()
    if (!productId) return NextResponse.json({ error: "productId is required", code: "product_required" }, { status: 400 })
    if (file instanceof File && file.size > WORKBOOK_LIMITS.maxBytes) {
      return NextResponse.json({ error: "The file is larger than 5 MB", code: "workbook_too_large" }, { status: 413 })
    }
    const options = readOptions(form)
    if (!options) return NextResponse.json({ error: "mode must be create or prepare", code: "invalid_mode" }, { status: 400 })

    const source = await readSource(file, emailJobId, { orgId, actorId: acting.person.id })
    if ("response" in source) return source.response
    const { fileName, bytes } = source

    const input: CreateFromDocumentInput = {
      orgId,
      actorId: acting.person.id,
      productId,
      fileName,
      bytes,
      ...options,
    }
    const deps: CreateFromDocumentDeps<Awaited<ReturnType<typeof createProject>>, Awaited<ReturnType<typeof createBoq>>> = {
      callEdge: createEdgeExtractCaller({
        baseUrl: process.env.NEXT_PUBLIC_SUPABASE_URL,
        secret: process.env.PROJEXA_DOCUMENT_EXTRACT_SECRET,
      }),
      ledger: createDbProjectSourceLedger({ orgId, actorId: acting.person.id }),
      createProject,
      createBoq,
    }

    // The claim comes first in both modes: a duplicate, a file already being processed and an organisation over its limit are answered
    // here, before any work. With ?async=1 the answer is 202 as soon as the file is claimed and the job runs after the response.
    const start = await startExtractionJob(input, deps)
    if (start.kind === "duplicate") return NextResponse.json({ duplicate: true, projectId: start.projectId }, { status: 200 })
    if (new URL(request.url).searchParams.get("async") === "1") {
      after(async () => {
        try {
          await runExtractionJob(start, input, deps)
        } catch (error) {
          // The job's state is recorded (a refusal releases the claim with its reason; a created project stays linked). Only an
          // unexpected fault is worth a log line here.
          if (!(error instanceof ExtractionRejectedError)) console.error("v1 projexa project from document (async job):", error)
        }
      })
      return NextResponse.json({ state: start.kind === "resume" ? start.state : "received", jobId: start.claimId }, { status: 202 })
    }

    return answerFor(await runExtractionJob(start, input, deps))
  } catch (error) {
    return failureResponse(error)
  }
}

/**
 * Reads one extraction job of the caller's organisation: by `jobId` (the id a 202 or a pending answer returned) or by `sha256` (the
 * hash of the file). Answers the state, and for a job that waits its questions and reconciliation, for a created one its project,
 * for a refused one the code and the reason. The stored lines are not returned (the BOQ shows them once created). Same auth as POST.
 */
export async function GET(request: NextRequest) {
  const ctx = await requireAuthOrApiKey(request)
  if (ctx.response) return ctx.response
  const roleErr = requireRoleOrScope(ctx, "member", "read")
  if (roleErr) return roleErr
  if (!ctx.orgId) return NextResponse.json({ error: "No organisation on this account" }, { status: 400 })
  if (ctx.apiKey?.keyKind === "project_ai") {
    return NextResponse.json({ error: "A project key is held to its own project and cannot read an extraction job", code: "project_key_not_allowed" }, { status: 403 })
  }
  const { acting, error: actingError } = await requireActingPerson(request, ctx)
  if (actingError) return actingError

  try {
    const params = new URL(request.url).searchParams
    if (params.get("open") === "1") {
      const jobs = await listOpenExtractionJobs({ orgId: ctx.orgId, actorId: acting.person.id })
      return NextResponse.json(
        {
          count: jobs.length,
          jobs: jobs.map((job) => ({
            ...job,
            approve: { method: "POST", path: "/api/v1/projexa/projects/from-document", form: { jobId: job.jobId, productId: "<the product of the new project>" } },
          })),
        },
        { status: 200 },
      )
    }
    const jobId = (params.get("jobId") ?? "").trim()
    const sha256 = (params.get("sha256") ?? "").trim().toLowerCase()
    if (!jobId && !/^[0-9a-f]{64}$/.test(sha256)) {
      return NextResponse.json({ error: "Give jobId, or the 64-character sha256 of the file", code: "job_reference_required" }, { status: 400 })
    }
    const job = await getProjectSourceJob({ orgId: ctx.orgId, actorId: acting.person.id }, jobId ? { jobId } : { contentSha256: sha256 })
    if (!job) return NextResponse.json({ error: "No such extraction job", code: "job_not_found" }, { status: 404 })
    return NextResponse.json(job, { status: 200 })
  } catch (error) {
    return failureResponse(error)
  }
}

/** The answer for a refusal (nothing created) or for one of the two failures that leave a project behind (500, with its id). */
function failureResponse(error: unknown): NextResponse {
  if (error instanceof ExtractionRejectedError) {
    const headers = error.retryAfterSeconds ? { "Retry-After": String(error.retryAfterSeconds) } : undefined
    return NextResponse.json(
      { error: error.message, code: error.code, ...(error.issues.length > 0 ? { issues: error.issues } : {}) },
      { status: error.status, headers },
    )
  }
  if (error instanceof ProjectCreatedWithoutBoqError) {
    console.error("v1 projexa project from document: project created but the BOQ insert failed:", error.projectId, error.cause)
    return NextResponse.json({ error: error.message, code: "boq_create_failed", projectId: error.projectId }, { status: 500 })
  }
  if (error instanceof ProjectCreatedUnlinkedError) {
    console.error("v1 projexa project from document: project created but recording it against the upload failed:", error.projectId, error.cause)
    return NextResponse.json({ error: error.message, code: "project_link_failed", projectId: error.projectId }, { status: 500 })
  }
  if (error instanceof ServiceError) return NextResponse.json({ error: error.message }, { status: error.status })
  console.error("v1 projexa project from document error:", error)
  return NextResponse.json({ error: "Failed to create project from document" }, { status: 500 })
}
