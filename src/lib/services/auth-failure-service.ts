// VERIDIAN Review Framework gap-closure: Anomaly Detection, "repeated
// failed auth" event type. Before this, password/OAuth login failures were
// never logged anywhere server-side (confirmed by investigation -- a bad
// password just showed a client-side toast) -- only the newer 4-digit
// passcode method had a real rate-limit log (passcode_login_attempts). This
// is a NEW, unified table across every login method, so the repeated-
// failed-auth monitor sees the whole picture, not just one method.
//
// Same pre-auth posture as passcode-login-service.ts's own recordAttempt/
// checkPasscodeRateLimit: runs through the raw (RLS-bypassing) `db` client,
// since no session/tenant context exists yet at the point a login fails.
import { db, authFailureEvents, users, riskAnomalyEvents } from "@/lib/db"
import { withTenantContext } from "@/lib/db/tenant-scoped"
import { eq, and, gte, sql } from "drizzle-orm"
import { evaluateRepeatedFailedAuth, FAILED_AUTH_THRESHOLD } from "@/lib/risk-anomaly-detection"
import { recordAndEscalateAnomaly } from "./risk-escalation-service"

export type AuthFailureMethod = "password" | "oauth" | "sso" | "passcode"
const VALID_METHODS: readonly AuthFailureMethod[] = ["password", "oauth", "sso", "passcode"]
export function isValidAuthFailureMethod(value: string): value is AuthFailureMethod {
  return (VALID_METHODS as readonly string[]).includes(value)
}

const RATE_WINDOW_MINUTES = 15

async function countRecentAuthFailures(email: string): Promise<number> {
  const cutoff = new Date(Date.now() - RATE_WINDOW_MINUTES * 60 * 1000)
  const [{ count }] = await db.select({ count: sql<number>`count(*)` })
    .from(authFailureEvents)
    .where(and(eq(authFailureEvents.email, email), gte(authFailureEvents.createdAt, cutoff)))
  return Number(count)
}

/**
 * Records a failed login attempt and, if it crosses the repeated-failed-auth
 * threshold, escalates to the matched account's org (department head / org
 * admin fallback, via risk-escalation-service.ts). Fire-and-forget from the
 * caller's perspective is fine (matches recordAttempt's own posture) but
 * this function itself awaits its own writes so the caller can surface a
 * real error if the DB write fails, rather than losing it silently.
 *
 * Deliberately generic either way (never reveals whether the email matched
 * a real account) -- same posture passcode-login-service.ts's
 * verifyPasscodeLogin already established for this exact reason.
 *
 * Escalates AT MOST ONCE per rate-limit window per account: once
 * recentCount crosses the threshold, every subsequent failed attempt in the
 * same window would otherwise also satisfy evaluateRepeatedFailedAuth and
 * re-escalate on every single try, paging the resolved owner repeatedly for
 * what is one ongoing incident, not a new one each time.
 */
export async function recordAuthFailureAndCheckAnomaly(params: { email: string; method: AuthFailureMethod; ipAddress?: string }): Promise<void> {
  const email = params.email.trim()
  if (!email) return

  await db.insert(authFailureEvents).values({ email, method: params.method, ipAddress: params.ipAddress })

  const recentCount = await countRecentAuthFailures(email)
  const verdict = evaluateRepeatedFailedAuth(recentCount, FAILED_AUTH_THRESHOLD)
  if (!verdict.anomaly) return

  const user = await db.query.users.findFirst({ where: eq(users.email, email) })
  if (!user?.orgId) return // no org to scope the escalation to (unknown email, or a stage-0-only account)

  await withTenantContext({ orgId: user.orgId, userId: user.id }, async (tx) => {
    const cutoff = new Date(Date.now() - RATE_WINDOW_MINUTES * 60 * 1000)
    const alreadyEscalated = await tx.query.riskAnomalyEvents.findFirst({
      where: and(
        eq(riskAnomalyEvents.orgId, user.orgId!),
        eq(riskAnomalyEvents.eventType, "repeated_failed_auth"),
        eq(riskAnomalyEvents.sourceEntityId, user.id),
        gte(riskAnomalyEvents.createdAt, cutoff)
      ),
    })
    if (alreadyEscalated) return

    await recordAndEscalateAnomaly(tx, {
      orgId: user.orgId!,
      eventType: verdict.eventType,
      severity: verdict.severity,
      sourceEntityType: "user",
      sourceEntityId: user.id,
      actorUserId: user.id,
      reason: verdict.reason,
      detail: { method: params.method, recentFailureCount: recentCount },
    })
  })
}
