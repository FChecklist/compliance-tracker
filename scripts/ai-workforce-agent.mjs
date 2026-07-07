#!/usr/bin/env node
// VERIDIAN AI Workforce — repo-write agent runner.
//
// Gives an AI Workforce role (any model in src/lib/ai-team/roster.ts) real
// read/write access to this checked-out repo via OpenRouter tool-calling,
// then hands off to the calling GitHub Actions workflow to commit/push/PR.
// Runs ONLY inside CI (a fresh checkout on a disposable runner) — never
// invoked against a developer's working tree, and never against `main`
// directly: the workflow always creates a new branch first and opens a PR,
// mirroring Security & Code Reviewer / Quality Gate Manager needing to
// look at the diff before merge (this codebase's existing branch
// protection posture on veda-advisors: 1 required review).
//
// Deliberately NO shell/exec tool. Only read_file/write_file/list_dir/
// finish. A less-trusted, less-proven model (vs. Z.ai/Claude Code, the two
// agents AGENTS.md actually authorizes for full-repo-write today) gets
// filesystem access only, not arbitrary command execution — CI's own
// lint/build/test steps are the safety net for anything the file edits
// might break, not this script trusting the model to run commands safely.

import { readFile, writeFile, readdir, stat, mkdir } from "node:fs/promises"
import path from "node:path"

const REPO_ROOT = process.cwd()
const MAX_ITERATIONS = 20
const MAX_FILE_BYTES = 200_000

const roleKey = process.env.AI_TEAM_ROLE_KEY
const task = process.env.AI_TEAM_TASK
const apiKey = process.env.OPENROUTER_API_KEY

if (!roleKey || !task || !apiKey) {
  console.error("Missing required env: AI_TEAM_ROLE_KEY, AI_TEAM_TASK, OPENROUTER_API_KEY")
  process.exit(1)
}

const { AI_TEAM_ROSTER } = await import(path.join(REPO_ROOT, "src/lib/ai-team/roster.ts"))
const role = AI_TEAM_ROSTER.find((r) => r.roleKey === roleKey)
if (!role || role.isHuman || role.isCodeOnly || !role.model) {
  console.error(`Role '${roleKey}' is not a repo-write-capable AI Workforce role.`)
  process.exit(1)
}

// Prompt-OS content, fetched via Supabase REST (PostgREST) rather than the
// Drizzle client -- this script runs standalone in CI, outside the Next.js
// process, and DATABASE_URL/APP_RUNTIME_DATABASE_URL are Vercel Sensitive
// vars not available here. SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY (both
// already GitHub Secrets on this repo) are enough for a read-only lookup
// against the platform-governed prompt_templates/prompt_versions tables.
async function fetchSystemPrompt(templateKey) {
  // SUPABASE_URL / NEXT_PUBLIC_SUPABASE_URL GitHub Secrets both resolved
  // empty in practice (confirmed via a real failed run 2026-07-07) --
  // falling back to the known project URL directly. Not a secret: this is
  // the public Supabase REST endpoint, gated by the (genuinely secret)
  // service role key below, same value as verdian-ai's project ref
  // pcrjmlpuqsbocqfwoxod confirmed live via the Supabase Management API.
  const supabaseUrl = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || "https://pcrjmlpuqsbocqfwoxod.supabase.co"
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
  const res = await fetch(
    `${supabaseUrl}/rest/v1/prompt_versions?select=content,prompt_templates!inner(template_key)&prompt_templates.template_key=eq.${templateKey}&label=eq.production&is_active=eq.true`,
    { headers: { apikey: serviceKey, Authorization: `Bearer ${serviceKey}`, "Accept-Profile": "compliance" } }
  )
  if (!res.ok) throw new Error(`Failed to fetch prompt template '${templateKey}': HTTP ${res.status} ${await res.text()}`)
  const rows = await res.json()
  if (!rows.length) throw new Error(`No production prompt_version found for '${templateKey}'`)
  return rows[0].content
}

function resolveSafe(relPath) {
  const resolved = path.resolve(REPO_ROOT, relPath)
  if (!resolved.startsWith(REPO_ROOT)) throw new Error(`Path escapes repo root: ${relPath}`)
  // Never allow the agent to touch AI-OS governance files, per CLAUDE.md's
  // own rule ("DO NOT touch: .claude/, CLAUDE.md, AGENTS.md, SENTINEL.md,
  // ai-os/") -- enforced here in code, not just as an instruction the model
  // could ignore.
  const rel = path.relative(REPO_ROOT, resolved).replace(/\\/g, "/")
  const forbidden = [".claude/", "CLAUDE.md", "AGENTS.md", "SENTINEL.md", "ai-os/", ".env", ".git/"]
  if (forbidden.some((f) => rel === f.replace(/\/$/, "") || rel.startsWith(f))) {
    throw new Error(`Path is governance-protected, cannot write: ${rel}`)
  }
  return resolved
}

const TOOLS = [
  {
    type: "function",
    function: {
      name: "read_file",
      description: "Read a text file from the repo, relative to repo root.",
      parameters: { type: "object", properties: { path: { type: "string" } }, required: ["path"] },
    },
  },
  {
    type: "function",
    function: {
      name: "write_file",
      description: "Write (create or overwrite) a text file in the repo, relative to repo root. Creates parent directories as needed.",
      parameters: { type: "object", properties: { path: { type: "string" }, content: { type: "string" } }, required: ["path", "content"] },
    },
  },
  {
    type: "function",
    function: {
      name: "list_dir",
      description: "List files and subdirectories at a path, relative to repo root.",
      parameters: { type: "object", properties: { path: { type: "string" } }, required: ["path"] },
    },
  },
  {
    type: "function",
    function: {
      name: "finish",
      description: "Call this when the task is complete (or cannot be completed) to end the session.",
      parameters: { type: "object", properties: { summary: { type: "string" }, filesChanged: { type: "array", items: { type: "string" } } }, required: ["summary"] },
    },
  },
]

async function execTool(name, args) {
  switch (name) {
    case "read_file": {
      const p = resolveSafe(args.path)
      const s = await stat(p)
      if (s.size > MAX_FILE_BYTES) return `ERROR: file too large (${s.size} bytes)`
      return await readFile(p, "utf8")
    }
    case "write_file": {
      const p = resolveSafe(args.path)
      await mkdir(path.dirname(p), { recursive: true })
      await writeFile(p, args.content, "utf8")
      return `OK: wrote ${args.content.length} bytes to ${args.path}`
    }
    case "list_dir": {
      const p = resolveSafe(args.path || ".")
      const entries = await readdir(p, { withFileTypes: true })
      return entries.map((e) => (e.isDirectory() ? `${e.name}/` : e.name)).join("\n")
    }
    default:
      return `ERROR: unknown tool ${name}`
  }
}

async function callOpenRouter(messages) {
  const res = await fetch("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
      "HTTP-Referer": "https://veridian-compliance-ai.vercel.app",
      "X-Title": "VERIDIAN AI Workforce",
    },
    body: JSON.stringify({ model: role.model, messages, tools: TOOLS, temperature: 0.2 }),
  })
  if (!res.ok) throw new Error(`OpenRouter HTTP ${res.status}: ${(await res.text()).slice(0, 500)}`)
  return res.json()
}

async function main() {
  const systemPrompt = await fetchSystemPrompt(role.promptKey)
  const messages = [
    { role: "system", content: `${systemPrompt}\n\nYou have read_file, write_file, list_dir, and finish tools against the actual VERIDIAN repo (compliance-tracker). Investigate before writing. Keep changes scoped to exactly what the task asks. Call finish when done.` },
    { role: "user", content: task },
  ]

  let finished = null
  const filesChanged = new Set()

  for (let i = 0; i < MAX_ITERATIONS && !finished; i++) {
    const response = await callOpenRouter(messages)
    const choice = response.choices?.[0]
    if (!choice) throw new Error("No response choice from OpenRouter")
    const msg = choice.message
    messages.push(msg)

    if (!msg.tool_calls?.length) {
      // Model replied with plain text instead of calling finish -- treat it
      // as the session ending anyway rather than looping on a model that
      // doesn't understand it should call the tool.
      finished = { summary: msg.content || "(no summary provided)", filesChanged: [...filesChanged] }
      break
    }

    for (const call of msg.tool_calls) {
      const args = JSON.parse(call.function.arguments || "{}")
      if (call.function.name === "finish") {
        finished = { summary: args.summary, filesChanged: args.filesChanged || [...filesChanged] }
        messages.push({ role: "tool", tool_call_id: call.id, content: "Session ending." })
        break
      }
      let result
      try {
        result = await execTool(call.function.name, args)
        if (call.function.name === "write_file") filesChanged.add(args.path)
      } catch (err) {
        result = `ERROR: ${err.message}`
      }
      messages.push({ role: "tool", tool_call_id: call.id, content: String(result).slice(0, 8000) })
    }
  }

  if (!finished) {
    finished = { summary: `Stopped after ${MAX_ITERATIONS} iterations without calling finish.`, filesChanged: [...filesChanged] }
  }

  console.log("=== AI WORKFORCE AGENT RESULT ===")
  console.log(JSON.stringify({ roleKey, model: role.model, ...finished }, null, 2))

  // GITHUB_OUTPUT for the workflow step to pick up.
  if (process.env.GITHUB_OUTPUT) {
    const fs = await import("node:fs")
    fs.appendFileSync(process.env.GITHUB_OUTPUT, `summary=${finished.summary.replace(/\n/g, " ").slice(0, 500)}\n`)
    fs.appendFileSync(process.env.GITHUB_OUTPUT, `files_changed=${finished.filesChanged.length}\n`)
  }
}

main().catch((err) => {
  console.error("AI Workforce agent failed:", err)
  process.exit(1)
})
