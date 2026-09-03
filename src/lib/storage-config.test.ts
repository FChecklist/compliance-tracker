/// <reference types="bun-types" />
import { describe, expect, test, afterEach } from "bun:test"
import {
  UPLOAD_BUCKET,
  getStorageStatus,
  probeUploadBucket,
  resetStorageStatusCache,
  storageEnvResolves,
} from "./storage-config"

// R67 D-78. The point of this module is that it says "no" for the two reasons an
// upload really fails, and that it never throws while doing so.

const ORIGINAL_URL = process.env.NEXT_PUBLIC_SUPABASE_URL
const ORIGINAL_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY

function restoreEnv() {
  if (ORIGINAL_URL === undefined) delete process.env.NEXT_PUBLIC_SUPABASE_URL
  else process.env.NEXT_PUBLIC_SUPABASE_URL = ORIGINAL_URL
  if (ORIGINAL_KEY === undefined) delete process.env.SUPABASE_SERVICE_ROLE_KEY
  else process.env.SUPABASE_SERVICE_ROLE_KEY = ORIGINAL_KEY
  resetStorageStatusCache()
}

afterEach(restoreEnv)

describe("storageEnvResolves", () => {
  test("both values present", () => {
    expect(storageEnvResolves({ url: "https://x.supabase.co", serviceRoleKey: "sk" })).toBe(true)
  })

  test("a missing service-role key is a no", () => {
    expect(storageEnvResolves({ url: "https://x.supabase.co" })).toBe(false)
  })

  test("an EMPTY service-role key is a no -- an unset Vercel var arrives as an empty string", () => {
    expect(storageEnvResolves({ url: "https://x.supabase.co", serviceRoleKey: "" })).toBe(false)
    expect(storageEnvResolves({ url: "https://x.supabase.co", serviceRoleKey: "   " })).toBe(false)
  })

  test("a missing project URL is a no", () => {
    expect(storageEnvResolves({ serviceRoleKey: "sk" })).toBe(false)
  })
})

describe("getStorageStatus", () => {
  test("with SUPABASE_SERVICE_ROLE_KEY unset it reports false, and names the reason for the operator", async () => {
    process.env.NEXT_PUBLIC_SUPABASE_URL = "https://example.supabase.co"
    delete process.env.SUPABASE_SERVICE_ROLE_KEY
    resetStorageStatusCache()
    const status = await getStorageStatus()
    expect(status.storageConfigured).toBe(false)
    expect(status.reason).toBe("missing_env")
    expect(status.bucket).toBe(UPLOAD_BUCKET)
  })

  test("the answer is cached, so opening three upload screens does not make three probes", async () => {
    process.env.NEXT_PUBLIC_SUPABASE_URL = "https://example.supabase.co"
    delete process.env.SUPABASE_SERVICE_ROLE_KEY
    resetStorageStatusCache()
    const first = await getStorageStatus()
    // Env changed underneath; the cached answer must still be returned.
    process.env.SUPABASE_SERVICE_ROLE_KEY = "sk-now-present"
    const second = await getStorageStatus()
    expect(second).toBe(first)
    // ...until the cache is dropped.
    resetStorageStatusCache()
    expect(await getStorageStatus()).not.toBe(first)
  })
})

describe("probeUploadBucket", () => {
  test("an unreachable Supabase project is `false`, never a throw", async () => {
    // 127.0.0.1:1 is closed on every machine this can run on, so the client's
    // own fetch rejects -- the exact shape of "storage is not usable here".
    expect(await probeUploadBucket("http://127.0.0.1:1", "sk-not-real", UPLOAD_BUCKET)).toBe(false)
  })
})
