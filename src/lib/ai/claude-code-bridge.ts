// PROJEXA test-mode AI BRIDGE (owner directive 2026-10-01). While PROJEXA is tested before go-live, in-app model calls are answered by
// Claude Code running on the owner's own laptop, not by a paid model API. A Vercel function cannot reach a laptop, so this is a QUEUE:
// callViaBridge() enqueues the request in the database (drizzle/0670) and polls for the answer; scripts/ai-bridge-worker.mjs on the
// laptop claims it, runs it through headless Claude Code and writes the answer back.
//
// SWITCHED ON ONLY BY AI_BRIDGE=queue in the environment (llm-client.ts's dispatchLLM). Unset, nothing here runs and no provider call
// changes. It is a pre-go-live stand-in; the long-term design is the user's OWN external AI through the AI work link
// (WORK_ORDER_PROJEXA-LOCAL-FIRST_2026-10-01), at which point the in-app AI is switched off and this file is deleted.
//
// COST SHAPE (Vercel time is the thing being minimised). If no worker has been seen in the last 45 s the enqueue function answers
// worker_online=false and this throws AT ONCE -- an offline laptop costs one cheap query, never a long wait. When a worker is online the
// wait is capped (BRIDGE_MAX_WAIT_MS) and polled gently (BRIDGE_POLL_MS) so it cannot hold a connection pool or a function open.
//
// ERRORS carry a 4xx status deliberately: llm-client.ts's withRetry only retries 429/5xx and network errors, and a bridge that is offline
// or timed out must NOT be retried three times (a 45 s wait repeated would be the opposite of cheap).
import { sql } from "drizzle-orm"
import { LLMHttpError, type CallLLMOptions, type LLMUsage } from "@/lib/llm-client"

export const BRIDGE_MAX_WAIT_MS = 45_000
/** platform.ai_bridge_request expires an unanswered request after 2 minutes (ai_bridge_purge, drizzle/0670): never wait longer than that. */
export const BRIDGE_MAX_WAIT_CEILING_MS = 110_000

/**
 * How long the app waits for the laptop's answer. 45 s by default (the Vercel cost shape above). Audit 100 A4/A14 (2026-10-05): headless
 * Claude Code on the 8 GB owner laptop was measured answering a Level 1 classification in 16-60 s, so with a fixed 45 s the app often gave
 * up and turned a real answer into "Level 1 unavailable" while the worker was still writing it. AI_BRIDGE_MAX_WAIT_MS raises it for a
 * laptop-served app (not a Vercel function); a value that is not a whole number of ms from 5 s up to the 110 s ceiling is ignored.
 */
export function bridgeMaxWaitMs(): number {
  const raw = process.env.AI_BRIDGE_MAX_WAIT_MS
  if (!raw || !/^\d+$/.test(raw.trim())) return BRIDGE_MAX_WAIT_MS
  const n = Number(raw.trim())
  return n >= 5_000 && n <= BRIDGE_MAX_WAIT_CEILING_MS ? n : BRIDGE_MAX_WAIT_MS
}
export const BRIDGE_POLL_MS = 1_500

export type BridgeAnswer = { status: string; response?: { content?: unknown } | null; error?: string | null }

export type BridgeDeps = {
  enqueue: (input: { purpose: string; model: string; system: string; user: string; options: Record<string, unknown> }) => Promise<{ worker_online: boolean; id?: string }>
  get: (id: string) => Promise<BridgeAnswer>
  sleep: (ms: number) => Promise<void>
  now: () => number
}

/** True only when the operator has switched the test bridge on. Read per call so a redeploy is not needed to turn it on or off. */
export function isBridgeEnabled(): boolean {
  return process.env.AI_BRIDGE === "queue"
}

/** Roughly 4 characters a token. The bridge has no billing; this only keeps the usage fields the callers read from being undefined. */
function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4)
}

function flattenUserText(userMessage: string, options?: CallLLMOptions): string {
  const history = (options?.history ?? []).map((t) => `${t.role === "assistant" ? "Assistant" : "User"}: ${t.content}`)
  const parts = history.length > 0 ? [`Conversation so far:\n${history.join("\n")}`, `Now answer this:\n${userMessage}`] : [userMessage]
  if (options?.jsonMode) parts.push("Reply with ONE valid JSON object and nothing else: no prose, no code fences.")
  return parts.join("\n\n")
}

export async function callViaBridge(
  args: { purpose?: string; model: string; systemPrompt: string; userMessage: string; options?: CallLLMOptions },
  deps: BridgeDeps = defaultDeps()
): Promise<{ content: string; usage: LLMUsage }> {
  const user = flattenUserText(args.userMessage, args.options)
  const queued = await deps.enqueue({
    purpose: args.purpose ?? "in-app-ai",
    model: args.model,
    system: args.systemPrompt,
    user,
    options: { jsonMode: args.options?.jsonMode === true, maxTokens: args.options?.maxTokens ?? null },
  })
  if (!queued.worker_online || !queued.id) {
    throw new LLMHttpError("The test AI is offline: the owner's laptop worker is not running. Start it, or switch AI_BRIDGE off.", 424)
  }

  const deadline = deps.now() + bridgeMaxWaitMs()
  for (;;) {
    await deps.sleep(BRIDGE_POLL_MS)
    const answer = await deps.get(queued.id)
    if (answer.status === "done") {
      const content = answer.response?.content
      if (typeof content !== "string" || content.length === 0) throw new LLMHttpError("The test AI answered with nothing.", 422)
      return { content, usage: { promptTokens: estimateTokens(args.systemPrompt + user), completionTokens: estimateTokens(content) } }
    }
    if (answer.status === "error") throw new LLMHttpError(`The test AI failed: ${answer.error ?? "unknown error"}`, 422)
    if (answer.status === "expired" || answer.status === "missing") throw new LLMHttpError("The test AI request expired before it was answered.", 408)
    if (deps.now() >= deadline) throw new LLMHttpError("The test AI did not answer in time.", 408)
  }
}

type DbLike = { execute: (query: ReturnType<typeof sql>) => Promise<unknown> }

function firstRowValue(result: unknown): unknown {
  const rows = Array.isArray(result) ? result : ((result as { rows?: unknown[] } | null)?.rows ?? [])
  const row = rows[0] as Record<string, unknown> | undefined
  return row ? row.r : undefined
}

function defaultDeps(): BridgeDeps {
  // Imported lazily so a build or a test that never uses the bridge does not open the pool.
  const getDb = async (): Promise<DbLike> => (await import("@/lib/db")).db as unknown as DbLike
  return {
    enqueue: async (input) => {
      const db = await getDb()
      const value = firstRowValue(
        await db.execute(
          sql`select public.ai_bridge_enqueue(${input.purpose}, ${input.model}, ${input.system}, ${input.user}, ${JSON.stringify(input.options)}::jsonb) as r`
        )
      )
      return (value ?? { worker_online: false }) as { worker_online: boolean; id?: string }
    },
    get: async (id) => {
      const db = await getDb()
      const value = firstRowValue(await db.execute(sql`select public.ai_bridge_get(${id}::uuid) as r`))
      return (value ?? { status: "missing" }) as BridgeAnswer
    },
    sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
    now: () => Date.now(),
  }
}
