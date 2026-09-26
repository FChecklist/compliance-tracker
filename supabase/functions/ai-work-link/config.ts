// PROJEXA-BUILD-001 U-46b1 (spec sections 3.2, 10.5): the function's settings, read from the environment by ONE pure function so the tests
// (src/lib/services/ai-work-link-index.test.ts) can hold every default. Nothing here is a secret: the platform-injected SUPABASE_URL and
// four optional settings. The service-role key is read in index.ts and goes nowhere else.
//
// DEFAULTS ARE THE SAFE VALUES, so the function works with only the platform-injected environment (function secrets cannot be set from
// the PM's machine):
//   * functionBase   the project's own Supabase host plus /functions/v1/ai-work-link, from SUPABASE_URL, and only when that host ends in
//                    .supabase.co; otherwise the fixed production host. The request's Host header is never used (section 3.2), so a forged
//                    Host cannot rewrite the addresses the manual prints.
//   * confirmHost    the static confirm page (decision OD-3, a *.pages.dev name, created by a later unit). NO real default: a guessable
//                    default would let whoever owns that name read a token from the URL fragment. The default ends in .invalid, which
//                    never resolves; the PM sets AWL_CONFIRM_HOST (or edits this constant) when the page exists.
//   * appBase        the PROJEXA app origin the MCP search and fetch deep links point at.
//   * addressPosition the position, counted from the right of x-forwarded-for, that the unknown-token throttle counts by. null (the default)
//                    is the shared bucket that no header can rotate. Set AWL_CLIENT_ADDR_POSITION only after spike S-3 shows which entry the
//                    gateway appends (section 10.5, U-16).
//   * execPresent     false until the ai-work-link-exec Edge function is deployed (the switch-on guide flips EXEC_FUNCTION_PRESENT). It is NOT
//                    the whole switch: a change runs only when this AND the SQL flag writes_enabled are true (reads.ts availabilityOf), so
//                    there is one place that decides, and it reads both.
import type { AwlConfig } from "./reads.ts"

export const DEFAULT_SUPABASE_URL = "https://pcrjmlpuqsbocqfwoxod.supabase.co"
export const DEFAULT_CONFIRM_HOST = "confirm-host-not-set.invalid"
export const DEFAULT_APP_BASE = "https://projexa-ai.com"
export const FUNCTION_PATH = "/functions/v1/ai-work-link"
/**
 * The ai-work-link-exec function is not deployed yet (BUILD-002 WP-09a and WP-09b build the write path with the switch OFF). Flipping this to true is
 * the ONLY Edge code change once the exec function is deployed and the owner has set AWL_EXEC_INTERNAL_SECRET on both functions (index.ts builds the
 * exec client from it). Steps and rollback: ai-os/projexa-build-002/OWNER_SWITCH_ON_GUIDE.md.
 */
export const EXEC_FUNCTION_PRESENT = false

const HOST_RE = /^[a-z0-9]([a-z0-9.-]{0,251}[a-z0-9])?$/i

export function configFromEnv(get: (name: string) => string | undefined): AwlConfig {
  let supabase = DEFAULT_SUPABASE_URL
  const raw = (get("SUPABASE_URL") ?? "").trim().replace(/\/+$/, "")
  try {
    const u = new URL(raw)
    if (u.protocol === "https:" && u.hostname.endsWith(".supabase.co") && u.pathname === "/") supabase = `https://${u.hostname}`
  } catch {
    // keep the fixed default
  }
  const host = (get("AWL_CONFIRM_HOST") ?? "").trim()
  const app = (get("AWL_APP_BASE") ?? "").trim().replace(/\/+$/, "")
  const posText = (get("AWL_CLIENT_ADDR_POSITION") ?? "").trim()
  return {
    functionBase: `${supabase}${FUNCTION_PATH}`,
    confirmHost: HOST_RE.test(host) && !host.includes("/") ? host : DEFAULT_CONFIRM_HOST,
    appBase: /^https:\/\/[^/?#\s]+$/.test(app) ? app : DEFAULT_APP_BASE,
    addressPosition: /^[1-8]$/.test(posText) ? Number(posText) : null,
    execPresent: EXEC_FUNCTION_PRESENT,
  }
}
