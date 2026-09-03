// R67 D-78 (audit R-294/R-295). The PROJEXA-reachable half of the storage
// guard. PROJEXA's three upload screens (/permits/new, /drawings/new,
// /documents/upload) render server-side and need to know, BEFORE the user picks
// a file, whether an upload can succeed at all on this server.
//
// WHY THIS EXISTS ALONGSIDE /api/health. That route already reports the same
// boolean, but it lives outside /api/v1 entirely, and projexa's veridian-client
// can only reach ${VERIDIAN_API_BASE} (/api/v1/projexa) or its `root: true`
// parent (/api/v1) -- neither of which resolves /api/health. Rather than widen
// that client's base-URL handling for one call, this is the same probe behind
// the same 60 s cache, exposed on the surface PROJEXA already speaks to. There
// is exactly one implementation (src/lib/storage-config.ts); this and /api/health
// are two doors onto it, not two answers.
//
// Authenticated like every other route on this surface, and gated at the lowest
// tier: the response is one boolean about the SERVER, carries nothing about any
// tenant's data, and every role that can open an upload form needs it.
import { NextRequest, NextResponse } from "next/server"
import { requireAuthOrApiKey } from "@/lib/supabase/auth-guard"
import { getStorageStatus } from "@/lib/storage-config"

export async function GET(request: NextRequest) {
  const ctx = await requireAuthOrApiKey(request)
  if (ctx.response) return ctx.response

  try {
    const status = await getStorageStatus()
    // `reason` is for the operator reading logs, not for an end user -- the
    // screens render one fixed sentence. It is returned because PROJEXA logs it
    // server-side too, and it never names an env var or a host.
    return NextResponse.json({ storageConfigured: status.storageConfigured, reason: status.reason })
  } catch (error) {
    console.error("v1 projexa storage-status error:", error)
    return NextResponse.json({ error: "Failed to read storage status" }, { status: 500 })
  }
}
