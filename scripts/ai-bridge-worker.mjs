#!/usr/bin/env node
// PROJEXA test-mode AI BRIDGE worker (owner directive 2026-10-01). Run this on the owner's laptop while it is switched on:
//     node scripts/ai-bridge-worker.mjs
// It polls the database queue (drizzle/0670, src/lib/ai/claude-code-bridge.ts), answers each in-app model call through HEADLESS Claude Code
// (`claude -p`) and writes the answer back. The in-app AI is therefore Claude Code on this machine -- no paid model API, no Vercel compute.
//
// SAFETY. Every request is run with ALL tools disabled (`--tools ""`), no slash commands, no session saved, in an empty scratch directory:
// the text of a prompt (which can contain customer data and anything a user typed) can make Claude Code produce text, but cannot make it read a
// file, run a command or reach the network. One request at a time (this laptop has 8 GB; concurrency would only fight the app for RAM).
//
// CONFIG (environment, read from .env.local if present): SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY (the service_role-only functions are called
// over HTTPS), or else DATABASE_URL as a service-role connection, AI_BRIDGE_CLAUDE_MODEL (default "sonnet"), AI_BRIDGE_WORKER_ID, AI_BRIDGE_RUN_TIMEOUT_MS (default 120000).
// Flags: --once (claim at most one request then exit), --selftest (run one tiny prompt through Claude Code without touching the database).
import { spawn } from "node:child_process"
import { mkdtempSync, existsSync } from "node:fs"
import { tmpdir, hostname } from "node:os"
import { join } from "node:path"
import { pathToFileURL } from "node:url"

export const IDLE_POLL_MS = 2_500

/** The `claude` arguments for one request. Pure, so a test can prove tools stay disabled. */
export function buildClaudeArgs({ system, model }) {
  const args = ["-p", "--tools", "", "--output-format", "text", "--no-session-persistence", "--disable-slash-commands", "--model", model]
  if (system && system.trim()) args.push("--system-prompt", system)
  return args
}

/** JSON mode: strip a markdown fence if the model added one; anything that is not valid JSON afterwards is an error, not a guess. */
export function cleanJsonAnswer(text) {
  let t = String(text ?? "").trim()
  const fence = t.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i)
  if (fence) t = fence[1].trim()
  JSON.parse(t) // throws if it is not JSON
  return t
}

/** The claude executable, never a shell shim. AI_BRIDGE_CLAUDE_BIN wins; on Windows the npm shim's own claude.exe is used. */
export function claudeBinary() {
  if (process.env.AI_BRIDGE_CLAUDE_BIN) return process.env.AI_BRIDGE_CLAUDE_BIN
  if (process.platform !== "win32") return "claude"
  const exe = join(process.env.APPDATA || "", "npm", "node_modules", "@anthropic-ai", "claude-code", "bin", "claude.exe")
  if (existsSync(exe)) return exe
  throw new Error("claude.exe not found; set AI_BRIDGE_CLAUDE_BIN to its full path")
}

export function runClaude({ system, user, model, timeoutMs, cwd, spawnImpl = spawn }) {
  return new Promise((resolve, reject) => {
    // Never through a shell: on Windows cmd.exe re-splits the arguments, which breaks the system prompt and turns `--tools ""` into a flag that
    // swallows the next one (tools left ON). The real claude.exe is started directly with the argument list as it is.
    let bin
    try {
      bin = claudeBinary()
    } catch (e) {
      clearTimeout(0)
      reject(e)
      return
    }
    const child = spawnImpl(bin, buildClaudeArgs({ system, model }), { cwd, stdio: ["pipe", "pipe", "pipe"], shell: false, windowsHide: true })
    let out = ""
    let err = ""
    const timer = setTimeout(() => {
      child.kill()
      reject(new Error(`claude did not finish within ${timeoutMs} ms`))
    }, timeoutMs)
    child.stdout.on("data", (d) => (out += d))
    child.stderr.on("data", (d) => (err += d))
    child.on("error", (e) => {
      clearTimeout(timer)
      reject(e)
    })
    child.on("close", (code) => {
      clearTimeout(timer)
      if (code === 0 && out.trim()) resolve(out.trim())
      else reject(new Error(`claude exited ${code}: ${(err || out).trim().slice(0, 500)}`))
    })
    child.stdin.end(user)
  })
}

export async function answerOne(job, { model, timeoutMs, cwd, run = runClaude }) {
  const text = await run({ system: job.system, user: job.user, model, timeoutMs, cwd })
  const content = job.options?.jsonMode === true ? cleanJsonAnswer(text) : text
  return { content }
}

function loadEnv() {
  for (const f of [".env.local", ".env"]) if (existsSync(f)) try { process.loadEnvFile(f) } catch { /* older node: fall through to the real environment */ }
}

async function main() {
  const once = process.argv.includes("--once")
  const model = process.env.AI_BRIDGE_CLAUDE_MODEL || "sonnet"
  const timeoutMs = Number(process.env.AI_BRIDGE_RUN_TIMEOUT_MS || 120_000)
  const cwd = mkdtempSync(join(tmpdir(), "ai-bridge-"))

  if (process.argv.includes("--selftest")) {
    const answer = await runClaude({ system: "Reply with exactly the single word OK.", user: "ping", model, timeoutMs, cwd })
    console.log(`selftest answer: ${JSON.stringify(answer)}`)
    return
  }

  loadEnv()
  // The three queue functions are service_role-only (drizzle/0670). The laptop's DATABASE_URL is normally the app's limited role, so the
  // worker prefers the HTTPS API with the service key (SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY, both already in .env.local); a direct
  // service-role DATABASE_URL still works when no key is set.
  const apiUrl = (process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || "").replace(/\/$/, "")
  const apiKey = process.env.SUPABASE_SERVICE_ROLE_KEY
  let sql = null
  let rpc
  if (apiUrl && apiKey) {
    rpc = async (fn, args) => {
      const res = await fetch(`${apiUrl}/rest/v1/rpc/${fn}`, {
        method: "POST",
        headers: { apikey: apiKey, authorization: `Bearer ${apiKey}`, "content-type": "application/json" },
        body: JSON.stringify(args),
        signal: AbortSignal.timeout(20_000),
      })
      const text = await res.text()
      if (!res.ok) throw new Error(`rpc ${fn} -> ${res.status}: ${text.slice(0, 200)}`)
      return text ? JSON.parse(text) : null
    }
  } else {
    if (!process.env.DATABASE_URL) throw new Error("Set SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY (or a service-role DATABASE_URL) in .env.local.")
    const { default: postgres } = await import("postgres")
    sql = postgres(process.env.DATABASE_URL, { max: 1, prepare: false, idle_timeout: 20, connect_timeout: 15 })
    const sqlRpc = {
      ai_bridge_claim: async (a) => (await sql`select public.ai_bridge_claim(${a.p_worker}) as r`)[0].r,
      ai_bridge_complete: async (a) => (await sql`select public.ai_bridge_complete(${a.p_id}::uuid, ${a.p_response === null ? null : JSON.stringify(a.p_response)}::jsonb, ${a.p_error}) as r`)[0].r,
      ai_bridge_purge: async () => (await sql`select public.ai_bridge_purge() as r`)[0].r,
    }
    rpc = (fn, args) => sqlRpc[fn](args)
  }
  const workerId = process.env.AI_BRIDGE_WORKER_ID || `${hostname()}-${process.pid}`
  console.log(`[ai-bridge] worker ${workerId} up, model ${model}. Ctrl+C to stop.`)
  let stopping = false
  process.on("SIGINT", () => (stopping = true))
  let lastPurge = 0

  while (!stopping) {
    try {
      const job = await rpc("ai_bridge_claim", { p_worker: workerId })
      if (job) {
        const started = Date.now()
        try {
          const response = await answerOne(job, { model, timeoutMs, cwd })
          await rpc("ai_bridge_complete", { p_id: job.id, p_response: response, p_error: null })
          console.log(`[ai-bridge] ${job.purpose ?? "request"} answered in ${Date.now() - started} ms`)
        } catch (e) {
          await rpc("ai_bridge_complete", { p_id: job.id, p_response: null, p_error: String(e?.message ?? e) })
          console.error(`[ai-bridge] ${job.purpose ?? "request"} failed: ${e?.message ?? e}`)
        }
        if (once) break
        continue // look for the next request straight away
      }
      if (Date.now() - lastPurge > 10 * 60_000) {
        lastPurge = Date.now()
        await rpc("ai_bridge_purge", {})
      }
    } catch (e) {
      console.error(`[ai-bridge] database error: ${e?.message ?? e}`)
    }
    if (once && !stopping) break
    await new Promise((resolve) => setTimeout(resolve, IDLE_POLL_MS))
  }
  if (sql) await sql.end({ timeout: 5 })
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((e) => {
    console.error(e)
    process.exit(1)
  })
}
