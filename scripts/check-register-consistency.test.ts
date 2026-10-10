/// <reference types="bun-types" />
// Real automated test for check-register-consistency.mjs (pm-t1 brief, added
// 2026-09-12). Proves proof 1 (closure-state drift) and proof 4 (NA
// self-certification, literal spec) against the actual pure functions the
// CI job calls -- no mocked internals -- with a genuine plant-a-violation,
// confirm-it's-flagged, confirm-clean-state-passes red/green cycle for
// each, per this task's own falsifiability requirement. Proofs 2/3 need
// live network/git state (GitHub compare + Actions-log API) and are
// exercised directly against the real, live data in
// scripts/check-register-consistency.mjs's own header comment /
// platform.claude_log (author pm-t1) instead of here.
import { describe, test, expect } from "bun:test"
import { spawn } from "node:child_process"
import { readFileSync } from "node:fs"
import { createServer } from "node:http"
import type { AddressInfo } from "node:net"
import { join } from "node:path"
import {
  EXPECTED_CLOSURE_DRIFT_IDS,
  EXIT_OK,
  EXIT_SKIPPED_STRICT,
  buildRestHeaders,
  describeError,
  evaluateProof1,
  evaluateProof4,
  classifyCompareStatus,
  isStrict,
  logContainsTestPath,
  resolveRestSchema,
  resolveTestJobName,
  skippedExitCode,
  computeClosureDriftRows,
  computeC6TrueRows,
} from "./check-register-consistency.mjs"

describe("computeClosureDriftRows (proof 1 join helper)", () => {
  test("a CLOSED requirement with a FALSE component is drifted", () => {
    const requirements = [{ id: "R-1", closure_state: "CLOSED" }, { id: "R-2", closure_state: "CLOSED" }]
    const components = [
      { requirement_id: "R-1", state: "FALSE" },
      { requirement_id: "R-2", state: "TRUE" },
    ]
    expect(computeClosureDriftRows(requirements, components).map((r) => r.id)).toEqual(["R-1"])
  })
  test("a non-CLOSED requirement with a FALSE component is NOT drifted", () => {
    const requirements = [{ id: "R-1", closure_state: "OPEN" }]
    const components = [{ requirement_id: "R-1", state: "FALSE" }]
    expect(computeClosureDriftRows(requirements, components)).toEqual([])
  })
})

describe("computeC6TrueRows (proofs 2/3 join helper)", () => {
  test("returns the requirement row for a requirement with c6=TRUE", () => {
    const requirements = [{ id: "R-1", closure_repo: "compliance-tracker" }, { id: "R-2", closure_repo: "projexa" }]
    const components = [
      { requirement_id: "R-1", component: "c6", state: "TRUE" },
      { requirement_id: "R-2", component: "c6", state: "FALSE" },
    ]
    expect(computeC6TrueRows(requirements, components).map((r) => r.id)).toEqual(["R-1"])
  })
  test("ignores a TRUE component that isn't c6", () => {
    const requirements = [{ id: "R-1" }]
    const components = [{ requirement_id: "R-1", component: "c2", state: "TRUE" }]
    expect(computeC6TrueRows(requirements, components)).toEqual([])
  })
})

describe("evaluateProof1 (closure-state c1 vs c6 drift)", () => {
  test("GREEN: the current live set exactly matching EXPECTED_CLOSURE_DRIFT_IDS passes", () => {
    const rows = EXPECTED_CLOSURE_DRIFT_IDS.map((id) => ({ id }))
    const result = evaluateProof1(rows)
    expect(result.pass).toBe(true)
    expect(result.missing).toEqual([])
    expect(result.extra).toEqual([])
  })

  test("RED: a NEW row drifting (not in the recorded expected set) is flagged, not silently accepted", () => {
    const rows = [...EXPECTED_CLOSURE_DRIFT_IDS, "R-99"].map((id) => ({ id }))
    const result = evaluateProof1(rows)
    expect(result.pass).toBe(false)
    expect(result.extra).toEqual(["R-99"])
    expect(result.missing).toEqual([])
  })

  test("RED: a row genuinely fixed (no longer drifting) also fails -- forces the literal array to be updated in the same PR, not silently accepted as a free win", () => {
    const fixedId = EXPECTED_CLOSURE_DRIFT_IDS[0]
    const rows = EXPECTED_CLOSURE_DRIFT_IDS.filter((id) => id !== fixedId).map((id) => ({ id }))
    const result = evaluateProof1(rows)
    expect(result.pass).toBe(false)
    expect(result.missing).toEqual([fixedId])
    expect(result.extra).toEqual([])
  })

  test("REGRESSION GUARD: this proof must never assert zero -- an empty live result is itself a mismatch against the known-red expected set, not a pass", () => {
    const result = evaluateProof1([])
    expect(result.pass).toBe(false)
    expect(result.missing.length).toBe(EXPECTED_CLOSURE_DRIFT_IDS.length)
  })
})

describe("evaluateProof4 (NA self-certification, literal spec)", () => {
  test("GREEN: na_ruling_id and verified_by in their real, distinct shapes never collide", () => {
    const rows = [
      { requirement_id: "R-A2", component: "c1", na_ruling_id: "R83-NA-R-A2-c1", verified_by: "W-VERIFY (local_2c4175a1-a6ca-4ad1-bded-d7fe9f9cd63d)" },
      { requirement_id: "R-A1", component: "c1", na_ruling_id: "R85-NA-R-A1-c1", verified_by: "claude-independent-verify-subagent (a8462e8f, separate from ruler claude-r85-p4)" },
    ]
    const result = evaluateProof4(rows)
    expect(result.pass).toBe(true)
    expect(result.violations).toEqual([])
  })

  test("RED: a planted literal self-certification (na_ruling_id === verified_by) IS flagged", () => {
    const rows = [
      { requirement_id: "R-A2", component: "c1", na_ruling_id: "R83-NA-R-A2-c1", verified_by: "W-VERIFY (local_2c4175a1-a6ca-4ad1-bded-d7fe9f9cd63d)" },
      { requirement_id: "R-ZZ", component: "c9", na_ruling_id: "SAME-ACTOR-STRING", verified_by: "SAME-ACTOR-STRING" },
    ]
    const result = evaluateProof4(rows)
    expect(result.pass).toBe(false)
    expect(result.violations).toEqual([
      { requirement_id: "R-ZZ", component: "c9", na_ruling_id: "SAME-ACTOR-STRING", verified_by: "SAME-ACTOR-STRING" },
    ])
  })

  test("rows with na_ruling_id null are never flagged (this predicate only applies to NA-ruled rows)", () => {
    const rows = [{ requirement_id: "R-1", component: "c1", na_ruling_id: null, verified_by: null }]
    expect(evaluateProof4(rows).pass).toBe(true)
  })
})

describe("classifyCompareStatus (proof 2 helper)", () => {
  test("'identical' and 'behind' are ancestors of main", () => {
    expect(classifyCompareStatus("identical")).toBe(true)
    expect(classifyCompareStatus("behind")).toBe(true)
  })
  test("'ahead', 'diverged', and null (404 / unresolved) are NOT ancestors of main", () => {
    expect(classifyCompareStatus("ahead")).toBe(false)
    expect(classifyCompareStatus("diverged")).toBe(false)
    expect(classifyCompareStatus(null)).toBe(false)
  })
})

describe("resolveTestJobName (proof 3 helper)", () => {
  test("finds the job literally named 'Unit Tests' or 'Test', ignoring position in the array", () => {
    const jobs = [{ name: "Migration Integrity Check", id: 1 }, { name: "Unit Tests", id: 2 }, { name: "Build", id: 3 }]
    expect(resolveTestJobName(jobs)).toBe(2)
  })
  test("returns null when no such job exists, rather than falling back to jobs[0] (the real R-C09-class gotcha)", () => {
    const jobs = [{ name: "Migration Integrity Check", id: 1 }, { name: "Build", id: 3 }]
    expect(resolveTestJobName(jobs)).toBe(null)
  })
})

describe("logContainsTestPath (proof 3 helper)", () => {
  test("matches a single closure_test_path substring in the log", () => {
    expect(logContainsTestPath("...src/lib/foo.test.ts: 3 pass...", "src/lib/foo.test.ts")).toBe(true)
  })
  test("multi-file closure_test_path (';'-separated) requires ALL of them present", () => {
    const log = "src/lib/crr/capture.test.ts: pass\nsrc/lib/crr/recall.test.ts: pass"
    expect(logContainsTestPath(log, "src/lib/crr/capture.test.ts; src/lib/crr/recall.test.ts")).toBe(true)
    expect(logContainsTestPath("src/lib/crr/capture.test.ts: pass", "src/lib/crr/capture.test.ts; src/lib/crr/recall.test.ts")).toBe(false)
  })
  test("a null log (fetch failure) never counts as a match", () => {
    expect(logContainsTestPath(null, "src/lib/foo.test.ts")).toBe(false)
  })
})

// ---------------------------------------------------------------------
// BR-312 / F-A09-5 (PROJEXA-BUILD-001): the script must not send a
// hard-coded platform Accept-Profile header (PostgREST answers 406
// PGRST106 to it on every run) and must say SKIPPED, loudly, when it has
// no readable schema -- never a silent warn-pass.
// ---------------------------------------------------------------------

const SCRIPT_PATH = join(import.meta.dir, "check-register-consistency.mjs")

describe("BR-312: REST schema is configuration, not a hard-coded platform header", () => {
  test("the script source never contains the hard-coded platform header (BR-312's own grep)", () => {
    const source = readFileSync(SCRIPT_PATH, "utf8")
    expect(source.includes('"Accept-Profile": "platform"')).toBe(false)
  })

  test("resolveRestSchema: unset, empty and blank are all 'no schema'", () => {
    expect(resolveRestSchema({})).toBe(null)
    expect(resolveRestSchema({ REGISTER_REST_SCHEMA: "" })).toBe(null)
    expect(resolveRestSchema({ REGISTER_REST_SCHEMA: "   " })).toBe(null)
  })

  test("resolveRestSchema: a named schema is returned trimmed", () => {
    expect(resolveRestSchema({ REGISTER_REST_SCHEMA: " platform " })).toBe("platform")
  })

  test("buildRestHeaders: Accept-Profile is sent only when a schema is named", () => {
    expect(buildRestHeaders("k", null)).toEqual({ apikey: "k", Authorization: "Bearer k" })
    expect(buildRestHeaders("k", undefined)).toEqual({ apikey: "k", Authorization: "Bearer k" })
    expect(buildRestHeaders("k", "platform")).toEqual({ apikey: "k", Authorization: "Bearer k", "Accept-Profile": "platform" })
  })

  test("describeError keeps the underlying cause, so a failed read is diagnosable from the log", () => {
    expect(describeError(new Error("boom"))).toBe("boom")
    expect(describeError(Object.assign(new Error("fetch failed"), { cause: { code: "ECONNREFUSED" } }))).toBe("fetch failed [cause: ECONNREFUSED]")
    expect(describeError("plain string")).toBe("plain string")
  })

  test("strict mode: --strict or REGISTER_CONSISTENCY_STRICT=1, and only then a skip exits 3", () => {
    expect(isStrict(["node", "x.mjs"], {})).toBe(false)
    expect(isStrict(["node", "x.mjs", "--strict"], {})).toBe(true)
    expect(isStrict(["node", "x.mjs"], { REGISTER_CONSISTENCY_STRICT: "1" })).toBe(true)
    expect(isStrict(["node", "x.mjs"], { REGISTER_CONSISTENCY_STRICT: "0" })).toBe(false)
    expect(skippedExitCode(false)).toBe(EXIT_OK)
    expect(skippedExitCode(true)).toBe(EXIT_SKIPPED_STRICT)
    expect(EXIT_SKIPPED_STRICT).toBe(3)
  })
})

interface RunResult {
  code: number | null
  stdout: string
  stderr: string
}

/** Runs the real script as a child process (bun runs .mjs directly) with a controlled environment. */
function runScript(args: string[], env: Record<string, string>): Promise<RunResult> {
  return new Promise((resolve, reject) => {
    // Every variable that could reach a real service is blanked, so this can never touch the network beyond the test's own local server.
    const childEnv: Record<string, string> = {
      ...(process.env as Record<string, string>),
      SUPABASE_URL: "",
      SUPABASE_SERVICE_ROLE_KEY: "",
      REGISTER_REST_SCHEMA: "",
      REGISTER_CONSISTENCY_STRICT: "",
      GITHUB_TOKEN: "",
      PAT_FCHECKLIST: "",
      GITHUB_ACTIONS: "",
      ...env,
    }
    const child = spawn(process.execPath, [SCRIPT_PATH, ...args], { env: childEnv })
    let stdout = ""
    let stderr = ""
    child.stdout.on("data", (chunk) => (stdout += String(chunk)))
    child.stderr.on("data", (chunk) => (stderr += String(chunk)))
    child.on("error", reject)
    child.on("close", (code) => resolve({ code, stdout, stderr }))
  })
}

/** A local stand-in for PostgREST that records every request it receives and answers with an empty list. */
async function withRecordingServer<T>(fn: (baseUrl: string, seen: { url: string; acceptProfile: string | undefined }[]) => Promise<T>): Promise<T> {
  const seen: { url: string; acceptProfile: string | undefined }[] = []
  const server = createServer((req, res) => {
    const profile = req.headers["accept-profile"]
    seen.push({ url: req.url ?? "", acceptProfile: Array.isArray(profile) ? profile[0] : profile })
    res.writeHead(200, { "content-type": "application/json" })
    res.end("[]")
  })
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", () => resolve()))
  const port = (server.address() as AddressInfo).port
  try {
    return await fn(`http://127.0.0.1:${port}`, seen)
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()))
  }
}

describe("BR-312: a run with no readable schema is SKIPPED loudly and makes no request", () => {
  test("no REGISTER_REST_SCHEMA: prints SKIPPED (reason), exits 0, and sends nothing to PostgREST", async () => {
    await withRecordingServer(async (baseUrl, seen) => {
      const result = await runScript([], { SUPABASE_URL: baseUrl, SUPABASE_SERVICE_ROLE_KEY: "test-not-a-key" })
      expect(result.code).toBe(0)
      expect(result.stdout).toContain("SKIPPED (REGISTER_REST_SCHEMA is not set")
      expect(result.stdout).toContain("did not run")
      expect(seen).toEqual([])
    })
  })

  test("--strict turns the same skip into exit 3", async () => {
    await withRecordingServer(async (baseUrl, seen) => {
      const result = await runScript(["--strict"], { SUPABASE_URL: baseUrl, SUPABASE_SERVICE_ROLE_KEY: "test-not-a-key" })
      expect(result.code).toBe(EXIT_SKIPPED_STRICT)
      expect(result.stdout).toContain("SKIPPED (")
      expect(seen).toEqual([])
    })
  })

  test("REGISTER_CONSISTENCY_STRICT=1 turns the skip into exit 3 too", async () => {
    const result = await runScript([], { REGISTER_CONSISTENCY_STRICT: "1", SUPABASE_URL: "http://127.0.0.1:9", SUPABASE_SERVICE_ROLE_KEY: "test-not-a-key" })
    expect(result.code).toBe(EXIT_SKIPPED_STRICT)
  })

  test("no SUPABASE_URL / key: also a loud SKIPPED, not a bare warning", async () => {
    const result = await runScript([], {})
    expect(result.code).toBe(0)
    expect(result.stdout).toContain("SKIPPED (SUPABASE_URL/SUPABASE_SERVICE_ROLE_KEY not set")
  })

  test("under GitHub Actions the skip also emits a ::warning:: annotation", async () => {
    const result = await runScript([], { GITHUB_ACTIONS: "true", SUPABASE_URL: "http://127.0.0.1:9", SUPABASE_SERVICE_ROLE_KEY: "test-not-a-key" })
    expect(result.stdout).toContain("::warning title=Register Consistency Check SKIPPED::")
  })

  test("CONTROL: with REGISTER_REST_SCHEMA set the script does read, and sends exactly that schema as Accept-Profile", async () => {
    await withRecordingServer(async (baseUrl, seen) => {
      const result = await runScript([], { SUPABASE_URL: baseUrl, SUPABASE_SERVICE_ROLE_KEY: "test-not-a-key", REGISTER_REST_SCHEMA: "some_exposed_schema" })
      expect(seen.length).toBe(2)
      expect(seen.every((r) => r.acceptProfile === "some_exposed_schema")).toBe(true)
      expect(seen.map((r) => r.url.split("?")[0])).toEqual(["/rest/v1/sumeet_requirements", "/rest/v1/sumeet_requirement_components"])
      // An empty register cannot match the known-red proof-1 set, so the proofs ran and one failed: exit 1, not a skip.
      expect(result.code).toBe(1)
      expect(result.stdout).not.toContain("SKIPPED")
    })
  })

  test("a read that fails is SKIPPED with the cause, not swallowed", async () => {
    const result = await runScript([], { SUPABASE_URL: "http://127.0.0.1:9", SUPABASE_SERVICE_ROLE_KEY: "test-not-a-key", REGISTER_REST_SCHEMA: "some_exposed_schema" })
    expect(result.code).toBe(0)
    expect(result.stdout).toContain("SKIPPED (could not read or evaluate the register")
  })
})
