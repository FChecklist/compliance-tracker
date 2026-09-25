/// <reference types="bun-types" />
// Tests for scripts/check-domain-drift.sh, the body of
// .github/workflows/domain-drift-check.yml.
//
// The original inline step used `curl -sf`, so an expired/revoked
// VERCEL_ACCESS_TOKEN (HTTP 401/403) was reported as "domain is NOT attached
// there. Drift detected." on every scheduled run. These tests run the REAL
// script under bash against a local mock of the Vercel API (Bun.serve, no
// network) and pin, per HTTP outcome, both the exit code and what the log
// says -- so a credential failure can never again be reported as drift, and
// drift can never again be reported as a credential failure.
//
// Exit codes under test: 0 = all domains match, 1 = proven drift,
// 2 = the guard could not run/verify (still non-zero: a guard that cannot
// run must not look green).
import { afterAll, describe, expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { join } from "node:path"

const SCRIPT = join(import.meta.dir, "check-domain-drift.sh").replaceAll("\\", "/")
const REPO_ROOT = join(import.meta.dir, "..")
const HAS_BASH = Bun.which("bash") !== null && Bun.which("curl") !== null

const TEAM = "team_Iqx3zyb7sDdsdzcNskCFFsHD"
const CANONICAL_ID = "prj_JA9mwUdOfW3SKSxjG4jdPo0R2iVM"
const OTHER_ID = "prj_SomeOtherProjectEntirely0000"
// A distinctive fake the tests can search the log for. Assembled at runtime,
// not written as a `token = "<high-entropy literal>"`, so the repo's secret
// scanner (gitleaks, default rules, no test allowlist) cannot mistake it for a
// real credential.
const TOKEN = ["distinctive", "fake", "credential", "9f8e7d6c"].join("_")

type MockReply = { status: number; body?: string }
type Seen = { path: string; query: string; auth: string | null }

const servers: Array<{ stop: (force?: boolean) => void }> = []
afterAll(() => {
  for (const s of servers) s.stop(true)
})

function startMock(reply: (domain: string) => MockReply) {
  const seen: Seen[] = []
  const server = Bun.serve({
    port: 0,
    hostname: "127.0.0.1",
    fetch(req) {
      const url = new URL(req.url)
      seen.push({ path: url.pathname, query: url.search, auth: req.headers.get("authorization") })
      const domain = decodeURIComponent(url.pathname.split("/").pop() ?? "")
      const r = reply(domain)
      return new Response(r.body ?? "", { status: r.status, headers: { "content-type": "application/json" } })
    },
  })
  servers.push(server)
  return { base: `http://127.0.0.1:${server.port}`, seen }
}

// token: a string sets the secret (possibly ""), null leaves it unset entirely.
async function runScript(apiBase: string, token: string | null = TOKEN) {
  const env: Record<string, string> = { ...(process.env as Record<string, string>), VERCEL_API_BASE: apiBase }
  env.NO_PROXY = "127.0.0.1"
  env.no_proxy = "127.0.0.1"
  if (token === null) delete env.VERCEL_ACCESS_TOKEN
  else env.VERCEL_ACCESS_TOKEN = token
  const proc = Bun.spawn(["bash", SCRIPT], { env, stdout: "pipe", stderr: "pipe" })
  const [out, err, code] = await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text(), proc.exited])
  return { code, out: out + err }
}

const attached = (projectId: string): MockReply => ({
  status: 200,
  body: JSON.stringify({ name: "projexa-ai.com", projectId, verified: true }),
})

describe.skipIf(!HAS_BASH)("check-domain-drift.sh: one honest message + exit code per HTTP outcome", () => {
  test("200 with the canonical projectId for both hostnames -- OK, exit 0, correct request shape", async () => {
    const mock = startMock(() => attached(CANONICAL_ID))
    const { code, out } = await runScript(mock.base)
    expect(code).toBe(0)
    expect(out).toContain("OK: projexa-ai.com -> projexa")
    expect(out).toContain("OK: www.projexa-ai.com -> projexa")
    expect(out).toContain("All domains match")
    expect(out).not.toContain("::error::")
    // The request that drove that verdict is the read-only per-project domain GET.
    expect(mock.seen.map((s) => s.path)).toEqual([
      `/v9/projects/${CANONICAL_ID}/domains/projexa-ai.com`,
      `/v9/projects/${CANONICAL_ID}/domains/www.projexa-ai.com`,
    ])
    expect(mock.seen.every((s) => s.query === `?teamId=${TEAM}`)).toBe(true)
    expect(mock.seen.every((s) => s.auth === `Bearer ${TOKEN}`)).toBe(true)
  })

  test("200 but a different projectId -- real drift, exit 1, names both ids", async () => {
    const mock = startMock(() => attached(OTHER_ID))
    const { code, out } = await runScript(mock.base)
    expect(code).toBe(1)
    expect(out).toContain(`resolves to projectId=${OTHER_ID}, expected ${CANONICAL_ID}`)
    expect(out).toContain("Drift detected")
    expect(out).not.toContain("COULD NOT")
  })

  test("404 -- domain not attached is real drift, exit 1, surfaces what the API said", async () => {
    const mock = startMock(() => ({
      status: 404,
      body: JSON.stringify({ error: { code: "not_found", message: "Domain not found" } }),
    }))
    const { code, out } = await runScript(mock.base)
    expect(code).toBe(1)
    expect(out).toContain("HTTP 404")
    expect(out).toContain("NOT attached")
    expect(out).toContain("Drift detected")
    expect(out).toContain("not_found")
    expect(out).toContain("Domain not found")
    // Real drift is not a credential problem: must not send anyone hunting for a token.
    expect(out).not.toContain("replace the VERCEL_ACCESS_TOKEN")
  })

  for (const status of [401, 403]) {
    test(`${status} -- an invalid token is NOT drift: exit 2, names the secret, says it is an owner action`, async () => {
      const mock = startMock(() => ({
        status,
        body: JSON.stringify({ error: { code: "forbidden", message: "Not authorized", invalidToken: true } }),
      }))
      const { code, out } = await runScript(mock.base)
      expect(code).toBe(2)
      expect(out).toContain(`HTTP ${status}`)
      expect(out).toContain("VERCEL_ACCESS_TOKEN")
      expect(out).toContain("NOT evidence of drift")
      expect(out).toContain("OWNER action")
      expect(out).toContain("COULD NOT RUN")
      // The exact misdiagnosis this whole change exists to remove.
      expect(out).not.toContain("NOT attached")
      expect(out).not.toContain("Drift detected")
    })
  }

  test("500 -- API error is not drift and not a pass: exit 2, reports the status", async () => {
    const mock = startMock(() => ({ status: 500, body: "upstream exploded" }))
    const { code, out } = await runScript(mock.base)
    expect(code).toBe(2)
    expect(out).toContain("unexpected HTTP 500")
    expect(out).toContain("NOT evidence of drift")
    expect(out).not.toContain("NOT attached")
  })

  test("429 rate limit -- classified as an API error, exit 2", async () => {
    const mock = startMock(() => ({ status: 429, body: JSON.stringify({ error: { code: "rate_limited", message: "Slow down" } }) }))
    const { code, out } = await runScript(mock.base)
    expect(code).toBe(2)
    expect(out).toContain("unexpected HTTP 429")
    expect(out).toContain("rate_limited")
  })

  test("nothing listening (transport failure) -- exit 2, says no HTTP response, not drift", async () => {
    const dead = startMock(() => attached(CANONICAL_ID))
    const base = dead.base
    servers.pop()!.stop(true) // free the port so the connection is refused
    const { code, out } = await runScript(base)
    expect(code).toBe(2)
    expect(out).toContain("no HTTP response")
    expect(out).toContain("NOT evidence of drift")
    expect(out).not.toContain("NOT attached")
  })

  test("200 with a body that has no projectId -- cannot verify, exit 2 (not silently 'drift', not a pass)", async () => {
    const mock = startMock(() => ({ status: 200, body: "{}" }))
    const { code, out } = await runScript(mock.base)
    expect(code).toBe(2)
    expect(out).toContain("no projectId")
    expect(out).not.toContain("OK:")
  })

  test("empty token -- exit 2 before any API call, names the secret", async () => {
    const mock = startMock(() => attached(CANONICAL_ID))
    const { code, out } = await runScript(mock.base, "")
    expect(code).toBe(2)
    expect(out).toContain("VERCEL_ACCESS_TOKEN")
    expect(out).toContain("empty or not set")
    expect(out).toContain("NOT evidence of drift")
    expect(mock.seen).toHaveLength(0)
  })

  test("unset token -- same as empty", async () => {
    const mock = startMock(() => attached(CANONICAL_ID))
    const { code, out } = await runScript(mock.base, null)
    expect(code).toBe(2)
    expect(out).toContain("empty or not set")
    expect(mock.seen).toHaveLength(0)
  })

  test("drift on one hostname plus an API error on the other -- exit 1 (drift outranks), both reported", async () => {
    const mock = startMock((domain) =>
      domain === "projexa-ai.com" ? { status: 404, body: "{}" } : { status: 503, body: "" },
    )
    const { code, out } = await runScript(mock.base)
    expect(code).toBe(1)
    expect(out).toContain("projexa-ai.com: HTTP 404")
    expect(out).toContain("www.projexa-ai.com: unexpected HTTP 503")
    expect(out).toContain("at least one other domain could not be verified")
  })

  test("the token value is never printed, even if the API echoes it back in an error body", async () => {
    const mock = startMock(() => ({
      status: 403,
      body: JSON.stringify({ error: { code: "forbidden", message: `bad credential ${TOKEN} rejected` } }),
    }))
    const { code, out } = await runScript(mock.base)
    expect(code).toBe(2)
    expect(out).not.toContain(TOKEN)
    expect(out).toContain("[redacted]")
  })

  test("a multi-line error body cannot break out of the one-line annotation", async () => {
    const mock = startMock(() => ({
      status: 500,
      body: '{"error":{"code":"boom","message":"line one\n::error::injected line"}}',
    }))
    const { out } = await runScript(mock.base)
    // Every line that mentions the injected text must still be OUR annotation line.
    for (const line of out.split(/\r?\n/).filter((l) => l.includes("injected"))) {
      expect(line.startsWith("::error::www.projexa-ai.com:") || line.startsWith("::error::projexa-ai.com:")).toBe(true)
    }
  })
})

describe("check-domain-drift.sh: static invariants (no bash needed)", () => {
  const script = readFileSync(join(import.meta.dir, "check-domain-drift.sh"), "utf8")
  const codeLines = script.split("\n").filter((l) => !l.trimStart().startsWith("#"))
  const code = codeLines.join("\n")
  // The script's own user-facing messages legitimately warn "do not use
  // 'vercel domains rm'"; what must never appear is that as a command.
  const commandLines = codeLines.filter((l) => !l.trimStart().startsWith("echo")).join("\n")

  test("hard-coded canonical values still match ai-os/DOMAIN_OWNERSHIP.yaml", () => {
    const yaml = readFileSync(join(REPO_ROOT, "ai-os", "DOMAIN_OWNERSHIP.yaml"), "utf8")
    const yamlProjectId = /canonical_project:\s*\n\s*name:\s*"([^"]+)"\s*\n\s*id:\s*"([^"]+)"/.exec(yaml)
    expect(yamlProjectId).not.toBeNull()
    expect(script).toContain(`CANONICAL_PROJECT_NAME="${yamlProjectId![1]}"`)
    expect(script).toContain(`CANONICAL_PROJECT_ID="${yamlProjectId![2]}"`)
    const yamlTeam = /vercel_team_id:\s*"([^"]+)"/.exec(yaml)
    expect(yamlTeam).not.toBeNull()
    expect(script).toContain(`TEAM="${yamlTeam![1]}"`)
    const yamlHosts = [...yaml.matchAll(/^\s+-\s+"([a-z0-9.-]+)"\s*$/gm)].map((m) => m[1])
    expect(yamlHosts.length).toBeGreaterThan(0)
    expect(script).toContain(`DOMAINS="${yamlHosts.join(" ")}"`)
  })

  test("GET-only: never a mutating verb and never `vercel domains rm`", () => {
    expect(code).not.toMatch(/-X\s*(POST|PUT|PATCH|DELETE)/i)
    expect(code).not.toMatch(/--request\s*(POST|PUT|PATCH|DELETE)/i)
    expect(code).not.toMatch(/--data|\s-d\s|--json|--form|\s-F\s|--upload-file|\s-T\s/)
    expect(commandLines).not.toMatch(/vercel\s+domains/i)
    expect(commandLines).not.toMatch(/^\s*(npx\s+|bunx\s+)?vercel\b/m)
  })

  test("never uses `curl -f`/--fail, which is what turned a 401/403 into 'domain not attached'", () => {
    expect(code).not.toMatch(/curl\s+-[a-zA-Z]*f/)
    expect(code).not.toContain("--fail")
    expect(code).toContain("%{http_code}")
  })

  test("the workflow runs this script and passes the token via the step env", () => {
    const wf = readFileSync(join(REPO_ROOT, ".github", "workflows", "domain-drift-check.yml"), "utf8")
    expect(wf).toContain("bash scripts/check-domain-drift.sh")
    expect(wf).toContain("VERCEL_ACCESS_TOKEN: ${{ secrets.VERCEL_ACCESS_TOKEN }}")
    expect(wf).not.toMatch(/curl\s+-[a-zA-Z]*f/)
  })
})
