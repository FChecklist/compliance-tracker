// PROJEXA-BUILD-002 WP-09b (register row AW-504): builds the ONE self-contained ESM file the ai-work-link-exec Edge function imports:
//   supabase/functions/ai-work-link-exec/app.bundle.mjs   (GENERATED at deploy time, git-ignored, never committed: it carries the pipeline's names)
//
//   bun run scripts/build-ai-work-link-exec.ts [--out <file>] [--check]
//
// The entry is src/lib/pipeline/link-exec-entry.ts. The bundler applies the table of scripts/awl-exec-aliases.mjs (the heavy or non-Deno modules a
// link write never uses are replaced by throwing stubs). `--check` builds to a temporary file, prints the size and exits 0 under the limit.
import { existsSync, mkdtempSync, rmSync, statSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join, resolve } from "node:path"
import { FILE_STUBS, PACKAGE_STUBS, fileStub, packageStub } from "./awl-exec-aliases.mjs"

const forward = (p: string) => p.split("\\").join("/")
// forward slashes throughout: Bun on Windows panics ("pretty file path ... only forward slashes") on a plugin-resolved path that has backslashes
const root = forward(process.cwd())
const args = process.argv.slice(2)
const opt = (name: string) => (args.includes(name) ? args[args.indexOf(name) + 1] : undefined)
const LIMIT = 5_000_000
const EXT = ["", ".ts", ".tsx", "/index.ts", "/index.tsx", ".json"]

function resolveFile(base: string): string | null {
  for (const e of EXT) {
    const f = base + e
    if (existsSync(f) && statSync(f).isFile()) return f
  }
  return null
}

// The plugin is only asked about specifiers that COULD be in the table. Bun 1.3 on Windows panics when a plugin's onResolve also runs for bare
// packages resolved out of node_modules, so no catch-all filter is used: one filter for the stubbed packages, one for the file names in the table.
const PACKAGE_FILTER = new RegExp("^(" + PACKAGE_STUBS.map((p: { test: RegExp }) => p.test.source.replace(/^\^/, "").replace(/\$$/, "")).join("|") + ")$")
const stubbedBaseNames = Object.keys(FILE_STUBS).map((f) => (f.split("/").pop() as string).replace(/\.ts$/, "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
// `index` is too common a name to filter on: the db client is the one stubbed index.ts, and its importers name it `db/index` or `./db` (resolved below)
const fileFilter = new RegExp("(^|/)(" + [...new Set([...stubbedBaseNames, "db", "index"])].join("|") + ")(\\.ts)?$")

// Deno resolves a Node built-in only with the `node:` prefix, and postgres.js and others import them bare (`net`, `tls`, ...). Bun resolves built-ins
// before any plugin runs, so the imports are rewritten in the output text: `import x from"net";` becomes `import x from"node:net";`.
const NODE_BUILTINS = ["assert", "buffer", "crypto", "dns", "events", "fs", "http", "https", "net", "os", "path", "perf_hooks", "querystring", "stream", "string_decoder", "tls", "url", "util", "zlib"]
const BARE_BUILTIN_IMPORT = new RegExp("(\\bfrom|\\bimport)\\s*\"(" + NODE_BUILTINS.join("|") + ")\"(?=;)", "g")

const aliasPlugin: Bun.BunPlugin = {
  name: "awl-exec-aliases",
  setup(build) {
    build.onResolve({ filter: PACKAGE_FILTER }, (a) => {
      const stub = packageStub(a.path)
      return stub ? { path: forward(join(root, stub)) } : undefined
    })
    build.onResolve({ filter: fileFilter }, (a) => {
      const spec = a.path
      if (!spec.startsWith("@/") && !spec.startsWith(".")) return undefined
      const base = spec.startsWith("@/") ? forward(join(root, "src", spec.slice(2))) : forward(resolve(dirname(a.importer), spec))
      const file = resolveFile(base)
      if (!file) return undefined
      const stub = fileStub(forward(file).replace(root + "/", ""))
      return stub ? { path: forward(join(root, stub)) } : undefined
    })
  },
}

const check = args.includes("--check")
const dir = mkdtempSync(join(tmpdir(), "awl-exec-build-"))
const out = resolve(root, opt("--out") ?? (check ? join(dir, "app.bundle.mjs") : "supabase/functions/ai-work-link-exec/app.bundle.mjs"))
try {
  const result = await Bun.build({
    entrypoints: [join(root, "src/lib/pipeline/link-exec-entry.ts")],
    target: "node",
    format: "esm",
    minify: true,
    sourcemap: "none",
    define: { "process.env.NODE_ENV": '"production"' },
    plugins: [aliasPlugin],
  })
  if (!result.success) {
    for (const log of result.logs) console.error(String(log))
    console.error("FAIL bundle build failed")
    process.exit(1)
  }
  const text = (await result.outputs[0].text()).replace(BARE_BUILTIN_IMPORT, '$1"node:$2"')
  // what the bundle still IMPORTS at run time (everything else is inside it): only Node built-ins the Deno runtime provides may remain
  const externals = [...new Set(new Bun.Transpiler({ loader: "js" }).scanImports(text).map((i) => i.path))].filter((x) => !x.startsWith("./"))
  const badExternals = externals.filter((x) => !x.startsWith("node:") || /^node:child_process$/.test(x))
  console.log(`EXTERNALS ${externals.join(",") || "(none)"}`)
  if (badExternals.length) {
    console.error(`FAIL the bundle still imports ${badExternals.join(", ")} at run time`)
    process.exit(1)
  }
  await Bun.write(out, text)
  const size = statSync(out).size
  console.log(`BUNDLE bytes=${size} limit=${LIMIT} out=${check ? "(temporary)" : out}`)
  if (size >= LIMIT) {
    console.error(`FAIL the bundle is over the ${LIMIT} byte limit`)
    process.exit(1)
  }
  console.log(`BUNDLE_OK bytes=${size}`)
} finally {
  rmSync(dir, { recursive: true, force: true })
}
