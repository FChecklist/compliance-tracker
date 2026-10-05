/// <reference types="bun-types" />
// Audit 100, checklist rows B45 (MCP at the link works from a REAL client) and A29 (Claude can use the link as a connector), in the one form
// that needs no browser and no account of the owner's: Claude Code, the real MCP client, is started on this laptop with the work link as its
// ONLY MCP server (--strict-mcp-config), told to call the list_projects tool, and its answer is checked against the database.
//   claude -p --strict-mcp-config --mcp-config {"mcpServers":{"awl":{"type":"http","url":"<link>"}}} --allowedTools mcp__awl__list_projects
// What is proved: the client connects over HTTP with no sign-in, completes initialize, lists the tools, calls list_projects, and the number it
// reports is the number of projects the database says the test person can read. A client that could not use the link would answer
// something else (or fail). The throwaway link is a senior_professional of the e2e organisation; the client is limited to the one read tool, and the link is revoked at the end.
// The link is given to the local Claude Code process as its connector address; it is never put in the prompt, so the model never sees it.
// It spends a little of the owner's Claude subscription (one short prompt, tools restricted to this one read tool). Skips itself with no
// management token or no claude.exe.
// Run: bun test --isolate ./scripts/verify/awl-live/claude-mcp-client.live.test.ts
import { describe, test, expect, beforeAll, afterAll, setDefaultTimeout } from "bun:test"
import { spawnSync } from "node:child_process"
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { E2E_ORG, PEOPLE, expectPerson, liveEnabled, mgmtSql, mintThrowaway, redact, revoke, type Throwaway } from "./live-lib"

setDefaultTimeout(300_000)

const CLAUDE = process.env.AI_BRIDGE_CLAUDE_BIN || join(process.env.APPDATA || "", "npm", "node_modules", "@anthropic-ai", "claude-code", "bin", "claude.exe")
const canRun = liveEnabled() && existsSync(CLAUDE)

describe.skipIf(!canRun)("Claude Code as a real MCP client of the work link (live)", () => {
  let link: Throwaway
  let work = ""

  beforeAll(async () => {
    await expectPerson(PEOPLE.reader2, "senior_professional")
    link = await mintThrowaway(PEOPLE.reader2, "audit100 claude-mcp")
    work = mkdtempSync(join(tmpdir(), "awl-claude-mcp-"))
    writeFileSync(join(work, "mcp.json"), JSON.stringify({ mcpServers: { awl: { type: "http", url: link.url } } }))
  }, 300_000)

  afterAll(async () => {
    if (link) await revoke(link.id)
    if (work) rmSync(work, { recursive: true, force: true })
  })

  test("the client connects with no sign-in and list_projects reports exactly the number of projects the database says the person can read", async () => {
    const [row] = await mgmtSql<{ n: number }>(`select count(*)::int as n from compliance.projects where org_id = '${E2E_ORG}'`)
    expect(row.n).toBeGreaterThan(5)

    const attempt = () => spawnSync(
      CLAUDE,
      [
        "-p", "An MCP server named awl is connected and has a tool list_projects (full name mcp__awl__list_projects). If it is not in your tool list yet, load it with ToolSearch using the query select:mcp__awl__list_projects (the server may need a moment to connect: try again if it is not found). Call it with no arguments. Then reply with ONLY the integer in the field named total of its answer, and nothing else.",
        "--strict-mcp-config", "--mcp-config", join(work, "mcp.json"),
        "--allowedTools", "mcp__awl__list_projects",
        "--disable-slash-commands", "--setting-sources", "project", "--no-session-persistence",
        "--output-format", "stream-json", "--verbose", "--model", "sonnet",
      ],
      { cwd: work, encoding: "utf8", timeout: 240_000, env: { ...process.env, MCP_TIMEOUT: "60000" } },
    )
    // Claude Code connects MCP servers in the background, and on this laptop a TCP connect to the Supabase host sometimes stalls for ~21 s before it
    // fails once (measured: "Connection failed after 21205ms: Unable to connect", then the retry connects in 1.3 s). The model can give up before the
    // retry lands. That is the caller's network (checklist row B33), not the function, so the run is repeated - up to 3 times - ONLY when the
    // client never got as far as calling the tool. A client that called the tool and got a wrong answer fails at once.
    let r = attempt()
    let tries = 1
    const called = (res: ReturnType<typeof attempt>) => /"name":"mcp__awl__list_projects"/.test(redact(res.stdout ?? ""))
    while (!called(r) && tries < 3) { r = attempt(); tries++ }
    console.log(`claude attempts needed to reach the tool: ${tries}`)
    const out = redact(`${r.stdout ?? ""}`)
    expect(r.status, redact(`claude exited ${r.status}: ${r.stderr ?? ""}`.slice(0, 400))).toBe(0)
    // stream-json: one JSON event per line. The tool call and the final result are both in it.
    const events = out.split(String.fromCharCode(10)).filter((l) => l.trim().startsWith("{")).map((l) => JSON.parse(l))
    if (process.env.AWL_DEBUG) console.log(redact(JSON.stringify(events.map((e: any) => ({ type: e.type, subtype: e.subtype, tools: (e.message?.content ?? []).filter((c: any) => c.type === "tool_use").map((c: any) => c.name), servers: e.mcp_servers, toolnames: e.tools?.filter?.((t: string) => t.startsWith("mcp__")) })))))
    const toolCalls = events.flatMap((e: any) => (e.type === "assistant" ? e.message?.content ?? [] : [])).filter((c: any) => c.type === "tool_use")
    // the connector was used: Claude Code called exactly the read tool of the work link
    expect(toolCalls.map((c: any) => c.name)).toContain("mcp__awl__list_projects")
    // and the connector really connected: the init event lists the awl server as connected, with its tools
    const init = events.find((e: any) => e.type === "system" && e.subtype === "init")
    // (the init event is written before the HTTP connection has finished, so its status may still read "pending": what proves the connection
    // is the tool call that came back OK below, and the number it carried)
    expect(["connected", "pending"]).toContain(init?.mcp_servers?.find((m: any) => m.name === "awl")?.status)
    const call = toolCalls.find((c: any) => c.name === "mcp__awl__list_projects")
    const result = events.flatMap((e: any) => (e.type === "user" ? e.message?.content ?? [] : [])).find((c: any) => c.type === "tool_result" && c.tool_use_id === call.id)
    expect(result, "the tool call must have a result").toBeDefined()
    expect(result.is_error).toBeFalsy()
    expect(JSON.parse(Array.isArray(result.content) ? result.content[0].text : String(result.content)).total).toBe(row.n)
    const final = events.find((e: any) => e.type === "result")
    expect(final?.is_error).toBeFalsy()
    expect(String(final?.result).trim()).toBe(String(row.n))
  })
})
