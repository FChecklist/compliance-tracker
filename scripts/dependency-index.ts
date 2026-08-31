// VERIDIAN Review Framework gap-closure, AI Maintainability / Change Risk
// Management: closes TWO of the 5 findings from that evaluation with one
// artifact, per the evaluation's own row-74 recommendation ("Build the
// dependency index from row 74's recommendation" is literally how row 37's
// finding text points back here):
//
//   - [High] "Impact Analysis Before Modification" -- Gap: no automated
//     pre-modification impact analysis. Recommended approach: "Build a
//     lightweight static dependency index (e.g. which services import
//     which, which routes call which services) queryable before a change."
//   - [High] "Dependency Graph Accuracy" -- Gap: no accurate, queryable
//     dependency graph exists at any layer.
//
// Investigated before writing this: no dependency-index/impact-analysis
// tool existed anywhere in scripts/ or src/lib as of this session (checked
// via `git grep -li` across *.ts/*.md for "dependency.index",
// "impact.analysis", "dependency.graph" -- only prose docs mention the
// concept, nothing computes it).
//
// What this is, honestly: a LIGHTWEIGHT, regex-based static import scanner
// over every non-test .ts/.tsx file under src/ (~1,500 files as of this
// wave) -- not a full TypeScript-AST analysis. It resolves `@/*` (tsconfig
// path alias -> src/*) and relative (./ ../) specifiers to real repo files;
// external package imports (node_modules, no relative/alias prefix) are
// deliberately excluded from the graph -- this is an INTERNAL dependency
// graph (which of our own files import which), not a full module graph.
// Good enough to answer "if I change file X, what (transitively) imports
// it" and "what does file X depend on" before making a change -- the exact
// question row 74's recommendation names -- without the cost/fragility of
// wiring a real TS compiler API pass into a CI-runnable script.
//
// Two ways to use it:
//   1. Regenerate the committed snapshot: `bun scripts/dependency-index.ts`
//      -> writes ai-os/registry/dependency-index.json (queryable directly,
//      e.g. `jq '.edges["src/lib/db/schema.ts"]' ai-os/registry/dependency-index.json`
//      lists every file schema.ts itself imports; grepping the file for a
//      target path in an array value shows what imports it).
//   2. Query before a change, without regenerating the file:
//      `bun scripts/dependency-index.ts --impact-of=src/lib/services/<file>.ts`
//      prints every file that (transitively) imports the target -- the
//      real "what would this change ripple into" answer.
//      `bun scripts/dependency-index.ts --deps-of=src/app/api/<route>/route.ts`
//      prints what a route/service itself imports.
//
// Pure functions (extractImportSpecifiers/resolveSpecifierPath/
// resolveToRealFile/buildDependencyGraph/findDependents/findDependencies)
// are unit-tested directly in dependency-index.test.ts against small
// in-memory fixtures, no real filesystem/DB touched -- same pure-core/
// shell split as model-scorecard-service.ts and audit-asset-registry.ts.
import { readFile, readdir, writeFile, mkdir } from "node:fs/promises"
import path from "node:path"

const REPO_ROOT = process.cwd()
const SRC_ROOT = path.join(REPO_ROOT, "src")
const OUTPUT_PATH = path.join(REPO_ROOT, "ai-os", "registry", "dependency-index.json")

export type RepoPath = string // repo-relative, posix separators, e.g. "src/lib/services/foo-service.ts"

export type DependencyGraph = {
  /** Forward edges: file -> repo-internal files it imports (external packages excluded). */
  edges: Record<RepoPath, RepoPath[]>
}

export type SourceFile = { path: RepoPath; content: string }

// Matches the quoted module specifier in `import ... from "x"`,
// `import "x"` (side-effect), `export ... from "x"`, `export * from "x"`,
// `require("x")`, and dynamic `import("x")` -- one regex covers all of
// them because in every case the specifier is a quoted string immediately
// preceded by the keyword `from`/`import`/`require` (with only whitespace
// and/or an opening paren between). \b keeps this from matching arbitrary
// prose strings that happen to contain those words elsewhere.
const IMPORT_SPECIFIER_RE = /\b(?:from|import|require)\s*\(?\s*['"]([^'"]+)['"]/g

export function extractImportSpecifiers(content: string): string[] {
  const specifiers: string[] = []
  const re = new RegExp(IMPORT_SPECIFIER_RE)
  let match: RegExpExecArray | null
  while ((match = re.exec(content)) !== null) {
    if (match[1]) specifiers.push(match[1])
  }
  return specifiers
}

/** Resolves a raw import specifier to a repo-relative path candidate (no extension guessing yet). Returns null for external packages (no `@/` alias or relative prefix). */
export function resolveSpecifierPath(importerFile: RepoPath, specifier: string): RepoPath | null {
  if (specifier.startsWith("@/")) {
    return path.posix.normalize(path.posix.join("src", specifier.slice(2)))
  }
  if (specifier.startsWith("./") || specifier.startsWith("../")) {
    const importerDir = path.posix.dirname(importerFile)
    return path.posix.normalize(path.posix.join(importerDir, specifier))
  }
  return null
}

const CANDIDATE_SUFFIXES = ["", ".ts", ".tsx", "/index.ts", "/index.tsx"]

/** Matches a raw resolved path against the real known file set, trying the same extension/index-file resolution order Next.js/tsc use. */
export function resolveToRealFile(rawPath: RepoPath, knownFiles: ReadonlySet<RepoPath>): RepoPath | null {
  for (const suffix of CANDIDATE_SUFFIXES) {
    const candidate = rawPath + suffix
    if (knownFiles.has(candidate)) return candidate
  }
  return null
}

/** Pure graph builder -- takes already-read file contents, no filesystem access. */
export function buildDependencyGraph(files: SourceFile[]): DependencyGraph {
  const knownFiles = new Set(files.map((f) => f.path))
  const edges: Record<string, string[]> = {}

  for (const file of files) {
    const resolved = new Set<string>()
    for (const specifier of extractImportSpecifiers(file.content)) {
      const raw = resolveSpecifierPath(file.path, specifier)
      if (!raw) continue // external package -- not part of the internal graph
      const real = resolveToRealFile(raw, knownFiles)
      if (real && real !== file.path) resolved.add(real)
    }
    edges[file.path] = Array.from(resolved).sort()
  }

  return { edges }
}

function buildReverseIndex(graph: DependencyGraph): Map<RepoPath, RepoPath[]> {
  const reverse = new Map<RepoPath, RepoPath[]>()
  for (const [file, deps] of Object.entries(graph.edges)) {
    for (const dep of deps) {
      const arr = reverse.get(dep)
      if (arr) arr.push(file)
      else reverse.set(dep, [file])
    }
  }
  return reverse
}

/** What this file itself imports (repo-internal only). */
export function findDependencies(graph: DependencyGraph, source: RepoPath): RepoPath[] {
  return graph.edges[source] ?? []
}

/**
 * What (transitively, by default) imports this file -- the real
 * "impact analysis" answer: if you change `target`, everything this
 * returns is reachable from that change. `transitive: false` returns only
 * direct importers.
 */
export function findDependents(graph: DependencyGraph, target: RepoPath, transitive = true): RepoPath[] {
  const reverse = buildReverseIndex(graph)
  const direct = reverse.get(target) ?? []
  if (!transitive) return [...direct].sort()

  const visited = new Set<RepoPath>()
  const queue = [...direct]
  while (queue.length > 0) {
    const current = queue.shift()!
    if (visited.has(current)) continue
    visited.add(current)
    for (const dep of reverse.get(current) ?? []) {
      if (!visited.has(dep)) queue.push(dep)
    }
  }
  return Array.from(visited).sort()
}

async function walkSourceFiles(dir: string, out: string[]): Promise<void> {
  let entries
  try {
    entries = await readdir(dir, { withFileTypes: true })
  } catch {
    return
  }
  for (const entry of entries) {
    if (entry.name === "node_modules" || entry.name.startsWith(".")) continue
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      await walkSourceFiles(full, out)
    } else if (entry.isFile() && (entry.name.endsWith(".ts") || entry.name.endsWith(".tsx"))) {
      if (entry.name.endsWith(".test.ts") || entry.name.endsWith(".test.tsx") || entry.name.endsWith(".d.ts")) continue
      out.push(path.relative(REPO_ROOT, full))
    }
  }
}

async function loadAllSourceFiles(): Promise<SourceFile[]> {
  const relPaths: string[] = []
  await walkSourceFiles(SRC_ROOT, relPaths)
  return Promise.all(
    relPaths.map(async (p) => ({ path: p, content: await readFile(path.join(REPO_ROOT, p), "utf8") }))
  )
}

function normalizeQueryPath(raw: string): RepoPath {
  let p = raw.trim()
  if (p.startsWith(REPO_ROOT)) p = path.relative(REPO_ROOT, p)
  if (p.startsWith("./")) p = p.slice(2)
  return p
}

async function main() {
  const args = process.argv.slice(2)
  const impactFlag = args.find((a) => a.startsWith("--impact-of="))
  const depsFlag = args.find((a) => a.startsWith("--deps-of="))

  const files = await loadAllSourceFiles()
  const graph = buildDependencyGraph(files)

  if (impactFlag) {
    const target = normalizeQueryPath(impactFlag.slice("--impact-of=".length))
    if (!(target in graph.edges)) {
      console.error(`Not found in the scanned file set (src/, non-test .ts/.tsx only): ${target}`)
      process.exit(1)
    }
    const dependents = findDependents(graph, target, true)
    console.log(`Files that (transitively) import ${target}: ${dependents.length}`)
    for (const f of dependents) console.log(`  ${f}`)
    return
  }

  if (depsFlag) {
    const source = normalizeQueryPath(depsFlag.slice("--deps-of=".length))
    if (!(source in graph.edges)) {
      console.error(`Not found in the scanned file set (src/, non-test .ts/.tsx only): ${source}`)
      process.exit(1)
    }
    const deps = findDependencies(graph, source)
    console.log(`${source} imports ${deps.length} internal file(s):`)
    for (const f of deps) console.log(`  ${f}`)
    return
  }

  const edgeCount = Object.values(graph.edges).reduce((sum, arr) => sum + arr.length, 0)
  const output = {
    generatedAt: new Date().toISOString(),
    fileCount: files.length,
    edgeCount,
    edges: graph.edges,
  }
  await mkdir(path.dirname(OUTPUT_PATH), { recursive: true })
  await writeFile(OUTPUT_PATH, JSON.stringify(output, null, 2) + "\n", "utf8")
  console.log(
    `Dependency index written to ${path.relative(REPO_ROOT, OUTPUT_PATH)}: ${files.length} files, ${edgeCount} internal import edges.`
  )
  console.log(`Query before a change: bun scripts/dependency-index.ts --impact-of=src/lib/services/<file>.ts`)
}

// import.meta.main (Bun's entrypoint check, same convention as
// audit-asset-registry.ts/report-cognitive-brain-coverage.ts) -- keeps
// every pure function above importable by dependency-index.test.ts without
// triggering a real filesystem walk.
if (import.meta.main) {
  main().catch((err) => {
    console.error("dependency-index crashed:", err)
    process.exit(1)
  })
}
