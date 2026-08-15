/// <reference types="bun-types" />
// Real automated test for check-api-route-conventions.mjs (VERIDIAN Review
// Framework gap-closure, Design Pattern Consistency, 2026-08-15) -- proves
// the pure checkFileText() function genuinely catches a new route missing
// requireAuth()/requireAuthOrApiKey(), a new service throwing a bare Error
// without ServiceError, and genuinely allows the compliant/exempt shapes
// real routes and services in this repo already use.
import { describe, test, expect } from "bun:test"
import { isApiRouteFile, isServiceFile, checkFileText } from "./check-api-route-conventions.mjs"

describe("isApiRouteFile / isServiceFile", () => {
  test("route.ts under src/app/api/ is a route file", () => {
    expect(isApiRouteFile("src/app/api/compliance/route.ts")).toBe(true)
    expect(isApiRouteFile("src/app/api/compliance/[id]/route.ts")).toBe(true)
  })
  test("route.test.ts is not a route file (test fixture, not the real route)", () => {
    expect(isApiRouteFile("src/app/api/compliance/route.test.ts")).toBe(false)
  })
  test("a file outside src/app/api/ is not a route file", () => {
    expect(isApiRouteFile("src/lib/services/compliance-service.ts")).toBe(false)
  })
  test("*.ts under src/lib/services/ is a service file, its own .test.ts is not", () => {
    expect(isServiceFile("src/lib/services/compliance-service.ts")).toBe(true)
    expect(isServiceFile("src/lib/services/compliance-service.test.ts")).toBe(false)
  })
})

describe("checkFileText -- new API routes", () => {
  test("BLOCKS a new route with no requireAuth()-family call", () => {
    const text = `
import { NextResponse } from "next/server"
export async function GET() {
  return NextResponse.json({ ok: true })
}
`
    const v = checkFileText("src/app/api/widgets/route.ts", text)
    expect(v).not.toBeNull()
    expect(v.rule).toContain("requireAuth")
  })

  test("ALLOWS a new route calling requireAuth()", () => {
    const text = `
import { requireAuth } from "@/lib/supabase/auth-guard"
export async function GET() {
  const { orgId } = await requireAuth()
  return Response.json({ orgId })
}
`
    expect(checkFileText("src/app/api/widgets/route.ts", text)).toBeNull()
  })

  test("ALLOWS a new route calling requireAuthOrApiKey() (the documented public-API-key path)", () => {
    const text = `
import { requireAuthOrApiKey } from "@/lib/supabase/auth-guard"
export async function GET(request: Request) {
  const ctx = await requireAuthOrApiKey(request)
  return Response.json(ctx)
}
`
    expect(checkFileText("src/app/api/widgets/route.ts", text)).toBeNull()
  })
})

describe("checkFileText -- new services", () => {
  test("BLOCKS a new service throwing a bare Error with no ServiceError reference", () => {
    const text = `
export function doThing(x: number) {
  if (x < 0) throw new Error("x must be non-negative")
  return x * 2
}
`
    const v = checkFileText("src/lib/services/widget-service.ts", text)
    expect(v).not.toBeNull()
    expect(v.rule).toBe("ServiceError")
  })

  test("ALLOWS a new service that imports and throws ServiceError", () => {
    const text = `
import { ServiceError } from "./compliance-service"
export function doThing(x: number) {
  if (x < 0) throw new ServiceError("x must be non-negative", 400)
  return x * 2
}
`
    expect(checkFileText("src/lib/services/widget-service.ts", text)).toBeNull()
  })

  test("ALLOWS a new service with no throw at all (pure read/compute helper)", () => {
    const text = `
export function double(x: number) {
  return x * 2
}
`
    expect(checkFileText("src/lib/services/widget-service.ts", text)).toBeNull()
  })
})
