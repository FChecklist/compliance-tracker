// WO-DPDP-003 Section 4.10 -- the auditor/cyber panel. CERT-In's own
// Auditor Guidelines permit exactly one sentence describing empanelment:
// not "approved", not "certified", not "accredited", and the logo may
// never be used. "The app must make any other phrasing impossible" -- the
// only way to make that a real guarantee rather than a convention is for
// the wording to live in exactly one place (the dpdp.credential seed row,
// 0423) and for every render path to go through this one function, which
// takes no free-text input for the wording itself.
import { eq } from "drizzle-orm"
import { db, dpdpCredential, dpdpFirmCred, dpdpPanelFirm } from "@/lib/db"
import { withDpdpContext } from "@/lib/db/tenant-scoped"
import { ServiceError } from "./compliance-service"
export { ServiceError }

export const CERT_IN_CREDENTIAL_KIND = "cert_in_empanelment"

/**
 * The ONLY function anywhere in this codebase that may produce
 * CERT-In-empanelment display text. Reads the seeded row's exact_wording
 * verbatim -- there is no parameter here that could be used to substitute
 * different wording, by construction.
 */
export async function renderCertInWording(): Promise<string | null> {
  const row = await db.query.dpdpCredential.findFirst({ where: eq(dpdpCredential.kind, CERT_IN_CREDENTIAL_KIND) })
  return row?.exactWording ?? null
}

export async function listCredentials() {
  return db.query.dpdpCredential.findMany()
}

/** The "find an auditor" marketplace -- response time or alphabetical, never money (WO 4.10: no revenue field exists on this table, so there is nothing to sort by even if asked to). */
export async function listPanelFirms() {
  const firms = await db.query.dpdpPanelFirm.findMany({ orderBy: (t, { asc }) => [asc(t.name)] })
  return firms.sort((a, b) => {
    const aSla = a.responseSla ? parseInt(a.responseSla, 10) : Number.MAX_SAFE_INTEGER
    const bSla = b.responseSla ? parseInt(b.responseSla, 10) : Number.MAX_SAFE_INTEGER
    if (aSla !== bSla) return aSla - bSla
    return a.name.localeCompare(b.name)
  })
}

export type RegisterPanelFirmInput = { orgId: string; name: string; city?: string; headcount?: number; responseSla?: string }

export async function registerPanelFirm(input: RegisterPanelFirmInput) {
  return withDpdpContext({ orgId: input.orgId }, (tx) =>
    tx.insert(dpdpPanelFirm).values({ orgId: input.orgId, name: input.name, city: input.city, headcount: input.headcount, responseSla: input.responseSla }).returning(),
  ).then((rows) => rows[0])
}

export type DeclareCredentialInput = { orgId: string; firmId: string; credentialId: string; expiresOn?: string }

/**
 * "A credential with no artefact shows as declared, never as proof" (WO
 * 4.10) -- state starts at 'declared' and only moves to 'evidence' via a
 * separate, explicit call that supplies an artefactId (not built in this
 * pass -- flagged, not faked).
 */
export async function declareCredential(input: DeclareCredentialInput) {
  return withDpdpContext({ orgId: input.orgId }, (tx) =>
    tx.insert(dpdpFirmCred).values({ firmId: input.firmId, credentialId: input.credentialId, expiresOn: input.expiresOn, state: "declared" }).returning(),
  ).then((rows) => rows[0])
}

/**
 * "A client who saw a firm as current on the day of engagement must still
 * see that in the record after it lapses" (WO 4.10) -- so this reports
 * whether a credential HAD expired as of a given date, not just "is it
 * expired now". The firm_cred row's own state is left untouched by this
 * check (expiry is a computed fact from expiresOn, not a state this
 * function writes) -- see dpdp-panel-service.test.ts for both directions.
 */
export function wasCredentialCurrentOn(expiresOn: string | null, asOfIso: string): boolean {
  if (!expiresOn) return true // no expiry set -- treated as always current
  return new Date(expiresOn).getTime() >= new Date(asOfIso).getTime()
}
