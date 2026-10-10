// PROJEXA-BUILD-001 verify runner -- read-only SQL guard.
//
// Every SQL assertion in ai-os/projexa-build-001/BOOLEAN_REGISTER.csv runs through
// scripts/verify/sql-assert.mjs, and that runner refuses anything this function rejects.
// The guard is deliberately strict and small: a verify command must be able to READ a
// number or a string out of the database and nothing else. It is one of two layers; the
// runner also opens a READ ONLY transaction, so a statement that slipped past this check
// still could not write.
//
// Rules (each one is a test in sql-safety.test.ts):
//   1. exactly one statement (one optional trailing semicolon, none inside)
//   2. starts with SELECT or WITH
//   3. no SQL comments (a comment can hide a second statement from a reviewer)
//   4. no write / DDL / session-changing keyword as a whole word outside quoted text
//   5. no SELECT ... INTO (creates a table)
//   6. no function on the deny list (set_config, nextval, setval, pg_read_file, dblink, ...)

const FORBIDDEN_KEYWORDS = [
  "insert", "update", "delete", "merge", "drop", "alter", "create", "grant", "revoke", "truncate",
  "copy", "call", "execute", "do", "vacuum", "reindex", "cluster", "refresh", "listen", "notify",
  "unlisten", "set", "reset", "lock", "comment", "prepare", "deallocate", "discard", "into", "analyze",
];

const FORBIDDEN_FUNCTIONS = [
  "set_config", "nextval", "setval", "pg_read_file", "pg_read_binary_file", "pg_ls_dir", "lo_import",
  "lo_export", "pg_terminate_backend", "pg_cancel_backend", "dblink", "dblink_exec", "pg_advisory_lock",
  "pg_advisory_xact_lock", "pg_notify", "pg_reload_conf", "pg_sleep",
];

/** Remove quoted text so keywords inside string literals or quoted identifiers are not scanned. */
function stripQuoted(sql) {
  return sql
    .replace(/'(?:[^']|'')*'/g, "''")
    .replace(/"(?:[^"]|"")*"/g, '""')
    .replace(/\$([A-Za-z_]*)\$[\s\S]*?\$\1\$/g, "''");
}

/**
 * @param {string} sql
 * @returns {{ ok: true, sql: string } | { ok: false, reason: string }}
 */
export function checkReadOnlySql(sql) {
  if (typeof sql !== "string" || sql.trim() === "") return { ok: false, reason: "empty statement" };
  const trimmed = sql.trim().replace(/;\s*$/, "").trim();
  const scan = stripQuoted(trimmed);
  if (scan.includes("--") || scan.includes("/*")) return { ok: false, reason: "SQL comments are not allowed" };
  if (scan.includes(";")) return { ok: false, reason: "more than one statement" };
  if (!/^(select|with)\b/i.test(scan.trim())) return { ok: false, reason: "must start with SELECT or WITH" };
  for (const kw of FORBIDDEN_KEYWORDS) {
    if (new RegExp("\\b" + kw + "\\b", "i").test(scan)) return { ok: false, reason: "forbidden keyword: " + kw };
  }
  for (const fn of FORBIDDEN_FUNCTIONS) {
    if (new RegExp("\\b" + fn + "\\s*\\(", "i").test(scan)) return { ok: false, reason: "forbidden function: " + fn };
  }
  return { ok: true, sql: trimmed };
}

export const READ_ONLY_KEYWORDS = FORBIDDEN_KEYWORDS;
export const READ_ONLY_FUNCTIONS = FORBIDDEN_FUNCTIONS;
