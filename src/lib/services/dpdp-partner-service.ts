// dpdp UI delta (veridian-complete.html "🤝 Sell it, and get paid"). Like
// referral (see dpdp-referral-service.ts's own header), dpdp.partner
// existed only as schema (0415) -- 'email'/'kind'/'code'/'attributionDays'/
// 'state' named in schema.ts, nothing reading or writing the table anywhere
// in the repo (confirmed by a repo-wide grep before writing this).
//
// dpdp.partner is keyed by EMAIL, not identity_id -- unlike referral, a
// partner is not required to be a dpdp customer at all (the mockup's own
// "who this suits" list includes people who may never run a VERIDIAN
// account themselves). So this file resolves "me" via the caller's own
// primary email (already available on DpdpAuthContext's identity), not a
// membership/org lookup.
//
// NOT covered here: a commission/sales ledger. The mockup's "My sales"
// table (REF.psales -- organisations sold, commission paid, what repeats
// next year) has no backing table anywhere in dpdp.*, and adding one is a
// schema change, out of scope for this pass (flagged to the Owner
// separately, not silently invented as empty demo rows).
import { eq } from "drizzle-orm"
import { createId } from "@paralleldrive/cuid2"
import { db, dpdpPartner } from "@/lib/db"
import { ServiceError } from "./compliance-service"
export { ServiceError }

function randomPartnerCode(email: string): string {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"
  const raw = createId()
  let out = ""
  for (let i = 0; i < 6; i++) out += alphabet[raw.charCodeAt(i % raw.length) % alphabet.length]
  return `${out}-P`
}

async function uniquePartnerCode(email: string): Promise<string> {
  for (let attempt = 0; attempt < 5; attempt++) {
    const code = randomPartnerCode(email)
    const clash = await db.query.dpdpPartner.findFirst({ where: eq(dpdpPartner.code, code) })
    if (!clash) return code
  }
  throw new ServiceError("Could not generate a partner code, try again", 500)
}

export async function getPartnerByEmail(email: string) {
  return db.query.dpdpPartner.findFirst({ where: eq(dpdpPartner.email, email.trim().toLowerCase()) }) ?? null
}

export type ApplyForPartnerInput = { email: string; kind?: string; describesSelf?: string }

/** "Apply to be a partner" -- idempotent, same posture as getOrCreateMyReferral. */
export async function applyForPartner(input: ApplyForPartnerInput) {
  const email = input.email.trim().toLowerCase()
  if (!email.includes("@")) throw new ServiceError("A valid email is required", 400)
  const existing = await getPartnerByEmail(email)
  if (existing) return existing
  const code = await uniquePartnerCode(email)
  const [row] = await db.insert(dpdpPartner).values({ email, kind: input.kind ?? "sales", describesSelf: input.describesSelf, code }).returning()
  return row
}
