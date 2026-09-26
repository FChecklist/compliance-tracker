// PROJEXA-BUILD-001 U-46 step 1 (BR-488): tests of scripts/verify/awl-rollback.mjs (the logic behind awl-rollback.sh).
// Lives under src/ because bunfig.toml sets [test] root = "src": a test outside it is skipped by CI.
//
// WHAT IS PROVEN
//   - the migration list is exactly the ten link migrations (0621 to 0630), in number order, and nothing else in drizzle/;
//   - the rehearsal check counts a migration as rehearsed only for a valid PASS_ROLLED_BACK row: no row, a row for another migration,
//     h2 different from h0, h1 equal to h0, and a forward file edited after the rehearsal (its sha256 no longer matches) are all
//     missing; a valid row for each is zero missing;
//   - the composed starting point of a replay is the committed base snapshot followed by the forward files of the earlier link
//     migrations, and a missing snapshot is reported;
//   - a replay of a real migration restores the schema (mismatch 0), and a replay whose down file does not undo the forward file, or
//     whose forward file changes nothing, is reported as a mismatch (the replay is really comparing hashes).
import { describe, expect, test } from "bun:test"
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import os from "node:os"
import path from "node:path"
import { createHash } from "node:crypto"
import { fileURLToPath } from "node:url"
import { checkRehearsals, composeBases, listAwlMigrations, runReplay } from "../../../scripts/verify/awl-rollback.mjs"

const ROOT = fileURLToPath(new URL("../../../", import.meta.url))
const DRIZZLE = path.join(ROOT, "drizzle")
const FIXTURES = path.join(ROOT, "scripts/verify/fixtures")
const NAMES = [
  "0621_build001_awl_config_tables", "0622_build001_awl_intent", "0623_build001_awl_call_log", "0624_build001_awl_link_functions",
  "0625_build001_awl_read_functions", "0626_build001_awl_intent_functions", "0627_build001_awl_retention", "0628_build001_awl_seed",
  // BUILD-002 WP-09a
  "0629_build001_awl_execution_sql", "0630_build001_awl_submissions_via",
]

const sha = (file: string) => createHash("sha256").update(readFileSync(file)).digest("hex")
const md5 = (s: string) => createHash("md5").update(s).digest("hex")
const row = (name: string, o: { h0?: string; h1?: string; h2?: string; sha?: string } = {}) => {
  const h0 = o.h0 ?? md5(`${name}-h0`)
  return `| ${name} | PASS_ROLLED_BACK | h0=${h0} h1=${o.h1 ?? md5(`${name}-h1`)} h2=${o.h2 ?? h0} | forward_sha256=${o.sha ?? sha(path.join(DRIZZLE, `${name}.sql`))} | 2026-09-26T10:00:00Z | PM test |`
}
const logOf = (rows: string[]) => `# Rollback rehearsals\n\n## Log\n\n| migration | result | hashes | forward | time_utc | who |\n|---|---|---|---|---|---|\n${rows.join("\n")}\n`

describe("the migration list", () => {
  test("is exactly the eleven link migrations, in number order (0621 to 0631: the eight of BUILD-001, then 0629, 0630 and 0631 of BUILD-002)", () => {
    expect(listAwlMigrations(DRIZZLE)).toEqual([...NAMES, "0631_build001_awl_mint_for"])
  })

  test("takes only build001_awl files: other migrations, down files and a look-alike are left out", () => {
    const tmp = mkdtempSync(path.join(os.tmpdir(), "awl-list-"))
    try {
      for (const f of ["0700_build001_awl_x.sql", "0699_build001_awl_a.sql", "0698_build001_other.sql", "0697_awl_build001_x.sql", "README.md", "0696_build001_awl_.sql", "0695_build001_awl_y.txt"]) writeFileSync(path.join(tmp, f), "select 1;")
      mkdirSync(path.join(tmp, "down"))
      writeFileSync(path.join(tmp, "down", "0701_build001_awl_z.down.sql"), "select 1;")
      expect(listAwlMigrations(tmp)).toEqual(["0699_build001_awl_a", "0700_build001_awl_x"])
    } finally {
      rmSync(tmp, { recursive: true, force: true })
    }
  })
})

describe("the rehearsal check (missing_rehearsal)", () => {
  const run = (rows: string[]) => checkRehearsals({ names: NAMES, drizzleDir: DRIZZLE, logText: logOf(rows) })

  test("no row at all: every migration is missing, and each line says why", () => {
    const r = run([])
    expect(r.missing).toBe(NAMES.length)
    expect(r.lines.every((l) => l.startsWith("MISSING") && l.includes("no log line under '## Log'"))).toBe(true)
  })

  test("a valid PASS_ROLLED_BACK row for each migration: nothing is missing", () => {
    const r = run(NAMES.map((n) => row(n)))
    expect(r.missing).toBe(0)
    expect(r.lines.every((l) => l.startsWith("rehearsed"))).toBe(true)
  })

  test("only the migrations with a valid row are counted as rehearsed", () => {
    expect(run(NAMES.slice(0, 3).map((n) => row(n))).missing).toBe(NAMES.length - 3)
  })

  test("h2 different from h0 (the down file did not restore), and h1 equal to h0 (the forward file changed nothing), do not count", () => {
    const n = NAMES[3]
    expect(run([...NAMES.filter((x) => x !== n).map((x) => row(x)), row(n, { h2: md5("other") })]).missing).toBe(1)
    const h = md5("same")
    expect(run([...NAMES.filter((x) => x !== n).map((x) => row(x)), row(n, { h0: h, h1: h, h2: h })]).missing).toBe(1)
  })

  test("a forward file edited after its rehearsal no longer counts (the sha256 in the row is the old one)", () => {
    const n = NAMES[5]
    const r = run([...NAMES.filter((x) => x !== n).map((x) => row(x)), row(n, { sha: "0".repeat(64) })])
    expect(r.missing).toBe(1)
    expect(r.lines.find((l) => l.includes(n))).toContain("edited after the rehearsal")
  })

  test("the LAST row for a migration decides: a later valid row repairs an earlier bad one, a later bad row breaks an earlier good one", () => {
    const n = NAMES[0]
    const rest = NAMES.filter((x) => x !== n).map((x) => row(x))
    expect(run([...rest, row(n, { sha: "1".repeat(64) }), row(n)]).missing).toBe(0)
    expect(run([...rest, row(n), row(n, { sha: "1".repeat(64) })]).missing).toBe(1)
  })

  test("a row that belongs to another migration does not count", () => {
    expect(run([...NAMES.slice(1).map((x) => row(x)), row("0699_build001_awl_other", { sha: "a".repeat(64) })]).missing).toBe(1)
  })

  test("a missing forward or down file is missing too", () => {
    const tmp = mkdtempSync(path.join(os.tmpdir(), "awl-files-"))
    try {
      mkdirSync(path.join(tmp, "down"))
      copyFileSync(path.join(DRIZZLE, `${NAMES[0]}.sql`), path.join(tmp, `${NAMES[0]}.sql`))
      const log = logOf([row(NAMES[0])])
      const r = checkRehearsals({ names: [NAMES[0]], drizzleDir: tmp, logText: log })
      expect(r.missing).toBe(1)
      expect(r.lines[0]).toContain("down file")
      const gone = checkRehearsals({ names: ["0699_build001_awl_none"], drizzleDir: tmp, logText: log })
      expect(gone.lines[0]).toContain("forward file")
    } finally {
      rmSync(tmp, { recursive: true, force: true })
    }
  })

  test("a log with no '## Log' heading is an error, not a pass", () => {
    expect(() => checkRehearsals({ names: NAMES, drizzleDir: DRIZZLE, logText: "no heading\n" })).toThrow("no '## Log' heading")
  })
})

describe("the composed starting point of a replay", () => {
  test("is the committed base snapshot plus the forward files of the earlier link migrations, and nothing after", () => {
    const out = mkdtempSync(path.join(os.tmpdir(), "awl-compose-"))
    try {
      expect(composeBases({ names: NAMES, drizzleDir: DRIZZLE, fixturesDir: FIXTURES, outDir: out })).toEqual([])
      const first = readFileSync(path.join(out, `${NAMES[0]}.base.sql`), "utf8")
      expect(first).toBe(readFileSync(path.join(FIXTURES, `${NAMES[0]}.base.sql`), "utf8").replace(/\r\n/g, "\n"))
      const fourth = readFileSync(path.join(out, `${NAMES[3]}.base.sql`), "utf8")
      for (const earlier of NAMES.slice(0, 3)) expect(fourth).toContain(readFileSync(path.join(DRIZZLE, `${earlier}.sql`), "utf8").split("\n")[0])
      expect(fourth).not.toContain("CREATE OR REPLACE FUNCTION public.ai_work_link__role_rank")
      const last = readFileSync(path.join(out, `${NAMES[7]}.base.sql`), "utf8")
      expect(last).toContain("CREATE OR REPLACE FUNCTION public.ai_work_link_call_retention")
      expect(last).not.toContain("registry version")
    } finally {
      rmSync(out, { recursive: true, force: true })
    }
  })

  test("a migration with no committed base snapshot is reported", () => {
    const out = mkdtempSync(path.join(os.tmpdir(), "awl-compose-"))
    const fx = mkdtempSync(path.join(os.tmpdir(), "awl-fx-"))
    try {
      copyFileSync(path.join(FIXTURES, `${NAMES[0]}.base.sql`), path.join(fx, `${NAMES[0]}.base.sql`))
      const problems = composeBases({ names: NAMES.slice(0, 2), drizzleDir: DRIZZLE, fixturesDir: fx, outDir: out })
      expect(problems.length).toBe(1)
      expect(problems[0]).toContain(NAMES[1])
    } finally {
      rmSync(out, { recursive: true, force: true })
      rmSync(fx, { recursive: true, force: true })
    }
  })
})

describe("the PGlite replay (replay_mismatch)", () => {
  // a throwaway drizzle folder with one migration under a name of its own, so the replay reads it and no real file is touched
  function withMigration(forward: string, down: string, fn: (name: string, dir: string, out: string) => void) {
    const dir = mkdtempSync(path.join(os.tmpdir(), "awl-drz-"))
    const out = mkdtempSync(path.join(os.tmpdir(), "awl-out-"))
    const name = "0699_build001_awl_probe"
    try {
      mkdirSync(path.join(dir, "down"))
      writeFileSync(path.join(dir, `${name}.sql`), forward)
      writeFileSync(path.join(dir, "down", `${name}.down.sql`), down)
      writeFileSync(path.join(out, `${name}.base.sql`), readFileSync(path.join(FIXTURES, `${NAMES[0]}.base.sql`), "utf8"))
      fn(name, dir, out)
    } finally {
      rmSync(dir, { recursive: true, force: true })
      rmSync(out, { recursive: true, force: true })
    }
  }

  const FWD = "BEGIN;\nCREATE TABLE platform.awl_probe (id text PRIMARY KEY);\nCOMMIT;\n"

  test("a migration whose down file undoes the forward file restores the schema: mismatch 0", () => {
    withMigration(FWD, "BEGIN;\nDROP TABLE IF EXISTS platform.awl_probe;\nCOMMIT;\n", (name, dir, out) => {
      const r = runReplay({ names: [name], drizzleDir: dir, outDir: out })
      expect(r.mismatch).toBe(0)
      expect(r.lines.some((l) => l.startsWith("ok") && l.includes(name))).toBe(true)
    })
  }, 120_000)

  test("a down file that leaves the table behind is a mismatch, and the line says the down did not restore", () => {
    withMigration(FWD, "BEGIN;\nSELECT 1;\nCOMMIT;\n", (name, dir, out) => {
      const r = runReplay({ names: [name], drizzleDir: dir, outDir: out })
      expect(r.mismatch).toBe(1)
      expect(r.lines.join("\n")).toContain("down did not restore")
    })
  }, 120_000)

  test("a forward file that changes nothing is a mismatch too (a rehearsal of nothing proves nothing)", () => {
    withMigration("BEGIN;\nSELECT 1;\nCOMMIT;\n", "BEGIN;\nSELECT 1;\nCOMMIT;\n", (name, dir, out) => {
      const r = runReplay({ names: [name], drizzleDir: dir, outDir: out })
      expect(r.mismatch).toBe(1)
      expect(r.lines.join("\n")).toContain("forward changed nothing")
    })
  }, 120_000)

  test("a forward file with a syntax error is a mismatch, not a crash", () => {
    withMigration("BEGIN;\nCREATE TABEL platform.awl_probe (id text);\nCOMMIT;\n", "BEGIN;\nSELECT 1;\nCOMMIT;\n", (name, dir, out) => {
      const r = runReplay({ names: [name], drizzleDir: dir, outDir: out })
      expect(r.mismatch).toBe(1)
      expect(r.lines.join("\n")).toContain("forward failed")
    })
  }, 120_000)
})
