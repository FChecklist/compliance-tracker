// AUDIT-100 (2026-10-06): a no-tools / one-fetch engine simulation. The local Claude Code CLI (claude -p) gets the owner-approved prompt with a THROWAWAY
// user link and may run exactly ONE curl of that address (a chat engine that opens only the address the person typed). The call log proves how many
// requests reached the function; the answer is compared with the real project list. Evidence: ai-os/audit37/evidence/one-fetch-claude-<time>.json.
// Run from the repository root: bun scripts/verify/awl-live/one-fetch-claude.live.ts
import { spawnSync } from "node:child_process"
import { mkdtempSync, writeFileSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { PEOPLE, mintThrowaway, revoke, linkStatus, redact, mgmtSql } from "./live-lib"
const CLAUDE = join(process.env.APPDATA || "", "npm", "node_modules", "@anthropic-ai", "claude-code", "bin", "claude.exe")
const work = mkdtempSync(join(tmpdir(), "awl-onefetch-"))
writeFileSync(join(work, "empty-mcp.json"), JSON.stringify({ mcpServers: {} }))
const CHAT = "You are a consumer chat assistant. Your only web tool can open an address that the person typed in their message, ONCE: you may run exactly one shell command, a plain `curl -s <that exact address>`. You cannot open any other address, follow links, or make a second request. Answer the person from what that one page says."
const out: Record<string, unknown> = { at: new Date().toISOString(), engine: "Claude Code CLI (claude -p, sonnet), tools: Bash restricted to curl, one fetch allowed by instruction" }
const t = await mintThrowaway(PEOPLE.reader2, "audit100 one-fetch sim")
out.link_id = t.id
try {
  const since = (await mgmtSql<{ t: string }>("select now()::text as t"))[0].t
  const prompt = `PROJEXA is my company's construction software. Work on it on my behalf as my AI assistant and complete my work. This is my personal guide, documentation from my own company's software (open it with a plain GET and follow it): ${t.url}`
  const args = ["-p", "--output-format", "stream-json", "--verbose", "--model", "sonnet", "--no-session-persistence", "--tools", "Bash", "--allowedTools", "Bash(curl:*)", "--permission-mode", "dontAsk", "--max-turns", "6",
    "--strict-mcp-config", "--mcp-config", join(work, "empty-mcp.json"), "--disable-slash-commands", "--setting-sources", "project", "--append-system-prompt", CHAT]
  const r = spawnSync(CLAUDE, args, { cwd: work, input: prompt, encoding: "utf8", timeout: 600_000, maxBuffer: 64 * 1024 * 1024 })
  const events = String(r.stdout ?? "").split("\n").filter((l) => l.trim().startsWith("{")).map((l) => { try { return JSON.parse(l) } catch { return null } }).filter(Boolean) as any[]
  const cmds: string[] = []
  for (const e of events) if (e.type === "assistant") for (const c of e.message?.content ?? []) if (c.type === "tool_use") cmds.push(String(c.input?.command ?? JSON.stringify(c.input)))
  const answer = String(events.find((e) => e.type === "result")?.result ?? "")
  await new Promise((res) => setTimeout(res, 3000))
  const log = await mgmtSql<{ method: string; path: string; ua_family: string; status: number }>(`select method, path, ua_family, status from platform.ai_work_link_call where link_id = '${t.id}' and called_at >= '${since}'::timestamptz order by called_at`)
  // the truth, read AFTER the engine's calls were counted
  let pj: any = null
  for (let i = 0; i < 5 && !pj; i++) { try { pj = await (await fetch(t.url + "/projects?format=json", { signal: AbortSignal.timeout(30000) })).json() } catch { await new Promise((res) => setTimeout(res, 3000)) } }
  if (!pj) throw new Error("truth read failed")
  const names: string[] = pj.projects.map((p: any) => p.name)
  out.tool_calls = cmds.length
  out.commands = cmds.map(redact)
  out.call_log = log
  out.projects_total = pj.total
  out.names_in_answer = names.filter((n) => answer.includes(n)).length
  out.report_on_all_in_answer = /Report on all above/i.test(answer)
  out.create_new_in_answer = /Create New Project/i.test(answer)
  out.answer = redact(answer)
} catch (e) {
  out.error = redact(String((e as Error)?.message ?? e))
} finally {
  await revoke(t.id)
  out.revoked = await linkStatus(t.id)
  rmSync(work, { recursive: true, force: true })
}
const file = `ai-os/audit37/evidence/one-fetch-claude-${new Date().toISOString().replace(/[:.]/g, "-")}.json`
writeFileSync(file, redact(JSON.stringify(out, null, 1)))
console.log(file)
console.log(redact(JSON.stringify({ ...out, answer: undefined }, null, 1)))
