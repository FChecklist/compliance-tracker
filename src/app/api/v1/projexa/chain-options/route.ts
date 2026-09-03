// R67 lane B (B-03 / B-11) -- GET /api/v1/projexa/chain-options.
//
// The level after the pill. PROJEXA's composer could start a chain and could
// run a finished one, and had nothing to ask in between; this answers "the
// user has picked Work Progress and Record progress -- what are their real
// choices?" with the project's own records.
//
// B-11 adds the clause band 2 actually needs on every keystroke: as well as
// the options, the answer says WHICH FIELD is still missing
// ({level, missing:[field], done}) and, when nothing is, hands back the
// confirmation card schema and the params POST /api/v1/projexa/tasks will
// receive. `missing` is always in the D-03 field vocabulary (project,
// boqLine, value, worker, ...), never a camelCase parameter name.
//
// Guarded exactly as tasks/route.ts is (requireAuthOrApiKey +
// requireRoleOrScope 'member'/'read'). READ ONLY: it mints nothing, runs
// nothing, and its answer is a HINT -- POST /api/v1/projexa/tasks
// re-validates permission and existence when the user actually submits.
import { NextRequest, NextResponse } from "next/server"
import { requireAuthOrApiKey, requireRoleOrScope } from "@/lib/supabase/auth-guard"
import {
  makeChainOptionsRepo,
  resolveChainLevel,
  type ChainFieldKey,
} from "@/lib/services/chain-options-service"

/** `path` is a JSON array of the segments already chosen, e.g. ["work_progress","record_progress"]. */
function parsePath(raw: string | null): string[] {
  if (!raw) return []
  try {
    const parsed = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    return parsed.filter((s): s is string => typeof s === "string" && s.length > 0).slice(0, 6)
  } catch {
    return []
  }
}

/**
 * B-11's spelling of the same thing, and the one the composer uses:
 * `segments=work-progress,record`. Accepted beside `path` rather than
 * instead of it -- both name the chain the user has built so far, and a
 * client that already sends one must not break to gain the other.
 */
function parseSegments(raw: string | null): string[] {
  if (!raw) return []
  return raw
    .split(",")
    .map((s) => s.trim())
    .filter((s) => s.length > 0)
    .slice(0, 6)
}

/**
 * The fields the user has already answered, addressed by the D-03 vocabulary
 * key -- never by a parameter name, so the query string a client builds from
 * a `missing` entry round-trips without translation.
 */
const FIELD_PARAMS: readonly ChainFieldKey[] = ["project", "boqLine", "boqVersion", "value", "date", "worker", "material", "task"]

function parseResolved(url: URL): Partial<Record<ChainFieldKey, string>> {
  const resolved: Partial<Record<ChainFieldKey, string>> = {}
  for (const field of FIELD_PARAMS) {
    const value = url.searchParams.get(field)
    if (value !== null && value.trim().length > 0) resolved[field] = value.trim()
  }
  return resolved
}

export async function GET(request: NextRequest) {
  const ctx = await requireAuthOrApiKey(request)
  if (ctx.response) return ctx.response
  if (!ctx.orgId) return NextResponse.json({ error: "No organisation on this account" }, { status: 400 })

  const roleErr = requireRoleOrScope(ctx, "member", "read")
  if (roleErr) return roleErr

  const url = new URL(request.url)
  const segments = parseSegments(url.searchParams.get("segments"))
  const path = segments.length > 0 ? segments : parsePath(url.searchParams.get("path"))
  const resolved = parseResolved(url)
  // `projectId` is the top rail's project; `project=` is the same fact
  // answered at the project level itself, and wins because the user just
  // chose it.
  const projectId = resolved.project ?? url.searchParams.get("projectId")

  try {
    const repo = makeChainOptionsRepo({ orgId: ctx.orgId, userId: ctx.dbUser?.id ?? ctx.apiKey?.id })
    const result = await resolveChainLevel({ segments: path, projectId, resolved }, repo)
    return NextResponse.json({ segments: path, path, projectId, ...result })
  } catch (error) {
    console.error("v1 projexa chain-options GET error:", error)
    const message = error instanceof Error ? error.message : "Failed to read the next options"
    return NextResponse.json({ error: message }, { status: 400 })
  }
}
