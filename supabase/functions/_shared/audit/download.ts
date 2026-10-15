// DPDP audit trail -- the masked download and the internal full view (owner spec 2026-10-06, items 3 and 4). PURE apart from Web Crypto.
//
// MASKED (the only thing a browser ever gets): each sealed value is opened inside the Edge Function, masked at once by the kind stored beside it (mask.ts) and
// the plain text is dropped. The raw User-Agent string is not included at all (browser and operating system are enough for a person to recognise their own
// device, and a raw UA is a fingerprinting surface). The file carries who asked, when, which rows, the chain head it was cut from, and a verification hash.
//
// FULL (internal, owner only): every sealed value opened. Only reached through the staff-read path, which writes the access log BEFORE any value is opened.
import { type KeyRing, isSealed, open } from "./seal.ts"
import { type Sealed } from "./event.ts"
import { maskByKind, type MaskKind } from "./mask.ts"
import { canonicalJson, fileVerificationHash } from "./chain.ts"

export type StoredRow = {
  seq: number | string
  id: string
  org_id: string
  event_type: string
  server_time_us: number | string
  content_canonical: string
  prev_hash: string
  row_hash: string
}

type Content = {
  org_id: string
  event_type: string
  outcome?: string
  actor?: { user_id?: string | null; role?: string | null; type?: string; email?: Sealed | null }
  target?: { table?: string | null; id?: string | null } | null
  changes?: Array<{ field: string; kind?: MaskKind; personal?: boolean; before?: unknown; after?: unknown }>
  details?: unknown
  request_id?: string | null
  session_id?: string | null
  login_method?: string | null
  time?: Record<string, unknown>
  net?: { ip?: Sealed | null; country?: string | null; asn?: string | null; user_agent?: Sealed | null; browser?: string | null; os?: string | null; device_id?: Sealed | null; proof?: string }
  ai?: (Record<string, unknown> & { session_id?: Sealed | null; machine_id?: Sealed | null }) | null
  link?: { id?: string; token_fp?: string | null } | null
  guide_hash?: string | null
  confirm?: Record<string, unknown> | null
  ai_call_id?: string | null
  ref_hash?: string | null
}

const isSealedObj = (v: unknown): v is Sealed => !!v && typeof v === "object" && typeof (v as Sealed).s === "string" && isSealed((v as Sealed).s)

const isoOfUs = (us: number | string): string => new Date(Math.floor(Number(us) / 1000)).toISOString()

type Reveal = (field: string, v: unknown) => Promise<unknown>

async function walk(ring: KeyRing, row: StoredRow, c: Content, reveal: Reveal): Promise<Record<string, unknown>> {
  const org = row.org_id
  const val = async (field: string, v: Sealed | null | undefined): Promise<string | null> => (isSealedObj(v) ? ((await reveal(field, { kind: v.k, plain: await open(ring, v.s, org, field) })) as string) : null)
  const changes: Array<Record<string, unknown>> = []
  for (const [i, ch] of (c.changes ?? []).entries()) {
    if (ch.personal) {
      changes.push({ field: ch.field, personal: true, before: await val(`change.${i}.before`, ch.before as Sealed), after: await val(`change.${i}.after`, ch.after as Sealed) })
    } else {
      changes.push({ field: ch.field, personal: false, before: ch.before ?? null, after: ch.after ?? null })
    }
  }
  const ai = c.ai
    ? {
        fetcher: c.ai.fetcher ?? null, vendor_observed_ua: c.ai.vendor_observed_ua ?? null, vendor_observed_network: c.ai.vendor_observed_network ?? null,
        vendor_from_declared_model: c.ai.vendor_from_declared_model ?? null, model: c.ai.model ?? null, version: c.ai.version ?? null,
        session_id: await val("ai.session_id", c.ai.session_id), machine_id: await val("ai.machine_id", c.ai.machine_id),
        proof: c.ai.proof ?? null, mismatch: c.ai.mismatch ?? false, mismatch_reasons: c.ai.mismatch_reasons ?? [],
      }
    : null
  return {
    seq: Number(row.seq),
    id: row.id,
    occurred_at_utc: isoOfUs(row.server_time_us),
    event_type: row.event_type,
    outcome: c.outcome ?? "ok",
    actor: { user_id: c.actor?.user_id ?? null, role: c.actor?.role ?? null, type: c.actor?.type ?? null, email: await val("actor.email", c.actor?.email) },
    target: c.target ?? null,
    changes,
    request_id: c.request_id ?? null,
    session_id: c.session_id ?? null,
    login_method: c.login_method ?? null,
    time: c.time ?? null,
    net: { ip: await val("net.ip", c.net?.ip), country: c.net?.country ?? null, asn: c.net?.asn ?? null, browser: c.net?.browser ?? null, os: c.net?.os ?? null, device_id: await val("net.device_id", c.net?.device_id), proof: c.net?.proof ?? null },
    ai,
    link: c.link ?? null,
    guide_hash: c.guide_hash ?? null,
    confirm: c.confirm ?? null,
    ai_call_id: c.ai_call_id ?? null,
    row_hash: row.row_hash,
    prev_hash: row.prev_hash,
  }
}

/** One row for a person's file: every identifier masked, nothing sealed left in it. */
export async function maskedRow(ring: KeyRing, row: StoredRow): Promise<Record<string, unknown>> {
  const c = JSON.parse(row.content_canonical) as Content
  return walk(ring, row, c, async (_f, v) => {
    const { kind, plain } = v as { kind: MaskKind; plain: string }
    return maskByKind(kind, plain)
  })
}

/** One row with every value opened. INTERNAL ONLY: call it only after the access-log row has been written. */
export async function fullRow(ring: KeyRing, row: StoredRow): Promise<Record<string, unknown>> {
  const c = JSON.parse(row.content_canonical) as Content
  return walk(ring, row, c, async (_f, v) => (v as { plain: string }).plain)
}

export type DownloadMeta = {
  scope: "own" | "organisation"
  orgId: string
  orgName?: string | null
  requestedBy: { userId: string; role: string; email: string }
  generatedAtUtc: string
  fromUtc: string | null
  toUtc: string | null
  chain: { verified: boolean | null; rows: number; head: string | null; detail?: string }
  notice: string
}

export async function buildDownload(ring: KeyRing, rows: ReadonlyArray<StoredRow>, meta: DownloadMeta): Promise<Record<string, unknown>> {
  const masked: Array<Record<string, unknown>> = []
  for (const r of rows) masked.push(await maskedRow(ring, r))
  const body: Record<string, unknown> = {
    document: "VERIDIAN AI DPDP audit log",
    format_version: 1,
    scope: meta.scope,
    organisation_id: meta.orgId,
    organisation_name: meta.orgName ?? null,
    prepared_for: { user_id: meta.requestedBy.userId, role: meta.requestedBy.role, email_masked: maskByKind("email", meta.requestedBy.email) },
    generated_at_utc: meta.generatedAtUtc,
    period_utc: { from: meta.fromUtc, to: meta.toUtc },
    row_count: masked.length,
    masking: "E-mail: first 2 + *** + last 2 of the part before @, domain in full. Other identifiers (IP, mobile, device id): first 3 + *** + last 3; anything under 8 characters fully starred.",
    chain: meta.chain,
    notice: meta.notice,
    rows: masked,
  }
  body.verification_hash = await fileVerificationHash(body)
  return body
}

/** Re-compute a downloaded file's hash and compare (what "verify this file" does). */
export async function fileIsIntact(body: Record<string, unknown>): Promise<boolean> {
  return typeof body.verification_hash === "string" && body.verification_hash === (await fileVerificationHash(body))
}

export const toDownloadText = (body: Record<string, unknown>): string => JSON.stringify(JSON.parse(canonicalJson(body)), null, 2)
