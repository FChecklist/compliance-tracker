// DPDP single-mailbox taxonomy -- the ONE place that says what kinds of mail
// dpdp@veridian-aios.com sends and receives, and how a kind is written into
// (and read back out of) an address and a subject line.
//
// WHY THIS EXISTS. The public shows exactly one address, dpdp@veridian-aios.com.
// Everything the platform sends puts a machine-readable tag in the Reply-To
// (RFC 5233 subaddressing: dpdp+<tag>.<ref>@veridian-aios.com), so when a
// person hits Reply the inbound side knows, from the address alone and with no
// guessing, which kind of conversation it belongs to and which outbound message
// it answers. Cloudflare Email Routing delivers every +tag to the same
// dpdp@ rule, so nothing is lost if the tag is stripped by a mail client.
//
// PURE MODULE: no Deno, no Node, no network -- imported by the Supabase Edge
// Functions (Deno), the Cloudflare Email Worker (workerd) and bun tests alike.
// Keep it that way.

export type MailClass =
  | "monday" //       a reply to the Monday-morning digest
  | "clock" //        a reply to a statutory notice we sent (72-hour leak clock, 90-day rights clock)
  | "sales" //        a new sales enquiry (no prior outbound)
  | "sales_chain" //  a reply inside an outbound sales conversation
  | "invoice" //      a reply about an invoice we sent
  | "grievance" //    a grievance / complaint (LEGAL CLOCK)
  | "data_request" // withdraw consent / erasure / access / correction (LEGAL CLOCK)
  | "partner" //      a partnership / reseller enquiry
  | "support" //      product help
  | "auto" //         bounce, out-of-office, delivery notice: log only, never notify
  | "review" //       could not be classified: handled with grievance priority

export const MAIL_CLASSES: readonly MailClass[] = [
  "monday", "clock", "sales", "sales_chain", "invoice", "grievance", "data_request", "partner", "support", "auto", "review",
]

/** Short, stable tag that goes in the address: dpdp+<tag>.<ref>@. Never rename. */
export const CLASS_TAG: Record<MailClass, string> = {
  monday: "mon", clock: "clk", sales: "sal", sales_chain: "sch", invoice: "inv", grievance: "grv",
  data_request: "dsr", partner: "prt", support: "sup", auto: "aut", review: "rev",
}

/** Human label used in subject prefixes and the operator notification. */
export const CLASS_LABEL: Record<MailClass, string> = {
  monday: "Monday", clock: "Statutory", sales: "Sales", sales_chain: "Sales thread", invoice: "Invoice", grievance: "GRIEVANCE",
  data_request: "DATA REQUEST", partner: "Partner", support: "Support", auto: "Auto", review: "REVIEW",
}

/**
 * Classes that start a legal response clock: never auto-archived, always acknowledged.
 *
 * `clock` is deliberately NOT here. It labels a statutory notice WE sent (the 72-hour leak clock, the
 * 90-day rights clock); a reply to one is not itself a request that starts a clock. If the reply's own
 * words contain a data-subject request or a grievance, the classifier raises it to `data_request` /
 * `grievance` by keyword (classify.ts, "escalation"), whatever tag or thread it arrived on.
 */
export const LEGAL_CLOCK_CLASSES: readonly MailClass[] = ["grievance", "data_request", "review"]

/** Classes the operator is told about by email (`clock` included). `auto` is logged only. */
export const NOTIFY_CLASSES: readonly MailClass[] = MAIL_CLASSES.filter((c) => c !== "auto")

export const MAILBOX_LOCAL = "dpdp"
export const MAILBOX_DOMAIN = "veridian-aios.com"
export const MAILBOX = `${MAILBOX_LOCAL}@${MAILBOX_DOMAIN}`

const TAG_TO_CLASS: Record<string, MailClass> = Object.fromEntries(
  (Object.entries(CLASS_TAG) as [MailClass, string][]).map(([c, t]) => [t, c]),
)

// Crockford-style base32 without ambiguous glyphs; lowercase because mailbox
// local parts are case-insensitive in practice and must survive round trips.
const REF_ALPHABET = "0123456789abcdefghjkmnpqrstvwxyz"
export const REF_LENGTH = 10
const REF_RE = new RegExp(`^[${REF_ALPHABET}]{${REF_LENGTH}}$`)

/** Opaque id tying a reply back to the outbound row it answers. */
export function newRef(random: (n: number) => Uint8Array = defaultRandom): string {
  const bytes = random(REF_LENGTH)
  let out = ""
  for (let i = 0; i < REF_LENGTH; i++) out += REF_ALPHABET[bytes[i] % REF_ALPHABET.length]
  return out
}

function defaultRandom(n: number): Uint8Array {
  const b = new Uint8Array(n)
  crypto.getRandomValues(b)
  return b
}

export function isValidRef(ref: string): boolean {
  return REF_RE.test(ref)
}

/** dpdp+mon.k3f9x2ab7q@veridian-aios.com -- the Reply-To for an outbound message. */
export function replyToAddress(cls: MailClass, ref: string): string {
  if (!isValidRef(ref)) throw new Error(`invalid mail ref: ${ref}`)
  return `${MAILBOX_LOCAL}+${CLASS_TAG[cls]}.${ref}@${MAILBOX_DOMAIN}`
}

export type ParsedRecipient = {
  /** True when the address is dpdp@ or dpdp+anything@ on our domain. */
  ours: boolean
  cls: MailClass | null
  ref: string | null
}

/** Reads a recipient address. Tolerant: unknown or malformed tags give cls/ref null, never throw. */
export function parseRecipient(address: string): ParsedRecipient {
  const m = /^<?([^@<>\s]+)@([^@<>\s]+?)>?$/.exec(address.trim().toLowerCase())
  if (!m) return { ours: false, cls: null, ref: null }
  const [, local, domain] = m
  if (domain !== MAILBOX_DOMAIN) return { ours: false, cls: null, ref: null }
  if (local === MAILBOX_LOCAL) return { ours: true, cls: null, ref: null }
  if (!local.startsWith(`${MAILBOX_LOCAL}+`)) return { ours: false, cls: null, ref: null }
  const detail = local.slice(MAILBOX_LOCAL.length + 1)
  const [tag, ref] = detail.split(".", 2)
  const cls = TAG_TO_CLASS[tag] ?? null
  return { ours: true, cls, ref: ref && isValidRef(ref) ? ref : null }
}

/** "[VERIDIAN DPDP · Monday] " -- the visible prefix on every outbound subject. */
export function subjectPrefix(cls: MailClass): string {
  return `[VERIDIAN DPDP · ${CLASS_LABEL[cls]}] `
}

/** Adds the prefix once; never stacks it on a subject that already has it (replies, forwards). */
export function withSubjectPrefix(cls: MailClass, subject: string): string {
  const s = subject.trim()
  return s.startsWith("[VERIDIAN DPDP") ? s : `${subjectPrefix(cls)}${s}`
}

/** Machine-readable headers stamped on every outbound message. */
export function outboundHeaders(cls: MailClass, ref: string): Record<string, string> {
  return { "X-Veridian-Class": cls, "X-Veridian-Ref": ref }
}

/** Subject the operator sees in their own inbox: "[GRIEVANCE G-2026-0042] original subject". */
export function notificationSubject(cls: MailClass, ticket: string, originalSubject: string): string {
  const subject = originalSubject.replace(/^\s*(re|fwd?)\s*:\s*/i, "").trim() || "(no subject)"
  return `[${CLASS_LABEL[cls]} ${ticket}] ${subject}`
}
