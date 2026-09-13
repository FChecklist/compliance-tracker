// R-C17 (platform.sumeet_requirements, Owner-initiated 2026-09-13, "Platform:
// Email Engine"). Give each end user a real, unique email address able to
// both send (src/lib/email.ts already does this, one shared FROM address)
// and RECEIVE real mail. This file is the provisioning + resolution half:
//
//   - getOrCreateUserEmailAlias(): lazily provisions a user's
//     userEmailAddresses row the first time it's needed (derives a
//     candidate local-part from the user's own name/email, appending a
//     numeric suffix on collision) -- mirrors this codebase's existing
//     lazy-provisioning precedent (stage0-service.ts,
//     auth-guard.ts's autoProvisionUser()) rather than adding a new
//     signup-time side effect. NOT wired to any specific trigger by this
//     PR (no route/first-login hook calls it yet) -- that wiring is a
//     product decision (which screen/moment should first provision an
//     alias) deliberately left as a named follow-up rather than guessed at
//     here; the function itself is complete, tested, and ready to be
//     called from wherever that decision lands.
//   - resolveEmailAlias(): the inbound-webhook side. Given a full
//     recipient address (e.g. "raajat.agarwal@veridian-aios.com"), resolves
//     it back to (orgId, userId) for
//     src/app/api/webhooks/resend-inbound/route.ts to hand off to
//     analyzeInboundEmail() (email-intelligence-service.ts).
//
// Uses the plain `db` client (src/lib/db/index.ts) for BOTH the
// cross-org alias lookup AND collision-checked inserts, deliberately not
// withTenantContext: `db` is the table owner and bypasses RLS row
// filtering by default (same posture as deployment_events' writer and
// auth-guard.ts's autoProvisionUser(), per that function's own "Uses the
// raw (RLS-bypassing) db client deliberately" comment) -- resolveEmailAlias()
// in particular MUST be able to see every org's aliases, since an inbound
// webhook by definition arrives with no org context at all yet. Postgres
// still enforces user_email_addresses' (local_part, domain) UNIQUE
// constraint globally regardless of which role/RLS-context performs the
// insert, so this does not weaken the uniqueness guarantee -- only widens
// which rows a read can see.
import { db, userEmailAddresses, users } from "@/lib/db"
import { and, eq } from "drizzle-orm"
import { ServiceError } from "./compliance-service"

// Deliberately a plain array, not a DB enum/CHECK constraint -- see
// userEmailAddresses.domain's own comment in schema.ts for why.
//
// 2026-09-13 (R-C17 DNS/Resend setup, owner directive): changed from the
// bare root domain "veridian-aios.com" to the subdomain
// "mail.veridian-aios.com". The root domain already carries real, working
// company email (confirmed directly by the owner) -- a domain's MX records
// route ALL mail for that domain to one place, so pointing Resend Inbound
// at the root would have silently hijacked that existing mail. A subdomain
// gets its own independent MX record with zero effect on the root domain's
// existing mail, which is why Resend's own inbound-email guidance
// recommends a subdomain for exactly this reason.
//
// "projexa-ai.com" (or a mail.projexa-ai.com subdomain) is deliberately NOT
// added here, still: PROJEXA is a separate repository with its OWN,
// separate Supabase project/users table (see CLAUDE.md's own "PROJEXA is a
// SEPARATE repository" section) -- adding that domain string to THIS array
// would let an address resolve against compliance-tracker's own `users`
// table, which is the wrong database for a PROJEXA end user. Per-user email
// aliases for PROJEXA need their own, separate implementation of this same
// pattern inside the projexa repo, querying its own database -- not a
// one-line addition here.
export const DEFAULT_ALIAS_DOMAIN = "mail.veridian-aios.com"
export const ALLOWED_ALIAS_DOMAINS = [DEFAULT_ALIAS_DOMAIN] as const
export type AllowedAliasDomain = (typeof ALLOWED_ALIAS_DOMAINS)[number]

const LOCAL_PART_DOMAIN_UNIQUE_CONSTRAINT = "user_email_addresses_local_part_domain_unique"

function isLocalPartDomainUniqueViolation(error: unknown): boolean {
  const err = error as { code?: unknown; constraint_name?: unknown; cause?: { code?: unknown; constraint_name?: unknown } } | null
  const code = err?.code ?? err?.cause?.code
  const constraint = err?.constraint_name ?? err?.cause?.constraint_name
  return code === "23505" && constraint === LOCAL_PART_DOMAIN_UNIQUE_CONSTRAINT
}

// Slugifies a display name into a valid email local-part candidate:
// lowercase ASCII letters/digits joined by '.', no leading/trailing/doubled
// separators. Returns null (not "user") when the input has no usable
// characters at all (e.g. entirely emoji/CJK) -- getOrCreateUserEmailAlias
// below uses that null to fall through to the account email's own
// local-part before finally giving up and using the literal "user".
function slugifyRaw(input: string): string | null {
  const slug = input
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "") // strip diacritics
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ".")
    .replace(/^\.+|\.+$/g, "")
    .replace(/\.{2,}/g, ".")
  return slug || null
}

/** Public wrapper over slugifyRaw() that always returns a usable string (never null) -- see slugifyRaw's own comment for the fallback this hides from a direct caller that has no further fallback of its own to try. */
export function slugifyLocalPart(input: string): string {
  return slugifyRaw(input) ?? "user"
}

function candidateLocalPart(base: string, attempt: number): string {
  return attempt === 0 ? base : `${base}-${attempt + 1}`
}

const MAX_PROVISION_ATTEMPTS = 50

/**
 * Returns the user's existing active alias for `domain`, or provisions a new
 * one. Provisioning derives a base slug from the user's name (falling back
 * to the local-part of their account email if the name slugifies to
 * nothing usable), then tries candidate-{n} suffixes on collision --
 * collisions are detected by letting the DB's own UNIQUE constraint on
 * (local_part, domain) reject the insert (matches this codebase's own
 * established "let the DB's constraint be the source of truth for a race,
 * translate its rejection to a clean retry" pattern, see
 * erp-payroll-service.ts's isPayrollRunUniqueViolation()), not by a
 * separate pre-check SELECT -- a pre-check here would need to read across
 * every org's aliases to be correct, which a plain SELECT can do (this
 * file already uses the RLS-bypassing `db` client), but letting Postgres's
 * own index enforce it is simpler and race-free by construction.
 */
export async function getOrCreateUserEmailAlias(
  ctx: { orgId: string; userId: string },
  domain: AllowedAliasDomain = DEFAULT_ALIAS_DOMAIN
): Promise<typeof userEmailAddresses.$inferSelect> {
  if (!ALLOWED_ALIAS_DOMAINS.includes(domain)) {
    throw new ServiceError(`Domain "${domain}" is not in ALLOWED_ALIAS_DOMAINS`, 400)
  }

  const existing = await db.query.userEmailAddresses.findFirst({
    where: and(eq(userEmailAddresses.userId, ctx.userId), eq(userEmailAddresses.domain, domain), eq(userEmailAddresses.isActive, true)),
  })
  if (existing) return existing

  const dbUser = await db.query.users.findFirst({ where: eq(users.id, ctx.userId) })
  if (!dbUser) throw new ServiceError("User not found", 404)

  const base = slugifyRaw(dbUser.name) ?? slugifyRaw(dbUser.email.split("@")[0] ?? "") ?? "user"

  for (let attempt = 0; attempt < MAX_PROVISION_ATTEMPTS; attempt++) {
    const localPart = candidateLocalPart(base, attempt)
    try {
      const [created] = await db
        .insert(userEmailAddresses)
        .values({ orgId: ctx.orgId, userId: ctx.userId, localPart, domain, isActive: true })
        .returning()
      if (created) return created
    } catch (err) {
      if (isLocalPartDomainUniqueViolation(err)) continue
      throw err
    }
  }
  throw new ServiceError(`Could not provision a unique email alias for user ${ctx.userId} after ${MAX_PROVISION_ATTEMPTS} attempts`, 500)
}

export type ResolvedEmailAlias = { orgId: string; userId: string; aliasId: string }

/**
 * Splits a full recipient address into (localPart, domain), lower-cased --
 * email addresses are conventionally case-insensitive on the domain, and
 * this app never provisions mixed-case local-parts, so lower-casing both is
 * the safe direction (it can only make MORE deliveries resolve, never
 * fewer). Returns null for anything that isn't a plausible "x@y" shape (no
 * '@', a leading '@', or a trailing '@') -- pulled out as its own pure,
 * directly-testable function so resolveEmailAlias's parsing edge cases
 * don't require mocking the DB to exercise.
 */
export function parseRecipientAddress(toAddress: string): { localPart: string; domain: string } | null {
  const at = toAddress.lastIndexOf("@")
  if (at <= 0 || at === toAddress.length - 1) return null
  return { localPart: toAddress.slice(0, at).toLowerCase(), domain: toAddress.slice(at + 1).toLowerCase() }
}

/**
 * Resolves a full recipient address (e.g. "raajat.agarwal@veridian-aios.com")
 * back to the (orgId, userId) it belongs to, or null if no active alias
 * matches (including an unparseable address).
 */
export async function resolveEmailAlias(toAddress: string): Promise<ResolvedEmailAlias | null> {
  const parsed = parseRecipientAddress(toAddress)
  if (!parsed) return null

  const row = await db.query.userEmailAddresses.findFirst({
    where: and(eq(userEmailAddresses.localPart, parsed.localPart), eq(userEmailAddresses.domain, parsed.domain), eq(userEmailAddresses.isActive, true)),
  })
  if (!row) return null
  return { orgId: row.orgId, userId: row.userId, aliasId: row.id }
}
