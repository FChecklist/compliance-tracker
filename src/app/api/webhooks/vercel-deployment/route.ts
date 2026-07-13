import { NextRequest, NextResponse } from "next/server"
import { asc } from "drizzle-orm"
import { db, organisations, deploymentEvents } from "@/lib/db"
import { withTenantContext } from "@/lib/db/tenant-scoped"
import { recordAuditTrigger } from "@/lib/audit-event-triggers"
import { verifyVercelSignature } from "@/lib/webhooks/vercel-signature"

// GAP-D15-REMAINING-TRIGGERS (Priority 11, closing): the real receiver
// audit-event-triggers.ts's module header said didn't exist yet -- "no
// in-app deployment-event table or webhook handler exists beyond the
// already-wired CI workflow for event #1 (Code Changed)." This route is
// that handler.
//
// Auth model, and why this route does NOT call requireAuth(): CLAUDE.md's
// "All API routes MUST call requireAuth()" is written for routes a signed-
// in user or an org's own API key calls. This route is called by Vercel
// itself, server-to-server, with no session cookie and no org API key --
// the same shape as every real inbound provider webhook (Stripe, GitHub,
// Razorpay, ...), none of which authenticate via a login session. The
// real authentication boundary here is the HMAC signature check below:
// Vercel signs every webhook delivery's raw body with HMAC-SHA1 using a
// secret only Vercel and this app know (`x-vercel-signature` header, per
// https://vercel.com/docs/headers/request-headers#x-vercel-signature) --
// an unsigned or wrongly-signed request is rejected (403) before a single
// byte of the payload is trusted. This is the documented, standard way to
// authenticate a Vercel webhook; there is no session-based alternative
// for a machine-to-machine delivery like this one.
//
// Org-attribution caveat (same class as new_prompt's in audit-event-
// triggers.ts): a Vercel deployment belongs to this app's own Vercel
// project as a whole, not to any single tenant org, but
// recordAuditTrigger()'s audit_logs write is RLS/org-scoped by
// construction (every other wired trigger has a real acting org because
// it fires inside a real org's own request). There is no equivalent real
// org here. Rather than fabricate one, this resolves a real, existing
// organisations row -- PLATFORM_AUDIT_ORG_ID env var if explicitly
// configured (the honest way to make this deterministic), otherwise the
// platform's earliest-created organisations row as a best-effort default
// -- and skips the audit_trigger write entirely (logging why) if no
// organisation exists at all. The deploymentEvents row below is written
// unconditionally either way, since it needs no org to be a real record of
// the deployment fact.
const SUCCEEDED_EVENT = "deployment.succeeded"

// Event types this receiver acts on. Vercel's account-webhook config for
// this endpoint (see this PR's description / MASTER-TRACKER.yaml for
// whether that live registration is done yet) should subscribe to exactly
// these three -- a delivery for any other event type this endpoint
// happens to receive is acknowledged (200) but ignored, not rejected, so
// an operator broadening the webhook's subscribed events later doesn't
// start producing 4xxs Vercel would eventually disable the webhook for.
const RECOGNIZED_EVENTS = new Set(["deployment.created", SUCCEEDED_EVENT, "deployment.error"])

async function resolvePlatformAuditOrgId(): Promise<string | null> {
  if (process.env.PLATFORM_AUDIT_ORG_ID) return process.env.PLATFORM_AUDIT_ORG_ID
  const first = await db.query.organisations.findFirst({
    orderBy: asc(organisations.createdAt),
    columns: { id: true },
  })
  return first?.id ?? null
}

type VercelDeploymentWebhookPayload = {
  id?: string
  type?: string
  createdAt?: number
  payload?: {
    deployment?: { id?: string; name?: string; url?: string; state?: string }
    project?: { id?: string }
    target?: string | null
  }
}

export async function POST(request: NextRequest) {
  const secret = process.env.VERCEL_DEPLOYMENT_WEBHOOK_SECRET
  const headerSignature = request.headers.get("x-vercel-signature")
  // Signature is computed over the RAW body -- must read as text before any
  // JSON parsing, or the byte-for-byte input to Vercel's own HMAC no longer
  // matches what we re-hash here.
  const rawBody = await request.text()

  if (!secret) {
    // Fail closed: with no secret configured, no delivery can ever be
    // verified, so every delivery must be rejected rather than silently
    // trusted. This should only happen before VERCEL_DEPLOYMENT_WEBHOOK_SECRET
    // is set in the deployment environment (see this PR's description for
    // the live-registration step that provisions it).
    console.error("[vercel-deployment-webhook] VERCEL_DEPLOYMENT_WEBHOOK_SECRET is not configured -- rejecting all deliveries (fail-closed).")
    return NextResponse.json({ error: "Webhook receiver not configured" }, { status: 500 })
  }

  if (!verifyVercelSignature(rawBody, headerSignature, secret)) {
    return NextResponse.json({ error: "Invalid signature" }, { status: 403 })
  }

  let payload: VercelDeploymentWebhookPayload
  try {
    payload = JSON.parse(rawBody)
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 })
  }

  const eventType = typeof payload.type === "string" ? payload.type : null
  if (!eventType || !RECOGNIZED_EVENTS.has(eventType)) {
    return NextResponse.json({ ok: true, ignored: true, eventType })
  }

  const deployment = payload.payload?.deployment ?? {}
  const project = payload.payload?.project ?? {}
  const target = payload.payload?.target ?? null

  const [inserted] = await db
    .insert(deploymentEvents)
    .values({
      vercelDeploymentId: typeof deployment.id === "string" ? deployment.id : (payload.id ?? "unknown"),
      eventType,
      projectId: typeof project.id === "string" ? project.id : null,
      projectName: typeof deployment.name === "string" ? deployment.name : null,
      target: typeof target === "string" ? target : null,
      deploymentUrl: typeof deployment.url === "string" ? deployment.url : null,
      state: typeof deployment.state === "string" ? deployment.state : null,
      signatureVerified: true,
    })
    .returning()

  if (eventType === SUCCEEDED_EVENT && inserted) {
    const platformOrgId = await resolvePlatformAuditOrgId()
    if (platformOrgId) {
      await withTenantContext({ orgId: platformOrgId }, (tx) =>
        recordAuditTrigger({
          tx,
          event: "deployment",
          entityType: "DeploymentEvent",
          entityId: inserted.id,
          orgId: platformOrgId,
          apiKey: { id: "system:vercel-deployment-webhook", name: "Vercel Deployment Webhook" },
          details: `Deployment "${deployment.name ?? project.id ?? "unknown project"}" succeeded (${inserted.vercelDeploymentId})${target ? `, target=${target}` : ""}.`,
          request,
        })
      ).catch((err) => console.error(`[audit-trigger] failed to record deployment for deployment event ${inserted.id}:`, err))
    } else {
      console.warn(
        `[vercel-deployment-webhook] No organisation exists to attribute the deployment audit trigger to -- deploymentEvents row ${inserted.id} recorded, audit_trigger.deployment skipped.`
      )
    }
  }

  return NextResponse.json({ ok: true, id: inserted?.id, eventType })
}
