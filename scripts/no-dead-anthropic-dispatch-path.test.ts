// V2-23-REMOVE-DEAD-ANTHROPIC-PATH: regression test for the removal of the
// dead `claude-task` repository_dispatch event + its never-funded
// `ANTHROPIC_API_KEY` GitHub Secret (AGENTS.md's "Claude Code (Secondary
// Agent)" -- ai-dispatch.yml only ever implemented a zai-agent stub behind
// it, and the sibling @claude-comment workflow, .github/workflows/claude.yml,
// never ran a real job either -- see AGENTS.md's updated Secondary Agent
// entry). Codifies this task's own SUCCESS_CRITERIA grep as a permanent
// check so the dead path can't silently reappear.
//
// Deliberately narrow scope: src/lib/orchestra-model-resolver.ts (and its
// siblings llm-client.ts/prompt-eval-service.ts/prompt-portability.ts/the
// settings API routes) still read `ANTHROPIC_API_KEY` and support
// provider `"anthropic"` -- that is a separate, live, actively-used
// customer-facing bring-your-own-key LLM provider feature, unrelated to
// the AGENTS.md agent-dispatch mechanism this test guards against
// reappearing. This test intentionally does NOT assert those files are
// clean.
/// <reference types="bun-types" />
import { describe, expect, test } from "bun:test"
import { existsSync, readFileSync } from "node:fs"
import path from "node:path"

const REPO_ROOT = path.join(import.meta.dir, "..")

const DISPATCH_WORKFLOW = path.join(REPO_ROOT, ".github/workflows/ai-dispatch.yml")
const REMOVED_CLAUDE_COMMENT_WORKFLOW = path.join(REPO_ROOT, ".github/workflows/claude.yml")

describe("dead claude-task dispatch path stays removed", () => {
  test("ai-dispatch.yml no longer declares a claude-task trigger", () => {
    const contents = readFileSync(DISPATCH_WORKFLOW, "utf8")
    expect(contents).not.toContain("claude-task")
  })

  test(".github/workflows/claude.yml (the dead @claude-comment / ANTHROPIC_API_KEY workflow) is gone", () => {
    expect(existsSync(REMOVED_CLAUDE_COMMENT_WORKFLOW)).toBe(false)
  })

  test("no other .github/workflows/*.yml references the removed claude-task event or ANTHROPIC_API_KEY", () => {
    const workflowsDir = path.join(REPO_ROOT, ".github/workflows")
    const fs = require("node:fs") as typeof import("node:fs")
    const offenders: string[] = []
    for (const file of fs.readdirSync(workflowsDir)) {
      if (!file.endsWith(".yml") && !file.endsWith(".yaml")) continue
      const contents = readFileSync(path.join(workflowsDir, file), "utf8")
      if (contents.includes("claude-task") || contents.includes("ANTHROPIC_API_KEY")) offenders.push(file)
    }
    expect(offenders).toEqual([])
  })
})
