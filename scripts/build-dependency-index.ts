#!/usr/bin/env bun
// VERIDIAN Review Framework gap-closure, "AI Maintainability / Change Risk
// Management" -- closes two related findings together (the second's own
// recommended approach literally says "build the dependency index from
// [the first]'s recommendation"):
//   - [High] "Impact Analysis Before Modification": "No automated
//     pre-modification impact analysis." Recommended: "Build a lightweight
//     static dependency index (e.g. which services import which, which
//     routes call which services) queryable before a change."
//   - [High] "Dependency Graph Accuracy": "No accurate, queryable
//     dependency graph exists at any layer."
//
// Investigated first, per this task's own instruction not to assume the
// gap description still matches the code: `git grep` for
// dependency-index/dependency-graph/impact-analysis across src/, scripts/,
// docs/ turned up nothing but unrelated Business-Continuity-Management
// "impact analysis" (bcm-service.ts -- disaster-recovery BIA, a different
// domain entirely). No dependency index exists at any layer -- the gap is
// real.
//
// Scope, stated honestly: this is a STATIC IMPORT graph (which .ts/.tsx
// file imports which other .ts/.tsx file, resolved through the "@/" ->
// "src/" alias and relative paths), not a runtime call graph. That is
// exactly what the recommendation asks for ("static dependency index"),
// and it is genuinely useful before touching a service or route: run
// `bun scripts/build-dependency-index.ts --impact src/lib/services/foo.ts`
// and see every file (route, service, or otherwise) that would need
// re-checking. It does NOT capture dynamic requires, string-built import
// paths, or non-TS callers (SQL, cron) -- named here rather than oversold.
//
// Parsing is regex-based (import/export/dynamic-import specifiers), not a
// full TS AST -- consistent with this codebase's other structural-scan
// scripts (see check-doc-cross-references.mjs's own header for the same
// choice and rationale: cheap, dependency-free, good enough for "which
// file references which path").
//
// Pure-core/FS-shell split so the graph-building logic is unit-tested
// without touching the real filesystem (build-dependency-index.test.ts) --
// same convention as model-scorecard-service.ts's mergeScorecardGroups.
import { readdirSync, statSync, readFileSync, writeFileSync, existsSync } from "node:fs"
import { join, dirname, relative, resolve as resolvePath } from "node:path"

const REPO_ROOT = resolvePath(dirname(new URL(import.meta.url).pathname), "..")
const SCAN_ROOTS = ["src/app/api", "src/lib", "src/components"]
const CANDIDATE_EXTENSIONS = [".ts", ".tsx", ".js", ".jsx"]
const OUT_FILE = join(REPO_ROOT, "docs", "dependency-index.json")

// ---------------------------------------------------------------------------
// Pure core -- no fs access below this point except via the injected `exists`
// callback, so it's fully unit-testable against a fake filesystem.
// ---------------------------------------------------------------------------

/** Extracts every static/dynamic import-or-reexport specifier from one file's source text. */
export function extractImportSpecifiers(sourceText: string): string[] {
  const specifiers: string[] = []
  const staticRe = /(?:^|\s)(?:import|export)(?:\s+type)?[^;]*?\bfrom\s+["']([^"']+)["']/g
  const dynamicRe = /\bimport\(\s*["']([^"']+)["']\s*\)/g
  let match: RegExpExecArray | null
  while ((match = staticRe.exec(sourceText))) specifiers.push(match[1])
  while ((match = dynamicRe.exec(sourceText))) specifiers.push(match[1])
  return specifiers
}

/**
 * Resolves one import specifier (as seen from `fromFile`, a repo-relative
 * path like "src/lib/services/foo-service.ts") to another repo-relative
 * path, or null when it's an external package (no leading "@/" / "./" /
 * "../") or can't be resolved against `exists`. `exists` is injected so
 * this stays pure/testable.
 */
export function resolveImportPath(fromFile: string, specifier: string, exists: (repoRelativePath: string) => boolean): string | null {
  let base: string
  if (specifier.startsWith("@/")) {
    base = "src/" + specifier.slice(2)
  } else if (specifier.startsWith("./") || specifier.startsWith("../")) {
    base = relative(".", join(dirname(fromFile), specifier))
  } else {
    return null // external package (node_modules) -- not part of the internal graph
  }

  const candidates = [
    base,
    ...CANDIDATE_EXTENSIONS.map((ext) => base + ext),
    ...CANDIDATE_EXTENSIONS.map((ext) => join(base, "index" + ext)),
  ]
  for (const candidate of candidates) {
    if (exists(candidate)) return candidate.split("\\").join("/")
  }
  return null
}

export type DependencyGraph = {
  /** file -> the internal files it imports */
  forward: Record<string, string[]>
  /** file -> the internal files that import it (the inverse of `forward`) */
  reverse: Record<string, string[]>
}

/** Builds the forward + reverse graph from a set of already-read files. Pure. */
export function buildDependencyGraph(files: Array<{ path: string; content: string }>, exists: (repoRelativePath: string) => boolean): DependencyGraph {
  const forward: Record<string, string[]> = {}
  const reverse: Record<string, string[]> = {}
  const knownFiles = new Set(files.map((f) => f.path))

  for (const file of files) {
    const specifiers = extractImportSpecifiers(file.content)
    const resolved = new Set<string>()
    for (const specifier of specifiers) {
      const target = resolveImportPath(file.path, specifier, exists)
      if (target && knownFiles.has(target)) resolved.add(target)
    }
    forward[file.path] = Array.from(resolved).sort()
    for (const target of resolved) {
      if (!reverse[target]) reverse[target] = []
      reverse[target].push(file.path)
    }
  }
  for (const key of Object.keys(reverse)) reverse[key].sort()
  return { forward, reverse }
}

/** BFS over the reverse graph -- everything that would need re-checking if `file` changes. */
export function computeImpact(graph: DependencyGraph, file: string): { direct: string[]; transitive: string[] } {
  const direct = graph.reverse[file] ?? []
  const visited = new Set<string>(direct)
  const queue = [...direct]
  const transitiveOnly: string[] = []
  while (queue.length > 0) {
    const current = queue.shift()!
    for (const next of graph.reverse[current] ?? []) {
      if (visited.has(next)) continue
      visited.add(next)
      transitiveOnly.push(next)
      queue.push(next)
    }
  }
  return { direct: [...direct].sort(), transitive: transitiveOnly.sort() }
}

// ---------------------------------------------------------------------------
// FS shell -- real directory walk + real fs.existsSync, only reached when run
// as a script (import.meta.main), never during `bun test`.
// ---------------------------------------------------------------------------

function walk(dir: string, out: string[]): void {
  if (!existsSync(dir)) return
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name.startsWith(".")) continue
    const full = join(dir, entry.name)
    if (entry.isDirectory()) {
      walk(full, out)
    } else if (CANDIDATE_EXTENSIONS.some((ext) => entry.name.endsWith(ext)) && !entry.name.endsWith(".test.ts") && !entry.name.endsWith(".test.tsx") && !entry.name.endsWith(".d.ts")) {
      out.push(full)
    }
  }
}

function scanRepo(): Array<{ path: string; content: string }> {
  const absolutePaths: string[] = []
  for (const root of SCAN_ROOTS) walk(join(REPO_ROOT, root), absolutePaths)
  return absolutePaths.map((abs) => ({
    path: relative(REPO_ROOT, abs).split("\\").join("/"),
    content: readFileSync(abs, "utf8"),
  }))
}

function realExists(repoRelativePath: string): boolean {
  try {
    return statSync(join(REPO_ROOT, repoRelativePath)).isFile()
  } catch {
    return false
  }
}

function main(): void {
  const args = process.argv.slice(2)
  const impactIdx = args.indexOf("--impact")

  const files = scanRepo()
  const graph = buildDependencyGraph(files, realExists)

  if (impactIdx !== -1) {
    const target = args[impactIdx + 1]
    if (!target) {
      console.error("Usage: bun scripts/build-dependency-index.ts --impact <repo-relative-path>")
      process.exit(1)
    }
    const normalized = target.replace(/^\.\//, "")
    if (!(normalized in graph.forward)) {
      console.error(`'${normalized}' is not in the scanned index (scanned roots: ${SCAN_ROOTS.join(", ")}). Run without --impact first to regenerate, or check the path.`)
      process.exit(1)
    }
    const { direct, transitive } = computeImpact(graph, normalized)
    console.log(`Impact analysis for ${normalized}`)
    console.log(`  ${direct.length} direct dependent(s):`)
    direct.forEach((f) => console.log(`    - ${f}`))
    console.log(`  ${transitive.length} additional transitive dependent(s):`)
    transitive.forEach((f) => console.log(`    - ${f}`))
    if (direct.length === 0 && transitive.length === 0) {
      console.log("  (nothing in src/app/api, src/lib, or src/components imports this file -- safe from a static-import-graph perspective, but re-check runtime callers like cron scripts or SQL.)")
    }
    return
  }

  writeFileSync(OUT_FILE, JSON.stringify({ generatedFrom: SCAN_ROOTS, fileCount: files.length, ...graph }, null, 2) + "\n")
  console.log(`Wrote dependency index for ${files.length} files to ${relative(REPO_ROOT, OUT_FILE)}`)
  console.log(`Query impact with: bun scripts/build-dependency-index.ts --impact <repo-relative-path>`)
}

if (import.meta.main) main()
