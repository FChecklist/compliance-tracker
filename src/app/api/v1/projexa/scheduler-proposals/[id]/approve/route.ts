import { NextRequest, NextResponse } from "next/server"
import { requireAuthOrApiKey, requireRoleOrScope, requireActingPerson } from "@/lib/supabase/auth-guard"
import { createProject, ServiceError } from "@/lib/services/construction-dashboard-service"
import { createBoq } from "@/lib/services/construction-boq-service"
import { createDbProjectSourceLedger, createEdgeExtractCaller } from "@/lib/services/document-extraction-service"
import { ProjectCreatedUnlinkedError, ProjectCreatedWithoutBoqError } from "@/lib/services/document-extraction-schema"
import { approveFolderProposal, type ApproveProposalDeps, type ApproveProposalOutcome } from "@/lib/services/folder-watch-approve"
import { openFolderSource } from "@/lib/services/folder-watch-connectors"

// PROJEXA-BUILD-002 WP-15 (register row AW-606, way 5): a person approves the proposal a schedule prepared from a file it found in a
// connected mailbox or Drive folder, and the project and its BOQ are made.
//
//   POST /api/v1/projexa/scheduler-proposals/<proposal id>/approve
//   JSON body (all optional): { productId, projectName, acknowledgeQuestions, acknowledgeShortfall }
//
//   201 {state:"created", projectId, project, boq}      the project and BOQ were made
//   200 {state:"created", duplicate:true, projectId}    this exact file already made a project (another way got there first)
//   200 {state:"needs_answers", questions}              the extraction has open questions: nothing was made; send acknowledgeQuestions=true
//                                                       to make the project without those lines
//   404 proposal_not_found | 403 not_owner              only the person whose schedule prepared it can approve it: the file is fetched
//                                                       AGAIN with THEIR connection (nothing about it was kept), so nobody else can
//   409 already_decided | in_progress | source_not_connected | file_changed
//                                                       file_changed: the file in the source is no longer the file that was proposed
//   502 source_unavailable                              the mailbox or Drive could not hand the file over now
//   4xx/5xx {error, code}                               a refusal with a stable code; nothing was made (500 boq_create_failed carries
//                                                       the projectId that does exist, as the from-document route does)
//
// Everything that decides is in folder-watch-approve.ts; this route is transport. The project is made by the SAME createProject and
// createBoq as an upload, a chat attachment and an email. A project-scoped (project_ai) key is refused: it creates no new project.

export const maxDuration = 150

type Made = Awaited<ReturnType<typeof createProject>>
type Boq = Awaited<ReturnType<typeof createBoq>>

const bool = (v: unknown): boolean => v === true || v === "true"

function answerFor(outcome: ApproveProposalOutcome<Made, Boq>): NextResponse {
  if (outcome.ok) {
    if (outcome.duplicate) return NextResponse.json({ state: "created", duplicate: true, projectId: outcome.projectId }, { status: 200 })
    return NextResponse.json({ state: "created", duplicate: false, projectId: outcome.projectId, project: outcome.project, boq: outcome.boq }, { status: 201 })
  }
  switch (outcome.reason) {
    case "not_found":
      return NextResponse.json({ error: "No proposal prepared by a schedule with that id", code: "proposal_not_found" }, { status: 404 })
    case "not_owner":
      return NextResponse.json({ error: "Only the person whose schedule prepared this proposal can approve it: the file is read again with their own connection", code: "not_owner" }, { status: 403 })
    case "already_decided":
      return NextResponse.json({ error: "This proposal was already decided", code: "already_decided", status: outcome.status }, { status: 409 })
    case "in_progress":
      return NextResponse.json({ error: "This proposal is being approved by another request", code: "in_progress" }, { status: 409 })
    case "product_required":
      return NextResponse.json({ error: "productId is required", code: "product_required" }, { status: 400 })
    case "not_connected":
      return NextResponse.json({ error: "Connect the mailbox or Drive folder this file came from, then approve again", code: "source_not_connected" }, { status: 409 })
    case "source_unavailable":
      return NextResponse.json({ error: "The connected source could not hand the file over now. Nothing was made; try again", code: "source_unavailable", reason: outcome.code }, { status: 502 })
    case "file_changed":
      return NextResponse.json({ error: "The file in the source is no longer the file that was proposed. Nothing was made; the next scan proposes the new file", code: "file_changed" }, { status: 409 })
    case "needs_answers":
      return NextResponse.json({ state: "needs_answers", questions: outcome.questions }, { status: 200 })
    case "refused": {
      const headers = outcome.retryAfterSeconds ? { "Retry-After": String(outcome.retryAfterSeconds) } : undefined
      return NextResponse.json({ error: outcome.message, code: outcome.code, ...(outcome.issues.length > 0 ? { issues: outcome.issues } : {}) }, { status: outcome.status, headers })
    }
  }
}

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
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
    const { id } = await params
    let body: Record<string, unknown> = {}
    const text = await request.text()
    if (text.trim() !== "") {
      try {
        const parsed: unknown = JSON.parse(text)
        if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) throw new Error("not an object")
        body = parsed as Record<string, unknown>
      } catch {
        return NextResponse.json({ error: "The body must be a JSON object", code: "invalid_body" }, { status: 400 })
      }
    }
    const deps: ApproveProposalDeps<Made, Boq> = {
      callEdge: createEdgeExtractCaller({ baseUrl: process.env.NEXT_PUBLIC_SUPABASE_URL, secret: process.env.PROJEXA_DOCUMENT_EXTRACT_SECRET }),
      ledger: createDbProjectSourceLedger({ orgId, actorId: acting.person.id }),
      createProject,
      createBoq,
      openSource: (c, source) => openFolderSource({ orgId: c.orgId, userId: c.actorId }, source),
    }
    const outcome = await approveFolderProposal(
      {
        orgId,
        person: { id: acting.person.id },
        proposalId: id,
        productId: typeof body.productId === "string" ? body.productId : undefined,
        projectName: typeof body.projectName === "string" ? body.projectName : undefined,
        acknowledgeQuestions: bool(body.acknowledgeQuestions),
        acknowledgeShortfall: bool(body.acknowledgeShortfall),
      },
      deps,
    )
    return answerFor(outcome)
  } catch (error) {
    if (error instanceof ProjectCreatedWithoutBoqError) {
      console.error("v1 projexa scheduler proposal approve: project created but the BOQ insert failed:", error.projectId, error.cause)
      return NextResponse.json({ error: error.message, code: "boq_create_failed", projectId: error.projectId }, { status: 500 })
    }
    if (error instanceof ProjectCreatedUnlinkedError) {
      console.error("v1 projexa scheduler proposal approve: project created but recording it against the file failed:", error.projectId, error.cause)
      return NextResponse.json({ error: error.message, code: "project_link_failed", projectId: error.projectId }, { status: 500 })
    }
    if (error instanceof ServiceError) return NextResponse.json({ error: error.message }, { status: error.status })
    console.error("v1 projexa scheduler proposal approve error:", error)
    return NextResponse.json({ error: "Failed to approve the proposal" }, { status: 500 })
  }
}
