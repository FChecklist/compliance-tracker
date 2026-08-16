#!/usr/bin/env node
// Gap closure, 2026-07-13 (Boss directive, metadata/drift investigation
// follow-up): the 4 existing coverage gates (check-guardrail-presence.mjs,
// check-asset-registry-coverage.mjs, check-metadata-index-coverage.mjs,
// check-doc-quarantine-banner.mjs) all verify "registry <-> reality"
// coverage -- is X registered somewhere. None of them verify LINK VALIDITY:
// the 6 real entry-point governance docs (CLAUDE.md's new "Read Before
// Starting Work" section added today via PR #259, AGENTS.md, ai-os/OS.yaml,
// docs/master/INDEX.md, ai-os/BRAIN.md, VERIDIAN_TASK_GOVERNANCE_CONSTITUTION.md)
// name each other and dozens of other files by path in prose/links/YAML,
// and nothing previously checked those paths still resolve. If one of them
// got renamed or deleted, nothing would catch the broken reference. This
// script is that check, same enforcement class as the other 4 (a reviewable-
// diff guarantee via PR/CI, not a runtime-unbypassable lock -- named
// honestly, not oversold).
//
// Editing ai-os/OS.yaml is on CLAUDE.md's "DO NOT touch" list; this script
// and its ai-os/OS.yaml self-registration line are built under the same
// Owner authorization basis as PR #250/#259/#260/#261/#263/#264 (Rajat
// Agarwal, 2026-07-13: "build both [the CI gate and a local hook] ... make
// sure that sync is complete, so that gaps are removed").
//
// Three distinct reference styles are scanned, one per file, because a
// single regex does not fit all of them (confirmed by reading all 6 files
// before writing this parser):
//
//  1. YAML_REF_FILES (ai-os/OS.yaml) -- unambiguous `path:` keys under its
//     `index:` sections, parsed as real YAML (js-yaml, matching this repo's
//     other scripts). A `path` starting with "/" is an HTTP route pointer
//     (e.g. index.monitoring_health_check's `/api/ai/team/governance-health`
//     entry, deliberate), not a filesystem path -- skipped, not checked.
//
//  2. MARKDOWN_LINK_FILES (docs/master/INDEX.md) -- `[text](relative/path)`
//     links, resolved relative to the REFERENCING FILE'S OWN DIRECTORY
//     (e.g. a link written `../../ai-os/OS.yaml` from inside docs/master/),
//     not the repo root. External links (http(s)://, mailto:) and bare
//     anchors (#section) are skipped.
//
//  3. BACKTICK_PROSE_FILES (CLAUDE.md, AGENTS.md, ai-os/BRAIN.md,
//     VERIDIAN_TASK_GOVERNANCE_CONSTITUTION.md) -- backtick-quoted spans
//     that look like a real file path: contains "/" or ends in one of
//     .md/.yaml/.yml/.ts/.mjs/.sql/.json, and contains no space (a space
//     means a command/snippet, e.g. `bun test`, not a path). Verified
//     against all four files' real content before finalizing -- the naive
//     version of this heuristic alone produces real false positives in
//     this specific codebase, so two extra guards were added:
//       - A slash-containing span with NO known extension is only treated
//         as a path candidate if its first "/"-segment is a real top-level
//         repo entry. Without this, model identifiers like `z-ai/glm-5.2`,
//         `openai/gpt-5.5`, `openai/gpt-oss-120b`, and field-lists like
//         `status/worker/protocol/confidence/action` all read as
//         slash-containing "paths" and would falsely fail.
//       - Spans starting with "@" (npm scope / import alias, e.g.
//         `@supabase/ssr`, `@/lib/supabase/auth-guard`), starting with "/"
//         (this codebase's own convention: real relative paths in these
//         docs never have a leading slash -- a leading-slash span is an
//         HTTP route like `/api/ai/team/dispatch`, not a file), or
//         containing "<"/">"/"*" (glob/placeholder patterns like
//         `ai-team/<role>/*`) are excluded outright.
//     Many real references in these docs are intentionally-abbreviated
//     bare filenames (`roster.ts`, not `src/lib/ai-team/roster.ts`) --
//     resolveRef() below falls back to a suffix match against a full
//     repo file index before calling something broken, for exactly this
//     reason (false positives here are worse than false negatives: a
//     check that cries wolf on `roster.ts` gets ignored).
//
// Honest, named exception: VERIDIAN_TASK_GOVERNANCE_CONSTITUTION.md's
// "Mid-Session Self-Check" section discusses `.claude/settings.json`
// explicitly to say it does NOT exist ("this repository has no
// `.claude/settings.json`") -- that is the document correctly describing
// an absence, not drift. Flagging it as "broken" would be exactly the
// false-positive failure mode this script is designed to avoid, so it is
// listed in INTENTIONAL_NONEXISTENCE below, scoped to that exact
// (file, span) pair -- a genuine future broken reference to that same path
// anywhere else would still be caught.
import { readFile, readdir } from "node:fs/promises"
import { existsSync } from "node:fs"
import path from "node:path"
import yaml from "js-yaml"

const REPO_ROOT = process.cwd()

const YAML_REF_FILES = ["ai-os/OS.yaml"]
const MARKDOWN_LINK_FILES = ["docs/master/INDEX.md"]
const BACKTICK_PROSE_FILES = ["CLAUDE.md", "AGENTS.md", "ai-os/BRAIN.md", "VERIDIAN_TASK_GOVERNANCE_CONSTITUTION.md"]

const KNOWN_EXTENSIONS = /\.(md|yaml|yml|ts|mjs|sql|json)$/

// Directories excluded when building the fallback suffix-match file index --
// build artifacts / dependency trees / this repo's own worktree scratch
// space, never a real target of a governance-doc reference.
const WALK_EXCLUDE = new Set([
  "node_modules", ".git", ".next", "dist", "build", "coverage", ".turbo", ".vercel", "out", ".claude",
])

const INTENTIONAL_NONEXISTENCE = new Set([
  "VERIDIAN_TASK_GOVERNANCE_CONSTITUTION.md::.claude/settings.json",
])

async function buildFileIndex() {
  const results = []
  async function walk(dir) {
    let entries
    try {
      entries = await readdir(path.resolve(REPO_ROOT, dir), { withFileTypes: true })
    } catch {
      return
    }
    for (const e of entries) {
      if (WALK_EXCLUDE.has(e.name)) continue
      const rel = dir ? `${dir}/${e.name}` : e.name
      if (e.isDirectory()) {
        await walk(rel)
      } else {
        results.push(rel)
      }
    }
  }
  await walk("")
  return results
}

function resolveDirect(relPath) {
  const norm = relPath.replace(/\/+$/, "")
  if (norm === "" || norm.startsWith("..")) return false
  return existsSync(path.resolve(REPO_ROOT, norm))
}

function resolveSuffix(relPath, fileIndex) {
  const norm = relPath.replace(/\/+$/, "")
  const suffix = "/" + norm
  return fileIndex.some((f) => f === norm || f.endsWith(suffix))
}

function resolveRef(relPath, fileIndex) {
  return resolveDirect(relPath) || resolveSuffix(relPath, fileIndex)
}

function escapeRegex(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
}

// --- 1. YAML structured refs -------------------------------------------

async function scanYamlRefs(file, fileIndex) {
  const raw = await readFile(path.resolve(REPO_ROOT, file), "utf8")
  const doc = yaml.load(raw)
  const lines = raw.split(/\r?\n/)

  const refs = []
  for (const entries of Object.values(doc.index ?? {})) {
    if (!Array.isArray(entries)) continue
    for (const entry of entries) {
      if (entry && typeof entry.path === "string") refs.push(entry.path)
    }
  }

  let checked = 0
  const broken = []
  for (const p of refs) {
    if (p.startsWith("/")) continue // HTTP route pointer, not a filesystem path -- deliberate (monitoring_health_check)
    checked++
    if (!resolveRef(p, fileIndex)) {
      const lineRe = new RegExp(`path:\\s*${escapeRegex(p)}\\s*$`)
      const lineIdx = lines.findIndex((l) => lineRe.test(l))
      broken.push({ file, line: lineIdx >= 0 ? lineIdx + 1 : "?", ref: p })
    }
  }
  return { checked, broken }
}

// --- 2. Markdown links, resolved relative to the referencing file's dir -

async function scanMarkdownLinks(file, fileIndex) {
  const raw = await readFile(path.resolve(REPO_ROOT, file), "utf8")
  const lines = raw.split(/\r?\n/)
  const linkRe = /\[[^\]]*\]\(([^)]+)\)/g

  let checked = 0
  const broken = []
  lines.forEach((line, idx) => {
    let m
    while ((m = linkRe.exec(line))) {
      const target = m[1].trim()
      if (/^[a-z][a-z0-9+.-]*:/i.test(target) || target.startsWith("#")) continue // external URL / mailto: / bare anchor
      const targetPath = target.split("#")[0].split("?")[0]
      if (!targetPath) continue
      checked++
      const resolved = path.posix.normalize(
        path.posix.join(path.dirname(file).split(path.sep).join("/"), targetPath)
      )
      if (!resolveRef(resolved, fileIndex)) {
        broken.push({ file, line: idx + 1, ref: target })
      }
    }
  })
  return { checked, broken }
}

// --- 3. Backtick-quoted paths in prose -----------------------------------

function isPathCandidate(span, topLevel) {
  if (span.includes(" ")) return false
  if (span.startsWith("@")) return false
  if (span.startsWith("/")) return false
  if (/[<>*]/.test(span)) return false
  const hasSlash = span.includes("/")
  const hasExt = KNOWN_EXTENSIONS.test(span)
  if (!hasSlash && !hasExt) return false
  if (!hasExt) {
    const first = span.split("/")[0]
    if (!topLevel.has(first)) return false
  }
  return true
}

async function scanBacktickProse(file, fileIndex, topLevel) {
  const raw = await readFile(path.resolve(REPO_ROOT, file), "utf8")
  const lines = raw.split(/\r?\n/)
  const spanRe = /`([^`\n]+)`/g

  let checked = 0
  const broken = []
  lines.forEach((line, idx) => {
    let m
    while ((m = spanRe.exec(line))) {
      const span = m[1]
      if (!isPathCandidate(span, topLevel)) continue
      checked++
      if (!resolveRef(span, fileIndex)) {
        if (INTENTIONAL_NONEXISTENCE.has(`${file}::${span}`)) continue
        broken.push({ file, line: idx + 1, ref: span })
      }
    }
  })
  return { checked, broken }
}

async function main() {
  const fileIndex = await buildFileIndex()
  const rootEntries = await readdir(REPO_ROOT, { withFileTypes: true })
  const topLevel = new Set(rootEntries.map((e) => e.name))

  const perFileChecked = new Map()
  const allBroken = []

  for (const file of YAML_REF_FILES) {
    const { checked, broken } = await scanYamlRefs(file, fileIndex)
    perFileChecked.set(file, checked)
    allBroken.push(...broken)
  }
  for (const file of MARKDOWN_LINK_FILES) {
    const { checked, broken } = await scanMarkdownLinks(file, fileIndex)
    perFileChecked.set(file, checked)
    allBroken.push(...broken)
  }
  for (const file of BACKTICK_PROSE_FILES) {
    const { checked, broken } = await scanBacktickProse(file, fileIndex, topLevel)
    perFileChecked.set(file, checked)
    allBroken.push(...broken)
  }

  if (allBroken.length > 0) {
    console.error("=== Doc Cross-Reference Check FAILED ===")
    console.error(`${allBroken.length} reference(s) in governance entry-point docs point at a path that does not exist on disk:\n`)
    for (const b of allBroken) {
      console.error(`  - ${b.file}:${b.line}  "${b.ref}"`)
    }
    console.error(
      "\nEither the referenced file was renamed/deleted and the referencing doc's path needs updating,"
    )
    console.error(
      "or the reference is a genuine gap (something that should exist but doesn't) -- fix the path or"
    )
    console.error("create the file; do not delete the reference just to make this check pass.")
    process.exit(1)
  }

  const totalChecked = [...perFileChecked.values()].reduce((a, b) => a + b, 0)
  console.log(`Doc Cross-Reference Check passed -- ${totalChecked} reference(s) checked across ${perFileChecked.size} files, all resolved:`)
  for (const [file, count] of perFileChecked) {
    console.log(`  - ${file}: ${count}`)
  }
}

main().catch((err) => {
  console.error("Doc Cross-Reference Check crashed:", err)
  process.exit(1)
})
