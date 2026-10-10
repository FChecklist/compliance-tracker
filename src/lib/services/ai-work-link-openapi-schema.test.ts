/// <reference types="bun-types" />
// Audit 100 (checklist rows B46 and B47): the documents the AI work link serves at /openapi.json and /swagger.json are VALID under the
// official schemas of the OpenAPI Initiative, not just "valid JSON with the keys our own tests expect".
//   - openapi-3.0.3-schema.json and swagger-2.0-schema.json in __fixtures__/openapi-schemas are copied byte for byte from
//     github.com/OAI/OpenAPI-Specification, tag 3.0.3, schemas/v3.0/schema.json and schemas/v2.0/schema.json (not edited).
//   - The validator is ajv 6 (JSON Schema draft-04, the dialect both official schemas are written in), set up in
//     __test-helpers__/openapi-validate.ts. ajv is not a direct dependency of this repo; it is the copy the lint tool brings in. The first
//     test fails loudly if that copy ever stops being version 6, so a hoisting change cannot turn this into a test that validates nothing.
//   - Beyond the schema, every $ref must resolve inside its own document, every operationId must be unique, and every path parameter used
//     in a path template must be declared (the three faults the schema alone does not catch).
// The documents come from the REAL builders (buildOpenApi, buildSwagger) in path mode and header mode, and from the REAL handler, which is
// the code that serves them.
// Falsifiability: see the "a deliberately broken document is rejected" tests, which feed the validator a document with a missing required
// key and a dangling $ref and expect rejection.
// Run: bun test --isolate src/lib/services/ai-work-link-openapi-schema.test.ts
import { describe, test, expect } from "bun:test"
import { handleAwl } from "../../../supabase/functions/ai-work-link/handler"
import { buildOpenApi, buildSwagger } from "../../../supabase/functions/ai-work-link/openapi"
import { F, TOKENS, makeFake, req, testConfig } from "./__test-helpers__/awl-edge-fake"
import { ajvVersion, validateOas3, validateSwagger2, errorsOf, danglingRefs, structuralProblems, type Doc } from "./__test-helpers__/openapi-validate"

const BASE = `${F}/${TOKENS.manager}`

describe("the validator is real", () => {
  test("ajv is the version-6 copy the draft-04 schemas need", () => {
    expect(ajvVersion.split(".")[0]).toBe("6")
  })

  test("a deliberately broken OpenAPI document is rejected (the validator can fail)", () => {
    const good = buildOpenApi({ base: BASE, mode: "path" }) as Record<string, unknown>
    expect(validateOas3(good)).toBe(true)
    const noInfo = { ...good }
    delete noInfo.info
    expect(validateOas3(noInfo)).toBe(false)
    expect(errorsOf(validateOas3).join(" ")).toContain("info")
    const wrongVersion = { ...good, openapi: "2.0" }
    expect(validateOas3(wrongVersion)).toBe(false)
  })

  test("a deliberately broken Swagger document is rejected", () => {
    const good = buildSwagger({ base: BASE, mode: "path" }) as Record<string, unknown>
    expect(validateSwagger2(good)).toBe(true)
    const noPaths = { ...good }
    delete noPaths.paths
    expect(validateSwagger2(noPaths)).toBe(false)
    expect(validateSwagger2({ ...good, swagger: "3.0" })).toBe(false)
  })

  test("a dangling $ref and an undeclared path parameter are caught by the extra checks", () => {
    expect(danglingRefs({ a: { $ref: "#/components/schemas/Nope" }, components: { schemas: {} } })).toEqual(["#/components/schemas/Nope"])
    const doc: Doc = { paths: { "/x/{id}": { get: { operationId: "a" } } } }
    expect(structuralProblems(doc).join(" ")).toContain("{id}")
    const dup: Doc = { paths: { "/a": { get: { operationId: "same" }, post: { operationId: "same" } } } }
    expect(structuralProblems(dup).join(" ")).toContain("operationId same")
  })
})

describe("OpenAPI 3.0.3 document of the AI work link", () => {
  for (const mode of ["path", "header"] as const) {
    test(`${mode} mode: valid under the official 3.0 schema, every $ref resolves, ids unique`, () => {
      const doc = buildOpenApi({ base: mode === "path" ? BASE : `${F}/header`, mode })
      expect(validateOas3(doc)).toBe(true)
      expect(errorsOf(validateOas3)).toEqual([])
      expect(danglingRefs(doc)).toEqual([])
      expect(structuralProblems(doc as unknown as Doc)).toEqual([])
    })
  }
})

describe("Swagger 2.0 document of the AI work link", () => {
  for (const mode of ["path", "header"] as const) {
    test(`${mode} mode: valid under the official 2.0 schema, every $ref resolves, ids unique`, () => {
      const doc = buildSwagger({ base: mode === "path" ? BASE : `${F}/header`, mode })
      expect(validateSwagger2(doc)).toBe(true)
      expect(errorsOf(validateSwagger2)).toEqual([])
      expect(danglingRefs(doc)).toEqual([])
      expect(structuralProblems(doc as unknown as Doc)).toEqual([])
    })
  }
})

describe("what the handler actually serves", () => {
  const fake = makeFake({ writesEnabled: true })
  const serve = async (path: string) => {
    const r = await handleAwl(req(`/${TOKENS.manager}${path}`), { rpc: fake.rpc, config: testConfig() })
    return { status: r.status, doc: JSON.parse(await r.text()) }
  }

  test("GET /openapi.json is valid OpenAPI 3.0.3", async () => {
    const { status, doc } = await serve("/openapi.json")
    expect(status).toBe(200)
    expect(validateOas3(doc)).toBe(true)
    expect(danglingRefs(doc)).toEqual([])
  })

  test("GET /swagger.json is valid Swagger 2.0", async () => {
    const { status, doc } = await serve("/swagger.json")
    expect(status).toBe(200)
    expect(doc.swagger).toBe("2.0")
    expect(validateSwagger2(doc)).toBe(true)
    expect(danglingRefs(doc)).toEqual([])
  })
})
