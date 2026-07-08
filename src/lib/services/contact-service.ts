// Landing-page lead capture (Join Us / Contact Us). Platform-owned table, raw
// `db` client throughout -- same posture as visitor-intelligence-service.ts,
// since these rows belong to an anonymous public visitor, not a tenant.
import { db, contactSubmissions } from "@/lib/db"
import { eq, and } from "drizzle-orm"
import { sendEmail, emailTemplate } from "@/lib/email"
import { randomBytes } from "crypto"

const VALID_CATEGORIES = new Set(["associate", "sales_partner", "ai_researcher"])

export type ContactDraftPayload = {
  visitorId: string
  category?: string
  name?: string
  email?: string
  mobile?: string
  message?: string
}

function sanitize(p: ContactDraftPayload) {
  return {
    visitorId: p.visitorId?.slice(0, 64) ?? "",
    category: p.category && VALID_CATEGORIES.has(p.category) ? p.category : null,
    name: p.name?.slice(0, 200) || null,
    email: p.email?.slice(0, 200) || null,
    mobile: p.mobile?.slice(0, 40) || null,
    message: p.message?.slice(0, 4000) || null,
  }
}

// Debounced autosave from the form -- upserts the visitor's current
// in-progress draft (never touches a row that's already been submitted, so a
// visitor who submits and then comes back starts a fresh draft).
export async function saveContactDraft(payload: ContactDraftPayload): Promise<void> {
  const clean = sanitize(payload)
  if (!clean.visitorId) return

  const existing = await db.query.contactSubmissions.findFirst({
    where: and(eq(contactSubmissions.visitorId, clean.visitorId), eq(contactSubmissions.status, "draft")),
  })

  if (existing) {
    await db.update(contactSubmissions)
      .set({ category: clean.category, name: clean.name, email: clean.email, mobile: clean.mobile, message: clean.message, updatedAt: new Date() })
      .where(eq(contactSubmissions.id, existing.id))
  } else {
    await db.insert(contactSubmissions).values(clean)
  }
}

export class ContactSubmitError extends Error {}

// Final submit -- validates, marks submitted, sends the "check your email
// (and spam) to confirm" message via the existing dormant Resend sender.
export async function submitContactSubmission(payload: ContactDraftPayload): Promise<void> {
  const clean = sanitize(payload)
  if (!clean.visitorId) throw new ContactSubmitError("Missing visitor")
  if (!clean.name || !clean.email) throw new ContactSubmitError("Name and email are required")

  const confirmToken = randomBytes(16).toString("hex")
  const existing = await db.query.contactSubmissions.findFirst({
    where: and(eq(contactSubmissions.visitorId, clean.visitorId), eq(contactSubmissions.status, "draft")),
  })

  if (existing) {
    await db.update(contactSubmissions)
      .set({ ...clean, status: "submitted", confirmToken, submittedAt: new Date(), updatedAt: new Date() })
      .where(eq(contactSubmissions.id, existing.id))
  } else {
    await db.insert(contactSubmissions).values({ ...clean, status: "submitted", confirmToken, submittedAt: new Date() })
  }

  const confirmUrl = `${process.env.NEXT_PUBLIC_SITE_URL ?? "https://veridian-ai-os.vercel.app"}/api/contact/confirm?token=${confirmToken}`
  await sendEmail({
    to: clean.email,
    subject: "Confirm your email — VERIDIAN AI",
    html: emailTemplate(
      "Thanks for reaching out",
      `We've received your message${clean.category ? ` about joining as ${clean.category.replace("_", " ")}` : ""}. Please confirm your email address so we can get back to you — if you don't see this message, check your spam folder too.`,
      confirmUrl,
      "Confirm my email"
    ),
  })
}

export async function confirmContactEmail(token: string): Promise<boolean> {
  if (!token) return false
  const row = await db.query.contactSubmissions.findFirst({ where: eq(contactSubmissions.confirmToken, token) })
  if (!row) return false
  await db.update(contactSubmissions).set({ emailConfirmedAt: new Date() }).where(eq(contactSubmissions.id, row.id))
  return true
}
