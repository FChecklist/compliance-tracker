#!/usr/bin/env node
// PROJEXA-BUILD-001 phase 2 (U-17): rollback tooling that needs no paid Supabase branch (PMD-10).
//
// Subcommands:
//   rehearsals                  BR-206, called by scripts/verify/rollback-rehearsals.sh. Every migration listed in
//                               PHASE2_MIGRATIONS.txt needs drizzle/<name>.sql, drizzle/down/<name>.down.sql and a
//                               PASS_ROLLED_BACK log line in ROLLBACK_REHEARSALS.md (h2 = h0, h1 != h0, forward_sha256 =
//                               sha256 of the forward file's bytes today). Last stdout line: REHEARSAL_MISSING=<n>.
//   replay                      BR-207, called by scripts/verify/rollback-replay.sh. For every listed migration: a fresh
//                               in-memory PGlite, the Supabase baseline of scripts/replay-migrations-from-empty.mjs, the
//                               committed base snapshot scripts/verify/fixtures/<name>.base.sql, then hash (h0), forward,
//                               hash (h1), down, hash (h2); pass when h2 = h0 and h1 != h0. It then runs the same DO block
//                               the PM pastes into the live database (built by `do-block`, scoped to the snapshot's
//                               schemas) and requires PASS_ROLLED_BACK with the same h0 and an unchanged hash afterwards.
//                               Last stdout line: SCHEMA_HASH_MISMATCH=<n> (n counts every migration that did not prove a
//                               restore, including a missing file or a statement that failed).
//   do-block <name> [--schemas a,b] [--lock-timeout 3s]
//                               prints the always-aborted rehearsal DO block for drizzle/<name>.sql on stdout, and on
//                               stderr the forward_sha256 plus the log line to fill in. Refuses (exit 2) a forward or down
//                               file holding a transaction-control statement other than a leading BEGIN / trailing COMMIT.
//   hash-sql [--schemas a,b]    prints schema-hash.sql as one statement without comments, scoped when --schemas is given
//                               (step (a) of a rehearsal whose block was generated with the same --schemas).
//
// Hash query: scripts/verify/schema-hash.sql (BR-204). The replay runs it scoped to the schemas its snapshot and forward
// file create (CREATE SCHEMA lines). Differences from the live run, all deliberate:
//   - scope: touched schemas only, not compliance/platform/dpdp/public;
//   - engine: PGlite (Postgres compiled to WASM, a newer major than the live server) as superuser postgres, so the
//     information_schema sections see every object, and Postgres 18 lists NOT NULL constraints in pg_constraint;
//   - pgvector: vector(N) columns become real[] and vector indexes are skipped (applyPgvectorShim, printed);
//   - values: an engine's hash is compared only with the same engine's hash in the same run, never with a live value.
//
// Exit codes: 0 = pass, 1 = a listed migration failed, 2 = usage error or a missing list/log/hash file.
// Environment (paths default to places under the repo root): PHASE2_MIGRATIONS_FILE, ROLLBACK_REHEARSALS_FILE,
// DRIZZLE_DIR, ROLLBACK_FIXTURES_DIR, SCHEMA_HASH_FILE.
import { existsSync, readFileSync } from "node:fs"
import path from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"
import {
  buildDoBlock,
  checkRehearsal,
  hashOnlySql,
  loadSchemaHashSql,
  NAME_RE,
  parseMigrationList,
  parseRehearsalLog,
  parseRehearsalMessage,
  scopeSchemaHashSql,
  sha256Hex,
  stripTxnWrapper,
  touchedSchemas,
} from "./lib/rollback-lib.mjs"

const ROOT = fileURLToPath(new URL("../..", import.meta.url))
const env = (k, rel) => process.env[k] || path.join(ROOT, rel)
const P = {
  list: env("PHASE2_MIGRATIONS_FILE", "ai-os/projexa-build-001/PHASE2_MIGRATIONS.txt"),
  log: env("ROLLBACK_REHEARSALS_FILE", "ai-os/projexa-build-001/ROLLBACK_REHEARSALS.md"),
  drizzle: env("DRIZZLE_DIR", "drizzle"),
  fixtures: env("ROLLBACK_FIXTURES_DIR", "scripts/verify/fixtures"),
  hash: env("SCHEMA_HASH_FILE", "scripts/verify/schema-hash.sql"),
}
const forwardPath = (name) => path.join(P.drizzle, `${name}.sql`)
const downPath = (name) => path.join(P.drizzle, "down", `${name}.down.sql`)
const basePath = (name) => path.join(P.fixtures, `${name}.base.sql`)
const rel = (p) => path.relative(ROOT, p).split(path.sep).join("/") || p
const readText = (p) => readFileSync(p, "utf8").replace(/\r\n/g, "\n")

class Usage extends Error {}

function readList() {
  if (!existsSync(P.list)) throw new Usage(`migration list not found: ${P.list}`)
  const { names, errors } = parseMigrationList(readFileSync(P.list, "utf8"))
  if (errors.length) throw new Usage(`${rel(P.list)}: ${errors.join("; ")}`)
  return names
}

function rehearsals() {
  const names = readList()
  if (!existsSync(P.log)) throw new Usage(`rehearsal log not found: ${P.log}`)
  const log = parseRehearsalLog(readFileSync(P.log, "utf8"))
  if (!log.found) throw new Usage(`${rel(P.log)} has no '## Log' heading`)
  if (names.length === 0) {
    console.log(`${path.basename(P.list)} lists 0 migrations; there is nothing to rehearse yet (a separate register row requires the list to be non-empty later)`)
    console.log("REHEARSAL_MISSING=0")
    return { code: 0, note: "0 migrations listed" }
  }
  let missing = 0
  for (const name of names) {
    let r
    if (!existsSync(forwardPath(name))) r = { ok: false, reason: `forward file ${rel(forwardPath(name))} not found` }
    else if (!existsSync(downPath(name))) r = { ok: false, reason: `down file ${rel(downPath(name))} not found` }
    else r = checkRehearsal(name, log.rows, sha256Hex(readFileSync(forwardPath(name))))
    if (!r.ok) missing++
    console.log(`${r.ok ? "ok     " : "MISSING"} ${name}  ${r.reason}`)
  }
  console.log(`listed=${names.length} rehearsed=${names.length - missing}`)
  console.log(`REHEARSAL_MISSING=${missing}`)
  return missing === 0 ? { code: 0 } : { code: 1, note: `${missing} of ${names.length} listed migrations have no valid rehearsal` }
}

async function replay() {
  const names = readList()
  if (!existsSync(P.hash)) throw new Usage(`schema hash query not found: ${P.hash}`)
  const hashSql = loadSchemaHashSql(P.hash)
  if (names.length === 0) {
    console.log(`${path.basename(P.list)} lists 0 migrations; there is nothing to replay yet (a separate register row requires the list to be non-empty later)`)
    console.log("SCHEMA_HASH_MISMATCH=0")
    return { code: 0, note: "0 migrations listed" }
  }
  const { openPgliteEngine, SUPABASE_BASELINE_SQL, applyPgvectorShim } = await import("../replay-migrations-from-empty.mjs")
  let bad = 0
  let printedEngine = false
  for (const name of names) {
    const t0 = Date.now()
    const fail = (reason) => { bad++; console.log(`MISMATCH ${name}  ${reason}`) }
    const need = [[forwardPath(name), "forward file"], [downPath(name), "down file"], [basePath(name), "base snapshot"]]
    const absent = need.find(([p]) => !existsSync(p))
    if (absent) { fail(`${absent[1]} ${rel(absent[0])} not found`); continue }
    const shim = (p, tag) => {
      const r = applyPgvectorShim(readText(p), `${name}:${tag}`)
      for (const c of r.changes) console.log(`  shim ${c}`)
      return r.sql
    }
    const base = shim(basePath(name), "base")
    const forward = shim(forwardPath(name), "forward")
    const down = shim(downPath(name), "down")
    const schemas = touchedSchemas(base, forward)
    if (schemas.length === 0) { fail(`${rel(basePath(name))} has no CREATE SCHEMA statement, so the hash scope is unknown`); continue }
    const q = scopeSchemaHashSql(hashSql, schemas)
    const fwdBody = stripTxnWrapper(forward)
    const downBody = stripTxnWrapper(down)
    if (!fwdBody.ok) { fail(`forward file: ${fwdBody.reason}`); continue }
    if (!downBody.ok) { fail(`down file: ${downBody.reason}`); continue }

    const engine = await openPgliteEngine()
    if (!printedEngine) { console.log(`engine: ${engine.version}`); printedEngine = true }
    const hash = async () => {
      const res = await engine.exec(q)
      const row = res[res.length - 1].rows[0]
      return { n: String(row.n_objects), h: String(row.schema_hash) }
    }
    const step = async (label, sql) => {
      try { await engine.exec(sql); return null } catch (e) { return `${label} failed: ${String(e && e.message ? e.message : e).split("\n")[0]}` }
    }
    try {
      let err = await step("Supabase baseline", SUPABASE_BASELINE_SQL)
      if (!err) err = await step("base snapshot", base)
      if (err) { fail(err); continue }
      const h0 = await hash()
      err = await step("forward", forward)
      if (err) { fail(err); continue }
      const h1 = await hash()
      err = await step("down", down)
      if (err) { fail(err); continue }
      const h2 = await hash()
      const hashes = `h0=${h0.h} h1=${h1.h} h2=${h2.h} (n_objects ${h0.n}/${h1.n}/${h2.n}; schemas ${schemas.join(",")})`
      if (h1.h === h0.h) { fail(`forward changed nothing: ${hashes}`); continue }
      if (h2.h !== h0.h) { fail(`down did not restore: ${hashes}`); continue }

      // The live procedure's DO block, run on the same snapshot (the schema is back at h0 here).
      const block = buildDoBlock({ hashSql: hashOnlySql(q), forwardBody: fwdBody.body, downBody: downBody.body })
      let message = "the block raised no exception"
      try { await engine.exec(block) } catch (e) { message = String(e && e.message ? e.message : e).split("\n")[0] }
      const parsed = parseRehearsalMessage(message)
      const h3 = await hash()
      if (!parsed || parsed.result !== "PASS_ROLLED_BACK") { fail(`replay restored (${hashes}) but the rehearsal DO block said: ${message}`); continue }
      if (parsed.h0 !== h0.h || parsed.h2 !== h0.h || parsed.h1 !== h1.h) { fail(`DO block hashes ${message} differ from the replay's ${hashes}`); continue }
      if (h3.h !== h0.h) { fail(`the DO block left a change behind: hash after it ${h3.h}, before ${h0.h}`); continue }
      console.log(`ok       ${name}  restored ${hashes}; DO block PASS_ROLLED_BACK, nothing persisted (${Date.now() - t0} ms)`)
    } finally {
      await engine.close()
    }
  }
  console.log(`listed=${names.length} restored=${names.length - bad}`)
  console.log(`SCHEMA_HASH_MISMATCH=${bad}`)
  return bad === 0 ? { code: 0 } : { code: 1, note: `${bad} of ${names.length} listed migrations did not prove a restore` }
}

function doBlock(args) {
  const name = args.find((a) => !a.startsWith("--"))
  const opt = (k) => { const i = args.indexOf(k); return i === -1 ? undefined : args[i + 1] }
  if (!name || !NAME_RE.test(name)) throw new Usage("usage: rollback-tools.mjs do-block <name> [--schemas a,b] [--lock-timeout 3s]")
  for (const [p, label] of [[forwardPath(name), "forward file"], [downPath(name), "down file"], [P.hash, "schema hash query"]]) {
    if (!existsSync(p)) throw new Usage(`${label} not found: ${rel(p)}`)
  }
  const fwd = stripTxnWrapper(readText(forwardPath(name)))
  if (!fwd.ok) throw new Usage(`forward file refused: ${fwd.reason}`)
  const down = stripTxnWrapper(readText(downPath(name)))
  if (!down.ok) throw new Usage(`down file refused: ${down.reason}`)
  let q = loadSchemaHashSql(P.hash)
  const schemas = opt("--schemas")
  if (schemas) q = scopeSchemaHashSql(q, schemas.split(",").map((s) => s.trim()).filter(Boolean))
  const block = buildDoBlock({ hashSql: hashOnlySql(q), forwardBody: fwd.body, downBody: down.body, lockTimeout: opt("--lock-timeout") || "3s" })
  const sha = sha256Hex(readFileSync(forwardPath(name)))
  process.stdout.write(block)
  console.error(`forward_sha256=${sha}`)
  console.error(`log line: | ${name} | PASS_ROLLED_BACK | h0=<h0> h1=<h1> h2=<h2> | forward_sha256=${sha} | <UTC time YYYY-MM-DDTHH:MM:SSZ> | <who> |`)
  return { code: 0, silent: true }
}

// The hash query as one statement (comments removed), optionally scoped, for step (a) of a scoped rehearsal.
function hashSqlCmd(args) {
  if (!existsSync(P.hash)) throw new Usage(`schema hash query not found: ${rel(P.hash)}`)
  const i = args.indexOf("--schemas")
  let q = loadSchemaHashSql(P.hash)
  if (i !== -1) q = scopeSchemaHashSql(q, String(args[i + 1] || "").split(",").map((s) => s.trim()).filter(Boolean))
  process.stdout.write(`${q};\n`)
  return { code: 0, silent: true }
}

async function main() {
  const [cmd, ...args] = process.argv.slice(2)
  const ids = { rehearsals: "BR-206", replay: "BR-207", "do-block": "do-block", "hash-sql": "hash-sql" }
  const id = ids[cmd] || "rollback-tools"
  try {
    let r
    if (cmd === "rehearsals") r = rehearsals()
    else if (cmd === "replay") r = await replay()
    else if (cmd === "do-block") r = doBlock(args)
    else if (cmd === "hash-sql") r = hashSqlCmd(args)
    else throw new Usage("usage: rollback-tools.mjs rehearsals | replay | do-block <name> [--schemas a,b] [--lock-timeout 3s] | hash-sql [--schemas a,b]")
    if (!r.silent) console.error(r.code === 0 ? `PASS ${id}${r.note ? ` (${r.note})` : ""}` : `FAIL ${id}: ${r.note}`)
    return r.code
  } catch (e) {
    if (e instanceof Usage) { console.error(`FAIL ${id}: ${e.message}`); return 2 }
    console.error(`FAIL ${id}: ${String(e && e.stack ? e.stack : e).split("\n").slice(0, 3).join(" | ")}`)
    return 2
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  // exitCode, not process.exit(): stdout to a pipe can still be draining (the DO block is several KB)
  main().then((code) => { process.exitCode = code })
}
