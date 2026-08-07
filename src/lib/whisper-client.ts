// Priority 14 Wave 2 (GAP-MOM-VOICE-TICKETS). Owner decision 2026-07-14:
// OpenAI Whisper API for voice transcription (AskUserQuestion) -- this is
// the one and only call site in this codebase that talks to OpenAI's audio
// endpoint directly. Deliberately NOT routed through llm-client.ts's
// callLLM/callLLMJson -- those only model text chat-completion providers
// (see their own LLMProvider union), there is no audio-input shape there to
// extend, and Whisper's multipart/form-data request is structurally
// unrelated to a JSON chat-completions call.
//
// Honest, explicit external dependency: OPENAI_API_KEY is not configured
// anywhere in this codebase's secrets as of this wave (GROQ_API_KEY /
// OPENROUTER_API_KEY / CEREBRAS_API_KEY are the only LLM provider keys
// actually set -- see .env.local / Vercel env). whisperApiKey() fails loud
// (throws, never silently no-ops) the moment this module is actually
// invoked without the key configured, matching this codebase's own
// established fail-loud convention for required env vars (see
// ai-config-crypto.ts's getEncryptionKey(), composio-connectors.ts's
// apiKey(), tenant-scoped.ts's getAppRuntimeConnectionString()) -- there is
// no shared requireEnv() helper anywhere in this codebase to extend, so
// this follows the same ad-hoc-per-call-site shape those examples use.
// Cognitive AI Operating System Consistency gap closure (2026-08-07):
// retry now matches every real callLLM call site (withRetry() is the exact
// same transient-failure classification + backoff policy, reused directly
// rather than re-implemented here where it could silently drift).
// Cost-tracking is deliberately NOT logged inside this file: this module's
// own header comment above establishes it as the one fully DB-free,
// fetch-mockable module in the Voice Tickets feature (see
// whisper-client.test.ts), and Whisper is billed per-minute-of-audio, not
// per-token, so it can't reuse llm-client.ts's MODEL_PRICING/
// estimateCostUsd shape anyway. estimateWhisperCostUsd() below is the pure,
// still-fully-testable half of that parity; voice-ticket-service.ts (which
// already owns the DB/orgId context) calls it and writes to the same
// token_usage_ledger every product Orchestra Layer call feeds.
import { withRetry, LLMHttpError } from "@/lib/llm-client"

export class WhisperConfigError extends Error {
  constructor(message: string) {
    super(message)
    this.name = "WhisperConfigError"
  }
}

export function whisperApiKey(): string {
  const key = process.env.OPENAI_API_KEY
  if (!key) {
    throw new WhisperConfigError(
      "OPENAI_API_KEY is not configured -- Voice Tickets transcription cannot run. " +
      "The Owner decided on OpenAI Whisper for this feature (2026-07-14) but the real API key " +
      "has not yet been provisioned. Add OPENAI_API_KEY to Vercel and GitHub Secrets to enable " +
      "live transcription; until then, every voice memo upload will fail loudly at the transcription " +
      "step (never silently skipped)."
    )
  }
  return key
}

const WHISPER_ENDPOINT = "https://api.openai.com/v1/audio/transcriptions"
const WHISPER_MODEL = "whisper-1"

// 25 MB is OpenAI's own hard limit for this endpoint -- checked here too so
// a too-large upload fails with a clear message instead of a raw 413 from
// OpenAI's API.
export const WHISPER_MAX_BYTES = 25 * 1024 * 1024

// OpenAI's own published rate for this endpoint: $0.006 per minute of
// audio, billed to the nearest second (stable since Whisper API launch --
// same class of long-stable public pricing constant as llm-client.ts's
// "gpt-4o"/"gpt-4o-mini" rows). Pure and side-effect-free so it stays
// testable without a mocked fetch, unlike the transcription call itself.
const WHISPER_COST_PER_MINUTE_USD = 0.006

/**
 * Estimated cost for one transcription call, given the audio's duration.
 * Returns null when duration is unknown -- voiceMemos.durationSeconds is
 * client-supplied and optional (see voice-ticket-service.ts's
 * createVoiceMemo), so "unknown" is a real, expected case here, not an
 * error -- same "absence means not attempted, don't guess" contract as
 * llm-client.ts's estimateCostUsd()/LLMUsage.cacheReadTokens.
 */
export function estimateWhisperCostUsd(durationSeconds: number | null | undefined): number | null {
  if (durationSeconds === null || durationSeconds === undefined || durationSeconds < 0) return null
  return (durationSeconds / 60) * WHISPER_COST_PER_MINUTE_USD
}

export type TranscriptionResult = { text: string }

// Pure HTTP call, no DB -- the only I/O is the OpenAI request itself, so
// this is fully exercisable in a test with a mocked global.fetch (see
// whisper-client.test.ts), matching this codebase's own established test
// convention (llm-client.test.ts / composio-connectors.test.ts both mock
// globalThis.fetch one layer below the real call, not the function itself).
export async function transcribeAudio(
  bytes: Uint8Array,
  filename: string,
  mimeType: string
): Promise<TranscriptionResult> {
  if (bytes.byteLength === 0) {
    throw new Error("Cannot transcribe an empty audio file")
  }
  if (bytes.byteLength > WHISPER_MAX_BYTES) {
    throw new Error(`Audio file exceeds OpenAI Whisper's 25 MB limit (got ${(bytes.byteLength / (1024 * 1024)).toFixed(1)} MB)`)
  }

  const apiKey = whisperApiKey()

  const form = new FormData()
  const arrayBuffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer
  form.append("file", new Blob([arrayBuffer], { type: mimeType || "audio/webm" }), filename || "voice-memo.webm")
  form.append("model", WHISPER_MODEL)
  form.append("response_format", "json")

  const data = await withRetry(async () => {
    const res = await fetch(WHISPER_ENDPOINT, {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}` },
      body: form,
    })

    if (!res.ok) {
      let detail = ""
      try {
        const errBody = await res.json() as { error?: { message?: string } }
        detail = errBody?.error?.message || ""
      } catch {
        detail = await res.text().catch(() => "")
      }
      // LLMHttpError (not a plain Error) so withRetry's isRetryable() can
      // tell a transient 429/5xx from a permanent 4xx (bad key, bad
      // request) the exact same way it does for every callLLM call site --
      // a 401 (bad key) still fails on the first try, never retried.
      throw new LLMHttpError(`OpenAI Whisper transcription failed (HTTP ${res.status}): ${detail || "no further detail from OpenAI"}`, res.status)
    }

    return res.json() as Promise<{ text?: string }>
  })

  if (typeof data.text !== "string") {
    throw new Error("OpenAI Whisper returned a response with no text field -- cannot use as a transcript")
  }
  return { text: data.text }
}
