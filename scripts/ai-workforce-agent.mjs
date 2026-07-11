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
// 3 of 4 real tasks in one smoke-testing batch (2026-07-07) hit this
// ceiling with ZERO output -- any task needing 2-3 reads before it can
// write anything (the common case: read the existing pattern, then follow
// it) burned the whole budget just exploring. Raised from 20; still a
// hard bound, not unlimited.
const MAX_ITERATIONS = 40
const MAX_FILE_BYTES = 200_000

const roleKey = process.env.AI_TEAM_ROLE_KEY
const apiKey = process.env.OPENROUTER_API_KEY

// VERIDIAN_TASK_GOVERNANCE_CONSTITUTION.md, Objective/Scope/Instruction
// Validation Guardrails: this is the exact script whose real incident
// history motivated this change -- see task-tightening.ts's module header
// for the two real z.ai dispatches that burned the whole MAX_ITERATIONS
// budget with zero output because the brief had no explicit scope cap or
// completion definition, and were only fixed by manually rewriting the
// brief with those things spelled out. A single free-text AI_TEAM_TASK is
// no longer accepted -- the three fields below are required, validated
// with the same deterministic check the Next.js dispatch route uses,
// before the agent loop (and any OpenRouter spend) starts.
const { validateTightTask, assembleTightTaskPrompt } = await import(path.join(REPO_ROOT, "src/lib/task-tightening.ts"))

const rawTask = {
  objective: process.env.AI_TEAM_TASK_OBJECTIVE,
  scope: process.env.AI_TEAM_TASK_SCOPE,
  successCriteria: process.env.AI_TEAM_TASK_SUCCESS_CRITERIA,
  constraints: process.env.AI_TEAM_TASK_CONSTRAINTS || undefined,
}

if (!roleKey || !apiKey) {
  console.error("Missing required env: AI_TEAM_ROLE_KEY, OPENROUTER_API_KEY")
  process.exit(1)
}

const tightness = validateTightTask(rawTask)
if (!tightness.valid) {
  console.error(`[ai-workforce-agent] Task rejected -- not tight enough to dispatch: ${tightness.reason}`)
  console.error(`[ai-workforce-agent] ${tightness.guidance}`)
  console.error("[ai-workforce-agent] Required env vars: AI_TEAM_TASK_OBJECTIVE, AI_TEAM_TASK_SCOPE, AI_TEAM_TASK_SUCCESS_CRITERIA (AI_TEAM_TASK_CONSTRAINTS is optional).")
  process.exit(1)
}

const task = assembleTightTaskPrompt(rawTask)

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
// Two real CI runs (2026-07-07) threw ERR_INVALID_URL even after falling
// back to a hardcoded, known-good URL -- meaning the GitHub Secret values
// themselves aren't empty, they're wrapped in literal quote characters
// (e.g. the secret's stored value is `"https://...supabase.co"`, quotes
// included). Stripping matching leading/trailing quotes defensively rather
// than trying to fix however the secrets were originally set.
function stripQuotes(s) {
  if (!s) return s
  const trimmed = s.trim()
  return trimmed.replace(/^['"]|['"]$/g, "")
}

// Two real CI runs (2026-07-07) proved SUPABASE_URL and
// SUPABASE_SERVICE_ROLE_KEY are BOTH stale -- they resolve to
// `jusqumifsmtcaujqyjuy.supabase.co`, a project that doesn't exist in this
// account at all (confirmed via list_projects: the only real project is
// pcrjmlpuqsbocqfwoxod/verdian-ai), so the "service role key" is actually
// some other project's key entirely (HTTP 401 "Invalid API key" once the
// URL itself was hardcoded correctly). Same "stale ref left over from a
// deleted project" pattern as the DATABASE_URL wrong-region bug.
//
// Rather than depend on a service_role key at all, prompt_templates/
// prompt_versions got an explicit public-read RLS policy added this
// session (matching their own schema comment: "Global-read platform
// catalog... prompt content is a platform-governed asset" -- the intent
// was always public-read, RLS just never had a policy enforcing it). Uses
// dedicated, freshly-verified secrets (AI_TEAM_SUPABASE_URL/
// AI_TEAM_SUPABASE_ANON_KEY) instead of the untrustworthy shared ones.
async function fetchSystemPrompt(templateKey) {
  const supabaseUrl = stripQuotes(process.env.AI_TEAM_SUPABASE_URL) || "https://pcrjmlpuqsbocqfwoxod.supabase.co"
  const serviceKey = stripQuotes(process.env.AI_TEAM_SUPABASE_ANON_KEY)
  const url = `${supabaseUrl}/rest/v1/prompt_versions?select=content,prompt_templates!inner(template_key)&prompt_templates.template_key=eq.${templateKey}&label=eq.production&is_active=eq.true`
  console.log(`[ai-workforce-agent] fetching prompt from: ${url.slice(0, 60)}... (serviceKey present: ${!!serviceKey}, len: ${serviceKey?.length ?? 0})`)
  const res = await fetch(url, { headers: { apikey: serviceKey, Authorization: `Bearer ${serviceKey}`, "Accept-Profile": "compliance" } })
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

// Token Usage Ledger (Finance, 2026-07-08): this script previously had NO
// internal record of its own OpenRouter spend at all -- the only way to
// answer "how much did we spend and on what" was to query OpenRouter's own
// billing API directly (which is how the $11.44-of-$12.34 Claude Sonnet 5
// cost concentration was actually discovered). Best-effort, never fatal:
// a logging failure must never break the actual agent run.
//
// 12th real bug found (2026-07-09, VERIDIAN.docx study dispatch): every
// single call hit "Header 'x-ai-team-secret' has invalid value" -- the
// exact same GitHub-Secret-values-wrapped-in-literal-quotes failure mode
// this file already found and fixed for SUPABASE_URL/SERVICE_ROLE_KEY (see
// stripQuotes() above), but the fix was never applied here. A header value
// containing literal `"` characters is invalid, so this failed on 100% of
// calls, not intermittently -- confirming the pattern rather than being a
// one-off.
async function logUsageToLedger(usage) {
  const logUrl = stripQuotes(process.env.AI_TEAM_LOG_URL)
  const logSecret = stripQuotes(process.env.AI_TEAM_LOG_SECRET)
  if (!logUrl || !logSecret || !usage) return
  try {
    await fetch(logUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-ai-team-secret": logSecret },
      body: JSON.stringify({
        roleKey,
        model: role.model,
        provider: "openrouter",
        promptTokens: usage.prompt_tokens ?? 0,
        completionTokens: usage.completion_tokens ?? 0,
        taskSummary: task.slice(0, 200),
      }),
    })
  } catch (err) {
    console.error("[ai-workforce-agent] failed to log token usage (non-fatal):", err.message)
  }
}

// 11th real bug found running this pipeline (2026-07-09, VERIDIAN.docx study
// dispatch): a real run crashed the ENTIRE process with an uncaught
// SyntaxError from `res.json()` after ~4 minutes and multiple iterations --
// `res.ok` was true (so it wasn't an HTTP error status) but the body wasn't
// valid JSON, consistent with a gateway/proxy timeout truncating the stream
// mid-response on a long-running completion (large multi-file context +
// reasoning-heavy model + a big write_file argument). Unlike the malformed
// tool-call-arguments case a few iterations later in this same file (which
// already retries gracefully), this failure happened one layer up, in the
// HTTP call itself, with no retry at all -- one transient network hiccup
// threw away the whole session's progress. Now retries transient failures
// (network errors and unparseable-response bodies) up to 3 times with a
// short backoff before giving up, and reads the body as text first so a
// parse failure can still report a diagnostic snippet instead of just
// "Failed to parse JSON" with no context.
const OPENROUTER_MAX_RETRIES = 3
const OPENROUTER_RETRY_DELAY_MS = 3000

async function callOpenRouter(messages) {
  let lastErr
  for (let attempt = 1; attempt <= OPENROUTER_MAX_RETRIES; attempt++) {
    try {
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
      const bodyText = await res.text()
      if (!res.ok) throw new Error(`OpenRouter HTTP ${res.status}: ${bodyText.slice(0, 500)}`)
      let json
      try {
        json = JSON.parse(bodyText)
      } catch (parseErr) {
        throw new Error(
          `OpenRouter returned HTTP ${res.status} but an unparseable body (likely a truncated/gateway-timeout response, ${bodyText.length} chars received): ${parseErr.message}. Body snippet: ${bodyText.slice(0, 300)}`
        )
      }
      await logUsageToLedger(json.usage)
      return json
    } catch (err) {
      lastErr = err
      if (attempt < OPENROUTER_MAX_RETRIES) {
        console.error(`[ai-workforce-agent] OpenRouter call failed (attempt ${attempt}/${OPENROUTER_MAX_RETRIES}), retrying in ${OPENROUTER_RETRY_DELAY_MS}ms: ${err.message}`)
        await new Promise((r) => setTimeout(r, OPENROUTER_RETRY_DELAY_MS))
      }
    }
  }
  throw new Error(`OpenRouter call failed after ${OPENROUTER_MAX_RETRIES} attempts: ${lastErr.message}`)
}

// 10th real bug found running this pipeline (2026-07-08): chat-completion
// APIs are stateless -- every call resends the ENTIRE conversation, so a
// file read on iteration 3 gets re-transmitted (and re-billed) on every
// subsequent iteration up to 40, not paid for once. This is the confirmed
// root cause behind the $11.44-of-$12.34 cost concentration on the long,
// multi-file-read tasks (the evaluations, the audit prep). Fix: keep the
// last KEEP_RECENT_READS read_file results fully visible (a model often
// legitimately needs to re-check a file it read a couple of turns ago),
// but collapse anything older to a one-line placeholder -- re-reading is
// cheap (local disk, no network) if the model genuinely needs the content
// again, so this trades a small amount of possible re-reading for
// bounding growth to roughly linear instead of quadratic.
const KEEP_RECENT_READS = 3

function collapseOldReadFileResults(messages, readFileResults, currentIteration) {
  for (const entry of readFileResults) {
    if (entry.collapsed) continue
    if (currentIteration - entry.iteration < KEEP_RECENT_READS) continue
    const msg = messages[entry.index]
    if (!msg || msg.role !== "tool") continue
    const originalLength = msg.content.length
    msg.content = `[Already read earlier: ${entry.path} (${originalLength} chars) -- call read_file again if you need to see its content now.]`
    entry.collapsed = true
  }
}

async function main() {
  const systemPrompt = await fetchSystemPrompt(role.promptKey)
  const messages = [
    { role: "system", content: `${systemPrompt}\n\nYou have read_file, write_file, list_dir, and finish tools against the actual VERIDIAN repo (compliance-tracker). Investigate before writing. Keep changes scoped to exactly what the task asks. Call finish when done.` },
    { role: "user", content: task },
  ]

  let finished = null
  const filesChanged = new Set()
  const readFileResults = [] // { index, path, iteration, collapsed }

  for (let i = 0; i < MAX_ITERATIONS && !finished; i++) {
    collapseOldReadFileResults(messages, readFileResults, i)
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
      // 9th real bug found running this pipeline (2026-07-07): a real run
      // crashed the ENTIRE process with an unhandled SyntaxError here --
      // the model's tool-call arguments JSON came back truncated
      // ("Unexpected EOF"), most likely from writing a large multi-
      // function file in one write_file call and hitting a completion
      // length limit mid-generation. A malformed tool call is now a
      // retryable error fed back to the model (which can retry smaller,
      // e.g. split the write into more calls), not a fatal crash that
      // throws away the whole session's progress.
      let args
      try {
        args = JSON.parse(call.function.arguments || "{}")
      } catch (err) {
        messages.push({ role: "tool", tool_call_id: call.id, content: `ERROR: your last tool call's arguments were not valid JSON (${err.message}) -- likely truncated because the content was too large for one call. Retry with a smaller write_file call (e.g. split the file into multiple write_file calls, or shorten it), and double-check your JSON escaping.` })
        continue
      }
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
      // A real run (2026-07-07) proved this cap was a genuine bug, not
      // just a defensive limit: it silently truncated read_file's output
      // to 8000 CHARACTERS (not the file-size cap, MAX_FILE_BYTES=200KB,
      // which never fired) mid-token, well below most real source files in
      // this repo. The model (correctly) refused to write_file a
      // reconstruction of a file it could only see ~30% of rather than
      // risk destroying the unseen ~70%. read_file results are now
      // unsliced (up to MAX_FILE_BYTES, already enforced in execTool);
      // only list_dir/write_file/finish confirmations (naturally short)
      // keep the 8000-char cap, as a genuine guard against a runaway or
      // malformed tool result.
      const content = call.function.name === "read_file" ? String(result) : String(result).slice(0, 8000)
      messages.push({ role: "tool", tool_call_id: call.id, content })
      if (call.function.name === "read_file" && !String(result).startsWith("ERROR:")) {
        readFileResults.push({ index: messages.length - 1, path: args.path, iteration: i, collapsed: false })
      }
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
