/// <reference types="bun-types" />
import { describe, expect, test } from "bun:test"
import { requireSupabaseAdminEnv, SupabaseAdminConfigError, getSupabaseAdmin } from "./admin-client"

// Only the pure/DB-free validation helper and the singleton-caching
// behavior of getSupabaseAdmin() are unit-tested here, matching this
// codebase's existing convention (see passcode-login-service.test.ts).
// requireSupabaseAdminEnv is exported specifically to make the validation
// logic testable in isolation, independent of the real process.env this
// test process happens to be running under (CI's unit-tests job sets
// neither NEXT_PUBLIC_SUPABASE_URL nor SUPABASE_SERVICE_ROLE_KEY).

describe("requireSupabaseAdminEnv", () => {
  test("returns both values when present", () => {
    const result = requireSupabaseAdminEnv({
      NEXT_PUBLIC_SUPABASE_URL: "https://project.supabase.co",
      SUPABASE_SERVICE_ROLE_KEY: "service-role-key",
    })
    expect(result).toEqual({
      supabaseUrl: "https://project.supabase.co",
      supabaseServiceRoleKey: "service-role-key",
    })
  })

  test("throws a named SupabaseAdminConfigError naming NEXT_PUBLIC_SUPABASE_URL when it's missing", () => {
    expect(() =>
      requireSupabaseAdminEnv({ NEXT_PUBLIC_SUPABASE_URL: undefined, SUPABASE_SERVICE_ROLE_KEY: "service-role-key" })
    ).toThrow(SupabaseAdminConfigError)
    expect(() =>
      requireSupabaseAdminEnv({ NEXT_PUBLIC_SUPABASE_URL: undefined, SUPABASE_SERVICE_ROLE_KEY: "service-role-key" })
    ).toThrow(/NEXT_PUBLIC_SUPABASE_URL/)
  })

  test("throws a named SupabaseAdminConfigError naming SUPABASE_SERVICE_ROLE_KEY when it's missing", () => {
    expect(() =>
      requireSupabaseAdminEnv({ NEXT_PUBLIC_SUPABASE_URL: "https://project.supabase.co", SUPABASE_SERVICE_ROLE_KEY: undefined })
    ).toThrow(SupabaseAdminConfigError)
    expect(() =>
      requireSupabaseAdminEnv({ NEXT_PUBLIC_SUPABASE_URL: "https://project.supabase.co", SUPABASE_SERVICE_ROLE_KEY: undefined })
    ).toThrow(/SUPABASE_SERVICE_ROLE_KEY/)
  })

  test("throws for an empty-string value, not just undefined", () => {
    expect(() =>
      requireSupabaseAdminEnv({ NEXT_PUBLIC_SUPABASE_URL: "", SUPABASE_SERVICE_ROLE_KEY: "service-role-key" })
    ).toThrow(SupabaseAdminConfigError)
  })
})

describe("getSupabaseAdmin", () => {
  test("returns the same client instance on repeated calls (singleton)", () => {
    // getSupabaseAdmin() only validates lazily, on first call -- set both
    // vars here rather than relying on the test process's real env (which
    // CI's unit-tests job deliberately leaves unset for these two vars).
    const originalUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
    const originalKey = process.env.SUPABASE_SERVICE_ROLE_KEY
    process.env.NEXT_PUBLIC_SUPABASE_URL = "https://project.supabase.co"
    process.env.SUPABASE_SERVICE_ROLE_KEY = "service-role-key"
    try {
      expect(getSupabaseAdmin()).toBe(getSupabaseAdmin())
    } finally {
      process.env.NEXT_PUBLIC_SUPABASE_URL = originalUrl
      process.env.SUPABASE_SERVICE_ROLE_KEY = originalKey
    }
  })
})
