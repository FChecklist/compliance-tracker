// FORGE project-intake capture -- platform-owned table, raw `db` client
// throughout, same posture as contact-service.ts (anonymous public visitor,
// no tenant to scope by).
import { db, forgeProjectRequests } from "@/lib/db"
import { eq, and } from "drizzle-orm"
import { sendEmail, emailTemplate, FROM } from "@/lib/email"
import { randomBytes } from "crypto"
import { verifyCaptcha } from "@/lib/forge-captcha"

export class ForgeSubmitError extends Error {}

export type ForgeSubmitPayload = {
  visitorId: string
  selectionPath: string[]
  selectionLabels: string[]
  notes?: string
  email: string
  captchaToken: string
  captchaAnswer: number
}

export async function submitForgeRequest(payload: ForgeSubmitPayload): Promise<void> {
  const visitorId = payload.visitorId?.slice(0, 64)
  if (!visitorId) throw new ForgeSubmitError("Missing visitor")
  if (!payload.email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(payload.email)) {
    throw new ForgeSubmitError("A valid email is required")
  }
  if (payload.selectionPath.length === 0) {
    throw new ForgeSubmitError("Please select what you're looking to build")
  }
  if (!verifyCaptcha(payload.captchaToken, payload.captchaAnswer)) {
    throw new ForgeSubmitError("That answer isn't quite right — please try again")
  }

  const confirmToken = randomBytes(16).toString("hex")
  const clean = {
    visitorId,
    selectionPath: payload.selectionPath.slice(0, 20),
    selectionLabels: payload.selectionLabels.slice(0, 20),
    notes: payload.notes?.slice(0, 4000) || null,
    email: payload.email.slice(0, 200),
  }

  const existing = await db.query.forgeProjectRequests.findFirst({
    where: and(eq(forgeProjectRequests.visitorId, visitorId), eq(forgeProjectRequests.status, "draft")),
  })

  if (existing) {
    await db.update(forgeProjectRequests)
      .set({ ...clean, status: "submitted", confirmToken, submittedAt: new Date(), updatedAt: new Date() })
      .where(eq(forgeProjectRequests.id, existing.id))
  } else {
    await db.insert(forgeProjectRequests).values({ ...clean, status: "submitted", confirmToken, submittedAt: new Date() })
  }

  const confirmUrl = `${process.env.NEXT_PUBLIC_SITE_URL ?? "https://veridian-ai-os.vercel.app"}/api/forge/confirm?token=${confirmToken}`
  await sendEmail({
    to: clean.email,
    subject: "Confirm your email — FORGE AI Engineering",
    html: emailTemplate(
      "Congratulations on this great journey — we're with you.",
      `We've received what you're looking to build (${clean.selectionLabels.join(" → ")}). Please confirm your email address so we can get back to you — check your spam folder if you don't see this.`,
      confirmUrl,
      "Confirm my email"
    ),
  })
}

export async function confirmForgeEmail(token: string): Promise<boolean> {
  if (!token) return false
  const row = await db.query.forgeProjectRequests.findFirst({ where: eq(forgeProjectRequests.confirmToken, token) })
  if (!row) return false
  await db.update(forgeProjectRequests).set({ emailConfirmedAt: new Date() }).where(eq(forgeProjectRequests.id, row.id))
  return true
}

export { FROM as FORGE_EMAIL_FROM }
