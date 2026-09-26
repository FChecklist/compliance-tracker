// PROJEXA-BUILD-002 WP-11 (register row AW-602, way 2): a chat message that carries an uploaded workbook. The internal AI (Levels 0
// and 1, ours, metered) turns it into a project through the ONE function that does that, create_project_from_document
// (executors/extraction.ts), and reports what it found back in the chat, questions included.
//
// WHAT THE WORDS DO NOT DO. The function is chosen by the ATTACHMENT, not by what the message says: a message with a workbook
// attached is create_project_from_document, decided in code (Level 0), and the sentence typed with it is kept for the record and never
// read as an instruction. No model is asked which function to run, and no model output can change the function or its parameters: the
// parameters below come from the request body's own fields (documentId, productId, name, and three booleans), never from text.
//
// LEVEL 2 = A PROPOSAL A PERSON CONFIRMS. A workbook becomes a project with a money baseline, so it is a write the pipeline treats as
// a proposal. Two stages, both through the same executor:
//   propose  mode "prepare": the file is read, the model runs (metered), the extraction is checked and reconciled, and the job PARKS in
//            the ledger as needs_answers (open questions) or ready. Nothing is created. The reply carries the questions and the
//            reconciliation, in words.
//   confirm  mode "create": only when the request says confirm:true. The same file (same sha256 job key) finishes from the parked job
//            with no second model call, and the project and its ONE BOQ are created, attributed to the acting person. A job that
//            still has open questions answers with them again unless the person acknowledges them (a boolean, never a sentence).
//
// WHO. The acting PERSON must be identified (never an API key's id) and be a member or above; a project-scoped key may not run this
// (the route refuses before this file). Both gates run BEFORE the file is read and before any model call, and the executor repeats
// them. The internal AI's provider is chosen by internal-ai-policy.ts and every model call is written to the usage ledger by
// internal-model-gateway.ts; a request the policy refuses is answered in a fixed sentence and reads nothing.
//
// THE JOB KEY. The ledger keys a job by organisation and the file's sha256 (document-extraction-service.ts). The document is read
// from storage by id, its bytes are hashed here, and a caller that sends the sha256 it saw (attachment.sha256) is refused when the
// stored file is not that file, so a swapped document can never inherit a parked job. The reply carries the sha256 as jobKey.
//
// Transactions. This file opens none. It calls the executor, which opens its own short transactions one after another (the read of the
// document, then the ledger and the services inside the service), and the model gateway writes its ledger row on the platform client.
// Call it from a route that holds no withTenantContext block: a caller that already holds one must not call it (assertNotNested).
import { createHash } from "node:crypto"
import { executeCreateProjectFromDocument, extractionDepsWith, type ExtractionExecutorDeps } from "./executors/extraction"
import { functionSpec, requiredParamSatisfied } from "./function-registry"
import { pipelineFailure, type PipelineFailure } from "./error-codes"
import { financialsAllowedForRole } from "@/lib/task-execution/construction-tools"
import { ROLE_RANK, type UserRole } from "@/lib/supabase/role-rank"
import { refusalSentence, resolveInternalAiRoute, type InternalAiRoute } from "@/lib/ai/internal-ai-policy"
import { createInternalExtractCaller, modelCallForRoute } from "@/lib/ai/internal-model-gateway"
import type { ExecutableTask, ExecutionOutcome } from "./executor"

export const CHAT_ATTACHMENT_FUNCTION = "create_project_from_document" as const

export type ChatAttachment = { documentId: string; sha256: string | null }

const DOCUMENT_ID = /^[A-Za-z0-9_-]{1,100}$/
const SHA256 = /^[0-9a-f]{64}$/

/** The `attachment` field of a chat request body: a stored document's id, and optionally the sha256 the sender saw. */
export function parseChatAttachment(raw: unknown): { ok: true; attachment: ChatAttachment } | { ok: false } {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return { ok: false }
  const { documentId, sha256 } = raw as Record<string, unknown>
  if (typeof documentId !== "string" || !DOCUMENT_ID.test(documentId)) return { ok: false }
  if (sha256 !== undefined && sha256 !== null && (typeof sha256 !== "string" || !SHA256.test(sha256.toLowerCase()))) return { ok: false }
  return { ok: true, attachment: { documentId, sha256: typeof sha256 === "string" ? sha256.toLowerCase() : null } }
}

export type ChatAttachmentInput = {
  orgId: string
  /** The credential's own id (an API key's, or the session user's): the task's userId, never used as the acting person. */
  keyUserId: string
  /** The acting person's compliance.users id, or null when none resolved. */
  personId: string | null
  role: string | null
  /** The sentence typed with the file. Kept for the record; it never chooses the function or a parameter. */
  rawInput: string
  attachment: ChatAttachment
  productId: string | null
  projectName: string | null
  confirm: boolean
  acknowledgeQuestions: boolean
  acknowledgeShortfall: boolean
}

export type ChatQuestion = { kind: string; sheet: string; row: number; text: string }

export type ChatAttachmentStatus = "needs_answers" | "ready" | "created" | "duplicate" | "needs_input" | "refused"

export type ChatAttachmentReply = {
  functionId: typeof CHAT_ATTACHMENT_FUNCTION
  /** Level 2: a write that a signed-in person confirms. */
  level: 2
  stage: "propose" | "confirm"
  status: ChatAttachmentStatus
  /** What the assistant says, in words: fixed sentences and the file's own questions, never model prose. */
  chatMessages: string[]
  questions: ChatQuestion[]
  /** The reconciliation: its status always, its figures only for a role that may see money. */
  reconciliation: Record<string, unknown> | null
  /** What confirming would run. Null once nothing is left to confirm. */
  proposal: { functionId: typeof CHAT_ATTACHMENT_FUNCTION; params: Record<string, unknown>; requiresConfirmation: true } | null
  jobId: string | null
  /** The file's sha256, the ledger's job key. Null when the file was not read. */
  jobKey: string | null
  projectId: string | null
  route: string | null
  missing: string[]
  failure: PipelineFailure | null
  modelCalls: number
  /** "metered" (re-billed to the customer) or "owner_subscription" (the owner's own test); null when no model was reachable. */
  billing: "metered" | "owner_subscription" | null
}

export type ChatAttachmentDeps = {
  resolveRoute?: (personId: string | null) => InternalAiRoute
  /** The executor's deps around the chosen route's metered model caller; the caller's model calls are counted through `modelCalls`. */
  buildExecutorDeps?: (route: Extract<InternalAiRoute, { allowed: true }>, input: ChatAttachmentInput) => { deps: ExtractionExecutorDeps; modelCalls: () => number }
}

function defaultBuildExecutorDeps(route: Extract<InternalAiRoute, { allowed: true }>, input: ChatAttachmentInput) {
  const caller = createInternalExtractCaller({ route, orgId: input.orgId, personId: input.personId!, model: modelCallForRoute(route) })
  return { deps: extractionDepsWith(caller), modelCalls: () => caller.calls.count }
}

/** The executor's document read, wrapped: it hashes the stored bytes (the job key) and refuses a file that is not the one the sender saw. */
function withShaCheck(deps: ExtractionExecutorDeps, expected: string | null): { deps: ExtractionExecutorDeps; seen: { sha: string | null; mismatch: boolean } } {
  const seen = { sha: null as string | null, mismatch: false }
  return {
    seen,
    deps: {
      run: deps.run,
      readDocument: async (task, documentId) => {
        const stored = await deps.readDocument(task, documentId)
        if (typeof stored === "string") return stored
        seen.sha = createHash("sha256").update(stored.bytes).digest("hex")
        if (expected && expected !== seen.sha) {
          seen.mismatch = true
          return "not_usable"
        }
        return stored
      },
    },
  }
}

/** The registry's required parameters that the body did not supply, by name and by label. */
function missingRequired(params: Record<string, unknown>): { missing: string[]; labels: string[] } {
  const declared = functionSpec(CHAT_ATTACHMENT_FUNCTION)?.requiredParams ?? []
  const absent = declared.filter((required) => !requiredParamSatisfied(required, params, undefined))
  return { missing: absent.map((p) => p.name), labels: absent.map((p) => p.label.toLowerCase()) }
}

const MIN_ROLE_RANK = ROLE_RANK.member
/** Questions shown in the chat message; all of them stay in the reply's `questions`. */
const MAX_QUESTIONS_IN_MESSAGE = 25

/** File-derived text shown in a chat message: control characters and line breaks collapsed, length capped. It is data, never markup or an instruction. */
export function chatText(value: unknown, max: number): string {
  const text = typeof value === "string" ? value : ""
  const flat = text.replace(/[\u0000-\u001f\u007f-\u009f\u200b-\u200f\u2028-\u202e\u2066-\u2069\ufeff]+/g, " ").replace(/\s+/g, " ").trim()
  return flat.length > max ? `${flat.slice(0, max - 1)}\u2026` : flat
}

function questionsOf(raw: unknown): ChatQuestion[] {
  if (!Array.isArray(raw)) return []
  const out: ChatQuestion[] = []
  for (const q of raw) {
    if (typeof q !== "object" || q === null) continue
    const { kind, sheet, row, text } = q as Record<string, unknown>
    out.push({ kind: chatText(kind, 40), sheet: chatText(sheet, 100), row: typeof row === "number" && Number.isFinite(row) ? row : 0, text: chatText(text, 400) })
  }
  return out
}

function reconciliationOf(raw: unknown, role: string | null): Record<string, unknown> | null {
  if (typeof raw !== "object" || raw === null) return null
  const r = raw as Record<string, unknown>
  // Money is shown to a role that may see construction figures; anyone else gets the status only (the same rule as every project read).
  return financialsAllowedForRole(role) ? { ...r } : { status: r.status }
}

const REJECTION_SENTENCE: Record<string, string> = {
  extraction_total_mismatch: "The lines I read add up to less than the total the file prints, so I did not go on. To create the project with the lines as they are, confirm with the shortfall accepted.",
  extraction_lines_diverge: "My reading of the file did not match what the file itself shows, so nothing was created. Upload it on the New project screen instead.",
  extraction_schema_invalid: "My reading of the file did not match what the file itself shows, so nothing was created. Upload it on the New project screen instead.",
  extraction_not_grounded: "My reading of the file did not match what the file itself shows, so nothing was created. Upload it on the New project screen instead.",
  extraction_boq_invalid: "The lines I read are not acceptable as a bill of quantities, so nothing was created. Upload the file on the New project screen instead.",
  model_not_configured: "Reading files is not switched on yet, so nothing was created. Upload the file on the New project screen instead.",
  extraction_not_configured: "Reading files is not switched on yet, so nothing was created. Upload the file on the New project screen instead.",
  extraction_unavailable: "I could not read the file just now, so nothing was created. Send it again in a minute.",
  budget_exhausted: "Reading files is paused for this month, so nothing was created.",
  workbook_too_large: "The workbook holds more text than I read in one go, so nothing was created. Upload it on the New project screen instead.",
  extraction_rate_limited: "Too many files were started in the last hour, so nothing was created. Try again later.",
  duplicate_in_progress: "This file is already being processed. Wait a minute and send it again.",
}

function refusalMessage(failure: PipelineFailure): string {
  const context = (failure.context ?? {}) as Record<string, unknown>
  const reason = typeof context.reason === "string" ? context.reason : ""
  if (failure.code === "RECORD_NOT_FOUND") return "I cannot find that file among this organisation's documents, so nothing was created."
  if (failure.code === "NOT_PERMITTED") return "Your role cannot create a project from a file, so nothing was created."
  if (failure.code === "INTERNAL_ERROR" && typeof context.projectId === "string") {
    return `A project (${chatText(context.projectId, 60)}) was created but it could not be finished (${chatText(reason, 60) || "unknown"}). Open it before sending the file again.`
  }
  if (reason && REJECTION_SENTENCE[reason]) return REJECTION_SENTENCE[reason]
  if (failure.code === "REQUEST_REJECTED") return "That document cannot be read: it must be an uploaded .xlsx workbook that is not too large, not a link."
  return "I could not read the file, so nothing was created."
}

const refused = (base: Omit<ChatAttachmentReply, "status" | "failure" | "chatMessages" | "proposal">, failure: PipelineFailure, message: string): ChatAttachmentReply => ({
  ...base,
  status: "refused",
  failure,
  chatMessages: [message],
  proposal: null,
})

/**
 * The whole of a chat message with an attachment. `deps` is for tests: the route passes none and gets the policy and the metered
 * gateway. Throws only for a fault this file has no answer for (the route turns that into a 400 like every other pipeline fault).
 */
export async function runChatAttachment(input: ChatAttachmentInput, deps: ChatAttachmentDeps = {}): Promise<ChatAttachmentReply> {
  const stage: "propose" | "confirm" = input.confirm ? "confirm" : "propose"
  const base = {
    functionId: CHAT_ATTACHMENT_FUNCTION,
    level: 2 as const,
    stage,
    questions: [] as ChatQuestion[],
    reconciliation: null,
    jobId: null,
    jobKey: null as string | null,
    projectId: null,
    route: null,
    missing: [] as string[],
    modelCalls: 0,
    billing: null as ChatAttachmentReply["billing"],
  }

  // Gates that need no file and no model: who is asking, and may they.
  if (!input.personId) {
    return refused(base, pipelineFailure("NOT_PERMITTED", [], { reason: "unidentified_actor" }), refusalSentence("actor_unresolved"))
  }
  if ((ROLE_RANK[(input.role ?? "") as UserRole] ?? 0) < MIN_ROLE_RANK) {
    return refused(base, pipelineFailure("NOT_PERMITTED", [], { reason: "role" }), refusalMessage(pipelineFailure("NOT_PERMITTED")))
  }

  // Level 0: the function is fixed by the attachment. Its parameters come from the body's own fields, never from the sentence.
  const params: Record<string, unknown> = {
    documentId: input.attachment.documentId,
    ...(input.productId ? { productId: input.productId } : {}),
    ...(input.projectName ? { name: input.projectName } : {}),
  }
  const { missing, labels } = missingRequired(params)
  if (missing.length > 0) {
    return {
      ...base,
      status: "needs_input",
      missing,
      failure: null,
      proposal: null,
      chatMessages: [`Nothing has been read yet. Tell me the ${labels.join(" and the ")} for the new project.`],
    }
  }

  const route = (deps.resolveRoute ?? resolveInternalAiRoute)(input.personId)
  if (!route.allowed) {
    return refused(base, pipelineFailure("NOT_PERMITTED", [], { reason: route.reason }), refusalSentence(route.reason))
  }
  const billing = route.kind
  const built = (deps.buildExecutorDeps ?? defaultBuildExecutorDeps)(route, input)

  // The job key: the stored file's sha256, checked against the one the sender saw.
  const { deps: wrapped, seen } = withShaCheck(built.deps, input.attachment.sha256)

  const task: ExecutableTask = {
    orgId: input.orgId,
    userId: input.keyUserId,
    projectId: null,
    functionId: CHAT_ATTACHMENT_FUNCTION,
    params: {
      ...params,
      mode: input.confirm ? "create" : "prepare",
      // A boolean the person sent, and only real booleans: see extraction.ts. Questions can be acknowledged only when confirming.
      acknowledgeQuestions: input.confirm && input.acknowledgeQuestions === true,
      acknowledgeShortfall: input.acknowledgeShortfall === true,
    },
    role: input.role,
    actorUserId: input.personId,
  }

  const outcome: ExecutionOutcome = await executeCreateProjectFromDocument(task, wrapped)
  const common = { ...base, billing, jobKey: seen.sha, modelCalls: built.modelCalls() }
  const proposal = { functionId: CHAT_ATTACHMENT_FUNCTION, params: { ...params }, requiresConfirmation: true as const }
  return replyFromOutcome(outcome, { common, proposal, role: input.role, shaMismatch: seen.mismatch })
}

type ReplyBase = Omit<ChatAttachmentReply, "status" | "failure" | "chatMessages" | "proposal">

/** What the executor answered, as the chat's reply: a refusal in words, the first project, a parked job with its questions, or the created project. */
function replyFromOutcome(
  outcome: ExecutionOutcome,
  ctx: { common: ReplyBase; proposal: NonNullable<ChatAttachmentReply["proposal"]>; role: string | null; shaMismatch: boolean },
): ChatAttachmentReply {
  const { common, proposal } = ctx
  if (!outcome.success) {
    if (ctx.shaMismatch) {
      return refused(common, outcome.failure, "The stored file is not the file you attached (its fingerprint differs), so nothing was read. Attach it again.")
    }
    return refused(common, outcome.failure, refusalMessage(outcome.failure))
  }

  const result = (outcome.result ?? {}) as Record<string, unknown>
  const record = (result.record ?? {}) as Record<string, unknown>

  if (record.duplicate === true) {
    const projectId = typeof result.id === "string" ? result.id : null
    return {
      ...common,
      status: "duplicate",
      projectId,
      route: typeof result.route === "string" ? result.route : null,
      failure: null,
      proposal: null,
      chatMessages: ["This file already has a project, so I made no second one. I opened the first."],
    }
  }

  if (result.pending === true) {
    const questions = questionsOf(result.questions)
    const stats = (result.extraction ?? {}) as Record<string, unknown>
    const read = `I read the workbook (${Number(stats.sheets) || 0} sheets, ${Number(stats.lines) || 0} lines).`
    const jobId = typeof result.jobId === "string" ? result.jobId : null
    const reconciliation = reconciliationOf(result.reconciliation, ctx.role)
    if (questions.length > 0) {
      const shown = questions.slice(0, MAX_QUESTIONS_IN_MESSAGE).map((q, i) => `${i + 1}. ${q.text}${q.sheet ? ` (sheet "${q.sheet}", row ${q.row})` : ""}`)
      const more = questions.length > shown.length ? [`And ${questions.length - shown.length} more.`] : []
      return {
        ...common,
        status: "needs_answers",
        questions,
        reconciliation,
        jobId,
        failure: null,
        proposal,
        chatMessages: [
          `${read} ${questions.length} ${questions.length === 1 ? "question needs" : "questions need"} your answer before I create the project:`,
          ...shown,
          ...more,
          "Nothing has been created. Answer them, or confirm to create the project without those lines.",
        ],
      }
    }
    return {
      ...common,
      status: "ready",
      reconciliation,
      jobId,
      failure: null,
      proposal,
      chatMessages: [`${read} It has no open questions. Nothing has been created yet: confirm to create the project and its bill of quantities.`],
    }
  }

  const projectId = typeof result.id === "string" ? result.id : null
  return {
    ...common,
    status: "created",
    projectId,
    route: typeof result.route === "string" ? result.route : null,
    reconciliation: reconciliationOf(record.reconciliation, ctx.role),
    questions: questionsOf(record.questions),
    failure: null,
    proposal: null,
    chatMessages: ["The project and its bill of quantities are created."],
  }
}
