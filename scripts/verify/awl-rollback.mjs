#!/usr/bin/env node
// PROJEXA-BUILD-001 U-46 step 1 (BR-488, spec AWL-D13, audit A-20): rollback proof for every migration of the Universal AI Work Link.
// Called by scripts/verify/awl-rollback.sh. It reuses the machinery of scripts/verify/rollback-tools.mjs (U-17) and checks two things
// for every link migration, that is every drizzle/NNNN_build001_awl_*.sql file:
//
//   1. REHEARSAL. The evidence log ai-os/projexa-build-001/ROLLBACK_REHEARSALS.md has a valid PASS_ROLLED_BACK row for it: the LAST row
//      for the name has the required shape, h2 = h0, h1 != h0, and forward_sha256 equals the sha256 of the forward file today (so an
//      edit after the rehearsal invalidates it). A migration with no such row counts as missing_rehearsal. The row is written by the
//      PM after the always-aborted transaction on the live database (ROLLBACK_REHEARSALS.md, Procedure); nobody else can produce it,
//      so until then this count is the number of migrations the PM still has to rehearse, and that is correct.
//   2. REPLAY. A PGlite forward-then-down replay restores the schema hash (h2 = h0, h1 != h0) and the rehearsal DO block the PM pastes
//      into the live database (rollback-tools.mjs do-block) raises PASS_ROLLED_BACK with the same hashes and leaves the hash at h0.
//      That is rollback-tools.mjs's own `replay`. The starting point of a replay is the committed base snapshot of the migration
//      (scripts/verify/fixtures/<name>.base.sql, read from the live catalog by gen-base-snapshot.mjs) PLUS the forward files of the
//      link migrations before it: the earlier ones are not live yet when this is written, so a snapshot of the live catalog cannot
//      hold them, and a migration is applied on top of them. The composed starting points are written to a temporary folder;
//      nothing in the repository is changed.
//
// Last stdout line: AWL_ROLLBACK missing_rehearsal=<n> replay_mismatch=<m>. Exit 0 only when both are 0; 1 otherwise; 2 on a usage
// error (a missing base snapshot or down file is a mismatch, not a usage error).
//
// Environment (defaults under the repository root): ROLLBACK_REHEARSALS_FILE, DRIZZLE_DIR, ROLLBACK_FIXTURES_DIR.
import { spawnSync } from "node:child_process"
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import os from "node:os"
import path from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"
import { checkRehearsal, parseRehearsalLog, sha256Hex } from "./lib/rollback-lib.mjs"

const ROOT = fileURLToPath(new URL("../..", import.meta.url))
const env = (k, rel) => process.env[k] || path.join(ROOT, rel)

/** The link migrations, by base name, in number order. */
export function listAwlMigrations(drizzleDir) {
  return readdirSync(drizzleDir)
    .filter((f) => /^\d{4}_build001_awl_[A-Za-z0-9_]+\.sql$/.test(f))
    .map((f) => f.replace(/\.sql$/, ""))
    .sort()
}

/**
 * The rehearsal check. Pure but for reading the migration files; `logText` is the text of ROLLBACK_REHEARSALS.md.
 * @returns {{ missing: number, lines: string[] }}
 */
export function checkRehearsals({ names, drizzleDir, logText }) {
  const log = parseRehearsalLog(logText)
  if (!log.found) throw new Error("the rehearsal log has no '## Log' heading")
  let missing = 0
  const lines = []
  for (const name of names) {
    const forward = path.join(drizzleDir, `${name}.sql`)
    const down = path.join(drizzleDir, "down", `${name}.down.sql`)
    let r
    if (!existsSync(forward)) r = { ok: false, reason: `forward file ${name}.sql not found` }
    else if (!existsSync(down)) r = { ok: false, reason: `down file ${name}.down.sql not found` }
    else r = checkRehearsal(name, log.rows, sha256Hex(readFileSync(forward)))
    if (!r.ok) missing++
    lines.push(`${r.ok ? "rehearsed " : "MISSING   "} ${name}  ${r.reason}`)
  }
  return { missing, lines }
}

/** Writes <outDir>/<name>.base.sql for every migration: its committed base snapshot, then the forward files before it. */
export function composeBases({ names, drizzleDir, fixturesDir, outDir }) {
  const problems = []
  names.forEach((name, i) => {
    const basePath = path.join(fixturesDir, `${name}.base.sql`)
    if (!existsSync(basePath)) {
      problems.push(`${name}: base snapshot ${path.relative(ROOT, basePath)} not found`)
      return
    }
    let text = readFileSync(basePath, "utf8").replace(/\r\n/g, "\n")
    for (const earlier of names.slice(0, i)) {
      text += `\n-- state of ${earlier} (link migrations before ${name} are not live when this is written)\n`
      text += readFileSync(path.join(drizzleDir, `${earlier}.sql`), "utf8").replace(/\r\n/g, "\n")
    }
    writeFileSync(path.join(outDir, `${name}.base.sql`), text, "utf8")
  })
  return problems
}

/** Runs rollback-tools.mjs replay over `names` with the composed starting points. */
export function runReplay({ names, drizzleDir, outDir }) {
  const list = path.join(outDir, "AWL_MIGRATIONS.txt")
  writeFileSync(list, `${names.join("\n")}\n`, "utf8")
  const r = spawnSync(process.execPath, [path.join(ROOT, "scripts/verify/rollback-tools.mjs"), "replay"], {
    cwd: ROOT,
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
    env: { ...process.env, PHASE2_MIGRATIONS_FILE: list, ROLLBACK_FIXTURES_DIR: outDir, DRIZZLE_DIR: drizzleDir },
  })
  const out = String(r.stdout || "")
  const last = out.trim().split("\n").filter(Boolean).pop() || ""
  const m = /^SCHEMA_HASH_MISMATCH=(\d+)$/.exec(last)
  if (!m) {
    return { mismatch: names.length, lines: [`replay gave no result line (exit ${r.status}): ${String(r.stderr || "").trim().split("\n").slice(-2).join(" | ")}`] }
  }
  return { mismatch: Number(m[1]), lines: out.split("\n").filter((l) => /^(ok |MISMATCH|listed=|engine:)/.test(l)) }
}

export function main() {
  const drizzleDir = env("DRIZZLE_DIR", "drizzle")
  const fixturesDir = env("ROLLBACK_FIXTURES_DIR", "scripts/verify/fixtures")
  const logPath = env("ROLLBACK_REHEARSALS_FILE", "ai-os/projexa-build-001/ROLLBACK_REHEARSALS.md")
  if (!existsSync(logPath)) {
    console.error(`FAIL BR-488: rehearsal log not found: ${logPath}`)
    return 2
  }
  const names = listAwlMigrations(drizzleDir)
  if (names.length === 0) {
    console.error("FAIL BR-488: no drizzle/NNNN_build001_awl_*.sql file found")
    return 2
  }

  const rehearsal = checkRehearsals({ names, drizzleDir, logText: readFileSync(logPath, "utf8") })
  for (const l of rehearsal.lines) console.log(l)

  const outDir = mkdtempSync(path.join(os.tmpdir(), "awl-rollback-"))
  let replay
  try {
    const problems = composeBases({ names, drizzleDir, fixturesDir, outDir })
    if (problems.length > 0) replay = { mismatch: problems.length, lines: problems.map((p) => `MISMATCH ${p}`) }
    else replay = runReplay({ names, drizzleDir, outDir })
  } finally {
    rmSync(outDir, { recursive: true, force: true })
  }
  for (const l of replay.lines) console.log(l)

  console.log(`migrations=${names.length} rehearsed=${names.length - rehearsal.missing} replayed=${names.length - replay.mismatch}`)
  console.log(`AWL_ROLLBACK missing_rehearsal=${rehearsal.missing} replay_mismatch=${replay.mismatch}`)
  const ok = rehearsal.missing === 0 && replay.mismatch === 0
  console.error(ok ? "PASS BR-488" : `FAIL BR-488: ${rehearsal.missing} migration(s) without a valid rehearsal row, ${replay.mismatch} without a proven replay`)
  return ok ? 0 : 1
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    process.exitCode = main()
  } catch (e) {
    console.error(`FAIL BR-488: ${String(e && e.message ? e.message : e)}`)
    process.exitCode = 2
  }
}
