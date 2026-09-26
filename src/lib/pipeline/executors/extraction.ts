// PROJEXA-BUILD-002 WP-02: the pipeline executor of create_project_from_document, a NEW project and its BOQ from a workbook the
// caller already stored as a document. It runs the same service the from-document route runs (createProjectFromDocument in
// document-extraction-service.ts): the deterministic reader first, the model only for what the reader cannot read, the reconciliation
// gate, questions as a state, one project and ONE BOQ. Nothing here reads a sheet, calls a model or opens a transaction of its own; it
// finds the stored bytes, checks who is asking, and turns the service's answer into the pipeline's outcome shape.
//
// NOT ON ANY PROJECT LINK. A link is bound to one project (user_ai_links_projexa_shape), and this function makes a project. So it has
// no row in the link registry: scripts/gen-ai-link-registry.data.ts names the functions a link may run, and this one is in neither
// LINK_FUNCTIONS nor a link. It is reached through the internal pipeline only, where a write is a proposal that a person confirms
// (level 2) before this executor runs, and where the person's role and the acting person's id are the task's own.
//
// WHO MAY RUN IT. The acting person must be identified (task.actorUserId, a real compliance.users id, the person the project is
// attributed to) and must be a member or above, the rank the from-document route asks (requireRoleOrScope "member"). The document
// must be a file of the task's organisation, not an external link, and no bigger than the workbook limit.
//
// WHAT COMES BACK. Created: the project and the BOQ the service made, with the BOQ's project-side cost fields left out as every BOQ
// write of this pipeline does (redactProjectSideFields). Waiting: when the extraction has open questions (or mode "prepare" was
// asked) nothing is created and the outcome is a SUCCESS whose result says pending, with the state, the job id, the questions and
// the reconciliation, so the person is asked instead of the workbook being guessed at. Refused: an ExtractionRejectedError is a
// REQUEST_REJECTED failure carrying its stable code in `reason`; a shortfall is answered by the caller sending acknowledgeShortfall.
//
// The executor is registered in executor.ts's EXECUTORS map by one import line; nothing else of executor.ts changes.
import { and, eq } from "drizzle-orm"
import { createClient } from "@supabase/supabase-js"
import { withTenantContext } from "@/lib/db/tenant-scoped"
import { documents } from "@/lib/db/schema"
import { createProject } from "@/lib/services/construction-dashboard-service"
import { createBoq } from "@/lib/services/construction-boq-service"
import { redactProjectSideFields } from "@/lib/services/cost-visibility-service"
import {
  createDbProjectSourceLedger,
  createEdgeExtractCaller,
  createProjectFromDocument,
  type CreateFromDocumentInput,
  type CreateFromDocumentResult,
} from "@/lib/services/document-extraction-service"
import { ExtractionRejectedError, ProjectCreatedUnlinkedError, ProjectCreatedWithoutBoqError, WORKBOOK_LIMITS } from "@/lib/services/document-extraction-schema"
import { ROLE_RANK, type UserRole } from "@/lib/supabase/role-rank"
import { pipelineFailure } from "../error-codes"
import { functionSpec, requiredParamSatisfied } from "../function-registry"
import type { ExecutableTask, ExecutionOutcome } from "../executor"

export const CREATE_PROJECT_FROM_DOCUMENT = "create_project_from_document"

const DOCUMENT_BUCKET = "compliance-documents"

/** The lowest role that may create a project from a file: the rank the from-document route asks. */
const MIN_ROLE_RANK = ROLE_RANK.member

type StoredWorkbook = { fileName: string; bytes: Uint8Array }

export type ExtractionExecutorDeps = {
  /** The stored document as bytes, or the reason it cannot be used. */
  readDocument(task: ExecutableTask, documentId: string): Promise<StoredWorkbook | "not_found" | "not_usable">
  /** createProjectFromDocument() wired to the real ledger, project and BOQ services. Injectable so a test needs no database. */
  run(input: CreateFromDocumentInput): Promise<CreateFromDocumentResult<{ id: string }, { id: string }>>
}

const str = (value: unknown): string | undefined => (typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined)

async function readStoredDocument(task: ExecutableTask, documentId: string): Promise<StoredWorkbook | "not_found" | "not_usable"> {
  const doc = await withTenantContext({ orgId: task.orgId, userId: task.userId }, (db) =>
    db.query.documents.findFirst({ where: and(eq(documents.id, documentId), eq(documents.orgId, task.orgId)) }),
  )
  if (!doc) return "not_found"
  const meta = (doc.metadata ?? {}) as { isExternalLink?: unknown }
  // A link-only record is an address, and the server does not fetch an address a caller supplies.
  if (meta.isExternalLink === true || (doc.fileSize ?? 0) > WORKBOOK_LIMITS.maxBytes) return "not_usable"
  const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!)
  const { data, error } = await admin.storage.from(DOCUMENT_BUCKET).download(doc.fileUrl)
  if (error || !data) throw new Error("Failed to read the document from storage")
  return { fileName: doc.name, bytes: new Uint8Array(await data.arrayBuffer()) }
}

const defaultDeps: ExtractionExecutorDeps = {
  readDocument: readStoredDocument,
  run: (input) =>
    createProjectFromDocument(input, {
      callEdge: createEdgeExtractCaller({ baseUrl: process.env.NEXT_PUBLIC_SUPABASE_URL, secret: process.env.PROJEXA_DOCUMENT_EXTRACT_SECRET }),
      ledger: createDbProjectSourceLedger({ orgId: input.orgId, actorId: input.actorId }),
      createProject,
      createBoq,
    }),
}

function refuse(failure: ReturnType<typeof pipelineFailure>): ExecutionOutcome {
  return { success: false, failure }
}

/** What the service answered, as the pipeline's outcome: the first project (duplicate), a job that waits (pending), or a created project and BOQ. */
function outcomeOf(result: CreateFromDocumentResult<{ id: string }, { id: string }>): ExecutionOutcome {
  if (result.duplicate) {
    return { success: true, result: { id: result.projectId, route: `/projects/${result.projectId}`, record: { duplicate: true, projectId: result.projectId } } }
  }
  if (result.pending) {
    return {
      success: true,
      result: { pending: true, state: result.state, jobId: result.jobId, questions: result.questions, reconciliation: result.reconciliation, extraction: result.extraction },
    }
  }
  return {
    success: true,
    result: {
      id: result.projectId,
      route: `/projects/${result.projectId}`,
      record: redactProjectSideFields({ project: result.project, boq: result.boq, extraction: result.extraction, questions: result.questions, reconciliation: result.reconciliation }),
    },
  }
}

/** A refusal of the service, or one of the two faults that leave a project behind, as an outcome; null for any other error. */
function outcomeFromFault(error: unknown, functionId: string): ExecutionOutcome | null {
  if (error instanceof ExtractionRejectedError) {
    return refuse(pipelineFailure("REQUEST_REJECTED", [], { status: error.status, functionId, reason: error.code }))
  }
  // The outcome names the project a fault left behind, so the person is not left with a half-built project they cannot find.
  if (error instanceof ProjectCreatedWithoutBoqError || error instanceof ProjectCreatedUnlinkedError) {
    const reason = error instanceof ProjectCreatedWithoutBoqError ? "boq_create_failed" : "project_link_failed"
    return { success: false, failure: pipelineFailure("INTERNAL_ERROR", [], { functionId, projectId: error.projectId, reason }), debug: error.message }
  }
  return null
}

export async function executeCreateProjectFromDocument(task: ExecutableTask, deps: ExtractionExecutorDeps = defaultDeps): Promise<ExecutionOutcome> {
  // The registry's own required parameters first, in its own vocabulary.
  const spec = functionSpec(CREATE_PROJECT_FROM_DOCUMENT)
  for (const required of spec?.requiredParams ?? []) {
    if (!requiredParamSatisfied(required, task.params, undefined)) return refuse(pipelineFailure(required.code, [required.field ?? required.name]))
  }
  const documentId = str(task.params.documentId)!
  const productId = str(task.params.productId)!

  // The person the project is attributed to: never the api key's own id.
  if (!task.actorUserId) return refuse(pipelineFailure("NOT_PERMITTED", [], { reason: "unidentified_actor" }))
  if ((ROLE_RANK[(task.role ?? "") as UserRole] ?? 0) < MIN_ROLE_RANK) return refuse(pipelineFailure("NOT_PERMITTED", [], { reason: "role" }))

  const stored = await deps.readDocument(task, documentId)
  if (stored === "not_found") return refuse(pipelineFailure("RECORD_NOT_FOUND", [], { status: 404, functionId: task.functionId }))
  if (stored === "not_usable") return refuse(pipelineFailure("REQUEST_REJECTED", [], { status: 400, functionId: task.functionId }))

  const mode = str(task.params.mode)
  try {
    const result = await deps.run({
      orgId: task.orgId,
      actorId: task.actorUserId,
      productId,
      fileName: stored.fileName,
      bytes: stored.bytes,
      projectName: str(task.params.name),
      // Only a real boolean true acknowledges: a string "true" from a model does not lift a check that exists to stop a wrong BOQ.
      acknowledgeQuestions: task.params.acknowledgeQuestions === true,
      acknowledgeShortfall: task.params.acknowledgeShortfall === true,
      mode: mode === "prepare" ? "prepare" : "create",
    })
    return outcomeOf(result)
  } catch (error) {
    const known = outcomeFromFault(error, task.functionId)
    if (known) return known
    throw error
  }
}
