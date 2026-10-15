// AUDIT-100 item 4: what POST /check adds so the confirm screen can say the change in plain words: who the person is (name and organisation, read now), whether
// the change deletes or touches money (it then needs the extra tick), and the real name of every record an id parameter points at, read live through the
// existing record reader (so a forged id of another organisation or project is "not found" and the screen refuses it). Nothing here changes anything.
import { cleanText } from "../_shared/ai-link/core.ts"
import { AwlError, readRecord, type CheckResult, type ReadEnv, type Rpc } from "./reads.ts"
import { nameOfRecord, plainSentence, riskOf, targetKindsFor, tickTextOf, type Target } from "./risk.ts"

export type PersonCard = { name: string; organisation: string | null }

/** The person's name and organisation through public.ai_work_link_person_card; null when it cannot be read (the screen then says so). */
export async function personCard(rpc: Rpc, userId: string): Promise<PersonCard | null> {
  try {
    const out = await rpc("ai_work_link_person_card", { p_user_id: userId })
    const d = out.error ? null : out.data
    if (!d || typeof d !== "object" || Array.isArray(d)) return null
    const r = d as Record<string, unknown>
    if (typeof r.name !== "string" || r.name === "") return null
    return { name: cleanText(r.name, 120), organisation: typeof r.organisation === "string" && r.organisation !== "" ? cleanText(r.organisation, 160) : null }
  } catch {
    return null
  }
}

export async function explainCheck(env: ReadEnv, check: CheckResult, params: unknown): Promise<Record<string, unknown>> {
  const risk = riskOf(check.function)
  const obj = params && typeof params === "object" && !Array.isArray(params) ? (params as Record<string, unknown>) : {}
  const targets: Target[] = []
  if (check.valid && (risk.needs_tick || Object.keys(targetKindsFor(check.function)).length > 0) && env.ctx.project_id !== null) {
    for (const [param, kind] of Object.entries(targetKindsFor(check.function))) {
      const raw = obj[param]
      if (raw === undefined || raw === null || raw === "") continue
      const id = String(raw)
      try {
        const doc = await readRecord(env, kind, id)
        const rec = doc.record && typeof doc.record === "object" ? (doc.record as Record<string, unknown>) : {}
        targets.push({ param, kind, id: cleanText(id, 128), found: true, name: nameOfRecord(rec) === null ? null : cleanText(nameOfRecord(rec) as string, 120) })
      } catch (e) {
        targets.push({ param, kind, id: cleanText(id, 128), found: e instanceof AwlError && e.status === 404 ? false : null, name: null })
      }
    }
  }
  const acting = await personCard(env.rpc, env.ctx.user_id)
  return {
    plain: plainSentence(check.function),
    risk: { ...risk, ...(risk.needs_tick ? { tick_text: tickTextOf(risk) } : {}) },
    acting_for: acting ?? { name: cleanText(env.ctx.user_name, 120), organisation: null },
    targets,
    // the screen enables Confirm only when every record the change points at was found (a delete of a record that is not found is refused)
    targets_ok: targets.every((t) => t.found === true),
  }
}
