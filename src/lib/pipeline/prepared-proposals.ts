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
// The three writing steps of the unit (confirm, audit, paste-back) are added below by the commits that need them.
import { and, eq, inArray, isNotNull } from "drizzle-orm";
import { withTenantContext } from "@/lib/db/tenant-scoped";
import { projects, submissions } from "@/lib/db/schema";
import { assertKeyProjectScope, type KeyProjectFacts } from "@/lib/supabase/api-key-auth";
import { redactProjectSideFields } from "@/lib/services/cost-visibility-service";
import type { AuditSurface } from "@/lib/audit";
import { missingParamsFor, type DryRunMissing } from "./dry-run";
import { functionLabel } from "./function-registry";

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
 * The pending prepared proposals of one project, newest first. One read, no write, no model call. The SQL keeps
 * the project's pending rows that carry a chain; readPreparedChain() then keeps the prepared ones, so a typed
 * message left waiting for a confirm is never listed.
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
          isNotNull(submissions.selectedChain)
        )
      )
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
  proposals.sort((a, b) => (a.preparedAt < b.preparedAt ? 1 : a.preparedAt > b.preparedAt ? -1 : 0));
  return proposals.slice(0, MAX_LISTED_PROPOSALS);
}
