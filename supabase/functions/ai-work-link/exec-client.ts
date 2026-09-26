// PROJEXA-BUILD-002 WP-09b (spec 9.6, 9.8): the client of the ai-work-link-exec Edge function, used by drafts.ts (POST /actions) and confirm.ts
// (POST /drafts/{id}/confirm). A NEW file so handler.ts holds no exec detail.
//
//   POST <base>/run   Authorization: Bearer <AWL_EXEC_INTERNAL_SECRET>   {"intent_id": "..."}
//
// The bearer is the shared internal secret the OWNER sets on both functions (supabase secrets set AWL_EXEC_INTERNAL_SECRET=...; the guide is
// ai-os/projexa-build-002/OWNER_SWITCH_ON_GUIDE.md). It is the only new credential besides the exec function's database URL, it is read in index.ts
// only, and it is never logged or put in an answer. The exec function CLAIMS the intent, runs it and finishes it in SQL; this client only carries
// the intent id and returns what the exec function answered.
//
// WHAT THROWS. Anything that is not a clean answer: a network error, a timeout, a non-200 status, a body that is not one of the four outcomes. The
// caller then writes NOTHING to the intent (the exec function may have claimed it and even written the record before its answer was lost), and tells
// the person to read GET /intents/{id}.
import type { ExecClient, ExecOutcome } from "./reads.ts"

export const EXEC_TIMEOUT_MS = 25_000
const STATUSES = new Set(["done", "failed", "refused", "executing"])
const CODE_RE = /^[A-Z][A-Z0-9_]{0,63}$/

export type ExecClientOptions = {
  /** `https://<project>.supabase.co/functions/v1/ai-work-link-exec` */
  baseUrl: string
  secret: string
  fetchFn?: typeof fetch
  timeoutMs?: number
}

/** Reads the exec function's answer into an ExecOutcome, or null when it is not one. Only known fields are taken. */
export function parseExecAnswer(body: unknown): ExecOutcome | null {
  if (!body || typeof body !== "object" || Array.isArray(body)) return null
  const b = body as Record<string, unknown>
  if (typeof b.status !== "string" || !STATUSES.has(b.status)) return null
  const out: ExecOutcome = { status: b.status as ExecOutcome["status"] }
  if (typeof b.submission_id === "string") out.submission_id = b.submission_id
  if (b.record && typeof b.record === "object" && !Array.isArray(b.record)) {
    const r = b.record as Record<string, unknown>
    out.record = { id: typeof r.id === "string" ? r.id : null, route: typeof r.route === "string" ? r.route : null }
  }
  if (typeof b.code === "string" && CODE_RE.test(b.code)) out.code = b.code
  if (Array.isArray(b.missing)) out.missing = b.missing.filter((m): m is string => typeof m === "string").slice(0, 20).map((m) => m.slice(0, 64))
  return out
}

export function makeExecClient(o: ExecClientOptions): ExecClient {
  const f = o.fetchFn ?? fetch
  const url = `${o.baseUrl.replace(/\/+$/, "")}/run`
  return async (intentId: string) => {
    const ctl = new AbortController()
    const timer = setTimeout(() => ctl.abort(), o.timeoutMs ?? EXEC_TIMEOUT_MS)
    try {
      const res = await f(url, {
        method: "POST",
        headers: { authorization: `Bearer ${o.secret}`, "content-type": "application/json" },
        body: JSON.stringify({ intent_id: intentId }),
        signal: ctl.signal,
      })
      if (res.status !== 200) throw new Error(`exec answered ${res.status}`)
      const out = parseExecAnswer(await res.json())
      if (!out) throw new Error("exec answered an unknown shape")
      return out
    } finally {
      clearTimeout(timer)
    }
  }
}
