// Stub of src/lib/pipeline/level1.ts for the ai-work-link-exec bundle: the Level 1 model lane. A link call never runs it (effectiveLevel1 returns
// "off" for a link). level1OffRunner is the one pure export and keeps its real behaviour.
import { thrower } from "./unavailable"
export const runLevel1 = thrower("the Level 1 model lane")
export const refusalAsUnresolved = thrower("level1 refusalAsUnresolved")
// PURE, so it keeps its real behaviour (level1.ts level1RefusalCode; level1-stub.test.ts holds the two equal). A link write records its telemetry columns
// through it: as a thrower it made the submission's status update fail after the write, so a live link submission kept model_calls and level1_outcome NULL
// (found on the first live write, 2026-09-27).
export function level1RefusalCode(outcome: string, kind: string | null | undefined, reason: string | null): "provider_not_allowed" | "user_not_permitted" | "provider_unreachable" | "unknown" | null {
  if (outcome === "refused") return kind === "actor_unresolved" ? "user_not_permitted" : "provider_not_allowed"
  if (outcome !== "error") return null
  const lower = (reason ?? "").toLowerCase()
  if (lower.includes("fetch") || lower.includes("timeout") || lower.includes("econnrefused")) return "provider_unreachable"
  return "unknown"
}
export function level1OffRunner() {
  return async (texts: string[]) => ({
    resolutions: texts.map(() => null),
    reasons: texts.map(() => "Level 1 is off for this caller"),
    modelCalls: 0,
  })
}
