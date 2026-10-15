/// <reference types="bun-types" />
// Audit 100, checklist row B46 (/openapi.json valid AND importable) and B47: the documents the DEPLOYED function serves are fed to REAL OpenAPI importers,
// not only to a schema validator:
//   @apidevtools/swagger-parser   validate() = parse, validate against the official schema AND the spec rules a schema cannot express (unique operationIds,
//                                 path parameters declared, resolvable $refs); this is the library behind many importers (Postman, Stoplight, Swagger UI tooling)
//   swagger2openapi               the converter that turns a Swagger 2.0 document into OpenAPI 3 (what an importer that only speaks 3.x does with /swagger.json)
// A control proves the importer is not a rubber stamp: the same document with ONE deliberate break (a dangling $ref, a missing info.version, an
// operation with no responses) is REJECTED by the same importer.
//
// The importers are installed once into <tmp>/awl-importer (bun add), not into the repository: they are verification tools, not product code, and CI never
// runs this file (bunfig root is src; it lives under scripts/verify on purpose). Network needed once for the install.
// Run: bun test --isolate ./scripts/verify/awl-live/openapi-import.live.test.ts
import { describe, test, expect, beforeAll, afterAll, setDefaultTimeout } from "bun:test"
import { spawnSync } from "node:child_process"
import { existsSync, mkdirSync, writeFileSync } from "node:fs"
import { createRequire } from "node:module"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { AWL_BASE, PEOPLE, call, expectPerson, jsonHeaders, liveEnabled, mintThrowaway, revoke, type Throwaway } from "./live-lib"

setDefaultTimeout(180_000)

const DIR = process.env.AWL_IMPORTER_DIR || join(tmpdir(), "awl-importer")
function importer<T = any>(name: string): T {
  if (!existsSync(join(DIR, "node_modules", name))) {
    mkdirSync(DIR, { recursive: true })
    if (!existsSync(join(DIR, "package.json"))) writeFileSync(join(DIR, "package.json"), '{"name":"awl-importer","private":true}')
    const r = spawnSync("bun", ["add", "@apidevtools/swagger-parser@10", "swagger2openapi@7"], { cwd: DIR, encoding: "utf8", timeout: 150_000 })
    if (r.status !== 0) throw new Error(`could not install the importers: ${(r.stderr || "").slice(0, 300)}`)
  }
  return createRequire(join(DIR, "package.json"))(name) as T
}

const clone = <T>(x: T): T => JSON.parse(JSON.stringify(x))

describe.skipIf(!liveEnabled())("deployed API documents are importable by real OpenAPI tools (live)", () => {
  let link: Throwaway
  let oas: any
  let swagger: any
  let headerOas: any
  let SwaggerParser: any
  let swagger2openapi: any

  beforeAll(async () => {
    SwaggerParser = importer("@apidevtools/swagger-parser")
    swagger2openapi = importer("swagger2openapi")
    await expectPerson(PEOPLE.reader, "team_member")
    link = await mintThrowaway(PEOPLE.reader, "audit100 openapi-import")
    oas = (await call(`${link.url}/openapi.json`)).json
    swagger = (await call(`${link.url}/swagger.json`)).json
    headerOas = (await call(`${AWL_BASE}/header/openapi.json`, { headers: { ...jsonHeaders, "link-token": link.token } })).json
  }, 400_000)

  afterAll(async () => {
    if (link) await revoke(link.id)
  })

  test("the three documents were fetched (control: the importer has something to import)", () => {
    expect(oas?.openapi).toBe("3.0.3")
    expect(swagger?.swagger).toBe("2.0")
    expect(headerOas?.openapi).toBe("3.0.3")
    expect(Object.keys(oas.paths).length).toBeGreaterThan(5)
  })

  test("swagger-parser validates /openapi.json (path mode), /swagger.json and the header-mode /openapi.json, and resolves every $ref", async () => {
    for (const [name, doc] of [["openapi.json", oas], ["swagger.json", swagger], ["header/openapi.json", headerOas]] as const) {
      const api = await SwaggerParser.validate(clone(doc))
      expect(Object.keys(api.paths).length, name).toBeGreaterThan(5)
      const deref = await SwaggerParser.dereference(clone(doc))
      expect(JSON.stringify(deref).includes('"$ref"'), `${name} still has a $ref after dereference`).toBe(false)
    }
  })

  test("every operation has a unique operationId and a response, so a generated client gets one method per operation", async () => {
    const api = await SwaggerParser.dereference(clone(oas))
    const ids: string[] = []
    for (const [path, item] of Object.entries<any>(api.paths)) {
      for (const [verb, op] of Object.entries<any>(item)) {
        if (!["get", "post", "put", "patch", "delete"].includes(verb)) continue
        expect(op.operationId, `${verb} ${path}`).toBeTruthy()
        expect(Object.keys(op.responses ?? {}).length, `${verb} ${path} responses`).toBeGreaterThan(0)
        ids.push(op.operationId)
      }
    }
    expect(ids.length).toBeGreaterThan(5)
    expect(new Set(ids).size).toBe(ids.length)
  })

  test("swagger2openapi converts /swagger.json to OpenAPI 3 with the same set of paths, and the result validates", async () => {
    const converted = await swagger2openapi.convertObj(clone(swagger), { patch: false, warnOnly: false, resolve: false })
    const out = converted.openapi
    expect(String(out.openapi).startsWith("3.")).toBe(true)
    expect(Object.keys(out.paths).sort()).toEqual(Object.keys(swagger.paths).sort())
    await SwaggerParser.validate(clone(out))
  })

  test("the swagger server address (host + basePath) is the link, and the first GET operation answers 200 through it", async () => {
    const base = `${(swagger.schemes ?? ["https"])[0]}://${swagger.host}${swagger.basePath ?? ""}`
    expect(base).toBe(link.url)
    const firstGet = Object.entries<any>(swagger.paths).find(([p, item]) => item.get && !p.includes("{"))
    expect(firstGet).toBeTruthy()
    expect((await call(`${base}${firstGet![0]}`, { headers: jsonHeaders })).status).toBe(200)
  })

  // ------------------------------------------------------------------------------- CONTROLS: the importer must refuse a broken document
  test("CONTROL: the same importer REJECTS the document after one deliberate break (dangling $ref / missing info.version / an operation with no responses)", async () => {
    const dangling = clone(oas)
    const firstOp = Object.values<any>(dangling.paths).find((i) => i.get)!.get
    firstOp.responses = { "200": { description: "x", content: { "application/json": { schema: { $ref: "#/components/schemas/DoesNotExist" } } } } }
    await expect(SwaggerParser.validate(dangling)).rejects.toThrow()

    const noVersion = clone(oas)
    delete noVersion.info.version
    await expect(SwaggerParser.validate(noVersion)).rejects.toThrow()

    const noResponses = clone(oas)
    delete Object.values<any>(noResponses.paths).find((i) => i.get).get.responses
    await expect(SwaggerParser.validate(noResponses)).rejects.toThrow()
  })
})
