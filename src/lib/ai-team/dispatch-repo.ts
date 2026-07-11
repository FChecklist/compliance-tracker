// Fires the `ai-team-task` repository_dispatch event (.github/workflows/
// ai-team-workforce.yml), which runs scripts/ai-workforce-agent.mjs against
// a fresh checkout and opens a PR. This is the repo-write path for AI
// Workforce roles -- runRole() in team-service.ts stays the advisory-only
// (no file access) path for guardrail checks and quick answers.
//
// Requires a GitHub PAT with repo-dispatch permission on this repo. Not
// currently set as a Vercel env var (only exists as the GitHub Actions
// secret PAT_FCHECKLIST) -- calling this from the deployed app will throw
// until GITHUB_DISPATCH_PAT is added to Vercel. Until then, trigger via
// `gh api repos/FChecklist/compliance-tracker/dispatches` directly.

import { getRole } from "./roster"
import { validateTightTask, type TightTask } from "../task-tightening"
import { checkTierEligibility } from "../model-tier-eligibility"

const REPO = "FChecklist/compliance-tracker"

// VERIDIAN_TASK_GOVERNANCE_CONSTITUTION.md: this dispatcher has no live
// callers yet (GITHUB_DISPATCH_PAT isn't set on Vercel), so this is a
// zero-risk point to require a TightTask instead of a free-text string --
// no existing caller to break. Validated here too (not just relying on
// ai-workforce-agent.mjs's own validation) so a bad dispatch never even
// reaches GitHub Actions.
export async function dispatchRepoTask(roleKey: string, task: TightTask): Promise<void> {
  const role = getRole(roleKey)
  if (!role || role.isHuman || role.isCodeOnly || !role.model) {
    throw new Error(`Role '${roleKey}' is not a repo-write-capable AI Workforce role.`)
  }

  const validation = validateTightTask(task)
  if (!validation.valid) {
    throw new Error(`Task is not tight enough to dispatch: ${validation.reason} ${validation.guidance}`)
  }

  // Wave 163: same tier-eligibility check as /api/ai/team/dispatch --
  // this path has no live callers yet, but it's the trigger for
  // ai-workforce-agent.mjs, so it gets the same enforcement rather than
  // being left as the one dispatch surface without it.
  const tierCheck = checkTierEligibility(role.model, task.complexityTier)
  if (!tierCheck.eligible) {
    throw new Error(`${tierCheck.reason} ${tierCheck.guidance}`)
  }

  const token = process.env.GITHUB_DISPATCH_PAT
  if (!token) throw new Error("GITHUB_DISPATCH_PAT is not configured -- cannot fire repository_dispatch from the app.")

  const res = await fetch(`https://api.github.com/repos/${REPO}/dispatches`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/vnd.github+json",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      event_type: "ai-team-task",
      client_payload: {
        role_key: roleKey,
        objective: task.objective,
        scope: task.scope,
        success_criteria: task.successCriteria,
        complexity_tier: task.complexityTier,
        expected_output: task.expectedOutput,
        constraints: task.constraints ?? "",
      },
    }),
  })
  if (!res.ok) throw new Error(`Failed to dispatch ai-team-task: HTTP ${res.status} ${await res.text()}`)
}
