/// <reference types="bun-types" />
// Priority 14 Wave 2 (GAP-MOM-VOICE-TICKETS). Proves the OpenAI Whisper
// integration point is correct WITHOUT a real OPENAI_API_KEY -- mocks
// globalThis.fetch, same pattern as llm-client.test.ts / composio-
// connectors.test.ts, restoring both fetch and the env var after every test
// so no other test file is affected. This is the one directly-DB-free,
// fully-mockable module in the Voice Tickets feature (see voice-ticket-
// service.ts's own header comment for why the DB-touching orchestration
// isn't unit-tested the same way -- no DATABASE_URL-free test convention
// exists anywhere in this codebase to extend).
import { describe, expect, test, afterEach, beforeEach } from "bun:test"
import { transcribeAudio, whisperApiKey, WhisperConfigError, WHISPER_MAX_BYTES } from "./whisper-client"

const realFetch = globalThis.fetch
const realApiKey = process.env.OPENAI_API_KEY

afterEach(() => {
  globalThis.fetch = realFetch
  if (realApiKey === undefined) delete process.env.OPENAI_API_KEY
  else process.env.OPENAI_API_KEY = realApiKey
})

describe("whisperApiKey", () => {
  test("throws a WhisperConfigError (fail loud, never silently no-ops) when OPENAI_API_KEY is unset", () => {
    delete process.env.OPENAI_API_KEY
    expect(() => whisperApiKey()).toThrow(WhisperConfigError)
    expect(() => whisperApiKey()).toThrow(/OPENAI_API_KEY is not configured/)
  })

  test("returns the key when configured", () => {
    process.env.OPENAI_API_KEY = "sk-test-key-123"
    expect(whisperApiKey()).toBe("sk-test-key-123")
  })
})

describe("transcribeAudio", () => {
  beforeEach(() => {
    process.env.OPENAI_API_KEY = "sk-test-key-123"
  })

  test("throws before ever calling fetch when OPENAI_API_KEY is unset", async () => {
    delete process.env.OPENAI_API_KEY
    let fetchCalled = false
    globalThis.fetch = (async () => { fetchCalled = true; return {} as Response }) as typeof fetch

    await expect(transcribeAudio(new Uint8Array([1, 2, 3]), "memo.webm", "audio/webm")).rejects.toThrow(WhisperConfigError)
    expect(fetchCalled).toBe(false)
  })

  test("rejects an empty audio buffer without calling fetch", async () => {
    let fetchCalled = false
    globalThis.fetch = (async () => { fetchCalled = true; return {} as Response }) as typeof fetch

    await expect(transcribeAudio(new Uint8Array([]), "memo.webm", "audio/webm")).rejects.toThrow(/empty/)
    expect(fetchCalled).toBe(false)
  })

  test("rejects an oversized buffer without calling fetch", async () => {
    let fetchCalled = false
    globalThis.fetch = (async () => { fetchCalled = true; return {} as Response }) as typeof fetch
    const tooBig = new Uint8Array(WHISPER_MAX_BYTES + 1)

    await expect(transcribeAudio(tooBig, "memo.webm", "audio/webm")).rejects.toThrow(/25 MB/)
    expect(fetchCalled).toBe(false)
  })

  test("posts multipart form data with the Bearer key to OpenAI's transcription endpoint and returns the parsed transcript", async () => {
    let capturedUrl: string | undefined
    let capturedHeaders: Record<string, string> | undefined
    let capturedBody: FormData | undefined
    globalThis.fetch = (async (url: string, init?: RequestInit) => {
      capturedUrl = url
      capturedHeaders = init?.headers as Record<string, string>
      capturedBody = init?.body as FormData
      return {
        ok: true,
        json: async () => ({ text: "This is the mocked transcript of a quick voice memo." }),
      } as Response
    }) as typeof fetch

    const result = await transcribeAudio(new Uint8Array([1, 2, 3, 4]), "memo.webm", "audio/webm")

    expect(capturedUrl).toBe("https://api.openai.com/v1/audio/transcriptions")
    expect(capturedHeaders?.Authorization).toBe("Bearer sk-test-key-123")
    expect(capturedBody).toBeInstanceOf(FormData)
    expect(capturedBody!.get("model")).toBe("whisper-1")
    expect(result.text).toBe("This is the mocked transcript of a quick voice memo.")
  })

  test("surfaces OpenAI's own error message on a non-ok response", async () => {
    globalThis.fetch = (async () => ({
      ok: false,
      status: 401,
      json: async () => ({ error: { message: "Incorrect API key provided." } }),
    })) as typeof fetch

    await expect(transcribeAudio(new Uint8Array([1, 2, 3]), "memo.webm", "audio/webm")).rejects.toThrow(/Incorrect API key provided/)
  })

  test("throws when OpenAI returns a response with no text field", async () => {
    globalThis.fetch = (async () => ({
      ok: true,
      json: async () => ({ unexpected: "shape" }),
    })) as typeof fetch

    await expect(transcribeAudio(new Uint8Array([1, 2, 3]), "memo.webm", "audio/webm")).rejects.toThrow(/no text field/)
  })
})
