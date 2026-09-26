// PROJEXA-BUILD-001 U-29 (register rows BR-409, BR-410, BR-424; PMD-05, PMD-35, PMD-38). Surface 1 of
// ai-os/projexa-build-001/FOUR_SURFACE_CONTRACT.md: the person opens one project's approval list, reads each
// proposal an AI prepared, and presses Approve.
//
// THE STORE. A proposal is a compliance.submissions row, the same store the U-31 email bridge already writes
// (email-intelligence-service.ts, promoteEmailIntelligenceItem -> submitForVerdict). No table, column or
// migration is added. A row is a PREPARED proposal when its selected_chain is { source, functionId, params }
// with a known source and an approvable function (readPreparedChain). It is pending while its status is
// in_progress or chat: submitForVerdict() writes chat when the stored words do not resolve to a function, which
// is the live case for an email proposal (PMD-38), and runDirectTask() overwrites selected_chain with the derived
// chain and sets done or failed once it has run, so an approved proposal stops matching.
//
// THE READ. listPreparedProposals() reads the pending rows of one project and returns each one with the
// parameters it stored. It writes nothing and asks no model: the verdict of proposeSubmission() was recorded on
// the row when the row was written, and a page view must not spend a model call.
//
// THE APPROVAL. confirmPreparedProposal() does not call confirmSubmission(). That function re-derives the
// proposal from the words stored with the row, and on the live database phrase_map holds no phrase for create_boq,
// so an email proposal would not resolve without a model (PMD-38). This one reads the parameters from
// selected_chain, merges what the person adds, checks the result with the registry's validate() and the BOQ
// service's own line-item rules, and runs runDirectTask() on the proposal's own row, the same call
// confirmSubmission() ends with. The person is passed as userId and as actorUserId (PMD-35), so the BOQ is
// recorded under the person and never under an API key. No model is asked.
//
// THE CLAIM. Before it runs anything, an approval claims the proposal with one conditional UPDATE: it stamps
// selected_chain.claimedAt on the row where the row is still pending and carries no stamp yet, and the answer is
// the number of rows changed. Postgres makes that atomic (a second UPDATE of the same row waits for the first and
// then finds the stamp), so of two overlapping Approves exactly one runs the BOQ and the other is answered 409.
// The list hides a claimed proposal. A claim is released only when the run threw before it minted its task, so
// nothing can have been written; after that point it stays, because a retry could then write a second BOQ. A
// claimed row is found with: select id from compliance.submissions where selected_chain ->> 'claimedAt' is not null
// and status in ('in_progress','chat').
//
// THE AUDIT. auditApproval() writes one compliance.audit_logs row per line item created, through logActivity()
// with its surface argument set to s1_one_page_ai_prepared and the acting person as the user (a key that carried
// the call is kept beside the person, never instead of the person). It runs after the BOQ is written, in its own
// transaction, because createBoq() opens and closes its own. When it fails, the approval records what is owed in
// selected_chain.auditPending (the person, the BOQ and line item ids) and the person's next Approve of the same
// proposal writes the missing rows instead of answering 409 (repairApprovalAudit). The gap is found with:
// select id from compliance.submissions where selected_chain ->> 'auditPending' is not null.
//
// THE PASTE-BACK. For an AI that cannot open the person's link, parsePasteBack() reads fenced blocks from pasted text,
// validatePastedBlock() checks each one with the registry's validate(), and storePastedProposals() stores each valid
// block as one more pending row of the same store. A paste stores nothing when any block fails.
import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { withTenantContext } from "@/lib/db/tenant-scoped";
import { pipelineTasks, projects, submissions } from "@/lib/db/schema";
import { assertKeyProjectScope, type KeyProjectFacts } from "@/lib/supabase/api-key-auth";
import { redactProjectSideFields } from "@/lib/services/cost-visibility-service";
import { ServiceError } from "@/lib/services/compliance-service";
import { validateBoqBodyShape, validateLineItemInputs, type BoqLineItemInput } from "@/lib/services/construction-boq-service";
import { logActivity, type AuditSurface } from "@/lib/audit";
import type { ActingActor } from "@/lib/supabase/auth-guard";
import { missingParamsFor, type DryRunMissing } from "./dry-run";
import { pipelineFailure, type PipelineFailure } from "./error-codes";
import { functionLabel } from "./function-registry";
import { sanitisePastedNote, sanitisePastedParams } from "./paste-back-text";
import { classifySubmission } from "./classify";
import { buildValidationContext, runDirectTask, type RunSubmissionResult } from "./run-submission";
import { validate, type ValidationContext } from "./validate";

/** The audit surface every approval on the approval list is recorded under (FOUR_SURFACE_CONTRACT.md rule 4). */
export const S1_SURFACE = "s1_one_page_ai_prepared" as const satisfies AuditSurface;

/**
 * The functions the approval list can confirm. Only the BOQ line-item write for now (PMD-20): a row naming any
 * other function is not a prepared proposal, so it is neither listed nor confirmed here.
 */
export const S1_APPROVABLE_FUNCTION_IDS: readonly string[] = ["create_boq"];

/** Who prepared a proposal: the U-31 email bridge, or a pasted block (POST .../paste-back). */
export const PREPARED_SOURCES = ["email_intelligence", "paste_back"] as const;
export type PreparedSource = (typeof PREPARED_SOURCES)[number];

/** submissions.status values a proposal can still be approved in. done, partial and failed mean it was decided. */
export const PENDING_SUBMISSION_STATUSES = ["in_progress", "chat"] as const;

/** The most proposals one list answers with, newest first. */
export const MAX_LISTED_PROPOSALS = 100;

/** The most characters kept of the free-text note that travels with a proposal. */
export const NOTE_MAX_LENGTH = 500;

/** submissions.selected_chain of a prepared proposal. */
export type PreparedChain = {
  source: PreparedSource;
  functionId: string;
  params: Record<string, unknown>;
  note: string | null;
};

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * The prepared chain a selected_chain holds, or null when it is anything else (a typed message's chain hint, a
 * derived chain, a function this list does not approve). Strict on purpose: it decides which rows are listed and
 * which rows the approve action may run.
 */
export function readPreparedChain(value: unknown): PreparedChain | null {
  if (!isPlainObject(value)) return null;
  const { source, functionId, params, note } = value;
  if (typeof source !== "string" || !(PREPARED_SOURCES as readonly string[]).includes(source)) return null;
  if (typeof functionId !== "string" || !S1_APPROVABLE_FUNCTION_IDS.includes(functionId)) return null;
  if (!isPlainObject(params)) return null;
  return {
    source: source as PreparedSource,
    functionId,
    params,
    note: typeof note === "string" && note.trim() !== "" ? note.trim().slice(0, NOTE_MAX_LENGTH) : null,
  };
}

/** True when an approval has claimed this selected_chain (see THE CLAIM above). Mirrors the SQL `->> 'claimedAt' is null`. */
function isClaimed(value: unknown): boolean {
  return isPlainObject(value) && typeof value.claimedAt === "string";
}

/**
 * `selected_chain || <patch>`: the SQL value that merges a JSON object into the column inside the UPDATE itself, so
 * a write here never replaces keys it did not read.
 */
function mergeIntoSelectedChain(patch: Record<string, unknown>) {
  return sql`${submissions.selectedChain} || ${JSON.stringify(patch)}::jsonb`;
}

/** What an approval owes the audit trail when the audit rows could not be written (see THE AUDIT above). */
export type AuditPending = {
  /** compliance.users.id of the person who approved: the one whose next Approve may write the rows */
  personId: string;
  source: PreparedSource;
  functionId: string;
  boqId: string;
  lineItemIds: string[];
  at: string;
};

/** The audit debt a selected_chain records, or null when there is none (or it is not readable). */
export function readAuditPending(value: unknown): AuditPending | null {
  if (!isPlainObject(value) || !isPlainObject(value.auditPending)) return null;
  const { personId, source, functionId, boqId, lineItemIds, at } = value.auditPending;
  if (typeof personId !== "string" || typeof boqId !== "string" || typeof functionId !== "string") return null;
  if (typeof source !== "string" || !(PREPARED_SOURCES as readonly string[]).includes(source)) return null;
  if (!Array.isArray(lineItemIds) || lineItemIds.some((id) => typeof id !== "string")) return null;
  return { personId, source: source as PreparedSource, functionId, boqId, lineItemIds: lineItemIds as string[], at: typeof at === "string" ? at : "" };
}

/** One entry of the approval list. `params` carries no project-side cost field (redactProjectSideFields). */
export type PreparedProposal = {
  submissionId: string;
  source: PreparedSource;
  functionId: string;
  /** the registry's human label, never the function id, for the page to print */
  label: string;
  /** what will be written, exactly as stored: { projectId, title, lineItems } for create_boq */
  params: Record<string, unknown>;
  /** required parameters still unanswered; the person adds them when approving */
  missing: DryRunMissing[];
  note: string | null;
  /** compliance.users.id of the person who promoted the email or pasted the block */
  preparedById: string;
  preparedAt: string;
};

/** The one action a proposal offers: approve it by posting the submission id to the approvals route. */
export type ApproveAction = {
  action: "approve";
  method: "POST";
  path: string;
  body: { submissionId: string };
};

export function approveActionFor(projectId: string, submissionId: string): ApproveAction {
  return {
    action: "approve",
    method: "POST",
    path: `/api/v1/projexa/projects/${encodeURIComponent(projectId)}/approvals`,
    body: { submissionId },
  };
}

/**
 * The project when the caller may read it, else null (the route answers 404, so another organisation's project
 * and a project a project-pinned key may not reach both read as absent). Its own short transaction.
 */
export async function findReadableProject(
  ctx: { orgId: string; apiKey: KeyProjectFacts | null },
  projectId: string
): Promise<{ id: string; name: string } | null> {
  if (!assertKeyProjectScope(ctx.apiKey, projectId).ok) return null;
  const project = await withTenantContext({ orgId: ctx.orgId }, (db) =>
    db.query.projects.findFirst({ where: and(eq(projects.id, projectId), eq(projects.orgId, ctx.orgId)) })
  );
  return project ? { id: project.id, name: project.name } : null;
}

function toIso(value: unknown): string {
  return value instanceof Date ? value.toISOString() : String(value ?? "");
}

/**
 * The pending prepared proposals of one project, newest first, at most MAX_LISTED_PROPOSALS. One read, no write, no
 * model call. The SQL does the whole selection (pending, of this project, a known source, an approvable function, not
 * claimed), the ordering and the limit, so a project with many typed messages waiting for a confirm, each of which
 * carries a chain hint in the same column, pays for none of them and cannot push a real proposal past the limit.
 * readPreparedChain() then reads each row's chain; it agrees with the SQL filter, and drops a row whose params are
 * not an object.
 */
export async function listPreparedProposals(ctx: { orgId: string }, projectId: string): Promise<PreparedProposal[]> {
  const rows = await withTenantContext({ orgId: ctx.orgId }, (db) =>
    db
      .select({
        id: submissions.id,
        userId: submissions.userId,
        selectedChain: submissions.selectedChain,
        createdAt: submissions.createdAt,
      })
      .from(submissions)
      .where(
        and(
          eq(submissions.orgId, ctx.orgId),
          eq(submissions.projectId, projectId),
          inArray(submissions.status, [...PENDING_SUBMISSION_STATUSES]),
          inArray(sql`${submissions.selectedChain} ->> 'source'`, [...PREPARED_SOURCES]),
          inArray(sql`${submissions.selectedChain} ->> 'functionId'`, [...S1_APPROVABLE_FUNCTION_IDS]),
          sql`${submissions.selectedChain} ->> 'claimedAt' is null`
        )
      )
      // id breaks a tie: the blocks of one paste are stored in one transaction and share a created_at.
      .orderBy(desc(submissions.createdAt), desc(submissions.id))
      .limit(MAX_LISTED_PROPOSALS)
  );

  const proposals: PreparedProposal[] = [];
  for (const row of rows) {
    const chain = readPreparedChain(row.selectedChain);
    if (!chain) continue;
    proposals.push({
      submissionId: row.id,
      source: chain.source,
      functionId: chain.functionId,
      label: functionLabel(chain.functionId),
      params: redactProjectSideFields(chain.params),
      missing: missingParamsFor(chain.functionId, chain.params, projectId),
      note: chain.note,
      preparedById: row.userId,
      preparedAt: toIso(row.createdAt),
    });
  }
  return proposals;
}

/**
 * The context the registry's validate() runs in for this list, at paste time and at approval time: the one place the
 * candidate set is narrowed to the functions the list approves, and the project of the URL is the only reachable
 * project (projectScope), so a params.projectId naming another project is PROJECT_NOT_REACHABLE.
 */
function s1ValidationContext(projectId: string, projectLabel: string | null, params: Record<string, unknown>): ValidationContext {
  return {
    ...buildValidationContext({ projectId, projectLabel, boq: null, params, projectScope: projectId }),
    candidateFunctionIds: S1_APPROVABLE_FUNCTION_IDS,
    userPermittedFunctionIds: new Set(S1_APPROVABLE_FUNCTION_IDS),
  };
}

/** What a list of line items is checked against before a create_boq proposal is stored or written. */
export type LineItemsCheck = { ok: true } | { ok: false; failure: PipelineFailure; detail: string };

/**
 * create_boq's line-item rules, run before anything is written: the same two validators createBoq() and the create_boq
 * executor call (validateBoqBodyShape, validateLineItemInputs), so a proposal that could never be written is refused
 * here instead of failing after the person pressed Approve. Absent lineItems is legal (a BOQ may be created with a
 * title and no lines).
 */
export function checkBoqLineItems(params: Record<string, unknown>): LineItemsCheck {
  const raw = params.lineItems;
  const present = raw !== undefined && raw !== null;
  if (present && (!Array.isArray(raw) || raw.some((item) => typeof item !== "object" || item === null || Array.isArray(item)))) {
    return {
      ok: false,
      failure: pipelineFailure("REQUEST_REJECTED", [], { status: 400, reason: "line_items_not_a_list" }),
      detail: "lineItems must be a list of objects",
    };
  }
  try {
    // Runs when lineItems is absent too: it is what refuses line items sent under a key the service does not read.
    validateBoqBodyShape(params);
    if (present) validateLineItemInputs(raw as BoqLineItemInput[]);
    return { ok: true };
  } catch (error) {
    if (error instanceof ServiceError) {
      return {
        ok: false,
        failure: pipelineFailure("REQUEST_REJECTED", [], { status: error.status, reason: "line_items_rejected" }),
        detail: error.message,
      };
    }
    throw error;
  }
}

export type ConfirmPreparedInput = {
  orgId: string;
  /** the project of the URL; the proposal must belong to it */
  projectId: string;
  submissionId: string;
  /** the signed-in person, or the person an API key names (requireActingPerson): compliance.users id and role */
  person: { id: string; role: string | null };
  /** what the person adds or changes, merged over the stored params */
  params?: Record<string, unknown>;
};

export type ConfirmPreparedOutcome =
  | { ok: true; result: RunSubmissionResult; chain: PreparedChain; params: Record<string, unknown> }
  | { ok: false; reason: "not_found" }
  | { ok: false; reason: "already_decided"; status: string }
  /** another Approve of this proposal claimed it and has not finished (or an earlier one was interrupted) */
  | { ok: false; reason: "in_progress" }
  /** the proposal was approved and saved, but its audit rows were not written; the approving person may write them now */
  | { ok: false; reason: "audit_pending"; pending: AuditPending }
  | { ok: false; reason: "needs_input"; missing: DryRunMissing[] }
  | { ok: false; reason: "invalid"; failure: PipelineFailure; detail?: string }
  | { ok: false; reason: "failed"; result: RunSubmissionResult };

type ProposalRow = {
  id: string;
  projectId: string | null;
  mode: string;
  rawInput: string;
  status: string;
  selectedChain: unknown;
};

async function readProposalRow(orgId: string, submissionId: string): Promise<ProposalRow | null> {
  return withTenantContext({ orgId }, async (db) => {
    const [found] = await db
      .select({
        id: submissions.id,
        projectId: submissions.projectId,
        mode: submissions.mode,
        rawInput: submissions.rawInput,
        status: submissions.status,
        selectedChain: submissions.selectedChain,
      })
      .from(submissions)
      .where(and(eq(submissions.id, submissionId), eq(submissions.orgId, orgId)))
      .limit(1);
    return found ?? null;
  });
}

const isPending = (status: string) => (PENDING_SUBMISSION_STATUSES as readonly string[]).includes(status);

/**
 * Claim one pending, unclaimed proposal of this project: the single UPDATE that decides which of several overlapping
 * Approves runs. True when this call stamped the row.
 */
async function claimProposal(input: ConfirmPreparedInput): Promise<boolean> {
  const rows = await withTenantContext({ orgId: input.orgId, userId: input.person.id }, (db) =>
    db
      .update(submissions)
      .set({ selectedChain: mergeIntoSelectedChain({ claimedAt: new Date().toISOString(), claimedBy: input.person.id }) })
      .where(
        and(
          eq(submissions.id, input.submissionId),
          eq(submissions.orgId, input.orgId),
          eq(submissions.projectId, input.projectId),
          inArray(submissions.status, [...PENDING_SUBMISSION_STATUSES]),
          sql`${submissions.selectedChain} ->> 'claimedAt' is null`
        )
      )
      .returning({ id: submissions.id })
  );
  return rows.length === 1;
}

/**
 * Give the claim back after runDirectTask() threw, but only when nothing can have been written: the run mints its
 * pipeline_tasks row before it reaches the executor, so no task row for this submission means create_boq never ran.
 * With a task row present the claim stays (a retry could write a second BOQ) and the row is left for the operator
 * query in THE CLAIM above. Never throws: the caller is already handling the original error.
 */
async function releaseClaimIfUnwritten(input: ConfirmPreparedInput, storedChain: unknown): Promise<boolean> {
  try {
    const released = await withTenantContext({ orgId: input.orgId, userId: input.person.id }, async (db) => {
      const tasks = await db
        .select({ id: pipelineTasks.id })
        .from(pipelineTasks)
        .where(and(eq(pipelineTasks.submissionId, input.submissionId), eq(pipelineTasks.orgId, input.orgId)))
        .limit(1);
      if (tasks.length > 0) return false;
      const rows = await db
        .update(submissions)
        .set({ selectedChain: storedChain })
        .where(
          and(
            eq(submissions.id, input.submissionId),
            eq(submissions.orgId, input.orgId),
            inArray(submissions.status, [...PENDING_SUBMISSION_STATUSES]),
            sql`${submissions.selectedChain} ->> 'claimedAt' is not null`
          )
        )
        .returning({ id: submissions.id });
      return rows.length === 1;
    });
    if (!released) console.error(`[approvals] submission=${input.submissionId} claim kept after an interrupted approval`);
    return released;
  } catch (error) {
    console.error(`[approvals] submission=${input.submissionId} claim could not be released:`, error);
    return false;
  }
}

/**
 * Approve one prepared proposal. Nothing is written until every check has passed, and a check that fails leaves the
 * proposal pending so the person can correct it:
 *   1. the submission is of this organisation AND this project, else not_found (another project's proposal, another
 *      organisation's, a typed message, a proposal naming a function this list does not approve);
 *   2. it is still pending, else already_decided (a second Approve does not write a second BOQ); before that check,
 *      the person who approved it may write the audit rows an earlier attempt left owed (audit_pending);
 *   3. the stored params plus the person's are complete (needs_input names what is missing);
 *   4. the registry's validate() accepts them on this project only, and the line items pass the BOQ service's rules;
 *   5. the proposal is claimed (THE CLAIM above); a proposal another Approve holds is in_progress.
 * Then runDirectTask() runs create_boq on the proposal's own row. A failure inside it (the project vanished, the
 * service refused) marks the submission failed, exactly as confirmSubmission() would, and comes back as `failed`.
 * An error thrown by it is rethrown after the claim is released or kept as releaseClaimIfUnwritten() decides.
 */
export async function confirmPreparedProposal(input: ConfirmPreparedInput): Promise<ConfirmPreparedOutcome> {
  const row = await readProposalRow(input.orgId, input.submissionId);
  if (!row || row.projectId !== input.projectId) return { ok: false, reason: "not_found" };
  // The person who approved this proposal earlier and left its audit rows owed may write them now. Checked before the
  // status: the marker exists only on a row whose approval saved its BOQ, and that row is normally done but stays
  // pending if the run's own status write failed too.
  const owed = readAuditPending(row.selectedChain);
  if (owed && owed.personId === input.person.id) return { ok: false, reason: "audit_pending", pending: owed };
  if (!isPending(row.status)) return { ok: false, reason: "already_decided", status: row.status };
  const chain = readPreparedChain(row.selectedChain);
  if (!chain) return { ok: false, reason: "not_found" };
  if (isClaimed(row.selectedChain)) return { ok: false, reason: "in_progress" };

  // PMD-38: the stored parameters, with what the person adds over them. The stored words (row.rawInput) are not read.
  const merged: Record<string, unknown> = { ...chain.params, ...(input.params ?? {}) };
  const missing = missingParamsFor(chain.functionId, merged, input.projectId);
  if (missing.length > 0) return { ok: false, reason: "needs_input", missing };

  const checked = validate({ functionId: chain.functionId, params: merged }, s1ValidationContext(input.projectId, null, merged));
  if (!checked.valid) {
    const { valid: _valid, ...failure } = checked;
    return { ok: false, reason: "invalid", failure };
  }
  const lines = checkBoqLineItems(checked.params);
  if (!lines.ok) return { ok: false, reason: "invalid", failure: lines.failure, detail: lines.detail };

  // The read above is a look, not a lock: the claim is what decides. A lost claim is answered from the row as it is now.
  if (!(await claimProposal(input))) {
    const now = await readProposalRow(input.orgId, input.submissionId);
    if (!now || now.projectId !== input.projectId) return { ok: false, reason: "not_found" };
    return isPending(now.status) ? { ok: false, reason: "in_progress" } : { ok: false, reason: "already_decided", status: now.status };
  }

  let result: RunSubmissionResult;
  try {
    result = await runDirectTask({
      orgId: input.orgId,
      userId: input.person.id,
      mode: row.mode,
      projectId: input.projectId,
      functionId: chain.functionId,
      params: checked.params,
      note: row.rawInput,
      role: input.person.role,
      // PMD-35: the person is the actor of the write, never the key that carried the call.
      actorUserId: input.person.id,
      existingSubmissionId: row.id,
      projectScope: input.projectId,
    });
  } catch (error) {
    await releaseClaimIfUnwritten(input, row.selectedChain);
    throw error;
  }
  if (result.status !== "done") return { ok: false, reason: "failed", result };
  return { ok: true, result, chain, params: checked.params };
}

function createdRecordOf(result: RunSubmissionResult): { boqId: string | null; lineItemIds: string[] } {
  const out = result.tasks[0]?.result;
  if (!isPlainObject(out)) return { boqId: null, lineItemIds: [] };
  const record = out.record;
  const items = isPlainObject(record) && Array.isArray(record.lineItems) ? record.lineItems : [];
  return {
    boqId: typeof out.id === "string" ? out.id : null,
    lineItemIds: items.flatMap((item) => (isPlainObject(item) && typeof item.id === "string" ? [item.id] : [])),
  };
}

/** The audit action of an approval on the approval list. */
export const S1_APPROVAL_ACTION = "boq_line_item.approved_from_proposal";

/** What one approval's audit rows are written from: the proposal's source and function, the BOQ and its line items. */
type ApprovalFacts = Pick<AuditPending, "source" | "functionId" | "boqId" | "lineItemIds">;

/**
 * One compliance.audit_logs row per line item the approval created (entity construction_boq_line_item), or one row
 * for the BOQ header (entity construction_boq) when the proposal had no lines. Each row carries surface
 * s1_one_page_ai_prepared, the acting person as user_id, and, when an API key carried the call, that key as
 * api_key_id beside the person. Written in its own transaction after the BOQ was written: createBoq() opens and
 * closes its own, so the two cannot share one. Throws when the rows cannot be written; auditApproval() and
 * repairApprovalAudit() are what answer that.
 */
async function recordApprovalAudit(args: {
  orgId: string;
  actor: ActingActor;
  request?: Request;
  submissionId: string;
  facts: ApprovalFacts;
}): Promise<{ entityType: string; entityIds: string[] }> {
  const { facts } = args;
  const entityType = facts.lineItemIds.length > 0 ? "construction_boq_line_item" : "construction_boq";
  const entityIds = facts.lineItemIds.length > 0 ? facts.lineItemIds : [facts.boqId];

  await withTenantContext({ orgId: args.orgId, userId: args.actor.dbUser.id }, async (db) => {
    for (const entityId of entityIds) {
      await logActivity({
        tx: db,
        orgId: args.orgId,
        ...args.actor,
        action: S1_APPROVAL_ACTION,
        entityType,
        entityId,
        details: JSON.stringify({
          surface: S1_SURFACE,
          source: facts.source,
          functionId: facts.functionId,
          submissionId: args.submissionId,
          boqId: facts.boqId,
        }),
        request: args.request,
        surface: S1_SURFACE,
      });
    }
  });
  return { entityType, entityIds };
}

/**
 * Record that an approval saved its BOQ and did not write its audit rows, on the proposal's own row, so the gap can
 * be found (THE AUDIT above) and the person can fill it by approving again. The marker is merged into selected_chain
 * inside the UPDATE. False when it could not be written either; the ids go to the log then, the last place they are
 * kept. Never throws.
 */
async function markAuditPending(args: { orgId: string; personId: string; submissionId: string; facts: ApprovalFacts }): Promise<boolean> {
  const pending: AuditPending = { personId: args.personId, ...args.facts, at: new Date().toISOString() };
  try {
    const rows = await withTenantContext({ orgId: args.orgId, userId: args.personId }, (db) =>
      db
        .update(submissions)
        .set({ selectedChain: mergeIntoSelectedChain({ auditPending: pending }) })
        .where(and(eq(submissions.id, args.submissionId), eq(submissions.orgId, args.orgId)))
        .returning({ id: submissions.id })
    );
    return rows.length === 1;
  } catch (error) {
    console.error(`[approvals] submission=${args.submissionId} audit debt could not be recorded:`, error);
    console.error(`[approvals] audit owed: ${JSON.stringify({ submissionId: args.submissionId, ...pending })}`);
    return false;
  }
}

/** What writing the audit rows of an approval came to. */
export type AuditOutcome =
  | { ok: true; entityType: string; entityIds: string[] }
  /** the rows were not written; `recorded` says whether the debt was recorded so that Approve again can write them */
  | { ok: false; reason: "failed"; recorded: boolean }
  /** repair only: another repair took the debt first, or none is owed any more */
  | { ok: false; reason: "lost" };

/**
 * Write the audit rows of an approval that just saved its BOQ. When that fails the answer is ok:false with the debt
 * recorded (markAuditPending), never a thrown error: the BOQ is saved and the caller must say so.
 */
export async function auditApproval(args: {
  orgId: string;
  actor: ActingActor;
  request?: Request;
  submissionId: string;
  chain: PreparedChain;
  result: RunSubmissionResult;
}): Promise<AuditOutcome> {
  const created = createdRecordOf(args.result);
  const facts: ApprovalFacts | null = created.boqId
    ? { source: args.chain.source, functionId: args.chain.functionId, boqId: created.boqId, lineItemIds: created.lineItemIds }
    : null;
  try {
    if (!facts) throw new Error("The approval wrote a record but its id could not be read from the task result");
    const audit = await recordApprovalAudit({ orgId: args.orgId, actor: args.actor, request: args.request, submissionId: args.submissionId, facts });
    return { ok: true, ...audit };
  } catch (error) {
    console.error("[approvals] audit write failed after the record was saved:", error);
    const recorded = facts ? await markAuditPending({ orgId: args.orgId, personId: args.actor.dbUser.id, submissionId: args.submissionId, facts }) : false;
    return { ok: false, reason: "failed", recorded };
  }
}

/**
 * Write the audit rows an earlier approval of this proposal left owed. The debt is taken first, by one conditional
 * UPDATE that clears the marker where it is still set, so two overlapping repairs write the rows once: the loser is
 * `lost`. If the write fails the debt is recorded again, exactly as after the first failure.
 */
export async function repairApprovalAudit(args: {
  orgId: string;
  actor: ActingActor;
  request?: Request;
  submissionId: string;
  pending: AuditPending;
}): Promise<AuditOutcome> {
  const taken = await withTenantContext({ orgId: args.orgId, userId: args.pending.personId }, (db) =>
    db
      .update(submissions)
      // status done: the BOQ is saved and this repair is what completes the approval, also for a row whose own status write failed.
      .set({ selectedChain: mergeIntoSelectedChain({ auditPending: null }), status: "done" })
      .where(
        and(
          eq(submissions.id, args.submissionId),
          eq(submissions.orgId, args.orgId),
          sql`${submissions.selectedChain} ->> 'auditPending' is not null`
        )
      )
      .returning({ id: submissions.id })
  );
  if (taken.length !== 1) return { ok: false, reason: "lost" };

  const { personId, source, functionId, boqId, lineItemIds } = args.pending;
  const facts: ApprovalFacts = { source, functionId, boqId, lineItemIds };
  try {
    const audit = await recordApprovalAudit({ orgId: args.orgId, actor: args.actor, request: args.request, submissionId: args.submissionId, facts });
    return { ok: true, ...audit };
  } catch (error) {
    console.error("[approvals] audit repair failed:", error);
    const recorded = await markAuditPending({ orgId: args.orgId, personId, submissionId: args.submissionId, facts });
    return { ok: false, reason: "failed", recorded };
  }
}

/** The BOQ an approval created, for the response: its id, its route, and the line item ids. */
export function approvedRecordOf(result: RunSubmissionResult): { boqId: string | null; route: string | null; lineItemIds: string[] } {
  const created = createdRecordOf(result);
  const out = result.tasks[0]?.result;
  return { ...created, route: isPlainObject(out) && typeof out.route === "string" ? out.route : null };
}

// ── PASTE-BACK (BR-424, U-47) ──────────────────────────────────────────────
// For an AI that cannot open the person's link URL: it prints one fenced block per change, the person pastes the
// text, and each valid block becomes one pending proposal on the approval list. Nothing is written to a BOQ. The
// block is the one UNIVERSAL_AI_WORK_LINK_SPEC.md section 9.4 names:
//
//   ```projexa-proposal
//   {"v":1,"function":"create_boq","params":{"title":"...","lineItems":[...]},"note":"optional"}
//   ```
//
// A block is checked with the registry's own validate() and the BOQ service's line-item rules, the same checks the
// approval runs, so a block that would fail at Approve fails here with 422 and stores nothing. A paste is all or
// nothing: every block is checked before the first is stored.

/** The most blocks one paste may hold. */
export const MAX_PASTE_BLOCKS = 20;

/** The most characters of pasted text the route reads. */
export const MAX_PASTE_CHARS = 200_000;

/** The fence languages a block may carry; the empty one is a bare ``` fence. Any other fenced code is not ours. */
const BLOCK_FENCE_LANGUAGES = ["projexa-proposal", "json", ""];

/** One block as the AI printed it, after its shape was checked. */
export type PastedBlock = { functionId: string; params: Record<string, unknown>; note: string | null };

export type PasteFailure = { block: number | null; failure: PipelineFailure; detail?: string };

function rejected(reason: string, block: number | null, detail?: string): { ok: false } & PasteFailure {
  return { ok: false, block, failure: pipelineFailure("REQUEST_REJECTED", [], { status: 422, reason }), ...(detail ? { detail } : {}) };
}

/**
 * The blocks of a pasted text, in order, or the first reason the paste is refused. Only shape is read here (a fence,
 * JSON, version 1, a function name, an object of params); what the function may do is validatePastedBlock().
 */
export function parsePasteBack(text: string): { ok: true; blocks: PastedBlock[] } | ({ ok: false } & PasteFailure) {
  const bodies: string[] = [];
  for (const match of text.matchAll(/```([^\r\n`]*)\r?\n([\s\S]*?)```/g)) {
    if (BLOCK_FENCE_LANGUAGES.includes(match[1].trim().toLowerCase())) bodies.push(match[2]);
  }
  if (bodies.length === 0) return rejected("no_block", null);
  if (bodies.length > MAX_PASTE_BLOCKS) return rejected("too_many_blocks", null);

  const blocks: PastedBlock[] = [];
  for (const [index, body] of bodies.entries()) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(body);
    } catch {
      return rejected("block_not_json", index);
    }
    if (!isPlainObject(parsed)) return rejected("block_not_object", index);
    if (parsed.v !== undefined && parsed.v !== 1) return rejected("unsupported_version", index);
    const functionId = typeof parsed.function === "string" ? parsed.function.trim() : "";
    if (!functionId) return rejected("function_missing", index);
    const params = parsed.params === undefined ? {} : parsed.params;
    if (!isPlainObject(params)) return rejected("params_not_object", index);
    // Text a block carries is held to the link's text rules (paste-back-text.ts): control characters removed, backtick
    // runs defused, and a value over 2,000 characters refused with 422 rather than cut.
    const text = sanitisePastedParams(params);
    if (!text.ok) return rejected(text.reason, index, text.detail);
    blocks.push({ functionId, params: text.params, note: sanitisePastedNote(parsed.note, NOTE_MAX_LENGTH) });
  }
  return { ok: true, blocks };
}

/**
 * One block against the registry: validate() with this list's candidate set and this project only, then create_boq's
 * line-item rules. Returns the params to store (validate() fills projectId from the URL's project when the block
 * leaves it out) or the failure to answer 422 with.
 */
export function validatePastedBlock(
  block: PastedBlock,
  project: { id: string; name: string }
): { ok: true; params: Record<string, unknown> } | { ok: false; failure: PipelineFailure; detail?: string } {
  const checked = validate({ functionId: block.functionId, params: block.params }, s1ValidationContext(project.id, project.name, block.params));
  if (!checked.valid) {
    const { valid: _valid, ...failure } = checked;
    return { ok: false, failure };
  }
  const lines = checkBoqLineItems(checked.params);
  if (!lines.ok) return { ok: false, failure: lines.failure, detail: lines.detail };
  return { ok: true, params: checked.params };
}

/**
 * Store validated blocks as pending proposals, one compliance.submissions row each, all in one transaction. The row is
 * the store the approval list reads: selected_chain { source: "paste_back", functionId, params, note }, status
 * in_progress, the words the registry gives the function as raw_input, and the pasting person as user_id. Nothing
 * else is written: no BOQ, no line item, no task, and no model is asked (submitForVerdict() would run a dry run
 * that can reach one, and the block already names its function). The Level 1 columns stay NULL, as on a row nobody
 * measured. Returns the new submission ids in block order.
 */
export async function storePastedProposals(args: {
  orgId: string;
  projectId: string;
  person: { id: string };
  blocks: Array<{ functionId: string; params: Record<string, unknown>; note: string | null }>;
}): Promise<string[]> {
  return withTenantContext({ orgId: args.orgId, userId: args.person.id }, async (db) => {
    const ids: string[] = [];
    for (const block of args.blocks) {
      const [row] = await db
        .insert(submissions)
        .values({
          orgId: args.orgId,
          projectId: args.projectId,
          mode: "Projects",
          selectedChain: { source: "paste_back", functionId: block.functionId, params: block.params, note: block.note },
          rawInput: functionLabel(block.functionId).toLowerCase(),
          userId: args.person.id,
          status: "in_progress",
          classification: classifySubmission(["task"]),
        })
        .returning({ id: submissions.id });
      ids.push(row.id);
    }
    return ids;
  });
}
