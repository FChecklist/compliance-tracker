import { API_ONLY, BY_STATUS, CATALOG, type GuideEntry, type GuideGo, type GuideKind } from "./catalog"

/** The guide for one error, ready to show. */
export interface Guide {
  /** Stable key of the situation (for tests and for remembering a dismissed pop-up). */
  key: string
  kind: GuideKind
  title: string
  what: string
  steps: string[]
  go: GuideGo
  /** A short reference the person can quote when they write to us. It holds no personal detail. */
  ref: string
  /** true when a catalog entry matched; false when only the general guide for the status was used. */
  matched: boolean
  apiOnly: boolean
  /** The normalised catalog fragment that matched (used to keep a specific server sentence). */
  fragment: string
}

/** Support mailbox. One public address only (see lib/payment-proof-mail.ts). */
export const SUPPORT_EMAIL = "dpdp@veridian-aios.com"

/** Lower-case, with digits, ${...} and % placeholders taken out, so "Pick a date from 2026-01-01 to 2027-02-02" matches "Pick a date from % to %". */
export function norm(s: unknown): string {
  return String(s == null ? "" : s)
    .toLowerCase()
    .replace(/\$\{[^}]*\}/g, "")
    .replace(/%/g, "")
    .replace(/[0-9]+/g, "")
    .replace(/[’‘]/g, "'")
    .replace(/[–—]/g, "-")
    .replace(/\s+/g, " ")
    .trim()
}

export function isApiOnly(message: unknown): boolean {
  const n = norm(message)
  if (!n) return false
  return API_ONLY.some((a) => {
    if (a.startsWith("=")) return n === norm(a.slice(1))
    if (a.startsWith("*")) return n.includes(norm(a.slice(1)))
    const f = norm(a)
    return f.length > 0 && n.startsWith(f)
  })
}

export interface Found { entry: Omit<GuideEntry, "m" | "s">; matched: boolean; fragment: string }

/** First catalog entry whose fragment appears in the message (and whose status fits); else the status's own guide. */
export function find(message: unknown, status = 0): Found {
  const n = norm(message)
  if (n) {
    for (const e of CATALOG) {
      if (e.s && e.s.length && status && !e.s.includes(status)) continue
      for (const m of e.m) {
        const anchored = m.startsWith("^")
        const f = norm(anchored ? m.slice(1) : m)
        if (f && (anchored ? n.startsWith(f) : n.includes(f))) return { entry: e, matched: true, fragment: f }
      }
    }
  }
  // No answer at all (status 0) with no words is a dropped connection; a message nobody has seen is a failure on our side.
  const e = (status ? BY_STATUS[status] : undefined) ?? (status >= 500 ? BY_STATUS[500] : status >= 400 ? BY_STATUS[400] : n ? BY_STATUS[500] : BY_STATUS[0])
  return { entry: e, matched: false, fragment: "" }
}

function makeRef(): string {
  const a = "ABCDEFGHJKMNPQRSTUVWXYZ23456789"
  let s = ""
  for (let i = 0; i < 6; i++) s += a.charAt(Math.floor(Math.random() * a.length))
  return s
}

/** Where a message looks like a network problem: the caller had no answer at all. */
export function statusOf(err: unknown): number {
  const e = err as { status?: unknown; code?: unknown } | null
  const s = Number(e && e.status)
  return Number.isFinite(s) && s > 0 ? s : 0
}

export function explain(message: unknown, status = 0): Guide {
  const f = find(message, status)
  const e = f.entry
  return {
    key: e.t.toLowerCase().replace(/[^a-z0-9]+/g, "-").slice(0, 48),
    kind: e.k,
    title: e.t,
    what: e.w,
    steps: e.d.slice(),
    go: e.g,
    ref: makeRef(),
    matched: f.matched,
    apiOnly: !f.matched && isApiOnly(message),
    fragment: f.fragment,
  }
}

/** The text of an unknown thrown value, for explain(). */
export function messageOf(err: unknown): string {
  if (err instanceof Error) return err.message
  if (typeof err === "string") return err
  if (err && typeof err === "object" && "message" in err) return String((err as { message: unknown }).message)
  return String(err)
}

export function mailtoFor(g: Guide): string {
  const subject = `Help with VERIDIAN DPDP (reference ${g.ref})`
  const body = `Hello,\n\nI need help with VERIDIAN DPDP.\nReference: ${g.ref}\nWhat I was doing: \n`
  return `mailto:${SUPPORT_EMAIL}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`
}

/** Words a person must never meet. The unit test applies this to every catalog text; the screen applies it to a server message before showing it word for word. */
export const TECHNICAL_WORDS = /\b(json|payload|rpc|sql|http|https|api|stack ?trace|exception|undefined|null|nan|postgres|postgrest|pgrst|supabase|endpoint|url|query|schema|webhook|status code|jwt|oauth|rls|cors|regex|uuid|(?:status|error|code) [45]\d\d|function|parameter|argument|token|bug)\b/i
export const BLAMING_WORDS = /\b(invalid|illegal|incorrect|your fault|you failed|you forgot|you must have|error|failed|failure|wrong)\b/i

/** The 'what happened' line: when the message says clearly more than the matched fragment (a limit, a date range, a name) and is plain, keep it word for word. */
export function whatFor(g: Guide, original: unknown): string {
  const fragment = g.fragment
  const o = String(original == null ? "" : original).replace(/\s+/g, " ").trim()
  const extra = o.toLowerCase().length - fragment.length
  if (!g.matched || !(extra > 14 && o.length > 20 && o.length < 240) || TECHNICAL_WORDS.test(o) || BLAMING_WORDS.test(o)) return g.what
  return g.kind === "wait" || g.kind === "unexpected" ? `${o} ${g.what}` : o
}
