// PROJEXA-BUILD-001 U-29 / U-47 (register row BR-424). The paste-back fallback of surface 1, for an AI that cannot
// open the person's link URL: the AI prints one fenced block per change
// (ai-os/projexa-build-001/UNIVERSAL_AI_WORK_LINK_SPEC.md section 9.4), the person pastes the text, and this route
// stores each valid block as one pending proposal on the project's approval list (GET .../approvals).
//
// POST { text } stores one proposal per valid block and writes nothing to a BOQ: the person still presses Approve
// on the list. Every block is checked before the first is stored, with the registry's own validate() and the BOQ
// service's line-item rules, so a paste with any block that fails answers 422 and stores 0 proposals. The proposal is
// stored under the signed-in person, or the person an API key names in X-Acting-User / X-Acting-User-Email; a key
// that names nobody is refused with 400. A project of another organisation, or one a project-pinned key may not
// reach, is a 404 before any block is read.
import { NextRequest, NextResponse } from "next/server"
import { requireAuthOrApiKey, requireRoleOrScope, requireOrg, requireActingPerson } from "@/lib/supabase/auth-guard"
import { ServiceError } from "@/lib/services/compliance-service"
import { redactProjectSideFields } from "@/lib/services/cost-visibility-service"
import { withRouteTiming } from "@/lib/route-timing"
import { functionLabel } from "@/lib/pipeline/function-registry"
import {
  approveActionFor,
  findReadableProject,
  MAX_PASTE_CHARS,
  parsePasteBack,
  storePastedProposals,
  validatePastedBlock,
} from "@/lib/pipeline/prepared-proposals"

export async function POST(...args: Parameters<typeof POST_impl>) {
  return withRouteTiming("POST", () => POST_impl(...args))
}

async function POST_impl(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await requireAuthOrApiKey(request)
  if (ctx.response) return ctx.response
  if (!ctx.orgId) return requireOrg(ctx)!

  const roleErr = requireRoleOrScope(ctx, "member", "write")
  if (roleErr) return roleErr

  try {
    // The JSON envelope may escape every newline of the text, so the envelope is allowed twice the text's size.
    const raw = await request.text()
    if (raw.length > MAX_PASTE_CHARS * 2) return NextResponse.json({ error: "The pasted text is too large" }, { status: 413 })
    let body: Record<string, unknown>
    try {
      const parsed: unknown = JSON.parse(raw)
      if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) throw new Error("not an object")
      body = parsed as Record<string, unknown>
    } catch {
      return NextResponse.json({ error: "Body must be a JSON object" }, { status: 400 })
    }
    const text = body.text
    if (typeof text !== "string") return NextResponse.json({ error: "text is required" }, { status: 400 })
    if (text.length > MAX_PASTE_CHARS) return NextResponse.json({ error: "The pasted text is too large" }, { status: 413 })

    // The proposal is stored under a person, never under a key. A key that names nobody is a 400 here.
    const { acting, error: actingError } = await requireActingPerson(request, ctx, body)
    if (actingError) return actingError

    const { id } = await params
    const project = await findReadableProject({ orgId: ctx.orgId, apiKey: ctx.apiKey }, id)
    if (!project) return NextResponse.json({ error: "Project not found" }, { status: 404 })

    // Every block is read and checked before any is stored: a paste is all or nothing.
    const parsed = parsePasteBack(text)
    if (!parsed.ok) {
      return NextResponse.json(
        { stored: 0, error: "The pasted text is not a valid proposal", block: parsed.block, failure: parsed.failure },
        { status: 422 }
      )
    }
    const checkedBlocks: Array<{ functionId: string; params: Record<string, unknown>; note: string | null }> = []
    for (const [index, block] of parsed.blocks.entries()) {
      const checked = validatePastedBlock(block, project)
      if (!checked.ok) {
        return NextResponse.json(
          { stored: 0, error: "The pasted text is not a valid proposal", block: index, failure: checked.failure, detail: checked.detail },
          { status: 422 }
        )
      }
      checkedBlocks.push({ functionId: block.functionId, params: checked.params, note: block.note })
    }

    const ids = await storePastedProposals({ orgId: ctx.orgId, projectId: project.id, person: { id: acting.person.id }, blocks: checkedBlocks })
    return NextResponse.json(
      {
        stored: ids.length,
        proposals: ids.map((submissionId, index) => ({
          submissionId,
          source: "paste_back",
          functionId: checkedBlocks[index].functionId,
          label: functionLabel(checkedBlocks[index].functionId),
          params: redactProjectSideFields(checkedBlocks[index].params),
          note: checkedBlocks[index].note,
          approve: approveActionFor(project.id, submissionId),
        })),
      },
      { status: 201 }
    )
  } catch (error) {
    if (error instanceof ServiceError) return NextResponse.json({ error: error.message }, { status: error.status })
    console.error("v1 projexa paste-back error:", error)
    return NextResponse.json({ error: "Failed to store the pasted proposals" }, { status: 500 })
  }
}
