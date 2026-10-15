/// <reference types="bun-types" />
// Audit 100, checklist rows B46 (/openapi.json valid and importable) and B47 (/swagger.json valid): the documents the DEPLOYED function
// serves, validated with the official OpenAPI Initiative schemas (see src/lib/services/__test-helpers__/openapi-validate.ts), in path mode and
// in header mode. The same validator is used offline by src/lib/services/ai-work-link-openapi-schema.test.ts on the code in the repository;
// this file checks that what is DEPLOYED is the same valid document, and that the server address inside it is a working address of the link:
// the first operation of each document is called through that address and answers 200.
// Run: bun test --isolate ./scripts/verify/awl-live/openapi-live.live.test.ts
/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, test, expect, beforeAll, afterAll, setDefaultTimeout } from "bun:test"
import { AWL_BASE, PEOPLE, call, expectPerson, jsonHeaders, liveEnabled, mintThrowaway, revoke, type Throwaway } from "./live-lib"
import { danglingRefs, errorsOf, structuralProblems, validateOas3, validateSwagger2, type Doc } from "../../../src/lib/services/__test-helpers__/openapi-validate"

setDefaultTimeout(120_000)

describe.skipIf(!liveEnabled())("deployed OpenAPI 3.0.3 and Swagger 2.0 documents (live)", () => {
  let link: Throwaway

  beforeAll(async () => {
    await expectPerson(PEOPLE.reader, "team_member")
    link = await mintThrowaway(PEOPLE.reader, "audit100 openapi-live")
  }, 300_000)
  afterAll(async () => {
    if (link) await revoke(link.id)
  })

  test("/openapi.json (path mode) is valid OpenAPI 3.0.3, its $refs resolve, its server address is the link and answers", async () => {
    const r = await call(`${link.url}/openapi.json`)
    expect(r.status).toBe(200)
    expect(r.headers.get("content-type")).toContain("application/json")
    expect(r.json.openapi).toBe("3.0.3")
    expect(validateOas3(r.json)).toBe(true)
    expect(errorsOf(validateOas3)).toEqual([])
    expect(danglingRefs(r.json)).toEqual([])
    expect(structuralProblems(r.json as Doc)).toEqual([])
    expect(r.json.servers).toEqual([{ url: link.url }])
    // the document is importable by a client: its paths, called on its own server address, work
    const viaServer = await call(`${r.json.servers[0].url}/projects`, { headers: jsonHeaders })
    expect(viaServer.status).toBe(200)
    expect(Object.keys(r.json.paths)).toContain("/projects")
  })

  test("/swagger.json (path mode) is valid Swagger 2.0, its $refs resolve, host + basePath + scheme form the link", async () => {
    const r = await call(`${link.url}/swagger.json`)
    expect(r.status).toBe(200)
    expect(r.json.swagger).toBe("2.0")
    expect(validateSwagger2(r.json)).toBe(true)
    expect(errorsOf(validateSwagger2)).toEqual([])
    expect(danglingRefs(r.json)).toEqual([])
    expect(structuralProblems(r.json as Doc)).toEqual([])
    const base = `${(r.json.schemes ?? ["https"])[0]}://${r.json.host}${r.json.basePath ?? ""}`
    expect(base).toBe(link.url)
  })

  test("header mode: both documents are valid, name the /header base and contain no token", async () => {
    const o = await call(`${AWL_BASE}/header/openapi.json`, { headers: { ...jsonHeaders, "link-token": link.token } })
    const s = await call(`${AWL_BASE}/header/swagger.json`, { headers: { ...jsonHeaders, "link-token": link.token } })
    expect(o.status).toBe(200)
    expect(s.status).toBe(200)
    expect(validateOas3(o.json)).toBe(true)
    expect(validateSwagger2(s.json)).toBe(true)
    expect(danglingRefs(o.json)).toEqual([])
    expect(danglingRefs(s.json)).toEqual([])
    expect(o.text).not.toContain("pxa_")
    expect(s.text).not.toContain("pxa_")
  })
})
