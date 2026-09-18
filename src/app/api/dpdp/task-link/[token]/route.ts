// The click, from the email, WO-DPDP-005/007 vertical slice. Public,
// token-in-URL, no session -- deliberately the same TOKEN_SCOPED shape as
// every other one-click action link in this codebase (consent tokens, AI
// links). Returns a plain HTML page (not JSON) since a real person lands
// here straight from their inbox.
//
// SECURITY FIX 2026-09-18 (owner-flagged, HIGH severity): GET used to call
// answerTaskViaEmailToken directly, so an email scanner or corporate
// security gateway prefetching the link -- Gmail, Outlook, and most
// corporate gateways all do this -- could mark a task answered under a
// named person's identity before they ever opened the email. GET now only
// renders a confirmation page (previewTaskEmailToken, read-only, no
// writes); only a real POST (the confirmation button's form submit)
// answers the task. Same shape as the broadcast-link route planned for
// WO-DPDP-009 Phase 3.
import { NextResponse } from "next/server"
import { answerTaskViaEmailToken, previewTaskEmailToken } from "@/lib/services/dpdp-task-service"

function htmlResponse(body: string) {
  return new NextResponse(body, { status: 200, headers: { "Content-Type": "text/html; charset=utf-8" } })
}

function page(title: string, body: string, ok: boolean) {
  return `<!DOCTYPE html><html><body style="font-family:Inter,sans-serif;background:#FFFDF9;margin:0;padding:60px 20px;text-align:center;">
<div style="max-width:420px;margin:0 auto;background:#fff;border-radius:12px;border:1px solid #E2E8F0;padding:32px;">
  <div style="font-size:32px;margin-bottom:8px;">${ok ? "✅" : "⚠️"}</div>
  <h2 style="color:#1C2B3A;margin:0 0 8px;">${title}</h2>
  <p style="color:#64748B;">${body}</p>
</div></body></html>`
}

function confirmPage(action: "yes" | "no") {
  return `<!DOCTYPE html><html><body style="font-family:Inter,sans-serif;background:#FFFDF9;margin:0;padding:60px 20px;text-align:center;">
<div style="max-width:420px;margin:0 auto;background:#fff;border-radius:12px;border:1px solid #E2E8F0;padding:32px;">
  <div style="font-size:32px;margin-bottom:8px;">${action === "yes" ? "✅" : "⚠️"}</div>
  <h2 style="color:#1C2B3A;margin:0 0 8px;">Confirm your answer</h2>
  <p style="color:#64748B;margin:0 0 20px;">You're about to record <strong>"${action}"</strong> for this task. This cannot be undone, and this same link cannot be used again after you confirm.</p>
  <form method="POST">
    <button type="submit" style="display:inline-block;padding:10px 24px;background:#1C2B3A;color:#fff;border:none;border-radius:8px;font-weight:600;font-size:15px;cursor:pointer;">Confirm</button>
  </form>
</div></body></html>`
}

export async function GET(_request: Request, { params }: { params: Promise<{ token: string }> }) {
  try {
    const { token } = await params
    const preview = await previewTaskEmailToken(token)
    if (!preview.ok) {
      return htmlResponse(page("Nothing has changed", preview.reason, false))
    }
    return htmlResponse(confirmPage(preview.action))
  } catch {
    return htmlResponse(page("Something went wrong", "This link could not be opened. Please try again in a moment.", false))
  }
}

export async function POST(_request: Request, { params }: { params: Promise<{ token: string }> }) {
  try {
    const { token } = await params
    const result = await answerTaskViaEmailToken(token)
    if (!result.ok) {
      return htmlResponse(page("Nothing has changed", result.reason, false))
    }
    return htmlResponse(
      page("Recorded", `Your answer ("${result.answer === "yes" ? "yes" : "no"}") has been saved and dated. You do not need to do anything else.`, true),
    )
  } catch {
    return htmlResponse(page("Something went wrong", "This link could not be opened. Please try again in a moment.", false))
  }
}
