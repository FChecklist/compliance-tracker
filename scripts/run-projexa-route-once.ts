/// <reference types="bun-types" />
/**
 * scripts/run-projexa-route-once.ts -- ONE-OFF, session task (2026-09-25).
 *
 * Invokes a single src/app/api/v1/projexa/* route handler in-process under
 * Bun, WITHOUT starting a Next.js dev server -- same technique as
 * scripts/run-internal-cron.ts (see that file's own header for the full
 * rationale: this machine's RAM is too tight right now to safely run a full
 * `next dev`, and a route handler is just an exported async function, so
 * dynamically importing it and calling it directly is a faithful,
 * lower-footprint substitute for a real HTTP round trip).
 *
 * Not meant to be a durable tool -- it exists to populate one real demo
 * project with one real prospect's BOQ, exercising the ACTUAL import
 * pipeline (parseBoqSpreadsheet, createBoq) rather than a raw SQL insert.
 *
 * Usage:
 *   bun scripts/run-projexa-route-once.ts <route-relative-path> <method> \
 *     --bearer <token> [--json <file.json>] [--form-file <field=path>]... \
 *     [--form-field <field=value>]... [--query <k=v>]...
 *
 *   route-relative-path is relative to src/app/api/v1/projexa/, e.g.
 *   "projects" or "scope/import".
 */
import { existsSync } from "node:fs"
import { readFileSync } from "node:fs"
import { NextRequest } from "next/server"

type RouteModule = { GET?: unknown; POST?: unknown; PATCH?: unknown; DELETE?: unknown }

function parseArgs(argv: string[]) {
  const [routePath, method] = argv
  const rest = argv.slice(2)
  let bearer: string | undefined
  let jsonFile: string | undefined
  const formFiles: Array<[string, string]> = []
  const formFields: Array<[string, string]> = []
  const query: Array<[string, string]> = []
  for (let i = 0; i < rest.length; i++) {
    const arg = rest[i]
    if (arg === "--bearer") bearer = rest[++i]
    else if (arg === "--json") jsonFile = rest[++i]
    else if (arg === "--form-file") {
      const [field, path] = rest[++i].split("=")
      formFiles.push([field, path])
    } else if (arg === "--form-field") {
      const [field, ...valueParts] = rest[++i].split("=")
      formFields.push([field, valueParts.join("=")])
    } else if (arg === "--query") {
      const [k, ...valueParts] = rest[++i].split("=")
      query.push([k, valueParts.join("=")])
    }
  }
  return { routePath, method, bearer, jsonFile, formFiles, formFields, query }
}

async function main() {
  const { routePath, method, bearer, jsonFile, formFiles, formFields, query } = parseArgs(process.argv.slice(2))
  if (!routePath || !method) {
    console.error("usage: bun scripts/run-projexa-route-once.ts <route-path> <METHOD> --bearer <token> [--json file.json] [--form-file field=path] [--form-field field=value] [--query k=v]")
    process.exit(2)
  }

  const moduleRelPath = `../src/app/api/v1/projexa/${routePath}/route.ts`
  const moduleUrl = new URL(moduleRelPath, import.meta.url)
  if (!existsSync(new URL(moduleRelPath, import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1"))) {
    console.error(`no such route module: ${moduleRelPath}`)
    process.exit(2)
  }

  const mod = (await import(moduleUrl.href)) as RouteModule
  const handler = (mod as Record<string, unknown>)[method] as
    | ((req: NextRequest) => Response | Promise<Response>)
    | undefined
  if (typeof handler !== "function") {
    console.error(`route module has no exported ${method}`)
    process.exit(2)
  }

  let url = `http://localhost/api/v1/projexa/${routePath}`
  if (query.length) {
    const qs = new URLSearchParams(query)
    url += `?${qs.toString()}`
  }

  const headers: Record<string, string> = {}
  if (bearer) headers.authorization = `Bearer ${bearer}`

  let body: BodyInit | undefined
  if (jsonFile) {
    headers["content-type"] = "application/json"
    body = readFileSync(jsonFile, "utf-8")
  } else if (formFiles.length || formFields.length) {
    const fd = new FormData()
    for (const [field, path] of formFiles) {
      const buf = readFileSync(path)
      const name = path.split(/[/\\]/).pop() || "file"
      const blob = new Blob([buf])
      fd.append(field, blob, name)
    }
    for (const [field, value] of formFields) fd.append(field, value)
    body = fd
  }

  const request = new NextRequest(url, { method, headers, body })
  const started = performance.now()
  let response: Response
  try {
    response = await handler(request)
  } catch (err) {
    console.error("HANDLER THREW:", err)
    process.exit(1)
  }
  const elapsedMs = Math.round(performance.now() - started)
  const text = await response.text()
  console.log(`status: ${response.status}`)
  console.log(`elapsed_ms: ${elapsedMs}`)
  try {
    console.log(JSON.stringify(JSON.parse(text), null, 2))
  } catch {
    console.log(text)
  }
  process.exit(response.status >= 200 && response.status < 300 ? 0 : 1)
}

main()
