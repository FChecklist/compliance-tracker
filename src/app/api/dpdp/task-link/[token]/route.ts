// The click, from the email, WO-DPDP-005/007 vertical slice. Public,
// token-in-URL, no session -- deliberately the same TOKEN_SCOPED shape as
// every other one-click action link in this codebase (consent tokens, AI
// links). Returns a plain HTML page (not JSON) since a real person lands
// here straight from their inbox.
import { NextResponse } from "next/server"
import { answerTaskViaEmailToken } from "@/lib/services/dpdp-task-service"

function page(title: string, body: string, ok: boolean) {
  return `<!DOCTYPE html><html><body style="font-family:Inter,sans-serif;background:#FFFDF9;margin:0;padding:60px 20px;text-align:center;">
<div style="max-width:420px;margin:0 auto;background:#fff;border-radius:12px;border:1px solid #E2E8F0;padding:32px;">
  <div style="font-size:32px;margin-bottom:8px;">${ok ? "✅" : "⚠️"}</div>
  <h2 style="color:#1C2B3A;margin:0 0 8px;">${title}</h2>
  <p style="color:#64748B;">${body}</p>
</div></body></html>`
}

export async function GET(_request: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params
  const result = await answerTaskViaEmailToken(token)
  if (!result.ok) {
    return new NextResponse(page("Nothing has changed", result.reason, false), { status: 200, headers: { "Content-Type": "text/html; charset=utf-8" } })
  }
  return new NextResponse(
    page("Recorded", `Your answer ("${result.answer === "yes" ? "yes" : "no"}") has been saved and dated. You do not need to do anything else.`, true),
    { status: 200, headers: { "Content-Type": "text/html; charset=utf-8" } },
  )
}
