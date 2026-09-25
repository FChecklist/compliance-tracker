import { NextRequest, NextResponse } from "next/server"
import { requireAuthOrApiKey, requireRoleOrScope, requireActingPerson } from "@/lib/supabase/auth-guard"
import { createProject, ServiceError } from "@/lib/services/construction-dashboard-service"
import { createBoq } from "@/lib/services/construction-boq-service"
import {
  createProjectFromDocument,
  createDbProjectSourceLedger,
  createEdgeExtractCaller,
} from "@/lib/services/document-extraction-service"
import { ExtractionRejectedError, ProjectCreatedWithoutBoqError, WORKBOOK_LIMITS } from "@/lib/services/document-extraction-schema"

// PROJEXA-BUILD-001 U-37 (PMD-03, register rows BR-507 and BR-508): create a project and its BOQ from an uploaded xlsx workbook.
//
// multipart/form-data: `file` (the .xlsx workbook, at most 5 MB), `productId` (the product the project belongs to, as for the plain
// project-create route), optional `name` (replaces the project name the extraction found).
//
//   201 {duplicate:false, projectId, project, boq, extraction:{sheets,rows,lines}}   a project and BOQ were created
//   200 {duplicate:true, projectId}                                                   this exact file was submitted before: the FIRST
//                                                                                     project is returned and nothing is inserted
//   4xx/5xx {error, code, issues?}                                                    a refusal with a stable code; nothing was created
//                                                                                     (500 boq_create_failed carries the projectId of the
//                                                                                     project that does exist, see ProjectCreatedWithoutBoqError)
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
    const form = await request.formData()
    const file = form.get("file")
    if (!(file instanceof File)) return NextResponse.json({ error: "No file provided", code: "no_file" }, { status: 400 })
    const productId = String(form.get("productId") ?? "").trim()
    if (!productId) return NextResponse.json({ error: "productId is required", code: "product_required" }, { status: 400 })
    if (file.size > WORKBOOK_LIMITS.maxBytes) {
      return NextResponse.json({ error: "The file is larger than 5 MB", code: "workbook_too_large" }, { status: 413 })
    }
    const projectName = String(form.get("name") ?? "").trim()

    const result = await createProjectFromDocument(
      {
        orgId,
        actorId: acting.person.id,
        productId,
        fileName: file.name || "upload.xlsx",
        bytes: new Uint8Array(await file.arrayBuffer()),
        projectName: projectName || undefined,
      },
      {
        callEdge: createEdgeExtractCaller({
          baseUrl: process.env.NEXT_PUBLIC_SUPABASE_URL,
          secret: process.env.PROJEXA_DOCUMENT_EXTRACT_SECRET,
        }),
        ledger: createDbProjectSourceLedger({ orgId, actorId: acting.person.id }),
        createProject,
        createBoq,
      },
    )
    if (result.duplicate) return NextResponse.json({ duplicate: true, projectId: result.projectId }, { status: 200 })
    return NextResponse.json(
      { duplicate: false, projectId: result.projectId, project: result.project, boq: result.boq, extraction: result.extraction },
      { status: 201 },
    )
  } catch (error) {
    if (error instanceof ExtractionRejectedError) {
      return NextResponse.json(
        { error: error.message, code: error.code, ...(error.issues.length > 0 ? { issues: error.issues } : {}) },
        { status: error.status },
      )
    }
    if (error instanceof ProjectCreatedWithoutBoqError) {
      console.error("v1 projexa project from document: project created but the BOQ insert failed:", error.projectId, error.cause)
      return NextResponse.json({ error: error.message, code: "boq_create_failed", projectId: error.projectId }, { status: 500 })
    }
    if (error instanceof ServiceError) return NextResponse.json({ error: error.message }, { status: error.status })
    console.error("v1 projexa project from document error:", error)
    return NextResponse.json({ error: "Failed to create project from document" }, { status: 500 })
  }
}
