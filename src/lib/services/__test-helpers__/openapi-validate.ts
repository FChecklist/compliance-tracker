// Audit 100 (checklist rows B46, B47): the official-schema validators for the OpenAPI 3.0.3 and Swagger 2.0 documents of the AI work link, shared
// by the offline test (src/lib/services/ai-work-link-openapi-schema.test.ts) and the live test (scripts/verify/awl-live/openapi-live.live.test.ts).
// The two schema files in ../__fixtures__/openapi-schemas are copied byte for byte from github.com/OAI/OpenAPI-Specification, tag 3.0.3
// (schemas/v3.0/schema.json and schemas/v2.0/schema.json). The validator is ajv 6 (JSON Schema draft-04, the dialect both are written in);
// ajv is not a direct dependency of this repo, it is the copy the lint tool brings in, so ajvVersion is exported for a test to pin it.
import { readFileSync } from "node:fs"
import { join } from "node:path"

// eslint-disable-next-line @typescript-eslint/no-require-imports
const Ajv = require("ajv") as new (o: Record<string, unknown>) => AjvInstance
// eslint-disable-next-line @typescript-eslint/no-require-imports
export const ajvVersion = (require("ajv/package.json") as { version: string }).version
// eslint-disable-next-line @typescript-eslint/no-require-imports
const draft04 = require("ajv/lib/refs/json-schema-draft-04.json") as object

type AjvInstance = {
  addMetaSchema: (s: object) => void
  compile: (s: object) => ((d: unknown) => boolean) & { errors?: Array<{ dataPath: string; message?: string }> | null }
}

const FIXTURES = join(import.meta.dir, "..", "__fixtures__", "openapi-schemas")
const load = (name: string): object => JSON.parse(readFileSync(join(FIXTURES, name), "utf8"))

export function validatorFor(schema: object) {
  const ajv = new Ajv({ schemaId: "auto", allErrors: true, unknownFormats: "ignore", logger: false })
  ajv.addMetaSchema(draft04)
  return ajv.compile(schema)
}
export const validateOas3 = validatorFor(load("openapi-3.0.3-schema.json"))
export const validateSwagger2 = validatorFor(load("swagger-2.0-schema.json"))

export const errorsOf = (v: ReturnType<typeof validatorFor>) => (v.errors ?? []).map((e) => `${e.dataPath} ${e.message}`)

/** Every "$ref": "#/..." in the document must point at something that exists in the same document. */
export function danglingRefs(doc: unknown): string[] {
  const bad: string[] = []
  const walk = (node: unknown) => {
    if (Array.isArray(node)) return node.forEach(walk)
    if (node && typeof node === "object") {
      for (const [k, v] of Object.entries(node as Record<string, unknown>)) {
        if (k === "$ref" && typeof v === "string") {
          if (!v.startsWith("#/")) { bad.push(`${v} (not a local reference)`); continue }
          let cur: unknown = doc
          for (const part of v.slice(2).split("/").map((s) => s.replace(/~1/g, "/").replace(/~0/g, "~"))) {
            cur = cur && typeof cur === "object" ? (cur as Record<string, unknown>)[part] : undefined
          }
          if (cur === undefined) bad.push(v)
        } else walk(v)
      }
    }
  }
  walk(doc)
  return bad
}

export type Doc = { paths: Record<string, Record<string, { operationId?: string; parameters?: Array<{ name?: string; in?: string; $ref?: string }> }>> }
export const METHODS = ["get", "post", "put", "patch", "delete", "options", "head"]

/** Faults the official schema does not catch: duplicate operationId, and a {template} in a path with no declared path parameter. */
export function structuralProblems(doc: Doc): string[] {
  const problems: string[] = []
  const ids = new Map<string, string>()
  for (const [path, item] of Object.entries(doc.paths)) {
    const templated = [...path.matchAll(/\{([^}]+)\}/g)].map((m) => m[1])
    for (const [method, op] of Object.entries(item)) {
      if (!METHODS.includes(method)) continue
      if (op.operationId) {
        const prior = ids.get(op.operationId)
        if (prior) problems.push(`operationId ${op.operationId} used by ${prior} and ${method} ${path}`)
        ids.set(op.operationId, `${method} ${path}`)
      }
      const shared = (item as unknown as { parameters?: Array<{ in?: string; name?: string; $ref?: string }> }).parameters ?? []
      const declared = new Set([...shared, ...(op.parameters ?? [])].filter((p) => p.in === "path").map((p) => p.name))
      for (const name of templated) {
        // a parameter given as a $ref is declared elsewhere; count it as declared only if the reference names it
        const viaRef = [...shared, ...(op.parameters ?? [])].some((p) => p.$ref && p.$ref.endsWith(`/${name}`))
        if (!declared.has(name) && !viaRef) problems.push(`${method} ${path}: path parameter {${name}} is not declared`)
      }
    }
  }
  return problems
}

