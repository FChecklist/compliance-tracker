// lf-b2-ai-crud GROUP 2 (owner order 2026-10-02): GET and POST F/settings/act-without-asking, an APP route. It reads and sets the signed-in
// person's own "let my AI act without asking" switch (drizzle/0685, platform.ai_work_link_person_settings). With it on, that person's links may
// run a level-2 function directly; with it off (the default) a level-2 function is a draft the person confirms. The global kill switch and each
// link's own level stay in force (the SQL predicate ai_work_link__direct_ok decides, at record time and again at claim time).
//
// WHO: the person is the one whose PROJEXA session token is in Authorization, resolved exactly as the confirm route resolves them (confirm.ts
// sessionGate and personGate: a verified session, the per-person brake, then public.projexa_read_resolve_user). A link token is never accepted
// here (401): an AI holding a link cannot switch on its own permission. The answer carries the switch and when it was last changed, nothing else.
//
//   GET   200 {act_without_asking, updated_at}
//   POST  body {"act_without_asking": true|false}  200 {act_without_asking, updated_at}; 400 BAD_VALUE for anything else
//   401 SESSION_REQUIRED / SESSION_INVALID, 403 USER_NOT_LINKED, 429 RATE_LIMITED (confirm.ts), 503 SETTING_UNAVAILABLE on any RPC failure
import { errorBody } from "../_shared/ai-link/core.ts"
import { personGate, sessionGate, type ConfirmAnswer, type ConfirmDeps } from "./confirm.ts"

export type PersonSettingDeps = Pick<ConfirmDeps, "rpc" | "session" | "log" | "now">

const BODY_MAX_BYTES = 1024

const answer = (status: number, message: string, code: string): ConfirmAnswer => ({ status, body: errorBody(status, message, undefined, { code }) })

/** Only the two fields the person may see, from the SQL answer; anything else is an unknown shape. */
function shape(data: unknown): { act_without_asking: boolean; updated_at: string | null } | null {
  const row = Array.isArray(data) ? data[0] : data
  if (!row || typeof row !== "object") return null
  const r = row as Record<string, unknown>
  if (typeof r.act_without_asking !== "boolean") return null
  return { act_without_asking: r.act_without_asking, updated_at: typeof r.updated_at === "string" ? r.updated_at : null }
}

export async function handlePersonSetting(req: Request, deps: PersonSettingDeps): Promise<ConfirmAnswer> {
  const log = deps.log ?? ((line: string) => console.log(line))
  const method = req.method === "HEAD" ? "GET" : req.method
  const gate = await sessionGate(req, deps)
  if (!gate.ok) return gate.answer

  let value: boolean | null = null
  if (method === "POST") {
    const text = await req.text().catch(() => "")
    if (new TextEncoder().encode(text).length > BODY_MAX_BYTES) return answer(400, "The body must be {\"act_without_asking\": true} or false.", "BAD_VALUE")
    let parsed: unknown
    try {
      parsed = JSON.parse(text)
    } catch {
      parsed = null
    }
    const v = parsed && typeof parsed === "object" && !Array.isArray(parsed) ? (parsed as Record<string, unknown>).act_without_asking : undefined
    if (typeof v !== "boolean") return answer(400, "The body must be {\"act_without_asking\": true} or false.", "BAD_VALUE")
    value = v
  }

  const person = await personGate(gate.value, deps)
  if (!person.ok) return person.answer

  let res
  try {
    res = value === null
      ? await deps.rpc("ai_work_link_person_setting", { p_user_id: person.value })
      : await deps.rpc("ai_work_link_person_setting_set", { p_user_id: person.value, p_act_without_asking: value })
  } catch {
    res = { data: null, error: { message: "rpc threw" } }
  }
  const out = res.error ? null : shape(res.data)
  if (!out) {
    log("ai-work-link: person setting: rpc failed or unknown shape -> 503")
    return answer(503, "Service unavailable. Try again in a minute.", "SETTING_UNAVAILABLE")
  }
  if (value !== null) log(`ai-work-link: person setting: act_without_asking set to ${value}`)
  return { status: 200, body: out }
}
