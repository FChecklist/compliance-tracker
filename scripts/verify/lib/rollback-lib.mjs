// PROJEXA-BUILD-001 phase 2 (U-17): shared helpers of the no-branch rollback tooling (PMD-10).
//
// Used by scripts/verify/rollback-tools.mjs, which backs rollback-rehearsals.sh (BR-206), rollback-replay.sh (BR-207)
// and the DO-block generator the PM pastes into Supabase MCP execute_sql. Pure functions only (file reads aside), so
// every rule below is exercised by scripts/verify/run-phase2-rollback-selftest.sh without a database.
//
// Contents:
//   parseMigrationList   ai-os/projexa-build-001/PHASE2_MIGRATIONS.txt -> ordered, validated base names
//   maskSql              blanks comments and quoted text, keeping every offset and newline, so a scan for keywords
//                        cannot be fooled by a string literal or a function body
//   loadSchemaHashSql    scripts/verify/schema-hash.sql without comments or trailing semicolon
//   scopeSchemaHashSql   the same query over a different schema list (the PGlite replay hashes touched schemas only)
//   hashOnlySql          wraps the query so it returns one text column (a PL/pgSQL `execute ... into` target)
//   stripTxnWrapper      removes a leading BEGIN and a trailing COMMIT; refuses any other transaction-control statement
//   buildDoBlock         the always-aborted rehearsal block: h0, forward, h1, down, h2, then RAISE EXCEPTION
//   parseRehearsalLog / checkRehearsal   the evidence log of ROLLBACK_REHEARSALS.md
import { createHash } from "node:crypto"
import { readFileSync } from "node:fs"

export const NAME_RE = /^[A-Za-z0-9_]+$/
const SCHEMA_RE = /^[a-z_][a-z0-9_]*$/
const MD5_RE = /^[0-9a-f]{32}$/

/**
 * One migration base name per line; `#` starts a comment (whole line or trailing); blank lines are ignored.
 * @returns {{ names: string[], errors: string[] }}
 */
export function parseMigrationList(text) {
  const names = []
  const errors = []
  const seen = new Set()
  text.replace(/\r\n/g, "\n").split("\n").forEach((line, i) => {
    const value = line.replace(/#.*$/, "").trim()
    if (value === "") return
    if (!NAME_RE.test(value)) {
      errors.push(`line ${i + 1}: '${value}' is not a base name (letters, digits, underscore; no .sql, no path)`)
      return
    }
    if (seen.has(value)) {
      errors.push(`line ${i + 1}: '${value}' is listed twice`)
      return
    }
    seen.add(value)
    names.push(value)
  })
  return { names, errors }
}

export function sha256Hex(bufferOrString) {
  return createHash("sha256").update(bufferOrString).digest("hex")
}

/**
 * Scan SQL once. Comments are always blanked. With keepQuoted=false the inside of '...', "..." and $tag$...$tag$ is
 * blanked too. Blanking replaces each character with a space and keeps newlines, so offsets and line numbers of the
 * result line up with the input. Nested block comments follow Postgres rules.
 */
function scanSql(sql, keepQuoted) {
  const out = sql.split("")
  const blank = (from, to) => {
    for (let k = from; k < to; k++) if (out[k] !== "\n") out[k] = " "
  }
  let i = 0
  const n = sql.length
  while (i < n) {
    const c = sql[i]
    const next = sql[i + 1]
    if (c === "-" && next === "-") {
      let j = sql.indexOf("\n", i)
      if (j === -1) j = n
      blank(i, j)
      i = j
    } else if (c === "/" && next === "*") {
      let depth = 1
      let j = i + 2
      while (j < n && depth > 0) {
        if (sql[j] === "/" && sql[j + 1] === "*") { depth++; j += 2 }
        else if (sql[j] === "*" && sql[j + 1] === "/") { depth--; j += 2 }
        else j++
      }
      blank(i, j)
      i = j
    } else if (c === "'" || c === '"') {
      const escaped = c === "'" && i > 0 && /[eE]/.test(sql[i - 1]) && (i < 2 || !/[A-Za-z0-9_]/.test(sql[i - 2]))
      let j = i + 1
      while (j < n) {
        if (escaped && sql[j] === "\\") { j += 2; continue }
        if (sql[j] === c) {
          if (sql[j + 1] === c) { j += 2; continue }
          break
        }
        j++
      }
      if (!keepQuoted) blank(i + 1, j)
      i = j + 1
    } else if (c === "$" && (i === 0 || !/[A-Za-z0-9_$]/.test(sql[i - 1]))) {
      const m = /^\$([A-Za-z_][A-Za-z0-9_]*)?\$/.exec(sql.slice(i, i + 80))
      if (!m) { i++; continue }
      const tag = m[0]
      let j = sql.indexOf(tag, i + tag.length)
      if (j === -1) j = n
      if (!keepQuoted) blank(i + tag.length, j)
      i = j + tag.length
    } else {
      i++
    }
  }
  return out.join("")
}

/** Comments and quoted text blanked (same length, same newlines). For keyword scans only. */
export function maskSql(sql) {
  return scanSql(sql, false)
}

/** Comments removed (blanked), quoted text kept. */
export function stripSqlComments(sql) {
  return scanSql(sql, true)
}

/** scripts/verify/schema-hash.sql as one runnable statement: no comments, no trailing semicolon. */
export function loadSchemaHashSql(path) {
  const text = stripSqlComments(readFileSync(path, "utf8").replace(/\r\n/g, "\n"))
  const lines = text.split("\n").map((l) => l.replace(/\s+$/, "")).filter((l) => l !== "")
  return lines.join("\n").replace(/;\s*$/, "")
}

const SCH_LIST_RE = /with sch\(nsp\) as \(values (?:\('[a-z_][a-z0-9_]*'\)(?:, )?)+\)/g

/** The schema list the query currently hashes. */
export function schemasOfHashSql(sql) {
  const found = sql.match(SCH_LIST_RE) || []
  if (found.length !== 1) throw new Error(`schema-hash.sql must hold exactly one 'with sch(nsp) as (values ...)' list, found ${found.length}`)
  return [...found[0].matchAll(/'([a-z_][a-z0-9_]*)'/g)].map((m) => m[1])
}

/** The same hash query over `schemas` instead of the list in the file. */
export function scopeSchemaHashSql(sql, schemas) {
  schemasOfHashSql(sql)
  if (!Array.isArray(schemas) || schemas.length === 0) throw new Error("scopeSchemaHashSql needs at least one schema")
  for (const s of schemas) if (!SCHEMA_RE.test(s)) throw new Error(`not a plain schema name: ${s}`)
  const list = `with sch(nsp) as (values ${schemas.map((s) => `('${s}')`).join(", ")})`
  return sql.replace(SCH_LIST_RE, list)
}

/** One text column (the md5), for `execute q into h0` inside the rehearsal block. */
export function hashOnlySql(sql) {
  return `select rh_hash.schema_hash from (\n${sql}\n) rh_hash`
}

const TXN_RE = /(^|;)(\s*)(begin(?:\s+(?:transaction|work))?|start\s+transaction[^;]*|commit(?:\s+(?:transaction|work|and\s+(?:no\s+)?chain))?|end(?:\s+(?:transaction|work))?|rollback[^;]*|abort[^;]*|savepoint[^;]*|release[^;]*|prepare\s+transaction[^;]*|commit\s+prepared[^;]*|rollback\s+prepared[^;]*)\s*(;|$)/gi

/** Transaction-control statements outside comments and quoted text, with offsets into `sql`. */
export function findTxnControl(sql) {
  const masked = maskSql(sql)
  const hits = []
  let m
  TXN_RE.lastIndex = 0
  while ((m = TXN_RE.exec(masked)) !== null) {
    const start = m.index + m[1].length + m[2].length
    const end = m.index + m[0].length
    hits.push({ start, end, text: sql.slice(start, end).trim() })
    TXN_RE.lastIndex = m[4] === ";" ? end - 1 : end
    if (TXN_RE.lastIndex <= m.index) TXN_RE.lastIndex = m.index + 1
  }
  return hits
}

/**
 * Body of a migration without its BEGIN ... COMMIT wrapper. The first statement may be BEGIN / START TRANSACTION and
 * the last may be COMMIT / END; anything else that controls the transaction is refused, because inside the rehearsal
 * block a COMMIT would end the transaction the block relies on to throw everything away.
 * @returns {{ ok: true, body: string } | { ok: false, reason: string }}
 */
export function stripTxnWrapper(sql) {
  const text = sql.replace(/\r\n/g, "\n")
  const masked = maskSql(text)
  const hits = findTxnControl(text)
  const firstCode = masked.search(/\S/)
  const lastCode = masked.replace(/[\s;]+$/, "").length
  const removable = []
  for (const h of hits) {
    const word = h.text.toLowerCase()
    if (h.start === firstCode && /^(begin|start)/.test(word)) removable.push(h)
    else if (/^(commit|end)/.test(word) && masked.slice(h.start, h.end).replace(/[\s;]+$/, "").length + h.start >= lastCode) removable.push(h)
    else return { ok: false, reason: `transaction-control statement '${h.text}' at offset ${h.start}; only a leading BEGIN and a trailing COMMIT are allowed` }
  }
  let body = text
  for (const h of [...removable].sort((a, b) => b.start - a.start)) body = body.slice(0, h.start) + body.slice(h.end)
  if (/\bconcurrently\b/i.test(maskSql(body))) return { ok: false, reason: "CONCURRENTLY cannot run inside a transaction block" }
  return { ok: true, body: body.trim() }
}

/**
 * The always-aborted rehearsal block (LIVE_FACTS section (b) template). Forward and down bodies run through EXECUTE, so
 * PL/pgSQL never parses them (no variable substitution, a bare SELECT is allowed). The block ends with RAISE EXCEPTION
 * in every path, so nothing it did survives.
 */
export function buildDoBlock({ hashSql, forwardBody, downBody, lockTimeout = "3s" }) {
  const tags = { outer: "$rehearsal$", q: "$rh_hash_q$", fwd: "$rh_forward$", down: "$rh_down$" }
  for (const [label, text] of [["hash query", hashSql], ["forward body", forwardBody], ["down body", downBody]]) {
    for (const t of Object.values(tags)) {
      if (text.includes(t)) throw new Error(`${label} contains the dollar tag ${t}; the block cannot quote it`)
    }
  }
  if (!/^[0-9]+(ms|s)$/.test(lockTimeout)) throw new Error(`lock timeout must look like 3s or 500ms, got ${lockTimeout}`)
  return [
    `do ${tags.outer}`,
    `declare rh_h0 text; rh_h1 text; rh_h2 text;`,
    `        rh_q text := ${tags.q}${hashSql}${tags.q};`,
    `begin`,
    `  set local lock_timeout = '${lockTimeout}';`,
    `  execute rh_q into rh_h0;`,
    `  execute ${tags.fwd}${forwardBody}${tags.fwd};`,
    `  execute rh_q into rh_h1;`,
    `  execute ${tags.down}${downBody}${tags.down};`,
    `  execute rh_q into rh_h2;`,
    `  if rh_h1 = rh_h0 then raise exception 'FAIL forward changed nothing h0=% h1=%', rh_h0, rh_h1; end if;`,
    `  if rh_h2 <> rh_h0 then raise exception 'FAIL down did not restore h0=% h1=% h2=%', rh_h0, rh_h1, rh_h2; end if;`,
    `  raise exception 'PASS_ROLLED_BACK h0=% h1=% h2=%', rh_h0, rh_h1, rh_h2;`,
    `end ${tags.outer};`,
    ``,
  ].join("\n")
}

/** Parse `PASS_ROLLED_BACK h0=.. h1=.. h2=..` out of an error message. */
export function parseRehearsalMessage(message) {
  const m = /^(PASS_ROLLED_BACK|FAIL [a-z ]+?) (?:h0=([0-9a-f]{32}))(?: h1=([0-9a-f]{32}))?(?: h2=([0-9a-f]{32}))?/.exec(String(message).trim())
  if (!m) return null
  return { result: m[1], h0: m[2], h1: m[3] ?? null, h2: m[4] ?? null }
}

/** Rows of the markdown table under the `## Log` heading of ROLLBACK_REHEARSALS.md. */
export function parseRehearsalLog(text) {
  const lines = text.replace(/\r\n/g, "\n").split("\n")
  const start = lines.findIndex((l) => /^## Log\s*$/.test(l))
  if (start === -1) return { found: false, rows: [] }
  const rows = []
  for (let i = start + 1; i < lines.length; i++) {
    const line = lines[i]
    if (/^#{1,2} /.test(line)) break
    if (!line.startsWith("|")) continue
    const cells = line.replace(/^\|/, "").replace(/\|\s*$/, "").split("|").map((c) => c.trim())
    rows.push({ lineNo: i + 1, line, cells })
  }
  return { found: true, rows }
}

export const LOG_LINE_RE =
  /^\| ([A-Za-z0-9_]+) \| (PASS_ROLLED_BACK) \| h0=([0-9a-f]{32}) h1=([0-9a-f]{32}) h2=([0-9a-f]{32}) \| forward_sha256=([0-9a-f]{64}) \| (\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z) \| ([^|]*[^|\s][^|]*) \|$/

/**
 * The LAST log row for `name` decides (a re-rehearsal after an edit appends a new row). It must match LOG_LINE_RE,
 * have h2 = h0 and h1 != h0, and carry the sha256 of the forward file as it is now.
 * @returns {{ ok: boolean, reason: string, row?: object }}
 */
export function checkRehearsal(name, rows, forwardSha) {
  const mine = rows.filter((r) => r.cells[0] === name)
  if (mine.length === 0) return { ok: false, reason: "no log line under '## Log'" }
  const row = mine[mine.length - 1]
  const m = LOG_LINE_RE.exec(row.line.trimEnd())
  if (!m) return { ok: false, reason: `log line ${row.lineNo} does not have the required shape`, row }
  const [, , , h0, h1, h2, sha, when, who] = m
  if (![h0, h1, h2].every((h) => MD5_RE.test(h))) return { ok: false, reason: `log line ${row.lineNo}: a hash is not 32 hex characters`, row }
  if (h2 !== h0) return { ok: false, reason: `log line ${row.lineNo}: h2 ${h2} is not h0 ${h0}`, row }
  if (h1 === h0) return { ok: false, reason: `log line ${row.lineNo}: h1 equals h0, the forward file changed nothing`, row }
  if (Number.isNaN(Date.parse(when))) return { ok: false, reason: `log line ${row.lineNo}: '${when}' is not a real UTC time`, row }
  if (sha !== forwardSha) return { ok: false, reason: `log line ${row.lineNo}: forward_sha256 ${sha.slice(0, 12)}.. is not the current file's ${forwardSha.slice(0, 12)}.. (edited after the rehearsal)`, row }
  return { ok: true, reason: `PASS_ROLLED_BACK h0=${h0} logged ${when} by ${who.trim()}`, row }
}

/** Schemas a replay must hash: every CREATE SCHEMA in the base snapshot and in the forward file. */
export function touchedSchemas(...sqlTexts) {
  const out = []
  for (const text of sqlTexts) {
    const masked = maskSql(text)
    for (const m of masked.matchAll(/\bcreate\s+schema\s+(?:if\s+not\s+exists\s+)?([a-z_][a-z0-9_]*)/gi)) {
      const s = m[1].toLowerCase()
      if (!out.includes(s)) out.push(s)
    }
    // a quoted name is blanked by maskSql; read those from the original text at the same offsets
    for (const m of masked.matchAll(/\bcreate\s+schema\s+(?:if\s+not\s+exists\s+)?"/gi)) {
      const q = /^"([a-z_][a-z0-9_]*)"/.exec(text.slice(m.index + m[0].length - 1))
      if (q && !out.includes(q[1])) out.push(q[1])
    }
  }
  return out
}
