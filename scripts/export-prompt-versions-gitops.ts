#!/usr/bin/env bun
// VERIDIAN_Architecture_v2.0 phase_3 -- governance-gitops-workflow
// (2026-07-26).
//
// Gap analysis's own confirmed remaining gap (governance-gitops-workflow,
// verdict partially_implemented): ".github/workflows/ai-prompt-evals.yml"
// already gives real "PR-based changes with CI/CD eval artifacts", but
// "Prompts stored as their own versioned Git files" was NOT real -- prompt
// content lived only in DB prompt_versions rows or hardcoded TS strings.
// This script closes THAT specific sub-gap: it exports every real
// prompt_templates/prompt_versions row into a git-tracked, human-diffable
// file tree, so a prompt's content and lifecycle state have a real Git
// history a PR can review, independent of the DB.
//
// Deliberately NOT a two-way sync / GitOps-apply-from-Git pipeline -- the DB
// remains the single source of truth this phase's governance gates
// (transitionPromptLifecycle) enforce against; this is the read-side half
// of "stored as versioned Git files" only. A future phase wiring Git as the
// write-of-record (with a CI job replaying committed changes back into the
// DB) is a materially larger, riskier change this phase does not attempt.
//
// Honest limitation, carried into this phase's own evidence rather than
// silently dropped: making ai-prompt-evals.yml's existing eval job
// merge-blocking (the requirement's own "branch protection requiring
// passing evals before merge" clause) needs a .github/workflows/*.yml edit,
// which this session's gh token cannot push (missing `workflow` OAuth
// scope -- confirmed by isolating a probe branch before writing this
// script). That specific sub-item is NOT done by this script or this phase;
// it needs either the Owner granting `workflow` scope to a future session,
// or the Owner pushing that one-line edit themselves.
import { mkdirSync, writeFileSync, readdirSync, rmSync } from "node:fs"
import { join } from "node:path"
import { db, promptTemplates, promptVersions } from "../src/lib/db"

const OUTPUT_ROOT = join(process.cwd(), "prompt-registry")

function sanitizeSegment(key: string): string {
  return key.replace(/[^a-zA-Z0-9._-]/g, "_")
}

async function main() {
  const templates = await db.query.promptTemplates.findMany({ orderBy: (t, { asc }) => asc(t.templateKey) })
  console.log(`Exporting ${templates.length} prompt template(s) to ${OUTPUT_ROOT}/ ...`)

  // Clean re-export each run -- this directory is a derived, generated
  // view of the DB (like drizzle/meta/_journal.json), never hand-edited,
  // so stale files from a renamed/deleted template must not linger.
  try {
    rmSync(OUTPUT_ROOT, { recursive: true, force: true })
  } catch {
    // ignore -- directory may not exist yet on first run
  }
  mkdirSync(OUTPUT_ROOT, { recursive: true })

  let versionCount = 0
  for (const template of templates) {
    const templateDir = join(OUTPUT_ROOT, sanitizeSegment(template.templateKey))
    mkdirSync(templateDir, { recursive: true })

    const versions = await db.query.promptVersions.findMany({
      where: (v, { eq }) => eq(v.promptTemplateId, template.id),
      orderBy: (v, { asc }) => asc(v.version),
    })

    for (const version of versions) {
      const fileName = `v${version.major}.${version.minor}.${version.patch}--${version.lifecycleState}.md`
      const frontMatter = [
        "---",
        `templateKey: ${template.templateKey}`,
        `version: ${version.version}`,
        `semver: ${version.major}.${version.minor}.${version.patch}`,
        `label: ${version.label ?? "null"}`,
        `lifecycleState: ${version.lifecycleState}`,
        `createdAt: ${version.createdAt.toISOString()}`,
        `approvedById: ${version.approvedById ?? "null"}`,
        `approvedAt: ${version.approvedAt ? version.approvedAt.toISOString() : "null"}`,
        `stagingEnteredAt: ${version.stagingEnteredAt ? version.stagingEnteredAt.toISOString() : "null"}`,
        `rolledBackFromVersionId: ${version.rolledBackFromVersionId ?? "null"}`,
        "---",
        "",
      ].join("\n")
      writeFileSync(join(templateDir, fileName), frontMatter + version.content + "\n")
      versionCount++
    }
  }

  console.log(`Wrote ${versionCount} version file(s) across ${templates.length} template director${templates.length === 1 ? "y" : "ies"}.`)
  console.log("This directory is generated -- do not hand-edit; re-run this script after any prompt_versions change, and commit the diff for real Git history.")
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err)
    process.exit(1)
  })
