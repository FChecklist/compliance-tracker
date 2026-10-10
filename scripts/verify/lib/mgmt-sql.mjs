// PROJEXA-BUILD-001 verify runner -- one read-only SQL statement through the Supabase Management API (U-23, BR-313).
//
// Why it exists: scripts/verify/sql-assert.mjs normally connects with VERIFY_DATABASE_URL as role app_runtime, and that role cannot
// see platform.sumeet_requirements rows, cron, vault or most tenant rows (it reads 0 for the wrong reason, PMD-22). The Management
// API read-only endpoint runs the statement as a role that sees them and refuses any write on the server side.
//   POST https://api.supabase.com/v1/projects/<verdian-ai ref>/database/query/read-only
//   header  Authorization: Bearer <SUPABASE_ACCESS_TOKEN>      body  {"query":"<one SELECT>"}      answer  201, a JSON array of rows
//
// Three layers keep a verify command from writing: (1) checkReadOnlySql (scripts/verify/lib/sql-safety.mjs) refuses the statement
// before any network call, (2) this module refuses again on its own so that a caller which forgot to guard still cannot send a write,
// (3) the endpoint itself is read-only. Only verdian-ai (project ct) is reachable through this path.
//
// The token is read from the process environment (SUPABASE_ACCESS_TOKEN); when it is not there the line SUPABASE_ACCESS_TOKEN= is
// read from the owner's C:\ct\ct\.env.local (or .env.local in the repository root). It is never printed: every message this module
// raises passes through scrub(), which removes the token value and anything shaped like a credential.
//
// Test seams (self-tests only): VERIFY_SQL_MGMT_BASE_URL points the module at a local fake server, and it is honoured ONLY for a
// loopback http address, so the token can never be sent to another host through it. VERIFY_ENV_FILE names the one .env file to read the
// token from, instead of the default locations (so a test can be sure that no real token is found).
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { checkReadOnlySql } from "./sql-safety.mjs";

export const CT_PROJECT_REF = "pcrjmlpuqsbocqfwoxod";
export const DEFAULT_BASE_URL = "https://api.supabase.com";
export const READ_ONLY_PATH = `/v1/projects/${CT_PROJECT_REF}/database/query/read-only`;
const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(HERE, "..", "..", "..");
const OWNER_ENV_FILE = "C:\\ct\\ct\\.env.local";
const LOOPBACK_HOSTS = new Set(["127.0.0.1", "localhost", "[::1]"]);

/**
 * kind: "refused" (the read-only guard said no; callers exit 2), "usage" (a bad setting; exit 2),
 *       "cannot-run" (no token; exit 3), "error" (network or query error; exit 4).
 */
export class MgmtError extends Error {
  constructor(kind, message) {
    super(message);
    this.kind = kind;
  }
}

/** Remove credential-shaped text from a message. `secrets` are exact values to remove as well. */
export function scrub(text, secrets = []) {
  let out = String(text ?? "");
  for (const s of secrets) {
    if (typeof s === "string" && s.length >= 6) out = out.split(s).join("[redacted]");
  }
  return out
    .replace(/\b[a-z][a-z0-9+.-]*:\/\/[^\s/:@'"]+:[^\s/@'"]*@[^\s'"]+/gi, "[redacted-url]")
    .replace(/\bpostgres(?:ql)?:\/\/[^\s'"]+/gi, "[redacted-url]")
    .replace(/\bBearer\s+[A-Za-z0-9._~+/=-]+/gi, "Bearer [redacted]")
    .replace(/\bsbp_[A-Za-z0-9]{16,}/g, "[redacted]")
    .replace(/\bsb_secret_[A-Za-z0-9_-]{10,}/g, "[redacted]")
    .replace(/\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]*/g, "[redacted-jwt]");
}

/** The value of NAME= in .env text, or "" when the line is absent. Surrounding quotes are removed. */
export function parseEnvValue(text, name) {
  const re = new RegExp("^\\s*(?:export\\s+)?" + name + "\\s*=\\s*(.*)$");
  for (const raw of String(text).split(/\r?\n/)) {
    const m = raw.match(re);
    if (!m) continue;
    let v = m[1].trim();
    if (v.length >= 2 && ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'")))) v = v.slice(1, -1);
    return v;
  }
  return "";
}

/** SUPABASE_ACCESS_TOKEN from the environment, else from an .env file; throws MgmtError("cannot-run") when there is none. */
export function resolveAccessToken(env = process.env) {
  let token = (env.SUPABASE_ACCESS_TOKEN || "").trim();
  if (!token) {
    const files = env.VERIFY_ENV_FILE ? [env.VERIFY_ENV_FILE] : [join(REPO_ROOT, ".env.local"), OWNER_ENV_FILE];
    for (const f of files) {
      let text;
      try {
        text = readFileSync(f, "utf8");
      } catch {
        continue;
      }
      token = parseEnvValue(text, "SUPABASE_ACCESS_TOKEN");
      if (token) break;
    }
  }
  if (!token) throw new MgmtError("cannot-run", "cannot run: SUPABASE_ACCESS_TOKEN is not set (environment or C:\\ct\\ct\\.env.local)");
  // A token that is not a plain header value would be a header-injection risk; refuse it without echoing it.
  if (!/^[A-Za-z0-9._~+/=-]+$/.test(token)) throw new MgmtError("cannot-run", "cannot run: SUPABASE_ACCESS_TOKEN has characters that are not allowed in a header");
  return token;
}

/** https://api.supabase.com, or the loopback override used by the self-tests. */
export function resolveBaseUrl(env = process.env) {
  const o = env.VERIFY_SQL_MGMT_BASE_URL;
  if (!o) return DEFAULT_BASE_URL;
  let u;
  try {
    u = new URL(o);
  } catch {
    throw new MgmtError("usage", "usage error: VERIFY_SQL_MGMT_BASE_URL is not a URL");
  }
  if (u.protocol !== "http:" || !LOOPBACK_HOSTS.has(u.hostname)) {
    throw new MgmtError("usage", "usage error: VERIFY_SQL_MGMT_BASE_URL may only point at a loopback http address (self-test use)");
  }
  return u.origin;
}

/**
 * Run one read-only statement and return the rows (an array of objects).
 * @param {string} sql
 * @param {{ env?: NodeJS.ProcessEnv, timeoutMs?: number }} [opts]
 */
export async function mgmtReadOnlyQuery(sql, opts = {}) {
  const env = opts.env ?? process.env;
  const timeoutMs = opts.timeoutMs ?? 30_000;
  const guard = checkReadOnlySql(sql);
  if (!guard.ok) throw new MgmtError("refused", "refused by the read-only guard: " + guard.reason);
  const base = resolveBaseUrl(env);
  const token = resolveAccessToken(env);
  let res;
  let text;
  try {
    res = await fetch(base + READ_ONLY_PATH, {
      method: "POST",
      headers: { Authorization: "Bearer " + token, "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({ query: guard.sql }),
      signal: AbortSignal.timeout(timeoutMs),
    });
    text = await res.text();
  } catch (e) {
    const msg = e && e.name === "TimeoutError" ? "timed out after " + timeoutMs + " ms" : String(e && e.message ? e.message : e).split("\n")[0];
    throw new MgmtError("error", scrub("query error: cannot reach the management API: " + msg, [token]));
  }
  if (!res.ok) {
    let detail = "";
    try {
      const j = JSON.parse(text);
      detail = typeof j?.message === "string" ? j.message : typeof j?.error === "string" ? j.error : "";
    } catch {
      detail = "";
    }
    detail = scrub(detail.split("\n")[0].slice(0, 200), [token]);
    throw new MgmtError("error", "query error: management API answered HTTP " + res.status + (detail ? ": " + detail : ""));
  }
  let rows;
  try {
    rows = JSON.parse(text);
  } catch {
    throw new MgmtError("error", "query error: the management API answer is not JSON");
  }
  if (!Array.isArray(rows)) throw new MgmtError("error", "query error: the management API answer is not a list of rows");
  return rows;
}
