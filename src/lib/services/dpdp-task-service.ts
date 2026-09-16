// WO-DPDP-005 Section 3 / WO-DPDP-007 Section 4 -- "email is the interface,
// not a notification." This is the vertical slice the Owner asked for
// explicitly (2026-09-16): one seeded task, a real digest email through
// send.veridian-aios.com, a real membership-scoped click, the token spent,
// the task updated, an event written, and a second click on the same link
// refused and recorded. Nothing wider than this until this path is proven.
//
// The token IS the enforcement (WO-007 4.3), not a check here: inserting
// an email_token row runs through the real dpdp_email_token_membership_scope
// trigger (migration 0427), which rejects the insert outright if the
// membership doesn't belong to the task's own organisation. This file
// never re-implements that check -- it relies on the database rejecting
// a bad insert, matching the WO's own "structural, not a rule somebody
// might forget" standard.
import { randomBytes, createHash } from "node:crypto"
import { eq, and, isNull } from "drizzle-orm"
import { db, dpdpTask, dpdpEmailToken, dpdpMembership } from "@/lib/db"
import { withDpdpContext, type TenantDb } from "@/lib/db/tenant-scoped"
import { sendEmail, emailTemplate } from "@/lib/email"
import { logDpdpEvent } from "./dpdp-event-service"
import { ServiceError } from "./compliance-service"
export { ServiceError }

const EMAIL_TOKEN_TTL_HOURS = 48
const APP_URL = process.env.NEXT_PUBLIC_APP_URL ?? "https://veridian-aios.com"

function newOpaqueToken(): string {
  return randomBytes(24).toString("base64url")
}
function hashToken(raw: string): string {
  return createHash("sha256").update(raw).digest("hex")
}

export type CreateTaskInput = {
  orgId: string
  obligationId: string
  seq: number
  text: string
  subtext?: string
  optionYes: string
  optionNo: string
}

/** One row, seeded once per obligation -- the thing both the email and the dashboard render. */
export async function createTask(input: CreateTaskInput, tx?: TenantDb) {
  const write = (runner: TenantDb) =>
    runner
      .insert(dpdpTask)
      .values({ orgId: input.orgId, obligationId: input.obligationId, seq: input.seq, text: input.text, subtext: input.subtext, optionYes: input.optionYes, optionNo: input.optionNo })
      .returning()
  const rows = tx ? await write(tx) : await withDpdpContext({ orgId: input.orgId }, (innerTx) => write(innerTx))
  return rows[0]
}

/**
 * Issues one membership-scoped, single-use, 48-hour token for one action
 * on one task. The database trigger (0427) is what actually enforces
 * "this membership may only act on this org's tasks" -- if the insert
 * below throws, it's because the trigger caught a real cross-org attempt,
 * not because this function checked anything itself.
 */
export async function issueTaskEmailToken(orgId: string, taskId: string, membershipId: string, identityId: string, action: "yes" | "no") {
  const raw = newOpaqueToken()
  const expiresAt = new Date(Date.now() + EMAIL_TOKEN_TTL_HOURS * 3600_000)
  await withDpdpContext({ orgId }, (tx) =>
    tx.insert(dpdpEmailToken).values({ taskId, identityId, membershipId, action, tokenHash: hashToken(raw), expiresAt }),
  )
  return { raw, expiresAt }
}

/**
 * Sends the actual digest email for ONE task to ONE membership -- the
 * thinnest possible version of WO-005 3's cadence engine (real cadence/
 * bundling across many tasks is explicitly NOT built yet; this proves the
 * one-task path end to end first, per the Owner's own instruction).
 */
export async function sendTaskDigestEmail(orgId: string, taskId: string, membershipId: string, identityId: string, toEmail: string) {
  const yes = await issueTaskEmailToken(orgId, taskId, membershipId, identityId, "yes")
  const no = await issueTaskEmailToken(orgId, taskId, membershipId, identityId, "no")
  const task = await withDpdpContext({ orgId }, (tx) => tx.query.dpdpTask.findFirst({ where: eq(dpdpTask.id, taskId) }))
  if (!task) throw new ServiceError("Task not found", 404)

  const yesUrl = `${APP_URL}/api/dpdp/task-link/${yes.raw}`
  const noUrl = `${APP_URL}/api/dpdp/task-link/${no.raw}`

  await sendEmail({
    to: toEmail,
    subject: task.text,
    html: emailTemplate(
      task.text,
      `${task.subtext ?? ""}<br><br>` +
        `<a href="${yesUrl}" style="display:inline-block;margin-right:12px;padding:10px 20px;background:#059669;color:#fff;border-radius:8px;text-decoration:none;font-weight:600;">${task.optionYes}</a>` +
        `<a href="${noUrl}" style="display:inline-block;padding:10px 20px;background:#fff;color:#BE123C;border:1.5px solid #FBC5CF;border-radius:8px;text-decoration:none;font-weight:600;">${task.optionNo}</a>`,
    ),
  })
  return { taskId, sentTo: toEmail }
}

export type AnswerTaskResult = { ok: true; taskId: string; answer: "yes" | "no" } | { ok: false; reason: string }

/**
 * The click. Looks up the token by hash (no session, no org context --
 * same TOKEN_SCOPED shape as every other public link in this codebase),
 * and either answers the task or refuses -- both paths write a real
 * dpdp.event row, because "clicking the same link again is refused and
 * the refusal is recorded" (the Owner's own step 6).
 */
export async function answerTaskViaEmailToken(rawToken: string): Promise<AnswerTaskResult> {
  const tokenHash = hashToken(rawToken)
  const tokenRow = await db.query.dpdpEmailToken.findFirst({ where: eq(dpdpEmailToken.tokenHash, tokenHash) })
  if (!tokenRow) return { ok: false, reason: "This link is not valid." }

  const membership = await db.query.dpdpMembership.findFirst({ where: eq(dpdpMembership.id, tokenRow.membershipId) })
  if (!membership) return { ok: false, reason: "This link is not valid." }
  const orgId = membership.orgId

  if (tokenRow.usedAt) {
    await withDpdpContext({ orgId }, (tx) =>
      logDpdpEvent({ orgId, actorIdentityId: tokenRow.identityId, actorLabel: "A person on a link", kind: "task_answer_refused", summary: "A spent task link was clicked again", detail: `task ${tokenRow.taskId}, action ${tokenRow.action}` }, tx),
    )
    return { ok: false, reason: "This link has already been used. Nothing has changed." }
  }
  if (tokenRow.expiresAt < new Date()) {
    await withDpdpContext({ orgId }, (tx) =>
      logDpdpEvent({ orgId, actorIdentityId: tokenRow.identityId, actorLabel: "A person on a link", kind: "task_answer_refused", summary: "An expired task link was clicked", detail: `task ${tokenRow.taskId}, action ${tokenRow.action}` }, tx),
    )
    return { ok: false, reason: "This link has expired. Ask for a new one." }
  }

  // "sign_in" tokens (WO-005 3: legal acts give a sign-in screen, not a
  // button) are a different mechanism entirely, not a yes/no task answer
  // -- out of scope for this vertical slice, which only proves the
  // routine one-click path. Narrowed here rather than assumed.
  if (tokenRow.action !== "yes" && tokenRow.action !== "no") {
    return { ok: false, reason: "This kind of action needs a fresh sign-in, not a one-click link." }
  }
  const action = tokenRow.action

  return withDpdpContext({ orgId }, async (tx) => {
    await tx.update(dpdpEmailToken).set({ usedAt: new Date() }).where(eq(dpdpEmailToken.id, tokenRow.id))
    await tx
      .update(dpdpTask)
      .set({ answer: action, answeredBy: tokenRow.identityId, answeredAt: new Date(), answeredVia: "email", tokenId: tokenRow.id })
      .where(eq(dpdpTask.id, tokenRow.taskId))
    await logDpdpEvent(
      { orgId, actorIdentityId: tokenRow.identityId, actorLabel: "A person on a link", kind: "task_answered", summary: `Answered "${action}" via email`, detail: `task ${tokenRow.taskId}` },
      tx,
    )
    return { ok: true, taskId: tokenRow.taskId, answer: action }
  })
}
