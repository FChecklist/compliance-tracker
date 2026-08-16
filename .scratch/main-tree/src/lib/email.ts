import { Resend } from "resend"

let resend: Resend | null = null

function getResend(): Resend | null {
  if (!process.env.RESEND_API_KEY) return null
  if (!resend) resend = new Resend(process.env.RESEND_API_KEY)
  return resend
}

export const FROM = process.env.EMAIL_FROM ?? "VERIDIAN AI <noreply@veridian-compliance.ai>"

export interface EmailPayload {
  to: string
  subject: string
  html: string
}

export async function sendEmail(payload: EmailPayload): Promise<void> {
  const client = getResend()
  if (!client) {
    console.warn("[email] RESEND_API_KEY not set — email skipped:", payload.subject)
    return
  }
  const { error } = await client.emails.send({ from: FROM, ...payload })
  if (error) console.error("[email] send error:", error)
}

export function emailTemplate(title: string, body: string, ctaUrl?: string, ctaLabel?: string): string {
  const cta = ctaUrl
    ? `<a href="${ctaUrl}" style="display:inline-block;margin-top:20px;padding:12px 24px;background:#F5820A;color:#fff;border-radius:8px;text-decoration:none;font-weight:600;">${ctaLabel ?? "View in VERIDIAN AI"}</a>`
    : ""
  return `
<!DOCTYPE html><html><body style="font-family:Inter,sans-serif;background:#FFFDF9;margin:0;padding:40px 20px;">
<div style="max-width:560px;margin:0 auto;background:#fff;border-radius:12px;border:1px solid #E2E8F0;overflow:hidden;">
  <div style="background:#1C2B3A;padding:24px 28px;">
    <span style="color:#F5820A;font-size:18px;font-weight:700;letter-spacing:-0.5px;">VERIDIAN AI</span>
  </div>
  <div style="padding:28px;">
    <h2 style="color:#1C2B3A;margin:0 0 12px;font-size:20px;">${title}</h2>
    <div style="color:#64748B;font-size:14px;line-height:1.6;">${body}</div>
    ${cta}
  </div>
  <div style="background:#F8FAFC;padding:16px 28px;border-top:1px solid #E2E8F0;">
    <p style="color:#94A3B8;font-size:12px;margin:0;">VERIDIAN AI — One Portal. One Truth. | Do not reply to this email.</p>
  </div>
</div>
</body></html>`
}

// Convenience senders
const APP_URL = process.env.NEXT_PUBLIC_APP_URL ?? "https://veridian-compliance-ai.vercel.app"

export async function notifyAssigned(to: string, userName: string, itemTitle: string, itemId: string) {
  await sendEmail({
    to,
    subject: `[VERIDIAN AI] Compliance item assigned to you`,
    html: emailTemplate(
      "You have been assigned a compliance item",
      `Hi ${userName},<br><br>A compliance item has been assigned to you:<br><br><strong>${itemTitle}</strong><br><br>Please log in to review the details and take action.`,
      `${APP_URL}/compliance/${itemId}`,
      "View Item"
    ),
  })
}

export async function notifyOverdue(to: string, userName: string, itemTitle: string, itemId: string, daysOverdue: number) {
  await sendEmail({
    to,
    subject: `[VERIDIAN AI] OVERDUE: ${itemTitle}`,
    html: emailTemplate(
      "⚠️ Compliance item is overdue",
      `Hi ${userName},<br><br>The following compliance item is <strong>${daysOverdue} day${daysOverdue !== 1 ? "s" : ""} overdue</strong>:<br><br><strong>${itemTitle}</strong><br><br>Please take immediate action to avoid further penalties.`,
      `${APP_URL}/compliance/${itemId}`,
      "View & Update"
    ),
  })
}

export async function notifyDeadlineApproaching(to: string, userName: string, itemTitle: string, itemId: string, daysLeft: number, dueDate: string) {
  await sendEmail({
    to,
    subject: `[VERIDIAN AI] Deadline in ${daysLeft} day${daysLeft !== 1 ? "s" : ""}: ${itemTitle}`,
    html: emailTemplate(
      `Compliance deadline approaching`,
      `Hi ${userName},<br><br>A compliance item assigned to you is due in <strong>${daysLeft} day${daysLeft !== 1 ? "s" : ""}</strong> (${dueDate}):<br><br><strong>${itemTitle}</strong><br><br>Please ensure all documentation is in order and the filing is completed on time.`,
      `${APP_URL}/compliance/${itemId}`,
      "View Item"
    ),
  })
}

export async function notifyNewComment(to: string, userName: string, authorName: string, itemTitle: string, itemId: string, comment: string) {
  await sendEmail({
    to,
    subject: `[VERIDIAN AI] New comment on: ${itemTitle}`,
    html: emailTemplate(
      "New comment on a compliance item",
      `Hi ${userName},<br><br><strong>${authorName}</strong> commented on <strong>${itemTitle}</strong>:<br><br><blockquote style="border-left:3px solid #F5820A;padding-left:12px;margin:12px 0;color:#475569;">${comment}</blockquote>`,
      `${APP_URL}/compliance/${itemId}`,
      "View Comment"
    ),
  })
}
